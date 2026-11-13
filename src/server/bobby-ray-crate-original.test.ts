import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { parseSectorString, type Sector, sectorFromId, sectorShortString, strategicIndex } from '../content/strategic/sector-ids.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { WORLD_COLS } from '../content/world/grid.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import type { SimEvent } from '../sim/events.ts';
import type { PreviewAction } from '../sim/hints/preview-action.ts';
import type { SectorLayout } from '../sim/hints/sector-layout.ts';
import { getGroup, setGroupSectorValue } from '../sim/strategic/forces/groups.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Fact } from '../sim/strategic/narrative/fact-ids.ts';
import { setFact } from '../sim/strategic/narrative/facts.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { QueryService } from './query.ts';
import { Session } from './session.ts';

const SEED = 7;
const DRASSEN_LOYALTY = 50;
const ORDERED_LINES = 3;
const DELIVERY_DAY = { day: 3, hour: 0 };
const ADVANCE_BUDGET = 20;
const LAYOUT_RADIUS = 2;

interface Airport {
  readonly cs: CampaignSession;
  readonly session: Session;
  readonly sector: Sector;
  readonly crate: number;
}

function quiet(cs: CampaignSession, sector: Sector): void {
  Object.assign(sectorInfo(cs.campaign.state.map, sector), { numAdmins: 0, numTroops: 0, numElites: 0 });
}

function holdTheAirport(cs: CampaignSession): { sector: Sector; crate: number } {
  const c = cs.campaign;
  const primary = c.laptop?.content.destinations.find((d) => d.isPrimary);
  if (!primary || primary.deliverySector === null) throw new Error('no Drassen destination');
  const sector = sectorFromId(primary.deliverySector, primary.deliverySectorZ);
  quiet(cs, sector);
  const element = c.state.map.elements[strategicIndex(sector)];
  if (element) element.enemyControlled = false;
  const town = c.state.economy.towns[element?.nameId ?? 0];
  if (town) town.rating = DRASSEN_LOYALTY;
  c.laptop?.surfaceSectorTaken(sector);
  setFact(c.state.narrative, Fact.PABLO_WONT_STEAL, true);
  return { sector, crate: primary.gridNo };
}

function moveSquadTo(cs: CampaignSession, sector: Sector): void {
  const ctx = cs.campaign.strategic;
  if (!ctx) throw new Error('no strategic layer');
  for (const m of cs.campaign.battle?.roster.all() ?? []) {
    const group = getGroup(ctx, m.groupId);
    if (group) setGroupSectorValue(ctx, sector, group);
    m.sector = { x: sector.x, y: sector.y, z: 0 };
  }
}

function orderToDrassen(session: Session): string[] {
  expect(session.dispatch({ type: 'openLaptop' })).toEqual({ ok: true });
  const stock = session.sim.view().laptop?.bobbyRay.newStock.slice(0, ORDERED_LINES) ?? [];
  const destination = session.sim.view().laptop?.bobbyRay.destinations.find((d) => d.primary)?.id;
  const lines = stock.map((l) => ({ item: l.item, quantity: 1 }));
  expect(session.dispatch({ type: 'bobbyRayOrder', lines, destination, speed: 0 })).toMatchObject({ ok: true });
  expect(session.dispatch({ type: 'closeLaptop' })).toEqual({ ok: true });
  return stock.map((l) => l.name).sort();
}

function untilDelivered(session: Session): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ADVANCE_BUDGET && !events.some((e) => e.type === 'shipmentDelivered'); k++)
    events.push(...session.advance({ worldTime: DELIVERY_DAY }).events);
  return events;
}

function itemsAt(session: Session, g: number): string[] {
  return (session.sim.view().items ?? [])
    .filter((i) => i.gridNo === g)
    .map((i) => i.item)
    .sort();
}

function ourMerc(session: Session): number {
  const merc = session.sim.view().soldiers?.find((s) => s.team === Team.OUR);
  if (!merc) throw new Error('no merc in the sector');
  return merc.id;
}

async function query<T>(session: Session, q: Readonly<Record<string, unknown>>): Promise<T> {
  const answer = await session.query({ type: String(q.type), ...q });
  expect(answer.ok, answer.reason).toBe(true);
  return answer.data as T;
}

function layoutCharAt(layout: SectorLayout, g: number): string {
  const row = Math.trunc(g / WORLD_COLS) - Math.trunc(layout.origin / WORLD_COLS);
  const column = (g % WORLD_COLS) - (layout.origin % WORLD_COLS);
  return layout.rows[row]?.[column] ?? ' ';
}

describe.skipIf(!ORIGINAL_DATA_DIR)('a Bobby Ray shipment to Drassen on the original data', () => {
  let data: DataVfs;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));
  const exists = (path: string) => data.vfs.stat(path) !== undefined;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
  });
  afterAll(async () => {
    await data.close();
  });

  async function landedWithTheAirportHeld(): Promise<Airport> {
    const cs = await createCampaignSession(read, exists, SEED, { mercs: 2, land: false }, (p) => data.vfs.layerCount(p));
    quiet(cs, parseSectorString('A9'));
    const session = new Session('bobby-ray-crate', cs);
    session.queries = new QueryService(read, exists);
    expect(await session.prepareAndDispatch({ type: 'compressTime', mode: 2 })).toMatchObject({ ok: true });
    expect(session.dispatch({ type: 'skipHelicopterDrop' })).toMatchObject({ ok: true });
    expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    return { cs, session, ...holdTheAirport(cs) };
  }

  async function enterTheAirport({ cs, session, sector }: Airport): Promise<void> {
    moveSquadTo(cs, sector);
    expect(await session.prepareAndDispatch({ type: 'enterSector', sector: sectorShortString(sector) })).toMatchObject({ ok: true });
    session.advance({ idle: true });
  }

  async function expectFoundOnlyInTheOpenedCrate({ session, crate }: Airport, ordered: readonly string[]): Promise<void> {
    const soldier = ourMerc(session);
    expect(itemsAt(session, crate)).toEqual([]);
    expect(session.dispatch({ type: 'pickUp', soldier, gridNo: crate })).toMatchObject({ ok: true });
    expect(session.advance({ idle: true }).events).toContainEqual(expect.objectContaining({ type: 'nothingFound', gridNo: crate }));
    expect(itemsAt(session, crate)).toEqual([]);
    const layout = await query<SectorLayout>(session, { type: 'sectorLayout', center: crate, radius: LAYOUT_RADIUS });
    expect(layoutCharAt(layout, crate)).toBe('C');
    const preview = await query<PreviewAction>(session, { type: 'previewAction', soldier, gridNo: crate, kind: 'door' });
    expect(preview).toMatchObject({ ok: true, open: false });
    expect(session.dispatch({ type: 'door', soldier, gridNo: crate, action: 'open' })).toMatchObject({ ok: true });
    session.advance({ idle: true });
    expect(itemsAt(session, crate)).toEqual(ordered);
    expect(session.dispatch({ type: 'pickUp', soldier, gridNo: crate })).toMatchObject({ ok: true });
    expect(session.advance({ idle: true }).events).toContainEqual(expect.objectContaining({ type: 'itemsPickedUp', gridNo: crate }));
    expect(itemsAt(session, crate)).toEqual([]);
  }

  it('lies in the closed crate after a delivery to the unloaded airport: the search there finds nothing, door open shows it', async () => {
    const airport = await landedWithTheAirportHeld();
    const ordered = orderToDrassen(airport.session);
    expect(untilDelivered(airport.session)).toContainEqual(expect.objectContaining({ type: 'shipmentDelivered', items: ORDERED_LINES }));
    await enterTheAirport(airport);
    await expectFoundOnlyInTheOpenedCrate(airport, ordered);
  });

  it('lies in the closed crate after a delivery to the loaded airport: the search there finds nothing, door open shows it', async () => {
    const airport = await landedWithTheAirportHeld();
    await enterTheAirport(airport);
    expect(airport.session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    const ordered = orderToDrassen(airport.session);
    expect(untilDelivered(airport.session)).toContainEqual(expect.objectContaining({ type: 'shipmentDelivered', items: ORDERED_LINES }));
    expect(airport.session.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    airport.session.advance({ idle: true });
    await expectFoundOnlyInTheOpenedCrate(airport, ordered);
  });
});

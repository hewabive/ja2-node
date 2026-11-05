import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClientSide, clientSide, expectHintsAgree, type HintSources, serialisedView, withQueries } from '../../tests/support/hints.ts';
import { samplePassHints, sampleStrategicHints } from '../../tests/support/hints-strategic.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { stubCampaignWithOurHummer } from '../../tests/support/vehicles.ts';
import { parseSectorString, strategicIndex } from '../content/strategic/sector-ids.ts';
import { Direction } from '../content/world/grid.ts';
import type { RosterMerc } from '../sim/campaign/roster.ts';
import { exitCheck, flowExitWorld } from '../sim/campaign/sector-exits.ts';
import { assignmentOptionsFor } from '../sim/hints/assignment-options.ts';
import { LAIR_DESTROYED } from '../sim/strategic/creatures/creatures.ts';
import { SKYRIDER, setUpHelicopterForPlayer } from '../sim/strategic/forces/helicopter.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Quest } from '../sim/strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../sim/strategic/narrative/facts.ts';
import { progressFromProfile } from '../sim/tactical/profiles.ts';
import { DIRECTION_EXITGRID } from '../sim/tactical/sector-exit.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { Session } from './session.ts';

let kit: StubSectorKit;
let sources: HintSources;
let client: ClientSide;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  sources = { read: kit.read, exists: (p) => kit.worlds.exists(p), world: (p) => kit.worlds.world(p) };
  client = await clientSide(sources);
});

afterAll(async () => {
  await kit.dispose();
});

const QUIET = ['A9', 'A10', 'B9', 'B10'];
const ROUTE_STEP_SECONDS = 600;

interface Campaign {
  readonly sim: CampaignSession;
  readonly session: Session;
}

async function landedCampaign(seed: number): Promise<Campaign> {
  const sim = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 3, land: false });
  for (const name of QUIET)
    Object.assign(sectorInfo(sim.campaign.state.map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await sim.prepare(land);
  expect(sim.dispatch(land).ok).toBe(true);
  expect(sim.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  const session = withQueries(new Session('strategic-hints', sim), sources);
  return { sim, session };
}

function withHelicopter(c: Campaign): void {
  const campaign = c.sim.campaign;
  const ctx = campaign.strategic;
  if (!ctx) throw new Error('no strategic layer');
  const skyrider = kit.content.profiles[SKYRIDER];
  if (skyrider) campaign.state.profiles.set(SKYRIDER, progressFromProfile(skyrider));
  const a9 = campaign.state.map.elements[strategicIndex(parseSectorString('A9'))];
  if (a9) a9.enemyControlled = false;
  setUpHelicopterForPlayer(ctx, parseSectorString('A9'));
}

describe('strategic cursor hints on a stub campaign, client against server', () => {
  it('agree on the map screen right after landing', async () => {
    const c = await landedCampaign(31);
    withHelicopter(c);
    const view = serialisedView(c.session);
    const report = await expectHintsAgree(c.session, client, sampleStrategicHints(view));
    expect(report.kinds.get('previewRoute')).toBeGreaterThan(0);
    expect(report.kinds.get('moveBoxOptions')).toBeGreaterThan(0);
    expect(report.answered).toBeGreaterThan(20);
  });

  it('agree while the squad travels between sectors', async () => {
    const c = await landedCampaign(32);
    const merc = c.sim.view().strategic?.mercs[0]?.id;
    expect(c.sim.dispatch({ type: 'route', soldier: merc, to: 'A11' })).toMatchObject({ ok: true });
    c.session.advance({ worldSeconds: ROUTE_STEP_SECONDS });
    const view = serialisedView(c.session);
    expect(view.strategic?.groups.some((g) => g.betweenSectors)).toBe(true);
    await expectHintsAgree(c.session, client, sampleStrategicHints(view));
  });

  it('answer like the full state when the player sees everything that matters', async () => {
    const c = await landedCampaign(33);
    const campaign = c.sim.campaign;
    const roster = campaign.battle?.roster;
    const economy = campaign.economy;
    const flow = campaign.sectors;
    if (!roster || !economy || !flow) throw new Error('no campaign layers');
    for (const m of roster.all()) {
      const hint = await c.session.query({ type: 'assignmentOptions', soldier: m.id });
      expect(hint.data, `assignment menu of ${m.id}`).toEqual(JSON.parse(JSON.stringify(assignmentOptionsFor(economy, m))));
      for (const [name, direction] of Object.entries({
        north: Direction.NORTH,
        east: Direction.EAST,
        south: Direction.SOUTH,
        west: Direction.WEST,
      })) {
        const options = await c.session.query({ type: 'exitSectorOptions', soldier: m.id, direction: name });
        const world = flowExitWorld(flow);
        const plan = exitCheck(world, m, direction, 0);
        expect(options.data, `exit ${name} for ${m.id}`).toEqual(
          JSON.parse(
            JSON.stringify({ ...plan.check, menu: plan.menu, enemyInSector: world.enemyInSector, surfaceWarp: world.surfaceWarp() }),
          ),
        );
      }
      expect(DIRECTION_EXITGRID).toBeGreaterThan(Direction.NORTHWEST);
    }
    const merc = roster.all()[0]?.id;
    const preview = await c.session.query({ type: 'previewRoute', soldier: merc, to: 'B11' });
    const routed = c.sim.dispatch({ type: 'route', soldier: merc, to: 'B11' });
    const data = preview.data as { temp: string[]; etaMinutes: number };
    const plotted = routed.data as { path: string[]; etaMinutes: number };
    expect(data.temp.length).toBe(plotted.path.length);
    expect(data.etaMinutes).toBe(plotted.etaMinutes);
  });

  it('count the remaining leg twice and drop the first temporary edge while the squad travels, as the original', async () => {
    const c = await landedCampaign(34);
    const merc = c.sim.view().strategic?.mercs[0]?.id;
    expect(c.sim.dispatch({ type: 'route', soldier: merc, to: 'A12' })).toMatchObject({ ok: true });
    c.session.advance({ worldSeconds: ROUTE_STEP_SECONDS });
    const view = serialisedView(c.session);
    const group = view.strategic?.groups.find((g) => g.members.includes(merc ?? -1));
    expect(group?.betweenSectors).toBe(true);
    expect(group?.path).toEqual(['A10', 'A11', 'A12']);
    const remaining = group?.nextArrivalMinutes ?? 0;
    expect(remaining).toBeGreaterThan(0);
    const preview = (await c.session.query({ type: 'previewRoute', soldier: merc, to: 'A14', extend: true })).data as {
      path: string[];
      temp: string[];
      edgeMinutes: number[];
      etaMinutes: number;
    };
    expect(preview.path).toEqual(['A10', 'A11', 'A12']);
    expect(preview.temp).toEqual(['A12', 'A13', 'A14']);
    const [, elevenToTwelve = 0, twelveToThirteen = 0, thirteenToFourteen = 0] = preview.edgeMinutes;
    expect(preview.etaMinutes).toBe(remaining + elevenToTwelve + remaining + thirteenToFourteen);
    expect(preview.etaMinutes).not.toBe(remaining + elevenToTwelve + twelveToThirteen + thirteenToFourteen);
  });

  it('give the same answers whether or not an enemy group the player has not seen stands on the map', async () => {
    const c = await landedCampaign(35);
    withHelicopter(c);
    const requests = sampleStrategicHints(serialisedView(c.session));
    const before = await Promise.all(requests.map((q) => c.session.query(q)));
    const viewBefore = serialisedView(c.session).strategic;
    Object.assign(sectorInfo(c.sim.campaign.state.map, parseSectorString('J9')), { numTroops: 12, numElites: 4 });
    expect(serialisedView(c.session).strategic).toEqual(viewBefore);
    const after = await Promise.all(requests.map((q) => c.session.query(q)));
    expect(after).toEqual(before);
  });

  it('name the mercs a held item could pass to on the map, and moveItem refuses the others with the same rule', async () => {
    const c = await landedCampaign(37);
    const roster = c.sim.campaign.battle?.roster;
    const [holder, away, near] = roster?.all() ?? [];
    if (!holder || !away || !near) throw new Error('three mercs expected');
    away.sector = parseSectorString('B10');
    const view = serialisedView(c.session);
    await expectHintsAgree(c.session, client, samplePassHints(view));
    const targets = async (request: Record<string, unknown>) =>
      ((await c.session.query({ type: 'passTargets', ...request })).data as { mercs: number[] }).mercs;
    expect(await targets({ soldier: holder.id })).toEqual(expect.arrayContaining([holder.id, near.id]));
    expect(await targets({ soldier: holder.id })).not.toContain(away.id);
    expect(await targets({ soldier: away.id })).toEqual([away.id]);
    expect(await targets({ sector: 'B10' })).toEqual([away.id]);
    const pocket = view.strategic?.mercs.find((m) => m.id === holder.id)?.inventory?.[0];
    if (!pocket) throw new Error('the holder carries nothing');
    const pass = (to: number) => ({ type: 'moveItem', soldier: holder.id, from: pocket.slot, toSoldier: to, to: pocket.slot });
    expect(c.sim.dispatch(pass(away.id))).toMatchObject({ ok: false, data: { refusal: 'otherSector' } });
    expect(await c.session.query({ type: 'passTargets', soldier: 999 })).toMatchObject({ ok: false, data: { refusal: 'noSuchMerc' } });
    expect(await c.session.query({ type: 'passTargets' })).toMatchObject({ ok: false, data: { refusal: 'badSource' } });
  });

  it('refuse a route as too tired like the command, for a merc awake below 30 and for a sleeper beyond waking', async () => {
    const c = await landedCampaign(36);
    const roster = c.sim.campaign.battle?.roster;
    const [tired, collapsed, fit] = roster?.all() ?? [];
    if (!tired || !collapsed || !fit) throw new Error('three mercs expected');
    tired.breathMax = 29;
    Object.assign(collapsed, { breathMax: 40, asleep: true, collapsed: true });
    const view = serialisedView(c.session);
    await expectHintsAgree(c.session, client, sampleStrategicHints(view));
    for (const m of [tired, collapsed]) {
      const preview = await c.session.query({ type: 'previewRoute', soldier: m.id, to: 'B11', alone: true });
      expect(preview).toMatchObject({ ok: false, data: { refusal: 'tooTired', soldier: m.id } });
    }
    const squad = await c.session.query({ type: 'previewRoute', soldier: fit.id, to: 'B11' });
    const routed = c.sim.dispatch({ type: 'route', soldier: fit.id, to: 'B11' });
    expect(squad).toMatchObject({ ok: false, data: { refusal: 'tooTired', soldier: tired.id } });
    expect(routed).toMatchObject({ ok: false, data: { refusal: 'tooTired', soldier: tired.id } });
  });
});

describe('a vehicle of ours, client against server', () => {
  async function withOurHummer(seed: number): Promise<Campaign & { readonly hummer: RosterMerc }> {
    const sim = await stubCampaignWithOurHummer(kit, seed);
    const hummer = sim.campaign.battle?.roster.all().find((m) => m.isVehicle);
    if (!hummer) throw new Error('no vehicle of ours');
    return { sim, session: withQueries(new Session('vehicle-hints', sim), sources), hummer };
  }

  it('refuse the route of a vehicle with an empty tank, and of its passengers through it, like the command (ME_VEHICLE_NO_GAS, quirk)', async () => {
    const c = await withOurHummer(38);
    Object.assign(c.hummer.soldier, { breathRed: 0, breath: 0 });
    const view = serialisedView(c.session);
    await expectHintsAgree(c.session, client, sampleStrategicHints(view));
    const passengers = view.strategic?.mercs.filter((m) => m.vehicle === c.hummer.vehicleId).map((m) => m.id) ?? [];
    expect(passengers).toContain(c.hummer.id);
    expect(passengers.length).toBeGreaterThan(1);
    const refused = { ok: false, data: { refusal: 'vehicleNoGas', soldier: c.hummer.id } };
    for (const soldier of passengers) {
      expect(await c.session.query({ type: 'previewRoute', soldier, to: 'B10' }), `hint for ${soldier}`).toMatchObject(refused);
      expect(c.sim.dispatch({ type: 'route', soldier, to: 'B10' }), `route for ${soldier}`).toMatchObject(refused);
    }
  });
});

describe('the warp out of a destroyed creature lair, client against server', () => {
  const LAIR_ENTRANCE = { x: 13, y: 7, z: 2 };
  const CAVE_LADDER = 64 * 160 + 74;

  it('names the surface sector in the view, the exit options and the dry run', async () => {
    const c = await landedCampaign(34);
    const campaign = c.sim.campaign;
    const roster = campaign.battle?.roster;
    if (!roster) throw new Error('no roster');
    campaign.state.creatures.lairId = LAIR_DESTROYED;
    campaign.state.creatures.destroyedLairId = 1;
    campaign.state.narrative.quests[Quest.CREATURES] = QuestStatus.DONE;
    for (const m of roster.all()) m.sector = { ...LAIR_ENTRANCE };
    for (const g of campaign.state.forces.groups) if (g.player) g.sector = { ...LAIR_ENTRANCE };
    const flow = campaign.sectors;
    if (!flow) throw new Error('no sector flow');
    await c.sim.prepareMaps([flow.mapPathOf(LAIR_ENTRANCE)]);
    expect(flow.setCurrentWorldSector(LAIR_ENTRANCE)).toBe(true);
    const soldier = roster.all()[0]?.id;
    const where = { soldier, exitGrid: CAVE_LADDER };
    expect(serialisedView(c.session).strategic?.surfaceWarp).toBe('D13');
    expect((await c.session.query({ type: 'exitSectorOptions', ...where })).data).toMatchObject({ surfaceWarp: 'D13' });
    const dryRun = await c.session.query({ type: 'exitSector', ...where, warp: true, dryRun: true });
    expect(dryRun.data).toEqual({ warp: true, target: 'D13', level: 0 });
    await expectHintsAgree(c.session, client, [
      { type: 'exitSectorOptions', ...where },
      { type: 'exitSector', ...where, warp: true, dryRun: true },
    ]);
  });
});

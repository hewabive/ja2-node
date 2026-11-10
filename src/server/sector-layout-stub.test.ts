import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10 } from '../../tests/support/a10-campaign.ts';
import { type ClientSide, clientSide, expectHintsAgree, type HintSources, serialisedView, withQueries } from '../../tests/support/hints.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { gridNo, WORLD_COLS } from '../content/world/grid.ts';
import { skipHelicopterDropOf } from '../sim/campaign/helicopter-drop-flow.ts';
import type { SectorLayout } from '../sim/hints/sector-layout.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { restoreFogOfWar } from '../sim/tactical/perception/fov.ts';
import { Team } from '../sim/tactical/soldier.ts';
import type { TacticalState } from '../sim/tactical/state.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { createSandboxSession } from './sandbox.ts';
import { Session } from './session.ts';

const A10_STAIRS = 11432;
const A10_BUILDING = gridNo(71, 71);
const A10_BUILDING_RADIUS = 5;
const A9_POND = gridNo(86, 69);
const MAX_SECTOR_BYTES = 2500;

const A10_BUILDING_UNSEEN = [
  '...........',
  '...........',
  '...........',
  '...RRRRR|..',
  '...RRRRR...',
  '...RRRRR...',
  '...RRRRR...',
  '...|.......',
];

const A10_BUILDING_SEEN = [
  '...........',
  '...........',
  '...........',
  '...||||||..',
  '...|.......',
  '...|..E....',
  '...|.......',
  '...|.......',
];

const A10_BUILDING_ROOF = ['-----------', '-----------', '-----------', '---^^^^^---', '---^^^^^---', '---^^^^^---', '---^^^^^---'];

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

async function landedInA9(seed: number) {
  const sim = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 3, land: false });
  Object.assign(sectorInfo(sim.campaign.state.map, parseSectorString('A9')), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await sim.prepare(land);
  expect(sim.dispatch(land).ok).toBe(true);
  skipHelicopterDropOf(sim.campaign);
  return withQueries(new Session('sector-layout', sim), sources);
}

async function layoutOf(session: Session, request: Record<string, unknown> = {}): Promise<SectorLayout> {
  const answer = await session.query({ type: 'sectorLayout', ...request });
  expect(answer.ok, answer.reason).toBe(true);
  return answer.data as SectorLayout;
}

function charAt(layout: SectorLayout, g: number): string {
  const row = Math.trunc((Math.trunc(g / WORLD_COLS) - Math.trunc(layout.origin / WORLD_COLS)) / layout.cell);
  const column = Math.trunc(((g % WORLD_COLS) - (layout.origin % WORLD_COLS)) / layout.cell);
  return layout.rows[row]?.[column] ?? ' ';
}

function tacticalStateOf(session: Session): TacticalState {
  const t = (session.sim as unknown as { campaign: { tactical: { state: TacticalState } | null } }).campaign.tactical?.state;
  if (!t) throw new Error('no tactical sector');
  return t;
}

function concealRoomOf(t: TacticalState, g: number): void {
  const room = t.world.level.rooms[g] ?? 0;
  const revealed = t.fog.revealed.map((flags, tile) => ((t.world.level.rooms[tile] ?? 0) === room ? 0 : flags));
  const roomHidden = t.fog.roomHidden.map((hidden, r) => (r === room ? 1 : hidden));
  restoreFogOfWar(t, revealed, roomHidden);
}

describe('sectorLayout on the stub campaign', () => {
  it('draws a room no merc has seen into as its roof alone, and its walls, floor and stairs once it is revealed', async () => {
    const a10 = await campaignInA10(kit, 32);
    const session = withQueries(a10.session, sources);
    const t = tacticalStateOf(session);
    const seen = [...t.fog.revealed];
    const window = { center: A10_BUILDING, radius: A10_BUILDING_RADIUS };
    concealRoomOf(t, A10_STAIRS);
    const unseen = await layoutOf(session, window);
    expect(unseen.rows.slice(0, A10_BUILDING_UNSEEN.length)).toEqual(A10_BUILDING_UNSEEN);
    expect(charAt(unseen, A10_STAIRS)).toBe('R');
    restoreFogOfWar(
      t,
      Uint8Array.from(seen),
      t.fog.roomHidden.map(() => 0),
    );
    const revealed = await layoutOf(session, window);
    expect(revealed.rows.slice(0, A10_BUILDING_SEEN.length)).toEqual(A10_BUILDING_SEEN);
    expect(charAt(revealed, A10_STAIRS)).toBe('E');
  });

  it("shows on the roof level every roof a merc can stand on, revealed or not, as the original's roof view draws them all", async () => {
    const a10 = await campaignInA10(kit, 32);
    const session = withQueries(a10.session, sources);
    const window = { level: 1, center: A10_BUILDING, radius: A10_BUILDING_RADIUS };
    const before = await layoutOf(session, window);
    concealRoomOf(tacticalStateOf(session), A10_STAIRS);
    const after = await layoutOf(session, window);
    expect(before.rows.slice(0, A10_BUILDING_ROOF.length)).toEqual(A10_BUILDING_ROOF);
    expect(after.rows).toEqual(before.rows);
    expect(after.mercs).toEqual([]);
  });

  it('fits the whole sector in a few KB at cells of 4 tiles, with our mercs and the water where the cell corners put them', async () => {
    const session = await landedInA9(31);
    const layout = await layoutOf(session);
    expect(layout).toMatchObject({ sector: 'A9', level: 0, cell: 4 });
    expect(JSON.stringify(layout).length).toBeLessThan(MAX_SECTOR_BYTES);
    const ours = serialisedView(session).soldiers.filter((s) => s.team === Team.OUR);
    expect(layout.mercs.map((m) => m.soldier).toSorted()).toEqual(ours.map((s) => s.id).toSorted());
    for (const m of layout.mercs) expect(charAt(layout, m.gridNo)).toBe('@');
    expect(charAt(layout, A9_POND)).toBe('~');
    expect(layout.rows.every((row) => row.length <= Math.ceil(WORLD_COLS / layout.cell))).toBe(true);
  });

  it('answers the same on the client and the server, reading nothing the view does not supply', async () => {
    const session = await landedInA9(33);
    const merc = serialisedView(session).soldiers.find((s) => s.team === Team.OUR);
    await expectHintsAgree(session, client, [
      { type: 'sectorLayout' },
      { type: 'sectorLayout', cell: 2 },
      { type: 'sectorLayout', level: 1 },
      { type: 'sectorLayout', center: merc?.gridNo, radius: 8 },
    ]);
  });

  it('draws the sandbox too, which has no sector name, and refuses a cell or level it does not have', async () => {
    const session = withQueries(new Session('sandbox-layout', await createSandboxSession(kit.read, false, 1)), sources);
    expect(await layoutOf(session)).toMatchObject({ sector: null, cell: 4 });
    expect(await session.query({ type: 'sectorLayout', cell: 9 })).toMatchObject({ ok: false, data: { refusal: 'badCell' } });
    expect(await session.query({ type: 'sectorLayout', level: 2 })).toMatchObject({ ok: false, data: { refusal: 'badLevel' } });
  });
});

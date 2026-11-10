import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10 } from '../../tests/support/a10-campaign.ts';
import { spawnSoldier } from '../../tests/support/combat.ts';
import { type ClientSide, clientSide, expectHintsAgree, type HintSources, serialisedView, withQueries } from '../../tests/support/hints.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { Direction, WORLD_COLS, WORLD_MAX } from '../content/world/grid.ts';
import { skipHelicopterDropOf } from '../sim/campaign/helicopter-drop-flow.ts';
import type { EdgeExit, ExitBand, SectorExits } from '../sim/hints/sector-exits.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { markGroundRevealed, restoreFogOfWar } from '../sim/tactical/perception/fov.ts';
import { atExitEdge, ExitDirection } from '../sim/tactical/sector-exit.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { onVisibleWorldTile, type TacticalState } from '../sim/tactical/state.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { createSandboxSession } from './sandbox.ts';
import { Session } from './session.ts';

const A10_STAIRS = 11432;
const UNSEEN_ENEMY = 20;
const EXIT_DIRECTIONS = { north: ExitDirection.NORTH, east: ExitDirection.EAST, south: ExitDirection.SOUTH, west: ExitDirection.WEST };

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
  return { sim, session: withQueries(new Session('sector-exits', sim), sources) };
}

async function exitsOf(session: Session, soldier?: number): Promise<SectorExits> {
  const answer = await session.query({ type: 'sectorExits', ...(soldier === undefined ? {} : { soldier }) });
  expect(answer.ok, answer.reason).toBe(true);
  return answer.data as SectorExits;
}

function edgeOf(exits: SectorExits, edge: EdgeExit['edge']): EdgeExit {
  const found = exits.edges.find((e) => e.edge === edge);
  if (!found) throw new Error(`no ${edge} edge`);
  return found;
}

function inBand(band: ExitBand, g: number): boolean {
  const v = band.of === 'x-y' ? (g % WORLD_COLS) - Math.trunc(g / WORLD_COLS) : (g % WORLD_COLS) + Math.trunc(g / WORLD_COLS);
  return band.min !== undefined ? v >= band.min : v <= (band.max ?? Number.NaN);
}

function tacticalStateOf(session: Session): TacticalState {
  const t = (session.sim as unknown as { campaign: { tactical: { state: TacticalState } | null } }).campaign.tactical?.state;
  if (!t) throw new Error('no tactical sector');
  return t;
}

describe('sectorExits on the stub campaign', () => {
  it("names each edge's sector, travel time and the exit arrow's answer for the selected merc, A9's north edge off the map", async () => {
    const { session } = await landedInA9(31);
    const exits = await exitsOf(session);
    expect(exits).toMatchObject({ sector: 'A9', level: 0, soldier: serialisedView(session).selected });
    expect(edgeOf(exits, 'north')).toMatchObject({ to: null, minutes: null, exit: 'invalidTraversal', walkTo: {} });
    expect(edgeOf(exits, 'east')).toMatchObject({ to: 'A10', minutes: 5, exit: 'tooFar', inBand: [] });
    expect(edgeOf(exits, 'south')).toMatchObject({ to: 'B9', exit: 'tooFar' });
    expect(edgeOf(exits, 'west')).toMatchObject({ to: 'A8', exit: 'tooFar' });
    expect(exits.exitGrids).toEqual([]);
  });

  it('describes as its band exactly the visible tiles the exit check counts as standing at that edge', async () => {
    const { session } = await landedInA9(31);
    const exits = await exitsOf(session);
    const t = tacticalStateOf(session);
    for (const e of exits.edges) {
      const direction = EXIT_DIRECTIONS[e.edge];
      for (let g = 0; g < WORLD_MAX; g++) {
        if (!onVisibleWorldTile(t, g)) continue;
        if (inBand(e.band, g) !== atExitEdge(t, g, direction)) throw new Error(`${e.edge} band ${JSON.stringify(e.band)} at ${g}`);
      }
    }
    expect(edgeOf(exits, 'east').band).toEqual({ of: 'x-y', min: 72 });
  });

  it('walks every merc of the squad to a band tile of his own, after which the whole squad can leave by that edge', async () => {
    const { sim, session } = await landedInA9(32);
    const before = edgeOf(await exitsOf(session), 'east');
    const targets = Object.entries(before.walkTo);
    expect(targets.length).toBe(3);
    expect(new Set(targets.map(([, g]) => g)).size).toBe(targets.length);
    for (const [, g] of targets) expect(inBand(before.band, g)).toBe(true);
    for (const [soldier, to] of targets) expect(sim.dispatch({ type: 'move', soldier: Number(soldier), to, mode: 'run' }).ok).toBe(true);
    session.advance({ idle: true });
    const after = edgeOf(await exitsOf(session), 'east');
    expect(after).toMatchObject({ exit: 'ok', walkTo: {} });
    expect(after.inBand.toSorted()).toEqual(targets.map(([id]) => Number(id)).toSorted());
    const selected = serialisedView(session).selected;
    const leave = await session.query({ type: 'exitSector', soldier: selected, direction: 'east', who: 'squad', dryRun: true });
    expect(leave).toMatchObject({ ok: true, data: { who: 'squad', target: 'A10' } });
  });

  it('gives a merc the next nearest band tile when a mate takes his nearest one', async () => {
    const { sim, session } = await landedInA9(35);
    const ahead = { soldier: 0, to: 75 * WORLD_COLS + 146 };
    const behind = { soldier: 1, to: 75 * WORLD_COLS + 145 };
    for (const order of [ahead, behind]) expect(sim.dispatch({ type: 'move', ...order, mode: 'run' }).ok).toBe(true);
    session.advance({ idle: true });
    const east = edgeOf(await exitsOf(session), 'east');
    expect(east.inBand).toEqual([]);
    expect(east.walkTo[ahead.soldier]).toBe(74 * WORLD_COLS + 146);
    expect(east.walkTo[behind.soldier]).not.toBe(east.walkTo[ahead.soldier]);
    expect(inBand(east.band, east.walkTo[behind.soldier] ?? -1)).toBe(true);
  });

  it('answers the same on the client and the server, reading nothing the view does not supply', async () => {
    const { session } = await landedInA9(33);
    const view = serialisedView(session);
    const ours = view.soldiers.filter((s) => s.team === Team.OUR).map((s) => s.id);
    await expectHintsAgree(session, client, [{ type: 'sectorExits' }, ...ours.map((soldier) => ({ type: 'sectorExits', soldier }))]);
  });

  it('gives the same answer whether or not an unseen enemy stands on a walk tile', async () => {
    const { sim, session } = await landedInA9(34);
    const before = await exitsOf(session);
    const [, walkTile] = Object.entries(edgeOf(before, 'east').walkTo)[0] ?? [];
    const tactical = sim.campaign.tactical;
    if (walkTile === undefined || !tactical) throw new Error('no walk tile');
    spawnSoldier(tactical, UNSEEN_ENEMY, Team.ENEMY, walkTile, Direction.WEST);
    expect(serialisedView(session).soldiers.some((s) => s.id === UNSEEN_ENEMY)).toBe(false);
    expect(await exitsOf(session)).toEqual(before);
  });

  it('lists an exit grid inside a room only once its tile is revealed, as the exit grid cursor shows there no sooner', async () => {
    const a10 = await campaignInA10(kit, 32);
    const session = withQueries(a10.session, sources);
    const t = tacticalStateOf(session);
    const room = t.world.level.rooms[A10_STAIRS] ?? 0;
    expect(room).not.toBe(0);
    const revealed = t.fog.revealed.map((flags, g) => ((t.world.level.rooms[g] ?? 0) === room ? 0 : flags));
    const roomHidden = t.fog.roomHidden.map((hidden, r) => (r === room ? 1 : hidden));
    restoreFogOfWar(t, revealed, roomHidden);
    expect(t.world.exitGrids.has(A10_STAIRS)).toBe(true);
    expect((await exitsOf(session)).exitGrids).toEqual([]);
    markGroundRevealed(t, A10_STAIRS);
    expect((await exitsOf(session)).exitGrids).toEqual([{ to: 'A10', level: 1, gridNos: [A10_STAIRS], exit: 'ok' }]);
  });

  it('is refused in the sandbox, which has no sector to leave', async () => {
    const session = withQueries(new Session('sandbox-exits', await createSandboxSession(kit.read, false, 1)), sources);
    expect(await session.query({ type: 'sectorExits' })).toMatchObject({ ok: false, data: { refusal: 'noSector' } });
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10 } from '../../tests/support/a10-campaign.ts';
import {
  type ClientSide,
  clientAnswer,
  clientSide,
  expectHintsAgree,
  type HintSources,
  sampleAttackHints,
  sampleMoveHints,
  serialisedView,
  withQueries,
} from '../../tests/support/hints.ts';
import { approachUntilCombat, BATTLE_SANDBOX_SEED, tacticalOf, untilOurTurn } from '../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { sessionAdapter, stubSessionSources } from '../../tests/support/session-reload.ts';
import { ViewMirror } from '../../tests/support/view-mirror.ts';
import { DIRECTION_INCREMENT } from '../content/world/grid.ts';
import { Npc } from '../sim/strategic/narrative/npc-ids.ts';
import { MineFlag, setMineFlag } from '../sim/tactical/bombs/mine-flags.ts';
import { NpcActionCode } from '../sim/tactical/narrative/npc-actions/codes.ts';
import { findBestPath } from '../sim/tactical/pathfinding.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
import { createSandboxSession } from './sandbox.ts';
import { Session } from './session.ts';

const MINE_STEPS = 2;

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

async function sandbox(seed: number): Promise<Session> {
  return withQueries(new Session('hints', await createSandboxSession(kit.read, false, seed)), sources);
}

describe('cursor hints on the stub sandbox, client against server', () => {
  it('agree on the move preview in real time', async () => {
    const session = await sandbox(1);
    const report = await expectHintsAgree(session, client, sampleMoveHints(serialisedView(session)));
    expect(report.answered).toBeGreaterThan(50);
  });

  it('agree on a move preview past a known mine, which the hint walks around as the order does (knownMines)', async () => {
    const session = await sandbox(1);
    const t = tacticalOf(session).state;
    const merc = teamMembers(t, Team.OUR)[0];
    if (!merc) throw new Error('no merc');
    const to = merc.gridNo + MINE_STEPS * 2;
    const mined = merc.gridNo + MINE_STEPS;
    const tilesOf = (steps: readonly number[]) =>
      steps.map((_, k) => steps.slice(0, k + 1).reduce((g, d) => g + (DIRECTION_INCREMENT[d] ?? 0), merc.gridNo));
    expect(tilesOf(findBestPath(t.pathEnv, merc, to, merc.level).steps)).toContain(mined);
    setMineFlag(t, mined, MineFlag.PLAYER);
    const view = serialisedView(session);
    expect(view.knownMines).toEqual([mined]);
    const query = { type: 'previewMove', soldier: merc.id, to } as const;
    await expectHintsAgree(session, client, [query]);
    const hint = (await session.query(query)).data as { steps: readonly { gridNo: number }[] };
    const ordered = tilesOf(findBestPath(t.pathEnv, merc, to, merc.level).steps);
    expect(ordered).not.toContain(mined);
    expect(hint.steps.map((s) => s.gridNo)).toEqual(ordered.slice(0, -1));
  });

  it('agree on the move preview and the attack estimate in a turn-based battle', async () => {
    const session = await sandbox(BATTLE_SANDBOX_SEED);
    approachUntilCombat(session, true);
    untilOurTurn(session);
    const view = serialisedView(session);
    expect(view.combat).toBeTruthy();
    expect(view.soldiers.some((s) => s.team !== 0)).toBe(true);
    const report = await expectHintsAgree(session, client, [...sampleMoveHints(view), ...sampleAttackHints(view)]);
    expect(report.kinds.get('estimateAttack')).toBeGreaterThan(0);
  });
});

describe('cursor hints over an exit grid added while the sector ran, client against server', () => {
  const TRAPDOOR = 7887;

  it("lead down the rebels' trapdoor once the squad is back up from the hideout, in the frames, the full view and after a reload", async () => {
    const a10 = await campaignInA10(kit, 32);
    const session = withQueries(a10.session, sources);
    const mirror = new ViewMirror(session);
    await a10.campaign.prepare({ type: 'talk' });
    const actions = a10.campaign.campaign.talk?.npcActions;
    if (!actions) throw new Error('no NPC actions');
    actions.handle(Npc.FATIMA, NpcActionCode.GOTO_HIDEOUT, 0);
    actions.handle(Npc.FATIMA, NpcActionCode.LEAVE_HIDEOUT, 0);
    session.advance({ idle: true });
    expect(mirror.frames).toBeGreaterThan(0);
    mirror.expectMatches(session);
    const view = serialisedView(session);
    expect(view.addedExitGrids).toEqual([{ gridNo: TRAPDOOR, sector: 'A10-1' }]);
    const soldier = view.selected;
    const queries = [
      { type: 'exitSector', soldier, exitGrid: TRAPDOOR, dryRun: true },
      { type: 'exitSectorOptions', soldier, exitGrid: TRAPDOOR },
    ];
    await expectHintsAgree(session, client, queries);
    const [cursor, box] = queries.map((q) => clientAnswer(client, view, q));
    expect(cursor).toMatchObject({ ok: true, data: { target: 'A10', level: 1 } });
    expect(box).toMatchObject({ ok: true, data: { menu: { allMove: true } } });
    const adapter = sessionAdapter(stubSessionSources(kit));
    const reloaded = adapter.restore(adapter.snapshot(a10.campaign), a10.campaign);
    expect(reloaded.view().addedExitGrids).toEqual(view.addedExitGrids);
  });
});

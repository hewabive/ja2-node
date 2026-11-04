import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ClientSide,
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
import { DIRECTION_INCREMENT } from '../content/world/grid.ts';
import { MineFlag, setMineFlag } from '../sim/tactical/bombs/mine-flags.ts';
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

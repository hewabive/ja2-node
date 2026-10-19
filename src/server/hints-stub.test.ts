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
import { approachUntilCombat, BATTLE_SANDBOX_SEED, untilOurTurn } from '../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { createSandboxSession } from './sandbox.ts';
import { Session } from './session.ts';

const SLOW_MS = 60_000;

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
  it(
    'agree on the move preview in real time',
    async () => {
      const session = await sandbox(1);
      const report = await expectHintsAgree(session, client, sampleMoveHints(serialisedView(session)));
      expect(report.answered).toBeGreaterThan(50);
    },
    SLOW_MS,
  );

  it(
    'agree on the move preview and the attack estimate in a turn-based battle',
    async () => {
      const session = await sandbox(BATTLE_SANDBOX_SEED);
      approachUntilCombat(session, true);
      untilOurTurn(session);
      const view = serialisedView(session);
      expect(view.combat).toBeTruthy();
      expect(view.soldiers.some((s) => s.team !== 0)).toBe(true);
      const report = await expectHintsAgree(session, client, [...sampleMoveHints(view), ...sampleAttackHints(view)]);
      expect(report.kinds.get('estimateAttack')).toBeGreaterThan(0);
    },
    SLOW_MS,
  );
});

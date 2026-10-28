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
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { approachUntilCombat, BATTLE_SANDBOX_SEED, untilOurTurn } from '../../tests/support/save-scenarios.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { buildTacticalWorldFromInputs, loadTacticalWorldInputs } from '../content/world/tactical-world.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { createSandboxSession, ORIGINAL_SANDBOX_MAP } from './sandbox.ts';
import { Session } from './session.ts';

describe.skipIf(!ORIGINAL_DATA_DIR)('cursor hints on the original data, client against server', () => {
  let data: DataVfs;
  let sources: HintSources;
  let client: ClientSide;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    const a9 = await loadTacticalWorldInputs(read, ORIGINAL_SANDBOX_MAP);
    sources = {
      read,
      exists: (path) => data.vfs.stat(path) !== undefined,
      world: (path) => (path === ORIGINAL_SANDBOX_MAP ? buildTacticalWorldFromInputs(a9) : null),
    };
    client = await clientSide(sources);
  });

  afterAll(async () => {
    await data.close();
  });

  async function sandbox(seed: number): Promise<Session> {
    return withQueries(new Session('hints', await createSandboxSession(read, true, seed)), sources);
  }

  it('agree on the move preview on A9 in real time', async () => {
    const session = await sandbox(1);
    const report = await expectHintsAgree(session, client, sampleMoveHints(serialisedView(session), { radius: 20, step: 4 }));
    expect(report.answered).toBeGreaterThan(100);
  });

  it('agree on the move preview and the attack estimate in a battle on A9', async () => {
    const session = await sandbox(BATTLE_SANDBOX_SEED);
    approachUntilCombat(session, true);
    untilOurTurn(session);
    const view = serialisedView(session);
    const report = await expectHintsAgree(session, client, [...sampleMoveHints(view, { radius: 16, step: 4 }), ...sampleAttackHints(view)]);
    expect(report.kinds.get('estimateAttack')).toBeGreaterThan(0);
  });
});

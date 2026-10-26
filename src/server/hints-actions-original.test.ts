import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClientSide, clientSide, expectHintsAgree, type HintSources, serialisedView, withQueries } from '../../tests/support/hints.ts';
import { doorTiles, kitForHints, sampleActionHints, sampleInventoryHints } from '../../tests/support/hints-actions.ts';
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { approachUntilCombat, BATTLE_SANDBOX_SEED, tacticalOf, untilOurTurn } from '../../tests/support/save-scenarios.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { buildTacticalWorldFromInputs, loadTacticalWorldInputs } from '../content/world/tactical-world.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
import { createSandboxSession, ORIGINAL_SANDBOX_MAP } from './sandbox.ts';
import { Session } from './session.ts';

const SLOW_MS = 240_000;
const ITEM_SPREAD_STEP = 5;
const NEAREST_DOORS = 10;

describe.skipIf(!ORIGINAL_DATA_DIR)('action and inventory hints on the original data, client against server', () => {
  let data: DataVfs;
  let sources: HintSources;
  let client: ClientSide;
  let doors: number[] = [];
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    const a9 = await loadTacticalWorldInputs(read, ORIGINAL_SANDBOX_MAP);
    sources = {
      read,
      exists: (path) => data.vfs.stat(path) !== undefined,
      world: (path) => (path === ORIGINAL_SANDBOX_MAP ? buildTacticalWorldFromInputs(a9) : null),
    };
    doors = doorTiles(buildTacticalWorldFromInputs(a9));
    client = await clientSide(sources);
  }, SLOW_MS);

  afterAll(async () => {
    await data.close();
  });

  async function sandbox(seed: number): Promise<Session> {
    return withQueries(new Session('hints', await createSandboxSession(read, true, seed)), sources);
  }

  function kitSquad(session: Session): void {
    const t = tacticalOf(session).state;
    kitForHints(teamMembers(t, Team.OUR), t.content.items);
  }

  function itemSpread(): number[] {
    return client.content.items.ordered.filter((_, k) => k % ITEM_SPREAD_STEP === 0).map((d) => d.index);
  }

  it(
    'agree on A9 in real time, doors and a spread of the item table included',
    async () => {
      const session = await sandbox(1);
      kitSquad(session);
      const view = serialisedView(session);
      expect(doors.length).toBeGreaterThan(0);
      const report = await expectHintsAgree(session, client, [
        ...sampleActionHints(view, { doors, nearestDoors: NEAREST_DOORS }),
        ...sampleInventoryHints(view, itemSpread()),
      ]);
      expect(report.answered).toBeGreaterThan(100);
    },
    SLOW_MS,
  );

  it(
    'agree in a battle on A9',
    async () => {
      const session = await sandbox(BATTLE_SANDBOX_SEED);
      approachUntilCombat(session, true);
      untilOurTurn(session);
      kitSquad(session);
      const view = serialisedView(session);
      const report = await expectHintsAgree(session, client, [...sampleActionHints(view, { doors }), ...sampleInventoryHints(view)]);
      expect(report.kinds.get('previewAction')).toBeGreaterThan(0);
    },
    SLOW_MS,
  );
});

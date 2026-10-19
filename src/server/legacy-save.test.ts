import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { Team } from '../sim/tactical/soldier.ts';
import type { Session } from './session.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const LEGACY_VERSION = '0.7.0';
const STEP_SOUTH = 320;
const TICKS_BEFORE_MOVE = 200;
const TICKS_AFTER_MOVE = 200;
const TEST_TIMEOUT_MS = 120_000;

interface SoldierSummary {
  readonly id: number;
  readonly gridNo: number;
  readonly animation: number;
  readonly frame: number;
  readonly direction: number;
  readonly life?: number | undefined;
  readonly ap?: number | undefined;
}

interface ExpectedRun {
  readonly atSave: readonly SoldierSummary[];
  readonly afterLoad: readonly SoldierSummary[];
  readonly after400: readonly SoldierSummary[];
  readonly tick: number;
}

function soldiers(session: Session): SoldierSummary[] {
  return session.sim.view().soldiers.map((s) => ({
    id: s.id,
    gridNo: s.gridNo,
    animation: s.animation,
    frame: s.frame,
    direction: s.direction,
    life: s.life,
    ap: s.ap,
  }));
}

function moveSquad(session: Session): void {
  for (const merc of session.sim.view().soldiers.filter((s) => s.team === Team.OUR))
    session.dispatch({ type: 'move', soldier: merc.id, to: merc.gridNo + STEP_SOUTH, mode: 'run' });
}

let kit: StubSectorKit;
let saves: SaveKit;
let expected: Readonly<Record<string, ExpectedRun>>;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  saves = await createSaveKit(kit);
  expected = JSON.parse(await readFile(join(FIXTURES, `expected-${LEGACY_VERSION}.json`), 'utf8')) as Record<string, ExpectedRun>;
  for (const name of Object.keys(expected)) await copyFile(join(FIXTURES, `${name}-${LEGACY_VERSION}.j2s`), join(saves.dir, `${name}.j2s`));
});

afterAll(async () => {
  await saves.dispose();
  await kit.dispose();
});

describe(`saves written by ${LEGACY_VERSION} on the stub pack`, () => {
  for (const name of ['campaign', 'sandbox']) {
    it(
      `loads the ${name} save exactly and continues as ${LEGACY_VERSION} did`,
      async () => {
        const run = expected[name];
        if (!run) throw new Error(`no expected run for ${name}`);
        const session = await saves.open({ load: name, reseed: false });
        expect(soldiers(session)).toEqual(run.afterLoad);
        expect(run.afterLoad).toEqual(run.atSave);
        session.advance({ ticks: TICKS_BEFORE_MOVE });
        moveSquad(session);
        session.advance({ ticks: TICKS_AFTER_MOVE });
        expect(soldiers(session)).toEqual(run.after400);
        expect(session.sim.tick).toBe(run.tick);
        const resaved = await saves.saves.save(session, { name: `${name}-again` });
        expect(resaved).toMatchObject({ ok: true, header: { content: { source: 'stubs', logic: saves.pack.hash } } });
        const again = await saves.open({ load: `${name}-again`, reseed: false });
        expect(soldiers(again)).toEqual(run.after400);
      },
      TEST_TIMEOUT_MS,
    );
  }
});

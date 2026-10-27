import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { type AnimationTables, AnimFlags, stateId } from '../content/anim/tables.ts';
import { STUB_ANIMATION_SCRIPTS_PATH } from '../content/anim/timelines.ts';
import { MAX_FRAMES_PER_ANIM, parseAnimationScripts, writeAnimationScripts } from '../content/formats/ja2bin.ts';
import { parseTilesetDatabase, writeTilesetDatabase } from '../content/formats/ja2set.ts';
import { STUBS_LAYER } from '../content/vfs/layers.ts';
import { MemoryLayer, Vfs } from '../content/vfs/vfs.ts';
import { Team } from '../sim/tactical/soldier.ts';
import type { Session } from './session.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const LEGACY_VERSION = '0.7.0';
const STEP_SOUTH = 320;
const TICKS_BEFORE_MOVE = 200;
const TICKS_AFTER_MOVE = 200;
const TEST_TIMEOUT_MS = 120_000;
const RECORDED_STUB_FILE = 'stubs/npcdata/000.npc';
const STUB_PROFILES_FILE = 'stubs/profiles.json';
const FACE_OFFSETS_ADDED_AFTER_070 = /\n {6}"face": \{\n[^}]*\n {6}\},/g;
const STUB_TILESETS_FILE = 'stubs/world/binarydata/ja2set.dat';
const SURFACES_ADDED_AFTER_070 = new Set([
  'bullet.sprite.json',
  'miss.sprite.json',
  'watermiss.sprite.json',
  'ripple.sprite.json',
  'glassshatter.sprite.json',
]);
const SCRIPTS_ADDED_AFTER_070 = [
  'THROW_KNIFE',
  'BEGIN_OPENSTRUCT',
  'BEGIN_OPENSTRUCT_CROUCHED',
  'END_OPENSTRUCT',
  'END_OPENSTRUCT_CROUCHED',
  'END_OPENSTRUCT_LOCKED',
  'END_OPENSTRUCT_LOCKED_CROUCHED',
  'OPEN_STRUCT',
  'OPEN_STRUCT_CROUCHED',
];
const RECORDED_ONE_SHOT_FRAMES = 8;
const NONINTERRUPTIBLE_DONE = 442;
const RT_NONINTERRUPTIBLE_DONE = 772;
const END_OF_ANIMATION = 499;
const SAVE_NAMES = ['campaign', 'sandbox'];

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
let changedStubs: SaveKit;
let expected: Readonly<Record<string, ExpectedRun>>;

async function withChangedStubFile(vfs: Vfs): Promise<Vfs> {
  const changed = Uint8Array.from([...(await vfs.read(RECORDED_STUB_FILE)), 0]);
  return new Vfs([new MemoryLayer(STUBS_LAYER, [[RECORDED_STUB_FILE, changed]]), ...vfs.layers]);
}

async function recordedStubProfiles(vfs: Vfs): Promise<Uint8Array> {
  const current = new TextDecoder().decode(await vfs.read(STUB_PROFILES_FILE));
  return new TextEncoder().encode(current.replace(FACE_OFFSETS_ADDED_AFTER_070, ''));
}

async function recordedStubTilesets(vfs: Vfs): Promise<Uint8Array> {
  const current = parseTilesetDatabase(await vfs.read(STUB_TILESETS_FILE));
  const tilesets = current.tilesets.map((t) => ({
    ...t,
    surfaceFiles: t.surfaceFiles.map((file) => (SURFACES_ADDED_AFTER_070.has(file) ? '' : file)),
  }));
  return writeTilesetDatabase({ ...current, tilesets });
}

function recordedOneShotScript(flags: number): number[] {
  return [
    ...Array.from({ length: RECORDED_ONE_SHOT_FRAMES }, (_, k) => k + 1),
    ...(flags & AnimFlags.NONINTERRUPT ? [NONINTERRUPTIBLE_DONE] : []),
    ...(flags & AnimFlags.RT_NONINTERRUPT ? [RT_NONINTERRUPTIBLE_DONE] : []),
    END_OF_ANIMATION,
  ];
}

async function recordedStubScripts(vfs: Vfs, tables: AnimationTables): Promise<Uint8Array> {
  const { codes } = parseAnimationScripts(await vfs.read(STUB_ANIMATION_SCRIPTS_PATH));
  for (const name of SCRIPTS_ADDED_AFTER_070) {
    const state = stateId(tables, name);
    const base = state * MAX_FRAMES_PER_ANIM;
    codes.fill(0, base, base + MAX_FRAMES_PER_ANIM);
    recordedOneShotScript(tables.controls[state]?.flags ?? 0).forEach((code, pc) => {
      codes[base + pc] = code;
    });
  }
  return writeAnimationScripts({ codes });
}

async function withStubsAsRecorded(vfs: Vfs, tables: AnimationTables): Promise<Vfs> {
  const recorded = new MemoryLayer(STUBS_LAYER, [
    [STUB_PROFILES_FILE, await recordedStubProfiles(vfs)],
    [STUB_TILESETS_FILE, await recordedStubTilesets(vfs)],
    [STUB_ANIMATION_SCRIPTS_PATH, await recordedStubScripts(vfs, tables)],
  ]);
  return new Vfs([recorded, ...vfs.layers]);
}

async function copyFixtures(k: SaveKit): Promise<void> {
  for (const name of SAVE_NAMES) await copyFile(join(FIXTURES, `${name}-${LEGACY_VERSION}.j2s`), join(k.dir, `${name}.j2s`));
}

beforeAll(async () => {
  kit = await loadStubSectorKit();
  const recorded = await withStubsAsRecorded(kit.vfs, kit.content.animations);
  saves = await createSaveKit(kit, { legacyVfs: recorded });
  changedStubs = await createSaveKit(kit, { legacyVfs: await withChangedStubFile(recorded) });
  expected = JSON.parse(await readFile(join(FIXTURES, `expected-${LEGACY_VERSION}.json`), 'utf8')) as Record<string, ExpectedRun>;
  await copyFixtures(saves);
  await copyFixtures(changedStubs);
});

afterAll(async () => {
  await saves.dispose();
  await changedStubs.dispose();
  await kit.dispose();
});

describe(`saves written by ${LEGACY_VERSION} on the stub pack`, () => {
  for (const name of SAVE_NAMES) {
    it(
      `loads the ${name} save exactly and continues as ${LEGACY_VERSION} did`,
      async () => {
        const run = expected[name];
        if (!run) throw new Error(`no expected run for ${name}`);
        const session = await saves.open({ load: name, reseed: false });
        expect(saves.saves.lastLoad(session)?.warnings).toEqual([]);
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

  for (const name of SAVE_NAMES) {
    it(
      `loads the ${name} save with a warning after a stub file it recorded changed`,
      async () => {
        const session = await changedStubs.open({ load: name, reseed: false });
        expect(changedStubs.saves.lastLoad(session)?.warnings).toEqual(['stubPackDiffers']);
        expect(soldiers(session)).toEqual(expected[name]?.afterLoad);
      },
      TEST_TIMEOUT_MS,
    );
  }
});

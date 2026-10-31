import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { CORPSES_TABLE_PATH } from '../content/anim/corpses.ts';
import { type AnimationTables, AnimFlags, stateId } from '../content/anim/tables.ts';
import { STUB_ANIMATION_SCRIPTS_PATH } from '../content/anim/timelines.ts';
import { MAX_FRAMES_PER_ANIM, parseAnimationScripts, writeAnimationScripts } from '../content/formats/ja2bin.ts';
import { parseTilesetDatabase, writeTilesetDatabase } from '../content/formats/ja2set.ts';
import { PROJECT_DATA_LAYER, STUBS_LAYER } from '../content/vfs/layers.ts';
import { MemoryLayer, Vfs, type VfsLayer } from '../content/vfs/vfs.ts';
import { Team } from '../sim/tactical/soldier.ts';
import type { Session } from './session.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const LEGACY_VERSION = '0.7.0';
const STEP_SOUTH = 320;
const TICKS_BEFORE_MOVE = 200;
const TICKS_AFTER_MOVE = 200;
const RECORDED_STUB_FILE = 'stubs/npcdata/000.npc';
const STUB_PROFILES_FILE = 'stubs/profiles.json';
const FACE_OFFSETS_ADDED_AFTER_070 = /\n {6}"face": \{\n[^}]*\n {6}\},/g;
const STUB_TILESETS_FILE = 'stubs/world/binarydata/ja2set.dat';
const DECAPITATION_TABLES_ADDED_AFTER_070 = /\n {2}"validForDecapitation": \[[^\]]*\],\n {2}"decapitated": \[[^\]]*\],/;
const SURFACES_ADDED_AFTER_070 = new Set([
  'bullet.sprite.json',
  'miss.sprite.json',
  'watermiss.sprite.json',
  'ripple.sprite.json',
  'glassshatter.sprite.json',
  'blood.sprite.json',
  'creatureblood.sprite.json',
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
  'MONSTER_MELT',
  'CRIPPLE_HIT',
  'CRIPPLE_DIE',
  'CRIPPLE_DIE_STOP',
  'CRIPPLE_DIE_FLYBACK',
  'CRIPPLE_DIE_FLYBACK_STOP',
  'ROBOTNW_HIT',
  'ROBOTNW_DIE',
  'ROBOTNW_DIE_STOP',
  'GOTO_SLEEP',
  'SLEEPING',
  'WKAEUP_FROM_SLEEP',
  'BEING_PATIENT',
  'BEING_DOCTOR',
  'END_DOCTOR',
  'BEING_REPAIRMAN',
  'END_REPAIRMAN',
  'NINJA_GOTOBREATH',
  'NINJA_BREATH',
  'NINJA_LOWKICK',
  'NINJA_PUNCH',
  'NINJA_SPINKICK',
  'DECAPITATE',
];
const STUB_FILES_ADDED_AFTER_070: ReadonlySet<string> = new Set(['stubs/anims/structdata/j_r_bret.jsd']);
const CREATURE_FALLS_AT_070 = ['ADULTMONSTER_DYING', 'LARVAE_DIE', 'QUEEN_DIE', 'INFANT_DIE'];
const CREATURE_DEATH_STOPS_AT_070 = ['ADULTMONSTER_DYING_STOP', 'LARVAE_DIE_STOP', 'QUEEN_DIE_STOP', 'INFANT_DIE_STOP'];
const SCRIPTS_WITH_FALL_SOUNDS_ADDED_AFTER_070 = [
  'FALLFORWARD_FROMHIT_STAND',
  'ENDFALLFORWARD_FROMHIT_CROUCH',
  'FALLBACK_HIT_STAND',
  'FLYBACK_HIT',
  'JFK_HITDEATH',
];
const FALL_SOUNDS_ADDED_AFTER_070: ReadonlySet<number> = new Set([721, 722]);
const RECORDED_ONE_SHOT_FRAMES = 8;
const RECORDED_LOOP_FRAMES = 12;
const NONINTERRUPTIBLE_DONE = 442;
const RT_NONINTERRUPTIBLE_DONE = 772;
const END_OF_ANIMATION = 499;
const DEATH_OR_RELEASE = 497;
const DEAD = 440;
const JUMP_TO_START = 501;
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

async function recordedCorpseTable(vfs: Vfs): Promise<Uint8Array> {
  const current = new TextDecoder().decode(await vfs.read(CORPSES_TABLE_PATH));
  return new TextEncoder().encode(current.replace(DECAPITATION_TABLES_ADDED_AFTER_070, ''));
}

function frames(count: number, first = 1): number[] {
  return Array.from({ length: count }, (_, k) => first + k);
}

function recordedOneShotScript(flags: number): number[] {
  return [
    ...frames(RECORDED_ONE_SHOT_FRAMES),
    ...(flags & AnimFlags.NONINTERRUPT ? [NONINTERRUPTIBLE_DONE] : []),
    ...(flags & AnimFlags.RT_NONINTERRUPT ? [RT_NONINTERRUPTIBLE_DONE] : []),
    END_OF_ANIMATION,
  ];
}

function replaceScript(codes: Uint16Array, state: number, script: readonly number[]): void {
  const base = state * MAX_FRAMES_PER_ANIM;
  codes.fill(0, base, base + MAX_FRAMES_PER_ANIM);
  codes.set(script, base);
}

function scriptOf(codes: Uint16Array, state: number): number[] {
  const base = state * MAX_FRAMES_PER_ANIM;
  return Array.from(codes.subarray(base, base + MAX_FRAMES_PER_ANIM));
}

async function recordedStubScripts(vfs: Vfs, tables: AnimationTables): Promise<Uint8Array> {
  const { codes } = parseAnimationScripts(await vfs.read(STUB_ANIMATION_SCRIPTS_PATH));
  for (const name of SCRIPTS_ADDED_AFTER_070) {
    const state = stateId(tables, name);
    replaceScript(codes, state, recordedOneShotScript(tables.controls[state]?.flags ?? 0));
  }
  for (const name of SCRIPTS_WITH_FALL_SOUNDS_ADDED_AFTER_070) {
    const state = stateId(tables, name);
    replaceScript(
      codes,
      state,
      scriptOf(codes, state).filter((code) => !FALL_SOUNDS_ADDED_AFTER_070.has(code)),
    );
  }
  for (const name of CREATURE_FALLS_AT_070)
    replaceScript(codes, stateId(tables, name), [...frames(RECORDED_ONE_SHOT_FRAMES), NONINTERRUPTIBLE_DONE, DEATH_OR_RELEASE]);
  for (const name of CREATURE_DEATH_STOPS_AT_070)
    replaceScript(codes, stateId(tables, name), [1, DEAD, ...frames(RECORDED_LOOP_FRAMES - 1, 2), JUMP_TO_START]);
  return writeAnimationScripts({ codes });
}

function withoutFilesAddedAfter070(layer: VfsLayer): VfsLayer {
  return {
    name: layer.name,
    *entries() {
      for (const e of layer.entries()) if (!STUB_FILES_ADDED_AFTER_070.has(e.path)) yield e;
    },
    read: (path, start, end) => layer.read(path, start, end),
    ...(layer.stamp ? { stamp: (path: string) => layer.stamp?.(path) ?? null } : {}),
  };
}

async function withStubsAsRecorded(vfs: Vfs, tables: AnimationTables): Promise<Vfs> {
  const recorded = new MemoryLayer(STUBS_LAYER, [
    [STUB_PROFILES_FILE, await recordedStubProfiles(vfs)],
    [STUB_TILESETS_FILE, await recordedStubTilesets(vfs)],
    [STUB_ANIMATION_SCRIPTS_PATH, await recordedStubScripts(vfs, tables)],
  ]);
  const recordedTables = new MemoryLayer(PROJECT_DATA_LAYER, [[CORPSES_TABLE_PATH, await recordedCorpseTable(vfs)]]);
  return new Vfs([recorded, recordedTables, ...vfs.layers.map(withoutFilesAddedAfter070)]);
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
    it(`loads the ${name} save exactly and continues as ${LEGACY_VERSION} did`, async () => {
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
    });
  }

  for (const name of SAVE_NAMES) {
    it(`loads the ${name} save with a warning after a stub file it recorded changed`, async () => {
      const session = await changedStubs.open({ load: name, reseed: false });
      expect(changedStubs.saves.lastLoad(session)?.warnings).toEqual(['stubPackDiffers']);
      expect(soldiers(session)).toEqual(expected[name]?.afterLoad);
    });
  }
});

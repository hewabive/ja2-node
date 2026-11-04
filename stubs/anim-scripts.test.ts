import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, parseAnimationTables, stateId } from '../src/content/anim/tables.ts';
import { MAX_FRAMES_PER_ANIM, parseAnimationScripts } from '../src/content/formats/ja2bin.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import { buildStubAnimationScripts } from './anim-scripts.ts';

const NONINTERRUPTIBLE_DONE = 442;
const RESUME_FIRE = 476;
const RANDOM_ANIM_CHECK = 491;
const JUMP_TO_START = 501;
const END_OF_ANIMATION = 499;
const DROP_BOMB_CODE = 483;
const USE_REMOTE_CODE = 484;
const SET_OFF_TRIGGER_CODE = 762;
const CUT_FENCE_CODE = 481;
const TAKE_BLOOD_CODE = 760;
const UNJAM_STATES = [
  'STANDING_SHOOT_UNJAM',
  'CROUCH_SHOOT_UNJAM',
  'PRONE_SHOOT_UNJAM',
  'STANDING_SHOOT_DWEL_UNJAM',
  'CROUCH_SHOOT_DWEL_UNJAM',
  'PRONE_SHOOT_DWEL_UNJAM',
  'STANDING_SHOOT_LOW_UNJAM',
];

describe('stub animation scripts', () => {
  it('end every unjam animation by resuming the interrupted shot, as the original scripts do', async () => {
    const read = async (path: string) => JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
    const tables = parseAnimationTables(await read(ANIM_CONTROL_PATH), await read(ANIM_SURFACES_PATH));
    const { codes } = parseAnimationScripts(await buildStubAnimationScripts());
    for (const name of UNJAM_STATES) {
      const start = stateId(tables, name) * MAX_FRAMES_PER_ANIM;
      const script = Array.from(codes.slice(start, start + MAX_FRAMES_PER_ANIM));
      const end = script.indexOf(0);
      expect(script.slice(end - 2, end), name).toEqual([NONINTERRUPTIBLE_DONE, RESUME_FIRE]);
    }
  });

  it('plant the bomb, press the remote, pull the panic switch, cut the fence and fill the jar with codes 483, 484, 762, 481 and 760 in the middle of PLANT_BOMB, USE_REMOTE, AI_PULL_SWITCH, CUTTING_FENCE and TAKE_BLOOD_FROM_CORPSE, as the original scripts do', async () => {
    const read = async (path: string) => JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
    const tables = parseAnimationTables(await read(ANIM_CONTROL_PATH), await read(ANIM_SURFACES_PATH));
    const { codes } = parseAnimationScripts(await buildStubAnimationScripts());
    for (const [name, code] of [
      ['PLANT_BOMB', DROP_BOMB_CODE],
      ['USE_REMOTE', USE_REMOTE_CODE],
      ['AI_PULL_SWITCH', SET_OFF_TRIGGER_CODE],
      ['CUTTING_FENCE', CUT_FENCE_CODE],
      ['TAKE_BLOOD_FROM_CORPSE', TAKE_BLOOD_CODE],
    ] as const) {
      const start = stateId(tables, name) * MAX_FRAMES_PER_ANIM;
      const script = Array.from(codes.slice(start, start + MAX_FRAMES_PER_ANIM));
      const end = script.indexOf(0);
      expect(
        script.filter((c) => c === code),
        name,
      ).toHaveLength(1);
      expect(script.indexOf(code), name).toBeGreaterThan(0);
      expect(script.slice(end - 2, end), name).toEqual([NONINTERRUPTIBLE_DONE, END_OF_ANIMATION]);
    }
  });

  it('end the standing and the crow eating loops with the random idle animation check 491, as the original scripts do', async () => {
    const read = async (path: string) => JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
    const tables = parseAnimationTables(await read(ANIM_CONTROL_PATH), await read(ANIM_SURFACES_PATH));
    const { codes } = parseAnimationScripts(await buildStubAnimationScripts());
    for (const name of ['STANDING', 'CROW_EAT']) {
      const start = stateId(tables, name) * MAX_FRAMES_PER_ANIM;
      const script = Array.from(codes.slice(start, start + MAX_FRAMES_PER_ANIM));
      const end = script.indexOf(0);
      expect(script.slice(end - 2, end), name).toEqual([RANDOM_ANIM_CHECK, JUMP_TO_START]);
    }
  });
});

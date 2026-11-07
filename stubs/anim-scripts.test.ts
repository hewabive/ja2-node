import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stepToNextFrame } from '../src/content/anim/script.ts';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, parseAnimationTables, stateId } from '../src/content/anim/tables.ts';
import { type AnimationScripts, MAX_FRAMES_PER_ANIM, parseAnimationScripts } from '../src/content/formats/ja2bin.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import { buildStubAnimationScripts } from './anim-scripts.ts';

const LAST_FRAME_CODE = 398;
const REFUEL_VEHICLE_CODE = 769;
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
const BUSY_UP = 757;
const BUSY_DOWN = 753;
const FIRE = 430;
const FLASH = 441;
const BURST = 448;
const END_BURST = 449;
const LOCATE_TARGET = 477;
const BEGIN_HOP_FENCE = 450;
const END_HOP_FENCE = 444;
const UNJAM_STATES = [
  'STANDING_SHOOT_UNJAM',
  'CROUCH_SHOOT_UNJAM',
  'PRONE_SHOOT_UNJAM',
  'STANDING_SHOOT_DWEL_UNJAM',
  'CROUCH_SHOOT_DWEL_UNJAM',
  'PRONE_SHOOT_DWEL_UNJAM',
  'STANDING_SHOOT_LOW_UNJAM',
];

function playedOpcodes(scripts: AnimationScripts, state: number): { ops: number[]; next: number | null } {
  const ops: number[] = [];
  let pc = 0;
  for (let frame = 0; frame < MAX_FRAMES_PER_ANIM; frame++) {
    const step = stepToNextFrame(scripts, state, pc, (code) => {
      ops.push(code);
      return code === END_OF_ANIMATION ? 'stop' : 'continue';
    });
    if (step.kind === 'state') return { ops, next: step.state };
    if (step.kind !== 'frame') return { ops, next: null };
    pc = step.nextPc;
  }
  throw new Error(`state ${state} plays without end`);
}

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

  it('pass the refuel code 769 in REFUEL_VEHICLE before its release, and go from GOTO_REPAIRMAN to BEING_REPAIRMAN after the release, as the original scripts do', async () => {
    const read = async (path: string) => JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
    const tables = parseAnimationTables(await read(ANIM_CONTROL_PATH), await read(ANIM_SURFACES_PATH));
    const scripts = parseAnimationScripts(await buildStubAnimationScripts());
    expect(playedOpcodes(scripts, stateId(tables, 'REFUEL_VEHICLE'))).toEqual({
      ops: [REFUEL_VEHICLE_CODE, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
      next: null,
    });
    expect(playedOpcodes(scripts, stateId(tables, 'GOTO_REPAIRMAN'))).toEqual({
      ops: [NONINTERRUPTIBLE_DONE],
      next: stateId(tables, 'BEING_REPAIRMAN'),
    });
  });

  it("fire the tank's cannon once and its burst six times between the attack busy codes, as the original scripts do", async () => {
    const read = async (path: string) => JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
    const tables = parseAnimationTables(await read(ANIM_CONTROL_PATH), await read(ANIM_SURFACES_PATH));
    const scripts = parseAnimationScripts(await buildStubAnimationScripts());
    expect(playedOpcodes(scripts, stateId(tables, 'TANK_SHOOT'))).toEqual({
      ops: [BUSY_UP, FIRE, BUSY_DOWN, END_OF_ANIMATION],
      next: null,
    });
    const burstRound = [FLASH, BURST, FIRE, LOCATE_TARGET];
    expect(playedOpcodes(scripts, stateId(tables, 'TANK_BURST'))).toEqual({
      ops: [BUSY_UP, ...Array.from({ length: 6 }, () => burstRound).flat(), END_BURST, BUSY_DOWN, END_OF_ANIMATION],
      next: null,
    });
  });

  it('release the fence hop before its end at code 444, right before the end of the animation, as the original script does', async () => {
    const read = async (path: string) => JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
    const tables = parseAnimationTables(await read(ANIM_CONTROL_PATH), await read(ANIM_SURFACES_PATH));
    const scripts = parseAnimationScripts(await buildStubAnimationScripts());
    expect(playedOpcodes(scripts, stateId(tables, 'HOPFENCE'))).toEqual({
      ops: [BEGIN_HOP_FENCE, NONINTERRUPTIBLE_DONE, END_HOP_FENCE, END_OF_ANIMATION],
      next: null,
    });
  });

  it('loop the dying vehicle, as the original script does', async () => {
    const read = async (path: string) => JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
    const tables = parseAnimationTables(await read(ANIM_CONTROL_PATH), await read(ANIM_SURFACES_PATH));
    const { codes } = parseAnimationScripts(await buildStubAnimationScripts());
    const start = stateId(tables, 'VEHICLE_DIE') * MAX_FRAMES_PER_ANIM;
    const script = Array.from(codes.slice(start, start + MAX_FRAMES_PER_ANIM));
    expect(script.slice(0, script.indexOf(0)).filter((c) => c > LAST_FRAME_CODE)).toEqual([JUMP_TO_START]);
  });

  it.each(['DEEP_WATER_TRED', 'QUEEN_READY'])('loop %s, as the original script does', async (state) => {
    const read = async (path: string) => JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
    const tables = parseAnimationTables(await read(ANIM_CONTROL_PATH), await read(ANIM_SURFACES_PATH));
    const { codes } = parseAnimationScripts(await buildStubAnimationScripts());
    const start = stateId(tables, state) * MAX_FRAMES_PER_ANIM;
    const script = Array.from(codes.slice(start, start + MAX_FRAMES_PER_ANIM));
    expect(script[script.indexOf(0) - 1]).toBe(JUMP_TO_START);
  });
});

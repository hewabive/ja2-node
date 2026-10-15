import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, AnimFlags, parseAnimationTables, stateId } from '../src/content/anim/tables.ts';
import { MAX_ANIMATIONS, MAX_FRAMES_PER_ANIM, writeAnimationScripts } from '../src/content/formats/ja2bin.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';

export const STUB_FRAMES_PER_DIRECTION = 12;
const LOOP_FRAMES = 12;
const ONE_SHOT_FRAMES = 8;
const START_SWAT_FRAMES = 5;
const HOP_FENCE_HALF = 9;
const JUMP_TO_START = 501;
const END_OF_ANIMATION = 499;
const NONINTERRUPTIBLE_DONE = 442;
const RT_NONINTERRUPTIBLE_DONE = 772;
const NONINTERRUPT_FLAG = 0x00000080;
const RT_NONINTERRUPT_FLAG = 0x04000000;
const BEGIN_HOP_FENCE = 450;
const END_HOP_FENCE = 444;
const LOOPING_STATES = ['STANDING', 'CROUCHING', 'PRONE', 'COWERING'];

function frames(count: number, first = 1): number[] {
  return Array.from({ length: count }, (_, i) => first + i);
}

function stateJump(state: number): number {
  return state < 100 ? 600 + state : 700 + state;
}

const OPEN_DOOR = 495;
type ScriptBuilder = (tables: Parameters<typeof stateId>[0]) => number[];
const DOOR_SCRIPTS: Readonly<Record<string, ScriptBuilder>> = {
  OPEN_DOOR: (t) => [1, 2, 3, 4, 5, 6, 6, 6, 6, 5, NONINTERRUPTIBLE_DONE, OPEN_DOOR, stateJump(stateId(t, 'END_OPEN_DOOR'))],
  OPEN_DOOR_CROUCHED: (t) => [
    1,
    2,
    3,
    4,
    5,
    6,
    6,
    6,
    6,
    5,
    NONINTERRUPTIBLE_DONE,
    OPEN_DOOR,
    stateJump(stateId(t, 'END_OPEN_DOOR_CROUCHED')),
  ],
  END_OPEN_DOOR: () => [5, 4, 3, 2, 1, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
  END_OPEN_DOOR_CROUCHED: () => [5, 4, 3, 2, 1, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
  CLOSE_DOOR: () => [1, 2, 3, 4, 5, 6, OPEN_DOOR, 5, 4, 3, 2, 1, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
  CLOSE_DOOR_CROUCHED: () => [1, 2, 3, 4, 5, 6, OPEN_DOOR, 5, 4, 3, 2, 1, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
};

export async function buildStubAnimationScripts(): Promise<Uint8Array> {
  const read = async (path: string) => JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
  const tables = parseAnimationTables(await read(ANIM_CONTROL_PATH), await read(ANIM_SURFACES_PATH));
  const codes = new Uint16Array(MAX_ANIMATIONS * MAX_FRAMES_PER_ANIM);
  const looping = new Set(LOOPING_STATES.map((n) => stateId(tables, n)));
  const startSwat = stateId(tables, 'START_SWAT');
  const hopFence = stateId(tables, 'HOPFENCE');
  for (const control of tables.controls) {
    const releases = [
      ...(control.flags & NONINTERRUPT_FLAG ? [NONINTERRUPTIBLE_DONE] : []),
      ...(control.flags & RT_NONINTERRUPT_FLAG ? [RT_NONINTERRUPTIBLE_DONE] : []),
    ];
    let script: number[];
    const door = DOOR_SCRIPTS[control.id];
    if (door) script = door(tables);
    else if (control.index === startSwat) script = [...frames(START_SWAT_FRAMES), stateJump(stateId(tables, 'SWATTING'))];
    else if (control.index === hopFence)
      script = [
        BEGIN_HOP_FENCE,
        ...frames(HOP_FENCE_HALF),
        END_HOP_FENCE,
        ...frames(HOP_FENCE_HALF, HOP_FENCE_HALF + 1),
        ...releases,
        END_OF_ANIMATION,
      ];
    else if (looping.has(control.index) || control.flags & AnimFlags.MOVING) script = [...frames(LOOP_FRAMES), JUMP_TO_START];
    else script = [...frames(ONE_SHOT_FRAMES), ...releases, END_OF_ANIMATION];
    script.forEach((code, pc) => {
      codes[control.index * MAX_FRAMES_PER_ANIM + pc] = code;
    });
  }
  return writeAnimationScripts({ codes });
}

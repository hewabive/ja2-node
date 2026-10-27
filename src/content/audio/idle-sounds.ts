// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc AdjustToNextAnimationFrame code 491 (TIME_FOR_RANDOM_ANIM_CHECK, the dice roll,
// @src the injured, water and height checks, RANDOM_ANIM_SOUND with the cow's Random(2)); Tactical/Animation_Control.cc
// @src InitAnimationSystem (the sound entries of gRandomAnimDefs for COW and CROW; the cow's eating entry is casual,
// @src which a civilian never passes).

import { classifyCode } from '../anim/script.ts';
import { type AnimationScripts, MAX_FRAMES_PER_ANIM, scriptCode } from '../formats/ja2bin.ts';
import { type Cue, cueOf, type Rand, VolumeLevel } from './cue.ts';

export const IDLE_CHECK_CODE = 491;
const TIME_FOR_RANDOM_ANIM_CHECK = 2;
const DICE = 100;
const COW_BODY = 18;
const CROW_BODY = 19;
const COW_SILENCE_ODDS = 2;

interface IdleSound {
  readonly firstRoll: number;
  readonly lastRoll: number;
  readonly file: string;
}

const IDLE_SOUNDS: Readonly<Partial<Record<number, readonly IdleSound[]>>> = {
  [COW_BODY]: [
    { firstRoll: 0, lastRoll: 1, file: 'sounds/cowmoo1.wav' },
    { firstRoll: 2, lastRoll: 3, file: 'sounds/cowmoo2.wav' },
    { firstRoll: 4, lastRoll: 5, file: 'sounds/cowmoo3.wav' },
  ],
  [CROW_BODY]: [
    { firstRoll: 0, lastRoll: 50, file: 'sounds/crow3.wav' },
    { firstRoll: 51, lastRoll: 70, file: 'sounds/crow2.wav' },
  ],
};

export function hasIdleSounds(bodyType: number): boolean {
  return IDLE_SOUNDS[bodyType] !== undefined;
}

export function idleCheckLoopFrames(scripts: AnimationScripts, state: number): number | null {
  let frames = 0;
  let checks = false;
  for (let pc = 0; pc < MAX_FRAMES_PER_ANIM; pc++) {
    const c = classifyCode(scriptCode(scripts, state, pc));
    if (c.kind === 'frame') frames++;
    else if (c.kind === 'op' && c.code === IDLE_CHECK_CODE) checks = true;
    else if (c.kind === 'op') continue;
    else return checks && frames > 0 && (c.kind === 'jump' ? c.pc === 0 : c.state === state) ? frames : null;
  }
  return null;
}

export interface IdleSoldier {
  readonly bodyType: number;
  readonly gridNo: number;
  readonly dying: boolean;
  readonly injured: boolean;
  readonly inWater: boolean;
  readonly standing: boolean;
}

export interface IdleCheck {
  readonly counter: number;
  readonly cue: Cue | null;
}

function rolledSound(s: IdleSoldier, rand: Rand): Cue | null {
  if (s.inWater) return null;
  const roll = rand(DICE);
  if (s.injured || !s.standing) return null;
  const sound = IDLE_SOUNDS[s.bodyType]?.find((e) => roll >= e.firstRoll && roll <= e.lastRoll);
  if (!sound) return null;
  if (s.bodyType === COW_BODY && rand(COW_SILENCE_ODDS) === 0) return null;
  return cueOf(sound.file, 'location', VolumeLevel.MID, s.gridNo);
}

export function idleCheck(counter: number, s: IdleSoldier, rand: Rand): IdleCheck {
  if (s.dying) return { counter, cue: null };
  const next = counter + 1;
  if (next <= TIME_FOR_RANDOM_ANIM_CHECK && !s.injured) return { counter: next, cue: null };
  return { counter: 0, cue: rolledSound(s, rand) };
}

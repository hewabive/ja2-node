// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/CreatureDecideAction.cc CreatureCall (MONSTER_UP for the adult and young creatures, QUEEN_CALL
// @src for the queen, no call animation for the others); Tactical/Soldier_Ani.cc codes 707 (CREATURE_BATTLECRY_1) and
// @src 717 (the cry of the call kind) on the frames of that animation.

import { classifyCode } from '../anim/script.ts';
import type { AnimationTables } from '../anim/tables.ts';
import { type AnimationScripts, MAX_FRAMES_PER_ANIM, scriptCode } from '../formats/ja2bin.ts';

export const CALL_CRY_CODES: readonly number[] = [707, 717];

const ADULTFEMALEMONSTER = 4;
const AM_MONSTER = 5;
const YAF_MONSTER = 6;
const YAM_MONSTER = 7;
const QUEENMONSTER = 10;
const RISING_CALLERS: ReadonlySet<number> = new Set([ADULTFEMALEMONSTER, AM_MONSTER, YAF_MONSTER, YAM_MONSTER]);

export function callAnimationState(tables: AnimationTables | null, bodyType: number): number | null {
  const name = bodyType === QUEENMONSTER ? 'QUEEN_CALL' : RISING_CALLERS.has(bodyType) ? 'MONSTER_UP' : null;
  return name === null ? null : (tables?.stateIndex.get(name) ?? null);
}

export interface CodeAt {
  readonly code: number;
  readonly framesBefore: number;
}

export function codesInScript(scripts: AnimationScripts, state: number, codes: readonly number[]): CodeAt[] {
  const found: CodeAt[] = [];
  let frames = 0;
  for (let pc = 0; pc < MAX_FRAMES_PER_ANIM; pc++) {
    const c = classifyCode(scriptCode(scripts, state, pc));
    if (c.kind === 'frame') frames++;
    else if (c.kind === 'op' && codes.includes(c.code)) found.push({ code: c.code, framesBefore: frames });
    else if (c.kind !== 'op') break;
  }
  return found;
}

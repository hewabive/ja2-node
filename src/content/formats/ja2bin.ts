// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Control.cc LoadAnimationStateInstructions

import { FormatError } from '../binary/errors.ts';

export const ANIMATION_SCRIPTS_PATH = 'binarydata/ja2bin.dat';
export const MAX_ANIMATIONS = 320;
export const MAX_FRAMES_PER_ANIM = 100;

export interface AnimationScripts {
  readonly codes: Uint16Array;
}

export function parseAnimationScripts(bytes: Uint8Array): AnimationScripts {
  const expected = MAX_ANIMATIONS * MAX_FRAMES_PER_ANIM * 2;
  if (bytes.length !== expected) throw new FormatError(`animation scripts must be ${expected} bytes, got ${bytes.length}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const codes = new Uint16Array(MAX_ANIMATIONS * MAX_FRAMES_PER_ANIM);
  for (let i = 0; i < codes.length; i++) codes[i] = view.getUint16(i * 2, true);
  return { codes };
}

export function writeAnimationScripts(scripts: AnimationScripts): Uint8Array {
  const out = new Uint8Array(scripts.codes.length * 2);
  const view = new DataView(out.buffer);
  scripts.codes.forEach((c, i) => {
    view.setUint16(i * 2, c, true);
  });
  return out;
}

export function scriptCode(scripts: AnimationScripts, state: number, pc: number): number {
  if (state < 0 || state >= MAX_ANIMATIONS || pc < 0 || pc >= MAX_FRAMES_PER_ANIM) return 0;
  return scripts.codes[state * MAX_FRAMES_PER_ANIM + pc] ?? 0;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc AdjustToNextAnimationFrame (code classification and stepping)

import { type AnimationScripts, MAX_FRAMES_PER_ANIM, scriptCode } from '../formats/ja2bin.ts';

const FIRST_OPCODE = 399;
const FIRST_LOCAL_JUMP = 500;
const LOCAL_JUMP_BASE = 501;
const FIRST_STATE_JUMP = 600;
const FIRST_SOUND_OPCODE = 700;
const FIRST_HIGH_STATE_JUMP = 800;
const LAST_CODE = 999;
const LOW_STATE_JUMP_BASE = 600;
const HIGH_STATE_JUMP_BASE = 700;

export type ScriptCode =
  | { readonly kind: 'frame'; readonly frame: number }
  | { readonly kind: 'op'; readonly code: number }
  | { readonly kind: 'jump'; readonly pc: number }
  | { readonly kind: 'state'; readonly state: number };

export function classifyCode(code: number): ScriptCode {
  if (code < FIRST_OPCODE) return { kind: 'frame', frame: code - 1 };
  if (code < FIRST_LOCAL_JUMP) return { kind: 'op', code };
  if (code < FIRST_STATE_JUMP - 1) return { kind: 'jump', pc: code - LOCAL_JUMP_BASE };
  if (code < FIRST_SOUND_OPCODE) return { kind: 'state', state: code - LOW_STATE_JUMP_BASE };
  if (code < FIRST_HIGH_STATE_JUMP) return { kind: 'op', code };
  if (code <= LAST_CODE) return { kind: 'state', state: code - HIGH_STATE_JUMP_BASE };
  return { kind: 'op', code };
}

export type OpOutcome = 'continue' | 'stop' | { readonly skip: number };

export type StepResult =
  | { readonly kind: 'frame'; readonly frame: number; readonly nextPc: number }
  | { readonly kind: 'state'; readonly state: number }
  | { readonly kind: 'stopped'; readonly pc: number }
  | { readonly kind: 'runaway' };

export function stepToNextFrame(
  scripts: AnimationScripts,
  state: number,
  pc: number,
  onOp: (code: number, pc: number) => OpOutcome = () => 'continue',
): StepResult {
  let at = pc;
  for (let guard = 0; guard < MAX_FRAMES_PER_ANIM * 4; guard++) {
    const c = classifyCode(scriptCode(scripts, state, at));
    switch (c.kind) {
      case 'frame':
        return { kind: 'frame', frame: c.frame, nextPc: at + 1 };
      case 'jump':
        at = c.pc;
        break;
      case 'state':
        return { kind: 'state', state: c.state };
      case 'op':
        {
          const outcome = onOp(c.code, at);
          if (outcome === 'stop') return { kind: 'stopped', pc: at };
          if (typeof outcome === 'object') at += outcome.skip;
        }
        at++;
        break;
    }
  }
  return { kind: 'runaway' };
}

export function framesUntilStateChange(scripts: AnimationScripts, state: number, limit = MAX_FRAMES_PER_ANIM): number[] {
  const frames: number[] = [];
  let pc = 0;
  const seen = new Set<number>();
  while (frames.length < limit) {
    const step = stepToNextFrame(scripts, state, pc);
    if (step.kind !== 'frame' || seen.has(step.nextPc)) break;
    seen.add(step.nextPc);
    frames.push(step.frame);
    pc = step.nextPc;
  }
  return frames;
}

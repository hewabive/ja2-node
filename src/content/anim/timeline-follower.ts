import { type AnimationScripts, MAX_FRAMES_PER_ANIM, scriptCode } from '../formats/ja2bin.ts';
import { classifyCode, type OpOutcome, stepToNextFrame } from './script.ts';

const END_OF_ANIMATION = 499;
export const DEFAULT_TAIL_FRAMES = 2;

export interface TimelinePosition {
  readonly state: number;
  readonly pc: number;
  readonly frame: number;
}

export interface TimelineTarget {
  readonly state: number;
  readonly frame: number;
}

export function locateFrame(scripts: AnimationScripts, target: TimelineTarget): TimelinePosition {
  for (let pc = 0; pc < MAX_FRAMES_PER_ANIM; pc++) {
    const c = classifyCode(scriptCode(scripts, target.state, pc));
    if (c.kind === 'frame' && c.frame === target.frame) return { ...target, pc: pc + 1 };
  }
  return { ...target, pc: 0 };
}

type Walk =
  | { readonly kind: 'reached'; readonly position: TimelinePosition; readonly ops: readonly number[] }
  | { readonly kind: 'jumped'; readonly state: number; readonly ops: readonly number[] }
  | { readonly kind: 'ended'; readonly ops: readonly number[] }
  | { readonly kind: 'lost' };

function walk(scripts: AnimationScripts, state: number, pc: number, frame: number | null, frameBudget: number): Walk {
  const ops: number[] = [];
  const onOp = (code: number): OpOutcome => {
    ops.push(code);
    return code === END_OF_ANIMATION ? 'stop' : 'continue';
  };
  let at = pc;
  for (let frames = 0; frames < frameBudget; frames++) {
    const step = stepToNextFrame(scripts, state, at, onOp);
    if (step.kind === 'state') return { kind: 'jumped', state: step.state, ops };
    if (step.kind === 'stopped') return { kind: 'ended', ops };
    if (step.kind === 'runaway') return { kind: 'lost' };
    if (step.frame === frame) return { kind: 'reached', position: { state, pc: step.nextPc, frame: step.frame }, ops };
    at = step.nextPc;
  }
  return { kind: 'lost' };
}

function walkInto(
  scripts: AnimationScripts,
  target: TimelineTarget,
  carried: readonly number[],
): { position: TimelinePosition; ops: number[] } {
  let state = target.state;
  const ops = [...carried];
  for (let restarts = 0; restarts < 2; restarts++) {
    const w = walk(scripts, state, 0, target.frame, MAX_FRAMES_PER_ANIM);
    if (w.kind === 'reached') return { position: w.position, ops: [...ops, ...w.ops] };
    if (w.kind !== 'jumped' || w.state !== target.state) break;
    ops.push(...w.ops);
    state = w.state;
  }
  return { position: locateFrame(scripts, target), ops: [...carried] };
}

export function followTimeline(
  scripts: AnimationScripts,
  from: TimelinePosition | null,
  to: TimelineTarget,
  tailFrames = DEFAULT_TAIL_FRAMES,
): { position: TimelinePosition; ops: number[] } {
  if (!from) return { position: locateFrame(scripts, to), ops: [] };
  if (from.state === to.state && from.frame === to.frame) return { position: from, ops: [] };
  if (from.state === to.state) {
    const same = walk(scripts, from.state, from.pc, to.frame, MAX_FRAMES_PER_ANIM);
    if (same.kind === 'reached') return { position: same.position, ops: [...same.ops] };
    if (same.kind === 'jumped' && same.state === to.state) return walkInto(scripts, to, same.ops);
    return { position: locateFrame(scripts, to), ops: [] };
  }
  const tail = walk(scripts, from.state, from.pc, null, tailFrames + 1);
  const carried = (tail.kind === 'jumped' && tail.state === to.state) || tail.kind === 'ended' ? tail.ops : [];
  return walkInto(scripts, to, carried);
}

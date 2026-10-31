// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc AdjustToNextAnimationFrame (code ranges: frames, opcodes, jumps, sounds);
// @src src/game/Tactical/Animation_Control.cc LoadAnimationStateInstructions

import { FormatError } from '../binary/errors.ts';
import {
  ANIMATION_SCRIPTS_PATH,
  type AnimationScripts,
  MAX_ANIMATIONS,
  MAX_FRAMES_PER_ANIM,
  parseAnimationScripts,
} from '../formats/ja2bin.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import { classifyCode } from './script.ts';

export const STUB_ANIMATION_SCRIPTS_PATH = `stubs/${ANIMATION_SCRIPTS_PATH}`;
export const ANIMATION_SCRIPTS_PATHS: readonly string[] = [ANIMATION_SCRIPTS_PATH, STUB_ANIMATION_SCRIPTS_PATH];

export const SlotKind = { EMPTY: 0, FRAME: 1, OP: 2, NOP: 3, JUMP: 4, STATE: 5 } as const;
export type SlotKind = (typeof SlotKind)[keyof typeof SlotKind];

export interface LogicTimeline {
  readonly kinds: Uint8Array;
  readonly args: Int32Array;
}

export interface PresentationTimeline {
  readonly frames: Int16Array;
  readonly sounds: Uint16Array;
}

export interface AnimationTimelines {
  readonly logic: LogicTimeline;
  readonly presentation: PresentationTimeline;
}

export const NO_FRAME_SLOT = -1;
export const OUTSIDE_SCRIPT_SLOT = -2;
const NO_SPRITE_FRAME = -32768;
const FRAME_BEFORE_FIRST_SLOT = 0;
const FRAME_OF_EMPTY_CODE = -1;
const EMPTY_CODE = 0;
const END_OF_ANIMATION = 499;
const FIRST_SOUND_RANGE_CODE = 700;
const LAST_SOUND_RANGE_CODE = 799;
const SIMULATION_OPCODES_IN_SOUND_RANGE: ReadonlySet<number> = new Set([721, 722, 752, 753, 755, 757, 761, 765, 768, 772]);
const SLOTS = MAX_ANIMATIONS * MAX_FRAMES_PER_ANIM;

export function isSoundRangeCode(code: number): boolean {
  return code >= FIRST_SOUND_RANGE_CODE && code <= LAST_SOUND_RANGE_CODE;
}

export function isSimulationOpcode(code: number): boolean {
  return !isSoundRangeCode(code) || SIMULATION_OPCODES_IN_SOUND_RANGE.has(code);
}

export function timelineSlot(state: number, pc: number): number {
  if (state < 0 || state >= MAX_ANIMATIONS || pc < 0 || pc >= MAX_FRAMES_PER_ANIM) return OUTSIDE_SCRIPT_SLOT;
  return state * MAX_FRAMES_PER_ANIM + pc;
}

export function slotKind(logic: LogicTimeline, slot: number): SlotKind {
  return slot < 0 ? SlotKind.EMPTY : ((logic.kinds[slot] ?? SlotKind.EMPTY) as SlotKind);
}

export function slotArgument(logic: LogicTimeline, slot: number): number {
  return slot < 0 ? 0 : (logic.args[slot] ?? 0);
}

export function splitAnimationScripts(scripts: AnimationScripts): AnimationTimelines {
  const kinds = new Uint8Array(SLOTS);
  const args = new Int32Array(SLOTS);
  const frames = new Int16Array(SLOTS).fill(NO_SPRITE_FRAME);
  const sounds = new Uint16Array(SLOTS);
  for (let slot = 0; slot < SLOTS; slot++) {
    const raw = scripts.codes[slot] ?? EMPTY_CODE;
    const code = classifyCode(raw);
    switch (code.kind) {
      case 'frame':
        kinds[slot] = raw === EMPTY_CODE ? SlotKind.EMPTY : SlotKind.FRAME;
        frames[slot] = code.frame;
        break;
      case 'jump':
        kinds[slot] = SlotKind.JUMP;
        args[slot] = code.pc;
        break;
      case 'state':
        kinds[slot] = SlotKind.STATE;
        args[slot] = code.state;
        break;
      case 'op':
        kinds[slot] = isSimulationOpcode(raw) ? SlotKind.OP : SlotKind.NOP;
        args[slot] = isSimulationOpcode(raw) ? raw : 0;
        if (isSoundRangeCode(raw)) sounds[slot] = raw;
        break;
    }
  }
  return { logic: { kinds, args }, presentation: { frames, sounds } };
}

export function spriteFrameAt(presentation: PresentationTimeline, frameSlot: number): number {
  if (frameSlot === NO_FRAME_SLOT) return FRAME_BEFORE_FIRST_SLOT;
  if (frameSlot === OUTSIDE_SCRIPT_SLOT) return FRAME_OF_EMPTY_CODE;
  return presentation.frames[frameSlot] ?? FRAME_OF_EMPTY_CODE;
}

function matchingSlot(presentation: PresentationTimeline, state: number, pcs: Iterable<number>, frame: number): number | null {
  for (const pc of pcs) {
    const slot = timelineSlot(state, pc);
    if (slot >= 0 && presentation.frames[slot] === frame) return slot;
  }
  return null;
}

function* descending(from: number): Iterable<number> {
  for (let pc = from; pc >= 0; pc--) yield pc;
}

function* ascending(): Iterable<number> {
  for (let pc = 0; pc < MAX_FRAMES_PER_ANIM; pc++) yield pc;
}

export function frameSlotOfSpriteFrame(presentation: PresentationTimeline, state: number, pc: number, frame: number): number {
  const last = matchingSlot(presentation, state, [pc - 1], frame);
  if (last !== null) return last;
  if (frame === FRAME_BEFORE_FIRST_SLOT) return NO_FRAME_SLOT;
  const found = matchingSlot(presentation, state, descending(pc - 2), frame) ?? matchingSlot(presentation, state, ascending(), frame);
  if (found !== null) return found;
  return frame === FRAME_OF_EMPTY_CODE ? OUTSIDE_SCRIPT_SLOT : NO_FRAME_SLOT;
}

const loopCache = new WeakMap<LogicTimeline, Map<number, boolean>>();

function computeTimelineLoops(logic: LogicTimeline, state: number): boolean {
  for (let pc = 0; pc < MAX_FRAMES_PER_ANIM; pc++) {
    const slot = timelineSlot(state, pc);
    const kind = slotKind(logic, slot);
    const arg = slotArgument(logic, slot);
    if (kind === SlotKind.EMPTY) return false;
    if (kind === SlotKind.JUMP) return arg <= pc;
    if (kind === SlotKind.STATE) return arg === state;
    if (kind === SlotKind.OP && arg === END_OF_ANIMATION) return false;
  }
  return false;
}

export function timelineLoops(logic: LogicTimeline, state: number): boolean {
  let cache = loopCache.get(logic);
  if (!cache) {
    cache = new Map();
    loopCache.set(logic, cache);
  }
  const known = cache.get(state);
  if (known !== undefined) return known;
  const loops = computeTimelineLoops(logic, state);
  cache.set(state, loops);
  return loops;
}

export async function readAnimationScripts(read: ReadFile): Promise<Uint8Array | null> {
  for (const path of ANIMATION_SCRIPTS_PATHS) {
    const bytes = await read(path);
    if (bytes) return bytes;
  }
  return null;
}

const loaded = new WeakMap<ReadFile, Promise<AnimationTimelines | null>>();

async function load(read: ReadFile): Promise<AnimationTimelines | null> {
  const bytes = await readAnimationScripts(read);
  return bytes ? splitAnimationScripts(parseAnimationScripts(bytes)) : null;
}

export async function requireAnimationTimelines(read: ReadFile): Promise<AnimationTimelines> {
  const timelines = await loadAnimationTimelines(read);
  if (!timelines) throw new FormatError(`missing ${ANIMATION_SCRIPTS_PATH} (and no stub pack)`);
  return timelines;
}

export function emptyAnimationTimelines(): AnimationTimelines {
  return splitAnimationScripts({ codes: new Uint16Array(SLOTS) });
}

export function loadAnimationTimelines(read: ReadFile): Promise<AnimationTimelines | null> {
  let pending = loaded.get(read);
  if (!pending) {
    pending = load(read);
    loaded.set(read, pending);
  }
  return pending;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc AdjustToNextAnimationFrame (frames, jumps, state changes, opcode 430 fires the
// @src weapon, 499 ends the animation); Soldier_Control.cc EVENT_InitNewSoldierAnim (the first frame shows at once,
// @src then one frame per sAniDelay).

import { MAX_FRAMES_PER_ANIM } from '../formats/ja2bin.ts';
import {
  type AnimationTimelines,
  type LogicTimeline,
  OUTSIDE_SCRIPT_SLOT,
  SlotKind,
  slotArgument,
  slotKind,
  spriteFrameAt,
  timelineSlot,
} from './timelines.ts';

export const FIRE_WEAPON_OPCODE = 430;
const END_OF_ANIMATION = 499;
const WALK_GUARD = MAX_FRAMES_PER_ANIM * 4;
const MIN_FRAME_DELAY_MS = 1;

export interface SoldierSchedule {
  readonly animation: number;
  readonly frameSlot: number;
  readonly stateTick: number;
  readonly frameDelay: number;
  readonly nextFrameTick?: number;
}

export interface StateTrack {
  readonly frames: readonly number[];
  readonly markers: readonly number[];
  readonly loopStart: number | null;
}

const EMPTY_TRACK: StateTrack = { frames: [], markers: [], loopStart: null };

export function stateTrack(timelines: AnimationTimelines, state: number): StateTrack {
  const { logic, presentation } = timelines;
  const frames: number[] = [];
  const markers: number[] = [];
  const reachedAt = new Map<number, number>();
  let firePending = false;
  let pc = 0;
  for (let guard = 0; guard < WALK_GUARD; guard++) {
    const slot = timelineSlot(state, pc);
    if (slot === OUTSIDE_SCRIPT_SLOT) break;
    const seen = reachedAt.get(pc);
    if (seen !== undefined && seen < frames.length) return { frames, markers, loopStart: seen };
    reachedAt.set(pc, frames.length);
    const kind = slotKind(logic, slot);
    const arg = slotArgument(logic, slot);
    if (kind === SlotKind.EMPTY) break;
    if (kind === SlotKind.FRAME) {
      frames.push(spriteFrameAt(presentation, slot));
      if (firePending) markers.push(frames.length - 1);
      firePending = false;
      pc++;
    } else if (kind === SlotKind.JUMP) pc = arg;
    else if (kind === SlotKind.STATE) {
      if (arg === state && frames.length > 0) return { frames, markers, loopStart: 0 };
      break;
    } else if (kind === SlotKind.OP && arg === END_OF_ANIMATION) break;
    else {
      if (kind === SlotKind.OP && arg === FIRE_WEAPON_OPCODE) firePending = true;
      pc++;
    }
  }
  return frames.length === 0 ? EMPTY_TRACK : { frames, markers, loopStart: null };
}

export interface Anchor {
  readonly tick: number;
  readonly index: number;
}

export function nominalIndex(elapsedTicks: number, frameDelay: number, msPerTick: number): number {
  return Math.max(0, Math.floor((elapsedTicks * msPerTick) / Math.max(MIN_FRAME_DELAY_MS, frameDelay)));
}

export function warpedIndex(
  track: StateTrack,
  schedule: SoldierSchedule,
  markerTicks: readonly number[],
  tick: number,
  msPerTick: number,
): number {
  const anchors: Anchor[] = [{ tick: schedule.stateTick, index: 0 }];
  const confirmed = Math.min(markerTicks.length, track.markers.length);
  for (let k = 0; k < confirmed; k++) anchors.push({ tick: markerTicks[k] as number, index: track.markers[k] as number });
  for (let k = 1; k < anchors.length; k++) {
    const a = anchors[k - 1] as Anchor;
    const b = anchors[k] as Anchor;
    if (tick < b.tick) {
      if (b.tick <= a.tick) return b.index;
      return a.index + Math.floor(((tick - a.tick) * (b.index - a.index)) / (b.tick - a.tick));
    }
  }
  const last = anchors[anchors.length - 1] as Anchor;
  const index = last.index + nominalIndex(tick - last.tick, schedule.frameDelay, msPerTick);
  const next = track.markers[confirmed];
  return next === undefined ? index : Math.min(index, next - 1);
}

export function trackFrame(track: StateTrack, index: number): number {
  const n = track.frames.length;
  if (n === 0) return 0;
  if (index < n) return track.frames[Math.max(0, index)] as number;
  if (track.loopStart === null) return track.frames[n - 1] as number;
  const period = n - track.loopStart;
  return track.frames[track.loopStart + ((index - track.loopStart) % period)] as number;
}

export const NEVER_NEXT_FRAME = -1;

export interface FrameAnchor {
  readonly animation: number;
  readonly frameSlot: number;
  readonly frameDelay: number;
  readonly nextFrameTick?: number;
}

interface SlotTrack {
  readonly slots: readonly number[];
  readonly loopStart: number | null;
  readonly silent: boolean;
}

const slotTracks = new WeakMap<LogicTimeline, Map<number, SlotTrack>>();

function walkSlots(timelines: AnimationTimelines, state: number): SlotTrack {
  const { logic, presentation } = timelines;
  const slots: number[] = [];
  const reachedAt = new Map<number, number>();
  let silent = true;
  let pc = 0;
  for (let guard = 0; guard < WALK_GUARD; guard++) {
    const slot = timelineSlot(state, pc);
    if (slot === OUTSIDE_SCRIPT_SLOT) break;
    const seen = reachedAt.get(pc);
    if (seen !== undefined && seen < slots.length) return { slots, loopStart: seen, silent };
    reachedAt.set(pc, slots.length);
    if ((presentation.sounds[slot] ?? 0) !== 0) silent = false;
    const kind = slotKind(logic, slot);
    const arg = slotArgument(logic, slot);
    if (kind === SlotKind.EMPTY) break;
    if (kind === SlotKind.FRAME) {
      slots.push(slot);
      pc++;
    } else if (kind === SlotKind.JUMP) pc = arg;
    else if (kind === SlotKind.STATE) {
      if (arg === state && slots.length > 0) return { slots, loopStart: 0, silent };
      break;
    } else if (kind === SlotKind.OP && arg === END_OF_ANIMATION) break;
    else pc++;
  }
  return { slots, loopStart: null, silent };
}

function slotTrack(timelines: AnimationTimelines, state: number): SlotTrack {
  let byState = slotTracks.get(timelines.logic);
  if (!byState) {
    byState = new Map();
    slotTracks.set(timelines.logic, byState);
  }
  let track = byState.get(state);
  if (!track) {
    track = walkSlots(timelines, state);
    byState.set(state, track);
  }
  return track;
}

export function silentAnimation(timelines: AnimationTimelines, state: number): boolean {
  return slotTrack(timelines, state).silent;
}

export function ticksPerFrame(frameDelay: number, msPerTick: number): number {
  return frameDelay <= 0 ? 1 : Math.ceil(frameDelay / msPerTick);
}

export function predictedFrameSlot(timelines: AnimationTimelines, anchor: FrameAnchor, tick: number, msPerTick: number): number | null {
  const next = anchor.nextFrameTick;
  if (next === undefined) return null;
  if (next === NEVER_NEXT_FRAME || tick < next) return anchor.frameSlot;
  const track = slotTrack(timelines, anchor.animation);
  const at = track.slots.indexOf(anchor.frameSlot);
  if (at < 0) return null;
  const index = at + 1 + Math.floor((tick - next) / ticksPerFrame(anchor.frameDelay, msPerTick));
  if (index < track.slots.length) return track.slots[index] ?? null;
  if (track.loopStart === null) return null;
  const period = track.slots.length - track.loopStart;
  return track.slots[track.loopStart + ((index - track.loopStart) % period)] ?? null;
}

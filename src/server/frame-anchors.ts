import { NEVER_NEXT_FRAME, predictedFrameSlot, silentAnimation } from '../content/anim/schedule-track.ts';
import type { AnimationTimelines } from '../content/anim/timelines.ts';
import { TICK_MS } from '../protocol/messages.ts';
import type { PlayerView, SoldierView } from '../protocol/view.ts';

export interface AnchoredView {
  readonly view: PlayerView;
  readonly predicting: boolean;
}

function keptAnchor(timelines: AnimationTimelines, sent: SoldierView | undefined, now: SoldierView, tick: number): SoldierView | null {
  if (!sent || sent.nextFrameTick === undefined) return null;
  if (sent.animation !== now.animation || sent.frameDelay !== now.frameDelay || sent.stateTick !== now.stateTick) return null;
  if (!silentAnimation(timelines, now.animation)) return null;
  if (predictedFrameSlot(timelines, sent, tick, TICK_MS) !== now.frameSlot) return null;
  return { ...now, frame: sent.frame, frameSlot: sent.frameSlot, nextFrameTick: sent.nextFrameTick };
}

export function keepPredictableFrames(timelines: AnimationTimelines, sent: PlayerView, now: PlayerView): AnchoredView {
  const before = new Map(sent.soldiers.map((s) => [s.id, s]));
  let predicting = false;
  const soldiers = now.soldiers.map((s) => {
    const kept = keptAnchor(timelines, before.get(s.id), s, now.tick);
    if (!kept) return s;
    if (kept.nextFrameTick !== NEVER_NEXT_FRAME) predicting = true;
    return kept;
  });
  return { view: { ...now, soldiers }, predicting };
}

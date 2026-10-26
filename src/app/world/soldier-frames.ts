import {
  predictedFrameSlot,
  type SoldierSchedule,
  type StateTrack,
  stateTrack,
  trackFrame,
  warpedIndex,
} from '../../content/anim/schedule-track.ts';
import {
  ANIMATION_SCRIPTS_PATHS,
  type AnimationTimelines,
  STUB_ANIMATION_SCRIPTS_PATH,
  splitAnimationScripts,
  spriteFrameAt,
} from '../../content/anim/timelines.ts';
import { parseAnimationScripts } from '../../content/formats/ja2bin.ts';
import type { Sha256 } from '../../content/rules/pack.ts';
import { TICK_MS, UNKNOWN_IDENTITY } from '../../protocol/messages.ts';
import type { SimEvent } from '../../sim/events.ts';
import type { ReadVfsFile } from '../net/vfs.ts';
import { browserSha256 } from '../rules/client-rules.ts';

const MANIFEST_HASH_DIGITS = 16;
const MARKER_EVENTS: ReadonlySet<SimEvent['type']> = new Set(['shotFired', 'meleeStrike']);
const MAX_MARKERS_PER_SOLDIER = 64;

export type FramePolicy = 'exact' | 'warp';

function markerSoldier(e: SimEvent): number | null {
  if (!MARKER_EVENTS.has(e.type)) return null;
  return 'soldier' in e && typeof e.soldier === 'number' ? e.soldier : null;
}

export class SoldierFrames {
  readonly policy: FramePolicy;
  readonly #timelines: AnimationTimelines;
  readonly #msPerTick: number;
  readonly #tracks = new Map<number, StateTrack>();
  readonly #markers = new Map<number, number[]>();

  constructor(timelines: AnimationTimelines, sameScripts: boolean, msPerTick: number) {
    this.#timelines = timelines;
    this.policy = sameScripts ? 'exact' : 'warp';
    this.#msPerTick = msPerTick;
  }

  observe(events: readonly SimEvent[]): void {
    for (const e of events) {
      const soldier = markerSoldier(e);
      if (soldier === null) continue;
      const list = this.#markers.get(soldier) ?? [];
      if (list.at(-1) !== e.tick) list.push(e.tick);
      if (list.length > MAX_MARKERS_PER_SOLDIER) list.shift();
      this.#markers.set(soldier, list);
    }
  }

  reset(): void {
    this.#markers.clear();
  }

  #track(state: number): StateTrack {
    let track = this.#tracks.get(state);
    if (!track) {
      track = stateTrack(this.#timelines, state);
      this.#tracks.set(state, track);
    }
    return track;
  }

  markersOf(soldier: number, since: number): number[] {
    return (this.#markers.get(soldier) ?? []).filter((t) => t >= since);
  }

  frameOf(soldier: number, schedule: SoldierSchedule, tick: number): number {
    if (this.policy === 'exact') {
      const frameSlot = predictedFrameSlot(this.#timelines, schedule, tick, this.#msPerTick) ?? schedule.frameSlot;
      return spriteFrameAt(this.#timelines.presentation, frameSlot);
    }
    const track = this.#track(schedule.animation);
    return trackFrame(track, warpedIndex(track, schedule, this.markersOf(soldier, schedule.stateTick), tick, this.#msPerTick));
  }
}

export interface SoldierFramesSource {
  readonly available: ReadonlySet<string>;
  readonly read: ReadVfsFile;
  readonly serverScripts: string | null;
  readonly preferStubScripts?: boolean;
  readonly sha256?: Sha256;
}

function scriptsPath(available: ReadonlySet<string>, preferStub: boolean): string | null {
  const order = preferStub ? [STUB_ANIMATION_SCRIPTS_PATH, ...ANIMATION_SCRIPTS_PATHS] : ANIMATION_SCRIPTS_PATHS;
  return order.find((p) => available.has(p)) ?? null;
}

function sameScripts(hash: string, source: SoldierFramesSource): boolean {
  const unknown = source.serverScripts === null || source.serverScripts === UNKNOWN_IDENTITY.rules.scripts;
  return hash === source.serverScripts || (unknown && !source.preferStubScripts);
}

export async function loadSoldierFrames(source: SoldierFramesSource): Promise<SoldierFrames | null> {
  const path = scriptsPath(source.available, source.preferStubScripts ?? false);
  if (!path) return null;
  const bytes = await source.read(path);
  const hash = (await (source.sha256 ?? browserSha256)(bytes)).slice(0, MANIFEST_HASH_DIGITS);
  const timelines = splitAnimationScripts(parseAnimationScripts(bytes));
  return new SoldierFrames(timelines, sameScripts(hash, source), TICK_MS);
}

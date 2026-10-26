import { clipRect, exposedStrips, mergeRects, rectArea, type ScreenRect, type ScreenShift } from './dirty-rects.ts';
import type { DrawRun } from './dynamic-scene.ts';
import type { Viewport } from './geometry.ts';
import { FLOATS_PER_INSTANCE, type InstanceBuffer } from './instances.ts';

const INITIAL_VALUES = 4096;
const RECORD_HEAD = 2;
const RECORD_SIZE = RECORD_HEAD + FLOATS_PER_INSTANCE;
const FULL_REDRAW_SHARE = 0.6;
const DITHER_PERIOD = 2;

export type PictureUpdate =
  | { readonly kind: 'same' }
  | { readonly kind: 'full' }
  | { readonly kind: 'partial'; readonly shift: ScreenShift; readonly rects: readonly ScreenRect[] };

const SAME: PictureUpdate = { kind: 'same' };
const FULL: PictureUpdate = { kind: 'full' };

class Values {
  #data = new Float64Array(INITIAL_VALUES);
  length = 0;

  clear(): void {
    this.length = 0;
  }

  at(i: number): number {
    return this.#data[i] as number;
  }

  push(v: number): void {
    if (this.length === this.#data.length) {
      const grown = new Float64Array(this.#data.length * 2);
      grown.set(this.#data);
      this.#data = grown;
    }
    this.#data[this.length++] = v;
  }

  equals(other: Values): boolean {
    if (this.length !== other.length) return false;
    for (let i = 0; i < this.length; i++) if (this.#data[i] !== other.#data[i]) return false;
    return true;
  }

  slice(from: number, to: number): Float64Array {
    return this.#data.subarray(from, to);
  }
}

class PictureFrame {
  readonly keys = new Values();
  readonly records = new Values();
  viewport: Viewport = { width: 0, height: 0 };
  offset: ScreenShift = { x: 0, y: 0 };
  groups = 0;

  get recordCount(): number {
    return this.records.length / RECORD_SIZE;
  }

  recordKey(i: number): string {
    return this.records.slice(i * RECORD_SIZE, (i + 1) * RECORD_SIZE).join(',');
  }

  recordRect(i: number, at: ScreenShift, v: Viewport): ScreenRect | null {
    const o = i * RECORD_SIZE + RECORD_HEAD;
    const r = this.records;
    return clipRect(r.at(o) + at.x, r.at(o + 1) + at.y, r.at(o + 2), r.at(o + 3), v);
  }
}

function shiftable(shift: ScreenShift, v: Viewport): boolean {
  return Math.abs(shift.x) < v.width && Math.abs(shift.y) < v.height && (shift.x + shift.y) % DITHER_PERIOD === 0;
}

export class PictureMemo {
  #current = new PictureFrame();
  #previous = new PictureFrame();
  #known = false;

  begin(viewport: Viewport, offset: ScreenShift): void {
    const f = this.#current;
    f.keys.clear();
    f.records.clear();
    f.viewport = viewport;
    f.offset = offset;
    f.groups = 0;
  }

  add(...values: readonly number[]): void {
    for (const v of values) this.#current.keys.push(v);
  }

  addVisible(runs: readonly DrawRun[], buffer: InstanceBuffer): void {
    const f = this.#current;
    const { width, height } = f.viewport;
    const group = f.groups++;
    const d = buffer.data;
    for (const run of runs) {
      for (let i = run.first; i < run.first + run.count; i++) {
        const o = i * FLOATS_PER_INSTANCE;
        const x = (d[o] as number) + f.offset.x;
        const y = (d[o + 1] as number) + f.offset.y;
        if (x + (d[o + 2] as number) <= 0 || y + (d[o + 3] as number) <= 0 || x >= width || y >= height) continue;
        f.records.push(group);
        f.records.push(run.state);
        for (let k = 0; k < FLOATS_PER_INSTANCE; k++) f.records.push(d[o + k] as number);
      }
    }
  }

  update(): PictureUpdate {
    const update = this.#known ? this.#compare() : FULL;
    const previous = this.#previous;
    this.#previous = this.#current;
    this.#current = previous;
    this.#known = true;
    return update;
  }

  forget(): void {
    this.#known = false;
  }

  #compare(): PictureUpdate {
    const now = this.#current;
    const before = this.#previous;
    const v = now.viewport;
    if (v.width !== before.viewport.width || v.height !== before.viewport.height || !now.keys.equals(before.keys)) return FULL;
    const shift = { x: now.offset.x - before.offset.x, y: now.offset.y - before.offset.y };
    if (shift.x === 0 && shift.y === 0 && now.records.equals(before.records)) return SAME;
    if (!shiftable(shift, v)) return FULL;
    const rects = mergeRects([...exposedStrips(v, shift), ...this.#changedRects(now, before)]);
    const area = rects.reduce((sum, r) => sum + rectArea(r), 0);
    return area >= FULL_REDRAW_SHARE * v.width * v.height ? FULL : { kind: 'partial', shift, rects };
  }

  #changedRects(now: PictureFrame, before: PictureFrame): ScreenRect[] {
    const v = now.viewport;
    const unmatched = new Map<string, number[]>();
    for (let i = 0; i < before.recordCount; i++) {
      const key = before.recordKey(i);
      const queue = unmatched.get(key);
      if (queue) queue.push(i);
      else unmatched.set(key, [i]);
    }
    const rects: ScreenRect[] = [];
    const keep = (r: ScreenRect | null) => {
      if (r) rects.push(r);
    };
    let lastMatched = -1;
    for (let j = 0; j < now.recordCount; j++) {
      const old = unmatched.get(now.recordKey(j))?.shift();
      if (old === undefined || old < lastMatched) keep(now.recordRect(j, now.offset, v));
      if (old !== undefined) lastMatched = Math.max(lastMatched, old);
    }
    for (const queue of unmatched.values()) for (const i of queue) keep(before.recordRect(i, now.offset, v));
    return rects;
  }
}

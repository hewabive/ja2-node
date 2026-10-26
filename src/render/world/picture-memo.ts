import type { DrawRun } from './dynamic-scene.ts';
import type { Viewport } from './geometry.ts';
import { FLOATS_PER_INSTANCE, type InstanceBuffer } from './instances.ts';

const INITIAL_VALUES = 4096;

export interface ScreenOffset {
  readonly x: number;
  readonly y: number;
}

export class PictureMemo {
  #previous = new Float64Array(INITIAL_VALUES);
  #previousLength = -1;
  #current = new Float64Array(INITIAL_VALUES);
  #length = 0;

  begin(): void {
    this.#length = 0;
  }

  add(...values: readonly number[]): void {
    for (const v of values) this.#push(v);
  }

  addVisible(runs: readonly DrawRun[], buffer: InstanceBuffer, viewport: Viewport, offset: ScreenOffset): void {
    const d = buffer.data;
    let visible = 0;
    for (const run of runs) {
      for (let i = run.first; i < run.first + run.count; i++) {
        const o = i * FLOATS_PER_INSTANCE;
        const x = (d[o] as number) + offset.x;
        const y = (d[o + 1] as number) + offset.y;
        if (x + (d[o + 2] as number) <= 0 || y + (d[o + 3] as number) <= 0 || x >= viewport.width || y >= viewport.height) continue;
        this.#push(run.state);
        for (let k = 0; k < FLOATS_PER_INSTANCE; k++) this.#push(d[o + k] as number);
        visible++;
      }
    }
    this.#push(visible);
  }

  changed(): boolean {
    const same = this.#length === this.#previousLength && this.#sameValues();
    const previous = this.#previous;
    this.#previous = this.#current;
    this.#previousLength = this.#length;
    this.#current = previous;
    return !same;
  }

  forget(): void {
    this.#previousLength = -1;
  }

  #sameValues(): boolean {
    const a = this.#current;
    const b = this.#previous;
    for (let i = 0; i < this.#length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  #push(v: number): void {
    if (this.#length === this.#current.length) {
      const grown = new Float64Array(this.#current.length * 2);
      grown.set(this.#current);
      this.#current = grown;
    }
    this.#current[this.#length++] = v;
  }
}

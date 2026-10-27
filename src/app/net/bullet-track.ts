import type { BulletAtTick, BulletView, ViewFrame } from '../../protocol/view.ts';

export class BulletTrack {
  #points: BulletAtTick[] = [];

  add(frames: readonly ViewFrame[]): void {
    for (const frame of frames) if (frame.bullets) this.#points.push(...frame.bullets);
  }

  forgetBefore(tick: number): void {
    if (this.#points.some((p) => p.tick < tick)) this.#points = this.#points.filter((p) => p.tick >= tick);
  }

  at(tick: number): BulletView[] {
    return this.#points.filter((p) => p.tick === tick);
  }

  clear(): void {
    this.#points = [];
  }
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-29. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMMembers.cc HandleVideoDistortion (a Random(200) pick at most every 2500 ms, each static sample
// @src played once per run of a mode at LOWVOLUME), DisplayDistortionLine, DisplayPixelatedImage, DisplayTransparentSnow
// @src (their function statics live as long as the laptop memory), InitVideoFace (VC_NO_STATIC); VC_* in the same file.
// @src The snowy background of HandleVideoDistortion is not reproduced: the connection snow clears its flag first.

import { u32 } from '../../../../core/int.ts';

export const StaticMode = {
  NO_STATIC: 0,
  FUZZY_LINE: 1,
  STRAIGHT_LINE: 2,
  BW_SNOW: 4,
  PIXELATE: 5,
  TRANS_SNOW_IN: 6,
  TRANS_SNOW_OUT: 7,
} as const;

export const DistortionAsset = {
  FUZZ_LINES: 'laptop/fuzzline.sti',
  STRAIGHT_LINES: 'laptop/lineinterference.sti',
  BW_SNOW: 'laptop/bwsnow.sti',
  TRANS_SNOW: 'laptop/transsnow.sti',
} as const;

export const DISTORTION_PICK_TIME = 2500;
export const DISTORTION_PICK_RANGE = 200;
export const DISTORTION_FRAME_TIME = 100;
export const FUZZ_LINE_FRAMES = 10;
export const STRAIGHT_LINE_FRAMES = 9;
export const BW_SNOW_FRAMES = 5;
export const PIXELATE_STEPS = 4;
export const TRANS_SNOW_FRAMES = 7;
export const STATIC_NOISE_VOLUME = 25;
const UNSTARTED_LINE = 255;

const PICKS: readonly (readonly [below: number, mode: number])[] = [
  [15, StaticMode.FUZZY_LINE],
  [25, StaticMode.STRAIGHT_LINE],
  [35, StaticMode.BW_SNOW],
  [40, StaticMode.PIXELATE],
  [80, StaticMode.TRANS_SNOW_OUT],
  [100, StaticMode.TRANS_SNOW_IN],
];

const NOISES: Readonly<Record<number, string>> = {
  [StaticMode.FUZZY_LINE]: 'laptop/static1.wav',
  [StaticMode.STRAIGHT_LINE]: 'laptop/static5.wav',
  [StaticMode.BW_SNOW]: 'laptop/static6.wav',
  [StaticMode.PIXELATE]: 'laptop/static3.wav',
  [StaticMode.TRANS_SNOW_OUT]: 'laptop/static5.wav',
  [StaticMode.TRANS_SNOW_IN]: 'laptop/static4.wav',
};

export type DistortionOverlay = { readonly asset: string; readonly frame: number } | 'shade' | null;

export interface DistortionCounter {
  count: number;
  last: number;
}

export interface DistortionClocks {
  mode: number;
  noisePlayed: boolean;
  lastPick: number;
  readonly line: DistortionCounter;
  readonly pixelate: DistortionCounter;
  readonly snow: DistortionCounter;
}

export function distortionClocks(): DistortionClocks {
  return {
    mode: StaticMode.NO_STATIC,
    noisePlayed: false,
    lastPick: 0,
    line: { count: UNSTARTED_LINE, last: 0 },
    pixelate: { count: UNSTARTED_LINE, last: 0 },
    snow: { count: 0, last: 0 },
  };
}

export interface DistortionPorts {
  random(range: number): number;
  noise(file: string): void;
}

function due(counter: DistortionCounter, now: number): boolean {
  if (u32(now - counter.last) <= DISTORTION_FRAME_TIME) return false;
  counter.last = now;
  return true;
}

export class VideoDistortion {
  overlay: DistortionOverlay = null;
  readonly #clocks: DistortionClocks;
  readonly #ports: DistortionPorts;

  constructor(clocks: DistortionClocks, ports: DistortionPorts) {
    this.#clocks = clocks;
    this.#ports = ports;
  }

  get mode(): number {
    return this.#clocks.mode;
  }

  restart(): void {
    this.#clocks.mode = StaticMode.NO_STATIC;
  }

  clear(): void {
    this.overlay = null;
  }

  update(now: number): void {
    const clocks = this.#clocks;
    const running = clocks.mode;
    this.overlay = null;
    if (running === StaticMode.NO_STATIC) this.#pick(now);
    else {
      clocks.mode = this.#show(running, now);
      this.#playNoise(running);
    }
    if (clocks.mode !== running) clocks.noisePlayed = false;
  }

  #pick(now: number): void {
    const clocks = this.#clocks;
    if (u32(now - clocks.lastPick) <= DISTORTION_PICK_TIME) return;
    const roll = this.#ports.random(DISTORTION_PICK_RANGE);
    clocks.mode = PICKS.find(([below]) => roll < below)?.[1] ?? StaticMode.NO_STATIC;
    clocks.lastPick = now;
  }

  #playNoise(running: number): void {
    const noise = NOISES[running];
    if (this.#clocks.noisePlayed || noise === undefined) return;
    this.#ports.noise(noise);
    this.#clocks.noisePlayed = true;
  }

  #show(running: number, now: number): number {
    switch (running) {
      case StaticMode.FUZZY_LINE:
        return this.#line(running, DistortionAsset.FUZZ_LINES, FUZZ_LINE_FRAMES, now);
      case StaticMode.STRAIGHT_LINE:
        return this.#line(running, DistortionAsset.STRAIGHT_LINES, STRAIGHT_LINE_FRAMES, now);
      case StaticMode.BW_SNOW:
        return this.#line(running, DistortionAsset.BW_SNOW, BW_SNOW_FRAMES, now);
      case StaticMode.PIXELATE:
        return this.#pixelate(now);
      case StaticMode.TRANS_SNOW_IN:
        return this.#transparentSnow(running, true, now);
      case StaticMode.TRANS_SNOW_OUT:
        return this.#transparentSnow(running, false, now);
      default:
        return running;
    }
  }

  #line(running: number, asset: string, frames: number, now: number): number {
    const line = this.#clocks.line;
    if (due(line, now)) line.count = line.count >= frames - 1 ? 0 : line.count + 1;
    if (line.count >= frames) line.count = frames - 1;
    this.overlay = { asset, frame: line.count };
    if (line.count !== frames - 1) return running;
    line.count = 0;
    return running === StaticMode.BW_SNOW ? StaticMode.TRANS_SNOW_OUT : StaticMode.NO_STATIC;
  }

  #pixelate(now: number): number {
    const pixelate = this.#clocks.pixelate;
    if (due(pixelate, now)) pixelate.count = pixelate.count >= PIXELATE_STEPS - 1 ? 0 : pixelate.count + 1;
    this.overlay = 'shade';
    if (pixelate.count !== PIXELATE_STEPS - 1) return StaticMode.PIXELATE;
    pixelate.count = 0;
    return StaticMode.NO_STATIC;
  }

  #transparentSnow(running: number, forward: boolean, now: number): number {
    const snow = this.#clocks.snow;
    const last = TRANS_SNOW_FRAMES - 1;
    if (due(snow, now)) {
      if (forward) snow.count = snow.count > last ? 0 : snow.count + 1;
      else snow.count = snow.count <= 0 ? last : snow.count - 1;
    }
    if (snow.count > last) snow.count = last;
    this.overlay = { asset: DistortionAsset.TRANS_SNOW, frame: snow.count };
    if (forward) {
      if (snow.count !== last) return running;
      snow.count = 0;
      return StaticMode.BW_SNOW;
    }
    return snow.count === 0 ? StaticMode.NO_STATIC : running;
  }
}

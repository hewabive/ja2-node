import { describe, expect, it } from 'vitest';
import {
  DISTORTION_FRAME_TIME,
  DISTORTION_PICK_RANGE,
  DISTORTION_PICK_TIME,
  DistortionAsset,
  type DistortionOverlay,
  distortionClocks,
  FUZZ_LINE_FRAMES,
  StaticMode,
  VideoDistortion,
} from './aim-distortion.ts';

const FRAME_STEP = DISTORTION_FRAME_TIME + 1;
const FIRST_PICK = DISTORTION_PICK_TIME + 1;
const FUZZY_ROLL = 0;
const PIXELATE_ROLL = 37;
const TRANS_SNOW_IN_ROLL = 90;
const CLEAN_ROLL = 150;

interface Script {
  readonly rolls: number[];
  readonly ranges: number[];
  readonly noises: string[];
}

function scripted(rolls: number[]): { distortion: VideoDistortion; script: Script } {
  const script: Script = { rolls, ranges: [], noises: [] };
  const distortion = new VideoDistortion(distortionClocks(), {
    random: (range) => {
      script.ranges.push(range);
      return script.rolls.shift() ?? CLEAN_ROLL;
    },
    noise: (file) => script.noises.push(file),
  });
  return { distortion, script };
}

function runUntilClean(distortion: VideoDistortion, from: number): { overlays: DistortionOverlay[]; now: number } {
  const overlays: DistortionOverlay[] = [];
  let now = from;
  do {
    now += FRAME_STEP;
    distortion.update(now);
    overlays.push(distortion.overlay);
  } while (distortion.mode !== StaticMode.NO_STATIC);
  return { overlays, now };
}

function frames(overlays: readonly DistortionOverlay[], asset: string): number[] {
  return overlays.flatMap((o) => (o && o !== 'shade' && o.asset === asset ? [o.frame] : []));
}

describe('the A.I.M. conference distortion', () => {
  it('rolls Random(200) on the client generator only once more than 2500 ms passed since the last roll, clean rolls included', () => {
    const { distortion, script } = scripted([CLEAN_ROLL, FUZZY_ROLL]);
    distortion.update(DISTORTION_PICK_TIME);
    expect(script.ranges).toEqual([]);
    distortion.update(FIRST_PICK);
    expect(distortion.mode).toBe(StaticMode.NO_STATIC);
    distortion.update(FIRST_PICK + DISTORTION_PICK_TIME);
    expect(script.ranges).toEqual([DISTORTION_PICK_RANGE]);
    distortion.update(FIRST_PICK + DISTORTION_PICK_TIME + 1);
    expect(script.ranges).toEqual([DISTORTION_PICK_RANGE, DISTORTION_PICK_RANGE]);
    expect(distortion.mode).toBe(StaticMode.FUZZY_LINE);
    expect(distortion.overlay).toBeNull();
  });

  it('runs a fuzzy line through its ten frames with one static sample, then leaves the face clean', () => {
    const { distortion, script } = scripted([FUZZY_ROLL]);
    distortion.update(FIRST_PICK);
    const { overlays } = runUntilClean(distortion, FIRST_PICK);
    expect(frames(overlays, DistortionAsset.FUZZ_LINES)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(script.noises).toEqual(['laptop/static1.wav']);
  });

  it('shows the first line frame only on the first run: its counter starts at 255 and wraps past frame 0 afterwards', () => {
    const { distortion } = scripted([FUZZY_ROLL, FUZZY_ROLL]);
    distortion.update(FIRST_PICK);
    const first = runUntilClean(distortion, FIRST_PICK);
    const again = first.now + FIRST_PICK;
    distortion.update(again);
    const second = runUntilClean(distortion, again);
    expect(frames(first.overlays, DistortionAsset.FUZZ_LINES)).toHaveLength(FUZZ_LINE_FRAMES);
    expect(frames(second.overlays, DistortionAsset.FUZZ_LINES)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('fades the transparent snow in, shows black-and-white snow, fades it out, each with its own static sample', () => {
    const { distortion, script } = scripted([TRANS_SNOW_IN_ROLL]);
    distortion.update(FIRST_PICK);
    const { overlays } = runUntilClean(distortion, FIRST_PICK);
    expect(frames(overlays, DistortionAsset.TRANS_SNOW)).toEqual([1, 2, 3, 4, 5, 6, 6, 5, 4, 3, 2, 1, 0]);
    expect(frames(overlays, DistortionAsset.BW_SNOW)).toEqual([0, 1, 2, 3, 4]);
    expect(script.noises).toEqual(['laptop/static4.wav', 'laptop/static6.wav', 'laptop/static5.wav']);
  });

  it('shades the face for the four pixelate steps', () => {
    const { distortion, script } = scripted([PIXELATE_ROLL]);
    distortion.update(FIRST_PICK);
    const { overlays } = runUntilClean(distortion, FIRST_PICK);
    expect(overlays).toEqual(['shade', 'shade', 'shade', 'shade']);
    expect(script.noises).toEqual(['laptop/static3.wav']);
  });

  it('holds a frame until more than 100 ms passed', () => {
    const { distortion } = scripted([FUZZY_ROLL]);
    distortion.update(FIRST_PICK);
    distortion.update(FIRST_PICK + FRAME_STEP);
    distortion.update(FIRST_PICK + FRAME_STEP + DISTORTION_FRAME_TIME);
    expect(distortion.overlay).toEqual({ asset: DistortionAsset.FUZZ_LINES, frame: 0 });
    distortion.update(FIRST_PICK + 2 * FRAME_STEP);
    expect(distortion.overlay).toEqual({ asset: DistortionAsset.FUZZ_LINES, frame: 1 });
  });
});

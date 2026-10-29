import { describe, expect, it } from 'vitest';
import { frameDueAt, frameToFinishDecoding, frameToRequest, videoDurationSeconds, videoFinished, wallClock } from './pacing.ts';

const FIFTEEN_FPS = { frameCount: 30, microsPerFrame: 66_660 };

describe('video pacing', () => {
  it('shows frame n once n frame periods have passed on the clock', () => {
    expect(frameDueAt(FIFTEEN_FPS, -1)).toBe(0);
    expect(frameDueAt(FIFTEEN_FPS, 0.06665)).toBe(0);
    expect(frameDueAt(FIFTEEN_FPS, 0.0667)).toBe(1);
    expect(frameDueAt(FIFTEEN_FPS, 1)).toBe(15);
  });

  it('ends the video when the frame after the last one is due', () => {
    expect(videoDurationSeconds(FIFTEEN_FPS)).toBeCloseTo(1.9998, 6);
    expect(videoFinished(FIFTEEN_FPS, 1.9997)).toBe(false);
    expect(videoFinished(FIFTEEN_FPS, 1.9999)).toBe(true);
  });

  it('asks for the newest due frame only, skipping late ones, one request at a time', () => {
    expect(frameToRequest(FIFTEEN_FPS, -1, false, 0)).toBe(0);
    expect(frameToRequest(FIFTEEN_FPS, 0, false, 0.05)).toBeNull();
    expect(frameToRequest(FIFTEEN_FPS, 0, false, 0.5)).toBe(7);
    expect(frameToRequest(FIFTEEN_FPS, 0, true, 0.5)).toBeNull();
    expect(frameToRequest(FIFTEEN_FPS, 7, false, 1.99)).toBe(29);
    expect(frameToRequest(FIFTEEN_FPS, 29, false, 2.5)).toBeNull();
  });

  it('decodes up to the last frame once the clock ends the video, as the original steps to SMK_DONE', () => {
    expect(frameToFinishDecoding(FIFTEEN_FPS, 28)).toBe(29);
    expect(frameToFinishDecoding(FIFTEEN_FPS, 30)).toBeNull();
  });

  it('counts wall time from its start', () => {
    let now = 1000;
    const clock = wallClock(() => now);
    now = 1250;
    expect(clock.source).toBe('wall');
    expect(clock.elapsed()).toBe(0.25);
  });
});

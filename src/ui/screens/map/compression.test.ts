import { describe, expect, it } from 'vitest';
import { FontColor } from '../../../content/text/font-colors.ts';
import { CompressionBlink, CompressMode, compressionCommand, compressionLabelIndex, compressionLabelSteady } from './compression.ts';

const PERIOD = 500;

describe('map screen time compression requests', () => {
  it('starts over at 5 minutes per second, steps up to 60 and skips X1 like the map screen', () => {
    expect(compressionCommand({ compressing: false, mode: CompressMode.MIN30 }, 'more')).toEqual({
      type: 'compressTime',
      mode: CompressMode.MIN5,
    });
    expect(compressionCommand({ compressing: true, mode: CompressMode.MIN5 }, 'more')).toEqual({
      type: 'compressTime',
      mode: CompressMode.MIN30,
    });
    expect(compressionCommand({ compressing: true, mode: CompressMode.X1 }, 'more')).toEqual({
      type: 'compressTime',
      mode: CompressMode.MIN5,
    });
    expect(compressionCommand({ compressing: true, mode: CompressMode.MIN60 }, 'more')).toBeNull();
  });

  it('steps down, stops below 5 minutes and does nothing while time stands', () => {
    expect(compressionCommand({ compressing: true, mode: CompressMode.MIN60 }, 'less')).toEqual({
      type: 'compressTime',
      mode: CompressMode.MIN30,
    });
    expect(compressionCommand({ compressing: true, mode: CompressMode.MIN5 }, 'less')).toEqual({ type: 'stopTime' });
    expect(compressionCommand({ compressing: false, mode: CompressMode.MIN5 }, 'less')).toBeNull();
  });

  it('toggles between starting at the kept mode and stopping', () => {
    expect(compressionCommand({ compressing: false, mode: CompressMode.MIN30 }, 'toggle')).toEqual({ type: 'compressTime' });
    expect(compressionCommand({ compressing: true, mode: CompressMode.MIN30 }, 'toggle')).toEqual({ type: 'stopTime' });
  });

  it('labels the mode only while compressing and blinks unless a mode is set and the game runs', () => {
    expect(compressionLabelIndex({ compressing: true, mode: CompressMode.MIN30 })).toBe(CompressMode.MIN30);
    expect(compressionLabelIndex({ compressing: false, mode: CompressMode.MIN30 })).toBe(CompressMode.X0);
    expect(compressionLabelIndex(null)).toBe(CompressMode.X0);
    expect(compressionLabelSteady({ mode: CompressMode.MIN5, paused: false })).toBe(true);
    expect(compressionLabelSteady({ mode: CompressMode.MIN5, paused: true })).toBe(false);
    expect(compressionLabelSteady({ mode: CompressMode.X0, paused: false })).toBe(false);
    const blink = new CompressionBlink(PERIOD);
    expect(blink.colour(PERIOD, false)).toBe(FontColor.WHITE);
    expect(blink.colour(PERIOD + 1, false)).toBe(FontColor.WHITE);
    expect(blink.colour(2 * PERIOD, false)).toBe(FontColor.LTGREEN);
    expect(blink.colour(3 * PERIOD, true)).toBe(FontColor.LTGREEN);
  });
});

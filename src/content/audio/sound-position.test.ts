import { describe, expect, it } from 'vitest';
import { cueOf, mixCue } from './cue.ts';
import { balanceGains, NOWHERE, Pan, positionSoundVolume, type ScreenView, scaleVolume, soundDir, soundVolume } from './sound-position.ts';

const COLS = 160;
const centre = 80 * COLS + 80;
const view: ScreenView = { centerX: 800, centerY: 800, width: 640, height: 360 };
const volumes = { effects: 63, speech: 63, music: 63, ambient: 63 };

describe('the original volume and pan formulas', () => {
  it('scale a volume like CalculateSoundEffectsVolume: (v * setting + 63) / 127, truncated', () => {
    expect(scaleVolume(127, 63)).toBe(63);
    expect(scaleVolume(63, 63)).toBe(31);
    expect(scaleVolume(127, 127)).toBe(127);
    expect(scaleVolume(25, 0)).toBe(0);
    expect(scaleVolume(65, 100)).toBe(51);
  });

  it('pan to the middle within 64 screen pixels, to 48 or 80 inside half the view and to 1 or 126 beyond', () => {
    expect(soundDir(centre, view)).toBe(Pan.MIDDLE);
    expect(soundDir(NOWHERE, view)).toBe(Pan.MIDDLE);
    expect(soundDir(centre - 3, view)).toBe(Pan.MIDDLE);
    expect(soundDir(centre - 4, view)).toBe(Pan.LEFT);
    expect(soundDir(centre + 16, view)).toBe(Pan.RIGHT);
    expect(soundDir(centre + 30 + 30 * COLS, view)).toBe(Pan.MIDDLE);
    expect(soundDir(centre - 17, view)).toBe(Pan.FAR_LEFT_OFF_SCREEN);
    expect(soundDir(centre + 17, view)).toBe(Pan.FAR_RIGHT_OFF_SCREEN);
  });

  it('keep the base volume on screen and drop 25 with a floor of 25 off screen, without distance falloff', () => {
    expect(soundVolume(127, centre, view)).toBe(127);
    expect(soundVolume(127, centre + 15, view)).toBe(127);
    expect(soundVolume(127, centre + 40, view)).toBe(102);
    expect(soundVolume(127, centre + 70, view)).toBe(102);
    expect(soundVolume(40, centre + 40, view)).toBe(25);
    expect(soundVolume(10, centre + 40, view)).toBe(25);
    expect(soundVolume(127, centre + 20 * COLS + 20, view)).toBe(102);
    expect(soundVolume(127, centre + 8 * COLS + 8, view)).toBe(127);
    expect(soundVolume(127, NOWHERE, view)).toBe(127);
  });

  it('fade a positional loop linearly to silence at one and a half views', () => {
    expect(positionSoundVolume(15, centre, view)).toBe(15);
    expect(positionSoundVolume(15, centre + 40, view)).toBeLessThan(15);
    expect(positionSoundVolume(15, centre + 400, view)).toBe(0);
  });

  it('split a volume into a linear balance with the mixer shift: vol * (127 - pan) / 127 / 128', () => {
    expect(balanceGains(127, 0)).toEqual({ left: 127 / 128, right: 0 });
    expect(balanceGains(127, 64)).toEqual({ left: 63 / 128, right: 64 / 128 });
    expect(balanceGains(127, 127)).toEqual({ left: 0, right: 127 / 128 });
  });
});

describe('cue mixing', () => {
  it('scales soldier samples twice, location samples once (PlaySoldierJA2Sample keeps its double scaling)', () => {
    const location = mixCue(cueOf('a.wav', 'location', 127, centre), view, volumes);
    const soldier = mixCue(cueOf('a.wav', 'soldier', 127, centre), view, volumes);
    expect(location).toEqual({ volume: 63, pan: Pan.MIDDLE });
    expect(soldier).toEqual({ volume: 31, pan: Pan.MIDDLE });
  });

  it('applies the speech volume before the off-screen drop for other teams, and not at all for our voices', () => {
    const far = centre + 40;
    expect(mixCue(cueOf('v.wav', 'voiceOther', 127, far), view, volumes)).toEqual({ volume: 38, pan: Pan.FAR_RIGHT_OFF_SCREEN });
    expect(mixCue(cueOf('v.wav', 'voiceOwn', 127, far), view, volumes)).toEqual({ volume: 63, pan: Pan.FAR_RIGHT_OFF_SCREEN });
  });

  it('keeps the fixed pan of non-positional cues and uses SoundDir for panned misses', () => {
    expect(mixCue(cueOf('r.wav', 'fixed', 127, NOWHERE, 20), view, volumes)).toEqual({ volume: 63, pan: 20 });
    expect(mixCue(cueOf('m.wav', 'panned', 65, centre + 40), view, volumes)).toEqual({ volume: 32, pan: Pan.FAR_RIGHT_OFF_SCREEN });
    expect(mixCue(cueOf('s.wav', 'speech', 127), view, { ...volumes, speech: 127 })).toEqual({ volume: 127, pan: Pan.MIDDLE });
    expect(mixCue(cueOf('b.wav', 'ambient', 40), view, { ...volumes, ambient: 127 })).toEqual({ volume: 40, pan: Pan.MIDDLE });
  });
});

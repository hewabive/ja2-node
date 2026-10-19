import { describe, expect, it } from 'vitest';
import { AimAd, AimAds, nextAimAd } from './aim-ads.ts';

const FRAME_MS = 16;
const WARNING_MS = 10_000;

function runUntil(ads: AimAds, from: number, done: () => boolean, day = 1, bobbyRayOpen = false): number {
  let now = from;
  while (!done()) {
    ads.update(now, day, bobbyRayOpen);
    now += FRAME_MS;
    if (now - from > 120_000) throw new Error('the ads never changed');
  }
  return now;
}

describe('the A.I.M. ads', () => {
  it('alternates the warning box with the ad of the day', () => {
    expect(nextAimAd(AimAd.FUNERAL, 1, false)).toBe(AimAd.WARNING_BOX);
    expect(nextAimAd(AimAd.WARNING_BOX, 1, false)).toBe(AimAd.FOR_ADS);
    expect(nextAimAd(AimAd.WARNING_BOX, 1, true)).toBe(AimAd.BOBBY_RAY);
    expect(nextAimAd(AimAd.WARNING_BOX, 3, true)).toBe(AimAd.FUNERAL);
    expect(nextAimAd(AimAd.WARNING_BOX, 6, true)).toBe(AimAd.FLOWER_SHOP);
    expect(nextAimAd(AimAd.WARNING_BOX, 7, true)).toBe(AimAd.INSURANCE);
  });

  it('holds the warning box ten seconds and then runs the ad with its first and last frames held', () => {
    const ads = new AimAds();
    ads.update(0, 1, false);
    expect(ads.shown).toEqual({ ad: AimAd.WARNING_BOX, frame: 0, text: 'none' });
    expect(ads.clickable).toBe(false);
    const switched = runUntil(ads, FRAME_MS, () => ads.current !== AimAd.WARNING_BOX);
    expect(switched).toBeGreaterThan(WARNING_MS);
    expect(ads.current).toBe(AimAd.FOR_ADS);
    const frames: number[] = [];
    const back = runUntil(ads, switched, () => {
      if (ads.current === AimAd.WARNING_BOX) return true;
      if (frames.at(-1) !== ads.shown.frame) frames.push(ads.shown.frame);
      return false;
    });
    expect(frames).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(back - switched).toBeGreaterThan(24 * 150);
  });

  it('ducks Bobby Ray twice before the full animation and switches the texts by frame', () => {
    const ads = new AimAds();
    const start = runUntil(ads, 0, () => ads.current === AimAd.BOBBY_RAY, 1, true);
    expect(ads.clickable).toBe(true);
    const shown: string[] = [];
    runUntil(
      ads,
      start,
      () => {
        const key = `${ads.shown.frame}:${ads.shown.text}`;
        if (ads.current === AimAd.BOBBY_RAY && shown.at(-1) !== key) shown.push(key);
        return ads.current !== AimAd.BOBBY_RAY;
      },
      1,
      true,
    );
    const frames = shown.map((s) => Number(s.split(':')[0]));
    expect(frames.slice(0, 14)).toEqual([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]);
    expect(frames.at(-1)).toBe(20);
    expect(shown[0]).toBe('0:bobbyRay1');
    expect(shown.at(-1)).toBe('20:bobbyRay2');
  });

  it('shows the flower texts on frame 0 after the sixteen frames', () => {
    const ads = new AimAds();
    runUntil(ads, 0, () => ads.current === AimAd.FLOWER_SHOP, 6, true);
    const seen = new Set<string>();
    let now = runUntil(ads, 0, () => ads.shown.text === 'flower', 6, true);
    for (let i = 0; i < 10; i++, now += FRAME_MS) {
      ads.update(now, 6, true);
      seen.add(`${ads.shown.frame}:${ads.shown.text}`);
    }
    expect([...seen]).toEqual(['0:flower']);
  });
});

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIM.cc HandleAdAndWarningArea, GetNextAimAd (the ad by the world day and Bobby Ray's site),
// @src DrawWarningBox (AIM_WARNING_TIME), DisplayAd (the first and last frames held 13 steps), DisplayFlowerAd (16 frames,
// @src then frame 0 with the texts held 41 steps), DisplayBobbyRAd (the duck frames 0-6 twice, then 7-20, the last held
// @src 13 steps), HandleTextOnAimAdd (the Bobby Ray texts by the next frame), SelectBannerRegionCallBack. One step at most
// @src per update, when more than the delay passed since the last one, as the original does once per frame. See docs/28 §9.4.

export const AimAd = {
  WARNING_BOX: 2,
  FOR_ADS: 3,
  BOBBY_RAY: 4,
  FUNERAL: 5,
  FLOWER_SHOP: 6,
  INSURANCE: 7,
  LAST: 8,
} as const;

export type AimAdText = 'none' | 'flower' | 'bobbyRay1' | 'bobbyRay2';

export interface AimAdFrame {
  readonly ad: number;
  readonly frame: number;
  readonly text: AimAdText;
}

const WARNING_TIME = 10000;
const FLOWER_DELAY = 150;
const FLOWER_FRAMES = 16;
const FLOWER_HOLD = 40;
const FOR_ADS_DELAY = 150;
const FOR_ADS_FRAMES = 13;
const INSURANCE_DELAY = 150;
const INSURANCE_FRAMES = 10;
const FUNERAL_DELAY = 250;
const FUNERAL_FRAMES = 9;
const BOBBY_RAY_DELAY = 300;
const BOBBY_RAY_FRAMES = 21;
const BOBBY_RAY_DUCK_FRAMES = 6;
const BOBBY_RAY_DUCK_PASSES = 2;
const HELD_STEPS = 12;
const BOBBY_RAY_AD_STARTS = 2;
const FUNERAL_AD_STARTS = 4;
const FLOWER_AD_STARTS = 7;
const BOBBY_RAY_SECOND_TEXT = BOBBY_RAY_FRAMES - 5;

const CLICKABLE: ReadonlySet<number> = new Set([AimAd.BOBBY_RAY, AimAd.FUNERAL, AimAd.FLOWER_SHOP, AimAd.INSURANCE]);

export function nextAimAd(current: number, day: number, bobbyRayOpen: boolean): number {
  if (current !== AimAd.WARNING_BOX) return AimAd.WARNING_BOX;
  if (day < BOBBY_RAY_AD_STARTS) return bobbyRayOpen ? AimAd.BOBBY_RAY : AimAd.FOR_ADS;
  if (day < FUNERAL_AD_STARTS) return AimAd.FUNERAL;
  if (day < FLOWER_AD_STARTS) return AimAd.FLOWER_SHOP;
  return AimAd.INSURANCE;
}

export class AimAds {
  current: number = AimAd.WARNING_BOX;
  shown: AimAdFrame = { ad: AimAd.WARNING_BOX, frame: 0, text: 'none' };
  #done = false;
  #init = true;
  #lastTime = 0;
  #subImage = 0;
  #count = 0;
  #duckCount = 0;

  get clickable(): boolean {
    return CLICKABLE.has(this.current);
  }

  update(now: number, day: number, bobbyRayOpen: boolean): void {
    if (!this.#init && this.#done) {
      this.current = nextAimAd(this.current, day, bobbyRayOpen);
      this.#init = true;
    }
    if (this.current >= AimAd.LAST) this.current = AimAd.WARNING_BOX;
    const init = this.#init;
    this.#init = false;
    switch (this.current) {
      case AimAd.WARNING_BOX:
        this.#done = this.#warning(init, now);
        break;
      case AimAd.FLOWER_SHOP:
        this.#done = this.#flower(init, now);
        break;
      case AimAd.FOR_ADS:
        this.#done = this.#ad(init, now, FOR_ADS_DELAY, FOR_ADS_FRAMES);
        break;
      case AimAd.INSURANCE:
        this.#done = this.#ad(init, now, INSURANCE_DELAY, INSURANCE_FRAMES);
        break;
      case AimAd.FUNERAL:
        this.#done = this.#ad(init, now, FUNERAL_DELAY, FUNERAL_FRAMES);
        break;
      default:
        this.#done = this.#bobbyRay(init, now);
        break;
    }
  }

  #show(frame: number, text: AimAdText = 'none'): void {
    this.shown = { ad: this.current, frame, text };
  }

  #warning(init: boolean, now: number): boolean {
    if (init) {
      this.#show(0);
      this.#lastTime = now;
    }
    return now - this.#lastTime > WARNING_TIME;
  }

  #reset(): void {
    this.#lastTime = 0;
    this.#subImage = 0;
    this.#count = 0;
    this.#duckCount = 0;
  }

  #flower(init: boolean, now: number): boolean {
    if (init) this.#reset();
    if (now - this.#lastTime <= FLOWER_DELAY && !init) return false;
    if (this.#subImage === FLOWER_FRAMES) {
      if (this.#count === 0) this.#show(0, 'flower');
      this.#lastTime = now;
      this.#count++;
      return this.#count > FLOWER_HOLD;
    }
    this.#show(this.#subImage++);
    this.#lastTime = now;
    return false;
  }

  #ad(init: boolean, now: number, delay: number, frames: number): boolean {
    if (init) this.#reset();
    if (now - this.#lastTime <= delay && !init) return false;
    let done = false;
    if (this.#subImage === 0) {
      if (this.#count === 0) this.#show(0);
      this.#count++;
      if (this.#count > HELD_STEPS) {
        this.#count = 0;
        this.#subImage++;
      }
    } else if (this.#subImage === frames - 1) {
      if (this.#count === 0) this.#show(this.#subImage);
      this.#count++;
      if (this.#count > HELD_STEPS) done = true;
    } else this.#show(this.#subImage++);
    this.#lastTime = now;
    return done;
  }

  #bobbyRay(init: boolean, now: number): boolean {
    if (init) this.#reset();
    if (now - this.#lastTime <= BOBBY_RAY_DELAY && !init) return false;
    const drawn = this.#subImage;
    let done = false;
    if (this.#duckCount < BOBBY_RAY_DUCK_PASSES) {
      this.#subImage++;
      if (this.#subImage > BOBBY_RAY_DUCK_FRAMES) {
        this.#duckCount++;
        this.#subImage = this.#duckCount < BOBBY_RAY_DUCK_PASSES ? 0 : BOBBY_RAY_DUCK_FRAMES + 1;
      }
    } else {
      this.#subImage++;
      if (this.#subImage >= BOBBY_RAY_FRAMES - 1) {
        this.#count++;
        if (this.#count > HELD_STEPS) done = true;
        this.#subImage = BOBBY_RAY_FRAMES - 1;
      }
    }
    const text: AimAdText =
      this.#subImage <= BOBBY_RAY_DUCK_FRAMES ? 'bobbyRay1' : this.#subImage >= BOBBY_RAY_SECOND_TEXT ? 'bobbyRay2' : 'none';
    this.#show(drawn, text);
    this.#lastTime = now;
    return done;
  }
}

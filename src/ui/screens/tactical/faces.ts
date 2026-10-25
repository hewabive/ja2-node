// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Faces.cc InitFace (the blink frequency ± Random(2000), the eye delay 50 + Random(30), the eight
// @src subimages of an animated face), GetFaceRelativeCoordinates, BlinkAutoFace, NewEye, MouthAutoFace, NewMouth,
// @src HandleTalkingAutoFace, SetupFinalTalkingDelay, SetFaceShade, HandleFaceHilights, DrawFaceRect,
// @src HandleRenderFaceAdjustments (closed eyes, hatch, skull, enemy count, hatch for those who cannot act, the text over the
// @src face, the right icons and the bottom-right icon), HandleAutoFaces (the portrait flash); src/game/Tactical/Gap.cc
// @src PollAudioGap; src/game/Tactical/Interface.h FLASH_PORTRAIT_*. See docs/28 §5.5.

import { type AudioGap, inAudioGap } from '../../../content/formats/gap.ts';
import type { ProfilePresentation } from '../../../content/narrative/profile-presentation.ts';
import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import type { SoldierView } from '../../../protocol/view.ts';
import type { ImageCatalog } from '../../assets.ts';
import { type DrawList, type PaletteShade, rgb } from '../../draw-list.ts';
import { type BitmapFont, fontHeight } from '../../text/bitmap-font.ts';
import { hCenterVCenterAlign, stringPixLength } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { GENERIC_FACE, genericFacePath } from './generic-face.ts';

export const OKLIFE = 15;
export const CONSCIOUSNESS = 10;
const ANIMATED_FACE_FRAMES = 8;
const EYES_CLOSED_FRAME = 1;
const EYES_LID_UP_FRAME = 2;
const EYES_FROWN_FRAME = 3;
const EYES_SURPRISE_FRAME = 4;
const MOUTH_FRAME_OFFSET = 4;
const EXPRESSION_HOLD = 6;
const BLINK_SPREAD_MS = 2000;
const EYE_DELAY_MS = 50;
const EYE_DELAY_SPREAD_MS = 30;
const MOUTH_STEP_MS = 120;
const MOUTH_DRAW = 6;
const MOUTH_FRAMES = 3;
const FINAL_TALKING_DELAY_MS = 300;
const FLASH_PORTRAIT_DELAY_MS = 150;
const FACES_DIR = 'faces';
const DEAD_FRAME = 5;
const ROBOT_UNCONTROLLED_ICON = 5;
const DOCTOR_ICON = 1;
const PATIENT_ICON = 2;
const BLINDED_ICON = 6;

const Expression = { NONE: 0, BLINKING: 1, ANGRY: 2, SURPRISED: 3 } as const;
type Expression = (typeof Expression)[keyof typeof Expression];

export const FaceShade = { NOSHADE: 0, STARTSHADE: 1, ENDSHADE: 2, DARKSHADE: 3, GRAYSHADE: 4, LITESHADE: 5 } as const;
export type FaceShade = (typeof FaceShade)[keyof typeof FaceShade];

const SHADES: Readonly<Record<FaceShade, PaletteShade>> = {
  [FaceShade.NOSHADE]: { red: 255, green: 255, blue: 255, mono: false },
  [FaceShade.STARTSHADE]: { red: 255, green: 255, blue: 255, mono: false, base: 'white' },
  [FaceShade.ENDSHADE]: { red: 250, green: 25, blue: 25, mono: true },
  [FaceShade.DARKSHADE]: { red: 100, green: 100, blue: 100, mono: true },
  [FaceShade.GRAYSHADE]: { red: 255, green: 255, blue: 255, mono: false, base: 'grayRamp' },
  [FaceShade.LITESHADE]: { red: 100, green: 100, blue: 100, mono: false },
};

export const WHITE_HILIGHT = rgb(255, 255, 255);
export const MOVING_HILIGHT = rgb(8, 12, 118);
export const STEALTH_MOVING_HILIGHT = rgb(158, 158, 12);
export const NO_HILIGHT = rgb(0, 0, 0);
export const COMPATIBLE_HILIGHT = rgb(255, 0, 0);
const ENEMY_BOX = rgb(105, 8, 9);

export interface FaceRecord {
  readonly path: string;
  readonly eyes: readonly [number, number];
  readonly mouth: readonly [number, number];
  readonly blinkFrequency: number;
  readonly expressionFrequency: number;
}

export function faceFileOf(faceIndex: number): string {
  return `${FACES_DIR}/${String(faceIndex).padStart(2, '0')}.sti`;
}

export function faceRecordOf(soldier: SoldierView, profile: ProfilePresentation | null): FaceRecord {
  if (soldier.profile === undefined || !profile) {
    return {
      path: genericFacePath(soldier.bodyType),
      eyes: GENERIC_FACE.eyes,
      mouth: GENERIC_FACE.mouth,
      blinkFrequency: GENERIC_FACE.blinkFrequency,
      expressionFrequency: GENERIC_FACE.expressionFrequency,
    };
  }
  const recruited = soldier.kind === 'rpc' || soldier.kind === 'epc';
  const small = recruited ? profile.smallFace : null;
  return {
    path: faceFileOf(profile.faceIndex),
    eyes: small?.eyes ?? profile.eyes,
    mouth: small?.mouth ?? profile.mouth,
    blinkFrequency: profile.blinkFrequency,
    expressionFrequency: profile.expressionFrequency,
  };
}

export type FaceSubject = Pick<SoldierView, 'asleep' | 'life'>;

export interface FaceSpeech {
  readonly playing: boolean;
  readonly elapsedMs: number;
  readonly gaps: readonly AudioGap[];
}

const FlashState = { STOP: 0, START: 1, WAITING: 2 } as const;
type FlashState = (typeof FlashState)[keyof typeof FlashState];

export class FaceAnimator {
  readonly record: FaceRecord;
  readonly #random: (range: number) => number;
  readonly #blinkFrequency: number;
  readonly #eyeDelay: number;
  #eyeFrame = 0;
  #mouthFrame = 0;
  #expression: Expression = Expression.NONE;
  #eyeWait = 0;
  #lastBlink: number;
  #lastExpression: number;
  #eyeLast: number;
  #mouthLast = 0;
  #talking = false;
  #animatingTalking = false;
  #finishTalking = false;
  #talkingTimer = 0;
  #flash: FlashState = FlashState.STOP;
  #flashFrame: FaceShade = FaceShade.STARTSHADE;
  #flashSince = 0;
  #gettingHit = false;

  constructor(record: FaceRecord, now: number, random: (range: number) => number) {
    this.record = record;
    this.#random = random;
    this.#eyeDelay = EYE_DELAY_MS + random(EYE_DELAY_SPREAD_MS);
    const spread = random(2) ? random(BLINK_SPREAD_MS) : -random(BLINK_SPREAD_MS);
    this.#blinkFrequency = (record.blinkFrequency + spread) >>> 0;
    this.#lastBlink = now;
    this.#lastExpression = now;
    this.#eyeLast = now;
  }

  get eyeFrame(): number {
    return this.#eyeFrame;
  }

  get mouthFrame(): number {
    return this.#mouthFrame;
  }

  get talking(): boolean {
    return this.#talking;
  }

  get blinkFrequency(): number {
    return this.#blinkFrequency;
  }

  invalidAnim(images: ImageCatalog): boolean {
    const info = images.info(this.record.path);
    if (!info || info.frames.length !== ANIMATED_FACE_FRAMES) return true;
    return this.record.eyes[1] === 0 || this.record.mouth[1] === 0;
  }

  hit(now: number): void {
    this.#gettingHit = true;
    if (this.#flash === FlashState.STOP) this.#startFlash(now);
  }

  hitOver(): void {
    this.#gettingHit = false;
  }

  #startFlash(now: number): void {
    this.#flash = FlashState.START;
    this.#flashFrame = FaceShade.STARTSHADE;
    this.#flashSince = now;
  }

  update(now: number, soldier: FaceSubject, speech: FaceSpeech | null, images: ImageCatalog): void {
    this.#updateFlash(now);
    this.#updateTalking(now, speech);
    if (this.invalidAnim(images)) return;
    this.#blink(now, soldier);
    this.#mouth(now, speech);
  }

  #updateFlash(now: number): void {
    if (this.#flash === FlashState.START) {
      while (now - this.#flashSince >= FLASH_PORTRAIT_DELAY_MS && this.#flash === FlashState.START) {
        this.#flashSince += FLASH_PORTRAIT_DELAY_MS;
        if (this.#flashFrame + 1 > FaceShade.ENDSHADE) {
          this.#flashFrame = FaceShade.ENDSHADE;
          this.#flash = this.#gettingHit ? FlashState.WAITING : FlashState.STOP;
        } else this.#flashFrame = (this.#flashFrame + 1) as FaceShade;
      }
    }
    if (this.#flash === FlashState.WAITING && !this.#gettingHit) this.#flash = FlashState.STOP;
  }

  #updateTalking(now: number, speech: FaceSpeech | null): void {
    const speaking = speech?.playing ?? false;
    if (speaking && !this.#talking) {
      this.#talking = true;
      this.#animatingTalking = true;
      this.#finishTalking = false;
      return;
    }
    if (!this.#talking) return;
    if (!this.#finishTalking) {
      if (!speaking) {
        this.#finishTalking = true;
        this.#animatingTalking = false;
        this.#talkingTimer = now;
        this.#mouthFrame = 0;
      }
      return;
    }
    if (now - this.#talkingTimer > FINAL_TALKING_DELAY_MS) {
      this.#talking = false;
      this.#animatingTalking = false;
      this.#finishTalking = false;
    }
  }

  #blink(now: number, s: FaceSubject): void {
    if (s.asleep === true || (s.life ?? 0) < OKLIFE) return;
    if (this.#expression === Expression.NONE) {
      if (now - this.#lastBlink > this.#blinkFrequency) {
        this.#lastBlink = now;
        this.#expression = Expression.BLINKING;
        this.#eyeLast = now;
      }
      if (this.#animatingTalking && now - this.#lastExpression > this.record.expressionFrequency) {
        this.#lastExpression = now;
        this.#expression = this.#random(2) === 0 ? Expression.ANGRY : Expression.SURPRISED;
      }
    }
    if (this.#expression !== Expression.NONE && now - this.#eyeLast > this.#eyeDelay) {
      this.#eyeLast = now;
      this.#newEye();
      if (this.#eyeFrame <= 0) this.#expression = Expression.NONE;
    }
  }

  #newEye(): void {
    switch (this.#eyeFrame) {
      case 0:
        if (this.#expression === Expression.ANGRY) {
          this.#eyeWait = 0;
          this.#eyeFrame = EYES_FROWN_FRAME;
        } else if (this.#expression === Expression.SURPRISED) {
          this.#eyeWait = 0;
          this.#eyeFrame = EYES_SURPRISE_FRAME;
        } else this.#eyeFrame = EYES_CLOSED_FRAME;
        return;
      case EYES_CLOSED_FRAME:
        this.#eyeFrame = EYES_LID_UP_FRAME;
        return;
      case EYES_LID_UP_FRAME:
        this.#eyeFrame = 0;
        return;
      case EYES_FROWN_FRAME:
      case EYES_SURPRISE_FRAME:
        this.#eyeWait++;
        if (this.#eyeWait > EXPRESSION_HOLD) this.#eyeFrame = 0;
        return;
      default:
        this.#eyeFrame = 0;
    }
  }

  #mouth(now: number, speech: FaceSpeech | null): void {
    if (!this.#talking || !this.#animatingTalking) return;
    if (speech && inAudioGap(speech.gaps, speech.elapsedMs)) {
      this.#mouthFrame = 0;
      return;
    }
    if (now - this.#mouthLast > MOUTH_STEP_MS) {
      this.#mouthLast = now;
      this.#newMouth();
    }
  }

  #newMouth(): void {
    const old = this.#mouthFrame;
    let frame: number;
    do {
      frame = this.#random(MOUTH_DRAW);
      if (frame > MOUTH_FRAMES) frame = 0;
    } while (frame === old);
    this.#mouthFrame = frame;
  }

  shade(soldier: SoldierView, inCombat: boolean): FaceShade {
    if (this.#flash === FlashState.START || this.#flash === FlashState.WAITING) return this.#flashFrame;
    if ((soldier.life ?? 0) < OKLIFE) return FaceShade.DARKSHADE;
    if (soldier.ap === 0 && inCombat) return FaceShade.LITESHADE;
    return FaceShade.NOSHADE;
  }
}

export function shadeOf(shade: FaceShade): PaletteShade {
  return SHADES[shade];
}

export interface FaceArt {
  readonly hatch: string;
  readonly dead: string;
  readonly icons: string;
}

export interface FaceOverlays {
  readonly highlight: number | null;
  readonly compatible: boolean;
  readonly hatched: boolean;
  readonly deadPanelRunning: boolean;
  readonly textOver: string | null;
}

export interface FaceFonts {
  readonly tiny: BitmapFont;
}

export interface FaceDrawContext {
  readonly list: DrawList;
  readonly images: ImageCatalog;
  readonly art: FaceArt;
  readonly fonts: FaceFonts;
  readonly inCombat: boolean;
}

function faceSize(images: ImageCatalog, path: string): { width: number; height: number } {
  const frame = images.info(path)?.frames[0];
  return { width: frame?.width ?? 0, height: frame?.height ?? 0 };
}

export function drawFaceRect(list: DrawList, x: number, y: number, width: number, height: number, colour: number): void {
  list.rectangle(x - 2, y - 1, x + width + 1, y + height, colour);
}

function iconSize(images: ImageCatalog, path: string, index: number): { width: number; height: number } {
  const frame = images.info(path)?.frames[index];
  return { width: frame?.width ?? 0, height: frame?.height ?? 0 };
}

function bottomRightIcon(soldier: SoldierView): number | null {
  let icon: number | null = null;
  if (soldier.controlled === false) icon = ROBOT_UNCONTROLLED_ICON;
  if (soldier.firstAid === 'medic') icon = DOCTOR_ICON;
  if (soldier.firstAid === 'patient') icon = PATIENT_ICON;
  return icon;
}

export function drawFace(
  ctx: FaceDrawContext,
  soldier: SoldierView,
  face: FaceAnimator,
  x: number,
  y: number,
  overlays: FaceOverlays,
): void {
  const { list, images, art } = ctx;
  const path = face.record.path;
  const size = faceSize(images, path);
  const eyesX = x + face.record.eyes[0];
  const eyesY = y + face.record.eyes[1];
  const faceShade = { shade: shadeOf(face.shade(soldier, ctx.inCombat)) };
  list.image(path, 0, x, y, faceShade);
  if (!face.invalidAnim(images)) {
    if (face.eyeFrame > 0) list.image(path, face.eyeFrame, eyesX, eyesY, faceShade);
    if (face.mouthFrame > 0)
      list.image(path, face.mouthFrame + MOUTH_FRAME_OFFSET, x + face.record.mouth[0], y + face.record.mouth[1], faceShade);
  }
  const life = soldier.life ?? 0;
  if (life < CONSCIOUSNESS || overlays.deadPanelRunning) {
    list.image(path, EYES_CLOSED_FRAME, eyesX, eyesY, faceShade);
    list.image(art.hatch, 0, x, y);
  }
  if (soldier.asleep === true) list.image(path, EYES_CLOSED_FRAME, eyesX, eyesY, faceShade);
  if (life <= 0 && !overlays.deadPanelRunning) {
    list.image(art.dead, DEAD_FRAME, x, y);
    list.image(art.hatch, 0, x, y);
  }
  const opponents = soldier.opponents ?? 0;
  if (opponents > 0) drawEnemyCount(list, ctx.fonts.tiny, x, y, opponents);
  if (overlays.hatched) list.image(art.hatch, 0, x, y);
  if (overlays.textOver !== null && !face.invalidAnim(images)) {
    const font = ctx.fonts.tiny;
    const at = hCenterVCenterAlign(x, y, size.width, size.height, overlays.textOver, font);
    mprint(list, font, at.x, at.y, overlays.textOver, fontColors(FontColor.MCOLOR_WHITE, DEFAULT_SHADOW));
  }
  let rightIcons = 0;
  if (soldier.blinded === true) {
    const s = iconSize(images, art.icons, BLINDED_ICON);
    list.image(art.icons, BLINDED_ICON, x + s.width * rightIcons + 1, y + size.height - s.height - 1);
    rightIcons++;
  }
  const icon = bottomRightIcon(soldier);
  if (icon !== null) {
    const s = iconSize(images, art.icons, icon);
    list.image(art.icons, icon, x + size.width - s.width - 1, y + size.height - s.height - 1);
  }
}

export function drawFaceHighlights(ctx: FaceDrawContext, face: FaceAnimator, x: number, y: number, overlays: FaceOverlays): void {
  const size = faceSize(ctx.images, face.record.path);
  if (overlays.highlight !== null) drawFaceRect(ctx.list, x, y, size.width, size.height, overlays.highlight);
  if (overlays.compatible) drawFaceRect(ctx.list, x, y, size.width, size.height, COMPATIBLE_HILIGHT);
}

function drawEnemyCount(list: DrawList, font: BitmapFont, x: number, y: number, count: number): void {
  const text = String(count);
  const x2 = x + stringPixLength(text, font) + 1;
  const y2 = y + fontHeight(font) - 1;
  mprint(list, font, x + 1, y - 1, text, fontColors(FontColor.DKRED, DEFAULT_SHADOW, FontColor.NEARBLACK));
  list.rectangle(x, y, x2, y2, ENEMY_BOX);
}

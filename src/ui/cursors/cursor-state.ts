// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/Cursor_Control.cc LoadCursorData (the size from the composites, the hot spot and the centred sub-cursors
// @src resolved once), SetCurrentCursorFromDatabase (the extern item cursor with its outline, the delayed start, the
// @src flashing and conditional composites, animated frames), ModifyCursorIndex, BltToMouseCursorFromVObjectWithOutline;
// @src src/game/Utils/Cursors.cc HandleAnimatedCursors (every CURSORCOUNTER, flashing every CURSORFLASHUPDATE),
// @src UpdateAnimatedCursorFrames, UpdateFlashingCursorFrames, DrawMouseText (TINYFONT1 white, the hit location, the tile
// @src names, the chance to hit, the AP cost that flashes when invalid), SetCursorSpecialFrame, SetCursorFlags,
// @src RemoveCursorFlags (TARGET_OUT_OF_RANGE at MIDVOLUME when a CURSOR_TO_PLAY_SOUND cursor flashes on);
// @src src/sgp/Video.cc MAX_CURSOR_WIDTH, MAX_CURSOR_HEIGHT, the cursor blit with gsMouseSizeYModifier;
// @src src/game/Utils/Timer_Control.cc giTimerIntervals.

import { DEFAULT_SHADOW, FontColor } from '../../content/text/font-colors.ts';
import { idiv } from '../../core/int.ts';
import { frameOf, type ImageCatalog } from '../assets.ts';
import { type AssetKey, type DrawList, type FontColors, type ImageEffect, rgb } from '../draw-list.ts';
import { type BitmapFont, fontHeight } from '../text/bitmap-font.ts';
import { hCenterVCenterAlign } from '../text/measure.ts';
import { mprint } from '../text/print.ts';
import { SILENT, type UiSoundSink } from '../widgets/button-sounds.ts';
import { CursorId, EXTERN_CURSOR, VIDEO_DEFAULT_TO_NO_CURSOR, VIDEO_NO_CURSOR } from './cursor-ids.ts';
import { CursorFlag, type CursorTable } from './cursor-table.ts';

export const MAX_CURSOR_WIDTH = 64;
export const MAX_CURSOR_HEIGHT = 64;
export const CURSOR_ANIMATION_MS = 150;
export const CURSOR_FLASH_MS = 250;
export const AP_FLASH_MS = 150;
export const INVALID_AP_HOLD_MS = 500;
export const DELAY_START_MS = 1000;
const INVALID_AP_COLOR = 141;
const MIDVOLUME = 65;
const TARGET_OUT_OF_RANGE = { sample: 'TARGET_OUT_OF_RANGE', volume: MIDVOLUME } as const;
const ITEM_OUTLINE = rgb(0, 255, 0);
const SKIP_OUTLINE: ImageEffect = { kind: 'outline', color: null };
const LOCATION_Y = 12;
const TILE_Y = 6;
const TILE2_Y = -2;
const HIT_CHANCE_BELOW_LOCATION_Y = 20;
const HIT_CHANCE_LINE = 8;

export interface ActionPointText {
  readonly value: number;
  readonly center: boolean;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly invalid: boolean;
  readonly black?: boolean;
}

export interface MouseText {
  readonly location?: string;
  readonly tile?: string;
  readonly tile2?: string;
  readonly hitChance?: string;
  readonly actionPoints?: ActionPointText;
}

export interface CursorImagePart {
  readonly asset: AssetKey;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly effect: ImageEffect | null;
}

export interface CursorTextPart {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly colors: FontColors;
}

export interface ComposedCursor {
  readonly id: number;
  readonly hotX: number;
  readonly hotY: number;
  readonly width: number;
  readonly height: number;
  readonly images: readonly CursorImagePart[];
  readonly text: readonly CursorTextPart[];
}

interface Resolved {
  readonly hotX: number;
  readonly hotY: number;
  readonly xs: readonly (number | 'hide')[];
  readonly ys: readonly (number | 'hide')[];
}

export interface CursorStateOptions {
  readonly alwaysShowCursorInTactical?: boolean;
  readonly sounds?: UiSoundSink;
}

export class CursorState {
  readonly table: CursorTable;
  readonly #images: ImageCatalog;
  readonly #alwaysShow: boolean;
  readonly #sounds: UiSoundSink;
  readonly #frames: number[][];
  readonly #flashIndex: number[];
  readonly #extraFlags: number[];
  readonly #resolved = new Map<number, Resolved>();
  #current: number = CursorId.NORMAL;
  #previous = -1;
  #delaySince = 0;
  #animationSince = 0;
  #flashSince = 0;
  #apSince = 0;
  #apHoldSince = 0;
  #apShow = false;
  #apHoldInvalid = true;
  #extern: { readonly asset: AssetKey; readonly frame: number } | null = null;
  #externData: { readonly asset: AssetKey; readonly frame: number } | null = null;
  mouseText: MouseText | null = null;

  constructor(table: CursorTable, images: ImageCatalog, options: CursorStateOptions = {}) {
    this.table = table;
    this.#images = images;
    this.#alwaysShow = options.alwaysShowCursorInTactical ?? false;
    this.#sounds = options.sounds ?? SILENT;
    this.#frames = table.cursors.map((c) => c.composites.map(() => 0));
    this.#flashIndex = table.cursors.map(() => 0);
    this.#extraFlags = table.cursors.map(() => 0);
  }

  get current(): number {
    return this.#current;
  }

  idOf(name: string): number {
    const id = this.table.ids.get(name);
    if (id === undefined) throw new Error(`unknown cursor ${name}`);
    return id;
  }

  modify(id: number): number {
    if (id === VIDEO_DEFAULT_TO_NO_CURSOR) return this.#alwaysShow ? CursorId.NORMAL : VIDEO_NO_CURSOR;
    return id;
  }

  set(id: number, now: number): void {
    const cursor = this.modify(id);
    if (cursor !== this.#previous && cursor !== VIDEO_NO_CURSOR && cursor !== EXTERN_CURSOR) {
      const flags = this.#flags(cursor);
      if (flags & CursorFlag.DELAY_START) this.#delaySince = now;
    }
    if (cursor !== VIDEO_NO_CURSOR && cursor !== EXTERN_CURSOR) this.#previous = cursor;
    this.#current = cursor;
  }

  setExternCursor(asset: AssetKey, frame: number): void {
    this.#extern = { asset, frame };
  }

  setExternData(asset: AssetKey, frame: number): void {
    this.#externData = { asset, frame };
  }

  setSpecialFrame(cursor: number, frame: number): void {
    if (this.#flashIndex[cursor] !== undefined) this.#flashIndex[cursor] = frame;
  }

  setFlags(cursor: number, flags: number): void {
    if (this.#extraFlags[cursor] !== undefined) this.#extraFlags[cursor] |= flags;
  }

  removeFlags(cursor: number, flags: number): void {
    if (this.#extraFlags[cursor] !== undefined) this.#extraFlags[cursor] &= ~flags;
  }

  #flags(cursor: number): number {
    return (this.table.cursors[cursor]?.flags ?? 0) | (this.#extraFlags[cursor] ?? 0);
  }

  #animatedFrames(file: number): number {
    const path = this.table.files[file]?.path;
    return path ? (this.#images.info(path)?.animatedFrames ?? 0) : 0;
  }

  tick(now: number, animate: boolean, flash: boolean): void {
    if (now - this.#animationSince >= CURSOR_ANIMATION_MS) {
      this.#animationSince = now;
      if (animate) this.#advanceAnimation(this.#current);
    }
    if (now - this.#flashSince >= CURSOR_FLASH_MS) {
      this.#flashSince = now;
      if (flash) this.#toggleFlash(this.#current);
    }
  }

  #advanceAnimation(cursor: number): void {
    const definition = this.table.cursors[cursor];
    const frames = this.#frames[cursor];
    if (!definition || !frames) return;
    definition.composites.forEach((sub, i) => {
      const count = this.#animatedFrames(sub.file);
      if (count === 0) return;
      frames[i] = ((frames[i] ?? 0) + 1) % count;
    });
  }

  #toggleFlash(cursor: number): void {
    const flags = this.#flags(cursor);
    if (!(flags & (CursorFlag.FLASH | CursorFlag.FLASH2))) return;
    const index = this.#flashIndex[cursor] ? 0 : 1;
    this.#flashIndex[cursor] = index;
    if (flags & CursorFlag.PLAY_SOUND && index) this.#sounds.play(TARGET_OUT_OF_RANGE);
  }

  #fileAsset(file: number): { asset: AssetKey; frame: number | null; outline: boolean } | null {
    const entry = this.table.files[file];
    if (!entry) return null;
    if (entry.path) return { asset: entry.path, frame: null, outline: entry.outline };
    return this.#externData ? { asset: this.#externData.asset, frame: this.#externData.frame, outline: true } : null;
  }

  #subFrame(file: number, frame: number) {
    const source = this.#fileAsset(file);
    if (!source) return { width: 0, height: 0, offsetX: 0, offsetY: 0 };
    return frameOf(this.#images, source.asset, source.frame ?? frame);
  }

  #size(cursor: number): { width: number; height: number } {
    let width = -1;
    let height = -1;
    for (const sub of this.table.cursors[cursor]?.composites ?? []) {
      const f = this.#subFrame(sub.file, sub.frame);
      width = Math.max(width, f.width);
      height = Math.max(height, f.height);
    }
    return { width: Math.max(0, width), height: Math.max(0, height) };
  }

  #resolve(cursor: number, width: number, height: number): Resolved {
    const known = this.#resolved.get(cursor);
    if (known) return known;
    const definition = this.table.cursors[cursor];
    if (!definition) throw new Error(`no cursor ${cursor}`);
    const hotX =
      typeof definition.hotX === 'number'
        ? definition.hotX
        : definition.hotX === 'center'
          ? idiv(width, 2)
          : definition.hotX === 'right'
            ? width
            : 0;
    const hotY =
      typeof definition.hotY === 'number'
        ? definition.hotY
        : definition.hotY === 'center'
          ? idiv(height, 2)
          : definition.hotY === 'bottom'
            ? height
            : 0;
    const xs = definition.composites.map((sub) => (sub.x === 'center' ? hotX - idiv(this.#subFrame(sub.file, sub.frame).width, 2) : sub.x));
    const ys = definition.composites.map((sub) =>
      sub.y === 'center' ? hotY - idiv(this.#subFrame(sub.file, sub.frame).height, 2) : sub.y,
    );
    const resolved = { hotX, hotY, xs, ys };
    this.#resolved.set(cursor, resolved);
    return resolved;
  }

  #skipped(cursor: number, composite: number): boolean {
    const flags = this.#flags(cursor);
    const flashIndex = this.#flashIndex[cursor] ?? 0;
    if (flags & CursorFlag.FLASH && composite <= 1 && flashIndex !== composite) return true;
    if (!(flags & CursorFlag.SUB_CONDITIONALLY)) return false;
    if (flags & CursorFlag.FLASH2) return composite > 0 && composite <= 2 && flashIndex !== composite;
    return composite <= 1 && flashIndex !== composite;
  }

  compose(now: number, font: BitmapFont | null = null, textEnabled = false): ComposedCursor | null {
    const cursor = this.#current;
    if (cursor === VIDEO_NO_CURSOR) return null;
    if (cursor === EXTERN_CURSOR) return this.#composeExtern(now, font, textEnabled);
    const definition = this.table.cursors[cursor];
    if (!definition) return null;
    if (this.#flags(cursor) & CursorFlag.DELAY_START && now - this.#delaySince < DELAY_START_MS) return null;
    const { width, height } = this.#size(cursor);
    const resolved = this.#resolve(cursor, width, height);
    const images: CursorImagePart[] = [];
    definition.composites.forEach((sub, i) => {
      if (this.#skipped(cursor, i)) return;
      const x = resolved.xs[i];
      const y = resolved.ys[i];
      if (x === 'hide' || y === 'hide' || x === undefined || y === undefined) return;
      const source = this.#fileAsset(sub.file);
      if (!source) return;
      const frame = source.frame ?? (this.#animatedFrames(sub.file) !== 0 ? (this.#frames[cursor]?.[i] ?? 0) : sub.frame);
      if (source.outline) {
        const f = frameOf(this.#images, source.asset, frame);
        images.push({
          asset: source.asset,
          frame,
          x: idiv(width - f.width, 2) - f.offsetX,
          y: idiv(height - f.height, 2) - f.offsetY,
          effect: { kind: 'outline', color: ITEM_OUTLINE },
        });
      } else images.push({ asset: source.asset, frame, x, y, effect: null });
    });
    const text = textEnabled && font ? this.#mouseText(now, font, width, height) : { parts: [], extraHeight: 0 };
    return {
      id: cursor,
      hotX: resolved.hotX,
      hotY: resolved.hotY,
      width,
      height: Math.min(height + text.extraHeight, MAX_CURSOR_HEIGHT),
      images,
      text: text.parts,
    };
  }

  #composeExtern(now: number, font: BitmapFont | null, textEnabled: boolean): ComposedCursor | null {
    const extern = this.#extern;
    if (!extern) return null;
    const f = frameOf(this.#images, extern.asset, extern.frame);
    const width = f.width + f.offsetX;
    const height = f.height + f.offsetY;
    const text = textEnabled && font ? this.#mouseText(now, font, width, height) : { parts: [], extraHeight: 0 };
    return {
      id: EXTERN_CURSOR,
      hotX: idiv(width, 2),
      hotY: idiv(height, 2),
      width,
      height: Math.min(height + text.extraHeight, MAX_CURSOR_HEIGHT),
      images: [{ asset: extern.asset, frame: extern.frame, x: 0, y: 0, effect: SKIP_OUTLINE }],
      text: text.parts,
    };
  }

  #mouseText(now: number, font: BitmapFont, width: number, height: number): { parts: CursorTextPart[]; extraHeight: number } {
    const text = this.mouseText;
    const parts: CursorTextPart[] = [];
    let extraHeight = 0;
    if (!text) return { parts, extraHeight };
    const white: FontColors = { foreground: FontColor.MCOLOR_WHITE, shadow: DEFAULT_SHADOW, background: FontColor.MCOLOR_BLACK };
    const centred = (s: string, y: number) => {
      const at = hCenterVCenterAlign(0, y, width, height, s, font);
      parts.push({ text: s, x: at.x, y: at.y, colors: white });
    };
    if (text.location) centred(text.location, LOCATION_Y);
    if (text.tile) centred(text.tile, TILE_Y);
    if (text.tile2) centred(text.tile2, TILE2_Y);
    if (text.hitChance) {
      if (!text.location) centred(text.hitChance, LOCATION_Y);
      else {
        centred(text.hitChance, HIT_CHANCE_BELOW_LOCATION_Y);
        extraHeight = HIT_CHANCE_LINE + fontHeight(font);
      }
    }
    const ap = text.actionPoints;
    if (ap) {
      this.#flashActionPoints(now, ap.invalid);
      const value = String(ap.value);
      const at = ap.center
        ? hCenterVCenterAlign(0, 0, width, height, value, font)
        : hCenterVCenterAlign(ap.offsetX, ap.offsetY, 1, 1, value, font);
      const black = ap.black || !this.#apShow;
      const foreground = !black && ap.invalid ? INVALID_AP_COLOR : FontColor.MCOLOR_WHITE;
      parts.push({ text: value, x: at.x, y: at.y, colors: { foreground, shadow: DEFAULT_SHADOW, background: FontColor.MCOLOR_BLACK } });
    }
    return { parts, extraHeight };
  }

  #flashActionPoints(now: number, invalid: boolean): void {
    if (!invalid) {
      this.#apShow = true;
      this.#apHoldInvalid = false;
      return;
    }
    if (!this.#apHoldInvalid) {
      if (now - this.#apHoldSince >= INVALID_AP_HOLD_MS) {
        this.#apHoldSince = now;
        this.#apSince = now;
        this.#apShow = !this.#apShow;
        this.#apHoldInvalid = !this.#apHoldInvalid;
      }
    } else if (now - this.#apSince >= AP_FLASH_MS) {
      this.#apSince = now;
      this.#apHoldSince = now;
      this.#apShow = !this.#apShow;
      this.#apHoldInvalid = !this.#apHoldInvalid;
    }
  }

  draw(list: DrawList, x: number, y: number, composed: ComposedCursor, font: BitmapFont | null): void {
    const left = x - composed.hotX;
    const top = y - composed.hotY;
    const width = Math.min(composed.width, MAX_CURSOR_WIDTH);
    if (width <= 0 || composed.height <= 0) return;
    list.pushClip(left, top, left + width, top + composed.height);
    for (const part of composed.images)
      list.image(part.asset, part.frame, left + part.x, top + part.y, part.effect ? { effect: part.effect } : {});
    if (font) for (const part of composed.text) mprint(list, font, left + part.x, top + part.y, part.text, part.colors);
    list.popClip();
  }
}

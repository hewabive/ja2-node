// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/VSurface.cc ColorFillVideoSurfaceArea, ShadowVideoSurfaceRect, ShadowVideoSurfaceRectUsingLowPercentTable;
// @src src/sgp/Line.cc LineDraw, RectangleDraw; src/sgp/VObject_Blitters.cc Blt16BPPBufferHatchRect,
// @src Blt16BPPBufferLooseHatchRectWithColor, Blt8BPPDataTo16BPPBufferOutline, BltOutlineShadow; src/sgp/HImage.cc
// @src Create16BPPPaletteShaded; src/sgp/VObject.cc BltVideoObject; src/sgp/Font.cc SetFontForeground, SetFontShadow,
// @src SetFontBackground; src/sgp/VSurface.cc SetClippingRect, BltStretchVideoSurface. See docs/28 §3.11.

import type { PaletteScale } from '../content/picture/shaded-palette.ts';

export type AssetKey = string;
export type FontId = string;
export type RgbColor = number;

export const SHADOW_FACTOR = 0.48;
export const LOW_PERCENT_SHADOW_FACTOR = 0.8;

export function rgb(r: number, g: number, b: number): RgbColor {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

export type PaletteShade = PaletteScale;

export type ImageEffect =
  | { readonly kind: 'normal' }
  | { readonly kind: 'outline'; readonly color: RgbColor | null }
  | { readonly kind: 'outlineShadow' };

export const NORMAL_EFFECT: ImageEffect = { kind: 'normal' };

export interface ImageItem {
  readonly kind: 'image';
  readonly asset: AssetKey;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly shade: PaletteShade | null;
  readonly effect: ImageEffect;
}

export interface PositionedGlyph {
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

export interface FontColors {
  readonly foreground: number;
  readonly shadow: number;
  readonly background: number;
}

export interface GlyphRunItem extends FontColors {
  readonly kind: 'glyphs';
  readonly font: FontId;
  readonly glyphs: readonly PositionedGlyph[];
}

export interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FillItem extends Area {
  readonly kind: 'fill';
  readonly color: RgbColor;
}

export interface ShadowItem extends Area {
  readonly kind: 'shadow';
  readonly factor: number;
}

export type HatchPattern = 'checker' | 'loose';

export interface HatchItem extends Area {
  readonly kind: 'hatch';
  readonly pattern: HatchPattern;
  readonly color: RgbColor;
}

export interface LineItem {
  readonly kind: 'line' | 'rectangle';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly color: RgbColor;
}

export interface ClipPushItem extends Area {
  readonly kind: 'clipPush';
}

export interface ClipPopItem {
  readonly kind: 'clipPop';
}

export interface CaptureItem {
  readonly kind: 'capture';
  readonly target: string;
}

export interface SnapshotItem extends Area {
  readonly kind: 'snapshot';
  readonly source: string;
  readonly sourceArea: Area;
}

export type DrawItem =
  | ImageItem
  | GlyphRunItem
  | FillItem
  | ShadowItem
  | HatchItem
  | LineItem
  | ClipPushItem
  | ClipPopItem
  | CaptureItem
  | SnapshotItem;

export interface ImageOptions {
  readonly shade?: PaletteShade | null;
  readonly effect?: ImageEffect;
}

const BLACK: RgbColor = 0;

function inclusiveArea(x1: number, y1: number, x2: number, y2: number): Area {
  return { x: x1, y: y1, width: Math.max(0, x2 - x1 + 1), height: Math.max(0, y2 - y1 + 1) };
}

function exclusiveArea(x1: number, y1: number, x2: number, y2: number): Area {
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

export class DrawList {
  readonly items: DrawItem[] = [];
  #clipDepth = 0;

  clear(): void {
    this.items.length = 0;
    this.#clipDepth = 0;
  }

  image(asset: AssetKey, frame: number, x: number, y: number, options: ImageOptions = {}): void {
    this.items.push({ kind: 'image', asset, frame, x, y, shade: options.shade ?? null, effect: options.effect ?? NORMAL_EFFECT });
  }

  glyphs(font: FontId, glyphs: readonly PositionedGlyph[], colors: FontColors): void {
    if (glyphs.length === 0) return;
    this.items.push({ kind: 'glyphs', font, glyphs, ...colors });
  }

  fill(x1: number, y1: number, x2: number, y2: number, color: RgbColor): void {
    this.items.push({ kind: 'fill', ...exclusiveArea(x1, y1, x2, y2), color });
  }

  rectangle(x1: number, y1: number, x2: number, y2: number, color: RgbColor): void {
    this.items.push({ kind: 'rectangle', x1, y1, x2, y2, color });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RgbColor): void {
    this.items.push({ kind: 'line', x1, y1, x2, y2, color });
  }

  shadow(x1: number, y1: number, x2: number, y2: number, factor = SHADOW_FACTOR): void {
    this.items.push({ kind: 'shadow', ...inclusiveArea(x1, y1, x2, y2), factor });
  }

  hatch(x1: number, y1: number, x2: number, y2: number): void {
    this.items.push({ kind: 'hatch', ...inclusiveArea(x1, y1, x2, y2), pattern: 'checker', color: BLACK });
  }

  looseHatch(x1: number, y1: number, x2: number, y2: number, color: RgbColor): void {
    this.items.push({ kind: 'hatch', ...inclusiveArea(x1, y1, x2, y2), pattern: 'loose', color });
  }

  capture(target: string): void {
    this.items.push({ kind: 'capture', target });
  }

  snapshot(source: string, sourceArea: Area, destination: Area): void {
    this.items.push({ kind: 'snapshot', source, sourceArea, ...destination });
  }

  pushClip(left: number, top: number, right: number, bottom: number): void {
    this.items.push({ kind: 'clipPush', ...exclusiveArea(left, top, right, bottom) });
    this.#clipDepth++;
  }

  popClip(): void {
    if (this.#clipDepth === 0) throw new Error('popClip without pushClip');
    this.items.push({ kind: 'clipPop' });
    this.#clipDepth--;
  }

  get clipDepth(): number {
    return this.#clipDepth;
  }
}

function samePlainData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => samePlainData(value, b[i]));
  }
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => samePlainData(left[key], right[key]));
}

export function sameDrawItems(a: readonly DrawItem[], b: readonly DrawItem[]): boolean {
  return a.length === b.length && a.every((item, i) => samePlainData(item, b[i]));
}

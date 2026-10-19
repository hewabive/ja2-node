// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/VObject.cc BltVideoObject (frame offsets added to the blit position); src/sgp/VSurface.cc
// @src SetClippingRect, InternalShadowVideoSurfaceRect (the factor as an 8-bit colour modulation);
// @src src/sgp/VObject_Blitters.cc Blt16BPPBufferPixelateRectWithColor (the pattern starts at the clipped corner).

import { resolveFontColors } from '../../content/text/font-colors.ts';
import type {
  Area,
  DrawItem,
  GlyphRunItem,
  HatchItem,
  ImageItem,
  LineItem,
  PaletteShade,
  RgbColor,
  ShadowItem,
} from '../../ui/draw-list.ts';
import { lineRuns, rectangleRuns } from './line-runs.ts';
import { UiMode } from './ui-shader.ts';
import type { IndexedUiImage, RgbUiImage, UiFont, UiFrame, UiImage } from './ui-textures.ts';

export const FLOATS_PER_INSTANCE = 24;
const INITIAL_INSTANCES = 1024;
const CHANNEL_MAX = 255;
const NONE: readonly number[] = [0, 0, 0, 0];
const SHADOW_TABLE_FACTOR = 0.48;

export interface UiDrawSources {
  image(key: string): UiImage | undefined;
  font(id: string): UiFont | undefined;
  paletteRow(image: IndexedUiImage, shade: PaletteShade | null): number;
}

export interface UiBatch {
  readonly first: number;
  count: number;
  indexPage: number | null;
  rgb: RgbUiImage | null;
  readonly multiply: boolean;
  readonly clip: Area | null;
}

export interface UiDrawPlan {
  readonly data: Float32Array;
  readonly instances: number;
  readonly batches: readonly UiBatch[];
  readonly missingImages: ReadonlySet<string>;
  readonly missingFonts: ReadonlySet<string>;
  readonly multiplyAreas: readonly Area[];
}

interface Instance {
  readonly dst: Area;
  readonly src: readonly [number, number, number, number];
  readonly mode: UiMode;
  readonly row?: number;
  readonly factor?: number;
  readonly colors?: readonly (readonly number[])[];
  readonly indexPage?: number;
  readonly rgb?: RgbUiImage;
  readonly multiply?: boolean;
}

export function colorChannels(color: RgbColor | null): readonly number[] {
  if (color === null) return NONE;
  return [((color >> 16) & 0xff) / CHANNEL_MAX, ((color >> 8) & 0xff) / CHANNEL_MAX, (color & 0xff) / CHANNEL_MAX, 1];
}

export function shadowModulation(factor: number): number {
  return Math.floor(CHANNEL_MAX * factor) / CHANNEL_MAX;
}

function intersect(a: Area, b: Area): Area {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function sameArea(a: Area | null, b: Area | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function frameDestination(frame: UiFrame, x: number, y: number): Area {
  return { x: x + frame.offsetX, y: y + frame.offsetY, width: frame.region.width, height: frame.region.height };
}

function frameSource(frame: UiFrame): readonly [number, number, number, number] {
  return [frame.region.x, frame.region.y, frame.region.width, frame.region.height];
}

export class UiDrawPlanner {
  #data = new Float32Array(INITIAL_INSTANCES * FLOATS_PER_INSTANCE);
  #count = 0;
  #batches: UiBatch[] = [];
  #clips: Area[] = [];
  #screen: Area = { x: 0, y: 0, width: 0, height: 0 };
  #missingImages = new Set<string>();
  #missingFonts = new Set<string>();
  #multiplyAreas: Area[] = [];

  plan(items: readonly DrawItem[], width: number, height: number, sources: UiDrawSources): UiDrawPlan {
    this.#count = 0;
    this.#batches = [];
    this.#screen = { x: 0, y: 0, width, height };
    this.#clips = [];
    this.#missingImages = new Set();
    this.#missingFonts = new Set();
    this.#multiplyAreas = [];
    for (const item of items) this.#item(item, sources);
    return {
      data: this.#data.subarray(0, this.#count * FLOATS_PER_INSTANCE),
      instances: this.#count,
      batches: this.#batches,
      missingImages: this.#missingImages,
      missingFonts: this.#missingFonts,
      multiplyAreas: this.#multiplyAreas,
    };
  }

  get #clip(): Area {
    return this.#clips.at(-1) ?? this.#screen;
  }

  #item(item: DrawItem, sources: UiDrawSources): void {
    switch (item.kind) {
      case 'fill':
        this.#fill(item, item.color);
        return;
      case 'shadow':
        this.#shadow(item);
        return;
      case 'hatch':
        this.#hatch(item);
        return;
      case 'line':
      case 'rectangle':
        this.#line(item);
        return;
      case 'image':
        this.#image(item, sources);
        return;
      case 'glyphs':
        this.#glyphs(item, sources);
        return;
      case 'clipPush':
        this.#clips.push(intersect(this.#clip, item));
        return;
      case 'clipPop':
        this.#clips.pop();
        return;
    }
  }

  #fill(area: Area, color: RgbColor): void {
    this.#push({ dst: area, src: [0, 0, 0, 0], mode: UiMode.FILL, colors: [colorChannels(color)] });
  }

  #shadow(item: ShadowItem): void {
    this.#push({ dst: item, src: [0, 0, 0, 0], mode: UiMode.SHADOW, factor: shadowModulation(item.factor), multiply: true });
  }

  #hatch(item: HatchItem): void {
    const clip = this.#clip;
    const originX = Math.max(clip.x, item.x);
    const originY = Math.max(clip.y, item.y);
    const mode = item.pattern === 'checker' ? UiMode.HATCH : UiMode.LOOSE_HATCH;
    this.#push({ dst: item, src: [originX, originY, 0, 0], mode, colors: [colorChannels(item.color)] });
  }

  #line(item: LineItem): void {
    const runs = item.kind === 'line' ? lineRuns(item.x1, item.y1, item.x2, item.y2) : rectangleRuns(item.x1, item.y1, item.x2, item.y2);
    for (const run of runs) this.#fill(run, item.color);
  }

  #image(item: ImageItem, sources: UiDrawSources): void {
    const image = sources.image(item.asset);
    if (!image) {
      this.#missingImages.add(item.asset);
      return;
    }
    if (image.kind === 'rgb') {
      this.#push({
        dst: { x: item.x, y: item.y, width: image.width, height: image.height },
        src: [0, 0, image.width, image.height],
        mode: UiMode.RGB,
        rgb: image,
      });
      return;
    }
    const frame = image.frames[item.frame];
    if (!frame) return;
    const base = { dst: frameDestination(frame, item.x, item.y), src: frameSource(frame), indexPage: frame.region.page };
    const effect = item.effect;
    if (effect.kind === 'outlineShadow') {
      this.#push({ ...base, mode: UiMode.OUTLINE_SHADOW, factor: shadowModulation(SHADOW_TABLE_FACTOR), multiply: true });
      return;
    }
    const row = sources.paletteRow(image, item.shade);
    if (effect.kind === 'outline') this.#push({ ...base, mode: UiMode.OUTLINE, row, colors: [colorChannels(effect.color)] });
    else this.#push({ ...base, mode: UiMode.INDEXED, row });
  }

  #glyphs(item: GlyphRunItem, sources: UiDrawSources): void {
    const font = sources.font(item.font);
    if (!font) {
      this.#missingFonts.add(item.font);
      return;
    }
    const resolved = resolveFontColors(font.palette, item.foreground, item.shadow, item.background);
    const colors = [colorChannels(resolved.foreground), colorChannels(resolved.shadow), colorChannels(resolved.background)];
    for (const glyph of item.glyphs) {
      const frame = font.glyphs[glyph.index];
      if (!frame) continue;
      this.#push({
        dst: frameDestination(frame, glyph.x, glyph.y),
        src: frameSource(frame),
        mode: UiMode.GLYPH,
        colors,
        indexPage: frame.region.page,
      });
    }
  }

  #batchFor(instance: Instance): UiBatch {
    const clip = this.#clips.length > 0 ? this.#clip : null;
    const multiply = instance.multiply ?? false;
    const last = this.#batches.at(-1);
    const fits =
      last &&
      last.multiply === multiply &&
      sameArea(last.clip, clip) &&
      (instance.indexPage === undefined || last.indexPage === null || last.indexPage === instance.indexPage) &&
      (instance.rgb === undefined || last.rgb === null || last.rgb === instance.rgb);
    const batch = fits ? last : { first: this.#count, count: 0, indexPage: null, rgb: null, multiply, clip };
    if (!fits) this.#batches.push(batch);
    if (instance.indexPage !== undefined) batch.indexPage = instance.indexPage;
    if (instance.rgb !== undefined) batch.rgb = instance.rgb;
    return batch;
  }

  #grow(): void {
    const bigger = new Float32Array(this.#data.length * 2);
    bigger.set(this.#data);
    this.#data = bigger;
  }

  #push(instance: Instance): void {
    if (instance.dst.width <= 0 || instance.dst.height <= 0) return;
    const clip = this.#clip;
    if (clip.width <= 0 || clip.height <= 0) return;
    const batch = this.#batchFor(instance);
    if (instance.multiply) this.#multiplyAreas.push(intersect(clip, instance.dst));
    if ((this.#count + 1) * FLOATS_PER_INSTANCE > this.#data.length) this.#grow();
    const [c0 = NONE, c1 = NONE, c2 = NONE] = instance.colors ?? [];
    const { dst, src } = instance;
    this.#data.set(
      [dst.x, dst.y, dst.width, dst.height, ...src, instance.mode, instance.row ?? 0, instance.factor ?? 0, 0, ...c0, ...c1, ...c2],
      this.#count * FLOATS_PER_INSTANCE,
    );
    this.#count++;
    batch.count++;
  }
}

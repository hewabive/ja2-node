import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encodeStiIndexed, type StiSubImage } from '../../src/content/formats/sti.ts';
import { ArmourClass, ItemClass, type ItemDef, type ItemTable, loadItemTable, WeaponClass } from '../../src/content/items/items.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { buildPalette, color, type RampName } from '../palette.ts';
import { IndexedRaster } from '../raster.ts';
import { labelFont, labelHeight, labelWidth, stampLabel } from './label.ts';

export const ITEM_OUTLINE_INDEX = 254;
export const BIG_ITEM_DIR = 'bigitems';

export type ItemShape =
  | 'longGun'
  | 'pistol'
  | 'launcher'
  | 'knife'
  | 'grenade'
  | 'bomb'
  | 'ammo'
  | 'helmet'
  | 'vest'
  | 'legs'
  | 'face'
  | 'medkit'
  | 'kit'
  | 'key'
  | 'money'
  | 'misc';

interface ShapeLook {
  readonly label: string;
  readonly ramp: RampName;
  readonly small: readonly [number, number];
  readonly big: readonly [number, number];
}

export const SHAPE_LOOKS: Readonly<Record<ItemShape, ShapeLook>> = {
  longGun: { label: 'GUN', ramp: 'steel', small: [52, 16], big: [104, 30] },
  pistol: { label: 'PST', ramp: 'steel', small: [24, 14], big: [56, 34] },
  launcher: { label: 'LCH', ramp: 'olive', small: [54, 14], big: [108, 28] },
  knife: { label: 'KNF', ramp: 'gray', small: [22, 10], big: [70, 20] },
  grenade: { label: 'GRN', ramp: 'green', small: [14, 14], big: [34, 34] },
  bomb: { label: 'BMB', ramp: 'rust', small: [20, 14], big: [50, 34] },
  ammo: { label: 'AMO', ramp: 'khaki', small: [12, 18], big: [30, 48] },
  helmet: { label: 'HLM', ramp: 'olive', small: [26, 16], big: [60, 40] },
  vest: { label: 'VST', ramp: 'khaki', small: [26, 20], big: [60, 50] },
  legs: { label: 'LEG', ramp: 'brown', small: [22, 20], big: [50, 50] },
  face: { label: 'FCE', ramp: 'teal', small: [22, 12], big: [60, 28] },
  medkit: { label: 'MED', ramp: 'red', small: [22, 16], big: [56, 40] },
  kit: { label: 'KIT', ramp: 'orange', small: [24, 16], big: [60, 40] },
  key: { label: 'KEY', ramp: 'sand', small: [18, 10], big: [50, 22] },
  money: { label: '$', ramp: 'green', small: [22, 12], big: [60, 30] },
  misc: { label: 'MSC', ramp: 'violet', small: [18, 16], big: [44, 40] },
};

const MARGIN = 1;
const LABEL_MARGIN = 1;

export function itemShape(def: ItemDef): ItemShape {
  const cls = def.itemClass;
  if (cls & ItemClass.GUN) return def.weapon?.weaponClass === WeaponClass.HANDGUN ? 'pistol' : 'longGun';
  if (cls & ItemClass.LAUNCHER) return 'launcher';
  if (cls & (ItemClass.BLADE | ItemClass.THROWING_KNIFE)) return 'knife';
  if (cls & (ItemClass.GRENADE | ItemClass.THROWN)) return 'grenade';
  if (cls & ItemClass.BOMB) return 'bomb';
  if (cls & ItemClass.AMMO) return 'ammo';
  if (cls & ItemClass.ARMOUR) {
    if (def.armour?.armourClass === ArmourClass.HELMET) return 'helmet';
    if (def.armour?.armourClass === ArmourClass.LEGGINGS) return 'legs';
    return 'vest';
  }
  if (cls & ItemClass.FACE) return 'face';
  if (cls & ItemClass.MEDKIT) return 'medkit';
  if (cls & ItemClass.KIT) return 'kit';
  if (cls & ItemClass.KEY) return 'key';
  if (cls & ItemClass.MONEY) return 'money';
  return 'misc';
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function part(b: Box, fx: number, fy: number, fw: number, fh: number): Box {
  return {
    x: b.x + Math.round(b.w * fx),
    y: b.y + Math.round(b.h * fy),
    w: Math.max(1, Math.round(b.w * fw)),
    h: Math.max(1, Math.round(b.h * fh)),
  };
}

function fill(r: IndexedRaster, b: Box, c: number): void {
  r.rect(b.x, b.y, b.w, b.h, c);
}

function drawShape(r: IndexedRaster, shape: ItemShape, b: Box, ramp: RampName): void {
  const body = color(ramp, 8);
  const dark = color(ramp, 5);
  const light = color(ramp, 11);
  switch (shape) {
    case 'longGun':
      fill(r, part(b, 0, 0.3, 0.25, 0.55), dark);
      fill(r, part(b, 0.22, 0.2, 0.45, 0.45), body);
      fill(r, part(b, 0.65, 0.3, 0.35, 0.18), light);
      fill(r, part(b, 0.4, 0.6, 0.1, 0.4), dark);
      return;
    case 'pistol':
      fill(r, part(b, 0, 0, 1, 0.45), body);
      fill(r, part(b, 0.1, 0.4, 0.3, 0.6), dark);
      return;
    case 'launcher':
      fill(r, part(b, 0, 0.2, 1, 0.5), body);
      fill(r, part(b, 0.3, 0.65, 0.12, 0.35), dark);
      fill(r, part(b, 0.85, 0.1, 0.15, 0.7), light);
      return;
    case 'knife':
      fill(r, part(b, 0, 0.25, 0.35, 0.6), dark);
      fill(r, part(b, 0.35, 0.1, 0.65, 0.6), light);
      return;
    case 'grenade':
      r.ellipse(b.x + b.w / 2 - 0.5, b.y + b.h * 0.58, b.w / 2 - 0.5, b.h * 0.42 - 0.5, () => body);
      fill(r, part(b, 0.35, 0, 0.3, 0.2), dark);
      return;
    case 'bomb':
      fill(r, part(b, 0, 0.2, 1, 0.8), body);
      fill(r, part(b, 0.6, 0, 0.15, 0.25), dark);
      return;
    case 'ammo':
      fill(r, part(b, 0, 0, 1, 1), body);
      fill(r, part(b, 0.15, 0.08, 0.7, 0.15), light);
      return;
    case 'helmet':
      r.ellipse(b.x + b.w / 2 - 0.5, b.y + b.h - 1, b.w / 2 - 0.5, b.h - 1, () => body);
      return;
    case 'vest':
      fill(r, part(b, 0, 0.15, 1, 0.85), body);
      fill(r, part(b, 0.35, 0, 0.3, 0.3), dark);
      return;
    case 'legs':
      fill(r, part(b, 0, 0, 1, 0.3), body);
      fill(r, part(b, 0, 0.3, 0.42, 0.7), body);
      fill(r, part(b, 0.58, 0.3, 0.42, 0.7), body);
      return;
    case 'face':
      r.ellipse(b.x + b.w * 0.25, b.y + b.h / 2, b.w * 0.25 - 0.5, b.h / 2 - 0.5, () => body);
      r.ellipse(b.x + b.w * 0.75 - 1, b.y + b.h / 2, b.w * 0.25 - 0.5, b.h / 2 - 0.5, () => body);
      fill(r, part(b, 0.4, 0.4, 0.2, 0.2), dark);
      return;
    case 'medkit':
      fill(r, part(b, 0, 0, 1, 1), color('gray', 12));
      fill(r, part(b, 0.4, 0.15, 0.2, 0.7), body);
      fill(r, part(b, 0.2, 0.4, 0.6, 0.2), body);
      return;
    case 'kit':
      fill(r, part(b, 0, 0.25, 1, 0.75), body);
      fill(r, part(b, 0.3, 0, 0.4, 0.3), dark);
      return;
    case 'key':
      r.ellipse(b.x + b.h / 2, b.y + b.h / 2, b.h / 2 - 0.5, b.h / 2 - 0.5, () => body);
      fill(r, part(b, 0.4, 0.35, 0.6, 0.3), body);
      fill(r, part(b, 0.85, 0.6, 0.15, 0.4), body);
      return;
    case 'money':
      fill(r, part(b, 0, 0, 1, 1), body);
      fill(r, part(b, 0.1, 0.2, 0.8, 0.6), light);
      return;
    case 'misc':
      fill(r, part(b, 0, 0, 1, 1), body);
      fill(r, part(b, 0, 0, 1, 0.25), dark);
      return;
  }
}

export async function itemRaster(shape: ItemShape, size: readonly [number, number]): Promise<IndexedRaster> {
  const [width, height] = size;
  const look = SHAPE_LOOKS[shape];
  const r = new IndexedRaster(width, height);
  const inner: Box = { x: MARGIN, y: MARGIN, w: width - 2 * MARGIN, h: height - 2 * MARGIN };
  drawShape(r, shape, inner, look.ramp);
  const font = await labelFont();
  const w = labelWidth(font, look.label);
  const h = labelHeight(font);
  if (w + 2 * LABEL_MARGIN <= inner.w && h + 2 * LABEL_MARGIN <= inner.h)
    stampLabel(r, font, look.label, inner.x + Math.floor((inner.w - w) / 2), inner.y + Math.floor((inner.h - h) / 2), color(look.ramp, 1));
  r.outline(ITEM_OUTLINE_INDEX);
  return r;
}

function subImage(r: IndexedRaster): StiSubImage {
  return { offsetX: 0, offsetY: 0, width: r.width, height: r.height, pixels: r.pixels };
}

export async function stubItemTable(): Promise<ItemTable> {
  return loadItemTable(async (path) => {
    try {
      return JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
    } catch {
      return null;
    }
  });
}

export interface ItemSheetPlan {
  readonly path: string;
  readonly frames: readonly ItemShape[];
}

function byIndex(table: ItemTable): ItemDef[] {
  return [...table.byIndex.values()].sort((a, b) => a.index - b.index);
}

export function smallSheetPlans(table: ItemTable): ItemSheetPlan[] {
  const sheets = new Map<string, Map<number, ItemShape>>();
  for (const def of byIndex(table)) {
    const { path, subImageIndex } = def.inventoryGraphics.small;
    const frames = sheets.get(path) ?? new Map<number, ItemShape>();
    if (!frames.has(subImageIndex)) frames.set(subImageIndex, itemShape(def));
    sheets.set(path, frames);
  }
  return [...sheets]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, frames]) => ({
      path,
      frames: Array.from({ length: Math.max(...frames.keys()) + 1 }, (_, i) => frames.get(i) ?? 'misc'),
    }));
}

export function bigPictureShapes(table: ItemTable): Map<string, ItemShape> {
  const shapes = new Map<string, ItemShape>();
  for (const def of byIndex(table)) {
    const { path, subImageIndex } = def.inventoryGraphics.big;
    if (subImageIndex !== 0) throw new Error(`${def.name}: a big picture with frame ${subImageIndex} cannot share a stub file`);
    if (!shapes.has(path)) shapes.set(path, itemShape(def));
  }
  return shapes;
}

export function bigShapePath(shape: ItemShape): string {
  return `${BIG_ITEM_DIR}/stub-${shape.toLowerCase()}.sti`;
}

async function put(out: string, path: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), bytes);
  return path;
}

export async function buildStubItemGraphics(out: string, aliases: Map<string, string>): Promise<string[]> {
  const table = await stubItemTable();
  const palette = buildPalette();
  const written: string[] = [];
  for (const plan of smallSheetPlans(table)) {
    const frames = await Promise.all(plan.frames.map((shape) => itemRaster(shape, SHAPE_LOOKS[shape].small)));
    written.push(await put(out, plan.path, encodeStiIndexed({ palette, subImages: frames.map(subImage) })));
  }
  const big = bigPictureShapes(table);
  for (const shape of new Set(big.values())) {
    const frame = await itemRaster(shape, SHAPE_LOOKS[shape].big);
    written.push(await put(out, bigShapePath(shape), encodeStiIndexed({ palette, subImages: [subImage(frame)] })));
  }
  for (const [path, shape] of big) aliases.set(path, bigShapePath(shape));
  return written.sort();
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/RenderWorld.cc RenderStaticWorld, RenderDynamicWorld, RenderTiles, MultiZBlitter
// See docs/05-render-pipeline.md.

import { MERC_Z_LEVEL, soldierShade } from '../../content/anim/soldier-sprite.ts';
import { WORLD_COLS, WORLD_ROWS } from '../../content/world/grid.ts';
import { type Level, type LevelLayer, levelTilesAt } from '../../content/world/level.ts';
import { clampShade } from '../../content/world/shading.ts';
import { type TileElement, TileFlags } from '../../content/world/tile-database.ts';
import { DepthMode } from '../sprite-renderer.ts';
import type { LevelRenderData } from './level-render-data.ts';

export const Z_SUBLAYERS = 8;
const OBJECT_Z_LEVEL = 1;
const SHADOW_Z_LEVEL = 2;
const STRUCT_Z_LEVEL = 4;
const ROOF_Z_LEVEL = 5;
const ONROOF_Z_LEVEL = 6;
const WALL_HEIGHT = 50;
const SHADOW_ROW_OFFSET = 80;
const SCREEN_CENTER_Y = 1625;
const DEFAULT_TOP_Y = 860;
const Z_STRIP_DELTA = Z_SUBLAYERS * 10;
const HALF_TILE_X = 20;
const SWEEP_MARGIN_X = 120;
const SWEEP_MARGIN_Y = 200;
const CLIFF_HEIGHT_STEP = 80;
const LIGHT_DUSK_CUTOFF = 8;
const MERC_SCREEN_OFFSET_Y = 10;

export interface FrameGeometry {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export interface Camera {
  readonly centerX: number;
  readonly centerY: number;
}

export interface SceneOptions {
  readonly width: number;
  readonly height: number;
  readonly camera: Camera;
  readonly ambientShade: number;
  readonly showRoofs: boolean;
  readonly showShadows: boolean;
  readonly topY?: number;
}

export type MercPart = 'shadow' | 'body' | 'obscured';

export interface SceneMerc {
  readonly key: number;
  readonly gridNo: number;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly frame: FrameGeometry;
}

export interface DrawItem {
  readonly merc?: { readonly key: number; readonly part: MercPart };
  readonly tile: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly depthMode: DepthMode;
  readonly shade: number;
  readonly shadow: boolean;
  readonly srcX: number;
  readonly srcWidth: number;
}

export interface SceneSource {
  readonly level: Level;
  readonly tiles: readonly TileElement[];
  readonly prepared: LevelRenderData;
  frame(tile: number): FrameGeometry | null;
  mercsAt?(gridNo: number): readonly SceneMerc[];
}

export function tileOrigin(x: number, y: number, o: SceneOptions): { x: number; y: number } {
  const cx = Math.floor(o.width / 2);
  const cy = Math.floor(o.height / 2);
  const { centerX: rcx, centerY: rcy } = o.camera;
  return { x: cx + 20 * (x - y) - 20 - 2 * (rcx - rcy), y: cy + 10 * (x + y) - 10 - (rcx + rcy) };
}

export function screenToGridNo(sx: number, sy: number, o: SceneOptions): number | null {
  const offX = sx - Math.floor(o.width / 2);
  const offY = sy - Math.floor(o.height / 2) + 10;
  const cellX = o.camera.centerX + Math.floor((offX / 2 + offY) / 2);
  const cellY = o.camera.centerY + Math.floor((offY - offX / 2) / 2);
  if (cellX < 0 || cellY < 0 || cellX >= WORLD_COLS * 10 || cellY >= WORLD_ROWS * 10) return null;
  return Math.floor(cellY / 10) * WORLD_COLS + Math.floor(cellX / 10);
}

function worldY(x: number, y: number, topY: number): number {
  return 10 * (x - 80) + 10 * (y - 80) + SCREEN_CENTER_Y - topY;
}

function wrap16(z: number): number {
  return z & 0xffff;
}

type Pass =
  | 'land'
  | 'objects'
  | 'shadows'
  | 'structs'
  | 'roofs'
  | 'onRoof'
  | 'dynObjects'
  | 'dynShadows'
  | 'dynMercs'
  | 'dynStructs'
  | 'dynRoofs'
  | 'dynOnRoof';

interface Context {
  readonly source: SceneSource;
  readonly options: SceneOptions;
  readonly topY: number;
  readonly out: DrawItem[];
}

function isDynamic(te: TileElement): boolean {
  return (te.flags & (TileFlags.DYNAMIC | TileFlags.ANIMATED)) !== 0;
}

function drawableTile(te: TileElement): number {
  return te.flags & TileFlags.ANIMATED && te.animationFrames ? (te.animationFrames[0] ?? te.index) : te.index;
}

function emitNode(ctx: Context, pass: Pass, g: number, tileIndex: number): void {
  const { source, options } = ctx;
  const te = source.tiles[tileIndex];
  if (!te?.surfacePath) return;
  const dynamicPass = pass.startsWith('dyn');
  if (isDynamic(te) !== dynamicPass) return;
  const tile = dynamicPass ? drawableTile(te) : te.index;
  const frame = source.frame(tile);
  if (!frame || frame.width === 0 || frame.height === 0) return;
  const x = g % WORLD_COLS;
  const y = Math.floor(g / WORLD_COLS);
  const origin = tileOrigin(x, y, options);
  const height = source.level.heights[g] ?? 0;
  let sy = origin.y;
  if (te.flags & TileFlags.IGNORE_WORLD_HEIGHT) sy -= Math.max(0, (Math.floor(height / CLIFF_HEIGHT_STEP) - 1) * CLIFF_HEIGHT_STEP);
  else sy -= height;
  const roofLike = pass === 'roofs' || pass === 'onRoof' || pass === 'dynRoofs' || pass === 'dynOnRoof';
  if (roofLike) sy -= WALL_HEIGHT;
  sy += source.prepared.renderHeight;
  const wy = worldY(x, y, ctx.topY);
  const shade = clampShade(options.ambientShade);
  const base = { tile, x: origin.x + frame.offsetX, y: sy + frame.offsetY, shade, shadow: false, srcX: 0, srcWidth: frame.width };

  switch (pass) {
    case 'land':
      ctx.out.push({ ...base, z: 0, depthMode: DepthMode.NONE });
      return;
    case 'objects':
    case 'dynObjects': {
      const z =
        te.flags & TileFlags.CLIFFHANG ? 0 : te.flags & TileFlags.OBJECTLAYER_USEZHEIGHT ? wrap16(wy * Z_SUBLAYERS) : OBJECT_Z_LEVEL;
      ctx.out.push({ ...base, z, depthMode: dynamicPass ? DepthMode.NEARER_OR_EQUAL_NO_WRITE : DepthMode.NEARER_OR_EQUAL });
      return;
    }
    case 'shadows':
      ctx.out.push({
        ...base,
        z: Math.max((wy - SHADOW_ROW_OFFSET) * Z_SUBLAYERS + SHADOW_Z_LEVEL, 0),
        depthMode: DepthMode.NEARER,
        shadow: true,
      });
      return;
    case 'dynShadows':
      ctx.out.push({ ...base, z: 0, depthMode: DepthMode.NONE, shadow: true });
      return;
    case 'structs':
    case 'dynStructs': {
      const z = wy * Z_SUBLAYERS + STRUCT_Z_LEVEL;
      if (te.flags & TileFlags.MULTI_Z && te.zStrip) {
        const stripMode = te.flags & TileFlags.WALL ? DepthMode.NEARER_OR_EQUAL : DepthMode.NEARER;
        let stripZ = z + Z_STRIP_DELTA * te.zStrip.initialZChange;
        let srcX = 0;
        let width = Math.min(te.zStrip.firstStripWidth, frame.width);
        let k = 0;
        while (srcX < frame.width) {
          ctx.out.push({
            ...base,
            x: base.x + srcX,
            z: wrap16(stripZ),
            depthMode: dynamicPass ? DepthMode.NEARER : stripMode,
            srcX,
            srcWidth: width,
          });
          srcX += width;
          width = Math.min(HALF_TILE_X, frame.width - srcX);
          stripZ += Z_STRIP_DELTA * (te.zStrip.zChanges[k++] ?? 0);
        }
        return;
      }
      ctx.out.push({ ...base, z: wrap16(z), depthMode: dynamicPass ? DepthMode.NEARER_OR_EQUAL_NO_WRITE : DepthMode.NEARER_OR_EQUAL });
      return;
    }
    case 'roofs':
    case 'dynRoofs':
      ctx.out.push({
        ...base,
        z: wrap16((wy + WALL_HEIGHT) * Z_SUBLAYERS + ROOF_Z_LEVEL),
        depthMode: dynamicPass ? DepthMode.NEARER_OR_EQUAL_NO_WRITE : DepthMode.NEARER_OR_EQUAL,
      });
      return;
    case 'onRoof':
    case 'dynOnRoof':
      ctx.out.push({
        ...base,
        z: wrap16((wy + WALL_HEIGHT) * Z_SUBLAYERS + ONROOF_Z_LEVEL),
        depthMode: dynamicPass ? DepthMode.NEARER_OR_EQUAL_NO_WRITE : DepthMode.NEARER_OR_EQUAL,
      });
      return;
  }
}

function* sweep(options: SceneOptions): Generator<number[]> {
  for (let s = 0; s <= WORLD_COLS + WORLD_ROWS - 2; s++) {
    const row: number[] = [];
    for (let x = Math.max(0, s - (WORLD_ROWS - 1)); x <= Math.min(WORLD_COLS - 1, s); x++) {
      const y = s - x;
      const o = tileOrigin(x, y, options);
      if (
        o.x < -SWEEP_MARGIN_X - 40 ||
        o.x > options.width + SWEEP_MARGIN_X ||
        o.y < -SWEEP_MARGIN_Y - 20 ||
        o.y > options.height + SWEEP_MARGIN_Y
      )
        continue;
      row.push(y * WORLD_COLS + x);
    }
    if (row.length > 0) yield row;
  }
}

function layerOf(source: SceneSource, pass: Pass): LevelLayer {
  const l = source.level.layers;
  switch (pass) {
    case 'objects':
    case 'dynObjects':
      return l.objects;
    case 'shadows':
    case 'dynShadows':
      return source.prepared.shadows;
    case 'structs':
    case 'dynStructs':
      return l.structs;
    case 'roofs':
    case 'dynRoofs':
      return l.roofs;
    case 'onRoof':
    case 'dynOnRoof':
      return l.onRoof;
    case 'land':
    case 'dynMercs':
      return l.land;
  }
}

const MERC_PARTS: readonly (readonly [MercPart, DepthMode])[] = [
  ['shadow', DepthMode.NEARER_NO_WRITE],
  ['body', DepthMode.NEARER_OR_EQUAL_NO_WRITE],
  ['obscured', DepthMode.FARTHER_NO_WRITE],
];

function emitMercs(ctx: Context, g: number): void {
  const mercs = ctx.source.mercsAt?.(g);
  if (!mercs || mercs.length === 0) return;
  const o = ctx.options;
  const cx = Math.floor(o.width / 2);
  const cy = Math.floor(o.height / 2);
  const height = ctx.source.level.heights[g] ?? 0;
  const x = g % WORLD_COLS;
  const y = Math.floor(g / WORLD_COLS);
  const z = wrap16(worldY(x, y, ctx.topY) * Z_SUBLAYERS + MERC_Z_LEVEL);
  const shade = soldierShade(clampShade(o.ambientShade));
  for (const m of mercs) {
    if (m.level > 0) continue;
    const dx = Math.fround(m.x - o.camera.centerX);
    const dy = Math.fround(m.y - o.camera.centerY);
    const sx = cx + Math.trunc(Math.fround(2 * dx - 2 * dy));
    const sy = cy + Math.trunc(Math.fround(dx + dy)) - height - MERC_SCREEN_OFFSET_Y + ctx.source.prepared.renderHeight;
    for (const [part, depthMode] of MERC_PARTS) {
      ctx.out.push({
        merc: { key: m.key, part },
        tile: -1,
        x: sx + m.frame.offsetX,
        y: sy + m.frame.offsetY,
        z,
        depthMode,
        shade,
        shadow: part === 'shadow',
        srcX: 0,
        srcWidth: m.frame.width,
      });
    }
  }
}

function emitLand(ctx: Context, g: number): void {
  const start = ctx.source.prepared.landStart[g] ?? -1;
  const land = levelTilesAt(ctx.source.level.layers.land, g);
  for (let i = start; i >= 0; i--) emitNode(ctx, 'land', g, land[i] ?? 0);
}

function emitRow(ctx: Context, rows: readonly number[][], passes: readonly Pass[]): void {
  for (const row of rows) {
    for (const pass of passes) {
      if ((pass === 'roofs' || pass === 'onRoof' || pass === 'dynRoofs' || pass === 'dynOnRoof') && !ctx.options.showRoofs) continue;
      for (const g of row) {
        if (pass === 'land') {
          emitLand(ctx, g);
          continue;
        }
        if (pass === 'dynMercs') {
          emitMercs(ctx, g);
          continue;
        }
        for (const t of levelTilesAt(layerOf(ctx.source, pass), g)) emitNode(ctx, pass, g, t);
      }
    }
  }
}

export function buildScene(source: SceneSource, options: SceneOptions): DrawItem[] {
  const ctx: Context = { source, options, topY: options.topY ?? DEFAULT_TOP_Y, out: [] };
  const rows = [...sweep(options)];
  const shadows = options.showShadows && clampShade(options.ambientShade) < LIGHT_DUSK_CUTOFF;
  emitRow(ctx, rows, ['land']);
  emitRow(ctx, rows, ['objects']);
  if (shadows) emitRow(ctx, rows, ['shadows']);
  emitRow(ctx, rows, ['structs', 'roofs', 'onRoof']);
  emitRow(ctx, rows, ['dynObjects', 'dynShadows', 'dynMercs', 'dynStructs']);
  emitRow(ctx, rows, ['dynRoofs', 'dynOnRoof']);
  return ctx.out;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/RenderWorld.cc RenderDynamicWorld, RenderTiles (dynamic layers, animated tiles, mercs,
// @src items, LEVELNODE_USERELPOS); src/game/TileEngine/Tile_Animation.cc; src/game/Tactical/Interface_Control.cc
// @src SetUpInterface (UI nodes). See docs/05 §2.5, docs/28 §6.4.

import type { LayerName } from '../../content/formats/map.ts';
import { WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import { type TileElement, TileFlags } from '../../content/world/tile-database.ts';
import {
  type Camera,
  HALF_TILE_X,
  heightAdjusted,
  itemZ,
  MERC_SCREEN_OFFSET_Y,
  mapCenter,
  mercZ,
  OBJECT_Z_LEVEL,
  objectZ,
  onRoofZ,
  ROW_COUNT,
  roofMercZ,
  roofZ,
  structZ,
  TOPMOST_Z_LEVEL,
  type Viewport,
  WALL_HEIGHT,
  worldOrigin,
  worldY,
  wrap16,
  Z_STRIP_DELTA,
} from './geometry.ts';
import { DrawState, InstanceBuffer, InstanceFlags, ShadeKey, type SpriteSource } from './instances.ts';
import type { LevelRenderData } from './level-render-data.ts';
import type { StaticWorld, TileSprite } from './static-scene.ts';

export const ANIMATED_TILE_FRAME_MS = 200;
export const MAX_RENDERED_ITEMS = 2;
const SHADOW_INDEX_FLAGS = InstanceFlags.ONLY_SHADOW_INDEX;
const BODY_FLAGS = InstanceFlags.EXCEPT_SHADOW_INDEX;
const OBSCURED_FLAGS = InstanceFlags.EXCEPT_SHADOW_INDEX | InstanceFlags.DITHER;

export type UiNodeLayer = 'object' | 'roof' | 'onRoof' | 'topmost';

export interface WorldUiNode {
  readonly gridNo: number;
  readonly layer: UiNodeLayer;
  readonly tile: number;
  readonly head?: boolean;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly shade?: number;
}

export interface SoldierSprite extends SpriteSource {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly pixels: Uint8Array;
}

export interface SceneSoldier {
  readonly id: number;
  readonly gridNo: number;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly sprite: SoldierSprite;
  readonly paletteRow: number;
  readonly topmost: boolean;
}

export interface SceneItem {
  readonly gridNo: number;
  readonly level: number;
  readonly tile: number;
}

export interface DrawRun {
  readonly state: DrawState;
  readonly first: number;
  readonly count: number;
}

export interface DynamicFrame {
  readonly viewport: Viewport;
  readonly camera: Camera;
  readonly renderHeight: number;
  readonly rows: { readonly first: number; readonly last: number };
  readonly animationStep: number;
  readonly showRoofs: boolean;
  readonly soldiers: readonly SceneSoldier[];
  readonly items: readonly SceneItem[];
  readonly itemOutline: (onRoof: boolean) => number;
  readonly uiNodes: readonly WorldUiNode[];
}

export interface PlacedSoldier {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sprite: SoldierSprite;
  readonly topmost: boolean;
}

interface DynamicNode {
  readonly layer: LayerName | 'shadows';
  readonly tile: number;
}

type ListLayer = 'objects' | 'shadows' | 'structs' | 'roofs' | 'onRoof';

const UI_LAYER_OF: Readonly<Record<UiNodeLayer, ListLayer | 'topmost'>> = {
  object: 'objects',
  roof: 'roofs',
  onRoof: 'onRoof',
  topmost: 'topmost',
};

function isDynamic(te: TileElement | undefined): boolean {
  return !!te && (te.flags & (TileFlags.DYNAMIC | TileFlags.ANIMATED)) !== 0;
}

export function animatedTile(tiles: readonly TileElement[], tile: number, step: number): number {
  const te = tiles[tile];
  if (!te || !(te.flags & TileFlags.ANIMATED) || !te.animationFrames || te.animationFrames.length === 0) return tile;
  return te.animationFrames[step % te.animationFrames.length] ?? tile;
}

export function dynamicMapNodes(world: Pick<StaticWorld, 'level' | 'tiles'>, prepared: LevelRenderData): Map<number, DynamicNode[]> {
  const byTile = new Map<number, DynamicNode[]>();
  const layers: [ListLayer, (g: number) => Uint16Array][] = [
    ['objects', (g) => levelTilesAt(world.level.layers.objects, g)],
    ['shadows', (g) => levelTilesAt(prepared.shadows, g)],
    ['structs', (g) => levelTilesAt(world.level.layers.structs, g)],
    ['roofs', (g) => levelTilesAt(world.level.layers.roofs, g)],
    ['onRoof', (g) => levelTilesAt(world.level.layers.onRoof, g)],
  ];
  for (let g = 0; g < WORLD_MAX; g++) {
    for (const [layer, at] of layers) {
      for (const tile of at(g)) {
        if (!isDynamic(world.tiles[tile])) continue;
        const list = byTile.get(g) ?? [];
        list.push({ layer, tile });
        byTile.set(g, list);
      }
    }
  }
  return byTile;
}

export class DynamicScene {
  readonly instances = new InstanceBuffer();
  readonly itemInstances = new InstanceBuffer();
  readonly runs: DrawRun[] = [];
  readonly itemRuns: DrawRun[] = [];
  readonly placedSoldiers: PlacedSoldier[] = [];
  readonly #world: StaticWorld;
  readonly #mapNodes: Map<number, DynamicNode[]>;
  readonly #mapRows: Map<number, number[]>;
  #frameRows = new Map<number, number[]>();
  #frame: DynamicFrame | null = null;
  #soldiersByTile = new Map<number, SceneSoldier[]>();
  #uiByTile = new Map<number, WorldUiNode[]>();
  #itemsByTile = new Map<number, SceneItem[]>();

  constructor(world: StaticWorld, prepared: LevelRenderData) {
    this.#world = world;
    this.#mapNodes = dynamicMapNodes(world, prepared);
    this.#mapRows = rowsOf([...this.#mapNodes.keys()]);
  }

  build(frame: DynamicFrame): void {
    this.#frame = frame;
    this.instances.clear();
    this.itemInstances.clear();
    this.runs.length = 0;
    this.itemRuns.length = 0;
    this.placedSoldiers.length = 0;
    this.#soldiersByTile = groupBy(frame.soldiers, (s) => s.gridNo);
    this.#uiByTile = groupBy(frame.uiNodes, (n) => n.gridNo);
    this.#itemsByTile = groupBy(frame.items, (i) => i.gridNo * 2 + (i.level > 0 ? 1 : 0));
    this.#frameRows = rowsOf([
      ...frame.soldiers.map((s) => s.gridNo),
      ...frame.uiNodes.map((n) => n.gridNo),
      ...frame.items.map((i) => i.gridNo),
    ]);
    const first = Math.max(0, frame.rows.first);
    const last = Math.min(ROW_COUNT - 1, frame.rows.last);
    const rows: (readonly number[])[] = [];
    for (let s = first; s <= last; s++) rows.push(this.#rowTiles(s));
    for (const tiles of rows) this.#forRow(tiles, (g, x, y) => this.#emitItems(g, x, y, true));
    for (const tiles of rows) this.#forRow(tiles, (g, x, y) => this.#emitItems(g, x, y, false));
    for (const tiles of rows) {
      this.#forRow(tiles, (g, x, y) => this.#emitLayer(g, x, y, 'objects'));
      this.#forRow(tiles, (g, x, y) => this.#emitLayer(g, x, y, 'shadows'));
      this.#forRow(tiles, (g, x, y) => this.#emitSoldiers(g, x, y, true));
      this.#forRow(tiles, (g, x, y) => this.#emitSoldiers(g, x, y, false));
      this.#forRow(tiles, (g, x, y) => this.#emitLayer(g, x, y, 'structs'));
    }
    for (const tiles of rows) {
      if (frame.showRoofs) this.#forRow(tiles, (g, x, y) => this.#emitLayer(g, x, y, 'roofs'));
      this.#forRow(tiles, (g, x, y) => this.#emitSoldiers(g, x, y, true));
      if (frame.showRoofs) this.#forRow(tiles, (g, x, y) => this.#emitLayer(g, x, y, 'onRoof'));
    }
    for (const tiles of rows) this.#forRow(tiles, (g, x, y) => this.#emitTopmost(g, x, y));
  }

  #rowTiles(s: number): readonly number[] {
    const fixed = this.#mapRows.get(s);
    const extra = this.#frameRows.get(s);
    if (!extra) return fixed ?? NO_TILES;
    if (!fixed) return extra;
    return [...new Set([...fixed, ...extra])].sort((a, b) => (a % WORLD_COLS) - (b % WORLD_COLS));
  }

  #forRow(tiles: readonly number[], f: (g: number, x: number, y: number) => void): void {
    for (const g of tiles) f(g, g % WORLD_COLS, Math.floor(g / WORLD_COLS));
  }

  #push(target: InstanceBuffer, runs: DrawRun[], state: DrawState, emit: () => void): void {
    const before = target.count;
    emit();
    const added = target.count - before;
    if (added === 0) return;
    const last = runs.at(-1);
    if (last && last.state === state && last.first + last.count === before)
      runs[runs.length - 1] = { state, first: last.first, count: last.count + added };
    else runs.push({ state, first: before, count: added });
  }

  #sprite(tile: number): { te: TileElement; sprite: TileSprite } | null {
    const te = this.#world.tiles[tile];
    if (!te?.surfacePath) return null;
    const sprite = this.#world.sprite(tile);
    return sprite && sprite.width > 0 && sprite.height > 0 ? { te, sprite } : null;
  }

  #emitLayer(g: number, x: number, y: number, layer: ListLayer): void {
    const ui = (this.#uiByTile.get(g) ?? []).filter((n) => UI_LAYER_OF[n.layer] === layer);
    for (const n of ui) if (n.head) this.#emitUiNode(n, x, y, layer);
    for (const node of this.#mapNodes.get(g) ?? []) if (node.layer === layer) this.#emitMapNode(g, x, y, layer, node.tile);
    for (const n of ui) if (!n.head) this.#emitUiNode(n, x, y, layer);
  }

  #emitTopmost(g: number, x: number, y: number): void {
    const ui = (this.#uiByTile.get(g) ?? []).filter((n) => n.layer === 'topmost');
    for (const n of ui) if (n.head) this.#emitUiNode(n, x, y, 'topmost');
    for (const n of ui) if (!n.head) this.#emitUiNode(n, x, y, 'topmost');
  }

  #position(g: number, x: number, y: number, te: TileElement, sprite: TileSprite, layer: ListLayer | 'topmost') {
    const o = worldOrigin(x, y);
    const lift = heightAdjusted(this.#world.level.heights[g] ?? 0, (te.flags & TileFlags.IGNORE_WORLD_HEIGHT) !== 0);
    const roofLift = layer === 'roofs' || layer === 'onRoof' ? WALL_HEIGHT : 0;
    return { x: o.x + sprite.offsetX, y: o.y - lift - roofLift + sprite.offsetY };
  }

  #emitMapNode(g: number, x: number, y: number, layer: ListLayer, mapTile: number): void {
    const frame = this.#frame as DynamicFrame;
    const d = this.#sprite(animatedTile(this.#world.tiles, mapTile, frame.animationStep));
    if (!d) return;
    const p = this.#position(g, x, y, d.te, d.sprite, layer);
    this.#emitNode(p, d, x, y, layer, layer === 'roofs' || layer === 'onRoof' ? ShadeKey.ROOF_BASE + g : g, d.sprite.paletteBase);
  }

  #emitUiNode(n: WorldUiNode, x: number, y: number, layer: ListLayer | 'topmost'): void {
    const frame = this.#frame as DynamicFrame;
    const d = this.#sprite(animatedTile(this.#world.tiles, n.tile, frame.animationStep));
    if (!d) return;
    const p = this.#position(n.gridNo, x, y, d.te, d.sprite, layer);
    const at = { x: p.x + (n.offsetX ?? 0), y: p.y + (n.offsetY ?? 0) };
    const shade = n.shade ?? UI_NODE_SHADE;
    this.#emitNode(at, d, x, y, layer, ShadeKey.FIXED, d.sprite.paletteBase + shade);
  }

  #emitNode(
    p: { x: number; y: number },
    d: { te: TileElement; sprite: TileSprite },
    x: number,
    y: number,
    layer: ListLayer | 'topmost',
    shadeKey: number,
    row: number,
  ): void {
    const wy = worldY(x, y, this.#world.topY);
    const out = this.instances;
    const s = d.sprite;
    switch (layer) {
      case 'objects': {
        const z = d.te.flags & TileFlags.CLIFFHANG ? 0 : d.te.flags & TileFlags.OBJECTLAYER_USEZHEIGHT ? objectZ(wy) : OBJECT_Z_LEVEL;
        this.#push(out, this.runs, DrawState.NEARER_OR_EQUAL, () => out.push(p.x, p.y, s, 0, s.width, row, z, shadeKey, 0, 0));
        return;
      }
      case 'shadows':
        this.#push(out, this.runs, DrawState.SHADOW_FLAT, () => out.push(p.x, p.y, s, 0, s.width, row, 0, ShadeKey.FIXED, 0, 0));
        return;
      case 'structs': {
        const z = structZ(wy);
        if (d.te.flags & TileFlags.MULTI_Z && d.te.zStrip) {
          this.#push(out, this.runs, DrawState.NEARER_WRITE, () => emitStrips(out, p, d.te, s, z, shadeKey, row));
          return;
        }
        this.#push(out, this.runs, DrawState.NEARER_OR_EQUAL, () => out.push(p.x, p.y, s, 0, s.width, row, wrap16(z), shadeKey, 0, 0));
        return;
      }
      case 'roofs':
        this.#push(out, this.runs, DrawState.NEARER_OR_EQUAL, () => out.push(p.x, p.y, s, 0, s.width, row, roofZ(wy), shadeKey, 0, 0));
        return;
      case 'onRoof':
        this.#push(out, this.runs, DrawState.NEARER_OR_EQUAL, () => out.push(p.x, p.y, s, 0, s.width, row, onRoofZ(wy), shadeKey, 0, 0));
        return;
      case 'topmost':
        this.#push(out, this.runs, DrawState.NEARER_OR_EQUAL, () =>
          out.push(p.x, p.y, s, 0, s.width, row, TOPMOST_Z_LEVEL, shadeKey, 0, 0),
        );
        return;
    }
  }

  #emitSoldiers(g: number, x: number, y: number, roof: boolean): void {
    const soldiers = this.#soldiersByTile.get(g);
    if (!soldiers) return;
    const frame = this.#frame as DynamicFrame;
    const c = mapCenter(frame.viewport);
    const wy = worldY(x, y, this.#world.topY);
    const height = this.#world.level.heights[g] ?? 0;
    const offX = c.x - 2 * (frame.camera.centerX - frame.camera.centerY);
    const offY = c.y - (frame.camera.centerX + frame.camera.centerY) + frame.renderHeight;
    for (const m of soldiers) {
      if (m.level > 0 !== roof) continue;
      const dx = Math.fround(m.x - frame.camera.centerX);
      const dy = Math.fround(m.y - frame.camera.centerY);
      const screenX = c.x + Math.trunc(Math.fround(2 * dx - 2 * dy));
      const screenY = c.y + Math.trunc(Math.fround(dx + dy)) - height - MERC_SCREEN_OFFSET_Y - m.level * WALL_HEIGHT + frame.renderHeight;
      const sx = screenX + m.sprite.offsetX - offX;
      const sy = screenY + m.sprite.offsetY - offY;
      const z = m.topmost ? TOPMOST_Z_LEVEL : m.level > 0 ? roofMercZ(wy) : mercZ(wy);
      const out = this.instances;
      const sprite = m.sprite;
      this.#push(out, this.runs, DrawState.NEARER_SHADOW, () =>
        out.push(sx, sy, sprite, 0, sprite.width, m.paletteRow, z, ShadeKey.FIXED, SHADOW_INDEX_FLAGS, 0),
      );
      this.#push(out, this.runs, DrawState.NEARER_OR_EQUAL, () =>
        out.push(sx, sy, sprite, 0, sprite.width, m.paletteRow, z, ShadeKey.FIXED, BODY_FLAGS, 0),
      );
      this.#push(out, this.runs, DrawState.FARTHER, () =>
        out.push(sx, sy, sprite, 0, sprite.width, m.paletteRow, z, ShadeKey.FIXED, OBSCURED_FLAGS, 0),
      );
      this.placedSoldiers.push({
        id: m.id,
        x: sx + offX,
        y: sy + offY,
        width: sprite.width,
        height: sprite.height,
        sprite,
        topmost: m.topmost,
      });
    }
  }

  #emitItems(g: number, x: number, y: number, dither: boolean): void {
    const frame = this.#frame as DynamicFrame;
    const flags = InstanceFlags.OUTLINE_SHADOW_INDEX | (dither ? InstanceFlags.DITHER : 0);
    const state = dither ? DrawState.FARTHER_OR_EQUAL : DrawState.NEARER_WRITE;
    const wy = worldY(x, y, this.#world.topY);
    for (const roof of [false, true]) {
      const items = this.#itemsByTile.get(g * 2 + (roof ? 1 : 0));
      if (!items) continue;
      const z = roof ? onRoofZ(wy) : itemZ(wy);
      const outline = frame.itemOutline(roof);
      const shadeKey = roof ? ShadeKey.ROOF_BASE + g : g;
      for (const item of items.slice(0, MAX_RENDERED_ITEMS)) {
        const d = this.#sprite(item.tile);
        if (!d) continue;
        const p = this.#position(g, x, y, d.te, d.sprite, roof ? 'onRoof' : 'structs');
        const out = this.itemInstances;
        const s = d.sprite;
        this.#push(out, this.itemRuns, state, () => out.push(p.x, p.y, s, 0, s.width, s.paletteBase, z, shadeKey, flags, outline));
      }
    }
  }
}

const UI_NODE_SHADE = 4;

function emitStrips(
  out: InstanceBuffer,
  p: { x: number; y: number },
  te: TileElement,
  sprite: TileSprite,
  base: number,
  shadeKey: number,
  row: number,
): void {
  const strip = te.zStrip;
  if (!strip) return;
  let z = base + Z_STRIP_DELTA * strip.initialZChange;
  let srcX = 0;
  let width = Math.min(strip.firstStripWidth, sprite.width);
  let k = 0;
  while (srcX < sprite.width) {
    out.push(p.x, p.y, sprite, srcX, width, row, wrap16(z), shadeKey, 0, 0);
    srcX += width;
    width = Math.min(HALF_TILE_X, sprite.width - srcX);
    z += Z_STRIP_DELTA * (strip.zChanges[k++] ?? 0);
  }
}

const NO_TILES: readonly number[] = [];

function rowsOf(tiles: readonly number[]): Map<number, number[]> {
  const rows = new Map<number, number[]>();
  for (const g of new Set(tiles)) {
    if (g < 0 || g >= WORLD_MAX) continue;
    const s = (g % WORLD_COLS) + Math.floor(g / WORLD_COLS);
    const list = rows.get(s);
    if (list) list.push(g);
    else rows.set(s, [g]);
  }
  for (const list of rows.values()) list.sort((a, b) => (a % WORLD_COLS) - (b % WORLD_COLS));
  return rows;
}

function groupBy<T>(list: readonly T[], key: (t: T) => number): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const t of list) {
    const k = key(t);
    const l = m.get(k);
    if (l) l.push(t);
    else m.set(k, [t]);
  }
  return m;
}

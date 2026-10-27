// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/RenderWorld.cc RenderDynamicWorld, RenderTiles (dynamic layers, animated tiles, mercs,
// @src items, LEVELNODE_USERELPOS, LEVELNODE_USEABSOLUTEPOS, LEVELNODE_USEZ, LEVELNODE_CACHEDANITILE);
// @src src/game/TileEngine/Tile_Animation.cc CreateAnimationTile (every animation tile has LEVELNODE_USEZ);
// @src src/game/Tactical/Interface_Control.cc SetUpInterface (UI nodes); src/game/Tactical/Rotting_Corpses.cc
// @src AddRottingCorpse (ANITILE_PAUSED: a corpse is drawn with the static world, before every merc). See docs/05 §2.5,
// @src docs/28 §6.4.

import type { LayerName } from '../../content/formats/map.ts';
import { CELL_X_SIZE, CELL_Y_SIZE, WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import { type TileElement, TileFlags } from '../../content/world/tile-database.ts';
import type { ZStripInfo } from '../../content/world/zstrip.ts';
import {
  animationTileZ,
  type Camera,
  corpseZ,
  HALF_TILE_X,
  heightAdjusted,
  itemZ,
  MERC_SCREEN_OFFSET_Y,
  mapCenter,
  mercZ,
  NOBURN_Z_BONUS,
  OBJECT_Z_LEVEL,
  objectZ,
  onRoofZ,
  ROW_COUNT,
  roofCorpseZ,
  roofMercZ,
  roofZ,
  STRUCT_Z_LEVEL,
  structZ,
  TOPMOST_Z_LEVEL,
  type Viewport,
  WALL_HEIGHT,
  worldOrigin,
  worldY,
  wrap16,
  Z_STRIP_DELTA,
  Z_SUBLAYERS,
} from './geometry.ts';
import { DrawState, InstanceBuffer, InstanceFlags, ShadeKey, type SpriteSource } from './instances.ts';
import type { LevelRenderData } from './level-render-data.ts';
import type { StaticWorld, TileSprite } from './static-scene.ts';

export const ANIMATED_TILE_FRAME_MS = 200;
export const MAX_RENDERED_ITEMS = 2;
const SHADOW_INDEX_FLAGS = InstanceFlags.ONLY_SHADOW_INDEX;
const CENTRE_OFFSET = 5;
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

export interface OffsetSprite extends SpriteSource {
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface SoldierSprite extends OffsetSprite {
  readonly pixels: Uint8Array;
}

export interface MultiTileLook {
  readonly zStrip: ZStripInfo | null;
  readonly zTileOffsetX: number;
  readonly zTileOffsetY: number;
  readonly vehicle: boolean;
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
  readonly multiTile?: MultiTileLook | null;
}

type MercPass = 'structMercs' | 'mercs' | 'highMercs';

function inPass(m: SceneSoldier, pass: MercPass): boolean {
  if (m.multiTile) return pass === 'structMercs';
  if (pass === 'mercs') return m.level === 0;
  return m.level > 0;
}

export type AniTileKind =
  | 'corpse'
  | 'vehicleCorpse'
  | 'smoke'
  | 'staticSmoke'
  | 'miniboom'
  | 'explosion'
  | 'knife'
  | 'knifeShadow'
  | 'trail'
  | 'vaporize';

const PAUSED_ANI_KINDS: ReadonlySet<AniTileKind> = new Set(['corpse', 'vehicleCorpse']);

type AniLayer = 'paused' | 'shadows' | 'structs' | 'onRoof' | 'topmost';

function aniLayerOf(a: SceneAniTile): AniLayer {
  if (PAUSED_ANI_KINDS.has(a.kind)) return 'paused';
  if (a.kind === 'miniboom' || a.kind === 'explosion') return 'topmost';
  if (a.kind === 'knifeShadow') return 'shadows';
  return a.level > 0 ? 'onRoof' : 'structs';
}

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

export interface SceneAniTile {
  readonly kind: AniTileKind;
  readonly gridNo: number;
  readonly level: number;
  readonly at?: WorldPoint & { readonly z: number };
  readonly translucent?: boolean;
  readonly sprite: OffsetSprite;
  readonly paletteRow: number;
  readonly shaded: boolean;
  readonly zStrip: ZStripInfo | null;
  readonly zTileOffsetX: number;
  readonly zTileOffsetY: number;
}

export interface StructNode {
  readonly gridNo: number;
  readonly tile: number;
  readonly absolute: WorldPoint | null;
  readonly relativeZ: number;
  readonly animation: boolean;
  readonly inShadowLayer?: boolean;
}

export interface SceneItem {
  readonly gridNo: number;
  readonly level: number;
  readonly tile: number;
  readonly height?: number;
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
  readonly aniTiles: readonly SceneAniTile[];
  readonly structNodes: readonly StructNode[];
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

export interface DynamicNode {
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

export function isDynamic(te: TileElement | undefined): boolean {
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
  readonly #noBurn: Uint8Array;
  #frameRows = new Map<number, number[]>();
  #frame: DynamicFrame | null = null;
  #soldiersByTile = new Map<number, SceneSoldier[]>();
  #uiByTile = new Map<number, WorldUiNode[]>();
  #itemsByTile = new Map<number, SceneItem[]>();
  #aniByTile = new Map<number, SceneAniTile[]>();
  #structNodesByTile = new Map<number, StructNode[]>();

  constructor(world: StaticWorld, prepared: LevelRenderData, mapNodes?: Map<number, DynamicNode[]>) {
    this.#world = world;
    this.#mapNodes = mapNodes ?? dynamicMapNodes(world, prepared);
    this.#mapRows = rowsOf([...this.#mapNodes.keys()]);
    this.#noBurn = prepared.noBurn;
  }

  get mapNodes(): Map<number, DynamicNode[]> {
    return this.#mapNodes;
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
    this.#aniByTile = groupBy(frame.aniTiles, (a) => a.gridNo * 2 + (a.level > 0 ? 1 : 0));
    this.#structNodesByTile = groupBy(frame.structNodes, (n) => n.gridNo);
    this.#frameRows = rowsOf([
      ...frame.soldiers.map((s) => s.gridNo),
      ...frame.uiNodes.map((n) => n.gridNo),
      ...frame.items.map((i) => i.gridNo),
      ...frame.aniTiles.map((a) => a.gridNo),
      ...frame.structNodes.map((n) => n.gridNo),
    ]);
    const first = Math.max(0, frame.rows.first);
    const last = Math.min(ROW_COUNT - 1, frame.rows.last);
    const rows: (readonly number[])[] = [];
    for (let s = first; s <= last; s++) rows.push(this.#rowTiles(s));
    for (const tiles of rows) this.#forRow(tiles, (g, x, y) => this.#emitItems(g, x, y, true));
    for (const tiles of rows) this.#forRow(tiles, (g, x, y) => this.#emitItems(g, x, y, false));
    for (const tiles of rows) this.#forRow(tiles, (g, x, y) => this.#emitPausedAniTiles(g, x, y, 0));
    if (frame.showRoofs) for (const tiles of rows) this.#forRow(tiles, (g, x, y) => this.#emitPausedAniTiles(g, x, y, 1));
    for (const tiles of rows) {
      this.#forRow(tiles, (g, x, y) => this.#emitLayer(g, x, y, 'objects'));
      this.#forRow(tiles, (g, x, y) => this.#emitLayer(g, x, y, 'shadows'));
      this.#forRow(tiles, (g, x, y) => this.#emitSoldiers(g, x, y, 'structMercs'));
      this.#forRow(tiles, (g, x, y) => this.#emitSoldiers(g, x, y, 'mercs'));
      this.#forRow(tiles, (g, x, y) => this.#emitLayer(g, x, y, 'structs'));
    }
    for (const tiles of rows) {
      if (frame.showRoofs) this.#forRow(tiles, (g, x, y) => this.#emitLayer(g, x, y, 'roofs'));
      this.#forRow(tiles, (g, x, y) => this.#emitSoldiers(g, x, y, 'highMercs'));
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
    if (layer === 'shadows') {
      for (const n of this.#structNodesByTile.get(g) ?? []) if (n.inShadowLayer) this.#emitShadowNode(n);
      for (const a of this.#aniByTile.get(g * 2) ?? []) if (aniLayerOf(a) === 'shadows') this.#emitAniTile(a, x, y);
    }
    for (const node of this.#mapNodes.get(g) ?? []) if (node.layer === layer) this.#emitMapNode(g, x, y, layer, node.tile);
    if (layer === 'structs' || layer === 'onRoof')
      for (const a of this.#aniByTile.get(g * 2 + (layer === 'onRoof' ? 1 : 0)) ?? [])
        if (aniLayerOf(a) === layer) this.#emitAniTile(a, x, y);
    if (layer === 'structs') for (const n of this.#structNodesByTile.get(g) ?? []) if (!n.inShadowLayer) this.#emitStructNode(n, x, y);
    for (const n of ui) if (!n.head) this.#emitUiNode(n, x, y, layer);
  }

  #emitStructNode(n: StructNode, x: number, y: number): void {
    const d = this.#sprite(n.tile);
    if (!d) return;
    const p = n.absolute
      ? this.#absolutePosition(n.absolute, n.relativeZ, d.sprite)
      : this.#liftedPosition(this.#position(n.gridNo, x, y, d.te, d.sprite, 'structs'), n.animation ? n.relativeZ : 0);
    const row = d.sprite.paletteBase + DEFAULT_SHADE_LEVEL;
    if (!n.animation) {
      this.#emitNode(p, d, x, y, 'structs', ShadeKey.FIXED, row);
      return;
    }
    const z = animationTileZ(worldY(x, y, this.#world.topY), n.relativeZ);
    const out = this.instances;
    this.#push(out, this.runs, DrawState.NEARER_OR_EQUAL, () =>
      out.push(p.x, p.y, d.sprite, 0, d.sprite.width, row, z, ShadeKey.FIXED, 0, 0),
    );
  }

  #emitShadowNode(n: StructNode): void {
    const d = this.#sprite(n.tile);
    if (!d || !n.absolute) return;
    const p = this.#absolutePosition(n.absolute, n.relativeZ, d.sprite);
    const out = this.instances;
    const s = d.sprite;
    this.#push(out, this.runs, DrawState.SHADOW_FLAT, () => out.push(p.x, p.y, s, 0, s.width, s.paletteBase, 0, ShadeKey.FIXED, 0, 0));
  }

  #liftedPosition(p: { x: number; y: number }, lift: number): { x: number; y: number } {
    return { x: p.x, y: p.y - lift };
  }

  #absolutePosition(at: WorldPoint, relativeZ: number, sprite: OffsetSprite): { x: number; y: number } {
    const frame = this.#frame as DynamicFrame;
    const c = mapCenter(frame.viewport);
    const offX = c.x - 2 * (frame.camera.centerX - frame.camera.centerY);
    const offY = c.y - (frame.camera.centerX + frame.camera.centerY) + frame.renderHeight;
    const dx = Math.fround(at.x - CELL_Y_SIZE - frame.camera.centerX);
    const dy = Math.fround(at.y - frame.camera.centerY);
    const screenX = c.x + Math.trunc(Math.fround(2 * dx - 2 * dy));
    const screenY = c.y + Math.trunc(Math.fround(dx + dy)) - MERC_SCREEN_OFFSET_Y - relativeZ + frame.renderHeight;
    return { x: screenX + sprite.offsetX - offX, y: screenY + sprite.offsetY - offY };
  }

  #cachedAniPosition(a: SceneAniTile, at: WorldPoint & { readonly z: number }): { x: number; y: number } {
    const frame = this.#frame as DynamicFrame;
    const c = mapCenter(frame.viewport);
    const offX = c.x - 2 * (frame.camera.centerX - frame.camera.centerY);
    const offY = c.y - (frame.camera.centerX + frame.camera.centerY) + frame.renderHeight;
    const dx = Math.fround(at.x - frame.camera.centerX);
    const dy = Math.fround(at.y - frame.camera.centerY);
    const height = this.#world.level.heights[a.gridNo] ?? 0;
    const screenX = c.x + Math.trunc(Math.fround(2 * dx - 2 * dy));
    const screenY = c.y + Math.trunc(Math.fround(dx + dy)) - height - MERC_SCREEN_OFFSET_Y - at.z + frame.renderHeight;
    return { x: screenX + a.sprite.offsetX - offX, y: screenY + a.sprite.offsetY - offY };
  }

  #emitPausedAniTiles(g: number, x: number, y: number, level: number): void {
    for (const a of this.#aniByTile.get(g * 2 + level) ?? []) if (aniLayerOf(a) === 'paused') this.#emitAniTile(a, x, y);
  }

  #centreScreen(g: number, level: number): { readonly x: number; readonly y: number } {
    const frame = this.#frame as DynamicFrame;
    const c = mapCenter(frame.viewport);
    const offX = c.x - 2 * (frame.camera.centerX - frame.camera.centerY);
    const offY = c.y - (frame.camera.centerX + frame.camera.centerY) + frame.renderHeight;
    const dx = (g % WORLD_COLS) * CELL_X_SIZE + CENTRE_OFFSET - frame.camera.centerX;
    const dy = Math.floor(g / WORLD_COLS) * CELL_Y_SIZE + CENTRE_OFFSET - frame.camera.centerY;
    const height = this.#world.level.heights[g] ?? 0;
    return {
      x: c.x + Math.trunc(2 * dx - 2 * dy) - offX,
      y: c.y + Math.trunc(dx + dy) - height - MERC_SCREEN_OFFSET_Y - level * WALL_HEIGHT + frame.renderHeight - offY,
    };
  }

  #aniZ(a: SceneAniTile, x: number, y: number): number {
    const topY = this.#world.topY;
    if (a.kind === 'smoke' || a.kind === 'staticSmoke') return a.level > 0 ? onRoofZ(worldY(x, y, topY)) : itemZ(worldY(x, y, topY));
    if (a.level > 0) return roofCorpseZ(worldY(x, y, topY));
    if (a.kind === 'vehicleCorpse') return wrap16(worldY(x + a.zTileOffsetX, y + a.zTileOffsetY, topY) * Z_SUBLAYERS + STRUCT_Z_LEVEL);
    return corpseZ(worldY(x - 1, y - 1, topY));
  }

  #emitAniTile(a: SceneAniTile, x: number, y: number): void {
    if (a.at) {
      this.#emitFlyingAniTile(a, a.at, x, y);
      return;
    }
    const centre = this.#centreScreen(a.gridNo, a.level);
    const p = { x: centre.x + a.sprite.offsetX, y: centre.y + a.sprite.offsetY };
    const z = this.#aniZ(a, x, y);
    const shadeKey = a.shaded ? (a.level > 0 ? ShadeKey.ROOF_BASE + a.gridNo : a.gridNo) : ShadeKey.FIXED;
    const out = this.instances;
    const s = a.sprite;
    if (a.kind === 'smoke' || a.kind === 'staticSmoke') {
      const state = a.kind === 'smoke' ? DrawState.TRANSLUCENT : DrawState.NEARER_OR_EQUAL;
      this.#push(out, this.runs, state, () => out.push(p.x, p.y, s, 0, s.width, a.paletteRow, z, shadeKey, 0, 0));
      return;
    }
    const strip = a.zStrip;
    this.#push(out, this.runs, DrawState.NEARER_SHADOW, () =>
      strip
        ? emitStrips(out, p, strip, s, z, shadeKey, a.paletteRow, SHADOW_INDEX_FLAGS)
        : out.push(p.x, p.y, s, 0, s.width, a.paletteRow, z, shadeKey, SHADOW_INDEX_FLAGS, 0),
    );
    this.#push(out, this.runs, DrawState.NEARER_WRITE, () =>
      strip
        ? emitStrips(out, p, strip, s, z, shadeKey, a.paletteRow, BODY_FLAGS)
        : out.push(p.x, p.y, s, 0, s.width, a.paletteRow, z, shadeKey, BODY_FLAGS, 0),
    );
  }

  #emitFlyingAniTile(a: SceneAniTile, at: WorldPoint & { readonly z: number }, x: number, y: number): void {
    const p = this.#cachedAniPosition(a, at);
    const out = this.instances;
    const s = a.sprite;
    if (a.kind === 'knifeShadow') {
      this.#push(out, this.runs, DrawState.SHADOW_FLAT, () => out.push(p.x, p.y, s, 0, s.width, a.paletteRow, 0, ShadeKey.FIXED, 0, 0));
      return;
    }
    const z = animationTileZ(worldY(x, y, this.#world.topY), at.z);
    const state = a.translucent ? DrawState.TRANSLUCENT : DrawState.NEARER_OR_EQUAL;
    this.#push(out, this.runs, state, () => out.push(p.x, p.y, s, 0, s.width, a.paletteRow, z, ShadeKey.FIXED, 0, 0));
  }

  #emitTopmost(g: number, x: number, y: number): void {
    const ui = (this.#uiByTile.get(g) ?? []).filter((n) => n.layer === 'topmost');
    for (const n of ui) if (n.head) this.#emitUiNode(n, x, y, 'topmost');
    for (const a of this.#aniByTile.get(g * 2) ?? []) if (aniLayerOf(a) === 'topmost') this.#emitTopmostAniTile(a);
    for (const n of ui) if (!n.head) this.#emitUiNode(n, x, y, 'topmost');
  }

  #emitTopmostAniTile(a: SceneAniTile): void {
    const p = a.at ? this.#cachedAniPosition(a, a.at) : this.#centreScreen(a.gridNo, a.level);
    const out = this.instances;
    const s = a.sprite;
    this.#push(out, this.runs, a.translucent ? DrawState.TRANSLUCENT : DrawState.NEARER_OR_EQUAL, () =>
      out.push(p.x, p.y, s, 0, s.width, a.paletteRow, TOPMOST_Z_LEVEL, ShadeKey.FIXED, 0, 0),
    );
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
    const shade = n.shade ?? DEFAULT_SHADE_LEVEL;
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
          const strip = d.te.zStrip;
          this.#push(out, this.runs, DrawState.NEARER_WRITE, () => emitStrips(out, p, strip, s, z, shadeKey, row, 0));
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

  #soldierZ(m: SceneSoldier, x: number, y: number, noBurn: boolean): number {
    const mt = m.multiTile;
    const wy = worldY(x + (mt?.zTileOffsetX ?? 0), y + (mt?.zTileOffsetY ?? 0), this.#world.topY);
    let z: number;
    if (mt?.vehicle) z = wrap16(wy * Z_SUBLAYERS + STRUCT_Z_LEVEL);
    else if (m.topmost) z = TOPMOST_Z_LEVEL;
    else z = m.level > 0 ? roofMercZ(wy) : mercZ(wy);
    return noBurn ? wrap16(z + NOBURN_Z_BONUS) : z;
  }

  #emitSoldierParts(m: SceneSoldier, p: { x: number; y: number }, z: number, noBurn: boolean): void {
    const out = this.instances;
    const sprite = m.sprite;
    const strip = m.multiTile?.zStrip ?? null;
    const part = (flags: number) => () =>
      strip
        ? emitStrips(out, p, strip, sprite, z, ShadeKey.FIXED, m.paletteRow, flags)
        : out.push(p.x, p.y, sprite, 0, sprite.width, m.paletteRow, z, ShadeKey.FIXED, flags, 0);
    this.#push(out, this.runs, DrawState.NEARER_SHADOW, part(SHADOW_INDEX_FLAGS));
    this.#push(out, this.runs, strip ? DrawState.NEARER_WRITE : DrawState.NEARER_OR_EQUAL, part(BODY_FLAGS));
    if (!noBurn) this.#push(out, this.runs, DrawState.FARTHER, part(OBSCURED_FLAGS));
  }

  #emitSoldiers(g: number, x: number, y: number, pass: MercPass): void {
    const soldiers = this.#soldiersByTile.get(g);
    if (!soldiers) return;
    const frame = this.#frame as DynamicFrame;
    const c = mapCenter(frame.viewport);
    const height = this.#world.level.heights[g] ?? 0;
    const offX = c.x - 2 * (frame.camera.centerX - frame.camera.centerY);
    const offY = c.y - (frame.camera.centerX + frame.camera.centerY) + frame.renderHeight;
    for (const m of soldiers) {
      if (!inPass(m, pass)) continue;
      const dx = Math.fround(m.x - frame.camera.centerX);
      const dy = Math.fround(m.y - frame.camera.centerY);
      const screenX = c.x + Math.trunc(Math.fround(2 * dx - 2 * dy));
      const screenY = c.y + Math.trunc(Math.fround(dx + dy)) - height - MERC_SCREEN_OFFSET_Y - m.level * WALL_HEIGHT + frame.renderHeight;
      const sx = screenX + m.sprite.offsetX - offX;
      const sy = screenY + m.sprite.offsetY - offY;
      const noBurn = this.#noBurn[g] === 1;
      this.#emitSoldierParts(m, { x: sx, y: sy }, this.#soldierZ(m, x, y, noBurn), noBurn);
      this.placedSoldiers.push({
        id: m.id,
        x: sx + offX,
        y: sy + offY,
        width: m.sprite.width,
        height: m.sprite.height,
        sprite: m.sprite,
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
      const outline = frame.itemOutline(roof);
      const shadeKey = roof ? ShadeKey.ROOF_BASE + g : g;
      for (const item of items.slice(0, MAX_RENDERED_ITEMS)) {
        const d = this.#sprite(item.tile);
        if (!d) continue;
        const raised = item.height ?? 0;
        const z = raised > 0 ? wrap16(wy * Z_SUBLAYERS + STRUCT_Z_LEVEL + raised) : roof ? onRoofZ(wy) : itemZ(wy);
        const at = this.#position(g, x, y, d.te, d.sprite, roof ? 'onRoof' : 'structs');
        const p = { x: at.x, y: at.y - raised };
        const out = this.itemInstances;
        const s = d.sprite;
        this.#push(out, this.itemRuns, state, () => out.push(p.x, p.y, s, 0, s.width, s.paletteBase, z, shadeKey, flags, outline));
      }
    }
  }
}

const DEFAULT_SHADE_LEVEL = 4;

function emitStrips(
  out: InstanceBuffer,
  p: { x: number; y: number },
  strip: ZStripInfo,
  sprite: SpriteSource,
  base: number,
  shadeKey: number,
  row: number,
  flags: number,
): void {
  let z = base + Z_STRIP_DELTA * strip.initialZChange;
  let srcX = 0;
  let width = Math.min(strip.firstStripWidth, sprite.width);
  let k = 0;
  while (srcX < sprite.width) {
    out.push(p.x, p.y, sprite, srcX, width, row, wrap16(z), shadeKey, flags, 0);
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

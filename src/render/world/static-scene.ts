// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/RenderWorld.cc RenderStaticWorld, RenderTiles (static layers, node filters, z levels,
// @src blitter choice), MultiZBlitter; src/game/TileEngine/WorldMan.cc SetTreeTopStateForMap. See docs/05 §2–§5.

import type { LayerName } from '../../content/formats/map.ts';
import { WORLD_COLS, WORLD_ROWS } from '../../content/world/grid.ts';
import { type Level, levelTilesAt } from '../../content/world/level.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import { type TileElement, TileFlags } from '../../content/world/tile-database.ts';
import {
  HALF_TILE_X,
  heightAdjusted,
  OBJECT_Z_LEVEL,
  objectZ,
  onRoofZ,
  ROW_COUNT,
  roofZ,
  shadowZ,
  structZ,
  TOPMOST_Z_LEVEL,
  WALL_HEIGHT,
  worldOrigin,
  worldY,
  wrap16,
  Z_STRIP_DELTA,
} from './geometry.ts';
import { DrawState, FLOATS_PER_INSTANCE, InstanceBuffer, InstanceFlags, ShadeKey, type SpriteSource } from './instances.ts';
import type { LevelRenderData } from './level-render-data.ts';
import { NodeFlags, type RevealState } from './reveal.ts';

export const StaticSegment = {
  LAND: 0,
  OBJECTS: 1,
  SHADOWS: 2,
  STRUCTS: 3,
  STRICT_STRIPS: 4,
  ROOFS: 5,
  ON_ROOF: 6,
  TOPMOST: 7,
  OBSCURED_DITHER: 8,
  OBSCURED_STRIP_DITHER: 9,
  OBSCURED: 10,
} as const;
export type StaticSegment = (typeof StaticSegment)[keyof typeof StaticSegment];

export const STATIC_SEGMENT_COUNT = 11;

export const STATIC_SEGMENT_STATES: readonly DrawState[] = [
  DrawState.LAND,
  DrawState.NEARER_OR_EQUAL_WRITE,
  DrawState.SHADOW_WRITE,
  DrawState.NEARER_OR_EQUAL_WRITE,
  DrawState.NEARER_WRITE,
  DrawState.NEARER_OR_EQUAL_WRITE,
  DrawState.NEARER_OR_EQUAL_WRITE,
  DrawState.NEARER_OR_EQUAL_WRITE,
  DrawState.FARTHER_OR_EQUAL,
  DrawState.ALWAYS_WRITE,
  DrawState.NEARER_WRITE,
];

export interface TileSprite extends SpriteSource {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly paletteBase: number;
}

export interface StaticWorld {
  readonly level: Level;
  readonly tiles: readonly TileElement[];
  readonly prepared: LevelRenderData;
  readonly topY: number;
  sprite(tile: number): TileSprite | null;
}

export interface StaticState {
  readonly reveal: RevealState;
  readonly openDoors: ReadonlySet<number>;
  readonly treeTops: boolean;
  readonly wireframes: boolean;
  readonly roofLevel: boolean;
}

export interface AssembledScene {
  readonly data: Float32Array;
  readonly count: number;
  readonly segmentStart: Int32Array;
  readonly rowStart: Int32Array;
}

const EMPTY_ROW = new Float32Array(0);
const TREE_TOP_SKIP = 2;
const NO_INSTANCE_FLAGS = InstanceFlags.NONE;
const NO_OUTLINE = 0;

function isDynamic(te: TileElement): boolean {
  return (te.flags & (TileFlags.DYNAMIC | TileFlags.ANIMATED)) !== 0;
}

export function substituteOpenDoor(tiles: readonly TileElement[], openDoors: ReadonlySet<number>, g: number, tile: number): number {
  if (!openDoors.has(g)) return tile;
  const def = tiles[tile]?.structure;
  return def && has(def.flags, StructureFlags.ANYDOOR) && !has(def.flags, StructureFlags.OPEN) ? tile + def.partnerDelta : tile;
}

export class StaticScene {
  readonly #world: StaticWorld;
  #state: StaticState;
  readonly #rows: Float32Array[][] = Array.from({ length: STATIC_SEGMENT_COUNT }, () => new Array<Float32Array>(ROW_COUNT).fill(EMPTY_ROW));
  readonly #scratch: InstanceBuffer[] = Array.from({ length: STATIC_SEGMENT_COUNT }, () => new InstanceBuffer());
  #assembled: AssembledScene | null = null;

  constructor(world: StaticWorld, state: StaticState) {
    this.#world = world;
    this.#state = state;
    this.rebuildAll();
  }

  get state(): StaticState {
    return this.#state;
  }

  setState(state: StaticState, rows: Iterable<number> | 'all'): void {
    this.#state = state;
    if (rows === 'all') this.rebuildAll();
    else for (const s of rows) this.#buildRow(s);
    this.#assembled = null;
  }

  rebuildAll(): void {
    for (let s = 0; s < ROW_COUNT; s++) this.#buildRow(s);
    this.#assembled = null;
  }

  assemble(): AssembledScene {
    if (this.#assembled) return this.#assembled;
    const segmentStart = new Int32Array(STATIC_SEGMENT_COUNT + 1);
    const rowStart = new Int32Array(STATIC_SEGMENT_COUNT * (ROW_COUNT + 1));
    let count = 0;
    for (let seg = 0; seg < STATIC_SEGMENT_COUNT; seg++) {
      segmentStart[seg] = count;
      const rows = this.#rows[seg] as Float32Array[];
      for (let s = 0; s < ROW_COUNT; s++) {
        rowStart[seg * (ROW_COUNT + 1) + s] = count;
        count += (rows[s] as Float32Array).length / FLOATS_PER_INSTANCE;
      }
      rowStart[seg * (ROW_COUNT + 1) + ROW_COUNT] = count;
    }
    segmentStart[STATIC_SEGMENT_COUNT] = count;
    const data = new Float32Array(count * FLOATS_PER_INSTANCE);
    let at = 0;
    for (const rows of this.#rows) {
      for (const row of rows) {
        data.set(row, at);
        at += row.length;
      }
    }
    this.#assembled = { data, count, segmentStart, rowStart };
    return this.#assembled;
  }

  #buildRow(s: number): void {
    for (const b of this.#scratch) b.clear();
    for (let x = Math.max(0, s - (WORLD_ROWS - 1)); x <= Math.min(WORLD_COLS - 1, s); x++) this.#emitTile(x, s - x);
    for (let seg = 0; seg < STATIC_SEGMENT_COUNT; seg++) {
      const b = this.#scratch[seg] as InstanceBuffer;
      (this.#rows[seg] as Float32Array[])[s] = b.count === 0 ? EMPTY_ROW : b.data.slice(0, b.count * FLOATS_PER_INSTANCE);
    }
  }

  #out(seg: StaticSegment): InstanceBuffer {
    return this.#scratch[seg] as InstanceBuffer;
  }

  #emitTile(x: number, y: number): void {
    const g = y * WORLD_COLS + x;
    const w = this.#world;
    const wy = worldY(x, y, w.topY);
    const origin = worldOrigin(x, y);
    const height = w.level.heights[g] ?? 0;
    const at = { g, wy, ox: origin.x, oy: origin.y, height };
    const land = levelTilesAt(w.level.layers.land, g);
    for (let i = w.prepared.landStart[g] ?? -1; i >= 0; i--) this.#emitLand(at, land[i] ?? 0);
    levelTilesAt(w.level.layers.objects, g).forEach((t) => {
      this.#emitObject(at, t);
    });
    for (const t of levelTilesAt(w.prepared.shadows, g)) this.#emitShadow(at, t);
    levelTilesAt(w.level.layers.structs, g).forEach((t, i) => {
      this.#emitStruct(at, t, i);
    });
    levelTilesAt(w.level.layers.roofs, g).forEach((t, i) => {
      this.#emitRoof(at, t, i);
    });
    levelTilesAt(w.level.layers.onRoof, g).forEach((t, i) => {
      this.#emitOnRoof(at, t, i);
    });
    for (const wire of this.#state.reveal.wireframes(g)) {
      if (wire.optional && !this.#state.wireframes) continue;
      this.#emitFlat(at, wire.tile, StaticSegment.TOPMOST, TOPMOST_Z_LEVEL, ShadeKey.NATURAL, 0);
    }
  }

  #drawable(tile: number): { te: TileElement; sprite: TileSprite } | null {
    const te = this.#world.tiles[tile];
    if (!te?.surfacePath || isDynamic(te)) return null;
    const sprite = this.#world.sprite(tile);
    return sprite && sprite.width > 0 && sprite.height > 0 ? { te, sprite } : null;
  }

  #position(at: TileAt, te: TileElement, sprite: TileSprite, roofLift: number): { x: number; y: number } {
    const lift = heightAdjusted(at.height, (te.flags & TileFlags.IGNORE_WORLD_HEIGHT) !== 0);
    return { x: at.ox + sprite.offsetX, y: at.oy - lift - roofLift + sprite.offsetY };
  }

  #emitFlat(at: TileAt, tile: number, seg: StaticSegment, z: number, shadeKey: number, roofLift: number): void {
    const d = this.#drawable(tile);
    if (!d) return;
    const p = this.#position(at, d.te, d.sprite, roofLift);
    this.#out(seg).push(p.x, p.y, d.sprite, 0, d.sprite.width, d.sprite.paletteBase, z, shadeKey, NO_INSTANCE_FLAGS, NO_OUTLINE);
  }

  #emitLand(at: TileAt, tile: number): void {
    this.#emitFlat(at, tile, StaticSegment.LAND, 0, at.g, 0);
  }

  #emitObject(at: TileAt, tile: number): void {
    const te = this.#world.tiles[tile];
    if (!te) return;
    const z = te.flags & TileFlags.CLIFFHANG ? 0 : te.flags & TileFlags.OBJECTLAYER_USEZHEIGHT ? objectZ(at.wy) : OBJECT_Z_LEVEL;
    this.#emitFlat(at, tile, StaticSegment.OBJECTS, z, at.g, 0);
  }

  #emitShadow(at: TileAt, tile: number): void {
    this.#emitFlat(at, tile, StaticSegment.SHADOWS, shadowZ(at.wy), ShadeKey.FIXED, 0);
  }

  #nodeFlags(layer: LayerName, g: number, index: number): number {
    return this.#state.reveal.nodeFlags(layer, g, index);
  }

  #hidden(flags: number, te: TileElement): boolean {
    return (flags & NodeFlags.HIDDEN) !== 0 && !((te.flags & TileFlags.ROOF) !== 0 && this.#state.roofLevel);
  }

  #emitStruct(at: TileAt, mapTile: number, index: number): void {
    const w = this.#world;
    let tile = substituteOpenDoor(w.tiles, this.#state.openDoors, at.g, mapTile);
    if (!this.#state.treeTops && (w.tiles[tile]?.flags ?? 0) & TileFlags.FULL3D) tile += TREE_TOP_SKIP;
    const d = this.#drawable(tile);
    if (!d) return;
    const flags = this.#nodeFlags('structs', at.g, index);
    if (this.#hidden(flags, d.te)) return;
    const p = this.#position(at, d.te, d.sprite, 0);
    const z = structZ(at.wy);
    const showThrough = (flags & NodeFlags.SHOW_THROUGH) !== 0;
    if (d.te.flags & TileFlags.MULTI_Z && d.te.zStrip) {
      this.#emitStrips(p, d.te, d.sprite, z, at.g, showThrough);
      return;
    }
    if (showThrough) {
      this.#emitObscured(p, d.sprite, wrap16(z), at.g);
      return;
    }
    this.#out(StaticSegment.STRUCTS).push(p.x, p.y, d.sprite, 0, d.sprite.width, d.sprite.paletteBase, wrap16(z), at.g, 0, 0);
  }

  #emitObscured(p: { x: number; y: number }, sprite: TileSprite, z: number, shadeKey: number): void {
    this.#out(StaticSegment.OBSCURED_DITHER).push(
      p.x,
      p.y,
      sprite,
      0,
      sprite.width,
      sprite.paletteBase,
      z,
      shadeKey,
      InstanceFlags.DITHER,
      0,
    );
    this.#out(StaticSegment.OBSCURED).push(p.x, p.y, sprite, 0, sprite.width, sprite.paletteBase, z, shadeKey, 0, 0);
  }

  #emitStrips(
    p: { x: number; y: number },
    te: TileElement,
    sprite: TileSprite,
    base: number,
    shadeKey: number,
    showThrough: boolean,
  ): void {
    const strip = te.zStrip;
    if (!strip) return;
    const wall = (te.flags & TileFlags.WALL) !== 0;
    let z = base + Z_STRIP_DELTA * strip.initialZChange;
    let srcX = 0;
    let width = Math.min(strip.firstStripWidth, sprite.width);
    let k = 0;
    while (srcX < sprite.width) {
      const z16 = wrap16(z);
      if (showThrough) {
        this.#out(StaticSegment.OBSCURED_STRIP_DITHER).push(
          p.x,
          p.y,
          sprite,
          srcX,
          width,
          sprite.paletteBase,
          z16,
          shadeKey,
          InstanceFlags.DITHER,
          0,
        );
        this.#out(StaticSegment.OBSCURED).push(p.x, p.y, sprite, srcX, width, sprite.paletteBase, z16, shadeKey, 0, 0);
      } else {
        const seg = wall ? StaticSegment.STRUCTS : StaticSegment.STRICT_STRIPS;
        this.#out(seg).push(p.x, p.y, sprite, srcX, width, sprite.paletteBase, z16, shadeKey, 0, 0);
      }
      srcX += width;
      width = Math.min(HALF_TILE_X, sprite.width - srcX);
      z += Z_STRIP_DELTA * (strip.zChanges[k++] ?? 0);
    }
  }

  #emitRoof(at: TileAt, tile: number, index: number): void {
    const d = this.#drawable(tile);
    if (!d) return;
    if (this.#hidden(this.#nodeFlags('roofs', at.g, index), d.te)) return;
    const p = this.#position(at, d.te, d.sprite, WALL_HEIGHT);
    this.#out(StaticSegment.ROOFS).push(
      p.x,
      p.y,
      d.sprite,
      0,
      d.sprite.width,
      d.sprite.paletteBase,
      roofZ(at.wy),
      ShadeKey.ROOF_BASE + at.g,
      0,
      0,
    );
  }

  #emitOnRoof(at: TileAt, tile: number, index: number): void {
    const d = this.#drawable(tile);
    if (!d) return;
    const flags = this.#nodeFlags('onRoof', at.g, index);
    if (this.#hidden(flags, d.te)) return;
    const p = this.#position(at, d.te, d.sprite, WALL_HEIGHT);
    const z = onRoofZ(at.wy);
    const shadeKey = ShadeKey.ROOF_BASE + at.g;
    if (flags & NodeFlags.SHOW_THROUGH) {
      this.#emitObscured(p, d.sprite, z, shadeKey);
      return;
    }
    this.#out(StaticSegment.ON_ROOF).push(p.x, p.y, d.sprite, 0, d.sprite.width, d.sprite.paletteBase, z, shadeKey, 0, 0);
  }
}

interface TileAt {
  readonly g: number;
  readonly wy: number;
  readonly ox: number;
  readonly oy: number;
  readonly height: number;
}

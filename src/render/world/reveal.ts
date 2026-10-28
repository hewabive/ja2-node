// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Render_Fun.cc SetGridNoRevealedFlag, RemoveRoomRoof; src/game/TileEngine/WorldMan.cc
// @src SetStructAframeFlags, FindLevelNodeBasedOnStructure, SetRoofIndexFlagsFromTypeRange;
// @src src/game/TileEngine/WorldDef.cc CalculateWorldWireFrameTiles, AddWireFrame, GetWireframeGraphicNumToUseForWall,
// @src IsRoofVisibleForWireframe, IsHiddenTileMarkerThere.

import type { LayerName } from '../../content/formats/map.ts';
import { DIRECTION_INCREMENT, Direction, newGridNo, WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { type Level, levelTilesAt } from '../../content/world/level.ts';
import {
  has,
  ORIENT_LEFT,
  STRUCTURE_ON_GROUND,
  STRUCTURE_ON_ROOF,
  StructureFlags,
  type StructureInstance,
  type WorldStructures,
} from '../../content/world/structures.ts';
import { type TileElement, TileFlags } from '../../content/world/tile-database.ts';
import { type TileTables, tileIndex, typeIndex } from '../../content/world/tile-tables.ts';

export const NodeFlags = { HIDDEN: 1, SHOW_THROUGH: 2 } as const;

export interface WireframeNode {
  readonly tile: number;
  readonly optional: boolean;
}

export interface RevealState {
  readonly revealed: Uint8Array;
  readonly touched: ReadonlySet<number>;
  nodeFlags(layer: LayerName, g: number, index: number): number;
  wireframes(g: number): readonly WireframeNode[];
}

export interface RevealWorld {
  readonly level: Level;
  readonly tiles: readonly TileElement[];
  readonly tables: TileTables;
  readonly structures: WorldStructures;
  readonly basement: boolean;
}

const MAX_NODES_PER_TILE = 64;
const NO_WIREFRAMES: readonly WireframeNode[] = [];
const BROKEN_WALL_WIREFRAMES: Readonly<Record<number, number>> = { 48: 12, 52: 12, 49: 13, 53: 13, 50: 10, 54: 10, 51: 11, 55: 11 };
const NODE_LAYERS: readonly LayerName[] = ['structs', 'roofs', 'objects', 'onRoof'];

function nodeKey(g: number, index: number): number {
  return g * MAX_NODES_PER_TILE + index;
}

class RevealBuilder {
  readonly revealed = new Uint8Array(WORLD_MAX);
  readonly flags = new Map<LayerName, Map<number, number>>(NODE_LAYERS.map((l) => [l, new Map()]));
  readonly wires = new Map<number, WireframeNode[]>();
  readonly #w: RevealWorld;
  readonly #firstRoof: number;
  readonly #fourthRoof: number;
  readonly #wireframeBase: number;

  constructor(w: RevealWorld) {
    this.#w = w;
    this.#firstRoof = typeIndex(w.tables, 'FIRSTROOF');
    this.#fourthRoof = typeIndex(w.tables, 'FOURTHROOF');
    this.#wireframeBase = tileIndex(w.tables, 'WIREFRAMES1') - 1;
  }

  #mark(layer: LayerName, g: number, index: number, flag: number): void {
    const m = this.flags.get(layer) as Map<number, number>;
    const key = nodeKey(g, index);
    m.set(key, (m.get(key) ?? 0) | flag);
  }

  #hideAframes(g: number): void {
    levelTilesAt(this.#w.level.layers.roofs, g).forEach((t, i) => {
      if ((this.#w.tiles[t]?.flags ?? 0) & TileFlags.AFRAME) this.#mark('roofs', g, i, NodeFlags.HIDDEN);
    });
  }

  #baseNode(s: StructureInstance): { layer: LayerName; index: number } | null {
    const layers: readonly LayerName[] = s.cubeOffset === STRUCTURE_ON_ROOF ? ['roofs', 'objects', 'onRoof'] : ['structs', 'objects'];
    for (const layer of layers) {
      const list = levelTilesAt(this.#w.level.layers[layer], s.baseGridNo);
      for (let i = 0; i < list.length; i++) if (this.#w.tiles[list[i] ?? 0]?.structure === s.def) return { layer, index: i };
    }
    return null;
  }

  revealTile(g: number): void {
    const w = this.#w;
    levelTilesAt(w.level.layers.roofs, g).forEach((t, i) => {
      const type = w.tiles[t]?.type ?? -1;
      if (type >= this.#firstRoof && type <= this.#fourthRoof) this.#mark('roofs', g, i, NodeFlags.HIDDEN);
    });
    if ((w.level.rooms[g] ?? 0) !== 0) {
      this.#hideAframes(g);
      if (g + WORLD_COLS < WORLD_MAX) this.#hideAframes(g + WORLD_COLS);
      if (g + 1 < WORLD_MAX) this.#hideAframes(g + 1);
    }
    this.revealed[g] = 1;
    for (const s of w.structures.at(g)) {
      const slanted = has(s.flags, StructureFlags.SLANTED_ROOF);
      if (!slanted) {
        if (s.cubeOffset !== STRUCTURE_ON_GROUND) continue;
        if (!has(s.flags, StructureFlags.OBSTACLE) || has(s.flags, StructureFlags.PERSON | StructureFlags.CORPSE)) continue;
      }
      const node = this.#baseNode(s);
      if (!node) continue;
      this.#mark(node.layer, s.baseGridNo, node.index, NodeFlags.SHOW_THROUGH | (slanted ? NodeFlags.HIDDEN : 0));
    }
  }

  #roofVisible(g: number): boolean {
    return this.#w.basement || this.#w.structures.find(g, StructureFlags.ROOF) !== null;
  }

  #addWire(g: number, wireframe: number, forced: boolean): void {
    const tile = this.#wireframeBase + wireframe;
    const list = this.wires.get(g) ?? [];
    if (list.some((n) => n.tile === tile)) return;
    list.push({ tile, optional: forced });
    this.wires.set(g, list);
  }

  #wallWireframe(g: number, s: StructureInstance): number {
    const w = this.#w;
    const base = w.structures.at(s.baseGridNo).find((b) => b.def === s.def && has(b.flags, StructureFlags.BASE_TILE));
    if (base) {
      for (const t of levelTilesAt(w.level.layers.structs, g)) {
        const te = w.tiles[t];
        if (te?.structure !== base.def || base.baseGridNo !== g) continue;
        const subIndex = t - (w.tables.types[te.type]?.start ?? 0) + 1;
        const broken = BROKEN_WALL_WIREFRAMES[subIndex];
        if (broken !== undefined) return broken;
        break;
      }
    }
    return s.wallOrientation & ORIENT_LEFT ? 6 : 5;
  }

  #neighbour(g: number, direction: number): number {
    return newGridNo(g, DIRECTION_INCREMENT[direction] ?? 0);
  }

  #openingWire(g: number, s: StructureInstance, left: number, right: number): void {
    const n = this.#neighbour(g, s.wallOrientation & ORIENT_LEFT ? Direction.SOUTH : Direction.EAST);
    if (this.#roofVisible(n) && !this.revealed[n]) this.#addWire(g, s.wallOrientation & ORIENT_LEFT ? left : right, false);
  }

  #wallWires(g: number, s: StructureInstance, wallsOnTile: { count: number }): void {
    const wire = this.#wallWireframe(g, s);
    if (s.wallOrientation & ORIENT_LEFT) {
      const n = this.#neighbour(g, Direction.SOUTH);
      if (this.#roofVisible(n)) {
        wallsOnTile.count++;
        this.#addWire(g, wire, this.revealed[n] === 1);
        const corner = this.#neighbour(this.#neighbour(g, Direction.WEST), Direction.SOUTH);
        if (!this.#roofVisible(corner)) this.#addWire(g, 9, this.revealed[corner] === 1);
      }
    } else {
      const n = this.#neighbour(g, Direction.EAST);
      if (this.#roofVisible(n)) {
        wallsOnTile.count++;
        this.#addWire(g, wire, this.revealed[n] === 1);
        const corner = this.#neighbour(this.#neighbour(g, Direction.NORTH), Direction.EAST);
        if (!this.#roofVisible(corner)) this.#addWire(g, 8, this.revealed[corner] === 1);
      }
    }
    if (wallsOnTile.count === 2) {
      const corner = this.#neighbour(this.#neighbour(g, Direction.EAST), Direction.SOUTH);
      this.#addWire(g, 7, this.revealed[corner] === 1);
    }
  }

  wireframesAt(g: number): void {
    if (this.#roofVisible(g) && !this.revealed[g]) return;
    const wallsOnTile = { count: 0 };
    for (const s of this.#w.structures.at(g)) {
      if (has(s.flags, StructureFlags.ANYDOOR)) {
        if (has(s.flags, StructureFlags.OPENABLE)) this.#openingWire(g, s, 4, 3);
        continue;
      }
      if (has(s.flags, StructureFlags.WALLNWINDOW)) this.#openingWire(g, s, 2, 1);
      if (has(s.flags, StructureFlags.WALLSTUFF)) this.#wallWires(g, s, wallsOnTile);
    }
  }
}

export function computeReveal(w: RevealWorld, revealedRooms: ReadonlySet<number>): RevealState {
  const b = new RevealBuilder(w);
  if (revealedRooms.size > 0) {
    for (let g = 0; g < WORLD_MAX; g++) {
      const room = w.level.rooms[g] ?? 0;
      if (room !== 0 && revealedRooms.has(room)) b.revealTile(g);
    }
  }
  for (let g = 0; g < WORLD_MAX; g++) b.wireframesAt(g);
  const touched = new Set<number>(b.wires.keys());
  for (const m of b.flags.values()) for (const key of m.keys()) touched.add(Math.floor(key / MAX_NODES_PER_TILE));
  return {
    revealed: b.revealed,
    touched,
    nodeFlags: (layer, g, index) => b.flags.get(layer)?.get(nodeKey(g, index)) ?? 0,
    wireframes: (g) => b.wires.get(g) ?? NO_WIREFRAMES,
  };
}

export const NO_REVEAL: RevealState = {
  revealed: new Uint8Array(WORLD_MAX),
  touched: new Set(),
  nodeFlags: () => 0,
  wireframes: () => NO_WIREFRAMES,
};

function tileSignature(r: RevealState, level: Level, g: number): string {
  const parts: string[] = [];
  for (const layer of NODE_LAYERS) {
    const count = levelTilesAt(level.layers[layer], g).length;
    for (let i = 0; i < count; i++) {
      const f = r.nodeFlags(layer, g, i);
      if (f !== 0) parts.push(`${layer}${i}:${f}`);
    }
  }
  for (const w of r.wireframes(g)) parts.push(`w${w.tile}${w.optional ? 'o' : ''}`);
  return parts.join(',');
}

export function changedRevealTiles(a: RevealState, b: RevealState, level: Level): number[] {
  const changed: number[] = [];
  for (const g of new Set([...a.touched, ...b.touched])) if (tileSignature(a, level, g) !== tileSignature(b, level, g)) changed.push(g);
  return changed;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Render_Fun.cc SetGridNoRevealedFlag, RemoveRoomRoof, ExamineGridNoForSlantRoofExtraGraphic (the
// @src ceiling's graphic, AddRoofToHead); TileEngine/SaveLoadMap.cc SetMapRevealedStatus (every tile revealed at the
// @src last load, 2026-11-09); src/game/TileEngine/WorldMan.cc
// @src SetStructAframeFlags, FindLevelNodeBasedOnStructure, SetRoofIndexFlagsFromTypeRange;
// @src src/game/TileEngine/WorldDef.cc CalculateWorldWireFrameTiles, AddWireFrame, GetWireframeGraphicNumToUseForWall,
// @src IsRoofVisibleForWireframe, IsHiddenTileMarkerThere; InitLoadedWorld (every wire frame against the tiles revealed at
// @src the load), CalculateWorldWireFrameTiles(FALSE) on the tiles SetRecalculateWireFrameFlagRadius flags (Render_Fun.cc,
// @src radius 2 around the tiles of a room RemoveRoomRoof reveals; Explosion_Control.cc SpreadEffect around what a blast
// @src changed), against every MAPELEMENT_REVEALED tile, the others kept (2026-11-09).

import type { LayerName } from '../../content/formats/map.ts';
import { DIRECTION_INCREMENT, Direction, newGridNo, WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../../content/world/grid.ts';
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
import { addedTileRuns, sameTileRuns, type TileRun } from '../../protocol/view.ts';

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
  ceilings(g: number): readonly number[];
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
const NO_CEILINGS: readonly number[] = [];
const NO_CEILING_TILES: ReadonlySet<number> = new Set();
export const NO_TILE_RUNS: readonly TileRun[] = [];
const BROKEN_WALL_WIREFRAMES: Readonly<Record<number, number>> = { 48: 12, 52: 12, 49: 13, 53: 13, 50: 10, 54: 10, 51: 11, 55: 11 };
const NODE_LAYERS: readonly LayerName[] = ['structs', 'roofs', 'objects', 'onRoof'];
const SLANT_ROOF_CEILING = 'SLANTROOFCEILING1';

function nodeKey(g: number, index: number): number {
  return g * MAX_NODES_PER_TILE + index;
}

class RevealBuilder {
  readonly revealed = new Uint8Array(WORLD_MAX);
  readonly flags = new Map<LayerName, Map<number, number>>(NODE_LAYERS.map((l) => [l, new Map()]));
  readonly #w: RevealWorld;
  readonly #firstRoof: number;
  readonly #fourthRoof: number;

  constructor(w: RevealWorld) {
    this.#w = w;
    this.#firstRoof = typeIndex(w.tables, 'FIRSTROOF');
    this.#fourthRoof = typeIndex(w.tables, 'FOURTHROOF');
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

  #baseNode(s: StructureInstance): { gridNo: number; layer: LayerName; index: number } | null {
    const base = this.#w.structures.findBase(s);
    if (!base) return null;
    const layers: readonly LayerName[] = base.cubeOffset === STRUCTURE_ON_ROOF ? ['roofs', 'objects', 'onRoof'] : ['structs', 'objects'];
    for (const layer of layers) {
      const list = levelTilesAt(this.#w.level.layers[layer], base.gridNo);
      for (let i = 0; i < list.length; i++) {
        if (this.#w.tiles[list[i] ?? 0]?.structure === base.def) return { gridNo: base.gridNo, layer, index: i };
      }
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
      this.#mark(node.layer, node.gridNo, node.index, NodeFlags.SHOW_THROUGH | (slanted ? NodeFlags.HIDDEN : 0));
    }
  }
}

class WireframeBuilder {
  readonly wires: Map<number, readonly WireframeNode[]>;
  readonly #w: RevealWorld;
  readonly #revealed: Uint8Array;
  readonly #wireframeBase: number;

  constructor(w: RevealWorld, revealed: Uint8Array, wires: ReadonlyMap<number, readonly WireframeNode[]>) {
    this.#w = w;
    this.#revealed = revealed;
    this.wires = new Map(wires);
    this.#wireframeBase = tileIndex(w.tables, 'WIREFRAMES1') - 1;
  }

  #roofVisible(g: number): boolean {
    return this.#w.basement || this.#w.structures.find(g, StructureFlags.ROOF) !== null;
  }

  #addWire(g: number, wireframe: number, optional: boolean): void {
    const tile = this.#wireframeBase + wireframe;
    const list = this.wires.get(g) ?? [];
    if (list.some((n) => n.tile === tile)) return;
    this.wires.set(g, [...list, { tile, optional }]);
  }

  #wallWireframe(g: number, s: StructureInstance): number {
    const w = this.#w;
    const base = w.structures.findBase(s);
    if (base) {
      for (const t of levelTilesAt(w.level.layers.structs, g)) {
        const te = w.tiles[t];
        if (te?.structure !== base.def || base.gridNo !== g) continue;
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
    if (this.#roofVisible(n) && !this.#revealed[n]) this.#addWire(g, s.wallOrientation & ORIENT_LEFT ? left : right, false);
  }

  #wallWires(g: number, s: StructureInstance, wallsOnTile: { count: number }): void {
    const wire = this.#wallWireframe(g, s);
    if (s.wallOrientation & ORIENT_LEFT) {
      const n = this.#neighbour(g, Direction.SOUTH);
      if (this.#roofVisible(n)) {
        wallsOnTile.count++;
        this.#addWire(g, wire, this.#revealed[n] === 1);
        const corner = this.#neighbour(this.#neighbour(g, Direction.WEST), Direction.SOUTH);
        if (!this.#roofVisible(corner)) this.#addWire(g, 9, this.#revealed[corner] === 1);
      }
    } else {
      const n = this.#neighbour(g, Direction.EAST);
      if (this.#roofVisible(n)) {
        wallsOnTile.count++;
        this.#addWire(g, wire, this.#revealed[n] === 1);
        const corner = this.#neighbour(this.#neighbour(g, Direction.NORTH), Direction.EAST);
        if (!this.#roofVisible(corner)) this.#addWire(g, 8, this.#revealed[corner] === 1);
      }
    }
    if (wallsOnTile.count === 2) {
      const corner = this.#neighbour(this.#neighbour(g, Direction.EAST), Direction.SOUTH);
      this.#addWire(g, 7, this.#revealed[corner] === 1);
    }
  }

  workOut(g: number): void {
    this.wires.delete(g);
    if (this.#roofVisible(g) && !this.#revealed[g]) return;
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

export class WallWireframes {
  readonly revealed: Uint8Array;
  readonly #wires: ReadonlyMap<number, readonly WireframeNode[]>;

  constructor(revealed: Uint8Array, wires: ReadonlyMap<number, readonly WireframeNode[]>) {
    this.revealed = revealed;
    this.#wires = wires;
  }

  static workedOut(w: RevealWorld, revealed: Uint8Array): WallWireframes {
    return new WallWireframes(revealed, new Map()).workedOutAgain(w, revealed, null);
  }

  get tiles(): Iterable<number> {
    return this.#wires.keys();
  }

  at(g: number): readonly WireframeNode[] {
    return this.#wires.get(g) ?? NO_WIREFRAMES;
  }

  workedOutAgain(w: RevealWorld, revealed: Uint8Array, area: ReadonlySet<number> | null): WallWireframes {
    const b = new WireframeBuilder(w, revealed, this.#wires);
    if (area) for (const g of area) b.workOut(g);
    else for (let g = 0; g < WORLD_MAX; g++) b.workOut(g);
    return new WallWireframes(revealed, b.wires);
  }

  withRevealed(revealed: Uint8Array): WallWireframes {
    return new WallWireframes(revealed, this.#wires);
  }

  sameWiresAs(other: WallWireframes): boolean {
    return this.#wires === other.#wires;
  }
}

export interface RevealInputs {
  readonly revealedRooms: ReadonlySet<number>;
  readonly revealedAtLoad: readonly TileRun[];
  readonly revealedTiles: readonly TileRun[];
}

export interface WireframeHistory {
  readonly inputs: RevealInputs;
  readonly wireframes: WallWireframes;
}

const ROOM_REVEAL_RECALCULATION_RADIUS = 2;

function markRuns(revealed: Uint8Array, runs: readonly TileRun[]): void {
  for (const [first, count] of runs) revealed.fill(1, Math.max(0, first), Math.min(WORLD_MAX, first + count));
}

function tilesOfRooms(w: RevealWorld, rooms: ReadonlySet<number>): number[] {
  if (rooms.size === 0) return [];
  const tiles: number[] = [];
  for (let g = 0; g < WORLD_MAX; g++) if (rooms.has(w.level.rooms[g] ?? 0)) tiles.push(g);
  return tiles;
}

function revealedTileSet(w: RevealWorld, inputs: RevealInputs): Uint8Array {
  const revealed = new Uint8Array(WORLD_MAX);
  markRuns(revealed, inputs.revealedTiles);
  markRuns(revealed, inputs.revealedAtLoad);
  for (const g of tilesOfRooms(w, inputs.revealedRooms)) revealed[g] = 1;
  return revealed;
}

export function recalculationArea(tiles: Iterable<number>, radius: number): Set<number> {
  const area = new Set<number>();
  for (const g of tiles) {
    const row = Math.floor(g / WORLD_COLS);
    const col = g % WORLD_COLS;
    for (let y = row - radius; y < row + radius + 2; y++) {
      if (y < 0 || y >= WORLD_ROWS) continue;
      for (let x = col - radius; x < col + radius + 2; x++) if (x >= 0 && x < WORLD_COLS) area.add(y * WORLD_COLS + x);
    }
  }
  return area;
}

function roomsAdded(before: ReadonlySet<number>, after: ReadonlySet<number>): Set<number> {
  return new Set([...after].filter((room) => !before.has(room)));
}

function startsAfresh(before: RevealInputs, after: RevealInputs): boolean {
  if (!sameTileRuns(before.revealedAtLoad, after.revealedAtLoad)) return true;
  if ([...before.revealedRooms].some((room) => !after.revealedRooms.has(room))) return true;
  return addedTileRuns(before.revealedTiles, after.revealedTiles) === null;
}

function roomsRevealedSinceTheLoad(w: RevealWorld, inputs: RevealInputs): Set<number> {
  const atLoad = new Uint8Array(WORLD_MAX);
  markRuns(atLoad, inputs.revealedAtLoad);
  const later = new Set<number>();
  for (let g = 0; g < WORLD_MAX; g++) {
    const room = w.level.rooms[g] ?? 0;
    if (room !== 0 && inputs.revealedRooms.has(room) && !atLoad[g]) later.add(room);
  }
  return later;
}

function wireframesAfterLoad(w: RevealWorld, inputs: RevealInputs, revealed: Uint8Array): WallWireframes {
  const atLoad = new Uint8Array(WORLD_MAX);
  markRuns(atLoad, inputs.revealedAtLoad);
  const loaded = WallWireframes.workedOut(w, atLoad);
  const area = recalculationArea(tilesOfRooms(w, roomsRevealedSinceTheLoad(w, inputs)), ROOM_REVEAL_RECALCULATION_RADIUS);
  return area.size > 0 ? loaded.workedOutAgain(w, revealed, area) : loaded.withRevealed(revealed);
}

export function followWireframes(
  w: RevealWorld,
  history: WireframeHistory | null,
  inputs: RevealInputs,
  changedTiles: readonly number[] = [],
): WallWireframes {
  const revealed = revealedTileSet(w, inputs);
  if (!history || startsAfresh(history.inputs, inputs)) return wireframesAfterLoad(w, inputs, revealed);
  const rooms = roomsAdded(history.inputs.revealedRooms, inputs.revealedRooms);
  const area = recalculationArea([...tilesOfRooms(w, rooms), ...changedTiles], ROOM_REVEAL_RECALCULATION_RADIUS);
  return area.size > 0 ? history.wireframes.workedOutAgain(w, revealed, area) : history.wireframes.withRevealed(revealed);
}

export function computeReveal(
  w: RevealWorld,
  revealedRooms: ReadonlySet<number>,
  slantRoofCeilings: ReadonlySet<number> = NO_CEILING_TILES,
  revealedAtLoad: readonly TileRun[] = NO_TILE_RUNS,
  wireframes: WallWireframes | null = null,
): RevealState {
  const b = new RevealBuilder(w);
  for (const [first, count] of revealedAtLoad) for (let g = first; g < first + count && g < WORLD_MAX; g++) b.revealTile(g);
  for (const g of tilesOfRooms(w, revealedRooms)) b.revealTile(g);
  const wires = wireframes ?? WallWireframes.workedOut(w, b.revealed);
  const touched = new Set<number>([...wires.tiles, ...slantRoofCeilings]);
  for (const m of b.flags.values()) for (const key of m.keys()) touched.add(Math.floor(key / MAX_NODES_PER_TILE));
  const ceiling = [tileIndex(w.tables, SLANT_ROOF_CEILING)];
  return {
    revealed: wires.revealed,
    touched,
    nodeFlags: (layer, g, index) => b.flags.get(layer)?.get(nodeKey(g, index)) ?? 0,
    wireframes: (g) => wires.at(g),
    ceilings: (g) => (slantRoofCeilings.has(g) ? ceiling : NO_CEILINGS),
  };
}

export const NO_REVEAL: RevealState = {
  revealed: new Uint8Array(WORLD_MAX),
  touched: new Set(),
  nodeFlags: () => 0,
  wireframes: () => NO_WIREFRAMES,
  ceilings: () => NO_CEILINGS,
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
  for (const c of r.ceilings(g)) parts.push(`c${c}`);
  return parts.join(',');
}

export function changedRevealTiles(a: RevealState, b: RevealState, level: Level): number[] {
  const changed: number[] = [];
  for (const g of new Set([...a.touched, ...b.touched])) if (tileSignature(a, level, g) !== tileSignature(b, level, g)) changed.push(g);
  return changed;
}

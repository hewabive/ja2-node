// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Structure.cc CreateStructureFromDB, OkayToAddStructureToTile, InternalOkayToAddStructureToWorld,
// @src AddStructureToWorld, AddStructureToTile, FindStructure, FindStructureByID, StructureHeight; Structure_Internals.h

import { u32 } from '../../core/int.ts';
import { Orientation, type StructureDef, type StructureFile, type StructureTile } from '../formats/jsd.ts';
import { Direction, directionIncrement, newGridNo, WORLD_MAX } from './grid.ts';

export const StructureFlags = {
  BASE_TILE: 0x00000001,
  OPEN: 0x00000002,
  OPENABLE: 0x00000004,
  GARAGEDOOR: 0x00000008,
  MOBILE: 0x00000010,
  PASSABLE: 0x00000020,
  EXPLOSIVE: 0x00000040,
  TRANSPARENT: 0x00000080,
  GENERIC: 0x00000100,
  TREE: 0x00000200,
  FENCE: 0x00000400,
  WIREFENCE: 0x00000800,
  HASITEMONTOP: 0x00001000,
  SPECIAL: 0x00002000,
  LIGHTSOURCE: 0x00004000,
  VEHICLE: 0x00008000,
  WALL: 0x00010000,
  WALLNWINDOW: 0x00020000,
  SLIDINGDOOR: 0x00040000,
  DOOR: 0x00080000,
  MULTI: 0x00100000,
  CAVEWALL: 0x00200000,
  DDOOR_LEFT: 0x00400000,
  DDOOR_RIGHT: 0x00800000,
  NORMAL_ROOF: 0x01000000,
  SLANTED_ROOF: 0x02000000,
  TALL_ROOF: 0x04000000,
  SWITCH: 0x08000000,
  ON_LEFT_WALL: 0x10000000,
  ON_RIGHT_WALL: 0x20000000,
  CORPSE: 0x40000000,
  PERSON: 0x80000000,
  ANYFENCE: 0x00000c00,
  ANYDOOR: 0x00cc0008,
  OBSTACLE: 0x00008f00,
  WALLSTUFF: 0x00cf0008,
  BLOCKSMOVES: 0x00208f00,
  ROOF: 0x07000000,
} as const;

export const StructureTileFlags = { ON_ROOF: 0x01, PASSABLE: 0x02 } as const;
export const ORIENT_LEFT = Orientation.INSIDE_LEFT | Orientation.OUTSIDE_LEFT;
export const ORIENT_RIGHT = Orientation.INSIDE_RIGHT | Orientation.OUTSIDE_RIGHT;

export const PROFILE_Z_SIZE = 4;
export const STRUCTURE_ON_GROUND = 0;
export const STRUCTURE_ON_ROOF = PROFILE_Z_SIZE;
export const TOTAL_SOLDIERS = 156;
export const INVALID_STRUCTURE_ID = TOTAL_SOLDIERS + 200;
export const IGNORE_PEOPLE_STRUCTURE_ID = INVALID_STRUCTURE_ID + 1;
const FIRST_AVAILABLE_STRUCTURE_ID = INVALID_STRUCTURE_ID + 2;
const MAX_STRUCTURE_ID = 0xffff;

export interface StructureInstance {
  id: number;
  readonly gridNo: number;
  readonly baseGridNo: number;
  readonly cubeOffset: number;
  flags: number;
  hitPoints: number;
  cachedHeight: number;
  readonly wallOrientation: number;
  readonly def: StructureDef;
  readonly tile: StructureTile;
  readonly file: StructureFile | null;
}

export type StructureOwner = { readonly kind: 'world' } | { readonly kind: 'soldier'; readonly id: number };

const WORLD_OWNER: StructureOwner = { kind: 'world' };

export function has(flags: number, mask: number): boolean {
  return u32(flags & mask) !== 0;
}

export function structureHeight(s: StructureInstance): number {
  if (s.cachedHeight !== 0) return s.cachedHeight;
  let greatest = -1;
  for (const column of s.tile.shape) {
    for (let z = PROFILE_Z_SIZE - 1; z > greatest; z--) {
      if (column & (1 << z)) {
        greatest = z;
        break;
      }
    }
  }
  s.cachedHeight = greatest + 1;
  return s.cachedHeight;
}

function instanceFlags(def: StructureDef, tile: StructureTile): number {
  let flags =
    has(def.flags, StructureFlags.SLIDINGDOOR) && def.tiles.length === 2
      ? u32((def.flags & ~StructureFlags.SLIDINGDOOR) | StructureFlags.GARAGEDOOR)
      : u32(def.flags & ~StructureFlags.GARAGEDOOR);
  if (tile.posRelToBase === 0) flags = u32(flags | StructureFlags.BASE_TILE);
  return flags;
}

export interface WorldStructuresSnapshot {
  readonly heights: Uint8Array;
  readonly lists: StructureInstance[][];
  readonly nextId: number;
}

export class WorldStructures {
  readonly lists: StructureInstance[][] = Array.from({ length: WORLD_MAX }, () => []);
  private nextId = FIRST_AVAILABLE_STRUCTURE_ID;
  private readonly heights: Uint8Array;

  constructor(heights: Uint8Array) {
    this.heights = heights;
  }

  static fromSnapshot(snapshot: WorldStructuresSnapshot): WorldStructures {
    if (snapshot.lists.length !== WORLD_MAX) throw new RangeError(`a structure snapshot needs ${WORLD_MAX} tile lists`);
    const world = new WorldStructures(snapshot.heights);
    snapshot.lists.forEach((list, g) => {
      world.lists[g] = list;
    });
    world.nextId = snapshot.nextId;
    return world;
  }

  toSnapshot(): WorldStructuresSnapshot {
    return { heights: this.heights, lists: this.lists, nextId: this.nextId };
  }

  at(g: number): readonly StructureInstance[] {
    return this.lists[g] ?? [];
  }

  find(g: number, mask: number): StructureInstance | null {
    for (const s of this.at(g)) if (has(s.flags, mask)) return s;
    return null;
  }

  findNext(s: StructureInstance, mask: number): StructureInstance | null {
    const list = this.at(s.gridNo);
    for (let i = list.indexOf(s) + 1; i < list.length; i++) {
      const next = list[i] as StructureInstance;
      if (has(next.flags, mask)) return next;
    }
    return null;
  }

  findById(g: number, id: number): StructureInstance | null {
    for (const s of this.at(g)) if (s.id === id) return s;
    return null;
  }

  findBase(s: StructureInstance): StructureInstance | null {
    if (has(s.flags, StructureFlags.BASE_TILE)) return s;
    return this.findById(s.baseGridNo, s.id);
  }

  private okayToAddToTile(
    base: number,
    cube: number,
    def: StructureDef,
    tileIndex: number,
    exclusionId: number,
    ignorePeople: boolean,
  ): boolean {
    const tile = def.tiles[tileIndex] as StructureTile;
    const g = base + tile.posRelToBase;
    if (g < 0 || g >= WORLD_MAX) return false;
    if (this.heights[base] !== this.heights[g]) return false;
    const excluded = (e: StructureInstance) =>
      (exclusionId !== INVALID_STRUCTURE_ID && exclusionId === e.id) || (ignorePeople && e.id < TOTAL_SOLDIERS);
    for (const e of this.at(g)) {
      if (cube !== e.cubeOffset) continue;
      if (has(def.flags, StructureFlags.MOBILE) && has(e.flags, StructureFlags.PASSABLE)) continue;
      if (has(def.flags, StructureFlags.OBSTACLE)) {
        if (excluded(e)) continue;
        if (has(e.flags, StructureFlags.OBSTACLE) && !has(def.flags, StructureFlags.MOBILE)) {
          if (!(has(e.flags, StructureFlags.PASSABLE) && !has(e.flags, StructureFlags.MOBILE))) return false;
        } else if (def.tiles.length > 1 && has(e.flags, StructureFlags.WALLSTUFF)) {
          if (!has(e.flags, StructureFlags.ANYDOOR) || !has(e.flags, StructureFlags.OPEN)) {
            for (let loop = 1; loop < 4; loop++) {
              const other = this.otherSideOfWall(g, e.wallOrientation, loop);
              if (def.tiles.some((t) => base + t.posRelToBase === other)) return false;
            }
          }
        }
      } else if (has(def.flags, StructureFlags.WALLSTUFF)) {
        if (has(e.flags, StructureFlags.WALLSTUFF) && e.wallOrientation === def.wallOrientation) return false;
        if (!has(e.flags, StructureFlags.CORPSE | StructureFlags.PERSON)) {
          for (let loop = 1; loop < 4; loop++) {
            const other = this.otherSideOfWall(g, def.wallOrientation, loop);
            const found = this.findById(other, e.id);
            if (found && !has(found.flags, StructureFlags.WALL)) return false;
          }
        }
      }
      if (has(def.flags, StructureFlags.MOBILE)) {
        if (excluded(e)) continue;
        const passableTile = (tile.flags & StructureTileFlags.PASSABLE) !== 0;
        if (has(e.flags, StructureFlags.MOBILE) && !has(e.flags, StructureFlags.PASSABLE) && !passableTile) return false;
        if (!has(e.flags, StructureFlags.MOBILE) && has(e.flags, StructureFlags.PASSABLE)) continue;
        if (has(e.flags, StructureFlags.OBSTACLE) && !passableTile) return false;
      }
      if (has(def.flags, StructureFlags.OPENABLE) && has(e.flags, StructureFlags.OPENABLE)) return false;
    }
    return true;
  }

  private otherSideOfWall(g: number, orientation: number, loop: number): number {
    if (orientation & ORIENT_LEFT) return newGridNo(g, directionIncrement(loop + 2));
    if (orientation & ORIENT_RIGHT) return newGridNo(g, directionIncrement(loop));
    return newGridNo(g, directionIncrement(Direction.SOUTHEAST));
  }

  okayToAdd(
    base: number,
    level: number,
    def: StructureDef,
    exclusionId = INVALID_STRUCTURE_ID,
    ignorePeople = exclusionId === IGNORE_PEOPLE_STRUCTURE_ID,
  ): boolean {
    if (def.tiles.length === 0) return false;
    for (let i = 0; i < def.tiles.length; i++) {
      const tile = def.tiles[i] as StructureTile;
      let cube: number;
      if (!(tile.flags & StructureTileFlags.ON_ROOF)) cube = level * PROFILE_Z_SIZE;
      else if (level === 0) cube = PROFILE_Z_SIZE;
      else return false;
      if (!this.okayToAddToTile(base, cube, def, i, exclusionId, ignorePeople)) return false;
    }
    return true;
  }

  add(
    base: number,
    level: number,
    def: StructureDef,
    owner: StructureOwner = WORLD_OWNER,
    file: StructureFile | null = null,
  ): StructureInstance | null {
    if (def.tiles.length === 0) return null;
    if (!this.okayToAdd(base, level, def)) return null;
    const created = def.tiles.map((tile): StructureInstance => {
      let flags = instanceFlags(def, tile);
      if (tile.flags & StructureTileFlags.PASSABLE) flags = u32(flags | StructureFlags.PASSABLE);
      if (owner.kind === 'soldier') flags = u32((flags | StructureFlags.PERSON) & ~StructureFlags.BLOCKSMOVES);
      else if (has(def.flags, StructureFlags.CORPSE)) {
        flags = u32(flags | StructureFlags.CORPSE);
        flags =
          def.tiles.length < 10
            ? u32((flags | StructureFlags.PASSABLE) & ~StructureFlags.BLOCKSMOVES)
            : u32(flags & ~StructureFlags.TRANSPARENT);
      }
      const isBase = has(flags, StructureFlags.BASE_TILE);
      return {
        id: 0,
        gridNo: base + tile.posRelToBase,
        baseGridNo: tile === def.tiles[0] ? 0 : base,
        cubeOffset: (tile.flags & StructureTileFlags.ON_ROOF ? level + 1 : level) * PROFILE_Z_SIZE,
        flags,
        hitPoints: isBase ? def.hitPoints : 0,
        cachedHeight: 0,
        wallOrientation:
          def.wallOrientation !== Orientation.NONE && (!has(flags, StructureFlags.WALL) || isBase) ? def.wallOrientation : Orientation.NONE,
        def,
        tile,
        file,
      };
    });
    const id = owner.kind === 'soldier' ? owner.id : this.allocateId();
    const baseHeight = this.heights[created[0]?.gridNo ?? 0];
    for (const s of created) {
      if (this.heights[s.gridNo] !== baseHeight) {
        for (const placed of created) this.removeInstance(placed);
        return null;
      }
      s.id = id;
      this.lists[s.gridNo]?.push(s);
    }
    return created[0] ?? null;
  }

  private allocateId(): number {
    this.nextId = (this.nextId + 1) & MAX_STRUCTURE_ID;
    if (this.nextId === 0) this.nextId = FIRST_AVAILABLE_STRUCTURE_ID;
    return this.nextId;
  }

  private removeInstance(s: StructureInstance): void {
    const list = this.lists[s.gridNo];
    if (!list) return;
    const i = list.indexOf(s);
    if (i >= 0) list.splice(i, 1);
  }

  remove(base: StructureInstance): void {
    for (const tile of base.def.tiles) {
      const g = (has(base.flags, StructureFlags.BASE_TILE) ? base.gridNo : base.baseGridNo) + tile.posRelToBase;
      const s = this.findById(g, base.id);
      if (s) this.removeInstance(s);
    }
  }
}

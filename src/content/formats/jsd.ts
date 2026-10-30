// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Structure.cc STRUCTURE_FILE_REF, CreateFileStructureArrays, NormalizeStructureTiles

import { i8, u8 } from '../../core/int.ts';
import { FormatError } from '../binary/errors.ts';
import { BinaryReader } from '../binary/reader.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { WORLD_COLS } from '../world/grid.ts';
import type { StiAppData } from './sti.ts';

const FILE_ID = 'J2SD';
const HEADER_BYTES = 16;
const CONTAINS_AUX_IMAGE_DATA = 0x01;
const CONTAINS_STRUCTURE_DATA = 0x02;
const STRUCTURE_BYTES = 16;
const STRUCTURE_TILE_BYTES = 32;
const PROFILE_CELLS = 25;
const PROFILE_Z_SIZE = 4;
const MAX_HIT_POINT_SCALE = 255;

export const Orientation = {
  NONE: 0x00,
  INSIDE_LEFT: 0x01,
  INSIDE_RIGHT: 0x02,
  OUTSIDE_LEFT: 0x04,
  OUTSIDE_RIGHT: 0x08,
} as const;

const CONTIGUOUS_ORIENTATION_TO_FLAG: Readonly<Record<number, number>> = { 3: Orientation.OUTSIDE_LEFT, 4: Orientation.OUTSIDE_RIGHT };

export interface StructureTile {
  readonly posRelToBase: number;
  readonly xRelToBase: number;
  readonly yRelToBase: number;
  readonly shape: Uint8Array;
  readonly flags: number;
  readonly vehicleHitLocation: number;
}

export interface StructureDef {
  readonly number: number;
  readonly armour: number;
  readonly hitPoints: number;
  readonly density: number;
  readonly flags: number;
  readonly wallOrientation: number;
  readonly destructionPartner: number;
  readonly partnerDelta: number;
  readonly zTileOffsetX: number;
  readonly zTileOffsetY: number;
  readonly tiles: readonly StructureTile[];
}

export interface TileLocation {
  readonly x: number;
  readonly y: number;
}

export interface StructureFile {
  readonly structureCount: number;
  readonly auxData: readonly StiAppData[] | null;
  readonly tileLocations: readonly TileLocation[];
  readonly structures: readonly (StructureDef | null)[];
}

function filledProfileCells(shape: Uint8Array): number {
  let filled = 0;
  for (const column of shape) {
    for (let z = 0; z < PROFILE_Z_SIZE; z++) if (column & (1 << z)) filled++;
  }
  return filled;
}

function readAux(r: BinaryReader): StiAppData {
  const wallOrientation = r.u8();
  const numberOfTiles = r.u8();
  const tileLocationIndex = r.u16();
  r.skip(3);
  const currentFrame = r.u8();
  const numberOfFrames = r.u8();
  const flags = r.u8();
  r.skip(6);
  return { wallOrientation, numberOfTiles, tileLocationIndex, currentFrame, numberOfFrames, flags };
}

function normalizedTiles(tiles: StructureTile[]): StructureTile[] {
  let closest = Number.POSITIVE_INFINITY;
  for (const t of tiles) if (Math.abs(t.posRelToBase) < Math.abs(closest)) closest = t.posRelToBase;
  if (closest === 0 || tiles.length === 0) return tiles;
  const dx = closest % WORLD_COLS;
  const dy = Math.trunc(closest / WORLD_COLS);
  return tiles.map((t) => ({ ...t, posRelToBase: t.posRelToBase - closest, xRelToBase: t.xRelToBase - dx, yRelToBase: t.yRelToBase - dy }));
}

export function parseStructureFile(bytes: Uint8Array): StructureFile {
  if (bytes.length < HEADER_BYTES) throw new FormatError('JSD header truncated');
  const r = new BinaryReader(bytes);
  const id = r.fixedString(4);
  const structureCount = r.u16();
  const structuresStored = r.u16();
  const dataSize = r.u16();
  const fileFlags = r.u8();
  r.skip(3);
  const tileLocationsStored = r.u16();
  if (id !== FILE_ID || structureCount === 0) throw new FormatError('not a JSD structure file');

  let auxData: StiAppData[] | null = null;
  const tileLocations: TileLocation[] = [];
  if (fileFlags & CONTAINS_AUX_IMAGE_DATA) {
    auxData = [];
    for (let i = 0; i < structureCount; i++) auxData.push(readAux(r));
    for (let i = 0; i < tileLocationsStored; i++) {
      const x = i8(r.u8());
      const y = i8(r.u8());
      tileLocations.push({ x, y });
    }
  }

  const structures: (StructureDef | null)[] = new Array(structureCount).fill(null);
  if (fileFlags & CONTAINS_STRUCTURE_DATA) {
    const data = new BinaryReader(r.bytesView(dataSize));
    for (let n = 0; n < structuresStored; n++) {
      if (data.remaining < STRUCTURE_BYTES) throw new FormatError('JSD structure data truncated');
      const armour = data.u8();
      data.u8();
      const density = data.u8();
      const numberOfTiles = data.u8();
      const flags = data.u32();
      const number = data.u16();
      const storedOrientation = data.u8();
      const destructionPartner = i8(data.u8());
      const partnerDelta = i8(data.u8());
      const zTileOffsetX = i8(data.u8());
      const zTileOffsetY = i8(data.u8());
      data.skip(1);
      const tiles: StructureTile[] = [];
      let filled = 0;
      for (let t = 0; t < numberOfTiles; t++) {
        if (data.remaining < STRUCTURE_TILE_BYTES) throw new FormatError('JSD structure tile data truncated');
        data.i16();
        const xRelToBase = i8(data.u8());
        const yRelToBase = i8(data.u8());
        const shape = data.bytesView(PROFILE_CELLS).slice();
        const tileFlags = data.u8();
        const vehicleHitLocation = data.u8();
        data.skip(1);
        filled += filledProfileCells(shape);
        tiles.push({
          posRelToBase: xRelToBase + yRelToBase * WORLD_COLS,
          xRelToBase,
          yRelToBase,
          shape,
          flags: tileFlags,
          vehicleHitLocation,
        });
      }
      if (number >= structureCount) throw new FormatError(`JSD structure number ${number} out of range`);
      let wallOrientation = storedOrientation;
      if (auxData && storedOrientation > 2) {
        wallOrientation = CONTIGUOUS_ORIENTATION_TO_FLAG[storedOrientation] ?? storedOrientation;
        const aux = auxData[number];
        if (aux) auxData[number] = { ...aux, wallOrientation };
      }
      structures[number] = {
        number,
        armour,
        hitPoints: u8(Math.trunc((filled * 100) / MAX_HIT_POINT_SCALE)),
        density,
        flags,
        wallOrientation,
        destructionPartner,
        partnerDelta,
        zTileOffsetX,
        zTileOffsetY,
        tiles: normalizedTiles(tiles),
      };
    }
  }
  return { structureCount, auxData, tileLocations, structures };
}

export interface StructureFileInput {
  readonly structureCount: number;
  readonly auxData?: readonly StiAppData[];
  readonly tileLocations?: readonly TileLocation[];
  readonly structures?: readonly StructureDef[];
}

export function writeStructureFile(input: StructureFileInput): Uint8Array {
  const body = new BinaryWriter();
  for (const s of input.structures ?? []) {
    body.u8(s.armour).u8(0).u8(s.density).u8(s.tiles.length).u32(s.flags).u16(s.number);
    body.u8(s.wallOrientation).u8(u8(s.destructionPartner)).u8(u8(s.partnerDelta));
    body.u8(u8(s.zTileOffsetX)).u8(u8(s.zTileOffsetY)).zeros(1);
    for (const t of s.tiles) {
      body.i16(0).u8(u8(t.xRelToBase)).u8(u8(t.yRelToBase)).bytes(t.shape).u8(t.flags).u8(t.vehicleHitLocation).zeros(1);
    }
  }
  const structureData = body.toBytes();
  const hasAux = (input.auxData?.length ?? 0) > 0;
  const hasStructures = (input.structures?.length ?? 0) > 0;
  const w = new BinaryWriter();
  w.bytes(Uint8Array.from(FILE_ID, (c) => c.charCodeAt(0)))
    .u16(input.structureCount)
    .u16(input.structures?.length ?? 0)
    .u16(structureData.length)
    .u8((hasAux ? CONTAINS_AUX_IMAGE_DATA : 0) | (hasStructures ? CONTAINS_STRUCTURE_DATA : 0))
    .zeros(3)
    .u16(input.tileLocations?.length ?? 0);
  if (hasAux) {
    for (const a of input.auxData ?? []) {
      w.u8(a.wallOrientation)
        .u8(a.numberOfTiles)
        .u16(a.tileLocationIndex)
        .zeros(3)
        .u8(a.currentFrame)
        .u8(a.numberOfFrames)
        .u8(a.flags)
        .zeros(6);
    }
    for (const l of input.tileLocations ?? []) w.u8(u8(l.x)).u8(u8(l.y));
  }
  if (hasStructures) w.bytes(structureData);
  return w.toBytes();
}

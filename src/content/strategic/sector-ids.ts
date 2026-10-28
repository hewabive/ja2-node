// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/sgp/Types.cc SGPSector (AsByte, AsStrategicIndex, FromStrategicIndex, AsShortString, AsLongString, IsValid);
// @src src/game/Strategic/StrategicMap.cc GetMapFileName; src/externalized/JsonUtility.cc parseSectorID.

import { FormatError } from '../binary/errors.ts';

export const MAP_SIDE = 16;
export const MAP_WORLD_X = 18;
export const MAP_WORLD_Y = 18;
export const MAP_WORLD_CELLS = MAP_WORLD_X * MAP_WORLD_Y;
export const SECTOR_COUNT = MAP_SIDE * MAP_SIDE;
export const MAX_SECTOR_Z = 3;
export const NO_PREVIOUS_SECTOR_ID = 255;

export interface Sector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const ROW_LETTER_BASE = 'A'.charCodeAt(0) - 1;

export function sector(x: number, y: number, z = 0): Sector {
  return { x, y, z };
}

export function isValidSector(s: Sector): boolean {
  return s.x >= 1 && s.x <= MAP_SIDE && s.y >= 1 && s.y <= MAP_SIDE && s.z >= 0 && s.z <= MAX_SECTOR_Z;
}

export function sameSector(a: Sector, b: Sector): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function sectorId(s: { readonly x: number; readonly y: number }): number {
  return ((s.y - 1) * MAP_SIDE + s.x - 1) & 0xff;
}

export function sectorFromId(id: number, z = 0): Sector {
  const byte = id >>> 0;
  return { x: (byte % MAP_SIDE) + 1, y: Math.trunc(byte / MAP_SIDE) + 1, z };
}

export function strategicIndex(s: { readonly x: number; readonly y: number }): number {
  return (s.x + s.y * MAP_WORLD_X) & 0xffff;
}

export function sectorFromStrategicIndex(index: number): Sector {
  const i = index & 0xffff;
  return { x: i % MAP_WORLD_X, y: Math.trunc(i / MAP_WORLD_X), z: 0 };
}

export function sectorShortString(s: { readonly x: number; readonly y: number }): string {
  return `${String.fromCharCode(ROW_LETTER_BASE + s.y)}${s.x}`;
}

export function sectorLongString(s: Sector, forFile: boolean): string {
  return forFile ? `${sectorShortString(s)}_b${s.z}` : `${sectorShortString(s)}-${s.z}`;
}

export function parseSectorString(text: string, z = 0): Sector {
  const m = /^([A-Pa-p])(\d{1,2})$/.exec(text.trim());
  if (!m) throw new FormatError(`not a sector: ${text}`);
  const s = { x: Number(m[2]), y: (m[1] as string).toUpperCase().charCodeAt(0) - ROW_LETTER_BASE, z };
  if (!isValidSector(s)) throw new FormatError(`sector out of range: ${text}`);
  return s;
}

export function parseSectorId(text: string): number {
  return sectorId(parseSectorString(text));
}

export function mapFileName(s: Sector, alternate: boolean): string {
  const base = s.z === 0 ? sectorShortString(s) : sectorLongString(s, true);
  return `${base}${alternate ? '_a' : ''}.dat`;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/LoadSaveMercProfile.cc ExtractMercProfile, SoldierProfileChecksum

import { type MercProfile, PROFILE_RECORD_BYTES, parseProfile } from './prof.ts';

export const PROFILE_RECORD_BYTES_STRAC_LINUX = 796;
const NAME_CHARS = 30;
const NICKNAME_CHARS = 10;
const WIDE_NAME_CHARS = NAME_CHARS + NICKNAME_CHARS;
const UTF16_BYTES = 2;
const UTF32_BYTES = 4;
const BMP_LIMIT = 0x10000;
const REPLACEMENT_CHARACTER = 0xfffd;
const OFFSET_KILLS = 310;
const OFFSET_ASSISTS = 312;
const OFFSET_SHOTS_FIRED = 314;
const OFFSET_SHOTS_HIT = 316;
const OFFSET_BATTLES_FOUGHT = 318;
const OFFSET_TIMES_WOUNDED = 320;
const OFFSET_PROFILE_GRIDNO = 408;
const OFFSET_SECTOR_Z = 669;
const OFFSET_CHECKSUM = 696;

export interface SavedMercProfile extends MercProfile {
  readonly sectorZ: number;
  readonly profileGridNo: number;
  readonly kills: number;
  readonly assists: number;
  readonly shotsFired: number;
  readonly shotsHit: number;
  readonly battlesFought: number;
  readonly timesWounded: number;
  readonly checksum: number;
}

export function profileRecordBytes(stracLinuxFormat: boolean): number {
  return stracLinuxFormat ? PROFILE_RECORD_BYTES_STRAC_LINUX : PROFILE_RECORD_BYTES;
}

function linuxToWindowsProfile(plain: Uint8Array): Uint8Array {
  const out = new Uint8Array(PROFILE_RECORD_BYTES);
  const src = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const dst = new DataView(out.buffer);
  for (let i = 0; i < WIDE_NAME_CHARS; i++) {
    const code = src.getUint32(i * UTF32_BYTES, true);
    dst.setUint16(i * UTF16_BYTES, code < BMP_LIMIT ? code : REPLACEMENT_CHARACTER, true);
  }
  out.set(plain.subarray(WIDE_NAME_CHARS * UTF32_BYTES), WIDE_NAME_CHARS * UTF16_BYTES);
  return out;
}

export function decodeSavedProfile(id: number, plain: Uint8Array, stracLinuxFormat: boolean): SavedMercProfile {
  const record = stracLinuxFormat ? linuxToWindowsProfile(plain) : plain;
  const v = new DataView(record.buffer, record.byteOffset, record.byteLength);
  return {
    ...parseProfile(id, record),
    sectorZ: v.getInt8(OFFSET_SECTOR_Z),
    profileGridNo: v.getInt16(OFFSET_PROFILE_GRIDNO, true),
    kills: v.getUint16(OFFSET_KILLS, true),
    assists: v.getUint16(OFFSET_ASSISTS, true),
    shotsFired: v.getUint16(OFFSET_SHOTS_FIRED, true),
    shotsHit: v.getUint16(OFFSET_SHOTS_HIT, true),
    battlesFought: v.getUint16(OFFSET_BATTLES_FOUGHT, true),
    timesWounded: v.getUint16(OFFSET_TIMES_WOUNDED, true),
    checksum: v.getUint32(OFFSET_CHECKSUM, true),
  };
}

export function profileChecksum(p: MercProfile): number {
  let sum = 1;
  sum = (sum + 1 + p.life) >>> 0;
  sum = Math.imul(sum, 1 + p.lifeMax) >>> 0;
  sum = (sum + 1 + p.agility) >>> 0;
  sum = Math.imul(sum, 1 + p.dexterity) >>> 0;
  sum = (sum + 1 + p.strength) >>> 0;
  sum = Math.imul(sum, 1 + p.marksmanship) >>> 0;
  sum = (sum + 1 + p.medical) >>> 0;
  sum = Math.imul(sum, 1 + p.mechanical) >>> 0;
  sum = (sum + 1 + p.explosives) >>> 0;
  sum = Math.imul(sum, 1 + p.experience) >>> 0;
  for (const item of p.inventory) sum = (sum + item) >>> 0;
  for (const count of p.inventoryCount) sum = (sum + count) >>> 0;
  return sum;
}

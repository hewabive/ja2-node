// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Tactical_Save.cc JA2EncryptedFileRead; LoadSaveMercProfile.cc ExtractMercProfile

import { FormatError } from '../binary/errors.ts';

export const PROFILES_PATH = 'binarydata/prof.dat';
export const PROFILE_RECORD_BYTES = 716;
export const HAND_POSITION = 5;
const ROTATION_KEY = [
  132, 235, 125, 99, 15, 220, 140, 89, 205, 132, 254, 144, 217, 78, 156, 58, 215, 76, 163, 187, 55, 49, 65, 48, 156, 140, 201, 68, 184, 13,
  45, 69, 102, 185, 122, 225, 23, 250, 160, 220, 114, 240, 64, 175, 0o57, 233,
];
const PALETTE_ID_BYTES = 30;
const MERC_OPINIONS = 75;
const RELATION_SLOTS = 5;
const STAT_CHANGE_COUNTERS = 12;

export interface MercProfile {
  readonly id: number;
  readonly name: string;
  readonly nickname: string;
  readonly palettes: { readonly hair: string; readonly skin: string; readonly vest: string; readonly pants: string };
  readonly sex: number;
  readonly bodyType: number;
  readonly bodyTypeSubFlags: number;
  readonly life: number;
  readonly lifeMax: number;
  readonly strength: number;
  readonly agility: number;
  readonly dexterity: number;
  readonly wisdom: number;
  readonly marksmanship: number;
  readonly medical: number;
  readonly mechanical: number;
  readonly explosives: number;
  readonly leadership: number;
  readonly experience: number;
  readonly skillTrait: number;
  readonly skillTrait2: number;
  readonly personalityTrait: number;
  readonly civilianGroup: number;
  readonly sectorX: number;
  readonly sectorY: number;
  readonly inventory: readonly number[];
  readonly inventoryStatus: readonly number[];
  readonly inventoryCount: readonly number[];
  readonly inventoryUndroppable: number;
  readonly money: number;
  readonly evolution: number;
  readonly attitude: number;
  readonly buddies: readonly number[];
  readonly hated: readonly number[];
  readonly gains: ProfileStatGains;
  readonly needForSleep: number;
  readonly town: number;
  readonly townAttachment: number;
  readonly mercOpinion: readonly number[];
  readonly sexist: number;
  readonly deathRate: number;
  readonly hatedTime: readonly number[];
  readonly hatedCount: readonly number[];
  readonly learnToHate: number;
  readonly learnToHateTime: number;
  readonly learnToHateCount: number;
  readonly learnToLike: number;
  readonly learnToLikeTime: number;
  readonly learnToLikeCount: number;
  readonly timeTillNextHatedComplaint: number;
  readonly statChangeChances: readonly number[];
  readonly statChangeSuccesses: readonly number[];
}

export interface ProfileStatGains {
  readonly expLevel: number;
  readonly life: number;
  readonly agility: number;
  readonly dexterity: number;
  readonly wisdom: number;
  readonly marksmanship: number;
  readonly medical: number;
  readonly mechanical: number;
  readonly explosives: number;
  readonly leadership: number;
  readonly strength: number;
}

export function decryptRecord(encrypted: Uint8Array): Uint8Array {
  const plain = new Uint8Array(encrypted.length);
  let previous = 0;
  for (let i = 0; i < encrypted.length; i++) {
    const byte = encrypted[i] ?? 0;
    plain[i] = (byte - previous - (ROTATION_KEY[i % ROTATION_KEY.length] ?? 0)) & 0xff;
    previous = byte;
  }
  return plain;
}

export function encryptRecord(plain: Uint8Array): Uint8Array {
  const encrypted = new Uint8Array(plain.length);
  let previous = 0;
  for (let i = 0; i < plain.length; i++) {
    encrypted[i] = ((plain[i] ?? 0) + previous + (ROTATION_KEY[i % ROTATION_KEY.length] ?? 0)) & 0xff;
    previous = encrypted[i] ?? 0;
  }
  return encrypted;
}

function utf16(view: DataView, offset: number, chars: number): string {
  let s = '';
  for (let i = 0; i < chars; i++) {
    const c = view.getUint16(offset + i * 2, true);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function ascii(bytes: Uint8Array, offset: number): string {
  let s = '';
  for (let i = 0; i < PALETTE_ID_BYTES; i++) {
    const c = bytes[offset + i] ?? 0;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

export function parseProfile(id: number, plain: Uint8Array): MercProfile {
  const v = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const i8 = (o: number) => v.getInt8(o);
  return {
    id,
    name: utf16(v, 0, 30),
    nickname: utf16(v, 60, 10),
    palettes: { pants: ascii(plain, 109), vest: ascii(plain, 139), skin: ascii(plain, 169), hair: ascii(plain, 199) },
    sex: i8(229),
    bodyType: v.getUint8(260),
    bodyTypeSubFlags: v.getUint32(328, true),
    strength: i8(296),
    lifeMax: i8(297),
    life: i8(334),
    dexterity: i8(335),
    skillTrait: i8(337),
    skillTrait2: i8(340),
    personalityTrait: i8(336),
    experience: i8(352),
    marksmanship: i8(353),
    medical: i8(261),
    mechanical: i8(411),
    explosives: i8(339),
    leadership: i8(341),
    wisdom: i8(355),
    agility: i8(405),
    civilianGroup: v.getUint8(682),
    sectorX: v.getUint16(288, true),
    sectorY: v.getUint16(290, true),
    inventory: Array.from({ length: 19 }, (_, k) => v.getUint16(416 + k * 2, true)),
    inventoryStatus: Array.from(plain.subarray(358, 377)),
    inventoryCount: Array.from(plain.subarray(377, 396)),
    inventoryUndroppable: v.getUint8(412),
    money: v.getUint32(684, true),
    evolution: i8(232),
    attitude: i8(549),
    buddies: Array.from({ length: RELATION_SLOTS }, (_, k) => i8(342 + k)),
    hated: Array.from({ length: RELATION_SLOTS }, (_, k) => i8(347 + k)),
    gains: {
      expLevel: v.getInt16(242, true),
      life: v.getInt16(244, true),
      agility: v.getInt16(246, true),
      dexterity: v.getInt16(248, true),
      wisdom: v.getInt16(250, true),
      marksmanship: v.getInt16(252, true),
      medical: v.getInt16(254, true),
      mechanical: v.getInt16(256, true),
      explosives: v.getInt16(258, true),
      leadership: v.getInt16(324, true),
      strength: v.getInt16(326, true),
    },
    needForSleep: v.getUint8(683),
    town: i8(571),
    townAttachment: i8(572),
    mercOpinion: Array.from({ length: MERC_OPINIONS }, (_, k) => i8(576 + k)),
    sexist: v.getUint8(234),
    deathRate: i8(239),
    hatedTime: Array.from({ length: RELATION_SLOTS }, (_, k) => i8(653 + k)),
    hatedCount: Array.from({ length: RELATION_SLOTS }, (_, k) => i8(660 + k)),
    learnToHate: i8(235),
    learnToHateTime: i8(659),
    learnToHateCount: i8(666),
    learnToLike: i8(554),
    learnToLikeTime: i8(658),
    learnToLikeCount: i8(665),
    timeTillNextHatedComplaint: v.getUint8(702),
    statChangeChances: Array.from({ length: STAT_CHANGE_COUNTERS }, (_, k) => v.getUint16(474 + k * 2, true)),
    statChangeSuccesses: Array.from({ length: STAT_CHANGE_COUNTERS }, (_, k) => v.getUint16(498 + k * 2, true)),
  };
}

export function parseProfiles(bytes: Uint8Array): MercProfile[] {
  if (bytes.length % PROFILE_RECORD_BYTES !== 0)
    throw new FormatError(`prof.dat size ${bytes.length} is not a multiple of ${PROFILE_RECORD_BYTES}`);
  const profiles: MercProfile[] = [];
  for (let i = 0; i < bytes.length / PROFILE_RECORD_BYTES; i++) {
    profiles.push(parseProfile(i, decryptRecord(bytes.subarray(i * PROFILE_RECORD_BYTES, (i + 1) * PROFILE_RECORD_BYTES))));
  }
  return profiles;
}

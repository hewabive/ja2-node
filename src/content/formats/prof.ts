// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Tactical_Save.cc JA2EncryptedFileRead; LoadSaveMercProfile.cc ExtractMercProfile (NPC fields: docs/24 §1.2)

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
export const NUM_REAL_APPROACHES = 4;
export const NUM_APPROACH_MOD_ROWS = 3;
const ROOM_RANGES = 2;

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
  readonly sectorZ: number;
  readonly gridNo: number;
  readonly useProfileInsertion: boolean;
  readonly insertionCode: number;
  readonly insertionData: number;
  readonly quoteRecord: number;
  readonly quoteActionId: number;
  readonly npcData: number;
  readonly npcData2: number;
  readonly lastDateSpokenTo: number;
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
  readonly reputationTolerance: number;
  readonly armourAttractiveness: number;
  readonly mainGunAttractiveness: number;
  readonly miscFlags: number;
  readonly miscFlags2: number;
  readonly miscFlags3: number;
  readonly dayBecomesAvailable: number;
  readonly totalDaysServed: number;
  readonly salary: number;
  readonly weeklySalary: number;
  readonly biWeeklySalary: number;
  readonly medicalDeposit: number;
  readonly medicalDepositAmount: number;
  readonly optionalGearCost: number;
  readonly mercStatus: number;
  readonly balance: number;
  readonly daysOfMoraleHangover: number;
  readonly precedentQuoteSaid: number;
  readonly suspiciousDeath: number;
  readonly mercMercContractLength: number;
  readonly totalCostToDate: number;
  readonly faceIndex: number;
  readonly eyesX: number;
  readonly eyesY: number;
  readonly mouthX: number;
  readonly mouthY: number;
  readonly blinkFrequency: number;
  readonly expressionFrequency: number;
  readonly approachFactor: readonly number[];
  readonly approachVal: readonly number[];
  readonly approachMod: readonly (readonly number[])[];
  readonly approached: number;
  readonly lastQuoteSaid: number;
  readonly lastQuoteSaidWasSpecial: boolean;
  readonly friendlyOrDirectDefaultResponseUsedRecently: number;
  readonly recruitDefaultResponseUsedRecently: number;
  readonly threatenDefaultResponseUsedRecently: number;
  readonly roomRangeStart: readonly number[];
  readonly roomRangeEnd: readonly number[];
}

export type ProfileNpcFields = Pick<
  MercProfile,
  | 'faceIndex'
  | 'eyesX'
  | 'eyesY'
  | 'mouthX'
  | 'mouthY'
  | 'blinkFrequency'
  | 'expressionFrequency'
  | 'approachFactor'
  | 'approachVal'
  | 'approachMod'
  | 'approached'
  | 'lastDateSpokenTo'
  | 'lastQuoteSaid'
  | 'lastQuoteSaidWasSpecial'
  | 'friendlyOrDirectDefaultResponseUsedRecently'
  | 'recruitDefaultResponseUsedRecently'
  | 'threatenDefaultResponseUsedRecently'
  | 'quoteRecord'
  | 'quoteActionId'
  | 'npcData'
  | 'npcData2'
  | 'useProfileInsertion'
  | 'insertionCode'
  | 'insertionData'
  | 'roomRangeStart'
  | 'roomRangeEnd'
>;

export function zeroProfileNpcFields(): ProfileNpcFields {
  const zeros = (n: number) => new Array<number>(n).fill(0);
  return {
    faceIndex: 0,
    eyesX: 0,
    eyesY: 0,
    mouthX: 0,
    mouthY: 0,
    blinkFrequency: 0,
    expressionFrequency: 0,
    approachFactor: zeros(NUM_REAL_APPROACHES),
    approachVal: zeros(NUM_REAL_APPROACHES),
    approachMod: Array.from({ length: NUM_APPROACH_MOD_ROWS }, () => zeros(NUM_REAL_APPROACHES)),
    approached: 0,
    lastDateSpokenTo: 0,
    lastQuoteSaid: 0,
    lastQuoteSaidWasSpecial: false,
    friendlyOrDirectDefaultResponseUsedRecently: 0,
    recruitDefaultResponseUsedRecently: 0,
    threatenDefaultResponseUsedRecently: 0,
    quoteRecord: 0,
    quoteActionId: 0,
    npcData: 0,
    npcData2: 0,
    useProfileInsertion: false,
    insertionCode: 0,
    insertionData: 0,
    roomRangeStart: zeros(ROOM_RANGES),
    roomRangeEnd: zeros(ROOM_RANGES),
  };
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
    sectorZ: i8(669),
    gridNo: v.getInt16(408, true),
    useProfileInsertion: v.getUint8(406) !== 0,
    insertionCode: v.getUint8(522),
    insertionData: v.getUint16(670, true),
    quoteRecord: v.getUint8(238),
    quoteActionId: v.getUint8(410),
    npcData: i8(675),
    npcData2: i8(688),
    lastDateSpokenTo: v.getUint8(667),
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
    reputationTolerance: i8(338),
    armourAttractiveness: i8(230),
    mainGunAttractiveness: i8(404),
    miscFlags: v.getUint8(233),
    miscFlags2: v.getUint8(231),
    miscFlags3: v.getUint8(689),
    dayBecomesAvailable: v.getUint32(292, true),
    totalDaysServed: v.getUint16(322, true),
    salary: v.getInt16(332, true),
    weeklySalary: v.getUint32(540, true),
    biWeeklySalary: v.getUint32(544, true),
    medicalDeposit: i8(548),
    medicalDepositAmount: v.getUint16(552, true),
    optionalGearCost: v.getUint16(574, true),
    mercStatus: i8(652),
    balance: v.getInt32(676, true),
    daysOfMoraleHangover: v.getUint8(690),
    precedentQuoteSaid: v.getUint32(692, true),
    suspiciousDeath: v.getUint8(703),
    mercMercContractLength: v.getInt32(704, true),
    totalCostToDate: v.getUint32(708, true),
    faceIndex: v.getUint8(108),
    eyesX: v.getUint16(262, true),
    eyesY: v.getUint16(264, true),
    mouthX: v.getUint16(266, true),
    mouthY: v.getUint16(268, true),
    blinkFrequency: v.getUint32(280, true),
    expressionFrequency: v.getUint32(284, true),
    approachFactor: Array.from({ length: NUM_REAL_APPROACHES }, (_, k) => v.getUint16(396 + k * 2, true)),
    approachVal: Array.from(plain.subarray(555, 555 + NUM_REAL_APPROACHES)),
    approachMod: Array.from({ length: NUM_APPROACH_MOD_ROWS }, (_, row) =>
      Array.from(plain.subarray(559 + row * NUM_REAL_APPROACHES, 559 + (row + 1) * NUM_REAL_APPROACHES)),
    ),
    approached: i8(651),
    lastQuoteSaid: v.getUint8(529),
    lastQuoteSaidWasSpecial: v.getUint8(668) !== 0,
    friendlyOrDirectDefaultResponseUsedRecently: i8(672),
    recruitDefaultResponseUsedRecently: i8(673),
    threatenDefaultResponseUsedRecently: i8(674),
    roomRangeStart: Array.from(plain.subarray(413, 413 + ROOM_RANGES)),
    roomRangeEnd: Array.from(plain.subarray(523, 523 + ROOM_RANGES)),
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

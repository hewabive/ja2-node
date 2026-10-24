// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Campaign.h StatKind; Soldier_Profile_Type.h MERCPROFILESTRUCT (mutable campaign fields, the NPC
// @src presence fields of docs/25 §0), bMercStatus
// @src values; Soldier_Profile.cc InitProfileFromContent (the relation counters)

import type { MercProfile } from '../../content/formats/prof.ts';
import type { SavedMercProfile } from '../../content/formats/savegame-profile.ts';

const STAT_CHANGE_COUNTERS = 12;
const INITIAL_HATED_COUNTERS = 2;

export const MercStatus = {
  OK: 0,
  HAS_NO_TEXT_FILE: -1,
  ANNOYED_BUT_CAN_STILL_CONTACT: -2,
  ANNOYED_WONT_CONTACT: -3,
  HIRED_BUT_NOT_ARRIVED_YET: -4,
  IS_DEAD: -5,
  RETURNING_HOME: -6,
  WORKING_ELSEWHERE: -7,
  FIRED_AS_A_POW: -8,
} as const;

export const StatKind = {
  SALARY: 0,
  HEALTH: 1,
  AGILITY: 2,
  DEXTERITY: 3,
  WISDOM: 4,
  MEDICAL: 5,
  EXPLOSIVES: 6,
  MECHANICAL: 7,
  MARKSMANSHIP: 8,
  EXPERIENCE: 9,
  STRENGTH: 10,
  LEADERSHIP: 11,
} as const;

export type StatKey =
  | 'lifeMax'
  | 'agility'
  | 'dexterity'
  | 'wisdom'
  | 'medical'
  | 'explosives'
  | 'mechanical'
  | 'marksmanship'
  | 'experience'
  | 'strength'
  | 'leadership';

export const STAT_KEYS: Readonly<Record<number, StatKey>> = {
  [StatKind.HEALTH]: 'lifeMax',
  [StatKind.AGILITY]: 'agility',
  [StatKind.DEXTERITY]: 'dexterity',
  [StatKind.WISDOM]: 'wisdom',
  [StatKind.MEDICAL]: 'medical',
  [StatKind.EXPLOSIVES]: 'explosives',
  [StatKind.MECHANICAL]: 'mechanical',
  [StatKind.MARKSMANSHIP]: 'marksmanship',
  [StatKind.EXPERIENCE]: 'experience',
  [StatKind.STRENGTH]: 'strength',
  [StatKind.LEADERSHIP]: 'leadership',
};

export interface NpcProfileFields {
  town: number;
  townAttachment: number;
  money: number;
  miscFlags2: number;
  readonly approachFactor: readonly number[];
  readonly approachVal: number[];
  readonly approachMod: readonly (readonly number[])[];
  approached: number;
  lastDateSpokenTo: number;
  lastQuoteSaid: number;
  lastQuoteSaidWasSpecial: boolean;
  friendlyOrDirectDefaultResponseUsedRecently: number;
  recruitDefaultResponseUsedRecently: number;
  threatenDefaultResponseUsedRecently: number;
  npcData: number;
  npcData2: number;
  quoteRecord: number;
  quoteActionId: number;
  useProfileInsertion: boolean;
  insertionCode: number;
  insertionData: number;
}

export interface ProfileProgress extends NpcProfileFields {
  readonly id: number;
  readonly evolution: number;
  readonly attitude: number;
  readonly sex: number;
  readonly personalityTrait: number;
  readonly skillTrait: number;
  readonly skillTrait2: number;
  readonly deathRate: number;
  readonly reputationTolerance: number;
  readonly medicalDeposit: number;
  readonly buddies: number[];
  readonly hated: number[];
  readonly opinions: number[];
  readonly hatedTime: number[];
  readonly hatedCount: number[];
  learnToHate: number;
  learnToHateTime: number;
  learnToHateCount: number;
  learnToLike: number;
  learnToLikeTime: number;
  learnToLikeCount: number;
  timeTillNextHatedComplaint: number;
  life: number;
  readonly stats: Record<StatKey, number>;
  readonly gains: Record<StatKey, number>;
  readonly statChangeChances: number[];
  readonly statChangeSuccesses: number[];
  kills: number;
  assists: number;
  shotsFired: number;
  shotsHit: number;
  timesWounded: number;
  battlesFought: number;
  mercStatus: number;
  dayBecomesAvailable: number;
  salary: number;
  weeklySalary: number;
  biWeeklySalary: number;
  medicalDepositAmount: number;
  optionalGearCost: number;
  mainGunAttractiveness: number;
  armourAttractiveness: number;
  totalDaysServed: number;
  miscFlags: number;
  miscFlags2: number;
  miscFlags3: number;
  daysOfMoraleHangover: number;
  precedentQuoteSaid: number;
  balance: number;
  mercMercContractLength: number;
  suspiciousDeath: number;
  sectorX: number;
  sectorY: number;
  sectorZ: number;
  town: number;
  townAttachment: number;
  npcData: number;
  npcData2: number;
  money: number;
  useProfileInsertion: boolean;
  insertionCode: number;
  insertionData: number;
  quoteRecord: number;
  quoteActionId: number;
  gridNo: number;
  lastDateSpokenTo: number;
  nickname?: string;
  readonly inventory: number[];
  readonly inventoryStatus: number[];
  readonly inventoryCount: number[];
}

export function isProfileDead(p: Pick<ProfileProgress, 'mercStatus'>): boolean {
  return p.mercStatus === MercStatus.IS_DEAD;
}

function initialHatedCounts(p: MercProfile, saved: boolean): number[] {
  if (saved) return [...p.hatedCount];
  return p.hatedCount.map((count, slot) => (slot < INITIAL_HATED_COUNTERS ? (p.hatedTime[slot] ?? 0) : count));
}

export interface SavedProfileCounters {
  readonly kills: number;
  readonly assists: number;
  readonly shotsFired: number;
  readonly shotsHit: number;
  readonly timesWounded: number;
  readonly battlesFought: number;
}

const NO_COUNTERS: SavedProfileCounters = { kills: 0, assists: 0, shotsFired: 0, shotsHit: 0, timesWounded: 0, battlesFought: 0 };

export function npcFieldsFromProfile(p: MercProfile | SavedMercProfile): NpcProfileFields {
  return {
    town: p.town,
    townAttachment: p.townAttachment,
    money: p.money,
    miscFlags2: p.miscFlags2,
    approachFactor: [...p.approachFactor],
    approachVal: [...p.approachVal],
    approachMod: p.approachMod.map((row) => [...row]),
    approached: p.approached,
    lastDateSpokenTo: p.lastDateSpokenTo,
    lastQuoteSaid: p.lastQuoteSaid,
    lastQuoteSaidWasSpecial: p.lastQuoteSaidWasSpecial,
    friendlyOrDirectDefaultResponseUsedRecently: p.friendlyOrDirectDefaultResponseUsedRecently,
    recruitDefaultResponseUsedRecently: p.recruitDefaultResponseUsedRecently,
    threatenDefaultResponseUsedRecently: p.threatenDefaultResponseUsedRecently,
    npcData: p.npcData,
    npcData2: p.npcData2,
    quoteRecord: p.quoteRecord,
    quoteActionId: p.quoteActionId,
    useProfileInsertion: p.useProfileInsertion,
    insertionCode: p.insertionCode,
    insertionData: p.insertionData,
  };
}

export function progressFromProfile(p: MercProfile, counters: SavedProfileCounters = NO_COUNTERS, saved = false): ProfileProgress {
  return {
    ...npcFieldsFromProfile(p),
    id: p.id,
    evolution: p.evolution,
    attitude: p.attitude,
    sex: p.sex,
    personalityTrait: p.personalityTrait,
    skillTrait: p.skillTrait,
    skillTrait2: p.skillTrait2,
    deathRate: p.deathRate,
    reputationTolerance: p.reputationTolerance,
    medicalDeposit: p.medicalDeposit,
    buddies: [...p.buddies],
    hated: [...p.hated],
    opinions: [...p.mercOpinion],
    hatedTime: [...p.hatedTime],
    hatedCount: initialHatedCounts(p, saved),
    learnToHate: p.learnToHate,
    learnToHateTime: p.learnToHateTime,
    learnToHateCount: saved ? p.learnToHateCount : p.learnToHateTime,
    learnToLike: p.learnToLike,
    learnToLikeTime: p.learnToLikeTime,
    learnToLikeCount: saved ? p.learnToLikeCount : p.learnToLikeTime,
    timeTillNextHatedComplaint: p.timeTillNextHatedComplaint,
    life: p.life,
    stats: {
      lifeMax: p.lifeMax,
      agility: p.agility,
      dexterity: p.dexterity,
      wisdom: p.wisdom,
      medical: p.medical,
      explosives: p.explosives,
      mechanical: p.mechanical,
      marksmanship: p.marksmanship,
      experience: p.experience,
      strength: p.strength,
      leadership: p.leadership,
    },
    gains: {
      lifeMax: p.gains.life,
      agility: p.gains.agility,
      dexterity: p.gains.dexterity,
      wisdom: p.gains.wisdom,
      medical: p.gains.medical,
      explosives: p.gains.explosives,
      mechanical: p.gains.mechanical,
      marksmanship: p.gains.marksmanship,
      experience: p.gains.expLevel,
      strength: p.gains.strength,
      leadership: p.gains.leadership,
    },
    statChangeChances: saved ? [...p.statChangeChances] : new Array<number>(STAT_CHANGE_COUNTERS).fill(0),
    statChangeSuccesses: saved ? [...p.statChangeSuccesses] : new Array<number>(STAT_CHANGE_COUNTERS).fill(0),
    kills: counters.kills,
    assists: counters.assists,
    shotsFired: counters.shotsFired,
    shotsHit: counters.shotsHit,
    timesWounded: counters.timesWounded,
    battlesFought: counters.battlesFought,
    mercStatus: saved ? p.mercStatus : MercStatus.OK,
    dayBecomesAvailable: p.dayBecomesAvailable,
    salary: p.salary,
    weeklySalary: p.weeklySalary,
    biWeeklySalary: p.biWeeklySalary,
    medicalDepositAmount: p.medicalDepositAmount,
    optionalGearCost: p.optionalGearCost,
    mainGunAttractiveness: p.mainGunAttractiveness,
    armourAttractiveness: p.armourAttractiveness,
    totalDaysServed: p.totalDaysServed,
    miscFlags: p.miscFlags,
    miscFlags2: p.miscFlags2,
    miscFlags3: p.miscFlags3,
    daysOfMoraleHangover: p.daysOfMoraleHangover,
    precedentQuoteSaid: p.precedentQuoteSaid,
    balance: p.balance,
    mercMercContractLength: p.mercMercContractLength,
    suspiciousDeath: p.suspiciousDeath,
    sectorX: p.sectorX,
    sectorY: p.sectorY,
    sectorZ: p.sectorZ,
    town: p.town,
    townAttachment: p.townAttachment,
    npcData: p.npcData,
    npcData2: p.npcData2,
    money: p.money,
    useProfileInsertion: p.useProfileInsertion,
    insertionCode: p.insertionCode,
    insertionData: p.insertionData,
    quoteRecord: p.quoteRecord,
    quoteActionId: p.quoteActionId,
    gridNo: p.gridNo,
    lastDateSpokenTo: p.lastDateSpokenTo,
    inventory: [...p.inventory],
    inventoryStatus: [...p.inventoryStatus],
    inventoryCount: [...p.inventoryCount],
  };
}

export interface ProfileSource {
  readonly profiles: Map<number, ProfileProgress>;
  readonly content: { readonly profiles: readonly MercProfile[] };
}

const NO_PROFILE_ID = -1;

export function noRelations(): Pick<
  ProfileProgress,
  | 'opinions'
  | 'hatedTime'
  | 'hatedCount'
  | 'learnToHate'
  | 'learnToHateTime'
  | 'learnToHateCount'
  | 'learnToLike'
  | 'learnToLikeTime'
  | 'learnToLikeCount'
  | 'timeTillNextHatedComplaint'
> {
  return {
    opinions: [],
    hatedTime: [],
    hatedCount: [],
    learnToHate: NO_PROFILE_ID,
    learnToHateTime: 0,
    learnToHateCount: 0,
    learnToLike: NO_PROFILE_ID,
    learnToLikeTime: 0,
    learnToLikeCount: 0,
    timeTillNextHatedComplaint: 0,
  };
}

export type CampaignProfileFields = NpcProfileFields &
  Pick<
    ProfileProgress,
    | 'sex'
    | 'personalityTrait'
    | 'skillTrait'
    | 'skillTrait2'
    | 'deathRate'
    | 'reputationTolerance'
    | 'medicalDeposit'
    | 'mercStatus'
    | 'dayBecomesAvailable'
    | 'salary'
    | 'weeklySalary'
    | 'biWeeklySalary'
    | 'medicalDepositAmount'
    | 'optionalGearCost'
    | 'mainGunAttractiveness'
    | 'armourAttractiveness'
    | 'totalDaysServed'
    | 'miscFlags'
    | 'miscFlags2'
    | 'miscFlags3'
    | 'daysOfMoraleHangover'
    | 'precedentQuoteSaid'
    | 'balance'
    | 'mercMercContractLength'
    | 'suspiciousDeath'
    | 'sectorX'
    | 'sectorY'
    | 'sectorZ'
    | 'town'
    | 'townAttachment'
    | 'npcData'
    | 'npcData2'
    | 'money'
    | 'useProfileInsertion'
    | 'insertionCode'
    | 'insertionData'
    | 'quoteRecord'
    | 'quoteActionId'
    | 'gridNo'
    | 'lastDateSpokenTo'
    | 'inventory'
    | 'inventoryStatus'
    | 'inventoryCount'
  >;

const NO_ATTRACTIVENESS = -1;

const NO_QUOTE = 255;
const NUM_REAL_APPROACHES = 4;
const NUM_APPROACH_MOD_ROWS = 3;

export function noNpcFields(): NpcProfileFields {
  return {
    town: 0,
    townAttachment: 0,
    money: 0,
    miscFlags2: 0,
    approachFactor: new Array<number>(NUM_REAL_APPROACHES).fill(0),
    approachVal: new Array<number>(NUM_REAL_APPROACHES).fill(0),
    approachMod: Array.from({ length: NUM_APPROACH_MOD_ROWS }, () => new Array<number>(NUM_REAL_APPROACHES).fill(0)),
    approached: 0,
    lastDateSpokenTo: 0,
    lastQuoteSaid: NO_QUOTE,
    lastQuoteSaidWasSpecial: false,
    friendlyOrDirectDefaultResponseUsedRecently: 0,
    recruitDefaultResponseUsedRecently: 0,
    threatenDefaultResponseUsedRecently: 0,
    npcData: 0,
    npcData2: 0,
    quoteRecord: 0,
    quoteActionId: 0,
    useProfileInsertion: false,
    insertionCode: 0,
    insertionData: 0,
  };
}

export function noCampaignFields(): CampaignProfileFields {
  return {
    ...noNpcFields(),
    sex: 0,
    personalityTrait: 0,
    skillTrait: 0,
    skillTrait2: 0,
    deathRate: 0,
    reputationTolerance: 0,
    medicalDeposit: 0,
    mercStatus: MercStatus.OK,
    dayBecomesAvailable: 0,
    salary: 0,
    weeklySalary: 0,
    biWeeklySalary: 0,
    medicalDepositAmount: 0,
    optionalGearCost: 0,
    mainGunAttractiveness: NO_ATTRACTIVENESS,
    armourAttractiveness: NO_ATTRACTIVENESS,
    totalDaysServed: 0,
    miscFlags: 0,
    miscFlags2: 0,
    miscFlags3: 0,
    daysOfMoraleHangover: 0,
    precedentQuoteSaid: 0,
    balance: 0,
    mercMercContractLength: 0,
    suspiciousDeath: 0,
    sectorX: 0,
    sectorY: 0,
    sectorZ: 0,
    town: 0,
    townAttachment: 0,
    npcData: 0,
    npcData2: 0,
    money: 0,
    useProfileInsertion: false,
    insertionCode: 0,
    insertionData: 0,
    quoteRecord: 0,
    quoteActionId: 0,
    gridNo: 0,
    lastDateSpokenTo: 0,
    inventory: [],
    inventoryStatus: [],
    inventoryCount: [],
  };
}

export function profileProgress(t: ProfileSource, id: number): ProfileProgress | null {
  const existing = t.profiles.get(id);
  if (existing) return existing;
  const p = t.content.profiles[id];
  if (!p) return null;
  const created = progressFromProfile(p);
  t.profiles.set(id, created);
  return created;
}

import { FormatError } from '../binary/errors.ts';
import { asArray, asInt, asObject, asString, type JsonObject } from '../strategic/json-fields.ts';
import { parseSectorString } from '../strategic/sector-ids.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import type { MercProfile, ProfileStatGains } from './prof.ts';

export const STUB_PROFILES_PATH = 'stubs/profiles.json';

const INVENTORY_SLOTS = 19;
const RELATION_SLOTS = 5;
const MERC_OPINIONS = 75;
const STAT_CHANGE_COUNTERS = 12;
const NO_RELATION = -1;
const NO_ATTRACTIVENESS = -1;
const FULL_STATUS = 100;
const DEFAULT_NEED_FOR_SLEEP = 7;
const DEFAULT_DEATH_RATE = 50;
const DEFAULT_REPUTATION_TOLERANCE = 50;
const STAT_KEYS = [
  'life',
  'lifeMax',
  'strength',
  'agility',
  'dexterity',
  'wisdom',
  'marksmanship',
  'medical',
  'mechanical',
  'explosives',
  'leadership',
  'experience',
] as const;

export type ItemIndex = (name: string) => number | undefined;

const NO_GAINS: ProfileStatGains = {
  expLevel: 0,
  life: 0,
  agility: 0,
  dexterity: 0,
  wisdom: 0,
  marksmanship: 0,
  medical: 0,
  mechanical: 0,
  explosives: 0,
  leadership: 0,
  strength: 0,
};

function int(o: JsonObject, key: string, fallback: number, what: string): number {
  return o[key] === undefined ? fallback : asInt(o[key], `${what}.${key}`);
}

function text(o: JsonObject, key: string, what: string): string {
  return o[key] === undefined ? '' : asString(o[key], `${what}.${key}`);
}

function slots(o: JsonObject, key: string, fill: number, what: string): number[] {
  const list = o[key] === undefined ? [] : asArray(o[key], `${what}.${key}`).map((v, i) => asInt(v, `${what}.${key}[${i}]`));
  if (list.length > RELATION_SLOTS) throw new FormatError(`${what}.${key}: at most ${RELATION_SLOTS} entries`);
  return Array.from({ length: RELATION_SLOTS }, (_, k) => list[k] ?? fill);
}

function opinions(o: JsonObject, what: string): number[] {
  const list = new Array<number>(MERC_OPINIONS).fill(0);
  if (o.opinions === undefined) return list;
  for (const [about, value] of Object.entries(asObject(o.opinions, `${what}.opinions`))) {
    const k = Number(about);
    if (!Number.isInteger(k) || k < 0 || k >= MERC_OPINIONS) throw new FormatError(`${what}.opinions: bad profile id ${about}`);
    list[k] = asInt(value, `${what}.opinions.${about}`);
  }
  return list;
}

interface Inventory {
  readonly items: number[];
  readonly status: number[];
  readonly count: number[];
}

function inventory(o: JsonObject, itemIndex: ItemIndex, what: string): Inventory {
  const items = new Array<number>(INVENTORY_SLOTS).fill(0);
  const status = new Array<number>(INVENTORY_SLOTS).fill(0);
  const count = new Array<number>(INVENTORY_SLOTS).fill(0);
  if (o.inventory === undefined) return { items, status, count };
  asArray(o.inventory, `${what}.inventory`).forEach((entry, i) => {
    const e = asObject(entry, `${what}.inventory[${i}]`);
    const slot = asInt(e.slot, `${what}.inventory[${i}].slot`);
    const name = asString(e.item, `${what}.inventory[${i}].item`);
    const index = itemIndex(name);
    if (index === undefined) throw new FormatError(`${what}.inventory[${i}]: unknown item ${name}`);
    if (slot < 0 || slot >= INVENTORY_SLOTS) throw new FormatError(`${what}.inventory[${i}]: bad slot ${slot}`);
    items[slot] = index;
    status[slot] = int(e, 'status', FULL_STATUS, `${what}.inventory[${i}]`);
    count[slot] = int(e, 'count', 1, `${what}.inventory[${i}]`);
  });
  return { items, status, count };
}

function stats(o: JsonObject, what: string): Record<(typeof STAT_KEYS)[number], number> {
  const s = asObject(o.stats, `${what}.stats`);
  return Object.fromEntries(STAT_KEYS.map((key) => [key, asInt(s[key], `${what}.stats.${key}`)])) as Record<
    (typeof STAT_KEYS)[number],
    number
  >;
}

function homeSector(o: JsonObject, what: string): { readonly x: number; readonly y: number } {
  if (o.sector === undefined) return { x: 0, y: 0 };
  const sector = parseSectorString(asString(o.sector, `${what}.sector`));
  return { x: sector.x, y: sector.y };
}

function parseStubProfile(json: unknown, itemIndex: ItemIndex, index: number): MercProfile {
  const what = `stub profile ${index}`;
  const o = asObject(json, what);
  const id = asInt(o.id, `${what}.id`);
  const palettes = o.palettes === undefined ? {} : asObject(o.palettes, `${what}.palettes`);
  const inv = inventory(o, itemIndex, what);
  const hatedTime = slots(o, 'hatedTime', 0, what);
  const learnToHateTime = int(o, 'learnToHateTime', 0, what);
  const learnToLikeTime = int(o, 'learnToLikeTime', 0, what);
  const home = homeSector(o, what);
  return {
    id,
    name: asString(o.name, `${what}.name`),
    nickname: asString(o.nickname, `${what}.nickname`),
    palettes: {
      hair: text(palettes, 'hair', what),
      skin: text(palettes, 'skin', what),
      vest: text(palettes, 'vest', what),
      pants: text(palettes, 'pants', what),
    },
    sex: int(o, 'sex', 0, what),
    bodyType: int(o, 'bodyType', 0, what),
    bodyTypeSubFlags: 0,
    ...stats(o, what),
    skillTrait: int(o, 'skillTrait', 0, what),
    skillTrait2: int(o, 'skillTrait2', 0, what),
    personalityTrait: int(o, 'personalityTrait', 0, what),
    civilianGroup: int(o, 'civilianGroup', 0, what),
    sectorX: home.x,
    sectorY: home.y,
    inventory: inv.items,
    inventoryStatus: inv.status,
    inventoryCount: inv.count,
    inventoryUndroppable: 0,
    money: 0,
    evolution: int(o, 'evolution', 0, what),
    attitude: int(o, 'attitude', 0, what),
    buddies: slots(o, 'buddies', NO_RELATION, what),
    hated: slots(o, 'hated', NO_RELATION, what),
    gains: NO_GAINS,
    needForSleep: int(o, 'needForSleep', DEFAULT_NEED_FOR_SLEEP, what),
    town: 0,
    townAttachment: 0,
    mercOpinion: opinions(o, what),
    sexist: int(o, 'sexist', 0, what),
    deathRate: int(o, 'deathRate', DEFAULT_DEATH_RATE, what),
    hatedTime,
    hatedCount: [...hatedTime],
    learnToHate: int(o, 'learnToHate', NO_RELATION, what),
    learnToHateTime,
    learnToHateCount: learnToHateTime,
    learnToLike: int(o, 'learnToLike', NO_RELATION, what),
    learnToLikeTime,
    learnToLikeCount: learnToLikeTime,
    timeTillNextHatedComplaint: 0,
    statChangeChances: new Array<number>(STAT_CHANGE_COUNTERS).fill(0),
    statChangeSuccesses: new Array<number>(STAT_CHANGE_COUNTERS).fill(0),
    reputationTolerance: int(o, 'reputationTolerance', DEFAULT_REPUTATION_TOLERANCE, what),
    armourAttractiveness: NO_ATTRACTIVENESS,
    mainGunAttractiveness: NO_ATTRACTIVENESS,
    miscFlags: 0,
    miscFlags2: 0,
    miscFlags3: 0,
    dayBecomesAvailable: 0,
    totalDaysServed: 0,
    salary: int(o, 'salary', 0, what),
    weeklySalary: int(o, 'weeklySalary', 0, what),
    biWeeklySalary: int(o, 'biWeeklySalary', 0, what),
    medicalDeposit: int(o, 'medicalDeposit', 0, what),
    medicalDepositAmount: int(o, 'medicalDepositAmount', 0, what),
    optionalGearCost: 0,
    mercStatus: 0,
    balance: 0,
    daysOfMoraleHangover: 0,
    precedentQuoteSaid: 0,
    suspiciousDeath: 0,
    mercMercContractLength: 0,
    totalCostToDate: 0,
  };
}

export function parseStubProfiles(json: unknown, itemIndex: ItemIndex): MercProfile[] {
  const profiles: MercProfile[] = [];
  asArray(asObject(json, 'stub profiles').profiles, 'stub profiles.profiles').forEach((p, i) => {
    const profile = parseStubProfile(p, itemIndex, i);
    if (profiles[profile.id]) throw new FormatError(`stub profile id ${profile.id} appears twice`);
    profiles[profile.id] = profile;
  });
  return profiles;
}

export async function loadStubProfiles(read: ReadFile, itemIndex: ItemIndex): Promise<MercProfile[]> {
  const bytes = await read(STUB_PROFILES_PATH);
  if (!bytes) return [];
  return parseStubProfiles(JSON.parse(new TextDecoder().decode(bytes)), itemIndex);
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/policy/DefaultIMPPolicy.cc (imp.json), IMPPolicy.h IMPItemCondition; policy/DefaultGamePolicy.cc
// @src (imp.*, pablo_wont_steal); MERCListingModel.cc (mercs-MERC-listings.json with the Speck quotes); AIMListingModel.cc
// @src (mercs-AIM-listings.json, the listing order); DealerInventory.cc (bobby-ray-inventory-*.json);
// @src ShippingDestinationModel.cc (shipping-destinations.json); internals/enums.cc (inventory slot names);
// @src src/game/Laptop/Florist_Gallery.cc FLOR_GALLERY_NUMBER_FLORAL_IMAGES, DisplayFloralDescriptions (the price column of
// @src flowerdesc.edt read with sscanf "%hu").

import { u16 } from '../../core/int.ts';
import { FormatError } from '../binary/errors.ts';
import { decodeEdtRecord } from '../formats/edt.ts';
import type { ItemTable } from '../items/items.ts';
import { readLayered } from '../narrative/npc-records.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import { asArray, asBool, asInt, asObject, asString, type JsonObject } from './json-fields.ts';
import { parseJsoncBytes } from './jsonc.ts';
import { parseSectorId } from './sector-ids.ts';

export const LAPTOP_CONTENT_PATHS = {
  tables: 'tables/laptop.json',
  imp: 'externalized/imp.json',
  policy: 'externalized/game.json',
  mercListings: 'externalized/mercs-MERC-listings.json',
  aimListings: 'externalized/mercs-AIM-listings.json',
  profileInfo: 'externalized/mercs-profile-info.json',
  bobbyRayNew: 'externalized/bobby-ray-inventory-new.json',
  bobbyRayUsed: 'externalized/bobby-ray-inventory-used.json',
  destinations: 'externalized/shipping-destinations.json',
} as const;

export type LaptopContentSources = { readonly [K in keyof typeof LAPTOP_CONTENT_PATHS]: unknown };

export const FLORIST_GALLERY_TEXT_PATH = 'binarydata/flowerdesc.edt';
export const FLORIST_GALLERY_COLUMNS: readonly number[] = [80, 80, 320];
export const FLORIST_BOUQUETS = 10;
const BOUQUET_PRICE_COLUMN = 1;
const SCANF_UNSIGNED = /^\s*([+-]?)(\d+)/;

export type QuizList = 'skill' | 'attitude' | 'personality';
export type QuizEffect =
  | { readonly list: QuizList; readonly value: number }
  | { readonly list: 'skill'; readonly male: number; readonly female: number };

export type ImpConditionValue = number | string;
export type ImpCondition = readonly [ImpConditionValue, ImpConditionValue];

export interface ImpItemSet {
  readonly conditions: readonly ImpCondition[];
  readonly slot: number | null;
  readonly items: readonly number[];
}

export interface ImpVoice {
  readonly male: boolean;
  readonly profile: number;
}

export interface ImpPortrait {
  readonly male: boolean;
  readonly face: number;
  readonly skin: string;
  readonly hair: string;
  readonly bigBody: boolean;
  readonly eyes: readonly [number, number];
  readonly mouth: readonly [number, number];
}

export interface ImpContent {
  readonly codes: readonly string[];
  readonly startingLevel: number;
  readonly sendsProfileResultsEmail: boolean;
  readonly voices: readonly ImpVoice[];
  readonly portraits: readonly ImpPortrait[];
  readonly inventory: readonly ImpItemSet[];
  readonly maxAttributePoints: number;
  readonly minAttributePoints: number;
  readonly zeroAttributePointsBonus: number;
  readonly bonusAttributePoints: number;
  readonly maxCharacters: number;
  readonly pickSkillsDirectly: boolean;
}

export type SpeckQuoteType = 'ADVERTISE' | 'MERC_DEAD' | 'CROSS_SELL';

export interface SpeckListingQuote {
  readonly type: SpeckQuoteType;
  readonly quote: number;
  readonly profile?: number;
}

export interface MercListing {
  readonly index: number;
  readonly profile: number;
  readonly minTotalSpending: number;
  readonly minDays: number;
  readonly quotes: readonly SpeckListingQuote[];
}

export interface ShippingDestination {
  readonly locationId: number;
  readonly internalName: string;
  readonly rates: readonly [number, number, number];
  readonly flowersNextDayCost: number;
  readonly flowersWhenItGetsThereCost: number;
  readonly canDeliver: boolean;
  readonly isPrimary: boolean;
  readonly deliverySector: number | null;
  readonly deliverySectorZ: number;
  readonly gridNo: number;
  readonly emailOffset: number;
  readonly emailLength: number;
}

export interface TerroristInfo {
  readonly profile: number;
  readonly sectors: readonly (number | null)[];
}

export interface LaptopContent {
  readonly mail: Readonly<Record<string, number>>;
  readonly senders: Readonly<Record<string, number>>;
  readonly namedProfiles: Readonly<Record<string, number>>;
  readonly terrorists: readonly TerroristInfo[];
  readonly impQuiz: readonly (readonly (QuizEffect | null)[])[];
  readonly imp: ImpContent;
  readonly mercListings: readonly MercListing[];
  readonly aimListings: readonly number[];
  readonly bobbyRayNew: ReadonlyMap<number, number>;
  readonly bobbyRayUsed: ReadonlyMap<number, number>;
  readonly destinations: readonly ShippingDestination[];
  readonly pabloWontSteal: boolean;
  readonly profileIds: ReadonlyMap<string, number>;
  readonly bouquetPrices: readonly number[];
}

const INVENTORY_SLOTS: Readonly<Record<string, number>> = {
  HELMET: 0,
  VEST: 1,
  LEGS: 2,
  HEAD1: 3,
  HEAD2: 4,
  HANDPOS: 5,
  SECONDHAND: 6,
  BIGPOCK1: 7,
  BIGPOCK2: 8,
  BIGPOCK3: 9,
  BIGPOCK4: 10,
  SMALLPOCK1: 11,
  SMALLPOCK2: 12,
  SMALLPOCK3: 13,
  SMALLPOCK4: 14,
  SMALLPOCK5: 15,
  SMALLPOCK6: 16,
  SMALLPOCK7: 17,
  SMALLPOCK8: 18,
};
const DEFAULT_IMP_POLICY = {
  maxAttributePoints: 85,
  minAttributePoints: 35,
  zeroAttributePointsBonus: 15,
  bonusAttributePoints: 40,
  maxCharacters: 1,
  pickSkillsDirectly: false,
};
const MALE = 'MALE';

function intOr(o: JsonObject, key: string, fallback: number, what: string): number {
  return o[key] === undefined ? fallback : asInt(o[key], `${what}.${key}`);
}

function boolOr(o: JsonObject, key: string, fallback: boolean, what: string): boolean {
  return o[key] === undefined ? fallback : asBool(o[key], `${what}.${key}`);
}

function pair(value: unknown, what: string): readonly [number, number] {
  const a = asArray(value, what);
  return [asInt(a[0], `${what}[0]`), asInt(a[1], `${what}[1]`)];
}

function itemIndex(items: ItemTable, name: string, what: string): number {
  const def = items.byName.get(name);
  if (!def) throw new FormatError(`${what}: unknown item ${name}`);
  return def.index;
}

function conditionValue(value: unknown, what: string): ImpConditionValue {
  return typeof value === 'number' ? asInt(value, what) : asString(value, what);
}

function impItemSets(json: unknown, items: ItemTable): ImpItemSet[] {
  return asArray(json, 'imp.inventory').map((v, i) => {
    const what = `imp.inventory[${i}]`;
    const o = asObject(v, what);
    const raw = o.conditions === undefined ? [] : asArray(o.conditions, `${what}.conditions`);
    if (raw.length % 2 !== 0) throw new FormatError(`${what}: conditions need pairs`);
    const conditions: ImpCondition[] = [];
    for (let k = 0; k < raw.length; k += 2)
      conditions.push([conditionValue(raw[k], `${what}.conditions[${k}]`), conditionValue(raw[k + 1], `${what}.conditions[${k + 1}]`)]);
    const slotName = o.slot === undefined ? null : asString(o.slot, `${what}.slot`);
    const slot = slotName === null ? null : (INVENTORY_SLOTS[slotName] ?? null);
    if (slotName !== null && slot === null) throw new FormatError(`${what}: unknown slot ${slotName}`);
    return {
      conditions,
      slot,
      items: asArray(o.items, `${what}.items`).map((n, k) => itemIndex(items, asString(n, `${what}.items[${k}]`), what)),
    };
  });
}

function parseImpContent(impJson: unknown, policyJson: unknown, items: ItemTable): ImpContent {
  const o = asObject(impJson, 'imp');
  const policy = asObject(policyJson, 'game policy');
  const p = policy.imp === undefined ? {} : asObject(policy.imp, 'game policy.imp');
  return {
    codes: asArray(o.activation_codes, 'imp.activation_codes').map((c, i) => asString(c, `imp.activation_codes[${i}]`)),
    startingLevel: asInt(o.starting_level, 'imp.starting_level'),
    sendsProfileResultsEmail: boolOr(o, 'send_profile_results_email', true, 'imp'),
    voices: asArray(o.voices, 'imp.voices').map((v, i) => {
      const e = asObject(v, `imp.voices[${i}]`);
      return { male: asString(e.gender, `imp.voices[${i}].gender`) === MALE, profile: asInt(e.profile, `imp.voices[${i}].profile`) };
    }),
    portraits: asArray(o.portraits, 'imp.portraits').map((v, i) => {
      const what = `imp.portraits[${i}]`;
      const e = asObject(v, what);
      return {
        male: asString(e.gender, `${what}.gender`) === MALE,
        face: asInt(e.face, `${what}.face`),
        skin: asString(e.skin, `${what}.skin`),
        hair: asString(e.hair, `${what}.hair`),
        bigBody: boolOr(e, 'big_body', false, what),
        eyes: pair(e.eyes, `${what}.eyes`),
        mouth: pair(e.mouth, `${what}.mouth`),
      };
    }),
    inventory: impItemSets(o.inventory, items),
    maxAttributePoints: intOr(p, 'max_attribute_points', DEFAULT_IMP_POLICY.maxAttributePoints, 'imp'),
    minAttributePoints: intOr(p, 'min_attribute_points', DEFAULT_IMP_POLICY.minAttributePoints, 'imp'),
    zeroAttributePointsBonus: intOr(p, 'zero_attribute_points_bonus', DEFAULT_IMP_POLICY.zeroAttributePointsBonus, 'imp'),
    bonusAttributePoints: intOr(p, 'bonus_attribute_points', DEFAULT_IMP_POLICY.bonusAttributePoints, 'imp'),
    maxCharacters: intOr(p, 'max_characters', DEFAULT_IMP_POLICY.maxCharacters, 'imp'),
    pickSkillsDirectly: boolOr(p, 'pick_skills_directly', DEFAULT_IMP_POLICY.pickSkillsDirectly, 'imp'),
  };
}

function parseProfileIds(json: unknown): Map<string, number> {
  const ids = new Map<string, number>();
  asArray(json, 'mercs profile info').forEach((v, i) => {
    const o = asObject(v, `mercs profile info[${i}]`);
    ids.set(asString(o.internalName, `mercs profile info[${i}].internalName`), asInt(o.profileID, `mercs profile info[${i}].profileID`));
  });
  return ids;
}

function profileId(ids: ReadonlyMap<string, number>, value: unknown, what: string): number {
  if (typeof value === 'number') return asInt(value, what);
  const name = asString(value, what);
  const id = ids.get(name);
  if (id === undefined) throw new FormatError(`${what}: unknown profile ${name}`);
  return id;
}

const SPECK_QUOTE_TYPES: readonly SpeckQuoteType[] = ['ADVERTISE', 'MERC_DEAD', 'CROSS_SELL'];

function speckQuote(value: unknown, ids: ReadonlyMap<string, number>, what: string): SpeckListingQuote {
  const o = asObject(value, what);
  const type = asString(o.type, `${what}.type`) as SpeckQuoteType;
  if (!SPECK_QUOTE_TYPES.includes(type)) throw new FormatError(`${what}.type: unknown Speck quote type ${type}`);
  const quote = asInt(o.quoteID, `${what}.quoteID`);
  return o.profile === undefined ? { type, quote } : { type, quote, profile: profileId(ids, o.profile, `${what}.profile`) };
}

function parseMercListings(json: unknown, ids: ReadonlyMap<string, number>): MercListing[] {
  return asArray(json, 'mercs MERC listings').map((v, index) => {
    const what = `mercs MERC listings[${index}]`;
    const o = asObject(v, what);
    const quotes = o.quotes === undefined ? [] : asArray(o.quotes, `${what}.quotes`);
    return {
      index,
      profile: profileId(ids, o.profile, `${what}.profile`),
      minTotalSpending: intOr(o, 'minTotalSpending', 0, what),
      minDays: intOr(o, 'minDays', 0, what),
      quotes: quotes.map((q, k) => speckQuote(q, ids, `${what}.quotes[${k}]`)),
    };
  });
}

function parseAimListings(json: unknown, ids: ReadonlyMap<string, number>): number[] {
  return asArray(json, 'mercs AIM listings').map((v, index) =>
    profileId(ids, asObject(v, `mercs AIM listings[${index}]`).profile, `mercs AIM listings[${index}].profile`),
  );
}

function parseStoreMaxima(json: unknown, items: ItemTable, what: string): Map<number, number> {
  const maxima = new Map<number, number>();
  for (const [name, value] of Object.entries(asObject(json, what)))
    maxima.set(itemIndex(items, name, what), asInt(value, `${what}.${name}`));
  return maxima;
}

function parseDestinations(json: unknown): ShippingDestination[] {
  return asArray(json, 'shipping destinations').map((v, i) => {
    const what = `shipping destinations[${i}]`;
    const o = asObject(v, what);
    const sector = o.deliverySector === undefined ? null : parseSectorId(asString(o.deliverySector, `${what}.deliverySector`));
    return {
      locationId: asInt(o.locationId, `${what}.locationId`),
      internalName: asString(o.internalName, `${what}.internalName`),
      rates: [
        asInt(o.chargeRateOverNight, `${what}.chargeRateOverNight`),
        asInt(o.chargeRate2Days, `${what}.chargeRate2Days`),
        asInt(o.chargeRateStandard, `${what}.chargeRateStandard`),
      ],
      flowersNextDayCost: asInt(o.flowersNextDayDeliveryCost, `${what}.flowersNextDayDeliveryCost`),
      flowersWhenItGetsThereCost: asInt(o.flowersWhenItGetsThereCost, `${what}.flowersWhenItGetsThereCost`),
      canDeliver: boolOr(o, 'canDeliver', false, what),
      isPrimary: boolOr(o, 'isPrimary', false, what),
      deliverySector: sector,
      deliverySectorZ: intOr(o, 'deliverySectorZ', 0, what),
      gridNo: intOr(o, 'deliverySectorGridNo', 0, what),
      emailOffset: intOr(o, 'emailOffset', 0, what),
      emailLength: intOr(o, 'emailLength', 0, what),
    };
  });
}

function quizEffect(value: unknown, what: string): QuizEffect | null {
  if (value === null) return null;
  const o = asObject(value, what);
  const list = asString(o.list, `${what}.list`) as QuizList;
  if (o.male !== undefined) return { list: 'skill', male: asInt(o.male, `${what}.male`), female: asInt(o.female, `${what}.female`) };
  return { list, value: asInt(o.value, `${what}.value`) };
}

function numberRecord(value: unknown, what: string): Record<string, number> {
  return Object.fromEntries(Object.entries(asObject(value, what)).map(([k, v]) => [k, asInt(v, `${what}.${k}`)]));
}

export function scanUnsignedShort(text: string): number {
  const m = SCANF_UNSIGNED.exec(text);
  if (!m) return 0;
  const value = Number(m[2]);
  return u16(m[1] === '-' ? -value : value);
}

export function parseBouquetPrices(bytes: Uint8Array): number[] {
  return Array.from({ length: FLORIST_BOUQUETS }, (_, row) =>
    scanUnsignedShort(decodeEdtRecord(bytes, row, FLORIST_GALLERY_COLUMNS)?.[BOUQUET_PRICE_COLUMN] ?? ''),
  );
}

export function parseLaptopContent(
  sources: LaptopContentSources,
  items: ItemTable,
  bouquetPrices: readonly number[] = new Array<number>(FLORIST_BOUQUETS).fill(0),
): LaptopContent {
  const tables = asObject(sources.tables, 'laptop tables');
  const profileIds = parseProfileIds(sources.profileInfo);
  const policy = asObject(sources.policy, 'game policy');
  return {
    mail: numberRecord(tables.mail, 'laptop tables.mail'),
    senders: numberRecord(tables.senders, 'laptop tables.senders'),
    namedProfiles: numberRecord(tables.profiles, 'laptop tables.profiles'),
    terrorists: asArray(tables.terrorists, 'laptop tables.terrorists').map((t, i) => {
      const o = asObject(t, `laptop tables.terrorists[${i}]`);
      return {
        profile: asInt(o.profile, `laptop tables.terrorists[${i}].profile`),
        sectors: asArray(o.sectors, `laptop tables.terrorists[${i}].sectors`).map((v, k) =>
          v === null ? null : parseSectorId(asString(v, `laptop tables.terrorists[${i}].sectors[${k}]`)),
        ),
      };
    }),
    impQuiz: asArray(tables.impQuiz, 'laptop tables.impQuiz').map((q, i) =>
      asArray(q, `laptop tables.impQuiz[${i}]`).map((a, k) => quizEffect(a, `laptop tables.impQuiz[${i}][${k}]`)),
    ),
    imp: parseImpContent(sources.imp, sources.policy, items),
    mercListings: parseMercListings(sources.mercListings, profileIds),
    aimListings: parseAimListings(sources.aimListings, profileIds),
    bobbyRayNew: parseStoreMaxima(sources.bobbyRayNew, items, 'bobby ray inventory new'),
    bobbyRayUsed: parseStoreMaxima(sources.bobbyRayUsed, items, 'bobby ray inventory used'),
    destinations: parseDestinations(sources.destinations),
    pabloWontSteal: boolOr(policy, 'pablo_wont_steal', false, 'game policy'),
    profileIds,
    bouquetPrices,
  };
}

export async function loadLaptopContent(read: ReadFile, items: ItemTable): Promise<LaptopContent> {
  const keys = Object.keys(LAPTOP_CONTENT_PATHS) as (keyof typeof LAPTOP_CONTENT_PATHS)[];
  const values = await Promise.all(
    keys.map(async (key) => {
      const bytes = await read(LAPTOP_CONTENT_PATHS[key]);
      if (!bytes) throw new FormatError(`missing ${LAPTOP_CONTENT_PATHS[key]}`);
      return parseJsoncBytes(bytes);
    }),
  );
  const gallery = await readLayered(read, FLORIST_GALLERY_TEXT_PATH);
  if (!gallery) throw new FormatError(`missing ${FLORIST_GALLERY_TEXT_PATH}`);
  return parseLaptopContent(
    Object.fromEntries(keys.map((key, i) => [key, values[i]])) as LaptopContentSources,
    items,
    parseBouquetPrices(gallery),
  );
}

export function primaryDestination(content: LaptopContent): ShippingDestination | undefined {
  return content.destinations.find((d) => d.isPrimary);
}

export function mailOffset(content: LaptopContent, name: string): number {
  const offset = content.mail[name];
  if (offset === undefined) throw new FormatError(`unknown mail ${name}`);
  return offset;
}

const NUM_PROFILES = 200;
const STUB_TEXT_PREFIX = 'stubs/';
const MERC_TYPE_RPC = 4;
const MERC_TYPE_NPC = 5;

function edtName(id: number): string {
  return `${String(id).padStart(3, '0')}.edt`;
}

export function dialogueProfiles(
  exists: (path: string) => boolean,
  mercTypes: ReadonlyMap<number, number>,
  content: Pick<LaptopContent, 'namedProfiles'>,
  stubbed = false,
): Set<number> {
  const herve = content.namedProfiles.HERVE ?? -1;
  const carlo = content.namedProfiles.CARLO ?? -1;
  const found = new Set<number>();
  for (let id = 0; id < NUM_PROFILES; id++) {
    const type = mercTypes.get(id);
    const npc = type === MERC_TYPE_RPC || type === MERC_TYPE_NPC;
    const file = npc ? `npcdata/${edtName(id >= herve && id <= carlo ? herve : id)}` : `mercedt/${edtName(id)}`;
    if (exists(file) || (stubbed && exists(`${STUB_TEXT_PREFIX}${file}`))) found.add(id);
  }
  return found;
}

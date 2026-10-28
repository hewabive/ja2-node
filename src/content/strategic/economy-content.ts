// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/strategic/MineModel.cc (strategic-mines.json); src/externalized/policy/DefaultGamePolicy.cc
// @src (starting_cash_*, enable_stat_healing); src/externalized/mercs/MercProfileInfo.cc (type). Tables in data/tables
// @src from tools/transcribe/town-loyalty.ts and head-miners.ts.

import { FormatError } from '../binary/errors.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import { asArray, asBool, asInt, asObject, asString, intArray, optionalBool } from './json-fields.ts';
import { parseJsoncBytes } from './jsonc.ts';
import type { Town } from './map-tables.ts';
import { parseSectorId } from './sector-ids.ts';

export const ECONOMY_CONTENT_PATHS = {
  mines: 'externalized/strategic-mines.json',
  policy: 'externalized/game.json',
  profileInfo: 'externalized/mercs-profile-info.json',
  loyalty: 'tables/town-loyalty.json',
  headMiners: 'tables/head-miners.json',
} as const;

export const MineType = { SILVER: 0, GOLD: 1 } as const;
export const MercType = { NOT_USED: 0, AIM: 1, MERC: 2, IMP: 3, RPC: 4, NPC: 5, VEHICLE: 6 } as const;

export interface MineSectorRef {
  readonly sector: number;
  readonly z: number;
}

export interface MineDef {
  readonly mineId: number;
  readonly entranceSector: number;
  readonly associatedTownId: number;
  readonly mineType: number;
  readonly headMinerAssigned: boolean;
  readonly noDepletion: boolean;
  readonly delayDepletion: boolean;
  readonly minimumMineProduction: number;
  readonly mineSectors: readonly MineSectorRef[];
}

export interface GlobalLoyaltyEventDef {
  readonly name: string;
  readonly amount: number;
}

export interface LoyaltyTables {
  readonly gainPointsPerLoyaltyPoint: number;
  readonly rebelSentiment: readonly number[];
  readonly usesLoyalty: readonly boolean[];
  readonly civilianMurderCost: readonly number[];
  readonly globalEvents: readonly GlobalLoyaltyEventDef[];
  readonly amounts: Readonly<Record<string, number>>;
}

export interface HeadMinerDef {
  readonly name: string;
  readonly profile: number;
  readonly quotes: readonly number[];
}

export interface HeadMinerTables {
  readonly headMiners: readonly HeadMinerDef[];
  readonly randomMinerProfiles: readonly number[];
}

export interface EconomyPolicy {
  readonly startingCash: readonly [number, number, number];
  readonly enableStatHealing: boolean;
}

export interface EconomyContent {
  readonly mines: readonly MineDef[];
  readonly loyalty: LoyaltyTables;
  readonly headMiners: HeadMinerTables;
  readonly policy: EconomyPolicy;
  readonly mercTypes: ReadonlyMap<number, number>;
}

export type EconomyContentSources = { readonly [K in keyof typeof ECONOMY_CONTENT_PATHS]: unknown };

const MERC_TYPE_NAMES: Readonly<Record<string, number>> = {
  NOT_USED: MercType.NOT_USED,
  AIM: MercType.AIM,
  MERC: MercType.MERC,
  IMP: MercType.IMP,
  RPC: MercType.RPC,
  NPC: MercType.NPC,
  VEHICLE: MercType.VEHICLE,
};
const DEFAULT_STARTING_CASH: readonly [number, number, number] = [45000, 35000, 30000];

function townIdByName(towns: readonly Town[], name: string): number {
  const town = towns.find((t) => t.internalName === name);
  if (!town) throw new FormatError(`strategic mines: unknown town ${name}`);
  return town.townId;
}

export function parseMines(json: unknown, towns: readonly Town[]): MineDef[] {
  return asArray(json, 'mines').map((v, mineId) => {
    const what = `mines[${mineId}]`;
    const o = asObject(v, what);
    const type = asString(o.mineType, `${what}.mineType`);
    if (type !== 'GOLD_MINE' && type !== 'SILVER_MINE') throw new FormatError(`${what}: unknown mine type ${type}`);
    const deprecatedTown = o.associatedTownId === undefined ? 0 : asInt(o.associatedTownId, `${what}.associatedTownId`);
    return {
      mineId,
      entranceSector: parseSectorId(asString(o.entranceSector, `${what}.entranceSector`)),
      associatedTownId: deprecatedTown || townIdByName(towns, asString(o.associatedTown, `${what}.associatedTown`)),
      mineType: type === 'GOLD_MINE' ? MineType.GOLD : MineType.SILVER,
      headMinerAssigned: optionalBool(o, 'headMinerAssigned', what),
      noDepletion: optionalBool(o, 'noDepletion', what),
      delayDepletion: optionalBool(o, 'delayDepletion', what),
      minimumMineProduction: asInt(o.minimumMineProduction, `${what}.minimumMineProduction`),
      mineSectors: asArray(o.mineSectors, `${what}.mineSectors`).map((s, k) => {
        const pair = asArray(s, `${what}.mineSectors[${k}]`);
        return { sector: parseSectorId(asString(pair[0], `${what}.mineSectors[${k}]`)), z: asInt(pair[1], `${what}.mineSectors[${k}]`) };
      }),
    };
  });
}

function parseLoyaltyTables(json: unknown): LoyaltyTables {
  const o = asObject(json, 'town loyalty');
  const amounts = asObject(o.amounts, 'town loyalty.amounts');
  return {
    gainPointsPerLoyaltyPoint: asInt(o.gainPointsPerLoyaltyPoint, 'gainPointsPerLoyaltyPoint'),
    rebelSentiment: intArray(o.rebelSentiment, 'rebelSentiment'),
    usesLoyalty: asArray(o.usesLoyalty, 'usesLoyalty').map((v, i) => asBool(v, `usesLoyalty[${i}]`)),
    civilianMurderCost: intArray(o.civilianMurderCost, 'civilianMurderCost'),
    globalEvents: asArray(o.globalEvents, 'globalEvents').map((v, i) => {
      const e = asObject(v, `globalEvents[${i}]`);
      return { name: asString(e.name, `globalEvents[${i}].name`), amount: asInt(e.amount, `globalEvents[${i}].amount`) };
    }),
    amounts: Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, asInt(v, `amounts.${k}`)])),
  };
}

function parseHeadMinerTables(json: unknown): HeadMinerTables {
  const o = asObject(json, 'head miners');
  return {
    headMiners: asArray(o.headMiners, 'headMiners').map((v, i) => {
      const m = asObject(v, `headMiners[${i}]`);
      return {
        name: asString(m.name, `headMiners[${i}].name`),
        profile: asInt(m.profile, `headMiners[${i}].profile`),
        quotes: intArray(m.quotes, `headMiners[${i}].quotes`),
      };
    }),
    randomMinerProfiles: intArray(o.randomMinerProfiles, 'randomMinerProfiles'),
  };
}

function parseEconomyPolicy(json: unknown): EconomyPolicy {
  const o = asObject(json, 'game policy');
  const cash = (key: string, fallback: number) => (o[key] === undefined ? fallback : asInt(o[key], key));
  return {
    startingCash: [
      cash('starting_cash_easy', DEFAULT_STARTING_CASH[0]),
      cash('starting_cash_medium', DEFAULT_STARTING_CASH[1]),
      cash('starting_cash_hard', DEFAULT_STARTING_CASH[2]),
    ],
    enableStatHealing: o.enable_stat_healing === undefined ? false : asBool(o.enable_stat_healing, 'enable_stat_healing'),
  };
}

function parseMercTypes(json: unknown): Map<number, number> {
  const types = new Map<number, number>();
  asArray(json, 'mercs profile info').forEach((v, i) => {
    const o = asObject(v, `mercs profile info[${i}]`);
    const name = asString(o.type, `mercs profile info[${i}].type`);
    const type = MERC_TYPE_NAMES[name];
    if (type === undefined) throw new FormatError(`mercs profile info[${i}]: unknown type ${name}`);
    types.set(asInt(o.profileID, `mercs profile info[${i}].profileID`), type);
  });
  return types;
}

export function parseEconomyContent(sources: EconomyContentSources, towns: readonly Town[]): EconomyContent {
  return {
    mines: parseMines(sources.mines, towns),
    loyalty: parseLoyaltyTables(sources.loyalty),
    headMiners: parseHeadMinerTables(sources.headMiners),
    policy: parseEconomyPolicy(sources.policy),
    mercTypes: parseMercTypes(sources.profileInfo),
  };
}

export async function loadEconomyContent(read: ReadFile, towns: readonly Town[]): Promise<EconomyContent> {
  const keys = Object.keys(ECONOMY_CONTENT_PATHS) as (keyof typeof ECONOMY_CONTENT_PATHS)[];
  const values = await Promise.all(
    keys.map(async (key) => {
      const bytes = await read(ECONOMY_CONTENT_PATHS[key]);
      if (!bytes) throw new FormatError(`missing ${ECONOMY_CONTENT_PATHS[key]}`);
      return parseJsoncBytes(bytes);
    }),
  );
  return parseEconomyContent(Object.fromEntries(keys.map((key, i) => [key, values[i]])) as EconomyContentSources, towns);
}

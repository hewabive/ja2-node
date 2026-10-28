// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/externalized/policy/DefaultGamePolicy.cc (squad_size, campaign.start_sector, start_sector_revealed, merc_online_*,
// @src unhired_merc_deaths_*);
// @src src/externalized/VehicleModel.cc; src/game/Strategic/Campaign_Types.h VehicleMovementType.

import { FormatError } from '../binary/errors.ts';
import { asArray, asBool, asInt, asObject, asString } from './json-fields.ts';
import { parseSectorId } from './sector-ids.ts';

export const TransportMask = { FOOT: 0x01, CAR: 0x02, TRUCK: 0x04, TRACKED: 0x08, AIR: 0x10 } as const;

const DEFAULT_SQUAD_SIZE = 6;
const DEFAULT_START_SECTOR = 'A9';
const DEFAULT_MERC_ONLINE_MIN_DAYS = 1;
const DEFAULT_MERC_ONLINE_MAX_DAYS = 2;
const DEFAULT_UNHIRED_MERC_DEATHS: readonly [number, number, number] = [1, 2, 3];
const UNHIRED_MERC_DEATHS_KEYS = ['unhired_merc_deaths_easy', 'unhired_merc_deaths_medium', 'unhired_merc_deaths_hard'] as const;

export interface StrategicPolicy {
  readonly squadSize: number;
  readonly startSector: number;
  readonly startSectorRevealed: boolean;
  readonly mercOnlineMinDays: number;
  readonly mercOnlineMaxDays: number;
  readonly unhiredMercDeaths: readonly [number, number, number];
}

export interface VehicleType {
  readonly profile: string;
  readonly movementType: number;
  readonly seats: number;
}

export function parseStrategicPolicy(json: unknown): StrategicPolicy {
  const o = asObject(json, 'game policy');
  const campaign = o.campaign === undefined ? {} : asObject(o.campaign, 'game policy.campaign');
  const start = campaign.start_sector === undefined ? '' : asString(campaign.start_sector, 'campaign.start_sector');
  return {
    squadSize: o.squad_size === undefined ? DEFAULT_SQUAD_SIZE : asInt(o.squad_size, 'squad_size'),
    startSector: parseSectorId(start || DEFAULT_START_SECTOR),
    startSectorRevealed:
      campaign.start_sector_revealed === undefined ? false : asBool(campaign.start_sector_revealed, 'start_sector_revealed'),
    mercOnlineMinDays:
      o.merc_online_min_days === undefined ? DEFAULT_MERC_ONLINE_MIN_DAYS : asInt(o.merc_online_min_days, 'merc_online_min_days'),
    mercOnlineMaxDays:
      o.merc_online_max_days === undefined ? DEFAULT_MERC_ONLINE_MAX_DAYS : asInt(o.merc_online_max_days, 'merc_online_max_days'),
    unhiredMercDeaths: unhiredMercDeaths(o),
  };
}

function unhiredMercDeaths(o: Record<string, unknown>): readonly [number, number, number] {
  const [easy, medium, hard] = UNHIRED_MERC_DEATHS_KEYS.map((key, k) =>
    o[key] === undefined ? (DEFAULT_UNHIRED_MERC_DEATHS[k] ?? 0) : asInt(o[key], key),
  );
  return [easy ?? 0, medium ?? 0, hard ?? 0];
}

function movementType(value: unknown, what: string): number {
  const name = asString(value, what);
  const mask = TransportMask[name as keyof typeof TransportMask];
  if (mask === undefined) throw new FormatError(`${what}: unknown movement type ${name}`);
  return mask;
}

export function parseVehicleTypes(json: unknown): VehicleType[] {
  return asArray(json, 'vehicles').map((v, i) => {
    const what = `vehicles[${i}]`;
    const o = asObject(v, what);
    return {
      profile: asString(o.profile, `${what}.profile`),
      movementType: movementType(o.movementType, `${what}.movementType`),
      seats: asInt(o.seats, `${what}.seats`),
    };
  });
}

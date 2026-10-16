// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/externalized/policy/DefaultGamePolicy.cc (squad_size, campaign.start_sector, start_sector_revealed);
// @src src/externalized/VehicleModel.cc; src/game/Strategic/Campaign_Types.h VehicleMovementType. See docs/16 §1.7.

import { FormatError } from '../binary/errors.ts';
import { asArray, asBool, asInt, asObject, asString } from './json-fields.ts';
import { parseSectorId } from './sector-ids.ts';

export const TransportMask = { FOOT: 0x01, CAR: 0x02, TRUCK: 0x04, TRACKED: 0x08, AIR: 0x10 } as const;

const DEFAULT_SQUAD_SIZE = 6;
const DEFAULT_START_SECTOR = 'A9';

export interface StrategicPolicy {
  readonly squadSize: number;
  readonly startSector: number;
  readonly startSectorRevealed: boolean;
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
  };
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

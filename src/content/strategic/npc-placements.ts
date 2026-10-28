// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/strategic/NpcPlacementModel.cc deserialize; DefaultContentManager.cc listNpcPlacements
// @src (a std::map keyed by profile id).

import { FormatError } from '../binary/errors.ts';
import { asArray, asBool, asInt, asObject, asString, optionalBool } from './json-fields.ts';
import { parseSectorId } from './sector-ids.ts';

export const NPC_PLACEMENTS_PATH = 'externalized/strategic-map-npc-placements.json';
export const PROFILE_INFO_PATH = 'externalized/mercs-profile-info.json';

export interface NpcPlacement {
  readonly profile: number;
  readonly sectors: readonly number[];
  readonly placedAtStart: boolean;
  readonly useAlternateMap: boolean;
  readonly sciFiOnly: boolean;
}

function profileIdsByName(json: unknown): Map<string, number> {
  const ids = new Map<string, number>();
  asArray(json, 'mercs profile info').forEach((v, i) => {
    const o = asObject(v, `mercs profile info[${i}]`);
    ids.set(asString(o.internalName, `mercs profile info[${i}].internalName`), asInt(o.profileID, `mercs profile info[${i}].profileID`));
  });
  return ids;
}

export function parseNpcPlacements(json: unknown, profileInfo: unknown): NpcPlacement[] {
  const ids = profileIdsByName(profileInfo);
  const byProfile = new Map<number, NpcPlacement>();
  asArray(json, 'npc placements').forEach((v, i) => {
    const what = `npc placements[${i}]`;
    const o = asObject(v, what);
    const name = asString(o.profile, `${what}.profile`);
    const profile = ids.get(name);
    if (profile === undefined) throw new FormatError(`${what}: unknown profile ${name}`);
    byProfile.set(profile, {
      profile,
      sectors: asArray(o.sectors, `${what}.sectors`).map((s) => parseSectorId(asString(s, `${what}.sectors`))),
      placedAtStart: asBool(o.placedAtStart, `${what}.placedAtStart`),
      useAlternateMap: optionalBool(o, 'useAlternateMap', what),
      sciFiOnly: optionalBool(o, 'sciFiOnly', what),
    });
  });
  return [...byProfile.values()].sort((a, b) => a.profile - b.profile);
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-29. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Movement.cc WildernessSectorWithAllProfiledNPCsNotSpokenWith

import { MercType } from '../../../content/strategic/economy-content.ts';
import type { Sector } from '../../../content/strategic/sector-ids.ts';
import { ProfileFlag } from '../../narrative/narrative-ids.ts';
import { isProfileDead, type ProfileProgress } from '../../tactical/profiles.ts';
import { isThisSectorASamSector, townIdOfSector } from '../map/control.ts';
import { BLANK_SECTOR } from './constants.ts';
import type { StrategicContext } from './ports.ts';

export type NpcOfNote = Pick<ProfileProgress, 'mercStatus' | 'life' | 'sectorX' | 'sectorY' | 'sectorZ' | 'lastDateSpokenTo' | 'miscFlags'>;

export interface ListedProfile {
  readonly type: number;
  readonly profile: NpcOfNote;
}

const MET_FLAGS = ProfileFlag.RECRUITED | ProfileFlag.EPCACTIVE;
const NEVER_OF_NOTE: ReadonlySet<number> = new Set([MercType.AIM, MercType.MERC, MercType.IMP, MercType.VEHICLE]);

function wilderness(ctx: StrategicContext, s: Sector): boolean {
  return s.z === 0 && townIdOfSector(ctx, s) === BLANK_SECTOR && !isThisSectorASamSector(ctx, s);
}

function npcStandingIn(listed: ListedProfile, s: Sector): NpcOfNote | null {
  const p = listed.profile;
  if (NEVER_OF_NOTE.has(listed.type) || isProfileDead(p) || p.life <= 0) return null;
  return p.sectorX === s.x && p.sectorY === s.y && p.sectorZ === s.z ? p : null;
}

function alreadyMet(p: NpcOfNote): boolean {
  return p.lastDateSpokenTo !== 0 || (p.miscFlags & MET_FLAGS) !== 0;
}

export function wildernessSectorWithAllProfiledNpcsNotSpokenWith(
  ctx: StrategicContext,
  s: Sector,
  profiles: Iterable<ListedProfile>,
): boolean {
  if (!wilderness(ctx, s)) return false;
  let foundSomebody = false;
  for (const listed of profiles) {
    const p = npcStandingIn(listed, s);
    if (!p) continue;
    if (alreadyMet(p)) return false;
    foundSomebody = true;
  }
  return foundSomebody;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc TurnOnSectorLocator (the speaker's soldier's sector, else Skyrider's
// @src helicopter once he is set up, which the map screen leaves out while it shows the aircraft, else the profile's
// @src sector), called by Tactical/Faces.cc SetFaceTalking as a line starts.

import { type Sector, sectorShortString } from '../../content/strategic/sector-ids.ts';
import { SKYRIDER } from '../strategic/forces/helicopter.ts';

export interface SpeakerLocator {
  readonly sector: string;
  readonly helicopter?: true;
}

export interface SpeakerLocatorSources {
  soldierSector(profile: number): Sector | null;
  helicopterSector(): Sector | null;
  profileSector(profile: number): Sector | null;
}

export function sectorLabel(s: Sector): string {
  return s.z ? `${sectorShortString(s)}-${s.z}` : sectorShortString(s);
}

export function speakerLocator(sources: SpeakerLocatorSources, profile: number): SpeakerLocator | null {
  const soldier = sources.soldierSector(profile);
  if (soldier) return { sector: sectorLabel(soldier) };
  const helicopter = profile === SKYRIDER ? sources.helicopterSector() : null;
  if (helicopter) return { sector: sectorLabel(helicopter), helicopter: true };
  const own = sources.profileSector(profile);
  return own ? { sector: sectorLabel(own) } : null;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadScreen.cc DisplaySaveGameEntry (the location is GetSectorIDString, not detailed, with
// @src gfGettingNameFromSaveLoadScreen: any underground level of the list is named, visited or not), EnterSaveLoadScreen
// @src (BuildUndergroundSectorInfoList when no game is loaded); src/game/Strategic/StrategicMap_Secrets.cc IsSecretFoundAt
// @src (every secret counts as found on the load screen; the save screen reads the running game's).

import { type Sector, sectorId } from '../../../content/strategic/sector-ids.ts';
import type { PlayerView } from '../../../protocol/view.ts';
import type { SectorName } from '../../saves/save-rows.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { foundSecrets, type MapFacts, sectorIdString } from '../map/facts.ts';
import type { SaveLoadMode } from './save-load.ts';

function secretsFoundFor(facts: MapFacts, mode: SaveLoadMode, view: PlayerView | null): ReadonlySet<number> {
  const strategic = view?.strategic;
  if (mode === 'save' && strategic) return foundSecrets(strategic.secretsFound);
  return new Set(facts.secrets.map((secret) => secret.sector));
}

export function saveLocationName(facts: MapFacts, text: UiTextService, mode: SaveLoadMode, view: PlayerView | null): SectorName {
  const found = secretsFoundFor(facts, mode, view);
  const listedUnderground = (s: Sector) => facts.underground.some((u) => u.sector === sectorId(s) && u.z === s.z);
  return (s) => sectorIdString(facts, text, found, s, false, listedUnderground);
}

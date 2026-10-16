// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Quests.cc LoadQuestInfoFromSavedGameFile; SaveLoadGame.cc LoadGeneralInfo (the narrative globals).
// @src See docs/25 §0, docs/14 §10.

import type { SaveGame } from '../../../content/formats/savegame.ts';
import type { StrategicState } from '../state.ts';
import { importNarrative, importNarrativeGlobals } from './facts.ts';

export function importNarrativeSave(state: StrategicState, save: SaveGame): void {
  importNarrative(state.narrative, save.facts, save.quests);
  const g = save.generalInfo.narrative;
  importNarrativeGlobals(state.narrative, g);
  state.terrorists.count = g.numTerrorists;
}

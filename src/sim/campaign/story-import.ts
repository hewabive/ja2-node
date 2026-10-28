// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc LoadGeneralInfo (gCurrentMeanwhileDef, gfMeanwhileTryingToStart, gfInMeanwhile,
// @src sWorldSectorLocationOfFirstBattle), LoadMeanwhileDefsFromSaveGameFile; LoadSaveTacticalStatusType.cc
// @src (ubLastBattleSector, fLastBattleWon, IN_DEIDRANNA_ENDGAME, IN_ENDGAME_SEQUENCE).

import { NUM_MEANWHILES } from '../strategic/ai/queen-state.ts';
import type { StrategicState } from '../strategic/state.ts';
import { lockPauseState, pauseGame } from '../strategic/time/world-clock.ts';

const IN_ENDGAME_SEQUENCE = 0x00000008;
const IN_DEIDRANNA_ENDGAME = 0x80000000;
const LOCK_PAUSE_MEANWHILE = 6;

export interface SavedMeanwhileDefinitionInput {
  readonly sector: { readonly x: number; readonly y: number };
  readonly trigger: number;
  readonly id: number;
  readonly npc: number;
}

export interface SavedStory {
  readonly current: SavedMeanwhileDefinitionInput;
  readonly trying: boolean;
  readonly inScene: boolean;
  readonly definitions: readonly SavedMeanwhileDefinitionInput[];
  readonly firstBattleSector: number;
  readonly lastBattleSector: { readonly x: number; readonly y: number };
  readonly lastBattleWon: boolean;
  readonly tacticalFlags: number;
}

export function storyImportRefusal(saved: SavedStory): string | null {
  if (saved.inScene) return 'the save was made during a meanwhile scene';
  if ((saved.tacticalFlags & (IN_ENDGAME_SEQUENCE | IN_DEIDRANNA_ENDGAME)) !== 0) return 'the save was made during the endgame';
  return null;
}

function definition(d: SavedMeanwhileDefinitionInput) {
  return { sector: { x: d.sector.x, y: d.sector.y }, trigger: d.trigger, id: d.id, npc: d.npc };
}

function scheduled(d: SavedMeanwhileDefinitionInput): boolean {
  return d.npc !== 0 || d.sector.x !== 0 || d.sector.y !== 0;
}

export function importStory(state: StrategicState, saved: SavedStory): void {
  const m = state.meanwhile;
  for (let id = 0; id < NUM_MEANWHILES; id++) {
    const d = saved.definitions[id];
    m.defs[id] = d && scheduled(d) ? definition(d) : null;
  }
  m.current = definition(saved.current);
  m.trying = saved.trying;
  m.inScene = false;
  if (m.trying) {
    pauseGame(state.clock);
    lockPauseState(state.clock, LOCK_PAUSE_MEANWHILE);
  }
  state.economy.firstBattleSector = saved.firstBattleSector;
  const last = saved.lastBattleSector;
  state.battle.lastBattleSector = last.x !== 0 || last.y !== 0 ? { x: last.x, y: last.y } : null;
  state.battle.lastBattleWon = saved.lastBattleWon;
}

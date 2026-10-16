// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/End_Game.cc gpKillerSoldier, gsGridNo, gbLevel; Tactical/Overhead_Types.h IN_DEIDRANNA_ENDGAME,
// @src IN_ENDGAME_SEQUENCE. See docs/26 §0, §7.

export const EndgamePhase = {
  NONE: 'none',
  DEIDRANNA_TIMER: 'deidrannaTimer',
  DEIDRANNA_QUOTES: 'deidrannaQuotes',
  DEREK: 'derek',
  CREATURE_TIMER: 'creatureTimer',
  END_COMMENTS: 'endComments',
  ENDED: 'ended',
} as const;
export type EndgamePhase = (typeof EndgamePhase)[keyof typeof EndgamePhase];

export interface CampaignEnding {
  readonly miguelAlive: boolean;
  readonly skyriderAlive: boolean;
}

export interface CampaignVictory {
  readonly at: number;
  readonly day: number;
  readonly ending: CampaignEnding;
  readonly mercDeaths: number;
}

export interface EndingState {
  phase: EndgamePhase;
  killer: number | null;
  gridNo: number;
  level: number;
  dueTick: number;
  inDeidrannaEndgame: boolean;
  inEndgameSequence: boolean;
  victory: CampaignVictory | null;
}

export function createEndingState(): EndingState {
  return {
    phase: EndgamePhase.NONE,
    killer: null,
    gridNo: 0,
    level: 0,
    dueTick: 0,
    inDeidrannaEndgame: false,
    inEndgameSequence: false,
    victory: null,
  };
}

export type CampaignStatus = 'playing' | 'endgame' | 'won';

export function campaignStatus(e: EndingState): CampaignStatus {
  if (e.victory) return 'won';
  return e.inDeidrannaEndgame || e.inEndgameSequence ? 'endgame' : 'playing';
}

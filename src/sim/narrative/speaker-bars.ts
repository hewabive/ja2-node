// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Dialogue_Control.cc RenderFaceOverlay (DrawSoldierUIBars for the soldier with the speaker's
// @src profile, whatever his team); src/game/Tactical/Interface_Utils.cc DrawSoldierUIBars (the life, bleeding, breath
// @src and morale it reads).

import type { Soldier } from '../tactical/soldier.ts';

export interface SpeakerBars {
  readonly life: number;
  readonly lifeMax: number;
  readonly bleeding: number;
  readonly breath: number;
  readonly breathMax: number;
  readonly morale: number;
}

export function speakerBars(s: Soldier): SpeakerBars {
  return { life: s.life, lifeMax: s.lifeMax, bleeding: s.bleeding, breath: s.breath, breathMax: s.breathMax, morale: s.morale };
}

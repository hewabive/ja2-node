// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/GameScreen.cc EnterTacticalScreen (in a meanwhile scene the view locates the scene's NPC,
// @src LocateToMeanwhileCharacter; while IN_DEIDRANNA_ENDGAME it locates gridno 4561); src/game/Strategic/Meanwhile.cc
// @src LocateToMeanwhileCharacter (gCurrentMeanwhileDef.ubNPCNumber, QUEEN for every scene). See docs/26 §2.3, §6.2.

import type { PlayerView } from '../../protocol/view.ts';
import { Npc } from '../../sim/strategic/narrative/npc-ids.ts';

const ENDGAME_GRIDNO = 4561;
const MEANWHILE_NPC = Npc.QUEEN;

export function storyCameraTarget(view: PlayerView | null): number | null {
  const flow = view?.strategic?.flow;
  if (flow === 'endgame') return ENDGAME_GRIDNO;
  if (flow !== 'meanwhile') return null;
  return view?.soldiers.find((s) => s.profile === MEANWHILE_NPC)?.gridNo ?? null;
}

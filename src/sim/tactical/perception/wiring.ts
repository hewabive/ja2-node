// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc HandleAtNewGridNo (noise, then sight), CommonEnterCombatModeCode;
// @src Soldier_Control.cc HaultSoldierFromSighting, EVENT_BeginMercTurn; Tactical_Turns.cc HandleTacticalEndTurn;
// @src OppList.cc OurTeamSeesSomeone, NonCombatDecayPublicOpplist. See docs/08 §2.6, §2.8, §2.9.

import { AnimFlags } from '../../../content/anim/tables.ts';
import { hasAnimFlag } from '../animation.ts';
import { stopMerc } from '../movement.ts';
import { NOWHERE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import type { PerceptionHooks, TacticalHooks, TacticalState } from '../state.ts';
import { doorOpeningNoise, makeNoise, movementNoise, NoiseKind } from './noise.ts';
import { allTeamsLookForAll, decayPublicOpplist, handleSight, SightFlags, verifyAndDecayOpplist } from './sight.ts';

export const RT_TURN_MS = 5000;
export const OPPLIST_DECAY_MS = 20_000;

export interface RealtimeTurns {
  lastTurnMs: number;
  lastDecayMs: number;
}

export function haltFromSighting(t: TacticalState, s: Soldier): void {
  if (hasAnimFlag(t.content, s.state, AnimFlags.SPECIALMOVE)) return;
  if (!t.inCombat) stopMerc(t, s);
}

export function enterCombatMode(t: TacticalState, team: number, s: Soldier, cancelAi: (s: Soldier) => void): void {
  if (t.combatPending) return;
  const hostileCapable = t.soldiers.some(
    (x) => x?.placed && x.life >= OKLIFE && !x.neutral && x.team !== Team.OUR && x.team !== Team.MILITIA,
  );
  if (!hostileCapable) return;
  t.combatPending = true;
  t.perception.combatTeam = team;
  t.events.push({ type: 'combatWouldStart', team, soldier: s.id });
  for (const x of t.soldiers) {
    if (!x?.placed) continue;
    if (hasAnimFlag(t.content, x.state, AnimFlags.MOVING)) {
      stopMerc(t, x);
      x.finalDestination = x.gridNo;
    }
    cancelAi(x);
  }
}

export function perceptionHooks(
  t: TacticalState,
  base: Omit<PerceptionHooks, 'haltFromSighting' | 'ourTeamSeesSomeone' | 'enterCombatMode'>,
  cancelAi: (s: Soldier) => void,
): PerceptionHooks {
  return {
    ...base,
    haltFromSighting: (s) => haltFromSighting(t, s),
    ourTeamSeesSomeone: (s, revealed, unknown) => {
      t.events.push({ type: 'enemySighted', soldier: s.id, newEnemies: unknown, revealedEnemies: revealed });
      haltFromSighting(t, s);
    },
    enterCombatMode: (team, s) => enterCombatMode(t, team, s, cancelAi),
  };
}

export function sightHooks(previous: TacticalHooks): TacticalHooks {
  return {
    ...previous,
    atNewGridNo: (t, s) => {
      const volume = movementNoise(t, s);
      if (volume > 0) makeNoise(t, s, s.gridNo, s.level, volume, NoiseKind.MOVEMENT);
      handleSight(t, s, SightFlags.LOOK | SightFlags.RADIO | SightFlags.INTERRUPT);
      return false;
    },
    look: (t, s) => handleSight(t, s, SightFlags.LOOK | SightFlags.RADIO),
    stanceChanged: (t, s) => {
      handleSight(t, s, SightFlags.LOOK | SightFlags.RADIO | SightFlags.INTERRUPT);
      previous.stanceChanged(t, s);
    },
    doorOpened: (t, s) => {
      makeNoise(t, s, s.gridNo, s.level, doorOpeningNoise(t, s), NoiseKind.CREAKING);
      allTeamsLookForAll(t);
    },
  };
}

function beginMercTurn(s: Soldier): void {
  if (s.ai.noiseVolume > 0) {
    s.ai.noiseVolume--;
    if (s.ai.noiseVolume === 0) s.ai.noiseGridNo = NOWHERE;
  }
  s.tilesMoved = 0;
  s.movementNoiseHeard = 0;
}

export function handleRealtimeTurn(t: TacticalState, turns: RealtimeTurns): void {
  if (t.clockMs - turns.lastTurnMs <= RT_TURN_MS) return;
  turns.lastTurnMs = t.clockMs;
  if (!t.inCombat && t.clockMs - turns.lastDecayMs >= OPPLIST_DECAY_MS) {
    turns.lastDecayMs = t.clockMs;
    for (const s of t.soldiers) if (s?.placed) verifyAndDecayOpplist(t, s);
    for (let team = 0; team <= 5; team++) if (t.soldiers.some((s) => s?.placed && s.team === team)) decayPublicOpplist(t, team);
  }
  for (const s of t.soldiers) if (s?.placed) beginMercTurn(s);
}

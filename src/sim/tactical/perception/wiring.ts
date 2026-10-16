// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc HandleAtNewGridNo (noise, then sight, then interrupts);
// @src Soldier_Control.cc HaultSoldierFromSighting; Soldier_Ani.cc opcode 495 (door opening sight and noise);
// @src OppList.cc OurTeamSeesSomeone. See docs/08 §2.6, §2.8, §2.9 and docs/10 §4.8, §4.10.

import { AnimFlags } from '../../../content/anim/tables.ts';
import { adjustNoAPToFinishMove, hasAnimFlag } from '../animation.ts';
import { stopMerc } from '../movement.ts';
import { NO_PENDING_ANIMATION, ReasonCantFinishMove, type Soldier } from '../soldier.ts';
import type { PerceptionHooks, TacticalHooks, TacticalState } from '../state.ts';
import { enterCombatMode } from '../turns/turns.ts';
import { doorOpeningNoise, makeNoise, movementNoise, NoiseKind } from './noise.ts';
import { allTeamsLookForAll, handleSight, initOpplistForDoorOpening, SightFlags } from './sight.ts';

export function haltFromSighting(t: TacticalState, s: Soldier, fromSightingEnemy: boolean): void {
  if (hasAnimFlag(t.content, s.state, AnimFlags.SPECIALMOVE)) return;
  if (!t.inCombat) {
    stopMerc(t, s);
    return;
  }
  adjustNoAPToFinishMove(s, true);
  s.reasonCantFinishMove = ReasonCantFinishMove.STOPPED_SIGHT;
  if (fromSightingEnemy) s.pendingAnimation = NO_PENDING_ANIMATION;
}

export function perceptionHooks(
  t: TacticalState,
  base: Omit<PerceptionHooks, 'haltFromSighting' | 'haltFromItemSighting' | 'ourTeamSeesSomeone' | 'enterCombatMode'>,
): PerceptionHooks {
  return {
    ...base,
    haltFromSighting: (s) => haltFromSighting(t, s, true),
    haltFromItemSighting: (s) => haltFromSighting(t, s, false),
    ourTeamSeesSomeone: (s, revealed, unknown) => {
      t.events.push({ type: 'enemySighted', soldier: s.id, newEnemies: unknown, revealedEnemies: revealed });
      haltFromSighting(t, s, true);
    },
    enterCombatMode: (team) => enterCombatMode(t, team),
  };
}

export function sightHooks(previous: TacticalHooks): TacticalHooks {
  return {
    ...previous,
    atNewGridNo: (t, s) => {
      t.turn.interruptOccurred = false;
      const volume = movementNoise(t, s);
      if (volume > 0) makeNoise(t, s, s.gridNo, s.level, volume, NoiseKind.MOVEMENT);
      if (!t.turn.interruptOccurred) handleSight(t, s, SightFlags.LOOK | SightFlags.RADIO | SightFlags.INTERRUPT);
      return t.turn.interruptOccurred;
    },
    look: (t, s) => handleSight(t, s, SightFlags.LOOK | SightFlags.RADIO),
    stanceChanged: (t, s) => {
      const settled =
        s.pendingAnimation === NO_PENDING_ANIMATION &&
        t.turn.attackBusyCount === 0 &&
        s.turningFromPronePosition !== 3 &&
        s.turningFromPronePosition !== 1;
      handleSight(t, s, SightFlags.LOOK | SightFlags.RADIO | (settled ? SightFlags.INTERRUPT : 0));
      previous.stanceChanged(t, s);
    },
    doorOpeningNoise,
    doorOpened: (t, s, noise) => {
      initOpplistForDoorOpening(t);
      makeNoise(t, s, s.gridNo, s.level, noise, NoiseKind.CREAKING);
      t.turn.interruptProvoker = s;
      allTeamsLookForAll(t, true);
    },
  };
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc HandleAtNewGridNo (noise and the stealthy footstep of a PC,
// @src then sight, then interrupts);
// @src Soldier_Control.cc HaultSoldierFromSighting; Soldier_Ani.cc opcode 495 (door opening sight and noise), opcodes 408
// @src and 475 (the sight after a roof climb);
// @src OppList.cc OurTeamSeesSomeone (the quotes, the curse, the end of fVirginSector and UnSetUIBusy, 2026-10-30; the locate
// @src to our merc and the slide to the enemy sighted on their turn, 2026-11-03).

import { AnimFlags } from '../../../content/anim/tables.ts';
import { adjustNoAPToFinishMove, hasAnimFlag, soldierGotoStationaryStance } from '../animation.ts';
import { reduceAttackBusyCount, unSetUIBusy } from '../combat/barrier.ts';
import { strikePending } from '../combat/strikes.ts';
import { unsetEngagedInConvFromPcAction } from '../give.ts';
import { autoPlaceObject } from '../inventory.ts';
import { stopMerc } from '../movement.ts';
import { type SightingBattleSound, saySeenQuote } from '../narrative/sighting-quotes.ts';
import { hasPendingAction, removePendingAction } from '../pending-action.ts';
import { NO_PENDING_ANIMATION, ReasonCantFinishMove, type Soldier, Team, Visible } from '../soldier.ts';
import { soldierInventoryContext } from '../soldier-inventory.ts';
import type { PerceptionHooks, TacticalHooks, TacticalState } from '../state.ts';
import { enterCombatMode } from '../turns/turns.ts';
import { doorOpeningNoise, makeNoise, movementNoise, NoiseKind } from './noise.ts';
import { allTeamsLookForAll, handleSight, initOpplistForDoorOpening, SightFlags } from './sight.ts';

export function returnThrownObject(t: TacticalState, s: Soldier): void {
  const thrown = s.tempObject;
  if (thrown) autoPlaceObject(soldierInventoryContext(t, s), s, thrown);
  s.tempObject = null;
  s.pendingAnimation = NO_PENDING_ANIMATION;
}

function haltInCombat(t: TacticalState, s: Soldier, fromSightingEnemy: boolean): void {
  adjustNoAPToFinishMove(s, true);
  s.reasonCantFinishMove = ReasonCantFinishMove.STOPPED_SIGHT;
  if (s.turningToShoot && fromSightingEnemy) {
    s.turningToShoot = false;
    s.dontUnsetLastTargetFromTurn = true;
    reduceAttackBusyCount(t, s, false);
  }
  if (fromSightingEnemy) {
    if (hasPendingAction(s) && s.gridNo === s.finalDestination) removePendingAction(t, s);
    s.pendingAnimation = NO_PENDING_ANIMATION;
  }
  if (!s.turningToShoot) s.turningFromPronePosition = 0;
}

export function haltFromSighting(t: TacticalState, s: Soldier, fromSightingEnemy: boolean): void {
  if (hasAnimFlag(t.content, s.state, AnimFlags.SPECIALMOVE)) return;
  const throwing = s.tempObject !== null && fromSightingEnemy;
  const attacking = strikePending(t, s);
  if (throwing) returnThrownObject(t, s);
  if (throwing || attacking) {
    reduceAttackBusyCount(t, s, false);
    soldierGotoStationaryStance(t, s);
  }
  if (!t.inCombat) stopMerc(t, s);
  else haltInCombat(t, s, fromSightingEnemy);
  unsetEngagedInConvFromPcAction(t, s);
}

function sightingReaction(
  t: TacticalState,
  s: Soldier,
  revealed: number,
  unknown: number,
  virginSector: boolean,
): SightingBattleSound | null {
  if (!virginSector && revealed > 0 && unknown === 0) return 'CURSE1';
  return saySeenQuote(t, s, virginSector);
}

function ourTeamSeesSomeone(t: TacticalState, s: Soldier, revealed: number, unknown: number, enemies: readonly number[]): void {
  const virginSector = t.turn.virginSector;
  if (virginSector) t.narrative.deleteTalkingMenu();
  const battleSound = sightingReaction(t, s, revealed, unknown, virginSector);
  t.events.push({
    type: 'enemySighted',
    soldier: s.id,
    newEnemies: unknown,
    revealedEnemies: revealed,
    enemies: [...enemies],
    ...(battleSound ? { battleSound } : {}),
  });
  haltFromSighting(t, s, true);
  if (virginSector) {
    t.turn.virginSector = false;
    return;
  }
  locateSightingOnTheirTurn(t, s);
  unSetUIBusy(t, s);
}

function locateSightingOnTheirTurn(t: TacticalState, s: Soldier): void {
  const sighting = t.turn.enemySightingOnTheirTurn;
  if (!sighting) return;
  t.events.push({ type: 'soldierLocated', soldier: s.id, locator: 'normal' });
  if (sighting.enemy.visible !== Visible.HIDDEN)
    t.events.push({ type: 'soldierLocated', soldier: sighting.enemy.id, locator: 'normal', slide: true });
}

export function perceptionHooks(
  t: TacticalState,
  base: Omit<PerceptionHooks, 'haltFromSighting' | 'haltFromItemSighting' | 'ourTeamSeesSomeone' | 'enterCombatMode'>,
): PerceptionHooks {
  return {
    ...base,
    haltFromSighting: (s) => haltFromSighting(t, s, true),
    haltFromItemSighting: (s) => haltFromSighting(t, s, false),
    ourTeamSeesSomeone: (s, revealed, unknown, enemies) => ourTeamSeesSomeone(t, s, revealed, unknown, enemies),
    enterCombatMode: (team) => enterCombatMode(t, team),
  };
}

export function sightHooks(previous: TacticalHooks): TacticalHooks {
  return {
    ...previous,
    atNewGridNo: (t, s) => {
      t.turn.interruptOccurred = false;
      const volume = movementNoise(t, s);
      if (volume > 0) {
        makeNoise(t, s, s.gridNo, s.level, volume, NoiseKind.MOVEMENT);
        if (s.team === Team.OUR && s.stealthMode) t.events.push({ type: 'stealthyFootstep', soldier: s.id });
      }
      if (!t.turn.interruptOccurred) handleSight(t, s, SightFlags.LOOK | SightFlags.RADIO | SightFlags.INTERRUPT);
      return t.turn.interruptOccurred;
    },
    look: (t, s) => handleSight(t, s, SightFlags.LOOK | SightFlags.RADIO),
    climbedRoof: (t, s) => handleSight(t, s, SightFlags.LOOK | SightFlags.RADIO | SightFlags.INTERRUPT),
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

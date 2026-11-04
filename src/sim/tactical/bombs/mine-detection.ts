// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc NearbyGroundSeemsWrong, MineSpottedDialogueCallBack, MineSpottedLocatorCallback,
// @src MineSpottedMessageBoxCallBack; Tactical/Overhead.cc CheckIfNearbyGroundSeemsWrong.

import { DIRECTION_COUNT, DIRECTION_INCREMENT, newGridNo } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { type ItemObject, ObjectFlags } from '../../items/object.ts';
import { StatCause, statChange } from '../combat/experience.ts';
import { calcTrapDetectLevel } from '../combat/skill-check.ts';
import { stopMerc } from '../movement.ts';
import { MercQuote } from '../narrative/merc-quotes.ts';
import { StopTimeCallback } from '../narrative/port.ts';
import { doorTravelCost } from '../points.ts';
import { StatKind } from '../profiles.ts';
import { openTacticalPrompt, TacticalPromptKind } from '../prompts.ts';
import { NOWHERE, Side, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';
import { Detonator, detonatorOf, isDisabledBomb } from './bomb-object.ts';
import { addBlueFlag, hasMineFlag, MineFlag, setMineFlag } from './mine-flags.ts';
import { worldBombItems } from './world-bombs.ts';

const FLAGGED_BY_METAL_DETECTOR = NOWHERE;
const METAL_DETECTOR_MAX_TRAP = 10;

interface MineFinder {
  readonly metalDetector: boolean;
  readonly detectLevel: number;
}

function carriesMetalDetector(t: TacticalState, s: Soldier): boolean {
  const detector = t.content.items.byName.get('METALDETECTOR')?.index;
  return s.inv.some((o) => o.item === detector);
}

function mineFinder(t: TacticalState, s: Soldier): MineFinder {
  if (carriesMetalDetector(t, s)) return { metalDetector: true, detectLevel: 0 };
  return { metalDetector: false, detectLevel: calcTrapDetectLevel(t, s, false) };
}

function sideMineFlag(s: Soldier): number {
  return s.side === Side.FRIENDLY ? MineFlag.PLAYER : MineFlag.ENEMY;
}

function impassableFrom(t: TacticalState, g: number, direction: number, level: number): boolean {
  const cost = t.world.costs.get(g, direction, level);
  const ctx = { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
  return doorTravelCost(ctx, null, g, cost, false, false) >= TravelCost.BLOCKED;
}

function tilesToCheck(t: TacticalState, s: Soldier, g: number, around: boolean): number[] {
  if (!around) return [g];
  const tiles: number[] = [];
  for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
    const next = newGridNo(g, DIRECTION_INCREMENT[direction] ?? 0);
    if (!impassableFrom(t, next, direction, s.level)) tiles.push(next);
  }
  return tiles;
}

function unnoticedPressureBomb(o: ItemObject): boolean {
  return detonatorOf(o) === Detonator.PRESSURE && (o.flags & ObjectFlags.KNOWN_TO_BE_TRAPPED) === 0 && !isDisabledBomb(o);
}

export function nearbyGroundSeemsWrong(t: TacticalState, s: Soldier, g: number, around: boolean): number | null {
  const finder = mineFinder(t, s);
  const known = sideMineFlag(s);
  for (const next of tilesToCheck(t, s, g, around)) {
    if (hasMineFlag(t, next, known)) continue;
    for (const wi of worldBombItems(t)) {
      if (wi.gridNo !== next || !unnoticedPressureBomb(wi.object)) continue;
      const trap = wi.object.trap;
      if (finder.metalDetector && trap <= METAL_DETECTOR_MAX_TRAP) {
        addBlueFlag(t, next, s.level);
        return FLAGGED_BY_METAL_DETECTOR;
      }
      if (finder.detectLevel >= trap) {
        if (s.team === Team.OUR) {
          statChange(t, s, StatKind.EXPLOSIVES, trap, StatCause.SUCCESS);
          wi.object.flags |= ObjectFlags.KNOWN_TO_BE_TRAPPED;
        }
        return next;
      }
    }
  }
  return null;
}

export function mineSpottedDialogueCallBack(t: TacticalState): void {
  t.turn.lockItemLocators = false;
  t.events.push({ type: 'mineLocator', gridNo: t.boobyTrap.gridNo, level: t.boobyTrap.level });
  openTacticalPrompt(t, { kind: TacticalPromptKind.PLACE_BLUE_FLAG });
}

export function answerPlaceBlueFlag(t: TacticalState, yes: boolean): void {
  if (yes) addBlueFlag(t, t.boobyTrap.gridNo, t.boobyTrap.level);
}

function warnAboutMine(t: TacticalState, s: Soldier, mine: number): void {
  t.boobyTrap.soldier = s;
  t.boobyTrap.gridNo = mine;
  t.events.push({ type: 'trapSpotted', soldier: s.id, gridNo: mine, kind: 'ground' });
  if (!t.narrative.sayStopTimeQuote(s, MercQuote.SUSPICIOUS_GROUND, StopTimeCallback.MINE_SPOTTED)) mineSpottedDialogueCallBack(t);
}

function stopOnSuspiciousGround(t: TacticalState, s: Soldier): void {
  if (t.inCombat) {
    stopMerc(t, s);
    return;
  }
  for (const merc of teamMembers(t, Team.OUR).reverse()) stopMerc(t, merc);
}

function reconsiderAfterSpottingMine(t: TacticalState, s: Soldier, mine: number): void {
  stopMerc(t, s);
  setMineFlag(t, mine, sideMineFlag(s));
  t.turnHooks.setNewSituation(t, s);
  t.turnHooks.actionDone(t, s);
}

export function checkIfNearbyGroundSeemsWrong(t: TacticalState, s: Soldier, g: number, around: boolean): boolean {
  const mine = nearbyGroundSeemsWrong(t, s, g, around);
  if (mine === null) return false;
  if (s.team === Team.OUR) {
    stopOnSuspiciousGround(t, s);
    if (mine !== FLAGGED_BY_METAL_DETECTOR) warnAboutMine(t, s, mine);
    return true;
  }
  if (mine === FLAGGED_BY_METAL_DETECTOR) return false;
  reconsiderAfterSpottingMine(t, s, mine);
  return true;
}

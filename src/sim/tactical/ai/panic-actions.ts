// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/AIMain.cc ExecuteAction (AI_ACTION_PULL_TRIGGER, AI_ACTION_USE_DETONATOR); Tactical/Soldier_Ani.cc
// @src code 762 (set off the trigger) and code 499 (the trigger puller freed); Points.h AP_PULL_TRIGGER, AP_USE_REMOTE,
// @src BP_USE_DETONATOR.

import type { OpOutcome } from '../../../content/anim/script.ts';
import { DIRECTION_INCREMENT, Direction } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { anim } from '../anim-states.ts';
import { initNewSoldierAnim } from '../animation.ts';
import { setOffPanicBombs } from '../bombs/bomb-queue.ts';
import { AP, BP, deductPoints } from '../points.ts';
import { NOWHERE, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { AiAction } from './actions.ts';
import { closestPanicTrigger, FIRST_PANIC_TRIGGER, NO_PANIC_TRIGGER, popPanicKeys } from './panic-triggers.ts';

const SET_OFF_TRIGGER_CODE = 762;
const PULL_SWITCH_STATE = 'AI_PULL_SWITCH';
const NO_BREATH_COST = 0;

function directionToSwitch(t: TacticalState, s: Soldier): number {
  const north = s.gridNo + (DIRECTION_INCREMENT[Direction.NORTH] ?? 0);
  return t.world.structures.find(north, StructureFlags.SWITCH) ? Direction.NORTH : Direction.WEST;
}

export function executePullTrigger(t: TacticalState, s: Soldier): void {
  t.gameEvents.push({ kind: 'desiredDirection', soldier: s.id, direction: directionToSwitch(t, s) });
  initNewSoldierAnim(t, s, anim(t.content, PULL_SWITCH_STATE), 0, false);
  deductPoints(t, s, AP.PULL_TRIGGER, NO_BREATH_COST);
  t.panic.chosenOne = null;
}

export function executeUseDetonator(t: TacticalState, s: Soldier): void {
  const ai = s.ai;
  t.panic.chosenOne = null;
  deductPoints(t, s, AP.USE_REMOTE, BP.USE_DETONATOR);
  setOffPanicBombs(t, s, FIRST_PANIC_TRIGGER);
  ai.actionData = NOWHERE;
  ai.lastAction = ai.action;
  ai.action = AiAction.NONE;
}

export function pullTriggerOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (code !== SET_OFF_TRIGGER_CODE) return null;
  const trigger = closestPanicTrigger(t, s);
  if (trigger !== NO_PANIC_TRIGGER) setOffPanicBombs(t, s, trigger);
  popPanicKeys(s);
  return 'continue';
}

export function triggerPullerDone(t: TacticalState, s: Soldier): boolean {
  const pullingSwitch = t.content.animations.controls[s.state]?.id === PULL_SWITCH_STATE;
  return pullingSwitch && t.turn.attackBusyCount === 0 && t.explosionQueue.entries.length === 0;
}

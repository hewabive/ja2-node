// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc GetMoveStateBasedOnStance; Handle_UI.cc SetUIbasedOnStance, the real-time
// @src move (the mode by stance and the one-shot fUIMovementFast); Soldier_Ani.cc code 499 (the mode after a stance
// @src change). The stance of the API joins the height and the run mode into one value.

import { AnimHeight, endHeight, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { MoveMode } from './pathfinding.ts';
import { stateName } from './points.ts';
import { Body, type Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export type Stance = 'run' | 'stand' | 'crouch' | 'prone';

const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;

function movementForHeight(content: TacticalContent, height: number, running: boolean): number {
  const st = states(content.animations);
  if (height === AnimHeight.PRONE) return st.CRAWLING;
  if (height === AnimHeight.CROUCH) return st.SWATTING;
  return running ? st.RUNNING : st.WALKING;
}

export function moveStateBasedOnStance(content: TacticalContent, s: Soldier, height = endHeight(content, s.state)): number {
  return movementForHeight(content, height, s.uiMovementFast && !isVehicle(s));
}

export function movementForStanceChange(content: TacticalContent, height: number): number {
  return movementForHeight(content, height, false);
}

export function nextMoveMode(t: TacticalState, s: Soldier): number {
  if (!t.inCombat) return moveStateBasedOnStance(t.content, s);
  const running = s.uiMovementMode === states(t.content.animations).RUNNING;
  return movementForHeight(t.content, endHeight(t.content, s.state), running);
}

export function soldierStance(t: TacticalState, s: Soldier): Stance {
  const st = states(t.content.animations);
  const mode = nextMoveMode(t, s);
  if (mode === st.RUNNING) return 'run';
  if (mode === st.SWATTING) return 'crouch';
  return mode === st.CRAWLING ? 'prone' : 'stand';
}

export function stanceHeight(stance: unknown): number | null {
  if (stance === 'run' || stance === 'stand') return AnimHeight.STAND;
  if (stance === 'crouch') return AnimHeight.CROUCH;
  return stance === 'prone' ? AnimHeight.PRONE : null;
}

export function explicitMovementMode(content: TacticalContent, mode: unknown): number | null {
  const st = states(content.animations);
  switch (mode) {
    case 'run':
      return st.RUNNING;
    case 'walk':
      return st.WALKING;
    case 'swat':
      return st.SWATTING;
    case 'crawl':
      return st.CRAWLING;
  }
  return null;
}

export function movementModeState(t: TacticalState, s: Soldier, mode: unknown): number {
  return explicitMovementMode(t.content, mode) ?? nextMoveMode(t, s);
}

export function pathMoveMode(content: TacticalContent, mode: number): MoveMode {
  const name = stateName(content, mode);
  return name === 'RUNNING'
    ? MoveMode.RUNNING
    : name === 'SWATTING'
      ? MoveMode.SWATTING
      : name === 'CRAWLING'
        ? MoveMode.CRAWLING
        : MoveMode.WALKING;
}

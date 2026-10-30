// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface.cc PopupMovementMenu (run is disabled for a vehicle, the robot and a merc in water;
// @src sneak and crawl follow IsValidStance for crouching and lying down).

import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { AnimHeight } from '../tactical/animation.ts';
import { isRobot } from '../tactical/narrative/robot.ts';
import { isValidStance, isVehicleBody, mercInWater } from '../tactical/person-structure.ts';
import { actingSoldier } from './soldier-check.ts';
import { type HintRequestBase, type HintResult, hintData } from './types.ts';

export interface MovementOptions {
  readonly run: boolean;
  readonly sneak: boolean;
  readonly crawl: boolean;
}

export interface MovementOptionsRequest extends HintRequestBase {
  readonly soldier?: unknown;
}

export function movementOptions(world: KnowledgeWorld, req: MovementOptionsRequest): HintResult<MovementOptions> {
  const acting = actingSoldier(world, req.soldier);
  if ('refusal' in acting) return acting.refusal;
  const { state: t, soldier: s } = acting;
  return hintData({
    run: !isVehicleBody(s) && !isRobot(s) && !mercInWater(s),
    sneak: isValidStance(t, s, AnimHeight.CROUCH),
    crawl: isValidStance(t, s, AnimHeight.PRONE),
  });
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Control.cc SubstituteBodyTypeAnimation, IsAnimationValidForBodyType.

import { substituteBodyTypeState } from '../../content/anim/body-substitution.ts';
import { INVALID_SURFACE } from '../../content/anim/tables.ts';
import type { TacticalContent } from './content.ts';
import { type Soldier, Team } from './soldier.ts';

export function substituteBodyTypeAnimation(content: TacticalContent, s: Pick<Soldier, 'bodyType' | 'team'>, state: number): number {
  return substituteBodyTypeState(content.animations, { bodyType: s.bodyType, civilianTeam: s.team === Team.CIV }, state);
}

export function isAnimationValidForBodyType(content: TacticalContent, s: Pick<Soldier, 'bodyType' | 'team'>, state: number): boolean {
  const surface = content.animations.bodySurfaces[s.bodyType]?.[substituteBodyTypeAnimation(content, s, state)];
  return surface !== undefined && surface !== INVALID_SURFACE;
}

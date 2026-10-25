// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Find.h SoldierFindFlags; Soldier_Find.cc GetSoldierFindFlags, IsValidTargetMerc,
// @src FindRelativeSoldierPosition (head above 20 %, the middle down to 60 % standing or 70 % crouched, the feet below);
// @src Soldier_Macros.h IsHostileToOurTeam; Overhead.cc OK_INTERRUPT_MERC. See docs/28 §6.1.

import type { PlayerView, SoldierView } from '../../../../protocol/view.ts';
import type { ScreenBox, SoldierHeight } from '../environment.ts';
import { isDead, isUnconscious, OUR_TEAM, okInterrupt } from '../soldiers.ts';

export const FindFlag = {
  OWNED: 0x1,
  SELECTED: 0x2,
  ENEMY: 0x4,
  NEUTRAL: 0x8,
  UNCONSCIOUS: 0x10,
  DEAD: 0x20,
  VISIBLE: 0x40,
  NOINTERRUPT: 0x80,
} as const;

export function soldierFindFlags(s: SoldierView, selected: number | null, view: PlayerView | null): number {
  let flags = 0;
  if (s.id === selected) flags |= FindFlag.SELECTED;
  if (s.team === OUR_TEAM) flags |= FindFlag.OWNED;
  else if (s.hostile === true) flags |= FindFlag.ENEMY;
  else flags |= FindFlag.NEUTRAL;
  if (view?.combat && s.team === OUR_TEAM && !okInterrupt(s)) flags |= FindFlag.NOINTERRUPT;
  if (isUnconscious(s)) flags |= FindFlag.UNCONSCIOUS;
  if (isDead(s)) flags |= FindFlag.DEAD;
  flags |= FindFlag.VISIBLE;
  return flags;
}

export function hostileToOurTeam(s: SoldierView): boolean {
  return s.team !== OUR_TEAM && s.hostile === true;
}

export const BodyPart = { HEAD: 'head', TORSO: 'torso', LEGS: 'legs' } as const;
export type BodyPart = (typeof BodyPart)[keyof typeof BodyPart];

const STAND_HEAD = 0.2;
const STAND_MID = 0.6;
const CROUCH_MID = 0.7;

export function relativeBodyPart(box: ScreenBox | null, height: SoldierHeight, x: number, y: number): BodyPart | null {
  if (!box || height === 'prone') return null;
  if (x < box.x || y < box.y || x > box.x + box.width || y > box.y + box.height) return null;
  const relative = Math.fround((y - box.y) / box.height);
  if (relative < STAND_HEAD) return BodyPart.HEAD;
  if (relative < (height === 'crouch' ? CROUCH_MID : STAND_MID)) return BodyPart.TORSO;
  return BodyPart.LEGS;
}

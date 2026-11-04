// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Find.h SoldierFindFlags; Soldier_Find.cc GetSoldierFindFlags, IsValidTargetMerc,
// @src FindRelativeSoldierPosition (head above 20 %, the middle down to 60 % standing or 70 % crouched, the feet below),
// @src FindSoldier with FINDSOLDIERSAMELEVEL (the soldiers on the interface level whose screen rectangle, edges
// @src included, holds the pointer or who stand on its tile, the selected merc passed over in the action modes unless
// @src his action cursor is the aid cursor, a vehicle only by his picture, the one whose rectangle reaches lowest on
// @src screen, the first of a tie); TileEngine/Isometric_Utils.cc IsPointInScreenRect;
// @src Soldier_Macros.h IsHostileToOurTeam; Overhead.cc OK_INTERRUPT_MERC.

import type { PlayerView, SoldierView } from '../../../../protocol/view.ts';
import type { ScreenBox, SoldierHeight } from '../environment.ts';
import { isDead, isUnconscious, isVehicleBody, OUR_TEAM, okInterrupt } from '../soldiers.ts';

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

export interface SoldierScreenRects {
  soldierBox(id: number): ScreenBox | null;
  soldierPictureAt(id: number, x: number, y: number): boolean;
}

export interface PickRules {
  readonly byRectangle: (s: SoldierView) => boolean;
  readonly passedOver: (s: SoldierView) => boolean;
}

export const PICK_ANYONE: PickRules = { byRectangle: () => true, passedOver: () => false };

export interface PointerSpot {
  readonly x: number;
  readonly y: number;
  readonly gridNo: number;
  readonly level: number;
}

const NO_SCREEN_Y = -32000;

function inScreenRect(x: number, y: number, box: ScreenBox): boolean {
  return box.x <= x && x <= box.x + box.width && box.y <= y && y <= box.y + box.height;
}

export function findSoldier(
  soldiers: readonly SoldierView[],
  at: PointerSpot,
  world: SoldierScreenRects,
  rules: PickRules,
): SoldierView | null {
  const x = Math.floor(at.x);
  const y = Math.floor(at.y);
  let best: SoldierView | null = null;
  let lowest = NO_SCREEN_Y;
  for (const s of soldiers) {
    if (s.level !== at.level) continue;
    const box = world.soldierBox(s.id);
    if (!box) continue;
    const inRect = rules.byRectangle(s) && inScreenRect(x, y, box);
    if (!inRect && s.gridNo !== at.gridNo) continue;
    if (rules.passedOver(s)) continue;
    if (isVehicleBody(s) && !world.soldierPictureAt(s.id, x, y)) continue;
    const bottom = box.y + box.height;
    if (lowest < bottom) {
      lowest = bottom;
      best = s;
    }
  }
  return best;
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

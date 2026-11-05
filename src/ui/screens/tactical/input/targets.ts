// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Find.h SoldierFindFlags; Soldier_Find.cc GetSoldierFindFlags (a vehicle of ours owned
// @src only with somebody aboard, 2026-11-05), IsValidTargetMerc,
// @src FindRelativeSoldierPosition (head above 20 %, the middle down to 60 % standing or 70 % crouched, the feet below),
// @src FindSoldier with FINDSOLDIERSAMELEVEL (never a passenger; the soldiers on the interface level whose screen
// @src rectangle, edges included, holds the pointer or who stand on its tile, the selected merc passed over in the action modes unless
// @src his action cursor is the aid cursor, a vehicle only by his picture, the one whose rectangle reaches lowest on
// @src screen, the first of a tie); FindSoldier with FIND_SOLDIER_BEGINSTACK and the stack it keeps (the stacked
// @src soldier while the pointer is on him, none while the stack is on the ground of its tile), CycleSoldierFindStack
// @src (2026-11-04); TileEngine/Isometric_Utils.cc IsPointInScreenRect;
// @src Soldier_Macros.h IsHostileToOurTeam; Overhead.cc OK_INTERRUPT_MERC.

import type { PlayerView, SoldierView } from '../../../../protocol/view.ts';
import type { ScreenBox, SoldierHeight } from '../environment.ts';
import { isDead, isInVehicle, isOwned, isUnconscious, isVehicleBody, OUR_TEAM, okInterrupt } from '../soldiers.ts';

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
  if (s.team === OUR_TEAM) {
    if (isOwned(s)) flags |= FindFlag.OWNED;
  } else if (s.hostile === true) flags |= FindFlag.ENEMY;
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

interface PointedSoldier {
  readonly soldier: SoldierView;
  readonly bottom: number;
}

function* pointedSoldiers(
  soldiers: readonly SoldierView[],
  at: PointerSpot,
  world: SoldierScreenRects,
  rules: PickRules,
): Generator<PointedSoldier> {
  const x = Math.floor(at.x);
  const y = Math.floor(at.y);
  for (const s of soldiers) {
    if (isInVehicle(s)) continue;
    if (s.level !== at.level) continue;
    const box = world.soldierBox(s.id);
    if (!box) continue;
    const inRect = rules.byRectangle(s) && inScreenRect(x, y, box);
    if (!inRect && s.gridNo !== at.gridNo) continue;
    if (rules.passedOver(s)) continue;
    if (isVehicleBody(s) && !world.soldierPictureAt(s.id, x, y)) continue;
    yield { soldier: s, bottom: box.y + box.height };
  }
}

export type StackCycle = 'soldier' | 'ground' | 'none';

export class SoldierStack {
  readonly #soldiers: number[] = [];
  #count = 0;
  #current = 0;
  #handling = false;
  #onGround = false;
  #groundGridNo = -1;

  get handling(): boolean {
    return this.#handling;
  }

  get current(): number | null {
    return this.#handling && !this.#onGround ? (this.#soldiers[this.#current] ?? null) : null;
  }

  begin(soldiers: readonly SoldierView[], at: PointerSpot, world: SoldierScreenRects, rules: PickRules): void {
    this.#count = 0;
    this.#onGround = false;
    let lowest = NO_SCREEN_Y;
    for (const { soldier, bottom } of pointedSoldiers(soldiers, at, world, rules)) {
      this.#handling = true;
      this.#soldiers[this.#count++] = soldier.id;
      if (lowest < bottom) {
        lowest = bottom;
        this.#current = this.#count - 1;
      }
    }
  }

  cycle(gridNo: number): StackCycle {
    if (!this.#handling) return 'none';
    if (!this.#onGround) this.#current++;
    if (this.#current === this.#count) {
      if (!this.#onGround) {
        this.#onGround = true;
        this.#groundGridNo = gridNo;
        return 'ground';
      }
      this.#current = 0;
      this.#onGround = false;
    }
    return 'soldier';
  }

  endUnlessHeldAt(gridNo: number): void {
    if (this.#handling && (!this.#onGround || this.#groundGridNo !== gridNo)) this.#handling = false;
  }
}

export function findSoldier(
  soldiers: readonly SoldierView[],
  at: PointerSpot,
  world: SoldierScreenRects,
  rules: PickRules,
  stack: SoldierStack | null = null,
): SoldierView | null {
  let best: SoldierView | null = null;
  let lowest = NO_SCREEN_Y;
  for (const { soldier, bottom } of pointedSoldiers(soldiers, at, world, rules)) {
    if (stack?.handling) {
      if (stack.current === soldier.id) return soldier;
      continue;
    }
    if (lowest < bottom) {
      lowest = bottom;
      best = soldier;
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

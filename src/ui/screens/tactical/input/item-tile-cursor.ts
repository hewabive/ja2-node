// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc DrawItemTileCursor (the give cursor over a talkable soldier, else the throw
// @src crosshair, good or bad by the last chance to get through; MSG_DROP within a tile, MSG_THROW beyond it unless over a
// @src catcher; the AP of a pickup for a drop or a pass, of a toss otherwise, offset 15/15 in combat; a give's walk-up tile
// @src and AP once the pointer rests; the landing tile once the pointer rests long enough to recalculate, none over the
// @src holder; gfItemPointerDifferentThanDefault dropped when the pointer's tile changes), HandleItemPointerClick (give,
// @src drop, pass or toss; a moving soldier under the pointer refused; a stale bad chance to get through refused with
// @src CANNOT_THROW_TO_DEST_STR); InternalBeginItemPointer (the swap off for a new object); Turn_Based_Input.cc
// @src GetTBMouseButtonInput and Real_Time_Input.cc GetRTMouseButtonInput (a right click over a soldier swaps give and
// @src throw; not a real-time double click); Handle_UI.cc IsValidTalkableNPC with fGive; Interface.cc DrawSelectedUIAboveGuy
// @src (CATCH_STR, RELOAD_STR, MSG_PASS, GIVE_STR over the catcher).

import { Body } from '../../../../content/anim/body-types.ts';
import { pythSpacesAway } from '../../../../content/world/grid.ts';
import type { PreviewAction } from '../../../../protocol/hints.ts';
import type { CommandEnvelope } from '../../../../protocol/messages.ts';
import type { SoldierView } from '../../../../protocol/view.ts';
import type { ItemCursor } from '../item-cursor.ts';
import { tossFields } from '../item-cursor.ts';
import { isDead, isEpc, isUnconscious, isVehicleBody, OUR_TEAM } from '../soldiers.ts';
import { dataOf, type HintState } from './hints.ts';

export const DROPPING_DISTANCE = 1;
export const PASSING_ITEM_DISTANCE_OKLIFE = 3;
export const AP_PICKUP_ITEM = 3;
export const AP_TOSS_ITEM = 8;
export const ITEM_AP_OFFSET = 15;

export type ItemTileCursorName = 'CURSOR_ITEM_GOOD_THROW' | 'CURSOR_ITEM_BAD_THROW' | 'CURSOR_ITEM_GIVE';
export type CatcherKind = 'catch' | 'pass' | 'give' | 'reload';
export type ItemPointerAction = 'give' | 'drop' | 'pass' | 'toss';
export type ItemTileText = 'drop' | 'throw';

export interface ValidCatcher {
  readonly soldier: number;
  readonly kind: CatcherKind;
}

export interface ItemPointerAim {
  readonly holder: SoldierView;
  readonly target: SoldierView | null;
  readonly mapPos: number;
  readonly alternative: boolean;
  readonly inCombat: boolean;
  readonly moving: (s: SoldierView) => boolean;
}

export interface ItemTileFrame extends Omit<ItemPointerAim, 'alternative'> {
  readonly cursor: ItemCursor;
  readonly level: number;
  readonly stationary: boolean;
  readonly recalc: boolean;
  readonly hint: <T>(request: CommandEnvelope) => HintState<T>;
}

interface Talkable {
  readonly mercs: boolean;
  readonly checkCollapsed: boolean;
}

const isRobotBody = (s: SoldierView) => s.bodyType === Body.ROBOTNOWEAPON;

function givesTo(aim: ItemPointerAim, target: SoldierView, rule: Talkable): boolean {
  if (isRobotBody(aim.holder) || isDead(target) || isVehicleBody(target)) return false;
  if (rule.checkCollapsed && isUnconscious(target)) return false;
  const npc = target.team !== OUR_TEAM && target.talkable === 'npc';
  const valid = npc || isEpc(target) || (target.team === OUR_TEAM && rule.mercs);
  return valid && (aim.inCombat || !aim.moving(target));
}

function gives(aim: ItemPointerAim, checkAlternativeCollapsed: boolean): boolean {
  const target = aim.target;
  if (!target) return false;
  const byDefault = givesTo(aim, target, { mercs: false, checkCollapsed: true });
  if (!aim.alternative) return byDefault;
  return !byDefault && givesTo(aim, target, { mercs: true, checkCollapsed: checkAlternativeCollapsed });
}

function takesPass(target: SoldierView): boolean {
  return target.team === OUR_TEAM && !isEpc(target) && !isVehicleBody(target);
}

export function itemPointerAction(aim: ItemPointerAim): ItemPointerAction {
  if (gives(aim, true)) return 'give';
  const { holder, target } = aim;
  const distance = pythSpacesAway(holder.gridNo, aim.mapPos);
  if (distance <= DROPPING_DISTANCE && (!target || target.id === holder.id)) return 'drop';
  if (target && distance <= PASSING_ITEM_DISTANCE_OKLIFE && takesPass(target)) return 'pass';
  return 'toss';
}

function catcherOf(aim: ItemPointerAim, giving: boolean): ValidCatcher | null {
  const { holder, target } = aim;
  if (!target) return null;
  if (giving) return { soldier: target.id, kind: isRobotBody(target) ? 'reload' : 'give' };
  if (aim.mapPos === holder.gridNo || !takesPass(target)) return null;
  const pass = pythSpacesAway(holder.gridNo, aim.mapPos) <= PASSING_ITEM_DISTANCE_OKLIFE;
  return { soldier: target.id, kind: pass ? 'pass' : 'catch' };
}

export class ItemTileCursor {
  #alternative: { cursor: ItemCursor | null; on: boolean } = { cursor: null, on: false };
  #lastMapPos = -1;
  #badThrow = false;
  #landing: { gridNo: number; level: number } | null = null;
  #ap = 0;
  #cursor: ItemTileCursorName | null = null;
  #text: ItemTileText | null = null;
  #showAp = false;
  #walkUpTo: number | null = null;
  #catcher: ValidCatcher | null = null;
  #trajectory = false;

  get cursor(): ItemTileCursorName | null {
    return this.#cursor;
  }

  get text(): ItemTileText | null {
    return this.#text;
  }

  get actionPoints(): number {
    return this.#ap;
  }

  get showsActionPoints(): boolean {
    return this.#showAp;
  }

  get walkUpTo(): number | null {
    return this.#walkUpTo;
  }

  get catcher(): ValidCatcher | null {
    return this.#catcher;
  }

  get badThrow(): boolean {
    return this.#badThrow;
  }

  get landing(): { readonly gridNo: number; readonly level: number; readonly good: boolean } | null {
    return this.#trajectory && this.#landing ? { ...this.#landing, good: !this.#badThrow } : null;
  }

  alternative(cursor: ItemCursor): boolean {
    return this.#alternative.cursor === cursor && this.#alternative.on;
  }

  swap(cursor: ItemCursor): void {
    this.#alternative = { cursor, on: !this.alternative(cursor) };
  }

  clear(): void {
    this.#cursor = null;
    this.#text = null;
    this.#showAp = false;
    this.#walkUpTo = null;
    this.#catcher = null;
    this.#trajectory = false;
  }

  frame(frame: ItemTileFrame): void {
    this.clear();
    if (frame.mapPos !== this.#lastMapPos && this.alternative(frame.cursor)) this.#alternative = { cursor: frame.cursor, on: false };
    this.#lastMapPos = frame.mapPos;
    if (!frame.stationary) this.#landing = null;
    const f = { ...frame, alternative: this.alternative(frame.cursor) };
    const giving = gives(f, false);
    this.#catcher = catcherOf(f, giving);
    if (giving) this.#giveCursor(f);
    else this.#throwCursor(f);
  }

  #giveCursor(f: ItemTileFrame): void {
    this.#cursor = 'CURSOR_ITEM_GIVE';
    const target = f.target;
    if (!target) return;
    this.#showAp = f.inCombat;
    if (!f.stationary) return;
    const preview = dataOf(
      f.hint<PreviewAction>({
        type: 'previewAction',
        soldier: f.holder.id,
        kind: 'give',
        gridNo: target.gridNo,
        level: target.level,
        target: target.id,
      }),
    );
    if (!preview) return;
    this.#walkUpTo = preview.actionGridNo;
    this.#ap = preview.apCost;
  }

  #throwCursor(f: ItemTileFrame): void {
    const distance = pythSpacesAway(f.holder.gridNo, f.mapPos);
    const catcher = this.#catcher;
    this.#showAp = f.inCombat;
    const drops = distance <= DROPPING_DISTANCE && catcher === null;
    this.#ap = drops || catcher?.kind === 'pass' ? AP_PICKUP_ITEM : AP_TOSS_ITEM;
    this.#cursor = 'CURSOR_ITEM_GOOD_THROW';
    if (drops) {
      this.#text = 'drop';
      return;
    }
    if (f.mapPos === f.holder.gridNo) this.#landing = null;
    else if (catcher?.kind !== 'pass') {
      if (catcher === null) this.#text = 'throw';
      this.#trajectory = true;
      if (f.recalc) this.#recalculate(f);
    }
    if (this.#badThrow) this.#cursor = 'CURSOR_ITEM_BAD_THROW';
  }

  #recalculate(f: ItemTileFrame): void {
    const fields = tossFields(f.cursor);
    if (!fields) return;
    const request = { type: 'previewAction', soldier: f.holder.id, kind: 'toss', gridNo: f.mapPos, level: f.level, ...fields };
    const preview = dataOf(f.hint<PreviewAction>(request));
    if (!preview || preview.landsAt === undefined) return;
    this.#badThrow = preview.pathClear === false;
    this.#landing = { gridNo: preview.landsAt, level: preview.landsOnLevel ?? 0 };
  }
}

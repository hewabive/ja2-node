import { describe, expect, it } from 'vitest';
import { Body } from '../../../../content/anim/body-types.ts';
import { gridNo } from '../../../../content/world/grid.ts';
import type { PreviewAction } from '../../../../protocol/hints.ts';
import type { CommandEnvelope } from '../../../../protocol/messages.ts';
import type { SoldierView } from '../../../../protocol/view.ts';
import { cursorFromSlot, type ItemCursor } from '../item-cursor.ts';
import type { HintState } from './hints.ts';
import {
  AP_PICKUP_ITEM,
  AP_TOSS_ITEM,
  type ItemPointerAim,
  ItemTileCursor,
  type ItemTileFrame,
  itemPointerAction,
} from './item-tile-cursor.ts';

const OUR_TEAM = 0;
const ENEMY_TEAM = 1;
const CIV_TEAM = 4;
const POCKET = 7;
const HOLDER_AT = gridNo(80, 80);
const BESIDE = gridNo(81, 80);
const THREE_AWAY = gridNo(83, 80);
const FOUR_AWAY = gridNo(84, 80);
const FAR = gridNo(90, 80);
const WALK_UP = gridNo(89, 80);
const GIVE_AP = 5;

function view(id: number, team: number, at: number, extra: Partial<SoldierView> = {}): SoldierView {
  return {
    id,
    team,
    name: `S${id}`,
    bodyType: 0,
    gridNo: at,
    x: 0,
    y: 0,
    level: 0,
    direction: 0,
    animation: 0,
    frame: 0,
    palettes: ['', '', '', ''],
    hand: '',
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
    life: 80,
    ...extra,
  };
}

const holder = view(0, OUR_TEAM, HOLDER_AT, { inventory: [{ slot: POCKET, item: 'FIRSTAIDKIT', index: 1, count: 1, status: [100] }] });

function aim(target: SoldierView | null, mapPos: number, extra: Partial<ItemPointerAim> = {}): ItemPointerAim {
  return { holder, target, mapPos: target?.gridNo ?? mapPos, alternative: false, inCombat: false, moving: () => false, ...extra };
}

const mate = (at: number, extra: Partial<SoldierView> = {}) => view(1, OUR_TEAM, at, extra);

describe('what a click with the item cursor does (Interface_Items.cc HandleItemPointerClick)', () => {
  it('drops on his tile and the next one, passes to a merc of ours within 3 tiles and tosses beyond', () => {
    expect(itemPointerAction(aim(null, HOLDER_AT))).toBe('drop');
    expect(itemPointerAction(aim(holder, HOLDER_AT))).toBe('drop');
    expect(itemPointerAction(aim(null, BESIDE))).toBe('drop');
    expect(itemPointerAction(aim(null, gridNo(82, 80)))).toBe('toss');
    expect(itemPointerAction(aim(mate(BESIDE), BESIDE))).toBe('pass');
    expect(itemPointerAction(aim(mate(THREE_AWAY), THREE_AWAY))).toBe('pass');
    expect(itemPointerAction(aim(mate(FOUR_AWAY), FOUR_AWAY))).toBe('toss');
  });

  it('gives to a talkable NPC, an escort and the robot at any distance, but tosses at a plain civilian', () => {
    expect(itemPointerAction(aim(view(5, CIV_TEAM, FAR, { talkable: 'npc' }), FAR))).toBe('give');
    expect(itemPointerAction(aim(mate(FAR, { kind: 'epc' }), FAR))).toBe('give');
    expect(itemPointerAction(aim(mate(FAR, { kind: 'epc', bodyType: Body.ROBOTNOWEAPON }), FAR))).toBe('give');
    expect(itemPointerAction(aim(view(6, CIV_TEAM, FAR, { talkable: 'civilian' }), FAR))).toBe('toss');
  });

  it('swaps give and throw on the right click: a squad mate takes a give, an NPC and an escort a toss', () => {
    const alternative = { alternative: true };
    expect(itemPointerAction(aim(mate(FAR), FAR, alternative))).toBe('give');
    expect(itemPointerAction(aim(view(5, CIV_TEAM, FAR, { talkable: 'npc' }), FAR, alternative))).toBe('toss');
    expect(itemPointerAction(aim(mate(BESIDE, { kind: 'epc' }), BESIDE, alternative))).toBe('toss');
  });

  it('gives on the right click to a squad mate by his collapse, as the server refuses a give to a collapsed target, not by his life', () => {
    const alternative = { alternative: true };
    const hint = (collapsed: boolean) => ({
      skills: [0, 0] as const,
      personality: 0,
      shock: 0,
      lastTarget: -1,
      tilesMoved: 0,
      weightAtTurnStart: 0,
      collapsed,
      gassed: false,
      underAiControl: false,
    });
    expect(itemPointerAction(aim(mate(FAR, { hint: hint(true) }), FAR, alternative))).toBe('toss');
    expect(itemPointerAction(aim(mate(FAR, { life: 5, hint: hint(false) }), FAR, alternative))).toBe('give');
    expect(itemPointerAction(aim(mate(FAR, { kind: 'epc', hint: hint(true) }), FAR))).toBe('toss');
  });

  it('tosses at an NPC walking by out of combat, whom combat lets take a give', () => {
    const walker = view(5, CIV_TEAM, FAR, { talkable: 'npc' });
    expect(itemPointerAction(aim(walker, FAR, { moving: () => true }))).toBe('toss');
    expect(itemPointerAction(aim(walker, FAR, { moving: () => true, inCombat: true }))).toBe('give');
  });

  it('tosses at an enemy next to him, though the cursor there says Drop, as the original does', () => {
    const enemy = view(20, ENEMY_TEAM, BESIDE);
    expect(itemPointerAction(aim(enemy, BESIDE))).toBe('toss');
    const tile = new ItemTileCursor();
    tile.frame(frame(enemy, BESIDE));
    expect([tile.text, tile.actionPoints]).toEqual(['drop', AP_PICKUP_ITEM]);
  });
});

function cursorOf(): ItemCursor {
  const cursor = cursorFromSlot(holder, POCKET, true);
  if (!cursor) throw new Error('no cursor');
  return cursor;
}

const CURSOR = cursorOf();

type Answers = Readonly<Record<string, Partial<PreviewAction>>>;

function frame(target: SoldierView | null, mapPos: number, extra: Partial<ItemTileFrame> = {}, answers: Answers = {}): ItemTileFrame {
  const hint = <T>(request: CommandEnvelope): HintState<T> => {
    const data = answers[String(request.kind)];
    return data ? { state: 'ok', data: data as T } : { state: 'pending' };
  };
  const { alternative: _, ...pointer } = aim(target, mapPos);
  return { ...pointer, cursor: CURSOR, level: 0, stationary: true, recalc: true, hint, ...extra };
}

describe('the item tile cursor over the map (Interface_Items.cc DrawItemTileCursor)', () => {
  it('says Drop next to him for a pickup’s AP and Throw beyond for AP_TOSS_ITEM, the landing tile once the pointer rests', () => {
    const tile = new ItemTileCursor();
    tile.frame(frame(null, BESIDE, { inCombat: true }));
    expect([tile.cursor, tile.text, tile.actionPoints, tile.showsActionPoints, tile.landing]).toEqual([
      'CURSOR_ITEM_GOOD_THROW',
      'drop',
      AP_PICKUP_ITEM,
      true,
      null,
    ]);
    tile.frame(frame(null, FAR, { recalc: false }, { toss: { landsAt: FAR, landsOnLevel: 0, pathClear: true } }));
    expect([tile.text, tile.actionPoints, tile.showsActionPoints, tile.landing]).toEqual(['throw', AP_TOSS_ITEM, false, null]);
    tile.frame(frame(null, FAR, {}, { toss: { landsAt: FAR, landsOnLevel: 0, pathClear: true } }));
    expect(tile.landing).toEqual({ gridNo: FAR, level: 0, good: true });
  });

  it('turns the crosshair bad where the toss cannot get through and keeps it so until the next rest, as gfBadThrowItemCTGH', () => {
    const tile = new ItemTileCursor();
    tile.frame(frame(null, FAR, {}, { toss: { landsAt: FAR - 3, landsOnLevel: 0, pathClear: false } }));
    expect([tile.cursor, tile.landing]).toEqual(['CURSOR_ITEM_BAD_THROW', { gridNo: FAR - 3, level: 0, good: false }]);
    tile.frame(frame(null, gridNo(95, 80), { stationary: false, recalc: false }));
    expect([tile.cursor, tile.landing, tile.badThrow]).toEqual(['CURSOR_ITEM_BAD_THROW', null, true]);
  });

  it('marks a squad mate within 3 tiles as the pass with a pickup’s AP and no text, one farther as the catcher', () => {
    const tile = new ItemTileCursor();
    tile.frame(frame(mate(THREE_AWAY), THREE_AWAY));
    expect([tile.text, tile.actionPoints, tile.catcher, tile.landing]).toEqual([null, AP_PICKUP_ITEM, { soldier: 1, kind: 'pass' }, null]);
    tile.frame(frame(mate(FAR), FAR, {}, { toss: { landsAt: FAR, landsOnLevel: 0, pathClear: true } }));
    expect([tile.text, tile.actionPoints, tile.catcher]).toEqual([null, AP_TOSS_ITEM, { soldier: 1, kind: 'catch' }]);
  });

  it('shows the give cursor over an NPC with the walk-up tile and the give’s AP once the pointer rests', () => {
    const tile = new ItemTileCursor();
    const npc = view(5, CIV_TEAM, FAR, { talkable: 'npc' });
    const give = { actionGridNo: WALK_UP, apCost: GIVE_AP };
    tile.frame(frame(npc, FAR, { stationary: false }, { give }));
    expect([tile.cursor, tile.walkUpTo, tile.catcher]).toEqual(['CURSOR_ITEM_GIVE', null, { soldier: 5, kind: 'give' }]);
    tile.frame(frame(npc, FAR, {}, { give }));
    expect([tile.walkUpTo, tile.actionPoints]).toEqual([WALK_UP, GIVE_AP]);
    tile.frame(frame(mate(FAR, { kind: 'epc', bodyType: Body.ROBOTNOWEAPON }), FAR, {}, { give }));
    expect(tile.catcher).toEqual({ soldier: 1, kind: 'reload' });
  });

  it('swaps give and throw with a right click until the pointer moves to another tile or a new object is held', () => {
    const tile = new ItemTileCursor();
    const npc = view(5, CIV_TEAM, FAR, { talkable: 'npc' });
    tile.frame(frame(npc, FAR));
    expect(tile.cursor).toBe('CURSOR_ITEM_GIVE');
    tile.swap(CURSOR);
    tile.frame(frame(npc, FAR));
    expect(tile.cursor).toBe('CURSOR_ITEM_GOOD_THROW');
    tile.frame(frame({ ...npc, gridNo: FAR + 1 }, FAR + 1));
    expect([tile.cursor, tile.alternative(CURSOR)]).toEqual(['CURSOR_ITEM_GIVE', false]);
    tile.swap(CURSOR);
    expect([tile.alternative(CURSOR), tile.alternative(cursorOf())]).toEqual([true, false]);
  });
});

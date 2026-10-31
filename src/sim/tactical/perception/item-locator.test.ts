import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem } from '../../items/object.ts';
import { anim } from '../anim-states.ts';
import { states } from '../animation.ts';
import { reduceAttackBusyCount } from '../combat/barrier.ts';
import { handleSoldierDeath } from '../combat/death.ts';
import { eventSoldierBeginBladeAttack } from '../combat/melee.ts';
import type { TacticalContent } from '../content.ts';
import { handleSoldierThrowItem } from '../explosions/throwing.ts';
import { InvSlot } from '../inventory.ts';
import { tacticalPanelEnv } from '../inventory-commands.ts';
import { soldierDropObject } from '../item-actions.ts';
import { Body, ReasonCantFinishMove, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { enterCombatMode } from '../turns/turns.ts';
import { addItemToPool, notifySoldiersToLookForItems, Visibility, type WorldItem } from '../world-items.ts';
import { revealRoofsAndItems } from './fov.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_AT = gridNo(80, 80);
const IN_VIEW = gridNo(80, 84);
const FURTHER_IN_VIEW = gridNo(80, 86);
const FAR_AWAY = gridNo(80, 100);
const ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY] ?? 20;
const MAX_FRAME_TICKS = 100;

const itemIndex = (name: string) => content.items.byName.get(name)?.index ?? -1;
const glock = () => createItem(content.items, itemIndex('GLOCK_17'), 100);

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly merc: Soldier;
  readonly signalled: number[];
}

function scene(): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
  const signalled: number[] = [];
  t.narrative = { ...t.narrative, signalItemLocatorStart: (s) => signalled.push(s.id) };
  return { sim, t, merc, signalled };
}

function inCombat(s: Scene): Soldier {
  const enemy = spawnSoldier(s.sim, ENEMY_ID + 5, Team.ENEMY, FAR_AWAY, Direction.NORTH);
  enterCombatMode(s.t, Team.OUR);
  expect(s.t.inCombat).toBe(true);
  s.merc.noAPToFinishMove = false;
  s.merc.reasonCantFinishMove = ReasonCantFinishMove.NO_APS;
  return enemy;
}

function hiddenItem(t: TacticalState, at = IN_VIEW): WorldItem {
  const item = addItemToPool(t, at, glock(), Visibility.INVISIBLE, 0);
  if (!item) throw new Error('no item placed');
  return item;
}

function kill(s: Scene, at = IN_VIEW, id = ENEMY_ID): Soldier {
  const victim = spawnSoldier(s.sim, id, Team.ENEMY, at, Direction.NORTH);
  victim.life = 0;
  handleSoldierDeath(s.t, victim);
  return victim;
}

const dropsAt = (t: TacticalState, at: number) => t.worldItems.filter((i) => i.gridNo === at).map((i) => i.visible);
const revealed = (t: TacticalState) => t.events.filter((e) => e.type === 'itemsRevealed').map((e) => e.gridNo);

function stepUntilLooked(s: Scene): void {
  for (let k = 0; k < MAX_FRAME_TICKS && s.merc.lookForItems; k++) s.sim.step();
  expect(s.merc.lookForItems).toBe(false);
}

describe('items seen at a death (Rotting_Corpses.cc TurnSoldierIntoCorpse, Handle_Items.cc AllSoldiersLookforItems)', () => {
  it('shows a merc the drops of an enemy who dies in his view at once, with their locator and one items-seen quote', () => {
    const s = scene();
    kill(s);
    expect(dropsAt(s.t, IN_VIEW)).toEqual([Visibility.VISIBLE]);
    expect(revealed(s.t)).toEqual([IN_VIEW]);
    expect(s.signalled).toEqual([s.merc.id]);
    expect(s.t.turn.lockItemLocators).toBe(true);
  });

  it('halts a merc who sees the drops in combat', () => {
    const s = scene();
    inCombat(s);
    kill(s);
    expect(s.merc.noAPToFinishMove).toBe(true);
    expect(s.merc.reasonCantFinishMove).toBe(ReasonCantFinishMove.STOPPED_SIGHT);
  });

  it('ends the melee attack of a merc who sees the drops while he crouches to stab (Soldier_Control.cc HaultSoldierFromSighting)', () => {
    const s = scene();
    inCombat(s);
    s.merc.inv[InvSlot.HAND] = createItem(content.items, itemIndex('COMBAT_KNIFE'), 100);
    const prone = spawnSoldier(s.sim, ENEMY_ID + 1, Team.ENEMY, gridNo(80, 81), Direction.NORTH);
    prone.state = states(content.animations).PRONE;
    eventSoldierBeginBladeAttack(s.t, s.merc, prone.gridNo, Direction.SOUTH);
    expect(content.animations.controls[s.merc.pendingAnimation]?.id).toBe('CROUCH_STAB');
    expect(s.t.turn.attackBusyCount).toBe(1);
    kill(s);
    expect(s.t.turn.attackBusyCount).toBe(0);
  });

  it('unlocks the item locators when the creature queen dies, so a merc in combat comments on her blood', () => {
    const s = scene();
    inCombat(s);
    s.t.turn.lockItemLocators = true;
    const queen = spawnSoldier(s.sim, TEAM_FIRST_ID[Team.CREATURE] ?? 0, Team.CREATURE, IN_VIEW, Direction.NORTH);
    queen.bodyType = Body.QUEENMONSTER;
    queen.state = anim(s.t.content, 'QUEEN_DIE');
    queen.life = 0;
    handleSoldierDeath(s.t, queen);
    expect(dropsAt(s.t, FURTHER_IN_VIEW).every((v) => v === Visibility.VISIBLE)).toBe(true);
    expect(s.signalled).toEqual([s.merc.id]);
  });
});

describe('looking for new items (Handle_Items.cc NotifySoldiersToLookforItems, Overhead.cc ExecuteOverhead)', () => {
  it('makes every soldier look for items at his next animation frame, quietly: no locator, quote or halt', () => {
    const s = scene();
    inCombat(s);
    const item = hiddenItem(s.t);
    notifySoldiersToLookForItems(s.t);
    expect(s.t.mercSlots.filter((m) => m !== null).every((m) => m.lookForItems)).toBe(true);
    expect(item.visible).toBe(Visibility.INVISIBLE);
    stepUntilLooked(s);
    expect(item.visible).toBe(Visibility.VISIBLE);
    expect(revealed(s.t)).toEqual([]);
    expect(s.signalled).toEqual([]);
    expect(s.merc.noAPToFinishMove).toBe(false);
  });

  it('is ordered by an item dropped where a crouched merc stands', () => {
    const s = scene();
    s.merc.state = states(content.animations).CROUCHING;
    soldierDropObject(s.t, s.merc, glock());
    expect(s.merc.lookForItems).toBe(true);
  });

  it('is ordered by an item thrown at the thrower’s own tile', () => {
    const s = scene();
    s.merc.tempObject = glock();
    handleSoldierThrowItem(s.t, s.merc, s.merc.gridNo);
    expect(s.merc.lookForItems).toBe(true);
  });

  it('is ordered by an item cursor that falls to the ground when it is cancelled (Interface_Items.cc CancelItemPointer)', () => {
    const s = scene();
    tacticalPanelEnv(s.t).leftover(s.merc, glock());
    expect(s.merc.lookForItems).toBe(true);
  });

  it('is ordered by a dud grenade that lands, so its thrower sees it lying there (Physics.cc HandleArmedObjectImpact)', () => {
    const s = scene();
    inCombat(s);
    const grenade = itemIndex('HAND_GRENADE');
    s.merc.inv[InvSlot.HAND] = createItem(content.items, grenade, 10);
    expect(s.sim.dispatch({ type: 'attack', soldier: s.merc.id, target: IN_VIEW })).toEqual({ ok: true });
    runUntilIdle(s.sim);
    stepUntilLooked(s);
    const dud = s.t.worldItems.find((i) => i.object.item === grenade);
    expect(dud?.visible).toBe(Visibility.VISIBLE);
  });
});

describe('the item locator lock and the items-seen quote (FOV.cc RevealRoofsAndItems)', () => {
  it('says one quote for a look that shows items on several tiles', () => {
    const s = scene();
    hiddenItem(s.t, IN_VIEW);
    hiddenItem(s.t, FURTHER_IN_VIEW);
    revealRoofsAndItems(s.t, s.merc, true);
    expect(revealed(s.t)).toEqual([IN_VIEW, FURTHER_IN_VIEW]);
    expect(s.signalled).toEqual([s.merc.id]);
  });

  it('keeps a merc quiet in combat while the locators are locked, and unlocks them first out of combat', () => {
    const quotes = (combat: boolean) => {
      const s = scene();
      if (combat) inCombat(s);
      s.t.turn.lockItemLocators = true;
      hiddenItem(s.t);
      revealRoofsAndItems(s.t, s.merc, true);
      return s.signalled.length;
    };
    expect(quotes(true)).toBe(0);
    expect(quotes(false)).toBe(1);
  });

  it('holds the quote of items seen during an attack in combat until the attack ends on our turn', () => {
    const s = scene();
    inCombat(s);
    s.t.turn.attackBusyCount = 1;
    hiddenItem(s.t);
    revealRoofsAndItems(s.t, s.merc, true);
    expect(s.signalled).toEqual([]);
    expect(s.t.turn.itemsSeenOnAttack).toBe(s.merc);
    s.t.turn.currentTeam = Team.ENEMY;
    s.t.turn.attackBusyCount = 1;
    reduceAttackBusyCount(s.t, null, false);
    expect(s.signalled).toEqual([]);
    s.t.turn.currentTeam = Team.OUR;
    s.t.turn.attackBusyCount = 1;
    reduceAttackBusyCount(s.t, null, false);
    expect(s.signalled).toEqual([s.merc.id]);
    expect(s.t.turn.itemsSeenOnAttack).toBeNull();
  });

  it('forgets a held quote when combat starts again', () => {
    const s = scene();
    s.t.turn.itemsSeenOnAttack = s.merc;
    inCombat(s);
    expect(s.t.turn.itemsSeenOnAttack).toBeNull();
  });

  it('lets an EPC unlock the locators instead of speaking', () => {
    const s = scene();
    s.t.narrative = { ...s.t.narrative, isEpc: () => true };
    hiddenItem(s.t);
    revealRoofsAndItems(s.t, s.merc, true);
    expect(s.signalled).toEqual([]);
    expect(s.t.turn.lockItemLocators).toBe(false);
  });
});

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Explosion_Control.cc BOMB_QUEUE_DELAY, MAX_BOMB_QUEUE, gExplosionQueue, AddBombToQueue,
// @src HandleExplosionQueue, DecayBombTimers, SetOffBombsByFrequency, SetOffPanicBombs, SetOffBombsInGridNo,
// @src ActivateSwitchInGridNo, RemoveAllActiveTimedBombs; Explosion_Control.h ExplosionQueueElement.

import { type ExplosiveDef, ItemClass } from '../../../content/items/items.ts';
import type { ItemObject } from '../../items/object.ts';
import { FIRST_PANIC_TRIGGER, PanicFlags } from '../ai/panic-triggers.ts';
import { callAvailableEnemiesTo } from '../doors/door-traps.ts';
import { igniteExplosion } from '../explosions/explosion.ts';
import { newLightEffect } from '../explosions/light.ts';
import { revealRoofsAndItems } from '../perception/fov.ts';
import { allTeamsLookForAll } from '../perception/sight.ts';
import { NOWHERE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';
import { removeWorldItem, type WorldItem } from '../world-items.ts';
import {
  actionValueOf,
  bombItemOf,
  bombOwnerIdOf,
  Detonator,
  delayOf,
  detonatorOf,
  frequencyOf,
  ItemAction,
  isDisabledBomb,
  PANIC_FREQUENCIES,
  placedBySoldier,
  setDelay,
} from './bomb-object.ts';
import { performItemAction } from './item-action.ts';
import { clearMineFlag, hasMineFlag, MineFlag, removeBlueFlag } from './mine-flags.ts';
import { isActiveTimedBomb } from './world-bombs.ts';

export interface QueuedBomb {
  readonly bomb: number;
  readonly timestamp: number;
  exists: boolean;
}

export interface ExplosionQueue {
  readonly entries: QueuedBomb[];
  active: boolean;
  mayHaveChangedSight: boolean;
  person: Soldier | null;
}

export const MAX_BOMB_QUEUE = 40;
const BOMB_QUEUE_BASE_DELAY_MS = 1000;
const BOMB_QUEUE_DELAY_SPREAD_MS = 500;
const GROUND_HEIGHT = 0;

function itemIndex(t: TacticalState, name: string): number {
  return t.content.items.byName.get(name)?.index ?? -1;
}

function isActionItem(t: TacticalState, o: ItemObject): boolean {
  return o.item === itemIndex(t, 'ACTION_ITEM');
}

function blowsUp(t: TacticalState, o: ItemObject): boolean {
  return !isActionItem(t, o) || actionValueOf(o) === ItemAction.BLOW_UP;
}

function bombQueueDelay(t: TacticalState): number {
  return BOMB_QUEUE_BASE_DELAY_MS + t.rng.int(BOMB_QUEUE_DELAY_SPREAD_MS);
}

function bombOwner(t: TacticalState, o: ItemObject): Soldier | null {
  const id = bombOwnerIdOf(o);
  return id === null ? null : (t.soldiers[id] ?? null);
}

function addBombToQueue(t: TacticalState, bomb: number, timestamp: number): void {
  const q = t.explosionQueue;
  if (q.entries.length === MAX_BOMB_QUEUE) return;
  q.entries.push({ bomb, timestamp, exists: true });
  if (q.active) return;
  q.active = true;
  t.perception.disallowSight = true;
}

function queueBomb(t: TacticalState, bomb: number, o: ItemObject, timestamp: number): number {
  addBombToQueue(t, bomb, timestamp);
  return blowsUp(t, o) ? timestamp + bombQueueDelay(t) : timestamp;
}

export function decayBombTimers(t: TacticalState): void {
  let timestamp = t.clockMs;
  t.worldBombs.forEach((slot, bomb) => {
    const o = slot.item.object;
    if (!slot.exists || detonatorOf(o) !== Detonator.TIMED || isDisabledBomb(o)) return;
    setDelay(o, delayOf(o) - 1);
    if (delayOf(o) !== 0) return;
    t.explosionQueue.person = bombOwner(t, o);
    timestamp = queueBomb(t, bomb, o, timestamp);
  });
}

export function setOffBombsByFrequency(t: TacticalState, s: Soldier | null, frequency: number): void {
  let timestamp = t.clockMs;
  t.worldBombs.forEach((slot, bomb) => {
    const o = slot.item.object;
    if (!slot.exists || detonatorOf(o) !== Detonator.REMOTE || isDisabledBomb(o)) return;
    if (frequencyOf(o) !== frequency) return;
    t.explosionQueue.person = s;
    timestamp = queueBomb(t, bomb, o, timestamp);
  });
}

export function setOffPanicBombs(t: TacticalState, s: Soldier, trigger: number): void {
  const panic = t.panic;
  const pulled = panic.triggers[trigger];
  if (pulled) pulled.gridNo = NOWHERE;
  if (panic.triggers.every((x) => x.gridNo === NOWHERE)) panic.flags &= ~PanicFlags.TRIGGERS_HERE;
  const frequency = PANIC_FREQUENCIES[trigger];
  if (frequency !== undefined) setOffBombsByFrequency(t, s, frequency);
  if (trigger === FIRST_PANIC_TRIGGER) panic.flags &= ~PanicFlags.BOMBS_HERE;
  if (panic.flags) t.turnHooks.makeClosestEnemyChosenOne(t);
}

function setOffByStep(t: TacticalState, s: Soldier, o: ItemObject): boolean {
  if (s.team === Team.OUR) return true;
  return t.content.items.byIndex.get(o.item)?.explosive?.pressureTriggered === true;
}

function ignoredByFriends(s: Soldier, o: ItemObject): boolean {
  return placedBySoldier(o) && (s.team === Team.OUR || s.team === Team.MILITIA);
}

function isExplosiveItem(t: TacticalState, item: number): boolean {
  return ((t.content.items.byIndex.get(item)?.itemClass ?? 0) & (ItemClass.GRENADE | ItemClass.BOMB)) !== 0;
}

export function setOffBombsInGridNo(t: TacticalState, s: Soldier, g: number, allBombs: boolean, level: number): boolean {
  let timestamp = t.clockMs;
  let foundMine = false;
  t.worldBombs.forEach((slot, bomb) => {
    const item = slot.item;
    const o = item.object;
    if (!slot.exists || item.gridNo !== g || item.level !== level || isDisabledBomb(o)) return;
    if (!allBombs && detonatorOf(o) !== Detonator.PRESSURE) return;
    if (!allBombs && !setOffByStep(t, s, o)) return;
    if (ignoredByFriends(s, o)) return;
    if (o.item === itemIndex(t, 'SWITCH')) {
      setOffBombsByFrequency(t, s, frequencyOf(o));
      return;
    }
    t.explosionQueue.person = s;
    timestamp = queueBomb(t, bomb, o, timestamp);
    if (isExplosiveItem(t, bombItemOf(o))) foundMine = true;
  });
  return foundMine;
}

export function activateSwitchInGridNo(t: TacticalState, s: Soldier, g: number): void {
  for (const slot of t.worldBombs) {
    const o = slot.item.object;
    if (!slot.exists || slot.item.gridNo !== g) continue;
    if (o.item !== itemIndex(t, 'SWITCH') || isDisabledBomb(o) || detonatorOf(o) !== Detonator.SWITCH) continue;
    t.turn.attackBusyCount = 0;
    setOffBombsByFrequency(t, s, frequencyOf(o));
  }
}

export function removeAllActiveTimedBombs(t: TacticalState): void {
  for (const slot of t.worldBombs) if (slot.exists && isActiveTimedBomb(slot.item)) removeWorldItem(t, slot.item);
}

function causesExplosion(explosive: ExplosiveDef): boolean {
  return explosive.blast !== null || explosive.stun !== null || explosive.smoke !== null;
}

function setOffTrip(t: TacticalState, item: WorldItem, explosive: ExplosiveDef): void {
  if (explosive.noise) {
    t.events.push({ type: 'alarm', gridNo: item.gridNo, kind: 'klaxon' });
    callAvailableEnemiesTo(t, item.gridNo);
  }
  if (explosive.light) {
    newLightEffect(t, item.gridNo, explosive.light.radius, explosive.light.duration);
    removeWorldItem(t, item);
  }
}

function blowUp(t: TacticalState, item: WorldItem): void {
  const { gridNo, level, object } = item;
  t.explosionQueue.mayHaveChangedSight = true;
  removeWorldItem(t, item);
  if (hasMineFlag(t, gridNo, MineFlag.PLAYER)) removeBlueFlag(t, gridNo, level);
  clearMineFlag(t, gridNo, MineFlag.ENEMY);
  igniteExplosion(t, bombOwner(t, object), GROUND_HEIGHT, gridNo, bombItemOf(object), level);
}

function setOffQueuedBomb(t: TacticalState, item: WorldItem): void {
  const o = item.object;
  if (!blowsUp(t, o)) {
    if (performItemAction(t, item.gridNo, o)) t.explosionQueue.mayHaveChangedSight = true;
    return;
  }
  const explosive = t.content.items.byIndex.get(bombItemOf(o))?.explosive;
  if (!explosive) removeWorldItem(t, item);
  else if (!causesExplosion(explosive)) setOffTrip(t, item, explosive);
  else blowUp(t, item);
}

function shrinkQueue(q: ExplosionQueue): void {
  while (q.entries.length > 0 && !q.entries[q.entries.length - 1]?.exists) q.entries.pop();
}

function endQueue(t: TacticalState): void {
  const q = t.explosionQueue;
  t.perception.disallowSight = false;
  const person = q.person;
  if (person && person.team !== Team.OUR) t.turnHooks.freeUpNpcFromPendingAction(t, person);
  if (q.mayHaveChangedSight) {
    t.turn.interruptProvoker = person;
    allTeamsLookForAll(t, true);
    for (const m of teamMembers(t, Team.OUR)) revealRoofsAndItems(t, m, false);
    q.mayHaveChangedSight = false;
    q.person = null;
  }
  q.active = false;
}

export function handleExplosionQueue(t: TacticalState): void {
  const q = t.explosionQueue;
  if (!q.active) return;
  const now = t.clockMs;
  for (let k = 0; k < q.entries.length; k++) {
    const e = q.entries[k];
    if (!e?.exists || now < e.timestamp) continue;
    const slot = t.worldBombs[e.bomb];
    if (slot) setOffQueuedBomb(t, slot.item);
    e.exists = false;
  }
  shrinkQueue(q);
  if (q.entries.length === 0 && (!q.person || t.turn.attackBusyCount === 0)) endQueue(t);
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Weapons.cc ExplosiveEffectiveArmour, ArmourVersusExplosivesPercent;
// @src TileEngine/Explosion_Control.cc ReduceDamageAmount, DamageSoldierFromBlast. See docs/12 §10.4–§10.5.

import type { ItemTable } from '../../../content/items/items.ts';
import { i8, idiv } from '../../../core/int.ts';
import type { ItemObject } from '../../items/object.ts';
import { AnimHeight } from '../animation.ts';
import { findPlatesAttachment, type MaxArmour, maxArmourPerClass } from '../combat/armour.ts';
import { eventSoldierGotHit } from '../combat/hit.ts';
import { InvSlot } from '../inventory.ts';
import { directionToward } from '../movement.ts';
import { processImplicationsOfPCAttack } from '../narrative/civ-hostility.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';

const MAX_ARMOURED_WOUND = 35;
const VEST_SHARE = 65;
const HELMET_SHARE = 15;
const LEGS_SHARE = 25;

const maxArmourCache = new WeakMap<ItemTable, MaxArmour>();

function maxArmour(items: ItemTable): MaxArmour {
  let max = maxArmourCache.get(items);
  if (!max) {
    max = maxArmourPerClass(items);
    maxArmourCache.set(items, max);
  }
  return max;
}

export function explosiveEffectiveArmour(items: ItemTable, o: ItemObject | undefined): number {
  const armour = o ? items.byIndex.get(o.item)?.armour : undefined;
  if (!o || !armour) return 0;
  let value = idiv(armour.explosivesProtection * (o.status[0] ?? 0), 100);
  const plate = findPlatesAttachment(items, o);
  if (plate !== -1) {
    const a = o.attachments[plate] as { item: number; status: number };
    value += idiv((items.byIndex.get(a.item)?.armour?.protection ?? 0) * a.status, 100);
  }
  return i8(value);
}

function armourShare(items: ItemTable, o: ItemObject | undefined, share: number, best: number): number {
  if (!o?.item) return 0;
  return Math.min(share, idiv(share * explosiveEffectiveArmour(items, o), best));
}

export function armourVersusExplosivesPercent(t: TacticalState, s: Soldier): number {
  const items = t.content.items;
  const max = maxArmour(items);
  const vest = armourShare(items, s.inv[InvSlot.VEST], VEST_SHARE, max.vest);
  const helmet = armourShare(items, s.inv[InvSlot.HELMET], HELMET_SHARE, max.helmet);
  const legs = armourShare(items, s.inv[InvSlot.LEGS], LEGS_SHARE, max.leggings);
  return i8(helmet + vest + legs);
}

export function reduceDamageAmount(damage: number, radius: number, distance: number): number {
  let reduced = damage;
  if (radius === 0) return Math.max(reduced, 0);
  if (distance < radius) reduced -= Math.trunc((reduced * distance) / radius);
  else reduced = Math.trunc(Math.trunc(reduced / radius) / 2);
  return Math.max(reduced, 0);
}

export function damageSoldierFromBlast(
  t: TacticalState,
  s: Soldier,
  owner: Soldier | null,
  bombGridNo: number,
  wound: number,
  breath: number,
  distance: number,
  item: number,
): boolean {
  if (!s.placed || s.life === 0) return false;
  const hurt = t.explosives.hurtByExplosion;
  if (hurt[s.id]) return false;
  const direction = directionToward(s.gridNo, bombGridNo);
  t.turn.attackBusyCount++;
  const reduced = Math.max(0, wound - idiv(Math.min(wound, MAX_ARMOURED_WOUND) * armourVersusExplosivesPercent(t, s), 100));
  eventSoldierGotHit(t, s, item, reduced, breath, direction, distance, owner, 0, AnimHeight.CROUCH);
  hurt[s.id] = 1;
  if (owner && owner.team === Team.OUR && s.team !== Team.OUR) processImplicationsOfPCAttack(t, owner, s);
  return true;
}

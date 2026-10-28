// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc CheckItemForDamage, CheckForChainReaction, DamageItem, CheckEquipmentForDamage,
// @src DamageItemOnGround.

import { ItemClass, ItemFlags, NOTHING } from '../../../content/items/items.ts';
import { i8 } from '../../../core/int.ts';
import { deleteObject, type ItemObject, removeObjectAt, USABLE_STATUS } from '../../items/object.ts';
import { Body, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { igniteExplosion } from './explosion.ts';

const MAX_ITEM_DAMAGE = 100;
const OBLITERATE_DAMAGE = 10_000;
const OBLITERATE_REPLACEMENT = 2;
const JAR_SMASH_THRESHOLD = 5;
const ON_GROUND_VOLATILITY_BASE = 50;
const ON_GROUND_VOLATILITY_STEP = 10;
const JARS: readonly string[] = ['JAR_CREATURE_BLOOD', 'JAR', 'JAR_HUMAN_BLOOD', 'JAR_ELIXIR'];

const itemDef = (t: TacticalState, item: number) => t.content.items.byIndex.get(item);
const isTank = (s: Soldier) => s.bodyType === Body.TANK_NW || s.bodyType === Body.TANK_NE;

function isJar(t: TacticalState, item: number): boolean {
  const name = itemDef(t, item)?.name ?? '';
  return JARS.includes(name);
}

export function checkItemForDamage(t: TacticalState, item: number, maxDamageIn: number): number {
  let max = maxDamageIn === OBLITERATE_DAMAGE ? OBLITERATE_REPLACEMENT : maxDamageIn;
  const def = itemDef(t, item);
  if (def?.armour) max -= Math.trunc((max * def.armour.protection) / 100);
  if ((def?.flags ?? 0) & ItemFlags.METAL) max = Math.trunc(max / 2);
  else if (def?.name === 'BLOODCAT_PELT') max *= 2;
  if (max <= 0) return 0;
  return i8(Math.min(t.pre.int(max), MAX_ITEM_DAMAGE));
}

function checkForChainReaction(t: TacticalState, item: number, status: number, damage: number, onGround: boolean): boolean {
  let chance = itemDef(t, item)?.explosive?.volatility ?? 0;
  if (chance <= 0) return false;
  if (onGround) chance = ON_GROUND_VOLATILITY_BASE + (chance - 1) * ON_GROUND_VOLATILITY_STEP;
  chance = Math.trunc((chance * (100 + Math.trunc((100 - status + damage) / 2))) / 100);
  return t.pre.int(100) < chance;
}

function damageable(t: TacticalState, o: ItemObject): boolean {
  const def = itemDef(t, o.item);
  return ((def?.flags ?? 0) & ItemFlags.DAMAGEABLE) !== 0 || def?.itemClass === ItemClass.AMMO;
}

function damageOneObject(t: TacticalState, o: ItemObject, k: number, maxDamage: number): number {
  let damage = checkItemForDamage(t, o.item, maxDamage);
  if (isJar(t, o.item) && t.pre.int(damage) > JAR_SMASH_THRESHOLD) damage = o.status[k] ?? 0;
  if (itemDef(t, o.item)?.itemClass === ItemClass.AMMO) {
    if (t.pre.int(100) < damage) o.status[k] = 1;
  } else {
    o.status[k] = i8((o.status[k] ?? 0) - damage);
    if ((o.status[k] ?? 0) < 1) o.status[k] = 1;
  }
  return damage;
}

export function damageItem(t: TacticalState, o: ItemObject, maxDamage: number, onGround: boolean): boolean {
  if (!damageable(t, o) || o.count <= 0) return false;
  for (let k = 0; k < o.count; k++) {
    if (o.item === NOTHING || (o.status[k] ?? 0) <= 0) continue;
    const damage = damageOneObject(t, o, k, maxDamage);
    const def = itemDef(t, o.item);
    if (def && def.itemClass & (ItemClass.GRENADE | ItemClass.BOMB)) {
      if (checkForChainReaction(t, o.item, o.status[k] ?? 0, damage, onGround)) return true;
    }
    if ((o.status[k] ?? 0) === 1 && o.count > 1) {
      removeObjectAt(o, k);
      k--;
    }
  }
  for (const a of o.attachments) {
    if (a.item === NOTHING || a.status <= 0) continue;
    a.status = i8(a.status - checkItemForDamage(t, a.item, maxDamage));
    if (a.status < 1) a.status = 1;
  }
  return false;
}

export function checkEquipmentForDamage(t: TacticalState, s: Soldier, damage: number): void {
  if (isTank(s)) return;
  for (const o of s.inv) {
    if (!damageItem(t, o, damage, false)) continue;
    const owner = t.turn.attackBusyCount ? s.attacker : s;
    igniteExplosion(t, owner, 0, s.gridNo, o.item, s.level);
    deleteObject(o);
  }
}

export function damageItemOnGround(
  t: TacticalState,
  o: ItemObject,
  g: number,
  level: number,
  damage: number,
  owner: Soldier | null,
): boolean {
  if (damageItem(t, o, damage, true)) {
    igniteExplosion(t, owner, 0, g, o.item, level);
    return true;
  }
  return o.count < 2 && (o.status[0] ?? 0) < USABLE_STATUS;
}

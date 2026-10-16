// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Keys.cc SoldierHasKey, KeyExistsInKeyRing, KeyExistsInInventory, DropKeysInKeyRing;
// @src Items.cc CollectKey, CreateKeyObject; DefaultContentManager.cc getKeyItemForKeyId. See docs/25 §8.1.

import { ANYKEY, INVALID_KEY_NUMBER, lockAt } from '../../../content/formats/locks.ts';
import { ItemClass, NOTHING } from '../../../content/items/items.ts';
import { createItems, type ItemObject } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { worldSeconds } from '../explosions/state.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { addItemToPool } from '../world-items.ts';
import { NUM_KEYS } from './key-ring.ts';

const KEY_STATUS = 100;
const SECONDS_PER_DAY = 86400;
const SECTORS_PER_ROW = 16;

export interface KeyFound {
  sectorFound: number;
  dateFound: number;
}

export type KeyTable = KeyFound[];

export function createKeyTable(): KeyTable {
  return Array.from({ length: NUM_KEYS }, () => ({ sectorFound: 0, dateFound: 0 }));
}

const matches = (id: number, wanted: number) => id === wanted || wanted === ANYKEY;

export function keyExistsInKeyRing(s: Soldier, keyId: number): boolean {
  return s.keyRing?.some((k) => k.count !== 0 && matches(k.keyId, keyId)) ?? false;
}

function keyExistsInInventory(t: TacticalState, s: Soldier, keyId: number): boolean {
  return s.inv.some((o) => t.content.items.byIndex.get(o.item)?.itemClass === ItemClass.KEY && matches(o.keyId, keyId));
}

export function soldierHasKey(t: TacticalState, s: Soldier, keyId: number): boolean {
  return keyExistsInKeyRing(s, keyId) || keyExistsInInventory(t, s, keyId);
}

export function sectorByte(sector: { readonly x: number; readonly y: number }): number {
  return (sector.y - 1) * SECTORS_PER_ROW + (sector.x - 1);
}

export function collectKey(t: TacticalState, s: Soldier, o: ItemObject): void {
  if (s.team !== Team.OUR) return;
  const k = t.keyTable[o.keyId];
  if (k?.dateFound !== 0) return;
  k.dateFound = Math.trunc(worldSeconds(t) / SECONDS_PER_DAY);
  k.sectorFound = t.sector ? sectorByte(t.sector) : 0;
}

type KeyContent = Pick<TacticalContent, 'locks' | 'items'>;

export function keyItemForKeyId(content: KeyContent, keyId: number): number {
  const classIndex = lockAt(content.locks, keyId).keyItem;
  for (const def of content.items.ordered) if (def.itemClass === ItemClass.KEY && def.classIndex === classIndex) return def.index;
  return NOTHING;
}

export function createKeyObject(content: KeyContent, count: number, keyId: number): ItemObject | null {
  const item = keyItemForKeyId(content, keyId);
  if (item === NOTHING) return null;
  const o = createItems(content.items, item, KEY_STATUS, count);
  o.keyId = keyId;
  return o;
}

export function takeKeyRingObjects(content: KeyContent, s: Soldier): ItemObject[] {
  const objects: ItemObject[] = [];
  for (const k of s.keyRing ?? []) {
    if (k.count === 0) continue;
    const o = createKeyObject(content, k.count, k.keyId);
    k.count = 0;
    k.keyId = INVALID_KEY_NUMBER;
    if (o) objects.push(o);
  }
  return objects;
}

export function dropKeysInKeyRing(t: TacticalState, s: Soldier, gridNo: number, level: number, visible: number): void {
  for (const o of takeKeyRingObjects(t.content, s)) addItemToPool(t, gridNo, o, visible, level);
}

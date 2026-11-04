// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc BeginItemPointer (one object of a pocket, SHIFT the whole stack),
// @src BeginKeyRingItemPointer (one key off the ring, SHIFT every key of the position), the objects the item cursor's drop,
// @src give, pass and toss take; Items.cc RemoveKeysFromSlot, CreateKeyObject.

import { cloneObject, deleteObject, type ItemObject } from '../items/object.ts';
import type { TacticalContent } from './content.ts';
import type { KeyOnRing } from './doors/key-ring.ts';
import { createKeyObject } from './doors/keys.ts';
import { InvSlot } from './inventory.ts';
import { parseCount, parseKeySpot } from './inventory-commands.ts';
import { type Count, takeObjects } from './inventory-panel.ts';
import { addKeysToPosition, removeKeysFromPosition } from './key-ring-panel.ts';
import type { Soldier } from './soldier.ts';

type KeyContent = Pick<TacticalContent, 'locks' | 'items'>;

export interface PocketSource {
  readonly slot: number;
  readonly count: Count;
  readonly index: number;
}

export interface RingSource {
  readonly ring: number;
  readonly count: Count;
}

export type ItemSource = PocketSource | RingSource;

export type ItemSourceRefusal = 'badSlot' | 'emptySlot' | 'badCount' | 'badIndex';

export const ITEM_SOURCE_REFUSALS: Readonly<Record<ItemSourceRefusal, string>> = {
  badSlot: 'slot must be 0..18, a slot name such as "hand" or {"ring": 0..63} for keys on the key ring',
  emptySlot: 'that slot or key ring position is empty',
  badCount: 'count must be 1 or "all"',
  badIndex: 'index must point to an object in the stack',
};

export interface ItemSourceRequest {
  readonly slot?: unknown;
  readonly count?: unknown;
  readonly index?: unknown;
}

export function isRingSource(source: ItemSource): source is RingSource {
  return 'ring' in source;
}

function ringAt(s: Soldier, position: number): KeyOnRing | null {
  const ring = s.keyRing?.[position];
  return ring && ring.count > 0 ? ring : null;
}

function validIndex(value: unknown, count: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < Math.max(1, count);
}

function ringSource(s: Soldier, position: number, req: ItemSourceRequest): RingSource | ItemSourceRefusal {
  if (!ringAt(s, position)) return 'emptySlot';
  const count = parseCount(req.count, 'all');
  if (count === null) return 'badCount';
  if (req.index !== undefined && req.index !== 0) return 'badIndex';
  return { ring: position, count };
}

export function parseItemSource(s: Soldier, req: ItemSourceRequest): ItemSource | ItemSourceRefusal {
  const spot = req.slot === undefined ? { slot: InvSlot.HAND } : parseKeySpot(req.slot);
  if (!spot) return 'badSlot';
  if ('ring' in spot) return ringSource(s, spot.ring, req);
  const pocket = s.inv[spot.slot] as ItemObject;
  if (pocket.count === 0) return 'emptySlot';
  const count = parseCount(req.count, 'all');
  if (count === null) return 'badCount';
  const index = req.index ?? 0;
  if (!validIndex(index, pocket.count)) return 'badIndex';
  return { slot: spot.slot, count, index };
}

function keysWanted(ring: KeyOnRing, count: Count): number {
  return count === 'all' ? ring.count : 1;
}

export function sourceObject(content: KeyContent, s: Soldier, source: ItemSource): ItemObject | null {
  if (!isRingSource(source)) return takeObjects(content.items, cloneObject(s.inv[source.slot] as ItemObject), source.count, source.index);
  const ring = ringAt(s, source.ring);
  return ring ? createKeyObject(content, keysWanted(ring, source.count), ring.keyId) : null;
}

export function takeSourceObject(content: KeyContent, s: Soldier, source: ItemSource): ItemObject | null {
  if (!isRingSource(source)) return takeObjects(content.items, s.inv[source.slot] as ItemObject, source.count, source.index);
  const ring = ringAt(s, source.ring);
  const keys = ring ? createKeyObject(content, keysWanted(ring, source.count), ring.keyId) : null;
  if (ring && keys) removeKeysFromPosition(ring, keys.count);
  return keys;
}

export function returnKeysToRing(s: Soldier, source: RingSource, keys: ItemObject): void {
  const ring = s.keyRing?.[source.ring];
  if (!ring || keys.count === 0) return;
  addKeysToPosition(ring, keys.keyId, keys.count);
  deleteObject(keys);
}

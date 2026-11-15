import type { MapItem } from '../../src/content/formats/map.ts';
import type { ItemTable } from '../../src/content/items/items.ts';
import { Visibility } from '../../src/sim/tactical/world-items.ts';

const WORLD_ITEM_BYTES = 52;
const EXISTS_BYTE = 0;
const GRIDNO_BYTE = 2;
const LEVEL_BYTE = 4;
const OBJECT_OFFSET = 8;
const WORLD_FLAGS_BYTE = 44;
const VISIBLE_BYTE = 47;
const NON_EXIST_CHANCE_BYTE = 48;
const COUNT_BYTE = 2;
const STATUS_BYTE = 4;
const DETONATOR_BYTE = 5;
const BOMB_ITEM_BYTE = 6;
const ACTION_BYTE = 10;
const OBJECT_FLAGS_BYTE = 28;
const TRAP_BYTE = 30;
const FULL_STATUS = 100;

export interface MapItemFields {
  readonly flags?: number;
  readonly visible?: number;
  readonly trap?: number;
  readonly detonator?: number;
  readonly bombItem?: number;
  readonly action?: number;
  readonly objectFlags?: number;
  readonly nonExistChance?: number;
  readonly owner?: number;
}

export function mapItemRecord(items: ItemTable, name: string, g: number, fields: MapItemFields = {}): MapItem {
  const item = items.byName.get(name)?.index;
  if (item === undefined) throw new Error(`unknown item ${name}`);
  const raw = new Uint8Array(WORLD_ITEM_BYTES);
  const v = new DataView(raw.buffer);
  const visible = fields.visible ?? Visibility.INVISIBLE;
  v.setUint8(EXISTS_BYTE, 1);
  v.setInt16(GRIDNO_BYTE, g, true);
  v.setUint8(LEVEL_BYTE, 0);
  v.setUint16(WORLD_FLAGS_BYTE, fields.flags ?? 0, true);
  v.setInt8(VISIBLE_BYTE, visible);
  v.setUint8(NON_EXIST_CHANCE_BYTE, fields.nonExistChance ?? 0);
  v.setUint16(OBJECT_OFFSET, item, true);
  v.setUint8(OBJECT_OFFSET + COUNT_BYTE, 1);
  v.setInt8(OBJECT_OFFSET + STATUS_BYTE, FULL_STATUS);
  v.setUint8(OBJECT_OFFSET + DETONATOR_BYTE, fields.detonator ?? 0);
  v.setUint16(OBJECT_OFFSET + BOMB_ITEM_BYTE, fields.bombItem ?? 0, true);
  v.setUint8(OBJECT_OFFSET + ACTION_BYTE, fields.action ?? 0);
  v.setUint8(OBJECT_OFFSET + OBJECT_FLAGS_BYTE, fields.objectFlags ?? 0);
  v.setInt8(OBJECT_OFFSET + TRAP_BYTE, fields.trap ?? 0);
  if (fields.owner !== undefined) v.setUint8(OBJECT_OFFSET + STATUS_BYTE, fields.owner);
  return {
    gridNo: g,
    level: 0,
    item,
    flags: fields.flags ?? 0,
    renderZHeightAboveLevel: 0,
    visible,
    nonExistChance: fields.nonExistChance ?? 0,
    raw,
  };
}

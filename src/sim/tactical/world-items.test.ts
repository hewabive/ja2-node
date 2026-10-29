import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim } from '../../../tests/support/combat.ts';
import { countDraws, itemId } from '../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import type { MapItem } from '../../content/formats/map.ts';
import { gridNo } from '../../content/world/grid.ts';
import type { TacticalContent } from './content.ts';
import type { TacticalState } from './state.ts';
import { loadWorldItemsFromMap, Visibility } from './world-items.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const WORLD_ITEM_BYTES = 52;
const OBJECT_OFFSET = 8;

function mapItem(t: TacticalState, name: string, x: number, nonExistChance: number): MapItem {
  const raw = new Uint8Array(WORLD_ITEM_BYTES);
  const v = new DataView(raw.buffer);
  v.setUint16(OBJECT_OFFSET, itemId(t, name), true);
  v.setUint8(OBJECT_OFFSET + 2, 1);
  v.setInt8(OBJECT_OFFSET + 4, 100);
  const fields = { gridNo: gridNo(x, 80), level: 0, item: itemId(t, name), flags: 0, renderZHeightAboveLevel: 0 };
  return { ...fields, visible: Visibility.INVISIBLE, nonExistChance, raw };
}

describe('map items (LoadWorldItemsFromMap)', () => {
  it('rolls PreRandom(100) for every item, even one sure to exist', () => {
    const t = newCombatSim(content).state;
    const records = [mapItem(t, 'CANTEEN', 80, 0), mapItem(t, 'CROWBAR', 81, 0), mapItem(t, 'WIRECUTTERS', 82, 100)];
    expect(countDraws(t, () => loadWorldItemsFromMap(t, records))).toEqual({ pre: 3, main: 0 });
    expect(t.worldItems.map((wi) => wi.object.item)).toEqual([itemId(t, 'CANTEEN'), itemId(t, 'CROWBAR')]);
  });
});

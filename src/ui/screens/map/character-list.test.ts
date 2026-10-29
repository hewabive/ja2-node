import { describe, expect, it } from 'vitest';
import type { StrategicMercView, StrategicView } from '../../../protocol/view.ts';
import { CharacterList, SortMode } from './character-list.ts';

function merc(id: number, asleep: boolean): StrategicMercView {
  return { id, name: `M${id}`, asleep } as unknown as StrategicMercView;
}

function rows(list: CharacterList): (number | null)[] {
  return list.slots.slice(0, 3).map((s) => s.merc);
}

describe('the map screen character list', () => {
  it('compares each row with the merc it held when the sort reached it, so the sleepers keep their order behind the awake', () => {
    const view = { mercs: [merc(1, true), merc(2, true), merc(3, false)] } as unknown as StrategicView;
    const list = new CharacterList();
    list.sortMode = SortMode.SLEEP;
    list.rebuild(view);
    expect(rows(list)).toEqual([3, 1, 2]);
  });
});

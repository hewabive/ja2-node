import { describe, expect, it } from 'vitest';
import { FontColor } from '../../../content/text/font-colors.ts';
import type { StrategicMercView, StrategicView } from '../../../protocol/view.ts';
import { CharacterList, NO_CHARACTER, rowColour, SortMode } from './character-list.ts';

function merc(id: number, asleep: boolean): StrategicMercView {
  return { id, name: `M${id}`, asleep } as unknown as StrategicMercView;
}

function plottedRows(list: CharacterList, plottingRow: number, destinationHighLine: number): number[] {
  return [0, 1, 2, 3].filter((row) => list.isGettingPathPlotted(row, plottingRow, destinationHighLine));
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

  it('marks every selected row as plotted when the plotting row or the glowing destination line is selected, else those two rows alone', () => {
    const view = { mercs: [merc(1, false), merc(2, false), merc(3, false)] } as unknown as StrategicView;
    const list = new CharacterList();
    list.rebuild(view);
    list.changeInfo(0, true);
    list.setSelected(1);
    expect(plottedRows(list, NO_CHARACTER, NO_CHARACTER)).toEqual([]);
    expect(plottedRows(list, NO_CHARACTER, 0)).toEqual([0, 1]);
    expect(plottedRows(list, NO_CHARACTER, 2)).toEqual([2]);
    expect(plottedRows(list, 1, 2)).toEqual([0, 1]);
    expect(plottedRows(list, NO_CHARACTER, 3)).toEqual([]);
    const plotted = list.isGettingPathPlotted(1, NO_CHARACTER, 0);
    expect(rowColour(merc(2, false), { hovered: false, plotted, inSelectedSector: true })).toBe(FontColor.LTBLUE);
  });
});

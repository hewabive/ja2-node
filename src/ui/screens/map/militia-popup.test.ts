import { beforeEach, describe, expect, it } from 'vitest';
import { CAMBRIA, DRASSEN, KEY_TEXT, sectorNumber, sectorView, strategicView, testFacts } from '../../../../tests/support/map-screen.ts';
import { projectLayoutLoader, type TestRuntime, testRuntime, uniformImage } from '../../../../tests/support/ui-runtime.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { StrategicSectorView, StrategicView } from '../../../protocol/view.ts';
import { DrawList, type ImageItem } from '../../draw-list.ts';
import { MouseButton } from '../../input/events.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { ORIGINAL_SKIN } from '../../layout/types.ts';
import {
  MAX_MILITIA_PER_SECTOR,
  type MilitiaCounts,
  MilitiaPopup,
  militiaArt,
  militiaGeometry,
  militiaMoves,
  spreadCursor,
} from './militia-popup.ts';

const B13 = sectorNumber('B13');
const C13 = sectorNumber('C13');
const D13 = sectorNumber('D13');
const BOX = 'interface/militia.sti';
const MAPS = 'interface/militiamaps.sti';
const D13_CELL = 6;
const B13_CELL = 0;
const OUTSIDE_TOWN_CELL = 4;

function grid(entries: readonly (readonly [number, MilitiaCounts])[]): Map<number, MilitiaCounts> {
  return new Map(entries);
}

describe('the militia redistribution plan', () => {
  it('spreads the troops left on the cursor over the town in its sector order, one rank after another', () => {
    const spread = spreadCursor(
      grid([
        [B13, [18, 0, 0]],
        [C13, [0, 0, 0]],
        [D13, [0, 0, 0]],
      ]),
      [2, 1, 1],
      [B13, C13, D13],
      (id) => id !== C13,
    );
    expect(spread.get(B13)).toEqual([19, 1, 0]);
    expect(spread.get(C13)).toEqual([0, 0, 0]);
    expect(spread.get(D13)).toEqual([1, 0, 1]);
  });

  it('turns the original grid into the new one with moves that never overfill a sector', () => {
    const base = grid([
      [B13, [20, 0, 0]],
      [C13, [0, 5, 0]],
      [D13, [0, 0, 0]],
    ]);
    const target = grid([
      [B13, [15, 5, 0]],
      [C13, [0, 0, 0]],
      [D13, [5, 0, 0]],
    ]);
    const moves = militiaMoves(base, target);
    expect(moves).toEqual([
      { from: B13, to: D13, rank: 0, count: 5 },
      { from: C13, to: B13, rank: 1, count: 5 },
    ]);
    const current = new Map([...base].map(([id, c]) => [id, [...c]]));
    for (const m of moves) {
      const from = current.get(m.from) ?? [0, 0, 0];
      const to = current.get(m.to) ?? [0, 0, 0];
      from[m.rank] = (from[m.rank] ?? 0) - m.count;
      to[m.rank] = (to[m.rank] ?? 0) + m.count;
      expect(to.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_MILITIA_PER_SECTOR);
    }
    expect([...current]).toEqual([...target].map(([id, c]) => [id, [...c]]));
  });

  it('leaves a swap between two full sectors undone rather than overfill one', () => {
    const base = grid([
      [B13, [20, 0, 0]],
      [C13, [0, 20, 0]],
    ]);
    const target = grid([
      [B13, [0, 20, 0]],
      [C13, [20, 0, 0]],
    ]);
    expect(militiaMoves(base, target)).toEqual([]);
  });
});

describe('the militia popup', () => {
  let t: TestRuntime;
  let model: LayoutModel;
  let view: StrategicView;
  let sent: CommandEnvelope[];
  let boxes: string[];
  let battle: string | null;
  let popup: MilitiaPopup;

  function sectors(overrides: Readonly<Record<string, Partial<StrategicSectorView>>> = {}): StrategicSectorView[] {
    return ['B13', 'C13', 'D13', 'F8', 'F9'].map((name) =>
      sectorView(name, { town: name.startsWith('F') ? CAMBRIA : DRASSEN, militiaTraining: 0, ...overrides[name] }),
    );
  }

  function widget(id: string) {
    const found = popup.describe().find((w) => w.id === id);
    if (!found) throw new Error(`no widget ${id}`);
    return found;
  }

  function press(id: string, button: MouseButton = MouseButton.LEFT): void {
    const r = widget(id).rect;
    t.click(r.x + 5, r.y + 5, button);
  }

  beforeEach(async () => {
    t = await testRuntime();
    model = await projectLayoutLoader().load(ORIGINAL_SKIN, 'map-screen');
    t.images.set(BOX, uniformImage(14, 16, 11));
    t.images.set(MAPS, uniformImage(12, 127, 109));
    t.images.set('interface/militiamapsectoroutline.sti', uniformImage(1, 43, 37));
    t.images.set('interface/militiamapsectoroutline2.sti', uniformImage(1, 44, 38));
    view = strategicView(sectors({ D13: { militia: [5, 3, 1] }, C13: { militia: [2, 0, 0] } }));
    sent = [];
    boxes = [];
    battle = null;
    const geometry = militiaGeometry(model);
    const art = militiaArt(model, t.fonts, 'militiaPopup');
    popup = new MilitiaPopup({
      regions: t.runtime.regions,
      buttons: t.runtime.buttons,
      text: KEY_TEXT,
      facts: testFacts(),
      origin: () => ({ x: 0, y: 0 }),
      geometry: () => geometry,
      art: () => art,
      strategic: () => view,
      battleSector: () => battle,
      send: async (cmd) => {
        sent.push(cmd);
        return { ok: true };
      },
      box: (text) => boxes.push(text),
    });
  });

  it('reads its geometry and art from the map-screen layout', () => {
    expect(militiaGeometry(model)).toMatchObject({ boxX: 400, boxY: 125, cellWidth: 42, cellHeight: 36, autoY: 167, doneX: 67 });
    expect(militiaArt(model, t.fonts, 'militiaPopup')).toMatchObject({ box: BOX, maps: MAPS, buttonFrames: [1, 2], rankFrames: [3, 4] });
  });

  it('opens for a found town that trains militia and explains every other right click', () => {
    popup.request(parseSectorString('F8'));
    expect(boxes).toEqual(['pMapErrorString[31]']);
    popup.request(parseSectorString('D15'));
    expect(boxes).toEqual(['pMapErrorString[31]', 'pMapErrorString[30]']);
    battle = 'C13';
    popup.request(parseSectorString('D13'));
    expect(boxes.at(-1)).toBe('pMilitiaString[2]');
    expect(popup.open).toBe(false);
    battle = 'A9';
    popup.request(parseSectorString('D13'));
    expect(popup.town).toBe(DRASSEN);
    expect(widget('militiaAuto').enabled).toBe(true);
  });

  it('picks up with a right click and drops with a left click on the rank buttons of the selected sector', async () => {
    popup.show(DRASSEN);
    press(`militiaCell${OUTSIDE_TOWN_CELL}`);
    expect(popup.selectedCell).toBe(-1);
    press(`militiaCell${D13_CELL}`);
    expect(popup.selectedCell).toBe(D13_CELL);
    press('militiaRank0', MouseButton.RIGHT);
    press('militiaRank0', MouseButton.RIGHT);
    press('militiaRank2', MouseButton.RIGHT);
    expect(popup.cursor).toEqual([2, 0, 1]);
    expect(popup.militiaIn(D13)).toEqual([3, 3, 0]);
    expect(widget('militiaDone').enabled).toBe(false);
    expect(widget('militiaRank2').enabled).toBe(true);
    press(`militiaCell${B13_CELL}`);
    press('militiaRank0');
    press('militiaRank2');
    expect(popup.militiaIn(B13)).toEqual([1, 0, 1]);
    expect(popup.cursor).toEqual([1, 0, 0]);
    expect(popup.overlay(view).sectors.find((s) => s.sector === 'B13')?.militia).toEqual([1, 0, 1]);
    press(`militiaCell${B13_CELL}`);
    expect(widget('militiaDone').enabled).toBe(true);
    press('militiaDone');
    expect(popup.open).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([
      { type: 'moveMilitia', from: 'D13', to: 'B13', rank: 'green', count: 2 },
      { type: 'moveMilitia', from: 'D13', to: 'B13', rank: 'elite', count: 1 },
    ]);
  });

  it('closes on a right click outside while a sector is selected, and sends nothing when nothing moved', () => {
    popup.show(DRASSEN);
    press(`militiaCell${D13_CELL}`);
    t.click(5, 5, MouseButton.RIGHT);
    expect(popup.open).toBe(false);
    expect(sent).toEqual([]);
  });

  it('evens the town out through distributeMilitia and forgets its own moves', () => {
    popup.show(DRASSEN);
    press(`militiaCell${D13_CELL}`);
    press('militiaRank0', MouseButton.RIGHT);
    press('militiaAuto');
    expect(sent).toEqual([{ type: 'distributeMilitia', town: DRASSEN }]);
    expect(popup.cursor).toEqual([0, 0, 0]);
    expect(popup.militiaIn(D13)).toEqual([5, 3, 1]);
  });

  it('draws the box, the town map, the icons by rank and shades the sectors that are not ours', () => {
    view = strategicView(sectors({ D13: { militia: [1, 1, 1] }, C13: { playerControlled: false } }));
    popup.show(DRASSEN);
    const list = new DrawList();
    popup.render(list);
    const images = list.items.filter((i): i is ImageItem => i.kind === 'image');
    expect(images[0]).toMatchObject({ asset: BOX, frame: 0, x: 400, y: 125 });
    expect(images[1]).toMatchObject({ asset: MAPS, frame: DRASSEN - 1, x: 404, y: 145 });
    expect(images.filter((i) => i.asset === BOX && i.frame >= 8 && i.frame <= 10).map((i) => [i.frame, i.x, i.y])).toEqual([
      [8, 407, 220],
      [9, 412, 220],
      [10, 417, 220],
    ]);
    expect(list.items.filter((i) => i.kind === 'shadow')).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { DRASSEN, KEY_TEXT, sectorView, strategicView, testFacts } from '../../../../tests/support/map-screen.ts';
import { type TestRuntime, testRuntime, uniformImage } from '../../../../tests/support/ui-runtime.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import { FontColor } from '../../../content/text/font-colors.ts';
import type { StrategicView } from '../../../protocol/view.ts';
import { DrawList, type ImageItem } from '../../draw-list.ts';
import { FontName } from '../../text/fonts.ts';
import { DEFAULT_POPUP_COLORS } from '../../widgets/popup-box.ts';
import { foundSecrets, parseSectorLabel } from './facts.ts';
import { type TownBoxInput, TownInfoBox, townBoxLines } from './town-info-box.ts';

const BORDER = 'interface/popup.sti';
const BACKGROUND = 'interface/popupbackground.pcx';
const BUTTONS = 'interface/mapinvbtns.sti';
const INVENTORY_WIDTH = 74;
const EXIT_WIDTH = 49;
const BUTTON_HEIGHT = 21;

function drassen(fields: Partial<StrategicView> = {}): StrategicView {
  return strategicView(
    [
      sectorView('B13', { town: DRASSEN, militia: [1, 0, 0], militiaTraining: 0 }),
      sectorView('C13', { town: DRASSEN, militiaTraining: 40, enemiesKnown: true, enemies: '?' }),
      sectorView('D13', { town: DRASSEN, militia: [5, 3, 1], militiaTraining: 75, facilities: 32, items: 7, enemiesKnown: true }),
      sectorView('A9', { playerControlled: true }),
    ],
    {
      townControl: [{ town: DRASSEN, control: 66 }],
      mines: [
        {
          mine: 0,
          sector: 'D13',
          town: DRASSEN,
          status: 'producing',
          ore: 'silver',
          playerControls: true,
          predictedDailyIncome: 1500,
          maxDailyRemoval: 3000,
          maxPeriodicRemoval: 750,
        },
      ],
      underground: [{ sector: 'D13-1', items: 4 }],
      ...fields,
    },
  );
}

function input(strategic: StrategicView, minesShown = false): TownBoxInput {
  return { facts: testFacts(), text: KEY_TEXT, strategic, found: foundSecrets(strategic.secretsFound), minesShown };
}

function rows(strategic: StrategicView, sector: string, minesShown = false): string[] {
  const at = parseSectorLabel(sector);
  if (!at) throw new Error(`bad sector ${sector}`);
  return townBoxLines(input(strategic, minesShown), at).map((l) => (l.second === undefined ? l.text : `${l.text} ${l.second}`));
}

describe('the town and mine info box', () => {
  it('lists a town sector like AddTextToTownBox and AddCommonInfoToBox, the title in the secondary colour', () => {
    const lines = townBoxLines(input(drassen()), parseSectorString('D13'));
    expect(lines[0]).toEqual({ text: 'strategic-map-town-names[2]', shade: 'secondary' });
    expect(rows(drassen(), 'D13')).toEqual([
      'strategic-map-town-names[2]',
      '',
      'pwMiscSectorStrings[1]: D13',
      'pwTownInfoStrings[0]: 3',
      'pwTownInfoStrings[4]: sFacilitiesStrings[6]',
      'pwTownInfoStrings[1]: 66%',
      'pwTownInfoStrings[3]: 50%',
      'pwTownInfoStrings[2]: D13',
      'pwMiscSectorStrings[4]: pwMiscSectorStrings[5]',
      'pwTownInfoStrings[6]: 9  (5/3/1)',
      'pwTownInfoStrings[5]: 75%',
      'pwMiscSectorStrings[0]: 0',
      'pwMiscSectorStrings[2]: 7',
    ]);
  });

  it('prints the enemy forces as unknown, uncertain or counted, and the militia as 0 without any', () => {
    const view = drassen();
    expect(rows(view, 'C13')).toContain('pwMiscSectorStrings[0]: ?');
    expect(rows(view, 'C13')).toContain('pwTownInfoStrings[6]: 0');
    expect(rows(view, 'B13')).toContain('pwMiscSectorStrings[0]: pwMiscSectorStrings[3]');
    const counted = drassen({ sectors: [sectorView('B13', { town: DRASSEN, militiaTraining: 0, enemiesKnown: true, enemies: 4 })] });
    expect(rows(counted, 'B13')).toContain('pwMiscSectorStrings[0]: 4');
  });

  it('shows the mine box only with the mines filter on, and stops after the status of an abandoned mine', () => {
    expect(rows(drassen(), 'D13', true).slice(0, 10)).toEqual([
      'strategic-map-town-names[2] pwMineStrings[0]',
      '',
      'pwMiscSectorStrings[1]: D13',
      'pwMineStrings[9]: pwMineStrings[8]',
      'pwMineStrings[3]: $1,500',
      'pwMineStrings[4]: $3,000',
      'pwMineStrings[10]: 50%',
      'pwMineStrings[12]: 66%',
      'pwMineStrings[13]: 50%',
      'pwMineStrings[11]: pwMineStrings[1]',
    ]);
    const abandoned = drassen({
      mines: [{ ...(drassen().mines?.[0] as NonNullable<StrategicView['mines']>[number]), status: 'abandoned' }],
    });
    expect(rows(abandoned, 'D13', true).slice(3, 5)).toEqual([
      'pwMineStrings[9]: pwMineStrings[5]',
      'pwMiscSectorStrings[4]: pwMiscSectorStrings[5]',
    ]);
  });

  it('gives a blank sector its land type and an underground sector only its long name and items', () => {
    expect(rows(drassen(), 'A9')).toEqual([
      'strategic-map-land-types[1]',
      '',
      'pwMiscSectorStrings[1]: A9',
      'pwMiscSectorStrings[0]: pwMiscSectorStrings[3]',
      'pwMiscSectorStrings[2]: 0',
    ]);
    expect(rows(drassen(), 'D13-1')).toEqual(['pwMiscSectorStrings[1]: D13-1', 'pwMiscSectorStrings[2]: 4']);
  });

  describe('as a box', () => {
    let t: TestRuntime;
    let closed: number;
    let inventory: string[];
    let box: TownInfoBox;

    beforeEach(async () => {
      t = await testRuntime();
      t.images.set(BORDER, uniformImage(6, 2, 2));
      t.images.set(BACKGROUND, uniformImage(1, 320, 240));
      t.images.set(BUTTONS, {
        kind: 'indexed',
        frames: [INVENTORY_WIDTH, EXIT_WIDTH, INVENTORY_WIDTH, EXIT_WIDTH].map((width) => ({
          width,
          height: BUTTON_HEIGHT,
          offsetX: 0,
          offsetY: 0,
        })),
        animatedFrames: 0,
      });
      closed = 0;
      inventory = [];
      const strategic = drassen();
      box = new TownInfoBox({
        buttons: t.runtime.buttons,
        text: KEY_TEXT,
        style: () => ({
          border: BORDER,
          background: BACKGROUND,
          font: t.fonts.get(FontName.BLOCKFONT2),
          marginLeft: 6,
          marginTop: 6,
          marginBottom: 28,
          marginRight: 6,
          lineSpace: 2,
          colors: { ...DEFAULT_POPUP_COLORS, foreground: FontColor.YELLOW, secondaryShade: FontColor.LTGREEN },
          resize: true,
          secondColumnMinOffset: 20,
        }),
        art: () => ({
          asset: BUTTONS,
          inventory: [0, 2],
          exit: [1, 3],
          font: t.fonts.get(FontName.BLOCKFONT2),
          color: FontColor.WHITE,
          shadow: FontColor.BLACK,
        }),
        origin: () => ({ x: 0, y: 0 }),
        frameWidth: (asset, frame) => t.images.info(asset)?.frames[frame]?.width ?? 0,
        input: () => input(strategic),
        inventory: (s) => inventory.push(`${s.x},${s.y}`),
        closed: () => closed++,
      });
    });

    it('sits at the sector inside the map rectangle with both buttons spaced by a third of the spare width', () => {
      box.show(parseSectorString('D13'));
      const widgets = box.describe();
      const frame = widgets[0]?.rect;
      const inventoryButton = widgets.find((w) => w.id === 'townBoxInventory')?.rect;
      const exitButton = widgets.find((w) => w.id === 'townBoxExit')?.rect;
      if (!frame || !inventoryButton || !exitButton) throw new Error('the box is missing');
      expect(frame.width).toBeGreaterThanOrEqual(INVENTORY_WIDTH + EXIT_WIDTH + 30);
      expect(frame.x + frame.width).toBeLessThanOrEqual(270 + 336 - 1 + 21 - 5);
      const dx = Math.trunc((frame.width - INVENTORY_WIDTH - EXIT_WIDTH) / 3);
      expect(inventoryButton.x).toBe(frame.x + dx);
      expect(exitButton.x).toBe(frame.x + dx + INVENTORY_WIDTH + dx);
      expect(inventoryButton.y).toBe(frame.y + frame.height - 25);
      const list = new DrawList();
      box.render(list);
      const buttons = list.items.filter((i): i is ImageItem => i.kind === 'image' && i.asset === BUTTONS).map((i) => i.frame);
      expect(buttons).toEqual([0, 1]);
    });

    it('closes from Exit and hands the sector to the inventory from Inventory', () => {
      box.show(parseSectorString('D13'));
      const exitButton = box.describe().find((w) => w.id === 'townBoxExit')?.rect;
      if (!exitButton) throw new Error('no exit button');
      t.click(exitButton.x + 5, exitButton.y + 5);
      expect(box.open).toBe(false);
      expect(closed).toBe(1);
      box.show(parseSectorString('D13'));
      const inventoryButton = box.describe().find((w) => w.id === 'townBoxInventory')?.rect;
      if (!inventoryButton) throw new Error('no inventory button');
      t.click(inventoryButton.x + 5, inventoryButton.y + 5);
      expect(box.open).toBe(false);
      expect(inventory).toEqual(['13,4']);
      expect(t.runtime.buttons.buttons.filter((b) => b.owner === 'townInfoBox')).toEqual([]);
    });
  });
});

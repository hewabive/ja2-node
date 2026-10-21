// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_TownMine_Info.cc CreateDestroyTownInfoBox (the mine box only with the mines
// @src filter on a mine sector, else the town box or the blank sector box on the surface, the sector line underground; the
// @src items line always; the title line in FONT_LTGREEN, SpecifyBoxMinWidth of both buttons + 30), AddTextToTownBox,
// @src AddTextToMineBox, AddTextToBlankSectorBox, AddSectorToBox, AddCommonInfoToBox (control, militia and training only
// @src where militia can be trained in a town or a found SAM site; the enemy forces as "Unknown", "?" or the count),
// @src AddItemsInSectorToBox, PositionTownMineInfoBox (at the sector, kept inside MapScreenRect),
// @src AddInventoryButtonForMapPopUpBox and MakeButton (mapinvbtns.sti frames 0/2 and 1/3, BLOCKFONT2 white text,
// @src MSYS_PRIORITY_HIGHEST - 1, a third of the spare width around each), MapTownMineInventoryButtonCallBack,
// @src MapTownMineExitButtonCallBack; src/game/Strategic/Strategic_Mines.cc GetMineSectorForTown. See docs/28 §7.8.

import { type Sector, sectorFromId, sectorId, sectorLongString, sectorShortString } from '../../../content/strategic/sector-ids.ts';
import { idiv } from '../../../core/int.ts';
import type { StrategicMineView, StrategicSectorView, StrategicView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import { MouseReason, Priority } from '../../input/mouse.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { sprintMoney } from '../../text/money.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { Button, ButtonSystem } from '../../widgets/button.ts';
import { twoFrameImage } from '../../widgets/button.ts';
import { PopupBox, type PopupBoxStyle, type PopupLine } from '../../widgets/popup-box.ts';
import { type WidgetInfo, widgetRect } from '../../widgets/widget-info.ts';
import { facilitiesString, type MapFacts, sectorLabel, sectorLandTypeString } from './facts.ts';
import { cellOrigin, mapScreenRect } from './map-view.ts';

const TOWN_INFO = 'pwTownInfoStrings';
const MINE_STRINGS = 'pwMineStrings';
const MISC_SECTOR = 'pwMiscSectorStrings';
const BUTTON_TEXT = 'pMapPopUpInventoryText';
const TOWN_NAMES = 'strategic-map-town-names';
const TownInfo = { SIZE: 0, CONTROL: 1, MINE: 2, LOYALTY: 3, FACILITIES: 4, TRAINING: 5, MILITIA: 6 } as const;
const Mine = { WORD: 0, SILVER: 1, GOLD: 2, PRODUCTION: 3, POTENTIAL: 4, STATUS: 9, RATE: 10, ORE: 11, CONTROL: 12, LOYALTY: 13 } as const;
const MINE_STATUS_TEXT: Readonly<Record<StrategicMineView['status'], number>> = { abandoned: 5, shutDown: 6, runningOut: 7, producing: 8 };
const Misc = { ENEMIES: 0, SECTOR: 1, ITEMS: 2, UNKNOWN: 3, CONTROLLED: 4, YES: 5, NO: 6 } as const;
const NO_MILITIA = '0';
const UNSURE_ENEMIES = '?';
const BOX_BUTTON_HEIGHT = 20;
const BUTTON_BOTTOM_GAP = 5;
const MIN_WIDTH_EXTRA = 30;
const EDGE_GAP = 5;
const BOTTOM_EDGE_GAP = 8;
const BUTTON_GAPS = 3;
const BUTTON_PRIORITY = Priority.HIGHEST - 1;
const OWNER = 'townInfoBox';
const NO_MINE = -1;

export interface TownBoxInput {
  readonly facts: MapFacts;
  readonly text: UiTextService;
  readonly strategic: StrategicView;
  readonly found: ReadonlySet<number>;
  readonly minesShown: boolean;
}

function label(text: UiTextService, table: string, index: number): string {
  return `${text.string(table, index) ?? ''}:`;
}

function percent(n: number): string {
  return `${n}%`;
}

function sectorView(strategic: StrategicView, s: Sector): StrategicSectorView | undefined {
  const name = sectorLabel(s);
  return strategic.sectors.find((v) => v.sector === name);
}

function townControl(strategic: StrategicView, town: number): number {
  return strategic.townControl?.find((t) => t.town === town)?.control ?? 0;
}

function townLoyalty(input: TownBoxInput, town: number): number | null {
  if (!input.facts.usesLoyalty[town]) return null;
  return input.strategic.towns?.find((t) => t.town === town)?.loyalty ?? null;
}

function sectorLine(input: TownBoxInput, s: Sector): PopupLine {
  return { text: label(input.text, MISC_SECTOR, Misc.SECTOR), second: s.z === 0 ? sectorShortString(s) : sectorLongString(s, false) };
}

function militiaTrainingAllowed(facts: MapFacts, s: Sector, town: number): boolean {
  return facts.samSectors.includes(sectorId(s)) || facts.town(town)?.isMilitiaTrainingAllowed === true;
}

function townLines(input: TownBoxInput, s: Sector, town: number): PopupLine[] {
  const { facts, text, strategic } = input;
  const id = sectorId(s);
  const size = facts.town(town)?.sectors.length ?? 0;
  const lines: PopupLine[] = [
    { text: sectorLandTypeString(facts, text, input.found, id, 0, true) },
    { text: '' },
    sectorLine(input, s),
    { text: label(text, TOWN_INFO, TownInfo.SIZE), second: String(size) },
    { text: label(text, TOWN_INFO, TownInfo.FACILITIES), second: facilitiesString(text, sectorView(strategic, s)?.facilities ?? 0) },
  ];
  if (militiaTrainingAllowed(facts, s, town))
    lines.push({ text: label(text, TOWN_INFO, TownInfo.CONTROL), second: percent(townControl(strategic, town)) });
  const loyalty = townLoyalty(input, town);
  if (loyalty !== null) lines.push({ text: label(text, TOWN_INFO, TownInfo.LOYALTY), second: percent(loyalty) });
  const mine = facts.mines.find((m) => m.associatedTownId === town);
  if (mine) lines.push({ text: label(text, TOWN_INFO, TownInfo.MINE), second: sectorShortString(sectorFromId(mine.entranceSector)) });
  return lines;
}

function mineLines(input: TownBoxInput, s: Sector, mine: number): PopupLine[] {
  const { facts, text, strategic } = input;
  const view = strategic.mines?.find((m) => m.mine === mine);
  const town = view?.town ?? facts.mines[mine]?.associatedTownId ?? 0;
  const status = view?.status ?? 'abandoned';
  const lines: PopupLine[] = [
    { text: `${text.string(TOWN_NAMES, town) ?? ''} ${text.string(MINE_STRINGS, Mine.WORD) ?? ''}` },
    { text: '' },
    sectorLine(input, s),
    { text: label(text, MINE_STRINGS, Mine.STATUS), second: text.string(MINE_STRINGS, MINE_STATUS_TEXT[status]) ?? '' },
  ];
  if (!view || status === 'abandoned') return lines;
  lines.push({ text: label(text, MINE_STRINGS, Mine.PRODUCTION), second: sprintMoney(view.predictedDailyIncome) });
  lines.push({ text: label(text, MINE_STRINGS, Mine.POTENTIAL), second: sprintMoney(view.maxDailyRemoval) });
  if (view.maxPeriodicRemoval > 0 && view.maxDailyRemoval > 0)
    lines.push({
      text: label(text, MINE_STRINGS, Mine.RATE),
      second: percent(idiv(view.predictedDailyIncome * 100, view.maxDailyRemoval)),
    });
  lines.push({ text: label(text, MINE_STRINGS, Mine.CONTROL), second: percent(townControl(strategic, town)) });
  const loyalty = townLoyalty(input, town);
  if (loyalty !== null) lines.push({ text: label(text, MINE_STRINGS, Mine.LOYALTY), second: percent(loyalty) });
  lines.push({
    text: label(text, MINE_STRINGS, Mine.ORE),
    second: text.string(MINE_STRINGS, view.ore === 'gold' ? Mine.GOLD : Mine.SILVER) ?? '',
  });
  return lines;
}

function blankLines(input: TownBoxInput, s: Sector): PopupLine[] {
  return [{ text: sectorLandTypeString(input.facts, input.text, input.found, sectorId(s), 0, true) }, { text: '' }, sectorLine(input, s)];
}

function militiaText(view: StrategicSectorView | undefined): string {
  const [green = 0, regular = 0, elite = 0] = view?.militia ?? [];
  const total = green + regular + elite;
  return total > 0 ? `${total}  (${green}/${regular}/${elite})` : NO_MILITIA;
}

function enemiesText(text: UiTextService, view: StrategicSectorView | undefined): string {
  if (!view?.enemiesKnown) return text.string(MISC_SECTOR, Misc.UNKNOWN) ?? '';
  if (view.enemies === UNSURE_ENEMIES) return UNSURE_ENEMIES;
  return String(view.enemies ?? 0);
}

function commonLines(input: TownBoxInput, s: Sector): PopupLine[] {
  const { text } = input;
  const view = sectorView(input.strategic, s);
  const lines: PopupLine[] = [];
  if (view?.militiaTraining !== undefined) {
    const controlled = view.playerControlled === true ? Misc.YES : Misc.NO;
    lines.push({ text: label(text, MISC_SECTOR, Misc.CONTROLLED), second: text.string(MISC_SECTOR, controlled) ?? '' });
    lines.push({ text: label(text, TOWN_INFO, TownInfo.MILITIA), second: militiaText(view) });
    lines.push({ text: label(text, TOWN_INFO, TownInfo.TRAINING), second: percent(view.militiaTraining) });
  }
  lines.push({ text: label(text, MISC_SECTOR, Misc.ENEMIES), second: enemiesText(text, view) });
  return lines;
}

function itemCount(strategic: StrategicView, s: Sector): number {
  if (s.z === 0) return sectorView(strategic, s)?.items ?? 0;
  const name = sectorLabel(s);
  return strategic.underground?.find((u) => u.sector === name)?.items ?? 0;
}

export function townBoxLines(input: TownBoxInput, s: Sector): PopupLine[] {
  const lines: PopupLine[] = [];
  if (s.z !== 0) lines.push(sectorLine(input, s));
  else {
    const id = sectorId(s);
    const mine = input.minesShown ? input.facts.mineAt(id, 0) : NO_MINE;
    const town = input.facts.townOf(id);
    if (mine !== NO_MINE) lines.push(...mineLines(input, s, mine));
    else if (town !== 0) lines.push(...townLines(input, s, town));
    else lines.push(...blankLines(input, s));
    lines.push(...commonLines(input, s));
  }
  lines.push({ text: label(input.text, MISC_SECTOR, Misc.ITEMS), second: String(itemCount(input.strategic, s)) });
  const [title, ...rest] = lines;
  return title ? [{ ...title, shade: 'secondary' }, ...rest] : rest;
}

export interface TownBoxButtonArt {
  readonly asset: string;
  readonly inventory: readonly [number, number];
  readonly exit: readonly [number, number];
  readonly font: BitmapFont;
  readonly color: number;
  readonly shadow: number;
}

export interface TownInfoBoxHost {
  readonly buttons: ButtonSystem;
  readonly text: UiTextService;
  readonly style: () => PopupBoxStyle;
  readonly art: () => TownBoxButtonArt;
  readonly origin: () => { readonly x: number; readonly y: number };
  readonly frameWidth: (asset: string, frame: number) => number;
  readonly input: () => TownBoxInput | null;
  readonly inventory?: (s: Sector) => void;
  readonly closed: () => void;
}

export class TownInfoBox {
  readonly #host: TownInfoBoxHost;
  #box: PopupBox | null = null;
  #buttons: Button[] = [];
  #sector: Sector | null = null;

  constructor(host: TownInfoBoxHost) {
    this.#host = host;
  }

  get open(): boolean {
    return this.#box !== null;
  }

  get sector(): Sector | null {
    return this.#sector;
  }

  get lines(): readonly PopupLine[] {
    return this.#box?.lines ?? [];
  }

  show(s: Sector): void {
    this.close(false);
    const input = this.#host.input();
    if (!input) return;
    const art = this.#host.art();
    const widths = [this.#host.frameWidth(art.asset, art.inventory[0]), this.#host.frameWidth(art.asset, art.exit[0])];
    const total = (widths[0] ?? 0) + (widths[1] ?? 0);
    const style = this.#host.style();
    const box = new PopupBox({ ...style, minWidth: Math.max(style.minWidth ?? 0, total + MIN_WIDTH_EXTRA) }, 0, 0);
    box.setLines(townBoxLines(input, s));
    this.#position(box, s);
    this.#box = box;
    this.#sector = { ...s };
    this.#createButtons(box, art, widths, total);
  }

  #position(box: PopupBox, s: Sector): void {
    const origin = this.#host.origin();
    const at = cellOrigin({ origin }, s);
    const rect = mapScreenRect(origin);
    let x = at.x;
    if (x < rect.x1) x = rect.x1 + EDGE_GAP;
    if (x + box.width > rect.x2) x = rect.x2 - box.width - EDGE_GAP;
    let y = at.y;
    if (y < rect.y1) y = rect.y1 + EDGE_GAP;
    if (y + box.height > rect.y2) y = rect.y2 - box.height - BOTTOM_EDGE_GAP;
    box.x = x;
    box.y = y;
  }

  #createButtons(box: PopupBox, art: TownBoxButtonArt, widths: readonly number[], total: number): void {
    const dx = idiv(box.width - total, BUTTON_GAPS);
    const y = box.y + box.height - (BOX_BUTTON_HEIGHT + BUTTON_BOTTOM_GAP);
    const make = (index: number, x: number, frames: readonly [number, number], click: () => void): Button =>
      this.#host.buttons.create({
        x,
        y,
        kind: 'quick',
        image: twoFrameImage(art.asset, frames[0], frames[1]),
        priority: BUTTON_PRIORITY,
        owner: OWNER,
        id: index === 0 ? 'townBoxInventory' : 'townBoxExit',
        text: {
          text: this.#host.text.string(BUTTON_TEXT, index) ?? '',
          font: art.font,
          color: art.color,
          shadow: art.shadow,
          downColor: art.color,
          downShadow: art.shadow,
        },
        onClick: (_b, reason) => {
          if (reason & MouseReason.LBUTTON_UP) click();
        },
      });
    const first = box.x + dx;
    this.#buttons = [
      make(0, first, art.inventory, () => this.#inventory()),
      make(1, first + (widths[0] ?? 0) + dx, art.exit, () => this.close(true)),
    ];
  }

  #inventory(): void {
    const sector = this.#sector;
    this.close(true);
    if (sector) this.#host.inventory?.(sector);
  }

  close(notify: boolean): void {
    const wasOpen = this.#box !== null;
    for (const button of this.#buttons) button.remove();
    this.#buttons = [];
    this.#box = null;
    this.#sector = null;
    if (wasOpen && notify) this.#host.closed();
  }

  render(list: DrawList): void {
    const box = this.#box;
    if (!box) return;
    box.draw(list);
    for (const button of this.#buttons) if (button.visible) this.#host.buttons.draw(list, button);
  }

  describe(): WidgetInfo[] {
    const box = this.#box;
    if (!box) return [];
    return [
      {
        id: 'townInfoBox',
        kind: 'popupBox',
        rect: widgetRect(box.x, box.y, box.width, box.height),
        visible: true,
        enabled: true,
        state: null,
        text: box.lines.map((l) => (l.second === undefined ? l.text : `${l.text} ${l.second}`)).join('\n'),
        frame: null,
      },
      ...this.#buttons.map((b) => b.describe()),
    ];
  }
}

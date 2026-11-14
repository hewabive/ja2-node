// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Tactical_Placement_GUI.cc InitTacticalPlacementGUI (overheadinterface.sti at 0, 320; the
// @src overheaduibuttons.sti buttons Clear, Spread, Group and Done at 11 and 332, 367, 402, 437 in BLOCKFONT FONT_BEIGE
// @src on FONT_NEARBLACK, hilited FONT_WHITE, with their fast help, Done's also while disabled; the merc regions of
// @src 54 × 62 from 91, 361, two to a column; under the saved Group the button down and the first unplaced merc
// @src selected), PlaceMercs (Clear selects the first merc), RenderTacticalPlacementGUI (the cells: the black bar area,
// @src panels.sti 0, the 65face portrait and, unless he is dead, the life max, bleeding, life, breath max and morale bars
// @src from the bottom; the title STR_TP_SECTOR, the detailed sector name and STR_TP_CHOOSEENTRYPOSITIONS at 120, 335;
// @src the loose hatch over the map but the strips of the sides, the cursor merc's alone while there is one, black by day
// @src and 63, 31, 31 at night, framed; the names in BLOCKFONT, yellow for the selected merc or group, white for the
// @src hilited one, gray3 for the others; the question mark in FONT10ARIALBOLD over an unplaced merc; a hilited merc
// @src the pointer left given up), ChooseRandomEdgepoints (gfEveryonePlaced, which no placement GUI resets),
// @src EnsureDoneButtonStatus, TacticalPlacementHandle (the right button deselects; Enter,
// @src c, g, s and Alt+x; the valid cursor within 40 pixels of the cursor merc's side and its PLACEMERC, DPLACEMERC,
// @src PLACEGROUP and DPLACEGROUP cursors), SpreadPlacementsCallback, GroupPlacementsCallback, ClearPlacementsCallback,
// @src DoneOverheadPlacementClickCallback, MercMoveCallback, MercClickCallback, SelectNextUnplacedUnit,
// @src HandleTacticalPlacementClicksInOverheadMap (STR_TP_INACCESSIBLE_MESSAGE and STR_TP_INVALID_MESSAGE in
// @src MSG_BOX_BASIC_STYLE centred in 220, 120, 200 × 80), SetCursorMerc; Overhead_Map.cc RenderOverheadOverlays
// @src (persons.sti 7 for the selected merc, 8 for the hilited one); Strategic/Game_Clock.cc DayTime (7 to 21).

import { FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import { refusalMessage, refusalOf } from '../../../protocol/refusals.ts';
import type { PlacementSide, SoldierView, TacticalPlacementPromptView } from '../../../protocol/view.ts';
import { type DrawList, rgb } from '../../draw-list.ts';
import { KeyModifier, type UiKeyEvent, type UiTextEvent } from '../../input/events.ts';
import { MouseButtonMask, MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { UiServices } from '../../services.ts';
import { FontName } from '../../text/fonts.ts';
import { stringPixLength } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { type Button, twoFrameImage } from '../../widgets/button.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import type { OverheadPlacement } from './overhead-map.ts';

const OWNER = 'tacticalPlacement';
const STRATEGIC = 'gpStrategicString';
const STR_TP_CLEAR = 46;
const STR_TP_SPREAD = 47;
const STR_TP_GROUP = 48;
const STR_TP_DONE = 49;
const STR_TP_CLEARHELP = 50;
const STR_TP_SPREADHELP = 51;
const STR_TP_GROUPHELP = 52;
const STR_TP_DONEHELP = 53;
const STR_TP_DISABLED_DONEHELP = 54;
const STR_TP_SECTOR = 55;
const STR_TP_CHOOSEENTRYPOSITIONS = 56;
const STR_TP_INVALID_MESSAGE = 58;
const BUTTON_X = 11;
const BUTTON_UP = 0;
const BUTTON_DOWN = 1;
const PANEL_Y = 320;
const REGION_X = 91;
const REGION_Y = 361;
const CELL_X = 95;
const CELL_Y = 371;
const COLUMN_WIDTH = 54;
const ROW_HEIGHT = 51;
const REGION_WIDTH = 54;
const REGION_HEIGHT = 62;
const BARS_LEFT = 36;
const BARS_RIGHT = 44;
const BARS_TOP = 2;
const BARS_BOTTOM = 30;
const BAR_BASE = 29;
const BAR_RANGE = 27;
const BAR_STEP = 3;
const FULL = 100;
const PORTRAIT_INSET = 2;
const NAME_WIDTH = 48;
const NAME_DY = 33;
const QUESTION_DX = 16;
const QUESTION_DY = 14;
const TITLE_X = 120;
const TITLE_Y = 335;
const MAP_LEFT = 4;
const MAP_TOP = 4;
const MAP_RIGHT = 636;
const MAP_BOTTOM = 320;
const MAP_WIDTH = 640;
const STRIP = 30;
const VALID_STRIP = 40;
const NORTH_LIMIT = 40;
const EAST_LIMIT = 600;
const SOUTH_LIMIT = 280;
const WEST_LIMIT = 40;
const BOX_X = 220;
const BOX_Y = 120;
const BOX_WIDTH = 200;
const BOX_HEIGHT = 80;
const DAY_START_HOUR = 7;
const NIGHT_START_HOUR = 21;
const NOBODY = -1;
const NO_GROUP = 0;
const SELECTED_PERSON = 7;
const HILITED_PERSON = 8;
const CURSOR_NORMAL = 0;
const CURSOR_PLACEMERC = 123;
const CURSOR_PLACEGROUP = 124;
const CURSOR_DPLACEMERC = 125;
const CURSOR_DPLACEGROUP = 126;
const BLACK = rgb(0, 0, 0);
const NIGHT_HATCH = rgb(63, 31, 31);
const BLEEDING_SHADOW = rgb(107, 107, 57);
const BLEEDING = rgb(222, 181, 115);
const BANDAGED_SHADOW = rgb(156, 57, 57);
const BANDAGED = rgb(222, 132, 132);
const LIFE_SHADOW = rgb(107, 8, 8);
const LIFE = rgb(206, 0, 0);
const BREATH_SHADOW = rgb(8, 8, 132);
const BREATH = rgb(8, 8, 107);
const MORALE_SHADOW = rgb(8, 156, 8);
const MORALE = rgb(8, 107, 8);
const DONE_KEY = 'Enter';
const CLEAR_KEY = 'c';
const GROUP_KEY = 'g';
const SPREAD_KEY = 's';
const EXIT_GAME_KEY = 'x';

export const PlacementAnswer = { PLACE: 'place', SPREAD: 'spread', GROUP: 'group', CLEAR: 'clear', DONE: 'done' } as const;
export type PlacementAnswer = (typeof PlacementAnswer)[keyof typeof PlacementAnswer];

export interface PlacementArt {
  readonly panel: string;
  readonly buttons: string;
  readonly faces: string;
}

export interface PlacementMerc {
  readonly name: string;
  readonly face: string | null;
  readonly life: number;
  readonly lifeMax: number;
  readonly bleeding: number;
  readonly breathMax: number;
  readonly morale: number;
}

export interface PlacementReply {
  readonly ok: boolean;
  readonly data?: unknown;
}

export interface PlacementPanelHost {
  readonly services: Pick<UiServices, 'regions' | 'buttons' | 'fonts' | 'geometry'>;
  readonly text: UiTextService;
  readonly art: () => PlacementArt;
  readonly merc: (soldier: number) => PlacementMerc | null;
  readonly sectorName: (sector: string) => string;
  readonly hour: () => number;
  readonly mapGridNo: () => number | null;
  readonly mapRegion: () => MouseRegion | null;
  readonly answer: (prompt: string, choice: PlacementAnswer, place?: { soldier: number; gridNo: number }) => Promise<PlacementReply>;
  readonly box: (text: string, centring: { x: number; y: number; width: number; height: number }) => void;
  readonly exitGame: () => void;
}

interface Clip {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class PlacementPanel implements OverheadPlacement {
  readonly #host: PlacementPanelHost;
  #prompt: TacticalPlacementPromptView | null = null;
  #buttons: Button[] = [];
  #regions: MouseRegion[] = [];
  #selected = NOBODY;
  #hilighted = NOBODY;
  #cursor = NOBODY;
  #selectedGroup = NO_GROUP;
  #hilightedGroup = NO_GROUP;
  #selectedSoldier: number | null = null;
  #hilightedSoldier: number | null = null;
  #everyonePlaced = false;

  constructor(host: PlacementPanelHost) {
    this.#host = host;
  }

  get open(): boolean {
    return this.#prompt !== null;
  }

  get selected(): number {
    return this.#selected;
  }

  sync(prompt: TacticalPlacementPromptView | null): void {
    if (!prompt) {
      this.close();
      return;
    }
    const opening = this.#prompt === null;
    this.#prompt = prompt;
    if (opening) this.#start(prompt);
    this.#syncButtons(prompt);
  }

  #start(prompt: TacticalPlacementPromptView): void {
    this.#selected = NOBODY;
    this.#hilighted = NOBODY;
    this.#cursor = NOBODY;
    this.#selectedGroup = NO_GROUP;
    this.#hilightedGroup = NO_GROUP;
    this.#selectedSoldier = null;
    this.#hilightedSoldier = null;
    this.#createButtons();
    this.#createMercRegions(prompt);
    if (prompt.button === 'clear') this.#selectFirstForClear();
    else if (prompt.button === 'spread') this.#everyonePlaced = true;
    else if (prompt.button === 'group') this.#selectFirstUnplaced(prompt);
  }

  #selectFirstForClear(): void {
    this.#selectedGroup = NO_GROUP;
    this.#selected = 0;
    this.#setCursorMerc(0);
    this.#everyonePlaced = false;
  }

  #selectFirstUnplaced(prompt: TacticalPlacementPromptView): void {
    const first = prompt.mercs.findIndex((m) => !m.placed);
    const merc = prompt.mercs[first];
    if (!merc) return;
    this.#selected = first;
    this.#selectedGroup = merc.group;
    this.#selectedSoldier = merc.soldier;
    this.#setCursorMerc(first);
  }

  #origin(): { readonly x: number; readonly y: number } {
    const g = this.#host.services.geometry();
    return { x: g.stdX, y: g.stdY };
  }

  #string(index: number): string {
    return this.#host.text.string(STRATEGIC, index) ?? '';
  }

  #createButtons(): void {
    const services = this.#host.services;
    const o = this.#origin();
    const font = services.fonts.get(FontName.BLOCKFONT);
    const make = (y: number, label: number, help: number, id: string, act: () => void): Button =>
      services.buttons.create({
        x: o.x + BUTTON_X,
        y: o.y + y,
        image: twoFrameImage(this.#host.art().buttons, BUTTON_UP, BUTTON_DOWN),
        priority: Priority.HIGH,
        owner: OWNER,
        id,
        text: {
          text: this.#string(label),
          font,
          color: FontColor.BEIGE,
          shadow: FontColor.NEARBLACK,
          hiliteColor: FontColor.WHITE,
          hiliteShadow: FontColor.NEARBLACK,
        },
        tooltip: this.#string(help),
        onClick: (_b, reason) => {
          if (reason & MouseReason.LBUTTON_UP) act();
        },
      });
    const done = make(437, STR_TP_DONE, STR_TP_DONEHELP, 'placement.done', () => this.#done());
    done.allowDisabledTooltip();
    this.#buttons = [
      make(332, STR_TP_CLEAR, STR_TP_CLEARHELP, 'placement.clear', () => this.#clear()),
      make(367, STR_TP_SPREAD, STR_TP_SPREADHELP, 'placement.spread', () => this.#spread()),
      make(402, STR_TP_GROUP, STR_TP_GROUPHELP, 'placement.group', () => this.#group()),
      done,
    ];
  }

  #button(id: string): Button | undefined {
    return this.#buttons.find((b) => b.id === id);
  }

  #syncButtons(prompt: TacticalPlacementPromptView): void {
    this.#button('placement.group')?.setClicked(prompt.button === 'group');
    const done = this.#button('placement.done');
    if (!done || done.enabled === prompt.everyonePlaced) return;
    done.setEnabled(prompt.everyonePlaced);
    done.setTooltip(this.#string(prompt.everyonePlaced ? STR_TP_DONEHELP : STR_TP_DISABLED_DONEHELP));
  }

  #regionCorner(i: number): { readonly x: number; readonly y: number } {
    const o = this.#origin();
    return { x: o.x + REGION_X + idiv(i, 2) * COLUMN_WIDTH, y: o.y + REGION_Y + (i % 2) * ROW_HEIGHT };
  }

  #cellCorner(i: number): { readonly x: number; readonly y: number } {
    const o = this.#origin();
    return { x: o.x + CELL_X + idiv(i, 2) * COLUMN_WIDTH, y: o.y + CELL_Y + (i % 2) * ROW_HEIGHT };
  }

  #createMercRegions(prompt: TacticalPlacementPromptView): void {
    const regions = this.#host.services.regions;
    this.#regions = prompt.mercs.map((_m, i) => {
      const at = this.#regionCorner(i);
      return regions.define({
        x1: at.x,
        y1: at.y,
        x2: at.x + REGION_WIDTH,
        y2: at.y + REGION_HEIGHT,
        priority: Priority.HIGH,
        cursor: CURSOR_NORMAL,
        owner: OWNER,
        id: `placement.merc${i}`,
        onMove: (region) => this.#mercMove(region, i),
        onButton: (_r, reason) => this.#mercClick(reason, i),
      });
    });
  }

  #mercMove(region: MouseRegion, i: number): void {
    const merc = this.#prompt?.mercs[i];
    if (!region.inArea || !merc || this.#hilighted === i) return;
    this.#hilighted = i;
    if (this.#prompt?.button === 'group') this.#hilightedGroup = merc.group;
    this.#setCursorMerc(i);
    this.#hilightedSoldier = merc.soldier;
  }

  #mercClick(reason: number, i: number): void {
    const merc = this.#prompt?.mercs[i];
    if (!(reason & MouseReason.LBUTTON_DWN) || !merc || this.#selected === i) return;
    this.#selected = i;
    this.#selectedSoldier = merc.soldier;
    if (this.#prompt?.button === 'group') this.#selectedGroup = merc.group;
  }

  #setCursorMerc(i: number): void {
    this.#cursor = i;
  }

  close(): void {
    if (!this.#prompt) return;
    this.#prompt = null;
    this.#host.services.buttons.removeOwner(OWNER);
    this.#buttons = [];
    for (const region of this.#regions) region.remove();
    this.#regions = [];
    this.#selected = NOBODY;
    this.#hilighted = NOBODY;
    this.#cursor = NOBODY;
    this.#selectedGroup = NO_GROUP;
    this.#hilightedGroup = NO_GROUP;
    this.#selectedSoldier = null;
    this.#hilightedSoldier = null;
  }

  update(): void {
    if (!this.#prompt) return;
    this.#giveUpHilight();
    if (this.#host.services.regions.isButtonDown(MouseButtonMask.RIGHT)) {
      this.#selected = NOBODY;
      this.#selectedGroup = NO_GROUP;
      this.#selectedSoldier = null;
    }
    this.#host.mapRegion()?.changeCursor(this.#mapCursor());
  }

  #giveUpHilight(): void {
    if (this.#hilighted === NOBODY) return;
    const regions = this.#host.services.regions;
    const at = this.#regionCorner(this.#hilighted);
    const x = regions.mouseX;
    const y = regions.mouseY;
    if (x >= at.x && at.x + REGION_WIDTH >= x && y >= at.y && at.y + REGION_HEIGHT >= y) return;
    this.#hilighted = NOBODY;
    this.#hilightedGroup = NO_GROUP;
    this.#setCursorMerc(this.#selected);
    this.#hilightedSoldier = null;
  }

  #pointerOnMap(): { readonly x: number; readonly y: number } | null {
    const regions = this.#host.services.regions;
    const o = this.#origin();
    const x = regions.mouseX - o.x;
    const y = regions.mouseY - o.y;
    return y >= 0 && y < MAP_BOTTOM && x >= 0 && x < MAP_WIDTH ? { x, y } : null;
  }

  #side(i: number): PlacementSide | null {
    return this.#prompt?.mercs[i]?.side ?? null;
  }

  #validCursor(): boolean {
    const at = this.#pointerOnMap();
    if (this.#selected === NOBODY || !at) return false;
    switch (this.#side(this.#cursor)) {
      case 'north':
        return at.y <= NORTH_LIMIT;
      case 'east':
        return at.x >= EAST_LIMIT;
      case 'south':
        return at.y >= SOUTH_LIMIT;
      case 'west':
        return at.x <= WEST_LIMIT;
      default:
        return false;
    }
  }

  #mapCursor(): number {
    if (this.#selected === NOBODY || !this.#pointerOnMap()) return CURSOR_NORMAL;
    const valid = this.#validCursor();
    if (this.#prompt?.button === 'group') return valid ? CURSOR_PLACEGROUP : CURSOR_DPLACEGROUP;
    return valid ? CURSOR_PLACEMERC : CURSOR_DPLACEMERC;
  }

  #send(choice: PlacementAnswer, place?: { soldier: number; gridNo: number }): Promise<PlacementReply> | null {
    const prompt = this.#prompt;
    return prompt ? this.#host.answer(prompt.id, choice, place) : null;
  }

  #clear(): void {
    void this.#send(PlacementAnswer.CLEAR);
    this.#selectFirstForClear();
  }

  #spread(): void {
    void this.#send(PlacementAnswer.SPREAD);
    this.#everyonePlaced = true;
    this.#selectedGroup = NO_GROUP;
    this.#selected = NOBODY;
    this.#setCursorMerc(NOBODY);
  }

  #group(): void {
    const prompt = this.#prompt;
    if (!prompt) return;
    void this.#send(PlacementAnswer.GROUP);
    if (prompt.button === 'group') {
      this.#selectedGroup = NO_GROUP;
      return;
    }
    this.#selected = 0;
    this.#setCursorMerc(0);
    this.#selectedGroup = prompt.mercs[0]?.group ?? NO_GROUP;
  }

  #done(): void {
    if (this.#prompt?.everyonePlaced) void this.#send(PlacementAnswer.DONE);
  }

  keyInput(event: UiKeyEvent | UiTextEvent): void {
    if (event.kind !== 'keyDown') return;
    if (event.key === DONE_KEY) this.#done();
    else if (event.key === CLEAR_KEY) this.#clear();
    else if (event.key === GROUP_KEY) this.#group();
    else if (event.key === SPREAD_KEY) this.#spread();
    else if (event.key === EXIT_GAME_KEY && event.modifiers & KeyModifier.ALT) this.#host.exitGame();
  }

  mapButton(reason: number): void {
    if (!(reason & (MouseReason.LBUTTON_UP | MouseReason.RBUTTON_UP))) return;
    if (!this.#validCursor()) {
      if (this.#cursor !== NOBODY) this.#box(this.#string(STR_TP_INVALID_MESSAGE));
      return;
    }
    const merc = this.#prompt?.mercs[this.#selected];
    const gridNo = this.#host.mapGridNo();
    if (!merc || gridNo === null) return;
    const placing = this.#placedBy(merc.soldier);
    void this.#send(PlacementAnswer.PLACE, { soldier: merc.soldier, gridNo })?.then((reply) => this.#placed(reply, placing));
  }

  #placedBy(soldier: number): ReadonlySet<number> {
    const prompt = this.#prompt;
    if (prompt?.button !== 'group') return new Set([soldier]);
    const group = prompt.mercs.find((m) => m.soldier === soldier)?.group;
    return new Set(prompt.mercs.filter((m) => m.group === group).map((m) => m.soldier));
  }

  #placed(reply: PlacementReply, placing: ReadonlySet<number>): void {
    if (reply.ok) {
      this.#selectNextUnplaced(placing);
      return;
    }
    const token = refusalOf(reply.data);
    const message = token ? refusalMessage(token) : null;
    if (message) this.#box(this.#host.text.string(message.table, message.index) ?? '');
  }

  #box(text: string): void {
    const o = this.#origin();
    this.#host.box(text, { x: o.x + BOX_X, y: o.y + BOX_Y, width: BOX_WIDTH, height: BOX_HEIGHT });
  }

  #selectNextUnplaced(placing: ReadonlySet<number>): void {
    const prompt = this.#prompt;
    if (!prompt || this.#selected === NOBODY) return;
    const unplaced = (i: number) => {
      const m = prompt.mercs[i];
      return m !== undefined && !m.placed && !placing.has(m.soldier);
    };
    const from = this.#selected;
    const order = [...prompt.mercs.keys()].slice(from).concat([...prompt.mercs.keys()].slice(0, from));
    const next = order.find(unplaced);
    if (next !== undefined) {
      this.#selectUnplaced(prompt, next);
      return;
    }
    if (this.#everyonePlaced) return;
    this.#everyonePlaced = true;
    this.#setCursorMerc(NOBODY);
    this.#selected = NOBODY;
    this.#selectedGroup = NO_GROUP;
    this.#selectedSoldier = prompt.mercs[from]?.soldier ?? null;
  }

  #selectUnplaced(prompt: TacticalPlacementPromptView, i: number): void {
    const merc = prompt.mercs[i];
    if (!merc) return;
    this.#selected = i;
    if (prompt.button === 'group') this.#selectedGroup = merc.group;
    this.#setCursorMerc(i);
    this.#selectedSoldier = merc.soldier;
  }

  personFrame(s: SoldierView): number {
    if (s.id === this.#selectedSoldier) return SELECTED_PERSON;
    if (s.id === this.#hilightedSoldier) return HILITED_PERSON;
    return s.team;
  }

  #hatchClip(prompt: TacticalPlacementPromptView): Clip {
    const o = this.#origin();
    const clip = { left: o.x + MAP_LEFT, top: o.y + MAP_TOP, right: o.x + MAP_RIGHT, bottom: o.y + MAP_BOTTOM };
    const sides = new Set<PlacementSide | null>(
      this.#cursor === NOBODY ? prompt.mercs.map((m) => m.side) : [prompt.mercs[this.#cursor]?.side ?? null],
    );
    if (sides.has('north')) clip.top = o.y + STRIP;
    if (sides.has('east')) clip.right = o.x + MAP_WIDTH - STRIP;
    if (sides.has('south')) clip.bottom = o.y + MAP_BOTTOM - STRIP;
    if (sides.has('west')) clip.left = o.x + STRIP;
    return clip;
  }

  renderOverMap(list: DrawList): void {
    const prompt = this.#prompt;
    if (!prompt) return;
    const clip = this.#hatchClip(prompt);
    const hour = this.#host.hour();
    const colour = hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? BLACK : NIGHT_HATCH;
    list.looseHatch(clip.left, clip.top, clip.right, clip.bottom, colour);
    list.rectangle(clip.left, clip.top, clip.right, clip.bottom, colour);
  }

  render(list: DrawList): void {
    const prompt = this.#prompt;
    if (!prompt) return;
    const o = this.#origin();
    const art = this.#host.art();
    list.image(art.panel, 0, o.x, o.y + PANEL_Y);
    for (const [i, m] of prompt.mercs.entries()) this.#renderCell(list, art, m.soldier, i);
    const block = this.#host.services.fonts.get(FontName.BLOCKFONT);
    const title = `${this.#string(STR_TP_SECTOR)} ${this.#host.sectorName(prompt.sector)} -- ${this.#string(STR_TP_CHOOSEENTRYPOSITIONS)}...`;
    mprint(list, block, o.x + TITLE_X, o.y + TITLE_Y, title, fontColors(FontColor.BEIGE));
    for (const [i, m] of prompt.mercs.entries()) this.#renderName(list, prompt, m, i);
    this.#host.services.buttons.render(list, OWNER);
  }

  #renderCell(list: DrawList, art: PlacementArt, soldier: number, i: number): void {
    const { x, y } = this.#cellCorner(i);
    const merc = this.#host.merc(soldier);
    list.fill(x + BARS_LEFT, y + BARS_TOP, x + BARS_RIGHT, y + BARS_BOTTOM, BLACK);
    list.image(art.faces, 0, x, y);
    if (merc?.face) list.image(merc.face, 0, x + PORTRAIT_INSET, y + PORTRAIT_INSET);
    if (!merc || merc.life === 0) return;
    const bottom = y + BAR_BASE;
    const bar = (dx: number, value: number, shadow: ReturnType<typeof rgb>, colour: ReturnType<typeof rgb>) => {
      const top = bottom - idiv(value * BAR_RANGE, FULL);
      list.fill(x + dx, top, x + dx + 1, bottom, shadow);
      list.fill(x + dx + 1, top, x + dx + 2, bottom, colour);
    };
    bar(BARS_LEFT, merc.lifeMax, BLEEDING_SHADOW, BLEEDING);
    bar(BARS_LEFT, merc.bleeding, BANDAGED_SHADOW, BANDAGED);
    bar(BARS_LEFT, merc.life, LIFE_SHADOW, LIFE);
    bar(BARS_LEFT + BAR_STEP, merc.breathMax, BREATH_SHADOW, BREATH);
    bar(BARS_LEFT + 2 * BAR_STEP, merc.morale, MORALE_SHADOW, MORALE);
  }

  #nameColour(prompt: TacticalPlacementPromptView, group: number, i: number): number {
    const grouped = prompt.button === 'group';
    if (grouped ? group === this.#selectedGroup : i === this.#selected) return FontColor.YELLOW;
    if (grouped ? group === this.#hilightedGroup : i === this.#hilighted) return FontColor.WHITE;
    return FontColor.GRAY3;
  }

  #renderName(list: DrawList, prompt: TacticalPlacementPromptView, m: TacticalPlacementPromptView['mercs'][number], i: number): void {
    const fonts = this.#host.services.fonts;
    const block = fonts.get(FontName.BLOCKFONT);
    const { x, y } = this.#cellCorner(i);
    const colours = fontColors(this.#nameColour(prompt, m.group, i));
    const name = this.#host.merc(m.soldier)?.name ?? '';
    mprint(list, block, x + idiv(NAME_WIDTH - stringPixLength(name, block), 2), y + NAME_DY, name, colours);
    if (!m.placed) mprint(list, fonts.get(FontName.FONT10ARIALBOLD), x + QUESTION_DX, y + QUESTION_DY, '?', colours);
  }

  describe(): WidgetInfo[] {
    const prompt = this.#prompt;
    if (!prompt) return [];
    const o = this.#origin();
    return [
      {
        id: OWNER,
        kind: OWNER,
        rect: { x: o.x, y: o.y + PANEL_Y, width: MAP_WIDTH, height: VALID_STRIP * 4 },
        visible: true,
        enabled: true,
        state: prompt.everyonePlaced ? 'everyonePlaced' : 'placing',
        text: null,
        frame: null,
      },
      ...prompt.mercs.map((m, i) => this.#describeMerc(m, i)),
      ...this.#buttons.map((b) => b.describe()),
    ];
  }

  #describeMerc(m: TacticalPlacementPromptView['mercs'][number], i: number): WidgetInfo {
    const at = this.#regionCorner(i);
    return {
      id: `placement.merc${i}`,
      kind: 'placementMerc',
      rect: { x: at.x, y: at.y, width: REGION_WIDTH, height: REGION_HEIGHT },
      visible: true,
      enabled: true,
      state: m.placed ? 'placed' : 'unplaced',
      text: this.#host.merc(m.soldier)?.name ?? null,
      frame: null,
    };
  }
}

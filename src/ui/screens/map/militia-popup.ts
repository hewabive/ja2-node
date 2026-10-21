// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc HandleMilitiaRedistributionClick (a found town that trains militia and has no fight
// @src in its militia map, else pMilitiaString[2], pMapErrorString[31] with the town or pMapErrorString[30] for a found SAM
// @src site); src/game/Strategic/Map_Screen_Interface_Map.cc DrawMilitiaPopUpBox (militia.sti 0, the town's
// @src militiamaps.sti frame, the town name and the "unassigned" label in FONT10ARIAL white), CreateDestroyMilitiaPopUPRegions
// @src (nine cells at MSYS_PRIORITY_HIGHEST - 3, Auto and Done; closing spreads the troops still on the cursor),
// @src RenderIconsPerSectorForSelectedTown (the count right-aligned in the cell, shifted 15 left in the selected cell;
// @src icons 8..10 five per row, 5..7 tighter in the selected cell), RenderShadingForUnControlledSectors,
// @src DisplayUnallocatedMilitia (icons 8..10, 25 per lower row), ShowHighLightedSectorOnMilitiaMap,
// @src MilitiaRegionClickCallbackPrimary/Secondary, MilitiaRegionMoveCallback, IsThisMilitiaTownSectorAllowable,
// @src CreateDestroyMilitiaSectorButtons (militia.sti 3/4 per rank at MILITIA_BTN_OFFSET_X, FONT10ARIAL in
// @src gsMilitiaSectorButtonColors, the move box screen mask whose right click closes the popup), SetMilitiaMapButtonsText,
// @src MilitiaButtonCallbackPrimary (drop) and Secondary (pick up), PickUpATownPersonFromSector, DropAPersonInASector
// @src (same town, ours and peaceful, at most MAX_ALLOWABLE_MILITIA_PER_SECTOR), HandleShutDownOfMilitiaPanelIfPeopleOnTheCursor,
// @src CreateMilitiaPanelBottomButton (militia.sti 1/2, Auto disabled when CanMilitiaAutoDistribute fails at creation),
// @src MilitiaAutoButtonCallback, MilitiaDoneButtonCallback, CheckAndUpdateStatesOfSelectedMilitiaSectorButtons.
// @src See docs/28 §7.8.

import { type Sector, sectorFromId, sectorId } from '../../../content/strategic/sector-ids.ts';
import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import { refusalMessage } from '../../../protocol/refusals.ts';
import type { StrategicSectorView, StrategicView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import { MouseReason, NO_CURSOR, Priority } from '../../input/mouse.ts';
import type { MouseRegion, RegionDispatcher } from '../../input/regions.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { type BitmapFont, fontHeight } from '../../text/bitmap-font.ts';
import { hCenterVCenterAlign, hRightVCenterAlign } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { type Button, type ButtonSystem, twoFrameImage } from '../../widgets/button.ts';
import { type WidgetInfo, widgetRect } from '../../widgets/widget-info.ts';
import { foundSecrets, isSecretFound, isTownFound, type MapFacts, parseSectorLabel, sectorLabel } from './facts.ts';

export const MILITIA_RANKS = ['green', 'regular', 'elite'] as const;
export const MAX_MILITIA_PER_SECTOR = 20;
const RANKS = MILITIA_RANKS.length;
const BOX_ROWS = 3;
const CELLS = BOX_ROWS * BOX_ROWS;
const MAP_SIDE = 16;
const NO_CELL = -1;
const SELECTED_COUNT_SHIFT = 15;
const COUNT_BOTTOM_GAP = 5;
const CELL_PRIORITY = Priority.HIGHEST - 3;
const MASK_PRIORITY = Priority.HIGHEST - 4;
const BUTTON_PRIORITY = Priority.HIGHEST - 1;
const OWNER = 'militiaPopup';
const MILITIA_STRING = 'pMilitiaString';
const MILITIA_BUTTONS = 'pMilitiaButtonString';
const MILITIA_HELP = 'pMilitiaButtonsHelpText';
const MAP_ERROR = 'pMapErrorString';
const TOWN_NAMES = 'strategic-map-town-names';
const MILITIA_WORD = 0;
const UNASSIGNED = 1;
const IN_COMBAT = 2;
const SAM_SITE = 30;
const NO_MILITIA_ALLOWED = 31;
const AUTO_HELP = 3;
const AUTO = 0;
const DONE = 1;
const UNSURE_ENEMIES = '?';

export type MilitiaCounts = readonly number[];

export interface MilitiaGeometry {
  readonly boxX: number;
  readonly boxY: number;
  readonly mapX: number;
  readonly mapY: number;
  readonly lowerRowY: number;
  readonly lowerRowIcons: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly iconsPerRow: number;
  readonly iconSpacing: number;
  readonly buttonOffsetX: number;
  readonly buttonHeight: number;
  readonly boxWidth: number;
  readonly titleOffsetY: number;
  readonly unassignedOffsetY: number;
  readonly titleHeight: number;
  readonly autoX: number;
  readonly autoY: number;
  readonly doneX: number;
}

export interface MilitiaArt {
  readonly box: string;
  readonly maps: string;
  readonly highlight: string;
  readonly outline: string;
  readonly font: BitmapFont;
  readonly textColor: number;
  readonly buttonColor: number;
  readonly rankColors: readonly number[];
  readonly buttonFrames: readonly [number, number];
  readonly rankFrames: readonly [number, number];
  readonly smallIcon: number;
  readonly mediumIcon: number;
}

export function militiaGeometry(model: LayoutModel): MilitiaGeometry {
  const n = (name: string) => model.number(name);
  return {
    boxX: n('MAP_MILITIA_BOX_POS_X'),
    boxY: n('MAP_MILITIA_BOX_POS_Y'),
    mapX: n('MAP_MILITIA_MAP_X'),
    mapY: n('MAP_MILITIA_MAP_Y'),
    lowerRowY: n('MAP_MILITIA_LOWER_ROW_Y'),
    lowerRowIcons: n('NUMBER_OF_MILITIA_ICONS_PER_LOWER_ROW'),
    cellWidth: n('MILITIA_BOX_BOX_WIDTH'),
    cellHeight: n('MILITIA_BOX_BOX_HEIGHT'),
    iconsPerRow: n('POPUP_MILITIA_ICONS_PER_ROW'),
    iconSpacing: n('MEDIUM_MILITIA_ICON_SPACING'),
    buttonOffsetX: n('MILITIA_BTN_OFFSET_X'),
    buttonHeight: n('MILITIA_BTN_HEIGHT'),
    boxWidth: n('MILITIA_BOX_WIDTH'),
    titleOffsetY: n('MILITIA_BOX_TEXT_OFFSET_Y'),
    unassignedOffsetY: n('MILITIA_BOX_UNASSIGNED_TEXT_OFFSET_Y'),
    titleHeight: n('MILITIA_BOX_TEXT_TITLE_HEIGHT'),
    autoX: n('MAP_MILITIA_BOX_AUTO_BOX_X'),
    autoY: n('MAP_MILITIA_BOX_AUTO_BOX_Y'),
    doneX: n('MAP_MILITIA_BOX_DONE_BOX_X'),
  };
}

type JsonObject = Readonly<Record<string, unknown>>;

function pair(value: unknown): readonly [number, number] {
  const [a, b] = Array.isArray(value) ? value : [];
  return [Number(a ?? 0), Number(b ?? 0)];
}

export function militiaArt(model: LayoutModel, fonts: { get(name: string): BitmapFont }, styleName: string): MilitiaArt {
  const style = model.style(styleName) as JsonObject;
  const asset = (key: string) => model.asset(String(style[key])).path;
  const frames = style.frames as JsonObject;
  return {
    box: asset('box'),
    maps: asset('maps'),
    highlight: asset('highlight'),
    outline: asset('outline'),
    font: fonts.get(model.font(String(style.font))),
    textColor: model.color(style.textColor as string, FontColor.WHITE),
    buttonColor: model.color(style.buttonColor as string, FontColor.BLACK),
    rankColors: (style.rankColors as readonly (string | number)[]).map((c) => model.color(c, FontColor.WHITE)),
    buttonFrames: pair(frames.button),
    rankFrames: pair(frames.rank),
    smallIcon: Number(frames.smallIcon),
    mediumIcon: Number(frames.mediumIcon),
  };
}

export interface MilitiaMove {
  readonly from: number;
  readonly to: number;
  readonly rank: number;
  readonly count: number;
}

function total(counts: MilitiaCounts | undefined): number {
  return (counts ?? []).reduce((sum, n) => sum + n, 0);
}

function copyGrid(grid: ReadonlyMap<number, MilitiaCounts>): Map<number, number[]> {
  return new Map([...grid].map(([id, counts]) => [id, [...counts]]));
}

export function spreadCursor(
  grid: ReadonlyMap<number, MilitiaCounts>,
  cursor: MilitiaCounts,
  sectors: readonly number[],
  peaceful: (id: number) => boolean,
): Map<number, number[]> {
  const result = copyGrid(grid);
  const left = [...cursor];
  for (const id of sectors) {
    if (!peaceful(id)) continue;
    const counts = result.get(id) ?? new Array<number>(RANKS).fill(0);
    let room = MAX_MILITIA_PER_SECTOR - total(counts);
    if (room <= 0) continue;
    while (room > 0 && total(left) > 0) {
      for (let rank = 0; rank < RANKS && room > 0; rank++) {
        if ((left[rank] ?? 0) === 0) continue;
        counts[rank] = (counts[rank] ?? 0) + 1;
        left[rank] = (left[rank] ?? 0) - 1;
        room--;
      }
    }
    result.set(id, counts);
  }
  return result;
}

function transfers(base: ReadonlyMap<number, MilitiaCounts>, target: ReadonlyMap<number, MilitiaCounts>): MilitiaMove[] {
  const ids = [...new Set([...base.keys(), ...target.keys()])].sort((a, b) => a - b);
  const pending: MilitiaMove[] = [];
  for (let rank = 0; rank < RANKS; rank++) {
    const givers = ids.flatMap((id) => {
      const n = (base.get(id)?.[rank] ?? 0) - (target.get(id)?.[rank] ?? 0);
      return n > 0 ? [{ id, n }] : [];
    });
    const takers = ids.flatMap((id) => {
      const n = (target.get(id)?.[rank] ?? 0) - (base.get(id)?.[rank] ?? 0);
      return n > 0 ? [{ id, n }] : [];
    });
    let g = 0;
    for (const taker of takers) {
      while (taker.n > 0 && g < givers.length) {
        const giver = givers[g] as { id: number; n: number };
        const count = Math.min(giver.n, taker.n);
        pending.push({ from: giver.id, to: taker.id, rank, count });
        giver.n -= count;
        taker.n -= count;
        if (giver.n === 0) g++;
      }
    }
  }
  return pending;
}

export function militiaMoves(base: ReadonlyMap<number, MilitiaCounts>, target: ReadonlyMap<number, MilitiaCounts>): MilitiaMove[] {
  const current = copyGrid(base);
  let pending = transfers(base, target);
  const moves: MilitiaMove[] = [];
  let progressed = true;
  while (pending.length > 0 && progressed) {
    progressed = false;
    const next: MilitiaMove[] = [];
    for (const move of pending) {
      const from = current.get(move.from) ?? new Array<number>(RANKS).fill(0);
      const to = current.get(move.to) ?? new Array<number>(RANKS).fill(0);
      const count = Math.min(move.count, MAX_MILITIA_PER_SECTOR - total(to), from[move.rank] ?? 0);
      if (count > 0) {
        from[move.rank] = (from[move.rank] ?? 0) - count;
        to[move.rank] = (to[move.rank] ?? 0) + count;
        current.set(move.from, from);
        current.set(move.to, to);
        moves.push({ ...move, count });
        progressed = true;
      }
      if (count < move.count) next.push({ ...move, count: move.count - count });
    }
    pending = next;
  }
  return moves;
}

export interface MilitiaPopupHost {
  readonly regions: RegionDispatcher;
  readonly buttons: ButtonSystem;
  readonly text: UiTextService;
  readonly facts: MapFacts;
  readonly origin: () => { readonly x: number; readonly y: number };
  readonly geometry: () => MilitiaGeometry;
  readonly art: () => MilitiaArt;
  readonly strategic: () => StrategicView | undefined;
  readonly battleSector: () => string | null;
  readonly send: (cmd: CommandEnvelope) => Promise<{ readonly ok: boolean; readonly data?: unknown }>;
  readonly box: (text: string) => void;
}

export class MilitiaPopup {
  readonly #host: MilitiaPopupHost;
  #town = 0;
  #base = new Map<number, MilitiaCounts>();
  #grid = new Map<number, number[]>();
  #cursor: number[] = [0, 0, 0];
  #dirty = false;
  #selected = NO_CELL;
  #outline = NO_CELL;
  #cells: MouseRegion[] = [];
  #mask: MouseRegion | null = null;
  #bottom: Button[] = [];
  #rankButtons: Button[] = [];

  constructor(host: MilitiaPopupHost) {
    this.#host = host;
  }

  get open(): boolean {
    return this.#town !== 0;
  }

  get town(): number {
    return this.#town;
  }

  get cursor(): MilitiaCounts {
    return this.#cursor;
  }

  get selectedCell(): number {
    return this.#selected;
  }

  get cursorEmpty(): boolean {
    return total(this.#cursor) === 0;
  }

  cellSector(cell: number): number {
    return this.#boxSectors(this.#town)[cell] ?? 0;
  }

  #view(id: number): StrategicSectorView | undefined {
    const name = sectorLabel(sectorFromId(id));
    return this.#host.strategic()?.sectors.find((s) => s.sector === name);
  }

  #hostilesKnown(view: StrategicSectorView | undefined): boolean {
    return view?.enemies !== null && view?.enemies !== undefined && (view.enemies === UNSURE_ENEMIES || view.enemies > 0);
  }

  peaceful(id: number): boolean {
    const view = this.#view(id);
    if (view?.playerControlled !== true || this.#hostilesKnown(view)) return false;
    return this.#host.battleSector() !== sectorLabel(sectorFromId(id));
  }

  #shaded(id: number): boolean {
    const view = this.#view(id);
    return view?.playerControlled === false || this.#hostilesKnown(view) || this.#host.battleSector() === sectorLabel(sectorFromId(id));
  }

  militiaIn(id: number): MilitiaCounts {
    return this.#grid.get(id) ?? this.#view(id)?.militia ?? [0, 0, 0];
  }

  #townSectors(): readonly number[] {
    return this.#host.facts.town(this.#town)?.sectors ?? [];
  }

  #snapshot(): void {
    this.#base = new Map(this.#townSectors().map((id) => [id, [...(this.#view(id)?.militia ?? [0, 0, 0])]]));
    this.#grid = copyGrid(this.#base);
  }

  request(s: Sector): void {
    if (s.z !== 0) return;
    const facts = this.#host.facts;
    const text = this.#host.text;
    const id = sectorId(s);
    const town = facts.townOf(id);
    const found = foundSecrets(this.#host.strategic()?.secretsFound);
    if (town !== 0 && isTownFound(facts, found, town)) {
      if (!facts.town(town)?.isMilitiaTrainingAllowed)
        this.#host.box(printf(text.string(MAP_ERROR, NO_MILITIA_ALLOWED) ?? '', [text.string(TOWN_NAMES, town) ?? '']));
      else if (this.#battleInTown(town)) this.#host.box(text.string(MILITIA_STRING, IN_COMBAT) ?? '');
      else this.show(town);
      return;
    }
    if (facts.samSectors.includes(id) && isSecretFound(facts, found, id)) this.#host.box(text.string(MAP_ERROR, SAM_SITE) ?? '');
  }

  #boxSectors(town: number): number[] {
    const base = this.#host.facts.town(town)?.militiaMapBaseSector ?? 0;
    return Array.from({ length: CELLS }, (_, cell) => base + (cell % BOX_ROWS) + idiv(cell, BOX_ROWS) * MAP_SIDE);
  }

  #battleInTown(town: number): boolean {
    const battle = this.#host.battleSector();
    if (!battle) return false;
    return this.#boxSectors(town).some((id) => this.#host.facts.townOf(id) === town && sectorLabel(sectorFromId(id)) === battle);
  }

  show(town: number): void {
    this.close();
    this.#town = town;
    this.#cursor = [0, 0, 0];
    this.#selected = NO_CELL;
    this.#outline = NO_CELL;
    this.#dirty = false;
    this.#snapshot();
    this.#defineCells();
    this.#createBottomButtons();
  }

  update(): void {
    if (!this.open) return;
    if (!this.#dirty) this.#snapshot();
    this.#syncButtons();
  }

  #cellOrigin(cell: number): { x: number; y: number } {
    const g = this.#host.geometry();
    const o = this.#host.origin();
    return {
      x: o.x + g.boxX + g.mapX + (cell % BOX_ROWS) * g.cellWidth,
      y: o.y + g.boxY + g.mapY + idiv(cell, BOX_ROWS) * g.cellHeight,
    };
  }

  #defineCells(): void {
    const g = this.#host.geometry();
    this.#cells = Array.from({ length: CELLS }, (_, cell) => {
      const at = this.#cellOrigin(cell);
      return this.#host.regions.define({
        x1: at.x,
        y1: at.y,
        x2: at.x + g.cellWidth,
        y2: at.y + g.cellHeight,
        priority: CELL_PRIORITY,
        cursor: NO_CURSOR,
        owner: OWNER,
        id: `militiaCell${cell}`,
        onMove: (_r, reason) => this.#cellMove(cell, reason),
        onButton: (_r, reason) => this.#cellButton(cell, reason),
      });
    });
  }

  #allowable(cell: number): boolean {
    const id = this.cellSector(cell);
    return this.#host.facts.townOf(id) !== 0 && this.peaceful(id);
  }

  #cellMove(cell: number, reason: number): void {
    if (reason & MouseReason.GAIN_MOUSE) this.#outline = this.#allowable(cell) ? cell : NO_CELL;
    else if (reason & MouseReason.LOST_MOUSE) this.#outline = NO_CELL;
  }

  #cellButton(cell: number, reason: number): void {
    if (reason & MouseReason.LBUTTON_UP) this.selectCell(!this.#allowable(cell) || this.#selected === cell ? NO_CELL : cell);
    else if (reason & MouseReason.RBUTTON_UP) this.selectCell(NO_CELL);
  }

  selectCell(cell: number): void {
    if (cell === this.#selected) return;
    this.#removeRankButtons();
    this.#selected = cell;
    if (cell !== NO_CELL) this.#createRankButtons(cell);
    this.#syncButtons();
  }

  #createBottomButtons(): void {
    const g = this.#host.geometry();
    const art = this.#host.art();
    const o = this.#host.origin();
    const make = (index: number, x: number, click: () => void): Button =>
      this.#host.buttons.create({
        x: o.x + g.boxX + x,
        y: o.y + g.boxY + g.autoY,
        kind: 'quick',
        image: twoFrameImage(art.box, art.buttonFrames[0], art.buttonFrames[1]),
        priority: BUTTON_PRIORITY,
        owner: OWNER,
        id: index === AUTO ? 'militiaAuto' : 'militiaDone',
        text: {
          text: this.#host.text.string(MILITIA_BUTTONS, index) ?? '',
          font: art.font,
          color: art.buttonColor,
          shadow: art.buttonColor,
          downColor: art.buttonColor,
          downShadow: art.buttonColor,
        },
        onClick: (_b, reason) => {
          if (reason & MouseReason.LBUTTON_UP) click();
        },
      });
    const auto = make(AUTO, g.autoX, () => void this.auto());
    auto.setTooltip(this.#host.text.string(MILITIA_HELP, AUTO_HELP) ?? '');
    auto.setEnabled(this.#canAutoDistribute());
    this.#bottom = [auto, make(DONE, g.doneX, () => this.close())];
  }

  #canAutoDistribute(): boolean {
    return this.#townSectors().some((id) => this.#view(id)?.playerControlled !== false && total(this.militiaIn(id)) !== 0);
  }

  #createRankButtons(cell: number): void {
    const g = this.#host.geometry();
    const art = this.#host.art();
    const at = this.#cellOrigin(cell);
    this.#rankButtons = MILITIA_RANKS.map((_, rank) => {
      const button = this.#host.buttons.create({
        x: at.x + g.buttonOffsetX,
        y: at.y + 2 + rank * g.buttonHeight,
        kind: 'quick',
        image: twoFrameImage(art.box, art.rankFrames[0], art.rankFrames[1]),
        priority: BUTTON_PRIORITY,
        owner: OWNER,
        id: `militiaRank${rank}`,
        text: { text: '', font: art.font, color: art.rankColors[rank] ?? FontColor.WHITE, shadow: FontColor.BLACK, shift: false },
        onClick: (_b, reason) => {
          if (reason & MouseReason.LBUTTON_UP) this.drop(rank, this.cellSector(cell));
          else if (reason & MouseReason.RBUTTON_UP) this.pickUp(rank, this.cellSector(cell));
        },
      });
      button.setTooltip(this.#host.text.string(MILITIA_HELP, rank) ?? '');
      return button;
    });
    this.#mask = this.#host.regions.define({
      x1: 0,
      y1: 0,
      x2: 0xffff,
      y2: 0xffff,
      priority: MASK_PRIORITY,
      cursor: NO_CURSOR,
      owner: OWNER,
      id: 'militiaMask',
      onButton: (_r, reason) => {
        if (reason & MouseReason.RBUTTON_UP) this.close();
      },
    });
  }

  #removeRankButtons(): void {
    for (const button of this.#rankButtons) button.remove();
    this.#rankButtons = [];
    this.#mask?.remove();
    this.#mask = null;
  }

  #syncButtons(): void {
    const done = this.#bottom[DONE];
    if (this.#selected === NO_CELL) {
      done?.setEnabled(true);
      return;
    }
    const counts = this.militiaIn(this.cellSector(this.#selected));
    done?.setEnabled(this.cursorEmpty);
    this.#rankButtons.forEach((button, rank) => {
      button.setText(String(counts[rank] ?? 0));
      button.setEnabled((counts[rank] ?? 0) + (this.#cursor[rank] ?? 0) !== 0);
    });
  }

  pickUp(rank: number, id: number): void {
    if (this.#host.facts.townOf(id) !== this.#town || !this.peaceful(id)) return;
    const counts = [...this.militiaIn(id)];
    if ((counts[rank] ?? 0) === 0) return;
    counts[rank] = (counts[rank] ?? 0) - 1;
    this.#cursor[rank] = (this.#cursor[rank] ?? 0) + 1;
    this.#grid.set(id, counts);
    this.#dirty = true;
    this.#syncButtons();
  }

  drop(rank: number, id: number): void {
    if (this.#host.facts.townOf(id) !== this.#town || !this.peaceful(id)) return;
    const counts = [...this.militiaIn(id)];
    if (total(counts) >= MAX_MILITIA_PER_SECTOR || (this.#cursor[rank] ?? 0) === 0) return;
    this.#cursor[rank] = (this.#cursor[rank] ?? 0) - 1;
    counts[rank] = (counts[rank] ?? 0) + 1;
    this.#grid.set(id, counts);
    this.#dirty = true;
    this.#syncButtons();
  }

  async auto(): Promise<void> {
    const town = this.#town;
    this.#cursor = [0, 0, 0];
    this.#dirty = false;
    this.#snapshot();
    const reply = await this.#host.send({ type: 'distributeMilitia', town });
    if (!reply.ok) this.#refused(reply, town);
  }

  #refused(reply: { readonly data?: unknown }, town: number): void {
    const token = (reply.data as { refusal?: string } | undefined)?.refusal;
    const message = token ? refusalMessage(token) : null;
    if (!message) return;
    const text = this.#host.text;
    this.#host.box(printf(text.string(message.table, message.index) ?? '', [text.string(TOWN_NAMES, town) ?? '']));
  }

  plannedMoves(): MilitiaMove[] {
    const target = spreadCursor(this.#grid, this.#cursor, this.#townSectors(), (id) => this.peaceful(id));
    return militiaMoves(this.#base, target);
  }

  close(): void {
    if (!this.open) return;
    const town = this.#town;
    const moves = this.#dirty ? this.plannedMoves() : [];
    for (const region of this.#cells) region.remove();
    this.#cells = [];
    this.#removeRankButtons();
    for (const button of this.#bottom) button.remove();
    this.#bottom = [];
    this.#town = 0;
    this.#selected = NO_CELL;
    this.#outline = NO_CELL;
    this.#cursor = [0, 0, 0];
    this.#dirty = false;
    this.#grid = new Map();
    void this.#commit(moves, town);
  }

  async #commit(moves: readonly MilitiaMove[], town: number): Promise<void> {
    for (const move of moves) {
      const reply = await this.#host.send({
        type: 'moveMilitia',
        from: sectorLabel(sectorFromId(move.from)),
        to: sectorLabel(sectorFromId(move.to)),
        rank: MILITIA_RANKS[move.rank] ?? MILITIA_RANKS[0],
        count: move.count,
      });
      if (!reply.ok) {
        this.#refused(reply, town);
        return;
      }
    }
  }

  overlay(strategic: StrategicView): StrategicView {
    if (!this.open || !this.#dirty) return strategic;
    const sectors = strategic.sectors.map((s) => {
      const at = parseSectorLabel(s.sector);
      const counts = at && at.z === 0 ? this.#grid.get(sectorId(at)) : undefined;
      return counts ? { ...s, militia: counts } : s;
    });
    return { ...strategic, sectors };
  }

  render(list: DrawList): void {
    if (!this.open) return;
    const g = this.#host.geometry();
    const art = this.#host.art();
    const o = this.#host.origin();
    const x = o.x + g.boxX;
    const y = o.y + g.boxY;
    list.image(art.box, 0, x, y);
    list.image(art.maps, this.#town - 1, x + g.mapX, y + g.mapY);
    this.#renderTitles(list, art, g, x, y);
    for (let cell = 0; cell < CELLS; cell++) this.#renderCell(list, art, g, cell);
    for (let cell = 0; cell < CELLS; cell++) this.#renderShade(list, g, cell);
    this.#renderCursor(list, art, g, x, y);
    if (this.#selected !== NO_CELL) {
      const at = this.#cellOrigin(this.#selected);
      list.image(art.highlight, 0, at.x, at.y);
    }
    if (this.#outline !== NO_CELL) {
      const at = this.#cellOrigin(this.#outline);
      list.image(art.outline, 0, at.x, at.y);
    }
    for (const button of [...this.#rankButtons, ...this.#bottom]) if (button.visible) this.#host.buttons.draw(list, button);
  }

  #renderTitles(list: DrawList, art: MilitiaArt, g: MilitiaGeometry, x: number, y: number): void {
    const town = this.#host.text.string(TOWN_NAMES, this.#town) ?? '';
    const colours = fontColors(art.textColor, DEFAULT_SHADOW);
    const title = `${town} ${this.#host.text.string(MILITIA_STRING, MILITIA_WORD) ?? ''}`;
    const at = hCenterVCenterAlign(x, y + g.titleOffsetY, g.boxWidth, g.titleHeight, title, art.font);
    mprint(list, art.font, at.x, at.y, title, colours);
    const unassigned = `${town} ${this.#host.text.string(MILITIA_STRING, UNASSIGNED) ?? ''}`;
    const at2 = hCenterVCenterAlign(x, y + g.unassignedOffsetY, g.boxWidth, fontHeight(art.font), unassigned, art.font);
    mprint(list, art.font, at2.x, at2.y, unassigned, colours);
  }

  #renderCell(list: DrawList, art: MilitiaArt, g: MilitiaGeometry, cell: number): void {
    const id = this.cellSector(cell);
    const facts = this.#host.facts;
    if (facts.townOf(id) !== this.#town) return;
    const counts = this.militiaIn(id);
    const n = total(counts);
    const at = this.#cellOrigin(cell);
    const selected = cell === this.#selected;
    if (this.#view(id)?.playerControlled !== false) {
      const text = String(n);
      const p = hRightVCenterAlign(at.x, at.y, g.cellWidth, 0, text, art.font);
      mprint(
        list,
        art.font,
        selected ? p.x - SELECTED_COUNT_SHIFT : p.x,
        p.y + g.cellHeight - COUNT_BOTTOM_GAP,
        text,
        fontColors(art.textColor, DEFAULT_SHADOW),
      );
    }
    const greens = counts[0] ?? 0;
    const regulars = counts[1] ?? 0;
    for (let i = 0; i < n; i++) {
      const column = i % g.iconsPerRow;
      const row = idiv(i, g.iconsPerRow);
      const ix = at.x + column * g.iconSpacing + (selected ? 2 : 3);
      const iy = at.y + row * (selected ? g.iconSpacing - 1 : g.iconSpacing) + 3;
      const base = selected ? art.smallIcon : art.mediumIcon;
      const rank = i < greens ? 0 : i < greens + regulars ? 1 : 2;
      list.image(art.box, base + rank, ix, iy);
    }
  }

  #renderShade(list: DrawList, g: MilitiaGeometry, cell: number): void {
    const id = this.cellSector(cell);
    if (this.#host.facts.townOf(id) === 0 || !this.#shaded(id)) return;
    const at = this.#cellOrigin(cell);
    list.shadow(at.x, at.y, at.x + g.cellWidth - 1, at.y + g.cellHeight - 1);
  }

  #renderCursor(list: DrawList, art: MilitiaArt, g: MilitiaGeometry, x: number, y: number): void {
    const [greens = 0, regulars = 0] = this.#cursor;
    const n = total(this.#cursor);
    for (let i = 0; i < n; i++) {
      const ix = (i % g.lowerRowIcons) * g.iconSpacing + x + g.mapX + 1;
      const iy = idiv(i, g.lowerRowIcons) * g.iconSpacing + y + g.lowerRowY;
      const rank = i < greens ? 0 : i < greens + regulars ? 1 : 2;
      list.image(art.box, art.mediumIcon + rank, ix, iy);
    }
  }

  describe(): WidgetInfo[] {
    if (!this.open) return [];
    const g = this.#host.geometry();
    const o = this.#host.origin();
    return [
      {
        id: 'militiaPopup',
        kind: 'militiaPopup',
        rect: widgetRect(o.x + g.boxX, o.y + g.boxY, g.boxWidth, g.autoY + g.buttonHeight),
        visible: true,
        enabled: true,
        state: this.#selected,
        text: this.#cursor.join('/'),
        frame: null,
      },
      ...this.#cells.map((r, cell) => ({
        id: `militiaCell${cell}`,
        kind: 'militiaCell',
        rect: widgetRect(r.x1, r.y1, r.width, r.height),
        visible: true,
        enabled: this.#allowable(cell),
        state: cell === this.#selected ? 'selected' : 'normal',
        text: this.militiaIn(this.cellSector(cell)).join('/'),
        frame: null,
      })),
      ...this.#rankButtons.map((b) => b.describe()),
      ...this.#bottom.map((b) => b.describe()),
    ];
  }
}

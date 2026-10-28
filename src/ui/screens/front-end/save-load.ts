// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadScreen.cc InitSaveGameArray (newest first; to save, quick and auto saves hidden and a new row
// @src first), EnterSaveLoadScreen (the newest row selected, the action button enabled with a selection),
// @src DisplaySaveGameEntry (the row states and the load tooltip), SelectedSaveRegionCallBack (click selects and on the
// @src new row opens the description field; double click saves over or loads; right click clears), DisableSelectedSlot,
// @src SelectedSaveRegionMovementCallBack, ScrollUp, ScrollDown, ScrollPositionTopMax, MoveSelectionUp,
// @src MoveSelectionDown, GetSaveLoadScreenUserInput (Escape clears the selection first, then leaves; Enter; Delete
// @src asks SLG_CONFIRM_DELETE), BtnSlgSaveLoadCallback, SaveLoadSelectedSave, SaveNewSave, DoSaveGame (from the game init
// @src screen the save only names the Dead is Dead slot), RenderScrollBar (the indicator position).

import { idiv } from '../../../core/int.ts';
import type { SaveListing } from '../../client/api-types.ts';
import { type Area, type DrawList, rgb } from '../../draw-list.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import type { NumberExpr } from '../../layout/types.ts';
import type { LayoutView } from '../../layout/view.ts';
import type { MessageBoxes } from '../../message-boxes.ts';
import type { SaveController } from '../../saves/save-controller.ts';
import { type SaveRow, saveRow } from '../../saves/save-rows.ts';
import type { Labels } from '../../text/labels.ts';
import { UiScreenKind } from '../../widgets/button-sounds.ts';
import { type FrontEndEnvironment, FrontEndLayout, FrontEndScreen } from './environment.ts';

export const SAVE_LOAD_SCREEN = 'saveLoad';
export const NUM_SAVE_GAMES = 11;
const NO_SELECTION = -1;
const NEW_ROW = 0;
const HOVER_ON = 1;
const HIDDEN_WHILE_SAVING: ReadonlySet<string> = new Set(['quick', 'auto']);

export const SAVE_LOAD_CONTRACT: ControllerContract = {
  id: SAVE_LOAD_SCREEN,
  actions: {
    select: { args: 1 },
    activate: { args: 1 },
    hoverRow: { args: 2 },
    clearSelection: {},
    scrollUp: {},
    scrollDown: {},
    moveUp: {},
    moveDown: {},
    escape: {},
    enter: {},
    delete: {},
    act: {},
    cancel: {},
    describe: { payload: 'string' },
  },
  bindings: {
    mode: 'string',
    rows: 'list',
    scrollTop: 'number',
    scrollMax: 'number',
    actionEnabled: 'boolean',
    description: 'string',
  },
};

export type SaveLoadMode = 'save' | 'load';
export type RowState = 'normal' | 'newRow' | 'highlighted' | 'selected';

export interface RowView {
  shown: boolean;
  selected: boolean;
  state: RowState;
  newLabel: boolean;
  fields: boolean;
  showDescription: boolean;
  editing: boolean;
  deadIsDead: boolean;
  date: string;
  sector: string;
  mercs: string;
  balance: string;
  description: string;
  tooltip: string;
}

export interface SaveLoadModel {
  mode: SaveLoadMode;
  rows: RowView[];
  scrollTop: number;
  scrollMax: number;
  actionEnabled: boolean;
  description: string;
}

export interface SaveLoadActions {
  leave(): void;
  saved(name: string): void;
  load(listing: SaveListing): void;
  nameSave(name: string | null, description: string): void;
}

export interface SaveLoadDeps {
  readonly mode: SaveLoadMode;
  readonly listings: readonly SaveListing[];
  readonly labels: () => Labels;
  readonly saves: SaveController;
  readonly boxes: MessageBoxes;
  readonly session: string | null;
  readonly namesSaveOnly: boolean;
  readonly actions: SaveLoadActions;
}

interface Entry {
  readonly listing: SaveListing | null;
  readonly row: SaveRow | null;
}

function listed(listings: readonly SaveListing[], mode: SaveLoadMode): SaveListing[] {
  const shown = listings.filter((l) => mode === 'load' || (!l.native && !HIDDEN_WHILE_SAVING.has(l.header?.kind ?? '')));
  return [...shown].sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0));
}

const EMPTY_ROW: RowView = {
  shown: false,
  selected: false,
  state: 'normal',
  newLabel: false,
  fields: false,
  showDescription: false,
  editing: false,
  deadIsDead: false,
  date: '',
  sector: '',
  mercs: '',
  balance: '',
  description: '',
  tooltip: '',
};

export class SaveLoadController extends ViewModelController {
  readonly view: SaveLoadModel;
  readonly #deps: SaveLoadDeps;
  #entries: Entry[] = [];
  #selected = NO_SELECTION;
  #highlighted = NO_SELECTION;
  #editing = false;
  #busy = false;

  constructor(deps: SaveLoadDeps) {
    const view: SaveLoadModel = { mode: deps.mode, rows: [], scrollTop: 0, scrollMax: 0, actionEnabled: false, description: '' };
    super(SAVE_LOAD_CONTRACT, view as unknown as Record<string, unknown>, {
      select: ([i]) => this.select(i ?? NO_SELECTION),
      activate: ([i]) => void this.activate(i ?? NO_SELECTION),
      hoverRow: ([i, on]) => this.#hover(i ?? NO_SELECTION, on === HOVER_ON),
      clearSelection: () => this.clearSelection(),
      scrollUp: () => this.scroll(-1),
      scrollDown: () => this.scroll(1),
      moveUp: () => this.move(-1),
      moveDown: () => this.move(1),
      escape: () => this.escape(),
      enter: () => void this.enter(),
      delete: () => void this.deleteSelected(),
      act: () => void this.act(),
      cancel: () => this.#deps.actions.leave(),
      describe: (_args, text) => {
        this.view.description = text ?? '';
      },
    });
    this.view = view;
    this.#deps = deps;
    this.setListings(deps.listings);
  }

  get selected(): number {
    return this.#selected;
  }

  get editing(): boolean {
    return this.#editing;
  }

  get entries(): readonly Entry[] {
    return this.#entries;
  }

  setListings(listings: readonly SaveListing[]): void {
    const labels = this.#deps.labels();
    const entries: Entry[] = listed(listings, this.#deps.mode).map((listing) => ({ listing, row: saveRow(listing, labels) }));
    this.#entries = this.#deps.mode === 'save' ? [{ listing: null, row: null }, ...entries] : entries;
    this.#selected = this.#entries.length > 0 ? 0 : NO_SELECTION;
    this.view.scrollTop = Math.min(this.view.scrollTop, this.#scrollMax());
    this.view.actionEnabled = this.#selected !== NO_SELECTION;
    this.#refresh();
  }

  #scrollMax(): number {
    return Math.max(0, this.#entries.length - NUM_SAVE_GAMES);
  }

  #isNew(index: number): boolean {
    return this.#deps.mode === 'save' && index === NEW_ROW;
  }

  #rowView(visible: number): RowView {
    const index = this.view.scrollTop + visible;
    const entry = this.#entries[index];
    if (!entry) return { ...EMPTY_ROW };
    const isNew = this.#isNew(index);
    const selected = index === this.#selected;
    const state: RowState = isNew ? 'newRow' : selected ? 'selected' : visible === this.#highlighted ? 'highlighted' : 'normal';
    const row = entry.row;
    const editing = this.#editing && selected && this.#deps.mode === 'save';
    return {
      shown: true,
      selected,
      state,
      newLabel: isNew && !this.#editing,
      fields: !isNew,
      showDescription: !isNew && !editing,
      editing,
      deadIsDead: row?.deadIsDead ?? false,
      date: row?.date ?? '',
      sector: row?.sector ?? '',
      mercs: row?.mercs ?? '',
      balance: row?.balance ?? '',
      description: row?.description ?? '',
      tooltip: this.#deps.mode === 'load' && row ? row.tooltip : '',
    };
  }

  #refresh(): void {
    this.view.scrollMax = this.#scrollMax();
    this.view.rows = Array.from({ length: NUM_SAVE_GAMES }, (_, i) => this.#rowView(i));
  }

  #startEditing(): void {
    if (this.#deps.mode !== 'save' || this.#selected === NO_SELECTION) return;
    this.#editing = true;
    this.view.description = '';
  }

  #stopEditing(): void {
    this.#editing = false;
  }

  select(visible: number): void {
    if (this.#busy) return;
    const index = this.#indexOf(visible);
    if (index !== this.#selected) {
      this.#selected = index;
      this.#stopEditing();
      this.view.actionEnabled = index !== NO_SELECTION;
      if (index !== NO_SELECTION && this.#isNew(index)) this.#startEditing();
    } else if (this.#isNew(index) && !this.#editing) this.#startEditing();
    this.#refresh();
  }

  #indexOf(visible: number): number {
    const index = this.view.scrollTop + visible;
    return visible >= 0 && index < this.#entries.length ? index : NO_SELECTION;
  }

  async activate(visible: number): Promise<void> {
    const index = this.#indexOf(visible);
    if (index === NO_SELECTION) {
      this.view.actionEnabled = false;
      return;
    }
    if (index === this.#selected && !this.#editing) await this.#saveOrLoadSelected();
  }

  #hover(visible: number, on: boolean): void {
    this.#highlighted = on ? visible : NO_SELECTION;
    this.#refresh();
  }

  clearSelection(): void {
    if (this.#busy) return;
    this.#selected = NO_SELECTION;
    this.#stopEditing();
    if (this.#deps.mode === 'load') this.view.actionEnabled = false;
    this.#refresh();
  }

  scroll(step: number): void {
    if (this.#editing) return;
    const next = Math.min(Math.max(0, this.view.scrollTop + step), this.#scrollMax());
    if (next === this.view.scrollTop) return;
    this.view.scrollTop = next;
    this.#refresh();
  }

  move(step: number): void {
    if (this.#busy) return;
    const next = step > 0 ? Math.min(this.#entries.length - 1, this.#selected + 1) : Math.max(0, this.#selected - 1);
    if (next === this.#selected) return;
    this.#selected = next;
    this.#stopEditing();
    this.view.actionEnabled = next !== NO_SELECTION;
    if (step > 0 && next >= this.view.scrollTop + NUM_SAVE_GAMES && this.view.scrollTop < this.#scrollMax()) this.view.scrollTop++;
    if (step < 0 && next < this.view.scrollTop) this.view.scrollTop--;
    this.#refresh();
  }

  escape(): void {
    if (this.#busy) return;
    if (this.#selected === NO_SELECTION) {
      this.#deps.actions.leave();
      return;
    }
    this.#selected = NO_SELECTION;
    this.#stopEditing();
    this.view.actionEnabled = false;
    this.#refresh();
  }

  async enter(): Promise<void> {
    if (this.#deps.mode === 'save' && this.#selected === NEW_ROW) {
      if (this.#editing) await this.#saveNew();
      else {
        this.#startEditing();
        this.#refresh();
      }
      return;
    }
    if (this.#selected !== NO_SELECTION) await this.#saveOrLoadSelected();
  }

  async act(): Promise<void> {
    if (this.#deps.mode === 'save' && this.#selected === NEW_ROW && this.#editing) await this.#saveNew();
    else await this.#saveOrLoadSelected();
  }

  async #exclusive(task: () => Promise<void>): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      await task();
    } finally {
      this.#busy = false;
    }
  }

  async #saveNew(): Promise<void> {
    const description = this.view.description;
    await this.#exclusive(async () => {
      if (this.#deps.namesSaveOnly) {
        this.#deps.actions.nameSave(null, description);
        return;
      }
      const session = this.#deps.session;
      if (!session) return;
      const outcome = await this.#deps.saves.saveNew(session, description);
      if (outcome.ok) this.#deps.actions.saved(outcome.name);
      else if (!outcome.cancelled) await this.#deps.boxes.alert(outcome.text);
    });
  }

  async #saveOrLoadSelected(): Promise<void> {
    const index = this.#selected;
    if (index === NO_SELECTION || this.#isNew(index)) return;
    const entry = this.#entries[index];
    if (!entry?.listing || !entry.row) return;
    const { listing, row } = entry;
    await this.#exclusive(async () => {
      if (this.#deps.mode === 'load') {
        if (!listing.compatible) {
          await this.#deps.boxes.alert(this.#deps.labels().format('loadError', listing.problems.join(', ')));
          return;
        }
        if (await this.#deps.saves.confirmWarnings(listing)) this.#deps.actions.load(listing);
        return;
      }
      if (this.#deps.namesSaveOnly) {
        if (await this.#deps.boxes.confirm(this.#deps.labels().format('confirmOverwrite', row.description || row.name)))
          this.#deps.actions.nameSave(row.name, row.description);
        return;
      }
      const session = this.#deps.session;
      if (!session) return;
      const outcome = await this.#deps.saves.saveOver(session, row);
      if (outcome.ok) this.#deps.actions.saved(outcome.name);
      else if (!outcome.cancelled) await this.#deps.boxes.alert(outcome.text);
    });
  }

  async deleteSelected(): Promise<void> {
    const index = this.#selected;
    const entry = this.#entries[index];
    if (index === NO_SELECTION || !entry?.row || this.#isNew(index)) return;
    const row = entry.row;
    await this.#exclusive(async () => {
      const outcome = await this.#deps.saves.delete(row);
      if (!outcome.ok) {
        if (!outcome.cancelled) await this.#deps.boxes.alert(outcome.text);
        return;
      }
      this.#entries = this.#entries.filter((e) => e !== entry);
      this.#selected = NO_SELECTION;
      this.view.scrollTop = Math.min(this.view.scrollTop, this.#scrollMax());
      this.#refresh();
    });
  }
}

type JsonObject = Readonly<Record<string, unknown>>;

function color(value: unknown): number {
  return Array.isArray(value) ? rgb(Number(value[0] ?? 0), Number(value[1] ?? 0), Number(value[2] ?? 0)) : rgb(0, 0, 0);
}

function bevel(list: DrawList, x: number, y: number, width: number, height: number, params: JsonObject): void {
  list.fill(x, y, x + width, y + height, color(params.face));
  list.line(x, y, x + width - 1, y, color(params.light));
  list.line(x, y, x, y + height - 1, color(params.light));
  list.line(x, y + height - 1, x + width - 1, y + height - 1, color(params.dark));
  list.line(x + width - 1, y, x + width - 1, y + height - 1, color(params.dark));
}

function arrow(list: DrawList, rect: Area, height: number, up: boolean, ink: number): void {
  const middle = rect.x + idiv(rect.width, 2);
  const rows = idiv(height, 3);
  const top = rect.y + idiv(height - rows, 2);
  for (let r = 0; r < rows; r++) {
    const y = up ? top + r : top + rows - 1 - r;
    list.line(middle - r, y, middle + r, y, ink);
  }
}

export function drawScrollBar(list: DrawList, rect: Area, params: JsonObject, view: LayoutView): void {
  const num = (key: string) => view.number(params[key] as NumberExpr | undefined, {});
  const buttonHeight = num('buttonHeight');
  const innerTop = rect.y + num('innerTop');
  const innerHeight = num('innerHeight');
  const indicatorHeight = num('indicatorHeight');
  const top = Number(view.get(String(params.top), {}) ?? 0);
  const max = Math.max(1, Number(view.get(String(params.max), {}) ?? 0));
  list.fill(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height, color(params.track));
  bevel(list, rect.x, rect.y, rect.width, buttonHeight, params);
  bevel(list, rect.x, rect.y + rect.height - buttonHeight, rect.width, buttonHeight, params);
  arrow(list, { x: rect.x, y: rect.y, width: rect.width, height: buttonHeight }, buttonHeight, true, color(params.arrow));
  arrow(
    list,
    { x: rect.x, y: rect.y + rect.height - buttonHeight, width: rect.width, height: buttonHeight },
    buttonHeight,
    false,
    color(params.arrow),
  );
  const travel = innerHeight - indicatorHeight - 2;
  const position = Math.min(Math.max(Math.round((travel * top) / max), 0), travel);
  bevel(list, rect.x + 2, innerTop + position + 1, rect.width - 4, indicatorHeight, params);
}

export interface SaveLoadScreenOptions {
  readonly pausesGame: boolean;
}

export function saveLoadScreen(env: FrontEndEnvironment, controller: SaveLoadController, options: SaveLoadScreenOptions): FrontEndScreen {
  return new FrontEndScreen(env, {
    id: SAVE_LOAD_SCREEN,
    layout: FrontEndLayout.SAVE_LOAD,
    controller,
    soundScreen: UiScreenKind.SAVE_LOAD,
    custom: { scrollBar: drawScrollBar },
    onEnter: () => {
      if (options.pausesGame) env.runtime.pauseGame(true);
    },
    onExit: () => {
      if (options.pausesGame) env.runtime.pauseGame(false);
    },
  });
}

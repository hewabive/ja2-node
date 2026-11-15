// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map_Inventory.cc CreateDestroyMapInventoryPoolButtons (the stash of the
// @src selected sector, page one), BuildStashForSelectedSector, RenderItemInPoolSlot (the item in g_sector_inv_item_box
// @src with the compatible outline, the status bar in g_sector_inv_bar_box, the hatch over an unreachable item or while the
// @src selected merc is not in the sector, the short name reduced to g_sector_inv_name_box in MAP_IVEN_FONT FONT_WHITE),
// @src UpdateHelpTextForInvnentoryStashSlots (GetHelpTextForItem), MapInvenPoolSlotsPrimary (STR_LATE_38 for an
// @src unreachable item, pMapInventoryErrorString[0] without a merc, [1] or [4] with his name when he is elsewhere, [2] or
// @src [3] during a battle; pick up, put down), MapInvenPoolSlotsSecondary (closes when the cursor is empty),
// @src MapInvenPoolScreenMaskCallbackSecondary, InventoryNextPage, InventoryPrevPage, DisplayPagesForMapInventoryPool,
// @src DrawNumberOfInventoryPoolItems, DisplayCurrentSector (pMapVertIndex, pMapHortIndex, pMapDepthIndex),
// @src DrawTextOnMapInventoryBackground (pMapInventoryStrings 0 and 1 wrapped right-justified at 268 and 369, 342 and
// @src centred on their height, MAP_IVEN_FONT FONT_BEIGE), HandleButtonStatesWhileMapInventoryActive;
// @src MapInvenPoolSlotsMove (the slot under the pointer, iCurrentlyHighLightedItem, 2026-11-03);
// @src the pool built and sorted as it opens and kept while it is open: a take empties its slot, a placement lands in the
// @src clicked slot, a pool item moves between slots (MapInvenPoolSlotsPrimary with an item in the cursor), the trash
// @src can takes it (MapScreen.cc TrashCanBtnCallback), and closing writes the pool back in its order
// @src (SaveSeenAndUnseenItems, 2026-11-14); what a merc's item swaps out of a pool slot stays in the cursor
// @src (MapInvenPoolSlotsPrimary's SetMapCursorItem, 2026-11-14).

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { InventoryQuery, StashEntryView } from '../../../protocol/map-inventory.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { StrategicMercView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import { hCenterVCenterAlign } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { printf } from '../../text/printf.ts';
import { displayWrappedString, reduceStringLength, TextFlag } from '../../text/wrap.ts';
import { MessageBoxReturn } from '../../widgets/message-box.ts';
import { drawItemStatusBar } from '../tactical/bars.ts';
import { COMPATIBLE_OUTLINE, helpTextForItem } from '../tactical/inventory.ts';
import type { ItemCursor } from '../tactical/item-cursor.ts';
import { drawInventoryItem, itemStatusValue, type TileDrawContext } from '../tactical/item-tile.ts';
import type { MapEnvironment } from './environment.ts';
import { parseSectorLabel } from './facts.ts';
import {
  arrangeCommand,
  discardFromStashCommand,
  entryView,
  layoutPages,
  leftoverIndex,
  openedLayout,
  POOL_SLOTS_PER_PAGE,
  type PoolLayout,
  type PoolLocation,
  type PoolPlacement,
  PoolRefusal,
  poolClickRefusal,
  poolEntry,
  poolObjects,
  poolSlotIndex,
  poolSlotOrigin,
  refreshedLayout,
  type StashCursor,
  shownEntry,
  stashCursor,
  stashPlacements,
  toStashCommand,
  withinStashCommand,
} from './item-pool.ts';
import { at, type LayoutParams } from './layout-params.ts';
import type { MapInventoryModel, SlotTooltip } from './map-inventory-controller.ts';

const LATE = 'gzLateLocalizedString';
const STR_LATE_38 = 37;
const ERRORS = 'pMapInventoryErrorString';
const NO_MERC = 0;
const ELSEWHERE_TAKE = 1;
const BATTLE_TAKE = 2;
const BATTLE_PUT = 3;
const ELSEWHERE_PUT = 4;
const LABELS = 'pMapInventoryStrings';
const VERT_INDEX = 'pMapVertIndex';
const HORT_INDEX = 'pMapHortIndex';
const DEPTH_INDEX = 'pMapDepthIndex';
const LABEL_LINE_GAP = 1;
const TRASH_TEXT = 'pTrashItemText';
const TRASH_ORDINARY = 0;
const TRASH_MISSION = 1;
const NO_SLOT = -1;

export interface SectorInventoryHost {
  readonly env: MapEnvironment;
  readonly origin: () => { readonly x: number; readonly y: number };
  readonly location: () => PoolLocation;
  readonly infoMerc: () => StrategicMercView | null;
  readonly mercCursor: () => ItemCursor | null;
  readonly mercPlaced: (data: unknown) => void;
  readonly box: (text: string) => Promise<number>;
  readonly confirm: (text: string) => Promise<number>;
  readonly shift: () => boolean;
}

export class SectorInventory {
  readonly #host: SectorInventoryHost;
  #open = false;
  #location: PoolLocation = { sector: '', z: 0 };
  #query: InventoryQuery | null = null;
  #entries: ReadonlyMap<number, StashEntryView> = new Map();
  #layout: PoolLayout | null = null;
  #placements: readonly PoolPlacement[] = [];
  #page = 0;
  #cursor: StashCursor | null = null;
  #asked = 0;
  #busy = false;
  #hovered: { readonly slot: number; readonly since: number } | null = null;
  #outlined: ReadonlySet<number> = new Set();

  constructor(host: SectorInventoryHost) {
    this.#host = host;
  }

  get open(): boolean {
    return this.#open;
  }

  get shown(): boolean {
    return this.#open && this.#layout !== null;
  }

  get cursor(): StashCursor | null {
    return this.#cursor;
  }

  get page(): number {
    return this.#page;
  }

  get location(): PoolLocation {
    return this.#location;
  }

  get stash(): readonly StashEntryView[] {
    return this.#query?.stash ?? [];
  }

  get layout(): PoolLayout {
    return this.#layout ?? [];
  }

  get pages(): number {
    return layoutPages(Math.max(1, this.layout.length));
  }

  show(): void {
    this.#open = true;
    this.#page = 0;
    this.#cursor = null;
    this.#location = this.#host.location();
    this.#query = null;
    this.#entries = new Map();
    this.#layout = null;
    this.#placements = [];
    void this.refresh();
  }

  hide(): void {
    if (this.#open && this.#layout) void this.#host.env.client.command(arrangeCommand(this.#layout, this.#location));
    this.#open = false;
    this.#cursor = null;
    this.#query = null;
    this.#entries = new Map();
    this.#layout = null;
    this.#placements = [];
    this.#hovered = null;
    this.#outlined = new Set();
  }

  slotHover(slot: number, on: boolean, now: number): void {
    if (on) this.#hovered = { slot, since: now };
    else if (this.#hovered?.slot === slot) this.#hovered = null;
  }

  #entryAt(slot: number): StashEntryView | null {
    return poolEntry(this.layout, this.#entries, this.#page, slot);
  }

  hoveredEntry(): StashEntryView | null {
    const hovered = this.#hovered;
    return this.shown && hovered ? this.#entryAt(hovered.slot) : null;
  }

  hoveredSince(): number | null {
    return this.shown ? (this.#hovered?.since ?? null) : null;
  }

  pageEntries(): readonly (StashEntryView | null)[] {
    return Array.from({ length: POOL_SLOTS_PER_PAGE }, (_, slot) => this.#entryAt(slot));
  }

  outline(slots: ReadonlySet<number>): void {
    this.#outlined = slots;
  }

  clearCursor(): void {
    this.#cursor = null;
  }

  async takenOut(data: unknown): Promise<void> {
    const leftover = leftoverIndex(data);
    this.#placements = stashPlacements(data, NO_SLOT, this.#cursorSlot());
    this.#busy = true;
    try {
      await this.refresh();
      this.#cursor = this.#cursorOn(leftover);
    } finally {
      this.#busy = false;
    }
  }

  async refresh(): Promise<void> {
    if (!this.#open) return;
    const asked = ++this.#asked;
    const location = this.#location;
    const answer = await this.#host.env.client.query({
      type: 'inventory',
      sector: location.sector,
      ...(location.z !== 0 ? { z: location.z } : {}),
    });
    if (asked !== this.#asked || !this.#open) return;
    this.#answered(answer.ok ? (answer.data as InventoryQuery) : null);
  }

  #answered(query: InventoryQuery | null): void {
    const stash = query?.stash ?? [];
    this.#query = query;
    this.#entries = new Map(stash.map((e) => [e.index, e]));
    this.#layout = this.#layout ? refreshedLayout(this.#layout, stash, this.#placements) : openedLayout(stash);
    this.#placements = [];
    this.#page = Math.min(this.#page, this.pages - 1);
    const held = this.#cursor;
    if (held && this.#entries.get(held.index)?.item !== held.item) this.#cursor = null;
  }

  #cursorSlot(): number {
    const held = this.#cursor;
    return held ? this.layout.indexOf(held.index) : NO_SLOT;
  }

  #cursorOn(index: number | null): StashCursor | null {
    const entry = index === null ? undefined : this.#entries.get(index);
    return entry ? stashCursor(entry, true, this.#location) : null;
  }

  nextPage(): void {
    if (this.#page < this.pages - 1) this.#page++;
  }

  prevPage(): void {
    if (this.#page > 0) this.#page--;
  }

  #mercInSector(): boolean | null {
    const m = this.#host.infoMerc();
    if (!m) return null;
    const at = parseSectorLabel(m.sector);
    const here = parseSectorLabel(this.#location.sector);
    return !m.betweenSectors && at !== null && here !== null && at.x === here.x && at.y === here.y && at.z === this.#location.z;
  }

  #refusalText(refusal: PoolRefusal, holding: boolean): string {
    const text = this.#host.env.text;
    const name = this.#host.infoMerc()?.name ?? '';
    switch (refusal) {
      case PoolRefusal.UNREACHABLE:
        return text.string(LATE, STR_LATE_38) ?? '';
      case PoolRefusal.NO_MERC:
        return text.string(ERRORS, NO_MERC) ?? '';
      case PoolRefusal.ELSEWHERE:
        return printf(text.string(ERRORS, holding ? ELSEWHERE_PUT : ELSEWHERE_TAKE) ?? '', [name]);
      case PoolRefusal.BATTLE:
        return text.string(ERRORS, holding ? BATTLE_PUT : BATTLE_TAKE) ?? '';
    }
  }

  async slotPrimary(slot: number): Promise<void> {
    if (!this.shown || this.#busy) return;
    const entry = this.#entryAt(slot);
    const mercCursor = this.#host.mercCursor();
    const holding = mercCursor !== null || this.#cursor !== null;
    if (!holding && !entry) return;
    const refusal = poolClickRefusal({
      entry,
      holding,
      mercInSector: this.#mercInSector(),
      usable: this.#query?.usable === true,
    });
    if (refusal) {
      void this.#host.box(this.#refusalText(refusal, holding));
      return;
    }
    if (!holding && entry) {
      this.#cursor = stashCursor(entry, this.#host.shift(), this.#location);
      return;
    }
    const target = poolSlotIndex(this.#page, slot);
    const held = this.#cursor;
    const merc = this.#host.infoMerc();
    if (held && merc) {
      const source = this.#cursorSlot();
      await this.#send(withinStashCommand(held, merc.id, entry), target, source, (data) => {
        this.#cursor = this.#cursorOn(leftoverIndex(data));
      });
      return;
    }
    const command = mercCursor ? toStashCommand(mercCursor, entry, this.#location) : null;
    if (command) await this.#send(command, target, NO_SLOT, (data) => this.#host.mercPlaced(data));
  }

  slotSecondary(): boolean {
    if (this.#host.mercCursor() !== null || this.#cursor !== null) return false;
    this.hide();
    return true;
  }

  async trash(): Promise<void> {
    const held = this.#cursor;
    const merc = this.#host.infoMerc();
    if (!held || !merc || this.#busy) return;
    const mission = (this.#entries.get(held.index)?.mission ?? 0) !== 0;
    const text = this.#host.env.text.string(TRASH_TEXT, mission ? TRASH_MISSION : TRASH_ORDINARY) ?? '';
    if ((await this.#host.confirm(text)) !== MessageBoxReturn.YES || this.#cursor !== held) return;
    await this.#send(discardFromStashCommand(held, merc.id), NO_SLOT, NO_SLOT, () => {
      this.#cursor = null;
    });
  }

  async #send(command: CommandEnvelope, target: number, source: number, placed: (data: unknown) => void): Promise<void> {
    this.#busy = true;
    try {
      const reply = await this.#host.env.client.command(command);
      if (reply.ok) this.#placements = stashPlacements(reply.data, target, source);
      await this.refresh();
      if (reply.ok) placed(reply.data);
    } finally {
      this.#busy = false;
    }
  }

  locationText(): string {
    const text = this.#host.env.text;
    const s = parseSectorLabel(this.#location.sector);
    if (!s) return '';
    return `${text.string(VERT_INDEX, s.y) ?? ''}${text.string(HORT_INDEX, s.x) ?? ''}${text.string(DEPTH_INDEX, this.#location.z) ?? ''}`;
  }

  syncModel(model: MapInventoryModel): void {
    model.poolOpen = this.shown;
    model.location = this.shown ? this.locationText() : '';
    model.itemCount = String(poolObjects(this.stash));
    model.page = `${this.#page + 1} / ${this.pages}`;
    model.poolPrevEnabled = this.#page !== 0;
    model.poolNextEnabled = this.#page !== this.pages - 1;
    model.poolDoneEnabled = this.#host.mercCursor() === null && this.#cursor === null;
    model.poolSlots = this.tooltips();
  }

  tooltips(): SlotTooltip[] {
    const media = this.#host.env.media;
    const sources = {
      item: (name: string) => media.item(name),
      text: this.#host.env.text,
      gunNut: media.gunNut,
      nickname: (profile: number) => media.profile(profile)?.nickname ?? null,
    };
    return Array.from({ length: POOL_SLOTS_PER_PAGE }, (_, slot) => {
      const entry = this.#entryAt(slot);
      return { tooltip: entry ? helpTextForItem(entryView(entry), sources) : '' };
    });
  }

  render(list: DrawList, ctx: TileDrawContext, p: LayoutParams): void {
    if (!this.shown) return;
    this.#renderLabels(list, p);
    const o = this.#host.origin();
    const [slotX, slotY, slotW, slotH] = p.numbers('slot');
    const [itemX, itemY, itemW, itemH] = p.numbers('item');
    const [barX, barY, , barH] = p.numbers('bar');
    const [nameX, nameY, nameW, nameH] = p.numbers('name');
    const nameFont = p.font('nameFont');
    const mercHere = this.#mercInSector() === true;
    for (let slot = 0; slot < POOL_SLOTS_PER_PAGE; slot++) {
      const stored = this.#entryAt(slot);
      const entry = stored ? shownEntry(stored, this.#cursor) : null;
      if (!entry) continue;
      const cell = poolSlotOrigin(slot);
      const dx = o.x + (slotX ?? 0) + (slotW ?? 0) * cell.column;
      const dy = o.y + (slotY ?? 0) + (slotH ?? 0) * cell.row;
      const view = entryView(entry);
      const box = { x: dx + (itemX ?? 0), y: dy + (itemY ?? 0), width: itemW ?? 0, height: itemH ?? 0 };
      drawInventoryItem(ctx, view, box, { outline: this.#outlined.has(slot) ? COMPATIBLE_OUTLINE : null });
      drawItemStatusBar(list, itemStatusValue(view, ctx.items, 0), dx + (barX ?? 0), dy + (barY ?? 0) + (barH ?? 0) - 1, barH ?? 0);
      if (!entry.reachable || !mercHere) list.hatch(box.x, box.y, box.x + box.width - 1, box.y + box.height - 1);
      const name = reduceStringLength(ctx.items.item(entry.item)?.shortName ?? '', nameW ?? 0, nameFont);
      const point = hCenterVCenterAlign(dx + (nameX ?? 0), dy + (nameY ?? 0), nameW ?? 0, nameH ?? 0, name, nameFont);
      mprint(list, nameFont, point.x, point.y, name, fontColors(FontColor.WHITE, DEFAULT_SHADOW));
    }
  }

  #renderLabels(list: DrawList, p: LayoutParams): void {
    const o = this.#host.origin();
    const font = p.font('labelFont');
    const colours = fontColors(FontColor.BEIGE, DEFAULT_SHADOW, FontColor.BLACK);
    const labels = p.raw('labels') as readonly (readonly number[])[];
    labels.forEach((label, i) => {
      const text = this.#host.env.text.string(LABELS, i) ?? '';
      const x = o.x + at(label, 0);
      const y = o.y + at(label, 1);
      const width = at(label, 2);
      const height = displayWrappedString(
        list,
        x,
        y,
        width,
        LABEL_LINE_GAP,
        font,
        colours,
        text,
        TextFlag.RIGHT_JUSTIFIED | TextFlag.DONT_DISPLAY_TEXT,
      );
      displayWrappedString(list, x, y - idiv(height, 2), width, LABEL_LINE_GAP, font, colours, text, TextFlag.RIGHT_JUSTIFIED);
    });
  }
}

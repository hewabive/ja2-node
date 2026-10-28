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
// @src centred on their height, MAP_IVEN_FONT FONT_BEIGE), HandleButtonStatesWhileMapInventoryActive.

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
import { drawItemStatusBar } from '../tactical/bars.ts';
import { helpTextForItem } from '../tactical/inventory.ts';
import type { ItemCursor } from '../tactical/item-cursor.ts';
import { drawInventoryItem, itemStatusValue, type TileDrawContext } from '../tactical/item-tile.ts';
import type { MapEnvironment } from './environment.ts';
import { parseSectorLabel } from './facts.ts';
import {
  entryView,
  POOL_SLOTS_PER_PAGE,
  type PoolLocation,
  PoolRefusal,
  poolClickRefusal,
  poolEntry,
  poolObjects,
  poolPages,
  poolSlotOrigin,
  type StashCursor,
  shownEntry,
  stashCursor,
  toStashCommand,
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

export interface SectorInventoryHost {
  readonly env: MapEnvironment;
  readonly origin: () => { readonly x: number; readonly y: number };
  readonly location: () => PoolLocation;
  readonly infoMerc: () => StrategicMercView | null;
  readonly mercCursor: () => ItemCursor | null;
  readonly mercPlaced: () => void;
  readonly box: (text: string) => Promise<number>;
  readonly shift: () => boolean;
}

export class SectorInventory {
  readonly #host: SectorInventoryHost;
  #open = false;
  #location: PoolLocation = { sector: '', z: 0 };
  #query: InventoryQuery | null = null;
  #page = 0;
  #cursor: StashCursor | null = null;
  #asked = 0;
  #busy = false;

  constructor(host: SectorInventoryHost) {
    this.#host = host;
  }

  get open(): boolean {
    return this.#open;
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

  get pages(): number {
    return poolPages(this.stash.length);
  }

  show(): void {
    this.#open = true;
    this.#page = 0;
    this.#cursor = null;
    this.#location = this.#host.location();
    this.#query = null;
    void this.refresh();
  }

  hide(): void {
    this.#open = false;
    this.#cursor = null;
    this.#query = null;
  }

  clearCursor(): void {
    this.#cursor = null;
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
    this.#query = answer.ok ? (answer.data as InventoryQuery) : null;
    this.#page = Math.min(this.#page, this.pages - 1);
    const held = this.#cursor;
    if (held && !this.stash.some((e) => e.index === held.index && e.item === held.item)) this.#cursor = null;
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
    if (!this.#open || this.#busy) return;
    const entry = poolEntry(this.stash, this.#page, slot);
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
    if (this.#cursor) {
      this.#cursor = null;
      return;
    }
    const command = mercCursor ? toStashCommand(mercCursor, entry, this.#location) : null;
    if (command) await this.#send(command, () => this.#host.mercPlaced());
  }

  slotSecondary(): boolean {
    if (this.#host.mercCursor() !== null || this.#cursor !== null) return false;
    this.hide();
    return true;
  }

  async #send(command: CommandEnvelope, placed: () => void): Promise<void> {
    this.#busy = true;
    try {
      const reply = await this.#host.env.client.command(command);
      if (reply.ok) placed();
    } finally {
      this.#busy = false;
    }
    await this.refresh();
  }

  locationText(): string {
    const text = this.#host.env.text;
    const s = parseSectorLabel(this.#location.sector);
    if (!s) return '';
    return `${text.string(VERT_INDEX, s.y) ?? ''}${text.string(HORT_INDEX, s.x) ?? ''}${text.string(DEPTH_INDEX, this.#location.z) ?? ''}`;
  }

  syncModel(model: MapInventoryModel): void {
    model.poolOpen = this.#open;
    model.location = this.#open ? this.locationText() : '';
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
      const entry = poolEntry(this.stash, this.#page, slot);
      return { tooltip: entry ? helpTextForItem(entryView(entry), sources) : '' };
    });
  }

  render(list: DrawList, ctx: TileDrawContext, p: LayoutParams): void {
    if (!this.#open) return;
    this.#renderLabels(list, p);
    const o = this.#host.origin();
    const [slotX, slotY, slotW, slotH] = p.numbers('slot');
    const [itemX, itemY, itemW, itemH] = p.numbers('item');
    const [barX, barY, , barH] = p.numbers('bar');
    const [nameX, nameY, nameW, nameH] = p.numbers('name');
    const nameFont = p.font('nameFont');
    const mercHere = this.#mercInSector() === true;
    for (let slot = 0; slot < POOL_SLOTS_PER_PAGE; slot++) {
      const stored = poolEntry(this.stash, this.#page, slot);
      const entry = stored ? shownEntry(stored, this.#cursor) : null;
      if (!entry) continue;
      const cell = poolSlotOrigin(slot);
      const dx = o.x + (slotX ?? 0) + (slotW ?? 0) * cell.column;
      const dy = o.y + (slotY ?? 0) + (slotH ?? 0) * cell.row;
      const view = entryView(entry);
      const box = { x: dx + (itemX ?? 0), y: dy + (itemY ?? 0), width: itemW ?? 0, height: itemH ?? 0 };
      drawInventoryItem(ctx, view, box, { outline: null });
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

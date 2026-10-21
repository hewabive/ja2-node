// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc INVRenderINVPanelItem (the covered second hand, the item, the hatch on
// @src invalid slots except the second hand and while the panel is disabled, the status bar at x - INV_BAR_DX,
// @src y + INV_BAR_DY), HandleRenderInvSlots (nothing while a popup or the description box is up, the gold key when a key
// @src is on the ring), HandleNewlyAddedItems and DegradeNewlyAddedItems (the 20-step colour cycle every 100 ms,
// @src NEW_ITEM_CYCLES cycles of NEW_ITEM_CYCLE_COUNT steps, a click stops it), us16BPPItemCyclePlacedItemColors,
// @src HandleCompatibleAmmoUI (white outlines after 100 ms over a slot), GetHelpTextForItem, RenderInvBodyPanel;
// @src src/game/Tactical/Interface_Panels.cc SMInvClickCallbackPrimary, SMInvClickCallbackSecondary (the stack popup for a
// @src stack, else the description box), SMInvMoveCallback, SMInvMoveCamoCallback, SMInvClickCamoCallback,
// @src MergeMessageBoxCallBack, ReevaluateItemHatches. See docs/28 §5.3.

import { idiv } from '../../../core/int.ts';
import type { Placements } from '../../../protocol/hints.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { InventoryItemView, SoldierView } from '../../../protocol/view.ts';
import type { DrawList, RgbColor } from '../../draw-list.ts';
import { rgb } from '../../draw-list.ts';
import { sprintMoney } from '../../text/money.ts';
import { printf } from '../../text/printf.ts';
import { drawItemStatusBar } from './bars.ts';
import type { TacticalEnvironment } from './environment.ts';
import { CONSCIOUSNESS } from './faces.ts';
import {
  applyCommand,
  type CursorSource,
  cancelCommand,
  cursorFromSlot,
  hidesSlot,
  type ItemCursor,
  moneyTaken,
  placeCommand,
  REFUSAL_MERGE_PROMPT,
  REFUSAL_USE_ATTACH,
  refusalOf,
  shownCount,
  slotItem,
} from './item-cursor.ts';
import { drawInventoryItem, itemStatusValue, type TileBox, type TileDrawContext } from './item-tile.ts';

export const NUM_INV_SLOTS = 19;
export const HAND_SLOT = 5;
export const SECOND_HAND_SLOT = 6;
const ARMOUR_AND_HAND_SLOTS: ReadonlySet<number> = new Set([0, 1, 2, HAND_SLOT, SECOND_HAND_SLOT]);
const INV_BAR_DX = 5;
const INV_BAR_DY = 21;
const ITEM_BAR_HEIGHT = 20;
const COMPATIBLE_DELAY_MS = 100;
const NEW_ITEM_STEP_MS = 100;
const NEW_ITEM_CYCLES = 4;
const NEW_ITEM_CYCLE_COUNT = 19;
const NEW_ITEM_COLOURS = 20;
const NEW_ITEM_HALF = 10;
const NEW_ITEM_BRIGHTNESS_STEP = 25;
export const COMPATIBLE_OUTLINE = rgb(255, 255, 255);
const STR_MERGE_ITEMS = 36;
const MONEY = 'MONEY';
const MONEY_CLASS = 'MONEY';
const GUN_CLASS = 'GUN';
const TWO_HANDED = 'TWO_HANDED';
const MSG_END_ATTACHMENT_LIST = 41;
const IMPRINT_UNKNOWN = 201;
const MISC_SECTOR_STRINGS = 'pwMiscSectorStrings';
const IMPRINT_UNKNOWN_STRING = 3;

export function newItemColour(step: number): RgbColor {
  const level = (step < NEW_ITEM_HALF ? step + 1 : NEW_ITEM_COLOURS - step) * NEW_ITEM_BRIGHTNESS_STEP;
  return rgb(level, level, level);
}

interface NewItemGlow {
  count: number;
  cycle: number;
}

export interface SlotRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface InventoryHooks {
  readonly env: TacticalEnvironment;
  smSoldier(): SoldierView | null;
  select(id: number): void;
  openDescription(soldier: number, slot: number, index: number): void;
  openStackPopup(soldier: number, slot: number): void;
  descriptionOpen(): boolean;
  popupOpen(): boolean;
  disabledForItems(): boolean;
  inCombat(): boolean;
  extraHatch?(soldier: number, slot: number): boolean;
}

export class InventoryPanel {
  readonly #hooks: InventoryHooks;
  #cursor: ItemCursor | null = null;
  #pending = false;
  #hovered: { slot: number; since: number } | null = null;
  #highlight: { soldier: number; slots: ReadonlySet<number>; applyOnMerc: boolean } | null = null;
  #bodyHover = false;
  #bodyHighlights: ReadonlySet<number> = new Set();
  readonly #glows = new Map<number, Map<number, NewItemGlow>>();
  #lastGlowStep = 0;
  #lastCommand: CommandEnvelope | null = null;
  #lastResult: { ok: boolean; reason?: string; refusal?: string | null } | null = null;

  constructor(hooks: InventoryHooks) {
    this.#hooks = hooks;
  }

  get cursor(): ItemCursor | null {
    return this.#cursor;
  }

  get lastCommand(): CommandEnvelope | null {
    return this.#lastCommand;
  }

  get lastResult(): { ok: boolean; reason?: string; refusal?: string | null } | null {
    return this.#lastResult;
  }

  get busy(): boolean {
    return this.#pending;
  }

  setCursor(cursor: ItemCursor | null): void {
    this.#cursor = cursor;
    this.#highlight = null;
  }

  #env(): TacticalEnvironment {
    return this.#hooks.env;
  }

  async send(cmd: CommandEnvelope): Promise<{ ok: boolean; reason?: string; data?: unknown }> {
    this.#pending = true;
    this.#lastCommand = cmd;
    try {
      const reply = await this.#env().client.command(cmd);
      this.#lastResult = { ok: reply.ok, ...(reply.reason ? { reason: reply.reason } : {}), refusal: refusalOf(reply.data) };
      return reply;
    } finally {
      this.#pending = false;
    }
  }

  placements(): Placements | null {
    const s = this.#cursor?.source;
    if (s?.kind !== 'slot') return null;
    const reply = this.#env().client.hint({
      type: 'placements',
      soldier: s.soldier,
      slot: s.slot,
      ...(s.count === 'all' ? {} : { count: s.count }),
      ...(s.index !== 0 ? { index: s.index } : {}),
    });
    return reply.state === 'ready' && reply.answer.ok ? (reply.answer.data as Placements) : null;
  }

  hatched(soldier: SoldierView, slot: number): boolean {
    if (this.#hooks.extraHatch?.(soldier.id, slot)) return true;
    const s = this.#cursor?.source;
    if (s?.kind !== 'slot' || this.#hooks.disabledForItems()) return false;
    if (s.soldier !== soldier.id) return false;
    const placement = this.placements()?.slots[slot];
    return placement?.hatched === true;
  }

  compatibleMercs(): ReadonlySet<number> {
    return new Set(this.placements()?.compatibleMercs ?? []);
  }

  applyHighlight(): boolean {
    if (this.#cursor) return this.placements()?.applyOnMerc === true;
    return this.#highlight?.applyOnMerc === true;
  }

  outlineOf(soldier: SoldierView, slot: number): RgbColor | null {
    const glow = this.#glows.get(soldier.id)?.get(slot);
    if (glow && glow.count > 0) return newItemColour(glow.cycle % NEW_ITEM_COLOURS);
    if (this.#cursor) {
      const placement = this.placements();
      if (placement && this.#cursor.source.soldier === soldier.id && placement.slots[slot]?.highlight) return COMPATIBLE_OUTLINE;
      return null;
    }
    if (this.#highlight?.soldier === soldier.id && this.#highlight.slots.has(slot)) return COMPATIBLE_OUTLINE;
    if (this.#bodyHover && this.#bodyHighlights.has(slot)) return COMPATIBLE_OUTLINE;
    return null;
  }

  markNewItems(soldier: number, slots: readonly number[]): void {
    const glows = this.#glows.get(soldier) ?? new Map<number, NewItemGlow>();
    for (const slot of slots) glows.set(slot, { count: NEW_ITEM_CYCLES - 1, cycle: NEW_ITEM_CYCLE_COUNT });
    this.#glows.set(soldier, glows);
  }

  stopGlow(soldier: number, slot: number): void {
    this.#glows.get(soldier)?.delete(slot);
  }

  degradeGlows(now: number): void {
    if (now - this.#lastGlowStep <= NEW_ITEM_STEP_MS) return;
    this.#lastGlowStep = now;
    for (const glows of this.#glows.values()) {
      for (const [slot, glow] of glows) {
        glow.cycle--;
        if (glow.cycle !== 0) continue;
        glow.count--;
        if (glow.count <= 0) glows.delete(slot);
        else glow.cycle = NEW_ITEM_CYCLE_COUNT;
      }
    }
  }

  update(now: number): void {
    this.degradeGlows(now);
    const hovered = this.#hovered;
    const sm = this.#hooks.smSoldier();
    if (!hovered || this.#cursor || !sm || now - hovered.since <= COMPATIBLE_DELAY_MS) return;
    const reply = this.#env().client.hint({ type: 'placements', soldier: sm.id, slot: hovered.slot });
    if (reply.state !== 'ready' || !reply.answer.ok) return;
    const data = reply.answer.data as Placements;
    const slots = new Set(data.slots.filter((p) => p.highlight).map((p) => p.slot));
    this.#highlight = { soldier: sm.id, slots, applyOnMerc: data.applyOnMerc };
  }

  slotHover(slot: number, on: boolean, now: number): void {
    const sm = this.#hooks.smSoldier();
    if (!sm || !slotItem(sm, slot)) return;
    if (on) {
      if (!this.#cursor) this.#hovered = { slot, since: now };
      return;
    }
    if (!this.#cursor) {
      this.#hovered = null;
      this.#highlight = null;
    }
  }

  bodyHover(on: boolean): void {
    this.#bodyHover = on;
    if (!on) {
      this.#bodyHighlights = new Set();
      return;
    }
    const sm = this.#hooks.smSoldier();
    if (!sm || this.#cursor) return;
    const found = new Set<number>();
    const client = this.#env().client;
    void Promise.all(
      (sm.inventory ?? []).map(async (item) => {
        const answer = await client.hintNow({ type: 'placements', soldier: sm.id, slot: item.slot });
        if (answer.ok && (answer.data as Placements).applyOnMerc) found.add(item.slot);
      }),
    ).then(() => {
      if (this.#bodyHover) this.#bodyHighlights = found;
    });
  }

  slotPrimary(slot: number, shift: boolean): void {
    if (this.#pending) return;
    const sm = this.#hooks.smSoldier();
    if (!sm) return;
    if (!this.#cursor) {
      if (!slotItem(sm, slot)) return;
      this.#hooks.select(sm.id);
      this.stopGlow(sm.id, slot);
      this.#cursor = cursorFromSlot(sm, slot, shift);
      this.#hovered = null;
      this.#highlight = null;
      return;
    }
    void this.place(sm, slot);
  }

  async place(target: SoldierView, slot: number, merge?: boolean): Promise<void> {
    const cursor = this.#cursor;
    if (!cursor) return;
    const reply = await this.send(placeCommand(cursor, target.id, slot, merge));
    if (reply.ok) {
      this.#cursor = null;
      return;
    }
    const refusal = refusalOf(reply.data);
    if (refusal === REFUSAL_USE_ATTACH && ARMOUR_AND_HAND_SLOTS.has(slot)) {
      this.#hooks.openDescription(target.id, slot, 0);
      return;
    }
    if (refusal === REFUSAL_MERGE_PROMPT) {
      const yes = await this.#env().boxes.confirm(this.#env().text.string('Message', STR_MERGE_ITEMS) ?? '');
      await this.place(target, slot, yes);
    }
  }

  slotSecondary(slot: number): void {
    if (this.#pending) return;
    const sm = this.#hooks.smSoldier();
    const item = slotItem(sm, slot);
    if (!sm || !item) return;
    this.stopGlow(sm.id, slot);
    if (item.count > 1) this.#hooks.openStackPopup(sm.id, slot);
    else this.#hooks.openDescription(sm.id, slot, 0);
  }

  bodyPrimary(): void {
    const cursor = this.#cursor;
    const sm = this.#hooks.smSoldier();
    if (!cursor || !sm || (sm.life ?? 0) < CONSCIOUSNESS || this.#pending) return;
    const cmd = applyCommand(cursor, sm.id);
    if (!cmd) return;
    void this.send(cmd).then((reply) => {
      if (reply.ok) this.#cursor = null;
    });
  }

  cancel(): void {
    const cursor = this.#cursor;
    if (!cursor) return;
    this.#cursor = null;
    const cmd = cancelCommand(cursor);
    if (cmd) void this.send(cmd);
  }

  #shownItem(view: InventoryItemView, soldier: number): InventoryItemView {
    const taken = moneyTaken(this.#cursor, soldier, view.slot);
    const count = shownCount(this.#cursor, view, soldier);
    return taken > 0 ? { ...view, count, money: (view.money ?? 0) - taken } : { ...view, count };
  }

  cursorSource(): CursorSource | null {
    return this.#cursor?.source ?? null;
  }

  render(list: DrawList, ctx: TileDrawContext, soldier: SoldierView, slots: readonly SlotRect[], art: InventoryArt): void {
    if (this.#hooks.descriptionOpen() || this.#hooks.popupOpen()) return;
    const hand = slotItem(soldier, HAND_SLOT);
    const handItem = hand && !hidesSlot(this.#cursor, hand, soldier.id) ? ctx.items.item(hand.item) : null;
    for (let slot = 0; slot < NUM_INV_SLOTS; slot++) {
      const rect = slots[slot];
      if (!rect) continue;
      if (slot === SECOND_HAND_SLOT && handItem?.flags.includes(TWO_HANDED))
        list.image(art.secondHandCover, 0, art.secondHandCoverAt.x, art.secondHandCoverAt.y);
      const view = slotItem(soldier, slot);
      const shown = view && !hidesSlot(this.#cursor, view, soldier.id) ? this.#shownItem(view, soldier.id) : null;
      if (shown) {
        drawInventoryItem(ctx, shown, rect, {
          outline: this.outlineOf(soldier, slot),
          weaponMode: slot === HAND_SLOT ? (soldier.weaponMode ?? null) : null,
        });
      }
      if (slot !== SECOND_HAND_SLOT && this.hatched(soldier, slot))
        list.hatch(rect.x, rect.y, rect.x + rect.width - 1, rect.y + rect.height - 1);
      if (shown) drawItemStatusBar(list, itemStatusValue(shown, ctx.items, 0), rect.x - INV_BAR_DX, rect.y + INV_BAR_DY, ITEM_BAR_HEIGHT);
    }
    if ((soldier.keys ?? []).some((k) => k.count > 0)) list.image(art.goldKey, 0, art.keyRingAt.x, art.keyRingAt.y);
  }
}

export interface InventoryArt {
  readonly secondHandCover: string;
  readonly secondHandCoverAt: { readonly x: number; readonly y: number };
  readonly goldKey: string;
  readonly keyRingAt: { readonly x: number; readonly y: number };
}

export interface HelpTextSources {
  readonly item: (name: string) => {
    readonly longName: string;
    readonly class: string;
    readonly weapon: { readonly calibre: { readonly name: string | null; readonly showInHelpText: boolean } | null } | null;
  } | null;
  readonly text: { string(table: string, index: number): string | null };
  readonly gunNut: boolean;
  readonly nickname: (profile: number) => string | null;
}

export function helpTextForItem(view: InventoryItemView | null, sources: HelpTextSources): string {
  if (!view) return '';
  const item = sources.item(view.item);
  if (view.item === MONEY) return sprintMoney(view.money ?? 0);
  if (item?.class === MONEY_CLASS) return `${item.longName} (${sprintMoney(view.money ?? 0)})`;
  let text = item?.longName ?? '';
  const calibre = item?.weapon?.calibre;
  if (!sources.gunNut && item?.class === GUN_CLASS && calibre?.name && calibre.showInHelpText) text += ` (${calibre.name})`;
  if (view.imprint !== undefined) {
    const imprint =
      view.imprint === IMPRINT_UNKNOWN ? sources.text.string(MISC_SECTOR_STRINGS, IMPRINT_UNKNOWN_STRING) : sources.nickname(view.imprint);
    if (imprint) text += ` [${imprint}]`;
  }
  const attachments = (view.attachments ?? []).map((a) => sources.item(a.item)?.longName ?? a.item);
  if (attachments.length > 0)
    text += ` (${attachments.join(',\n')}${sources.text.string('pMessageStrings', MSG_END_ATTACHMENT_LIST) ?? ''}`;
  return text;
}

export function slotRects(table: unknown, number: (expr: unknown) => number, originX: number, originY: number): SlotRect[] {
  if (!Array.isArray(table)) return [];
  return table.map((row) => {
    const [x, y, w, h] = (row as unknown[]).map((v) => number(v));
    return { x: originX + (x ?? 0), y: originY + (y ?? 0), width: w ?? 0, height: h ?? 0 };
  });
}

export function centreOf(rect: TileBox): { x: number; y: number } {
  return { x: rect.x + idiv(rect.width, 2), y: rect.y + idiv(rect.height, 2) };
}

export function formatPassedMessage(template: string, item: string, merc: string): string {
  return printf(template, [item, merc]);
}

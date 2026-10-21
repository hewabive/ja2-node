// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc BltCharInvPanel (RenderInvBodyPanel at INV_BODY_X, INV_BODY_Y, HandleRenderInvSlots,
// @src the background shaded while the key ring or a stack popup is up), MAPInvClickCallbackPrimary (pick up, place, an
// @src attachment or merge on a hand or armour slot opens the description box instead), MAPInvClickCallbackSecondary (the
// @src stack popup in INV_REGION_X, INV_REGION_Y, 261 × 248 for a stack, else the description box at
// @src MAP_ITEMDESC_START_X, MAP_ITEMDESC_START_Y), MAPInvMoveCallback, MAPInternalInitItemDescriptionBox,
// @src TrashCanBtnCallback and TrashItemMessageBoxCallBack (pTrashItemText[0] asked before the cursor item is destroyed),
// @src GlowTrashCan (its colour index stays 0 and the background is restored at once: no glow shows),
// @src DoneInventoryMapBtnCallback (not with an item in the cursor or a stack popup up); src/game/Tactical/Interface_Panels.cc
// @src KeyRingItemPanelButtonCallback (on the map screen the key ring opens at STD_SCREEN_X, MAP_START_KEYRING_Y in
// @src 261 × (359 − 107)); src/game/Tactical/Interface_Items.cc InitKeyRingPopup and RenderKeyRingPopup in map mode
// @src (cells 40, 15 off the panel, MAP_KEY_RING_ROW_WIDTH per row). See docs/28 §7.8.

import type { ItemInfo } from '../../../protocol/hints.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { SoldierView } from '../../../protocol/view.ts';
import type { Area, DrawList } from '../../draw-list.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { FontName } from '../../text/fonts.ts';
import { MessageBoxFlag, MessageBoxReturn } from '../../widgets/message-box.ts';
import { type InventoryArt, InventoryPanel, type SlotRect } from '../tactical/inventory.ts';
import { slotItem } from '../tactical/item-cursor.ts';
import { type DescribedObject, type DescriptionGeometry, ItemDescriptionBox } from '../tactical/item-description.ts';
import { type KeyRingGrid, KeyRingPopup, StackPopup } from '../tactical/item-popups.ts';
import type { TileDrawContext } from '../tactical/item-tile.ts';
import type { MapEnvironment } from './environment.ts';
import { discardCommand, fromStashCommand, type StashCursor } from './item-pool.ts';
import { at, type LayoutParams } from './layout-params.ts';

export const MAP_KEY_RING_GRID: KeyRingGrid = { baseX: 0, cellX: 40, cellY: 15, rowWidth: 4 };
const KEY_RING_PANEL_WIDTH = 261;
const KEY_RING_PANEL_HEIGHT = 359 - 107;
const TRASH_TEXT = 'pTrashItemText';
const TRASH_ORDINARY = 0;
const DESCRIPTION_WIDGET = 'mapItemDescription';
const SLOT_STYLE = 'mercSlots';

export interface MercInventoryHost {
  readonly env: MapEnvironment;
  readonly model: () => LayoutModel;
  readonly origin: () => { readonly x: number; readonly y: number };
  readonly merc: () => SoldierView | null;
  readonly soldier: (id: number) => SoldierView | null;
  readonly stashCursor: () => StashCursor | null;
  readonly stashPlaced: () => void;
  readonly box: (text: string, flags: MessageBoxFlag) => Promise<number>;
  readonly shift: () => boolean;
}

export class MercInventory {
  readonly panel: InventoryPanel;
  readonly stack: StackPopup;
  readonly keyRing: KeyRingPopup;
  readonly description: ItemDescriptionBox;
  readonly #host: MercInventoryHost;
  #open = false;

  constructor(host: MercInventoryHost) {
    this.#host = host;
    const env = host.env;
    this.panel = new InventoryPanel({
      env: { client: env.client, boxes: env.boxes, text: env.text },
      smSoldier: () => (this.#open ? host.merc() : null),
      select: () => undefined,
      openDescription: (soldier, slot, index) => this.#describe({ kind: 'slot', soldier, slot, index }),
      openStackPopup: (soldier, slot) => this.#openStack(soldier, slot),
      descriptionOpen: () => this.description.open,
      popupOpen: () => this.stack.open || this.keyRing.open,
      disabledForItems: () => false,
      inCombat: () => false,
    });
    const popupHooks = {
      services: env.runtime,
      images: env.runtime.images,
      soldier: (id: number) => host.soldier(id),
      item: (name: string) => env.media.item(name),
      cursor: () => this.panel.cursor,
      setCursor: (cursor: Parameters<InventoryPanel['setCursor']>[0]) => this.panel.setCursor(cursor),
      send: (cmd: CommandEnvelope) => this.panel.send(cmd),
      describe: (soldier: number, slot: number, index: number) => this.#describe({ kind: 'slot', soldier, slot, index }),
      describeKey: (soldier: number, key: number) => this.#describe({ kind: 'key', soldier, key }),
      cellArt: host.model().asset('extraInventory').path,
      keyItem: (key: Parameters<MapEnvironment['media']['keyItem']>[0]) => env.media.keyItem(key),
    };
    this.stack = new StackPopup(popupHooks);
    this.keyRing = new KeyRingPopup(popupHooks);
    this.description = new ItemDescriptionBox({
      services: env.runtime,
      text: env.text,
      soldier: (id) => host.soldier(id),
      item: (name) => env.media.item(name),
      itemInfo: (object) => this.#itemInfo(object),
      cursor: () => this.panel.cursor,
      setCursor: (cursor) => this.panel.setCursor(cursor),
      placements: () => this.panel.placements(),
      send: (cmd) => this.panel.send(cmd),
      confirm: (text) => env.boxes.confirm(text),
      metric: () => env.metric(),
      keyItem: (key) => env.media.keyItem(key),
      closed: () => undefined,
    });
  }

  get open(): boolean {
    return this.#open;
  }

  get busy(): boolean {
    return this.panel.cursor !== null || this.stack.open;
  }

  get popupOpen(): boolean {
    return this.stack.open || this.keyRing.open;
  }

  show(): void {
    this.#open = true;
  }

  hide(): void {
    this.#open = false;
    this.stack.close();
    this.keyRing.close();
    this.description.close(false);
  }

  slotRects(): SlotRect[] {
    const o = this.#host.origin();
    const model = this.#host.model();
    const table = (model.style(SLOT_STYLE) as readonly (readonly (number | string)[])[] | undefined) ?? [];
    return table.map((row) => {
      const [x, y, w, h] = row.map((v) => model.number(v));
      return { x: o.x + (x ?? 0), y: o.y + (y ?? 0), width: w ?? 0, height: h ?? 0 };
    });
  }

  slotPrimary(slot: number): void {
    const merc = this.#host.merc();
    const stash = this.#host.stashCursor();
    if (!merc || !this.#open) return;
    if (stash) {
      void this.panel.send(fromStashCommand(stash, merc.id, slot)).then((reply) => {
        if (reply.ok) this.#host.stashPlaced();
      });
      return;
    }
    this.panel.slotPrimary(slot, this.#host.shift());
  }

  slotSecondary(slot: number): void {
    if (this.#open && !this.#host.stashCursor()) this.panel.slotSecondary(slot);
  }

  slotHover(slot: number, on: boolean, now: number): void {
    if (this.#open) this.panel.slotHover(slot, on, now);
  }

  openKeyRing(): void {
    const merc = this.#host.merc();
    if (!merc || this.keyRing.open || !(merc.keys ?? []).some((k) => k.count > 0)) return;
    const o = this.#host.origin();
    const top = this.#host.model().number('MAP_START_KEYRING_Y');
    this.keyRing.show(merc, { x: o.x, y: o.y + top, width: KEY_RING_PANEL_WIDTH, height: KEY_RING_PANEL_HEIGHT }, MAP_KEY_RING_GRID);
  }

  async trash(): Promise<void> {
    const cursor = this.panel.cursor;
    const command = cursor ? discardCommand(cursor) : null;
    if (!command) return;
    const text = this.#host.env.text.string(TRASH_TEXT, TRASH_ORDINARY) ?? '';
    if ((await this.#host.box(text, MessageBoxFlag.YESNO)) !== MessageBoxReturn.YES) return;
    const reply = await this.panel.send(command);
    if (reply.ok) this.panel.setCursor(null);
  }

  update(now: number): void {
    if (this.#open) this.panel.update(now);
  }

  #widgetParams(id: string): { json: Readonly<Record<string, unknown>>; params: Readonly<Record<string, unknown>> } | null {
    const json = this.#host.model().json.widgets?.find((w) => w.id === id);
    return json
      ? { json: json as Readonly<Record<string, unknown>>, params: (json.params ?? {}) as Readonly<Record<string, unknown>> }
      : null;
  }

  #openStack(soldier: number, slot: number): void {
    const s = this.#host.soldier(soldier);
    const rect = this.slotRects()[slot];
    const found = this.#widgetParams(DESCRIPTION_WIDGET);
    if (!s || !rect || !found) return;
    const model = this.#host.model();
    const o = this.#host.origin();
    const [ax, ay, aw, ah] = (found.params.stackArea as readonly (number | string)[]).map((v) => model.number(v));
    this.stack.show(s, slot, rect, { x: o.x + (ax ?? 0), y: o.y + (ay ?? 0), width: aw ?? 0, height: ah ?? 0 });
  }

  #describe(object: DescribedObject): void {
    this.stack.close();
    this.#configureDescription();
    this.description.show(object);
  }

  #configureDescription(): void {
    const found = this.#widgetParams(DESCRIPTION_WIDGET);
    if (!found) return;
    const model = this.#host.model();
    const o = this.#host.origin();
    const n = (v: unknown) => model.number(v as number | string);
    const rect = { x: o.x + n(found.json.x), y: o.y + n(found.json.y), width: n(found.json.width), height: n(found.json.height) };
    this.#configure(rect, found.params);
  }

  #configure(rect: Area, params: Readonly<Record<string, unknown>>): void {
    const model = this.#host.model();
    const fonts = this.#host.env.runtime.fonts;
    this.description.configure(
      descriptionGeometry(rect, params, (v) => model.number(v as number | string), this.#host.origin()),
      {
        box: model.asset(String(params.box)).path,
        ammo: model.asset(String(params.ammo)).path,
        bullet: model.asset(String(params.bullet)).path,
        money: model.asset(String(params.money)).path,
      },
      { item: fonts.get(FontName.BLOCKFONT2), tiny: fonts.get(FontName.TINYFONT1) },
    );
  }

  #itemInfo(object: DescribedObject): ItemInfo | null {
    const index = this.#describedIndex(object);
    return index === null ? null : this.#hint({ type: 'itemInfo', item: index, metric: this.#host.env.metric() });
  }

  #describedIndex(object: DescribedObject): number | null {
    const media = this.#host.env.media;
    const s = this.#host.soldier(object.soldier);
    if (object.kind === 'key') {
      const key = s?.keys?.[object.key];
      const name = key ? media.keyItem(key) : null;
      return name ? (media.item(name)?.index ?? null) : null;
    }
    const view = slotItem(s, object.slot);
    const name = object.kind === 'attachment' ? view?.attachments?.[object.attachment]?.item : view?.item;
    return name ? (media.item(name)?.index ?? null) : null;
  }

  #hint(request: CommandEnvelope): ItemInfo | null {
    const reply = this.#host.env.client.hint(request);
    return reply.state === 'ready' && reply.answer.ok ? (reply.answer.data as ItemInfo) : null;
  }

  render(list: DrawList, ctx: TileDrawContext, p: LayoutParams): void {
    const merc = this.#host.merc();
    if (!merc || !this.#open) return;
    const o = this.#host.origin();
    const cover = p.numbers('secondHandCoverAt');
    const key = p.numbers('keyRingAt');
    const art: InventoryArt = {
      secondHandCover: p.asset('secondHandCover'),
      secondHandCoverAt: { x: o.x + at(cover, 0), y: o.y + at(cover, 1) },
      goldKey: p.asset('keyRing'),
      keyRingAt: { x: o.x + at(key, 0), y: o.y + at(key, 1) },
    };
    this.panel.render(list, ctx, merc, this.slotRects(), art);
  }

  renderBody(list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>): void {
    const merc = this.#host.merc();
    if (!merc || !this.#open) return;
    const figures = params.figures as readonly (readonly string[])[];
    const pair = figures[merc.bodyType] ?? figures[0];
    const name = pair?.[this.panel.applyHighlight() ? 1 : 0];
    if (name) list.image(this.#host.model().asset(name).path, 0, rect.x, rect.y);
  }

  renderPopups(list: DrawList, ctx: TileDrawContext): void {
    this.stack.render(list, ctx);
    this.keyRing.render(list, ctx);
  }

  renderDescription(list: DrawList, ctx: TileDrawContext, rect: Area, params: Readonly<Record<string, unknown>>): void {
    this.#configure(rect, params);
    this.description.render(list, ctx, this.#host.env.runtime.images);
  }
}

export function descriptionGeometry(
  rect: Area,
  params: Readonly<Record<string, unknown>>,
  n: (v: unknown) => number,
  origin: { readonly x: number; readonly y: number },
): DescriptionGeometry {
  const box = (v: unknown) => (v as unknown[]).map(n) as unknown as readonly [number, number, number, number];
  const point = (v: unknown) => (v as unknown[]).map(n) as unknown as readonly [number, number];
  const stats = (v: unknown) => (v as unknown[][]).map((row) => row.map(n) as unknown as readonly [number, number, number]);
  const money = point(params.moneyBox);
  return {
    origin: { x: rect.x, y: rect.y },
    width: rect.width,
    height: rect.height,
    item: box(params.item),
    status: box(params.status),
    name: box(params.name),
    description: box(params.description),
    prosCons: box(params.prosCons),
    weaponStats: stats(params.weaponStats),
    moneyStats: stats(params.moneyStats),
    attachmentItem: box(params.attachmentItem),
    attachmentBar: box(params.attachmentBar),
    attachmentSlots: (params.attachmentSlots as unknown[]).map(point),
    bulletSingle: point(params.bulletSingle),
    bulletBurst: point(params.bulletBurst),
    bulletWidth: n(params.bulletWidth),
    ammoText: (params.ammoText as unknown[]).map(n) as unknown as readonly [number, number, number],
    moneyBox: [origin.x + money[0], origin.y + money[1]],
  };
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc CreateDestroyMapInvButton, BltCharInvPanel (the armour as "{3d}%", the weight and
// @src the camouflage as "{}%"), SetMapCursorItem and MAPEndItemPointer (the item picture as the cursor), HandleKeyESC;
// @src src/game/Strategic/Map_Screen_Interface_Map_Inventory.cc CreateDestroyMapInventoryPoolButtons,
// @src CancelSectorInventoryDisplayIfOn.

import type { SoldierView, StrategicMercView, ViewFrame } from '../../../protocol/view.ts';
import { CursorId, EXTERN_CURSOR } from '../../cursors/cursor-ids.ts';
import type { DrawList } from '../../draw-list.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { type CustomRenderer, LayoutView } from '../../layout/view.ts';
import { FontName } from '../../text/fonts.ts';
import { MessageBoxFlag } from '../../widgets/message-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { helpTextForItem, NUM_INV_SLOTS } from '../tactical/inventory.ts';
import { slotItem } from '../tactical/item-cursor.ts';
import type { TileDrawContext } from '../tactical/item-tile.ts';
import { Assignment } from './character-list.ts';
import { type MapEnvironment, MapLayout } from './environment.ts';
import type { PoolLocation } from './item-pool.ts';
import { LayoutParams, type Params } from './layout-params.ts';
import { type MapInventoryAction, MapInventoryController, type SlotTooltip } from './map-inventory-controller.ts';
import { MercInventory } from './merc-inventory.ts';
import { isMechanical, isPow, mercSoldier, tacticalSoldierOf } from './merc-soldier.ts';
import { SectorInventory } from './sector-inventory.ts';

const OWNER = 'mapInventory';
const OKLIFE = 15;
const EPC_KIND = 'epc';
const ITEM_EVENTS: ReadonlySet<string> = new Set(['itemMoved', 'itemDiscarded', 'itemDropped', 'itemsPickedUp', 'itemsRevealed']);
const ARMOUR_DIGITS = 3;

export function accessibleInventory(m: StrategicMercView): boolean {
  return m.assignment !== Assignment.IN_TRANSIT && !isPow(m) && !isMechanical(m) && m.kind !== EPC_KIND && m.life >= OKLIFE;
}

export interface MapInventoryHost {
  readonly env: MapEnvironment;
  readonly infoMerc: () => StrategicMercView | null;
  readonly location: () => PoolLocation;
  readonly box: (text: string, flags: MessageBoxFlag) => Promise<number>;
  readonly shift: () => boolean;
  readonly mercClosed: () => void;
  readonly poolClosed: () => void;
}

export class MapInventory {
  readonly merc: MercInventory;
  readonly pool: SectorInventory;
  readonly #host: MapInventoryHost;
  readonly #model: LayoutModel;
  readonly #controller: MapInventoryController;
  readonly #view: LayoutView;
  #externCursor = false;
  #now = 0;

  constructor(host: MapInventoryHost) {
    this.#host = host;
    const env = host.env;
    this.#model = env.layout(MapLayout.INVENTORY);
    this.#controller = new MapInventoryController((action, args) => this.#action(action, args));
    this.#view = new LayoutView({
      model: this.#model,
      controller: this.#controller,
      services: env.runtime,
      sliders: env.runtime.sliders,
      text: env.text,
      custom: this.#renderers(),
      owner: OWNER,
    });
    const origin = () => {
      const g = env.runtime.geometry();
      return { x: g.stdX, y: g.stdY };
    };
    this.merc = new MercInventory({
      env,
      model: () => this.#model,
      origin,
      merc: () => this.#mercSoldier(),
      soldier: (id) => this.#soldier(id),
      stashCursor: () => this.pool.cursor,
      stashPlaced: () => {
        this.pool.clearCursor();
        void this.pool.refresh();
      },
      box: (text, flags) => host.box(text, flags),
      shift: () => host.shift(),
    });
    this.pool = new SectorInventory({
      env,
      origin,
      location: () => host.location(),
      infoMerc: () => host.infoMerc(),
      mercCursor: () => this.merc.panel.cursor,
      mercPlaced: () => this.merc.panel.setCursor(null),
      box: (text) => host.box(text, MessageBoxFlag.OK),
      shift: () => host.shift(),
    });
  }

  get holding(): boolean {
    return this.merc.panel.cursor !== null || this.pool.cursor !== null;
  }

  get cursorItem(): string | null {
    return this.merc.panel.cursor?.item ?? this.pool.cursor?.item ?? null;
  }

  enter(): void {
    this.#view.build();
  }

  exit(): void {
    this.closeMerc();
    this.closePool();
    this.#releaseCursor();
    this.#view.dispose();
  }

  #mercSoldier(): SoldierView | null {
    const m = this.#host.infoMerc();
    return m && accessibleInventory(m) ? mercSoldier(this.#host.env.client.view, m) : null;
  }

  #soldier(id: number): SoldierView | null {
    const view = this.#host.env.client.view;
    const m = view?.strategic?.mercs.find((x) => x.id === id);
    return m ? mercSoldier(view, m) : tacticalSoldierOf(view, id);
  }

  openMerc(): void {
    this.merc.show();
  }

  closeMerc(): void {
    if (!this.merc.open) return;
    this.merc.hide();
    this.merc.panel.setCursor(null);
  }

  get mercBusy(): boolean {
    return this.merc.busy;
  }

  openPool(): void {
    if (!this.pool.open) this.pool.show();
  }

  closePool(): void {
    if (this.pool.open) this.pool.hide();
  }

  togglePool(): void {
    if (this.pool.open) this.closePool();
    else this.openPool();
  }

  frames(frames: readonly ViewFrame[]): void {
    if (!this.pool.open) return;
    if (frames.some((f) => f.events?.some((e) => ITEM_EVENTS.has(e.type)))) void this.pool.refresh();
  }

  escape(): boolean {
    if (this.merc.description.open) {
      this.merc.description.close(true);
      return true;
    }
    if (this.merc.stack.open) {
      this.merc.stack.close();
      return true;
    }
    if (this.merc.keyRing.open) {
      this.merc.keyRing.close();
      return true;
    }
    if (this.merc.panel.cursor) {
      this.merc.panel.setCursor(null);
      return true;
    }
    if (this.pool.cursor) {
      this.pool.clearCursor();
      return true;
    }
    if (this.pool.open) {
      this.closePool();
      this.#host.poolClosed();
      return true;
    }
    return false;
  }

  #action(action: MapInventoryAction, args: readonly number[]): void {
    const [first = 0, second = 0] = args;
    switch (action) {
      case 'mercSlotPrimary':
        this.merc.slotPrimary(first);
        return;
      case 'mercSlotSecondary':
        this.merc.slotSecondary(first);
        return;
      case 'mercSlotHover':
        this.merc.slotHover(first, second !== 0, this.#now);
        return;
      case 'mercDone':
        if (this.merc.busy) return;
        this.closeMerc();
        this.#host.mercClosed();
        return;
      case 'keyRing':
        this.merc.openKeyRing();
        return;
      case 'trash':
        void this.merc.trash();
        return;
      case 'poolSlotPrimary':
        void this.pool.slotPrimary(first);
        return;
      case 'poolSlotSecondary':
        if (this.pool.slotSecondary()) this.#host.poolClosed();
        return;
      case 'poolPrev':
        this.pool.prevPage();
        return;
      case 'poolNext':
        this.pool.nextPage();
        return;
      case 'poolDone':
        if (this.holding) return;
        this.closePool();
        this.#host.poolClosed();
        return;
    }
  }

  update(now: number): void {
    this.#now = now;
    if (this.merc.open && !this.#mercSoldier()) this.closeMerc();
    this.merc.update(now);
    this.#syncModel();
    this.#view.update();
    this.#syncCursor(now);
  }

  #syncModel(): void {
    const m = this.#controller.model;
    const s = this.merc.open ? this.#mercSoldier() : null;
    const merc = this.#host.infoMerc();
    m.mercOpen = this.merc.open;
    m.descriptionOpen = this.merc.description.open;
    m.mercPanelShown = this.merc.open && !this.merc.description.open;
    m.mercSlots = s ? this.#slotTooltips(s) : [];
    m.armour = `${String(merc?.armour ?? s?.armour ?? 0).padStart(ARMOUR_DIGITS, ' ')}%`;
    m.weight = `${merc?.weight ?? s?.weight ?? 0}%`;
    m.camo = `${merc?.camo ?? s?.camo ?? 0}%`;
    this.pool.syncModel(m);
  }

  #slotTooltips(s: SoldierView): SlotTooltip[] {
    const media = this.#host.env.media;
    const sources = {
      item: (name: string) => media.item(name),
      text: this.#host.env.text,
      gunNut: media.gunNut,
      nickname: (profile: number) => media.profile(profile)?.nickname ?? null,
    };
    return Array.from({ length: NUM_INV_SLOTS }, (_, slot) => ({ tooltip: helpTextForItem(slotItem(s, slot), sources) }));
  }

  #syncCursor(now: number): void {
    const name = this.cursorItem;
    const media = this.#host.env.media;
    const graphic = name ? (media.item(name)?.inventoryGraphics.small ?? null) : null;
    const cursor = this.#host.env.runtime.cursor;
    if (!graphic || !media.image(graphic.path)) {
      this.#releaseCursor(now);
      return;
    }
    cursor.setExternCursor(graphic.path, graphic.subImageIndex);
    cursor.set(EXTERN_CURSOR, now);
    this.#externCursor = true;
  }

  #releaseCursor(now = this.#now): void {
    if (!this.#externCursor) return;
    const runtime = this.#host.env.runtime;
    runtime.cursor.set(runtime.regions.current?.cursor ?? CursorId.NORMAL, now);
    this.#externCursor = false;
  }

  #tileContext(list: DrawList): TileDrawContext {
    const env = this.#host.env;
    return {
      list,
      images: env.runtime.images,
      items: { item: (name) => env.media.item(name) },
      font: env.runtime.fonts.get(FontName.TINYFONT1),
      text: env.text,
      ensure: (path) => env.media.image(path),
    };
  }

  #params(params: Params): LayoutParams {
    return new LayoutParams(this.#model, params, this.#host.env.runtime.fonts);
  }

  #renderers(): Readonly<Record<string, CustomRenderer>> {
    return {
      mercBody: (list, rect, params) => this.merc.renderBody(list, rect, params),
      mercInventory: (list, _rect, params) => this.merc.render(list, this.#tileContext(list), this.#params(params)),
      sectorPool: (list, _rect, params) => this.pool.render(list, this.#tileContext(list), this.#params(params)),
      itemDescription: (list, rect, params) => this.merc.renderDescription(list, this.#tileContext(list), rect, params),
    };
  }

  render(list: DrawList): void {
    this.#view.render(list);
    this.merc.renderPopups(list, this.#tileContext(list));
  }

  describe(): readonly WidgetInfo[] {
    return this.#view.describe();
  }
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-20. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc InitiateConversation and InitTalkingMenu (the panel opens on the NPC's
// @src tile), DeleteTalkingMenu (the panel stays until its lines are said), TalkPanelClickCallback (Give opens the
// @src talker's inventory panel); src/game/Tactical/Turn_Based_Input.cc GetKeyboardInput (Backspace stops any speech on
// @src key down, a key up advances a waiting line), HandleTalkingMenuKeys (Esc and Backspace on key up in the panel);
// @src src/game/Tactical/Civ_Quotes.cc ShutDownQuoteBoxIfActive; src/game/Tactical/ShopKeeper_Interface.cc
// @src EnterShopKeeperInterface (the SM panel of the selected merc), ShopKeeperScreenHandle (leaving once the farewell is
// @src said), InitShopKeeperSubTitledText (only with SUBTITLES). See docs/28 §5.8, §5.9.

import { npcDialogueFile, textKey } from '../../../content/narrative/dialogue-text.ts';
import type { CatalogueItem } from '../../../protocol/items.ts';
import type { InventoryItemView, PlayerView, SoldierView, ViewFrame } from '../../../protocol/view.ts';
import { EXTERN_CURSOR } from '../../cursors/cursor-ids.ts';
import type { DrawList } from '../../draw-list.ts';
import type { UiInputEvent } from '../../input/events.ts';
import { ViewModelController } from '../../layout/controller.ts';
import { INV_INTERFACE_HEIGHT } from '../../layout/frames.ts';
import { LayoutView } from '../../layout/view.ts';
import {
  civQuoteOf,
  isQueuedQuoteEvent,
  isQuoteEvent,
  type SpeakingFace,
  SpeechPresenter,
  type SpeechRouting,
  SpeechSurface,
  speechLineOf,
} from '../../speech.ts';
import { FontName } from '../../text/fonts.ts';
import type { MercTextBoxFonts } from '../../widgets/merc-text-box.ts';
import { MessageBoxReturn } from '../../widgets/message-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { ShopPanel } from '../shop/shop-panel.ts';
import type { BarValues } from '../tactical/bars.ts';
import { type SpeechPlayback, type TacticalEnvironment, TacticalLayout } from '../tactical/environment.ts';
import { helpTextForItem } from '../tactical/inventory.ts';
import type { TileDrawContext } from '../tactical/item-tile.ts';
import { npcRequestBox, npcRequestChoice } from './npc-requests.ts';
import { SpeechSurfaces, TACTICAL_SPEECH_CONTRACT, TACTICAL_SPEECH_SCREEN } from './speech-surfaces.ts';
import { TalkPanel } from './talk-panel.ts';

const SILENT_SETTINGS = { speech: false, subtitles: true, keyAdvance: false } as const;
const BACKSPACE = 'Backspace';
const ESCAPE = 'Escape';
const KEVLAR_VEST = 'LEATHER_JACKET_W_KEVLAR';
const REQUEST_BOX_ID = 'npcRequestBox';

export interface DialogueHost {
  drawSoldierFace(list: DrawList, soldier: SoldierView, x: number, y: number): void;
  drawBars(list: DrawList, values: BarValues, x: number, y: number): void;
  barValues(soldier: SoldierView): BarValues;
  viewport(): { readonly top: number; readonly bottom: number };
  openInventory(soldier: number): void;
  sector(): string | null;
  smMerc(): number | null;
  nextMerc(): void;
  describeItem(view: InventoryItemView, at: { readonly x: number; readonly y: number }): void;
  descriptionOpen(): boolean;
}

type FrameEvent = NonNullable<ViewFrame['events']>[number];

export class DialogueLayer {
  readonly presenter: SpeechPresenter;
  readonly talk: TalkPanel;
  readonly surfaces: SpeechSurfaces;
  readonly shop: ShopPanel;
  readonly #env: TacticalEnvironment;
  readonly #host: DialogueHost;
  readonly #speechView: LayoutView;
  #conversationProfile: number | null = null;
  #pricingRequested: number | null = null;
  #heldCursor = false;
  #now = 0;
  #built = false;
  #askedRequest: string | null = null;

  constructor(env: TacticalEnvironment, host: DialogueHost) {
    this.#env = env;
    this.#host = host;
    this.presenter = env.speech ?? new SpeechPresenter({ voices: null, settings: () => SILENT_SETTINGS });
    const services = env.runtime;
    const boxFonts = (): MercTextBoxFonts => ({ text: services.fonts.get('FONT12ARIAL'), bold: services.fonts.get('FONT10ARIALBOLD') });
    const media = env.media;
    this.talk = new TalkPanel({
      services,
      sliders: services.sliders,
      text: env.text,
      model: env.layout(TacticalLayout.TALK),
      presenter: this.presenter,
      boxArt: env.basicTextBox,
      boxFonts,
      random: env.random,
      profile: (id) => media.profile(id),
      ensureImage: (path) => media.image(path),
      gaps: (file) => media.gaps(file),
      approach: (kind) => void this.#approach(kind),
      close: () => this.#closeTalk(),
      linesComing: () => this.#linesComing(),
    });
    this.surfaces = new SpeechSurfaces({
      services,
      model: env.layout(TacticalLayout.SPEECH),
      presenter: this.presenter,
      boxArt: env.basicTextBox,
      boxFonts,
      random: env.random,
      view: () => this.#view(),
      profile: (id) => media.profile(id),
      ensureImage: (path) => media.image(path),
      gaps: (file) => media.gaps(file),
      speechOn: () => env.speechSettings?.().speech ?? false,
      bounds: () => this.#bounds(),
      soldierScreenPos: (id) => env.world.soldierBox(id),
      sectorShown: (sector) => sector === host.sector(),
      drawSoldierFace: (list, s, x, y) => host.drawSoldierFace(list, s, x, y),
      drawBars: (list, values, x, y) => host.drawBars(list, values, x, y),
      barValues: (s) => host.barValues(s),
    });
    this.shop = new ShopPanel({
      services,
      sliders: services.sliders,
      text: env.text,
      model: env.layout(TacticalLayout.SHOP),
      presenter: this.presenter,
      boxes: env.boxes,
      boxArt: env.basicTextBox,
      boxFonts,
      random: env.random,
      view: () => this.#view(),
      profile: (id) => media.profile(id),
      item: (name) => media.item(name),
      ensureImage: (path) => media.image(path),
      gaps: (file) => media.gaps(file),
      tileContext: (list) => this.#tileContext(list),
      helpText: (view) =>
        helpTextForItem(view, {
          item: (name) => media.item(name),
          text: env.text,
          gunNut: media.gunNut,
          nickname: (profile) => media.profile(profile)?.nickname ?? null,
        }),
      command: (cmd) => env.client.command(cmd),
      subtitles: () => env.speechSettings?.().subtitles ?? true,
      rpcSpeechPrefixed: env.rpcSpeechPrefixed ?? false,
      modifiers: () => services.modifiers,
      setHeldCursor: (item) => this.#setHeldCursor(item),
      describe: (view, at) => host.describeItem(view, at),
      nextMerc: () => host.nextMerc(),
      exitGame: () => env.flow.exitGame(),
      descriptionOpen: () => host.descriptionOpen(),
    });
    this.#speechView = new LayoutView({
      model: env.layout(TacticalLayout.SPEECH),
      controller: new ViewModelController(TACTICAL_SPEECH_CONTRACT, {}),
      services,
      sliders: services.sliders,
      text: env.text,
      owner: TACTICAL_SPEECH_SCREEN,
      custom: this.surfaces.renderers(),
    });
  }

  get modal(): boolean {
    return this.talk.open || this.shop.open;
  }

  get shopOpen(): boolean {
    return this.shop.open;
  }

  shopHatched(soldier: number, slot: number): boolean {
    return this.shop.open && this.shop.hatched(soldier, slot);
  }

  shopDisablesInventory(soldier: number | null): boolean {
    const shop = this.#view()?.shop;
    if (!this.shop.open || !shop) return false;
    return soldier === null || !shop.canTrade.includes(soldier);
  }

  shopPocketClick(soldier: number, slot: number): boolean {
    if (!this.shop.open) return false;
    return this.shop.pocketClick(soldier, slot);
  }

  #tileContext(list: DrawList): TileDrawContext {
    const media = this.#env.media;
    return {
      list,
      images: this.#env.runtime.images,
      items: { item: (name) => media.item(name) },
      font: this.#env.runtime.fonts.get(FontName.TINYFONT1),
      text: this.#env.text,
      ensure: (path) => media.image(path),
    };
  }

  #setHeldCursor(item: CatalogueItem | null): void {
    const cursor = this.#env.runtime.cursor;
    const graphic = item?.inventoryGraphics.small ?? null;
    if (!graphic || !this.#env.media.image(graphic.path)) {
      if (this.#heldCursor) cursor.set(this.#env.runtime.regions.current?.cursor ?? 0, this.#now);
      this.#heldCursor = false;
      return;
    }
    cursor.setExternCursor(graphic.path, graphic.subImageIndex);
    cursor.set(EXTERN_CURSOR, this.#now);
    this.#heldCursor = true;
  }

  get speaking(): SpeechPlayback | null {
    const s: SpeakingFace | null = this.presenter.speaking;
    if (!s || s.speaker < 0 || s.surface !== SpeechSurface.TACTICAL) return null;
    return { speaker: s.speaker, file: s.file, elapsedMs: s.elapsedMs, playing: s.playing };
  }

  #view(): PlayerView | null {
    return this.#env.client.view;
  }

  #bounds() {
    const viewport = this.#host.viewport();
    return { screenWidth: this.#env.runtime.geometry().width, viewportTop: viewport.top, viewportBottom: viewport.bottom };
  }

  enter(): void {
    this.#speechView.build();
    this.#built = true;
    this.#conversationProfile = this.#view()?.conversation?.profile ?? null;
  }

  dispose(): void {
    this.talk.hide();
    this.shop.hide();
    this.surfaces.dispose();
    this.#speechView.dispose();
    this.#built = false;
  }

  frames(frames: readonly ViewFrame[]): void {
    for (const frame of frames) {
      if (frame.conversation !== undefined) this.#conversationProfile = frame.conversation?.profile ?? null;
      for (const event of frame.events ?? []) this.#event(event);
    }
  }

  #routing(): SpeechRouting {
    const view = this.#view();
    return {
      conversationProfile: this.#conversationProfile,
      shopDealer: view?.shop?.dealer ?? null,
      rpcSpeechPrefixed: this.#env.rpcSpeechPrefixed ?? false,
      recruited: (soldier) => {
        const kind = view?.soldiers.find((s) => s.id === soldier)?.kind;
        return kind === 'rpc' || kind === 'epc';
      },
      text: (key) => this.#env.text.edt(key.file, key.row),
    };
  }

  #event(event: FrameEvent): void {
    if (event.type === 'lineCut') {
      this.presenter.cut(event.profile, event.saidAt, event.tail);
      return;
    }
    if (!isQuoteEvent(event)) return;
    const routing = this.#routing();
    if (event.type === 'civQuote') {
      const civ = civQuoteOf(event, routing);
      if (civ) this.presenter.showCivQuote(civ, this.#now);
      return;
    }
    const line = speechLineOf(event.type === 'shopkeeperQuote' ? withDealerTextKey(event) : event, routing);
    if (!line || (event.type === 'shopkeeperQuote' && line.text.length === 0)) return;
    const queued = this.presenter.enqueue(line);
    if (event.type === 'shopkeeperQuote') this.shop.lineQueued(queued.id, event.quote);
  }

  update(now: number): void {
    this.#now = now;
    this.presenter.update(now);
    if (!this.#built) return;
    this.#syncTalkPanel(now);
    this.#syncRequest();
    this.#syncShop(now);
    this.talk.update(now);
    this.shop.update(now);
    this.surfaces.update(now);
    this.#speechView.update();
  }

  #syncRequest(): void {
    const request = this.#view()?.npcRequest ?? null;
    if (!request || request.id === this.#askedRequest || this.presenter.busy) return;
    this.#askedRequest = request.id;
    const box = npcRequestBox(request, this.#env.text, this.#env.media.item(KEVLAR_VEST)?.longName ?? '');
    const answeredElsewhere = () => this.#env.client.latestView?.npcRequest?.id !== request.id;
    void this.#env.boxes.ask(box.text, box.buttons, { id: REQUEST_BOX_ID, closeWhen: answeredElsewhere }).then((result) => {
      if (result !== MessageBoxReturn.NONE)
        void this.#env.client.command({ type: 'answer', prompt: request.id, choice: npcRequestChoice(result) });
    });
  }

  #linesComing(): boolean {
    return this.#env.client.queuedFrames.some((frame) => (frame.events ?? []).some(isQueuedQuoteEvent));
  }

  #panelLinesLeft(): boolean {
    const current = this.presenter.current?.line.surface === SpeechSurface.PANEL;
    return current || this.presenter.queued.some((l) => l.surface === SpeechSurface.PANEL);
  }

  #syncTalkPanel(now: number): void {
    const conversation = this.#view()?.conversation ?? null;
    if (conversation) {
      if (!this.talk.open || this.talk.profile !== conversation.profile) {
        this.talk.hide();
        this.talk.show(conversation, this.#anchor(conversation.npc), this.#talkBounds(), now);
      } else this.talk.sync(conversation);
      return;
    }
    if (this.talk.open && !this.#panelLinesLeft()) this.talk.hide();
  }

  #syncShop(now: number): void {
    const shop = this.#view()?.shop ?? null;
    if (shop) {
      if (!this.shop.open || this.shop.dealer !== shop.dealer) {
        this.shop.hide();
        this.#env.prepareText?.(npcDialogueFile(shop.dealer));
        this.#host.openInventory(shop.pricing.soldier);
        this.#pricingRequested = shop.pricing.soldier;
        this.shop.show(shop, now);
      } else this.shop.sync(shop);
      this.#followPricing(shop.pricing.soldier);
      return;
    }
    this.#pricingRequested = null;
    if (this.shop.open && !this.shop.linesLeft()) this.shop.hide();
  }

  #followPricing(pricing: number): void {
    const merc = this.#host.smMerc();
    if (merc === null || merc === pricing || merc === this.#pricingRequested) return;
    this.#pricingRequested = merc;
    void this.shop.model.setPricing(merc);
  }

  #talkBounds() {
    const viewport = this.#host.viewport();
    const geometry = this.#env.runtime.geometry();
    return {
      screenWidth: geometry.width,
      viewportTop: viewport.top,
      viewportBottom: viewport.bottom,
      inventoryTop: geometry.height - INV_INTERFACE_HEIGHT,
    };
  }

  #anchor(npc: number | null): { x: number; y: number } {
    const s = npc === null ? null : (this.#view()?.soldiers.find((v) => v.id === npc) ?? null);
    if (s) return this.#env.world.cellScreenPosition(s.gridNo);
    const geometry = this.#env.runtime.geometry();
    return { x: Math.trunc(geometry.width / 2), y: Math.trunc(geometry.height / 2) };
  }

  render(list: DrawList): void {
    this.shop.render(list);
    if (this.shop.open && this.#host.descriptionOpen()) {
      const geometry = this.#env.runtime.geometry();
      list.hatch(0, 0, geometry.width - 1, geometry.height - 1);
    }
    this.talk.render(list);
    this.#speechView.render(list);
  }

  input(event: UiInputEvent): boolean {
    if (event.kind === 'keyDown' && event.key === BACKSPACE) {
      this.presenter.skip(this.#now, true);
      return true;
    }
    if (event.kind === 'keyUp' && this.presenter.waitingForKey) {
      this.presenter.advanceKey(this.#now);
      return true;
    }
    if (this.shop.open && this.#host.descriptionOpen() && event.kind !== 'text' && 'key' in event && event.key === ESCAPE) return false;
    if (this.shop.input(event)) return true;
    if (!this.talk.open) return false;
    if (this.talk.input(event)) return true;
    return event.kind === 'keyDown' && (event.key === ESCAPE || event.key === BACKSPACE);
  }

  closeCivQuoteIfActive(): boolean {
    return this.presenter.closeCivQuote(this.#now, true);
  }

  describe(): readonly WidgetInfo[] {
    return [...this.talk.describe(), ...this.shop.describe(), ...this.surfaces.describe()];
  }

  async #approach(kind: string): Promise<void> {
    const talker = this.#view()?.conversation?.talker ?? null;
    const reply = await this.#env.client.command({ type: 'approach', kind });
    if (reply.ok && kind === 'give' && talker !== null) this.#host.openInventory(talker);
  }

  async #closeTalk(): Promise<boolean> {
    const reply = await this.#env.client.command({ type: 'closeTalk' });
    return reply.ok;
  }
}

type ShopkeeperQuote = Extract<FrameEvent, { type: 'shopkeeperQuote' }>;

function withDealerTextKey(event: ShopkeeperQuote): ShopkeeperQuote {
  if (event.textKey) return event;
  return { ...event, textKey: textKey(npcDialogueFile(event.dealer), event.quote) };
}

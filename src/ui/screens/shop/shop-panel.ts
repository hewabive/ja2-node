// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-20. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/ShopKeeper_Interface.cc ShopKeeperScreenHandle, RenderShopKeeperInterface,
// @src DisplayArmsDealerCurrentInventoryPage (the page texts, the hatch of a box with none left or a disabled slot),
// @src DisplayArmsDealerOfferArea, DisplayPlayersOfferArea, CrossOutUnwantedItems (itemcrossout.sti at x + 22),
// @src DisplayTalkingArmsDealer, InitShopKeepersFace, InitShopKeeperSubTitledText (the quoted line in a basic box 300 wide
// @src at 13, SKI_POSITION_SUBTITLES_Y when SUBTITLES is on, its region at MSYS_PRIORITY_HIGH), ShutUpShopKeeper,
// @src SelectArmsDealersFaceRegionCallBack, ShopKeeperSubTitleRegionCallBack, HandleShopKeeperDialog (the idle quotes
// @src after SKI_DEALERS_RANDOM_QUOTE_DELAY + Random of it with Chance(35), once each per visit, the delay raised by
// @src SKI_DEALERS_RANDOM_QUOTE_DELAY_INCREASE_RATE; leaving once the farewell is said), HandleCheckIfEnoughOnTheTable
// @src (quote 21 after DELAY_FOR_SHOPKEEPER_IDLE_QUOTE when Random(100) > CHANCE_FOR_SHOPKEEPER_IDLE_QUOTE),
// @src CanShopkeeperOverrideDialogue (a fluff quote below 16 yields), StartShopKeeperTalking, EvaluateInvSlot (the normal
// @src evaluation quote's chance 100/60/25/10/0 by the time since the last), GetShopKeeperInterfaceUserInput (ESC = Done,
// @src SPACE = the next merc), BuildDoneWhenTimeString, BuildRepairTimeString, BuildItemHelpTextString,
// @src SetSkiFaceRegionHelpText, InitShopKeeperItemDescBox (the placement quirks), IsGunOrAmmoOfSameTypeSelected,
// @src SetSkiCursor. See docs/28 §5.9.

import { speechPathForLine } from '../../../content/audio/speech.ts';
import type { AudioGap } from '../../../content/formats/gap.ts';
import { npcDialogueFile, textKey } from '../../../content/narrative/dialogue-text.ts';
import type { ProfilePresentation } from '../../../content/narrative/profile-presentation.ts';
import { idiv } from '../../../core/int.ts';
import type { CatalogueItem } from '../../../protocol/items.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { InventoryItemView, PlayerView, ShopBoxView, ShopView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import type { UiInputEvent } from '../../input/events.ts';
import { MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { LayoutView } from '../../layout/view.ts';
import type { MessageBoxes } from '../../message-boxes.ts';
import type { UiServices } from '../../services.ts';
import { quoted, type SpeechPresenter, SpeechSurface } from '../../speech.ts';
import { fontHeight } from '../../text/bitmap-font.ts';
import { sprintMoney } from '../../text/money.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { drawTextToScreen, TextFlag } from '../../text/wrap.ts';
import { MercTextBox, type MercTextBoxArt, type MercTextBoxFonts } from '../../widgets/merc-text-box.ts';
import { MessageBoxReturn } from '../../widgets/message-box.ts';
import type { SliderSystem } from '../../widgets/slider.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { FaceAnimator } from '../tactical/faces.ts';
import type { TileDrawContext } from '../tactical/item-tile.ts';
import { bigFaceRecord, drawTalkingFace } from '../talk/talk-panel.ts';
import { DEALER_SLOTS, type DealerSelection, OFFER_SLOTS, type PocketOffer, ShopModel, ShopQuoteId } from './shop-model.ts';
import { drawShopTile, hatchSlot, MATCH_OUTLINE, type ShopTile, SKI_INV_SLOT_HEIGHT, SKI_INV_SLOT_WIDTH } from './shop-tile.ts';

export const SHOP_SCREEN = 'shop';
export const SHOP_LAYOUT = 'shop';

export const SHOP_CONTRACT: ControllerContract = {
  id: SHOP_SCREEN,
  actions: {
    pageUp: {},
    pageDown: {},
    shutUp: {},
    dealerPrimary: { args: 1 },
    dealerSecondary: { args: 1 },
    dealerHover: { args: 2 },
    dealerOfferPrimary: { args: 1 },
    dealerOfferSecondary: { args: 1 },
    dealerOfferHover: { args: 2 },
    playerOfferPrimary: { args: 1 },
    playerOfferSecondary: { args: 1 },
    playerOfferHover: { args: 2 },
    transaction: {},
    done: {},
  },
  bindings: {
    costLabel: 'string',
    transactionTip: 'string',
    balance: 'number',
    totalCost: 'number',
    totalValue: 'number',
    pageUpEnabled: 'boolean',
    pageDownEnabled: 'boolean',
    transactionEnabled: 'boolean',
    doneEnabled: 'boolean',
    dealerSlotsEnabled: 'boolean',
    dealerOfferEnabled: 'boolean',
    playerOfferEnabled: 'boolean',
    dealerTips: 'list',
    dealerOfferTips: 'list',
    playerOfferTips: 'list',
  },
};

const SUBTITLE_WIDTH = 300;
const HOVER_ON = 1;
const SHIFT_MASK = 1;
const CTRL_MASK = 2;
const ALT_MASK = 4;
const OUR_TEAM = 0;
const JAMMED_ITEM_STR = 43;
const SKI_TEXT_PAGE = 1;
const SKI_TEXT_ONE_HOUR = 8;
const SKI_TEXT_PLURAL_HOURS = 9;
const SKI_TEXT_REPAIRED = 10;
const SKI_TEXT_MINUTES = 12;
const STR_LATE_44 = 43;
const SKI_TRANSACTION_BUTTON_HELP_TEXT = 3;
const SKI_REPAIR_TRANSACTION_BUTTON_HELP_TEXT = 4;
const REPAIR_MINUTES_INTERVAL = 15;
const MINUTES_SHOWN_UP_TO = 90;
const HOURS_ROUNDING = 45;
const MINUTES_PER_HOUR = 60;
const RANDOM_QUOTE_DELAY_MS = 15000;
const RANDOM_QUOTE_DELAY_INCREASE_MS = 5000;
const IDLE_CHANCE = 35;
const PRECISE_OVERRIDE_CHANCE = 33;
const HALF = 50;
const NOT_ENOUGH_DELAY_MS = 20000;
const NOT_ENOUGH_CHANCE_ABOVE = 40;
const PERCENT = 100;
const FLUFF_BELOW = ShopQuoteId.REQUESTED_EVALUATION;
const NORMAL_QUOTE_STEPS: readonly (readonly [number, number])[] = [
  [25000, 60],
  [12000, 25],
  [7000, 10],
];
const DESC_BOX_WIDTH = 358;
const DESC_BOX_HEIGHT = 128;
const DESC_SCREEN_MARGIN = 5;
const DESC_FACE_GAP = 20;
const DESC_MIN_X_NEAR_FACE = 160;
const DESC_OFFER_LEFT_X = 10;
const DESC_OFFER_Y_NEAR_FACE = 140;
const SCREEN_WIDTH_640 = 640;
const GUN_CLASS = 'GUN';
const AMMO_CLASS = 'AMMO';
const ATTACHMENT_FLAG = 'ATTACHMENT';

type Area = 'dealer' | 'dealerOffer' | 'playerOffer';

export interface ShopPanelHooks {
  readonly services: UiServices;
  readonly sliders: SliderSystem;
  readonly text: UiTextService;
  readonly model: LayoutModel;
  readonly presenter: SpeechPresenter;
  readonly boxes: MessageBoxes;
  readonly boxArt: MercTextBoxArt;
  readonly boxFonts: () => MercTextBoxFonts;
  readonly random: (range: number) => number;
  readonly view: () => PlayerView | null;
  readonly profile: (id: number) => ProfilePresentation | null;
  readonly item: (name: string) => CatalogueItem | null;
  readonly ensureImage: (path: string) => boolean;
  readonly gaps: (file: string) => readonly AudioGap[] | null;
  readonly tileContext: (list: DrawList) => TileDrawContext;
  readonly helpText: (view: InventoryItemView) => string;
  readonly command: (cmd: CommandEnvelope) => Promise<{ readonly ok: boolean; readonly reason?: string; readonly data?: unknown }>;
  readonly subtitles: () => boolean;
  readonly rpcSpeechPrefixed: boolean;
  readonly modifiers: () => number;
  readonly setHeldCursor: (item: CatalogueItem | null) => void;
  readonly describe: (view: InventoryItemView, at: { readonly x: number; readonly y: number }) => void;
  readonly nextMerc: () => void;
  readonly exitGame: () => void;
  readonly descriptionOpen: () => boolean;
}

interface Subtitle {
  readonly lineId: number;
  readonly box: MercTextBox;
  readonly region: MouseRegion;
}

export function repairTimeString(text: UiTextService, minutes: number): string {
  let m = minutes;
  if (m % REPAIR_MINUTES_INTERVAL > 0) m += REPAIR_MINUTES_INTERVAL - (m % REPAIR_MINUTES_INTERVAL);
  if (m < REPAIR_MINUTES_INTERVAL) m = REPAIR_MINUTES_INTERVAL;
  if (m <= MINUTES_SHOWN_UP_TO) return printf(text.string('SKI_Text', SKI_TEXT_MINUTES) ?? '', [m]);
  const hours = idiv(m + HOURS_ROUNDING, MINUTES_PER_HOUR);
  return printf(text.string('SKI_Text', hours === 1 ? SKI_TEXT_ONE_HOUR : SKI_TEXT_PLURAL_HOURS) ?? '', [hours]);
}

export function doneWhenString(text: UiTextService, eta: ShopBoxView['eta'], today: number): string {
  if (!eta) return '';
  const time = `${String(eta.hour).padStart(2, '0')}:${String(eta.minute).padStart(2, '0')}`;
  return eta.day !== today ? `${text.string('pDayStrings', 0) ?? ''} ${eta.day} ${time}` : time;
}

export function dealerBoxDescriptionAt(slot: number): { x: number; y: number } {
  const column = slot % 5;
  let x = 165 + (74 * column - idiv(DESC_BOX_WIDTH, 2)) + idiv(SKI_INV_SLOT_WIDTH, 2);
  let y = 30 + (idiv(36 * slot, 5) + 1) - idiv(DESC_BOX_HEIGHT, 2) + idiv(SKI_INV_SLOT_HEIGHT, 2);
  if (y < 0) y = 0;
  if (x + DESC_BOX_WIDTH > SCREEN_WIDTH_640) x = SCREEN_WIDTH_640 - DESC_BOX_WIDTH - DESC_SCREEN_MARGIN;
  else if (x < 0) x = 0;
  if (y < 13 + 100 + DESC_FACE_GAP && x < DESC_MIN_X_NEAR_FACE) x = DESC_MIN_X_NEAR_FACE;
  return { x, y };
}

export function dealerOfferDescriptionAt(slot: number): { x: number; y: number } {
  const columns = OFFER_SLOTS / 2;
  let x = 91 + (74 * (slot % columns) - idiv(DESC_BOX_WIDTH, 2)) + idiv(SKI_INV_SLOT_WIDTH, 2);
  let y = 151 + (idiv(36 * slot, columns) + 1) - idiv(DESC_BOX_HEIGHT, 2) + idiv(SKI_INV_SLOT_HEIGHT, 2);
  if (y < 0) y = 0;
  if (x + DESC_BOX_WIDTH > SCREEN_WIDTH_640) x = SCREEN_WIDTH_640 - DESC_BOX_WIDTH - DESC_SCREEN_MARGIN;
  else if (x < 0) x = DESC_OFFER_LEFT_X;
  if (y < 13 + 100 + DESC_FACE_GAP && x < DESC_MIN_X_NEAR_FACE) y = DESC_OFFER_Y_NEAR_FACE;
  return { x, y };
}

export function normalEvaluationChance(elapsed: number | null): number {
  if (elapsed === null) return PERCENT;
  for (const [after, chance] of NORMAL_QUOTE_STEPS) if (elapsed > after) return chance;
  return 0;
}

export class ShopPanel {
  readonly model: ShopModel;
  readonly #hooks: ShopPanelHooks;
  readonly #controller: ViewModelController;
  readonly #view: LayoutView;
  #shop: ShopView | null = null;
  #dealer = -1;
  #open = false;
  #face: FaceAnimator | null = null;
  #subtitle: Subtitle | null = null;
  #now = 0;
  #highlight: string | null = null;
  readonly #quoteOfLine = new Map<number, number>();
  readonly #commonQuotesSaid = new Set<number>();
  #idleSince = 0;
  #randomQuoteDelay = RANDOM_QUOTE_DELAY_MS;
  #idleDue = 0;
  #notEnoughSince = 0;

  constructor(hooks: ShopPanelHooks) {
    this.#hooks = hooks;
    this.model = new ShopModel({
      command: (cmd) => hooks.command(cmd),
      shop: () => this.#shop,
      isMoney: (item) => hooks.item(item)?.class === 'MONEY',
      text: hooks.text,
      confirm: (text) => this.#ask(text, true),
      alert: async (text) => {
        await this.#ask(text, false);
      },
      speak: (quote) => this.speak(quote),
      shutUp: () => this.shutUp(),
    });
    this.model.clock = () => this.#now;
    this.model.evaluationChance = (elapsed) => hooks.random(PERCENT) < normalEvaluationChance(elapsed);
    this.#controller = new ViewModelController(SHOP_CONTRACT, this.#modelValues(), {
      pageUp: () => this.model.pageUp(),
      pageDown: () => this.model.pageDown(),
      shutUp: () => this.shutUp(),
      dealerPrimary: ([slot = 0]) => this.#dealerPrimary(slot),
      dealerSecondary: ([slot = 0]) => this.#dealerSecondary(slot),
      dealerHover: ([slot = 0, on]) => this.#hover('dealer', slot, on === HOVER_ON),
      dealerOfferPrimary: ([slot = 0]) => this.model.dealerOfferClick(slot, this.#shift()),
      dealerOfferSecondary: ([slot = 0]) => this.#dealerOfferSecondary(slot),
      dealerOfferHover: ([slot = 0, on]) => this.#hover('dealerOffer', slot, on === HOVER_ON),
      playerOfferPrimary: ([slot = 0]) => this.model.playerOfferClick(slot),
      playerOfferSecondary: ([slot = 0]) => this.model.playerOfferSecondary(slot),
      playerOfferHover: ([slot = 0, on]) => this.#hover('playerOffer', slot, on === HOVER_ON),
      transaction: () => void this.model.transaction(),
      done: () => void this.model.done(),
    });
    this.#view = new LayoutView({
      model: hooks.model,
      controller: this.#controller,
      services: hooks.services,
      sliders: hooks.sliders,
      text: hooks.text,
      owner: SHOP_SCREEN,
      custom: {
        shopPage: (list, rect, params) => this.#renderPage(list, rect, params),
        shopFace: (list, rect) => {
          if (this.#face) drawTalkingFace(list, hooks.services.images, this.#face, rect.x, rect.y);
        },
        shopSlots: (list, rect, params) => this.#renderSlots(list, rect, params),
        shopSubtitle: (list, rect) => {
          const subtitle = this.#subtitle;
          if (subtitle) subtitle.box.render(list, rect.x, rect.y);
        },
      },
    });
  }

  get open(): boolean {
    return this.#open;
  }

  get dealer(): number {
    return this.#dealer;
  }

  get controller(): ViewModelController {
    return this.#controller;
  }

  get subtitleText(): string | null {
    return this.#subtitle?.box.request.text ?? null;
  }

  show(shop: ShopView, now: number): void {
    this.#shop = shop;
    this.#dealer = shop.dealer;
    this.#now = now;
    this.#open = true;
    this.#idleSince = now;
    this.#notEnoughSince = now;
    this.#randomQuoteDelay = RANDOM_QUOTE_DELAY_MS;
    this.#idleDue = this.#nextIdleDelay();
    this.#commonQuotesSaid.clear();
    const profile = this.#hooks.profile(shop.dealer);
    this.#face = profile ? new FaceAnimator(bigFaceRecord(profile, null), now, this.#hooks.random) : null;
    if (this.#face) this.#hooks.ensureImage(this.#face.record.path);
    this.model.syncRepaired(shop.repaired ?? []);
    this.#controller.model = this.#modelValues();
    this.#view.build();
    void this.model.requote(false);
  }

  sync(shop: ShopView): void {
    this.#shop = shop;
    this.model.syncRepaired(shop.repaired ?? []);
  }

  hide(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#removeSubtitle();
    this.#hooks.setHeldCursor(null);
    this.#view.dispose();
    this.#face = null;
  }

  lineQueued(lineId: number, quote: number): void {
    this.#quoteOfLine.set(lineId, quote);
  }

  #currentShopLine() {
    const current = this.#hooks.presenter.current;
    return current?.line.surface === SpeechSurface.SHOPKEEPER ? current : null;
  }

  talking(): boolean {
    return this.#currentShopLine() !== null;
  }

  linesLeft(): boolean {
    return this.talking() || this.#hooks.presenter.queued.some((l) => l.surface === SpeechSurface.SHOPKEEPER);
  }

  shutUp(): void {
    if (this.talking()) this.#hooks.presenter.skip(this.#now, true);
  }

  speak(quote: number): boolean {
    if (!this.#open || this.#dealer < 0) return false;
    const current = this.#currentShopLine();
    if (current) {
      const playing = this.#quoteOfLine.get(current.line.id);
      if (playing === undefined || playing >= FLUFF_BELOW) {
        if (quote !== ShopQuoteId.STUFF_ON_TABLE && quote !== ShopQuoteId.CANT_AFFORD) return false;
      }
      this.shutUp();
    }
    const key = textKey(npcDialogueFile(this.#dealer), quote);
    const text = this.#hooks.text.edt(key.file, key.row) ?? '';
    const voice = speechPathForLine({ profile: this.#dealer, textKey: key, recruitedNpcOrRpc: false }, this.#hooks.rpcSpeechPrefixed);
    const line = this.#hooks.presenter.enqueue({
      surface: SpeechSurface.SHOPKEEPER,
      profile: this.#dealer,
      soldier: null,
      text,
      chars: [...text].length,
      voice,
      sector: null,
      keyWait: false,
    });
    this.#quoteOfLine.set(line.id, quote);
    this.#idleSince = this.#now;
    this.#notEnoughSince = this.#now;
    return true;
  }

  update(now: number): void {
    this.#now = now;
    if (!this.#open) return;
    const speaking = this.#hooks.presenter.speaking;
    const mine = speaking?.surface === SpeechSurface.SHOPKEEPER ? speaking : null;
    if (this.#face) {
      const gaps = mine?.file ? (this.#hooks.gaps(mine.file) ?? []) : [];
      this.#face.update(
        now,
        { life: 100 },
        mine ? { playing: mine.playing, elapsedMs: mine.elapsedMs, gaps } : null,
        this.#hooks.services.images,
      );
    }
    this.#syncSubtitle();
    this.#idleQuotes(now);
    const held = this.model.held;
    this.#hooks.setHeldCursor(held ? this.#hooks.item(held.kind === 'pocket' ? held.item : held.offer.item) : null);
    this.#controller.model = this.#modelValues();
    this.#view.update();
  }

  render(list: DrawList): void {
    if (!this.#open) return;
    this.#view.render(list);
  }

  input(event: UiInputEvent): boolean {
    if (!this.#open || (event.kind !== 'keyDown' && event.kind !== 'keyUp' && event.kind !== 'keyRepeat')) return false;
    if (event.key === 'x' && event.modifiers === ALT_MASK) return false;
    if (event.kind !== 'keyDown') return true;
    if (event.key === 'Escape') {
      if (!this.model.cancelHeld()) void this.model.done();
      return true;
    }
    if (event.key === ' ') {
      this.#hooks.nextMerc();
      return true;
    }
    return true;
  }

  describe(): readonly WidgetInfo[] {
    if (!this.#open) return [];
    const subtitle = this.#subtitle;
    const extra: WidgetInfo[] = subtitle
      ? [
          {
            id: 'shopSubtitleRegion',
            kind: 'region',
            rect: { x: subtitle.region.x1, y: subtitle.region.y1, width: subtitle.region.width, height: subtitle.region.height },
            visible: true,
            enabled: subtitle.region.enabled,
            state: null,
            text: subtitle.box.request.text,
            frame: null,
          },
        ]
      : [];
    return [...this.#view.describe(), ...extra];
  }

  pocketClick(soldier: number, slot: number): boolean {
    const s = this.#hooks.view()?.soldiers.find((v) => v.id === soldier);
    const item = s?.inventory?.find((i) => i.slot === slot) ?? null;
    if (!this.#shop?.canTrade.includes(soldier) && !this.model.held) return true;
    this.model.pocketClick(soldier, slot, item?.item ?? null, (this.#hooks.modifiers() & CTRL_MASK) !== 0);
    return true;
  }

  offerCash(soldier: number, slot: number, amount: number | null): boolean {
    return this.model.offerCash(soldier, slot, 'MONEY', amount);
  }

  hatched(soldier: number, slot: number): boolean {
    return this.model.offered(soldier, slot);
  }

  #ask(text: string, yesNo: boolean): Promise<boolean> {
    const geometry = this.#hooks.services.geometry();
    const centering = { x: geometry.stdX, y: geometry.stdY, width: SCREEN_WIDTH_640, height: 339 };
    return this.#hooks.boxes.ask(text, yesNo ? 'yesNo' : 'ok', { centering }).then((r) => r === MessageBoxReturn.YES);
  }

  #shift(): boolean {
    return (this.#hooks.modifiers() & SHIFT_MASK) !== 0;
  }

  #nextIdleDelay(): number {
    return this.#randomQuoteDelay + this.#hooks.random(this.#randomQuoteDelay);
  }

  #idleQuotes(now: number): void {
    if (this.talking() || this.model.busy) {
      this.#idleSince = now;
      return;
    }
    if (this.model.leaveRequested || this.model.reminded) return;
    if (now - this.#notEnoughSince > NOT_ENOUGH_DELAY_MS) {
      if (this.#hooks.random(PERCENT) > NOT_ENOUGH_CHANCE_ABOVE && this.model.notEnoughOnTheTable())
        this.model.speakCosmetic(ShopQuoteId.NOT_ENOUGH_VALUE);
      this.#notEnoughSince = now;
    }
    if (now - this.#idleSince <= this.#idleDue) return;
    this.#idleSince = now;
    this.#idleDue = this.#nextIdleDelay();
    if (this.#hooks.random(PERCENT) >= IDLE_CHANCE) return;
    let quote: number | undefined = this.model.idleQuoteCandidates()[0];
    if (quote === undefined || this.#hooks.random(PERCENT) < PRECISE_OVERRIDE_CHANCE)
      quote = this.#hooks.random(PERCENT) < HALF ? ShopQuoteId.IDLE_1 : ShopQuoteId.IDLE_2;
    if (this.#commonQuotesSaid.has(quote)) return;
    if (this.model.speakCosmetic(quote)) {
      this.#commonQuotesSaid.add(quote);
      this.#randomQuoteDelay += RANDOM_QUOTE_DELAY_INCREASE_MS;
    }
  }

  #syncSubtitle(): void {
    const current = this.#currentShopLine();
    if (!current || !this.#hooks.subtitles()) {
      this.#removeSubtitle();
      return;
    }
    if (this.#subtitle?.lineId === current.line.id) return;
    this.#removeSubtitle();
    const box = new MercTextBox(
      this.#hooks.boxArt,
      { text: quoted(current.line.text), width: SUBTITLE_WIDTH, marginX: 0, marginTop: 0, marginBottom: 0 },
      this.#hooks.boxFonts(),
    );
    const geometry = this.#hooks.services.geometry();
    const x = geometry.stdX + this.#hooks.model.number('SKI_FACE_X');
    const y = geometry.stdY + this.#hooks.model.number('SKI_POSITION_SUBTITLES_Y');
    const region = this.#hooks.services.regions.define({
      x1: x,
      y1: y,
      x2: x + box.width,
      y2: y + box.height,
      priority: Priority.HIGH,
      cursor: 0,
      owner: SHOP_SCREEN,
      id: 'shopSubtitleRegion',
      onButton: (_r, reason) => {
        if (reason & (MouseReason.LBUTTON_UP | MouseReason.RBUTTON_UP)) this.shutUp();
      },
    });
    this.#subtitle = { lineId: current.line.id, box, region };
  }

  #removeSubtitle(): void {
    this.#subtitle?.region.remove();
    this.#subtitle = null;
  }

  #dealerPrimary(slot: number): void {
    this.model.dealerClick(slot, this.#shift());
  }

  #dealerSecondary(slot: number): void {
    const found = this.model.dealerBox(slot);
    if (!found) return;
    this.#describeBox(found.box, dealerBoxDescriptionAt(slot));
  }

  #dealerOfferSecondary(slot: number): void {
    const selection = this.model.dealerOffer[slot];
    if (!selection || this.model.repairs) return;
    const box = this.#shop?.boxes[selection.box];
    if (box) this.#describeBox({ ...box, count: selection.count }, dealerOfferDescriptionAt(slot));
  }

  #describeBox(box: ShopBoxView, at: { x: number; y: number }): void {
    const geometry = this.#hooks.services.geometry();
    this.#hooks.describe(this.#boxItemView(box), { x: geometry.stdX + at.x, y: geometry.stdY + at.y });
  }

  #boxItemView(box: ShopBoxView): InventoryItemView {
    return {
      slot: -1,
      item: box.item,
      index: 0,
      count: box.count,
      status: [box.status],
      ...(box.ammo ? { ammo: box.ammo } : {}),
      ...(box.attachments.length > 0 ? { attachments: box.attachments } : {}),
    };
  }

  #hover(area: Area, slot: number, on: boolean): void {
    if (!on) {
      this.#highlight = null;
      return;
    }
    this.#highlight = this.#itemAt(area, slot);
  }

  #itemAt(area: Area, slot: number): string | null {
    if (area === 'dealer') return this.model.dealerBox(slot)?.box.item ?? null;
    if (area === 'dealerOffer') return this.model.dealerOffer[slot]?.item ?? null;
    const occupant = this.model.playerOffer[slot];
    return occupant ? occupant.item : null;
  }

  #matches(item: string): boolean {
    const highlighted = this.#highlight ? this.#hooks.item(this.#highlight) : null;
    const other = this.#hooks.item(item);
    if (!highlighted || !other) return false;
    const calibre = (gun: CatalogueItem, ammo: CatalogueItem) =>
      gun.weapon?.calibre !== null && gun.weapon?.calibre?.index === ammo.magazine?.calibre.index;
    if (highlighted.class === AMMO_CLASS && other.class === GUN_CLASS && calibre(other, highlighted)) return true;
    if (highlighted.class === GUN_CLASS && other.class === AMMO_CLASS && calibre(highlighted, other)) return true;
    if (other.flags.includes(ATTACHMENT_FLAG)) return highlighted.weapon?.attachments.includes(other.name) ?? false;
    return other.weapon?.attachments.includes(highlighted.name) ?? false;
  }

  #outline(item: string) {
    return this.#matches(item) ? MATCH_OUTLINE : null;
  }

  #ownerFace(owner: number | undefined | null): number | null {
    if (owner === undefined || owner === null || owner < 0) return null;
    const employed = this.#hooks.view()?.soldiers.some((s) => s.team === OUR_TEAM && s.profile === owner) ?? false;
    if (!employed) return null;
    return this.#hooks.profile(owner)?.faceIndex ?? owner;
  }

  #renderPage(list: DrawList, rect: { x: number; y: number; width: number }, params: Readonly<Record<string, unknown>>): void {
    if (this.model.pages === 0) return;
    const model = this.#hooks.model;
    const font = this.#hooks.services.fonts.get(model.font(String(params.font)));
    const colors = { foreground: model.color(params.color as number | string, 0), shadow: 2, background: 0 };
    const text = this.#hooks.text.string('SKI_Text', SKI_TEXT_PAGE) ?? '';
    drawTextToScreen(list, text, rect.x, rect.y + Number(params.labelOffset), rect.width, font, colors, TextFlag.CENTER_JUSTIFIED);
    const numbers = `${this.model.page}/${this.model.pages}`;
    const y = rect.y + fontHeight(font) + Number(params.numberGap);
    drawTextToScreen(list, numbers, rect.x, y, rect.width, font, colors, TextFlag.CENTER_JUSTIFIED);
  }

  #tileFonts() {
    const fonts = this.#hooks.services.fonts;
    const model = this.#hooks.model;
    return {
      price: fonts.get(model.font('SKI_ITEM_DESC_FONT')),
      count: fonts.get(model.font('SKIT_NUMBER_FONT')),
      tiny: fonts.get('TINYFONT1'),
    };
  }

  #renderSlots(list: DrawList, rect: { x: number; y: number }, params: Readonly<Record<string, unknown>>): void {
    const model = this.#hooks.model;
    const slots = model.number(params.slots as string);
    const columns = model.number(params.columns as string);
    const stepX = model.number('SKI_INV_OFFSET_X');
    const stepY = model.number('SKI_INV_OFFSET_Y');
    const ctx = this.#hooks.tileContext(list);
    const fonts = this.#tileFonts();
    const jammed = this.#hooks.text.string('TacticalStr', JAMMED_ITEM_STR) ?? '';
    const repaired = this.#hooks.text.string('SKI_Text', SKI_TEXT_REPAIRED) ?? '';
    const area = params.area as Area;
    const crossOut = typeof params.crossOut === 'string' ? model.asset(params.crossOut).path : null;
    for (let slot = 0; slot < slots; slot++) {
      const x = rect.x + (slot % columns) * stepX;
      const y = rect.y + idiv(slot, columns) * stepY;
      const tile = this.#tile(area, slot);
      if (tile) drawShopTile(ctx, fonts, tile, x, y, jammed, repaired);
      else if (this.#areaDisabled(area)) hatchSlot(list, x, y);
      if (crossOut && this.model.crossedOut(slot)) list.image(crossOut, 0, x + 22, y);
    }
  }

  #areaDisabled(area: Area): boolean {
    if (!this.model.held) return false;
    if (area === 'dealer') return true;
    return area === 'dealerOffer';
  }

  #tile(area: Area, slot: number): ShopTile | null {
    if (area === 'dealer') return this.#dealerTile(slot);
    if (area === 'dealerOffer') return this.model.repairs ? this.#repairTile(slot) : this.#dealerOfferTile(slot);
    return this.#playerTile(slot);
  }

  #dealerTile(slot: number): ShopTile | null {
    const found = this.model.dealerBox(slot);
    if (!found) return null;
    const { box, index } = found;
    const repairs = this.model.repairs;
    const left = repairs ? box.count : this.model.left(index);
    const disabled = this.#areaDisabled('dealer');
    const hatched = disabled || (!repairs && left === 0);
    const price = repairs ? doneWhenString(this.#hooks.text, box.eta ?? null, this.#hooks.view()?.clock?.day ?? 0) : null;
    const unit = !repairs && (!hatched || left !== 0) && box.unitPrice ? sprintMoney(box.unitPrice) : null;
    const stackable = (this.#hooks.item(box.item)?.perPocket ?? 1) > 1;
    return {
      item: box.item,
      count: left,
      status: box.status,
      attachments: box.attachments.map((a) => a.item),
      jammed: false,
      priceText: repairs ? price || null : unit,
      showCount: left > 1 || (left === 1 && stackable && this.model.selected(index)),
      ownerFace: repairs ? this.#ownerFace(box.owner) : null,
      repaired: false,
      hatched,
      outline: this.#outline(box.item),
    };
  }

  #dealerOfferTile(slot: number): ShopTile | null {
    const selection: DealerSelection | null = this.model.dealerOffer[slot] ?? null;
    if (!selection) return null;
    const box = this.#shop?.boxes[selection.box];
    const price = this.model.dealerOfferPrice(slot);
    return {
      item: selection.item,
      count: selection.count,
      status: box?.status ?? 100,
      attachments: (box?.attachments ?? []).map((a) => a.item),
      jammed: false,
      priceText: price ? sprintMoney(price) : null,
      showCount: selection.count > 1,
      ownerFace: null,
      repaired: false,
      hatched: this.#areaDisabled('dealerOffer'),
      outline: this.#outline(selection.item),
    };
  }

  #repairTile(slot: number): ShopTile | null {
    const entry = this.model.quote?.repair[slot];
    if (!entry) return null;
    return {
      item: entry.item,
      count: 1,
      status: 100,
      attachments: [],
      jammed: false,
      priceText: entry.cost ? sprintMoney(entry.cost) : null,
      showCount: false,
      ownerFace: this.#ownerFace(entry.owner),
      repaired: false,
      hatched: this.#areaDisabled('dealerOffer'),
      outline: this.#outline(entry.item),
    };
  }

  #pocket(offer: PocketOffer): InventoryItemView | null {
    const s = this.#hooks.view()?.soldiers.find((v) => v.id === offer.soldier);
    return s?.inventory?.find((i) => i.slot === offer.slot) ?? null;
  }

  #playerTile(slot: number): ShopTile | null {
    const occupant = this.model.playerOffer[slot];
    if (!occupant) return null;
    if (occupant.kind === 'repaired')
      return {
        item: occupant.item,
        count: 1,
        status: occupant.status,
        attachments: [],
        jammed: false,
        priceText: null,
        showCount: false,
        ownerFace: this.#ownerFace(occupant.owner),
        repaired: true,
        hatched: false,
        outline: this.#outline(occupant.item),
      };
    const pocket = this.#pocket(occupant);
    const value = occupant.cash ? (occupant.amount ?? pocket?.money ?? 0) : this.model.offerValue(slot);
    const s = this.#hooks.view()?.soldiers.find((v) => v.id === occupant.soldier);
    return {
      item: occupant.item,
      count: pocket?.count ?? 1,
      status: pocket?.status[0] ?? 100,
      attachments: (pocket?.attachments ?? []).map((a) => a.item),
      jammed: pocket?.jammed === true,
      priceText: value > 0 ? sprintMoney(value) : null,
      showCount: (pocket?.count ?? 1) > 1,
      ownerFace: this.#ownerFace(s?.profile),
      repaired: false,
      hatched: false,
      outline: this.#outline(occupant.item),
    };
  }

  #tips(area: Area, count: number): string[] {
    return Array.from({ length: count }, (_, slot) => this.#tip(area, slot));
  }

  #tip(area: Area, slot: number): string {
    const help = this.#hooks.helpText;
    if (area === 'dealer') {
      const found = this.model.dealerBox(slot);
      return found ? help(this.#boxItemView(found.box)) : '';
    }
    if (area === 'dealerOffer') {
      if (this.model.repairs) {
        const entry = this.model.quote?.repair[slot];
        if (!entry) return '';
        const time = repairTimeString(this.#hooks.text, entry.minutes);
        return `${help({ slot: -1, item: entry.item, index: 0, count: 1, status: [100] })}\n(${this.#hooks.text.string('gzLateLocalizedString', STR_LATE_44) ?? ''}: ${time})`;
      }
      const selection = this.model.dealerOffer[slot];
      const box = selection ? this.#shop?.boxes[selection.box] : undefined;
      return box && selection ? help({ ...this.#boxItemView(box), count: selection.count }) : '';
    }
    const occupant = this.model.playerOffer[slot];
    if (!occupant) return '';
    if (occupant.kind === 'repaired') return help({ slot: -1, item: occupant.item, index: 0, count: 1, status: [occupant.status] });
    const pocket = this.#pocket(occupant);
    return pocket ? help(occupant.cash && occupant.amount !== null ? { ...pocket, money: occupant.amount } : pocket) : '';
  }

  #modelValues(): Record<string, unknown> {
    const quote = this.model.quote;
    const enable = this.model.enableState();
    const held = this.model.held !== null;
    const describing = this.#hooks.descriptionOpen();
    return {
      costLabel: this.model.repairs ? 'repair' : 'cost',
      transactionTip:
        this.#hooks.text.string(
          'SkiMessageBoxText',
          this.model.repairs ? SKI_REPAIR_TRANSACTION_BUTTON_HELP_TEXT : SKI_TRANSACTION_BUTTON_HELP_TEXT,
        ) ?? '',
      balance: this.#shop?.balance ?? 0,
      totalCost: quote?.totals.cost ?? 0,
      totalValue: quote?.totals.value ?? 0,
      pageUpEnabled: !describing && this.model.pageUpEnabled(),
      pageDownEnabled: !describing && this.model.pageDownEnabled(),
      transactionEnabled: !describing && enable.transaction,
      doneEnabled: !describing && enable.done && !this.model.leaveRequested,
      dealerSlotsEnabled: !describing && !held,
      dealerOfferEnabled: !describing && (!held || this.model.repairs),
      playerOfferEnabled: !describing,
      dealerTips: this.#tips('dealer', DEALER_SLOTS),
      dealerOfferTips: this.#tips('dealerOffer', OFFER_SLOTS),
      playerOfferTips: this.#tips('playerOffer', OFFER_SLOTS),
    };
  }
}

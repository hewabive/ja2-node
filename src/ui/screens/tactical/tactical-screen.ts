// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Control.cc SetNewPanel, HandleTacticalPanelSwitch, RenderTacticalInterface,
// @src RenderTopmostTacticalInterface (the popups, the viewport overlays, the clock, the buttons, the paused box);
// @src src/game/Tactical/Interface.cc SetCurrentTacticalPanelCurrentMerc (non-merc bodies and escorts force the team
// @src panel), ToggleTacticalPanels; src/game/Tactical/Interface_Panels.cc InitializeTEAMPanel, InitializeSMPanel
// @src (the viewport region ends at the panel), DrawFillerOnSurface, FillEmptySpaceAtBottom, CheckForAndAddMercToTeamPanel,
// @src HandleLocateSelectMerc (locate, slide or select; ALT only locates; below OKLIFE only locates), SelectMerc,
// @src HandlePanelFaceAnimations (p_close.sti and p_dead.sti frames 0 to 5 every 160 ms), RenderTeamSlotBorder,
// @src RenderSoldierTeamInv, SMInvClickCamoCallback; src/game/Tactical/Faces.cc HandleAutoFaces (the white highlight of
// @src the soldier under the pointer, the moving highlight); src/game/TileEngine/Radar_Screen.cc RenderRadarScreen (the
// @src darkened night image, the viewport rectangle, 2 × 2 dots by team with the overrides, the selected merc blinking
// @src every RADAR_MAP_BLINK), RenderSquadList, CreateDestroyMouseRegionsForSquadList, TacticalSquadList*Callback;
// @src src/game/Strategic/Game_Clock.cc HandlePlayerPauseUnPauseOfGame; Interface_Items.cc HandleItemPointerClick (give
// @src to the soldier under the pointer, else drop); Handle_UI.cc UIHandleInteractiveTilesAndItemsOnTerrain (one item
// @src picked up at once, the pickup menu for several); Interface.cc EndUIMessage (a key or click closes the feedback
// @src box); src/game/Tactical/Squads.cc SetCurrentSquad, RebuildCurrentSquad (only a rebuilt panel drops a dead merc's
// @src slot), UpdateCurrentlySelectedMerc (the next able merc of the squad after the skull, else nobody). See docs/28 §5, §6.

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { ItemInfo } from '../../../protocol/hints.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { InventoryItemView, ItemView, PlayerView, SoldierView, ViewFrame } from '../../../protocol/view.ts';
import { CursorId, EXTERN_CURSOR } from '../../cursors/cursor-ids.ts';
import { type Area, type DrawList, rgb } from '../../draw-list.ts';
import { isPointerEvent, type UiInputEvent } from '../../input/events.ts';
import { MouseButtonMask, MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { Variables } from '../../layout/constants.ts';
import { frameRect, INV_INTERFACE_HEIGHT, TEAMPANEL_HEIGHT, TEAMPANEL_SLOT_WIDTH, teamPanelSlots } from '../../layout/frames.ts';
import { textBoxArt } from '../../layout/styles.ts';
import type { CustomRenderer } from '../../layout/view.ts';
import { LayoutView } from '../../layout/view.ts';
import type { Screen } from '../../screen.ts';
import { fontHeight } from '../../text/bitmap-font.ts';
import { FontName } from '../../text/fonts.ts';
import { hCenterVCenterAlign } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { printf } from '../../text/printf.ts';
import { UiScreenKind } from '../../widgets/button-sounds.ts';
import { MercTextBox } from '../../widgets/merc-text-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { DialogueLayer } from '../talk/dialogue-layer.ts';
import { drawBarsInUiBox, drawSoldierBars } from './bars.ts';
import { type CommandReply, type TacticalEnvironment, TacticalLayout } from './environment.ts';
import {
  drawFace,
  drawFaceHighlights,
  FaceAnimator,
  type FaceArt,
  type FaceDrawContext,
  faceRecordOf,
  MOVING_HILIGHT,
  NO_HILIGHT,
  OKLIFE,
  STEALTH_MOVING_HILIGHT,
  WHITE_HILIGHT,
} from './faces.ts';
import { HudController, hudClockText, pauseHelpText, sectorOfMap } from './hud.ts';
import { UiEvent, UiMode } from './input/ui-events.ts';
import { type InventoryArt, InventoryPanel, type SlotRect, slotRects } from './inventory.ts';
import { dropCommand, giveCommand, type ItemCursor, slotItem } from './item-cursor.ts';
import { type DescriptionGeometry, ItemDescriptionBox } from './item-description.ts';
import { KeyRingPopup, StackPopup } from './item-popups.ts';
import { drawInventoryItem, type TileDrawContext } from './item-tile.ts';
import { formatMessageEntry, showsInTacticalLog } from './message-format.ts';
import { lineHeightOf, TacticalMessageLog } from './message-log.ts';
import { MoneyActions } from './money-actions.ts';
import {
  aboveGuyPosition,
  DamageNumber,
  FeedbackBox,
  healthString,
  Locator,
  printAboveGuy,
  SHOW_LOCATOR_FAST_CYCLES,
  SHOW_LOCATOR_NORMAL_CYCLES,
  showsDamage,
  TOP_BAR_HEIGHT,
  TopBar,
} from './overlays.ts';
import { type PanelState, type StatFlash, smPanelModel, teamPanelModel } from './panel-models.ts';
import { ItemPickupMenu } from './pickup-menu.ts';
import { SmPanelController, STAT_KEYS, type Stance, type StatKey } from './sm-panel.ts';
import {
  barValues,
  inCombat,
  isDead,
  isEpc,
  isInVehicle,
  isMercBodyType,
  nextMerc,
  nextSquadMateAfterDeath,
  OUR_TEAM,
  okInterrupt,
  ourTurn,
  ownSoldiers,
  soldierById,
  squadOf,
} from './soldiers.ts';
import { type ControlsArt, type ControlsScreen, type PanelButton, TacticalControls } from './tactical-controls.ts';
import { TeamPanelController } from './team-panel.ts';

export const TACTICAL_SCREEN = 'tactical';
const PANEL_FACE_FRAME_MS = 160;
const CLOSE_PANEL_LAST_FRAME = 5;
const ALT_MASK = 4;
const SHIFT_MASK = 1;
const MERC_IS_UNAVAILABLE_STR = 82;
const BASE_TEAM_SLOTS = 6;
const RADAR_REGION = 'radarRegion';
const ESCAPE_KEY = 'Escape';
const PAUSE_KEY = 'Pause';
const PANEL_TOGGLE_KEY = '`';
const KEY_RING_KEY = 'k';
const LOCATOR_OFFSET = 25;
const DAMAGE_OFFSET_X = 20;
const DAMAGE_OFFSET_Y = -5;
const RADAR_MAP_BLINK_MS = 400;
const NUMBER_OF_SQUADS = 20;
const SQUAD_COLUMNS = 2;
const MSG_INTERFACE_LOG_Y = 150;
const CONTINUE_OVER_FACE_STR = 63;
const STR_LATE_34 = 33;
const STR_LATE_15 = 14;
const TICK_MS = 5;
const ON_ROOF_COLOUR = rgb(150, 150, 0);
const UNCONSCIOUS_COLOUR = rgb(128, 128, 128);
const HOSTILE_CIVILIAN_COLOUR = rgb(255, 0, 0);
const NAMED_CIVILIAN_COLOUR = rgb(85, 85, 255);
const RADAR_VIEW_COLOUR = rgb(0, 255, 0);
const TEAM_RADAR_COLOURS: readonly number[] = [
  rgb(255, 255, 0),
  rgb(255, 0, 0),
  rgb(255, 0, 255),
  rgb(0, 255, 0),
  rgb(255, 255, 255),
  rgb(0, 0, 255),
];
const CIV_TEAM = 4;
const HANDPOS = 5;
const UNDER_GLAUNCHER = 'UNDER_GLAUNCHER';
const UI_VERSION = '0.8.0';

type PanelKind = 'team' | 'sm';
const DESCRIBED_BUTTON_OWNERS: ReadonlySet<string> = new Set(['itemDescription', 'itemPickupMenu', 'tacticalMenus', 'tacticalExitDialog']);
type FrameEvent = NonNullable<ViewFrame['events']>[number];

interface PanelFaceAnimation {
  closeFrame: number;
  deadFrame: number;
  dead: boolean;
  finished: boolean;
  since: number;
}

export class TacticalScreen implements Screen {
  readonly id = TACTICAL_SCREEN;
  readonly soundScreen = UiScreenKind.GAME;
  readonly rendersTooltips = true;
  readonly drawsWorld = true;
  readonly #env: TacticalEnvironment;
  readonly #team: TeamPanelController;
  readonly #sm: SmPanelController;
  readonly #hud: HudController;
  readonly #hudView: LayoutView;
  readonly #teamView: LayoutView;
  readonly #smView: LayoutView;
  readonly #faces = new Map<number, FaceAnimator>();
  readonly #flashes = new Map<number, Map<StatKey, StatFlash>>();
  readonly #damage = new Map<number, DamageNumber>();
  readonly #locators = new Map<number, Locator>();
  readonly #log = new TacticalMessageLog();
  readonly #topBar = new TopBar();
  readonly #feedback = new FeedbackBox();
  readonly inventory: InventoryPanel;
  readonly description: ItemDescriptionBox;
  readonly stack: StackPopup;
  readonly keyRing: KeyRingPopup;
  readonly pickup: ItemPickupMenu;
  readonly dialogue: DialogueLayer;
  readonly #money: MoneyActions;
  readonly controls: TacticalControls;
  #panel: PanelKind = 'team';
  #pendingPanel: { kind: PanelKind; soldier: number | null } | null = null;
  #smMerc: number | null = null;
  #selected: number | null = null;
  #nobodySelected = false;
  #squad = 0;
  #slotsSquad: number | null = null;
  #slots: (number | null)[] = [];
  readonly #fallen = new Map<number, SoldierView>();
  readonly #lastSeen = new Map<number, SoldierView>();
  readonly #panelAnimations = new Map<number, PanelFaceAnimation>();
  readonly #lastEnemyCycled = new Map<number, number>();
  #externCursor = false;
  #radarShown = true;
  #radarPressed = false;
  #squadRegions: MouseRegion[] = [];
  #hoveredSquad = -1;
  #viewportRegion: MouseRegion | null = null;
  #hoveredFace: number | null = null;
  #hoveredSoldier: number | null = null;
  #interfaceLevel = 0;
  #now = 0;
  #radarBlink = false;
  #radarBlinkAt = 0;
  #entered = false;
  #lastInventories = new Map<number, readonly InventoryItemView[]>();
  #descriptionOrigin: { readonly x: number; readonly y: number } | null = null;

  constructor(env: TacticalEnvironment) {
    this.#env = env;
    this.#team = new TeamPanelController({
      selectFace: (slot) => this.#selectFace(slot),
      openSmPanel: (slot) => this.#openSmPanelFromSlot(slot),
      faceHover: (slot, on) => {
        this.#hoveredFace = on ? (this.#slots[slot] ?? null) : null;
      },
      enemyIndicator: (slot) => this.#enemyIndicator(this.#slots[slot] ?? null),
      swapHands: (slot) => this.#swapHands(this.#slots[slot] ?? null),
      endTurn: () => void this.#command({ type: 'endTurn' }),
      mapScreen: () => env.flow.mapScreen(),
      toggleSquadList: () => this.#toggleSquadList(),
    });
    this.#sm = new SmPanelController((action, args) => this.#smAction(action, args));
    this.#hud = new HudController({
      radarPress: () => this.#radarPress(),
      radarHover: (on) => {
        if (!on) this.#radarPressed = false;
      },
      togglePause: () => this.#togglePause(),
      options: () => env.flow.options(),
      saveGame: () => env.flow.saveGame(),
      loadGame: () => env.flow.loadGame(),
      exitGame: () => env.flow.exitGame(),
    });
    this.inventory = new InventoryPanel({
      env,
      smSoldier: () => this.#smSoldier(),
      select: (id) => this.select(id, false),
      openDescription: (soldier, slot, index) => this.#openDescription(soldier, slot, index),
      openStackPopup: (soldier, slot) => this.#openStackPopup(soldier, slot),
      descriptionOpen: () => this.description.open,
      popupOpen: () => this.stack.open || this.keyRing.open,
      disabledForItems: () => this.#disabledForItems(),
      inCombat: () => inCombat(this.#view()),
      extraHatch: (soldier, slot) => this.dialogue?.shopHatched(soldier, slot) === true,
    });
    const popupHooks = {
      services: env.runtime,
      images: env.runtime.images,
      soldier: (id: number) => soldierById(this.#view(), id),
      item: (name: string) => env.media.item(name),
      cursor: () => this.inventory.cursor,
      setCursor: (cursor: ItemCursor | null) => this.inventory.setCursor(cursor),
      send: (cmd: Parameters<InventoryPanel['send']>[0]) => this.inventory.send(cmd),
      describe: (soldier: number, slot: number, index: number) => this.#openDescription(soldier, slot, index),
      describeKey: (soldier: number, key: number) => this.#showDescription({ kind: 'key', soldier, key }),
      cellArt: this.#asset(TacticalLayout.SINGLE_MERC, 'extraInventory'),
      keyItem: (key: Parameters<TacticalEnvironment['media']['keyItem']>[0]) => env.media.keyItem(key),
    };
    this.stack = new StackPopup(popupHooks);
    this.keyRing = new KeyRingPopup(popupHooks);
    this.description = new ItemDescriptionBox({
      services: env.runtime,
      text: env.text,
      soldier: (id) => soldierById(this.#view(), id),
      item: (name) => env.media.item(name),
      itemInfo: (object) => this.#itemInfo(object),
      cursor: () => this.inventory.cursor,
      setCursor: (cursor) => this.inventory.setCursor(cursor),
      placements: () => this.inventory.placements(),
      send: (cmd) => this.inventory.send(cmd),
      confirm: (text) => env.boxes.confirm(text),
      metric: () => env.metric(),
      keyItem: (key) => env.media.keyItem(key),
      closed: () => undefined,
      moneyDone: (object, amount) => this.#money.done(object, amount),
      alert: (text) => env.boxes.alert(text),
    });
    this.pickup = new ItemPickupMenu({
      services: env.runtime,
      images: env.runtime.images,
      text: env.text,
      art: this.#asset(TacticalLayout.SINGLE_MERC, 'itemBox'),
      item: (name) => env.media.item(name),
      tileImage: (item) => env.world.itemTile(item),
      pickUp: (soldier, gridNo, level, items) => void this.#command({ type: 'pickUp', soldier, gridNo, zLevel: level, items }),
      closed: () => undefined,
      hover: () => undefined,
    });
    this.#money = new MoneyActions({
      env,
      inventory: this.inventory,
      view: () => this.#view(),
      smSoldier: () => this.#smSoldier(),
      disabled: () => this.#disabledForItems(),
      shopOpen: () => this.dialogue.shopOpen,
      offerCash: (soldier, slot, amount) => this.dialogue.shop.offerCash(soldier, slot, amount),
      showBalance: (soldier, amount) => {
        this.stack.close();
        this.#showDescription({ kind: 'balance', soldier, amount });
      },
    });
    this.dialogue = new DialogueLayer(env, {
      drawSoldierFace: (list, s, x, y) => this.#drawPanelFace(list, s, x, y, false),
      drawBars: (list, values, x, y) =>
        drawSoldierBars(list, values, x, y, { asset: this.#asset(TacticalLayout.HUD, 'bars'), gold: false }),
      barValues: (s) => barValues(s),
      viewport: () => this.#viewportBounds(),
      openInventory: (soldier) => this.#requestPanel('sm', soldier),
      sector: () => sectorOfMap(this.#view()?.mapPath ?? null),
      smMerc: () => this.#pendingPanel?.soldier ?? this.#smMerc,
      nextMerc: () => this.#stepMerc(1),
      describeItem: (view, at) => this.#describeAt(view, at),
      descriptionOpen: () => this.description.open,
    });
    const custom = this.#renderers();
    const common = { services: env.runtime, sliders: env.runtime.sliders, text: env.text, custom };
    this.#hudView = new LayoutView({ ...common, model: env.layout(TacticalLayout.HUD), controller: this.#hud, owner: 'tacticalHud' });
    this.#teamView = new LayoutView({ ...common, model: env.layout(TacticalLayout.TEAM), controller: this.#team, owner: 'tacticalTeam' });
    this.#smView = new LayoutView({ ...common, model: env.layout(TacticalLayout.SINGLE_MERC), controller: this.#sm, owner: 'tacticalSm' });
    this.controls = new TacticalControls(this.#controlsScreen(), this.#controlsArt());
  }

  #controlsArt(): ControlsArt {
    const model = this.#env.layout(TacticalLayout.INPUT);
    const asset = (name: string) => model.asset(name).path;
    return {
      menus: { frame: asset('buttonFrame'), icons: asset('newIcons'), doorIcons: asset('doorIcons') },
      exit: {
        box: textBoxArt(model, model.style('dialogTextBox')),
        radio: asset('popupRadio'),
        check: asset('popupCheck'),
        buttons: asset('popupButtons'),
      },
      overhead: { border: asset('mapBorder'), persons: asset('persons') },
      burst: asset('burst'),
    };
  }

  #controlsScreen(): ControlsScreen {
    const env = this.#env;
    return {
      env,
      version: UI_VERSION,
      selected: () => soldierById(this.#view(), this.#selected),
      select: (s, acknowledge, fromUi) => this.#selectSoldier(s, acknowledge, fromUi),
      interfaceLevel: () => this.#interfaceLevel,
      setInterfaceLevel: (level) => this.#setInterfaceLevel(level),
      itemInCursor: () => this.inventory.cursor !== null,
      itemPointerClick: (_gridNo, target) => this.#itemPointerClick(target),
      pickUp: (s, gridNo, level) => this.#pickUpAt(s, gridNo, level),
      feedback: (text) => this.#localFeedback(text, FontColor.MCOLOR_LTYELLOW),
      log: (text) => this.#log.push(text, FontColor.MCOLOR_LTYELLOW, env.runtime.fonts.get(FontName.TINYFONT1)),
      currentSquad: () => this.#squad,
      changeSquad: (squad) => this.#changeSquad(squad),
      squadSoldiers: () => this.#teamMembers(),
      slotSoldiers: () => this.#slots.map((id) => this.#slotSoldier(id)),
      send: (cmd) => this.#send(cmd),
      panel: () => this.#panel,
      requestTeamPanel: () => this.#requestPanel('team', null),
      panelButtonEnabled: (button) => this.#panelButtonEnabled(button),
      popupsOpen: () => this.pickup.open || this.description.open || this.stack.open || this.keyRing.open,
      closePopups: () => this.#closePopups(),
      locate: (s, cycles) => this.#locateSoldier(s, cycles),
      locateSelect: (s, force) => this.#locateSelect(s, force),
      clearMessages: (queue) => (queue ? this.#log.clearQueue() : this.#log.clearShown()),
      swapHands: (id) => this.#swapHands(id),
      viewportTop: () => (this.#view()?.combat?.topMessage ? TOP_BAR_HEIGHT : 0),
      viewportBottom: () => this.#viewportBottom(),
      viewportRegion: () => this.#viewportRegion,
      dismissFeedback: () => this.#dismissFeedback(),
      closeCivQuote: () => this.dialogue.closeCivQuoteIfActive(),
      radarBlink: () => this.#radarBlink,
    };
  }

  #viewportBottom(): number {
    return this.#env.runtime.geometry().height - (this.#panel === 'team' ? TEAMPANEL_HEIGHT : INV_INTERFACE_HEIGHT);
  }

  async #send(cmd: CommandEnvelope): Promise<CommandReply> {
    return this.inventory.send(cmd as Parameters<InventoryPanel['send']>[0]);
  }

  #dismissFeedback(): boolean {
    if (this.#feedback.text === null) return false;
    this.#feedback.end(this.#now);
    return true;
  }

  #closePopups(): void {
    if (this.pickup.open) this.pickup.close(true);
    if (this.description.open) this.description.close(true);
    this.stack.close();
    this.keyRing.close();
  }

  #changeSquad(squad: number): boolean {
    const members = ownSoldiers(this.#view()).filter((s) => squadOf(s) === squad && !isInVehicle(s) && !isDead(s));
    if (members.length === 0) return false;
    this.#squad = squad;
    const selected = soldierById(this.#view(), this.#selected);
    const first = members[0];
    if ((!selected || squadOf(selected) !== squad) && first) this.#selectSoldier(first, false, false);
    return true;
  }

  #locateSelect(s: SoldierView, force: boolean): void {
    if (!force) {
      this.#locateSoldier(s, SHOW_LOCATOR_NORMAL_CYCLES);
      return;
    }
    this.#handleLocateSelect(s);
  }

  #panelButtonEnabled(button: PanelButton): boolean {
    if (this.#panel === 'team') {
      const team = this.#team.model;
      if (button === 'done') return team.endTurnEnabled;
      if (button === 'map') return team.mapScreenEnabled;
      if (button === 'squad') return team.squadEnabled;
      return true;
    }
    const sm = this.#sm.model;
    switch (button) {
      case 'updown':
        return sm.levelEnabled;
      case 'nextMerc':
        return sm.nextEnabled;
      case 'burst':
        return sm.burstEnabled;
      case 'look':
        return sm.lookEnabled;
      case 'done':
        return sm.doneEnabled;
      case 'map':
        return sm.mapScreenEnabled;
      case 'options':
        return sm.optionsEnabled;
      case 'stealth':
        return sm.stealthEnabled;
      default:
        return true;
    }
  }

  #itemPointerClick(target: SoldierView | null): void {
    const cursor = this.inventory.cursor;
    if (!cursor) return;
    const holder = cursor.source.soldier;
    if (target && target.id !== holder) {
      const cmd = giveCommand(cursor, target.id);
      if (cmd) void this.inventory.send(cmd).then((r) => r.ok && this.inventory.setCursor(null));
      return;
    }
    const drop = dropCommand(cursor);
    if (drop) void this.inventory.send(drop).then((r) => r.ok && this.inventory.setCursor(null));
    else this.inventory.setCursor(null);
  }

  #pickUpAt(picker: SoldierView, gridNo: number, level: number): void {
    const items = (this.#view()?.items ?? []).filter((i) => i.gridNo === gridNo && i.level === level && !i.notRendered);
    if (items.length === 0) return;
    if (items.length === 1) {
      void this.#command({ type: 'pickUp', soldier: picker.id, gridNo, zLevel: level });
      return;
    }
    const regions = this.#env.runtime.regions;
    this.#openPickupMenu(picker, gridNo, items, { x: regions.mouseX, y: regions.mouseY });
  }

  #burstCapable(s: SoldierView | null): boolean {
    const hand = s?.inventory?.find((i) => i.slot === HANDPOS);
    if (!hand) return false;
    const item = this.#env.media.item(hand.item);
    return (item?.weapon?.shotsPerBurst ?? 0) > 0 || (hand.attachments ?? []).some((a) => a.item === UNDER_GLAUNCHER);
  }

  #cursorModeOf(): PanelState['cursorMode'] {
    switch (this.controls.input.mode) {
      case UiMode.HANDCURSOR_MODE:
        return 'hand';
      case UiMode.TALKCURSOR_MODE:
        return 'talk';
      case UiMode.LOOKCURSOR_MODE:
        return 'look';
      default:
        return 'none';
    }
  }

  get panel(): PanelKind {
    return this.#panel;
  }

  get selected(): number | null {
    return this.#selected;
  }

  get smMerc(): number | null {
    return this.#smMerc;
  }

  get currentSquad(): number {
    return this.#squad;
  }

  get radarShown(): boolean {
    return this.#radarShown;
  }

  get teamSlots(): readonly (number | null)[] {
    return this.#slots;
  }

  get messageLines(): readonly string[] {
    return this.#log.lines.map((l) => l.text);
  }

  get enemyBar(): { readonly counter: number; readonly max: number } {
    return { counter: this.#topBar.counter, max: this.#topBar.max };
  }

  get feedbackText(): string | null {
    return this.#feedback.text;
  }

  faceOf(id: number): FaceAnimator | null {
    return this.#faces.get(id) ?? null;
  }

  #view(): PlayerView | null {
    return this.#env.client.view;
  }

  #asset(layout: TacticalLayout, name: string): string {
    return this.#env.layout(layout).asset(name).path;
  }

  #smSoldier(): SoldierView | null {
    return soldierById(this.#view(), this.#smMerc);
  }

  #disabledForItems(): boolean {
    return this.pickup.open || this.dialogue?.shopDisablesInventory(this.#smMerc) === true;
  }

  #panelView(): LayoutView {
    return this.#panel === 'team' ? this.#teamView : this.#smView;
  }

  enter(): void {
    this.#entered = true;
    this.#nobodySelected = false;
    this.#rebuildSlots();
    this.#chooseInitialSelection();
    this.#hudView.build();
    this.#panelView().build();
    this.#defineViewportRegion();
    this.#syncViewport();
    this.dialogue.enter();
    if (this.#selected !== null) this.#selectedChanged();
  }

  exit(): void {
    this.#entered = false;
    this.dialogue.dispose();
    this.controls.exit();
    this.description.close(false);
    this.stack.close();
    this.keyRing.close();
    this.pickup.close(false);
    this.inventory.setCursor(null);
    this.#removeSquadRegions();
    this.#viewportRegion?.remove();
    this.#viewportRegion = null;
    this.#hudView.dispose();
    this.#teamView.dispose();
    this.#smView.dispose();
  }

  #chooseInitialSelection(): void {
    const own = ownSoldiers(this.#view());
    if (this.#selectionStands(own)) return;
    const first = own.find((s) => !isDead(s)) ?? own[0] ?? null;
    this.#selected = first?.id ?? null;
    if (first) {
      this.#squad = squadOf(first);
      this.#selectedChanged();
    }
  }

  #selectionStands(own: readonly SoldierView[]): boolean {
    if (this.#selected === null) return this.#nobodySelected;
    return this.#fallen.has(this.#selected) || own.some((s) => s.id === this.#selected);
  }

  #defineViewportRegion(): void {
    this.#viewportRegion?.remove();
    const { width, height } = this.#env.runtime.geometry();
    const bottom = height - (this.#panel === 'team' ? TEAMPANEL_HEIGHT : INV_INTERFACE_HEIGHT);
    this.#viewportRegion = this.#env.runtime.regions.define({
      x1: 0,
      y1: 0,
      x2: width,
      y2: bottom,
      priority: Priority.NORMAL,
      cursor: 0,
      owner: 'tacticalViewport',
      id: 'tacticalViewport',
      onButton: (_r, reason) => this.#viewportButton(reason),
    });
    this.#viewportRegion.showsMouseText = true;
  }

  #viewportBounds(): { top: number; bottom: number } {
    const { height } = this.#env.runtime.geometry();
    const top = this.#view()?.combat?.topMessage ? TOP_BAR_HEIGHT : 0;
    return { top, bottom: height - (this.#panel === 'team' ? TEAMPANEL_HEIGHT : INV_INTERFACE_HEIGHT) };
  }

  #syncViewport(): void {
    const { top, bottom } = this.#viewportBounds();
    this.#env.world.setViewport(top, bottom);
  }

  select(id: number, acknowledge: boolean): void {
    const s = soldierById(this.#view(), id);
    if (s) this.#selectSoldier(s, acknowledge, false);
  }

  #selectSoldier(s: SoldierView, acknowledge: boolean, fromUi: boolean): void {
    if (s.team !== OUR_TEAM || isDead(s)) return;
    if (inCombat(this.#view()) && !okInterrupt(s)) {
      if (fromUi)
        this.#localFeedback(
          printf(this.#env.text.string('TacticalStr', MERC_IS_UNAVAILABLE_STR) ?? '', [s.name]),
          FontColor.MCOLOR_LTYELLOW,
        );
      return;
    }
    if (s.id === this.#selected) return;
    if (this.#selected !== null) this.#locators.delete(this.#selected);
    this.#selected = s.id;
    this.#nobodySelected = false;
    this.#squad = squadOf(s);
    if (this.#panel === 'sm') this.#requestPanel('sm', s.id);
    if (acknowledge) this.#env.sounds.attention(s.id);
    this.#selectedChanged();
    this.#setInterfaceLevel(s.level);
  }

  #selectedChanged(): void {
    if (ourTurn(this.#view()) && this.controls.lockState() === 'none') this.controls.input.override(UiEvent.M_ON_TERRAIN);
  }

  #setInterfaceLevel(level: number): void {
    this.#interfaceLevel = level > 0 ? 1 : 0;
    this.#env.world.setRoofLevel(this.#interfaceLevel > 0);
  }

  #localFeedback(text: string, colour: number): void {
    this.#log.push(text, colour, this.#env.runtime.fonts.get(FontName.TINYFONT1));
    this.#beginFeedback(text, false);
  }

  #requestPanel(kind: PanelKind, soldier: number | null): void {
    this.#pendingPanel = { kind, soldier };
  }

  #applyPanelSwitch(): void {
    const pending = this.#pendingPanel;
    if (!pending) return;
    this.#pendingPanel = null;
    let kind = pending.kind;
    const s = soldierById(this.#view(), pending.soldier);
    if (kind === 'sm' && (!s || !isMercBodyType(s) || isEpc(s))) kind = 'team';
    if (kind === 'sm' && s) this.#smMerc = s.id;
    if (kind === this.#panel) return;
    if (this.description.open) this.description.close(false);
    this.stack.close();
    this.keyRing.close();
    this.#panelView().dispose();
    this.#panel = kind;
    if (this.#entered) {
      this.#panelView().build();
      this.#defineViewportRegion();
      this.#syncViewport();
    }
  }

  togglePanels(): void {
    this.#requestPanel(this.#panel === 'sm' ? 'team' : 'sm', this.#panel === 'sm' ? null : this.#selected);
  }

  #teamMembers(): SoldierView[] {
    const view = this.#view();
    return ownSoldiers(view).filter((s) => squadOf(s) === this.#squad && !isInVehicle(s));
  }

  #syncSlots(): void {
    if (this.#slotsSquad !== this.#squad) this.#rebuildSlots();
    const count = this.#slotCount();
    const members = this.#teamMembers().map((s) => s.id);
    const next: (number | null)[] = this.#slots.slice(0, count);
    while (next.length < count) next.push(null);
    for (let i = 0; i < next.length; i++) {
      const id = next[i] ?? null;
      if (id !== null && !members.includes(id) && !this.#fallen.has(id)) next[i] = null;
    }
    for (const id of members) {
      if (next.includes(id)) continue;
      const free = next.indexOf(null);
      if (free >= 0) next[free] = id;
    }
    this.#slots = next;
  }

  #rebuildSlots(): void {
    this.#slotsSquad = this.#squad;
    this.#slots = [];
    this.#fallen.clear();
  }

  #slotSoldier(id: number | null): SoldierView | null {
    if (id === null) return null;
    return soldierById(this.#view(), id) ?? this.#fallen.get(id) ?? null;
  }

  #slotCount(): number {
    return teamPanelSlots(this.#env.runtime.geometry().width);
  }

  #animationRunning(id: number): boolean {
    const a = this.#panelAnimations.get(id);
    return a !== undefined && !a.finished;
  }

  #startDeathAnimation(id: number): void {
    if (this.#panelAnimations.has(id)) return;
    this.#panelAnimations.set(id, { closeFrame: 0, deadFrame: 0, dead: false, finished: false, since: this.#now });
  }

  #soldierDied(id: number): void {
    const s = soldierById(this.#view(), id) ?? this.#lastSeen.get(id) ?? null;
    if (s?.team !== OUR_TEAM) return;
    this.#fallen.set(id, { ...s, life: 0, sees: [], continueTo: null });
    this.#startDeathAnimation(id);
  }

  #observeOwn(s: SoldierView): void {
    const before = this.#lastSeen.get(s.id);
    this.#lastSeen.set(s.id, s);
    if (before && !isDead(before) && isDead(s)) this.#soldierDied(s.id);
  }

  #afterSkullAnimation(id: number): void {
    const dead = this.#fallen.get(id);
    if (!dead || this.#selected !== id) return;
    const next = nextSquadMateAfterDeath(ownSoldiers(this.#view()), dead);
    if (next) {
      this.#selectSoldier(next, false, false);
      return;
    }
    this.#selected = null;
    this.#nobodySelected = true;
    this.#requestPanel('team', null);
  }

  #updatePanelAnimations(): void {
    for (const [id, a] of this.#panelAnimations) {
      const wasFinished = a.finished;
      while (!a.finished && this.#now - a.since >= PANEL_FACE_FRAME_MS) {
        a.since += PANEL_FACE_FRAME_MS;
        if (!a.dead) {
          if (++a.closeFrame > CLOSE_PANEL_LAST_FRAME) {
            a.closeFrame = CLOSE_PANEL_LAST_FRAME;
            a.dead = true;
          }
        } else if (++a.deadFrame > CLOSE_PANEL_LAST_FRAME) {
          a.deadFrame = CLOSE_PANEL_LAST_FRAME;
          a.finished = true;
        }
      }
      if (a.finished && !wasFinished) this.#afterSkullAnimation(id);
      if (a.finished && !this.#slots.includes(id)) this.#panelAnimations.delete(id);
    }
  }

  update(now: number): void {
    this.#now = this.#env.runtime.clock.ja2Now;
    const view = this.#view();
    this.#chooseInitialSelection();
    this.#applyPanelSwitch();
    this.dialogue.update(this.#now);
    for (const s of ownSoldiers(view)) this.#lastSeen.set(s.id, s);
    this.#syncSlots();
    this.#updatePanelAnimations();
    this.#updateFaces();
    this.#updateTimers(now);
    this.#syncViewport();
    this.#env.world.setSelected(this.#selected);
    this.#hoveredSoldier = this.#pointerSoldier();
    this.#env.world.setHovered(this.#hoveredSoldier);
    this.inventory.update(this.#now);
    this.#updateModels(view);
    this.controls.update(this.#now);
    this.#updateCursor(now);
    this.#updateRadarDrag();
    this.#syncSquadRegions();
    this.#hudView.update();
    this.#panelView().update();
  }

  #pointerSoldier(): number | null {
    const regions = this.#env.runtime.regions;
    if (regions.current !== this.#viewportRegion || !regions.pointerKnown) return null;
    return this.#env.world.soldierAt(regions.mouseX, regions.mouseY);
  }

  #updateFaces(): void {
    const view = this.#view();
    const speech = this.dialogue.speaking ?? this.#env.media.speech();
    for (const s of ownSoldiers(view)) {
      const profile = s.profile === undefined ? null : this.#env.media.profile(s.profile);
      const record = faceRecordOf(s, profile);
      let face = this.#faces.get(s.id);
      if (!face || face.record.path !== record.path) {
        face = new FaceAnimator(record, this.#now, this.#env.random);
        this.#faces.set(s.id, face);
      }
      this.#env.media.image(record.path);
      const talking =
        speech && speech.speaker === s.id
          ? { playing: speech.playing, elapsedMs: speech.elapsedMs, gaps: this.#env.media.gaps(speech.file) ?? [] }
          : null;
      face.update(this.#now, s, talking, this.#env.runtime.images);
    }
  }

  #updateTimers(now: number): void {
    for (const [id, damage] of this.#damage) if (!damage.update(this.#simMs())) this.#damage.delete(id);
    for (const [id, locator] of this.#locators) if (!locator.update(this.#now)) this.#locators.delete(id);
    if (now - this.#radarBlinkAt >= RADAR_MAP_BLINK_MS) {
      this.#radarBlinkAt = now;
      this.#radarBlink = !this.#radarBlink;
    }
    this.#topBar.sync(this.#view()?.combat, this.#simMs());
    this.#feedback.update(this.#now);
    const font = this.#env.runtime.fonts.get(FontName.SMALLFONT1);
    const { height } = this.#env.runtime.geometry();
    if (this.#log.scroll(this.#now, height - MSG_INTERFACE_LOG_Y, lineHeightOf(font))) this.#env.sounds.newMessageBeep();
  }

  #simMs(): number {
    return this.#env.client.shownTick * TICK_MS;
  }

  #panelState(view: PlayerView | null): PanelState {
    return {
      view,
      selected: this.#selected,
      itemInCursor: this.inventory.cursor !== null,
      pickupMenuOpen: this.pickup.open,
      popupOpen: this.stack.open || this.keyRing.open,
      descriptionOpen: this.description.open,
      disabledForItems: this.#disabledForItems(),
      interfaceLevel: this.#interfaceLevel,
      cursorMode: this.#cursorModeOf(),
      burstCapable: this.#burstCapable(this.#smSoldier()),
      now: this.#now,
      shopOpen: this.dialogue.shopOpen,
    };
  }

  #helpSources() {
    const media = this.#env.media;
    return {
      item: (name: string) => media.item(name),
      text: this.#env.text,
      gunNut: media.gunNut,
      nickname: (profile: number) => media.profile(profile)?.nickname ?? null,
    };
  }

  #updateModels(view: PlayerView | null): void {
    const state = this.#panelState(view);
    const text = this.#env.text;
    if (this.#panel === 'team') {
      const members = this.#slots.map((id) => this.#slotSoldier(id));
      this.#team.model = teamPanelModel(state, members, text, this.#helpSources());
    } else {
      const s = this.#smSoldier();
      const stance: Stance = s ? this.#env.world.soldierHeight(s.id) : 'stand';
      this.#sm.model = smPanelModel(
        state,
        s,
        stance,
        this.#flashes.get(s?.id ?? -1) ?? new Map(),
        ownSoldiers(view),
        text,
        this.#helpSources(),
      );
    }
    const paused = this.#env.client.paused;
    this.#hud.model = {
      radarEnabled: !this.inventory.cursor && !this.stack.open && !this.keyRing.open && !this.pickup.open && !this.dialogue.shopOpen,
      radarShown: this.#radarShown,
      sector: sectorOfMap(view?.mapPath ?? null),
      clock: hudClockText(text, view?.clock ?? null, paused),
      inCombat: inCombat(view),
      pauseHelp: pauseHelpText(text, paused),
      paused,
    };
  }

  #updateCursor(now: number): void {
    const cursor = this.inventory.cursor;
    const item = cursor ? this.#env.media.item(cursor.item) : null;
    const graphic = item?.inventoryGraphics.small ?? null;
    if (!graphic || !this.#env.media.image(graphic.path)) {
      if (this.#externCursor) this.#env.runtime.cursor.set(this.#env.runtime.regions.current?.cursor ?? CursorId.NORMAL, now);
      this.#externCursor = false;
      return;
    }
    this.#env.runtime.cursor.setExternCursor(graphic.path, graphic.subImageIndex);
    this.#env.runtime.cursor.set(EXTERN_CURSOR, now);
    this.#externCursor = true;
  }

  #updateRadarDrag(): void {
    if (!this.#radarPressed) return;
    const regions = this.#env.runtime.regions;
    if (!regions.isButtonDown(MouseButtonMask.LEFT)) {
      this.#radarPressed = false;
      return;
    }
    this.#radarPress();
  }

  input(event: UiInputEvent): boolean {
    if (isPointerEvent(event)) return false;
    if (this.dialogue.input(event)) return true;
    if (event.kind !== 'text' && this.controls.keyInput(event)) return true;
    if (event.kind === 'keyUp' && this.#env.client.paused && event.key !== PAUSE_KEY) {
      this.#togglePause();
      return true;
    }
    if (event.kind === 'keyDown' && event.key === ESCAPE_KEY) {
      if (this.pickup.open) this.pickup.close(true);
      else if (this.description.open) this.description.close(true);
      else if (this.stack.open) this.stack.close();
      else if (this.keyRing.open) this.keyRing.close();
      else if (this.inventory.cursor) this.inventory.cancel();
      else return this.#viewInput(event);
      return true;
    }
    if (event.kind === 'keyDown' && event.key === PANEL_TOGGLE_KEY && event.modifiers === 0) {
      this.togglePanels();
      return true;
    }
    if (event.kind === 'keyDown' && event.key === PAUSE_KEY) {
      this.#togglePause();
      return true;
    }
    if (event.kind === 'keyDown' && event.key === KEY_RING_KEY && event.modifiers === 0 && this.#panel === 'sm') {
      this.#openKeyRing(true);
      return true;
    }
    return this.#viewInput(event);
  }

  #viewInput(event: UiInputEvent): boolean {
    if (this.#hudView.input(event) || this.#panelView().input(event)) return true;
    if (event.kind === 'text' || isPointerEvent(event)) return false;
    this.controls.queueKey(event);
    return true;
  }

  render(list: DrawList): void {
    this.controls.renderWorld(list);
    this.#panelView().render(list);
    const ctx = this.#tileContext(list);
    if (this.#panel === 'sm') {
      this.stack.render(list, ctx);
      this.keyRing.render(list, ctx);
    }
    this.#hudView.render(list);
    this.pickup.render(list, ctx);
    this.controls.renderMenus(list);
    this.controls.renderOverhead(list);
    this.dialogue.render(list);
    if (this.dialogue.shopOpen && this.description.open) this.description.render(list, ctx, this.#env.runtime.images);
  }

  describe(): readonly WidgetInfo[] {
    const extra: WidgetInfo[] = [];
    for (const region of this.#env.runtime.regions.regions) {
      const owner = region.owner;
      if (
        owner !== 'itemDescription' &&
        owner !== 'itemPopups' &&
        owner !== 'itemPickupMenu' &&
        owner !== 'squadList' &&
        owner !== 'tacticalViewport' &&
        owner !== 'tacticalMenus' &&
        owner !== 'tacticalExitDialog' &&
        owner !== 'tacticalOverhead'
      )
        continue;
      extra.push({
        id: region.id ?? '',
        kind: 'region',
        rect: { x: region.x1, y: region.y1, width: region.width, height: region.height },
        visible: true,
        enabled: region.enabled,
        state: region.inArea ? 'hover' : 'normal',
        text: region.tooltip || null,
        frame: null,
      });
    }
    for (const button of this.#env.runtime.buttons.buttons) {
      if (!DESCRIBED_BUTTON_OWNERS.has(String(button.owner))) continue;
      extra.push(button.describe());
    }
    return [...this.#hudView.describe(), ...this.#panelView().describe(), ...extra, ...this.dialogue.describe()];
  }

  frames(frames: readonly ViewFrame[]): void {
    this.dialogue.frames(frames);
    this.controls.frames(frames);
    for (const frame of frames) {
      for (const s of frame.changed) if (s.team === OUR_TEAM) this.#observeOwn(s);
      for (const event of frame.events ?? []) this.#event(event, frame);
      for (const entry of frame.messages ?? []) {
        if (!showsInTacticalLog(entry)) continue;
        const text = formatMessageEntry(entry, { text: this.#env.text, itemByIndex: (i) => this.#env.media.itemByIndex(i) });
        const tiny = this.#env.runtime.fonts.get(FontName.TINYFONT1);
        this.#log.push(text, entry.colour, tiny);
        if (entry.kind === 'uiFeedback' || entry.kind === 'skullFeedback') this.#beginFeedback(text, entry.kind === 'skullFeedback');
      }
      for (const s of frame.changed) if (s.team === OUR_TEAM && s.inventory) this.#lastInventories.set(s.id, s.inventory);
    }
  }

  #beginFeedback(text: string, skull: boolean): void {
    const fonts = this.#env.runtime.fonts;
    this.#feedback.begin(text, skull, this.#now, this.#env.basicTextBox, {
      text: fonts.get('FONT12ARIAL'),
      bold: fonts.get('FONT10ARIALBOLD'),
    });
  }

  #event(event: FrameEvent, frame: ViewFrame): void {
    const view = this.#view();
    switch (event.type) {
      case 'soldierHit': {
        const s = soldierById(view, event.soldier);
        if (s?.team === OUR_TEAM) {
          const face = this.#faces.get(s.id);
          face?.hit(this.#now);
          face?.hitOver();
        }
        return;
      }
      case 'lifeLost': {
        const after = frame.changed.find((c) => c.id === event.soldier) ?? soldierById(view, event.soldier);
        if (!after) return;
        const oldLife = (after.life ?? 0) + event.amount;
        if (!showsDamage(oldLife, event.amount)) return;
        const offset = this.#boundingOffset(event.soldier);
        const shown = this.#damage.get(event.soldier);
        if (shown) {
          shown.amount += event.amount;
          shown.restart(this.#simMs(), offset.x, offset.y);
        } else {
          const number = new DamageNumber(this.#simMs(), offset.x, offset.y);
          number.amount = event.amount;
          this.#damage.set(event.soldier, number);
        }
        return;
      }
      case 'statChanged': {
        const key = event.stat === 'experience' ? 'level' : event.stat;
        if (!STAT_KEYS.includes(key as StatKey) || event.change === 0) return;
        const flashes = this.#flashes.get(event.soldier) ?? new Map<StatKey, StatFlash>();
        flashes.set(key as StatKey, { at: this.#now, up: event.change > 0 });
        this.#flashes.set(event.soldier, flashes);
        return;
      }
      case 'itemsPickedUp': {
        const before = this.#lastInventories.get(event.soldier) ?? [];
        const after = frame.changed.find((c) => c.id === event.soldier)?.inventory ?? [];
        const fresh = after
          .filter((a) => !before.some((b) => b.slot === a.slot && b.item === a.item && b.count >= a.count))
          .map((a) => a.slot);
        if (fresh.length > 0) this.inventory.markNewItems(event.soldier, fresh);
        return;
      }
      case 'aiTurn': {
        const s = soldierById(view, event.soldier);
        if (s) this.#locateSoldier(s, SHOW_LOCATOR_FAST_CYCLES);
        return;
      }
      case 'enemyTurnProgress':
        this.#topBar.observeProgress(event.done);
        return;
      case 'soldierDied':
        this.#soldierDied(event.soldier);
        return;
      case 'interrupt':
        if (event.selected !== undefined) this.select(event.selected, false);
        return;
      default:
        return;
    }
  }

  #boundingOffset(id: number): { x: number; y: number } {
    const box = this.#env.world.soldierBox(id);
    const pos = this.#env.world.soldierTrueScreenPosition(id);
    if (!box || !pos) return { x: 0, y: 0 };
    return { x: box.x - pos.x, y: box.y - pos.y };
  }

  locate(id: number, cycles: number | null): void {
    const s = soldierById(this.#view(), id);
    if (s) this.#locateSoldier(s, cycles);
  }

  #locateSoldier(s: SoldierView, cycles: number | null): void {
    this.#env.world.locate(s.gridNo);
    if (cycles !== null) this.#locators.set(s.id, new Locator(this.#now, cycles));
  }

  #handleLocateSelect(s: SoldierView): void {
    if ((s.life ?? 0) < OKLIFE || this.#env.runtime.modifiers & ALT_MASK) {
      this.#locateSoldier(s, SHOW_LOCATOR_NORMAL_CYCLES);
      return;
    }
    const flashing = this.#locators.has(s.id);
    if (s.id === this.#selected) {
      this.#locateSoldier(s, flashing ? null : SHOW_LOCATOR_NORMAL_CYCLES);
      return;
    }
    this.#selectSoldier(s, true, true);
  }

  #selectFace(slot: number): void {
    const s = this.#slotSoldier(this.#slots[slot] ?? null);
    if (!s || this.pickup.open || this.inventory.cursor) return;
    if (s.continueTo !== undefined && s.continueTo !== null) {
      void this.#command({ type: 'move', soldier: s.id, to: s.continueTo });
      return;
    }
    this.#handleLocateSelect(s);
  }

  #openSmPanelFromSlot(slot: number): void {
    const s = soldierById(this.#view(), this.#slots[slot] ?? null);
    if (!s || isDead(s) || isEpc(s) || isInVehicle(s)) return;
    this.#requestPanel('sm', s.id);
  }

  #enemyIndicator(id: number | null): void {
    const s = this.#slotSoldier(id);
    if (!s || isInVehicle(s)) return;
    const enemies = (s.sees ?? [])
      .map((e) => soldierById(this.#view(), e))
      .filter((e): e is SoldierView => e !== null && !isDead(e))
      .sort((a, b) => a.id - b.id);
    if (enemies.length === 0) {
      this.#selectFace(this.#slots.indexOf(s.id));
      return;
    }
    const last = this.#lastEnemyCycled.get(s.id) ?? 0;
    const next = enemies.find((e) => e.id > last) ?? enemies.find((e) => e.id > 0);
    if (!next) {
      this.#lastEnemyCycled.set(s.id, 0);
      return;
    }
    this.#lastEnemyCycled.set(s.id, next.id);
    for (const other of this.#locators.keys()) this.#locators.delete(other);
    this.#locateSoldier(next, SHOW_LOCATOR_NORMAL_CYCLES);
    this.#setInterfaceLevel(next.level);
  }

  #swapHands(id: number | null): void {
    const s = soldierById(this.#view(), id);
    if (!s || s.controlled !== undefined) return;
    void this.#command({ type: 'swapHands', soldier: s.id });
  }

  async #command(cmd: Parameters<InventoryPanel['send']>[0]): Promise<void> {
    await this.inventory.send(cmd);
  }

  #toggleSquadList(): void {
    this.#radarShown = !this.#radarShown;
  }

  #togglePause(): void {
    if (this.#view()?.conversation) return;
    this.#env.client.setPaused(!this.#env.client.paused);
  }

  #radarPress(): void {
    if (!this.#radarShown) return;
    const rect = this.#radarRect();
    const regions = this.#env.runtime.regions;
    this.#radarPressed = true;
    this.#env.world.centerFromRadar(regions.mouseX - rect.x, regions.mouseY - rect.y);
  }

  #radarRect(): Area {
    const rect = this.#hudView.describe().find((w) => w.id === RADAR_REGION)?.rect;
    return rect ?? { x: 0, y: 0, width: 0, height: 0 };
  }

  #squadsOnMap(): ReadonlySet<number> {
    return new Set(ownSoldiers(this.#view()).map(squadOf));
  }

  #syncSquadRegions(): void {
    if (this.#radarShown) {
      this.#removeSquadRegions();
      return;
    }
    if (this.#squadRegions.length > 0) return;
    const rect = this.#radarRect();
    const model = this.#env.layout(TacticalLayout.HUD);
    const font = this.#env.runtime.fonts.get(model.font('SQUAD_FONT'));
    const regionHeight = model.number('SQUAD_REGION_HEIGHT - SUBTRACTOR_FOR_SQUAD_LIST');
    const w = idiv(rect.width, 2) - 1;
    const h = idiv(regionHeight, idiv(NUMBER_OF_SQUADS, SQUAD_COLUMNS));
    const top = rect.y + fontHeight(font);
    for (let i = 0; i < NUMBER_OF_SQUADS; i++) {
      const half = idiv(NUMBER_OF_SQUADS, SQUAD_COLUMNS);
      const x = i < half ? rect.x : rect.x + idiv(rect.width, 2);
      const y = top + (i < half ? i : i - half) * h;
      this.#squadRegions.push(
        this.#env.runtime.regions.define({
          x1: x,
          y1: y,
          x2: x + w,
          y2: y + h,
          priority: Priority.HIGHEST,
          cursor: 0,
          owner: 'squadList',
          id: `squadLine${i}`,
          onMove: (_r, reason) => {
            if (reason & MouseReason.GAIN_MOUSE && this.#squadsOnMap().has(i)) this.#hoveredSquad = i;
            if (reason & MouseReason.LOST_MOUSE) this.#hoveredSquad = -1;
          },
          onButton: (_r, reason) => {
            if (reason & MouseReason.LBUTTON_UP && this.#squadsOnMap().has(i)) {
              this.#squad = i;
              this.#radarShown = true;
              const first = this.#teamMembers()[0];
              if (first) this.select(first.id, false);
            }
          },
        }),
      );
    }
  }

  #removeSquadRegions(): void {
    for (const region of this.#squadRegions) region.remove();
    this.#squadRegions = [];
    this.#hoveredSquad = -1;
  }

  #viewportButton(reason: number): void {
    if (this.inventory.cursor && reason & MouseReason.RBUTTON_UP) {
      this.inventory.cancel();
      return;
    }
    this.controls.pointerButton(reason);
  }

  #openPickupMenu(picker: SoldierView, gridNo: number, items: readonly ItemView[], pointer: { x: number; y: number }): void {
    const { width, height } = this.#env.runtime.geometry();
    this.#requestPanel('sm', picker.id);
    const top = this.#view()?.combat?.topMessage ? TOP_BAR_HEIGHT : 0;
    const bottom = height - TEAMPANEL_HEIGHT;
    const fonts = this.#env.runtime.fonts;
    this.pickup.show(picker.id, gridNo, picker.level, items, pointer, { top, bottom }, width, {
      item: fonts.get(FontName.BLOCKFONT2),
      tiny: fonts.get(FontName.TINYFONT1),
    });
  }

  #openDescription(soldier: number, slot: number, index: number): void {
    this.stack.close();
    this.#showDescription({ kind: 'slot', soldier, slot, index });
  }

  #showDescription(object: Parameters<ItemDescriptionBox['show']>[0]): void {
    this.#descriptionOrigin = null;
    this.#configureDescription();
    this.description.show(object);
  }

  #describeAt(view: InventoryItemView, at: { readonly x: number; readonly y: number }): void {
    if (this.description.open) {
      this.description.close(false);
      return;
    }
    this.#descriptionOrigin = at;
    this.#configureDescription();
    this.description.show({ kind: 'object', soldier: this.#smMerc ?? -1, view });
  }

  #openStackPopup(soldier: number, slot: number): void {
    const s = soldierById(this.#view(), soldier);
    if (!s) return;
    const model = this.#env.layout(TacticalLayout.SINGLE_MERC);
    const panel = frameRect('tacticalInventory', this.#env.runtime.geometry());
    const rects = this.#inventorySlots();
    const rect = rects[slot];
    if (!rect) return;
    const [ax, ay, aw, ah] = (this.#descriptionParams().stackArea as unknown[]).map((v) => model.number(v as number | string));
    this.stack.show(s, slot, rect, { x: panel.x + (ax ?? 0), y: panel.y + (ay ?? 0), width: aw ?? 0, height: ah ?? 0 });
  }

  #openKeyRing(fromShortcut: boolean): void {
    const s = this.#smSoldier();
    if (!s || this.keyRing.open) return;
    const { width, height } = this.#env.runtime.geometry();
    const panel = frameRect('tacticalInventory', this.#env.runtime.geometry());
    this.keyRing.show(s, { x: fromShortcut ? 0 : panel.x, y: panel.y, width, height: height - panel.y });
  }

  #descriptionParams(): Readonly<Record<string, unknown>> {
    const json = this.#env.layout(TacticalLayout.SINGLE_MERC).json.widgets?.find((w) => w.id === 'smDescription');
    return (json?.params ?? {}) as Readonly<Record<string, unknown>>;
  }

  #inventorySlots(): SlotRect[] {
    const model = this.#env.layout(TacticalLayout.SINGLE_MERC);
    const panel = frameRect('tacticalInventory', this.#env.runtime.geometry());
    return slotRects(model.style('slots'), (v) => model.number(v as number | string), panel.x, panel.y);
  }

  #itemInfo(object: Parameters<ItemDescriptionBox['show']>[0]): ItemInfo | null {
    const client = this.#env.client;
    const metric = this.#env.metric();
    let request: Parameters<typeof client.hint>[0];
    if (object.kind === 'slot')
      request = {
        type: 'itemInfo',
        soldier: object.soldier,
        slot: object.slot,
        ...(object.index !== 0 ? { index: object.index } : {}),
        metric,
      };
    else if (object.kind === 'attachment') {
      const s = soldierById(this.#view(), object.soldier);
      const attachment = slotItem(s, object.slot)?.attachments?.[object.attachment];
      const index = attachment ? this.#env.media.item(attachment.item)?.index : undefined;
      if (index === undefined) return null;
      request = { type: 'itemInfo', item: index, metric };
    } else if (object.kind === 'object') {
      const index = this.#env.media.item(object.view.item)?.index;
      if (index === undefined) return null;
      request = { type: 'itemInfo', item: index, metric };
    } else if (object.kind === 'balance') return null;
    else {
      const s = soldierById(this.#view(), object.soldier);
      const key = s?.keys?.[object.key];
      const name = key ? this.#env.media.keyItem(key) : null;
      const index = name ? this.#env.media.item(name)?.index : undefined;
      if (index === undefined) return null;
      request = { type: 'itemInfo', item: index, metric };
    }
    const reply = client.hint(request);
    return reply.state === 'ready' && reply.answer.ok ? (reply.answer.data as ItemInfo) : null;
  }

  #smAction(action: string, args: readonly number[]): void {
    const s = this.#smSoldier();
    const [first = 0, second = 0] = args;
    switch (action) {
      case 'selectMerc':
        if (s && !this.#disabledForItems()) this.#handleLocateSelect(s);
        return;
      case 'closePanel':
        this.description.close(false);
        this.#requestPanel('team', null);
        return;
      case 'faceHover':
        this.#hoveredFace = first === 1 ? (s?.id ?? null) : null;
        return;
      case 'enemyIndicator':
        this.#enemyIndicator(s?.id ?? null);
        return;
      case 'slotPrimary':
        if (s && this.dialogue.shopPocketClick(s.id, first)) return;
        this.inventory.slotPrimary(first, (this.#env.runtime.modifiers & SHIFT_MASK) !== 0);
        return;
      case 'slotSecondary':
        this.inventory.slotSecondary(first);
        return;
      case 'slotHover':
        this.inventory.slotHover(first, second === 1, this.#now);
        return;
      case 'bodyPrimary':
        this.inventory.bodyPrimary();
        return;
      case 'bodyHover':
        this.inventory.bodyHover(first === 1);
        return;
      case 'keyRing':
        this.#openKeyRing(false);
        return;
      case 'money':
        void this.#money.region();
        return;
      case 'mapScreen':
        this.#env.flow.mapScreen();
        return;
      case 'done':
        void this.#command({ type: 'endTurn' });
        return;
      case 'options':
        this.#env.flow.options();
        return;
      case 'prevMerc':
      case 'nextMerc':
        this.#stepMerc(action === 'nextMerc' ? 1 : -1);
        return;
      case 'stanceUp':
      case 'stanceDown':
        if (s) this.#changeStance(s, action === 'stanceUp');
        return;
      case 'climb':
        if (s) this.controls.climbButton(s);
        return;
      case 'stealth':
        if (s) void this.#command({ type: 'stealth', soldiers: [s.id] });
        return;
      case 'mute':
        if (s) void this.#command({ type: 'mute', soldier: s.id });
        return;
      case 'burstMode':
        if (s) void this.#command({ type: 'weaponMode', soldier: s.id });
        return;
      case 'level':
        this.#setInterfaceLevel(this.#interfaceLevel > 0 ? 0 : 1);
        return;
      case 'hand':
        this.controls.toggleHandCursor();
        return;
      case 'talk':
        this.controls.toggleTalkCursor();
        return;
      case 'look':
        this.controls.toggleLookCursor();
        return;
      default:
        return;
    }
  }

  #stepMerc(step: 1 | -1): void {
    const next = nextMerc(ownSoldiers(this.#view()), this.#smMerc, step);
    if (!next) return;
    this.#requestPanel('sm', next.id);
    if (!this.pickup.open && !this.dialogue.shopOpen) this.locate(next.id, SHOW_LOCATOR_NORMAL_CYCLES);
  }

  #changeStance(s: SoldierView, up: boolean): void {
    const height = this.#env.world.soldierHeight(s.id);
    const next = up ? (height === 'prone' ? 'crouch' : 'stand') : height === 'stand' ? 'crouch' : 'prone';
    void this.#command({ type: 'stance', soldier: s.id, stance: next });
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

  #faceArt(): FaceArt {
    return {
      hatch: this.#asset(TacticalLayout.HUD, 'hatch'),
      dead: this.#asset(TacticalLayout.HUD, 'dead'),
      icons: this.#asset(TacticalLayout.HUD, 'portraitIcons'),
    };
  }

  #faceContext(list: DrawList): FaceDrawContext {
    return {
      list,
      images: this.#env.runtime.images,
      art: this.#faceArt(),
      fonts: { tiny: this.#env.runtime.fonts.get(FontName.TINYFONT1) },
      inCombat: inCombat(this.#view()),
    };
  }

  #highlightOf(s: SoldierView): number | null {
    if (s.id === this.#hoveredSoldier) return WHITE_HILIGHT;
    if (!this.#env.world.soldierMarker(s.id).moving) return NO_HILIGHT;
    if ((s.life ?? 0) < OKLIFE) return null;
    return s.stealth ? STEALTH_MOVING_HILIGHT : MOVING_HILIGHT;
  }

  #compatibleFace(s: SoldierView): boolean {
    return this.inventory.cursor !== null && this.inventory.compatibleMercs().has(s.id);
  }

  #continueText(s: SoldierView): string | null {
    if (this.#hoveredFace !== s.id || s.continueTo === undefined || s.continueTo === null) return null;
    return this.#env.text.string('TacticalStr', CONTINUE_OVER_FACE_STR) ?? '';
  }

  #faceHatched(s: SoldierView, inSm: boolean): boolean {
    const view = this.#view();
    if (!okInterrupt(s) || !ourTurn(view)) return inCombat(view);
    return inSm && this.#disabledForItems() && !this.pickup.open;
  }

  #drawPanelFace(list: DrawList, s: SoldierView, x: number, y: number, inSm: boolean): void {
    const face = this.#faces.get(s.id);
    if (!face) return;
    drawFace(this.#faceContext(list), s, face, x, y, {
      highlight: this.#highlightOf(s),
      compatible: this.#compatibleFace(s),
      hatched: this.#faceHatched(s, inSm),
      deadPanelRunning: this.#animationRunning(s.id),
      textOver: this.#continueText(s),
    });
  }

  #renderers(): Readonly<Record<string, CustomRenderer>> {
    return {
      teamPanelArt: (list, rect, params, view) => this.#teamPanelArt(list, rect, params, view),
      teamFace: (list, rect, params, view, vars) => this.#teamFace(list, rect, params, view, vars),
      teamBars: (list, rect, _p, _v, vars) => this.#teamBars(list, rect, vars),
      teamHands: (list, rect, params, view, vars) => this.#teamHands(list, rect, params, view, vars),
      smPanelArt: (list, rect, params, view) => this.#smPanelArt(list, rect, params, view),
      smPlate: (list, rect, params, view) => this.#smPlate(list, rect, params, view),
      smFace: (list, rect) => this.#smFace(list, rect),
      smBody: (list, rect, params, view) => this.#smBody(list, rect, params, view),
      smBars: (list, rect) => this.#smBars(list, rect),
      inventory: (list, rect, params, view) => this.#inventoryRenderer(list, rect, params, view),
      itemDescription: (list, rect, params, view) => this.#descriptionRenderer(list, rect, params, view),
      topBar: (list, _rect, params, view) => this.#topBarRenderer(list, params, view),
      viewportOverlays: (list, rect, params, view) => this.#overlaysRenderer(list, rect, params, view),
      radar: (list, rect, params, view) => this.#radarRenderer(list, rect, params, view),
      messageLog: (list, rect) => this.#log.render(list, this.#env.runtime.fonts.get(FontName.TINYFONT1), rect.x),
      pausedBox: (list, rect) => this.#pausedBox(list, rect),
      feedbackBox: (list, rect) => this.#feedback.render(list, this.#env.runtime.geometry().width, rect.y),
    };
  }

  #teamPanelArt(list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void {
    const { width, height } = this.#env.runtime.geometry();
    list.fill(0, height - TEAMPANEL_HEIGHT, rect.x, height, 0);
    list.fill(rect.x + rect.width, height - TEAMPANEL_HEIGHT, width, height, 0);
    const panel = view.model.asset(String(params.panel)).path;
    list.image(panel, 0, rect.x, rect.y);
    const from = view.number(params.copyFrom as string, {});
    const copy = view.number(params.copyWidth as string, {});
    const slots = this.#slotCount();
    for (let i = BASE_TEAM_SLOTS; i < slots; i++) {
      const x = rect.x + i * TEAMPANEL_SLOT_WIDTH;
      list.pushClip(x, rect.y, x + copy, rect.y + rect.height);
      list.image(panel, 0, x - from, rect.y);
      list.popClip();
    }
  }

  #teamFace(list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView, vars: Variables): void {
    const slot = vars.i ?? 0;
    const id = this.#slots[slot] ?? null;
    const s = this.#slotSoldier(id);
    const close = this.#asset(TacticalLayout.HUD, 'close');
    const animation = id === null ? undefined : this.#panelAnimations.get(id);
    const running = animation !== undefined && !animation.finished;
    if (s) this.#drawPanelFace(list, s, rect.x, rect.y, false);
    else list.image(close, CLOSE_PANEL_LAST_FRAME, rect.x, rect.y);
    if (animation && running) {
      if (!animation.dead) list.image(close, animation.closeFrame, rect.x, rect.y);
      else list.image(this.#asset(TacticalLayout.HUD, 'dead'), animation.deadFrame, rect.x, rect.y);
    }
    const borderAsset = view.model.asset(String(params.border)).path;
    const panel = view.frame;
    const slotX = panel.x + slot * TEAMPANEL_SLOT_WIDTH;
    const borderX = slotX + view.number(params.borderX as string, {});
    const borderY = panel.y + view.number(params.borderY as string, {});
    const viewState = this.#view();
    if (!ourTurn(viewState)) list.image(borderAsset, 1, borderX, borderY);
    else if (viewState?.combat?.interrupt === true && (!s || !okInterrupt(s))) list.image(borderAsset, 1, borderX, borderY);
    else if (s && s.id === this.#selected) list.image(borderAsset, 0, borderX, borderY);
    if (s && !running) this.#drawHighlights(list, s, rect.x, rect.y, this.#compatibleFace(s));
  }

  #drawHighlights(list: DrawList, s: SoldierView, x: number, y: number, compatible: boolean): void {
    const face = this.#faces.get(s.id);
    if (!face) return;
    drawFaceHighlights(this.#faceContext(list), face, x, y, {
      highlight: this.#highlightOf(s),
      compatible,
      hatched: false,
      deadPanelRunning: false,
      textOver: null,
    });
  }

  #barBackground(s: SoldierView): { asset: string; gold: boolean } {
    const gold = s.id === this.#selected && ourTurn(this.#view()) && okInterrupt(s);
    return { asset: this.#asset(TacticalLayout.HUD, 'bars'), gold };
  }

  #teamBars(list: DrawList, rect: Area, vars: Variables): void {
    const s = soldierById(this.#view(), this.#slots[vars.i ?? 0] ?? null);
    if (!s || isDead(s) || this.#animationRunning(s.id)) return;
    drawSoldierBars(list, barValues(s), rect.x, rect.y, this.#barBackground(s));
  }

  #teamHands(list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView, vars: Variables): void {
    const s = soldierById(this.#view(), this.#slots[vars.i ?? 0] ?? null);
    if (!s || isDead(s)) return;
    const ctx = this.#tileContext(list);
    const separation = view.number(params.separation as string, {});
    const vehicleArt = view.model.asset(String(params.vehicle)).path;
    const height = rect.height - separation;
    const seat = s.vehicle ?? null;
    const first = slotItem(s, 5);
    if (seat?.driver) list.image(vehicleArt, 0, rect.x, rect.y);
    else if (first)
      drawInventoryItem(
        ctx,
        first,
        { x: rect.x, y: rect.y, width: rect.width, height },
        { outline: null, weaponMode: s.weaponMode ?? null },
      );
    const second = slotItem(s, 6);
    if (seat) list.image(vehicleArt, 1, rect.x, rect.y + separation);
    else if (second) drawInventoryItem(ctx, second, { x: rect.x, y: rect.y + separation, width: rect.width, height }, { outline: null });
  }

  #smPanelArt(list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void {
    const { width, height } = this.#env.runtime.geometry();
    list.fill(0, height - INV_INTERFACE_HEIGHT, rect.x, height, 0);
    list.fill(rect.x + rect.width, height - INV_INTERFACE_HEIGHT, width, height, 0);
    const panel = view.model.asset(String(params.panel)).path;
    if (rect.width > 640) list.image(panel, 0, rect.x + rect.width - 640, rect.y);
    list.image(panel, 0, rect.x, rect.y);
    const fillerWidth = rect.width - 640;
    if (fillerWidth <= 0) return;
    const filler = view.model.asset(String(params.filler)).path;
    const destX = rect.x + view.number(params.fillerX as string, {});
    const destY = rect.y + view.number(params.fillerY as number, {});
    const destHeight = view.number(params.fillerHeight as string, {});
    const [sx = 0, sy = 0, , sh = 0] = params.fillerSource as number[];
    const srcH = Math.min(destHeight, sh);
    if (srcH === destHeight) {
      list.pushClip(destX, destY, destX + fillerWidth, destY + destHeight);
      list.image(filler, 0, destX - sx, destY - sy);
      list.popClip();
      return;
    }
    for (let row = 0; row < destHeight; row++) {
      const srcRow = sy + idiv(row * srcH, destHeight);
      list.pushClip(destX, destY + row, destX + fillerWidth, destY + row + 1);
      list.image(filler, 0, destX - sx, destY + row - srcRow);
      list.popClip();
    }
  }

  #smPlate(list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void {
    const s = this.#smSoldier();
    if (!s) return;
    if (this.#disabledForItems()) list.image(view.model.asset(String(params.disabled)).path, 0, rect.x, rect.y);
    else if (ourTurn(this.#view()) && s.id === this.#selected && okInterrupt(s))
      list.image(view.model.asset(String(params.gold)).path, 0, rect.x, rect.y);
  }

  #smFace(list: DrawList, rect: Area): void {
    const s = this.#smSoldier();
    if (!s) return;
    this.#drawPanelFace(list, s, rect.x, rect.y, true);
    this.#drawHighlights(list, s, rect.x, rect.y, false);
  }

  #smBody(list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void {
    const s = this.#smSoldier();
    if (!s) return;
    const figures = params.figures as readonly (readonly string[])[];
    const pair = figures[s.bodyType] ?? figures[0];
    const name = pair?.[this.inventory.applyHighlight() ? 1 : 0];
    if (name) list.image(view.model.asset(name).path, 0, rect.x, rect.y);
  }

  #smBars(list: DrawList, rect: Area): void {
    const s = this.#smSoldier();
    if (!s || isDead(s)) return;
    drawSoldierBars(list, barValues(s), rect.x, rect.y, this.#barBackground(s));
  }

  #inventoryArt(params: Readonly<Record<string, unknown>>, view: LayoutView): InventoryArt {
    const panel = view.frame;
    const at = (value: unknown) => {
      const [x, y] = value as unknown[];
      return { x: panel.x + view.number(x as string, {}), y: panel.y + view.number(y as string, {}) };
    };
    return {
      secondHandCover: view.model.asset(String(params.secondHandCover)).path,
      secondHandCoverAt: at(params.secondHandCoverAt),
      goldKey: view.model.asset(String(params.keyRing)).path,
      keyRingAt: at(params.keyRingAt),
    };
  }

  #inventoryRenderer(list: DrawList, _rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void {
    const s = this.#smSoldier();
    if (!s) return;
    this.inventory.render(list, this.#tileContext(list), s, this.#inventorySlots(), this.#inventoryArt(params, view));
    if (this.#disabledForItems()) {
      const panel = view.frame;
      const { height } = this.#env.runtime.geometry();
      list.hatch(
        panel.x + view.number(params.hatchFrom as number, {}),
        panel.y,
        panel.x + view.number(params.hatchTo as number, {}),
        height,
      );
    }
  }

  #descriptionGeometry(rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): DescriptionGeometry {
    const n = (v: unknown) => view.number(v as string, {});
    const box = (v: unknown) => (v as unknown[]).map(n) as unknown as readonly [number, number, number, number];
    const point = (v: unknown) => (v as unknown[]).map(n) as unknown as readonly [number, number];
    const stats = (v: unknown) => (v as unknown[][]).map((row) => row.map(n) as unknown as readonly [number, number, number]);
    const panel = view.frame;
    const money = point(params.moneyBox);
    return {
      origin: this.#descriptionOrigin ?? { x: rect.x, y: rect.y },
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
      moneyBox: [panel.x + money[0], panel.y + money[1]],
      moneyButtons: (params.moneyButtons as unknown[]).map(point),
    };
  }

  #descriptionRenderer(list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void {
    this.description.configure(
      this.#descriptionGeometry(rect, params, view),
      {
        box: view.model.asset(String(params.box)).path,
        bullet: view.model.asset(String(params.bullet)).path,
        money: view.model.asset(String(params.money)).path,
      },
      { item: this.#env.runtime.fonts.get(FontName.BLOCKFONT2), tiny: this.#env.runtime.fonts.get(FontName.TINYFONT1) },
    );
    this.description.render(list, this.#tileContext(list), this.#env.runtime.images);
  }

  #configureDescription(): void {
    const view = this.#smView;
    const json = view.model.json.widgets?.find((w) => w.id === 'smDescription');
    if (!json) return;
    const panel = frameRect('tacticalInventory', this.#env.runtime.geometry());
    const rect = {
      x: panel.x + view.model.number(json.x as string),
      y: panel.y + view.model.number(json.y as string),
      width: view.model.number(json.width as string),
      height: view.model.number(json.height as string),
    };
    const params = (json.params ?? {}) as Readonly<Record<string, unknown>>;
    this.description.configure(
      this.#descriptionGeometry(rect, params, view),
      {
        box: view.model.asset(String(params.box)).path,
        bullet: view.model.asset(String(params.bullet)).path,
        money: view.model.asset(String(params.money)).path,
      },
      { item: this.#env.runtime.fonts.get(FontName.BLOCKFONT2), tiny: this.#env.runtime.fonts.get(FontName.TINYFONT1) },
    );
  }

  #topBarRenderer(list: DrawList, params: Readonly<Record<string, unknown>>, view: LayoutView): void {
    const message = this.#view()?.combat?.topMessage ?? null;
    if (!message) return;
    const asset = (name: unknown) => view.model.asset(String(name)).path;
    const geometry = this.#env.runtime.geometry();
    const [bx = 0, by = 0, bw = 0, bh = 0] = params.box as number[];
    this.#topBar.render(
      list,
      message,
      { turn: asset(params.turn), interrupt: asset(params.interrupt), computer: asset(params.computer) },
      { stdX: geometry.stdX, screenWidth: geometry.width },
      [bx, by, bw, bh],
      this.#env.runtime.fonts.get(FontName.TINYFONT1),
      this.#env.text,
    );
  }

  #overlaysRenderer(list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void {
    const top = this.#view()?.combat?.topMessage ? TOP_BAR_HEIGHT : 0;
    list.pushClip(rect.x, top, rect.x + rect.width, rect.y + rect.height);
    const font = this.#env.runtime.fonts.get(FontName.TINYFONT1);
    const radio = view.model.asset(String(params.radio)).path;
    const hostileRadio = view.model.asset(String(params.hostileRadio)).path;
    for (const s of this.#view()?.soldiers ?? []) this.#aboveGuy(list, s, top, font, radio, hostileRadio);
    for (const [id, damage] of this.#damage) {
      const s = soldierById(this.#view(), id);
      const pos = this.#env.world.soldierTrueScreenPosition(id);
      if (!s || !pos) continue;
      const x = pos.x + damage.dx + DAMAGE_OFFSET_X;
      let y = pos.y + damage.dy + DAMAGE_OFFSET_Y;
      if (y < top) y = pos.y - this.#boundingOffset(id).y;
      mprint(list, font, x, y, `-${damage.amount}`, fontColors(FontColor.MCOLOR_WHITE, DEFAULT_SHADOW));
    }
    list.popClip();
  }

  #aboveGuy(list: DrawList, s: SoldierView, top: number, font: Parameters<typeof mprint>[1], radio: string, hostileRadio: string): void {
    const pos = this.#env.world.soldierTrueScreenPosition(s.id);
    if (!pos) return;
    const marker = this.#env.world.soldierMarker(s.id);
    const offset = marker.stanceOffset;
    const locator = this.#locators.get(s.id);
    if (locator) {
      const at = aboveGuyPosition(pos, offset, false, top, false);
      list.image(s.hostile === true ? hostileRadio : radio, locator.frame, at.x + LOCATOR_OFFSET, at.y + LOCATOR_OFFSET);
    }
    if (marker.hidden || isDead(s)) return;
    const selected = s.id === this.#selected;
    const shown = selected || (locator?.shown ?? false) || s.id === this.#hoveredSoldier;
    if (!shown) return;
    const profiled = s.profile !== undefined;
    const at = aboveGuyPosition(pos, offset, this.#damage.has(s.id), top, profiled);
    let x = at.x;
    let y = at.y;
    if (s.team === OUR_TEAM || s.kind === 'rpc' || s.kind === 'epc' || profiled) {
      let action = '';
      if (s.team === OUR_TEAM && squadOf(s) !== this.#squad)
        action = (this.#env.text.string('gzLateLocalizedString', STR_LATE_34) ?? '').replace('%d', String(squadOf(s) + 1));
      if (action) printAboveGuy(list, font, x, y, action, FontColor.MCOLOR_WHITE);
      printAboveGuy(list, font, x, action ? y - 10 : y, s.name, FontColor.MCOLOR_WHITE);
      if (s.team === OUR_TEAM || s.kind === 'rpc' || s.kind === 'epc') {
        x += selected ? 28 : 30;
        y += selected ? 5 : 7;
        const box = this.#env.world.pointerBox(selected);
        if (box && this.#env.media.image(box.path)) list.image(box.path, box.frame, x, y);
        if (selected) {
          x += 1;
          y += 2;
        }
        drawBarsInUiBox(list, barValues(s), x, y, 16);
        return;
      }
      y += 10;
    } else if (s.level !== 0)
      printAboveGuy(list, font, x, y + 10, this.#env.text.string('gzLateLocalizedString', STR_LATE_15) ?? '', FontColor.YELLOW);
    printAboveGuy(list, font, x, y, healthString(this.#env.text, s.healthIndex ?? 0), FontColor.MCOLOR_DKRED);
  }

  #radarRenderer(list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void {
    if (!this.#radarShown) {
      this.#squadList(list, rect, params, view);
      return;
    }
    const image = this.#env.world.radarImage;
    if (image && this.#env.media.image(image)) {
      const night = this.#env.world.night;
      list.image(
        image,
        0,
        rect.x,
        rect.y,
        night ? { shade: { red: 100, green: 100, blue: 100, mono: false } } : { shade: { red: 255, green: 255, blue: 255, mono: false } },
      );
    }
    list.pushClip(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
    const box = this.#env.world.radarViewport();
    if (box) list.rectangle(rect.x + box.x1, rect.y + box.y1, rect.x + box.x2, rect.y + box.y2, RADAR_VIEW_COLOUR);
    for (const s of this.#view()?.soldiers ?? []) {
      if (isDead(s)) continue;
      const dot = this.#env.world.radarDot(s.gridNo);
      if (!dot) continue;
      const x = rect.x + dot.x;
      const y = rect.y + dot.y;
      list.rectangle(x, y, x + 1, y + 1, this.#radarColour(s));
    }
    list.popClip();
  }

  #radarColour(s: SoldierView): number {
    if (s.id === this.#selected && this.#radarBlink) return 0;
    if (s.team === OUR_TEAM && s.level > 0) return ON_ROOF_COLOUR;
    if (s.team !== OUR_TEAM && (s.healthIndex ?? 4) <= 0) return UNCONSCIOUS_COLOUR;
    if (s.team === CIV_TEAM && s.hostile === true) return HOSTILE_CIVILIAN_COLOUR;
    if (s.team === CIV_TEAM && s.profile !== undefined) return NAMED_CIVILIAN_COLOUR;
    return TEAM_RADAR_COLOURS[s.team] ?? TEAM_RADAR_COLOURS[0] ?? 0;
  }

  #squadList(list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void {
    const { height } = this.#env.runtime.geometry();
    const panel = frameRect('tacticalPanel', this.#env.runtime.geometry());
    list.image(
      view.model.asset(String(params.squadPanel)).path,
      0,
      panel.x + view.number(params.squadPanelX as number, {}),
      height - TEAMPANEL_HEIGHT,
    );
    const regionHeight = view.number(params.regionHeight as string, {});
    list.fill(rect.x, rect.y, rect.x + rect.width, rect.y + regionHeight, 0);
    const font = this.#env.runtime.fonts.get(view.model.font(String(params.font)));
    const top = rect.y + fontHeight(font);
    const w = idiv(rect.width, 2) - 1;
    const h = idiv(2 * regionHeight, NUMBER_OF_SQUADS);
    const present = this.#squadsOnMap();
    const half = idiv(NUMBER_OF_SQUADS, SQUAD_COLUMNS);
    for (let i = 0; i < NUMBER_OF_SQUADS; i++) {
      const colour =
        this.#hoveredSquad === i
          ? FontColor.WHITE
          : !present.has(i)
            ? FontColor.BLACK
            : this.#squad === i
              ? FontColor.LTGREEN
              : FontColor.DKGREEN;
      const x = i < half ? rect.x + 2 : rect.x + idiv(rect.width, 2) - 2;
      const y = top + (i < half ? i : i - half) * h;
      const label = this.#env.text.string('pSquadMenuStrings', i) ?? '';
      const at = hCenterVCenterAlign(x, y, w, h, label, font);
      mprint(list, font, x, at.y, label, fontColors(colour, DEFAULT_SHADOW, FontColor.BLACK));
    }
  }

  #pausedBox(list: DrawList, rect: Area): void {
    const fonts = this.#env.runtime.fonts;
    const box = new MercTextBox(
      this.#env.basicTextBox,
      { text: this.#env.text.string('pPausedGameText', 0) ?? '', width: rect.width, marginX: 0, marginTop: 0, marginBottom: 0 },
      { text: fonts.get('FONT12ARIAL'), bold: fonts.get('FONT10ARIALBOLD') },
    );
    const { width } = this.#env.runtime.geometry();
    box.render(list, idiv(width - box.width, 2), rect.y - idiv(box.height, 2));
  }
}

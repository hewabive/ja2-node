// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc MapScreenHandle (the selected sector on entry: the start sector before anyone was
// @src hired, else the loaded sector), CreateMouseRegionsForTeamList and MakeRegion (six regions per row, Y_SIZE + 1
// @src high, MSYS_PRIORITY_NORMAL + 1), TeamListInfoRegionBtnCallBackPrimary/Secondary, TeamList*MvtCallBack (the row
// @src under the pointer, the glowing columns, glowclick.wav), TeamListAssignmentRegionBtnCallBackPrimary
// @src (pMapErrorString[41] for a merc between sectors), TeamListDestinationRegionBtnCallBackPrimary/Secondary,
// @src TeamListSleepRegionBtnCallBackPrimary, TeamListContractRegionBtnCallBackPrimary, HandleCtrlOrShiftInTeamPanel,
// @src ResetAllSelectedCharacterModes, MapScreenMarkRegionBtnCallback, HandleMapUI (MAP_EVENT_CLICK_SECTOR,
// @src MAP_EVENT_PLOT_PATH, MAP_EVENT_CANCEL_PATH), MapViewRegionPrimaryCallback, MapViewRegionSecondaryCallback,
// @src MapViewRegionMovementCallback, GetSectorAtXY, SetUpCursorForStrategicMap and the checkmark over the last path
// @src sector, HandleKeyESC, HandleModNone/Shift/Ctrl/Alt, GoToNextCharacterInList, SelectAllCharactersInSquad,
// @src RequestContractMenu, ChangeCharacterListSortMethod, HandleNewDestConfirmation (a random awake selected merc
// @src confirms), JumpToLevel, InterruptTimeForMenus and UpdatePausedStatesDueToTimeCompression (time held while a menu,
// @src a box or plotting is open); src/game/Strategic/Map_Screen_Interface.cc DeselectSelectedListMercsWhoCantMoveWithThisGuy,
// @src SelectUnselectedMercsWhoMustMoveWithThisGuy, CanChangeSleepStatusForSoldier; src/game/Strategic/
// @src Map_Screen_Interface_Bottom.cc EnableDisableBottomButtonsAndRegions, EnableDisableTimeCompressButtons,
// @src CommonTimeCompressionChecks, AllowedToTimeCompress (the client half: plotting, menus, boxes, the sector inventory),
// @src RequestTriggerExitFromMapscreen. See docs/28 §7.

import { MAP_SIDE, type Sector, sectorId } from '../../../content/strategic/sector-ids.ts';
import { idiv } from '../../../core/int.ts';
import type { AssignmentOptions, MoveBoxOptions } from '../../../protocol/hints.ts';
import type { MessageEntry } from '../../../protocol/message-log.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import { refusalMessage } from '../../../protocol/refusals.ts';
import type { ContractOptionView, PlayerView, StrategicMercView, StrategicView, ViewFrame } from '../../../protocol/view.ts';
import { frameOf } from '../../assets.ts';
import type { DrawList } from '../../draw-list.ts';
import { isPointerEvent, KeyModifier, type UiInputEvent } from '../../input/events.ts';
import { MouseReason, NO_CURSOR, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { popupBoxStyle } from '../../layout/styles.ts';
import { type CustomRenderer, LayoutView } from '../../layout/view.ts';
import type { Screen } from '../../screen.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { FontName } from '../../text/fonts.ts';
import { printf } from '../../text/printf.ts';
import { UiScreenKind } from '../../widgets/button-sounds.ts';
import { MessageBox, MessageBoxFlag } from '../../widgets/message-box.ts';
import type { PopupBoxStyle } from '../../widgets/popup-box.ts';
import { portraitPath } from '../../widgets/portrait.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { drawSoldierBars } from '../tactical/bars.ts';
import { drawFace, FaceAnimator, type FaceArt, faceRecordOf } from '../tactical/faces.ts';
import { drawInventoryItem } from '../tactical/item-tile.ts';
import { formatMessageEntry } from '../tactical/message-format.ts';
import type { StatFlash } from '../tactical/panel-models.ts';
import { AssignmentMenus } from './assignment-menus.ts';
import { clockText, heliDistanceValues, renderBottomPanel, renderGroundEta, renderHeliDistances } from './bottom-panel.ts';
import {
  Assignment,
  CharacterList,
  groupOfMerc,
  MAX_CHARACTER_COUNT,
  mercById,
  mercPath,
  NO_CHARACTER,
  vehicleOfMerc,
} from './character-list.ts';
import { CompressionBlink, type CompressRequest, compressionCommand, compressionLabelSteady } from './compression.ts';
import { ContractMenu } from './contract-menu.ts';
import { type MapEnvironment, MapLayout } from './environment.ts';
import { foundSecrets, parseSectorLabel, sectorIdString, sectorLabel } from './facts.ts';
import { type FilterEffects, initialFilters, MapFilter, toggleFilter, turnOffAirspace, turnOnTeams } from './filters.ts';
import { cornerIcons, infoGeometry, renderCharacterInfo } from './info-panel.ts';
import { LayoutParams, type Params } from './layout-params.ts';
import { type MapAction, MapScreenController } from './map-controller.ts';
import { accessibleInventory, MapInventory } from './map-inventory.ts';
import { MenuMask } from './map-menu.ts';
import { departureBox, insuranceBox, type PromptBox, type PromptContext, promptBox } from './map-prompts.ts';
import {
  allowedToHighlight,
  helicopterIconPosition,
  type Locator,
  MAP_GRID_X,
  MAP_GRID_Y,
  MAP_VIEW_HEIGHT,
  MAP_VIEW_START_X,
  MAP_VIEW_START_Y,
  MAP_VIEW_WIDTH,
  type MapFilters,
  type MapViewArt,
  renderMapView,
} from './map-view.ts';
import { isMechanical, isPow, mercBars, mercSoldier } from './merc-soldier.ts';
import { dialogueLine, MapMessageList } from './message-list.ts';
import { MilitiaPopup, militiaArt, militiaGeometry } from './militia-popup.ts';
import { MoveBox } from './move-box.ts';
import { type MoveFeedback, type MovePlan, MoveSelection, moveMembers } from './move-selection.ts';
import { type PathGeometry, RouteAnimation, tracePathRoute } from './path-trace.ts';
import { Plotting, pathSectors } from './plotting.ts';
import { TEAM_COLUMN_KEYS, TeamColumn, TeamListView, teamGeometry } from './team-list-view.ts';
import { type TownBoxButtonArt, TownInfoBox } from './town-info-box.ts';
import { MapUiMessage } from './ui-message.ts';
import { UpdateBox, UpdateQueue } from './update-box.ts';

export const MAP_SCREEN_ID = 'map';
const OWNER = 'mapScreen';
const ROW_HELP = [0, 1, 5, 0, 2, 3];
const ROW_HELP_TABLE = 'pMapScreenMouseRegionHelpText';
const HAND_HELP_TABLE = 'pMiscMapScreenMouseRegionHelpText';
const SELECTED_FLASH_MS = 300;
const PAUSE_GAME_TIMER = 500;
const NEW_MAIL_PERIOD = 1000;
const NEW_MAIL_SHOWN = 667;
const MAP_REGION_PRIORITY = Priority.HIGH - 3;
const TEAM_PRIORITY = Priority.NORMAL + 1;
const MAP_REGION_EXTRA_HEIGHT = 8;
const MAP_ERROR = 'pMapErrorString';
const MAP_PLOT = 'pMapPlotStrings';
const MARKS = 'zMarksMapScreenText';
const BULLSEYE = 'pBullseyeStrings';
const LATE = 'gzLateLocalizedString';
const BETWEEN_SECTORS = 41;
const UNDERGROUND = 1;
const OFF_ROAD = 40;
const NO_MILITIA_TRAINING = 28;
const NO_MILITIA = 1;
const LEVEL_HELP = 0;
const MAP_SCREEN_FONT = 'MAP_SCREEN_FONT';
const UPDATE_PANEL = 'updatePanel';
const UPDATE_FACE = 'updateFace';
const SECTOR_INVENTORY_COMPRESS = 54;
const Plot = { CLICK_AGAIN: 0, CONFIRMED: 1, UNCHANGED: 2, CANCELED: 3, SHORTENED: 4 } as const;
const Bullseye = { CHOOSE: 0, CHANGED: 1, CANNOT: 2, CANCELED: 3 } as const;
const MAP_BOX_HEIGHT = 340;
const MAP_BOX_WIDTH = 640;
const START_SECTOR: Sector = { x: 9, y: 1, z: 0 };
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const DIGIT_CODE = /^Digit(\d)$/;
const UNDESCRIBED_REGIONS: ReadonlySet<string> = new Set(['mapScreenMask', 'mapMenuMask']);
const LEVELS = [0, 1, 2, 3];
const DEEPEST_LEVEL = 3;
const UPPER_HALF_ROW = 8;
const PLOT_MESSAGE_SHIFT = 100;
const SQUADS_PER_DIGIT_ROW = 10;
const OKLIFE = 15;
const HAND_SLOT = 5;
const MESSAGE_KINDS_HIDDEN: ReadonlySet<string> = new Set(['uiFeedback', 'skullFeedback']);
const FACE_ART: FaceArt = { hatch: 'interface/hatch.sti', dead: 'interface/p_dead.sti', icons: 'interface/portraiticons.sti' };
const COMPRESSION_REFUSALS_WITH_BATTLE: ReadonlySet<string> = new Set(['inCombat', 'enemiesPresent']);
const PLAYER_INFO_HAND = ['PLAYER_INFO_HAND_START_X', 'PLAYER_INFO_HAND_START_Y', 'PLAYER_INFO_HAND_END_X', 'PLAYER_INFO_HAND_END_Y'];
const PLAYER_INFO_FACE = ['PLAYER_INFO_FACE_START_X', 'PLAYER_INFO_FACE_START_Y', 'PLAYER_INFO_FACE_END_X', 'PLAYER_INFO_FACE_END_Y'];

export interface MapScreenHook {
  readonly selectedSector: string;
  readonly level: number;
  readonly info: number | null;
  readonly selected: readonly number[];
  readonly plotting: { readonly soldier: number; readonly mode: string; readonly legs: readonly string[] } | null;
  readonly filters: MapFilters;
  readonly menu: string | null;
  readonly uiMessage: string | null;
  readonly rows: readonly (number | null)[];
  readonly messages: readonly string[];
  readonly clock: string;
  readonly inventoryOpen: boolean;
  readonly changingArrival: boolean;
  readonly compression: { readonly mode: number; readonly compressing: boolean; readonly paused: boolean } | null;
  readonly flow: string | null;
  readonly prompt: string | null;
  readonly townBox: string | null;
  readonly militiaTown: number;
  readonly militiaCursor: readonly number[];
  readonly moveBox: readonly string[] | null;
  readonly updateBox: { readonly reason: number; readonly soldiers: readonly number[] } | null;
}

type Point = { readonly x: number; readonly y: number };

export class MapScreen implements Screen {
  readonly id = MAP_SCREEN_ID;
  readonly soundScreen = UiScreenKind.MAP;
  readonly rendersTooltips = true;
  readonly list = new CharacterList();
  readonly filters: MapFilters = initialFilters();
  readonly #env: MapEnvironment;
  readonly #model: LayoutModel;
  readonly #controller: MapScreenController;
  readonly #view: LayoutView;
  readonly #team: TeamListView;
  readonly #menus: AssignmentMenus;
  readonly #contract: ContractMenu;
  readonly #inventory: MapInventory;
  readonly #mask: MenuMask;
  readonly #townBox: TownInfoBox;
  readonly #militia: MilitiaPopup;
  readonly #moveBox: MoveBox;
  readonly #updateBox: UpdateBox;
  readonly #updates = new UpdateQueue();
  readonly #message = new MapUiMessage();
  readonly #messages = new MapMessageList();
  readonly #route = new RouteAnimation();
  readonly #blink = new CompressionBlink(PAUSE_GAME_TIMER);
  readonly #faces = new Map<number, FaceAnimator>();
  readonly #flashes = new Map<number, Map<string, StatFlash>>();
  readonly #handledPrompts = new Set<string>();
  #screenMask: MouseRegion | null = null;
  #selected: Sector = { ...START_SECTOR };
  #level = 0;
  #hover: Sector | null = null;
  #selectedYellow = true;
  #selectedFlashAt = 0;
  #plot: Plotting | null = null;
  #changingArrival = false;
  #inventoryOpen = false;
  #sectorInventoryOpen = false;
  #boxOpen = 0;
  #now = 0;
  #entered = false;
  #playerPaused = false;
  #leaving = false;

  constructor(env: MapEnvironment) {
    this.#env = env;
    this.#model = env.layout(MapLayout.SCREEN);
    this.#controller = new MapScreenController((action, args) => this.#action(action, args));
    this.#view = new LayoutView({
      model: this.#model,
      controller: this.#controller,
      services: env.runtime,
      sliders: env.runtime.sliders,
      text: env.text,
      messageBoxStyle: env.messageBoxStyle,
      messageBoxLabels: env.messageBoxLabels,
      custom: this.#renderers(),
      owner: OWNER,
    });
    this.#team = new TeamListView(teamGeometry(this.#model, this.#font(FontName.BLOCKFONT2)));
    this.#mask = new MenuMask(env.runtime.regions, OWNER, () => this.#closeMenus());
    this.#menus = new AssignmentMenus({
      regions: env.runtime.regions,
      text: env.text,
      owner: OWNER,
      style: (name) => this.#popupStyle(name === 'squad' ? 'squadPopup' : 'assignmentPopup'),
      origin: () => this.#origin(),
      strategic: () => this.#strategic(),
      others: (soldier) => this.list.selectedIds().filter((id) => id !== soldier),
      resetSelected: () => this.list.resetSelected(),
      send: (cmd) => env.client.command(cmd),
      options: (soldier) => this.#assignmentOptions(soldier),
      box: (text) => void this.#mapBox(text),
      feedback: (text) => this.#uiMessage(text),
      townOf: (sector) => this.#townOf(sector),
      fontHeight: () => this.#team.geometry.ySize,
      closed: () => this.#syncMask(false),
    });
    this.#contract = new ContractMenu({
      regions: env.runtime.regions,
      text: env.text,
      owner: OWNER,
      style: () => this.#popupStyle('contractPopup'),
      origin: () => this.#origin(),
      query: (soldier) => this.#contractOptions(soldier),
      send: (cmd) => env.client.command(cmd),
      confirm: (text) => env.boxes.confirm(text),
      closed: () => this.#syncMask(false),
    });
    this.#townBox = this.#createTownBox();
    this.#militia = this.#createMilitiaPopup();
    this.#inventory = new MapInventory({
      env,
      infoMerc: () => this.list.infoMerc(this.#strategic()),
      location: () => ({ sector: sectorLabel({ ...this.#selected, z: 0 }), z: this.#level }),
      box: (text, flags) => this.#openBox({ text, flags, answer: () => null }),
      shift: () => (env.runtime.modifiers & KeyModifier.SHIFT) !== 0,
      mercClosed: () => {
        this.#inventoryOpen = false;
      },
      poolClosed: () => {
        this.#sectorInventoryOpen = false;
      },
    });
    this.#moveBox = new MoveBox({
      regions: env.runtime.regions,
      text: env.text,
      owner: OWNER,
      style: () => this.#popupStyle('movePopup'),
      origin: () => this.#origin(),
      now: () => this.#now,
      vehicleType: (vehicle) => (this.#strategic()?.vehicles ?? []).find((v) => v.id === vehicle)?.type ?? 0,
      report: (feedback) => this.#moveFeedback(feedback),
      done: (plan) => this.#startGroupPlotting(plan),
      closed: () => undefined,
    });
    this.#updateBox = new UpdateBox({
      services: env.runtime,
      text: env.text,
      origin: () => this.#origin(),
      mapFont: () => this.#font(this.#model.font(MAP_SCREEN_FONT)),
      panel: this.#model.asset(UPDATE_PANEL).path,
      faces: this.#model.asset(UPDATE_FACE).path,
      merc: (id) => mercById(this.#strategic(), id),
      face: (id) => this.#mediumFace(id),
      ensure: (path) => env.media.image(path),
      beep: () => env.sounds.newMessageBeep(),
      finished: (continueTime) => void this.#updateFinished(continueTime),
    });
  }

  get mapInventory(): MapInventory {
    return this.#inventory;
  }

  #createTownBox(): TownInfoBox {
    const env = this.#env;
    return new TownInfoBox({
      buttons: env.runtime.buttons,
      text: env.text,
      style: () => this.#popupStyle('townPopup'),
      art: () => this.#townButtonArt(),
      origin: () => this.#origin(),
      frameWidth: (asset, frame) => frameOf(env.runtime.images, asset, frame).width,
      input: () => {
        const strategic = this.#strategic();
        if (!strategic) return null;
        const found = foundSecrets(strategic.secretsFound);
        return { facts: env.facts, text: env.text, strategic, found, minesShown: this.filters.mines };
      },
      inventory: (s) => {
        this.#changeSelectedSector(s);
        this.openSectorInventory();
      },
      closed: () => this.#syncMask(false),
    });
  }

  #townButtonArt(): TownBoxButtonArt {
    const style = this.#model.style('townButtons') as Readonly<Record<string, unknown>>;
    const frames = (key: string): readonly [number, number] => {
      const [off = 0, on = 0] = (style[key] as readonly number[] | undefined) ?? [];
      return [off, on];
    };
    return {
      asset: this.#model.asset(String(style.asset)).path,
      inventory: frames('inventory'),
      exit: frames('exit'),
      font: this.#font(this.#model.font(String(style.font))),
      color: this.#model.color(style.color as string, 0),
      shadow: this.#model.color(style.shadow as string, 0),
    };
  }

  #createMilitiaPopup(): MilitiaPopup {
    const env = this.#env;
    const geometry = militiaGeometry(this.#model);
    const art = militiaArt(this.#model, env.runtime.fonts, 'militiaPopup');
    return new MilitiaPopup({
      regions: env.runtime.regions,
      buttons: env.runtime.buttons,
      text: env.text,
      facts: env.facts,
      origin: () => this.#origin(),
      geometry: () => geometry,
      art: () => art,
      strategic: () => this.#strategic(),
      battleSector: () => this.#battleSector(),
      send: (cmd) => env.client.command(cmd),
      box: (text) => void this.#mapBox(text),
    });
  }

  #battleSector(): string | null {
    const view = this.#playerView();
    const world = view?.strategic?.worldSector ?? null;
    const hostile = view?.combat != null || (view?.soldiers ?? []).some((s) => s.team !== 0 && s.hostile === true);
    return world && hostile ? world : null;
  }

  #sectorInfoClick(s: Sector): void {
    if (this.filters.militia) {
      this.#militia.request(s);
      return;
    }
    if (s.z !== 0 && !this.#visitedUnderground(s)) return;
    if (this.#townBox.open) {
      this.#townBox.close(false);
      this.#syncMask(false);
    } else void this.#withMask(() => this.#townBox.show(s));
  }

  get selectedSector(): Sector {
    return this.#selected;
  }

  get level(): number {
    return this.#level;
  }

  get plotting(): Plotting | null {
    return this.#plot;
  }

  get inventoryOpen(): boolean {
    return this.#inventoryOpen;
  }

  hook(): MapScreenHook {
    return {
      selectedSector: sectorLabel(this.#selected),
      level: this.#level,
      info: this.list.slots[this.list.info]?.merc ?? null,
      selected: this.list.selectedIds(),
      plotting: this.#plot ? { soldier: this.#plot.soldier, mode: this.#plot.mode, legs: this.#plot.legs } : null,
      filters: { ...this.filters },
      menu: this.#menus.open ? 'assignment' : this.#contract.open ? 'contract' : null,
      uiMessage: this.#message.text,
      rows: this.list.slots.map((s) => s.merc),
      messages: this.#messages.lines.map((l) => l.text),
      clock: clockText(this.#env.text, this.#playerView()?.clock ?? null, this.#playerPaused),
      inventoryOpen: this.#inventoryOpen,
      changingArrival: this.#changingArrival,
      compression: this.#compressionHook(),
      flow: this.#strategic()?.flow ?? null,
      prompt: this.#playerView()?.prompt?.kind ?? this.#playerView()?.contractPrompt?.kind ?? null,
      townBox: this.#townBox.sector ? sectorLabel(this.#townBox.sector) : null,
      militiaTown: this.#militia.town,
      militiaCursor: this.#militia.cursor,
      moveBox: this.#moveBox.open ? this.#moveBox.lines.map((l) => l.text) : null,
      updateBox: this.#updateBox.batch,
    };
  }

  #compressionHook(): MapScreenHook['compression'] {
    const clock = this.#playerView()?.clock;
    return clock ? { mode: clock.mode ?? 0, compressing: clock.compressing, paused: clock.paused ?? false } : null;
  }

  #strategic(): StrategicView | undefined {
    return this.#env.client.view?.strategic;
  }

  #playerView(): PlayerView | null {
    return this.#env.client.view;
  }

  #origin(): Point {
    const g = this.#env.runtime.geometry();
    return { x: g.stdX, y: g.stdY };
  }

  #font(name: string): BitmapFont {
    return this.#env.runtime.fonts.get(name);
  }

  #params(params: Params): LayoutParams {
    return new LayoutParams(this.#model, params, this.#env.runtime.fonts);
  }

  #popupStyle(name: string): PopupBoxStyle {
    return popupBoxStyle(this.#model, this.#model.style(name) as Readonly<Record<string, unknown>>, this.#env.runtime.fonts);
  }

  #text(table: string, index: number): string {
    return this.#env.text.string(table, index) ?? '';
  }

  #townOf(sector: string): number {
    const s = parseSectorLabel(sector);
    return s ? this.#env.facts.townOf(sectorId(s)) : 0;
  }

  #sectorName(label: string, detailed: boolean): string {
    const s = parseSectorLabel(label);
    if (!s) return label;
    const found = foundSecrets(this.#strategic()?.secretsFound);
    return sectorIdString(this.#env.facts, this.#env.text, found, s, detailed, (u) => this.#visitedUnderground(u));
  }

  #visitedUnderground(s: Sector): boolean {
    return (this.#strategic()?.underground ?? []).some((u) => {
      const v = parseSectorLabel(u.sector);
      return v !== null && v.x === s.x && v.y === s.y && v.z === s.z;
    });
  }

  #heli() {
    const heli = this.#strategic()?.helicopter;
    return heli && !('destroyed' in heli) ? heli : null;
  }

  enter(): void {
    this.#entered = true;
    this.#view.build();
    const strategic = this.#strategic();
    const world = strategic?.worldSector ? parseSectorLabel(strategic.worldSector) : null;
    if (!strategic || strategic.mercs.length === 0) this.#changeSelectedSector(START_SECTOR);
    else if (world) this.#changeSelectedSector(world);
    this.list.rebuild(strategic, false);
    this.#defineRegions();
    this.#inventory.enter();
    this.#env.client.start();
  }

  exit(): void {
    this.#entered = false;
    this.#abortPlotting(false);
    this.#closeMenus();
    this.#militia.close();
    this.#moveBox.close(false);
    this.#updateBox.end(null);
    this.#message.end();
    this.#inventory.exit();
    this.#inventoryOpen = false;
    this.#sectorInventoryOpen = false;
    this.#env.client.stop();
    this.#env.runtime.regions.removeOwner(OWNER);
    this.#screenMask = null;
    this.#view.dispose();
  }

  #defineRegions(): void {
    const regions = this.#env.runtime.regions;
    const o = this.#origin();
    this.#screenMask = regions.define({
      x1: 0,
      y1: 0,
      x2: 0xffff,
      y2: 0xffff,
      priority: Priority.LOW,
      cursor: 0,
      owner: OWNER,
      id: 'mapScreenMask',
      onButton: (_r, reason) => {
        if (reason & (MouseReason.LBUTTON_UP | MouseReason.RBUTTON_UP)) this.#resetModes();
      },
    });
    regions.define({
      x1: o.x + MAP_VIEW_START_X + MAP_GRID_X,
      y1: o.y + MAP_VIEW_START_Y + MAP_GRID_Y,
      x2: o.x + MAP_VIEW_START_X + MAP_VIEW_WIDTH + MAP_GRID_X - 1,
      y2: o.y + MAP_VIEW_START_Y + MAP_VIEW_HEIGHT - 1 + MAP_REGION_EXTRA_HEIGHT,
      priority: MAP_REGION_PRIORITY,
      cursor: NO_CURSOR,
      owner: OWNER,
      id: 'mapView',
      onMove: (r, reason) => this.#mapMove(r, reason),
      onButton: (r, reason) => this.#mapButton(r, reason),
    });
    this.#defineTeamRegions();
    this.#defineInfoRegions();
  }

  #defineTeamRegions(): void {
    const regions = this.#env.runtime.regions;
    const o = this.#origin();
    const g = this.#team.geometry;
    for (let row = 0; row < MAX_CHARACTER_COUNT; row++) {
      const y = o.y + this.#team.rowY(row);
      g.columns.forEach(([x, w], column) => {
        const region = regions.define({
          x1: o.x + x,
          y1: y,
          x2: o.x + x + w,
          y2: y + g.ySize + 1,
          priority: TEAM_PRIORITY,
          cursor: NO_CURSOR,
          owner: OWNER,
          id: `teamRow${row}.${TEAM_COLUMN_KEYS[column]}`,
          onMove: (_r, reason) => this.#rowMove(row, column, reason),
          onButton: (_r, reason) => this.#rowButton(row, column, reason),
        });
        region.setTooltip(this.#text(ROW_HELP_TABLE, ROW_HELP[column] ?? 0));
      });
    }
  }

  #box(names: readonly string[]): { x1: number; y1: number; x2: number; y2: number } {
    const o = this.#origin();
    const [x1, y1, x2, y2] = names.map((n) => this.#model.number(n));
    return { x1: o.x + (x1 ?? 0), y1: o.y + (y1 ?? 0), x2: o.x + (x2 ?? 0), y2: o.y + (y2 ?? 0) };
  }

  #defineInfoRegions(): void {
    const regions = this.#env.runtime.regions;
    regions.define({
      ...this.#box(PLAYER_INFO_FACE),
      priority: Priority.HIGH,
      cursor: NO_CURSOR,
      owner: OWNER,
      id: 'infoFace',
      onButton: (_r, reason) => {
        if (reason & MouseReason.RBUTTON_UP) this.#toggleInventory();
      },
    });
    const hand = regions.define({
      ...this.#box(PLAYER_INFO_HAND),
      priority: Priority.HIGH,
      cursor: NO_CURSOR,
      owner: OWNER,
      id: 'infoHand',
      onButton: (_r, reason) => {
        if (reason & MouseReason.LBUTTON_UP) this.#toggleInventory();
      },
    });
    hand.setTooltip(this.#text(HAND_HELP_TABLE, 0));
  }

  frames(frames: readonly ViewFrame[]): void {
    const mercs = this.#strategic()?.mercs ?? [];
    for (const frame of frames) this.#updates.observe(frame.events ?? [], mercs, this.#env.notifySleepWake());
    for (const frame of frames)
      for (const event of frame.events ?? []) {
        if (event.type === 'statChanged') {
          const key = event.stat === 'experience' ? 'level' : event.stat;
          const flashes = this.#flashes.get(event.soldier) ?? new Map<string, StatFlash>();
          flashes.set(key, { at: this.#now, up: event.change > 0 });
          this.#flashes.set(event.soldier, flashes);
        } else if (event.type === 'groupArrived' && event.final) this.#arrivalSelection(event.sector);
      }
    this.#inventory.frames(frames);
  }

  #mercsIn(s: Sector, z: number): StrategicMercView[] {
    return (this.#strategic()?.mercs ?? []).filter((m) => {
      const at = parseSectorLabel(m.sector);
      return at !== null && at.x === s.x && at.y === s.y && at.z === z;
    });
  }

  #arrivalSelection(sector: string): void {
    const s = parseSectorLabel(sector);
    if (s && this.#mercsIn(this.#selected, this.#selected.z).length === 0) this.#changeSelectedSector(s);
  }

  #changeSelectedSector(s: Sector): void {
    if (this.#sectorInventoryOpen || !allowedToHighlight(this.#env.facts, s)) return;
    this.#selected = { x: s.x, y: s.y, z: s.z };
    this.#level = s.z;
  }

  update(): void {
    this.#now = this.#env.runtime.clock.ja2Now;
    this.#inventoryOpen = this.#inventory.merc.open;
    this.#sectorInventoryOpen = this.#inventory.pool.open;
    const strategic = this.#strategic();
    if (this.list.needsRebuild(strategic)) this.list.rebuild(strategic, true);
    this.#team.update(this.#now);
    this.#updateSelectedFlash();
    this.#updateFace();
    this.#updateMessages();
    this.#updatePlotting();
    this.#syncPrompts();
    this.#message.update(this.#now, false);
    this.#syncCursor();
    this.#inventory.update(this.#now);
    this.#syncModel();
    if (this.#militia.open && !this.filters.militia) this.#militia.close();
    this.#militia.update();
    this.#env.client.holdTime('townBox', this.#townBox.open);
    this.#env.client.holdTime('militia', this.#militia.open);
    this.#showNextUpdate();
    this.#env.client.holdTime('updateBox', this.#updateBox.open);
    this.#env.client.holdTime('moveBox', this.#moveBox.open);
    this.#env.client.holdTime('menus', this.#menus.open || this.#contract.open);
    this.#env.client.holdTime('inventory', this.#inventory.holding || this.#sectorInventoryOpen);
    this.#env.client.holdTime('plotting', this.#plot !== null);
    this.#view.update();
  }

  #updateSelectedFlash(): void {
    const hoveringSelected = this.#hover !== null && this.#hover.x === this.#selected.x && this.#hover.y === this.#selected.y;
    if (!hoveringSelected) {
      this.#selectedYellow = true;
      return;
    }
    if (this.#now - this.#selectedFlashAt <= SELECTED_FLASH_MS) return;
    this.#selectedFlashAt = this.#now;
    this.#selectedYellow = !this.#selectedYellow;
  }

  #updateFace(): void {
    const m = this.list.infoMerc(this.#strategic());
    if (!m) return;
    const soldier = mercSoldier(this.#playerView(), m);
    let face = this.#faces.get(m.id);
    if (!face) {
      const profile = m.profile !== undefined ? this.#env.media.profile(m.profile) : null;
      face = new FaceAnimator(faceRecordOf(soldier, profile), this.#now, this.#env.random);
      this.#faces.set(m.id, face);
    }
    this.#env.media.image(face.record.path);
    const speech = this.#env.media.speech();
    const speaking = speech && speech.speaker === m.id ? speech : null;
    const gaps = speaking ? (this.#env.media.gaps(speaking.file) ?? []) : [];
    const playback = speaking ? { playing: speaking.playing, elapsedMs: speaking.elapsedMs, gaps } : null;
    face.update(this.#now, soldier, playback, this.#env.runtime.images);
  }

  #updateMessages(): void {
    const font = this.#font(FontName.TINYFONT1);
    const grew = this.#messages.rebuild(this.#env.media.messages(), (e) => this.#formatEntry(e), font);
    if (grew && this.#entered) this.#env.sounds.newMessageBeep();
  }

  #formatEntry(entry: MessageEntry): string | null {
    if (MESSAGE_KINDS_HIDDEN.has(entry.kind)) return null;
    if (entry.kind !== 'dialog')
      return formatMessageEntry(entry, { text: this.#env.text, itemByIndex: (i) => this.#env.media.itemByIndex(i) });
    const key = entry.textKey;
    const line = key ? this.#env.media.dialogueText(key.file, key.row) : null;
    if (line === null) return null;
    const name = entry.speaker !== undefined ? (this.#env.media.profile(entry.speaker)?.nickname ?? '') : '';
    return name ? dialogueLine(name, line) : line;
  }

  #updatePlotting(): void {
    const plot = this.#plot;
    if (!plot) return;
    plot.shortest = (this.#env.runtime.modifiers & KeyModifier.SHIFT) !== 0;
    plot.hoverAt(this.#hover, this.#now);
    const base = this.#plotBase(plot);
    if (base === null) {
      this.#plot = null;
      return;
    }
    plot.baseChanged(base);
    plot.update(this.#env.client, this.#now);
  }

  #plotBase(plot: Plotting): readonly string[] | null {
    if (plot.mode === 'heli') return this.#heli()?.path ?? null;
    const strategic = this.#strategic();
    const m = mercById(strategic, plot.soldier);
    return strategic && m ? mercPath(strategic, m) : null;
  }

  #syncCursor(): void {
    const mask = this.#screenMask;
    if (!mask) return;
    mask.cursor = this.#model.cursor(this.#cursorName());
  }

  #cursorName(): string {
    const plot = this.#plot;
    if (this.#changingArrival) return 'CURSOR_STRATEGIC_BULLSEYE';
    if (!plot) return 'CURSOR_NORMAL';
    const hover = this.#hover;
    if (hover && sectorLabel({ ...hover, z: 0 }) === plot.lastSectorOrOrigin().split('-')[0]) return 'CURSOR_CHECKMARK';
    if (plot.mode === 'heli') return 'CURSOR_CHOPPER';
    const m = mercById(this.#strategic(), plot.soldier);
    return m?.assignment === Assignment.VEHICLE ? 'CURSOR_STRATEGIC_VEHICLE' : 'CURSOR_STRATEGIC_FOOT';
  }

  #compressionAllowedByUi(): boolean {
    return (
      this.#plot === null &&
      !this.#menus.open &&
      !this.#contract.open &&
      !this.#townBox.open &&
      !this.#militia.open &&
      !this.#sectorInventoryOpen &&
      !this.#inventory.holding &&
      this.#boxOpen === 0 &&
      !this.#changingArrival &&
      !this.#moveBox.open &&
      !this.#updateBox.open
    );
  }

  #syncModel(): void {
    const m = this.#controller.model;
    const strategic = this.#strategic();
    const clock = this.#playerView()?.clock;
    const info = this.list.infoMerc(strategic);
    const exitAllowed = this.#allowedToExit();
    m.inventoryOpen = this.#inventoryOpen;
    m.sectorInventoryOpen = this.#sectorInventoryOpen;
    m.levelMarkerY = this.#model.number('MAP_LEVEL_MARKER_Y') + this.#model.number('MAP_LEVEL_MARKER_DELTA') * this.#level;
    m.mechanical = info !== null && isMechanical(info);
    m.contractEnabled = info !== null && this.#canExtendContract(info);
    m.prevNextEnabled = this.list.slots.filter((s) => s.merc !== null).length >= 2;
    m.townsOn = this.filters.towns;
    m.minesOn = this.filters.mines;
    m.teamsOn = this.filters.teams;
    m.militiaOn = this.filters.militia;
    m.airspaceOn = this.filters.airspace;
    m.itemsOn = this.filters.items;
    m.tacticalEnabled = this.#canEnterSelected();
    m.laptopEnabled = exitAllowed;
    m.optionsEnabled = exitAllowed;
    m.newMailShown = (strategic?.newMail ?? false) && this.#now % NEW_MAIL_PERIOD < NEW_MAIL_SHOWN;
    const allowed = this.#compressionAllowedByUi() && (clock?.canCompress ?? true);
    m.compressionMasked = !allowed;
    m.compressLessEnabled = allowed && clock?.compressing === true;
    m.compressMoreEnabled = allowed && (clock?.compressing !== true || (clock.mode ?? 0) < 4);
    m.messageUpEnabled = this.#messages.canScrollUp;
    m.messageDownEnabled = this.#messages.canScrollDown;
    m.pauseHelp = this.#text('pPausedGameText', this.#playerPaused ? 1 : 2);
    m.balance = strategic?.balance ?? 0;
    m.income = strategic?.projectedDailyIncome ?? 0;
    m.sectorName = this.#sectorName(sectorLabel(this.#selected), true);
    if (m.levelHelp.length === 0) m.levelHelp = LEVELS.map((level) => `${this.#text(MARKS, LEVEL_HELP)} ${level + 1}`);
  }

  #canExtendContract(m: StrategicMercView): boolean {
    return !isMechanical(m) && m.kind !== 'epc' && m.assignment !== Assignment.IN_TRANSIT && !isPow(m);
  }

  #allowedToExit(): boolean {
    const view = this.#playerView();
    return !view?.prompt && !view?.contractPrompt && this.#plot === null && !this.#leaving && !this.#updateBox.open;
  }

  #canEnterSelected(): boolean {
    if (!this.#allowedToExit() || this.#sectorInventoryOpen) return false;
    const reply = this.#env.client.hint({ type: 'canEnterSector', sector: sectorLabel(this.#selected) });
    return reply.state === 'ready' && reply.answer.ok && (reply.answer.data as { allowed: boolean }).allowed;
  }

  async #assignmentOptions(soldier: number): Promise<AssignmentOptions | null> {
    const answer = await this.#env.client.hintNow({ type: 'assignmentOptions', soldier });
    return answer.ok ? (answer.data as AssignmentOptions) : null;
  }

  async #contractOptions(soldier: number): Promise<readonly ContractOptionView[] | null> {
    const answer = await this.#env.client.query({ type: 'contractOptions', soldier });
    return answer.ok ? ((answer.data as { options?: ContractOptionView[] }).options ?? null) : null;
  }

  #mapBox(text: string): Promise<number> {
    return this.#openBox({ text, flags: MessageBoxFlag.OK, answer: () => null });
  }

  #openBox(spec: PromptBox): Promise<number> {
    const o = this.#origin();
    this.#boxOpen++;
    return new Promise((resolve) => {
      const labels = {
        ...this.#env.messageBoxLabels,
        ...(spec.user1 ? { user1: spec.user1 } : {}),
        ...(spec.user2 ? { user2: spec.user2 } : {}),
      };
      this.#env.runtime.host.openModal(
        new MessageBox(this.#env.runtime, {
          style: this.#env.messageBoxStyle(0),
          text: spec.text,
          flags: spec.flags,
          labels,
          centeringRect: { x: o.x, y: o.y, width: MAP_BOX_WIDTH, height: MAP_BOX_HEIGHT },
          onClose: (result) => {
            this.#boxOpen--;
            resolve(result);
          },
        }),
      );
    });
  }

  #uiMessage(text: string, deltaY = 0): void {
    this.#message.begin(text, deltaY, this.#now, this.#env.basicTextBox, {
      text: this.#font(FontName.FONT12ARIAL),
      bold: this.#font(FontName.FONT10ARIALBOLD),
    });
  }

  #refusalText(token: string | null | undefined, args: readonly (string | number)[] = []): string | null {
    const message = token ? refusalMessage(token) : null;
    return message ? printf(this.#text(message.table, message.index), args) : null;
  }

  #refusalOf(reply: { readonly data?: unknown; readonly reason?: string }): string | null {
    return (reply.data as { refusal?: string } | undefined)?.refusal ?? null;
  }

  #promptContext(): PromptContext {
    return {
      text: this.#env.text,
      strategic: this.#strategic(),
      sectorName: (label, detailed) => this.#sectorName(label, detailed),
      townOf: (label) => this.#townOf(label),
    };
  }

  #syncPrompts(): void {
    const view = this.#playerView();
    const prompt = view?.prompt ?? null;
    if (prompt && !this.#handledPrompts.has(prompt.id)) {
      this.#handledPrompts.add(prompt.id);
      if (prompt.kind === 'preBattle') this.#env.flow.preBattle();
      const box = promptBox(this.#promptContext(), prompt);
      if (box) void this.#answerPrompt(prompt.id, box);
    }
    const contract = view?.contractPrompt ?? null;
    if (!contract || this.#handledPrompts.has(contract.id)) return;
    this.#handledPrompts.add(contract.id);
    if (contract.kind === 'contractRenewal') {
      const row = this.list.rowOf(contract.soldier);
      if (row >= 0) this.list.changeInfo(row, true);
      this.#closeMenus();
      void this.#withMask(() =>
        this.#contract.showRenewal(contract.soldier, row >= 0 ? this.#team.rowY(row) : null, {
          id: contract.id,
          options: contract.options,
        }),
      );
    } else if (contract.kind === 'mercDeparture') void this.#answerPrompt(contract.id, departureBox(this.#promptContext(), contract));
    else void this.#answerPrompt(contract.id, insuranceBox(this.#promptContext(), contract));
  }

  async #answerPrompt(id: string, box: PromptBox): Promise<void> {
    const choice = box.answer(await this.#openBox(box));
    if (choice) await this.#env.client.command({ type: 'answer', prompt: id, choice });
  }

  async #withMask(show: () => Promise<void> | void): Promise<void> {
    this.#mask.sync(true, true);
    await show();
    this.#syncMask(false);
  }

  #syncMask(opening: boolean): void {
    this.#mask.sync(this.#menus.open || this.#contract.open || this.#townBox.open, opening);
  }

  #closeMenus(): void {
    this.#menus.close(false);
    const renewal = this.#contract.renewalId;
    this.#contract.close(false);
    this.#townBox.close(false);
    if (renewal) void this.#env.client.command({ type: 'answer', prompt: renewal, choice: 'letGo' });
    this.#mask.sync(false, false);
  }

  #resetModes(): void {
    this.#militia.close();
    if (this.#plot) this.#abortPlotting(true);
    this.#team.stopGlow();
  }

  #mercAt(row: number): StrategicMercView | null {
    return this.list.merc(this.#strategic(), row);
  }

  #ctrlOrShift(row: number): boolean {
    const mods = this.#env.runtime.modifiers;
    if (mods & KeyModifier.CTRL) this.list.toggle(row);
    else if (mods & KeyModifier.SHIFT) this.list.selectRange(this.list.info, row);
    else return false;
    return true;
  }

  #rowMove(row: number, column: number, reason: number): void {
    if (reason & MouseReason.LOST_MOUSE) {
      if (this.#team.highLine === row) this.#team.highLine = NO_CHARACTER;
      const glow = this.#team.glow;
      if (glow?.line === row && glow.column === column && !this.#glowPinned(column)) this.#team.stopGlow();
      return;
    }
    const m = this.#mercAt(row);
    if (!m) {
      this.#team.highLine = NO_CHARACTER;
      return;
    }
    this.#team.highLine = row;
    if (!this.#columnGlows(column, m) || this.#glowPinned(this.#team.glow?.column ?? -1)) return;
    this.#team.startGlow(row, column);
    if (reason & MouseReason.GAIN_MOUSE) this.#env.sounds.glowClick();
  }

  #columnGlows(column: number, m: StrategicMercView): boolean {
    if (column === TeamColumn.SLEEP) return m.canChangeSleep !== false;
    return column === TeamColumn.ASSIGNMENT || column === TeamColumn.DESTINATION || column === TeamColumn.CONTRACT;
  }

  #glowPinned(column: number): boolean {
    if (column === TeamColumn.DESTINATION) return this.#plot !== null;
    if (column === TeamColumn.ASSIGNMENT) return this.#menus.open;
    if (column === TeamColumn.CONTRACT) return this.#contract.open;
    return false;
  }

  #rowButton(row: number, column: number, reason: number): void {
    const left = (reason & MouseReason.LBUTTON_UP) !== 0;
    if (!left && (reason & MouseReason.RBUTTON_UP) === 0) return;
    const m = this.#mercAt(row);
    if (!m) {
      this.#resetModes();
      return;
    }
    if (column === TeamColumn.NAME || column === TeamColumn.LOCATION) {
      if (left) this.#infoClick(row, m);
      else this.#infoSecondary(row, m);
    } else if (column === TeamColumn.DESTINATION) {
      if (left) void this.#destinationClick(row, m);
      else this.#cancelSelectedPaths();
    } else if (!left) this.#resetModes();
    else if (column === TeamColumn.ASSIGNMENT) this.#assignmentClick(row, m);
    else if (column === TeamColumn.SLEEP) void this.#sleepClick(row, m);
    else this.#contractClick(row);
  }

  #infoClick(row: number, m: StrategicMercView): void {
    if (this.#ctrlOrShift(row)) return;
    this.list.changeInfo(row, true);
    if (this.#plot) this.#abortPlotting(false);
    if (m.life > 0 && !isPow(m)) this.#selectMercSector(m);
  }

  #infoSecondary(row: number, m: StrategicMercView): void {
    this.#resetModes();
    this.list.changeInfo(row, true);
    this.#toggleInventory();
    if (m.life > 0 && !isPow(m)) this.#selectMercSector(m);
  }

  #selectMercSector(m: StrategicMercView): void {
    const s = parseSectorLabel(m.sector);
    if (s) this.#changeSelectedSector(s);
  }

  #assignmentClick(row: number, m: StrategicMercView): void {
    if (this.#ctrlOrShift(row)) return;
    this.list.changeInfo(row, !this.list.isSelected(row));
    if (m.assignment !== Assignment.ASSIGNMENT_DEAD && m.life > 0 && m.betweenSectors) {
      void this.#mapBox(this.#text(MAP_ERROR, BETWEEN_SECTORS));
      return;
    }
    if (this.#plot) this.#abortPlotting(false);
    this.#contract.close(false);
    this.#showAssignmentMenu(m.id, row);
  }

  #showAssignmentMenu(soldier: number, row: number): void {
    void this.#withMask(() => this.#menus.show(soldier, this.#team.rowY(row)));
  }

  async #sleepClick(row: number, m: StrategicMercView): Promise<void> {
    if (this.#ctrlOrShift(row)) return;
    this.list.changeInfo(row, !this.list.isSelected(row));
    if (m.canChangeSleep === false) return;
    const type = m.asleep ? 'wake' : 'sleep';
    const others = this.list.selectedIds().filter((id) => id !== m.id);
    const first = await this.#env.client.command({ type, soldier: m.id });
    for (const id of others) await this.#env.client.command({ type, soldier: id });
    const text = first.ok ? null : this.#refusalText(this.#refusalOf(first), [m.name]);
    if (text) void this.#mapBox(text);
  }

  async #destinationClick(row: number, m: StrategicMercView): Promise<void> {
    if (this.#sectorInventoryOpen || this.#ctrlOrShift(row)) return;
    this.list.changeInfo(row, !this.list.isSelected(row));
    this.#adjustMovers(m);
    const origin = m.sector.split('-')[0] ?? m.sector;
    const check = await this.#env.client.hintNow({ type: 'previewRoute', soldier: m.id, to: origin, extend: true });
    if (!check.ok) {
      const text = this.#refusalText(this.#refusalOf(check), [m.name]);
      if (text) void this.#mapBox(text);
      return;
    }
    const strategic = this.#strategic();
    if (!strategic) return;
    this.#closeMenus();
    if (this.filters.items) toggleFilter(this.filters, MapFilter.ITEMS);
    turnOnTeams(this.filters);
    this.#applyFilterEffects(turnOffAirspace(this.filters));
    const s = parseSectorLabel(m.sector);
    if (s) this.#level = s.z;
    this.#plot = new Plotting('merc', m.id, row, origin, mercPath(strategic, m));
    this.#route.reset();
    this.#team.startGlow(row, TeamColumn.DESTINATION);
  }

  #adjustMovers(m: StrategicMercView): void {
    const strategic = this.#strategic();
    if (!strategic) return;
    const group = groupOfMerc(strategic, m.id);
    const vehicle = vehicleOfMerc(strategic, m);
    this.list.slots.forEach((slot, row) => {
      const other = slot.merc !== null ? mercById(strategic, slot.merc) : null;
      if (!other) return;
      const sameUnit =
        group?.members.includes(other.id) === true ||
        (vehicle !== null && other.vehicle === vehicle.id) ||
        (m.squad !== null && other.squad === m.squad);
      const sameSector = other.sector === m.sector && other.betweenSectors === m.betweenSectors;
      const sameMode = (vehicle !== null) === (other.assignment === Assignment.VEHICLE);
      if (sameUnit) this.list.setSelected(row, true);
      else if (slot.selected && (!sameSector || !sameMode)) this.list.setSelected(row, false);
    });
  }

  #cancelSelectedPaths(): void {
    if (this.#sectorInventoryOpen) return;
    const strategic = this.#strategic();
    const done = new Set<number>();
    for (const id of this.list.selectedIds()) {
      const key = (strategic ? groupOfMerc(strategic, id)?.id : undefined) ?? -id - 1;
      if (done.has(key)) continue;
      done.add(key);
      void this.#env.client.command({ type: 'cancelRoute', soldier: id });
    }
    this.#resetModes();
  }

  #contractClick(row: number): void {
    this.list.changeInfo(row, true);
    if (this.#plot) this.#abortPlotting(false);
    const m = this.#mercAt(row);
    if (m && this.#canExtendContract(m)) this.#requestContractMenu(this.#team.rowY(row));
  }

  #requestContractMenu(boxY: number | null): void {
    const m = this.list.infoMerc(this.#strategic());
    if (!m) return;
    if (this.#plot) this.#abortPlotting(false);
    this.#menus.close(false);
    this.list.resetSelected();
    if (m.life === 0 || isPow(m)) this.#showAssignmentMenu(m.id, this.list.info);
    else if (this.#canExtendContract(m)) void this.#withMask(() => this.#contract.show(m.id, boxY));
  }

  #mapMove(region: MouseRegion, reason: number): void {
    if (reason & MouseReason.LOST_MOUSE) {
      this.#hover = null;
      return;
    }
    if ((reason & (MouseReason.MOVE | MouseReason.GAIN_MOUSE)) === 0) return;
    const x = idiv(region.relativeX + MAP_GRID_X, MAP_GRID_X);
    const y = idiv(region.relativeY + MAP_GRID_Y, MAP_GRID_Y);
    this.#hover = x >= 1 && x <= MAP_SIDE && y >= 1 && y <= MAP_SIDE ? { x, y, z: this.#level } : null;
  }

  #mapButton(region: MouseRegion, reason: number): void {
    this.#mapMove(region, MouseReason.MOVE);
    if (reason & MouseReason.LBUTTON_UP) this.#mapPrimary();
    else if (reason & MouseReason.RBUTTON_UP) this.#mapSecondary();
  }

  #gameJustStarted(): boolean {
    return (this.#strategic()?.mercs.length ?? 0) === 0;
  }

  #inConfirmMoveMode(): boolean {
    return this.#plot?.mode === 'merc' && this.#plot.legs.length > 0;
  }

  #mapPrimary(): void {
    if (this.#militia.open) return;
    if (this.#message.open && !this.#inConfirmMoveMode()) {
      this.#message.end();
      if (!this.#changingArrival) return;
    }
    if (this.#gameJustStarted() || this.#playerView()?.prompt) return;
    const hover = this.#hover;
    if (this.#plot) {
      if (hover) this.#plotClick(hover);
      return;
    }
    if (!allowedToHighlight(this.#env.facts, hover)) return;
    if (this.#inventory.holding) {
      this.#openPoolForHeldItem();
      return;
    }
    if (this.#changingArrival) {
      void this.#setLandingZone(hover);
      return;
    }
    if (this.filters.airspace && this.#overBullseye(hover)) {
      this.#changingArrival = true;
      this.#uiMessage(this.#text(BULLSEYE, Bullseye.CHOOSE));
      return;
    }
    const wasSelected = hover.x === this.#selected.x && hover.y === this.#selected.y;
    if (!wasSelected) this.#changeSelectedSector({ ...hover, z: this.#level });
    if (this.filters.items && !this.#sectorInventoryOpen) {
      this.openSectorInventory();
      return;
    }
    if (this.filters.airspace) {
      if (this.#level === 0 && this.#overHelicopter(hover)) void this.#requestHeliPlotting();
      return;
    }
    if (!wasSelected || !this.#movableCharsIn(hover)) return;
    if (this.#level !== 0) void this.#mapBox(this.#text(MAP_ERROR, UNDERGROUND));
    else this.#startMoveFromSector(hover);
  }

  #overBullseye(s: Sector): boolean {
    const strategic = this.#strategic();
    const zone = strategic?.landingZone ? parseSectorLabel(strategic.landingZone) : null;
    const arriving = strategic?.mercs.some((m) => m.assignment === Assignment.IN_TRANSIT) ?? false;
    return zone !== null && zone.x === s.x && zone.y === s.y && arriving;
  }

  async #setLandingZone(s: Sector): Promise<void> {
    const label = sectorLabel({ ...s, z: 0 });
    const reply = await this.#env.client.command({ type: 'setLandingZone', sector: label });
    this.#changingArrival = false;
    if (reply.ok) this.#uiMessage(printf(this.#text(BULLSEYE, Bullseye.CHANGED), [this.#sectorName(label, false)]));
    else this.#uiMessage(this.#text(BULLSEYE, Bullseye.CANNOT));
  }

  #overHelicopter(s: Sector): boolean {
    const heli = this.#heli();
    if (!heli) return false;
    const at = parseSectorLabel(heli.next && (heli.progress ?? 0) > 0.5 ? heli.next : heli.sector);
    return at !== null && at.x === s.x && at.y === s.y;
  }

  #movableCharsIn(s: Sector): boolean {
    return this.#mercsIn(s, this.#level).some(
      (m) => m.life > 0 && m.assignment !== Assignment.IN_TRANSIT && !isPow(m) && !this.#inHelicopter(m),
    );
  }

  #inHelicopter(m: StrategicMercView): boolean {
    const heli = this.#heli();
    return heli !== null && m.assignment === Assignment.VEHICLE && m.vehicle === heli.vehicle;
  }

  #startMoveFromSector(s: Sector): void {
    turnOnTeams(this.filters);
    void this.#openMoveBox(sectorLabel({ ...s, z: 0 }));
  }

  async #openMoveBox(sector: string): Promise<void> {
    const answer = await this.#env.client.hintNow({ type: 'moveBoxOptions', sector });
    const strategic = this.#strategic();
    if (!answer.ok || !strategic) return;
    const order = this.list.slots.flatMap((slot) => (slot.merc === null ? [] : [slot.merc]));
    const members = moveMembers(strategic, order, (answer.data as MoveBoxOptions).soldiers);
    this.#closeMenus();
    this.#moveBox.show(sector, new MoveSelection(members));
  }

  #moveFeedback(feedback: NonNullable<MoveFeedback>): void {
    const text = 'mapError' in feedback ? this.#text(MAP_ERROR, feedback.mapError) : this.#refusalText(feedback.refusal);
    if (text) void this.#mapBox(text);
  }

  #startGroupPlotting(plan: MovePlan): void {
    const first = plan.soldiers[0];
    const m = first === undefined ? null : mercById(this.#strategic(), first);
    if (!m) return;
    const row = this.list.rowOf(m.id);
    this.list.resetSelected();
    if (row >= 0) this.list.changeInfo(row, true);
    for (const id of plan.soldiers) {
      const r = this.list.rowOf(id);
      if (r >= 0) this.list.setSelected(r, true);
    }
    this.#plot = Plotting.forGroup(plan, row, m.sector.split('-')[0] ?? m.sector);
    this.#route.reset();
    if (row >= 0) this.#team.startGlow(row, TeamColumn.DESTINATION);
  }

  #mediumFace(id: number): string | null {
    const profile = mercById(this.#strategic(), id)?.profile;
    const face = profile === undefined ? null : this.#env.media.profile(profile)?.faceIndex;
    return face === undefined || face === null ? null : portraitPath(face, 'medium');
  }

  #showNextUpdate(): void {
    if (this.#updateBox.open) return;
    for (let batch = this.#updates.next(); batch; batch = this.#updates.next()) {
      this.#closeMenus();
      this.#moveBox.close(false);
      if (this.#updateBox.show(batch)) return;
    }
  }

  async #updateFinished(continueTime: boolean | null): Promise<void> {
    if (continueTime === null) return;
    const reply = await this.#env.client.command(continueTime ? { type: 'compressTime' } : { type: 'stopTime' });
    if (!reply.ok) this.#explainRefusal(this.#refusalOf(reply));
  }

  #mapSecondary(): void {
    if (this.#militia.open) return;
    if (this.#changingArrival) {
      this.#changingArrival = false;
      this.#uiMessage(this.#text(BULLSEYE, Bullseye.CANCELED));
      return;
    }
    if (this.#message.open && !this.#inConfirmMoveMode()) {
      this.#message.end();
      return;
    }
    if (this.#gameJustStarted() || this.#playerView()?.prompt) return;
    const hover = this.#hover;
    if (this.#plot) {
      if (hover) void this.#plotShorten(hover);
      return;
    }
    if (hover && (hover.x !== this.#selected.x || hover.y !== this.#selected.y)) this.#changeSelectedSector({ ...hover, z: this.#level });
    if (hover && hover.x === this.#selected.x && hover.y === this.#selected.y) this.#sectorInfoClick({ ...hover, z: this.#level });
  }

  #plotClick(s: Sector): void {
    const plot = this.#plot;
    if (!plot) return;
    const result = plot.click(s);
    if (result.kind === 'confirm') void this.#confirmPlot();
    else if (result.kind === 'offRoad') this.#uiMessage(this.#text(MAP_ERROR, OFF_ROAD));
    else if (result.kind === 'appended' && plot.mode === 'merc')
      this.#uiMessage(this.#text(MAP_PLOT, Plot.CLICK_AGAIN), s.y < UPPER_HALF_ROW ? PLOT_MESSAGE_SHIFT : -PLOT_MESSAGE_SHIFT);
  }

  async #confirmPlot(): Promise<void> {
    const plot = this.#plot;
    if (!plot) return;
    this.#plot = null;
    this.#team.stopGlow();
    this.#message.end();
    const command = plot.confirmCommand();
    if (!command) {
      this.#uiMessage(this.#text(MAP_PLOT, Plot.UNCHANGED));
      return;
    }
    const reply = await this.#env.client.command(command);
    if (!reply.ok) {
      const text = this.#refusalText(this.#refusalOf(reply), [mercById(this.#strategic(), plot.soldier)?.name ?? '']);
      if (text) void this.#mapBox(text);
      return;
    }
    if (plot.mode === 'heli') return;
    await this.#routeOtherSelected(plot);
    this.#confirmByRandomMerc(plot.soldier);
    this.#uiMessage(this.#text(MAP_PLOT, Plot.CONFIRMED));
  }

  async #routeOtherSelected(plot: Plotting): Promise<void> {
    const strategic = this.#strategic();
    const groupOf = (id: number) => (strategic ? groupOfMerc(strategic, id)?.id : undefined);
    const done = new Set<number | undefined>([groupOf(plot.soldier)]);
    for (const id of this.list.selectedIds()) {
      const group = groupOf(id);
      if (id === plot.soldier || (group !== undefined && done.has(group))) continue;
      done.add(group);
      const command = plot.routeFor(id);
      if (command) await this.#env.client.command(command);
    }
  }

  #confirmByRandomMerc(fallback: number): void {
    const awake = this.list.selectedIds().filter((id) => {
      const m = mercById(this.#strategic(), id);
      return m !== null && !m.asleep && m.life >= OKLIFE && !isMechanical(m) && m.kind !== 'epc';
    });
    const speaker = awake.length > 0 ? (awake[this.#env.random(awake.length)] ?? fallback) : null;
    if (speaker === null) return;
    const row = this.list.rowOf(speaker);
    if (row >= 0) this.list.changeInfo(row, false);
    this.#env.sounds.confirmRoute(speaker);
  }

  async #plotShorten(s: Sector): Promise<void> {
    const plot = this.#plot;
    if (!plot || (plot.mode === 'heli' && !(this.#heli()?.canFly ?? false))) return;
    const result = plot.shorten(s);
    switch (result.kind) {
      case 'abort':
        this.#abortPlotting(true);
        return;
      case 'cancel':
        this.#plot = null;
        this.#team.stopGlow();
        this.#message.end();
        if (plot.mode === 'heli') await this.#env.client.command({ type: 'heliCancel' });
        else this.#cancelSelectedPaths();
        this.#uiMessage(this.#text(MAP_PLOT, Plot.CANCELED));
        return;
      case 'shortenBase':
        if (plot.mode === 'heli') await this.#env.client.command({ type: 'shortenHeliRoute', at: result.at });
        else await this.#env.client.command({ type: 'shortenRoute', soldier: plot.soldier, at: result.at });
        this.#route.reset();
        this.#uiMessage(this.#text(MAP_PLOT, Plot.SHORTENED));
        return;
      case 'shortenLegs':
        this.#route.reset();
        this.#uiMessage(this.#text(MAP_PLOT, Plot.SHORTENED));
        return;
    }
  }

  #abortPlotting(message: boolean): void {
    if (!this.#plot) return;
    this.#plot = null;
    this.#team.stopGlow();
    if (message) this.#uiMessage(this.#text(MAP_PLOT, Plot.UNCHANGED));
  }

  async #requestHeliPlotting(): Promise<void> {
    const reply = await this.#env.client.command({ type: 'heliPlot' });
    const heli = this.#heli();
    if (!reply.ok || !heli) {
      const text = this.#refusalText(this.#refusalOf(reply));
      if (text) void this.#mapBox(text);
      return;
    }
    this.#plot = new Plotting('heli', heli.vehicle, NO_CHARACTER, heli.sector, heli.path);
    this.#route.reset();
  }

  #applyFilterEffects(effects: FilterEffects): void {
    const plot = this.#plot;
    const abort = effects.abortPlot;
    if (plot && (abort === 'any' || abort === plot.mode)) this.#abortPlotting(true);
    if (effects.toSurface && this.#level !== 0) this.#jumpToLevel(0);
    if (effects.militiaShown && !this.#anyMilitia()) {
      const training = (this.#strategic()?.mercs ?? []).some((m) => m.assignment === Assignment.TRAIN_TOWN);
      this.#uiMessage(training ? this.#text(MAP_ERROR, NO_MILITIA_TRAINING) : this.#text(MARKS, NO_MILITIA));
    }
  }

  #filter(index: number): void {
    if (this.#message.open && !this.#inConfirmMoveMode()) this.#message.end();
    this.#applyFilterEffects(toggleFilter(this.filters, index));
  }

  #anyMilitia(): boolean {
    return (this.#strategic()?.sectors ?? []).some((s) => s.militia.some((n) => n > 0));
  }

  #jumpToLevel(level: number): void {
    if (this.#sectorInventoryOpen || this.#playerView()?.prompt || level < 0 || level > DEEPEST_LEVEL) return;
    if (this.#plot) this.#abortPlotting(true);
    this.#level = level;
    this.#selected = { ...this.#selected, z: level };
  }

  #toggleInventory(): void {
    if (this.#inventoryOpen) {
      if (this.#inventory.mercBusy) return;
      this.#inventory.closeMerc();
      this.#inventoryOpen = false;
      return;
    }
    const m = this.list.infoMerc(this.#strategic());
    if (!m || !accessibleInventory(m)) return;
    this.#inventory.openMerc();
    this.#inventoryOpen = true;
  }

  #toggleSectorInventory(): void {
    if (this.#sectorInventoryOpen) {
      if (this.#inventory.holding) return;
      this.#inventory.closePool();
      this.#sectorInventoryOpen = false;
      return;
    }
    this.openSectorInventory();
  }

  #openPoolForHeldItem(): void {
    if (!this.filters.items) this.#filter(MapFilter.ITEMS);
    const owner = mercById(this.#strategic(), this.#inventory.merc.panel.cursor?.source.soldier ?? null);
    const at = owner ? parseSectorLabel(owner.sector) : null;
    if (at) this.#changeSelectedSector(at);
    this.openSectorInventory();
  }

  openSectorInventory(): void {
    if (this.#sectorInventoryOpen) return;
    if (this.#plot) this.#abortPlotting(false);
    this.#inventory.openPool();
    this.#sectorInventoryOpen = true;
  }

  #nextMerc(step: 1 | -1): void {
    const filled = this.list.slots.flatMap((s, i) => (s.merc !== null ? [i] : []));
    if (filled.length < 2) return;
    const at = filled.indexOf(this.list.info);
    const next = filled[(at + step + filled.length) % filled.length] ?? 0;
    if (this.#plot) this.#abortPlotting(false);
    this.list.changeInfo(next, true);
    const m = this.#mercAt(next);
    if (m && m.life > 0 && !isPow(m)) this.#selectMercSector(m);
  }

  #selectSquad(squad: number): void {
    const rows = this.list.slots.flatMap((_s, i) => (this.#mercAt(i)?.squad === squad ? [i] : []));
    const first = rows[0];
    if (first === undefined) return;
    if (this.#plot) this.#abortPlotting(false);
    this.list.changeInfo(first, true);
    for (const r of rows) this.list.setSelected(r, true);
    const m = this.#mercAt(first);
    if (m) this.#selectMercSector(m);
  }

  #escape(): void {
    if (this.#inventory.escape()) return;
    if (this.#changingArrival) {
      this.#changingArrival = false;
      this.#uiMessage(this.#text(BULLSEYE, Bullseye.CANCELED));
    } else if (this.#message.open && !this.#inConfirmMoveMode()) this.#message.end();
    else if (this.#updateBox.open) this.#updateBox.end(false);
    else if (this.#plot) this.#abortPlotting(true);
    else if (this.#menus.open) {
      this.#menus.escape();
      this.#syncMask(false);
    } else if (this.#contract.open) this.#closeMenus();
    else if (this.#militia.open && this.#militia.cursorEmpty) this.#militia.close();
    else if (this.#townBox.open) {
      this.#townBox.close(false);
      this.#syncMask(false);
    } else if (this.#inventoryOpen) this.#toggleInventory();
    else if (this.list.multipleSelected()) this.list.resetSelected();
    else this.#tactical();
  }

  #tactical(): void {
    if (this.#canEnterSelected()) void this.#leave({ type: 'enterSector', sector: sectorLabel(this.#selected) });
  }

  async #leave(cmd: CommandEnvelope): Promise<void> {
    if (this.#leaving) return;
    this.#leaving = true;
    const reply = await this.#env.client.command(cmd);
    this.#leaving = false;
    const text = reply.ok ? null : this.#refusalText(this.#refusalOf(reply));
    if (text) void this.#mapBox(text);
  }

  async #compress(request: CompressRequest): Promise<void> {
    const clock = this.#playerView()?.clock;
    if (!clock) return;
    if (!this.#compressionAllowedByUi() || clock.canCompress === false) {
      if (request !== 'more') this.#explainCompression();
      return;
    }
    const command = compressionCommand(clock, request);
    const reply = command ? await this.#env.client.command(command) : null;
    if (reply && !reply.ok) this.#explainRefusal(this.#refusalOf(reply));
  }

  #explainCompression(): void {
    if (this.#sectorInventoryOpen) void this.#mapBox(this.#text(LATE, SECTOR_INVENTORY_COMPRESS));
    else this.#explainRefusal(this.#playerView()?.clock?.compressRefusal ?? null);
  }

  #explainRefusal(token: string | null): void {
    if (token && COMPRESSION_REFUSALS_WITH_BATTLE.has(token)) {
      this.#env.flow.preBattle();
      return;
    }
    const text = this.#refusalText(token);
    if (text) void this.#mapBox(text);
  }

  #compressAction(request: CompressRequest): void {
    if (this.#plot) this.#abortPlotting(true);
    else void this.#compress(request);
  }

  #action(action: MapAction, args: readonly number[]): void {
    this.#handlers()[action]?.(args[0] ?? 0);
  }

  #handlers(): Readonly<Partial<Record<MapAction, (arg: number) => void>>> {
    const whenExitAllowed = (run: () => void) => () => {
      if (this.#allowedToExit()) run();
    };
    return {
      sort: (arg) => this.#sort(arg),
      contract: () => this.#requestContractMenu(null),
      prevMerc: () => this.#nextMerc(-1),
      nextMerc: () => this.#nextMerc(1),
      filter: (arg) => this.#filter(arg),
      level: (arg) => this.#jumpToLevel(arg),
      levelUp: () => this.#jumpToLevel(this.#level - 1),
      levelDown: () => this.#jumpToLevel(this.#level + 1),
      laptop: whenExitAllowed(() => void this.#leave({ type: 'openLaptop' })),
      tactical: () => this.#tactical(),
      options: whenExitAllowed(() => this.#env.flow.options()),
      compressCheck: () => this.#abortPlotting(true),
      compressMore: () => this.#compressAction('more'),
      keyCompressMore: () => this.#compressAction('more'),
      compressLess: () => this.#compressAction('less'),
      keyCompressLess: () => this.#compressAction('less'),
      explainCompression: () => this.#explainCompression(),
      toggleCompression: () => this.#compressAction('toggle'),
      space: () => (this.#updateBox.open ? this.#updateBox.end(true) : this.#compressAction('toggle')),
      togglePause: () => this.#setPlayerPaused(!this.#playerPaused),
      messageUp: (arg) => this.#messages.scrollUp(arg),
      messageDown: (arg) => this.#messages.scrollDown(arg),
      messageHome: () => this.#messages.setFirst(0),
      messageEnd: () => this.#messages.moveToEnd(),
      escape: () => this.#escape(),
      toggleInventory: () => this.#toggleInventory(),
      toggleSectorInventory: () => this.#toggleSectorInventory(),
      keyA: () => this.#airspaceKey(),
      saveGame: whenExitAllowed(() => this.#env.flow.saveGame()),
      loadGame: whenExitAllowed(() => this.#env.flow.loadGame()),
      exitGame: () => this.#env.flow.exitGame(),
      assignmentMenu: () => this.#keyAssignmentMenu(),
    };
  }

  #sort(mode: number): void {
    if (this.#plot) this.#abortPlotting(false);
    this.list.sortMode = mode;
    this.list.sort(this.#strategic(), false);
  }

  #setPlayerPaused(paused: boolean): void {
    this.#playerPaused = paused;
    this.#env.client.setPaused(paused);
  }

  #airspaceKey(): void {
    if (this.#playerView()?.prompt?.kind !== 'preBattle' && !this.#sectorInventoryOpen) this.#filter(MapFilter.AIRSPACE);
  }

  #keyAssignmentMenu(): void {
    const row = this.#team.highLine !== NO_CHARACTER ? this.#team.highLine : this.list.info;
    const m = this.#mercAt(row);
    if (!m) return;
    this.list.changeInfo(row, false);
    this.#showAssignmentMenu(m.id, row);
  }

  input(event: UiInputEvent): boolean {
    if (isPointerEvent(event)) return false;
    if (event.kind === 'keyDown' && this.#playerPaused) {
      this.#setPlayerPaused(false);
      return true;
    }
    if (event.kind === 'keyDown' && (event.modifiers === 0 || event.modifiers === KeyModifier.SHIFT)) {
      const digit = DIGIT_CODE.exec(event.code);
      if (digit) {
        const squad = (Number(digit[1]) + SQUADS_PER_DIGIT_ROW - 1) % SQUADS_PER_DIGIT_ROW;
        this.#selectSquad(event.modifiers === KeyModifier.SHIFT ? SQUADS_PER_DIGIT_ROW + squad : squad);
        return true;
      }
    }
    return this.#view.input(event);
  }

  render(list: DrawList): void {
    this.#view.render(list);
    this.#inventory.render(list);
    this.#townBox.render(list);
    this.#militia.render(list);
    this.#menus.render(list);
    this.#contract.render(list);
    this.#moveBox.render(list);
    this.#updateBox.render(list);
    this.#message.render(list, this.#origin());
  }

  describe(): readonly WidgetInfo[] {
    return [
      ...this.#view.describe(),
      ...this.#describeRegions(),
      ...this.#inventory.describe(),
      ...this.#townBox.describe(),
      ...this.#militia.describe(),
      ...this.#menus.describe(),
      ...this.#contract.describe(),
      ...this.#moveBox.describe(),
      ...this.#updateBox.describe(),
    ];
  }

  #describeRegions(): WidgetInfo[] {
    return this.#env.runtime.regions.regions
      .filter((r) => r.owner === OWNER && r.id !== undefined && !UNDESCRIBED_REGIONS.has(r.id))
      .map((r) => ({
        id: r.id ?? '',
        kind: 'region',
        rect: { x: r.x1, y: r.y1, width: r.width, height: r.height },
        visible: true,
        enabled: r.enabled,
        state: r.inArea ? 'hover' : 'normal',
        text: r.tooltip || null,
        frame: null,
      }));
  }

  #renderers(): Readonly<Record<string, CustomRenderer>> {
    return {
      mapView: (list, rect, params) => this.#renderMap(list, rect, this.#params(params)),
      characterList: (list, _rect, params) => this.#renderList(list, this.#params(params)),
      characterInfo: (list, _rect, params) => this.#renderInfo(list, this.#params(params)),
      bottomPanel: (list, _rect, params) => this.#renderBottom(list, this.#params(params)),
      radar: (list, rect) => this.#renderRadar(list, rect),
      etaBox: (list, _rect, params) => this.#renderEta(list, this.#params(params)),
    };
  }

  #mapArt(p: LayoutParams): MapViewArt {
    const secrets = p.raw('secretIcons') as Readonly<Record<string, string>>;
    return {
      board: this.#env.media.board,
      subLevels: (p.raw('subLevels') as readonly string[]).map((name) => this.#model.asset(name).path),
      boxes: p.asset('boxes'),
      mapCursors: p.asset('mapCursors'),
      betweenIcons: p.asset('betweenIcons'),
      arrivingIcons: p.asset('arrivingIcons'),
      helicopter: p.asset('helicopter'),
      hilite: p.asset('hilite'),
      sam: p.asset('sam'),
      mine: p.asset('mine'),
      militia: p.asset('militia'),
      bullseye: p.asset('bullseye'),
      secretIcon: (path) => {
        const name = secrets[path.toLowerCase()];
        return name ? this.#model.asset(name).path : path.toLowerCase();
      },
    };
  }

  #pathGeometry(): PathGeometry {
    return {
      startX: MAP_VIEW_START_X,
      startY: MAP_VIEW_START_Y,
      gridX: MAP_GRID_X,
      gridY: MAP_GRID_Y,
      viewHeight: MAP_VIEW_HEIGHT,
      screenWidth: this.#env.runtime.geometry().width,
    };
  }

  #locators(): Locator[] {
    const locators: Locator[] = [];
    const prompt = this.#playerView()?.prompt;
    const battle = prompt?.kind === 'preBattle' ? parseSectorLabel(prompt.sector) : null;
    if (battle) locators.push({ sector: battle, colour: 'red' });
    const speech = this.#env.media.speech();
    const speaker = speech?.playing ? mercById(this.#strategic(), speech.speaker) : null;
    const at = speaker ? parseSectorLabel(speaker.sector) : null;
    if (at && at.z === this.#level) locators.push({ sector: at, colour: 'yellow' });
    return locators;
  }

  #renderMap(list: DrawList, rect: Point, p: LayoutParams): void {
    const strategic = this.#strategic();
    if (!strategic) return;
    const origin = { x: rect.x, y: rect.y };
    const plot = this.#plot;
    const geometry = this.#pathGeometry();
    const permanent = plot ? tracePathRoute(pathSectors(plot.plottedPath()), geometry, origin) : [];
    const temp = plot?.tempDrawn() ? tracePathRoute(pathSectors(plot.tempPath()), geometry, origin) : [];
    renderMapView(
      {
        list,
        origin,
        facts: this.#env.facts,
        text: this.#env.text,
        images: this.#env.runtime.images,
        art: this.#mapArt(p),
        mapFont: p.font('font'),
        iconFont: p.font('iconFont'),
      },
      {
        strategic: this.#militia.overlay(strategic),
        level: this.#level,
        filters: this.filters,
        hover: allowedToHighlight(this.#env.facts, this.#hover) ? this.#hover : null,
        selected: this.#selected,
        drawCursors: !this.#menus.open && !this.#contract.open && !this.#townBox.open && !this.#militia.open && this.#boxOpen === 0,
        selectedYellow: this.#selectedYellow,
        showSelected: plot === null,
        gameJustStarted: this.#gameJustStarted(),
        changingArrival: this.#changingArrival,
        permanentPath: permanent,
        animatedNode: plot ? this.#route.update(this.#now, permanent.length) : -1,
        tempPath: temp,
        locators: this.#locators(),
        now: this.#now,
        screenWidth: this.#env.runtime.geometry().width,
      },
    );
  }

  #renderList(list: DrawList, p: LayoutParams): void {
    const strategic = this.#strategic();
    if (!strategic || this.#inventoryOpen) return;
    this.#team.render({
      list,
      origin: this.#origin(),
      font: p.font('font'),
      text: this.#env.text,
      strategic,
      characters: this.list,
      selected: this.#selected,
      level: this.#level,
      plottingMercs: this.#plot?.mode === 'merc',
      sleepIcon: p.asset('sleepIcon'),
      arrow: p.asset('arrow'),
    });
  }

  #renderInfo(list: DrawList, p: LayoutParams): void {
    const strategic = this.#strategic();
    const m = this.list.infoMerc(strategic);
    if (!strategic || !m) return;
    const o = this.#origin();
    const off = (key: string) => {
      const [x, y] = p.numbers(key);
      return { x: o.x + (x ?? 0), y: o.y + (y ?? 0) };
    };
    this.#renderFace(list, m, off('face'));
    const profile = m.profile !== undefined ? this.#env.media.profile(m.profile) : null;
    const clock = this.#playerView()?.clock;
    const info = {
      list,
      origin: o,
      font: p.font('font'),
      text: this.#env.text,
      strategic,
      fullName: profile?.name ?? null,
      flashes: this.#flashes.get(m.id),
      now: this.#now,
      worldMinutes: clock ? clock.day * MINUTES_PER_DAY + clock.hour * MINUTES_PER_HOUR + clock.minute : 0,
    };
    renderCharacterInfo(info, infoGeometry(p), m, (sector) => this.#townOf(sector));
    const bars = off('barsAt');
    drawSoldierBars(list, mercBars(m), bars.x, bars.y, { asset: p.asset('bars'), gold: false });
    const icon = off('iconAt');
    const spacing = p.number('iconSpacing');
    cornerIcons(m).forEach((frame, i) => {
      if (frame >= 0) list.image(p.asset('icons'), frame, icon.x, icon.y + i * spacing);
    });
    this.#renderHand(list, m, p);
  }

  #renderFace(list: DrawList, m: StrategicMercView, at: Point): void {
    const face = this.#faces.get(m.id);
    if (!face || !this.#env.media.image(face.record.path)) return;
    drawFace(
      { list, images: this.#env.runtime.images, art: FACE_ART, fonts: { tiny: this.#font(FontName.TINYFONT1) }, inCombat: false },
      mercSoldier(this.#playerView(), m),
      face,
      at.x,
      at.y,
      { highlight: null, compatible: false, hatched: false, deadPanelRunning: false, textOver: null },
    );
  }

  #renderHand(list: DrawList, m: StrategicMercView, p: LayoutParams): void {
    const item = m.inventory?.find((i) => i.slot === HAND_SLOT) ?? null;
    if (this.#inventoryOpen || m.life <= 0 || !item) return;
    const o = this.#origin();
    const [x, y, width, height] = p.numbers('hand');
    const media = this.#env.media;
    drawInventoryItem(
      {
        list,
        images: this.#env.runtime.images,
        items: { item: (name) => media.item(name) },
        font: this.#font(FontName.TINYFONT1),
        text: this.#env.text,
        ensure: (path) => media.image(path),
      },
      item,
      { x: o.x + (x ?? 0), y: o.y + (y ?? 0), width: width ?? 0, height: height ?? 0 },
      { outline: null },
    );
  }

  #renderBottom(list: DrawList, p: LayoutParams): void {
    const clock = this.#playerView()?.clock ?? null;
    renderBottomPanel(list, p, {
      origin: this.#origin(),
      text: this.#env.text,
      messages: this.#messages,
      clock,
      labelColour: this.#blink.colour(this.#now, compressionLabelSteady(clock)),
      playerPaused: this.#playerPaused,
      inCombat: this.#playerView()?.combat != null,
    });
  }

  #renderRadar(list: DrawList, rect: Point): void {
    const label = sectorLabel(this.#selected);
    const visited =
      this.#selected.z === 0
        ? (this.#strategic()?.sectors ?? []).some((s) => s.sector === label && s.visited)
        : this.#visitedUnderground(this.#selected);
    const image = visited ? this.#env.media.radar(label) : null;
    if (image && this.#env.media.image(image)) list.image(image, 0, rect.x, rect.y);
  }

  #renderEta(list: DrawList, p: LayoutParams): void {
    const plot = this.#plot;
    if (!plot || this.#sectorInventoryOpen) return;
    if (plot.mode === 'merc') {
      renderGroundEta(list, p, this.#origin(), this.#env.text, plot.etaMinutes());
      return;
    }
    const answer = plot.tempAnswer() ?? plot.pathAnswer();
    const values = heliDistanceValues(this.#env.text, answer, this.#heli()?.passengers.length ?? 0);
    renderHeliDistances(list, p, this.#origin(), this.#env.text, values, this.#hover?.y ?? null);
  }

  sectorPoint(label: string): Point | null {
    const s = parseSectorLabel(label);
    if (!s) return null;
    const o = this.#origin();
    return {
      x: o.x + MAP_VIEW_START_X + s.x * MAP_GRID_X + idiv(MAP_GRID_X, 2),
      y: o.y + MAP_VIEW_START_Y + s.y * MAP_GRID_Y + idiv(MAP_GRID_Y, 2),
    };
  }

  rowPoint(row: number, column: number): Point | null {
    const at = this.#team.geometry.columns[column];
    if (!at || row < 0 || row >= MAX_CHARACTER_COUNT) return null;
    const o = this.#origin();
    return { x: o.x + at[0] + idiv(at[1], 2), y: o.y + this.#team.rowY(row) + idiv(this.#team.geometry.ySize, 2) };
  }

  heliIcon(): Point | null {
    const heli = this.#heli();
    return heli ? helicopterIconPosition({ origin: this.#origin() }, heli) : null;
  }
}

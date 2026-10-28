// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Turn_Based_Input.cc HandleModNone, HandleModShift, HandleModCtrl, HandleModAlt,
// @src HandleModCtrlShift (the actions behind the keys), ChangeCurrentSquad, HandleSelectMercSlot, GroupAutoReload,
// @src HandleTBReload, HandleTBSwapHands, HandleTBClimbWindow, HandleStanceChangeFromUIKeys,
// @src HandleStealthChangeFromUIKeys, FindNextMercInTeamPanel; Handle_UI.cc ClimbUpOrDown, GotoHigherStance,
// @src GotoLowerStance, ToggleHandCursorMode, ToggleTalkCursorMode, ToggleLookCursorMode; Overhead.cc
// @src CycleVisibleEnemies, CycleThroughKnownEnemies, FindNextActiveSquad, HandleLocateToGuyAsHeWalks (the view follows
// @src a merc walking in combat with tracking on, and every visible soldier of the others); DisplayCover.cc
// @src DisplayRangeToTarget; GameSettings.cc DisplayGameSettings (the version and the gun line); Handle_Items.cc
// @src ToggleItemGlow; Soldier_Control.cc HandlePlayerTogglingLightEffects; Turn_Based_Input.cc ToggleTreeTops,
// @src ToggleWireFrame (the messages); src/game/TileEngine/RenderWorld.cc ScrollWorld (the arrow keys and the
// @src 15-pixel screen edges, 20 << (SHIFT ? 2 : 1) pixels across and half down per NEXTSCROLL 20 ms, the pending first
// @src step, no scrolling with ALT or while the UI is locked or a menu is up); src/game/Tactical/Interface_Control.cc
// @src RenderRubberBanding (the twelve gold shades every 60 ms, clipped to the viewport), RenderTopmostTacticalInterface
// @src (burst locations, arrows on our turn); src/game/Tactical/Spread_Burst.cc RenderAccumulatedBurstLocations
// @src (burst1.sti frame 1); src/game/Tactical/Handle_Items.cc DrawItemPoolList (eight names in SMALLFONT1 dark grey and
// @src "More...", right of the pointer when there is room, centred on it within the viewport, the other level's pile
// @src when the merc's level has none); src/game/TileEngine/RenderWorld.cc RenderTiles (LEVELNODE_DISPLAY_AP: TINYFONT1 white,
// @src black while blinking, centred, clipped to the viewport); src/game/Tactical/Interface_Panels.cc
// @src BtnStealthModeCallback, BtnBurstModeCallback, BtnMuteCallback, BtnClimbCallback (down, up, else the fence jump).

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import type { DoorMenuAction, DoorMenuEvent, ExitSectorOptions } from '../../../protocol/hints.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { PlayerView, SoldierView, ViewFrame } from '../../../protocol/view.ts';
import { type DrawList, rgb } from '../../draw-list.ts';
import { KeyModifier, type UiKeyEvent } from '../../input/events.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { ControllerContract } from '../../layout/controller.ts';
import { INV_INTERFACE_HEIGHT } from '../../layout/frames.ts';
import { type BitmapFont, fontHeight } from '../../text/bitmap-font.ts';
import { FontName } from '../../text/fonts.ts';
import { hCenterVCenterAlign, stringPixLength } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { printf } from '../../text/printf.ts';
import type { CommandReply, TacticalEnvironment } from './environment.ts';
import { ExitDialog, type ExitDialogArt, type ExitDirection } from './exit-dialog.ts';
import { OKLIFE } from './faces.ts';
import { arrowSprites } from './input/arrows.ts';
import { hintNow } from './input/hints.ts';
import { type HotkeyHost, handleTacticalKey, type SmButton } from './input/hotkeys.ts';
import { type Lock, type MovementChoice, TacticalInput, type TacticalInputHost } from './input/tactical-input.ts';
import { UiEvent, UiMode } from './input/ui-events.ts';
import { slotItem } from './item-cursor.ts';
import { type OverheadArt, OverheadMap } from './overhead-map.ts';
import { DoorMenu, type MenuArt, MovementMenu, type MovementMenuSubject } from './popup-menus.ts';
import { inCombat, isDead, isEpc, isInVehicle, isRobot, OUR_TEAM, opponentCount, ourTurn, visibleEnemies } from './soldiers.ts';

const SCROLL_STEP_MS = 20;
const SCROLL_SPEED = 40;
const SHIFT_SCROLL_SPEED = 80;
const EDGE_PX = 15;
const RUBBER_BAND_STEP_MS = 60;
const BURST_FRAME = 1;
const HANDPOS = 5;
const FIRST_VEHICLE_BODY = 22;
const LAST_VEHICLE_BODY = 27;
const NUMBER_OF_SQUADS = 20;
const SHOW_LOCATOR_NORMAL_CYCLES = 10;
const TACTICAL = 'TacticalStr';
const MESSAGES = 'pMessageStrings';
const NEW_TACTICAL = 'zNewTacticalMessages';
const GIO = 'gzGIOScreenText';
const NO_ENEMIES_IN_SIGHT_STR = 86;
const OUT_OF_RANGE_STRING = 126;
const REMOVING_TREETOPS_STR = 103;
const SHOWING_TREETOPS_STR = 104;
const MSG_VERSION = 23;
const MSG_WIREFRAMES_ADDED = 48;
const MSG_WIREFRAMES_REMOVED = 49;
const MSG_TACKING_MODE_OFF = 55;
const MSG_TACKING_MODE_ON = 56;
const MSG_3DCURSOR_OFF = 57;
const MSG_3DCURSOR_ON = 58;
const MSG_SQUAD_ACTIVE = 59;
const TCTL_MSG_RANGE_TO_TARGET = 0;
const TCTL_MSG_RANGE_TO_TARGET_AND_GUN_RANGE = 1;
const GIO_GUN_OPTIONS_TEXT = 4;
const GIO_GUN_NUT_TEXT = 5;
const GIO_REDUCED_GUNS_TEXT = 6;
const WORLD_COLS = 160;
const CELL = 10;
const RUBBER_BAND_COLOURS: readonly number[] = [
  rgb(198, 163, 0),
  rgb(185, 150, 0),
  rgb(172, 136, 0),
  rgb(159, 123, 0),
  rgb(146, 110, 0),
  rgb(133, 96, 0),
  rgb(120, 83, 0),
  rgb(133, 96, 0),
  rgb(146, 110, 0),
  rgb(159, 123, 0),
  rgb(172, 136, 0),
  rgb(185, 150, 0),
];
const GUN_CLASSES: ReadonlySet<string> = new Set(['GUN', 'THROWING_KNIFE']);
const NUM_ITEMS_LISTED = 8;
const ITEM_LIST_X = 15;
const ITEMPOOL_POPUP_MORE_STR = 16;

export type PanelButton = SmButton | 'squad';

export const TACTICAL_INPUT_CONTRACT: ControllerContract = { id: 'tacticalInput', actions: {}, bindings: {} };

export interface ControlsScreen {
  readonly env: TacticalEnvironment;
  readonly version: string;
  selected(): SoldierView | null;
  select(s: SoldierView, acknowledge: boolean, fromUi: boolean): void;
  interfaceLevel(): number;
  setInterfaceLevel(level: number): void;
  itemInCursor(): boolean;
  itemPointerClick(gridNo: number, target: SoldierView | null): void;
  pickUp(s: SoldierView, gridNo: number, level: number): void;
  feedback(text: string): void;
  log(text: string): void;
  currentSquad(): number;
  changeSquad(squad: number): boolean;
  squadSoldiers(): readonly SoldierView[];
  slotSoldiers(): readonly (SoldierView | null)[];
  send(cmd: CommandEnvelope): Promise<CommandReply>;
  panel(): 'team' | 'sm';
  requestTeamPanel(): void;
  panelButtonEnabled(button: PanelButton): boolean;
  popupsOpen(): boolean;
  closePopups(): void;
  locate(s: SoldierView, cycles: number | null): void;
  locateSelect(s: SoldierView, force: boolean): void;
  clearMessages(queue: boolean): void;
  swapHands(id: number): void;
  viewportTop(): number;
  viewportBottom(): number;
  viewportRegion(): MouseRegion | null;
  dismissFeedback(): boolean;
  closeCivQuote(): boolean;
  radarBlink(): boolean;
}

export interface ControlsArt {
  readonly menus: MenuArt;
  readonly exit: ExitDialogArt;
  readonly overhead: OverheadArt;
  readonly burst: string;
}

function locksOurInput(frame: ViewFrame): boolean {
  return !!frame.combat && (frame.combat.uiLocked || frame.combat.team !== OUR_TEAM);
}

function isVehicleBody(s: SoldierView): boolean {
  return s.bodyType >= FIRST_VEHICLE_BODY && s.bodyType <= LAST_VEHICLE_BODY;
}

function cellRange(a: number, b: number): number {
  const dx = ((a % WORLD_COLS) - (b % WORLD_COLS)) * CELL;
  const dy = (Math.trunc(a / WORLD_COLS) - Math.trunc(b / WORLD_COLS)) * CELL;
  return Math.trunc(Math.sqrt(dx * dx + dy * dy));
}

export class TacticalControls {
  readonly input: TacticalInput;
  readonly movementMenu: MovementMenu;
  readonly doorMenu: DoorMenu;
  readonly exitDialog: ExitDialog;
  readonly overhead: OverheadMap;
  readonly #screen: ControlsScreen;
  readonly #art: ControlsArt;
  readonly #gridNos = new Map<number, number>();
  readonly #lastVisibleEnemy = new Map<number, number>();
  #lastKnownEnemy = 0;
  #nextScrollAt = 0;
  #scrollPending = false;
  #scrollInertia = false;
  #redItemGlow = false;
  #busyOrders = 0;

  constructor(screen: ControlsScreen, art: ControlsArt) {
    this.#screen = screen;
    this.#art = art;
    const env = screen.env;
    this.movementMenu = new MovementMenu(env.runtime, env.text, art.menus);
    this.doorMenu = new DoorMenu(env.runtime, env.text, art.menus);
    this.exitDialog = new ExitDialog(env.runtime, env.text, art.exit);
    this.overhead = new OverheadMap({
      services: env.runtime,
      art: art.overhead,
      map: () => env.world.overheadMap(),
      soldiers: () => env.client.view?.soldiers ?? [],
      items: () => (env.client.view?.items ?? []).filter((i) => !i.notRendered),
      selected: () => screen.selected()?.id ?? null,
      blink: () => screen.radarBlink(),
      centerOn: (gridNo) => env.world.centerOn(gridNo),
      closed: () => undefined,
    });
    this.input = new TacticalInput(this.#inputHost());
  }

  get redItemGlow(): boolean {
    return this.#redItemGlow;
  }

  #env(): TacticalEnvironment {
    return this.#screen.env;
  }

  #view(): PlayerView | null {
    return this.#env().client.view;
  }

  #text(table: string, index: number): string {
    return this.#env().text.string(table, index) ?? '';
  }

  #inputHost(): TacticalInputHost {
    const screen = this.#screen;
    return {
      env: screen.env,
      selected: () => screen.selected(),
      select: (s) => screen.select(s, false, false),
      selectFromUi: (s) => screen.select(s, true, true),
      interfaceLevel: () => screen.interfaceLevel(),
      setInterfaceLevel: (level) => screen.setInterfaceLevel(level),
      viewportBottom: () => screen.viewportBottom(),
      itemInCursor: () => screen.itemInCursor(),
      feedback: (text) => screen.feedback(text),
      log: (text) => screen.log(text),
      currentSquad: () => screen.currentSquad(),
      squadSoldiers: () => screen.squadSoldiers(),
      send: (cmd) => screen.send(cmd),
      sendBusyOrder: (cmd) => this.#sendBusyOrder(cmd),
      locked: () => this.lockState(),
      itemPointerClick: (gridNo, target) => screen.itemPointerClick(gridNo, target),
      pickUp: (s, gridNo, level) => screen.pickUp(s, gridNo, level),
      openMovementMenu: (x, y, done) => this.#openMovementMenu(x, y, done),
      openExitDialog: (direction, exitGrid) => void this.#openExitDialog(direction, exitGrid),
      doorReply: () => undefined,
      confirm: (text) => screen.env.boxes.confirm(text),
      dismissFeedback: () => screen.dismissFeedback(),
      closeCivQuote: () => screen.closeCivQuote(),
      key: (event, current) => handleTacticalKey(this.#hotkeyHost(), event, current),
    };
  }

  lockState(): Lock {
    const client = this.#env().client;
    const view = client.view;
    if (!inCombat(view)) return 'none';
    if (!ourTurn(view)) return 'enemyTurn';
    if (this.#busyOrders > 0 || view?.combat?.uiLocked || client.queuedFrames.some(locksOurInput)) return 'ourTurn';
    return 'none';
  }

  async #sendBusyOrder(cmd: CommandEnvelope): Promise<CommandReply> {
    this.#busyOrders++;
    try {
      return await this.#screen.send(cmd);
    } finally {
      this.#busyOrders--;
    }
  }

  pointedGridNo(): number | null {
    return this.overhead.open ? this.overhead.mouseGridNo() : this.input.hover.gridNo;
  }

  get menuOpen(): boolean {
    return this.movementMenu.open || this.doorMenu.open || this.exitDialog.open || this.overhead.open;
  }

  update(now: number): void {
    if (this.overhead.open) return;
    const env = this.#env();
    this.#scroll(now);
    const region = this.#screen.viewportRegion();
    const inArea = region?.inArea === true && env.runtime.regions.current === region;
    this.input.frame(now, inArea);
    env.world.setMarkers(this.input.markers());
    this.#cursor(region, inArea);
  }

  #cursor(region: MouseRegion | null, inArea: boolean): void {
    const runtime = this.#env().runtime;
    if (!region) return;
    region.showsMouseText = true;
    region.animatesCursor = true;
    region.flashesCursor = true;
    if (this.#screen.itemInCursor()) {
      runtime.cursor.mouseText = null;
      return;
    }
    const id = this.input.viewportCursor();
    if (region.cursor !== id) region.changeCursor(id);
    if (inArea) runtime.cursor.set(id, runtime.clock.ja2Now);
    runtime.cursor.mouseText = inArea ? this.input.mouseText() : null;
  }

  #ignoreScrolling(): boolean {
    return this.menuOpen || this.#screen.popupsOpen() || this.input.mode === UiMode.LOCKUI_MODE;
  }

  #scroll(now: number): void {
    const runtime = this.#env().runtime;
    const flagsOff = () => {
      this.#scrollPending = false;
      this.#scrollInertia = false;
    };
    if (this.#ignoreScrolling() || runtime.modifiers & KeyModifier.ALT) {
      flagsOff();
      return;
    }
    const regions = runtime.regions;
    const { width, height } = runtime.geometry();
    const mouse = regions.pointerKnown;
    const left = runtime.isKeyDown('ArrowLeft') || (mouse && regions.mouseX < EDGE_PX);
    const right = runtime.isKeyDown('ArrowRight') || (mouse && regions.mouseX >= width - EDGE_PX);
    const up = runtime.isKeyDown('ArrowUp') || (mouse && regions.mouseY < EDGE_PX);
    const down = runtime.isKeyDown('ArrowDown') || (mouse && regions.mouseY >= height - EDGE_PX);
    const speed = runtime.modifiers & KeyModifier.SHIFT ? SHIFT_SCROLL_SPEED : SCROLL_SPEED;
    const dx = (right ? speed : 0) - (left ? speed : 0);
    const dy = (down ? speed / 2 : 0) - (up ? speed / 2 : 0);
    const edges = this.#env().world.scrollEdges();
    const canX = (dx < 0 && !edges.left) || (dx > 0 && !edges.right);
    const canY = (dy < 0 && !edges.top) || (dy > 0 && !edges.bottom);
    if (!canX && !canY) {
      flagsOff();
      return;
    }
    if (now < this.#nextScrollAt) return;
    this.#nextScrollAt = now + SCROLL_STEP_MS;
    if (!this.#scrollInertia && !this.#scrollPending) {
      this.#scrollPending = true;
      return;
    }
    this.#scrollPending = false;
    this.#scrollInertia = true;
    this.#env().world.scrollBy(canX ? dx : 0, canY ? dy : 0);
  }

  frames(frames: readonly ViewFrame[]): void {
    const env = this.#env();
    for (const frame of frames) {
      for (const event of frame.events ?? []) if (event.type === 'doorMenu') this.#openDoorMenu(event);
      for (const s of frame.changed) {
        const before = this.#gridNos.get(s.id);
        this.#gridNos.set(s.id, s.gridNo);
        if (before === undefined || before === s.gridNo || !inCombat(this.#view())) continue;
        if (s.team !== OUR_TEAM || env.display().trackingMode) env.world.locate(s.gridNo);
      }
      for (const id of frame.removed) this.#gridNos.delete(id);
    }
  }

  keyInput(event: UiKeyEvent): boolean {
    if (this.overhead.open) {
      if (event.kind === 'keyDown' && (event.key === 'Escape' || event.key === 'Insert')) this.overhead.close();
      return true;
    }
    if (this.exitDialog.open) {
      if (event.kind === 'keyDown' && event.key === 'Escape') this.exitDialog.close(false);
      else if (event.kind === 'keyDown' && event.key === 'Enter') this.exitDialog.close(true);
      return true;
    }
    return false;
  }

  queueKey(event: UiKeyEvent): void {
    this.input.queueKey(event);
  }

  pointerButton(reason: number): void {
    this.input.pointerButton(reason);
  }

  exit(): void {
    this.movementMenu.close(null);
    this.doorMenu.close(null);
    this.exitDialog.close(false);
    this.overhead.close();
    this.input.reset();
    this.#env().world.setMarkers([]);
  }

  #openMovementMenu(x: number, y: number, done: (choice: MovementChoice | null) => void): void {
    const sel = this.#screen.selected();
    if (!sel) {
      done(null);
      return;
    }
    const hand = slotItem(sel, HANDPOS);
    const item = hand ? this.#env().media.item(hand.item) : null;
    const subject: MovementMenuSubject = {
      soldier: sel,
      epc: isEpc(sel),
      vehicle: isVehicleBody(sel),
      robot: isRobot(sel),
      uncontrolledRobot: sel.controlled === false,
      handItem: item ? { name: item.name, class: item.class } : null,
    };
    this.movementMenu.show(subject, { x, y }, this.#screen.viewportBottom(), done);
  }

  #openDoorMenu({ soldier, gridNo, options, closing }: DoorMenuEvent): void {
    const s = this.#view()?.soldiers.find((v) => v.id === soldier);
    if (!s || s.team !== OUR_TEAM) return;
    this.#screen.locate(s, null);
    this.input.override(UiEvent.OP_OPENDOORMENU);
    this.#env().runtime.pauseGame(true);
    const request = {
      soldier,
      gridNo,
      options,
      closing: closing === true,
      box: this.#env().world.soldierBox(soldier),
      inCombat: inCombat(this.#view()),
      viewportBottom: this.#screen.viewportBottom(),
    };
    this.doorMenu.show(request, (action) => this.#doorChosen(soldier, gridNo, action));
  }

  #doorChosen(soldier: number, gridNo: number, action: DoorMenuAction | null): void {
    this.#env().runtime.pauseGame(false);
    this.input.override(UiEvent.A_CHANGE_TO_MOVE);
    if (action) void this.#screen.send({ type: 'door', soldier, gridNo, action });
  }

  async #openExitDialog(direction: ExitDirection, exitGrid: number | null): Promise<void> {
    const sel = this.#screen.selected();
    if (!sel || this.exitDialog.open) return;
    const where = direction === 'exitGrid' ? { exitGrid: exitGrid ?? 0 } : { direction };
    const answer = await hintNow<ExitSectorOptions>(this.#env().client, { type: 'exitSectorOptions', soldier: sel.id, ...where });
    if (answer.state !== 'ok' || !answer.data.menu) return;
    const fonts = this.#env().runtime.fonts;
    const { height } = this.#env().runtime.geometry();
    this.input.override(UiEvent.EX_EXITSECTORMENU);
    this.exitDialog.show(
      {
        direction,
        exitGrid,
        options: answer.data,
        selected: sel,
        selectedIsEpc: isEpc(sel),
        squadEpcs: this.#screen.squadSoldiers().filter((s) => s.id !== sel.id && isEpc(s)),
        viewportBottom: height - INV_INTERFACE_HEIGHT,
      },
      { text: fonts.get('FONT12ARIAL'), bold: fonts.get('FONT10ARIALBOLD') },
      (choice) => {
        this.input.override(UiEvent.A_CHANGE_TO_MOVE);
        if (choice) void this.#screen.send({ type: 'exitSector', soldier: sel.id, ...where, who: choice.who, load: choice.load });
      },
    );
  }

  #targets(): SoldierView[] {
    const view = this.#view();
    const sel = this.#screen.selected();
    const ids = this.input.multiSelected.size > 0 ? [...this.input.multiSelected] : sel ? [sel.id] : [];
    return ids.flatMap((id) => view?.soldiers.find((s) => s.id === id) ?? []);
  }

  #stance(stance: 'stand' | 'crouch' | 'prone'): void {
    for (const s of this.#targets()) {
      this.input.forgetCycledMode(s.id);
      void this.#screen.send({ type: 'stance', soldier: s.id, stance });
    }
  }

  #higherStance(): void {
    const sel = this.#screen.selected();
    if (!sel || this.#screen.itemInCursor()) return;
    const height = this.#env().world.soldierHeight(sel.id);
    if (height === 'stand') {
      if (sel.level === 0) void this.#screen.send({ type: 'climb', soldier: sel.id });
    } else this.#stance(height === 'crouch' ? 'stand' : 'crouch');
  }

  #lowerStance(): void {
    const sel = this.#screen.selected();
    if (!sel || this.#screen.itemInCursor()) return;
    const height = this.#env().world.soldierHeight(sel.id);
    if (height === 'prone') {
      if (sel.level > 0) void this.#screen.send({ type: 'climb', soldier: sel.id });
    } else this.#stance(height === 'stand' ? 'crouch' : 'prone');
  }

  stealth(squad: boolean): void {
    if (squad) {
      const members = this.#screen.squadSoldiers().filter((s) => !isDead(s) && !isRobot(s));
      const allOn = members.every((s) => s.stealth === true);
      if (members.length > 0) void this.#screen.send({ type: 'stealth', soldiers: members.map((s) => s.id), on: !allOn, squad: true });
      return;
    }
    const targets = this.#targets();
    if (targets.length > 0) void this.#screen.send({ type: 'stealth', soldiers: targets.map((s) => s.id) });
  }

  climbButton(soldier: SoldierView): void {
    void this.#screen.send({ type: 'climb', soldier: soldier.id }).then((reply) => {
      const refusal = (reply.data as { readonly refusal?: string } | undefined)?.refusal ?? reply.reason;
      if (!reply.ok && refusal === 'noRoofEdge') void this.#screen.send({ type: 'jump', soldier: soldier.id });
    });
  }

  toggleHandCursor(): void {
    this.input.override(this.input.mode === UiMode.HANDCURSOR_MODE ? UiEvent.A_CHANGE_TO_MOVE : UiEvent.M_CHANGE_TO_HANDMODE);
  }

  toggleTalkCursor(): void {
    this.input.override(this.input.mode === UiMode.TALKCURSOR_MODE ? UiEvent.A_CHANGE_TO_MOVE : UiEvent.T_CHANGE_TO_TALKING);
  }

  toggleLookCursor(): void {
    this.input.override(this.input.mode === UiMode.LOOKCURSOR_MODE ? UiEvent.A_CHANGE_TO_MOVE : UiEvent.LC_CHANGE_TO_LOOK);
  }

  #nextMerc(): void {
    const sel = this.#screen.selected();
    if (!sel) return;
    const slots = this.#screen.slotSoldiers().filter((s): s is SoldierView => s !== null && !isDead(s));
    const at = slots.findIndex((s) => s.id === sel.id);
    const next = slots[(at + 1) % Math.max(1, slots.length)] ?? sel;
    this.#screen.locateSelect(next, true);
    const now = this.#screen.selected();
    if (now) this.#screen.locate(now, SHOW_LOCATOR_NORMAL_CYCLES);
  }

  #nextSquad(): void {
    const sel = this.#screen.selected();
    if (!sel || !this.#screen.panelButtonEnabled('squad')) return;
    const current = this.#screen.currentSquad();
    const own = (this.#view()?.soldiers ?? []).filter((s) => s.team === OUR_TEAM && !isDead(s) && s.canAct !== false && !isVehicleBody(s));
    const order = [
      ...Array.from({ length: NUMBER_OF_SQUADS - current - 1 }, (_, i) => current + 1 + i),
      ...Array.from({ length: current + 1 }, (_, i) => i),
    ];
    for (const squad of order) {
      const s = own.find((m) => (m.squad ?? 0) === squad && !isInVehicle(m));
      if (!s) continue;
      if ((s.squad ?? 0) === current) return;
      this.#screen.locateSelect(s, true);
      this.#screen.log(printf(this.#text(MESSAGES, MSG_SQUAD_ACTIVE), [this.#screen.currentSquad() + 1]));
      const now = this.#screen.selected();
      if (now) this.#screen.locate(now, SHOW_LOCATOR_NORMAL_CYCLES);
      return;
    }
  }

  #cycleVisibleEnemies(): void {
    const sel = this.#screen.selected();
    if (!sel) return;
    if (opponentCount(sel) === 0) {
      this.#screen.feedback(this.#text(TACTICAL, NO_ENEMIES_IN_SIGHT_STR));
      return;
    }
    const enemies = visibleEnemies(this.#view(), sel);
    const last = this.#lastVisibleEnemy.get(sel.id) ?? -1;
    const next = enemies.find((e) => e.id > last) ?? enemies[0];
    if (!next) {
      this.#lastVisibleEnemy.delete(sel.id);
      return;
    }
    this.#lastVisibleEnemy.set(sel.id, next.id);
    this.#screen.locate(next, SHOW_LOCATOR_NORMAL_CYCLES);
    this.#screen.setInterfaceLevel(next.level);
  }

  #cycleKnownEnemies(): void {
    const view = this.#view();
    const enemies = (view?.soldiers ?? [])
      .filter((s) => s.team !== OUR_TEAM && !isDead(s) && s.hostile === true)
      .sort((a, b) => a.id - b.id);
    if (enemies.length === 0) {
      this.#screen.feedback(this.#text(TACTICAL, NO_ENEMIES_IN_SIGHT_STR));
      return;
    }
    const next = enemies.find((e) => e.id > this.#lastKnownEnemy) ?? (enemies[0] as SoldierView);
    this.#lastKnownEnemy = next.id;
    this.#screen.locate(next, SHOW_LOCATOR_NORMAL_CYCLES);
    this.#screen.setInterfaceLevel(next.level);
  }

  async #rangeToTarget(): Promise<void> {
    const sel = this.#screen.selected();
    const target = this.input.hover.target?.gridNo ?? this.input.hover.gridNo;
    if (!sel || target === null || target === 0) return;
    const range = Math.trunc(cellRange(sel.gridNo, target) / CELL);
    const hand = slotItem(sel, HANDPOS);
    const item = hand ? this.#env().media.item(hand.item) : null;
    const isGun = item?.class === 'GUN';
    const estimate = item
      ? await hintNow<{ readonly inRange: boolean; readonly maxRange?: number; readonly range?: number }>(this.#env().client, {
          type: 'estimateAttack',
          soldier: sel.id,
          target,
          level: this.#screen.interfaceLevel(),
        })
      : null;
    const data = estimate?.state === 'ok' ? estimate.data : null;
    if (isGun && data?.maxRange !== undefined)
      this.#screen.log(printf(this.#text(NEW_TACTICAL, TCTL_MSG_RANGE_TO_TARGET_AND_GUN_RANGE), [Math.trunc(data.maxRange / CELL), range]));
    else this.#screen.log(printf(this.#text(NEW_TACTICAL, TCTL_MSG_RANGE_TO_TARGET), [range]));
    if (item && GUN_CLASSES.has(item.class) && data && !data.inRange) this.#screen.log(this.#text(TACTICAL, OUT_OF_RANGE_STRING));
  }

  #toggleDisplay(key: 'mercCastsLight' | 'glowItems' | 'treeTops' | 'wireframe' | 'cursor3d' | 'trackingMode'): boolean {
    const env = this.#env();
    const on = !env.display()[key];
    env.setDisplay({ [key]: on });
    return on;
  }

  #gameSettings(): void {
    const version = this.#text(MESSAGES, MSG_VERSION);
    this.#screen.log(`${version}: ${this.#screen.version}`);
    const gun = this.#text(GIO, this.#env().media.gunNut ? GIO_GUN_NUT_TEXT : GIO_REDUCED_GUNS_TEXT);
    this.#screen.log(`${this.#text(GIO, GIO_GUN_OPTIONS_TEXT)}: ${gun}`);
  }

  #reload(squad: boolean): void {
    const soldiers = squad ? this.#screen.squadSoldiers().filter((s) => !isDead(s) && !isVehicleBody(s)) : this.#targets().slice(0, 1);
    for (const s of soldiers) void this.#screen.send({ type: 'reload', soldier: s.id });
  }

  #continueMove(): void {
    const sel = this.#screen.selected();
    if (sel && sel.continueTo !== undefined && sel.continueTo !== null)
      void this.#screen.send({ type: 'move', soldier: sel.id, to: sel.continueTo });
  }

  #swapPlaces(): void {
    const sel = this.#screen.selected();
    const target = this.input.hover.target;
    if (!sel || !target || target.id === sel.id) return;
    if ((sel.life ?? 0) < OKLIFE || (target.life ?? 0) < OKLIFE) return;
    void this.#screen.send({ type: 'swapPlaces', soldier: sel.id, with: target.id });
  }

  #selectAllInSector(): void {
    const ids = (this.#view()?.soldiers ?? [])
      .filter(
        (s) => s.team === OUR_TEAM && !isDead(s) && (s.life ?? 0) >= OKLIFE && s.canAct !== false && !isInVehicle(s) && !isVehicleBody(s),
      )
      .map((s) => s.id);
    this.input.selectGroup(ids);
  }

  #closeMenu(): boolean {
    if (this.movementMenu.open) {
      this.movementMenu.close(null);
      return true;
    }
    if (this.doorMenu.open) {
      this.doorMenu.close(null);
      return true;
    }
    return false;
  }

  #hotkeyHost(): HotkeyHost {
    const screen = this.#screen;
    const env = this.#env();
    const self = this;
    const message = (table: string, index: number) => screen.log(self.#text(table, index));
    return {
      get mode() {
        return self.input.mode;
      },
      get locked() {
        return self.input.lock !== 'none';
      },
      get inCombat() {
        return inCombat(self.#view());
      },
      get ourTurn() {
        return ourTurn(self.#view());
      },
      get inConversation() {
        return (self.#view()?.conversation ?? null) !== null;
      },
      get itemInCursor() {
        return screen.itemInCursor();
      },
      get smPanel() {
        return screen.panel() === 'sm';
      },
      smButtonEnabled: (button) => screen.panelButtonEnabled(button),
      hasSelected: () => screen.selected() !== null,
      closeMenu: () => this.#closeMenu(),
      dismissFeedback: () => screen.dismissFeedback(),
      cancelSpread: () => this.input.cancelSpread(),
      closePopups: () => screen.closePopups(),
      stopSelected: () => {
        const sel = screen.selected();
        if (sel) void screen.send({ type: 'stop', soldier: sel.id });
        this.input.stopRubberBandedMercs();
      },
      nextMerc: () => this.#nextMerc(),
      nextSquad: () => this.#nextSquad(),
      selectSquad: (squad) => {
        if (screen.panelButtonEnabled('squad')) screen.changeSquad(squad);
      },
      selectSlot: (slot, force) => {
        const s = screen.slotSoldiers()[slot] ?? null;
        if (s) screen.locateSelect(s, force);
      },
      locateSelected: () => {
        const sel = screen.selected();
        if (sel) screen.locate(sel, SHOW_LOCATOR_NORMAL_CYCLES);
      },
      selectAllInSector: () => this.#selectAllInSector(),
      weaponMode: () => {
        const sel = screen.selected();
        if (sel) void screen.send({ type: 'weaponMode', soldier: sel.id });
      },
      stance: (stance) => this.#stance(stance),
      higherStance: () => this.#higherStance(),
      lowerStance: () => this.#lowerStance(),
      climb: () => {
        const sel = screen.selected();
        if (sel) void screen.send({ type: 'climb', soldier: sel.id });
      },
      climbWindow: () => {
        const sel = screen.selected();
        if (sel) void screen.send({ type: 'climbWindow', soldier: sel.id });
      },
      cycleVisibleEnemies: () => this.#cycleVisibleEnemies(),
      cycleKnownEnemies: () => this.#cycleKnownEnemies(),
      rangeToTarget: () => void this.#rangeToTarget(),
      toggleMercLight: () => void this.#toggleDisplay('mercCastsLight'),
      toggleItemGlow: () => void this.#toggleDisplay('glowItems'),
      toggleRedItemGlow: () => {
        this.#redItemGlow = !this.#redItemGlow;
      },
      toggleTreeTops: () => message(TACTICAL, this.#toggleDisplay('treeTops') ? SHOWING_TREETOPS_STR : REMOVING_TREETOPS_STR),
      toggleWireframes: () => message(MESSAGES, this.#toggleDisplay('wireframe') ? MSG_WIREFRAMES_ADDED : MSG_WIREFRAMES_REMOVED),
      toggle3dCursor: () => message(MESSAGES, this.#toggleDisplay('cursor3d') ? MSG_3DCURSOR_ON : MSG_3DCURSOR_OFF),
      toggleTracking: () => message(MESSAGES, this.#toggleDisplay('trackingMode') ? MSG_TACKING_MODE_ON : MSG_TACKING_MODE_OFF),
      runMode: () => {
        const sel = screen.selected();
        if (sel && !isRobot(sel)) this.input.runMode(sel);
      },
      swapPlaces: () => this.#swapPlaces(),
      stealth: (squad) => this.stealth(squad),
      overheadMap: () => {
        screen.requestTeamPanel();
        this.overhead.show();
      },
      continueMove: () => this.#continueMove(),
      mapScreen: () => env.flow.mapScreen(),
      help: () => env.flow.help?.(),
      gameSettings: () => this.#gameSettings(),
      cycleStack: () => undefined,
      clearMessages: (queue) => screen.clearMessages(queue),
      swapHands: () => {
        const sel = screen.selected();
        if (sel) screen.swapHands(sel.id);
      },
      reload: (squad) => this.#reload(squad),
      musicDown: () => undefined,
    };
  }

  renderWorld(list: DrawList): void {
    if (this.overhead.open) return;
    const env = this.#env();
    const world = env.world;
    const { width } = env.runtime.geometry();
    const top = this.#screen.viewportTop();
    const bottom = this.#screen.viewportBottom();
    const sel = this.#screen.selected();
    const merc = sel && ourTurn(this.#view()) ? world.soldierTrueScreenPosition(sel.id) : null;
    const arrows = merc ? arrowSprites(this.input.arrows, merc) : [];
    const ap = this.input.apNumber();
    const apAt = ap ? world.markerScreenPoint(ap.marker) : null;
    const bursts = this.input.burstLocations;
    if (bursts.length > 0 || arrows.length > 0 || apAt) {
      list.pushClip(0, top, width, bottom);
      for (const gridNo of bursts) {
        const p = world.tileCentre(gridNo);
        list.image(this.#art.burst, BURST_FRAME, p.x, p.y);
      }
      for (const arrow of arrows) {
        const image = world.tileImage(arrow.tile);
        if (image) list.image(image.path, image.frame, arrow.x, arrow.y);
      }
      if (ap && apAt) this.#renderAp(list, env.runtime.fonts.get(FontName.TINYFONT1), String(ap.value), ap.black, apAt);
      list.popClip();
    }
    this.#renderRubberBand(list, width, bottom);
    this.#renderItemPool(list, width, bottom);
  }

  #renderItemPool(list: DrawList, width: number, bottom: number): void {
    const gridNo = this.input.overItemsGridNo;
    const sel = this.#screen.selected();
    if (gridNo === null || !sel || this.#screen.itemInCursor()) return;
    const items = this.#view()?.items ?? [];
    const onLevel = (level: number) => items.filter((i) => i.gridNo === gridNo && i.level === level && !i.notRendered);
    const shown = onLevel(sel.level).length > 0 ? onLevel(sel.level) : onLevel(sel.level === 0 ? 1 : 0);
    if (shown.length === 0) return;
    const env = this.#env();
    const font = env.runtime.fonts.get(FontName.SMALLFONT1);
    const lines = shown.slice(0, NUM_ITEMS_LISTED).map((i) => {
      const name = env.media.item(i.item)?.shortName ?? i.item;
      return i.count > 1 ? `${name} (${i.count})` : name;
    });
    if (shown.length > NUM_ITEMS_LISTED) lines.push(this.#text(TACTICAL, ITEMPOOL_POPUP_MORE_STR));
    const maxWidth = Math.max(0, ...lines.map((l) => stringPixLength(l, font)));
    const regions = env.runtime.regions;
    const x = regions.mouseX + ITEM_LIST_X + maxWidth <= width ? regions.mouseX + ITEM_LIST_X : regions.mouseX - maxWidth;
    const dy = fontHeight(font) - 2;
    const h = dy * Math.min(shown.length, NUM_ITEMS_LISTED + 1);
    let y =
      regions.mouseY < Math.trunc(h / 2)
        ? 0
        : regions.mouseY + Math.trunc(h / 2) >= bottom
          ? bottom - h
          : regions.mouseY - Math.trunc(h / 2);
    for (const line of lines) {
      mprint(list, font, x, y, line, fontColors(FontColor.MCOLOR_DKGRAY, DEFAULT_SHADOW));
      y += dy;
    }
  }

  #renderAp(list: DrawList, tiny: BitmapFont, text: string, black: boolean, p: { readonly x: number; readonly y: number }): void {
    const at = hCenterVCenterAlign(p.x, p.y, 1, 1, text, tiny);
    mprint(list, tiny, at.x, at.y, text, fontColors(black ? FontColor.MCOLOR_BLACK : FontColor.MCOLOR_WHITE, DEFAULT_SHADOW));
  }

  #renderRubberBand(list: DrawList, width: number, bottom: number): void {
    const band = this.input.rubberBand;
    if (!band || (band.x1 === band.x2 && band.y1 === band.y2)) return;
    const now = this.#env().runtime.clock.ja2Now;
    const colour = RUBBER_BAND_COLOURS[Math.trunc(now / RUBBER_BAND_STEP_MS) % RUBBER_BAND_COLOURS.length] ?? 0;
    const l = Math.max(0, Math.min(band.x1, band.x2));
    const r = Math.min(width - 1, Math.max(band.x1, band.x2));
    const t = Math.max(0, Math.min(band.y1, band.y2));
    const b = Math.min(bottom - 1, Math.max(band.y1, band.y2));
    if (l !== r) {
      list.line(l, t, r, t, colour);
      list.line(l, b, r, b, colour);
    }
    if (t !== b) {
      list.line(l, t, l, b, colour);
      list.line(r, t, r, b, colour);
    }
  }

  renderMenus(list: DrawList): void {
    this.movementMenu.render(list);
    this.doorMenu.render(list);
    this.exitDialog.render(list);
  }

  renderOverhead(list: DrawList): void {
    this.overhead.render(list, this.#env().runtime.fonts.get(FontName.TINYFONT1));
  }
}

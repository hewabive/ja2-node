// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc HandleTacticalUI (the frame flags, the input order mouse position, polled keys,
// @src mouse buttons, queued keys, the pending override event, the single events, the menu modes, the multi-selection
// @src reset), SetUIMouseCursor (the exit arrows at the scrolled map edges and exit grids), the event handlers
// @src UIHandleIDoNothing, UIHandleSelectMerc, UIHandleMOnTerrain (the 1.5 s over items, the exit grid flag, the height
// @src check, CANNOT_MOVE_UICURSOR, the exchange cursor), UIHandleAOnTerrain (the out-of-range line once per target),
// @src UIHandleCWait, UIHandleCMoveMerc (the all-move and the multi-selection through people, bReverse, the OK battle sound
// @src past 5 steps, interactive tiles), UIHandleMCycleMovement, UIHandleMAdjustStanceMode and UIHandlePADJAdjustStance
// @src (GO_MOVE_ONE/TWO/THREE), UIHandleCAOnTerrain, UIHandleMercAttack, UIHandleCAMercShoot (the own-man prompt),
// @src UIHandleHCOnTerrain, UIHandleLCOnTerrain, UIHandleLCLook, UIHandleTOnTerrain, UIHandleJumpOverOnTerrain,
// @src UIHandleJumpOver, UIHandleLUIBeginLock, UIHandleLUIEndLock, UIHandleLABeginLockOurTurn, UIHandleLAEndLockOurTurn,
// @src UIHandleRubberBandOnTerrain, EndRubberBanding, EndMultiSoldierSelection, ResetMultiSelection, UIHandleOnMerc,
// @src HandleUIMovementCursor (the 80 ms PATHFINDCOUNTER rest, the AP offsets), DrawUIMovementPath (the PLOT rule),
// @src SetMovementModeCursor, SetConfirmMovementModeCursor, UIHandleInteractiveTilesAndItemsOnTerrain, GetCursorMovementFlags,
// @src SelectedMercCanAffordMove, SelectedMercCanAffordAttack, UIMouseOnValidAttackLocation, ValidQuickExchangePosition,
// @src IsValidJumpLocation, BeginDisplayTimedCursor; Interactive_Tiles.cc RefineLogicOnStruct (an open door only in the hand
// @src and action modes, a door only with snap-cursor-to-door outside the hand mode); Turn_Based_Input.cc GetTBMouseButtonInput, QueryTBLeftButton,
// @src QueryTBRightButton, QueryTBMiddleButton, GetTBMousePositionInput, GetPolledKeyboardInput, HandleHandCursorClick,
// @src HandleMoveModeInteractiveClick, HandleCheckForExitArrowsInput, TacticalViewPortTouchCallbackTB (the wheel);
// @src Real_Time_Input.cc QueryRTLeftButton (the double click runs, the rubber band after 10 px, ALT toggles the
// @src multi-selection), QueryRTRightButton (the all-move and its double click), QueryRTMiddleButton, GetRTMousePositionInput;
// @src UI_Cursors.cc HandleLeftClickCursor, GetActionModeCursor; Interface_Cursors.cc DrawUICursor; Interactive_Tiles.cc
// @src GetInteractiveTileCursor; Handle_Doors.cc SetDoorString; Timer_Control.cc PATHFINDCOUNTER, L/R/MMOUSECLICK_DELAY.
// @src See docs/28 §6.1–§6.4.

import type { EstimateAttack, PreviewAction, PreviewMove } from '../../../../protocol/hints.ts';
import type { CommandEnvelope } from '../../../../protocol/messages.ts';
import type { PlayerView, SoldierView } from '../../../../protocol/view.ts';
import { VIDEO_DEFAULT_TO_NO_CURSOR, VIDEO_NO_CURSOR } from '../../../cursors/cursor-ids.ts';
import type { MouseText } from '../../../cursors/cursor-state.ts';
import { KeyModifier, type UiKeyEvent } from '../../../input/events.ts';
import { MouseButtonMask, MouseReason, Priority } from '../../../input/mouse.ts';
import type { MouseRegion } from '../../../input/regions.ts';
import { printf } from '../../../text/printf.ts';
import type { CommandReply, ScrollEdges, TacticalEnvironment, WorldMarker } from '../environment.ts';
import { OKLIFE } from '../faces.ts';
import { inCombat, isEpc, isRobot, OUR_TEAM, ourTurn, soldierById } from '../soldiers.ts';
import { Arrows } from './arrows.ts';
import {
  type AimState,
  aimTimeOf,
  attackCursor,
  confirmsBeforeAttack,
  REFINE_AIM_1,
  rightClickAdjust,
  wheelAdjust,
} from './attack-cursors.ts';
import { dataOf, type HintState, hintNow, hintState } from './hints.ts';
import { PointerQueue } from './pointer-queue.ts';
import { BodyPart, FindFlag, hostileToOurTeam, relativeBodyPart, soldierFindFlags } from './targets.ts';
import { UiCursorFlag } from './ui-cursors.ts';
import { MouseMove, MoveUiTarget, Selection, SINGLE_EVENT, UI_EVENTS, UiEvent, UiMode } from './ui-events.ts';
import { apNumberMarker, cursorMarkers, footstepMarkers, impactMarker, selectionMarker, showMoveGridMarker } from './world-markers.ts';

export const PATHFIND_DELAY_MS = 80;
export const CLICK_HOLD_MS = 300;
export const DOUBLE_CLICK_MS = 300;
const EXCHANGE_CURSOR_MS = 1000;
const ITEMS_OVER_MS = 1500;
const RUBBER_BAND_START_PX = 10;
const OK_SOUND_STEPS = 5;
const TIMED_RUN_CURSOR_MS = 300;
const RT_FEEDBACK_MS = 500;
export const GO_MOVE_ONE = 40;
export const GO_MOVE_TWO = 80;
export const GO_MOVE_THREE = 100;
export const NO_PX_SHOW_EXIT_CURS = 15;
const AP_TALK = 6;
const NPC_TALK_RADIUS = 4;
const NO_PATH_STR = 114;
const NOBODY_USING_REMOTE_STR = 88;
const CANT_MOVE_THERE_STR = 34;
const OUT_OF_RANGE_STRING = 126;
const ATTACK_OWN_GUY_PROMPT = 28;
const MSG_SQUAD_ACTIVE = 59;
const DOOR_DOOR_MOUSE_DESCRIPTION = 9;
const DOOR_TRAPPED_MOUSE_DESCRIPTION = 10;
const DOOR_LOCKED_MOUSE_DESCRIPTION = 11;
const DOOR_UNLOCKED_MOUSE_DESCRIPTION = 12;
const DOOR_BROKEN_MOUSE_DESCRIPTION = 13;
const MSG_OPENED = 26;
const MSG_CLOSED = 27;
const STR_LATE_25 = 24;
const HIT_LOCATION_STR: Readonly<Record<BodyPart, number>> = { head: 107, torso: 108, legs: 109 };
const NECK_HIT_LOCATION_STR = 106;
const WALK = 'walk';
const RUN = 'run';
const SWAT = 'swat';
const CRAWL = 'crawl';
const MODE_CYCLE: Readonly<Record<string, string>> = { run: WALK, walk: SWAT, swat: CRAWL, crawl: RUN };
const TALKABLE = new Set(['npc', 'epc', 'civilian']);

export type MoveModeName = 'walk' | 'run' | 'swat' | 'crawl';
export type Lock = 'none' | 'enemyTurn' | 'ourTurn';

export interface TacticalInputHost {
  readonly env: TacticalEnvironment;
  selected(): SoldierView | null;
  selectFromUi(s: SoldierView): void;
  interfaceLevel(): number;
  setInterfaceLevel(level: number): void;
  viewportBottom(): number;
  itemInCursor(): boolean;
  feedback(text: string): void;
  log(text: string): void;
  currentSquad(): number;
  squadSoldiers(): readonly SoldierView[];
  send(cmd: CommandEnvelope): Promise<CommandReply>;
  sendBusyOrder(cmd: CommandEnvelope): Promise<CommandReply>;
  locked(): Lock;
  itemPointerClick(gridNo: number, target: SoldierView | null): void;
  pickUp(soldier: SoldierView, gridNo: number, level: number): void;
  openMovementMenu(x: number, y: number, done: (choice: MovementChoice | null) => void): void;
  openExitDialog(direction: ExitDirection, exitGrid: number | null): void;
  doorReply(soldier: number, gridNo: number, reply: CommandReply): void;
  confirm(text: string): Promise<boolean>;
  dismissFeedback(): boolean;
  closeCivQuote(): boolean;
  key(event: UiKeyEvent, current: UiEvent): UiEvent;
}

export type ExitDirection = 'north' | 'east' | 'south' | 'west' | 'exitGrid';
export type MovementChoice = 'look' | 'run' | 'walk' | 'action' | 'swat' | 'talk' | 'hand' | 'prone';

interface EventState {
  firstTime: boolean;
  doneMenu: boolean;
  previousMode: UiMode;
  choice: MovementChoice | null;
}

interface Hover {
  readonly gridNo: number | null;
  readonly target: SoldierView | null;
  readonly flags: number;
}

const NO_HOVER: Hover = { gridNo: null, target: null, flags: 0 };

export class TacticalInput {
  readonly #host: TacticalInputHost;
  readonly #pointer = new PointerQueue();
  readonly #events = new Map<UiEvent, EventState>();
  readonly #keys: UiKeyEvent[] = [];
  readonly #moveModes = new Map<number, MoveModeName>();
  readonly #aims = new Map<number, AimState>();
  readonly multiSelected = new Set<number>();
  #now = 0;
  #mode: UiMode = UiMode.IDLE_MODE;
  #event: UiEvent = UiEvent.I_DO_NOTHING;
  #pending: UiEvent = UiEvent.I_DO_NOTHING;
  #newCursor = 'NORMAL_SNAPUICURSOR';
  #cursor = 'NO_UICURSOR';
  #timedCursor: { readonly cursor: string; readonly until: number } | null = null;
  #hover: Hover = NO_HOVER;
  #lastMouse = { x: -1, y: -1, gridNo: -2, stationary: false };
  #moveState: MouseMove = MouseMove.NEW_TILE;
  #pathRestSince = 0;
  #plotNew = true;
  #displayAp = false;
  #apInvalid = false;
  #apCenter = false;
  #apOffX = 0;
  #apOffY = 0;
  #currentAp = 1;
  #steps: readonly WorldMarker[] = [];
  #showMoveGrid = 0;
  #showMoveGridAt = -1;
  #selection: Selection = Selection.NONE;
  #selectionAt = { gridNo: -1, level: 0 };
  #arrows = 0;
  #impact: { gridNo: number; level: number; good: boolean } | null = null;
  #hitLocation: string | null = null;
  #tileText: string | null = null;
  #tileText2: string | null = null;
  #leftDown = false;
  #rightDown = false;
  #middleDown = false;
  #ignoreLeftUp = false;
  #tbClickHold = false;
  #tbRightHold = false;
  #tbRightClick = false;
  #rtLeftHold = false;
  #rtRightHold = false;
  #rtRightClick = false;
  #rtRightWhileLeft = false;
  #leftDownAt = 0;
  #rightDownAt = 0;
  #leftUpAt = -1_000_000;
  #rightUpAt = -1_000_000;
  #validDoubleLeft = false;
  #validDoubleRight = false;
  #exchangeOk = false;
  #exchangeSince = 0;
  #reverse = false;
  #ctrlDown = false;
  #altDown = false;
  #allMoveOn = 0;
  #canBeginAllMove = false;
  #firstCycleStarted = false;
  #fast = false;
  #spreadTracking = false;
  #doSpread = false;
  #burstLocations: number[] = [];
  #startGridNo = -1;
  #jumpOverGridNo = -1;
  #rubberLooking = false;
  #rubberStart = { x: 0, y: 0 };
  #rubberActive = false;
  #rubberEnd = { x: 0, y: 0 };
  #itemsOver: { gridNo: number; level: number; since: number } | null = null;
  #overItemsGridNo: number | null = null;
  #outOfRange: { gridNo: number; soldier: number } | null = null;
  #moveTarget: number | null = null;
  #actionChangeByMouseOver = false;
  #targetSoldier: number | null = null;
  #onValidGuy = false;
  #oldMapPos = -1;
  #stanceAnchorY = 0;
  #stanceDiff = 0;
  #climbId = 0;
  #stanceRange = { up: 0, down: 0, higher: false, lower: false };
  #confirmExitArrows = false;
  #showExitGrid = false;
  #lockRegion: MouseRegion | null = null;
  #lock: Lock = 'none';
  #busy = false;
  #lastAttack: { cursor: EstimateAttack | null } = { cursor: null };
  #menuChoice: MovementChoice | null = null;
  #exitRefusal: string | null = null;

  constructor(host: TacticalInputHost) {
    this.#host = host;
  }

  get mode(): UiMode {
    return this.#mode;
  }

  get event(): UiEvent {
    return this.#event;
  }

  get uiCursor(): string {
    return this.#cursor;
  }

  get currentActionPoints(): number {
    return this.#currentAp;
  }

  get hover(): Hover {
    return this.#hover;
  }

  get arrows(): number {
    return this.#arrows;
  }

  get rubberBand(): { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number } | null {
    return this.#rubberActive ? { x1: this.#rubberStart.x, y1: this.#rubberStart.y, x2: this.#rubberEnd.x, y2: this.#rubberEnd.y } : null;
  }

  get burstLocations(): readonly number[] {
    return this.#spreadTracking ? this.#burstLocations : [];
  }

  get overItemsGridNo(): number | null {
    return this.#overItemsGridNo;
  }

  selectGroup(ids: readonly number[]): void {
    this.multiSelected.clear();
    for (const id of ids) this.multiSelected.add(id);
    this.#endMultiSelection(true);
  }

  runMode(sel: SoldierView): void {
    const mode = this.moveModeOf(sel);
    if (mode !== WALK && mode !== RUN) void this.#host.send({ type: 'stance', soldier: sel.id, stance: 'stand' });
    else this.setMoveMode(sel.id, RUN);
    this.#fast = true;
  }

  get spreadTracking(): boolean {
    return this.#spreadTracking;
  }

  get busy(): boolean {
    return this.#busy;
  }

  get lock(): Lock {
    return this.#lock;
  }

  #env(): TacticalEnvironment {
    return this.#host.env;
  }

  #view(): PlayerView | null {
    return this.#env().client.view;
  }

  #combat(): boolean {
    return inCombat(this.#view());
  }

  #sel(): SoldierView | null {
    return this.#host.selected();
  }

  #text(table: string, index: number): string {
    return this.#env().text.string(table, index) ?? '';
  }

  #feedback(index: number, args: readonly (string | number)[] = []): void {
    this.#host.feedback(printf(this.#text('TacticalStr', index), args));
  }

  aimOf(id: number): AimState {
    let aim = this.#aims.get(id);
    if (!aim) {
      aim = { shownAimTime: REFINE_AIM_1, fullCountRing: false };
      this.#aims.set(id, aim);
    }
    return aim;
  }

  moveModeOf(s: SoldierView): MoveModeName {
    const height = this.#env().world.soldierHeight(s.id);
    const byStance: MoveModeName = height === 'prone' ? CRAWL : height === 'crouch' ? SWAT : WALK;
    const chosen = this.#moveModes.get(s.id);
    if (!chosen) return byStance;
    if (chosen === RUN && height !== 'stand') return byStance;
    return chosen;
  }

  setMoveMode(id: number, mode: MoveModeName): void {
    this.#moveModes.set(id, mode);
    this.#plotNew = true;
  }

  clearMoveMode(id: number): void {
    this.#moveModes.delete(id);
    this.#plotNew = true;
  }

  queueKey(event: UiKeyEvent): void {
    this.#keys.push(event);
  }

  pointerButton(reason: number): void {
    this.#pointer.push(reason, true, this.#now);
    if (reason & (MouseReason.WHEEL_UP | MouseReason.WHEEL_DOWN)) this.#wheel(reason & MouseReason.WHEEL_UP ? -1 : 1);
  }

  override(event: UiEvent): void {
    this.#pending = event;
  }

  changeToMove(): void {
    this.#pending = UiEvent.A_CHANGE_TO_MOVE;
  }

  frame(now: number, viewportInArea: boolean): void {
    this.#now = now;
    this.#resetFrameFlags();
    this.#updateHover(viewportInArea);
    this.#updateMoveState();
    this.#syncLock();
    if (now - this.#exchangeSince > EXCHANGE_CURSOR_MS) {
      this.#exchangeOk = !this.#exchangeOk;
      this.#exchangeSince = now;
    }
    this.#pointer.next(viewportInArea, (mask) => this.#env().runtime.regions.isButtonDown(mask), now);
    let next = this.#event;
    const old = this.#event;
    if (this.#pending === UiEvent.I_DO_NOTHING) {
      next = this.#gatherInput(next);
    } else {
      next = this.#pending;
      this.#pending = UiEvent.I_DO_NOTHING;
    }
    this.#event = next;
    if (next !== old) this.#clearEvent(next);
    this.#handle(next);
    const state = this.#state(next);
    state.firstTime = false;
    const spec = UI_EVENTS[next];
    if (spec.mode !== UiMode.DONT_CHANGEMODE && spec.mode !== this.#mode) {
      state.previousMode = this.#mode;
      this.#mode = spec.mode;
      if (this.#mode === UiMode.ACTION_MODE) this.#erasePath();
    }
    if (state.doneMenu && (this.#mode === UiMode.MENU_MODE || this.#mode === UiMode.LOOKCURSOR_MODE)) this.#mode = state.previousMode;
    if (spec.flags & SINGLE_EVENT) {
      if (viewportInArea) this.#event = old;
      else if (this.#mode !== UiMode.HANDCURSOR_MODE && this.#mode !== UiMode.LOOKCURSOR_MODE && this.#mode !== UiMode.TALKCURSOR_MODE)
        this.#event = UiEvent.M_ON_TERRAIN;
    }
    if (!this.#combat()) this.#displayAp = false;
    this.#setUiMouseCursor();
    if (this.multiSelected.size > 0 && !MULTI_SELECT_MODES.has(this.#mode)) this.multiSelected.clear();
  }

  #state(event: UiEvent): EventState {
    let state = this.#events.get(event);
    if (!state) {
      state = { firstTime: true, doneMenu: false, previousMode: UiMode.DONT_CHANGEMODE, choice: null };
      this.#events.set(event, state);
    }
    return state;
  }

  #clearEvent(event: UiEvent): void {
    const state = this.#state(event);
    state.firstTime = true;
    state.doneMenu = false;
    state.previousMode = UiMode.DONT_CHANGEMODE;
    state.choice = null;
  }

  endMenu(choice: MovementChoice | null): void {
    const state = this.#state(this.#event);
    state.doneMenu = true;
    state.choice = choice;
  }

  #resetFrameFlags(): void {
    this.#displayAp = false;
    this.#apInvalid = false;
    this.#apCenter = false;
    this.#selection = Selection.NONE;
    this.#arrows = 0;
    this.#hitLocation = null;
    this.#tileText = null;
    this.#tileText2 = null;
    this.#showExitGrid = false;
    this.#impact = null;
    this.#showMoveGrid = 0;
  }

  #updateHover(inArea: boolean): void {
    const env = this.#env();
    const regions = env.runtime.regions;
    if (!inArea || !regions.pointerKnown) {
      this.#hover = NO_HOVER;
      return;
    }
    const x = regions.mouseX;
    const y = regions.mouseY;
    const gridNo = env.world.gridNoAt(x, y);
    if (gridNo === null) {
      this.#hover = NO_HOVER;
      return;
    }
    const view = this.#view();
    const shift = (env.runtime.modifiers & KeyModifier.SHIFT) !== 0;
    const level = this.#host.interfaceLevel();
    const picked = shift ? null : soldierById(view, env.world.soldierAt(x, y));
    const byTile = view?.soldiers.find((s) => s.gridNo === gridNo && (s.level > 0 ? 1 : 0) === level) ?? null;
    const target = picked ?? byTile;
    this.#hover = { gridNo, target, flags: target ? soldierFindFlags(target, this.#sel()?.id ?? null, view) : 0 };
  }

  #updateMoveState(): void {
    const regions = this.#env().runtime.regions;
    const x = regions.mouseX;
    const y = regions.mouseY;
    const gridNo = this.#hover.gridNo ?? -1;
    const last = this.#lastMouse;
    if (x === last.x && y === last.y) {
      this.#moveState = MouseMove.STATIONARY;
      last.stationary = true;
    } else if (last.stationary && last.gridNo === gridNo) this.#moveState = MouseMove.IN_TILE;
    else {
      this.#moveState = MouseMove.NEW_TILE;
      last.stationary = false;
    }
    last.x = x;
    last.y = y;
    last.gridNo = gridNo;
  }

  #syncLock(): void {
    const lock = this.#host.locked();
    if (lock === this.#lock) return;
    if (lock === 'enemyTurn') this.#pending = UiEvent.LU_BEGINUILOCK;
    else if (lock === 'ourTurn') this.#pending = UiEvent.LA_BEGINUIOURTURNLOCK;
    else this.#pending = this.#lock === 'enemyTurn' ? UiEvent.LU_ENDUILOCK : UiEvent.LA_ENDUIOUTURNLOCK;
    this.#lock = lock;
  }

  #gatherInput(current: UiEvent): UiEvent {
    let event = current;
    const combat = this.#combat();
    event = combat ? this.#tbPositionInput(event) : this.#rtPositionInput(event);
    event = this.#polledKeys(event);
    event = combat ? this.#tbButtons(event) : this.#rtButtons(event);
    event = this.#keyboard(event);
    return event;
  }

  #mapPos(): number | null {
    return this.#hover.gridNo;
  }

  #pathfindDone(): boolean {
    return this.#now - this.#pathRestSince >= PATHFIND_DELAY_MS;
  }

  #erasePath(): void {
    this.#steps = [];
    this.#showMoveGridAt = -1;
  }

  #targetIs(flag: number): boolean {
    return (this.#hover.flags & flag) !== 0;
  }

  #tbPositionInput(event: UiEvent): UiEvent {
    const mapPos = this.#mapPos();
    if (mapPos === null) return event;
    if (this.#host.itemInCursor()) return UiEvent.A_ON_TERRAIN;
    let next = event;
    switch (this.#mode) {
      case UiMode.LOCKUI_MODE:
        next = UiEvent.LU_ON_TERRAIN;
        break;
      case UiMode.LOCKOURTURN_UI_MODE:
        next = UiEvent.LA_ON_TERRAIN;
        break;
      case UiMode.IDLE_MODE:
        next = UiEvent.I_ON_TERRAIN;
        break;
      case UiMode.ENEMYS_TURN_MODE:
        next = UiEvent.ET_ON_TERRAIN;
        break;
      case UiMode.LOOKCURSOR_MODE:
        next = UiEvent.LC_ON_TERRAIN;
        break;
      case UiMode.TALKCURSOR_MODE:
        if (this.#moveTarget !== null && this.#hover.target?.id !== this.#moveTarget) return UiEvent.A_CHANGE_TO_MOVE;
        next = UiEvent.T_ON_TERRAIN;
        break;
      case UiMode.MOVE_MODE:
        next = this.#moveModePosition(false);
        if (next === UiEvent.JP_ON_TERRAIN || next === UiEvent.T_CHANGE_TO_TALKING) return next;
        break;
      case UiMode.ACTION_MODE:
        next = this.#actionModePosition(true);
        if (next === UiEvent.A_CHANGE_TO_MOVE) return next;
        break;
      case UiMode.JUMPOVER_MODE:
        next = this.#jumpOverGridNo !== mapPos ? UiEvent.A_CHANGE_TO_MOVE : UiEvent.JP_ON_TERRAIN;
        break;
      case UiMode.CONFIRM_MOVE_MODE:
        if (mapPos !== this.#oldMapPos) {
          next = UiEvent.A_CHANGE_TO_MOVE;
          this.#allMoveOn = 0;
          this.#erasePath();
        }
        break;
      case UiMode.CONFIRM_ACTION_MODE:
        next = this.#confirmActionPosition(next, mapPos);
        break;
      case UiMode.HANDCURSOR_MODE:
        next = UiEvent.HC_ON_TERRAIN;
        break;
      default:
        break;
    }
    this.#oldMapPos = mapPos;
    return next;
  }

  #rtPositionInput(event: UiEvent): UiEvent {
    const mapPos = this.#mapPos();
    if (mapPos === null) return event;
    if (this.#host.itemInCursor()) return UiEvent.A_ON_TERRAIN;
    let next = event;
    switch (this.#mode) {
      case UiMode.RUBBERBAND_MODE:
        next = this.#rubberActive ? UiEvent.RB_ON_TERRAIN : UiEvent.M_ON_TERRAIN;
        break;
      case UiMode.JUMPOVER_MODE:
        next = this.#jumpOverGridNo !== mapPos ? UiEvent.A_CHANGE_TO_MOVE : UiEvent.JP_ON_TERRAIN;
        break;
      case UiMode.LOCKUI_MODE:
        next = UiEvent.LU_ON_TERRAIN;
        break;
      case UiMode.IDLE_MODE:
        next = UiEvent.I_ON_TERRAIN;
        break;
      case UiMode.LOOKCURSOR_MODE:
        next = UiEvent.LC_ON_TERRAIN;
        break;
      case UiMode.TALKCURSOR_MODE:
        if (this.#moveTarget !== null && this.#hover.target?.id !== this.#moveTarget) return UiEvent.A_CHANGE_TO_MOVE;
        next = UiEvent.T_ON_TERRAIN;
        break;
      case UiMode.HANDCURSOR_MODE:
        next = UiEvent.HC_ON_TERRAIN;
        break;
      case UiMode.MOVE_MODE:
        if (mapPos !== this.#oldMapPos) this.#allMoveOn = 0;
        next = this.#moveModePosition(true);
        if (next !== UiEvent.M_ON_TERRAIN) {
          this.#oldMapPos = mapPos;
          return next;
        }
        break;
      case UiMode.ACTION_MODE:
        next = this.#actionModePosition(false);
        if (next === UiEvent.A_CHANGE_TO_MOVE) return next;
        break;
      case UiMode.CONFIRM_MOVE_MODE:
        if (mapPos !== this.#oldMapPos) {
          this.#allMoveOn = 0;
          next = UiEvent.A_CHANGE_TO_MOVE;
        }
        break;
      case UiMode.CONFIRM_ACTION_MODE:
        next = this.#confirmActionPosition(next, mapPos);
        break;
      default:
        break;
    }
    this.#oldMapPos = mapPos;
    return next;
  }

  #validJump(mapPos: number): boolean {
    const sel = this.#sel();
    if (!sel || this.#hover.target?.id === sel.id || (this.#currentAp !== 0 && this.#cursor !== 'NO_UICURSOR')) return false;
    const answer = this.#hint<PreviewAction>({
      type: 'previewAction',
      soldier: sel.id,
      gridNo: mapPos,
      kind: 'jump',
      level: this.#host.interfaceLevel(),
    });
    return answer.state === 'ok' && answer.data.ok;
  }

  #validQuickExchange(): boolean {
    const sel = this.#sel();
    const target = this.#hover.target;
    if (!sel || !target || target.id === sel.id) return false;
    if (!(target.team !== OUR_TEAM && (target.hostile !== true || target.team === MILITIA_TEAM))) return false;
    const answer = this.#hint<PreviewAction>({
      type: 'previewAction',
      soldier: sel.id,
      gridNo: target.gridNo,
      kind: 'swap',
      target: target.id,
    });
    return answer.state === 'ok' && answer.data.ok;
  }

  #talkableNpc(target: SoldierView | null): boolean {
    return target !== null && target.team !== OUR_TEAM && target.talkable !== undefined && TALKABLE.has(target.talkable);
  }

  #moveModePosition(realTime: boolean): UiEvent {
    this.#moveTarget = null;
    const sel = this.#sel();
    const mapPos = this.#mapPos();
    if (sel && mapPos !== null) {
      if (this.#validJump(mapPos)) {
        this.#jumpOverGridNo = mapPos;
        return UiEvent.JP_ON_TERRAIN;
      }
      const target = this.#hover.target;
      const shift = (this.#env().runtime.modifiers & KeyModifier.SHIFT) !== 0;
      if (target && !hostileToOurTeam(target)) {
        if (this.#talkableNpc(target) && !shift && !isEpc(sel) && !this.#validQuickExchange()) {
          this.#moveTarget = target.id;
          return UiEvent.T_CHANGE_TO_TALKING;
        }
      } else if (realTime && target && this.#targetIs(FindFlag.ENEMY) && !this.#targetIs(FindFlag.DEAD)) {
        const estimate = dataOf(this.#estimate(target.gridNo, target.level));
        if (estimate?.cursor !== 'aid') {
          this.#moveTarget = target.id;
          return UiEvent.A_ON_TERRAIN;
        }
      }
    }
    return UiEvent.M_ON_TERRAIN;
  }

  #actionModePosition(turnBased: boolean): UiEvent {
    this.#targetSoldier = null;
    if (turnBased) this.#onValidGuy = false;
    const target = this.#hover.target;
    if (target) {
      this.#targetSoldier = target.id;
      if (target.team !== OUR_TEAM) this.#onValidGuy = true;
      else if (this.#actionChangeByMouseOver) return UiEvent.A_CHANGE_TO_MOVE;
    } else if (this.#actionChangeByMouseOver) return UiEvent.A_CHANGE_TO_MOVE;
    return UiEvent.A_ON_TERRAIN;
  }

  #confirmActionPosition(_event: UiEvent, mapPos: number): UiEvent {
    const sel = this.#sel();
    if (sel && this.#selBurst(sel)) {
      if (mapPos !== this.#startGridNo && this.#leftDown) {
        this.#doSpread = true;
        this.#spreadTracking = true;
      }
      if (this.#doSpread) {
        this.#accumulateBurst(mapPos);
        return UiEvent.CA_ON_TERRAIN;
      }
    }
    const target = this.#hover.target;
    if (target) return this.#targetSoldier !== target.id ? UiEvent.CA_END_CONFIRM_ACTION : UiEvent.CA_ON_TERRAIN;
    if (this.#onValidGuy) return UiEvent.CA_END_CONFIRM_ACTION;
    return mapPos !== this.#oldMapPos ? UiEvent.CA_END_CONFIRM_ACTION : UiEvent.CA_ON_TERRAIN;
  }

  #accumulateBurst(gridNo: number): void {
    if (this.#burstLocations.length >= MAX_BURST_LOCATIONS || this.#burstLocations.includes(gridNo)) return;
    this.#burstLocations.push(gridNo);
  }

  #selBurst(s: SoldierView): boolean {
    return s.weaponMode === 'burst';
  }

  #polledKeys(event: UiEvent): UiEvent {
    const env = this.#env();
    const ctrl = (env.runtime.modifiers & KeyModifier.CTRL) !== 0;
    const alt = (env.runtime.modifiers & KeyModifier.ALT) !== 0;
    let next = event;
    if (CTRL_MODES.has(this.#mode)) {
      if (ctrl) {
        if (!this.#ctrlDown) {
          this.#erasePath();
          this.#plotNew = true;
        }
        this.#ctrlDown = true;
        next = UiEvent.HC_ON_TERRAIN;
      }
      if (!ctrl && this.#ctrlDown) {
        this.#ctrlDown = false;
        next = UiEvent.M_ON_TERRAIN;
        this.#plotNew = true;
      }
    }
    if (this.#mode === UiMode.MOVE_MODE) {
      if (alt && !this.#altDown && this.#sel()) {
        this.#reverse = true;
        this.#erasePath();
        this.#plotNew = true;
      }
      if (alt) this.#altDown = true;
      if (!alt && this.#altDown) {
        if (this.#sel()) {
          this.#reverse = false;
          this.#erasePath();
          this.#plotNew = true;
        }
        this.#altDown = false;
      }
    }
    return next;
  }

  #keyboard(event: UiEvent): UiEvent {
    let next = event;
    while (this.#keys.length > 0) next = this.#host.key(this.#keys.shift() as UiKeyEvent, next);
    return next;
  }

  #tbButtons(event: UiEvent): UiEvent {
    let next = this.#tbLeft(event);
    next = this.#tbRight(next);
    next = this.#tbMiddle(next);
    return next;
  }

  #rtButtons(event: UiEvent): UiEvent {
    let next = this.#rtLeft(event);
    next = this.#rtRight(next);
    next = this.#rtMiddle(next);
    return next;
  }

  #clickHeld(since: number): boolean {
    return this.#now - since >= CLICK_HOLD_MS;
  }

  #tbMiddle(event: UiEvent): UiEvent {
    if (this.#mapPos() === null || !this.#pointer.inViewport) return event;
    let next = event;
    if (this.#pointer.isDown(MouseButtonMask.MIDDLE) && !this.#middleDown) this.#middleDown = true;
    if (this.#middleDown && !this.#pointer.isDown(MouseButtonMask.MIDDLE)) {
      const shift = (this.#env().runtime.modifiers & KeyModifier.SHIFT) !== 0;
      if (!shift && !this.#host.itemInCursor()) next = UiEvent.LC_ON_TERRAIN;
      this.#middleDown = false;
    }
    return next;
  }

  #rtMiddle(event: UiEvent): UiEvent {
    if (this.#mapPos() === null || !this.#pointer.inViewport) return event;
    let next = event;
    if (this.#pointer.isDown(MouseButtonMask.MIDDLE)) this.#middleDown = true;
    else if (this.#middleDown) {
      const shift = (this.#env().runtime.modifiers & KeyModifier.SHIFT) !== 0;
      if (!shift) next = UiEvent.LC_LOOK;
      this.#middleDown = false;
    }
    return next;
  }

  #tbLeft(event: UiEvent): UiEvent {
    let next = event;
    if (!this.#pointer.inViewport) {
      if (this.#spreadTracking) {
        this.#doSpread = false;
        this.#spreadTracking = false;
      }
      if (!this.#pointer.isDown(MouseButtonMask.LEFT)) this.#resetLeft();
      return next;
    }
    const mapPos = this.#mapPos();
    if (mapPos === null && !this.#overSouthExit()) return next;
    if (this.#pointer.isDown(MouseButtonMask.LEFT)) {
      if (!this.#leftDown) {
        this.#leftDown = true;
        this.#leftDownAt = this.#now;
        next = this.#tbLeftPress(next, mapPos);
      }
      if (this.#mode === UiMode.MOVE_MODE && this.#targetIs(FindFlag.SELECTED) && !this.#targetIs(FindFlag.UNCONSCIOUS)) {
        next = UiEvent.M_CHANGE_TO_ADJPOS_MODE;
        this.#ignoreLeftUp = false;
      }
      return next;
    }
    if (this.#leftDown) {
      if (!this.#ignoreLeftUp) next = this.#tbLeftRelease(next, mapPos);
      this.#resetLeft();
    }
    return next;
  }

  #resetLeft(): void {
    this.#leftDown = false;
    this.#ignoreLeftUp = false;
    this.#tbClickHold = false;
    this.#firstCycleStarted = false;
    this.#rtLeftHold = false;
    this.#rubberLooking = false;
    this.#leftDownAt = this.#now;
  }

  #tbLeftPress(event: UiEvent, mapPos: number | null): UiEvent {
    let next = event;
    switch (this.#mode) {
      case UiMode.CONFIRM_ACTION_MODE:
        if (mapPos !== null) this.#startGridNo = mapPos;
        break;
      case UiMode.MOVE_MODE:
        if (this.#exitArrowsInput(false)) break;
        if (!this.#host.itemInCursor()) {
          const target = this.#hover.target;
          if (target && this.#targetIs(FindFlag.OWNED)) {
            if (!this.#targetIs(FindFlag.UNCONSCIOUS)) {
              this.#tbClickHold = true;
              next = UiEvent.I_SELECT_MERC;
            }
          } else {
            if (this.#sel() && mapPos !== null) next = this.#tbMoveClick(next, mapPos);
            this.#tbClickHold = true;
          }
        }
        break;
      default:
        break;
    }
    return next;
  }

  #tbMoveClick(event: UiEvent, mapPos: number): UiEvent {
    const result = this.#moveModeInteractiveClick();
    if (result === -2) {
      if (this.#canAffordMove()) return UiEvent.C_WAIT_FOR_CONFIRM;
    } else if (result === 0) {
      if (this.#allMoveOn) return UiEvent.C_WAIT_FOR_CONFIRM;
      if (this.#currentAp === 0) this.#feedback(NO_PATH_STR);
      else {
        const move = this.#previewMove(mapPos);
        if (move.state === 'pending') void this.#confirmWhenPlotted(mapPos);
        else if (this.#canAffordMove()) {
          const destination = move.state === 'ok' ? move.data.destination : 'blocked';
          if (destination === 'ok') return UiEvent.C_WAIT_FOR_CONFIRM;
          if (destination === 'robotUncontrolled') this.#feedback(NOBODY_USING_REMOTE_STR);
        }
      }
    }
    this.#canBeginAllMove = false;
    return event;
  }

  async #confirmWhenPlotted(mapPos: number): Promise<void> {
    const sel = this.#sel();
    if (!sel) return;
    const answer = await hintNow<PreviewMove>(this.#env().client, this.#moveRequest(sel, mapPos));
    if (answer.state !== 'ok' || this.#mapPos() !== mapPos || this.#mode !== UiMode.MOVE_MODE) return;
    this.#currentAp = answer.data.apCost;
    if (answer.data.apCost === 0) {
      this.#feedback(NO_PATH_STR);
      return;
    }
    if (!answer.data.affordable) {
      this.#notEnoughAp();
      return;
    }
    if (answer.data.destination === 'ok') this.#pending = UiEvent.C_WAIT_FOR_CONFIRM;
  }

  #notEnoughAp(): void {
    this.#feedback(NOT_ENOUGH_APS_STR);
  }

  #tbLeftRelease(event: UiEvent, mapPos: number | null): UiEvent {
    let next = event;
    if (this.#mode === UiMode.ADJUST_STANCE_MODE) next = UiEvent.PADJ_ADJUST_STANCE;
    if (this.#clickHeld(this.#leftDownAt) && this.#mode === UiMode.CONFIRM_ACTION_MODE) {
      const sel = this.#sel();
      if (sel && this.#selBurst(sel)) {
        this.#spreadTracking = false;
        if (mapPos !== null && mapPos !== this.#startGridNo) {
          this.#doSpread = true;
          next = UiEvent.CA_MERC_SHOOT;
        } else this.#doSpread = false;
        this.#tbClickHold = true;
      }
    }
    if (this.#tbClickHold) return next;
    if (this.#host.env.client.view && this.#feedbackOpenClosed()) return next;
    if (this.#exitArrowsInput(true)) return next;
    if (this.#host.itemInCursor()) {
      if (mapPos !== null) this.#host.itemPointerClick(mapPos, this.#hover.target);
      return next;
    }
    switch (this.#mode) {
      case UiMode.MENU_MODE:
        this.endMenu(null);
        break;
      case UiMode.IDLE_MODE:
        if (this.#hover.target && this.#targetIs(FindFlag.OWNED) && !this.#targetIs(FindFlag.UNCONSCIOUS)) next = UiEvent.I_SELECT_MERC;
        break;
      case UiMode.CONFIRM_MOVE_MODE:
        next = UiEvent.C_MOVE_MERC;
        break;
      case UiMode.HANDCURSOR_MODE:
        if (mapPos !== null) next = this.#handCursorClick(mapPos, next);
        break;
      case UiMode.JUMPOVER_MODE: {
        const sel = this.#sel();
        if (sel && this.#enoughPoints(sel, this.#currentAp, true)) next = UiEvent.JP_JUMP;
        break;
      }
      case UiMode.ACTION_MODE:
        next = this.#actionClick(next, mapPos);
        break;
      case UiMode.CONFIRM_ACTION_MODE:
        next = UiEvent.CA_MERC_SHOOT;
        break;
      case UiMode.LOOKCURSOR_MODE:
        next = UiEvent.LC_LOOK;
        break;
      case UiMode.TALKCURSOR_MODE:
        if (this.#talkInit()) next = UiEvent.TA_TALKINGMENU;
        break;
      default:
        break;
    }
    return next;
  }

  #feedbackOpenClosed(): boolean {
    return this.#host.dismissFeedback();
  }

  #actionClick(event: UiEvent, mapPos: number | null): UiEvent {
    const sel = this.#sel();
    if (!sel || mapPos === null) return event;
    const estimate = dataOf(this.#estimate(this.#hover.target?.gridNo ?? mapPos, this.#hover.target?.level ?? this.#host.interfaceLevel()));
    if (estimate && this.#uiReloading(sel, estimate)) return event;
    this.aimOf(sel.id).shownAimTime = REFINE_AIM_1;
    if (this.#currentAp === 0) {
      this.#feedback(NO_PATH_STR);
      return event;
    }
    if (estimate && this.#validAttackLocation(sel, estimate) && this.#canAffordAttack(sel, estimate)) {
      this.#startGridNo = mapPos;
      return UiEvent.A_CHANGE_TO_CONFIM_ACTION;
    }
    return event;
  }

  #uiReloading(sel: SoldierView, estimate: EstimateAttack): boolean {
    if (!estimate.ammo.empty || (estimate.cursor !== 'target' && estimate.cursor !== 'trajectory')) return false;
    if (!estimate.ammo.canReload) return false;
    void this.#host.send({ type: 'reload', soldier: sel.id });
    return true;
  }

  #validAttackLocation(sel: SoldierView, e: EstimateAttack): boolean {
    if (e.cursor === 'invalid') return false;
    const target = this.#hover.target;
    if (target?.id === sel.id && e.cursor !== 'aid') return false;
    if (e.cursor === 'punch') {
      if (!target) return false;
      if (e.apCost === 0) {
        this.#feedback(NO_PATH_STR);
        return false;
      }
    }
    if (e.cursor === 'aid' && !target) return false;
    return true;
  }

  #canAffordAttack(sel: SoldierView, e: EstimateAttack): boolean {
    if (e.cursor === 'invalid') return false;
    const cost = e.apCostByAim[aimTimeOf(this.aimOf(sel.id))] ?? e.apCost;
    if (this.#enoughPoints(sel, cost, true)) return true;
    this.#env().battleSound(sel.id, 'curse');
    return false;
  }

  #enoughPoints(s: SoldierView, cost: number, show: boolean): boolean {
    if (!this.#combat()) return true;
    if ((s.ap ?? 0) >= cost) return true;
    if (show) this.#notEnoughAp();
    return false;
  }

  #canAffordMove(): boolean {
    const sel = this.#sel();
    const mapPos = this.#mapPos();
    if (!sel || mapPos === null) return false;
    if (this.#interactiveTile()) return this.#enoughPoints(sel, this.#currentAp, true);
    const move = dataOf(this.#previewMove(mapPos));
    if (!move) return true;
    if (this.#enoughPoints(sel, move.firstStepCost, true)) return true;
    return false;
  }

  #tbRight(event: UiEvent): UiEvent {
    const mapPos = this.#mapPos();
    if (mapPos === null || !this.#pointer.inViewport) return event;
    let next = event;
    if (this.#pointer.isDown(MouseButtonMask.RIGHT)) {
      if (!this.#rightDown) {
        this.#rightDown = true;
        this.#rightDownAt = this.#now;
      }
      if (!this.#leftDown && !this.#host.itemInCursor() && this.#clickHeld(this.#rightDownAt) && !this.#tbRightHold) {
        if (RIGHT_HOLD_MODES.has(this.#mode) && this.#sel()) {
          next = UiEvent.U_MOVEMENT_MENU;
          this.#tbRightHold = true;
        }
      }
      return next;
    }
    if (!this.#rightDown) return next;
    if (this.#leftDown) next = this.#tbRightWithLeft(next);
    else if (!this.#tbRightHold && !this.#tbRightClick) next = this.#tbRightClickEvent(next, mapPos);
    this.#rightDown = false;
    this.#tbRightHold = false;
    this.#tbRightClick = false;
    return next;
  }

  #tbRightWithLeft(event: UiEvent): UiEvent {
    this.#ignoreLeftUp = true;
    const sel = this.#sel();
    if (this.#host.itemInCursor() || !sel) return event;
    let next = event;
    if (this.#mode === UiMode.CONFIRM_MOVE_MODE || this.#mode === UiMode.MOVE_MODE) {
      if (this.#canBeginAllMove) next = UiEvent.M_CYCLE_MOVE_ALL;
      else {
        if (!this.#firstCycleStarted) {
          this.#firstCycleStarted = true;
          if (this.moveModeOf(sel) !== RUN) this.#moveModes.set(sel.id, CRAWL);
        }
        return UiEvent.M_CYCLE_MOVEMENT;
      }
    }
    if (this.#spreadTracking) {
      this.#spreadTracking = false;
      this.#doSpread = false;
      this.#tbRightHold = true;
      next = UiEvent.A_END_ACTION;
      this.#mode = UiMode.MOVE_MODE;
    }
    return next;
  }

  #tbRightClickEvent(event: UiEvent, mapPos: number): UiEvent {
    if (this.#host.itemInCursor()) return event;
    const sel = this.#sel();
    if (!sel) return event;
    switch (this.#mode) {
      case UiMode.MOVE_MODE:
        this.#tbRightClick = true;
        return UiEvent.M_CHANGE_TO_ACTION;
      case UiMode.ACTION_MODE:
      case UiMode.CONFIRM_MOVE_MODE:
        this.#tbRightClick = true;
        return UiEvent.A_CHANGE_TO_MOVE;
      case UiMode.HANDCURSOR_MODE:
      case UiMode.LOOKCURSOR_MODE:
      case UiMode.TALKCURSOR_MODE:
        return UiEvent.A_CHANGE_TO_MOVE;
      case UiMode.CONFIRM_ACTION_MODE:
        this.#rightClickAdjust(sel, mapPos);
        this.#tbRightClick = true;
        return event;
      case UiMode.MENU_MODE:
        this.endMenu(null);
        this.#tbRightClick = true;
        return event;
      default:
        return event;
    }
  }

  #rightClickAdjust(sel: SoldierView, mapPos: number): void {
    const target = this.#hover.target;
    const estimate = dataOf(this.#estimateNow(target?.gridNo ?? mapPos, target?.level ?? this.#host.interfaceLevel()));
    if (!estimate) return;
    rightClickAdjust(estimate, this.aimOf(sel.id), this.#selBurst(sel));
  }

  #wheel(direction: 1 | -1): void {
    const sel = this.#sel();
    const mapPos = this.#mapPos();
    if (!sel || mapPos === null || this.#mode !== UiMode.CONFIRM_ACTION_MODE || this.#host.itemInCursor()) return;
    const target = this.#hover.target;
    const estimate = dataOf(this.#estimateNow(target?.gridNo ?? mapPos, target?.level ?? this.#host.interfaceLevel()));
    if (estimate) wheelAdjust(estimate, this.aimOf(sel.id), direction, this.#selBurst(sel));
  }

  #rtLeft(event: UiEvent): UiEvent {
    let next = event;
    const sel = this.#sel();
    if (!this.#pointer.inViewport) {
      if (this.#spreadTracking) {
        this.#doSpread = false;
        this.#spreadTracking = false;
      }
      if (!this.#pointer.isDown(MouseButtonMask.LEFT)) this.#resetLeft();
      return next;
    }
    const mapPos = this.#mapPos();
    if (mapPos === null && !this.#overSouthExit()) return next;
    if (this.#pointer.isDown(MouseButtonMask.LEFT)) {
      if (!this.#leftDown) {
        this.#leftDown = true;
        this.#rtRightWhileLeft = false;
        this.#leftDownAt = this.#now;
        if (!this.#host.itemInCursor()) next = this.#rtLeftPress(next, mapPos);
      }
      if (!this.#host.itemInCursor() && !this.#rtRightWhileLeft) {
        const band = this.#rtDrag(next, sel);
        if (band) return band;
      }
      return next;
    }
    if (!this.#leftDown) return next;
    if (!this.#ignoreLeftUp) next = this.#rtLeftRelease(next, mapPos, sel);
    this.#resetLeft();
    return next;
  }

  #rtLeftPress(event: UiEvent, mapPos: number | null): UiEvent {
    const sel = this.#sel();
    switch (this.#mode) {
      case UiMode.ACTION_MODE: {
        if (!sel || mapPos === null) return event;
        const estimate = dataOf(this.#estimate(this.#hover.target?.gridNo ?? mapPos, this.#hover.target?.level ?? 0));
        if (estimate && this.#uiReloading(sel, estimate)) {
          this.#rtLeftHold = true;
          return event;
        }
        if (this.#selBurst(sel)) {
          this.#startGridNo = mapPos;
          this.#burstLocations = [];
          return UiEvent.A_CHANGE_TO_CONFIM_ACTION;
        }
        this.#rtLeftHold = true;
        if (!estimate || this.#validAttackLocation(sel, estimate)) return UiEvent.A_CHANGE_TO_CONFIM_ACTION;
        return event;
      }
      case UiMode.MOVE_MODE:
        this.#canBeginAllMove = true;
        if (this.#exitArrowsInput(false)) return event;
        if (this.#hover.target && this.#targetIs(FindFlag.OWNED)) {
          if (this.#hover.target.id === sel?.id) this.multiSelected.clear();
          return event;
        }
        if (mapPos === null) return event;
        return this.#rtMoveClickDown(event, mapPos);
      default:
        return event;
    }
  }

  #rtMoveClickDown(event: UiEvent, mapPos: number): UiEvent {
    const result = this.#moveModeInteractiveClick();
    if (result === -3) this.#rtLeftHold = true;
    if (result !== 0) return event;
    const sel = this.#sel();
    if (!sel) return event;
    const move = dataOf(this.#previewMove(mapPos));
    if (move && move.destination !== 'ok') return event;
    if (this.#currentAp !== 0 && !this.#env().display().rtConfirm) {
      this.#plotNew = true;
      return UiEvent.C_WAIT_FOR_CONFIRM;
    }
    return event;
  }

  #rtDrag(event: UiEvent, sel: SoldierView | null): UiEvent | null {
    if (this.#mode !== UiMode.MOVE_MODE && this.#mode !== UiMode.CONFIRM_MOVE_MODE) return null;
    const target = this.#hover.target;
    if (target) {
      if (sel && target.id === sel.id && (sel.life ?? 0) >= OKLIFE) return UiEvent.M_CHANGE_TO_ADJPOS_MODE;
      return null;
    }
    const regions = this.#env().runtime.regions;
    if (!this.#rubberLooking && !this.#rubberActive) {
      this.#rubberLooking = true;
      this.#rubberStart = { x: regions.mouseX, y: regions.mouseY };
      return null;
    }
    if (
      this.#rubberLooking &&
      (Math.abs(regions.mouseX - this.#rubberStart.x) > RUBBER_BAND_START_PX ||
        Math.abs(regions.mouseY - this.#rubberStart.y) > RUBBER_BAND_START_PX)
    ) {
      this.#rubberLooking = false;
      this.#rubberActive = true;
      this.#rubberEnd = { x: regions.mouseX, y: regions.mouseY };
      return UiEvent.RB_ON_TERRAIN;
    }
    return event === UiEvent.RB_ON_TERRAIN ? event : null;
  }

  #rtLeftRelease(event: UiEvent, mapPos: number | null, sel: SoldierView | null): UiEvent {
    let next = event;
    let doubleClick = false;
    if (this.#now - this.#leftUpAt < DOUBLE_CLICK_MS && this.#validDoubleLeft && !this.#host.itemInCursor()) {
      doubleClick = true;
      if (sel) {
        this.#fast = true;
        next = UiEvent.C_MOVE_MERC;
      }
    }
    this.#leftUpAt = this.#now;
    this.#validDoubleLeft = false;
    if (doubleClick) return next;
    if (this.#mode === UiMode.ADJUST_STANCE_MODE) next = UiEvent.PADJ_ADJUST_STANCE;
    if (this.#clickHeld(this.#leftDownAt) && (this.#mode === UiMode.CONFIRM_ACTION_MODE || this.#mode === UiMode.ACTION_MODE)) {
      if (sel && this.#selBurst(sel)) {
        this.#spreadTracking = false;
        if (mapPos !== null && mapPos !== this.#startGridNo) {
          this.#doSpread = true;
          next = UiEvent.CA_MERC_SHOOT;
        } else this.#doSpread = false;
        this.#rtLeftHold = true;
      }
    }
    if (this.#rtLeftHold) return next;
    if (this.#feedbackOpenClosed()) return next;
    if (this.#exitArrowsInput(true)) return next;
    if (this.#host.itemInCursor()) {
      if (mapPos !== null) this.#host.itemPointerClick(mapPos, this.#hover.target);
      return next;
    }
    switch (this.#mode) {
      case UiMode.MENU_MODE:
        this.endMenu(null);
        break;
      case UiMode.IDLE_MODE:
        if (this.#hover.target && this.#targetIs(FindFlag.OWNED)) next = UiEvent.I_SELECT_MERC;
        break;
      case UiMode.HANDCURSOR_MODE:
        if (mapPos !== null) next = this.#handCursorClick(mapPos, next);
        break;
      case UiMode.ACTION_MODE:
      case UiMode.CONFIRM_ACTION_MODE:
        next = UiEvent.CA_MERC_SHOOT;
        break;
      case UiMode.CONFIRM_MOVE_MODE:
        if (sel) next = UiEvent.C_MOVE_MERC;
        this.#validDoubleLeft = true;
        break;
      case UiMode.MOVE_MODE:
        next = this.#rtMoveRelease(next, mapPos, sel);
        break;
      case UiMode.LOOKCURSOR_MODE:
        next = UiEvent.LC_LOOK;
        break;
      case UiMode.JUMPOVER_MODE:
        next = UiEvent.JP_JUMP;
        break;
      case UiMode.TALKCURSOR_MODE:
        if (this.#talkInit()) next = UiEvent.TA_TALKINGMENU;
        break;
      case UiMode.RUBBERBAND_MODE:
        this.#endRubberBand(false);
        next = UiEvent.A_CHANGE_TO_MOVE;
        break;
      default:
        break;
    }
    return next;
  }

  #rtMoveRelease(event: UiEvent, mapPos: number | null, sel: SoldierView | null): UiEvent {
    if (this.#exitArrowsInput(false) || this.#host.itemInCursor()) return event;
    const target = this.#hover.target;
    if (target && this.#targetIs(FindFlag.OWNED)) {
      if (!this.#targetIs(FindFlag.UNCONSCIOUS)) {
        const alt = (this.#env().runtime.modifiers & KeyModifier.ALT) !== 0;
        if (!alt) {
          this.multiSelected.clear();
          return UiEvent.I_SELECT_MERC;
        }
        if (this.multiSelected.has(target.id)) this.multiSelected.delete(target.id);
        else {
          this.multiSelected.add(target.id);
          this.#env().battleSound(target.id, 'attention');
          if (sel) this.multiSelected.add(sel.id);
        }
        this.#endMultiSelection(false);
      }
      return event;
    }
    if (mapPos === null || !sel) return event;
    const result = this.#moveModeInteractiveClick();
    if (result === -2) {
      this.#timedCursor = { cursor: this.#interactiveCursor(this.#cursor, true), until: this.#now + TIMED_RUN_CURSOR_MS };
      this.#validDoubleLeft = true;
      return UiEvent.C_MOVE_MERC;
    }
    if (result !== 0) return event;
    if (this.#currentAp === 0 && !this.#allMoveOn && this.multiSelected.size === 0) {
      this.#feedback(NO_PATH_STR);
      return event;
    }
    const move = dataOf(this.#previewMove(mapPos));
    const destination = move?.destination ?? 'ok';
    if (destination === 'ok') {
      this.#validDoubleLeft = true;
      if (this.#allMoveOn || !this.#env().display().rtConfirm) return UiEvent.C_MOVE_MERC;
      this.#plotNew = true;
      return UiEvent.C_WAIT_FOR_CONFIRM;
    }
    if (destination === 'robotUncontrolled') this.#feedback(NOBODY_USING_REMOTE_STR);
    return event;
  }

  #rtRight(event: UiEvent): UiEvent {
    const mapPos = this.#mapPos();
    if (mapPos === null || !this.#pointer.inViewport) return event;
    let next = event;
    const sel = this.#sel();
    if (this.#pointer.isDown(MouseButtonMask.RIGHT)) {
      if (!this.#rightDown) {
        this.#rightDown = true;
        this.#rightDownAt = this.#now;
      }
      if (this.#leftDown) {
        this.#rtRightWhileLeft = true;
        if (this.#host.itemInCursor() || !sel) return next;
        if ((this.#mode === UiMode.CONFIRM_MOVE_MODE || this.#mode === UiMode.MOVE_MODE) && !this.#allMoveOn) {
          this.#validDoubleRight = true;
          if (this.#canBeginAllMove) {
            const move = dataOf(this.#previewMove(mapPos));
            if (move && move.destination !== 'ok') {
              this.#feedback(CANT_MOVE_THERE_STR);
              this.#rtLeftHold = true;
            } else next = UiEvent.M_CYCLE_MOVE_ALL;
          }
          this.#rtRightHold = true;
        }
        if (this.#spreadTracking) {
          this.#spreadTracking = false;
          this.#rtLeftHold = true;
          this.#doSpread = false;
          this.#rtRightHold = true;
          next = UiEvent.A_END_ACTION;
          this.#mode = UiMode.MOVE_MODE;
        }
        return next;
      }
      if (this.#clickHeld(this.#rightDownAt) && !this.#rtRightHold && !this.#host.itemInCursor() && RIGHT_HOLD_MODES.has(this.#mode)) {
        if (sel) {
          next = UiEvent.U_MOVEMENT_MENU;
          this.#rtRightHold = true;
        }
      }
      return next;
    }
    if (!this.#rightDown) return next;
    let doubleClick = false;
    if (this.#now - this.#rightUpAt < DOUBLE_CLICK_MS && this.#validDoubleRight) {
      doubleClick = true;
      if (this.#leftDown && !this.#host.itemInCursor() && !this.#rtRightClick && !this.#rtRightHold && sel && this.#allMoveOn)
        this.#allMoveOn = 2;
    }
    this.#rightUpAt = this.#now;
    this.#validDoubleRight = true;
    if (!doubleClick) {
      if (this.#leftDown) {
        if (!this.#host.itemInCursor() && !this.#rtRightHold && !this.#rtRightClick && sel && this.#allMoveOn) {
          this.#allMoveOn = 0;
          this.#canBeginAllMove = true;
        }
      } else if (!this.#rtRightHold && !this.#rtRightClick && !this.#host.itemInCursor() && sel)
        next = this.#rtRightClickEvent(next, mapPos, sel);
    }
    this.#rightDown = false;
    this.#rtRightHold = false;
    this.#rtRightClick = false;
    return next;
  }

  #rtRightClickEvent(event: UiEvent, mapPos: number, sel: SoldierView): UiEvent {
    switch (this.#mode) {
      case UiMode.CONFIRM_MOVE_MODE:
      case UiMode.MOVE_MODE:
      case UiMode.TALKCURSOR_MODE:
        this.#rtRightClick = true;
        return UiEvent.M_CHANGE_TO_ACTION;
      case UiMode.ACTION_MODE:
        this.#rtRightClick = true;
        return UiEvent.A_END_ACTION;
      case UiMode.CONFIRM_ACTION_MODE:
        this.#rightClickAdjust(sel, mapPos);
        this.#rtRightClick = true;
        return event;
      case UiMode.MENU_MODE:
        this.endMenu(null);
        this.#rtRightClick = true;
        return event;
      case UiMode.HANDCURSOR_MODE:
      case UiMode.LOOKCURSOR_MODE:
        return UiEvent.A_CHANGE_TO_MOVE;
      default:
        return event;
    }
  }

  #overSouthExit(): boolean {
    const regions = this.#env().runtime.regions;
    const { height } = this.#env().runtime.geometry();
    return this.#env().world.scrollEdges().bottom && regions.mouseY >= height - NO_PX_SHOW_EXIT_CURS;
  }

  #interactiveTile(): ReturnType<TacticalEnvironment['world']['interactiveTileAt']> {
    const mapPos = this.#mapPos();
    if (mapPos === null) return null;
    const tile = this.#env().world.interactiveTileAt(mapPos, this.#host.interfaceLevel());
    if (!tile?.door) return tile;
    const hand = this.#mode === UiMode.HANDCURSOR_MODE;
    if (tile.open && !hand && this.#mode !== UiMode.ACTION_MODE) return null;
    if (!this.#env().display().snapCursorToDoor && !hand) return null;
    return tile;
  }

  #moveModeInteractiveClick(): number {
    const sel = this.#sel();
    if (!sel) return 0;
    const target = this.#hover.target;
    if (target && target.id !== sel.id) {
      if (this.#validQuickExchange()) void this.#host.send({ type: 'swapPlaces', soldier: sel.id, with: target.id, cursor: true });
      return -3;
    }
    const tile = this.#interactiveTile();
    if (!tile) return 0;
    const items = (this.#view()?.items ?? []).filter((i) => i.gridNo === tile.gridNo && i.level === sel.level && !i.notRendered);
    if (items.length > 0 && !tile.door && !tile.switch) {
      if (isEpc(sel)) this.#feedback(EPC_CANNOT_DO_THAT);
      else {
        this.#host.pickUp(sel, tile.gridNo, sel.level);
        return -3;
      }
    }
    return -2;
  }

  #handCursorClick(mapPos: number, event: UiEvent): UiEvent {
    const sel = this.#sel();
    if (!sel) return event;
    const target = this.#hover.target;
    if (target && this.#targetIs(FindFlag.ENEMY) && !this.#targetIs(FindFlag.UNCONSCIOUS)) return event;
    const tile = this.#interactiveTile();
    let actionGridNo = mapPos;
    let ignoreItems = false;
    if (tile) {
      actionGridNo = tile.gridNo;
      if (tile.switch || (tile.door && actionGridNo !== mapPos)) ignoreItems = true;
    }
    const items = ignoreItems
      ? []
      : (this.#view()?.items ?? []).filter((i) => i.gridNo === actionGridNo && i.level === sel.level && !i.notRendered);
    if (items.length > 0) {
      if (isEpc(sel)) this.#feedback(EPC_CANNOT_DO_THAT);
      else {
        this.#host.pickUp(sel, actionGridNo, sel.level);
        return UiEvent.A_CHANGE_TO_MOVE;
      }
      return event;
    }
    if (tile) {
      if (this.#currentAp === 0 && actionGridNo !== sel.gridNo) this.#feedback(NO_PATH_STR);
      else if (this.#canAffordMove()) return UiEvent.C_MOVE_MERC;
      return event;
    }
    if (isEpc(sel)) this.#feedback(EPC_CANNOT_DO_THAT);
    else if ((sel.morale ?? 100) < MORALE_REFUSE_SEARCH) this.#env().battleSound(sel.id, 'curse');
    else if (this.#currentAp === 0) this.#feedback(NO_PATH_STR);
    else void this.#host.sendBusyOrder({ type: 'pickUp', soldier: sel.id, gridNo: actionGridNo, zLevel: sel.level });
    return UiEvent.A_CHANGE_TO_MOVE;
  }

  #talkInit(): boolean {
    const sel = this.#sel();
    const target = this.#hover.target;
    if (!sel || !target) return false;
    if (target.profile === undefined && this.#host.closeCivQuote()) return false;
    void this.#host.send({ type: 'talk', soldier: sel.id, target: target.id });
    this.#pending = UiEvent.A_CHANGE_TO_MOVE;
    return false;
  }

  #exitArrowsInput(adjustConfirm: boolean): boolean {
    if (this.#mode !== UiMode.MOVE_MODE) return false;
    const sel = this.#sel();
    if (!sel) return false;
    this.#confirmExitArrows = true;
    const cursor = this.#cursor;
    if (cursor.startsWith('NOEXIT_')) {
      this.#noExitFeedback(sel);
      return true;
    }
    const direction = EXIT_DIRECTIONS[cursor];
    if (!direction) return false;
    if (adjustConfirm) {
      const mapPos = this.#mapPos();
      this.#host.openExitDialog(direction, direction === 'exitGrid' ? mapPos : null);
    }
    return true;
  }

  #noExitFeedback(sel: SoldierView): void {
    const female = sel.bodyType === REGFEMALE;
    const epcs = this.#host.squadSoldiers().filter((s) => s.id !== sel.id && isEpc(s));
    switch (this.#exitRefusal) {
      case 'invalidTraversal':
        this.#feedback(CANNOT_LEAVE_SECTOR_FROM_SIDE_STR);
        return;
      case 'uncontrolledRobot':
        this.#host.feedback(this.#text('gzLateLocalizedString', STR_LATE_01));
        return;
      case 'loneEPC':
        this.#host.feedback(
          printf(this.#text('pExitingSectorHelpText', EXIT_GUI_ESCORTED_CHARACTERS_CANT_LEAVE_SECTOR_ALONE_STR), [sel.name]),
        );
        return;
      case 'abandonEPC': {
        const single = epcs.length === 1 ? (epcs[0] as SoldierView) : null;
        const index = single
          ? female
            ? EXIT_GUI_ISOLATE_EPC_FEMALE_SINGULAR
            : EXIT_GUI_ISOLATE_EPC_MALE_SINGULAR
          : female
            ? EXIT_GUI_ISOLATE_EPC_FEMALE_PLURAL
            : EXIT_GUI_ISOLATE_EPC_MALE_PLURAL;
        this.#host.feedback(printf(this.#text('pExitingSectorHelpText', index), single ? [sel.name, single.name] : [sel.name]));
        return;
      }
      default:
        this.#feedback(MERC_IS_TOO_FAR_AWAY_STR, [sel.name]);
    }
  }

  #endRubberBand(cancel: boolean): void {
    if (!this.#rubberActive) return;
    if (!cancel) this.#endMultiSelection(true);
    this.#rubberActive = false;
  }

  #endMultiSelection(acknowledge: boolean): void {
    const sel = this.#sel();
    let first: SoldierView | null = null;
    for (const id of this.multiSelected) {
      const s = soldierById(this.#view(), id);
      if (!s) continue;
      if (s.id === sel?.id || first === null) first = s;
      if (acknowledge) this.#env().battleSound(s.id, 'attention');
    }
    if (first && first.id !== sel?.id) this.#host.selectFromUi(first);
  }

  #hint<T>(request: CommandEnvelope): HintState<T> {
    return hintState<T>(this.#env().client, request);
  }

  #moveRequest(sel: SoldierView, to: number): CommandEnvelope {
    return {
      type: 'previewMove',
      soldier: sel.id,
      to,
      mode: this.moveModeOf(sel),
      level: this.#host.interfaceLevel(),
      ...(this.#reverse ? { reverse: true } : {}),
    };
  }

  #previewMove(to: number): HintState<PreviewMove> {
    const sel = this.#sel();
    if (!sel) return { state: 'pending' };
    return this.#hint<PreviewMove>(this.#moveRequest(sel, to));
  }

  #attackRequest(sel: SoldierView, gridNo: number, level: number): CommandEnvelope {
    return {
      type: 'estimateAttack',
      soldier: sel.id,
      target: gridNo,
      level,
      aimTime: 0,
      weaponMode: sel.weaponMode ?? 'single',
    };
  }

  #estimate(gridNo: number, level: number): HintState<EstimateAttack> {
    const sel = this.#sel();
    if (!sel) return { state: 'pending' };
    return this.#hint<EstimateAttack>(this.#attackRequest(sel, gridNo, level));
  }

  #estimateNow(gridNo: number, level: number): HintState<EstimateAttack> {
    const answer = this.#estimate(gridNo, level);
    return answer.state === 'pending' && this.#lastAttack.cursor ? { state: 'ok', data: this.#lastAttack.cursor } : answer;
  }

  #handle(event: UiEvent): void {
    switch (event) {
      case UiEvent.I_DO_NOTHING:
        this.#newCursor = 'NORMAL_SNAPUICURSOR';
        return;
      case UiEvent.I_SELECT_MERC:
        this.#selectMerc();
        return;
      case UiEvent.I_ENDTURN:
        void this.#host.send({ type: 'endTurn' });
        return;
      case UiEvent.I_CHANGELEVEL:
        this.#host.setInterfaceLevel(this.#host.interfaceLevel() > 0 ? 0 : 1);
        this.#plotNew = true;
        this.#erasePath();
        return;
      case UiEvent.I_ON_TERRAIN:
        if (!this.#onMerc(true)) this.#newCursor = 'NORMAL_SNAPUICURSOR';
        return;
      case UiEvent.M_ON_TERRAIN:
        this.#mOnTerrain();
        return;
      case UiEvent.M_CHANGE_TO_ACTION:
        this.#impact = null;
        return;
      case UiEvent.M_CHANGE_TO_HANDMODE:
        this.#erasePath();
        return;
      case UiEvent.M_CYCLE_MOVEMENT:
        this.#cycleMovement();
        return;
      case UiEvent.M_CYCLE_MOVE_ALL:
        if (this.#canBeginAllMove) {
          this.#allMoveOn = 1;
          this.#canBeginAllMove = false;
        }
        return;
      case UiEvent.M_CHANGE_TO_ADJPOS_MODE:
        this.#adjustStanceMode();
        return;
      case UiEvent.A_ON_TERRAIN:
        this.#aOnTerrain();
        return;
      case UiEvent.A_CHANGE_TO_MOVE:
        this.#plotNew = true;
        return;
      case UiEvent.A_CHANGE_TO_CONFIM_ACTION:
        this.#changeToConfirmAction();
        return;
      case UiEvent.U_MOVEMENT_MENU:
        this.#movementMenu();
        return;
      case UiEvent.C_WAIT_FOR_CONFIRM:
        this.#cWait();
        return;
      case UiEvent.C_MOVE_MERC:
        this.#cMoveMerc();
        return;
      case UiEvent.PADJ_ADJUST_STANCE:
        this.#padjAdjustStance();
        return;
      case UiEvent.CA_ON_TERRAIN:
        this.#caOnTerrain();
        return;
      case UiEvent.CA_MERC_SHOOT:
        void this.#caMercShoot();
        return;
      case UiEvent.HC_ON_TERRAIN:
        this.#hcOnTerrain();
        return;
      case UiEvent.G_GETTINGITEM:
      case UiEvent.TA_TALKINGMENU:
      case UiEvent.EX_EXITSECTORMENU:
      case UiEvent.OP_OPENDOORMENU:
        this.#newCursor = 'NORMAL_FREEUICURSOR';
        return;
      case UiEvent.LC_ON_TERRAIN:
        this.#lcOnTerrain();
        return;
      case UiEvent.LC_CHANGE_TO_LOOK:
        this.#erasePath();
        return;
      case UiEvent.LC_LOOK:
        this.#lcLook();
        return;
      case UiEvent.T_ON_TERRAIN:
        this.#tOnTerrain();
        return;
      case UiEvent.LU_BEGINUILOCK:
      case UiEvent.LA_BEGINUIOURTURNLOCK:
        this.#beginLock();
        return;
      case UiEvent.LU_ENDUILOCK:
      case UiEvent.LA_ENDUIOUTURNLOCK:
        this.#endLock();
        return;
      case UiEvent.RB_ON_TERRAIN:
        this.#rubberBandOnTerrain();
        return;
      case UiEvent.JP_ON_TERRAIN:
        this.#jumpOnTerrain();
        return;
      case UiEvent.JP_JUMP:
        this.#jump();
        return;
      default:
        return;
    }
  }

  #selectMerc(): void {
    const target = this.#hover.target;
    if (!target) return;
    const squad = this.#host.currentSquad();
    this.#host.selectFromUi(target);
    if (this.#host.currentSquad() !== squad)
      this.#host.log(printf(this.#text('pMessageStrings', MSG_SQUAD_ACTIVE), [this.#host.currentSquad() + 1]));
  }

  #onMerc(movementMode: boolean): boolean {
    const target = this.#hover.target;
    if (!target) return false;
    const flags = this.#hover.flags;
    if (flags & FindFlag.OWNED) {
      if (!(flags & FindFlag.UNCONSCIOUS) && movementMode) {
        this.#erasePath();
        this.#newCursor = 'NO_UICURSOR';
        if (flags & FindFlag.SELECTED) {
          this.#selection = Selection.SELECTED_GUY;
          if (!this.#host.itemInCursor() && !this.#env().world.soldierMarker(target.id).moving)
            this.#arrows = Arrows.SHOW_DOWN_BESIDE | Arrows.SHOW_UP_BESIDE;
        } else this.#selection = flags & FindFlag.NOINTERRUPT ? Selection.ENEMY_GUY : Selection.NONSELECTED_GUY;
      }
      if (!(flags & FindFlag.DEAD) && movementMode) {
        this.#erasePath();
        this.#newCursor = 'NO_UICURSOR';
        this.#selectionAt = { gridNo: target.gridNo, level: target.level };
      }
      return true;
    }
    if (flags & (FindFlag.ENEMY | FindFlag.NEUTRAL)) {
      if (movementMode) {
        if (target.hostile === true) {
          this.#actionChangeByMouseOver = true;
          this.#pending = UiEvent.M_CHANGE_TO_ACTION;
          return false;
        }
        this.#erasePath();
        this.#newCursor = 'NO_UICURSOR';
        this.#selection = Selection.ENEMY_GUY;
        this.#selectionAt = { gridNo: target.gridNo, level: target.level };
      }
      return true;
    }
    return false;
  }

  #mOnTerrain(): void {
    const mapPos = this.#mapPos();
    if (mapPos === null) return;
    this.#actionChangeByMouseOver = false;
    const sel = this.#sel();
    let setCursor = false;
    if (!this.#onMerc(true)) {
      this.#trackItemsOver(mapPos);
      if (sel) {
        if (this.#env().world.exitGridAt(mapPos) && sel.level === 0) this.#showExitGrid = true;
        const move = this.#previewMove(mapPos);
        if (move.state === 'ok' && move.data.destination === 'heightDiffers') {
          this.#erasePath();
          this.#newCursor = 'FLOATING_X_UICURSOR';
          return;
        }
        const tile = this.#interactiveTile();
        if ((sel.life ?? 0) < OKLIFE) {
          return;
        }
        if (move.state === 'ok' && move.data.destination !== 'ok' && !tile) {
          this.#erasePath();
          this.#newCursor = 'CANNOT_MOVE_UICURSOR';
        } else if (!this.#interactiveTilesAndItems(sel, mapPos, false, true))
          setCursor = this.#movementCursor(sel, mapPos, MoveUiTarget.NONE);
        else setCursor = true;
      } else this.#newCursor = 'NORMAL_SNAPUICURSOR';
    } else if (this.#validQuickExchange()) this.#newCursor = 'EXCHANGE_PLACES_UICURSOR';
    if (setCursor && sel) this.#setMovementModeCursor(sel);
  }

  #trackItemsOver(mapPos: number): void {
    const level = this.#host.interfaceLevel();
    const visible = (this.#view()?.items ?? []).some((i) => i.gridNo === mapPos && i.level === level && !i.notRendered);
    if (!visible) {
      this.#itemsOver = null;
      return;
    }
    const over = this.#itemsOver;
    if (over && over.gridNo === mapPos && over.level === level) {
      if (this.#now - over.since > ITEMS_OVER_MS) {
        this.#pending = UiEvent.M_CHANGE_TO_HANDMODE;
        this.#overItemsGridNo = mapPos;
        this.#itemsOver = null;
      }
    } else this.#itemsOver = { gridNo: mapPos, level, since: this.#now };
  }

  #interactiveTilesAndItems(sel: SoldierView, mapPos: number, useOkCursor: boolean, itemsOnlyIfOnIntTiles: boolean): boolean {
    this.#onMerc(false);
    const tile = this.#interactiveTile();
    const actionGridNo = tile?.gridNo ?? mapPos;
    const target = this.#hover.target;
    if (target && !itemsOnlyIfOnIntTiles && this.#targetIs(FindFlag.ENEMY) && !this.#targetIs(FindFlag.UNCONSCIOUS)) {
      this.#newCursor = useOkCursor || this.#combat() ? 'OKHANDCURSOR_UICURSOR' : 'NORMALHANDCURSOR_UICURSOR';
      this.#displayAp = true;
      return false;
    }
    const itemsAllowed =
      !(itemsOnlyIfOnIntTiles && !tile) && !tile?.switch && !(tile?.door && (actionGridNo !== mapPos || itemsOnlyIfOnIntTiles));
    if (itemsAllowed) {
      const visible = (this.#view()?.items ?? []).some((i) => i.gridNo === actionGridNo && i.level === sel.level && !i.notRendered);
      if (visible) {
        this.#newCursor = useOkCursor || this.#combat() ? 'OKHANDCURSOR_UICURSOR' : 'NORMALHANDCURSOR_UICURSOR';
        this.#movementCursor(sel, actionGridNo, MoveUiTarget.ITEMS);
        this.#displayAp = true;
        if (!this.#enoughPoints(sel, this.#currentAp, false)) this.#apInvalid = true;
        return tile !== null;
      }
    }
    if (tile) {
      this.#movementCursor(sel, mapPos, MoveUiTarget.INTTILES);
      this.#newCursor = this.#interactiveCursor(this.#newCursor, useOkCursor);
      return true;
    }
    if (!itemsOnlyIfOnIntTiles) {
      this.#movementCursor(sel, actionGridNo, MoveUiTarget.ITEMS);
      this.#displayAp = true;
      if (!this.#enoughPoints(sel, this.#currentAp, false)) this.#apInvalid = true;
    }
    return false;
  }

  #interactiveCursor(old: string, confirm: boolean): string {
    const tile = this.#interactiveTile();
    if (!tile) return old;
    if (tile.door) this.#doorText(tile.gridNo, tile.open);
    else if (tile.switch) this.#tileText = this.#text('gzLateLocalizedString', STR_LATE_25);
    return confirm ? 'OKHANDCURSOR_UICURSOR' : 'NORMALHANDCURSOR_UICURSOR';
  }

  #doorText(gridNo: number, open: boolean): void {
    if (this.#tileText === null) {
      this.#tileText = this.#text('TacticalStr', DOOR_DOOR_MOUSE_DESCRIPTION);
      const door = this.#view()?.doors?.find((d) => d.gridNo === gridNo);
      if (door) {
        const state =
          door.trap !== 'unknown' && door.trap !== 'none' && door.trap !== 'noneFound'
            ? DOOR_TRAPPED_MOUSE_DESCRIPTION
            : door.locked === 'locked'
              ? DOOR_LOCKED_MOUSE_DESCRIPTION
              : door.locked === 'unlocked'
                ? DOOR_UNLOCKED_MOUSE_DESCRIPTION
                : door.locked === 'broken'
                  ? DOOR_BROKEN_MOUSE_DESCRIPTION
                  : null;
        if (state !== null) this.#tileText2 = this.#text('TacticalStr', state);
      }
    }
    if (this.#tileText2 === null) this.#tileText2 = this.#text('pMessageStrings', open ? MSG_OPENED : MSG_CLOSED);
  }

  #movementCursor(sel: SoldierView, mapPos: number, target: MoveUiTarget): boolean {
    if (!this.#enoughPoints(sel, this.#currentAp, false)) this.#apInvalid = true;
    const stationary = !this.#combat() || !this.#env().world.soldierMarker(sel.id).moving;
    if (!stationary) {
      this.#erasePath();
      return true;
    }
    if (this.#moveState !== MouseMove.STATIONARY) {
      if (this.#moveState === MouseMove.NEW_TILE) {
        this.#erasePath();
        this.#pathRestSince = this.#now;
        this.#plotNew = true;
      }
      if (this.#moveState === MouseMove.IN_TILE) this.#displayAp = true;
      return true;
    }
    if (this.#pathfindDone() && this.#plotNew) {
      if (this.#drawMovementPath(sel, mapPos, target)) this.#plotNew = false;
    }
    if (!this.#plotNew) {
      if (this.#currentAp < 0 || !this.#combat()) this.#displayAp = false;
      else {
        this.#displayAp = true;
        if (target === MoveUiTarget.INTTILES || target === MoveUiTarget.ITEMS) {
          this.#apOffX = 22;
          this.#apOffY = 15;
        } else if (this.moveModeOf(sel) === WALK) {
          this.#apOffX = 10;
          this.#apOffY = 10;
        } else if (this.moveModeOf(sel) === RUN) {
          this.#apOffX = 21;
          this.#apOffY = 15;
        }
      }
    }
    return true;
  }

  #plots(): boolean {
    return this.#combat() || (this.#env().runtime.modifiers & KeyModifier.SHIFT) !== 0 || this.#env().display().alwaysShowMovementPath;
  }

  #drawMovementPath(sel: SoldierView, mapPos: number, target: MoveUiTarget): boolean {
    const level = this.#host.interfaceLevel();
    if (target === MoveUiTarget.INTTILES || target === MoveUiTarget.ITEMS) {
      const tile = this.#interactiveTile();
      const kind = tile?.door ? 'door' : 'pickUp';
      const gridNo = tile?.gridNo ?? mapPos;
      const answer = this.#hint<PreviewAction>({
        type: 'previewAction',
        soldier: sel.id,
        gridNo,
        kind,
        level,
        mode: this.moveModeOf(sel),
        zLevel: sel.level,
      });
      if (answer.state === 'pending') return false;
      const data = dataOf(answer);
      this.#currentAp = data?.apCost ?? 0;
      this.#steps = data && this.#plots() ? footstepMarkers(data.steps, sel.level) : [];
      if (data && data.actionGridNo !== sel.gridNo) {
        this.#showMoveGridAt = data.actionGridNo;
      }
      return true;
    }
    const answer = this.#previewMove(mapPos);
    if (answer.state === 'pending') return false;
    const data = dataOf(answer);
    this.#currentAp = data?.apCost ?? 0;
    this.#steps = data && this.#plots() ? footstepMarkers(data.steps, sel.level) : [];
    return true;
  }

  #setMovementModeCursor(sel: SoldierView): void {
    if (this.#combat()) this.#newCursor = MOVE_CURSORS[this.moveModeOf(sel)] ?? 'MOVE_WALK_UICURSOR';
    else this.#newCursor = this.#allMoveOn ? 'ALL_MOVE_REALTIME_UICURSOR' : 'MOVE_REALTIME_UICURSOR';
    this.#newCursor = this.#interactiveCursor(this.#newCursor, false);
  }

  #setConfirmMovementModeCursor(sel: SoldierView, fromMove: boolean): void {
    if (this.#combat()) {
      const mode = this.moveModeOf(sel);
      this.#newCursor = this.#allMoveOn
        ? (ALL_MOVE_CURSORS[mode] ?? 'ALL_MOVE_WALK_UICURSOR')
        : (CONFIRM_CURSORS[mode] ?? 'CONFIRM_MOVE_WALK_UICURSOR');
    } else if (this.#allMoveOn) {
      if (this.#allMoveOn === 2) this.#timedCursor = { cursor: 'MOVE_RUN_REALTIME_UICURSOR', until: this.#now + TIMED_RUN_CURSOR_MS };
      else this.#newCursor = 'ALL_MOVE_REALTIME_UICURSOR';
    } else {
      if (this.#fast && fromMove) this.#timedCursor = { cursor: 'MOVE_RUN_REALTIME_UICURSOR', until: this.#now + TIMED_RUN_CURSOR_MS };
      this.#newCursor = 'CONFIRM_MOVE_REALTIME_UICURSOR';
    }
    this.#newCursor = this.#interactiveCursor(this.#newCursor, true);
  }

  #cycleMovement(): void {
    const sel = this.#sel();
    if (!sel) return;
    this.#allMoveOn = 0;
    if (isRobot(sel)) {
      this.#moveModes.set(sel.id, WALK);
      this.#plotNew = true;
      return;
    }
    let mode = this.moveModeOf(sel);
    for (let k = 0; k < 4; k++) {
      mode = (MODE_CYCLE[mode] ?? WALK) as MoveModeName;
      if (this.#validMovementMode(sel, mode)) break;
    }
    if (mode === RUN) this.#fast = true;
    this.#moveModes.set(sel.id, mode);
    this.#plotNew = true;
  }

  #validMovementMode(sel: SoldierView, mode: MoveModeName): boolean {
    return !(isRobot(sel) && mode !== WALK);
  }

  #adjustStanceMode(): void {
    this.#newCursor = 'NO_UICURSOR';
    const state = this.#state(UiEvent.M_CHANGE_TO_ADJPOS_MODE);
    const regions = this.#env().runtime.regions;
    const sel = this.#sel();
    if (state.firstTime) {
      this.#stanceAnchorY = regions.mouseY;
      this.#stanceDiff = 0;
      this.#climbId = 0;
      this.#arrows = Arrows.SHOW_DOWN_BESIDE | Arrows.SHOW_UP_BESIDE;
      this.#stanceRange = this.#stanceRangeOf(sel);
    }
    const diff = Math.abs(this.#stanceAnchorY - regions.mouseY);
    const r = this.#stanceRange;
    this.#arrows = Arrows.SHOW_DOWN_BESIDE | Arrows.SHOW_UP_BESIDE;
    if (!sel) return;
    if (this.#stanceAnchorY > regions.mouseY) this.#stanceUp(diff, r);
    else if (this.#stanceAnchorY < regions.mouseY) this.#stanceDown(diff, r);
  }

  #stanceRangeOf(sel: SoldierView | null): { up: number; down: number; higher: boolean; lower: boolean } {
    if (!sel) return { up: 0, down: 0, higher: false, lower: false };
    const higher = sel.level === 0 && this.#climbable === true;
    const lower = sel.level > 0;
    const height = this.#env().world.soldierHeight(sel.id);
    const table: Readonly<Record<string, readonly [number, number]>> = {
      stand: higher ? [1, 2] : lower ? [0, 3] : [0, 2],
      crouch: higher ? [2, 1] : lower ? [1, 2] : [1, 1],
      prone: higher ? [3, 0] : lower ? [2, 1] : [2, 0],
    };
    const [up, down] = table[height] ?? [0, 0];
    return { up, down, higher, lower };
  }

  #climbable = false;

  setClimbable(on: boolean): void {
    this.#climbable = on;
  }

  #stanceUp(diff: number, r: { up: number; higher: boolean }): void {
    if (diff < GO_MOVE_ONE && r.up >= 1) {
      this.#stanceDiff = 0;
      this.#climbId = 0;
    } else if (diff > GO_MOVE_ONE && diff < GO_MOVE_TWO && r.up >= 1) {
      const climb = r.up === 1 && r.higher;
      this.#arrows = climb ? Arrows.SHOW_UP_ABOVE_CLIMB : Arrows.SHOW_UP_ABOVE_Y;
      this.#climbId = climb ? 1 : 0;
      this.#stanceDiff = 1;
    } else if (diff >= GO_MOVE_TWO && diff < GO_MOVE_THREE && r.up >= 2) {
      const climb = r.up === 2 && r.higher;
      this.#arrows = climb ? Arrows.SHOW_UP_ABOVE_CLIMB : Arrows.SHOW_UP_ABOVE_YY;
      this.#climbId = climb ? 1 : 0;
      this.#stanceDiff = 2;
    } else if (diff >= GO_MOVE_THREE && r.up >= 3 && r.up === 3 && r.higher) {
      this.#arrows = Arrows.SHOW_UP_ABOVE_CLIMB;
      this.#climbId = 1;
    }
  }

  #stanceDown(diff: number, r: { down: number; lower: boolean }): void {
    if (diff < GO_MOVE_ONE && r.down >= 1) {
      this.#stanceDiff = 0;
      this.#climbId = 0;
    } else if (diff >= GO_MOVE_ONE && diff < GO_MOVE_TWO && r.down >= 1) {
      const climb = r.down === 1 && r.lower;
      this.#arrows = climb ? Arrows.SHOW_DOWN_CLIMB : Arrows.SHOW_DOWN_BELOW_Y;
      this.#climbId = climb ? -1 : 0;
      this.#stanceDiff = -1;
    } else if (diff > GO_MOVE_TWO && diff < GO_MOVE_THREE && r.down >= 2) {
      const climb = r.down === 2 && r.lower;
      this.#arrows = climb ? Arrows.SHOW_DOWN_CLIMB : Arrows.SHOW_DOWN_BELOW_YY;
      this.#climbId = climb ? -1 : 0;
      this.#stanceDiff = -2;
    } else if (diff > GO_MOVE_THREE && r.down >= 3 && r.down === 3 && r.lower) {
      this.#arrows = Arrows.SHOW_DOWN_CLIMB;
      this.#climbId = -1;
    }
  }

  #padjAdjustStance(): void {
    this.#arrows = 0;
    const sel = this.#sel();
    if (!sel || this.#stanceDiff === 0) return;
    if (this.#climbId !== 0) {
      void this.#host.send({ type: 'climb', soldier: sel.id });
      return;
    }
    const height = this.#env().world.soldierHeight(sel.id);
    const stance = adjustedStance(height, this.#stanceDiff);
    if (stance) void this.#host.send({ type: 'stance', soldier: sel.id, stance });
  }

  #aOnTerrain(): void {
    const mapPos = this.#mapPos();
    if (mapPos === null || this.#host.itemInCursor()) return;
    const sel = this.#sel();
    if (!sel) return;
    const target = this.#hover.target;
    const answer = this.#estimate(target?.gridNo ?? mapPos, target?.level ?? this.#host.interfaceLevel());
    if (answer.state === 'ok') this.#lastAttack.cursor = answer.data;
    const estimate = dataOf(answer) ?? this.#lastAttack.cursor;
    if (estimate?.cursor === 'target') {
      this.#actionDoorText();
      if (!estimate.inRange && target && (this.#outOfRange?.gridNo !== target.gridNo || this.#outOfRange.soldier !== sel.id)) {
        this.#host.log(this.#text('TacticalStr', OUT_OF_RANGE_STRING));
        this.#outOfRange = { gridNo: target.gridNo, soldier: sel.id };
      }
    }
    this.#properItemCursor(sel, mapPos, false, estimate);
    this.#onMerc(false);
    if (
      this.#mode === UiMode.ACTION_MODE &&
      this.#combat() &&
      estimate?.cursor === 'target' &&
      target &&
      !estimate.ammo.empty &&
      this.#targetIs(FindFlag.ENEMY) &&
      !this.#targetIs(FindFlag.DEAD) &&
      this.#pathfindDone() &&
      this.#moveState === MouseMove.STATIONARY &&
      answer.state === 'ok'
    )
      this.#pending = UiEvent.A_CHANGE_TO_CONFIM_ACTION;
  }

  #actionDoorText(): void {
    if (this.#hover.target) return;
    const tile = this.#interactiveTile();
    if (tile?.door) this.#doorText(tile.gridNo, tile.open);
  }

  #properItemCursor(sel: SoldierView, mapPos: number, activated: boolean, estimate: EstimateAttack | null): void {
    if (!estimate) {
      this.#newCursor = 'ACTION_SHOOT_UICURSOR';
      return;
    }
    const knife = this.#throwingKnife(sel);
    const result = attackCursor(estimate, this.aimOf(sel.id), {
      activated,
      inCombat: this.#combat(),
      burst: this.#selBurst(sel),
      throwingKnife: knife,
    });
    this.#newCursor = result.cursor;
    if (result.apCost !== null) {
      this.#currentAp = result.apCost;
      this.#displayAp = this.#pathfindDone() || activated;
      this.#apCenter = true;
      this.#apInvalid = result.apInvalid;
    }
    this.#cursorFlags = { flash: result.flash, cannotGetThrough: result.cannotGetThrough };
    if (estimate.cursor === 'target' || estimate.cursor === 'punch' || estimate.cursor === 'knife') this.#bodyLocation(sel);
    if ((estimate.cursor === 'punch' || estimate.cursor === 'knife' || estimate.cursor === 'aid') && this.#combat()) {
      const answer = this.#hint<PreviewAction>({
        type: 'previewAction',
        soldier: sel.id,
        gridNo: this.#hover.target?.gridNo ?? mapPos,
        kind: 'aid',
        level: this.#host.interfaceLevel(),
      });
      const data = dataOf(answer);
      if (estimate.cursor === 'aid' && data) {
        this.#steps = this.#plots() ? footstepMarkers(data.steps, sel.level) : [];
        if (data.actionGridNo !== sel.gridNo) this.#showMoveGridAt = data.actionGridNo;
      }
    }
    if (
      (estimate.cursor === 'toss' || estimate.cursor === 'trajectory') &&
      estimate.landsAt !== undefined &&
      this.#moveState === MouseMove.STATIONARY
    )
      this.#impact = { gridNo: estimate.landsAt, level: estimate.landsOnLevel ?? 0, good: estimate.pathClear !== false };
  }

  #cursorFlags = { flash: false, cannotGetThrough: false };

  #throwingKnife(sel: SoldierView): boolean {
    return sel.hand === 'THROWING_KNIFE' || sel.hand === 'throwingKnife';
  }

  #bodyLocation(sel: SoldierView): void {
    if (this.#selBurst(sel)) return;
    const target = this.#hover.target;
    if (!target) return;
    const env = this.#env();
    const regions = env.runtime.regions;
    const part = relativeBodyPart(env.world.soldierBox(target.id), env.world.soldierHeight(target.id), regions.mouseX, regions.mouseY);
    this.#bodyPart = part;
    if (target.bodyType === CROW) {
      this.#hitLocation = this.#text('TacticalStr', CROW_HIT_LOCATION_STR);
      this.#bodyPart = BodyPart.LEGS;
      return;
    }
    if (!part || target.bodyType > REGFEMALE) return;
    const blade = sel.hand === 'blade' || sel.hand === 'knife';
    this.#hitLocation = this.#text('TacticalStr', part === BodyPart.HEAD && blade ? NECK_HIT_LOCATION_STR : HIT_LOCATION_STR[part]);
  }

  #bodyPart: BodyPart | null = null;

  #changeToConfirmAction(): void {
    const sel = this.#sel();
    if (sel) this.#leftClickCursor(sel);
    this.#burstLocations = [];
  }

  #leftClickCursor(sel: SoldierView): void {
    const mapPos = this.#mapPos();
    if (mapPos === null) return;
    const estimate = this.#lastAttack.cursor;
    const kind = estimate?.cursor ?? 'target';
    if (!this.#combat() && kind !== 'toss' && kind !== 'trajectory') {
      if (!this.#selBurst(sel)) this.#pending = UiEvent.CA_MERC_SHOOT;
      return;
    }
    const aim = this.aimOf(sel.id);
    aim.fullCountRing = false;
    if (estimate && confirmsBeforeAttack(estimate)) aim.shownAimTime = REFINE_AIM_1;
    else this.#pending = UiEvent.CA_MERC_SHOOT;
  }

  #caOnTerrain(): void {
    const mapPos = this.#mapPos();
    const sel = this.#sel();
    if (mapPos === null || !sel) return;
    const target = this.#hover.target;
    const answer = this.#estimate(target?.gridNo ?? mapPos, target?.level ?? this.#host.interfaceLevel());
    if (answer.state === 'ok') this.#lastAttack.cursor = answer.data;
    this.#properItemCursor(sel, mapPos, true, dataOf(answer) ?? this.#lastAttack.cursor);
    this.#onMerc(false);
  }

  async #caMercShoot(): Promise<void> {
    const sel = this.#sel();
    const mapPos = this.#mapPos();
    if (!sel || mapPos === null) return;
    const target = this.#hover.target;
    if (target && (target.team === OUR_TEAM || target.team === MILITIA_TEAM) && target.id !== sel.id) {
      const estimate = this.#lastAttack.cursor;
      if (estimate?.cursor !== 'aid') {
        const ok = await this.#host.confirm(printf(this.#text('TacticalStr', ATTACK_OWN_GUY_PROMPT), [target.name]));
        if (!ok) return;
      }
    }
    await this.#mercAttack(sel, target, mapPos);
  }

  async #mercAttack(sel: SoldierView, target: SoldierView | null, mapPos: number): Promise<void> {
    const aim = this.aimOf(sel.id);
    const estimate = this.#lastAttack.cursor;
    const tile = target ? null : this.#interactiveTile();
    const gridNo = target ? target.gridNo : (tile?.gridNo ?? mapPos);
    const level = target ? target.level : this.#host.interfaceLevel();
    if (estimate?.cursor === 'aid') {
      if (target) void this.#host.sendBusyOrder({ type: 'bandage', soldier: sel.id, target: target.id });
      return;
    }
    const spread = this.#doSpread && this.#burstLocations.length > 0 ? { spread: [...this.#burstLocations] } : {};
    this.#doSpread = false;
    this.#burstLocations = [];
    const part = this.#bodyPart && target ? { bodyPart: this.#bodyPart } : {};
    const reply = await this.#host.sendBusyOrder({
      type: 'attack',
      soldier: sel.id,
      target: gridNo,
      level,
      aimTime: aimTimeOf(aim),
      ...part,
      ...spread,
    });
    if (!this.#combat() && reply.ok && estimate?.cursor === 'target' && !this.#selBurst(sel))
      this.#timedCursor = {
        cursor: this.#throwingKnife(sel) ? 'RED_THROW_UICURSOR' : 'ACTION_TARGETRED_UICURSOR',
        until: this.#now + RT_FEEDBACK_MS,
      };
  }

  #hcOnTerrain(): void {
    const mapPos = this.#mapPos();
    const sel = this.#sel();
    if (mapPos === null || !sel) return;
    if (this.#overItemsGridNo !== null && mapPos !== this.#overItemsGridNo) {
      this.#overItemsGridNo = null;
      this.#pending = UiEvent.A_CHANGE_TO_MOVE;
      return;
    }
    this.#newCursor = 'NORMALHANDCURSOR_UICURSOR';
    this.#interactiveTilesAndItems(sel, mapPos, true, false);
  }

  #lcOnTerrain(): void {
    this.#newCursor = 'LOOK_UICURSOR';
    const sel = this.#sel();
    const mapPos = this.#mapPos();
    if (!sel || mapPos === null) return;
    this.#displayAp = true;
    this.#apOffX = 14;
    this.#apOffY = 7;
    const answer = this.#hint<PreviewAction>({ type: 'previewAction', soldier: sel.id, gridNo: mapPos, kind: 'look' });
    const data = dataOf(answer);
    this.#currentAp = data?.ok ? data.apCost : 0;
    if (!this.#enoughPoints(sel, this.#currentAp, false)) this.#apInvalid = true;
  }

  #lcLook(): void {
    const mapPos = this.#mapPos();
    if (mapPos === null) return;
    if (this.multiSelected.size > 0) {
      for (const id of this.multiSelected) void this.#host.send({ type: 'turn', soldier: id, toward: mapPos });
      return;
    }
    const sel = this.#sel();
    if (sel) void this.#host.sendBusyOrder({ type: 'turn', soldier: sel.id, toward: mapPos });
  }

  #tOnTerrain(): void {
    const sel = this.#sel();
    const mapPos = this.#mapPos();
    if (!sel || mapPos === null) return;
    if (this.#validQuickExchange()) {
      this.#pending = UiEvent.M_ON_TERRAIN;
      this.#mOnTerrain();
      return;
    }
    this.#onMerc(false);
    const target = this.#talkableNpc(this.#hover.target) ? this.#hover.target : null;
    const gridNo = target?.gridNo ?? mapPos;
    const range = rangeInTiles(sel.gridNo, gridNo);
    if (range <= NPC_TALK_RADIUS) this.#newCursor = target ? 'TALK_A_UICURSOR' : 'TALK_NA_UICURSOR';
    else this.#newCursor = target ? 'TALK_A_UICURSOR' : 'TALK_OUT_RANGE_NA_UICURSOR';
    if (target) {
      const answer = this.#hint<PreviewAction>({ type: 'previewAction', soldier: sel.id, gridNo, kind: 'talk', target: target.id });
      const data = dataOf(answer);
      if (data && data.lineOfSight === false) this.#newCursor = 'TALK_OUT_RANGE_A_UICURSOR';
    }
    this.#displayAp = true;
    this.#apOffX = 8;
    this.#apOffY = 3;
    this.#currentAp = AP_TALK;
    if (!this.#enoughPoints(sel, this.#currentAp, false)) this.#apInvalid = true;
  }

  #beginLock(): void {
    if (this.#lockRegion) return;
    this.#erasePath();
    const env = this.#env();
    const { width, height } = env.runtime.geometry();
    this.#lockRegion = env.runtime.regions.define({
      x1: 0,
      y1: 0,
      x2: width,
      y2: height,
      priority: Priority.HIGHEST,
      cursor: env.runtime.cursor.idOf('CURSOR_WAIT'),
      owner: 'tacticalLock',
      id: 'tacticalLock',
    });
    this.#busy = true;
  }

  #endLock(): void {
    this.#lockRegion?.remove();
    this.#lockRegion = null;
    this.#busy = false;
    this.#plotNew = true;
    this.#pending = UiEvent.M_ON_TERRAIN;
  }

  #rubberBandOnTerrain(): void {
    this.#newCursor = 'NO_UICURSOR';
    const regions = this.#env().runtime.regions;
    this.#rubberEnd = { x: regions.mouseX, y: regions.mouseY };
    const x1 = Math.min(this.#rubberStart.x, this.#rubberEnd.x);
    const x2 = Math.max(this.#rubberStart.x, this.#rubberEnd.x);
    const y1 = Math.min(this.#rubberStart.y, this.#rubberEnd.y);
    const y2 = Math.max(this.#rubberStart.y, this.#rubberEnd.y);
    const inside = (s: SoldierView) => {
      const p = this.#env().world.markerScreenPoint({ gridNo: s.gridNo, layer: 'object', tile: CENTRE_PROBE_TILE });
      if (!p) return false;
      const y = p.y - (this.#host.interfaceLevel() === 1 ? ROOF_LIFT : 0);
      return p.x >= x1 && p.x <= x2 && y >= y1 && y <= y2;
    };
    const candidates = this.#host.squadSoldiers().filter((s) => (s.life ?? 0) >= OKLIFE && !s.vehicle);
    if (!candidates.some(inside)) return;
    const alt = (this.#env().runtime.modifiers & KeyModifier.ALT) !== 0;
    for (const s of candidates) {
      if (!alt) this.multiSelected.delete(s.id);
      if (inside(s)) this.multiSelected.add(s.id);
    }
  }

  #jumpOnTerrain(): void {
    const sel = this.#sel();
    const mapPos = this.#mapPos();
    if (!sel || mapPos === null) return;
    const answer = this.#hint<PreviewAction>({
      type: 'previewAction',
      soldier: sel.id,
      gridNo: mapPos,
      kind: 'jump',
      level: this.#host.interfaceLevel(),
    });
    const data = dataOf(answer);
    if (!data?.ok) {
      this.#pending = UiEvent.M_ON_TERRAIN;
      return;
    }
    this.#currentAp = data.apCost;
    this.#displayAp = true;
    this.#apCenter = true;
    this.#newCursor = 'JUMP_OVER_UICURSOR';
  }

  #jump(): void {
    const sel = this.#sel();
    const mapPos = this.#mapPos();
    if (sel && mapPos !== null)
      void this.#host.sendBusyOrder({ type: 'jump', soldier: sel.id, to: mapPos, level: this.#host.interfaceLevel() });
  }

  #movementMenu(): void {
    const sel = this.#sel();
    if (!sel) return;
    const state = this.#state(UiEvent.U_MOVEMENT_MENU);
    if (state.firstTime) {
      const regions = this.#env().runtime.regions;
      this.#host.openMovementMenu(regions.mouseX, regions.mouseY, (choice) => {
        this.#menuChoice = choice;
        this.endMenu(choice);
      });
      this.#newCursor = 'NORMAL_FREEUICURSOR';
    }
    if (!state.doneMenu) return;
    const choice = this.#menuChoice;
    this.#menuChoice = null;
    if (choice === null) return;
    if (choice === 'look') this.#pending = UiEvent.LC_CHANGE_TO_LOOK;
    else if (choice === 'hand') this.#pending = UiEvent.HC_ON_TERRAIN;
    else if (choice === 'action') this.#pending = UiEvent.M_CHANGE_TO_ACTION;
    else if (choice === 'talk') this.#pending = UiEvent.T_CHANGE_TO_TALKING;
    else {
      this.#menuStance(sel, choice);
      this.#pending = UiEvent.A_CHANGE_TO_MOVE;
    }
  }

  #menuStance(sel: SoldierView, choice: MovementChoice): void {
    const height = this.#env().world.soldierHeight(sel.id);
    if (choice === 'run') {
      const mode = this.moveModeOf(sel);
      if (mode !== WALK && mode !== RUN) void this.#host.send({ type: 'stance', soldier: sel.id, stance: 'stand' });
      this.#fast = true;
      this.setMoveMode(sel.id, RUN);
      return;
    }
    const stance = choice === 'walk' ? 'stand' : choice === 'swat' ? 'crouch' : 'prone';
    const sameHeight =
      (stance === 'stand' && height === 'stand') ||
      (stance === 'crouch' && height === 'crouch') ||
      (stance === 'prone' && height === 'prone');
    this.clearMoveMode(sel.id);
    if (!sameHeight) void this.#host.send({ type: 'stance', soldier: sel.id, stance });
  }

  #cWait(): void {
    const mapPos = this.#mapPos();
    const sel = this.#sel();
    if (mapPos === null || !sel) return;
    const tile = this.#interactiveTile();
    this.#displayAp = true;
    if (tile) {
      this.#movementCursor(sel, mapPos, MoveUiTarget.INTTILES);
      this.#newCursor = this.#interactiveCursor(this.#newCursor, true);
      if (this.#showMoveGridAt >= 0) this.#showMoveGrid = 2;
      return;
    }
    if (!this.#enoughPoints(sel, this.#currentAp, false)) this.#apInvalid = true;
    this.#setConfirmMovementModeCursor(sel, false);
    if (!this.#combat()) this.#movementCursor(sel, mapPos, MoveUiTarget.NONE);
  }

  #cMoveMerc(): void {
    const sel = this.#sel();
    const mapPos = this.#mapPos();
    if (!sel || mapPos === null) return;
    const allMove = this.#allMoveOn;
    this.#allMoveOn = 0;
    this.#erasePath();
    if (allMove) {
      const soldiers = this.#host
        .squadSoldiers()
        .filter((s) => (s.life ?? 0) >= OKLIFE && !s.asleep)
        .map((s) => s.id);
      void this.#host
        .send({ type: 'moveGroup', soldiers, to: mapPos, mode: allMove === 2 ? 'run' : 'stance' })
        .then((reply) => this.#groupSounds(reply));
      this.#setConfirmMovementModeCursor(sel, true);
      return;
    }
    if (!this.#combat()) this.clearMoveMode(sel.id);
    const tile = this.#interactiveTile();
    if (tile) {
      const action = tile.open ? 'close' : 'open';
      if (tile.door)
        void this.#host
          .sendBusyOrder({ type: 'door', soldier: sel.id, gridNo: tile.gridNo, action })
          .then((r) => this.#host.doorReply(sel.id, tile.gridNo, r));
      return;
    }
    if (!this.#combat()) {
      this.#setConfirmMovementModeCursor(sel, true);
      if (this.multiSelected.size === 0) this.#fastMove(sel);
    }
    if (this.multiSelected.size > 0) {
      const soldiers = [...this.multiSelected];
      void this.#host
        .send({
          type: 'moveGroup',
          soldiers,
          to: mapPos,
          mode: this.#fast ? 'fast' : 'stance',
          ...(this.#reverse ? { reverse: true } : {}),
        })
        .then((reply) => this.#groupSounds(reply));
      this.#fast = false;
      return;
    }
    const mode = this.#fast && this.#env().world.soldierHeight(sel.id) === 'stand' ? RUN : this.moveModeOf(sel);
    this.#fast = false;
    const preview = dataOf(this.#previewMove(mapPos));
    void this.#host
      .sendBusyOrder({ type: 'move', soldier: sel.id, to: mapPos, mode, ...(this.#reverse ? { reverse: true } : {}) })
      .then((reply) => {
        if (reply.ok && (preview?.steps.length ?? 0) + 1 > OK_SOUND_STEPS) this.#env().battleSound(sel.id, 'ok');
      });
  }

  #fastMove(sel: SoldierView): void {
    if (this.#fast) this.setMoveMode(sel.id, RUN);
  }

  #groupSounds(reply: CommandReply): void {
    const data = reply.data as { readonly moved?: readonly number[] } | undefined;
    for (const id of data?.moved ?? []) this.#env().battleSound(id, 'ok');
  }

  #setUiMouseCursor(): void {
    const env = this.#env();
    const regions = env.runtime.regions;
    const { width } = env.runtime.geometry();
    const height = this.#host.viewportBottom();
    if (this.#mode === UiMode.MOVE_MODE) {
      if (this.#confirmExitArrows && this.#moveState !== MouseMove.STATIONARY) this.#confirmExitArrows = false;
      const edges = env.world.scrollEdges();
      const exit = this.#edgeExit(edges, regions.mouseX, regions.mouseY, width, height);
      if (exit) {
        this.#displayAp = false;
        this.#erasePath();
        this.#newCursor = this.#exitCursor(exit);
      }
      if (this.#showExitGrid) {
        this.#displayAp = false;
        this.#erasePath();
        this.#newCursor = this.#exitCursor('exitGrid');
      }
    }
    if (this.#timedCursor && this.#now < this.#timedCursor.until) this.#cursor = this.#timedCursor.cursor;
    else {
      this.#timedCursor = null;
      this.#cursor = this.#newCursor;
    }
  }

  #edgeExit(edges: ScrollEdges, x: number, y: number, width: number, height: number): ExitDirection | null {
    if (edges.right && x >= width - NO_PX_SHOW_EXIT_CURS) return 'east';
    if (edges.left && x < NO_PX_SHOW_EXIT_CURS) return 'west';
    if (edges.top && y < NO_PX_SHOW_EXIT_CURS) return 'north';
    if (edges.bottom && y >= height - NO_PX_SHOW_EXIT_CURS) return 'south';
    return null;
  }

  #exitCursor(direction: ExitDirection): string {
    const sel = this.#sel();
    const suffix = direction === 'exitGrid' ? 'GRID' : direction.toUpperCase();
    if (!sel) return `NOEXIT_${suffix}_UICURSOR`;
    const request: CommandEnvelope =
      direction === 'exitGrid'
        ? { type: 'exitSector', soldier: sel.id, exitGrid: this.#mapPos() ?? 0, dryRun: true }
        : { type: 'exitSector', soldier: sel.id, direction, dryRun: true };
    const answer = this.#hint<unknown>(request);
    this.#exitRefusal = answer.state === 'refused' ? answer.refusal : null;
    if (answer.state !== 'ok') return `NOEXIT_${suffix}_UICURSOR`;
    return this.#confirmExitArrows ? `CONFIRM_EXIT_${suffix}_UICURSOR` : `EXIT_${suffix}_UICURSOR`;
  }

  markers(): readonly WorldMarker[] {
    const out: WorldMarker[] = [];
    const sel = this.#sel();
    const level = this.#host.interfaceLevel();
    const mapPos = this.#mapPos();
    if (this.#host.itemInCursor()) return out;
    if (mapPos !== null && this.#cursor !== 'NO_UICURSOR') {
      out.push(
        ...cursorMarkers(this.#env().uiCursors, {
          uiCursor: this.#cursor,
          gridNo: mapPos,
          interfaceLevel: level,
          targetGridNo: this.#hover.target?.gridNo ?? null,
          apInvalidOrZero: this.#apInvalid || this.#currentAp === 0,
          stealth: sel?.stealth === true,
          displayAp: this.#displayAp,
        }),
      );
    }
    if (this.#lock !== 'none') return out;
    out.push(...this.#steps);
    if (this.#selection !== Selection.NONE && ourTurn(this.#view())) {
      const tile = this.#selection === Selection.NONSELECTED_GUY ? 'GOODRING1' : 'FIRSTPOINTERS2';
      out.push(selectionMarker(this.#selectionAt.gridNo, this.#selectionAt.level, tile));
    }
    const grid = this.#showMoveGrid || (this.#steps.length > 0 && this.#showMoveGridAt >= 0 ? 1 : 0);
    if (grid && sel && this.#showMoveGridAt >= 0 && this.#showMoveGridAt !== sel.gridNo) {
      const tile = grid === 2 ? 'FIRSTPOINTERS4' : sel.stealth ? 'FIRSTPOINTERS9' : 'FIRSTPOINTERS2';
      out.push(showMoveGridMarker(this.#showMoveGridAt, level, tile));
    }
    if (this.#impact) out.push(impactMarker(this.#impact.gridNo, this.#impact.level, this.#impact.good));
    return out;
  }

  apNumber(): { readonly marker: WorldMarker; readonly value: number; readonly black: boolean } | null {
    const mapPos = this.#mapPos();
    if (mapPos === null || !this.#displayAp || !this.#combat()) return null;
    if (!this.#env().uiCursors.has(this.#cursor, UiCursorFlag.SNAPPING)) return null;
    return {
      marker: apNumberMarker(mapPos, this.#host.interfaceLevel()),
      value: this.#currentAp,
      black: this.#apInvalid && this.#apBlink(),
    };
  }

  #apBlink(): boolean {
    return Math.trunc(this.#now / AP_BLINK_MS) % 2 === 1;
  }

  mouseText(): MouseText | null {
    const env = this.#env();
    if (!env.uiCursors.has(this.#cursor, UiCursorFlag.FREEFLOWING)) return null;
    const ap =
      this.#displayAp && this.#combat()
        ? {
            value: this.#currentAp,
            center: this.#apCenter || env.uiCursors.has(this.#cursor, UiCursorFlag.CENTERAPS),
            offsetX: this.#apOffX,
            offsetY: this.#apOffY,
            invalid: this.#apInvalid,
          }
        : null;
    return {
      ...(this.#hitLocation ? { location: this.#hitLocation } : {}),
      ...(this.#tileText ? { tile: this.#tileText } : {}),
      ...(this.#tileText2 ? { tile2: this.#tileText2 } : {}),
      ...(ap ? { actionPoints: ap } : {}),
    };
  }

  viewportCursor(): number {
    const env = this.#env();
    if (this.#host.itemInCursor()) return VIDEO_NO_CURSOR;
    const entry = env.uiCursors.entry(this.#cursor);
    if (this.#cursor === 'NO_UICURSOR' || entry.flags & UiCursorFlag.SNAPPING || !entry.cursor) return VIDEO_DEFAULT_TO_NO_CURSOR;
    if (entry.cursor === 'VIDEO_DEFAULT_TO_NO_CURSOR') return VIDEO_DEFAULT_TO_NO_CURSOR;
    return env.runtime.cursor.idOf(entry.cursor);
  }

  get cursorFlags(): { readonly flash: boolean; readonly cannotGetThrough: boolean } {
    return this.#cursorFlags;
  }

  reset(): void {
    this.#pointer.clear();
    this.#keys.length = 0;
    this.#lockRegion?.remove();
    this.#lockRegion = null;
    this.#lock = 'none';
    this.#mode = UiMode.IDLE_MODE;
    this.#event = UiEvent.I_DO_NOTHING;
    this.#pending = UiEvent.I_DO_NOTHING;
    this.multiSelected.clear();
    this.#rubberActive = false;
  }

  stopRubberBandedMercs(): void {
    for (const id of this.multiSelected) void this.#host.send({ type: 'stop', soldier: id });
  }

  cancelSpread(): void {
    this.#spreadTracking = false;
    this.#rtLeftHold = true;
    this.#doSpread = false;
  }
}

function adjustedStance(height: string, change: number): 'stand' | 'crouch' | 'prone' | null {
  if (height === 'stand') return change === -1 ? 'crouch' : change === -2 ? 'prone' : null;
  if (height === 'crouch') return change === 1 ? 'stand' : change === -1 ? 'prone' : null;
  if (height === 'prone') return change === 1 ? 'crouch' : change === 2 ? 'stand' : null;
  return null;
}

function rangeInTiles(a: number, b: number): number {
  const COLS = 160;
  const dx = (a % COLS) - (b % COLS);
  const dy = Math.trunc(a / COLS) - Math.trunc(b / COLS);
  return Math.trunc(Math.sqrt(dx * dx + dy * dy));
}

const MILITIA_TEAM = 3;
const CANNOT_LEAVE_SECTOR_FROM_SIDE_STR = 101;
const STR_LATE_01 = 0;
const EXIT_GUI_ISOLATE_EPC_MALE_SINGULAR = 6;
const EXIT_GUI_ISOLATE_EPC_FEMALE_SINGULAR = 7;
const EXIT_GUI_ISOLATE_EPC_MALE_PLURAL = 8;
const EXIT_GUI_ISOLATE_EPC_FEMALE_PLURAL = 9;
const EXIT_GUI_ESCORTED_CHARACTERS_CANT_LEAVE_SECTOR_ALONE_STR = 13;
const MAX_BURST_LOCATIONS = 50;
const NOT_ENOUGH_APS_STR = 87;
const EPC_CANNOT_DO_THAT = 124;
const MERC_IS_TOO_FAR_AWAY_STR = 102;
const MORALE_REFUSE_SEARCH = 30;
const CROW = 28;
const REGFEMALE = 3;
const CROW_HIT_LOCATION_STR = 105;
const AP_BLINK_MS = 150;
const CENTRE_PROBE_TILE = 'MOCKFLOOR1';
const ROOF_LIFT = 50;
const MOVE_CURSORS: Readonly<Record<string, string>> = {
  walk: 'MOVE_WALK_UICURSOR',
  run: 'MOVE_RUN_UICURSOR',
  swat: 'MOVE_SWAT_UICURSOR',
  crawl: 'MOVE_PRONE_UICURSOR',
};
const CONFIRM_CURSORS: Readonly<Record<string, string>> = {
  walk: 'CONFIRM_MOVE_WALK_UICURSOR',
  run: 'CONFIRM_MOVE_RUN_UICURSOR',
  swat: 'CONFIRM_MOVE_SWAT_UICURSOR',
  crawl: 'CONFIRM_MOVE_PRONE_UICURSOR',
};
const ALL_MOVE_CURSORS: Readonly<Record<string, string>> = {
  walk: 'ALL_MOVE_WALK_UICURSOR',
  run: 'ALL_MOVE_RUN_UICURSOR',
  swat: 'ALL_MOVE_SWAT_UICURSOR',
  crawl: 'ALL_MOVE_PRONE_UICURSOR',
};
const EXIT_DIRECTIONS: Readonly<Record<string, ExitDirection>> = {
  EXIT_NORTH_UICURSOR: 'north',
  CONFIRM_EXIT_NORTH_UICURSOR: 'north',
  EXIT_SOUTH_UICURSOR: 'south',
  CONFIRM_EXIT_SOUTH_UICURSOR: 'south',
  EXIT_EAST_UICURSOR: 'east',
  CONFIRM_EXIT_EAST_UICURSOR: 'east',
  EXIT_WEST_UICURSOR: 'west',
  CONFIRM_EXIT_WEST_UICURSOR: 'west',
  EXIT_GRID_UICURSOR: 'exitGrid',
  CONFIRM_EXIT_GRID_UICURSOR: 'exitGrid',
};
const MULTI_SELECT_MODES: ReadonlySet<UiMode> = new Set([
  UiMode.MOVE_MODE,
  UiMode.CONFIRM_MOVE_MODE,
  UiMode.RUBBERBAND_MODE,
  UiMode.ADJUST_STANCE_MODE,
  UiMode.TALKCURSOR_MODE,
  UiMode.LOOKCURSOR_MODE,
]);
const CTRL_MODES: ReadonlySet<UiMode> = new Set([
  UiMode.DONT_CHANGEMODE,
  UiMode.CONFIRM_MOVE_MODE,
  UiMode.CONFIRM_ACTION_MODE,
  UiMode.LOOKCURSOR_MODE,
  UiMode.TALKCURSOR_MODE,
  UiMode.IDLE_MODE,
  UiMode.MOVE_MODE,
  UiMode.ACTION_MODE,
  UiMode.HANDCURSOR_MODE,
]);
const RIGHT_HOLD_MODES: ReadonlySet<UiMode> = new Set([
  UiMode.IDLE_MODE,
  UiMode.ACTION_MODE,
  UiMode.HANDCURSOR_MODE,
  UiMode.LOOKCURSOR_MODE,
  UiMode.TALKCURSOR_MODE,
  UiMode.MOVE_MODE,
]);

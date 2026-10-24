// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Turn_Based_Input.cc GetKeyboardInput (the speech advance, the player pause, the feedback box
// @src closed by a key, ESC cancelling the spread, the popups, the menu modes and stopping the selected and band-selected
// @src mercs, Backspace, the UI lock letting only ESC and Backspace through, ENTER cycling the known enemies on our turn),
// @src HandleModNone, HandleModShift, HandleModCtrl, HandleModAlt, HandleModCtrlShift (the gameplay keys; cheats, debug
// @src pages and the editor keys are not ported), HandleSectorExitMenuKeys, HandleOpenDoorMenuKeys, HandleMenuKeys,
// @src HandleItemMenuKeys, HandleTalkingMenuKeys, HandleStanceChangeFromUIKeys, HandleStealthChangeFromUIKeys,
// @src ChangeCurrentSquad, HandleSelectMercSlot, GroupAutoReload; Handle_UI.cc ClimbUpOrDown, GotoHigherStance,
// @src GotoLowerStance; Overhead.cc CycleThroughKnownEnemies, CycleVisibleEnemies; DisplayCover.cc DisplayRangeToTarget;
// @src GameSettings.cc DisplayGameSettings; Soldier_Control.cc HandlePlayerTogglingLightEffects. See docs/28 §6.3.

import type { UiKeyEvent } from '../../../input/events.ts';
import { UiEvent, UiMode } from './ui-events.ts';

export const KEY_MASK = { NONE: 0, SHIFT: 1, CTRL: 2, ALT: 4 } as const;

export interface HotkeyHost {
  readonly mode: UiMode;
  readonly locked: boolean;
  readonly inCombat: boolean;
  readonly ourTurn: boolean;
  readonly inConversation: boolean;
  readonly itemInCursor: boolean;
  readonly smPanel: boolean;
  smButtonEnabled(button: SmButton): boolean;
  hasSelected(): boolean;
  closeMenu(): boolean;
  dismissFeedback(): boolean;
  cancelSpread(): void;
  closePopups(): void;
  stopSelected(): void;
  nextMerc(): void;
  nextSquad(): void;
  selectSquad(squad: number): void;
  selectSlot(slot: number, force: boolean): void;
  locateSelected(): void;
  selectAllInSector(): void;
  weaponMode(): void;
  stance(stance: 'stand' | 'crouch' | 'prone'): void;
  higherStance(): void;
  lowerStance(): void;
  climb(): void;
  climbWindow(): void;
  cycleVisibleEnemies(): void;
  cycleKnownEnemies(): void;
  rangeToTarget(): void;
  toggleMercLight(): void;
  toggleItemGlow(): void;
  toggleRedItemGlow(): void;
  toggleTreeTops(): void;
  toggleWireframes(): void;
  toggle3dCursor(): void;
  toggleTracking(): void;
  runMode(): void;
  swapPlaces(): void;
  stealth(squad: boolean): void;
  overheadMap(): void;
  continueMove(): void;
  mapScreen(): void;
  help(): void;
  gameSettings(): void;
  cycleStack(): void;
  clearMessages(queue: boolean): void;
  swapHands(): void;
  reload(squad: boolean): void;
  musicDown(): void;
}

export type SmButton = 'updown' | 'nextMerc' | 'burst' | 'look' | 'done' | 'map' | 'options' | 'stealth';

const SQUAD_KEYS = '1234567890';
const F_KEY = /^F([1-9]|10)$/;
const MENU_MODES: ReadonlySet<UiMode> = new Set([
  UiMode.EXITSECTORMENU_MODE,
  UiMode.GETTINGITEM_MODE,
  UiMode.MENU_MODE,
  UiMode.OPENDOOR_MENU_MODE,
]);

export function handleTacticalKey(h: HotkeyHost, key: UiKeyEvent, event: UiEvent): UiEvent {
  if (key.kind === 'keyDown' && h.dismissFeedback()) return event;
  if (MENU_MODES.has(h.mode)) return menuKey(h, key, event);
  if (key.kind !== 'keyDown') return event;
  let next = event;
  if (key.key === 'Escape') next = escapeKey(h, next);
  if (key.key === 'Enter' && h.inCombat && h.ourTurn) h.cycleKnownEnemies();
  if (h.locked) return next;
  switch (key.modifiers) {
    case KEY_MASK.NONE:
      return noModifier(h, key.key, next);
    case KEY_MASK.SHIFT:
      return shifted(h, key.key, next);
    case KEY_MASK.CTRL:
      return withCtrl(h, key.key, next);
    case KEY_MASK.ALT:
      return withAlt(h, key.key, next);
    case KEY_MASK.CTRL | KEY_MASK.SHIFT:
      if (key.key === 'r') h.reload(true);
      return next;
    default:
      return next;
  }
}

function menuKey(h: HotkeyHost, key: UiKeyEvent, event: UiEvent): UiEvent {
  if (key.kind === 'keyUp' && key.key === 'Escape' && h.closeMenu()) return UiEvent.A_CHANGE_TO_MOVE;
  return event;
}

function escapeKey(h: HotkeyHost, event: UiEvent): UiEvent {
  h.cancelSpread();
  h.closePopups();
  let next = event;
  if (h.mode === UiMode.HANDCURSOR_MODE) next = UiEvent.A_CHANGE_TO_MOVE;
  if (!h.inConversation) {
    if (h.hasSelected()) next = UiEvent.A_CHANGE_TO_MOVE;
    h.stopSelected();
  }
  return next;
}

function panelOk(h: HotkeyHost, button: SmButton): boolean {
  return !h.smPanel || h.smButtonEnabled(button);
}

function noModifier(h: HotkeyHost, key: string, event: UiEvent): UiEvent {
  if (SQUAD_KEYS.includes(key) && key.length === 1) {
    if (!h.itemInCursor) h.selectSquad(key === '0' ? 9 : SQUAD_KEYS.indexOf(key));
    return event;
  }
  const f = F_KEY.exec(key);
  if (f) {
    h.selectSlot(Number(f[1]) - 1, true);
    return event;
  }
  switch (key) {
    case 'Tab':
      return !h.itemInCursor && panelOk(h, 'updown') ? UiEvent.I_CHANGELEVEL : event;
    case ' ':
      if (!h.inConversation && panelOk(h, 'nextMerc')) {
        h.nextMerc();
        return UiEvent.M_ON_TERRAIN;
      }
      return event;
    case '*':
    case ',':
      h.toggleRedItemGlow();
      return event;
    case '/':
      h.locateSelected();
      return event;
    case '=':
      if (!h.inCombat) h.selectAllInSector();
      return event;
    case 'b':
      if (!h.itemInCursor && panelOk(h, 'burst')) h.weaponMode();
      return event;
    case 'c':
      h.stance('crouch');
      return event;
    case 'd':
      return h.inCombat && h.ourTurn && !h.itemInCursor && h.smButtonEnabled('done') ? UiEvent.I_ENDTURN : event;
    case 'e':
      h.cycleVisibleEnemies();
      return event;
    case 'f':
      h.rangeToTarget();
      return event;
    case 'g':
      h.toggleMercLight();
      return event;
    case 'h':
      h.help();
      return event;
    case 'i':
      h.toggleItemGlow();
      return event;
    case 'j':
      h.climb();
      return event;
    case 'l':
      return !h.itemInCursor && panelOk(h, 'look') ? UiEvent.LC_CHANGE_TO_LOOK : event;
    case 'm':
      if (!h.itemInCursor && !h.inConversation && h.smButtonEnabled('map')) h.mapScreen();
      return event;
    case 'n':
      h.cycleStack();
      return event;
    case 'p':
      h.stance('prone');
      return event;
    case 'r':
      h.runMode();
      return event;
    case 's':
      if (h.hasSelected()) h.stance('stand');
      return event;
    case 't':
      h.toggleTreeTops();
      return event;
    case 'u':
      return h.hasSelected() ? UiEvent.M_CHANGE_TO_ACTION : event;
    case 'v':
      h.gameSettings();
      return event;
    case 'w':
      h.toggleWireframes();
      return event;
    case 'x':
      h.swapPlaces();
      return event;
    case 'z':
      if (!h.itemInCursor) h.stealth(false);
      return event;
    case 'Insert':
      h.overheadMap();
      return event;
    case 'Home':
      h.toggle3dCursor();
      return event;
    case 'End':
      h.continueMove();
      return event;
    case 'PageUp':
      if (!h.itemInCursor) h.higherStance();
      return event;
    case 'PageDown':
      if (!h.itemInCursor) h.lowerStance();
      return event;
    case 'F12':
      h.clearMessages(false);
      return event;
    default:
      return event;
  }
}

function shifted(h: HotkeyHost, key: string, event: UiEvent): UiEvent {
  const f = F_KEY.exec(key);
  if (f) {
    h.selectSlot(Number(f[1]) - 1, false);
    return event;
  }
  if (key === ' ' && !h.inConversation && panelOk(h, 'nextMerc')) {
    h.nextSquad();
    return UiEvent.M_ON_TERRAIN;
  }
  if (key === 'j') h.climbWindow();
  return event;
}

function withCtrl(h: HotkeyHost, key: string, event: UiEvent): UiEvent {
  if (key === 'q') h.swapHands();
  if (key === 'F12') h.clearMessages(true);
  return event;
}

function withAlt(h: HotkeyHost, key: string, event: UiEvent): UiEvent {
  if (key === '-') h.musicDown();
  if (key === 'f') h.toggleTracking();
  if (key === 'r') h.reload(false);
  if (key === 'z') h.stealth(true);
  return event;
}

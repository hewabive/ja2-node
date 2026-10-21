// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc UpdateTEAMPanel, RenderTEAMPanel (the hands' fast help, the driver and
// @src passenger texts), UpdateSMPanel, EnableSMPanelButtons, PrintStat, RenderSMPanel, SetStatsHelp. See docs/28 §5.1,
// @src §5.2.

import type { PlayerView, SoldierView } from '../../../protocol/view.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { OKLIFE } from './faces.ts';
import { type HelpTextSources, helpTextForItem, NUM_INV_SLOTS } from './inventory.ts';
import { slotItem } from './item-cursor.ts';
import {
  emptySmModel,
  type SmPanelModel,
  STAT_KEYS,
  type Stance,
  type StatColour,
  type StatKey,
  statText,
  stealthButtons,
} from './sm-panel.ts';
import { apColour, inCombat, isDead, ourTurn, showsAp, vitalStatsHelp } from './soldiers.ts';
import type { TeamPanelModel, TeamSlotModel } from './team-panel.ts';

export const CHANGE_STAT_RECENTLY_DURATION_MS = 60000;
const DRIVER_POPUPTEXT = 66;
const EXIT_VEHICLE_POPUPTEXT = 67;

export interface StatFlash {
  readonly at: number;
  readonly up: boolean;
}

export interface PanelState {
  readonly view: PlayerView | null;
  readonly selected: number | null;
  readonly itemInCursor: boolean;
  readonly pickupMenuOpen: boolean;
  readonly popupOpen: boolean;
  readonly descriptionOpen: boolean;
  readonly disabledForItems: boolean;
  readonly interfaceLevel: number;
  readonly cursorMode: 'none' | 'hand' | 'talk' | 'look';
  readonly now: number;
  readonly shopOpen?: boolean;
}

function emptySlot(): TeamSlotModel {
  return {
    soldier: null,
    occupied: false,
    name: '',
    stealth: false,
    ap: '',
    showAp: false,
    apColor: 'ltgray',
    statsHelp: '',
    firstHandHelp: '',
    secondHandHelp: '',
  };
}

function handHelp(text: UiTextService, s: SoldierView, slot: number, help: HelpTextSources): string {
  if (isDead(s)) return '';
  const seat = s.vehicle ?? null;
  if (slot === 5 && seat?.driver) return text.string('TacticalStr', DRIVER_POPUPTEXT) ?? '';
  if (slot === 6 && seat) return text.string('TacticalStr', EXIT_VEHICLE_POPUPTEXT) ?? '';
  return helpTextForItem(slotItem(s, slot), help);
}

export function teamPanelModel(
  state: PanelState,
  members: readonly (SoldierView | null)[],
  text: UiTextService,
  help: HelpTextSources,
): TeamPanelModel {
  const view = state.view;
  const slots = members.map((s) => {
    if (!s) return emptySlot();
    return {
      soldier: s.id,
      occupied: true,
      name: s.name,
      stealth: s.stealth === true,
      ap: String(s.ap ?? 0),
      showAp: showsAp(view, s),
      apColor: apColour(s),
      statsHelp: vitalStatsHelp(text, s),
      firstHandHelp: handHelp(text, s, 5, help),
      secondHandHelp: handHelp(text, s, 6, help),
    };
  });
  const panelButtonsDisabled = state.itemInCursor || state.pickupMenuOpen;
  return {
    slots,
    endTurnEnabled: !panelButtonsDisabled && inCombat(view) && ourTurn(view),
    mapScreenEnabled: !panelButtonsDisabled && !view?.conversation,
    squadEnabled: !panelButtonsDisabled,
    panelRegionsEnabled: !panelButtonsDisabled,
  };
}

function statColour(s: SoldierView, flash: StatFlash | undefined, now: number): StatColour {
  if ((s.life ?? 0) < OKLIFE) return 'dim';
  if (!flash || now >= CHANGE_STAT_RECENTLY_DURATION_MS + flash.at) return 'normal';
  return flash.up ? 'up' : 'down';
}

export function smPanelModel(
  state: PanelState,
  s: SoldierView | null,
  stance: Stance,
  flashes: ReadonlyMap<StatKey, StatFlash>,
  mercs: readonly SoldierView[],
  text: UiTextService,
  help: HelpTextSources,
): SmPanelModel {
  const model = emptySmModel();
  if (!s) return model;
  const view = state.view;
  const life = s.life ?? 0;
  const stats = s.stats;
  const actionsOff =
    s.id !== state.selected || life < OKLIFE || !ourTurn(view) || state.disabledForItems || state.itemInCursor || state.popupOpen;
  const allOff = state.itemInCursor || state.popupOpen;
  const alive = mercs.filter((m) => !isDead(m)).length;
  const shop = state.shopOpen === true;
  return {
    ...model,
    name: s.name,
    stealth: s.stealth === true,
    ap: String(s.ap ?? 0),
    showAp: showsAp(view, s),
    apColor: apColour(s),
    stats: STAT_KEYS.map((key) => ({ value: statText(stats?.[key] ?? 0), color: statColour(s, flashes.get(key), state.now) })),
    armour: statText(s.armour ?? 0),
    weight: statText(s.weight ?? 0),
    camo: statText(s.camo ?? 0),
    valueColor: life >= OKLIFE ? 'normal' : 'dim',
    statsHelp: vitalStatsHelp(text, s),
    descriptionOpen: state.descriptionOpen,
    inventoryEnabled: !state.disabledForItems,
    keyRingEnabled: !shop && !state.disabledForItems && !state.itemInCursor,
    slots: Array.from({ length: NUM_INV_SLOTS }, (_, slot) => ({ tooltip: helpTextForItem(slotItem(s, slot), help) })),
    weaponMode: s.weaponMode ?? 'single',
    stealthButton: stealthButtons(stance, s.stealth === true),
    mapScreenEnabled: !shop && !allOff && !view?.conversation && !state.pickupMenuOpen,
    doneEnabled: !shop && !allOff && inCombat(view) && ourTurn(view),
    talkEnabled: !shop && !allOff,
    talkChecked: state.cursorMode === 'talk',
    muteEnabled: false,
    muteChecked: s.muted === true,
    stanceUpEnabled: !shop && !actionsOff && stance !== 'stand',
    levelEnabled: !shop && !actionsOff,
    levelChecked: state.interfaceLevel > 0,
    climbEnabled: !shop && !actionsOff,
    stanceDownEnabled: !shop && !actionsOff && stance !== 'prone',
    handEnabled: !shop && !actionsOff,
    handChecked: state.cursorMode === 'hand',
    prevEnabled: !state.popupOpen && alive > 0,
    nextEnabled: !state.popupOpen && alive > 0,
    optionsEnabled: !shop && !allOff,
    burstEnabled: false,
    lookEnabled: !shop && !actionsOff,
    lookChecked: state.cursorMode === 'look',
    stealthEnabled: false,
  };
}

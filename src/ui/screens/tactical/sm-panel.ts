// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc UpdateSMPanel (stance up unless standing, stance down unless prone, the
// @src stealth button per stance, the burst image per weapon mode, mute, level, hand, talk and look pressed from their
// @src states, Done on our turn in combat, everything but talk off for another merc, below OKLIFE, on their turn or while
// @src the panel is disabled for items, Map off in a conversation or the pickup menu), EnableSMPanelButtons (the item
// @src pointer disables every action button, Options, Done, Map and the radar; prev and next stay), PrintStat
// @src (CHANGE_STAT_RECENTLY_DURATION, light green after a rise, red after a fall, dark grey below OKLIFE),
// @src RenderSMPanel ("{3d}" values).

import type { ControllerContract, LayoutController } from '../../layout/controller.ts';
import { getPath } from '../../layout/controller.ts';
import type { ApColour } from './soldiers.ts';

export const SM_PANEL_SCREEN = 'tacticalSingleMerc';
export const STAT_KEYS = [
  'agility',
  'dexterity',
  'strength',
  'leadership',
  'wisdom',
  'level',
  'marksmanship',
  'explosives',
  'mechanical',
  'medical',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatColour = 'normal' | 'dim' | 'up' | 'down';
export type Stance = 'stand' | 'crouch' | 'prone';

export const SM_PANEL_CONTRACT: ControllerContract = {
  id: SM_PANEL_SCREEN,
  actions: {
    selectMerc: {},
    closePanel: {},
    faceHover: { args: 1 },
    enemyIndicator: {},
    slotPrimary: { args: 1 },
    slotSecondary: { args: 1 },
    slotHover: { args: 2 },
    bodyPrimary: {},
    bodyHover: { args: 1 },
    keyRing: {},
    mapScreen: {},
    done: {},
    talk: {},
    mute: {},
    stanceUp: {},
    level: {},
    climb: {},
    stanceDown: {},
    hand: {},
    prevMerc: {},
    nextMerc: {},
    options: {},
    burstMode: {},
    look: {},
    stealth: {},
    money: {},
  },
  bindings: {
    name: 'string',
    stealth: 'boolean',
    ap: 'string',
    showAp: 'boolean',
    apColor: 'string',
    stats: 'list',
    armour: 'string',
    weight: 'string',
    camo: 'string',
    valueColor: 'string',
    percentSign: 'string',
    statsHelp: 'string',
    descriptionOpen: 'boolean',
    inventoryEnabled: 'boolean',
    keyRingEnabled: 'boolean',
    slots: 'list',
    weaponMode: 'string',
    stealthButton: 'object',
    mapScreenEnabled: 'boolean',
    doneEnabled: 'boolean',
    talkEnabled: 'boolean',
    talkChecked: 'boolean',
    muteEnabled: 'boolean',
    muteChecked: 'boolean',
    stanceUpEnabled: 'boolean',
    levelEnabled: 'boolean',
    levelChecked: 'boolean',
    climbEnabled: 'boolean',
    stanceDownEnabled: 'boolean',
    handEnabled: 'boolean',
    handChecked: 'boolean',
    prevEnabled: 'boolean',
    nextEnabled: 'boolean',
    optionsEnabled: 'boolean',
    burstEnabled: 'boolean',
    lookEnabled: 'boolean',
    lookChecked: 'boolean',
    stealthEnabled: 'boolean',
  },
};

export interface StatModel {
  readonly value: string;
  readonly color: StatColour;
}

export interface SlotModel {
  readonly tooltip: string;
}

export interface StealthButtons {
  readonly standOn: boolean;
  readonly standOff: boolean;
  readonly crouchOn: boolean;
  readonly crouchOff: boolean;
  readonly proneOn: boolean;
  readonly proneOff: boolean;
}

export interface SmPanelModel {
  name: string;
  stealth: boolean;
  ap: string;
  showAp: boolean;
  apColor: ApColour;
  stats: StatModel[];
  armour: string;
  weight: string;
  camo: string;
  valueColor: 'normal' | 'dim';
  percentSign: string;
  statsHelp: string;
  descriptionOpen: boolean;
  inventoryEnabled: boolean;
  keyRingEnabled: boolean;
  slots: SlotModel[];
  weaponMode: string;
  stealthButton: StealthButtons;
  mapScreenEnabled: boolean;
  doneEnabled: boolean;
  talkEnabled: boolean;
  talkChecked: boolean;
  muteEnabled: boolean;
  muteChecked: boolean;
  stanceUpEnabled: boolean;
  levelEnabled: boolean;
  levelChecked: boolean;
  climbEnabled: boolean;
  stanceDownEnabled: boolean;
  handEnabled: boolean;
  handChecked: boolean;
  prevEnabled: boolean;
  nextEnabled: boolean;
  optionsEnabled: boolean;
  burstEnabled: boolean;
  lookEnabled: boolean;
  lookChecked: boolean;
  stealthEnabled: boolean;
}

const NO_STEALTH_BUTTON: StealthButtons = {
  standOn: false,
  standOff: false,
  crouchOn: false,
  crouchOff: false,
  proneOn: false,
  proneOff: false,
};

export function stealthButtons(stance: Stance, stealth: boolean): StealthButtons {
  return {
    ...NO_STEALTH_BUTTON,
    standOn: stance === 'stand' && stealth,
    standOff: stance === 'stand' && !stealth,
    crouchOn: stance === 'crouch' && stealth,
    crouchOff: stance === 'crouch' && !stealth,
    proneOn: stance === 'prone' && stealth,
    proneOff: stance === 'prone' && !stealth,
  };
}

export function emptySmModel(): SmPanelModel {
  return {
    name: '',
    stealth: false,
    ap: '',
    showAp: false,
    apColor: 'ltgray',
    stats: STAT_KEYS.map(() => ({ value: '', color: 'normal' })),
    armour: '',
    weight: '',
    camo: '',
    valueColor: 'normal',
    percentSign: '%',
    statsHelp: '',
    descriptionOpen: false,
    inventoryEnabled: false,
    keyRingEnabled: false,
    slots: [],
    weaponMode: 'single',
    stealthButton: NO_STEALTH_BUTTON,
    mapScreenEnabled: false,
    doneEnabled: false,
    talkEnabled: false,
    talkChecked: false,
    muteEnabled: false,
    muteChecked: false,
    stanceUpEnabled: false,
    levelEnabled: false,
    levelChecked: false,
    climbEnabled: false,
    stanceDownEnabled: false,
    handEnabled: false,
    handChecked: false,
    prevEnabled: false,
    nextEnabled: false,
    optionsEnabled: false,
    burstEnabled: false,
    lookEnabled: false,
    lookChecked: false,
    stealthEnabled: false,
  };
}

export function statText(value: number): string {
  return String(value).padStart(3, ' ');
}

export class SmPanelController implements LayoutController {
  readonly contract = SM_PANEL_CONTRACT;
  model: SmPanelModel = emptySmModel();
  readonly #invoke: (action: string, args: readonly number[]) => void;

  constructor(invoke: (action: string, args: readonly number[]) => void) {
    this.#invoke = invoke;
  }

  get(path: string): unknown {
    return getPath(this.model, path);
  }

  invoke(action: string, args: readonly number[]): void {
    this.#invoke(action, args);
  }
}

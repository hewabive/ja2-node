// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/PreBattle_Interface.cc InitPreBattleInterface (the fast help of the three buttons for the
// @src persistent and the non-persistent panel), RenderPBHeader (the header by encounter code, BATTLE IN PROGRESS for the
// @src non-persistent panel, blinking for ambushes, creature attacks and bloodcat ambushes), RenderPreBattleInterface (the
// @src enemy column label, the counts, the condition words, the HP and BP percentages), GetSoldierConditionInfo,
// @src DoTransitionFromMapscreenToPreBattleInterface (the gravity-factored stretch from the battle sector to the panel).
// See docs/28 §8.1.

import { idiv, u16 } from '../../../core/int.ts';
import type { PromptOptionView } from '../../../protocol/view.ts';
import type { UiTextService } from '../../text/text-service.ts';

export const STRATEGIC = 'gpStrategicString';
export const NON_PERSISTENT = 'gzNonPersistantPBIText';
const CONDITIONS = 'pConditionStrings';

export const StrategicString = {
  ENEMY_SURRENDER_OFFER: 3,
  ENEMY_CAPTURED: 4,
  AR_RETREAT_BUTTON: 5,
  AR_DONE_BUTTON: 6,
  AR_DEFEND_HEADER: 7,
  AR_ENCOUNTER_HEADER: 9,
  AR_OVER_VICTORY: 11,
  AR_OVER_DEFEAT: 12,
  AR_OVER_SURRENDERED: 13,
  AR_OVER_CAPTURED: 14,
  AR_OVER_RETREATED: 15,
  AR_MILITIA_NAME: 16,
  AR_ELITE_NAME: 17,
  AR_TROOP_NAME: 18,
  AR_ADMINISTRATOR_NAME: 19,
  AR_CREATURE_NAME: 20,
  AR_TIME_ELAPSED: 21,
  AR_MERC_RETREATED: 22,
  AR_MERC_RETREATING: 23,
  AR_MERC_RETREAT: 24,
  PB_AUTORESOLVE_BTN: 25,
  PB_GOTOSECTOR_BTN: 26,
  PB_RETREATMERCS_BTN: 27,
  PB_ENEMYENCOUNTER_HEADER: 28,
  PB_ENEMYINVASION_HEADER: 29,
  PB_ENEMYAMBUSH_HEADER: 30,
  PB_ENTERINGENEMYSECTOR_HEADER: 31,
  PB_CREATUREATTACK_HEADER: 32,
  PB_BLOODCATAMBUSH_HEADER: 33,
  PB_ENTERINGBLOODCATLAIR_HEADER: 34,
  PB_LOCATION: 35,
  PB_ENEMIES: 36,
  PB_MERCS: 37,
  PB_MILITIA: 38,
  PB_CREATURES: 39,
  PB_BLOODCATS: 40,
  PB_SECTOR: 41,
  PB_NONE: 42,
  PB_NOTAPPLICABLE_ABBREVIATION: 43,
  PB_DAYS_ABBREVIATION: 44,
  PB_HOURS_ABBREVIATION: 45,
  PB_AUTORESOLVE_FASTHELP: 59,
  PB_DISABLED_AUTORESOLVE_FASTHELP: 60,
  PB_GOTOSECTOR_FASTHELP: 61,
  BP_RETREATSINGLE_FASTHELP: 62,
  BP_RETREATPLURAL_FASTHELP: 63,
} as const;

const HEADERS: Readonly<Record<string, number>> = {
  enemyInvasion: StrategicString.PB_ENEMYINVASION_HEADER,
  enemyEncounter: StrategicString.PB_ENEMYENCOUNTER_HEADER,
  enemyAmbush: StrategicString.PB_ENEMYAMBUSH_HEADER,
  enteringEnemySector: StrategicString.PB_ENTERINGENEMYSECTOR_HEADER,
  creatureAttack: StrategicString.PB_CREATUREATTACK_HEADER,
  bloodcatAmbush: StrategicString.PB_BLOODCATAMBUSH_HEADER,
  enteringBloodcatLair: StrategicString.PB_ENTERINGBLOODCATLAIR_HEADER,
};
const BLINKING_HEADERS: ReadonlySet<string> = new Set(['enemyAmbush', 'creatureAttack', 'bloodcatAmbush']);
const BATTLE_IN_PROGRESS_HEADER = 8;

export function headerText(text: UiTextService, persistent: boolean, encounter: string): string {
  if (!persistent) return text.string(NON_PERSISTENT, BATTLE_IN_PROGRESS_HEADER) ?? '';
  const index = HEADERS[encounter];
  return index === undefined ? '' : (text.string(STRATEGIC, index) ?? '');
}

export function headerBlinks(persistent: boolean, encounter: string, renderedBefore: boolean): boolean {
  return !persistent || (renderedBefore && BLINKING_HEADERS.has(encounter));
}

const BLINK_PERIOD_MS = 1000;
const BLINK_WHITE_MS = 667;

export type HeaderColour = 'beige' | 'white' | 'ltRed';

export function headerColour(blinks: boolean, nowMs: number): HeaderColour {
  if (!blinks) return 'beige';
  return nowMs % BLINK_PERIOD_MS < BLINK_WHITE_MS ? 'white' : 'ltRed';
}

export function enemyLabel(text: UiTextService, encounter: string): string {
  return text.string(STRATEGIC, encounter === 'creatureAttack' ? StrategicString.PB_CREATURES : StrategicString.PB_ENEMIES) ?? '';
}

export const PbiChoice = { AUTORESOLVE: 'autoresolve', ENTER: 'enterSector', RETREAT: 'retreat', CLOSE: 'close' } as const;
export const PBI_BUTTON_CHOICES = [PbiChoice.AUTORESOLVE, PbiChoice.ENTER, PbiChoice.RETREAT] as const;

const PERSISTENT_AUTORESOLVE_HELP: Readonly<Record<string, readonly [string, number]>> = {
  playerInitiatedAttack: [STRATEGIC, StrategicString.PB_DISABLED_AUTORESOLVE_FASTHELP],
  ambush: [NON_PERSISTENT, 3],
};
const NON_PERSISTENT_AUTORESOLVE_HELP: Readonly<Record<string, number>> = {
  enteringEnemySector: 3,
  ambush: 4,
  fightingCreatures: 5,
  hostileCivilians: 6,
  bloodcats: 7,
};
const NON_PERSISTENT_ENABLED_AUTORESOLVE_HELP = 2;
const NON_PERSISTENT_ENTER_HELP = 1;
const NON_PERSISTENT_RETREAT_HELP = 0;
const PERSISTENT_RETREAT_DISABLED_HELP = 9;

export interface PbiButtonState {
  readonly choice: string;
  readonly enabled: boolean;
  readonly help: string;
}

function option(options: readonly PromptOptionView[], choice: string): PromptOptionView {
  return options.find((o) => o.choice === choice) ?? { choice, enabled: false };
}

function persistentHelp(text: UiTextService, o: PromptOptionView, plural: boolean): string {
  if (o.choice === PbiChoice.AUTORESOLVE) {
    const [table, index] = (o.reason ? PERSISTENT_AUTORESOLVE_HELP[o.reason] : undefined) ?? [
      STRATEGIC,
      StrategicString.PB_AUTORESOLVE_FASTHELP,
    ];
    return text.string(table, index) ?? '';
  }
  if (o.choice === PbiChoice.ENTER) return text.string(STRATEGIC, StrategicString.PB_GOTOSECTOR_FASTHELP) ?? '';
  if (!o.enabled) return text.string(NON_PERSISTENT, PERSISTENT_RETREAT_DISABLED_HELP) ?? '';
  return text.string(STRATEGIC, plural ? StrategicString.BP_RETREATPLURAL_FASTHELP : StrategicString.BP_RETREATSINGLE_FASTHELP) ?? '';
}

function nonPersistentHelp(text: UiTextService, o: PromptOptionView): string {
  if (o.choice === PbiChoice.RETREAT) return text.string(NON_PERSISTENT, NON_PERSISTENT_RETREAT_HELP) ?? '';
  if (o.choice === PbiChoice.ENTER) return text.string(NON_PERSISTENT, NON_PERSISTENT_ENTER_HELP) ?? '';
  const index = (o.reason ? NON_PERSISTENT_AUTORESOLVE_HELP[o.reason] : undefined) ?? NON_PERSISTENT_ENABLED_AUTORESOLVE_HELP;
  return text.string(NON_PERSISTENT, index) ?? '';
}

export function buttonStates(
  text: UiTextService,
  persistent: boolean,
  options: readonly PromptOptionView[],
  involvedGroups: number,
): PbiButtonState[] {
  return PBI_BUTTON_CHOICES.map((choice) => {
    const o = option(options, choice);
    const help = persistent ? persistentHelp(text, o, involvedGroups > 1) : nonPersistentHelp(text, o);
    return { choice, enabled: o.enabled, help };
  });
}

const CONDITION_INDEX: Readonly<Record<string, number>> = {
  excellent: 0,
  good: 1,
  fair: 2,
  wounded: 3,
  fatigued: 4,
  bleeding: 5,
  unconscious: 6,
  dying: 7,
  dead: 8,
};

export function conditionText(text: UiTextService, condition: string): string {
  return text.string(CONDITIONS, CONDITION_INDEX[condition] ?? 0) ?? '';
}

export function percentText(value: number): string {
  return `${value}%`;
}

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const DAYS_SHOWN_FROM_MINUTES = 3 * MINUTES_PER_DAY;
const MINUTES_SHOWN_AS_ZERO = 5;

export function departureText(text: UiTextService, minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return text.string(STRATEGIC, StrategicString.PB_NOTAPPLICABLE_ABBREVIATION) ?? '';
  if (minutes >= DAYS_SHOWN_FROM_MINUTES)
    return `${idiv(minutes, MINUTES_PER_DAY)}${text.string(STRATEGIC, StrategicString.PB_DAYS_ABBREVIATION) ?? ''}`;
  const hours = minutes > MINUTES_SHOWN_AS_ZERO ? idiv(minutes + MINUTES_PER_HOUR - 1, MINUTES_PER_HOUR) : 0;
  return `${hours}${text.string(STRATEGIC, StrategicString.PB_HOURS_ABBREVIATION) ?? ''}`;
}

export const PBI_WIDTH = 261;
export const PBI_HEIGHT = 359;
const PBI_END_X = 131;
const PBI_END_Y = 180;
const TRANSITION_MS = 1000;
const FULL = 100;
const HALF = 50;
const ROUND_LOW = 0.5;
const ROUND_HIGH = 0.05;
const PERCENT_SCALE = 0.01;

export function gravityPercentage(elapsedMs: number): number {
  const raw = Math.min(idiv(Math.max(elapsedMs, 0) * FULL, TRANSITION_MS), FULL);
  const factor = (raw - HALF) * 2;
  if (raw < HALF) return Math.trunc(raw + raw * factor * PERCENT_SCALE + ROUND_LOW);
  return Math.trunc(raw + (FULL - raw) * factor * PERCENT_SCALE + ROUND_HIGH);
}

export interface PbiTransition {
  readonly done: boolean;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export function pbiTransition(
  start: { readonly x: number; readonly y: number },
  origin: { readonly x: number; readonly y: number },
  elapsedMs: number,
): PbiTransition {
  const p = gravityPercentage(elapsedMs);
  const endX = origin.x + PBI_END_X;
  const endY = origin.y + PBI_END_Y;
  const left = start.x - idiv((start.x - endX + 1) * p, FULL);
  const top = start.y > endY ? start.y - idiv((start.y - endY + 1) * p, FULL) : start.y + idiv((endY - start.y + 1) * p, FULL);
  return {
    done: p >= FULL,
    rect: {
      x: u16(left - idiv(PBI_WIDTH * p, 2 * FULL)),
      y: u16(top - idiv(PBI_HEIGHT * p, 2 * FULL)),
      width: u16(Math.max(1, idiv(PBI_WIDTH * p, FULL))),
      height: u16(Math.max(1, idiv(PBI_HEIGHT * p, FULL))),
    },
  };
}

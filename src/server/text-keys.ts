// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc GetMoraleString, CanCharacterMoveInStrategic, Map_Screen_Interface.h
// @src MoveError; Strategic/PreBattle_Interface.cc GetSoldierConditionInfo; Tactical/Interface_Dialogue.cc (talk menu,
// @src zDealerStrings by dealer type); Tactical/Interface.cc (pAssignmentStrings by bAssignment). See docs/27 §5.2.
// @src Refusal messages: Points.cc EnoughPoints (NOT_ENOUGH_APS_STR), Turn_Based_Input.cc / Handle_UI.cc (NO_PATH,
// @src MERC_IS_UNAVAILABLE_STR, NOBODY_USING_REMOTE_STR, STR_LATE_04), Weapons.cc (STR_NOT_BURST_CAPABLE), Handle_UI.cc
// @src (MSG_CANT_FIRE_HERE), Assignments.cc CanCharacterSquad / CanCharacterSleep / CanCharacterBeAwakened / militia
// @src training checks, MapScreen.cc TellPlayerWhyHeCantCompressTime. See docs/28 §12.2.

import { type UiStrings, uiString } from '../content/text/strings.ts';
import type { PlayerView, StrategicMercView } from '../protocol/view.ts';
import { Assignment } from '../sim/strategic/economy/constants.ts';
import type { ShopKind } from '../sim/strategic/economy/merchants/view.ts';
import type { MoveRefusal } from '../sim/strategic/forces/move-permission.ts';
import type { SoldierCondition } from '../sim/tactical/health.ts';
import type { MoraleText } from './contract-view.ts';

export interface UiTextKey {
  readonly table: string;
  readonly index: number;
}

export type RefusalShown = 'log' | 'box';

export interface RefusalMessage extends UiTextKey {
  readonly shown: RefusalShown;
}

const MORALE: Readonly<Record<MoraleText, number>> = { great: 0, good: 1, stable: 2, poor: 3, panic: 4, bad: 5 };
const CONDITION: Readonly<Record<SoldierCondition, number>> = {
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
const TALK_MENU: Readonly<Record<string, number>> = { repeat: 0, friendly: 1, direct: 2, threaten: 3, give: 4, recruit: 5 };
const SHOP_KIND: Readonly<Record<ShopKind, number>> = { buySell: 0, buy: 1, sell: 2, repair: 3 };
const MOVE_REFUSAL: Partial<Readonly<Record<MoveRefusal, number>>> = {
  underground: 1,
  enemiesPresent: 2,
  onAssignment: 3,
  prisoner: 5,
  inTransit: 8,
  inCombat: 11,
  vehicleEmpty: 32,
  tooInjured: 33,
  dead: 35,
  tooTired: 43,
  vehicleDamaged: 47,
  robotAlone: 49,
  cannotLeaveSector: 29,
};
const log = (table: string, index: number): RefusalMessage => ({ table, index, shown: 'log' });
const box = (table: string, index: number): RefusalMessage => ({ table, index, shown: 'box' });
const NOT_ENOUGH_APS = log('TacticalStr', 87);

export const REFUSAL_MESSAGES: Readonly<Record<string, RefusalMessage>> = {
  notEnoughAP: NOT_ENOUGH_APS,
  notEnoughAp: NOT_ENOUGH_APS,
  noPath: log('TacticalStr', 114),
  mercUnavailable: log('TacticalStr', 82),
  uncontrolledRobot: log('TacticalStr', 88),
  outOfBreath: log('gzLateLocalizedString', 3),
  noBurst: log('Message', 34),
  noRoomToFire: log('pMessageStrings', 34),
  ...Object.fromEntries(Object.entries(MOVE_REFUSAL).map(([token, index]) => [token, box('pMapErrorString', index ?? 0)])),
  notEligible: box('pMapErrorString', 18),
  squadFull: box('pMapErrorString', 19),
  squadElsewhere: box('pMapErrorString', 20),
  squadMoving: box('pMapErrorString', 36),
  squadHasVehicle: box('pMapErrorString', 37),
  cannotJoinSquad: box('pMapErrorString', 38),
  loyaltyTooLow: box('zMarksMapScreenText', 19),
  militiaFull: box('zMarksMapScreenText', 20),
  tooManyTrainers: box('gzLateLocalizedString', 46),
  walking: box('zMarksMapScreenText', 5),
  driving: box('zMarksMapScreenText', 7),
  sectorNotCleared: box('Message', 44),
  notTired: box('zMarksMapScreenText', 4),
  collapsed: box('zMarksMapScreenText', 6),
  noMercsHired: box('pMapScreenJustStartedHelpText', 0),
  noUsableMercs: box('pMapErrorString', 39),
  creatureMine: box('gzLateLocalizedString', 27),
};

const TRADE_MENU_PREFIX = 'buySell:';
const ASSIGNMENT_COUNT = Assignment.ASSIGNMENT_EMPTY + 1;

function group(prefix: string, table: string, indices: Readonly<Record<string, number | undefined>>): [string, UiTextKey][] {
  return Object.entries(indices).flatMap(([token, index]) => (index === undefined ? [] : [[`${prefix}.${token}`, { table, index }]]));
}

function assignments(): [string, UiTextKey][] {
  return Array.from({ length: ASSIGNMENT_COUNT }, (_, index) => [`assignment.${index}`, { table: 'pAssignmentStrings', index }]);
}

export const TEXT_KEYS: Readonly<Record<string, UiTextKey>> = Object.fromEntries([
  ...group('morale', 'pMoralStrings', MORALE),
  ...group('condition', 'pConditionStrings', CONDITION),
  ...group('talkMenu', 'zTalkMenuStrings', TALK_MENU),
  ...group('shopKind', 'zDealerStrings', SHOP_KIND),
  ...group('moveRefusal', 'pMapErrorString', MOVE_REFUSAL),
  ...assignments(),
  ...Object.entries(REFUSAL_MESSAGES).map(([token, m]): [string, UiTextKey] => [`refusal.${token}`, { table: m.table, index: m.index }]),
]);

export function refusalMessage(token: string): RefusalMessage | null {
  return REFUSAL_MESSAGES[token] ?? null;
}

export function textKeyFor(token: string): UiTextKey | null {
  return TEXT_KEYS[token] ?? null;
}

export function talkMenuTextKey(entry: string): UiTextKey | null {
  return entry.startsWith(TRADE_MENU_PREFIX)
    ? textKeyFor(`shopKind.${entry.slice(TRADE_MENU_PREFIX.length)}`)
    : textKeyFor(`talkMenu.${entry}`);
}

export function uiLabel(strings: UiStrings, key: UiTextKey | null): string | null {
  return key ? uiString(strings, key.table, key.index) : null;
}

function mercLabels(m: StrategicMercView, strings: UiStrings): Record<string, unknown> {
  const morale = m.moraleText ? uiLabel(strings, textKeyFor(`morale.${m.moraleText}`)) : null;
  return {
    ...m,
    ...(morale !== null ? { moraleLabel: morale } : {}),
    assignmentLabel: uiLabel(strings, textKeyFor(`assignment.${m.assignment}`)),
  };
}

export function labelledView(view: PlayerView, strings: UiStrings): Record<string, unknown> {
  const { strategic, conversation, shop } = view;
  const labels: Record<string, unknown> = {};
  if (strategic) labels.strategic = { ...strategic, mercs: strategic.mercs.map((m) => mercLabels(m, strings)) };
  if (conversation)
    labels.conversation = { ...conversation, menuLabels: conversation.menu.map((e) => uiLabel(strings, talkMenuTextKey(e))) };
  if (shop) labels.shop = { ...shop, kindLabel: uiLabel(strings, textKeyFor(`shopKind.${shop.kind}`)) };
  return { ...view, ...labels };
}

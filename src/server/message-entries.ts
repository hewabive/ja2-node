// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Message.cc ScreenMsg, TacticalScreenMsg, MapScreenMessage (the priorities, INTERFACE_COLOR,
// @src DIALOGUE_COLOR, the 256-line ring); the ScreenMsg sites of Tactical/OppList.cc (noises), Overhead.cc (enemy in
// @src sector, first aid), TeamTurns.cc (interrupt), Campaign.cc (stat gains), Items.cc (reload), Handle_Doors.cc and
// @src Keys.cc (locks and traps), Interface_Dialogue.cc and TacticalAI/NPC.cc (recruits, escorts, balances),
// @src Merc_Hiring.cc (arrivals), Laptop/History.cc, Strategic_Merc_Handler.cc (deaths, unpaid RPCs, worn-off camouflage),
// @src Map_Screen_Interface.cc (equipment left, invasions), Map_Screen_Helicopter.cc (Skyrider's bill), Assignments.cc
// @src (repairs, aborted assignments), Handle_Items.cc HandleItem (the quoted GUN_GOT_FINGERPRINT),
// @src Strategic_Movement.cc (MSG_ARRIVE), SaveLoadGame.cc (game saved), Soldier_Control.cc (refused first aid),
// @src Dialogue_Control.cc and Civ_Quotes.cc (dialogue lines); Turn_Based_Input.cc ToggleStealthMode
// @src and the ALT+z squad stealth, Interface_Panels.cc BtnMuteCallback, Handle_UI.cc HandleMultiSelectionMove
// @src (NO_PATH_FOR_MERC), TileEngine/Physics.cc DoCatchObject (MSG_MERC_CAUGHT_ITEM). Refusals the original reports with MSG_UI_FEEDBACK enter the log and open the feedback box.

import { GAME_SAVED_MESSAGE, type MessageArg, type MessageEntry, type MessageKind } from '../protocol/message-log.ts';
import type { CommandEnvelope } from '../protocol/messages.ts';
import type { CommandResult } from '../sim/command.ts';
import type { SimEvent } from '../sim/events.ts';
import { refusalMessage } from './text-keys.ts';

export interface MessageFacts {
  soldierName(id: number): string | null;
  soldierTeam(id: number): number | null;
  soldierProfile(id: number): number | null;
  soldierVisible(id: number): boolean;
  profileName(profile: number): string | null;
  itemIndex(name: string): number | null;
}

export const NO_MESSAGE_FACTS: MessageFacts = {
  soldierName: () => null,
  soldierTeam: () => null,
  soldierProfile: () => null,
  soldierVisible: () => false,
  profileName: () => null,
  itemIndex: () => null,
};

const FONT_YELLOW = 145;
const FONT_WHITE = 208;
const FONT_MCOLOR_LTYELLOW = 144;
const FONT_RED = 163;
const OUR_TEAM = 0;
const CIV_TEAM = 4;
const NOISE_LINES = 11;
const STAT_GAIN_ORDER = [
  'lifeMax',
  'agility',
  'dexterity',
  'wisdom',
  'medical',
  'explosives',
  'mechanical',
  'marksmanship',
  'experience',
  'strength',
  'leadership',
];
const PRE_STAT_LOST = 0;
const PRE_STAT_GAINED = 1;
const PRE_STAT_POINT = 2;
const PRE_STAT_POINTS = 3;
const PRE_STAT_LEVEL_OFFSET = 2;
const TRAP_STRINGS: Readonly<Record<string, number>> = { none: 0, explosion: 1, electric: 2, siren: 3, silentAlarm: 4 };
const SILENT_TRAP = 'silentAlarm';
const NO_LOCK_ACTIONS: ReadonlySet<string> = new Set(['force', 'crowbar', 'explode', 'pickLock', 'examine', 'untrap', 'lock']);
const ABORT_LINES: Readonly<Record<string, number>> = {
  noMedkits: 39,
  insufficientDoctorSkill: 40,
  noToolkits: 41,
  insufficientRepairSkill: 42,
};
const SQUAD_ON_STEALTH = 44;
const SQUAD_OFF_STEALTH = 45;
const MERC_CAUGHT_ITEM = 29;
const MERC_ON_STEALTH = 46;
const MERC_OFF_STEALTH = 47;
const MUTE_OFF = 64;
const MUTE_ON = 65;
const NO_PATH_FOR_MERC = 130;
const GUN_GOT_FINGERPRINT = 111;
const STR_CAMO_WORN_OFF = 30;
const NPC_MESSAGES: Readonly<Record<string, { readonly kind: MessageKind; readonly table: string; readonly index: number }>> = {
  teamFull: { kind: 'uiFeedback', table: 'TacticalStr', index: 35 },
  recruited: { kind: 'interface', table: 'TacticalStr', index: 36 },
  nowEscorted: { kind: 'interface', table: 'TacticalStr', index: 42 },
  balanceOwed: { kind: 'interface', table: 'TacticalStr', index: 37 },
  needsMoney: { kind: 'interface', table: 'Message', index: 45 },
  itemPlacedOnGround: { kind: 'interface', table: 'TacticalStr', index: 17 },
  vehicleRefuelled: { kind: 'uiFeedback', table: 'gzLateLocalizedString', index: 49 },
};

type Build = (e: never, facts: MessageFacts) => readonly Omit<MessageEntry, 'tick'>[];
type EventOf<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

const text = (value: string | null): MessageArg => ({ text: value ?? '' });
const ref = (table: string, index: number): MessageArg => ({ string: { table, index } });

function line(table: string, index: number, args: readonly MessageArg[] = [], kind: MessageKind = 'interface'): Omit<MessageEntry, 'tick'> {
  return { kind, colour: colourOf(kind, FONT_MCOLOR_LTYELLOW), table, index, ...(args.length > 0 ? { args } : {}) };
}

function colourOf(kind: MessageKind, passed: number): number {
  if (kind === 'interface') return FONT_YELLOW;
  if (kind === 'dialog') return FONT_WHITE;
  return passed;
}

function dialogue(speaker: number | null, key: MessageEntry['textKey']): Omit<MessageEntry, 'tick'>[] {
  if (!key) return [];
  return [{ kind: 'dialog', colour: FONT_WHITE, textKey: key, ...(speaker !== null ? { speaker } : {}) }];
}

function noiseDirection(direction: EventOf<'noiseHeard'>['direction']): MessageArg {
  if (direction === 'above') return ref('gzLateLocalizedString', 5);
  if (direction === 'below') return ref('gzLateLocalizedString', 6);
  return ref('pDirectionStr', direction);
}

function statGain(e: EventOf<'statChanged'>, facts: MessageFacts): Omit<MessageEntry, 'tick'>[] {
  const stat = STAT_GAIN_ORDER.indexOf(e.stat);
  if (stat < 0 || e.change === 0 || facts.soldierTeam(e.soldier) !== OUR_TEAM) return [];
  const amount = Math.abs(e.change);
  const unit = (amount === 1 ? PRE_STAT_POINT : PRE_STAT_POINTS) + (e.stat === 'experience' ? PRE_STAT_LEVEL_OFFSET : 0);
  const args = [
    text(facts.soldierName(e.soldier)),
    ref('sPreStatBuildString', e.change > 0 ? PRE_STAT_GAINED : PRE_STAT_LOST),
    { number: amount },
    ref('sPreStatBuildString', unit),
    ref('sStatGainStrings', stat),
  ];
  return [{ kind: 'interface', colour: FONT_YELLOW, args }];
}

function doorResult(e: EventOf<'doorResult'>, facts: MessageFacts): Omit<MessageEntry, 'tick'>[] {
  const trap = (name: string | undefined) => ref('pDoorTrapStrings', TRAP_STRINGS[name ?? 'none'] ?? 0);
  switch (e.result) {
    case 'noLock':
      return NO_LOCK_ACTIONS.has(e.action) ? [line('TacticalStr', 4)] : [];
    case 'trapFound':
    case 'trapNoticed':
      return [line('TacticalStr', 3, [trap(e.trap)])];
    case 'noTrapFound':
      return [line('TacticalStr', 5)];
    case 'notTrapped':
      return [line('TacticalStr', 7)];
    case 'locked':
      return e.action === 'lock' ? [line('TacticalStr', 8)] : [];
    case 'wrongKey':
      return e.action === 'lock' ? [line('TacticalStr', 6, [text(facts.soldierName(e.soldier))])] : [];
    default:
      return [];
  }
}

function soldierDied(e: EventOf<'soldierDied'>, facts: MessageFacts): Omit<MessageEntry, 'tick'>[] {
  const team = facts.soldierTeam(e.soldier);
  const name = text(facts.soldierName(e.soldier));
  if (team === OUR_TEAM) return [{ kind: 'skullFeedback', colour: FONT_RED, table: 'pMercDeadString', index: 0, args: [name] }];
  if (team === CIV_TEAM && facts.soldierProfile(e.soldier) !== null && facts.soldierVisible(e.soldier))
    return [line('pMercDeadString', 0, [name])];
  return [];
}

function npcMessage(e: EventOf<'npcMessage'>, facts: MessageFacts): Omit<MessageEntry, 'tick'>[] {
  const known = NPC_MESSAGES[e.kind];
  if (!known) return [];
  const name = e.profile !== undefined ? text(facts.profileName(e.profile)) : null;
  const item = e.item !== undefined ? facts.itemIndex(e.item) : null;
  switch (e.kind) {
    case 'recruited':
      return [line(known.table, known.index, name ? [name] : [], known.kind)];
    case 'nowEscorted':
    case 'balanceOwed':
      return [line(known.table, known.index, [...(name ? [name] : []), { number: e.amount ?? 0 }], known.kind)];
    case 'needsMoney':
      return [line(known.table, known.index, [...(name ? [name] : []), { text: `$${e.amount ?? 0}` }], known.kind)];
    case 'itemPlacedOnGround':
      return item === null ? [] : [line(known.table, known.index, [{ item, name: 'short' }], known.kind)];
    default:
      return [line(known.table, known.index, [], known.kind)];
  }
}

function groupArrived(e: EventOf<'groupArrived'>, facts: MessageFacts): Omit<MessageEntry, 'tick'>[] {
  if (!e.final || e.sector.includes('-')) return [];
  const who =
    e.who.kind === 'merc'
      ? text(facts.soldierName(e.who.soldier))
      : e.who.kind === 'squad'
        ? ref('pAssignmentStrings', e.who.squad)
        : ref('pVehicleStrings', e.who.vehicleType);
  const row = e.sector.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
  const column = Number(e.sector.slice(1));
  return [line('pMessageStrings', 22, [who, ref('pMapVertIndex', row), ref('pMapHortIndex', column)])];
}

const BUILDERS: { readonly [T in SimEvent['type']]?: (e: EventOf<T>, facts: MessageFacts) => readonly Omit<MessageEntry, 'tick'>[] } = {
  noiseHeard: (e, facts) =>
    e.kind < NOISE_LINES
      ? [
          line('pNewNoiseStr', e.kind, [
            text(facts.soldierName(e.listener)),
            ref('pNoiseVolStr', e.volumeClass),
            noiseDirection(e.direction),
          ]),
        ]
      : [],
  soldierDied,
  enemyPresence: () => [line('TacticalStr', 85)],
  sectorLoaded: (e) => (e.enemyPresence ? [line('TacticalStr', 85)] : []),
  interrupt: (e, facts) =>
    e.team === OUR_TEAM && e.soldiers && e.soldiers.length > 0
      ? [line('Message', 53, [text(e.soldiers.map((id) => facts.soldierName(id) ?? '').join(', '))])]
      : [],
  statChanged: statGain,
  reloaded: (e, facts) => (facts.soldierTeam(e.soldier) === OUR_TEAM ? [line('Message', 11, [text(facts.soldierName(e.soldier))])] : []),
  firstAidDone: (e, facts) => [line('TacticalStr', 83, [text(facts.soldierName(e.patient))])],
  outOfBandages: (e, facts) => [line('TacticalStr', 84, [text(facts.soldierName(e.soldier))])],
  firstAidRefused: () => [line('Message', 55, [], 'uiFeedback')],
  stopped: (e, facts) =>
    e.reason === 'outOfAPs' && facts.soldierTeam(e.soldier) === OUR_TEAM
      ? [line('TacticalStr', 81, [text(facts.soldierName(e.soldier))])]
      : [],
  doorResult,
  doorTrap: (e) => (e.trap === SILENT_TRAP ? [] : [line('TacticalStr', 79, [ref('pDoorTrapStrings', TRAP_STRINGS[e.trap] ?? 0)])]),
  lockDestroyed: () => [line('TacticalStr', 133)],
  npcMessage,
  mercArrived: (e, facts) => [line('TacticalStr', 80, [text(facts.soldierName(e.soldier) ?? facts.profileName(e.profile))])],
  historyAdded: () => [line('pMessageStrings', 67)],
  camoWornOff: (e, facts) => [line('Message', STR_CAMO_WORN_OFF, [text(facts.soldierName(e.soldier))])],
  rpcUnpaid: (e, facts) => [line('pMessageStrings', 60, [text(facts.soldierName(e.soldier)), { money: e.amount }])],
  heliPaid: (e) => [line('pSkyriderText', 0, [{ number: e.amount }])],
  heliOwed: (e) => [line('pSkyriderText', 1, [{ number: e.amount }])],
  itemRepaired: (e, facts) =>
    e.repairer === e.owner
      ? [line('Message', 52, [text(facts.soldierName(e.repairer)), { item: e.item, name: 'long' }])]
      : [
          line('gzLateLocalizedString', 34, [
            text(facts.soldierName(e.repairer)),
            text(facts.soldierName(e.owner)),
            { item: e.item, name: 'long' },
          ]),
        ],
  gunUnjammed: (e, facts) =>
    e.repairer === e.owner
      ? [line('gzLateLocalizedString', 52, [text(facts.soldierName(e.repairer)), { item: e.item, name: 'long' }])]
      : [
          line('gzLateLocalizedString', 53, [
            text(facts.soldierName(e.repairer)),
            text(facts.soldierName(e.owner)),
            { item: e.item, name: 'long' },
          ]),
        ],
  assignmentAborted: (e, facts) => {
    const index = ABORT_LINES[e.reason];
    return index === undefined ? [] : [line('gzLateLocalizedString', index, [text(facts.soldierName(e.soldier))])];
  },
  groupArrived,
  invasion: (e) => (e.kind === 'other' ? [line('pMapErrorString', 24, [{ text: e.sector }])] : []),
  npcQuote: (e) => dialogue(e.profile, e.textKey),
  mercQuote: (e) => dialogue(e.profile, e.textKey),
  headMinerQuote: (e) => dialogue(e.profile, e.textKey),
  skyriderQuote: (e) => dialogue(e.profile ?? null, e.textKey),
  civQuote: (e) => (e.hint ? dialogue(null, e.textKey) : []),
  stealthChanged: (e, facts) => [line('pMessageStrings', e.on ? MERC_ON_STEALTH : MERC_OFF_STEALTH, [text(facts.soldierName(e.soldier))])],
  squadStealthChanged: (e) => [line('pMessageStrings', e.on ? SQUAD_ON_STEALTH : SQUAD_OFF_STEALTH)],
  muteChanged: (e, facts) => [line('TacticalStr', e.on ? MUTE_ON : MUTE_OFF, [text(facts.soldierName(e.soldier))])],
  noPathForMerc: (e, facts) => [line('TacticalStr', NO_PATH_FOR_MERC, [text(facts.soldierName(e.soldier))])],
  gunImprint: (e) => (e.result === 'imprinted' ? [{ ...line('TacticalStr', GUN_GOT_FINGERPRINT), quoted: true }] : []),
  itemCaught: (e, facts) => [
    line('pMessageStrings', MERC_CAUGHT_ITEM, [text(facts.soldierName(e.soldier)), { item: e.item, name: 'short' }]),
  ],
};

export function messageEntriesOf(events: readonly SimEvent[], facts: MessageFacts): MessageEntry[] {
  const entries: MessageEntry[] = [];
  for (const e of events) {
    const build = BUILDERS[e.type] as Build | undefined;
    if (!build) continue;
    for (const entry of build(e as never, facts)) entries.push({ tick: e.tick, ...entry });
  }
  return entries;
}

export function gameSavedEntry(tick: number): MessageEntry {
  return { tick, ...line(GAME_SAVED_MESSAGE.table, GAME_SAVED_MESSAGE.index) };
}

const REFUSALS_NAMING_THE_MERC: ReadonlySet<string> = new Set(['mercUnavailable', 'outOfBreath', 'noBurst']);

function refusalArgs(token: string, cmd: CommandEnvelope, facts: MessageFacts): MessageArg[] {
  const soldier = typeof cmd.soldier === 'number' ? cmd.soldier : null;
  return REFUSALS_NAMING_THE_MERC.has(token) && soldier !== null ? [text(facts.soldierName(soldier))] : [];
}

export function refusalEntry(tick: number, cmd: CommandEnvelope, result: CommandResult, facts: MessageFacts): MessageEntry | null {
  if (result.ok) return null;
  const token = (result.data as { readonly refusal?: unknown } | undefined)?.refusal;
  if (typeof token !== 'string') return null;
  const message = refusalMessage(token);
  if (message?.shown !== 'log') return null;
  return { tick, ...line(message.table, message.index, refusalArgs(token, cmd, facts), 'uiFeedback') };
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Merc_Hiring.cc HireMerc (the contract fields), MercArrivesCallback (status, contract end,
// @src equipment complaint), HandleMercArrivesQuotes, SpeaksForItsVoice; MercArrivesCallback's QUOTE_MERC_REACHED_DESTINATION
// @src under bMercArrivingQuoteBeingUsed and gfFirstHeliRun, with DialogueEventUnsetArrivesFlag (2026-11-08).

import { i8, u8, u32 } from '../../../core/int.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { InsertionCode } from '../../strategic/forces/constants.ts';
import { Quest } from '../../strategic/narrative/fact-ids.ts';
import { QuestStatus, questStatus } from '../../strategic/narrative/facts.ts';
import { EventKind, FIRST_ARRIVAL_DELAY, NUM_SEC_IN_MIN, STARTING_TIME } from '../../strategic/time/constants.ts';
import { addSameDayStrategicEvent } from '../../strategic/time/event-queue.ts';
import { worldDay, worldMinutesInDay, worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import { MercStatus } from '../../tactical/profiles.ts';
import { profileVoice } from '../laptop/laptop-state.ts';
import { HatedSlot, whichHated } from '../relations/relations.ts';
import { MercKind, type RosterMerc } from '../roster.ts';
import type { ContractContext } from './context.ts';
import { ContractLength } from './contract-state.ts';
import { contractEndAtArrival, contractEndAtHire, mercArrivalTimeOfDay } from './contract-times.ts';
import { soldierHasWorseEquipmentThanUsedTo } from './daily.ts';
import type { QuoteName } from './quotes.ts';

const FIRST_ARRIVAL_MINUTE = (STARTING_TIME + FIRST_ARRIVAL_DELAY) / NUM_SEC_IN_MIN;
const HISTORY_HIRED_MERC_FROM_MERC = 2;
const ARRIVAL_COMPLAINT_FROM = 540;
const ARRIVAL_COMPLAINT_SPREAD = 660;
const TWO_WEEKS = 14;
const CONTRACT_TYPES: Readonly<Record<number, number>> = {
  1: ContractLength.EXTEND_1_DAY,
  7: ContractLength.EXTEND_1_WEEK,
  [TWO_WEEKS]: ContractLength.EXTEND_2_WEEK,
};
const HATED_ARRIVES: Readonly<Record<number, QuoteName>> = {
  [HatedSlot.SLOT1]: 'HATED_1_ARRIVES',
  [HatedSlot.SLOT2]: 'HATED_2_ARRIVES',
};

export function hireContract(ctx: ContractContext, m: RosterMerc, length: number): number {
  const s = ctx.state;
  const now = worldTotalMinutes(s.clock);
  const c = m.contract;
  const p = ctx.profile(m.profile);
  if (p) p.mercStatus = i8(u8(length));
  c.totalContractLength = length;
  c.startOfInsuranceContract = 0;
  c.totalLengthOfInsuranceContract = 0;
  c.timeWillArrive = u32(mercArrivalTimeOfDay(now));
  const justStarted = s.didGameJustStart;
  const arrival = justStarted ? FIRST_ARRIVAL_MINUTE : c.timeWillArrive;
  c.contractEnd = contractEndAtHire(now, length, c.timeWillArrive, justStarted);
  if (arrival !== 0 && p) p.mercStatus = MercStatus.HIRED_BUT_NOT_ARRIVED_YET;
  if (m.kind === MercKind.AIM_MERC) {
    const type = CONTRACT_TYPES[length];
    if (type !== undefined) {
      c.typeOfLastContract = type;
      c.timeCanSignElsewhere = length === TWO_WEEKS ? c.contractEnd : now;
    }
    c.medicalDeposit = p?.medicalDepositAmount ?? 0;
  } else if (m.kind === MercKind.MERC) {
    if (p) p.mercMercContractLength = 1;
    c.contractStartDay = worldDay(s.clock);
    ctx.history(HISTORY_HIRED_MERC_FROM_MERC, m.profile, null);
  }
  return arrival;
}

function speaksForItsVoice(ctx: ContractContext, s: RosterMerc): boolean {
  const imp = ctx.state.laptop.imp;
  const voice = profileVoice(imp, s.profile);
  for (const other of ctx.team()) {
    if (other === s || other.assignment === Assignment.IN_TRANSIT) continue;
    if (profileVoice(imp, other.profile) !== voice) continue;
    if (other.profile < s.profile) return false;
  }
  return true;
}

function saysDroppedInOmerta(ctx: ContractContext, arrived: RosterMerc): boolean {
  return (
    arrived.kind === MercKind.PLAYER_CHARACTER &&
    questStatus(ctx.state.narrative, Quest.DELIVER_LETTER) === QuestStatus.IN_PROGRESS &&
    speaksForItsVoice(ctx, arrived)
  );
}

export function handleMercArrivesQuotes(ctx: ContractContext, arrived: RosterMerc): void {
  if (arrived.insertionCode === InsertionCode.CHOPPER) return;
  if (saysDroppedInOmerta(ctx, arrived)) ctx.say(arrived, 'PC_DROPPED_OMERTA');
  for (const other of ctx.team()) {
    if (other.kind !== MercKind.AIM_MERC) continue;
    const p = ctx.profile(other.profile);
    const quote = p ? HATED_ARRIVES[whichHated(p, arrived.profile)] : undefined;
    if (quote) ctx.say(other, quote, arrived.profile);
  }
}

function mercArrivingQuoteFree(ctx: ContractContext): boolean {
  return !ctx.state.talk.dialogue.mercArrivingQuoteBeingUsed && !ctx.state.sectorFlow.helicopterDrop.firstHeliRun;
}

function sayReachedDestination(ctx: ContractContext, arrived: RosterMerc): void {
  if (arrived.insertionCode === InsertionCode.CHOPPER || !mercArrivingQuoteFree(ctx)) return;
  ctx.state.talk.dialogue.mercArrivingQuoteBeingUsed = true;
  ctx.say(arrived, 'MERC_REACHED_DESTINATION');
  ctx.queueMercArrivingQuoteRelease();
}

export function releaseMercArrivingQuote(ctx: Pick<ContractContext, 'state'>): void {
  ctx.state.talk.dialogue.mercArrivingQuoteBeingUsed = false;
}

export function mercArrived(ctx: ContractContext, m: RosterMerc): void {
  sayReachedDestination(ctx, m);
  const s = ctx.state;
  const now = worldTotalMinutes(s.clock);
  const c = m.contract;
  const p = ctx.profile(m.profile);
  if (p) p.mercStatus = i8(u8(c.totalContractLength));
  c.lastContractUpdate = now;
  c.contractEnd = contractEndAtArrival(now, c.totalContractLength, c.timeWillArrive);
  if (p && soldierHasWorseEquipmentThanUsedTo(ctx, m, p)) {
    const minute = ARRIVAL_COMPLAINT_FROM + ctx.rng.main.int(ARRIVAL_COMPLAINT_SPREAD);
    if (worldMinutesInDay(s.clock) < minute)
      addSameDayStrategicEvent(s.queue, s.clock, EventKind.MERC_COMPLAIN_EQUIPMENT, minute, m.profile);
  }
  handleMercArrivesQuotes(ctx, m);
}

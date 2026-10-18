// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc BeginRemoveMercFromContract; Strategic/Merc_Contract.cc
// @src NotifyPlayerOfMercDepartureAndPromptEquipmentPlacement, MercDepartEquipmentBoxCallBack, StrategicRemoveMerc,
// @src HandleSoldierLeavingWithLowMorale, HandleSoldierLeavingForAnotherContract, CalculateMedicalDepositRefund;
// @src Strategic/Map_Screen_Interface.cc HandleLeavingOfEquipmentInCurrentSector, HandleMercLeavingEquipment,
// @src SetUpDropItemListForMerc, HandleEquipmentLeft, START_SECTOR_LEAVE_EQUIP_GRIDNO. See docs/22 §4.

import { MercType } from '../../../content/strategic/economy-content.ts';
import { type Sector, sectorFromId, sectorId, sectorShortString } from '../../../content/strategic/sector-ids.ts';
import { idiv, u32 } from '../../../core/int.ts';
import { cloneObject, type ItemObject } from '../../items/object.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { randomGridNo } from '../../strategic/forces/autoresolve/close.ts';
import { InsertionCode } from '../../strategic/forces/constants.ts';
import { getGroup, removeGroup } from '../../strategic/forces/groups.ts';
import { takeSoldierOutOfVehicle } from '../../strategic/forces/vehicles.ts';
import { EventKind, NUM_MIN_IN_HOUR } from '../../strategic/time/constants.ts';
import { addStrategicEvent } from '../../strategic/time/event-queue.ts';
import { CompressionStop, stopTimeCompression, worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import { takeKeyRingObjects } from '../../tactical/doors/keys.ts';
import { findNearestAvailableGridNoForItem } from '../../tactical/item-placement.ts';
import { isProfileDead, MercStatus } from '../../tactical/profiles.ts';
import { NOWHERE, SoldierStatusFlags } from '../../tactical/soldier.ts';
import { addItemToPool, Visibility, WorldItemFlags } from '../../tactical/world-items.ts';
import { addTransaction, FinanceCode } from '../finances.ts';
import { mercThinksHisMoraleIsTooLow, modifyPlayerReputation, Reputation } from '../relations/reputation.ts';
import { MercKind, type RosterMerc } from '../roster.ts';
import { addItemsToUnloadedSector } from '../sector-loot.ts';
import type { ContractContext } from './context.ts';
import type { DepartureCause, DepartureEquipment, PersonnelList } from './events.ts';
import { HistoryCode } from './quotes.ts';
import { endCurrentContractRenewal, willMercRenew } from './renewal.ts';

export const AIRPORT_SECTOR = 28;
export const START_SECTOR_LEAVE_EQUIP_GRIDNO = 4868;
export const PRIMARY_AIRPORT_LEAVE_EQUIP_GRIDNO = 10433;
const LEAVE_EQUIPMENT_DELAY_MINUTES = 6 * NUM_MIN_IN_HOUR;
const DEPART_QUOTE_WINDOW_MINUTES = 48 * NUM_MIN_IN_HOUR;
const EARLY_FIRING_WINDOW_MINUTES = 3 * NUM_MIN_IN_HOUR;
const HANGOVER_DAYS_BASE = 3;
const HANGOVER_DAYS_SPREAD = 4;
const RETURNING_HOME_DAYS_SPREAD = 2;
const ANOTHER_CONTRACT_DAYS_BASE = 6;
const ITEM_SEARCH_RADIUS = 5;
const WIDE_ITEM_SEARCH_RADIUS = 15;
const NO_FREE_SLOT = -1;

export type DepartureChoice = 'here' | 'elsewhere' | 'rehire';

export interface DepartureOptions {
  readonly choices: readonly DepartureChoice[];
  readonly elsewhere: number | null;
}

function enemyControlled(ctx: ContractContext, sector: number): boolean {
  const s = sectorFromId(sector);
  return ctx.state.map.elements[s.x + s.y * 18]?.enemyControlled === true;
}

export function departureOptions(ctx: ContractContext, m: RosterMerc, rehireRequested: boolean): DepartureOptions {
  const rehire = rehireRequested && !m.contract.signedAnotherContract && m.kind === MercKind.AIM_MERC;
  const withRehire = (choices: DepartureChoice[]): DepartureChoice[] => (rehire ? [...choices, 'rehire'] : choices);
  if (ctx.mercType(m.profile) === MercType.RPC) return { choices: withRehire(['here']), elsewhere: null };
  const elsewhere = enemyControlled(ctx, AIRPORT_SECTOR) ? ctx.economy.content.policy.startSector : AIRPORT_SECTOR;
  if (elsewhere === sectorId(m.sector) && m.sector.z === 0) return { choices: withRehire(['here']), elsewhere: null };
  return { choices: withRehire(['here', 'elsewhere']), elsewhere };
}

export function canBeRemovedFromContract(m: RosterMerc): boolean {
  return m.life > 0 && m.assignment !== Assignment.ASSIGNMENT_POW;
}

export function beginRemoveMercFromContract(ctx: ContractContext, m: RosterMerc): void {
  if (!canBeRemovedFromContract(m)) return;
  const sinceArrival = u32(worldTotalMinutes(ctx.state.clock) - m.contract.lastContractUpdate);
  if (m.kind === MercKind.MERC || m.kind === MercKind.NPC) ctx.say(m, 'RESPONSE_TO_MIGUEL_SLASH_QUOTE_MERC_OR_RPC_LETGO');
  else if (m.kind === MercKind.AIM_MERC && willMercRenew(ctx, m, false))
    ctx.say(
      m,
      sinceArrival < DEPART_QUOTE_WINDOW_MINUTES
        ? 'DEPART_COMMET_CONTRACT_NOT_RENEWED_OR_TERMINATED_UNDER_48'
        : 'DEPARTING_COMMENT_CONTRACT_NOT_RENEWED_OR_48_OR_MORE',
    );
  ctx.contracts.pendingEndings.push({ kind: 'departure', soldier: m.id, rehire: true });
  if (sinceArrival >= EARLY_FIRING_WINDOW_MINUTES) return;
  const p = ctx.profile(m.profile);
  if (p) p.daysOfMoraleHangover = HANGOVER_DAYS_BASE + ctx.rng.main.int(HANGOVER_DAYS_SPREAD);
  if (m.kind === MercKind.AIM_MERC) modifyPlayerReputation(ctx.state.status, Reputation.EARLY_FIRING);
}

function inventoryObjects(m: RosterMerc): ItemObject[] {
  return m.soldier.inv.filter((o): o is ItemObject => o !== undefined && o.item !== 0 && o.count > 0);
}

export function handleLeavingOfEquipmentInCurrentSector(ctx: ContractContext, m: RosterMerc, tactical: ContractTactical | null): void {
  const world = ctx.state.worldSector;
  const here = tactical !== null && world !== null && world.x === m.sector.x && world.y === m.sector.y && world.z === m.sector.z;
  const main = ctx.rng.main;
  let gridNo: number;
  if (here && tactical) {
    gridNo = m.soldier.gridNo;
    if (gridNo === NOWHERE) {
      gridNo = randomGridNo(main);
      let near = findNearestAvailableGridNoForItem(tactical.state, gridNo, ITEM_SEARCH_RADIUS);
      if (near === NOWHERE) near = findNearestAvailableGridNoForItem(tactical.state, gridNo, WIDE_ITEM_SEARCH_RADIUS);
      if (near !== NOWHERE) gridNo = near;
    }
  } else
    gridNo = m.insertionCode === InsertionCode.GRIDNO && m.soldier.insertionData !== NOWHERE ? m.soldier.insertionData : randomGridNo(main);
  const keys = takeKeyRingObjects(ctx.content, m.soldier);
  for (const o of [...inventoryObjects(m), ...keys]) {
    const flags = keys.includes(o) ? 0 : WorldItemFlags.REACHABLE;
    if (here && tactical) addItemToPool(tactical.state, gridNo, o, Visibility.VISIBLE, m.soldier.level, flags);
    else
      addItemsToUnloadedSector(
        ctx.state,
        m.sector,
        gridNo,
        [cloneObject(o)],
        m.soldier.level,
        WorldItemFlags.FIND_SWEETSPOT_FROM_GRIDNO | WorldItemFlags.REACHABLE,
        Visibility.VISIBLE,
      );
  }
}

export interface ContractTactical {
  readonly state: Parameters<typeof findNearestAvailableGridNoForItem>[0];
}

function setUpDropItemListForMerc(ctx: ContractContext, m: RosterMerc): number {
  const list = ctx.contracts.leaveList;
  const slot = list.findIndex((s) => s.items === null);
  if (slot === NO_FREE_SLOT) return NO_FREE_SLOT;
  const leave = list[slot];
  if (!leave) return NO_FREE_SLOT;
  for (const o of inventoryObjects(m)) {
    leave.items ??= [];
    leave.items.push(cloneObject(o));
    leave.owner = m.profile;
  }
  for (const key of takeKeyRingObjects(ctx.content, m.soldier)) {
    leave.items ??= [];
    leave.items.push(key);
  }
  const p = ctx.profile(m.profile);
  if (p) {
    p.inventory.fill(0);
    p.inventoryStatus.fill(0);
    p.inventoryCount.fill(0);
  }
  return slot;
}

export function handleMercLeavingEquipment(ctx: ContractContext, m: RosterMerc, inDrassen: boolean): void {
  const slot = setUpDropItemListForMerc(ctx, m);
  if (slot === NO_FREE_SLOT) return;
  const kind = inDrassen ? EventKind.MERC_LEAVE_EQUIP_IN_DRASSEN : EventKind.MERC_LEAVE_EQUIP_IN_OMERTA;
  addStrategicEvent(ctx.state.queue, kind, worldTotalMinutes(ctx.state.clock) + LEAVE_EQUIPMENT_DELAY_MINUTES, slot);
}

export function primaryAirportSector(ctx: ContractContext): Sector {
  return sectorFromId(ctx.economy.content.shipping.primaryDeliverySector);
}

export function primaryAirportUnderPlayerControl(ctx: ContractContext): boolean {
  return !enemyControlled(ctx, ctx.economy.content.shipping.primaryDeliverySector);
}

export function handleEquipmentLeft(
  ctx: ContractContext,
  slot: number,
  sector: Sector,
  gridNo: number,
  tactical: ContractTactical | null,
): void {
  const leave = ctx.contracts.leaveList[slot];
  if (!leave) return;
  const items = leave.items;
  if (items) {
    ctx.emit({ type: 'equipmentDelivered', sector: sectorShortString(sector), owner: leave.owner, items: items.length });
    const world = ctx.state.worldSector;
    const loaded = tactical !== null && world !== null && world.x === sector.x && world.y === sector.y && world.z === sector.z;
    for (const o of items) {
      if (loaded && tactical) addItemToPool(tactical.state, gridNo, o, Visibility.VISIBLE, 0, WorldItemFlags.REACHABLE);
      else addItemsToUnloadedSector(ctx.state, sector, gridNo, [o], 0, WorldItemFlags.REACHABLE, Visibility.VISIBLE);
    }
  }
  leave.items = null;
}

function personnelList(m: RosterMerc): PersonnelList {
  if (m.life <= 0) return 'dead';
  if (m.contract.leaveHistoryCode === HistoryCode.MERC_FIRED || m.assignment === Assignment.ASSIGNMENT_POW) return 'fired';
  return 'other';
}

function departureCause(m: RosterMerc): DepartureCause {
  if (m.life <= 0) return 'dead';
  if (m.assignment === Assignment.ASSIGNMENT_POW) return 'pow';
  switch (m.contract.leaveHistoryCode) {
    case HistoryCode.MERC_FIRED:
      return 'fired';
    case HistoryCode.MERC_QUIT:
      return 'quit';
    case HistoryCode.MERC_CONTRACT_EXPIRED:
      return 'contractExpired';
    default:
      return 'other';
  }
}

export function calculateMedicalDepositRefund(ctx: ContractContext, m: RosterMerc): number | undefined {
  const p = ctx.profile(m.profile);
  if (!p?.medicalDeposit) return undefined;
  const now = worldTotalMinutes(ctx.state.clock);
  const deposit = m.contract.medicalDeposit;
  if (m.life === m.lifeMax) {
    addTransaction(ctx.state.finances, FinanceCode.FULL_MEDICAL_REFUND, m.profile, now, deposit);
    ctx.emit({ type: 'mailDue', mail: 'medicalDepositRefund', profile: m.profile, amount: deposit });
    return deposit;
  }
  if (m.life > 0) {
    const refund = idiv(idiv(2 * deposit * m.life, m.lifeMax) + 1, 2);
    addTransaction(ctx.state.finances, FinanceCode.PARTIAL_MEDICAL_REFUND, m.profile, now, refund);
    ctx.emit({ type: 'mailDue', mail: 'medicalDepositPartialRefund', profile: m.profile, amount: refund });
    return refund;
  }
  ctx.emit({ type: 'mailDue', mail: 'medicalDepositNoRefund', profile: m.profile, amount: deposit });
  return 0;
}

function leaveMovementGroup(ctx: ContractContext, m: RosterMerc): void {
  if (m.assignment < Assignment.ON_DUTY || !m.groupId) return;
  if (m.assignment === Assignment.VEHICLE) {
    takeSoldierOutOfVehicle(ctx.economy, m.id);
    return;
  }
  const g = getGroup(ctx.economy, m.groupId);
  if (g) removeGroup(ctx.economy, g);
}

function updateProfileForDeparture(ctx: ContractContext, m: RosterMerc): void {
  const p = ctx.profile(m.profile);
  if (!p || isProfileDead(p)) return;
  const main = ctx.rng.main;
  p.mercStatus = MercStatus.RETURNING_HOME;
  p.dayBecomesAvailable = 1 + main.int(RETURNING_HOME_DAYS_SPREAD);
  if (mercThinksHisMoraleIsTooLow(p, m.soldier.morale)) p.daysOfMoraleHangover = HANGOVER_DAYS_BASE + main.int(HANGOVER_DAYS_SPREAD);
  if (!m.contract.signedAnotherContract) return;
  p.mercStatus = MercStatus.WORKING_ELSEWHERE;
  p.dayBecomesAvailable = u32(
    p.dayBecomesAvailable + 1 + main.int(ANOTHER_CONTRACT_DAYS_BASE + Math.trunc(m.soldier.stats.experience / 2)),
  );
}

export function strategicRemoveMerc(ctx: ContractContext, m: RosterMerc, equipment: DepartureEquipment): void {
  const seq = ctx.contracts.renewal;
  if (seq.fromSequence) endCurrentContractRenewal(seq);
  const c = m.contract;
  if (c.leaveHistoryCode === 0) c.leaveHistoryCode = HistoryCode.MERC_CONTRACT_EXPIRED;
  const history = c.leaveHistoryCode;
  const personnel = personnelList(m);
  const cause = departureCause(m);
  leaveMovementGroup(ctx, m);
  updateProfileForDeparture(ctx, m);
  if (!(m.statusFlags & SoldierStatusFlags.DEAD)) ctx.history(history, m.profile, m.sector);
  let refund: number | undefined;
  if (m.assignment === Assignment.ASSIGNMENT_POW) {
    const p = ctx.profile(m.profile);
    if (p) p.mercStatus = MercStatus.FIRED_AS_A_POW;
  } else refund = calculateMedicalDepositRefund(ctx, m);
  ctx.removeFromWorld(m);
  stopTimeCompression(ctx.clockContext, CompressionStop.MERC_LEFT);
  ctx.emit({
    type: 'mercLeft',
    soldier: m.id,
    profile: m.profile,
    cause,
    history,
    equipment,
    personnel,
    ...(refund !== undefined ? { refund } : {}),
  });
}

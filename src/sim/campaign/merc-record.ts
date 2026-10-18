import type { MercProfile } from '../../content/formats/prof.ts';
import type { Sector } from '../../content/strategic/sector-ids.ts';
import type { Soldier } from '../tactical/soldier.ts';
import { createMercContract, type MercContract } from './contracts/contract-state.ts';

const NO_VEHICLE = -1;

export interface ProfileRecordTraits {
  readonly skillTrait: number;
  readonly skillTrait2: number;
  readonly personalityTrait: number;
  readonly needForSleep: number;
}

export interface MercRecord {
  readonly soldier: Soldier;
  profileRecord: ProfileRecordTraits | null;
  readonly kind: number;
  statusFlags: number;
  sector: Sector;
  betweenSectors: boolean;
  groupId: number;
  prevSectorId: number;
  insertionCode: number;
  insertionDirection: number;
  path: number[];
  assignment: number;
  vehicleId: number;
  asleep: boolean;
  fractLife: number;
  collapsed: boolean;
  forcedToStayAwake: boolean;
  complainedThatTired: boolean;
  nothingToDo: boolean;
  doneQuoteSaid: boolean;
  trainStat: number;
  lastAssignmentChangeMin: number;
  hospitalPriceModifier: number;
  fixingRobot: boolean;
  vehicleUnderRepair: number;
  offGridInSector: boolean;
  readonly contract: MercContract;
  quoteSaidFlags: number;
  quoteSaidExtFlags: number;
  corpseQuoteTolerance: number;
  remoteHolder: number | null;
}

export interface RosterState {
  readonly mercs: Map<number, MercRecord>;
}

export interface MercRecordInit {
  readonly soldier: Soldier;
  readonly profile: MercProfile | null;
  readonly kind: number;
  readonly statusFlags: number;
  readonly sector: Sector;
  readonly betweenSectors: boolean;
  readonly groupId: number;
  readonly prevSectorId: number;
  readonly insertionCode: number;
  readonly insertionDirection: number;
  readonly path: readonly number[];
  readonly assignment: number;
  readonly vehicleId: number;
  readonly asleep: boolean;
  readonly fractLife?: number;
  readonly contract?: Partial<MercContract>;
  readonly quoteSaidFlags?: number;
  readonly quoteSaidExtFlags?: number;
  readonly corpseQuoteTolerance?: number;
  readonly remoteHolder?: number | null;
}

export function createRosterState(): RosterState {
  return { mercs: new Map() };
}

export function profileRecordTraits(profile: MercProfile | null): ProfileRecordTraits | null {
  if (!profile) return null;
  return {
    skillTrait: profile.skillTrait,
    skillTrait2: profile.skillTrait2,
    personalityTrait: profile.personalityTrait,
    needForSleep: profile.needForSleep,
  };
}

export function createMercRecord(init: MercRecordInit): MercRecord {
  return {
    soldier: init.soldier,
    profileRecord: profileRecordTraits(init.profile),
    kind: init.kind,
    statusFlags: init.statusFlags,
    sector: init.sector,
    betweenSectors: init.betweenSectors,
    groupId: init.groupId,
    prevSectorId: init.prevSectorId,
    insertionCode: init.insertionCode,
    insertionDirection: init.insertionDirection,
    path: [...init.path],
    assignment: init.assignment,
    vehicleId: init.vehicleId,
    asleep: init.asleep,
    fractLife: init.fractLife ?? 0,
    collapsed: false,
    forcedToStayAwake: false,
    complainedThatTired: false,
    nothingToDo: false,
    doneQuoteSaid: false,
    trainStat: 0,
    lastAssignmentChangeMin: 0,
    hospitalPriceModifier: 0,
    fixingRobot: false,
    vehicleUnderRepair: NO_VEHICLE,
    offGridInSector: false,
    contract: createMercContract(init.contract),
    quoteSaidFlags: init.quoteSaidFlags ?? 0,
    quoteSaidExtFlags: init.quoteSaidExtFlags ?? 0,
    corpseQuoteTolerance: init.corpseQuoteTolerance ?? 0,
    remoteHolder: init.remoteHolder ?? null,
  };
}

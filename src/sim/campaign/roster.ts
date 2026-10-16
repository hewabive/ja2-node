import type { MercProfile } from '../../content/formats/prof.ts';
import type { Sector } from '../../content/strategic/sector-ids.ts';
import type { ItemObject } from '../items/object.ts';
import type { CrewMember, CrewPort, MercStats, StatDamage } from '../strategic/economy/ports.ts';
import { TravelStat, VehicleRole } from '../strategic/forces/ports.ts';
import type { CombatContext } from '../tactical/combat/context.ts';
import { StatCause, statChange } from '../tactical/combat/experience.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { carriedWeightPercentOf } from '../tactical/points.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import { StatKind } from '../tactical/profiles.ts';
import {
  effectiveAgility,
  effectiveDexterity,
  effectiveExpLevel,
  effectiveExplosive,
  effectiveLeadership,
  effectiveMarksmanship,
  effectiveMechanical,
  effectiveMedical,
  effectiveStrength,
  effectiveWisdom,
} from '../tactical/skills.ts';
import { Body, type Soldier, SoldierStatusFlags } from '../tactical/soldier.ts';
import { createMercContract, type MercContract } from './contracts/contract-state.ts';
import {
  canRobotBeControlled,
  checkForRobotAndIfItsControlled,
  controllingRobot,
  robotControllerInSquad,
  robotControllerInVehicle,
  updateRobotControllerGivenController,
  updateRobotControllerGivenRobot,
} from './robot-control.ts';

export const MercKind = { PLAYER_CHARACTER: 0, AIM_MERC: 1, MERC: 2, NPC: 3, EPC: 4, NPC_UNEXTENDABLE: 5, VEHICLE: 6 } as const;
const NO_VEHICLE = -1;
const NO_ITEM = -1;
const ROBOT_REMOTE_CONTROL = 'ROBOT_REMOTE_CONTROL';

export interface RosterMercInit {
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
  readonly corpseQuoteTolerance?: number;
  readonly remoteHolder?: number | null;
}

export class RosterMerc implements CrewMember {
  readonly soldier: Soldier;
  readonly profileRecord: MercProfile | null;
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
  collapsed = false;
  forcedToStayAwake = false;
  complainedThatTired = false;
  nothingToDo = false;
  doneQuoteSaid = false;
  trainStat = 0;
  lastAssignmentChangeMin = 0;
  hospitalPriceModifier = 0;
  fixingRobot = false;
  vehicleUnderRepair = NO_VEHICLE;
  offGridInSector = false;
  readonly contract: MercContract;
  quoteSaidFlags: number;
  corpseQuoteTolerance: number;
  remoteHolder: number | null;

  constructor(init: RosterMercInit) {
    this.soldier = init.soldier;
    this.profileRecord = init.profile;
    this.kind = init.kind;
    this.statusFlags = init.statusFlags;
    this.sector = init.sector;
    this.betweenSectors = init.betweenSectors;
    this.groupId = init.groupId;
    this.prevSectorId = init.prevSectorId;
    this.insertionCode = init.insertionCode;
    this.insertionDirection = init.insertionDirection;
    this.path = [...init.path];
    this.assignment = init.assignment;
    this.vehicleId = init.vehicleId;
    this.asleep = init.asleep;
    this.fractLife = init.fractLife ?? 0;
    this.contract = createMercContract(init.contract);
    this.quoteSaidFlags = init.quoteSaidFlags ?? 0;
    this.corpseQuoteTolerance = init.corpseQuoteTolerance ?? 0;
    this.remoteHolder = init.remoteHolder ?? null;
  }

  get id(): number {
    return this.soldier.id;
  }

  get profile(): number {
    return this.soldier.profile;
  }

  get life(): number {
    return this.soldier.life;
  }

  set life(value: number) {
    this.soldier.life = value;
  }

  get lifeMax(): number {
    return this.soldier.lifeMax;
  }

  set lifeMax(value: number) {
    this.soldier.lifeMax = value;
  }

  get bleeding(): number {
    return this.soldier.bleeding;
  }

  set bleeding(value: number) {
    this.soldier.bleeding = value;
  }

  get breath(): number {
    return this.soldier.breath;
  }

  set breath(value: number) {
    this.soldier.breath = value;
  }

  get breathMax(): number {
    return this.soldier.breathMax;
  }

  set breathMax(value: number) {
    this.soldier.breathMax = value;
  }

  get strength(): number {
    return this.soldier.stats.strength;
  }

  get inSector(): boolean {
    return this.soldier.placed;
  }

  get stats(): MercStats {
    const s = this.soldier.stats;
    return {
      strength: s.strength,
      dexterity: s.dexterity,
      agility: s.agility,
      wisdom: s.wisdom,
      leadership: s.leadership,
      marksmanship: s.marksmanship,
      mechanical: s.mechanical,
      medical: s.medical,
      explosives: s.explosives,
      expLevel: s.experience,
    };
  }

  get effective(): MercStats {
    const s = this.soldier;
    return {
      strength: effectiveStrength(s),
      dexterity: effectiveDexterity(s),
      agility: effectiveAgility(s),
      wisdom: effectiveWisdom(s),
      leadership: effectiveLeadership(s),
      marksmanship: effectiveMarksmanship(s),
      mechanical: effectiveMechanical(s),
      medical: effectiveMedical(s),
      explosives: effectiveExplosive(s),
      expLevel: effectiveExpLevel(s),
    };
  }

  get statDamage(): StatDamage {
    return this.soldier.statDamage;
  }

  get skillTraits(): readonly number[] {
    return [this.soldier.skillTrait1, this.soldier.skillTrait2];
  }

  get profileTraits(): readonly number[] {
    const p = this.profileRecord;
    return p ? [p.skillTrait, p.skillTrait2] : [0, 0];
  }

  get needForSleep(): number {
    return this.profileRecord?.needForSleep ?? 0;
  }

  get inv(): ItemObject[] {
    return this.soldier.inv;
  }

  get isVehicle(): boolean {
    return (this.statusFlags & SoldierStatusFlags.VEHICLE) !== 0;
  }

  get isRobot(): boolean {
    return this.soldier.bodyType === Body.ROBOTNOWEAPON;
  }

  get isEpc(): boolean {
    return this.kind === MercKind.EPC;
  }

  get isPassengerOrDriver(): boolean {
    return (this.statusFlags & (SoldierStatusFlags.DRIVER | SoldierStatusFlags.PASSENGER)) !== 0;
  }
}

export interface RosterHooks {
  removeFromTacticalSector(merc: RosterMerc): void;
  updateMercInSector(merc: RosterMerc, sector: Sector): void;
  tooTiredToTravel(merc: RosterMerc): boolean;
  collapseFromFatigue(merc: RosterMerc, firstToComplain: boolean): void;
  spendVehicleFuel(vehicle: RosterMerc, fuel: number): number;
  dressWound(doctor: RosterMerc, patient: RosterMerc, kit: ItemObject, kitPoints: number, kitStatus: number): number;
}

export const NO_ROSTER_HOOKS: RosterHooks = {
  removeFromTacticalSector: () => {},
  updateMercInSector: () => {},
  tooTiredToTravel: () => false,
  collapseFromFatigue: () => {},
  spendVehicleFuel: () => 0,
  dressWound: () => 0,
};

export interface RosterSetup {
  readonly content: TacticalContent;
  readonly combat: () => CombatContext;
  readonly hooks?: RosterHooks;
  readonly profiles?: ReadonlyMap<number, ProfileProgress>;
}

const TRAVEL_STATS: Readonly<Record<TravelStat, number>> = {
  [TravelStat.HEALTH]: StatKind.HEALTH,
  [TravelStat.STRENGTH]: StatKind.STRENGTH,
};

export class Roster implements CrewPort {
  readonly #mercs = new Map<number, RosterMerc>();
  readonly #content: TacticalContent;
  readonly #combat: () => CombatContext;
  readonly #profiles: ReadonlyMap<number, ProfileProgress> | null;
  hooks: RosterHooks;

  constructor(setup: RosterSetup) {
    this.#content = setup.content;
    this.#combat = setup.combat;
    this.#profiles = setup.profiles ?? null;
    this.hooks = setup.hooks ?? NO_ROSTER_HOOKS;
  }

  add(merc: RosterMerc): void {
    this.#mercs.set(merc.id, merc);
  }

  remove(id: number): void {
    this.#mercs.delete(id);
  }

  get(id: number): RosterMerc | undefined {
    return this.#mercs.get(id);
  }

  byProfile(profile: number): RosterMerc | undefined {
    return this.all().find((m) => m.profile === profile);
  }

  all(): readonly RosterMerc[] {
    return [...this.#mercs.values()].sort((a, b) => a.id - b.id);
  }

  inSector(sector: Sector): RosterMerc[] {
    return this.all().filter((m) => !m.betweenSectors && m.sector.x === sector.x && m.sector.y === sector.y && m.sector.z === sector.z);
  }

  carriedWeightPercent(id: number): number {
    const merc = this.get(id);
    return merc ? carriedWeightPercentOf(this.#content, merc.soldier) : 0;
  }

  changeAssignment(id: number, assignment: number): void {
    const merc = this.get(id);
    if (merc) merc.assignment = assignment;
  }

  awardTravelExperience(id: number, stat: TravelStat, points: number): void {
    this.statChange(id, TRAVEL_STATS[stat], points, StatCause.SUCCESS);
  }

  removeFromTacticalSector(id: number): void {
    const merc = this.get(id);
    if (!merc) return;
    merc.offGridInSector = false;
    this.hooks.removeFromTacticalSector(merc);
  }

  removeFromGridNo(id: number): void {
    const merc = this.get(id);
    if (!merc?.inSector) return;
    this.hooks.removeFromTacticalSector(merc);
    merc.offGridInSector = true;
  }

  updateMercInSector(id: number, sector: Sector): void {
    const merc = this.get(id);
    if (!merc) return;
    merc.offGridInSector = false;
    this.hooks.updateMercInSector(merc, sector);
  }

  tooTiredToTravel(id: number): boolean {
    const merc = this.get(id);
    return merc ? this.hooks.tooTiredToTravel(merc) : false;
  }

  collapseFromFatigue(id: number, firstToComplain: boolean): void {
    const merc = this.get(id);
    if (merc) this.hooks.collapseFromFatigue(merc, firstToComplain);
  }

  spendVehicleFuel(vehicleSoldierId: number, fuel: number): number {
    const merc = this.get(vehicleSoldierId);
    return merc ? this.hooks.spendVehicleFuel(merc, fuel) : 0;
  }

  statChange(id: number, stat: number, chances: number, cause: number): void {
    const merc = this.get(id);
    if (merc) statChange(this.#combat(), merc.soldier, stat, chances, cause);
  }

  healStat(id: number, stat: keyof StatDamage, points: number): void {
    const merc = this.get(id);
    if (merc) merc.soldier.stats[stat] += points;
  }

  opinion(profile: number, aboutProfile: number): number {
    const campaign = this.#profiles?.get(profile);
    if (campaign) return campaign.opinions[aboutProfile] ?? 0;
    return this.#content.profiles[profile]?.mercOpinion[aboutProfile] ?? 0;
  }

  dressWound(doctor: number, patient: number, kit: ItemObject, kitPoints: number, kitStatus: number): number {
    const d = this.get(doctor);
    const p = this.get(patient);
    return d && p ? this.hooks.dressWound(d, p, kit, kitPoints, kitStatus) : 0;
  }

  setVehicleRole(id: number, role: number): void {
    const merc = this.get(id);
    if (!merc) return;
    merc.statusFlags &= ~(SoldierStatusFlags.DRIVER | SoldierStatusFlags.PASSENGER);
    if (role === VehicleRole.DRIVER) merc.statusFlags |= SoldierStatusFlags.DRIVER;
    else if (role === VehicleRole.PASSENGER) merc.statusFlags |= SoldierStatusFlags.PASSENGER;
  }

  insertionData(id: number): number {
    return this.get(id)?.soldier.insertionData ?? 0;
  }

  setInsertionData(id: number, data: number): void {
    const merc = this.get(id);
    if (merc) merc.soldier.insertionData = data;
  }

  inTacticalSector(id: number): boolean {
    const merc = this.get(id);
    return merc !== undefined && (merc.inSector || merc.offGridInSector);
  }

  get robotRemote(): number {
    return this.#content.items.byName.get(ROBOT_REMOTE_CONTROL)?.index ?? NO_ITEM;
  }

  controllingRobot(id: number): boolean {
    const merc = this.get(id);
    return merc !== undefined && controllingRobot(this, this.robotRemote, merc);
  }

  canRobotBeControlled(id: number): boolean {
    const robot = this.get(id);
    return robot !== undefined && canRobotBeControlled(this, this.robotRemote, robot);
  }

  robotControllerInSquad(squad: number): boolean {
    return robotControllerInSquad(this, this.robotRemote, squad);
  }

  robotControllerInVehicle(vehicleId: number): boolean {
    return robotControllerInVehicle(this, this.robotRemote, vehicleId);
  }

  updateRobotControllerGivenRobot(id: number): void {
    const robot = this.get(id);
    if (robot) updateRobotControllerGivenRobot(this, this.robotRemote, robot);
  }

  updateRobotControllerGivenController(id: number): void {
    const merc = this.get(id);
    if (merc) updateRobotControllerGivenController(this, this.robotRemote, merc);
  }

  checkForRobotAndIfItsControlled(): void {
    checkForRobotAndIfItsControlled(this, this.robotRemote);
  }
}

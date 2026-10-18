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
import { type StatKey, StatKind } from '../tactical/profiles.ts';
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
import type { MercContract } from './contracts/contract-state.ts';
import { type MercRecord, type ProfileRecordTraits, profileRecordTraits, type RosterState } from './merc-record.ts';
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
const NO_ITEM = -1;
const ROBOT_REMOTE_CONTROL = 'ROBOT_REMOTE_CONTROL';

export class RosterMerc implements CrewMember {
  readonly record: MercRecord;

  constructor(record: MercRecord) {
    this.record = record;
  }

  get soldier(): Soldier {
    return this.record.soldier;
  }

  get profileRecord(): ProfileRecordTraits | null {
    return this.record.profileRecord;
  }

  set profileRecord(value: ProfileRecordTraits | null) {
    this.record.profileRecord = value;
  }

  get kind(): number {
    return this.record.kind;
  }

  get statusFlags(): number {
    return this.record.statusFlags;
  }

  set statusFlags(value: number) {
    this.record.statusFlags = value;
  }

  get sector(): Sector {
    return this.record.sector;
  }

  set sector(value: Sector) {
    this.record.sector = value;
  }

  get betweenSectors(): boolean {
    return this.record.betweenSectors;
  }

  set betweenSectors(value: boolean) {
    this.record.betweenSectors = value;
  }

  get groupId(): number {
    return this.record.groupId;
  }

  set groupId(value: number) {
    this.record.groupId = value;
  }

  get prevSectorId(): number {
    return this.record.prevSectorId;
  }

  set prevSectorId(value: number) {
    this.record.prevSectorId = value;
  }

  get insertionCode(): number {
    return this.record.insertionCode;
  }

  set insertionCode(value: number) {
    this.record.insertionCode = value;
  }

  get insertionDirection(): number {
    return this.record.insertionDirection;
  }

  set insertionDirection(value: number) {
    this.record.insertionDirection = value;
  }

  get path(): number[] {
    return this.record.path;
  }

  set path(value: number[]) {
    this.record.path = value;
  }

  get assignment(): number {
    return this.record.assignment;
  }

  set assignment(value: number) {
    this.record.assignment = value;
  }

  get vehicleId(): number {
    return this.record.vehicleId;
  }

  set vehicleId(value: number) {
    this.record.vehicleId = value;
  }

  get asleep(): boolean {
    return this.record.asleep;
  }

  set asleep(value: boolean) {
    this.record.asleep = value;
  }

  get fractLife(): number {
    return this.record.fractLife;
  }

  set fractLife(value: number) {
    this.record.fractLife = value;
  }

  get collapsed(): boolean {
    return this.record.collapsed;
  }

  set collapsed(value: boolean) {
    this.record.collapsed = value;
  }

  get forcedToStayAwake(): boolean {
    return this.record.forcedToStayAwake;
  }

  set forcedToStayAwake(value: boolean) {
    this.record.forcedToStayAwake = value;
  }

  get complainedThatTired(): boolean {
    return this.record.complainedThatTired;
  }

  set complainedThatTired(value: boolean) {
    this.record.complainedThatTired = value;
  }

  get nothingToDo(): boolean {
    return this.record.nothingToDo;
  }

  set nothingToDo(value: boolean) {
    this.record.nothingToDo = value;
  }

  get doneQuoteSaid(): boolean {
    return this.record.doneQuoteSaid;
  }

  set doneQuoteSaid(value: boolean) {
    this.record.doneQuoteSaid = value;
  }

  get trainStat(): number {
    return this.record.trainStat;
  }

  set trainStat(value: number) {
    this.record.trainStat = value;
  }

  get lastAssignmentChangeMin(): number {
    return this.record.lastAssignmentChangeMin;
  }

  set lastAssignmentChangeMin(value: number) {
    this.record.lastAssignmentChangeMin = value;
  }

  get hospitalPriceModifier(): number {
    return this.record.hospitalPriceModifier;
  }

  set hospitalPriceModifier(value: number) {
    this.record.hospitalPriceModifier = value;
  }

  get fixingRobot(): boolean {
    return this.record.fixingRobot;
  }

  set fixingRobot(value: boolean) {
    this.record.fixingRobot = value;
  }

  get vehicleUnderRepair(): number {
    return this.record.vehicleUnderRepair;
  }

  set vehicleUnderRepair(value: number) {
    this.record.vehicleUnderRepair = value;
  }

  get offGridInSector(): boolean {
    return this.record.offGridInSector;
  }

  set offGridInSector(value: boolean) {
    this.record.offGridInSector = value;
  }

  get contract(): MercContract {
    return this.record.contract;
  }

  get quoteSaidFlags(): number {
    return this.record.quoteSaidFlags;
  }

  set quoteSaidFlags(value: number) {
    this.record.quoteSaidFlags = value;
  }

  get quoteSaidExtFlags(): number {
    return this.record.quoteSaidExtFlags;
  }

  set quoteSaidExtFlags(value: number) {
    this.record.quoteSaidExtFlags = value;
  }

  get corpseQuoteTolerance(): number {
    return this.record.corpseQuoteTolerance;
  }

  set corpseQuoteTolerance(value: number) {
    this.record.corpseQuoteTolerance = value;
  }

  get remoteHolder(): number | null {
    return this.record.remoteHolder;
  }

  set remoteHolder(value: number | null) {
    this.record.remoteHolder = value;
  }

  get id(): number {
    return this.soldier.id;
  }

  swapProfile(profile: number, record: MercProfile | null, stats: Readonly<Record<StatKey, number>>): void {
    const s = this.soldier;
    s.profile = profile;
    this.record.profileRecord = profileRecordTraits(record);
    s.stats.strength = stats.strength;
    s.stats.dexterity = stats.dexterity;
    s.stats.agility = stats.agility;
    s.stats.wisdom = stats.wisdom;
    s.stats.experience = stats.experience;
    s.stats.leadership = stats.leadership;
    s.stats.marksmanship = stats.marksmanship;
    s.stats.mechanical = stats.mechanical;
    s.stats.medical = stats.medical;
    s.stats.explosives = stats.explosives;
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
  readonly state: RosterState;
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
  readonly #state: RosterState;
  readonly #facades = new WeakMap<MercRecord, RosterMerc>();
  readonly #content: TacticalContent;
  readonly #combat: () => CombatContext;
  readonly #profiles: ReadonlyMap<number, ProfileProgress> | null;
  hooks: RosterHooks;

  constructor(setup: RosterSetup) {
    this.#state = setup.state;
    this.#content = setup.content;
    this.#combat = setup.combat;
    this.#profiles = setup.profiles ?? null;
    this.hooks = setup.hooks ?? NO_ROSTER_HOOKS;
  }

  #facade(record: MercRecord): RosterMerc {
    const known = this.#facades.get(record);
    if (known) return known;
    const merc = new RosterMerc(record);
    this.#facades.set(record, merc);
    return merc;
  }

  add(merc: RosterMerc): void {
    this.#state.mercs.set(merc.id, merc.record);
    this.#facades.set(merc.record, merc);
  }

  remove(id: number): void {
    this.#state.mercs.delete(id);
  }

  get(id: number): RosterMerc | undefined {
    const record = this.#state.mercs.get(id);
    return record ? this.#facade(record) : undefined;
  }

  byProfile(profile: number): RosterMerc | undefined {
    return this.all().find((m) => m.profile === profile);
  }

  all(): readonly RosterMerc[] {
    return [...this.#state.mercs.values()].sort((a, b) => a.soldier.id - b.soldier.id).map((r) => this.#facade(r));
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

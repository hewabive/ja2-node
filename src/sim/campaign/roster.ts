import type { Sector } from '../../content/strategic/sector-ids.ts';
import type { MercPort, StrategicMerc, TravelStat } from '../strategic/forces/ports.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { carriedWeightPercentOf } from '../tactical/points.ts';
import { Body, type Soldier, SoldierStatusFlags } from '../tactical/soldier.ts';

export const MercKind = { PLAYER_CHARACTER: 0, AIM_MERC: 1, MERC: 2, NPC: 3, EPC: 4, NPC_UNEXTENDABLE: 5, VEHICLE: 6 } as const;

export interface RosterMercInit {
  readonly soldier: Soldier;
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
}

export class RosterMerc implements StrategicMerc {
  readonly soldier: Soldier;
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

  constructor(init: RosterMercInit) {
    this.soldier = init.soldier;
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

  get lifeMax(): number {
    return this.soldier.lifeMax;
  }

  get strength(): number {
    return this.soldier.stats.strength;
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
  awardTravelExperience(merc: RosterMerc, stat: TravelStat, points: number): void;
  tooTiredToTravel(merc: RosterMerc): boolean;
  collapseFromFatigue(merc: RosterMerc, firstToComplain: boolean): void;
  spendVehicleFuel(vehicle: RosterMerc, fuel: number): number;
}

export const NO_ROSTER_HOOKS: RosterHooks = {
  removeFromTacticalSector: () => {},
  updateMercInSector: () => {},
  awardTravelExperience: () => {},
  tooTiredToTravel: () => false,
  collapseFromFatigue: () => {},
  spendVehicleFuel: () => 0,
};

export class Roster implements MercPort {
  readonly #mercs = new Map<number, RosterMerc>();
  readonly #content: TacticalContent;
  hooks: RosterHooks;

  constructor(content: TacticalContent, hooks: RosterHooks = NO_ROSTER_HOOKS) {
    this.#content = content;
    this.hooks = hooks;
  }

  add(merc: RosterMerc): void {
    this.#mercs.set(merc.id, merc);
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
    const merc = this.get(id);
    if (merc) this.hooks.awardTravelExperience(merc, stat, points);
  }

  removeFromTacticalSector(id: number): void {
    const merc = this.get(id);
    if (merc) this.hooks.removeFromTacticalSector(merc);
  }

  updateMercInSector(id: number, sector: Sector): void {
    const merc = this.get(id);
    if (merc) this.hooks.updateMercInSector(merc, sector);
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
}

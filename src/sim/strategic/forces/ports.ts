import type { Sector } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import type { StrategicState } from '../state.ts';
import type { ClockContext } from '../time/world-clock.ts';
import type { Group } from './groups.ts';
import type { HelicopterEventWithoutTick } from './helicopter-events.ts';

export interface RollSource {
  int(n: number): number;
  chance(percent: number): boolean;
}

export interface StrategicMerc {
  readonly id: number;
  readonly profile: number;
  readonly life: number;
  readonly lifeMax: number;
  readonly strength: number;
  readonly isVehicle: boolean;
  readonly isRobot: boolean;
  readonly isEpc: boolean;
  readonly isPassengerOrDriver: boolean;
  readonly asleep: boolean;
  sector: Sector;
  betweenSectors: boolean;
  groupId: number;
  prevSectorId: number;
  insertionCode: number;
  insertionDirection: number;
  path: number[];
  assignment: number;
  vehicleId: number;
}

export const TravelStat = { HEALTH: 'health', STRENGTH: 'strength' } as const;
export type TravelStat = (typeof TravelStat)[keyof typeof TravelStat];

export const VehicleRole = { NONE: 0, DRIVER: 1, PASSENGER: 2 } as const;

export interface MercPort {
  get(id: number): StrategicMerc | undefined;
  byProfile(profile: number): StrategicMerc | undefined;
  all(): readonly StrategicMerc[];
  carriedWeightPercent(id: number): number;
  changeAssignment(id: number, assignment: number): void;
  awardTravelExperience(id: number, stat: TravelStat, points: number): void;
  removeFromTacticalSector(id: number): void;
  updateMercInSector(id: number, sector: Sector): void;
  tooTiredToTravel(id: number): boolean;
  collapseFromFatigue(id: number, firstToComplain: boolean): void;
  spendVehicleFuel(vehicleSoldierId: number, fuel: number): number;
  setVehicleRole?(id: number, role: number): void;
  insertionData?(id: number): number;
  setInsertionData?(id: number, data: number): void;
  inTacticalSector?(id: number): boolean;
  removeFromGridNo?(id: number): void;
}

export interface HelicopterPort {
  fact(id: number): boolean;
  setFactTrue(id: number): void;
  skyriderLoyaltyLow(): boolean;
  cosmeticChoice(n: number): number;
  killInVehicle(id: number): boolean;
  scheduleKillChopperMeanwhile(): void;
  skyriderOnGround(sector: Sector | null): void;
  emit(event: HelicopterEventWithoutTick): void;
}

export interface StrategicAiPort {
  lookForAdjacentGroups(group: Group): boolean;
  removeGroupFromLists(group: Group): void;
  repollGroup(group: Group): void;
  progressPercentage(): number;
  okayForEnemyToMoveThroughSector(sectorId: number): boolean;
  numStationaryEnemiesInSector(sector: Sector): number;
  queenLostControlOfSector(sector: Sector): void;
  queenBasementTaken(): void;
}

export interface LiberationEvent {
  readonly sector: Sector;
  readonly townId: number;
  readonly samId: number;
  readonly firstTime: boolean;
}

export interface TacticalWorldPort {
  enemyInSector(): boolean;
  hostileCiviliansPresent(): boolean;
  hostileBloodcatsPresent(): boolean;
  inMeanwhile(): boolean;
  boxing(): boolean;
  checkAndHandleUnloadingOfCurrentWorld(): void;
  enemyReinforcementsArrived(group: Group): void;
  addCorpsesToBloodcatLair(sector: Sector): void;
  npcOfNoteInSector(sector: Sector): boolean;
  startTownLoyalty(townId: number): void;
  sectorLiberated(event: LiberationEvent): void;
  sectorTakenByEnemy(sector: Sector, wasPlayerControlled: boolean): void;
  playerControlsSurfaceSector?(sector: Sector): void;
  airspaceControlUpdated?(): void;
}

export interface StrategicPorts {
  readonly mercs: MercPort;
  readonly ai: StrategicAiPort;
  readonly world: TacticalWorldPort;
  readonly helicopter: HelicopterPort;
}

export interface StrategicContext extends StrategicPorts {
  readonly state: StrategicState;
  readonly content: StrategicContent;
  readonly clock: ClockContext;
  readonly random: RollSource;
  readonly preRandom: RollSource;
}

export const defaultStrategicAiPort: StrategicAiPort = {
  lookForAdjacentGroups: () => false,
  removeGroupFromLists: () => {},
  repollGroup: () => {},
  progressPercentage: () => 0,
  okayForEnemyToMoveThroughSector: () => true,
  numStationaryEnemiesInSector: () => 0,
  queenLostControlOfSector: () => {},
  queenBasementTaken: () => {},
};

export const defaultTacticalWorldPort: TacticalWorldPort = {
  enemyInSector: () => false,
  hostileCiviliansPresent: () => false,
  hostileBloodcatsPresent: () => false,
  inMeanwhile: () => false,
  boxing: () => false,
  checkAndHandleUnloadingOfCurrentWorld: () => {},
  enemyReinforcementsArrived: () => {},
  addCorpsesToBloodcatLair: () => {},
  npcOfNoteInSector: () => false,
  startTownLoyalty: () => {},
  sectorLiberated: () => {},
  sectorTakenByEnemy: () => {},
};

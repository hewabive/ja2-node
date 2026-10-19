import type { ItemTable } from '../../content/items/items.ts';
import type { Sector } from '../../content/strategic/sector-ids.ts';
import type { CrewMember, CrewPort, MercStats } from '../strategic/economy/ports.ts';
import { emptyInventory, type Inventory } from '../tactical/inventory.ts';
import { type GuardOptions, guardFields, unsupplied } from './guard.ts';
import { objectFromInventoryView } from './objects.ts';
import type { KnowledgeMerc } from './view.ts';

const CREW_FIELDS: ReadonlySet<PropertyKey> = new Set([
  'id',
  'profile',
  'life',
  'lifeMax',
  'strength',
  'isVehicle',
  'isRobot',
  'isEpc',
  'asleep',
  'sector',
  'betweenSectors',
  'groupId',
  'path',
  'assignment',
  'vehicleId',
  'inSector',
  'stats',
  'inv',
  'breath',
  'breathMax',
  'remoteHolder',
]);

const NO_VEHICLE = -1;
const NO_PROFILE = 200;
const ROBOT_PROFILE = 62;

const NO_STATS: MercStats = {
  strength: 0,
  dexterity: 0,
  agility: 0,
  wisdom: 0,
  leadership: 0,
  marksmanship: 0,
  mechanical: 0,
  medical: 0,
  explosives: 0,
  expLevel: 0,
};

export interface CrewPlacement {
  readonly sector: Sector;
  readonly groupId: number;
  readonly path: readonly number[];
  readonly inSector: boolean;
  readonly remoteHolder: number | null;
}

function statsOf(m: KnowledgeMerc): MercStats {
  const s = m.stats;
  if (!s) return NO_STATS;
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
    expLevel: s.level,
  };
}

function inventoryOf(items: ItemTable, m: KnowledgeMerc, guard: GuardOptions): Inventory {
  const inv = emptyInventory();
  for (const v of m.inventory ?? []) inv[v.slot] = objectFromInventoryView(items, v, `merc ${m.id}.inv[${v.slot}]`, guard);
  return inv;
}

export function isRobotMerc(m: KnowledgeMerc): boolean {
  return m.controlled !== undefined || m.profile === ROBOT_PROFILE;
}

export function crewMemberFromView(items: ItemTable, m: KnowledgeMerc, placement: CrewPlacement, guard: GuardOptions): CrewMember {
  const member = {
    id: m.id,
    profile: m.profile ?? NO_PROFILE,
    life: m.life,
    lifeMax: m.lifeMax,
    strength: m.stats?.strength ?? 0,
    isVehicle: m.kind === 'vehicle',
    isRobot: isRobotMerc(m),
    isEpc: m.kind === 'epc',
    isPassengerOrDriver: false,
    asleep: m.asleep,
    sector: placement.sector,
    betweenSectors: m.betweenSectors,
    groupId: placement.groupId,
    prevSectorId: 0,
    insertionCode: 0,
    insertionDirection: 0,
    path: [...placement.path],
    assignment: m.assignment,
    vehicleId: m.vehicle ?? NO_VEHICLE,
    fractLife: 0,
    bleeding: 0,
    breath: m.breath,
    breathMax: m.breathMax,
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
    inSector: placement.inSector,
    stats: statsOf(m),
    effective: statsOf(m),
    statDamage: { agility: 0, dexterity: 0, strength: 0, wisdom: 0 },
    skillTraits: [0, 0],
    profileTraits: [0, 0],
    needForSleep: 0,
    inv: inventoryOf(items, m, guard),
    remoteHolder: placement.remoteHolder,
  };
  return guardFields(member, CREW_FIELDS, `merc ${m.id}`, guard);
}

export function projectedCrewPort(members: readonly CrewMember[], weight: ReadonlyMap<number, number>, guard: GuardOptions): CrewPort {
  const byId = new Map(members.map((m) => [m.id, m]));
  const change = (name: string) => () => unsupplied(`crew.${name}`, guard);
  return {
    get: (id) => byId.get(id),
    byProfile: (profile) => members.find((m) => m.profile === profile),
    all: () => members,
    carriedWeightPercent: (id) => weight.get(id) ?? 0,
    tooTiredToTravel: () => false,
    changeAssignment: change('changeAssignment'),
    awardTravelExperience: change('awardTravelExperience'),
    removeFromTacticalSector: change('removeFromTacticalSector'),
    updateMercInSector: change('updateMercInSector'),
    collapseFromFatigue: change('collapseFromFatigue'),
    spendVehicleFuel: () => 0,
    statChange: change('statChange'),
    healStat: change('healStat'),
    opinion: () => {
      unsupplied('crew.opinion', guard);
      return 0;
    },
    dressWound: () => {
      unsupplied('crew.dressWound', guard);
      return 0;
    },
    inTacticalSector: (id) => byId.get(id)?.inSector === true,
  };
}

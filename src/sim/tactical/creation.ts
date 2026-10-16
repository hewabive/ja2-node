// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Create.cc CreateDetailedPlacementGivenBasicPlacementInfo,
// @src CreateDetailedPlacementGivenStaticDetailedPlacementAndBasicPlacementInfo, ReduceHighExpLevels, TacticalCreateSoldier,
// @src TacticalCopySoldierFromCreateStruct, TacticalCopySoldierFromProfile, ChooseHairColor, GeneratePaletteForSoldier;
// @src Inventory_Choosing.cc AssignCreatureInventory; Soldier_Add.cc FindGridNoFromSweetSpot. See docs/06 §3.2, §7, docs/19 §2.4.

import type { BasicPlacement, Placement } from '../../content/formats/map.ts';
import { type DetailedPlacement, parseDetailedPlacement } from '../../content/formats/placement.ts';
import type { MercProfile } from '../../content/formats/prof.ts';
import { ItemClass, NOTHING } from '../../content/items/items.ts';
import { compatibleFaceItem } from '../../content/items/rules.ts';
import { cardinalSpacesAway, WORLD_COLS, WORLD_ROWS } from '../../content/world/grid.ts';
import { copyObjectInto, createItem, emptyObject, ObjectFlags, objectFromRecord } from '../items/object.ts';
import { type CivGroupState, civGroupHostility, createCivGroupState } from '../strategic/narrative/civ-groups.ts';
import type { BoxingRecord } from '../strategic/narrative/facts.ts';
import { states } from './animation.ts';
import { soldierDifficultyLevel } from './combat/chance.ts';
import type { RandomStream } from './combat/context.ts';
import { generateRandomEquipment, replaceExtendedGuns } from './equipment.ts';
import type { PopulationEnv } from './init-list.ts';
import { emptyInventory, hiredMercInventory, type Inventory, type InventoryContext, InvSlot, npcProfileInventory } from './inventory.ts';
import { boxingHalvesPoints } from './narrative/boxing-state.ts';
import { CivGroupHostility } from './narrative/constants.ts';
import { findBestPath, NOWHERE, newOKDestination, PathCopy, PathFlags } from './pathfinding.ts';
import { calcActionPoints } from './points.ts';
import type { ProfileProgress } from './profiles.ts';
import {
  Body,
  CivilianGroup,
  createSoldier,
  NO_PROFILE,
  Orders,
  SkillTrait,
  type Soldier,
  Attitude as SoldierAttitude,
  SoldierClass,
  type SoldierPalettes,
  type SoldierStats,
  Team,
} from './soldier.ts';
import type { TacticalState } from './state.ts';

const HAIR = { WHITE: 0, BLACK: 1, BROWN: 2, BLONDE: 3, RED: 4 } as const;
const HAIR_IDS = ['WHITEHEAD', 'BLACKHEAD', 'BROWNHEAD', 'BLONDHEAD', 'REDHEAD'];
const SKIN_IDS = ['PINKSKIN', 'TANSKIN', 'DARKSKIN', 'BLACKSKIN'];
const NO_WHITE_HAIR_BODIES = new Set<number>([Body.REGFEMALE, Body.MINICIV, Body.DRESSCIV, Body.HATKIDCIV, Body.KIDCIV]);
const UNSET_STAT = -1;
const MIN_EXP_LEVEL = 1;
const MAX_EXP_LEVEL = 9;
const MAX_STATS_LEVEL = 9;
const ENEMY_ELITE_MINIMUM_LEVEL = 6;
const ENEMY_ELITE_MAXIMUM_LEVEL = 10;
const BASE_ATTRIBUTE = 49;
const ATTRIBUTE_PER_LEVEL = 4;
const DEFAULT_MORALE = 50;
const INITIAL_BREATH = 99;
const INITIAL_BREATH_MAX = 100;
const BATTLE_SOUND_CHOICES = 3;
const FEMALE_BATTLE_SOUND_BASE = 7;
const NORMAL_HUMAN_SMELL_STRENGTH = 10;
const NORMAL_CREATURE_SMELL_STRENGTH = 20;
const COW_SMELL_STRENGTH = 15;
const CAMOUFLAGE_ROLL = 5;
const FULL_CAMOUFLAGE = 100;
const CREATURE_PART_STATUS_BASE = 80;
const CREATURE_PART_STATUS_RANGE = 21;
const DIFF_STEP = 20;
const DIFF_UPPER_HALF = 10;

const MAX_HAIR_DRAW = { pinkOrTan: 4, dark: 2 } as const;
const HairRoll = { RED: 12, BLONDE: 34, BROWN: 60, BLACK: 92, DARK_BROWN: 35, DARK_BLACK: 84, BLACK_SKIN_BLACK: 84 } as const;

const CLASS_CLOTHES: Readonly<Record<number, readonly [string, string]>> = {
  [SoldierClass.ADMINISTRATOR]: ['YELLOWVEST', 'GREENPANTS'],
  [SoldierClass.ELITE]: ['BLACKSHIRT', 'BLACKPANTS'],
  [SoldierClass.ARMY]: ['REDVEST', 'GREENPANTS'],
  [SoldierClass.GREEN_MILITIA]: ['GREENVEST', 'BEIGEPANTS'],
  [SoldierClass.REG_MILITIA]: ['JEANVEST', 'BEIGEPANTS'],
  [SoldierClass.ELITE_MILITIA]: ['BLUEVEST', 'BEIGEPANTS'],
  [SoldierClass.MINER]: ['greyVEST', 'BEIGEPANTS'],
};

const RELATIVE_LEVEL_MODIFIERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [1, 1],
];

const CLASS_BASE_LEVEL: Readonly<Record<number, number>> = {
  [SoldierClass.ADMINISTRATOR]: 2,
  [SoldierClass.ARMY]: 4,
  [SoldierClass.ELITE]: 6,
  [SoldierClass.GREEN_MILITIA]: 2,
  [SoldierClass.REG_MILITIA]: 4,
  [SoldierClass.ELITE_MILITIA]: 6,
};

const CREATURE_BASE_LEVEL: Readonly<Record<number, readonly [number, number]>> = {
  [Body.LARVAE_MONSTER]: [1, 0],
  [Body.INFANT_MONSTER]: [2, 0],
  [Body.YAF_MONSTER]: [3, 2],
  [Body.YAM_MONSTER]: [3, 2],
  [Body.ADULTFEMALEMONSTER]: [5, 2],
  [Body.AM_MONSTER]: [5, 2],
  [Body.QUEENMONSTER]: [7, 0],
  [Body.BLOODCAT]: [5, 0],
};

const MAX_EXP_BY_DIFFICULTY: Readonly<Record<number, number>> = { 1: 6, 2: 7, 3: 8 };
const REDUCE_EXP_CHANCE_STEP = 25;

interface NightOpsChances {
  readonly base: number;
  readonly expertProgress: number;
  readonly expertChance: number;
}

const NIGHTOPS: Readonly<Record<number, NightOpsChances>> = {
  [SoldierClass.ELITE]: { base: 40, expertProgress: 40, expertChance: 30 },
  [SoldierClass.ELITE_MILITIA]: { base: 40, expertProgress: 40, expertChance: 30 },
  [SoldierClass.ARMY]: { base: 0, expertProgress: 50, expertChance: 20 },
  [SoldierClass.REG_MILITIA]: { base: 0, expertProgress: 50, expertChance: 20 },
};
const NIGHTOPS_RAMP_PROGRESS = 60;
const NIGHTOPS_RAMP_CAP = 40;

interface CreatureKit {
  readonly hand?: string;
  readonly secondHand?: string;
  readonly hide?: string;
  readonly dropChance: number;
  readonly male: boolean;
  readonly bloodcat: boolean;
}

const CREATURE_KITS: Readonly<Record<number, CreatureKit>> = {
  [Body.ADULTFEMALEMONSTER]: {
    hand: 'CREATURE_OLD_FEMALE_CLAWS',
    hide: 'CREATURE_OLD_FEMALE_HIDE',
    dropChance: 30,
    male: false,
    bloodcat: false,
  },
  [Body.AM_MONSTER]: {
    hand: 'CREATURE_OLD_MALE_CLAWS',
    secondHand: 'CREATURE_OLD_MALE_SPIT',
    hide: 'CREATURE_OLD_MALE_HIDE',
    dropChance: 30,
    male: true,
    bloodcat: false,
  },
  [Body.YAF_MONSTER]: {
    hand: 'CREATURE_YOUNG_FEMALE_CLAWS',
    hide: 'CREATURE_YOUNG_FEMALE_HIDE',
    dropChance: 15,
    male: false,
    bloodcat: false,
  },
  [Body.YAM_MONSTER]: {
    hand: 'CREATURE_YOUNG_MALE_CLAWS',
    secondHand: 'CREATURE_YOUNG_MALE_SPIT',
    hide: 'CREATURE_YOUNG_MALE_HIDE',
    dropChance: 15,
    male: true,
    bloodcat: false,
  },
  [Body.INFANT_MONSTER]: { hand: 'CREATURE_INFANT_SPIT', hide: 'CREATURE_INFANT_HIDE', dropChance: 5, male: false, bloodcat: false },
  [Body.LARVAE_MONSTER]: { dropChance: 0, male: false, bloodcat: false },
  [Body.QUEENMONSTER]: {
    hand: 'CREATURE_QUEEN_SPIT',
    secondHand: 'CREATURE_QUEEN_TENTACLES',
    hide: 'CREATURE_QUEEN_HIDE',
    dropChance: 0,
    male: false,
    bloodcat: false,
  },
  [Body.BLOODCAT]: { hand: 'BLOODCAT_CLAW_ATTACK', secondHand: 'BLOODCAT_BITE', dropChance: 30, male: false, bloodcat: true },
};

const MONSTER_BODIES: ReadonlySet<number> = new Set([
  Body.ADULTFEMALEMONSTER,
  Body.AM_MONSTER,
  Body.YAF_MONSTER,
  Body.YAM_MONSTER,
  Body.LARVAE_MONSTER,
  Body.INFANT_MONSTER,
  Body.QUEENMONSTER,
]);
const VEHICLE_BODIES: ReadonlySet<number> = new Set([
  Body.HUMVEE,
  Body.ELDORADO,
  Body.ICECREAMTRUCK,
  Body.JEEP,
  Body.TANK_NW,
  Body.TANK_NE,
]);
const NEUTRAL_VEHICLE_BODIES: ReadonlySet<number> = new Set([Body.HUMVEE, Body.ELDORADO, Body.ICECREAMTRUCK]);

interface CivilianStatRoll {
  readonly life?: readonly [number, number];
  readonly agility?: readonly [number, number];
}

const CIVILIAN_STAT_ROLLS: Readonly<Record<number, CivilianStatRoll>> = {
  [Body.FATCIV]: { agility: [30, 26] },
  [Body.MANCIV]: { life: [35, 26] },
  [Body.MINICIV]: { life: [30, 16] },
  [Body.DRESSCIV]: { life: [30, 16] },
  [Body.HATKIDCIV]: { life: [20, 16] },
  [Body.KIDCIV]: { life: [20, 16] },
  [Body.CRIPPLECIV]: { life: [20, 26], agility: [30, 16] },
};

export interface CreationContext extends Pick<TacticalState, 'content' | 'options' | 'equipment' | 'campaign'> {
  readonly rng: RandomStream;
  readonly boxing?: BoxingRecord;
  readonly civGroups?: CivGroupState;
  readonly profiles?: ReadonlyMap<number, ProfileProgress>;
}

const WARDEN_PROFILE = 102;

function civilianStartsNeutral(c: CreationContext, profile: number, group: number): boolean {
  if (profile === WARDEN_PROFILE) return false;
  if (group === CivilianGroup.NONE) return true;
  return civGroupHostility(c.civGroups ?? createCivGroupState(), group) !== CivGroupHostility.HOSTILE;
}

export interface CreationEnv extends Pick<PopulationEnv, 'difficultyModifier' | 'difficulty' | 'bloodcatLair'> {
  readonly autoresolve?: boolean;
}

export interface SoldierCreate {
  profile: number;
  team: number;
  soldierClass: number;
  civilianGroup: number;
  bodyType: number;
  orders: number;
  attitude: number;
  direction: number;
  insertionGridNo: number;
  onRoof: boolean;
  hasKeys: boolean;
  patrolCount: number;
  patrolGrid: readonly number[];
  expLevel: number;
  life: number;
  lifeMax: number;
  agility: number;
  dexterity: number;
  marksmanship: number;
  medical: number;
  mechanical: number;
  explosives: number;
  leadership: number;
  strength: number;
  wisdom: number;
  morale: number;
  visible: boolean;
  palettes: Partial<SoldierPalettes>;
  readonly inv: Inventory;
  name: string;
  scheduleId: number;
}

function chooseHair(c: CreationContext, body: number, skin: number): number {
  const r = c.rng.int(100);
  let hair: number = HAIR.WHITE;
  if (skin <= 1) {
    if (r < HairRoll.RED) hair = HAIR.RED;
    else if (r < HairRoll.BLONDE) hair = HAIR.BLONDE;
    else if (r < HairRoll.BROWN) hair = HAIR.BROWN;
    else if (r < HairRoll.BLACK) hair = HAIR.BLACK;
    else if (NO_WHITE_HAIR_BODIES.has(body)) hair = c.rng.int(MAX_HAIR_DRAW.pinkOrTan) + 1;
  } else if (skin === 2) {
    if (r < HairRoll.DARK_BROWN) hair = HAIR.BROWN;
    else if (r < HairRoll.DARK_BLACK) hair = HAIR.BLACK;
    else if (NO_WHITE_HAIR_BODIES.has(body)) hair = c.rng.int(MAX_HAIR_DRAW.dark) + 1;
  } else if (r < HairRoll.BLACK_SKIN_BLACK || NO_WHITE_HAIR_BODIES.has(body)) {
    hair = HAIR.BLACK;
  }
  if (body === Body.CRIPPLECIV && c.rng.int(100) < 50) hair = HAIR.WHITE;
  return hair;
}

function pick<T>(c: CreationContext, options: readonly T[]): T {
  return options[c.rng.int(options.length)] as T;
}

export function generatePalettes(
  c: CreationContext,
  body: number,
  team: number,
  soldierClass: number,
  given: Partial<SoldierPalettes>,
): SoldierPalettes {
  const skin = c.rng.int(SKIN_IDS.length);
  const hair = HAIR_IDS[chooseHair(c, body, skin)] ?? 'BLACKHEAD';
  const skinId = SKIN_IDS[skin] ?? 'PINKSKIN';
  const forced = CLASS_CLOTHES[soldierClass];
  if (forced) return { hair, skin: skinId, vest: forced[0], pants: forced[1] };
  if (given.vest && given.pants) return { hair, skin: skinId, vest: given.vest, pants: given.pants };
  const cheesy = team === Team.CIV && c.rng.int(100) < 40;
  if (cheesy) {
    if (c.rng.int(100) < 30) return { hair, skin: skinId, vest: 'GYELLOWSHIRT', pants: pick(c, ['TANPANTS', 'BEIGEPANTS', 'GREENPANTS']) };
    return {
      hair,
      skin: skinId,
      pants: 'JEANPANTS',
      vest: pick(c, ['WHITEVEST', 'BLACKSHIRT', 'PURPLESHIRT', 'BLUEVEST', 'BROWNVEST', 'JEANVEST', 'REDVEST']),
    };
  }
  switch (c.rng.int(3)) {
    case 0:
      return { hair, skin: skinId, pants: 'GREENPANTS', vest: pick(c, ['YELLOWVEST', 'WHITEVEST', 'BROWNVEST', 'GREENVEST']) };
    case 1:
      return {
        hair,
        skin: skinId,
        pants: 'TANPANTS',
        vest: pick(c, ['YELLOWVEST', 'WHITEVEST', 'BLACKSHIRT', 'BLUEVEST', 'BROWNVEST', 'GREENVEST', 'JEANVEST', 'REDVEST']),
      };
    default:
      return { hair, skin: skinId, pants: 'BLUEPANTS', vest: pick(c, ['YELLOWVEST', 'WHITEVEST', 'REDVEST', 'BLACKSHIRT']) };
  }
}

function randomBody(c: CreationContext, team: number, soldierClass: number): number {
  if (team === Team.OUR || team === Team.ENEMY || team === Team.MILITIA)
    return [Body.REGMALE, Body.BIGMALE, Body.STOCKYMALE, Body.REGFEMALE][c.rng.int(4)] ?? Body.REGMALE;
  if (team !== Team.CIV) return Body.REGMALE;
  if (soldierClass === SoldierClass.MINER) return [Body.REGMALE, Body.BIGMALE, Body.MANCIV][c.rng.int(3)] ?? Body.REGMALE;
  const r = c.rng.int(100);
  if (r < 8) return Body.FATCIV;
  if (r < 38) return Body.MANCIV;
  if (r < 57) return Body.MINICIV;
  if (r < 76) return Body.DRESSCIV;
  if (r < 88) return Body.HATKIDCIV;
  return Body.KIDCIV;
}

function reduceHighExpLevels(c: CreationContext, level: number, difficulty: number): number {
  const max = MAX_EXP_BY_DIFFICULTY[difficulty];
  if (max === undefined || level < max) return level;
  const chance = (level - max + 1) * REDUCE_EXP_CHANCE_STEP;
  return c.rng.int(100) < chance ? max : max - 1;
}

interface ExperienceRoll {
  readonly level: number;
  readonly statsModifier: number;
  readonly soldierClass: number;
}

function creatureLevel(c: CreationContext, body: number, modifier: number, env: CreationEnv): number {
  const base = CREATURE_BASE_LEVEL[body];
  if (!base) return 0;
  const [level, spread] = base;
  let result = level + (spread ? c.rng.int(spread) : 0) + modifier;
  if (body === Body.BLOODCAT && env.bloodcatLair) result += env.difficulty;
  return result;
}

function experience(c: CreationContext, bp: BasicPlacement, soldierClass: number, env: CreationEnv): ExperienceRoll {
  const diffFactor = env.difficultyModifier(soldierClass);
  let expModifier = Math.trunc(diffFactor / DIFF_STEP) - 2;
  let statsModifier = diffFactor % DIFF_STEP >= DIFF_UPPER_HALF ? 1 : 0;
  const relative = RELATIVE_LEVEL_MODIFIERS[bp.relativeAttributeLevel];
  if (relative) {
    expModifier += relative[0];
    statsModifier += relative[1];
  }
  let cls = soldierClass;
  let level: number;
  const classBase = CLASS_BASE_LEVEL[soldierClass];
  if (classBase !== undefined) level = classBase + expModifier;
  else if (soldierClass === SoldierClass.MINER) level = bp.relativeAttributeLevel;
  else if (soldierClass === SoldierClass.CREATURE) level = creatureLevel(c, bp.bodyType, expModifier, env);
  else {
    level = bp.relativeAttributeLevel;
    cls = SoldierClass.NONE;
  }
  const clamped =
    cls === SoldierClass.ELITE
      ? Math.min(ENEMY_ELITE_MAXIMUM_LEVEL, Math.max(ENEMY_ELITE_MINIMUM_LEVEL, level))
      : Math.min(MAX_EXP_LEVEL, Math.max(MIN_EXP_LEVEL, level));
  return { level: clamped, statsModifier, soldierClass: cls };
}

function blankCreate(bp: BasicPlacement): SoldierCreate {
  return {
    profile: NO_PROFILE,
    team: bp.team,
    soldierClass: bp.soldierClass,
    civilianGroup: bp.civilianGroup,
    bodyType: bp.bodyType,
    orders: bp.orders,
    attitude: bp.attitude,
    direction: bp.direction,
    insertionGridNo: bp.startingGridNo,
    onRoof: bp.onRoof,
    hasKeys: bp.hasKeys,
    patrolCount: bp.patrolCount,
    patrolGrid: [...bp.patrolGrid],
    expLevel: 0,
    life: 0,
    lifeMax: 0,
    agility: 0,
    dexterity: 0,
    marksmanship: 0,
    medical: 0,
    mechanical: 0,
    explosives: 0,
    leadership: 0,
    strength: 0,
    wisdom: 0,
    morale: 0,
    visible: false,
    palettes: {},
    inv: emptyInventory(),
    name: '',
    scheduleId: 0,
  };
}

function generateEquipment(c: CreationContext, pp: SoldierCreate, soldierClass: number, equipmentLevel: number, env: CreationEnv): void {
  if (soldierClass === SoldierClass.NONE || soldierClass === SoldierClass.CREATURE || soldierClass === SoldierClass.MINER) return;
  generateRandomEquipment(
    c.content.items,
    c.rng,
    c.equipment,
    { inv: pp.inv, soldierClass, bodyType: pp.bodyType, experience: pp.expLevel, marksmanship: pp.marksmanship },
    equipmentLevel,
    env.difficultyModifier(soldierClass),
  );
}

export function createDetailedPlacementGivenBasicPlacementInfo(c: CreationContext, bp: BasicPlacement, env: CreationEnv): SoldierCreate {
  const pp = blankCreate(bp);
  pp.bodyType = bp.bodyType < 0 ? randomBody(c, bp.team, bp.soldierClass) : bp.bodyType;
  const exp = experience(c, bp, bp.team === Team.CREATURE ? SoldierClass.CREATURE : bp.soldierClass, env);
  pp.expLevel = exp.level;
  const statsLevel = Math.min(MAX_STATS_LEVEL, exp.level + exp.statsModifier);
  const base = BASE_ATTRIBUTE + ATTRIBUTE_PER_LEVEL * statsLevel;
  const roll = () => base + c.rng.int(9) + c.rng.int(8);
  pp.lifeMax = roll();
  pp.life = pp.lifeMax;
  pp.agility = roll();
  pp.dexterity = roll();
  pp.marksmanship = roll();
  pp.medical = roll();
  pp.mechanical = roll();
  pp.explosives = roll();
  pp.leadership = roll();
  pp.strength = roll();
  pp.wisdom = roll();
  pp.morale = roll();
  if (exp.soldierClass !== SoldierClass.ELITE) pp.expLevel = reduceHighExpLevels(c, pp.expLevel, env.difficulty);
  pp.soldierClass = exp.soldierClass;
  if (!bp.detailed) generateEquipment(c, pp, exp.soldierClass, bp.relativeEquipmentLevel, env);
  return pp;
}

const staticValue = (value: number, fallback: number) => (value === UNSET_STAT ? fallback : value);

export function createDetailedPlacementGivenStaticDetailedPlacementAndBasicPlacementInfo(
  c: CreationContext,
  spp: DetailedPlacement,
  bp: BasicPlacement,
  env: CreationEnv,
): SoldierCreate {
  if (spp.profile !== NO_PROFILE) {
    const pp = blankCreate(bp);
    pp.profile = spp.profile;
    pp.scheduleId = spp.scheduleId;
    return pp;
  }
  const pp = createDetailedPlacementGivenBasicPlacementInfo(c, bp, env);
  pp.scheduleId = spp.scheduleId;
  const st = spp.stats;
  pp.expLevel = staticValue(st.experience, pp.expLevel);
  pp.life = staticValue(st.life, pp.life);
  pp.lifeMax = staticValue(st.lifeMax, pp.lifeMax);
  pp.marksmanship = staticValue(st.marksmanship, pp.marksmanship);
  pp.strength = staticValue(st.strength, pp.strength);
  pp.agility = staticValue(st.agility, pp.agility);
  pp.dexterity = staticValue(st.dexterity, pp.dexterity);
  pp.wisdom = staticValue(st.wisdom, pp.wisdom);
  pp.leadership = staticValue(st.leadership, pp.leadership);
  pp.explosives = staticValue(st.explosives, pp.explosives);
  pp.medical = staticValue(st.medical, pp.medical);
  pp.mechanical = staticValue(st.mechanical, pp.mechanical);
  pp.morale = staticValue(st.morale, pp.morale);
  pp.visible = spp.visible;
  if (spp.visible) pp.palettes = { ...spp.palettes };
  pp.name = spp.name;
  spp.inventory.forEach((rec, k) => {
    if (rec.flags & ObjectFlags.NO_OVERWRITE) pp.inv[k] = objectFromRecord(rec);
  });
  if (!c.options.gunNut) replaceExtendedGuns(c.content.items, c.rng, c.equipment, pp.inv, bp.soldierClass);
  generateEquipment(c, pp, bp.soldierClass, bp.relativeEquipmentLevel, env);
  return pp;
}

function assignNightOps(c: CreationContext, s: Soldier): void {
  const rule = NIGHTOPS[s.soldierClass];
  if (!rule) return;
  const progress = c.equipment.progress;
  const chance = rule.base + (progress < NIGHTOPS_RAMP_PROGRESS ? Math.trunc((progress * 2) / 3) : NIGHTOPS_RAMP_CAP);
  if (c.rng.int(100) >= chance) return;
  s.skillTrait1 = SkillTrait.NIGHTOPS;
  if (progress >= rule.expertProgress && c.rng.int(100) < rule.expertChance) s.skillTrait2 = SkillTrait.NIGHTOPS;
}

type BodyContext = Pick<CreationContext, 'content' | 'rng'>;

function itemId(c: BodyContext, name: string): number {
  return c.content.items.byName.get(name)?.index ?? NOTHING;
}

function putItem(c: BodyContext, s: Soldier, slot: number, name: string, status: number): void {
  copyObjectInto(s.inv[slot] ?? emptyObject(), createItem(c.content.items, itemId(c, name), status));
}

function creaturePartStatus(c: BodyContext): number {
  return CREATURE_PART_STATUS_BASE + c.rng.int(CREATURE_PART_STATUS_RANGE);
}

export function assignCreatureInventory(c: BodyContext, s: Soldier): void {
  const kit = CREATURE_KITS[s.bodyType];
  if (!kit) return;
  if (kit.hand) putItem(c, s, InvSlot.HAND, kit.hand, 100);
  if (kit.secondHand) putItem(c, s, InvSlot.SECOND_HAND, kit.secondHand, 100);
  if (kit.hide) for (const slot of [InvSlot.HELMET, InvSlot.VEST, InvSlot.LEGS]) putItem(c, s, slot, kit.hide, 100);
  let chance = kit.dropChance;
  if (c.rng.int(100) < chance)
    putItem(c, s, InvSlot.BIGPOCK1, kit.bloodcat ? 'BLOODCAT_CLAWS' : 'CREATURE_PART_CLAWS', creaturePartStatus(c));
  if (c.rng.int(100) < chance)
    putItem(c, s, InvSlot.BIGPOCK2, kit.bloodcat ? 'BLOODCAT_TEETH' : 'CREATURE_PART_FLESH', creaturePartStatus(c));
  if (kit.male) chance += Math.trunc(chance / 2);
  if (c.rng.int(100) < chance)
    putItem(c, s, InvSlot.BIGPOCK3, kit.bloodcat ? 'BLOODCAT_PELT' : 'CREATURE_PART_ORGAN', creaturePartStatus(c));
}

function moveFaceItemsFromPockets(c: CreationContext, s: Soldier): void {
  const items = c.content.items;
  let secondFaceItem = false;
  for (let slot = InvSlot.BIGPOCK1; slot <= InvSlot.BIGPOCK4; slot++) {
    const o = s.inv[slot];
    if (!o || items.byIndex.get(o.item)?.itemClass !== ItemClass.FACE) continue;
    if (!secondFaceItem) {
      secondFaceItem = true;
      copyObjectInto(s.inv[InvSlot.HEAD1] ?? emptyObject(), o);
      copyObjectInto(o, emptyObject());
    } else if (compatibleFaceItem(items, s.inv[InvSlot.HEAD1]?.item ?? NOTHING, o.item)) {
      copyObjectInto(s.inv[InvSlot.HEAD2] ?? emptyObject(), o);
      copyObjectInto(o, emptyObject());
      break;
    }
  }
}

function rollCivilianStats(c: CreationContext, s: Soldier): void {
  const rolls = CIVILIAN_STAT_ROLLS[s.bodyType];
  if (!rolls) return;
  if (rolls.life) {
    s.lifeMax = rolls.life[0] + c.rng.int(rolls.life[1]);
    s.life = s.lifeMax;
  }
  if (rolls.agility) s.stats.agility = rolls.agility[0] + c.rng.int(rolls.agility[1]);
}

function bodyTypeSetup(c: BodyContext, s: Soldier): void {
  const b = s.bodyType;
  if (b === Body.HATKIDCIV || b === Body.KIDCIV) s.battleSoundId = c.rng.int(2);
  else if (b === Body.REGFEMALE || b === Body.MINICIV || b === Body.DRESSCIV) {
    s.battleSoundId = FEMALE_BATTLE_SOUND_BASE + c.rng.int(2);
    s.normalSmell = NORMAL_HUMAN_SMELL_STRENGTH;
  } else if (b === Body.BLOODCAT) {
    assignCreatureInventory(c, s);
    s.normalSmell = NORMAL_HUMAN_SMELL_STRENGTH;
    s.monsterOrAnimal = true;
  } else if (MONSTER_BODIES.has(b)) {
    assignCreatureInventory(c, s);
    s.ai.orders = Orders.FARPATROL;
    s.ai.attitude = SoldierAttitude.AGGRESSIVE;
    s.monsterOrAnimal = true;
    s.monsterSmell = NORMAL_CREATURE_SMELL_STRENGTH;
  } else if (b === Body.COW) {
    s.monsterOrAnimal = true;
    s.normalSmell = COW_SMELL_STRENGTH;
  } else if (b === Body.CROW) s.monsterOrAnimal = true;
  else if (VEHICLE_BODIES.has(b)) {
    if (NEUTRAL_VEHICLE_BODIES.has(b)) s.neutral = true;
  } else if (b !== Body.ROBOTNOWEAPON) s.normalSmell = NORMAL_HUMAN_SMELL_STRENGTH;
}

function profileStats(p: MercProfile): SoldierStats {
  return {
    agility: p.agility,
    dexterity: p.dexterity,
    strength: p.strength,
    wisdom: p.wisdom,
    leadership: p.leadership,
    marksmanship: p.marksmanship,
    mechanical: p.mechanical,
    explosives: p.explosives,
    medical: p.medical,
    experience: p.experience,
  };
}

function withCampaignProgress(p: MercProfile, live: ProfileProgress | undefined): MercProfile {
  if (!live) return p;
  const st = live.stats;
  return {
    ...p,
    nickname: live.nickname ?? p.nickname,
    life: live.life,
    lifeMax: st.lifeMax,
    agility: st.agility,
    dexterity: st.dexterity,
    strength: st.strength,
    wisdom: st.wisdom,
    leadership: st.leadership,
    marksmanship: st.marksmanship,
    mechanical: st.mechanical,
    explosives: st.explosives,
    medical: st.medical,
    experience: st.experience,
    inventory: live.inventory,
    inventoryStatus: live.inventoryStatus,
    inventoryCount: live.inventoryCount,
    money: live.money,
  };
}

function profiledSoldier(c: CreationContext, pp: SoldierCreate, id: number, record: MercProfile): Soldier {
  const p = withCampaignProgress(record, c.profiles?.get(record.id));
  const s = createSoldier({
    id,
    team: pp.team,
    name: p.nickname || p.name,
    profile: p.id,
    soldierClass: pp.soldierClass,
    bodyType: p.bodyType,
    palettes: {
      hair: p.palettes.hair,
      skin: p.palettes.skin,
      vest: p.palettes.vest || 'WHITEVEST',
      pants: p.palettes.pants || 'BLACKPANTS',
    },
    inv: npcProfileInventory(c.content.items, p, !c.options.gunNut),
    stats: profileStats(p),
    life: p.life,
    lifeMax: p.lifeMax,
    morale: DEFAULT_MORALE,
    skillTrait1: p.skillTrait,
    skillTrait2: p.skillTrait2,
    personalityTrait: p.personalityTrait,
    civilianGroup: p.civilianGroup,
    gridNo: NOWHERE,
    level: pp.onRoof ? 1 : 0,
    direction: pp.direction,
    state: states(c.content.animations).STANDING,
    ai: { orders: pp.orders, attitude: pp.attitude, patrolGrid: [], patrolCount: pp.patrolCount },
  });
  if (s.skillTrait1 === SkillTrait.CAMOUFLAGED || s.skillTrait2 === SkillTrait.CAMOUFLAGED) s.camo = FULL_CAMOUFLAGE;
  return s;
}

function generatedSoldier(c: CreationContext, pp: SoldierCreate, id: number): Soldier {
  const s = createSoldier({
    id,
    team: pp.team,
    name: pp.name,
    soldierClass: pp.soldierClass,
    bodyType: pp.bodyType,
    palettes: { hair: '', skin: '', vest: '', pants: '' },
    inv: pp.inv,
    stats: {
      agility: pp.agility,
      dexterity: pp.dexterity,
      strength: pp.strength,
      wisdom: pp.wisdom,
      leadership: pp.leadership,
      marksmanship: pp.marksmanship,
      mechanical: pp.mechanical,
      explosives: pp.explosives,
      medical: pp.medical,
      experience: pp.expLevel,
    },
    life: pp.life,
    lifeMax: pp.lifeMax,
    morale: pp.morale,
    civilianGroup: pp.civilianGroup,
    gridNo: NOWHERE,
    level: pp.onRoof ? 1 : 0,
    direction: pp.direction,
    state: states(c.content.animations).STANDING,
    ai: {
      orders: pp.orders,
      attitude: pp.attitude,
      patrolGrid: pp.patrolCount > 0 ? [pp.insertionGridNo, ...pp.patrolGrid.slice(1, pp.patrolCount + 1)] : [],
      patrolCount: pp.patrolCount,
    },
  });
  assignNightOps(c, s);
  const given = pp.visible ? pp.palettes : {};
  return { ...s, palettes: generatePalettes(c, pp.bodyType, pp.team, pp.soldierClass, given) };
}

export function tacticalCreateSoldier(c: CreationContext, pp: SoldierCreate, id: number, env: CreationEnv): Soldier | null {
  const profile = pp.profile !== NO_PROFILE ? c.content.profiles[pp.profile] : undefined;
  if (pp.profile !== NO_PROFILE && !profile) return null;
  const s = profile ? profiledSoldier(c, pp, id, profile) : generatedSoldier(c, pp, id);
  s.breath = INITIAL_BREATH;
  s.breathMax = INITIAL_BREATH_MAX;
  s.hasKeys = pp.hasKeys;
  if (pp.team === Team.CIV) s.neutral = civilianStartsNeutral(c, pp.profile, s.civilianGroup);
  if (pp.team === Team.OUR || pp.team === Team.MILITIA) s.visible = 1;
  s.actionPoints = calcActionPoints(c.content, s, boxingHalvesPoints(c));
  s.initialActionPoints = s.actionPoints;
  s.oldLife = s.lifeMax;
  s.insertionGridNo = pp.insertionGridNo;
  s.scheduleId = pp.scheduleId;
  if (pp.team === Team.CIV && !profile) rollCivilianStats(c, s);
  if (pp.team === Team.CREATURE && s.bodyType === Body.BLOODCAT) s.neutral = true;
  if (!profile) s.battleSoundId = c.rng.int(BATTLE_SOUND_CHOICES);
  if (!profile && pp.team === Team.ENEMY && s.bodyType === Body.REGFEMALE && s.soldierClass !== SoldierClass.ELITE)
    s.bodyType = Body.REGMALE + c.rng.int(3);
  if (pp.team !== Team.OUR) {
    moveFaceItemsFromPockets(c, s);
    if (
      !env.autoresolve &&
      pp.team === Team.ENEMY &&
      s.inv.some((o) => o.item === itemId(c, 'CAMOUFLAGEKIT')) &&
      c.rng.int(CAMOUFLAGE_ROLL) < soldierDifficultyLevel({ campaign: c.campaign }, s)
    )
      s.camo = FULL_CAMOUFLAGE;
  }
  bodyTypeSetup(c, s);
  return s;
}

export function findGridNoFromSweetSpot(t: TacticalState, s: Soldier, sweet: number, radius: number): number {
  const probe = { ...s, team: Team.ENEMY, gridNo: sweet, level: s.level };
  const flood = findBestPath(t.pathEnv, probe, NOWHERE, s.level, {
    copy: PathCopy.REACHABLE,
    flags: PathFlags.IGNORE_PERSON_AT_DEST | PathFlags.THROUGH_PEOPLE,
    distLimit: radius,
  });
  const cx = sweet % WORLD_COLS;
  const cy = Math.trunc(sweet / WORLD_COLS);
  let best = NOWHERE;
  let bestRange = Number.POSITIVE_INFINITY;
  for (let y = Math.max(0, cy - radius); y <= Math.min(WORLD_ROWS - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(WORLD_COLS - 1, cx + radius); x++) {
      const g = y * WORLD_COLS + x;
      if (!flood.reachable?.[g]) continue;
      if (!newOKDestination(t.pathEnv, s, g, true, s.level)) continue;
      const range = cardinalSpacesAway(sweet, g);
      if (range < bestRange) {
        best = g;
        bestRange = range;
      }
    }
  }
  return best;
}

function creationContext(t: Pick<TacticalState, 'content'>): InventoryContext {
  return { items: t.content.items, inCombat: false, actionPoints: () => 0, spendActionPoints: () => {}, dropAtFeet: () => {} };
}

export function createMercFromProfile(
  t: Pick<TacticalState, 'content' | 'options'>,
  id: number,
  profile: MercProfile,
  direction: number,
): Soldier {
  return createSoldier({
    id,
    team: Team.OUR,
    name: profile.nickname || profile.name,
    profile: profile.id,
    bodyType: profile.bodyType,
    palettes: {
      hair: profile.palettes.hair,
      skin: profile.palettes.skin,
      vest: profile.palettes.vest || 'WHITEVEST',
      pants: profile.palettes.pants || 'BLACKPANTS',
    },
    inv: hiredMercInventory(creationContext(t), profile, !t.options.gunNut),
    stats: profileStats(profile),
    life: profile.life,
    lifeMax: profile.lifeMax,
    skillTrait1: profile.skillTrait,
    skillTrait2: profile.skillTrait2,
    personalityTrait: profile.personalityTrait,
    gridNo: NOWHERE,
    direction,
    state: states(t.content.animations).STANDING,
  });
}

export type HiredMercContext = BodyContext;

function progressStats(p: ProfileProgress): SoldierStats {
  const s = p.stats;
  return {
    agility: s.agility,
    dexterity: s.dexterity,
    strength: s.strength,
    wisdom: s.wisdom,
    leadership: s.leadership,
    marksmanship: s.marksmanship,
    mechanical: s.mechanical,
    explosives: s.explosives,
    medical: s.medical,
    experience: s.experience,
  };
}

export function createHiredMerc(
  c: HiredMercContext,
  id: number,
  profile: MercProfile,
  progress: ProfileProgress,
  copyProfileItems: boolean,
  direction: number,
): Soldier {
  const items = {
    ...profile,
    inventory: progress.inventory,
    inventoryStatus: progress.inventoryStatus,
    inventoryCount: progress.inventoryCount,
  };
  const s = createSoldier({
    id,
    team: Team.OUR,
    name: profile.nickname || profile.name,
    profile: profile.id,
    bodyType: profile.bodyType,
    palettes: {
      hair: profile.palettes.hair,
      skin: profile.palettes.skin,
      vest: profile.palettes.vest || 'WHITEVEST',
      pants: profile.palettes.pants || 'BLACKPANTS',
    },
    inv: copyProfileItems ? hiredMercInventory(creationContext(c), items, false) : emptyInventory(),
    stats: progressStats(progress),
    life: progress.life,
    lifeMax: progress.stats.lifeMax,
    morale: DEFAULT_MORALE,
    skillTrait1: progress.skillTrait,
    skillTrait2: progress.skillTrait2,
    personalityTrait: progress.personalityTrait,
    civilianGroup: profile.civilianGroup,
    gridNo: NOWHERE,
    direction,
    state: states(c.content.animations).STANDING,
  });
  if (s.skillTrait1 === SkillTrait.CAMOUFLAGED || s.skillTrait2 === SkillTrait.CAMOUFLAGED) s.camo = FULL_CAMOUFLAGE;
  s.breath = INITIAL_BREATH;
  s.breathMax = INITIAL_BREATH_MAX;
  s.visible = 1;
  s.actionPoints = calcActionPoints(c.content, s);
  s.initialActionPoints = s.actionPoints;
  s.oldLife = s.lifeMax;
  bodyTypeSetup(c, s);
  return s;
}

export function createFromPlacement(t: TacticalState, id: number, placement: Placement, env: CreationEnv): Soldier | null {
  const detailed = placement.detailedRaw ? parseDetailedPlacement(placement.detailedRaw) : null;
  return createFromPlacementParts(t, id, placement.basic, detailed, env);
}

export type PlacementAdjust = (pp: SoldierCreate) => boolean;

export function createFromPlacementParts(
  c: CreationContext,
  id: number,
  b: BasicPlacement,
  detailed: DetailedPlacement | null,
  env: CreationEnv,
  adjust: PlacementAdjust = () => true,
): Soldier | null {
  const pp = detailed
    ? createDetailedPlacementGivenStaticDetailedPlacementAndBasicPlacementInfo(c, detailed, b, env)
    : createDetailedPlacementGivenBasicPlacementInfo(c, b, env);
  if (!adjust(pp)) return null;
  return tacticalCreateSoldier(c, pp, id, env);
}

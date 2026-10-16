// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Init_List.cc LoadSoldiersFromMap, AddPlacementToWorld, AddSoldierInitListTeamToWorld,
// @src AddSoldierInitListEnemyDefenceSoldiers, AddSoldierInitListMilitia, EvaluateDeathEffectsToSoldierInitList,
// @src StripEnemyDetailedPlacementsIfSectorWasPlayerLiberated, FindSoldierInitNodeBySoldier;
// @src Soldier_Create.cc RandomizeRelativeLevel, TacticalCreateEnemySoldier, CreateSoldierCommon (standing frame draw);
// @src Strategic/Queen_Command.cc AddEnemiesToBattle. See docs/16 §5.13, docs/17 §10.

import type { BasicPlacement, MapDef } from '../../content/formats/map.ts';
import { type DetailedPlacement, parseDetailedPlacement } from '../../content/formats/placement.ts';
import { clamp, u8 } from '../../core/int.ts';
import { addSoldierInitListEnemyDefenceSoldiers as fillDefencePlacements, sortSoldierInitList } from '../strategic/ai/defence-placement.ts';
import type { RandomStream } from './combat/context.ts';
import { createFromPlacementParts } from './creation.ts';
import { chooseMapEdgepoints } from './edgepoints.ts';
import { addSoldierToSector, Insertion, type InsertionContext, updateMercInSector } from './insertion.ts';
import {
  Attitude,
  Body,
  firstFreeSoldierId,
  NO_PROFILE,
  NOWHERE,
  Orders,
  type Soldier,
  SoldierClass,
  TEAM_FIRST_ID,
  TEAM_SIZES,
  Team,
} from './soldier.ts';
import { sectorMapOf, type TacticalState } from './state.ts';

export interface InitBasic {
  startingGridNo: number;
  relativeAttributeLevel: number;
  relativeEquipmentLevel: number;
  direction: number;
  orders: number;
  attitude: number;
  bodyType: number;
  patrolGrid: number[];
  patrolCount: number;
  onRoof: boolean;
  civilianGroup: number;
  hasKeys: boolean;
}

export interface SoldierInitNode {
  readonly index: number;
  team: number;
  soldierClass: number;
  priorityExistence: boolean;
  detailed: boolean;
  hasSoldier: boolean;
  soldierId: number;
  basic: InitBasic;
  detail: DetailedPlacement | null;
}

export interface PopulationEnv {
  difficultyModifier(soldierClass: number): number;
  readonly difficulty: number;
  readonly bloodcatLair: boolean;
  readonly locationModifier: number;
  readonly autoResolveActive: boolean;
  profileHere(profile: number): boolean;
  civilianWithheld(node: SoldierInitNode): boolean;
}

export const BODY_RANDOM = -1;
export const MAX_ATTITUDES = 6;
const STANDING_FRAME_CHOICES = 10;
const CENTRAL_GRIDNO = 13202;
const CENTRAL_RADIUS = 30;
const MAX_MISC_NOISE_DURATION = 12;
const CAVES_TILESET = 1;
const NO_SOLDIER = -1;
const LOCATION_ROLL_DIVISOR = 3;
const LOCATION_ROLL_OFFSET = 5;
const RELATIVE_LEVELS = [0, 1, 1, 2, 2, 2, 2, 3, 3, 4] as const;

export const MEDIUM_DIFFICULTY = 2;

export const NEUTRAL_POPULATION: PopulationEnv = {
  difficultyModifier: () => 0,
  difficulty: MEDIUM_DIFFICULTY,
  bloodcatLair: false,
  locationModifier: 0,
  autoResolveActive: false,
  profileHere: () => false,
  civilianWithheld: () => false,
};

function initBasic(b: BasicPlacement): InitBasic {
  return {
    startingGridNo: b.startingGridNo,
    relativeAttributeLevel: b.relativeAttributeLevel,
    relativeEquipmentLevel: b.relativeEquipmentLevel,
    direction: b.direction,
    orders: b.orders,
    attitude: b.attitude,
    bodyType: b.bodyType,
    patrolGrid: [...b.patrolGrid],
    patrolCount: b.patrolCount,
    onRoof: b.onRoof,
    civilianGroup: b.civilianGroup,
    hasKeys: b.hasKeys,
  };
}

export function buildSoldierInitList(map: Pick<MapDef, 'placements'>): SoldierInitNode[] {
  return map.placements.map((p, index) => ({
    index,
    team: p.basic.team,
    soldierClass: p.basic.soldierClass,
    priorityExistence: p.basic.priorityExistence,
    detailed: p.basic.detailed,
    hasSoldier: false,
    soldierId: NO_SOLDIER,
    basic: initBasic(p.basic),
    detail: p.detailedRaw ? parseDetailedPlacement(p.detailedRaw) : null,
  }));
}

export function basicPlacementOf(n: SoldierInitNode): BasicPlacement {
  const b = n.basic;
  return {
    detailed: n.detailed,
    startingGridNo: b.startingGridNo,
    team: n.team,
    relativeAttributeLevel: b.relativeAttributeLevel,
    relativeEquipmentLevel: b.relativeEquipmentLevel,
    direction: b.direction,
    orders: b.orders,
    attitude: b.attitude,
    bodyType: b.bodyType,
    patrolGrid: b.patrolGrid,
    patrolCount: b.patrolCount,
    onRoof: b.onRoof,
    soldierClass: n.soldierClass,
    civilianGroup: b.civilianGroup,
    priorityExistence: n.priorityExistence,
    hasKeys: b.hasKeys,
  };
}

export function sortInitList(t: TacticalState): SoldierInitNode[] {
  t.initList = sortSoldierInitList(t.initList);
  return t.initList;
}

export function soldierSlotTaken(t: TacticalState, id: number): boolean {
  return t.soldiers[id]?.placed === true;
}

export function freeSoldierSlots(t: TacticalState, team: number): number {
  const first = TEAM_FIRST_ID[team] ?? 0;
  const size = TEAM_SIZES[team] ?? 0;
  let free = 0;
  for (let id = first; id < first + size; id++) if (!soldierSlotTaken(t, id)) free++;
  return free;
}

export function drawStandingFrame(t: TacticalState): void {
  t.rng.int(STANDING_FRAME_CHOICES);
}

function isMilitiaClass(soldierClass: number): boolean {
  return soldierClass >= SoldierClass.GREEN_MILITIA && soldierClass <= SoldierClass.ELITE_MILITIA;
}

export function randomizeRelativeLevel(t: { readonly rng: RandomStream }, soldierClass: number, env: PopulationEnv): number {
  const rollModifier = Math.trunc(env.locationModifier / LOCATION_ROLL_DIVISOR) - LOCATION_ROLL_OFFSET;
  let adjusted = t.rng.int(10) + rollModifier;
  if (isMilitiaClass(soldierClass)) {
    adjusted = clamp(adjusted, 1, 8);
    if (env.autoResolveActive) adjusted++;
  } else {
    adjusted = clamp(adjusted, 0, 9);
    if (env.autoResolveActive && adjusted > 0) adjusted--;
  }
  return RELATIVE_LEVELS[adjusted] ?? 2;
}

function createSoldier(t: TacticalState, team: number, basic: BasicPlacement, detail: DetailedPlacement | null, env: PopulationEnv) {
  const id = firstFreeSoldierId((n) => soldierSlotTaken(t, n), team);
  if (id < 0) return null;
  const s = createFromPlacementParts(t, id, basic, detail, env);
  if (!s) return null;
  if (team === Team.MILITIA) s.visible = 1;
  drawStandingFrame(t);
  return s;
}

export function addPlacementToWorld(t: TacticalState, node: SoldierInitNode, env: PopulationEnv): boolean {
  const profile = node.detail?.profile ?? NO_PROFILE;
  if (profile !== NO_PROFILE && !env.profileHere(profile)) return false;
  if (node.team === Team.CIV && env.civilianWithheld(node)) return true;
  const s = createSoldier(t, node.team, basicPlacementOf(node), node.detail, env);
  if (!s) return false;
  node.soldierId = s.id;
  node.hasSoldier = true;
  s.insertionGridNo = node.basic.startingGridNo;
  addSoldierToSector(t, s, { code: Insertion.GRIDNO, data: node.basic.startingGridNo, direction: node.basic.direction }, {}, false);
  return true;
}

function convertCivilianToMiner(node: SoldierInitNode): void {
  if (node.team !== Team.CIV || node.detail) return;
  node.soldierClass = SoldierClass.MINER;
  node.basic.bodyType = BODY_RANDOM;
}

export function addSoldierInitListTeamToWorld(t: TacticalState, team: number, env: PopulationEnv): void {
  const list = sortInitList(t);
  if (sectorMapOf(t).tilesetId === CAVES_TILESET) for (const node of list) convertCivilianToMiner(node);
  for (const node of list) {
    if (node.hasSoldier) break;
    if (node.team !== team) continue;
    if (!addPlacementToWorld(t, node, env) && node.team !== Team.CIV) break;
  }
}

export interface EnemyTotals {
  readonly admins: number;
  readonly troops: number;
  readonly elites: number;
}

export function addSoldierInitListEnemyDefenceSoldiers(t: TacticalState, totals: EnemyTotals, env: PopulationEnv): void {
  t.equipment.mortarsRolledByTeam = 0;
  const list = sortInitList(t);
  fillDefencePlacements(list, { ...totals }, t.rng, (node) => addPlacementToWorld(t, node, env));
}

const MILITIA_FOR_ENEMY_CLASS: Readonly<Record<number, number>> = {
  [SoldierClass.ADMINISTRATOR]: SoldierClass.GREEN_MILITIA,
  [SoldierClass.ARMY]: SoldierClass.REG_MILITIA,
  [SoldierClass.ELITE]: SoldierClass.ELITE_MILITIA,
};

interface MilitiaCounts {
  green: number;
  regular: number;
  elite: number;
  max: number;
}

const isEnemyOrMilitia = (n: SoldierInitNode) => n.team === Team.ENEMY || n.team === Team.MILITIA;

function dropDetailForMilitia(t: TacticalState, node: SoldierInitNode, env: PopulationEnv): void {
  if (!node.detail) return;
  node.detail = null;
  node.detailed = false;
  node.basic.relativeAttributeLevel = randomizeRelativeLevel(t, node.soldierClass, env);
  node.basic.relativeEquipmentLevel = randomizeRelativeLevel(t, node.soldierClass, env);
}

function enlistMilitia(t: TacticalState, node: SoldierInitNode, env: PopulationEnv, rollAttitude: boolean): boolean {
  node.team = Team.MILITIA;
  node.basic.orders = Orders.STATIONARY;
  if (rollAttitude) {
    node.basic.attitude = t.rng.int(MAX_ATTITUDES);
    dropDetailForMilitia(t, node, env);
  }
  return addPlacementToWorld(t, node, env);
}

function takePriorityMilitia(node: SoldierInitNode, c: MilitiaCounts): boolean {
  if (c.elite && node.soldierClass === SoldierClass.ELITE) {
    node.soldierClass = SoldierClass.ELITE_MILITIA;
    c.elite--;
  } else if (c.regular && node.soldierClass === SoldierClass.ARMY) {
    node.soldierClass = SoldierClass.REG_MILITIA;
    c.regular--;
  } else if (c.green && node.soldierClass === SoldierClass.ADMINISTRATOR) {
    node.soldierClass = SoldierClass.GREEN_MILITIA;
    c.green--;
  } else return false;
  return true;
}

function chooseMilitiaClass(t: TacticalState, node: SoldierInitNode, c: MilitiaCounts): void {
  const r = t.rng.int(c.max);
  if (r < c.elite) {
    node.soldierClass = SoldierClass.ELITE_MILITIA;
    c.elite--;
  } else if (r < c.elite + c.regular) {
    node.soldierClass = SoldierClass.REG_MILITIA;
    c.regular--;
  } else if (r < c.elite + c.regular + c.green) {
    node.soldierClass = SoldierClass.GREEN_MILITIA;
    c.green--;
  }
}

const MILITIA_PASS_CLASSES = [SoldierClass.ADMINISTRATOR, SoldierClass.ELITE, SoldierClass.ARMY] as const;

function militiaTotal(c: MilitiaCounts, cls: number): number {
  return cls === SoldierClass.ADMINISTRATOR ? c.green : cls === SoldierClass.ELITE ? c.elite : c.regular;
}

function takeMilitiaTotal(c: MilitiaCounts, cls: number): void {
  if (cls === SoldierClass.ADMINISTRATOR) c.green--;
  else if (cls === SoldierClass.ELITE) c.elite--;
  else c.regular--;
}

export function addSoldierInitListMilitia(t: TacticalState, green: number, regular: number, elite: number, env: PopulationEnv): void {
  const c: MilitiaCounts = { green: u8(green), regular: u8(regular), elite: u8(elite), max: u8(green + regular + elite) };
  const list = sortInitList(t);
  let i = 0;
  for (; i < list.length; i++) {
    const node = list[i] as SoldierInitNode;
    if (!node.priorityExistence || !c.max) break;
    if (!isEnemyOrMilitia(node) || !takePriorityMilitia(node, c)) continue;
    if (!enlistMilitia(t, node, env, true)) return;
    c.max--;
  }
  if (!c.max) return;
  const mark = i;
  const slots: Record<number, number> = { [SoldierClass.ADMINISTRATOR]: 0, [SoldierClass.ELITE]: 0, [SoldierClass.ARMY]: 0 };
  for (let j = mark; j < list.length && !(list[j] as SoldierInitNode).hasSoldier; j++) {
    const node = list[j] as SoldierInitNode;
    if (isEnemyOrMilitia(node) && slots[node.soldierClass] !== undefined)
      slots[node.soldierClass] = u8((slots[node.soldierClass] ?? 0) + 1);
  }
  for (const cls of MILITIA_PASS_CLASSES) {
    for (let j = mark; j < list.length; j++) {
      const node = list[j] as SoldierInitNode;
      if (node.hasSoldier || !c.max || !militiaTotal(c, cls) || !slots[cls]) break;
      if (!isEnemyOrMilitia(node) || node.soldierClass !== cls) continue;
      const free = slots[cls] ?? 0;
      const total = militiaTotal(c, cls);
      if (free <= total || t.rng.int(free) < total) {
        node.soldierClass = MILITIA_FOR_ENEMY_CLASS[cls] ?? node.soldierClass;
        if (!enlistMilitia(t, node, env, false)) return;
        takeMilitiaTotal(c, cls);
        c.max--;
      }
      slots[cls] = u8(free - 1);
    }
  }
  if (!c.max) return;
  let freeSlots = 0;
  for (const node of list) if (!node.hasSoldier && isEnemyOrMilitia(node)) freeSlots = u8(freeSlots + 1);
  for (const node of list) {
    if (freeSlots === 0 || c.max === 0) break;
    if (node.hasSoldier || !isEnemyOrMilitia(node)) continue;
    if (freeSlots <= c.max || t.rng.int(freeSlots) < c.max) {
      chooseMilitiaClass(t, node, c);
      if (!enlistMilitia(t, node, env, true)) return;
      c.max--;
    }
    freeSlots = u8(freeSlots - 1);
  }
}

export function findSoldierInitNodeBySoldier(t: TacticalState, s: Soldier): SoldierInitNode | null {
  return t.initList.find((n) => n.hasSoldier && n.soldierId === s.id) ?? null;
}

export function evaluateDeathEffectsToSoldierInitList(t: TacticalState, s: Soldier): void {
  if (s.team === Team.MILITIA) return;
  const node = findSoldierInitNodeBySoldier(t, s);
  if (!node?.detail) return;
  node.detail = null;
  node.hasSoldier = false;
  node.soldierId = NO_SOLDIER;
}

export function stripEnemyDetailedPlacements(t: TacticalState, env: PopulationEnv): void {
  for (const node of t.initList) {
    if (node.team !== Team.ENEMY || !node.detail) continue;
    node.detail = null;
    node.detailed = false;
    node.priorityExistence = false;
    node.basic.bodyType = BODY_RANDOM;
    node.basic.relativeAttributeLevel = randomizeRelativeLevel(t, node.soldierClass, env);
    node.basic.relativeEquipmentLevel = randomizeRelativeLevel(t, node.soldierClass, env);
  }
}

export function tacticalCreateEnemySoldier(t: TacticalState, soldierClass: number, env: PopulationEnv): Soldier | null {
  const attribute = randomizeRelativeLevel(t, soldierClass, env);
  const equipment = randomizeRelativeLevel(t, soldierClass, env);
  const basic: BasicPlacement = {
    detailed: false,
    startingGridNo: NOWHERE,
    team: Team.ENEMY,
    relativeAttributeLevel: attribute,
    relativeEquipmentLevel: equipment,
    direction: 0,
    orders: Orders.SEEKENEMY,
    attitude: t.rng.int(MAX_ATTITUDES),
    bodyType: BODY_RANDOM,
    patrolGrid: [],
    patrolCount: 0,
    onRoof: false,
    soldierClass,
    civilianGroup: 0,
    priorityExistence: false,
    hasKeys: false,
  };
  const s = createSoldier(t, Team.ENEMY, basic, null, env);
  if (!s) return null;
  const dx = t.rng.int(CENTRAL_RADIUS * 2 + 1) - CENTRAL_RADIUS;
  const dy = t.rng.int(CENTRAL_RADIUS * 2 + 1) - CENTRAL_RADIUS;
  s.ai.noiseGridNo = CENTRAL_GRIDNO + dx + dy * 160;
  s.ai.noiseVolume = MAX_MISC_NOISE_DURATION;
  return s;
}

export function tacticalCreateCreature(t: TacticalState, bodyType: number, env: PopulationEnv): Soldier | null {
  const attribute = randomizeRelativeLevel(t, SoldierClass.CREATURE, env);
  const equipment = randomizeRelativeLevel(t, SoldierClass.CREATURE, env);
  const basic: BasicPlacement = {
    detailed: false,
    startingGridNo: NOWHERE,
    team: Team.CREATURE,
    relativeAttributeLevel: attribute,
    relativeEquipmentLevel: equipment,
    direction: 0,
    orders: Orders.SEEKENEMY,
    attitude: Attitude.AGGRESSIVE,
    bodyType,
    patrolGrid: [],
    patrolCount: 0,
    onRoof: false,
    soldierClass: SoldierClass.CREATURE,
    civilianGroup: 0,
    priorityExistence: false,
    hasKeys: false,
  };
  return createSoldier(t, Team.CREATURE, basic, null, env);
}

export interface CreatureCounts {
  larvae: number;
  infants: number;
  youngMales: number;
  youngFemales: number;
  adultMales: number;
  adultFemales: number;
}

const CREATURE_BODY_ORDER = [
  ['larvae', Body.LARVAE_MONSTER],
  ['infants', Body.INFANT_MONSTER],
  ['youngMales', Body.YAM_MONSTER],
  ['youngFemales', Body.YAF_MONSTER],
  ['adultMales', Body.AM_MONSTER],
  ['adultFemales', Body.ADULTFEMALEMONSTER],
] as const;

const totalCreatures = (c: CreatureCounts) => u8(c.larvae + c.infants + c.youngMales + c.youngFemales + c.adultMales + c.adultFemales);

function takePriorityCreature(node: SoldierInitNode, c: CreatureCounts): boolean {
  for (const [key, body] of CREATURE_BODY_ORDER) {
    if (c[key] && node.basic.bodyType === body) {
      c[key]--;
      return true;
    }
  }
  return false;
}

function chooseCreatureBody(rolls: RandomStream, node: SoldierInitNode, c: CreatureCounts, total: number): void {
  const r = rolls.int(total);
  let bound = 0;
  for (const [key, body] of CREATURE_BODY_ORDER) {
    bound += c[key];
    if (c[key] && r < bound) {
      c[key]--;
      node.basic.bodyType = body;
      return;
    }
  }
}

type PlaceNode = (node: SoldierInitNode) => boolean;

function placeQueen(list: readonly SoldierInitNode[], place: PlaceNode): void {
  for (const node of list) {
    if (node.hasSoldier || node.team !== Team.CREATURE || node.basic.bodyType !== Body.QUEENMONSTER) continue;
    if (!place(node)) return;
  }
}

export function placeCreaturesFromInitList(
  list: readonly SoldierInitNode[],
  queen: boolean,
  counts: CreatureCounts,
  rolls: RandomStream,
  place: PlaceNode,
): void {
  const c = { ...counts };
  let remaining = totalCreatures(c);
  if (queen) placeQueen(list, place);
  for (const node of list) {
    if (!node.priorityExistence || remaining === 0) break;
    if (node.team !== Team.CREATURE || !takePriorityCreature(node, c)) continue;
    if (!place(node)) return;
    remaining--;
  }
  if (!remaining) return;
  let freeSlots = 0;
  for (const node of list) if (!node.hasSoldier && node.team === Team.CREATURE) freeSlots = u8(freeSlots + 1);
  for (const node of list) {
    if (freeSlots === 0 || remaining === 0) break;
    if (node.hasSoldier || node.team !== Team.CREATURE) continue;
    if (freeSlots <= remaining || rolls.int(freeSlots) < remaining) {
      chooseCreatureBody(rolls, node, c, remaining);
      node.detail = null;
      node.detailed = false;
      if (!place(node)) return;
      remaining--;
    }
    freeSlots = u8(freeSlots - 1);
  }
}

export function addSoldierInitListCreatures(t: TacticalState, queen: boolean, counts: CreatureCounts, env: PopulationEnv): void {
  placeCreaturesFromInitList(sortInitList(t), queen, counts, t.rng, (node) => addPlacementToWorld(t, node, env));
}

export interface BloodcatSector {
  bloodCats: number;
  bloodCatPlacements: number;
}

const isBloodcatNode = (n: SoldierInitNode) => n.basic.bodyType === Body.BLOODCAT;

export function placeBloodcatsFromInitList(
  nodes: readonly SoldierInitNode[],
  sector: BloodcatSector,
  hasSpawns: boolean,
  rolls: RandomStream,
  place: PlaceNode,
): readonly SoldierInitNode[] {
  if (!sector.bloodCatPlacements) return nodes;
  const counted = (nodes.filter(isBloodcatNode).length << 24) >> 24;
  if (counted !== sector.bloodCatPlacements && !hasSpawns) {
    sector.bloodCatPlacements = counted;
    sector.bloodCats = -1;
    if (!counted) return nodes;
  }
  if (sector.bloodCats <= 0) return nodes;
  const max = u8(sector.bloodCats);
  const list = sortSoldierInitList([...nodes]);
  let added = list.filter((n) => isBloodcatNode(n) && n.hasSoldier).length;
  let i = 0;
  for (; i < list.length; i++) {
    const node = list[i] as SoldierInitNode;
    if (!node.priorityExistence || added >= max) break;
    if (isBloodcatNode(node) && place(node)) added++;
  }
  if (added === max) return list;
  const mark = i;
  let available = 0;
  let toFill = u8(max - added);
  for (let j = mark; j < list.length; j++) {
    const node = list[j] as SoldierInitNode;
    if (node.hasSoldier || added >= max) break;
    if (isBloodcatNode(node)) available = u8(available + 1);
  }
  if (!available) return list;
  for (let j = mark; j < list.length; j++) {
    const node = list[j] as SoldierInitNode;
    if (node.hasSoldier || added >= max || !available) break;
    if (!isBloodcatNode(node)) continue;
    if (available <= toFill || rolls.int(available) < toFill) {
      if (!place(node)) return list;
      added++;
      toFill = u8(toFill - 1);
    }
    available = u8(available - 1);
  }
  return list;
}

export function addSoldierInitListBloodcats(t: TacticalState, sector: BloodcatSector, hasSpawns: boolean, env: PopulationEnv): void {
  t.initList = [...placeBloodcatsFromInitList(t.initList, sector, hasSpawns, t.rng, (node) => addPlacementToWorld(t, node, env))];
}

const CREATURE_DIRECTION_BY_INSERTION: Readonly<Record<number, number>> = {
  [Insertion.NORTH]: 3,
  [Insertion.EAST]: 5,
  [Insertion.SOUTH]: 7,
  [Insertion.WEST]: 1,
  [Insertion.GRIDNO]: 0,
};

export interface TownCreatures {
  readonly youngMales: number;
  readonly youngFemales: number;
  readonly adultMales: number;
  readonly adultFemales: number;
}

function shuffledBodies(t: TacticalState, c: TownCreatures): number[] {
  const bodies = [
    ...new Array<number>(c.youngMales).fill(Body.YAM_MONSTER),
    ...new Array<number>(c.youngFemales).fill(Body.YAF_MONSTER),
    ...new Array<number>(c.adultMales).fill(Body.AM_MONSTER),
    ...new Array<number>(c.adultFemales).fill(Body.ADULTFEMALEMONSTER),
  ];
  for (let i = bodies.length - 1; i > 0; i--) {
    const j = t.rng.int(i + 1);
    const tmp = bodies[i] as number;
    bodies[i] = bodies[j] as number;
    bodies[j] = tmp;
  }
  return bodies;
}

export interface CreatureInsertion {
  readonly code: number;
  readonly gridNo: number;
}

export function addCreaturesToBattle(
  t: TacticalState,
  c: TownCreatures,
  insertion: CreatureInsertion,
  ctx: InsertionContext,
  env: PopulationEnv,
): Soldier[] {
  const direction = CREATURE_DIRECTION_BY_INSERTION[insertion.code];
  if (direction === undefined) throw new RangeError(`invalid creature insertion code ${insertion.code}`);
  const total = c.youngMales + c.youngFemales + c.adultMales + c.adultFemales;
  const points = insertion.code === Insertion.GRIDNO ? [] : chooseMapEdgepoints(t, insertion.code, total, t.rng);
  const added: Soldier[] = [];
  let slot = 0;
  for (const body of shuffledBodies(t, c)) {
    const s = tacticalCreateCreature(t, body, env);
    if (!s) continue;
    s.hunting = true;
    const order =
      insertion.code === Insertion.GRIDNO
        ? { code: Insertion.GRIDNO, data: insertion.gridNo, direction }
        : slot < points.length
          ? { code: Insertion.GRIDNO, data: points[slot++] as number, direction }
          : { code: insertion.code, data: 0, direction };
    updateMercInSector(t, s, order, ctx);
    added.push(s);
  }
  return added;
}

export interface ArrivingEnemies {
  readonly groupId: number;
  readonly insertionCode: number;
  readonly facing: number;
  admins: number;
  troops: number;
  elites: number;
}

export function addEnemiesToBattle(t: TacticalState, arrival: ArrivingEnemies, ctx: InsertionContext, env: PopulationEnv): Soldier[] {
  let total = u8(arrival.admins + arrival.troops + arrival.elites);
  const points = chooseMapEdgepoints(t, arrival.insertionCode, total, t.rng);
  const added: Soldier[] = [];
  let slot = 0;
  while (total !== 0) {
    const roll = t.rng.int(total--);
    let soldierClass: number;
    if (roll < arrival.elites) {
      arrival.elites--;
      soldierClass = SoldierClass.ELITE;
    } else if (roll < arrival.elites + arrival.troops) {
      arrival.troops--;
      soldierClass = SoldierClass.ARMY;
    } else {
      arrival.admins--;
      soldierClass = SoldierClass.ADMINISTRATOR;
    }
    const s = tacticalCreateEnemySoldier(t, soldierClass, env);
    if (!s) continue;
    s.groupId = arrival.groupId;
    const order =
      slot < points.length
        ? { code: Insertion.GRIDNO, data: points[slot++] as number, direction: arrival.facing }
        : { code: arrival.insertionCode, data: 0, direction: arrival.facing };
    updateMercInSector(t, s, order, ctx);
    added.push(s);
  }
  return added;
}

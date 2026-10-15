// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Create.cc CreateDetailedPlacementGivenBasicPlacementInfo, ChooseHairColor,
// @src GeneratePaletteForSoldier, TacticalCreateSoldier; Soldier_Init_List.cc AddSoldierInitListEnemyDefenceSoldiers;
// @src Soldier_Add.cc FindGridNoFromSweetSpot, AddSoldierToSectorNoCalculateDirection. See docs/06 §3.2, §7.

import type { Placement } from '../../content/formats/map.ts';
import { type DetailedPlacement, parseDetailedPlacement } from '../../content/formats/placement.ts';
import type { MercProfile } from '../../content/formats/prof.ts';
import { cardinalSpacesAway, WORLD_COLS, WORLD_ROWS } from '../../content/world/grid.ts';
import { initNewSoldierAnim, states } from './animation.ts';
import { hiredMercInventory, type InventoryContext, npcProfileInventory } from './inventory.ts';
import { setSoldierPosition } from './movement.ts';
import { findBestPath, NOWHERE, newOKDestination, PathCopy, PathFlags } from './pathfinding.ts';
import { calcActionPoints } from './points.ts';
import { Body, createSoldier, NO_PROFILE, type Soldier, SoldierClass, type SoldierPalettes, type SoldierStats, Team } from './soldier.ts';
import { registerSoldier, type TacticalState } from './state.ts';

const HAIR = { WHITE: 0, BLACK: 1, BROWN: 2, BLONDE: 3, RED: 4 } as const;
const HAIR_IDS = ['WHITEHEAD', 'BLACKHEAD', 'BROWNHEAD', 'BLONDHEAD', 'REDHEAD'];
const SKIN_IDS = ['PINKSKIN', 'TANSKIN', 'DARKSKIN', 'BLACKSKIN'];
const NO_WHITE_HAIR_BODIES = new Set<number>([Body.REGFEMALE, Body.MINICIV, Body.DRESSCIV, Body.HATKIDCIV, Body.KIDCIV]);
const SWEET_SPOT_RADIUS = 7;
const INITIAL_STANDING_CODES = 10;
const UNSET_STAT = -1;

const CLASS_CLOTHES: Readonly<Record<number, readonly [string, string]>> = {
  [SoldierClass.ADMINISTRATOR]: ['YELLOWVEST', 'GREENPANTS'],
  [SoldierClass.ELITE]: ['BLACKSHIRT', 'BLACKPANTS'],
  [SoldierClass.ARMY]: ['REDVEST', 'GREENPANTS'],
  [SoldierClass.GREEN_MILITIA]: ['GREENVEST', 'BEIGEPANTS'],
  [SoldierClass.REG_MILITIA]: ['JEANVEST', 'BEIGEPANTS'],
  [SoldierClass.ELITE_MILITIA]: ['BLUEVEST', 'BEIGEPANTS'],
  [SoldierClass.MINER]: ['greyVEST', 'BEIGEPANTS'],
};

export interface PopulationOptions {
  readonly difficultyModifier: number;
  readonly enemyTroops: number;
}

export const SANDBOX_POPULATION: PopulationOptions = { difficultyModifier: 30, enemyTroops: 4 };

function chooseHair(t: TacticalState, body: number, skin: number): number {
  const r = t.rng.int(100);
  let hair: number = HAIR.WHITE;
  if (skin <= 1) {
    if (r < 12) hair = HAIR.RED;
    else if (r < 34) hair = HAIR.BLONDE;
    else if (r < 60) hair = HAIR.BROWN;
    else if (r < 92) hair = HAIR.BLACK;
    else if (NO_WHITE_HAIR_BODIES.has(body)) hair = t.rng.int(4) + 1;
  } else if (skin === 2) {
    if (r < 35) hair = HAIR.BROWN;
    else if (r < 84) hair = HAIR.BLACK;
    else if (NO_WHITE_HAIR_BODIES.has(body)) hair = t.rng.int(2) + 1;
  } else if (r < 84 || NO_WHITE_HAIR_BODIES.has(body)) {
    hair = HAIR.BLACK;
  }
  if (body === Body.CRIPPLECIV && t.rng.int(100) < 50) hair = HAIR.WHITE;
  return hair;
}

function pick<T>(t: TacticalState, options: readonly T[]): T {
  return options[t.rng.int(options.length)] as T;
}

export function generatePalettes(
  t: TacticalState,
  body: number,
  team: number,
  soldierClass: number,
  given: Partial<SoldierPalettes>,
): SoldierPalettes {
  const skin = t.rng.int(SKIN_IDS.length);
  const hair = HAIR_IDS[chooseHair(t, body, skin)] ?? 'BLACKHEAD';
  const skinId = SKIN_IDS[skin] ?? 'PINKSKIN';
  const forced = CLASS_CLOTHES[soldierClass];
  if (forced) return { hair, skin: skinId, vest: forced[0], pants: forced[1] };
  if (given.vest && given.pants) return { hair, skin: skinId, vest: given.vest, pants: given.pants };
  const cheesy = team === Team.CIV && t.rng.int(100) < 40;
  if (cheesy) {
    if (t.rng.int(100) < 30) return { hair, skin: skinId, vest: 'GYELLOWSHIRT', pants: pick(t, ['TANPANTS', 'BEIGEPANTS', 'GREENPANTS']) };
    return {
      hair,
      skin: skinId,
      pants: 'JEANPANTS',
      vest: pick(t, ['WHITEVEST', 'BLACKSHIRT', 'PURPLESHIRT', 'BLUEVEST', 'BROWNVEST', 'JEANVEST', 'REDVEST']),
    };
  }
  switch (t.rng.int(3)) {
    case 0:
      return { hair, skin: skinId, pants: 'GREENPANTS', vest: pick(t, ['YELLOWVEST', 'WHITEVEST', 'BROWNVEST', 'GREENVEST']) };
    case 1:
      return {
        hair,
        skin: skinId,
        pants: 'TANPANTS',
        vest: pick(t, ['YELLOWVEST', 'WHITEVEST', 'BLACKSHIRT', 'BLUEVEST', 'BROWNVEST', 'GREENVEST', 'JEANVEST', 'REDVEST']),
      };
    default:
      return { hair, skin: skinId, pants: 'BLUEPANTS', vest: pick(t, ['YELLOWVEST', 'WHITEVEST', 'REDVEST', 'BLACKSHIRT']) };
  }
}

function randomBody(t: TacticalState, team: number, soldierClass: number): number {
  if (team !== Team.CIV) return [Body.REGMALE, Body.BIGMALE, Body.STOCKYMALE, Body.REGFEMALE][t.rng.int(4)] ?? Body.REGMALE;
  if (soldierClass === SoldierClass.MINER) return [Body.REGMALE, Body.BIGMALE, Body.MANCIV][t.rng.int(3)] ?? Body.REGMALE;
  const r = t.rng.int(100);
  if (r < 8) return Body.FATCIV;
  if (r < 38) return Body.MANCIV;
  if (r < 57) return Body.MINICIV;
  if (r < 76) return Body.DRESSCIV;
  if (r < 88) return Body.HATKIDCIV;
  return Body.KIDCIV;
}

function experienceLevel(soldierClass: number, relativeLevel: number, difficulty: number): { level: number; statsModifier: number } {
  let expModifier = Math.trunc(difficulty / 20) - 2;
  let statsModifier = difficulty % 20 >= 10 ? 1 : 0;
  const relative: readonly (readonly [number, number])[] = [
    [-1, -1],
    [-1, 0],
    [0, 0],
    [1, 0],
    [1, 1],
  ];
  const [e, st] = relative[relativeLevel] ?? [0, 0];
  expModifier += e;
  statsModifier += st;
  const base: Readonly<Record<number, number>> = {
    [SoldierClass.ADMINISTRATOR]: 2,
    [SoldierClass.ARMY]: 4,
    [SoldierClass.ELITE]: 6,
    [SoldierClass.GREEN_MILITIA]: 2,
    [SoldierClass.REG_MILITIA]: 4,
    [SoldierClass.ELITE_MILITIA]: 6,
  };
  const classBase = base[soldierClass];
  const level = classBase === undefined ? relativeLevel : classBase + expModifier;
  return { level: Math.min(9, Math.max(1, level)), statsModifier };
}

interface Generated {
  body: number;
  stats: SoldierStats;
  life: number;
  lifeMax: number;
}

function generateBasic(
  t: TacticalState,
  team: number,
  soldierClass: number,
  bodyType: number,
  relativeLevel: number,
  difficulty: number,
): Generated {
  const body = bodyType < 0 ? randomBody(t, team, soldierClass) : bodyType;
  const exp = experienceLevel(soldierClass, relativeLevel, difficulty);
  const statsLevel = Math.min(9, exp.level + exp.statsModifier);
  const baseAttribute = 49 + 4 * statsLevel;
  const roll = () => baseAttribute + t.rng.int(9) + t.rng.int(8);
  const lifeMax = roll();
  const agility = roll();
  const dexterity = roll();
  const marksmanship = roll();
  const medical = roll();
  const mechanical = roll();
  const explosives = roll();
  const leadership = roll();
  const strength = roll();
  const wisdom = roll();
  roll();
  return {
    body,
    life: lifeMax,
    lifeMax,
    stats: { agility, dexterity, strength, wisdom, leadership, marksmanship, mechanical, explosives, medical, experience: exp.level },
  };
}

function applyStaticStats(g: Generated, d: DetailedPlacement): Generated {
  const pickStat = (value: number, fallback: number) => (value === UNSET_STAT ? fallback : value);
  const st = d.stats;
  return {
    body: g.body,
    lifeMax: pickStat(st.lifeMax, g.lifeMax),
    life: pickStat(st.life, g.life),
    stats: {
      agility: pickStat(st.agility, g.stats.agility),
      dexterity: pickStat(st.dexterity, g.stats.dexterity),
      strength: pickStat(st.strength, g.stats.strength),
      wisdom: pickStat(st.wisdom, g.stats.wisdom),
      leadership: pickStat(st.leadership, g.stats.leadership),
      marksmanship: pickStat(st.marksmanship, g.stats.marksmanship),
      mechanical: pickStat(st.mechanical, g.stats.mechanical),
      explosives: pickStat(st.explosives, g.stats.explosives),
      medical: pickStat(st.medical, g.stats.medical),
      experience: pickStat(st.experience, g.stats.experience),
    },
  };
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

export function addSoldierToSector(t: TacticalState, s: Soldier, insertionGridNo: number): boolean {
  s.gridNo = NOWHERE;
  s.actionPoints = calcActionPoints(t.content, s);
  const spot = findGridNoFromSweetSpot(t, s, insertionGridNo, SWEET_SPOT_RADIUS);
  if (spot === NOWHERE) return false;
  registerSoldier(t, s);
  setSoldierPosition(t, s, spot);
  s.direction = s.desiredDirection;
  initNewSoldierAnim(t, s, states(t.content.animations).STANDING, t.rng.int(INITIAL_STANDING_CODES), true);
  return true;
}

function creationContext(t: TacticalState): InventoryContext {
  return { items: t.content.items, inCombat: false, actionPoints: () => 0, spendActionPoints: () => {}, dropAtFeet: () => {} };
}

export function createMercFromProfile(t: TacticalState, id: number, profile: MercProfile, direction: number): Soldier {
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
    stats: {
      agility: profile.agility,
      dexterity: profile.dexterity,
      strength: profile.strength,
      wisdom: profile.wisdom,
      leadership: profile.leadership,
      marksmanship: profile.marksmanship,
      mechanical: profile.mechanical,
      explosives: profile.explosives,
      medical: profile.medical,
      experience: profile.experience,
    },
    life: profile.life,
    lifeMax: profile.lifeMax,
    gridNo: NOWHERE,
    direction,
    state: states(t.content.animations).STANDING,
  });
}

export function createFromPlacement(t: TacticalState, id: number, placement: Placement, options: PopulationOptions): Soldier | null {
  const b = placement.basic;
  const detailed = placement.detailedRaw ? parseDetailedPlacement(placement.detailedRaw) : null;
  if (detailed && detailed.profile !== NO_PROFILE) return createProfiledFromPlacement(t, id, placement, detailed);
  let generated = generateBasic(t, b.team, b.soldierClass, b.bodyType, b.relativeAttributeLevel, options.difficultyModifier);
  if (detailed) generated = applyStaticStats(generated, detailed);
  const given = detailed?.visible ? { vest: detailed.palettes.vest, pants: detailed.palettes.pants } : {};
  const palettes = generatePalettes(t, generated.body, b.team, b.soldierClass, given);
  let body = generated.body;
  if (b.team === Team.ENEMY && body === Body.REGFEMALE && b.soldierClass !== SoldierClass.ELITE) body = Body.REGMALE + t.rng.int(3);
  return createSoldier({
    id,
    team: b.team,
    name: detailed?.name || '',
    soldierClass: b.soldierClass,
    bodyType: body,
    palettes,
    stats: generated.stats,
    life: generated.life,
    lifeMax: generated.lifeMax,
    breath: 99,
    gridNo: NOWHERE,
    direction: b.direction,
    state: states(t.content.animations).STANDING,
    ai: {
      orders: b.orders,
      attitude: b.attitude,
      patrolGrid: b.patrolCount > 0 ? [b.startingGridNo, ...b.patrolGrid.slice(1, b.patrolCount + 1)] : [],
      patrolCount: b.patrolCount,
    },
  });
}

function createProfiledFromPlacement(t: TacticalState, id: number, placement: Placement, d: DetailedPlacement): Soldier | null {
  const profile = t.content.profiles[d.profile];
  if (!profile) return null;
  const b = placement.basic;
  return createSoldier({
    id,
    team: b.team,
    name: profile.nickname || profile.name,
    profile: profile.id,
    bodyType: profile.bodyType,
    palettes: {
      hair: profile.palettes.hair,
      skin: profile.palettes.skin,
      vest: profile.palettes.vest || 'WHITEVEST',
      pants: profile.palettes.pants || 'BLACKPANTS',
    },
    inv: npcProfileInventory(t.content.items, profile, !t.options.gunNut),
    stats: {
      agility: profile.agility,
      dexterity: profile.dexterity,
      strength: profile.strength,
      wisdom: profile.wisdom,
      leadership: profile.leadership,
      marksmanship: profile.marksmanship,
      mechanical: profile.mechanical,
      explosives: profile.explosives,
      medical: profile.medical,
      experience: profile.experience,
    },
    life: profile.life,
    lifeMax: profile.lifeMax,
    breath: 99,
    gridNo: NOWHERE,
    direction: b.direction,
    state: states(t.content.animations).STANDING,
    ai: { orders: b.orders, attitude: b.attitude, patrolGrid: [], patrolCount: b.patrolCount },
  });
}

export function chooseEnemyPlacements(t: TacticalState, placements: readonly Placement[], troops: number): Placement[] {
  const candidates = placements.filter((p) => p.basic.team === Team.ENEMY && p.basic.soldierClass === SoldierClass.ARMY);
  const groups = [
    candidates.filter((p) => p.basic.priorityExistence && p.basic.detailed),
    candidates.filter((p) => p.basic.priorityExistence && !p.basic.detailed),
    candidates.filter((p) => !p.basic.priorityExistence && p.basic.detailed),
    candidates.filter((p) => !p.basic.priorityExistence && !p.basic.detailed),
  ];
  const chosen: Placement[] = [];
  let remaining = troops;
  for (const group of groups) {
    let slots = group.length;
    for (const p of group) {
      if (remaining <= 0) break;
      if (slots <= remaining || t.rng.int(slots) < remaining) {
        chosen.push(p);
        remaining--;
      }
      slots--;
    }
  }
  return chosen;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Create.cc TacticalCreateMilitia, TacticalCreateEnemySoldier (autoresolve screen),
// @src ReserveTacticalSoldierForAutoresolve, TacticalCreateSoldier (the AUTORESOLVE_SCREEN branch: id 255, no camouflage
// @src roll, no CreateSoldierCommon); Strategic/Auto_Resolve.cc ResetMortarsOnTeamCount. See docs/19 §2.4.

import type { BasicPlacement } from '../../content/formats/map.ts';
import { cloneObject } from '../items/object.ts';
import { type CreationContext, createFromPlacementParts } from './creation.ts';
import { BODY_RANDOM, MAX_ATTITUDES, type PopulationEnv, randomizeRelativeLevel } from './init-list.ts';
import { NOWHERE, Orders, type Soldier, SoldierClass, Team } from './soldier.ts';
import { type TacticalState, teamMembers } from './state.ts';

export const AUTORESOLVE_SOLDIER_ID = 255;
const CENTRAL_GRIDNO = 13202;
const CENTRAL_RADIUS = 30;
const WORLD_COLS = 160;
const MAX_MISC_NOISE_DURATION = 12;

export interface AutoresolveCreation {
  readonly create: CreationContext;
  readonly population: PopulationEnv;
}

function basicPlacement(c: AutoresolveCreation, team: number, soldierClass: number, orders: number): BasicPlacement {
  const attribute = randomizeRelativeLevel(c.create, soldierClass, c.population);
  const equipment = randomizeRelativeLevel(c.create, soldierClass, c.population);
  return {
    detailed: false,
    startingGridNo: NOWHERE,
    team,
    relativeAttributeLevel: attribute,
    relativeEquipmentLevel: equipment,
    direction: 0,
    orders,
    attitude: c.create.rng.int(MAX_ATTITUDES),
    bodyType: BODY_RANDOM,
    patrolGrid: [],
    patrolCount: 0,
    onRoof: false,
    soldierClass,
    civilianGroup: 0,
    priorityExistence: false,
    hasKeys: false,
  };
}

function create(c: AutoresolveCreation, basic: BasicPlacement): Soldier | null {
  return createFromPlacementParts(c.create, AUTORESOLVE_SOLDIER_ID, basic, null, {
    difficultyModifier: c.population.difficultyModifier(basic.soldierClass),
  });
}

export function resetMortarsOnTeamCount(c: AutoresolveCreation): void {
  c.create.equipment.mortarsRolledByTeam = 0;
}

export function tacticalCreateMilitiaForAutoresolve(c: AutoresolveCreation, soldierClass: number): Soldier | null {
  const s = create(c, basicPlacement(c, Team.MILITIA, soldierClass, Orders.STATIONARY));
  if (s) s.visible = 1;
  return s;
}

export function tacticalCreateEnemySoldierForAutoresolve(c: AutoresolveCreation, soldierClass: number): Soldier | null {
  const s = create(c, basicPlacement(c, Team.ENEMY, soldierClass, Orders.SEEKENEMY));
  if (!s) return null;
  const dx = c.create.rng.int(CENTRAL_RADIUS * 2 + 1) - CENTRAL_RADIUS;
  const dy = c.create.rng.int(CENTRAL_RADIUS * 2 + 1) - CENTRAL_RADIUS;
  s.ai.noiseGridNo = CENTRAL_GRIDNO + dx + dy * WORLD_COLS;
  s.ai.noiseVolume = MAX_MISC_NOISE_DURATION;
  return s;
}

function copyForAutoresolve(s: Soldier): Soldier {
  return {
    ...s,
    id: AUTORESOLVE_SOLDIER_ID,
    inv: s.inv.map(cloneObject),
    stats: { ...s.stats },
    statDamage: { ...s.statDamage },
    gridNo: NOWHERE,
    placed: false,
  };
}

export function reserveTacticalSoldierForAutoresolve(t: TacticalState, soldierClass: number): Soldier | null {
  const team = soldierClass === SoldierClass.CREATURE ? Team.CREATURE : Team.ENEMY;
  for (const s of teamMembers(t, team).sort((a, b) => a.id - b.id)) {
    if (!s.placed || s.life === 0 || s.gridNo === NOWHERE || s.soldierClass !== soldierClass) continue;
    s.gridNo = NOWHERE;
    return copyForAutoresolve(s);
  }
  return null;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Create.cc TacticalCreateMilitia, TacticalCreateEnemySoldier, TacticalCreateCreature (autoresolve screen),
// @src ReserveTacticalSoldierForAutoresolve, TacticalCreateSoldier (the AUTORESOLVE_SCREEN branch: id 255, no camouflage
// @src roll, no CreateSoldierCommon), the OkayToUpgradeEliteToSpecialProfiledEnemy call of TacticalCreateEnemySoldier;
// @src Strategic/Auto_Resolve.cc ResetMortarsOnTeamCount.

import type { BasicPlacement } from '../../content/formats/map.ts';
import { cloneObject } from '../items/object.ts';
import { type CreationContext, createFromPlacementParts, type PlacementAdjust } from './creation.ts';
import { BODY_RANDOM, MAX_ATTITUDES, type PopulationEnv, randomizeRelativeLevel } from './init-list.ts';
import { Attitude, NOWHERE, Orders, type Soldier, SoldierClass, Team } from './soldier.ts';
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

interface PlacementKind {
  readonly team: number;
  readonly soldierClass: number;
  readonly orders: number;
  readonly attitude: number | null;
  readonly bodyType: number;
}

function basicPlacement(c: AutoresolveCreation, kind: PlacementKind): BasicPlacement {
  const { team, soldierClass, orders } = kind;
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
    attitude: kind.attitude ?? c.create.rng.int(MAX_ATTITUDES),
    bodyType: kind.bodyType,
    patrolGrid: [],
    patrolCount: 0,
    onRoof: false,
    soldierClass,
    civilianGroup: 0,
    priorityExistence: false,
    hasKeys: false,
  };
}

function create(c: AutoresolveCreation, basic: BasicPlacement, adjust?: PlacementAdjust): Soldier | null {
  return createFromPlacementParts(c.create, AUTORESOLVE_SOLDIER_ID, basic, null, { ...c.population, autoresolve: true }, adjust);
}

export function resetMortarsOnTeamCount(c: AutoresolveCreation): void {
  c.create.equipment.mortarsRolledByTeam = 0;
}

export function tacticalCreateMilitiaForAutoresolve(c: AutoresolveCreation, soldierClass: number): Soldier | null {
  const s = create(
    c,
    basicPlacement(c, { team: Team.MILITIA, soldierClass, orders: Orders.STATIONARY, attitude: null, bodyType: BODY_RANDOM }),
  );
  if (s) s.visible = 1;
  return s;
}

export function tacticalCreateEnemySoldierForAutoresolve(c: AutoresolveCreation, soldierClass: number): Soldier | null {
  const upgrade: PlacementAdjust = (pp) => {
    if (soldierClass === SoldierClass.ELITE) c.population.upgradeEliteToProfiledEnemy(pp);
    return true;
  };
  const s = create(
    c,
    basicPlacement(c, { team: Team.ENEMY, soldierClass, orders: Orders.SEEKENEMY, attitude: null, bodyType: BODY_RANDOM }),
    upgrade,
  );
  if (!s) return null;
  const dx = c.create.rng.int(CENTRAL_RADIUS * 2 + 1) - CENTRAL_RADIUS;
  const dy = c.create.rng.int(CENTRAL_RADIUS * 2 + 1) - CENTRAL_RADIUS;
  s.ai.noiseGridNo = CENTRAL_GRIDNO + dx + dy * WORLD_COLS;
  s.ai.noiseVolume = MAX_MISC_NOISE_DURATION;
  return s;
}

export function tacticalCreateCreatureForAutoresolve(c: AutoresolveCreation, bodyType: number): Soldier | null {
  return create(
    c,
    basicPlacement(c, {
      team: Team.CREATURE,
      soldierClass: SoldierClass.CREATURE,
      orders: Orders.SEEKENEMY,
      attitude: Attitude.AGGRESSIVE,
      bodyType,
    }),
  );
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

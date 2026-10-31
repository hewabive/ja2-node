import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { itemId, runExplosivesUntilIdle } from '../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { corpseFileBase } from '../../content/anim/corpses.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import type { SimEvent } from '../events.ts';
import { addCorpseStructure, deathOpcode } from './combat/death.ts';
import type { TacticalContent } from './content.ts';
import { igniteExplosion } from './explosions/explosion.ts';
import { revealRoofsAndItems } from './perception/fov.ts';
import {
  BloodKind,
  bloodFloorStrength,
  DROPPED_IN_SIGHT,
  decayBloodAndSmells,
  internalDropBlood,
  restoreBloodAndSmellAt,
} from './smell.ts';
import { Body, NO_PROFILE, type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { bloodViews } from './world-view.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const UNSEEN = -1;
const MERC_AT = gridNo(80, 80);
const AHEAD = gridNo(80, 75);
const BESIDE = gridNo(81, 79);
const DECAY_PERIOD_SECONDS = 101;
const MAX_DECAY_ROUNDS = 30;
const FLYBACK_BLOOD = 765;
const FULL_POOL = 7;
const DAMAGE_FLUKE_RANGE = 51;

function squad(facing: number = Direction.NORTH): { sim: TacticalSim; merc: Soldier } {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, facing);
  return { sim, merc };
}

function decayUntil(sim: TacticalSim, done: () => boolean): void {
  const t = sim.state;
  for (let round = 0; round < MAX_DECAY_ROUNDS && !done(); round++) decayBloodAndSmells(t, t.smell.lastDecaySeconds + DECAY_PERIOD_SECONDS);
  expect(done()).toBe(true);
}

function someCorpseType(sim: TacticalSim): number {
  const corpses = sim.state.content.corpses;
  for (let type = 1; type < 256; type++) if (corpses.structures.has(corpseFileBase(corpses.table, type, true))) return type;
  throw new Error('no corpse with a structure');
}

describe('blood pools on the ground (Smell.cc InternalDropBlood, UpdateBloodGraphics; FOV.cc RevealRoofsAndItems)', () => {
  it('shows a pool dropped in sight at once and one dropped out of sight once the squad looks at its tile', () => {
    const { sim, merc } = squad(Direction.SOUTH);
    const t = sim.state;
    internalDropBlood(t, AHEAD, 0, BloodKind.HUMAN, 5, UNSEEN);
    expect(bloodViews(t)).toEqual([]);
    revealRoofsAndItems(t, merc, false);
    expect(bloodViews(t)).toEqual([]);
    merc.direction = Direction.NORTH;
    revealRoofsAndItems(t, merc, false);
    expect(bloodViews(t)).toEqual([{ gridNo: AHEAD, strength: 5 }]);
    internalDropBlood(t, BESIDE, 0, BloodKind.CREATURE_ON_FLOOR, 3, DROPPED_IN_SIGHT);
    expect(bloodViews(t)).toContainEqual({ gridNo: BESIDE, strength: 3, creature: true });
  });

  it('keeps a fading pool as the squad last saw it, then shows it smaller and finally gone', () => {
    const { sim, merc } = squad();
    const t = sim.state;
    internalDropBlood(t, AHEAD, 0, BloodKind.HUMAN, 2, DROPPED_IN_SIGHT);
    decayUntil(sim, () => bloodFloorStrength(t.smell.blood[AHEAD] ?? 0) === 1);
    expect(bloodViews(t)).toEqual([{ gridNo: AHEAD, strength: 2 }]);
    revealRoofsAndItems(t, merc, false);
    expect(bloodViews(t)).toEqual([{ gridNo: AHEAD, strength: 1 }]);
    decayUntil(sim, () => t.smell.blood[AHEAD] === 0);
    revealRoofsAndItems(t, merc, false);
    expect(bloodViews(t)).toEqual([]);
  });

  it('redraws a loaded creature pool as human blood: the blood type lives in the smell byte, set after the redraw (SaveLoadMap.cc AddBloodOrSmellFromMapTempFileToMap)', () => {
    const dropped = squad();
    internalDropBlood(dropped.sim.state, AHEAD, 0, BloodKind.CREATURE_ON_FLOOR, 4, DROPPED_IN_SIGHT);
    const blood = dropped.sim.state.smell.blood[AHEAD] ?? 0;
    const smell = dropped.sim.state.smell.smell[AHEAD] ?? 0;
    expect(bloodViews(dropped.sim.state)).toEqual([{ gridNo: AHEAD, strength: 4, creature: true }]);
    const loaded = squad().sim.state;
    restoreBloodAndSmellAt(loaded, AHEAD, blood, smell);
    expect(bloodViews(loaded)).toEqual([{ gridNo: AHEAD, strength: 4 }]);
    expect(loaded.smell.smell[AHEAD]).toBe(smell);
  });

  it('draws no pool with blood and gore off, though the blood is there', () => {
    const { sim, merc } = squad();
    const t = sim.state;
    expect(sim.dispatch({ type: 'setOption', bloodAndGore: false }).ok).toBe(true);
    internalDropBlood(t, AHEAD, 0, BloodKind.HUMAN, 5, DROPPED_IN_SIGHT);
    revealRoofsAndItems(t, merc, false);
    expect(bloodViews(t)).toEqual([]);
    expect(bloodFloorStrength(t.smell.blood[AHEAD] ?? 0)).toBe(5);
  });
});

function corpseAt(sim: TacticalSim, g: number): void {
  const t = sim.state;
  const type = someCorpseType(sim);
  t.corpses.push({
    gridNo: g,
    level: 0,
    bodyType: Body.REGMALE,
    direction: Direction.NORTH,
    state: 0,
    profile: NO_PROFILE,
    type,
    timeOfDeath: 0,
    headTaken: false,
  });
  addCorpseStructure(t, g, 0, type, Direction.NORTH);
}

function grenadeAt(sim: TacticalSim, g: number): SimEvent[] {
  igniteExplosion(sim.state, null, 0, g, itemId(sim.state, 'HAND_GRENADE'), 0);
  return runExplosivesUntilIdle(sim);
}

const hasCorpseStructure = (sim: TacticalSim, g: number) => sim.state.world.structures.find(g, StructureFlags.CORPSE) !== null;

describe('a corpse in a blast (Explosion_Control.cc ExplosiveDamageStructureAtGridNo, Rotting_Corpses.cc VaporizeCorpse)', () => {
  it('blows a corpse next to a grenade apart and sprays its blood two tiles around, fainter with every tile', () => {
    const { sim } = squad();
    const t = sim.state;
    corpseAt(sim, AHEAD);
    const events = grenadeAt(sim, AHEAD);
    expect(events.filter((e) => e.type === 'corpseVaporized').map((e) => e.gridNo)).toEqual([AHEAD]);
    expect(t.corpses).toEqual([]);
    expect(hasCorpseStructure(sim, AHEAD)).toBe(false);
    const pools = new Map(bloodViews(t).map((p) => [p.gridNo, p.strength]));
    expect(pools.get(AHEAD)).toBe(FULL_POOL);
    expect(pools.get(AHEAD + 1)).toBe(FULL_POOL - 2);
    expect(pools.get(AHEAD - 160 + 1)).toBe(FULL_POOL - 2);
    expect(pools.get(AHEAD + 2)).toBe(FULL_POOL - 4);
    expect(pools.has(AHEAD + 3)).toBe(false);
  });

  it('leaves the corpse lying with blood and gore off or two tiles from the grenade', () => {
    const clean = squad();
    expect(clean.sim.dispatch({ type: 'setOption', bloodAndGore: false }).ok).toBe(true);
    corpseAt(clean.sim, AHEAD);
    grenadeAt(clean.sim, AHEAD);
    expect(clean.sim.state.corpses).toHaveLength(1);
    const far = squad();
    corpseAt(far.sim, AHEAD);
    grenadeAt(far.sim, AHEAD + 2);
    expect(far.sim.state.corpses).toHaveLength(1);
    expect(hasCorpseStructure(far.sim, AHEAD)).toBe(true);
  });
});

describe('where blood falls', () => {
  it('wipes the blood under a new corpse (Rotting_Corpses.cc AddRottingCorpse)', () => {
    const { sim } = squad();
    const t = sim.state;
    internalDropBlood(t, AHEAD, 0, BloodKind.HUMAN, 5, DROPPED_IN_SIGHT);
    addCorpseStructure(t, AHEAD, 0, someCorpseType(sim), Direction.NORTH);
    expect(t.smell.blood[AHEAD]).toBe(0);
    expect(bloodViews(t)).toEqual([]);
  });

  it('splashes a full pool on the tile of a man flying back and the tile behind him (Soldier_Ani.cc 765)', () => {
    const { sim } = squad();
    const t = sim.state;
    const victim = spawnSoldier(sim, 20, Team.ENEMY, AHEAD, Direction.SOUTH);
    victim.visible = UNSEEN;
    deathOpcode(t, victim, FLYBACK_BLOOD);
    expect(bloodViews(t)).toEqual([
      { gridNo: AHEAD - 160, strength: FULL_POOL },
      { gridNo: AHEAD, strength: FULL_POOL },
    ]);
  });

  it('spews a full pool on the tile behind a man a bullet goes through, every roll at its best (LOS.cc BulletHitMerc)', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const shooter = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH, { gun: 'M14', marksmanship: 100 });
    const target = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 82), Direction.NORTH);
    const behind = gridNo(80, 83);
    sim.lookAround();
    Object.assign(t, { pre: { int: (n: number) => (n === DAMAGE_FLUKE_RANGE ? n - 1 : 0) } });
    expect(sim.dispatch({ type: 'attack', soldier: shooter.id, target: target.gridNo, bodyPart: 'head' }).ok).toBe(true);
    runUntilIdle(sim);
    expect(bloodFloorStrength(t.smell.blood[behind] ?? 0)).toBe(FULL_POOL);
    expect(bloodViews(t)).toContainEqual({ gridNo: behind, strength: FULL_POOL });
  });
});

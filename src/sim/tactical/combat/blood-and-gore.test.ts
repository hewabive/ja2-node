import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../../tests/support/combat.ts';
import { itemId, runExplosivesUntilIdle } from '../../../../tests/support/explosives.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { corpseFileBase } from '../../../content/anim/corpses.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { deleteObject } from '../../items/object.ts';
import { animName } from '../anim-states.ts';
import type { TacticalContent } from '../content.ts';
import { igniteExplosion } from '../explosions/explosion.ts';
import { InvSlot } from '../inventory.ts';
import { type Soldier, Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { eventSoldierGotHit } from './hit.ts';
import { Special } from './types.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const BOMB = gridNo(80, 80);
const NEXT_TO_THE_BOMB = BOMB - 160;
const GORE_DEATHS = new Set(['BODYEXPLODING', 'CHARIOTS_OF_FIRE']);

interface Death {
  readonly animations: ReadonlySet<string>;
  readonly corpseFile: string | null;
  readonly expectedFile: (gore: boolean) => string;
  readonly events: readonly string[];
}

function sandbox(): TacticalSim {
  const base = syntheticWorld(testDoorCosts(), () => {});
  const world = { ...base, map: { doors: [], placements: [] }, mapPath: 'synthetic' } as unknown as TacticalWorld;
  return new TacticalSim(world, content, 3);
}

function victim(sim: TacticalSim): Soldier {
  const s = spawnSoldier(sim, 1, Team.ENEMY, NEXT_TO_THE_BOMB, Direction.NORTH, { life: 1 });
  deleteObject(s.inv[InvSlot.HAND] as NonNullable<(typeof s.inv)[number]>);
  return s;
}

function corpseFileAt(sim: TacticalSim, g: number): string | null {
  const t = sim.state;
  const corpse = t.world.structures.find(g, StructureFlags.CORPSE);
  if (!corpse) return null;
  for (const [name, file] of t.content.corpses.structures) if (file.structures.includes(corpse.def)) return name;
  return null;
}

function explosionDeath(bloodAndGore: boolean): Death {
  const sim = sandbox();
  const t = sim.state;
  expect(sim.dispatch({ type: 'setOption', bloodAndGore }).ok).toBe(true);
  const s = victim(sim);
  const animations = new Set<string>();
  const step = sim.step.bind(sim);
  sim.step = () => {
    step();
    animations.add(animName(t.content, s.state));
  };
  igniteExplosion(t, null, 0, BOMB, itemId(t, 'HAND_GRENADE'), 0);
  const events = runExplosivesUntilIdle(sim).map((e) => e.type);
  const corpse = t.corpses.find((c) => c.gridNo === s.gridNo);
  const table = t.content.corpses.table;
  return {
    animations,
    corpseFile: corpseFileAt(sim, s.gridNo),
    expectedFile: (gore) => (corpse ? corpseFileBase(table, corpse.type, gore) : ''),
    events,
  };
}

function headShotDeath(bloodAndGore: boolean): ReadonlySet<string> {
  const sim = sandbox();
  const t = sim.state;
  sim.dispatch({ type: 'setOption', bloodAndGore });
  const target = victim(sim);
  const shooter = spawnSoldier(sim, 0, Team.OUR, NEXT_TO_THE_BOMB + 160, Direction.NORTH);
  const gun = shooter.inv[InvSlot.HAND]?.item ?? 0;
  const animations = new Set<string>();
  eventSoldierGotHit(t, target, gun, 40, 0, Direction.NORTH, 1, shooter, Special.HEAD_EXPLODE, 0);
  animations.add(animName(t.content, target.state));
  for (let tick = 0; tick < 400 && !target.dead; tick++) {
    sim.step();
    animations.add(animName(t.content, target.state));
  }
  return animations;
}

describe('blood and gore (TOPTION_BLOOD_N_GORE) changes deaths', () => {
  it('a close head shot throws the body back two tiles only with blood and gore on', () => {
    expect(headShotDeath(true).has('JFK_HITDEATH')).toBe(true);
    expect(headShotDeath(false).has('JFK_HITDEATH')).toBe(false);
  });

  it('a soldier next to a grenade blows apart with blood and gore on and falls over without it', () => {
    const gory = explosionDeath(true);
    const clean = explosionDeath(false);
    expect(gory.events).toContain('soldierDied');
    expect(clean.events).toContain('soldierDied');
    expect([...gory.animations].some((a) => GORE_DEATHS.has(a))).toBe(true);
    expect([...clean.animations].some((a) => GORE_DEATHS.has(a))).toBe(false);
    expect(gory.events).toContain('optionChanged');
  });

  it('the corpse comes from the bloody or the clean structure file', () => {
    const gory = explosionDeath(true);
    const clean = explosionDeath(false);
    expect(gory.corpseFile).not.toBeNull();
    expect(clean.corpseFile).not.toBeNull();
    expect(gory.corpseFile).toBe(gory.expectedFile(true));
    expect(clean.corpseFile).toBe(clean.expectedFile(false));
    expect(gory.corpseFile).not.toBe(clean.corpseFile);
  });
});

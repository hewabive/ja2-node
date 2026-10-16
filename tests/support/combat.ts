import { expect } from 'vitest';
import { Orientation } from '../../src/content/formats/jsd.ts';
import { StructureFlags } from '../../src/content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../src/content/world/synthetic.ts';
import type { TacticalWorld } from '../../src/content/world/tactical-world.ts';
import { advance } from '../../src/sim/advance.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import { createItem } from '../../src/sim/items/object.ts';
import { initNewSoldierAnim, states } from '../../src/sim/tactical/animation.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { InvSlot } from '../../src/sim/tactical/inventory.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import { calcActionPoints } from '../../src/sim/tactical/points.ts';
import { createSoldier, type Soldier, type SoldierStats } from '../../src/sim/tactical/soldier.ts';
import { registerSoldier } from '../../src/sim/tactical/state.ts';
import { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import { testDoorCosts } from './tactical.ts';

export function combatStats(marksmanship: number): SoldierStats {
  return {
    agility: 70,
    dexterity: 70,
    strength: 70,
    wisdom: 70,
    leadership: 50,
    marksmanship,
    mechanical: 30,
    explosives: 30,
    medical: 30,
    experience: 3,
  };
}

export function newCombatSim(
  content: TacticalContent,
  walls: readonly number[] = [],
  seed = 3,
  roofs: ReadonlySet<number> = new Set(),
): TacticalSim {
  const base = syntheticWorld(
    testDoorCosts(),
    (structures) => {
      for (const g of walls) structures.add(g, 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_RIGHT, { armour: 12 }));
      for (const g of roofs) structures.add(g, 1, syntheticStructure(StructureFlags.NORMAL_ROOF, Orientation.NONE, { height: 1 }));
    },
    roofs,
  );
  const world = { ...base, map: { doors: [], placements: [] }, mapPath: 'synthetic' } as unknown as TacticalWorld;
  return new TacticalSim(world, content, seed);
}

export interface SpawnOptions {
  readonly marksmanship?: number;
  readonly life?: number;
  readonly gun?: string;
  readonly profile?: number;
}

export function spawnSoldier(
  sim: TacticalSim,
  id: number,
  team: number,
  at: number,
  direction: number,
  options: SpawnOptions = {},
): Soldier {
  const t = sim.state;
  const content = t.content;
  const s = createSoldier({
    id,
    team,
    name: `S${id}`,
    ...(options.profile !== undefined ? { profile: options.profile } : {}),
    bodyType: 0,
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    stats: combatStats(options.marksmanship ?? 70),
    life: options.life ?? 80,
    gridNo: at,
    direction,
    state: states(content.animations).STANDING,
  });
  const gun = content.items.byName.get(options.gun ?? 'GLOCK_17')?.index ?? 0;
  s.inv[InvSlot.HAND] = createItem(content.items, gun, 100);
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  initNewSoldierAnim(t, s, states(content.animations).STANDING, 0, true);
  s.actionPoints = calcActionPoints(content, s);
  return s;
}

export function runUntilIdle(sim: TacticalSim, ticks = 50_000): SimEvent[] {
  const report = advance(
    {
      get tick() {
        return sim.tick;
      },
      isIdle: () => sim.isIdle(),
      hasPendingDecision: () => sim.hasPendingDecision(),
      step: () => sim.step(),
      drainEvents: () => sim.drainEvents(),
    },
    { idle: true },
    ticks,
  );
  expect(report.reason).toBe('idle');
  return [...report.events];
}

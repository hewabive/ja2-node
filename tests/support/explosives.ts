import { expect } from 'vitest';
import { Rng, type RngState } from '../../src/core/rng.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import { createItem, type ItemObject } from '../../src/sim/items/object.ts';
import { explosivesBusy as isExplosivesBusy } from '../../src/sim/tactical/explosions/state.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';

export function explosivesBusy(t: TacticalState): boolean {
  return isExplosivesBusy(t.explosives);
}

export function stepWithExplosives(sim: TacticalSim): void {
  sim.step();
}

export function runExplosivesUntilIdle(sim: TacticalSim, maxTicks = 20_000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < maxTicks; tick++) {
    if (!explosivesBusy(sim.state) && sim.isIdle()) {
      events.push(...sim.drainEvents());
      return events;
    }
    stepWithExplosives(sim);
    events.push(...sim.drainEvents());
  }
  expect.unreachable('explosives never settled');
  return events;
}

export function objectOf(t: TacticalState, name: string, status = 100): ItemObject {
  const def = t.content.items.byName.get(name);
  if (!def) throw new Error(`unknown item ${name}`);
  return createItem(t.content.items, def.index, status);
}

export function itemId(t: TacticalState, name: string): number {
  const def = t.content.items.byName.get(name);
  if (!def) throw new Error(`unknown item ${name}`);
  return def.index;
}

export interface DrawCount {
  readonly pre: number;
  readonly main: number;
}

const MAX_COUNTED_DRAWS = 100_000;

function mainAdvance(before: RngState, after: RngState): number {
  const probe = Rng.fromState(before);
  const target = JSON.stringify(after);
  for (let n = 0; n < MAX_COUNTED_DRAWS; n++) {
    if (JSON.stringify(probe.state()) === target) return n;
    probe.nextU32();
  }
  throw new Error('main stream advanced too far to count');
}

export function countDraws(t: TacticalState, run: () => void): DrawCount {
  const rngBefore = t.rng.state();
  const preBefore = t.pre.state().index;
  run();
  const pre = (t.pre.state().index - preBefore + 256) % 256;
  const advance = mainAdvance(rngBefore, t.rng.state());
  return { pre, main: advance - pre };
}

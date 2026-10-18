import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { anim, animName } from '../anim-states.ts';
import { initNewSoldierAnim } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { type Soldier, Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { eventSoldierGotHit } from './hit.ts';
import { Special } from './types.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const CIVILIAN_AT = gridNo(80, 80);
const SHOOTER_AT = gridNo(80, 84);
const LETHAL = 40;
const GRAZE = 10;
const COWER_TICKS = 400;
const DEATH_TICKS = 2000;

function cowering(): { sim: TacticalSim; civilian: Soldier; shooter: Soldier; gun: number } {
  const base = syntheticWorld(testDoorCosts(), () => {});
  const world = { ...base, map: { doors: [], placements: [] }, mapPath: 'synthetic' } as unknown as TacticalWorld;
  const sim = new TacticalSim(world, content, 3);
  const t = sim.state;
  const civilian = spawnSoldier(sim, 116, Team.CIV, CIVILIAN_AT, Direction.SOUTH, { life: 30 });
  const shooter = spawnSoldier(sim, 0, Team.OUR, SHOOTER_AT, Direction.NORTH);
  t.inCombat = true;
  civilian.cowering = true;
  initNewSoldierAnim(t, civilian, anim(t.content, 'START_COWER'), 0, false);
  return { sim, civilian, shooter, gun: shooter.inv[InvSlot.HAND]?.item ?? 0 };
}

function shotInFlight(sim: TacticalSim): void {
  sim.state.turn.attackBusyCount = 1;
}

function runUntil(sim: TacticalSim, ticks: number, done: () => boolean): void {
  for (let tick = 0; tick < ticks && !done(); tick++) sim.step();
}

describe('a hit that lands while the target plays a non-interruptible animation', () => {
  it('releases the attack busy count although the hit animation cannot start, and a later hit still kills', () => {
    const { sim, civilian, shooter, gun } = cowering();
    const t = sim.state;
    expect(civilian.inNonInterruptibleAnimation).toBe(true);
    shotInFlight(sim);
    eventSoldierGotHit(t, civilian, gun, LETHAL, 0, Direction.SOUTH, 1, shooter, Special.NONE, 0);
    expect(civilian.life).toBe(0);
    expect(animName(t.content, civilian.state)).toBe('START_COWER');
    expect(t.turn.attackBusyCount).toBe(0);
    expect(civilian.beingAttackedCount).toBe(0);

    runUntil(sim, COWER_TICKS, () => animName(t.content, civilian.state) === 'COWERING');
    expect(civilian.dead).toBe(false);
    shotInFlight(sim);
    eventSoldierGotHit(t, civilian, gun, GRAZE, 0, Direction.SOUTH, 1, shooter, Special.NONE, 0);
    runUntil(sim, DEATH_TICKS, () => civilian.dead && t.turn.attackBusyCount === 0);
    expect(civilian.dead).toBe(true);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('keeps a hit on a soldier free to play it as before', () => {
    const { sim, civilian, shooter, gun } = cowering();
    const t = sim.state;
    runUntil(sim, COWER_TICKS, () => animName(t.content, civilian.state) === 'COWERING');
    shotInFlight(sim);
    eventSoldierGotHit(t, civilian, gun, GRAZE, 0, Direction.SOUTH, 1, shooter, Special.NONE, 0);
    expect(t.turn.attackBusyCount).toBe(1);
    expect(civilian.beingAttackedCount).toBe(1);
  });
});

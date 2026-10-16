import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { countDraws, itemId, objectOf, runExplosivesUntilIdle } from '../../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { igniteExplosion, Spread, spreadEffectSmoke } from './explosion.ts';
import {
  ANY_SMOKE,
  checkForRunningIntoGas,
  clearGassedAtTurnStart,
  decaySmokeEffects,
  inGas,
  inGasOrSmoke,
  inSmoke,
  isGassed,
  newSmokeEffect,
  SmokeTile,
  smokeFlagsAt,
  updateGassedOnNewGridNo,
} from './smoke.ts';
import type { SmokeCloud } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const CENTRE = gridNo(80, 80);

function soldierAt(sim: TacticalSim, id: number, at: number): Soldier {
  return spawnSoldier(sim, id, Team.OUR, at, Direction.NORTH, { life: 100 });
}

function cloudAt(t: TacticalState, item: string): SmokeCloud {
  newSmokeEffect(t, CENTRE, itemId(t, item), 0, null);
  const cloud = t.explosives.smokeClouds.at(-1);
  if (!cloud) throw new Error('no cloud');
  return cloud;
}

function gassedTiles(t: TacticalState): number {
  let n = 0;
  for (const flags of t.explosives.smokeTiles[0]) if (flags & ANY_SMOKE) n++;
  return n;
}

describe('smoke clouds', () => {
  it('spawn from a tear gas grenade at the animation key frame and hold breath damage', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = soldierAt(sim, 0, CENTRE);
    igniteExplosion(t, null, 0, CENTRE, itemId(t, 'TEARGAS_GRENADE'), 0);
    runExplosivesUntilIdle(sim);
    expect(t.explosives.smokeClouds).toHaveLength(1);
    expect(gassedTiles(t)).toBe(5);
    expect(smokeFlagsAt(t, CENTRE, 0)).toBe(SmokeTile.TEARGAS);
    expect(s.life).toBe(100);
    expect(s.breath).toBeLessThan(100);
    expect(inGas(t, s, CENTRE)).toBe(true);
    expect(inSmoke(t, s, CENTRE)).toBe(false);
  });

  it('grow by one tile per round to the maximum radius and vanish after their duration', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    t.inCombat = true;
    const cloud = cloudAt(t, 'TEARGAS_GRENADE');
    const radii: number[] = [];
    const tiles: number[] = [];
    for (let round = 0; round < 6; round++) {
      decaySmokeEffects(t);
      radii.push(t.explosives.smokeClouds[0]?.radius ?? 0);
      tiles.push(gassedTiles(t));
    }
    expect(cloud.age).toBe(6);
    expect(radii).toEqual([1, 2, 3, 4, 4, 0]);
    expect(tiles).toEqual([5, 13, 29, 49, 49, 0]);
    expect(t.explosives.smokeClouds[0]).toBeNull();
  });

  it('last three turns longer indoors', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    t.inCombat = true;
    t.world.terrain[CENTRE] = Terrain.FLAT_FLOOR;
    const cloud = cloudAt(t, 'TEARGAS_GRENADE');
    expect(cloud.duration).toBe(8);
    for (let round = 0; round < 8; round++) decaySmokeEffects(t);
    expect(t.explosives.smokeClouds[0]).toBe(cloud);
    decaySmokeEffects(t);
    expect(t.explosives.smokeClouds[0]).toBeNull();
  });

  it('age only after more than ten world seconds in real time, catching up several steps at once', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const cloud = cloudAt(t, 'SMOKE_GRENADE');
    t.explosives.worldMs = 10_000;
    decaySmokeEffects(t);
    expect(cloud.age).toBe(0);
    t.explosives.worldMs = 11_000;
    decaySmokeEffects(t);
    expect(cloud.age).toBe(1);
    t.explosives.worldMs = 45_000;
    decaySmokeEffects(t);
    expect(cloud.age).toBe(4);
    expect(cloud.radius).toBe(4);
  });

  it('mark plain smoke for sight without hurting anybody', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = soldierAt(sim, 0, CENTRE);
    cloudAt(t, 'SMOKE_GRENADE');
    expect(inSmoke(t, s, CENTRE)).toBe(true);
    expect(inGas(t, s, CENTRE)).toBe(false);
    expect(inGasOrSmoke(t, s, CENTRE + 1)).toBe(true);
    expect(s.breath).toBe(100);
  });
});

describe('gas damage', () => {
  it('wounds a soldier in mustard gas once per round with two PreRandom draws', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    t.inCombat = true;
    const s = soldierAt(sim, 0, CENTRE);
    const cloud = cloudAt(t, 'MUSTARD_GRENADE');
    const afterBlast = s.life;
    expect(100 - afterBlast).toBeGreaterThanOrEqual(15);
    expect(100 - afterBlast).toBeLessThanOrEqual(29);
    const draws = countDraws(t, () => decaySmokeEffects(t));
    expect(draws).toEqual({ pre: 2, main: 1 });
    expect(afterBlast - s.life).toBeGreaterThanOrEqual(15);
    expect(afterBlast - s.life).toBeLessThanOrEqual(29);
    const lifeAfterRound = s.life;
    spreadEffectSmoke(t, cloud, Spread.REDO, 0);
    expect(s.life).toBe(lifeAfterRound);
  });

  it('is kept out by a working gas mask, which wears a little', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = soldierAt(sim, 0, CENTRE);
    s.inv[InvSlot.HEAD1] = objectOf(t, 'GASMASK');
    cloudAt(t, 'MUSTARD_GRENADE');
    expect(s.life).toBe(100);
    expect(s.breath).toBe(100);
    expect(s.inv[InvSlot.HEAD1]?.status[0]).toBeGreaterThan(96);
    expect(inGas(t, s, CENTRE)).toBe(false);
  });

  it('leaks breath damage through a worn-out mask and gasses the wearer', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = soldierAt(sim, 0, CENTRE);
    s.inv[InvSlot.HEAD1] = objectOf(t, 'GASMASK', 20);
    cloudAt(t, 'TEARGAS_GRENADE');
    expect(s.breath).toBeLessThan(100);
    expect(isGassed(t, s)).toBe(true);
  });

  it('sets and clears the gassed state by tile and mask', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = soldierAt(sim, 0, CENTRE + 5);
    cloudAt(t, 'SMOKE_GRENADE');
    updateGassedOnNewGridNo(t, s, CENTRE);
    expect(isGassed(t, s)).toBe(true);
    clearGassedAtTurnStart(t, s);
    expect(isGassed(t, s)).toBe(false);
  });

  it('never stops a walker with a good mask, nor one on his first step', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = soldierAt(sim, 0, CENTRE);
    cloudAt(t, 'TEARGAS_GRENADE');
    s.pathIndex = 0;
    expect(checkForRunningIntoGas(t, s)).toBe(false);
    s.inv[InvSlot.HEAD1] = objectOf(t, 'GASMASK');
    s.pathIndex = 1;
    for (let k = 0; k < 20; k++) expect(checkForRunningIntoGas(t, s)).toBe(false);
  });
});

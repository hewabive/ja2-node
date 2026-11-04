import { beforeAll, describe, expect, it } from 'vitest';
import { estimateAttack, newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { UnsuppliedFieldError } from '../knowledge/guard.ts';
import { apsToDropBomb } from '../tactical/bombs/planting.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { newSmokeEffect } from '../tactical/explosions/smoke.ts';
import { calculateLaunchItemChanceToGetThrough } from '../tactical/explosions/trajectory.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { AP } from '../tactical/points.ts';
import { Team } from '../tactical/soldier.ts';

const MERC_AT = gridNo(80, 80);
const PATIENT_AT = gridNo(80, 82);

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function cursorFor(item: string) {
  const sim = newCombatSim(content);
  spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH, { gun: item });
  spawnSoldier(sim, 1, Team.OUR, PATIENT_AT, Direction.NORTH);
  sim.lookAround();
  return estimateAttack(sim, { soldier: 0, target: PATIENT_AT });
}

describe('the item cursor of the hand item', () => {
  it('answers the medkit, the remote trigger and the tools with their cursor kind instead of a refusal', () => {
    expect(cursorFor('FIRSTAIDKIT')).toMatchObject({ ok: true, data: { cursor: 'aid', apCost: 0 } });
    expect(cursorFor('REMOTETRIGGER')).toMatchObject({ ok: true, data: { cursor: 'remote', apCost: AP.USE_REMOTE } });
    expect(cursorFor('WIRECUTTERS')).toMatchObject({ ok: true, data: { cursor: 'wirecutter' } });
    expect(cursorFor('CANTEEN')).toMatchObject({ ok: true, data: { cursor: 'invalid' } });
  });

  it('answers the bomb cursor with the walk onto the tile plus AP_DROP_BOMB, and 0 for a tile out of reach (GetTotalAPsToDropBomb)', () => {
    const sim = newCombatSim(content);
    const sapper = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH, { gun: 'MINE' });
    spawnSoldier(sim, 1, Team.OUR, PATIENT_AT, Direction.NORTH);
    sim.lookAround();
    const free = gridNo(83, 80);
    expect(apsToDropBomb(sim.state, sapper, free)).toBeGreaterThan(AP.DROP_BOMB);
    expect(estimateAttack(sim, { soldier: 0, target: MERC_AT })).toMatchObject({
      ok: true,
      data: { cursor: 'bomb', apCost: AP.DROP_BOMB },
    });
    expect(estimateAttack(sim, { soldier: 0, target: free })).toMatchObject({
      ok: true,
      data: { cursor: 'bomb', apCost: apsToDropBomb(sim.state, sapper, free) },
    });
    expect(estimateAttack(sim, { soldier: 0, target: PATIENT_AT })).toMatchObject({ ok: true, data: { cursor: 'bomb', apCost: 0 } });
  });
});

describe('a merc in deep water', () => {
  it('gets the invalid cursor with a gun in his hand', () => {
    const sim = newCombatSim(content, [], 3, new Set(), (world) => {
      world.terrain[MERC_AT] = Terrain.DEEP_WATER;
    });
    spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH, { gun: 'GLOCK_17' });
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 90), Direction.NORTH);
    sim.lookAround();
    expect(estimateAttack(sim, { soldier: 0, target: enemy.gridNo })).toMatchObject({ ok: true, data: { cursor: 'invalid' } });
  });
});

describe('the chance to hit through smoke and gas', () => {
  it('reads the gas clouds the squad sees, so the estimate is the chance the shot is fired at', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 90), Direction.NORTH);
    sim.lookAround();
    sim.drainEvents();
    const chanceToHit = () => (estimateAttack(sim, { soldier: 0, target: enemy.gridNo }).data as { chanceToHit: number }).chanceToHit;
    const clear = chanceToHit();
    newSmokeEffect(sim.state, gridNo(80, 85), content.items.byName.get('TEARGAS_GRENADE')?.index ?? -1, 0, null);
    const throughGas = chanceToHit();
    expect(throughGas).toBeLessThan(clear);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({ ok: true });
    expect(runUntilIdle(sim).find((e) => e.type === 'shotFired')).toMatchObject({ chance: throughGas });
  });
});

describe('a shooter on drink or adrenaline', () => {
  it("reads the drunk level the view shows: a drunk merc's estimate is the cost and chance of the shot he fires", () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 90), Direction.NORTH);
    sim.lookAround();
    sim.drainEvents();
    const estimate = () => estimateAttack(sim, { soldier: 0, target: enemy.gridNo }).data as { apCost: number; chanceToHit: number };
    const sober = estimate();
    merc.drugs.alcohol.effect = 40;
    const drunk = estimate();
    expect(drunk.chanceToHit).toBeLessThan(sober.chanceToHit);
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(events.find((e) => e.type === 'shotFired')).toMatchObject({ chance: drunk.chanceToHit });
    expect(before - merc.actionPoints).toBe(drunk.apCost);
  });

  it('leaves the adrenaline numbers out of the view: a strict estimate for a merc under it fails on the read', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 90), Direction.NORTH);
    sim.lookAround();
    merc.drugs.adrenaline.effect = 4;
    expect(() => estimateAttack(sim, { soldier: 0, target: enemy.gridNo })).toThrow(UnsuppliedFieldError);
  });
});

describe('a throw underground', () => {
  it('lands a toss beyond reach where the loaded sector throws it, shorter in a cave than on the surface', () => {
    const beyondReach = gridNo(80, 110);
    const CAVES = { ambient: { basement: false, caves: true, lightLevel: 10 } };
    const landings = (mapFields: typeof CAVES | Record<string, never>) => {
      const sim = newCombatSim(content, [], 3, new Set(), () => undefined, mapFields);
      const s = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH, { gun: 'HAND_GRENADE' });
      const grenade = s.inv[InvSlot.HAND];
      if (!grenade) throw new Error('no grenade');
      const estimate = estimateAttack(sim, { soldier: 0, target: beyondReach }).data as { landsAt: number };
      const server = calculateLaunchItemChanceToGetThrough(sim.state, s, grenade, beyondReach, 0, 0, false, true);
      return { estimate: estimate.landsAt, server: server.gridNo };
    };
    const surface = landings({});
    const cave = landings(CAVES);
    expect(cave.estimate).toBe(cave.server);
    expect(surface.estimate).toBe(surface.server);
    expect(Math.trunc(cave.estimate / 160)).toBeLessThan(Math.trunc(surface.estimate / 160));
  });
});

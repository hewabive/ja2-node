import { beforeAll, describe, expect, it } from 'vitest';
import { estimateAttack, newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { newSmokeEffect } from '../tactical/explosions/smoke.ts';
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

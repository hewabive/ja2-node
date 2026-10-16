import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo, pythSpacesAway } from '../../../content/world/grid.ts';
import { emptyObject } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { Opp } from '../perception/opp.ts';
import { AlertStatus, Orders, Team } from '../soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('combat AI', () => {
  it('lets an enemy who sees our merc shoot at him on the enemy turn', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    sim.drainEvents();
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
    const events = runUntilIdle(sim);
    expect(enemy.ai.alertStatus).toBe(AlertStatus.BLACK);
    expect(events.some((e) => e.type === 'shotFired' && e.soldier === enemy.id)).toBe(true);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('lets an armed enemy interrupt a merc who walks into view and shoot him', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.NORTH);
    merc.stats.experience = 1;
    const watcher = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 60), Direction.EAST);
    watcher.stats.experience = 10;
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    expect(sim.dispatch({ type: 'move', soldier: 0, to: gridNo(80, 70), mode: 'walk' }).ok).toBe(true);
    const events = runUntilIdle(sim);
    expect(events.some((e) => e.type === 'shotFired' && e.soldier === watcher.id)).toBe(true);
    expect(t.turn.currentTeam).toBe(Team.OUR);
    expect(merc.gridNo).not.toBe(gridNo(80, 70));
  });

  it('sends an alerted enemy who only knows of our merc by radio towards him', () => {
    const wallRow = 90;
    const walls = Array.from({ length: 21 }, (_, k) => gridNo(70 + k, wallRow));
    const sim = newCombatSim(content, walls);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const spotter = spawnSoldier(sim, 20, Team.ENEMY, gridNo(84, 84), Direction.NORTHWEST);
    spotter.inv[InvSlot.HAND] = emptyObject();
    const hidden = spawnSoldier(sim, 21, Team.ENEMY, gridNo(80, 100), Direction.NORTH);
    hidden.ai.orders = Orders.SEEKENEMY;
    t.perception.awareOfOpposition[Team.ENEMY] = true;
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    expect(hidden.oppList[merc.id]).not.toBe(Opp.SEEN_CURRENTLY);
    expect(t.perception.publicOpp[Team.ENEMY]?.[merc.id]).toBe(Opp.SEEN_CURRENTLY);
    const before = pythSpacesAway(hidden.gridNo, merc.gridNo);
    sim.drainEvents();
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
    runUntilIdle(sim);
    expect(hidden.ai.alertStatus).toBeGreaterThanOrEqual(AlertStatus.RED);
    expect(pythSpacesAway(hidden.gridNo, merc.gridNo)).toBeLessThan(before);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo, pythSpacesAway } from '../../../content/world/grid.ts';
import type { SimEvent } from '../../events.ts';
import { createItem, emptyObject } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { NO_NARRATIVE_PORT } from '../narrative/port.ts';
import { Opp } from '../perception/opp.ts';
import { calcActionPoints } from '../points.ts';
import { AlertStatus, Orders, type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { exitCombatMode } from '../turns/turns.ts';
import { addItemToPool, Visibility } from '../world-items.ts';
import { AiAction } from './actions.ts';
import { npcDoesAct } from './control.ts';

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

describe('combat AI item search', () => {
  it('sends an unarmed enemy to pick up a gun lying nearby', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 70), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 84), Direction.NORTH);
    enemy.inv[InvSlot.HAND] = emptyObject();
    enemy.stats.wisdom = 90;
    const glock = t.content.items.byName.get('GLOCK_17')?.index ?? 0;
    addItemToPool(t, gridNo(81, 85), createItem(t.content.items, glock, 100), Visibility.INVISIBLE, 0);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    sim.drainEvents();
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
    runUntilIdle(sim);
    expect(enemy.inv.some((o) => o.item === glock)).toBe(true);
    expect(t.worldItems).toHaveLength(0);
  });
});

describe('an AI attack decided in real time (AIMain.cc NPCDoesAct, TeamTurns.cc DisplayHiddenTurnbased)', () => {
  const MAX_AP_CARRIED = 5;

  interface TurnEvent {
    readonly type: string;
    readonly team?: number;
    readonly round?: number;
    readonly soldier?: number;
  }

  function turnEvents(events: readonly SimEvent[]): TurnEvent[] {
    return events.flatMap((e): TurnEvent[] => {
      switch (e.type) {
        case 'combatStarted':
        case 'interrupt':
          return [{ type: e.type, team: e.team }];
        case 'turnStarted':
          return [{ type: e.type, team: e.team, round: e.round }];
        case 'aiTurn':
        case 'shotFired':
          return [{ type: e.type, soldier: e.soldier }];
        default:
          return [];
      }
    });
  }

  function standoffAfterCombat(): { sim: TacticalSim; attacker: Soldier; other: Soldier; mercs: Soldier[] } {
    const sim = newCombatSim(content);
    const t = sim.state;
    const mercs = [0, 1].map((id) => spawnSoldier(sim, id, Team.OUR, gridNo(80 + 3 * id, 80), Direction.SOUTH));
    const [attacker, other] = [20, 21].map((id) =>
      spawnSoldier(sim, id, Team.ENEMY, gridNo(80 + 3 * (id - 20), 88), Direction.NORTH, { marksmanship: 35 }),
    ) as [Soldier, Soldier];
    for (const s of mercs) s.stats.experience = 9;
    for (const s of [attacker, other]) s.stats.experience = 1;
    sim.lookAround();
    expect([t.inCombat, t.turn.currentTeam, t.turn.aiList.length]).toEqual([true, Team.OUR, 0]);
    expect([attacker.ai.oppCount, other.ai.oppCount]).toEqual([2, 2]);
    exitCombatMode(t);
    sim.drainEvents();
    return { sim, attacker, other, mercs };
  }

  function stepUntilCombat(sim: TacticalSim): SimEvent[] {
    const events: SimEvent[] = [];
    for (let tick = 0; tick < 4000 && !sim.state.inCombat; tick++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    return events;
  }

  it("starts combat on the attacker's team turn before he shoots, with the turn his and the interface locked", () => {
    const { sim, attacker, other, mercs } = standoffAfterCombat();
    const t = sim.state;
    expect(turnEvents(stepUntilCombat(sim))).toEqual([{ type: 'combatStarted', team: Team.ENEMY }]);
    expect(t.turn.currentTeam).toBe(Team.ENEMY);
    expect([attacker.aiTurnControl, attacker.turnInProgress, other.aiTurnControl]).toEqual([true, true, false]);
    expect([attacker.ai.lastAction, attacker.ai.action]).toEqual([AiAction.FIRE_GUN, AiAction.NONE]);
    for (const s of [...mercs, attacker, other]) expect(s.actionPoints).toBe(calcActionPoints(s) + MAX_AP_CARRIED);
    expect(sim.combatView()).toMatchObject({
      team: Team.ENEMY,
      round: 1,
      interrupt: false,
      uiLocked: true,
      topMessage: { kind: 'computerTurn', team: Team.ENEMY, bloodcats: false },
      aiTurn: attacker.id,
    });
    const turn = turnEvents(runUntilIdle(sim));
    expect(turn.filter((e) => e.type === 'shotFired' && e.soldier === attacker.id).length).toBeGreaterThan(0);
    expect(turn.filter((e) => e.type !== 'shotFired')).toEqual([{ type: 'turnStarted', team: Team.OUR, round: 2 }]);
  });

  it('leaves the rest of his team out of that turn though they see us: the original builds no AI list for it', () => {
    const { sim, other } = standoffAfterCombat();
    stepUntilCombat(sim);
    const hiddenTurn = turnEvents(runUntilIdle(sim));
    expect(hiddenTurn.some((e) => e.soldier === other.id)).toBe(false);
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
    const nextTurn = turnEvents(runUntilIdle(sim));
    expect(nextTurn.some((e) => e.type === 'shotFired' && e.soldier === other.id)).toBe(true);
  });

  it('starts nothing during a meanwhile', () => {
    const { sim, attacker } = standoffAfterCombat();
    const t = sim.state;
    t.narrative = { ...NO_NARRATIVE_PORT, inMeanwhile: () => true };
    attacker.ai.action = AiAction.FIRE_GUN;
    npcDoesAct(t, attacker);
    expect([t.inCombat, attacker.aiTurnControl]).toEqual([false, false]);
  });
});

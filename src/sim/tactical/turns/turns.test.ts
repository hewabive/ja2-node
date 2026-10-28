import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { advance } from '../../advance.ts';
import type { SimEvent } from '../../events.ts';
import { createItem } from '../../items/object.ts';
import { AiAction } from '../ai/actions.ts';
import { initNewSoldierAnim, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { setSoldierPosition } from '../movement.ts';
import { Opp } from '../perception/opp.ts';
import { calcActionPoints } from '../points.ts';
import { AlertStatus, CivilianGroup, createSoldier, Side, type Soldier, type SoldierStats, Team } from '../soldier.ts';
import { registerSoldier, type TacticalState } from '../state.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { checkForEndOfCombatMode, checkForPotentialAddToBattleIncrement } from './turns.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const stats = (experience: number): SoldierStats => ({
  agility: 70,
  dexterity: 70,
  strength: 70,
  wisdom: 70,
  leadership: 50,
  marksmanship: 70,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience,
});

function newSim(): TacticalSim {
  const world = {
    ...syntheticWorld(testDoorCosts()),
    map: { doors: [], placements: [] },
    mapPath: 'synthetic',
  } as unknown as TacticalWorld;
  return new TacticalSim(world, content, 3);
}

function spawn(sim: TacticalSim, id: number, team: number, at: number, direction: number, experience = 3): Soldier {
  const t = sim.state;
  const s = createSoldier({
    id,
    team,
    name: `S${id}`,
    bodyType: 0,
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    stats: stats(experience),
    life: 80,
    gridNo: at,
    direction,
    state: states(content.animations).STANDING,
  });
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  initNewSoldierAnim(t, s, states(content.animations).STANDING, 0, true);
  s.actionPoints = calcActionPoints(s);
  return s;
}

function run(sim: TacticalSim, ticks = 50_000): SimEvent[] {
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
  expect(report.reason === 'idle' || report.reason === 'decision').toBe(true);
  return [...report.events];
}

describe('turn-based combat', () => {
  it('starts with the team that saw first and gives everyone a full turn plus carry-over', () => {
    const sim = newSim();
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawn(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    sim.lookAround();
    const t = sim.state;
    expect(t.inCombat).toBe(true);
    expect(t.turn.currentTeam).toBe(Team.OUR);
    expect(merc.actionPoints).toBe(5 + 19);
    expect(sim.isIdle()).toBe(true);
    expect(sim.combatView()).toEqual({
      team: Team.OUR,
      round: 1,
      interrupt: false,
      uiLocked: false,
      topMessage: { kind: 'playerTurn', team: Team.OUR, bloodcats: false },
      ai: null,
    });
  });

  it('passes the turn to the enemy team and back, starting a new round', () => {
    const sim = newSim();
    spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    sim.lookAround();
    sim.drainEvents();
    expect(sim.dispatch({ type: 'endTurn' })).toEqual({ ok: true });
    const events = run(sim);
    expect(events.filter((e) => e.type === 'turnStarted').map((e) => (e as { team: number }).team)).toEqual([Team.ENEMY, Team.OUR]);
    expect(sim.combatView()?.round).toBe(2);
    expect(enemy.moved).toBe(true);
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
  });

  it('refuses orders out of turn and moves that cannot afford the first step', () => {
    const sim = newSim();
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawn(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    sim.lookAround();
    merc.actionPoints = 1;
    const refused = sim.dispatch({ type: 'move', soldier: 0, to: gridNo(70, 80), mode: 'walk' });
    expect(refused.ok).toBe(false);
    expect(merc.goodContPath).toBe(true);
    merc.actionPoints = 20;
    expect(sim.dispatch({ type: 'stance', soldier: 0, stance: 'crouch' }).ok).toBe(true);
    run(sim);
    expect(merc.actionPoints).toBe(18);
    expect(sim.dispatch({ type: 'turn', soldier: 0, direction: Direction.EAST }).ok).toBe(true);
    run(sim);
    expect(merc.actionPoints).toBe(16);
  });

  it('lets a watchful enemy interrupt a merc who walks into view; an idle interrupter stays hidden', () => {
    const sim = newSim();
    const t = sim.state;
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.NORTH, 1);
    const watcher = spawn(sim, 20, Team.ENEMY, gridNo(80, 60), Direction.EAST, 10);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    expect(t.turn.currentTeam).toBe(Team.OUR);
    expect(watcher.oppList[merc.id]).not.toBe(1);
    const controlled: number[] = [];
    const start = t.turnHooks.startNPCAI;
    t.turnHooks = {
      ...t.turnHooks,
      startNPCAI: (state, s) => {
        controlled.push(s.id);
        return start(state, s);
      },
    };
    sim.ai.green.decideActionBlack = () => AiAction.NONE;
    expect(sim.dispatch({ type: 'move', soldier: 0, to: gridNo(80, 70), mode: 'walk' }).ok).toBe(true);
    const events = run(sim);
    expect(watcher.oppList[merc.id]).toBe(1);
    expect(controlled).toEqual([watcher.id]);
    expect(events.some((e) => e.type === 'interrupt')).toBe(false);
    expect(t.turn.currentTeam).toBe(Team.OUR);
    expect(t.turn.intList).toEqual([]);
    expect(merc.gridNo).toBe(gridNo(80, 70));
  });

  it('ends combat instead of the turn when nobody sees an enemy and no hostile is alerted', () => {
    const sim = newSim();
    const t = sim.state;
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    sim.drainEvents();
    setSoldierPosition(t, enemy, gridNo(80, 150));
    merc.oppList[enemy.id] = 0;
    merc.ai.oppCount = 0;
    enemy.oppList[merc.id] = 0;
    enemy.ai.oppCount = 0;
    enemy.ai.alertStatus = AlertStatus.GREEN;
    expect(sim.dispatch({ type: 'endTurn' })).toEqual({ ok: true, data: { combatEnded: true } });
    const events = [...sim.drainEvents(), ...run(sim)];
    expect(events).toContainEqual(expect.objectContaining({ type: 'combatEnded', reason: 'lull' }));
    expect(events.some((e) => e.type === 'turnStarted')).toBe(false);
    expect(t.inCombat).toBe(false);
    expect(enemy.moved).toBe(false);
  });

  it('passes the turn when the end-of-combat check keeps combat going, without counting a turn nobody saw anyone', () => {
    const sim = newSim();
    const t = sim.state;
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    sim.lookAround();
    setSoldierPosition(t, enemy, gridNo(80, 150));
    merc.oppList[enemy.id] = Opp.SEEN_LAST_TURN;
    enemy.oppList[merc.id] = Opp.SEEN_LAST_TURN;
    enemy.ai.alertStatus = AlertStatus.RED;
    t.turn.consNumTurnsNotSeen = 1;
    expect(sim.dispatch({ type: 'endTurn' })).toEqual({ ok: true });
    expect(t.inCombat).toBe(true);
    expect(t.turn.currentTeam).toBe(Team.ENEMY);
    expect(t.turn.consNumTurnsNotSeen).toBe(1);
  });
});

describe('the end-of-combat check', () => {
  function enemyListedFirst(mercSees: number): TacticalState {
    const sim = newSim();
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    sim.lookAround();
    const t = sim.state;
    expect(t.mercSlots.indexOf(enemy)).toBeLessThan(t.mercSlots.indexOf(merc));
    merc.oppList[enemy.id] = mercSees;
    enemy.oppList[merc.id] = Opp.SEEN_CURRENTLY;
    t.turn.consNumTurnsWeHaventSeenButEnemyDoes = 2;
    return t;
  }

  it('looks past an enemy who saw us for one of ours who saw him too', () => {
    const t = enemyListedFirst(Opp.SEEN_THIS_TURN);
    expect(checkForEndOfCombatMode(t, false)).toBe(false);
    expect(t.turn.consNumTurnsWeHaventSeenButEnemyDoes).toBe(0);
  });

  it('counts the turns only the enemy saw someone', () => {
    const t = enemyListedFirst(Opp.SEEN_LAST_TURN);
    expect(checkForEndOfCombatMode(t, false)).toBe(false);
    expect(t.turn.consNumTurnsWeHaventSeenButEnemyDoes).toBe(3);
  });
});

describe('the battle increment', () => {
  function hostileCivilian(group: number, item: string | null, slot: number = InvSlot.HAND): { t: TacticalState; civ: Soldier } {
    const sim = newSim();
    const civ = spawn(sim, 116, Team.CIV, gridNo(80, 80), Direction.SOUTH);
    civ.civilianGroup = group;
    civ.neutral = false;
    civ.side = Side.ENEMY;
    const index = item === null ? null : content.items.byName.get(item)?.index;
    if (index !== null && index !== undefined) civ.inv[slot] = createItem(content.items, index, 100);
    return { t: sim.state, civ };
  }

  function counts(group: number, item: string | null, slot?: number): boolean {
    const { t, civ } = hostileCivilian(group, item, slot);
    checkForPotentialAddToBattleIncrement(t, civ);
    return t.turn.numFoughtInBattle[Team.CIV] === 1;
  }

  it('counts a hostile rebel, Kingpin man or hick who carries a weapon anywhere', () => {
    expect(counts(CivilianGroup.REBEL, 'GLOCK_17')).toBe(true);
    expect(counts(CivilianGroup.KINGPIN, 'COMBAT_KNIFE', InvSlot.SMALLPOCK3)).toBe(true);
    expect(counts(CivilianGroup.HICKS, 'GLOCK_17', InvSlot.BIGPOCK2)).toBe(true);
  });

  it('skips an unarmed member, other civilian groups and neutral or friendly civilians', () => {
    expect(counts(CivilianGroup.KINGPIN, null)).toBe(false);
    expect(counts(CivilianGroup.KINGPIN, 'FIRSTAIDKIT')).toBe(false);
    expect(counts(CivilianGroup.BEGGARS, 'GLOCK_17')).toBe(false);
    expect(counts(CivilianGroup.NONE, 'GLOCK_17')).toBe(false);
    const neutral = hostileCivilian(CivilianGroup.REBEL, 'GLOCK_17');
    neutral.civ.neutral = true;
    checkForPotentialAddToBattleIncrement(neutral.t, neutral.civ);
    const friendly = hostileCivilian(CivilianGroup.REBEL, 'GLOCK_17');
    friendly.civ.side = Side.FRIENDLY;
    checkForPotentialAddToBattleIncrement(friendly.t, friendly.civ);
    expect([neutral.t.turn.numFoughtInBattle[Team.CIV], friendly.t.turn.numFoughtInBattle[Team.CIV]]).toEqual([0, 0]);
  });
});

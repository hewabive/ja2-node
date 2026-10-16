import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { advance } from '../../advance.ts';
import type { SimEvent } from '../../events.ts';
import { AiAction } from '../ai/actions.ts';
import { initNewSoldierAnim, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { setSoldierPosition } from '../movement.ts';
import { calcActionPoints } from '../points.ts';
import { createSoldier, type Soldier, type SoldierStats, Team } from '../soldier.ts';
import { registerSoldier } from '../state.ts';
import { TacticalSim } from '../tactical-sim.ts';

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
  s.actionPoints = calcActionPoints(content, s);
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
    expect(sim.combatView()).toEqual({ team: Team.OUR, round: 1, interrupt: false });
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
    t.turnHooks = { ...t.turnHooks, startNPCAI: (state, s) => (controlled.push(s.id), start(state, s)) };
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

  it('ends combat when nobody sees an enemy and no hostile is alerted', () => {
    const sim = newSim();
    const t = sim.state;
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    setSoldierPosition(t, enemy, gridNo(80, 150));
    merc.oppList[enemy.id] = 0;
    merc.ai.oppCount = 0;
    enemy.oppList[merc.id] = 0;
    enemy.ai.oppCount = 0;
    enemy.ai.alertStatus = 0;
    sim.dispatch({ type: 'endTurn' });
    const events = run(sim);
    expect(events.some((e) => e.type === 'combatEnded')).toBe(true);
    expect(t.inCombat).toBe(false);
  });
});

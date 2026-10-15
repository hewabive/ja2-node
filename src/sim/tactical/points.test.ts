import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { syntheticWorld } from '../../content/world/synthetic.ts';
import { Rng } from '../../core/rng.ts';
import { initNewSoldierAnim, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { getNewSoldierPath, setSoldierPosition } from './movement.ts';
import { executeOverhead } from './overhead.ts';
import {
  AP,
  apsToChangeStance,
  apsToLook,
  calcActionPoints,
  calcNewActionPoints,
  deductPoints,
  MAX_AP_CARRIED,
  ptsToMoveDirection,
  unusedAPsToBreath,
} from './points.ts';
import { createSoldier, type Soldier, Team } from './soldier.ts';
import { createTacticalState, registerSoldier, type TacticalState } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const STATS = {
  agility: 80,
  dexterity: 80,
  strength: 80,
  wisdom: 80,
  leadership: 50,
  marksmanship: 80,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};

function tactical(): TacticalState {
  return createTacticalState({ ...syntheticWorld(testDoorCosts()), mapDoors: new Map() }, content, Rng.fromSeed(5));
}

function spawn(t: TacticalState, at: number): Soldier {
  const st = states(content.animations);
  const s = createSoldier({
    id: t.soldiers.length,
    team: Team.OUR,
    name: 'S',
    bodyType: 0,
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    stats: STATS,
    life: 100,
    gridNo: at,
    direction: Direction.EAST,
    state: st.STANDING,
  });
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  initNewSoldierAnim(t, s, st.STANDING, 0, true);
  s.uiMovementMode = st.WALKING;
  return s;
}

const ctx = (t: TacticalState) => ({ env: t.pathEnv, content: t.content, inCombat: t.inCombat });

describe('action points', () => {
  it('derives turn APs from experience, agility, dexterity, wounds and breath', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    expect(calcActionPoints(content, s)).toBe(21);
    s.life = 50;
    expect(calcActionPoints(content, s)).toBe(18);
    s.breath = 50;
    expect(calcActionPoints(content, s)).toBe(14);
    s.life = 0;
    expect(calcActionPoints(content, s)).toBe(0);
  });

  it('carries at most five APs into the next turn', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    s.actionPoints = 9;
    calcNewActionPoints(content, s);
    expect(s.actionPoints).toBe(MAX_AP_CARRIED + 21 > 25 ? 25 : MAX_AP_CARRIED + 21);
    expect(s.initialActionPoints).toBe(s.actionPoints);
  });

  it('charges APs only in combat but breath always, and floors AP debt from spending', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    s.actionPoints = 3;
    deductPoints(false, s, 5, 100);
    expect(s.actionPoints).toBe(3);
    expect(s.breathRed).toBeGreaterThan(0);
    deductPoints(true, s, 5, 0);
    expect(s.actionPoints).toBe(0);
    s.actionPoints = -4;
    deductPoints(true, s, 2, 0);
    expect(s.actionPoints).toBe(-6);
  });

  it('prices stance changes, turning and a running start', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    const st = states(content.animations);
    expect(apsToChangeStance(content, s, 1)).toBe(AP.CROUCH + AP.PRONE);
    expect(apsToLook(content, s)).toBe(AP.LOOK_STANDING);
    const walk = ptsToMoveDirection(ctx(t), s, Direction.EAST, st.WALKING);
    const run = ptsToMoveDirection(ctx(t), s, Direction.EAST, st.RUNNING);
    expect(walk).toBe(AP.MOVEMENT_FLAT - 1);
    expect(run).toBe(Math.trunc(AP.MOVEMENT_FLAT / 1.8) + AP.START_RUN_COST);
  });

  it('turns unspent APs above the carry-over into breath at the end of a turn', () => {
    const t = tactical();
    t.inCombat = true;
    const s = spawn(t, gridNo(80, 80));
    s.breathRed = 3000;
    s.breath = 70;
    s.actionPoints = 15;
    unusedAPsToBreath(ctx(t), s, false);
    expect(s.breath).toBeGreaterThan(70);
  });
});

describe('moving in combat', () => {
  it('spends APs per tile and halts when they run out', () => {
    const t = tactical();
    t.inCombat = true;
    const s = spawn(t, gridNo(80, 80));
    s.actionPoints = 5;
    expect(getNewSoldierPath(t, s, gridNo(86, 80), s.uiMovementMode)).toBe(true);
    for (let i = 0; i < 5000; i++) executeOverhead(t);
    expect(s.gridNo).toBe(gridNo(82, 80));
    expect(s.actionPoints).toBe(1);
    expect(t.events.some((e) => e.type === 'stopped' && e.reason === 'outOfAPs')).toBe(true);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { QuoteActionId } from '../../content/narrative/npc-constants.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import { Rng } from '../../core/rng.ts';
import { initNewSoldierAnim, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { getNewSoldierPath, setSoldierPosition } from './movement.ts';
import { executeOverhead } from './overhead.ts';
import { Opp } from './perception/opp.ts';
import {
  AP,
  apsToChangeStance,
  apsToLook,
  calcActionPoints,
  calcNewActionPoints,
  deductPoints,
  enoughPoints,
  MAX_AP_CARRIED,
  ptsToMoveDirection,
  terrainActionPoints,
  terrainBreathPoints,
  unusedAPsToBreath,
} from './points.ts';
import { Body, createSoldier, NO_PROFILE, Personality, type Soldier, Team } from './soldier.ts';
import { createTacticalState, registerSoldier, type TacticalState } from './state.ts';

let content: TacticalContent;
const ROOF = 1;

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

function spawn(t: TacticalState, at: number, team: number = Team.OUR, bodyType = 0): Soldier {
  const st = states(content.animations);
  const s = createSoldier({
    id: t.soldiers.length,
    team,
    name: 'S',
    bodyType,
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
    expect(calcActionPoints(t, s)).toBe(21);
    s.life = 50;
    expect(calcActionPoints(t, s)).toBe(18);
    s.breath = 50;
    expect(calcActionPoints(t, s)).toBe(14);
    s.life = 0;
    expect(calcActionPoints(t, s)).toBe(0);
  });

  it('carries at most five APs into the next turn', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    s.actionPoints = 9;
    calcNewActionPoints(t, s);
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

  it('wipes an AP debt when a breath cost would take breath below zero (DeductPoints)', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    s.breathMax = 60;
    s.breathRed = 6000;
    s.breath = 0;
    s.actionPoints = -6;
    deductPoints(true, s, 0, 1000);
    expect([s.actionPoints, s.breath]).toEqual([0, 0]);
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

const MERC_PROFILE = 5;
const MINE_LEVEL = { x: 13, y: 9, z: 1 };

function phobic(t: TacticalState, trait: number): Soldier {
  const s = spawn(t, gridNo(80, 80));
  s.profile = MERC_PROFILE;
  s.personalityTrait = trait;
  return s;
}

function creatureSeenBy(t: TacticalState, s: Soldier, body: number, seen: number): Soldier {
  const creature = spawn(t, gridNo(80, 90), Team.CREATURE, body);
  s.oppList[creature.id] = seen;
  if (seen === Opp.SEEN_CURRENTLY) s.ai.oppCount++;
  return creature;
}

describe('phobias in the turn APs (Soldier_Control.cc CalcActionPoints)', () => {
  it('cuts a claustrophobic merc to nine tenths while the loaded sector is underground', () => {
    const t = tactical();
    const s = phobic(t, Personality.CLAUSTROPHOBIC);
    expect(calcActionPoints(t, s)).toBe(21);
    t.sector = MINE_LEVEL;
    expect(calcActionPoints(t, s)).toBe(18);
  });

  it('cuts a claustrophobic merc not placed yet too: the cut reads the loaded sector only', () => {
    const t = tactical();
    t.sector = MINE_LEVEL;
    const s = phobic(t, Personality.CLAUSTROPHOBIC);
    s.placed = false;
    expect(calcActionPoints(t, s)).toBe(18);
  });

  it('leaves an unprofiled soldier with the trait his full points', () => {
    const t = tactical();
    t.sector = MINE_LEVEL;
    const s = phobic(t, Personality.CLAUSTROPHOBIC);
    s.profile = NO_PROFILE;
    expect(calcActionPoints(t, s)).toBe(21);
  });

  it('cuts an insect-phobic merc to eight tenths while he sees a creature, not a bloodcat', () => {
    const t = tactical();
    const s = phobic(t, Personality.FEAR_OF_INSECTS);
    creatureSeenBy(t, s, Body.BLOODCAT, Opp.SEEN_CURRENTLY);
    expect(calcActionPoints(t, s)).toBe(21);
    creatureSeenBy(t, s, Body.YAM_MONSTER, Opp.SEEN_CURRENTLY);
    expect(calcActionPoints(t, s)).toBe(16);
  });

  it('cuts an insect-phobic merc for a creature he only heard while he sees anyone: MercSeesCreature reads any opplist entry', () => {
    const t = tactical();
    const s = phobic(t, Personality.FEAR_OF_INSECTS);
    creatureSeenBy(t, s, Body.YAM_MONSTER, Opp.HEARD_THIS_TURN);
    expect(calcActionPoints(t, s)).toBe(21);
    s.ai.oppCount = 1;
    expect(calcActionPoints(t, s)).toBe(16);
  });
});

describe('enough points (Points.cc EnoughPoints)', () => {
  it('lets a soldier waiting to move with others act without APs, even collapsed: the waiting test comes first', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    s.actionPoints = 0;
    s.collapsed = true;
    expect(enoughPoints(true, s, AP.PICKUP_ITEM)).toBe(false);
    s.waitActionToDo = 1;
    expect(enoughPoints(true, s, AP.PICKUP_ITEM)).toBe(true);
  });

  it('lets a soldier traversing off the map act without APs unless he is collapsed', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80), Team.CIV);
    s.actionPoints = 0;
    for (const traversal of [QuoteActionId.TRAVERSE_EAST, QuoteActionId.TRAVERSE_NORTH]) {
      s.quoteActionId = traversal;
      expect(enoughPoints(true, s, AP.MOVEMENT_FLAT)).toBe(true);
    }
    s.quoteActionId = QuoteActionId.CHECKFORDEST;
    expect(enoughPoints(true, s, AP.MOVEMENT_FLAT)).toBe(false);
    s.quoteActionId = QuoteActionId.TRAVERSE_WEST;
    s.collapsed = true;
    expect(enoughPoints(true, s, AP.MOVEMENT_FLAT)).toBe(false);
  });
});

describe('breath', () => {
  it('gives nothing back in real time after a single step: any tile moved zeroes the whole gain (UnusedAPsToBreath)', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    s.breathRed = 3000;
    s.breath = 70;
    s.lastMovementAnimPerRTBreathUpdate = states(content.animations).WALKING;
    s.tilesMovedPerRTBreathUpdate = 1;
    unusedAPsToBreath(ctx(t), s, false);
    expect([s.breath, s.tilesMovedPerRTBreathUpdate]).toEqual([70, 0]);
    unusedAPsToBreath(ctx(t), s, false);
    expect(s.breath).toBeGreaterThan(70);
  });

  it("takes a roof step's breath from the ground costs under the roof", () => {
    const blockedBelow = gridNo(80, 80);
    const openBelow = blockedBelow + 1;
    const world = syntheticWorld(
      testDoorCosts(),
      (w) => w.add(blockedBelow, 0, syntheticStructure(StructureFlags.GENERIC)),
      new Set([blockedBelow - 1, blockedBelow, openBelow]),
    );
    const t = createTacticalState({ ...world, mapDoors: new Map() }, content, Rng.fromSeed(5));
    const s = spawn(t, blockedBelow - 1);
    s.level = ROOF;
    const walking = states(content.animations).WALKING;
    expect(terrainActionPoints(ctx(t), s, blockedBelow, Direction.EAST, ROOF)).toBe(AP.MOVEMENT_FLAT);
    expect(terrainBreathPoints(ctx(t), s, blockedBelow, Direction.EAST, walking)).toBe(0);
    expect(terrainBreathPoints(ctx(t), s, openBelow, Direction.EAST, walking)).toBeGreaterThan(0);
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

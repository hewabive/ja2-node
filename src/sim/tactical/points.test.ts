import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { QuoteActionId } from '../../content/narrative/npc-constants.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import { Rng } from '../../core/rng.ts';
import { createBoxingRecord } from '../strategic/narrative/facts.ts';
import { anim } from './anim-states.ts';
import { initNewSoldierAnim, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { getNewSoldierPath, setSoldierPosition } from './movement.ts';
import { BoxingState } from './narrative/boxing-state.ts';
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
    deductPoints({ inCombat: false, content }, s, 5, 100);
    expect(s.actionPoints).toBe(3);
    expect(s.breathRed).toBeGreaterThan(0);
    deductPoints({ inCombat: true, content }, s, 5, 0);
    expect(s.actionPoints).toBe(0);
    s.actionPoints = -4;
    deductPoints({ inCombat: true, content }, s, 2, 0);
    expect(s.actionPoints).toBe(-6);
  });

  it('wipes an AP debt when a breath cost would take breath below zero (DeductPoints)', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    s.breathMax = 60;
    s.breathRed = 6000;
    s.breath = 0;
    s.actionPoints = -6;
    deductPoints({ inCombat: true, content }, s, 0, 1000);
    expect([s.actionPoints, s.breath]).toEqual([0, 0]);
  });

  it('keeps the INT16 breath of DeductPoints: a cost scaled past 32767 or a reduction pushed past it gives breath back', () => {
    const t = tactical();
    const scaled = spawn(t, gridNo(80, 80));
    scaled.breath = 90;
    scaled.breathRed = 1000;
    deductPoints({ inCombat: true, content }, scaled, 0, 32536);
    expect([scaled.breathRed, scaled.breath]).toEqual([0, 100]);
    const pushed = spawn(t, gridNo(82, 80));
    pushed.breath = 0;
    pushed.breathRed = 10000;
    deductPoints({ inCombat: true, content }, pushed, 0, 16000);
    expect([pushed.breathRed, pushed.breath]).toEqual([0, 100]);
  });

  it('zaps every breath cost of the robot, a regain included, but still charges his APs (DeductPoints)', () => {
    const t = tactical();
    const robot = spawn(t, gridNo(80, 80), Team.OUR, Body.ROBOTNOWEAPON);
    robot.breathRed = 1000;
    robot.breath = 90;
    robot.actionPoints = 10;
    deductPoints({ inCombat: true, content }, robot, 4, 500);
    expect([robot.actionPoints, robot.breathRed, robot.breath]).toEqual([6, 1000, 90]);
    deductPoints({ inCombat: true, content }, robot, 0, -500);
    expect([robot.breathRed, robot.breath]).toEqual([1000, 90]);
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

describe('a non-swimmer in deep water (Points.cc AdjustBreathPts)', () => {
  function breathRedAfter(trait: number, state: string, cost: number, profile = MERC_PROFILE): number {
    const t = tactical();
    const s = phobic(t, trait);
    s.profile = profile;
    s.state = anim(content, state);
    s.breathRed = 1000;
    deductPoints({ inCombat: true, content }, s, 0, cost);
    return s.breathRed;
  }

  it('loses breath five times faster treading or swimming deep water, and regains it five times slower', () => {
    expect(breathRedAfter(Personality.NONE, 'DEEP_WATER_TRED', 100)).toBe(1100);
    expect(breathRedAfter(Personality.NONSWIMMER, 'DEEP_WATER_TRED', 100)).toBe(1500);
    expect(breathRedAfter(Personality.NONSWIMMER, 'DEEP_WATER_SWIM', 100)).toBe(1500);
    expect(breathRedAfter(Personality.NONE, 'DEEP_WATER_SWIM', -500)).toBe(500);
    expect(breathRedAfter(Personality.NONSWIMMER, 'DEEP_WATER_SWIM', -500)).toBe(900);
  });

  it('breathes as anyone else in any other state, in the water going under included, and without a profile', () => {
    expect(breathRedAfter(Personality.NONSWIMMER, 'WALKING', 100)).toBe(1100);
    expect(breathRedAfter(Personality.NONSWIMMER, 'LOW_TO_DEEP_WATER', 100)).toBe(1100);
    expect(breathRedAfter(Personality.NONSWIMMER, 'DEEP_WATER_HIT', 100)).toBe(1100);
    expect(breathRedAfter(Personality.NONSWIMMER, 'DEEP_WATER_SWIM', 100, NO_PROFILE)).toBe(1100);
  });
});

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

const UNDER_ADRENALINE = 16;
const AFTER_ADRENALINE = 20;
const HANGOVER = 10;
const LOW_BREATH_LIFE = 50;

describe('drugs in the turn APs (Soldier_Control.cc CalcActionPoints, Drugs_And_Alcohol.cc HandleAPEffectDueToDrugs)', () => {
  it('adds the adrenaline effect after the phobias, unclamped, and halves the sum in a boxing match', () => {
    const t = tactical();
    t.sector = MINE_LEVEL;
    const s = phobic(t, Personality.CLAUSTROPHOBIC);
    s.drugs.adrenaline.effect = UNDER_ADRENALINE;
    expect(calcActionPoints(t, s)).toBe(18 + UNDER_ADRENALINE);
    const boxing = { ...createBoxingRecord(), state: BoxingState.BOXING };
    expect(calcActionPoints({ soldiers: t.soldiers, sector: t.sector, boxing }, s)).toBe(17);
  });

  it('takes the adrenaline crash and the hangover off, each clamped at the minimum of 10', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    s.drugs.adrenaline.sideEffect = AFTER_ADRENALINE;
    expect(calcActionPoints(t, s)).toBe(10);
    s.drugs.adrenaline.sideEffect = 0;
    s.drugs.alcohol.sideEffect = HANGOVER;
    expect(calcActionPoints(t, s)).toBe(21 - 5);
    s.drugs.adrenaline.sideEffect = 8;
    expect(calcActionPoints(t, s)).toBe(10);
  });

  it("raises a claustrophobe's 9 APs to 10 under the crash or the hangover: their clamp comes after the phobia's cut", () => {
    const t = tactical();
    t.sector = MINE_LEVEL;
    const s = phobic(t, Personality.CLAUSTROPHOBIC);
    s.life = LOW_BREATH_LIFE;
    s.breath = 0;
    expect(calcActionPoints(t, s)).toBe(9);
    s.drugs.alcohol.sideEffect = HANGOVER;
    expect(calcActionPoints(t, s)).toBe(10);
    s.drugs.alcohol.sideEffect = 0;
    s.drugs.adrenaline.sideEffect = 1;
    expect(calcActionPoints(t, s)).toBe(10);
  });

  it('wraps stacked adrenaline: the turn APs and the APs held are INT8', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    s.drugs.adrenaline.effect = 104;
    expect(calcActionPoints(t, s)).toBe(125);
    s.actionPoints = MAX_AP_CARRIED;
    calcNewActionPoints(t, s);
    expect([s.actionPoints, s.initialActionPoints]).toEqual([-126, -126]);
    s.drugs.adrenaline.effect = 120;
    expect(calcActionPoints(t, s)).toBe(-115);
  });

  it('lets the new APs pass the maximum only while the adrenaline effect lasts', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    s.actionPoints = MAX_AP_CARRIED;
    s.drugs.adrenaline.effect = UNDER_ADRENALINE;
    calcNewActionPoints(t, s);
    expect(s.actionPoints).toBe(MAX_AP_CARRIED + 21 + UNDER_ADRENALINE);
    s.actionPoints = MAX_AP_CARRIED;
    s.drugs.adrenaline.effect = 0;
    calcNewActionPoints(t, s);
    expect(s.actionPoints).toBe(25);
  });

  it('gives a sleep-dart victim no APs once he has collapsed', () => {
    const t = tactical();
    const s = spawn(t, gridNo(80, 80));
    s.sleepDrugCounter = 3;
    expect(calcActionPoints(t, s)).toBe(21);
    s.collapsed = true;
    expect(calcActionPoints(t, s)).toBe(0);
    s.sleepDrugCounter = 0;
    expect(calcActionPoints(t, s)).toBe(21);
  });
});

describe('drugs in the breath between turns (Points.cc UnusedAPsToBreath, Drugs_And_Alcohol.cc HandleBPEffectDueToDrugs)', () => {
  function breathAfter(inCombat: boolean, prepare: (s: Soldier) => void, gassed = false): number {
    const t = tactical();
    t.inCombat = inCombat;
    const s = spawn(t, gridNo(80, 80));
    s.breathRed = 3000;
    s.breath = 70;
    s.actionPoints = MAX_AP_CARRIED;
    prepare(s);
    unusedAPsToBreath(ctx(t), s, gassed);
    return s.breath;
  }

  it('gives breath back for the adrenaline effect, in real time and turn-based', () => {
    const sober = breathAfter(false, () => undefined);
    expect(breathAfter(false, (s) => (s.drugs.adrenaline.effect = UNDER_ADRENALINE))).toBeGreaterThan(sober);
    expect(breathAfter(true, () => undefined)).toBe(70);
    expect(breathAfter(true, (s) => (s.drugs.adrenaline.effect = UNDER_ADRENALINE))).toBeGreaterThan(70);
  });

  it('costs breath for the crash and the hangover only turn-based: in real time they only shrink the gain', () => {
    const sober = breathAfter(false, () => undefined);
    const crashed = breathAfter(false, (s) => (s.drugs.adrenaline.sideEffect = AFTER_ADRENALINE));
    const hungover = breathAfter(false, (s) => (s.drugs.alcohol.sideEffect = HANGOVER));
    expect(crashed).toBe(70);
    expect(hungover).toBeGreaterThan(70);
    expect(hungover).toBeLessThan(sober);
    expect(breathAfter(true, (s) => (s.drugs.adrenaline.sideEffect = AFTER_ADRENALINE))).toBeLessThan(70);
    expect(breathAfter(true, (s) => (s.drugs.alcohol.sideEffect = HANGOVER))).toBeLessThan(70);
  });

  it('fills the breath when stacked adrenaline overflows the INT16 gain into a cost that AdjustBreathPts overflows back', () => {
    const wrapped = breathAfter(true, (s) => {
      s.breath = 90;
      s.breathRed = 1000;
      s.actionPoints = 120;
      s.drugs.adrenaline.effect = 100;
    });
    expect(wrapped).toBe(100);
  });

  it('skips the drug term turn-based for a gassed soldier who would have rested', () => {
    const rested = (s: Soldier) => {
      s.actionPoints = 15;
      s.drugs.adrenaline.sideEffect = 30;
    };
    expect(breathAfter(true, rested, true)).toBe(70);
    expect(breathAfter(true, rested, false)).toBeLessThan(70);
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

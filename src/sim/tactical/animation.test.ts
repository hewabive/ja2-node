import { beforeAll, describe, expect, it } from 'vitest';
import { buildStubAnimationScripts } from '../../../stubs/anim-scripts.ts';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { addStubTank, addStubVehicle } from '../../../tests/support/vehicles.ts';
import { ticksPerFrame } from '../../content/anim/schedule-track.ts';
import { stateId } from '../../content/anim/tables.ts';
import { splitAnimationScripts } from '../../content/anim/timelines.ts';
import { MAX_FRAMES_PER_ANIM, parseAnimationScripts } from '../../content/formats/ja2bin.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { TICK_MS } from '../clock.ts';
import { AiAction } from './ai/actions.ts';
import { anim, animName } from './anim-states.ts';
import {
  adjustToNextAnimationFrame,
  computedAnimationDelay,
  initNewSoldierAnim,
  setDesiredDirection,
  setSoldierAniSpeed,
  setSoldierDirection,
  soldierGotoStationaryStance,
} from './animation.ts';
import type { TacticalContent } from './content.ts';
import { executeOverhead } from './overhead.ts';
import { Body, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const FAST_TURN_DELAY = 30;

function turnOneOctant(t: TacticalState, s: Soldier): void {
  setDesiredDirection(t, s, (s.direction + 4) % 8);
  setSoldierDirection(t, s, (s.direction + s.turnIncrement + 8) % 8);
}

describe('the frame delay', () => {
  it('slows an overloaded mover by his effective agility', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    merc.state = anim(content, 'WALKING');
    const unloaded = computedAnimationDelay(t, merc);
    merc.weightCarriedAtTurnStart = 200;
    const agilityDeficit = (agility: number) => 50 - Math.trunc(agility / 4);
    expect(computedAnimationDelay(t, merc) - unloaded).toBe(agilityDeficit(35) - agilityDeficit(70));
  });

  it('halves a moving frame delay under the adrenaline effect, not under its crash nor while standing (CalculateSoldierAniSpeed)', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const standing = computedAnimationDelay(t, merc);
    merc.state = anim(content, 'WALKING');
    const sober = computedAnimationDelay(t, merc);
    merc.drugs.adrenaline.sideEffect = 20;
    expect(computedAnimationDelay(t, merc)).toBe(sober);
    merc.drugs.adrenaline.effect = 4;
    expect(computedAnimationDelay(t, merc)).toBe(Math.trunc(sober / 2));
    t.inCombat = true;
    expect(computedAnimationDelay(t, merc)).toBe(Math.trunc(Math.trunc(sober / 2) / 2));
    t.inCombat = false;
    merc.state = anim(content, 'STANDING');
    expect(computedAnimationDelay(t, merc)).toBe(standing);
  });

  it('never applies a negative body bonus: men, big men and women walk with the same delay', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    merc.state = anim(content, 'WALKING');
    const walkBonus = (body: number) => content.animations.bodySpeeds.walk[body]?.speed ?? 0;
    const delayOf = (body: number) => {
      merc.bodyType = body;
      return computedAnimationDelay(t, merc);
    };
    expect([walkBonus(Body.BIGMALE), walkBonus(Body.REGFEMALE)].every((bonus) => bonus < 0)).toBe(true);
    const regular = delayOf(Body.REGMALE);
    expect([delayOf(Body.BIGMALE), delayOf(Body.REGFEMALE)]).toEqual([regular, regular]);
    expect(delayOf(Body.FATCIV) - regular).toBe(walkBonus(Body.FATCIV));
  });

  it('raises a rifle standing at 70 ms a frame, 150 ms aimed, and no faster in combat', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    merc.state = anim(content, 'READY_RIFLE_STAND');
    const delayAiming = (aimTime: number, inCombat: boolean) => {
      merc.aimTime = aimTime;
      t.inCombat = inCombat;
      setSoldierAniSpeed(t, merc);
      return merc.aniDelay;
    };
    expect([delayAiming(0, false), delayAiming(2, false), delayAiming(0, true), delayAiming(2, true)]).toEqual([70, 150, 70, 150]);
  });

  it('runs an unseen soldier in combat at the loop rate, except a creature rising to call', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    t.inCombat = true;
    const creature = spawnSoldier(sim, 52, Team.CREATURE, gridNo(84, 80), Direction.WEST);
    creature.bodyType = Body.ADULTFEMALEMONSTER;
    creature.visible = -1;
    const delayIn = (state: string) => {
      creature.state = anim(content, state);
      setSoldierAniSpeed(t, creature);
      return creature.aniDelay;
    };
    const risingDelay = content.animations.controls[anim(content, 'MONSTER_UP')]?.speed;
    expect([delayIn('ADULTMONSTER_BREATHING'), delayIn('MONSTER_UP')]).toEqual([0, risingDelay]);
  });
});

describe('fast turns', () => {
  it('turn only our mercs at 30 ms an octant', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const enemy = spawnSoldier(sim, 1, Team.ENEMY, gridNo(84, 80), Direction.WEST);
    expect(t.inCombat).toBe(false);
    turnOneOctant(t, merc);
    turnOneOctant(t, enemy);
    expect(merc.aniDelay).toBe(FAST_TURN_DELAY);
    expect(enemy.aniDelay).toBe(computedAnimationDelay(t, enemy));
  });

  it('leave a merc turning away from a hit to the head at his state speed', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    merc.turningFromHit = true;
    turnOneOctant(t, merc);
    expect(merc.aniDelay).toBe(computedAnimationDelay(t, merc));
  });
});

describe('the end of a hurt walk', () => {
  it('plays the hurt stop on land but stands at once in water', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const HURT_LIFE = 20;
    const stopOn = (id: number, terrain: number) => {
      const merc = spawnSoldier(sim, id, Team.OUR, gridNo(80 + 2 * id, 80), Direction.EAST, { life: HURT_LIFE });
      merc.overTerrain = terrain;
      merc.state = anim(content, 'WALKING');
      initNewSoldierAnim(t, merc, anim(content, 'STANDING'), 0, false);
      return animName(content, merc.state);
    };
    expect([stopOn(0, Terrain.FLAT_GROUND), stopOn(1, Terrain.LOW_WATER)]).toEqual(['END_HURT_WALKING', 'STANDING']);
  });
});

describe('the enemy-sighting pause of their turn (EVENT_InitNewSoldierAnim, Soldier_Control.cc:1324)', () => {
  it('ends when the paused enemy starts an animation, and not when anybody else does', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.EAST);
    const other = spawnSoldier(sim, 21, Team.ENEMY, gridNo(84, 80), Direction.EAST);
    enemy.pauseAllAnimation = true;
    t.turn.enemySightingOnTheirTurn = { enemy, since: t.clockMs };
    initNewSoldierAnim(t, other, anim(content, 'CROUCHING'), 0, false);
    expect([t.turn.enemySightingOnTheirTurn?.enemy, enemy.pauseAllAnimation]).toEqual([enemy, true]);
    initNewSoldierAnim(t, enemy, anim(content, 'CROUCHING'), 0, false);
    expect([t.turn.enemySightingOnTheirTurn, enemy.pauseAllAnimation]).toEqual([null, false]);
  });
});

describe("the creature queen's stationary stance (Soldier_Control.cc SoldierGotoStationaryStance)", () => {
  it('readies a queen who sees somebody or is on our team, and lets the others breathe', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const restingStateOf = (id: number, team: number, oppCount: number) => {
      const queen = spawnSoldier(sim, id, team, gridNo(70 + 10 * (id % 4), 70), Direction.SOUTH, { body: Body.QUEENMONSTER });
      queen.ai.oppCount = oppCount;
      soldierGotoStationaryStance(t, queen);
      return animName(content, queen.state);
    };
    expect([restingStateOf(52, Team.CREATURE, 1), restingStateOf(53, Team.CREATURE, 0), restingStateOf(1, Team.OUR, 0)]).toEqual([
      'QUEEN_READY',
      'QUEEN_MONSTER_BREATHING',
      'QUEEN_READY',
    ]);
  });
});

describe('the end of a door opening', () => {
  it('cancels the AI action of a soldier with a far destination who cannot walk on', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
    enemy.ai.action = AiAction.WALK;
    enemy.ai.actionInProgress = true;
    enemy.absoluteFinalDestination = gridNo(80, 70);
    enemy.finalDestination = enemy.gridNo;
    enemy.endDoorOpenCode = 1;
    const endOpenDoor = anim(content, 'END_OPEN_DOOR');
    initNewSoldierAnim(t, enemy, endOpenDoor, 0, false);
    expect(enemy.state).toBe(endOpenDoor);
    for (let frame = 0; frame < 100 && enemy.state === endOpenDoor; frame++) adjustToNextAnimationFrame(t, enemy);
    expect(enemy.state).not.toBe(endOpenDoor);
    expect(enemy.ai.action).toBe(AiAction.NONE);
    expect(enemy.ai.actionInProgress).toBe(false);
    expect(enemy.endDoorOpenCode).toBe(0);
  });
});

describe('a vehicle turning (TurnSoldier)', () => {
  const TURN_BUDGET_TICKS = 2_000;
  const AT = gridNo(80, 80);

  interface TurnStep {
    readonly hiResDirection: number;
    readonly direction: number;
    readonly clockMs: number;
  }

  function turnSteps(t: TacticalState, s: Soldier, to: number): TurnStep[] {
    setDesiredDirection(t, s, to);
    const steps: TurnStep[] = [];
    for (let tick = 0; tick < TURN_BUDGET_TICKS; tick++) {
      const before = s.hiResDirection;
      executeOverhead(t);
      if (s.hiResDirection !== before) steps.push({ hiResDirection: s.hiResDirection, direction: s.direction, clockMs: t.clockMs });
    }
    return steps;
  }

  it('turns a tank a facing in four 32-step facings, one a frame, its direction changing only at the fourth (quirk)', () => {
    const t = newCombatSim(content).state;
    const tank = addStubTank(t, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: AT, direction: Direction.NORTH });
    const steps = turnSteps(t, tank, Direction.EAST);
    expect(steps.map((s) => [s.hiResDirection, s.direction])).toEqual([
      [1, Direction.NORTH],
      [2, Direction.NORTH],
      [3, Direction.NORTH],
      [4, Direction.NORTHEAST],
      [5, Direction.NORTHEAST],
      [6, Direction.NORTHEAST],
      [7, Direction.NORTHEAST],
      [8, Direction.EAST],
    ]);
    expect(tank.aniDelay).toBeGreaterThan(0);
    const gaps = steps.slice(1).map((s, k) => s.clockMs - (steps[k]?.clockMs ?? 0));
    expect(new Set(gaps)).toEqual(new Set([ticksPerFrame(tank.aniDelay, TICK_MS) * TICK_MS]));
    expect([tank.desiredDirection, tank.pauseAnimMove]).toEqual([Direction.EAST, false]);
  });

  it('turns a tank the short way through north, wrapping from 0 to 31', () => {
    const t = newCombatSim(content).state;
    const tank = addStubTank(t, { body: Body.TANK_NE, team: Team.ENEMY, gridNo: AT, direction: Direction.NORTHEAST });
    expect(turnSteps(t, tank, Direction.NORTHWEST).map((s) => s.hiResDirection)).toEqual([3, 2, 1, 0, 31, 30, 29, 28]);
    expect(tank.direction).toBe(Direction.NORTHWEST);
  });

  it('never turns a vehicle other than a tank', () => {
    const t = newCombatSim(content).state;
    const hummer = addStubVehicle(t, { body: Body.HUMVEE, team: Team.CIV, gridNo: AT, direction: Direction.NORTH });
    expect(turnSteps(t, hummer, Direction.SOUTH)).toEqual([]);
    expect([hummer.direction, hummer.hiResDirection]).toEqual([Direction.NORTH, 0]);
  });
});

describe('the move paused for a turn (SOLDIER_PAUSEANIMOVE)', () => {
  const SETTLE_TICKS = 2_000;

  const AT = gridNo(80, 80);
  const alone: Readonly<Record<string, (sim: TacticalSim) => Soldier>> = {
    tank: (sim) => addStubTank(sim.state, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: AT, direction: Direction.NORTH }),
    bloodcat: (sim) => spawnSoldier(sim, 40, Team.CREATURE, AT, Direction.NORTH, { body: Body.BLOODCAT }),
    merc: (sim) => spawnSoldier(sim, 0, Team.OUR, AT, Direction.NORTH),
  };

  it('is set when a tank or a creature is given a new facing and cleared once it faces it, never for a merc', () => {
    const pauses = Object.values(alone).map((place) => {
      const sim = newCombatSim(content);
      const s = place(sim);
      setDesiredDirection(sim.state, s, Direction.EAST);
      const paused = s.pauseAnimMove;
      for (let tick = 0; tick < SETTLE_TICKS; tick++) executeOverhead(sim.state);
      return [paused, s.direction, s.pauseAnimMove];
    });
    expect(pauses).toEqual([
      [true, Direction.EAST, false],
      [true, Direction.EAST, false],
      [false, Direction.EAST, false],
    ]);
  });

  it('is left alone when the facing does not change', () => {
    const sim = newCombatSim(content);
    const cat = spawnSoldier(sim, 40, Team.CREATURE, gridNo(90, 90), Direction.NORTH, { body: Body.BLOODCAT });
    setDesiredDirection(sim.state, cat, Direction.NORTH);
    expect(cat.pauseAnimMove).toBe(false);
  });
});

describe("a tank's recoil (Soldier_Ani.cc codes 412 and 413)", () => {
  const NUDGE_FORWARD = 412;
  const NUDGE_BACKWARD = 413;
  const NUDGES = 3;
  const NUDGE = Math.fround(0.2);
  const END_OF_ANIMATION = 499;

  async function withRecoilingTankShot(): Promise<TacticalContent> {
    const scripts = parseAnimationScripts(await buildStubAnimationScripts());
    const codes = new Uint16Array(scripts.codes);
    const shot = stateId(content.animations, 'TANK_SHOOT') * MAX_FRAMES_PER_ANIM;
    const nudges = (code: number) => Array.from({ length: NUDGES }, () => code);
    codes.fill(0, shot, shot + MAX_FRAMES_PER_ANIM);
    codes.set([1, ...nudges(NUDGE_BACKWARD), 2, ...nudges(NUDGE_FORWARD), 3, END_OF_ANIMATION], shot);
    return { ...content, timeline: splitAnimationScripts({ codes }).logic };
  }

  it('moves the tank back a fifth of a world unit a code along its facing, then forward again to where it began', async () => {
    const recoiling = await withRecoilingTankShot();
    const t = newCombatSim(recoiling).state;
    const tank = addStubTank(t, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: gridNo(80, 80), direction: Direction.SOUTH });
    const start = { x: tank.x, y: tank.y, gridNo: tank.gridNo };
    initNewSoldierAnim(t, tank, anim(recoiling, 'TANK_SHOOT'), 0, false);
    expect({ x: tank.x, y: tank.y }).toEqual({ x: start.x, y: start.y });
    adjustToNextAnimationFrame(t, tank);
    let pushedBack = start.y;
    for (let k = 0; k < NUDGES; k++) pushedBack = Math.fround(pushedBack - NUDGE);
    expect({ x: tank.x, y: tank.y, gridNo: tank.gridNo }).toEqual({ x: start.x, y: pushedBack, gridNo: start.gridNo });
    adjustToNextAnimationFrame(t, tank);
    expect({ x: tank.x, y: tank.y, gridNo: tank.gridNo }).toEqual(start);
  });
});

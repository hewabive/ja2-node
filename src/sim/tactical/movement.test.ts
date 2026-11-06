import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { layProne, raiseTiles, withTwoTileCreatureBodies, withTwoTileProneBody } from '../../../tests/support/prone-body.ts';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import { DIRECTION_INCREMENT, Direction, gridNo, WORLD_COLS } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { StructureFlags, type WorldStructures } from '../../content/world/structures.ts';
import { syntheticMap, syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { Rng } from '../../core/rng.ts';
import { createItem } from '../items/object.ts';
import { AiAction, Situation } from './ai/actions.ts';
import {
  beginSoldierClimbFence,
  initNewSoldierAnim,
  setDesiredDirection,
  setSoldierAniSpeed,
  states,
  TurningFromProne,
} from './animation.ts';
import { eventFireSoldierWeapon } from './combat/attack.ts';
import type { TacticalContent } from './content.ts';
import { HandleDoor } from './doors/door-table.ts';
import { InvSlot } from './inventory.ts';
import {
  getNewSoldierPath,
  handleAtNewGridNo,
  handleGotoNewGridNo,
  handleNextTile,
  handleNextTileWaiting,
  moveMerc,
  pathExhausted,
  setDelayedTileWaiting,
  setSoldierDestination,
  setSoldierPosition,
  stopMerc,
} from './movement.ts';
import { executeOverhead } from './overhead.ts';
import { MAX_PATH_LIST_SIZE, NOWHERE } from './pathfinding.ts';
import { revealedRooms } from './perception/fov.ts';
import { Opp } from './perception/opp.ts';
import { AP } from './points.ts';
import { bloodFloorStrength } from './smell.ts';
import { Body, createSoldier, NO_PENDING_DIRECTION, Orders, type Soldier, Team, Visible } from './soldier.ts';
import { createTacticalState, registerSoldier, setAutoBandageMode, type TacticalState, whoIsThere } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';

const doorCosts = testDoorCosts();
let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function tactical(place: (s: WorldStructures) => void = () => {}, withContent: TacticalContent = content): TacticalState {
  const w = syntheticWorld(doorCosts, place);
  return createTacticalState({ ...w, mapDoors: new Map() }, withContent, Rng.fromSeed(7));
}

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

function spawn(t: TacticalState, at: number, team: number = Team.OUR): Soldier {
  const st = states(content.animations);
  const s = createSoldier({
    id: t.soldiers.length,
    team,
    name: `S${t.soldiers.length}`,
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

function runUntilStill(t: TacticalState, limit = 20_000): void {
  const st = states(content.animations);
  for (let i = 0; i < limit; i++) {
    executeOverhead(t);
    if (t.soldiers.every((s) => s.state === st.STANDING && !s.delayedMovement && s.pendingAnimation === -1)) return;
  }
}

const START = gridNo(80, 80);
const TURN_TICKS = 2_000;
const CORRIDOR_END = gridNo(89, 80);

function corridor(place: (w: WorldStructures) => void = () => {}, gaps: readonly number[] = []): TacticalState {
  return tactical((w) => {
    const wall = (g: number) => {
      if (!gaps.includes(g)) w.add(g, 0, syntheticStructure(StructureFlags.GENERIC));
    };
    for (let x = 70; x <= 90; x++) {
      wall(gridNo(x, 79));
      wall(gridNo(x, 81));
    }
    wall(CORRIDOR_END);
    place(w);
  });
}

describe('walking', () => {
  it('walks along the path and occupies the destination', () => {
    const t = tactical();
    const s = spawn(t, START);
    expect(getNewSoldierPath(t, s, gridNo(85, 80), s.uiMovementMode)).toBe(true);
    runUntilStill(t);
    expect(s.gridNo).toBe(gridNo(85, 80));
    expect([s.x, s.y]).toEqual([855, 805]);
    expect(whoIsThere(t, gridNo(85, 80), 0)).toBe(s);
    expect(whoIsThere(t, START, 0)).toBeNull();
    expect(t.reserved.every((r) => r === -1)).toBe(true);
    expect(t.events).toContainEqual({ type: 'arrived', soldier: s.id, gridNo: gridNo(85, 80) });
  });

  it('counts the tiles moved in a signed byte, so the tile after the 127th wraps the count to -128', () => {
    const t = tactical();
    const s = spawn(t, START);
    s.tilesMoved = 127;
    handleAtNewGridNo(t, s);
    expect(s.tilesMoved).toBe(-128);
  });

  it('moves in float32 steps and switches tiles at the half step', () => {
    const t = tactical();
    const s = spawn(t, START);
    s.path = [Direction.EAST, Direction.EAST, Direction.EAST, Direction.EAST, Direction.EAST, Direction.EAST];
    s.pathSize = s.path.length;
    s.finalDestination = gridNo(86, 80);
    initNewSoldierAnim(t, s, states(content.animations).WALKING, 0, false);
    const framesPerTile: number[] = [];
    let frames = 0;
    for (let tile = 0; tile < 5; tile++) {
      const target = START + tile + 1;
      setSoldierDestination(t, s, Direction.EAST, s.state);
      s.pastX = s.pastY = false;
      frames = 0;
      while (!(s.pastX && s.pastY)) {
        moveMerc(t, s, Math.fround(1.6), Direction.EAST);
        frames++;
      }
      expect(s.gridNo).toBe(target);
      framesPerTile.push(frames);
    }
    expect(framesPerTile).toEqual([7, 6, 6, 7, 6]);
  });

  it('arrives twice at the tile where a 30-step route runs out, making noise and looking again', () => {
    const t = tactical();
    const s = spawn(t, START);
    const arrivals: number[] = [];
    const hooks = t.hooks;
    t.hooks = {
      ...hooks,
      atNewGridNo: (tt, soldier) => {
        arrivals.push(soldier.gridNo);
        return hooks.atNewGridNo(tt, soldier);
      },
    };
    const destination = START + MAX_PATH_LIST_SIZE + 5;
    expect(getNewSoldierPath(t, s, destination, s.uiMovementMode)).toBe(true);
    runUntilStill(t);
    expect(s.gridNo).toBe(destination);
    const routeEnd = START + MAX_PATH_LIST_SIZE;
    expect(arrivals.filter((g) => g === routeEnd)).toHaveLength(2);
    expect(arrivals.filter((g) => g === routeEnd - 1 || g === routeEnd + 1)).toHaveLength(2);
  });

  it('stops short when a stationary soldier stands on the destination', () => {
    const t = tactical();
    const mover = spawn(t, START);
    const blocker = spawn(t, gridNo(84, 80), Team.ENEMY);
    getNewSoldierPath(t, mover, gridNo(85, 80), mover.uiMovementMode);
    blocker.finalDestination = blocker.gridNo;
    runUntilStill(t);
    expect(mover.gridNo).not.toBe(gridNo(84, 80));
    expect(whoIsThere(t, gridNo(84, 80), 0)).toBe(blocker);
  });

  it('hops a fence on the way', () => {
    const t = tactical((w) => {
      for (let x = 60; x <= 100; x++) w.add(gridNo(x, 79), 0, syntheticStructure(StructureFlags.FENCE, Orientation.OUTSIDE_LEFT));
    });
    const s = spawn(t, START);
    expect(getNewSoldierPath(t, s, gridNo(80, 77), s.uiMovementMode)).toBe(true);
    runUntilStill(t);
    expect(s.gridNo).toBe(gridNo(80, 77));
  });

  function behindClosedDoor(): TacticalState {
    const closed = {
      ...syntheticStructure(StructureFlags.DOOR | StructureFlags.OPENABLE, Orientation.INSIDE_LEFT),
      number: 0,
      partnerDelta: 1,
    };
    const open = {
      ...syntheticStructure(StructureFlags.DOOR | StructureFlags.OPENABLE | StructureFlags.OPEN, Orientation.INSIDE_LEFT),
      number: 1,
      partnerDelta: -1,
    };
    const file = { structureCount: 2, auxData: null, tileLocations: [], structures: [closed, open] };
    return tactical((w) => {
      for (let x = 70; x <= 90; x++) {
        if (x === 80) w.add(gridNo(x, 79), 0, closed, undefined, file);
        else w.add(gridNo(x, 79), 0, syntheticStructure(StructureFlags.WALL, Orientation.INSIDE_LEFT));
      }
    });
  }

  it('lets an enemy in sight open a closed door on the way and close it behind him', () => {
    const t = behindClosedDoor();
    const s = spawn(t, START, Team.ENEMY);
    s.visible = Visible.SEEN;
    expect(getNewSoldierPath(t, s, gridNo(80, 77), s.uiMovementMode)).toBe(true);
    runUntilStill(t, 100_000);
    expect(s.gridNo).toBe(gridNo(80, 77));
    expect(t.events.filter((e) => e.type === 'doorChanged').map((e) => (e.type === 'doorChanged' ? e.open : null))).toEqual([true, false]);
  });

  it('lets a merc of ours walk on after the door he opens on his way only in auto-bandage, as the AI does', () => {
    const twoTilesBeforeTheDoor = gridNo(80, 82);
    const walk = (autoBandage: boolean) => {
      const t = behindClosedDoor();
      const s = spawn(t, twoTilesBeforeTheDoor);
      s.doorHandleCode = HandleDoor.OPEN;
      setAutoBandageMode(t, true);
      expect(getNewSoldierPath(t, s, gridNo(80, 77), s.uiMovementMode)).toBe(true);
      setAutoBandageMode(t, autoBandage);
      runUntilStill(t, 100_000);
      return s.gridNo;
    };
    expect(walk(true)).toBe(gridNo(80, 77));
    expect(walk(false)).toBe(START);
  });

  it('opens a door on the way in auto-bandage for a merc of ours who never chose how to open one (deviation "Door on the way in auto-bandage")', () => {
    const t = behindClosedDoor();
    const s = spawn(t, gridNo(80, 82));
    expect(s.doorHandleCode).toBe(HandleDoor.DENIED);
    setAutoBandageMode(t, true);
    expect(getNewSoldierPath(t, s, gridNo(80, 77), s.uiMovementMode)).toBe(true);
    runUntilStill(t, 100_000);
    expect([s.gridNo, s.doorHandleCode]).toEqual([gridNo(80, 77), HandleDoor.OPEN]);
  });

  it('walks around a wall', () => {
    const t = tactical((w) => {
      for (let x = 70; x <= 90; x++) w.add(gridNo(x, 79), 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT));
    });
    const s = spawn(t, START);
    expect(getNewSoldierPath(t, s, gridNo(80, 77), s.uiMovementMode)).toBe(true);
    runUntilStill(t, 100_000);
    expect(s.gridNo).toBe(gridNo(80, 77));
  });

  it('steps a civilian at his body walking speed, but at the running state speed when he runs', () => {
    const t = tactical();
    const st = states(content.animations);
    const firstStep = (mode: number, at: number) => {
      const s = spawn(t, at);
      s.bodyType = Body.MANCIV;
      expect(getNewSoldierPath(t, s, at + 4, mode)).toBe(true);
      const from = s.x;
      for (let tick = 0; tick < 1000 && s.x === from; tick++) executeOverhead(t);
      return s.x - from;
    };
    const runningSpeed = content.animations.controls[st.RUNNING]?.movement ?? 0;
    const civilianRunSpeed = content.animations.bodySpeeds.run[Body.MANCIV]?.movement ?? 0;
    expect(civilianRunSpeed).not.toBeCloseTo(runningSpeed);
    expect(firstStep(st.WALKING, START)).toBeCloseTo(content.animations.bodySpeeds.walk[Body.MANCIV]?.movement ?? 0, 4);
    expect(firstStep(st.RUNNING, gridNo(80, 84))).toBeCloseTo(runningSpeed, 4);
  });
});

describe('the fence hop (Soldier_Control.cc BeginSoldierClimbFence, Soldier_Ani.cc code 444)', () => {
  const LANDING = gridNo(80, 78);
  const HOP_TICKS = 3_000;
  const ENEMY_TURN_TICKS = 20_000;
  const AMPLE_APS = 40;

  function placeFence(w: WorldStructures): void {
    for (let x = 60; x <= 100; x++) w.add(gridNo(x, 79), 0, syntheticStructure(StructureFlags.FENCE, Orientation.OUTSIDE_LEFT));
  }

  function hopper(t: TacticalState, facing: number, mode: 'WALKING' | 'SWATTING'): Soldier {
    const st = states(content.animations);
    const s = spawn(t, START);
    t.inCombat = true;
    s.direction = s.desiredDirection = facing;
    if (mode === 'SWATTING') initNewSoldierAnim(t, s, st.CROUCHING, 0, true);
    s.uiMovementMode = st[mode];
    s.actionPoints = AMPLE_APS;
    return s;
  }

  function hopToLanding(facing: number, mode: 'WALKING' | 'SWATTING'): Soldier {
    const t = tactical(placeFence);
    const s = hopper(t, facing, mode);
    expect(getNewSoldierPath(t, s, LANDING, s.uiMovementMode)).toBe(true);
    for (let tick = 0; tick < HOP_TICKS; tick++) executeOverhead(t);
    return s;
  }

  const apsSpent = (s: Soldier) => AMPLE_APS - s.actionPoints;

  it('turns to a fence on his way for free', () => {
    expect(apsSpent(hopToLanding(Direction.EAST, 'WALKING'))).toBe(apsSpent(hopToLanding(Direction.NORTH, 'WALKING')));
  });

  it('keeps a prone soldier who turns to a fence from lying down again once he faces it', () => {
    const t = tactical(placeFence);
    const s = spawn(t, START);
    layProne(t, s);
    beginSoldierClimbFence(t, s);
    expect([s.desiredDirection, s.turningFromPronePosition]).toEqual([Direction.NORTH, TurningFromProne.OFF]);
  });

  it('gets up for free on the fence landing that is his final tile', () => {
    expect(apsSpent(hopToLanding(Direction.NORTH, 'WALKING'))).toBe(AP.JUMPFENCE);
  });

  it('ends the move on the fence landing that is his final tile, swatting as walking: the path runs out and nothing continues it', () => {
    const ends = (['WALKING', 'SWATTING'] as const).map((mode) => {
      const s = hopToLanding(Direction.NORTH, mode);
      return [s.gridNo, s.pathSize - s.pathIndex, s.continueMoveAfterStanceChange];
    });
    expect(ends).toEqual([
      [LANDING, 0, 0],
      [LANDING, 0, 0],
    ]);
  });

  it('lets an enemy whose run away ends swatting on a fence landing finish his action, so the enemy turn ends', () => {
    const base = syntheticWorld(doorCosts, placeFence);
    const sim = new TacticalSim({ ...base, map: syntheticMap(), mapPath: 'synthetic' } as unknown as TacticalWorld, content, 3);
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 88), Direction.NORTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, START, Direction.SOUTH);
    sim.lookAround();
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
    const st = states(content.animations);
    initNewSoldierAnim(t, enemy, st.CROUCHING, 0, true);
    enemy.uiMovementMode = st.SWATTING;
    enemy.ai.newSituation = Situation.NOT_NEW;
    enemy.ai.action = AiAction.RUN_AWAY;
    enemy.ai.actionData = LANDING;
    enemy.ai.actionInProgress = true;
    expect(getNewSoldierPath(t, enemy, LANDING, enemy.uiMovementMode)).toBe(true);
    runUntilIdle(sim, ENEMY_TURN_TICKS);
    expect([enemy.gridNo, t.turn.currentTeam]).toEqual([LANDING, Team.OUR]);
  });
});

describe('starting a walk (Soldier_Control.cc EVENT_InternalGetNewSoldierPath)', () => {
  const stateNamed = (name: string) => content.animations.stateIndex.get(name) ?? -1;
  const nameOf = (s: Soldier) => content.animations.controls[s.state]?.id;

  function aiming(t: TacticalState, aim: string): Soldier {
    const s = spawn(t, START);
    s.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get('GLOCK_17')?.index ?? 0, 100);
    s.state = stateNamed(aim);
    return s;
  }

  it('lowers the weapon of a soldier aiming on his feet before the first step, then walks on', () => {
    const t = tactical();
    const s = aiming(t, 'AIM_RIFLE_STAND');
    expect(getNewSoldierPath(t, s, START + 5, s.uiMovementMode)).toBe(true);
    expect([nameOf(s), s.pendingAnimation, s.gridNo]).toEqual(['END_RIFLE_STAND', states(content.animations).WALKING, START]);
    runUntilStill(t);
    expect(s.gridNo).toBe(START + 5);
  });

  it('gets an EPC cowering on an order up and walking at once, whatever mode the order asked for', () => {
    const t = tactical();
    t.narrative = { ...t.narrative, isEpc: () => true };
    const s = spawn(t, START);
    s.bodyType = Body.MANCIV;
    s.cowering = true;
    s.state = stateNamed('COWERING');
    const ordered = 1;
    expect(getNewSoldierPath(t, s, START + 5, states(content.animations).RUNNING, ordered)).toBe(true);
    expect([nameOf(s), s.cowering]).toEqual(['WALKING', false]);
  });

  it('keeps the aim of a crouched soldier, whose walk starts by standing up', () => {
    const t = tactical();
    const s = aiming(t, 'AIM_RIFLE_CROUCH');
    expect(getNewSoldierPath(t, s, START + 5, s.uiMovementMode)).toBe(true);
    expect(nameOf(s)).not.toBe('END_RIFLE_CROUCH');
    runUntilStill(t);
    expect(s.gridNo).toBe(START + 5);
  });
});

describe('paying for a step', () => {
  it('does not charge the first crawl step again after getting up to turn', () => {
    const crawling = states(content.animations).CRAWLING;
    const apsAfterFirstStep = (turning: number) => {
      const t = tactical();
      t.inCombat = true;
      const s = spawn(t, START);
      s.actionPoints = 20;
      s.path = [Direction.EAST];
      s.pathSize = 1;
      s.finalDestination = START + 1;
      s.turningFromPronePosition = turning;
      expect(handleGotoNewGridNo(t, s, true, crawling).keepMoving).toBe(true);
      return s.actionPoints;
    };
    expect(apsAfterFirstStep(TurningFromProne.OFF)).toBeLessThan(20);
    expect(apsAfterFirstStep(TurningFromProne.ENDING_UP_FROM_MOVE)).toBe(20);
  });

  it('halts like a lack of APs at a door step taken diagonally or into a tile without the door, keeping the destination', () => {
    const DOOR = gridNo(80, 79);
    const closed = {
      ...syntheticStructure(StructureFlags.DOOR | StructureFlags.OPENABLE, Orientation.INSIDE_LEFT),
      number: 0,
      partnerDelta: 1,
    };
    const open = {
      ...syntheticStructure(StructureFlags.DOOR | StructureFlags.OPENABLE | StructureFlags.OPEN, Orientation.INSIDE_LEFT),
      number: 1,
      partnerDelta: -1,
    };
    const file = { structureCount: 2, auxData: null, tileLocations: [], structures: [closed, open] };
    const steps = [
      { from: DOOR - 1 + WORLD_COLS, direction: Direction.NORTHEAST, code: TravelCost.DOOR_CLOSED_HERE },
      { from: DOOR + 2, direction: Direction.WEST, code: TravelCost.DOOR_CLOSED_W },
    ];
    for (const { from, direction, code } of steps) {
      const t = tactical((w) => w.add(DOOR, 0, closed, undefined, file));
      t.inCombat = true;
      const into = from + (DIRECTION_INCREMENT[direction] ?? 0);
      const beyond = into + (DIRECTION_INCREMENT[direction] ?? 0);
      t.world.costs.force(into, direction, 0, code);
      const s = spawn(t, from);
      s.actionPoints = 20;
      s.path = [direction, direction];
      s.pathSize = s.path.length;
      s.finalDestination = beyond;
      expect(handleGotoNewGridNo(t, s, true, states(content.animations).WALKING)).toEqual({ ok: false, keepMoving: false });
      expect([s.gridNo, s.finalDestination, s.noAPToFinishMove, s.actionPoints]).toEqual([from, beyond, true, 20]);
      expect(t.events.filter((e) => e.type === 'stopped')).toEqual([{ type: 'stopped', soldier: s.id, gridNo: from, reason: 'outOfAPs' }]);
    }
  });
});

describe('a blocked next tile', () => {
  const WALKING_TO_EXIT_GRID = 1;

  it('gives up a final tile somebody stands on, unless the mover walks out of the sector', () => {
    for (const waitAction of [0, WALKING_TO_EXIT_GRID]) {
      const t = tactical();
      const mover = spawn(t, START);
      const finalTile = START + 1;
      spawn(t, finalTile, Team.ENEMY);
      mover.finalDestination = finalTile;
      mover.waitActionToDo = waitAction;
      expect(handleNextTile(t, mover, Direction.EAST, finalTile, finalTile)).toBe(false);
      expect(mover.finalDestination).toBe(waitAction ? finalTile : START);
      expect(mover.delayedMovement).toBe(waitAction ? 1 : 0);
    }
  });

  it('swaps two enemies blocking each other head-on and stops both, but a multi-tile one leaves the other stopped', () => {
    for (const multiTile of [false, true]) {
      const t = corridor();
      const mover = spawn(t, START, Team.ENEMY);
      const other = spawn(t, START + 1, Team.ENEMY);
      other.finalDestination = gridNo(75, 80);
      other.blockedByAnotherMerc = true;
      other.blockedByAnotherMercDirection = Direction.WEST;
      const moverFinal = gridNo(85, 80);
      mover.finalDestination = moverFinal;
      mover.multiTile = multiTile;
      expect(handleNextTile(t, mover, Direction.EAST, START + 1, moverFinal)).toBe(false);
      expect(mover.gridNo).toBe(multiTile ? START : START + 1);
      expect(other.gridNo).toBe(multiTile ? START + 1 : START);
      expect(mover.finalDestination).toBe(multiTile ? moverFinal : mover.gridNo);
      expect(other.finalDestination).toBe(other.gridNo);
      expect(other.blockedByAnotherMerc).toBe(multiTile);
    }
  });

  it('leaves both soldiers of a head-on swap in place when one cannot stand on the tile of the other', () => {
    const CLUTTERED = START + 1;
    const t = corridor((w) => w.add(CLUTTERED, 0, syntheticStructure(StructureFlags.GENERIC)));
    const mover = spawn(t, START, Team.ENEMY);
    const other = spawn(t, CLUTTERED, Team.ENEMY);
    other.finalDestination = gridNo(75, 80);
    other.blockedByAnotherMerc = true;
    other.blockedByAnotherMercDirection = Direction.WEST;
    mover.finalDestination = gridNo(85, 80);
    expect(handleNextTile(t, mover, Direction.EAST, CLUTTERED, mover.finalDestination)).toBe(false);
    expect([mover.gridNo, other.gridNo]).toEqual([START, CLUTTERED]);
    expect([whoIsThere(t, START, 0), whoIsThere(t, CLUTTERED, 0)]).toEqual([mover, other]);
    expect([mover.finalDestination, other.finalDestination, other.blockedByAnotherMerc]).toEqual([START, CLUTTERED, false]);
  });
});

describe('waiting for a blocked tile in a corridor (Soldier_Tile.cc HandleNextTileWaiting)', () => {
  const END_OF_CORRIDOR = gridNo(85, 80);
  const BLOCKED_TILE = START + 1;
  const SECOND_WAIT = 2;

  function waitAgain(t: TacticalState, s: Soldier, delayedMovement: number, cause = BLOCKED_TILE): void {
    setDelayedTileWaiting(t, s, cause, delayedMovement);
    t.clockMs = s.nextTileCheckAt;
    handleNextTileWaiting(t, s);
  }

  function scriptedNpc(t: TacticalState, destination: number): Soldier {
    const npc = spawn(t, START, Team.CIV);
    npc.quoteRecord = 5;
    npc.absoluteFinalDestination = destination;
    npc.finalDestination = destination;
    return npc;
  }

  it('tests the first tile of the route through the blocker again when no route leads around him, and keeps waiting', () => {
    const NICHE = gridNo(80, 79);
    const t = corridor(
      (w) => {
        for (const step of [Direction.NORTHWEST, Direction.NORTH, Direction.NORTHEAST])
          w.add(NICHE + (DIRECTION_INCREMENT[step] ?? 0), 0, syntheticStructure(StructureFlags.GENERIC));
      },
      [NICHE],
    );
    const mover = spawn(t, START, Team.ENEMY);
    spawn(t, BLOCKED_TILE, Team.ENEMY);
    mover.finalDestination = END_OF_CORRIDOR;
    waitAgain(t, mover, 1);
    expect([mover.delayedMovement, mover.blockedByAnotherMerc, mover.blockedByAnotherMercDirection]).toEqual([2, true, Direction.EAST]);
  });

  it('forces a swap at the third wait for an NPC on a quote record, even with our stationary merc in the way', () => {
    const t = corridor();
    const npc = scriptedNpc(t, END_OF_CORRIDOR);
    const merc = spawn(t, BLOCKED_TILE);
    waitAgain(t, npc, SECOND_WAIT);
    expect([npc.gridNo, merc.gridNo, npc.finalDestination, npc.delayedMovement]).toEqual([BLOCKED_TILE, START, END_OF_CORRIDOR, 0]);
    expect(content.animations.controls[npc.state]?.id).toBe('WALKING');
    runUntilStill(t);
    expect(npc.gridNo).toBe(END_OF_CORRIDOR);
  });

  it('lets an NPC swapped onto his scripted destination report his arrival and wait there', () => {
    const t = corridor();
    const npc = scriptedNpc(t, BLOCKED_TILE);
    npc.profile = 57;
    spawn(t, BLOCKED_TILE);
    const reached: number[] = [];
    t.narrative = { ...t.narrative, npcReachedDestination: (s) => reached.push(s.id) };
    waitAgain(t, npc, SECOND_WAIT);
    expect(npc.gridNo).toBe(BLOCKED_TILE);
    expect(reached).toEqual([npc.id]);
    expect([npc.ai.nextAction, npc.ai.nextActionData, npc.pathStored]).toEqual([AiAction.WAIT, 500, false]);
    expect(content.animations.controls[npc.state]?.id).toBe('STANDING');
  });

  it('forces a swap at the third wait for our merc in auto-bandage, unless a stationary civilian blocks him', () => {
    const cases = [
      { team: Team.ENEMY, orders: Orders.STATIONARY, swapped: true },
      { team: Team.CIV, orders: Orders.ONGUARD, swapped: true },
      { team: Team.CIV, orders: Orders.STATIONARY, swapped: false },
    ];
    for (const { team, orders, swapped } of cases) {
      const t = corridor();
      setAutoBandageMode(t, true);
      const merc = spawn(t, START);
      merc.finalDestination = END_OF_CORRIDOR;
      const blocker = spawn(t, BLOCKED_TILE, team);
      blocker.ai.orders = orders;
      waitAgain(t, merc, SECOND_WAIT);
      expect([merc.gridNo, blocker.gridNo]).toEqual(swapped ? [BLOCKED_TILE, START] : [START, BLOCKED_TILE]);
    }
  });

  it('leaves a merc swapped in auto-bandage standing with no final destination: the swap resets the tile his route search heads for', () => {
    const t = corridor();
    setAutoBandageMode(t, true);
    const merc = spawn(t, START);
    merc.finalDestination = END_OF_CORRIDOR;
    spawn(t, BLOCKED_TILE, Team.ENEMY);
    waitAgain(t, merc, SECOND_WAIT);
    expect([merc.gridNo, merc.finalDestination, merc.pathStored]).toEqual([BLOCKED_TILE, NOWHERE, true]);
    expect(content.animations.controls[merc.state]?.id).toBe('STANDING');
  });

  it('makes the first soldier of a swap look and reveal the room in view, but not the second: his teleport fails on his own tile', () => {
    const ROOM = 5;
    const SIGHT_RANGE = 26;
    const t = corridor();
    setAutoBandageMode(t, true);
    for (let x = 72; x <= 74; x++) t.world.level.rooms[gridNo(x, 80)] = ROOM;
    const merc = spawn(t, BLOCKED_TILE);
    merc.direction = merc.desiredDirection = Direction.WEST;
    merc.finalDestination = gridNo(72, 80);
    const blocker = spawn(t, START, Team.ENEMY);
    const enemyComingIntoRange = spawn(t, START - SIGHT_RANGE, Team.ENEMY);
    const mercInFrontOfTheBlocker = spawn(t, gridNo(86, 80));
    waitAgain(t, merc, SECOND_WAIT, START);
    expect([merc.gridNo, blocker.gridNo]).toEqual([START, BLOCKED_TILE]);
    expect(merc.oppList[enemyComingIntoRange.id]).toBe(Opp.SEEN_CURRENTLY);
    expect(revealedRooms(t)).toEqual([ROOM]);
    expect(blocker.oppList[mercInFrontOfTheBlocker.id]).toBe(Opp.NOT_HEARD_OR_SEEN);
  });
});

describe("a follower's speed (Soldier_Tile.cc SetDelayedTileWaiting, Soldier_Control.cc SetSoldierAniSpeed, EVENT_StopMerc)", () => {
  function walkingDelay(t: TacticalState, s: Soldier): number {
    s.state = states(content.animations).WALKING;
    setSoldierAniSpeed(t, s);
    return s.aniDelay;
  }

  it("walks a merc waiting on a squad mate at the mate's speed until he stops on his final tile", () => {
    const t = tactical();
    const follower = spawn(t, START);
    const slow = spawn(t, START + 1);
    slow.stats.agility = 20;
    slow.breath = 40;
    const own = walkingDelay(t, follower);
    const mates = walkingDelay(t, slow);
    expect(mates).toBeGreaterThan(own);
    setDelayedTileWaiting(t, follower, slow.gridNo, 100);
    expect([follower.useOverrideMoveSpeed, follower.overrideMoveSpeed]).toEqual([true, slow.id]);
    expect(walkingDelay(t, follower)).toBe(mates);
    stopMerc(t, follower);
    expect(follower.useOverrideMoveSpeed).toBe(false);
    expect(walkingDelay(t, follower)).toBe(own);
  });

  it("keeps the mate's speed once he arrives, so he breathes at the mate's pace until a stop clears it", () => {
    const t = tactical();
    const follower = spawn(t, START);
    const slow = spawn(t, START + 10);
    slow.breath = 40;
    setDelayedTileWaiting(t, follower, slow.gridNo, 100);
    expect(getNewSoldierPath(t, follower, START + 3, follower.uiMovementMode)).toBe(true);
    runUntilStill(t);
    expect([follower.gridNo, follower.state, follower.useOverrideMoveSpeed]).toEqual([
      START + 3,
      states(content.animations).STANDING,
      true,
    ]);
    expect(follower.aniDelay).toBe(slow.breath * 2 + (100 - slow.life));
    stopMerc(t, follower);
    expect(follower.useOverrideMoveSpeed).toBe(false);
  });

  it('takes the speed of whoever reserved the tile, and never of a soldier of another team or for one', () => {
    const t = tactical();
    const follower = spawn(t, START);
    const reserver = spawn(t, START + 5);
    t.reserved[START + 1] = reserver.id;
    setDelayedTileWaiting(t, follower, START + 1, 1);
    expect(follower.overrideMoveSpeed).toBe(reserver.id);
    const enemy = spawn(t, START + 10, Team.ENEMY);
    const another = spawn(t, START + 11);
    setDelayedTileWaiting(t, another, enemy.gridNo, 1);
    setDelayedTileWaiting(t, enemy, another.gridNo, 1);
    expect([another.useOverrideMoveSpeed, enemy.useOverrideMoveSpeed]).toEqual([false, false]);
  });
});

describe('a blood trail (Overhead.cc HandleBloodForNewGridNo)', () => {
  const TRAIL_DIE = 7;

  it('drops (bleeding - 12) / 10 blood, at most 7, less Random(7) at the middle of every tile a soldier bleeding past 12 reaches, none below 0', () => {
    const t = tactical();
    const s = spawn(t, START);
    s.bleeding = 42;
    const rng = t.rng as unknown as { int(n: number): number };
    const real = rng.int.bind(rng);
    const trail = [0, 3, 2];
    let rolled = 0;
    rng.int = (n: number) => {
      if (n !== TRAIL_DIE) return real(n);
      rolled++;
      return trail.shift() ?? 6;
    };
    expect(getNewSoldierPath(t, s, START + 3, s.uiMovementMode)).toBe(true);
    runUntilStill(t);
    expect(rolled).toBe(3);
    expect([1, 2, 3].map((k) => bloodFloorStrength(t.smell.blood[START + k] ?? 0))).toEqual([3, 0, 1]);
    const steady = tactical();
    const unhurt = spawn(steady, START);
    unhurt.bleeding = 12;
    const ranges: number[] = [];
    const steadyRng = steady.rng as unknown as { int(n: number): number };
    const steadyReal = steadyRng.int.bind(steadyRng);
    steadyRng.int = (n: number) => {
      ranges.push(n);
      return steadyReal(n);
    };
    getNewSoldierPath(steady, unhurt, START + 3, unhurt.uiMovementMode);
    runUntilStill(steady);
    expect(ranges).not.toContain(TRAIL_DIE);
  });
});

describe('the paths of a prone soldier, whose crawling body covers his tile and the one behind him', () => {
  const TAIL_OF_AN_EAST_STEP = START - 1;
  const BOXED_IN = DIRECTION_INCREMENT.map((step) => START + step).filter((g) => g !== START + 1);

  function crawler(raised: readonly number[]): { t: TacticalState; s: Soldier } {
    const t = tactical(() => {}, withTwoTileProneBody(content));
    raiseTiles(t, raised);
    const s = spawn(t, START);
    s.direction = Direction.NORTH;
    layProne(t, s);
    expect(s.multiTile).toBe(true);
    return { t, s };
  }

  it('tests the crawling body at every step: a tail on a raised tile turns the route aside where a walker goes straight', () => {
    for (const fromUI of [0, 2]) {
      const { t, s } = crawler([TAIL_OF_AN_EAST_STEP]);
      expect(getNewSoldierPath(t, s, START + 2, states(content.animations).CRAWLING, fromUI)).toBe(true);
      expect([Direction.NORTHEAST, Direction.SOUTHEAST]).toContain(s.path[0]);
      expect(s.finalDestination).toBe(START + 2);
    }
  });

  it('finds no route, sets no tile wait and keeps waiting when the crawling body fits nowhere a walker could step', () => {
    const crawling = states(content.animations).CRAWLING;
    for (const fromUI of [0, 2]) {
      const { t, s } = crawler(BOXED_IN);
      expect(getNewSoldierPath(t, s, START + 2, crawling, fromUI)).toBe(false);
    }
    const exhausted = crawler(BOXED_IN);
    exhausted.s.finalDestination = START + 2;
    expect(pathExhausted(exhausted.t, exhausted.s)).toBe(false);
    expect(exhausted.s.delayedMovementCause).toBe(NOWHERE);
    const waiting = crawler(BOXED_IN);
    waiting.s.finalDestination = START + 2;
    setDelayedTileWaiting(waiting.t, waiting.s, START + 1, 1);
    waiting.t.clockMs = waiting.s.nextTileCheckAt;
    handleNextTileWaiting(waiting.t, waiting.s);
    expect(waiting.s.delayedMovement).toBe(2);
    expect(waiting.s.ai.actionData).not.toBe(START + 2);
  });
});

describe('a blocked final destination', () => {
  const DESTINATION = gridNo(80, 90);
  const NORTH = -WORLD_COLS;
  const WEST = -1;
  const DESPERATE_WAIT = 150;

  function waiting(t: TacticalState, delayedMovement: number): Soldier {
    const mover = spawn(t, START);
    mover.finalDestination = DESTINATION;
    setDelayedTileWaiting(t, mover, START + 1, delayedMovement);
    t.clockMs = mover.nextTileCheckAt;
    return mover;
  }

  it('is replaced by the closest free tile, by cell range while waiting and by cardinal distance once desperate', () => {
    const cases = [
      { delayedMovement: 1, spot: DESTINATION + NORTH + WEST },
      { delayedMovement: DESPERATE_WAIT, spot: DESTINATION + 2 * NORTH },
    ];
    for (const { delayedMovement, spot } of cases) {
      const t = tactical();
      for (const g of [DESTINATION, DESTINATION + NORTH, DESTINATION + WEST, DESTINATION - WEST, DESTINATION - NORTH]) spawn(t, g);
      const mover = waiting(t, delayedMovement);
      handleNextTileWaiting(t, mover);
      expect(mover.ai.actionData).toBe(spot);
      expect(mover.finalDestination).toBe(spot);
    }
  });

  it('keeps waiting when no free tile is reachable from it', () => {
    const t = tactical((w) => {
      for (const step of DIRECTION_INCREMENT) w.add(DESTINATION + step, 0, syntheticStructure(StructureFlags.GENERIC));
    });
    spawn(t, DESTINATION);
    const mover = waiting(t, DESPERATE_WAIT);
    handleNextTileWaiting(t, mover);
    expect(mover.finalDestination).toBe(DESTINATION);
    expect(mover.delayedMovement).toBe(DESPERATE_WAIT + 1);
  });
});

describe('stopping a soldier in combat', () => {
  function shooterTurningAway() {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.SOUTH);
    sim.lookAround();
    eventFireSoldierWeapon(t, enemy, merc.gridNo);
    expect(enemy.turningToShoot).toBe(true);
    expect(t.turn.attackBusyCount).toBe(1);
    return { t, enemy };
  }

  it('releases a turn to shoot and clears the prone turn, the pending direction and the pending action', () => {
    const { t, enemy } = shooterTurningAway();
    enemy.turningFromPronePosition = TurningFromProne.ON;
    enemy.pendingDirection = Direction.EAST;
    enemy.pendingTalk = 5;
    stopMerc(t, enemy);
    expect(enemy.turningToShoot).toBe(false);
    expect(t.turn.attackBusyCount).toBe(0);
    expect(enemy.turningFromPronePosition).toBe(TurningFromProne.OFF);
    expect(enemy.pendingDirection).toBe(NO_PENDING_DIRECTION);
    expect(enemy.pendingTalk).toBeNull();
  });

  it('keeps the pending direction and action of a soldier waiting for a tile', () => {
    const { t, enemy } = shooterTurningAway();
    enemy.pendingDirection = Direction.EAST;
    enemy.pendingTalk = 5;
    enemy.delayedMovement = 1;
    stopMerc(t, enemy);
    expect(enemy.pendingDirection).toBe(Direction.EAST);
    expect(enemy.pendingTalk).toBe(5);
  });

  it('drops the pending action of a soldier interrupted on his final tile only', () => {
    const { t, enemy } = shooterTurningAway();
    t.hooks = { ...t.hooks, atNewGridNo: () => true };
    enemy.pendingTalk = 5;
    enemy.finalDestination = gridNo(80, 90);
    handleAtNewGridNo(t, enemy);
    expect(enemy.pendingTalk).toBe(5);
    enemy.finalDestination = enemy.gridNo;
    handleAtNewGridNo(t, enemy);
    expect(enemy.pendingTalk).toBeNull();
  });
});

describe('a creature that cannot turn steps backwards (Overhead.cc HandleGotoNewGridNo)', () => {
  const WEST = DIRECTION_INCREMENT[Direction.WEST] ?? 0;
  const BESIDE_THE_CORRIDOR = [
    Direction.NORTH,
    Direction.NORTHEAST,
    Direction.SOUTHEAST,
    Direction.SOUTH,
    Direction.SOUTHWEST,
    Direction.NORTHWEST,
  ].map((d) => START + (DIRECTION_INCREMENT[d] ?? 0));
  const STEP_AP_BUDGET = 40;
  const stateNamed = (name: string) => content.animations.stateIndex.get(name) ?? -1;
  const nameOf = (s: Soldier) => content.animations.controls[s.state]?.id;

  function creatureFacingEast(body: number, corridor: boolean): { t: TacticalState; s: Soldier } {
    const t = tactical(() => {}, withTwoTileCreatureBodies(content, [body]));
    if (corridor) raiseTiles(t, BESIDE_THE_CORRIDOR);
    const st = states(content.animations);
    const s = createSoldier({
      id: 0,
      team: Team.CREATURE,
      name: 'C0',
      bodyType: body,
      palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
      stats: STATS,
      life: 100,
      gridNo: START,
      direction: Direction.EAST,
      state: st.STANDING,
    });
    registerSoldier(t, s);
    setSoldierPosition(t, s, START);
    initNewSoldierAnim(t, s, st.STANDING, 0, true);
    expect(s.multiTile).toBe(true);
    return { t, s };
  }

  function stepWest(t: TacticalState, s: Soldier, walk: string): void {
    t.inCombat = true;
    s.actionPoints = STEP_AP_BUDGET;
    s.state = stateNamed(walk);
    s.path = [Direction.WEST, Direction.WEST];
    s.pathIndex = 0;
    s.pathSize = s.path.length;
    s.finalDestination = START + 2 * WEST;
    expect(handleGotoNewGridNo(t, s, false, s.state)).toEqual({ ok: true, keepMoving: true });
  }

  it('changes a walking bloodcat, adult monster and infant to their backward walks, facing away from the step', () => {
    const walks: [number, string, string][] = [
      [Body.BLOODCAT, 'WALKING', 'BLOODCAT_WALK_BACKWARDS'],
      [Body.AM_MONSTER, 'ADULTMONSTER_WALKING', 'MONSTER_WALK_BACKWARDS'],
      [Body.INFANT_MONSTER, 'WALKING', 'WALK_BACKWARDS'],
    ];
    for (const [body, walk, backwards] of walks) {
      const { t, s } = creatureFacingEast(body, true);
      stepWest(t, s, walk);
      expect([nameOf(s), s.reverse, s.direction, s.desiredDirection, s.movementDirection]).toEqual([
        backwards,
        true,
        Direction.EAST,
        Direction.EAST,
        Direction.WEST,
      ]);
    }
  });

  it('pays the step twice where it starts stepping backwards: the forced backward walk takes the step again, reversed', () => {
    const spent = (corridor: boolean) => {
      const { t, s } = creatureFacingEast(Body.BLOODCAT, corridor);
      stepWest(t, s, 'WALKING');
      return STEP_AP_BUDGET - s.actionPoints;
    };
    const forward = spent(false);
    expect(forward).toBeGreaterThan(0);
    expect(spent(true)).toBe(2 * forward + AP.REVERSE_MODIFIER);
  });

  it('walks a creature that can turn forward again, clearing the reverse but keeping the backward walk it is in', () => {
    const { t, s } = creatureFacingEast(Body.BLOODCAT, false);
    s.reverse = true;
    stepWest(t, s, 'BLOODCAT_WALK_BACKWARDS');
    expect([nameOf(s), s.reverse, s.desiredDirection]).toEqual(['BLOODCAT_WALK_BACKWARDS', false, Direction.WEST]);
  });

  it('leaves a soldier that is no creature walking forward', () => {
    const { t, s } = creatureFacingEast(Body.REGMALE, true);
    stepWest(t, s, 'WALKING');
    expect([nameOf(s), s.reverse, s.desiredDirection]).toEqual(['WALKING', false, Direction.WEST]);
  });

  it('keeps its forward walk when it cannot turn at the first step of a move: the walk it set out in replaces the backward one', () => {
    const { t, s } = creatureFacingEast(Body.BLOODCAT, true);
    const walking = states(content.animations).WALKING;
    expect(getNewSoldierPath(t, s, START + 2 * WEST, walking)).toBe(true);
    expect([nameOf(s), s.reverse, s.desiredDirection, s.movementDirection]).toEqual(['WALKING', true, Direction.EAST, Direction.WEST]);
    const walked = new Set<string>();
    for (let pass = 0; pass < 2_000 && s.gridNo !== START + 2 * WEST; pass++) {
      executeOverhead(t);
      walked.add(`${nameOf(s)} facing ${s.direction}`);
    }
    expect(s.gridNo).toBe(START + 2 * WEST);
    expect([...walked]).toEqual([`WALKING facing ${Direction.EAST}`]);
  });
});

describe('a tile under the body of another soldier (WorldMan.cc WhoIsThere2: a person tile nobody may pass holds him)', () => {
  const TAIL = START + WORLD_COLS;
  const BEFORE_THE_TAIL = TAIL + WORLD_COLS;

  function bodyFacingNorth(): { t: TacticalState; body: Soldier } {
    const t = tactical(() => {}, withTwoTileCreatureBodies(content, [Body.REGFEMALE]));
    const st = states(content.animations);
    const body = createSoldier({
      id: 0,
      team: Team.OUR,
      name: 'B0',
      bodyType: Body.REGFEMALE,
      palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
      stats: STATS,
      life: 100,
      gridNo: START,
      direction: Direction.NORTH,
      state: st.STANDING,
    });
    registerSoldier(t, body);
    setSoldierPosition(t, body, START);
    initNewSoldierAnim(t, body, st.STANDING, 0, true);
    body.finalDestination = body.gridNo;
    expect(body.multiTile).toBe(true);
    return { t, body };
  }

  it('holds him on every tile his body covers', () => {
    const { t, body } = bodyFacingNorth();
    const tiles: [number, number][] = [
      [START, 0],
      [TAIL, 0],
      [BEFORE_THE_TAIL, 0],
      [TAIL, 1],
    ];
    expect(tiles.map(([g, level]) => whoIsThere(t, g, level)?.id ?? null)).toEqual([body.id, body.id, null, null]);
  });

  it('stops an enemy sent onto it short of it, where he can still turn', () => {
    const { t } = bodyFacingNorth();
    const walker = spawn(t, BEFORE_THE_TAIL + 2 * WORLD_COLS, Team.ENEMY);
    expect(getNewSoldierPath(t, walker, TAIL, walker.uiMovementMode)).toBe(true);
    runUntilStill(t);
    expect(walker.gridNo).toBe(BEFORE_THE_TAIL);
    setDesiredDirection(t, walker, Direction.WEST);
    for (let tick = 0; tick < TURN_TICKS && walker.direction !== Direction.WEST; tick++) executeOverhead(t);
    expect(walker.direction).toBe(Direction.WEST);
  });
});

describe('a walk that starts facing away (Soldier_Control.cc:3914 SOLDIER_PAUSEANIMOVE)', () => {
  const WALK_TICKS = 4_000;
  const FROM = gridNo(80, 80);
  const TO = FROM + 2 * (DIRECTION_INCREMENT[Direction.NORTH] ?? 0);

  function walkNorthFacingEast(body: number, team: number, id: number): { readonly movedWhileTurning: boolean; readonly arrived: boolean } {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = spawnSoldier(sim, id, team, FROM, Direction.EAST, { body });
    expect(getNewSoldierPath(t, s, TO, states(content.animations).WALKING)).toBe(true);
    let movedWhileTurning = false;
    for (let tick = 0; tick < WALK_TICKS && s.gridNo !== TO; tick++) {
      const before = { x: s.x, y: s.y };
      const turning = s.direction !== s.desiredDirection;
      executeOverhead(t);
      if (turning && (s.x !== before.x || s.y !== before.y)) movedWhileTurning = true;
    }
    return { movedWhileTurning, arrived: s.gridNo === TO };
  }

  it('holds a creature on its tile until it faces its first step, while a merc walks as he turns', () => {
    expect(walkNorthFacingEast(Body.BLOODCAT, Team.CREATURE, 40)).toEqual({ movedWhileTurning: false, arrived: true });
    expect(walkNorthFacingEast(Body.REGMALE, Team.OUR, 0)).toEqual({ movedWhileTurning: true, arrived: true });
  });
});

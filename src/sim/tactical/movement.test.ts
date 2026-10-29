import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { StructureFlags, type WorldStructures } from '../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import { Rng } from '../../core/rng.ts';
import { initNewSoldierAnim, states, TurningFromProne } from './animation.ts';
import { eventFireSoldierWeapon } from './combat/attack.ts';
import type { TacticalContent } from './content.ts';
import {
  getNewSoldierPath,
  handleAtNewGridNo,
  handleNextTile,
  moveMerc,
  setSoldierDestination,
  setSoldierPosition,
  stopMerc,
} from './movement.ts';
import { executeOverhead } from './overhead.ts';
import { createSoldier, NO_PENDING_DIRECTION, type Soldier, Team } from './soldier.ts';
import { createTacticalState, registerSoldier, type TacticalState, whoIsThere } from './state.ts';

const doorCosts = testDoorCosts();
let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function tactical(place: (s: WorldStructures) => void = () => {}): TacticalState {
  const w = syntheticWorld(doorCosts, place);
  return createTacticalState({ ...w, mapDoors: new Map() }, content, Rng.fromSeed(7));
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

  it('lets an enemy open a closed door on the way and close it behind him', () => {
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
    const t = tactical((w) => {
      for (let x = 70; x <= 90; x++) {
        if (x === 80) w.add(gridNo(x, 79), 0, closed, undefined, file);
        else w.add(gridNo(x, 79), 0, syntheticStructure(StructureFlags.WALL, Orientation.INSIDE_LEFT));
      }
    });
    const s = spawn(t, START, Team.ENEMY);
    expect(getNewSoldierPath(t, s, gridNo(80, 77), s.uiMovementMode)).toBe(true);
    runUntilStill(t, 100_000);
    expect(s.gridNo).toBe(gridNo(80, 77));
    expect(t.events.filter((e) => e.type === 'doorChanged').map((e) => (e.type === 'doorChanged' ? e.open : null))).toEqual([true, false]);
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
      const t = tactical((w) => {
        for (let x = 70; x <= 90; x++) {
          w.add(gridNo(x, 79), 0, syntheticStructure(StructureFlags.GENERIC));
          w.add(gridNo(x, 81), 0, syntheticStructure(StructureFlags.GENERIC));
        }
        w.add(gridNo(89, 80), 0, syntheticStructure(StructureFlags.GENERIC));
      });
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

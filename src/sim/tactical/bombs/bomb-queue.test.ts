import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { itemId, objectOf } from '../../../../tests/support/explosives.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { NOTHING } from '../../../content/items/items.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticMap, syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { Rng } from '../../../core/rng.ts';
import { TICK_MS } from '../../clock.ts';
import type { SimEvent } from '../../events.ts';
import { AiAction } from '../ai/actions.ts';
import type { TacticalContent } from '../content.ts';
import { handleAtNewGridNo } from '../movement.ts';
import { type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import { type TacticalState, WaitForMercs } from '../state.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { beginTeamTurn, handleTacticalEndTurn } from '../turns/turns.ts';
import { addItemToPool, removeWorldItem, Visibility, type WorldItem, WorldItemFlags } from '../world-items.ts';
import {
  armBomb,
  bombItemOf,
  Detonator,
  delayOf,
  ItemAction,
  setActionValue,
  setBombItem,
  setBombOwner,
  setDetonator,
  setFrequency,
} from './bomb-object.ts';
import {
  decayBombTimers,
  handleExplosionQueue,
  MAX_BOMB_QUEUE,
  removeAllActiveTimedBombs,
  setOffBombsByFrequency,
  setOffBombsInGridNo,
} from './bomb-queue.ts';
import { hasMineFlag, MineFlag, setMineFlag } from './mine-flags.ts';
import { activeTimedBombExists } from './world-bombs.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_AT = gridNo(80, 80);
const FAR = gridNo(110, 110);
const FREQUENCY = 1;
const BOMB_QUEUE_BASE_DELAY_MS = 1000;
const BOMB_QUEUE_DELAY_SPREAD = 500;
const SOLDIER_OWNER_OFFSET = 2;
const LAST_TEAM = Team.CIV;

interface Arming {
  readonly action?: number;
  readonly bombItem?: string;
  readonly owner?: number;
  readonly level?: number;
}

function placeArmed(t: TacticalState, g: number, name: string, detonator: number, setting: number, arming: Arming = {}): WorldItem {
  const o = objectOf(t, name);
  setDetonator(o, detonator);
  setFrequency(o, setting);
  setBombItem(o, arming.bombItem === undefined ? o.item : itemId(t, arming.bombItem));
  if (arming.action !== undefined) setActionValue(o, arming.action);
  if (arming.owner !== undefined) setBombOwner(o, arming.owner);
  const item = addItemToPool(t, g, o, Visibility.BURIED, arming.level ?? 0, WorldItemFlags.ARMED_BOMB);
  if (!item) throw new Error(`cannot place ${name}`);
  return item;
}

function placeMine(t: TacticalState, g: number, owner = 0): WorldItem {
  const o = objectOf(t, 'MINE');
  armBomb(t, o, Detonator.PRESSURE);
  setBombOwner(o, owner);
  const item = addItemToPool(t, g, o, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB);
  if (!item) throw new Error('cannot place the mine');
  return item;
}

function minefield(t: TacticalState, g: number): WorldItem {
  return placeArmed(t, g, 'ACTION_ITEM', Detonator.PRESSURE, 0, { action: ItemAction.BLOW_UP, bombItem: 'MINE', owner: 1 });
}

function scene(): { readonly sim: TacticalSim; readonly t: TacticalState; readonly merc: Soldier } {
  const sim = newCombatSim(content);
  return { sim, t: sim.state, merc: spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.EAST) };
}

function enemyAt(sim: TacticalSim, g: number, team: number = Team.ENEMY): Soldier {
  return spawnSoldier(sim, TEAM_FIRST_ID[team] ?? 0, team, g, Direction.WEST);
}

interface Timed {
  readonly clockMs: number;
  readonly event: SimEvent;
}

function stepUntilQueueEnds(sim: TacticalSim, limit = 20_000): Timed[] {
  const timed: Timed[] = [];
  for (let k = 0; k < limit && sim.state.explosionQueue.active; k++) {
    const clockMs = sim.state.clockMs;
    sim.step();
    for (const event of sim.drainEvents()) timed.push({ clockMs, event });
  }
  expect(sim.state.explosionQueue.active).toBe(false);
  return timed;
}

function firstPassAt(ms: number): number {
  return Math.ceil(ms / TICK_MS) * TICK_MS;
}

function ofType(timed: readonly Timed[], type: string): Timed[] {
  return timed.filter((x) => x.event.type === type);
}

describe('the bomb queue (Explosion_Control.cc AddBombToQueue, HandleExplosionQueue)', () => {
  it('spaces the explosive bombs of one set-off 1000 + Random(500) ms apart in slot order, with no draw after an action item', () => {
    const { sim, t, merc } = scene();
    placeArmed(t, FAR, 'C4', Detonator.REMOTE, FREQUENCY);
    placeArmed(t, FAR + 5, 'ACTION_ITEM', Detonator.REMOTE, FREQUENCY, { action: ItemAction.KLAXON });
    placeArmed(t, FAR + 10, 'TNT', Detonator.REMOTE, FREQUENCY);
    const probe = Rng.fromState(t.rng.state());
    const gap = BOMB_QUEUE_BASE_DELAY_MS + probe.int(BOMB_QUEUE_DELAY_SPREAD);
    probe.int(BOMB_QUEUE_DELAY_SPREAD);
    const now = t.clockMs;
    setOffBombsByFrequency(t, merc, FREQUENCY);
    expect(t.explosionQueue.entries.map((e) => [e.bomb, e.timestamp])).toEqual([
      [0, now],
      [1, now + gap],
      [2, now + gap],
    ]);
    expect(t.rng.state()).toEqual(probe.state());
    expect([t.explosionQueue.active, t.perception.disallowSight]).toEqual([true, true]);
    const timed = stepUntilQueueEnds(sim);
    expect(ofType(timed, 'explosion').map((x) => [x.event.type === 'explosion' && x.event.item, x.clockMs])).toEqual([
      [itemId(t, 'C4'), now],
      [itemId(t, 'TNT'), firstPassAt(now + gap)],
    ]);
    expect(ofType(timed, 'alarm').map((x) => x.clockMs)).toEqual([firstPassAt(now + gap)]);
    expect(t.perception.disallowSight).toBe(false);
  });

  it(`loses the bombs set off past the ${MAX_BOMB_QUEUE}th`, () => {
    const { t, merc } = scene();
    for (let k = 0; k <= MAX_BOMB_QUEUE; k++)
      placeArmed(t, FAR + k, 'ACTION_ITEM', Detonator.REMOTE, FREQUENCY, { action: ItemAction.KLAXON });
    setOffBombsByFrequency(t, merc, FREQUENCY);
    expect(t.explosionQueue.entries.map((e) => e.bomb)).toEqual(Array.from({ length: MAX_BOMB_QUEUE }, (_, k) => k));
  });

  it('shortens the queue only over the entries at its end that went off, and ends once the attack of the soldier who set it off is over', () => {
    const { sim, t, merc } = scene();
    placeArmed(t, FAR, 'C4', Detonator.REMOTE, FREQUENCY);
    placeArmed(t, FAR + 10, 'TNT', Detonator.REMOTE, FREQUENCY);
    setOffBombsByFrequency(t, merc, FREQUENCY);
    const second = t.explosionQueue.entries[1];
    if (!second) throw new Error('nothing queued second');
    handleExplosionQueue(t);
    expect(t.explosionQueue.entries.map((e) => e.exists)).toEqual([false, true]);
    t.clockMs = second.timestamp;
    handleExplosionQueue(t);
    expect(t.explosionQueue.entries).toEqual([]);
    expect(t.turn.attackBusyCount).toBeGreaterThan(0);
    expect(t.explosionQueue.active).toBe(true);
    stepUntilQueueEnds(sim);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it("takes a dud's timed bomb off the map without a blast: its bomb item is none", () => {
    const { sim, t } = scene();
    const dud = placeArmed(t, FAR, 'HAND_GRENADE', Detonator.TIMED, 1);
    setBombItem(dud.object, NOTHING);
    expect(activeTimedBombExists(t)).toBe(true);
    decayBombTimers(t);
    const timed = stepUntilQueueEnds(sim);
    expect(ofType(timed, 'explosion')).toEqual([]);
    expect(t.worldItems).not.toContain(dud);
    expect(activeTimedBombExists(t)).toBe(false);
  });

  it('keeps a trip klaxon armed: every step on it calls the enemies again', () => {
    const { t, merc, sim } = scene();
    enemyAt(sim, FAR);
    const klaxon = objectOf(t, 'TRIP_KLAXON');
    armBomb(t, klaxon, Detonator.PRESSURE);
    const item = addItemToPool(t, MERC_AT, klaxon, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB);
    for (let step = 0; step < 2; step++) {
      t.perception.publicNoiseGridNo[Team.ENEMY] = -1;
      expect(setOffBombsInGridNo(t, merc, MERC_AT, false, 0)).toBe(true);
      handleExplosionQueue(t);
      expect(sim.drainEvents().filter((e) => e.type === 'alarm')).toEqual([expect.objectContaining({ gridNo: MERC_AT, kind: 'klaxon' })]);
      expect(t.perception.publicNoiseGridNo[Team.ENEMY]).toBe(MERC_AT);
      expect(t.worldItems).toContain(item);
    }
  });

  it('lights a trip flare and takes it off the map', () => {
    const { t, merc } = scene();
    const flare = objectOf(t, 'TRIP_FLARE');
    armBomb(t, flare, Detonator.PRESSURE);
    const item = addItemToPool(t, MERC_AT, flare, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB);
    setOffBombsInGridNo(t, merc, MERC_AT, false, 0);
    handleExplosionQueue(t);
    expect(t.explosives.lights.filter((l) => l?.gridNo === MERC_AT)).toHaveLength(1);
    expect(t.worldItems).not.toContain(item);
    expect(t.worldBombs.map((b) => b.exists)).toEqual([false]);
  });

  it("blows up a mine for the soldier who planted it, and clears the tile's mine marks with it", () => {
    const { sim, t, merc } = scene();
    const enemy = enemyAt(sim, FAR);
    const mine = placeMine(t, FAR, merc.id + SOLDIER_OWNER_OFFSET);
    setMineFlag(t, FAR, MineFlag.PLAYER | MineFlag.ENEMY);
    expect(setOffBombsInGridNo(t, enemy, FAR, false, 0)).toBe(true);
    handleExplosionQueue(t);
    expect(sim.drainEvents().filter((e) => e.type === 'explosion')).toEqual([
      expect.objectContaining({ item: itemId(t, 'MINE'), gridNo: FAR, owner: merc.id }),
    ]);
    expect(t.worldItems).not.toContain(mine);
    expect([hasMineFlag(t, FAR, MineFlag.PLAYER), hasMineFlag(t, FAR, MineFlag.ENEMY)]).toEqual([false, false]);
  });

  it('keeps sight off from one blast to the next until the queue ends: an explosion turns sight on only with the queue idle', () => {
    const { sim, t, merc } = scene();
    placeArmed(t, FAR, 'C4', Detonator.REMOTE, FREQUENCY);
    placeArmed(t, FAR + 10, 'C4', Detonator.REMOTE, FREQUENCY);
    setOffBombsByFrequency(t, merc, FREQUENCY);
    const second = t.explosionQueue.entries[1];
    if (!second) throw new Error('nothing queued second');
    sim.step();
    expect(t.turn.checkSightAtEndOfAttack).toBe(false);
    while (t.explosives.aniTiles.some((a) => a.kind === 'explosion')) sim.step();
    expect(second.exists).toBe(true);
    expect(t.perception.disallowSight).toBe(true);
    stepUntilQueueEnds(sim);
    expect(t.perception.disallowSight).toBe(false);
  });

  it('still sets off a bomb taken off the map after it was queued: an entry keeps its slot, and the slot its item', () => {
    const { sim, t, merc } = scene();
    const bomb = placeArmed(t, FAR, 'TNT', Detonator.REMOTE, FREQUENCY);
    setOffBombsByFrequency(t, merc, FREQUENCY);
    removeWorldItem(t, bomb);
    expect(t.worldBombs.map((b) => b.exists)).toEqual([false]);
    handleExplosionQueue(t);
    expect(sim.drainEvents().filter((e) => e.type === 'explosion')).toEqual([expect.objectContaining({ gridNo: FAR })]);
  });

  it('frees the soldier who set it off from his pending action at its end, a pulled trigger too: no animation test (FreeUpNPCFromPendingAction)', () => {
    const { sim, t } = scene();
    const enemy = enemyAt(sim, FAR);
    enemy.ai.action = AiAction.PULL_TRIGGER;
    enemy.ai.actionInProgress = true;
    placeArmed(t, FAR + 10, 'ACTION_ITEM', Detonator.REMOTE, FREQUENCY, { action: ItemAction.KLAXON });
    setOffBombsByFrequency(t, enemy, FREQUENCY);
    handleExplosionQueue(t);
    expect(t.explosionQueue.active).toBe(false);
    expect([enemy.ai.action, enemy.ai.lastAction]).toEqual([AiAction.NONE, AiAction.PULL_TRIGGER]);
  });
});

describe('stepping on bombs (SetOffBombsInGridNo, HandleAtNewGridNo)', () => {
  it('stops a soldier of any team on a mine and sets it off', () => {
    const { sim, t } = scene();
    const enemy = enemyAt(sim, FAR);
    placeMine(t, FAR);
    enemy.finalDestination = FAR + 5;
    expect(handleAtNewGridNo(t, enemy)).toBe(false);
    expect(enemy.finalDestination).toBe(FAR);
    expect(t.explosionQueue.entries).toHaveLength(1);
  });

  it('lets enemies and militia walk over a map minefield: an action item that blows up goes off for our team alone', () => {
    const { sim, t, merc } = scene();
    minefield(t, FAR);
    for (const team of [Team.ENEMY, Team.MILITIA]) expect(setOffBombsInGridNo(t, enemyAt(sim, FAR, team), FAR, false, 0)).toBe(false);
    expect(t.explosionQueue.entries).toEqual([]);
    expect(setOffBombsInGridNo(t, merc, FAR, false, 0)).toBe(true);
    expect(t.explosionQueue.entries).toHaveLength(1);
  });

  it('lets our team and the militia walk over a mine a soldier planted, which enemies set off', () => {
    const { sim, t, merc } = scene();
    placeMine(t, FAR, merc.id + SOLDIER_OWNER_OFFSET);
    expect(setOffBombsInGridNo(t, merc, FAR, false, 0)).toBe(false);
    expect(setOffBombsInGridNo(t, enemyAt(sim, FAR, Team.MILITIA), FAR, false, 0)).toBe(false);
    expect(t.explosionQueue.entries).toEqual([]);
    expect(setOffBombsInGridNo(t, enemyAt(sim, FAR), FAR, false, 0)).toBe(true);
  });

  it('sets off nothing at a step while mercs walk off the map or for a soldier out of breath, who collapses instead', () => {
    const { t, merc } = scene();
    placeMine(t, MERC_AT);
    t.mercsWaiting = { code: WaitForMercs.WALKOFF_SCREEN, remaining: 1, sinceMs: 0 };
    expect(handleAtNewGridNo(t, merc)).toBe(true);
    t.mercsWaiting = null;
    merc.breath = 0;
    expect(handleAtNewGridNo(t, merc)).toBe(true);
    expect(merc.breathCollapsed).toBe(true);
    expect(t.explosionQueue.entries).toEqual([]);
  });

  it('sets off the mine a soldier lands on behind a fence (code 444), short of his destination', () => {
    const base = syntheticWorld(testDoorCosts(), (structures) => {
      for (let x = 60; x <= 100; x++) structures.add(gridNo(x, 79), 0, syntheticStructure(StructureFlags.FENCE, Orientation.OUTSIDE_LEFT));
    });
    const world = { ...base, map: syntheticMap(), mapPath: 'synthetic' } as unknown as TacticalWorld;
    const sim = new TacticalSim(world, content, 3);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.NORTH);
    const landing = gridNo(80, 78);
    placeMine(t, landing);
    expect(sim.dispatch({ type: 'move', soldier: merc.id, to: gridNo(80, 76), mode: 'walk' })).toEqual({ ok: true });
    for (let k = 0; k < 5000 && !t.explosionQueue.active; k++) sim.step();
    expect([merc.gridNo, merc.finalDestination]).toEqual([landing, landing]);
  });
});

describe('bomb timers (DecayBombTimers)', () => {
  it('counts a timed bomb down at each real-time turn and at the end of each round, its planter the one who set it off', () => {
    const { t, merc } = scene();
    const bomb = placeArmed(t, FAR, 'C4', Detonator.TIMED, 3, { owner: merc.id + SOLDIER_OWNER_OFFSET });
    handleTacticalEndTurn(t, t.realtimeClock);
    expect(delayOf(bomb.object)).toBe(2);
    t.inCombat = true;
    beginTeamTurn(t, LAST_TEAM + 1);
    expect(delayOf(bomb.object)).toBe(1);
    beginTeamTurn(t, LAST_TEAM + 1);
    expect(t.explosionQueue.entries.map((e) => e.bomb)).toEqual([0]);
    expect(t.explosionQueue.person).toBe(merc);
  });

  it('runs a timer of 0 through 255 turns before it goes off: the delay is a signed byte', () => {
    const { t } = scene();
    const bomb = placeArmed(t, FAR, 'C4', Detonator.TIMED, 0);
    for (let turn = 1; turn < 256; turn++) decayBombTimers(t);
    expect([delayOf(bomb.object), t.explosionQueue.entries]).toEqual([1, []]);
    decayBombTimers(t);
    expect(t.explosionQueue.entries).toHaveLength(1);
  });

  it('takes every active timed bomb off the map with its item, and leaves the other bombs', () => {
    const { t } = scene();
    const timed = placeArmed(t, FAR, 'C4', Detonator.TIMED, 3);
    const remote = placeArmed(t, FAR + 5, 'C4', Detonator.REMOTE, FREQUENCY);
    removeAllActiveTimedBombs(t);
    expect(t.worldItems).toEqual([remote]);
    expect(t.worldItems).not.toContain(timed);
    expect(bombItemOf(remote.object)).toBe(itemId(t, 'C4'));
  });
});

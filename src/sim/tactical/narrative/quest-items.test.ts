import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo, WORLD_MAX } from '../../../content/world/grid.ts';
import { createItem, type ItemObject, ObjectFlags } from '../../items/object.ts';
import { civGroupHostility } from '../../strategic/narrative/civ-groups.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { AiAction } from '../ai/actions.ts';
import type { TacticalContent } from '../content.ts';
import { Opp } from '../perception/opp.ts';
import { AlertStatus, Body, CivilianGroup, type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { addItemToPool, Visibility, WorldItemFlags } from '../world-items.ts';
import { CivGroupHostility } from './constants.ts';
import { NO_NARRATIVE_PORT } from './port.ts';
import { Detonator, handleActionItemQueue, ItemAction, setOffActionItemsInGridNo } from './quest-items.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SEX_TILE = 13414;
const SEX_DOOR = 13413;
const BEDROOM = 5;
const CORRIDOR = 4;
const PLAYER_OWNED = 2;
const ALARM_FREQUENCY = 52;

function actionItem(action: number, owner = 0): ItemObject {
  const o = createItem(content.items, content.items.byName.get('ACTION_ITEM')?.index ?? 0, 100);
  o.gunAmmoType = Detonator.PRESSURE;
  o.keyId = action;
  o.money = owner << 8;
  return o;
}

function trigger(name: 'ACTION_ITEM' | 'SWITCH', detonator: number, frequency: number, action = 0): ItemObject {
  const o = createItem(content.items, content.items.byName.get(name)?.index ?? 0, 100);
  o.gunAmmoType = detonator;
  o.keyId = action;
  o.money = frequency;
  return o;
}

function arm(sim: TacticalSim, g: number, o: ItemObject): void {
  addItemToPool(sim.state, g, o, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB);
}

function withRooms(sim: TacticalSim): Uint8Array {
  const rooms = new Uint8Array(WORLD_MAX);
  (sim.state.world.map as unknown as { rooms: Uint8Array }).rooms = rooms;
  return rooms;
}

interface Log {
  readonly sex: number[];
  readonly hostile: number[];
  readonly facts: number[];
}

function narrative(sim: TacticalSim, facts: ReadonlySet<number> = new Set()): Log {
  const log: Log = { sex: [], hostile: [], facts: [] };
  sim.state.narrative = {
    ...NO_NARRATIVE_PORT,
    sexEffects: (s) => log.sex.push(s.id),
    sayHostileQuote: (s) => log.hostile.push(s.id),
    setFactTrue: (id) => log.facts.push(id),
    fact: (id) => facts.has(id),
  };
  return log;
}

function walk(sim: TacticalSim, s: Soldier, to: number): ReturnType<typeof runUntilIdle> {
  expect(sim.dispatch({ type: 'move', soldier: s.id, to, mode: 'walk' })).toEqual({ ok: true });
  return runUntilIdle(sim);
}

describe('the sex action item', () => {
  it('stops a merc who walks into a room with a working girl, plays the scene and puts him back outside', () => {
    const sim = newCombatSim(content);
    const rooms = withRooms(sim);
    rooms[SEX_TILE] = BEDROOM;
    rooms[SEX_TILE + 1] = BEDROOM;
    rooms[SEX_DOOR] = CORRIDOR;
    rooms[SEX_DOOR - 1] = CORRIDOR;
    const log = narrative(sim);
    const merc = spawnSoldier(sim, 0, Team.OUR, SEX_DOOR - 1, Direction.EAST);
    const girl = spawnSoldier(sim, 60, Team.CIV, SEX_TILE + 2, Direction.WEST);
    rooms[girl.gridNo] = BEDROOM;
    girl.bodyType = Body.MINICIV;
    girl.neutral = true;
    arm(sim, SEX_TILE, actionItem(ItemAction.SEX));
    const events = walk(sim, merc, SEX_TILE);
    expect(events).toContainEqual(expect.objectContaining({ type: 'sexScene', soldier: 0 }));
    expect(merc.gridNo).toBe(SEX_DOOR);
    expect(log.sex).toEqual([0]);
    expect(sim.state.perception.disallowSight).toBe(false);
    expect(sim.state.actionItems.active).toBe(false);
  });

  it('does nothing without a girl in the room, for a merc already inside, or for an item placed by the player', () => {
    const sim = newCombatSim(content);
    const rooms = withRooms(sim);
    rooms[SEX_TILE] = BEDROOM;
    rooms[SEX_DOOR] = CORRIDOR;
    rooms[SEX_DOOR - 1] = CORRIDOR;
    const log = narrative(sim);
    const merc = spawnSoldier(sim, 0, Team.OUR, SEX_DOOR - 1, Direction.EAST);
    arm(sim, SEX_TILE, actionItem(ItemAction.SEX));
    walk(sim, merc, SEX_TILE);
    expect(log.sex).toEqual([]);
    expect(merc.gridNo).toBe(SEX_TILE);
    const other = newCombatSim(content);
    const otherRooms = withRooms(other);
    otherRooms[SEX_TILE] = BEDROOM;
    otherRooms[SEX_DOOR] = CORRIDOR;
    const otherLog = narrative(other);
    const guest = spawnSoldier(other, 0, Team.OUR, SEX_DOOR - 1, Direction.EAST);
    const girl = spawnSoldier(other, 60, Team.CIV, SEX_TILE + 2, Direction.WEST);
    otherRooms[girl.gridNo] = BEDROOM;
    girl.bodyType = Body.MINICIV;
    girl.neutral = true;
    arm(other, SEX_TILE, actionItem(ItemAction.SEX, PLAYER_OWNED));
    walk(other, guest, SEX_TILE);
    expect(otherLog.sex).toEqual([]);
  });
});

describe('the Kingpin alarm', () => {
  it('rings when a merc steps on a pressure switch of its frequency: the group turns hostile, seers attack', () => {
    const sim = newCombatSim(content);
    narrative(sim);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const goon = spawnSoldier(sim, 60, Team.CIV, gridNo(80, 70), Direction.SOUTH);
    goon.civilianGroup = CivilianGroup.KINGPIN;
    goon.neutral = true;
    arm(sim, gridNo(82, 80), trigger('SWITCH', Detonator.PRESSURE, ALARM_FREQUENCY));
    arm(sim, gridNo(90, 60), trigger('ACTION_ITEM', Detonator.REMOTE, ALARM_FREQUENCY, ItemAction.KINGPIN_ALARM));
    arm(sim, gridNo(91, 60), trigger('ACTION_ITEM', Detonator.REMOTE, ALARM_FREQUENCY + 1, ItemAction.KINGPIN_ALARM));
    goon.oppList[merc.id] = Opp.SEEN_CURRENTLY;
    expect(sim.dispatch({ type: 'move', soldier: 0, to: gridNo(82, 80), mode: 'walk' })).toEqual({ ok: true });
    const events: string[] = [];
    for (let k = 0; k < 4000 && !sim.state.inCombat; k++) {
      goon.oppList[merc.id] = Opp.SEEN_CURRENTLY;
      sim.step();
      events.push(...sim.drainEvents().map((e) => e.type));
    }
    expect(events.filter((e) => e === 'alarm')).toHaveLength(1);
    expect(civGroupHostility(sim.state.civGroups, CivilianGroup.KINGPIN)).toBe(CivGroupHostility.HOSTILE);
    expect(goon.neutral).toBe(false);
    expect(sim.state.inCombat).toBe(true);
  });

  it('ignores enemies stepping on the tile and items marked disabled', () => {
    const sim = newCombatSim(content);
    narrative(sim);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(81, 80), Direction.EAST);
    arm(sim, gridNo(81, 80), actionItem(ItemAction.KINGPIN_ALARM));
    setOffActionItemsInGridNo(sim.state, enemy);
    expect(sim.state.actionItems.queue).toEqual([]);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(85, 80), Direction.EAST);
    const disabled = actionItem(ItemAction.KINGPIN_ALARM);
    disabled.flags |= ObjectFlags.DISABLED_BOMB;
    arm(sim, merc.gridNo, disabled);
    setOffActionItemsInGridNo(sim.state, merc);
    expect(sim.state.actionItems.queue).toEqual([]);
    expect(civGroupHostility(sim.state.civGroups, CivilianGroup.KINGPIN)).toBe(CivGroupHostility.NEUTRAL);
  });
});

describe('the museum alarm', () => {
  it('sends Eldin to the spot alert: sight is off while the action item runs, so he never sees it', () => {
    const sim = newCombatSim(content);
    withRooms(sim);
    const log = narrative(sim);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const eldin = spawnSoldier(sim, 60, Team.CIV, gridNo(83, 84), Direction.NORTH, { profile: Npc.ELDIN });
    arm(sim, gridNo(82, 80), actionItem(ItemAction.MUSEUM_ALARM));
    const events = walk(sim, merc, gridNo(82, 80));
    expect(events).toContainEqual(expect.objectContaining({ type: 'alarm', kind: 'museum', gridNo: gridNo(82, 80) }));
    expect(log.hostile).toEqual([]);
    expect(log.facts).toContain(Fact.MUSEUM_ALARM_WENT_OFF);
    expect(eldin.ai.alertStatus).toBe(AlertStatus.RED);
    expect(eldin.ai.noiseGridNo).toBe(gridNo(82, 80));
    expect([eldin.ai.nextAction, eldin.ai.action]).toContain(AiAction.GET_CLOSER);
  });

  it('leaves a busy Eldin alone when he already heard a loud noise', () => {
    const sim = newCombatSim(content);
    withRooms(sim);
    const log = narrative(sim);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(82, 80), Direction.EAST);
    const eldin = spawnSoldier(sim, 60, Team.CIV, gridNo(83, 120), Direction.NORTH, { profile: Npc.ELDIN });
    arm(sim, gridNo(82, 80), actionItem(ItemAction.MUSEUM_ALARM));
    setOffActionItemsInGridNo(sim.state, merc);
    expect(sim.state.perception.disallowSight).toBe(true);
    eldin.ai.alertStatus = AlertStatus.YELLOW;
    eldin.ai.noiseVolume = 6;
    handleActionItemQueue(sim.state);
    expect(sim.state.perception.disallowSight).toBe(false);
    expect(log.facts).toEqual([]);
    expect(eldin.ai.noiseGridNo).not.toBe(gridNo(82, 80));
  });
});

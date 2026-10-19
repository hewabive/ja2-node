import { beforeAll, describe, expect, it } from 'vitest';
import { estimateAttack, newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { WORLD_COLS } from '../../../content/world/grid.ts';
import { createItem, emptyObject } from '../../items/object.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { NarrativeHistory } from '../../strategic/narrative/history-codes.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { AiAction } from '../ai/actions.ts';
import { decideActionBoxerEnteringRing, decideActionGreenWhileBoxing } from '../ai/decide-boxing.ts';
import { endAIGuysTurn } from '../ai/turn-based.ts';
import { beginSoldierGetup } from '../combat/death.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { setSoldierPosition } from '../movement.ts';
import { calcActionPoints, calcNewActionPoints } from '../points.ts';
import { AlertStatus, Body, CivilianGroup, NOBODY, OKLIFE, SkillTrait, type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import {
  anotherFightPossible,
  boxerAvailable,
  boxerExists,
  boxingMovementCheck,
  checkOnBoxers,
  exitBoxing,
  findClosestBoxingRingSpot,
  setBoxingState,
  startBoxingMatch,
  triggerEndOfBoxingRecord,
} from './boxing.ts';
import { BOXER_GRIDNOS, BOXING_RING, BoxingState, boxingHalvesPoints, CENTER_OF_RING } from './boxing-state.ts';
import { processImplicationsOfPCAttack } from './civ-hostility.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from './port.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NORTH = 0;
const SURROUNDING_ROOM = 3;
const RING = { left: 35, right: 39, top: 68, bottom: 72 } as const;
const HALL = { left: 28, right: 46, top: 62, bottom: 78 } as const;
const grid = (x: number, y: number) => y * WORLD_COLS + x;
const OUTSIDE_RING = grid(31, 70);
const IN_RING = grid(36, 70);
const IN_RING_2 = grid(38, 70);
const ITEM_KNIFE = 'COMBAT_KNIFE';

interface Recorder extends NarrativePort {
  readonly calls: string[];
}

function recordingPort(): Recorder {
  const calls: string[] = [];
  return {
    ...NO_NARRATIVE_PORT,
    calls,
    triggerNpcRecord: (profile, record) => calls.push(`record ${profile} ${record}`),
    pauseGame: () => calls.push('pause'),
    unPauseGame: () => calls.push('unpause'),
    addHistory: (code, second) => calls.push(`history ${code} ${second}`),
    deleteTalkingMenu: () => calls.push('deleteTalkingMenu'),
  };
}

function boxingHall(sim: TacticalSim): void {
  const rooms = sim.state.world.level.rooms;
  for (let y = HALL.top; y <= HALL.bottom; y++) for (let x = HALL.left; x <= HALL.right; x++) rooms[grid(x, y)] = SURROUNDING_ROOM;
  for (let y = RING.top; y <= RING.bottom; y++) for (let x = RING.left; x <= RING.right; x++) rooms[grid(x, y)] = BOXING_RING;
}

interface Hall {
  readonly sim: TacticalSim;
  readonly port: Recorder;
  readonly merc: Soldier;
  readonly boxers: Soldier[];
}

function unarmed(s: Soldier): Soldier {
  s.inv[InvSlot.HAND] = emptyObject();
  return s;
}

function setup(): Hall {
  const sim = newCombatSim(content);
  boxingHall(sim);
  const port = recordingPort();
  sim.state.narrative = port;
  const merc = unarmed(spawnSoldier(sim, 0, Team.OUR, OUTSIDE_RING, NORTH, { profile: 5 }));
  const boxers = BOXER_GRIDNOS.map((g, i) => {
    const s = unarmed(spawnSoldier(sim, 116 + i, Team.CIV, g, NORTH));
    s.neutral = true;
    return s;
  });
  return { sim, port, merc, boxers };
}

function step(sim: TacticalSim, s: Soldier, to: number): void {
  setSoldierPosition(sim.state, s, to);
  boxingMovementCheck(sim.state, s);
}

describe('the boxers', () => {
  it('are the unarmed soldiers on the three boxer tiles, picked only while the first slot is empty', () => {
    const { sim, boxers } = setup();
    const b = sim.state.boxing;
    const armed = boxers[1] as Soldier;
    armed.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get(ITEM_KNIFE)?.index ?? 0, 100);
    expect(checkOnBoxers(b, sim.state)).toBe(true);
    expect(b.boxers).toEqual([116, NOBODY, 118]);
    b.boxers[2] = NOBODY;
    expect(checkOnBoxers(b, sim.state)).toBe(true);
    expect(b.boxers).toEqual([116, NOBODY, NOBODY]);
  });

  it('feed the computed facts: available, another fight, alive', () => {
    const { sim } = setup();
    const b = sim.state.boxing;
    expect(anotherFightPossible(b, sim.state)).toBe(false);
    expect(boxerAvailable(b, sim.state)).toBe(true);
    expect(anotherFightPossible(b, sim.state)).toBe(false);
    b.fought[0] = true;
    expect(anotherFightPossible(b, sim.state)).toBe(true);
    b.fought.fill(true);
    expect(boxerAvailable(b, sim.state)).toBe(false);
    expect(anotherFightPossible(b, sim.state)).toBe(false);
    expect(boxerExists(sim.state)).toBe(true);
    expect(boxerExists(null)).toBe(false);
  });
});

describe('the boxing state', () => {
  it('pauses the game when a match starts and marks the first boxer fought when none fought on the way out', () => {
    const { sim, port } = setup();
    const b = sim.state.boxing;
    checkOnBoxers(b, sim.state);
    startBoxingMatch(sim.state);
    setBoxingState(sim.state, BoxingState.NOT_BOXING);
    expect(port.calls).toEqual(['pause', 'unpause']);
    expect(b.fought).toEqual([true, false, false]);
  });

  it('walks through pre-boxing into the fight and picks a boxer with the rest bonus', () => {
    const { sim, merc, boxers } = setup();
    const t = sim.state;
    t.boxing.rests = 2;
    t.boxing.fought[0] = true;
    checkOnBoxers(t.boxing, t);
    startBoxingMatch(t);
    const [first, second] = boxers as [Soldier, Soldier];
    const strength = second.stats.strength;
    step(sim, merc, IN_RING);
    expect(t.boxing.state).toBe(BoxingState.PRE_BOXING);
    expect([first.boxer, second.boxer, second.neutral]).toEqual([false, true, false]);
    expect(second.stats.strength).toBe(Math.min(100, strength + 10));
    expect(t.boxing.fought).toEqual([true, true, false]);
    const rng = new ScriptedStream([1]);
    Object.assign(t, { rng });
    step(sim, second, IN_RING_2);
    expect(t.boxing.state).toBe(BoxingState.BOXING);
    expect(merc.boxer).toBe(true);
    expect(rng.requested).toEqual([2]);
    expect(t.inCombat).toBe(true);
  });

  it('gives the third boxer martial arts', () => {
    const { sim, merc, boxers } = setup();
    const t = sim.state;
    t.boxing.fought[0] = true;
    t.boxing.fought[1] = true;
    checkOnBoxers(t.boxing, t);
    startBoxingMatch(t);
    step(sim, merc, IN_RING);
    expect((boxers[2] as Soldier).skillTrait1).toBe(SkillTrait.MARTIALARTS);
  });
});

function fight(): Hall {
  const hall = setup();
  const t = hall.sim.state;
  checkOnBoxers(t.boxing, t);
  startBoxingMatch(t);
  step(hall.sim, hall.merc, IN_RING);
  Object.assign(t, { rng: new ScriptedStream([0], 0) });
  step(hall.sim, hall.boxers[0] as Soldier, IN_RING_2);
  hall.port.calls.length = 0;
  return hall;
}

describe('disqualification', () => {
  it('stops a second merc in the ring before the fight and ends the match', () => {
    const { sim, merc, port } = setup();
    const t = sim.state;
    checkOnBoxers(t.boxing, t);
    startBoxingMatch(t);
    step(sim, merc, IN_RING);
    const second = unarmed(spawnSoldier(sim, 1, Team.OUR, OUTSIDE_RING, NORTH));
    step(sim, second, grid(37, 69));
    expect(t.boxing.state).toBe(BoxingState.NOT_BOXING);
    expect(port.calls).toContain(`record ${Npc.DARREN} 21`);
  });

  it('logs a boxer who steps out during the fight', () => {
    const { sim, merc, port } = fight();
    step(sim, merc, OUTSIDE_RING);
    expect(sim.state.boxing.state).toBe(BoxingState.DISQUALIFIED);
    expect(merc.boxer).toBe(false);
    expect(port.calls).toEqual([`record ${Npc.DARREN} 21`, `history ${NarrativeHistory.DISQUALIFIED_BOXING} 5`]);
  });

  it('takes a knife as a disqualification, allows brass knuckles and turns a shot into open war', () => {
    const knife = content.items.byName.get(ITEM_KNIFE)?.index ?? 0;
    const knuckles = content.items.byName.get('BRASS_KNUCKLES')?.index ?? 0;
    const glock = content.items.byName.get('GLOCK_17')?.index ?? 0;
    const cases: [number, number][] = [
      [knuckles, BoxingState.BOXING],
      [knife, BoxingState.DISQUALIFIED],
      [glock, BoxingState.NOT_BOXING],
    ];
    for (const [weapon, expected] of cases) {
      const { sim, merc, boxers } = fight();
      merc.attackingWeapon = weapon;
      processImplicationsOfPCAttack(sim.state, merc, boxers[0] as Soldier);
      expect(sim.state.boxing.state).toBe(expected);
      if (expected === BoxingState.NOT_BOXING) expect((boxers[0] as Soldier).neutral).toBe(true);
    }
  });
});

describe('a round', () => {
  it('halves action points and the carried points while the boxers are in the ring', () => {
    const { sim, merc } = fight();
    const t = sim.state;
    expect(boxingHalvesPoints(t)).toBe(true);
    const full = calcActionPoints(content, merc);
    expect(calcActionPoints(content, merc, true)).toBe(Math.trunc(full / 2));
    merc.actionPoints = 4;
    calcNewActionPoints(content, merc, true);
    expect(merc.actionPoints).toBe(2 + Math.trunc(full / 2));
  });

  it('ends when a boxer stays down for more than one turn', () => {
    const { sim, boxers, port } = fight();
    const t = sim.state;
    const boxer = boxers[0] as Soldier;
    boxer.collapsed = true;
    boxer.breath = 0;
    beginSoldierGetup(t, boxer);
    expect(t.boxing.state).toBe(BoxingState.BOXING);
    beginSoldierGetup(t, boxer);
    expect(t.boxing.state).toBe(BoxingState.WON_ROUND);
    expect([t.boxing.matchesWon, t.boxing.lastMatchWonByPlayer]).toEqual([1, true]);
    expect(port.calls).toEqual([`record ${Npc.DARREN} 22`]);
  });

  it('exits: the AI boxer turns neutral, ours goes under AI control, revived, and combat ends', () => {
    const { sim, merc, boxers, port } = fight();
    const t = sim.state;
    const boxer = boxers[0] as Soldier;
    merc.life = 10;
    merc.breath = 0;
    merc.collapsed = true;
    setBoxingState(t, BoxingState.LOST_ROUND);
    exitBoxing(t);
    expect([boxer.neutral, merc.underAiControl, merc.life >= OKLIFE * 2, merc.breath > 0]).toEqual([true, true, true, true]);
    expect(merc.ai.alertStatus).toBe(AlertStatus.GREEN);
    expect(t.inCombat).toBe(false);
    expect(t.boxing.uiLocked).toBe(true);
    expect(port.calls).toContain('deleteTalkingMenu');
  });

  it('unlocks the interface once the AI boxer is out when ours died in the ring, without closing the round', () => {
    const { sim, merc, boxers } = fight();
    const t = sim.state;
    const boxer = boxers[0] as Soldier;
    merc.life = 0;
    setBoxingState(t, BoxingState.LOST_ROUND);
    exitBoxing(t);
    expect(t.boxing.uiLocked).toBe(true);
    setSoldierPosition(t, boxer, OUTSIDE_RING);
    expect(decideActionGreenWhileBoxing(t, boxer)).toBe(AiAction.ABSOLUTELY_NONE);
    expect([boxer.boxer, t.boxing.uiLocked, t.boxing.state]).toEqual([false, false, BoxingState.LOST_ROUND]);
  });

  it('closes with the history line and Darren record once our boxer is out', () => {
    const { sim, merc, port } = fight();
    const t = sim.state;
    setBoxingState(t, BoxingState.WON_ROUND);
    t.boxing.uiLocked = true;
    port.calls.length = 0;
    triggerEndOfBoxingRecord(t, merc);
    expect(port.calls).toEqual([`history ${NarrativeHistory.WON_BOXING} 5`, `record ${Npc.DARREN} 23`, 'unpause']);
    expect([t.boxing.state, t.boxing.uiLocked]).toEqual([BoxingState.NOT_BOXING, false]);
  });
});

describe('the boxers AI', () => {
  it('walks into the ring before the fight and faces the nearest merc inside', () => {
    const { sim, merc, boxers } = setup();
    const t = sim.state;
    const boxer = boxers[0] as Soldier;
    setBoxingState(t, BoxingState.PRE_BOXING);
    expect(decideActionBoxerEnteringRing(t, boxer)).toBe(AiAction.GET_CLOSER);
    expect(t.world.level.rooms[boxer.ai.actionData]).toBe(BOXING_RING);
    setSoldierPosition(t, boxer, IN_RING_2);
    setSoldierPosition(t, merc, IN_RING);
    expect(decideActionBoxerEnteringRing(t, boxer)).toBe(AiAction.CHANGE_FACING);
  });

  it('leaves the ring towards its own tile, and ends the match when ours is out', () => {
    const { sim, merc, boxers, port } = fight();
    const t = sim.state;
    const boxer = boxers[0] as Soldier;
    setBoxingState(t, BoxingState.WON_ROUND);
    expect(decideActionGreenWhileBoxing(t, boxer)).toBe(AiAction.GET_CLOSER);
    expect(boxer.ai.actionData).toBe(BOXER_GRIDNOS[0]);
    const spot = findClosestBoxingRingSpot(t, merc, false);
    expect(spot % WORLD_COLS).toBeGreaterThanOrEqual(merc.gridNo % WORLD_COLS);
    setSoldierPosition(t, merc, grid(41, 70));
    merc.underAiControl = true;
    port.calls.length = 0;
    expect(decideActionGreenWhileBoxing(t, merc)).toBe(AiAction.ABSOLUTELY_NONE);
    expect([merc.boxer, merc.underAiControl, t.boxing.state]).toEqual([false, false, BoxingState.NOT_BOXING]);
    expect(port.calls[0]).toBe(`history ${NarrativeHistory.WON_BOXING} 5`);
  });

  it('makes bystanders near the ring face it', () => {
    const { sim } = setup();
    const t = sim.state;
    const bystander = spawnSoldier(sim, 120, Team.CIV, grid(37, 64), NORTH);
    bystander.bodyType = Body.REGMALE;
    setBoxingState(t, BoxingState.WAITING_FOR_PLAYER);
    expect(decideActionGreenWhileBoxing(t, bystander)).toBe(AiAction.CHANGE_FACING);
    expect(CENTER_OF_RING).toBe(grid(37, 70));
  });
});

describe('around a match', () => {
  it('locks the interface while the boxers leave the ring', () => {
    const { sim, merc } = setup();
    sim.state.boxing.uiLocked = true;
    expect(sim.isIdle()).toBe(false);
    expect(sim.dispatch({ type: 'move', soldier: merc.id, to: IN_RING })).toMatchObject({ ok: false, data: { refusal: 'boxingUiLock' } });
    expect(estimateAttack(sim, { soldier: merc.id, target: IN_RING }).reason).not.toMatch(/locked/);
  });

  it('keeps a hostile boxer from spreading hostility to his group while the boxers are in the ring', () => {
    for (const fighting of [true, false]) {
      const { sim, boxers } = setup();
      const t = sim.state;
      const [boxer, friend] = boxers as [Soldier, Soldier];
      for (const s of [boxer, friend]) s.civilianGroup = CivilianGroup.KINGPIN;
      boxer.neutral = false;
      boxer.boxer = true;
      t.inCombat = true;
      if (fighting) t.boxing.state = BoxingState.BOXING;
      endAIGuysTurn(t, boxer, sim.ai);
      expect(friend.neutral).toBe(fighting);
    }
  });
});

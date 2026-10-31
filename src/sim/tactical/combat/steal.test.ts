import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../../tests/support/autoresolve.ts';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { NOTHING } from '../../../content/items/items.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { SimEvent } from '../../events.ts';
import { emptyObject } from '../../items/object.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { animName } from '../anim-states.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { setSoldierPosition } from '../movement.ts';
import { Opp } from '../perception/opp.ts';
import { profileProgress, StatKind } from '../profiles.ts';
import { Body, type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { calcChanceToSteal } from './melee.ts';
import { apsToStealItem, stealActionGridNo, useHandToHandSteal } from './steal.ts';
import { AiMorale } from './types.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const GUN = 'GLOCK_17';
const MERC_PROFILE = 4;
const ENEMY_AT = gridNo(80, 81);
const OUR_TILE = gridNo(80, 80);

type EventOf<K extends SimEvent['type']> = Extract<SimEvent, { type: K }>;

function thiefAndVictim(options: { profile?: number; enemyAt?: number; body?: number } = {}): {
  sim: TacticalSim;
  thief: Soldier;
  victim: Soldier;
} {
  const sim = newCombatSim(content);
  const thief = spawnSoldier(sim, 0, Team.OUR, OUR_TILE, Direction.SOUTH, options.profile ? { profile: options.profile } : {});
  thief.inv[InvSlot.HAND] = emptyObject();
  const victim = spawnSoldier(sim, 20, Team.ENEMY, options.enemyAt ?? ENEMY_AT, Direction.NORTH, {
    gun: GUN,
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
  victim.ai.morale = AiMorale.NORMAL;
  if (options.profile) sim.state.profiles.set(options.profile, progressFor(options.profile));
  sim.lookAround();
  sim.drainEvents();
  return { sim, thief, victim };
}

function steal(sim: TacticalSim, thief: Soldier, victim: Soldier, rolls: readonly number[]): ScriptedStream {
  const t = sim.state;
  const pre = new ScriptedStream(rolls, 0);
  Object.assign(t, { pre });
  thief.attackingWeapon = NOTHING;
  thief.targetLevel = victim.level;
  t.turn.attackBusyCount = 2;
  useHandToHandSteal(t, thief, victim.gridNo);
  return pre;
}

function attempts(t: TacticalSim['state']): EventOf<'stealAttempt'>[] {
  return t.events.filter((e): e is EventOf<'stealAttempt'> => e.type === 'stealAttempt');
}

const gunIndex = () => content.items.byName.get(GUN)?.index ?? -1;
const gunsOnTile = (t: TacticalSim['state'], g: number) => t.worldItems.filter((wi) => wi.gridNo === g && wi.object.item === gunIndex());
const carries = (s: Soldier, item: number) => s.inv.some((o) => o.item === item);

describe('the chance to steal (CalcChanceHTH, HTH_MODE_STEAL)', () => {
  it('weighs strength three times on both sides and scales the ratio to 50', () => {
    const { sim, thief, victim } = thiefAndVictim();
    thief.attackingWeapon = NOTHING;
    expect(calcChanceToSteal(sim.state, thief, victim, 0)).toBe(50);
    Object.assign(thief.stats, { strength: 100, dexterity: 1, agility: 1 });
    Object.assign(victim.stats, { strength: 1, dexterity: 100, agility: 100 });
    expect(calcChanceToSteal(sim.state, thief, victim, 0)).toBe(72);
  });
});

describe('stealing (UseHandToHand with fStealing)', () => {
  it('grabs the item in hand on a roll in the lower two thirds of the chance, drawing one PreRandom(100)', () => {
    const { sim, thief, victim } = thiefAndVictim();
    const t = sim.state;
    const pre = steal(sim, thief, victim, [33]);
    expect(pre.requested).toEqual([100]);
    expect(carries(thief, gunIndex())).toBe(true);
    expect(victim.inv[InvSlot.HAND]?.item).toBe(NOTHING);
    expect(attempts(t)).toMatchObject([{ soldier: thief.id, target: victim.id, item: gunIndex(), result: 'grabbed' }]);
    expect(t.turn.attackBusyCount).toBe(1);
  });

  it('knocks the item to the ground above two thirds, near the thief or the victim as a second PreRandom(100) falls', () => {
    for (const [second, tile] of [
      [49, OUR_TILE],
      [50, ENEMY_AT],
    ] as const) {
      const { sim, thief, victim } = thiefAndVictim();
      const t = sim.state;
      const pre = steal(sim, thief, victim, [34, second]);
      expect(pre.requested).toEqual([100, 100]);
      expect(gunsOnTile(t, tile)).toHaveLength(1);
      expect(carries(thief, gunIndex())).toBe(false);
      expect(victim.inv[InvSlot.HAND]?.item).toBe(NOTHING);
      expect(attempts(t)).toMatchObject([{ result: 'dropped' }]);
    }
  });

  it('fails above the chance, and draws nothing more when the victim has nothing in hand', () => {
    const { sim, thief, victim } = thiefAndVictim();
    steal(sim, thief, victim, [51]);
    expect(victim.inv[InvSlot.HAND]?.item).toBe(gunIndex());
    expect(attempts(sim.state)).toMatchObject([{ result: 'failed' }]);
    const empty = thiefAndVictim();
    empty.victim.inv[InvSlot.HAND] = emptyObject();
    expect(steal(empty.sim, empty.thief, empty.victim, [0]).requested).toEqual([100]);
    expect(attempts(empty.sim.state)).toEqual([]);
  });

  it('adds 20 to the chance of a victim who does not know the thief is there, past the usual 99', () => {
    const { sim, thief, victim } = thiefAndVictim();
    Object.assign(thief.stats, { strength: 100 });
    Object.assign(victim.stats, { strength: 1 });
    victim.oppList[thief.id] = Opp.NOT_HEARD_OR_SEEN;
    thief.attackingWeapon = NOTHING;
    expect(calcChanceToSteal(sim.state, thief, victim, 0)).toBe(99);
    steal(sim, thief, victim, [99, 99]);
    expect(attempts(sim.state)).toMatchObject([{ result: 'dropped' }]);
  });

  const strengthChances = (sim: TacticalSim) => profileProgress(sim.state, MERC_PROFILE)?.statChangeChances[StatKind.STRENGTH] ?? 0;

  it('trains strength with 8 chances for a steal and 4 for a failed one, each a PreRandom(100) after the roll', () => {
    for (const [roll, chances] of [
      [0, 8],
      [99, 4],
    ] as const) {
      const { sim, thief, victim } = thiefAndVictim({ profile: MERC_PROFILE });
      const pre = steal(sim, thief, victim, [roll]);
      expect(strengthChances(sim)).toBe(chances);
      expect(pre.requested).toEqual(Array.from({ length: 1 + chances }, () => 100));
    }
  });

  it('robs a creature, which no chance protects, on a roll of 0: the roll may equal the chance', () => {
    const { sim, thief, victim } = thiefAndVictim({ profile: MERC_PROFILE, body: Body.BLOODCAT });
    steal(sim, thief, victim, [1]);
    expect(attempts(sim.state)).toMatchObject([{ result: 'failed' }]);
    expect(strengthChances(sim)).toBe(0);
    const lucky = thiefAndVictim({ profile: MERC_PROFILE, body: Body.BLOODCAT });
    steal(lucky.sim, lucky.thief, lucky.victim, [0]);
    expect(attempts(lucky.sim.state)).toMatchObject([{ result: 'grabbed' }]);
  });
});

describe('the steal order (HandleHandCursorClick, MercStealFromMerc)', () => {
  it('walks up, plays STEAL_ITEM, charges the estimated APs and frees the attack', () => {
    const { sim, thief, victim } = thiefAndVictim({ enemyAt: gridNo(80, 83) });
    const t = sim.state;
    const cost = apsToStealItem(t, thief, stealActionGridNo(t, thief, victim));
    const before = thief.actionPoints;
    expect(sim.dispatch({ type: 'steal', soldier: thief.id, target: victim.id })).toEqual({ ok: true });
    const played = new Set<string>();
    for (let i = 0; i < 4000 && !sim.isIdle(); i++) {
      sim.step();
      played.add(animName(t.content, thief.state));
    }
    expect(played.has('STEAL_ITEM')).toBe(true);
    expect(sim.drainEvents().filter((e) => e.type === 'stealAttempt')).toHaveLength(1);
    expect(thief.gridNo).toBe(gridNo(80, 82));
    expect(before - thief.actionPoints).toBe(cost);
    expect(t.turn.attackBusyCount).toBe(0);
    expect(thief.pendingMelee).toBeNull();
    expect(runUntilIdle(sim)).toBeDefined();
  });

  it('refuses a neutral, a friend, an unconscious soldier and one the squad does not see', () => {
    const neutral = thiefAndVictim();
    neutral.victim.neutral = true;
    expect(neutral.sim.dispatch({ type: 'steal', soldier: 0, target: 20 })).toMatchObject({ data: { refusal: 'notStealable' } });
    const knockedOut = thiefAndVictim();
    knockedOut.victim.life = 5;
    expect(knockedOut.sim.dispatch({ type: 'steal', soldier: 0, target: 20 })).toMatchObject({ data: { refusal: 'notStealable' } });
    const unseen = thiefAndVictim();
    unseen.victim.visible = -1;
    expect(unseen.sim.dispatch({ type: 'steal', soldier: 0, target: 20 })).toMatchObject({ data: { refusal: 'noSuchTarget' } });
  });

  it('ends the attack twice, at codes 442 and 753 of STEAL_ITEM, and so still frees it when the victim has left', () => {
    const resolved = (events: readonly SimEvent[]) => events.filter((e) => e.type === 'attackResolved').length;
    const { sim, thief, victim } = thiefAndVictim();
    expect(sim.dispatch({ type: 'steal', soldier: thief.id, target: victim.id })).toEqual({ ok: true });
    expect(resolved(runUntilIdle(sim))).toBe(2);
    expect(sim.state.turn.attackBusyCount).toBe(0);
    const left = thiefAndVictim();
    expect(left.sim.dispatch({ type: 'steal', soldier: left.thief.id, target: left.victim.id })).toEqual({ ok: true });
    setSoldierPosition(left.sim.state, left.victim, gridNo(90, 90));
    const events = runUntilIdle(left.sim);
    expect(events.some((e) => e.type === 'stealAttempt')).toBe(false);
    expect(resolved(events)).toBe(1);
    expect(left.sim.state.turn.attackBusyCount).toBe(0);
  });

  it('refuses a steal the soldier cannot afford', () => {
    const { sim, thief, victim } = thiefAndVictim();
    thief.actionPoints = apsToStealItem(sim.state, thief, stealActionGridNo(sim.state, thief, victim)) - 1;
    expect(sim.dispatch({ type: 'steal', soldier: 0, target: 20 })).toMatchObject({ data: { refusal: 'notEnoughAP' } });
  });
});

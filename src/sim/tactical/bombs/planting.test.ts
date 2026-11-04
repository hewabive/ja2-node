import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { itemId, objectOf } from '../../../../tests/support/explosives.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../../content/world/grid.ts';
import { idiv } from '../../../core/int.ts';
import { tacticalPromptView } from '../../../server/tactical-prompt-view.ts';
import type { SimEvent } from '../../events.ts';
import { type ItemObject, USABLE_STATUS } from '../../items/object.ts';
import { animName } from '../anim-states.ts';
import { changeSoldierStance } from '../animation.ts';
import { continuePastBoobyTrap } from '../booby-traps.ts';
import { handleItem, ItemHandle } from '../combat/attack.ts';
import { SkillCheckReason, skillCheck } from '../combat/skill-check.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { AP } from '../points.ts';
import type { ProfileProgress, StatKey } from '../profiles.ts';
import { type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { addItemToPool, Visibility, type WorldItem, WorldItemFlags } from '../world-items.ts';
import { bombOwnerIdOf, Detonator, delayOf, detonatorOf, frequencyOf, setBombItem, setDetonator, setFrequency } from './bomb-object.ts';
import { hasMineFlag, MineFlag } from './mine-flags.ts';
import { worldBombItems } from './world-bombs.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const MERC_AT = gridNo(80, 80);
const ENEMY_AT = gridNo(80, 95);
const BOMB_AT = MERC_AT + 3 * EAST;
const MERC_PROFILE = 3;
const CROUCHED = 3;
const EXPLOSIVES = 80;
const EXPERIENCE = 4;
const PLANTED_TRAP = idiv(EXPLOSIVES, 20) + idiv(EXPERIENCE, 3);
const PLANTED_GAIN = 25;
const FUMBLED_GAIN = 10;
const NO_GAIN = 99;
const FREQUENCY = 2;
const OTHER_FREQUENCY = 3;

const ZERO_GAINS: Record<StatKey, number> = {
  lifeMax: 0,
  agility: 0,
  dexterity: 0,
  wisdom: 0,
  medical: 0,
  explosives: 0,
  mechanical: 0,
  marksmanship: 0,
  experience: 0,
  strength: 0,
  leadership: 0,
};

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly merc: Soldier;
  readonly profile: ProfileProgress;
}

interface SceneOptions {
  readonly combat?: boolean;
  readonly crouched?: boolean;
}

function scene(hand: (t: TacticalState) => ItemObject, options: SceneOptions = {}): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  const profile = testProfile(MERC_PROFILE, { gains: { ...ZERO_GAINS } });
  t.profiles.set(MERC_PROFILE, profile);
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH, { profile: MERC_PROFILE });
  merc.stats.explosives = EXPLOSIVES;
  merc.stats.experience = EXPERIENCE;
  merc.inv[InvSlot.HAND] = hand(t);
  if (options.crouched) {
    changeSoldierStance(t, merc, CROUCHED);
    runUntilIdle(sim);
  }
  if (options.combat) {
    spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, ENEMY_AT, Direction.NORTH);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
  }
  return { sim, t, merc, profile };
}

const mine = (t: TacticalState) => objectOf(t, 'MINE');

function withDetonator(name: string, detonator: string): (t: TacticalState) => ItemObject {
  return (t) => {
    const o = objectOf(t, name);
    o.attachments[0] = { item: itemId(t, detonator), status: 100 };
    return o;
  };
}

function scriptedPre(t: TacticalState, rolls: readonly number[], rest = NO_GAIN): number[] {
  const asked: number[] = [];
  const queued = [...rolls];
  const pre = t.pre as unknown as { int(n: number): number };
  pre.int = (n: number) => {
    asked.push(n);
    return queued.shift() ?? rest;
  };
  return asked;
}

function scriptedRandom(t: TacticalState, rolls: readonly number[]): number[] {
  const asked: number[] = [];
  const queued = [...rolls];
  const rng = t.rng as unknown as { int(n: number): number };
  rng.int = (n: number) => {
    asked.push(n);
    const roll = queued.shift();
    if (roll === undefined) throw new Error(`unscripted Random(${n})`);
    return roll;
  };
  return asked;
}

function plant(sim: TacticalSim, at = MERC_AT): SimEvent[] {
  expect(sim.dispatch({ type: 'plantBomb', soldier: 0, gridNo: at })).toEqual({ ok: true });
  return sim.drainEvents();
}

function answer(sim: TacticalSim, choice: string): SimEvent[] {
  const prompt = sim.state.prompt;
  if (!prompt) throw new Error('no prompt is open');
  expect(sim.dispatch({ type: 'answer', prompt: prompt.id, choice })).toEqual({ ok: true });
  return sim.drainEvents();
}

function runUntilPrompt(sim: TacticalSim, ticks = 2_000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks && !sim.state.prompt; k++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  expect(sim.state.prompt).not.toBeNull();
  return events;
}

function bombAt(t: TacticalState, g: number): WorldItem {
  const wi = worldBombItems(t).find((b) => b.gridNo === g);
  if (!wi) throw new Error(`no bomb at ${g}`);
  return wi;
}

function planningChance(t: TacticalState, merc: Soldier, reason: number): number {
  scriptedPre(t, [0]);
  return skillCheck(t, merc, reason, 0);
}

describe('planting a mine (Handle_Items.cc HandleItem, HandleSoldierDropBomb)', () => {
  it('plays PLANT_BOMB standing, pays AP_DROP_BOMB at its start and buries the armed mine at code 483', () => {
    const { sim, t, merc } = scene(mine, { combat: true });
    const before = merc.actionPoints;
    const events = plant(sim);
    expect(animName(t.content, merc.state)).toBe('PLANT_BOMB');
    expect(before - merc.actionPoints).toBe(AP.DROP_BOMB);
    expect(worldBombItems(t)).toEqual([]);
    const asked = scriptedPre(t, []);
    events.push(...runUntilIdle(sim));
    const wi = bombAt(t, MERC_AT);
    expect(wi).toMatchObject({ visible: Visibility.BURIED, flags: WorldItemFlags.ARMED_BOMB, level: 0 });
    expect(wi.object).toMatchObject({ item: itemId(t, 'MINE'), trap: PLANTED_TRAP });
    expect([detonatorOf(wi.object), bombOwnerIdOf(wi.object)]).toEqual([Detonator.PRESSURE, merc.id]);
    expect(hasMineFlag(t, MERC_AT, MineFlag.PLAYER)).toBe(true);
    expect(merc.inv[InvSlot.HAND]?.item).toBe(0);
    expect(asked).toHaveLength(PLANTED_GAIN);
    expect(events.find((e) => e.type === 'bombPlanted')).toEqual(
      expect.objectContaining({ soldier: merc.id, gridNo: MERC_AT, item: 'MINE' }),
    );
  });

  it('plants at once and for no AP when crouched or prone (EVENT_SoldierBeginDropBomb skips the animation)', () => {
    const { sim, t, merc } = scene(mine, { combat: true, crouched: true });
    const before = merc.actionPoints;
    plant(sim);
    expect(merc.actionPoints).toBe(before);
    expect(bombAt(t, MERC_AT).object.item).toBe(itemId(t, 'MINE'));
  });

  it('walks onto another tile first and plants there on arrival (MERC_DROPBOMB)', () => {
    const { sim, t, merc } = scene(mine);
    plant(sim, BOMB_AT);
    expect(merc.pendingDropBomb).toBe(true);
    expect(worldBombItems(t)).toEqual([]);
    runUntilIdle(sim);
    expect(merc.gridNo).toBe(BOMB_AT);
    expect(merc.pendingDropBomb).toBe(false);
    expect(bombAt(t, BOMB_AT).object.item).toBe(itemId(t, 'MINE'));
  });

  it('refuses a tile nobody could stand on in real time (UIMouseOnValidAttackLocation)', () => {
    const { sim } = scene(mine);
    spawnSoldier(sim, 1, Team.OUR, BOMB_AT, Direction.NORTH);
    expect(sim.dispatch({ type: 'plantBomb', soldier: 0, gridNo: BOMB_AT })).toMatchObject({ ok: false, data: { refusal: 'badTile' } });
  });

  it('refuses in combat a hand item with no bomb cursor, then a tile out of reach before its stand test, then a walk he cannot pay', () => {
    const { sim, t, merc } = scene((t) => objectOf(t, 'GLOCK_17'), { combat: true });
    expect(sim.dispatch({ type: 'plantBomb', soldier: 0, gridNo: MERC_AT })).toMatchObject({ ok: false, data: { refusal: 'notABomb' } });
    merc.inv[InvSlot.HAND] = mine(t);
    expect(sim.dispatch({ type: 'plantBomb', soldier: 0, gridNo: ENEMY_AT })).toMatchObject({ ok: false, data: { refusal: 'noPath' } });
    merc.actionPoints = AP.DROP_BOMB;
    expect(sim.dispatch({ type: 'plantBomb', soldier: 0, gridNo: BOMB_AT })).toMatchObject({ ok: false, data: { refusal: 'notEnoughAP' } });
    expect(sim.dispatch({ type: 'plantBomb', soldier: 0, gridNo: MERC_AT })).toEqual({ ok: true });
  });
});

describe('planting a bomb with a detonator (StartBombMessageBox, BombMessageBoxCallBack)', () => {
  it('asks for the timer at code 483 and arms it visible with the chosen delay after a passed check and 25 explosives chances', () => {
    const { sim, t, merc } = scene(withDetonator('TNT', 'DETONATOR'), { combat: true });
    plant(sim);
    runUntilPrompt(sim);
    expect(tacticalPromptView(t)).toEqual({
      id: t.prompt?.id,
      kind: 'bombSetting',
      soldier: merc.id,
      gridNo: MERC_AT,
      item: 'TNT',
      detonator: 'timed',
      choices: ['1', '2', '3', '4'],
    });
    expect(hasMineFlag(t, MERC_AT, MineFlag.PLAYER)).toBe(false);
    const asked = scriptedPre(t, [0]);
    const events = answer(sim, '3');
    expect(asked).toHaveLength(1 + PLANTED_GAIN);
    const wi = bombAt(t, MERC_AT);
    expect(wi).toMatchObject({ visible: Visibility.VISIBLE, flags: WorldItemFlags.ARMED_BOMB });
    expect([detonatorOf(wi.object), delayOf(wi.object), wi.object.trap, bombOwnerIdOf(wi.object)]).toEqual([
      Detonator.TIMED,
      3,
      PLANTED_TRAP,
      merc.id,
    ]);
    expect(merc.inv[InvSlot.HAND]?.item).toBe(0);
    expect(events.find((e) => e.type === 'bombPlanted')).toEqual(expect.objectContaining({ item: 'TNT' }));
    expect(hasMineFlag(t, MERC_AT, MineFlag.PLAYER)).toBe(false);
  });

  it('adds a turn to a timer set in real time (ArmBomb)', () => {
    const { sim, t } = scene(withDetonator('TNT', 'DETONATOR'));
    plant(sim);
    runUntilPrompt(sim);
    scriptedPre(t, [0]);
    answer(sim, '1');
    expect(delayOf(bombAt(t, MERC_AT).object)).toBe(2);
  });

  it('asks for a frequency with a remote detonator and checks PLANTING_REMOTE_BOMB', () => {
    const { sim, t, merc } = scene(withDetonator('TNT', 'REMDETONATOR'), { crouched: true });
    const chance = planningChance(t, merc, SkillCheckReason.PLANTING_REMOTE_BOMB);
    plant(sim);
    expect(tacticalPromptView(t)).toMatchObject({ kind: 'bombSetting', detonator: 'remote' });
    scriptedPre(t, [chance]);
    answer(sim, String(FREQUENCY));
    const wi = bombAt(t, MERC_AT);
    expect([detonatorOf(wi.object), frequencyOf(wi.object)]).toEqual([Detonator.REMOTE, FREQUENCY]);
  });

  it('messes up the setting by Random(3) - 1 on a check missed by 20 or less: a timer of 1 may come out as 0, a frequency of 4 as 5', () => {
    const timed = scene(withDetonator('TNT', 'DETONATOR'), { combat: true, crouched: true });
    const timerChance = planningChance(timed.t, timed.merc, SkillCheckReason.PLANTING_BOMB);
    plant(timed.sim);
    const asked = scriptedPre(timed.t, [timerChance + 1]);
    expect(scriptedRandom(timed.t, [0])).toEqual([]);
    answer(timed.sim, '1');
    expect(asked).toHaveLength(1 + FUMBLED_GAIN);
    expect(delayOf(bombAt(timed.t, MERC_AT).object)).toBe(0);
    const remote = scene(withDetonator('TNT', 'REMDETONATOR'), { crouched: true });
    const remoteChance = planningChance(remote.t, remote.merc, SkillCheckReason.PLANTING_REMOTE_BOMB);
    plant(remote.sim);
    scriptedPre(remote.t, [remoteChance + 20]);
    const drawn = scriptedRandom(remote.t, [2]);
    answer(remote.sim, '4');
    expect(drawn).toEqual([3]);
    expect(frequencyOf(bombAt(remote.t, MERC_AT).object)).toBe(5);
  });

  it('blows up at his feet on a check missed by more than 20, and the bomb stays in his hand unarmed', () => {
    const { sim, t, merc } = scene(withDetonator('TNT', 'DETONATOR'), { crouched: true });
    const chance = planningChance(t, merc, SkillCheckReason.PLANTING_BOMB);
    plant(sim);
    scriptedPre(t, [chance + 21]);
    const events = answer(sim, '2');
    expect(events.find((e) => e.type === 'bombFumbled')).toEqual(expect.objectContaining({ soldier: merc.id, gridNo: MERC_AT }));
    expect(events.find((e) => e.type === 'explosion')).toMatchObject({ item: itemId(t, 'TNT'), gridNo: MERC_AT, owner: null });
    expect(merc.inv[InvSlot.HAND]?.item).toBe(itemId(t, 'TNT'));
    expect(detonatorOf(merc.inv[InvSlot.HAND] as ItemObject)).toBe(0);
    expect(worldBombItems(t)).toEqual([]);
  });

  it('leaves a booby trap of his own trap level for our mercs who pick the planted bomb up', () => {
    const { sim, t, merc } = scene(withDetonator('TNT', 'DETONATOR'), { crouched: true });
    plant(sim);
    scriptedPre(t, [0]);
    answer(sim, '4');
    const wi = bombAt(t, MERC_AT);
    expect(wi.object.trap).toBe(PLANTED_TRAP);
    expect(continuePastBoobyTrap(t, merc, wi, MERC_AT)).not.toBe('continue');
  });

  it('asks for the setting at once and puts the bomb on the clicked tile without a walk while his attacking hand is the second hand', () => {
    const { sim, t, merc } = scene(withDetonator('TNT', 'DETONATOR'));
    merc.attackingHand = InvSlot.SECOND_HAND;
    plant(sim, BOMB_AT);
    expect(t.prompt).toMatchObject({ kind: 'bombSetting', gridNo: BOMB_AT });
    expect(merc.pendingDropBomb).toBe(false);
    scriptedPre(t, [0]);
    answer(sim, '2');
    expect(merc.gridNo).toBe(MERC_AT);
    expect(bombAt(t, BOMB_AT).object.item).toBe(itemId(t, 'TNT'));
  });
});

describe('the remote bomb trigger (HandleItem REMOTECURS, HandleSoldierUseRemote)', () => {
  function remoteBomb(t: TacticalState, g: number, frequency: number): WorldItem {
    const o = objectOf(t, 'TNT');
    setDetonator(o, Detonator.REMOTE);
    setFrequency(o, frequency);
    setBombItem(o, o.item);
    const wi = addItemToPool(t, g, o, Visibility.VISIBLE, 0, WorldItemFlags.ARMED_BOMB);
    if (!wi) throw new Error('cannot place the bomb');
    return wi;
  }

  const trigger = (t: TacticalState) => objectOf(t, 'REMOTEBOMBTRIGGER');

  it('pays 2 AP, plays USE_REMOTE standing for 2 more and asks for the frequency at code 484; the answer sets off that frequency', () => {
    const { sim, t, merc } = scene(trigger, { combat: true });
    const far = gridNo(110, 110);
    const wanted = remoteBomb(t, far, FREQUENCY);
    const other = remoteBomb(t, far + EAST, OTHER_FREQUENCY);
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'useRemote', soldier: 0 })).toEqual({ ok: true });
    expect(animName(t.content, merc.state)).toBe('USE_REMOTE');
    expect(before - merc.actionPoints).toBe(2 * AP.USE_REMOTE);
    expect(t.prompt).toBeNull();
    runUntilPrompt(sim);
    expect(tacticalPromptView(t)).toEqual({ id: t.prompt?.id, kind: 'remoteFrequency', soldier: merc.id, choices: ['1', '2', '3', '4'] });
    const events = answer(sim, String(FREQUENCY));
    expect(events.find((e) => e.type === 'remoteUsed')).toEqual(
      expect.objectContaining({ soldier: merc.id, result: 'bombs', frequency: FREQUENCY }),
    );
    expect(t.explosionQueue.entries.map((e) => t.worldBombs[e.bomb]?.item)).toEqual([wanted]);
    expect(t.worldItems).toContain(other);
  });

  it('asks at once crouched, for the 2 AP of HandleItem alone', () => {
    const { sim, t, merc } = scene(trigger, { combat: true, crouched: true });
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'useRemote', soldier: 0 })).toEqual({ ok: true });
    expect(before - merc.actionPoints).toBe(AP.USE_REMOTE);
    expect(t.prompt).toMatchObject({ kind: 'remoteFrequency' });
  });

  it('refuses a broken trigger before its APs: HandItemWorks comes first', () => {
    const { sim, merc } = scene((t) => objectOf(t, 'REMOTEBOMBTRIGGER', USABLE_STATUS - 1), { combat: true });
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'useRemote', soldier: 0 })).toMatchObject({ ok: false, data: { refusal: 'itemBroken' } });
    expect(merc.actionPoints).toBe(before);
  });

  it('keeps the O3 statue remote acting at once, outside handleItem, while handleItem with it presses the statue too', () => {
    const { sim, t, merc } = scene((t) => objectOf(t, 'REMOTETRIGGER'), { combat: true });
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'useRemote', soldier: 0 })).toEqual({ ok: true, data: { result: 'nothing' } });
    expect(before - merc.actionPoints).toBe(2 * AP.USE_REMOTE);
    expect(animName(t.content, merc.state)).not.toBe('USE_REMOTE');
    changeSoldierStance(t, merc, CROUCHED);
    runUntilIdle(sim);
    sim.drainEvents();
    expect(handleItem(t, merc, merc.gridNo, merc.level, itemId(t, 'REMOTETRIGGER'))).toBe(ItemHandle.OK);
    expect(t.events).toContainEqual({ type: 'remoteUsed', soldier: merc.id, result: 'nothing' });
  });
});

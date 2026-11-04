import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { itemId, objectOf } from '../../../tests/support/explosives.ts';
import { testProfile } from '../../../tests/support/profiles.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { tacticalPromptView } from '../../server/tactical-prompt-view.ts';
import type { SimEvent } from '../events.ts';
import { type ItemObject, ObjectFlags } from '../items/object.ts';
import { changeSoldierStance } from './animation.ts';
import { Detonator, ItemAction, setActionValue, setBombItem, setBombOwner, setDetonator, setFrequency } from './bombs/bomb-object.ts';
import { hasMineFlag, MineFlag, setMineFlag } from './bombs/mine-flags.ts';
import { continuePastBoobyTrap } from './booby-traps.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import { MercQuote } from './narrative/merc-quotes.ts';
import { NO_NARRATIVE_PORT, StopTimeCallback } from './narrative/port.ts';
import { AP } from './points.ts';
import type { ProfileProgress, StatKey } from './profiles.ts';
import { type Soldier, TEAM_FIRST_ID, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { addItemToPool, Visibility, type WorldItem, WorldItemFlags } from './world-items.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_AT = gridNo(80, 80);
const MERC_PROFILE = 3;
const CROUCHED = 3;
const UNSEEN_TRAP = 20;
const EASY_TRAP = 2;
const ROLLS_PER_DIFFICULTY_FOUND = 3;
const ROLLS_PER_DIFFICULTY_DISARMED = 6;
const SKILL_CHECK_ROLLS = 1;
const SURE_SUCCESS = 0;
const SURE_FAILURE = 99;
const NO_GAIN = 99;
const GAIN = 0;
const SOLDIER_OWNER_OFFSET = 2;
const FREQUENCY = 3;
const OTHER_FREQUENCY = 4;
const TILES_AWAY = 6;
const MINE_STATUS = 77;
const DIG_UP_ROLL = 4;
const DIG_UP_STATUS_SPREAD = 9;
const ROOF_LEVEL = 1;

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

function scene(): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  const profile = testProfile(MERC_PROFILE, { gains: { ...ZERO_GAINS } });
  t.profiles.set(MERC_PROFILE, profile);
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH, { profile: MERC_PROFILE });
  changeSoldierStance(t, merc, CROUCHED);
  runUntilIdle(sim);
  return { sim, t, merc, profile };
}

function trapped(t: TacticalState, name: string, trap: number, known = false): ItemObject {
  const o = objectOf(t, name);
  o.trap = trap;
  if (known) o.flags |= ObjectFlags.KNOWN_TO_BE_TRAPPED;
  return o;
}

function lay(t: TacticalState, o: ItemObject, g = MERC_AT): WorldItem {
  const wi = addItemToPool(t, g, o, Visibility.VISIBLE, 0);
  if (!wi) throw new Error(`cannot lay ${o.item}`);
  return wi;
}

function scriptedPre(t: TacticalState, rolls: readonly number[]): number[] {
  const asked: number[] = [];
  const queued = [...rolls];
  const pre = t.pre as unknown as { int(n: number): number };
  pre.int = (n: number) => {
    asked.push(n);
    const roll = queued.shift();
    if (roll === undefined) throw new Error(`unscripted PreRandom(${n})`);
    return roll;
  };
  return asked;
}

function pickUp(sim: TacticalSim, extra: Readonly<Record<string, unknown>> = {}): SimEvent[] {
  expect(sim.dispatch({ type: 'pickUp', soldier: 0, ...extra })).toEqual({ ok: true });
  return sim.drainEvents();
}

function answer(sim: TacticalSim, choice: string): SimEvent[] {
  const prompt = sim.state.prompt;
  if (!prompt) throw new Error('no prompt is open');
  expect(sim.dispatch({ type: 'answer', prompt: prompt.id, choice })).toEqual({ ok: true });
  return sim.drainEvents();
}

function holds(merc: Soldier, item: number): ItemObject | undefined {
  return merc.inv.find((o) => o.item === item);
}

describe('a booby-trapped item on the ground (Handle_Items.cc ContinuePastBoobyTrap)', () => {
  it('goes off as a mini grenade with nobody as owner when the merc does not notice it, and stops the pickup', () => {
    const { sim, t, merc } = scene();
    const trap = lay(t, trapped(t, 'CANTEEN', UNSEEN_TRAP));
    const after = lay(t, objectOf(t, 'CROWBAR'));
    const events = pickUp(sim);
    expect(events.find((e) => e.type === 'trapSetOff')).toEqual(expect.objectContaining({ soldier: merc.id, gridNo: MERC_AT }));
    expect(events.find((e) => e.type === 'explosion')).toMatchObject({ item: itemId(t, 'MINI_GRENADE'), gridNo: MERC_AT, owner: null });
    expect(t.worldItems).not.toContain(trap);
    expect(t.worldItems).toContain(after);
    expect(holds(merc, itemId(t, 'CROWBAR'))).toBeUndefined();
    expect(t.prompt).toBeNull();
    expect(events.find((e) => e.type === 'itemsPickedUp')).toMatchObject({ battleSound: 'GOTIT' });
  });

  it('explodes at ground level even when it lies on a roof (SetOffBoobyTrap passes level 0)', () => {
    const { t, merc } = scene();
    merc.level = 1;
    const wi: WorldItem = {
      gridNo: MERC_AT,
      level: 1,
      object: trapped(t, 'CANTEEN', UNSEEN_TRAP),
      flags: 0,
      zHeight: 0,
      visible: Visibility.VISIBLE,
    };
    t.worldItems.push(wi);
    expect(continuePastBoobyTrap(t, merc, wi, MERC_AT)).toBe('stopped');
    expect(t.events.find((e) => e.type === 'explosion')).toMatchObject({ gridNo: MERC_AT, level: 0 });
  });

  it('is spotted by a merc whose trap detect level reaches it: the item is known, the pickup stops and he says no GOTIT', () => {
    const { sim, t, merc } = scene();
    const wi = lay(t, trapped(t, 'CANTEEN', EASY_TRAP));
    const events = pickUp(sim);
    expect(wi.object.flags & ObjectFlags.KNOWN_TO_BE_TRAPPED).toBe(ObjectFlags.KNOWN_TO_BE_TRAPPED);
    expect(events.find((e) => e.type === 'trapSpotted')).toEqual(
      expect.objectContaining({ soldier: merc.id, gridNo: MERC_AT, kind: 'item' }),
    );
    expect(events.find((e) => e.type === 'itemsPickedUp')).not.toHaveProperty('battleSound');
    expect(t.worldItems).toContain(wi);
    expect(t.boobyTrap).toMatchObject({ soldier: merc, item: wi, gridNo: MERC_AT, level: 0, buried: false, difficulty: EASY_TRAP });
  });

  it('warns with the stop-time booby-trap quote and leaves the disarm box to its callback', () => {
    const { sim, t, merc } = scene();
    const said: [Soldier, number, string][] = [];
    t.narrative = {
      ...NO_NARRATIVE_PORT,
      sayStopTimeQuote: (s, quote, callback) => {
        said.push([s, quote, callback]);
        return true;
      },
    };
    lay(t, trapped(t, 'CANTEEN', EASY_TRAP));
    pickUp(sim);
    expect(said).toEqual([[merc, MercQuote.BOOBYTRAP_ITEM, StopTimeCallback.BOOBY_TRAP]]);
    expect(t.prompt).toBeNull();
    sim.runStopTimeCallback(StopTimeCallback.BOOBY_TRAP);
    expect(t.prompt).toMatchObject({ kind: 'disarmTrap' });
    expect(t.boobyTrap.justFound).toBe(true);
  });

  it('opens the disarm box at once in the sandbox, which has no dialogue queue', () => {
    const { sim, t } = scene();
    lay(t, trapped(t, 'CANTEEN', EASY_TRAP));
    pickUp(sim);
    expect(t.prompt).toEqual({ id: `disarmTrap-${t.clockMs}-1`, kind: 'disarmTrap' });
    expect(sim.hasPendingDecision()).toBe(true);
  });

  it('asks at once, with no quote and no finding gain, when the trap is already known', () => {
    const { sim, t, merc, profile } = scene();
    t.narrative = { ...NO_NARRATIVE_PORT, sayStopTimeQuote: () => expect.unreachable('no quote for a known trap') };
    lay(t, trapped(t, 'CANTEEN', EASY_TRAP, true));
    pickUp(sim);
    expect(t.prompt).toMatchObject({ kind: 'disarmTrap' });
    expect(t.boobyTrap.justFound).toBe(false);
    answer(sim, 'no');
    expect(profile.gains).toEqual(ZERO_GAINS);
    expect(holds(merc, itemId(t, 'CANTEEN'))).toBeUndefined();
  });

  it('leaves enemies untouched: they pick a trapped item up as if nothing were there', () => {
    const { sim, t } = scene();
    const enemy = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, MERC_AT + TILES_AWAY, Direction.SOUTH);
    const wi = lay(t, trapped(t, 'CANTEEN', UNSEEN_TRAP), enemy.gridNo);
    expect(continuePastBoobyTrap(t, enemy, wi, enemy.gridNo)).toBe('continue');
    expect(t.events).toEqual([]);
  });

  it('charges the pickup APs in combat though the trap stopped it', () => {
    const { sim, t, merc } = scene();
    spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, gridNo(80, 95), Direction.NORTH);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    lay(t, trapped(t, 'CANTEEN', EASY_TRAP));
    const before = merc.actionPoints;
    pickUp(sim);
    expect(before - merc.actionPoints).toBe(AP.PICKUP_ITEM);
  });
});

describe('the disarm box of a booby trap (Handle_Items.cc BoobyTrapMessageBoxCallBack)', () => {
  function spottedTrap(name = 'CANTEEN'): Scene & { readonly wi: WorldItem } {
    const s = scene();
    const wi = lay(s.t, trapped(s.t, name, EASY_TRAP));
    pickUp(s.sim);
    expect(s.t.prompt).toMatchObject({ kind: 'disarmTrap' });
    return { ...s, wi };
  }

  function rolls(firstFound: number, skill: number, firstDisarmed: number): number[] {
    const found = Array.from({ length: 2 * ROLLS_PER_DIFFICULTY_FOUND * EASY_TRAP }, () => NO_GAIN);
    const disarmed = Array.from({ length: ROLLS_PER_DIFFICULTY_DISARMED * EASY_TRAP }, () => NO_GAIN);
    return [firstFound, ...found.slice(1), skill, firstDisarmed, ...disarmed.slice(1)];
  }

  it('gives the finding gain (3 × trap wisdom, then 3 × trap explosives), checks DISARM_TRAP, then 6 × trap explosives', () => {
    const { sim, t, merc, profile, wi } = spottedTrap();
    const asked = scriptedPre(t, rolls(GAIN, SURE_SUCCESS, GAIN));
    const events = answer(sim, 'yes');
    expect(asked).toHaveLength((2 * ROLLS_PER_DIFFICULTY_FOUND + ROLLS_PER_DIFFICULTY_DISARMED) * EASY_TRAP + SKILL_CHECK_ROLLS);
    expect([profile.gains.wisdom, profile.gains.explosives]).toEqual([1, 1]);
    expect(events.find((e) => e.type === 'trapDisarmed')).toEqual(
      expect.objectContaining({ soldier: merc.id, gridNo: MERC_AT, battleSound: 'COOL1' }),
    );
    const canteen = holds(merc, itemId(t, 'CANTEEN'));
    expect(canteen).toMatchObject({ trap: 0 });
    expect((canteen?.flags ?? 0) & ObjectFlags.KNOWN_TO_BE_TRAPPED).toBe(0);
    expect(t.worldItems).not.toContain(wi);
    expect(t.boobyTrap.justFound).toBe(false);
  });

  it('sets the trap off after a failed check, with 3 × trap explosives as a failure and CURSE1', () => {
    const { sim, t, merc, wi } = spottedTrap();
    const failed = Array.from({ length: ROLLS_PER_DIFFICULTY_FOUND * EASY_TRAP }, () => NO_GAIN);
    const asked = scriptedPre(t, [...failed, ...failed, SURE_FAILURE, ...failed]);
    const events = answer(sim, 'yes');
    expect(asked).toHaveLength(3 * ROLLS_PER_DIFFICULTY_FOUND * EASY_TRAP + SKILL_CHECK_ROLLS);
    expect(events.find((e) => e.type === 'trapSetOff')).toEqual(expect.objectContaining({ soldier: merc.id, battleSound: 'CURSE1' }));
    expect(events.find((e) => e.type === 'explosion')).toMatchObject({ item: itemId(t, 'MINI_GRENADE'), gridNo: MERC_AT, level: 0 });
    expect(t.worldItems).not.toContain(wi);
    expect(holds(merc, itemId(t, 'CANTEEN'))).toBeUndefined();
  });

  it('gives the finding gain on a no too, and leaves the known trap on the ground', () => {
    const { sim, t, profile, wi } = spottedTrap();
    const asked = scriptedPre(t, rolls(GAIN, SURE_SUCCESS, GAIN).slice(0, 2 * ROLLS_PER_DIFFICULTY_FOUND * EASY_TRAP));
    expect(answer(sim, 'no')).toEqual([]);
    expect(asked).toHaveLength(2 * ROLLS_PER_DIFFICULTY_FOUND * EASY_TRAP);
    expect([profile.gains.wisdom, profile.gains.explosives]).toEqual([1, 0]);
    expect(t.worldItems).toContain(wi);
    expect(wi.object.trap).toBe(EASY_TRAP);
  });

  it('gives no explosives gain and no COOL1 for disarming a bomb a merc of ours planted (owner id + 2)', () => {
    const s = scene();
    const o = trapped(s.t, 'TNT', EASY_TRAP, true);
    setDetonator(o, Detonator.TIMED);
    setBombOwner(o, s.merc.id + SOLDIER_OWNER_OFFSET);
    lay(s.t, o);
    pickUp(s.sim);
    const asked = scriptedPre(s.t, [SURE_SUCCESS]);
    const events = answer(s.sim, 'yes');
    expect(asked).toEqual([100]);
    expect(s.profile.gains.explosives).toBe(0);
    expect(events.find((e) => e.type === 'trapDisarmed')).not.toHaveProperty('battleSound');
  });

  it('leaves the disarmed item on the ground, untrapped, when his pockets are full', () => {
    const { sim, t, merc, wi } = spottedTrap('CROWBAR');
    const rock = objectOf(t, 'CROWBAR');
    for (let slot = 0; slot < merc.inv.length; slot++) if (slot !== InvSlot.HAND) merc.inv[slot] = { ...rock, attachments: [] };
    scriptedPre(t, rolls(NO_GAIN, SURE_SUCCESS, NO_GAIN));
    answer(sim, 'yes');
    expect(t.worldItems).toContain(wi);
    expect(wi.object.trap).toBe(0);
    expect(wi.object.flags & ObjectFlags.KNOWN_TO_BE_TRAPPED).toBe(0);
  });
});

describe('a switch on the ground (Handle_Items.cc SoldierGetItemFromWorld, SwitchMessageBoxCallBack)', () => {
  function switchInOpenedContainer(t: TacticalState, frequency: number): WorldItem {
    const o = objectOf(t, 'SWITCH');
    setFrequency(o, frequency);
    const wi = lay(t, o);
    wi.visible = Visibility.VISIBLE;
    return wi;
  }

  function remoteBomb(t: TacticalState, frequency: number): WorldItem {
    const o = objectOf(t, 'TNT');
    setDetonator(o, Detonator.REMOTE);
    setFrequency(o, frequency);
    const wi = addItemToPool(t, MERC_AT + TILES_AWAY, o, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB);
    if (!wi) throw new Error('cannot place the bomb');
    return wi;
  }

  it('asks to activate it and stays on the ground; yes sets off its frequency', () => {
    const { sim, t, merc } = scene();
    const wi = switchInOpenedContainer(t, FREQUENCY);
    remoteBomb(t, OTHER_FREQUENCY);
    remoteBomb(t, FREQUENCY);
    pickUp(sim);
    expect(t.prompt).toEqual({ id: `activateSwitch-${t.clockMs}-1`, kind: 'activateSwitch', soldier: merc, frequency: FREQUENCY });
    expect(t.worldItems).toContain(wi);
    const events = answer(sim, 'yes');
    expect(events).toContainEqual(expect.objectContaining({ type: 'switchActivated', soldier: merc.id }));
    expect(t.explosionQueue.entries.map((e) => e.bomb)).toEqual([1]);
  });

  it('does nothing on a no', () => {
    const { sim, t } = scene();
    switchInOpenedContainer(t, FREQUENCY);
    remoteBomb(t, FREQUENCY);
    pickUp(sim);
    expect(answer(sim, 'no')).toEqual([]);
    expect(t.explosionQueue.entries).toEqual([]);
  });

  it('drops the disarm box of a known trap picked up after it in one go: one box at a time (DoMessageBox)', () => {
    const { sim, t } = scene();
    switchInOpenedContainer(t, FREQUENCY);
    const known = lay(t, trapped(t, 'CANTEEN', EASY_TRAP, true));
    pickUp(sim);
    expect(t.prompt).toMatchObject({ kind: 'activateSwitch' });
    expect(t.boobyTrap.item).toBe(known);
    answer(sim, 'no');
    expect(t.prompt).toBeNull();
  });
});

describe('an open tactical prompt', () => {
  function promptOpen(): Scene {
    const s = scene();
    lay(s.t, trapped(s.t, 'CANTEEN', EASY_TRAP, true));
    pickUp(s.sim);
    return s;
  }

  it('stops the simulation and refuses every other command with promptOpen', () => {
    const { sim, t } = promptOpen();
    const tick = sim.tick;
    sim.step();
    expect(sim.tick).toBe(tick);
    expect(sim.dispatch({ type: 'move', soldier: 0, to: MERC_AT + 2 })).toMatchObject({ ok: false, data: { refusal: 'promptOpen' } });
    expect(sim.dispatch({ type: 'setOption', bloodAndGore: false })).toMatchObject({ ok: false, data: { refusal: 'promptOpen' } });
    expect(t.prompt).not.toBeNull();
  });

  it('refuses an answer to another prompt or with another choice', () => {
    const { sim } = promptOpen();
    expect(sim.dispatch({ type: 'answer', prompt: 'disarmTrap-9', choice: 'yes' })).toMatchObject({ data: { refusal: 'wrongPrompt' } });
    expect(sim.dispatch({ type: 'answer', choice: 'maybe' })).toMatchObject({ data: { refusal: 'badChoice' } });
    expect(sim.dispatch({ type: 'answer', choice: 'no' })).toEqual({ ok: true });
    expect(sim.dispatch({ type: 'answer', choice: 'no' })).toMatchObject({ data: { refusal: 'noPrompt' } });
  });
});

describe('the bomb under a tile our side knows to hold a mine (Handle_Items.cc HandleSoldierPickupItem, gfDisarmingBuriedBomb)', () => {
  interface Burying {
    readonly detonator?: number;
    readonly action?: number;
    readonly bombItem?: string;
    readonly owner?: number;
    readonly status?: number;
  }

  function bury(t: TacticalState, name: string, burying: Burying = {}, g = MERC_AT): WorldItem {
    const o = objectOf(t, name, burying.status ?? 100);
    o.trap = EASY_TRAP;
    o.flags |= ObjectFlags.ARMED_BOMB;
    setDetonator(o, burying.detonator ?? Detonator.PRESSURE);
    setBombItem(o, burying.bombItem === undefined ? o.item : itemId(t, burying.bombItem));
    if (burying.action !== undefined) setActionValue(o, burying.action);
    if (burying.owner !== undefined) setBombOwner(o, burying.owner);
    const wi = addItemToPool(t, g, o, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB);
    if (!wi) throw new Error(`cannot bury ${name}`);
    setMineFlag(t, g, MineFlag.PLAYER);
    return wi;
  }

  function disarmRolls(skill: number): number[] {
    return [skill, ...Array.from({ length: ROLLS_PER_DIFFICULTY_DISARMED * EASY_TRAP }, () => NO_GAIN)];
  }

  function scriptedRandom(t: TacticalState, roll: number): number[] {
    const asked: number[] = [];
    const rng = t.rng as unknown as { int(n: number): number };
    rng.int = (n: number) => {
      asked.push(n);
      return roll;
    };
    return asked;
  }

  it('asks to disarm it before the items lying there, naming no item, and charges no pickup APs', () => {
    const { sim, t, merc } = scene();
    spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, gridNo(80, 95), Direction.NORTH);
    sim.lookAround();
    const canteen = lay(t, objectOf(t, 'CANTEEN'));
    const mine = bury(t, 'MINE');
    const before = merc.actionPoints;
    pickUp(sim);
    expect(t.boobyTrap).toMatchObject({ soldier: merc, item: mine, gridNo: MERC_AT, level: 0, buried: true, difficulty: EASY_TRAP });
    expect(tacticalPromptView(t)).toEqual({
      id: t.prompt?.id,
      kind: 'disarmTrap',
      soldier: merc.id,
      gridNo: MERC_AT,
      buried: true,
      choices: ['yes', 'no'],
    });
    expect(t.worldItems).toContain(canteen);
    expect(merc.actionPoints).toBe(before);
  });

  it('digs up a mine as its bomb item at its bomb status, with 6 × trap explosives and COOL1, and takes the blue flag off', () => {
    const { sim, t, merc } = scene();
    const mine = bury(t, 'MINE', { status: MINE_STATUS });
    pickUp(sim);
    const asked = scriptedPre(t, disarmRolls(SURE_SUCCESS));
    const events = answer(sim, 'yes');
    expect(asked).toHaveLength(SKILL_CHECK_ROLLS + ROLLS_PER_DIFFICULTY_DISARMED * EASY_TRAP);
    expect(events.find((e) => e.type === 'trapDisarmed')).toEqual(
      expect.objectContaining({ soldier: merc.id, gridNo: MERC_AT, battleSound: 'COOL1' }),
    );
    expect(holds(merc, itemId(t, 'MINE'))).toMatchObject({ status: [MINE_STATUS], flags: 0, trap: 0 });
    expect(t.worldItems).not.toContain(mine);
    expect(t.worldBombs.some((b) => b.exists)).toBe(false);
    expect(hasMineFlag(t, MERC_AT, MineFlag.PLAYER)).toBe(false);
  });

  it('digs up a switch as a remote bomb trigger and an action item that does not blow up as a detonator, at 1 + Random(9)', () => {
    for (const [buried, dugUp] of [
      [{ name: 'SWITCH', burying: {} }, 'REMOTEBOMBTRIGGER'],
      [{ name: 'ACTION_ITEM', burying: { action: ItemAction.KLAXON } }, 'DETONATOR'],
    ] as const) {
      const { sim, t, merc } = scene();
      bury(t, buried.name, buried.burying);
      pickUp(sim);
      scriptedPre(t, disarmRolls(SURE_SUCCESS));
      const asked = scriptedRandom(t, DIG_UP_ROLL);
      answer(sim, 'yes');
      expect(asked).toEqual([DIG_UP_STATUS_SPREAD]);
      expect(holds(merc, itemId(t, dugUp))).toMatchObject({ status: [1 + DIG_UP_ROLL] });
    }
  });

  it('digs up a map minefield, an action item that blows up, as its bomb item', () => {
    const { sim, t, merc } = scene();
    bury(t, 'ACTION_ITEM', { action: ItemAction.BLOW_UP, bombItem: 'MINE', owner: 1 });
    pickUp(sim);
    scriptedPre(t, disarmRolls(SURE_SUCCESS));
    answer(sim, 'yes');
    expect(holds(merc, itemId(t, 'MINE'))).toMatchObject({ status: [100] });
    expect(holds(merc, itemId(t, 'ACTION_ITEM'))).toBeUndefined();
  });

  it('sets off every bomb of the tile after a failed check, a remote one too, with 3 × trap explosives as a failure and CURSE1', () => {
    const { sim, t, merc } = scene();
    bury(t, 'MINE');
    bury(t, 'TNT', { detonator: Detonator.REMOTE });
    pickUp(sim);
    const failed = Array.from({ length: ROLLS_PER_DIFFICULTY_FOUND * EASY_TRAP }, () => NO_GAIN);
    const asked = scriptedPre(t, [SURE_FAILURE, ...failed]);
    const events = answer(sim, 'yes');
    expect(asked).toHaveLength(SKILL_CHECK_ROLLS + ROLLS_PER_DIFFICULTY_FOUND * EASY_TRAP);
    expect(events.find((e) => e.type === 'trapSetOff')).toEqual(expect.objectContaining({ soldier: merc.id, battleSound: 'CURSE1' }));
    expect(t.explosionQueue.entries.map((e) => e.bomb)).toEqual([0, 1]);
  });

  it('sets off nothing when the failed disarm is of a mine one of our mercs planted: our team never sets those off', () => {
    const { sim, t, merc } = scene();
    bury(t, 'MINE', { owner: merc.id + SOLDIER_OWNER_OFFSET });
    pickUp(sim);
    scriptedPre(t, [SURE_FAILURE, ...Array.from({ length: ROLLS_PER_DIFFICULTY_FOUND * EASY_TRAP }, () => NO_GAIN)]);
    answer(sim, 'yes');
    expect(t.explosionQueue.entries).toEqual([]);
  });

  it('asks on a no whether to take the blue flag off: yes takes it off, no leaves it', () => {
    for (const choice of ['yes', 'no'] as const) {
      const { sim, t, merc } = scene();
      const mine = bury(t, 'MINE');
      pickUp(sim);
      expect(answer(sim, 'no')).toEqual([]);
      expect(tacticalPromptView(t)).toEqual({
        id: t.prompt?.id,
        kind: 'removeBlueFlag',
        soldier: merc.id,
        gridNo: MERC_AT,
        choices: ['yes', 'no'],
      });
      answer(sim, choice);
      expect(hasMineFlag(t, MERC_AT, MineFlag.PLAYER)).toBe(choice === 'no');
      expect(t.worldItems).toContain(mine);
    }
  });

  it('leaves a dug-up bomb that does not fit on the ground, uncovered and no longer armed', () => {
    const { sim, t, merc } = scene();
    const mine = bury(t, 'MINE');
    const crowbar = objectOf(t, 'CROWBAR');
    for (let slot = 0; slot < merc.inv.length; slot++) if (slot !== InvSlot.HAND) merc.inv[slot] = { ...crowbar, attachments: [] };
    pickUp(sim);
    scriptedPre(t, disarmRolls(SURE_SUCCESS));
    answer(sim, 'yes');
    expect(t.worldItems).not.toContain(mine);
    expect(t.worldItems.filter((wi) => wi.gridNo === MERC_AT)).toEqual([
      expect.objectContaining({
        object: expect.objectContaining({ item: itemId(t, 'MINE'), flags: 0 }),
        visible: Visibility.VISIBLE,
        flags: 0,
      }),
    ]);
    expect(t.worldBombs.some((b) => b.exists)).toBe(false);
  });

  it('picks up as usual where our side marks a mine with no bomb under it on his level (the original throws)', () => {
    for (const bombThere of [false, true]) {
      const { sim, t, merc } = scene();
      setMineFlag(t, MERC_AT, MineFlag.PLAYER);
      if (bombThere) bury(t, 'MINE').level = ROOF_LEVEL;
      lay(t, objectOf(t, 'CANTEEN'));
      pickUp(sim);
      expect(t.prompt).toBeNull();
      expect(holds(merc, itemId(t, 'CANTEEN'))).toBeDefined();
    }
  });
});

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { objectOf } from '../../../../tests/support/explosives.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { tacticalPromptView } from '../../../server/tactical-prompt-view.ts';
import type { SimEvent } from '../../events.ts';
import { ObjectFlags } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { MercQuote } from '../narrative/merc-quotes.ts';
import { NO_NARRATIVE_PORT, StopTimeCallback } from '../narrative/port.ts';
import type { ProfileProgress, StatKey } from '../profiles.ts';
import { type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { addItemToPool, Visibility, type WorldItem, WorldItemFlags } from '../world-items.ts';
import { armBomb, Detonator, setDetonator, toggleDisabledBomb } from './bomb-object.ts';
import { checkIfNearbyGroundSeemsWrong, nearbyGroundSeemsWrong } from './mine-detection.ts';
import { hasMineFlag, knownMineTiles, MineFlag, setMineFlag } from './mine-flags.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_AT = gridNo(80, 80);
const MERC_PROFILE = 3;
const SURE_TRAP = 1;
const UNSEEN_TRAP = 20;
const METAL_DETECTOR_MAX_TRAP = 10;
const SHOCKED = 2;
const BLEEDING_HARD = 21;
const DETECT_LEVEL_DRAW = 3;
const TILES_WALKED = 3;
const DRAWS_PER_STEP = 2;
const ROOF_LEVEL = 1;
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const NORTH_EAST = DIRECTION_INCREMENT[Direction.NORTHEAST] ?? 0;
const SOUTH = DIRECTION_INCREMENT[Direction.SOUTH] ?? 0;
const STAT_ROLL = 100;
const GAIN = 0;
const FAR = gridNo(110, 110);

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
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.EAST, { profile: MERC_PROFILE });
  return { sim, t, merc, profile };
}

function layMine(t: TacticalState, g: number, trap: number): WorldItem {
  const o = objectOf(t, 'MINE');
  armBomb(t, o, Detonator.PRESSURE);
  o.trap = trap;
  const wi = addItemToPool(t, g, o, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB);
  if (!wi) throw new Error('cannot lay the mine');
  return wi;
}

function enemyAt(sim: TacticalSim, g: number, team: number = Team.ENEMY): Soldier {
  return spawnSoldier(sim, TEAM_FIRST_ID[team] ?? 0, team, g, Direction.EAST);
}

function recordedPre(t: TacticalState, rolls: readonly number[] = []): number[] {
  const asked: number[] = [];
  const queued = [...rolls];
  const pre = t.pre as unknown as { int(n: number): number };
  const draw = pre.int.bind(pre);
  pre.int = (n: number) => {
    asked.push(n);
    return queued.shift() ?? draw(n);
  };
  return asked;
}

function carryMetalDetector(t: TacticalState, s: Soldier): void {
  s.inv[InvSlot.BIGPOCK1] = objectOf(t, 'METALDETECTOR');
}

function walkUntil(sim: TacticalSim, s: Soldier, to: number, done: () => boolean): SimEvent[] {
  expect(sim.dispatch({ type: 'move', soldier: s.id, to })).toEqual({ ok: true });
  const events = sim.drainEvents();
  for (let tick = 0; tick < 5000 && !done(); tick++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  expect(done()).toBe(true);
  return events;
}

function walk(sim: TacticalSim, s: Soldier, to: number): SimEvent[] {
  return walkUntil(sim, s, to, () => sim.isIdle() || sim.state.prompt !== null);
}

function settle(sim: TacticalSim): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < 5000 && !sim.isIdle(); tick++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

describe('suspicious ground (Handle_Items.cc NearbyGroundSeemsWrong, Overhead.cc CheckIfNearbyGroundSeemsWrong)', () => {
  it('checks the tile he is about to step on before the step: he stops short of a mine within his trap detect level', () => {
    const { sim, t, merc } = scene();
    const mine = layMine(t, MERC_AT + EAST, SURE_TRAP);
    const events = walk(sim, merc, MERC_AT + 4 * EAST);
    expect(merc.gridNo).toBe(MERC_AT);
    expect(mine.object.flags & ObjectFlags.KNOWN_TO_BE_TRAPPED).toBe(ObjectFlags.KNOWN_TO_BE_TRAPPED);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'trapSpotted', soldier: merc.id, gridNo: MERC_AT + EAST, kind: 'ground' }),
    );
    expect(t.explosionQueue.entries).toEqual([]);
  });

  it('checks the eight tiles around the tile he arrives on, and stops there', () => {
    const { sim, t, merc } = scene();
    layMine(t, MERC_AT + EAST + NORTH_EAST, SURE_TRAP);
    walk(sim, merc, MERC_AT + 4 * EAST);
    expect(merc.gridNo).toBe(MERC_AT + EAST);
    expect(t.boobyTrap).toMatchObject({ soldier: merc, gridNo: MERC_AT + EAST + NORTH_EAST });
  });

  it('skips a tile around him he could not move into', () => {
    const { t, merc } = scene();
    const mine = MERC_AT + NORTH_EAST;
    layMine(t, mine, SURE_TRAP);
    t.world.costs.force(mine, Direction.NORTHEAST, 0, TravelCost.WALL);
    expect(nearbyGroundSeemsWrong(t, merc, MERC_AT, true)).toBeNull();
    expect(nearbyGroundSeemsWrong(t, merc, mine, false)).toBe(mine);
  });

  it('misses a mine beyond his trap detect level, and steps on it', () => {
    const { sim, t, merc } = scene();
    layMine(t, MERC_AT + EAST, UNSEEN_TRAP);
    const events = walkUntil(sim, merc, MERC_AT + 4 * EAST, () => t.explosionQueue.active);
    expect(merc.gridNo).toBe(MERC_AT + EAST);
    expect(events.some((e) => e.type === 'trapSpotted')).toBe(false);
  });

  it('gives our merc the trap level in explosives chances as he spots the mine', () => {
    const { t, merc, profile } = scene();
    const mine = layMine(t, MERC_AT + EAST, SURE_TRAP);
    mine.object.trap = 2 * SURE_TRAP;
    const asked = recordedPre(t, [GAIN, GAIN]);
    expect(nearbyGroundSeemsWrong(t, merc, mine.gridNo, false)).toBe(mine.gridNo);
    expect(asked).toEqual([STAT_ROLL, STAT_ROLL]);
    expect(profile.gains.explosives).toBe(2);
  });

  it('ignores what his side already knows: a marked tile, a known trap, a disabled bomb, a bomb not set off by pressure', () => {
    const { t, merc } = scene();
    const mine = layMine(t, MERC_AT + EAST, SURE_TRAP);
    setMineFlag(t, mine.gridNo, MineFlag.PLAYER);
    expect(nearbyGroundSeemsWrong(t, merc, mine.gridNo, false)).toBeNull();
    t.mineFlags[mine.gridNo] = MineFlag.ENEMY;
    expect(nearbyGroundSeemsWrong(t, merc, mine.gridNo, false)).toBe(mine.gridNo);
    expect(nearbyGroundSeemsWrong(t, merc, mine.gridNo, false)).toBeNull();
    const disabled = layMine(t, MERC_AT + 2 * EAST, SURE_TRAP);
    toggleDisabledBomb(disabled.object);
    expect(nearbyGroundSeemsWrong(t, merc, disabled.gridNo, false)).toBeNull();
    const remote = layMine(t, MERC_AT + 3 * EAST, SURE_TRAP);
    setDetonator(remote.object, Detonator.REMOTE);
    expect(nearbyGroundSeemsWrong(t, merc, remote.gridNo, false)).toBeNull();
  });

  it('draws PreRandom(3) at both checks of every step of a bleeding or shocked soldier, mines or not', () => {
    const { sim, t, merc } = scene();
    merc.shock = SHOCKED;
    const asked = recordedPre(t);
    walk(sim, merc, MERC_AT + TILES_WALKED * EAST);
    expect(merc.gridNo).toBe(MERC_AT + TILES_WALKED * EAST);
    expect(asked.filter((n) => n === DETECT_LEVEL_DRAW)).toHaveLength(DRAWS_PER_STEP * TILES_WALKED);
    merc.shock = 0;
    merc.bleeding = BLEEDING_HARD;
    asked.length = 0;
    expect(nearbyGroundSeemsWrong(t, merc, MERC_AT, true)).toBeNull();
    expect(asked).toEqual([DETECT_LEVEL_DRAW]);
  });

  it('stops all our mercs out of combat, and only him in combat', () => {
    const { sim, t, merc } = scene();
    const other = spawnSoldier(sim, 1, Team.OUR, MERC_AT - 5 * SOUTH, Direction.EAST);
    const keepWalking = () => {
      expect(sim.dispatch({ type: 'move', soldier: other.id, to: other.gridNo + 6 * EAST })).toEqual({ ok: true });
      expect(other.pathSize).toBeGreaterThan(0);
    };
    keepWalking();
    layMine(t, MERC_AT + EAST, SURE_TRAP);
    expect(checkIfNearbyGroundSeemsWrong(t, merc, MERC_AT + EAST, false)).toBe(true);
    expect(other.pathSize).toBe(0);
    expect(sim.dispatch({ type: 'answer', choice: 'no' })).toEqual({ ok: true });
    spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, other.gridNo + 6 * EAST + 8 * SOUTH, Direction.SOUTH);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    keepWalking();
    const path = other.pathSize;
    layMine(t, MERC_AT + 2 * EAST, SURE_TRAP);
    expect(checkIfNearbyGroundSeemsWrong(t, merc, MERC_AT + 2 * EAST, false)).toBe(true);
    expect(other.pathSize).toBe(path);
  });

  it('has an enemy who spots a mine stop, mark it for his side and rethink; the militia marks it for the player', () => {
    const { sim, t } = scene();
    const far = FAR;
    const enemy = enemyAt(sim, far);
    const rethinks = vi.spyOn(t.turnHooks, 'setNewSituation');
    const done = vi.spyOn(t.turnHooks, 'actionDone');
    layMine(t, far + EAST, SURE_TRAP);
    expect(checkIfNearbyGroundSeemsWrong(t, enemy, far, true)).toBe(true);
    expect([hasMineFlag(t, far + EAST, MineFlag.ENEMY), hasMineFlag(t, far + EAST, MineFlag.PLAYER)]).toEqual([true, false]);
    expect(rethinks).toHaveBeenCalledWith(t, enemy);
    expect(done).toHaveBeenCalledWith(t, enemy);
    expect(t.events.some((e) => e.type === 'trapSpotted')).toBe(false);
    const militia = enemyAt(sim, far - 10 * EAST, Team.MILITIA);
    layMine(t, militia.gridNo + EAST, SURE_TRAP);
    expect(checkIfNearbyGroundSeemsWrong(t, militia, militia.gridNo, true)).toBe(true);
    expect(hasMineFlag(t, militia.gridNo + EAST, MineFlag.PLAYER)).toBe(true);
    expect(t.prompt).toBeNull();
  });

  it(`flags a mine of trap ${METAL_DETECTOR_MAX_TRAP} or less with a metal detector anywhere in his pockets, drawing nothing; our merc stops without a word, an enemy plants the flag for the player and walks on`, () => {
    const { sim, t, merc } = scene();
    merc.shock = SHOCKED;
    carryMetalDetector(t, merc);
    const deep = layMine(t, MERC_AT + EAST, METAL_DETECTOR_MAX_TRAP + 1);
    const asked = recordedPre(t);
    expect(nearbyGroundSeemsWrong(t, merc, deep.gridNo, false)).toBeNull();
    deep.object.trap = METAL_DETECTOR_MAX_TRAP;
    expect(checkIfNearbyGroundSeemsWrong(t, merc, deep.gridNo, false)).toBe(true);
    expect(asked).toEqual([]);
    expect(hasMineFlag(t, deep.gridNo, MineFlag.PLAYER)).toBe(true);
    expect(deep.object.flags & ObjectFlags.KNOWN_TO_BE_TRAPPED).toBe(0);
    expect([t.events, t.prompt]).toEqual([[], null]);
    const far = FAR;
    const enemy = enemyAt(sim, far);
    carryMetalDetector(t, enemy);
    layMine(t, far + EAST, METAL_DETECTOR_MAX_TRAP);
    expect(checkIfNearbyGroundSeemsWrong(t, enemy, far, true)).toBe(false);
    expect([hasMineFlag(t, far + EAST, MineFlag.PLAYER), hasMineFlag(t, far + EAST, MineFlag.ENEMY)]).toEqual([true, false]);
  });
});

describe('the spotted mine (Handle_Items.cc MineSpottedDialogueCallBack, MineSpottedMessageBoxCallBack)', () => {
  it('warns with the stop-time suspicious-ground quote, whose callback shows the locator and asks to place a blue flag', () => {
    const { sim, t, merc } = scene();
    const said: [Soldier, number, string][] = [];
    t.narrative = {
      ...NO_NARRATIVE_PORT,
      sayStopTimeQuote: (s, quote, callback) => {
        said.push([s, quote, callback]);
        return true;
      },
    };
    t.turn.lockItemLocators = true;
    layMine(t, MERC_AT + EAST, SURE_TRAP);
    checkIfNearbyGroundSeemsWrong(t, merc, MERC_AT + EAST, false);
    expect(said).toEqual([[merc, MercQuote.SUSPICIOUS_GROUND, StopTimeCallback.MINE_SPOTTED]]);
    expect(t.prompt).toBeNull();
    sim.drainEvents();
    sim.runStopTimeCallback(StopTimeCallback.MINE_SPOTTED);
    expect(t.turn.lockItemLocators).toBe(false);
    expect(sim.drainEvents()).toEqual([expect.objectContaining({ type: 'mineLocator', gridNo: MERC_AT + EAST, level: 0 })]);
    expect(t.prompt).toMatchObject({ kind: 'placeBlueFlag' });
  });

  it('asks at once in the sandbox; yes puts a blue flag on the mine, at the level the last booby trap left (gbBoobyTrapLevel is stale)', () => {
    const { sim, t, merc } = scene();
    t.boobyTrap.level = ROOF_LEVEL;
    t.turn.lockItemLocators = true;
    layMine(t, MERC_AT + EAST, SURE_TRAP);
    walk(sim, merc, MERC_AT + 4 * EAST);
    expect(t.prompt).toMatchObject({ kind: 'placeBlueFlag' });
    expect(t.turn.lockItemLocators).toBe(false);
    expect(tacticalPromptView(t)).toEqual({
      id: t.prompt?.id,
      kind: 'placeBlueFlag',
      soldier: merc.id,
      gridNo: MERC_AT + EAST,
      choices: ['yes', 'no'],
    });
    expect(sim.dispatch({ type: 'answer', choice: 'yes' })).toEqual({ ok: true });
    expect(hasMineFlag(t, MERC_AT + EAST, MineFlag.PLAYER)).toBe(true);
    expect(knownMineTiles(t)).toEqual([MERC_AT + EAST]);
  });

  it('sends the mine locator at the spotted tile on the stale level before the box', () => {
    const { sim, t, merc } = scene();
    t.boobyTrap.level = ROOF_LEVEL;
    layMine(t, MERC_AT + EAST, SURE_TRAP);
    const events = walk(sim, merc, MERC_AT + 4 * EAST);
    expect(events.filter((e) => e.type === 'trapSpotted' || e.type === 'mineLocator').map((e) => e.type)).toEqual([
      'trapSpotted',
      'mineLocator',
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'mineLocator', gridNo: MERC_AT + EAST, level: ROOF_LEVEL }));
  });

  it('leaves the mine known but unmarked on a no: no more warnings, no detour, no disarm box, so a search there walks onto it', () => {
    const { sim, t, merc } = scene();
    const mine = layMine(t, MERC_AT + EAST, SURE_TRAP);
    walk(sim, merc, MERC_AT + 4 * EAST);
    expect(sim.dispatch({ type: 'answer', choice: 'no' })).toEqual({ ok: true });
    expect(hasMineFlag(t, mine.gridNo, MineFlag.PLAYER)).toBe(false);
    expect(nearbyGroundSeemsWrong(t, merc, mine.gridNo, false)).toBeNull();
    expect(sim.dispatch({ type: 'pickUp', soldier: merc.id, gridNo: mine.gridNo })).toEqual({ ok: true });
    const events = settle(sim);
    expect(t.prompt).toBeNull();
    expect(events).toContainEqual(expect.objectContaining({ type: 'explosion', gridNo: mine.gridNo }));
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { syntheticWorld } from '../../../content/world/synthetic.ts';
import { Rng } from '../../../core/rng.ts';
import { createItem, createItems } from '../../items/object.ts';
import { initNewSoldierAnim, states } from '../animation.ts';
import { minAPsToAttack } from '../combat/ap.ts';
import { AiMorale } from '../combat/types.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { lightSetBaseLevel, NORMAL_LIGHTLEVEL_NIGHT } from '../lighting/lighting.ts';
import { setSoldierPosition } from '../movement.ts';
import { Opp } from '../perception/opp.ts';
import { allTeamsLookForAll } from '../perception/sight.ts';
import { AP, calcActionPoints } from '../points.ts';
import { setSoldierHeight } from '../roofs.ts';
import { createSoldier, type Soldier, Team } from '../soldier.ts';
import { createTacticalState, registerSoldier, type TacticalState } from '../state.ts';
import { CAN_ATTACK, calcBestShot, canNPCAttack, checkIfTossPossible, NoShoot } from './attack-choice.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const STATS = {
  agility: 70,
  dexterity: 70,
  strength: 70,
  wisdom: 70,
  leadership: 50,
  marksmanship: 70,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};

const item = (name: string) => content.items.byName.get(name)?.index ?? 0;

function newState(): TacticalState {
  return createTacticalState({ ...syntheticWorld(testDoorCosts()), mapDoors: new Map() }, content, Rng.fromSeed(7));
}

function spawn(t: TacticalState, id: number, team: number, at: number, direction: number, armed = true): Soldier {
  const s = createSoldier({
    id,
    team,
    name: `S${id}`,
    bodyType: 0,
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    stats: STATS,
    life: 80,
    gridNo: at,
    direction,
    state: states(content.animations).STANDING,
  });
  if (armed) s.inv[InvSlot.HAND] = createItem(content.items, item('GLOCK_17'), 100);
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  initNewSoldierAnim(t, s, states(content.animations).STANDING, 0, true);
  s.actionPoints = calcActionPoints(s);
  return s;
}

describe('calcBestShot', () => {
  it('gives an enemy who sees a merc a possible shot at him without drawing random numbers', () => {
    const t = newState();
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(t, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH);
    allTeamsLookForAll(t);
    expect(enemy.oppList[merc.id]).toBe(Opp.SEEN_CURRENTLY);
    const rngBefore = t.rng.state();
    const preBefore = t.pre.state();
    const shot = calcBestShot(t, enemy);
    expect(t.rng.state()).toEqual(rngBefore);
    expect(t.pre.state()).toEqual(preBefore);
    expect(shot.possible).toBe(true);
    expect(shot.opponent).toBe(merc);
    expect(shot.target).toBe(merc.gridNo);
    expect(shot.targetLevel).toBe(0);
    expect(shot.aimTime).toBeGreaterThanOrEqual(AP.MIN_AIM_ATTACK);
    expect(shot.aimTime).toBeLessThanOrEqual(AP.MAX_AIM_ATTACK);
    expect(shot.apCost).toBe(minAPsToAttack(t, enemy, merc.gridNo, true) + shot.aimTime);
    expect(shot.apCost).toBeLessThanOrEqual(enemy.actionPoints);
    expect(shot.chanceToReallyHit).toBeGreaterThan(0);
    expect(shot.attackValue).toBeGreaterThan(0);
    expect(enemy.attackingWeapon).toBe(item('GLOCK_17'));
  });

  it('switches to a later target worth exactly as much as the one it has', () => {
    const LEFT = 0;
    const RIGHT = 1;
    const shotAt = (ids: readonly number[]) => {
      const t = newState();
      const enemy = spawn(t, 20, Team.ENEMY, gridNo(80, 80), Direction.SOUTH);
      for (const id of ids) spawn(t, id, Team.OUR, id === LEFT ? gridNo(77, 86) : gridNo(83, 86), Direction.NORTH);
      allTeamsLookForAll(t);
      return calcBestShot(t, enemy);
    };
    const left = shotAt([LEFT]);
    const right = shotAt([RIGHT]);
    expect(left.possible).toBe(true);
    expect(left.attackValue).toBe(right.attackValue);
    expect(left.chanceToReallyHit).toBe(right.chanceToReallyHit);
    expect(shotAt([LEFT, RIGHT]).opponent?.id).toBe(RIGHT);
  });

  it('ignores opponents that are known but not currently seen', () => {
    const t = newState();
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(t, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH);
    expect(calcBestShot(t, enemy).possible).toBe(false);
    enemy.oppList[merc.id] = Opp.SEEN_LAST_TURN;
    const shot = calcBestShot(t, enemy);
    expect(shot.possible).toBe(false);
    expect(shot.opponent).toBeNull();
  });
});

describe('checkIfTossPossible (Items.cc FindThrowableGrenade)', () => {
  function grenadier(t: TacticalState): Soldier {
    const enemy = spawn(t, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH);
    enemy.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('HAND_GRENADE'), 100);
    enemy.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('BREAK_LIGHT'), 100);
    return enemy;
  }

  it('takes a flare before the first grenade at night while the thrower has more than half his life', () => {
    const t = newState();
    const enemy = grenadier(t);
    expect(checkIfTossPossible(t, enemy).weaponIn).toBe(InvSlot.BIGPOCK1);
    lightSetBaseLevel(t, NORMAL_LIGHTLEVEL_NIGHT);
    expect(checkIfTossPossible(t, enemy).weaponIn).toBe(InvSlot.BIGPOCK2);
    enemy.life = enemy.lifeMax / 2;
    expect(checkIfTossPossible(t, enemy).weaponIn).toBe(InvSlot.BIGPOCK1);
  });
});

describe('calcBestThrow (Attacks.cc CalcBestThrow)', () => {
  const GROUND = 0;
  const ROOF = 1;
  const ON_THE_ROOF = 50;

  it('aims at the level an opponent was last seen on, not the roof he has climbed onto since', () => {
    const roofs = new Set<number>();
    for (let x = 78; x <= 82; x++) for (let y = 76; y <= 80; y++) roofs.add(gridNo(x, y));
    const sim = newCombatSim(content, [], 3, roofs);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.NORTH);
    setSoldierHeight(t, merc, ON_THE_ROOF);
    expect(merc.level).toBe(ROOF);
    const lastSeenAt = gridNo(80, 82);
    const bystander = spawnSoldier(sim, 40, Team.CIV, lastSeenAt, Direction.NORTH);
    bystander.neutral = true;
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 94), Direction.NORTH);
    enemy.inv[InvSlot.HAND] = createItem(content.items, item('HAND_GRENADE'), 100);
    enemy.life = enemy.lifeMax / 2;
    enemy.oppList[merc.id] = Opp.SEEN_LAST_TURN;
    enemy.lastKnownOpp[merc.id] = lastSeenAt;
    enemy.lastKnownOppLevel[merc.id] = GROUND;
    const toss = checkIfTossPossible(t, enemy);
    expect(toss.possible).toBe(true);
    expect(toss.targetLevel).toBe(GROUND);
    expect(toss.target).toBe(lastSeenAt);
  });

  it('passes up, underground above easy difficulty, a spot next to a lone opponent that it takes on the surface', () => {
    const MEDIUM_DIFFICULTY = 2;
    const opponentAt = gridNo(80, 80);
    const besideHim = gridNo(81, 80);
    const toss = (underground: boolean) => {
      const sim = newCombatSim(content);
      const t = sim.state;
      Object.assign(t.options, { difficulty: MEDIUM_DIFFICULTY });
      t.lighting.underground = underground;
      const margin = content.items.byName.get('HAND_GRENADE')?.explosive?.blast?.radius ?? 0;
      expect(margin).toBeGreaterThan(1);
      spawnSoldier(sim, 0, Team.OUR, opponentAt, Direction.SOUTH);
      spawnSoldier(sim, 21, Team.ENEMY, opponentAt - margin, Direction.EAST);
      const bystander = spawnSoldier(sim, 40, Team.CIV, besideHim, Direction.NORTH);
      bystander.neutral = true;
      const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 90), Direction.NORTH);
      enemy.inv[InvSlot.HAND] = createItem(content.items, item('HAND_GRENADE'), 100);
      enemy.life = enemy.lifeMax / 2;
      sim.lookAround();
      return checkIfTossPossible(t, enemy);
    };
    const onSurface = toss(false);
    expect(onSurface.possible).toBe(true);
    expect(onSurface.target).toBe(besideHim);
    expect(toss(true).possible).toBe(false);
  });

  it('fires a second LAW after the first: the chance to get through takes the LAW last fired, with the impact of 80 its weapon model sets', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 90), Direction.NORTH, { gun: 'ROCKET_LAUNCHER' });
    enemy.attackingWeapon = item('ROCKET_LAUNCHER');
    enemy.ai.morale = AiMorale.WORRIED;
    enemy.life = enemy.lifeMax / 2;
    sim.lookAround();
    const toss = checkIfTossPossible(sim.state, enemy);
    expect(toss.possible).toBe(true);
    expect(toss.target).toBe(merc.gridNo);
  });
});

describe('canNPCAttack', () => {
  it('refuses a soldier without any weapon', () => {
    const t = newState();
    const enemy = spawn(t, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH, false);
    expect(canNPCAttack(t, enemy)).toBe(NoShoot.NOWEAPON);
  });

  it('draws a pocketed gun into the hand', () => {
    const t = newState();
    const enemy = spawn(t, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH, false);
    enemy.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('GLOCK_17'), 100);
    expect(canNPCAttack(t, enemy)).toBe(CAN_ATTACK);
    expect(enemy.inv[InvSlot.HAND]?.item).toBe(item('GLOCK_17'));
    expect(enemy.inv[InvSlot.BIGPOCK2]?.item).toBe(0);
  });

  it('reloads an empty gun from a pocket and pays for it in combat', () => {
    const t = newState();
    const enemy = spawn(t, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH);
    t.inCombat = true;
    const gun = enemy.inv[InvSlot.HAND];
    if (!gun) throw new Error('no gun');
    gun.gunShotsLeft = 0;
    enemy.inv[InvSlot.SMALLPOCK3] = createItems(content.items, item('CLIP9_15'), 100, 2);
    const before = enemy.actionPoints;
    expect(canNPCAttack(t, enemy)).toBe(CAN_ATTACK);
    expect(gun.gunShotsLeft).toBe(15);
    expect(enemy.inv[InvSlot.SMALLPOCK3]?.count).toBe(1);
    expect(before - enemy.actionPoints).toBe(AP.RELOAD_GUN);
  });
});

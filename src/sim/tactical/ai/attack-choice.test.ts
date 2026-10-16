import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { syntheticWorld } from '../../../content/world/synthetic.ts';
import { Rng } from '../../../core/rng.ts';
import { createItem, createItems } from '../../items/object.ts';
import { initNewSoldierAnim, states } from '../animation.ts';
import { minAPsToAttack } from '../combat/ap.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { setSoldierPosition } from '../movement.ts';
import { Opp } from '../perception/opp.ts';
import { allTeamsLookForAll } from '../perception/sight.ts';
import { AP, calcActionPoints } from '../points.ts';
import { createSoldier, type Soldier, Team } from '../soldier.ts';
import { createTacticalState, registerSoldier, type TacticalState } from '../state.ts';
import { CAN_ATTACK, calcBestShot, canNPCAttack, NoShoot } from './attack-choice.ts';

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
  s.actionPoints = calcActionPoints(content, s);
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

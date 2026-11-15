import { beforeAll, describe, expect, it } from 'vitest';
import {
  arEnv,
  arSoldier,
  arState,
  enemySoldier,
  militiaSoldier,
  progressFor,
  scripted,
} from '../../../../../tests/support/autoresolve.ts';
import { loadTestContent } from '../../../../../tests/support/tactical.ts';
import type { TacticalContent } from '../../../tactical/content.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from '../../../tactical/narrative/port.ts';
import { Body } from '../../../tactical/soldier.ts';
import { reduceCreatureDamage, targetHit } from './landing.ts';
import { type ArCell, CellFlag } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_PROFILE = 7;
const ATTRIBUTE_SUBPOINTS = 50;
const STAT_LINE_ROLL = 0;
const STAT_LINE_RANGE = 100;
const OTHER_PROFILE = 8;

function cell(cells: readonly ArCell[], i: number): ArCell {
  const c = cells[i];
  if (!c) throw new Error(`no cell ${i}`);
  return c;
}

function battle() {
  const profiles = new Map([
    [MERC_PROFILE, progressFor(MERC_PROFILE)],
    [OTHER_PROFILE, progressFor(OTHER_PROFILE)],
  ]);
  const ar = arState({
    mercs: [{ soldier: arSoldier(content, { profile: MERC_PROFILE }) }, { soldier: arSoldier(content, { profile: OTHER_PROFILE }) }],
    militia: [militiaSoldier(content)],
    enemies: [{ soldier: enemySoldier(content, { life: 30 }) }],
  });
  const enemy = cell(ar.enemies, 0);
  enemy.attack = 400;
  enemy.defence = 300;
  ar.enemyAttack = 400;
  ar.enemyDefence = 300;
  return { ar, enemy, profiles };
}

describe('targetHit', () => {
  it('reduces creature damage by body type', () => {
    expect(reduceCreatureDamage(Body.YAM_MONSTER, 13)).toBe(3);
    expect(reduceCreatureDamage(Body.AM_MONSTER, 13)).toBe(2);
    expect(reduceCreatureDamage(Body.QUEENMONSTER, 13)).toBe(2);
    expect(reduceCreatureDamage(Body.LARVAE_MONSTER, 13)).toBe(13);
    expect(reduceCreatureDamage(Body.REGMALE, 13)).toBe(13);
  });

  it('lets a conscious merc gain agility when a bullet lands with damage 0', () => {
    const { ar, profiles } = battle();
    const merc = cell(ar.mercs, 0);
    merc.attackers[0] = { side: 'enemy', index: 0 };
    merc.hitDamage[0] = 0;
    const pre = scripted([], 99);
    const fx = scripted([], 0);
    targetHit(arEnv(content, { pre, fx, profiles }), ar, merc, 0);
    expect(pre.requested).toEqual([100, 100, 100, 100, 100]);
    expect(fx.requested).toEqual([8]);
  });

  it('queues the line of a stat point through the campaign\'s narrative port, its quarter roll drawn on the cosmetic stream (ChangeStat, deviation "Autoresolve cosmetic draws")', () => {
    const { ar, profiles } = battle();
    const merc = cell(ar.mercs, 0);
    merc.attackers[0] = { side: 'enemy', index: 0 };
    merc.hitDamage[0] = 0;
    const progress = profiles.get(MERC_PROFILE);
    if (!progress) throw new Error('no profile');
    progress.gains.agility = ATTRIBUTE_SUBPOINTS - 1;
    const said: [number, string, number][] = [];
    const narrative: NarrativePort = {
      ...NO_NARRATIVE_PORT,
      sayStatChange: (s, stat, change) => said.push([s.id, stat, change]) > 0,
      cosmeticPick: () => {
        throw new Error('the roll belongs to the cosmetic stream');
      },
    };
    const fx = scripted([], STAT_LINE_ROLL);
    targetHit({ ...arEnv(content, { pre: scripted([], 0), fx, profiles }), narrative }, ar, merc, 0);
    expect(fx.requested).toEqual([STAT_LINE_RANGE, 8]);
    expect(said).toEqual([[merc.soldier.id, 'agility', 1]]);
    expect(ar.statEvents).toEqual([expect.objectContaining({ soldier: merc.soldier.id, stat: 'agility', change: 1, queued: true })]);
  });

  it('credits the kill to the slot owner and one assist from the other slots', () => {
    const { ar, enemy, profiles } = battle();
    enemy.attackers[0] = { side: 'militia', index: 0 };
    enemy.attackers[1] = { side: 'merc', index: 0 };
    enemy.attackers[2] = { side: 'merc', index: 1 };
    enemy.hitDamage[1] = 40;
    const pre = scripted([], 99);
    targetHit(arEnv(content, { pre, profiles }), ar, enemy, 1);
    expect(enemy.soldier.life).toBe(0);
    expect(ar.aliveEnemies).toBe(0);
    expect(ar.enemyDefence).toBe(0);
    expect(enemy.attack).toBe(0);
    expect(profiles.get(MERC_PROFILE)?.kills).toBe(1);
    expect(profiles.get(MERC_PROFILE)?.shotsHit).toBe(1);
    expect(profiles.get(OTHER_PROFILE)?.assists).toBe(1);
    expect(cell(ar.militia, 0).militiaKills).toBe(0);
    expect(ar.playerKills).toBe(1);
    expect(pre.requested).toEqual([100, 100, 100, 100, 100, 100]);
  });

  it('ignores a duplicate killer in the assist slots and credits militia assists', () => {
    const { ar, enemy, profiles } = battle();
    enemy.attackers[0] = { side: 'militia', index: 0 };
    enemy.attackers[1] = { side: 'merc', index: 0 };
    enemy.attackers[2] = { side: 'merc', index: 0 };
    enemy.hitDamage[1] = 40;
    targetHit(arEnv(content, { pre: scripted([], 99), profiles }), ar, enemy, 1);
    expect(cell(ar.militia, 0).militiaKills).toBe(1);
    expect(profiles.get(MERC_PROFILE)?.assists).toBe(0);
  });

  it('gives militia two kill points', () => {
    const { ar, enemy, profiles } = battle();
    enemy.attackers[0] = { side: 'militia', index: 0 };
    enemy.hitDamage[0] = 40;
    targetHit(arEnv(content, { profiles }), ar, enemy, 0);
    expect(cell(ar.militia, 0).militiaKills).toBe(2);
  });

  it('adds the damage to bleeding against the new life and clears retreat on a fall', () => {
    const { ar, profiles } = battle();
    const merc = cell(ar.mercs, 1);
    merc.flags |= CellFlag.RETREATING;
    merc.attackers[2] = { side: 'enemy', index: 0 };
    merc.hitDamage[2] = 50;
    targetHit(arEnv(content, { pre: scripted([], 99), profiles }), ar, merc, 2);
    expect(merc.soldier.life).toBe(10);
    expect(merc.soldier.bleeding).toBe(50);
    expect(merc.flags & CellFlag.RETREATING).toBe(0);
    merc.attackers[0] = { side: 'enemy', index: 0 };
    merc.hitDamage[0] = 5;
    targetHit(arEnv(content, { pre: scripted([], 99), profiles }), ar, merc, 0);
    expect(merc.soldier.life).toBe(5);
    expect(merc.soldier.bleeding).toBe(55);
  });

  it('draws nothing for kill experience when the target stands on map level 0 (quirk Q3)', () => {
    const { ar, enemy, profiles } = battle();
    enemy.attackers[0] = { side: 'merc', index: 0 };
    enemy.hitDamage[0] = 40;
    const pre = scripted([], 99);
    targetHit(arEnv(content, { pre, profiles }), ar, enemy, 0);
    expect(pre.requested).toEqual([100, 100, 100, 100, 100, 100]);
    expect(profiles.get(MERC_PROFILE)?.kills).toBe(1);
  });
});

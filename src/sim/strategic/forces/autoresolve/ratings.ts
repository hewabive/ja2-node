// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc DetermineTeamLeader, ResetNextAttackCounter, CalculateAttackValues.
// See docs/19 §2.5.

import { idiv, u16 } from '../../../../core/int.ts';
import type { RandomStream } from '../../../tactical/combat/context.ts';
import type { Soldier } from '../../../tactical/soldier.ts';
import { type ArCell, type AutoresolveState, CellFlag, CellGroup, hasFlag } from './state.ts';

const MAX_RATING = 1000;
const MAX_TIMER_BASE = 800;
const TIMER_BASE_MS = 1000;
const TIMER_RATING_FACTOR = 5;
const TIMER_RANDOM_SPAN = 2000;
const CREATURE_TIMER_NUMERATOR = 8;
const CREATURE_TIMER_DENOMINATOR = 10;
const EPC_DEFENCE = 1000;
const LEADERSHIP_BONUS_DIVISOR = 10;
const MERC_BOOST_DIVISOR = 4;
const BREATH_PENALTY_DIVISOR = 3;
const HEAD_START_PERCENT = 60;
const NO_BEST_TIMER = 0xffff;

const MERC_LATE_ENTRY = { after: 8, offset: 8, step: 2000 } as const;
const MILITIA_LATE_ENTRY = { after: 6, offset: 4, step: 2000 } as const;
const ENEMY_LATE_ENTRY = { after: 4, offset: 4, step: 1000 } as const;

export function determineTeamLeaders(ar: AutoresolveState): void {
  ar.playerLeadership = 0;
  let leader: ArCell | null = null;
  for (const c of [...ar.mercs, ...ar.militia]) {
    if (ar.playerLeadership >= c.soldier.stats.leadership) continue;
    ar.playerLeadership = c.soldier.stats.leadership;
    leader = c;
  }
  if (leader) leader.flags |= CellFlag.TEAMLEADER;
  ar.enemyLeadership = 0;
  leader = null;
  for (const c of ar.enemies) {
    if (ar.enemyLeadership >= c.soldier.stats.leadership) continue;
    ar.enemyLeadership = c.soldier.stats.leadership;
    leader = c;
  }
  if (leader) leader.flags |= CellFlag.TEAMLEADER;
}

export function resetNextAttackCounter(pre: RandomStream, c: ArCell): void {
  const base = Math.min(MAX_RATING - c.attack, MAX_TIMER_BASE);
  c.nextAttack = u16(TIMER_BASE_MS + base * TIMER_RATING_FACTOR + pre.int(TIMER_RANDOM_SPAN - c.attack));
  if (hasFlag(c, CellGroup.CREATURE)) c.nextAttack = u16(idiv(c.nextAttack * CREATURE_TIMER_NUMERATOR, CREATURE_TIMER_DENOMINATOR));
}

const attackStats = (s: Soldier): number => s.stats.strength + s.stats.dexterity + s.stats.wisdom + s.stats.marksmanship + s.morale;
const defenceStats = (s: Soldier): number => s.stats.agility + s.stats.wisdom + s.breathMax + s.stats.medical + s.morale;

function mercAttack(s: Soldier): number {
  let attack = u16(attackStats(s));
  if (attack < MAX_RATING) attack = u16(attack + idiv(MAX_RATING - attack, MERC_BOOST_DIVISOR));
  const breathPercent = u16(100 - idiv(100 - s.breathMax, BREATH_PENALTY_DIVISOR));
  return u16(idiv(attack * breathPercent, 100));
}

const otherAttack = (s: Soldier): number => u16(idiv(u16(attackStats(s)) * s.breath, 100));

function applyBonus(c: ArCell, attack: number, leadership: number, advantage: number): void {
  const bonus = u16(100 + idiv(leadership, LEADERSHIP_BONUS_DIVISOR) + advantage);
  c.attack = u16(idiv(attack * bonus, 100));
  c.defence = u16(idiv(u16(defenceStats(c.soldier)) * bonus, 100));
}

function capRatings(c: ArCell): void {
  c.attack = Math.min(c.attack, MAX_RATING);
  c.defence = Math.min(c.defence, MAX_RATING);
}

function lateEntry(c: ArCell, i: number, rule: { readonly after: number; readonly offset: number; readonly step: number }): void {
  if (i > rule.after) c.nextAttack = u16(c.nextAttack + u16((i - rule.offset) * rule.step));
}

export function calculateAttackValues(pre: RandomStream, ar: AutoresolveState): void {
  let best = NO_BEST_TIMER;
  ar.playerAttack = 0;
  ar.playerDefence = 0;
  ar.mercs.forEach((c, i) => {
    if (c.soldier.life === 0) return;
    applyBonus(c, mercAttack(c.soldier), ar.playerLeadership, ar.playerDefenceAdvantage);
    if (hasFlag(c, CellFlag.EPC)) {
      c.attack = 0;
      c.defence = EPC_DEFENCE;
    }
    capRatings(c);
    ar.playerAttack = u16(ar.playerAttack + c.attack);
    ar.playerDefence = u16(ar.playerDefence + c.defence);
    resetNextAttackCounter(pre, c);
    lateEntry(c, i, MERC_LATE_ENTRY);
    best = Math.min(best, c.nextAttack);
  });
  ar.militia.forEach((c, i) => {
    applyBonus(c, otherAttack(c.soldier), ar.playerLeadership, ar.playerDefenceAdvantage);
    capRatings(c);
    ar.playerAttack = u16(ar.playerAttack + c.attack);
    ar.playerDefence = u16(ar.playerDefence + c.defence);
    resetNextAttackCounter(pre, c);
    lateEntry(c, i, MILITIA_LATE_ENTRY);
    best = Math.min(best, c.nextAttack);
  });
  ar.enemyAttack = 0;
  ar.enemyDefence = 0;
  ar.enemies.forEach((c, i) => {
    applyBonus(c, otherAttack(c.soldier), ar.enemyLeadership, ar.enemyDefenceAdvantage);
    capRatings(c);
    ar.enemyAttack = u16(ar.enemyAttack + c.attack);
    ar.enemyDefence = u16(ar.enemyDefence + c.defence);
    resetNextAttackCounter(pre, c);
    if (!hasFlag(c, CellGroup.CREATURE)) lateEntry(c, i, ENEMY_LATE_ENTRY);
    best = Math.min(best, c.nextAttack);
  });
  const headStart = u16(idiv(best * HEAD_START_PERCENT, 100));
  for (const c of [...ar.mercs, ...ar.militia, ...ar.enemies]) c.nextAttack = u16(c.nextAttack - headStart);
}

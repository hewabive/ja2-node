// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Campaign.cc StatChange, ProcessStatChange, ChangeStat, ProcessUpdateStats, SubpointsPerPoint,
// @src HandleAnyStatChangesAfterAttack. See docs/11 §10.

import { type ProfileProgress, profileProgress, STAT_KEYS, StatKind } from '../profiles.ts';
import { NO_PROFILE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';
import { CONSCIOUSNESS } from './types.ts';

export const StatCause = { SUCCESS: 0, FAILURE: 1, TRAINING: 2 } as const;

const Evolution = { NORMAL: 0, NONE: 1, DEVOLVE: 2 } as const;
const ATTRIBS_SUBPOINTS = 50;
const SKILLS_SUBPOINTS = 25;
const LEVEL_SUBPOINTS = 350;
const TRAINING_RATING_CAP = 85;
const MAX_STAT_VALUE = 100;
const MAX_EXP_LEVEL = 10;

const u16 = (v: number) => v & 0xffff;

function subpointsPerPoint(stat: number, expLevel: number): number {
  switch (stat) {
    case StatKind.HEALTH:
    case StatKind.AGILITY:
    case StatKind.DEXTERITY:
    case StatKind.WISDOM:
    case StatKind.STRENGTH:
      return ATTRIBS_SUBPOINTS;
    case StatKind.EXPERIENCE:
      return u16(LEVEL_SUBPOINTS * expLevel);
    default:
      return SKILLS_SUBPOINTS;
  }
}

const PHYSICAL = new Set<number>([StatKind.HEALTH, StatKind.AGILITY, StatKind.DEXTERITY, StatKind.STRENGTH]);
const CAN_DROP_TO_ZERO = new Set<number>([
  StatKind.MEDICAL,
  StatKind.EXPLOSIVES,
  StatKind.MECHANICAL,
  StatKind.MARKSMANSHIP,
  StatKind.LEADERSHIP,
]);
const ZERO_MINIMUM = new Set<number>([StatKind.MEDICAL, StatKind.EXPLOSIVES, StatKind.MECHANICAL, StatKind.MARKSMANSHIP]);

function processStatChange(t: TacticalState, p: ProfileProgress, stat: number, chances: number, cause: number): void {
  if (p.evolution === Evolution.NONE) return;
  if (cause === StatCause.TRAINING && p.evolution === Evolution.DEVOLVE) return;
  if (chances === 0) return;
  const key = STAT_KEYS[stat];
  if (!key) return;
  const spp = subpointsPerPoint(stat, p.stats.experience);
  const sppLevel = subpointsPerPoint(StatKind.EXPERIENCE, p.stats.experience);
  const rating = p.stats[key];
  const wisdomAffects = cause === StatCause.TRAINING || !PHYSICAL.has(stat);
  if (rating <= 0) return;
  const wisdomTerm = () => p.stats.wisdom + Math.trunc(p.gains.wisdom / subpointsPerPoint(StatKind.WISDOM, p.stats.experience)) - 50;
  let change = 0;
  for (let i = 0; i < chances; i++) {
    const effective = rating + Math.trunc(p.gains[key] / spp);
    if (p.evolution === Evolution.NORMAL) {
      if (cause === StatCause.FAILURE && p.gains[key] + 1 >= spp) break;
      let chance: number;
      if (stat !== StatKind.EXPERIENCE) {
        chance = u16(100 - effective);
        if (cause === StatCause.TRAINING && effective >= TRAINING_RATING_CAP) chance = 0;
      } else chance = u16(100 - 10 * effective);
      if (chance > 0 && wisdomAffects) chance = u16(chance + Math.trunc((chance * wisdomTerm()) / 100));
      if (chance > 99) chance = 99;
      if (t.pre.int(100) < chance) {
        p.gains[key]++;
        change++;
        if (stat !== StatKind.EXPERIENCE && cause !== StatCause.TRAINING) {
          const level = p.stats.experience + Math.trunc(p.gains.experience / sppLevel);
          if (level < MAX_EXP_LEVEL && (cause !== StatCause.FAILURE || p.gains.experience + 1 < sppLevel)) p.gains.experience++;
        }
      }
    } else {
      let chance = 0;
      if (stat !== StatKind.EXPERIENCE) chance = u16(CAN_DROP_TO_ZERO.has(stat) ? effective : effective - 1);
      else {
        chance = u16(10 * (effective - 1));
        if (chance > 0 && wisdomAffects) chance = u16(chance - Math.trunc((chance * wisdomTerm()) / 100));
        if (chance < 1) chance = 1;
      }
      if (t.pre.int(100) < chance) {
        p.gains[key]--;
        change--;
        if (stat !== StatKind.EXPERIENCE && cause !== StatCause.TRAINING) {
          const level = p.stats.experience + Math.trunc(p.gains.experience / sppLevel);
          if (level > 1) p.gains.experience--;
        }
      }
    }
  }
  if (cause !== StatCause.TRAINING) {
    p.statChangeChances[stat] = u16((p.statChangeChances[stat] ?? 0) + chances);
    p.statChangeSuccesses[stat] = u16((p.statChangeSuccesses[stat] ?? 0) + Math.abs(change));
  }
}

function changeStat(t: TacticalState, p: ProfileProgress, s: Soldier, stat: number, points: number): void {
  const key = STAT_KEYS[stat];
  if (!key || points === 0) return;
  const spp = subpointsPerPoint(stat, p.stats.experience);
  p.stats[key] += points;
  p.gains[key] %= spp;
  if (key === 'lifeMax') s.lifeMax = p.stats.lifeMax;
  else s.stats[key] = p.stats[key];
  if (stat === StatKind.HEALTH) {
    p.life = Math.max(OKLIFE, p.life + points);
    s.life = Math.max(OKLIFE, s.life + points);
  }
  t.events.push({ type: 'statChanged', soldier: s.id, stat: key, change: points });
}

export function processUpdateStats(t: TacticalState, s: Soldier): void {
  if (t.turn.attackBusyCount > 0 && s.placed && t.inCombat) return;
  if (s.team !== Team.OUR || s.profile === NO_PROFILE) return;
  if (s.life < OKLIFE) return;
  const p = profileProgress(t, s.profile);
  if (!p) return;
  for (let stat: number = StatKind.HEALTH; stat <= StatKind.LEADERSHIP; stat++) {
    const key = STAT_KEYS[stat];
    if (!key) continue;
    const min = stat === StatKind.HEALTH ? OKLIFE : ZERO_MINIMUM.has(stat) ? 0 : 1;
    const max = stat === StatKind.EXPERIENCE ? MAX_EXP_LEVEL : MAX_STAT_VALUE;
    let points = Math.trunc(p.gains[key] / subpointsPerPoint(stat, p.stats.experience));
    if (p.stats[key] + points > max) {
      points = max - p.stats[key];
      p.gains[key] = 0;
    } else if (p.stats[key] + points < min) {
      points = min - p.stats[key];
      p.gains[key] = 0;
    }
    if (points !== 0) changeStat(t, p, s, stat, points);
  }
}

export function statChange(t: TacticalState, s: Soldier, stat: number, chances: number, cause: number): void {
  if (s.team !== Team.OUR || s.profile === NO_PROFILE) return;
  if (s.life < CONSCIOUSNESS) return;
  const p = profileProgress(t, s.profile);
  if (!p) return;
  processStatChange(t, p, stat, chances & 0xffff, cause);
  processUpdateStats(t, s);
}

export function handleAnyStatChangesAfterAttack(t: TacticalState): void {
  for (const s of teamMembers(t, Team.OUR)) processUpdateStats(t, s);
}

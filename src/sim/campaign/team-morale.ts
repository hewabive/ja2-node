// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Morale.cc HourlyMoraleUpdate, DecayTacticalMoraleModifiers, DecayStrategicMoraleModifiers,
// @src DecayTacticalMorale, DecayStrategicMorale; Strategic/Strategic_Merc_Handler.cc UpdateBuddyAndHatedCounters;
// @src TacticalAI/AIUtils.cc DistanceToClosestFriend; Soldier_Profile.cc WhichHated.

import { sameSector } from '../../content/strategic/sector-ids.ts';
import { clamp, i8, idiv } from '../../core/int.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import { effectiveLeadership } from '../tactical/skills.ts';
import { NO_PROFILE, OKLIFE, Personality } from '../tactical/soldier.ts';
import { type QuoteName, SpecialProfile } from './contracts/quotes.ts';
import { handleMoraleEvent, type MoraleContext, MoraleEvent, refreshMercMorale } from './morale.ts';
import { BUDDY_OPINION, BuddySlot, HATED_OPINION, HatedSlot, whichHated } from './relations/relations.ts';
import { MercKind, type RosterMerc } from './roster.ts';

const MORALE_MOD_MAX = 50;
const HOURS_BETWEEN_STRATEGIC_DECAY = 3;
const PHOBIC_LIMIT = -20;
const NERVOUS_MORALE = 50;
const NERVOUS_RADIUS = 10;
const NO_FRIEND_DISTANCE = 1000;
const NEAR_FRIEND_DISTANCE = 1;
const LEADERSHIP_BASE = 50;
const LEADERSHIP_STEP = 10;
const TEAM_MOD_STEP = 10;
const TIME_BETWEEN_HATED_COMPLAINTS = 24;
const LEARN_TO_LIKE_PASS = BuddySlot.LEARNED_TO_LIKE + 1;
const QUIT_ON_LEARNED_HATE_NPCS: ReadonlySet<number> = new Set([
  SpecialProfile.DEVIN,
  SpecialProfile.SLAY,
  SpecialProfile.IGGY,
  SpecialProfile.CONRAD,
]);
const COMPLAINT_QUOTES: Readonly<Record<number, QuoteName>> = {
  [HatedSlot.SLOT1]: 'HATED_MERC_ONE',
  [HatedSlot.SLOT2]: 'HATED_MERC_TWO',
  [HatedSlot.LEARNED_TO_HATE]: 'LEARNED_TO_HATE_MERC',
};
const QUIT_QUOTES: Readonly<Record<number, QuoteName>> = {
  [HatedSlot.SLOT1]: 'MERC_QUIT_HATED1',
  [HatedSlot.SLOT2]: 'MERC_QUIT_HATED2',
  [HatedSlot.LEARNED_TO_HATE]: 'MERC_QUIT_LEARN_TO_HATE',
};

export type TeamMoraleEvent =
  | { readonly type: 'complaint'; readonly soldier: number; readonly about: number; readonly quote: QuoteName }
  | { readonly type: 'quit'; readonly soldier: number; readonly about: number; readonly quote: QuoteName };

export interface TeamMoraleState {
  strategicDecayCounter: number;
}

export interface TeamMoraleContext extends MoraleContext {
  groupInMotion(groupId: number): boolean;
  squadSize(squad: number): number;
  spacesAway(a: number, b: number): number;
  readonly morale: TeamMoraleState;
  readonly emit: (e: TeamMoraleEvent) => void;
  readonly stopTimeCompression: () => void;
}

export function createTeamMoraleState(): TeamMoraleState {
  return { strategicDecayCounter: 0 };
}

const outOfAction = (m: RosterMerc) =>
  m.assignment === Assignment.IN_TRANSIT || m.assignment === Assignment.ASSIGNMENT_DEAD || m.assignment === Assignment.ASSIGNMENT_POW;

function inMotion(ctx: TeamMoraleContext, m: RosterMerc): boolean {
  return m.groupId !== 0 && ctx.groupInMotion(m.groupId);
}

function together(ctx: TeamMoraleContext, m: RosterMerc, other: RosterMerc, sameGroupOnly: boolean): boolean {
  if (sameGroupOnly) return m.groupId === other.groupId;
  if (!sameSector(other.sector, m.sector)) return false;
  return !inMotion(ctx, other);
}

interface TeamOpinion {
  readonly sum: number;
  readonly members: number;
  readonly foundHated: boolean;
  readonly leadership: number;
}

function opinionOf(p: ProfileProgress, other: RosterMerc): { readonly opinion: number; readonly hatedNow: boolean } {
  let opinion = p.opinions[other.profile] ?? 0;
  if (opinion !== HATED_OPINION) return { opinion, hatedNow: false };
  const hated = whichHated(p, other.profile);
  let hatedTime = 0;
  if (hated >= HatedSlot.LEARNED_TO_HATE) return { opinion, hatedNow: true };
  if (hated >= HatedSlot.SLOT1) {
    hatedTime = p.hatedTime[hated] ?? 0;
    if ((p.hatedCount[hated] ?? 0) <= hatedTime) return { opinion, hatedNow: true };
  }
  if (hatedTime !== 0) opinion = idiv(opinion * (hatedTime - (p.hatedCount[hated] ?? 0)), hatedTime);
  return { opinion, hatedNow: false };
}

function teamOpinion(ctx: TeamMoraleContext, m: RosterMerc, p: ProfileProgress): TeamOpinion {
  const sameGroupOnly = inMotion(ctx, m);
  let sum = 0;
  let members = 0;
  let leadership = effectiveLeadership(m.soldier);
  for (const other of ctx.team) {
    if (other === m || other.profile === NO_PROFILE || other.asleep || outOfAction(other)) continue;
    if (!together(ctx, m, other, sameGroupOnly)) continue;
    const { opinion, hatedNow } = opinionOf(p, other);
    if (hatedNow) return { sum, members, foundHated: true, leadership };
    sum += opinion;
    members = i8(members + 1);
    leadership = Math.max(leadership, effectiveLeadership(other.soldier));
  }
  return { sum, members, foundHated: false, leadership };
}

function actualTeamOpinion(o: TeamOpinion): number {
  if (o.foundHated) return HATED_OPINION;
  if (o.members <= 0) return 0;
  const averageOpinion = i8(idiv(o.sum, o.members));
  const leadershipBonus = idiv(o.leadership - LEADERSHIP_BASE, LEADERSHIP_STEP);
  return clamp(i8(averageOpinion + leadershipBonus), HATED_OPINION, BUDDY_OPINION);
}

function shiftTeamMorale(m: RosterMerc, actual: number): void {
  const s = m.soldier;
  const diff = i8(actual - s.teamMoraleMod);
  const change = diff > 0 ? 1 + idiv(diff, TEAM_MOD_STEP) : diff < 0 ? -1 + idiv(diff, TEAM_MOD_STEP) : 0;
  s.teamMoraleMod = clamp(i8(s.teamMoraleMod + change), -MORALE_MOD_MAX, MORALE_MOD_MAX);
}

function applyDelayedStrategicMorale(m: RosterMerc): void {
  const s = m.soldier;
  if (s.delayedStrategicMoraleMod === 0) return;
  s.strategicMoraleMod = clamp(i8(s.strategicMoraleMod + s.delayedStrategicMoraleMod), -MORALE_MOD_MAX, MORALE_MOD_MAX);
  s.delayedStrategicMoraleMod = 0;
}

export function decayStrategicMorale(m: RosterMerc): void {
  const s = m.soldier;
  const mod = s.strategicMoraleMod;
  s.strategicMoraleMod = mod > 0 ? Math.max(0, mod - (8 - idiv(mod, 10))) : Math.min(0, mod + (6 + idiv(mod, 10)));
}

export function decayTacticalMorale(m: RosterMerc): void {
  const s = m.soldier;
  const mod = s.tacticalMoraleMod;
  if (mod === 0) return;
  s.tacticalMoraleMod = mod > 0 ? Math.max(0, mod - (8 - idiv(mod, 10))) : Math.min(0, mod + (6 + idiv(mod, 10)));
}

function decayStrategicMoraleModifiers(ctx: TeamMoraleContext): void {
  for (const m of ctx.team) {
    if (m.profile === NO_PROFILE || m.assignment === Assignment.IN_TRANSIT || m.assignment === Assignment.ASSIGNMENT_DEAD) continue;
    if (m.assignment === Assignment.ASSIGNMENT_POW && m.soldier.strategicMoraleMod < 0) continue;
    decayStrategicMorale(m);
    refreshMercMorale(ctx, m);
  }
}

export function hourlyMoraleUpdate(ctx: TeamMoraleContext): void {
  for (const m of ctx.team) {
    if (m.profile === NO_PROFILE || m.asleep || outOfAction(m)) continue;
    const p = ctx.profiles.get(m.profile);
    if (!p) continue;
    shiftTeamMorale(m, actualTeamOpinion(teamOpinion(ctx, m, p)));
    applyDelayedStrategicMorale(m);
    refreshMercMorale(ctx, m);
  }
  ctx.morale.strategicDecayCounter = i8(ctx.morale.strategicDecayCounter + 1);
  if (ctx.morale.strategicDecayCounter === HOURS_BETWEEN_STRATEGIC_DECAY) {
    ctx.morale.strategicDecayCounter = 0;
    decayStrategicMoraleModifiers(ctx);
  }
}

function distanceToClosestFriend(ctx: TeamMoraleContext, m: RosterMerc): number {
  let min = NO_FRIEND_DISTANCE;
  for (const other of ctx.team) {
    if (other === m) continue;
    if (m.soldier.placed) {
      if (!other.soldier.placed || other.soldier.life < OKLIFE) continue;
    } else if (!sameSector(m.sector, other.sector) || other.soldier.life < OKLIFE) continue;
    else return NEAR_FRIEND_DISTANCE;
    min = Math.min(min, ctx.spacesAway(m.soldier.gridNo, other.soldier.gridNo));
  }
  return min;
}

function nervousAndAlone(ctx: TeamMoraleContext, m: RosterMerc): boolean {
  if (m.groupId !== 0 && m.assignment <= Assignment.SQUAD_20 && ctx.groupInMotion(m.groupId)) return ctx.squadSize(m.assignment) === 1;
  if (m.soldier.placed) return distanceToClosestFriend(ctx, m) > NERVOUS_RADIUS;
  return !ctx.team.some((other) => other !== m && sameSector(other.sector, m.sector));
}

function personalityOf(m: RosterMerc): number {
  return m.profileRecord?.personalityTrait ?? m.soldier.personalityTrait;
}

function phobicDecay(ctx: TeamMoraleContext, m: RosterMerc): boolean {
  const s = m.soldier;
  switch (personalityOf(m)) {
    case Personality.CLAUSTROPHOBIC:
      if (m.sector.z <= 0) return false;
      if (s.tacticalMoraleMod > PHOBIC_LIMIT) handleMoraleEvent(ctx, m, MoraleEvent.CLAUSTROPHOBE_UNDERGROUND, m.sector);
      return true;
    case Personality.NERVOUS:
      if (s.morale >= NERVOUS_MORALE || !nervousAndAlone(ctx, m)) return false;
      if (s.tacticalMoraleMod !== PHOBIC_LIMIT) handleMoraleEvent(ctx, m, MoraleEvent.NERVOUS_ALONE, m.sector);
      return true;
    default:
      return false;
  }
}

export function decayTacticalMoraleModifiers(ctx: TeamMoraleContext): void {
  for (const m of ctx.team) {
    if (m.profile === NO_PROFILE || m.assignment === Assignment.IN_TRANSIT || m.assignment === Assignment.ASSIGNMENT_DEAD) continue;
    if (m.assignment === Assignment.ASSIGNMENT_POW && m.soldier.tacticalMoraleMod < 0) continue;
    if (phobicDecay(ctx, m)) continue;
    decayTacticalMorale(m);
    refreshMercMorale(ctx, m);
  }
}

function quitsOverHatred(m: RosterMerc, learned: boolean): boolean {
  if (m.kind === MercKind.MERC) return true;
  if (m.kind !== MercKind.NPC) return false;
  return !learned || QUIT_ON_LEARNED_HATE_NPCS.has(m.profile);
}

function complain(ctx: TeamMoraleContext, m: RosterMerc, slot: number, about: number): void {
  ctx.emit({ type: 'complaint', soldier: m.id, about, quote: COMPLAINT_QUOTES[slot] ?? 'HATED_MERC_ONE' });
}

function quit(ctx: TeamMoraleContext, m: RosterMerc, slot: number, about: number): void {
  ctx.emit({ type: 'quit', soldier: m.id, about, quote: QUIT_QUOTES[slot] ?? 'MERC_QUIT_HATED1' });
}

interface Complaints {
  updated: boolean;
}

function tickComplaintTimer(p: ProfileProgress, c: Complaints): void {
  if (c.updated) return;
  p.timeTillNextHatedComplaint = p.timeTillNextHatedComplaint === 0 ? TIME_BETWEEN_HATED_COMPLAINTS - 1 : p.timeTillNextHatedComplaint - 1;
  c.updated = true;
}

function complainHalfway(count: number, time: number): boolean {
  const half = idiv(time, 2);
  return count > 0 && (count === half || (count < half && count % TIME_BETWEEN_HATED_COMPLAINTS === 0));
}

function hatedSlotPass(ctx: TeamMoraleContext, m: RosterMerc, p: ProfileProgress, slot: number, other: number, c: Complaints): void {
  if (p.hated[slot] !== other) return;
  const time = p.hatedTime[slot] ?? 0;
  let count = p.hatedCount[slot] ?? 0;
  if (count <= 0) {
    tickComplaintTimer(p, c);
    if (p.timeTillNextHatedComplaint === 0) complain(ctx, m, slot, other);
    return;
  }
  count--;
  p.hatedCount[slot] = count;
  if (count === 0 && m.soldier.placed && ctx.enemyInSector) {
    p.hatedCount[slot] = 1;
    return;
  }
  if (complainHalfway(count, time)) {
    complain(ctx, m, slot, other);
    ctx.stopTimeCompression();
    return;
  }
  if (count !== 0) return;
  if (quitsOverHatred(m, false)) quit(ctx, m, slot, other);
  else {
    complain(ctx, m, slot, other);
    p.timeTillNextHatedComplaint = TIME_BETWEEN_HATED_COMPLAINTS - 1;
  }
}

function learnedHatePass(ctx: TeamMoraleContext, m: RosterMerc, p: ProfileProgress, other: number, c: Complaints): void {
  if (p.learnToHate !== other) return;
  if (p.learnToHateCount <= 0) {
    tickComplaintTimer(p, c);
    if (p.timeTillNextHatedComplaint === 0) complain(ctx, m, HatedSlot.LEARNED_TO_HATE, other);
    return;
  }
  p.learnToHateCount--;
  if (p.learnToHateCount === 0 && m.soldier.placed && ctx.enemyInSector) p.learnToHateCount = 1;
  else if (complainHalfway(p.learnToHateCount, p.learnToHateTime)) {
    complain(ctx, m, HatedSlot.LEARNED_TO_HATE, other);
    ctx.stopTimeCompression();
  } else if (p.learnToHateCount === 0) {
    p.hated[HatedSlot.LEARNED_TO_HATE] = p.learnToHate;
    p.opinions[other] = HATED_OPINION;
    if (quitsOverHatred(m, true)) quit(ctx, m, HatedSlot.LEARNED_TO_HATE, other);
    else if (m.kind === MercKind.NPC) complain(ctx, m, HatedSlot.LEARNED_TO_HATE, other);
  }
  if (p.learnToHateCount < idiv(p.learnToHateTime, 2)) {
    const opinion = p.opinions[other] ?? 0;
    p.opinions[other] = i8(opinion + idiv(HATED_OPINION - opinion, p.learnToHateCount + 1));
  }
}

function learnToLikePass(p: ProfileProgress, other: number): void {
  if (p.learnToLikeCount <= 0 || p.learnToLike !== other) return;
  p.learnToLikeCount--;
  if (p.learnToLikeCount === 0) {
    p.buddies[BuddySlot.LEARNED_TO_LIKE] = p.learnToLike;
    p.opinions[other] = BUDDY_OPINION;
  } else if (p.learnToLikeCount < idiv(p.learnToLikeTime, 2)) {
    const opinion = p.opinions[other] ?? 0;
    p.opinions[other] = i8(opinion + idiv(BUDDY_OPINION - opinion, p.learnToLikeCount + 1));
  }
}

function onCombatAssignment(m: RosterMerc): boolean {
  return m.assignment < Assignment.ON_DUTY;
}

export function updateBuddyAndHatedCounters(ctx: TeamMoraleContext): void {
  for (const m of ctx.team) {
    if (!onCombatAssignment(m)) continue;
    const p = ctx.profiles.get(m.profile);
    if (!p) continue;
    const sameGroupOnly = inMotion(ctx, m);
    const complaints: Complaints = { updated: false };
    for (const other of ctx.team) {
      if (other === m || !onCombatAssignment(other) || !together(ctx, m, other, sameGroupOnly)) continue;
      const otherProfile = other.profile;
      for (let pass = HatedSlot.SLOT1; pass <= LEARN_TO_LIKE_PASS; pass++) {
        if (pass === HatedSlot.SLOT1 || pass === HatedSlot.SLOT2) hatedSlotPass(ctx, m, p, pass, otherProfile, complaints);
        else if (pass === HatedSlot.LEARNED_TO_HATE) learnedHatePass(ctx, m, p, otherProfile, complaints);
        else learnToLikePass(p, otherProfile);
      }
    }
  }
}

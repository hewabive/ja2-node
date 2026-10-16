// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Morale.cc HourlyMoraleUpdate, DecayTacticalMoraleModifiers, DecayStrategicMoraleModifiers,
// @src DecayTacticalMorale, DecayStrategicMorale; Strategic/Strategic_Merc_Handler.cc UpdateBuddyAndHatedCounters;
// @src TacticalAI/AIUtils.cc DistanceToClosestFriend; Soldier_Profile.cc WhichHated. See docs/11 §9, docs/18 §5.12.

import { sameSector } from '../../content/strategic/sector-ids.ts';
import { clamp } from '../../core/int.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import { effectiveLeadership } from '../tactical/skills.ts';
import { NO_PROFILE, OKLIFE, Personality } from '../tactical/soldier.ts';
import { handleMoraleEvent, type MoraleContext, MoraleEvent, refreshMercMorale } from './morale.ts';
import type { RosterMerc } from './roster.ts';

const MORALE_MOD_MAX = 50;
const HOURS_BETWEEN_STRATEGIC_DECAY = 3;
const PHOBIC_LIMIT = -20;
const NERVOUS_MORALE = 50;
const NERVOUS_RADIUS = 10;
const NO_FRIEND_DISTANCE = 1000;
const NEAR_FRIEND_DISTANCE = 1;
const BUDDY_OPINION = 25;
const HATED_OPINION = -25;
const LEADERSHIP_BASE = 50;
const LEADERSHIP_STEP = 10;
const TEAM_MOD_STEP = 10;
const TIME_BETWEEN_HATED_COMPLAINTS = 24;
const HatedSlot = { NOT_FOUND: -1, SLOT1: 0, SLOT2: 1, LEARNED_TO_HATE: 2, COUNT: 3 } as const;
const LEARNED_TO_LIKE_SLOT = 2;
const LEARN_TO_LIKE_PASS = LEARNED_TO_LIKE_SLOT + 1;
const NpcProfile = { DEVIN: 61, SLAY: 64, IGGY: 68, CONRAD: 70 } as const;
const QUIT_ON_LEARNED_HATE_NPCS: ReadonlySet<number> = new Set(Object.values(NpcProfile));
const MercKindCode = { MERC: 2, NPC: 3 } as const;

export type TeamMoraleEvent =
  | { readonly type: 'hatedComplaint'; readonly soldier: number; readonly about: number; readonly learned: boolean }
  | { readonly type: 'mercQuitsHated'; readonly soldier: number; readonly about: number; readonly learned: boolean };

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

function whichHated(p: ProfileProgress, other: number): number {
  for (let slot = HatedSlot.SLOT1; slot < HatedSlot.COUNT; slot++) if (p.hated[slot] === other) return slot;
  return HatedSlot.NOT_FOUND;
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
  if (hatedTime !== 0) opinion = Math.trunc((opinion * (hatedTime - (p.hatedCount[hated] ?? 0))) / hatedTime);
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
    members = ((members + 1) << 24) >> 24;
    leadership = Math.max(leadership, effectiveLeadership(other.soldier));
  }
  return { sum, members, foundHated: false, leadership };
}

function actualTeamOpinion(o: TeamOpinion): number {
  let actual: number;
  if (o.foundHated) actual = HATED_OPINION;
  else if (o.members > 0)
    actual = ((Math.trunc(o.sum / o.members) << 24) >> 24) + Math.trunc((o.leadership - LEADERSHIP_BASE) / LEADERSHIP_STEP);
  else actual = 0;
  return clamp((actual << 24) >> 24, HATED_OPINION, BUDDY_OPINION);
}

function shiftTeamMorale(m: RosterMerc, actual: number): void {
  const s = m.soldier;
  const diff = ((actual - s.teamMoraleMod) << 24) >> 24;
  const change = diff > 0 ? 1 + Math.trunc(diff / TEAM_MOD_STEP) : diff < 0 ? -1 + Math.trunc(diff / TEAM_MOD_STEP) : 0;
  s.teamMoraleMod = clamp(((s.teamMoraleMod + change) << 24) >> 24, -MORALE_MOD_MAX, MORALE_MOD_MAX);
}

function applyDelayedStrategicMorale(m: RosterMerc): void {
  const s = m.soldier;
  if (s.delayedStrategicMoraleMod === 0) return;
  s.strategicMoraleMod = clamp(((s.strategicMoraleMod + s.delayedStrategicMoraleMod) << 24) >> 24, -MORALE_MOD_MAX, MORALE_MOD_MAX);
  s.delayedStrategicMoraleMod = 0;
}

export function decayStrategicMorale(m: RosterMerc): void {
  const s = m.soldier;
  const mod = s.strategicMoraleMod;
  s.strategicMoraleMod = mod > 0 ? Math.max(0, mod - (8 - Math.trunc(mod / 10))) : Math.min(0, mod + (6 + Math.trunc(mod / 10)));
}

export function decayTacticalMorale(m: RosterMerc): void {
  const s = m.soldier;
  const mod = s.tacticalMoraleMod;
  if (mod === 0) return;
  s.tacticalMoraleMod = mod > 0 ? Math.max(0, mod - (8 - Math.trunc(mod / 10))) : Math.min(0, mod + (6 + Math.trunc(mod / 10)));
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
  ctx.morale.strategicDecayCounter = ((ctx.morale.strategicDecayCounter + 1) << 24) >> 24;
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
  if (m.kind === MercKindCode.MERC) return true;
  if (m.kind !== MercKindCode.NPC) return false;
  return !learned || QUIT_ON_LEARNED_HATE_NPCS.has(m.profile);
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
  const half = Math.trunc(time / 2);
  return count > 0 && (count === half || (count < half && count % TIME_BETWEEN_HATED_COMPLAINTS === 0));
}

function hatedSlotPass(ctx: TeamMoraleContext, m: RosterMerc, p: ProfileProgress, slot: number, other: number, c: Complaints): void {
  if (p.hated[slot] !== other) return;
  const time = p.hatedTime[slot] ?? 0;
  let count = p.hatedCount[slot] ?? 0;
  if (count <= 0) {
    tickComplaintTimer(p, c);
    if (p.timeTillNextHatedComplaint === 0) ctx.emit({ type: 'hatedComplaint', soldier: m.id, about: other, learned: false });
    return;
  }
  count--;
  p.hatedCount[slot] = count;
  if (count === 0 && m.soldier.placed && ctx.enemyInSector) {
    p.hatedCount[slot] = 1;
    return;
  }
  if (complainHalfway(count, time)) {
    ctx.emit({ type: 'hatedComplaint', soldier: m.id, about: other, learned: false });
    ctx.stopTimeCompression();
    return;
  }
  if (count !== 0) return;
  if (quitsOverHatred(m, false)) ctx.emit({ type: 'mercQuitsHated', soldier: m.id, about: other, learned: false });
  else {
    ctx.emit({ type: 'hatedComplaint', soldier: m.id, about: other, learned: false });
    p.timeTillNextHatedComplaint = TIME_BETWEEN_HATED_COMPLAINTS - 1;
  }
}

function learnedHatePass(ctx: TeamMoraleContext, m: RosterMerc, p: ProfileProgress, other: number, c: Complaints): void {
  if (p.learnToHate !== other) return;
  if (p.learnToHateCount <= 0) {
    tickComplaintTimer(p, c);
    if (p.timeTillNextHatedComplaint === 0) ctx.emit({ type: 'hatedComplaint', soldier: m.id, about: other, learned: true });
    return;
  }
  p.learnToHateCount--;
  if (p.learnToHateCount === 0 && m.soldier.placed && ctx.enemyInSector) p.learnToHateCount = 1;
  else if (complainHalfway(p.learnToHateCount, p.learnToHateTime)) {
    ctx.emit({ type: 'hatedComplaint', soldier: m.id, about: other, learned: true });
    ctx.stopTimeCompression();
  } else if (p.learnToHateCount === 0) {
    p.hated[HatedSlot.LEARNED_TO_HATE] = p.learnToHate;
    p.opinions[other] = HATED_OPINION;
    if (quitsOverHatred(m, true)) ctx.emit({ type: 'mercQuitsHated', soldier: m.id, about: other, learned: true });
    else if (m.kind === MercKindCode.NPC) ctx.emit({ type: 'hatedComplaint', soldier: m.id, about: other, learned: true });
  }
  if (p.learnToHateCount < Math.trunc(p.learnToHateTime / 2)) {
    const opinion = p.opinions[other] ?? 0;
    p.opinions[other] = ((opinion + Math.trunc((HATED_OPINION - opinion) / (p.learnToHateCount + 1))) << 24) >> 24;
  }
}

function learnToLikePass(p: ProfileProgress, other: number): void {
  if (p.learnToLikeCount <= 0 || p.learnToLike !== other) return;
  p.learnToLikeCount--;
  if (p.learnToLikeCount === 0) {
    p.buddies[LEARNED_TO_LIKE_SLOT] = p.learnToLike;
    p.opinions[other] = BUDDY_OPINION;
  } else if (p.learnToLikeCount < Math.trunc(p.learnToLikeTime / 2)) {
    const opinion = p.opinions[other] ?? 0;
    p.opinions[other] = ((opinion + Math.trunc((BUDDY_OPINION - opinion) / (p.learnToLikeCount + 1))) << 24) >> 24;
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

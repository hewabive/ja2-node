// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Init_List.cc AddProfilesUsingProfileInsertionData, AddProfilesNotUsingProfileInsertionData,
// @src FindSoldierInitListNodeByProfile; Strategic/StrategicMap.cc SetupProfileInsertionDataForSoldier,
// @src SetupProfileInsertionDataForCivilians; TacticalAI/NPC.cc HandleNPCChangesForTacticalTraversal; Tactical/Soldier_Profile.cc
// @src UpdateSoldierPointerDataIntoProfile; TacticalAI/AI.h QUOTE_ACTION_ID_*; TacticalAI/NPC.h APPROACH_DONE_TRAVERSAL.
// @src See docs/25 §4.6.

import type { SectorPosition } from '../../strategic/state.ts';
import { QuoteAction } from '../ai/cover.ts';
import { type SoldierCreate, tacticalCreateSoldier } from '../creation.ts';
import { addPlacementToWorld, drawStandingFrame, type PopulationEnv, soldierSlotTaken } from '../init-list.ts';
import { Insertion, type InsertionContext, updateMercInSector } from '../insertion.ts';
import { emptyInventory } from '../inventory.ts';
import type { ProfileProgress } from '../profiles.ts';
import { firstFreeSoldierId, NO_PROFILE, NOWHERE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { profileUsesInsertionData } from './placement.ts';
import { getSchedule } from './schedule-state.ts';

export const QUOTE_ACTION_CHECK_FOR_DEST = 1;
const PERMANENT_INSERTION_CODE = 0x02;
const HANDLE_DONE_TRAVERSAL = 0x08;
const LEFT_COUNTRY = 0x02;
const APPROACH_DONE_TRAVERSAL = 27;

export interface ProfileInsertionHooks {
  profile(id: number): ProfileProgress | null;
  insertedProfileIds(): readonly number[];
  isPlayerMerc(profile: number): boolean;
  insertionContext(): InsertionContext;
  reachedDestination(s: Soldier): void;
  hasUnusedRecordWithApproach(profile: number, approach: number): boolean;
}

export function addProfilesNotUsingProfileInsertionData(t: TacticalState, env: PopulationEnv, hooks: ProfileInsertionHooks): void {
  for (const node of t.initList) {
    if (node.hasSoldier || node.team !== Team.CIV || !node.detail) continue;
    const pid = node.detail.profile;
    if (pid === NO_PROFILE) continue;
    const p = hooks.profile(pid);
    if (!p || p.useProfileInsertion || p.life === 0) continue;
    addPlacementToWorld(t, node, env);
  }
}

function blankProfileCreate(profile: number): SoldierCreate {
  return {
    profile,
    team: Team.CIV,
    soldierClass: 0,
    civilianGroup: 0,
    bodyType: 0,
    orders: 0,
    attitude: 0,
    direction: 0,
    insertionGridNo: NOWHERE,
    onRoof: false,
    hasKeys: false,
    patrolCount: 0,
    patrolGrid: [],
    expLevel: 0,
    life: 0,
    lifeMax: 0,
    agility: 0,
    dexterity: 0,
    marksmanship: 0,
    medical: 0,
    mechanical: 0,
    explosives: 0,
    leadership: 0,
    strength: 0,
    wisdom: 0,
    morale: 0,
    visible: false,
    palettes: {},
    inv: emptyInventory(),
    name: '',
    scheduleId: 0,
  };
}

function soldierOfProfile(t: TacticalState, profile: number): Soldier | null {
  return t.soldiers.find((s): s is Soldier => s?.placed === true && s.profile === profile) ?? null;
}

function createProfileCivilian(t: TacticalState, profile: number, env: PopulationEnv): Soldier | null {
  const id = firstFreeSoldierId((n) => soldierSlotTaken(t, n), Team.CIV);
  if (id < 0) return null;
  const s = tacticalCreateSoldier(t, blankProfileCreate(profile), id, env);
  if (s) drawStandingFrame(t);
  return s;
}

export function addProfilesUsingProfileInsertionData(
  t: TacticalState,
  world: SectorPosition,
  env: PopulationEnv,
  hooks: ProfileInsertionHooks,
): void {
  for (const id of hooks.insertedProfileIds()) {
    const p = hooks.profile(id);
    if (!p || !profileUsesInsertionData(world, p)) continue;
    const s = soldierOfProfile(t, id) ?? createProfileCivilian(t, id, env);
    if (!s) continue;
    s.insertionData = p.insertionData;
    updateMercInSector(t, s, { code: p.insertionCode, data: p.insertionData, direction: s.direction }, hooks.insertionContext());
    if (p.quoteRecord !== 0) {
      s.quoteRecord = p.quoteRecord;
      s.quoteActionId = p.quoteActionId;
      if (s.quoteActionId === QUOTE_ACTION_CHECK_FOR_DEST) hooks.reachedDestination(s);
    }
    const node = t.initList.find((n) => n.detail?.profile === s.profile);
    if (node) {
      node.soldierId = s.id;
      node.hasSoldier = true;
      linkPlacementSchedule(t, s, node.detail?.scheduleId ?? 0);
    }
  }
}

function linkPlacementSchedule(t: TacticalState, s: Soldier, scheduleId: number): void {
  if (scheduleId === 0) return;
  const schedule = getSchedule(t.schedules, scheduleId);
  if (!schedule) return;
  schedule.soldier = s.id;
  s.scheduleId = scheduleId;
}

function changeNpcSector(p: ProfileProgress, x: number, y: number): void {
  if (p.miscFlags2 & LEFT_COUNTRY) {
    p.sectorX = 0;
    p.sectorY = 0;
    p.sectorZ = 0;
  } else {
    p.sectorX = x;
    p.sectorY = y;
  }
  p.useProfileInsertion = false;
}

function handleNpcChangesForTacticalTraversal(s: Soldier, p: ProfileProgress): void {
  if (s.ai.checkSchedule) return;
  switch (s.quoteActionId) {
    case QuoteAction.TRAVERSE_EAST:
      changeNpcSector(p, p.sectorX + 1, p.sectorY);
      break;
    case QuoteAction.TRAVERSE_SOUTH:
      changeNpcSector(p, p.sectorX, p.sectorY + 1);
      break;
    case QuoteAction.TRAVERSE_WEST:
      changeNpcSector(p, p.sectorX - 1, p.sectorY);
      break;
    case QuoteAction.TRAVERSE_NORTH:
      changeNpcSector(p, p.sectorX, p.sectorY - 1);
      break;
    default:
      break;
  }
}

function isTraversal(action: number): boolean {
  return action >= QuoteAction.TRAVERSE_EAST && action <= QuoteAction.TRAVERSE_NORTH;
}

export interface SoldierWhereabouts {
  readonly inSector: boolean;
  readonly strategicInsertionCode: number;
}

export function setupProfileInsertionDataForSoldier(s: Soldier, where: SoldierWhereabouts, hooks: ProfileInsertionHooks): void {
  if (s.profile === NO_PROFILE) return;
  const p = hooks.profile(s.profile);
  if (!p || p.miscFlags3 & PERMANENT_INSERTION_CODE) return;
  if (!where.inSector) {
    p.insertionCode = where.strategicInsertionCode;
    p.insertionData = 0;
    p.useProfileInsertion = true;
    return;
  }
  if (!(s.quoteRecord && s.quoteActionId)) {
    p.useProfileInsertion = false;
    return;
  }
  if (isTraversal(s.quoteActionId)) {
    handleNpcChangesForTacticalTraversal(s, p);
    p.useProfileInsertion = false;
    if (hooks.hasUnusedRecordWithApproach(s.profile, APPROACH_DONE_TRAVERSAL)) p.miscFlags3 |= HANDLE_DONE_TRAVERSAL;
    return;
  }
  if (s.finalDestination === s.gridNo) p.insertionData = s.gridNo;
  else if (s.absoluteFinalDestination !== NOWHERE) p.insertionData = s.absoluteFinalDestination;
  else p.insertionData = s.finalDestination;
  p.useProfileInsertion = true;
  p.insertionCode = Insertion.GRIDNO;
  p.quoteActionId = s.quoteActionId;
  p.quoteRecord = s.quoteActionId;
}

export function setupProfileInsertionDataForCivilians(t: TacticalState, hooks: ProfileInsertionHooks): void {
  for (const s of t.soldiers) {
    if (!s || s.team !== Team.CIV || !(s.placed || s.offMap)) continue;
    setupProfileInsertionDataForSoldier(s, { inSector: true, strategicInsertionCode: Insertion.GRIDNO }, hooks);
  }
}

export function updateSoldierPointerDataIntoProfile(t: TacticalState, hooks: ProfileInsertionHooks): void {
  for (const s of t.mercSlots) {
    if (!s?.placed || s.profile === NO_PROFILE || hooks.isPlayerMerc(s.profile)) continue;
    const p = hooks.profile(s.profile);
    if (!p) continue;
    p.life = s.life;
    p.stats.lifeMax = s.lifeMax;
    p.stats.agility = s.stats.agility;
    p.stats.leadership = s.stats.leadership;
    p.stats.dexterity = s.stats.dexterity;
    p.stats.strength = s.stats.strength;
    p.stats.wisdom = s.stats.wisdom;
    p.stats.experience = s.stats.experience;
    p.stats.marksmanship = s.stats.marksmanship;
    p.stats.medical = s.stats.medical;
    p.stats.mechanical = s.stats.mechanical;
    p.stats.explosives = s.stats.explosives;
  }
}

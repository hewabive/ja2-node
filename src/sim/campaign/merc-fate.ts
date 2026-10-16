// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Merc_Handler.cc StrategicHandlePlayerTeamMercDeath; Strategic/Strategic.cc
// @src HandleStrategicDeath; Strategic/Queen_Command.cc BeginCaptureSquence, EndCaptureSequence, CaptureSoldier,
// @src EnemyCapturesPlayerSoldier. See docs/19 §3.8, docs/22 §4.9.

import type { Sector } from '../../content/strategic/sector-ids.ts';
import { u8 } from '../../core/int.ts';
import { emptyObject } from '../items/object.ts';
import { changeSoldiersAssignment, setTimeOfAssignmentChange } from '../strategic/economy/assignment-done.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import type { EconomyContext } from '../strategic/economy/ports.ts';
import { putMercInAwakeState } from '../strategic/economy/rest.ts';
import { QuestState } from '../strategic/forces/battle-state.ts';
import { InsertionCode } from '../strategic/forces/constants.ts';
import { numEnemiesInSector } from '../strategic/forces/groups.ts';
import { removeCharacterFromSquads } from '../strategic/forces/squads.ts';
import { MercStatus, type ProfileProgress } from '../tactical/profiles.ts';
import { SoldierStatusFlags } from '../tactical/soldier.ts';
import { handleMoraleEvent, type MoraleContext, MoraleEvent } from './morale.ts';
import type { RosterMerc } from './roster.ts';
import { addItemsToUnloadedSector } from './sector-loot.ts';

export const CaptureFlag = { FOR_RESCUE: 0x00000001, FOR_ESCAPE: 0x00000002 } as const;

const ALMA: Sector = { x: 13, y: 9, z: 0 };
const INTERROGATION: Sector = { x: 7, y: 14, z: 0 };
const ALMA_CAPTURE_GRIDNOS = [9208, 9688, 9215] as const;
const ALMA_CAPTURE_ITEM_GRIDNOS = [12246, 12406, 13046] as const;
const INTERROGATION_GRIDNOS = [7756, 7757, 7758] as const;
const INTERROGATION_ITEM_GRIDNO = 12089;
const MAX_CAPTIVES_INDEX = 3;
const CAPTIVE_LIFE_FLOOR = 35;
const CAPTIVE_LIFE_VARIANCE_FROM = 45;
const CAPTIVE_LIFE_SPREAD = 10;
const CAPTIVE_BREATH = 50;
const HIDDEN_ITEM_VISIBILITY = 0;

export interface DeathBookkeeping {
  deathBookkeeping(m: RosterMerc): void;
  lifeInsuranceOnDeath(m: RosterMerc, p: ProfileProgress): void;
  mercMercDied(m: RosterMerc): void;
  buddyKilledQuotes(dead: RosterMerc): void;
}

export interface FateContext {
  readonly economy: EconomyContext;
  readonly bookkeeping?: DeathBookkeeping | null;
  moraleContext(): MoraleContext;
  mercDied?(merc: RosterMerc): void;
}

function bothCaptureFlags(flags: number): boolean {
  return (flags & CaptureFlag.FOR_RESCUE) !== 0 && (flags & CaptureFlag.FOR_ESCAPE) !== 0;
}

export function beginCaptureSequence(ctx: FateContext): void {
  const status = ctx.economy.state.status;
  if (!bothCaptureFlags(status.flags)) status.numCapturedForRescue = 0;
}

export function endCaptureSequence(ctx: FateContext): void {
  const status = ctx.economy.state.status;
  if (bothCaptureFlags(status.flags)) return;
  const quests = ctx.economy.state.battle.quests;
  if (quests.heldInAlma === QuestState.NOT_STARTED) {
    status.flags |= CaptureFlag.FOR_RESCUE;
    quests.heldInAlma = QuestState.IN_PROGRESS;
  } else if (quests.heldInAlma === QuestState.DONE && quests.interrogation === QuestState.NOT_STARTED) {
    quests.interrogation = QuestState.IN_PROGRESS;
    status.flags |= CaptureFlag.FOR_ESCAPE;
  } else status.flags |= CaptureFlag.FOR_RESCUE | CaptureFlag.FOR_ESCAPE;
}

export function handleStrategicDeath(ctx: FateContext, m: RosterMerc): void {
  const economy = ctx.economy;
  if (m.assignment === Assignment.VEHICLE && m.vehicleId !== -1) economy.crew.takeOutOfVehicle(m.id);
  removeCharacterFromSquads(economy, m.id);
  if (m.assignment !== Assignment.ASSIGNMENT_DEAD) setTimeOfAssignmentChange(economy, m);
  changeSoldiersAssignment(economy, m, Assignment.ASSIGNMENT_DEAD);
}

export function strategicHandlePlayerTeamMercDeath(ctx: FateContext, m: RosterMerc): void {
  const state = ctx.economy.state;
  const books = ctx.bookkeeping ?? null;
  books?.deathBookkeeping(m);
  if (!m.isEpc && !m.isRobot) state.status.mercDeaths = u8(state.status.mercDeaths + 1);
  m.statusFlags |= SoldierStatusFlags.DEAD;
  m.soldier.breathMax = 0;
  m.soldier.breath = 0;
  m.asleep = false;
  const progress = state.profiles.get(m.profile);
  if (progress) {
    progress.mercStatus = MercStatus.IS_DEAD;
    books?.lifeInsuranceOnDeath(m, progress);
  }
  if (!m.isEpc && !m.isRobot) handleMoraleEvent(ctx.moraleContext(), m, MoraleEvent.TEAMMATE_DIED, m.sector);
  books?.mercMercDied(m);
  handleStrategicDeath(ctx, m);
  books?.buddyKilledQuotes(m);
  ctx.mercDied?.(m);
}

function captureSoldier(ctx: FateContext, m: RosterMerc, sector: Sector, gridNo: number, itemGridNo: number): void {
  const s = m.soldier;
  m.sector = { ...sector };
  s.level = 0;
  m.insertionCode = InsertionCode.GRIDNO;
  s.insertionData = gridNo;
  for (let slot = 0; slot < s.inv.length; slot++) {
    const o = s.inv[slot];
    if (!o || o.item === 0) continue;
    addItemsToUnloadedSector(ctx.economy.state, sector, itemGridNo, [o], 0, 0, HIDDEN_ITEM_VISIBILITY);
    s.inv[slot] = emptyObject();
  }
}

function teleportCaptive(ctx: FateContext, m: RosterMerc): void {
  const state = ctx.economy.state;
  const quests = state.battle.quests;
  const index = state.status.numCapturedForRescue;
  if (quests.heldInAlma === QuestState.NOT_STARTED) {
    captureSoldier(ctx, m, ALMA, ALMA_CAPTURE_GRIDNOS[index] ?? ALMA_CAPTURE_GRIDNOS[0], ALMA_CAPTURE_ITEM_GRIDNOS[index] ?? 0);
    state.status.numCapturedForRescue++;
  } else if (quests.heldInAlma === QuestState.DONE) {
    captureSoldier(ctx, m, INTERROGATION, INTERROGATION_GRIDNOS[index] ?? INTERROGATION_GRIDNOS[0], INTERROGATION_ITEM_GRIDNO);
    state.status.numCapturedForRescue++;
  }
}

export interface CaptureRandom {
  int(n: number): number;
}

function captiveLife(rng: CaptureRandom, lifeMax: number): number {
  const half = Math.trunc(lifeMax / 2);
  if (half <= CAPTIVE_LIFE_FLOOR) return CAPTIVE_LIFE_FLOOR;
  if (half >= CAPTIVE_LIFE_VARIANCE_FROM) return half + CAPTIVE_LIFE_SPREAD - rng.int(2 * CAPTIVE_LIFE_SPREAD + 1);
  return half;
}

export function enemyCapturesPlayerSoldier(ctx: FateContext, m: RosterMerc, rng: CaptureRandom): boolean {
  const economy = ctx.economy;
  const state = economy.state;
  if (bothCaptureFlags(state.status.flags)) return false;
  if (state.status.numCapturedForRescue > MAX_CAPTIVES_INDEX) return false;
  if (m.isEpc) {
    m.soldier.life = 0;
    strategicHandlePlayerTeamMercDeath(ctx, m);
    return false;
  }
  if (m.isVehicle) return false;
  economy.crew.takeOutOfVehicle(m.id);
  const quests = state.battle.quests;
  if (quests.heldInAlma === QuestState.NOT_STARTED && numEnemiesInSector(economy, ALMA) === 0) quests.heldInAlma = QuestState.DONE;
  handleMoraleEvent(ctx.moraleContext(), m, MoraleEvent.MERC_CAPTURED, m.sector);
  if (m.assignment !== Assignment.ASSIGNMENT_POW) setTimeOfAssignmentChange(economy, m);
  changeSoldiersAssignment(economy, m, Assignment.ASSIGNMENT_POW);
  if (quests.heldInAlma === QuestState.NOT_STARTED) m.soldier.neutral = true;
  removeCharacterFromSquads(economy, m.id);
  teleportCaptive(ctx, m);
  m.soldier.bleeding = 0;
  if (m.asleep) {
    putMercInAwakeState(m);
    m.forcedToStayAwake = false;
  }
  m.soldier.life = captiveLife(rng, m.soldier.lifeMax);
  m.soldier.breath = CAPTIVE_BREATH;
  m.soldier.breathMax = CAPTIVE_BREATH;
  m.soldier.breathRed = 0;
  m.collapsed = false;
  return true;
}

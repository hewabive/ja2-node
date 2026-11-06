// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-06. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Auto_Bandage.cc BeginAutoBandage, BeginAutoBandageCallBack, HandleAutoBandage (the frame; the
// @src panel, the shadow and the keys are the client's), SetAutoBandageComplete, AutoBandage, SetUpAutoBandageUpdatePanel
// @src (the lists); Tactical/Overhead.cc ExecuteOverhead (the completion check after the away-slot AI); Auto_Bandage.cc
// @src ShouldBeginAutoBandage, HandleAutoBandagePending and SetAutoBandagePending (2026-11-06).

import type { CommandResult } from '../command.ts';
import { type ItemObject, swapObjects } from '../items/object.ts';
import {
  aboardOrVehicle,
  canAutoBandage,
  canCharacterAutoBandageTeammate,
  canCharacterBeAutoBandagedByTeammate,
  carriesMedKit,
  ourTeam,
} from './ai/medical.ts';
import { anim } from './anim-states.ts';
import { AnimHeight, changeSoldierStance, height, resetAllMercSpeeds, soldierGotoStationaryStance } from './animation.ts';
import { handleTeamServices } from './first-aid.ts';
import { playerInterfaceLocked } from './interface-lock.ts';
import { InvSlot, NO_SLOT } from './inventory.ts';
import { executeOverhead, type OverheadHooks } from './overhead.ts';
import { hasPendingAction } from './pending-action.ts';
import { openTacticalPrompt, TacticalPromptKind } from './prompts.ts';
import { type Refusal, type RefusalTexts, refuseWithText } from './refusal.ts';
import { inSector, NOBODY, OKLIFE, type Soldier, Team } from './soldier.ts';
import { type AutoBandageState, setAutoBandageMode, type TacticalState } from './state.ts';
import { handleForcedRealtimeTurn, handleRealtimeTurns, numEnemyInSector } from './turns/turns.ts';

const SECONDS_PER_FRAME = 5;
const LAST_COUNTED_SECONDS = 120;

export type AutoBandageRefusal = 'sectorNotCleared' | 'nobodyToBandage' | 'noMedKit' | 'cannotAutoBandage';

export const AUTO_BANDAGING: Refusal = { token: 'autoBandaging', reason: 'auto-bandage is running: endAutoBandage ends it' };

const AUTO_BANDAGE_REFUSALS: RefusalTexts<AutoBandageRefusal> = {
  sectorNotCleared: 'enemies are in the sector',
  nobodyToBandage: 'no merc in the sector needs bandaging',
  noMedKit: 'no merc in the sector carries a medical kit',
  cannotAutoBandage: 'no merc in the sector can bandage the wounded',
};

function mercsOnFootInSector(t: TacticalState): Soldier[] {
  return ourTeam(t).filter((s) => inSector(s) && !aboardOrVehicle(s));
}

export function autoBandageRefusal(t: TacticalState): AutoBandageRefusal | null {
  if (t.inCombat || numEnemyInSector(t) !== 0) return 'sectorNotCleared';
  const mercs = mercsOnFootInSector(t);
  if (!mercs.some(canCharacterBeAutoBandagedByTeammate)) return 'nobodyToBandage';
  if (!mercs.some((s) => carriesMedKit(t, s))) return 'noMedKit';
  return canAutoBandage(t, false) ? null : 'cannotAutoBandage';
}

export function beginAutoBandage(t: TacticalState): CommandResult {
  const refusal = autoBandageRefusal(t);
  if (refusal) return refuseWithText(AUTO_BANDAGE_REFUSALS, refusal);
  openTacticalPrompt(t, { kind: TacticalPromptKind.BEGIN_AUTO_BANDAGE });
  return { ok: true, data: { prompt: t.prompt?.id } };
}

export function setAutoBandagePending(state: AutoBandageState, pending: boolean): void {
  state.pending = pending;
}

export function shouldBeginAutoBandage(t: TacticalState): void {
  if (t.inCombat || t.sectorHooks.inDeidrannaEndgame(t)) return;
  if (canAutoBandage(t, false)) setAutoBandagePending(t.autoBandage, true);
}

function pendingQuestionWaits(t: TacticalState): boolean {
  if (!t.narrative.dialogueQueueIsEmptyAndNobodyIsTalking()) return true;
  if (ourTeam(t).some(hasPendingAction)) return true;
  return playerInterfaceLocked(t);
}

export function autoBandageQuestionDue(t: TacticalState): boolean {
  return t.autoBandage.pending && !pendingQuestionWaits(t);
}

export function handleAutoBandagePending(t: TacticalState): void {
  if (!autoBandageQuestionDue(t)) return;
  setAutoBandagePending(t.autoBandage, false);
  const refusal = autoBandageRefusal(t);
  if (refusal) t.events.push({ type: 'autoBandageRefused', refusal });
  else openTacticalPrompt(t, { kind: TacticalPromptKind.BEGIN_AUTO_BANDAGE });
}

function refill(list: number[], ids: readonly number[]): void {
  list.splice(0, list.length, ...ids);
}

function setUpAutoBandageLists(t: TacticalState): void {
  const state = t.autoBandage;
  const team = ourTeam(t);
  const medics = team.filter((s) => canCharacterAutoBandageTeammate(t, s)).map((s) => s.id);
  const patients = team.filter(canCharacterBeAutoBandagedByTeammate).map((s) => s.id);
  const bothFound = medics.length > 0 && patients.length > 0;
  refill(state.medics, bothFound ? medics : []);
  refill(state.patients, bothFound ? patients : []);
  state.complete = false;
}

function forgetKitsAndMedics(t: TacticalState): void {
  for (const s of t.sectorHooks.ourWholeTeam(t)) {
    s.slotItemTakenFrom = NO_SLOT;
    s.autoBandagingMedic = NOBODY;
  }
}

export function startAutoBandage(t: TacticalState): void {
  handleForcedRealtimeTurn(t, t.realtimeClock, t.clockMs);
  const state = t.autoBandage;
  setAutoBandageMode(t, true);
  state.failed = false;
  setUpAutoBandageLists(t);
  t.sectorHooks.autoBandageStarted(t);
  forgetKitsAndMedics(t);
  state.seconds = 0;
  resetAllMercSpeeds(t);
  t.events.push({ type: 'autoBandageStarted', medics: [...state.medics], patients: [...state.patients] });
}

export function checkAutoBandageComplete(t: TacticalState): void {
  if (canAutoBandage(t, true) || t.autoBandage.complete) return;
  t.autoBandage.complete = true;
  t.events.push({ type: 'autoBandageComplete' });
}

function countAutoBandageSeconds(t: TacticalState): void {
  const state = t.autoBandage;
  if (state.seconds <= LAST_COUNTED_SECONDS) state.seconds += SECONDS_PER_FRAME;
}

export function autoBandageFrame(t: TacticalState, hooks: OverheadHooks): void {
  handleRealtimeTurns(t, t.realtimeClock);
  handleTeamServices(t, Team.OUR);
  countAutoBandageSeconds(t);
  executeOverhead(t, hooks);
  if (t.autoBandage.endRequested) endAutoBandage(t);
}

export function requestEndAutoBandage(t: TacticalState): void {
  t.autoBandage.endRequested = true;
}

function swapHandBack(s: Soldier): void {
  if (s.slotItemTakenFrom === NO_SLOT) return;
  swapObjects(s.inv[InvSlot.HAND] as ItemObject, s.inv[s.slotItemTakenFrom] as ItemObject);
}

function standUp(t: TacticalState, s: Soldier): void {
  if (s.life < OKLIFE || s.collapsed) return;
  if (height(t.content, s.state) !== AnimHeight.STAND) changeSoldierStance(t, s, AnimHeight.STAND);
}

function leaveGivingAid(t: TacticalState, s: Soldier): void {
  if (s.state === anim(t.content, 'GIVING_AID')) soldierGotoStationaryStance(t, s);
}

export function endAutoBandage(t: TacticalState): void {
  const state = t.autoBandage;
  setAutoBandageMode(t, false);
  const team = t.sectorHooks.ourWholeTeam(t);
  for (const s of team) {
    t.turnHooks.actionDone(t, s);
    swapHandBack(s);
    standUp(t, s);
  }
  for (const s of team) {
    t.turnHooks.actionDone(t, s);
    leaveGivingAid(t, s);
  }
  const warpSeconds = state.seconds;
  t.sectorHooks.autoBandageEnded(t, warpSeconds);
  t.events.push({ type: 'autoBandageEnded', failed: state.failed, worldSecondsWarped: warpSeconds });
  state.failed = false;
  state.seconds = 0;
  state.endRequested = false;
  resetAllMercSpeeds(t);
}

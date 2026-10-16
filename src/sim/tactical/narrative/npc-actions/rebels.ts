// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (GOTO_HIDEOUT, LEAVE_HIDEOUT, FATIMA_GIVE_LETTER,
// @src SEND_PACOS_INTO_HIDING, HAVE_PACOS_FOLLOW, PUT_PACOS_IN_BASEMENT, TRIGGER_END_OF_FOOD_QUEST, TRIGGER_FATHER_18_20_OR_15,
// @src SEND_ENRICO_MIGUEL_EMAIL), sBasementEnterGridNos, sBasementExitGridNos, DoneFadeOutActionBasement,
// @src DoneFadeInActionBasement, DoneFadeOutActionLeaveBasement. See docs/25 §3.4.

import { npcGotoGridNo, triggerNpcRecordImmediately } from '../../../narrative/converse.ts';
import { Fact } from '../../../strategic/narrative/fact-ids.ts';
import { NarrativeHistory } from '../../../strategic/narrative/history-codes.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { changeNpcToDifferentSector, setProfileSector } from '../../../strategic/narrative/presence.ts';
import type { SectorPosition } from '../../../strategic/state.ts';
import { findAdjacentGridEx } from '../../combat/melee-reach.ts';
import { findObj } from '../../doors/lock-attempts.ts';
import { newOKDestination } from '../../pathfinding.ts';
import { NpcActionCode as A, NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS } from './codes.ts';
import { closeMenu, npcSoldier, profileOf, tactical, trigger } from './common.ts';
import type { NpcActionEnv } from './env.ts';

export const BASEMENT: SectorPosition = { x: 10, y: 1, z: 1 };
export const UPSTAIRS: SectorPosition = { x: 10, y: 1, z: 0 };
export const BASEMENT_ENTER_GRIDNOS: readonly number[] = [13362, 13363, 13364, 13365, 13525, 13524];
export const BASEMENT_EXIT_GRIDNOS: readonly number[] = [8047, 8207, 8208, 8048, 7888, 7728, 7727, 7567];
export const BASEMENT_EXIT_GRID = { sector: BASEMENT, gridNo: 12722 } as const;

const HIDEOUT_GRIDNO = 7887;
const PACOS_HIDING_GRIDNO = 16028;
const PACOS_FOLLOW_GRIDNO = 18193;
const ENRICO_MAIL_FIRST_MINUTE = 390;
const ENRICO_MAIL_SPREAD_MINUTES = 60;
const NOT_FOUND = -1;

function gotoHideout(env: NpcActionEnv): void {
  env.hideout.addExitGrid(env.params.gridNo(A.GOTO_HIDEOUT, HIDEOUT_GRIDNO), BASEMENT_EXIT_GRID);
  env.hideout.moveMercs(BASEMENT, BASEMENT_ENTER_GRIDNOS, true);
  for (const npc of [Npc.FATIMA, Npc.DIMITRI]) {
    const p = profileOf(env, npc);
    if (p) changeNpcToDifferentSector(p, BASEMENT);
  }
  env.hideout.loadSector(BASEMENT);
  env.hideout.uncoverTrapdoor(UPSTAIRS);
  if (npcSoldier(env, Npc.CARLOS)) triggerNpcRecordImmediately(env.host, Npc.CARLOS, 1);
}

function leaveHideout(env: NpcActionEnv): void {
  closeMenu(env);
  if (env.hideout.leavingSector()) return;
  env.hideout.moveMercs(UPSTAIRS, BASEMENT_EXIT_GRIDNOS, false);
  env.host.setEngaged(false);
  env.host.talk.referenceCount = 0;
  env.hideout.loadSector(UPSTAIRS);
}

function fatimaGivesLetter(env: NpcActionEnv): void {
  closeMenu(env);
  const fatima = npcSoldier(env, Npc.FATIMA);
  const miguel = npcSoldier(env, Npc.MIGUEL);
  const t = tactical(env);
  if (!fatima || !miguel || !t) return;
  const letter = t.content.items.byName.get('LETTER')?.index ?? NOT_FOUND;
  const slot = findObj(fatima, letter);
  if (slot !== NOT_FOUND) env.giveItem(fatima, miguel, slot);
}

function movePacos(env: NpcActionEnv, code: number, fallback: number, record: number): void {
  const t = tactical(env);
  const pacos = npcSoldier(env, Npc.PACOS);
  const gridNo = env.params.gridNo(code, fallback);
  if (!t || !pacos) return;
  if (newOKDestination(t.pathEnv, pacos, gridNo, true, 0)) {
    npcGotoGridNo(env.host, Npc.PACOS, gridNo, record);
    return;
  }
  const adjusted = findAdjacentGridEx(t, pacos, gridNo, false);
  if (adjusted) npcGotoGridNo(env.host, Npc.PACOS, adjusted.actionGridNo, record);
}

function triggerFather(env: NpcActionEnv): void {
  if (!env.checkFact(Fact.FACT_132, Npc.FATHER)) trigger(env, Npc.FATHER, 18);
  else if (!env.checkFact(Fact.FACT_133, Npc.FATHER)) trigger(env, Npc.FATHER, 20);
  else if (!env.checkFact(Fact.FACT_134, Npc.FATHER)) trigger(env, Npc.FATHER, 15);
  else trigger(env, Npc.FATHER, 26);
}

export function handleRebelAction(env: NpcActionEnv, _npc: number, code: number, record: number): boolean {
  switch (code) {
    case A.GOTO_HIDEOUT:
      gotoHideout(env);
      return true;
    case A.LEAVE_HIDEOUT:
      leaveHideout(env);
      return true;
    case A.FATIMA_GIVE_LETTER:
      fatimaGivesLetter(env);
      return true;
    case A.SEND_PACOS_INTO_HIDING:
      movePacos(env, code, PACOS_HIDING_GRIDNO, record);
      return true;
    case A.HAVE_PACOS_FOLLOW:
      movePacos(env, code, PACOS_FOLLOW_GRIDNO, record);
      return true;
    case A.PUT_PACOS_IN_BASEMENT: {
      const pacos = profileOf(env, Npc.PACOS);
      if (pacos) setProfileSector(pacos, UPSTAIRS);
      return true;
    }
    case A.TRIGGER_END_OF_FOOD_QUEST:
      env.history(NarrativeHistory.TALKED_TO_FATHER_WALKER, env.worldSector());
      env.addFutureDayNpcEvent(env.minutesInDay(), NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + code, 1);
      return true;
    case A.TRIGGER_FATHER_18_20_OR_15:
      triggerFather(env);
      return true;
    case A.SEND_ENRICO_MIGUEL_EMAIL:
      env.addFutureDayNpcEvent(
        ENRICO_MAIL_FIRST_MINUTE + env.random(ENRICO_MAIL_SPREAD_MINUTES),
        NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + code,
        1,
      );
      return true;
    default:
      return false;
  }
}

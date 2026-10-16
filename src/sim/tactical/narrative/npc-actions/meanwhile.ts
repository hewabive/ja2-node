// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (END_MEANWHILE, REMOVE_JOE_QUEEN,
// @src REMOVE_ELLIOT_END_MEANWHILE, NO_SCI_FI_END_MEANWHILE, the Queen and Elliot record triggers, SLAP, FRUSTRATED_SLAP,
// @src PUNCH_PC_SLOT_0..2, PUNCH_FIRST_LIVING_PC, SHOOT_ELLIOT, ENDGAME_STATE_1/2, END_DEMO, and the strategic AI codes
// @src that do nothing here); Strategic/Queen_Command.cc gsInterrogationGridNo. See docs/25 §3.10, docs/26.

import { Approach } from '../../../../content/narrative/npc-constants.ts';
import { triggerNpcWithGivenApproach } from '../../../narrative/converse.ts';
import { Town } from '../../../strategic/economy/constants.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { removeSoldierFromTacticalSector } from '../../sector-presence.ts';
import { OKLIFE } from '../../soldier.ts';
import { whoIsThere } from '../../state.ts';
import { NpcActionCode as A } from './codes.ts';
import { closeMenu, npcSoldier, tactical, trigger } from './common.ts';
import type { NpcActionEnv } from './env.ts';

export const INTERROGATION_GRIDNOS: readonly number[] = [7756, 7757, 7758];

const PUNCH_APPROACHES: Readonly<Record<number, readonly [number, number]>> = {
  [A.PUNCH_PC_SLOT_0]: [0, Approach.DONE_PUNCH_0],
  [A.PUNCH_PC_SLOT_1]: [1, Approach.DONE_PUNCH_1],
  [A.PUNCH_PC_SLOT_2]: [2, Approach.DONE_PUNCH_2],
};

const NO_OPS: ReadonlySet<number> = new Set([
  A.SEND_SOLDIERS_TO_DRASSEN,
  A.SEND_SOLDIERS_TO_BATTLE_LOCATION,
  A.SEND_SOLDIERS_TO_OMERTA,
  A.ADD_MORE_ELITES,
  A.GIVE_KNOWLEDGE_OF_ALL_MERCS,
  A.SEND_TROOPS_TO_SAM,
  A.RESET_SHIPMENT_ARRIVAL_STUFF,
  A.REMOVE_CONRAD,
]);

const QUEEN_RECORD_BY_TOWNS: readonly number[] = [11, 11, 7, 8, 9, 10];
const QUEEN_RECORD_BY_SAMS: readonly number[] = [7, 7, 8, 9];
const QUEEN_RECORD_TOO_MANY_TOWNS = 11;

function removeProfileSoldier(env: NpcActionEnv, profile: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, profile);
  if (t && s) removeSoldierFromTacticalSector(t, s);
}

function endMeanwhile(env: NpcActionEnv): void {
  closeMenu(env);
  env.meanwhile.endMeanwhile();
}

function punchSlot(env: NpcActionEnv, npc: number, code: number): void {
  const [slot, approach] = PUNCH_APPROACHES[code] as readonly [number, number];
  closeMenu(env);
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (!t || !s) return;
  const target = whoIsThere(t, INTERROGATION_GRIDNOS[slot] as number, 0);
  if (target?.placed && target.life !== 0) env.meanwhile.punch(npc, target.gridNo, approach);
  else triggerNpcWithGivenApproach(env.host, s.profile, approach);
}

function punchFirstLivingPc(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (!t || !s) return;
  let good = false;
  for (const gridNo of INTERROGATION_GRIDNOS) {
    const target = whoIsThere(t, gridNo, 0);
    if (!target) continue;
    if (target.placed) {
      if (s.profile === Npc.ELLIOT) {
        if (target.life >= OKLIFE) good = true;
      } else if (target.life !== 0) good = true;
    }
    if (good) {
      env.meanwhile.punch(npc, target.gridNo, Approach.DONE_PUNCH_1);
      return;
    }
  }
  triggerNpcWithGivenApproach(env.host, s.profile, Approach.DONE_PUNCH_1);
}

function firstBattleRecord(env: NpcActionEnv, records: readonly [number, number, number]): number {
  if (env.meanwhile.firstBattleInTown(Town.DRASSEN)) return records[0];
  if (env.meanwhile.firstBattleInTown(Town.CAMBRIA)) return records[1];
  return records[2];
}

export function handleMeanwhileAction(env: NpcActionEnv, npc: number, code: number, _record: number): boolean {
  if (NO_OPS.has(code)) return true;
  if (PUNCH_APPROACHES[code]) {
    punchSlot(env, npc, code);
    return true;
  }
  switch (code) {
    case A.END_MEANWHILE:
      endMeanwhile(env);
      return true;
    case A.REMOVE_JOE_QUEEN:
      removeProfileSoldier(env, Npc.QUEEN);
      removeProfileSoldier(env, Npc.JOE);
      return true;
    case A.REMOVE_ELLIOT_END_MEANWHILE:
      removeProfileSoldier(env, Npc.ELLIOT);
      endMeanwhile(env);
      return true;
    case A.NO_SCI_FI_END_MEANWHILE:
      if (!env.sciFi()) endMeanwhile(env);
      else trigger(env, Npc.QUEEN, 8);
      return true;
    case A.TRIGGER_QUEEN_BY_CITIES_CONTROLLED: {
      const towns = env.meanwhile.wholeTownsUnderControlExceptOmerta();
      trigger(env, Npc.QUEEN, QUEEN_RECORD_BY_TOWNS[towns] ?? QUEEN_RECORD_TOO_MANY_TOWNS);
      return true;
    }
    case A.TRIGGER_QUEEN_BY_SAM_SITES_CONTROLLED: {
      const record = QUEEN_RECORD_BY_SAMS[env.meanwhile.samSitesUnderPlayerControl()];
      if (record !== undefined) trigger(env, Npc.QUEEN, record);
      return true;
    }
    case A.TRIGGER_ELLIOT_BY_BATTLE_RESULT:
      trigger(env, Npc.ELLIOT, env.meanwhile.lastBattleWon() ? 6 : 8);
      return true;
    case A.TRIGGER_ELLIOT_BY_SAM_DISABLED:
      if (env.meanwhile.functionalSamSiteInLastBattleSector()) trigger(env, Npc.QUEEN, 6);
      else trigger(env, Npc.ELLIOT, 2);
      return true;
    case A.ELLIOT_DECIDE_WHICH_QUOTE_FOR_PLAYER_ATTACK:
      trigger(env, Npc.ELLIOT, firstBattleRecord(env, [2, 3, 1]));
      return true;
    case A.QUEEN_DECIDE_WHICH_QUOTE_FOR_PLAYER_ATTACK:
      trigger(env, Npc.QUEEN, env.meanwhile.firstBattleInTown(Town.DRASSEN) ? 8 : 9);
      return true;
    case A.SLAP:
      if (npcSoldier(env, Npc.QUEEN)) env.meanwhile.queenAnimation(Npc.QUEEN, 'slap');
      return true;
    case A.FRUSTRATED_SLAP:
      if (npcSoldier(env, npc)) env.meanwhile.queenAnimation(npc, 'frustratedSlap');
      return true;
    case A.PUNCH_FIRST_LIVING_PC:
      punchFirstLivingPc(env, npc);
      return true;
    case A.SHOOT_ELLIOT:
      closeMenu(env);
      if (npcSoldier(env, npc) && npcSoldier(env, Npc.ELLIOT)) env.meanwhile.shootElliot(npc);
      return true;
    case A.ENDGAME_STATE_1:
      env.meanwhile.endgame(1);
      return true;
    case A.ENDGAME_STATE_2:
      closeMenu(env);
      env.meanwhile.endgame(2);
      return true;
    case A.END_DEMO:
      closeMenu(env);
      env.meanwhile.endDemo();
      return true;
    default:
      return false;
  }
}

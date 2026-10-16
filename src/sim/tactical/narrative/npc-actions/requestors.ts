// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (the requestor actions, PROMPT_PLAYER_TO_LIE,
// @src TRIGGER_MARRY_DARYL_PROMPT, REDUCE_CONRAD_SALARY_CONDITIONS), StartDialogueMessageBox, DialogueMessageBoxCallBack,
// @src ubRecordThatTriggeredLiePrompt; Tactical/Overhead.cc PlayerTeamFull. See docs/25 §3.3, §13.2.

import { i8 } from '../../../../core/int.ts';
import { Fact } from '../../../strategic/narrative/fact-ids.ts';
import { medicalRequestShownCost } from '../../../strategic/narrative/hospital.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { SkillCheckReason, skillCheck } from '../../combat/skill-check.ts';
import { createKeyObject } from '../../doors/keys.ts';
import { autoPlaceObject } from '../../inventory.ts';
import { MercStatus } from '../../profiles.ts';
import { effectiveLeadership, effectiveWisdom } from '../../skills.ts';
import { OKBREATH, OKLIFE, type Soldier, TEAM_SIZES, Team } from '../../soldier.ts';
import { soldierInventoryContext } from '../../soldier-inventory.ts';
import { teamMembers } from '../../state.ts';
import { NpcActionCode as A } from './codes.ts';
import { closeMenu, destSoldier, npcSoldier, ProfileMiscFlag2, profileOf, tactical, trigger } from './common.ts';
import type { NpcActionEnv } from './env.ts';

export const NpcRequestKind = {
  ESCORT: 'escort',
  HIRE: 'hire',
  BOXING_BET: 'boxingBet',
  FIGHT_AGAIN: 'fightAgain',
  BUY_VEST: 'buyVest',
  PAY_DOCTOR: 'payDoctor',
  FREE_TREATMENT: 'freeTreatment',
  BUY_VEHICLE: 'buyVehicle',
  SPARE_KROTT: 'spareKrott',
  MARRY_DARYL: 'marryDaryl',
  LIE: 'lie',
} as const;
export type NpcRequestKind = (typeof NpcRequestKind)[keyof typeof NpcRequestKind];

export type NpcRequestChoice = 'yes' | 'no' | 'lie';

const REQUEST_KINDS: Readonly<Record<number, NpcRequestKind>> = {
  [A.ASK_ABOUT_ESCORTING_EPC]: NpcRequestKind.ESCORT,
  [A.ASK_ABOUT_PAYING_RPC]: NpcRequestKind.HIRE,
  [A.ASK_ABOUT_PAYING_RPC_WITH_DAILY_SALARY]: NpcRequestKind.HIRE,
  [A.REDUCE_CONRAD_SALARY_CONDITIONS]: NpcRequestKind.HIRE,
  [A.DARREN_REQUESTOR]: NpcRequestKind.BOXING_BET,
  [A.FIGHT_AGAIN_REQUESTOR]: NpcRequestKind.FIGHT_AGAIN,
  [A.BUY_LEATHER_KEVLAR_VEST]: NpcRequestKind.BUY_VEST,
  [A.MEDICAL_REQUESTOR]: NpcRequestKind.PAY_DOCTOR,
  [A.MEDICAL_REQUESTOR_2]: NpcRequestKind.FREE_TREATMENT,
  [A.BUY_VEHICLE_REQUESTOR]: NpcRequestKind.BUY_VEHICLE,
  [A.KROTT_REQUESTOR]: NpcRequestKind.SPARE_KROTT,
  [A.TRIGGER_MARRY_DARYL_PROMPT]: NpcRequestKind.MARRY_DARYL,
  [A.PROMPT_PLAYER_TO_LIE]: NpcRequestKind.LIE,
};

const DEST_CHECKED: ReadonlySet<number> = new Set([
  A.REDUCE_CONRAD_SALARY_CONDITIONS,
  A.ASK_ABOUT_ESCORTING_EPC,
  A.ASK_ABOUT_PAYING_RPC,
  A.ASK_ABOUT_PAYING_RPC_WITH_DAILY_SALARY,
  A.DARREN_REQUESTOR,
  A.FIGHT_AGAIN_REQUESTOR,
  A.BUY_LEATHER_KEVLAR_VEST,
  A.MEDICAL_REQUESTOR,
  A.MEDICAL_REQUESTOR_2,
  A.BUY_VEHICLE_REQUESTOR,
  A.KROTT_REQUESTOR,
]);

const CONRAD_REDUCED_SALARY = 3300;
const VEHICLE_PRICE = 10000;
const KEY_TO_DARYLS_HOUSE = 38;
const SLOTS_KEPT_FOR_VEHICLES = 2;
const SLOTS_KEPT_FOR_THE_PAIR = 3;
const OUR_LAST_ID = TEAM_SIZES[Team.OUR] - 1;

const YesNo = { YES: 0, NO: 1 } as const;

const ANSWER_RECORDS: Readonly<Record<number, readonly [number, number]>> = {
  [A.ASK_ABOUT_PAYING_RPC]: [1, 0],
  [A.ASK_ABOUT_PAYING_RPC_WITH_DAILY_SALARY]: [1, 0],
  [A.REDUCE_CONRAD_SALARY_CONDITIONS]: [1, 2],
  [A.DARREN_REQUESTOR]: [13, 12],
  [A.FIGHT_AGAIN_REQUESTOR]: [30, 12],
  [A.BUY_LEATHER_KEVLAR_VEST]: [27, 28],
};

const FIXED_SPEAKER_RECORDS: Readonly<Record<number, readonly [number, number, number]>> = {
  [A.BUY_VEHICLE_REQUESTOR]: [Npc.GERARD, 9, 8],
  [A.KROTT_REQUESTOR]: [Npc.SERGEANT, 7, 6],
};

const LIE_RECORD = { YES: 1, NO: 2, CAUGHT: 3, BELIEVED: 4 } as const;

export interface NpcRequestDetails {
  readonly request: NpcRequestKind;
  readonly code: number;
  readonly npc: number;
  readonly src: number;
  readonly record: number;
  readonly amount?: number;
  readonly pair?: boolean;
  readonly choices: readonly NpcRequestChoice[];
}

export function isRequestorAction(code: number): boolean {
  return REQUEST_KINDS[code] !== undefined;
}

export function playerTeamFull(mercsOnTeam: number): boolean {
  return mercsOnTeam > OUR_LAST_ID - SLOTS_KEPT_FOR_VEHICLES;
}

export function handleRequestorAction(env: NpcActionEnv, npc: number, code: number, record: number): boolean {
  if (!isRequestorAction(code)) return false;
  if (code === A.REDUCE_CONRAD_SALARY_CONDITIONS) {
    const conrad = profileOf(env, Npc.CONRAD);
    if (conrad) conrad.salary = CONRAD_REDUCED_SALARY;
  }
  if (DEST_CHECKED.has(code) && destSoldier(env)?.profile !== npc) return true;
  closeMenu(env);
  env.openRequest({ code, npc, record });
  return true;
}

function johnOrMaryPartnerAlive(env: NpcActionEnv, npc: number): boolean {
  const partner = npc === Npc.JOHN ? Npc.MARY : npc === Npc.MARY ? Npc.JOHN : null;
  if (partner === null) return false;
  return profileOf(env, partner)?.mercStatus !== MercStatus.IS_DEAD;
}

export function npcRequestDetails(env: NpcActionEnv, code: number, npc: number, record: number): NpcRequestDetails {
  const request = REQUEST_KINDS[code] as NpcRequestKind;
  const src = env.host.context.srcProfile;
  const base = {
    request,
    code,
    npc,
    src,
    record,
    choices: request === NpcRequestKind.LIE ? (['yes', 'no', 'lie'] as const) : (['yes', 'no'] as const),
  };
  switch (request) {
    case NpcRequestKind.ESCORT:
      return { ...base, pair: johnOrMaryPartnerAlive(env, npc) };
    case NpcRequestKind.HIRE:
      return { ...base, amount: profileOf(env, npc)?.salary ?? 0 };
    case NpcRequestKind.BUY_VEST:
      return { ...base, amount: env.leatherJacketPrice() };
    case NpcRequestKind.PAY_DOCTOR:
      return { ...base, amount: medicalRequestShownCost(env.calcMedicalCost(npc), env.hospital.refund) };
    case NpcRequestKind.BUY_VEHICLE:
      return { ...base, amount: VEHICLE_PRICE };
    default:
      return base;
  }
}

function answerEscort(env: NpcActionEnv, profile: number): void {
  closeMenu(env);
  if (env.playerTeamFull()) {
    env.message('teamFull', profile);
    return;
  }
  if (profile === Npc.JOHN && npcSoldier(env, Npc.MARY) && env.mercsOnPlayerTeam() > OUR_LAST_ID - SLOTS_KEPT_FOR_THE_PAIR) {
    env.message('teamFull', profile);
    return;
  }
  env.recruit.recruitEpc(profile);
  const s = npcSoldier(env, profile);
  if (!s) return;
  env.message('nowEscorted', profile, env.assignment(s) + 1);
  env.setCurrentSquad(s);
  env.recruit.handleStuffForNpcEscorted(profile);
}

function answerMedical(env: NpcActionEnv, code: number, profile: number, yes: boolean): void {
  const doctor = profile === Npc.VINCE ? Npc.VINCE : Npc.STEVE;
  if (code === A.MEDICAL_REQUESTOR) trigger(env, doctor, yes ? 23 : 24);
  else if (yes) {
    if (env.checkFact(Fact.WOUNDED_MERCS_NEARBY, doctor)) trigger(env, doctor, 26);
    else if (env.checkFact(Fact.ONE_WOUNDED_MERC_NEARBY, doctor)) trigger(env, doctor, 25);
    if (doctor === Npc.VINCE) env.hospital.tempBalance = 0;
    else {
      const vince = profileOf(env, Npc.VINCE);
      if (vince) vince.balance = 0;
    }
  } else trigger(env, doctor, doctor === Npc.VINCE ? 34 : 30);
  closeMenu(env);
}

export function chooseLiar(env: NpcActionEnv): Soldier | null {
  const t = tactical(env);
  if (!t) return null;
  let liar: Soldier | null = null;
  for (const s of teamMembers(t, Team.OUR)) {
    if (!s.placed || s.life < OKLIFE || s.breath < OKBREATH) continue;
    if (!liar || effectiveWisdom(s) + effectiveLeadership(s) > effectiveWisdom(liar) + effectiveLeadership(s)) liar = s;
  }
  return liar;
}

function answerLie(env: NpcActionEnv, profile: number, record: number, choice: NpcRequestChoice): void {
  if (choice === 'yes') {
    trigger(env, profile, (record + LIE_RECORD.YES) & 0xff);
    return;
  }
  if (choice === 'no') {
    trigger(env, profile, (record + LIE_RECORD.NO) & 0xff);
    return;
  }
  const t = tactical(env);
  const liar = chooseLiar(env);
  const believed = t !== null && liar !== null && skillCheck(t, liar, SkillCheckReason.LIE_TO_QUEEN, 0) >= 0;
  trigger(env, profile, (record + (believed ? LIE_RECORD.BELIEVED : LIE_RECORD.CAUGHT)) & 0xff);
}

function answerMarryDaryl(env: NpcActionEnv, srcProfile: number, yes: boolean): void {
  const src = profileOf(env, srcProfile);
  if (src) src.miscFlags2 |= ProfileMiscFlag2.ASKED_BY_HICKS;
  if (!yes) {
    trigger(env, Npc.DARYL, 12);
    return;
  }
  const daryl = profileOf(env, Npc.DARYL);
  if (daryl) daryl.npcData = i8(srcProfile);
  const t = tactical(env);
  const s = npcSoldier(env, Npc.DARYL);
  if (t && s) {
    const key = createKeyObject(t.content, 1, KEY_TO_DARYLS_HOUSE);
    if (key) autoPlaceObject(soldierInventoryContext(t, s), s, key);
  }
  trigger(env, Npc.DARYL, 11);
}

export function answerNpcRequest(env: NpcActionEnv, request: NpcRequestDetails, choice: NpcRequestChoice): void {
  const yes = choice === 'yes';
  const profile = request.npc;
  const code = request.code;
  const fixed = FIXED_SPEAKER_RECORDS[code];
  if (fixed) {
    trigger(env, fixed[0], yes ? fixed[1] : fixed[2]);
    return;
  }
  const records = ANSWER_RECORDS[code];
  if (records) {
    trigger(env, profile, records[yes ? YesNo.YES : YesNo.NO]);
    return;
  }
  switch (code) {
    case A.ASK_ABOUT_ESCORTING_EPC:
      if (yes) answerEscort(env, profile);
      return;
    case A.MEDICAL_REQUESTOR:
    case A.MEDICAL_REQUESTOR_2:
      answerMedical(env, code, profile, yes);
      return;
    case A.PROMPT_PLAYER_TO_LIE:
      answerLie(env, profile, request.record, choice);
      return;
    case A.TRIGGER_MARRY_DARYL_PROMPT:
      answerMarryDaryl(env, request.src, yes);
      return;
  }
}

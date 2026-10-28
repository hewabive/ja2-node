// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (CHOOSE_DOCTOR, TRIGGER_VINCE_BY_LOYALTY,
// @src DOCTOR_ESCORT_PATIENTS, START_DOCTORING, VINCE_UNRECRUITABLE, ENABLE_CAMBRIA_DOCTOR_BONUS, 24_HOURS_SINCE_*,
// @src MARTHA_DIES, START_MINE, STOP_MINE, RESET_MINE_CAPTURED, SET_*_RECORD_13_USED), CHANCE_FOR_DOCTOR_TO_SAY_RANDOM_QUOTE.

import { pythSpacesAway } from '../../../../content/world/grid.ts';
import { setQuoteRecordAsUsed } from '../../../narrative/records.ts';
import { Assignment } from '../../../strategic/economy/constants.ts';
import { Fact } from '../../../strategic/narrative/fact-ids.ts';
import { HOSPITAL_PATIENT_DISTANCE, HospitalPrice } from '../../../strategic/narrative/hospital.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { eventSoldierGotHit } from '../../combat/hit.ts';
import { AimShot } from '../../combat/types.ts';
import { NOWHERE, OKLIFE, type Soldier, Team } from '../../soldier.ts';
import { teamMembers } from '../../state.ts';
import { NpcActionCode as A, NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS } from './codes.ts';
import { closeMenu, npcSoldier, tactical, trigger } from './common.ts';
import type { NpcActionEnv } from './env.ts';

export const CHANCE_FOR_DOCTOR_TO_SAY_RANDOM_QUOTE = 20;
const DOCTOR_SPOT_GRIDNO = 10343;
const PERCENT = 100;
const COIN = 2;
const BONUS_DELAY_BASE_HOURS = 24;
const BONUS_DELAY_SPREAD_HOURS = 24;
const MINUTES_PER_HOUR = 60;
const MARTHA_HIT = { weapon: 1, damage: 100, breath: 10, range: 320, special: 0 } as const;
const RECORD_13 = 13;
const PATIENT_RECORD = 2;

function availableDoctor(s: Soldier | null): Soldier | null {
  if (!s?.placed || s.team !== Team.CIV || !s.neutral || s.life < OKLIFE) return null;
  return s;
}

function chooseDoctor(env: NpcActionEnv, npc: number): void {
  let steve = availableDoctor(npcSoldier(env, Npc.STEVE));
  let vince = availableDoctor(npcSoldier(env, Npc.VINCE));
  if (!steve && !vince) return;
  const spot = env.params.gridNo(A.CHOOSE_DOCTOR, DOCTOR_SPOT_GRIDNO);
  if (steve && vince) {
    if (steve.gridNo === spot) vince = null;
    else if (vince.gridNo === spot) steve = null;
  }
  if (steve && vince) {
    if (env.random(COIN)) steve = null;
    else vince = null;
  }
  trigger(env, npc, steve ? 12 : 13);
}

function setModifier(env: NpcActionEnv, modifier: number): void {
  env.hospital.priceModifier = modifier;
}

function vinceDecides(env: NpcActionEnv, npc: number, roll: number): void {
  const modifier = env.hospital.priceModifier;
  const random =
    modifier === HospitalPrice.RANDOM_FREEBIE ||
    modifier === HospitalPrice.FREEBIE ||
    (!env.checkFact(Fact.HOSPITAL_FREEBIE_DECISION_MADE, 0) && roll < CHANCE_FOR_DOCTOR_TO_SAY_RANDOM_QUOTE);
  if (!random) {
    setModifier(env, HospitalPrice.COST);
    trigger(env, npc, 18);
    return;
  }
  env.setFactTrue(Fact.HOSPITAL_FREEBIE_DECISION_MADE);
  if (env.checkFact(Fact.LOYALTY_HIGH, npc) && env.checkFact(Fact.FACT_24_HOURS_SINCE_DOCTOR_TALKED_TO, npc)) {
    setModifier(env, HospitalPrice.FREEBIE);
    trigger(env, npc, 19);
  } else {
    setModifier(env, HospitalPrice.RANDOM_FREEBIE);
    trigger(env, npc, 20);
  }
}

function willisDecides(env: NpcActionEnv, npc: number, roll: number): void {
  if (env.checkFact(Fact.WILLIS_GIVES_DISCOUNT, npc)) {
    setModifier(env, HospitalPrice.COST);
    trigger(env, npc, 21);
    return;
  }
  if (env.checkFact(Fact.WILLIS_HEARD_ABOUT_JOEY_RESCUE, npc)) {
    setModifier(env, HospitalPrice.FREEBIE);
    trigger(env, npc, 20);
    return;
  }
  const freebie =
    env.checkFact(Fact.LOYALTY_HIGH, npc) &&
    env.checkFact(Fact.FACT_24_HOURS_SINCE_DOCTOR_TALKED_TO, npc) &&
    (env.hospital.priceModifier === HospitalPrice.FREEBIE ||
      (!env.checkFact(Fact.HOSPITAL_FREEBIE_DECISION_MADE, 0) && roll < CHANCE_FOR_DOCTOR_TO_SAY_RANDOM_QUOTE));
  setModifier(env, freebie ? HospitalPrice.FREEBIE : HospitalPrice.COST);
  trigger(env, npc, freebie ? 19 : 18);
}

function triggerVinceByLoyalty(env: NpcActionEnv, npc: number): void {
  if (env.checkFact(Fact.NPC_OWED_MONEY, npc) && npc === Npc.VINCE) {
    trigger(env, npc, 21);
    return;
  }
  if (!env.checkFact(Fact.VINCE_EXPLAINED_HAS_TO_CHARGE, npc)) {
    trigger(env, npc, 15);
    return;
  }
  if (env.checkFact(Fact.LOYALTY_LOW, npc)) {
    setModifier(env, HospitalPrice.NORMAL);
    trigger(env, npc, 16);
    return;
  }
  if (env.checkFact(Fact.LOYALTY_OKAY, npc)) {
    setModifier(env, HospitalPrice.BREAK);
    trigger(env, npc, 17);
    return;
  }
  const roll = env.preRandom(PERCENT);
  if (npc === Npc.VINCE) vinceDecides(env, npc, roll);
  else willisDecides(env, npc, roll);
}

function doctorEscortPatients(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const doctor = npcSoldier(env, npc);
  if (!t || !doctor) return;
  for (const s of teamMembers(t, Team.OUR)) {
    if (!s.placed || s.life <= 0 || s.life >= s.lifeMax) continue;
    if (env.assignment(s) === Assignment.ASSIGNMENT_HOSPITAL) continue;
    if (pythSpacesAway(s.gridNo, doctor.gridNo) >= HOSPITAL_PATIENT_DISTANCE) continue;
    env.setHospitalAssignment(s, env.hospital.priceModifier);
    trigger(env, s.profile, PATIENT_RECORD);
    s.absoluteFinalDestination = NOWHERE;
  }
  env.setFactFalse(Fact.HOSPITAL_FREEBIE_DECISION_MADE);
  setModifier(env, HospitalPrice.NORMAL);
}

function marthaDies(env: NpcActionEnv): void {
  const t = tactical(env);
  const martha = npcSoldier(env, Npc.MARTHA);
  if (!t || !martha) return;
  closeMenu(env);
  eventSoldierGotHit(
    t,
    martha,
    MARTHA_HIT.weapon,
    MARTHA_HIT.damage,
    MARTHA_HIT.breath,
    martha.direction,
    MARTHA_HIT.range,
    null,
    MARTHA_HIT.special,
    AimShot.TORSO,
  );
}

function startMine(env: NpcActionEnv, npc: number): void {
  const mine = env.mines.headMinersMine(npc);
  env.mines.playerSpokeToHeadMiner(npc);
  if (env.mines.isMineShutDown(mine)) env.mines.restartMineProduction(mine);
}

function stopMine(env: NpcActionEnv, npc: number): void {
  const mine = env.mines.headMinersMine(npc);
  if (!env.mines.isMineShutDown(mine)) env.mines.shutOffMineProduction(mine);
}

export function handleCambriaAction(env: NpcActionEnv, npc: number, code: number, _record: number): boolean {
  switch (code) {
    case A.CHOOSE_DOCTOR:
      chooseDoctor(env, npc);
      return true;
    case A.TRIGGER_VINCE_BY_LOYALTY:
      triggerVinceByLoyalty(env, npc);
      return true;
    case A.CHECK_DOCTORING_MONEY_GIVEN:
      return true;
    case A.DOCTOR_ESCORT_PATIENTS:
      doctorEscortPatients(env, npc);
      return true;
    case A.START_DOCTORING:
      env.setFactFalse(Fact.VINCE_EXPECTING_MONEY);
      trigger(env, npc, env.checkFact(Fact.PLAYER_STOLE_MEDICAL_SUPPLIES, npc) ? 28 : 35);
      return true;
    case A.VINCE_UNRECRUITABLE:
      env.setFactFalse(Fact.VINCE_RECRUITABLE);
      return true;
    case A.ENABLE_CAMBRIA_DOCTOR_BONUS: {
      const hours = BONUS_DELAY_BASE_HOURS + env.random(BONUS_DELAY_SPREAD_HOURS);
      env.addFutureDayNpcEvent(env.minutesInDay() + hours * MINUTES_PER_HOUR, NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + code, 1);
      return true;
    }
    case A.NPC_ACTION_24_HOURS_SINCE_JOEY_RESCUED:
      env.addFutureDayNpcEvent(env.minutesInDay(), Fact.FACT_24_HOURS_SINCE_JOEY_RESCUED, 1);
      return true;
    case A.NPC_ACTION_24_HOURS_SINCE_DOCTORS_TALKED_TO:
      env.addFutureDayNpcEvent(env.minutesInDay(), Fact.FACT_24_HOURS_SINCE_DOCTOR_TALKED_TO, 1);
      return true;
    case A.MARTHA_DIES:
      marthaDies(env);
      return true;
    case A.START_MINE:
      startMine(env, npc);
      return true;
    case A.STOP_MINE:
      stopMine(env, npc);
      return true;
    case A.RESET_MINE_CAPTURED:
      env.mines.resetQueenRetookMine(npc);
      return true;
    case A.SET_OSWALD_RECORD_13_USED:
    case A.SET_CALVIN_RECORD_13_USED:
    case A.SET_CARL_RECORD_13_USED:
    case A.SET_FRED_RECORD_13_USED:
    case A.SET_MATT_RECORD_13_USED:
      setQuoteRecordAsUsed(env.host, npc, RECORD_13);
      return true;
    default:
      return false;
  }
}

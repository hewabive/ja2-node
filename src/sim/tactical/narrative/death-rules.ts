// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc HandleNPCTeamMemberDeath (civilian profile cases), HandlePlayerTeamMemberDeath
// @src (SLAY, ROBOT). See docs/25 §11.12.

import { pythSpacesAway, spacesAway } from '../../../content/world/grid.ts';
import { EventKind } from '../../strategic/time/constants.ts';
import { soldierToSoldierLos } from '../combat/positions.ts';
import { AlertStatus, Attitude, NOWHERE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';
import { ASSASSINS, Fact, Loyalty, Profile, TERRORISTS, Town } from './constants.ts';

const HANS_HEARING_DISTANCE = 12;
const MARTHA_NOTICE_DISTANCE = 10;
const MAX_DISTANCE_VISIBLE = 26;
const SECOND_ATTENDANT_MINUTE = 480;
const SECOND_ATTENDANT_SPREAD = 60;
const NEXT_DAY = 1;
const Record = { HANS_BRENDA: 10, MANNY_DRUGGIST: 10, MARTHA_HEART_ATTACK: 17, CARMEN_PEACE: 29 } as const;
const PROFILE_DIED_HOOKS: ReadonlySet<number> = new Set([Profile.DYNAMO, Profile.KINGPIN, Profile.DOREEN, Profile.QUEEN]);

function findByProfile(t: TacticalState, profile: number): Soldier | null {
  return t.soldiers.find((s) => s?.placed && s.profile === profile) ?? null;
}

function robotDestroyed(t: TacticalState, ownTeam: boolean): void {
  if (!t.narrative.fact(Fact.FIRST_ROBOT_DESTROYED)) {
    t.narrative.setFactTrue(Fact.FIRST_ROBOT_DESTROYED);
    if (ownTeam) t.narrative.setFactFalse(Fact.ROBOT_READY);
  } else t.narrative.setFactTrue(Fact.SECOND_ROBOT_DESTROYED);
}

function brendaDied(t: TacticalState, old: Soldier): void {
  t.narrative.setFactTrue(Fact.BRENDA_DEAD);
  const hans = findByProfile(t, Profile.HANS);
  if (hans && hans.life >= OKLIFE && hans.neutral && spacesAway(old.gridNo, hans.gridNo) <= HANS_HEARING_DISTANCE)
    t.narrative.triggerNpcRecord(Profile.HANS, Record.HANS_BRENDA);
}

function druggistDied(t: TacticalState): void {
  const manny = findByProfile(t, Profile.MANNY);
  if (!manny || manny.life < OKLIFE) return;
  manny.ai.noiseGridNo = NOWHERE;
  manny.ai.alertStatus = AlertStatus.GREEN;
  t.narrative.triggerNpcRecord(Profile.MANNY, Record.MANNY_DRUGGIST);
}

function joeyDied(t: TacticalState, old: Soldier): void {
  const martha = findByProfile(t, Profile.MARTHA);
  if (
    martha &&
    (pythSpacesAway(martha.gridNo, old.gridNo) < MARTHA_NOTICE_DISTANCE ||
      soldierToSoldierLos(t, martha, old, MAX_DISTANCE_VISIBLE, true) !== 0)
  ) {
    t.narrative.triggerNpcRecord(Profile.MARTHA, Record.MARTHA_HEART_ATTACK);
    t.narrative.townLoyaltyChange(Town.CAMBRIA, -Loyalty.PENALTY_MARTHA_HEART_ATTACK);
  } else t.narrative.townLoyaltyChange(Town.CAMBRIA, -Loyalty.PENALTY_JOEY_KILLED);
}

export function civilianDeathRules(t: TacticalState, old: Soldier, killer: Soldier | null): void {
  const profile = old.profile;
  if (profile === Profile.BRENDA) brendaDied(t, old);
  else if (profile === Profile.PABLO)
    t.narrative.addFutureDayEvent(
      EventKind.SECOND_AIRPORT_ATTENDANT_ARRIVED,
      SECOND_ATTENDANT_MINUTE + t.rng.int(SECOND_ATTENDANT_SPREAD),
      0,
      NEXT_DAY,
    );
  else if (profile === Profile.ROBOT) robotDestroyed(t, false);
  else if (TERRORISTS.has(profile)) {
    t.narrative.terroristKilled();
    if (profile === Profile.DRUGGIST) druggistDied(t);
  } else if (ASSASSINS.has(profile)) t.narrative.assassinKilled();
  else if (profile === Profile.ELDIN) t.narrative.townLoyaltyChange(Town.BALIME, -Loyalty.PENALTY_ELDIN_KILLED);
  else if (profile === Profile.JOEY) joeyDied(t, old);
  else if (PROFILE_DIED_HOOKS.has(profile)) t.narrative.profileDied(profile, killer);
}

export function playerTeamDeathRules(t: TacticalState, old: Soldier): void {
  if (!teamMembers(t, Team.OUR).some((s) => s !== old && s.life >= OKLIFE)) return;
  if (old.profile === Profile.SLAY) {
    const carmen = findByProfile(t, Profile.CARMEN);
    if (carmen && carmen.ai.attitude === Attitude.ATTACKSLAYONLY && teamMembers(t, Team.OUR).some((s) => s.life >= OKLIFE))
      t.narrative.triggerNpcRecord(Profile.CARMEN, Record.CARMEN_PEACE);
  } else if (old.profile === Profile.ROBOT) robotDestroyed(t, true);
}

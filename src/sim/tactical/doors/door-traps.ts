// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Keys.cc HasDoorTrapGoneOff, HandleDoorTrap, ExamineDoorForTraps, AttemptToUntrapDoor,
// @src UpdateDoorPerceivedValue; Handle_Doors.cc DoTrapCheckOnStartingMenu; TacticalAI/Knowledge.cc CallAvailableEnemiesTo,
// @src CallAvailableTeamEnemiesTo, CallAvailableKingpinMenTo.

import { i8 } from '../../../core/int.ts';
import { soldierTakeDamage } from '../combat/hit.ts';
import { calcTrapDetectLevel, SkillCheckReason, skillCheck } from '../combat/skill-check.ts';
import { DamageReason } from '../combat/types.ts';
import { igniteExplosion } from '../explosions/explosion.ts';
import { wearGasMaskIfAvailable } from '../explosions/smoke.ts';
import { Profile } from '../narrative/constants.ts';
import { CivilianGroup, NO_PROFILE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';
import {
  DOOR_TRAP_NAMES,
  type Door,
  DoorTrap,
  DoorTrapFlags,
  disarmDoorTrap,
  findDoorInfo,
  HandleDoor,
  PerceivedLock,
  PerceivedTrap,
  trapFlags,
  updateDoor,
} from './door-table.ts';

const TRAP_EXPLOSION_Z = 25;
const MAX_MISC_NOISE_DURATION = 12;
const UNTRAP_DIFFICULTY_PER_LEVEL = 7;

const ElectricShock = {
  [DoorTrap.ELECTRIC]: { life: 10, breath: 3 },
  [DoorTrap.SUPER_ELECTRIC]: { life: 20, breath: 6 },
} as const;

const BREATH_PER_POINT = 1000;

export function hasDoorTrapGoneOff(t: TacticalState, s: Soldier, door: Door): boolean {
  if (door.trapId === DoorTrap.NONE) return false;
  return calcTrapDetectLevel(t, s, false) < door.trapLevel;
}

function callAvailableTeamEnemiesTo(t: TacticalState, gridNo: number, team: number): void {
  const members = teamMembers(t, team);
  if (members.length === 0) return;
  t.perception.publicNoiseGridNo[team] = gridNo;
  t.perception.publicNoiseVolume[team] = MAX_MISC_NOISE_DURATION;
  for (const s of members) {
    if (s.life < OKLIFE) continue;
    t.perceptionHooks.setNewSituation(s);
    wearGasMaskIfAvailable(t, s);
  }
}

export function callAvailableEnemiesTo(t: TacticalState, gridNo: number): void {
  for (const team of [Team.ENEMY, Team.CREATURE, Team.MILITIA]) callAvailableTeamEnemiesTo(t, gridNo, team);
}

export function callAvailableKingpinMenTo(t: TacticalState, gridNo: number): void {
  const civs = teamMembers(t, Team.CIV);
  if (civs.length === 0) return;
  t.perception.publicNoiseGridNo[Team.CIV] = gridNo;
  t.perception.publicNoiseVolume[Team.CIV] = MAX_MISC_NOISE_DURATION;
  for (const s of civs)
    if (s.life >= OKLIFE && s.civilianGroup === CivilianGroup.KINGPIN && s.profile === NO_PROFILE) t.perceptionHooks.setNewSituation(s);
}

function electrocute(t: TacticalState, s: Soldier, shock: { readonly life: number; readonly breath: number }): void {
  s.attacker = s;
  s.beingAttackedCount++;
  t.turn.attackBusyCount++;
  const breath = shock.breath + t.pre.int(shock.breath) * BREATH_PER_POINT;
  const life = shock.life + t.pre.int(shock.life);
  soldierTakeDamage(t, s, life, breath, DamageReason.ELECTRICITY, null);
}

export function handleDoorTrap(t: TacticalState, s: Soldier, door: Door): void {
  if (!(trapFlags(door.trapId) & DoorTrapFlags.SILENT))
    t.events.push({ type: 'doorTrap', soldier: s.id, gridNo: door.gridNo, trap: DOOR_TRAP_NAMES[door.trapId] ?? 'unknown' });
  switch (door.trapId) {
    case DoorTrap.EXPLOSION: {
      const grenade = t.content.items.byName.get('HAND_GRENADE')?.index;
      if (grenade !== undefined) igniteExplosion(t, null, TRAP_EXPLOSION_Z, s.gridNo, grenade, 0);
      break;
    }
    case DoorTrap.SIREN:
    case DoorTrap.SILENT_ALARM:
      callAvailableEnemiesTo(t, door.gridNo);
      break;
    case DoorTrap.BROTHEL_SIREN:
      callAvailableKingpinMenTo(t, door.gridNo);
      t.narrative.setNpcData(Profile.MADAME, 0);
      break;
    case DoorTrap.ELECTRIC:
    case DoorTrap.SUPER_ELECTRIC:
      electrocute(t, s, ElectricShock[door.trapId]);
      break;
  }
}

export function springDoorTrap(t: TacticalState, s: Soldier, gridNo: number): boolean {
  const door = findDoorInfo(t, gridNo);
  if (!door) return false;
  handleDoorTrap(t, s, door);
  const flags = trapFlags(door.trapId);
  if (!(flags & DoorTrapFlags.RECURRING)) disarmDoorTrap(t, gridNo);
  return (flags & DoorTrapFlags.STOPS_ACTION) !== 0;
}

export function examineDoorForTraps(t: TacticalState, s: Soldier, gridNo: number): boolean {
  const door = findDoorInfo(t, gridNo);
  if (!door) return false;
  if (door.trapId === DoorTrap.NONE) {
    updateDoor(t, gridNo, { perceivedTrapped: PerceivedTrap.PERCEIVED_UNTRAPPED });
    return false;
  }
  if (door.perceivedTrapped === PerceivedTrap.PROVED_TRAPPED) return true;
  if (calcTrapDetectLevel(t, s, true) < door.trapLevel) {
    updateDoor(t, gridNo, { perceivedTrapped: PerceivedTrap.PERCEIVED_UNTRAPPED });
    return false;
  }
  updateDoor(t, gridNo, { perceivedTrapped: PerceivedTrap.PROVED_TRAPPED });
  return true;
}

export function attemptToUntrapDoor(t: TacticalState, s: Soldier, gridNo: number): boolean {
  const door = findDoorInfo(t, gridNo);
  if (!door) return false;
  const reason = door.trapId === DoorTrap.EXPLOSION ? SkillCheckReason.DISARM_TRAP : SkillCheckReason.DISARM_ELECTRONIC_TRAP;
  const mod = i8(-door.trapLevel * UNTRAP_DIFFICULTY_PER_LEVEL);
  if (skillCheck(t, s, reason, mod) <= 0) return false;
  disarmDoorTrap(t, gridNo);
  return true;
}

function perceivedTrapAfter(door: Door, action: number): number {
  if (action === HandleDoor.UNTRAP) {
    if (door.trapId === DoorTrap.NONE) return PerceivedTrap.PROVED_UNTRAPPED;
    if (door.trapId !== DoorTrap.SILENT_ALARM) return PerceivedTrap.PROVED_TRAPPED;
    return door.perceivedTrapped === PerceivedTrap.PROVED_TRAPPED ? door.perceivedTrapped : PerceivedTrap.PERCEIVED_UNTRAPPED;
  }
  if (action === HandleDoor.EXAMINE) return PerceivedTrap.PROVED_TRAPPED;
  if (door.trapId === DoorTrap.SILENT_ALARM || door.trapId === DoorTrap.NONE)
    return door.perceivedTrapped === PerceivedTrap.PROVED_TRAPPED ? door.perceivedTrapped : PerceivedTrap.PERCEIVED_UNTRAPPED;
  return PerceivedTrap.PROVED_TRAPPED;
}

export function updateDoorPerceivedValue(t: TacticalState, gridNo: number, action: number): void {
  const door = findDoorInfo(t, gridNo);
  if (!door) return;
  updateDoor(t, gridNo, {
    perceivedLocked: door.locked ? PerceivedLock.LOCKED : PerceivedLock.UNLOCKED,
    perceivedTrapped: perceivedTrapAfter(door, action),
  });
}

export function doTrapCheckOnStartingMenu(t: TacticalState, s: Soldier, gridNo: number): boolean {
  const door = findDoorInfo(t, gridNo);
  if (!door?.locked || door.trapId === DoorTrap.NONE || door.perceivedTrapped !== PerceivedTrap.UNKNOWN) return false;
  if (calcTrapDetectLevel(t, s, false) < door.trapLevel) return false;
  updateDoorPerceivedValue(t, gridNo, HandleDoor.EXAMINE);
  t.events.push({
    type: 'doorResult',
    soldier: s.id,
    gridNo,
    action: 'open',
    result: 'trapNoticed',
    trap: DOOR_TRAP_NAMES[door.trapId] ?? 'unknown',
  });
  return true;
}

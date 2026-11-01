// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Rotting_Corpses.cc HandleRottingCorpses, AddCrowToCorpse, HandleCrowFlyAway; Soldier_Control.cc
// @src CrowsFlyAway; Soldier_Ani.cc AdjustToNextAnimationFrame (code 466); Overhead.cc InternalReduceAttackBusyCount (the
// @src flock of an attacked crow); Strategic/Game_Clock.cc NightTime.

import type { OpOutcome } from '../../content/anim/script.ts';
import { i16, idiv } from '../../core/int.ts';
import { roomAt } from './ai/destinations.ts';
import { anim } from './anim-states.ts';
import { changeSoldierState, initNewSoldierAnim, states } from './animation.ts';
import { isVehicleCorpse } from './combat/death.ts';
import { newSoldierCreate, randomizeNewSoldierStats, tacticalCreateSoldier } from './creation.ts';
import { Direction } from './directions.ts';
import { worldSeconds } from './explosions/state.ts';
import { NEUTRAL_POPULATION, soldierSlotTaken } from './init-list.ts';
import { addSoldierToSector, Insertion } from './insertion.ts';
import { NOWHERE } from './pathfinding.ts';
import { Opp } from './perception/opp.ts';
import { setSoldierHeight } from './roofs.ts';
import { corpseInSlot, handleCrowLeave, linkCrowToCorpse, ROTTING_STAGE2, rottingCorpseSlots } from './rotting-corpses.ts';
import { removeSoldierFromTacticalSector } from './sector-presence.ts';
import { Body, firstFreeSoldierId, OKLIFE, type Soldier, Team } from './soldier.ts';
import { type TacticalState, teamMembers } from './state.ts';
import { findRandomGridNoFromSweetSpot } from './sweet-spots.ts';

const NO_ROOM = 0;
const SECONDS_PER_HOUR = 3600;
const HOURS_PER_DAY = 24;
const NIGHT_ENDS_HOUR = 7;
const NIGHT_STARTS_HOUR = 21;
const CROWS_PER_CORPSE = 2;
const LANDING_RADIUS = 2;
const FLIGHT_RADIUS = 5;
const FLIGHT_HEIGHT = 100;
const GROUND_HEIGHT = 0;
const HEIGHT_STEP = 2;
const HEIGHT_SNAP_RANGE = 4;
const STANDING_FRAME_CHOICES = 10;
const ADJUST_TO_TARGET_HEIGHT = 466;

const isCrow = (s: Soldier) => s.bodyType === Body.CROW;

function nightTime(t: TacticalState): boolean {
  const hour = idiv(worldSeconds(t), SECONDS_PER_HOUR) % HOURS_PER_DAY;
  return hour < NIGHT_ENDS_HOUR || hour >= NIGHT_STARTS_HOUR;
}

function underground(t: TacticalState): boolean {
  return (t.sector?.z ?? 0) > 0;
}

function crowFly(t: TacticalState): number {
  return anim(t.content, 'CROW_FLY');
}

function crowsInSector(t: TacticalState): number {
  return teamMembers(t, Team.CIV).filter((s) => s.life >= OKLIFE && !s.gassed && isCrow(s)).length;
}

function addCrowToCorpse(t: TacticalState, slot: number, corpseGridNo: number): void {
  if (roomAt(t, corpseGridNo) !== NO_ROOM) return;
  const create = newSoldierCreate(Team.CIV, Body.CROW, Direction.SOUTH, corpseGridNo);
  randomizeNewSoldierStats(t, create);
  const id = firstFreeSoldierId((n) => soldierSlotTaken(t, n), Team.CIV);
  const crow = id < 0 ? null : tacticalCreateSoldier(t, create, id, NEUTRAL_POPULATION);
  if (!crow) return;
  initNewSoldierAnim(t, crow, states(t.content.animations).STANDING, t.rng.int(STANDING_FRAME_CHOICES), true);
  linkCrowToCorpse(t, crow, slot);
  const landing = findRandomGridNoFromSweetSpot(t, crow, corpseGridNo, LANDING_RADIUS);
  if (landing === NOWHERE) {
    handleCrowLeave(t, crow);
    return;
  }
  crow.insertionGridNo = landing;
  crow.insertionData = landing;
  crow.targetHeightAdjustment = GROUND_HEIGHT;
  addSoldierToSector(t, crow, { code: Insertion.GRIDNO, data: landing, direction: Direction.SOUTH }, {}, true);
}

export function handleRottingCorpses(t: TacticalState): void {
  if (nightTime(t) || underground(t)) return;
  const flock = crowsInSector(t);
  if (flock === 0) t.crows.dontAddNew = false;
  if (t.crows.dontAddNew) return;
  if (flock >= t.crows.possible) {
    t.crows.dontAddNew = true;
    return;
  }
  if (teamMembers(t, Team.CREATURE).length > 0) return;
  const slot = t.rng.int(rottingCorpseSlots(t));
  const corpse = corpseInSlot(t, slot);
  if (!corpse || isVehicleCorpse(corpse) || corpse.type !== ROTTING_STAGE2) return;
  for (let i = 0; i < CROWS_PER_CORPSE; i++) addCrowToCorpse(t, slot, corpse.gridNo);
}

function handleCrowFlyAway(t: TacticalState, s: Soldier): void {
  s.targetHeightAdjustment = FLIGHT_HEIGHT;
  const destination = findRandomGridNoFromSweetSpot(t, s, s.gridNo, FLIGHT_RADIUS);
  s.uiMovementMode = crowFly(t);
  t.gameEvents.push({ kind: 'getNewPath', soldier: s.id, destination, mode: s.uiMovementMode });
}

export function crowsFlyAway(t: TacticalState, team: number): void {
  for (const s of teamMembers(t, team)) if (isCrow(s) && s.state !== crowFly(t)) handleCrowFlyAway(t, s);
}

export function crowsSeeingAttackerFlyAway(t: TacticalState, team: number, attacker: Soldier): void {
  for (const s of teamMembers(t, team)) if (isCrow(s) && s.oppList[attacker.id] === Opp.SEEN_CURRENTLY) handleCrowFlyAway(t, s);
}

function stepTowardTargetHeight(t: TacticalState, s: Soldier, height: number): void {
  const diff = i16(height - s.targetHeightAdjustment);
  if (Math.abs(diff) <= HEIGHT_SNAP_RANGE) setSoldierHeight(t, s, s.targetHeightAdjustment);
  else setSoldierHeight(t, s, diff > 0 ? s.heightAdjustment - HEIGHT_STEP : s.heightAdjustment + HEIGHT_STEP);
}

export function crowOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (code !== ADJUST_TO_TARGET_HEIGHT) return null;
  const height = Math.trunc(s.heightAdjustment);
  if (height !== s.targetHeightAdjustment) {
    stepTowardTargetHeight(t, s, height);
    return 'continue';
  }
  if (s.targetHeightAdjustment === GROUND_HEIGHT) changeSoldierState(t, s, anim(t.content, 'CROW_EAT'));
  else removeSoldierFromTacticalSector(t, s);
  return 'stop';
}

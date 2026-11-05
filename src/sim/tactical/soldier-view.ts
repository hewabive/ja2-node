// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc RenderSMPanel (the stats, ArmourPercent, CalculateCarriedWeight, bCamo);
// @src Faces.cc HandleRenderFaceAdjustments (the hatch: OK_INTERRUPT_MERC, gfHiddenInterrupt); Soldier_Macros.h
// @src OK_INTERRUPT_MERC; Points.cc UIOKMoveDestination / Soldier_Control.cc ContinueMercMovement (the continue
// @src location); Interface.cc GetSoldierHealthString; RenderWorld.cc (the enemy glow test !bNeutral && bSide !=
// @src FRIENDLY); Interface_Panels.cc UpdateSMPanel (the climb button: FindLowerLevel or FindHigherLevel with
// @src EnoughPoints for GetAPsToClimbRoof, or FindFenceJumpDirection); Handle_UI.cc UIHandleMAdjustStanceMode (the roof
// @src edges of the stance drag); Interface_Panels.cc PrintAP (EnoughPoints for MinAPsToAttack at sLastTarget with the
// @src turning cost); Faces.cc HandleAutoFaces (sFinalDestination for the moving highlight, fGettingHit for the portrait
// @src flash) (2026-11-03); Interface_Panels.cc PrintAP and Faces.cc HandleRenderFaceAdjustments (the drug state behind
// @src the light blue AP number and the drug icons: MercUnderTheInfluence, GetDrugEffect, GetDrunkLevel; 2026-11-04);
// @src Interface_Panels.cc CheckForAndAddMercToTeamPanel (a vehicle's passengers in its squad's panel, 2026-11-05).

import type { OwnHintInputs } from '../knowledge/view.ts';
import { VehicleSeat } from '../strategic/forces/constants.ts';
import { findFenceJumpDirection } from './animation.ts';
import { minAPsToAttack } from './combat/ap.ts';
import { armourPercent, maxArmourPerClass } from './combat/armour.ts';
import { WeaponMode } from './combat/types.ts';
import { type AdrenalineView, type DrunkView, drugView } from './drugs.ts';
import { HEALTH_CATEGORIES, healthCategory, LIFELESS_HEALTH_INDEX } from './health.ts';
import { type Stance, soldierStance } from './movement-mode.ts';
import { Opp } from './perception/opp.ts';
import { carriedWeightPercentOf, enoughPoints } from './points.ts';
import { apsToClimbRoof, type RoofClimb, roofClimb } from './roofs.ts';
import { NOBODY, OKLIFE, Side, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { passengersAboard, seatedVehicleId, vehicleOfOurs } from './vehicle-presence.ts';

export interface SoldierStatsView {
  readonly agility: number;
  readonly dexterity: number;
  readonly strength: number;
  readonly leadership: number;
  readonly wisdom: number;
  readonly level: number;
  readonly marksmanship: number;
  readonly explosives: number;
  readonly mechanical: number;
  readonly medical: number;
}

export type WeaponModeView = 'single' | 'burst' | 'launcher';
export type FirstAidRole = 'medic' | 'patient';

export interface VehicleSeatView {
  readonly id: number;
  readonly driver: boolean;
}

export interface ClimbView {
  readonly roof: RoofClimb | null;
  readonly enoughAp: boolean;
  readonly fence: boolean;
}

export interface OwnSoldierFields {
  readonly bleeding: number;
  readonly breathMax: number;
  readonly morale: number;
  readonly stats: SoldierStatsView;
  readonly armour: number;
  readonly weight: number;
  readonly camo: number;
  readonly stealth: boolean;
  readonly weaponMode: WeaponModeView;
  readonly muted: boolean;
  readonly sees: readonly number[];
  readonly opponents: number;
  readonly canAct: boolean;
  readonly stance: Stance;
  readonly continueTo: number | null;
  readonly noApToFinishMove: boolean;
  readonly firstAid: FirstAidRole | null;
  readonly blinded: boolean;
  readonly climb: ClimbView;
  readonly enoughApToAttack: boolean;
  readonly destination: number;
  readonly gettingHit: boolean;
  readonly vehicle: VehicleSeatView | null;
  readonly passengers?: readonly number[];
  readonly drunk?: DrunkView;
  readonly adrenaline?: AdrenalineView;
  readonly hint: OwnHintInputs;
}

export interface OtherSoldierFields {
  readonly hostile: boolean;
  readonly healthIndex: number;
}

const WEAPON_MODES: Readonly<Record<number, WeaponModeView>> = {
  [WeaponMode.NORMAL]: 'single',
  [WeaponMode.BURST]: 'burst',
  [WeaponMode.ATTACHED]: 'launcher',
};

export function statsView(s: Soldier): SoldierStatsView {
  const st = s.stats;
  return {
    agility: st.agility,
    dexterity: st.dexterity,
    strength: st.strength,
    leadership: st.leadership,
    wisdom: st.wisdom,
    level: st.experience,
    marksmanship: st.marksmanship,
    explosives: st.explosives,
    mechanical: st.mechanical,
    medical: st.medical,
  };
}

function seenOpponents(s: Soldier, visible: ReadonlySet<number>): number[] {
  const seen: number[] = [];
  for (const id of visible) if (s.oppList[id] === Opp.SEEN_CURRENTLY) seen.push(id);
  return seen;
}

export function okInterruptMerc(t: TacticalState, s: Soldier): boolean {
  return t.turn.intList.length === 0 || !s.moved;
}

export function canActNow(t: TacticalState, s: Soldier): boolean {
  if (t.turn.hiddenInterrupt) return true;
  return t.turn.currentTeam === Team.OUR && okInterruptMerc(t, s);
}

function continueLocation(t: TacticalState, s: Soldier): number | null {
  if (!t.inCombat || s.life < OKLIFE) return null;
  if (s.goodContPath) return s.contPathLocation;
  return s.gridNo === s.finalDestination ? null : s.finalDestination;
}

function climbView(t: TacticalState, s: Soldier): ClimbView {
  const roof = roofClimb(t, s);
  return {
    roof,
    enoughAp: roof !== null && enoughPoints(t.inCombat, s, apsToClimbRoof(t, s, roof === 'down')),
    fence: findFenceJumpDirection(t, s) >= 0,
  };
}

function enoughApToAttackLastTarget(t: TacticalState, s: Soldier): boolean {
  const dontChargeReadyAPs = s.dontChargeReadyAPs;
  const minAPs = minAPsToAttack(t, s, s.lastTarget, true);
  s.dontChargeReadyAPs = dontChargeReadyAPs;
  return enoughPoints(t.inCombat, s, minAPs);
}

function seatView(t: TacticalState, s: Soldier): VehicleSeatView | null {
  const id = seatedVehicleId(t, s);
  return id === null ? null : { id, driver: s.vehicleSeat === VehicleSeat.DRIVER };
}

function firstAidRole(s: Soldier): FirstAidRole | null {
  if (s.servicePartner !== NOBODY) return 'medic';
  return s.serviceCount > 0 ? 'patient' : null;
}

export function ownSoldierFields(t: TacticalState, s: Soldier, visible: ReadonlySet<number>): OwnSoldierFields {
  const items = t.content.items;
  return {
    bleeding: s.bleeding,
    breathMax: s.breathMax,
    morale: s.morale,
    stats: statsView(s),
    armour: armourPercent(items, maxArmourPerClass(items), s),
    weight: carriedWeightPercentOf(t.content, s),
    camo: s.camo,
    stealth: s.stealthMode,
    weaponMode: WEAPON_MODES[s.weaponMode] ?? 'single',
    muted: s.muted,
    sees: seenOpponents(s, visible),
    opponents: s.ai.oppCount,
    canAct: canActNow(t, s),
    stance: soldierStance(t, s),
    continueTo: continueLocation(t, s),
    noApToFinishMove: s.noAPToFinishMove,
    firstAid: firstAidRole(s),
    blinded: s.blindedCounter > 0,
    climb: climbView(t, s),
    enoughApToAttack: enoughApToAttackLastTarget(t, s),
    destination: s.finalDestination,
    gettingHit: s.gettingHit !== 0,
    vehicle: seatView(t, s),
    ...(vehicleOfOurs(s) ? { passengers: passengersAboard(t, s) } : {}),
    ...drugView(s),
    hint: ownHintInputs(s),
  };
}

export function ownHintInputs(s: Soldier): OwnHintInputs {
  return {
    skills: [s.skillTrait1, s.skillTrait2],
    personality: s.personalityTrait,
    shock: s.shock,
    lastTarget: s.lastTarget,
    tilesMoved: s.tilesMoved,
    weightAtTurnStart: s.weightCarriedAtTurnStart,
    collapsed: s.collapsed,
    gassed: s.gassed,
    underAiControl: s.underAiControl,
  };
}

function seenHealthIndex(s: Soldier): number {
  if (s.life === 0) return LIFELESS_HEALTH_INDEX;
  return HEALTH_CATEGORIES.indexOf(healthCategory(s.life, s.lifeMax));
}

export function otherSoldierFields(s: Soldier): OtherSoldierFields {
  return {
    hostile: !s.neutral && s.side !== Side.FRIENDLY,
    healthIndex: seenHealthIndex(s),
  };
}

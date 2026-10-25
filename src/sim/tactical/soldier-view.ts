// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc RenderSMPanel (the stats, ArmourPercent, CalculateCarriedWeight, bCamo);
// @src Faces.cc HandleRenderFaceAdjustments (the hatch: OK_INTERRUPT_MERC, gfHiddenInterrupt); Soldier_Macros.h
// @src OK_INTERRUPT_MERC; Points.cc UIOKMoveDestination / Soldier_Control.cc ContinueMercMovement (the continue
// @src location); Interface.cc GetSoldierHealthString; RenderWorld.cc (the enemy glow test !bNeutral && bSide !=
// @src FRIENDLY). See docs/28 §12.1 G1-G5.

import type { OwnHintInputs } from '../knowledge/view.ts';
import { armourPercent, maxArmourPerClass } from './combat/armour.ts';
import { WeaponMode } from './combat/types.ts';
import { isGassed } from './explosions/smoke.ts';
import { HEALTH_CATEGORIES, healthCategory, LIFELESS_HEALTH_INDEX } from './health.ts';
import { Opp } from './perception/opp.ts';
import { carriedWeightPercentOf } from './points.ts';
import { NOBODY, OKLIFE, Side, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';

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
  readonly continueTo: number | null;
  readonly noApToFinishMove: boolean;
  readonly firstAid: FirstAidRole | null;
  readonly blinded: boolean;
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
    continueTo: continueLocation(t, s),
    noApToFinishMove: s.noAPToFinishMove,
    firstAid: firstAidRole(s),
    blinded: s.blindedCounter > 0,
    hint: ownHintInputs(t, s),
  };
}

export function ownHintInputs(t: TacticalState, s: Soldier): OwnHintInputs {
  return {
    skills: [s.skillTrait1, s.skillTrait2],
    personality: s.personalityTrait,
    shock: s.shock,
    lastTarget: s.lastTarget,
    tilesMoved: s.tilesMoved,
    weightAtTurnStart: s.weightCarriedAtTurnStart,
    collapsed: s.collapsed,
    gassed: isGassed(t, s),
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

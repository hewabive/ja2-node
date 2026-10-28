// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Civ_Quotes.cc GetCivType; Tactical/Handle_UI.cc IsValidTalkableNPC; Tactical/Soldier_Macros.h
// @src RPC_RECRUITED, AM_AN_EPC, AM_A_ROBOT.

import { AnimFlags } from '../../content/anim/tables.ts';
import { hasAnimFlag } from '../tactical/animation.ts';
import { Body, NO_PROFILE, type Soldier, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';

export const CivType = { NA: 0, ADULT: 1, KID: 2, MARRIED_PC: 3, ENEMY: 4 } as const;

const MARRIED_SECTOR = { x: 10, y: 6, z: 0 } as const;
const NO_CIV_GROUP = 0;
const NOT_VISIBLE = -1;

const ADULT_BODIES: ReadonlySet<number> = new Set([
  Body.REGMALE,
  Body.BIGMALE,
  Body.STOCKYMALE,
  Body.REGFEMALE,
  Body.FATCIV,
  Body.MANCIV,
  Body.MINICIV,
  Body.DRESSCIV,
  Body.CRIPPLECIV,
]);
const KID_BODIES: ReadonlySet<number> = new Set([Body.HATKIDCIV, Body.KIDCIV]);

export function getCivType(t: TacticalState, s: Soldier): number {
  if (s.profile !== NO_PROFILE) return CivType.NA;
  const sector = t.sector;
  const married = sector && sector.x === MARRIED_SECTOR.x && sector.y === MARRIED_SECTOR.y && sector.z === MARRIED_SECTOR.z;
  if (married && s.civilianGroup === NO_CIV_GROUP && s.team !== Team.OUR && s.bodyType === Body.REGFEMALE) return CivType.MARRIED_PC;
  if (s.team === Team.ENEMY && s.bodyType <= Body.REGFEMALE) return CivType.ENEMY;
  if (s.team !== Team.CIV && s.team !== Team.MILITIA) return CivType.NA;
  if (ADULT_BODIES.has(s.bodyType)) return CivType.ADULT;
  if (KID_BODIES.has(s.bodyType)) return CivType.KID;
  return CivType.NA;
}

export interface TalkableRules {
  isNpcOrRpc(profile: number): boolean;
  recruited(profile: number): boolean;
  isEpc(s: Soldier): boolean;
}

export type TalkableKind = 'npc' | 'epc' | 'civilian' | 'merc';

export function isRobotSoldier(s: Soldier): boolean {
  return s.bodyType === Body.ROBOTNOWEAPON;
}

function isVehicle(s: Soldier): boolean {
  return s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;
}

export function talkableKind(
  t: TacticalState,
  rules: TalkableRules,
  s: Soldier,
  options: { readonly give: boolean; readonly mercs: boolean; readonly talkMode: boolean },
): TalkableKind | null {
  const profiled = s.profile !== NO_PROFILE;
  let kind: TalkableKind | null = null;
  if (profiled && rules.isNpcOrRpc(s.profile) && !rules.recruited(s.profile) && !rules.isEpc(s)) kind = 'npc';
  if (profiled && (options.talkMode || options.give) && rules.isEpc(s)) kind = 'epc';
  if (s.team === Team.OUR && options.mercs && kind === null) kind = 'merc';
  if (getCivType(t, s) !== CivType.NA && !options.give) kind = 'civilian';
  if (isRobotSoldier(s) && !options.give) kind = null;
  return kind;
}

export type TalkRefusal = 'talkerIsRobot' | 'noSuchTarget' | 'targetCollapsed' | 'targetHidden' | 'notTalkable' | 'targetMoving';

export function talkableRefusal(
  t: TacticalState,
  rules: TalkableRules,
  talker: Soldier | null,
  s: Soldier,
  options: { readonly give: boolean; readonly mercs: boolean; readonly collapsed: boolean },
): TalkRefusal | null {
  if (talker && isRobotSoldier(talker)) return 'talkerIsRobot';
  if (!s.placed || s.life === 0) return 'noSuchTarget';
  if (s.collapsed && options.collapsed) return 'targetCollapsed';
  if (isVehicle(s)) return 'notTalkable';
  if (s.team !== Team.OUR && s.visible === NOT_VISIBLE) return 'targetHidden';
  if (talkableKind(t, rules, s, { ...options, talkMode: true }) === null) return 'notTalkable';
  if (!t.inCombat && hasAnimFlag(t.content, s.state, AnimFlags.MOVING)) return 'targetMoving';
  return null;
}

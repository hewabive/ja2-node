// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc CheckForAndAddMercToTeamPanel (the mercs of the current squad), PrintAP
// @src (the AP colour, dark red without the APs to attack the last target, 2026-11-03; light blue under the influence,
// @src Drugs_And_Alcohol.cc MercUnderTheInfluence, 2026-11-04), SetStatsHelp (MERC_VITAL_STATS_POPUPTEXT, the robot's
// @src STR_LATE_16), FindNextActiveAndAliveMerc;
// @src src/game/Tactical/Soldier_Macros.h IS_MERC_BODY_TYPE, AM_AN_EPC; Soldier_Create.cc (SOLDIER_VEHICLE for the
// @src HUMVEE to TANK_NE bodies); src/game/Strategic/Morale.cc GetMoraleString;
// @src src/game/Tactical/Overhead.cc CycleVisibleEnemies (the enemies a merc cycles through); Soldier_Find.cc
// @src GetSoldierFindFlags (bLife < OKLIFE unconscious, bLife == 0 dead); bCollapsed, our soldiers' own (2026-11-03).
// @src gMercProfiles[ubProfile].bSex (the texts by a merc's sex take his profile's, not his body type's) (2026-11-01).
// @src Soldier_Macros.h OK_ENTERABLE_VEHICLE, TANK; Interface_Panels.cc SetStatsHelp (VEHICLE_VITAL_STATS_POPUPTEXT),
// @src Interface.cc DrawSelectedUIAboveGuy (FONT_GRAY4 for a vehicle nobody is aboard) and Handle_UI.cc UIHandleOnMerc
// @src (no gSelectedGuy for an enterable vehicle not ours or an empty one of ours) (2026-11-05); Vehicles.cc
// @src SetVehicleValuesIntoSoldierType (a vehicle soldier's name is zVehicleName of its type and its profile the type's,
// @src which the view leaves out for a vehicle not ours, 2026-11-05).

import { Body } from '../../../content/anim/body-types.ts';
import { isVehicleBody as isVehicleBodyType, vehicleTypeOfBody } from '../../../content/strategic/vehicle-types.ts';
import { LIFELESS_HEALTH_INDEX, type PlayerView, type SoldierView } from '../../../protocol/view.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { BarValues } from './bars.ts';
import { OKLIFE } from './faces.ts';

export const OUR_TEAM = 0;
const REGFEMALE = 3;
const TANK_BODIES: ReadonlySet<number> = new Set([Body.TANK_NW, Body.TANK_NE]);
const DYING_HEALTH_INDEX = 0;
const MERC_VITAL_STATS_POPUPTEXT = 61;
const STR_LATE_16 = 15;
const VEHICLE_VITAL_STATS_POPUPTEXT = 135;
const MORALE_STRINGS = 'pMoralStrings';
const VEHICLE_NAMES = 'zVehicleName';

export type ApColour = 'dkred' | 'ltblue' | 'ltyellow' | 'ltgray';

export function ownSoldiers(view: PlayerView | null): SoldierView[] {
  return (view?.soldiers ?? []).filter((s) => s.team === OUR_TEAM).sort((a, b) => a.id - b.id);
}

export function soldierById(view: PlayerView | null, id: number | null): SoldierView | null {
  if (id === null) return null;
  return view?.soldiers.find((s) => s.id === id) ?? null;
}

export function opponentCount(s: SoldierView): number {
  return s.opponents ?? 0;
}

export function visibleEnemies(view: PlayerView | null, s: SoldierView): SoldierView[] {
  return (s.sees ?? [])
    .map((id) => soldierById(view, id))
    .filter((e): e is SoldierView => e !== null && e.hostile === true && !isDead(e))
    .sort((a, b) => a.id - b.id);
}

export function squadOf(s: SoldierView): number {
  return s.squad ?? 0;
}

export function isMercBodyType(s: SoldierView): boolean {
  return s.bodyType >= 0 && s.bodyType <= REGFEMALE;
}

export function isVehicleBody(s: Pick<SoldierView, 'bodyType'>): boolean {
  return isVehicleBodyType(s.bodyType);
}

export function hasProfile(s: Pick<SoldierView, 'profile' | 'bodyType'>): boolean {
  return s.profile !== undefined || isVehicleBody(s);
}

export function soldierName(text: UiTextService, s: Pick<SoldierView, 'name' | 'bodyType'>): string {
  if (!isVehicleBody(s)) return s.name;
  return text.string(VEHICLE_NAMES, vehicleTypeOfBody(s.bodyType)) ?? s.name;
}

export function isTank(s: SoldierView): boolean {
  return TANK_BODIES.has(s.bodyType);
}

export function okEnterableVehicle(s: SoldierView): boolean {
  return isVehicleBody(s) && !isTank(s) && !isUnconscious(s);
}

export function nobodyAboard(s: SoldierView): boolean {
  return isVehicleBody(s) && (s.passengers ?? []).length === 0;
}

export function namedUnderPointer(s: SoldierView): boolean {
  if (!isVehicleBody(s) || isOwned(s)) return true;
  return s.team !== OUR_TEAM && !okEnterableVehicle(s);
}

export function hasFemaleProfile(view: PlayerView | null, s: SoldierView): boolean {
  return view?.strategic?.mercs.find((m) => m.id === s.id)?.female === true;
}

export function isEpc(s: SoldierView): boolean {
  return s.kind === 'epc';
}

export function isRobot(s: SoldierView): boolean {
  return s.controlled !== undefined;
}

export function isInVehicle(s: SoldierView): boolean {
  return s.vehicle !== undefined && s.vehicle !== null;
}

export function onTheMap(s: SoldierView): boolean {
  return !isInVehicle(s);
}

export function isOwned(s: SoldierView): boolean {
  return s.team === OUR_TEAM && (!isVehicleBody(s) || (s.passengers ?? []).length > 0);
}

export function vehicleCarrying(view: PlayerView | null, s: SoldierView): SoldierView | null {
  if (!isInVehicle(s)) return null;
  return view?.soldiers.find((v) => v.passengers?.includes(s.id)) ?? null;
}

export function teamPanelMembers(view: PlayerView | null, squadMembers: readonly SoldierView[]): SoldierView[] {
  return squadMembers.flatMap((s) =>
    isVehicleBody(s) ? (s.passengers ?? []).flatMap((id) => soldierById(view, id) ?? []) : isInVehicle(s) ? [] : [s],
  );
}

export function isDead(s: SoldierView): boolean {
  if (s.team === OUR_TEAM) return (s.life ?? 0) <= 0;
  return s.healthIndex === LIFELESS_HEALTH_INDEX;
}

export function isUnconscious(s: SoldierView): boolean {
  if (s.team === OUR_TEAM) return (s.life ?? 0) < OKLIFE;
  return s.healthIndex === DYING_HEALTH_INDEX || s.healthIndex === LIFELESS_HEALTH_INDEX;
}

export function isCollapsed(s: SoldierView): boolean {
  if (s.team === OUR_TEAM) return s.hint?.collapsed === true;
  return isUnconscious(s);
}

export function inCombat(view: PlayerView | null): boolean {
  return (view?.combat ?? null) !== null;
}

export function ourTurn(view: PlayerView | null): boolean {
  const combat = view?.combat ?? null;
  return combat === null || combat.team === OUR_TEAM;
}

export function okInterrupt(s: SoldierView): boolean {
  return s.canAct !== false;
}

function underTheInfluence(s: Pick<SoldierView, 'drunk' | 'adrenaline'>): boolean {
  return s.drunk !== undefined || s.adrenaline !== undefined;
}

export function apColour(s: SoldierView): ApColour {
  if (s.enoughApToAttack === false) return 'dkred';
  if ((s.ap ?? 0) < 0) return 'dkred';
  if (underTheInfluence(s)) return 'ltblue';
  if (s.stealth === true) return 'ltyellow';
  return 'ltgray';
}

export function showsAp(view: PlayerView | null, s: SoldierView): boolean {
  return inCombat(view) && (s.life ?? 0) >= OKLIFE && !isDead(s);
}

export function barValues(s: SoldierView): BarValues {
  return {
    life: s.life ?? 0,
    lifeMax: s.lifeMax ?? 0,
    bleeding: s.bleeding ?? 0,
    breath: s.breath ?? 0,
    breathMax: s.breathMax ?? 0,
    morale: s.morale ?? 0,
    robot: isRobot(s),
    vehicle: false,
  };
}

const MORALE_THRESHOLDS = [80, 65, 35, 20] as const;
const MORALE_DEAD = 5;

export function moraleString(text: UiTextService, s: SoldierView): string {
  if (isDead(s)) return text.string(MORALE_STRINGS, MORALE_DEAD) ?? '';
  const morale = s.morale ?? 0;
  const level = MORALE_THRESHOLDS.findIndex((threshold) => morale > threshold);
  return text.string(MORALE_STRINGS, level < 0 ? MORALE_THRESHOLDS.length : level) ?? '';
}

export function vitalStatsHelp(text: UiTextService, s: SoldierView): string {
  const life = s.life ?? 0;
  if (life === 0) return '';
  if (isVehicleBody(s))
    return printf(text.string('TacticalStr', VEHICLE_VITAL_STATS_POPUPTEXT) ?? '', [life, s.lifeMax ?? 0, s.breath ?? 0, s.breathMax ?? 0]);
  if (isRobot(s)) return printf(text.string('gzLateLocalizedString', STR_LATE_16) ?? '', [life, s.lifeMax ?? 0]);
  return printf(text.string('TacticalStr', MERC_VITAL_STATS_POPUPTEXT) ?? '', [
    life,
    s.lifeMax ?? 0,
    s.breath ?? 0,
    s.breathMax ?? 0,
    moraleString(text, s),
  ]);
}

export function activeAndAlive(s: SoldierView): boolean {
  return !isDead(s);
}

export function nextMerc(mercs: readonly SoldierView[], current: number | null, step: 1 | -1): SoldierView | null {
  const alive = mercs.filter(activeAndAlive);
  if (alive.length === 0) return null;
  const at = alive.findIndex((s) => s.id === current);
  if (at < 0) return alive[0] ?? null;
  return alive[(at + step + alive.length) % alive.length] ?? null;
}

export function nextActiveAndAliveMerc(mercs: readonly SoldierView[], current: SoldierView): SoldierView | null {
  const mates = mercs.filter(
    (s) => s.id !== current.id && !isInVehicle(s) && squadOf(s) === squadOf(current) && okInterrupt(s) && (s.life ?? 0) >= OKLIFE,
  );
  return mates.find((s) => s.id > current.id) ?? mates[0] ?? null;
}

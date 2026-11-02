// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc CanCharacterMoveInStrategic (the escort's text by his profile's sex),
// @src Map_Screen_Interface.h MoveError;
// @src Refusal messages: Points.cc EnoughPoints (NOT_ENOUGH_APS_STR), Turn_Based_Input.cc / Handle_UI.cc (NO_PATH,
// @src MERC_IS_UNAVAILABLE_STR, NOBODY_USING_REMOTE_STR, STR_LATE_04), Weapons.cc (STR_NOT_BURST_CAPABLE), Handle_UI.cc
// @src (MSG_CANT_FIRE_HERE; UIHandleSoldierStanceChange: VEHICLES_NO_STANCE_CHANGE_STR, ROBOT_NO_STANCE_CHANGE_STR,
// @src Interface_Items.cc IsValidAmmoToReloadRobot (ROBOT_NEEDS_GIVEN_CALIBER_STR),
// @src MSG_CANT_CHANGE_STANCE, CANNOT_STANCE_CHANGE_STR), Assignments.cc CanCharacterSquad / CanCharacterSleep / CanCharacterBeAwakened / militia
// @src training checks, MapScreen.cc TellPlayerWhyHeCantCompressTime, HandleMilitiaRedistributionClick (pMapErrorString 30
// @src and 31, pMilitiaString 2), Soldier_Tile.cc CanExchangePlaces (STR_LATE_03, REFUSE_EXCHANGE_PLACES).

export interface UiTextKey {
  readonly table: string;
  readonly index: number;
}

export type RefusalShown = 'log' | 'box';

export interface RefusalMessage extends UiTextKey {
  readonly shown: RefusalShown;
}

export const MOVE_REFUSAL_INDEX: Readonly<Record<string, number>> = {
  underground: 1,
  enemiesPresent: 2,
  onAssignment: 3,
  prisoner: 5,
  inTransit: 8,
  inCombat: 11,
  vehicleEmpty: 32,
  tooInjured: 33,
  dead: 35,
  tooTired: 43,
  vehicleDamaged: 47,
  robotAlone: 49,
  escortAlone: 6,
  cannotLeaveSector: 29,
  museumChalice: 34,
};

export const FEMALE_MOVE_REFUSAL_INDEX: Readonly<Record<string, number>> = {
  escortAlone: 7,
};

const log = (table: string, index: number): RefusalMessage => ({ table, index, shown: 'log' });
const box = (table: string, index: number): RefusalMessage => ({ table, index, shown: 'box' });
const NOT_ENOUGH_APS = log('TacticalStr', 87);

export const REFUSAL_MESSAGES: Readonly<Record<string, RefusalMessage>> = {
  notEnoughAP: NOT_ENOUGH_APS,
  notEnoughAp: NOT_ENOUGH_APS,
  noPath: log('TacticalStr', 114),
  mercUnavailable: log('TacticalStr', 82),
  uncontrolledRobot: log('TacticalStr', 88),
  outOfBreath: log('gzLateLocalizedString', 3),
  noBurst: log('Message', 34),
  noRoomToFire: log('pMessageStrings', 34),
  collapsedNoStance: log('pMessageStrings', 35),
  vehicleNoStance: log('TacticalStr', 29),
  robotNoStance: log('TacticalStr', 30),
  invalidStance: log('TacticalStr', 31),
  robotNeedsCalibre: log('TacticalStr', 44),
  npcRefusesToMove: log('gzLateLocalizedString', 2),
  personRefusesToMove: log('TacticalStr', 119),
  ...Object.fromEntries(Object.entries(MOVE_REFUSAL_INDEX).map(([token, index]) => [token, box('pMapErrorString', index)])),
  notEligible: box('pMapErrorString', 18),
  squadFull: box('pMapErrorString', 19),
  squadElsewhere: box('pMapErrorString', 20),
  squadMoving: box('pMapErrorString', 36),
  squadHasVehicle: box('pMapErrorString', 37),
  cannotJoinSquad: box('pMapErrorString', 38),
  loyaltyTooLow: box('zMarksMapScreenText', 19),
  militiaFull: box('zMarksMapScreenText', 20),
  tooManyTrainers: box('gzLateLocalizedString', 46),
  walking: box('zMarksMapScreenText', 5),
  driving: box('zMarksMapScreenText', 7),
  sectorNotCleared: box('Message', 44),
  notTired: box('zMarksMapScreenText', 4),
  collapsed: box('zMarksMapScreenText', 6),
  noMercsHired: box('pMapScreenJustStartedHelpText', 0),
  noUsableMercs: box('pMapErrorString', 39),
  creatureMine: box('gzLateLocalizedString', 27),
  reassignOnTheMove: box('pMapErrorString', 41),
  samSite: box('pMapErrorString', 30),
  noMilitiaAllowed: box('pMapErrorString', 31),
  militiaInCombat: box('pMilitiaString', 2),
  emptyHelicopterHint: box('pSkyriderText', 2),
  onlyHostileCivilians: box('gzLateLocalizedString', 26),
};

export const FEMALE_REFUSAL_MESSAGES: Readonly<Record<string, RefusalMessage>> = Object.fromEntries(
  Object.entries(FEMALE_MOVE_REFUSAL_INDEX).map(([token, index]) => [token, box('pMapErrorString', index)]),
);

export function refusalOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const refusal = (data as { refusal?: unknown }).refusal;
  return typeof refusal === 'string' ? refusal : null;
}

export function refusalSoldierOf(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const soldier = (data as { soldier?: unknown }).soldier;
  return typeof soldier === 'number' ? soldier : null;
}

export function refusalMessage(token: string, female = false): RefusalMessage | null {
  return (female ? FEMALE_REFUSAL_MESSAGES[token] : undefined) ?? REFUSAL_MESSAGES[token] ?? null;
}

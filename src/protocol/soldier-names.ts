// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-13. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Create.cc TacticalCopySoldierFromCreateStruct (TacticalStr and gzLateLocalizedString
// @src entries of the default names); Utils/Text.h (ENEMY_TEAM_MERC_NAME, CREATURE_TEAM_MERC_NAME, MILITIA_TEAM_MERC_NAME,
// @src CIV_TEAM_MERC_NAME, CROW_HIT_LOCATION_STR, CIV_TEAM_MINER_NAME, STR_LATE_36).

import type { DefaultSoldierName } from '../sim/tactical/default-names.ts';
import type { UiTextKey } from './refusals.ts';

const TACTICAL_STR = 'TacticalStr';
const LATE_STRINGS = 'gzLateLocalizedString';
const ENEMY_TEAM_MERC_NAME = 90;
const CREATURE_TEAM_MERC_NAME = 91;
const MILITIA_TEAM_MERC_NAME = 92;
const CIV_TEAM_MERC_NAME = 93;
const CROW_HIT_LOCATION_STR = 105;
const CIV_TEAM_MINER_NAME = 127;
const STR_LATE_36 = 35;

const DEFAULT_NAME_KEYS: Readonly<Record<DefaultSoldierName, UiTextKey>> = {
  enemy: { table: TACTICAL_STR, index: ENEMY_TEAM_MERC_NAME },
  militia: { table: TACTICAL_STR, index: MILITIA_TEAM_MERC_NAME },
  civilian: { table: TACTICAL_STR, index: CIV_TEAM_MERC_NAME },
  miner: { table: TACTICAL_STR, index: CIV_TEAM_MINER_NAME },
  crow: { table: TACTICAL_STR, index: CROW_HIT_LOCATION_STR },
  creature: { table: TACTICAL_STR, index: CREATURE_TEAM_MERC_NAME },
  bloodcat: { table: LATE_STRINGS, index: STR_LATE_36 },
};

export const DEFAULT_SOLDIER_NAMES = Object.keys(DEFAULT_NAME_KEYS) as readonly DefaultSoldierName[];

export function defaultNameKey(name: DefaultSoldierName): UiTextKey {
  return DEFAULT_NAME_KEYS[name];
}

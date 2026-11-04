// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Control.cc GetBodyTypePaletteSubstitution; Tactical/Soldier_Control.cc
// @src EVENT_InitNewSoldierAnim (the states that create the palettes again), CreateSoldierPalettes.

import { Body } from './body-types.ts';

export const CAMO_PALETTE = 'anims/camo.col';
export const OWN_SHEET_PALETTE = '';

const CREATURE_PALETTES: Readonly<Record<number, string>> = {
  [Body.YAF_MONSTER]: 'anims/monsters/fm_brite.col',
  [Body.YAM_MONSTER]: 'anims/monsters/mn_brite.col',
  [Body.ADULTFEMALEMONSTER]: 'anims/monsters/femmon.col',
  [Body.AM_MONSTER]: 'anims/monsters/monster.col',
};
const OWN_SHEET_BODIES: ReadonlySet<number> = new Set([
  Body.QUEENMONSTER,
  Body.COW,
  Body.CROW,
  Body.BLOODCAT,
  Body.HUMVEE,
  Body.ELDORADO,
  Body.ICECREAMTRUCK,
  Body.JEEP,
  Body.ROBOTNOWEAPON,
  Body.TANK_NW,
  Body.TANK_NE,
]);
const BURNING_STATES: ReadonlySet<string> = new Set(['CHARIOTS_OF_FIRE', 'BODYEXPLODING']);
const PALETTE_RELOAD_STATES: ReadonlySet<string> = new Set(['VEHICLE_DIE', ...BURNING_STATES]);

export interface PaletteWearer {
  readonly stateName: string;
  readonly camouflaged: boolean;
}

const isMercBody = (bodyType: number) => bodyType >= Body.REGMALE && bodyType <= Body.REGFEMALE;

export function bodyTypePaletteSubstitution(bodyType: number, wearer: PaletteWearer | null): string | null {
  if (isMercBody(bodyType)) {
    if (wearer && BURNING_STATES.has(wearer.stateName)) return OWN_SHEET_PALETTE;
    return wearer?.camouflaged ? CAMO_PALETTE : null;
  }
  const creature = CREATURE_PALETTES[bodyType];
  if (creature) return creature;
  return OWN_SHEET_BODIES.has(bodyType) ? OWN_SHEET_PALETTE : null;
}

export function reloadsPalette(stateName: string): boolean {
  return PALETTE_RELOAD_STATES.has(stateName);
}

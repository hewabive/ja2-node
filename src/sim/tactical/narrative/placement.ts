// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Init_List.cc AddPlacementToWorld (the profile filter, the ice-cream truck test and the
// @src civilian quest overrides for Kingpin's men, the Queen's palace, Tixa and the freed kids). See docs/25 §4.6.

import { WORLD_COLS } from '../../../content/world/grid.ts';
import type { SectorPosition } from '../../strategic/state.ts';
import type { SoldierCreate } from '../creation.ts';
import type { ProfileProgress } from '../profiles.ts';
import { Body, CivilianGroup, NO_PROFILE, Orders } from '../soldier.ts';
import { CivGroupHostility } from './constants.ts';

export const PlacementVerdict = { CREATE: 0, SKIP: 1 } as const;

const RECRUITED = 0x01;
const EPC_ACTIVE = 0x40;
const QUEST_IN_PROGRESS = 1;
const QUEST_KINGPIN_MONEY = 4;
const FACT_KINGPIN_CAN_SEND_ASSASSINS = 276;
const FACT_QUEEN_DEAD = 170;
const FACT_KIDS_ARE_FREE = 318;
const PROFILE_HAMOUS = 63;
const PROFILE_KINGPIN = 86;
const PROFILE_QUEEN = 75;
const PROFILE_BILLY = 133;
const PROFILE_MADAME = 107;
const KINGPIN_GUARD_CENTER = 13531;
const KINGPIN_GUARD_APOTHEM = 7;
const BILLY_APOTHEM = 29;
const ALTERNATE_QUEEN_GRIDNO = 11448;
const GUARD_ORDERS = [Orders.ONGUARD, Orders.CLOSEPATROL, Orders.ONCALL] as const;

const KINGPIN_SECTOR: SectorPosition = { x: 5, y: 3, z: 0 };
const QUEEN_SECTOR: SectorPosition = { x: 3, y: 16, z: 0 };
const TIXA_SECTOR: SectorPosition = { x: 9, y: 10, z: 0 };
const KIDS_SECTOR: SectorPosition = { x: 13, y: 3, z: 0 };

export interface PlacementNarrative {
  readonly world: SectorPosition;
  profile(id: number): ProfileProgress | null;
  profileOnPlayerTeam(id: number): boolean;
  civGroupHostility(group: number): number;
  questStatus(quest: number): number;
  checkFact(id: number, profile: number): boolean;
  rawFact(id: number): number;
  inMeanwhile(): boolean;
  useAlternateQueenPosition(): boolean;
  sectorEnemyControlled(sector: SectorPosition): boolean;
  random(n: number): number;
  preRandom(n: number): number;
}

function inSector(p: ProfileProgress, s: SectorPosition): boolean {
  return p.sectorX === s.x && p.sectorY === s.y && p.sectorZ === s.z;
}

function same(a: SectorPosition, b: SectorPosition): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function profilePlacementAllowed(n: PlacementNarrative, profile: number): boolean {
  const p = n.profile(profile);
  if (!p || !inSector(p, n.world)) return false;
  if (p.miscFlags & (RECRUITED | EPC_ACTIVE)) return false;
  if (p.life === 0) return false;
  return !p.useProfileInsertion;
}

export function iceCreamTruckWithheld(n: PlacementNarrative): boolean {
  if (!n.profileOnPlayerTeam(Body.ICECREAMTRUCK)) return false;
  const hamous = n.profile(PROFILE_HAMOUS);
  if (!hamous || !inSector(hamous, n.world)) return true;
  return (hamous.miscFlags & RECRUITED) !== 0;
}

function pickGridNo(n: PlacementNarrative, apothem: number): number {
  const span = 2 * apothem + 1;
  const dx = n.random(span) - apothem;
  const dy = n.random(span) - apothem;
  return KINGPIN_GUARD_CENTER + dx + dy * WORLD_COLS;
}

function kingpinGuardsAlerted(n: PlacementNarrative): boolean {
  if (n.civGroupHostility(CivilianGroup.KINGPIN) === CivGroupHostility.WILL_BECOME_HOSTILE) return true;
  return n.questStatus(QUEST_KINGPIN_MONEY) === QUEST_IN_PROGRESS && n.checkFact(FACT_KINGPIN_CAN_SEND_ASSASSINS, PROFILE_KINGPIN);
}

function kingpinOverride(n: PlacementNarrative, pp: SoldierCreate): number {
  if (pp.civilianGroup !== CivilianGroup.KINGPIN || !kingpinGuardsAlerted(n)) return PlacementVerdict.CREATE;
  if (pp.profile === NO_PROFILE) {
    pp.insertionGridNo = pickGridNo(n, KINGPIN_GUARD_APOTHEM);
    pp.orders = GUARD_ORDERS[n.preRandom(GUARD_ORDERS.length)] ?? Orders.ONGUARD;
  } else if (pp.profile === PROFILE_BILLY) {
    pp.insertionGridNo = pickGridNo(n, BILLY_APOTHEM);
    pp.orders = Orders.SEEKENEMY;
  } else if (pp.profile === PROFILE_MADAME) return PlacementVerdict.SKIP;
  return PlacementVerdict.CREATE;
}

function queenPalaceOverride(n: PlacementNarrative, pp: SoldierCreate): number {
  if (n.rawFact(FACT_QUEEN_DEAD) !== 0) return pp.civilianGroup === CivilianGroup.QUEENS ? PlacementVerdict.SKIP : PlacementVerdict.CREATE;
  if (n.useAlternateQueenPosition() && pp.profile === PROFILE_QUEEN) pp.insertionGridNo = ALTERNATE_QUEEN_GRIDNO;
  return pp.civilianGroup !== CivilianGroup.QUEENS ? PlacementVerdict.SKIP : PlacementVerdict.CREATE;
}

function isKid(body: number): boolean {
  return body === Body.HATKIDCIV || body === Body.KIDCIV;
}

export function civilianPlacementOverride(n: PlacementNarrative, pp: SoldierCreate): number {
  const world = n.world;
  if (same(world, KINGPIN_SECTOR)) return kingpinOverride(n, pp);
  if (same(world, QUEEN_SECTOR) && !n.inMeanwhile()) return queenPalaceOverride(n, pp);
  if (same(world, TIXA_SECTOR)) {
    const liberated = !n.sectorEnemyControlled(TIXA_SECTOR);
    return liberated && pp.profile === NO_PROFILE && !isKid(pp.bodyType) ? PlacementVerdict.SKIP : PlacementVerdict.CREATE;
  }
  if (same(world, KIDS_SECTOR) && n.checkFact(FACT_KIDS_ARE_FREE, 0) && isKid(pp.bodyType)) return PlacementVerdict.SKIP;
  return PlacementVerdict.CREATE;
}

export function profileUsesInsertionData(world: SectorPosition, p: ProfileProgress): boolean {
  if (!inSector(p, world)) return false;
  if (p.miscFlags & (RECRUITED | EPC_ACTIVE)) return false;
  return p.life !== 0 && p.useProfileInsertion;
}

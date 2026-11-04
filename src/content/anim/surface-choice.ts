// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Control.cc DetermineSoldierAnimationSurface (with gusQueenMonsterSpitAnimPerDir and
// @src the water, second pistol and injured substitutions, 2026-11-04)

import type { HandClass } from '../items/items.ts';
import { type AnimationTables, INVALID_SURFACE, stateId } from './tables.ts';

export const BodyType = { REGMALE: 0, BIGMALE: 1, STOCKYMALE: 2, REGFEMALE: 3 } as const;
export const SubAnimFlags = { BIGGUY_SHOOT2: 0x1, BIGGUY_THREATEN_STANCE: 0x2 } as const;
const INJURED_LIFE = 30;
const LAST_MERC_BODY = BodyType.REGFEMALE;
const WATER_TWO_HANDED = 0;
const WATER_OTHER_HAND = 1;
const QUEEN_SPIT_TOWARD_SOUTHWEST = 'QUEENMONSTERSPIT_SW';
const QUEEN_SPIT_PER_DIRECTION = [
  'QUEENMONSTERSPIT_NE',
  'QUEENMONSTERSPIT_E',
  'QUEENMONSTERSPIT_SE',
  'QUEENMONSTERSPIT_S',
  'QUEENMONSTERSPIT_SW',
  'QUEENMONSTERSPIT_SW',
  'QUEENMONSTERSPIT_SW',
  'QUEENMONSTERSPIT_NE',
] as const;
const BIG_GUY_THREATEN_STANCE: Readonly<Record<string, string>> = {
  BGMSTANDING: 'BGMTHREATENSTAND',
  BGMWALKING: 'BGMWALK2',
  BGMRUNNING: 'BGMRUN2',
  BGMRAISE: 'BGMRAISE2',
};

export interface SurfaceQuery {
  readonly bodyType: number;
  readonly state: number;
  readonly hand: HandClass;
  readonly secondHandOneHandedGun: boolean;
  readonly life: number;
  readonly subFlags: number;
  readonly inWater: boolean;
  readonly queenSpitDirection: () => number;
}

interface ItemSurface {
  readonly surface: number;
  readonly adjustedForItem: boolean;
}

const surfaceIds = new WeakMap<AnimationTables, ReadonlyMap<string, number>>();

export function surfaceId(tables: AnimationTables, name: string): number {
  let ids = surfaceIds.get(tables);
  if (!ids) {
    ids = new Map(tables.surfaces.map((s) => [s.name, s.id]));
    surfaceIds.set(tables, ids);
  }
  const id = ids.get(name);
  if (id === undefined) throw new RangeError(`unknown animation surface ${name}`);
  return id;
}

function valid(surface: number | undefined): surface is number {
  return surface !== undefined && surface !== INVALID_SURFACE;
}

function bigGuySurface(tables: AnimationTables, surface: number, subFlags: number): number {
  let chosen = surface;
  if (subFlags & SubAnimFlags.BIGGUY_SHOOT2 && chosen === surfaceId(tables, 'BGMSTANDAIM2')) chosen = surfaceId(tables, 'BGMSTANDAIM');
  if (subFlags & SubAnimFlags.BIGGUY_THREATEN_STANCE) {
    const threaten = BIG_GUY_THREATEN_STANCE[tables.surfaces[chosen]?.name ?? ''];
    if (threaten) chosen = surfaceId(tables, threaten);
  }
  return chosen;
}

function midWaterSurface(tables: AnimationTables, surface: number, q: SurfaceQuery): number {
  const handIndex = q.hand === 'rifle' ? WATER_TWO_HANDED : WATER_OTHER_HAND;
  const water = tables.midWaterSurfaces[q.bodyType]?.[q.state]?.[handIndex];
  return valid(water) ? water : surface;
}

function itemSubSurface(tables: AnimationTables, surface: number, q: SurfaceQuery): ItemSurface {
  const sub = tables.itemSubSurfaces[q.bodyType]?.[q.state];
  return valid(sub) ? { surface: sub, adjustedForItem: true } : { surface, adjustedForItem: false };
}

function handItemSurface(tables: AnimationTables, surface: number, q: SurfaceQuery): ItemSurface {
  if (q.hand === 'nothing') {
    if (q.state !== stateId(tables, 'STANDING')) return itemSubSurface(tables, surface, q);
    return { surface: tables.nothingBreath[q.bodyType] ?? surface, adjustedForItem: true };
  }
  if (q.hand === 'rifle') return { surface, adjustedForItem: false };
  const pistol = itemSubSurface(tables, surface, q);
  const twoPistols = tables.doubleHandedStanding;
  if (twoPistols.state !== q.state || !q.secondHandOneHandedGun) return pistol;
  return { surface: twoPistols.surfaces[q.bodyType] ?? pistol.surface, adjustedForItem: true };
}

function injuredSurface(tables: AnimationTables, chosen: ItemSurface, q: SurfaceQuery): number {
  if (q.life >= INJURED_LIFE) return chosen.surface;
  const injured = chosen.adjustedForItem ? tables.injuredNothingWalk : tables.injuredRifleWalk;
  if (injured.state !== q.state) return chosen.surface;
  return injured.surfaces[q.bodyType] ?? chosen.surface;
}

export function chooseSurface(tables: AnimationTables, q: SurfaceQuery): number {
  const surface = tables.bodySurfaces[q.bodyType]?.[q.state] ?? INVALID_SURFACE;
  if (surface === INVALID_SURFACE) return INVALID_SURFACE;
  if (surface === surfaceId(tables, QUEEN_SPIT_TOWARD_SOUTHWEST)) {
    return surfaceId(tables, QUEEN_SPIT_PER_DIRECTION[q.queenSpitDirection()] ?? QUEEN_SPIT_TOWARD_SOUTHWEST);
  }
  if (q.bodyType > LAST_MERC_BODY) return surface;
  const stance = bigGuySurface(tables, surface, q.subFlags);
  if (q.inWater) return midWaterSurface(tables, stance, q);
  return injuredSurface(tables, handItemSurface(tables, stance, q), q);
}

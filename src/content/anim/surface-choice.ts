// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Control.cc DetermineSoldierAnimationSurface; see docs/06 §1.2

import type { HandClass } from '../items/weapons.ts';
import { type AnimationTables, INVALID_SURFACE, stateId } from './tables.ts';

export const BodyType = { REGMALE: 0, BIGMALE: 1, STOCKYMALE: 2, REGFEMALE: 3 } as const;
export const SubAnimFlags = { BIGGUY_SHOOT2: 0x1, BIGGUY_THREATEN_STANCE: 0x2 } as const;
const INJURED_LIFE = 30;
const LAST_MERC_BODY = BodyType.REGFEMALE;

export interface SurfaceQuery {
  readonly bodyType: number;
  readonly state: number;
  readonly hand: HandClass;
  readonly secondHandPistol: boolean;
  readonly life: number;
  readonly subFlags: number;
}

function surfaceByName(tables: AnimationTables, name: string): number {
  const s = tables.surfaces.find((x) => x.name === name);
  if (!s) throw new RangeError(`unknown animation surface ${name}`);
  return s.id;
}

export function chooseSurface(tables: AnimationTables, q: SurfaceQuery): number {
  let surface = tables.bodySurfaces[q.bodyType]?.[q.state] ?? INVALID_SURFACE;
  if (surface === INVALID_SURFACE) return INVALID_SURFACE;
  if (q.bodyType > LAST_MERC_BODY) return surface;

  if (q.subFlags & SubAnimFlags.BIGGUY_SHOOT2 && surface === surfaceByName(tables, 'BGMSTANDAIM2'))
    surface = surfaceByName(tables, 'BGMSTANDAIM');
  if (q.subFlags & SubAnimFlags.BIGGUY_THREATEN_STANCE) {
    const threaten: Record<string, string> = {
      BGMSTANDING: 'BGMTHREATENSTAND',
      BGMWALKING: 'BGMWALK2',
      BGMRUNNING: 'BGMRUN2',
      BGMRAISE: 'BGMRAISE2',
    };
    const name = tables.surfaces[surface]?.name ?? '';
    const replacement = threaten[name];
    if (replacement) surface = surfaceByName(tables, replacement);
  }

  const itemSub = tables.itemSubSurfaces[q.bodyType]?.[q.state];
  const standing = stateId(tables, 'STANDING');
  let adjustedForItem = false;
  if (q.hand === 'nothing') {
    if (q.state === standing) {
      surface = tables.nothingBreath[q.bodyType] ?? surface;
      adjustedForItem = true;
    } else if (itemSub !== undefined) {
      surface = itemSub;
      adjustedForItem = true;
    }
  } else if (q.hand === 'pistol') {
    if (itemSub !== undefined) {
      surface = itemSub;
      adjustedForItem = true;
    }
    if (q.state === standing && q.secondHandPistol) surface = tables.doubleHandedStanding.surfaces[q.bodyType] ?? surface;
  }

  if (q.life < INJURED_LIFE && q.state === tables.injuredRifleWalk.state) {
    const sub = adjustedForItem ? tables.injuredNothingWalk : tables.injuredRifleWalk;
    surface = sub.surfaces[q.bodyType] ?? surface;
  }
  return surface;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Rotting_Corpses.cc ROTTING_CORPSE_DEFINITION (what a corpse is drawn from);
// @src src/game/TileEngine/SmokeEffects.cc AddSmokeEffectToTile (graphic per tile); Lighting.cc LightSpriteRenderAll
// @src (dynamic sprites); Structure.cc InternalSwapStructureForPartner, SaveLoadMap.cc (tile changes); Bullets.cc
// @src UpdateBullets (where a bullet tile is drawn), HandleBulletSpecialFlags (the knife's tile, its direction and the
// @src tile it hangs on); Physics.cc PhysicsMoveObject (a thrown object's tile at its position, raised by the land
// @src height under it; none for an armed mortar shell); Smell.cc UpdateBloodGraphics (the pool a tile shows). See
// @src docs/28 §12.1 G8.

import { WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { i16 } from '../../core/int.ts';
import { type Bullet, bulletHeightPixels, bulletWorldXY, drawnInFlight, isKnife, knifeDirection } from './combat/bullets.ts';
import { heightUnitsToPixels, objectDrawnInFlight, toGridNo } from './explosions/physics.ts';
import { ANY_SMOKE, SmokeTile, smokeEffectIdFromFlags } from './explosions/smoke.ts';
import type { RealObject } from './explosions/state.ts';
import { type LightSprite, LightSpriteFlags } from './lighting/lighting.ts';
import { type MapChange, MapChangeKind, mapChangeTile } from './map-changes.ts';
import { shownBloodPools } from './smell.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export type SoldierPaletteNames = readonly [hair: string, skin: string, vest: string, pants: string];

export interface CorpseView {
  readonly gridNo: number;
  readonly level: number;
  readonly type: number;
  readonly direction: number;
  readonly bodyType: number;
  readonly palettes?: SoldierPaletteNames;
  readonly camo?: boolean;
}

export interface SmokeTileView {
  readonly gridNo: number;
  readonly level: number;
  readonly effect: string;
  readonly dissipating?: boolean;
}

export type { KnowledgeLight as WorldLightView, KnowledgeLightSprite as LightSpriteView } from '../knowledge/view.ts';

export interface BloodPoolView {
  readonly gridNo: number;
  readonly strength: number;
  readonly creature?: boolean;
}

export type TileChangeKind = 'remove' | 'add';

export interface TileChangeView {
  readonly kind: TileChangeKind;
  readonly gridNo: number;
  readonly level: number;
  readonly tile: number;
}

export interface KnifeFlight {
  readonly anchor: number;
  readonly direction: number;
  readonly since: number;
}

export interface BulletView {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly knife?: KnifeFlight;
  readonly item?: string;
}

const LEVELS = [0, 1] as const;

export function corpseViews(t: TacticalState): CorpseView[] {
  return t.corpses.map((c) => ({
    gridNo: c.gridNo,
    level: c.level,
    type: c.type,
    direction: c.direction,
    bodyType: c.bodyType,
    ...(c.palettes ? { palettes: c.palettes } : {}),
    ...(c.camo ? { camo: true } : {}),
  }));
}

function anySmokeCloud(t: TacticalState): boolean {
  return t.explosives.smokeClouds.some((c) => c !== null);
}

function effectNames(t: TacticalState): Map<number, string> {
  const names = new Map<number, string>();
  for (const type of t.content.explosions.smokeEffects.values()) names.set(type.id, type.name);
  return names;
}

export function smokeViews(t: TacticalState): SmokeTileView[] {
  if (!anySmokeCloud(t)) return [];
  const names = effectNames(t);
  const out: SmokeTileView[] = [];
  for (const level of LEVELS) {
    const tiles = t.explosives.smokeTiles[level];
    for (let g = 0; g < WORLD_MAX; g++) {
      const flags = tiles[g] ?? 0;
      if (!(flags & ANY_SMOKE)) continue;
      const effect = names.get(smokeEffectIdFromFlags(flags));
      if (effect === undefined) continue;
      out.push({ gridNo: g, level, effect, ...(flags & SmokeTile.DISSIPATING ? { dissipating: true } : {}) });
    }
  }
  return out;
}

function shining(l: LightSprite | null | undefined): l is LightSprite {
  return !!l && (l.flags & LightSpriteFlags.ACTIVE) !== 0 && (l.flags & LightSpriteFlags.ON) !== 0 && l.x < WORLD_COLS;
}

export function dynamicLightSprites(t: TacticalState): LightSprite[] {
  const sprites: (LightSprite | null | undefined)[] = [
    ...t.soldiers.map((s) => s?.muzzleFlashLight),
    ...t.explosives.aniTiles.map((a) => (a.kind === 'explosion' ? a.light : null)),
    ...t.explosives.lights.map((l) => l?.sprite),
  ];
  return sprites.filter(shining);
}

function tileChangeKind(c: MapChange): TileChangeKind | null {
  if (c.kind === MapChangeKind.REMOVE) return 'remove';
  if (c.kind === MapChangeKind.ADD) return 'add';
  return null;
}

export function bloodViews(t: TacticalState): BloodPoolView[] {
  return shownBloodPools(t.smell).map((p) => ({ gridNo: p.gridNo, strength: p.strength, ...(p.creature ? { creature: true } : {}) }));
}

export function tileChangeViews(t: TacticalState): TileChangeView[] {
  const out: TileChangeView[] = [];
  for (const c of t.mapChanges) {
    const kind = tileChangeKind(c);
    const tile = kind === null ? null : mapChangeTile(t, c);
    if (kind !== null && tile !== null) out.push({ kind, gridNo: c.gridNo, level: c.level, tile });
  }
  return out;
}

export function bulletViews(t: TacticalState, shown: (firer: Soldier) => boolean, since: (b: Bullet) => number): BulletView[] {
  const bullets = t.bullets.filter((b) => drawnInFlight(b) && shown(b.firer)).map((b) => bulletView(b, since));
  return [...bullets, ...thrownViews(t, shown)];
}

function thrownViews(t: TacticalState, shown: (thrower: Soldier) => boolean): BulletView[] {
  return t.explosives.objects.flatMap((o) => (o && objectDrawnInFlight(t, o) && (!o.owner || shown(o.owner)) ? [thrownView(t, o)] : []));
}

function thrownView(t: TacticalState, o: RealObject): BulletView {
  const land = t.world.level.heights[toGridNo(o.position)] ?? 0;
  const at = { x: i16(Math.trunc(o.position.x)), y: i16(Math.trunc(o.position.y)) };
  const item = t.content.items.byIndex.get(o.object.item)?.name ?? String(o.object.item);
  return { ...at, z: heightUnitsToPixels(o.position.z) + land, item };
}

function bulletView(b: Bullet, since: (b: Bullet) => number): BulletView {
  const at = { ...bulletWorldXY(b), z: bulletHeightPixels(b) };
  return isKnife(b) ? { ...at, knife: { anchor: b.firer.gridNo, direction: knifeDirection(b), since: since(b) } } : at;
}

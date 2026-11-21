// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Lighting.cc LightTileBlocked, LightTileHasWall, LightIlluminateWall, LightTrueLevel,
// @src LightAddTileNode, LightSubtractTileNode, LightAddTile, LightSubtractTile, LightResetAllTiles, LightFindNextRay,
// @src LightSetBaseLevel, LightDraw, LightErase, LightSpriteGetFree, LightSpriteCreate, LightSpriteDestroy,
// @src LightSpriteRenderAll, LightSpritePosition, LightSpritePower; TileEngine/Isometric_Utils.h MAPROWCOLTOPOS;
// @src TileEngine/Fog_Of_War.cc RemoveFogFromGridNo;
// @src TileEngine/LoadSaveLightSprite.cc ExtractLightSprite; TileEngine/WorldDef.cc LoadMapLights, LoadWorldFromSGPFile
// @src (ambient light); TileEngine/Environment.cc TurnOnNightLights, TurnOffNightLights, TurnOnPrimeLights, TurnOffPrimeLights,
// @src GetTimeOfDayAmbientLightLevel (read underground through a port);
// @src TileEngine/Environment.h light hours; Tactical/PathAI.cc InternalDoorTravelCost (perceived, no
// @src soldier); Tactical/OppList.cc gbLightSighting, AdjustMaxSightRangeForEnvEffects.

import type { MapDef, MapLights } from '../../../content/formats/map.ts';
import { WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../../../content/world/grid.ts';
import type { Level } from '../../../content/world/level.ts';
import { LIGHT_BACKLIGHT, LIGHT_NEW_RAY, type LightTemplate, lightTemplateKey } from '../../../content/world/light-templates.ts';
import { isDoorTravelCost, TravelCost } from '../../../content/world/movement-costs.ts';
import { has, StructureFlags } from '../../../content/world/structures.ts';
import { clamp, i16, idiv, u8, u32 } from '../../../core/int.ts';
import { lightChanged } from '../change-counts.ts';
import { doorObstacleIfClosed, doorState, terrainCost } from '../pathfinding.ts';
import { atan8 } from '../perception/opp.ts';
import type { TacticalState } from '../state.ts';

export const LightSpriteFlags = {
  ACTIVE: 0x0001,
  ON: 0x0002,
  ERASE: 0x0008,
  ONROOF: 0x0020,
  MERC_LIGHT: 0x0040,
  PRIMETIME: 0x0080,
  NIGHTTIME: 0x0100,
} as const;

export const NORMAL_LIGHTLEVEL_DAY = 3;
export const NORMAL_LIGHTLEVEL_NIGHT = 12;
export const MIN_AMB_LEVEL_FOR_MERC_LIGHTS = 9;

export const LIGHT_SIGHTING: readonly number[] = [80, 86, 93, 100, 94, 88, 82, 76, 70, 64, 58, 51, 43, 30, 17, 9];

const SHADE_MAX = 1;
const SHADE_MIN = 15;
const MAX_LIGHT_SPRITES = 256;
const NIGHT_TIME_LIGHT_START_HOUR = 21;
const NIGHT_TIME_LIGHT_END_HOUR = 7;
const PRIME_TIME_LIGHT_START_HOUR = 21;
const UNPLACED_COORD = WORLD_COLS + 1;
const OFF_MAP = 0xffff;
const BACKLIGHT_TENTHS = 7;
const TENTHS = 10;

export const LitNodes = {
  LAND: 0x01,
  STRUCTS: 0x02,
  OBJECTS: 0x04,
  MERCS: 0x08,
  ROOFS: 0x10,
  ANIMATIONS: 0x20,
} as const;

export type LitTileVisitor = (g: number, amount: number, mercAmount: number, nodes: number) => void;

export interface LightSprite {
  x: number;
  y: number;
  flags: number;
  readonly template: LightTemplate;
}

export interface LightingState {
  ambient: number;
  natural: number;
  underground: boolean;
  caves: boolean;
  readonly hasLand: Uint8Array;
  readonly hasRoof: Uint8Array;
  readonly landLight: Uint8Array;
  readonly roofLight: Uint8Array;
  readonly landMaxLight: Uint8Array;
  readonly roofMaxLight: Uint8Array;
  readonly sprites: (LightSprite | null)[];
}

function occupiedTiles(offsets: Uint32Array): Uint8Array {
  const occupied = new Uint8Array(WORLD_MAX);
  for (let g = 0; g < WORLD_MAX; g++) occupied[g] = (offsets[g + 1] ?? 0) > (offsets[g] ?? 0) ? 1 : 0;
  return occupied;
}

export type UnlitLightingState = Omit<LightingState, 'landLight' | 'roofLight' | 'landMaxLight' | 'roofMaxLight'>;

export function withUnlitSums(l: UnlitLightingState): LightingState {
  return {
    ambient: l.ambient,
    natural: l.natural,
    underground: l.underground,
    caves: l.caves,
    hasLand: l.hasLand,
    hasRoof: l.hasRoof,
    landLight: new Uint8Array(WORLD_MAX),
    roofLight: new Uint8Array(WORLD_MAX),
    landMaxLight: new Uint8Array(WORLD_MAX),
    roofMaxLight: new Uint8Array(WORLD_MAX),
    sprites: l.sprites,
  };
}

export function createLightingState(level: Level): LightingState {
  return withUnlitSums({
    ambient: NORMAL_LIGHTLEVEL_DAY,
    natural: NORMAL_LIGHTLEVEL_DAY,
    underground: false,
    caves: false,
    hasLand: occupiedTiles(level.layers.land.offsets),
    hasRoof: occupiedTiles(level.layers.roofs.offsets),
    sprites: new Array<LightSprite | null>(MAX_LIGHT_SPRITES).fill(null),
  });
}

export function adjustMaxSightRangeForEnvEffects(lightLevel: number, distance: number): number {
  return idiv(distance * (LIGHT_SIGHTING[lightLevel] ?? 0), 100);
}

export function lightTrueLevel(t: TacticalState, g: number, level: number): number {
  const l = t.lighting;
  const roof = level !== 0;
  if (!(roof ? l.hasRoof : l.hasLand)[g]) return l.ambient;
  const sum = (roof ? l.roofLight : l.landLight)[g] ?? 0;
  return clamp(l.natural - sum, SHADE_MAX, SHADE_MIN);
}

export function lightShadeLevel(t: TacticalState, g: number, level: number): number {
  const l = t.lighting;
  const strongest = (level !== 0 ? l.roofMaxLight : l.landMaxLight)[g] ?? 0;
  return clamp(l.natural - strongest, SHADE_MAX, SHADE_MIN);
}

export function surfaceAmbientLevel(t: TacticalState): number | null {
  return t.lighting.underground ? null : t.lighting.ambient;
}

export interface TimeOfDayLight {
  ambientLevel(): number | null;
}

export const NO_TIME_OF_DAY_LIGHT: TimeOfDayLight = { ambientLevel: () => null };

export function timeOfDayAmbientLevel(t: TacticalState): number | null {
  return t.lighting.underground ? t.timeOfDayLight.ambientLevel() : t.lighting.ambient;
}

function mapRowColToPos(y: number, x: number): number {
  return y < 0 || y >= WORLD_ROWS || x < 0 || x >= WORLD_COLS ? OFF_MAP : y * WORLD_COLS + x;
}

function perceivedDoorTravelCost(t: TacticalState, g: number, cost: number): number {
  const ref = doorObstacleIfClosed(cost, g);
  const replacement = ref.obstacleIfClosed ? TravelCost.DOOR : cost;
  const state = doorState(t.pathEnv, ref.door, true);
  let open: boolean;
  if (ref.door2 === -1) {
    if (!has(state, StructureFlags.ANYDOOR)) return cost;
    open = has(state, StructureFlags.OPEN);
  } else {
    const state2 = doorState(t.pathEnv, ref.door2, true);
    if (!has(state, StructureFlags.ANYDOOR) && !has(state2, StructureFlags.ANYDOOR)) return cost;
    if (!has(state, StructureFlags.OPEN) || !has(state2, StructureFlags.OPEN)) return replacement;
    open = true;
  }
  if (open) return ref.obstacleIfClosed ? terrainCost(t.pathWorld, g) : replacement;
  return ref.obstacleIfClosed ? replacement : terrainCost(t.pathWorld, g);
}

function lightTileHasWall(t: TacticalState, srcX: number, srcY: number, x: number, y: number): boolean {
  const dst = mapRowColToPos(y, x);
  const src = mapRowColToPos(srcY, srcX);
  if (dst === src || dst >= WORLD_MAX || src >= WORLD_MAX) return false;
  const cost = t.world.costs.get(dst, atan8(srcX, srcY, x, y), 0);
  if (cost === TravelCost.WALL) return true;
  if (!isDoorTravelCost(cost)) return false;
  const door = perceivedDoorTravelCost(t, dst, cost);
  return door === TravelCost.OBSTACLE || door === TravelCost.DOOR;
}

function lightTileBlocked(t: TacticalState, srcX: number, srcY: number, x: number, y: number): boolean {
  const dst = mapRowColToPos(y, x);
  const src = mapRowColToPos(srcY, srcX);
  if (dst >= WORLD_MAX || src >= WORLD_MAX) return false;
  const heights = t.world.level.heights;
  if ((heights[dst] ?? 0) > (heights[src] ?? 0)) return true;
  if (t.world.structures.find(dst, StructureFlags.WALLNWINDOW)) return false;
  return lightTileHasWall(t, srcX, srcY, x, y);
}

function stepNodes(t: TacticalState, srcX: number, srcY: number, x: number, y: number, onlyWalls: boolean): number {
  const caves = t.lighting.caves;
  const wall = !caves && lightTileHasWall(t, srcX, srcY, x, y);
  if (onlyWalls) return LitNodes.ANIMATIONS | (caves || wall ? LitNodes.STRUCTS : 0);
  const ground = caves || !wall ? LitNodes.LAND : 0;
  return LitNodes.ANIMATIONS | LitNodes.STRUCTS | LitNodes.OBJECTS | LitNodes.MERCS | ground;
}

function backlit(amount: number): number {
  return idiv(amount * BACKLIGHT_TENTHS, TENTHS);
}

function findNextRay(rays: readonly number[], from: number): number {
  let i = from;
  while (i < rays.length && !((rays[i] ?? 0) & LIGHT_NEW_RAY)) i++;
  return i;
}

type TileLighter = (sums: Uint8Array, strongest: Uint8Array, g: number, amount: number) => void;

const addLight: TileLighter = (sums, strongest, g, amount) => {
  sums[g] = u8((sums[g] ?? 0) + amount);
  strongest[g] = Math.max(strongest[g] ?? 0, amount);
};

const subtractLight: TileLighter = (sums, strongest, g, amount) => {
  const sum = sums[g] ?? 0;
  const left = amount > sum ? 0 : sum - amount;
  sums[g] = left;
  strongest[g] = Math.min(strongest[g] ?? 0, left);
};

function lightSums(t: TacticalState, apply: TileLighter): LitTileVisitor {
  const l = t.lighting;
  return (g, amount, _mercAmount, nodes) => {
    if (nodes & LitNodes.LAND) apply(l.landLight, l.landMaxLight, g, amount);
    if (nodes & LitNodes.ROOFS) apply(l.roofLight, l.roofMaxLight, g, amount);
  };
}

function resetTileLights(t: TacticalState): void {
  const l = t.lighting;
  lightChanged(t);
  l.landLight.fill(0);
  l.roofLight.fill(0);
  l.landMaxLight.fill(0);
  l.roofMaxLight.fill(0);
}

function walkLight(t: TacticalState, l: LightSprite, visit: LitTileVisitor): void {
  lightChanged(t);
  const { lights, rays } = l.template;
  const drawn = new Uint8Array(lights.length);
  const roofOnly = (l.flags & LightSpriteFlags.ONROOF) !== 0;
  let srcX = l.x;
  let srcY = l.y;
  for (let i = 0; i < rays.length; i++) {
    const ray = rays[i] ?? 0;
    if (ray & LIGHT_NEW_RAY) {
      srcX = l.x;
      srcY = l.y;
      continue;
    }
    const index = ray & ~LIGHT_BACKLIGHT;
    const node = lights[index];
    if (!node) continue;
    const x = i16(l.x + node.dx);
    const y = i16(l.y + node.dy);
    const blocked = !roofOnly && lightTileBlocked(t, srcX, srcY, x, y);
    if (blocked) i = findNextRay(rays, i);
    if (!drawn[index] && node.light) {
      const g = u32(mapRowColToPos(y, x));
      if (g < WORLD_MAX) {
        const nodes = roofOnly ? LitNodes.ROOFS : stepNodes(t, srcX, srcY, x, y, blocked);
        visit(g, node.light, ray & LIGHT_BACKLIGHT && !roofOnly ? backlit(node.light) : node.light, nodes);
      }
      drawn[index] = 1;
    }
    srcX = blocked ? l.x : x;
    srcY = blocked ? l.y : y;
  }
}

function lightDraw(t: TacticalState, l: LightSprite): void {
  walkLight(t, l, lightSums(t, addLight));
}

function lightErase(t: TacticalState, l: LightSprite): void {
  walkLight(t, l, lightSums(t, subtractLight));
}

export function traceLitTiles(t: TacticalState, l: LightSprite, visit: LitTileVisitor): void {
  walkLight(t, l, visit);
}

function placedOnMap(l: LightSprite): boolean {
  return l.x < WORLD_COLS && l.y < WORLD_ROWS;
}

export function lightSpriteCreate(t: TacticalState, name: string): LightSprite | null {
  const template = t.content.lightTemplates.get(lightTemplateKey(name)) ?? null;
  return template ? lightSpriteFromTemplate(t, template) : null;
}

export function lightSpriteFromTemplate(t: TacticalState, template: LightTemplate): LightSprite | null {
  const sprites = t.lighting.sprites;
  const slot = sprites.findIndex((l) => !l || !(l.flags & LightSpriteFlags.ACTIVE));
  if (slot < 0) return null;
  const sprite: LightSprite = {
    x: UNPLACED_COORD,
    y: UNPLACED_COORD,
    flags: LightSpriteFlags.ACTIVE,
    template,
  };
  sprites[slot] = sprite;
  return sprite;
}

export function lightSpriteDestroy(t: TacticalState, l: LightSprite): void {
  if (!(l.flags & LightSpriteFlags.ACTIVE)) return;
  if (l.flags & LightSpriteFlags.ERASE) {
    if (placedOnMap(l)) lightErase(t, l);
    l.flags &= ~LightSpriteFlags.ERASE;
  }
  l.flags &= ~LightSpriteFlags.ACTIVE;
}

export function lightSpritePower(l: LightSprite, on: boolean): void {
  l.flags = (l.flags & ~LightSpriteFlags.ON) | (on ? LightSpriteFlags.ON : 0);
}

function unlit(l: LightSprite): boolean {
  return (l.flags & (LightSpriteFlags.ACTIVE | LightSpriteFlags.ON)) === LightSpriteFlags.ACTIVE;
}

function unlitLightAt(t: TacticalState, x: number, y: number): LightSprite | null {
  return t.lighting.sprites.find((l): l is LightSprite => !!l && unlit(l) && l.x === x && l.y === y) ?? null;
}

export function switchOnCaveLightAt(t: TacticalState, g: number): void {
  if (!t.lighting.caves) return;
  const l = unlitLightAt(t, g % WORLD_COLS, idiv(g, WORLD_COLS));
  if (!l) return;
  lightSpritePower(l, true);
  lightDraw(t, l);
}

export function lightSpritePosition(t: TacticalState, l: LightSprite, x: number, y: number): void {
  if (l.x === x && l.y === y) return;
  if (l.flags & LightSpriteFlags.ERASE && placedOnMap(l)) lightErase(t, l);
  l.x = x;
  l.y = y;
  if (l.flags & LightSpriteFlags.ON && placedOnMap(l)) {
    lightDraw(t, l);
    l.flags |= LightSpriteFlags.ERASE;
  }
}

export function lightSpriteRenderAll(t: TacticalState): void {
  resetTileLights(t);
  for (const l of t.lighting.sprites) {
    if (!l) continue;
    l.flags &= ~LightSpriteFlags.ERASE;
    if (!(l.flags & LightSpriteFlags.ACTIVE) || !(l.flags & LightSpriteFlags.ON)) continue;
    lightDraw(t, l);
    l.flags |= LightSpriteFlags.ERASE;
  }
}

export function lightSetBaseLevel(t: TacticalState, intensity: number): void {
  t.lighting.ambient = intensity;
  t.lighting.natural = clamp(intensity, SHADE_MAX, SHADE_MIN);
  lightSpriteRenderAll(t);
}

function powerScheduledLights(t: TacticalState, schedule: number, on: boolean): void {
  for (const l of t.lighting.sprites) {
    if (!l || !(l.flags & LightSpriteFlags.ACTIVE) || !(l.flags & schedule) || l.flags & LightSpriteFlags.MERC_LIGHT) continue;
    lightSpritePower(l, on);
  }
}

export function turnOnNightLights(t: TacticalState): void {
  powerScheduledLights(t, LightSpriteFlags.NIGHTTIME, true);
}

export function turnOffNightLights(t: TacticalState): void {
  powerScheduledLights(t, LightSpriteFlags.NIGHTTIME, false);
}

export function turnOnPrimeLights(t: TacticalState): void {
  powerScheduledLights(t, LightSpriteFlags.PRIMETIME, true);
}

export function turnOffPrimeLights(t: TacticalState): void {
  powerScheduledLights(t, LightSpriteFlags.PRIMETIME, false);
}

export function lightTimeAt(hour: number): number {
  let time = 0;
  if (hour >= NIGHT_TIME_LIGHT_START_HOUR || hour < NIGHT_TIME_LIGHT_END_HOUR) time |= LightSpriteFlags.NIGHTTIME;
  if (hour >= PRIME_TIME_LIGHT_START_HOUR) time |= LightSpriteFlags.PRIMETIME;
  return time;
}

function scheduleFlag(flags: number): number {
  if (flags & LightSpriteFlags.PRIMETIME) return LightSpriteFlags.PRIMETIME;
  if (flags & LightSpriteFlags.NIGHTTIME) return LightSpriteFlags.NIGHTTIME;
  return 0;
}

function poweredAtLoad(t: TacticalState, flags: number, lightTime: number): boolean {
  const scheduled = flags & (LightSpriteFlags.PRIMETIME | LightSpriteFlags.NIGHTTIME);
  return !t.lighting.caves && ((flags & lightTime) !== 0 || scheduled === 0);
}

export function loadMapLights(t: TacticalState, lights: MapLights | null, hour: number): void {
  t.lighting.sprites.fill(null);
  resetTileLights(t);
  const lightTime = lightTimeAt(hour);
  for (const def of lights?.sprites ?? []) {
    const l = lightSpriteCreate(t, def.template);
    if (!l) continue;
    if (poweredAtLoad(t, def.flags, lightTime)) lightSpritePower(l, true);
    lightSpritePosition(t, l, def.x, def.y);
    l.flags |= scheduleFlag(def.flags);
  }
}

export function initLighting(t: TacticalState, map: Pick<MapDef, 'ambient' | 'lights'>, hour: number, dayAmbient: number): void {
  const l = t.lighting;
  l.underground = map.ambient !== null && map.ambient !== undefined;
  l.caves = map.ambient?.caves ?? false;
  l.ambient = map.ambient ? map.ambient.lightLevel : dayAmbient;
  loadMapLights(t, map.lights ?? null, hour);
  lightSetBaseLevel(t, l.ambient);
}

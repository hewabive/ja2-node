// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Lighting.cc IlluminationFilter, LightTrueLevel, LightAddTileNode, LightSubtractTileNode,
// @src LightAddTile, LightSubtractTile, LightResetAllTiles, LightFindNextRay, LightSetBaseLevel, LightDraw, LightErase,
// @src LightSpriteGetFree, LightSpriteCreate, LightSpriteDestroy, LightSpriteRenderAll, LightSpritePosition, LightSpritePower;
// @src TileEngine/LoadSaveLightSprite.cc ExtractLightSprite; TileEngine/WorldDef.cc LoadMapLights, LoadWorldFromSGPFile
// @src (ambient light); TileEngine/Environment.cc TurnOnNightLights, TurnOffNightLights, TurnOnPrimeLights, TurnOffPrimeLights;
// @src TileEngine/Environment.h light hours; Tactical/PathAI.cc InternalDoorTravelCost (perceived, no
// @src soldier); Tactical/OppList.cc gbLightSighting, AdjustMaxSightRangeForEnvEffects.

import type { MapDef, MapLights } from '../../../content/formats/map.ts';
import { Direction, WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../../../content/world/grid.ts';
import type { Level } from '../../../content/world/level.ts';
import { isDoorTravelCost, isOpenDoorTravelCost, TravelCost } from '../../../content/world/movement-costs.ts';
import { has, PROFILE_Z_SIZE, StructureFlags } from '../../../content/world/structures.ts';
import { clamp, i16, u8, u16, u32 } from '../../../core/int.ts';
import { doorObstacleIfClosed, doorState, terrainCost } from '../pathfinding.ts';
import { atan8 } from '../perception/opp.ts';
import type { TacticalState } from '../state.ts';
import { LIGHT_CENTRE_NODE, LIGHT_NEW_RAY, type LightNode, type LightTemplate, lightTemplate, lightTemplateKey } from './templates.ts';

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
const DIRECTION_IRRELEVANT = 9;
const STANDING_CUBES = 3;
const MIN_BOX_COLUMNS = 8;
const THREE_BOXES_HIGH = 0b0111;
const FOUR_BOXES_HIGH = 0b1111;
const UNPLACED_COORD = WORLD_COLS + 1;

const NODE_DRAWN_FULLY = 1 << 8;
const NODE_DRAWN_NONWALL = 1 << 10;

const FILTER_DIRECTION = 0x0f;
const FILTER_BLOCKED = 0x10;
const FILTER_NOTHING = 0x20;
const FILTER_ORIENTED_ONLY = 0x40;

export interface LightSprite {
  x: number;
  y: number;
  flags: number;
  readonly template: LightTemplate;
  readonly filters: Uint8Array;
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
  readonly sprites: (LightSprite | null)[];
}

function occupiedTiles(offsets: Uint32Array): Uint8Array {
  const occupied = new Uint8Array(WORLD_MAX);
  for (let g = 0; g < WORLD_MAX; g++) occupied[g] = (offsets[g + 1] ?? 0) > (offsets[g] ?? 0) ? 1 : 0;
  return occupied;
}

export function createLightingState(level: Level): LightingState {
  return {
    ambient: NORMAL_LIGHTLEVEL_DAY,
    natural: NORMAL_LIGHTLEVEL_DAY,
    underground: false,
    caves: false,
    hasLand: occupiedTiles(level.layers.land.offsets),
    hasRoof: occupiedTiles(level.layers.roofs.offsets),
    landLight: new Uint8Array(WORLD_MAX),
    roofLight: new Uint8Array(WORLD_MAX),
    sprites: new Array<LightSprite | null>(MAX_LIGHT_SPRITES).fill(null),
  };
}

export function adjustMaxSightRangeForEnvEffects(lightLevel: number, distance: number): number {
  return Math.trunc((distance * (LIGHT_SIGHTING[lightLevel] ?? 0)) / 100);
}

export function lightTrueLevel(t: TacticalState, g: number, level: number): number {
  const l = t.lighting;
  const roof = level !== 0;
  if (!(roof ? l.hasRoof : l.hasLand)[g]) return l.ambient;
  const sum = (roof ? l.roofLight : l.landLight)[g] ?? 0;
  return clamp(l.natural - sum, SHADE_MAX, SHADE_MIN);
}

export function surfaceAmbientLevel(t: TacticalState): number | null {
  return t.lighting.underground ? null : t.lighting.ambient;
}

function filterDirection(f: number): number {
  return f & FILTER_DIRECTION;
}

function isDiagonal(dir: number): boolean {
  return (dir & 1) !== 0;
}

function tileOf(x: number, y: number): number {
  return y * WORLD_COLS + x;
}

function perceivedDoorTravelCost(t: TacticalState, g: number, cost: number): { readonly cost: number; readonly doorGridNo: number } {
  const ref = doorObstacleIfClosed(cost, g);
  const replacement = ref.obstacleIfClosed ? TravelCost.DOOR : cost;
  const state = doorState(t.pathEnv, ref.door, true);
  let open: boolean;
  if (ref.door2 === -1) {
    if (!has(state, StructureFlags.ANYDOOR)) return { cost, doorGridNo: ref.door };
    open = has(state, StructureFlags.OPEN);
  } else {
    const state2 = doorState(t.pathEnv, ref.door2, true);
    if (!has(state, StructureFlags.ANYDOOR) && !has(state2, StructureFlags.ANYDOOR)) return { cost, doorGridNo: ref.door };
    if (!has(state, StructureFlags.OPEN) || !has(state2, StructureFlags.OPEN)) return { cost: replacement, doorGridNo: ref.door };
    open = true;
  }
  if (open) return { cost: ref.obstacleIfClosed ? terrainCost(t.pathWorld, g) : replacement, doorGridNo: ref.door };
  return { cost: ref.obstacleIfClosed ? replacement : terrainCost(t.pathWorld, g), doorGridNo: ref.door };
}

function facesNorthOrWest(dir: number): boolean {
  return dir === Direction.NORTH || dir === Direction.WEST;
}

function wallFilter(dir: number): number {
  return dir | FILTER_BLOCKED | (facesNorthOrWest(dir) ? FILTER_ORIENTED_ONLY : FILTER_NOTHING);
}

function doorFilter(dir: number): number {
  return dir | FILTER_BLOCKED | FILTER_ORIENTED_ONLY | (facesNorthOrWest(dir) ? 0 : FILTER_NOTHING);
}

function blocksLightAsObstacle(t: TacticalState, g: number): boolean {
  for (const s of t.world.structures.at(g)) {
    if (
      has(s.flags, StructureFlags.PASSABLE | StructureFlags.ANYDOOR | StructureFlags.WALLSTUFF | StructureFlags.TREE) ||
      s.cachedHeight < STANDING_CUBES ||
      s.cubeOffset === PROFILE_Z_SIZE
    )
      continue;
    let columns = 0;
    for (const cell of s.tile.shape) if (cell === THREE_BOXES_HIGH || cell === FOUR_BOXES_HIGH) columns++;
    if (columns >= MIN_BOX_COLUMNS) return true;
  }
  return false;
}

function illuminationFilter(t: TacticalState, srcX: number, srcY: number, x: number, y: number, onRoof: boolean): number {
  const dst = u16(tileOf(x, y));
  const src = u16(tileOf(srcX, srcY));
  if (dst >= WORLD_MAX || src >= WORLD_MAX) return DIRECTION_IRRELEVANT | FILTER_BLOCKED | FILTER_NOTHING;
  const heights = t.world.level.heights;
  if ((heights[dst] ?? 0) > (heights[src] ?? 0) || dst === src) return DIRECTION_IRRELEVANT;
  const dir = atan8(srcX, srcY, x, y);
  if (onRoof) return dir;
  let cost = t.world.costs.get(dst, dir, 0);
  const windowTile = facesNorthOrWest(dir) ? dst : src;
  if (cost === TravelCost.WALL && t.world.structures.find(windowTile, StructureFlags.WALLNWINDOW))
    return isDiagonal(dir) ? dir | FILTER_BLOCKED | FILTER_NOTHING : dir;
  if (cost === TravelCost.WALL) return wallFilter(dir);
  if (isDoorTravelCost(cost)) {
    const door = perceivedDoorTravelCost(t, dst, cost);
    if (isOpenDoorTravelCost(door.cost) && door.doorGridNo !== src) return doorFilter(dir);
    if (door.cost === TravelCost.DOOR || isDoorTravelCost(door.cost)) return doorFilter(dir);
    cost = door.cost;
  }
  if (cost === TravelCost.OBSTACLE) return blocksLightAsObstacle(t, dst) ? dir | FILTER_BLOCKED : dir;
  if (cost === TravelCost.CAVEWALL) return dir | FILTER_BLOCKED;
  return dir;
}

function findNextRay(rays: readonly number[], from: number): number {
  let i = from;
  while (i < rays.length && !((rays[i] ?? 0) & LIGHT_NEW_RAY)) i++;
  return i;
}

type TileLighter = (layer: Uint8Array, g: number, amount: number) => void;

const addLight: TileLighter = (layer, g, amount) => {
  layer[g] = u8((layer[g] ?? 0) + amount);
};

const subtractLight: TileLighter = (layer, g, amount) => {
  const sum = layer[g] ?? 0;
  layer[g] = amount > sum ? 0 : sum - amount;
};

function lightTile(t: TacticalState, x: number, y: number, amount: number, roofOnly: boolean, filter: number, apply: TileLighter): void {
  const g = u32(tileOf(x, y));
  if (g >= WORLD_MAX) return;
  if (roofOnly) apply(t.lighting.roofLight, g, amount);
  else if (!(filter & FILTER_ORIENTED_ONLY)) apply(t.lighting.landLight, g, amount);
}

function onAxis(n: LightNode): boolean {
  return n.dx === 0 || n.dy === 0;
}

function inSouthEastQuadrant(n: LightNode): boolean {
  return n.dx > 0 && n.dy > 0;
}

function inNorthWestQuadrant(n: LightNode): boolean {
  return n.dx < 0 && n.dy < 0;
}

function stepCanLight(dir: number, index: number): boolean {
  return dir === DIRECTION_IRRELEVANT ? index === LIGHT_CENTRE_NODE : !isDiagonal(dir);
}

function nodeFlagsAfterLighting(n: LightNode, dir: number, filter: number): number {
  const litFromDir = 1 << dir;
  if (onAxis(n) || inSouthEastQuadrant(n)) return litFromDir | NODE_DRAWN_FULLY;
  if (filter & FILTER_ORIENTED_ONLY) return litFromDir;
  if (inNorthWestQuadrant(n)) return litFromDir | NODE_DRAWN_NONWALL;
  return litFromDir | (facesNorthOrWest(dir) ? NODE_DRAWN_FULLY : NODE_DRAWN_NONWALL);
}

function traceLight(t: TacticalState, l: LightSprite, computeFilters: boolean, apply: TileLighter): void {
  const { lights, rays } = l.template;
  const nodeFlags = new Uint16Array(lights.length);
  const roofOnly = (l.flags & LightSpriteFlags.ONROOF) !== 0;
  const centreX = l.x;
  const centreY = l.y;
  let srcX = centreX;
  let srcY = centreY;
  for (let i = 0; i < rays.length; i++) {
    const index = rays[i] ?? 0;
    if (index & LIGHT_NEW_RAY) {
      srcX = centreX;
      srcY = centreY;
      continue;
    }
    const node = lights[index];
    if (!node) continue;
    const dstX = i16(centreX + node.dx);
    const dstY = i16(centreY + node.dy);
    const filter = computeFilters ? illuminationFilter(t, srcX, srcY, dstX, dstY, roofOnly) : (l.filters[i] ?? 0);
    if (computeFilters) l.filters[i] = filter;
    srcX = centreX;
    srcY = centreY;
    if (filter & FILTER_BLOCKED) i = findNextRay(rays, i);
    else {
      srcX += node.dx;
      srcY += node.dy;
    }
    const dir = filterDirection(filter);
    const drawn = nodeFlags[index] ?? 0;
    if (!stepCanLight(dir, index) || drawn & (1 << dir) || drawn & NODE_DRAWN_FULLY) continue;
    if (drawn & NODE_DRAWN_NONWALL && !inSouthEastQuadrant(node) && !(filter & FILTER_ORIENTED_ONLY)) {
      nodeFlags[index] = drawn | NODE_DRAWN_FULLY;
      continue;
    }
    if (filter & FILTER_NOTHING || node.light === 0) continue;
    lightTile(t, dstX, dstY, node.light, roofOnly, filter, apply);
    nodeFlags[index] = drawn | nodeFlagsAfterLighting(node, dir, filter);
  }
}

function lightDraw(t: TacticalState, l: LightSprite): void {
  traceLight(t, l, true, addLight);
}

function lightErase(t: TacticalState, l: LightSprite): void {
  traceLight(t, l, false, subtractLight);
}

function placedOnMap(l: LightSprite): boolean {
  return l.x < WORLD_COLS && l.y < WORLD_ROWS;
}

export function lightSpriteCreate(t: TacticalState, name: string): LightSprite | null {
  const template = lightTemplate(name) ?? t.content.lightTemplates.get(lightTemplateKey(name)) ?? null;
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
    filters: new Uint8Array(template.rays.length),
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
  t.lighting.landLight.fill(0);
  t.lighting.roofLight.fill(0);
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
  t.lighting.landLight.fill(0);
  t.lighting.roofLight.fill(0);
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

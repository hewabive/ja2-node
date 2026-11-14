// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Lighting.cc LightAddTileNode (ubMaxLights, ubShadeLevel), LightAddTile (each node keeps its own
// @src strongest light: the ground, the roofs, walls and doors by the filter's orientations, wall decals), LightSetBaseLevel;
// @src src/game/Tactical/Soldier_Control.cc PositionSoldierLight, CreateSoldierLight, SetSoldierPersonalLightLevel;
// @src src/game/TileEngine/Environment.cc GetTimeOfDayAmbientLightLevel; Lighting.cc LightIlluminateWall (the live
// @src structures a light is drawn over).

import type { MapDef, MapDoor } from '../../content/formats/map.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { MovementCosts, recompileLocalMovementCosts } from '../../content/world/movement-costs.ts';
import type { WorldStructures } from '../../content/world/structures.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { clamp, idiv, u8 } from '../../core/int.ts';
import type { TileChangeView } from '../../protocol/view.ts';
import { SHADE_TEXTURE_CHANNELS, ShadeChannel } from '../../render/world/instances.ts';
import { structuresAfterTileChanges, tileChangesKey } from '../../render/world/tile-changes.ts';
import type { ShadeField } from '../../render/world/world-renderer.ts';
import { EventKind } from '../../sim/strategic/time/constants.ts';
import { buildDayLightLevels, NORMAL_LIGHTLEVEL_NIGHT } from '../../sim/strategic/time/environment.ts';
import { createEventQueue } from '../../sim/strategic/time/event-queue.ts';
import { createWorldClock } from '../../sim/strategic/time/world-clock.ts';
import { createChangeCounts } from '../../sim/tactical/change-counts.ts';
import { doorGridNos } from '../../sim/tactical/doors.ts';
import {
  createLightingState,
  initLighting,
  LightSpriteFlags,
  LitNodes,
  lightSpriteDestroy,
  lightSpriteFromTemplate,
  lightSpritePosition,
  lightSpritePower,
  MIN_AMB_LEVEL_FOR_MERC_LIGHTS,
  traceLitTiles,
} from '../../sim/tactical/lighting/lighting.ts';
import type { LightTemplate } from '../../sim/tactical/lighting/templates.ts';
import type { DoorStatus, PathEnv, PathWorld } from '../../sim/tactical/pathfinding.ts';
import type { TacticalState } from '../../sim/tactical/state.ts';

const SHADE_MAX = 1;
const SHADE_MIN = 15;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const CELLS_PER_TILE = 10;
const RECOMPILE_RADIUS = 1;
const LIGHT_VALUES = 256;
const NO_TILE_CHANGES: readonly TileChangeView[] = [];

export interface MercLight {
  readonly soldier?: number;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly template: LightTemplate;
}

export interface DynamicLight {
  readonly x: number;
  readonly y: number;
  readonly template: LightTemplate;
}

export interface MapLight extends DynamicLight {
  readonly roof: boolean;
}

interface PlacedLight {
  readonly soldier?: number;
  readonly x: number;
  readonly y: number;
  readonly flags: number;
  readonly template: LightTemplate;
}

export interface RoofLight {
  readonly key: string;
  readonly roof: ReadonlyMap<number, number>;
}

const NO_ROOF_LIGHTS: ReadonlyMap<number, RoofLight> = new Map();

export interface LightingTime {
  readonly hour: number;
  readonly minute: number;
}

export interface LightingInput {
  readonly time: LightingTime;
  readonly ambient?: number | null;
  readonly openDoors: ReadonlySet<number>;
  readonly mapLights?: readonly MapLight[] | null;
  readonly mercLights: readonly MercLight[];
  readonly dynamicLights?: readonly DynamicLight[];
  readonly tileChanges?: readonly TileChangeView[];
}

type LightingHost = Pick<TacticalState, 'lighting' | 'world' | 'pathWorld' | 'pathEnv' | 'changes'>;

function dayLightSchedule(): readonly { readonly second: number; readonly level: number }[] {
  const q = createEventQueue();
  buildDayLightLevels(q, createWorldClock(0));
  return q.events.filter((e) => e.kind === EventKind.CHANGELIGHTVAL).map((e) => ({ second: e.stamp, level: e.param }));
}

const SCHEDULE = dayLightSchedule();

export function surfaceAmbientAt(t: LightingTime): number {
  const second = (t.hour * MINUTES_PER_HOUR + t.minute) * SECONDS_PER_MINUTE;
  let level = NORMAL_LIGHTLEVEL_NIGHT;
  for (const e of SCHEDULE) if (e.second <= second) level = e.level;
  return level;
}

interface StrongestLights {
  readonly ground: Uint8Array;
  readonly roof: Uint8Array;
  readonly throughWindows: Uint8Array;
  readonly leftWalls: Uint8Array;
  readonly rightWalls: Uint8Array;
}

function noLights(): StrongestLights {
  return {
    ground: new Uint8Array(WORLD_MAX),
    roof: new Uint8Array(WORLD_MAX),
    throughWindows: new Uint8Array(WORLD_MAX),
    leftWalls: new Uint8Array(WORLD_MAX),
    rightWalls: new Uint8Array(WORLD_MAX),
  };
}

function copyOf(s: StrongestLights): StrongestLights {
  return {
    ground: s.ground.slice(),
    roof: s.roof.slice(),
    throughWindows: s.throughWindows.slice(),
    leftWalls: s.leftWalls.slice(),
    rightWalls: s.rightWalls.slice(),
  };
}

function strengthen(lights: Uint8Array, g: number, amount: number): void {
  if (amount > (lights[g] ?? 0)) lights[g] = amount;
}

function strengthenBy(s: StrongestLights): (g: number, amount: number, nodes: LitNodes) => void {
  return (g, amount, nodes) => {
    switch (nodes) {
      case LitNodes.ROOF:
        strengthen(s.roof, g, amount);
        return;
      case LitNodes.GROUND:
        strengthen(s.ground, g, amount);
        return;
      case LitNodes.GROUND_AND_WALLS:
        strengthen(s.ground, g, amount);
        strengthen(s.throughWindows, g, amount);
        return;
      case LitNodes.LEFT_WALLS:
        strengthen(s.leftWalls, g, amount);
        return;
      case LitNodes.RIGHT_WALLS:
        strengthen(s.rightWalls, g, amount);
        return;
    }
  };
}

function stronger(a: number, b: number): number {
  return a > b ? a : b;
}

function shadesUnderLights(natural: number): Uint8Array {
  const shades = new Uint8Array(LIGHT_VALUES);
  for (let light = 0; light < LIGHT_VALUES; light++) shades[light] = clamp(natural - light, SHADE_MAX, SHADE_MIN);
  return shades;
}

function channelShades(natural: number, s: StrongestLights): Uint8Array[] {
  const shadeOf = shadesUnderLights(natural);
  const channels = Array.from({ length: SHADE_TEXTURE_CHANNELS }, () => new Uint8Array(WORLD_MAX));
  const channel = (c: ShadeChannel) => channels[c] as Uint8Array;
  const land = channel(ShadeChannel.LAND);
  const roof = channel(ShadeChannel.ROOF);
  const decal = channel(ShadeChannel.DECAL);
  const leftWall = channel(ShadeChannel.LEFT_WALL);
  const rightWall = channel(ShadeChannel.RIGHT_WALL);
  const cornerWall = channel(ShadeChannel.CORNER_WALL);
  const bareWall = channel(ShadeChannel.BARE_WALL);
  for (let g = 0; g < WORLD_MAX; g++) {
    const ground = s.ground[g] as number;
    const windows = s.throughWindows[g] as number;
    const left = s.leftWalls[g] as number;
    const right = s.rightWalls[g] as number;
    const walls = stronger(left, right);
    land[g] = shadeOf[ground] as number;
    roof[g] = shadeOf[s.roof[g] as number] as number;
    decal[g] = shadeOf[stronger(ground, walls)] as number;
    leftWall[g] = shadeOf[stronger(windows, left)] as number;
    rightWall[g] = shadeOf[stronger(windows, right)] as number;
    cornerWall[g] = shadeOf[stronger(windows, walls)] as number;
    bareWall[g] = shadeOf[windows] as number;
  }
  return channels;
}

interface StandingStructures {
  readonly structures: WorldStructures;
  readonly costs: MovementCosts;
}

function standingStructures(world: TacticalWorld, changes: readonly TileChangeView[]): StandingStructures {
  if (changes.length === 0) return world;
  const { structures, touched } = structuresAfterTileChanges(world.structures, world.tiles, changes);
  const costs = MovementCosts.fromSnapshot(world.costs.toSnapshot());
  const changed = { ...world, structures };
  for (const g of touched) recompileLocalMovementCosts(costs, changed, g, RECOMPILE_RADIUS);
  return { structures, costs };
}

export class WorldLighting {
  readonly #world: TacticalWorld;
  readonly #map: MapDef;
  readonly #mapDoors: Map<number, MapDoor>;
  #host: LightingHost;
  readonly #doorStatus = new Map<number, DoorStatus>();
  readonly #changes = createChangeCounts();
  readonly #doors: readonly number[];
  #version = 0;
  #staticKey = '';
  #mercKey = '';
  #structureKey = '';
  #static: StrongestLights | null = null;
  #field: ShadeField | null = null;
  #mercRoofLights: ReadonlyMap<number, RoofLight> = NO_ROOF_LIGHTS;

  constructor(world: TacticalWorld) {
    this.#world = world;
    this.#map = world.map;
    this.#doors = doorGridNos(world);
    this.#mapDoors = new Map(world.map.doors.map((d) => [d.gridNo, d] as const));
    this.#host = this.#hostOver(world, createLightingState(world.level));
  }

  #hostOver(standing: StandingStructures, lighting: TacticalState['lighting']): LightingHost {
    const world = this.#world;
    const mapDoors = this.#mapDoors;
    const pathWorld: PathWorld = {
      costs: standing.costs,
      terrain: world.terrain,
      heights: world.level.heights,
      structures: standing.structures,
      mapDoors,
    };
    const pathEnv: PathEnv = {
      world: pathWorld,
      restrictedScrollId: world.map.info.restrictedScrollId,
      whoIsThere: () => null,
      doorStatus: (g) => this.#doorStatus.get(g) ?? null,
      showAllMercs: false,
      autoBandage: false,
    };
    const changes = this.#changes;
    return { lighting, world: { ...world, structures: standing.structures, costs: standing.costs, mapDoors }, pathWorld, pathEnv, changes };
  }

  #followStructureChanges(changes: readonly TileChangeView[]): void {
    const key = tileChangesKey(changes);
    if (key === this.#structureKey) return;
    this.#structureKey = key;
    this.#host = this.#hostOver(standingStructures(this.#world, changes), this.#host.lighting);
  }

  get mercRoofLights(): ReadonlyMap<number, RoofLight> {
    return this.#mercRoofLights;
  }

  get underground(): boolean {
    return this.#map.ambient !== null && this.#map.ambient !== undefined;
  }

  ambientAt(time: LightingTime, fromView: number | null = null): number {
    if (fromView !== null) return fromView;
    return this.#map.ambient ? this.#map.ambient.lightLevel : surfaceAmbientAt(time);
  }

  mercLightsShine(time: LightingTime, fromView: number | null = null): boolean {
    return this.ambientAt(time, fromView) >= MIN_AMB_LEVEL_FOR_MERC_LIGHTS;
  }

  field(input: LightingInput): ShadeField {
    const ambient = this.ambientAt(input.time, input.ambient ?? null);
    const doors = [...input.openDoors].sort((a, b) => a - b).join(',');
    const staticKey = `${input.time.hour}|${ambient}|${doors}|${mapLightsKey(input.mapLights ?? null)}`;
    const placed = placedLights(input);
    const mercKey = placed.map(placedLightKey).join(';');
    this.#followStructureChanges(input.tileChanges ?? NO_TILE_CHANGES);
    if (this.#field && staticKey === this.#staticKey && mercKey === this.#mercKey) return this.#field;
    const t = this.#host as TacticalState;
    if (!this.#static || staticKey !== this.#staticKey) {
      this.#doorStatus.clear();
      for (const g of this.#doors) this.#doorStatus.set(g, { perceivedOpen: input.openDoors.has(g) });
      this.#lightMap(t, input.mapLights ?? null, input.time.hour, ambient);
      this.#static = this.#mapLights(t);
      this.#staticKey = staticKey;
    }
    this.#mercKey = mercKey;
    const roofLights = new Map<number, RoofLight>();
    const strongest = placed.length > 0 ? this.#withLights(t, this.#static, placed, roofLights) : this.#static;
    this.#mercRoofLights = roofLights;
    this.#field = this.#shade(t.lighting.ambient, t.lighting.natural, strongest);
    return this.#field;
  }

  #lightMap(t: TacticalState, shown: readonly MapLight[] | null, hour: number, ambient: number): void {
    if (!shown) {
      initLighting(t, this.#map, hour, ambient);
      return;
    }
    initLighting(t, { ambient: this.#map.ambient, lights: null }, hour, ambient);
    for (const m of shown) {
      const l = lightSpriteFromTemplate(t, m.template);
      if (!l) continue;
      if (m.roof) l.flags |= LightSpriteFlags.ONROOF;
      lightSpritePower(l, true);
      lightSpritePosition(t, l, m.x, m.y);
    }
  }

  #mapLights(t: TacticalState): StrongestLights {
    const strongest = noLights();
    const visit = strengthenBy(strongest);
    for (const l of t.lighting.sprites) {
      if (l && l.flags & LightSpriteFlags.ACTIVE && l.flags & LightSpriteFlags.ON) traceLitTiles(t, l, visit);
    }
    return strongest;
  }

  #withLights(
    t: TacticalState,
    base: StrongestLights,
    lights: readonly PlacedLight[],
    roofLights: Map<number, RoofLight>,
  ): StrongestLights {
    const strongest = copyOf(base);
    const visit = strengthenBy(strongest);
    for (const m of lights) {
      const l = lightSpriteFromTemplate(t, m.template);
      if (!l) continue;
      l.flags |= m.flags;
      lightSpritePosition(t, l, m.x, m.y);
      const roof = new Map<number, number>();
      traceLitTiles(t, l, (g, amount, nodes) => {
        visit(g, amount, nodes);
        if (nodes === LitNodes.ROOF) roof.set(g, u8((roof.get(g) ?? 0) + amount));
      });
      if (m.soldier !== undefined) roofLights.set(m.soldier, { key: placedLightKey(m), roof: withoutUnlit(roof) });
      lightSpriteDestroy(t, l);
    }
    return strongest;
  }

  #shade(ambient: number, natural: number, strongest: StrongestLights): ShadeField {
    const channels = channelShades(natural, strongest);
    this.#version++;
    const land = channels[ShadeChannel.LAND] as Uint8Array;
    const roof = channels[ShadeChannel.ROOF] as Uint8Array;
    return { version: this.#version, ambient, natural, land, roof, channels };
  }
}

function withoutUnlit(sums: Map<number, number>): Map<number, number> {
  for (const [g, sum] of sums) if (sum === 0) sums.delete(g);
  return sums;
}

function placedLightKey(m: PlacedLight): string {
  return `${m.x},${m.y},${m.flags},${m.template.name}`;
}

function mapLightsKey(lights: readonly MapLight[] | null): string {
  if (!lights) return 'map';
  return lights.map((l) => `${l.x},${l.y},${l.roof ? 1 : 0},${l.template.name}`).join(';');
}

function placedLights(input: LightingInput): PlacedLight[] {
  const mercs = input.mercLights.map((m) => ({
    ...(m.soldier !== undefined ? { soldier: m.soldier } : {}),
    x: idiv(m.x, CELLS_PER_TILE),
    y: idiv(m.y, CELLS_PER_TILE),
    flags: LightSpriteFlags.MERC_LIGHT | (m.level > 0 ? LightSpriteFlags.ONROOF : 0),
    template: m.template,
  }));
  const dynamic = (input.dynamicLights ?? []).map((d) => ({ x: d.x, y: d.y, flags: 0, template: d.template }));
  return [...mercs, ...dynamic];
}

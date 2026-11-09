// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Lighting.cc LightAddTileNode (ubMaxLights, ubShadeLevel), LightSetBaseLevel;
// @src src/game/Tactical/Soldier_Control.cc PositionSoldierLight, CreateSoldierLight, SetSoldierPersonalLightLevel;
// @src src/game/TileEngine/Environment.cc GetTimeOfDayAmbientLightLevel; Lighting.cc LightIlluminateWall (the live
// @src structures a light is drawn over).

import type { StructureDef } from '../../content/formats/jsd.ts';
import type { MapDef, MapDoor } from '../../content/formats/map.ts';
import { WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { MovementCosts, recompileLocalMovementCosts } from '../../content/world/movement-costs.ts';
import { has, PROFILE_Z_SIZE, StructureFlags, type StructureInstance, type WorldStructures } from '../../content/world/structures.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { clamp, idiv } from '../../core/int.ts';
import type { TileChangeView } from '../../protocol/view.ts';
import { tileChangesKey } from '../../render/world/tile-changes.ts';
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
  type LightSprite,
  LightSpriteFlags,
  lightSpriteDestroy,
  lightSpriteFromTemplate,
  lightSpritePosition,
  lightSpritePower,
  lightSpriteRenderAll,
  MIN_AMB_LEVEL_FOR_MERC_LIGHTS,
} from '../../sim/tactical/lighting/lighting.ts';
import type { LightTemplate } from '../../sim/tactical/lighting/templates.ts';
import type { DoorStatus, PathEnv, PathWorld } from '../../sim/tactical/pathfinding.ts';
import type { TacticalState } from '../../sim/tactical/state.ts';
import { changesObjectLayer } from '../../sim/tactical/world-view.ts';

const SHADE_MAX = 1;
const SHADE_MIN = 15;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const CELLS_PER_TILE = 10;
const RECOMPILE_RADIUS = 1;
const NO_TILE_CHANGES: readonly TileChangeView[] = [];

export interface MercLight {
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
  readonly x: number;
  readonly y: number;
  readonly flags: number;
  readonly template: LightTemplate;
}

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

interface LightMaxima {
  readonly land: Uint8Array;
  readonly roof: Uint8Array;
}

interface StandingStructures {
  readonly structures: WorldStructures;
  readonly costs: MovementCosts;
}

function changedBase(structures: WorldStructures, c: TileChangeView, def: StructureDef): StructureInstance | null {
  const at = structures.at(c.gridNo);
  return at.find((s) => has(s.flags, StructureFlags.BASE_TILE) && s.def === def && idiv(s.cubeOffset, PROFILE_Z_SIZE) === c.level) ?? null;
}

function applyStructureChange(world: TacticalWorld, structures: WorldStructures, c: TileChangeView): boolean {
  const te = world.tiles[c.tile];
  if (!te?.structure || changesObjectLayer(c)) return false;
  if (c.kind !== 'remove') return structures.add(c.gridNo, c.level, te.structure, undefined, te.structureFile) !== null;
  const base = changedBase(structures, c, te.structure);
  if (base) structures.remove(base);
  return base !== null;
}

function standingStructures(world: TacticalWorld, changes: readonly TileChangeView[]): StandingStructures {
  if (changes.length === 0) return world;
  const structures = world.structures.clone();
  const touched = new Set<number>();
  for (const c of changes) {
    if (!applyStructureChange(world, structures, c)) continue;
    for (const tile of world.tiles[c.tile]?.structure?.tiles ?? []) touched.add(c.gridNo + tile.posRelToBase);
  }
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
  #static: LightMaxima | null = null;
  #field: ShadeField | null = null;

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
    const mercKey = placed.map((m) => `${m.x},${m.y},${m.flags},${m.template.name}`).join(';');
    this.#followStructureChanges(input.tileChanges ?? NO_TILE_CHANGES);
    if (this.#field && staticKey === this.#staticKey && mercKey === this.#mercKey) return this.#field;
    const t = this.#host as TacticalState;
    if (!this.#static || staticKey !== this.#staticKey) {
      this.#doorStatus.clear();
      for (const g of this.#doors) this.#doorStatus.set(g, { perceivedOpen: input.openDoors.has(g) });
      this.#lightMap(t, input.mapLights ?? null, input.time.hour, ambient);
      this.#static = this.#mapLightMaxima(t);
      this.#staticKey = staticKey;
    }
    this.#mercKey = mercKey;
    const maxima = placed.length > 0 ? this.#withLights(t, this.#static, placed) : this.#static;
    this.#field = this.#shade(t.lighting.ambient, t.lighting.natural, maxima);
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

  #mapLightMaxima(t: TacticalState): LightMaxima {
    const land = new Uint8Array(WORLD_MAX);
    const roof = new Uint8Array(WORLD_MAX);
    const powered = t.lighting.sprites.filter(
      (l): l is LightSprite => !!l && (l.flags & LightSpriteFlags.ACTIVE) !== 0 && (l.flags & LightSpriteFlags.ON) !== 0,
    );
    for (const l of powered) {
      for (const other of powered) lightSpritePower(other, other === l);
      lightSpriteRenderAll(t);
      accumulate(l, t.lighting.landLight, land);
      accumulate(l, t.lighting.roofLight, roof);
    }
    for (const l of powered) lightSpritePower(l, false);
    return { land, roof };
  }

  #withLights(t: TacticalState, base: LightMaxima, lights: readonly PlacedLight[]): LightMaxima {
    const land = base.land.slice();
    const roof = base.roof.slice();
    for (const m of lights) {
      const l = lightSpriteFromTemplate(t, m.template);
      if (!l) continue;
      l.flags |= m.flags;
      lightSpritePower(l, true);
      lightSpriteRenderAll(t);
      lightSpritePosition(t, l, m.x, m.y);
      accumulate(l, t.lighting.landLight, land);
      accumulate(l, t.lighting.roofLight, roof);
      lightSpriteDestroy(t, l);
    }
    return { land, roof };
  }

  #shade(ambient: number, natural: number, maxima: LightMaxima): ShadeField {
    const land = new Uint8Array(WORLD_MAX);
    const roof = new Uint8Array(WORLD_MAX);
    for (let g = 0; g < WORLD_MAX; g++) {
      land[g] = clamp(natural - (maxima.land[g] ?? 0), SHADE_MAX, SHADE_MIN);
      roof[g] = clamp(natural - (maxima.roof[g] ?? 0), SHADE_MAX, SHADE_MIN);
    }
    this.#version++;
    return { version: this.#version, ambient, natural, land, roof };
  }
}

function mapLightsKey(lights: readonly MapLight[] | null): string {
  if (!lights) return 'map';
  return lights.map((l) => `${l.x},${l.y},${l.roof ? 1 : 0},${l.template.name}`).join(';');
}

function placedLights(input: LightingInput): PlacedLight[] {
  const mercs = input.mercLights.map((m) => ({
    x: idiv(m.x, CELLS_PER_TILE),
    y: idiv(m.y, CELLS_PER_TILE),
    flags: LightSpriteFlags.MERC_LIGHT | (m.level > 0 ? LightSpriteFlags.ONROOF : 0),
    template: m.template,
  }));
  const dynamic = (input.dynamicLights ?? []).map((d) => ({ x: d.x, y: d.y, flags: 0, template: d.template }));
  return [...mercs, ...dynamic];
}

function accumulate(l: LightSprite, sums: Uint8Array, max: Uint8Array): void {
  for (const n of l.template.lights) {
    const g = (l.y + n.dy) * WORLD_COLS + (l.x + n.dx);
    if (g < 0 || g >= WORLD_MAX || (sums[g] ?? 0) === 0) continue;
    if (n.light > (max[g] ?? 0)) max[g] = n.light;
  }
}

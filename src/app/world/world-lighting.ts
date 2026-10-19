// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Lighting.cc LightAddTileNode (ubMaxLights, ubShadeLevel), LightSetBaseLevel;
// @src src/game/Tactical/Soldier_Control.cc PositionSoldierLight, CreateSoldierLight, SetSoldierPersonalLightLevel;
// @src src/game/TileEngine/Environment.cc GetTimeOfDayAmbientLightLevel. See docs/20 §1, §4 and docs/05 §6.

import type { MapDef } from '../../content/formats/map.ts';
import { WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { clamp } from '../../core/int.ts';
import type { ShadeField } from '../../render/world/world-renderer.ts';
import { EventKind } from '../../sim/strategic/time/constants.ts';
import { buildDayLightLevels, NORMAL_LIGHTLEVEL_NIGHT } from '../../sim/strategic/time/environment.ts';
import { createEventQueue } from '../../sim/strategic/time/event-queue.ts';
import { createWorldClock } from '../../sim/strategic/time/world-clock.ts';
import {
  createLightingState,
  initLighting,
  type LightSprite,
  LightSpriteFlags,
  lightSpriteCreate,
  lightSpriteDestroy,
  lightSpritePosition,
  lightSpritePower,
  lightSpriteRenderAll,
  MIN_AMB_LEVEL_FOR_MERC_LIGHTS,
} from '../../sim/tactical/lighting/lighting.ts';
import type { DoorStatus, PathEnv, PathWorld } from '../../sim/tactical/pathfinding.ts';
import type { TacticalState } from '../../sim/tactical/state.ts';

const SHADE_MAX = 1;
const SHADE_MIN = 15;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MERC_LIGHT_STAND_IN = 'L-R06.LHT';

export interface MercLight {
  readonly x: number;
  readonly y: number;
  readonly level: number;
}

export interface LightingTime {
  readonly hour: number;
  readonly minute: number;
}

export interface LightingInput {
  readonly time: LightingTime;
  readonly openDoors: ReadonlySet<number>;
  readonly mercLights: readonly MercLight[];
}

type LightingHost = Pick<TacticalState, 'lighting' | 'world' | 'pathWorld' | 'pathEnv'>;

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

export class WorldLighting {
  readonly #map: MapDef;
  readonly #host: LightingHost;
  readonly #doorStatus = new Map<number, DoorStatus>();
  #version = 0;
  #staticKey = '';
  #mercKey = '';
  #static: LightMaxima | null = null;
  #field: ShadeField | null = null;

  constructor(world: TacticalWorld) {
    this.#map = world.map;
    const mapDoors = new Map(world.map.doors.map((d) => [d.gridNo, d] as const));
    const pathWorld: PathWorld = {
      costs: world.costs,
      terrain: world.terrain,
      heights: world.level.heights,
      structures: world.structures,
      mapDoors,
    };
    const pathEnv: PathEnv = {
      world: pathWorld,
      whoIsThere: () => null,
      doorStatus: (g) => this.#doorStatus.get(g) ?? null,
      showAllMercs: false,
      autoBandage: false,
    };
    this.#host = { lighting: createLightingState(world.level), world: { ...world, mapDoors }, pathWorld, pathEnv };
  }

  get underground(): boolean {
    return this.#map.ambient !== null && this.#map.ambient !== undefined;
  }

  ambientAt(time: LightingTime): number {
    return this.#map.ambient ? this.#map.ambient.lightLevel : surfaceAmbientAt(time);
  }

  mercLightsShine(time: LightingTime): boolean {
    return this.ambientAt(time) >= MIN_AMB_LEVEL_FOR_MERC_LIGHTS;
  }

  field(input: LightingInput): ShadeField {
    const ambient = this.ambientAt(input.time);
    const staticKey = `${input.time.hour}|${ambient}|${[...input.openDoors].sort((a, b) => a - b).join(',')}`;
    const mercKey = input.mercLights.map((m) => `${m.x},${m.y},${m.level}`).join(';');
    if (this.#field && staticKey === this.#staticKey && mercKey === this.#mercKey) return this.#field;
    const t = this.#host as TacticalState;
    if (!this.#static || staticKey !== this.#staticKey) {
      this.#doorStatus.clear();
      for (const g of input.openDoors) this.#doorStatus.set(g, { perceivedOpen: true });
      initLighting(t, this.#map, input.time.hour, ambient);
      this.#static = this.#mapLightMaxima(t);
      this.#staticKey = staticKey;
    }
    this.#mercKey = mercKey;
    const maxima = input.mercLights.length > 0 ? this.#withMercLights(t, this.#static, input.mercLights) : this.#static;
    this.#field = this.#shade(t.lighting.ambient, t.lighting.natural, maxima);
    return this.#field;
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

  #withMercLights(t: TacticalState, base: LightMaxima, lights: readonly MercLight[]): LightMaxima {
    const land = base.land.slice();
    const roof = base.roof.slice();
    for (const m of lights) {
      const l = lightSpriteCreate(t, MERC_LIGHT_STAND_IN);
      if (!l) continue;
      l.flags |= LightSpriteFlags.MERC_LIGHT | (m.level > 0 ? LightSpriteFlags.ONROOF : 0);
      lightSpritePower(l, true);
      lightSpriteRenderAll(t);
      lightSpritePosition(t, l, Math.trunc(m.x / 10), Math.trunc(m.y / 10));
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

function accumulate(l: LightSprite, sums: Uint8Array, max: Uint8Array): void {
  for (const n of l.template.lights) {
    const g = (l.y + n.dy) * WORLD_COLS + (l.x + n.dx);
    if (g < 0 || g >= WORLD_MAX || (sums[g] ?? 0) === 0) continue;
    if (n.light > (max[g] ?? 0)) max[g] = n.light;
  }
}

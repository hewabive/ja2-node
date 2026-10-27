// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Weapons.cc StructureHit (FIRSTMISS1 every 80 ms where the bullet is; in low or deep water
// @src THIRDMISS1 every 50 ms, then SECONDMISS1 every 80 ms), WindowHit (the shatter tile every 50 ms),
// @src DoSpecialEffectAmmoMiss (miniboom.sti every 100 ms); src/game/Tactical/Bullets.cc HandleBulletSpecialFlags (a
// @src thrown knife starts at the fourth frame of its direction and steps every 100 ms); src/game/TileEngine/Tile_Animation.cc
// @src UpdateAniTiles (a frame lasts until more than its delay has passed, a looping tile restarts at its direction's first
// @src frame, any other goes once its last frame has).

import type { TileElement } from '../../content/world/tile-database.ts';
import type { TileTables } from '../../content/world/tile-tables.ts';
import { TICK_MS } from '../../protocol/messages.ts';
import type { StructNode } from '../../render/world/dynamic-scene.ts';
import type { EffectEvent } from '../../sim/events.ts';

export type EffectKind = 'dust' | 'splash' | 'ripple' | 'shatter' | 'miniboom';

export interface EffectFrame {
  readonly kind: EffectKind;
  readonly gridNo: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly tile: string | null;
  readonly frame: number;
}

interface RunningEffect {
  readonly kind: EffectKind;
  readonly start: number;
  readonly gridNo: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly tile: string | null;
}

export type FrameCount = (kind: EffectKind, tile: string | null) => number | null;

const FRAME_DELAY_MS: Readonly<Record<EffectKind, number>> = { dust: 80, splash: 80, ripple: 50, shatter: 50, miniboom: 100 };
const LONGEST_EFFECT_TICKS = 2000 / TICK_MS;

export function framePeriodTicks(delayMs: number): number {
  return Math.floor(delayMs / TICK_MS) + 1;
}

export function ticksPerFrame(kind: EffectKind): number {
  return framePeriodTicks(FRAME_DELAY_MS[kind]);
}

const KNIFE_START_FRAME = 3;
const KNIFE_FRAME_DELAY_MS = 100;

export function knifeFrame(direction: number, framesPerDirection: number, since: number, tick: number): number {
  const steps = Math.floor(Math.max(0, tick - since) / framePeriodTicks(KNIFE_FRAME_DELAY_MS));
  return direction * framesPerDirection + ((KNIFE_START_FRAME + steps) % framesPerDirection);
}

function started(e: EffectEvent): RunningEffect[] {
  if (e.type === 'windowShattered') return [{ kind: 'shatter', start: e.tick, gridNo: e.gridNo, x: 0, y: 0, z: 0, tile: e.tile }];
  const at = { start: e.tick, gridNo: e.gridNo, x: e.x, y: e.y, z: e.z, tile: null };
  if (e.effect === 'splash')
    return [
      { kind: 'ripple', ...at },
      { kind: 'splash', ...at },
    ];
  return [{ kind: e.effect, ...at }];
}

export class EffectAnimations {
  #running: RunningEffect[] = [];

  observe(effects: readonly EffectEvent[]): void {
    for (const e of effects) this.#running.push(...started(e));
  }

  at(tick: number, frames: FrameCount): EffectFrame[] {
    this.#running = this.#running.filter((e) => tick - e.start < LONGEST_EFFECT_TICKS);
    const shown: EffectFrame[] = [];
    for (const e of this.#running) {
      if (tick < e.start) continue;
      const frame = Math.floor((tick - e.start) / ticksPerFrame(e.kind));
      const count = frames(e.kind, e.tile);
      if (count !== null && frame < count) shown.push({ kind: e.kind, gridNo: e.gridNo, x: e.x, y: e.y, z: e.z, tile: e.tile, frame });
    }
    return shown;
  }

  reset(): void {
    this.#running = [];
  }
}

const FIRST_TILE: Readonly<Record<Exclude<EffectKind, 'shatter' | 'miniboom'>, string>> = {
  dust: 'FIRSTMISS1',
  splash: 'SECONDMISS1',
  ripple: 'THIRDMISS1',
};

export function firstEffectTile(kind: EffectKind, tile: string | null, tables: TileTables): number | null {
  if (kind === 'miniboom') return null;
  const name = kind === 'shatter' ? tile : FIRST_TILE[kind];
  return name === null ? null : (tables.tileIndexByName.get(name) ?? null);
}

export function effectTileFrames(
  kind: EffectKind,
  tile: string | null,
  tables: TileTables,
  tiles: readonly TileElement[],
): readonly number[] | null {
  const first = firstEffectTile(kind, tile, tables);
  return first === null ? null : (tiles[first]?.animationFrames ?? null);
}

export function effectStructNodes(shown: readonly EffectFrame[], tables: TileTables, tiles: readonly TileElement[]): StructNode[] {
  return shown.flatMap((e) => {
    const tile = effectTileFrames(e.kind, e.tile, tables, tiles)?.[e.frame];
    if (tile === undefined) return [];
    const absolute = e.kind === 'shatter' ? null : { x: e.x, y: e.y };
    return [{ gridNo: e.gridNo, tile, absolute, relativeZ: e.z, animation: true }];
  });
}

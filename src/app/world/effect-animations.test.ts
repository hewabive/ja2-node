import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gridNo } from '../../content/world/grid.ts';
import { buildTileDatabase, type TileSurface } from '../../content/world/tile-database.ts';
import { parseTileTables, tileIndex } from '../../content/world/tile-tables.ts';
import type { EffectEvent } from '../../sim/events.ts';
import { EffectAnimations, effectStructNodes, knifeFrame, ticksPerFrame } from './effect-animations.ts';

const tables = parseTileTables(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/tiles.json'), 'utf8')));
const surfaces: TileSurface[] = tables.types.map((t) => ({
  type: t.index,
  path: `t${t.index}.sti`,
  frames: Array.from({ length: t.count }, () => ({ offsetX: 0, offsetY: 0, width: 40 })),
  auxData: null,
  structures: null,
}));
const tiles = buildTileDatabase(tables, surfaces);
const FIVE_FRAMES = () => 5;
const WHERE = gridNo(80, 80);

const impact = (tick: number, effect: 'dust' | 'splash' | 'miniboom'): EffectEvent => ({
  type: 'bulletImpact',
  soldier: 0,
  gridNo: WHERE,
  x: 805,
  y: 803,
  z: 12,
  effect,
  tick,
});

describe('effect animations', () => {
  it('shows each frame of a miss until more than its 80 ms have passed, and drops it after the last', () => {
    const effects = new EffectAnimations();
    effects.observe([impact(100, 'dust')]);
    const frameAt = (tick: number) => effects.at(tick, FIVE_FRAMES).map((e) => e.frame);
    const period = ticksPerFrame('dust');
    expect(period).toBe(17);
    expect(frameAt(99)).toEqual([]);
    expect(frameAt(100)).toEqual([0]);
    expect(frameAt(100 + period - 1)).toEqual([0]);
    expect(frameAt(100 + period)).toEqual([1]);
    expect(frameAt(100 + 5 * period - 1)).toEqual([4]);
    expect(frameAt(100 + 5 * period)).toEqual([]);
  });

  it('plays the ripple under the splash of a bullet in water, each at its own pace', () => {
    const effects = new EffectAnimations();
    effects.observe([impact(0, 'splash')]);
    expect(effects.at(11, FIVE_FRAMES).map((e) => [e.kind, e.frame])).toEqual([
      ['ripple', 1],
      ['splash', 0],
    ]);
  });

  it('turns misses into animated struct nodes at the impact and a shattered window into one on its tile', () => {
    const effects = new EffectAnimations();
    effects.observe([impact(0, 'dust'), { type: 'windowShattered', gridNo: WHERE + 1, tile: 'WINDOWSHATTER11', tick: 0 }]);
    const nodes = effectStructNodes(effects.at(ticksPerFrame('dust'), FIVE_FRAMES), tables, tiles);
    expect(nodes).toEqual([
      { gridNo: WHERE, tile: tileIndex(tables, 'FIRSTMISS1') + 1, absolute: { x: 805, y: 803 }, relativeZ: 12, animation: true },
      { gridNo: WHERE + 1, tile: tileIndex(tables, 'WINDOWSHATTER11') + 1, absolute: null, relativeZ: 0, animation: true },
    ]);
  });

  it('plays a missile trail at its own delay', () => {
    const effects = new EffectAnimations();
    const trail: EffectEvent = { type: 'missileTrail', gridNo: WHERE, x: 805, y: 803, z: 30, trail: 'smoke', delay: 150, tick: 0 };
    effects.observe([trail]);
    const frameAt = (tick: number) => effects.at(tick, () => 9).map((e) => [e.kind, e.tile, e.frame]);
    expect(frameAt(30)).toEqual([['trail', 'smoke', 0]]);
    expect(frameAt(31)).toEqual([['trail', 'smoke', 1]]);
  });

  it('forgets everything on reset', () => {
    const effects = new EffectAnimations();
    effects.observe([impact(0, 'miniboom')]);
    effects.reset();
    expect(effects.at(1, FIVE_FRAMES)).toEqual([]);
  });
});

describe('a thrown knife', () => {
  it('starts at the last frame of its direction and spins through the block every 100 ms', () => {
    const period = Math.floor(100 / 5) + 1;
    const frames = [0, period - 1, period, 2 * period, 3 * period, 4 * period].map((t) => knifeFrame(4, 4, 50, 50 + t));
    expect(frames).toEqual([19, 19, 16, 17, 18, 19]);
  });
});

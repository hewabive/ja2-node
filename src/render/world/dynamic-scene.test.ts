import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyTileLayer, LAYER_NAMES, type MapDef, tileLayerFromLists } from '../../content/formats/map.ts';
import { WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { buildLevel } from '../../content/world/level.ts';
import { buildTileDatabase, type TileElement, TileFlags, type TileSurface } from '../../content/world/tile-database.ts';
import { parseTileTables, tileIndex, tileIndexFromTypeSubIndex, typeIndex } from '../../content/world/tile-tables.ts';
import type { ZStripInfo } from '../../content/world/zstrip.ts';
import { clamp, u16 } from '../../core/int.ts';
import {
  animatedTile,
  type DynamicFrame,
  DynamicScene,
  flyingAniTileOnScreen,
  flyingAniTileScreenPoint,
  type SceneAniTile,
  type SceneSoldier,
  type SoldierSprite,
  soldierScreenPoint,
} from './dynamic-scene.ts';
import {
  animationTileZ,
  cameraOffset,
  corpseZ,
  itemZ,
  mercZ,
  NOBURN_Z_BONUS,
  ONROOF_Z_LEVEL,
  onRoofZ,
  roofCorpseZ,
  roofMercZ,
  STRUCT_Z_LEVEL,
  structZ,
  TOPMOST_Z_LEVEL,
  WALL_HEIGHT,
  worldOrigin,
  worldY,
  Z_SUBLAYERS,
} from './geometry.ts';
import { DrawState, FLOATS_PER_INSTANCE, InstanceFlags } from './instances.ts';
import { prepareLevelRenderData } from './level-render-data.ts';
import type { StaticWorld } from './static-scene.ts';
import { stateSpecs } from './world-program.ts';

const tables = parseTileTables(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/tiles.json'), 'utf8')));
const surfaces: TileSurface[] = tables.types.map((t) => ({
  type: t.index,
  path: `t${t.index}.sti`,
  frames: Array.from({ length: t.count }, () => ({ offsetX: 0, offsetY: 0, width: 40 })),
  auxData: null,
  structures: null,
}));
const g = (x: number, y: number) => y * WORLD_COLS + x;
const T = (name: string, sub = 1) => ({ type: typeIndex(tables, name), subIndex: sub });

function world(
  cells: Partial<Record<(typeof LAYER_NAMES)[number], [number, { type: number; subIndex: number }[]][]>>,
  tiles: TileElement[],
) {
  const layers = Object.fromEntries(
    LAYER_NAMES.map((name) => {
      const lists = Array.from({ length: WORLD_MAX }, () => [] as { type: number; subIndex: number }[]);
      for (const [at, list] of cells[name] ?? []) lists[at] = list;
      return [name, cells[name] ? tileLayerFromLists(lists) : emptyTileLayer()];
    }),
  ) as unknown as MapDef['layers'];
  const map = {
    minorVersion: 25,
    tilesetId: 0,
    heights: new Uint8Array(WORLD_MAX),
    rooms: new Uint8Array(WORLD_MAX),
    layers,
  } as unknown as MapDef;
  const level = buildLevel(map, tables, tiles);
  const info = { northGridNo: -1, eastGridNo: -1, southGridNo: -1, westGridNo: -1 } as MapDef['info'];
  const prepared = prepareLevelRenderData(level, tiles, tables, info, false);
  const staticWorld: StaticWorld = {
    level,
    tiles,
    prepared,
    topY: 860,
    sprite: (tile) => ({ layer: 0, x: 0, y: tile, width: 40, height: 20, offsetX: 0, offsetY: 0, paletteBase: 0 }),
  };
  return { staticWorld, prepared };
}

const pixels = new Uint8Array(40 * 20).fill(1);
const CLIMBED_ROOF_HEIGHT = 50;
const soldier = (
  id: number,
  gridNo: number,
  level: number,
  topmost = false,
  heightAdjustment = level * CLIMBED_ROOF_HEIGHT,
): SceneSoldier => ({
  id,
  gridNo,
  x: (gridNo % WORLD_COLS) * 10 + 5,
  y: Math.floor(gridNo / WORLD_COLS) * 10 + 5,
  level,
  heightAdjustment,
  sprite: { layer: 0, x: 0, y: 9000 + id, width: 40, height: 20, offsetX: 0, offsetY: 0, pixels },
  paletteRow: 100 + id,
  topmost,
});

function frame(overrides: Partial<DynamicFrame>): DynamicFrame {
  return {
    viewport: { width: 640, height: 360 },
    camera: { centerX: 805, centerY: 805 },
    renderHeight: 0,
    rows: { first: 140, last: 180 },
    animationStep: 0,
    showRoofs: true,
    soldiers: [],
    items: [],
    itemOutline: () => 0xffffff,
    uiNodes: [],
    aniTiles: [],
    structNodes: [],
    ...overrides,
  };
}

function decode(scene: DynamicScene) {
  const d = scene.instances.data;
  return Array.from({ length: scene.instances.count }, (_, i) => ({
    x: d[i * FLOATS_PER_INSTANCE] as number,
    y: d[i * FLOATS_PER_INSTANCE + 1] as number,
    width: d[i * FLOATS_PER_INSTANCE + 2] as number,
    height: d[i * FLOATS_PER_INSTANCE + 3] as number,
    srcX: d[i * FLOATS_PER_INSTANCE + 4] as number,
    tile: d[i * FLOATS_PER_INSTANCE + 5] as number,
    z: d[i * FLOATS_PER_INSTANCE + 8] as number,
    flags: d[i * FLOATS_PER_INSTANCE + 10] as number,
  }));
}

const GL_DEPTH_FUNCTIONS = { LESS: 0x0201, LEQUAL: 0x0203, GREATER: 0x0204, GEQUAL: 0x0206, ALWAYS: 0x0207 } as const;
const DEPTH_PASSES: Record<number, (incoming: number, stored: number) => boolean> = {
  [GL_DEPTH_FUNCTIONS.LESS]: (incoming, stored) => incoming < stored,
  [GL_DEPTH_FUNCTIONS.LEQUAL]: (incoming, stored) => incoming <= stored,
  [GL_DEPTH_FUNCTIONS.GREATER]: (incoming, stored) => incoming > stored,
  [GL_DEPTH_FUNCTIONS.GEQUAL]: (incoming, stored) => incoming >= stored,
  [GL_DEPTH_FUNCTIONS.ALWAYS]: () => true,
};
const STATE_SPECS = stateSpecs(GL_DEPTH_FUNCTIONS);

interface SoldierPixel {
  readonly shadow: boolean;
  readonly evenParity: boolean;
  readonly stored: number;
}

function discards(flags: number, pixel: SoldierPixel): boolean {
  if (flags & InstanceFlags.ONLY_SHADOW_INDEX && !pixel.shadow) return true;
  if (flags & InstanceFlags.EXCEPT_SHADOW_INDEX && pixel.shadow) return true;
  return (flags & InstanceFlags.DITHER) !== 0 && !pixel.evenParity;
}

function drawsOnPixel(scene: DynamicScene, tile: number, pixel: SoldierPixel): PixelDraws {
  const parts = decode(scene);
  const blends: string[] = [];
  let stored = pixel.stored;
  for (const run of scene.runs) {
    const spec = STATE_SPECS[run.state];
    for (const part of parts.slice(run.first, run.first + run.count)) {
      if (part.tile !== tile || part.srcX !== 0 || discards(part.flags, pixel)) continue;
      if (spec.func !== null && !DEPTH_PASSES[spec.func]?.(part.z, stored)) continue;
      if (spec.write) stored = part.z;
      blends.push(spec.blend);
    }
  }
  return { blends, stored };
}

interface PixelDraws {
  readonly blends: string[];
  readonly stored: number;
}

function blendOf(pixel: SoldierPixel): string {
  return pixel.shadow ? 'shadow' : 'none';
}

function stripObscureBlit(z: number, pixel: SoldierPixel): PixelDraws {
  const drawn = pixel.stored < z || pixel.evenParity;
  return { blends: drawn ? [blendOf(pixel)] : [], stored: drawn ? z : pixel.stored };
}

function oneTileObscuredBlit(z: number, pixel: SoldierPixel): PixelDraws {
  const drawn = pixel.shadow ? pixel.stored < z : pixel.stored <= z || pixel.evenParity;
  return { blends: drawn ? [blendOf(pixel)] : [], stored: pixel.stored };
}

const SHADOW_INDEX = 254;
const STRIP_COLUMNS = 20;
const Z_STRIP_DELTA_Y = Z_SUBLAYERS * 10;

interface ClipRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

class ScreenBuffer {
  readonly #z = new Map<number, number>();
  readonly #draws = new Map<number, string[]>();
  readonly #storedAt: (x: number, y: number) => number;
  readonly #pitch: number;

  constructor(pitch: number, storedAt: (x: number, y: number) => number) {
    this.#pitch = pitch;
    this.#storedAt = storedAt;
  }

  stored(x: number, y: number): number {
    return this.#z.get(y * this.#pitch + x) ?? this.#storedAt(x, y);
  }

  drawn(x: number, y: number): number | undefined {
    return this.#z.get(y * this.#pitch + x);
  }

  draw(x: number, y: number, z: number, blend: string): void {
    const i = y * this.#pitch + x;
    this.#z.set(i, z);
    this.#draws.set(i, [...(this.#draws.get(i) ?? []), blend]);
  }

  pixels(rect: ClipRect): string[] {
    const out: string[] = [];
    for (let y = rect.top; y < rect.bottom; y++)
      for (let x = rect.left; x < rect.right; x++)
        out.push(`${x},${y} ${(this.#draws.get(y * this.#pitch + x) ?? []).join('+')} @${this.stored(x, y)}`);
    return out;
  }
}

function shaderDiscards(flags: number, index: number, x: number, y: number): boolean {
  if (flags & InstanceFlags.ONLY_SHADOW_INDEX && index !== SHADOW_INDEX) return true;
  if (flags & InstanceFlags.EXCEPT_SHADOW_INDEX && index === SHADOW_INDEX) return true;
  const parity = flags & InstanceFlags.DITHER_ODD ? 1 : 0;
  return (flags & InstanceFlags.DITHER) !== 0 && ((x + y + parity) & 1) !== 0;
}

function rasterize(scene: DynamicScene, f: DynamicFrame, sprite: SoldierSprite, screen: ScreenBuffer): ScreenBuffer {
  const offset = cameraOffset(f.viewport, f.camera, f.renderHeight);
  const parts = decode(scene);
  for (const run of scene.runs) {
    const spec = STATE_SPECS[run.state];
    for (const part of parts.slice(run.first, run.first + run.count)) {
      const top = part.tile - sprite.y;
      if (top < 0 || top >= sprite.height) continue;
      for (let j = 0; j < part.height; j++)
        for (let i = 0; i < part.width; i++) {
          const x = part.x + offset.x + i;
          const y = part.y + offset.y + j;
          if (x < 0 || y < 0 || x >= f.viewport.width || y >= f.viewport.height) continue;
          const index = sprite.pixels[(top + j) * sprite.width + part.srcX - sprite.x + i] ?? 0;
          if (index === 0 || shaderDiscards(part.flags, index, x, y)) continue;
          const stored = screen.stored(x, y);
          if (spec.func !== null && !DEPTH_PASSES[spec.func]?.(part.z, stored)) continue;
          screen.draw(x, y, spec.write ? part.z : stored, spec.blend);
        }
    }
  }
  return screen;
}

type StripBlitter = 'obscure' | 'noBurn';

interface PixelRun {
  readonly from: number;
  readonly to: number;
  readonly transparent: boolean;
}

function runsOf(sprite: SoldierSprite, row: number): PixelRun[] {
  const runs: PixelRun[] = [];
  for (let x = 0; x < sprite.width; x++) {
    const transparent = sprite.pixels[row * sprite.width + x] === 0;
    const last = runs.at(-1);
    if (last && last.transparent === transparent) runs[runs.length - 1] = { ...last, to: x + 1 };
    else runs.push({ from: x, to: x + 1, transparent });
  }
  return runs;
}

function originalStripBlit(
  blitter: StripBlitter,
  sprite: SoldierSprite,
  at: { x: number; y: number },
  clip: ClipRect,
  strip: ZStripInfo,
  zValue: number,
  screen: ScreenBuffer,
): ScreenBuffer {
  const { width, height } = sprite;
  const leftSkip = Math.min(clip.left - Math.min(clip.left, at.x), width);
  const topSkip = Math.min(clip.top - Math.min(clip.top, at.y), height);
  const rightSkip = clamp(at.x + width - clip.right, 0, width);
  const bottomSkip = clamp(at.y + height - clip.bottom, 0, height);
  if (leftSkip >= width || rightSkip >= width || topSkip >= height || bottomSkip >= height) return screen;
  const blitLength = width - leftSkip - rightSkip;
  const first = strip.firstStripWidth;
  let startZ = u16(zValue + strip.initialZChange * Z_STRIP_DELTA_Y);
  let startCols = STRIP_COLUMNS;
  if (leftSkip > first) startCols = STRIP_COLUMNS - ((leftSkip - first) % STRIP_COLUMNS);
  else if (leftSkip < first) startCols = first - leftSkip;
  let startIndex = 0;
  if (leftSkip >= startCols) {
    startIndex = 1 + Math.trunc((leftSkip - first) / STRIP_COLUMNS);
    for (let i = 0; i < startIndex; i++) {
      if (strip.zChanges[i] === -1) startZ = u16(startZ - Z_SUBLAYERS);
      if (strip.zChanges[i] === 1) startZ = u16(startZ + Z_SUBLAYERS);
    }
  }
  const opaqueStep = blitter === 'noBurn' ? Z_SUBLAYERS : Z_STRIP_DELTA_Y;
  let lineFlag = at.y & 1;
  for (let row = topSkip; row < height - bottomSkip; row++) {
    let z = startZ;
    let zIndex = startIndex;
    let colsToGo = startCols;
    const step = (by: number) => {
      const delta = strip.zChanges[zIndex++] ?? 0;
      if (delta < 0) z = u16(z - by);
      else if (delta > 0) z = u16(z + by);
    };
    for (const run of runsOf(sprite, row)) {
      const from = Math.max(run.from, leftSkip);
      const to = Math.min(run.to, leftSkip + blitLength);
      if (from >= to) continue;
      if (run.transparent) {
        let count = to - from;
        while (count >= colsToGo) {
          count -= colsToGo;
          colsToGo = STRIP_COLUMNS;
          step(Z_STRIP_DELTA_Y);
        }
        colsToGo -= count;
        continue;
      }
      for (let x = from; x < to; x++) {
        const sx = at.x + x;
        const sy = at.y + row;
        const stored = screen.stored(sx, sy);
        const drawn = blitter === 'noBurn' ? stored <= z : stored < z || lineFlag === (sx & 1);
        if (drawn) screen.draw(sx, sy, z, sprite.pixels[row * width + x] === SHADOW_INDEX ? 'shadow' : 'none');
        if (--colsToGo === 0) {
          colsToGo = STRIP_COLUMNS;
          step(opaqueStep);
        }
      }
    }
    lineFlag ^= 1;
  }
  return screen;
}

const STRIP_SPRITE_WIDTH = 85;
const STRIP_SPRITE_HEIGHT = 14;
const GAP_ROW = 6;
const STRIPS: ZStripInfo = { zChanges: [1, 1, 0, -1, -1], initialZChange: -2, firstStripWidth: 10 };
const UNCLIPPED_AT = { x: 200, y: 100 };

function stripPixel(x: number, y: number): number {
  if ((x + 2 * y) % 5 === 0 || (x > 25 && y % 4 === 1) || (y === GAP_ROW && x >= 5 && x < 55)) return 0;
  if ((3 * x + y) % 7 === 0) return SHADOW_INDEX;
  return 1 + ((x + y) % 50);
}

const stripPixels = Uint8Array.from({ length: STRIP_SPRITE_WIDTH * STRIP_SPRITE_HEIGHT }, (_, i) =>
  stripPixel(i % STRIP_SPRITE_WIDTH, Math.floor(i / STRIP_SPRITE_WIDTH)),
);

interface StripCase {
  readonly blitter: StripBlitter;
  readonly leftSkip?: number;
  readonly topSkip?: number;
  readonly viewportTop?: number;
}

function stripSoldierPixels(tiles: TileElement[], c: StripCase): { ours: string[]; original: string[] } {
  const at = g(80, 80);
  const { staticWorld, prepared } = world({}, tiles);
  if (c.blitter === 'noBurn') prepared.noBurn[at] = 1;
  const viewportTop = c.viewportTop ?? 0;
  const base = soldier(4, at, 0);
  const point = soldierScreenPoint(frame({}), 0, base);
  const screenX = c.leftSkip === undefined ? UNCLIPPED_AT.x : -c.leftSkip;
  const screenY = c.topSkip === undefined ? UNCLIPPED_AT.y : viewportTop - c.topSkip;
  const sprite: SoldierSprite = {
    ...base.sprite,
    width: STRIP_SPRITE_WIDTH,
    height: STRIP_SPRITE_HEIGHT,
    offsetX: screenX - point.x,
    offsetY: screenY - point.y,
    pixels: stripPixels,
  };
  const prone = { ...base, sprite, multiTile: { zStrip: STRIPS, zTileOffsetX: 0, zTileOffsetY: 0, vehicle: false } };
  const f = frame({ viewportTop, soldiers: [prone] });
  const scene = new DynamicScene(staticWorld, prepared);
  scene.build(f);
  const merc = mercZ(worldY(80, 80, 860));
  const z = c.blitter === 'noBurn' ? u16(merc + NOBURN_Z_BONUS) : merc;
  const clip = { left: 0, top: viewportTop, right: f.viewport.width, bottom: f.viewport.height };
  const blit = (storedAt: (x: number, y: number) => number) =>
    originalStripBlit(c.blitter, sprite, { x: screenX, y: screenY }, clip, STRIPS, z, new ScreenBuffer(f.viewport.width, storedAt));
  const reference = blit(() => 0);
  const storedAt = (x: number, y: number) => {
    const drawn = reference.drawn(x, y);
    return drawn === undefined ? 0 : drawn + ((x + 2 * y) % 3) - 1;
  };
  const rect = {
    left: Math.max(clip.left, screenX),
    top: Math.max(clip.top, screenY),
    right: screenX + STRIP_SPRITE_WIDTH,
    bottom: screenY + STRIP_SPRITE_HEIGHT,
  };
  return {
    ours: rasterize(scene, f, sprite, new ScreenBuffer(f.viewport.width, storedAt)).pixels(rect),
    original: blit(storedAt).pixels(rect),
  };
}

describe('dynamic scene', () => {
  const tiles = buildTileDatabase(tables, surfaces);

  it('draws ground soldiers in three parts at the merc z and roof soldiers in both roof passes', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    scene.build(frame({ soldiers: [soldier(1, g(80, 80), 0), soldier(2, g(81, 80), 1)] }));
    const parts = decode(scene);
    const ground = parts.filter((p) => p.tile === 9001);
    expect(ground.map((p) => p.flags)).toEqual([
      InstanceFlags.ONLY_SHADOW_INDEX,
      InstanceFlags.EXCEPT_SHADOW_INDEX,
      InstanceFlags.EXCEPT_SHADOW_INDEX | InstanceFlags.DITHER,
    ]);
    expect(ground[0]?.z).toBe(mercZ(worldY(80, 80, 860)));
    const roof = parts.filter((p) => p.tile === 9002);
    expect(roof).toHaveLength(6);
    expect(roof[0]?.z).toBe(roofMercZ(worldY(81, 80, 860)));
    expect(scene.runs.slice(0, 3).map((r) => r.state)).toEqual([DrawState.NEARER_SHADOW, DrawState.NEARER_OR_EQUAL, DrawState.FARTHER]);
    expect(scene.placedSoldiers.map((p) => p.id)).toEqual([1, 2, 2]);
  });

  it('draws a soldier his truncated height adjustment above his tile: 58 placed on a roof, 50 climbed up, below it climbing down', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const at = g(80, 80);
    const bodyY = (heightAdjustment: number, level: number) => {
      const scene = new DynamicScene(staticWorld, prepared);
      scene.build(frame({ soldiers: [soldier(1, at, level, false, heightAdjustment)] }));
      return scene.placedSoldiers[0]?.y;
    };
    const ground = bodyY(0, 0) as number;
    expect([bodyY(58, 1), bodyY(50, 1), bodyY(Math.fround(2.9), 1), bodyY(-3, 0)].map((y) => ground - (y as number))).toEqual([
      58, 50, 2, -3,
    ]);
  });

  it('sorts a soldier at the roof z while his height is above zero, even below a pixel on the ground level', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const zOf = (heightAdjustment: number) => {
      const scene = new DynamicScene(staticWorld, prepared);
      scene.build(frame({ soldiers: [soldier(1, g(80, 80), 0, false, heightAdjustment)] }));
      return decode(scene).find((p) => p.tile === 9001)?.z;
    };
    const wy = worldY(80, 80, 860);
    expect([zOf(Math.fround(0.6)), zOf(0), zOf(-3)]).toEqual([roofMercZ(wy), mercZ(wy), mercZ(wy)]);
  });

  it('puts a glowing soldier at the topmost z', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    scene.build(frame({ soldiers: [soldier(3, g(80, 80), 0, true)] }));
    expect(decode(scene).every((p) => p.z === TOPMOST_Z_LEVEL)).toBe(true);
  });

  it('orders UI nodes around the dynamic map nodes of their layer and tile', () => {
    const top = tileIndex(tables, 'FIRSTFULLSTRUCT1') + 1;
    const { staticWorld, prepared } = world({ structs: [[g(80, 80), [T('FIRSTFULLSTRUCT', 2)]]] }, tiles);
    expect(tiles[top]?.flags ?? 0).toBeGreaterThan(0);
    const scene = new DynamicScene(staticWorld, prepared);
    const marker = tileIndex(tables, 'FIRSTPOINTERS1');
    scene.build(
      frame({
        uiNodes: [
          { gridNo: g(80, 80), layer: 'topmost', tile: marker },
          { gridNo: g(80, 80), layer: 'object', tile: marker, head: true },
        ],
      }),
    );
    const order = decode(scene).map((p) => tables.tileNames[p.tile]);
    expect(order).toEqual(['FIRSTPOINTERS1', 'FIRSTFULLSHADOW2', 'FIRSTFULLSTRUCT2', 'FIRSTPOINTERS1']);
    expect(decode(scene).at(-1)?.z).toBe(TOPMOST_Z_LEVEL);
  });

  it('draws an absolute node after the struct nodes of its tile, on the box of its cell and raised by its height', () => {
    const bullet = tileIndex(tables, 'BULLETTILE1');
    const { staticWorld, prepared } = world({ structs: [[g(80, 80), [T('FIRSTFULLSTRUCT', 2)]]] }, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const height = 20;
    const node = { gridNo: g(80, 80), tile: bullet, absolute: { x: 805, y: 805 }, relativeZ: height, animation: false };
    scene.build(frame({ structNodes: [node] }));
    const parts = decode(scene);
    expect(parts.map((p) => tables.tileNames[p.tile])).toEqual(['FIRSTFULLSHADOW2', 'FIRSTFULLSTRUCT2', 'BULLETTILE1']);
    const origin = worldOrigin(80, 80);
    expect(parts.at(-1)).toMatchObject({ x: origin.x, y: origin.y - height, z: structZ(worldY(80, 80, 860)) });
  });

  it('places animation tiles at the on-roof z raised by their height, absolute or on their own tile', () => {
    const miss = tileIndex(tables, 'FIRSTMISS1');
    const shatter = tileIndex(tables, 'WINDOWSHATTER1');
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const height = 12;
    scene.build(
      frame({
        structNodes: [
          { gridNo: g(80, 80), tile: miss, absolute: { x: 805, y: 805 }, relativeZ: height, animation: true },
          { gridNo: g(81, 80), tile: shatter, absolute: null, relativeZ: 0, animation: true },
        ],
      }),
    );
    const [dust, glass] = decode(scene);
    expect(dust).toMatchObject({
      x: worldOrigin(80, 80).x,
      y: worldOrigin(80, 80).y - height,
      z: animationTileZ(worldY(80, 80, 860), height),
    });
    expect(glass).toMatchObject({ x: worldOrigin(81, 80).x, y: worldOrigin(81, 80).y, z: animationTileZ(worldY(81, 80, 860), 0) });
  });

  it('draws a miniboom translucent on top of everything at its impact, raised by its height', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const boom: SceneAniTile = { ...aniTileOf('miniboom', g(80, 80), 0, 4), at: { x: 805, y: 805, z: 20 }, translucent: true };
    scene.build(frame({ aniTiles: [boom] }));
    expect(decode(scene)).toEqual([expect.objectContaining({ x: -20, y: 1570, z: TOPMOST_Z_LEVEL })]);
    expect(scene.runs.map((r) => r.state)).toEqual([DrawState.TRANSLUCENT]);
  });

  it('hangs a flying knife on its anchor tile at the on-roof z and draws its shadow flat in the shadow layer', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const anchor = g(80, 80);
    const knife: SceneAniTile = { ...aniTileOf('knife', anchor, 0, 5), at: { x: 805, y: 845, z: 30 } };
    const shadow: SceneAniTile = { ...aniTileOf('knifeShadow', anchor, 0, 5), at: { x: 805, y: 845, z: 0 } };
    scene.build(frame({ aniTiles: [knife, shadow] }));
    const [drawnShadow, drawnKnife] = decode(scene);
    expect(drawnShadow).toMatchObject({ x: -100, y: 1630, z: 0 });
    expect(drawnKnife).toMatchObject({ x: -100, y: 1600, z: animationTileZ(worldY(80, 80, 860), 30) });
    expect(scene.runs.map((r) => r.state)).toEqual([DrawState.SHADOW_FLAT, DrawState.NEARER_OR_EQUAL]);
  });

  it('places a flying tile on the screen where it draws it, on screen while a pixel of its sprite is in the viewport', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const south = (by: number) => ({ x: 805, y: 805 + by, z: 0 });
    const shadow: SceneAniTile = { ...aniTileOf('helicopterShadow', g(80, 80), 0, 8), at: south(40) };
    const shown = frame({ aniTiles: [shadow] });
    scene.build(shown);
    const screen = flyingAniTileScreenPoint(shown, 0, south(40));
    const offset = cameraOffset(shown.viewport, shown.camera, shown.renderHeight);
    expect(decode(scene)[0]).toMatchObject({
      x: screen.x + shadow.sprite.offsetX - offset.x,
      y: screen.y + shadow.sprite.offsetY - offset.y,
    });
    const lastOnScreen = 169;
    expect(flyingAniTileOnScreen(shown, 0, south(lastOnScreen), shadow.sprite)).toBe(true);
    expect(flyingAniTileOnScreen(shown, 0, south(lastOnScreen + 1), shadow.sprite)).toBe(false);
  });

  it('draws a flying crow flat on the ground in the shadow layer, below the crow drawn at his height', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const crow = { ...soldier(6, g(80, 84), 1, false, 40), x: 805, y: 845 };
    const ground = aniTileOf('crowShadow', g(80, 84), 0, 6);
    const shadow: SceneAniTile = { ...ground, sprite: { ...ground.sprite, offsetX: 0, offsetY: 0 }, at: { x: 805, y: 845, z: 0 } };
    scene.build(frame({ soldiers: [crow], aniTiles: [shadow] }));
    const parts = decode(scene);
    expect(parts.find((p) => p.tile === 7006)).toMatchObject({ x: -80, y: 1640, z: 0 });
    expect(parts.find((p) => p.tile === 9006)).toMatchObject({ x: -80, y: 1640 - 40 });
    expect(scene.runs[0]?.state).toBe(DrawState.SHADOW_FLAT);
  });

  it('draws a missile trail translucent at the on-roof z of its tile raised by its height', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const trail: SceneAniTile = { ...aniTileOf('trail', g(80, 80), 0, 6), at: { x: 805, y: 805, z: 25 }, translucent: true };
    scene.build(frame({ aniTiles: [trail] }));
    expect(decode(scene)).toEqual([expect.objectContaining({ x: -20, y: 1565, z: animationTileZ(worldY(80, 80, 860), 25) })]);
    expect(scene.runs.map((r) => r.state)).toEqual([DrawState.TRANSLUCENT]);
  });

  it('draws an explosion on top at its height, solid until it turns translucent', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const blast: SceneAniTile = { ...aniTileOf('explosion', g(80, 80), 0, 7), at: { x: 805, y: 805, z: 0 } };
    scene.build(frame({ aniTiles: [blast, { ...blast, translucent: true }] }));
    expect(decode(scene).map((p) => [p.y, p.z])).toEqual([
      [1590, TOPMOST_Z_LEVEL],
      [1590, TOPMOST_Z_LEVEL],
    ]);
    expect(scene.runs.map((r) => r.state)).toEqual([DrawState.NEARER_OR_EQUAL, DrawState.TRANSLUCENT]);
  });

  it('draws a node of the shadow layer flat before the map shadows of its tile', () => {
    const grenade = tileIndexFromTypeSubIndex(tables, typeIndex(tables, 'GUNS'), 1);
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const absolute = { x: 805, y: 805 };
    scene.build(
      frame({
        structNodes: [
          { gridNo: g(80, 80), tile: grenade, absolute, relativeZ: 30, animation: true },
          { gridNo: g(80, 80), tile: grenade, absolute, relativeZ: 0, animation: false, inShadowLayer: true },
        ],
      }),
    );
    expect(decode(scene).map((p) => p.y)).toEqual([worldOrigin(80, 80).y, worldOrigin(80, 80).y - 30]);
    expect(scene.runs.map((r) => r.state)).toEqual([DrawState.SHADOW_FLAT, DrawState.NEARER_OR_EQUAL]);
  });

  it('steps animated tiles every frame of the 200 ms clock', () => {
    const animated = tiles.map((t, i) =>
      i === 10 ? { ...t, flags: t.flags | TileFlags.ANIMATED, animationFrames: [10, 11, 12] } : t,
    ) as TileElement[];
    expect([0, 1, 2, 3].map((step) => animatedTile(animated, 10, step))).toEqual([10, 11, 12, 10]);
    expect(animatedTile(animated, 9, 2)).toBe(9);
  });

  it('draws at most two items per pool, dithered first and then with depth writes', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const gun = tileIndexFromTypeSubIndex(tables, typeIndex(tables, 'GUNS'), 1);
    scene.build(
      frame({
        items: [
          { gridNo: g(80, 80), level: 0, tile: gun },
          { gridNo: g(80, 80), level: 0, tile: gun + 1 },
          { gridNo: g(80, 80), level: 0, tile: gun + 2 },
        ],
      }),
    );
    expect(scene.itemInstances.count).toBe(4);
    expect(scene.itemRuns.map((r) => [r.state, r.count])).toEqual([
      [DrawState.FARTHER_OR_EQUAL, 2],
      [DrawState.NEARER_WRITE, 2],
    ]);
  });

  const aniTile = (kind: SceneAniTile['kind'], gridNo: number, level: number, id: number): SceneAniTile =>
    aniTileOf(kind, gridNo, level, id);

  function aniTileOf(kind: SceneAniTile['kind'], gridNo: number, level: number, id: number): SceneAniTile {
    return {
      kind,
      gridNo,
      level,
      sprite: { layer: 0, x: 0, y: 7000 + id, width: 40, height: 20, offsetX: -20, offsetY: -10 },
      paletteRow: 50 + id,
      shaded: kind !== 'smoke',
      zStrip: null,
      zTileOffsetX: 1,
      zTileOffsetY: 0,
    };
  }

  it('draws corpses with their shadow pixels and a depth write at the corpse z of the tile to the north-west', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    scene.build(
      frame({
        aniTiles: [aniTile('corpse', g(80, 80), 0, 1), aniTile('vehicleCorpse', g(82, 80), 0, 2), aniTile('corpse', g(84, 80), 1, 3)],
      }),
    );
    const parts = decode(scene);
    const corpse = parts.filter((p) => p.tile === 7001);
    expect(corpse.map((p) => p.flags)).toEqual([InstanceFlags.ONLY_SHADOW_INDEX, InstanceFlags.EXCEPT_SHADOW_INDEX]);
    expect(corpse[0]?.z).toBe(corpseZ(worldY(79, 79, 860)));
    expect(parts.find((p) => p.tile === 7002)?.z).toBe((worldY(83, 80, 860) * Z_SUBLAYERS + STRUCT_Z_LEVEL) & 0xffff);
    expect(parts.find((p) => p.tile === 7003)?.z).toBe(roofCorpseZ(worldY(84, 80, 860)));
    expect(scene.runs.slice(0, 2).map((r) => r.state)).toEqual([DrawState.NEARER_SHADOW, DrawState.NEARER_WRITE]);
  });

  it('draws a corpse its height above its level and sorts it at its tile as if it lay flat, as a corpse ignores its sRelativeZ for depth', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const placed = (level: number, heightAdjustment: number) => {
      const scene = new DynamicScene(staticWorld, prepared);
      scene.build(frame({ aniTiles: [{ ...aniTile('corpse', g(80, 80), level, 1), heightAdjustment }] }));
      return decode(scene).find((p) => p.tile === 7001);
    };
    const flat = placed(0, 0);
    const roof = placed(1, 0);
    expect([placed(1, 8), placed(1, -30), placed(0, 58)].map((p) => [p?.x, p?.y, p?.z])).toEqual([
      [roof?.x, (roof?.y ?? 0) - 8, roof?.z],
      [roof?.x, (roof?.y ?? 0) + 30, roof?.z],
      [flat?.x, (flat?.y ?? 0) - 58, flat?.z],
    ]);
  });

  it('sorts a corpse on a roof twice its on-roof offset up, as the original adds that offset twice', () => {
    const onRoofCorpseOffset = WALL_HEIGHT + 40;
    const wy = worldY(84, 80, 860);
    expect(roofCorpseZ(wy)).toBe((wy + 2 * onRoofCorpseOffset) * Z_SUBLAYERS + ONROOF_Z_LEVEL);
  });

  it('draws corpses before every merc, even one in the same row, as the original draws them with the static world', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    scene.build(
      frame({
        soldiers: [soldier(1, g(80, 80), 0), soldier(2, g(82, 80), 1)],
        aniTiles: [
          aniTile('corpse', g(81, 79), 0, 1),
          aniTile('corpse', g(79, 81), 0, 2),
          aniTile('corpse', g(83, 79), 1, 3),
          aniTile('smoke', g(81, 79), 0, 4),
        ],
      }),
    );
    const order = decode(scene).map((p) => p.tile);
    const firstMerc = order.findIndex((t) => t >= 9000);
    for (const corpse of [7001, 7002, 7003]) expect(order.lastIndexOf(corpse)).toBeLessThan(firstMerc);
    expect(order.indexOf(7004)).toBeGreaterThan(order.lastIndexOf(9001));
  });

  it('leaves out corpses on roofs when the roofs are hidden', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    scene.build(frame({ showRoofs: false, aniTiles: [aniTile('corpse', g(80, 80), 0, 1), aniTile('corpse', g(84, 80), 1, 3)] }));
    const drawn = new Set(decode(scene).map((p) => p.tile));
    expect(drawn.has(7001)).toBe(true);
    expect(drawn.has(7003)).toBe(false);
  });

  it('draws animated smoke translucent at the object z, static smoke opaque, smoke on roofs at the on-roof z', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    scene.build(
      frame({
        aniTiles: [aniTile('smoke', g(80, 80), 0, 4), aniTile('staticSmoke', g(90, 80), 0, 5), aniTile('smoke', g(85, 80), 1, 6)],
      }),
    );
    const parts = decode(scene);
    expect(parts.find((p) => p.tile === 7004)?.z).toBe(itemZ(worldY(80, 80, 860)));
    expect(parts.find((p) => p.tile === 7006)?.z).toBe(onRoofZ(worldY(85, 80, 860)));
    const states = scene.runs.map((r) => r.state);
    expect(states).toContain(DrawState.TRANSLUCENT);
    expect(states).toContain(DrawState.NEARER_OR_EQUAL);
  });

  it('draws multi-tile soldiers in the struct-merc pass, vehicles at the struct z of their structure offset, in z strips', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const strip = { zChanges: [1, 0, -1], initialZChange: -1, firstStripWidth: 10 };
    const prone = { ...soldier(4, g(80, 80), 0), multiTile: { zStrip: strip, zTileOffsetX: 1, zTileOffsetY: 0, vehicle: false } };
    const tank = { ...soldier(5, g(84, 80), 0), multiTile: { zStrip: null, zTileOffsetX: 0, zTileOffsetY: 1, vehicle: true } };
    scene.build(frame({ soldiers: [prone, tank] }));
    const parts = decode(scene);
    const proneParts = parts.filter((p) => p.tile === 9004);
    expect(proneParts).toHaveLength(12);
    expect(Math.max(...proneParts.map((p) => p.z))).toBe(mercZ(worldY(81, 80, 860)));
    expect(parts.find((p) => p.tile === 9005)?.z).toBe((worldY(84, 81, 860) * Z_SUBLAYERS + STRUCT_Z_LEVEL) & 0xffff);
    expect(scene.runs.some((r) => r.state === DrawState.NEARER_WRITE)).toBe(true);
    expect(scene.placedSoldiers.map((p) => p.id)).toEqual([4, 5]);
  });

  it('draws a soldier in z strips where he is nearer or on the dither, his shadow too, writing his z on every pixel it draws (BltTransZTransShadowIncObscure, RenderWorld.cc:2785-2792), where a one-tile soldier is drawn in full on a tie, his shadow only nearer, and writes no z (BltTransShadowZNBObscured)', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const strip = { zChanges: [0], initialZChange: 0, firstStripWidth: 10 };
    const prone = { ...soldier(4, g(80, 80), 0), multiTile: { zStrip: strip, zTileOffsetX: 0, zTileOffsetY: 0, vehicle: false } };
    const standing = soldier(5, g(84, 80), 0);
    const scene = new DynamicScene(staticWorld, prepared);
    scene.build(frame({ soldiers: [prone, standing] }));
    for (const [m, blit] of [
      [prone, stripObscureBlit],
      [standing, oneTileObscuredBlit],
    ] as const) {
      const z = mercZ(worldY(m.gridNo % WORLD_COLS, Math.floor(m.gridNo / WORLD_COLS), 860));
      const pixels = [true, false].flatMap((shadow) =>
        [true, false].flatMap((evenParity) => [z - 1, z, z + 1].map((stored) => ({ shadow, evenParity, stored }))),
      );
      expect(pixels.map((pixel) => drawsOnPixel(scene, m.sprite.y, pixel))).toEqual(pixels.map((pixel) => blit(z, pixel)));
    }
  });

  it('draws a soldier in z strips on a no-burn tile where he is nearer or ties, his shadow too, writing his z on every pixel drawn, his z stepping a sublayer at a strip edge inside a run of opaque pixels and a row across a transparent one (BltTransZTransShadowInc, RenderWorld.cc:2999-3027)', () => {
    const { ours, original } = stripSoldierPixels(tiles, { blitter: 'noBurn' });
    expect(ours).toEqual(original);
  });

  it('starts the strips of a soldier clipped at the left edge of the view a sublayer per strip it counts as skipped, counting none while fewer columns are cut than the cut strip has left, in both strip blitters (RenderWorld.cc:2651-2694, :2865-2908)', () => {
    for (const blitter of ['obscure', 'noBurn'] as const)
      for (const leftSkip of [3, 7, 10, 12, 25, 30, 45]) {
        const { ours, original } = stripSoldierPixels(tiles, { blitter, leftSkip });
        expect(ours, `${blitter}, ${leftSkip} columns skipped`).toEqual(original);
      }
  });

  it("dithers a soldier in z strips clipped at the top of the view on the parity of the sprite's first row, not of the screen row (BltTransZTransShadowIncObscure, RenderWorld.cc:2629)", () => {
    for (const viewportTop of [0, 20])
      for (const topSkip of [0, 1, 2, 3]) {
        const { ours, original } = stripSoldierPixels(tiles, { blitter: 'obscure', topSkip, viewportTop });
        expect(ours, `view from ${viewportTop}, ${topSkip} rows skipped`).toEqual(original);
      }
  });

  it('raises items lying on a structure by their height, at the struct z plus the height', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const gun = tileIndexFromTypeSubIndex(tables, typeIndex(tables, 'GUNS'), 1);
    scene.build(frame({ items: [{ gridNo: g(80, 80), level: 0, tile: gun, height: 12 }] }));
    const d = scene.itemInstances.data;
    expect(d[8]).toBe((worldY(80, 80, 860) * Z_SUBLAYERS + STRUCT_Z_LEVEL + 12) & 0xffff);
    scene.build(frame({ items: [{ gridNo: g(80, 80), level: 0, tile: gun }] }));
    const groundY = scene.itemInstances.data[1] as number;
    scene.build(frame({ items: [{ gridNo: g(80, 80), level: 0, tile: gun, height: 12 }] }));
    expect(scene.itemInstances.data[1]).toBe(groundY - 12);
  });
});

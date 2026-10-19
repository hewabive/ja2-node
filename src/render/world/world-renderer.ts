import { WORLD_COLS } from '../../content/world/grid.ts';
import type { Level } from '../../content/world/level.ts';
import type { WorldStructures } from '../../content/world/structures.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import type { TileTables } from '../../content/world/tile-tables.ts';
import { type DrawRun, DynamicScene, type PlacedSoldier, type SceneItem, type SceneSoldier, type WorldUiNode } from './dynamic-scene.ts';
import {
  type Camera,
  cameraOffset,
  LIGHT_DUSK_CUTOFF,
  ROOF_LEVEL_HEIGHT,
  ROW_COUNT,
  rowOf,
  screenToGridNo,
  topYOf,
  type Viewport,
  visibleRows,
} from './geometry.ts';
import { itemOutlineColour } from './glow.ts';
import { DrawState } from './instances.ts';
import type { LevelRenderData } from './level-render-data.ts';
import { pickSoldierAt } from './picking.ts';
import { changedRevealTiles, computeReveal, type RevealState } from './reveal.ts';
import type { LightColour } from './soldier-palettes.ts';
import { STATIC_SEGMENT_STATES, StaticScene, StaticSegment, type StaticState, type StaticWorld } from './static-scene.ts';
import { type WorldCapture, WorldFramebuffer } from './world-framebuffer.ts';
import { InstanceStream, ShadeTexture, WorldProgram } from './world-program.ts';
import { type TileSurfacePicture, WorldSprites } from './world-sprites.ts';

export interface RenderWorld {
  readonly level: Level;
  readonly tiles: readonly TileElement[];
  readonly tables: TileTables;
  readonly structures: WorldStructures;
  readonly prepared: LevelRenderData;
  readonly surfaces: readonly (TileSurfacePicture | null)[];
  readonly restrictedScrollId: number;
  readonly basement: boolean;
  readonly lightColour: LightColour;
}

export interface WorldDisplayOptions {
  readonly roofs: boolean;
  readonly shadows: boolean;
  readonly treeTops: boolean;
  readonly wireframes: boolean;
  readonly glowItems: boolean;
  readonly redItemGlow: boolean;
}

export const DEFAULT_DISPLAY_OPTIONS: WorldDisplayOptions = {
  roofs: true,
  shadows: true,
  treeTops: true,
  wireframes: true,
  glowItems: true,
  redItemGlow: false,
};

export interface ShadeField {
  readonly version: number;
  readonly ambient: number;
  readonly natural: number;
  readonly land: Uint8Array;
  readonly roof: Uint8Array;
}

export interface WorldFrameInput {
  readonly viewport: Viewport;
  readonly camera: Camera;
  readonly roofLevel: boolean;
  readonly clockMs: number;
  readonly options: WorldDisplayOptions;
  readonly shade: ShadeField;
  readonly openDoors: ReadonlySet<number>;
  readonly revealedRooms: ReadonlySet<number>;
  readonly soldiers: readonly SceneSoldier[];
  readonly items: readonly SceneItem[];
  readonly uiNodes: readonly WorldUiNode[];
}

export interface WorldDrawStats {
  readonly drawCalls: number;
  readonly instances: number;
  readonly staticInstances: number;
  readonly dynamicInstances: number;
  readonly staticRebuildMs: number;
}

const ANIMATED_TILE_FRAME_MS = 200;
const NO_STATS: WorldDrawStats = { drawCalls: 0, instances: 0, staticInstances: 0, dynamicInstances: 0, staticRebuildMs: 0 };

interface LoadedScene {
  readonly world: RenderWorld;
  readonly sprites: WorldSprites;
  readonly staticWorld: StaticWorld;
  readonly scene: StaticScene;
  readonly dynamic: DynamicScene;
  reveal: RevealState;
  revealedRooms: ReadonlySet<number>;
  uploaded: boolean;
  shadeVersion: number;
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function changedDoorRows(a: ReadonlySet<number>, b: ReadonlySet<number>): number[] {
  const rows = new Set<number>();
  for (const g of a) if (!b.has(g)) rows.add(rowOf(g));
  for (const g of b) if (!a.has(g)) rows.add(rowOf(g));
  return [...rows];
}

export class WorldRenderer {
  readonly framebuffer: WorldFramebuffer;
  readonly #gl: WebGL2RenderingContext;
  readonly #program: WorldProgram;
  readonly #staticStream: InstanceStream;
  readonly #dynamicStream: InstanceStream;
  readonly #itemStream: InstanceStream;
  readonly #shade: ShadeTexture;
  #scene: LoadedScene | null = null;
  #last: WorldFrameInput | null = null;
  #stats: WorldDrawStats = NO_STATS;
  #rebuildMs = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.framebuffer = new WorldFramebuffer(gl);
    this.#program = new WorldProgram(gl);
    this.#staticStream = new InstanceStream(gl);
    this.#dynamicStream = new InstanceStream(gl);
    this.#itemStream = new InstanceStream(gl);
    this.#shade = new ShadeTexture(gl);
  }

  get stats(): WorldDrawStats {
    return this.#stats;
  }

  get sprites(): WorldSprites | null {
    return this.#scene?.sprites ?? null;
  }

  setWorld(world: RenderWorld): WorldSprites {
    this.#scene?.sprites.dispose();
    const sprites = new WorldSprites(this.#gl, world.tiles, world.surfaces, world.lightColour);
    const staticWorld: StaticWorld = {
      level: world.level,
      tiles: world.tiles,
      prepared: world.prepared,
      topY: topYOf(world.restrictedScrollId),
      sprite: (tile) => sprites.tileSprite(tile),
    };
    const reveal = computeReveal(this.#revealWorld(world), new Set());
    const started = performance.now();
    const scene = new StaticScene(staticWorld, { reveal, openDoors: new Set(), treeTops: true, wireframes: true, roofLevel: false });
    this.#rebuildMs = performance.now() - started;
    this.#scene = {
      world,
      sprites,
      staticWorld,
      scene,
      dynamic: new DynamicScene(staticWorld, world.prepared),
      reveal,
      revealedRooms: new Set(),
      uploaded: false,
      shadeVersion: -1,
    };
    this.#last = null;
    return sprites;
  }

  #revealWorld(w: RenderWorld) {
    return { level: w.level, tiles: w.tiles, tables: w.tables, structures: w.structures, basement: w.basement };
  }

  #syncStatic(s: LoadedScene, f: WorldFrameInput): void {
    const old = s.scene.state;
    const rows = new Set<number>();
    if (!sameSet(s.revealedRooms, f.revealedRooms)) {
      const previous = s.reveal;
      s.reveal = computeReveal(this.#revealWorld(s.world), f.revealedRooms);
      s.revealedRooms = new Set(f.revealedRooms);
      for (const g of changedRevealTiles(previous, s.reveal, s.world.level)) rows.add(rowOf(g));
    }
    const next: StaticState = {
      reveal: s.reveal,
      openDoors: sameSet(old.openDoors, f.openDoors) ? old.openDoors : new Set(f.openDoors),
      treeTops: f.options.treeTops,
      wireframes: f.options.wireframes,
      roofLevel: f.roofLevel,
    };
    for (const row of changedDoorRows(old.openDoors, next.openDoors)) rows.add(row);
    const full = next.treeTops !== old.treeTops || next.wireframes !== old.wireframes || next.roofLevel !== old.roofLevel;
    if (!full && rows.size === 0) {
      if (next.reveal !== old.reveal) s.scene.setState(next, []);
      return;
    }
    const started = performance.now();
    s.scene.setState(next, full ? 'all' : rows);
    this.#rebuildMs = performance.now() - started;
    s.uploaded = false;
  }

  render(f: WorldFrameInput): WorldDrawStats {
    const gl = this.#gl;
    this.framebuffer.resize(f.viewport.width, f.viewport.height);
    this.framebuffer.begin();
    this.#last = f;
    const s = this.#scene;
    if (!s) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.#stats = NO_STATS;
      return NO_STATS;
    }
    this.#syncStatic(s, f);
    const assembled = s.scene.assemble();
    if (!s.uploaded) {
      this.#staticStream.upload(assembled.data, assembled.count);
      s.uploaded = true;
    }
    if (s.shadeVersion !== f.shade.version) {
      this.#shade.upload(f.shade.land, f.shade.roof);
      s.shadeVersion = f.shade.version;
    }
    const renderHeight = s.world.prepared.renderHeight + (f.roofLevel ? ROOF_LEVEL_HEIGHT : 0);
    const rows = visibleRows(f.viewport, f.camera, renderHeight);
    s.dynamic.build({
      viewport: f.viewport,
      camera: f.camera,
      renderHeight,
      rows,
      animationStep: Math.floor(f.clockMs / ANIMATED_TILE_FRAME_MS),
      showRoofs: f.options.roofs,
      soldiers: f.soldiers,
      items: f.items,
      itemOutline: (onRoof) => itemOutlineColour(f.clockMs, onRoof, { glow: f.options.glowItems, red: f.options.redItemGlow }),
      uiNodes: f.uiNodes,
    });
    this.#dynamicStream.upload(s.dynamic.instances.data, s.dynamic.instances.count);
    this.#itemStream.upload(s.dynamic.itemInstances.data, s.dynamic.itemInstances.count);
    const p = this.#program;
    p.begin({
      viewport: f.viewport,
      offset: cameraOffset(f.viewport, f.camera, renderHeight),
      natural: f.shade.natural,
      atlas: s.sprites.atlas.texture(),
      palette: s.sprites.palettes.texture(),
      shade: this.#shade.texture,
    });
    const segment = (seg: StaticSegment) => {
      const base = seg * (ROW_COUNT + 1);
      const first = assembled.rowStart[base + rows.first] ?? 0;
      const end = assembled.rowStart[base + rows.last + 1] ?? first;
      p.draw(this.#staticStream, STATIC_SEGMENT_STATES[seg] ?? DrawState.LAND, first, end - first);
    };
    const showShadows = f.options.shadows && f.shade.ambient < LIGHT_DUSK_CUTOFF;
    segment(StaticSegment.LAND);
    segment(StaticSegment.OBJECTS);
    if (showShadows) segment(StaticSegment.SHADOWS);
    segment(StaticSegment.STRUCTS);
    segment(StaticSegment.STRICT_STRIPS);
    if (f.options.roofs) {
      segment(StaticSegment.ROOFS);
      segment(StaticSegment.ON_ROOF);
    }
    segment(StaticSegment.TOPMOST);
    const itemRuns = s.dynamic.itemRuns;
    segment(StaticSegment.OBSCURED_DITHER);
    this.#drawRuns(
      itemRuns.filter((r) => r.state === DrawState.FARTHER_OR_EQUAL),
      this.#itemStream,
    );
    segment(StaticSegment.OBSCURED_STRIP_DITHER);
    segment(StaticSegment.OBSCURED);
    this.#drawRuns(
      itemRuns.filter((r) => r.state !== DrawState.FARTHER_OR_EQUAL),
      this.#itemStream,
    );
    this.#drawRuns(s.dynamic.runs, this.#dynamicStream);
    p.end();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.#stats = {
      drawCalls: p.drawCalls,
      instances: p.instances,
      staticInstances: assembled.count,
      dynamicInstances: s.dynamic.instances.count + s.dynamic.itemInstances.count,
      staticRebuildMs: this.#rebuildMs,
    };
    return this.#stats;
  }

  #drawRuns(runs: readonly DrawRun[], stream: InstanceStream): void {
    for (const r of runs) this.#program.draw(stream, r.state, r.first, r.count);
  }

  present(target: WebGLFramebuffer | null, targetHeight: number, x: number, y: number, scale: number): void {
    this.framebuffer.present(target, targetHeight, x, y, scale);
  }

  capture(): WorldCapture {
    return this.framebuffer.capture();
  }

  gridNoAt(sx: number, sy: number): number | null {
    const f = this.#last;
    return f ? screenToGridNo(sx, sy, f.viewport, f.camera) : null;
  }

  get placedSoldiers(): readonly PlacedSoldier[] {
    return this.#scene?.dynamic.placedSoldiers ?? [];
  }

  soldierAt(sx: number, sy: number): number | null {
    const s = this.#scene;
    return s ? pickSoldierAt(s.dynamic.placedSoldiers, sx, sy) : null;
  }

  tileScreenPosition(g: number): { readonly x: number; readonly y: number } | null {
    const f = this.#last;
    const s = this.#scene;
    if (!f || !s) return null;
    const renderHeight = s.world.prepared.renderHeight + (f.roofLevel ? ROOF_LEVEL_HEIGHT : 0);
    const off = cameraOffset(f.viewport, f.camera, renderHeight);
    const x = g % WORLD_COLS;
    const y = Math.floor(g / WORLD_COLS);
    return { x: 20 * (x - y) - 20 + off.x, y: 10 * (x + y) - 10 + off.y - (s.world.level.heights[g] ?? 0) };
  }

  dispose(): void {
    this.#scene?.sprites.dispose();
    this.#scene = null;
    this.#staticStream.dispose();
    this.#dynamicStream.dispose();
    this.#itemStream.dispose();
    this.#shade.dispose();
    this.framebuffer.dispose();
  }
}

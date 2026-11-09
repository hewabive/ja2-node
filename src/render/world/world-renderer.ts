import type { Level } from '../../content/world/level.ts';
import type { WorldStructures } from '../../content/world/structures.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import type { TileTables } from '../../content/world/tile-tables.ts';
import { sameTileRuns, type TileRun } from '../../protocol/view.ts';
import { type ScreenRect, type ScreenShift, wholeViewport } from './dirty-rects.ts';
import {
  ANIMATED_TILE_FRAME_MS,
  type DrawRun,
  DynamicScene,
  isDynamic,
  type PlacedSoldier,
  type SceneAniTile,
  type SceneItem,
  type SceneSoldier,
  type StructNode,
  type WorldUiNode,
} from './dynamic-scene.ts';
import {
  type Camera,
  cameraOffset,
  LIGHT_DUSK_CUTOFF,
  ROW_COUNT,
  rowOf,
  sceneRenderHeight,
  topYOf,
  type Viewport,
  visibleRows,
} from './geometry.ts';
import { itemOutlineColour } from './glow.ts';
import { DrawState } from './instances.ts';
import { type LevelRenderData, updateLevelRenderData } from './level-render-data.ts';
import { noBurnAfterChanges } from './no-burn.ts';
import { PartialRedrawCheck, type PartialRedrawChecks } from './partial-redraw-check.ts';
import { pickSoldierAt, type SoldierPickable } from './picking.ts';
import { PictureMemo, type PictureUpdate } from './picture-memo.ts';
import {
  changedRevealTiles,
  computeReveal,
  followWireframes,
  NO_RECALCULATIONS,
  NO_TILE_RUNS,
  type RevealInputs,
  type RevealState,
  recalculationsPending,
  type WireframeHistory,
  type WireframeRecalculations,
} from './reveal.ts';
import type { LightColour } from './soldier-palettes.ts';
import {
  type AssembledScene,
  STATIC_SEGMENT_STATES,
  StaticScene,
  StaticSegment,
  type StaticState,
  type StaticWorld,
} from './static-scene.ts';
import {
  applyBloodPools,
  applyTileChanges,
  type BloodPool,
  bloodPoolsKey,
  structuresAfterTileChanges,
  type TileChange,
  tileChangesKey,
} from './tile-changes.ts';
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
  readonly prepare: (level: Level) => LevelRenderData;
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
  readonly openStructures: ReadonlySet<number>;
  readonly revealedRooms: ReadonlySet<number>;
  readonly revealedAtLoad?: readonly TileRun[];
  readonly revealedTiles?: readonly TileRun[];
  readonly wireframeRecalculations?: WireframeRecalculations;
  readonly slantRoofCeilings?: ReadonlySet<number>;
  readonly soldiers: readonly SceneSoldier[];
  readonly items: readonly SceneItem[];
  readonly uiNodes: readonly WorldUiNode[];
  readonly aniTiles?: readonly SceneAniTile[];
  readonly structNodes?: readonly StructNode[];
  readonly tileChanges?: readonly TileChange[];
  readonly bloodPools?: readonly BloodPool[];
}

export interface ShownWorld {
  readonly level: Level;
  readonly prepared: LevelRenderData;
  readonly reveal: RevealState;
  readonly revealed: Uint8Array;
  readonly openStructures: ReadonlySet<number>;
}

export interface WorldDrawStats {
  readonly drawCalls: number;
  readonly instances: number;
  readonly staticInstances: number;
  readonly dynamicInstances: number;
  readonly staticRebuildMs: number;
}

const NO_STATS: WorldDrawStats = { drawCalls: 0, instances: 0, staticInstances: 0, dynamicInstances: 0, staticRebuildMs: 0 };
const NO_CEILINGS: ReadonlySet<number> = new Set();

let lastPicture = 0;

export interface WorldRendererOptions {
  readonly checkPartialRedraws?: boolean;
}

interface ScenePass {
  readonly scene: LoadedScene;
  readonly frame: WorldFrameInput;
  readonly assembled: AssembledScene;
  readonly rows: { readonly first: number; readonly last: number };
  readonly offset: { readonly x: number; readonly y: number };
  readonly showShadows: boolean;
}

interface LoadedScene {
  readonly original: RenderWorld;
  world: RenderWorld;
  readonly sprites: WorldSprites;
  staticWorld: StaticWorld;
  scene: StaticScene;
  dynamic: DynamicScene;
  tileChanges: string;
  changes: readonly TileChange[];
  pools: readonly BloodPool[];
  reveal: RevealState;
  revealInputs: RevealInputs;
  wireframes: WireframeHistory | null;
  ceilings: ReadonlySet<number>;
  uploaded: boolean;
  shadeVersion: number;
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function sameRevealInputs(a: RevealInputs, b: RevealInputs): boolean {
  return (
    sameSet(a.revealedRooms, b.revealedRooms) &&
    sameTileRuns(a.revealedAtLoad, b.revealedAtLoad) &&
    sameTileRuns(a.revealedTiles, b.revealedTiles)
  );
}

const NO_REVEAL_INPUTS: RevealInputs = { revealedRooms: new Set(), revealedAtLoad: NO_TILE_RUNS, revealedTiles: NO_TILE_RUNS };

function revealInputsOf(f: WorldFrameInput): { readonly inputs: RevealInputs; readonly ceilings: ReadonlySet<number> } {
  const inputs: RevealInputs = {
    revealedRooms: new Set(f.revealedRooms),
    revealedAtLoad: f.revealedAtLoad ?? NO_TILE_RUNS,
    revealedTiles: f.revealedTiles ?? NO_TILE_RUNS,
  };
  return { inputs, ceilings: new Set(f.slantRoofCeilings ?? NO_CEILINGS) };
}

function recalculationsOf(f: WorldFrameInput): WireframeRecalculations {
  return f.wireframeRecalculations ?? NO_RECALCULATIONS;
}

function changedOpenableRows(a: ReadonlySet<number>, b: ReadonlySet<number>): number[] {
  const rows = new Set<number>();
  for (const g of a) if (!b.has(g)) rows.add(rowOf(g));
  for (const g of b) if (!a.has(g)) rows.add(rowOf(g));
  return [...rows];
}

export class WorldRenderer {
  readonly #gl: WebGL2RenderingContext;
  #front: WorldFramebuffer;
  #back: WorldFramebuffer;
  readonly #check: PartialRedrawCheck | null;
  readonly #program: WorldProgram;
  readonly #staticStream: InstanceStream;
  readonly #dynamicStream: InstanceStream;
  readonly #itemStream: InstanceStream;
  readonly #shade: ShadeTexture;
  readonly #memo = new PictureMemo();
  #scene: LoadedScene | null = null;
  #staticUploads = 0;
  #picture = 0;
  #stats: WorldDrawStats = NO_STATS;
  #rebuildMs = 0;

  constructor(gl: WebGL2RenderingContext, options: WorldRendererOptions = {}) {
    this.#gl = gl;
    this.#front = new WorldFramebuffer(gl);
    this.#back = new WorldFramebuffer(gl);
    this.#check = options.checkPartialRedraws ? new PartialRedrawCheck(new WorldFramebuffer(gl)) : null;
    this.#program = new WorldProgram(gl);
    this.#staticStream = new InstanceStream(gl);
    this.#dynamicStream = new InstanceStream(gl);
    this.#itemStream = new InstanceStream(gl);
    this.#shade = new ShadeTexture(gl);
  }

  get stats(): WorldDrawStats {
    return this.#stats;
  }

  get picture(): number {
    return this.#picture;
  }

  get sprites(): WorldSprites | null {
    return this.#scene?.sprites ?? null;
  }

  setWorld(world: RenderWorld): WorldSprites {
    this.#scene?.sprites.dispose();
    const sprites = new WorldSprites(this.#gl, world.tiles, world.surfaces, world.lightColour);
    const staticWorld = this.#staticWorld(world, sprites);
    const reveal = computeReveal(this.#revealWorld(world), new Set());
    const started = performance.now();
    const scene = new StaticScene(staticWorld, { reveal, openStructures: new Set(), treeTops: true, wireframes: true, roofLevel: false });
    this.#rebuildMs = performance.now() - started;
    this.#scene = {
      original: world,
      world,
      sprites,
      staticWorld,
      scene,
      dynamic: new DynamicScene(staticWorld, world.prepared),
      tileChanges: '',
      changes: [],
      pools: [],
      reveal,
      revealInputs: NO_REVEAL_INPUTS,
      wireframes: null,
      ceilings: NO_CEILINGS,
      uploaded: false,
      shadeVersion: -1,
    };
    this.#memo.forget();
    return sprites;
  }

  #staticWorld(world: RenderWorld, sprites: WorldSprites): StaticWorld {
    return {
      level: world.level,
      tiles: world.tiles,
      prepared: world.prepared,
      topY: topYOf(world.restrictedScrollId),
      sprite: (tile) => sprites.tileSprite(tile),
    };
  }

  #syncTileChanges(s: LoadedScene, f: WorldFrameInput): void {
    const changes = f.tileChanges ?? [];
    const pools = f.bloodPools ?? [];
    const key = pools.length > 0 ? `${tileChangesKey(changes)}|${bloodPoolsKey(pools)}` : tileChangesKey(changes);
    if (key === s.tileChanges) return;
    const started = performance.now();
    const both = [...s.changes, ...changes];
    const touched = new Set([...both, ...s.pools, ...pools].map((c) => c.gridNo));
    const level = applyBloodPools(applyTileChanges(s.original.level, changes), s.original.tables, pools);
    const noBurn = noBurnAfterChanges(s.original.prepared.noBurn, s.original.structures, s.original.tiles, changes);
    const prepared = updateLevelRenderData(s.world.prepared, level, s.original.tiles, s.original.tables, touched, noBurn);
    const structures = structuresAfterTileChanges(s.original.structures, s.original.tiles, changes).structures;
    const world: RenderWorld = { ...s.original, level, prepared, structures };
    const previousReveal = s.reveal;
    s.world = world;
    s.tileChanges = key;
    s.changes = changes;
    s.pools = pools;
    s.staticWorld = this.#staticWorld(world, s.sprites);
    const reveal = revealInputsOf(f);
    s.reveal = this.#followReveal(s, reveal.inputs, reveal.ceilings, recalculationsOf(f), true);
    const rows = new Set([...touched].map(rowOf));
    for (const g of changedRevealTiles(previousReveal, s.reveal, level)) rows.add(rowOf(g));
    s.scene.replaceWorld(s.staticWorld, { ...s.scene.state, reveal: s.reveal }, rows);
    const dynamicTouched = both.some((c) => isDynamic(s.original.tiles[c.tile]));
    s.dynamic = new DynamicScene(s.staticWorld, prepared, dynamicTouched ? undefined : s.dynamic.mapNodes);
    s.uploaded = false;
    this.#rebuildMs = performance.now() - started;
  }

  #revealWorld(w: RenderWorld) {
    return { level: w.level, tiles: w.tiles, tables: w.tables, structures: w.structures, basement: w.basement };
  }

  #followReveal(
    s: LoadedScene,
    inputs: RevealInputs,
    ceilings: ReadonlySet<number>,
    recalculations: WireframeRecalculations,
    structuresChanged = false,
  ): RevealState {
    const w = this.#revealWorld(s.world);
    const before = s.wireframes;
    const history = followWireframes(w, before, inputs, recalculations);
    const wireframes = history.wireframes;
    const onlySightChanged =
      before !== null &&
      !structuresChanged &&
      wireframes.sameWiresAs(before.wireframes) &&
      sameSet(before.inputs.revealedRooms, inputs.revealedRooms) &&
      sameTileRuns(before.inputs.revealedAtLoad, inputs.revealedAtLoad) &&
      sameSet(s.ceilings, ceilings);
    s.wireframes = history;
    s.revealInputs = inputs;
    s.ceilings = ceilings;
    if (onlySightChanged) return { ...s.reveal, revealed: wireframes.revealed };
    return computeReveal(w, inputs.revealedRooms, ceilings, inputs.revealedAtLoad, wireframes);
  }

  #syncStatic(s: LoadedScene, f: WorldFrameInput): void {
    const old = s.scene.state;
    const rows = new Set<number>();
    const { inputs, ceilings } = revealInputsOf(f);
    const recalculations = recalculationsOf(f);
    const recalculating = recalculationsPending(s.wireframes, recalculations);
    if (!sameRevealInputs(s.revealInputs, inputs) || !sameSet(s.ceilings, ceilings) || recalculating) {
      const previous = s.reveal;
      s.reveal = this.#followReveal(s, inputs, ceilings, recalculations);
      for (const g of changedRevealTiles(previous, s.reveal, s.world.level)) rows.add(rowOf(g));
    }
    const next: StaticState = {
      reveal: s.reveal,
      openStructures: sameSet(old.openStructures, f.openStructures) ? old.openStructures : new Set(f.openStructures),
      treeTops: f.options.treeTops,
      wireframes: f.options.wireframes,
      roofLevel: f.roofLevel,
    };
    for (const row of changedOpenableRows(old.openStructures, next.openStructures)) rows.add(row);
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
    const resized = this.#front.width !== f.viewport.width || this.#front.height !== f.viewport.height;
    for (const fb of this.#framebuffers()) fb.resize(f.viewport.width, f.viewport.height);
    const s = this.#scene;
    if (!s) {
      this.#front.begin();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.#memo.forget();
      this.#picture = ++lastPicture;
      this.#stats = NO_STATS;
      return NO_STATS;
    }
    this.#syncTileChanges(s, f);
    this.#syncStatic(s, f);
    const assembled = s.scene.assemble();
    if (!s.uploaded) {
      this.#staticStream.upload(assembled.data, assembled.count);
      s.uploaded = true;
      this.#staticUploads++;
    }
    if (s.shadeVersion !== f.shade.version) {
      this.#shade.upload(f.shade.land, f.shade.roof);
      s.shadeVersion = f.shade.version;
    }
    const renderHeight = sceneRenderHeight(s.world.prepared.renderHeight, f.roofLevel);
    const rows = visibleRows(f.viewport, f.camera, renderHeight, assembled.reach);
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
      aniTiles: f.aniTiles ?? [],
      structNodes: f.structNodes ?? [],
    });
    const pass: ScenePass = {
      scene: s,
      frame: f,
      assembled,
      rows,
      offset: cameraOffset(f.viewport, f.camera, renderHeight),
      showShadows: f.options.shadows && f.shade.ambient < LIGHT_DUSK_CUTOFF,
    };
    const update = this.#plan(pass, renderHeight);
    if (update.kind === 'same' && !resized) return this.#stats;
    const partial = update.kind === 'partial' && !resized ? update : null;
    if (partial && (partial.shift.x !== 0 || partial.shift.y !== 0)) this.#shiftPicture(partial.shift);
    this.#picture = ++lastPicture;
    this.#dynamicStream.upload(s.dynamic.instances.data, s.dynamic.instances.count);
    this.#itemStream.upload(s.dynamic.itemInstances.data, s.dynamic.itemInstances.count);
    this.#drawPass(this.#front, pass, partial ? partial.rects : [wholeViewport(f.viewport)]);
    const p = this.#program;
    this.#stats = {
      drawCalls: p.drawCalls,
      instances: p.instances,
      staticInstances: assembled.count,
      dynamicInstances: s.dynamic.instances.count + s.dynamic.itemInstances.count,
      staticRebuildMs: this.#rebuildMs,
    };
    if (partial) this.#checkPartial(pass);
    return this.#stats;
  }

  #plan(pass: ScenePass, renderHeight: number): PictureUpdate {
    const { frame: f, scene: s } = pass;
    const memo = this.#memo;
    memo.begin(f.viewport, pass.offset);
    memo.add(f.shade.natural, f.shade.version, this.#staticUploads, renderHeight, pass.showShadows ? 1 : 0, f.options.roofs ? 1 : 0);
    memo.addVisible(s.dynamic.itemRuns, s.dynamic.itemInstances);
    memo.addVisible(s.dynamic.runs, s.dynamic.instances);
    return memo.update();
  }

  #framebuffers(): WorldFramebuffer[] {
    return this.#check ? [this.#front, this.#back, this.#check.framebuffer] : [this.#front, this.#back];
  }

  #shiftPicture(shift: ScreenShift): void {
    const shifted = this.#back;
    shifted.copyShifted(this.#front, shift);
    this.#back = this.#front;
    this.#front = shifted;
  }

  #drawPass(target: WorldFramebuffer, pass: ScenePass, rects: readonly ScreenRect[]): void {
    const { scene: s, frame: f, assembled, rows } = pass;
    target.clearRects(rects);
    const p = this.#program;
    p.begin({
      viewport: f.viewport,
      offset: pass.offset,
      natural: f.shade.natural,
      atlas: s.sprites.atlas.texture(),
      palette: s.sprites.palettes.texture(),
      shade: this.#shade.texture,
      rects,
    });
    const segment = (seg: StaticSegment) => {
      const base = seg * (ROW_COUNT + 1);
      const first = assembled.rowStart[base + rows.first] ?? 0;
      const end = assembled.rowStart[base + rows.last + 1] ?? first;
      p.draw(this.#staticStream, STATIC_SEGMENT_STATES[seg] ?? DrawState.LAND, first, end - first);
    };
    segment(StaticSegment.LAND);
    segment(StaticSegment.OBJECTS);
    if (pass.showShadows) segment(StaticSegment.SHADOWS);
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
    this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, null);
  }

  #checkPartial(pass: ScenePass): void {
    const check = this.#check;
    if (!check) return;
    this.#drawPass(check.framebuffer, pass, [wholeViewport(pass.frame.viewport)]);
    check.compare(this.#front.capture(), check.framebuffer.capture());
  }

  #drawRuns(runs: readonly DrawRun[], stream: InstanceStream): void {
    for (const r of runs) this.#program.draw(stream, r.state, r.first, r.count);
  }

  present(target: WebGLFramebuffer | null, targetHeight: number, x: number, y: number, scale: number): void {
    this.#front.present(target, targetHeight, x, y, scale);
  }

  capture(): WorldCapture {
    return this.#front.capture();
  }

  get checks(): PartialRedrawChecks | null {
    return this.#check?.results ?? null;
  }

  get shownWorld(): ShownWorld | null {
    const s = this.#scene;
    return s
      ? {
          level: s.world.level,
          prepared: s.world.prepared,
          reveal: s.reveal,
          revealed: s.reveal.revealed,
          openStructures: s.scene.state.openStructures,
        }
      : null;
  }

  get placedSoldiers(): readonly PlacedSoldier[] {
    return this.#scene?.dynamic.placedSoldiers ?? [];
  }

  soldierAt(sx: number, sy: number, pickable?: SoldierPickable): number | null {
    const s = this.#scene;
    return s ? pickSoldierAt(s.dynamic.placedSoldiers, sx, sy, pickable) : null;
  }

  dispose(): void {
    this.#scene?.sprites.dispose();
    this.#scene = null;
    this.#staticStream.dispose();
    this.#dynamicStream.dispose();
    this.#itemStream.dispose();
    this.#shade.dispose();
    for (const fb of this.#framebuffers()) fb.dispose();
  }
}

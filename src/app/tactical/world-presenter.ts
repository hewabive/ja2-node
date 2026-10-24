// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Find.cc GetSoldierTRUEScreenPos; src/game/Tactical/Interface.cc
// @src GetSoldierAboveGuyPositions (the stance offset: 30 for crows and the weaponless robot, else 25 prone, 10 crouched
// @src from the height of a no-move-marker animation or its end height), DrawSelectedUIAboveGuy (ANIM_NOSHOW_MARKER);
// @src src/game/Tactical/Faces.cc HandleAutoFaces (the moving highlight); src/game/Tactical/Overhead.cc LocateSoldier;
// @src src/game/TileEngine/Lighting.cc CreateTilePaletteTables (tile pictures at shade 4 over the map's light colour);
// @src src/game/Tactical/Interface_Items.cc (the pickup menu's tile graphic); src/game/Tactical/Interface.cc
// @src (THIRDPOINTERS1/2 behind the overhead bars); src/game/Tactical/Interface_Control.cc SetUpInterface (the UI
// @src nodes of the tactical input); src/game/TileEngine/RenderWorld.cc ScrollWorld, HandleScrollDirections (the
// @src scrolled-to-edge flags, the scroll steps); src/game/TileEngine/Interactive_Tiles.cc
// @src InternalGetCurInteractiveTile (doors and switches; the tile under the pointer, not the picture's pixels).

import { type AnimationTables, AnimFlags } from '../../content/anim/tables.ts';
import { WORLD_COLS } from '../../content/world/grid.ts';
import { NORMAL_SHADE, shadedDisplayPalette } from '../../content/world/shading.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { tileIndexFromTypeSubIndex } from '../../content/world/tile-tables.ts';
import type { CatalogueItem } from '../../protocol/items.ts';
import type { PlayerView, SoldierView } from '../../protocol/view.ts';
import { cameraOnGridNo, type ScrollLimits, scrollBy, scrollLimits, setRenderCenter } from '../../render/world/camera.ts';
import type { WorldUiNode } from '../../render/world/dynamic-scene.ts';
import {
  type Camera,
  cameraOffset,
  mapCenter,
  ROOF_LEVEL_HEIGHT,
  type Viewport,
  WALL_HEIGHT,
  worldOrigin,
} from '../../render/world/geometry.ts';
import type { WorldDrawStats, WorldRenderer } from '../../render/world/world-renderer.ts';
import { Body } from '../../sim/tactical/soldier.ts';
import { TEAMPANEL_HEIGHT } from '../../ui/layout/frames.ts';
import type {
  InteractiveTile,
  OverheadMapView,
  RadarBox,
  ScreenBox,
  ScreenPoint,
  ScrollEdges,
  SoldierHeight,
  SoldierMarker,
  UiImageRef,
  WorldMarker,
  WorldPresenter,
} from '../../ui/screens/tactical/environment.ts';
import type { UiAssets } from '../game/ui-assets.ts';
import { AiTurnHolder } from '../world/ai-turn.ts';
import { gridNoOnScreen, RADAR_HEIGHT, RADAR_WIDTH, radarCellAt, radarDotOf, radarViewportBox } from '../world/radar.ts';
import { nightTime } from '../world/soldier-scene.ts';
import type { TacticalDisplayOptions, TacticalWorldView } from '../world/tactical-world-view.ts';
import { mapLightColour } from '../world/world-loader.ts';

const BAR_BOX = 'THIRDPOINTERS1';
const SELECTED_BAR_BOX = 'THIRDPOINTERS2';
const TILE_PICTURE_PREFIX = 'tile:';
const HEIGHT_STAND = 6;
const HEIGHT_CROUCH = 3;
const HEIGHT_PRONE = 1;
const PRONE_OFFSET = 25;
const CROUCH_OFFSET = 10;
const SMALL_BODY_OFFSET = 30;
const CELL_SIZE = 10;
const HALF_CELL = 5;
const PICK_LIFT = 10;
const NO_MARKER: SoldierMarker = { stanceOffset: 0, hidden: false, moving: false, stationary: true };
const EDGE_PROBE_PX = 1;
const INTERACTIVE_MASK = StructureFlags.ANYDOOR | StructureFlags.SWITCH;
const ROOF_LAYERS: ReadonlySet<WorldMarker['layer']> = new Set(['roof', 'onRoof']);

export interface PresenterSources {
  readonly view: () => PlayerView | null;
  readonly clockMs: () => number;
  readonly options: () => TacticalDisplayOptions;
}

function heightName(height: number): SoldierHeight {
  if (height === HEIGHT_PRONE) return 'prone';
  if (height === HEIGHT_CROUCH) return 'crouch';
  return 'stand';
}

function stanceOffsetOf(height: number): number {
  if (height === HEIGHT_PRONE) return PRONE_OFFSET;
  if (height === HEIGHT_CROUCH) return CROUCH_OFFSET;
  return 0;
}

export class TacticalWorldPresenter implements WorldPresenter {
  readonly ready = true;
  readonly radarImage: string | null;
  readonly aiTurns = new AiTurnHolder();
  readonly #world: TacticalWorldView;
  readonly #renderer: WorldRenderer;
  readonly #assets: UiAssets;
  readonly #animations: AnimationTables;
  readonly #sources: PresenterSources;
  readonly #limits: ScrollLimits;
  readonly #palettes = new Map<string, Uint8Array>();
  #camera: Camera;
  #viewport: Viewport = { width: 640, height: 360 };
  #top = 0;
  #roofLevel = false;
  #hovered: number | null = null;
  #selected: number | null = null;
  #stats: WorldDrawStats | null = null;
  #markers: readonly WorldMarker[] = [];
  #overhead: OverheadMapView | null = null;
  #overheadLoader: (() => Promise<OverheadMapView | null>) | null = null;
  #overheadLoading = false;

  constructor(
    world: TacticalWorldView,
    renderer: WorldRenderer,
    assets: UiAssets,
    animations: AnimationTables,
    sources: PresenterSources,
    radarImage: string | null,
  ) {
    this.#world = world;
    this.#renderer = renderer;
    this.#assets = assets;
    this.#animations = animations;
    this.#sources = sources;
    this.radarImage = radarImage;
    this.#limits = scrollLimits(world.world.map.info.restrictedScrollId);
    this.#camera = cameraOnGridNo(world.world.map.info.centerGridNo);
  }

  get mapPath(): string {
    return this.#world.world.mapPath;
  }

  get camera(): Camera {
    return this.#camera;
  }

  get viewport(): Viewport {
    return this.#viewport;
  }

  get stats(): WorldDrawStats | null {
    return this.#stats;
  }

  get drawnSoldiers(): number {
    return this.#world.drawnSoldiers;
  }

  get night(): boolean {
    const clock = this.#sources.view()?.clock;
    return clock !== undefined && clock !== null && nightTime(clock.hour) && !this.#world.world.underground;
  }

  #soldier(id: number): SoldierView | null {
    return this.#sources.view()?.soldiers.find((s) => s.id === id) ?? null;
  }

  resize(width: number, height: number): void {
    const next = { width, height: Math.max(1, height - TEAMPANEL_HEIGHT) };
    if (next.width === this.#viewport.width && next.height === this.#viewport.height) return;
    this.#viewport = next;
    this.#camera = setRenderCenter(this.#camera, next, this.#limits);
  }

  #renderHeight(): number {
    return this.#world.world.prepared.renderHeight + (this.#roofLevel ? ROOF_LEVEL_HEIGHT : 0);
  }

  soldierTrueScreenPosition(id: number): ScreenPoint | null {
    const s = this.#soldier(id);
    if (!s) return null;
    const c = mapCenter(this.#viewport);
    const dx = Math.fround(s.x - this.#camera.centerX);
    const dy = Math.fround(s.y - this.#camera.centerY);
    const land = this.#world.world.level.heights[s.gridNo] ?? 0;
    return {
      x: c.x + Math.trunc(Math.fround(2 * dx - 2 * dy)),
      y: c.y + Math.trunc(Math.fround(dx + dy)) + this.#renderHeight() - land - (s.level > 0 ? WALL_HEIGHT : 0),
    };
  }

  gridNoPickPoint(gridNo: number): ScreenPoint {
    const c = mapCenter(this.#viewport);
    const dx = (gridNo % WORLD_COLS) * CELL_SIZE + HALF_CELL - this.#camera.centerX;
    const dy = Math.floor(gridNo / WORLD_COLS) * CELL_SIZE + HALF_CELL - this.#camera.centerY;
    return { x: c.x + 2 * dx - 2 * dy, y: c.y + dx + dy - PICK_LIFT };
  }

  cellScreenPosition(gridNo: number): ScreenPoint {
    const c = mapCenter(this.#viewport);
    const dx = (gridNo % WORLD_COLS) * CELL_SIZE - this.#camera.centerX;
    const dy = Math.floor(gridNo / WORLD_COLS) * CELL_SIZE - this.#camera.centerY;
    return { x: c.x + 2 * dx - 2 * dy, y: c.y + dx + dy };
  }

  soldierBox(id: number): ScreenBox | null {
    const placed = this.#renderer.placedSoldiers.find((p) => p.id === id);
    return placed ? { x: placed.x, y: placed.y, width: placed.width, height: placed.height } : null;
  }

  soldierHeight(id: number): SoldierHeight {
    const s = this.#soldier(id);
    const control = s ? this.#animations.controls[s.animation] : undefined;
    return heightName(control?.endHeight ?? HEIGHT_STAND);
  }

  soldierMarker(id: number): SoldierMarker {
    const s = this.#soldier(id);
    const control = s ? this.#animations.controls[s.animation] : undefined;
    if (!s || !control) return NO_MARKER;
    const height = control.flags & AnimFlags.NOMOVE_MARKER ? control.height : control.endHeight;
    const smallBody = s.bodyType === Body.CROW || s.bodyType === Body.ROBOTNOWEAPON;
    return {
      stanceOffset: smallBody ? SMALL_BODY_OFFSET : stanceOffsetOf(height),
      hidden: (control.flags & AnimFlags.NOSHOW_MARKER) !== 0,
      moving: (control.flags & AnimFlags.MOVING) !== 0,
      stationary: (control.flags & AnimFlags.STATIONARY) !== 0,
    };
  }

  soldierAt(x: number, y: number): number | null {
    if (y < this.#top || y >= this.#viewport.height) return null;
    return this.#renderer.soldierAt(x, y);
  }

  gridNoAt(x: number, y: number): number | null {
    if (y < this.#top || y >= this.#viewport.height) return null;
    return this.#renderer.gridNoAt(x, y);
  }

  radarViewport(): RadarBox | null {
    return radarViewportBox({ ...this.#viewport, camera: this.#camera });
  }

  radarDot(gridNo: number): ScreenPoint | null {
    return radarDotOf(gridNo);
  }

  centerOn(gridNo: number): void {
    this.#camera = setRenderCenter(cameraOnGridNo(gridNo), this.#viewport, this.#limits);
  }

  locate(gridNo: number): void {
    if (!gridNoOnScreen(gridNo, { ...this.#viewport, camera: this.#camera }, this.#top > 0)) this.centerOn(gridNo);
  }

  centerFromRadar(x: number, y: number): void {
    const cell = radarCellAt(x / RADAR_WIDTH, y / RADAR_HEIGHT);
    this.#camera = setRenderCenter({ centerX: cell.cellX, centerY: cell.cellY }, this.#viewport, this.#limits);
  }

  setViewport(top: number, _bottom: number): void {
    this.#top = top;
  }

  setRoofLevel(on: boolean): void {
    this.#roofLevel = on;
  }

  setHovered(id: number | null): void {
    this.#hovered = id;
  }

  setSelected(id: number | null): void {
    this.#selected = id;
  }

  #tilePicture(tile: number): UiImageRef | null {
    const world = this.#world.world;
    const element = world.tiles[tile];
    const surface = element ? world.surfaces[element.type] : null;
    if (!element || !surface) return null;
    const key = `${TILE_PICTURE_PREFIX}${element.surfacePath}`;
    if (!this.#assets.info(key)) this.#assets.addPicture(key, surface.picture, this.#palette(element.surfacePath, surface.picture.palette));
    return { path: key, frame: element.regionIndex };
  }

  #palette(path: string, palette: Uint8Array): Uint8Array {
    const known = this.#palettes.get(path);
    if (known) return known;
    const shaded = shadedDisplayPalette(palette, NORMAL_SHADE, mapLightColour(this.#world.world.map));
    this.#palettes.set(path, shaded);
    return shaded;
  }

  #namedTile(name: string): number | null {
    return this.#world.world.tables.tileIndexByName.get(name) ?? null;
  }

  itemTile(item: CatalogueItem): UiImageRef | null {
    const tables = this.#world.world.tables;
    const type = tables.typeIndexByName.get(item.tileGraphic.type);
    if (type === undefined) return null;
    return this.#tilePicture(tileIndexFromTypeSubIndex(tables, type, item.tileGraphic.subIndex));
  }

  pointerBox(selected: boolean): UiImageRef | null {
    const tile = this.#namedTile(selected ? SELECTED_BAR_BOX : BAR_BOX);
    return tile === null ? null : this.#tilePicture(tile);
  }

  setMarkers(markers: readonly WorldMarker[]): void {
    this.#markers = markers;
  }

  #uiNodes(): WorldUiNode[] {
    return this.#markers.flatMap((m) => {
      const tile = this.#namedTile(m.tile);
      if (tile === null) return [];
      return [
        {
          gridNo: m.gridNo,
          layer: m.layer,
          tile,
          ...(m.head ? { head: true } : {}),
          ...(m.offsetX ? { offsetX: m.offsetX } : {}),
          ...(m.offsetY ? { offsetY: m.offsetY } : {}),
        },
      ];
    });
  }

  markerScreenPoint(marker: WorldMarker): ScreenPoint | null {
    const tile = this.#namedTile(marker.tile);
    const world = this.#world.world;
    const element = tile === null ? undefined : world.tiles[tile];
    const frame = element ? world.surfaces[element.type]?.frames[element.regionIndex] : undefined;
    if (!element || !frame) return null;
    const x = marker.gridNo % WORLD_COLS;
    const y = Math.floor(marker.gridNo / WORLD_COLS);
    const origin = worldOrigin(x, y);
    const offset = cameraOffset(this.#viewport, this.#camera, this.#renderHeight());
    const lift = (world.level.heights[marker.gridNo] ?? 0) + (ROOF_LAYERS.has(marker.layer) ? WALL_HEIGHT : 0);
    return {
      x: origin.x + offset.x + frame.offsetX + (marker.offsetX ?? 0),
      y: origin.y + offset.y - lift + frame.offsetY + (marker.offsetY ?? 0),
    };
  }

  interactiveTileAt(gridNo: number, level: number): InteractiveTile | null {
    if (level > 0) return null;
    const found = this.#world.world.structures.find(gridNo, INTERACTIVE_MASK);
    if (!found) return null;
    const base = this.#world.world.structures.findBase(found) ?? found;
    const openDoors = this.#sources.view()?.openDoors ?? [];
    return {
      gridNo: base.gridNo,
      door: (found.flags & StructureFlags.ANYDOOR) !== 0,
      switch: (found.flags & StructureFlags.SWITCH) !== 0,
      open: openDoors.includes(base.gridNo),
    };
  }

  exitGridAt(gridNo: number): boolean {
    return this.#world.world.tactical.exitGrids.has(gridNo);
  }

  #moved(dx: number, dy: number): Camera {
    return scrollBy(this.#camera, dx, dy, this.#viewport, this.#limits);
  }

  #stuck(dx: number, dy: number): boolean {
    const next = this.#moved(dx, dy);
    return next.centerX === this.#camera.centerX && next.centerY === this.#camera.centerY;
  }

  scrollEdges(): ScrollEdges {
    return {
      left: this.#stuck(-EDGE_PROBE_PX * 40, 0),
      right: this.#stuck(EDGE_PROBE_PX * 40, 0),
      top: this.#stuck(0, -EDGE_PROBE_PX * 20),
      bottom: this.#stuck(0, EDGE_PROBE_PX * 20),
    };
  }

  scrollBy(dx: number, dy: number): boolean {
    const next = this.#moved(dx, dy);
    if (next.centerX === this.#camera.centerX && next.centerY === this.#camera.centerY) return false;
    this.#camera = next;
    return true;
  }

  setOverheadLoader(loader: () => Promise<OverheadMapView | null>): void {
    this.#overheadLoader = loader;
  }

  overheadMap(): OverheadMapView | null {
    if (this.#overhead || this.#overheadLoading || !this.#overheadLoader) return this.#overhead;
    this.#overheadLoading = true;
    void this.#overheadLoader()
      .then((view) => {
        this.#overhead = view;
      })
      .catch(() => undefined);
    return null;
  }

  tileImage(name: string): UiImageRef | null {
    const tile = this.#namedTile(name);
    return tile === null ? null : this.#tilePicture(tile);
  }

  tileCentre(gridNo: number): ScreenPoint {
    const c = mapCenter(this.#viewport);
    const dx = (gridNo % WORLD_COLS) * CELL_SIZE + HALF_CELL - this.#camera.centerX;
    const dy = Math.floor(gridNo / WORLD_COLS) * CELL_SIZE + HALF_CELL - this.#camera.centerY;
    const land = this.#world.world.level.heights[gridNo] ?? 0;
    return { x: c.x + 2 * dx - 2 * dy, y: c.y + dx + dy - land + this.#renderHeight() };
  }

  draw(target: WebGLFramebuffer, logicalHeight: number): void {
    const view = this.#sources.view();
    if (!view) return;
    this.#stats = this.#world.render({
      viewport: this.#viewport,
      camera: this.#camera,
      clockMs: this.#sources.clockMs(),
      roofLevel: this.#roofLevel,
      options: this.#sources.options(),
      view: {
        tick: view.tick,
        soldiers: view.soldiers,
        items: view.items ?? [],
        openDoors: view.openDoors ?? [],
        revealedRooms: view.revealedRooms ?? [],
        clock: view.clock ?? null,
        combat: view.combat ?? null,
        corpses: view.corpses ?? [],
        smoke: view.smoke ?? [],
        light: view.light ?? null,
        tileChanges: view.tileChanges ?? [],
      },
      hovered: this.#hovered,
      selected: this.#selected,
      uiNodes: this.#uiNodes(),
      underAiControl: (id) => this.aiTurns.holds(id),
    });
    this.#renderer.present(target, logicalHeight, 0, 0, 1);
  }
}

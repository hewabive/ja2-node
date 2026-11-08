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
// @src InternalGetCurInteractiveTile (the found node's structure as it is now, 2026-11-04; STRUCTURE_HASITEMONTOP read as
// @src a shown item on the structure's tile, 2026-11-04);
// @src src/game/TileEngine/Isometric_Utils.cc GetMouseWorldCoords (the tile under the pointer from the current render centre);
// @src src/game/Tactical/Soldier_Find.cc GetSoldierScreenRect, GetSoldierScreenPos (the soldier's rectangle from the
// @src current render centre, his position now and his bounding box); FindSoldier with
// @src src/game/TileEngine/Interactive_Tiles.cc CheckVideoObjectScreenCoordinateInData (a vehicle's current frame tested
// @src one pixel left of the pointer, its rows counted up from the bottom of the rectangle);
// @src src/game/TileEngine/Overhead_Map.cc GoIntoOverheadMap (gfOverheadMapDirty: the overhead map composed again from the
// @src world as last drawn at every entry, 2026-11-04); src/game/TileEngine/RenderWorld.cc SetRenderCenter and ScrollWorld
// @src (nothing moves the view while gfIgnoreScrolling holds, 2026-11-08).

import { type AnimationTables, AnimFlags } from '../../content/anim/tables.ts';
import { WORLD_COLS } from '../../content/world/grid.ts';
import { NORMAL_SHADE, shadedDisplayPalette } from '../../content/world/shading.ts';
import { tileIndexFromTypeSubIndex } from '../../content/world/tile-tables.ts';
import { idiv } from '../../core/int.ts';
import type { CatalogueItem } from '../../protocol/items.ts';
import type { BulletView, PlayerView, SoldierView } from '../../protocol/view.ts';
import { cameraOnGridNo, type ScrollLimits, scrollBy, scrollLimits, setRenderCenter } from '../../render/world/camera.ts';
import { ANIMATED_TILE_FRAME_MS, screenHeightAdjustment, soldierScreenPoint, type WorldUiNode } from '../../render/world/dynamic-scene.ts';
import {
  type Camera,
  cameraOffset,
  mapCenter,
  sceneRenderHeight,
  screenToGridNo,
  type Viewport,
  WALL_HEIGHT,
  worldOrigin,
} from '../../render/world/geometry.ts';
import type { WorldDrawStats, WorldRenderer } from '../../render/world/world-renderer.ts';
import type { EffectEvent } from '../../sim/events.ts';
import { Body } from '../../sim/tactical/soldier.ts';
import { TEAMPANEL_HEIGHT } from '../../ui/layout/frames.ts';
import type {
  InteractiveNode,
  InteractiveNodeRef,
  InteractiveTile,
  OverheadMapView,
  RadarBox,
  ScreenBox,
  ScreenPoint,
  ScrollEdges,
  SlideView,
  SoldierHeight,
  SoldierMarker,
  UiImageRef,
  WorldMarker,
  WorldPresenter,
} from '../../ui/screens/tactical/environment.ts';
import { findSoldier, PICK_ANYONE } from '../../ui/screens/tactical/input/targets.ts';
import type { UiAssets } from '../game/ui-assets.ts';
import { type InteractiveWorld, interactiveNodesAt, interactiveTileOf, pictureHasDataAt } from '../world/interactive-nodes.ts';
import { gridNoOnScreen, radarDotOf, radarRenderCenter, radarViewportBox } from '../world/radar.ts';
import type { SoldierOrigin } from '../world/roof-markers.ts';
import { slideView } from '../world/slide.ts';
import { nightTime } from '../world/soldier-scene.ts';
import type { TacticalDisplayOptions, TacticalWorldView } from '../world/tactical-world-view.ts';
import { mapLightColour } from '../world/world-loader.ts';
import { OverheadPicture, type OverheadTiles } from './overhead-map.ts';

const BAR_BOX = 'THIRDPOINTERS1';
const SELECTED_BAR_BOX = 'THIRDPOINTERS2';
const TILE_PICTURE_PREFIX = 'tile:';
const OVERHEAD_PICTURE_PREFIX = 'overhead:';
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
const ROOF_LAYERS: ReadonlySet<WorldMarker['layer']> = new Set(['roof', 'onRoof']);
const GROUND_LEVEL = 0;

export interface PresenterSources {
  readonly view: () => PlayerView | null;
  readonly shownTick: () => number;
  readonly bullets: () => readonly BulletView[];
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
  readonly #world: TacticalWorldView;
  readonly #renderer: WorldRenderer;
  readonly #assets: UiAssets;
  readonly #animations: AnimationTables;
  readonly #sources: PresenterSources;
  readonly #limits: ScrollLimits;
  readonly #restrictedScrollId: number;
  readonly #palettes = new Map<string, Uint8Array>();
  #camera: Camera;
  #scrollingIgnored = false;
  #viewport: Viewport = { width: 640, height: 360 };
  #top = 0;
  #roofLevel = false;
  #hovered: number | null = null;
  #selected: number | null = null;
  #stats: WorldDrawStats | null = null;
  #markers: readonly WorldMarker[] = [];
  #overhead: OverheadPicture | null = null;
  #overheadTilesLoader: (() => Promise<OverheadTiles>) | null = null;
  #overheadTiles: OverheadTiles | null = null;
  #overheadTilesLoading = false;
  #overheadDirty = false;
  #overheadPictures = 0;

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
    this.#restrictedScrollId = world.world.map.info.restrictedScrollId;
    this.#limits = scrollLimits(this.#restrictedScrollId);
    this.#camera = cameraOnGridNo(world.world.map.info.centerGridNo);
  }

  get mapPath(): string {
    return this.#world.world.mapPath;
  }

  get picture(): number {
    return this.#renderer.picture;
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

  get drawnBullets(): number {
    return this.#world.drawnBullets;
  }

  get drawnImpacts(): number {
    return this.#world.drawnImpacts;
  }

  get drawnEffects(): number {
    return this.#world.drawnEffects;
  }

  observeEffects(effects: readonly EffectEvent[]): void {
    this.#world.observeEffects(effects);
  }

  resetEffects(soldiers: SoldierOrigin): void {
    this.#world.resetEffects(soldiers);
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
    return sceneRenderHeight(this.#world.world.prepared.renderHeight, this.#roofLevel);
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
      y: c.y + Math.trunc(Math.fround(dx + dy)) + this.#renderHeight() - land - screenHeightAdjustment(s.heightAdjustment ?? 0),
    };
  }

  gridNoPickPoint(gridNo: number): ScreenPoint {
    const c = mapCenter(this.#viewport);
    const dx = (gridNo % WORLD_COLS) * CELL_SIZE + HALF_CELL - this.#camera.centerX;
    const dy = idiv(gridNo, WORLD_COLS) * CELL_SIZE + HALF_CELL - this.#camera.centerY;
    return { x: c.x + 2 * dx - 2 * dy, y: c.y + dx + dy - PICK_LIFT };
  }

  cellScreenPosition(gridNo: number): ScreenPoint {
    const c = mapCenter(this.#viewport);
    const dx = (gridNo % WORLD_COLS) * CELL_SIZE - this.#camera.centerX;
    const dy = idiv(gridNo, WORLD_COLS) * CELL_SIZE - this.#camera.centerY;
    return { x: c.x + 2 * dx - 2 * dy, y: c.y + dx + dy };
  }

  soldierBox(id: number): ScreenBox | null {
    const s = this.#soldier(id);
    const bounds = this.#world.soldierBoundingBox(id);
    if (!s || !bounds) return null;
    const at = soldierScreenPoint(
      { viewport: this.#viewport, camera: this.#camera, renderHeight: this.#renderHeight() },
      this.#world.world.level.heights[s.gridNo] ?? 0,
      { x: s.x, y: s.y, heightAdjustment: s.heightAdjustment ?? 0 },
    );
    return { x: at.x + bounds.offsetX, y: at.y + bounds.offsetY, width: bounds.width, height: bounds.height };
  }

  soldierPictureAt(id: number, x: number, y: number): boolean {
    const box = this.soldierBox(id);
    const sprite = this.#world.soldierSprite(id);
    if (!box || !sprite) return false;
    const aboveBottom = box.y + box.height - Math.floor(y);
    return pictureHasDataAt(sprite, Math.floor(x) - box.x, sprite.height - aboveBottom);
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
    const gridNo = this.gridNoAt(x, y);
    const soldiers = this.#sources.view()?.soldiers ?? [];
    if (gridNo === null) return null;
    return findSoldier(soldiers, { x, y, gridNo, level: this.#roofLevel ? 1 : 0 }, this, PICK_ANYONE)?.id ?? null;
  }

  gridNoAt(x: number, y: number): number | null {
    if (y < this.#top || y >= this.#viewport.height) return null;
    return screenToGridNo(x, y, this.#viewport, this.#camera);
  }

  radarViewport(): RadarBox | null {
    return radarViewportBox(this.#restrictedScrollId, { ...this.#viewport, camera: this.#camera });
  }

  radarDot(gridNo: number): ScreenPoint | null {
    return radarDotOf(this.#restrictedScrollId, gridNo);
  }

  ignoreScrolling(on: boolean): void {
    this.#scrollingIgnored = on;
  }

  centerOn(gridNo: number): void {
    if (this.#scrollingIgnored) return;
    this.#camera = setRenderCenter(cameraOnGridNo(gridNo), this.#viewport, this.#limits);
  }

  locate(gridNo: number): void {
    if (!gridNoOnScreen(this.#restrictedScrollId, gridNo, { ...this.#viewport, camera: this.#camera }, this.#top > 0))
      this.centerOn(gridNo);
  }

  centerFromRadar(x: number, y: number): void {
    if (this.#scrollingIgnored) return;
    this.#camera = setRenderCenter(radarRenderCenter(this.#restrictedScrollId, x, y, this.#viewport), this.#viewport, this.#limits);
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
    const y = idiv(marker.gridNo, WORLD_COLS);
    const origin = worldOrigin(x, y);
    const offset = cameraOffset(this.#viewport, this.#camera, this.#renderHeight());
    const lift = (world.level.heights[marker.gridNo] ?? 0) + (ROOF_LAYERS.has(marker.layer) ? WALL_HEIGHT : 0);
    return {
      x: origin.x + offset.x + frame.offsetX + (marker.offsetX ?? 0),
      y: origin.y + offset.y - lift + frame.offsetY + (marker.offsetY ?? 0),
    };
  }

  #interactiveWorld(): InteractiveWorld | null {
    const shown = this.#renderer.shownWorld;
    if (!shown) return null;
    const world = this.#world.world;
    return {
      ...shown,
      tiles: world.tiles,
      surfaces: world.surfaces,
      structures: world.structures,
      itemsOnTop: this.#itemsOnTop(),
      basement: world.map.ambient?.basement === true,
    };
  }

  #itemsOnTop(): ReadonlySet<number> {
    const items = this.#sources.view()?.items ?? [];
    return new Set(items.filter((i) => i.level === GROUND_LEVEL && (i.height ?? 0) > 0).map((i) => i.gridNo));
  }

  interactiveNodesAt(x: number, y: number): readonly InteractiveNode[] {
    const w = this.#interactiveWorld();
    if (!w) return [];
    const screen = {
      viewport: this.#viewport,
      camera: this.#camera,
      renderHeight: this.#renderHeight(),
      animationStep: Math.floor(this.#sources.clockMs() / ANIMATED_TILE_FRAME_MS),
    };
    return interactiveNodesAt(w, screen, x, y);
  }

  interactiveTile(node: InteractiveNodeRef): InteractiveTile | null {
    const w = this.#interactiveWorld();
    return w ? interactiveTileOf(w, node) : null;
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

  slideView(gridNo: number): SlideView {
    return slideView(this.#restrictedScrollId, gridNo, { ...this.#viewport, camera: this.#camera }, this.#top > 0);
  }

  scrollBy(dx: number, dy: number): boolean {
    if (this.#scrollingIgnored) return false;
    const next = this.#moved(dx, dy);
    if (next.centerX === this.#camera.centerX && next.centerY === this.#camera.centerY) return false;
    this.#camera = next;
    return true;
  }

  setOverheadTiles(loader: () => Promise<OverheadTiles>): void {
    this.#overheadTilesLoader = loader;
  }

  redrawOverheadMap(): void {
    this.#overheadDirty = true;
    this.#loadOverheadTiles();
  }

  overheadMap(): OverheadMapView | null {
    if (this.#overheadDirty) this.#composeOverheadMap();
    return this.#overhead;
  }

  #loadOverheadTiles(): void {
    const loader = this.#overheadTilesLoader;
    if (this.#overheadTiles || this.#overheadTilesLoading || !loader) return;
    this.#overheadTilesLoading = true;
    void loader()
      .then((tiles) => {
        this.#overheadTiles = tiles;
      })
      .catch(() => undefined);
  }

  #composeOverheadMap(): void {
    const tiles = this.#overheadTiles;
    const shown = this.#renderer.shownWorld;
    const shade = this.#world.shade;
    if (!tiles || !shown || !shade) return;
    const world = this.#world.world;
    const previous = this.#overhead?.key ?? null;
    const key = `${OVERHEAD_PICTURE_PREFIX}${world.mapPath}:${++this.#overheadPictures}`;
    this.#overhead = OverheadPicture.compose(
      key,
      world,
      tiles,
      { ...shown, shade },
      { addRgb: (k, width, height, pixels) => this.#assets.addRgb(k, { kind: 'rgb', width, height, flags: 0, pixels }) },
    );
    if (previous !== null) this.#assets.remove(previous);
    this.#overheadDirty = false;
  }

  tileImage(name: string): UiImageRef | null {
    const tile = this.#namedTile(name);
    return tile === null ? null : this.#tilePicture(tile);
  }

  tileCentre(gridNo: number): ScreenPoint {
    const c = mapCenter(this.#viewport);
    const dx = (gridNo % WORLD_COLS) * CELL_SIZE + HALF_CELL - this.#camera.centerX;
    const dy = idiv(gridNo, WORLD_COLS) * CELL_SIZE + HALF_CELL - this.#camera.centerY;
    const land = this.#world.world.level.heights[gridNo] ?? 0;
    return { x: c.x + 2 * dx - 2 * dy, y: c.y + dx + dy - land + this.#renderHeight() };
  }

  render(): number | null {
    const view = this.#sources.view();
    if (!view) return null;
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
        openContainers: view.openContainers ?? [],
        revealedRooms: view.revealedRooms ?? [],
        slantRoofCeilings: view.slantRoofCeilings ?? [],
        clock: view.clock ?? null,
        combat: view.combat ?? null,
        corpses: view.corpses ?? [],
        smoke: view.smoke ?? [],
        light: view.light ?? null,
        tileChanges: view.tileChanges ?? [],
        blood: view.blood ?? [],
        helicopterDrop: view.helicopterDrop ?? null,
      },
      hovered: this.#hovered,
      selected: this.#selected,
      uiNodes: this.#uiNodes(),
      bullets: this.#sources.bullets(),
      shownTick: this.#sources.shownTick(),
    });
    return this.#renderer.picture;
  }

  present(target: WebGLFramebuffer, logicalHeight: number): void {
    this.#renderer.present(target, logicalHeight, 0, 0, 1);
  }
}

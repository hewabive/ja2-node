import { AnimFlags, stateId } from '../../content/anim/tables.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import type {
  BloodPoolView,
  BulletView,
  ClockView,
  CombatView,
  CorpseView,
  ItemView,
  SmokeTileView,
  SoldierView,
  TileChangeView,
  WorldLightView,
} from '../../protocol/view.ts';
import type { SceneAniTile, SceneItem, SoldierSprite, WorldUiNode } from '../../render/world/dynamic-scene.ts';
import type { Camera, Viewport } from '../../render/world/geometry.ts';
import type { ShadeField, WorldDisplayOptions, WorldDrawStats, WorldRenderer } from '../../render/world/world-renderer.ts';
import type { EffectEvent } from '../../sim/events.ts';
import { onTheMap } from '../../ui/screens/tactical/soldiers.ts';
import type { ReadVfsFile } from '../net/vfs.ts';
import { type BulletTiles, bulletNodes, bulletTiles, thrownNodes } from './bullet-nodes.ts';
import { CrowShadows } from './crow-shadows.ts';
import {
  EffectAnimations,
  type EffectFrame,
  type EffectKind,
  effectStructNodes,
  effectTileFrames,
  isCachedEffect,
} from './effect-animations.ts';
import { glowContext } from './glow-context.ts';
import { type ItemTileLookup, itemTileLookup, readItemGraphicTables } from './item-tiles.ts';
import { LightTemplates, mercLightTemplateName } from './light-templates.ts';
import { ROOF_MARKER_TILE, RoofMarkers, type SoldierOrigin } from './roof-markers.ts';
import type { SoldierAssets } from './soldier-assets.ts';
import type { BoundingBox } from './soldier-bounding-boxes.ts';
import type { SoldierFrames } from './soldier-frames.ts';
import { defaultHostile, nightTime, type SoldierLightOptions, SoldierScene } from './soldier-scene.ts';
import type { WorldEffects } from './world-effects.ts';
import { type DynamicLight, type LightingTime, type MapLight, WorldLighting } from './world-lighting.ts';
import { type LoadedWorld, loadWorld, renderWorldOf } from './world-loader.ts';

const SANDBOX_TIME: LightingTime = { hour: 12, minute: 0 };
const CROW_FLY = 'CROW_FLY';
const CLIMB_UP_ROOF = 'CLIMBUPROOF';
const NO_CORPSES: readonly CorpseView[] = [];
const NO_SMOKE: readonly SmokeTileView[] = [];
const NO_TILE_CHANGES: readonly TileChangeView[] = [];
const NO_BLOOD: readonly BloodPoolView[] = [];
const NO_CEILINGS: readonly number[] = [];
const NO_BULLETS: readonly BulletView[] = [];

export interface TacticalViewState {
  readonly tick: number;
  readonly soldiers: readonly SoldierView[];
  readonly items: readonly ItemView[];
  readonly openDoors: readonly number[];
  readonly openContainers?: readonly number[];
  readonly revealedRooms: readonly number[];
  readonly slantRoofCeilings?: readonly number[];
  readonly clock: ClockView | null;
  readonly combat: CombatView | null;
  readonly corpses?: readonly CorpseView[];
  readonly smoke?: readonly SmokeTileView[];
  readonly light?: WorldLightView | null;
  readonly tileChanges?: readonly TileChangeView[];
  readonly blood?: readonly BloodPoolView[];
}

export interface EffectOptions {
  readonly bloodAndGore: boolean;
  readonly animateSmoke: boolean;
  readonly hideBullets: boolean;
}

export type TacticalDisplayOptions = WorldDisplayOptions & SoldierLightOptions & EffectOptions;

export const DEFAULT_TACTICAL_OPTIONS: TacticalDisplayOptions = {
  roofs: true,
  shadows: true,
  treeTops: true,
  wireframes: true,
  glowItems: true,
  redItemGlow: false,
  mercCastsLight: true,
  mercAlwaysLit: false,
  bloodAndGore: true,
  animateSmoke: true,
  hideBullets: false,
};

export interface TacticalFrame {
  readonly viewport: Viewport;
  readonly camera: Camera;
  readonly clockMs: number;
  readonly roofLevel: boolean;
  readonly options: TacticalDisplayOptions;
  readonly view: TacticalViewState;
  readonly hovered: number | null;
  readonly selected?: number | null;
  readonly uiNodes: readonly WorldUiNode[];
  readonly bullets?: readonly BulletView[];
  readonly shownTick?: number;
  readonly time?: LightingTime;
  readonly hostile?: (s: SoldierView) => boolean;
}

export interface TacticalPresentation {
  readonly soldiers: SoldierScene;
  readonly frames?: SoldierFrames | null;
  readonly effects?: WorldEffects | null;
  readonly lightTemplates?: LightTemplates;
}

export interface PreparedWorld {
  readonly world: LoadedWorld;
  readonly itemTiles: ItemTileLookup;
}

export class TacticalWorldView {
  readonly world: LoadedWorld;
  readonly lighting: WorldLighting;
  readonly #renderer: WorldRenderer;
  readonly #soldiers: SoldierScene;
  readonly #frames: SoldierFrames | null;
  readonly #effects: WorldEffects | null;
  readonly #templates: LightTemplates;
  readonly #itemTiles: ItemTileLookup;
  readonly #roofed: Uint8Array;
  readonly #bulletTiles: BulletTiles | null;
  readonly #effectAnimations = new EffectAnimations();
  readonly #crowShadows: CrowShadows;
  readonly #roofMarkers: RoofMarkers;
  readonly #roofMarkerTile: number | null;
  #drawnEffects = 0;
  #drawnBullets = 0;
  #drawnImpacts = 0;
  #shade: ShadeField | null = null;

  private constructor(world: LoadedWorld, renderer: WorldRenderer, presentation: TacticalPresentation, itemTiles: ItemTileLookup) {
    this.world = world;
    this.lighting = new WorldLighting(world.tactical);
    this.#renderer = renderer;
    this.#soldiers = presentation.soldiers;
    this.#frames = presentation.frames ?? null;
    this.#effects = presentation.effects ?? null;
    const animations = presentation.soldiers.assets.tables;
    this.#crowShadows = new CrowShadows(stateId(animations, CROW_FLY));
    this.#templates = presentation.lightTemplates ?? new LightTemplates();
    this.#itemTiles = itemTiles;
    this.#roofed = Uint8Array.from({ length: world.level.heights.length }, (_, g) =>
      levelTilesAt(world.level.layers.roofs, g).length > 0 ? 1 : 0,
    );
    this.#roofMarkers = new RoofMarkers({
      climbUpRoof: stateId(animations, CLIMB_UP_ROOF),
      stationary: (animation) => ((animations.controls[animation]?.flags ?? 0) & AnimFlags.STATIONARY) !== 0,
      hasRoof: (g) => this.#roofed[g] === 1,
    });
    this.#roofMarkerTile = world.tables.tileIndexByName.get(ROOF_MARKER_TILE) ?? null;
    this.#bulletTiles = bulletTiles(world.tables);
    const sprites = renderer.setWorld(renderWorldOf(world));
    this.#soldiers.setSprites(sprites);
    this.#effects?.setSprites(sprites);
  }

  static async load(
    renderer: WorldRenderer,
    mapPath: string,
    available: ReadonlySet<string>,
    presentation: TacticalPresentation,
    read?: ReadVfsFile,
  ): Promise<TacticalWorldView> {
    return TacticalWorldView.create(renderer, await TacticalWorldView.prepare(mapPath, available, read), presentation);
  }

  static async prepare(mapPath: string, available: ReadonlySet<string>, read?: ReadVfsFile): Promise<PreparedWorld> {
    const [world, itemGraphics] = await Promise.all([loadWorld(mapPath, available, read), readItemGraphicTables(read)]);
    return { world, itemTiles: itemTileLookup(world.tables, itemGraphics) };
  }

  static create(renderer: WorldRenderer, prepared: PreparedWorld, presentation: TacticalPresentation): TacticalWorldView {
    return new TacticalWorldView(prepared.world, renderer, presentation, prepared.itemTiles);
  }

  static soldierScene(assets: SoldierAssets): SoldierScene {
    return new SoldierScene(assets);
  }

  get drawnSoldiers(): number {
    return this.#soldiers.drawn;
  }

  get drawnEffects(): number {
    return this.#drawnEffects;
  }

  get drawnBullets(): number {
    return this.#drawnBullets;
  }

  get drawnImpacts(): number {
    return this.#drawnImpacts;
  }

  get shade(): ShadeField | null {
    return this.#shade;
  }

  soldierSprite(id: number): SoldierSprite | null {
    return this.#soldiers.shownSprite(id);
  }

  soldierBoundingBox(id: number): BoundingBox | null {
    return this.#soldiers.shownBoundingBox(id);
  }

  get lightTemplates(): LightTemplates {
    return this.#templates;
  }

  #items(items: readonly ItemView[]): SceneItem[] {
    return items.flatMap((i) => {
      const tile = i.notRendered ? null : this.#itemTiles(i.item);
      return tile === null ? [] : [{ gridNo: i.gridNo, level: i.level, tile, height: i.height ?? 0 }];
    });
  }

  #mapLights(light: WorldLightView | null | undefined): MapLight[] | null {
    if (!light) return null;
    return light.sprites.flatMap((sprite) => {
      if (sprite.dynamic) return [];
      const resolved = this.#templates.resolve(sprite.template);
      return resolved ? [{ x: sprite.x, y: sprite.y, roof: sprite.roof === true, template: resolved.template }] : [];
    });
  }

  #dynamicLights(light: WorldLightView | null | undefined): DynamicLight[] {
    return (light?.sprites ?? []).flatMap((sprite) => {
      if (!sprite.dynamic) return [];
      const resolved = this.#templates.resolve(sprite.template);
      return resolved ? [{ x: sprite.x, y: sprite.y, template: resolved.template }] : [];
    });
  }

  #bulletNodes(bullets: readonly BulletView[]) {
    const tiles = this.#bulletTiles;
    return tiles ? bulletNodes(bullets, tiles, this.world.level.heights) : [];
  }

  #thrownNodes(bullets: readonly BulletView[]) {
    return bullets.flatMap((b) => {
      const tile = b.item === undefined ? null : this.#itemTiles(b.item);
      return tile === null ? [] : thrownNodes(b, tile, this.world.level.heights);
    });
  }

  #frameOf(tick: number): (s: SoldierView) => number {
    const frames = this.#frames;
    return frames ? (s) => frames.frameOf(s.id, s, tick) : (s) => s.frame;
  }

  #firstFrameOf(): (s: SoldierView) => number {
    const frames = this.#frames;
    return frames ? (s) => frames.firstFrame(s.animation) : (s) => s.frame;
  }

  observeEffects(effects: readonly EffectEvent[]): void {
    this.#effectAnimations.observe(effects);
  }

  resetEffects(soldiers: SoldierOrigin): void {
    this.#effectAnimations.reset();
    this.#roofMarkers.reset(soldiers);
  }

  #roofMarkerNodes(soldiers: readonly SoldierView[]): WorldUiNode[] {
    const gridNos = this.#roofMarkers.update(soldiers);
    const tile = this.#roofMarkerTile;
    return tile === null ? [] : gridNos.map((gridNo) => ({ gridNo, layer: 'roof', tile }));
  }

  #effectFrameCount(kind: EffectKind, tile: string | null): number | null {
    if (isCachedEffect(kind)) return this.#effects?.cachedEffectFrames({ kind, tile }) ?? null;
    return effectTileFrames(kind, tile, this.world.tables, this.world.tiles)?.length ?? null;
  }

  #shownEffects(tick: number): EffectFrame[] {
    return this.#effectAnimations.at(Math.floor(tick), (kind, tile) => this.#effectFrameCount(kind, tile));
  }

  #knifeTiles(bullets: readonly BulletView[], tick: number): SceneAniTile[] {
    const effects = this.#effects;
    if (!effects) return [];
    return bullets.flatMap((b) => (b.knife ? effects.knife({ ...b, knife: b.knife }, tick, this.world.level.heights) : []));
  }

  #crowShadowTiles(soldiers: readonly SoldierView[], clockMs: number): SceneAniTile[] {
    const effects = this.#effects;
    if (!effects) return [];
    return this.#crowShadows
      .update(soldiers, clockMs, () => effects.crowShadowFramesPerDirection())
      .flatMap((c) => {
        const tile = effects.crowShadow(c);
        return tile ? [tile] : [];
      });
  }

  #cachedEffectTiles(shown: readonly EffectFrame[]): SceneAniTile[] {
    const effects = this.#effects;
    if (!effects) return [];
    return shown.flatMap((e) => {
      const tile = isCachedEffect(e.kind) ? effects.cachedEffect(e) : null;
      return tile ? [tile] : [];
    });
  }

  render(f: TacticalFrame): WorldDrawStats {
    const view = f.view;
    const onMap = view.soldiers.filter(onTheMap);
    const time = f.time ?? (view.clock ? { hour: view.clock.hour, minute: view.clock.minute } : SANDBOX_TIME);
    const ambient = view.light?.ambient ?? null;
    const openDoors = new Set(view.openDoors);
    const shining = this.lighting.mercLightsShine(time, ambient);
    const mercLights = this.#soldiers.mercLights(
      { soldiers: onMap, lights: f.options },
      shining,
      nightTime(time.hour),
      (s) => this.#templates.resolve(mercLightTemplateName(s.inventory))?.template ?? null,
    );
    const shade = this.lighting.field({
      time,
      ambient,
      openDoors,
      mapLights: this.#mapLights(view.light),
      mercLights,
      dynamicLights: this.#dynamicLights(view.light),
      tileChanges: view.tileChanges ?? NO_TILE_CHANGES,
    });
    this.#shade = shade;
    const hostile = f.hostile ?? defaultHostile;
    const soldiers = this.#soldiers.build({
      soldiers: onMap,
      clockMs: f.clockMs,
      hour: time.hour,
      shade,
      hasRoof: (g) => this.#roofed[g] === 1,
      glow: glowContext({
        soldiers: onMap,
        combat: view.combat,
        clockMs: f.clockMs,
        hovered: f.hovered,
        selected: f.selected ?? null,
        hostile,
        ungreyed: (s) => this.#soldiers.ungreyed(s),
      }),
      hostile,
      lights: f.options,
      frameOf: this.#frameOf(view.tick),
      firstFrameOf: this.#firstFrameOf(),
    });
    this.#effects?.prepareCorpses(view.soldiers, f.options.bloodAndGore);
    const aniTiles =
      this.#effects?.build({
        corpses: view.corpses ?? NO_CORPSES,
        smoke: view.smoke ?? NO_SMOKE,
        clockMs: f.clockMs,
        bloodAndGore: f.options.bloodAndGore,
        animateSmoke: f.options.animateSmoke,
      }) ?? [];
    const shownTick = f.shownTick ?? view.tick;
    const effects = this.#shownEffects(shownTick);
    this.#drawnImpacts = effects.length;
    const bullets = f.options.hideBullets ? NO_BULLETS : (f.bullets ?? NO_BULLETS);
    this.#drawnBullets = bullets.length;
    const animatedTiles = [
      ...aniTiles,
      ...this.#crowShadowTiles(onMap, f.clockMs),
      ...this.#cachedEffectTiles(effects),
      ...this.#knifeTiles(bullets, Math.floor(shownTick)),
    ];
    this.#drawnEffects = animatedTiles.length;
    return this.#renderer.render({
      viewport: f.viewport,
      camera: f.camera,
      roofLevel: f.roofLevel,
      clockMs: f.clockMs,
      options: f.options,
      shade,
      openStructures: new Set([...view.openDoors, ...(view.openContainers ?? [])]),
      revealedRooms: new Set(view.revealedRooms),
      slantRoofCeilings: new Set(view.slantRoofCeilings ?? NO_CEILINGS),
      soldiers,
      items: this.#items(view.items),
      uiNodes: [...f.uiNodes, ...this.#roofMarkerNodes(onMap)],
      aniTiles: animatedTiles,
      structNodes: [
        ...effectStructNodes(effects, this.world.tables, this.world.tiles),
        ...this.#bulletNodes(bullets.filter((b) => !b.knife && b.item === undefined)),
        ...this.#thrownNodes(bullets),
      ],
      tileChanges: view.tileChanges ?? NO_TILE_CHANGES,
      bloodPools: view.blood ?? NO_BLOOD,
    });
  }
}

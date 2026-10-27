import { levelTilesAt } from '../../content/world/level.ts';
import type {
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
import type { SceneItem, WorldUiNode } from '../../render/world/dynamic-scene.ts';
import type { Camera, Viewport } from '../../render/world/geometry.ts';
import type { WorldDisplayOptions, WorldDrawStats, WorldRenderer } from '../../render/world/world-renderer.ts';
import type { EffectEvent, SimEvent } from '../../sim/events.ts';
import type { ReadVfsFile } from '../net/vfs.ts';
import { type BulletTiles, bulletNodes, bulletTiles } from './bullet-nodes.ts';
import { EffectAnimations, type EffectFrame, type EffectKind, effectStructNodes, effectTileFrames } from './effect-animations.ts';
import { glowContext } from './glow-context.ts';
import { type ItemTileLookup, itemTileLookup, readItemGraphicTables } from './item-tiles.ts';
import { LightTemplates, mercLightTemplateName } from './light-templates.ts';
import type { SoldierAssets } from './soldier-assets.ts';
import type { SoldierFrames } from './soldier-frames.ts';
import { defaultHostile, nightTime, type SoldierLightOptions, SoldierScene } from './soldier-scene.ts';
import type { WorldEffects } from './world-effects.ts';
import { type DynamicLight, type LightingTime, WorldLighting } from './world-lighting.ts';
import { type LoadedWorld, loadWorld, renderWorldOf } from './world-loader.ts';

const SANDBOX_TIME: LightingTime = { hour: 12, minute: 0 };
const NO_CORPSES: readonly CorpseView[] = [];
const NO_SMOKE: readonly SmokeTileView[] = [];
const NO_TILE_CHANGES: readonly TileChangeView[] = [];
const NO_BULLETS: readonly BulletView[] = [];

export interface TacticalViewState {
  readonly tick: number;
  readonly soldiers: readonly SoldierView[];
  readonly items: readonly ItemView[];
  readonly openDoors: readonly number[];
  readonly revealedRooms: readonly number[];
  readonly clock: ClockView | null;
  readonly combat: CombatView | null;
  readonly corpses?: readonly CorpseView[];
  readonly smoke?: readonly SmokeTileView[];
  readonly light?: WorldLightView | null;
  readonly tileChanges?: readonly TileChangeView[];
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
  readonly underAiControl?: (id: number) => boolean;
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
  #drawnEffects = 0;
  #drawnBullets = 0;
  #drawnImpacts = 0;

  private constructor(world: LoadedWorld, renderer: WorldRenderer, presentation: TacticalPresentation, itemTiles: ItemTileLookup) {
    this.world = world;
    this.lighting = new WorldLighting(world.tactical);
    this.#renderer = renderer;
    this.#soldiers = presentation.soldiers;
    this.#frames = presentation.frames ?? null;
    this.#effects = presentation.effects ?? null;
    this.#templates = presentation.lightTemplates ?? new LightTemplates();
    this.#itemTiles = itemTiles;
    this.#roofed = Uint8Array.from({ length: world.level.heights.length }, (_, g) =>
      levelTilesAt(world.level.layers.roofs, g).length > 0 ? 1 : 0,
    );
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

  get lightTemplates(): LightTemplates {
    return this.#templates;
  }

  #items(items: readonly ItemView[]): SceneItem[] {
    return items.flatMap((i) => {
      const tile = i.notRendered ? null : this.#itemTiles(i.item);
      return tile === null ? [] : [{ gridNo: i.gridNo, level: i.level, tile, height: i.height ?? 0 }];
    });
  }

  #dynamicLights(light: WorldLightView | null | undefined): DynamicLight[] {
    return (light?.sprites ?? []).flatMap((sprite) => {
      if (!sprite.dynamic) return [];
      const resolved = this.#templates.resolve(sprite.template);
      return resolved ? [{ x: sprite.x, y: sprite.y, template: resolved.template }] : [];
    });
  }

  #bulletNodes(bullets: readonly BulletView[], hidden: boolean) {
    const tiles = this.#bulletTiles;
    const drawn = tiles && !hidden ? bullets : NO_BULLETS;
    this.#drawnBullets = drawn.length;
    return tiles ? bulletNodes(drawn, tiles, this.world.level.heights) : [];
  }

  #frameOf(tick: number): (s: SoldierView) => number {
    const frames = this.#frames;
    return frames ? (s) => frames.frameOf(s.id, s, tick) : (s) => s.frame;
  }

  observe(events: readonly SimEvent[]): void {
    this.#soldiers.observe(events);
  }

  observeEffects(effects: readonly EffectEvent[]): void {
    this.#effectAnimations.observe(effects);
  }

  resetEffects(): void {
    this.#effectAnimations.reset();
  }

  #effectFrameCount(kind: EffectKind, tile: string | null): number | null {
    if (kind === 'miniboom') return this.#effects?.miniboomFrames() ?? null;
    return effectTileFrames(kind, tile, this.world.tables, this.world.tiles)?.length ?? null;
  }

  #shownEffects(tick: number): EffectFrame[] {
    return this.#effectAnimations.at(Math.floor(tick), (kind, tile) => this.#effectFrameCount(kind, tile));
  }

  #miniboomTiles(shown: readonly EffectFrame[]) {
    return shown.flatMap((e) => (e.kind === 'miniboom' ? [this.#effects?.miniboom(e) ?? null] : [])).filter((a) => a !== null);
  }

  render(f: TacticalFrame): WorldDrawStats {
    const view = f.view;
    const time = f.time ?? (view.clock ? { hour: view.clock.hour, minute: view.clock.minute } : SANDBOX_TIME);
    const ambient = view.light?.ambient ?? null;
    const openDoors = new Set(view.openDoors);
    const shining = this.lighting.mercLightsShine(time, ambient);
    const mercLights = this.#soldiers.mercLights(
      { soldiers: view.soldiers, lights: f.options },
      shining,
      nightTime(time.hour),
      (s) => this.#templates.resolve(mercLightTemplateName(s.inventory))?.template ?? null,
    );
    const shade = this.lighting.field({ time, ambient, openDoors, mercLights, dynamicLights: this.#dynamicLights(view.light) });
    const hostile = f.hostile ?? defaultHostile;
    const soldiers = this.#soldiers.build({
      soldiers: view.soldiers,
      clockMs: f.clockMs,
      hour: time.hour,
      shade,
      hasRoof: (g) => this.#roofed[g] === 1,
      glow: glowContext({
        soldiers: view.soldiers,
        combat: view.combat,
        clockMs: f.clockMs,
        hovered: f.hovered,
        selected: f.selected ?? null,
        hostile,
        ungreyed: (s) => this.#soldiers.ungreyed(s),
        underAiControl: f.underAiControl ?? (() => false),
      }),
      hostile,
      lights: f.options,
      frameOf: this.#frameOf(view.tick),
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
    const effects = this.#shownEffects(f.shownTick ?? view.tick);
    this.#drawnImpacts = effects.length;
    const animatedTiles = [...aniTiles, ...this.#miniboomTiles(effects)];
    this.#drawnEffects = animatedTiles.length;
    return this.#renderer.render({
      viewport: f.viewport,
      camera: f.camera,
      roofLevel: f.roofLevel,
      clockMs: f.clockMs,
      options: f.options,
      shade,
      openDoors,
      revealedRooms: new Set(view.revealedRooms),
      soldiers,
      items: this.#items(view.items),
      uiNodes: f.uiNodes,
      aniTiles: animatedTiles,
      structNodes: [
        ...effectStructNodes(effects, this.world.tables, this.world.tiles),
        ...this.#bulletNodes(f.bullets ?? NO_BULLETS, f.options.hideBullets),
      ],
      tileChanges: view.tileChanges ?? NO_TILE_CHANGES,
    });
  }
}

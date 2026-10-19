import { levelTilesAt } from '../../content/world/level.ts';
import type {
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
import type { ReadVfsFile } from '../net/vfs.ts';
import { glowContext } from './glow-context.ts';
import { type ItemTileLookup, loadItemTiles } from './item-tiles.ts';
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
  #drawnEffects = 0;

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
    const world = await loadWorld(mapPath, available, read);
    const itemTiles = await loadItemTiles(world.tables, read);
    return new TacticalWorldView(world, renderer, presentation, itemTiles);
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
      const resolved = this.#templates.resolve(sprite.template);
      return resolved ? [{ x: sprite.x, y: sprite.y, template: resolved.template }] : [];
    });
  }

  #frameOf(tick: number): (s: SoldierView) => number {
    const frames = this.#frames;
    return frames ? (s) => frames.frameOf(s.id, s, tick) : (s) => s.frame;
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
    const aniTiles =
      this.#effects?.build({
        corpses: view.corpses ?? NO_CORPSES,
        smoke: view.smoke ?? NO_SMOKE,
        clockMs: f.clockMs,
        bloodAndGore: f.options.bloodAndGore,
        animateSmoke: f.options.animateSmoke,
      }) ?? [];
    this.#drawnEffects = aniTiles.length;
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
      aniTiles,
      tileChanges: view.tileChanges ?? NO_TILE_CHANGES,
    });
  }
}

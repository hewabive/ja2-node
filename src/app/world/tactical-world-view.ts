import { levelTilesAt } from '../../content/world/level.ts';
import type { ClockView, CombatView, ItemView, SoldierView } from '../../protocol/view.ts';
import type { SceneItem, WorldUiNode } from '../../render/world/dynamic-scene.ts';
import type { Camera, Viewport } from '../../render/world/geometry.ts';
import { type GlowContext, glowFrame } from '../../render/world/glow.ts';
import type { WorldDisplayOptions, WorldDrawStats, WorldRenderer } from '../../render/world/world-renderer.ts';
import type { ReadVfsFile } from '../net/vfs.ts';
import { type ItemTileLookup, loadItemTiles } from './item-tiles.ts';
import type { SoldierAssets } from './soldier-assets.ts';
import { defaultHostile, nightTime, type SoldierLightOptions, SoldierScene } from './soldier-scene.ts';
import { type LightingTime, WorldLighting } from './world-lighting.ts';
import { type LoadedWorld, loadWorld, renderWorldOf } from './world-loader.ts';

const OUR_TEAM = 0;
const SANDBOX_TIME: LightingTime = { hour: 12, minute: 0 };

export interface TacticalViewState {
  readonly soldiers: readonly SoldierView[];
  readonly items: readonly ItemView[];
  readonly openDoors: readonly number[];
  readonly revealedRooms: readonly number[];
  readonly clock: ClockView | null;
  readonly combat: CombatView | null;
}

export type TacticalDisplayOptions = WorldDisplayOptions & SoldierLightOptions;

export const DEFAULT_TACTICAL_OPTIONS: TacticalDisplayOptions = {
  roofs: true,
  shadows: true,
  treeTops: true,
  wireframes: true,
  glowItems: true,
  redItemGlow: false,
  mercCastsLight: true,
  mercAlwaysLit: false,
};

export interface TacticalFrame {
  readonly viewport: Viewport;
  readonly camera: Camera;
  readonly clockMs: number;
  readonly roofLevel: boolean;
  readonly options: TacticalDisplayOptions;
  readonly view: TacticalViewState;
  readonly hovered: number | null;
  readonly uiNodes: readonly WorldUiNode[];
  readonly time?: LightingTime;
  readonly hostile?: (s: SoldierView) => boolean;
  readonly selectedSees?: (id: number) => boolean | null;
  readonly underAiControl?: (id: number) => boolean;
}

export class TacticalWorldView {
  readonly world: LoadedWorld;
  readonly lighting: WorldLighting;
  readonly #renderer: WorldRenderer;
  readonly #soldiers: SoldierScene;
  readonly #itemTiles: ItemTileLookup;
  readonly #roofed: Uint8Array;

  private constructor(world: LoadedWorld, renderer: WorldRenderer, soldiers: SoldierScene, itemTiles: ItemTileLookup) {
    this.world = world;
    this.lighting = new WorldLighting(world.tactical);
    this.#renderer = renderer;
    this.#soldiers = soldiers;
    this.#itemTiles = itemTiles;
    this.#roofed = Uint8Array.from({ length: world.level.heights.length }, (_, g) =>
      levelTilesAt(world.level.layers.roofs, g).length > 0 ? 1 : 0,
    );
    soldiers.setSprites(renderer.setWorld(renderWorldOf(world)));
  }

  static async load(
    renderer: WorldRenderer,
    mapPath: string,
    available: ReadonlySet<string>,
    soldiers: SoldierScene,
    read?: ReadVfsFile,
  ): Promise<TacticalWorldView> {
    const world = await loadWorld(mapPath, available, read);
    const itemTiles = await loadItemTiles(world.tables, read);
    return new TacticalWorldView(world, renderer, soldiers, itemTiles);
  }

  static soldierScene(assets: SoldierAssets): SoldierScene {
    return new SoldierScene(assets);
  }

  get drawnSoldiers(): number {
    return this.#soldiers.drawn;
  }

  #items(items: readonly ItemView[]): SceneItem[] {
    return items.flatMap((i) => {
      const tile = this.#itemTiles(i.item);
      return tile === null ? [] : [{ gridNo: i.gridNo, level: i.level, tile }];
    });
  }

  render(f: TacticalFrame): WorldDrawStats {
    const time = f.time ?? (f.view.clock ? { hour: f.view.clock.hour, minute: f.view.clock.minute } : SANDBOX_TIME);
    const openDoors = new Set(f.view.openDoors);
    const shining = this.lighting.mercLightsShine(time);
    const mercLights = this.#soldiers.mercLights({ soldiers: f.view.soldiers, lights: f.options }, shining, nightTime(time.hour));
    const shade = this.lighting.field({ time, openDoors, mercLights });
    const hostile = f.hostile ?? defaultHostile;
    const hoveredSoldier = f.hovered === null ? null : f.view.soldiers.find((s) => s.id === f.hovered);
    const glow: GlowContext = {
      ourTurn: !f.view.combat || f.view.combat.team === OUR_TEAM,
      frame: glowFrame(f.clockMs),
      hovered: f.hovered,
      hoveredHostile: !!hoveredSoldier && hostile(hoveredSoldier),
      selectedSees: f.selectedSees ?? (() => null),
      underAiControl: f.underAiControl ?? (() => false),
    };
    const soldiers = this.#soldiers.build({
      soldiers: f.view.soldiers,
      clockMs: f.clockMs,
      hour: time.hour,
      shade,
      hasRoof: (g) => this.#roofed[g] === 1,
      glow,
      hostile,
      lights: f.options,
    });
    return this.#renderer.render({
      viewport: f.viewport,
      camera: f.camera,
      roofLevel: f.roofLevel,
      clockMs: f.clockMs,
      options: f.options,
      shade,
      openDoors,
      revealedRooms: new Set(f.view.revealedRooms),
      soldiers,
      items: this.#items(f.view.items),
      uiNodes: f.uiNodes,
    });
  }
}

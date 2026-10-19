// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc EVENT_InternalSetSoldierPosition (merc node light), PositionSoldierLight,
// @src CreateSoldierLight; src/game/Tactical/Overhead.cc ExecuteOverhead (stationary light placement);
// @src src/game/Strategic/Game_Clock.cc NightTime; src/game/TileEngine/RenderWorld.cc RenderTiles (who glows: not
// @src bNeutral, not bSide FRIENDLY; grey when the selected merc does not see him, except while on fire or exploding).
// @src See docs/28 §6.5.

import { soldierSheetFrame } from '../../content/anim/soldier-sprite.ts';
import { stateId } from '../../content/anim/tables.ts';
import type { SoldierView } from '../../protocol/view.ts';
import type { SceneSoldier, SoldierSprite } from '../../render/world/dynamic-scene.ts';
import { type GlowContext, PERSONAL_LIGHT_SHADE, soldierLook } from '../../render/world/glow.ts';
import { SoldierFades } from '../../render/world/soldier-fade.ts';
import type { ShadeField } from '../../render/world/world-renderer.ts';
import type { WorldSprites } from '../../render/world/world-sprites.ts';
import { LightSpriteFlags, lightTimeAt } from '../../sim/tactical/lighting/lighting.ts';
import type { LightTemplate } from '../../sim/tactical/lighting/templates.ts';
import type { SoldierAssets } from './soldier-assets.ts';
import type { MercLight } from './world-lighting.ts';

const OUR_TEAM = 0;
const ENEMY_TEAM = 1;
const CREATURE_TEAM = 2;
const OKLIFE = 15;
const UNGREYED_STATES = ['CHARIOTS_OF_FIRE', 'BODYEXPLODING'];

export interface SoldierLightOptions {
  readonly mercCastsLight: boolean;
  readonly mercAlwaysLit: boolean;
}

export interface SoldierSceneInput {
  readonly soldiers: readonly SoldierView[];
  readonly clockMs: number;
  readonly hour: number;
  readonly shade: ShadeField;
  readonly hasRoof: (g: number) => boolean;
  readonly glow: GlowContext;
  readonly hostile?: (s: SoldierView) => boolean;
  readonly lights: SoldierLightOptions;
  readonly frameOf: (s: SoldierView) => number;
}

interface DrawnSprite {
  readonly sprite: SoldierSprite;
  readonly paletteBase: number;
}

export function defaultHostile(s: SoldierView): boolean {
  if (s.hostile !== undefined) return s.hostile;
  return s.team === ENEMY_TEAM || s.team === CREATURE_TEAM;
}

export function nightTime(hour: number): boolean {
  return (lightTimeAt(hour) & LightSpriteFlags.NIGHTTIME) !== 0;
}

export type MercLightTemplate = (s: SoldierView) => LightTemplate | null;

export class SoldierScene {
  readonly #assets: SoldierAssets;
  readonly #fades = new SoldierFades<SoldierView>();
  readonly #lastDrawn = new Map<number, DrawnSprite>();
  readonly #lastPosition = new Map<number, { readonly x: number; readonly y: number }>();
  readonly #stationary = new Map<number, { readonly x: number; readonly y: number }>();
  readonly #ungreyedStates: ReadonlySet<number>;
  #sprites: WorldSprites | null = null;
  #drawn = 0;

  constructor(assets: SoldierAssets) {
    this.#assets = assets;
    this.#ungreyedStates = new Set(UNGREYED_STATES.map((n) => stateId(assets.tables, n)));
  }

  get drawn(): number {
    return this.#drawn;
  }

  get assets(): SoldierAssets {
    return this.#assets;
  }

  setSprites(sprites: WorldSprites): void {
    this.#sprites = sprites;
    this.#lastDrawn.clear();
    this.#fades.reset();
  }

  ungreyed(s: SoldierView): boolean {
    return this.#ungreyedStates.has(s.animation);
  }

  #currentSprite(s: SoldierView, frame: number): DrawnSprite | null {
    const sprites = this.#sprites;
    if (!sprites) return null;
    const request = this.#assets.sheetFor(s);
    const standingRequest = this.#assets.standingSheetFor(s);
    const sheet = request ? this.#assets.ready(request) : null;
    const standing = standingRequest ? this.#assets.ready(standingRequest) : null;
    if (!request || !standingRequest || !sheet || !standing) return null;
    const loaded = sprites.addSheet(request.id, sheet.picture);
    const sprite = sprites.soldierFrame(loaded, soldierSheetFrame(sheet.layout, frame, s.direction));
    if (!sprite) return null;
    const key = `${standingRequest.id}|${s.palettes.join('|')}`;
    const paletteBase = sprites.soldierPaletteBase(key, () => this.#assets.paletteFor(s, standing));
    return { sprite, paletteBase };
  }

  mercLights(
    input: Pick<SoldierSceneInput, 'soldiers' | 'lights'>,
    shining: boolean,
    night: boolean,
    templateOf: MercLightTemplate,
  ): MercLight[] {
    for (const s of input.soldiers) {
      const last = this.#lastPosition.get(s.id);
      const moving = !!last && (last.x !== s.x || last.y !== s.y);
      if (!moving) this.#stationary.set(s.id, { x: s.x, y: s.y });
      this.#lastPosition.set(s.id, { x: s.x, y: s.y });
    }
    if (!input.lights.mercCastsLight || !shining || !night) return [];
    return input.soldiers.flatMap((s) => {
      if (s.team !== OUR_TEAM || (s.life ?? OKLIFE) < OKLIFE) return [];
      const template = templateOf(s);
      if (!template) return [];
      const at = input.lights.mercAlwaysLit ? s : (this.#stationary.get(s.id) ?? s);
      return [{ x: at.x, y: at.y, level: s.level, template }];
    });
  }

  #nodeShade(s: SoldierView, input: SoldierSceneInput, night: boolean): number {
    if (s.team === OUR_TEAM && !(input.lights.mercCastsLight && night)) return PERSONAL_LIGHT_SHADE;
    const roof = s.level > 0 && input.hasRoof(s.gridNo);
    return (roof ? input.shade.roof : input.shade.land)[s.gridNo] ?? input.shade.natural;
  }

  build(input: SoldierSceneInput): SceneSoldier[] {
    const night = nightTime(input.hour);
    const landShade = (g: number) => input.shade.land[g] ?? input.shade.natural;
    this.#fades.update(input.soldiers, input.clockMs, landShade);
    const hostile = input.hostile ?? defaultHostile;
    const out: SceneSoldier[] = [];
    let drawn = 0;
    const all = [...input.soldiers, ...this.#fades.fadingOut()];
    for (const s of all) {
      const current = this.#currentSprite(s, input.frameOf(s));
      const sprite = current ?? this.#lastDrawn.get(s.id) ?? null;
      if (!sprite) continue;
      this.#lastDrawn.set(s.id, sprite);
      if (input.soldiers.includes(s)) drawn++;
      const look = soldierLook(
        {
          id: s.id,
          level: s.level,
          hostile: hostile(s),
          nodeShade: this.#nodeShade(s, input, night),
          fadeShade: this.#fades.shade(s.id, input.clockMs, landShade),
        },
        input.glow,
      );
      out.push({
        id: s.id,
        gridNo: s.gridNo,
        x: s.x,
        y: s.y,
        level: s.level,
        sprite: sprite.sprite,
        paletteRow: sprite.paletteBase + look.row,
        topmost: look.topmost,
      });
    }
    this.#drawn = drawn;
    return out;
  }
}

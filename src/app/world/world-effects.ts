// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Rotting_Corpses.cc AddRottingCorpse (graphic, direction start frame, vehicle loop at 150 ms),
// @src CreateCorpsePalette, GetCorpseStructIndex; Tactical/Animation_Control.cc GetBodyTypePaletteSubstitution;
// @src src/game/TileEngine/SmokeEffects.cc AddSmokeEffectToTile (graphics by density, Random(5) start frame,
// @src 300 + Random(300) ms per frame, translucent; the static graphic when smoke is not animated);
// @src Tile_Animation.cc CreateAnimationTile, UpdateAniTiles (looping tiles restart at their direction's first frame);
// @src src/game/Tactical/Weapons.cc DoSpecialEffectAmmoMiss (the translucent miniboom of HE and HEAT rounds on the topmost
// @src layer, at the impact); src/game/Tactical/Bullets.cc AddMissileTrail (msle_smk, msle_sma or msle_spt, translucent, in
// @src the struct layer); src/game/TileEngine/Explosion_Control.cc GenerateExplosionFromExplosionPointer (the explosion's
// @src cached tile on the topmost layer, translucent in water and from its transparent key frame on); src/game/Tactical/Bullets.cc HandleBulletSpecialFlags, UpdateBullets (a thrown knife: the
// @src knifing.sti frames of its direction from the fourth, every 100 ms, and its shadow on the ground, both hanging on the
// @src thrower's tile). See docs/28 §12.1 G8.

import {
  CORPSES_TABLE_PATH,
  type CorpseTable,
  corpseStructIndex,
  parseCorpseTable,
  STUB_TILE_CACHE_DIR,
} from '../../content/anim/corpses.ts';
import { composeSoldierPalette } from '../../content/anim/soldier-sprite.ts';
import { parseColPalette } from '../../content/formats/col.ts';
import type { SoldierPalettes } from '../../content/formats/ja2pal.ts';
import { parseStructureFile, type StructureFile } from '../../content/formats/jsd.ts';
import { decodeSti } from '../../content/formats/sti.ts';
import {
  EXPLOSION_ANIMATIONS_PATH,
  type ExplosionAnimation,
  parseExplosionContent,
  SMOKE_EFFECTS_PATH,
} from '../../content/items/explosions.ts';
import { pictureFromSti } from '../../content/picture/from-sti.ts';
import type { IndexedPicture } from '../../content/picture/picture.ts';
import { zStripInfo } from '../../content/world/zstrip.ts';
import type { BulletView, CorpseView, KnifeFlight, SmokeTileView } from '../../protocol/view.ts';
import type { SceneAniTile } from '../../render/world/dynamic-scene.ts';
import type { LoadedSoldierSheet, WorldSprites } from '../../render/world/world-sprites.ts';
import { bulletGridNo } from './bullet-nodes.ts';
import { type EffectFrame, knifeFrame } from './effect-animations.ts';

export type EffectSprites = Pick<WorldSprites, 'addSheet' | 'soldierFrame' | 'shadedPaletteBase' | 'plainPaletteRow'>;

import type { ReadVfsFile } from '../net/vfs.ts';

const TILE_CACHE_DIR = 'tilecache/';
const MINIBOOM_PATH = 'tilecache/miniboom.sti';
const TRAIL_PATHS: Readonly<Record<string, string>> = {
  smoke: 'tilecache/msle_smk.sti',
  small: 'tilecache/msle_sma.sti',
  spit: 'tilecache/msle_spt.sti',
};
const KNIFE_PATH = 'tilecache/knifing.sti';
const STUB_PREFIX = 'stubs/';
const CAMO_PALETTE = 'anims/camo.col';
const ROTTING_STAGE2 = 'ROTTING_STAGE2';
const VEHICLE_CORPSE_FRAME_MS = 150;
const SMOKE_START_FRAMES = 5;
const SMOKE_MIN_DELAY_MS = 300;
const SMOKE_DELAY_RANGE_MS = 300;
const DIRECTIONS = 8;
const FIRST_VEHICLE_BODY = 22;
const FOUR_DIRECTION_TYPES = ['SMERC_FALL', 'SMERC_FALLF', 'MMERC_FALL', 'MMERC_FALLF', 'FMERC_FALL', 'FMERC_FALLF'];
const MONSTER_PALETTES: Readonly<Record<number, string>> = {
  4: 'anims/monsters/femmon.col',
  5: 'anims/monsters/monster.col',
  6: 'anims/monsters/fm_brite.col',
  7: 'anims/monsters/mn_brite.col',
};
const OWN_PALETTE_BODIES: ReadonlySet<number> = new Set([10, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);

interface SmokeGraphics {
  readonly name: string;
  readonly graphics: string;
  readonly dissipatingGraphics: string;
  readonly staticGraphics: string;
}

class AsyncCache<T> {
  readonly #values = new Map<string, T | null>();
  readonly #pending = new Map<string, Promise<void>>();

  get(path: string, available: ReadonlySet<string>, read: ReadVfsFile, decode: (bytes: Uint8Array) => T): T | null | undefined {
    if (this.#values.has(path)) return this.#values.get(path);
    if (!available.has(path)) {
      this.#values.set(path, null);
      return null;
    }
    if (!this.#pending.has(path)) {
      const loading = read(path)
        .then((bytes) => {
          this.#values.set(path, decode(bytes));
        })
        .catch(() => {
          this.#values.set(path, null);
        })
        .finally(() => this.#pending.delete(path));
      this.#pending.set(path, loading);
    }
    return undefined;
  }

  async settled(): Promise<void> {
    await Promise.all(this.#pending.values());
  }
}

interface EffectPicture {
  readonly picture: IndexedPicture;
  readonly framesPerDirection: number;
}

export interface WorldEffectsInput {
  readonly corpses: readonly CorpseView[];
  readonly smoke: readonly SmokeTileView[];
  readonly clockMs: number;
  readonly bloodAndGore: boolean;
  readonly animateSmoke: boolean;
}

function parseSmokeGraphics(json: unknown): SmokeGraphics[] {
  return (Array.isArray(json) ? json : []).flatMap((e: unknown) => {
    const g = e as Partial<SmokeGraphics>;
    return typeof g.name === 'string' && typeof g.graphics === 'string'
      ? [
          {
            name: g.name,
            graphics: g.graphics,
            dissipatingGraphics: g.dissipatingGraphics ?? g.graphics,
            staticGraphics: g.staticGraphics ?? g.graphics,
          },
        ]
      : [];
  });
}

function fileBase(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? name : name.slice(0, dot);
}

function tileHash(gridNo: number, level: number, salt: number): number {
  let h = (gridNo * 73856093) ^ (level * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

export class WorldEffects {
  readonly #read: ReadVfsFile;
  readonly #available: ReadonlySet<string>;
  readonly #corpses: CorpseTable;
  readonly #smoke: ReadonlyMap<string, SmokeGraphics>;
  readonly #soldierPalettes: SoldierPalettes | null;
  readonly #explosions: ReadonlyMap<string, ExplosionAnimation>;
  readonly #waterExplosions: ReadonlySet<string>;
  readonly #pictures = new AsyncCache<EffectPicture>();
  readonly #palettes = new AsyncCache<Uint8Array>();
  readonly #structures = new AsyncCache<StructureFile>();
  readonly #smokeSince = new Map<string, number>();
  readonly #preparedBodies = new Set<number>();
  #sprites: EffectSprites | null = null;

  private constructor(
    read: ReadVfsFile,
    available: ReadonlySet<string>,
    corpses: CorpseTable,
    smoke: readonly SmokeGraphics[],
    soldierPalettes: SoldierPalettes | null,
    explosions: ReadonlyMap<string, ExplosionAnimation>,
  ) {
    this.#read = read;
    this.#available = available;
    this.#corpses = corpses;
    this.#smoke = new Map(smoke.map((s) => [s.name, s]));
    this.#soldierPalettes = soldierPalettes;
    this.#explosions = explosions;
    this.#waterExplosions = new Set([...explosions.values()].flatMap((a) => (a.waterAnimation ? [a.waterAnimation] : [])));
  }

  static async load(read: ReadVfsFile, available: ReadonlySet<string>, soldierPalettes: SoldierPalettes | null): Promise<WorldEffects> {
    const json = async (path: string) => JSON.parse(new TextDecoder().decode(await read(path)));
    const [corpses, smoke, explosions] = await Promise.all([
      json(CORPSES_TABLE_PATH),
      json(SMOKE_EFFECTS_PATH),
      json(EXPLOSION_ANIMATIONS_PATH),
    ]);
    const animations = parseExplosionContent(explosions, smoke).animations;
    return new WorldEffects(read, available, parseCorpseTable(corpses), parseSmokeGraphics(smoke), soldierPalettes, animations);
  }

  setSprites(sprites: EffectSprites | null): void {
    this.#sprites = sprites;
    this.#smokeSince.clear();
  }

  prepareCorpses(soldiers: readonly { readonly bodyType: number }[], bloodAndGore: boolean): void {
    for (const s of soldiers) {
      const key = s.bodyType * 2 + (bloodAndGore ? 1 : 0);
      if (this.#preparedBodies.has(key)) continue;
      this.#preparedBodies.add(key);
      this.#colPalette(CAMO_PALETTE);
      const monster = MONSTER_PALETTES[s.bodyType];
      if (monster) this.#colPalette(monster);
      const types = new Set(Object.values(this.#corpses.animationCorpse[String(s.bodyType)] ?? {}));
      for (const type of types) this.#prepareCorpseGraphic(type, bloodAndGore);
    }
  }

  async loaded(): Promise<void> {
    await Promise.all([this.#pictures.settled(), this.#palettes.settled(), this.#structures.settled()]);
  }

  #prepareCorpseGraphic(type: number, bloodAndGore: boolean): void {
    const path = (bloodAndGore ? this.#corpses.files : this.#corpses.noBloodFiles)[type];
    if (!path) return;
    this.#picture(path);
    this.#structureFile(fileBase(path));
  }

  #resolve(path: string): string {
    return this.#available.has(path) ? path : `${STUB_PREFIX}${path}`;
  }

  #picture(path: string): EffectPicture | null | undefined {
    return this.#pictures.get(this.#resolve(path), this.#available, this.#read, (bytes) => {
      const sti = decodeSti(bytes);
      const picture = pictureFromSti(sti);
      if (picture.kind !== 'indexed' || sti.kind !== 'indexed') throw new Error(`${path} is not indexed`);
      return { picture, framesPerDirection: sti.appData?.[0]?.numberOfFrames || 1 };
    });
  }

  #colPalette(path: string): Uint8Array | null | undefined {
    return this.#palettes.get(this.#resolve(path), this.#available, this.#read, parseColPalette);
  }

  #structureFile(base: string): StructureFile | null | undefined {
    const path = [`${TILE_CACHE_DIR}${base}.jsd`, `${STUB_TILE_CACHE_DIR}${base}.jsd`].find((p) => this.#available.has(p));
    return path ? this.#structures.get(path, this.#available, this.#read, parseStructureFile) : null;
  }

  #sheet(path: string, picture: IndexedPicture): LoadedSoldierSheet | null {
    return this.#sprites?.addSheet(path, picture) ?? null;
  }

  #corpsePalette(c: CorpseView, picture: IndexedPicture): { key: string; palette: Uint8Array } | null {
    if (this.#corpses.types[c.type] === ROTTING_STAGE2) return { key: 'own', palette: picture.palette };
    if (c.camo) {
      const camo = this.#colPalette(CAMO_PALETTE);
      return camo === undefined ? null : { key: 'camo', palette: camo ?? picture.palette };
    }
    const monster = MONSTER_PALETTES[c.bodyType];
    if (monster) {
      const col = this.#colPalette(monster);
      return col === undefined ? null : { key: monster, palette: col ?? picture.palette };
    }
    if (OWN_PALETTE_BODIES.has(c.bodyType) || !c.palettes || !this.#soldierPalettes) return { key: 'own', palette: picture.palette };
    const [hair, skin, vest, pants] = c.palettes;
    return {
      key: c.palettes.join('|'),
      palette: composeSoldierPalette(picture.palette, this.#soldierPalettes, { hair, skin, vest, pants }),
    };
  }

  #corpseFrame(c: CorpseView, framesPerDirection: number, clockMs: number): number {
    const name = this.#corpses.types[c.type] ?? '';
    const block = FOUR_DIRECTION_TYPES.includes(name)
      ? (this.#corpses.fourDirectionsFrom8[c.direction] ?? 0)
      : (c.direction + 1) % DIRECTIONS;
    const start = framesPerDirection * block;
    if (c.bodyType < FIRST_VEHICLE_BODY) return start;
    return start + (Math.floor(clockMs / VEHICLE_CORPSE_FRAME_MS) % framesPerDirection);
  }

  #corpse(c: CorpseView, input: WorldEffectsInput): SceneAniTile | null {
    const sprites = this.#sprites;
    const path = (input.bloodAndGore ? this.#corpses.files : this.#corpses.noBloodFiles)[c.type];
    if (!sprites || !path) return null;
    const loaded = this.#picture(path);
    if (!loaded) return null;
    const palette = this.#corpsePalette(c, loaded.picture);
    const sheet = palette ? this.#sheet(path, loaded.picture) : null;
    if (!palette || !sheet) return null;
    const index = this.#corpseFrame(c, loaded.framesPerDirection, input.clockMs);
    const sprite = sprites.soldierFrame(sheet, index);
    const frame = loaded.picture.frames[index];
    if (!sprite || !frame) return null;
    const structures = this.#structureFile(fileBase(path));
    const def = structures?.structures[corpseStructIndex(this.#corpses, c.type, c.direction)] ?? null;
    const vehicle = c.bodyType >= FIRST_VEHICLE_BODY;
    return {
      kind: vehicle ? 'vehicleCorpse' : 'corpse',
      gridNo: c.gridNo,
      level: c.level,
      sprite,
      paletteRow: sprites.shadedPaletteBase(`corpse|${path}|${palette.key}`, () => palette.palette),
      shaded: true,
      zStrip: def ? zStripInfo({ offsetX: frame.offsetX, offsetY: frame.offsetY, width: frame.width }, def) : null,
      zTileOffsetX: def?.zTileOffsetX ?? 0,
      zTileOffsetY: def?.zTileOffsetY ?? 0,
    };
  }

  #smokeTile(s: SmokeTileView, input: WorldEffectsInput): SceneAniTile | null {
    const sprites = this.#sprites;
    const graphics = this.#smoke.get(s.effect);
    if (!sprites || !graphics) return null;
    const path = input.animateSmoke ? (s.dissipating ? graphics.dissipatingGraphics : graphics.graphics) : graphics.staticGraphics;
    const loaded = this.#picture(path);
    if (!loaded) return null;
    const sheet = this.#sheet(path, loaded.picture);
    if (!sheet) return null;
    const key = `${s.gridNo}|${s.level}|${path}`;
    const since = this.#smokeSince.get(key) ?? input.clockMs;
    this.#smokeSince.set(key, since);
    const frames = Math.max(1, loaded.framesPerDirection);
    const hash = tileHash(s.gridNo, s.level, path.length);
    const delay = SMOKE_MIN_DELAY_MS + (hash % SMOKE_DELAY_RANGE_MS);
    const start = Math.floor(hash / SMOKE_DELAY_RANGE_MS) % SMOKE_START_FRAMES;
    const index = input.animateSmoke ? (start + Math.floor((input.clockMs - since) / delay)) % frames : 0;
    const sprite = sprites.soldierFrame(sheet, index);
    if (!sprite) return null;
    return {
      kind: input.animateSmoke ? 'smoke' : 'staticSmoke',
      gridNo: s.gridNo,
      level: s.level,
      sprite,
      paletteRow: sprites.plainPaletteRow(`smoke|${path}`, () => loaded.picture.palette),
      shaded: false,
      zStrip: null,
      zTileOffsetX: 0,
      zTileOffsetY: 0,
    };
  }

  #cachedEffectPath(e: Pick<EffectFrame, 'kind' | 'tile'>): string | null {
    if (e.kind === 'miniboom') return MINIBOOM_PATH;
    if (e.kind === 'explosion') return this.#explosions.get(e.tile ?? '')?.graphics || null;
    return e.kind === 'trail' ? (TRAIL_PATHS[e.tile ?? ''] ?? null) : null;
  }

  #translucent(e: EffectFrame): boolean {
    if (e.kind !== 'explosion') return e.kind === 'miniboom' || e.kind === 'trail';
    const name = e.tile ?? '';
    const keyframe = this.#explosions.get(name)?.transparentKeyframe ?? 0;
    return this.#waterExplosions.has(name) || (keyframe > 0 && e.frame >= keyframe);
  }

  cachedEffectFrames(e: Pick<EffectFrame, 'kind' | 'tile'>): number | null {
    const path = this.#cachedEffectPath(e);
    return path ? (this.#picture(path)?.picture.frames.length ?? null) : null;
  }

  cachedEffect(e: EffectFrame): SceneAniTile | null {
    const sprites = this.#sprites;
    const path = this.#cachedEffectPath(e);
    const loaded = path ? this.#picture(path) : null;
    if (!sprites || !path || !loaded || (e.kind !== 'miniboom' && e.kind !== 'trail' && e.kind !== 'explosion')) return null;
    const sheet = this.#sheet(path, loaded.picture);
    const sprite = sheet ? sprites.soldierFrame(sheet, e.frame) : null;
    if (!sprite) return null;
    return {
      kind: e.kind,
      gridNo: e.gridNo,
      level: 0,
      at: { x: e.x, y: e.y, z: e.z },
      translucent: this.#translucent(e),
      sprite,
      paletteRow: sprites.plainPaletteRow(`effect|${path}`, () => loaded.picture.palette),
      shaded: false,
      zStrip: null,
      zTileOffsetX: 0,
      zTileOffsetY: 0,
    };
  }

  knife(b: BulletView & { readonly knife: KnifeFlight }, tick: number, landHeights: Uint8Array): SceneAniTile[] {
    const sprites = this.#sprites;
    const loaded = this.#picture(KNIFE_PATH);
    if (!sprites || !loaded) return [];
    const sheet = this.#sheet(KNIFE_PATH, loaded.picture);
    const frame = knifeFrame(b.knife.direction, Math.max(1, loaded.framesPerDirection), b.knife.since, tick);
    const sprite = sheet ? sprites.soldierFrame(sheet, frame) : null;
    if (!sprite) return [];
    const flying = {
      gridNo: b.knife.anchor,
      level: 0,
      sprite,
      paletteRow: sprites.plainPaletteRow(`effect|${KNIFE_PATH}`, () => loaded.picture.palette),
      shaded: false,
      zStrip: null,
      zTileOffsetX: 0,
      zTileOffsetY: 0,
    };
    const raised = b.z - (landHeights[bulletGridNo(b)] ?? 0);
    return [
      { ...flying, kind: 'knife', at: { x: b.x, y: b.y, z: raised } },
      { ...flying, kind: 'knifeShadow', at: { x: b.x, y: b.y, z: 0 } },
    ];
  }

  #forgetClearedSmoke(smoke: readonly SmokeTileView[]): void {
    if (this.#smokeSince.size <= smoke.length) return;
    const present = new Set(smoke.map((s) => `${s.gridNo}|${s.level}|`));
    for (const key of this.#smokeSince.keys()) if (!present.has(key.slice(0, key.lastIndexOf('|') + 1))) this.#smokeSince.delete(key);
  }

  build(input: WorldEffectsInput): SceneAniTile[] {
    this.#forgetClearedSmoke(input.smoke);
    const out: SceneAniTile[] = [];
    for (const c of input.corpses) {
      const tile = this.#corpse(c, input);
      if (tile) out.push(tile);
    }
    for (const s of input.smoke) {
      const tile = this.#smokeTile(s, input);
      if (tile) out.push(tile);
    }
    return out;
  }
}

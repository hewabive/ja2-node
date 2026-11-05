// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc CreateSoldierPalettes (the standing sheet with the replacements, a COL file
// @src or the sheet's own palette); Tactical/Animation_Data.cc LoadAnimationSurface (z strips from the surface's own
// @src structure type); TileEngine/WorldMan.cc AddMercStructureInfoFromAnimSurface and TileEngine/RenderWorld.cc (the
// @src structure of the facing, one for the queen).

import { substituteBodyTypeState } from '../../content/anim/body-substitution.ts';
import { bodyTypePaletteSubstitution, OWN_SHEET_PALETTE, reloadsPalette } from '../../content/anim/palette-substitution.ts';
import { composeSoldierPalette, facingOfDirection, type SheetFacing, type SheetLayout } from '../../content/anim/soldier-sprite.ts';
import { AnimStruct, type AnimStructures, animStructType, loadAnimStructures } from '../../content/anim/structures.ts';
import { chooseSurface, SubAnimFlags } from '../../content/anim/surface-choice.ts';
import {
  ANIM_CONTROL_PATH,
  ANIM_SURFACES_PATH,
  type AnimationTables,
  INVALID_SURFACE,
  parseAnimationTables,
  stateId,
} from '../../content/anim/tables.ts';
import { zStripSourceFrame } from '../../content/anim/zstrip-frames.ts';
import { parseColPalette } from '../../content/formats/col.ts';
import { parseSoldierPalettes, SOLDIER_PALETTES_PATH, type SoldierPalettes } from '../../content/formats/ja2pal.ts';
import type { StructureDef } from '../../content/formats/jsd.ts';
import { decodeSti } from '../../content/formats/sti.ts';
import type { HandClass } from '../../content/items/items.ts';
import { pictureFromSti } from '../../content/picture/from-sti.ts';
import type { IndexedPicture } from '../../content/picture/picture.ts';
import { parseStubSpriteManifest, pictureFromStubSprite } from '../../content/picture/stub-sprite.ts';
import { type ZStripInfo, zStripInfo } from '../../content/world/zstrip.ts';
import type { SoldierView } from '../../protocol/view.ts';
import { fetchVfsFile, type ReadVfsFile } from '../net/vfs.ts';

const QUEEN_BODY = 10;
const BIGMALE = 1;
const CIV_TEAM = 4;
const DIRECTIONS = 8;
const FULL_LIFE = 100;
const SOUTHWEST = 5;
const HAND_CLASSES: readonly string[] = ['nothing', 'pistol', 'rifle'] satisfies readonly HandClass[];
const PRELOADED_STATES = ['STANDING', 'WALKING', 'RUNNING'];

const STUB_PREFIX = 'stubs/';

export interface SoldierSheet {
  readonly picture: IndexedPicture;
  readonly layout: SheetLayout;
}
const STUB_SHEET_FRAMES_PER_DIRECTION = 18;

function stubKind(surfaceName: string): string {
  if (/PRONE|CRAWL/.test(surfaceName)) return 'prone';
  if (/CROUCH|SNEAK|SWAT|KNEEL|COWER/.test(surfaceName)) return 'crouch';
  if (/RUN/.test(surfaceName)) return 'run';
  if (/WALK/.test(surfaceName)) return 'walk';
  return 'stand';
}

export interface SheetRequest {
  readonly id: string;
  readonly surface: number;
}

export interface SoldierPalette {
  readonly key: string;
  readonly compose: () => Uint8Array;
}

export function sheetFacing(view: Pick<SoldierView, 'direction'>): SheetFacing {
  return facingOfDirection(view.direction);
}

export function zStripIndex(view: Pick<SoldierView, 'bodyType' | 'direction'>): number {
  return view.bodyType === QUEEN_BODY ? 0 : (view.direction + 1) % DIRECTIONS;
}

function handClassOf(hand: string): HandClass {
  return HAND_CLASSES.includes(hand) ? (hand as HandClass) : 'nothing';
}

export class SoldierAssets {
  readonly tables: AnimationTables;
  readonly palettes: SoldierPalettes | null;
  readonly structures: AnimStructures;
  readonly #available: ReadonlySet<string>;
  readonly #read: ReadVfsFile;
  readonly #sheets = new Map<string, Promise<SoldierSheet | null>>();
  readonly #ready = new Map<string, SoldierSheet | null>();
  readonly #colPalettes = new Map<string, Uint8Array | null>();
  readonly #pendingColPalettes = new Map<string, Promise<void>>();

  private constructor(
    tables: AnimationTables,
    palettes: SoldierPalettes | null,
    structures: AnimStructures,
    available: ReadonlySet<string>,
    read: ReadVfsFile,
  ) {
    this.tables = tables;
    this.palettes = palettes;
    this.structures = structures;
    this.#available = available;
    this.#read = read;
  }

  static async load(available: ReadonlySet<string>, read: ReadVfsFile = fetchVfsFile): Promise<SoldierAssets> {
    const json = async (path: string) => JSON.parse(new TextDecoder().decode(await read(path)));
    const palettePath = [SOLDIER_PALETTES_PATH, `${STUB_PREFIX}${SOLDIER_PALETTES_PATH}`].find((p) => available.has(p));
    const [controls, surfaces, palettes, structures] = await Promise.all([
      json(ANIM_CONTROL_PATH),
      json(ANIM_SURFACES_PATH),
      palettePath ? read(palettePath).then(parseSoldierPalettes) : null,
      loadAnimStructures(async (path) => (available.has(path) ? read(path) : null)),
    ]);
    return new SoldierAssets(parseAnimationTables(controls, surfaces), palettes, structures, available, read);
  }

  #dryStateSurface(view: SoldierView, state: number): number {
    return chooseSurface(this.tables, {
      bodyType: view.bodyType,
      state: substituteBodyTypeState(this.tables, { bodyType: view.bodyType, civilianTeam: view.team === CIV_TEAM }, state),
      hand: handClassOf(view.hand),
      secondHandOneHandedGun: false,
      life: FULL_LIFE,
      subFlags: view.bodyType === BIGMALE ? SubAnimFlags.BIGGUY_THREATEN_STANCE : 0,
      inWater: false,
      queenSpitDirection: () => SOUTHWEST,
    });
  }

  #request(surface: number): SheetRequest | null {
    if (surface === INVALID_SURFACE) return null;
    const info = this.tables.surfaces[surface];
    if (!info) return null;
    if (this.#available.has(info.file)) return { id: info.file, surface };
    return { id: `${STUB_PREFIX}anims/stub/${stubKind(info.name)}.sprite.json`, surface };
  }

  sheetFor(view: SoldierView): SheetRequest | null {
    return this.#request(view.surface);
  }

  standingSheetFor(view: SoldierView): SheetRequest | null {
    return this.#request(this.#dryStateSurface(view, stateId(this.tables, 'STANDING')));
  }

  structureDef(view: SoldierView): StructureDef | null {
    const surface = this.tables.surfaces[view.surface];
    if (!surface) return null;
    const type = animStructType(surface.struct, this.tables.controls[view.animation]?.id ?? '');
    if (type === AnimStruct.NONE) return null;
    return this.structures[view.bodyType]?.[type]?.structures[zStripIndex(view)] ?? null;
  }

  zStripFor(view: SoldierView, sheet: SoldierSheet): ZStripInfo | null {
    const type = this.tables.surfaces[view.surface]?.struct ?? AnimStruct.NONE;
    const file = type === AnimStruct.NONE ? null : this.structures[view.bodyType]?.[type];
    const structureIndex = zStripIndex(view);
    const structure = file?.structures[structureIndex];
    if (!file || !structure) return null;
    const frame = zStripSourceFrame(this.tables, view.surface, sheet.layout.frameCount, file.structures.length, structureIndex);
    const geometry = frame === null ? undefined : sheet.picture.frames[frame];
    return geometry ? zStripInfo({ offsetX: geometry.offsetX, offsetY: geometry.offsetY, width: geometry.width }, structure) : null;
  }

  preload(view: SoldierView): Promise<SoldierSheet | null>[] {
    const states = PRELOADED_STATES.map((n) => this.#dryStateSurface(view, stateId(this.tables, n)));
    const requests = [view.surface, ...states].map((surface) => this.#request(surface));
    return requests.flatMap((r) => (r ? [this.ensure(r)] : []));
  }

  ready(request: SheetRequest): SoldierSheet | null | undefined {
    if (!this.#ready.has(request.id)) void this.ensure(request);
    return this.#ready.get(request.id);
  }

  ensure(request: SheetRequest): Promise<SoldierSheet | null> {
    let pending = this.#sheets.get(request.id);
    if (!pending) {
      pending = this.#load(request).catch(() => null);
      pending.then((sheet) => this.#ready.set(request.id, sheet));
      this.#sheets.set(request.id, pending);
    }
    return pending;
  }

  async #load(request: SheetRequest): Promise<SoldierSheet | null> {
    if (request.id.startsWith(STUB_PREFIX)) {
      const manifest = parseStubSpriteManifest(JSON.parse(new TextDecoder().decode(await this.#read(request.id))));
      const png = await this.#read(request.id.replace(/[^/]+$/, manifest.image));
      const picture = pictureFromStubSprite(manifest, png);
      const perDirection = Number(manifest.meta?.framesPerDirection ?? STUB_SHEET_FRAMES_PER_DIRECTION);
      return { picture, layout: { directions: 8, framesPerDirection: perDirection, noFrames: false, frameCount: picture.frames.length } };
    }
    const sti = decodeSti(await this.#read(request.id));
    const picture = pictureFromSti(sti);
    if (picture.kind !== 'indexed' || sti.kind !== 'indexed') return null;
    const info = this.tables.surfaces[request.surface];
    const directions = info?.directions ?? 8;
    const layout: SheetLayout = {
      directions,
      framesPerDirection: sti.appData?.[0]?.numberOfFrames || Math.max(1, Math.floor(picture.frames.length / directions)),
      noFrames: info?.noFrames ?? false,
      frameCount: picture.frames.length,
    };
    return { picture: picture as IndexedPicture, layout };
  }

  #colPalette(path: string): Uint8Array | null | undefined {
    if (this.#colPalettes.has(path)) return this.#colPalettes.get(path);
    const file = [path, `${STUB_PREFIX}${path}`].find((p) => this.#available.has(p));
    if (!file) {
      this.#colPalettes.set(path, null);
      return null;
    }
    if (!this.#pendingColPalettes.has(path)) this.#pendingColPalettes.set(path, this.#loadColPalette(path, file));
    return undefined;
  }

  async #loadColPalette(path: string, file: string): Promise<void> {
    const palette = await this.#read(file)
      .then(parseColPalette)
      .catch(() => null);
    this.#colPalettes.set(path, palette);
    this.#pendingColPalettes.delete(path);
  }

  async loaded(): Promise<void> {
    await Promise.all([...this.#sheets.values(), ...this.#pendingColPalettes.values()]);
  }

  #sheetPalette(request: SheetRequest | null): SoldierPalette | null {
    const sheet = request ? this.ready(request) : null;
    if (!request || !sheet) return null;
    return { key: `own|${request.id}`, compose: () => sheet.picture.palette };
  }

  #replacedPalette(view: SoldierView): SoldierPalette | null {
    const request = this.standingSheetFor(view);
    const standing = request ? this.ready(request) : null;
    if (!request || !standing) return null;
    const palettes = this.palettes;
    if (!palettes) return { key: `own|${request.id}`, compose: () => standing.picture.palette };
    const [hair, skin, vest, pants] = view.palettes;
    return {
      key: `${request.id}|${view.palettes.join('|')}`,
      compose: () => composeSoldierPalette(standing.picture.palette, palettes, { hair, skin, vest, pants }),
    };
  }

  paletteFor(view: SoldierView): SoldierPalette | null {
    const stateName = this.tables.controls[view.animation]?.id ?? '';
    const substitution = bodyTypePaletteSubstitution(view.bodyType, { stateName, camouflaged: view.camouflaged === true });
    if (substitution === null) return this.#replacedPalette(view);
    if (substitution !== OWN_SHEET_PALETTE) {
      const col = this.#colPalette(substitution);
      if (col === undefined) return null;
      if (col) return { key: substitution, compose: () => col };
    }
    return this.#sheetPalette(reloadsPalette(stateName) ? this.sheetFor(view) : this.standingSheetFor(view));
  }
}

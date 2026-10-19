import { composeSoldierPalette, type SheetLayout } from '../../content/anim/soldier-sprite.ts';
import { chooseSurface, SubAnimFlags } from '../../content/anim/surface-choice.ts';
import {
  ANIM_CONTROL_PATH,
  ANIM_SURFACES_PATH,
  type AnimationTables,
  INVALID_SURFACE,
  parseAnimationTables,
  stateId,
} from '../../content/anim/tables.ts';
import { parseSoldierPalettes, SOLDIER_PALETTES_PATH, type SoldierPalettes } from '../../content/formats/ja2pal.ts';
import { decodeSti } from '../../content/formats/sti.ts';
import type { HandClass } from '../../content/items/items.ts';
import { pictureFromSti } from '../../content/picture/from-sti.ts';
import type { IndexedPicture } from '../../content/picture/picture.ts';
import { parseStubSpriteManifest, pictureFromStubSprite } from '../../content/picture/stub-sprite.ts';
import type { SoldierView } from '../../protocol/view.ts';
import type { SoldierSheet } from '../../render/world/soldier-sprites.ts';
import { fetchVfsFile, type ReadVfsFile } from '../net/vfs.ts';

const STUB_PREFIX = 'stubs/';
const STUB_SHEET_FRAMES_PER_DIRECTION = 18;
const BIGMALE = 1;

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

export class SoldierAssets {
  readonly tables: AnimationTables;
  readonly palettes: SoldierPalettes | null;
  readonly #available: ReadonlySet<string>;
  readonly #read: ReadVfsFile;
  readonly #sheets = new Map<string, Promise<SoldierSheet | null>>();
  readonly #ready = new Map<string, SoldierSheet | null>();

  private constructor(tables: AnimationTables, palettes: SoldierPalettes | null, available: ReadonlySet<string>, read: ReadVfsFile) {
    this.tables = tables;
    this.palettes = palettes;
    this.#available = available;
    this.#read = read;
  }

  static async load(available: ReadonlySet<string>, read: ReadVfsFile = fetchVfsFile): Promise<SoldierAssets> {
    const json = async (path: string) => JSON.parse(new TextDecoder().decode(await read(path)));
    const tables = parseAnimationTables(await json(ANIM_CONTROL_PATH), await json(ANIM_SURFACES_PATH));
    const palettePath = [SOLDIER_PALETTES_PATH, `${STUB_PREFIX}${SOLDIER_PALETTES_PATH}`].find((p) => available.has(p));
    const palettes = palettePath ? parseSoldierPalettes(await read(palettePath)) : null;
    return new SoldierAssets(tables, palettes, available, read);
  }

  #surfaceFor(view: SoldierView, state: number): number {
    return chooseSurface(this.tables, {
      bodyType: view.bodyType,
      state,
      hand: view.hand as HandClass,
      secondHandPistol: false,
      life: 100,
      subFlags: view.bodyType === BIGMALE ? SubAnimFlags.BIGGUY_THREATEN_STANCE : 0,
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
    return this.#request(this.#surfaceFor(view, view.animation));
  }

  standingSheetFor(view: SoldierView): SheetRequest | null {
    return this.#request(this.#surfaceFor(view, stateId(this.tables, 'STANDING')));
  }

  preload(view: SoldierView): Promise<SoldierSheet | null>[] {
    const states = ['STANDING', 'WALKING', 'RUNNING'].map((n) => stateId(this.tables, n));
    const requests = [view.animation, ...states].map((st) => this.#request(this.#surfaceFor(view, st)));
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

  paletteFor(view: SoldierView, standing: SoldierSheet): Uint8Array {
    const base = standing.picture.palette;
    if (!this.palettes) return base;
    const [hair, skin, vest, pants] = view.palettes;
    return composeSoldierPalette(base, this.palettes, { hair, skin, vest, pants });
  }
}

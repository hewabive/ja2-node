import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sharedStubPackDir } from '../../../tests/support/stub-pack.ts';
import { CORPSES_TABLE_PATH, parseCorpseTable } from '../../content/anim/corpses.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import type { CorpseView, SmokeTileView } from '../../protocol/view.ts';
import type { LoadedSoldierSheet } from '../../render/world/world-sprites.ts';
import type { ReadVfsFile } from '../net/vfs.ts';
import { type EffectSprites, WorldEffects } from './world-effects.ts';

class FakeSprites implements EffectSprites {
  readonly sheets = new Map<string, LoadedSoldierSheet>();
  readonly palettes = new Map<string, Uint8Array>();
  #rows = 0;

  addSheet(id: string, picture: LoadedSoldierSheet['picture']): LoadedSoldierSheet {
    const sheet = this.sheets.get(id) ?? {
      picture,
      regions: picture.frames.map((f, i) => ({ layer: 0, x: i, y: 0, width: f.width, height: f.height })),
    };
    this.sheets.set(id, sheet);
    return sheet;
  }

  soldierFrame(sheet: LoadedSoldierSheet, index: number) {
    const region = sheet.regions[index];
    const frame = sheet.picture.frames[index];
    return region && frame ? { ...region, offsetX: frame.offsetX, offsetY: frame.offsetY, pixels: frame.pixels } : null;
  }

  shadedPaletteBase(key: string, palette: () => Uint8Array): number {
    if (!this.palettes.has(key)) this.palettes.set(key, palette());
    return this.#rows++;
  }

  plainPaletteRow(key: string, palette: () => Uint8Array): number {
    return this.shadedPaletteBase(key, palette);
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('corpses and smoke on the stub pack', () => {
  let data: DataVfs;
  let effects: WorldEffects;
  let corpseType = 0;
  let backCorpseType = 0;
  let available: ReadonlySet<string> = new Set();
  let read: ReadVfsFile = async () => new Uint8Array();

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, stubsDir: sharedStubPackDir() });
    available = new Set(data.vfs.list().map((f) => f.path));
    read = async (path: string) => new Uint8Array(await data.vfs.read(path));
    effects = await WorldEffects.load(read, available, null);
    const table = parseCorpseTable(JSON.parse(new TextDecoder().decode(await data.vfs.read(CORPSES_TABLE_PATH))));
    corpseType = table.types.indexOf('SMERC_JFK');
    backCorpseType = table.types.indexOf('SMERC_BCK');
  }, 60_000);

  afterAll(async () => {
    await data?.close();
  });

  it('draws a corpse at the start frame of its direction block and smoke with its own palette once the art has loaded', async () => {
    const sprites = new FakeSprites();
    effects.setSprites(sprites);
    const corpse: CorpseView = { gridNo: 12880, level: 0, type: corpseType, direction: 2, bodyType: 0 };
    const smoke: SmokeTileView[] = [
      { gridNo: 12881, level: 0, effect: 'SMOKE' },
      { gridNo: 12882, level: 1, effect: 'TEARGAS', dissipating: true },
    ];
    const input = { corpses: [corpse], smoke, clockMs: 0, bloodAndGore: true, animateSmoke: true };
    expect(effects.build(input)).toEqual([]);
    await settle();
    effects.build(input);
    await settle();
    const tiles = effects.build(input);
    expect(tiles.map((t) => [t.kind, t.gridNo, t.level])).toEqual([
      ['corpse', 12880, 0],
      ['smoke', 12881, 0],
      ['smoke', 12882, 1],
    ]);
    const [body] = tiles;
    expect(body?.sprite.x).toBe(3);
    expect(body?.shaded).toBe(true);
    expect(tiles[1]?.shaded).toBe(false);
    expect([...sprites.sheets.keys()]).toEqual(['anims/corpses/s_d_jfk.sti', 'tilecache/smoke.sti', 'tilecache/smaltear.sti']);
  });

  it('draws the corpse of a soldier seen alive in the first frame after his death, z strips included', async () => {
    const prepared = await WorldEffects.load(read, available, null);
    prepared.setSprites(new FakeSprites());
    prepared.prepareCorpses([{ bodyType: 0 }], true);
    await prepared.loaded();
    const corpse: CorpseView = { gridNo: 12880, level: 0, type: backCorpseType, direction: 5, bodyType: 0 };
    const tiles = prepared.build({ corpses: [corpse], smoke: [], clockMs: 0, bloodAndGore: true, animateSmoke: true });
    expect(tiles.map((t) => [t.kind, t.gridNo])).toEqual([['corpse', 12880]]);
    expect(tiles[0]?.zStrip).not.toBeNull();
  });

  it('draws the static smoke graphic, opaque, when smoke is not animated', async () => {
    effects.setSprites(new FakeSprites());
    const input = { corpses: [], smoke: [{ gridNo: 100, level: 0, effect: 'SMOKE' }], clockMs: 0, bloodAndGore: true, animateSmoke: false };
    effects.build(input);
    await settle();
    expect(effects.build(input).map((t) => t.kind)).toEqual(['staticSmoke']);
  });
});

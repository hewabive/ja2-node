import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { sharedStubPackDir } from '../../../tests/support/stub-pack.ts';
import { Body } from '../../content/anim/body-types.ts';
import { CAMO_PALETTE } from '../../content/anim/palette-substitution.ts';
import { surfaceId } from '../../content/anim/surface-choice.ts';
import { stateId } from '../../content/anim/tables.ts';
import { parseColPalette } from '../../content/formats/col.ts';
import { zStripInfo } from '../../content/world/zstrip.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import type { SoldierView } from '../../protocol/view.ts';
import { SoldierAssets } from './soldier-assets.ts';

const OUR_TEAM = 0;
const CREATURE_TEAM = 2;
const EAST = 2;
const PRONE_START_FRAME = 5;

async function openAssets(dataDir?: string): Promise<{ data: DataVfs; assets: SoldierAssets }> {
  const data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir, stubsDir: sharedStubPackDir() });
  const available = new Set(data.vfs.list().map((f) => f.path));
  const assets = await SoldierAssets.load(available, async (path: string) => new Uint8Array(await data.vfs.read(path)));
  return { data, assets };
}

function viewOf(assets: SoldierAssets, over: Partial<SoldierView> & { readonly state: string; readonly sheet: string }): SoldierView {
  const { state, sheet, ...rest } = over;
  return {
    id: 1,
    team: OUR_TEAM,
    name: '',
    bodyType: Body.REGMALE,
    gridNo: 0,
    x: 0,
    y: 0,
    level: 0,
    direction: EAST,
    animation: stateId(assets.tables, state),
    frame: 0,
    palettes: ['BLACKHEAD', 'PINKSKIN', 'BLUEVEST', 'JEANPANTS'],
    hand: 'rifle',
    surface: surfaceId(assets.tables, sheet),
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
    ...rest,
  };
}

async function settledPalette(assets: SoldierAssets, view: SoldierView) {
  assets.paletteFor(view);
  await assets.loaded();
  assets.paletteFor(view);
  await assets.loaded();
  return assets.paletteFor(view);
}

function sheetId(assets: SoldierAssets, sheet: string): string {
  const request = assets.sheetFor(viewOf(assets, { state: 'STANDING', sheet }));
  if (!request) throw new Error(`no sheet ${sheet}`);
  return request.id;
}

describe('soldier sheets and palettes on the stub pack', () => {
  let data: DataVfs;
  let assets: SoldierAssets;

  beforeAll(async () => {
    ({ data, assets } = await openAssets());
  });

  afterAll(async () => {
    await data?.close();
  });

  it('draws the sheet the view names', () => {
    const view = viewOf(assets, { state: 'WALKING', sheet: 'RGMWATER_R_WALK' });
    expect(assets.sheetFor(view)?.surface).toBe(view.surface);
  });

  it("wears his standing sheet with the replacements, and a burning merc his fire sheet's own palette", async () => {
    const standing = await settledPalette(assets, viewOf(assets, { state: 'WALKING', sheet: 'RGMBASICWALKING' }));
    expect(standing?.key).toBe(`${sheetId(assets, 'RGMSTANDING')}|BLACKHEAD|PINKSKIN|BLUEVEST|JEANPANTS`);
    const burning = await settledPalette(assets, viewOf(assets, { state: 'CHARIOTS_OF_FIRE', sheet: 'RGMBURN', camouflaged: true }));
    expect(burning?.key).toBe(`own|${sheetId(assets, 'RGMBURN')}`);
  });

  it("wears the standing sheet's own palette when painted and the camouflage file is missing", async () => {
    const painted = await settledPalette(assets, viewOf(assets, { state: 'STANDING', sheet: 'RGMSTANDING', camouflaged: true }));
    expect(painted?.key).toBe(`own|${sheetId(assets, 'RGMSTANDING')}`);
  });

  it('finds a palette for the bodies whose standing state is another state: the queen and the larvae', async () => {
    const queen = viewOf(assets, { bodyType: Body.QUEENMONSTER, team: CREATURE_TEAM, state: 'QUEEN_SPIT', sheet: 'QUEENMONSTERSPIT_E' });
    const larvae = viewOf(assets, { bodyType: Body.LARVAE_MONSTER, team: CREATURE_TEAM, state: 'LARVAE_WALK', sheet: 'LVWALK' });
    expect((await settledPalette(assets, queen))?.key).toBe(`own|${sheetId(assets, 'QUEENMONSTERSTANDING')}`);
    expect((await settledPalette(assets, larvae))?.key).toMatch(new RegExp(`^${sheetId(assets, 'LVBREATH')}\\|`));
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('soldier palettes and z strips of the original', () => {
  let data: DataVfs;
  let assets: SoldierAssets;

  beforeAll(async () => {
    ({ data, assets } = await openAssets(ORIGINAL_DATA_DIR));
  });

  afterAll(async () => {
    await data?.close();
  });

  async function sheetPalette(sheet: string): Promise<Uint8Array | undefined> {
    const request = assets.sheetFor(viewOf(assets, { state: 'STANDING', sheet }));
    return request ? (await assets.ensure(request))?.picture.palette : undefined;
  }

  it('wears the camouflage file when painted, and the fire sheet’s own palette while burning', async () => {
    const painted = await settledPalette(assets, viewOf(assets, { state: 'STANDING', sheet: 'RGMSTANDING', camouflaged: true }));
    const burning = await settledPalette(assets, viewOf(assets, { state: 'CHARIOTS_OF_FIRE', sheet: 'RGMBURN', camouflaged: true }));
    expect(painted?.compose()).toEqual(parseColPalette(new Uint8Array(await data.vfs.read(CAMO_PALETTE))));
    expect(burning?.compose()).toEqual(await sheetPalette('RGMBURN'));
  });

  it("gives a vehicle its standing sheet's palette until it dies, then the dying sheet's", async () => {
    const humvee = { bodyType: Body.HUMVEE, hand: 'nothing' } as const;
    const driving = await settledPalette(assets, viewOf(assets, { ...humvee, state: 'STANDING', sheet: 'HUMVEE_BASIC' }));
    const dying = await settledPalette(assets, viewOf(assets, { ...humvee, state: 'VEHICLE_DIE', sheet: 'HUMVEE_DIE' }));
    expect(driving?.compose()).toEqual(await sheetPalette('HUMVEE_BASIC'));
    expect(dying?.compose()).toEqual(await sheetPalette('HUMVEE_DIE'));
    expect(dying?.compose()).not.toEqual(driving?.compose());
  });

  it("takes a lying regular male's z strips from frame 5 of his facing", async () => {
    const view = viewOf(assets, { state: 'PRONE', sheet: 'RGMPRONE' });
    const request = assets.sheetFor(view);
    const sheet = request ? await assets.ensure(request) : null;
    const structure = assets.structureDef(view);
    if (!sheet || !structure) throw new Error('no prone sheet or structure');
    const facingStart = sheet.layout.framesPerDirection * ((EAST + 1) % 8);
    const stripOf = (frame: number) => {
      const f = sheet.picture.frames[frame];
      if (!f) throw new Error(`no frame ${frame}`);
      return zStripInfo({ offsetX: f.offsetX, offsetY: f.offsetY, width: f.width }, structure);
    };
    expect(stripOf(facingStart + PRONE_START_FRAME)).not.toEqual(stripOf(facingStart));
    expect(assets.zStripFor(view, sheet)).toEqual(stripOf(facingStart + PRONE_START_FRAME));
  });
});

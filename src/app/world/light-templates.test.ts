import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { writeLightTemplateFile } from '../../content/formats/lht.ts';
import { STUBS_LAYER } from '../../content/vfs/layers.ts';
import { editorLightIntensity, LIGHT_TEMPLATE_NAMES, lightCreateOmni } from '../../content/world/light-templates.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import type { InventoryItemView } from '../../protocol/view.ts';
import { LightTemplates, MERC_LIGHT, mercLightTemplateName, NIGHT_GOGGLES_LIGHT, UV_GOGGLES_LIGHT } from './light-templates.ts';

const head = (slot: number, item: string): InventoryItemView => ({ slot, item, index: 0, count: 1, status: [100] });

describe('merc light templates', () => {
  it('picks Light4 for UV goggles, Light3 for night goggles and Light2 otherwise, from the head slots only', () => {
    expect(mercLightTemplateName([head(3, 'UVGOGGLES')])).toBe(UV_GOGGLES_LIGHT);
    expect(mercLightTemplateName([head(4, 'NIGHTGOGGLES')])).toBe(NIGHT_GOGGLES_LIGHT);
    expect(mercLightTemplateName([head(7, 'NIGHTGOGGLES')])).toBe(MERC_LIGHT);
    expect(mercLightTemplateName(undefined)).toBe(MERC_LIGHT);
  });

  it("reads the user's LHT files by the names the game asks for, the stub pack's where the data has none, and nothing without either", async () => {
    const user = lightCreateOmni(5, 3, 'Light2');
    const stub = lightCreateOmni(6, 6, 'Light3');
    const files = new Map<string, Uint8Array>([
      ['light2', writeLightTemplateFile(user)],
      ['stubs/light2', writeLightTemplateFile(stub)],
      ['stubs/light3', writeLightTemplateFile(stub)],
    ]);
    const read = async (path: string) => new Uint8Array(files.get(path) ?? new Uint8Array());
    const templates = await LightTemplates.load(
      [
        { path: 'light2', size: 1, layer: 'Data.slf' },
        { path: 'stubs/light2', size: 1, layer: STUBS_LAYER },
        { path: 'stubs/light3', size: 1, layer: STUBS_LAYER },
      ],
      read,
    );
    expect(templates.resolve(MERC_LIGHT)).toEqual({ template: user, origin: 'data' });
    expect(templates.resolve('LIGHT3')).toEqual({ template: stub, origin: 'stubs' });
    expect(templates.resolve(UV_GOGGLES_LIGHT)).toBeNull();
    expect(new LightTemplates().resolve(MERC_LIGHT)).toBeNull();
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('merc light templates on the original data', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
  });

  afterAll(async () => {
    await data.close();
  });

  it('reads every map and merc template of the Gold data, every ray included', async () => {
    const listing = data.vfs.list().map((f) => ({ path: f.path, size: f.size, layer: f.layer }));
    const templates = await LightTemplates.load(listing, (path) => data.vfs.read(path));
    expect(templates.loaded).toBe(LIGHT_TEMPLATE_NAMES.length);
    expect(templates.resolve('L-R05.LHT')).toEqual({ template: lightCreateOmni(editorLightIntensity(5), 5, 'L-R05.LHT'), origin: 'data' });
    for (const name of [MERC_LIGHT, NIGHT_GOGGLES_LIGHT, UV_GOGGLES_LIGHT]) expect(templates.resolve(name)?.origin).toBe('data');
  });
});

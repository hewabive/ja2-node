import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHIPPED_LIGHT_TEMPLATES_PATH } from '../../content/formats/lht.ts';
import { PROJECT_DATA_LAYER } from '../../content/vfs/layers.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import type { InventoryItemView } from '../../protocol/view.ts';
import type { SimEvent } from '../../sim/events.ts';
import { lightTemplate } from '../../sim/tactical/lighting/templates.ts';
import { AiTurnHolder } from './ai-turn.ts';
import { LightTemplates, MERC_LIGHT, mercLightTemplateName, NIGHT_GOGGLES_LIGHT, UV_GOGGLES_LIGHT } from './light-templates.ts';

const REPOSITORY_JSON = readFileSync(join(PROJECT_DATA_DIR, SHIPPED_LIGHT_TEMPLATES_PATH));
const head = (slot: number, item: string): InventoryItemView => ({ slot, item, index: 0, count: 1, status: [100] });

function lhtFile(nodes: readonly [number, number, number][], rays: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(2 + nodes.length * 6 + 2 + rays.length * 2);
  const v = new DataView(bytes.buffer);
  let o = 0;
  v.setUint16(o, nodes.length, true);
  o += 2;
  for (const [dx, dy, light] of nodes) {
    v.setInt16(o, dx, true);
    v.setInt16(o + 2, dy, true);
    v.setUint8(o + 5, light);
    o += 6;
  }
  v.setUint16(o, rays.length, true);
  o += 2;
  for (const r of rays) {
    v.setUint16(o, r, true);
    o += 2;
  }
  return bytes;
}

describe('merc light templates', () => {
  it('picks Light4 for UV goggles, Light3 for night goggles and Light2 otherwise, from the head slots only', () => {
    expect(mercLightTemplateName([head(3, 'UVGOGGLES')])).toBe(UV_GOGGLES_LIGHT);
    expect(mercLightTemplateName([head(4, 'NIGHTGOGGLES')])).toBe(NIGHT_GOGGLES_LIGHT);
    expect(mercLightTemplateName([head(7, 'NIGHTGOGGLES')])).toBe(MERC_LIGHT);
    expect(mercLightTemplateName(undefined)).toBe(MERC_LIGHT);
  });

  it('falls back to the generated stand-ins without data', () => {
    const templates = new LightTemplates();
    expect(templates.resolve(MERC_LIGHT)).toMatchObject({ origin: 'standIn', template: lightTemplate('L-R06.LHT') });
    expect(templates.resolve(NIGHT_GOGGLES_LIGHT)?.template).toBe(lightTemplate('L-R07.LHT'));
    expect(templates.resolve(UV_GOGGLES_LIGHT)?.template).toBe(lightTemplate('L-R08.LHT'));
    expect(templates.resolve('L-R03.LHT')?.origin).toBe('generated');
    expect(templates.resolve('Light5')).toBeNull();
  });

  it("reads Stracciatella's light-templates.json from any layer and lets the user's loose LHT files override it", async () => {
    const files = new Map<string, Uint8Array>([
      [SHIPPED_LIGHT_TEMPLATES_PATH, REPOSITORY_JSON],
      ['light3.lht', lhtFile([[0, 0, 5]], [0x8000, 0x4001, 0x8000])],
    ]);
    const read = async (path: string) => new Uint8Array(files.get(path) ?? new Uint8Array());
    const fromRepository = await LightTemplates.load(
      [
        { path: SHIPPED_LIGHT_TEMPLATES_PATH, size: 1, layer: PROJECT_DATA_LAYER },
        { path: 'light3.lht', size: 1, layer: 'data-dir' },
      ],
      read,
    );
    expect(fromRepository.resolve(MERC_LIGHT)).toMatchObject({ origin: 'data' });
    expect(fromRepository.resolve(MERC_LIGHT)?.template.lights).toHaveLength(117);
    const light3 = fromRepository.resolve(NIGHT_GOGGLES_LIGHT);
    expect(light3?.origin).toBe('data');
    expect(light3?.template.lights).toEqual([{ dx: 0, dy: 0, light: 5 }]);
    const fromUser = await LightTemplates.load([{ path: SHIPPED_LIGHT_TEMPLATES_PATH, size: 1, layer: 'data-dir' }], read);
    expect(fromUser.resolve(MERC_LIGHT)).toMatchObject({ origin: 'data' });
    expect(fromUser.resolve(MERC_LIGHT)?.template.lights).toHaveLength(117);
  });
});

describe('the AI turn holder', () => {
  it('follows aiTurn events and lets go when a turn or an interrupt changes hands', () => {
    const holder = new AiTurnHolder();
    holder.observe([{ type: 'aiTurn', tick: 1, soldier: 21 } as SimEvent]);
    expect(holder.holds(21)).toBe(true);
    holder.observe([{ type: 'aiTurn', tick: 2, soldier: 22 } as SimEvent]);
    expect([holder.holds(21), holder.holds(22)]).toEqual([false, true]);
    holder.observe([{ type: 'turnStarted', tick: 3, team: 0, round: 2 } as SimEvent]);
    expect(holder.soldier).toBeNull();
  });
});

describe.skipIf(!process.env.JA2_DATA_DIR)('merc light templates on the original data', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: process.env.JA2_DATA_DIR });
  });

  afterAll(async () => {
    await data.close();
  });

  it('reads the map templates of the Gold data, equal to the generated ones, and the merc lights from the shipped JSON', async () => {
    const listing = data.vfs.list().map((f) => ({ path: f.path, size: f.size, layer: f.layer }));
    const templates = await LightTemplates.load(listing, (path) => data.vfs.read(path));
    expect(templates.fromData).toBe(17);
    const mapLight = templates.resolve('L-R05.LHT');
    expect(mapLight?.origin).toBe('data');
    expect(mapLight?.template.lights).toEqual(lightTemplate('L-R05.LHT')?.lights);
    expect(mapLight?.template.rays).toEqual(lightTemplate('L-R05.LHT')?.rays);
    for (const name of [MERC_LIGHT, NIGHT_GOGGLES_LIGHT, UV_GOGGLES_LIGHT]) expect(templates.resolve(name)?.origin).toBe('data');
  });
});

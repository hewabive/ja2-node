import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { loadLightTemplates } from '../../sim/tactical/load-content.ts';
import { parseLightTemplateFile, writeLightTemplateFile } from '../formats/lht.ts';
import {
  editorLightIntensity,
  LIGHT_BACKLIGHT,
  LIGHT_NEW_RAY,
  LIGHT_TEMPLATE_NAMES,
  type LightTemplate,
  lightCreateOmni,
  lightTemplateKey,
  mapLightTemplateName,
} from './light-templates.ts';

const MAP_LIGHT_RADII = [1, 2, 3, 4, 5, 6, 7, 8];
const CENTRE = { dx: 0, dy: 0 };

function rayNodes(t: LightTemplate): number[][] {
  const rays: number[][] = [];
  for (const entry of t.rays) {
    if (entry & LIGHT_NEW_RAY) rays.push([]);
    else rays[rays.length - 1]?.push(entry);
  }
  return rays;
}

function nodeAt(t: LightTemplate, entry: number) {
  return t.lights[entry & ~LIGHT_BACKLIGHT];
}

describe('light templates', () => {
  it('builds an omni light of radius 1 as the centre and its four neighbours', () => {
    const t = lightCreateOmni(1, 1);
    expect(t.lights.slice(1).map((n) => [n.dx, n.dy, n.light])).toEqual([
      [0, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 0, 1],
      [-1, 0, 1],
    ]);
  });

  it('keeps every ray of the cast, each step of a tile as often as the ray passes it, and starts every ray at the centre', () => {
    const t = lightCreateOmni(5, 5);
    const rays = rayNodes(t);
    expect(rays.every((r) => nodeAt(t, r[0] ?? 0)?.dx === CENTRE.dx && nodeAt(t, r[0] ?? 0)?.dy === CENTRE.dy)).toBe(true);
    expect(rays.some((r) => r.some((n, i) => i > 0 && n === r[i - 1]))).toBe(true);
    expect(new Set(rays.map((r) => r.join(','))).size).toBeLessThan(rays.length);
  });

  it('marks every step of a ray that ends south-east of the light as backlit (LightCastRay), and no other', () => {
    const t = lightCreateOmni(5, 5);
    const rays = rayNodes(t);
    const backlit = rays.filter((ray) => ray.every((entry) => (entry & LIGHT_BACKLIGHT) !== 0));
    const plain = rays.filter((ray) => ray.every((entry) => (entry & LIGHT_BACKLIGHT) === 0));
    expect(backlit.length + plain.length).toBe(rays.length);
    expect(backlit.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(backlit.length);
    for (const ray of backlit) {
      const end = nodeAt(t, ray.at(-1) ?? 0);
      expect((end?.dx ?? 0) >= 0 && (end?.dy ?? 0) >= 0).toBe(true);
    }
    expect(plain.some((ray) => (nodeAt(t, ray.at(-1) ?? 0)?.dx ?? 0) > 0 && (nodeAt(t, ray.at(-1) ?? 0)?.dy ?? 0) > 0)).toBe(false);
  });

  it("names the editor's map lights by radius and gives them the radius over the light decay as intensity (PlaceLight)", () => {
    expect(MAP_LIGHT_RADII.map(mapLightTemplateName)).toEqual(LIGHT_TEMPLATE_NAMES.slice(0, MAP_LIGHT_RADII.length));
    expect(MAP_LIGHT_RADII.map(editorLightIntensity)).toEqual(MAP_LIGHT_RADII);
    expect(editorLightIntensity(9)).toBe(10);
  });

  it('writes and reads a template with its ray flags', () => {
    const t = lightCreateOmni(3, 3, 'L-R03.LHT');
    expect(parseLightTemplateFile('L-R03.LHT', writeLightTemplateFile(t))).toEqual(t);
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('light templates against the original files', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
  });
  afterAll(async () => {
    await data.close();
  });

  it("reads every map and effect template of the user's files, every ray and flag included", async () => {
    const loaded = await loadLightTemplates(async (path) => (data.vfs.stat(path) ? data.vfs.read(path) : null));
    expect([...loaded.keys()]).toEqual(LIGHT_TEMPLATE_NAMES.map(lightTemplateKey));
    for (const radius of MAP_LIGHT_RADII) {
      const name = mapLightTemplateName(radius);
      expect(loaded.get(name), name).toEqual(lightCreateOmni(editorLightIntensity(radius), radius, name));
    }
  });
});

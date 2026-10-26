import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { BinaryReader } from '../../../content/binary/reader.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { asShippedTemplate, LIGHT_CENTRE_NODE, LIGHT_NEW_RAY, type LightTemplate, lightCreateOmni, lightTemplate } from './templates.ts';

const MAP_LIGHT_TEMPLATES = [
  'L-R01.LHT',
  'L-R01I2.LHT',
  'L-R02.LHT',
  'L-R03.LHT',
  'L-R04.LHT',
  'L-R05.LHT',
  'L-R06.LHT',
  'L-R07.LHT',
  'L-R08.LHT',
];

function rayNodes(t: LightTemplate): number[][] {
  const rays: number[][] = [];
  for (const entry of t.rays) {
    if (entry & LIGHT_NEW_RAY) rays.push([]);
    else rays[rays.length - 1]?.push(entry);
  }
  return rays;
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
    expect(t.lights[LIGHT_CENTRE_NODE]).toEqual({ dx: 0, dy: 0, light: 1 });
  });

  it('starts every shipped ray at the centre, without repeats', () => {
    for (const name of MAP_LIGHT_TEMPLATES) {
      const t = lightTemplate(name);
      if (!t) throw new Error(name);
      const rays = rayNodes(t);
      expect(rays.every((r) => r[0] === LIGHT_CENTRE_NODE)).toBe(true);
      expect(new Set(rays.map((r) => r.join(','))).size).toBe(rays.length);
      expect(rays.every((r) => r.every((n, i) => i === 0 || n !== r[i - 1]))).toBe(true);
    }
  });

  it('gives the map templates their radius as intensity and reach', () => {
    for (let radius = 1; radius <= 8; radius++) {
      const t = lightTemplate(`L-R0${radius}.LHT`);
      expect(t?.lights[LIGHT_CENTRE_NODE]?.light).toBe(radius);
      expect(Math.max(...(t?.lights.slice(1).map((n) => Math.abs(n.dx)) ?? []))).toBe(radius);
    }
    expect(lightTemplate('L-R01I2.LHT')?.lights[LIGHT_CENTRE_NODE]?.light).toBe(4);
  });

  it('knows no templates that only exist as data', () => {
    expect(lightTemplate('TRANSLUC.LHT')).toBeNull();
    expect(lightTemplate('Light2')).toBeNull();
  });
});

function parseLightFile(name: string, bytes: Uint8Array): LightTemplate {
  const r = new BinaryReader(bytes);
  const lights = Array.from({ length: r.u16() }, () => {
    const dx = r.i16();
    const dy = r.i16();
    r.u8();
    return { dx, dy, light: r.u8() };
  });
  const rays = Array.from({ length: r.u16() }, () => r.u16() & ~0x4000);
  return { name, lights, rays };
}

describe.skipIf(!ORIGINAL_DATA_DIR)('light templates against the original files', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
  });
  afterAll(async () => {
    await data.close();
  });

  for (const name of MAP_LIGHT_TEMPLATES) {
    it(`generates ${name} as Stracciatella ships it`, async () => {
      const file = parseLightFile(name, await data.vfs.read(name.toLowerCase()));
      const ours = lightTemplate(name);
      expect(ours?.lights).toEqual(file.lights);
      expect(ours?.rays).toEqual(asShippedTemplate(name, file).rays);
    });
  }
});

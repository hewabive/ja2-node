import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MapDef, parseMap } from '../src/content/formats/map.ts';
import { parseDetailedPlacement } from '../src/content/formats/placement.ts';
import { asArray, asInt, asObject, asString } from '../src/content/strategic/json-fields.ts';
import { parseJsonc } from '../src/content/strategic/jsonc.ts';
import { sectorShortString } from '../src/content/strategic/sector-ids.ts';
import { STUB_FALLBACK_MAP, STUB_MAPS_DIR, sectorMapPath, withSectorExitGrids } from '../src/content/strategic/sector-maps.ts';
import { WORLD_COLS } from '../src/content/world/grid.ts';
import { type DataVfs, openDataVfs } from '../src/node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import { sharedStubPackDir } from '../tests/support/stub-pack.ts';
import { kindOfSector, loadSectorKinds, parseSectorName, type SectorKindTable, sectorMapFile } from './sector-kinds.ts';

const ENEMY_TEAM = 1;
const CIV_TEAM = 4;
const NO_PROFILE = 200;
const GARRISON_SLOTS = 20;
const SURFACE_KIND_MAPS = ['town', 'mine', 'camp', 'airfield'];
const TOWN_KINDS = ['town', 'prison', 'mine', 'sam', 'airport', 'palace'];
const UNDERGROUND_KINDS = ['mine-level', 'lair', 'basement'];
const LAIR_PARTS = ['QUEEN_LAIR', 'LAIR', 'LAIR_ENTRANCE'];
const ALMA_CAPTIVE_GRIDNOS = [9208, 9688, 9215];
const CHOPPER_GRIDNO = 8842;

async function externalized(file: string): Promise<readonly unknown[]> {
  return asArray(parseJsonc(await readFile(join(PROJECT_DATA_DIR, 'externalized', file), 'utf8')), file);
}

function field(entry: unknown, key: string, what: string): unknown {
  return asObject(entry, what)[key];
}

let table: SectorKindTable;
let data: DataVfs;

beforeAll(async () => {
  table = await loadSectorKinds();
  data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, stubsDir: sharedStubPackDir() });
});

afterAll(async () => {
  await data.close();
});

const exists = (path: string) => data.vfs.stat(path) !== undefined;
const kindName = (name: string) => kindOfSector(table, name)?.kind ?? (table.handMade.has(name) ? 'hand-made' : 'fallback');

async function stubMap(path: string): Promise<MapDef> {
  return withSectorExitGrids(parseMap(await data.vfs.read(path)), path);
}

async function kindMap(map: string): Promise<MapDef> {
  return stubMap(`${STUB_MAPS_DIR}${map}.dat`);
}

function profilesPlaced(map: MapDef): number[] {
  return map.placements
    .flatMap((p) => (p.detailedRaw ? [parseDetailedPlacement(p.detailedRaw).profile] : []))
    .filter((id) => id !== NO_PROFILE);
}

describe('the stub sector kinds table', () => {
  it('gives every town, mine, SAM site, garrison and underground level of the strategic tables a kind or a hand-made map', async () => {
    const towns = (await externalized('strategic-map-towns.json')).flatMap((t, i) =>
      asArray(field(t, 'sectors', `towns[${i}]`), `towns[${i}].sectors`).map((s, j) => asString(s, `towns[${i}].sectors[${j}]`)),
    );
    for (const name of towns) expect([...TOWN_KINDS, 'hand-made'], name).toContain(kindName(name));
    const mines = (await externalized('strategic-mines.json')).map((m, i) => asString(field(m, 'entranceSector', `mines[${i}]`), 'mine'));
    for (const name of mines) expect(kindName(name), name).toBe('mine');
    const sams = (await externalized('strategic-map-sam-sites.json')).map((s, i) => asString(field(s, 'sector', `sams[${i}]`), 'sam'));
    for (const name of sams) expect(kindName(name), name).toBe('sam');
    const garrisons = (await externalized('army-garrison-groups.json')).map((g, i) => asString(field(g, 'sector', `garrisons[${i}]`), 'g'));
    for (const name of garrisons) expect(kindName(name), name).not.toBe('fallback');
    const underground = (await externalized('strategic-map-underground-sectors.json')).map(
      (u, i) =>
        `${asString(field(u, 'sector', `underground[${i}]`), 'sector')}_b${asInt(field(u, 'sectorLevel', `underground[${i}]`), 'level')}`,
    );
    expect(underground).toHaveLength(36);
    for (const name of underground) expect([...UNDERGROUND_KINDS, 'hand-made'], name).toContain(kindName(name));
    const lairs = (await externalized('strategic-map-creature-lairs.json')).flatMap((l, i) =>
      asArray(field(l, 'sectors', `lairs[${i}]`), 'sectors').map((s) => asArray(s, 'lair sector').map(String)),
    );
    for (const [sector, level, part] of lairs)
      expect(kindName(`${sector}_b${level}`), `${sector}_b${level}`).toBe(LAIR_PARTS.includes(part ?? '') ? 'lair' : 'mine-level');
  });

  it('gives every possible start of Skyrider an alternate map of the skyrider kind', async () => {
    const skyrider = (await externalized('strategic-map-npc-placements.json')).find(
      (p, i) => asString(field(p, 'profile', `npc placements[${i}]`), 'profile') === 'SKYRIDER',
    );
    const starts = asArray(field(skyrider, 'sectors', 'skyrider'), 'skyrider.sectors').map((s) => asString(s, 'skyrider sector'));
    expect(starts).toHaveLength(4);
    for (const name of starts) expect(kindName(`${name}_a`), name).toBe('skyrider');
  });

  it('rejects a sector listed twice and a bad sector name', () => {
    expect(() => parseSectorName('Q1')).toThrow(/bad sector name/);
    expect(() => parseSectorName('A1_b4')).toThrow(/bad sector name/);
    expect(sectorMapFile('D13_b1')).toBe('d13_b1.dat');
  });
});

describe('the stub sector maps', () => {
  it('load the kind map of a listed sector through the alias manifest and the fallback elsewhere', async () => {
    for (const kind of table.kinds) {
      for (const name of kind.sectors) {
        const sector = parseSectorName(name);
        const path = sectorMapPath(exists, sector, sector.alternate);
        expect(path, name).toBe(`${STUB_MAPS_DIR}${sectorMapFile(name)}`);
        const bytes = Buffer.from(await data.vfs.read(path));
        expect(bytes.equals(Buffer.from(await data.vfs.read(`${STUB_MAPS_DIR}${kind.map}.dat`))), name).toBe(true);
      }
    }
    for (const name of table.handMade.keys()) {
      const sector = parseSectorName(name);
      expect(sectorMapPath(exists, sector, false)).toBe(`${STUB_MAPS_DIR}${sectorMapFile(name)}`);
    }
    expect(sectorMapPath(exists, parseSectorName('B9'), false)).toBe(STUB_FALLBACK_MAP);
    expect(sectorMapPath(exists, parseSectorName('B13'), true)).toBe(STUB_FALLBACK_MAP);
  });

  it('give each surface kind map the four edges for arrivals and room for a garrison of 20', async () => {
    for (const name of SURFACE_KIND_MAPS) {
      const map = await kindMap(name);
      const { northGridNo, eastGridNo, southGridNo, westGridNo } = map.info;
      expect(
        [northGridNo, eastGridNo, southGridNo, westGridNo].every((g) => g >= 0),
        name,
      ).toBe(true);
      expect(map.placements.filter((p) => p.basic.team === ENEMY_TEAM).length, name).toBeGreaterThanOrEqual(GARRISON_SLOTS);
    }
  });

  it('lead the mine shaft down and every cave ladder up to the sector the map is loaded for', async () => {
    expect((await stubMap(`${STUB_MAPS_DIR}d13.dat`)).exitGrids.map((e) => e.sector)).toEqual([{ x: 13, y: 4, z: 1 }]);
    expect((await stubMap(`${STUB_MAPS_DIR}h3.dat`)).exitGrids.map((e) => e.sector)).toEqual([{ x: 3, y: 8, z: 1 }]);
    expect((await stubMap(`${STUB_MAPS_DIR}d13_b1.dat`)).exitGrids.map((e) => e.sector)).toEqual([{ x: 13, y: 4, z: 0 }]);
    expect((await stubMap(`${STUB_MAPS_DIR}f13_b3.dat`)).exitGrids.map((e) => e.sector)).toEqual([{ x: 13, y: 6, z: 0 }]);
    const cave = await kindMap('cave');
    const [down] = (await kindMap('mine')).exitGrids;
    const [up] = cave.exitGrids;
    expect(cave.rooms[down?.gridNo ?? 0]).not.toBe(0);
    expect(up && cave.exitGrids.length).toBe(1);
    expect(cave.ambient?.basement).toBe(true);
  });

  it('place every stub NPC whose home sector has a kind map on that map, and the head miners in every mine', async () => {
    const profiles = asArray(asObject(JSON.parse(await readFile(join(import.meta.dirname, 'profiles.json'), 'utf8')), 'p').profiles, 'p');
    for (const p of profiles) {
      const o = asObject(p, 'profile');
      if (o.sector === undefined) continue;
      const name = asString(o.sector, 'sector');
      const kind = kindOfSector(table, name);
      if (!kind) continue;
      expect(profilesPlaced(await kindMap(kind.map)), `${asInt(o.id, 'id')} in ${name}`).toContain(asInt(o.id, 'id'));
    }
    expect(profilesPlaced(await kindMap('mine'))).toEqual(expect.arrayContaining([106, 148, 156, 157, 158]));
    expect(profilesPlaced(await kindMap('airfield'))).toContain(97);
  });

  it('put the Alma captives into rooms of the prison map and keep the helipad of the airfield in the open', async () => {
    const prison = await kindMap(kindOfSector(table, 'I13')?.map ?? '');
    for (const g of ALMA_CAPTIVE_GRIDNOS) expect(prison.rooms[g], String(g)).not.toBe(0);
    expect(prison.doors.filter((d) => d.locked)).toHaveLength(3);
    const airfield = await kindMap(kindOfSector(table, 'B13')?.map ?? '');
    expect(airfield.rooms[CHOPPER_GRIDNO]).toBe(0);
    const pad = airfield.placements.find(
      (p) => p.basic.team === CIV_TEAM && p.detailedRaw && parseDetailedPlacement(p.detailedRaw).profile === 97,
    );
    const g = pad?.basic.startingGridNo ?? 0;
    const dx = (g % WORLD_COLS) - (CHOPPER_GRIDNO % WORLD_COLS);
    const dy = Math.trunc(g / WORLD_COLS) - Math.trunc(CHOPPER_GRIDNO / WORLD_COLS);
    expect(Math.hypot(dx, dy)).toBeLessThan(11);
    expect(sectorShortString(parseSectorName('B13'))).toBe('B13');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { type MapItem, parseMap } from '../../content/formats/map.ts';
import { decodeObject } from '../../content/formats/object.ts';
import { withGraphicFacts } from '../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../content/vfs/vfs.ts';
import { loadTacticalWorld } from '../../content/world/tactical-world.ts';
import type { ReadFile } from '../../content/world/tileset-loader.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import type { TacticalContent } from './content.ts';
import { loadTacticalContent } from './load-content.ts';
import { Profile, TERRORISTS } from './narrative/constants.ts';
import { progressFromProfile } from './profiles.ts';
import type { SectorRef, TacticalState } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';
import { loadWorldItemsFromMap } from './world-items.ts';

const OBJECT_OFFSET = 8;
const OWNERSHIP = 240;
const NOWHERE_YET: SectorRef = { x: 0, y: 0, z: 0 };
const PALACE: SectorRef = { x: 3, y: 16, z: 0 };
const PALACE_BASEMENT: SectorRef = { x: 3, y: 16, z: 1 };
const QUEENS_CRATE = 15099;
const QUEENS_ROCKET_RIFLE_SLOT = 7;

const TERRORIST_MAPS: readonly (readonly [string, SectorRef])[] = [
  ['maps/b2.dat', { x: 2, y: 2, z: 0 }],
  ['maps/c6.dat', { x: 6, y: 3, z: 0 }],
  ['maps/f9.dat', { x: 9, y: 6, z: 0 }],
  ['maps/g1.dat', { x: 1, y: 7, z: 0 }],
  ['maps/g8.dat', { x: 8, y: 7, z: 0 }],
  ['maps/i14.dat', { x: 14, y: 9, z: 0 }],
  ['maps/l11.dat', { x: 11, y: 12, z: 0 }],
];

interface Marker {
  readonly owner: number;
  readonly gridNo: number;
  readonly level: number;
}

function markersOf(items: readonly MapItem[]): Marker[] {
  return items.flatMap((record) => {
    const o = decodeObject(record.raw, OBJECT_OFFSET);
    return o.item === OWNERSHIP ? [{ owner: (o.status[0] ?? 0) & 0xff, gridNo: record.gridNo, level: record.level }] : [];
  });
}

describe.skipIf(!ORIGINAL_DATA_DIR)("the ownership markers of the original maps: absent terrorists' gear and the Queen's crate", () => {
  let data: DataVfs;
  let read: ReadFile;
  let content: TacticalContent;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));
    content = await loadTacticalContent(read);
  });
  afterAll(async () => {
    await data.close();
  });

  async function loaded(path: string, here: SectorRef | null, placed: ReadonlyMap<number, SectorRef>): Promise<TacticalState> {
    const world = await loadTacticalWorld(read, path);
    const t = new TacticalSim(world, content, 1).state;
    t.sector = here;
    for (const [id, at] of placed) {
      const profile = content.profiles[id];
      if (!profile) throw new Error(`no profile ${id}`);
      t.profiles.set(id, { ...progressFromProfile(profile), sectorX: at.x, sectorY: at.y, sectorZ: at.z });
    }
    loadWorldItemsFromMap(
      t,
      world.map.items.map((record) => ({ ...record, nonExistChance: 0 })),
    );
    return t;
  }

  const onTile = (t: TacticalState, m: Marker) =>
    t.worldItems.filter((wi) => wi.gridNo === m.gridNo && wi.level === m.level).map((wi) => wi.object.item);

  it("lays terrorists' markers in B2, C6, F9, G1, G8, I14 and L11 alone, and the Queen's in P3_B1 alone", async () => {
    const found: [string, number[]][] = [];
    for (const f of data.vfs.list()) {
      if (!/^maps\/[^/]+\.dat$/.test(f.path)) continue;
      const owners = markersOf(parseMap(await data.vfs.read(f.path)).items)
        .map((m) => m.owner)
        .filter((owner) => TERRORISTS.has(owner) || owner === Profile.QUEEN);
      if (owners.length > 0) found.push([f.path, [...new Set(owners)].sort((a, b) => a - b)]);
    }
    expect(found).toEqual([
      ['maps/b2.dat', [Profile.ANNIE, Profile.TIFFANY, Profile.T_REX]],
      ['maps/c6.dat', [Profile.ANNIE]],
      ['maps/f9.dat', [Profile.SLAY, Profile.CHRIS, Profile.T_REX]],
      ['maps/g1.dat', [Profile.SLAY, Profile.CHRIS, Profile.T_REX]],
      ['maps/g8.dat', [Profile.SLAY, Profile.ANNIE, Profile.CHRIS]],
      ['maps/i14.dat', [Profile.ANNIE, Profile.TIFFANY]],
      ['maps/l11.dat', [Profile.ANNIE, Profile.CHRIS]],
      ['maps/p3_b1.dat', [Profile.QUEEN]],
    ]);
  });

  it('takes the gear lying with the marker of every terrorist not placed in the sector, and keeps the gear of the one placed there', async () => {
    for (const [path, sector] of TERRORIST_MAPS) {
      const world = await loadTacticalWorld(read, path);
      const markers = markersOf(world.map.items).filter((m) => TERRORISTS.has(m.owner));
      const [kept, ...gone] = markers;
      if (!kept) throw new Error(`${path}: no terrorist marker`);
      const everyone = new Map([...TERRORISTS].map((id) => [id, NOWHERE_YET]));
      const unchecked = await loaded(path, null, everyone);
      const nobodyHere = await loaded(path, sector, everyone);
      const oneHere = await loaded(path, sector, new Map([...everyone, [kept.owner, sector]]));
      expect([path, markers.map((m) => onTile(nobodyHere, m).length)]).toEqual([path, markers.map(() => 0)]);
      expect([path, onTile(oneHere, kept)]).toEqual([path, onTile(unchecked, kept)]);
      expect([path, onTile(oneHere, kept).length > 1]).toEqual([path, true]);
      expect([path, gone.map((m) => onTile(oneHere, m))]).toEqual([path, gone.map(() => [])]);
      expect([path, oneHere.worldItems.length + gone.reduce((n, m) => n + onTile(unchecked, m).length, 0)]).toEqual([
        path,
        unchecked.worldItems.length,
      ]);
    }
  });

  it('hands the Queen who fled to P3_B1 the automatic rocket rifle for her rocket rifle and empties her crate, the rocket clips too; the crate stays full while she is in the palace', async () => {
    const crate: Marker = { owner: Profile.QUEEN, gridNo: QUEENS_CRATE, level: 0 };
    const id = (name: string) => content.items.byName.get(name)?.index;
    const fled = await loaded('maps/p3_b1.dat', PALACE_BASEMENT, new Map([[Profile.QUEEN, PALACE_BASEMENT]]));
    const queen = fled.profiles.get(Profile.QUEEN);
    expect(onTile(fled, crate)).toEqual([]);
    expect(queen?.inventory[QUEENS_ROCKET_RIFLE_SLOT]).toBe(id('AUTO_ROCKET_RIFLE'));
    expect(queen?.inventory.slice(0, 3)).toEqual([id('SPECTRA_HELMET_18'), id('SPECTRA_VEST_18'), id('SPECTRA_LEGGINGS_18')]);
    const home = await loaded('maps/p3_b1.dat', PALACE_BASEMENT, new Map([[Profile.QUEEN, PALACE]]));
    expect(onTile(home, crate).sort((a, b) => a - b)).toEqual(
      [
        'SPECTRA_VEST_18',
        'SPECTRA_LEGGINGS_18',
        'SPECTRA_HELMET_18',
        'OWNERSHIP',
        'AUTO_ROCKET_RIFLE',
        'CLIPROCKET_HEAT',
        'CLIPROCKET_HEAT',
        'CLIPROCKET_HEAT',
      ]
        .map((name) => id(name) ?? -1)
        .sort((a, b) => a - b),
    );
    expect(home.profiles.get(Profile.QUEEN)?.inventory[QUEENS_ROCKET_RIFLE_SLOT]).toBe(id('ROCKET_RIFLE'));
  });
});

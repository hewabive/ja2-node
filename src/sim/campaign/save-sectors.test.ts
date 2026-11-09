import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { BinaryWriter } from '../../content/binary/writer.ts';
import { calcSoldierCreateCheckSum, writeProfileDetailedPlacement } from '../../content/formats/placement.ts';
import {
  decodeRevealedStatusFile,
  MapModificationType,
  type SectorTempFile,
  type TempFileKind,
} from '../../content/formats/savegame-temp-files.ts';
import { withGraphicFacts } from '../../content/rules/graphic-facts.ts';
import { sectorId } from '../../content/strategic/sector-ids.ts';
import { vfsFileReader } from '../../content/vfs/vfs.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { createSaveSession } from '../../server/save-session.ts';
import { SectorFlag } from '../strategic/forces/constants.ts';
import { getSectorFlagStatus } from '../strategic/map/sectors.ts';
import { NO_PROFILE, Team } from '../tactical/soldier.ts';
import { teamMembers } from '../tactical/state.ts';
import { importSectorTempFiles } from './save-sectors.ts';
import { type SectorDiff, sectorKey } from './sector-diff.ts';

const A9 = { x: 9, y: 1, z: 0 };
const B13 = { x: 13, y: 2, z: 0 };
const C13 = { x: 13, y: 3, z: 0 };
const B11 = { x: 11, y: 2, z: 0 };
const ITEM_GRID = 12693;
const DOOR_GRID = 7305;
const CORPSE_GRID = 6624;
const CIV_TEAM = 4;
const REVEALED_GRID = 3201;
const CIVILIAN_INSERTION = 13673;
const SMOKE_GRID = 9000;
const SMOKE_OWNER = 17;
const DOOR_OPEN_AND_PERCEIVED = 0x03;
const TIMESTAMP = 2995;
const WORLD_ITEM_RECORD = 52;
const CORPSE_RECORD = 160;
const REVEALED_BYTES = 3200;

function worldItems(): Uint8Array {
  const w = new BinaryWriter().u32(2);
  for (const exists of [1, 0]) {
    const record = new Uint8Array(WORLD_ITEM_RECORD);
    const v = new DataView(record.buffer);
    v.setUint8(0, exists);
    v.setInt16(2, ITEM_GRID, true);
    v.setUint16(8, 219, true);
    v.setUint8(10, 1);
    v.setInt8(12, 100);
    v.setUint16(44, 0x200, true);
    v.setInt8(47, 1);
    w.bytes(record);
  }
  return w.toBytes();
}

function corpses(): Uint8Array {
  const record = new Uint8Array(CORPSE_RECORD);
  const v = new DataView(record.buffer);
  v.setUint8(0, 3);
  v.setInt16(2, CORPSE_GRID, true);
  v.setInt8(134, 2);
  v.setUint32(136, 1860, true);
  v.setUint16(140, 0x01, true);
  v.setUint8(145, NO_PROFILE);
  return new BinaryWriter().u32(1).bytes(record).toBytes();
}

function preservedCivilians(): Uint8Array {
  const raw = writeProfileDetailedPlacement({
    profile: NO_PROFILE,
    direction: 2,
    insertionGridNo: CIVILIAN_INSERTION,
    team: CIV_TEAM,
    attitude: 0,
    orders: 0,
    soldierClass: 0,
  });
  new DataView(raw.buffer).setInt16(6, B13.x, true);
  return new BinaryWriter()
    .i16(B13.y)
    .u8(1)
    .u8(0)
    .u8(116)
    .i16(B13.x)
    .i32(1)
    .u32(TIMESTAMP)
    .u8(B13.z)
    .bytes(raw)
    .u16(calcSoldierCreateCheckSum(raw))
    .u8(sectorId(B13))
    .toBytes();
}

function revealed(): Uint8Array {
  const bytes = new Uint8Array(REVEALED_BYTES);
  bytes[REVEALED_GRID >> 3] = 1 << (REVEALED_GRID & 7);
  return bytes;
}

const SECTOR_FILES: readonly (readonly [TempFileKind, Uint8Array])[] = [
  ['items', worldItems()],
  ['rottingCorpses', corpses()],
  ['mapModifications', new BinaryWriter().u16(DOOR_GRID).u16(1).u16(0).u8(MapModificationType.OPENABLE_STRUCT).u8(0).toBytes()],
  ['doorTable', new BinaryWriter().u8(1).i16(DOOR_GRID).u8(1).u8(0).u8(0).u8(3).u8(1).u8(0).u8(0).zeros(5).toBytes()],
  ['revealedStatus', revealed()],
  ['doorStatus', new BinaryWriter().u8(1).i16(DOOR_GRID).u8(DOOR_OPEN_AND_PERCEIVED).zeros(1).toBytes()],
  ['civilianPreserved', preservedCivilians()],
  [
    'smokeEffects',
    new BinaryWriter()
      .u32(2)
      .i16(SMOKE_GRID)
      .u8(5)
      .u8(3)
      .u8(0)
      .u8(2)
      .u8(1)
      .u8(2)
      .u16(0x123)
      .u8(SMOKE_OWNER)
      .zeros(1)
      .u32(4321)
      .zeros(16)
      .toBytes(),
  ],
  ['lightingEffects', new BinaryWriter().u32(1).i16(SMOKE_GRID).u8(6).u8(4).u8(1).u8(1).u8(0).zeros(5).u32(777).toBytes()],
];

function filesOf(sector: { readonly x: number; readonly y: number; readonly z: number }): SectorTempFile[] {
  return SECTOR_FILES.map(([kind, bytes]) => ({ sector, kind, bytes }));
}

function imported(worldLoaded: boolean): Map<string, SectorDiff> {
  const diffs = new Map<string, SectorDiff>();
  const tempFiles = [...filesOf(A9).filter((f) => f.kind === 'items'), ...filesOf(B13)];
  importSectorTempFiles(diffs, { header: { worldLoaded }, tactical: { worldSector: A9 }, tempFiles });
  return diffs;
}

describe('the temp files of the sectors a native save did not load', () => {
  it("turns each sector's files into its sector diff, the map changes and revealed tiles kept as the native records for the first entry", () => {
    const diffs = imported(true);
    expect([...diffs.keys()]).toEqual([sectorKey(B13)]);
    const diff = diffs.get(sectorKey(B13));
    if (!diff) throw new Error('no diff');
    expect(
      diff.items?.map((wi) => [wi.exists, wi.gridNo, wi.object.item, wi.object.count, wi.object.status[0], wi.flags, wi.visible]),
    ).toEqual([
      [true, ITEM_GRID, 219, 1, 100, 0x200, 1],
      [false, ITEM_GRID, 219, 1, 100, 0x200, 1],
    ]);
    expect(diff.corpses?.map((c) => [c.type, c.gridNo, c.direction, c.timeOfDeath, c.findSweetSpot, c.profile])).toEqual([
      [3, CORPSE_GRID, 2, 1860, true, NO_PROFILE],
    ]);
    expect([diff.mapChanges, diff.savedMapModifications?.map((m) => [m.type, m.gridNo, m.imageType])]).toEqual([
      null,
      [[MapModificationType.OPENABLE_STRUCT, DOOR_GRID, 1]],
    ]);
    expect(diff.doorTable?.map((d) => [d.gridNo, d.locked, d.lockId, d.perceivedLocked])).toEqual([[DOOR_GRID, true, 3, 1]]);
    const revealedTiles = decodeRevealedStatusFile(diff.savedRevealed ?? new Uint8Array(REVEALED_BYTES));
    expect([diff.revealed, diff.savedRevealed?.length, revealedTiles.indexOf(1), revealedTiles.lastIndexOf(1)]).toEqual([
      null,
      REVEALED_BYTES,
      REVEALED_GRID,
      REVEALED_GRID,
    ]);
    expect(diff.doorStatus).toEqual([{ gridNo: DOOR_GRID, open: true, perceivedOpen: true, perceivedNotSet: false, hasTinCan: false }]);
    expect(diff.enemies).toBeNull();
    expect([diff.civilians?.savedMinute, diff.civilians?.links, diff.civilians?.records.map((r) => [r.team, r.insertionGridNo])]).toEqual([
      TIMESTAMP,
      [[0, 116]],
      [[CIV_TEAM, CIVILIAN_INSERTION]],
    ]);
    expect(diff.smoke).toEqual([
      { gridNo: SMOKE_GRID, item: 0x123, type: 2, ownerId: SMOKE_OWNER, duration: 5, radius: 3, age: 2, flags: 0, lastUpdate: 4321 },
    ]);
    expect(diff.lights).toEqual([{ gridNo: SMOKE_GRID, radius: 4, duration: 6, age: 1, lastUpdate: 777 }]);
  });

  it("takes the files of the save's sector too when the save has no world loaded (SaveLoadGame.cc:1016)", () => {
    expect([...imported(false).keys()]).toEqual([sectorKey(A9), sectorKey(B13)]);
  });
});

const dataDir = ORIGINAL_DATA_DIR;
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const saveAt = (name: string) => join(gameRoot, 'SavedGames', `${name}.sav`);
const haveSaves = ['SaveGame03', 'SaveGame09'].every((name) => dataDir && existsSync(saveAt(name)));

describe.skipIf(!ORIGINAL_DATA_DIR || !haveSaves)('the other sectors of the native saves', () => {
  let data: DataVfs;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));
  const exists = (path: string) => data.vfs.stat(path) !== undefined;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  });
  afterAll(async () => {
    await data.close();
  });

  async function importAndEnter(name: string, sector: { readonly x: number; readonly y: number; readonly z: number }) {
    const { session } = await createSaveSession(read, new Uint8Array(readFileSync(saveAt(name))), undefined, exists);
    const c = session.campaign;
    const diff = c.state.sectorDiffs.get(sectorKey(sector));
    if (!diff) throw new Error(`no diff of ${sectorKey(sector)}`);
    const before = structuredClone(diff);
    await session.prepare({ type: 'enterSector', sector: `${String.fromCharCode(64 + sector.y)}${sector.x}` });
    expect(c.sectors?.setCurrentWorldSector(sector)).toBe(true);
    const t = c.tactical?.state;
    if (!t) throw new Error('no sector');
    return { c, t, before, diff };
  }

  it('enters C13 of SaveGame09 with its 17 items, 5 corpses, 24 preserved civilians and the crates of its openable records, its records spent', async () => {
    const { c, t, before, diff } = await importAndEnter('SaveGame09', C13);
    const objects = (items: readonly { readonly object: { readonly item: number; readonly count: number } }[]) =>
      items.map((wi) => [wi.object.item, wi.object.count]).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0));
    expect(t.worldItems).toHaveLength(17);
    expect(objects(t.worldItems)).toEqual(objects((before.items ?? []).filter((wi) => wi.exists)));
    expect(t.corpses).toHaveLength(5);
    const records = before.civilians?.records ?? [];
    const civilians = teamMembers(t, Team.CIV).filter((s) => s.profile === NO_PROFILE);
    const bodies = (list: readonly { readonly bodyType: number }[]) => list.map((x) => x.bodyType).sort((a, b) => a - b);
    expect([records.length, civilians.length]).toEqual([24, 24]);
    expect(bodies(civilians)).toEqual(bodies(records));
    const openables = (before.savedMapModifications ?? []).filter((m) => m.type === MapModificationType.OPENABLE_STRUCT);
    expect(openables.length).toBeGreaterThan(0);
    for (const m of openables) {
      const openable = t.world.structures.find(m.gridNo, StructureFlags.OPENABLE);
      if (openable) expect([m.gridNo, has(openable.flags, StructureFlags.OPEN)]).toEqual([m.gridNo, m.imageType !== 0]);
    }
    expect([diff.savedMapModifications, diff.savedRevealed]).toEqual([undefined, undefined]);
    expect(getSectorFlagStatus(c.state.map, C13, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS)).toBe(false);
  });

  it('enters B11 of SaveGame09 with no item: its file counts none ahead of a live record, which the load never reads (Tactical_Save.cc:217)', async () => {
    const { t, before } = await importAndEnter('SaveGame09', B11);
    expect([before.items, t.worldItems]).toEqual([[], []]);
  });

  it('keeps every sector of SaveGame03, saved with no world, B13 with its 10 items, 5 corpses and 6 preserved civilians', async () => {
    const { session } = await createSaveSession(read, new Uint8Array(readFileSync(saveAt('SaveGame03'))), undefined, exists);
    const diff = session.campaign.state.sectorDiffs.get(sectorKey(B13));
    expect([diff?.items?.filter((wi) => wi.exists).length, diff?.corpses?.length, diff?.civilians?.records.length]).toEqual([10, 5, 6]);
  });
});

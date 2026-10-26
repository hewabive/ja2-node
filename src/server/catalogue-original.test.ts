import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { PROFILES_PATH, parseProfiles } from '../content/formats/prof.ts';
import { loadItemTable } from '../content/items/items.ts';
import {
  loadProfilePresentationTables,
  type ProfilePresentationTables,
  profileFaceRecord,
  profilePresentation,
} from '../content/narrative/profile-presentation.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { detectDataVersion } from './data-version.ts';
import { buildItemCatalogue } from './item-catalogue.ts';
import { TextService } from './text-service.ts';

const IVAN = 7;
const MIGUEL = 57;
const HERVE = 151;
const CARLO = 154;
const GLOCK_17 = 1;

describe.skipIf(!ORIGINAL_DATA_DIR)('the profile and item catalogues on the original data', () => {
  let data: DataVfs;
  let tables: ProfilePresentationTables;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    tables = await loadProfilePresentationTables(vfsFileReader(data.vfs));
  });
  afterAll(async () => {
    await data.close();
  });

  it("reads the faces of prof.dat, the RPC small faces and the bio rows; Herve's portrait is shared", async () => {
    const bytes = await vfsFileReader(data.vfs)(PROFILES_PATH);
    if (!bytes) throw new Error('no prof.dat');
    const profiles = parseProfiles(bytes);
    const presentation = (id: number) => {
      const p = profiles[id];
      if (!p) throw new Error(`no profile ${id}`);
      return profilePresentation(profileFaceRecord(p), tables);
    };
    const ivan = presentation(IVAN);
    expect(ivan).toMatchObject({ id: IVAN, nickname: 'Ivan', aimBio: IVAN, mercBio: null, smallFace: null });
    expect(ivan.faceIndex).toBeGreaterThan(0);
    expect(ivan.eyes.some((v) => v > 0)).toBe(true);
    expect(ivan.blinkFrequency).toBeGreaterThan(0);
    expect(presentation(MIGUEL).smallFace).toEqual({ eyes: [9, 8], mouth: [8, 24] });
    expect(presentation(CARLO).faceIndex).toBe(presentation(HERVE).faceIndex);
  });

  it('names every item in the data version and prints the stats', async () => {
    const vfs = data.vfs;
    const items = await loadItemTable(async (path) => {
      const bytes = await vfsFileReader(vfs)(path);
      if (!bytes) throw new Error(`missing ${path}`);
      return JSON.parse(new TextDecoder().decode(bytes));
    });
    const texts = new TextService({ vfs, dataVersion: detectDataVersion(vfs, true, {}).version });
    const { catalogue } = await buildItemCatalogue(items, texts, 'eng');
    const glock = catalogue.items.find((i) => i.index === GLOCK_17);
    expect(glock).toMatchObject({ shortName: 'Glock 17', class: 'GUN', weapon: { calibre: { name: '9mm' } } });
    expect(glock?.bobbyRayName.length).toBeGreaterThan(0);
    expect(catalogue.items.filter((i) => i.index > 0 && i.shortName === '')).toEqual([]);
  });
});

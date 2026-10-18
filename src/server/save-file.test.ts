import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { SimSnapshot } from '../sim/snapshot/session.ts';
import {
  clampDescription,
  EMPTY_PRESENTATION,
  encodeSaveFile,
  inflateSave,
  MAX_DESCRIPTION_CHARS,
  migrateSaveFile,
  parseSaveText,
  readSaveHead,
  SAVE_FORMAT,
  SAVE_VERSION,
  type SaveFile,
  SaveFileError,
  type SaveHeader,
} from './save-file.ts';

const HEAD_PREFIX_BYTES = 800;

function noise(length: number): string {
  let x = 12_345;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1_103_515_245) + 12_345) >>> 0;
    out += (x >>> 24).toString(16);
  }
  return out;
}

const HEADER: SaveHeader = {
  kind: 'quick',
  description: 'QuickSave',
  savedAt: '2026-10-18T12:00:00.000Z',
  engine: { version: '0.0.0', commit: 'abc' },
  content: { source: 'stubs', dataVersion: 'stubs', logic: 'logic-hash', text: 'none' },
  options: { difficulty: 2, sciFi: true, gunNut: false, saveMode: 'anywhere' },
  world: { day: 1, hour: 7, minute: 30 },
  sector: 'A9',
  flow: 'tactical',
  mercs: 4,
  balance: 12_345,
  campaign: 'playing',
  session: 'campaign',
  tick: 900,
};

const SIM = {
  format: 'ja2-node-snapshot',
  version: 1,
  kind: 'campaign',
  mapPath: null,
  graph: { externals: [], sections: [['rng', { $rng: [1, 2, 3, 4] }]], filler: noise(40_000) },
} as unknown as SimSnapshot;

function saveFile(version = SAVE_VERSION): SaveFile {
  return {
    format: SAVE_FORMAT,
    version,
    header: HEADER,
    session: { kind: 'campaign', origin: 'new campaign seed 1', tick: 900, preparedMaps: ['stubs/world/maps/a9.dat'] },
    contentFiles: [
      ['binarydata/prof.dat', 'f'],
      ['npcdata/000.npc', 'm'],
    ],
    sim: SIM,
    presentation: EMPTY_PRESENTATION,
  };
}

function problemOf(work: () => unknown): string {
  try {
    work();
  } catch (err) {
    if (err instanceof SaveFileError) return err.problem;
    throw err;
  }
  return 'none';
}

describe('save files', () => {
  it('round-trip as one JSON document whose header sits in the first gzip member', () => {
    const encoded = encodeSaveFile(saveFile());
    const { text, digest } = inflateSave(encoded.bytes);
    expect(digest).toBe(encoded.digest);
    expect(JSON.parse(text)).toEqual(saveFile());
    expect(Object.keys(JSON.parse(text))).toEqual(['format', 'version', 'header', 'session', 'contentFiles', 'sim', 'presentation']);
    expect(parseSaveText(text)).toEqual(saveFile());
    expect(encoded.bytes.length).toBeGreaterThan(HEAD_PREFIX_BYTES * 10);
    expect(readSaveHead(encoded.bytes.subarray(0, HEAD_PREFIX_BYTES))).toEqual({
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      header: HEADER,
    });
  });

  it('reads the header of a file that was gzipped again as one member', () => {
    const regzipped = gzipSync(gunzipSync(encodeSaveFile(saveFile()).bytes));
    expect(readSaveHead(regzipped.subarray(0, 4096)).header).toEqual(HEADER);
  });

  it('migrates older versions through the chain and refuses newer ones', () => {
    const v1 = JSON.parse(inflateSave(encodeSaveFile(saveFile(1)).bytes).text);
    const migrated = migrateSaveFile(v1, {
      current: 3,
      migrations: {
        1: (file) => ({ ...file, presentation: { music: { mode: 'battle', previous: 'none' } } }),
        2: (file) => ({ ...file, header: { ...(file.header as SaveHeader), description: 'migrated' } }),
      },
    });
    expect(migrated.version).toBe(3);
    expect(migrated.presentation.music.mode).toBe('battle');
    expect(migrated.header.description).toBe('migrated');
    expect(migrateSaveFile(v1)).toEqual(saveFile(1));
    expect(problemOf(() => migrateSaveFile(v1, { current: 2, migrations: {} }))).toBe('noMigration');
    expect(problemOf(() => migrateSaveFile({ ...v1, version: SAVE_VERSION + 1 }))).toBe('versionTooNew');
    expect(problemOf(() => readSaveHead(encodeSaveFile(saveFile(SAVE_VERSION + 1)).bytes))).toBe('none');
  });

  it('refuses what is not a ja2-node save', () => {
    expect(problemOf(() => readSaveHead(new TextEncoder().encode('{"format":"ja2-node-save"}')))).toBe('notASave');
    expect(problemOf(() => readSaveHead(gzipSync(Buffer.from('{"format":"other","version":1,"header":{},\n}'))))).toBe('notASave');
    expect(problemOf(() => parseSaveText('{"format":"ja2-node-save","version":1,"header":{}}'))).toBe('corrupt');
    expect(problemOf(() => parseSaveText('not json'))).toBe('corrupt');
    expect(problemOf(() => inflateSave(new Uint8Array([1, 2, 3])))).toBe('notASave');
  });

  it('keeps descriptions on one line and within the original 46 characters', () => {
    expect(clampDescription('  before\nthe bridge  ')).toBe('before the bridge');
    expect([...clampDescription('é'.repeat(60))]).toHaveLength(MAX_DESCRIPTION_CHARS);
  });
});

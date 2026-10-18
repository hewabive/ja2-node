import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BATTLE_SOUNDS_PATH,
  battleSoundPath,
  genericVoiceSets,
  parseBattleSounds,
  voiceSetKinds,
} from '../src/content/audio/sound-table.ts';
import { ambientSoundPath, ambientTablePath, parseAmbientTable } from '../src/content/formats/ambient.ts';
import { DIALOGUE_SIZE, edtRowCount } from '../src/content/formats/edt.ts';
import { gapPathFor, parseGap } from '../src/content/formats/gap.ts';
import { decodeSti } from '../src/content/formats/sti.ts';
import { decodeWav, wavDurationMs } from '../src/content/formats/wav.ts';
import { parseStubSpriteManifest, pictureFromStubSprite, STUB_SPRITE_SUFFIX } from '../src/content/picture/stub-sprite.ts';
import { STUB_DATA_VERSION } from '../src/content/text/data-version.ts';
import { glyphCount, parseGlyphTable } from '../src/content/text/glyph-table.ts';
import { type DataVfs, openDataVfs, STUBS_PREFIX } from '../src/node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import { TextService } from '../src/server/text-service.ts';
import { STUB_AMBIENT_ENTRIES, STUB_AMBIENT_ID } from './ambient.ts';
import { stubSoundPaths } from './audio.ts';
import { buildStubs } from './build.ts';
import { STUB_FONT_FACES, STUB_GLYPH_TABLE_PATH } from './fonts.ts';
import { musicTracks } from './music.ts';
import { npcSpeechSets, type SpeechSet, speechPaths } from './speech.ts';

const MEDIA_DIRS = ['synth', 'music', 'mercedt', 'fonts'];
const TEXT_FILES = [
  'binarydata/itemdesc.edt',
  'binarydata/credits.edt',
  'binarydata/email.edt',
  'ambient/0.bad',
  STUB_GLYPH_TABLE_PATH,
  'aliases.json',
];
const MEDIA_BUDGET_BYTES = 4 * 1024 * 1024;
const STUB_BUILD_TIMEOUT_MS = 60_000;

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function build(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ja2-stubs-'));
  dirs.push(dir);
  await buildStubs(dir);
  return dir;
}

async function filesUnder(root: string, sub: string): Promise<string[]> {
  const entries = await readdir(join(root, sub), { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(root, join(e.parentPath, e.name)))
    .sort();
}

async function mediaFiles(root: string): Promise<string[]> {
  return [...(await Promise.all(MEDIA_DIRS.map((d) => filesUnder(root, d)))).flat(), ...TEXT_FILES];
}

describe('stub pack', { timeout: STUB_BUILD_TIMEOUT_MS }, () => {
  it('builds deterministically', async () => {
    const [a, b] = await Promise.all([build(), build()]);
    for (const f of ['soldier/capsule.png', 'soldier/capsule.sprite.json', 'tiles/ground.png', ...(await mediaFiles(a))]) {
      expect((await readFile(join(a, f))).equals(await readFile(join(b, f))), f).toBe(true);
    }
  });

  it('loads through the VFS into pictures', async () => {
    const dir = await build();
    const data = await openDataVfs({ stubsDir: dir });
    try {
      const manifests = data.vfs.list().filter((f) => f.path.endsWith(STUB_SPRITE_SUFFIX));
      expect(manifests.map((f) => f.path)).toContain(`${STUBS_PREFIX}/soldier/capsule${STUB_SPRITE_SUFFIX}`);
      for (const f of manifests) {
        const manifest = parseStubSpriteManifest(JSON.parse(new TextDecoder().decode(await data.vfs.read(f.path))));
        const png = await data.vfs.read(f.path.replace(/[^/]+$/, manifest.image));
        const pic = pictureFromStubSprite(manifest, png);
        expect(pic.frames.length).toBe(manifest.frames.length);
        expect(pic.frames.every((fr) => fr.pixels.some((p) => p !== 0))).toBe(true);
      }
      const soldier = data.vfs.stat('stubs/soldier/capsule.sprite.json');
      expect(soldier?.layer).toBe('stubs');
    } finally {
      await data.close();
    }
  });
});

describe('stub media', { timeout: STUB_BUILD_TIMEOUT_MS }, () => {
  let dir: string;
  let data: DataVfs;
  const stub = (path: string) => `${STUBS_PREFIX}/${path}`;

  beforeAll(async () => {
    dir = await build();
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, stubsDir: dir });
  }, STUB_BUILD_TIMEOUT_MS);
  afterAll(async () => {
    await data.close();
  });

  async function battleVoicePaths(): Promise<string[]> {
    const table = parseBattleSounds(JSON.parse(await readFile(join(PROJECT_DATA_DIR, BATTLE_SOUNDS_PATH), 'utf8')));
    return genericVoiceSets().flatMap((set) => voiceSetKinds(table, set).map((kind) => battleSoundPath(table, set.basename, kind.file)));
  }

  it('resolves every sound and music name of the tables under its original path and decodes it', async () => {
    const sounds = await stubSoundPaths();
    const voices = await battleVoicePaths();
    const music = (await musicTracks()).map((t) => t.path);
    expect([sounds.length, voices.length, music.length]).toEqual([343, 90, 14]);
    const formats = new Set<string>();
    for (const path of [...sounds, ...voices, ...music]) {
      expect(data.vfs.stat(stub(path)), path).toBeDefined();
      const audio = decodeWav(await data.vfs.read(stub(path)));
      expect(audio.frameCount, path).toBeGreaterThan(0);
      expect(
        audio.channels.every((c) => c.some((v) => v !== 0)),
        path,
      ).toBe(true);
      formats.add(`${audio.info.encoding} ${audio.info.bitsPerSample}-bit ${audio.info.channelCount}ch ${audio.sampleRate}`);
    }
    expect([...formats].sort()).toEqual([
      'imaAdpcm 4-bit 1ch 11025',
      'pcm 16-bit 1ch 22050',
      'pcm 16-bit 2ch 22050',
      'pcm 8-bit 1ch 11025',
    ]);
  });

  it('gives every stub merc and NPC quote a speech blip and a lip-sync file inside it', async () => {
    const merc = data.vfs
      .list()
      .filter((f) => /^stubs\/mercedt\/\d{3}\.edt$/.test(f.path))
      .map((f): SpeechSet => ({ profile: Number(f.path.slice(-7, -4)), family: 'merc', quotes: f.size / (DIALOGUE_SIZE * 2) }));
    expect(merc.map((s) => s.profile)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 42, 59, 65]);
    const sets = [...merc, ...(await npcSpeechSets())];
    for (const set of sets) {
      const paths = speechPaths(set);
      expect(paths).toHaveLength(set.quotes);
      const [first] = paths;
      if (!first) throw new Error(`no quotes for ${set.profile}`);
      const audio = decodeWav(await data.vfs.read(stub(first)));
      expect(audio.info.encoding).toBe('imaAdpcm');
      const gaps = parseGap(await data.vfs.read(stub(gapPathFor(first))));
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps.every((g, i) => g.start < g.end && g.end < wavDurationMs(audio.info) && g.start > (gaps[i - 1]?.end ?? 0))).toBe(true);
      for (const path of paths) {
        expect(data.vfs.stat(stub(path))?.size, path).toBe(data.vfs.stat(stub(first))?.size);
        expect(data.vfs.stat(stub(gapPathFor(path))), path).toBeDefined();
      }
    }
    expect(data.vfs.stat(stub('speech/000_108.wav'))).toBeDefined();
    expect(data.vfs.stat(stub('npc_speech/094_000.gap'))).toBeDefined();
  });

  it('serves merc dialogue, item text, credits and mails through the text service', async () => {
    const texts = new TextService({ vfs: data.vfs, dataVersion: STUB_DATA_VERSION });
    const greeting = await texts.edtRecord('mercedt/000.edt', 108);
    expect(greeting.ok && greeting.record.columns).toEqual(["Kestrel. Make it quick, I'm cleaning my rifle."]);
    const answering = await texts.edtRecord('mercedt/001.edt', 84);
    expect(answering.ok && answering.record.columns[0]).toContain('Vant here');
    const pistol = await texts.edtRecord('binarydata/itemdesc.edt', 1);
    expect(pistol.ok && pistol.record.columns.slice(0, 2)).toEqual(['Service pistol', 'Pistol']);
    const unused = await texts.edtRecord('binarydata/itemdesc.edt', 2);
    expect(unused.ok && unused.record.columns[0]).toBe('Machine pistol');
    const credits = await texts.edtRecord('binarydata/credits.edt', 2);
    expect(credits.ok && credits.record.columns[0]).toBe('@T,{;ja2-node');
    const subject = await texts.edtRecord('binarydata/email.edt', 138);
    expect(subject.ok && subject.record.columns[0]).toBe('The job');
    const imp = await texts.edtRecord('binarydata/email.edt', 0);
    expect(imp.ok && imp.record.columns[0]).toBe('Build your own mercenary');
    const mercFile = await data.vfs.read(stub('mercedt/042.edt'));
    expect(edtRowCount(mercFile)).toBe(117);
    const original = new TextService({ vfs: data.vfs, dataVersion: 'english' });
    expect((await original.edtRecord('mercedt/000.edt', 108)).ok).toBe(false);
  });

  it('decodes the stub ambient table of the stub tileset and resolves each of its sounds', async () => {
    const table = parseAmbientTable(await data.vfs.read(stub(ambientTablePath(STUB_AMBIENT_ID))));
    expect(table).toEqual(STUB_AMBIENT_ENTRIES);
    for (const entry of table) {
      const audio = decodeWav(await data.vfs.read(stub(ambientSoundPath(entry))));
      expect(audio.frameCount, entry.file).toBeGreaterThan(0);
    }
  });

  it('decodes every stub font under each original font name with one glyph per slot of the stub glyph table', async () => {
    const table = parseGlyphTable(JSON.parse(new TextDecoder().decode(await data.vfs.read(stub(STUB_GLYPH_TABLE_PATH)))));
    const names = STUB_FONT_FACES.flatMap((face) => face.names);
    expect(names).toHaveLength(17);
    for (const name of names) {
      const font = decodeSti(await data.vfs.read(stub(`fonts/${name}.sti`)));
      expect(font.kind, name).toBe('indexed');
      if (font.kind !== 'indexed') continue;
      expect(font.subImages, name).toHaveLength(glyphCount(table));
      expect(new Set(font.subImages.map((g) => g.height)).size, name).toBe(1);
    }
  });

  it('keeps the media small', async () => {
    let total = 0;
    for (const f of await mediaFiles(dir)) total += (await stat(join(dir, f))).size;
    expect(total).toBeLessThan(MEDIA_BUDGET_BYTES);
  });
});

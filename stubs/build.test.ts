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
import { parseTilesetDatabase } from '../src/content/formats/ja2set.ts';
import { parseStructureFile } from '../src/content/formats/jsd.ts';
import { parseMap } from '../src/content/formats/map.ts';
import { decodePcx } from '../src/content/formats/pcx.ts';
import { createFrameReader, decodeAudio, openSmk } from '../src/content/formats/smk.ts';
import { decodeSti } from '../src/content/formats/sti.ts';
import { loadStubProfiles } from '../src/content/formats/stub-profiles.ts';
import { decodeWav, wavDurationMs } from '../src/content/formats/wav.ts';
import { parseStubSpriteManifest, pictureFromStubSprite, STUB_SPRITE_SUFFIX } from '../src/content/picture/stub-sprite.ts';
import { STUB_DATA_VERSION } from '../src/content/text/data-version.ts';
import { glyphCount, parseGlyphTable } from '../src/content/text/glyph-table.ts';
import { parseVfsAliases, VFS_ALIASES_FILE } from '../src/content/vfs/aliases.ts';
import { parseTileTables } from '../src/content/world/tile-tables.ts';
import { type DataVfs, openDataVfs, STUBS_PREFIX } from '../src/node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import { TextService } from '../src/server/text-service.ts';
import { cursorFilePaths, cursorFramesUsed } from '../src/ui/cursors/cursor-table.ts';
import { GENERIC_FACE, GENERIC_FACE_BODY_TYPES, genericFacePath } from '../src/ui/screens/tactical/generic-face.ts';
import { STUB_AMBIENT_ENTRIES, STUB_AMBIENT_ID } from './ambient.ts';
import { stubSoundPaths } from './audio.ts';
import { buildStubs } from './build.ts';
import { STUB_FONT_FACES, STUB_GLYPH_TABLE_PATH } from './fonts.ts';
import { musicTracks } from './music.ts';
import { loadSectorKinds, sectorMapFile } from './sector-kinds.ts';
import { npcSpeechSets, type SpeechSet, speechPaths } from './speech.ts';
import { STUB_TILE_SURFACES } from './tiles.ts';
import { ANIMATED_STUB_CURSORS, loadCursorTable } from './ui/cursors.ts';
import {
  bigTalkingFacePath,
  EYES_HEIGHT,
  EYES_WIDTH,
  FACE_HEIGHT,
  FACE_WIDTH,
  genericBigFacePath,
  MOUTH_HEIGHT,
  MOUTH_WIDTH,
  smallFacePath,
  talkingFaceSize,
} from './ui/faces.ts';
import { BIG_ITEM_DIR, ITEM_OUTLINE_INDEX, smallSheetPlans, stubItemTable } from './ui/items.ts';
import { RADAR_MAP_HEIGHT, RADAR_MAP_WIDTH, radarMapPath, STUB_MAPS_DIR } from './ui/radar.ts';
import { planStubSkin, readOriginalLayouts } from './ui/skin.ts';
import { OUTLINE_INDEX, TEST_CARD_PATH, TEST_CARD_RGB_PATH } from './ui-test-card.ts';
import {
  STUB_SPLASH_FRAMES,
  STUB_SPLASH_HEIGHT,
  STUB_SPLASH_PATH,
  STUB_SPLASH_SAMPLE_RATE,
  STUB_SPLASH_WIDTH,
  stubSplashAudio,
  stubSplashFrames,
} from './video.ts';

const MEDIA_DIRS = ['synth', 'music', 'mercedt', 'intro', 'fonts', 'cursors', 'interface', 'laptop'];
const SPLASH_BUDGET_BYTES = 64 * 1024;
const CONTENT_DIRS = ['world', 'npcdata', 'binarydata'];
const STUB_PROFILE_FILE = 'profiles.json';
const TEXT_FILES = [
  'binarydata/itemdesc.edt',
  'binarydata/credits.edt',
  'binarydata/email.edt',
  'ambient/0.bad',
  STUB_GLYPH_TABLE_PATH,
  'aliases.json',
];
const MEDIA_BUDGET_BYTES = 5 * 1024 * 1024;
const EYE_FRAMES = 4;
const MOUTH_FRAMES = 3;
const MIN_LIP_GAPS = 2;
const MAX_LIP_GAPS = 4;
const BIG_PICTURE_AREA = { width: 117, height: 55 } as const;

interface Crop {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

function crop(frame: Crop, x: number, y: number, width: number, height: number): string {
  const rows: number[] = [];
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) rows.push(frame.pixels[(y + j) * frame.width + x + i] ?? 0);
  return rows.join(',');
}

function pixelsOf(frame: Crop): string {
  return crop(frame, 0, 0, frame.width, frame.height);
}
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
    const content = (await Promise.all(CONTENT_DIRS.map((d) => filesUnder(a, d)))).flat();
    for (const f of [
      'soldier/capsule.png',
      'soldier/capsule.sprite.json',
      'tiles/ground.png',
      STUB_PROFILE_FILE,
      ...content,
      ...(await mediaFiles(a)),
    ]) {
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
      expect(gaps.length).toBeGreaterThanOrEqual(MIN_LIP_GAPS);
      expect(gaps.length).toBeLessThanOrEqual(MAX_LIP_GAPS);
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

  it('round-trips the stub splash video: title card frames, palette and tone', async () => {
    const file = data.vfs.stat(stub(STUB_SPLASH_PATH));
    expect(file?.size).toBeLessThan(SPLASH_BUDGET_BYTES);
    const video = openSmk(await data.vfs.read(stub(STUB_SPLASH_PATH)));
    expect([video.width, video.height, video.frameCount]).toEqual([STUB_SPLASH_WIDTH, STUB_SPLASH_HEIGHT, STUB_SPLASH_FRAMES]);
    expect(video.audioTracks).toEqual([
      { track: 0, sampleRate: STUB_SPLASH_SAMPLE_RATE, channels: 2, bitsPerSample: 16, compressed: true },
    ]);
    const source = stubSplashFrames();
    const reader = createFrameReader(video);
    for (let frame = reader.nextFrame(); frame; frame = reader.nextFrame()) {
      const expected = source[frame.index];
      expect(
        frame.indices.every((v, i) => v === expected?.indices[i]),
        `frame ${frame.index}`,
      ).toBe(true);
      expect(frame.paletteChanged).toBe(expected?.palette !== undefined);
      if (expected?.palette) expect(frame.palette).toEqual(expected.palette);
    }
    const [track] = video.audioTracks;
    if (!track) throw new Error('the stub splash has no audio');
    expect(decodeAudio(video, track)).toEqual(stubSplashAudio().channels);
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

  it('decodes the UI test card: two indexed frames, one with an outline of index 254, and an RGB565 picture', async () => {
    const card = decodeSti(await data.vfs.read(stub(TEST_CARD_PATH)));
    expect(card.kind).toBe('indexed');
    if (card.kind !== 'indexed') return;
    expect(card.subImages).toHaveLength(2);
    expect(card.subImages[1]?.pixels.includes(OUTLINE_INDEX)).toBe(true);
    expect(card.subImages[0]?.pixels.includes(OUTLINE_INDEX)).toBe(false);
    const rgb = decodeSti(await data.vfs.read(stub(TEST_CARD_RGB_PATH)));
    expect(rgb.kind).toBe('rgb');
  });

  it('decodes the generic stub faces: the face, four eye and three mouth frames at the generic offsets, aliased by every stub profile', async () => {
    const faces: string[] = [];
    for (let body = 0; body < GENERIC_FACE_BODY_TYPES; body++) {
      const sti = decodeSti(await data.vfs.read(stub(genericFacePath(body))));
      if (sti.kind !== 'indexed') throw new Error(`${genericFacePath(body)} is not indexed`);
      expect(sti.subImages.map((f) => [f.width, f.height])).toEqual([
        [FACE_WIDTH, FACE_HEIGHT],
        ...Array.from({ length: EYE_FRAMES }, () => [EYES_WIDTH, EYES_HEIGHT]),
        ...Array.from({ length: MOUTH_FRAMES }, () => [MOUTH_WIDTH, MOUTH_HEIGHT]),
      ]);
      const [face, ...patches] = sti.subImages;
      if (!face) throw new Error('no face frame');
      expect(face.pixels.includes(0)).toBe(false);
      expect(sti.subImages.some((f) => f.pixels.includes(ITEM_OUTLINE_INDEX))).toBe(false);
      const [eyesX, eyesY] = GENERIC_FACE.eyes;
      const [mouthX, mouthY] = GENERIC_FACE.mouth;
      const eyes = [crop(face, eyesX, eyesY, EYES_WIDTH, EYES_HEIGHT), ...patches.slice(0, EYE_FRAMES).map(pixelsOf)];
      const mouths = [crop(face, mouthX, mouthY, MOUTH_WIDTH, MOUTH_HEIGHT), ...patches.slice(EYE_FRAMES).map(pixelsOf)];
      expect(new Set(eyes).size).toBe(1 + EYE_FRAMES);
      expect(new Set(mouths).size).toBe(1 + MOUTH_FRAMES);
      faces.push(pixelsOf(face));
    }
    expect(new Set(faces).size).toBe(GENERIC_FACE_BODY_TYPES);
    expect(GENERIC_FACE.blinkFrequency).toBeGreaterThan(0);
    const talking = await talkingFaceSize();
    for (let body = 0; body < GENERIC_FACE_BODY_TYPES; body++) {
      const sti = decodeSti(await data.vfs.read(stub(genericBigFacePath(body))));
      if (sti.kind !== 'indexed') throw new Error(`${genericBigFacePath(body)} is not indexed`);
      expect(sti.subImages.map((f) => [f.width, f.height])).toEqual([
        [talking.width, talking.height],
        ...Array.from({ length: EYE_FRAMES }, () => [EYES_WIDTH, EYES_HEIGHT]),
        ...Array.from({ length: MOUTH_FRAMES }, () => [MOUTH_WIDTH, MOUTH_HEIGHT]),
      ]);
    }
    const profiles = await loadStubProfiles(
      (path) => data.vfs.read(stub(path.replace(/^stubs\//, ''))),
      () => 1,
    );
    for (const p of profiles) {
      if (!p) continue;
      const face = await data.vfs.read(stub(smallFacePath(p.faceIndex)));
      expect(Buffer.from(face).equals(Buffer.from(await data.vfs.read(stub(genericFacePath(p.bodyType))))), p.name).toBe(true);
      const big = await data.vfs.read(stub(bigTalkingFacePath(p.faceIndex)));
      expect(Buffer.from(big).equals(Buffer.from(await data.vfs.read(stub(genericBigFacePath(p.bodyType))))), p.name).toBe(true);
      expect([p.eyesX, p.eyesY, p.mouthX, p.mouthY], p.name).toEqual([...GENERIC_FACE.eyes, ...GENERIC_FACE.mouth]);
      expect([p.blinkFrequency, p.expressionFrequency], p.name).toEqual([GENERIC_FACE.blinkFrequency, GENERIC_FACE.expressionFrequency]);
    }
  });

  it('decodes a stub item graphic for every small and big picture the item tables name, outlined with index 254', async () => {
    const table = await stubItemTable();
    const plans = smallSheetPlans(table);
    expect(plans.map((p) => p.path)).toEqual([
      'interface/mdguns.sti',
      'interface/mdp1items.sti',
      'interface/mdp2items.sti',
      'interface/mdp3items.sti',
    ]);
    const sheets = new Map<string, readonly Crop[]>();
    for (const plan of plans) {
      const sti = decodeSti(await data.vfs.read(stub(plan.path)));
      if (sti.kind !== 'indexed') throw new Error(`${plan.path} is not indexed`);
      sheets.set(plan.path, sti.subImages);
      for (const frame of sti.subImages) expect(frame.pixels.includes(ITEM_OUTLINE_INDEX), plan.path).toBe(true);
    }
    for (const def of table.byIndex.values()) {
      const small = def.inventoryGraphics.small;
      const frame = sheets.get(small.path)?.[small.subImageIndex];
      expect(frame, `${def.name} small`).toBeDefined();
      if (def.inventoryGraphics.big.path.startsWith(`${BIG_ITEM_DIR}/`)) {
        const big = decodeSti(await data.vfs.read(stub(def.inventoryGraphics.big.path)));
        if (big.kind !== 'indexed') throw new Error(`${def.name} big is not indexed`);
        const picture = big.subImages[def.inventoryGraphics.big.subImageIndex];
        expect(picture?.pixels.includes(ITEM_OUTLINE_INDEX), `${def.name} big`).toBe(true);
        expect((picture?.width ?? 0) <= BIG_PICTURE_AREA.width && (picture?.height ?? 0) <= BIG_PICTURE_AREA.height, def.name).toBe(true);
      }
    }
  });

  it('decodes a radar map of 88 × 44 indexed pixels for every stub map, aliased sector maps included', async () => {
    const maps = await filesUnder(dir, STUB_MAPS_DIR);
    expect(maps.length).toBeGreaterThan(0);
    const aliases = parseVfsAliases(JSON.parse(await readFile(join(dir, VFS_ALIASES_FILE), 'utf8')));
    const aliasedMaps = [...aliases.keys()].filter((path) => path.startsWith(`${STUB_MAPS_DIR}/`));
    for (const map of [...maps, ...aliasedMaps]) {
      const sti = decodeSti(await data.vfs.read(stub(radarMapPath(map))));
      if (sti.kind !== 'indexed') throw new Error(`${map}: the radar map is not indexed`);
      expect(
        sti.subImages.map((f) => [f.width, f.height]),
        map,
      ).toEqual([[RADAR_MAP_WIDTH, RADAR_MAP_HEIGHT]]);
      expect(new Set(sti.subImages[0]?.pixels).size, map).toBeGreaterThan(1);
    }
  });

  it('decodes the stub tileset with a sprite for every stub tile type and a structure file for every structured one', async () => {
    const tables = parseTileTables(JSON.parse(await readFile(join(PROJECT_DATA_DIR, 'tables/tiles.json'), 'utf8')));
    const db = parseTilesetDatabase(await data.vfs.read(stub('world/binarydata/ja2set.dat')));
    const [tileset] = db.tilesets;
    for (const surface of STUB_TILE_SURFACES) {
      const file = tileset?.surfaceFiles[tables.types.findIndex((t) => t.name === surface.type)];
      expect(file, surface.type).toBe(`${surface.sprite.path}${STUB_SPRITE_SUFFIX}`);
      if (!surface.structures) continue;
      const jsd = parseStructureFile(await data.vfs.read(stub(`world/tilesets/0/${surface.sprite.path}.jsd`)));
      expect(
        jsd.structures.filter(Boolean).map((d) => d?.flags),
        surface.type,
      ).toEqual(surface.structures.map((d) => d.flags));
    }
  });

  it('decodes every stub map and reads every sector of the kind table through the alias manifest', async () => {
    const kinds = await loadSectorKinds();
    const aliases = parseVfsAliases(JSON.parse(await readFile(join(dir, VFS_ALIASES_FILE), 'utf8')));
    for (const f of await filesUnder(dir, 'world/maps')) expect(parseMap(await data.vfs.read(stub(f))).tilesetId, f).toBe(0);
    for (const kind of kinds.kinds) {
      for (const name of kind.sectors) {
        const path = `world/maps/${sectorMapFile(name)}`;
        if (path === `world/maps/${kind.map}.dat`) continue;
        expect(aliases.get(path), name).toBe(`world/maps/${kind.map}.dat`);
        expect(parseMap(await data.vfs.read(stub(path))).placements.length, name).toBeGreaterThan(0);
      }
    }
  });

  it('loads every stub profile with its stub text where it speaks', async () => {
    const profiles = await loadStubProfiles(
      (path) => data.vfs.read(stub(path.replace(/^stubs\//, ''))),
      () => 1,
    );
    const ids = profiles.flatMap((p, id) => (p ? [id] : []));
    expect(ids.filter((id) => id < 40)).toHaveLength(12);
    expect(ids.filter((id) => id >= 160)).toEqual([160, 161, 162, 163]);
    for (const id of [97, 106, 113, 124, 125, 126, 130, 147, 148, 151, 152, 154, 156, 157, 158])
      expect(data.vfs.stat(stub(`npcdata/${String(id).padStart(3, '0')}.edt`)), String(id)).toBeDefined();
  });

  it('decodes every stub cursor with the frames the cursor table uses, the animated ones with AUX_ANIMATED_TILE', async () => {
    const table = await loadCursorTable();
    const used = cursorFramesUsed(table);
    for (const path of cursorFilePaths(table)) {
      const sti = decodeSti(await data.vfs.read(stub(path)));
      if (sti.kind !== 'indexed') throw new Error(`${path} is not indexed`);
      expect(sti.subImages.length, path).toBeGreaterThanOrEqual(used.get(path) ?? 1);
      for (const frame of sti.subImages)
        expect(
          frame.pixels.some((p) => p !== 0),
          path,
        ).toBe(true);
      const animated = ANIMATED_STUB_CURSORS[path];
      if (animated) expect(sti.appData?.[0], path).toMatchObject({ numberOfFrames: animated, flags: 2 });
    }
  });

  it('writes the stub skin of the original layouts at the declared sizes with distinct button states', async () => {
    const plans = planStubSkin(await readOriginalLayouts());
    expect(plans.size).toBeGreaterThan(10);
    for (const plan of plans.values()) {
      const bytes = await data.vfs.read(stub(plan.path));
      if (plan.kind === 'pcx') {
        const pcx = decodePcx(bytes);
        expect([pcx.width, pcx.height], plan.path).toEqual([plan.frames[0]?.width, plan.frames[0]?.height]);
        continue;
      }
      const sti = decodeSti(bytes);
      if (sti.kind !== 'indexed') throw new Error(`${plan.path} is not indexed`);
      expect(
        sti.subImages.map((f) => [f.width, f.height]),
        plan.path,
      ).toEqual(plan.frames.map((f) => [f.width, f.height]));
    }
    const buttons = plans.get('interface/popupbuttons.sti');
    expect(buttons?.frames.map((f) => f.state)).toEqual(['normal', 'pressed', 'normal', 'pressed']);
    const sti = decodeSti(await data.vfs.read(stub('interface/popupbuttons.sti')));
    if (sti.kind !== 'indexed') throw new Error('popupbuttons is not indexed');
    const centre = (i: number) => {
      const f = sti.subImages[i];
      return f ? f.pixels[(f.height - 3) * f.width + f.width - 3] : -1;
    };
    expect(centre(0)).not.toBe(centre(1));
  });

  it('keeps the media small', async () => {
    let total = 0;
    for (const f of await mediaFiles(dir)) total += (await stat(join(dir, f))).size;
    expect(total).toBeLessThan(MEDIA_BUDGET_BYTES);
  });
});

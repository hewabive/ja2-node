import { appendFile, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { isMapFile } from '../content/rules/families.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import type { RulePack } from '../content/rules/pack.ts';
import { dataDecoding } from '../content/text/data-version.ts';
import { type Vfs, vfsFileReader } from '../content/vfs/vfs.ts';
import { loadTacticalWorldInputs } from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { ContentLedger } from './content-identity.ts';
import { detectDataVersion } from './data-version.ts';
import { openRulePack, ruleSourceKey } from './rule-pack.ts';
import { createSandboxSession } from './sandbox.ts';
import type { SessionSim } from './session.ts';

const SLOW_MS = 300_000;
const RUN_TICKS = 400;
const STEP_SOUTH = 320;
const OLD_PACKS = 6;
const KEPT_PACKS = 4;

function decodingOf(vfs: Vfs, originalData: boolean) {
  return dataDecoding(detectDataVersion(vfs, originalData, {}).version);
}

async function recordedReads(vfs: Vfs, originalData: boolean): Promise<{ ledger: ContentLedger; live: ReadFile }> {
  const live = withGraphicFacts(vfsFileReader(vfs));
  const ledger = new ContentLedger(originalData ? 'original' : 'stubs', live, (path) => vfs.stat(path) !== undefined);
  const layers = (path: string) => vfs.layerCount(path);
  const decoding = decodingOf(vfs, originalData);
  await createCampaignSession(ledger.read, ledger.exists, 1, {}, layers, decoding);
  await createSandboxSession(ledger.read, originalData, 1, decoding);
  for (const f of vfs.list()) if (isMapFile(f.path)) await loadTacticalWorldInputs(ledger.read, f.path);
  return { ledger, live };
}

function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  return a !== null && b !== null && Buffer.from(a).equals(Buffer.from(b));
}

async function expectPackAnswersLikeTheData(vfs: Vfs, pack: RulePack, originalData: boolean): Promise<number> {
  const { ledger, live } = await recordedReads(vfs, originalData);
  const entries = ledger.files();
  for (const [path, state] of entries) {
    if (state === 'f') expect(sameBytes(await pack.read(path), await live(path)), path).toBe(true);
    else if (state === 'm') expect([await pack.read(path), pack.exists(path)], path).toEqual([null, false]);
    else expect(pack.exists(path), path).toBe(true);
  }
  return entries.length;
}

function withoutGraphics(pack: RulePack): ReadFile {
  return (path) => {
    if (/\.sti$|\.sprite\.json$/i.test(path)) throw new Error(`the simulation read the graphic ${path}`);
    return pack.read(path);
  };
}

function walkSquad(session: SessionSim): void {
  for (const merc of session.view().soldiers.filter((s) => s.team === Team.OUR))
    session.dispatch({ type: 'move', soldier: merc.id, to: merc.gridNo + STEP_SOUTH, mode: 'run' });
  for (let i = 0; i < RUN_TICKS; i++) session.step();
}

async function expectRunsWithoutGraphics(vfs: Vfs, pack: RulePack, originalData: boolean): Promise<void> {
  const read = withoutGraphics(pack);
  const decoding = decodingOf(vfs, originalData);
  const campaign = await createCampaignSession(read, pack.exists, 3, {}, pack.layers, decoding);
  walkSquad(campaign);
  expect(campaign.view().soldiers.filter((s) => s.team === Team.OUR).length).toBeGreaterThan(0);
  const sandbox = await createSandboxSession(read, originalData, 3, decoding);
  walkSquad(sandbox);
  expect(sandbox.view().soldiers.length).toBeGreaterThan(0);
}

describe('the rule pack on the stub data', () => {
  let kit: StubSectorKit;
  let pack: RulePack;

  beforeAll(async () => {
    kit = await loadStubSectorKit();
    pack = await kit.rulePack();
  }, SLOW_MS);

  afterAll(async () => {
    await kit.dispose();
  });

  it(
    'answers every read and probe of the content loaders as the data does',
    async () => {
      expect(await expectPackAnswersLikeTheData(kit.vfs, pack, false)).toBeGreaterThan(500);
    },
    SLOW_MS,
  );

  it(
    'runs a campaign and a sandbox while every graphic read throws',
    async () => {
      await expectRunsWithoutGraphics(kit.vfs, pack, false);
    },
    SLOW_MS,
  );

  it(
    'is cached on disk, reused while the data stays, rebuilt when it changes, and old packs are pruned',
    async () => {
      const cacheDir = await mkdtemp(join(tmpdir(), 'ja2-rules-cache-'));
      try {
        for (let i = 0; i < OLD_PACKS; i++) {
          const dir = join(cacheDir, `rules-old${i}`);
          await mkdir(dir);
          await writeFile(join(dir, 'pack.json'), '{}');
          await utimes(join(dir, 'pack.json'), new Date(2000, 0, i + 1), new Date(2000, 0, i + 1));
        }
        const built = await openRulePack({ vfs: kit.vfs, source: 'stubs', cacheDir });
        expect(built).toMatchObject({ cached: false, dir: join(cacheDir, `rules-${pack.hash}`) });
        expect(built.pack.hash).toBe(pack.hash);
        expect(
          (await readdir(cacheDir, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name.startsWith('rules-')),
        ).toHaveLength(KEPT_PACKS);
        const again = await openRulePack({ vfs: kit.vfs, source: 'stubs', cacheDir });
        expect(again).toMatchObject({ cached: true, dir: built.dir });
        expect(again.pack.manifest).toEqual(built.pack.manifest);
        expect(sameBytes(await again.pack.read('stubs/world/maps/village.dat'), await pack.read('stubs/world/maps/village.dat'))).toBe(
          true,
        );
        const npc = kit.vfs.list().find((f) => f.path.startsWith('stubs/npcdata/') && f.path.endsWith('.npc'));
        if (!npc) throw new Error('no stub NPC records');
        await appendFile(join(kit.stubsDir, npc.path.slice('stubs/'.length)), Uint8Array.of(0));
        const changed = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, stubsDir: kit.stubsDir });
        try {
          expect(ruleSourceKey(changed.vfs, 'stubs')).not.toBe(ruleSourceKey(kit.vfs, 'stubs'));
          const rebuilt = await openRulePack({ vfs: changed.vfs, source: 'stubs', cacheDir });
          expect(rebuilt.cached).toBe(false);
          expect(rebuilt.pack.hash).not.toBe(pack.hash);
        } finally {
          await changed.close();
        }
      } finally {
        await rm(cacheDir, { recursive: true, force: true });
      }
    },
    SLOW_MS,
  );
});

describe.skipIf(!process.env.JA2_DATA_DIR)('the rule pack on the original data', () => {
  let data: Awaited<ReturnType<typeof openDataVfs>>;
  let pack: RulePack;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: process.env.JA2_DATA_DIR });
    pack = (await openRulePack({ vfs: data.vfs, source: 'original', cacheDir: null })).pack;
  }, SLOW_MS);

  afterAll(async () => {
    await data.close();
  });

  it(
    'answers every read and probe of the content loaders as the data does',
    async () => {
      expect(await expectPackAnswersLikeTheData(data.vfs, pack, true)).toBeGreaterThan(3000);
    },
    SLOW_MS,
  );

  it(
    'runs a campaign and a sandbox while every graphic read throws',
    async () => {
      await expectRunsWithoutGraphics(data.vfs, pack, true);
    },
    SLOW_MS,
  );
});

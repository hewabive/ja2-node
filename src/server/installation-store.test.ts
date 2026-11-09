import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryLayer, Vfs } from '../content/vfs/vfs.ts';
import { meanwhileSceneBit } from '../sim/campaign/installation.ts';
import { Meanwhile } from '../sim/strategic/ai/constants.ts';
import { NUM_MEANWHILES } from '../sim/strategic/ai/queen-state.ts';
import { createApp } from './app.ts';
import { INSTALLATION_FILE, InstallationStore } from './installation-store.ts';

const TOKEN = 'test-token-0123456789';
const AUTH = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const dirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ja2-installation-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the installation settings beside the saves (GameSettings.cc MeanwhileSceneSeen, SetMeanwhileSceneSeen)', () => {
  it('starts with no scene seen, keeps a scene seen in its file for every store on the folder, and never sets an id past the last scene', () => {
    const dir = freshDir();
    const store = new InstallationStore(dir);
    expect(store.meanwhileSceneSeen(Meanwhile.DRASSEN_LIBERATED)).toBe(false);
    store.setMeanwhileSceneSeen(Meanwhile.DRASSEN_LIBERATED);
    store.setMeanwhileSceneSeen(NUM_MEANWHILES);
    const other = new InstallationStore(dir);
    expect(other.meanwhileSceneSeen(Meanwhile.DRASSEN_LIBERATED)).toBe(true);
    expect(other.meanwhileSceneSeen(NUM_MEANWHILES)).toBe(false);
    expect(other.view()).toEqual({ meanwhileScenesSeen: meanwhileSceneBit(Meanwhile.DRASSEN_LIBERATED) });
    expect(JSON.parse(readFileSync(join(dir, INSTALLATION_FILE), 'utf8'))).toMatchObject({
      format: 'ja2-node-installation',
      meanwhileScenesSeen: meanwhileSceneBit(Meanwhile.DRASSEN_LIBERATED),
    });
  });

  it('merges flags handed over by OR and reads a damaged file as a fresh installation, as Ja2.set of the wrong size', () => {
    const dir = freshDir();
    writeFileSync(join(dir, INSTALLATION_FILE), '{"format": "ja2-node-installation", "meanwhileScenesSeen": ');
    const store = new InstallationStore(dir);
    expect(store.view()).toEqual({ meanwhileScenesSeen: 0 });
    store.setMeanwhileSceneSeen(Meanwhile.CREATURES);
    const handed = meanwhileSceneBit(Meanwhile.LOST_TOWN) | meanwhileSceneBit(Meanwhile.CREATURES);
    expect(store.mergeMeanwhileScenesSeen(handed)).toEqual({ meanwhileScenesSeen: handed });
    expect(store.mergeMeanwhileScenesSeen(meanwhileSceneBit(Meanwhile.FLOWERS)).meanwhileScenesSeen).toBe(
      handed | meanwhileSceneBit(Meanwhile.FLOWERS),
    );
  });

  it('serves the flags at /api/installation and merges the ones a browser hands over', async () => {
    const installation = new InstallationStore(freshDir());
    const app = createApp({
      vfs: new Vfs([new MemoryLayer('mem', [])]),
      token: TOKEN,
      info: { originalData: false, slfCount: 0, stubs: true },
      installation,
    });
    const url = 'http://localhost/api/installation';
    expect(await (await app.request(url, { headers: AUTH })).json()).toEqual({ meanwhileScenesSeen: 0 });
    const bit = meanwhileSceneBit(Meanwhile.NW_SAM);
    const posted = await app.request(url, { method: 'POST', headers: AUTH, body: JSON.stringify({ meanwhileScenesSeen: bit }) });
    expect(await posted.json()).toEqual({ meanwhileScenesSeen: bit });
    expect(installation.meanwhileSceneSeen(Meanwhile.NW_SAM)).toBe(true);
    const bad = await app.request(url, { method: 'POST', headers: AUTH, body: JSON.stringify({ meanwhileScenesSeen: -1 }) });
    expect(bad.status).toBe(400);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { NotARuleFileError, type RulePack } from '../../content/rules/pack.ts';
import type { Vfs } from '../../content/vfs/vfs.ts';
import { loadTacticalWorldInputs } from '../../content/world/tactical-world.ts';
import { openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { createApp } from '../../server/app.ts';
import { nodeSha256, openRulePack } from '../../server/rule-pack.ts';
import { loadTacticalContent } from '../../sim/tactical/load-content.ts';
import { HttpAssetSource } from '../assets/asset-source.ts';
import type { Fetcher } from '../assets/http-vfs-layer.ts';
import { browserSha256, clientRulePackIdentity, loadClientRules, type RulesCheck } from './client-rules.ts';

const TOKEN = 'rules-test-token-0123456789';
const VILLAGE = 'stubs/world/maps/village.dat';

function assetSourceOver(vfs: Vfs, originalData: boolean): Promise<HttpAssetSource> {
  const app = createApp({ vfs, token: TOKEN, info: { originalData, slfCount: 0, stubs: !originalData } });
  const fetcher: Fetcher = (url, init) => Promise.resolve(app.fetch(new Request(url, init)));
  return HttpAssetSource.open({ fetch: fetcher, baseUrl: 'http://localhost', headers: { authorization: `Bearer ${TOKEN}` } });
}

describe('the client rule content on the stub data', () => {
  let kit: StubSectorKit;
  let pack: RulePack;
  let source: HttpAssetSource;

  beforeAll(async () => {
    kit = await loadStubSectorKit();
    pack = await kit.rulePack();
    source = await assetSourceOver(kit.vfs, false);
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('has the rule pack hash and scripts hash of the server, from the manifest and three small files', async () => {
    expect(await clientRulePackIdentity(source, browserSha256)).toEqual({ pack: pack.hash, scripts: pack.scriptsHash });
    expect(await clientRulePackIdentity(source, nodeSha256)).toEqual({ pack: pack.hash, scripts: pack.scriptsHash });
  });

  it('has the same hashes where WebCrypto is missing, as on a page served over plain HTTP from another machine', async () => {
    vi.stubGlobal('crypto', {});
    try {
      expect(await clientRulePackIdentity(source, browserSha256)).toEqual({ pack: pack.hash, scripts: pack.scriptsHash });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads the same rule content with the same loaders, and refuses what is not a rule file', async () => {
    const rules = await loadClientRules(source, { pack: pack.hash, scripts: pack.scriptsHash });
    expect(rules.check).toMatchObject({ packMatches: true, scriptsMatch: true });
    expect(await loadTacticalWorldInputs(rules.read, VILLAGE)).toEqual(await loadTacticalWorldInputs(pack.read, VILLAGE));
    const [client, server] = await Promise.all([loadTacticalContent(rules.read), loadTacticalContent(pack.read)]);
    expect(client.timeline).toEqual(server.timeline);
    expect(client.explosions).toEqual(server.explosions);
    expect(rules.exists(VILLAGE)).toBe(true);
    await expect(rules.read('stubs/world/tilesets/0/grass.sprite.json')).rejects.toBeInstanceOf(NotARuleFileError);
  });

  it('reports a rule pack or scripts that differ from the server', async () => {
    const mismatches: RulesCheck[] = [];
    const rules = await loadClientRules(source, { pack: 'other', scripts: pack.scriptsHash }, { onMismatch: (c) => mismatches.push(c) });
    expect(rules.check).toMatchObject({ packMatches: false, scriptsMatch: true, actual: { pack: pack.hash } });
    expect(mismatches).toEqual([rules.check]);
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('the client rule content on the original data', () => {
  it('has the rule pack hash of the server', async () => {
    const data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    try {
      const { pack } = await openRulePack({ vfs: data.vfs, source: 'original', cacheDir: null });
      const source = await assetSourceOver(data.vfs, true);
      expect(await clientRulePackIdentity(source)).toEqual({ pack: pack.hash, scripts: pack.scriptsHash });
    } finally {
      await data.close();
    }
  });
});

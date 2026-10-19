import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectHintsAgree, sampleMoveHints, serialisedView, withQueries } from '../../../tests/support/hints.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import type { RulePack } from '../../content/rules/pack.ts';
import type { Vfs } from '../../content/vfs/vfs.ts';
import { createApp } from '../../server/app.ts';
import { createSandboxSession } from '../../server/sandbox.ts';
import { Session } from '../../server/session.ts';
import { HttpAssetSource } from '../assets/asset-source.ts';
import type { Fetcher } from '../assets/http-vfs-layer.ts';
import { ClientKnowledge } from './client-knowledge.ts';

const TOKEN = 'knowledge-test-token-0123456789';
const SLOW_MS = 120_000;
const VILLAGE = 'stubs/world/maps/village.dat';
const ENGINE = { version: '0.7.0', commit: 'abcdef0' };

function assetSourceOver(vfs: Vfs): Promise<HttpAssetSource> {
  const app = createApp({ vfs, token: TOKEN, info: { originalData: false, slfCount: 0, stubs: true } });
  const fetcher: Fetcher = (url, init) => Promise.resolve(app.fetch(new Request(url, init)));
  return HttpAssetSource.open({ fetch: fetcher, baseUrl: 'http://localhost', headers: { authorization: `Bearer ${TOKEN}` } });
}

describe('the client knowledge built from the asset source', () => {
  let kit: StubSectorKit;
  let pack: RulePack;
  let source: HttpAssetSource;

  beforeAll(async () => {
    kit = await loadStubSectorKit();
    pack = await kit.rulePack();
    source = await assetSourceOver(kit.vfs);
  }, SLOW_MS);

  afterAll(async () => {
    await kit.dispose();
  });

  it(
    'is usable when the engine and the rule pack match, loads the sector map and answers like the server',
    async () => {
      const identity = { engine: ENGINE, rules: { pack: pack.hash, scripts: pack.scriptsHash } };
      const knowledge = await ClientKnowledge.open(source, identity, undefined, ENGINE);
      expect(knowledge.usable).toBe(true);
      expect(knowledge.worlds.has(VILLAGE)).toBe(false);
      await knowledge.worlds.ensure(VILLAGE);
      expect(knowledge.worlds.has(VILLAGE)).toBe(true);
      const sources = { read: kit.read, exists: (p: string) => kit.worlds.exists(p), world: (p: string) => kit.worlds.world(p) };
      const session = withQueries(new Session('knowledge', await createSandboxSession(kit.read, false, 1)), sources);
      const report = await expectHintsAgree(
        session,
        { content: knowledge.content, rules: knowledge.rules },
        sampleMoveHints(serialisedView(session)),
      );
      expect(report.answered).toBeGreaterThan(20);
    },
    SLOW_MS,
  );

  it(
    'is not usable when the engine commit or the rule pack differs',
    async () => {
      const identity = { engine: ENGINE, rules: { pack: pack.hash, scripts: pack.scriptsHash } };
      expect((await ClientKnowledge.open(source, identity, undefined, { ...ENGINE, commit: 'other' })).usable).toBe(false);
      expect(
        (await ClientKnowledge.open(source, { ...identity, rules: { ...identity.rules, pack: 'other' } }, undefined, ENGINE)).usable,
      ).toBe(false);
      expect((await ClientKnowledge.open(source, identity, undefined, { version: 'unknown', commit: 'unknown' })).usable).toBe(false);
    },
    SLOW_MS,
  );
});

import { expect, test } from '@playwright/test';

const ASSET_SOURCE_MODULE = '/src/app/assets/asset-source.ts';
const CLIENT_RULES_MODULE = '/src/app/rules/client-rules.ts';
const MAP = 'stubs/world/maps/village.dat';
const MIN_FILES = 1000;

test('the browser builds its asset source from the manifest and agrees with the server on the rule pack', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(
    async ({ sourceModule, rulesModule, map }) => {
      const { HttpAssetSource } = await import(sourceModule);
      const { clientRulePackIdentity } = await import(rulesModule);
      const source = await HttpAssetSource.open();
      const health = await (await fetch('/api/health')).json();
      const bytes: Uint8Array = await source.read(map);
      const pinned = await fetch(`/vfs/@${source.hashOf(map)}/${map}`);
      const stale = await fetch(`/vfs/@0000000000000000/${map}`);
      return {
        files: source.vfs.size as number,
        mapBytes: bytes.length,
        mapSize: source.resolve(map)?.size as number,
        identity: await clientRulePackIdentity(source),
        rules: health.rules,
        cacheControl: pinned.headers.get('cache-control'),
        stale: stale.status,
      };
    },
    { sourceModule: ASSET_SOURCE_MODULE, rulesModule: CLIENT_RULES_MODULE, map: MAP },
  );
  expect(result.files).toBeGreaterThan(MIN_FILES);
  expect(result.mapBytes).toBe(result.mapSize);
  expect(result.identity).toEqual(result.rules);
  expect(result.cacheControl).toBe('private, max-age=31536000, immutable');
  expect(result.stale).toBe(404);
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { AIM_BIOS_FILE } from '../content/narrative/profile-presentation.ts';
import type { ItemCatalogue } from '../protocol/items.ts';
import { GENERIC_FACE } from '../ui/screens/tactical/generic-face.ts';
import { createApp } from './app.ts';
import { TextService } from './text-service.ts';

const token = 'catalogue-test-token-0123456789';
const auth = { authorization: `Bearer ${token}` };
const TEST_TIMEOUT_MS = 120_000;
const GLOCK_17 = 1;
const STUB_PROFILE = 0;

let kit: StubSectorKit;
let k: SaveKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  k = await createSaveKit(kit);
  k.hosts.set('sandbox', await k.hostFactory('sandbox', { seed: 5 }));
});

afterAll(async () => {
  await k.dispose();
  await kit.dispose();
});

function app() {
  return createApp({
    vfs: kit.vfs,
    token,
    info: { originalData: false, slfCount: 0, stubs: true },
    sessions: k.hosts,
    defaultSession: 'sandbox',
    createSession: k.hostFactory,
    texts: new TextService({ vfs: kit.vfs, dataVersion: 'stubs' }),
  });
}

describe('the item catalogue (docs/28 §12.1 G19)', () => {
  it(
    'lists every item with its texts, graphics and static stats, revalidated by ETag',
    async () => {
      const server = app();
      const response = await server.request('http://localhost/api/items?lang=eng', { headers: auth });
      expect(response.status).toBe(200);
      const catalogue = (await response.json()) as ItemCatalogue;
      expect(catalogue).toMatchObject({ language: 'eng', dataVersion: 'stubs' });
      const glock = catalogue.items.find((i) => i.index === GLOCK_17);
      expect(glock).toMatchObject({
        name: 'GLOCK_17',
        class: 'GUN',
        inventoryGraphics: { small: { path: 'interface/mdguns.sti', subImageIndex: 1 }, big: { path: 'bigitems/gun01.sti' } },
        tileGraphic: { type: 'GUNS' },
        weapon: { calibre: { index: 2, name: '9mm' }, magSize: 15 },
      });
      expect(glock?.shortName.length).toBeGreaterThan(0);
      const magazine = catalogue.items.find((i) => i.magazine !== null);
      expect(magazine?.bobbyRayName).toBe(magazine?.shortName);
      const etag = response.headers.get('etag') ?? '';
      expect((await server.request('http://localhost/api/items?lang=eng', { headers: { ...auth, 'if-none-match': etag } })).status).toBe(
        304,
      );
      expect((await server.request('http://localhost/api/items?lang=xx', { headers: auth })).status).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('the profile presentation endpoint (G18)', () => {
  it(
    'answers the face, the bio rows and the names of every profile of a session',
    async () => {
      const server = app();
      k.hosts.set('campaign', await k.hostFactory('campaign', { seed: 6, campaign: { hire: [] } }));
      const response = await server.request('http://localhost/api/sessions/campaign/profiles', { headers: auth });
      expect(response.status).toBe(200);
      const { profiles } = (await response.json()) as { profiles: { id: number; faceIndex: number; aimBio: number | null }[] };
      const first = profiles.find((p) => p.id === STUB_PROFILE);
      expect(first).toMatchObject({
        name: expect.any(String),
        nickname: expect.any(String),
        faceIndex: STUB_PROFILE,
        eyes: [...GENERIC_FACE.eyes],
        mouth: [...GENERIC_FACE.mouth],
        blinkFrequency: GENERIC_FACE.blinkFrequency,
        expressionFrequency: GENERIC_FACE.expressionFrequency,
        smallFace: null,
        aimBio: 0,
      });
      expect(AIM_BIOS_FILE).toBe('binarydata/aimbios.edt');
      const etag = response.headers.get('etag') ?? '';
      const again = await server.request('http://localhost/api/sessions/campaign/profiles', {
        headers: { ...auth, 'if-none-match': etag },
      });
      expect(again.status).toBe(304);
      expect((await server.request('http://localhost/api/sessions/none/profiles', { headers: auth })).status).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );
});

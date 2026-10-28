import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import { MCP_CALL_OPTIONS } from '../../tests/support/patience.ts';
import { encodeEdtFile, encodeEdtRecords } from '../content/formats/edt.ts';
import { UI_LANGUAGES } from '../content/text/data-version.ts';
import { LANGUAGE_FILES } from '../content/text/strings.ts';
import { PROJECT_DATA_LAYER } from '../content/vfs/layers.ts';
import { MemoryLayer, Vfs } from '../content/vfs/vfs.ts';
import { DirLayer } from '../node/dir-layer.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import type { StrategicMercView } from '../protocol/view.ts';
import { createApp } from './app.ts';
import { Session, type SessionSim } from './session.ts';
import { InProcessHost, type SessionHost } from './session-host.ts';
import type { SessionRequest } from './session-registry.ts';
import { TEXT_KEYS } from './text-keys.ts';
import { TextService } from './text-service.ts';

const token = 'text-test-token-0123456789';
const auth = { authorization: `Bearer ${token}` };
const CYRILLIC = /[Ѐ-ӿ]/;
const TRANSLATION_KEYS = 217;
const ITEM_COLUMNS = [80, 80, 240];

const projectData = await DirLayer.open(PROJECT_DATA_LAYER, PROJECT_DATA_DIR);
const stubFiles = new MemoryLayer('stubs', [
  ['stubs/npcdata/094.edt', encodeEdtFile(['first line', 'second line'])],
  [
    'stubs/binarydata/itemdesc.edt',
    encodeEdtRecords(
      [
        ['Nothing', 'Nothing', ''],
        ['Knife', 'Knife', 'A sharp one.'],
      ],
      ITEM_COLUMNS,
    ),
  ],
]);
const stubVfs = new Vfs([projectData, stubFiles]);

const merc = { id: 3, name: 'Ivan', assignment: 0, moraleText: 'good', morale: 70 } as unknown as StrategicMercView;
const campaignLike: SessionSim = {
  tick: 0,
  isIdle: () => true,
  hasPendingDecision: () => false,
  step: () => {},
  drainEvents: () => [],
  dispatch: () => ({ ok: true }),
  view: () =>
    ({
      tick: 0,
      mapPath: null,
      soldiers: [],
      strategic: { mercs: [merc] },
      conversation: { menu: ['repeat', 'buySell:buy', 'whoAreYou'] },
    }) as unknown as ReturnType<SessionSim['view']>,
};

function stubApp(requests: SessionRequest[] = []) {
  const sessions = new Map<string, SessionHost>([['sandbox', new InProcessHost(new Session('sandbox', campaignLike))]]);
  const app = createApp({
    vfs: stubVfs,
    token,
    info: { originalData: false, slfCount: 0, stubs: true },
    texts: new TextService({ vfs: stubVfs, dataVersion: 'stubs' }),
    sessions,
    defaultSession: 'sandbox',
    createSession: async (id, request) => {
      requests.push(request);
      const session = new Session(id, campaignLike, { language: 'eng', dataVersion: 'stubs' });
      if (request.language) session.language = request.language;
      return new InProcessHost(session);
    },
  });
  return { app, sessions };
}

async function englishTranslation(): Promise<Record<string, string[]>> {
  return JSON.parse(await readFile(join(PROJECT_DATA_DIR, 'externalized/strings/translation-eng.json'), 'utf8'));
}

describe('UI strings on stubs', () => {
  it('reports the stub data version and the default display language', async () => {
    const { app } = stubApp();
    const health = await (await app.request('http://localhost/api/health', { headers: auth })).json();
    expect(health).toMatchObject({ dataVersion: 'stubs', language: 'eng' });
  });

  it('serves the Russian tables: translation-rusgold plus the -rus files', async () => {
    const { app } = stubApp();
    const res = await app.request('http://localhost/api/strings?lang=rus', { headers: auth });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.language).toBe('rus');
    expect(body.files[0]).toBe('externalized/strings/translation-rusgold.json');
    expect(body.files.slice(1).every((f: string) => f.endsWith('-rus.json'))).toBe(true);
    expect(Object.keys(body.tables)).toHaveLength(TRANSLATION_KEYS + LANGUAGE_FILES.length);
    expect(body.tables.pMoralStrings).toHaveLength(6);
    expect(body.tables.pMoralStrings.every((s: string) => CYRILLIC.test(s))).toBe(true);
    expect(body.tables['strategic-map-town-names'][1]).toMatch(CYRILLIC);
    expect(body.keys['morale.good']).toEqual({ table: 'pMoralStrings', index: 1 });
  });

  it('caches the tables by ETag and refuses unknown languages and missing tokens', async () => {
    const { app } = stubApp();
    const first = await app.request('http://localhost/api/strings', { headers: auth });
    const etag = first.headers.get('etag') ?? '';
    expect(etag).toMatch(/^"strings-eng-[0-9a-f]{16}"$/);
    expect(first.headers.get('cache-control')).toContain('max-age');
    expect((await app.request('http://localhost/api/strings?lang=eng', { headers: { ...auth, 'if-none-match': etag } })).status).toBe(304);
    expect((await app.request('http://localhost/api/strings?lang=klingon', { headers: auth })).status).toBe(400);
    expect((await app.request('http://localhost/api/strings?lang=rus')).status).toBe(401);
  });

  it('serves every display language', async () => {
    const { app } = stubApp();
    for (const lang of UI_LANGUAGES) {
      const body = await (await app.request(`http://localhost/api/strings?lang=${lang}`, { headers: auth })).json();
      expect(Object.keys(body.tables), lang).toHaveLength(TRANSLATION_KEYS + LANGUAGE_FILES.length);
    }
  });

  it('resolves UI keys and text-key tokens in the requested language', async () => {
    const { app } = stubApp();
    const eng = await englishTranslation();
    const byToken = await (await app.request('http://localhost/api/text?key=morale.good', { headers: auth })).json();
    expect(byToken).toEqual({ key: 'morale.good', table: 'pMoralStrings', index: 1, language: 'eng', text: eng.pMoralStrings?.[1] });
    const russian = await (
      await app.request('http://localhost/api/text?table=pConditionStrings&index=8&lang=rus', { headers: auth })
    ).json();
    expect(russian.text).toMatch(CYRILLIC);
    expect((await app.request('http://localhost/api/text?key=morale.ecstatic', { headers: auth })).status).toBe(400);
    expect((await app.request('http://localhost/api/text?table=pMoralStrings&index=6', { headers: auth })).status).toBe(404);
    expect((await app.request('http://localhost/api/text?table=pMoralStrings&lang=xx', { headers: auth })).status).toBe(400);
  });
});

describe('EDT text with layouts', () => {
  it('reads multi-column records with the layout of edt-layouts.json', async () => {
    const { app } = stubApp();
    const res = await app.request('http://localhost/api/text?file=binarydata/itemdesc.edt&row=1&column=2', { headers: auth });
    expect(await res.json()).toEqual({
      file: 'binarydata/itemdesc.edt',
      row: 1,
      layout: ITEM_COLUMNS,
      columns: ['Knife', 'Knife', 'A sharp one.'],
      column: 2,
      width: 240,
      text: 'A sharp one.',
    });
    expect((await app.request('http://localhost/api/text?file=binarydata/itemdesc.edt&row=1&column=3', { headers: auth })).status).toBe(
      400,
    );
  });

  it('refuses files without a layout, bad rows and missing files', async () => {
    const { app } = stubApp();
    expect((await app.request('http://localhost/api/text?file=binarydata/prof.dat&row=0', { headers: auth })).status).toBe(400);
    expect((await app.request('http://localhost/api/text?file=npcdata/094.edt&row=-1', { headers: auth })).status).toBe(400);
    expect((await app.request('http://localhost/api/text?file=npcdata/094.edt&row=2', { headers: auth })).status).toBe(404);
    expect((await app.request('http://localhost/api/text?file=binarydata/help.edt&row=0', { headers: auth })).status).toBe(404);
  });

  it('uses stub files only when the server runs on stubs', async () => {
    const texts = new TextService({ vfs: stubVfs, dataVersion: 'english' });
    expect(await texts.edtRecord('npcdata/094.edt', 0)).toEqual({ ok: false, error: 'notFound' });
    expect(await texts.text({ file: 'npcdata/094.edt', row: 0, width: 240 })).toBeNull();
    const stubs = new TextService({ vfs: stubVfs, dataVersion: 'stubs' });
    expect(await stubs.text({ file: 'npcdata/094.edt', row: 0, width: 240 })).toBe('first line');
  });
});

describe('per-session display language', () => {
  const post = (app: ReturnType<typeof stubApp>['app'], body: unknown) =>
    app.request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('opens a session in Russian over HTTP, setting the language on the session and never on the simulation', async () => {
    const requests: SessionRequest[] = [];
    const { app } = stubApp(requests);
    const created = await (await post(app, { seed: 2, language: 'rus' })).json();
    expect(created).toMatchObject({ session: 'sandbox-1', language: 'rus', dataVersion: 'stubs' });
    expect(requests.at(-1)).toEqual({ seed: 2, language: 'rus' });
    expect((await post(app, { language: 'klingon' })).status).toBe(400);
    const list = await (await app.request('http://localhost/api/sessions', { headers: auth })).json();
    expect(list.map((s: { language: string }) => s.language)).toEqual(['eng', 'rus']);
  });

  it('reports the language in MCP status and resolves observe labels in it', async () => {
    const { app } = stubApp();
    const fetchViaApp: typeof fetch = async (input, init) => app.fetch(new Request(input, init));
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      fetch: fetchViaApp,
      requestInit: { headers: auth },
    });
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args }, undefined, MCP_CALL_OPTIONS);
      return JSON.parse((r.content as { text: string }[])[0]?.text ?? 'null');
    };
    const created = await call('newSession', { language: 'rus' });
    expect(created).toMatchObject({ language: 'rus', dataVersion: 'stubs' });
    expect(await call('status', { session: created.session })).toMatchObject({ language: 'rus', dataVersion: 'stubs' });
    const russian = await call('observe', { session: created.session });
    expect(russian).toMatchObject({ language: 'rus', dataVersion: 'stubs' });
    expect(russian.strategic.mercs[0].moraleText).toBe('good');
    expect(russian.strategic.mercs[0].moraleLabel).toMatch(CYRILLIC);
    expect(russian.strategic.mercs[0].assignmentLabel).toMatch(CYRILLIC);
    expect(russian.conversation.menu).toEqual(['repeat', 'buySell:buy', 'whoAreYou']);
    expect(russian.conversation.menuLabels[0]).toMatch(CYRILLIC);
    expect(russian.conversation.menuLabels[2]).toBeNull();
    const eng = await englishTranslation();
    const english = await call('observe');
    expect(english.language).toBe('eng');
    expect(english.strategic.mercs[0].moraleLabel).toBe(eng.pMoralStrings?.[1]);
    expect(english.conversation.menuLabels[1]).toBe((eng as Record<string, string[]>).zDealerStrings?.[1]);
    await client.close();
  });
});

describe('text keys', () => {
  it('point at strings that exist in every language', async () => {
    const texts = new TextService({ vfs: stubVfs, dataVersion: 'stubs' });
    for (const lang of UI_LANGUAGES) {
      for (const [token, key] of Object.entries(TEXT_KEYS)) {
        expect(await texts.uiText(lang, key.table, key.index), `${lang} ${token}`).not.toBeNull();
      }
    }
  });
});

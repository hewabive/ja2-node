import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { Vfs } from '../content/vfs/vfs.ts';
import { PromptKind } from '../sim/strategic/forces/battle-state.ts';
import { createApp } from './app.ts';
import { CampaignSession } from './campaign-session.ts';
import { readSaveHead } from './save-file.ts';

const token = 'options-api-test-token-0123456789';
const TEST_TIMEOUT_MS = 120_000;
const CHOSEN = { difficulty: 3, sciFi: false, gunNut: true, saveMode: 'ironMan', bloodAndGore: false } as const;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

async function server(k: SaveKit) {
  const sandbox = await k.factory('sandbox', { seed: 5 });
  k.sessions.set('sandbox', sandbox);
  return createApp({
    vfs: new Vfs([]),
    token,
    info: { originalData: false, slfCount: 0, stubs: true },
    sessions: k.sessions,
    defaultSession: 'sandbox',
    createSession: k.factory,
    saves: k.saves,
  });
}

async function mcpClient(app: Awaited<ReturnType<typeof server>>) {
  const fetchViaApp: typeof fetch = async (input, init) => app.fetch(new Request(input, init));
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: fetchViaApp,
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'options-test', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0]?.text ?? 'null';
    return r.isError ? { error: text } : JSON.parse(text);
  };
  return { client, call };
}

describe('game options over the agent API', () => {
  it(
    'a campaign started with options shows them in status, observe and the save header, and setOption changes blood and gore',
    async () => {
      const k = await createSaveKit(kit);
      try {
        const { client, call } = await mcpClient(await server(k));
        expect((await call('status')).options).toEqual({
          difficulty: 2,
          sciFi: true,
          gunNut: false,
          saveMode: 'anywhere',
          bloodAndGore: true,
        });
        const created = await call('newSession', { seed: 3, campaign: { options: CHOSEN, land: false, hire: [] } });
        expect(created).toMatchObject({ session: 'sandbox-1', options: CHOSEN, saveMode: 'ironMan' });
        const session = created.session as string;
        expect((await call('observe', { session })).options).toEqual(CHOSEN);
        expect(await call('act', { session, command: { type: 'setOption', bloodAndGore: true } })).toMatchObject({
          ok: true,
          data: { options: { ...CHOSEN, bloodAndGore: true } },
        });
        expect(await call('act', { session, command: { type: 'setOption', difficulty: 1 } })).toMatchObject({
          ok: false,
          data: { refusal: 'badOption' },
        });
        expect((await call('status', { session })).options).toEqual({ ...CHOSEN, bloodAndGore: true });
        const live = k.sessions.get(session);
        expect(live?.log.full().entries.map((e) => (e.payload as { cmd?: { type: string } }).cmd?.type)).toContain('setOption');
        const saved = await call('save', { session, name: 'withOptions' });
        expect(saved).toMatchObject({ ok: true, header: { options: { ...CHOSEN, bloodAndGore: true } } });
        const bytes = await k.store.read('withOptions');
        expect(bytes && readSaveHead(bytes).header.options).toEqual({ ...CHOSEN, bloodAndGore: true });
        const listed = (await call('listSaves')) as { name: string; header: { options: unknown } }[];
        expect(listed.find((s) => s.name === 'withOptions')?.header.options).toEqual({ ...CHOSEN, bloodAndGore: true });
        await client.close();
      } finally {
        await k.dispose();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'keeps campaign.difficulty and campaign.saveMode as aliases and refuses a contradiction',
    async () => {
      const k = await createSaveKit(kit);
      try {
        const { client, call } = await mcpClient(await server(k));
        const aliased = await call('newSession', { campaign: { difficulty: 1, saveMode: 'deadIsDead', land: false, hire: [] } });
        expect(aliased.options).toEqual({ difficulty: 1, sciFi: true, gunNut: false, saveMode: 'deadIsDead', bloodAndGore: true });
        const both = await call('newSession', { campaign: { difficulty: 1, options: { difficulty: 1 }, land: false, hire: [] } });
        expect(both.options.difficulty).toBe(1);
        const contradiction = await call('newSession', { campaign: { difficulty: 1, options: { difficulty: 3 }, land: false, hire: [] } });
        expect(contradiction.error).toMatch(/disagree/);
        await client.close();
      } finally {
        await k.dispose();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'takes the options in POST /api/sessions and refuses setOption while a prompt is open',
    async () => {
      const k = await createSaveKit(kit);
      try {
        const app = await server(k);
        const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
        const response = await app.request('http://localhost/api/sessions', {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ campaign: { options: { gunNut: true }, land: false, hire: [] } }),
        });
        const body = (await response.json()) as { session: string; options: unknown };
        expect(body.options).toEqual({ difficulty: 2, sciFi: true, gunNut: true, saveMode: 'anywhere', bloodAndGore: true });
        const session = k.sessions.get(body.session);
        const sim = session?.sim;
        if (!(sim instanceof CampaignSession)) throw new Error('not a campaign');
        sim.campaign.state.battle.prompt = { id: 'p1', kind: PromptKind.NPC_OF_NOTE };
        expect(session?.dispatch({ type: 'setOption', bloodAndGore: false })).toMatchObject({ ok: false, data: { refusal: 'promptOpen' } });
        expect(sim.campaign.state.options.bloodAndGore).toBe(true);
        sim.campaign.state.battle.prompt = null;
        expect(session?.dispatch({ type: 'setOption', bloodAndGore: false })).toMatchObject({ ok: true });
        expect(sim.campaign.state.options.bloodAndGore).toBe(false);
        expect(sim.drainEvents().map((e) => e.type)).toContain('optionChanged');
      } finally {
        await k.dispose();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

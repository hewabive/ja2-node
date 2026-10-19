import { describe, expect, it } from 'vitest';
import { header, listing } from '../../../tests/support/front-end.ts';
import type { Health, LoadSuccess, Refusal, SaveListing, SaveSuccess } from '../client/api-types.ts';
import type { MessageBoxButtons, MessageBoxes } from '../message-boxes.ts';
import { LABELS, type LabelId, Labels } from '../text/labels.ts';
import { MessageBoxReturn } from '../widgets/message-box.ts';
import { type CreatedSession, type SaveApi, SaveController, type SaveRequest, type SessionStart } from './save-controller.ts';
import { saveRow } from './save-rows.ts';

function labels(): Labels {
  const tables: Record<string, string[]> = {};
  for (const [id, source] of Object.entries(LABELS)) {
    if (!('table' in source) || source.index === null) continue;
    const table = tables[source.table] ?? [];
    tables[source.table] = table;
    table[source.index] = `[${id as LabelId}%s]`;
  }
  return new Labels('eng', tables);
}

class Boxes implements MessageBoxes {
  readonly asked: string[] = [];
  answer = true;

  async ask(text: string, buttons: MessageBoxButtons): Promise<number> {
    this.asked.push(text);
    if (buttons === 'ok') return MessageBoxReturn.OK;
    return this.answer ? MessageBoxReturn.YES : MessageBoxReturn.NO;
  }

  async confirm(text: string): Promise<boolean> {
    return (await this.ask(text, 'yesNo')) === MessageBoxReturn.YES;
  }

  async alert(text: string): Promise<void> {
    await this.ask(text, 'ok');
  }
}

class Api implements SaveApi {
  readonly calls: string[] = [];
  refuse: Refusal | null = null;

  async save(session: string, request: SaveRequest): Promise<SaveSuccess | Refusal> {
    this.calls.push(`save ${session} ${JSON.stringify(request)}`);
    return this.refuse ?? { ok: true, name: request.name ?? 'new', kind: 'player', header: header() };
  }

  async loadInPlace(session: string, name: string): Promise<LoadSuccess> {
    this.calls.push(`loadInPlace ${session} ${name}`);
    return { ok: true, name, seed: 1, warnings: ['engineDiffers'], header: header() };
  }

  async createSession(start: SessionStart): Promise<CreatedSession> {
    this.calls.push(`create ${JSON.stringify(start)}`);
    return { session: 'fresh', load: null };
  }

  async deleteSave(name: string): Promise<boolean> {
    this.calls.push(`delete ${name}`);
    return true;
  }
}

const HEALTH: Health = {
  ok: true,
  data: { original: false, slf: 0, stubs: true },
  dataVersion: 'stubs',
  language: 'eng',
  engine: { version: '0.7.0', commit: 'other' },
  files: 1,
};

function setup() {
  const boxes = new Boxes();
  const api = new Api();
  const saves = new SaveController({ labels, health: () => HEALTH, box: boxes, api });
  return { boxes, api, saves };
}

describe('the save controller shared by the launcher and the canvas', () => {
  it('saves a new game with the clamped description and reports a refusal by its text', async () => {
    const { api, saves } = setup();
    expect(await saves.saveNew('s1', `  ${'x'.repeat(60)}  `)).toEqual({ ok: true, name: 'new' });
    expect(api.calls[0]).toBe(`save s1 {"description":"${'x'.repeat(44)}"}`);
    api.refuse = { ok: false, refused: 'ironMan', reason: 'in combat' };
    expect(await saves.saveNew('s1', 'b')).toEqual({ ok: false, cancelled: false, text: '[ironManCannotSave%s]' });
  });

  it('saves over a row only after asking and keeps its description', async () => {
    const { api, boxes, saves } = setup();
    const row = saveRow(listing('mine', '2026-10-01T00:00:00Z'), labels());
    boxes.answer = false;
    expect(await saves.saveOver('s1', row)).toEqual({ ok: false, cancelled: true });
    boxes.answer = true;
    expect(await saves.saveOver('s1', row)).toEqual({ ok: true, name: 'mine' });
    expect(boxes.asked).toEqual(['[confirmOverwritemine]', '[confirmOverwritemine]']);
    expect(api.calls).toEqual(['save s1 {"name":"mine","description":"mine"}']);
  });

  it('asks once about the warnings, then loads in place or into a new session; native saves import', async () => {
    const { api, boxes, saves } = setup();
    const own: SaveListing = listing('mine', '2026-10-01T00:00:00Z');
    expect(await saves.load(own, { kind: 'inPlace', session: 's1' })).toEqual({
      ok: true,
      session: 's1',
      native: false,
      warnings: ['engineDiffers'],
    });
    expect(boxes.asked).toHaveLength(1);
    expect(boxes.asked[0]).toContain('[gameVersionDiffers%s]');
    boxes.answer = false;
    expect(await saves.load(own, { kind: 'newSession' })).toEqual({ ok: false, cancelled: true });
    boxes.answer = true;
    await saves.load(own, { kind: 'newSession' }, 'rus');
    const native: SaveListing = {
      name: 'SaveGame07',
      native: true,
      modified: '2026-10-01T00:00:00Z',
      header: {
        description: 'n',
        world: { day: 1, hour: 1, minute: 0 },
        sector: { x: 9, y: 1, z: 0 },
        mercs: 1,
        balance: 0,
        version: 1,
        options: header().options,
      },
      compatible: true,
      problems: [],
    };
    expect(await saves.loadConfirmed(native, { kind: 'inPlace', session: 's1' })).toMatchObject({
      ok: true,
      session: 'fresh',
      native: true,
    });
    expect(api.calls).toEqual(['loadInPlace s1 mine', 'create {"load":"mine","language":"rus"}', 'create {"save":"SaveGame07"}']);
  });

  it('deletes a save after asking and never a native one', async () => {
    const { api, saves } = setup();
    expect(await saves.delete(saveRow(listing('mine', '2026-10-01T00:00:00Z'), labels()))).toEqual({ ok: true, name: 'mine' });
    expect(api.calls).toEqual(['delete mine']);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import type { ServerMessage, WelcomeMessage } from '../protocol/messages.ts';
import { campaignIdOfOrigin, campaignIdOfSave } from './campaign-id.ts';
import { EMPTY_PRESENTATION } from './save-file.ts';
import type { Session } from './session.ts';

const DIGEST = 'abcdef0123456789abcdef0123456789';
const SCENARIO_MS = 60_000;

let kit: StubSectorKit;
let k: SaveKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  k = await createSaveKit(kit);
});

afterAll(async () => {
  await k.dispose();
  await kit.dispose();
});

function welcomeOf(session: Session): WelcomeMessage {
  let welcome: WelcomeMessage | null = null;
  const stop = session.subscribe((m: ServerMessage) => {
    if (m.t === 'welcome' && !welcome) welcome = m;
  });
  stop();
  if (!welcome) throw new Error('no welcome');
  return welcome;
}

describe('the campaign identity (docs/04 §6.34)', () => {
  it('is new for a campaign, derived from the file for a native import and absent for a sandbox', () => {
    expect(campaignIdOfOrigin({ kind: 'campaign', seed: 1, campaign: {} }, () => 'fresh')).toBe('fresh');
    expect(campaignIdOfOrigin({ kind: 'import', seed: 1, save: 'SaveGame01', digest: DIGEST })).toBe('import:abcdef0123456789');
    expect(campaignIdOfOrigin({ kind: 'sandbox', seed: 1 })).toBeNull();
  });

  it('follows a save, and an older save of a campaign gets one from its digest', () => {
    expect(campaignIdOfSave({ ...EMPTY_PRESENTATION, campaign: 'kept' }, DIGEST, true)).toBe('kept');
    expect(campaignIdOfSave(EMPTY_PRESENTATION, DIGEST, true)).toBe('save:abcdef0123456789');
    expect(campaignIdOfSave(EMPTY_PRESENTATION, DIGEST, false)).toBeNull();
  });

  it(
    'reaches the client in the welcome and survives a save, a load into a new session and a load in place',
    async () => {
      const campaign = await k.open({ seed: 7, campaign: { mercs: 2, land: false } });
      const id = campaign.campaign;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(welcomeOf(campaign).campaign).toBe(id);
      const sandbox = await k.open({ seed: 8 });
      expect(sandbox.campaign).toBeNull();
      expect(welcomeOf(sandbox).campaign).toBeUndefined();
      const saved = await k.saves.save(campaign, { name: 'campaign-id', description: 'the campaign identity' });
      expect(saved.ok).toBe(true);
      const loaded = await k.open({ load: 'campaign-id' });
      expect(loaded.campaign).toBe(id);
      const other = await k.open({ seed: 9, campaign: { mercs: 2, land: false } });
      expect(other.campaign).not.toBe(id);
      await k.saves.loadInto(other, 'campaign-id');
      expect(other.campaign).toBe(id);
      expect(welcomeOf(other).campaign).toBe(id);
    },
    SCENARIO_MS,
  );
});

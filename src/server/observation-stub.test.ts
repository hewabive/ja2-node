import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { OBSERVATION_FIELDS, type ObservationField, observation } from './observation.ts';
import type { SessionRequest } from './session-registry.ts';
import { TextService } from './text-service.ts';

const SEED = 5;
const ASKED: readonly ObservationField[] = ['soldiers', 'strategic', 'laptop', 'prompt', 'canSave'];

const SESSIONS: Readonly<Record<string, SessionRequest>> = {
  sandbox: { seed: SEED },
  landed: { seed: SEED, campaign: { mercs: 6, land: 'skip' } },
  laptop: { seed: SEED, campaign: { hire: [] } },
};

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

function unknownKeys(whole: Record<string, unknown>): string[] {
  const fields = new Set<string>(OBSERVATION_FIELDS);
  return Object.keys(whole).filter((key) => !fields.has(key));
}

function onlyAsked(whole: Record<string, unknown>): Record<string, unknown> {
  const asked = new Set<string>(ASKED);
  return Object.fromEntries(Object.entries(whole).filter(([key]) => asked.has(key)));
}

describe('observe fields on the stub pack', () => {
  const texts = () => new TextService({ vfs: kit.vfs, dataVersion: 'stubs' });

  it.each(Object.keys(SESSIONS))('names every top-level key of the %s observation and narrows it to the keys asked for', async (id) => {
    const host = await k.hostFactory(id, SESSIONS[id] ?? { seed: SEED });
    const labels = texts();
    const whole = await observation(host, labels);
    expect(unknownKeys(whole)).toEqual([]);
    const narrowed = await observation(host, labels, ASKED);
    expect(narrowed).toEqual(onlyAsked(whole));
    expect(Object.keys(narrowed).length).toBeGreaterThan(0);
    await host.close();
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  STORY_MAP_SAVE,
  STORY_MEANWHILE_SAVE,
  STORY_PALACE_SAVE,
  writeStorySaves,
} from '../../tests/support/e2e-story-saves.ts';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import type { SimEvent } from '../sim/events.ts';

const TIMEOUT_MS = 180_000;
const BLEED_TICKS = 1100;
const COMPRESS_STEPS = 20;
const COMPRESS_TICKS = 200;

const types = (events: readonly SimEvent[]) => events.map((e) => e.type);

describe('the stub saves the story e2e loads (docs/28 §10)', { timeout: TIMEOUT_MS }, () => {
  let dir: string;
  let kit: StubSectorKit;
  let saves: SaveKit;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ja2-e2e-story-'));
    await writeStorySaves(dir);
    kit = await loadStubSectorKit();
    saves = await createSaveKit(kit, { dir });
  }, TIMEOUT_MS);

  afterAll(async () => {
    await saves.dispose();
    await kit.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  it('opens a landed campaign on the map screen with its own campaign identity', async () => {
    const session = await saves.open({ load: STORY_MAP_SAVE });
    expect(session.sim.view().strategic).toMatchObject({ flow: 'strategic' });
    expect(session.sim.view().strategic?.gameJustStarted).toBeUndefined();
    expect(session.campaign).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('resolves the due Drassen scene once time is compressed on the map screen', async () => {
    const session = await saves.open({ load: STORY_MEANWHILE_SAVE });
    expect(session.dispatch({ type: 'compressTime', mode: 2 })).toMatchObject({ ok: true });
    const seen: string[] = [];
    for (let k = 0; k < COMPRESS_STEPS && !seen.includes('meanwhile'); k++) seen.push(...types(session.advance({ ticks: COMPRESS_TICKS }).events));
    expect(seen).toContain('meanwhile');
    expect(session.sim.view().strategic?.meanwhiles).toEqual([expect.objectContaining({ seq: 1, scene: 'drassenLiberated' })]);
  });

  it('lets the Queen bleed to death in the palace basement and runs the ending to campaignWon', async () => {
    const session = await saves.open({ load: STORY_PALACE_SAVE });
    expect(session.sim.view().strategic).toMatchObject({ flow: 'tactical', worldSector: 'P3-1' });
    const killed = session.advance({ ticks: BLEED_TICKS });
    expect(types(killed.events)).toContain('queenKilled');
    const won = session.advance({ idle: true });
    expect(won.reason).toBe('ended');
    expect(types(won.events)).toEqual(expect.arrayContaining(['squadMovedUpstairs', 'npcQuote', 'campaignWon']));
  });
});

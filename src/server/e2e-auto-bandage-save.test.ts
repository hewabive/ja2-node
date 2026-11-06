import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTO_BANDAGE_SAVE, writeAutoBandageSave } from '../../tests/support/e2e-auto-bandage-save.ts';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';

describe('the stub save the auto-bandage e2e loads', () => {
  let dir: string;
  let kit: StubSectorKit;
  let saves: SaveKit;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ja2-e2e-auto-bandage-'));
    await writeAutoBandageSave(dir);
    kit = await loadStubSectorKit();
    saves = await createSaveKit(kit, { dir });
  });

  afterAll(async () => {
    await saves.dispose();
    await kit.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  it('opens in a cleared landing sector where a merc bleeds, so the a key asks the question', async () => {
    const session = await saves.open({ load: AUTO_BANDAGE_SAVE });
    expect(session.sim.view().strategic).toMatchObject({ flow: 'tactical', worldSector: 'A9' });
    expect(session.dispatch({ type: 'autoBandage' })).toMatchObject({ ok: true });
    expect(session.sim.view().prompt).toMatchObject({ kind: 'beginAutoBandage' });
  });
});

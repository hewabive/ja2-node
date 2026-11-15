import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IN_THE_OFFICE,
  NIGHT_AMBIENT,
  NIGHT_HOUR,
  NIGHT_LIGHTS_SAVE,
  NIGHT_LIGHTS_SECTOR,
  NORTH_OF_THE_SHAFT_HOUSE,
  OFFICE_DOOR,
  SHAFT_HOUSE_LAMP,
  writeNightLightsSave,
} from '../../tests/support/e2e-night-save.ts';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { Team } from '../sim/tactical/soldier.ts';

describe('the stub save the night lights e2e loads', () => {
  let dir: string;
  let kit: StubSectorKit;
  let saves: SaveKit;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ja2-e2e-night-'));
    await writeNightLightsSave(dir);
    kit = await loadStubSectorKit();
    saves = await createSaveKit(kit, { dir });
  });

  afterAll(async () => {
    await saves.dispose();
    await kit.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  it('opens in the stub mine at night under its lamp, with a merc behind the shaft house and one in the opened office', async () => {
    const session = await saves.open({ load: NIGHT_LIGHTS_SAVE });
    const view = session.sim.view();
    expect(view.strategic).toMatchObject({ flow: 'tactical', worldSector: NIGHT_LIGHTS_SECTOR });
    expect(view.clock).toMatchObject({ hour: NIGHT_HOUR, minute: 0 });
    expect(view.light?.ambient).toBe(NIGHT_AMBIENT);
    expect(view.light?.sprites).toContainEqual(expect.objectContaining(SHAFT_HOUSE_LAMP));
    expect(view.openDoors).toContain(OFFICE_DOOR);
    const ours = view.soldiers.filter((s) => s.team === Team.OUR).map((s) => s.gridNo);
    expect(ours).toEqual(expect.arrayContaining([NORTH_OF_THE_SHAFT_HOUSE, IN_THE_OFFICE]));
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAP_SCREEN_SAVE, type MapScreenSave, writeMapScreenSave } from '../../tests/support/e2e-campaign-saves.ts';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';

describe('the stub campaign save the map-screen e2e loads', () => {
  let dir: string;
  let written: MapScreenSave;
  let kit: StubSectorKit;
  let saves: SaveKit;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ja2-e2e-saves-'));
    written = await writeMapScreenSave(dir);
    kit = await loadStubSectorKit();
    saves = await createSaveKit(kit, { dir });
  });

  afterAll(async () => {
    await saves.dispose();
    await kit.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  it('loads with the squad in Drassen, the helicopter beside it and time free to run', async () => {
    expect(written).toMatchObject({ name: MAP_SCREEN_SAVE, sector: 'D13', helicopter: 'D13', town: 2 });
    expect(written.mercs).toHaveLength(4);
    expect(written.mercs).toContain(written.trainer);
    const session = await saves.open({ load: MAP_SCREEN_SAVE, reseed: false });
    const view = session.sim.view();
    const s = view.strategic;
    expect(s?.flow).toBe('strategic');
    expect(view.clock).toMatchObject({ canCompress: true });
    expect(s?.mercs.every((m) => m.sector === 'D13' && !m.betweenSectors)).toBe(true);
    expect(s?.helicopter).toMatchObject({ sector: 'D13', canFly: true, owed: 0 });
    expect(s?.sectors.find((x) => x.sector === 'D13')).toMatchObject({ playerControlled: true, militiaTraining: 0 });
    expect(s?.towns).toContainEqual({ town: 2, loyalty: 50 });

    const training = session.dispatch({ type: 'assign', soldiers: [written.trainer], to: { kind: 'trainMilitia' } });
    expect(training).toMatchObject({ ok: true });
    expect(session.sim.view().prompt).toMatchObject({ kind: 'militiaPayment' });
    expect(session.dispatch({ type: 'answer', choice: 'yes' })).toMatchObject({ ok: true });

    const [pilotless] = written.mercs.filter((id) => id !== written.trainer);
    expect(session.dispatch({ type: 'boardVehicle', soldier: pilotless, vehicle: 'helicopter' })).toMatchObject({ ok: true });
    expect(session.dispatch({ type: 'heliRoute', to: 'B13' })).toMatchObject({ ok: true, data: { path: ['D13', 'C13', 'B13'] } });
    expect(session.dispatch({ type: 'route', soldier: written.trainer, to: 'C13' })).toMatchObject({ data: { refusal: 'onAssignment' } });
  });
});

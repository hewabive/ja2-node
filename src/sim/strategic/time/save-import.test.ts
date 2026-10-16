import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSaveGame } from '../../../content/formats/savegame.ts';
import { parseSaveEncryptionTable } from '../../../content/formats/savegame-header.ts';
import { CampaignSim } from '../../campaign/campaign-sim.ts';
import { createStrategicState } from '../state.ts';
import { CompressMode, EventKind, NUM_SEC_IN_HOUR } from './constants.ts';
import { importStrategicTime } from './save-import.ts';
import { worldDay, worldHour, worldMinute } from './world-clock.ts';

const dataDir = process.env.JA2_DATA_DIR ?? '';
const root = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = join(root, 'SavedGames');
const saves = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];
const encryption = () =>
  parseSaveEncryptionTable(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../data/tables/save-encryption.json'), 'utf8')));

describe.skipIf(!process.env.JA2_DATA_DIR)('strategic time from native saves', () => {
  for (const file of saves) {
    it(`continues the clock and the event queue of ${file}`, () => {
      const save = parseSaveGame(new Uint8Array(readFileSync(join(savesDir, file))), encryption());
      const state = createStrategicState();
      importStrategicTime(state, save);
      expect([worldDay(state.clock), worldHour(state.clock), worldMinute(state.clock)]).toEqual([
        save.header.day,
        save.header.hour,
        save.header.minute,
      ]);
      const kept = save.strategicEvents.filter((e) => e.callbackId !== EventKind.AMBIENT);
      expect(state.queue.events.map((e) => [e.stamp, e.kind])).toEqual(kept.map((e) => [e.timeStamp, e.callbackId]));
      const stamps = state.queue.events.map((e) => e.stamp);
      expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
      state.flow = 'strategic';
      state.clock.paused = false;
      state.clock.pauseLocked = false;
      const campaign = new CampaignSim(state);
      const hourly: number[] = [];
      campaign.dispatchTable.register(EventKind.HOURLY_UPDATE, (c) => hourly.push(c.state.clock.seconds));
      expect(campaign.dispatch({ type: 'compressTime', mode: CompressMode.MIN60 })).toEqual({ ok: true });
      const target = state.clock.seconds + 6 * NUM_SEC_IN_HOUR;
      while (state.clock.seconds < target) campaign.step();
      expect(hourly.length).toBeGreaterThanOrEqual(5);
      expect(hourly.every((s) => s % NUM_SEC_IN_HOUR === 0)).toBe(true);
    });
  }
});

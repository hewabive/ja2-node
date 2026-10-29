import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { parseSaveGame, type SaveGame } from '../../../content/formats/savegame.ts';
import { parseSaveEncryptionTable } from '../../../content/formats/savegame-header.ts';
import type { GameClock } from '../../../content/formats/savegame-tactical.ts';
import { CampaignSim } from '../../campaign/campaign-sim.ts';
import { SectorFlag } from '../forces/constants.ts';
import { sectorInfo } from '../map/sectors.ts';
import { createStrategicState, type StrategicState } from '../state.ts';
import { CompressMode, EventKind, NUM_SEC_IN_HOUR, STARTING_TIME } from './constants.ts';
import { importStrategicTime } from './save-import.ts';
import { worldDay, worldHour, worldMinute } from './world-clock.ts';

const dataDir = ORIGINAL_DATA_DIR;
const root = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = join(root, 'SavedGames');
const saves = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];
const encryption = () =>
  parseSaveEncryptionTable(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../data/tables/save-encryption.json'), 'utf8')));
const SAVED_CLOCK: GameClock = {
  timeCompressMode: CompressMode.X0,
  clockResolution: 0,
  gamePaused: false,
  timeInterrupt: false,
  superCompression: false,
  gameClock: STARTING_TIME + 8 * NUM_SEC_IN_HOUR,
  gameSecondsPerRealSecond: 0,
  ambientLightLevel: 0,
  envTime: 0,
  envDay: 0,
  envLightValue: 0,
  timeOfLastEventQuery: 0,
  lockPauseState: false,
  pauseDueToPlayerGamePause: false,
  resetAllPlayerKnowsEnemiesFlags: false,
  timeCompressionOn: false,
  previousGameClock: STARTING_TIME + 8 * NUM_SEC_IN_HOUR,
  lockPauseStateLastReasonId: 0,
};
const DRASSEN = { x: 13, y: 4 };

interface ClockFlags {
  readonly didGameJustStart?: boolean;
  readonly resetAllPlayerKnowsEnemiesFlags?: boolean;
}

function savedClockFlags({ didGameJustStart = false, resetAllPlayerKnowsEnemiesFlags = false }: ClockFlags): SaveGame {
  return {
    clock: { ...SAVED_CLOCK, resetAllPlayerKnowsEnemiesFlags },
    tactical: { didGameJustStart },
    generalInfo: { baseJA2Clock: 0, atLeastOneMercWasHired: true },
    strategicEvents: [],
  } as unknown as SaveGame;
}

function advanceOneTick(state: StrategicState): void {
  state.flow = 'strategic';
  const campaign = new CampaignSim(state);
  expect(campaign.dispatch({ type: 'compressTime', mode: CompressMode.MIN5 })).toEqual({ ok: true });
  const before = state.clock.seconds;
  while (state.clock.seconds === before) campaign.step();
}

describe('the clock flags of an import', () => {
  it('continues a save made before the first arrival as a game that has just started (LoadSaveTacticalStatusType.cc fDidGameJustStart)', () => {
    const state = createStrategicState();
    importStrategicTime(state, savedClockFlags({ didGameJustStart: true }));
    expect(state.didGameJustStart).toBe(true);
    importStrategicTime(state, savedClockFlags({}));
    expect(state.didGameJustStart).toBe(false);
  });

  it('stops the known enemy counts flashing once the clock advances with no enemy in the sector, as the saved reset flag asks (Game_Clock.cc AdvanceClock)', () => {
    const state = createStrategicState();
    importStrategicTime(state, savedClockFlags({ resetAllPlayerKnowsEnemiesFlags: true }));
    sectorInfo(state.map, DRASSEN).flags |= SectorFlag.PLAYER_KNOWS_ENEMIES_ARE_HERE;
    advanceOneTick(state);
    expect(sectorInfo(state.map, DRASSEN).flags & SectorFlag.PLAYER_KNOWS_ENEMIES_ARE_HERE).toBe(0);
    expect(state.battle.resetAllPlayerKnowsEnemiesFlags).toBe(false);
  });

  it('keeps the known enemy counts flashing when the save did not ask for a reset', () => {
    const state = createStrategicState();
    importStrategicTime(state, savedClockFlags({}));
    sectorInfo(state.map, DRASSEN).flags |= SectorFlag.PLAYER_KNOWS_ENEMIES_ARE_HERE;
    advanceOneTick(state);
    expect(sectorInfo(state.map, DRASSEN).flags & SectorFlag.PLAYER_KNOWS_ENEMIES_ARE_HERE).not.toBe(0);
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('strategic time from native saves', () => {
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
      expect(state.didGameJustStart).toBe(save.tactical.didGameJustStart);
      expect(state.battle.resetAllPlayerKnowsEnemiesFlags).toBe(save.clock.resetAllPlayerKnowsEnemiesFlags);
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

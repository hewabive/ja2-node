// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Clock.cc LoadGameClock; Game_Events.cc LoadStrategicEventsFromSavedGame;
// @src SaveLoadGame.cc LoadSavedGame (clock and event queue). See docs/15 §5.

import type { SaveGame } from '../../../content/formats/savegame.ts';
import type { StrategicState } from '../state.ts';
import { EventKind } from './constants.ts';

const SEF_DELETION_PENDING = 0x02;

export function importStrategicTime(state: StrategicState, save: SaveGame): void {
  const c = state.clock;
  const saved = save.clock;
  c.seconds = saved.gameClock;
  c.previousSeconds = saved.previousGameClock;
  c.mode = saved.timeCompressMode;
  c.resolution = saved.clockResolution;
  c.secondsPerRealSecond = saved.gameSecondsPerRealSecond;
  c.compressionOn = saved.timeCompressionOn;
  c.paused = saved.gamePaused;
  c.pauseLocked = saved.lockPauseState;
  c.pauseLockReason = saved.lockPauseStateLastReasonId;
  c.timeInterrupt = saved.timeInterrupt;
  c.playerPause = saved.pauseDueToPlayerGamePause;
  c.lastEventQuerySeconds = saved.timeOfLastEventQuery;
  state.env.lightValue = saved.envLightValue;
  state.realMs = save.generalInfo.baseJA2Clock;
  state.atLeastOneMercHired = save.generalInfo.atLeastOneMercWasHired;
  c.driver.lastSecondMs = state.realMs;
  const q = state.queue;
  q.events.length = 0;
  for (const e of save.strategicEvents) {
    if (e.callbackId === EventKind.AMBIENT || e.flags & SEF_DELETION_PENDING) continue;
    q.events.push({
      stamp: e.timeStamp,
      kind: e.callbackId,
      frequency: e.eventType,
      param: e.param,
      offset: e.timeOffset,
      seq: q.nextSeq++,
    });
  }
}

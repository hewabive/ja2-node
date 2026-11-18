// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Environment.cc DAWN_START, DAY_START, DUSK_START, NIGHT_START, BuildDayAmbientSounds;
// @src TileEngine/Ambient_Control.cc HandleNewSectorAmbience, SetupNewAmbientSound; src/sgp/SoundMan.cc SoundPlayRandom,
// @src SoundStartRandom (the gap between plays).
// @src src/game/GameLoop.cc GameLoop, Utils/Music_Control.cc MusicPoll (random sounds serviced on every screen); Laptop/Laptop.cc,
// @src Options_Screen.cc StopAmbients; Strategic/StrategicMap.cc CheckAndHandleUnloadingOfCurrentWorld DeleteAllAmbients (2026-11-18).

import { type AmbientEntry, AmbientTime, ambientSoundPath } from '../formats/ambient.ts';
import { type Cue, cueOf, type Rand } from './cue.ts';

const MINUTES_PER_DAY = 24 * 60;
const DAWN_START = 6 * 60 + 47;
const DAY_START = 7 * 60 + 5;
const DUSK_START = 20 * 60 + 57;
const NIGHT_START = 21 * 60 + 15;

export interface AmbientWindow {
  readonly start: number;
  readonly length: number;
}

const WINDOWS: Readonly<Record<number, AmbientWindow>> = {
  [AmbientTime.DAWN]: { start: DAWN_START, length: DAY_START - DAWN_START },
  [AmbientTime.DAY]: { start: DAY_START, length: DUSK_START - DAY_START },
  [AmbientTime.DUSK]: { start: DUSK_START, length: NIGHT_START - DUSK_START },
  [AmbientTime.NIGHT]: { start: NIGHT_START, length: MINUTES_PER_DAY - NIGHT_START + DAWN_START },
};

export function ambientWindow(timeCategory: number): AmbientWindow | null {
  return WINDOWS[timeCategory] ?? null;
}

export function ambientActive(entry: AmbientEntry, minuteOfDay: number): boolean {
  const w = ambientWindow(entry.timeCategory);
  if (!w) return false;
  const since = (((minuteOfDay - w.start) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return since < w.length;
}

export function ambientGapMs(entry: AmbientEntry, rand: Rand): number {
  return entry.minTimeMs + rand(Math.max(0, entry.maxTimeMs - entry.minTimeMs));
}

export function ambientCue(entry: AmbientEntry): Cue {
  return cueOf(ambientSoundPath(entry), 'ambient', entry.volume);
}

const MAP_SCREEN = 'map';
const SCREENS_THAT_STOP_AMBIENTS: ReadonlySet<string> = new Set(['laptop', 'options']);

export function ambientsOffTheTacticalScreen(shown: string | undefined, worldLoaded: boolean): 'service' | 'stop' | 'leave' {
  if (shown === MAP_SCREEN) return worldLoaded ? 'service' : 'stop';
  return shown !== undefined && SCREENS_THAT_STOP_AMBIENTS.has(shown) ? 'stop' : 'leave';
}

export function ambientSilenced(map: { readonly basement: boolean; readonly caves: boolean } | null): boolean {
  return map !== null && (map.basement || map.caves);
}

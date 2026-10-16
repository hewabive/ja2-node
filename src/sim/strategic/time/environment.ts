// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Environment.cc BuildDayLightLevels, UpdateTemperature, SectorTemperature,
// @src GetTimeOfDayAmbientLightLevel; Environment.h. See docs/15 §1.10.

import { EventKind } from './constants.ts';
import { addEveryDayStrategicEvent, type EventQueue } from './event-queue.ts';
import type { WorldClock } from './world-clock.ts';

export const NORMAL_LIGHTLEVEL_NIGHT = 12;
export const NORMAL_LIGHTLEVEL_DAY = 3;
export const HOT_DAY_LIGHTLEVEL = 2;
const DAWN_START = 6 * 60 + 47;
const DUSK_START = 20 * 60 + 57;
const LIGHT_STEPS = 9;
const LIGHT_STEP_MINUTES = 2;
const NIGHT_TIME_LIGHT_START_HOUR = 21;
const NIGHT_TIME_LIGHT_END_HOUR = 7;
const PRIME_TIME_LIGHT_START_HOUR = 21;
const PRIME_TIME_LIGHT_END_HOUR = 24;
const HOURS_IN_DAY = 24;

export const Temperature = { COOL: 0, WARM: 1, HOT: 2 } as const;
export const TemperatureEvent = { DESERT_COOL: 0, DESERT_WARM: 1, DESERT_HOT: 2, GLOBAL_COOL: 3, GLOBAL_WARM: 4, GLOBAL_HOT: 5 } as const;

const TEMPERATURE_SCHEDULE: readonly (readonly [number, number])[] = [
  [8 * 60, TemperatureEvent.DESERT_WARM],
  [9 * 60, TemperatureEvent.DESERT_HOT],
  [17 * 60, TemperatureEvent.DESERT_WARM],
  [19 * 60, TemperatureEvent.DESERT_COOL],
  [9 * 60, TemperatureEvent.GLOBAL_WARM],
  [12 * 60, TemperatureEvent.GLOBAL_HOT],
  [14 * 60, TemperatureEvent.GLOBAL_WARM],
  [17 * 60, TemperatureEvent.GLOBAL_COOL],
];

export interface Environment {
  lightValue: number;
  desertTemperature: number;
  globalTemperature: number;
  doLighting: boolean;
}

export function createEnvironment(): Environment {
  return { lightValue: 0, desertTemperature: 0, globalTemperature: 0, doLighting: false };
}

const hourMinutes = (hour: number) => (hour === HOURS_IN_DAY ? 0 : hour) * 60;

export function buildDayLightLevels(q: EventQueue, c: WorldClock): void {
  for (let k = 0; k < LIGHT_STEPS; k++)
    addEveryDayStrategicEvent(q, c, EventKind.CHANGELIGHTVAL, DAWN_START + LIGHT_STEP_MINUTES * k, NORMAL_LIGHTLEVEL_NIGHT - 1 - k);
  for (const [minute, code] of TEMPERATURE_SCHEDULE) addEveryDayStrategicEvent(q, c, EventKind.TEMPERATURE_UPDATE, minute, code);
  for (let k = 0; k < LIGHT_STEPS; k++)
    addEveryDayStrategicEvent(q, c, EventKind.CHANGELIGHTVAL, DUSK_START + LIGHT_STEP_MINUTES * k, NORMAL_LIGHTLEVEL_DAY + 1 + k);
  addEveryDayStrategicEvent(q, c, EventKind.TURN_ON_NIGHT_LIGHTS, hourMinutes(NIGHT_TIME_LIGHT_START_HOUR), 0);
  addEveryDayStrategicEvent(q, c, EventKind.TURN_OFF_NIGHT_LIGHTS, hourMinutes(NIGHT_TIME_LIGHT_END_HOUR), 0);
  addEveryDayStrategicEvent(q, c, EventKind.TURN_ON_PRIME_LIGHTS, hourMinutes(PRIME_TIME_LIGHT_START_HOUR), 0);
  addEveryDayStrategicEvent(q, c, EventKind.TURN_OFF_PRIME_LIGHTS, hourMinutes(PRIME_TIME_LIGHT_END_HOUR), 0);
}

export function changeLightValue(env: Environment, value: number, underground: boolean): void {
  env.lightValue = value;
  if (!underground) env.doLighting = true;
}

export function updateTemperature(env: Environment, code: number): void {
  if (code === TemperatureEvent.DESERT_COOL) env.desertTemperature = Temperature.COOL;
  else if (code === TemperatureEvent.DESERT_WARM) env.desertTemperature = Temperature.WARM;
  else if (code === TemperatureEvent.DESERT_HOT) env.desertTemperature = Temperature.HOT;
  else if (code === TemperatureEvent.GLOBAL_COOL) env.globalTemperature = Temperature.COOL;
  else if (code === TemperatureEvent.GLOBAL_WARM) env.globalTemperature = Temperature.WARM;
  else if (code === TemperatureEvent.GLOBAL_HOT) env.globalTemperature = Temperature.HOT;
  env.doLighting = true;
}

export function sectorTemperature(env: Environment, z: number, desert: boolean): number {
  if (z > 0) return Temperature.COOL;
  return desert ? env.desertTemperature : env.globalTemperature;
}

export function timeOfDayAmbientLightLevel(env: Environment, z: number, desert: boolean): number {
  return sectorTemperature(env, z, desert) === Temperature.HOT ? HOT_DAY_LIGHTLEVEL : env.lightValue;
}

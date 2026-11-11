import type { DriverMode } from '../../protocol/messages.ts';

export interface DriverChoice {
  readonly value: string;
  readonly label: string;
  readonly driver: DriverMode;
}

const REALTIME_SPEEDS: readonly number[] = [1, 2, 4, 8];

function realtimeChoice(speed: number): DriverChoice {
  return { value: `realtime-${speed}`, label: `real time ${speed}×`, driver: { mode: 'realtime', speed } };
}

export const DRIVER_CHOICES: readonly DriverChoice[] = [
  { value: 'manual', label: 'paused', driver: { mode: 'manual' } },
  ...REALTIME_SPEEDS.map(realtimeChoice),
  { value: 'instant', label: 'instant', driver: { mode: 'instant' } },
];

export function driverChoiceOf(driver: DriverMode): DriverChoice {
  if (driver.mode !== 'realtime') return DRIVER_CHOICES.find((c) => c.driver.mode === driver.mode) ?? realtimeChoice(1);
  return DRIVER_CHOICES.find((c) => c.driver.mode === 'realtime' && c.driver.speed === driver.speed) ?? realtimeChoice(driver.speed);
}

export function driverChoices(current: DriverMode | undefined): readonly DriverChoice[] {
  if (!current) return DRIVER_CHOICES;
  const choice = driverChoiceOf(current);
  return DRIVER_CHOICES.includes(choice) ? DRIVER_CHOICES : [...DRIVER_CHOICES, choice];
}

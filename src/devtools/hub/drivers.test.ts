import { describe, expect, it } from 'vitest';
import { DRIVER_CHOICES, driverChoiceOf, driverChoices } from './drivers.ts';

describe('developer hub time drivers', () => {
  it('offers the pause, real time at 1× to 8× and the instant driver', () => {
    expect(DRIVER_CHOICES.map((c) => c.value)).toEqual(['manual', 'realtime-1', 'realtime-2', 'realtime-4', 'realtime-8', 'instant']);
  });

  it("finds the choice of the session's driver, and adds a real-time speed it does not offer", () => {
    expect(driverChoiceOf({ mode: 'instant' }).label).toBe('instant');
    expect(driverChoiceOf({ mode: 'realtime', speed: 4 }).value).toBe('realtime-4');
    expect(driverChoiceOf({ mode: 'realtime', speed: 3 })).toMatchObject({ value: 'realtime-3', label: 'real time 3×' });
    expect(driverChoices({ mode: 'realtime', speed: 3 }).at(-1)?.value).toBe('realtime-3');
    expect(driverChoices({ mode: 'manual' })).toBe(DRIVER_CHOICES);
  });
});

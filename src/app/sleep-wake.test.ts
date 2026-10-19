import { describe, expect, it } from 'vitest';
import type { ViewFrame } from '../protocol/view.ts';
import { DEFAULT_SETTINGS, updateSettings } from '../ui/settings.ts';
import { sleepWakeNotice, sleepWakeStop } from './sleep-wake.ts';

type FrameEvent = NonNullable<ViewFrame['events']>[number];

const ON = DEFAULT_SETTINGS;
const OFF = updateSettings(DEFAULT_SETTINGS, { sleepWakeNotification: false });
const MERCS = [
  { id: 1, squad: 0 },
  { id: 2, squad: null },
  { id: 3, squad: null, vehicle: 9 },
];

const asleep = (soldier: number, collapsed = false) => ({ type: 'fellAsleep', tick: 1, soldier, collapsed }) as unknown as FrameEvent;
const awake = (soldier: number) => ({ type: 'wokeUp', tick: 1, soldier }) as unknown as FrameEvent;

describe('sleep and wake notification', () => {
  it('adds the two events to a stop condition only when the setting is on', () => {
    expect(sleepWakeStop({ compressionStopped: true }, ON)).toEqual({ compressionStopped: true, events: ['fellAsleep', 'wokeUp'] });
    expect(sleepWakeStop({ idle: true, events: ['wokeUp', 'arrived'] }, ON).events).toEqual(['wokeUp', 'arrived', 'fellAsleep']);
    const until = { compressionStopped: true };
    expect(sleepWakeStop(until, OFF)).toBe(until);
  });

  it('notifies mercs who fell asleep on their own and mercs off a squad or vehicle who woke up', () => {
    expect(sleepWakeNotice([asleep(2), awake(1), awake(2), awake(3), awake(7)], MERCS, ON)).toEqual({ asleep: [2], awake: [2, 7] });
  });

  it('ignores collapses, squad members waking up and everything when the setting is off', () => {
    expect(sleepWakeNotice([asleep(2, true), awake(1), awake(3)], MERCS, ON)).toBeNull();
    expect(sleepWakeNotice([asleep(2), awake(2)], MERCS, OFF)).toBeNull();
    expect(sleepWakeNotice([], MERCS, ON)).toBeNull();
  });
});

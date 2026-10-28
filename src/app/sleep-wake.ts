// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc HandleRestFatigueAndSleepStatus (the update box only for mercs who fall asleep on
// @src their own off a squad and for mercs off a squad or vehicle who wake up, when TOPTION_SLEEPWAKE_NOTIFICATION is on).

import type { StopCondition } from '../protocol/messages.ts';
import type { StrategicMercView, ViewFrame } from '../protocol/view.ts';
import type { ClientSettings } from '../ui/settings.ts';

type FrameEvent = NonNullable<ViewFrame['events']>[number];
type EventType = FrameEvent['type'];

const SLEEP_WAKE_EVENTS = ['fellAsleep', 'wokeUp'] as const satisfies readonly EventType[];

export interface SleepWakeNotice {
  readonly asleep: readonly number[];
  readonly awake: readonly number[];
}

type NotificationSetting = Pick<ClientSettings, 'sleepWakeNotification'>;
type MercPlace = Pick<StrategicMercView, 'id' | 'squad' | 'vehicle'>;

export function sleepWakeStop(until: StopCondition, settings: NotificationSetting): StopCondition {
  if (!settings.sleepWakeNotification) return until;
  return { ...until, events: [...new Set([...(until.events ?? []), ...SLEEP_WAKE_EVENTS])] };
}

function offSquad(soldier: number, mercs: readonly MercPlace[]): boolean {
  const merc = mercs.find((m) => m.id === soldier);
  return !merc || (merc.squad === null && merc.vehicle === undefined);
}

export function sleepWakeNotice(
  events: readonly FrameEvent[],
  mercs: readonly MercPlace[],
  settings: NotificationSetting,
): SleepWakeNotice | null {
  if (!settings.sleepWakeNotification) return null;
  const asleep: number[] = [];
  const awake: number[] = [];
  for (const event of events) {
    if (event.type === 'fellAsleep' && !event.collapsed) asleep.push(event.soldier);
    else if (event.type === 'wokeUp' && offSquad(event.soldier, mercs)) awake.push(event.soldier);
  }
  return asleep.length > 0 || awake.length > 0 ? { asleep, awake } : null;
}

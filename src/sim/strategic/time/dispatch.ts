// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Event_Hook.cc ExecuteStrategicEvent, DelayEventIfBattleInProgress.

import type { StrategicEvent } from './event-queue.ts';

export type EventHandler<S> = (state: S, event: StrategicEvent) => void;

export class EventDispatch<S> {
  readonly #handlers = new Map<number, EventHandler<S>>();

  register(kind: number, handler: EventHandler<S>): void {
    this.#handlers.set(kind, handler);
  }

  execute(state: S, event: StrategicEvent): boolean {
    this.#handlers.get(event.kind)?.(state, event);
    return true;
  }
}

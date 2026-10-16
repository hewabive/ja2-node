// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Event_Pump.cc AddGameEvent, DequeAllGameEvents, ExecuteGameEvent (primary queue). See docs/11 §1.2.

import { setDesiredDirection } from './animation.ts';
import { eventFireSoldierWeapon, fireWeapon } from './combat/attack.ts';
import type { TacticalState } from './state.ts';

export type GameEvent =
  | { readonly kind: 'desiredDirection'; readonly soldier: number; readonly direction: number }
  | {
      readonly kind: 'beginFireWeapon';
      readonly soldier: number;
      readonly target: number;
      readonly level: number;
      readonly cubeLevel: number;
    }
  | { readonly kind: 'fireWeapon'; readonly soldier: number; readonly target: number; readonly level: number; readonly cubeLevel: number };

export function dequeueAllGameEvents(t: TacticalState): void {
  for (let e = t.gameEvents.shift(); e; e = t.gameEvents.shift()) {
    const s = t.soldiers[e.soldier];
    if (!s?.placed) continue;
    switch (e.kind) {
      case 'desiredDirection':
        setDesiredDirection(t, s, e.direction);
        break;
      case 'beginFireWeapon':
        s.targetGridNo = e.target;
        s.targetLevel = e.level;
        s.targetCubeLevel = e.cubeLevel;
        eventFireSoldierWeapon(t, s, e.target);
        break;
      case 'fireWeapon':
        s.targetGridNo = e.target;
        s.targetLevel = e.level;
        s.targetCubeLevel = e.cubeLevel;
        fireWeapon(t, s, e.target);
        break;
    }
  }
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc StopSoldier (the services cancelled, EVENT_StopMerc only out of an
// @src ANIM_STATIONARY animation, the final destination set to his tile); the walk-ups the stop order drops besides.

import { AnimFlags } from '../../content/anim/tables.ts';
import { hasAnimFlag } from './animation.ts';
import { cancelAllServices } from './first-aid.ts';
import { clearPendingGive } from './give.ts';
import { stopMerc } from './movement.ts';
import { cancelPendingRobotReload } from './robot-reload.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

function dropWalkUps(t: TacticalState, s: Soldier): void {
  s.pendingAid = null;
  s.pendingDoorAction = null;
  s.pendingTalk = null;
  clearPendingGive(t, s);
  cancelPendingRobotReload(t, s);
}

export function stopSoldier(t: TacticalState, s: Soldier): void {
  cancelAllServices(t, s);
  dropWalkUps(t, s);
  if (!hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY)) stopMerc(t, s);
  s.finalDestination = s.gridNo;
}

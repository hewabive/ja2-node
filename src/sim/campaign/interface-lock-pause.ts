// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc UIHandleLUIBeginLock and UIHandleLUIEndLock (the pause under LOCK_PAUSE_LOCKUI_MODE and
// @src its lift unless ENGAGED_IN_CONV), CheckForDisabledRegionRemove (from GameScreen.cc InternalLeaveTacticalScreen).

import { lockPauseState, pauseGame, unLockPauseState, unPauseGame, type WorldClock } from '../strategic/time/world-clock.ts';
import { playerInterfaceLocked } from '../tactical/interface-lock.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';

const LOCK_PAUSE_LOCKUI_MODE = 16;

function tacticalOnScreen(campaign: CampaignSim): TacticalState | null {
  return campaign.state.flow === 'tactical' ? (campaign.tactical?.state ?? null) : null;
}

function beginLockPause(clock: WorldClock): void {
  pauseGame(clock);
  lockPauseState(clock, LOCK_PAUSE_LOCKUI_MODE);
}

function liftAnyPause(clock: WorldClock): void {
  unLockPauseState(clock);
  unPauseGame(clock);
}

export function syncInterfaceLockPause(campaign: CampaignSim): void {
  const t = tacticalOnScreen(campaign);
  const locked = t !== null && playerInterfaceLocked(t);
  const flow = campaign.state.sectorFlow;
  if (locked === flow.interfaceLockActive) return;
  flow.interfaceLockActive = locked;
  const clock = campaign.state.clock;
  if (locked) beginLockPause(clock);
  else if (t === null || !t.engagedInConv) liftAnyPause(clock);
}

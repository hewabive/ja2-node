import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import type { StrategicState } from '../strategic/state.ts';
import { createWorldClock, lockPauseState, pauseGame, type WorldClock } from '../strategic/time/world-clock.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { setAutoBandageMode, type TacticalState, WaitForMercs } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { createSectorFlowState } from './flow-state.ts';
import { syncInterfaceLockPause } from './interface-lock-pause.ts';

const LOCK_PAUSE_LOCKUI_MODE = 16;
const LOCK_PAUSE_CONTRACT_RENEWAL = 7;
const LOCK_PAUSE_PREBATTLE = 12;

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

interface Rig {
  readonly campaign: CampaignSim;
  readonly state: { flow: StrategicState['flow']; readonly clock: WorldClock };
  readonly t: TacticalState;
}

function rig(): Rig {
  const t = newCombatSim(content).state;
  t.inCombat = false;
  const state = { flow: 'tactical' as StrategicState['flow'], clock: createWorldClock(), sectorFlow: createSectorFlowState() };
  const campaign = { state, tactical: { state: t } } as unknown as CampaignSim;
  return { campaign, state, t };
}

function walkOff(t: TacticalState): void {
  t.mercsWaiting = { code: WaitForMercs.WALKOFF_SCREEN, remaining: 1, sinceMs: t.clockMs };
}

function pauseOf(clock: WorldClock): [boolean, boolean, number] {
  return [clock.paused, clock.pauseLocked, clock.pauseLockReason];
}

describe('the interface lock pause', () => {
  it('pauses the game under LOCK_PAUSE_LOCKUI_MODE when the lock begins and lifts it when the lock ends (Handle_UI.cc UIHandleLUIBeginLock, UIHandleLUIEndLock)', () => {
    const { campaign, state, t } = rig();
    walkOff(t);
    syncInterfaceLockPause(campaign);
    expect(pauseOf(state.clock)).toEqual([true, true, LOCK_PAUSE_LOCKUI_MODE]);
    t.mercsWaiting = null;
    syncInterfaceLockPause(campaign);
    expect(pauseOf(state.clock)).toEqual([false, false, LOCK_PAUSE_LOCKUI_MODE]);
  });

  it('lifts any pause and pause lock when it ends, whoever set them, so a renewal lock set under it goes too', () => {
    const { campaign, state, t } = rig();
    pauseGame(state.clock);
    lockPauseState(state.clock, LOCK_PAUSE_PREBATTLE);
    walkOff(t);
    syncInterfaceLockPause(campaign);
    lockPauseState(state.clock, LOCK_PAUSE_CONTRACT_RENEWAL);
    t.mercsWaiting = null;
    syncInterfaceLockPause(campaign);
    expect(pauseOf(state.clock)).toEqual([false, false, LOCK_PAUSE_CONTRACT_RENEWAL]);
  });

  it('pauses once while its sources overlap and lifts the pause with the last of them, not the first', () => {
    const { campaign, state, t } = rig();
    walkOff(t);
    syncInterfaceLockPause(campaign);
    t.boxing.uiLocked = true;
    t.mercsWaiting = null;
    lockPauseState(state.clock, LOCK_PAUSE_CONTRACT_RENEWAL);
    syncInterfaceLockPause(campaign);
    expect(pauseOf(state.clock)).toEqual([true, true, LOCK_PAUSE_CONTRACT_RENEWAL]);
    t.boxing.uiLocked = false;
    syncInterfaceLockPause(campaign);
    expect(pauseOf(state.clock)).toEqual([false, false, LOCK_PAUSE_CONTRACT_RENEWAL]);
  });

  it('leaves the pause to the conversation when the lock ends inside one (ENGAGED_IN_CONV)', () => {
    const { campaign, state, t } = rig();
    walkOff(t);
    syncInterfaceLockPause(campaign);
    t.engagedInConv = true;
    t.mercsWaiting = null;
    syncInterfaceLockPause(campaign);
    expect(pauseOf(state.clock)).toEqual([true, true, LOCK_PAUSE_LOCKUI_MODE]);
    expect(campaign.state.sectorFlow.interfaceLockActive).toBe(false);
  });

  it('leaves the auto-bandage pause alone while a lock begins and ends inside the mode, whose frame never reaches HandleTacticalUI', () => {
    const { campaign, state, t } = rig();
    setAutoBandageMode(t, true);
    pauseGame(state.clock);
    walkOff(t);
    syncInterfaceLockPause(campaign);
    expect(pauseOf(state.clock)).toEqual([true, false, 0]);
    t.mercsWaiting = null;
    syncInterfaceLockPause(campaign);
    expect(pauseOf(state.clock)).toEqual([true, false, 0]);
    expect(campaign.state.sectorFlow.interfaceLockActive).toBe(false);
  });

  it('lifts the pause when the game leaves tactical under a lock, even inside a conversation (CheckForDisabledRegionRemove), and pauses again on a return while its source holds', () => {
    const { campaign, state, t } = rig();
    walkOff(t);
    syncInterfaceLockPause(campaign);
    t.engagedInConv = true;
    state.flow = 'strategic';
    syncInterfaceLockPause(campaign);
    expect(pauseOf(state.clock)).toEqual([false, false, LOCK_PAUSE_LOCKUI_MODE]);
    state.flow = 'tactical';
    syncInterfaceLockPause(campaign);
    expect(pauseOf(state.clock)).toEqual([true, true, LOCK_PAUSE_LOCKUI_MODE]);
  });
});

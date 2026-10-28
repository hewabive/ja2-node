import { Rng } from '../../core/rng.ts';
import type { CivQuoteSaid } from '../narrative/civ-quotes.ts';
import { createTalkState, type TalkState } from '../narrative/talk-state.ts';
import { NO_CURRENT_SQUAD } from '../strategic/forces/constants.ts';
import { SRC_PROFILE_AT_START } from '../strategic/narrative/check-fact.ts';
import { createRealtimeClock, type RealtimeClock } from '../tactical/state.ts';
import type { AdjacentJump } from './sector-exits.ts';
import type { ShopSession } from './shop-flow.ts';

const HELICOPTER_COSMETIC_SALT = 0x48454c49;
const AUTORESOLVE_COSMETIC_SALT = 0x41520001;

export interface SessionState {
  tick: number;
  compressing: boolean;
  day: number;
}

export interface SectorFlowState {
  readonly realtimeClock: RealtimeClock;
  jump: AdjacentJump | null;
  usingEdgepointsForEntry: boolean;
  overrideInsertionWithExitGrid: number | null;
  hasEnteredCombatModeSinceEntering: boolean;
  pendingWait: number | null;
  powSquad: number;
  readonly powsSeen: number[];
}

export interface ShopFlowState {
  session: ShopSession | null;
}

export interface TalkSoldiers {
  src: number | null;
  dest: number | null;
  srcProfile: number;
}

export interface TalkFlowState {
  readonly dialogue: TalkState;
  readonly soldiers: TalkSoldiers;
  scripted: boolean;
  civQuote: CivQuoteSaid | null;
  carmenTimerAtMs: number | null;
  shopAfterOpening: number | null;
}

export interface CosmeticStreams {
  readonly helicopter: Rng;
  readonly autoresolve: Rng;
}

export function createSessionState(): SessionState {
  return { tick: 0, compressing: false, day: 0 };
}

export function createSectorFlowState(realtimeClock: RealtimeClock = createRealtimeClock()): SectorFlowState {
  return {
    realtimeClock,
    jump: null,
    usingEdgepointsForEntry: false,
    overrideInsertionWithExitGrid: null,
    hasEnteredCombatModeSinceEntering: false,
    pendingWait: null,
    powSquad: NO_CURRENT_SQUAD,
    powsSeen: [],
  };
}

export function createTalkFlowState(seed: number): TalkFlowState {
  return {
    dialogue: createTalkState(seed),
    soldiers: { src: null, dest: null, srcProfile: SRC_PROFILE_AT_START },
    scripted: false,
    civQuote: null,
    carmenTimerAtMs: null,
    shopAfterOpening: null,
  };
}

export function createCosmeticStreams(seed: number): CosmeticStreams {
  return {
    helicopter: Rng.fromSeed(seed ^ HELICOPTER_COSMETIC_SALT),
    autoresolve: Rng.fromSeed(seed ^ AUTORESOLVE_COSMETIC_SALT),
  };
}

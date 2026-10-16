import type { StrategicState } from '../strategic/state.ts';
import type { CombatContext } from '../tactical/combat/context.ts';
import type { TacticalContent } from '../tactical/content.ts';
import type { CampaignSim } from './campaign-sim.ts';

const IDLE_TURN = { attackBusyCount: 0 };
const DISCARDED_EVENTS = { push: () => 0 };

export function offMapCombatContext(state: StrategicState, content: TacticalContent): CombatContext {
  return {
    content,
    pre: state.pre,
    rng: state.rng,
    profiles: state.profiles,
    inCombat: false,
    turn: IDLE_TURN,
    events: DISCARDED_EVENTS,
  };
}

export function campaignCombatContext(campaign: () => CampaignSim | null, state: StrategicState, content: TacticalContent) {
  return (): CombatContext => campaign()?.tactical?.state ?? offMapCombatContext(state, content);
}

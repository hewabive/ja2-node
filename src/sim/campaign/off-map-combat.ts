import type { StrategicState } from '../strategic/state.ts';
import { type CombatContext, type ExperienceHooks, NO_EXPERIENCE_HOOKS } from '../tactical/combat/context.ts';
import type { TacticalContent } from '../tactical/content.ts';
import type { NarrativePort } from '../tactical/narrative/port.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { campaignNarrativePort } from './narrative-port.ts';

const IDLE_TURN = { attackBusyCount: 0 };
const DISCARDED_EVENTS = { push: () => 0 };

export function offMapCombatContext(
  state: StrategicState,
  content: TacticalContent,
  experienceHooks: ExperienceHooks = NO_EXPERIENCE_HOOKS,
  narrative?: NarrativePort,
): CombatContext {
  return {
    content,
    pre: state.pre,
    rng: state.rng,
    profiles: state.profiles,
    inCombat: false,
    turn: IDLE_TURN,
    events: DISCARDED_EVENTS,
    experienceHooks,
    ...(narrative ? { narrative } : {}),
  };
}

export function campaignCombatContext(campaign: () => CampaignSim | null, state: StrategicState, content: TacticalContent) {
  return (): CombatContext => {
    const c = campaign();
    return c?.tactical?.state ?? offMapCombatContext(state, content, c?.experienceHooks, c ? campaignNarrativePort(c) : undefined);
  };
}

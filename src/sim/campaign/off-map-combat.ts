// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Campaign.cc ChangeStat (the stat message and the info panel's colour of a merc off the loaded
// @src map).

import type { StrategicState } from '../strategic/state.ts';
import { type CombatContext, type ExperienceHooks, NO_EXPERIENCE_HOOKS } from '../tactical/combat/context.ts';
import type { TacticalContent } from '../tactical/content.ts';
import type { NarrativePort } from '../tactical/narrative/port.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { campaignNarrativePort } from './narrative-port.ts';

export type CombatEvents = CombatContext['events'];

const IDLE_TURN = { attackBusyCount: 0 };
const DISCARDED_EVENTS: CombatEvents = { push: () => 0 };

export function offMapCombatContext(
  state: StrategicState,
  content: TacticalContent,
  experienceHooks: ExperienceHooks = NO_EXPERIENCE_HOOKS,
  narrative?: NarrativePort,
  events: CombatEvents = DISCARDED_EVENTS,
): CombatContext {
  return {
    content,
    pre: state.pre,
    rng: state.rng,
    profiles: state.profiles,
    inCombat: false,
    turn: IDLE_TURN,
    events,
    experienceHooks,
    ...(narrative ? { narrative } : {}),
  };
}

export function campaignOffMapCombatContext(c: CampaignSim | null, state: StrategicState, content: TacticalContent): CombatContext {
  if (!c) return offMapCombatContext(state, content);
  return offMapCombatContext(state, content, c.experienceHooks, campaignNarrativePort(c), c.offMapEvents);
}

export function campaignCombatContext(campaign: () => CampaignSim | null, state: StrategicState, content: TacticalContent) {
  return (): CombatContext => {
    const c = campaign();
    return c?.tactical?.state ?? campaignOffMapCombatContext(c, state, content);
  };
}

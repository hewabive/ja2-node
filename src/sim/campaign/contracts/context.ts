import type { Sector } from '../../../content/strategic/sector-ids.ts';
import type { EconomyContext } from '../../strategic/economy/ports.ts';
import type { StrategicState } from '../../strategic/state.ts';
import type { ClockContext } from '../../strategic/time/world-clock.ts';
import type { ExperienceHooks, RandomStream } from '../../tactical/combat/context.ts';
import type { TacticalContent } from '../../tactical/content.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import type { MoraleContext } from '../morale.ts';
import type { Roster, RosterMerc } from '../roster.ts';
import type { ContractState } from './contract-state.ts';
import type { ContractEvent } from './events.ts';
import type { QuoteName } from './quotes.ts';

export type ContractEventWithoutTick = ContractEvent extends infer E ? (E extends ContractEvent ? Omit<E, 'tick'> : never) : never;

export interface ContractHooks {
  insuranceExtensionCost(merc: RosterMerc, days: number): number | null;
  purchaseOrExtendInsurance(merc: RosterMerc, days: number): void;
  addLifeInsurancePayout(merc: RosterMerc): void;
  mercSiteDailyUpdate(): void;
  larryRelapsed(): boolean;
  slayDailyEvent(): void;
  mercLeavingTeam(merc: RosterMerc): void;
  mercMercLost(): void;
}

export const NO_CONTRACT_HOOKS: ContractHooks = {
  insuranceExtensionCost: () => null,
  purchaseOrExtendInsurance: () => {},
  addLifeInsurancePayout: () => {},
  mercSiteDailyUpdate: () => {},
  larryRelapsed: () => false,
  slayDailyEvent: () => {},
  mercLeavingTeam: () => {},
  mercMercLost: () => {},
};

export interface ContractRandom {
  readonly main: RandomStream;
  readonly pre: RandomStream;
}

export interface ContractContext {
  readonly state: StrategicState;
  readonly economy: EconomyContext;
  readonly content: TacticalContent;
  readonly roster: Roster;
  readonly hooks: ContractHooks;
  readonly clockContext: ClockContext;
  readonly contracts: ContractState;
  readonly rng: ContractRandom;
  readonly experienceHooks: ExperienceHooks;
  team(): readonly RosterMerc[];
  profile(id: number): ProfileProgress | null;
  mercType(profile: number): number | undefined;
  moraleContext(): MoraleContext;
  say(m: RosterMerc, quote: QuoteName, subject?: number): void;
  emit(e: ContractEventWithoutTick): void;
  history(code: number, profile: number, sector: Sector | null): void;
  removeFromWorld(m: RosterMerc): void;
  enterMapScreen(): void;
}

import type { TacticalContent } from '../content.ts';
import type { ProfileProgress, StatKey } from '../profiles.ts';
import type { Soldier } from '../soldier.ts';

export interface RandomStream {
  int(n: number): number;
}

export interface StatChangedEvent {
  readonly type: 'statChanged';
  readonly soldier: number;
  readonly stat: StatKey;
  readonly change: number;
}

export interface ExperienceHooks {
  levelGained(p: ProfileProgress, s: Soldier | null, levels: number): void;
}

export const NO_EXPERIENCE_HOOKS: ExperienceHooks = { levelGained: () => {} };

export interface CombatContext {
  readonly content: TacticalContent;
  readonly pre: RandomStream;
  readonly rng: RandomStream;
  readonly fx?: RandomStream;
  readonly profiles: Map<number, ProfileProgress>;
  readonly inCombat: boolean;
  readonly turn: { readonly attackBusyCount: number };
  readonly events: { push(event: StatChangedEvent): unknown };
  readonly experienceHooks?: ExperienceHooks;
}

export interface ImpactMode {
  readonly specials: boolean;
  readonly criticals: boolean;
  readonly close: boolean | null;
}

export const TACTICAL_IMPACT: ImpactMode = { specials: true, criticals: true, close: null };
export const AUTORESOLVE_IMPACT: ImpactMode = { specials: false, criticals: false, close: true };

import type { GuardOptions } from './guard.ts';
import type { KnowledgeView } from './view.ts';

export interface StrategicRules {
  readonly kind: 'strategic';
}

export interface StrategicKnowledge {
  readonly view: KnowledgeView;
}

export function strategicKnowledge(view: KnowledgeView, rules: StrategicRules | null, _guard: GuardOptions): StrategicKnowledge | null {
  if (!rules) return null;
  return { view };
}

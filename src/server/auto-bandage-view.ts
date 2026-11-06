import type { AutoBandageView } from '../protocol/view.ts';
import type { TacticalState } from '../sim/tactical/state.ts';

export function autoBandageView(t: TacticalState): AutoBandageView | null {
  if (!t.pathEnv.autoBandage) return null;
  const state = t.autoBandage;
  return { complete: state.complete, medics: [...state.medics], patients: [...state.patients] };
}

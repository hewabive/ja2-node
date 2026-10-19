import { type Sector, sectorFromStrategicIndex, sectorShortString } from '../../content/strategic/sector-ids.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import type { StrategicKnowledge } from '../knowledge/strategic.ts';
import { sectorFromName } from '../knowledge/strategic-state.ts';
import type { CrewMember } from '../strategic/economy/ports.ts';
import { type HintRefusal, refuseHint } from './types.ts';

const UNDERGROUND_SEPARATOR = '-';

export function strategicOf(world: KnowledgeWorld): StrategicKnowledge | { readonly refusal: HintRefusal } {
  return world.strategic ?? { refusal: refuseHint('noCampaign', 'the strategic map is not available') };
}

export function mercOf(sk: StrategicKnowledge, id: unknown): CrewMember | { readonly refusal: HintRefusal } {
  const m = typeof id === 'number' ? sk.merc(id) : null;
  return m ?? { refusal: refuseHint('noSuchMerc', 'no such merc') };
}

export function sectorParam(value: unknown): Sector | null {
  if (typeof value !== 'string') return null;
  try {
    return sectorFromName(value);
  } catch {
    return null;
  }
}

export function sectorNames(path: readonly number[]): string[] {
  return path.map((i) => sectorLabel(sectorFromStrategicIndex(i)));
}

export function sectorLabel(s: Sector): string {
  const short = sectorShortString(s);
  return s.z ? `${short}${UNDERGROUND_SEPARATOR}${s.z}` : short;
}

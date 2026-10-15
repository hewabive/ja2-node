// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/Knowledge.cc MostImportantNoiseHeard (personal and public heard entries, personal and team
// @src noise). See docs/09 §4.2.

import { spacesAway } from '../../../content/world/grid.ts';
import { NOWHERE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { hostile, Opp } from './sight.ts';

const NOISE_FORGET_DISTANCE = 6;

export function mostImportantNoiseHeard(t: TacticalState, s: Soldier): number {
  let best = NOWHERE;
  let bestValue = 0;
  const consider = (g: number, value: number) => {
    if (g === NOWHERE) return;
    if (best === NOWHERE || Math.abs(value) < Math.abs(bestValue)) {
      best = g;
      bestValue = value;
    }
  };
  for (const opp of t.soldiers) {
    if (!opp?.placed || !hostile(s, opp)) continue;
    const personal = s.oppList[opp.id] ?? 0;
    if (personal < 0) consider(s.lastKnownOpp[opp.id] ?? NOWHERE, personal * spacesAway(s.gridNo, s.lastKnownOpp[opp.id] ?? s.gridNo));
    const publicValue = t.perception.publicOpp[s.team]?.[opp.id] ?? 0;
    if (publicValue < 0) {
      const g = t.perception.publicLastKnown[s.team]?.[opp.id] ?? NOWHERE;
      consider(g, publicValue * spacesAway(s.gridNo, g === NOWHERE ? s.gridNo : g));
    }
  }
  if (s.ai.noiseGridNo !== NOWHERE && s.ai.noiseVolume > 0) {
    const sameLevelNear = s.ai.noiseLevel === s.level && spacesAway(s.gridNo, s.ai.noiseGridNo) <= NOISE_FORGET_DISTANCE;
    if (!sameLevelNear) consider(s.ai.noiseGridNo, (Math.trunc(s.ai.noiseVolume / 2) - 6) * spacesAway(s.gridNo, s.ai.noiseGridNo));
  }
  if (s.team !== Team.CIV) {
    const g = t.perception.publicNoiseGridNo[s.team] ?? NOWHERE;
    const volume = t.perception.publicNoiseVolume[s.team] ?? 0;
    if (g !== NOWHERE && volume > 0) consider(g, (Math.trunc(volume / 2) - 6) * spacesAway(s.gridNo, g));
  }
  void Opp;
  return best;
}

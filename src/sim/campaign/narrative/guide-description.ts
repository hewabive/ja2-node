// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/StrategicMap.cc HandleRPCDescriptionOfSector (sector_description); Tactical/Tactical_Turns.cc
// @src HandleRPCDescription; Dialogue_Control.cc CharacterDialogueUsingAlternateFile; Overhead.cc NumEnemyInSector;
// @src Soldier_Macros.h RPC_RECRUITED.

import type { Sector } from '../../../content/strategic/sector-ids.ts';
import { i8 } from '../../../core/int.ts';
import { characterDialogueUsingAlternateFile } from '../../narrative/dialogue-queue.ts';
import { NarrativeProfile, ProfileFlag } from '../../narrative/narrative-ids.ts';
import type { GuideDescription } from '../../strategic/narrative/facts.ts';
import { OKLIFE, Side, type Soldier } from '../../tactical/soldier.ts';
import type { TacticalState } from '../../tactical/state.ts';
import type { CampaignSim } from '../campaign-sim.ts';

const GUIDE_DESCRIPTIONS: readonly (readonly [x: number, y: number, quote: number])[] = [
  [13, 2, 0],
  [13, 3, 1],
  [13, 4, 2],
  [13, 8, 3],
  [14, 8, 4],
  [13, 9, 5],
  [14, 9, 7],
  [8, 6, 8],
  [9, 6, 9],
  [8, 7, 10],
  [9, 7, 11],
  [6, 3, 12],
  [5, 3, 13],
  [5, 4, 14],
  [2, 2, 15],
  [2, 1, 16],
  [1, 7, 17],
  [1, 8, 18],
  [2, 7, 19],
  [2, 8, 20],
  [6, 9, 21],
  [4, 11, 22],
  [11, 12, 23],
  [12, 12, 24],
  [3, 15, 25],
  [3, 16, 26],
  [4, 14, 27],
  [3, 14, 28],
  [4, 15, 30],
  [9, 10, 31],
  [15, 4, 32],
  [2, 4, 33],
  [8, 9, 34],
];
const SCIFI_ONLY_GUIDE_DESCRIPTION = 3;
const COUNTDOWN_BASE = 4;
export const GUIDE_DESCRIPTION_COUNTDOWN_RANGE = 5;
const SAM_SITE_QUOTES: ReadonlySet<number> = new Set([25, 27, 30, 31, 32]);
const GUIDES: ReadonlySet<number> = new Set([
  NarrativeProfile.IRA,
  NarrativeProfile.MIGUEL,
  NarrativeProfile.CARLOS,
  NarrativeProfile.DIMITRI,
]);

export function guideDescriptionFor(sector: Sector, sciFi: boolean): number | null {
  if (sector.z !== 0) return null;
  const index = GUIDE_DESCRIPTIONS.findIndex(([x, y]) => x === sector.x && y === sector.y);
  if (index === -1 || (index === SCIFI_ONLY_GUIDE_DESCRIPTION && !sciFi)) return null;
  return GUIDE_DESCRIPTIONS[index]?.[2] ?? null;
}

export function startGuideCountdown(guide: GuideDescription, sector: Sector, quote: number, roll: number): void {
  guide.counting = true;
  guide.countdown = i8(COUNTDOWN_BASE + roll);
  guide.quote = quote;
  guide.sectorX = sector.x;
  guide.sectorY = sector.y;
}

function numEnemyInSector(t: TacticalState): number {
  return t.soldiers.filter((s) => s?.placed && s.life > 0 && !s.neutral && s.side !== Side.FRIENDLY).length;
}

function rpcRecruited(c: CampaignSim, s: Soldier): boolean {
  return ((c.narrative.profile(s.profile)?.miscFlags ?? 0) & ProfileFlag.RECRUITED) !== 0;
}

function guidesInSector(c: CampaignSim, guide: GuideDescription): Soldier[] {
  const roster = c.battle?.roster;
  const z = c.state.worldSector?.z ?? 0;
  if (!roster) return [];
  return roster
    .all()
    .filter(
      (m) =>
        rpcRecruited(c, m.soldier) &&
        m.soldier.life >= OKLIFE &&
        m.sector.x === guide.sectorX &&
        m.sector.y === guide.sectorY &&
        m.sector.z === z &&
        !m.betweenSectors &&
        GUIDES.has(m.soldier.profile),
    )
    .sort((a, b) => a.id - b.id)
    .map((m) => m.soldier);
}

export function handleRpcDescription(c: CampaignSim): void {
  const guide = c.state.narrative.guide;
  const t = c.tactical?.state;
  if (!guide.counting || c.state.flow !== 'tactical' || !t || t.engagedInConv) return;
  if (SAM_SITE_QUOTES.has(guide.quote)) guide.countdown = 1;
  else if (t.inCombat || numEnemyInSector(t) > 0) return;
  guide.countdown = i8(guide.countdown - 1);
  if (guide.countdown !== 0) return;
  guide.counting = false;
  const host = c.talk?.host;
  const candidates = guidesInSector(c, guide);
  if (!host || candidates.length === 0) return;
  const chosen = candidates[host.talk.fx.int(candidates.length)] as Soldier;
  characterDialogueUsingAlternateFile(host, chosen.profile, guide.quote);
}

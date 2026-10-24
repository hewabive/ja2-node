// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/PreBattle_Interface.cc InitPreBattleInterface (the involved and uninvolved counts, the plural
// @src retreat help when the involved mercs belong to more than one group), RenderPreBattleInterface (what the panel
// @src prints: the enemy count or "?", the mercs, the militia, the involved and uninvolved rows), GetSoldierConditionInfo;
// @src src/game/Strategic/MapScreen.cc GetMapscreenMercDestinationString (the arrival sector in transit, the last sector of
// @src the path whenever there is one, else the group's next sector between sectors), GetMapscreenMercDepartureString
// @src (A.I.M. mercs and Slay; the contract remainder capped at its length in transit). See docs/19 §1.4, §5.1.

import { type Sector, sectorFromId, sectorFromStrategicIndex, sectorShortString } from '../../content/strategic/sector-ids.ts';
import type { PreBattlePanel, PreBattlePanelInvolved, PreBattlePanelUninvolved } from '../events.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { getGroup, numEnemiesInSector } from '../strategic/forces/groups.ts';
import { involvedMercs, uninvolvedMercs } from '../strategic/forces/pre-battle.ts';
import { sectorInfo, totalMilitia } from '../strategic/map/sectors.ts';
import { worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { soldierCondition } from '../tactical/health.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { remainingContractMinutes } from './contracts/contract-times.ts';
import { SpecialProfile } from './contracts/quotes.ts';
import { MercKind, type RosterMerc } from './roster.ts';

const PERCENT = 100;

export const panelSectorName = (s: Sector): string => (s.z ? `${sectorShortString(s)}-${s.z}` : sectorShortString(s));

function involvedRow(m: RosterMerc): PreBattlePanelInvolved {
  const s = m.soldier;
  return {
    soldier: m.id,
    name: s.name,
    assignment: m.assignment,
    condition: soldierCondition(s),
    hp: s.lifeMax > 0 ? Math.trunc((s.life * PERCENT) / s.lifeMax) : 0,
    bp: s.breath,
  };
}

function destination(campaign: CampaignSim, m: RosterMerc): Sector | null {
  if (m.assignment === Assignment.ASSIGNMENT_DEAD || m.assignment === Assignment.ASSIGNMENT_POW || m.life === 0) return null;
  if (m.assignment === Assignment.IN_TRANSIT) return sectorFromId(campaign.state.laptop.mercArriveSector);
  const last = m.path.at(-1);
  if (last !== undefined) return sectorFromStrategicIndex(last);
  if (!m.betweenSectors) return null;
  const g = campaign.strategic ? getGroup(campaign.strategic, m.groupId) : undefined;
  return g ? { x: g.next.x, y: g.next.y, z: 0 } : null;
}

function departure(campaign: CampaignSim, m: RosterMerc): number | null {
  if ((m.kind !== MercKind.AIM_MERC && m.profile !== SpecialProfile.SLAY) || m.life === 0) return null;
  const c = m.contract;
  const now = worldTotalMinutes(campaign.state.clock);
  return remainingContractMinutes(c.contractEnd, c.totalContractLength, m.assignment === Assignment.IN_TRANSIT, now);
}

function uninvolvedRow(campaign: CampaignSim, m: RosterMerc): PreBattlePanelUninvolved {
  const to = destination(campaign, m);
  return {
    soldier: m.id,
    name: m.soldier.name,
    assignment: m.assignment,
    location: panelSectorName(m.sector),
    betweenSectors: m.betweenSectors,
    ...(to ? { destination: sectorShortString(to) } : {}),
    departure: departure(campaign, m),
  };
}

export function preBattlePanel(campaign: CampaignSim, sector: Sector, enemiesKnown: boolean): PreBattlePanel | null {
  const economy = campaign.economy;
  const flow = campaign.battle;
  if (!economy || !flow) return null;
  const roster = (ids: readonly { id: number }[]) => ids.map((m) => flow.roster.get(m.id)).filter((m): m is RosterMerc => m !== undefined);
  const involved = roster(involvedMercs(economy, sector));
  return {
    sector: panelSectorName(sector),
    enemies: enemiesKnown ? numEnemiesInSector(economy, sector) : 'unknown',
    militia: totalMilitia(sectorInfo(campaign.state.map, sector)),
    involved: involved.map(involvedRow),
    uninvolved: roster(uninvolvedMercs(economy, sector)).map((m) => uninvolvedRow(campaign, m)),
    involvedGroups: new Set(involved.map((m) => m.groupId)).size,
  };
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Profile.cc FindSoldierByProfileID (every active soldier, OUR team first),
// @src FindSoldierByProfileIDOnPlayerTeam; Tactical/Overhead.h FOR_EACH_MERC (the soldiers in the loaded sector),
// @src CFOR_EACH_IN_TEAM; Tactical/Items.cc FindObjInObjRange; Tactical/Handle_Items.cc GetItemPool, IsItemPoolVisible,
// @src ItemTypeExistsAtLocation. See docs/25 §1.3.

import { sameSector } from '../../../content/strategic/sector-ids.ts';
import type { FactSoldier, FactWorld } from '../../strategic/narrative/check-fact.ts';
import { NO_FACT_WORLD } from '../../strategic/narrative/check-fact.ts';
import type { SectorPosition } from '../../strategic/state.ts';
import { Opp } from '../../tactical/perception/opp.ts';
import { type Soldier, Team } from '../../tactical/soldier.ts';
import { sectorMapOf, type TacticalState } from '../../tactical/state.ts';
import { itemsAt, Visibility } from '../../tactical/world-items.ts';
import type { Roster, RosterMerc } from '../roster.ts';

const NO_ASSIGNMENT = -1;
const NO_KIND = -1;

function inLoadedSector(t: TacticalState | null, s: Soldier): boolean {
  return t !== null && t.soldiers[s.id] === s && s.placed;
}

function mercSoldier(m: RosterMerc, t: TacticalState | null): FactSoldier {
  const s = m.soldier;
  return {
    id: m.id,
    profile: m.profile,
    team: Team.OUR,
    side: s.side,
    neutral: s.neutral,
    civilianGroup: s.civilianGroup,
    life: s.life,
    lifeMax: s.lifeMax,
    bleeding: s.bleeding,
    strength: s.stats.strength,
    gridNo: s.gridNo,
    inSector: inLoadedSector(t, s),
    cowering: s.cowering,
    underFire: s.ai.underFire !== 0,
    heardGunshot: s.heardGunshot,
    assignment: m.assignment,
    kind: m.kind,
    sector: { x: m.sector.x, y: m.sector.y, z: m.sector.z },
    ourTeam: true,
  };
}

function tacticalSoldier(s: Soldier, world: SectorPosition): FactSoldier {
  return {
    id: s.id,
    profile: s.profile,
    team: s.team,
    side: s.side,
    neutral: s.neutral,
    civilianGroup: s.civilianGroup,
    life: s.life,
    lifeMax: s.lifeMax,
    bleeding: s.bleeding,
    strength: s.stats.strength,
    gridNo: s.gridNo,
    inSector: s.placed,
    cowering: s.cowering,
    underFire: s.ai.underFire !== 0,
    heardGunshot: s.heardGunshot,
    assignment: NO_ASSIGNMENT,
    kind: NO_KIND,
    sector: world,
    ourTeam: s.team === Team.OUR,
  };
}

export interface FactWorldSource {
  readonly roster: Roster | null;
  readonly tactical: TacticalState | null;
  readonly world: SectorPosition | null;
}

export function factSoldierById(source: FactWorldSource, id: number): FactSoldier | null {
  const t = source.world ? source.tactical : null;
  const m = source.roster?.get(id);
  if (m) return mercSoldier(m, t);
  const s = t?.soldiers[id];
  return s?.placed && source.world ? tacticalSoldier(s, source.world) : null;
}

export function campaignFactWorld(source: FactWorldSource): FactWorld {
  const roster = source.roster;
  const world = source.world;
  const t = world ? source.tactical : null;
  if (!roster && !t) return NO_FACT_WORLD;
  const mercs = (): readonly RosterMerc[] => roster?.all() ?? [];
  const others = (): Soldier[] => (t && world ? t.soldiers.filter((s): s is Soldier => s?.placed === true && s.team !== Team.OUR) : []);
  const bySoldier = (f: FactSoldier): Soldier | null => {
    const m = roster?.get(f.id);
    if (f.ourTeam && m) return m.soldier;
    return t?.soldiers[f.id] ?? null;
  };
  return {
    sector: world,
    soldierByProfile: (profile) => {
      const m = mercs().find((x) => x.profile === profile);
      if (m) return mercSoldier(m, t);
      const s = world ? others().find((x) => x.profile === profile) : undefined;
      return s && world ? tacticalSoldier(s, world) : null;
    },
    soldierOnPlayerTeam: (profile) => {
      const m = mercs().find((x) => x.profile === profile);
      return m ? mercSoldier(m, t) : null;
    },
    mercsInSector: () => {
      if (!t || !world) return [];
      const ours = mercs()
        .filter((m) => inLoadedSector(t, m.soldier) && sameSector(m.sector, world))
        .map((m) => mercSoldier(m, t));
      return [...ours, ...others().map((s) => tacticalSoldier(s, world))];
    },
    ourTeam: () => mercs().map((m) => mercSoldier(m, t)),
    carriesItemInRange: (f, first, last) => {
      const s = bySoldier(f);
      return s?.inv.some((o) => o.item >= first && o.item <= last) === true;
    },
    room: (gridNo) => (t ? (sectorMapOf(t).rooms[gridNo] ?? 0) : 0),
    seesCurrently: (viewer, target) => {
      const s = bySoldier(viewer);
      return s !== null && s.oppList[target.id] === Opp.SEEN_CURRENTLY;
    },
    enemyInSector: () => t?.turn.enemyInSector === true,
    inCombat: () => t?.inCombat === true,
    itemTypeExistsAt: (gridNo, item, level) => (t ? itemsAt(t, gridNo, level).some((wi) => wi.object.item === item) : false),
    invisibleItemPoolAt: (gridNo, level) => {
      if (!t) return false;
      const pool = itemsAt(t, gridNo, level);
      return pool.length > 0 && !pool.some((wi) => wi.visible >= Visibility.VISIBLE);
    },
  };
}

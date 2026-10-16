import { type Sector, sectorShortString } from '../content/strategic/sector-ids.ts';
import type { AutoresolveCellView, AutoresolveView, InvolvedMercView, PromptView, UninvolvedMercView } from '../protocol/view.ts';
import { battleStatusName } from '../sim/campaign/battle-flow.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import type { RosterMerc } from '../sim/campaign/roster.ts';
import { type ArCell, CellFlag, hasFlag } from '../sim/strategic/forces/autoresolve/state.ts';
import { encounterName, PromptKind } from '../sim/strategic/forces/battle-state.ts';
import { getFinalWaypoint, getGroup, numEnemiesInSector } from '../sim/strategic/forces/groups.ts';
import { involvedMercs, uninvolvedMercs } from '../sim/strategic/forces/pre-battle.ts';
import { sectorInfo, totalMilitia } from '../sim/strategic/map/sectors.ts';
import { healthCategory, soldierCondition } from '../sim/tactical/health.ts';
import { OKLIFE, type Soldier, SoldierClass } from '../sim/tactical/soldier.ts';

const PERCENT = 100;
const MS_PER_SECOND = 1000;

const sectorName = (s: Sector) => (s.z ? `${sectorShortString(s)}-${s.z}` : sectorShortString(s));

const MILITIA_KINDS: Readonly<Record<number, string>> = {
  [SoldierClass.GREEN_MILITIA]: 'green',
  [SoldierClass.REG_MILITIA]: 'regular',
  [SoldierClass.ELITE_MILITIA]: 'elite',
};

const ENEMY_KINDS: readonly (readonly [number, string])[] = [
  [CellFlag.ELITE, 'elite'],
  [CellFlag.TROOP, 'troop'],
  [CellFlag.ADMIN, 'admin'],
  [CellFlag.AF_CREATURE, 'adultFemaleCreature'],
  [CellFlag.AM_CREATURE, 'adultMaleCreature'],
  [CellFlag.YF_CREATURE, 'youngFemaleCreature'],
  [CellFlag.YM_CREATURE, 'youngMaleCreature'],
];

function involvedView(m: RosterMerc): InvolvedMercView {
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

function uninvolvedView(campaign: CampaignSim, m: RosterMerc): UninvolvedMercView {
  const g = campaign.strategic ? getGroup(campaign.strategic, m.groupId) : undefined;
  const wp = g ? getFinalWaypoint(g) : undefined;
  return {
    soldier: m.id,
    name: m.soldier.name,
    assignment: m.assignment,
    location: sectorName(m.sector),
    ...(wp && g?.betweenSectors ? { destination: sectorName({ x: wp.x, y: wp.y, z: wp.z }) } : {}),
  };
}

function preBattleView(campaign: CampaignSim, id: string, enemiesKnown: boolean): PromptView | null {
  const economy = campaign.economy;
  const battle = campaign.state.battle;
  const flow = campaign.battle;
  const sector = battle.sector;
  if (!economy || !sector || !flow) return null;
  const prompt = battle.prompt;
  const roster = (ids: readonly { id: number }[]) => ids.map((m) => flow.roster.get(m.id)).filter((m): m is RosterMerc => m !== undefined);
  const enc = campaign.state.encounter;
  return {
    id,
    kind: 'preBattle',
    sector: sectorName(sector),
    persistent: battle.persistent,
    encounter: encounterName(battle.persistent ? enc.code : enc.explicitCode),
    enemies: enemiesKnown ? numEnemiesInSector(economy, sector) : 'unknown',
    militia: totalMilitia(sectorInfo(campaign.state.map, sector)),
    involved: roster(involvedMercs(economy, sector)).map(involvedView),
    uninvolved: roster(uninvolvedMercs(economy, sector)).map((m) => uninvolvedView(campaign, m)),
    options: prompt?.kind === PromptKind.PRE_BATTLE ? prompt.options.map((o) => ({ ...o })) : [],
  };
}

export function promptView(campaign: CampaignSim): PromptView | null {
  const prompt = campaign.state.battle.prompt;
  const flow = campaign.battle;
  if (!prompt || !flow) return null;
  switch (prompt.kind) {
    case PromptKind.PRE_BATTLE:
      return preBattleView(campaign, prompt.id, prompt.enemiesKnown);
    case PromptKind.SURRENDER:
      return { id: prompt.id, kind: 'surrender', choices: ['accept', 'reject'] };
    case PromptKind.AUTORESOLVE_DONE: {
      const canBandage = flow.canBandage();
      return {
        id: prompt.id,
        kind: 'autoresolveDone',
        status: battleStatusName(flow.session?.ar.status ?? 0),
        canBandage,
        choices: canBandage ? ['bandage', 'done'] : ['done'],
      };
    }
    case PromptKind.SIMULTANEOUS_ARRIVAL: {
      const arrival = campaign.state.encounter.simultaneousArrival;
      return {
        id: prompt.id,
        kind: 'simultaneousArrival',
        sector: arrival ? sectorName(arrival.sector) : '',
        groups: arrival?.nearbyGroups ?? 0,
        choices: ['coordinate', 'separately'],
      };
    }
    case PromptKind.NPC_OF_NOTE: {
      const groupId = campaign.state.movement.groupPrompting ?? 0;
      const g = campaign.strategic ? getGroup(campaign.strategic, groupId) : undefined;
      return { id: prompt.id, kind: 'npcOfNote', group: groupId, sector: g ? sectorName(g.sector) : '', choices: ['continue', 'stop'] };
    }
  }
}

function cellState(c: ArCell): AutoresolveCellView['state'] {
  if (c.soldier.life === 0) return 'dead';
  if (hasFlag(c, CellFlag.RETREATED)) return 'retreated';
  if (hasFlag(c, CellFlag.RETREATING)) return 'retreating';
  return c.soldier.life < OKLIFE ? 'unconscious' : 'alive';
}

function otherCell(c: ArCell, kind: string): AutoresolveCellView {
  const s: Soldier = c.soldier;
  return {
    side: c.side,
    index: c.index,
    kind,
    state: cellState(c),
    ...(s.life !== 0 ? { health: healthCategory(s.life, s.lifeMax), hurt: s.life !== s.lifeMax } : {}),
  };
}

function mercCell(c: ArCell): AutoresolveCellView {
  const s = c.soldier;
  return {
    side: 'merc',
    index: c.index,
    kind: s.name,
    soldier: s.id,
    name: s.name,
    state: cellState(c),
    life: s.life,
    lifeMax: s.lifeMax,
    bleeding: s.bleeding,
    breathMax: s.breathMax,
    morale: s.morale,
  };
}

function enemyKind(c: ArCell): string {
  return ENEMY_KINDS.find(([flag]) => hasFlag(c, flag))?.[1] ?? 'troop';
}

export function autoresolveView(campaign: CampaignSim): AutoresolveView | null {
  const session = campaign.state.battle.autoresolve;
  if (!session) return null;
  const ar = session.ar;
  return {
    sector: sectorName(session.sector),
    status: battleStatusName(ar.status),
    battleSeconds: Math.trunc(ar.elapsedMs / MS_PER_SECOND),
    alive: { mercs: ar.aliveMercs, militia: ar.aliveCivs, enemies: ar.aliveEnemies },
    cells: [
      ...ar.mercs.map(mercCell),
      ...ar.militia.map((c) => otherCell(c, MILITIA_KINDS[c.soldier.soldierClass] ?? 'green')),
      ...ar.enemies.map((c) => otherCell(c, enemyKind(c))),
    ],
  };
}

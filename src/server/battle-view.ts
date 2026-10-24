import { type Sector, sectorFromId, sectorShortString } from '../content/strategic/sector-ids.ts';
import type { AutoresolveCellView, AutoresolveView, NpcRequestPromptView, PromptView } from '../protocol/view.ts';
import { battleStatusName } from '../sim/campaign/battle-flow.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { preBattlePanel } from '../sim/campaign/pre-battle-panel.ts';
import { type ArCell, CellFlag, hasFlag } from '../sim/strategic/forces/autoresolve/state.ts';
import { encounterName, PromptKind } from '../sim/strategic/forces/battle-state.ts';
import { getGroup } from '../sim/strategic/forces/groups.ts';
import { healthCategory } from '../sim/tactical/health.ts';
import { Body, NO_PROFILE, OKLIFE, type Soldier, SoldierClass } from '../sim/tactical/soldier.ts';

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

function preBattleView(campaign: CampaignSim, id: string, enemiesKnown: boolean): PromptView | null {
  const battle = campaign.state.battle;
  const sector = battle.sector;
  if (!sector) return null;
  const panel = preBattlePanel(campaign, sector, enemiesKnown);
  if (!panel) return null;
  const prompt = battle.prompt;
  const enc = campaign.state.encounter;
  return {
    id,
    kind: 'preBattle',
    sector: panel.sector,
    persistent: battle.persistent,
    encounter: encounterName(battle.persistent ? enc.code : enc.explicitCode),
    enemies: panel.enemies,
    militia: panel.militia,
    involved: panel.involved.map((m) => ({ ...m })),
    uninvolved: panel.uninvolved.map((m) => ({ ...m })),
    options: prompt?.kind === PromptKind.PRE_BATTLE ? prompt.options.map((o) => ({ ...o })) : [],
    involvedGroups: panel.involvedGroups,
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
      return prompt.context === 'tactical'
        ? { id: prompt.id, kind: 'surrender', context: 'tactical', soldier: prompt.soldier ?? -1, choices: ['accept', 'reject'] }
        : { id: prompt.id, kind: 'surrender', context: 'autoresolve', choices: ['accept', 'reject'] };
    case PromptKind.AUTORESOLVE_DONE: {
      const canBandage = flow.canBandage();
      return {
        id: prompt.id,
        kind: 'autoresolveDone',
        status: battleStatusName(flow.session?.ar.status ?? 0),
        canBandage,
        choices: canBandage ? ['bandage', 'done'] : ['done'],
        bandageRefusal: flow.bandageRefusal(),
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
    case PromptKind.MILITIA_PAYMENT:
      return {
        id: prompt.id,
        kind: 'militiaPayment',
        trainer: prompt.trainer,
        sectors: prompt.sectors.map((id) => sectorShortString(sectorFromId(id))),
        cost: prompt.cost,
        balance: campaign.state.finances.balance,
        choices: ['yes', 'no'],
      };
    case PromptKind.MILITIA_CONTINUE:
      return {
        id: prompt.id,
        kind: 'militiaContinue',
        trainer: prompt.trainer,
        sector: sectorShortString(sectorFromId(prompt.sector)),
        cost: prompt.cost,
        balance: campaign.state.finances.balance,
        choices: ['yes', 'no'],
      };
    case PromptKind.CONTRACT_RENEWAL:
    case PromptKind.MERC_DEPARTURE:
    case PromptKind.INSURANCE_EXTENSION:
    case PromptKind.NPC_REQUEST:
      return null;
  }
}

export function npcRequestView(campaign: CampaignSim): NpcRequestPromptView | null {
  return campaign.talk?.npcActions.requestView() ?? null;
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
    ...(s.bodyType === Body.REGFEMALE ? { female: true } : {}),
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
    ...(s.profile !== NO_PROFILE ? { profile: s.profile } : {}),
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
    encounter: encounterName(ar.encounter),
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

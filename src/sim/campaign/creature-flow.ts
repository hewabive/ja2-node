// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Event_Hook.cc (EVENT_CREATURE_SPREAD, EVENT_CREATURE_NIGHT_PLANNING, EVENT_CREATURE_ATTACK);
// @src Creature_Spreading.cc CreatureAttackTown (the battle start), PrepareCreaturesForBattle;
// @src Strategic/Meanwhile.cc HandleCreatureRelease; Strategic_Town_Loyalty.cc AdjustLoyaltyForCivsEatenByMonsters.
// @src See docs/17 §12.1, docs/19 §1.2.

import { CreatureHabitat } from '../../content/strategic/creature-lairs.ts';
import { type Sector, sectorId, sectorShortString } from '../../content/strategic/sector-ids.ts';
import { Meanwhile } from '../strategic/ai/constants.ts';
import { scheduleMeanwhileEvent } from '../strategic/ai/meanwhile.ts';
import {
  CREATURE_WEIGHTS_BY_HABITAT,
  CreatureBattleCode,
  type CreatureContext,
  CreatureWeightIndex,
  checkConditionsForTriggeringCreatureQuest,
  clearCreatureAttack,
  creatureNightPlanning,
  distributeCreaturesByWeight,
  endCreatureQuest,
  importCreatureDirectives,
  initCreatureQuest,
  mineClearOfMonsters,
  playerGroupIsInACreatureInfestedMine,
  type SavedCreatureDirectives,
  spreadCreatures,
} from '../strategic/creatures/creatures.ts';
import { creatureAttackTown, type TownAttackContext } from '../strategic/creatures/town-attack.ts';
import { adjustLoyaltyForCivsEatenByMonsters } from '../strategic/economy/loyalty.ts';
import { countAllMilitiaInSector } from '../strategic/economy/militia-rules.ts';
import { playerGroupsInSector } from '../strategic/forces/groups.ts';
import { findUndergroundSector, sectorInfo } from '../strategic/map/sectors.ts';
import { EventKind } from '../strategic/time/constants.ts';
import type { EventDispatch } from '../strategic/time/dispatch.ts';
import { interruptTime, worldTotalMinutes } from '../strategic/time/world-clock.ts';
import type { CreatureCounts } from '../tactical/init-list.ts';
import type { CampaignSim } from './campaign-sim.ts';

const MEANWHILE_DELAY_MINUTES = 5;

export interface CreatureBattleSetup {
  readonly queen: boolean;
  readonly counts: CreatureCounts;
}

export class CreatureFlow {
  readonly campaign: CampaignSim;

  constructor(campaign: CampaignSim) {
    this.campaign = campaign;
  }

  context(): CreatureContext {
    const c = this.campaign;
    const economy = c.economy;
    if (!economy) throw new Error('creatures need the economy');
    return {
      state: c.state,
      lairs: economy.content.creatureLairs,
      mines: economy.economy.mines,
      random: economy.random,
      preRandom: economy.preRandom,
      scheduleCreatureMeanwhile: () => {
        const q = c.queen;
        if (q) scheduleMeanwhileEvent(q, Meanwhile.CREATURES, worldTotalMinutes(c.state.clock) + MEANWHILE_DELAY_MINUTES);
      },
    };
  }

  #townAttackContext(): TownAttackContext {
    const c = this.campaign;
    const economy = c.economy;
    if (!economy) throw new Error('creatures need the economy');
    return {
      ...this.context(),
      ports: {
        enemyInLoadedSector: () => c.tactical !== null && c.state.worldSector !== null && c.tactical.state.turn.enemyInSector,
        playerGroupsInSector: (s) => playerGroupsInSector(economy, s) > 0,
        loadedSector: () => (c.tactical ? c.state.worldSector : null),
        inTacticalScreen: () => c.state.flow === 'tactical',
        militiaInSector: (s) => countAllMilitiaInSector(economy, s),
        creaturesEatCivilians: (s, n) => this.creaturesEatCivilians(s, n),
        beginCreatureBattle: (code) => this.#beginBattle(code),
      },
    };
  }

  register(dispatch: EventDispatch<CampaignSim>): void {
    dispatch.register(EventKind.CREATURE_SPREAD, () => spreadCreatures(this.context()));
    dispatch.register(EventKind.CREATURE_NIGHT_PLANNING, () => creatureNightPlanning(this.context()));
    dispatch.register(EventKind.CREATURE_ATTACK, (_c, e) => creatureAttackTown(this.#townAttackContext(), e.param, false));
  }

  importDirectives(saved: SavedCreatureDirectives, meanwhileScenePlayed: boolean): void {
    importCreatureDirectives(this.context(), saved, meanwhileScenePlayed);
  }

  initQuest(): void {
    initCreatureQuest(this.context());
  }

  checkConditionsForQuest(): void {
    checkConditionsForTriggeringCreatureQuest(this.context());
  }

  endQuest(): void {
    endCreatureQuest(this.context());
  }

  mineClear(mine: number): boolean {
    return mineClearOfMonsters(this.context(), mine);
  }

  playerInInfestedMine(): boolean {
    const roster = this.campaign.battle?.roster;
    if (!roster) return false;
    return playerGroupIsInACreatureInfestedMine(this.context(), roster.all());
  }

  creaturesEatCivilians(sector: Sector, count: number): void {
    const economy = this.campaign.economy;
    if (!economy) return;
    adjustLoyaltyForCivsEatenByMonsters(economy, sector, count);
    this.campaign.battle?.emit({ type: 'civiliansEaten', sector: sectorShortString(sector), count });
  }

  #beginBattle(code: number): void {
    const c = this.campaign;
    if (code === CreatureBattleCode.TACTICALLY_ADD) c.sectors?.prepareCreaturesForBattle();
    else c.battle?.openCreatureAttack(code === CreatureBattleCode.AUTORESOLVE);
    interruptTime(c.state.clock);
  }

  battleSetup(world: Sector): CreatureBattleSetup | null {
    const s = this.campaign.state;
    const attack = s.creatures.attack;
    let habitat: number;
    let count: number;
    if (attack.battleCode === CreatureBattleCode.NONE) {
      if (!world.z) return null;
      const level = findUndergroundSector(s.map, world);
      if (!level?.numCreatures) return null;
      habitat = level.creatureHabitat;
      count = level.numCreatures;
    } else {
      habitat = CreatureHabitat.MINE_EXIT;
      count = attack.numAttacking;
    }
    const queen = habitat === CreatureHabitat.QUEEN_LAIR;
    if (queen) count = Math.max(1, count - 1);
    const d = distributeCreaturesByWeight(this.context().random, count, CREATURE_WEIGHTS_BY_HABITAT[habitat] ?? []);
    if (world.z) {
      const level = findUndergroundSector(s.map, world);
      if (level) level.creaturesInBattle = level.numCreatures;
    } else {
      const info = sectorInfo(s.map, world);
      info.numCreatures = count;
      info.creaturesInBattle = count;
    }
    return {
      queen,
      counts: {
        larvae: d[CreatureWeightIndex.LARVAE] ?? 0,
        infants: d[CreatureWeightIndex.INFANT] ?? 0,
        youngMales: d[CreatureWeightIndex.YOUNG_MALE] ?? 0,
        youngFemales: d[CreatureWeightIndex.YOUNG_FEMALE] ?? 0,
        adultMales: d[CreatureWeightIndex.ADULT_MALE] ?? 0,
        adultFemales: d[CreatureWeightIndex.ADULT_FEMALE] ?? 0,
      },
    };
  }

  attackPendingFor(world: Sector): boolean {
    const attack = this.campaign.state.creatures.attack;
    return attack.numAttacking !== 0 && world.z === 0 && attack.sectorId === sectorId(world);
  }

  clearAttack(): void {
    clearCreatureAttack(this.campaign.state.creatures.attack);
  }
}

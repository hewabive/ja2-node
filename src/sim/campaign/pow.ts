// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/StrategicMap.cc UpdateMercsInSector (the POW branch); Tactical/Overhead.cc DoPOWPathChecks;
// @src Tactical/Interface_Dialogue.cc NPC_ACTION_GRANT_EXPERIENCE_3.

import { sectorShortString } from '../../content/strategic/sector-ids.ts';
import type { SimEvent } from '../events.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { NO_CURRENT_SQUAD } from '../strategic/forces/constants.ts';
import { addCharacterToAnySquad, addCharacterToSquad, addCharacterToUniqueSquad } from '../strategic/forces/squads.ts';
import { Quest } from '../strategic/narrative/fact-ids.ts';
import { QuestStatus, questStatus } from '../strategic/narrative/facts.ts';
import { ExperienceBonus } from '../strategic/narrative/rewards.ts';
import { findBestPath, PathFlags } from '../tactical/pathfinding.ts';
import { Team } from '../tactical/soldier.ts';
import { teamMembers } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';
import type { StoryEventWithoutTick } from './narrative/story-events.ts';
import type { RosterMerc } from './roster.ts';

const ALMA_PRISON = { x: 13, y: 9, z: 0 } as const;
const FREEDOM_GRIDNOS: readonly number[] = [10492, 10482, 9381];

function inAlmaPrison(sector: { readonly x: number; readonly y: number; readonly z: number }): boolean {
  return sector.x === ALMA_PRISON.x && sector.y === ALMA_PRISON.y && sector.z === ALMA_PRISON.z;
}

export class PowFlow {
  readonly #campaign: CampaignSim;
  readonly #events: SimEvent[] = [];

  constructor(campaign: CampaignSim) {
    this.#campaign = campaign;
  }

  get #powSquad(): number {
    return this.#campaign.state.sectorFlow.powSquad;
  }

  set #powSquad(squad: number) {
    this.#campaign.state.sectorFlow.powSquad = squad;
  }

  get #seen(): number[] {
    return this.#campaign.state.sectorFlow.powsSeen;
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  #emit(e: StoryEventWithoutTick): void {
    this.#events.push({ ...e, tick: this.#campaign.tick } as SimEvent);
  }

  beginSectorLoad(): void {
    this.#powSquad = NO_CURRENT_SQUAD;
    this.#seen.length = 0;
  }

  powPlaced(m: RosterMerc): void {
    const c = this.#campaign;
    const world = c.state.worldSector;
    const ctx = c.strategic;
    if (!world || !ctx || m.assignment !== Assignment.ASSIGNMENT_POW) return;
    const prison = inAlmaPrison(world);
    if (this.#powSquad === NO_CURRENT_SQUAD) {
      if (prison) this.#seen.push(m.id);
      else {
        addCharacterToUniqueSquad(ctx, m.id);
        this.#powSquad = m.assignment;
        m.soldier.neutral = false;
      }
    } else if (!prison) addCharacterToSquad(ctx, m.id, this.#powSquad);
    if (questStatus(c.state.narrative, Quest.HELD_IN_ALMA) === QuestStatus.IN_PROGRESS) {
      c.narrative.endQuest(Quest.HELD_IN_ALMA, world);
      c.narrative.awardExperience(ExperienceBonus.AVERAGE);
    }
  }

  endSectorLoad(): void {
    const world = this.#campaign.state.worldSector;
    if (world && this.#seen.length > 0) this.#emit({ type: 'powsFound', sector: sectorShortString(world), soldiers: [...this.#seen] });
    this.#seen.length = 0;
  }

  doPowPathChecks(): void {
    const c = this.#campaign;
    const t = c.tactical?.state;
    const ctx = c.strategic;
    const roster = c.battle?.roster;
    const world = c.state.worldSector;
    if (!t || !ctx || !roster || !world) return;
    for (const s of teamMembers(t, Team.OUR)) {
      const m = roster.get(s.id);
      if (!m || m.assignment !== Assignment.ASSIGNMENT_POW) continue;
      const free = FREEDOM_GRIDNOS.some((g) => findBestPath(t.pathEnv, s, g, 0, { flags: PathFlags.THROUGH_PEOPLE }).length > 0);
      if (!free) continue;
      s.neutral = false;
      addCharacterToAnySquad(ctx, s.id);
      this.#emit({ type: 'powFreed', soldier: s.id, sector: sectorShortString(world) });
    }
  }
}

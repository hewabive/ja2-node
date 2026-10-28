// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Hourly_Update.cc HourlyQuestUpdate, HourlyCheckIfSlayAloneSoHeCanLeave; Tactical/Campaign.cc
// @src HourlyProgressUpdate (the milestone effects);
// @src Strategic/StrategicMap.cc HandleSlayDailyEvent.

import type { ProfileProgress } from '../../tactical/profiles.ts';
import type { ProgressMilestones } from '../ai/difficulty.ts';
import type { SectorPosition } from '../state.ts';
import { Fact } from './fact-ids.ts';
import { type NarrativeState, NUM_BOXERS, setFactFalse, setFactTrue } from './facts.ts';
import { Npc } from './npc-ids.ts';
import { setProfileSector } from './presence.ts';

const BROTHEL_CLOSES = 4;
const BROTHEL_OPENS = 20;
const CLUB_OPENS = 15;
const CLUB_CLOSES = 2;
const MUSEUM_OPENS = 9;
const MUSEUM_CLOSES = 18;
const MATCHES_PER_REST = 3;
const SLAY_LEAVE_CHANCE = 15;
const MINUTES_PER_DAY = 1440;
const IGGY_SECTOR: SectorPosition = { x: 5, y: 3, z: 0 };

export function hourlyQuestUpdate(n: NarrativeState, hour: number): void {
  if (hour === BROTHEL_CLOSES) setFactFalse(n, Fact.BROTHEL_OPEN);
  else if (hour === BROTHEL_OPENS) setFactTrue(n, Fact.BROTHEL_OPEN);
  if (hour === CLUB_OPENS) {
    setFactTrue(n, Fact.CLUB_OPEN);
    setFactFalse(n, Fact.PAST_CLUB_CLOSING_AND_PLAYER_WARNED);
    for (let i = 0; i < NUM_BOXERS; i++) n.boxing.fought[i] = false;
    if (n.boxing.resting) {
      n.boxing.resting = false;
      n.boxing.rests = (n.boxing.rests + 1) & 0xff;
    } else if (Math.trunc(n.boxing.matchesWon / MATCHES_PER_REST) > n.boxing.rests) n.boxing.resting = true;
  } else if (hour === CLUB_CLOSES) setFactFalse(n, Fact.CLUB_OPEN);
  if (hour === MUSEUM_OPENS) setFactTrue(n, Fact.MUSEUM_OPEN);
  else if (hour === MUSEUM_CLOSES) setFactFalse(n, Fact.MUSEUM_OPEN);
}

export interface ProgressMilestoneContext {
  readonly narrative: NarrativeState;
  profile(id: number): ProfileProgress | null;
  scientistAwolMeanwhile(): void;
}

export function applyProgressMilestones(ctx: ProgressMilestoneContext, m: ProgressMilestones): void {
  if (m.madlab) ctx.scientistAwolMeanwhile();
  if (m.mike) setFactTrue(ctx.narrative, Fact.MIKE_AVAILABLE_TO_ARMY);
  if (!m.iggy) return;
  const iggy = ctx.profile(Npc.IGGY);
  if (iggy) setProfileSector(iggy, IGGY_SECTOR);
}

export interface SlayOnTeam {
  readonly life: number;
  readonly betweenSectors: boolean;
  readonly sector: SectorPosition;
  readonly assignment: number;
  readonly contractEnd: number;
}

export interface SlayContext {
  slay(): SlayOnTeam | null;
  playerMercsInSector(sector: SectorPosition): number;
  chance(percent: number): boolean;
  leaves(): void;
}

export function hourlyCheckIfSlayAloneSoHeCanLeave(ctx: SlayContext): void {
  const slay = ctx.slay();
  if (!slay || slay.betweenSectors || slay.life === 0) return;
  if (ctx.playerMercsInSector(slay.sector) !== 1) return;
  if (ctx.chance(SLAY_LEAVE_CHANCE)) ctx.leaves();
}

export function handleSlayDailyEvent(ctx: SlayContext, day: number, inTransit: number, pow: number): void {
  const slay = ctx.slay();
  if (!slay || slay.life === 0 || slay.assignment === inTransit || slay.assignment === pow) return;
  if (Math.trunc(slay.contractEnd / MINUTES_PER_DAY) <= day) ctx.leaves();
}

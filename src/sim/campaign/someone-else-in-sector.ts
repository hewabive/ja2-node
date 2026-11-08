// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-07. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc CheckForEndOfBattle (the 3 s customizable timer of every won battle, boxing
// @src included), HandleThePlayerBeNotifiedOfSomeoneElseInSector (the 2 s look again and the OK box with
// @src NS_SOMEONE_ELSE_IN_SECTOR); GameScreen.cc MainGameScreenHandle (CheckCustomizableTimer before the frame's
// @src overhead, skipped in auto-bandage and while tactical is modal); Tactical/Interface_Control.cc AreWeInAUIMenu (the
// @src talk panel).

import { dialogueActive } from '../narrative/talk-state.ts';
import { type BattleState, nextPromptId, PromptKind } from '../strategic/forces/battle-state.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';

const FIRST_LOOK_DELAY_MS = 3000;
const LOOK_AGAIN_DELAY_MS = 2000;
const OK = 'ok';

export function lookForSomeoneElseInSectorLater(campaign: CampaignSim, t: TacticalState): void {
  campaign.state.battle.someoneElseLookAtMs = t.clockMs + FIRST_LOOK_DELAY_MS;
}

export function forgetSomeoneElseInSector(battle: BattleState): void {
  battle.someoneElseLookAtMs = null;
}

function someoneImportantInSector(campaign: CampaignSim): boolean {
  const world = campaign.state.worldSector;
  return world !== null && campaign.strategic?.world.npcOfNoteInSector(world) === true;
}

function messageBoxUp(campaign: CampaignSim, t: TacticalState): boolean {
  return campaign.state.battle.prompt !== null || t.prompt !== null;
}

function somethingElseGoingOn(campaign: CampaignSim, t: TacticalState): boolean {
  const talk = campaign.state.talk.dialogue;
  return t.pathEnv.autoBandage || dialogueActive(talk) || t.autoBandage.pending || messageBoxUp(campaign, t) || talk.inPanel;
}

function notifyOfSomeoneElseInSector(campaign: CampaignSim, t: TacticalState): void {
  if (!someoneImportantInSector(campaign)) return;
  const battle = campaign.state.battle;
  if (somethingElseGoingOn(campaign, t)) {
    battle.someoneElseLookAtMs = t.clockMs + LOOK_AGAIN_DELAY_MS;
    return;
  }
  battle.prompt = { id: nextPromptId(battle, PromptKind.SOMEONE_ELSE_IN_SECTOR), kind: PromptKind.SOMEONE_ELSE_IN_SECTOR };
}

export function handleSomeoneElseInSectorTimer(campaign: CampaignSim): void {
  const battle = campaign.state.battle;
  const t = campaign.tactical?.state;
  const at = battle.someoneElseLookAtMs;
  if (at === null || !t || t.clockMs < at) return;
  forgetSomeoneElseInSector(battle);
  notifyOfSomeoneElseInSector(campaign, t);
}

export const SOMEONE_ELSE_IN_SECTOR_CHOICES: readonly string[] = [OK];

export function answerSomeoneElseInSector(battle: BattleState, choice: string): boolean {
  if (choice !== OK) return false;
  battle.prompt = null;
  return true;
}

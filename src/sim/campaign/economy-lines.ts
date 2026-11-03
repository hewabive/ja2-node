// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc AssignmentDone and HandleRestFatigueAndSleepStatus (TacticalCharacterDialogue,
// @src MakeCharacterDialogueEventSleep), AnyMercInGroupCantContinueMoving (HandleImportantMercQuote, 2026-11-03);
// @src Strategic/Map_Screen_Interface.cc HandleMinerEvent (LeaveTacticalScreen to the
// @src map screen before CharacterDialogue with DIALOGUE_EXTERNAL_NPC_UI).

import {
  externalNpcDialogue,
  handleImportantMercQuote,
  makeCharacterDialogueEventSleep,
  tacticalCharacterDialogue,
} from '../narrative/dialogue-queue.ts';
import type { EconomyHooks } from '../strategic/economy/ports.ts';
import type { Soldier } from '../tactical/soldier.ts';
import type { CampaignSim } from './campaign-sim.ts';

type EconomyLineHooks = Pick<
  EconomyHooks,
  'tacticalCharacterDialogue' | 'makeCharacterDialogueEventSleep' | 'handleImportantMercQuote' | 'headMinerDialogue'
>;

export function economyLineHooks(campaign: CampaignSim): EconomyLineHooks {
  const merc = (id: number): Soldier | null => campaign.battle?.roster.get(id)?.soldier ?? null;
  return {
    tacticalCharacterDialogue: (id, quote) => {
      const host = campaign.talk?.host;
      const s = merc(id);
      if (host && s) tacticalCharacterDialogue(host, s, quote);
    },
    makeCharacterDialogueEventSleep: (id, asleep) => {
      const host = campaign.talk?.host;
      const s = merc(id);
      if (host && s) makeCharacterDialogueEventSleep(host, s, asleep);
    },
    handleImportantMercQuote: (id, quote) => {
      const host = campaign.talk?.host;
      const s = merc(id);
      if (host && s) handleImportantMercQuote(host, s, quote);
    },
    headMinerDialogue: (mine, profile, quote, forceMapScreen) => {
      if (forceMapScreen) campaign.leaveTacticalScreenForMap();
      const host = campaign.talk?.host;
      if (host) externalNpcDialogue(host, profile, quote);
      else campaign.economy?.events.push({ type: 'headMinerQuote', mine, profile, quote });
    },
  };
}

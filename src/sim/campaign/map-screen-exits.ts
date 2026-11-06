// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-06. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Bottom.cc AllowedToExitFromMapscreenTo (the checks every exit from the map
// @src screen shares: someone has something to say, a meanwhile coming up, the pause state locked, the contract renewal
// @src sequence, a battle about to occur).

import type { Refusal, RefusalTexts } from '../tactical/refusal.ts';
import type { CampaignSim } from './campaign-sim.ts';

export type MapScreenExitRefusal = 'dialogueQueued' | 'meanwhileStarting' | 'pauseLocked' | 'renewalSequence' | 'battlePending';

export const MAP_SCREEN_EXIT_REFUSAL_TEXT: RefusalTexts<MapScreenExitRefusal> = {
  dialogueQueued: 'someone has something to say: advance until the queued lines are said',
  meanwhileStarting: 'a meanwhile scene is about to start: advance until it has played',
  pauseLocked: 'a line or an event holds the pause: advance until it ends',
  renewalSequence: 'mercs are asking for contract renewals: answer them first',
  battlePending: 'a battle is about to begin: answer the pre-battle prompt first',
};

function dialogueQueued(campaign: CampaignSim): boolean {
  return (campaign.talk?.talk.queue.length ?? 0) > 0;
}

export function mapScreenExitRefusal(campaign: CampaignSim): MapScreenExitRefusal | null {
  const s = campaign.state;
  if (s.flow !== 'strategic') return null;
  if (dialogueQueued(campaign)) return 'dialogueQueued';
  if (s.meanwhile.trying) return 'meanwhileStarting';
  if (s.clock.pauseLocked) return 'pauseLocked';
  if (campaign.contracts?.sequenceOn) return 'renewalSequence';
  if (s.encounter.preBattle) return 'battlePending';
  return null;
}

export function mapScreenExitRefusalOf(campaign: CampaignSim): Refusal | null {
  const token = mapScreenExitRefusal(campaign);
  return token ? { token, reason: `${token}: ${MAP_SCREEN_EXIT_REFUSAL_TEXT[token]}` } : null;
}

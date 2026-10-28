// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (NPC_ACTION_SLAP, NPC_ACTION_FRUSTRATED_SLAP,
// @src NPC_ACTION_PUNCH_PC_SLOT_0..2, NPC_ACTION_PUNCH_FIRST_LIVING_PC, NPC_ACTION_SHOOT_ELLIOT, NPC_ACTION_END_MEANWHILE,
// @src NPC_ACTION_ENDGAME_STATE_1/2, the Queen's and Elliot's record selectors).

import { createItem } from '../../items/object.ts';
import { soldierByProfile } from '../../narrative/dialogue-queue.ts';
import type { NarrativeHost } from '../../narrative/host.ts';
import { ELLIOT_MAX_SLAPS } from '../../strategic/ai/constants.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { AiAction } from '../../tactical/ai/actions.ts';
import { cancelAIAction } from '../../tactical/ai/control.ts';
import { initNewSoldierAnim } from '../../tactical/animation.ts';
import { AimShot } from '../../tactical/combat/types.ts';
import { InvSlot } from '../../tactical/inventory.ts';
import type { MeanwhileActions, QueenAnimation } from '../../tactical/narrative/npc-actions/env.ts';
import type { Soldier } from '../../tactical/soldier.ts';
import type { CampaignSim } from '../campaign-sim.ts';

const SLAP_ANIMATIONS: Readonly<Record<QueenAnimation, string>> = { slap: 'QUEEN_SLAP', frustratedSlap: 'QUEEN_FRUSTRATED_SLAP' };
const ELLIOT_GUN = 'DESERTEAGLE';
const FULL_STATUS = 100;

function setNextAction(host: NarrativeHost, s: Soldier, action: number, data: number): void {
  const t = host.tactical();
  if (!t) return;
  s.ai.nextAction = action;
  s.ai.nextActionData = data;
  s.ai.handleEveryFrame = true;
  if (s.ai.action !== AiAction.PENDING_ACTION) cancelAIAction(t, s);
}

function playSlap(host: NarrativeHost, npc: number, kind: QueenAnimation): void {
  const t = host.tactical();
  const s = soldierByProfile(host, npc);
  if (!t || !s) return;
  const state = t.content.animations.controls.findIndex((c) => c?.id === SLAP_ANIMATIONS[kind]);
  if (state >= 0) initNewSoldierAnim(t, s, state, 0, false);
}

function startNpcPunch(host: NarrativeHost, npc: number, gridNo: number | null, approach: number): void {
  const s = soldierByProfile(host, npc);
  if (!s || gridNo === null) return;
  s.npcPunch = { approach };
  setNextAction(host, s, AiAction.KNIFE_MOVE, gridNo);
}

function shootElliot(campaign: CampaignSim, host: NarrativeHost, npc: number): void {
  const t = host.tactical();
  const shooter = soldierByProfile(host, npc);
  const elliot = soldierByProfile(host, Npc.ELLIOT);
  if (!t || !shooter || !elliot) return;
  elliot.npcShooting = true;
  shooter.npcShooting = true;
  shooter.aimShotLocation = AimShot.HEAD;
  const gun = t.content.items.byName.get(ELLIOT_GUN);
  if (gun) shooter.inv[InvSlot.HAND] = createItem(t.content.items, gun.index, FULL_STATUS);
  setNextAction(host, shooter, AiAction.FIRE_GUN, elliot.gridNo);
  const profile = campaign.narrative.profile(Npc.ELLIOT);
  if (profile) profile.npcData = ELLIOT_MAX_SLAPS;
}

export function campaignMeanwhileActions(campaign: CampaignSim, host: NarrativeHost): MeanwhileActions {
  return {
    endMeanwhile: () => campaign.meanwhile.endMeanwhile(),
    queenAnimation: (npc, kind) => playSlap(host, npc, kind),
    punch: (npc, gridNo, approach) => startNpcPunch(host, npc, gridNo, approach),
    shootElliot: (npc) => shootElliot(campaign, host, npc),
    endgame: (state) => campaign.endgame.endgameState(state),
    endDemo: () => {},
    wholeTownsUnderControlExceptOmerta: () => campaign.meanwhile.wholeTownsUnderControlExceptOmerta(),
    samSitesUnderPlayerControl: () => campaign.meanwhile.samSitesUnderPlayerControl(),
    lastBattleWon: () => campaign.state.battle.lastBattleWon,
    functionalSamSiteInLastBattleSector: () => campaign.meanwhile.functionalSamSiteInLastBattleSector(),
    firstBattleInTown: (town) => campaign.meanwhile.firstBattleTown() === town,
  };
}

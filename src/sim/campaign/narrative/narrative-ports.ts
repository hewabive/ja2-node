// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Quests.cc CheckFact (stored facts and FACT_CURRENT_SECTOR_IS_SAFE), InternalStartQuest,
// @src InternalEndQuest (the status part); Tactical/Interface_Dialogue.cc HandleNPCDoAction (the generic dialogue
// @src actions: NPC_ACTION_CLOSE_DIALOGUE_PANEL, NPC_ACTION_INITIATE_SHOPKEEPER_INTERFACE,
// @src NPC_ACTION_TURN_TO_FACE_NEAREST_MERC and the face-a-profile codes). See docs/24 §7.5, docs/25 §1.3, §2.2, §3.1.

import { NpcAction, QuestStatusValue } from '../../../content/narrative/npc-constants.ts';
import type { FactSource, NpcActionPort, QuestPort } from '../../narrative/host.ts';
import { NarrativeFact } from '../../narrative/narrative-ids.ts';
import type { TacticalState } from '../../tactical/state.ts';
import { fact, type NarrativeState, setQuestStatus } from './facts.ts';

export function storedFactSource(narrative: NarrativeState, tactical: () => TacticalState | null): FactSource {
  return {
    checkFact: (id) => {
      if (id === NarrativeFact.CURRENT_SECTOR_IS_SAFE) return tactical()?.inCombat !== true;
      return fact(narrative, id);
    },
  };
}

export function statusOnlyQuestPort(narrative: NarrativeState): QuestPort {
  return {
    startQuest: (quest) => setQuestStatus(narrative, quest, QuestStatusValue.IN_PROGRESS),
    endQuest: (quest) => setQuestStatus(narrative, quest, QuestStatusValue.DONE),
  };
}

export interface GenericActionTargets {
  closePanel(): void;
  faceNearestMerc(npc: number): void;
  faceProfile(npc: number, profile: number): void;
  initiateShop(): void;
}

export function genericActionPort(targets: GenericActionTargets): NpcActionPort {
  return {
    handleNpcDoAction: (npc, code) => {
      if (code > NpcAction.TURN_TO_FACE_NEAREST_MERC && code < NpcAction.LAST_TURN_TO_FACE_PROFILE) {
        targets.faceProfile(npc, code - NpcAction.TURN_TO_FACE_NEAREST_MERC);
        return;
      }
      switch (code) {
        case NpcAction.CLOSE_DIALOGUE_PANEL:
          targets.closePanel();
          return;
        case NpcAction.TURN_TO_FACE_NEAREST_MERC:
          targets.faceNearestMerc(npc);
          return;
        case NpcAction.INITIATE_SHOPKEEPER_INTERFACE:
          targets.initiateShop();
          return;
        default:
          return;
      }
    },
  };
}

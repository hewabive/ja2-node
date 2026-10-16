// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (the face-a-profile codes and the dispatch by code).
// @src See docs/25 §3.1.

import type { NpcActionPort } from '../../../narrative/host.ts';
import { handleCambriaAction } from './cambria.ts';
import { NpcActionCode as A } from './codes.ts';
import { handleDrassenAction } from './drassen.ts';
import type { NpcActionEnv } from './env.ts';
import { faceProfile, handleGenericAction } from './generic.ts';
import { handleMeanwhileAction } from './meanwhile.ts';
import { handleOtherAction } from './others.ts';
import { handleRebelAction } from './rebels.ts';
import { handleRequestorAction } from './requestors.ts';
import { handleSanMonaAction } from './san-mona.ts';
import { handleSouthAction } from './south.ts';

type GroupHandler = (env: NpcActionEnv, npc: number, code: number, record: number) => boolean;

const GROUPS: readonly GroupHandler[] = [
  handleGenericAction,
  handleRequestorAction,
  handleRebelAction,
  handleDrassenAction,
  handleSanMonaAction,
  handleCambriaAction,
  handleSouthAction,
  handleOtherAction,
  handleMeanwhileAction,
];

export function isFaceProfileAction(code: number): boolean {
  return code > A.TURN_TO_FACE_NEAREST_MERC && code < A.LAST_TURN_TO_FACE_PROFILE;
}

export function handleNpcDoAction(env: NpcActionEnv, npc: number, code: number, record: number): boolean {
  if (isFaceProfileAction(code)) {
    faceProfile(env, npc, code - A.TURN_TO_FACE_NEAREST_MERC);
    return true;
  }
  return GROUPS.some((group) => group(env, npc, code, record));
}

export function npcActionPort(env: () => NpcActionEnv): NpcActionPort {
  return { handleNpcDoAction: (npc, code, record) => void handleNpcDoAction(env(), npc, code, record) };
}

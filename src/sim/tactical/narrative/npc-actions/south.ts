// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (TRIGGER_MATT, KROTT_ALIVE_LOYALTY_BOOST,
// @src TRIGGER_KROTT_11_OR_12, START_BLOODCAT_QUEST, TRIGGER_BREWSTER_BY_WARDEN_PROXIMITY, TRIGGER_JOE_32_OR_33);
// @src Tactical/Rotting_Corpses.cc GetGridNoOfCorpseGivenProfileID.

import { pythSpacesAway } from '../../../../content/world/grid.ts';
import { Town } from '../../../strategic/economy/constants.ts';
import { Fact, Quest } from '../../../strategic/narrative/fact-ids.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { MercStatus } from '../../profiles.ts';
import { NOWHERE } from '../../soldier.ts';
import { NpcActionCode as A } from './codes.ts';
import { npcSoldier, profileOf, tactical, trigger } from './common.ts';
import type { NpcActionEnv } from './env.ts';

const BREWSTER_WARDEN_DISTANCE = 10;

function corpseGridNoOf(env: NpcActionEnv, profile: number): number {
  return tactical(env)?.corpses.find((c) => c.profile === profile)?.gridNo ?? NOWHERE;
}

function triggerBrewster(env: NpcActionEnv): void {
  const brewster = npcSoldier(env, Npc.BREWSTER);
  if (!brewster) return;
  const warden = corpseGridNoOf(env, Npc.WARDEN);
  const near = warden !== NOWHERE && pythSpacesAway(brewster.gridNo, warden) <= BREWSTER_WARDEN_DISTANCE;
  trigger(env, Npc.BREWSTER, near ? 16 : 17);
}

export function handleSouthAction(env: NpcActionEnv, _npc: number, code: number, _record: number): boolean {
  switch (code) {
    case A.TRIGGER_MATT:
      if (env.checkFact(Fact.DYNAMO_IN_J9, Npc.MATT)) trigger(env, Npc.MATT, 15);
      else if (env.checkFact(Fact.DYNAMO_ALIVE, Npc.MATT)) trigger(env, Npc.MATT, 16);
      return true;
    case A.KROTT_ALIVE_LOYALTY_BOOST:
      if (profileOf(env, Npc.SERGEANT)?.mercStatus !== MercStatus.IS_DEAD)
        env.incrementTownLoyalty(Town.ALMA, env.loyaltyAmount('BONUS_FOR_SERGEANT_KROTT'));
      return true;
    case A.TRIGGER_KROTT_11_OR_12:
      trigger(env, Npc.SERGEANT, env.checkFact(Fact.KROTT_GOT_ANSWER_NO, Npc.SERGEANT) ? 11 : 12);
      return true;
    case A.START_BLOODCAT_QUEST:
      env.startQuest(Quest.BLOODCATS, env.worldSector());
      return true;
    case A.TRIGGER_BREWSTER_BY_WARDEN_PROXIMITY:
      triggerBrewster(env);
      return true;
    case A.TRIGGER_JOE_32_OR_33:
      trigger(env, Npc.JOE, (env.worldSector()?.z ?? 0) > 0 ? 32 : 33);
      return true;
    default:
      return false;
  }
}

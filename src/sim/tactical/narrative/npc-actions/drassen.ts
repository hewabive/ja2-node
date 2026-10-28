// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (REPORT_SHIPMENT_SIZE, RETURN_STOLEN_SHIPMENT_ITEMS,
// @src SET_DELAYED_PACKAGE_TIMER, SET_RANDOM_PACKAGE_DAMAGE_TIMER, ADD_JOHNS_GUN_SHIPMENT).

import { talkingMenuDialogue } from '../../../narrative/dialogue-queue.ts';
import { Fact } from '../../../strategic/narrative/fact-ids.ts';
import { recalculateOppCntsDueToBecomingNeutral } from '../../perception/sight.ts';
import { checkForEndOfCombatMode } from '../../turns/turns.ts';
import { NpcActionCode as A, NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS } from './codes.ts';
import { closeMenu, npcSoldier, tactical } from './common.ts';
import type { NpcActionEnv } from './env.ts';

const ShipmentQuote = { SMALL: 13, MEDIUM: 14, LARGE: 15, BRIBED: 16, BRIBED_MORE: 21 } as const;
const BRIBED_QUOTE_CHANCE = 75;
const PERCENT = 100;
const RETURN_FIRST_MINUTE = 480;
const RETURN_SPREAD_MINUTES = 60;

function reportShipmentSize(env: NpcActionEnv): void {
  const host = env.host;
  if (env.checkFact(Fact.MEDIUM_SIZED_SHIPMENT_WAITING, 0)) talkingMenuDialogue(host, ShipmentQuote.MEDIUM);
  else if (env.checkFact(Fact.LARGE_SIZED_SHIPMENT_WAITING, 0)) talkingMenuDialogue(host, ShipmentQuote.LARGE);
  else talkingMenuDialogue(host, ShipmentQuote.SMALL);
  if (!env.checkFact(Fact.PABLOS_BRIBED, 0) || env.random(PERCENT) >= BRIBED_QUOTE_CHANCE) return;
  talkingMenuDialogue(host, ShipmentQuote.BRIBED);
  if (env.random(PERCENT) < BRIBED_QUOTE_CHANCE) talkingMenuDialogue(host, ShipmentQuote.BRIBED_MORE);
}

function returnStolenShipmentItems(env: NpcActionEnv, npc: number): void {
  env.addFutureDayNpcEvent(
    RETURN_FIRST_MINUTE + env.random(RETURN_SPREAD_MINUTES),
    NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + A.RETURN_STOLEN_SHIPMENT_ITEMS,
    1,
  );
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (!t || !s || s.neutral) return;
  closeMenu(env);
  env.setSoldierNeutral(s);
  s.bleeding = 0;
  recalculateOppCntsDueToBecomingNeutral(t, s);
  if (t.inCombat) checkForEndOfCombatMode(t, false);
}

export function handleDrassenAction(env: NpcActionEnv, npc: number, code: number, _record: number): boolean {
  switch (code) {
    case A.REPORT_SHIPMENT_SIZE:
      reportShipmentSize(env);
      return true;
    case A.RETURN_STOLEN_SHIPMENT_ITEMS:
      returnStolenShipmentItems(env, npc);
      return true;
    case A.SET_DELAYED_PACKAGE_TIMER:
      env.addFutureDayNpcEvent(env.minutesInDay(), Fact.SHIPMENT_DELAYED_24_HOURS, 1);
      return true;
    case A.SET_RANDOM_PACKAGE_DAMAGE_TIMER:
      env.addFutureDayNpcEvent(env.minutesInDay(), NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + code, 1);
      return true;
    case A.ADD_JOHNS_GUN_SHIPMENT:
      env.laptop.addJohnsGunShipment();
      closeMenu(env);
      return true;
    default:
      return false;
  }
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Dialogue_Control.cc SayQuoteFromNearbyMercInSector (with the wisdom roll and the found-items-
// @src missing fact of QUOTE_STUFF_MISSING_DRASSEN); TileEngine/Interactive_Tiles.cc HandleStructChangeFromGridNo (the
// @src crate at the primary delivery point of a shipment Pablo stole from).

import { pythSpacesAway } from '../../content/world/grid.ts';
import { i8 } from '../../core/int.ts';
import { Fact } from '../strategic/narrative/fact-ids.ts';
import { soldierTo3DLocationLos } from '../tactical/combat/positions.ts';
import { isGassed } from '../tactical/explosions/smoke.ts';
import { isRobot } from '../tactical/narrative/robot.ts';
import { MAX_DISTANCE_VISIBLE } from '../tactical/perception/sight.ts';
import { effectiveWisdom } from '../tactical/skills.ts';
import { OKLIFE, type Soldier, Team } from '../tactical/soldier.ts';
import { teamMembers } from '../tactical/state.ts';
import { tacticalCharacterDialogue } from './dialogue-queue.ts';
import type { NarrativeHost } from './host.ts';

export const STUFF_MISSING_DRASSEN = 66;
const STUFF_MISSING_DISTANCE = 3;
const PERCENT = 100;

function hearsAt(host: NarrativeHost, s: Soldier, gridNo: number, distance: number): boolean {
  const t = host.tactical();
  if (!t || s.life < OKLIFE || !s.placed || !host.onSquad(s)) return false;
  if (pythSpacesAway(gridNo, s.gridNo) >= distance) return false;
  if (host.isEpc(s) || isGassed(t, s) || isRobot(s) || host.mercAsleep?.(s)) return false;
  return soldierTo3DLocationLos(t, s, gridNo, 0, 0, MAX_DISTANCE_VISIBLE, true) !== 0;
}

export function sayQuoteFromNearbyMercInSector(host: NarrativeHost, gridNo: number, distance: number, quote: number): void {
  const t = host.tactical();
  if (!t) return;
  const candidates = teamMembers(t, Team.OUR).filter(
    (s) => hearsAt(host, s, gridNo, distance) && !(quote === STUFF_MISSING_DRASSEN && i8(host.random(PERCENT)) > effectiveWisdom(s)),
  );
  if (candidates.length === 0) return;
  const chosen = candidates[host.random(candidates.length)];
  if (!chosen) return;
  if (quote === STUFF_MISSING_DRASSEN) host.setFact(Fact.PLAYER_FOUND_ITEMS_MISSING, true);
  tacticalCharacterDialogue(host, chosen, quote);
}

export interface ShipmentDelivery {
  readonly gridNo: number;
  readonly loadedHere: boolean;
}

export function stuffMissingFromShipment(host: NarrativeHost, gridNo: number, delivery: ShipmentDelivery | null): boolean {
  if (!delivery?.loadedHere || delivery.gridNo !== gridNo) return false;
  if (!host.facts.checkFact(Fact.PABLOS_STOLE_FROM_LATEST_SHIPMENT, 0) || host.facts.checkFact(Fact.PLAYER_FOUND_ITEMS_MISSING, 0))
    return false;
  sayQuoteFromNearbyMercInSector(host, gridNo, STUFF_MISSING_DISTANCE, STUFF_MISSING_DRASSEN);
  return true;
}

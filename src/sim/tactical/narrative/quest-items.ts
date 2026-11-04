// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Explosion_Control.cc PerformItemAction (ACTION_ITEM_KINGPIN_ALARM, ACTION_ITEM_SEX,
// @src ACTION_ITEM_MUSEUM_ALARM), HookerInRoom; TacticalAI/Knowledge.cc CallEldinTo.

import { emptyObject } from '../../items/object.ts';
import { setCivGroupHostility } from '../../strategic/narrative/civ-groups.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { AiAction } from '../ai/actions.ts';
import { changeSoldierState, states } from '../animation.ts';
import { ItemAction, setActionValue } from '../bombs/bomb-object.ts';
import { performItemAction } from '../bombs/item-action.ts';
import { soldierTo3DLocationLos } from '../combat/positions.ts';
import { callAvailableKingpinMenTo } from '../doors/door-traps.ts';
import { stopMerc } from '../movement.ts';
import { Opp } from '../perception/opp.ts';
import { AlertStatus, Body, CivilianGroup, OKLIFE, TEAM_FIRST_ID, Team } from '../soldier.ts';
import { sectorMapOf, type TacticalState, teamMembers, whoIsThere } from '../state.ts';
import { findGridNoFromSweetSpotWithStructData } from '../sweet-spots.ts';
import { teleportSoldier } from '../teleport.ts';
import { enterCombatMode, isTeamActive } from '../turns/turns.ts';
import { makeCivHostile } from './civ-hostility.ts';
import { CivGroupHostility } from './constants.ts';

const NO_ROOM = 0;
const SEX_TELEPORT_RADIUS = 2;
const MAX_DISTANCE_VISIBLE = 26;
const MAX_MISC_NOISE_DURATION = 12;
const ELDIN_GET_CLOSER_DELAY_MS = 100;
const OUR_TEAM_SIZE = TEAM_FIRST_ID[Team.ENEMY] - TEAM_FIRST_ID[Team.OUR];

const SEX_SPOTS: ReadonlyMap<number, { readonly door: number; readonly teleport: number }> = new Map([
  [13414, { door: 13413, teleport: 13413 }],
  [11174, { door: 11173, teleport: 11173 }],
  [12290, { door: 12290, teleport: 12291 }],
]);

export function kingpinAlarm(t: TacticalState, gridNo: number): void {
  t.events.push({ type: 'alarm', gridNo, kind: 'kingpin' });
  callAvailableKingpinMenTo(t, gridNo);
  setCivGroupHostility(t.civGroups, CivilianGroup.KINGPIN, CivGroupHostility.HOSTILE);
  for (const civ of teamMembers(t, Team.CIV)) {
    if (civ.civilianGroup !== CivilianGroup.KINGPIN) continue;
    for (let k = 0; k < OUR_TEAM_SIZE; k++) if (civ.oppList[TEAM_FIRST_ID[Team.OUR] + k] === Opp.SEEN_CURRENTLY) makeCivHostile(t, civ);
  }
  if (!t.inCombat) enterCombatMode(t, Team.CIV);
}

function hookerInRoom(t: TacticalState, room: number): boolean {
  const rooms = sectorMapOf(t).rooms;
  return teamMembers(t, Team.CIV).some((s) => s.life >= OKLIFE && s.neutral && s.bodyType === Body.MINICIV && rooms[s.gridNo] === room);
}

export function sexActionItem(t: TacticalState, gridNo: number): boolean {
  if (t.inCombat) return false;
  const merc = whoIsThere(t, gridNo, 0);
  if (!merc || merc.team !== Team.OUR) return false;
  const rooms = sectorMapOf(t).rooms;
  const room = rooms[gridNo] ?? NO_ROOM;
  const oldRoom = rooms[merc.oldGridNo] ?? NO_ROOM;
  if (room === NO_ROOM || oldRoom === NO_ROOM || oldRoom === room || !hookerInRoom(t, room)) return false;
  stopMerc(t, merc);
  const spot = SEX_SPOTS.get(gridNo);
  if (!spot) return false;
  const doorCloser = emptyObject();
  setActionValue(doorCloser, ItemAction.CLOSE_DOOR);
  const sightChanged = performItemAction(t, spot.door, doorCloser);
  t.events.push({ type: 'sexScene', soldier: merc.id });
  const standing = states(t.content.animations).STANDING;
  const teleport = findGridNoFromSweetSpotWithStructData(t, merc, spot.teleport, SEX_TELEPORT_RADIUS, {
    animState: standing,
    closestToMerc: false,
  });
  changeSoldierState(t, merc, standing, 0, true);
  teleportSoldier(t, merc, teleport, false);
  t.narrative.sexEffects(merc);
  return sightChanged;
}

export function museumAlarm(t: TacticalState, gridNo: number): void {
  t.events.push({ type: 'alarm', gridNo, kind: 'museum' });
  callEldinTo(t, gridNo);
}

function callEldinTo(t: TacticalState, gridNo: number): void {
  if (!isTeamActive(t, Team.CIV)) return;
  const eldin = t.soldiers.find((s) => s?.placed && s.profile === Npc.ELDIN) ?? null;
  if (!eldin || eldin.life < OKLIFE) return;
  if (eldin.ai.alertStatus !== AlertStatus.GREEN && eldin.ai.noiseVolume >= MAX_MISC_NOISE_DURATION / 2) return;
  if (soldierTo3DLocationLos(t, eldin, gridNo, 0, 0, MAX_DISTANCE_VISIBLE, true)) {
    t.narrative.sayHostileQuote(eldin);
    t.perceptionHooks.setNewSituation(eldin);
  } else {
    eldin.ai.noiseGridNo = gridNo;
    eldin.ai.noiseVolume = MAX_MISC_NOISE_DURATION;
    eldin.ai.alertStatus = AlertStatus.RED;
    if (eldin.ai.action !== AiAction.GET_CLOSER || !t.narrative.fact(Fact.MUSEUM_ALARM_WENT_OFF, 0)) {
      t.turnHooks.cancelAIAction(t, eldin);
      eldin.ai.nextAction = AiAction.GET_CLOSER;
      eldin.ai.nextActionData = gridNo;
      eldin.ai.counter = t.clockMs + ELDIN_GET_CLOSER_DELAY_MS;
    }
  }
  t.narrative.setFactTrue(Fact.MUSEUM_ALARM_WENT_OFF);
}

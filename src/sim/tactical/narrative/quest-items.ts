// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Explosion_Control.cc SetOffBombsInGridNo (pressure-triggered action items and switches),
// @src SetOffBombsByFrequency (remote action items), ActivateSwitchInGridNo, AddBombToQueue,
// @src HandleExplosionQueue (the action item branch and the queue end), PerformItemAction (ACTION_ITEM_CLOSE_DOOR,
// @src ACTION_ITEM_KINGPIN_ALARM, ACTION_ITEM_SEX, ACTION_ITEM_MUSEUM_ALARM), HookerInRoom; TacticalAI/Knowledge.cc
// @src CallEldinTo; Tactical/Soldier_Tile.cc TeleportSoldier; Soldier_Add.cc FindGridNoFromSweetSpotWithStructData;
// @src Action_Items.h ItemActionType; Item_Types.h DetonatorType and the bomb fields of OBJECTTYPE
// @src (LoadSaveObjectType.cc ExtractObject, ACTION_ITEM); World_Items.cc AddBombToWorld.

import { WORLD_COLS, WORLD_ROWS } from '../../../content/world/grid.ts';
import { has, StructureFlags } from '../../../content/world/structures.ts';
import { u8 } from '../../../core/int.ts';
import type { ItemObject } from '../../items/object.ts';
import { ObjectFlags } from '../../items/object.ts';
import { setCivGroupHostility } from '../../strategic/narrative/civ-groups.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { AiAction } from '../ai/actions.ts';
import { changeSoldierState, states } from '../animation.ts';
import { soldierTo3DLocationLos } from '../combat/positions.ts';
import { callAvailableKingpinMenTo } from '../doors/door-traps.ts';
import { toggleDoorAt } from '../doors.ts';
import { givingSoldierCancelServices } from '../first-aid.ts';
import { rangeInCellCoords } from '../insertion.ts';
import { setSoldierPosition, stopMerc } from '../movement.ts';
import { findBestPath, NOWHERE, newOKDestination, PathCopy, PathFlags } from '../pathfinding.ts';
import { revealRoofsAndItems } from '../perception/fov.ts';
import { Opp } from '../perception/opp.ts';
import { allTeamsLookForAll, handleSight, SightFlags } from '../perception/sight.ts';
import { AlertStatus, Body, CivilianGroup, OKLIFE, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import { sectorMapOf, type TacticalState, teamMembers, WaitForMercs, whoIsThere } from '../state.ts';
import { enterCombatMode, isTeamActive } from '../turns/turns.ts';
import { type WorldItem, WorldItemFlags } from '../world-items.ts';
import { makeCivHostile } from './civ-hostility.ts';
import { CivGroupHostility } from './constants.ts';

export const ItemAction = {
  OPEN_DOOR: 1,
  CLOSE_DOOR: 2,
  BLOW_UP: 3,
  SMALL_PIT: 4,
  LARGE_PIT: 5,
  KINGPIN_ALARM: 13,
  SEX: 14,
  MUSEUM_ALARM: 23,
} as const;

export const Detonator = { TIMED: 1, REMOTE: 2, PRESSURE: 3, SWITCH: 4 } as const;

const PERFORMED_ACTIONS: ReadonlySet<number> = new Set([
  ItemAction.CLOSE_DOOR,
  ItemAction.KINGPIN_ALARM,
  ItemAction.SEX,
  ItemAction.MUSEUM_ALARM,
]);
const PLAYER_BOMB_OWNER_THRESHOLD = 1;
const BOMB_OWNER_SHIFT = 8;
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

export interface BombFields {
  readonly detonator: number;
  readonly frequency: number;
  readonly owner: number;
  readonly action: number;
}

export function bombFieldsOf(o: ItemObject): BombFields {
  return { detonator: o.gunAmmoType, frequency: u8(o.money), owner: u8(o.money >>> BOMB_OWNER_SHIFT), action: o.keyId };
}

function armedItem(t: TacticalState, wi: WorldItem, name: string): boolean {
  return (wi.flags & WorldItemFlags.ARMED_BOMB) !== 0 && wi.object.item === t.content.items.byName.get(name)?.index;
}

function isPerformedActionItem(t: TacticalState, wi: WorldItem): boolean {
  return armedItem(t, wi, 'ACTION_ITEM') && PERFORMED_ACTIONS.has(bombFieldsOf(wi.object).action);
}

function isDisabled(wi: WorldItem): boolean {
  return (wi.object.flags & ObjectFlags.DISABLED_BOMB) !== 0;
}

function walkingOffOrToExit(t: TacticalState): boolean {
  const code = t.mercsWaiting?.code;
  return code === WaitForMercs.WALKOFF_SCREEN || code === WaitForMercs.WALK_TO_GRIDNO;
}

export function setOffActionItemsInGridNo(t: TacticalState, s: Soldier): void {
  if (s.team !== Team.OUR || walkingOffOrToExit(t)) return;
  for (const wi of t.worldItems) {
    if (wi.gridNo !== s.gridNo || wi.level !== s.level || isDisabled(wi)) continue;
    const isSwitch = armedItem(t, wi, 'SWITCH');
    if (!isSwitch && !isPerformedActionItem(t, wi)) continue;
    const fields = bombFieldsOf(wi.object);
    if (fields.detonator !== Detonator.PRESSURE || fields.owner > PLAYER_BOMB_OWNER_THRESHOLD) continue;
    if (isSwitch) setOffActionItemsByFrequency(t, s, fields.frequency);
    else queueActionItem(t, wi, s);
  }
}

export function activateSwitchInGridNo(t: TacticalState, s: Soldier, g: number): void {
  for (const wi of [...t.worldItems]) {
    if (wi.gridNo !== g || !armedItem(t, wi, 'SWITCH') || isDisabled(wi)) continue;
    const fields = bombFieldsOf(wi.object);
    if (fields.detonator !== Detonator.SWITCH) continue;
    t.turn.attackBusyCount = 0;
    setOffActionItemsByFrequency(t, s, fields.frequency);
  }
}

export function setOffActionItemsByFrequency(t: TacticalState, s: Soldier, frequency: number): void {
  for (const wi of t.worldItems) {
    if (!isPerformedActionItem(t, wi) || isDisabled(wi)) continue;
    const fields = bombFieldsOf(wi.object);
    if (fields.detonator === Detonator.REMOTE && fields.frequency === frequency) queueActionItem(t, wi, s);
  }
}

function queueActionItem(t: TacticalState, item: WorldItem, by: Soldier): void {
  const q = t.actionItems;
  q.person = by;
  q.queue.push(item);
  if (q.active) return;
  q.active = true;
  t.perception.disallowSight = true;
}

export function handleActionItemQueue(t: TacticalState): void {
  const q = t.actionItems;
  if (!q.active) return;
  for (const item of q.queue.splice(0)) {
    if (performItemAction(t, item.gridNo, bombFieldsOf(item.object).action)) q.sightChanged = true;
  }
  const person = q.person;
  if (person && t.turn.attackBusyCount !== 0) return;
  t.perception.disallowSight = false;
  if (person && person.team !== Team.OUR) t.turnHooks.freeUpFromPendingAction(t, person);
  if (q.sightChanged) {
    t.turn.interruptProvoker = person;
    allTeamsLookForAll(t, true);
    for (const m of teamMembers(t, Team.OUR)) revealRoofsAndItems(t, m, false);
    q.sightChanged = false;
    q.person = null;
  }
  q.active = false;
}

function performItemAction(t: TacticalState, gridNo: number, action: number): boolean {
  switch (action) {
    case ItemAction.CLOSE_DOOR:
      return closeDoorAt(t, gridNo);
    case ItemAction.KINGPIN_ALARM:
      kingpinAlarm(t, gridNo);
      return false;
    case ItemAction.SEX:
      return sexActionItem(t, gridNo);
    case ItemAction.MUSEUM_ALARM:
      t.events.push({ type: 'alarm', gridNo, kind: 'museum' });
      callEldinTo(t, gridNo);
      return false;
    default:
      return false;
  }
}

function closeDoorAt(t: TacticalState, gridNo: number): boolean {
  const door = t.world.structures.find(gridNo, StructureFlags.ANYDOOR);
  if (!door || !has(door.flags, StructureFlags.OPEN)) return false;
  const base = t.world.structures.findBase(door)?.gridNo ?? gridNo;
  toggleDoorAt(t, base);
  return true;
}

function kingpinAlarm(t: TacticalState, gridNo: number): void {
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

function sweetSpotWithStructData(t: TacticalState, s: Soldier, sweet: number, radius: number): number {
  if (s.gridNo === sweet) return sweet;
  const probe = { ...s, team: Team.ENEMY, gridNo: sweet, level: 0 };
  const flood = findBestPath(t.pathEnv, probe, NOWHERE, 0, {
    copy: PathCopy.REACHABLE,
    flags: PathFlags.IGNORE_PERSON_AT_DEST | PathFlags.THROUGH_PEOPLE,
    distLimit: radius,
  });
  const cx = sweet % WORLD_COLS;
  const cy = Math.trunc(sweet / WORLD_COLS);
  let best = NOWHERE;
  let lowest = Number.POSITIVE_INFINITY;
  for (let y = Math.max(0, cy - radius); y <= Math.min(WORLD_ROWS - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(WORLD_COLS - 1, cx + radius); x++) {
      const g = y * WORLD_COLS + x;
      if (!flood.reachable?.[g] || !newOKDestination(t.pathEnv, s, g, true, s.level)) continue;
      const range = rangeInCellCoords(sweet, g);
      if (range < lowest) {
        best = g;
        lowest = range;
      }
    }
  }
  return best;
}

export function teleportSoldier(t: TacticalState, s: Soldier, gridNo: number, force: boolean): boolean {
  if (gridNo === NOWHERE || (!newOKDestination(t.pathEnv, s, gridNo, true, 0) && !force)) return false;
  setSoldierPosition(t, s, gridNo);
  s.finalDestination = gridNo;
  revealRoofsAndItems(t, s, true);
  handleSight(t, s, SightFlags.LOOK | SightFlags.RADIO);
  givingSoldierCancelServices(t, s);
  return true;
}

function sexActionItem(t: TacticalState, gridNo: number): boolean {
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
  const sightChanged = closeDoorAt(t, spot.door);
  t.events.push({ type: 'sexScene', soldier: merc.id });
  const teleport = sweetSpotWithStructData(t, merc, spot.teleport, SEX_TELEPORT_RADIUS);
  changeSoldierState(t, merc, states(t.content.animations).STANDING, 0, true);
  teleportSoldier(t, merc, teleport, false);
  t.narrative.sexEffects(merc);
  return sightChanged;
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

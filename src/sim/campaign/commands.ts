// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc (plotting: legs, the Shift shortest route, the confirm on the last sector, the right
// @src click on a path node); Map_Screen_Interface_Map.cc PlotPathForCharacter, ClearPathAfterThisSectorForCharacter;
// @src Map_Screen_Interface.cc HandleMoveoutOfSectorMovementTroops, HandleSettingTheSelectedListOfMercs,
// @src CopyPathToAllSelectedCharacters (MapScreen.cc), CanCharacterMoveInStrategic.

import {
  parseSectorString,
  type Sector,
  sameSector,
  sectorFromStrategicIndex,
  sectorShortString,
  strategicIndex,
} from '../../content/strategic/sector-ids.ts';
import type { CommandAccepted, CommandResult } from '../command.ts';
import type { SleepRefusal } from '../strategic/economy/conditions.ts';
import {
  distributeMilitia,
  MILITIA_RANKS,
  type MilitiaMoveRefusal,
  type MilitiaMoveResult,
  moveMilitia,
} from '../strategic/economy/militia-moves.ts';
import {
  type AssignRefusal,
  type AssignResult,
  type AssignTarget,
  assignSoldiers,
  sleepSoldier,
  wakeSoldier,
} from '../strategic/economy/set-assignment.ts';
import { Assignment } from '../strategic/forces/constants.ts';
import { getGroup } from '../strategic/forces/groups.ts';
import { moveOutOfSector, movingListForSector, regroupsMovingMerc, travellersWith } from '../strategic/forces/move-box.ts';
import { canCharacterMoveInStrategic, canEntireMovementGroupMove, type LoadedSectorStatus } from '../strategic/forces/move-permission.ts';
import type { StrategicContext, StrategicMerc } from '../strategic/forces/ports.ts';
import {
  cancelPathForCharacter,
  clearPathAfterThisSectorForCharacter,
  confirmPathForCharacter,
  lastSectorInMercPath,
  PathEdit,
  PlotRefusal,
  plotLegs,
  plottedRoute,
  setPathForCharacter,
  soldierGroup,
  soldierMercPath,
} from '../strategic/forces/routes.ts';
import { addCharacterToAnySquad, addCharacterToSquad, addCharacterToUniqueSquad, squadJoinRefusal } from '../strategic/forces/squads.ts';
import { calculateTravelTimeOfGroup } from '../strategic/map/travel.ts';
import { type RefusalTexts, refuse, refuseWithText } from '../tactical/refusal.ts';
import type { CampaignSim } from './campaign-sim.ts';

export interface StrategicCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

const ASSIGN_KINDS = new Set(['squad', 'doctor', 'patient', 'repair', 'trainSelf', 'trainTeammate', 'trainByOther', 'trainMilitia']);

type AssignmentRefusal = AssignRefusal | SleepRefusal | 'collapsed';

const ASSIGNMENT_REFUSAL_TEXT: RefusalTexts<AssignmentRefusal> = {
  unknownSoldier: 'no such merc',
  notEligible: 'the merc cannot take that assignment',
  noMilitiaHere: 'militia cannot be trained here',
  loyaltyTooLow: 'the town is not loyal enough to train militia',
  militiaFull: 'the sector already holds all the militia it can',
  tooManyTrainers: 'the sector already has the most militia trainers',
  squadFull: 'that squad is full',
  squadElsewhere: 'that squad is in another sector',
  squadMoving: 'that squad is on the move',
  squadHasVehicle: 'that squad is a vehicle squad',
  conditions: 'the merc cannot rest now',
  walking: 'the merc is on the road',
  driving: 'the merc drives the vehicle',
  sectorNotCleared: 'enemies are in the sector',
  notTired: 'the merc is not tired',
  collapsed: 'the merc collapsed and cannot be woken',
};

function sectorNames(path: readonly number[]): string[] {
  return path.map((i) => {
    const s = sectorFromStrategicIndex(i);
    return s.z ? `${sectorShortString(s)}-${s.z}` : sectorShortString(s);
  });
}

export function parseSector(value: unknown): Sector | null {
  if (typeof value !== 'string') return null;
  try {
    return parseSectorString(value);
  } catch {
    return null;
  }
}

function soldierId(cmd: StrategicCommand): number | null {
  return typeof cmd.soldier === 'number' && Number.isInteger(cmd.soldier) ? cmd.soldier : null;
}

export function sectorList(value: unknown): Sector[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const sectors = value.map(parseSector);
  return sectors.every((s) => s !== null) ? (sectors as Sector[]) : null;
}

function plotRefusalText(refusal: PlotRefusal): string {
  return refusal === PlotRefusal.BAD_SECTOR ? 'a leg ends on a sector that cannot be plotted to' : 'no route to that sector for this merc';
}

export function plotRouteForCharacter(
  ctx: StrategicContext,
  id: number,
  via: readonly Sector[],
  to: Sector,
  options: { readonly shortest: boolean; readonly extend: boolean },
): CommandResult | null {
  const m = ctx.mercs.get(id);
  if (!m) return refuse('noSuchMerc', 'no such merc');
  if (!options.extend) {
    if (via.length === 0 && soldierMercPath(ctx, m).length > 0 && lastSectorInMercPath(m) === strategicIndex(to)) return null;
    cancelPathForCharacter(ctx, id);
  }
  const g = soldierGroup(ctx, m);
  if (!g) return refuse('noRoute', 'the merc has no movement group');
  const origin = strategicIndex(m.sector);
  const legs = plotLegs(ctx, g, soldierMercPath(ctx, m), origin, via, to, { direct: options.shortest });
  if (typeof legs === 'string') return refuse(legs, plotRefusalText(legs));
  const path = plottedRoute(legs, origin, to);
  if (!path) return refuse('noRoute', 'no route to that sector for this merc');
  setPathForCharacter(ctx, id, path);
  confirmPathForCharacter(ctx, id);
  return null;
}

function route(ctx: StrategicContext, cmd: StrategicCommand, loaded: LoadedSectorStatus): CommandResult {
  const id = soldierId(cmd);
  const to = parseSector(cmd.to);
  if (id === null || !ctx.mercs.get(id)) return refuse('noSuchMerc', 'no such merc');
  if (!to) return refuse('badSector', 'to must be a sector such as B9');
  const via = sectorList(cmd.via);
  if (!via) return refuse('badSector', 'via must be a list of sectors such as ["A10"]');
  const refusal = canEntireMovementGroupMove(ctx, id, loaded);
  if (refusal) return refuse(refusal, `the squad cannot move: ${refusal}`);
  const plotted = plotRouteForCharacter(ctx, id, via, to, { shortest: cmd.shortest === true, extend: cmd.extend === true });
  return plotted ?? routeResult(ctx, id);
}

export function routeResult(ctx: StrategicContext, id: number): CommandAccepted & { readonly data: object } {
  const merc = ctx.mercs.get(id);
  const group = merc ? soldierGroup(ctx, merc) : undefined;
  const path = merc ? soldierMercPath(ctx, merc) : [];
  return { ok: true, data: { path: sectorNames(path), etaMinutes: calculateTravelTimeOfGroup(ctx, group ?? null) } };
}

function shortenRoute(ctx: StrategicContext, cmd: StrategicCommand): CommandResult {
  const id = soldierId(cmd);
  const at = parseSector(cmd.at);
  if (id === null || !ctx.mercs.get(id)) return refuse('noSuchMerc', 'no such merc');
  if (!at) return refuse('badSector', 'at must be a sector such as B9');
  const edit = clearPathAfterThisSectorForCharacter(ctx, id, at);
  if (edit === PathEdit.ABORT_PLOTTING) return refuse('noRoute', 'the merc has no path through that sector to shorten');
  if (edit === PathEdit.PATH_SHORTENED) confirmPathForCharacter(ctx, id);
  const result = routeResult(ctx, id);
  return { ...result, data: { ...result.data, edit } };
}

function idList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((x) => typeof x === 'number' && Number.isInteger(x)) ? (value as number[]) : null;
}

function wholeUnits(list: readonly StrategicMerc[], ids: ReadonlySet<number>, unitOf: (m: StrategicMerc) => number | null): Set<number> {
  const units = new Set<number>();
  for (const m of list) {
    const unit = unitOf(m);
    if (unit !== null) units.add(unit);
  }
  for (const m of list) {
    const unit = unitOf(m);
    if (unit !== null && !ids.has(m.id)) units.delete(unit);
  }
  return units;
}

const squadOf = (m: StrategicMerc) => (m.assignment < Assignment.ON_DUTY ? m.assignment : null);
const vehicleOf = (m: StrategicMerc) => (m.assignment === Assignment.VEHICLE ? m.vehicleId : null);

function groupResult(
  ctx: StrategicContext,
  ids: readonly number[],
): { group: number; squad?: number; path: string[]; etaMinutes: number }[] {
  const seen = new Set<number>();
  const groups: { group: number; squad?: number; path: string[]; etaMinutes: number }[] = [];
  for (const id of ids) {
    const m = ctx.mercs.get(id);
    const g = m ? soldierGroup(ctx, m) : undefined;
    if (!m || !g || seen.has(g.id)) continue;
    seen.add(g.id);
    const squad = squadOf(m);
    groups.push({
      group: g.id,
      ...(squad === null ? {} : { squad }),
      path: sectorNames(soldierMercPath(ctx, m)),
      etaMinutes: calculateTravelTimeOfGroup(ctx, g),
    });
  }
  return groups;
}

function routeGroup(ctx: StrategicContext, cmd: StrategicCommand, loaded: LoadedSectorStatus): CommandResult {
  const ids = idList(cmd.soldiers);
  if (!ids || ids.length === 0) return refuse('badSoldiers', 'soldiers must list the mercs who move');
  const to = parseSector(cmd.to);
  if (!to) return refuse('badSector', 'to must be a sector such as B9');
  const via = sectorList(cmd.via);
  if (!via) return refuse('badSector', 'via must be a list of sectors such as ["A10"]');
  const mercs = ids.map((id) => ctx.mercs.get(id));
  if (mercs.some((m) => !m)) return refuse('noSuchMerc', 'no such merc');
  const first = mercs[0] as StrategicMerc;
  if (mercs.some((m) => m && !sameSector(m.sector, first.sector))) return refuse('notInOneSector', 'the mercs must stand in one sector');
  for (const m of mercs) {
    const refusal = m ? canCharacterMoveInStrategic(ctx, m, loaded) : null;
    if (refusal) return refuse(refusal, `${m?.id} cannot move: ${refusal}`);
  }
  const list = movingListForSector(ctx, first.sector);
  const listed = new Set(ids);
  if (ids.some((id) => !list.some((m) => m.id === id))) return refuse('notInMoveList', 'only mercs the move box lists can move');
  const squads = cmd.squads === undefined ? wholeUnits(list, listed, squadOf) : new Set(idList(cmd.squads) ?? []);
  const vehicles = cmd.vehicles === undefined ? wholeUnits(list, listed, vehicleOf) : new Set(idList(cmd.vehicles) ?? []);
  const selection = { soldiers: listed, squads, vehicles };
  if (regroupsMovingMerc(list, selection)) return refuse('reassignOnTheMove', 'mercs on the move cannot change squads');
  const out = moveOutOfSector(ctx, list, selection);
  const anchor = ctx.mercs.get(out.selected[0] ?? -1);
  if (!anchor) return refuse('nothingSelected', 'nobody is left to move');
  const travellers = travellersWith(ctx, anchor, out.selected);
  const refusal = canEntireMovementGroupMove(ctx, anchor.id, loaded);
  if (refusal) return refuse(refusal, `the squad cannot move: ${refusal}`);
  const plotted = plotRouteForCharacter(ctx, anchor.id, via, to, { shortest: cmd.shortest === true, extend: false });
  if (plotted) return plotted;
  const path = soldierMercPath(ctx, anchor);
  const anchorGroup = soldierGroup(ctx, anchor)?.id;
  const done = new Set<number>(anchorGroup === undefined ? [] : [anchorGroup]);
  for (const id of travellers) {
    const m = ctx.mercs.get(id);
    const g = m ? soldierGroup(ctx, m) : undefined;
    if (!m || !g || done.has(g.id)) continue;
    done.add(g.id);
    cancelPathForCharacter(ctx, id);
    setPathForCharacter(ctx, id, path);
    confirmPathForCharacter(ctx, id);
  }
  return { ok: true, data: { groups: groupResult(ctx, travellers), regrouped: out.regrouped } };
}

function cancelRoute(ctx: StrategicContext, cmd: StrategicCommand): CommandResult {
  const id = soldierId(cmd);
  if (id === null || !ctx.mercs.get(id)) return refuse('noSuchMerc', 'no such merc');
  cancelPathForCharacter(ctx, id);
  return { ok: true };
}

function assignSquad(ctx: StrategicContext, cmd: StrategicCommand): CommandResult {
  const id = soldierId(cmd);
  if (id === null || !ctx.mercs.get(id)) return refuse('noSuchMerc', 'no such merc');
  if (cmd.squad === 'any') return { ok: true, data: { squad: addCharacterToAnySquad(ctx, id) } };
  if (cmd.squad === 'new') return { ok: true, data: { squad: addCharacterToUniqueSquad(ctx, id) } };
  if (typeof cmd.squad !== 'number') return refuse('badSquad', "squad must be 0..19, 'new' or 'any'");
  const refusal = squadJoinRefusal(ctx, id, cmd.squad);
  if (refusal) return refuse(refusal, `cannot join that squad: ${refusal}`);
  return addCharacterToSquad(ctx, id, cmd.squad)
    ? { ok: true, data: { squad: cmd.squad } }
    : refuse('cannotJoinSquad', 'cannot join that squad');
}

function assign(campaign: CampaignSim, cmd: StrategicCommand): CommandResult {
  const economy = campaign.economy;
  if (!economy) return refuse('noEconomy', 'assignments need the economy');
  const ids = Array.isArray(cmd.soldiers) ? cmd.soldiers.filter((x): x is number => typeof x === 'number') : [];
  const to = cmd.to as AssignTarget | undefined;
  if (ids.length === 0 || !to || !ASSIGN_KINDS.has(String(to.kind))) return refuse('badAssignment', 'need soldiers and an assignment');
  const results = assignSoldiers(economy, ids, to).map(soldierAssignResult);
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) return refuse(failed.refusal, failed.reason, { results });
  return { ok: true, data: { results } };
}

type SoldierAssignResult =
  | Exclude<AssignResult, { readonly ok: false }>
  | { readonly ok: false; readonly refusal: AssignRefusal; readonly reason: string };

function assignmentRefusalText(token: AssignmentRefusal): string {
  return `${token}: ${ASSIGNMENT_REFUSAL_TEXT[token]}`;
}

function soldierAssignResult(r: AssignResult): SoldierAssignResult {
  return r.ok ? r : { ok: false, refusal: r.reason, reason: assignmentRefusalText(r.reason) };
}

function sleepOrWake(campaign: CampaignSim, cmd: StrategicCommand, sleep: boolean): CommandResult {
  const economy = campaign.economy;
  const id = soldierId(cmd);
  if (!economy || id === null) return refuse('noSuchMerc', 'no such merc');
  const result = sleep ? sleepSoldier(economy, id) : wakeSoldier(economy, id);
  return result.ok ? { ok: true } : refuseWithText(ASSIGNMENT_REFUSAL_TEXT, result.reason);
}

const MILITIA_REFUSAL_TEXT: Readonly<Record<MilitiaMoveRefusal, string>> = {
  badRank: "rank must be 'green', 'regular' or 'elite'",
  badCount: 'count must be a positive whole number',
  badTown: 'town must be a town id',
  underground: 'militia stay on the surface',
  notATown: 'that sector is not a town the player knows',
  samSite: 'militia cannot be moved around SAM sites',
  noMilitiaAllowed: 'that town cannot have militia',
  militiaInCombat: 'militia cannot be moved while the town fights',
  otherTown: 'militia move only between sectors of the same town',
  sectorNotPeaceful: 'both sectors must be ours and free of hostiles',
  notEnoughMilitia: 'not that many militia of that rank in the sector',
  sectorFull: 'a sector holds at most 20 militia',
  noMilitia: 'the town has no militia to distribute',
};

function militiaRank(value: unknown): number {
  if (typeof value === 'number') return value;
  return typeof value === 'string' ? MILITIA_RANKS.indexOf(value) : -1;
}

function militiaResult(result: MilitiaMoveResult): CommandResult {
  return result.ok ? { ok: true } : refuse(result.refusal, MILITIA_REFUSAL_TEXT[result.refusal]);
}

function militiaCommand(campaign: CampaignSim, cmd: StrategicCommand): CommandResult {
  const economy = campaign.economy;
  if (!economy) return refuse('noEconomy', 'militia need the economy');
  if (campaign.state.flow !== 'strategic') return refuse('mapScreenOnly', 'militia are moved on the strategic map only');
  if (cmd.type === 'distributeMilitia') return militiaResult(distributeMilitia(economy, typeof cmd.town === 'number' ? cmd.town : -1));
  const from = parseSector(cmd.from);
  const to = parseSector(cmd.to);
  if (!from || !to) return refuse('badSector', 'from and to must be sectors such as D13');
  const count = cmd.count === undefined ? 1 : typeof cmd.count === 'number' ? cmd.count : -1;
  return militiaResult(moveMilitia(economy, from, to, militiaRank(cmd.rank), count));
}

export function dispatchStrategicCommand(campaign: CampaignSim, cmd: StrategicCommand): CommandResult | null {
  const ctx = campaign.strategic;
  if (!ctx) return null;
  switch (cmd.type) {
    case 'route':
      return route(ctx, cmd, { inCombat: campaign.tactical?.state.inCombat === true });
    case 'cancelRoute':
      return cancelRoute(ctx, cmd);
    case 'shortenRoute':
      return shortenRoute(ctx, cmd);
    case 'moveMilitia':
    case 'distributeMilitia':
      return militiaCommand(campaign, cmd);
    case 'routeGroup':
      return routeGroup(ctx, cmd, { inCombat: campaign.tactical?.state.inCombat === true });
    case 'assignSquad':
      return assignSquad(ctx, cmd);
    case 'assign':
      return assign(campaign, cmd);
    case 'sleep':
      return sleepOrWake(campaign, cmd, true);
    case 'wake':
      return sleepOrWake(campaign, cmd, false);
    default:
      return null;
  }
}

export function groupEta(ctx: StrategicContext, groupId: number): number {
  return calculateTravelTimeOfGroup(ctx, getGroup(ctx, groupId) ?? null);
}

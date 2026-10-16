import { parseSectorString, type Sector, strategicIndex } from '../../content/strategic/sector-ids.ts';
import type { CommandResult } from '../command.ts';
import { type AssignTarget, assignSoldiers, sleepSoldier, wakeSoldier } from '../strategic/economy/set-assignment.ts';
import { getGroup } from '../strategic/forces/groups.ts';
import { canEntireMovementGroupMove, type LoadedSectorStatus } from '../strategic/forces/move-permission.ts';
import type { StrategicContext } from '../strategic/forces/ports.ts';
import {
  cancelPathForCharacter,
  confirmPathForCharacter,
  lastSectorInMercPath,
  plotPathForCharacter,
  soldierGroup,
} from '../strategic/forces/routes.ts';
import { addCharacterToAnySquad, addCharacterToSquad, addCharacterToUniqueSquad } from '../strategic/forces/squads.ts';
import { calculateTravelTimeOfGroup } from '../strategic/map/travel.ts';
import type { CampaignSim } from './campaign-sim.ts';

export interface StrategicCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

const ASSIGN_KINDS = new Set(['squad', 'doctor', 'patient', 'repair', 'trainSelf', 'trainTeammate', 'trainByOther', 'trainMilitia']);

function parseSector(value: unknown): Sector | null {
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

function route(ctx: StrategicContext, cmd: StrategicCommand, loaded: LoadedSectorStatus): CommandResult {
  const id = soldierId(cmd);
  const to = parseSector(cmd.to);
  if (id === null || !ctx.mercs.get(id)) return { ok: false, reason: 'no such merc' };
  if (!to) return { ok: false, reason: 'to must be a sector such as B9' };
  const refusal = canEntireMovementGroupMove(ctx, id, loaded);
  if (refusal) return { ok: false, reason: `the squad cannot move: ${refusal}` };
  const current = ctx.mercs.get(id);
  if (current && current.path.length > 0 && lastSectorInMercPath(current) === strategicIndex(to)) return routeResult(ctx, id);
  cancelPathForCharacter(ctx, id);
  if (!plotPathForCharacter(ctx, id, to)) return { ok: false, reason: 'no route to that sector for this merc' };
  confirmPathForCharacter(ctx, id);
  return routeResult(ctx, id);
}

function routeResult(ctx: StrategicContext, id: number): CommandResult {
  const merc = ctx.mercs.get(id);
  const group = merc ? soldierGroup(ctx, merc) : undefined;
  return { ok: true, data: { path: merc?.path ?? [], etaMinutes: calculateTravelTimeOfGroup(ctx, group ?? null) } };
}

function cancelRoute(ctx: StrategicContext, cmd: StrategicCommand): CommandResult {
  const id = soldierId(cmd);
  if (id === null || !ctx.mercs.get(id)) return { ok: false, reason: 'no such merc' };
  cancelPathForCharacter(ctx, id);
  return { ok: true };
}

function assignSquad(ctx: StrategicContext, cmd: StrategicCommand): CommandResult {
  const id = soldierId(cmd);
  if (id === null || !ctx.mercs.get(id)) return { ok: false, reason: 'no such merc' };
  if (cmd.squad === 'any') return { ok: true, data: { squad: addCharacterToAnySquad(ctx, id) } };
  if (cmd.squad === 'new') return { ok: true, data: { squad: addCharacterToUniqueSquad(ctx, id) } };
  if (typeof cmd.squad !== 'number') return { ok: false, reason: "squad must be 0..19, 'new' or 'any'" };
  return addCharacterToSquad(ctx, id, cmd.squad)
    ? { ok: true, data: { squad: cmd.squad } }
    : { ok: false, reason: 'cannot join that squad' };
}

function assign(campaign: CampaignSim, cmd: StrategicCommand): CommandResult {
  const economy = campaign.economy;
  if (!economy) return { ok: false, reason: 'assignments need the economy' };
  const ids = Array.isArray(cmd.soldiers) ? cmd.soldiers.filter((x): x is number => typeof x === 'number') : [];
  const to = cmd.to as AssignTarget | undefined;
  if (ids.length === 0 || !to || !ASSIGN_KINDS.has(String(to.kind))) return { ok: false, reason: 'need soldiers and an assignment' };
  const results = assignSoldiers(economy, ids, to);
  return { ok: results.every((r) => r.ok), data: results };
}

function sleepOrWake(campaign: CampaignSim, cmd: StrategicCommand, sleep: boolean): CommandResult {
  const economy = campaign.economy;
  const id = soldierId(cmd);
  if (!economy || id === null) return { ok: false, reason: 'no such merc' };
  const result = sleep ? sleepSoldier(economy, id) : wakeSoldier(economy, id);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export function dispatchStrategicCommand(campaign: CampaignSim, cmd: StrategicCommand): CommandResult | null {
  const ctx = campaign.strategic;
  if (!ctx) return null;
  switch (cmd.type) {
    case 'route':
      return route(ctx, cmd, { inCombat: campaign.tactical?.state.inCombat === true });
    case 'cancelRoute':
      return cancelRoute(ctx, cmd);
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

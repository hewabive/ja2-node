import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import type { KnowledgeSoldier } from '../knowledge/view.ts';
import { OKLIFE, type Soldier } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { IN_VEHICLE, NO_DRIVER } from '../tactical/vehicle-presence.ts';
import { isVehicleBody } from '../vehicles/vehicle-list.ts';
import { type HintRefusal, refuseHint } from './types.ts';

export interface ActingSoldier {
  readonly state: TacticalState;
  readonly soldier: Soldier;
  readonly blocked: string | null;
}

function crewBlock(v: KnowledgeSoldier): string | null {
  if (v.vehicle) return IN_VEHICLE.token;
  return isVehicleBody(v.bodyType) && (v.passengers ?? []).length === 0 ? NO_DRIVER.token : null;
}

function blockedBy(world: KnowledgeWorld, id: number): string | null {
  const v = world.tactical?.soldierView(id);
  if (!v) return 'cannotAct';
  const crew = crewBlock(v);
  if (crew) return crew;
  if ((v.life ?? 0) < OKLIFE) return 'cannotAct';
  if (world.view.combat?.uiLocked) return 'uiLocked';
  if (v.canAct === false) return 'mercUnavailable';
  return null;
}

export function actingSoldier(world: KnowledgeWorld, id: unknown): ActingSoldier | { readonly refusal: HintRefusal } {
  const tactical = world.tactical;
  if (!tactical) return { refusal: refuseHint('noSector', 'no sector is loaded') };
  const soldier = typeof id === 'number' ? tactical.ownSoldier(id) : null;
  if (!soldier || typeof id !== 'number') return { refusal: refuseHint('noSuchSoldier', 'no such soldier of yours') };
  return { state: tactical.state, soldier, blocked: blockedBy(world, id) };
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc GetBestPossibleSectorXYZValues.

import type { Sector } from '../../../content/strategic/sector-ids.ts';
import { Assignment, NO_CURRENT_SQUAD } from './constants.ts';
import type { StrategicContext, StrategicMerc } from './ports.ts';

const inTransit = (m: StrategicMerc) => m.assignment === Assignment.IN_TRANSIT;

function currentSquadLeader(ctx: StrategicContext): StrategicMerc | undefined {
  const f = ctx.state.forces;
  if (f.currentSquad === NO_CURRENT_SQUAD) return undefined;
  const first = f.squads[f.currentSquad]?.[0];
  return first === undefined ? undefined : ctx.mercs.get(first);
}

function mercWhoseSectorIsSaved(ctx: StrategicContext): StrategicMerc | undefined {
  const leader = currentSquadLeader(ctx);
  if (leader && !inTransit(leader)) return leader;
  const mercs = ctx.mercs.all();
  return mercs.find((m) => !inTransit(m) && !m.betweenSectors) ?? mercs[0];
}

export function bestPossibleSector(ctx: StrategicContext): Sector | null {
  const world = ctx.state.worldSector;
  if (world) return { ...world };
  const merc = mercWhoseSectorIsSaved(ctx);
  return merc ? { ...merc.sector } : null;
}

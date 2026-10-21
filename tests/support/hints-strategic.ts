import { MAP_SIDE, sectorShortString } from '../../src/content/strategic/sector-ids.ts';
import type { CommandEnvelope } from '../../src/protocol/messages.ts';
import type { PlayerView } from '../../src/protocol/view.ts';

export const STRATEGIC_HINT_SAMPLE_STEP = 3;

export function sampledSectors(step = STRATEGIC_HINT_SAMPLE_STEP): string[] {
  const sectors: string[] = [];
  for (let y = 1; y <= MAP_SIDE; y += step) for (let x = 1; x <= MAP_SIDE; x += step) sectors.push(sectorShortString({ x, y }));
  return sectors;
}

function mercIds(view: PlayerView): number[] {
  return view.strategic?.mercs.map((m) => m.id) ?? [];
}

export function sampleRouteHints(view: PlayerView, step = STRATEGIC_HINT_SAMPLE_STEP): CommandEnvelope[] {
  const sectors = sampledSectors(step);
  const requests: CommandEnvelope[] = [];
  for (const soldier of mercIds(view))
    sectors.forEach((to, k) => {
      const via = k % 4 === 1 ? { via: [sectors[(k + 3) % sectors.length]] } : {};
      requests.push({
        type: 'previewRoute',
        soldier,
        to,
        ...via,
        ...(k % 3 === 2 ? { shortest: true } : {}),
        ...(k % 2 === 0 ? { extend: true } : {}),
        ...(k % 7 === 3 ? { alone: true } : {}),
      });
    });
  return requests;
}

export function sampleHeliHints(view: PlayerView, step = STRATEGIC_HINT_SAMPLE_STEP): CommandEnvelope[] {
  if (!view.strategic?.helicopter) return [];
  const sectors = sampledSectors(step);
  return sectors.map((to, k) => ({
    type: 'previewHeliRoute',
    to,
    ...(k % 5 === 2 ? { via: [sectors[(k + 2) % sectors.length]] } : {}),
    ...(k % 2 === 1 ? { extend: true } : {}),
  }));
}

export function sampleEnterHints(view: PlayerView, step = STRATEGIC_HINT_SAMPLE_STEP): CommandEnvelope[] {
  const own = view.strategic?.mercs.map((m) => m.sector.split('-')[0] ?? m.sector) ?? [];
  return [...new Set([...own, ...sampledSectors(step)])].map((sector) => ({ type: 'canEnterSector', sector }));
}

export function sampleMoveBoxHints(view: PlayerView): CommandEnvelope[] {
  const own = view.strategic?.mercs.map((m) => m.sector) ?? [];
  return [...new Set([...own, 'A9', 'D13', 'A9-1'])].map((sector) => ({ type: 'moveBoxOptions', sector }));
}

export function sampleAssignmentHints(view: PlayerView): CommandEnvelope[] {
  return mercIds(view).map((soldier) => ({ type: 'assignmentOptions', soldier }));
}

const DIRECTIONS = ['north', 'east', 'south', 'west'] as const;

export function sampleExitHints(view: PlayerView): CommandEnvelope[] {
  const own = view.soldiers.filter((s) => s.team === 0).map((s) => s.id);
  const requests: CommandEnvelope[] = [];
  for (const soldier of own) {
    requests.push({ type: 'exitSectorOptions', soldier });
    for (const direction of DIRECTIONS) {
      requests.push({ type: 'exitSectorOptions', soldier, direction });
      requests.push({ type: 'exitSector', soldier, direction, dryRun: true });
      requests.push({ type: 'exitSector', soldier, direction, who: 'merc', load: false, dryRun: true });
    }
  }
  return requests;
}

export function sampleStrategicHints(view: PlayerView, step = STRATEGIC_HINT_SAMPLE_STEP): CommandEnvelope[] {
  return [
    ...sampleRouteHints(view, step),
    ...sampleHeliHints(view, step),
    ...sampleEnterHints(view, step),
    ...sampleAssignmentHints(view),
    ...sampleMoveBoxHints(view),
    ...sampleExitHints(view),
  ];
}

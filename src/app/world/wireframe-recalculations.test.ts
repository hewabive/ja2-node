import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../sim/events.ts';
import { WireframeRecalculationLog } from './wireframe-recalculations.ts';

const roomRevealed: SimEvent = { type: 'wireframesRecalculated', tick: 1, tiles: [[100, 6]], revealed: [[101, 2]] };
const blast: SimEvent = { type: 'wireframesRecalculated', tick: 2, tiles: [[300, 4]], revealed: [] };
const entry = { type: 'sectorLoaded', tick: 3 } as unknown as SimEvent;

describe('the wire frame recalculations a client follows (CalculateWorldWireFrameTiles from RemoveRoomRoof, SpreadEffect)', () => {
  it('keeps every one since the last sector entry in order, and starts a new list at the next entry or load', () => {
    const log = new WireframeRecalculationLog();
    log.follow([roomRevealed, blast]);
    const stay = log.recalculations;
    expect(stay.list).toEqual([
      { tiles: [[100, 6]], revealed: [[101, 2]] },
      { tiles: [[300, 4]], revealed: [] },
    ]);
    log.follow([entry, blast]);
    expect(log.recalculations.list).toEqual([{ tiles: [[300, 4]], revealed: [] }]);
    expect(log.recalculations.generation).toBeGreaterThan(stay.generation);
    const entered = log.recalculations.generation;
    log.restart();
    expect([log.recalculations.list, log.recalculations.generation > entered]).toEqual([[], true]);
  });
});

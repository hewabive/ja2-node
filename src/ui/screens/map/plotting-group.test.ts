import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { HintAnswer } from '../../game-client.ts';
import { MIN_WAIT_TIME_FOR_TEMP_PATH, Plotting } from './plotting.ts';

function client(answer: (req: CommandEnvelope) => HintAnswer) {
  const requests: CommandEnvelope[] = [];
  return {
    requests,
    hintNow: async (req: CommandEnvelope) => {
      requests.push(req);
      return answer(req);
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('plotting for the move box', () => {
  it('previews from the first mover alone without his old path and confirms with one routeGroup', async () => {
    const plan = { soldiers: [3, 1], squads: [0], vehicles: [] };
    const plot = Plotting.forGroup(plan, 2, 'D13');
    plot.baseChanged(['D13', 'C13']);
    const c = client((req) => ({ ok: true, data: { path: ['D13'], temp: ['D13', String(req.to)], edgeMinutes: [], etaMinutes: 90 } }));
    plot.hoverAt({ x: 13, y: 3, z: 0 }, 0);
    plot.update(c, MIN_WAIT_TIME_FOR_TEMP_PATH);
    await settle();
    expect(c.requests).toEqual([{ type: 'previewRoute', soldier: 3, to: 'C13', alone: true }]);
    expect(plot.click({ x: 13, y: 3, z: 0 })).toEqual({ kind: 'appended' });
    plot.shortest = true;
    expect(plot.confirmCommand()).toEqual({ type: 'routeGroup', soldiers: [3, 1], squads: [0], vehicles: [], to: 'C13', shortest: true });
    expect(plot.routeFor(1)).toBeNull();
    expect(plot.hadPath).toBe(false);
  });
});

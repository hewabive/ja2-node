import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HintSources, serialisedView, withQueries } from '../../tests/support/hints.ts';
import { tacticalOf } from '../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { WORLD_COLS } from '../content/world/grid.ts';
import type { CommandEnvelope } from '../protocol/messages.ts';
import { addMercStructure, removeMercStructure } from '../sim/tactical/person-structure.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { placeOccupant, removeOccupant, teamMembers, whoIsThere } from '../sim/tactical/state.ts';
import { createSandboxSession } from './sandbox.ts';
import { Session } from './session.ts';

const SLOW_MS = 60_000;

let kit: StubSectorKit;
let sources: HintSources;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  sources = { read: kit.read, exists: (p) => kit.worlds.exists(p), world: (p) => kit.worlds.world(p) };
});

afterAll(async () => {
  await kit.dispose();
});

async function answers(session: Session, requests: readonly CommandEnvelope[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const q of requests) {
    const { tick: _tick, ...answer } = await session.query(q);
    out.push(answer);
  }
  return out;
}

describe('fairness of the hints: unseen soldiers do not exist in the projection', () => {
  it(
    'gives the same answers whether an unseen enemy stands on the target tile and the path or elsewhere',
    async () => {
      const session = withQueries(new Session('fair', await createSandboxSession(kit.read, false, 3)), sources);
      const sim = tacticalOf(session);
      const t = sim.state;
      const unseen = teamMembers(t, Team.ENEMY).find((s) => s.visible < 0);
      if (!unseen) throw new Error('the stub garrison has no unseen enemy');
      expect(serialisedView(session).soldiers.some((s) => s.id === unseen.id)).toBe(false);
      const merc = teamMembers(t, Team.OUR)[0];
      if (!merc) throw new Error('no merc');
      const at = unseen.gridNo;
      const requests: CommandEnvelope[] = [
        { type: 'previewMove', soldier: merc.id, to: at },
        { type: 'previewMove', soldier: merc.id, to: at + 1 },
        { type: 'previewMove', soldier: merc.id, to: at + WORLD_COLS },
        { type: 'estimateAttack', soldier: merc.id, target: at },
        { type: 'estimateAttack', soldier: merc.id, target: at, aimTime: 4, bodyPart: 'head' },
      ];
      const before = await answers(session, requests);
      expect(whoIsThere(t, at, unseen.level)).toBe(unseen);
      removeMercStructure(t, unseen);
      removeOccupant(t, unseen);
      unseen.gridNo = merc.gridNo + 40 * WORLD_COLS;
      placeOccupant(t, unseen);
      addMercStructure(t, unseen);
      expect(whoIsThere(t, at, unseen.level)).toBeNull();
      expect(await answers(session, requests)).toEqual(before);
    },
    SLOW_MS,
  );
});

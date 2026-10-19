import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HintSources, withQueries } from '../../tests/support/hints.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { CommandEnvelope } from '../protocol/messages.ts';
import { SERVER_QUERY_KINDS } from '../sim/hints/types.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { Session } from './session.ts';
import { snapshotSession } from './session-snapshot.ts';

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

function serverOnlyQueries(merc: number, profile: number): CommandEnvelope[] {
  return [
    { type: 'hireCheck', profile },
    { type: 'impCheckCode', code: 'XEP624' },
    { type: 'aimQuote', profile, contract: 7, gear: true },
    { type: 'bobbyRayQuote', lines: [{ item: 1, used: false, quantity: 1 }], destination: 0, speed: 2 },
    { type: 'insuranceQuote', soldier: merc },
    { type: 'impPreview', answers: Array.from({ length: 16 }, () => 0), gender: 'male' },
    { type: 'arrivalTime' },
    { type: 'quoteTrade', buy: [] },
    { type: 'contractOptions', soldier: merc },
    { type: 'inventory', sector: 'A9', soldier: merc },
    { type: 'inventory', sector: 'B13', soldier: merc },
  ];
}

describe('query purity: a query leaves the session byte-identical and out of the input log', () => {
  it(
    'covers every server-only query kind in a stub campaign on the map screen',
    async () => {
      const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), 5, { mercs: 2, land: false });
      Object.assign(sectorInfo(created.campaign.state.map, parseSectorString('A9')), { numAdmins: 0, numTroops: 0, numElites: 0 });
      const session = withQueries(new Session('purity', created), sources);
      const land = { type: 'compressTime', mode: 2 };
      await created.prepare(land);
      expect(session.dispatch(land).ok).toBe(true);
      expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
      const merc = session.sim.view().strategic?.mercs[0];
      if (!merc) throw new Error('no merc');
      const queries = serverOnlyQueries(merc.id, 1);
      expect(new Set(queries.map((q) => q.type))).toEqual(new Set(SERVER_QUERY_KINDS));
      const before = JSON.stringify(snapshotSession(session.sim));
      const logged = session.log.full().entries.length;
      const answered: string[] = [];
      for (const q of queries) {
        const answer = await session.query(q);
        expect(answer.tick).toBe(session.sim.tick);
        if (answer.ok) answered.push(q.type);
        expect(JSON.stringify(snapshotSession(session.sim)), `${q.type} changed nothing`).toBe(before);
      }
      expect(session.log.full().entries.length).toBe(logged);
      expect(answered).toEqual(expect.arrayContaining(['aimQuote', 'insuranceQuote', 'arrivalTime', 'contractOptions', 'inventory']));
    },
    SLOW_MS,
  );
});

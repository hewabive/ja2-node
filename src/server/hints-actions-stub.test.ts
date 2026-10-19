import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../tests/support/combat.ts';
import { type ClientSide, clientSide, expectHintsAgree, type HintSources, serialisedView, withQueries } from '../../tests/support/hints.ts';
import { doorTiles, kitForHints, sampleActionHints, sampleInventoryHints } from '../../tests/support/hints-actions.ts';
import { approachUntilCombat, BATTLE_SANDBOX_SEED, tacticalOf, untilOurTurn } from '../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { PlayerView } from '../protocol/view.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { createSandboxSession } from './sandbox.ts';
import { Session } from './session.ts';

let kit: StubSectorKit;
let sources: HintSources;
let client: ClientSide;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  sources = { read: kit.read, exists: (p) => kit.worlds.exists(p), world: (p) => kit.worlds.world(p) };
  client = await clientSide(sources);
});

afterAll(async () => {
  await kit.dispose();
});

const ITEM_SPREAD_STEP = 7;
const ROUTE_BUDGET = 10;
const ROUTE_SLICE_SECONDS = 6 * 3600;
const SLOW_SCENARIO_MS = 60_000;
const HIDDEN_ENEMY = 40;

async function sandbox(seed: number): Promise<Session> {
  return withQueries(new Session('hints', await createSandboxSession(kit.read, false, seed)), sources);
}

function kitSquad(session: Session): void {
  const t = tacticalOf(session).state;
  kitForHints(teamMembers(t, Team.OUR), t.content.items);
}

function doorsOf(view: PlayerView): number[] {
  return view.mapPath ? doorTiles(kit.world(view.mapPath)) : [];
}

function itemSpread(): number[] {
  return client.content.items.ordered.filter((_, k) => k % ITEM_SPREAD_STEP === 0).map((d) => d.index);
}

async function inA10(): Promise<Session> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), 5, { mercs: 2, land: false });
  const session = withQueries(new Session('hints-a10', created), sources);
  const start = sectorInfo(created.campaign.state.map, parseSectorString('A9'));
  Object.assign(start, { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await created.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  const first = created.view().strategic?.mercs[0];
  if (!first) throw new Error('no merc');
  expect(session.dispatch({ type: 'route', soldier: first.id, to: 'A10' })).toMatchObject({ ok: true });
  const arrived = () => created.view().strategic?.mercs.every((m) => m.sector === 'A10' && !m.betweenSectors) === true;
  for (let k = 0; k < ROUTE_BUDGET && !arrived(); k++) session.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  const enter = { type: 'enterSector', sector: 'A10' };
  await created.prepare(enter);
  expect(session.dispatch(enter)).toMatchObject({ ok: true });
  session.advance({ idle: true });
  return session;
}

async function expectAgreement(session: Session, items: readonly number[] = []) {
  const view = serialisedView(session);
  return expectHintsAgree(session, client, [...sampleActionHints(view, { doors: doorsOf(view) }), ...sampleInventoryHints(view, items)]);
}

describe('action and inventory hints on stub scenarios, client against server', { timeout: SLOW_SCENARIO_MS }, () => {
  it('agree in the sandbox in real time, with items to place and a wounded merc to bandage', async () => {
    const session = await sandbox(1);
    kitSquad(session);
    const report = await expectAgreement(session, itemSpread());
    expect(report.kinds.get('placements')).toBeGreaterThan(10);
    expect(report.answered).toBeGreaterThan(80);
  });

  it('agree in a turn-based battle', async () => {
    const session = await sandbox(BATTLE_SANDBOX_SEED);
    approachUntilCombat(session, true);
    untilOurTurn(session);
    kitSquad(session);
    const report = await expectAgreement(session);
    expect(report.kinds.get('previewAction')).toBeGreaterThan(0);
  });

  it('let no unseen soldier on the paths or next to the mercs change an answer', async () => {
    const session = await sandbox(1);
    kitSquad(session);
    const view = serialisedView(session);
    const requests = [...sampleActionHints(view, { doors: doorsOf(view) }), ...sampleInventoryHints(view)];
    const answer = async () => {
      const answers = [];
      for (const q of requests) answers.push(await session.query(q));
      return JSON.parse(JSON.stringify(answers)) as unknown;
    };
    const before = await answer();
    const sim = tacticalOf(session);
    const merc = view.soldiers.find((s) => s.team === Team.OUR);
    if (!merc) throw new Error('no merc');
    for (const [k, at] of [merc.gridNo + 1, merc.gridNo + 2, merc.gridNo + 160].entries()) {
      const hidden = spawnSoldier(sim, HIDDEN_ENEMY + k, Team.ENEMY, at, 0);
      expect(hidden.visible).toBe(-1);
    }
    expect(serialisedView(session).soldiers).toEqual(view.soldiers);
    expect(await answer()).toEqual(before);
  });

  it('agree in a campaign sector with NPCs, doors and items on the ground', async () => {
    const session = await inA10();
    kitSquad(session);
    const view = serialisedView(session);
    expect(view.soldiers.some((s) => s.talkable)).toBe(true);
    const report = await expectAgreement(session);
    expect(report.answered).toBeGreaterThan(40);
  });
});

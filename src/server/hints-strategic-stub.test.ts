import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClientSide, clientSide, expectHintsAgree, type HintSources, serialisedView, withQueries } from '../../tests/support/hints.ts';
import { sampleStrategicHints } from '../../tests/support/hints-strategic.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { parseSectorString, strategicIndex } from '../content/strategic/sector-ids.ts';
import { SKYRIDER, setUpHelicopterForPlayer } from '../sim/strategic/forces/helicopter.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { progressFromProfile } from '../sim/tactical/profiles.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
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

const TIMEOUT_MS = 120_000;
const QUIET = ['A9', 'A10', 'B9', 'B10'];
const ROUTE_STEP_SECONDS = 600;

interface Campaign {
  readonly sim: CampaignSession;
  readonly session: Session;
}

async function landedCampaign(seed: number): Promise<Campaign> {
  const sim = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 3, land: false });
  for (const name of QUIET)
    Object.assign(sectorInfo(sim.campaign.state.map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await sim.prepare(land);
  expect(sim.dispatch(land).ok).toBe(true);
  expect(sim.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  const session = withQueries(new Session('strategic-hints', sim), sources);
  return { sim, session };
}

function withHelicopter(c: Campaign): void {
  const campaign = c.sim.campaign;
  const ctx = campaign.strategic;
  if (!ctx) throw new Error('no strategic layer');
  const skyrider = kit.content.profiles[SKYRIDER];
  if (skyrider) campaign.state.profiles.set(SKYRIDER, progressFromProfile(skyrider));
  const a9 = campaign.state.map.elements[strategicIndex(parseSectorString('A9'))];
  if (a9) a9.enemyControlled = false;
  setUpHelicopterForPlayer(ctx, parseSectorString('A9'));
}

describe('strategic cursor hints on a stub campaign, client against server', { timeout: TIMEOUT_MS }, () => {
  it('agree on the map screen right after landing', async () => {
    const c = await landedCampaign(31);
    withHelicopter(c);
    const view = serialisedView(c.session);
    const report = await expectHintsAgree(c.session, client, sampleStrategicHints(view));
    expect(report.kinds.get('previewRoute')).toBeGreaterThan(0);
    expect(report.answered).toBeGreaterThan(20);
  });

  it('agree while the squad travels between sectors', async () => {
    const c = await landedCampaign(32);
    const merc = c.sim.view().strategic?.mercs[0]?.id;
    expect(c.sim.dispatch({ type: 'route', soldier: merc, to: 'A11' })).toMatchObject({ ok: true });
    c.session.advance({ worldSeconds: ROUTE_STEP_SECONDS });
    const view = serialisedView(c.session);
    expect(view.strategic?.groups.some((g) => g.betweenSectors)).toBe(true);
    await expectHintsAgree(c.session, client, sampleStrategicHints(view));
  });
});

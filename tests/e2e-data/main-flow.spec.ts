import { McpGame } from '../../tools/campaign-bot/mcp-game.ts';
import { SERVER, TOKEN, WEB_PORT } from '../e2e/env.ts';
import { MAIN_FLOW_SETTINGS, MainFlow } from '../e2e/main-flow.ts';
import { flowStorage, seedNewCampaigns } from '../e2e/play-flow.ts';
import { expect, test } from './fixture.ts';
import { expectNoMissingArt } from './structure.ts';

const SEED = 1414;
const API_HIRES = 3;
const ROUTE_TO = 'B9';

test.use({ storageState: flowStorage(`http://127.0.0.1:${WEB_PORT}`, MAIN_FLOW_SETTINGS) });

test('the main flow on the original data, structure only: a new game, an A.I.M. hire, the landing battle, the map screen, a save and its load', async ({
  page,
  request,
}) => {
  await seedNewCampaigns(page, SEED);
  const game = await McpGame.connect(SERVER, TOKEN);
  const flow = new MainFlow(page, game);
  const description = `main flow ${Date.now() % 100_000}`;
  try {
    await flow.newGame();
    await expectNoMissingArt(page);
    expect(await flow.hireThroughAim(null)).not.toBe('');
    expect(await flow.hireThroughApi(API_HIRES)).toBe(API_HIRES);
    await flow.land();
    await flow.checkHud();
    await flow.cursorsInRealTime();
    expect(await flow.approach()).toBe('reached');
    await flow.cursorsInCombat();
    expect(await flow.aimedShot()).toBe(true);
    expect(await flow.win()).toBe('won');
    await flow.mapScreen();
    await expectNoMissingArt(page);
    await flow.plotRoute(ROUTE_TO);
    await flow.saveGame(description);
    await flow.loadGame(description);
    await expectNoMissingArt(page);
    expect(flow.shadow.tactical).toBeGreaterThan(0);
    expect(flow.shadow.map).toBeGreaterThan(0);
  } catch (error) {
    console.log(`main flow state: ${JSON.stringify(await flow.state().catch(() => null))}`);
    throw error;
  } finally {
    const saved = await flow.savedNamed(description).catch(() => null);
    if (saved) await request.delete(`/api/saves/${encodeURIComponent(saved)}`);
    if (flow.session) await request.delete(`/api/sessions/${encodeURIComponent(flow.session)}`);
    await game.close();
  }
});

import { expect, test } from '@playwright/test';
import { McpGame } from '../../tools/campaign-bot/mcp-game.ts';
import { E2E_TEST_TIMEOUT_MS, SERVER, TOKEN, WEB_PORT } from './env.ts';
import { MAIN_FLOW_SETTINGS, MainFlow } from './main-flow.ts';
import { flowStorage, seedNewCampaigns } from './play-flow.ts';

const SEED = 1414;
const CANVAS_HIRE = 'Marlow';
const API_HIRES = 3;
const ROUTE_TO = 'B9';

test.use({
  viewport: { width: 1280, height: 960 },
  storageState: flowStorage(`http://127.0.0.1:${WEB_PORT}`, MAIN_FLOW_SETTINGS),
});

test('the main flow on /play with the shadow mode on: a new game, an A.I.M. hire, the landing battle with cursors and the HUD, a route on the map screen, a save and its load', async ({
  page,
  request,
}) => {
  await seedNewCampaigns(page, SEED);
  const game = await McpGame.connect(SERVER, TOKEN, E2E_TEST_TIMEOUT_MS);
  const flow = new MainFlow(page, game);
  const description = `main flow ${Date.now() % 100_000}`;
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    const result = await test.step(name, run);
    console.log(`main flow: ${name} took ${Date.now() - started} ms`);
    return result;
  };
  try {
    await step('new game', () => flow.newGame());
    expect(await step('A.I.M. hire through the canvas', () => flow.hireThroughAim(CANVAS_HIRE))).toBe(CANVAS_HIRE);
    expect(await step('A.I.M. hires through the API', () => flow.hireThroughApi(API_HIRES))).toBe(API_HIRES);
    await step('landing', () => flow.land());
    await step('HUD', () => flow.checkHud());
    await step('cursors in real time', () => flow.cursorsInRealTime());
    expect(await step('approach', () => flow.approach())).toBe('reached');
    await step('cursors in combat', () => flow.cursorsInCombat());
    expect(await step('aimed shot', () => flow.aimedShot())).toBe(true);
    expect(await step('battle', () => flow.win())).toBe('won');
    await step('map screen', () => flow.mapScreen());
    const soldier = await step('route', () => flow.plotRoute(ROUTE_TO));
    await step('save', () => flow.saveGame(description));
    await step('load', () => flow.loadGame(description));
    const group = (await game.observe(flow.session)).strategic?.groups.find((g) => g.members.includes(soldier));
    expect(group?.path).toContain(ROUTE_TO);
    expect(flow.shadow.tactical, 'tactical hints compared with the server').toBeGreaterThan(0);
    expect(flow.shadow.map, 'map hints compared with the server').toBeGreaterThan(0);
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

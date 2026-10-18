import { expect, test } from '@playwright/test';
import { playCampaign } from '../../tools/campaign-bot/campaign.ts';
import { loadItems } from '../../tools/campaign-bot/items.ts';
import { McpGame } from '../../tools/campaign-bot/mcp-game.ts';
import { SERVER, TOKEN } from './env.ts';

const SEED = 3;
const RELOAD_ROUND = 2;
const MIN_COMPARED_STEPS = 20;
const SEGMENT_TIMEOUT_MS = 90_000;
const BOT_SAVES = ['campaign-bot-battle', 'Auto01', 'Auto02'];

test('the campaign bot starts a stub campaign through MCP alone, wins the landing and an exact load in that battle plays on identically', async () => {
  test.setTimeout(SEGMENT_TIMEOUT_MS);
  const game = await McpGame.connect(SERVER, TOKEN);
  try {
    const items = await loadItems();
    const summary = await playCampaign(game, items, {
      seed: SEED,
      stopAfter: 'landing',
      reloads: { exactInBattle: RELOAD_ROUND, playerLoadAfter: null },
    });
    expect(summary).toMatchObject({ outcome: 'stopped', step: 'landing', battles: 1, battlesWon: 1, mercsLost: 0 });
    const exact = summary.reloads.exact;
    expect(exact).not.toBeNull();
    expect(exact?.differences).toEqual([]);
    expect(exact?.steps).toBeGreaterThan(MIN_COMPARED_STEPS);
    expect(summary.session).toBe(exact?.to);
    const after = await game.observe(summary.session);
    expect(after.strategic).toMatchObject({ worldSector: 'A9', campaign: 'playing' });
    expect(after.strategic?.sectors.find((s) => s.sector === 'A9')).toMatchObject({ playerControlled: true, enemies: null });
  } finally {
    for (const name of BOT_SAVES) await game.deleteSave(name).catch(() => null);
    await game.close();
  }
});

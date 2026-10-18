import { DEFAULT_STUBS_DIR } from '../../src/node/repo.ts';
import { buildStubs } from '../../stubs/build.ts';
import { type CampaignSummary, playCampaign } from './campaign.ts';
import { loadItems } from './items.ts';
import { McpGame } from './mcp-game.ts';
import type { ReloadPlan } from './reload.ts';
import { startStubServer } from './stub-server.ts';

export const CAMPAIGN_USAGE = `usage: pnpm cli campaign [--seed N] [--server URL --token TOKEN | --port N] [--verbose] [--trace] [--stop-after STEP] [--no-reload]
  plays a stub campaign through the MCP API alone, from the new game to the Queen's death:
  hires a squad, lands in A9, liberates Drassen, starts the mine, buys at Keith's and Bobby Ray's,
  escorts Skyrider, trains militia, recruits up to twelve mercs from A.I.M. and M.E.R.C., marches on
  Meduna (outfitting and healing at each stop), attacks its outskirts with retreats and storms the palace.
  In the first battle that reaches round 2 it saves, loads the save exactly into a new session and
  checks that both sessions play the rest of the battle identically, then plays on in the loaded one;
  after the Drassen mine it saves and loads once more as a player (reseeded).
  Without --server it starts its own stub server (on --port, else a free port) with a temporary save folder.
  Prints one JSON line: seed, outcome (won|lost|stuck|stopped), days, battles, mercsLost, reloads, ...
  The exit code is 0 for a won campaign.`;

export interface CampaignArgs {
  readonly seed?: string | undefined;
  readonly server?: string | undefined;
  readonly token?: string | undefined;
  readonly port?: string | undefined;
  readonly verbose?: boolean | undefined;
  readonly trace?: boolean | undefined;
  readonly stopAfter?: string | undefined;
  readonly noReload?: boolean | undefined;
}

export const DEFAULT_CAMPAIGN_SEED = 1;
const MAX_PORT = 65_535;
export const DEFAULT_RELOADS: ReloadPlan = { exactInBattle: 2, playerLoadAfter: 'Drassen mine' };

function portOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) throw new Error(`--port must be a port number, got ${value}`);
  return port;
}

function seedOf(value: string | undefined): number {
  if (value === undefined) return DEFAULT_CAMPAIGN_SEED;
  const seed = Number(value);
  if (!Number.isInteger(seed) || seed < 0) throw new Error(`--seed must be a non-negative integer, got ${value}`);
  return seed;
}

async function connect(args: CampaignArgs): Promise<{ game: McpGame; stop: () => Promise<void> }> {
  if (args.server) {
    if (!args.token) throw new Error('--server needs --token');
    return { game: await McpGame.connect(args.server, args.token), stop: async () => {} };
  }
  await buildStubs(DEFAULT_STUBS_DIR);
  const server = await startStubServer(portOf(args.port));
  try {
    return { game: await McpGame.connect(server.url, server.token), stop: () => server.stop() };
  } catch (err) {
    await server.stop();
    throw err;
  }
}

export async function runCampaign(args: CampaignArgs): Promise<number> {
  const seed = seedOf(args.seed);
  const items = await loadItems();
  const { game, stop } = await connect(args);
  const started = performance.now();
  let summary: CampaignSummary;
  try {
    summary = await playCampaign(game, items, {
      seed,
      log: (line) => console.error(line),
      ...(args.verbose ? { verbose: true } : {}),
      ...(args.trace ? { trace: true } : {}),
      ...(args.stopAfter ? { stopAfter: args.stopAfter } : {}),
      ...(args.noReload ? {} : { reloads: DEFAULT_RELOADS }),
    });
  } finally {
    await game.close().catch(() => {});
    await stop();
  }
  console.log(JSON.stringify({ ...summary, seconds: Math.round((performance.now() - started) / 1000) }));
  return summary.outcome === 'won' ? 0 : 1;
}

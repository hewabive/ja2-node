import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { WorldTimeTarget } from '../sim/advance.ts';
import type { Session } from './session.ts';
import { describeSession, NEW_SESSION_SHAPE, openSession, type SessionFactory } from './session-registry.ts';

const SERVER_INFO = { name: 'ja2-node', version: '0.1.0' };

function worldTimeTarget(target: number | { day: number; hour?: number | undefined; minute?: number | undefined }): WorldTimeTarget {
  if (typeof target === 'number') return target;
  return {
    day: target.day,
    ...(target.hour !== undefined ? { hour: target.hour } : {}),
    ...(target.minute !== undefined ? { minute: target.minute } : {}),
  };
}

function text(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] };
}

export function buildMcpServer(sessions: Map<string, Session>, defaultSession: string, createSession?: SessionFactory): McpServer {
  const server = new McpServer(SERVER_INFO);
  const pick = (id: string | undefined): Session => {
    const s = sessions.get(id ?? defaultSession);
    if (!s) throw new Error(`no session ${id ?? defaultSession}`);
    return s;
  };
  const sessionArg = { session: z.string().optional().describe('Session id; defaults to the sandbox session') };

  server.registerTool(
    'status',
    { description: 'Game status: tick, map, time driver, soldier count, whether the simulation is idle.', inputSchema: sessionArg },
    async ({ session }) => text(describeSession(pick(session))),
  );
  if (createSession) {
    server.registerTool(
      'newSession',
      {
        description:
          'Start a fresh game in its own session and return its id; pass it as "session" to the other tools. With nothing else it is the tactical sandbox (same map and squad, independent state). With "campaign" it is a new campaign: the strategic layer runs (world clock, Queen, towns, travel), the squad is hired and, unless land is false, flown into the start sector at 07:00 on day 1 (with original data the squad is A.I.M. profiles 0-39, default six; on stubs "mercs" stub mercs, default four). With "save" (a file name from the original game\'s SavedGames folder without .sav, e.g. SaveGame07) it continues that native savegame. Optional seed for the random streams.',
        inputSchema: NEW_SESSION_SHAPE,
      },
      async (request) => {
        const created = await openSession(sessions, defaultSession, createSession, request);
        return text(describeSession(created));
      },
    );
  }
  server.registerTool(
    'observe',
    {
      description:
        'What the player can see right now: own soldiers (with AP, life and breath) and the others the squad sees, with gridNo, level, sub-tile position, direction and animation; open doors; items the squad has seen on the ground; in turn-based combat whose turn it is, the round and whether an interrupt is open; in a campaign also the clock, strategic map, open prompt, autoresolve battle and open shop (merchant NPCs carry merchant: buySell|buy|sell|repair).',
      inputSchema: sessionArg,
    },
    async ({ session }) => text(pick(session).sim.view()),
  );
  server.registerTool(
    'act',
    {
      description:
        'Issue one game command and get whether it was accepted (refusals say why). Commands: {"type":"move","soldier":<id>,"to":<gridNo>,"mode":"walk"|"run"|"swat"|"crawl"} (mode defaults to the current stance), {"type":"turn","soldier":<id>,"direction":0-7} or {"type":"turn","soldier":<id>,"toward":<gridNo>}, {"type":"stance","soldier":<id>,"stance":"stand"|"crouch"|"prone"}, {"type":"stop","soldier":<id>}, {"type":"attack","soldier":<id>,"target":<gridNo>,"level":0|1,"aimTime":0-4,"bodyPart":"head"|"torso"|"legs"|"random","burst":true|false} (uses what is in hand: fires a gun or a grenade launcher, throws a grenade or rock at the tile, stabs with a knife at a soldier on a side tile, punches a soldier on any adjacent tile with empty hands; aimTime adds one AP and about 10% to hit per point), {"type":"estimateAttack", same fields} (no action; returns data.apCost, data.chanceToHit, data.chanceToGetThrough and for melee data.inReach; for throws data.apCost, data.chanceToHit, data.pathClear, data.landsAt and data.maxRange), {"type":"pickUp","soldier":<id>,"gridNo":<gridNo>,"items":[<index>...]} (walks there and picks up the visible items on that tile, all by default, indices into the observed item list of that tile; 3 AP), {"type":"drop","soldier":<id>,"slot":"hand"|0-18} (drops at the feet), {"type":"climb","soldier":<id>} (onto the adjacent roof edge, or down when on a roof), {"type":"endTurn"} (turn-based combat; also closes an interrupt). In a campaign session also strategic commands: {"type":"route","soldier":<id>,"to":"B9"} (plots and confirms travel for the merc\'s squad; data.path, data.etaMinutes; refused while the squad\'s sector holds enemies, in combat, for the badly wounded or busy), {"type":"cancelRoute","soldier":<id>}, {"type":"assignSquad","soldier":<id>,"squad":0-19|"new"|"any"}, {"type":"assign","soldiers":[<id>...],"to":{"kind":"doctor"|"patient"|"repair"|"trainMilitia"} or {"kind":"trainSelf"|"trainTeammate"|"trainByOther","stat":<n>}}, {"type":"sleep"|"wake","soldier":<id>}, {"type":"enterSector","sector":"B9"} (loads a sector where mercs stand), {"type":"exitSector","soldier":<id>,"direction":"north"|"east"|"south"|"west" (or "exitGrid":<gridNo>),"who":"squad"|"merc","load":true|false} (walks off the map edge into the next sector), {"type":"mapScreen"} and {"type":"tacticalScreen"} (switch between the strategic map, where time can be compressed, and the loaded sector, which stays frozen while the map is open), {"type":"compressTime","mode":2|3|4} (map only; 5, 30 or 60 world minutes per real second; time moves only while the session advances; refused with enemies in the loaded sector), {"type":"stopTime"}, {"type":"answer","prompt":"<id from observe.prompt, optional>","choice":...} (preBattle: "autoresolve"|"enterSector"|"retreat"; surrender: "accept"|"reject"; autoresolveDone: "bandage"|"done"; simultaneousArrival: "coordinate"|"separately"; npcOfNote: "continue"|"stop"; while a prompt is open other commands are refused), {"type":"autoresolveRetreat","soldier":<id>} or {"type":"autoresolveRetreat"} (all; during an autoresolve battle, whose cells, counts and status are in observe.autoresolve), {"type":"autoresolveBattle"} (autoresolve a tactical battle in progress instead of fighting it). Merchants: {"type":"openShop","dealer":<profile id or name>,"soldier":<id>} (the soldier talks to a merchant it sees within 4 tiles, 6 AP; data is the shop as in observe.shop: kind, boxes with unit prices, balance; while a shop is open only quoteTrade, trade and closeShop are accepted and time stands still), {"type":"trade","buy":[{"item":<id>,"element":<n>,"count":<n>}],"sell":[{"soldier":<id>,"slot":0-18|"hand","index":<n>}],"cash":[{"soldier":<id>,"slot":...,"amount":<n>}],"repair":[{"soldier":<id>,"slot":...}],"useBalance":true|false} (one exchange; purchases go to the soldier, or to the floor; refusals such as cannotAfford, dealerCannotAfford, wontBuy, wontRepair carry details in data), {"type":"quoteTrade", same fields} (no action; returns costs, values, repair times and the refusal the trade would get), {"type":"closeShop"}. In combat every action costs AP and only soldiers that have not finished their turn may act; no order is accepted while an attack is still resolving. gridNo = y*160 + x; direction 0 = north (up-right on screen), clockwise.',
      inputSchema: { ...sessionArg, command: z.object({ type: z.string() }).passthrough() },
    },
    async ({ session, command }) => text(await pick(session).prepareAndDispatch(command)),
  );
  server.registerTool(
    'advance',
    {
      description:
        'Let game time run. Tactical: until our soldiers are idle (in combat: it is our turn again and nobody is acting), a listed event happens (arrived, stopped, noPath, doorChanged, noiseHeard, enemySighted, combatStarted, turnStarted, interrupt, combatEnded, shotFired, meleeStrike, explosion, structureDamaged, soldierHit, soldierDied, attackResolved, itemsPickedUp, itemDropped), or a tick limit (5 ms per tick) is reached. Campaign (strategic map): pass worldTime (world seconds or {day, hour, minute}), worldSeconds (from now), compressionStopped (default true: stop whenever compression stops, e.g. a squad arrived; false: restart it and keep going) and mode (2, 3 or 4: 5, 30 or 60 world minutes per second); compression starts by itself. Every report carries worldTime; reason is idle, event, ticks, worldTime, budget, refused (with refusal, e.g. enemies in the loaded sector or a shop is open) or decision. A decision is a pending choice: an interrupt in our favour (act with the listed soldiers, then endTurn) or an open prompt in observe.prompt (preBattle, surrender, autoresolveDone, simultaneousArrival, npcOfNote), answered with act {"type":"answer","choice":...}. During an autoresolve battle advance runs its slices (200 ticks = one battle second).',
      inputSchema: {
        ...sessionArg,
        idle: z.boolean().optional(),
        ticks: z.number().int().positive().max(200_000).optional(),
        events: z.array(z.string()).optional(),
        worldTime: z
          .union([
            z.number().int().nonnegative(),
            z.object({
              day: z.number().int().nonnegative(),
              hour: z.number().int().min(0).max(23).optional(),
              minute: z.number().int().min(0).max(59).optional(),
            }),
          ])
          .optional(),
        worldSeconds: z.number().int().positive().optional(),
        compressionStopped: z.boolean().optional(),
        mode: z.number().int().min(2).max(4).optional(),
      },
    },
    async ({ session, idle, ticks, events, worldTime, worldSeconds, compressionStopped, mode }) => {
      const report = pick(session).advance({
        ...(idle ? { idle: true as const } : {}),
        ...(ticks ? { ticks } : {}),
        ...(events ? { events: events as never } : {}),
        ...(worldTime !== undefined ? { worldTime: worldTimeTarget(worldTime) } : {}),
        ...(worldSeconds ? { worldSeconds } : {}),
        ...(compressionStopped !== undefined ? { compressionStopped } : {}),
        ...(mode ? { mode } : {}),
      });
      return text({
        tick: report.tick,
        reason: report.reason,
        ...(report.worldTime ? { worldTime: report.worldTime } : {}),
        ...(report.refusal ? { refusal: report.refusal } : {}),
        events: report.events,
      });
    },
  );
  return server;
}

export async function handleMcpRequest(
  request: Request,
  sessions: Map<string, Session>,
  defaultSession: string,
  createSession?: SessionFactory,
): Promise<Response> {
  const server = buildMcpServer(sessions, defaultSession, createSession);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

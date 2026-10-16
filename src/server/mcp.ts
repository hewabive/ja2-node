import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { Session } from './session.ts';

const SERVER_INFO = { name: 'ja2-node', version: '0.1.0' };

function text(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] };
}

function describeSession(session: Session): Record<string, unknown> {
  const view = session.sim.view();
  return {
    session: session.id,
    tick: view.tick,
    map: view.mapPath,
    driver: session.driver,
    soldiers: view.soldiers.length,
    idle: session.sim.isIdle(),
  };
}

export function buildMcpServer(sessions: ReadonlyMap<string, Session>, defaultSession: string): McpServer {
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
  server.registerTool(
    'observe',
    {
      description:
        'What the player can see right now: own soldiers (with AP, life and breath) and the others the squad sees, with gridNo, sub-tile position, direction and animation; open doors; and in turn-based combat whose turn it is, the round and whether an interrupt is open.',
      inputSchema: sessionArg,
    },
    async ({ session }) => text(pick(session).sim.view()),
  );
  server.registerTool(
    'act',
    {
      description:
        'Issue one game command and get whether it was accepted (refusals say why). Commands: {"type":"move","soldier":<id>,"to":<gridNo>,"mode":"walk"|"run"|"swat"|"crawl"} (mode defaults to the current stance), {"type":"turn","soldier":<id>,"direction":0-7} or {"type":"turn","soldier":<id>,"toward":<gridNo>}, {"type":"stance","soldier":<id>,"stance":"stand"|"crouch"|"prone"}, {"type":"stop","soldier":<id>}, {"type":"attack","soldier":<id>,"target":<gridNo>,"level":0|1,"aimTime":0-4,"bodyPart":"head"|"torso"|"legs"|"random","burst":true|false} (fires the gun in hand; aimTime adds one AP and about 10% to hit per point), {"type":"estimateAttack", same fields} (no action; returns data.apCost, data.chanceToHit and data.chanceToGetThrough), {"type":"endTurn"} (turn-based combat; also closes an interrupt). In combat every action costs AP and only soldiers that have not finished their turn may act; no order is accepted while an attack is still resolving. gridNo = y*160 + x; direction 0 = north (up-right on screen), clockwise.',
      inputSchema: { ...sessionArg, command: z.object({ type: z.string() }).passthrough() },
    },
    async ({ session, command }) => text(pick(session).dispatch(command)),
  );
  server.registerTool(
    'advance',
    {
      description:
        'Let game time run until our soldiers are idle (in combat: it is our turn again and nobody is acting), a listed event happens (arrived, stopped, noPath, doorChanged, noiseHeard, enemySighted, combatStarted, turnStarted, interrupt, combatEnded, shotFired, soldierHit, soldierDied, attackResolved), a decision is pending (an interrupt in our favour: act with the listed soldiers, then endTurn), or a tick limit (5 ms per tick) is reached.',
      inputSchema: {
        ...sessionArg,
        idle: z.boolean().optional(),
        ticks: z.number().int().positive().max(200_000).optional(),
        events: z.array(z.string()).optional(),
      },
    },
    async ({ session, idle, ticks, events }) => {
      const report = pick(session).advance({
        ...(idle ? { idle: true as const } : {}),
        ...(ticks ? { ticks } : {}),
        ...(events ? { events: events as never } : {}),
      });
      return text({ tick: report.tick, reason: report.reason, events: report.events });
    },
  );
  return server;
}

export async function handleMcpRequest(
  request: Request,
  sessions: ReadonlyMap<string, Session>,
  defaultSession: string,
): Promise<Response> {
  const server = buildMcpServer(sessions, defaultSession);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

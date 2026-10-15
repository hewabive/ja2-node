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
      description: 'What the player can see right now: own soldiers and visible enemies with positions, stance and animation.',
      inputSchema: sessionArg,
    },
    async ({ session }) => text(pick(session).sim.view()),
  );
  server.registerTool(
    'act',
    {
      description: 'Issue one game command, e.g. {"type":"move","soldier":1,"to":12345,"mode":"run"}. Returns whether it was accepted.',
      inputSchema: { ...sessionArg, command: z.object({ type: z.string() }).passthrough() },
    },
    async ({ session, command }) => text(pick(session).dispatch(command)),
  );
  server.registerTool(
    'advance',
    {
      description: 'Let game time run until the simulation is idle, a listed event happens, or a tick limit (5 ms per tick) is reached.',
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
      return text({ tick: report.tick, reason: report.reason, events: report.events.length });
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

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { MessageEntry } from '../../src/protocol/message-log.ts';
import type { PlayerView } from '../../src/protocol/view.ts';

export interface GameEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface AdvanceReport {
  readonly tick: number;
  readonly reason: 'idle' | 'decision' | 'event' | 'ticks' | 'budget' | 'worldTime' | 'refused' | 'ended';
  readonly worldTime?: { readonly day: number; readonly hour: number; readonly minute: number; readonly seconds: number };
  readonly refusal?: string;
  readonly events: readonly GameEvent[];
  readonly messages?: readonly MessageEntry[];
}

export interface ActResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: Record<string, unknown>;
  readonly events?: readonly GameEvent[];
}

export interface AdvanceRequest {
  readonly idle?: boolean;
  readonly ticks?: number;
  readonly events?: readonly string[];
  readonly worldTime?: number | { readonly day: number; readonly hour?: number; readonly minute?: number };
  readonly worldSeconds?: number;
  readonly compressionStopped?: boolean;
  readonly mode?: number;
}

export interface SessionStatus {
  readonly session: string;
  readonly tick: number;
  readonly flow?: string;
  readonly sector?: string;
  readonly campaign?: string;
  readonly noUsableMercs?: boolean;
  readonly canSave?: boolean;
  readonly saveRefusal?: string;
  readonly [key: string]: unknown;
}

export interface Observation extends PlayerView {
  readonly canSave?: boolean;
  readonly saveRefusal?: string;
}

export interface SaveOutcome {
  readonly ok: boolean;
  readonly name?: string;
  readonly refused?: string;
  readonly reason?: string;
}

export interface LoadOutcome extends SessionStatus {
  readonly ok: boolean;
  readonly name?: string;
  readonly seed?: number | null;
  readonly refused?: string;
  readonly reason?: string;
}

export type Command = { readonly type: string } & Readonly<Record<string, unknown>>;

export interface Game {
  readonly calls: number;
  newSession(request: Record<string, unknown>): Promise<SessionStatus>;
  status(session: string): Promise<SessionStatus>;
  observe(session: string): Promise<Observation>;
  act(session: string, command: Command): Promise<ActResult>;
  advance(session: string, request: AdvanceRequest): Promise<AdvanceReport>;
  save(session: string, name: string, description: string): Promise<SaveOutcome>;
  load(name: string, reseed: boolean, session?: string): Promise<LoadOutcome>;
  deleteSave(name: string): Promise<{ readonly deleted: boolean }>;
  close(): Promise<void>;
}

export class McpGame implements Game {
  readonly #client: Client;
  readonly #requestTimeoutMs: number | undefined;
  #calls = 0;

  private constructor(client: Client, requestTimeoutMs: number | undefined) {
    this.#client = client;
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  static async connect(server: string, token: string, requestTimeoutMs?: number): Promise<McpGame> {
    const transport = new StreamableHTTPClientTransport(new URL(`${server}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'ja2-node-campaign-bot', version: '1' });
    await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
    return new McpGame(client, requestTimeoutMs);
  }

  get calls(): number {
    return this.#calls;
  }

  async call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    this.#calls++;
    const options = this.#requestTimeoutMs === undefined ? undefined : { timeout: this.#requestTimeoutMs };
    const result = await this.#client.callTool({ name, arguments: args }, undefined, options);
    const text = (result.content as readonly { readonly text?: string }[])[0]?.text ?? 'null';
    if (result.isError) throw new Error(`${name} failed: ${text}`);
    return JSON.parse(text) as T;
  }

  newSession(request: Record<string, unknown>): Promise<SessionStatus> {
    return this.call('newSession', request);
  }

  status(session: string): Promise<SessionStatus> {
    return this.call('status', { session });
  }

  observe(session: string): Promise<Observation> {
    return this.call('observe', { session });
  }

  act(session: string, command: Command): Promise<ActResult> {
    return this.call('act', { session, command });
  }

  advance(session: string, request: AdvanceRequest): Promise<AdvanceReport> {
    return this.call('advance', { session, ...request });
  }

  save(session: string, name: string, description: string): Promise<SaveOutcome> {
    return this.call('save', { session, name, description });
  }

  load(name: string, reseed: boolean, session?: string): Promise<LoadOutcome> {
    return this.call('load', { name, reseed, ...(session ? { session } : {}) });
  }

  deleteSave(name: string): Promise<{ readonly deleted: boolean }> {
    return this.call('deleteSave', { name });
  }

  close(): Promise<void> {
    return this.#client.close();
  }
}

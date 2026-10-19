import { expect } from 'vitest';
import { WORLD_COLS } from '../../src/content/world/grid.ts';
import type { TacticalWorld } from '../../src/content/world/tactical-world.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CommandEnvelope } from '../../src/protocol/messages.ts';
import type { PlayerView, SoldierView } from '../../src/protocol/view.ts';
import { QueryService } from '../../src/server/query.ts';
import type { Session } from '../../src/server/session.ts';
import { snapshotSession } from '../../src/server/session-snapshot.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CommandResult } from '../../src/sim/command.ts';
import { answerHint } from '../../src/sim/hints/answer.ts';
import { type KnowledgeRules, knowledgeRules, knowledgeWorld } from '../../src/sim/knowledge/knowledge-world.ts';
import { loadStrategicRules } from '../../src/sim/knowledge/strategic.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { loadTacticalContent } from '../../src/sim/tactical/load-content.ts';

export interface HintSources {
  readonly read: ReadFile;
  readonly exists: FileExists;
  world(path: string): TacticalWorld | null;
}

export interface ClientSide {
  readonly rules: KnowledgeRules;
  readonly content: TacticalContent;
}

export async function clientSide(sources: HintSources): Promise<ClientSide> {
  const content = await loadTacticalContent(sources.read);
  const strategic = await loadStrategicRules(sources.read, content.items, sources.exists);
  return { content, rules: knowledgeRules(content, { world: (path) => sources.world(path) }, strategic) };
}

export function withQueries(session: Session, sources: HintSources): Session {
  session.queries = new QueryService(sources.read, sources.exists);
  return session;
}

export function serialisedView(session: Session): PlayerView {
  let view: PlayerView | null = null;
  const unsubscribe = session.subscribe((m) => {
    if (m.t === 'welcome') view = m.view;
  });
  unsubscribe();
  if (!view) throw new Error('the session sent no welcome');
  return JSON.parse(JSON.stringify(view)) as PlayerView;
}

export function clientAnswer(client: ClientSide, view: PlayerView, q: CommandEnvelope): CommandResult {
  return answerHint(knowledgeWorld(view, client.rules, { strict: true }), q);
}

function canonical(result: CommandResult): unknown {
  return JSON.parse(JSON.stringify({ ok: result.ok, reason: result.reason ?? null, data: result.data ?? null }));
}

export interface AgreementReport {
  readonly compared: number;
  readonly answered: number;
  readonly kinds: ReadonlyMap<string, number>;
}

export async function expectHintsAgree(
  session: Session,
  client: ClientSide,
  requests: readonly CommandEnvelope[],
): Promise<AgreementReport> {
  const view = serialisedView(session);
  const before = JSON.stringify(snapshotSession(session.sim));
  const kinds = new Map<string, number>();
  let answered = 0;
  for (const q of requests) {
    const server = await session.query(q);
    const local = clientAnswer(client, view, q);
    expect(server.tick, 'the server answered over the same view').toBe(view.tick);
    expect(canonical(local), `${q.type} ${JSON.stringify(q)}`).toEqual(canonical(server));
    if (local.ok) answered++;
    kinds.set(q.type, (kinds.get(q.type) ?? 0) + 1);
  }
  expect(JSON.stringify(snapshotSession(session.sim)), 'queries leave the session unchanged').toBe(before);
  return { compared: requests.length, answered, kinds };
}

const MODES = [undefined, 'walk', 'run', 'swat', 'crawl'] as const;

function ownSoldiers(view: PlayerView): readonly SoldierView[] {
  return view.soldiers.filter((s) => s.team === 0);
}

function tilesAround(g: number, radius: number, step: number): number[] {
  const x0 = g % WORLD_COLS;
  const y0 = Math.trunc(g / WORLD_COLS);
  const tiles: number[] = [];
  for (let dy = -radius; dy <= radius; dy += step)
    for (let dx = -radius; dx <= radius; dx += step) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x >= 0 && y >= 0 && x < WORLD_COLS && y < WORLD_COLS) tiles.push(y * WORLD_COLS + x);
    }
  return tiles;
}

export interface SampleOptions {
  readonly radius?: number;
  readonly step?: number;
}

export function sampleMoveHints(view: PlayerView, options: SampleOptions = {}): CommandEnvelope[] {
  const requests: CommandEnvelope[] = [];
  const radius = options.radius ?? 12;
  const step = options.step ?? 3;
  for (const s of ownSoldiers(view)) {
    tilesAround(s.gridNo, radius, step).forEach((to, k) => {
      const mode = MODES[k % MODES.length];
      requests.push({ type: 'previewMove', soldier: s.id, to, ...(mode ? { mode } : {}) });
    });
  }
  return requests;
}

export function sampleAttackHints(view: PlayerView, options: SampleOptions = {}): CommandEnvelope[] {
  const requests: CommandEnvelope[] = [];
  const others = view.soldiers.filter((s) => s.team !== 0);
  for (const s of ownSoldiers(view)) {
    for (const o of others)
      for (let aim = 0; aim <= 4; aim += 2)
        requests.push({ type: 'estimateAttack', soldier: s.id, target: o.gridNo, level: o.level, aimTime: aim });
    for (const g of tilesAround(s.gridNo, options.radius ?? 10, options.step ?? 5))
      requests.push({ type: 'estimateAttack', soldier: s.id, target: g, bodyPart: 'torso' });
  }
  return requests;
}

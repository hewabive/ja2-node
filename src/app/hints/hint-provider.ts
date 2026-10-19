import type { CommandEnvelope } from '../../protocol/messages.ts';
import type { PlayerView } from '../../protocol/view.ts';
import { answerHint } from '../../sim/hints/answer.ts';
import { isHintKind } from '../../sim/hints/types.ts';
import { type KnowledgeRules, knowledgeWorld } from '../../sim/knowledge/knowledge-world.ts';
import { type GameClient, type HintAnswer, type HintAnswerSource, type HintReply, PENDING_HINT } from '../../ui/game-client.ts';

export const PATHFIND_REST_MS = 80;
const MAX_KEPT_MISMATCHES = 32;
const MAX_KEPT_LATENCIES = 4096;

export interface QueryReply extends HintAnswer {
  readonly tick: number;
}

export interface HintChannel {
  readonly latestView: PlayerView | null;
  query(request: CommandEnvelope): Promise<QueryReply>;
}

export interface LocalKnowledge {
  readonly usable: boolean;
  readonly rules: KnowledgeRules;
  readonly worlds: { has(path: string): boolean; ensure(path: string): Promise<void> };
}

export interface HintProviderOptions {
  readonly channel: HintChannel;
  readonly knowledge: () => LocalKnowledge | null;
  readonly now: () => number;
  readonly restMs?: number;
  readonly shadow?: boolean;
}

export interface HintMismatch {
  readonly request: CommandEnvelope;
  readonly tick: number;
  readonly local: HintAnswer;
  readonly server: HintAnswer;
}

export interface LatencySummary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface HintStats {
  readonly local: number;
  readonly server: number;
  readonly cacheHits: number;
  readonly shadowCompared: number;
  readonly shadowStale: number;
  readonly shadowFailed: number;
  readonly mismatchCount: number;
  readonly mismatches: readonly HintMismatch[];
  readonly latency: LatencySummary;
}

interface Ready {
  readonly answer: HintAnswer;
  readonly source: HintAnswerSource;
}

function canonical(answer: HintAnswer): string {
  return JSON.stringify({ ok: answer.ok, reason: answer.reason ?? null, data: answer.data ?? null });
}

function plain(answer: HintAnswer): HintAnswer {
  return JSON.parse(
    JSON.stringify({
      ok: answer.ok,
      ...(answer.reason ? { reason: answer.reason } : {}),
      ...(answer.data !== undefined ? { data: answer.data } : {}),
    }),
  );
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0;
}

export class HintProvider implements GameClient {
  readonly #options: HintProviderOptions;
  readonly #restMs: number;
  readonly #cache = new Map<string, Ready>();
  readonly #inflight = new Set<string>();
  readonly #latencies: number[] = [];
  readonly #mismatches: HintMismatch[] = [];
  #cachedFor: PlayerView | null = null;
  #pendingKey: string | null = null;
  #pendingSince = 0;
  #local = 0;
  #server = 0;
  #cacheHits = 0;
  #shadowCompared = 0;
  #shadowStale = 0;
  #shadowFailed = 0;
  #mismatchCount = 0;
  shadow: boolean;

  constructor(options: HintProviderOptions) {
    this.#options = options;
    this.#restMs = options.restMs ?? PATHFIND_REST_MS;
    this.shadow = options.shadow ?? false;
  }

  get stats(): HintStats {
    const sorted = [...this.#latencies].sort((a, b) => a - b);
    return {
      local: this.#local,
      server: this.#server,
      cacheHits: this.#cacheHits,
      shadowCompared: this.#shadowCompared,
      shadowStale: this.#shadowStale,
      shadowFailed: this.#shadowFailed,
      mismatchCount: this.#mismatchCount,
      mismatches: [...this.#mismatches],
      latency: { count: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted.at(-1) ?? 0 },
    };
  }

  resetStats(): void {
    this.#latencies.length = 0;
    this.#mismatches.length = 0;
    this.#local = 0;
    this.#server = 0;
    this.#cacheHits = 0;
    this.#shadowCompared = 0;
    this.#shadowStale = 0;
    this.#shadowFailed = 0;
    this.#mismatchCount = 0;
  }

  #view(): PlayerView | null {
    const view = this.#options.channel.latestView;
    if (view !== this.#cachedFor) {
      this.#cache.clear();
      this.#cachedFor = view;
    }
    return view;
  }

  #knowledgeFor(view: PlayerView): LocalKnowledge | null {
    const knowledge = this.#options.knowledge();
    if (!knowledge?.usable) return null;
    if (view.mapPath && !knowledge.worlds.has(view.mapPath)) {
      void knowledge.worlds.ensure(view.mapPath);
      return null;
    }
    return knowledge;
  }

  hint(request: CommandEnvelope): HintReply {
    const view = this.#view();
    if (!view) return PENDING_HINT;
    const key = JSON.stringify(request);
    const cached = this.#cache.get(key);
    if (cached) {
      this.#cacheHits++;
      return { state: 'ready', ...cached };
    }
    const now = this.#options.now();
    if (key !== this.#pendingKey) {
      this.#pendingKey = key;
      this.#pendingSince = now;
    }
    if (now - this.#pendingSince < this.#restMs) return PENDING_HINT;
    return this.#resolve(request, key, view);
  }

  async hintNow(request: CommandEnvelope): Promise<HintAnswer> {
    const view = this.#view();
    if (!view) return this.query(request);
    const knowledge = isHintKind(request.type) ? this.#knowledgeFor(view) : null;
    if (!knowledge) return this.query(request);
    return this.#computeLocal(request, view, knowledge);
  }

  async query(request: CommandEnvelope): Promise<HintAnswer> {
    this.#server++;
    return plain(await this.#options.channel.query(request));
  }

  #resolve(request: CommandEnvelope, key: string, view: PlayerView): HintReply {
    const knowledge = isHintKind(request.type) ? this.#knowledgeFor(view) : null;
    if (knowledge) {
      const answer = this.#computeLocal(request, view, knowledge);
      this.#cache.set(key, { answer, source: 'local' });
      return { state: 'ready', answer, source: 'local' };
    }
    this.#askServer(request, key, view);
    return PENDING_HINT;
  }

  #askServer(request: CommandEnvelope, key: string, view: PlayerView): void {
    if (this.#inflight.has(key)) return;
    this.#inflight.add(key);
    this.#server++;
    this.#options.channel.query(request).then(
      (reply) => {
        this.#inflight.delete(key);
        if (this.#cachedFor === view) this.#cache.set(key, { answer: plain(reply), source: 'server' });
      },
      () => this.#inflight.delete(key),
    );
  }

  #computeLocal(request: CommandEnvelope, view: PlayerView, knowledge: LocalKnowledge): HintAnswer {
    const started = performance.now();
    const answer = plain(answerHint(knowledgeWorld(view, knowledge.rules), request));
    this.#latencies.push(performance.now() - started);
    if (this.#latencies.length > MAX_KEPT_LATENCIES) this.#latencies.shift();
    this.#local++;
    if (this.shadow) this.#compareWithServer(request, view, answer);
    return answer;
  }

  #compareWithServer(request: CommandEnvelope, view: PlayerView, local: HintAnswer): void {
    this.#options.channel.query(request).then(
      (server) => {
        if (server.tick !== view.tick) {
          this.#shadowStale++;
          return;
        }
        this.#shadowCompared++;
        if (canonical(local) === canonical(server)) return;
        this.#mismatchCount++;
        if (this.#mismatches.length < MAX_KEPT_MISMATCHES)
          this.#mismatches.push({ request, tick: view.tick, local, server: plain(server) });
      },
      () => {
        this.#shadowFailed++;
      },
    );
  }
}

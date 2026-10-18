import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCampaignSession } from '../../../src/server/campaign-factory.ts';
import { ContentLedger } from '../../../src/server/content-identity.ts';
import { encodeSaveFile, inflateSave, parseSaveText, snapshotOf } from '../../../src/server/save-file.ts';
import { SaveService } from '../../../src/server/save-service.ts';
import { createSaveSession } from '../../../src/server/save-session.ts';
import { SaveStore } from '../../../src/server/save-store.ts';
import { Session, type SessionSim } from '../../../src/server/session.ts';
import { restoreSession } from '../../../src/server/session-snapshot.ts';
import { ArenaLayout, generateArena } from '../arena.ts';
import { type BenchContext, measure, type VariantSpec } from '../measure.ts';
import { round } from '../stats.ts';
import { createTacticalBench } from '../tactical.ts';

export const SAVE = 'save';

const SAVE_TARGET_MS = 100;
const SAMPLES = 5;
const SETTLE_TICKS = 400;
const ARENA_SOLDIERS = 64;
const ARENA_MERCS = 6;
const SECTOR = { x: 9, y: 1 };
const KIB = 1024;
const UNUSED_DIR = '.cache/bench/saves';

interface SaveBench {
  readonly session: Session;
  readonly service: SaveService;
  readonly restore: (sim: ReturnType<typeof snapshotOf>) => Promise<SessionSim>;
}

function elapsed(t0: number): number {
  return performance.now() - t0;
}

function service(ctx: BenchContext): SaveService {
  const ledger = new ContentLedger(ctx.data.source, ctx.data.read, (path) => ctx.data.exists(path));
  return new SaveService({
    store: new SaveStore(UNUSED_DIR),
    ledger,
    dataVersion: ctx.data.source === 'stubs' ? 'stubs' : 'english',
    engine: { version: 'bench', commit: 'bench' },
    restore: (snapshot) => restoreSession(snapshot, ledger.read, ledger.exists, { layers: ctx.data.layers }),
  });
}

function bench(ctx: BenchContext, session: Session, s: SaveService): SaveBench {
  return {
    session,
    service: s,
    restore: (snapshot) => restoreSession(snapshot, s.ledger.read, s.ledger.exists, { layers: ctx.data.layers }),
  };
}

function variant(
  ctx: BenchContext,
  name: string,
  info: Record<string, unknown>,
  setup: (s: SaveService) => Promise<Session>,
): VariantSpec<SaveBench> {
  return {
    variant: name,
    metric: 'save',
    unit: 'ms',
    target: SAVE_TARGET_MS,
    setup: async () => {
      const s = service(ctx);
      const session = await setup(s);
      session.advance({ ticks: SETTLE_TICKS });
      return bench(ctx, session, s);
    },
    run: async ({ session, service: s, restore }) => {
      const samples: number[] = [];
      const series: Record<string, number[]> = { snapshotMs: [], encodeMs: [], parseMs: [], restoreMs: [], loadMs: [] };
      let raw = 0;
      let gzipped = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const t0 = performance.now();
        const file = s.saveFileOf(session, 'bench');
        const snapshotMs = elapsed(t0);
        const t1 = performance.now();
        const encoded = encodeSaveFile(file);
        const encodeMs = elapsed(t1);
        samples.push(elapsed(t0));
        const t2 = performance.now();
        const { text } = inflateSave(encoded.bytes);
        const parsed = parseSaveText(text);
        const parseMs = elapsed(t2);
        const t3 = performance.now();
        await restore(snapshotOf(parsed));
        const restoreMs = elapsed(t3);
        series.snapshotMs?.push(snapshotMs);
        series.encodeMs?.push(encodeMs);
        series.parseMs?.push(parseMs);
        series.restoreMs?.push(restoreMs);
        series.loadMs?.push(parseMs + restoreMs);
        raw = text.length;
        gzipped = encoded.bytes.length;
      }
      return {
        samples,
        series,
        counters: { rawKiB: round(raw / KIB, 1), gzipKiB: round(gzipped / KIB, 1), tick: session.sim.tick },
        work: { raw, gzipped },
        info,
      };
    },
  };
}

function largestNativeSave(dir: string | null): string | null {
  if (!dir) return null;
  try {
    const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.sav'));
    files.sort((a, b) => statSync(join(dir, b)).size - statSync(join(dir, a)).size);
    return files[0] ? join(dir, files[0]) : null;
  } catch {
    return null;
  }
}

export async function save(ctx: BenchContext): Promise<void> {
  const arena = generateArena({
    name: `patrol-${ARENA_SOLDIERS}`,
    layout: ArenaLayout.PATROL,
    enemies: ARENA_SOLDIERS / 2,
    elites: 0,
    militia: 0,
    civilians: ARENA_SOLDIERS / 2,
    mercs: ARENA_MERCS,
    seed: ctx.seed,
  });
  await measure(
    ctx,
    SAVE,
    variant(ctx, `arena-${ARENA_SOLDIERS}`, { soldiers: ARENA_SOLDIERS, mercs: ARENA_MERCS }, async () => {
      const sim = await createTacticalBench(ctx.data, await ctx.data.addArena(arena), ctx.seed, {
        sector: SECTOR,
        mercs: ARENA_MERCS,
        mercGridNos: arena.mercGridNos,
        garrison: arena.garrison,
        militia: 0,
      });
      return new Session('save-arena', sim);
    }),
  );
  await measure(
    ctx,
    SAVE,
    variant(ctx, 'campaign-landed', { campaign: 'new campaign, squad landed' }, async (s) => {
      const sim = await createCampaignSession(s.ledger.read, s.ledger.exists, ctx.seed, {}, ctx.data.layers);
      return new Session('save-campaign', sim);
    }),
  );
  const native = ctx.data.source === 'original' ? largestNativeSave(ctx.data.savesDir) : null;
  if (!native) return;
  await measure(
    ctx,
    SAVE,
    variant(ctx, 'native-import', { save: 'largest native save of the SavedGames folder' }, async (s) => {
      const bytes = new Uint8Array(await readFile(native));
      const { session } = await createSaveSession(s.ledger.read, bytes, ctx.seed, s.ledger.exists, ctx.data.layers);
      return new Session('save-import', session);
    }),
  );
}

import type { CommandEnvelope } from '../protocol/messages.ts';
import type { StopCondition } from '../sim/advance.ts';
import type { LogOrigin } from './input-log.ts';
import { decodeInputLog, type InputEntry, type LogSegment } from './input-log.ts';
import { inflateSave, parseSaveText, snapshotOf, snapshotText } from './save-file.ts';
import { reseedSessionSim, type SaveService, sessionSnapshot } from './save-service.ts';
import { DEFAULT_SESSION_TEXT, Session, type SessionSim } from './session.ts';

const DIFFERENCE_CONTEXT = 120;

export type OriginBuilder = (origin: LogOrigin) => Promise<SessionSim>;

export interface ReplayResult {
  readonly name: string;
  readonly entries: number;
  readonly equal: boolean;
  readonly bytes: number;
  readonly difference: string | null;
}

async function applyEntry(session: Session, entry: InputEntry, saves: SaveService | null): Promise<void> {
  const p = entry.payload;
  switch (entry.kind) {
    case 'cmd':
    case 'answer':
      session.dispatch(p.cmd as CommandEnvelope);
      return;
    case 'advance':
      session.advance(p.until as StopCondition, typeof p.budget === 'number' ? p.budget : undefined);
      return;
    case 'prepare':
      await session.prepareMaps(p.maps as string[]);
      return;
    case 'reseed': {
      const seed = Number(p.seed);
      session.reseed(seed, () => reseedSessionSim(session.sim, seed));
      return;
    }
    case 'load': {
      if (!saves) throw new Error('replaying a load needs the save service');
      const opened = await saves.open(String(p.name));
      if (opened.digest !== p.digest) throw new Error(`the save ${String(p.name)} changed since the log was written`);
      session.replace(opened.sim, { name: opened.name, digest: opened.digest });
      return;
    }
    case 'drive':
      return;
  }
}

export async function replaySegment(segment: LogSegment, build: OriginBuilder, saves: SaveService | null): Promise<Session> {
  const session = new Session('replay', await build(segment.origin), DEFAULT_SESSION_TEXT, segment.origin);
  for (const entry of segment.entries) await applyEntry(session, entry, saves);
  return session;
}

export function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - DIFFERENCE_CONTEXT);
  return `at byte ${i}:\n  saved:    ${a.slice(from, i + DIFFERENCE_CONTEXT)}\n  replayed: ${b.slice(from, i + DIFFERENCE_CONTEXT)}`;
}

export async function replaySave(name: string, saves: SaveService, build: OriginBuilder): Promise<ReplayResult> {
  const bytes = await saves.store.read(name);
  if (!bytes) throw new Error(`no save named ${name}`);
  const logBytes = await saves.store.readLog(name);
  if (!logBytes) throw new Error(`the save ${name} has no input log`);
  const log = decodeInputLog(logBytes);
  const expected = snapshotText(snapshotOf(parseSaveText(inflateSave(bytes).text)));
  const session = await replaySegment(log, build, saves);
  const actual = snapshotText(sessionSnapshot(session));
  return {
    name,
    entries: log.entries.length,
    equal: actual === expected,
    bytes: expected.length,
    difference: actual === expected ? null : firstDifference(expected, actual),
  };
}

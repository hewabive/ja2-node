import { describe, expect, it } from 'vitest';
import {
  decodeInputLog,
  describeOrigin,
  encodeInputLog,
  InputLog,
  inputLogText,
  isReplayable,
  MAX_MERGED_REALTIME_TICKS,
  UNKNOWN_ORIGIN,
} from './input-log.ts';

describe('input log', () => {
  it('numbers entries, merges completed real-time batches and starts a segment at the last load', () => {
    const log = new InputLog({ kind: 'sandbox', seed: 3 });
    log.append('cmd', 0, { cmd: { type: 'move', soldier: 1, to: 500 } });
    const first = log.appendRealtime(0, 10);
    log.realtimeBatchCompleted(first);
    const merged = log.appendRealtime(10, 15);
    expect(merged).toBe(first);
    expect(log.entries()[1]?.payload).toEqual({ until: { ticks: 25 }, realtime: true });
    const afterEarlyStop = log.appendRealtime(25, 7);
    expect(afterEarlyStop.seq).toBe(2);
    log.realtimeBatchCompleted(afterEarlyStop);
    log.append('drive', 32, { driver: { mode: 'manual' } });
    const afterDrive = log.appendRealtime(32, 5);
    expect(afterDrive.seq).toBe(4);
    log.realtimeBatchCompleted(afterDrive);
    expect(log.appendRealtime(37, MAX_MERGED_REALTIME_TICKS).seq).toBe(5);

    expect(log.segment()).toMatchObject({ origin: { kind: 'sandbox', seed: 3 } });
    log.append('load', 50, { name: 'QuickSave', digest: 'd1' });
    log.append('reseed', 50, { seed: 99 });
    log.append('answer', 50, { cmd: { type: 'answer', choice: 'yes' } });
    const segment = log.segment();
    expect(segment.origin).toEqual({ kind: 'load', name: 'QuickSave', digest: 'd1' });
    expect(segment.entries.map((e) => [e.seq, e.kind])).toEqual([
      [0, 'reseed'],
      [1, 'answer'],
    ]);
    expect(log.full().entries).toHaveLength(log.length);
    expect(log.segment(2).origin).toEqual({ kind: 'sandbox', seed: 3 });
  });

  it('writes gzipped JSON lines with the origin first and reads them back', () => {
    const log = new InputLog({ kind: 'campaign', seed: 7, campaign: { mercs: 2 } });
    log.append('prepare', 0, { maps: ['stubs/world/maps/a9.dat'] });
    log.append('advance', 0, { until: { idle: true }, budget: 500 });
    const text = inputLogText(log.segment(), 'landed');
    expect(text.split('\n')[0]).toBe(
      '{"format":"ja2-node-input-log","version":1,"save":"landed","origin":{"kind":"campaign","seed":7,"campaign":{"mercs":2}}}',
    );
    const decoded = decodeInputLog(encodeInputLog(text));
    expect(decoded.save).toBe('landed');
    expect(decoded.origin).toEqual(log.origin);
    expect(decoded.entries).toEqual(log.segment().entries);
    expect(() => decodeInputLog(encodeInputLog('{"format":"other"}\n'))).toThrow(/not a ja2-node input log/);
  });

  it('describes origins and knows which can be replayed', () => {
    expect(describeOrigin({ kind: 'import', seed: 1, save: 'SaveGame07', digest: 'x' })).toBe('native save SaveGame07');
    expect(describeOrigin({ kind: 'load', name: 'QuickSave', digest: 'x' })).toBe('save QuickSave');
    expect(isReplayable(UNKNOWN_ORIGIN)).toBe(false);
    expect(isReplayable({ kind: 'sandbox', seed: 1 })).toBe(true);
  });
});

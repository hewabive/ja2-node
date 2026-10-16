import { describe, expect, it } from 'vitest';
import { liveRecord } from '../../../tests/support/narrative.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { encodeNpcRecords, FACT_NONE, NPC_FILE_BYTES, parseNpcRecords, writeNpcRecord } from './npc.ts';

describe('NPC record files', () => {
  it('round-trip 50 records of 32 bytes', () => {
    const records = Array.from({ length: 50 }, (_, i) =>
      liveRecord({
        flags: i % 7,
        requirement: -(1000 + i),
        quest: i,
        quoteNum: i * 2,
        numQuotes: 1,
        actionData: i === 0 ? 0 : -i,
        goToGridNo: 9000 + i,
      }),
    );
    const bytes = encodeNpcRecords(records);
    expect(bytes.length).toBe(NPC_FILE_BYTES);
    expect(parseNpcRecords(bytes)).toEqual(records);
  });

  it('map facts above the last record fact to FACT_NONE', () => {
    const bytes = encodeNpcRecords([liveRecord({ factMustBeTrue: 369, factMustBeFalse: 368 })]);
    const [first] = parseNpcRecords(bytes);
    expect(first?.factMustBeTrue).toBe(FACT_NONE);
    expect(first?.factMustBeFalse).toBe(368);
  });

  it('reads the identifier first in the Russian layout', () => {
    const w = new BinaryWriter(32);
    writeNpcRecord(w, liveRecord({ identifier: 77, quoteNum: 5 }), 'russian');
    const bytes = new Uint8Array(NPC_FILE_BYTES);
    bytes.set(w.toBytes());
    const [first] = parseNpcRecords(bytes, 'russian');
    expect(first?.identifier).toBe(77);
    expect(first?.quoteNum).toBe(5);
    expect(w.length).toBe(32);
  });
});

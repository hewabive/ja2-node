import { describe, expect, it } from 'vitest';
import { fakeHost, NPC_TYPE, RPC_TYPE, recordArray } from '../../../tests/support/narrative.ts';
import { QuoteFlag } from '../../content/formats/npc.ts';
import { MercType } from '../../content/strategic/economy-content.ts';
import {
  ensureQuoteFileLoaded,
  refreshNpcScriptRecord,
  reloadAllQuoteFiles,
  replaceLocationInNpcData,
  resetOncePerConvoRecordsForAllNpcsInLoadedSector,
  setQuoteRecordAsUsed,
} from './records.ts';

const NPC = 94;
const RPC = 59;
const MERC = 3;

describe('record arrays', () => {
  it('copy content lazily on the first touch and treat a missing file as no records', () => {
    const host = fakeHost({ scripts: { [NPC]: recordArray({ 0: { quoteNum: 4 } }) }, types: { [NPC]: NPC_TYPE } });
    expect(host.records.arrays[NPC]).toBeNull();
    const records = ensureQuoteFileLoaded(host, NPC);
    expect(records?.[0]?.quoteNum).toBe(4);
    expect(records).not.toBe(host.content.scripts[NPC]);
    expect(ensureQuoteFileLoaded(host, NPC)).toBe(records);
    expect(ensureQuoteFileLoaded(host, 95)).toBeNull();
    expect(ensureQuoteFileLoaded(host, 62)).toBeNull();
  });

  it('park a recruited RPC’s records as the backup, use the PC template and restore it when he leaves', () => {
    const host = fakeHost({
      scripts: { [RPC]: recordArray({ 0: { quoteNum: 1 } }) },
      recruited: recordArray({ 0: { quoteNum: 2 } }),
      types: { [RPC]: RPC_TYPE, [MERC]: MercType.AIM },
      profiles: { [RPC]: {} },
    });
    const own = ensureQuoteFileLoaded(host, RPC);
    setQuoteRecordAsUsed(host, RPC, 0);
    const profile = host.profile(RPC);
    if (!profile) throw new Error('no profile');
    profile.miscFlags |= 1;
    const template = ensureQuoteFileLoaded(host, RPC);
    expect(template?.[0]?.quoteNum).toBe(2);
    expect(host.records.backups[RPC]).toBe(own);
    profile.miscFlags &= ~1;
    expect(ensureQuoteFileLoaded(host, RPC)).toBe(own);
    expect(own?.[0]?.flags).toBe(QuoteFlag.SAID);
    expect(host.records.backups[RPC]).toBeNull();
    expect(ensureQuoteFileLoaded(host, MERC)?.[0]?.quoteNum).toBe(2);
  });

  it('reload only loaded arrays at a new game and drop the backups', () => {
    const host = fakeHost({ scripts: { [NPC]: recordArray({ 0: {} }) }, types: { [NPC]: NPC_TYPE } });
    setQuoteRecordAsUsed(host, NPC, 0);
    reloadAllQuoteFiles(host);
    expect(host.records.arrays[NPC]?.[0]?.flags).toBe(0);
    expect(host.records.arrays[95]).toBeNull();
  });

  it('reset once-per-conversation records of NPCs whose profile stands in the loaded sector', () => {
    const host = fakeHost({
      scripts: { [NPC]: recordArray({ 0: { flags: QuoteFlag.SAY_ONCE_PER_CONVO | QuoteFlag.SAID }, 1: { flags: QuoteFlag.SAID } }) },
      types: { [NPC]: NPC_TYPE },
    });
    ensureQuoteFileLoaded(host, NPC);
    resetOncePerConvoRecordsForAllNpcsInLoadedSector(host, { x: 2, y: 2, z: 0 }, () => ({ x: 1, y: 1, z: 0 }));
    expect(host.records.arrays[NPC]?.[0]?.flags).toBe(QuoteFlag.SAY_ONCE_PER_CONVO | QuoteFlag.SAID);
    resetOncePerConvoRecordsForAllNpcsInLoadedSector(host, { x: 1, y: 1, z: 0 }, () => ({ x: 1, y: 1, z: 0 }));
    expect(host.records.arrays[NPC]?.[0]?.flags).toBe(QuoteFlag.SAY_ONCE_PER_CONVO);
    expect(host.records.arrays[NPC]?.[1]?.flags).toBe(QuoteFlag.SAID);
  });

  it('rewrite required tiles and destinations to where the NPC stopped, and refresh unsaid records', () => {
    const host = fakeHost({
      scripts: { [NPC]: recordArray({ 0: { requirement: -900, goToGridNo: 900 }, 1: { quoteNum: 6 } }) },
      types: { [NPC]: NPC_TYPE },
    });
    replaceLocationInNpcData(host, NPC, 900, 905);
    expect(host.records.arrays[NPC]?.[0]).toMatchObject({ requirement: -905, goToGridNo: 905 });
    const loaded = host.records.arrays[NPC];
    if (!loaded?.[1]) throw new Error('not loaded');
    loaded[1].quoteNum = 99;
    refreshNpcScriptRecord(host, NPC, 1);
    expect(loaded[1].quoteNum).toBe(6);
    loaded[1].flags = QuoteFlag.SAID;
    loaded[1].quoteNum = 99;
    refreshNpcScriptRecord(host, NPC, 1);
    expect(loaded[1].quoteNum).toBe(99);
  });
});

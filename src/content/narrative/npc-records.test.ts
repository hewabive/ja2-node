import { describe, expect, it } from 'vitest';
import { liveRecord } from '../../../tests/support/narrative.ts';
import { encodeNpcRecords, FACT_NONE, IRRELEVANT, NO_MOVE, NO_QUEST, UiCode } from '../formats/npc.ts';
import { Approach } from './npc-constants.ts';
import { loadNpcRecordContent, scriptRecordsFromJson } from './npc-records.ts';

const PROFILE_INFO = [
  { profileID: 0, internalName: 'BARRY', type: 'AIM' },
  { profileID: 59, internalName: 'IRA', type: 'RPC' },
  { profileID: 75, internalName: 'QUEEN', type: 'NPC' },
  { profileID: 88, internalName: 'MARIA', type: 'NPC' },
  { profileID: 94, internalName: 'DAMON', type: 'NPC' },
  { profileID: 97, internalName: 'SKYRIDER', type: 'NPC' },
];
const ITEMS = { byName: new Map([['LETTER', { index: 225 }]]) };
const env = { items: ITEMS, profiles: new Map(PROFILE_INFO.map((p) => [p.internalName, p.profileID])) };

function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe('script record JSON', () => {
  it('fills the defaults and leaves missing records dead', () => {
    const records = scriptRecordsFromJson(env, { records: [{ index: 2, quoteNum: 7, numQuotes: 1 }] }, 'test');
    expect(records).toHaveLength(50);
    expect(records[2]).toMatchObject({
      quoteNum: 7,
      lastDay: IRRELEVANT,
      quest: NO_QUEST,
      goToGridNo: NO_MOVE,
      factMustBeTrue: FACT_NONE,
      triggerNpc: IRRELEVANT,
      triggerNpcRecord: IRRELEVANT,
    });
    expect(records[0]).toMatchObject({ lastDay: 0, quoteNum: 0, goToGridNo: 0 });
  });

  it('encodes quests, approaches, triggers, gifts and actions like the native loader', () => {
    const [a, b, c, d] = scriptRecordsFromJson(
      env,
      {
        records: [
          { index: 0, quest: { name: 'DELIVER_LETTER', status: 'NOTSTARTED' }, requiredGridNo: 9000, userInterface: 'TURN_UI_OFF' },
          { index: 1, quest: { name: 'FIND_HERMIT', status: 'DONE' }, actionData: { code: 24, doFirst: true }, triggerSelf: true },
          { index: 2, requiredApproach: 'TRIGGER_NPC', actionData: { turnToFace: 'MARIA' }, triggerNPC: 'IRA', requiredItem: 'LETTER' },
          { index: 3, requiredAnyRifle: true, giftItem: '65535', triggerClosestMerc: true },
        ],
      },
      'test',
    );
    expect(a).toMatchObject({ quest: 100, requirement: -9000, giftItem: UiCode.TURN_UI_OFF });
    expect(b).toMatchObject({ quest: 214, actionData: -24, triggerNpc: 1 });
    expect(c).toMatchObject({ approachRequired: Approach.TRIGGER_NPC, actionData: 588, triggerNpc: 59, requirement: 225 });
    expect(d).toMatchObject({ requirement: 1001, giftItem: 65535, triggerNpc: 0 });
  });
});

describe('content assembly', () => {
  it('loads meanwhiles, the PC template, overrides, then binary files without an override', async () => {
    const binary = encodeNpcRecords([liveRecord({ quoteNum: 3 })]);
    const files: Record<string, Uint8Array> = {
      'externalized/mercs-profile-info.json': json(PROFILE_INFO),
      'externalized/script-records-control.json': json({
        fileNameForScriptControlledPCs: '000.npc',
        meanwhiles: [{ id: 0, chars: [{ name: 'QUEEN', fileName: '160.npc' }] }],
      }),
      'tables/npc-script-records.json': json({ records: [{ profile: 'MARIA', records: [{ index: 0, quoteNum: 9 }] }] }),
      'npcdata/000.npc': binary,
      'npcdata/160.npc': binary,
      'npcdata/088.npc': binary,
      'npcdata/097.npc': binary,
      'stubs/npcdata/094.npc': binary,
    };
    const read = async (p: string) => files[p] ?? null;
    const plain = await loadNpcRecordContent({ read, items: ITEMS });
    expect(plain.recruited?.[0]?.quoteNum).toBe(3);
    expect(plain.meanwhiles.get('0/75')?.[0]?.quoteNum).toBe(3);
    expect(plain.scripts[88]?.[0]?.quoteNum).toBe(9);
    expect(plain.scripts[94]?.[0]?.quoteNum).toBe(3);
    expect(plain.scripts[160]?.[0]?.quoteNum).toBe(3);
    expect(plain.scripts[0]).toBeNull();
    const layered = await loadNpcRecordContent({ read, items: ITEMS, layerCount: (p) => (p === 'npcdata/088.npc' ? 2 : 1) });
    expect(layered.scripts[88]?.[0]?.quoteNum).toBe(3);
  });
});

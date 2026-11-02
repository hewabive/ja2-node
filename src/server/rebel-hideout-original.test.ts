import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import type { NarrativeHost } from '../sim/narrative/host.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Fact, Quest } from '../sim/strategic/narrative/fact-ids.ts';
import { QuestStatus, questStatus } from '../sim/strategic/narrative/facts.ts';
import { Npc } from '../sim/strategic/narrative/npc-ids.ts';
import { NpcActionCode } from '../sim/tactical/narrative/npc-actions/codes.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { Session } from './session.ts';

const FATIMA_HIDEOUT_RECORD = 26;
const ROUTE_BUDGET = 10;
const ROUTE_SLICE_SECONDS = 6 * 3600;
const CHAIN_SLICE_TICKS = 600;
const CHAIN_BUDGET = 80;
const LETTER_STATUS = 100;

async function inA10(read: Parameters<typeof createCampaignSession>[0], data: DataVfs): Promise<{ cs: CampaignSession; session: Session }> {
  const cs = await createCampaignSession(
    read,
    (p) => data.vfs.stat(p) !== undefined,
    7,
    { mercs: 2, land: false },
    (p) => data.vfs.layerCount(p),
  );
  for (const code of ['A9', 'A10']) {
    const sector = sectorInfo(cs.campaign.state.map, parseSectorString(code));
    sector.numAdmins = 0;
    sector.numTroops = 0;
    sector.numElites = 0;
  }
  const land = { type: 'compressTime', mode: 2 };
  await cs.prepare(land);
  expect(cs.dispatch(land).ok).toBe(true);
  expect(cs.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  const first = cs.view().strategic?.mercs[0];
  expect(cs.dispatch({ type: 'route', soldier: first?.id, to: 'A10' })).toMatchObject({ ok: true });
  const session = new Session('hideout', cs);
  const arrived = () => cs.view().strategic?.mercs.every((m) => m.sector === 'A10' && !m.betweenSectors) ?? false;
  for (let k = 0; k < ROUTE_BUDGET && !arrived(); k++) session.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  const enter = { type: 'enterSector', sector: 'A10' };
  await cs.prepare(enter);
  expect(cs.dispatch(enter)).toMatchObject({ ok: true });
  session.advance({ idle: true });
  return { cs, session };
}

function giveFatimaTheLetter(host: NarrativeHost, letter: number): void {
  const fatima = host.profile(Npc.FATIMA);
  if (!fatima) throw new Error('no Fatima');
  fatima.inventory[0] = letter;
  fatima.inventoryStatus[0] = LETTER_STATUS;
  fatima.inventoryCount[0] = 1;
}

function turnUiOffAsFatimasWalkDoes(host: NarrativeHost): void {
  host.setEngaged(true);
  host.talk.referenceCount = 1;
}

describe.skipIf(!ORIGINAL_DATA_DIR)('the rebel hideout on the original data', () => {
  let data: DataVfs;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
  });
  afterAll(async () => {
    await data.close();
  });

  it('Fatima hands Miguel the letter, he reads it and the interface comes back on (Handle_Items.cc:2490)', async () => {
    const { cs, session } = await inA10(read, data);
    const c = cs.campaign;
    const host = c.talk?.host;
    const letter = c.tactical?.state.content.items.byName.get('LETTER')?.index;
    if (!host || letter === undefined) throw new Error('no narrative');
    giveFatimaTheLetter(host, letter);
    turnUiOffAsFatimasWalkDoes(host);
    await cs.prepare({ type: 'talk' });
    c.talk?.npcActions.handle(Npc.FATIMA, NpcActionCode.GOTO_HIDEOUT, FATIMA_HIDEOUT_RECORD);
    const n = c.state.narrative;
    for (let k = 0; k < CHAIN_BUDGET && questStatus(n, Quest.FOOD_ROUTE) !== QuestStatus.IN_PROGRESS; k++)
      session.advance({ ticks: CHAIN_SLICE_TICKS });
    const holds = (profile: number) =>
      c.tactical?.state.soldiers.some((s) => s?.placed && s.profile === profile && s.inv.some((o) => o.item === letter)) ?? false;
    expect([holds(Npc.FATIMA), holds(Npc.MIGUEL)]).toEqual([false, true]);
    expect(n.facts[Fact.MIGUEL_READ_LETTER]).toBe(1);
    expect([questStatus(n, Quest.DELIVER_LETTER), questStatus(n, Quest.FOOD_ROUTE)]).toEqual([QuestStatus.DONE, QuestStatus.IN_PROGRESS]);
    expect(session.advance({ idle: true }).reason).toBe('decision');
    expect(cs.view().conversation).toMatchObject({ profile: Npc.MIGUEL });
    expect(cs.dispatch({ type: 'closeTalk' })).toEqual({ ok: true });
    expect(session.advance({ idle: true }).reason).toBe('idle');
    expect([host.talk.referenceCount, c.talk?.scriptedSequence()]).toEqual([0, false]);
  });
});

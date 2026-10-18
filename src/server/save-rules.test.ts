import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approachUntilCombat, inCombat, ourTurn, untilOurTurn } from '../../tests/support/save-scenarios.ts';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { pythSpacesAway } from '../content/world/grid.ts';
import { PromptKind } from '../sim/strategic/forces/battle-state.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { CampaignSession } from './campaign-session.ts';
import { inflateSave, parseSaveText, type SaveKind } from './save-file.ts';
import { groupsAboutToArrive, saveRefusal, saveStatus, startsMeanwhile, startsOurTurn } from './save-rules.ts';
import type { SaveWrite } from './save-store.ts';
import type { Session } from './session.ts';
import { describeSession } from './session-registry.ts';

const TEST_TIMEOUT_MS = 120_000;
const VASKO = 94;
const DEALER = 91;
const ROUTE_BUDGET = 10;
const ROUTE_SLICE_SECONDS = 6 * 3600;
const DEAD_IS_DEAD_NAME = 'Ironclad';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

async function withKit(work: (k: SaveKit) => Promise<void>): Promise<void> {
  const k = await createSaveKit(kit, { entropy: () => 99 });
  try {
    await work(k);
  } finally {
    await k.dispose();
  }
}

interface Written {
  readonly name: string;
  readonly kind: SaveKind;
  readonly tick: number;
}

function recordWrites(k: SaveKit): Written[] {
  const writes: Written[] = [];
  const original = k.store.write.bind(k.store);
  k.store.write = async (name: string, save: SaveWrite) => {
    const header = parseSaveText(inflateSave(save.bytes).text).header;
    writes.push({ name, kind: header.kind, tick: header.tick });
    return original(name, save);
  };
  return writes;
}

function campaignOf(session: Session): CampaignSession {
  if (!(session.sim instanceof CampaignSession)) throw new Error('not a campaign');
  return session.sim;
}

async function inA10(k: SaveKit, seed: number): Promise<Session> {
  const session = await k.open({ seed, campaign: { mercs: 2, land: false } });
  const campaign = campaignOf(session);
  const start = sectorInfo(campaign.campaign.state.map, parseSectorString('A9'));
  start.numAdmins = 0;
  start.numTroops = 0;
  start.numElites = 0;
  expect((await session.prepareAndDispatch({ type: 'compressTime', mode: 2 })).ok).toBe(true);
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  const first = session.sim.view().strategic?.mercs[0];
  if (!first) throw new Error('no merc');
  expect(session.dispatch({ type: 'route', soldier: first.id, to: 'A10' })).toMatchObject({ ok: true });
  for (let n = 0; n < ROUTE_BUDGET && !session.sim.view().strategic?.mercs.every((m) => m.sector === 'A10' && !m.betweenSectors); n++)
    session.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  expect(await session.prepareAndDispatch({ type: 'enterSector', sector: 'A10' })).toMatchObject({ ok: true });
  session.advance({ idle: true });
  return session;
}

function soldierGridNo(session: Session, profile: number): number {
  const s = campaignOf(session).campaign.tactical?.state.soldiers.find((x) => x?.placed && x.profile === profile);
  if (!s) throw new Error(`profile ${profile} is not in the sector`);
  return s.gridNo;
}

describe('save rules', () => {
  it(
    'refuse saves in a conversation and in a shop, and allow them in between',
    async () => {
      await withKit(async (k) => {
        const session = await inA10(k, 3);
        const merc = session.sim.view().strategic?.mercs[0]?.id ?? 0;
        expect(saveRefusal(session.sim)).toBeNull();
        const talk = session.dispatch({ type: 'talk', soldier: merc, target: { npc: VASKO } });
        expect(talk.ok, talk.reason).toBe(true);
        if ((talk.data as { walking?: boolean }).walking) session.advance({ idle: true });
        expect(session.sim.view().conversation).toBeTruthy();
        expect(saveRefusal(session.sim)).toBe('conversation');
        expect(await k.saves.save(session, { name: 'talking' })).toMatchObject({ ok: false, refused: 'conversation' });
        expect(describeSession(session)).toMatchObject({ saveMode: 'anywhere', canSave: false, saveRefusal: 'conversation' });
        session.dispatch({ type: 'closeTalk' });
        session.advance({ idle: true });
        expect(saveRefusal(session.sim)).toBeNull();
        const dealer = soldierGridNo(session, DEALER);
        const at = campaignOf(session).campaign.tactical?.state.soldiers[merc]?.gridNo ?? 0;
        if (pythSpacesAway(at, dealer) > 2) {
          expect(session.dispatch({ type: 'move', soldier: merc, to: dealer + 2, mode: 'walk' })).toMatchObject({ ok: true });
          session.advance({ idle: true });
        }
        expect(session.dispatch({ type: 'openShop', dealer: DEALER, soldier: merc })).toMatchObject({ ok: true });
        expect(saveRefusal(session.sim)).toBe('shopOpen');
        session.dispatch({ type: 'closeShop' });
        expect(await k.saves.save(session, { name: 'quick' })).toMatchObject({ ok: true, name: 'QuickSave', kind: 'quick' });
      });
    },
    TEST_TIMEOUT_MS,
  );

  it('refuse saves while a prompt is open or a meanwhile is starting, and allow them in the laptop', async () => {
    await withKit(async (k) => {
      const session = await k.open({ seed: 4, campaign: { hire: [] } });
      const state = campaignOf(session).campaign.state;
      expect(state.flow).toBe('laptop');
      expect(saveRefusal(session.sim)).toBeNull();
      state.meanwhile.trying = true;
      expect(saveRefusal(session.sim)).toBe('meanwhileStarting');
      state.meanwhile.trying = false;
      state.battle.prompt = { kind: PromptKind.SURRENDER, id: 'p1' };
      expect(saveRefusal(session.sim)).toBe('promptOpen');
      state.battle.prompt = null;
      expect(saveStatus(session.sim)).toEqual({ saveMode: 'anywhere', canSave: true });
    });
  });

  it(
    'in Iron Man refuse saves with enemies in the loaded sector and in combat, and never autosave',
    async () => {
      await withKit(async (k) => {
        const writes = recordWrites(k);
        const laptop = await k.open({ seed: 4, campaign: { hire: [], saveMode: 'ironMan' } });
        expect(await k.saves.save(laptop, { name: 'laptop' })).toMatchObject({ ok: true });
        const session = await k.open({ seed: 8, campaign: { saveMode: 'ironMan' } });
        expect(campaignOf(session).campaign.state.options.saveMode).toBe('ironMan');
        expect(await k.saves.save(session, { name: 'ironman' })).toMatchObject({ ok: false, refused: 'ironMan' });
        expect(describeSession(session)).toMatchObject({ saveMode: 'ironMan', canSave: false, saveRefusal: 'ironMan' });
        approachUntilCombat(session, true);
        untilOurTurn(session);
        expect(await k.saves.save(session, { name: 'quick' })).toMatchObject({ ok: false, refused: 'ironMan' });
        expect(ourTurn(session)).toBe(true);
        expect(session.dispatch({ type: 'endTurn' }).ok).toBe(true);
        await k.saves.flush();
        expect(writes.map((w) => w.name)).toEqual(['laptop']);
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'in Dead is Dead save into the one file at the save points, only on our turn, with two backups',
    async () => {
      await withKit(async (k) => {
        const writes = recordWrites(k);
        const session = await k.open({ seed: 8, campaign: { saveMode: 'deadIsDead', deadIsDeadName: DEAD_IS_DEAD_NAME } });
        expect(await k.saves.save(session, { description: 'mine' })).toMatchObject({ ok: false, refused: 'deadIsDead' });
        expect(await k.saves.save(session, { name: 'quick' })).toMatchObject({ ok: true, name: DEAD_IS_DEAD_NAME, kind: 'deadIsDead' });
        expect(session.advance({ ticks: 5 }).events.some((e) => (e as { type: string }).type === 'gameSaved')).toBe(false);
        approachUntilCombat(session, true);
        untilOurTurn(session);
        await k.saves.flush();
        expect(inCombat(session)).toBe(true);
        expect(ourTurn(session)).toBe(true);
        expect(writes.length).toBeGreaterThan(1);
        expect(writes.at(-1)).toEqual({ name: DEAD_IS_DEAD_NAME, kind: 'deadIsDead', tick: session.sim.tick });
        const endTurnTick = session.sim.tick;
        expect(session.dispatch({ type: 'endTurn' }).ok).toBe(true);
        await k.saves.flush();
        expect(writes.at(-1)).toEqual({ name: DEAD_IS_DEAD_NAME, kind: 'deadIsDead', tick: endTurnTick });
        const afterEndTurn = writes.length;
        expect(ourTurn(session)).toBe(false);
        await k.saves.closeSession(session);
        expect(writes.length).toBe(afterEndTurn);
        k.saves.attach(session);
        untilOurTurn(session);
        await k.saves.flush();
        expect(ourTurn(session)).toBe(true);
        expect(writes.length).toBe(afterEndTurn + 1);
        expect(writes.at(-1)?.tick).toBe(session.sim.tick);
        const other = await k.open({ seed: 5 });
        expect(await k.saves.save(other, { name: 'sandbox' })).toMatchObject({ ok: true });
        const beforeLoad = writes.length;
        await k.saves.loadInto(session, 'sandbox', false);
        await k.saves.flush();
        expect(writes.slice(beforeLoad).map((w) => w.name)).toEqual([DEAD_IS_DEAD_NAME]);
        const shutdownSession = await k.open({ seed: 8, campaign: { saveMode: 'deadIsDead', deadIsDeadName: 'Shutdown' } });
        await k.saves.shutdown();
        expect(writes.at(-1)).toMatchObject({ name: 'Shutdown', tick: shutdownSession.sim.tick });
        expect(await k.store.read('Shutdown')).not.toBeNull();
        const backups = writes.filter((w) => w.name === DEAD_IS_DEAD_NAME).length;
        expect(backups).toBeGreaterThanOrEqual(3);
        expect(await k.store.read(DEAD_IS_DEAD_NAME)).not.toBeNull();
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'in Dead is Dead save when a group is about to arrive, and see turn starts and meanwhiles in the events',
    async () => {
      await withKit(async (k) => {
        const writes = recordWrites(k);
        const session = await k.open({ seed: 3, campaign: { mercs: 2, land: false, saveMode: 'deadIsDead', deadIsDeadName: 'Road' } });
        const start = sectorInfo(campaignOf(session).campaign.state.map, parseSectorString('A9'));
        start.numAdmins = 0;
        start.numTroops = 0;
        start.numElites = 0;
        expect((await session.prepareAndDispatch({ type: 'compressTime', mode: 2 })).ok).toBe(true);
        expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
        await k.saves.flush();
        const before = writes.length;
        const first = session.sim.view().strategic?.mercs[0];
        expect(session.dispatch({ type: 'route', soldier: first?.id ?? 0, to: 'B9' })).toMatchObject({ ok: true });
        for (
          let n = 0;
          n < ROUTE_BUDGET && !session.sim.view().strategic?.mercs.every((m) => m.sector === 'B9' && !m.betweenSectors);
          n++
        ) {
          expect(n > 0 || groupsAboutToArrive(session.sim).length > 0).toBe(true);
          session.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
        }
        await k.saves.flush();
        expect(writes.slice(before).map((w) => w.name)).toEqual(['Road']);
      });
      expect(startsOurTurn([{ type: 'turnStarted', team: 0, round: 1, tick: 5 }])).toBe(true);
      expect(startsOurTurn([{ type: 'turnStarted', team: 1, round: 1, tick: 5 }])).toBe(false);
      expect(startsMeanwhile([{ type: 'meanwhileStarted', tick: 9 } as never])).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

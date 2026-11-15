import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ARRIVAL_WAIT_SECONDS, arrangeBattle, BattleVariant } from '../../../tests/support/battle-entry.ts';
import { buildMapScreenCampaign } from '../../../tests/support/e2e-campaign-saves.ts';
import { createSaveKit } from '../../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { ReloadingSession } from '../../../tests/support/session-reload.ts';
import { STUB_DEALER, stubCampaignInA10, walkNextToProfile } from '../../../tests/support/stub-shops.ts';
import { CampaignSession } from '../../server/campaign-session.ts';
import type { Session } from '../../server/session.ts';
import type { TacticalState } from '../tactical/state.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const TICK_MS = 5;
const WORLD_SECOND_MS = 1000;
const HALF_A_SECOND = { ticks: WORLD_SECOND_MS / 2 / TICK_MS };
const ONE_TICK = { ticks: 1 };
const FIVE_MINUTES_A_SECOND = 2;
const SLICE_SECONDS = 60;
const SLICES_PER_REAL_SECOND = 5;
const SLICE_MS = WORLD_SECOND_MS / SLICES_PER_REAL_SECOND;
const HALF_A_SLICE = { ticks: SLICE_MS / 2 / TICK_MS };

interface Campaign {
  readonly session: CampaignSession;
  readonly live: Session;
  readonly merc: number;
}

function never(what: string): never {
  throw new Error(`no ${what}`);
}

function campaignOf(session: Session): CampaignSession {
  return session.sim instanceof CampaignSession ? session.sim : never('campaign');
}

function order(c: Campaign, cmd: { readonly type: string; readonly [key: string]: unknown }): void {
  const result = c.live.dispatch(cmd);
  expect(result, result.reason).toMatchObject({ ok: true });
}

async function nextToTheDealer(seed: number): Promise<Campaign> {
  const session = await stubCampaignInA10(kit, seed);
  const live = new ReloadingSession('screen-clock', session);
  live.advance({ idle: true });
  const merc = session.view().strategic?.mercs[0]?.id ?? never('merc');
  walkNextToProfile(session, merc, STUB_DEALER);
  return { session, live, merc };
}

function tactical(c: Campaign): TacticalState {
  return c.session.campaign.tactical?.state ?? never('loaded sector');
}

function msToTheNextWorldSecond(c: Campaign): number {
  const from = tactical(c).clockMs;
  expect(c.live.advance({ worldSeconds: 1 }).reason).toBe('worldTime');
  return tactical(c).clockMs - from;
}

function halfASecondIn(c: Campaign): void {
  msToTheNextWorldSecond(c);
  c.live.advance(HALF_A_SECOND);
}

function msToTheNextSlice(c: Campaign): number {
  const state = () => c.session.campaign.state;
  const from = state().realMs;
  const seconds = state().clock.seconds;
  while (state().clock.seconds === seconds && state().realMs - from <= WORLD_SECOND_MS) c.live.advance(ONE_TICK);
  expect(state().clock.seconds).toBe(seconds + SLICE_SECONDS);
  return state().realMs - from;
}

async function aRealSecondIntoCompression(c: Campaign): Promise<Campaign> {
  if (c.session.campaign.state.flow !== 'strategic') order(c, { type: 'mapScreen' });
  c.live.advance(ONE_TICK);
  expect(c.live.advance({ idle: true }).reason).toBe('idle');
  order(c, { type: 'compressTime', mode: FIVE_MINUTES_A_SECOND });
  for (let slice = 0; slice < SLICES_PER_REAL_SECOND; slice++) expect(msToTheNextSlice(c)).toBe(SLICE_MS);
  return c;
}

describe("the world clock's second behind the shop screen (Tactical/ShopKeeper_Interface.cc ShopKeeperScreenHandle, Strategic/Game_Clock.cc UpdateClock)", () => {
  it('runs on through a world second without a shop, and restarts at a shop an order opens, so the next world second comes a full second after the shop closes', async () => {
    const c = await nextToTheDealer(71);
    halfASecondIn(c);
    expect(msToTheNextWorldSecond(c)).toBe(WORLD_SECOND_MS / 2);
    halfASecondIn(c);
    order(c, { type: 'openShop', dealer: STUB_DEALER, soldier: c.merc });
    order(c, { type: 'closeShop' });
    expect(msToTheNextWorldSecond(c)).toBe(WORLD_SECOND_MS);
  });
});

describe("the world clock's second behind the talk panel (Tactical/Dialogue_Control.cc HandleDialogue's PauseGame for ENGAGED_IN_CONV)", () => {
  it('restarts at a panel an order opens with nothing to say, so the next world second comes a full second after the panel closes', async () => {
    const c = await nextToTheDealer(73);
    halfASecondIn(c);
    order(c, { type: 'talk', soldier: c.merc, target: { npc: STUB_DEALER } });
    expect(c.session.campaign.talk?.frozen()).toBe(true);
    order(c, { type: 'closeTalk' });
    expect(msToTheNextWorldSecond(c)).toBe(WORLD_SECOND_MS);
  });
});

describe("the world clock's second behind the laptop (Laptop/Laptop.cc EnterLaptop's PauseGame, Strategic/Game_Clock.cc UpdateClock)", () => {
  it('runs a real second of compression on without the laptop, and restarts it at the laptop, so the slice after it comes a full slice after the laptop closes', async () => {
    const c = await aRealSecondIntoCompression(await nextToTheDealer(74));
    c.live.advance(HALF_A_SLICE);
    expect(msToTheNextSlice(c)).toBe(SLICE_MS / 2);
    const later = await aRealSecondIntoCompression(await nextToTheDealer(74));
    later.live.advance(HALF_A_SLICE);
    order(later, { type: 'openLaptop' });
    order(later, { type: 'closeLaptop' });
    order(later, { type: 'compressTime', mode: FIVE_MINUTES_A_SECOND });
    expect(msToTheNextSlice(later)).toBe(SLICE_MS);
  });
});

describe("the world clock's second behind a box or a panel on the map screen (MessageBoxScreen.cc DoMessageBox's PauseGame, Strategic/Game_Clock.cc UpdateClock)", () => {
  async function inDrassen(test: (c: Campaign) => Promise<void>): Promise<void> {
    const saves = await createSaveKit(kit);
    try {
      const built = await buildMapScreenCampaign(saves, kit);
      await test({ session: campaignOf(built.session), live: built.session, merc: built.trainer });
    } finally {
      await saves.dispose();
    }
  }

  function box(c: Campaign, kind: string): string {
    const prompt = c.session.campaign.state.battle.prompt ?? never(`${kind} box`);
    expect(prompt.kind).toBe(kind);
    return prompt.id;
  }

  it('restarts a real second of compression at a box an order opens, so the slice after it comes a full slice after the answer', () =>
    inDrassen(async (drassen) => {
      const c = await aRealSecondIntoCompression(drassen);
      c.live.advance(HALF_A_SLICE);
      order(c, { type: 'assign', soldiers: [c.merc], to: { kind: 'trainMilitia' } });
      order(c, { type: 'answer', prompt: box(c, 'militiaPayment'), choice: 'no' });
      order(c, { type: 'compressTime', mode: FIVE_MINUTES_A_SECOND });
      expect(msToTheNextSlice(c)).toBe(SLICE_MS);
    }));

  it('restarts a real second of compression in the tick an event of a slice opens the pre-battle panel in, so the first world second in the sector comes a full second after the answer (Strategic/PreBattle_Interface.cc InitPreBattleInterface)', () =>
    inDrassen(async (c) => {
      c.live.advance({ idle: true });
      arrangeBattle(c.live, BattleVariant.RETREAT);
      order(c, { type: 'compressTime', mode: FIVE_MINUTES_A_SECOND });
      expect(c.live.advance({ worldSeconds: ARRIVAL_WAIT_SECONDS }).reason).toBe('decision');
      const panel = box(c, 'preBattle');
      expect(c.session.campaign.state.clock.driver.timesThisSecond).toBeGreaterThan(0);
      expect((await c.live.prepareAndDispatch({ type: 'answer', prompt: panel, choice: 'enterSector' })).ok).toBe(true);
      expect(c.session.campaign.state.flow).toBe('tactical');
      expect(msToTheNextWorldSecond(c)).toBe(WORLD_SECOND_MS);
    }));
});

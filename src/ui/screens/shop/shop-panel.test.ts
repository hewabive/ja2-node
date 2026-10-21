import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10, STUB_DEALER } from '../../../../tests/support/a10-campaign.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import type { DrawItem } from '../../draw-list.ts';
import { MouseButton } from '../../input/events.ts';
import {
  dealerBoxDescriptionAt,
  dealerOfferDescriptionAt,
  doneWhenString,
  normalEvaluationChance,
  repairTimeString,
} from './shop-panel.ts';

const SLOW_MS = 120_000;
const LINE_STEP_MS = 250;
const MAX_LINE_FRAMES = 400;
const SETTLE_FRAMES = 6;

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
}, SLOW_MS);

afterAll(async () => {
  await kit.dispose();
});

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

function line(item: DrawItem): string {
  switch (item.kind) {
    case 'image':
      return `image ${item.asset}#${item.frame} ${item.x},${item.y}${item.effect ? ` ${item.effect.kind}` : ''}`;
    case 'glyphs': {
      const first = item.glyphs[0];
      return `glyphs ${item.font} ${first ? `${first.x},${first.y}` : '-'} n=${item.glyphs.length} fg=${item.foreground}`;
    }
    case 'fill':
      return `fill ${item.x},${item.y} ${item.width}x${item.height} ${hex(item.color)}`;
    case 'shadow':
      return `shadow ${item.x},${item.y} ${item.width}x${item.height}`;
    case 'hatch':
      return `hatch ${item.pattern} ${item.x},${item.y} ${item.width}x${item.height}`;
    case 'line':
    case 'rectangle':
      return `${item.kind} ${item.x1},${item.y1} ${item.x2},${item.y2} ${hex(item.color)}`;
    default:
      return item.kind;
  }
}

function shopSnapshot(f: TacticalUiTest): string {
  const items = f.draw().items;
  const start = items.findIndex((i) => i.kind === 'image' && i.asset === 'interface/tradescreen.sti');
  return `${items.slice(start).map(line).join('\n')}\n`;
}

function playOut(f: TacticalUiTest): void {
  let frames = 0;
  while (f.screen.dialogue.presenter.busy && frames++ < MAX_LINE_FRAMES) f.t.frame(LINE_STEP_MS);
}

async function settleShop(f: TacticalUiTest): Promise<void> {
  for (let i = 0; i < SETTLE_FRAMES; i++) {
    await f.settle(1);
    f.deliver();
  }
}

async function atTheDealer(seed: number): Promise<{ f: TacticalUiTest; merc: number }> {
  const a10 = await campaignInA10(kit, seed);
  const merc = a10.mercs[0] ?? 0;
  const dealer = a10.campaign.campaign.tactical?.state.soldiers.find((s) => s?.placed && s.profile === STUB_DEALER);
  if (!dealer) throw new Error('no stub dealer');
  const moved = a10.session.dispatch({ type: 'move', soldier: merc, to: dealer.gridNo + 2, mode: 'walk' });
  expect(moved.ok, moved.reason).toBe(true);
  a10.session.advance({ idle: true });
  const f = await tacticalUiTest(kit, ui, seed, a10.session);
  f.client.refresh();
  const talk = await f.client.command({ type: 'talk', soldier: merc, target: dealer.id });
  expect(talk.ok, talk.reason).toBe(true);
  f.deliver();
  playOut(f);
  expect(f.screen.dialogue.talk.open).toBe(true);
  expect(f.widget('talkOptionText4').text).toBe('Buy/Sell');
  await f.click('talkOption4');
  expect(f.client.commands.some((c) => c.cmd.type === 'approach' && c.cmd.kind === 'buySell' && c.reply.ok)).toBe(true);
  await settleShop(f);
  return { f, merc };
}

describe('shop geometry and texts', () => {
  const strings: Readonly<Record<string, Readonly<Record<number, string>>>> = {
    SKI_Text: { 8: '1 HOUR', 9: '%d HOURS', 12: '%d MINUTES' },
    pDayStrings: { 0: 'Day' },
  };
  const text = { string: (table: string, index: number) => strings[table]?.[index] ?? null, edt: () => null };

  it('rounds the repair time to the quarter hour and shows hours above 90 minutes', () => {
    expect(repairTimeString(text, 1)).toBe('15 MINUTES');
    expect(repairTimeString(text, 89)).toBe('90 MINUTES');
    expect(repairTimeString(text, 91)).toBe('2 HOURS');
    expect(repairTimeString(text, 20)).toBe('30 MINUTES');
  });

  it('writes the done time with the day only when it is not today', () => {
    expect(doneWhenString(text, { day: 3, hour: 7, minute: 15 }, 3)).toBe('07:15');
    expect(doneWhenString(text, { day: 4, hour: 9, minute: 0 }, 3)).toBe('Day 4 09:00');
    expect(doneWhenString(text, null, 3)).toBe('');
  });

  it('places the description box with the original quirks', () => {
    expect(dealerBoxDescriptionAt(0)).toEqual({ x: 160, y: 0 });
    expect(dealerBoxDescriptionAt(14)).toEqual({ x: 277, y: 82 });
    expect(dealerOfferDescriptionAt(0)).toEqual({ x: 10, y: 140 });
  });

  it('says the normal evaluation quote less often the sooner it follows the last one', () => {
    expect(normalEvaluationChance(null)).toBe(100);
    expect(normalEvaluationChance(26000)).toBe(60);
    expect(normalEvaluationChance(13000)).toBe(25);
    expect(normalEvaluationChance(8000)).toBe(10);
    expect(normalEvaluationChance(1000)).toBe(0);
  });
});

describe('the shop screen at the stub dealer', { timeout: SLOW_MS }, () => {
  it('opens from the talk panel with the single merc panel, buys a box and leaves after the farewell', async () => {
    const { f, merc } = await atTheDealer(4);
    const shop = f.screen.dialogue.shop;
    expect(shop.open).toBe(true);
    expect(f.screen.dialogue.talk.open).toBe(false);
    expect(f.screen.panel).toBe('sm');
    expect(f.screen.smMerc).toBe(merc);
    expect(f.widget('shopTitle').text).toBe('MERCHANDISE IN STOCK');
    expect(f.find('smMapScreen')?.enabled).toBe(false);
    expect(f.widget('shopTransaction').enabled).toBe(false);
    expect(f.widget('shopDone').enabled).toBe(true);
    const view = f.client.view.shop;
    if (!view) throw new Error('no shop view');
    const affordable = view.boxes.findIndex((b) => (b.unitPrice ?? 0) > 0 && (b.unitPrice ?? 0) <= view.balance);
    expect(affordable).toBeGreaterThanOrEqual(0);
    expect(affordable).toBeLessThan(15);
    expect(f.widget(`shopDealerSlot${affordable}`).text?.length ?? 0).toBeGreaterThan(0);

    await f.click(`shopDealerSlot${affordable}`);
    await settleShop(f);
    expect(shop.model.dealerOffer[0]).toMatchObject({ box: affordable, count: 1 });
    expect(shop.model.quote?.totals.cost).toBe(view.boxes[affordable]?.unitPrice);
    expect(f.widget('shopTransaction').enabled).toBe(true);
    await expect(shopSnapshot(f)).toMatchFileSnapshot('__snapshots__/shop-screen.txt');

    const before = (f.client.view.soldiers.find((s) => s.id === merc)?.inventory ?? []).length;
    await f.click('shopTransaction');
    await settleShop(f);
    if (f.find('messageBox.yes')) {
      await f.click('messageBox.yes');
      await settleShop(f);
    }
    expect(f.client.commands.some((c) => c.cmd.type === 'trade' && c.reply.ok)).toBe(true);
    expect(shop.model.dealerOffer.every((s) => s === null)).toBe(true);
    expect((f.client.view.soldiers.find((s) => s.id === merc)?.inventory ?? []).length).toBeGreaterThan(before);

    await f.click('shopDone');
    await settleShop(f);
    expect(f.client.commands.at(-1)?.cmd).toEqual({ type: 'closeShop' });
    expect(f.client.view.shop ?? null).toBeNull();
    playOut(f);
    f.t.frame();
    expect(shop.open).toBe(false);
  });

  it('offers a pocket from the single merc panel, hatches it, and takes it back with a right click', async () => {
    const { f, merc } = await atTheDealer(6);
    const shop = f.screen.dialogue.shop;
    const pocket = (f.client.view.soldiers.find((s) => s.id === merc)?.inventory ?? []).find((i) => i.slot >= 7 && i.item !== 'MONEY');
    if (!pocket) throw new Error('no pocket item');
    await f.click(`slot${pocket.slot}`);
    await settleShop(f);
    expect(shop.model.playerOffer[0]).toMatchObject({ kind: 'offer', soldier: merc, slot: pocket.slot });
    expect(shop.hatched(merc, pocket.slot)).toBe(true);
    expect(f.client.commands.filter((c) => c.cmd.type === 'quoteTrade').at(-1)?.cmd).toMatchObject({
      sell: [{ soldier: merc, slot: pocket.slot }],
    });
    await f.click('shopPlayerOfferSlot0', MouseButton.RIGHT);
    await settleShop(f);
    expect(shop.model.playerOffer[0]).toBeNull();
    expect(shop.hatched(merc, pocket.slot)).toBe(false);
    f.key('Escape');
    await settleShop(f);
    expect(f.client.commands.at(-1)?.cmd).toEqual({ type: 'closeShop' });
  });
});

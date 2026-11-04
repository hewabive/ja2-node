import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10, STUB_DEALER } from '../../../../tests/support/a10-campaign.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import type { ItemTable } from '../../../content/items/items.ts';
import type { SimEvent } from '../../../sim/events.ts';
import { createItem } from '../../../sim/items/object.ts';
import type { Soldier } from '../../../sim/tactical/soldier.ts';
import type { DrawItem } from '../../draw-list.ts';
import { MouseButton } from '../../input/events.ts';
import { OFFER_SLOTS } from './shop-model.ts';
import {
  dealerBoxDescriptionAt,
  dealerOfferDescriptionAt,
  doneWhenString,
  normalEvaluationChance,
  repairTimeString,
} from './shop-panel.ts';
import { MATCH_OUTLINE } from './shop-tile.ts';

const LINE_STEP_MS = 250;
const ENTRY_QUOTE_DELAY_MS = 800;
const FIRST_ENTERS = 11;
const MSG_DASH_S = 54;
const SMALL_POCKETS = [11, 12, 13, 14] as const;
const NO_FACE = {
  eyes: [0, 0] as const,
  mouth: [0, 0] as const,
  blinkFrequency: 0,
  expressionFrequency: 0,
  smallFace: null,
  aimBio: null,
  mercBio: null,
};
const MAX_LINE_FRAMES = 400;
const SETTLE_FRAMES = 6;
const FONT_RED = 162;
const RADIO = 'interface/radio.sti';
const STUB_REPAIRMAN = 128;
const HAND_SLOT = 5;
const DAMAGED_STATUS = 60;
const ROUNDS_LEFT = 9;
const CROSS_OUT = 'interface/itemcrossout.sti';
const CROSS_OUT_X = 22;

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

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

function hover(f: TacticalUiTest, id: string): void {
  const { rect } = f.widget(id);
  const x = rect.x + Math.floor(rect.width / 2);
  const y = rect.y + Math.floor(rect.height / 2);
  f.t.runtime.input({ kind: 'pointerMove', x, y, button: MouseButton.LEFT, buttons: 0, wheel: 0, modifiers: 0 });
  f.t.frame();
}

function outlinedOfferSlots(f: TacticalUiTest): number[] {
  const outlines = f
    .draw()
    .items.flatMap((i) => (i.kind === 'image' && i.effect?.kind === 'outline' && i.effect.color === MATCH_OUTLINE ? [i] : []));
  return Array.from({ length: OFFER_SLOTS }, (_, slot) => slot).filter((slot) => {
    const { rect } = f.widget(`shopPlayerOfferSlot${slot}`);
    return outlines.some((i) => i.x >= rect.x && i.x < rect.x + rect.width && i.y >= rect.y && i.y < rect.y + rect.height);
  });
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

interface ShopVisit {
  readonly pockets?: readonly string[];
  readonly profile?: number;
  readonly option?: string;
  readonly prepare?: (merc: Soldier, items: ItemTable) => void;
}

async function atTheDealer(seed: number, pockets: readonly string[] = []): Promise<{ f: TacticalUiTest; merc: number }> {
  return atTheShop(seed, { pockets });
}

async function atTheShop(seed: number, visit: ShopVisit): Promise<{ f: TacticalUiTest; merc: number }> {
  const a10 = await campaignInA10(kit, seed);
  const merc = a10.mercs[0] ?? 0;
  const tactical = a10.campaign.campaign.tactical?.state;
  const carrier = tactical?.soldiers[merc];
  if (!tactical || !carrier) throw new Error('no merc in tactical');
  (visit.pockets ?? []).forEach((name, k) => {
    const def = tactical.content.items.byName.get(name);
    const slot = SMALL_POCKETS[k];
    if (!def || slot === undefined) throw new Error(`cannot pocket ${name}`);
    carrier.inv[slot] = createItem(tactical.content.items, def.index, 100);
  });
  visit.prepare?.(carrier, tactical.content.items);
  const profile = visit.profile ?? STUB_DEALER;
  const dealer = a10.campaign.campaign.tactical?.state.soldiers.find((s) => s?.placed && s.profile === profile);
  if (!dealer) throw new Error(`no stub shopkeeper ${profile}`);
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
  expect(f.widget('talkOptionText4').text).toBe(visit.option ?? 'Buy/Sell');
  await f.click('talkOption4');
  expect(f.client.commands.some((c) => c.cmd.type === 'approach' && c.reply.ok)).toBe(true);
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

describe('the shop screen at the stub dealer', () => {
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

  it('empties the tactical message log on the way back from the shop, as EnterTacticalScreen does', async () => {
    const { f } = await atTheDealer(4);
    const shop = f.screen.dialogue.shop;
    const tick = f.client.view.tick;
    f.frames([{ tick, changed: [], removed: [], messages: [{ tick, kind: 'interface', colour: FONT_RED, args: [{ text: 'Sold' }] }] }]);
    f.t.frame();
    expect(f.screen.messageLines).toEqual(['Sold']);
    await f.click('shopDone');
    await settleShop(f);
    playOut(f);
    f.t.frame();
    expect(shop.open).toBe(false);
    expect(f.screen.messageLines).toEqual([]);
  });

  it("steps the single merc panel to the next merc in the shop with a locate but no locator, as SelectMerc's DONTSETLOCATOR does", async () => {
    const { f, merc } = await atTheDealer(4);
    const located = f.world.located.length;
    await f.click('smNextMerc');
    const next = f.screen.smMerc;
    expect(next).not.toBe(merc);
    const gridNo = f.client.view.soldiers.find((s) => s.id === next)?.gridNo;
    expect(f.world.located.slice(located)).toEqual([gridNo]);
    expect(f.draw().items.filter((i) => i.kind === 'image' && i.asset === RADIO)).toEqual([]);
  });

  it('starts the entry quote 800 ms after entering, and waits on while the description box is up', async () => {
    const { f } = await atTheDealer(4);
    const shop = f.screen.dialogue.shop;
    const tick = f.client.view.tick;
    const entry = { type: 'shopkeeperQuote', dealer: STUB_DEALER, quote: FIRST_ENTERS, text: 'Welcome.', chars: 8, tick };
    f.frames([{ tick, changed: [], removed: [], events: [entry as unknown as SimEvent] }]);
    expect(shop.talking()).toBe(false);
    await f.click('shopDealerSlot0', MouseButton.RIGHT);
    expect(f.screen.description.open).toBe(true);
    f.t.frame(ENTRY_QUOTE_DELAY_MS * 2);
    f.t.frame();
    expect(shop.talking()).toBe(false);
    f.key('Escape');
    expect(f.screen.description.open).toBe(false);
    f.t.frame(ENTRY_QUOTE_DELAY_MS - 100);
    expect(shop.talking()).toBe(false);
    f.t.frame(200);
    expect(shop.talking()).toBe(true);
  });

  it('outlines a detonator for TNT under the pointer, which the guns’ attachment lists leave out, and no grenade for a launcher', async () => {
    const { f } = await atTheDealer(6, ['TNT', 'DETONATOR', 'GLAUNCHER', 'GL_HE_GRENADE']);
    const shop = f.screen.dialogue.shop;
    for (const slot of SMALL_POCKETS) {
      await f.click(`slot${slot}`);
      await settleShop(f);
    }
    expect(shop.model.playerOffer.slice(0, 4).map((o) => o?.item)).toEqual(['TNT', 'DETONATOR', 'GLAUNCHER', 'GL_HE_GRENADE']);
    expect(outlinedOfferSlots(f)).toEqual([]);
    hover(f, 'shopPlayerOfferSlot0');
    await settleShop(f);
    expect(outlinedOfferSlots(f)).toEqual([1]);
    hover(f, 'shopPlayerOfferSlot1');
    await settleShop(f);
    expect(outlinedOfferSlots(f)).toEqual([0]);
    hover(f, 'shopPlayerOfferSlot2');
    await settleShop(f);
    expect(outlinedOfferSlots(f)).toEqual([]);
  });

  it('names the owner of an offered pocket in the tooltip of its small face, and has no face regions over the stock', async () => {
    const { f, merc } = await atTheDealer(6);
    const pocket = (f.client.view.soldiers.find((s) => s.id === merc)?.inventory ?? []).find((i) => i.item === 'GLOCK_17');
    if (!pocket) throw new Error('no pistol in a pocket');
    await f.click(`slot${pocket.slot}`);
    await settleShop(f);
    const profile = f.client.view.soldiers.find((s) => s.id === merc)?.profile ?? -1;
    const nickname = 'Ivan';
    f.media.profiles.set(profile, { ...NO_FACE, id: profile, name: 'Ivan Dolvich', nickname, faceIndex: profile });
    f.t.frame();
    const dash = f.text.string('pMessageStrings', MSG_DASH_S) ?? '';
    const help = f.widget('shopPlayerOfferSlot0').text ?? '';
    expect(help.length).toBeGreaterThan(0);
    expect(f.widget('shopPlayerOfferFace0').text).toBe(`${nickname}${dash} ${help}`);
    expect(f.widget('shopPlayerOfferFace1').text).toBeNull();
    expect(f.widget('shopDealerFace0')).toMatchObject({ visible: false, enabled: false });
    expect(f.widget('shopDealerOfferFace0')).toMatchObject({ visible: false, enabled: false });
  });

  it('draws the bullets the repairman leaves of an offered gun in its slot, crossed out, and takes the whole gun back at a click on them', async () => {
    const { f, merc } = await atTheShop(7, {
      profile: STUB_REPAIRMAN,
      option: 'Repair',
      prepare: (carrier, items) => {
        const pistol = items.byName.get('GLOCK_17');
        const clip = items.byName.get('CLIP9_15');
        if (!pistol || !clip) throw new Error('no pistol or clip');
        const gun = createItem(items, pistol.index, DAMAGED_STATUS);
        carrier.inv[HAND_SLOT] = gun;
        gun.gunAmmoItem = clip.index;
        gun.gunShotsLeft = ROUNDS_LEFT;
      },
    });
    const shop = f.screen.dialogue.shop;
    expect(shop.model.repairs).toBe(true);
    await f.click(`slot${HAND_SLOT}`);
    await settleShop(f);
    expect(shop.model.quote?.repair.map((r) => r.item)).toEqual(['GLOCK_17']);
    expect(shop.model.offerPart(0)).toMatchObject({ item: 'CLIP9_15', status: ROUNDS_LEFT, source: { soldier: merc, slot: HAND_SLOT } });
    f.t.frame();
    const { rect } = f.widget('shopPlayerOfferSlot0');
    const drawn = f
      .draw()
      .items.flatMap((i) =>
        i.kind === 'image' && i.x >= rect.x && i.x < rect.x + rect.width && i.y >= rect.y - 2 && i.y < rect.y + rect.height ? [i] : [],
      );
    const clip = f.media.item('CLIP9_15')?.inventoryGraphics.small.path.toLowerCase();
    const gun = f.media.item('GLOCK_17')?.inventoryGraphics.small.path.toLowerCase();
    expect(drawn.some((i) => i.asset === clip)).toBe(true);
    expect(drawn.some((i) => i.asset === gun)).toBe(false);
    expect(drawn.some((i) => i.asset === CROSS_OUT && i.x === rect.x + CROSS_OUT_X)).toBe(true);
    await f.click('shopPlayerOfferSlot0');
    await settleShop(f);
    expect(shop.model.held).toMatchObject({ kind: 'offer', offer: { soldier: merc, slot: HAND_SLOT, item: 'GLOCK_17' } });
    expect(shop.model.playerOffer[0]).toBeNull();
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
    await f.click('shopDealerSlot0', MouseButton.RIGHT);
    expect(f.screen.description.open).toBe(true);
    expect(f.screen.description.item).toBe(f.client.view.shop?.boxes[0]?.item);
    expect(f.widget('itemDescriptionBox').rect).toMatchObject({ x: 160, y: 0 });
    expect(f.widget('shopDone').enabled).toBe(false);
    f.key('Escape');
    expect(f.screen.description.open).toBe(false);
    expect(f.client.commands.at(-1)?.cmd.type).not.toBe('closeShop');
    f.key('Escape');
    await settleShop(f);
    expect(f.client.commands.at(-1)?.cmd).toEqual({ type: 'closeShop' });
  });
});

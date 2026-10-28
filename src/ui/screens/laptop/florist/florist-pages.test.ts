import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clickWidget,
  findWidget,
  type LaptopUiKit,
  laptopUiKit,
  openLaptopHarness,
  openWebPage,
  shownWidget,
} from '../../../../../tests/support/laptop-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../../tests/support/sectors.ts';
import type { TestRuntime } from '../../../../../tests/support/ui-runtime.ts';
import { loadUiStrings, type UiStrings } from '../../../../content/text/strings.ts';
import { FinanceCode } from '../../../../sim/campaign/finances.ts';
import { FontName } from '../../../text/fonts.ts';
import { glyphRun } from '../../../text/print.ts';
import { Bookmark, LaptopMode } from '../laptop-modes.ts';

const BLACK_ROSES_PRICE = 20;
const SECOND_BOUQUET_PRICE = 45;
const DESTINATION = 3;
const CARD = 2;
const CARD_SAYING = 'Get well soon!';
const CHECK_BOX_ASSET = 'laptop/ordercheckbox.sti';
const DESTINATION_NAMES = 'shipping-destinations';

let kit: StubSectorKit;
let ui: LaptopUiKit;
let strings: UiStrings;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await laptopUiKit(kit);
  strings = await loadUiStrings(kit.read, 'eng');
});

afterAll(async () => {
  await kit.dispose();
});

describe('the florist pages', () => {
  it('bookmarks the site, pages the gallery, orders a bouquet with an extra to a picked destination and returns home', async () => {
    const h = await openLaptopHarness(kit, ui);
    await openWebPage(h, Bookmark.FLORIST);
    expect(h.commands).toContainEqual({ type: 'visitSite', site: 'florist' });
    expect(h.laptop().bookmarks).toContain('florist');
    expect(findWidget(h.t, 'floristHomeLink')?.visible).toBe(false);
    await clickWidget(h.t, 'floristGallery');
    expect(h.screen.shell.mode).toBe(LaptopMode.FLORIST_FLOWER_GALLERY);
    expect(shownWidget(h.t, 'floristFlowerName0').text).toBe('Morning Field');
    expect(shownWidget(h.t, 'floristFlowerPrice1').text).toMatch(/^\$45\.00 /);
    expect(shownWidget(h.t, 'floristGalleryBack').text).toBe('Home');
    await clickWidget(h.t, 'floristGalleryNext');
    await clickWidget(h.t, 'floristGalleryNext');
    await clickWidget(h.t, 'floristGalleryNext');
    expect(shownWidget(h.t, 'floristFlowerName0').text).toBe('Snow Crown');
    expect(findWidget(h.t, 'floristFlowerName1')?.visible).toBe(false);
    expect(shownWidget(h.t, 'floristGalleryNext').enabled).toBe(false);
    for (let i = 0; i < 3; i++) await clickWidget(h.t, 'floristGalleryBack');
    expect(shownWidget(h.t, 'floristGalleryBack').text).toBe('Home');
    await clickWidget(h.t, 'floristFlower1');
    expect(h.screen.shell.mode).toBe(LaptopMode.FLORIST_ORDERFORM);
    expect(h.commands).toContainEqual({ type: 'visitSite', site: 'floristOrderForm' });
    const orderNumber = h.laptop().florist.orderNumber;
    expect(orderNumber).toBeGreaterThan(0);
    expect(shownWidget(h.t, 'floristOrderNumber').text).toBe(String(orderNumber));
    expect(shownWidget(h.t, 'floristFlowerName').text).toBe('Red Promise');

    await clickWidget(h.t, 'floristDestinationBox');
    expect(shownWidget(h.t, 'floristListClose').visible).toBe(true);
    await clickWidget(h.t, `floristDestinationRow${DESTINATION}`);
    expect(findWidget(h.t, `floristDestinationRow${DESTINATION}`)).toBeUndefined();
    const destination = h.laptop().bobbyRay.destinations[DESTINATION];
    if (!destination) throw new Error('no destination');
    expect(shownWidget(h.t, 'floristDestination').text).toBe(destinationName(DESTINATION));
    await clickWidget(h.t, 'floristCheck3');
    const price = BLACK_ROSES_PRICE + SECOND_BOUQUET_PRICE + destination.flowers.whenItGetsThere;
    expect(shownWidget(h.t, 'floristPrice').text).toMatch(new RegExp(`^\\$${price}\\.00 `));
    const balance = h.laptop().balance;
    await clickWidget(h.t, 'floristSend');
    expect(h.commands).toContainEqual({
      type: 'orderFlowers',
      bouquet: 1,
      destination: DESTINATION,
      nextDay: false,
      extras: ['blackRoses'],
    });
    expect(h.laptop().balance).toBe(balance - price);
    expect(h.laptop().finances.at(-1)).toMatchObject({ code: FinanceCode.PURCHASED_FLOWERS, amount: -price });
    expect(h.screen.shell.mode).toBe(LaptopMode.FLORIST);
  });

  it('fills the sentiment from a standard card and keeps the form across the card gallery', async () => {
    const h = await openLaptopHarness(kit, ui);
    await openWebPage(h, Bookmark.FLORIST);
    await clickWidget(h.t, 'floristGallery');
    await clickWidget(h.t, 'floristFlower0');
    await clickWidget(h.t, 'floristCheck0');
    await clickWidget(h.t, 'floristCardsLink');
    expect(h.screen.shell.mode).toBe(LaptopMode.FLORIST_CARD_GALLERY);
    expect(shownWidget(h.t, `floristCardText${CARD}`).text).toBe(CARD_SAYING);
    await clickWidget(h.t, `floristCard${CARD}`);
    expect(h.screen.shell.mode).toBe(LaptopMode.FLORIST_ORDERFORM);
    expect(drawsText(h.t, CARD_SAYING)).toBe(true);
    expect(checkFrames(h.t)).toEqual([1, 0]);
    await clickWidget(h.t, 'floristHomeLink');
    expect(h.screen.shell.mode).toBe(LaptopMode.FLORIST);
    await clickWidget(h.t, 'floristGallery');
    await clickWidget(h.t, 'floristFlower0');
    expect(drawsText(h.t, CARD_SAYING)).toBe(false);
    expect(checkFrames(h.t)).toEqual([0, 1]);
  });
});

function drawsText(t: TestRuntime, text: string): boolean {
  const expected = glyphRun(t.fonts.get(FontName.FONT12ARIAL), text, 0, 0)
    .glyphs.map((g) => g.index)
    .join(',');
  const drawn = t.list.items.flatMap((item) => (item.kind === 'glyphs' ? item.glyphs.map((g) => g.index) : [])).join(',');
  return `,${drawn},`.includes(`,${expected},`);
}

function checkFrames(t: TestRuntime): number[] {
  const at = (x: number, y: number) =>
    t.list.items.find((item) => item.kind === 'image' && item.asset === CHECK_BOX_ASSET && item.x === x && item.y === y);
  return [at(297, 169), at(381, 169)].map((item) => (item?.kind === 'image' ? item.frame : -1));
}

function destinationName(index: number): string {
  const names = strings.tables[DESTINATION_NAMES];
  return Array.isArray(names) ? (names[index] ?? '') : '';
}

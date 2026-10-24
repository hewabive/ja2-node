import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  click,
  dismissModal,
  find,
  key,
  type LaptopHarness,
  type LaptopUiKit,
  laptopUiKit,
  openLaptopHarness,
  settle,
  shown,
} from '../../../../tests/support/laptop-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { parseSectorString, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import type { CampaignSession } from '../../../server/campaign-session.ts';
import { Bookmark } from '../../../sim/campaign/laptop/laptop-state.ts';
import { MouseButton } from '../../input/events.ts';
import { LaptopMode } from './laptop-modes.ts';

const SLOW_MS = 120_000;
const DRASSEN_ROW = 2;

let kit: StubSectorKit;
let ui: LaptopUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await laptopUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

function openBobbyRay(session: CampaignSession): void {
  const b13 = parseSectorString('B13');
  const element = session.campaign.state.map.elements[strategicIndex(b13)];
  if (element) element.enemyControlled = false;
  session.campaign.laptop?.surfaceSectorTaken(b13);
}

function bookmark(id: number): (session: CampaignSession) => void {
  return (session) => {
    session.campaign.state.laptop.bookmarks.push(id);
  };
}

async function toBookmark(h: LaptopHarness, row: number): Promise<void> {
  const { t } = h;
  if (find(t, 'newMailOk')?.visible) await click(t, 'newMailOk');
  await click(t, 'webButton');
  if (!h.screen.shell.showBookmarks) await click(t, 'webButton');
  await click(t, `bookmarkRegion${row}`);
  await settle(t, 10);
}

describe("Bobby Ray's on the canvas laptop", () => {
  it(
    'shows the site under construction with its signs disabled and marks the visit',
    async () => {
      const h = await openLaptopHarness(kit, ui, { seed: 21, prepare: bookmark(Bookmark.BOBBYR) });
      await toBookmark(h, 1);
      expect(h.screen.shell.mode).toBe(LaptopMode.BOBBY_R);
      expect(h.commands.some((c) => c.type === 'visitSite' && c.site === 'bobbyRay')).toBe(true);
      expect(shown(h.t, 'underConstructionText').text).not.toBe('');
      expect(shown(h.t, 'bobbyRaySign2').enabled).toBe(false);
      expect(find(h.t, 'bobbyRaySentence1')?.visible).toBe(false);
    },
    SLOW_MS,
  );

  it(
    'buys from the guns catalogue, ships to Drassen through the drop-down and lists the shipment',
    async () => {
      const h = await openLaptopHarness(kit, ui, {
        seed: 22,
        prepare: (session) => {
          openBobbyRay(session);
          bookmark(Bookmark.BOBBYR)(session);
        },
      });
      const { t } = h;
      await toBookmark(h, 1);
      expect(shown(t, 'bobbyRaySign2').enabled).toBe(true);
      await click(t, 'bobbyRaySign2');
      expect(h.screen.shell.mode).toBe(LaptopMode.BOBBY_R_GUNS);
      expect(shown(t, 'bobbyRayCatalogue0').enabled).toBe(false);
      expect(shown(t, 'itemName0').text).not.toBe('');
      await click(t, 'bigImage0');
      await click(t, 'bigImage0');
      expect(shown(t, 'onOrder0').text?.trim()).toBe('2');
      await click(t, 'bigImage0', MouseButton.RIGHT);
      expect(shown(t, 'onOrder0').text?.trim()).toBe('1');
      expect(shown(t, 'catalogueSubtotal').text).toMatch(/\$[\d,]+$/);

      await click(t, 'bobbyRayOrderForm');
      expect(h.screen.shell.mode).toBe(LaptopMode.BOBBY_R_MAILORDER);
      expect(shown(t, 'orderQuantity0').text?.trim()).toBe('1');
      expect(shown(t, 'acceptOrder').enabled).toBe(false);
      await click(t, 'cityDropDownToggle');
      expect(find(t, 'cityDropDown.row0')?.visible).toBe(true);
      await click(t, `cityDropDown.row${DRASSEN_ROW}`);
      expect(find(t, 'cityDropDown.row0')).toBeUndefined();
      expect(shown(t, 'shippingCity').text).toBe('Drassen');
      await settle(t);
      expect(shown(t, 'orderShipping').text).not.toBe('$0');
      expect(shown(t, 'acceptOrder').enabled).toBe(true);
      await click(t, 'acceptOrder');
      await settle(t);
      expect(h.commands.some((c) => c.type === 'bobbyRayOrder' && c.destination === DRASSEN_ROW)).toBe(true);
      expect(shown(t, 'confirmOrderArea').enabled).toBe(true);
      expect(h.session.view().laptop?.bobbyRay.shipments).toHaveLength(1);
      await click(t, 'confirmOrderArea');
      expect(h.screen.shell.mode).toBe(LaptopMode.BOBBY_R);

      await click(t, 'bobbyRaySign2');
      await click(t, 'bobbyRayOrderForm');
      expect(find(t, 'orderQuantity0')?.visible).toBe(false);
      await click(t, 'orderShipments');
      expect(h.screen.shell.mode).toBe(LaptopMode.BOBBYR_SHIPMENTS);
      expect(shown(t, 'shipmentUnits0').text).toBe('1');
      expect(shown(t, 'orderQuantity0').text?.trim()).toBe('1');
    },
    SLOW_MS,
  );
});

async function wait(h: LaptopHarness, ms: number): Promise<void> {
  h.t.frame(ms);
  await settle(h.t, 2);
}

describe('M.E.R.C. on the canvas laptop', () => {
  it(
    "plays Speck's opening, opens an account, hires from the files, pays the bill and shows the broken link while the site is down",
    async () => {
      const h = await openLaptopHarness(kit, ui, { seed: 23, prepare: bookmark(Bookmark.MERC) });
      const { t } = h;
      await toBookmark(h, 1);
      expect(h.screen.shell.mode).toBe(LaptopMode.MERC);
      expect(h.commands.filter((c) => c.type === 'visitSite' && c.site === 'merc')).toHaveLength(1);
      expect(shown(t, 'speckVideoTitle').visible).toBe(true);
      expect(shown(t, 'mercFilesButton').enabled).toBe(false);
      await wait(h, 1100);
      expect(find(t, 'speckSubtitle')?.visible).toBe(true);
      await click(t, 'speckSubtitle');
      await click(t, 'speckClose');
      await wait(h, 600);
      expect(find(t, 'speckVideoTitle')?.visible).toBe(false);

      await click(t, 'mercAccountButton');
      expect(h.screen.shell.mode).toBe(LaptopMode.MERC_NO_ACCOUNT);
      await click(t, 'mercOpenAccount');
      expect(h.screen.shell.mode).toBe(LaptopMode.MERC);
      expect(h.commands.filter((c) => c.type === 'visitSite')).toHaveLength(1);
      expect(shown(t, 'speckVideoTitle').visible).toBe(true);
      expect(shown(t, 'mercFilesButton').enabled).toBe(true);

      await click(t, 'mercFilesButton');
      expect(h.screen.shell.mode).toBe(LaptopMode.MERC_FILES);
      expect(shown(t, 'mercFileName').text).not.toBe('');
      expect(shown(t, 'mercSalary').text).toMatch(/^150 /);
      expect(shown(t, 'mercHire').enabled).toBe(true);
      const before = h.session.view().strategic?.mercs.length ?? 0;
      await click(t, 'mercHire');
      expect(h.session.view().strategic?.mercs.length).toBe(before + 1);
      expect(h.replies.at(-1)?.ok).toBe(true);
      await settle(t);
      expect(h.screen.shell.mode).toBe(LaptopMode.MERC);
      expect(t.runtime.host.modal).not.toBeNull();
      await dismissModal(t);
      await settle(t);
      expect(shown(t, 'speckVideoTitle').visible).toBe(true);

      await click(t, 'mercAccountButton');
      expect(h.screen.shell.mode).toBe(LaptopMode.MERC_ACCOUNT);
      expect(shown(t, 'accountCharge0').text).toBe('$   150');
      expect(shown(t, 'mercAuthorize').enabled).toBe(true);
      await click(t, 'mercAuthorize');
      expect(t.runtime.host.modal).not.toBeNull();
      await key(t, 'y', 'up');
      await settle(t);
      expect(h.commands.some((c) => c.type === 'mercPay')).toBe(true);
      expect(h.screen.shell.mode).toBe(LaptopMode.MERC);

      Object.assign(h.session.campaign.state.laptop.merc, { siteHasGoneDownYet: true, firstVisitSinceServerWentDown: 0 });
      await click(t, 'webButton');
      if (!h.screen.shell.showBookmarks) await click(t, 'webButton');
      await click(t, 'bookmarkRegion1');
      await settle(t, 10);
      expect(h.screen.shell.mode).toBe(LaptopMode.BROKEN_LINK);
      expect(shown(t, 'brokenLinkError').text).not.toBe('');
    },
    SLOW_MS,
  );
});

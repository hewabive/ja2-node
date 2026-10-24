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
  type,
} from '../../../../tests/support/laptop-sites-ui.ts';
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
      expect(find(t, 'speckFace')?.visible).toBe(true);
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

async function waitFor(h: LaptopHarness, id: string): Promise<void> {
  for (let i = 0; i < 30 && !find(h.t, id)?.visible; i++) await settle(h.t, 1);
  expect(find(h.t, id)?.visible, id).toBe(true);
}

async function clickThrough(h: LaptopHarness, id: string, next: string): Promise<void> {
  await click(h.t, id);
  await waitFor(h, next);
}

describe('I.M.P. on the canvas laptop', () => {
  it(
    'refuses a bad code, creates a character through every page and charges the profile',
    async () => {
      const h = await openLaptopHarness(kit, ui, { seed: 24, prepare: bookmark(Bookmark.IMP) });
      const { t } = h;
      await toBookmark(h, 1);
      expect(h.screen.shell.mode).toBe(LaptopMode.CHAR_PROFILE);
      await waitFor(h, 'impHomeTitle');
      expect(find(t, 'impCancel')?.visible).toBe(false);
      await clickThrough(h, 'impAboutUs', 'impAboutUsTitle');
      await clickThrough(h, 'impAboutUsBack', 'impHomeTitle');

      await click(t, 'impCode');
      await type(t, 'NOPE');
      await key(t, 'Enter', 'up');
      expect(t.runtime.host.modal).not.toBeNull();
      await dismissModal(t);
      for (let i = 0; i < 4; i++) await key(t, 'Backspace', 'down');
      await type(t, 'XEP624');
      await key(t, 'Enter', 'up');
      await waitFor(h, 'impMainTitle');
      expect(h.commands.some((c) => c.type === 'impCheckCode' && c.code === 'XEP624')).toBe(true);
      expect(shown(t, 'impProfile0').enabled).toBe(false);
      await click(t, 'impBlocker0');
      expect(t.runtime.host.modal).not.toBeNull();
      await dismissModal(t);

      await clickThrough(h, 'impBegin', 'impBeginTitle');
      expect(find(t, 'impCancel')?.visible).toBe(true);
      await click(t, 'impBeginDone');
      expect(t.runtime.host.modal).not.toBeNull();
      await dismissModal(t);
      await click(t, 'impFullName');
      await type(t, 'Ivan Testov');
      await click(t, 'impMaleBox');
      expect(shown(t, 'impMaleMark').visible).toBe(true);
      await clickThrough(h, 'impBeginDone', 'impMainTitle');
      expect(shown(t, 'impProfile0').enabled).toBe(true);

      await clickThrough(h, 'impProfile0', 'impPersonalityTitle');
      await clickThrough(h, 'impPersonalityBegin', 'impQuizTitle');
      const answers = h.session.view().laptop?.imp.quizAnswers ?? [];
      for (let q = 0; q < answers.length; q++) {
        expect(shown(t, 'impQuestionNumber').text).toBe(String(q + 1));
        expect(shown(t, 'impQuizConfirm').enabled).toBe(false);
        expect(find(t, `impAnswer${(answers[q] ?? 1) - 1}`)?.visible).toBe(true);
        await click(t, 'impAnswer0');
        expect(shown(t, 'impQuizConfirm').enabled).toBe(true);
        await click(t, 'impQuizConfirm');
        if (q === 0) {
          await click(t, 'impQuizPrevious');
          expect(shown(t, 'impQuestionNumber').text).toBe('1');
          expect(shown(t, 'impQuizConfirm').enabled).toBe(true);
          await click(t, 'impQuizNext');
        }
      }
      await waitFor(h, 'impPersonalityQuestion');
      await click(t, 'impPersonalityYes');
      expect(find(t, 'impPersonalityYes')?.visible).toBe(false);
      await clickThrough(h, 'impPersonalityOk', 'impMainTitle');

      await clickThrough(h, 'impProfile1', 'impAttributeEntranceTitle');
      await clickThrough(h, 'impAttributeEntranceBegin', 'impAttributesTitle');
      expect(shown(t, 'impBonusPoints').text).toBe('40');
      await click(t, 'impIncrease0');
      expect(shown(t, 'impAttributeValue0').text).toBe('56');
      expect(shown(t, 'impBonusPoints').text).toBe('39');
      for (let i = 0; i < 20; i++) await click(t, 'impDecrease6');
      expect(shown(t, 'impAttributeValue6').text).toBe('35');
      await click(t, 'impDecrease6');
      expect(t.runtime.host.modal).not.toBeNull();
      await key(t, 'n', 'up');
      await settle(t);
      expect(shown(t, 'impAttributeValue6').text).toBe('35');
      await clickThrough(h, 'impAttributesFinish', 'impAttributeFinishTitle');
      await clickThrough(h, 'impAttributesYes', 'impMainTitle');

      await clickThrough(h, 'impProfile2', 'impPortraitTitle');
      await click(t, 'impPortraitNext');
      await clickThrough(h, 'impPortraitDone', 'impMainTitle');
      await clickThrough(h, 'impProfile3', 'impVoiceTitle');
      await click(t, 'impVoiceNext');
      expect(shown(t, 'impVoiceIndex').text).toMatch(/ 2$/);
      await clickThrough(h, 'impVoiceDone', 'impFinishName');
      expect(shown(t, 'impFinishName').text).toContain('Ivan Testov');

      const before = h.session.view().strategic?.mercs.length ?? 0;
      await clickThrough(h, 'impFinishDone', 'impConfirmTitle');
      await click(t, 'impConfirmYes');
      await settle(t);
      const created = h.commands.find((c) => c.type === 'impCreate') as Record<string, unknown> | undefined;
      expect(created).toMatchObject({ code: 'XEP624', name: 'Ivan Testov', nickname: 'Ivan', gender: 'male', portrait: 1, voice: 1 });
      expect(created?.attributes).toMatchObject({ health: 56, marksmanship: 35 });
      expect(h.replies.at(-1)?.ok).toBe(true);
      expect(h.session.view().strategic?.mercs.length).toBe(before + 1);
      await waitFor(h, 'impHomeTitle');
    },
    SLOW_MS,
  );
});

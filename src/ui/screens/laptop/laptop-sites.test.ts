import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withImpPolicy } from '../../../../tests/support/game-policy.ts';
import {
  click,
  dismissModal,
  find,
  key,
  type LaptopHarness,
  type LaptopUiKit,
  laptopUiKit,
  loadStubImage,
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
import { portraitPath } from '../../widgets/portrait.ts';
import { faceFileOf } from '../tactical/faces.ts';
import { LaptopMode } from './laptop-modes.ts';

const DRASSEN_ROW = 2;
const UNDER_CONSTRUCTION = 'laptop/underconstruction.sti';
const CONSTRUCTION_FRAME_MS = 200;

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
  it('shows the site under construction with its signs disabled and marks the visit', async () => {
    const h = await openLaptopHarness(kit, ui, { seed: 21, prepare: bookmark(Bookmark.BOBBYR) });
    await toBookmark(h, 1);
    expect(h.screen.shell.mode).toBe(LaptopMode.BOBBY_R);
    expect(h.commands.some((c) => c.type === 'visitSite' && c.site === 'bobbyRay')).toBe(true);
    expect(shown(h.t, 'underConstructionText').text).not.toBe('');
    expect(shown(h.t, 'bobbyRaySign2').enabled).toBe(false);
    expect(find(h.t, 'bobbyRaySentence1')?.visible).toBe(false);
  });

  it('holds the under-construction animation while the next site loads', async () => {
    const h = await openLaptopHarness(kit, ui, { seed: 21, prepare: bookmark(Bookmark.BOBBYR), loadingTimeScale: 1 });
    const { t } = h;
    const constructionFrames = () => t.list.items.flatMap((i) => (i.kind === 'image' && i.asset === UNDER_CONSTRUCTION ? [i.frame] : []));
    await toBookmark(h, 1);
    await until(h, () => !h.screen.shell.loading && h.screen.shell.shownMode === LaptopMode.BOBBY_R);
    await wait(h, CONSTRUCTION_FRAME_MS);
    const before = constructionFrames();
    expect(before.length).toBeGreaterThan(0);
    await toBookmark(h, 0);
    expect([h.screen.shell.loading, h.screen.shell.shownMode]).toEqual([true, LaptopMode.BOBBY_R]);
    const held = constructionFrames();
    for (let step = 0; step < 4; step++) await wait(h, CONSTRUCTION_FRAME_MS);
    expect(h.screen.shell.loading).toBe(true);
    expect(constructionFrames()).toEqual(held);
    await until(h, () => !h.screen.shell.loading);
  });

  it('buys from the guns catalogue, ships to Drassen through the drop-down and lists the shipment', async () => {
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
  });
});

async function wait(h: LaptopHarness, ms: number): Promise<void> {
  h.t.frame(ms);
  await settle(h.t, 2);
}

const EYE_FRAMES = [1, 2, 3, 4];
const FRAME_MS = 16;
const BLINK_WAIT_MS = 6000;

function smallFaceFrames(h: LaptopHarness): number[] {
  return h.t.list.items.flatMap((i) => (i.kind === 'image' && /^faces\/\d+\.sti$/.test(i.asset) ? [i.frame] : []));
}

async function blinks(h: LaptopHarness): Promise<boolean> {
  for (let ms = 0; ms < BLINK_WAIT_MS; ms += FRAME_MS) {
    h.t.frame(FRAME_MS);
    if (smallFaceFrames(h).some((frame) => EYE_FRAMES.includes(frame))) return true;
  }
  return false;
}

const CONFERENCE_TIMEOUT_MS = 15000;
const KIT_BUTTONS = ['equipment0', 'equipment1'];
const SELECT_LIGHT_X = 105;
const SELECT_LIGHT_UP_Y = 7;
const SELECT_LIGHT_HELD_Y = 8;
const SELECT_LIGHT_SIZE = 8;
const SMALL_TALK_WAIT_MS = 6000;
const SUBTITLE_BORDER = 'interface/tactpopup.sti';

async function until(h: LaptopHarness, done: () => boolean): Promise<void> {
  for (let elapsed = 0; elapsed < CONFERENCE_TIMEOUT_MS && !done(); elapsed += FRAME_MS) await wait(h, FRAME_MS);
  expect(done()).toBe(true);
}

async function callMercAtHome(h: LaptopHarness, exclude: readonly number[] = []): Promise<number> {
  const { t } = h;
  await toBookmark(h, 0);
  await click(t, 'memberCardLink');
  await click(t, 'toMugShotsLink');
  const accepts = (profile: number) => (h.live.dispatch({ type: 'hireCheck', profile }).data as { accepted?: boolean }).accepted === true;
  const merc = h.session
    .view()
    .laptop?.aim.find((m) => m.contact === 'firstContact' && m.face === 'available' && !exclude.includes(m.profile) && accepts(m.profile));
  const mug = t.runtime.describe().find((w) => w.id.startsWith('mugName') && w.text === merc?.nickname);
  if (!merc || !mug) throw new Error('no mug shot of a merc at home who would join');
  await click(t, mug.id.replace('mugName', 'mugRegion'));
  await click(t, 'aimContact');
  await until(h, () => find(t, 'hire')?.visible === true);
  return merc.profile;
}

async function transferFunds(h: LaptopHarness): Promise<void> {
  await click(h.t, 'hire');
  await until(h, () => find(h.t, 'transferFunds')?.visible === true);
  await click(h.t, 'transferFunds');
  await until(h, () => find(h.t, 'popupOk')?.visible === true);
}

function shadedButtons(h: LaptopHarness, ids: readonly string[]): string[] {
  return ids.filter((id) => {
    const { rect } = shown(h.t, id);
    return h.t.list.items.some((i) => i.kind === 'shadow' && i.x === rect.x && i.y === rect.y);
  });
}

describe('A.I.M. on the canvas laptop', () => {
  it('keeps the kit buttons disabled but undimmed behind the funds transfer box', async () => {
    const h = await openLaptopHarness(kit, ui, { seed: 27 });
    await callMercAtHome(h);
    await transferFunds(h);
    expect(h.replies.at(-1)?.ok).toBe(true);
    expect(KIT_BUTTONS.map((id) => shown(h.t, id).enabled)).toEqual([false, false]);
    expect(shadedButtons(h, KIT_BUTTONS)).toEqual([]);
  });

  it('draws the selection light of a contract button a pixel lower while the button is held', async () => {
    const h = await openLaptopHarness(kit, ui, { seed: 27 });
    const { t } = h;
    await callMercAtHome(h);
    await click(t, 'hire');
    await until(h, () => find(t, 'contract0')?.visible === true);
    const { rect } = shown(t, 'contract0');
    const lightAt = (dy: number) =>
      t.list.items.some(
        (i) => i.kind === 'fill' && i.x === rect.x + SELECT_LIGHT_X && i.y === rect.y + dy && i.width === SELECT_LIGHT_SIZE,
      );
    const x = rect.x + Math.floor(rect.width / 2);
    const y = rect.y + Math.floor(rect.height / 2);
    expect(lightAt(SELECT_LIGHT_UP_Y)).toBe(true);
    t.move(x, y);
    t.down(x, y);
    t.frame();
    expect(lightAt(SELECT_LIGHT_HELD_Y)).toBe(true);
    expect(lightAt(SELECT_LIGHT_UP_Y)).toBe(false);
    t.up(x, y);
    t.frame();
    expect(lightAt(SELECT_LIGHT_UP_Y)).toBe(true);
  });

  it('explains the arrival after the first hire of a laptop session only', async () => {
    const h = await openLaptopHarness(kit, ui, { seed: 27 });
    const { t } = h;
    const conferenceClosed = () => find(t, 'closeConference')?.visible !== true;
    const first = await callMercAtHome(h);
    await transferFunds(h);
    await click(t, 'popupOk');
    await until(h, () => t.runtime.host.modal !== null);
    await dismissModal(t);
    await callMercAtHome(h, [first]);
    await transferFunds(h);
    expect(h.replies.at(-1)?.ok).toBe(true);
    await click(t, 'popupOk');
    await until(h, conferenceClosed);
    await settle(t, 12);
    expect(t.runtime.host.modal).toBeNull();
  });

  it('has a merc greet the caller after the snow, then, kept waiting, make small talk with its text after six silent seconds', async () => {
    const h = await openLaptopHarness(kit, ui, { seed: 27 });
    const { t } = h;
    await callMercAtHome(h);
    const faceUp = t.now;
    const talking = () => find(t, 'shutUp')?.visible === true;
    const subtitled = () => t.list.items.some((i) => i.kind === 'image' && i.asset === SUBTITLE_BORDER);
    expect([talking(), subtitled()]).toEqual([false, false]);
    await until(h, talking);
    expect(t.now - faceUp).toBeLessThan(SMALL_TALK_WAIT_MS);
    expect(subtitled()).toBe(true);
    await until(h, () => !talking());
    const silent = t.now;
    await until(h, talking);
    expect(t.now - silent).toBeGreaterThanOrEqual(SMALL_TALK_WAIT_MS);
    expect(subtitled()).toBe(true);
  });

  it("blinks the merc's face in the video conference", async () => {
    const h = await openLaptopHarness(kit, ui, { seed: 27 });
    const { t } = h;
    await toBookmark(h, 0);
    await click(t, 'memberCardLink');
    await click(t, 'toMugShotsLink');
    const atHome = h.session.view().laptop?.aim.find((m) => m.contact === 'firstContact');
    const profile = atHome ? h.session.campaign.laptop?.profileRecord(atHome.profile) : null;
    const mug = t.runtime.describe().find((w) => w.id.startsWith('mugName') && w.text === profile?.nickname);
    if (!profile || !mug) throw new Error('no mug shot of a merc at home');
    await loadStubImage(t, kit, faceFileOf(profile.faceIndex));
    await click(t, mug.id.replace('mugName', 'mugRegion'));
    expect(h.screen.shell.mode).toBe(LaptopMode.AIM_MEMBERS);
    await click(t, 'aimContact');
    expect(await blinks(h)).toBe(true);
    expect(shown(t, 'hire').visible).toBe(true);
  });
});

describe('M.E.R.C. on the canvas laptop', () => {
  it("plays Speck's opening, opens an account, hires from the files, pays the bill and shows the broken link while the site is down", async () => {
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
  });
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
  it('refuses a bad code, creates a character through every page without overlapping voice samples and charges the profile', async () => {
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
    const samples = () => t.sounds.sounds.filter((s) => 'file' in s.request && s.request.file.startsWith('speech/'));
    const [entrySample] = samples();
    expect(entrySample?.active).toBe(true);
    await click(t, 'impVoiceSilhouette');
    expect(samples()).toHaveLength(1);
    await click(t, 'impVoiceNext');
    expect(shown(t, 'impVoiceIndex').text).toMatch(/ 2$/);
    expect(entrySample?.stopped).toBe(true);
    expect(samples()).toHaveLength(2);
    samples()[1]?.end();
    await click(t, 'impVoiceSilhouette');
    expect(samples()).toHaveLength(3);
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

    const reply = h.replies[h.commands.findIndex((c) => c.type === 'impCreate')];
    const profile = (reply?.data as { profile?: number } | undefined)?.profile ?? -1;
    const face = h.session.campaign.state.laptop.imp.profiles.get(profile)?.faceIndex ?? -1;
    if (find(t, 'newMailOk')?.visible) await click(t, 'newMailOk');
    h.requestedImages.length = 0;
    await click(t, 'personnelButton');
    await settle(t, 12);
    expect(h.screen.shell.mode).toBe(LaptopMode.PERSONNEL);
    expect(h.requestedImages).toContain(portraitPath(face, 'small'));
    expect(h.requestedImages).toContain(portraitPath(face, 'big'));
    expect(h.requestedImages).not.toContain(portraitPath(profile, 'small'));
  });
});

describe('I.M.P. with its specialties picked directly (imp_pick_skills_directly)', () => {
  it('picks the specialties on their own page, adds their bonus to the attribute pool and sends them as skills', async () => {
    const read = withImpPolicy(kit.read, { pick_skills_directly: true });
    const h = await openLaptopHarness(kit, ui, { seed: 24, prepare: bookmark(Bookmark.IMP), read });
    const { t } = h;
    await toBookmark(h, 1);
    await waitFor(h, 'impHomeTitle');
    await click(t, 'impCode');
    await type(t, 'XEP624');
    await key(t, 'Enter', 'up');
    await waitFor(h, 'impMainTitle');
    await clickThrough(h, 'impBegin', 'impBeginTitle');
    await click(t, 'impFullName');
    await type(t, 'Ivan Testov');
    await click(t, 'impMaleBox');
    await clickThrough(h, 'impBeginDone', 'impMainTitle');

    await clickThrough(h, 'impProfile0', 'impPersonalityTitle');
    await clickThrough(h, 'impPersonalityBegin', 'impSkillTraitsTitle');
    expect(shown(t, 'impSpecialty14').state).toBe(true);
    for (const specialty of [0, 2, 3]) await click(t, `impSpecialty${specialty}`);
    expect([0, 2, 3, 14].map((s) => shown(t, `impSpecialty${s}`).state)).toEqual([false, true, true, false]);
    await click(t, 'impSpecialty14');
    await click(t, 'impSpecialty2');
    await clickThrough(h, 'impSkillTraitsFinish', 'impMainTitle');
    expect(shown(t, 'impProfile1').enabled).toBe(true);

    await clickThrough(h, 'impProfile1', 'impAttributeEntranceTitle');
    await clickThrough(h, 'impAttributeEntranceBegin', 'impAttributesTitle');
    expect(shown(t, 'impBonusPoints').text).toBe('45');
    await clickThrough(h, 'impAttributesFinish', 'impAttributeFinishTitle');
    await clickThrough(h, 'impAttributesYes', 'impMainTitle');
    await clickThrough(h, 'impProfile2', 'impPortraitTitle');
    await clickThrough(h, 'impPortraitDone', 'impMainTitle');
    await clickThrough(h, 'impProfile3', 'impVoiceTitle');
    await clickThrough(h, 'impVoiceDone', 'impFinishName');
    await clickThrough(h, 'impFinishDone', 'impConfirmTitle');
    await click(t, 'impConfirmYes');
    await settle(t);

    const electronics = h.session.view().laptop?.imp.specialties[2];
    const created = h.commands.find((c) => c.type === 'impCreate') as Record<string, unknown> | undefined;
    expect(created?.skills).toEqual([electronics]);
    expect(created?.answers).toBeUndefined();
    const reply = h.replies[h.commands.findIndex((c) => c.type === 'impCreate')];
    expect(reply).toMatchObject({ ok: true, data: { skills: [electronics, 0] } });
  });
});

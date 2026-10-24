import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clickWidget,
  findWidget,
  type LaptopHarness,
  type LaptopUiKit,
  laptopUiKit,
  openLaptopHarness,
  openWebPage,
  settleLaptop,
  shownWidget,
} from '../../../../../tests/support/laptop-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../../tests/support/sectors.ts';
import type { LaptopCommand } from '../laptop-client.ts';
import { Bookmark, LaptopMode } from '../laptop-modes.ts';

const SCREEN_TEST_TIMEOUT_MS = 120_000;
const CONTRACT_DAYS = 7;
const NOT_INSURED = 'Not insured';
const SUBMITTING_CLAIM = 'Submitting a claim';
const COMMENTS_TITLE = 'Comments from our clients';
const FRAUD_RED = 163;
const BULLET = 'laptop/bullet.sti';

let kit: StubSectorKit;
let ui: LaptopUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await laptopUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

async function hiredLaptop(): Promise<LaptopHarness> {
  const probe = await openLaptopHarness(kit, ui);
  const available = probe
    .laptop()
    .aim.filter((a) => a.face === 'available')
    .map((a) => a.profile);
  const hire = available.slice(0, 2).map((profile) => ({ profile, contract: CONTRACT_DAYS }));
  return openLaptopHarness(kit, ui, { hire });
}

async function go(h: LaptopHarness, id: string, mode: number): Promise<void> {
  await clickWidget(h.t, id);
  await settleLaptop(h.t, 12);
  expect(h.screen.shell.mode).toBe(mode);
}

function insureCommands(commands: readonly LaptopCommand[]): LaptopCommand[] {
  return commands.filter((c) => c.type === 'insure');
}

describe('the insurance site', () => {
  it(
    'bookmarks the site, insures a merc from the contract page, pages the info and shows the comments',
    async () => {
      const h = await hiredLaptop();
      expect(h.laptop().bookmarks).not.toContain('insurance');
      await openWebPage(h, Bookmark.INSURANCE);
      expect(h.commands).toContainEqual({ type: 'visitSite', site: 'insurance' });
      expect(h.laptop().bookmarks).toContain('insurance');
      expect(shownWidget(h.t, 'insuranceSlogan').text).not.toBe('');
      expect(findWidget(h.t, 'insuranceTitleLink')?.visible ?? false).toBe(false);

      await go(h, 'insuranceContractLink', LaptopMode.INSURANCE_CONTRACT);
      const offer = h.laptop().insurance[0];
      if (!offer) throw new Error('nobody is insurable');
      expect(shownWidget(h.t, 'insuranceNickname0').text).toBe(offer.nickname);
      expect(shownWidget(h.t, 'insuranceStatus0').text).toBe(NOT_INSURED);
      expect(shownWidget(h.t, 'insuranceContractLength0').text).toBe(String(CONTRACT_DAYS));
      expect(shownWidget(h.t, 'insurancePremium0').text).toMatch(/^\$[\d,]+$/);
      expect(findWidget(h.t, 'insuranceNickname1')?.visible).toBe(true);
      expect(findWidget(h.t, 'insuranceNext')?.enabled).toBe(false);
      expect(findWidget(h.t, 'insurancePrev')?.enabled).toBe(false);
      expect(shownWidget(h.t, 'insuranceAccept0').enabled).toBe(true);
      await clickWidget(h.t, 'insuranceAccept0');
      expect(insureCommands(h.commands)).toEqual([{ type: 'insure', soldier: offer.soldier }]);
      expect(h.replies.at(-1)).toMatchObject({ ok: true });
      expect(h.laptop().insurance[0]?.insured).toBe(true);
      expect(shownWidget(h.t, 'insuranceStatus0').text).not.toBe(NOT_INSURED);

      await go(h, 'insuranceContractInfoLink', LaptopMode.INSURANCE_INFO);
      expect(shownWidget(h.t, 'insuranceInfoTocTitle').text).not.toBe('');
      expect(findWidget(h.t, 'insuranceInfoPrev')?.enabled).toBe(false);
      await clickWidget(h.t, 'insuranceInfoNext');
      expect(shownWidget(h.t, 'insuranceInfoTitle').text).toBe(SUBMITTING_CLAIM);
      expect(findWidget(h.t, 'insuranceInfoTocTitle')?.visible).toBe(false);
      expect(h.t.list.items.some((i) => i.kind === 'glyphs' && i.foreground === FRAUD_RED)).toBe(true);
      await clickWidget(h.t, 'insuranceInfoNext');
      expect(h.t.list.items.filter((i) => i.kind === 'image' && i.asset === BULLET)).toHaveLength(3);
      for (let page = 3; page < 5; page++) await clickWidget(h.t, 'insuranceInfoNext');
      expect(findWidget(h.t, 'insuranceInfoNext')?.enabled).toBe(false);
      await clickWidget(h.t, 'insuranceInfoPrev');
      expect(findWidget(h.t, 'insuranceInfoNext')?.enabled).toBe(true);

      await go(h, 'insuranceTitleLink', LaptopMode.INSURANCE);
      await go(h, 'insuranceCommentsLink', LaptopMode.INSURANCE_COMMENTS);
      expect(shownWidget(h.t, 'insuranceCommentsTitle').text).toBe(COMMENTS_TITLE);
      expect(h.t.list.items.filter((i) => i.kind === 'line').length).toBeGreaterThanOrEqual(14);
      await go(h, 'insuranceCommentsHomeLink', LaptopMode.INSURANCE);
    },
    SCREEN_TEST_TIMEOUT_MS,
  );

  it(
    'tells the player nobody can be insured and returns to the home page',
    async () => {
      const h = await openLaptopHarness(kit, ui);
      await openWebPage(h, Bookmark.INSURANCE);
      await go(h, 'insuranceContractLink', LaptopMode.INSURANCE_CONTRACT);
      await settleLaptop(h.t, 4);
      expect(h.t.runtime.host.modal).not.toBeNull();
      expect(h.laptop().aimMercsOnTeam).toBe(false);
      await clickWidget(h.t, 'messageBox.ok');
      await settleLaptop(h.t, 12);
      expect(h.screen.shell.mode).toBe(LaptopMode.INSURANCE);
    },
    SCREEN_TEST_TIMEOUT_MS,
  );
});

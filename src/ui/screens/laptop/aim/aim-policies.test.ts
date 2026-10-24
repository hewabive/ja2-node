import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clickWidget,
  findWidget,
  type LaptopUiKit,
  laptopUiKit,
  openLaptopHarness,
  openProgram,
  openWebPage,
  settleLaptop,
  shownWidget,
} from '../../../../../tests/support/laptop-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../../tests/support/sectors.ts';
import { Bookmark, LaptopMode } from '../laptop-modes.ts';
import { SubPageVisits } from './aim-history-support.ts';
import {
  POLICY_LAST_PAGE,
  POLICY_TOC_PAGE,
  PolicyMenu,
  policyMenuHeld,
  policyMenuTarget,
  sectionNumber,
  stackedTops,
} from './aim-policies.ts';

const SCREEN_TEST_TIMEOUT_MS = 120_000;

let kit: StubSectorKit;
let ui: LaptopUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await laptopUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

describe('the A.I.M. policies', () => {
  it('formats the section numbers like ST::format("{2.1f}") and "{2.2f}" and prints nothing for 0.0', () => {
    expect(sectionNumber(1.1, false)).toBe('1.1');
    expect(sectionNumber(2.11, true)).toBe('2.11');
    expect(sectionNumber(3.21, true)).toBe('3.21');
    expect(sectionNumber(9.4, false)).toBe('9.4');
    expect(sectionNumber(0, false)).toBe('');
  });

  it('stacks the paragraphs below the height of the last one', () => {
    expect(stackedTops([24, 12, 36], 154, 6)).toEqual([154, 184, 202]);
  });

  it('holds previous and index on the index page, next on the last page, and moves within the bounds', () => {
    expect(policyMenuHeld(POLICY_TOC_PAGE)).toEqual([true, false, true, false]);
    expect(policyMenuHeld(POLICY_LAST_PAGE)).toEqual([false, false, false, true]);
    expect(policyMenuHeld(5)).toEqual([false, false, false, false]);
    expect(policyMenuTarget(POLICY_TOC_PAGE, PolicyMenu.PREVIOUS)).toBeNull();
    expect(policyMenuTarget(2, PolicyMenu.PREVIOUS)).toBe(1);
    expect(policyMenuTarget(POLICY_TOC_PAGE, PolicyMenu.INDEX)).toBeNull();
    expect(policyMenuTarget(7, PolicyMenu.INDEX)).toBe(POLICY_TOC_PAGE);
    expect(policyMenuTarget(POLICY_LAST_PAGE, PolicyMenu.NEXT)).toBeNull();
    expect(policyMenuTarget(9, PolicyMenu.NEXT)).toBe(POLICY_LAST_PAGE);
  });

  it('loads a sub page slowly on the first visit and fast afterwards', () => {
    const visits = new SubPageVisits(3, true);
    expect(visits.visit(0)).toBe(true);
    expect(visits.visit(1)).toBe(false);
    expect(visits.visit(1)).toBe(true);
  });

  it(
    'agrees to the policies, opens a section from the index, pages through and keeps the page across a program switch',
    async () => {
      const h = await openLaptopHarness(kit, ui);
      await openWebPage(h, Bookmark.AIM);
      await clickWidget(h.t, 'policiesLink');
      expect(h.screen.shell.mode).toBe(LaptopMode.AIM_POLICIES);
      expect(shownWidget(h.t, 'aimPolicyStatementTitle').text).toBe('Statement of policy');
      expect(shownWidget(h.t, 'aimPolicyStatement1').text).toMatch(/^Policy clause 1\./);
      expect(findWidget(h.t, 'aimPolicyMenu0')?.visible).toBe(false);
      await clickWidget(h.t, 'aimPolicyAgreement1');
      expect(shownWidget(h.t, 'aimPolicyTitle').text).toBe('Statement of policy');
      expect(shownWidget(h.t, 'aimPolicyTocTitle2').text).toBe('3. Location of engagement');
      expect(shownWidget(h.t, 'aimPolicyMenu3').visible).toBe(true);
      await clickWidget(h.t, 'aimPolicyToc2');
      expect(shownWidget(h.t, 'aimPolicySectionTitle').text).toBe('3. Location of engagement');
      expect(shownWidget(h.t, 'aimPolicyNumber0').text).toBe('3.1');
      expect(shownWidget(h.t, 'aimPolicySubNumber2').text).toBe('3.21');
      expect(findWidget(h.t, 'aimPolicyToc0')?.visible ?? false).toBe(false);
      await clickWidget(h.t, `aimPolicyMenu${PolicyMenu.NEXT}`);
      expect(shownWidget(h.t, 'aimPolicySectionTitle').text).toBe('4. Contract extensions');
      await openProgram(h, 'emailButton');
      await clickWidget(h.t, 'webButton');
      await settleLaptop(h.t, 12);
      expect(h.screen.shell.mode).toBe(LaptopMode.AIM_POLICIES);
      expect(shownWidget(h.t, 'aimPolicySectionTitle').text).toBe('4. Contract extensions');
      await clickWidget(h.t, `aimPolicyMenu${PolicyMenu.INDEX}`);
      expect(shownWidget(h.t, 'aimPolicyTocTitle0').text).toBe('1. Definitions');
      await clickWidget(h.t, `aimPolicyMenu${PolicyMenu.HOME}`);
      expect(h.screen.shell.mode).toBe(LaptopMode.AIM);
    },
    SCREEN_TEST_TIMEOUT_MS,
  );

  it(
    'returns to the A.I.M. home page on disagree',
    async () => {
      const h = await openLaptopHarness(kit, ui);
      await openWebPage(h, Bookmark.AIM);
      await clickWidget(h.t, 'policiesLink');
      await clickWidget(h.t, 'aimPolicyAgreement0');
      expect(h.screen.shell.mode).toBe(LaptopMode.AIM);
    },
    SCREEN_TEST_TIMEOUT_MS,
  );
});

import { beforeEach, describe, expect, it } from 'vitest';
import { projectLayoutLoader, type TestRuntime, testRuntime } from '../../../../../tests/support/ui-runtime.ts';
import type { ImpSiteView } from '../../../../protocol/view.ts';
import { type DrawItem, rgb } from '../../../draw-list.ts';
import { LayoutScreen } from '../../../layout/layout-screen.ts';
import { ORIGINAL_SKIN } from '../../../layout/types.ts';
import { NO_TEXT } from '../../../text/text-service.ts';
import { messageBoxLabels } from '../../../widgets/message-box.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import { FEMALE, ImpDraft, MALE } from './imp-draft.ts';
import { beginPage, IMP_BEGIN_LAYOUT } from './imp-pages.ts';
import type { ImpContext } from './imp-site.ts';

const MALE_BOX_X = 305;
const FEMALE_BOX_X = 415;
const MALE_BOX_Y = 300;
const BOX_SIZE = 22;
const GREEN = rgb(0, 255, 0);
const BLACK = rgb(0, 0, 0);
const HALF_BLINK_MS = 500;
const NO_GENDER = -1;

interface BeginPageTest {
  readonly t: TestRuntime;
  readonly draft: ImpDraft;
  readonly popUps: number[];
  key(name: string): void;
  state(id: string): unknown;
  focusFrames(): DrawItem[];
}

async function openBeginPage(canCreate: boolean): Promise<BeginPageTest> {
  const t = await testRuntime();
  const draft = new ImpDraft();
  draft.acceptCode('XEP624');
  const popUps: number[] = [];
  const imp: ImpContext = {
    context: {} as LaptopContext,
    draft,
    site: () => ({ canCreate }) as ImpSiteView,
    impText: () => '',
    popUp: (index) => popUps.push(index),
    messageBox: () => undefined,
  };
  const page: LaptopPage = beginPage(imp);
  const layout = page.layouts[0];
  if (!layout) throw new Error('the begin page has no layout');
  const screen = new LayoutScreen({
    model: await projectLayoutLoader().load(ORIGINAL_SKIN, IMP_BEGIN_LAYOUT),
    controller: layout.controller,
    services: t.runtime,
    sliders: t.runtime.sliders,
    text: NO_TEXT,
    messageBoxStyle: () => {
      throw new Error('no message box on the begin page');
    },
    messageBoxLabels: messageBoxLabels(NO_TEXT),
    onUpdate: () => page.update(t.runtime.clock.ja2Now),
  });
  t.runtime.host.push(screen);
  t.frame();
  return {
    t,
    draft,
    popUps,
    key(name) {
      t.runtime.input({ kind: 'keyDown', key: name, code: '', modifiers: 0 });
      t.runtime.input({ kind: 'keyUp', key: name, code: '', modifiers: 0 });
      t.frame();
    },
    state: (id) => screen.describe().find((w) => w.id === id)?.state,
    focusFrames: () => t.list.items.filter((i) => i.kind === 'rectangle'),
  };
}

describe('the I.M.P. begin page focus', () => {
  let page: BeginPageTest;

  beforeEach(async () => {
    page = await openBeginPage(true);
  });

  it('takes Tab past the names to the gender boxes and frames the focused box in the caret blink', () => {
    expect(page.state('impFullName')).toBe('editing');
    expect(page.focusFrames()).toEqual([]);
    page.key('Tab');
    expect(page.state('impNickName')).toBe('editing');
    page.key('Tab');
    expect(page.state('impMaleFocus')).toBe('active');
    expect(page.state('impNickName')).toBe('inactive');
    const frame = { kind: 'rectangle', x1: MALE_BOX_X, y1: MALE_BOX_Y, x2: MALE_BOX_X + BOX_SIZE, y2: MALE_BOX_Y + BOX_SIZE };
    const first = page.focusFrames();
    expect(first).toMatchObject([frame]);
    page.t.frame(HALF_BLINK_MS);
    const second = page.focusFrames();
    expect(second).toMatchObject([frame]);
    expect(new Set([first[0], second[0]].map((r) => (r?.kind === 'rectangle' ? r.color : null)))).toEqual(new Set([GREEN, BLACK]));
    page.key('Tab');
    expect(page.focusFrames()).toMatchObject([{ x1: FEMALE_BOX_X, y1: MALE_BOX_Y }]);
    page.key('Tab');
    expect(page.state('impFullName')).toBe('editing');
    expect(page.focusFrames()).toEqual([]);
    expect(page.draft.genderFlag).toBe(NO_GENDER);
  });

  it('ticks the focused box with Space or Enter and gives the focus back to the full name', () => {
    page.key('Tab');
    page.key('Tab');
    page.key(' ');
    expect(page.draft.genderFlag).toBe(MALE);
    expect(page.state('impFullName')).toBe('editing');
    expect(page.state('impMaleFocus')).toBe('inactive');
    expect(page.focusFrames()).toEqual([]);
    page.key('Tab');
    page.key('Enter');
    expect(page.draft.genderFlag).toBe(MALE);
    expect(page.state('impFullName')).toBe('editing');
    for (let i = 0; i < 3; i++) page.key('Tab');
    page.key('Enter');
    expect(page.draft.genderFlag).toBe(FEMALE);
  });
});

describe('the I.M.P. begin page keys', () => {
  it('tick a gender box when no further I.M.P. can be created, where a click on the box does nothing', async () => {
    const page = await openBeginPage(false);
    const box = page.t.runtime.describe().find((w) => w.id === 'impMaleBox');
    if (!box) throw new Error('no male box');
    page.t.move(box.rect.x + 2, box.rect.y + 2);
    page.t.frame();
    page.t.click(box.rect.x + 2, box.rect.y + 2);
    page.t.frame();
    expect(page.draft.genderFlag).toBe(NO_GENDER);
    page.key('Tab');
    page.key('Tab');
    page.key('Enter');
    expect(page.draft.genderFlag).toBe(MALE);
  });
});

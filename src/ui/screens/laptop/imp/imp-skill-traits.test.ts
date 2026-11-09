import { describe, expect, it } from 'vitest';
import { projectLayoutLoader, type TestRuntime, testRuntime, uniformImage } from '../../../../../tests/support/ui-runtime.ts';
import { LayoutScreen } from '../../../layout/layout-screen.ts';
import { ORIGINAL_SKIN } from '../../../layout/types.ts';
import { NO_TEXT } from '../../../text/text-service.ts';
import { messageBoxLabels } from '../../../widgets/message-box.ts';
import type { WidgetInfo } from '../../../widgets/widget-info.ts';
import type { LaptopContext } from '../laptop-page.ts';
import { ImpDraft, ImpPage, ProfileMode, Specialty } from './imp-draft.ts';
import type { ImpContext } from './imp-site.ts';
import { IMP_SKILL_TRAITS_LAYOUT, skillTraitsPage } from './imp-skill-traits.ts';

const ELECTRONICS = 2;
const TEACHING = 5;
const BUTTON_ART: readonly (readonly [string, number, number])[] = [
  ['laptop/button_6.sti', 52, 35],
  ['laptop/button_5.sti', 135, 56],
];

interface SkillPageTest {
  readonly t: TestRuntime;
  readonly draft: ImpDraft;
  widget(id: string): WidgetInfo | undefined;
  press(id: string): void;
}

async function openSkillPage(male: boolean): Promise<SkillPageTest> {
  const t = await testRuntime();
  for (const [path, width, height] of BUTTON_ART) t.images.set(path, uniformImage(2, width, height));
  const draft = new ImpDraft();
  draft.male = male;
  draft.profileMode = ProfileMode.PERSONALITY;
  draft.page = ImpPage.SKILLTRAITS;
  const imp: ImpContext = {
    context: {} as LaptopContext,
    draft,
    site: () => null,
    impText: () => '',
    popUp: () => undefined,
    messageBox: () => undefined,
  };
  const page = skillTraitsPage(imp);
  const layout = page.layouts[0];
  if (!layout) throw new Error('the skill page has no layout');
  const screen = new LayoutScreen({
    model: await projectLayoutLoader().load(ORIGINAL_SKIN, IMP_SKILL_TRAITS_LAYOUT),
    controller: layout.controller,
    services: t.runtime,
    sliders: t.runtime.sliders,
    text: NO_TEXT,
    messageBoxStyle: () => {
      throw new Error('no message box on the skill page');
    },
    messageBoxLabels: messageBoxLabels(NO_TEXT),
    onUpdate: () => page.update(t.runtime.clock.ja2Now),
  });
  t.runtime.host.push(screen);
  t.frame();
  const widget = (id: string) => screen.describe().find((w) => w.id === id);
  return {
    t,
    draft,
    widget,
    press(id) {
      const w = widget(id);
      if (!w) throw new Error(`no ${id}`);
      const [x, y] = [w.rect.x + 2, w.rect.y + 2];
      t.move(x, y);
      t.frame();
      t.click(x, y);
      t.frame();
    },
  };
}

describe('the I.M.P. specialty page', () => {
  it('shows a press on a picked specialty as released while it stays picked, until a press changes the picks', async () => {
    const page = await openSkillPage(true);
    expect(page.widget(`impSpecialty${Specialty.NONE}`)?.state).toBe(true);
    page.press(`impSpecialty${ELECTRONICS}`);
    expect([page.widget(`impSpecialty${ELECTRONICS}`)?.state, page.widget(`impSpecialty${Specialty.NONE}`)?.state]).toEqual([true, false]);
    page.press(`impSpecialty${ELECTRONICS}`);
    expect(page.widget(`impSpecialty${ELECTRONICS}`)?.state).toBe(false);
    expect(page.draft.specialties[ELECTRONICS]).toBe(true);
    page.press(`impSpecialty${TEACHING}`);
    expect([page.widget(`impSpecialty${ELECTRONICS}`)?.state, page.widget(`impSpecialty${TEACHING}`)?.state]).toEqual([true, true]);
  });

  it('leaves Martial Arts out for a woman and keeps None where it is for a man', async () => {
    const man = await openSkillPage(true);
    const woman = await openSkillPage(false);
    expect(man.widget(`impSpecialty${Specialty.MARTIAL_ARTS}`)?.visible).toBe(true);
    expect(woman.widget(`impSpecialty${Specialty.MARTIAL_ARTS}`)).toBeUndefined();
    expect(woman.widget(`impSpecialty${Specialty.NONE}`)?.rect).toEqual(man.widget(`impSpecialty${Specialty.NONE}`)?.rect);
  });

  it('leaves for the main page as Finished is pressed down', async () => {
    const page = await openSkillPage(true);
    const finish = page.widget('impSkillTraitsFinish');
    if (!finish) throw new Error('no Finished button');
    page.t.move(finish.rect.x + 2, finish.rect.y + 2);
    page.t.frame();
    page.t.down(finish.rect.x + 2, finish.rect.y + 2);
    page.t.frame();
    expect([page.draft.page, page.draft.profileMode]).toEqual([ImpPage.MAIN, ProfileMode.ATTRIBUTES]);
  });
});

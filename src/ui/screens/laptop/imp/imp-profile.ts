// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/CharProfile.cc EnterCharProfile (iPreviousImpPage = -1, the texts opened), HandleCharProfile (a
// @src new page waits for the sub-page load, fast when visited, except the first page after entering), ExitOldIMPMode,
// @src EnterNewIMPMode, CreateIMPButtons (the cancel button on every page but home, about us, main and confirm),
// @src BtnIMPCancelCallback, InitIMPSubPageList, HasTheCurrentIMPPageBeenVisited; IMPVideoObjects.cc RenderProfileBackGround;
// @src src/game/Laptop/Laptop.cc GoToWebPage (IMP_BOOKMARK resets iCurrentImpPage), HandleLapTopHandles (no page handler
// @src while a load is pending).

import type { ControllerContract } from '../../../layout/controller.ts';
import { ViewModelController } from '../../../layout/controller.ts';
import type { CustomRenderer } from '../../../layout/view.ts';
import { type MessageBoxFlag, MessageBoxStyleId } from '../../../widgets/message-box.ts';
import { Bookmark } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage, PageLayout } from '../laptop-page.ts';
import { attributeFinishPage, attributesPage } from './imp-attributes.ts';
import { ImpPage } from './imp-draft.ts';
import { portraitPage, voicePage } from './imp-looks.ts';
import {
  aboutUsPage,
  attributeEntrancePage,
  beginPage,
  confirmPage,
  finishPage,
  homePage,
  mainPage,
  personalityEntrancePage,
} from './imp-pages.ts';
import { personalityFinishPage, quizPage } from './imp-quiz.ts';
import { IMP_POPUP_TEXT, IMP_TEXT_FILE, type ImpContext, type ImpPageFactory } from './imp-site.ts';

export const IMP_FRAME_LAYOUT = 'imp-frame';
const NO_PAGE = -1;

export const IMP_FRAME_CONTRACT: ControllerContract = { id: 'impFrame', actions: { cancel: {} }, bindings: { cancelShown: 'boolean' } };

const PAGE_FACTORIES: Readonly<Record<number, ImpPageFactory>> = {
  [ImpPage.HOME]: homePage,
  [ImpPage.ABOUT_US]: aboutUsPage,
  [ImpPage.MAIN]: mainPage,
  [ImpPage.BEGIN]: beginPage,
  [ImpPage.PERSONALITY]: personalityEntrancePage,
  [ImpPage.QUIZ]: quizPage,
  [ImpPage.PERSONALITY_FINISH]: personalityFinishPage,
  [ImpPage.ATTRIBUTE_ENTRANCE]: attributeEntrancePage,
  [ImpPage.ATTRIBUTE_PAGE]: attributesPage,
  [ImpPage.ATTRIBUTE_FINISH]: attributeFinishPage,
  [ImpPage.PORTRAIT]: portraitPage,
  [ImpPage.VOICE]: voicePage,
  [ImpPage.FINISH]: finishPage,
  [ImpPage.CONFIRM]: confirmPage,
};

const PAGES_WITHOUT_CANCEL: ReadonlySet<number> = new Set([ImpPage.HOME, ImpPage.ABOUT_US, ImpPage.MAIN, ImpPage.CONFIRM]);

function emptyPage(): LaptopPage {
  return { layouts: [], update: () => undefined };
}

function impContext(context: LaptopContext): ImpContext {
  const messageBox = (text: string, flags: MessageBoxFlag, onClose?: (result: number) => void) =>
    context.messageBox(text, flags, onClose, MessageBoxStyleId.IMP);
  return {
    context,
    draft: context.memory.imp,
    site: () => context.view()?.imp ?? null,
    impText: (record) => context.text.edt(IMP_TEXT_FILE, record) ?? '',
    popUp: (index, flags, onClose) => messageBox(context.string(IMP_POPUP_TEXT, index), flags, onClose),
    messageBox,
  };
}

export function charProfilePage(context: LaptopContext): LaptopPage {
  const imp = impContext(context);
  const draft = imp.draft;
  if (context.shell.enteredFromBookmark === Bookmark.IMP) draft.enterFromBookmark();
  void context.media.loadTexts([IMP_TEXT_FILE]);
  const visited = context.sites.impVisited;
  const frameModel: Record<string, unknown> = { cancelShown: false };
  const frame = new ViewModelController(IMP_FRAME_CONTRACT, frameModel, { cancel: () => draft.cancel() });
  let shown = NO_PAGE;
  let sub: LaptopPage = emptyPage();
  let layouts: readonly PageLayout[] = [];
  let loadStarted = false;

  const enter = (page: number) => {
    sub.dispose?.();
    shown = page;
    sub = (PAGE_FACTORIES[page] ?? emptyPage)(imp);
    frameModel.cancelShown = !PAGES_WITHOUT_CANCEL.has(page);
    layouts = [{ name: IMP_FRAME_LAYOUT, controller: frame }, ...sub.layouts];
  };

  const switchPages = () => {
    if (draft.page === shown) return;
    if (!loadStarted) {
      const fast = visited.has(draft.page);
      visited.add(draft.page);
      if (shown !== NO_PAGE) {
        context.shell.startSubPageLoad(fast);
        loadStarted = true;
        return;
      }
    }
    if (context.shell.loading) return;
    loadStarted = false;
    enter(draft.page);
  };

  switchPages();
  return {
    get layouts(): readonly PageLayout[] {
      return layouts;
    },
    get custom(): Readonly<Record<string, CustomRenderer>> {
      return sub.custom ?? {};
    },
    update: (now) => {
      switchPages();
      if (!context.shell.loading) sub.update(now);
    },
    dispose: () => {
      sub.dispose?.();
      sub = emptyPage();
    },
  };
}

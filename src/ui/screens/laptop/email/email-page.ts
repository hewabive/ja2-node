// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/EMail.cc EnterEmail, HandleEmail, RenderEmail, DrawEmailSummary (read mails in MESSAGE_FONT,
// @src unread in FONT10ARIALBOLD, the subject cut to SUBJECT_WIDTH - 10, the date as "<day string> <day>"),
// @src EmailBtnCallBackPrimary/Secondary/Scroll (no list clicks while a mail is shown, a right click on a row asks to
// @src delete it, on an empty row it acts as the laptop's right click), BtnMessageXCallback, BtnDeleteCallback,
// @src BtnDeleteYesback/Noback, DeleteEmail, PrevListPage, NextListPage, PrevMailPage, NextMailPage,
// @src UpdateStatusOfNextPreviousButtons, DisplayEmailMessage, DisplayEmailMessageSubjectDateFromLines, DisplayDeleteNotice,
// @src DisplayNumberOfPagesToThisEmail, the sort button callbacks. See docs/28 §9.3.

import type { LaptopEmailView } from '../../../../protocol/view.ts';
import type { Area, DrawList } from '../../../draw-list.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { fontHeight } from '../../../text/bitmap-font.ts';
import { FontName } from '../../../text/fonts.ts';
import { IAN_WRAP_NO_SHADOW, ianDisplayWrappedString, ianWrappedStringHeight } from '../../../text/wrap.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import { lastListPage, MAX_MESSAGES_PAGE, MailOrder, MINUTES_PER_DAY, oldestUnread, pageLabel, type SortableMail } from './email-list.ts';
import { type EmailPages, emailPages, onlyOnePage, recordsOfPage } from './email-paging.ts';

export const EMAIL_LAYOUT = 'laptop-email';
const SENDER_NAMES = 'pSenderNameList';
const DAY_STRING = 'pDayStrings';
const IMP_RESULTS = 'IMP_EMAIL_PROFILE_RESULTS';
const READ_INDICATOR = 0;
const UNREAD_INDICATOR = 1;
const BLACK = 0;
const MESSAGE_FONT = FontName.FONT10ARIAL;
const BOLD_FONT = FontName.FONT10ARIALBOLD;
const SUBJECT_PREFIX = ' ';

export const EMAIL_CONTRACT: ControllerContract = {
  id: 'laptopEmail',
  actions: {
    sortRead: {},
    sortFrom: {},
    sortSubject: {},
    sortDate: {},
    prevList: {},
    nextList: {},
    openMail: { args: 1 },
    askDelete: { args: 1 },
    closeViewer: {},
    deleteCurrent: {},
    prevMailPage: {},
    nextMailPage: {},
    confirmDelete: {},
    cancelDelete: {},
    laptopLeftUp: {},
    laptopRightUp: {},
  },
  bindings: {
    rows: 'list',
    pageText: 'string',
    prevListEnabled: 'boolean',
    nextListEnabled: 'boolean',
    deleteBox: 'boolean',
    deleteRead: 'boolean',
    deleteUnread: 'boolean',
    viewer: 'list',
    viewerY: 'number',
    strips: 'number',
    lineHeight: 'number',
    stripsHeight: 'number',
    bottomFrame: 'number',
    multiPage: 'boolean',
    mailPageText: 'string',
    prevMailEnabled: 'boolean',
    nextMailEnabled: 'boolean',
    viewerSender: 'string',
    viewerDate: 'string',
    viewerSubject: 'string',
  },
};

interface Row {
  readonly present: boolean;
  readonly read: boolean;
  readonly unread: boolean;
  readonly indicator: number;
  readonly subject: string;
  readonly sender: string;
  readonly date: string;
}

interface OpenMail {
  readonly id: number;
  readonly mail: LaptopEmailView;
  records: readonly string[] | null;
  pages: EmailPages | null;
  page: number;
}

const EMPTY_ROW: Row = { present: false, read: false, unread: false, indicator: READ_INDICATOR, subject: '', sender: '', date: '' };

export function emailPage(context: LaptopContext): LaptopPage {
  const order = new MailOrder();
  const model: Record<string, unknown> = {};
  let page = context.memory.emailPage;
  let open: OpenMail | null = null;
  let toDelete: LaptopEmailView | null = null;
  let disposed = false;
  const fonts = context.services.fonts;
  const constant = (name: string) => context.constant(EMAIL_LAYOUT, name);
  const mails = (): LaptopEmailView[] => order.ordered(context.view()?.emails ?? []);
  const senderName = (mail: LaptopEmailView) => context.string(SENDER_NAMES, mail.sender);
  const sortable = (list: readonly LaptopEmailView[]): SortableMail[] =>
    list.map((m) => ({
      id: m.id,
      date: m.date.day * MINUTES_PER_DAY + m.date.hour * 60 + m.date.minute,
      sender: senderName(m),
      subject: SUBJECT_PREFIX + m.subject,
      read: m.read,
    }));
  const lastPage = () => lastListPage(mails().length);
  const clampPage = () => {
    if (page > lastPage()) page = lastPage();
    if (page < 0) page = 0;
    context.memory.emailPage = page;
  };

  const lineHeight = () => fontHeight(fonts.get(MESSAGE_FONT));

  const paginate = (mail: OpenMail): void => {
    const records = mail.records;
    if (!records) return;
    const font = fonts.get(MESSAGE_FONT);
    const bold = fonts.get(BOLD_FONT);
    const width = constant('MESSAGE_WIDTH');
    const gap = constant('MESSAGE_GAP');
    const heights = records.map((r) => ianWrappedStringHeight(width, gap, font, r, bold));
    mail.pages = emailPages(heights, mail.mail.type !== IMP_RESULTS, {
      lineHeight: fontHeight(font),
      gap,
      screenBottom: constant('LAPTOP_SCREEN_LR_Y'),
      viewerY: constant('VIEWER_Y'),
      bodyStartY: constant('VIEWER_MESSAGE_BODY_START_Y'),
    });
  };

  const openMail = (mail: LaptopEmailView): void => {
    const opened: OpenMail = { id: mail.id, mail, records: null, pages: null, page: 0 };
    open = opened;
    void context.command({ type: 'readEmail', id: mail.id });
    void context.command({ type: 'emailText', id: mail.id }).then((reply) => {
      if (disposed || open !== opened || !reply.ok) return;
      const data = reply.data as { subject?: string; paragraphs?: readonly string[] } | undefined;
      const paragraphs = data?.paragraphs ?? [];
      opened.records = mail.type === IMP_RESULTS ? paragraphs : [data?.subject ?? '', ...paragraphs];
      paginate(opened);
    });
  };

  const rowAt = (index: number): LaptopEmailView | undefined => mails()[page * MAX_MESSAGES_PAGE + index];

  const refresh = (): void => {
    const view = context.view();
    order.sync(view?.emails ?? []);
    clampPage();
    if (open && !mails().some((m) => m.id === open?.id)) open = null;
    if (toDelete && !mails().some((m) => m.id === toDelete?.id)) toDelete = null;
    const list = mails();
    const day = context.string(DAY_STRING);
    model.rows = Array.from({ length: MAX_MESSAGES_PAGE }, (_, i): Row => {
      const mail = list[page * MAX_MESSAGES_PAGE + i];
      if (!mail) return EMPTY_ROW;
      return {
        present: true,
        read: mail.read,
        unread: !mail.read,
        indicator: mail.read ? READ_INDICATOR : UNREAD_INDICATOR,
        subject: SUBJECT_PREFIX + mail.subject,
        sender: senderName(mail),
        date: `${day} ${mail.date.day}`,
      };
    });
    const label = pageLabel(page, lastPage());
    model.pageText = `${label.current} / ${label.last}`;
    model.prevListEnabled = page > 0;
    model.nextListEnabled = page < lastPage();
    model.deleteBox = toDelete !== null;
    model.deleteRead = toDelete?.read === true;
    model.deleteUnread = toDelete !== null && !toDelete.read;
    const shown = open?.pages ? open : null;
    model.viewer = shown ? [shown.id] : [];
    if (shown?.pages) {
      const pages = shown.pages;
      const h = lineHeight();
      model.viewerY = pages.viewerOffset;
      model.strips = pages.strips;
      model.lineHeight = h;
      model.stripsHeight = pages.strips * h;
      model.multiPage = !onlyOnePage(pages);
      model.bottomFrame = onlyOnePage(pages) ? 2 : 3;
      model.mailPageText = `${shown.page + 1} / ${pages.pageCount - 1}`;
      model.prevMailEnabled = shown.page !== 0;
      model.nextMailEnabled = pages.firstRecords[shown.page + 1] !== undefined;
      model.viewerSender = senderName(shown.mail);
      model.viewerDate = String(shown.mail.date.day);
      model.viewerSubject = SUBJECT_PREFIX + shown.mail.subject;
    }
  };

  const sort = (criterion: 'read' | 'sender' | 'subject' | 'received') => {
    order.sort(criterion, sortable(context.view()?.emails ?? []));
    clampPage();
  };

  const controller = new ViewModelController(EMAIL_CONTRACT, model, {
    sortRead: () => sort('read'),
    sortFrom: () => sort('sender'),
    sortSubject: () => sort('subject'),
    sortDate: () => sort('received'),
    prevList: () => {
      if (open || page === 0) return;
      page--;
      clampPage();
    },
    nextList: () => {
      if (open || page === lastPage()) return;
      page++;
      clampPage();
    },
    openMail: ([i]) => {
      if (open) return;
      const mail = rowAt(i ?? 0);
      if (mail) openMail(mail);
    },
    askDelete: ([i]) => {
      if (open) return;
      const mail = rowAt(i ?? 0);
      if (mail) toDelete = mail;
      else context.rightButtonUp();
    },
    closeViewer: () => {
      open = null;
    },
    deleteCurrent: () => {
      if (open) toDelete = open.mail;
    },
    prevMailPage: () => {
      if (open && open.page > 0) open.page--;
    },
    nextMailPage: () => {
      if (open?.pages && open.page + 1 < open.pages.pageCount - 1) open.page++;
    },
    confirmDelete: () => {
      const mail = toDelete;
      toDelete = null;
      open = null;
      if (mail) void context.command({ type: 'deleteEmail', id: mail.id });
    },
    cancelDelete: () => {
      toDelete = null;
    },
    laptopLeftUp: () => context.leftButtonUp(),
    laptopRightUp: () => context.rightButtonUp(),
  });

  const drawBody = (list: DrawList, rect: Area): void => {
    if (!open?.records || !open.pages) return;
    const font = fonts.get(MESSAGE_FONT);
    const bold = fonts.get(BOLD_FONT);
    const gap = constant('MESSAGE_GAP');
    let y = rect.y + fontHeight(font);
    for (const index of recordsOfPage(open.pages, open.page, open.records.length)) {
      const record = open.records[index] ?? '';
      y += ianDisplayWrappedString(list, rect.x, y, rect.width, gap, font, { foreground: BLACK, shadow: 0, background: 0 }, record, {
        bold,
        flags: IAN_WRAP_NO_SHADOW,
      });
    }
  };

  refresh();
  return {
    layouts: [{ name: EMAIL_LAYOUT, controller }],
    custom: { emailBody: drawBody },
    update: () => {
      if (context.takeOpenUnreadMailRequest()) {
        const id = oldestUnread(sortable(mails()));
        const mail = mails().find((m) => m.id === id);
        if (mail) openMail(mail);
      }
      refresh();
    },
    dispose: () => {
      disposed = true;
    },
    cancelPopup: () => {
      if (!toDelete) return false;
      toDelete = null;
      return true;
    },
    closeView: () => {
      if (!open) return false;
      open = null;
      return true;
    },
  };
}

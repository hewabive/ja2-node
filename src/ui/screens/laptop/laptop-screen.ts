// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Laptop.cc EnterLaptop (music LAPTOP is the server's music mode), LaptopScreenHandle (the opening
// @src zoom out of the map screen button with "laptop power up (8-11).wav"; the overlays after the page: bookmarks, the
// @src download box, the bookmark hint, the side texts, the title-bar slide, the lights), LeaveLapTopScreen (the closing
// @src zoom with "laptop power down (8-11).wav"), InitTitleBarMaximizeGraphics (the bar, the icon at +5, +2 and the title in
// @src FONT14ARIAL at +29, +8), HandleLapTopESCKey and HandleRightButtonUpEvent (the new-mail box, the delete box, the
// @src bookmarks, the open mail, in that order), NewEmailIconCallback (the oldest unread mail), NewFileIconCallback,
// @src DoLapTopMessageBox (MSG_BOX_LAPTOP_DEFAULT centred on the laptop screen), PrintDate, PrintNumberOnTeam,
// @src DisplayTaskBarIcons; src/game/Laptop/EMail.cc CreateDestroyNewMailButton, DisplayNewMailBox (hidden during the A.I.M.
// @src video conference and shown again after it, AIMMembers.cc DisableNewMailMessage).

import type { LaptopView } from '../../../protocol/view.ts';
import type { Area, DrawItem, DrawList } from '../../draw-list.ts';
import type { UiInputEvent } from '../../input/events.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { LayoutView } from '../../layout/view.ts';
import type { UiRuntime } from '../../runtime.ts';
import type { Screen } from '../../screen.ts';
import { FontName } from '../../text/fonts.ts';
import { mprint } from '../../text/print.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { UiScreenKind } from '../../widgets/button-sounds.ts';
import {
  MessageBox,
  type MessageBoxFlag,
  type MessageBoxLabels,
  type MessageBoxStyle,
  MessageBoxStyleId,
} from '../../widgets/message-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { AIM_ARCHIVES_LAYOUT, aimArchivesPage } from './aim/aim-archives.ts';
import { AIM_HISTORY_LAYOUT, aimHistoryPage } from './aim/aim-history.ts';
import { aimMemberPage } from './aim/aim-member.ts';
import { aimHomePage, aimIndexPage, aimLinksPage, aimSortPage } from './aim/aim-pages.ts';
import { AIM_POLICIES_LAYOUT, aimPoliciesPage } from './aim/aim-policies.ts';
import { AimSession } from './aim/aim-session.ts';
import { bobbyRayCataloguePage } from './bobby-ray/bobby-ray-catalogue.ts';
import { bobbyRayHomePage } from './bobby-ray/bobby-ray-home.ts';
import { bobbyRayOrderPage } from './bobby-ray/bobby-ray-order.ts';
import { bobbyRayShipmentsPage } from './bobby-ray/bobby-ray-shipments.ts';
import { emailPage } from './email/email-page.ts';
import { FILES_LAYOUT, filesPage } from './files/files-page.ts';
import { financesPage } from './finances/finances-page.ts';
import {
  FLORIST_CARDS_LAYOUT,
  FLORIST_CHROME_LAYOUT,
  FLORIST_GALLERY_LAYOUT,
  FLORIST_HOME_LAYOUT,
  FLORIST_ORDER_LAYOUT,
  floristCardsPage,
  floristGalleryPage,
  floristHomePage,
  floristOrderPage,
} from './florist/florist-pages.ts';
import { FUNERAL_LAYOUT, funeralPage } from './funeral/funeral-page.ts';
import { HISTORY_LAYOUT, historyPage } from './history/history-page.ts';
import { charProfilePage } from './imp/imp-profile.ts';
import {
  INSURANCE_CHROME_LAYOUT,
  INSURANCE_COMMENTS_LAYOUT,
  INSURANCE_CONTRACT_LAYOUT,
  INSURANCE_HOME_LAYOUT,
  INSURANCE_INFO_LAYOUT,
  insuranceCommentsPage,
  insuranceContractPage,
  insuranceHomePage,
  insuranceInfoPage,
} from './insurance/insurance-pages.ts';
import {
  DEFAULT_LAPTOP_SETTINGS,
  type LaptopClient,
  type LaptopData,
  type LaptopMedia,
  type LaptopMemory,
  type LaptopSettings,
  laptopMemory,
} from './laptop-client.ts';
import { BOOKMARK_IDS, Bookmark, LaptopMode, programTitle, VISITED_SITES, webPageTitleIndex } from './laptop-modes.ts';
import type { LaptopContext, LaptopPage, PageFactory, PageLayout } from './laptop-page.ts';
import { LaptopShell } from './laptop-shell.ts';
import { laptopSites } from './laptop-sites.ts';
import { TITLE_BAR_ITERATIONS, titleBarSlideRect, ZOOM_TIME, zoomPercentage, zoomRect } from './laptop-timers.ts';
import { brokenLinkPage, mercAccountPage, mercFilesPage, mercHomePage, mercNoAccountPage } from './merc/merc-pages.ts';
import { PERSONNEL_LAYOUT, personnelPage } from './personnel/personnel-page.ts';

export const LAPTOP_SCREEN = 'laptop';
export const LAPTOP_SHELL_LAYOUT = 'laptop';
export const LAPTOP_LAYOUTS: readonly string[] = [
  'laptop',
  'laptop-email',
  'laptop-finances',
  'aim-chrome',
  'aim-bar',
  'aim-home',
  'aim-sort',
  'aim-index',
  'aim-member',
  'aim-links',
  PERSONNEL_LAYOUT,
  HISTORY_LAYOUT,
  FILES_LAYOUT,
  INSURANCE_CHROME_LAYOUT,
  INSURANCE_HOME_LAYOUT,
  INSURANCE_INFO_LAYOUT,
  INSURANCE_CONTRACT_LAYOUT,
  INSURANCE_COMMENTS_LAYOUT,
  FLORIST_CHROME_LAYOUT,
  FLORIST_HOME_LAYOUT,
  FLORIST_GALLERY_LAYOUT,
  FLORIST_ORDER_LAYOUT,
  FLORIST_CARDS_LAYOUT,
  FUNERAL_LAYOUT,
  AIM_ARCHIVES_LAYOUT,
  AIM_POLICIES_LAYOUT,
  AIM_HISTORY_LAYOUT,
  'bobby-ray-home',
  'bobby-ray-catalogue',
  'bobby-ray-order',
  'bobby-ray-shipments',
  'merc-home',
  'merc-no-account',
  'merc-account',
  'merc-files',
  'broken-link',
  'imp-frame',
  'imp-home',
  'imp-about-us',
  'imp-main',
  'imp-begin',
  'imp-personality',
  'imp-quiz',
  'imp-personality-finish',
  'imp-attribute-entrance',
  'imp-attributes',
  'imp-attribute-finish',
  'imp-portrait',
  'imp-voice',
  'imp-finish',
  'imp-confirm',
];

const POWER_UP_SOUND = 'sounds/laptop power up (8-11).wav';
const POWER_DOWN_SOUND = 'sounds/laptop power down (8-11).wav';
const HIGH_VOLUME = 127;
const LIGHT_ON = 0;
const LIGHT_OFF = 1;
const HELP_TEXT = 'gzLaptopHelpText';
const NEW_MAIL_HELP = 7;
const NEW_FILE_HELP = 8;
const BOOKMARK_HELP_BASE = 9;
const BOOKMARK_STRINGS = 'pBookMarkStrings';
const WEB_TITLE = 'pWebTitle';
const WEB_PAGE_TITLES = 'pWebPagesTitles';
const DAY_NAME = 'gpGameClockString';
const PERSONNEL_STRING = 'pPersonnelString';
const SCREEN_WIDTH = 640;
const SCREEN_HEIGHT = 480;
const ZOOM_SOURCE = 'laptopZoom';
const SLIDE_SOURCE = 'laptopTitleSlide';
const SLIDE_ICON_DX = 5;
const SLIDE_ICON_DY = 2;
const SLIDE_TEXT_DX = 29;
const SLIDE_TEXT_DY = 8;
const SLIDE_START_X = 29;
const SLIDE_START_WIDTH = 20;
const BLACK = 0;

const PROGRAM_TITLES: Readonly<Record<number, string>> = {
  [LaptopMode.EMAIL]: 'pEmailTitleText',
  [LaptopMode.FINANCES]: 'pFinanceTitle',
  [LaptopMode.HISTORY]: 'pHistoryTitle',
  [LaptopMode.FILES]: 'pFilesTitle',
  [LaptopMode.PERSONNEL]: 'pPersTitleText',
};

export const LAPTOP_SHELL_CONTRACT: ControllerContract = {
  id: 'laptop',
  actions: {
    email: {},
    web: {},
    webSecondary: {},
    files: {},
    history: {},
    personnel: {},
    finances: {},
    power: {},
    openNewMail: {},
    openNewFile: {},
    minimize: {},
    bookmarkHover: { args: 2 },
    bookmarkSelect: { args: 1 },
    closeNewMail: {},
    laptopLeftUp: {},
    laptopRightUp: {},
    escape: {},
    tab: {},
    tabBack: {},
    quit: {},
    help: {},
  },
  bindings: {
    desktop: 'boolean',
    programBox: 'boolean',
    titleVisible: 'boolean',
    titleIcon: 'number',
    titleText: 'string',
    date: 'string',
    personnel: 'string',
    balance: 'number',
    mailIcon: 'boolean',
    fileIcon: 'boolean',
    mailIconHelp: 'string',
    fileIconHelp: 'string',
    powerLight: 'number',
    hdLight: 'number',
    minimizeVisible: 'boolean',
    bookmarksOpen: 'boolean',
    bookmarkRows: 'list',
    loading: 'boolean',
    downloading: 'boolean',
    reloading: 'boolean',
    segments: 'number',
    hint: 'boolean',
    boxVisible: 'boolean',
    newMailBox: 'boolean',
  },
};

const PAGES: Readonly<Record<number, PageFactory>> = {
  [LaptopMode.EMAIL]: emailPage,
  [LaptopMode.FINANCES]: financesPage,
  [LaptopMode.AIM]: aimHomePage,
  [LaptopMode.AIM_MEMBERS_SORTED_FILES]: aimSortPage,
  [LaptopMode.AIM_MEMBERS_FACIAL_INDEX]: aimIndexPage,
  [LaptopMode.AIM_MEMBERS]: aimMemberPage,
  [LaptopMode.AIM_LINKS]: aimLinksPage,
  [LaptopMode.AIM_MEMBERS_ARCHIVES]: aimArchivesPage,
  [LaptopMode.AIM_POLICIES]: aimPoliciesPage,
  [LaptopMode.AIM_HISTORY]: aimHistoryPage,
  [LaptopMode.PERSONNEL]: personnelPage,
  [LaptopMode.HISTORY]: historyPage,
  [LaptopMode.FILES]: filesPage,
  [LaptopMode.INSURANCE]: insuranceHomePage,
  [LaptopMode.INSURANCE_INFO]: insuranceInfoPage,
  [LaptopMode.INSURANCE_CONTRACT]: insuranceContractPage,
  [LaptopMode.INSURANCE_COMMENTS]: insuranceCommentsPage,
  [LaptopMode.FLORIST]: floristHomePage,
  [LaptopMode.FLORIST_FLOWER_GALLERY]: floristGalleryPage,
  [LaptopMode.FLORIST_ORDERFORM]: floristOrderPage,
  [LaptopMode.FLORIST_CARD_GALLERY]: floristCardsPage,
  [LaptopMode.FUNERAL]: funeralPage,
  [LaptopMode.BOBBY_R]: bobbyRayHomePage,
  [LaptopMode.BOBBY_R_GUNS]: bobbyRayCataloguePage(LaptopMode.BOBBY_R_GUNS),
  [LaptopMode.BOBBY_R_AMMO]: bobbyRayCataloguePage(LaptopMode.BOBBY_R_AMMO),
  [LaptopMode.BOBBY_R_ARMOR]: bobbyRayCataloguePage(LaptopMode.BOBBY_R_ARMOR),
  [LaptopMode.BOBBY_R_MISC]: bobbyRayCataloguePage(LaptopMode.BOBBY_R_MISC),
  [LaptopMode.BOBBY_R_USED]: bobbyRayCataloguePage(LaptopMode.BOBBY_R_USED),
  [LaptopMode.BOBBY_R_MAILORDER]: bobbyRayOrderPage,
  [LaptopMode.BOBBYR_SHIPMENTS]: bobbyRayShipmentsPage,
  [LaptopMode.MERC]: mercHomePage,
  [LaptopMode.MERC_NO_ACCOUNT]: mercNoAccountPage,
  [LaptopMode.MERC_ACCOUNT]: mercAccountPage,
  [LaptopMode.MERC_FILES]: mercFilesPage,
  [LaptopMode.BROKEN_LINK]: brokenLinkPage,
  [LaptopMode.CHAR_PROFILE]: charProfilePage,
};

const SITE_PAGES: Readonly<Record<number, number>> = {
  [LaptopMode.BOBBY_R]: Bookmark.BOBBYR,
  [LaptopMode.FUNERAL]: Bookmark.FUNERAL,
  [LaptopMode.FLORIST]: Bookmark.FLORIST,
  [LaptopMode.INSURANCE]: Bookmark.INSURANCE,
};

export interface LaptopScreenOptions {
  readonly runtime: UiRuntime;
  readonly layouts: ReadonlyMap<string, LayoutModel>;
  readonly text: UiTextService;
  readonly client: LaptopClient;
  readonly data: LaptopData;
  readonly media: LaptopMedia;
  readonly messageBoxStyle: (style: number) => MessageBoxStyle;
  readonly messageBoxLabels: MessageBoxLabels;
  readonly dataVersion: string;
  readonly settings?: LaptopSettings;
  readonly memory?: LaptopMemory;
  readonly zoomOnOpen?: boolean;
  readonly zoomOnClose?: boolean;
  readonly backdrop?: readonly DrawItem[];
  readonly onClosed?: () => void;
  readonly onQuitRequest?: () => void;
  readonly onHelp?: () => void;
}

interface ActivePage {
  readonly mode: number;
  readonly page: LaptopPage;
  views: readonly LayoutView[];
  layouts: readonly PageLayout[];
}

interface Zoom {
  readonly opening: boolean;
  readonly start: number;
}

export class LaptopScreen implements Screen {
  readonly id = LAPTOP_SCREEN;
  readonly soundScreen = UiScreenKind.LAPTOP;
  readonly rendersTooltips = true;
  readonly shell: LaptopShell;
  readonly #options: LaptopScreenOptions;
  readonly #runtime: UiRuntime;
  readonly #settings: LaptopSettings;
  readonly #memory: LaptopMemory;
  readonly #context: LaptopContext;
  readonly #model: Record<string, unknown> = {};
  #shellView: LayoutView | null = null;
  #page: ActivePage | null = null;
  #newMailBox = false;
  #newMailHeld = false;
  #lastNewMail: boolean | null = null;
  #openUnreadMail = false;
  #openUnreadFile = false;
  #highlighted = -1;
  #zoom: Zoom | null = null;
  #closing = false;
  #closed = false;
  #lastItems: readonly DrawItem[] = [];
  #frozen: readonly DrawItem[] | null = null;

  constructor(options: LaptopScreenOptions) {
    this.#options = options;
    this.#runtime = options.runtime;
    this.#settings = options.settings ?? DEFAULT_LAPTOP_SETTINGS;
    this.#memory = options.memory ?? laptopMemory();
    this.shell = new LaptopShell(
      {
        enterPage: (mode) => this.#enterPage(mode),
        exitPage: (mode) => this.#exitPage(mode),
        random: (range) => options.media.random(range),
        mercSiteDown: () => this.#view()?.merc.siteDown === true,
        mercSlowLoad: () => this.#view()?.merc.slowLoad === true,
      },
      {
        loadingTimeScale: this.#settings.loadingTimeScale,
        ...(this.#settings.slideStepMs === undefined ? {} : { slideStepMs: this.#settings.slideStepMs }),
      },
    );
    this.#context = this.#createContext();
  }

  get page(): LaptopPage | null {
    return this.#page?.page ?? null;
  }

  get newMailBox(): boolean {
    return this.#newMailBox;
  }

  #view(): LaptopView | null {
    return this.#options.client.laptop();
  }

  #string(table: string, index = 0): string {
    return this.#options.text.string(table, index) ?? '';
  }

  #layout(name: string): LayoutModel {
    const model = this.#options.layouts.get(name);
    if (!model) throw new Error(`the laptop layout ${name} is not loaded`);
    return model;
  }

  #createContext(): LaptopContext {
    return {
      client: this.#options.client,
      data: this.#options.data,
      text: this.#options.text,
      services: this.#runtime,
      settings: this.#settings,
      media: this.#options.media,
      shell: this.shell,
      aim: new AimSession(this.#memory.aim),
      memory: this.#memory,
      sites: laptopSites(),
      dataVersion: this.#options.dataVersion,
      view: () => this.#view(),
      command: (cmd) => this.#options.client.command(cmd),
      string: (table, index) => this.#string(table, index),
      messageBox: (text, flags, onClose, style) => this.#messageBox(text, flags, onClose, style),
      playSound: (file, volume) => this.#runtime.sounds.play({ file, volume }),
      openOldestUnreadMail: () => {
        this.#openUnreadMail = true;
      },
      takeOpenUnreadMailRequest: () => {
        const requested = this.#openUnreadMail;
        this.#openUnreadMail = false;
        return requested;
      },
      takeOpenUnreadFileRequest: () => {
        const requested = this.#openUnreadFile;
        this.#openUnreadFile = false;
        return requested;
      },
      constant: (layout, name) => this.#layout(layout).number(name),
      leftButtonUp: () => this.shell.leftButtonUp(),
      rightButtonUp: () => this.#rightButtonUp(),
    };
  }

  #messageBox(
    text: string,
    flags: MessageBoxFlag,
    onClose?: (result: number) => void,
    style: number = MessageBoxStyleId.LAPTOP_DEFAULT,
  ): void {
    const model = this.#layout(LAPTOP_SHELL_LAYOUT);
    const { stdX, stdY } = this.#runtime.geometry();
    const rect = {
      x: stdX + model.number('LAPTOP_SCREEN_UL_X'),
      y: stdY + model.number('LAPTOP_SCREEN_UL_Y'),
      width: model.number('LAPTOP_SCREEN_WIDTH'),
      height: model.number('LAPTOP_SCREEN_HEIGHT'),
    };
    this.#runtime.host.openModal(
      new MessageBox(this.#runtime, {
        style: this.#options.messageBoxStyle(style),
        text,
        flags,
        labels: this.#options.messageBoxLabels,
        centeringRect: rect,
        ...(onClose ? { onClose } : {}),
      }),
    );
  }

  #pageFactory(mode: number): PageFactory {
    const factory = PAGES[mode];
    if (factory) return factory;
    return () => ({ layouts: [], update: () => undefined });
  }

  #enterPage(mode: number): void {
    this.#exitPage(this.#page?.mode ?? LaptopMode.NONE);
    const site = SITE_PAGES[mode];
    const visited = site === undefined ? undefined : VISITED_SITES[site];
    if (visited) void this.#options.client.command({ type: 'visitSite', site: visited });
    const page = this.#pageFactory(mode)(this.#context);
    const layouts = page.layouts;
    this.#page = { mode, page, views: this.#buildViews(page, layouts), layouts };
  }

  #buildViews(page: LaptopPage, layouts: readonly PageLayout[]): LayoutView[] {
    const views = layouts.map(
      (layout) =>
        new LayoutView({
          model: this.#layout(layout.name),
          controller: layout.controller,
          services: this.#runtime,
          sliders: this.#runtime.sliders,
          text: this.#options.text,
          messageBoxStyle: this.#options.messageBoxStyle,
          messageBoxLabels: this.#options.messageBoxLabels,
          ...(page.custom ? { custom: page.custom } : {}),
        }),
    );
    for (const view of views) view.build();
    return views;
  }

  #syncPageLayouts(): void {
    const active = this.#page;
    if (!active || active.page.layouts === active.layouts) return;
    for (const view of active.views) view.dispose();
    active.layouts = active.page.layouts;
    active.views = this.#buildViews(active.page, active.layouts);
  }

  #exitPage(mode: number): void {
    const active = this.#page;
    if (!active || active.mode !== mode) return;
    active.page.dispose?.();
    for (const view of active.views) view.dispose();
    this.#page = null;
  }

  #rightButtonUp(): void {
    if (this.#newMailBox) this.#newMailBox = false;
    else if (this.#page?.page.cancelPopup?.()) return;
    else if (this.shell.showBookmarks) this.shell.showBookmarks = false;
    else if (this.#page?.page.closeView?.()) return;
    else this.shell.bookmarkHint = false;
  }

  #escape(): void {
    if (this.#newMailBox) this.#newMailBox = false;
    else if (this.#page?.page.cancelPopup?.()) return;
    else if (this.shell.escape()) return;
    else this.#requestExit();
  }

  #requestExit(): void {
    if (this.shell.exiting) return;
    this.shell.requestExit();
  }

  #shellController(): ViewModelController {
    const open = (mode: number) => () => this.shell.openProgram(mode);
    return new ViewModelController(LAPTOP_SHELL_CONTRACT, this.#model, {
      email: open(LaptopMode.EMAIL),
      web: () => this.shell.webPrimary(),
      webSecondary: () => this.shell.webSecondary(),
      files: open(LaptopMode.FILES),
      history: open(LaptopMode.HISTORY),
      personnel: open(LaptopMode.PERSONNEL),
      finances: open(LaptopMode.FINANCES),
      power: () => this.#requestExit(),
      openNewMail: () => {
        if ((this.#view()?.emails ?? []).some((m) => !m.read)) {
          this.#openUnreadMail = true;
          this.shell.setPage(LaptopMode.EMAIL);
        }
      },
      openNewFile: () => {
        if (!(this.#view()?.files ?? []).some((f) => !f.read)) return;
        this.#openUnreadFile = true;
        this.shell.setPage(LaptopMode.FILES);
      },
      minimize: () => this.shell.minimize(this.#runtime.clock.ja2Now),
      bookmarkHover: ([row, on]) => {
        if (on) this.#highlighted = row ?? -1;
        else if (this.#highlighted === row) this.#highlighted = -1;
      },
      bookmarkSelect: ([row]) => this.shell.selectBookmark(row ?? 0, this.#bookmarks()),
      closeNewMail: () => {
        this.#newMailBox = false;
      },
      laptopLeftUp: () => this.shell.leftButtonUp(),
      laptopRightUp: () => this.#rightButtonUp(),
      escape: () => this.#escape(),
      tab: () => this.shell.tab(false),
      tabBack: () => this.shell.tab(true),
      quit: () => this.#options.onQuitRequest?.(),
      help: () => this.#options.onHelp?.(),
    });
  }

  #bookmarks(): number[] {
    return (this.#view()?.bookmarks ?? []).flatMap((name) => {
      const id = BOOKMARK_IDS[name];
      return id === undefined ? [] : [id];
    });
  }

  #titleText(mode: number): string {
    const program = PROGRAM_TITLES[mode];
    if (program) return this.#string(program);
    const page = webPageTitleIndex(mode);
    const web = this.#string(WEB_TITLE);
    return page === null ? web : `${web}  -  ${this.#string(WEB_PAGE_TITLES, page)}`;
  }

  #refreshShell(): void {
    const view = this.#view();
    const shell = this.shell;
    const shown = shell.shownMode;
    const m = this.#model;
    m.desktop = shown === LaptopMode.NONE || shown === LaptopMode.WWW;
    m.programBox = shown !== LaptopMode.NONE;
    m.titleVisible = shown !== LaptopMode.NONE;
    m.titleIcon = programTitle(shown)?.icon ?? 0;
    m.titleText = this.#titleText(shown);
    const clock = this.#options.client.clock();
    m.date = clock
      ? `${this.#string(DAY_NAME)} ${clock.day}, ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`
      : '';
    m.personnel = `${this.#string(PERSONNEL_STRING)} ${this.#options.client.strategic()?.mercs.length ?? 0}`;
    m.balance = view?.balance ?? 0;
    m.mailIcon = (view?.emails ?? []).some((mail) => !mail.read);
    m.fileIcon = (view?.files ?? []).some((file) => !file.read);
    m.mailIconHelp = m.mailIcon ? this.#string(HELP_TEXT, NEW_MAIL_HELP) : '';
    m.fileIconHelp = m.fileIcon ? this.#string(HELP_TEXT, NEW_FILE_HELP) : '';
    m.powerLight = shell.powerLight ? LIGHT_ON : LIGHT_OFF;
    m.hdLight = shell.hdLight ? LIGHT_ON : LIGHT_OFF;
    m.minimizeVisible = shell.mode !== LaptopMode.NONE && !shell.exiting;
    m.bookmarksOpen = shell.showBookmarks && !shell.animating;
    const bookmarks = this.#bookmarks();
    m.bookmarkRows = [...bookmarks, Bookmark.CANCEL].map((id, row) => ({
      text: this.#string(BOOKMARK_STRINGS, id),
      highlighted: row === this.#highlighted,
      help: id === Bookmark.CANCEL ? '' : this.#string(HELP_TEXT, BOOKMARK_HELP_BASE + id),
    }));
    const load = shell.loading ? shell.load : null;
    m.loading = load !== null && !this.#newMailBox;
    m.downloading = load !== null && !load.speed.fast && !this.#newMailBox;
    m.reloading = load?.speed.fast === true && !this.#newMailBox;
    m.segments = load ? load.segments() : 0;
    m.hint = shell.bookmarkHint;
    m.boxVisible = m.loading === true || shell.bookmarkHint;
    m.newMailBox = this.#newMailBox;
  }

  #syncNewMail(): void {
    const flag = this.#view()?.newMail ?? null;
    if (flag !== null && flag !== this.#lastNewMail) {
      if (flag) this.#newMailBox = true;
      this.#lastNewMail = flag;
    }
    const blocked = this.#page?.page.blocksNewMail?.() === true;
    if (blocked && this.#newMailBox) {
      this.#newMailHeld = true;
      this.#newMailBox = false;
    } else if (!blocked && this.#newMailHeld) {
      this.#newMailHeld = false;
      this.#newMailBox = true;
    }
  }

  enter(): void {
    const shellModel = this.#layout(LAPTOP_SHELL_LAYOUT);
    this.#shellView = new LayoutView({
      model: shellModel,
      controller: this.#shellController(),
      services: this.#runtime,
      sliders: this.#runtime.sliders,
      text: this.#options.text,
      messageBoxStyle: this.#options.messageBoxStyle,
      messageBoxLabels: this.#options.messageBoxLabels,
      custom: { page: (list) => this.#renderPage(list), slide: () => undefined },
      owner: this,
    });
    this.#refreshShell();
    this.#shellView.build();
    if (this.#options.zoomOnOpen) {
      this.#zoom = { opening: true, start: this.#runtime.clock.now };
      this.#runtime.sounds.play({ file: POWER_UP_SOUND, volume: HIGH_VOLUME });
    }
  }

  exit(): void {
    this.#exitPage(this.#page?.mode ?? LaptopMode.NONE);
    this.#shellView?.dispose();
    this.#shellView = null;
  }

  #updateClose(now: number): void {
    if (!this.shell.exited || this.#closing) return;
    this.#closing = true;
    void this.#options.client.command({ type: 'closeLaptop' });
    if (this.#options.zoomOnClose) {
      this.#zoom = { opening: false, start: now };
      this.#runtime.sounds.play({ file: POWER_DOWN_SOUND, volume: HIGH_VOLUME });
    } else this.#finishClose();
  }

  #finishClose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#options.onClosed?.();
  }

  update(now: number): void {
    const ja2Now = this.#runtime.clock.ja2Now;
    if (this.#zoom) {
      if (now - this.#zoom.start >= ZOOM_TIME) {
        const closing = !this.#zoom.opening;
        this.#zoom = null;
        if (closing) this.#finishClose();
      }
      if (this.#zoom || this.#closed) return;
    }
    this.shell.update(ja2Now);
    this.#updateClose(now);
    this.#page?.page.update(ja2Now);
    this.#syncPageLayouts();
    this.#syncNewMail();
    this.#refreshShell();
    this.#shellView?.update();
    for (const view of this.#page?.views ?? []) view.update();
  }

  input(event: UiInputEvent): boolean {
    if (this.#zoom || this.shell.exiting) return true;
    for (const view of [...(this.#page?.views ?? [])].reverse()) if (view.input(event)) return true;
    return this.#shellView?.input(event) ?? false;
  }

  #renderPage(list: DrawList): void {
    for (const view of this.#page?.views ?? []) view.render(list);
  }

  #renderBase(list: DrawList): void {
    this.#shellView?.render(list);
  }

  #slideTitle(list: DrawList): void {
    const slide = this.shell.slide;
    if (!slide) return;
    const model = this.#layout(LAPTOP_SHELL_LAYOUT);
    const { stdX, stdY } = this.#runtime.geometry();
    const left = model.number('LAPTOP_TITLE_BAR_TOP_LEFT_X');
    const top = model.number('LAPTOP_TITLE_BAR_TOP_LEFT_Y');
    const width = model.number('LAPTOP_TITLE_BAR_WIDTH');
    const height = model.number('LAPTOP_TITLE_BAR_HEIGHT');
    const x = stdX + left;
    const y = stdY + top;
    list.image(model.asset('titleBar').path, 0, x, y);
    list.image(model.asset('titleIcons').path, slide.title.icon, x + SLIDE_ICON_DX, y + SLIDE_ICON_DY);
    const font = this.#runtime.fonts.get(FontName.FONT14ARIAL);
    const title = this.#string(
      slide.forward ? slide.title.title.table : slide.title.minimizedTitle.table,
      slide.forward ? slide.title.title.index : slide.title.minimizedTitle.index,
    );
    mprint(list, font, x + SLIDE_TEXT_DX, y + SLIDE_TEXT_DY, title, {
      foreground: model.color('FONT_MCOLOR_WHITE', 0),
      shadow: model.color('DEFAULT_SHADOW', 0),
      background: BLACK,
    });
    list.capture(SLIDE_SOURCE);
    if (this.#frozen) list.items.push(...this.#frozen);
    const step = Math.max(0, Math.min(TITLE_BAR_ITERATIONS, slide.step));
    const rect = titleBarSlideRect(
      {
        startX: SLIDE_START_X,
        startRightX: SLIDE_START_X + SLIDE_START_WIDTH,
        startY: slide.startY,
        endX: left,
        endRightX: model.number('LAPTOP_TITLE_BAR_TOP_RIGHT_X'),
        endY: top,
        height,
      },
      step,
    );
    list.snapshot(SLIDE_SOURCE, { x, y, width, height }, { x: stdX + rect.x, y: stdY + rect.y, width: rect.width, height: rect.height });
  }

  #renderZoom(list: DrawList, zoom: Zoom): void {
    const { width, height, stdX, stdY } = this.#runtime.geometry();
    list.capture(ZOOM_SOURCE);
    if (this.#options.backdrop) list.items.push(...this.#options.backdrop);
    else list.fill(0, 0, width, height, BLACK);
    const rect: Area = zoomRect(zoomPercentage(this.#runtime.clock.now - zoom.start, zoom.opening));
    list.snapshot(
      ZOOM_SOURCE,
      { x: stdX, y: stdY, width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
      { x: stdX + rect.x, y: stdY + rect.y, width: rect.width, height: rect.height },
    );
  }

  render(list: DrawList): void {
    if (this.shell.slide) {
      this.#frozen ??= this.#lastItems;
      list.items.push(...this.#frozen);
      this.#slideTitle(list);
      return;
    }
    this.#frozen = null;
    const start = list.items.length;
    this.#renderBase(list);
    this.#page?.page.renderOverlay?.(list, (l) => this.#renderBase(l));
    this.#lastItems = list.items.slice(start);
    if (this.#zoom) this.#renderZoom(list, this.#zoom);
  }

  describe(): readonly WidgetInfo[] {
    return [...(this.#shellView?.describe() ?? []), ...(this.#page?.views ?? []).flatMap((v) => v.describe())];
  }
}

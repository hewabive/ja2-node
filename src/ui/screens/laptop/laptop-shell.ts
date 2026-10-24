// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Laptop.cc EnterLaptop (the desktop, the session resets), LaptopScreenHandle (the order of the
// @src frame: sub-site waits, bookmark status, mode changes, the load, the bookmark hint, the title-bar slide, the HD light,
// @src the exit), EnterNewLaptopMode (maximizing a minimized program first, the WWW mode, the first browser use shows
// @src the bookmarks), the side button callbacks, WWWRegionButtonCallbackPrimary/Secondary, GoToWebPage (the broken link,
// @src the fast reload of a visited bookmark), BookmarkCallBack, HandleWWWSubSites (the A.I.M. members and mug shots skip
// @src the wait), UpdateStatusOfDisplayingBookMarks, HandleLapTopESCKey, HandleRightButtonUpEvent, HandleLeftButtonUpEvent,
// @src LaptopMinimizeProgramButtonCallback, LaptopProgramIconMinimizeCallback, FindLastProgramStillOpen,
// @src UpdateListToReflectNewProgramOpened, SetCurrentToLastProgramOpened, HandleWebBookMarkNotifyTimer, FlickerHDLight,
// @src ExitLaptopDone, HandleAltTabKeyInLaptop, HandleShiftAltTabKeyInLaptop; giCurrentSubPage (reset by EnterLaptop and by
// @src every move between web pages) and the sub-page loads of ChangingAimHistorySubPage, ChangingAimPoliciesSubPage,
// @src ChangingAimArchiveSubPage, ChangingFloristGallerySubPage and ChangingInsuranceInfoSubPage. See docs/28 §9.1.

import {
  BOOKMARK_MODES,
  Bookmark,
  isWebMode,
  LAPTOP_PROGRAMS,
  LaptopMode,
  LaptopProgram,
  type ProgramTitle,
  programTitle,
  SLIDE_START_Y,
  tabTarget,
} from './laptop-modes.ts';
import {
  BOOKMARK_NOTIFY_TIME,
  DEFAULT_SLIDE_STEP_MS,
  EXIT_LAPTOP_DELAY_TIME,
  FLICKER_TIME,
  HD_FLICKER_TIME,
  LoadPending,
  slideFinished,
  slideStep,
} from './laptop-timers.ts';

const MINIMIZED = 0;
const OPEN = 1;
const NO_HIGHLIGHT = -1;
const HD_FLICKER_CHOICES = 2;

export interface ShellPorts {
  enterPage(mode: number): void;
  exitPage(mode: number): void;
  random(range: number): number;
  mercSiteDown(): boolean;
  mercSlowLoad(): boolean;
}

export interface ShellOptions {
  readonly loadingTimeScale: number;
  readonly slideStepMs?: number;
}

export interface TitleSlide {
  readonly forward: boolean;
  readonly program: number;
  readonly title: ProgramTitle;
  readonly startY: number;
  readonly startedAt: number;
  step: number;
}

export class LaptopShell {
  mode: number = LaptopMode.NONE;
  previousMode: number = LaptopMode.NONE;
  wwwMode: number = LaptopMode.NONE;
  showBookmarks = false;
  bookmarkHint = false;
  highlightedBookmark = NO_HIGHLIGHT;
  powerLight = true;
  hdLight = false;
  load: LoadPending | null = null;
  slide: TitleSlide | null = null;
  subPage = 0;
  exiting = false;
  exited = false;
  readonly programStates: number[] = new Array<number>(LAPTOP_PROGRAMS).fill(MINIMIZED);
  readonly #queue: number[] = new Array<number>(LAPTOP_PROGRAMS).fill(1);
  readonly #visitedBookmarks = new Set<number>();
  readonly #visitedSubSites = new Set<number>();
  readonly #ports: ShellPorts;
  readonly #options: ShellOptions;
  #firstTimeInLaptop = true;
  #doneLoad = false;
  #lastExitedMode: number = LaptopMode.NONE;
  #enteredBySlide = false;
  #hintStart: number | null = null;
  #hintHeld = false;
  #flicker = false;
  #flickerBase: number | null = null;
  #flickerTotal = 0;
  #exitStart: number | null = null;
  #now = 0;

  constructor(ports: ShellPorts, options: ShellOptions) {
    this.#ports = ports;
    this.#options = options;
  }

  get maximizing(): boolean {
    return this.slide?.forward === true;
  }

  get minimizing(): boolean {
    return this.slide?.forward === false;
  }

  get animating(): boolean {
    return this.slide !== null;
  }

  get loading(): boolean {
    return this.load !== null && !this.load.done;
  }

  get shownMode(): number {
    return this.loading ? this.previousMode : this.mode;
  }

  #updateQueue(program: number): void {
    for (let i = 0; i < LAPTOP_PROGRAMS; i++) this.#queue[i] = (this.#queue[i] ?? 0) + 1;
    this.#queue[program] = 1;
  }

  openProgram(mode: number): void {
    const program = programTitle(mode)?.program;
    if (program === undefined) return;
    this.showBookmarks = false;
    this.mode = mode;
    this.#updateQueue(program);
  }

  webPrimary(): void {
    if (this.mode < LaptopMode.WWW) {
      this.showBookmarks = false;
      this.bookmarkHint = true;
    } else this.showBookmarks = !this.showBookmarks;
    this.mode = this.wwwMode === LaptopMode.NONE ? LaptopMode.WWW : this.wwwMode;
    this.#updateQueue(LaptopProgram.WEB_BROWSER);
  }

  webSecondary(): void {
    this.mode = this.wwwMode === LaptopMode.NONE ? LaptopMode.WWW : this.wwwMode;
  }

  goToWebPage(bookmark: number): void {
    const target = BOOKMARK_MODES[bookmark];
    if (target === undefined) return;
    this.showBookmarks = false;
    const page = bookmark === Bookmark.MERC && this.#ports.mercSiteDown() ? LaptopMode.BROKEN_LINK : target;
    this.wwwMode = page;
    this.mode = page;
    const fast = this.#visitedBookmarks.has(bookmark);
    this.#visitedBookmarks.add(bookmark);
    this.load = new LoadPending(
      { fast, subPage: false, slowSite: page === LaptopMode.MERC && this.#ports.mercSlowLoad() },
      this.#options.loadingTimeScale,
    );
  }

  selectBookmark(row: number, bookmarks: readonly number[]): void {
    if (this.loading) return;
    const bookmark = bookmarks[row];
    if (bookmark === undefined) {
      this.showBookmarks = false;
      return;
    }
    this.goToWebPage(bookmark);
  }

  setPage(mode: number): void {
    this.mode = mode;
  }

  #lastOpenProgram(): number {
    let lowest = LAPTOP_PROGRAMS;
    let found = LAPTOP_PROGRAMS;
    for (let i = 0; i < LAPTOP_PROGRAMS; i++) {
      if (this.programStates[i] === MINIMIZED) continue;
      const value = this.#queue[i] ?? LAPTOP_PROGRAMS;
      if (value < lowest) {
        lowest = value;
        found = i;
      }
    }
    return found;
  }

  #setCurrentToLastProgramOpened(): void {
    const PROGRAM_MODES: Readonly<Record<number, number>> = {
      [LaptopProgram.HISTORY]: LaptopMode.HISTORY,
      [LaptopProgram.MAILER]: LaptopMode.EMAIL,
      [LaptopProgram.PERSONNEL]: LaptopMode.PERSONNEL,
      [LaptopProgram.FINANCES]: LaptopMode.FINANCES,
      [LaptopProgram.FILES]: LaptopMode.FILES,
    };
    const program = this.#lastOpenProgram();
    if (program === LaptopProgram.WEB_BROWSER) {
      this.mode = this.wwwMode === LaptopMode.NONE ? LaptopMode.WWW : this.wwwMode;
      this.bookmarkHint = true;
      return;
    }
    this.mode = PROGRAM_MODES[program] ?? LaptopMode.NONE;
  }

  minimize(now: number): void {
    const title = programTitle(this.mode);
    if (!title || this.animating) return;
    if (title.program === LaptopProgram.WEB_BROWSER) {
      this.showBookmarks = false;
      this.bookmarkHint = false;
    }
    this.programStates[title.program] = MINIMIZED;
    this.#setCurrentToLastProgramOpened();
    this.slide = { forward: false, program: title.program, title, startY: this.#slideY(title.program, false), startedAt: now, step: 0 };
  }

  #slideY(program: number, forward: boolean): number {
    const y = SLIDE_START_Y[program];
    return y ? (forward ? y.maximize : y.minimize) : 0;
  }

  escape(): boolean {
    if (this.showBookmarks) {
      this.showBookmarks = false;
      return true;
    }
    return false;
  }

  rightButtonUp(): boolean {
    if (this.showBookmarks) {
      this.showBookmarks = false;
      return true;
    }
    this.bookmarkHint = false;
    return false;
  }

  leftButtonUp(): void {
    if (this.showBookmarks) this.showBookmarks = false;
    else if (this.bookmarkHint) this.bookmarkHint = false;
  }

  tab(backwards: boolean): void {
    if (this.maximizing) return;
    this.mode = tabTarget(this.mode, backwards);
  }

  requestExit(): void {
    if (this.exiting) return;
    this.exiting = true;
    this.showBookmarks = false;
  }

  #exitPage(mode: number): void {
    if (this.#lastExitedMode === mode) return;
    this.#ports.exitPage(mode);
    this.#lastExitedMode = mode;
  }

  #handleSubSites(): void {
    if (this.mode === this.previousMode || this.mode < LaptopMode.WWW || this.loading || this.#doneLoad) return;
    if (this.previousMode < LaptopMode.WWW) return;
    const between =
      (this.mode === LaptopMode.AIM_MEMBERS && this.previousMode === LaptopMode.AIM_MEMBERS_FACIAL_INDEX) ||
      (this.mode === LaptopMode.AIM_MEMBERS_FACIAL_INDEX && this.previousMode === LaptopMode.AIM_MEMBERS);
    if (between) {
      this.#visitedSubSites.add(LaptopMode.AIM_MEMBERS);
      this.#visitedSubSites.add(LaptopMode.AIM_MEMBERS_FACIAL_INDEX);
      return;
    }
    const fast = this.#visitedSubSites.has(this.mode);
    this.#visitedSubSites.add(this.mode);
    this.load = new LoadPending({ fast, subPage: true, slowSite: false }, this.#options.loadingTimeScale);
  }

  #enterNewMode(): void {
    if (this.exiting) return;
    this.#flicker = true;
    const title = programTitle(this.mode);
    if (title && this.programStates[title.program] === MINIMIZED) {
      if (!this.maximizing) this.#exitPage(this.previousMode);
      this.slide = {
        forward: true,
        program: title.program,
        title,
        startY: this.#slideY(title.program, true),
        startedAt: this.#now,
        step: 1,
      };
      this.programStates[title.program] = OPEN;
      return;
    }
    if (this.animating) return;
    if (!this.#enteredBySlide) this.#exitPage(this.previousMode);
    if (this.wwwMode === LaptopMode.NONE && this.mode >= LaptopMode.WWW) this.mode = LaptopMode.WWW;
    else if (this.mode > LaptopMode.WWW) {
      if (this.previousMode < LaptopMode.WWW) this.mode = this.wwwMode;
      else {
        this.wwwMode = this.mode;
        this.subPage = 0;
      }
    }
    if (isWebMode(this.mode) && isWebMode(this.previousMode)) this.showBookmarks = false;
    this.#lastExitedMode = LaptopMode.NONE;
    this.#ports.enterPage(this.mode);
    if (this.#firstTimeInLaptop && isWebMode(this.mode)) {
      this.showBookmarks = true;
      this.#firstTimeInLaptop = false;
    }
    this.previousMode = this.mode;
    if (this.mode > LaptopMode.WWW) this.#visitedSubSites.add(this.mode);
  }

  #processModeChange(): void {
    if (this.mode === this.previousMode) return;
    if (this.mode <= LaptopMode.WWW) this.load = null;
    if (this.animating) return;
    if (this.mode <= LaptopMode.WWW || !this.loading) this.#enterNewMode();
  }

  #updateLoad(now: number): void {
    if (!this.load) {
      this.#doneLoad = false;
      return;
    }
    if (this.load.update(now)) {
      this.load = null;
      this.#doneLoad = true;
    }
  }

  #updateHint(now: number): void {
    if (this.animating) {
      this.#hintHeld ||= this.bookmarkHint;
      this.bookmarkHint = false;
      return;
    }
    this.bookmarkHint ||= this.#hintHeld;
    this.#hintHeld = false;
    if (this.mode < LaptopMode.WWW || this.showBookmarks) this.bookmarkHint = false;
    if (!this.bookmarkHint) {
      this.#hintStart = null;
      return;
    }
    if (this.#hintStart === null) {
      this.#hintStart = now;
      return;
    }
    if (now - this.#hintStart > BOOKMARK_NOTIFY_TIME) {
      this.#hintStart = null;
      this.bookmarkHint = false;
    }
  }

  #updateSlide(now: number): void {
    const slide = this.slide;
    if (!slide || this.exiting) return;
    const step = slideStep(slide.forward, now - slide.startedAt, this.#options.slideStepMs ?? DEFAULT_SLIDE_STEP_MS);
    if (!slideFinished(slide.forward, step)) {
      slide.step = step;
      return;
    }
    this.slide = null;
    if (slide.forward) {
      this.#enteredBySlide = true;
      this.#enterNewMode();
      this.#enteredBySlide = false;
    } else this.#enterNewMode();
  }

  #updateFlicker(now: number): void {
    if (this.loading) this.#flicker = true;
    if (!this.#flicker) return;
    if (this.#flickerBase === null) this.#flickerBase = now;
    const difference = now - this.#flickerBase;
    if (this.#flickerTotal > HD_FLICKER_TIME && !this.loading) {
      this.hdLight = false;
      this.#flickerBase = null;
      this.#flickerTotal = 0;
      this.#flicker = false;
      return;
    }
    if (difference > FLICKER_TIME) {
      this.#flickerTotal += difference;
      if (this.loading) this.#flickerTotal = 0;
      this.hdLight = this.#ports.random(HD_FLICKER_CHOICES) === 0;
      this.#flickerBase = now;
    }
  }

  #updateExit(now: number): void {
    if (!this.exiting || this.exited) return;
    this.powerLight = false;
    this.#exitStart ??= now;
    if (now - this.#exitStart > EXIT_LAPTOP_DELAY_TIME) {
      this.exited = true;
      this.#exitPage(this.shownMode);
    }
  }

  connectToSubPage(fast: boolean): void {
    this.load = new LoadPending({ fast, subPage: true, slowSite: false }, this.#options.loadingTimeScale);
  }

  update(now: number): void {
    this.#now = now;
    this.#handleSubSites();
    if (this.loading || this.mode < LaptopMode.WWW) this.showBookmarks = false;
    this.#processModeChange();
    this.#updateExit(now);
    this.#updateLoad(now);
    this.#updateHint(now);
    this.#updateSlide(now);
    this.#updateFlicker(now);
  }
}

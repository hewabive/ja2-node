import { describe, expect, it } from 'vitest';
import { Bookmark, LaptopMode, LaptopProgram } from './laptop-modes.ts';
import { LaptopShell, type ShellPorts } from './laptop-shell.ts';
import { EXIT_LAPTOP_DELAY_TIME, TITLE_BAR_ITERATIONS, UNIT_TIME } from './laptop-timers.ts';

const FRAME_MS = 16;
const OPEN = 1;
const MINIMIZED = 0;

interface Recorded extends ShellPorts {
  readonly entered: number[];
  readonly exited: number[];
  siteDown: boolean;
}

function ports(): Recorded {
  const recorded: Recorded = {
    entered: [],
    exited: [],
    siteDown: false,
    enterPage: (mode) => recorded.entered.push(mode),
    exitPage: (mode) => recorded.exited.push(mode),
    random: () => 0,
    mercSiteDown: () => recorded.siteDown,
    mercSlowLoad: () => false,
  };
  return recorded;
}

function run(shell: LaptopShell, from: number, until: number): number {
  let now = from;
  for (; now <= until; now += FRAME_MS) shell.update(now);
  return now;
}

function instantShell(p: ShellPorts): LaptopShell {
  return new LaptopShell(p, { loadingTimeScale: 1, slideStepMs: 0 });
}

describe('the laptop shell', () => {
  it('slides the title bar of a minimized program before entering it', () => {
    const p = ports();
    const shell = new LaptopShell(p, { loadingTimeScale: 1 });
    shell.update(0);
    expect(p.entered).toEqual([]);
    shell.openProgram(LaptopMode.EMAIL);
    shell.update(FRAME_MS);
    expect(shell.maximizing).toBe(true);
    expect(shell.programStates[LaptopProgram.MAILER]).toBe(OPEN);
    expect(p.exited).toEqual([]);
    run(shell, 2 * FRAME_MS, (TITLE_BAR_ITERATIONS - 1) * FRAME_MS);
    expect(p.entered).toEqual([]);
    run(shell, TITLE_BAR_ITERATIONS * FRAME_MS, (TITLE_BAR_ITERATIONS + 2) * FRAME_MS);
    expect(shell.animating).toBe(false);
    expect(p.entered).toEqual([LaptopMode.EMAIL]);
    expect(shell.previousMode).toBe(LaptopMode.EMAIL);
  });

  it('enters at once when the slide is switched off and opens an open program without a slide', () => {
    const p = ports();
    const shell = instantShell(p);
    shell.update(0);
    shell.openProgram(LaptopMode.FINANCES);
    shell.update(FRAME_MS);
    expect(p.entered).toEqual([LaptopMode.FINANCES]);
    shell.openProgram(LaptopMode.EMAIL);
    shell.update(2 * FRAME_MS);
    shell.openProgram(LaptopMode.FINANCES);
    shell.update(3 * FRAME_MS);
    expect(shell.animating).toBe(false);
    expect(p.entered.at(-1)).toBe(LaptopMode.FINANCES);
    expect(p.exited).toEqual([LaptopMode.FINANCES, LaptopMode.EMAIL]);
  });

  it('shows the bookmarks on the first browser use and closes them on Esc and on a right click', () => {
    const p = ports();
    const shell = instantShell(p);
    shell.update(0);
    shell.webPrimary();
    expect(shell.mode).toBe(LaptopMode.WWW);
    shell.update(FRAME_MS);
    expect(shell.showBookmarks).toBe(true);
    expect(shell.escape()).toBe(true);
    expect(shell.showBookmarks).toBe(false);
    expect(shell.escape()).toBe(false);
    shell.webPrimary();
    expect(shell.showBookmarks).toBe(true);
    expect(shell.rightButtonUp()).toBe(true);
    expect(shell.rightButtonUp()).toBe(false);
  });

  it('waits for the World Wide Wait before entering a site and reloads a visited bookmark fast', () => {
    const p = ports();
    const shell = instantShell(p);
    shell.update(0);
    shell.webPrimary();
    shell.update(FRAME_MS);
    shell.goToWebPage(Bookmark.AIM);
    expect(shell.loading).toBe(true);
    let now = run(shell, 2 * FRAME_MS, UNIT_TIME * 20);
    expect(p.entered.at(-1)).toBe(LaptopMode.WWW);
    expect(shell.shownMode).toBe(LaptopMode.WWW);
    now = run(shell, now, now + UNIT_TIME * 20);
    expect(p.entered.at(-1)).toBe(LaptopMode.AIM);
    expect(shell.wwwMode).toBe(LaptopMode.AIM);
    shell.goToWebPage(Bookmark.FLORIST);
    now = run(shell, now, now + UNIT_TIME * 40);
    shell.goToWebPage(Bookmark.AIM);
    expect(shell.load?.unitTime).toBe(3);
    run(shell, now, now + 200);
    expect(p.entered.at(-1)).toBe(LaptopMode.AIM);
  });

  it('shows the broken link while the M.E.R.C. site is down', () => {
    const p = ports();
    p.siteDown = true;
    const shell = instantShell(p);
    shell.goToWebPage(Bookmark.MERC);
    expect(shell.mode).toBe(LaptopMode.BROKEN_LINK);
  });

  it('skips the wait between the A.I.M. members and the mug shots but loads other sub-sites', () => {
    const p = ports();
    const shell = new LaptopShell(p, { loadingTimeScale: 0, slideStepMs: 0 });
    shell.update(0);
    shell.goToWebPage(Bookmark.AIM);
    shell.update(FRAME_MS);
    shell.update(2 * FRAME_MS);
    expect(p.entered.at(-1)).toBe(LaptopMode.AIM);
    const scaled = new LaptopShell(ports(), { loadingTimeScale: 1, slideStepMs: 0 });
    scaled.update(0);
    scaled.goToWebPage(Bookmark.AIM);
    let now = run(scaled, FRAME_MS, 3000);
    scaled.setPage(LaptopMode.AIM_MEMBERS_FACIAL_INDEX);
    scaled.update(now);
    expect(scaled.load?.unitTime).toBe(25);
    now = run(scaled, now + FRAME_MS, now + 2000);
    scaled.setPage(LaptopMode.AIM_MEMBERS);
    scaled.update(now);
    expect(scaled.loading).toBe(false);
    expect(scaled.previousMode).toBe(LaptopMode.AIM_MEMBERS);
  });

  it('minimizes to the last program still open and slides the title bar back', () => {
    const p = ports();
    const shell = instantShell(p);
    shell.update(0);
    shell.openProgram(LaptopMode.FINANCES);
    shell.update(FRAME_MS);
    shell.openProgram(LaptopMode.EMAIL);
    shell.update(2 * FRAME_MS);
    shell.minimize(3 * FRAME_MS);
    expect(shell.programStates[LaptopProgram.MAILER]).toBe(MINIMIZED);
    expect(shell.mode).toBe(LaptopMode.FINANCES);
    expect(shell.minimizing).toBe(true);
    shell.update(4 * FRAME_MS);
    expect(shell.animating).toBe(false);
    expect(p.entered.at(-1)).toBe(LaptopMode.FINANCES);
  });

  it('cycles the programs with Tab and Shift+Tab', () => {
    const shell = instantShell(ports());
    shell.tab(false);
    expect(shell.mode).toBe(LaptopMode.EMAIL);
    shell.tab(false);
    expect(shell.mode).toBe(LaptopMode.WWW);
    shell.tab(true);
    expect(shell.mode).toBe(LaptopMode.EMAIL);
    shell.tab(true);
    expect(shell.mode).toBe(LaptopMode.FINANCES);
  });

  it('turns the power light off and leaves the shown page after the exit delay', () => {
    const p = ports();
    const shell = instantShell(p);
    shell.update(0);
    shell.openProgram(LaptopMode.EMAIL);
    shell.update(FRAME_MS);
    shell.requestExit();
    shell.update(2 * FRAME_MS);
    expect(shell.powerLight).toBe(false);
    expect(shell.exited).toBe(false);
    shell.update(2 * FRAME_MS + EXIT_LAPTOP_DELAY_TIME + 1);
    expect(shell.exited).toBe(true);
    expect(p.exited.at(-1)).toBe(LaptopMode.EMAIL);
  });

  it('flickers the hard-disk light while a page loads', () => {
    const p = ports();
    const shell = new LaptopShell(p, { loadingTimeScale: 1, slideStepMs: 0 });
    shell.update(0);
    shell.goToWebPage(Bookmark.AIM);
    run(shell, FRAME_MS, 200);
    expect(shell.hdLight).toBe(true);
  });
});

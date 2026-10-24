// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/HelpScreen.cc ShouldTheHelpScreenComeUp (a forced screen comes up at once; a screen whose bit is still
// @src set comes up after bDelayEnteringHelpScreenBy1FrameCount has counted two frames), EnterHelpScreen (the screen's
// @src bit cleared when it comes up, also when forced), ExitHelpScreen (the check box of a screen that came up by itself
// @src sets fHideHelpInAllScreens, and a checked box clears every bit), NewScreenSoResetHelpScreen (the frame count
// @src restarts on a new screen); src/game/GameSettings.cc LoadGameSettings (every bit set unless the help is hidden);
// @src src/game/GameLoop.cc HandleNewScreenChange; src/game/GameScreen.cc MainGameScreenHandle (not while the pre-battle
// @src interface is up). See docs/28 §4.7.

import type { LayoutModel } from '../../layout/model.ts';
import type { UiRuntime } from '../../runtime.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { HelpOverlay } from './help-overlay.ts';
import { HELP_SCREENS, type HelpScreenKind } from './help-pages.ts';

const FRAMES_BEFORE_HELP = 2;

export interface HelpSeenStore {
  hidden(): boolean;
  seen(bit: number): boolean;
  markSeen(bit: number): void;
  setHidden(hidden: boolean): void;
}

export interface HelpFrame {
  readonly screen: unknown;
  readonly kind: HelpScreenKind | null;
  readonly blocked: boolean;
}

export interface HelpSystemOptions {
  readonly runtime: UiRuntime;
  readonly text: UiTextService;
  readonly model: LayoutModel;
  readonly store: () => HelpSeenStore | null;
}

export class HelpSystem {
  readonly #o: HelpSystemOptions;
  #screen: unknown = null;
  #delay = 0;
  #overlay: HelpOverlay | null = null;

  constructor(options: HelpSystemOptions) {
    this.#o = options;
  }

  get overlay(): HelpOverlay | null {
    return this.#overlay;
  }

  get delay(): number {
    return this.#delay;
  }

  bit(kind: HelpScreenKind): number {
    return this.#o.model.number(HELP_SCREENS[kind].id);
  }

  stillToShow(kind: HelpScreenKind): boolean {
    const store = this.#o.store();
    return store !== null && !store.hidden() && !store.seen(this.bit(kind));
  }

  frame(frame: HelpFrame): void {
    if (frame.screen !== this.#screen) {
      this.#screen = frame.screen;
      this.#delay = 0;
    }
    if (this.#overlay || frame.kind === null || frame.blocked || !this.stillToShow(frame.kind)) return;
    if (this.#delay < FRAMES_BEFORE_HELP) {
      this.#delay++;
      return;
    }
    this.#delay = 0;
    this.#open(frame.kind, false);
  }

  force(kind: HelpScreenKind): void {
    if (this.#overlay) return;
    this.#delay = 0;
    this.#open(kind, true);
  }

  #open(kind: HelpScreenKind, forced: boolean): void {
    const store = this.#o.store();
    store?.markSeen(this.bit(kind));
    const overlay = new HelpOverlay({
      runtime: this.#o.runtime,
      text: this.#o.text,
      model: this.#o.model,
      kind,
      forced,
      hideAll: store?.hidden() ?? false,
      closed: (hideAll) => {
        if (this.#overlay === overlay) this.#overlay = null;
        if (hideAll !== null) this.#o.store()?.setHidden(hideAll);
      },
    });
    this.#overlay = overlay;
    this.#o.runtime.host.openModal(overlay);
  }
}

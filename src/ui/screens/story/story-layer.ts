// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Meanwhile.cc CheckForMeanwhileOKStart (the box over the screen the event reached),
// @src BeginMeanwhileCallBack (OK starts the scene, Skip skips it), StartMeanwhile and DoneFadeOutMeanwhile (a fade out,
// @src the scene's sector loaded, a fade in); src/game/Tactical/End_Game.cc HandleDeidrannaDeath (after the quotes a
// @src fade out into DoneFadeOutKilledQueen), DoneFadeOutKilledQueen (P3 loaded, then a fade in),
// @src EndQueenDeathEndgameBeginEndCimenatic and DoneFadeOutEndCinematic (after the end-game comments a fade out into
// @src the ending videos).

import type { CampaignEndingView, ViewFrame } from '../../../protocol/view.ts';
import type { MessageBoxes } from '../../message-boxes.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { MEANWHILE_BOX, meanwhileBoxButtons, meanwhileBoxText } from './meanwhile-box.ts';

export interface StoryPort {
  readonly boxes: MessageBoxes;
  readonly text: UiTextService;
  sceneSeen(scene: number): boolean;
  fadeOut(): Promise<void>;
  clearBlack(): void;
  fadeIn(): Promise<void>;
  gameShown(): boolean;
  ending(ending: CampaignEndingView): Promise<void>;
}

type FrameEvent = NonNullable<ViewFrame['events']>[number];

type StoryStep =
  | { readonly kind: 'meanwhile'; readonly scene: string; readonly loadsSector: boolean }
  | { readonly kind: 'upstairs' }
  | { readonly kind: 'ending'; readonly ending: CampaignEndingView };

export type StoryRelease = (frames: readonly ViewFrame[]) => void;

export interface StoryHook {
  step: string | null;
  played: string[];
  meanwhileBoxes: number;
  endings: number;
}

function stepOf(event: FrameEvent): StoryStep | null {
  switch (event.type) {
    case 'meanwhile':
      return { kind: 'meanwhile', scene: event.scene, loadsSector: false };
    case 'meanwhileStarted':
      return { kind: 'meanwhile', scene: event.scene, loadsSector: true };
    case 'squadMovedUpstairs':
      return { kind: 'upstairs' };
    case 'campaignWon':
      return { kind: 'ending', ending: event.ending };
    default:
      return null;
  }
}

export class StoryLayer {
  readonly hook: StoryHook = { step: null, played: [], meanwhileBoxes: 0, endings: 0 };
  readonly #port: StoryPort;
  readonly #steps: StoryStep[] = [];
  readonly #held: { readonly frame: ViewFrame; readonly through: number }[] = [];
  #enqueued = 0;
  #started = 0;
  #release: StoryRelease | null = null;
  #running = false;
  #ended = false;
  #shownWaiter: ((fadeIn: Promise<void>) => void) | null = null;

  constructor(port: StoryPort) {
    this.#port = port;
  }

  get holdsFlow(): boolean {
    return this.#running || this.#steps.length > 0 || this.#ended;
  }

  frames(frames: readonly ViewFrame[], release: StoryRelease): void {
    this.#release = release;
    if (this.#ended) return;
    const passing: ViewFrame[] = [];
    for (const frame of frames) {
      for (const event of frame.events ?? []) this.#enqueue(event);
      if (this.holdsFlow) this.#held.push({ frame, through: this.#enqueued });
      else passing.push(frame);
    }
    if (passing.length > 0) release(passing);
    if (!this.#running && this.#steps.length > 0) void this.#run();
  }

  frame(): void {
    if (this.#shownWaiter && this.#port.gameShown()) {
      const resolve = this.#shownWaiter;
      this.#shownWaiter = null;
      resolve(this.#port.fadeIn());
    }
  }

  reset(): void {
    this.#steps.length = 0;
    this.#held.length = 0;
    this.#ended = false;
    this.#enqueued = this.#started;
    const waiter = this.#shownWaiter;
    this.#shownWaiter = null;
    waiter?.(Promise.resolve());
  }

  #enqueue(event: FrameEvent): void {
    const step = stepOf(event);
    if (!step) return;
    this.#steps.push(step);
    this.#enqueued++;
  }

  async #run(): Promise<void> {
    this.#running = true;
    try {
      for (let step = this.#steps.shift(); step; step = this.#steps.shift()) {
        this.#started++;
        this.hook.step = step.kind;
        this.hook.played.push(step.kind);
        await this.#play(step);
      }
    } finally {
      this.#running = false;
      this.hook.step = null;
    }
    this.#flush();
  }

  #flush(): void {
    if (this.holdsFlow || this.#held.length === 0) return;
    const frames = this.#held.splice(0).map((h) => h.frame);
    this.#release?.(frames);
  }

  async #play(step: StoryStep): Promise<void> {
    switch (step.kind) {
      case 'meanwhile':
        await this.#meanwhile(step.scene, step.loadsSector);
        return;
      case 'upstairs':
        await this.#reloadThroughFades();
        return;
      case 'ending':
        await this.#ending(step.ending);
        return;
    }
  }

  async #meanwhile(scene: string, loadsSector: boolean): Promise<void> {
    this.hook.meanwhileBoxes++;
    const port = this.#port;
    await port.boxes.ask(
      meanwhileBoxText(port.text),
      meanwhileBoxButtons(scene, (id) => port.sceneSeen(id)),
      { id: MEANWHILE_BOX },
    );
    if (loadsSector) await this.#reloadThroughFades();
  }

  async #reloadThroughFades(): Promise<void> {
    await this.#port.fadeOut();
    const fadedIn = new Promise<void>((resolve) => {
      this.#shownWaiter = (fade) => void fade.then(resolve);
    });
    this.#releaseHeld();
    this.#port.clearBlack();
    await fadedIn;
  }

  #releaseHeld(): void {
    const count = this.#held.findIndex((h) => h.through > this.#started);
    const frames = this.#held.splice(0, count < 0 ? this.#held.length : count).map((h) => h.frame);
    if (frames.length > 0) this.#release?.(frames);
  }

  async #ending(ending: CampaignEndingView): Promise<void> {
    this.hook.endings++;
    this.#ended = true;
    this.#steps.length = 0;
    this.#held.length = 0;
    await this.#port.fadeOut();
    await this.#port.ending(ending);
  }
}

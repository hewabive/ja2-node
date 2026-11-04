// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc MapScreenHandle (HandleDialogue every map screen frame; on entry a face still
// @src talking makes its merc the info character through ContinueDialogue, whatever the speech option), ContinueDialogue
// @src (ChangeSelectedInfoChar with the selection reset, only for a listed merc not selected yet);
// @src src/game/Tactical/Dialogue_Control.cc CreateTalkingUI (the subtitle box when SUBTITLES is on or the line has no
// @src voice), HandleTacticalTextUI (a merc's box on the map screen at getTacticalTextBoxX, getTacticalTextBoxY),
// @src HandleTacticalSpeechUI (with SPEECH on, a merc starting a line on the map screen becomes the info character),
// @src HandleTacticalNPCTextUI (an NPC's line on the map screen goes to the message list alone).

import type { ViewFrame } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import type { UiServices } from '../../services.ts';
import {
  type ActiveLine,
  isQueuedQuoteEvent,
  type QuoteEvent,
  type SpeakingFace,
  type SpeechPresenter,
  type SpeechRouting,
  SpeechSurface,
  speechLineOf,
} from '../../speech.ts';
import type { MercTextBoxArt, MercTextBoxFonts } from '../../widgets/merc-text-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { SubtitleBox, type SubtitlePlace } from '../talk/subtitle-box.ts';

const OWNER = 'mapSpeech';
const NO_LINE = -1;

type FrameEvent = NonNullable<ViewFrame['events']>[number];

export interface MapSpeechHooks {
  readonly services: UiServices;
  readonly presenter: SpeechPresenter;
  readonly boxArt: MercTextBoxArt;
  readonly boxFonts: () => MercTextBoxFonts;
  readonly place: () => SubtitlePlace;
  readonly speechOn: () => boolean;
  readonly routing: () => SpeechRouting;
  readonly listed: (soldier: number) => boolean;
  readonly select: (soldier: number) => void;
}

export class MapSpeech {
  readonly #hooks: MapSpeechHooks;
  readonly #box: SubtitleBox;
  #now = 0;
  #seenLine = NO_LINE;

  constructor(hooks: MapSpeechHooks) {
    this.#hooks = hooks;
    this.#box = new SubtitleBox({ ...hooks, owner: OWNER, now: () => this.#now });
  }

  get subtitle(): string | null {
    return this.#box.text;
  }

  get talking(): boolean {
    return this.#hooks.presenter.current !== null;
  }

  get boxShown(): boolean {
    return this.#box.text !== null;
  }

  get speaking(): SpeakingFace | null {
    return this.#hooks.presenter.soldierSpeaking;
  }

  get speaker(): number | null {
    return this.#mercLine(this.#hooks.presenter.current)?.line.soldier ?? null;
  }

  frames(frames: readonly ViewFrame[]): void {
    const presenter = this.#hooks.presenter;
    for (const frame of frames) {
      if (!presenter.takesFrame(frame)) continue;
      for (const event of frame.events ?? []) this.#event(event);
    }
  }

  #event(event: FrameEvent): void {
    const presenter = this.#hooks.presenter;
    if (event.type === 'lineCut') {
      presenter.cut(event.profile, event.saidAt, event.tail);
      return;
    }
    if (!isQueuedQuoteEvent(event)) return;
    const line = speechLineOf(event as QuoteEvent, this.#hooks.routing());
    if (line) presenter.enqueue(line);
  }

  enter(now: number): void {
    this.#now = now;
    const current = this.#hooks.presenter.current;
    this.#seenLine = current?.line.id ?? NO_LINE;
    this.#selectSpeaker(current);
  }

  update(now: number): void {
    this.#now = now;
    const presenter = this.#hooks.presenter;
    presenter.update(now);
    const current = presenter.current;
    if (current && current.line.id !== this.#seenLine) {
      this.#seenLine = current.line.id;
      if (this.#hooks.speechOn()) this.#selectSpeaker(current);
    }
    const merc = this.#mercLine(current);
    this.#box.sync(merc?.subtitles ? merc : null, this.#hooks.place);
  }

  stop(): void {
    this.#hooks.presenter.skip(this.#now, true);
  }

  exit(): void {
    this.#box.dispose();
  }

  render(list: DrawList): void {
    this.#box.render(list);
  }

  describe(): readonly WidgetInfo[] {
    return this.#box.describe();
  }

  #mercLine(line: ActiveLine | null): ActiveLine | null {
    const soldier = line?.line.surface === SpeechSurface.TACTICAL ? line.line.soldier : null;
    return line && soldier !== null && this.#hooks.listed(soldier) ? line : null;
  }

  #selectSpeaker(line: ActiveLine | null): void {
    const soldier = this.#mercLine(line)?.line.soldier ?? null;
    if (soldier !== null) this.#hooks.select(soldier);
  }
}

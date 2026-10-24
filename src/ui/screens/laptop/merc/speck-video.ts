// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Mercs.cc the video modes (MERC_VIDEO_NO_VIDEO_MODE, INIT, VIDEO, EXIT), HandleMercs (the window opens
// @src while Speck has something to say), HandleTalkingSpeck (the black intro of MERC_INTRO_TIME, the quotes one after the
// @src other, the black exit of MERC_EXIT_TIME), DisplayMercVideoIntro, StartSpeckTalking, HandleSpeckTalking (the next
// @src queued quote when one ends), BtnXToCloseMercVideoButtonCallback, MercSiteSubTitleRegionCallBack and
// @src StopSpeckFromTalking (a click on the subtitles ends the current quote). Speck is a still portrait (docs/28 §9.2).

export const SpeckMode = { NONE: 0, INIT: 1, VIDEO: 2, EXIT: 3 } as const;

export const MERC_INTRO_TIME = 1000;
export const MERC_EXIT_TIME = 500;

export interface SpeckPorts {
  say(quote: number): number;
  stop(): void;
}

export interface SpeckTalk {
  readonly quote: number;
  readonly until: number;
}

export class SpeckVideo {
  mode: number = SpeckMode.NONE;
  talk: SpeckTalk | null = null;
  readonly queue: number[] = [];
  readonly #ports: SpeckPorts;
  #modeStart = 0;

  constructor(ports: SpeckPorts) {
    this.#ports = ports;
  }

  get displayed(): boolean {
    return this.mode !== SpeckMode.NONE;
  }

  get black(): boolean {
    return this.mode === SpeckMode.INIT || this.mode === SpeckMode.EXIT;
  }

  get talking(): boolean {
    return this.talk !== null;
  }

  #enter(mode: number, now: number): void {
    this.mode = mode;
    this.#modeStart = now;
  }

  enqueue(quotes: readonly number[], now: number): void {
    if (quotes.length === 0) return;
    this.queue.push(...quotes);
    if (this.mode === SpeckMode.NONE) this.#enter(SpeckMode.INIT, now);
  }

  #stop(): void {
    if (!this.talk) return;
    this.talk = null;
    this.#ports.stop();
  }

  shutUp(): void {
    this.#stop();
  }

  close(now: number): void {
    this.#stop();
    this.queue.length = 0;
    if (this.displayed && this.mode !== SpeckMode.EXIT) this.#enter(SpeckMode.EXIT, now);
  }

  dispose(): void {
    this.#stop();
    this.queue.length = 0;
    this.mode = SpeckMode.NONE;
  }

  #sayNext(now: number): boolean {
    const quote = this.queue.shift();
    if (quote === undefined) return false;
    this.talk = { quote, until: now + this.#ports.say(quote) };
    return true;
  }

  update(now: number): void {
    const elapsed = now - this.#modeStart;
    switch (this.mode) {
      case SpeckMode.INIT:
        if (elapsed > MERC_INTRO_TIME) {
          this.#enter(SpeckMode.VIDEO, now);
          if (!this.#sayNext(now)) this.#enter(SpeckMode.EXIT, now);
        }
        return;
      case SpeckMode.VIDEO:
        if (this.talk && now > this.talk.until) this.#stop();
        if (!this.talk && !this.#sayNext(now)) this.#enter(SpeckMode.EXIT, now);
        return;
      case SpeckMode.EXIT:
        if (elapsed > MERC_EXIT_TIME) {
          this.#enter(SpeckMode.NONE, now);
          if (this.queue.length > 0) this.#enter(SpeckMode.INIT, now);
        }
        return;
      default:
        return;
    }
  }
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Mercs.cc the video modes (MERC_VIDEO_NO_VIDEO_MODE, INIT, VIDEO, EXIT), HandleMercs (the window opens
// @src with Speck's face while he has something to say: InitMercVideoFace), HandleTalkingSpeck (the black intro of
// @src MERC_INTRO_TIME, the quotes one after the other, the black exit of MERC_EXIT_TIME), DisplayMercVideoIntro,
// @src StartSpeckTalking, HandleSpeckTalking (the face runs only in the video mode; a quote lasts as long as the face
// @src talks, then the next queued quote), BtnXToCloseMercVideoButtonCallback, MercSiteSubTitleRegionCallBack and
// @src StopSpeckFromTalking (a click on the subtitles ends the current quote).

export const SpeckMode = { NONE: 0, INIT: 1, VIDEO: 2, EXIT: 3 } as const;

export const MERC_INTRO_TIME = 1000;
export const MERC_EXIT_TIME = 500;

export interface SpeckPorts {
  initFace(now: number): void;
  say(quote: number, now: number): void;
  faceTalking(now: number): boolean;
  stop(): void;
}

export interface SpeckTalk {
  readonly quote: number;
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
    if (mode === SpeckMode.INIT) this.#ports.initFace(now);
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
    this.talk = { quote };
    this.#ports.say(quote, now);
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
        if (!this.#ports.faceTalking(now)) this.talk = null;
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

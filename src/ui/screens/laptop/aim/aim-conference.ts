// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMMembers.cc AIMVideoMode, HandleAIMMembers (the hang-up after the merc stops talking, the mode
// @src change that rebuilds the buttons, the redraw that keeps a quote's text up only while the merc talks),
// @src InitDeleteVideoConferencePopUp (INIT resets one week, the kit when it costs something and the attitude; FIRST_CONTACT,
// @src HIRE, ANSWERING_MACHINE with no attitude, UNAVAILABLE busy; every mode change restarts the attitude time),
// @src HandleCurrentVideoConfMode (the title bar up, ten black steps at VC_CONTACT_STATIC_TIME after which INIT goes to
// @src WillMercAcceptCall in the same pass, so its snow branch never runs; the answering machine message, the title bar down
// @src and the "just hired" box), DisplayMovingTitleBar (Interpolate over AIM_MEMBER_VIDEO_TITLE_ITERATIONS, done one step
// @src before the last going up and at 0 going down), DisplaySnowBackground (two passes of the six snow frames over the face
// @src while gfFirstTimeInContactScreen, set by the contact click, holds; at their end it clears the flag and, in
// @src FIRST_CONTACT, says QUOTE_GREETING while gfAimMemberCanMercSayOpeningQuote holds, which POPUP sets and the first
// @src contact buttons clear), DisplayBlackBackground (the step count it shares with the snow, reset as it ends),
// @src BtnFirstContactButtonCallback, CanMercBeHired (asked from the server; a hang-up due goes before the mode change),
// @src BtnContractLengthButtonCallback and BtnBuyEquipmentButtonCallback (both restart the attitude time),
// @src BtnAuthorizeButtonCallback (both of its buttons stop the merc talking and end his attitude for the call),
// @src AimMemberHireMerc, CreateAimPopUpBox, BtnPopUpOkButtonCallback (the message-recorded box carries the success data, so
// @src it too waits for the merc to stop and hangs up), DeleteAimPopUpBox (the machine's Hang Up enabled again),
// @src BtnAnsweringMachineButtonCallback, BtnHangUpButtonCallback and BtnXToCloseVideoConfButtonCallback (the merc talks on
// @src under the title bar until the conference closes; only the first contact's Hang Up stops him),
// @src WaitForMercToFinishTalkingOrUserToClick, DelayMercSpeech (a hang-up asked for while a quote waits drops the quote, as
// @src the mode change resets it), InitVideoFace (at the first contact after the connection, the answering machine and the
// @src unavailable merc), InitVideoFaceTalking, DisplayTalkingMercFaceForVideoPopUp (the face frozen on the answering
// @src machine; the merc talks as long as his face does, and his quote ends once the face has stopped and the text time has
// @src passed; the attitude time restarts while he talks and as his quote ends), DisplayTextForMercFaceVideoPopUp (the text
// @src in quotes, max(1500, 80 x characters) ms), SelectShutUpMercRegionCallBack, StopMercTalking, HandleMercAttitude (the
// @src two very impatient quotes queued at once; its EnableDisableCurrentVideoConferenceButtons(FALSE) before the hang-up
// @src comment does nothing, as the hire buttons are never disabled then; the annoyance it raises is not simulated),
// @src DisableNewMailMessage; HandleAIMMembers runs HandleVideoDistortion while the face is up and no answering machine
// @src shows: the connection snow with static4.wav while gfFirstTimeInContactScreen holds, the distortion
// @src (aim-distortion.ts) after it.

import { idiv } from '../../../../core/int.ts';
import { type DistortionClocks, distortionClocks, type StaticNoise, VideoDistortion } from './aim-distortion.ts';

export const VideoMode = {
  NOT_DISPLAYED: 0,
  POPUP: 1,
  INIT: 2,
  FIRST_CONTACT: 3,
  HIRE: 4,
  ANSWERING_MACHINE: 5,
  UNAVAILABLE: 6,
  POPDOWN: 7,
} as const;

export const ContractLength = { ONE_DAY: 0, ONE_WEEK: 1, TWO_WEEKS: 2 } as const;
export const CONTRACT_DAYS: readonly number[] = [1, 7, 14];

export const ConferenceQuote = {
  LAME_REFUSAL: 82,
  ANSWERING_MACHINE_MSG: 84,
  CONTRACT_ACCEPTANCE: 91,
  PRECEDENT_TO_REPEATING_ONESELF: 96,
  REFUSAL_TO_JOIN_LACK_OF_FUNDS: 97,
  GREETING: 108,
  SMALL_TALK: 109,
  IMPATIENT_QUOTE: 110,
  LENGTH_OF_CONTRACT: 111,
  COMMENT_BEFORE_HANG_UP: 112,
} as const;

const Attitude = {
  SMALL_TALK: 1,
  IMPATIENT_TALK: 2,
  VERY_IMPATIENT_TALK: 3,
  HANG_UP_TALK: 4,
  NO_ACTION: 5,
  MERC_BUSY: 6,
} as const;

export const TITLE_ITERATIONS = 18;
export const STATIC_TIME = 30;
export const BLACK_LOOPS = 10;
export const SNOW_FRAMES = 6;
export const SNOW_PASSES = 2;
export const SPEECH_DELAY = 750;
export const MINIMUM_TALKING_TIME = 1500;
export const TEXT_SPEECH_MODIFIER = 80;
export const FIRST_ATTITUDE_TIME = 3000;
export const ATTITUDE_TIME = 10000;

export type PopupKind = 'success' | 'failure' | 'message';

export interface ConferencePopup {
  readonly kind: PopupKind;
}

export type FaceShown = 'none' | 'black' | 'face';

export interface ConferencePorts {
  contact(): 'firstContact' | 'answeringMachine' | 'unavailable';
  hasKit(): boolean;
  hireCheck(): Promise<{ readonly accepted: boolean; readonly quote: number | null }>;
  hire(contract: number, gear: boolean): Promise<'hired' | 'funds' | 'teamFull' | 'refused'>;
  leaveMessage(): void;
  initFace(now: number): void;
  say(quote: number, now: number, started: () => void): void;
  faceTalking(now: number, frozen: boolean): boolean;
  speechDuration(): number;
  stopTalking(): void;
  popdownDone(): void;
  teamFullBox(): void;
  random(range: number): number;
  noise(file: string): StaticNoise;
}

export interface TalkState {
  readonly quote: number;
}

export function talkingTime(text: string): number {
  return Math.max(MINIMUM_TALKING_TIME, [...`"${text}"`].length * TEXT_SPEECH_MODIFIER);
}

export function textTimeAfterQuote(previous: number, text: string, textShown: boolean): number {
  return textShown ? talkingTime(text) : previous;
}

export function titleBarRect(step: number, fromY: number, toY: number): { x: number; y: number; width: number } {
  const lerp = (start: number, end: number) => start + idiv((end - start) * step, TITLE_ITERATIONS);
  const x = lerp(331, 125);
  const right = lerp(405, 490);
  return { x, y: lerp(fromY, toY), width: right - x };
}

export class Conference {
  mode: number = VideoMode.NOT_DISPLAYED;
  previousMode: number = VideoMode.NOT_DISPLAYED;
  contractLength: number = ContractLength.ONE_WEEK;
  buyEquipment = false;
  popup: ConferencePopup | null = null;
  talk: TalkState | null = null;
  face: FaceShown = 'none';
  snowFrame: number | null = null;
  titleStep = 0;
  hireDisabled = false;
  leaveMessageDisabled = false;
  machineHangUpDisabled = false;
  hireButtonsDisabled = false;
  readonly distortion: VideoDistortion;
  readonly #ports: ConferencePorts;
  readonly #stepMs: number;
  #justSwitched = false;
  #titleStart = 0;
  #count = 0;
  #lastTick = 0;
  #firstTimeInContact = false;
  #canSayOpeningQuote = true;
  #hangUp = false;
  #delayed: { quote: number; at: number; hangUpAfter: boolean } | null = null;
  #busy = false;
  #waitingForMercToStop = false;
  #mercTalking = false;
  #talkStartedAt = 0;
  #wasTalking = false;
  #attitude = 0;
  #attitudeAt = 0;
  #redraw = false;
  #textUp = false;
  #now = 0;

  constructor(ports: ConferencePorts, stepMs: number, clocks: DistortionClocks = distortionClocks()) {
    this.#ports = ports;
    this.#stepMs = stepMs;
    this.distortion = new VideoDistortion(clocks, ports);
  }

  get displayed(): boolean {
    return this.mode !== VideoMode.NOT_DISPLAYED;
  }

  get terminalShown(): boolean {
    return this.mode !== VideoMode.NOT_DISPLAYED && this.mode !== VideoMode.POPUP;
  }

  get talking(): boolean {
    return this.talk !== null;
  }

  get mercTalking(): boolean {
    return this.#mercTalking;
  }

  get subtitled(): boolean {
    return this.#textUp;
  }

  open(now: number): void {
    if (this.mode !== VideoMode.NOT_DISPLAYED) return;
    this.#now = now;
    this.#firstTimeInContact = true;
    this.#setMode(VideoMode.POPUP);
  }

  close(): void {
    this.#ports.stopTalking();
    this.talk = null;
    this.#mercTalking = false;
    this.#delayed = null;
    this.popup = null;
    this.mode = VideoMode.NOT_DISPLAYED;
    this.previousMode = VideoMode.NOT_DISPLAYED;
    this.face = 'none';
    this.snowFrame = null;
    this.distortion.clear();
    this.#waitingForMercToStop = false;
    this.#textUp = false;
  }

  #setMode(mode: number): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.#justSwitched = true;
    this.#delayed = null;
    this.#enterMode();
  }

  #say(quote: number): void {
    this.#ports.say(quote, this.#now, () => {
      this.#redraw = true;
    });
    this.talk = { quote };
    this.#mercTalking = true;
    this.#talkStartedAt = this.#now;
  }

  #initFace(): void {
    this.distortion.restart();
    this.#ports.initFace(this.#now);
  }

  #delaySpeech(quote: number): void {
    const hangUpAfter = this.#hangUp;
    this.#hangUp = false;
    this.#delayed = { quote, at: this.#now, hangUpAfter };
  }

  #enterMode(): void {
    switch (this.mode) {
      case VideoMode.NOT_DISPLAYED:
        if (this.face === 'face') this.stopTalking();
        this.face = 'none';
        this.talk = null;
        this.#mercTalking = false;
        this.#waitingForMercToStop = false;
        break;
      case VideoMode.POPUP:
        this.#titleStart = this.#now;
        this.titleStep = 1;
        this.#canSayOpeningQuote = true;
        break;
      case VideoMode.INIT:
        this.#attitude = 0;
        this.contractLength = ContractLength.ONE_WEEK;
        this.buyEquipment = this.#ports.hasKit();
        this.#mercTalking = false;
        this.#hangUp = false;
        this.#count = 0;
        this.#lastTick = 0;
        this.face = 'black';
        break;
      case VideoMode.FIRST_CONTACT:
        if (this.previousMode === VideoMode.INIT || this.previousMode === VideoMode.NOT_DISPLAYED) this.#initFace();
        this.face = 'face';
        this.hireDisabled = this.#waitingForMercToStop;
        this.#waitingForMercToStop = false;
        break;
      case VideoMode.HIRE:
        this.hireButtonsDisabled = false;
        this.#delaySpeech(ConferenceQuote.LENGTH_OF_CONTRACT);
        break;
      case VideoMode.ANSWERING_MACHINE:
        this.#initFace();
        this.face = 'face';
        this.leaveMessageDisabled = false;
        this.machineHangUpDisabled = false;
        this.#attitude = Attitude.NO_ACTION;
        this.#say(ConferenceQuote.ANSWERING_MACHINE_MSG);
        break;
      case VideoMode.UNAVAILABLE:
        this.#attitude = Attitude.MERC_BUSY;
        this.#initFace();
        this.face = 'face';
        break;
      default:
        this.#titleStart = this.#now;
        this.titleStep = TITLE_ITERATIONS - 1;
        break;
    }
    this.previousMode = this.mode;
    this.#redraw = true;
    this.#attitudeAt = this.#now;
  }

  #waitForMercToFinishTalking(): void {
    this.#waitingForMercToStop = true;
    this.mode = this.mode === VideoMode.ANSWERING_MACHINE ? VideoMode.ANSWERING_MACHINE : VideoMode.FIRST_CONTACT;
    if (this.previousMode !== this.mode) this.#enterMode();
    this.#hangUp = true;
  }

  hire(): void {
    if (this.mode !== VideoMode.FIRST_CONTACT || this.hireDisabled || this.#busy) return;
    this.stopTalking();
    this.#canSayOpeningQuote = false;
    this.#busy = true;
    void this.#ports.hireCheck().then((answer) => {
      this.#busy = false;
      if (this.mode !== VideoMode.FIRST_CONTACT) return;
      if (answer.accepted) {
        if (answer.quote !== null) this.#say(answer.quote);
        if (!this.#hangUpWhenSilent()) this.#setMode(VideoMode.HIRE);
        return;
      }
      this.#waitForMercToFinishTalking();
      if (answer.quote !== null) this.#say(answer.quote);
    });
  }

  get #callEndable(): boolean {
    if (this.mode === VideoMode.NOT_DISPLAYED || this.mode === VideoMode.POPUP || this.mode === VideoMode.POPDOWN) return false;
    return this.popup === null;
  }

  hangUp(): void {
    if (!this.#callEndable) return;
    this.stopTalking();
    this.#canSayOpeningQuote = false;
    this.#setMode(VideoMode.POPDOWN);
  }

  endCall(): void {
    if (this.#callEndable) this.#setMode(VideoMode.POPDOWN);
  }

  setContract(length: number): void {
    if (this.mode !== VideoMode.HIRE || this.hireButtonsDisabled) return;
    this.contractLength = length;
    this.#attitudeAt = this.#now;
  }

  setEquipment(buy: boolean): void {
    if (this.mode !== VideoMode.HIRE || this.hireButtonsDisabled) return;
    if (buy && !this.#ports.hasKit()) return;
    this.buyEquipment = buy;
    this.#attitudeAt = this.#now;
  }

  transferFunds(): void {
    if (this.mode !== VideoMode.HIRE || this.hireButtonsDisabled || this.#busy) return;
    this.#attitude = Attitude.NO_ACTION;
    this.stopTalking();
    this.#busy = true;
    void this.#ports.hire(CONTRACT_DAYS[this.contractLength] ?? 7, this.buyEquipment).then((result) => {
      this.#busy = false;
      if (this.mode !== VideoMode.HIRE) return;
      if (result === 'hired') {
        this.popup = { kind: 'success' };
        this.hireButtonsDisabled = true;
        this.#delaySpeech(ConferenceQuote.CONTRACT_ACCEPTANCE);
      } else if (result === 'funds') {
        this.popup = { kind: 'failure' };
        this.hireButtonsDisabled = true;
        this.#delaySpeech(ConferenceQuote.REFUSAL_TO_JOIN_LACK_OF_FUNDS);
      } else if (result === 'teamFull') this.#ports.teamFullBox();
    });
  }

  cancelHire(): void {
    if (this.mode !== VideoMode.HIRE || this.hireButtonsDisabled) return;
    this.#attitude = Attitude.NO_ACTION;
    this.stopTalking();
    this.#setMode(VideoMode.FIRST_CONTACT);
  }

  leaveMessage(): void {
    if (this.mode !== VideoMode.ANSWERING_MACHINE || this.leaveMessageDisabled) return;
    this.#ports.leaveMessage();
    this.#waitForMercToFinishTalking();
    this.popup = { kind: 'message' };
    this.leaveMessageDisabled = true;
    this.machineHangUpDisabled = true;
  }

  popupOk(): void {
    const popup = this.popup;
    if (!popup) return;
    this.popup = null;
    this.#redraw = true;
    if (popup.kind === 'failure') {
      this.hireButtonsDisabled = false;
      return;
    }
    if (popup.kind === 'success') this.mode = VideoMode.HIRE;
    else this.machineHangUpDisabled = false;
    this.#waitForMercToFinishTalking();
  }

  stopTalking(): void {
    if (!this.talk) return;
    this.#ports.stopTalking();
    this.talk = null;
    this.#mercTalking = false;
    this.#attitudeAt = this.#now;
    this.#redraw = true;
  }

  #followFace(now: number): void {
    const talking = this.#ports.faceTalking(now, this.mode === VideoMode.ANSWERING_MACHINE);
    if (talking) this.#attitudeAt = now;
    if (now - this.#talkStartedAt > this.#ports.speechDuration()) {
      if (this.#wasTalking && !talking) {
        this.#wasTalking = false;
        this.#redraw = true;
        this.#attitudeAt = now;
        this.stopTalking();
      }
    } else if (talking) this.#wasTalking = true;
    this.#mercTalking = talking;
  }

  #attitudeDue(now: number): boolean {
    const waited = now - this.#attitudeAt;
    return (this.#attitude <= Attitude.SMALL_TALK && waited > FIRST_ATTITUDE_TIME) || waited > ATTITUDE_TIME;
  }

  #handleAttitude(now: number): void {
    if (!this.#attitudeDue(now)) return;
    this.#sayAttitude();
    if (this.#attitude !== Attitude.NO_ACTION && this.#attitude !== Attitude.MERC_BUSY) this.#attitude++;
    this.#attitudeAt = now;
  }

  #sayAttitude(): void {
    switch (this.#attitude) {
      case Attitude.SMALL_TALK:
        this.#say(ConferenceQuote.SMALL_TALK);
        break;
      case Attitude.IMPATIENT_TALK:
        this.#say(ConferenceQuote.IMPATIENT_QUOTE);
        break;
      case Attitude.VERY_IMPATIENT_TALK:
        this.#say(ConferenceQuote.PRECEDENT_TO_REPEATING_ONESELF);
        this.#say(ConferenceQuote.IMPATIENT_QUOTE);
        break;
      case Attitude.HANG_UP_TALK:
        this.#say(ConferenceQuote.COMMENT_BEFORE_HANG_UP);
        this.#hangUp = true;
        break;
      case Attitude.MERC_BUSY:
        this.#say(ConferenceQuote.LAME_REFUSAL);
        this.#hangUp = true;
        break;
    }
  }

  #hangUpWhenSilent(): boolean {
    if (!this.#hangUp || this.#mercTalking) return false;
    this.#hangUp = false;
    if (this.mode === VideoMode.NOT_DISPLAYED || this.popup) return false;
    this.#setMode(VideoMode.POPDOWN);
    return true;
  }

  #updateTitle(now: number): void {
    const steps = this.#stepMs <= 0 ? TITLE_ITERATIONS : Math.floor((now - this.#titleStart) / this.#stepMs);
    if (this.mode === VideoMode.POPUP) {
      this.titleStep = Math.min(TITLE_ITERATIONS - 1, 1 + steps);
      if (this.titleStep >= TITLE_ITERATIONS - 1) this.#setMode(VideoMode.INIT);
      return;
    }
    this.titleStep = Math.max(0, TITLE_ITERATIONS - 1 - steps);
    if (this.titleStep === 0) {
      this.#setMode(VideoMode.NOT_DISPLAYED);
      this.#ports.popdownDone();
    }
  }

  #step(now: number): void {
    if (now - this.#lastTick <= STATIC_TIME) return;
    this.#count++;
    this.#lastTick = now;
  }

  #updateInit(now: number): void {
    if (this.#count >= BLACK_LOOPS) {
      this.#count = 0;
      const contact = this.#ports.contact();
      this.#setMode(
        contact === 'firstContact'
          ? VideoMode.FIRST_CONTACT
          : contact === 'answeringMachine'
            ? VideoMode.ANSWERING_MACHINE
            : VideoMode.UNAVAILABLE,
      );
      return;
    }
    this.#step(now);
    this.face = 'black';
  }

  #displaySnow(now: number): void {
    if (this.#count >= SNOW_FRAMES * SNOW_PASSES) {
      this.#firstTimeInContact = false;
      this.#count = 0;
      this.snowFrame = null;
      if (this.mode === VideoMode.FIRST_CONTACT && this.#canSayOpeningQuote) this.#say(ConferenceQuote.GREETING);
      return;
    }
    const frame = this.#count % SNOW_FRAMES;
    this.#step(now);
    this.snowFrame = frame;
  }

  #handleVideoDistortion(now: number): void {
    if (!this.#firstTimeInContact) {
      this.distortion.update(now);
      return;
    }
    this.#displaySnow(now);
    this.distortion.contactSnow();
  }

  update(now: number): void {
    this.#now = now;
    if (this.#delayed && now - this.#delayed.at > SPEECH_DELAY) {
      const delayed = this.#delayed;
      this.#delayed = null;
      this.#say(delayed.quote);
      if (delayed.hangUpAfter) this.#hangUp = true;
    }
    if (!this.#busy) this.#hangUpWhenSilent();
    if (this.mode === VideoMode.POPUP || this.mode === VideoMode.POPDOWN) this.#updateTitle(now);
    else if (this.mode === VideoMode.INIT) this.#updateInit(now);
    if (this.face === 'face') this.#followFace(now);
    if (this.distorted) this.#handleVideoDistortion(now);
    else {
      this.snowFrame = null;
      this.distortion.clear();
    }
    if (this.face === 'face' && !this.#mercTalking && !this.#busy) this.#handleAttitude(now);
    this.#justSwitched = false;
    if (this.#redraw) this.#textUp = this.#mercTalking;
    this.#redraw = false;
  }

  get distorted(): boolean {
    return this.face === 'face' && this.mode !== VideoMode.ANSWERING_MACHINE;
  }

  get justSwitched(): boolean {
    return this.#justSwitched;
  }
}

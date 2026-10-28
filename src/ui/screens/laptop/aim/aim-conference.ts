// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMMembers.cc AIMVideoMode, HandleAIMMembers (the hang-up after the merc stops talking, the mode
// @src change that rebuilds the buttons), InitDeleteVideoConferencePopUp (INIT resets one week and the kit when it costs
// @src something; FIRST_CONTACT, HIRE, ANSWERING_MACHINE, UNAVAILABLE buttons), HandleCurrentVideoConfMode (the title bar
// @src up, ten black steps then two passes of the six snow frames at VC_CONTACT_STATIC_TIME, WillMercAcceptCall, the
// @src answering machine message, the title bar down and the "just hired" box), DisplayMovingTitleBar (Interpolate over
// @src AIM_MEMBER_VIDEO_TITLE_ITERATIONS, done one step before the last going up and at 0 going down), DisplaySnowBackground
// @src (it clears gfFirstTimeInContactScreen at its end, so the greeting at the end of a snow in FIRST_CONTACT never plays
// @src after the connection snow of INIT), DisplayBlackBackground, BtnFirstContactButtonCallback, CanMercBeHired (asked from
// @src the server), BtnContractLengthButtonCallback, BtnBuyEquipmentButtonCallback, BtnAuthorizeButtonCallback,
// @src AimMemberHireMerc, CreateAimPopUpBox, BtnPopUpOkButtonCallback, BtnAnsweringMachineButtonCallback,
// @src BtnHangUpButtonCallback, BtnXToCloseVideoConfButtonCallback, WaitForMercToFinishTalkingOrUserToClick, DelayMercSpeech,
// @src InitVideoFaceTalking, DisplayTextForMercFaceVideoPopUp (the text in quotes, max(1500, 80 x characters) ms),
// @src SelectShutUpMercRegionCallBack, StopMercTalking, DisableNewMailMessage. The random distortion and the impatience
// @src quotes are not reproduced.

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
  ANSWERING_MACHINE_MSG: 84,
  CONTRACT_ACCEPTANCE: 91,
  REFUSAL_TO_JOIN_LACK_OF_FUNDS: 97,
  LENGTH_OF_CONTRACT: 111,
} as const;

export const TITLE_ITERATIONS = 18;
export const STATIC_TIME = 30;
export const BLACK_LOOPS = 10;
export const SNOW_FRAMES = 6;
export const SPEECH_DELAY = 750;
export const MINIMUM_TALKING_TIME = 1500;
export const TEXT_SPEECH_MODIFIER = 80;

export type PopupKind = 'success' | 'failure' | 'message';

export interface ConferencePopup {
  readonly kind: PopupKind;
}

export type FaceShown = 'none' | 'black' | 'snow' | 'face';

export interface ConferencePorts {
  contact(): 'firstContact' | 'answeringMachine' | 'unavailable';
  hasKit(): boolean;
  hireCheck(): Promise<{ readonly accepted: boolean; readonly quote: number | null }>;
  hire(contract: number, gear: boolean): Promise<'hired' | 'funds' | 'teamFull' | 'refused'>;
  leaveMessage(): void;
  say(quote: number): number;
  stopTalking(): void;
  popdownDone(): void;
  teamFullBox(): void;
}

export interface TalkState {
  readonly quote: number;
  readonly until: number;
}

export function talkingTime(text: string): number {
  return Math.max(MINIMUM_TALKING_TIME, [...`"${text}"`].length * TEXT_SPEECH_MODIFIER);
}

export function titleBarRect(step: number, fromY: number, toY: number): { x: number; y: number; width: number } {
  const lerp = (start: number, end: number) => start + Math.trunc(((end - start) * step) / TITLE_ITERATIONS);
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
  snowFrame = 0;
  titleStep = 0;
  hireDisabled = false;
  answeringButtonsDisabled = false;
  hireButtonsDisabled = false;
  readonly #ports: ConferencePorts;
  readonly #stepMs: number;
  #justSwitched = false;
  #titleStart = 0;
  #count = 0;
  #lastTick = 0;
  #initPhase: 'black' | 'snow' = 'black';
  #hangUp = false;
  #delayed: { quote: number; at: number; hangUpAfter: boolean } | null = null;
  #busy = false;
  #waitingForMercToStop = false;
  #now = 0;

  constructor(ports: ConferencePorts, stepMs: number) {
    this.#ports = ports;
    this.#stepMs = stepMs;
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

  open(now: number): void {
    if (this.mode !== VideoMode.NOT_DISPLAYED) return;
    this.#now = now;
    this.#setMode(VideoMode.POPUP);
  }

  close(): void {
    this.#ports.stopTalking();
    this.talk = null;
    this.#delayed = null;
    this.popup = null;
    this.mode = VideoMode.NOT_DISPLAYED;
    this.previousMode = VideoMode.NOT_DISPLAYED;
    this.face = 'none';
    this.#waitingForMercToStop = false;
  }

  #setMode(mode: number): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.#justSwitched = true;
    this.#delayed = null;
    this.#enterMode();
  }

  #say(quote: number): void {
    const duration = this.#ports.say(quote);
    this.talk = { quote, until: this.#now + duration };
  }

  #delaySpeech(quote: number): void {
    const hangUpAfter = this.#hangUp;
    this.#hangUp = false;
    this.#delayed = { quote, at: this.#now, hangUpAfter };
  }

  #enterMode(): void {
    switch (this.mode) {
      case VideoMode.NOT_DISPLAYED:
        this.face = 'none';
        this.talk = null;
        this.#waitingForMercToStop = false;
        break;
      case VideoMode.POPUP:
        this.#titleStart = this.#now;
        this.titleStep = 1;
        break;
      case VideoMode.INIT:
        this.contractLength = ContractLength.ONE_WEEK;
        this.buyEquipment = this.#ports.hasKit();
        this.talk = null;
        this.#hangUp = false;
        this.#count = 0;
        this.#lastTick = 0;
        this.#initPhase = 'black';
        this.face = 'black';
        break;
      case VideoMode.FIRST_CONTACT:
        this.face = 'face';
        this.hireDisabled = this.#waitingForMercToStop;
        this.#waitingForMercToStop = false;
        break;
      case VideoMode.HIRE:
        this.hireButtonsDisabled = false;
        this.#delaySpeech(ConferenceQuote.LENGTH_OF_CONTRACT);
        break;
      case VideoMode.ANSWERING_MACHINE:
        this.face = 'face';
        this.answeringButtonsDisabled = false;
        this.#say(ConferenceQuote.ANSWERING_MACHINE_MSG);
        break;
      case VideoMode.UNAVAILABLE:
        this.face = 'face';
        break;
      default:
        this.#titleStart = this.#now;
        this.titleStep = TITLE_ITERATIONS - 1;
        break;
    }
    this.previousMode = this.mode;
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
    this.#busy = true;
    void this.#ports.hireCheck().then((answer) => {
      this.#busy = false;
      if (this.mode !== VideoMode.FIRST_CONTACT) return;
      if (answer.accepted) {
        if (answer.quote !== null) this.#say(answer.quote);
        this.#setMode(VideoMode.HIRE);
        return;
      }
      this.#waitForMercToFinishTalking();
      if (answer.quote !== null) this.#say(answer.quote);
    });
  }

  hangUp(): void {
    if (this.mode === VideoMode.NOT_DISPLAYED || this.mode === VideoMode.POPUP || this.mode === VideoMode.POPDOWN) return;
    if (this.popup) return;
    this.stopTalking();
    this.#setMode(VideoMode.POPDOWN);
  }

  setContract(length: number): void {
    if (this.mode === VideoMode.HIRE && !this.hireButtonsDisabled) this.contractLength = length;
  }

  setEquipment(buy: boolean): void {
    if (this.mode !== VideoMode.HIRE || this.hireButtonsDisabled) return;
    if (buy && !this.#ports.hasKit()) return;
    this.buyEquipment = buy;
  }

  transferFunds(): void {
    if (this.mode !== VideoMode.HIRE || this.hireButtonsDisabled || this.#busy) return;
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
    if (this.mode === VideoMode.HIRE && !this.hireButtonsDisabled) this.#setMode(VideoMode.FIRST_CONTACT);
  }

  leaveMessage(): void {
    if (this.mode !== VideoMode.ANSWERING_MACHINE || this.answeringButtonsDisabled) return;
    this.#ports.leaveMessage();
    this.#waitForMercToFinishTalking();
    this.popup = { kind: 'message' };
    this.answeringButtonsDisabled = true;
  }

  popupOk(): void {
    const popup = this.popup;
    if (!popup) return;
    this.popup = null;
    if (popup.kind === 'success') {
      this.mode = VideoMode.HIRE;
      this.#waitForMercToFinishTalking();
    } else if (popup.kind === 'failure') this.hireButtonsDisabled = false;
  }

  stopTalking(): void {
    if (!this.talk) return;
    this.#ports.stopTalking();
    this.talk = null;
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

  #updateInit(now: number): void {
    const limit = this.#initPhase === 'black' ? BLACK_LOOPS : SNOW_FRAMES * 2;
    if (this.#count >= limit) {
      this.#count = 0;
      if (this.#initPhase === 'black') {
        this.#initPhase = 'snow';
        this.face = 'snow';
        this.snowFrame = 0;
        return;
      }
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
    if (now - this.#lastTick > STATIC_TIME) {
      this.#count++;
      this.#lastTick = now;
    }
    this.face = this.#initPhase === 'black' ? 'black' : 'snow';
    this.snowFrame = this.#count % SNOW_FRAMES;
  }

  update(now: number): void {
    this.#now = now;
    if (this.#delayed && now - this.#delayed.at > SPEECH_DELAY) {
      const delayed = this.#delayed;
      this.#delayed = null;
      this.#say(delayed.quote);
      if (delayed.hangUpAfter) this.#hangUp = true;
    }
    if (this.talk && now > this.talk.until) this.stopTalking();
    if (this.#hangUp && !this.talking && !this.#delayed) {
      if (this.mode !== VideoMode.NOT_DISPLAYED && !this.popup) this.#setMode(VideoMode.POPDOWN);
      this.#hangUp = false;
    }
    if (this.mode === VideoMode.POPUP || this.mode === VideoMode.POPDOWN) this.#updateTitle(now);
    else if (this.mode === VideoMode.INIT) this.#updateInit(now);
    this.#justSwitched = false;
  }

  get justSwitched(): boolean {
    return this.#justSwitched;
  }
}

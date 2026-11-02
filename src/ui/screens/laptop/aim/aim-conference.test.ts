import { describe, expect, it } from 'vitest';
import {
  BLACK_LOOPS,
  Conference,
  type ConferencePorts,
  ConferenceQuote,
  ContractLength,
  MINIMUM_TALKING_TIME,
  SNOW_FRAMES,
  SPEECH_DELAY,
  STATIC_TIME,
  TITLE_ITERATIONS,
  talkingTime,
  textTimeAfterQuote,
  titleBarRect,
  VideoMode,
} from './aim-conference.ts';
import { DISTORTION_PICK_TIME, DistortionAsset, distortionClocks, StaticMode } from './aim-distortion.ts';

const STEP_MS = 16;
const QUOTE_MS = 1000;
const CLEAN_ROLL = 150;
const FUZZY_ROLL = 0;
const PAST_THE_FIRST_ROLL = DISTORTION_PICK_TIME + 3 * STEP_MS;

interface FakePorts extends ConferencePorts {
  answer: ReturnType<ConferencePorts['contact']>;
  hireResult: Awaited<ReturnType<ConferencePorts['hire']>>;
  accepted: boolean;
  readonly said: number[];
  readonly hires: { contract: number; gear: boolean }[];
  popdowns: number;
  messages: number;
  roll: number;
  readonly noises: string[];
  faces: number;
  frozen: boolean;
  faceTalkMs: number;
  textTime: number;
  talkingFrom: number | null;
  shutUps: number;
}

function ports(): FakePorts {
  const p: FakePorts = {
    answer: 'firstContact',
    hireResult: 'hired',
    accepted: true,
    said: [],
    hires: [],
    popdowns: 0,
    messages: 0,
    roll: CLEAN_ROLL,
    noises: [],
    faces: 0,
    frozen: false,
    faceTalkMs: QUOTE_MS,
    textTime: QUOTE_MS,
    talkingFrom: null,
    shutUps: 0,
    contact: () => p.answer,
    hasKit: () => true,
    hireCheck: async () => ({ accepted: p.accepted, quote: p.accepted ? null : 13 }),
    hire: async (contract, gear) => {
      p.hires.push({ contract, gear });
      return p.hireResult;
    },
    leaveMessage: () => {
      p.messages++;
    },
    initFace: () => {
      p.faces++;
      p.frozen = false;
    },
    say: (quote, now) => {
      p.said.push(quote);
      p.talkingFrom = now;
    },
    faceTalking: (now, frozen) => {
      if (frozen) p.frozen = true;
      return p.talkingFrom !== null && now - p.talkingFrom < p.faceTalkMs;
    },
    speechDuration: () => p.textTime,
    stopTalking: () => {
      p.shutUps++;
      p.talkingFrom = null;
    },
    popdownDone: () => {
      p.popdowns++;
    },
    teamFullBox: () => undefined,
    random: () => p.roll,
    noise: (file) => {
      p.noises.push(file);
    },
  };
  return p;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function advance(conference: Conference, from: number, ms: number): number {
  const until = from + ms;
  let now = from;
  for (; now <= until; now += STEP_MS) conference.update(now);
  return now;
}

function pastTheFirstRoll(conference: Conference, from: number): number {
  return advance(conference, from, PAST_THE_FIRST_ROLL - from);
}

function connect(conference: Conference): number {
  conference.open(0);
  const ms = TITLE_ITERATIONS * STEP_MS + (BLACK_LOOPS + 2 * SNOW_FRAMES + 2) * (STATIC_TIME + STEP_MS);
  return advance(conference, 0, ms);
}

describe('the A.I.M. video conference', () => {
  it('raises the title bar, shows black then two passes of snow and then the merc', () => {
    const conference = new Conference(ports(), STEP_MS);
    conference.open(0);
    expect(conference.mode).toBe(VideoMode.POPUP);
    expect(conference.terminalShown).toBe(false);
    const now = advance(conference, 0, (TITLE_ITERATIONS - 3) * STEP_MS);
    expect(conference.mode).toBe(VideoMode.POPUP);
    advance(conference, now, 2 * STEP_MS);
    expect(conference.mode).toBe(VideoMode.INIT);
    expect(conference.face).toBe('black');
    expect(conference.buyEquipment).toBe(true);
    connect(conference);
    const fresh = new Conference(ports(), STEP_MS);
    connect(fresh);
    expect(fresh.mode).toBe(VideoMode.FIRST_CONTACT);
    expect(fresh.face).toBe('face');
  });

  it('greets with nothing after the connection snow: the snow clears the first-contact flag the greeting waits for', () => {
    const p = ports();
    connect(new Conference(p, STEP_MS));
    expect(p.said).toEqual([]);
  });

  it('plays the answering machine and leaves a message', () => {
    const p = ports();
    p.answer = 'answeringMachine';
    const conference = new Conference(p, STEP_MS);
    connect(conference);
    expect(conference.mode).toBe(VideoMode.ANSWERING_MACHINE);
    expect(p.said).toEqual([ConferenceQuote.ANSWERING_MACHINE_MSG]);
    conference.leaveMessage();
    expect(p.messages).toBe(1);
    expect(conference.popup).toEqual({ kind: 'message' });
    expect(conference.leaveMessageDisabled).toBe(true);
    expect(conference.machineHangUpDisabled).toBe(true);
  });

  it('hangs up when the message-recorded box is closed after the machine has finished, as the success box does', () => {
    const p = ports();
    p.answer = 'answeringMachine';
    const conference = new Conference(p, STEP_MS);
    let now = advance(conference, connect(conference), QUOTE_MS + STEP_MS);
    expect(conference.talking).toBe(false);
    conference.leaveMessage();
    now = advance(conference, now, STEP_MS);
    expect(conference.mode).toBe(VideoMode.ANSWERING_MACHINE);
    conference.popupOk();
    expect(conference.machineHangUpDisabled).toBe(false);
    expect(conference.leaveMessageDisabled).toBe(true);
    advance(conference, now, STEP_MS);
    expect(conference.mode).toBe(VideoMode.POPDOWN);
  });

  it('keeps the call up with its Hang Up enabled when the box is closed while the machine still talks', () => {
    const p = ports();
    p.answer = 'answeringMachine';
    const conference = new Conference(p, STEP_MS);
    let now = connect(conference);
    expect(conference.talking).toBe(true);
    conference.leaveMessage();
    conference.popupOk();
    now = advance(conference, now, STEP_MS);
    expect(conference.mode).toBe(VideoMode.ANSWERING_MACHINE);
    expect(conference.machineHangUpDisabled).toBe(false);
    advance(conference, now, QUOTE_MS + TITLE_ITERATIONS * STEP_MS);
    expect(conference.mode).toBe(VideoMode.NOT_DISPLAYED);
    expect(p.popdowns).toBe(1);
  });

  it('hires for the chosen length after the server accepts and hangs up once the merc stops talking', async () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    let now = connect(conference);
    conference.hire();
    await flush();
    expect(conference.mode).toBe(VideoMode.HIRE);
    now = advance(conference, now, SPEECH_DELAY + STEP_MS);
    expect(p.said).toEqual([ConferenceQuote.LENGTH_OF_CONTRACT]);
    conference.setContract(ContractLength.TWO_WEEKS);
    conference.setEquipment(false);
    conference.transferFunds();
    await flush();
    expect(p.hires).toEqual([{ contract: 14, gear: false }]);
    expect(conference.popup).toEqual({ kind: 'success' });
    expect(conference.hireButtonsDisabled).toBe(true);
    now = advance(conference, now, SPEECH_DELAY + STEP_MS);
    expect(p.said.at(-1)).toBe(ConferenceQuote.CONTRACT_ACCEPTANCE);
    conference.popupOk();
    expect(conference.mode).toBe(VideoMode.FIRST_CONTACT);
    expect(conference.hireDisabled).toBe(true);
    now = advance(conference, now, QUOTE_MS + STEP_MS);
    expect(conference.mode).toBe(VideoMode.POPDOWN);
    now = advance(conference, now, TITLE_ITERATIONS * STEP_MS);
    expect(conference.mode).toBe(VideoMode.NOT_DISPLAYED);
    expect(p.popdowns).toBe(1);
    conference.open(now);
    advance(conference, now, TITLE_ITERATIONS * STEP_MS + (BLACK_LOOPS + 2 * SNOW_FRAMES + 2) * (STATIC_TIME + STEP_MS));
    expect(conference.mode).toBe(VideoMode.FIRST_CONTACT);
    expect(conference.hireDisabled).toBe(false);
  });

  it('cuts the contract length quote on Cancel and goes back to the first contact', async () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    let now = connect(conference);
    conference.hire();
    await flush();
    now = advance(conference, now, SPEECH_DELAY + STEP_MS);
    expect(p.said).toEqual([ConferenceQuote.LENGTH_OF_CONTRACT]);
    expect(conference.talking).toBe(true);
    conference.cancelHire();
    expect(conference.talking).toBe(false);
    expect(p.talkingFrom).toBeNull();
    advance(conference, now, STEP_MS);
    expect(conference.mode).toBe(VideoMode.FIRST_CONTACT);
  });

  it('says the refusal when the server declines, leaving the hire button as it was, and re-enables the buttons after a lack of funds', async () => {
    const declined = ports();
    declined.accepted = false;
    const refusing = new Conference(declined, STEP_MS);
    connect(refusing);
    refusing.hire();
    await flush();
    expect(refusing.mode).toBe(VideoMode.FIRST_CONTACT);
    expect(refusing.hireDisabled).toBe(false);
    expect(declined.said).toEqual([13]);

    const poor = ports();
    poor.hireResult = 'funds';
    const conference = new Conference(poor, STEP_MS);
    connect(conference);
    conference.hire();
    await flush();
    conference.transferFunds();
    await flush();
    expect(conference.popup).toEqual({ kind: 'failure' });
    conference.popupOk();
    expect(conference.hireButtonsDisabled).toBe(false);
    expect(conference.mode).toBe(VideoMode.HIRE);
  });

  it('distorts the face from the first contact on, never on the answering machine', () => {
    const p = ports();
    p.roll = FUZZY_ROLL;
    const conference = new Conference(p, STEP_MS);
    const now = connect(conference);
    expect(conference.distortion.overlay).toBeNull();
    pastTheFirstRoll(conference, now);
    expect(conference.distortion.overlay).toMatchObject({ asset: DistortionAsset.FUZZ_LINES });
    expect(p.noises).toEqual(['laptop/static1.wav']);

    const answering = ports();
    answering.roll = FUZZY_ROLL;
    answering.answer = 'answeringMachine';
    const machine = new Conference(answering, STEP_MS);
    pastTheFirstRoll(machine, connect(machine));
    expect(machine.mode).toBe(VideoMode.ANSWERING_MACHINE);
    expect(machine.distortion.overlay).toBeNull();
    expect(answering.noises).toEqual([]);
  });

  it('starts every new face without static, keeping the frame counters of the last conference', () => {
    const clocks = distortionClocks();
    const p = ports();
    p.roll = FUZZY_ROLL;
    const first = new Conference(p, STEP_MS, clocks);
    pastTheFirstRoll(first, connect(first));
    expect(clocks.mode).toBe(StaticMode.FUZZY_LINE);
    first.close();
    const line = { ...clocks.line };
    p.roll = CLEAN_ROLL;
    const next = new Conference(p, STEP_MS, clocks);
    connect(next);
    expect(next.mode).toBe(VideoMode.FIRST_CONTACT);
    expect(clocks.mode).toBe(StaticMode.NO_STATIC);
    expect(clocks.line).toEqual(line);
  });

  it('puts up a new face at the first contact, on the answering machine, frozen there, and for an unavailable merc', () => {
    const p = ports();
    connect(new Conference(p, STEP_MS));
    expect([p.faces, p.frozen]).toEqual([1, false]);
    const answering = ports();
    answering.answer = 'answeringMachine';
    connect(new Conference(answering, STEP_MS));
    expect([answering.faces, answering.frozen]).toEqual([1, true]);
    const busy = ports();
    busy.answer = 'unavailable';
    const conference = new Conference(busy, STEP_MS);
    connect(conference);
    expect([conference.mode, busy.faces, busy.frozen]).toEqual([VideoMode.UNAVAILABLE, 1, false]);
  });

  it('keeps a quote up while the face talks past its text time and ends it once the face has stopped', async () => {
    const p = ports();
    p.accepted = false;
    p.textTime = MINIMUM_TALKING_TIME;
    p.faceTalkMs = 3 * MINIMUM_TALKING_TIME;
    const conference = new Conference(p, STEP_MS);
    let now = connect(conference);
    conference.hire();
    await flush();
    now = advance(conference, now, 2 * MINIMUM_TALKING_TIME);
    expect([conference.talking, conference.mercTalking, conference.mode]).toEqual([true, true, VideoMode.FIRST_CONTACT]);
    advance(conference, now, MINIMUM_TALKING_TIME + STEP_MS);
    expect([conference.talking, conference.mercTalking, p.shutUps]).toEqual([false, false, 1]);
    expect(conference.mode).toBe(VideoMode.POPDOWN);
  });

  it('hangs up once the face stops talking, while the text of its quote is still up', async () => {
    const p = ports();
    p.accepted = false;
    p.textTime = 3 * QUOTE_MS;
    p.faceTalkMs = QUOTE_MS;
    const conference = new Conference(p, STEP_MS);
    const now = connect(conference);
    conference.hire();
    await flush();
    advance(conference, now, QUOTE_MS + STEP_MS);
    expect([conference.mode, conference.talking]).toEqual([VideoMode.POPDOWN, true]);
  });

  it('keeps the text time of the last quote whose text showed: a voiced quote without subtitles leaves it as it was', () => {
    expect(textTimeAfterQuote(0, 'x'.repeat(48), true)).toBe(talkingTime('x'.repeat(48)));
    expect(textTimeAfterQuote(4000, 'Hi', false)).toBe(4000);
  });

  it('times the subtitles by the quoted text and slides the title bar between its ends', () => {
    expect(talkingTime('Hi')).toBe(MINIMUM_TALKING_TIME);
    expect(talkingTime('x'.repeat(48))).toBe(50 * 80);
    expect(titleBarRect(0, 100, 30)).toEqual({ x: 331, y: 100, width: 74 });
    expect(titleBarRect(TITLE_ITERATIONS, 100, 30)).toEqual({ x: 125, y: 30, width: 365 });
  });
});

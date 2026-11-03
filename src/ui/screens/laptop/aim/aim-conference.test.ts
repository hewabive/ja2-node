import { describe, expect, it } from 'vitest';
import {
  ATTITUDE_TIME,
  BLACK_LOOPS,
  Conference,
  type ConferencePorts,
  ConferenceQuote,
  ContractLength,
  conferenceMemory,
  FIRST_ATTITUDE_TIME,
  MINIMUM_TALKING_TIME,
  SNOW_FRAMES,
  SNOW_PASSES,
  SPEECH_DELAY,
  STATIC_TIME,
  TITLE_ITERATIONS,
  talkingTime,
  textTimeAfterQuote,
  titleBarRect,
  VideoMode,
} from './aim-conference.ts';
import { CONTACT_SNOW_NOISE, DISTORTION_PICK_TIME, DistortionAsset, StaticMode } from './aim-distortion.ts';

const STEP_MS = 16;
const QUOTE_MS = 1000;
const CLEAN_ROLL = 150;
const FUZZY_ROLL = 0;
const PAST_THE_FIRST_ROLL = DISTORTION_PICK_TIME + 3 * STEP_MS;
const RUN_LIMIT = 120_000;
const SMALL_TALK_WAIT = 2 * FIRST_ATTITUDE_TIME;

interface QueuedLine {
  readonly quote: number;
  readonly started: () => void;
}

interface FakePorts extends ConferencePorts {
  answer: ReturnType<ConferencePorts['contact']>;
  hireResult: Awaited<ReturnType<ConferencePorts['hire']>>;
  accepted: boolean;
  readonly said: number[];
  readonly spoken: number[];
  readonly queue: QueuedLine[];
  faceBusy: boolean;
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

function startNextLine(p: FakePorts, now: number): void {
  const line = p.queue.shift();
  if (!line) return;
  p.talkingFrom = now;
  p.faceBusy = true;
  p.spoken.push(line.quote);
  line.started();
}

function ports(): FakePorts {
  const p: FakePorts = {
    answer: 'firstContact',
    hireResult: 'hired',
    accepted: true,
    said: [],
    spoken: [],
    queue: [],
    faceBusy: false,
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
      p.queue.length = 0;
      p.talkingFrom = null;
      p.faceBusy = false;
    },
    say: (quote, now, started) => {
      p.said.push(quote);
      p.queue.push({ quote, started });
      if (!p.faceBusy) startNextLine(p, now);
    },
    faceTalking: (now, frozen) => {
      if (frozen) p.frozen = true;
      if (!p.faceBusy) startNextLine(p, now);
      p.faceBusy = p.talkingFrom !== null && now - p.talkingFrom < p.faceTalkMs;
      return p.faceBusy;
    },
    speechDuration: () => p.textTime,
    stopTalking: () => {
      p.shutUps++;
      p.talkingFrom = null;
      p.faceBusy = false;
    },
    popdownDone: () => {
      p.popdowns++;
    },
    teamFullBox: () => undefined,
    random: () => p.roll,
    noise: (file) => {
      p.noises.push(file);
      return { stop: () => undefined };
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

function runUntil(conference: Conference, from: number, done: () => boolean): number {
  for (let now = from; now < from + RUN_LIMIT; now += STEP_MS) {
    conference.update(now);
    if (done()) return now;
  }
  throw new Error('the conference never got there');
}

function callFrom(conference: Conference, from: number): number {
  conference.open(from);
  return runUntil(conference, from, () => conference.face === 'face');
}

function faceUp(conference: Conference): number {
  return callFrom(conference, 0);
}

function nextQuote(conference: Conference, p: FakePorts, from: number): number {
  const said = p.said.length;
  return runUntil(conference, from + STEP_MS, () => p.said.length > said);
}

function greeted(conference: Conference, p: FakePorts): number {
  const greeting = nextQuote(conference, p, faceUp(conference));
  return runUntil(conference, greeting, () => !conference.talking);
}

function snowFrames(conference: Conference, from: number): number[] {
  const shown: number[] = [];
  runUntil(conference, from, () => {
    if (conference.snowFrame !== null && shown.at(-1) !== conference.snowFrame) shown.push(conference.snowFrame);
    return conference.snowFrame === null;
  });
  return shown;
}

function pastTheFirstRoll(conference: Conference, from: number): number {
  return advance(conference, from, PAST_THE_FIRST_ROLL - from);
}

function connect(conference: Conference): number {
  conference.open(0);
  const ms = TITLE_ITERATIONS * STEP_MS + (BLACK_LOOPS + SNOW_PASSES * SNOW_FRAMES + 2) * (STATIC_TIME + STEP_MS);
  return advance(conference, 0, ms);
}

describe('the A.I.M. video conference', () => {
  it('raises the title bar, shows black, then the merc at once under two passes of snow', () => {
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
    const up = runUntil(conference, now, () => conference.mode !== VideoMode.INIT);
    expect([conference.mode, conference.face, conference.snowFrame]).toEqual([VideoMode.FIRST_CONTACT, 'face', 0]);
    expect(snowFrames(conference, up)).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
  });

  it('cuts the next black short by the snow steps a call hung up during its snow left, as INIT keeps the step count', () => {
    const conference = new Conference(ports(), STEP_MS);
    const blackTime = (from: number): { black: number; up: number } => {
      conference.open(from);
      const black = runUntil(conference, from, () => conference.mode === VideoMode.INIT);
      const up = runUntil(conference, black, () => conference.face === 'face');
      return { black: up - black, up };
    };
    const first = blackTime(0);
    conference.hangUp();
    const closed = runUntil(conference, first.up, () => conference.mode === VideoMode.NOT_DISPLAYED);
    const next = blackTime(closed);
    expect(next.black).toBeLessThan(first.black / 2);
    expect(snowFrames(conference, next.up)).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
  });

  it('greets once the snow over his face has passed, with static4.wav under the snow', () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    const up = faceUp(conference);
    expect([p.said, p.noises]).toEqual([[], [CONTACT_SNOW_NOISE]]);
    const greeting = nextQuote(conference, p, up);
    expect(conference.snowFrame).toBeNull();
    expect(greeting - up).toBeLessThanOrEqual((SNOW_PASSES * SNOW_FRAMES + 1) * (STATIC_TIME + STEP_MS));
    expect([p.said, p.noises]).toEqual([[ConferenceQuote.GREETING], [CONTACT_SNOW_NOISE]]);
  });

  it('greets no one pressing Hire during the snow, no busy merc, and shows no snow before the answering machine', async () => {
    const hiring = ports();
    const conference = new Conference(hiring, STEP_MS);
    const up = faceUp(conference);
    conference.hire();
    await flush();
    expect([conference.mode, conference.snowFrame]).toEqual([VideoMode.HIRE, 0]);
    advance(conference, up, SPEECH_DELAY + 2 * STEP_MS);
    expect(hiring.said).toEqual([ConferenceQuote.LENGTH_OF_CONTRACT]);

    const busy = ports();
    busy.answer = 'unavailable';
    const unavailable = new Conference(busy, STEP_MS);
    advance(unavailable, faceUp(unavailable), FIRST_ATTITUDE_TIME);
    expect([busy.said, busy.noises]).toEqual([[], [CONTACT_SNOW_NOISE]]);

    const answering = ports();
    answering.answer = 'answeringMachine';
    const machine = new Conference(answering, STEP_MS);
    advance(machine, faceUp(machine), FIRST_ATTITUDE_TIME);
    expect([machine.snowFrame, answering.noises, answering.said]).toEqual([null, [], [ConferenceQuote.ANSWERING_MACHINE_MSG]]);
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
    expect(p.said).toEqual([ConferenceQuote.GREETING, ConferenceQuote.LENGTH_OF_CONTRACT]);
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

  it('hangs up at once and drops the acceptance quote when the hire box is closed before the quote starts', async () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    let now = connect(conference);
    conference.hire();
    await flush();
    now = advance(conference, now, SPEECH_DELAY + QUOTE_MS + STEP_MS);
    conference.transferFunds();
    await flush();
    now = advance(conference, now, SPEECH_DELAY / 2);
    conference.popupOk();
    now = advance(conference, now, STEP_MS);
    expect(conference.mode).toBe(VideoMode.POPDOWN);
    advance(conference, now, SPEECH_DELAY + TITLE_ITERATIONS * STEP_MS);
    expect(p.said).toEqual([ConferenceQuote.GREETING, ConferenceQuote.LENGTH_OF_CONTRACT]);
    expect(p.popdowns).toBe(1);
  });

  it('cuts the contract length quote on Cancel and goes back to the first contact', async () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    let now = connect(conference);
    conference.hire();
    await flush();
    now = advance(conference, now, SPEECH_DELAY + STEP_MS);
    expect(p.said).toEqual([ConferenceQuote.GREETING, ConferenceQuote.LENGTH_OF_CONTRACT]);
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
    expect(declined.said).toEqual([ConferenceQuote.GREETING, 13]);

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
    expect(p.noises).toEqual([CONTACT_SNOW_NOISE, 'laptop/static1.wav']);

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
    const memory = conferenceMemory();
    const clocks = memory.distortion;
    const p = ports();
    p.roll = FUZZY_ROLL;
    const first = new Conference(p, STEP_MS, memory);
    pastTheFirstRoll(first, connect(first));
    expect(clocks.mode).toBe(StaticMode.FUZZY_LINE);
    first.close();
    const line = { ...clocks.line };
    p.roll = CLEAN_ROLL;
    const next = new Conference(p, STEP_MS, memory);
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
    const greetingCut = p.shutUps;
    now = advance(conference, now, 2 * MINIMUM_TALKING_TIME);
    expect([conference.talking, conference.mercTalking, conference.mode]).toEqual([true, true, VideoMode.FIRST_CONTACT]);
    advance(conference, now, MINIMUM_TALKING_TIME + STEP_MS);
    expect([conference.talking, conference.mercTalking, p.shutUps - greetingCut]).toEqual([false, false, 1]);
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

describe('an A.I.M. merc kept waiting', () => {
  it('makes small talk after two spells of three silent seconds, grows impatient every ten, comments and hangs up', () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    const quiet = greeted(conference, p);
    const smallTalk = nextQuote(conference, p, quiet);
    expect(smallTalk - quiet).toBeGreaterThan(SMALL_TALK_WAIT);
    expect(smallTalk - quiet).toBeLessThanOrEqual(SMALL_TALK_WAIT + 2 * STEP_MS);
    const impatient = nextQuote(conference, p, smallTalk);
    expect(impatient - smallTalk).toBeGreaterThan(QUOTE_MS + ATTITUDE_TIME);
    expect(impatient - smallTalk).toBeLessThanOrEqual(QUOTE_MS + ATTITUDE_TIME + 3 * STEP_MS);
    const veryImpatient = nextQuote(conference, p, impatient);
    const comment = nextQuote(conference, p, veryImpatient);
    expect(comment - veryImpatient).toBeGreaterThan(2 * QUOTE_MS + ATTITUDE_TIME);
    expect(p.said).toEqual([
      ConferenceQuote.GREETING,
      ConferenceQuote.SMALL_TALK,
      ConferenceQuote.IMPATIENT_QUOTE,
      ConferenceQuote.PRECEDENT_TO_REPEATING_ONESELF,
      ConferenceQuote.IMPATIENT_QUOTE,
      ConferenceQuote.COMMENT_BEFORE_HANG_UP,
    ]);
    expect(p.spoken).toEqual(p.said);
    let now = advance(conference, comment, QUOTE_MS - 2 * STEP_MS);
    expect(conference.mode).toBe(VideoMode.FIRST_CONTACT);
    now = advance(conference, now, 4 * STEP_MS);
    expect(conference.mode).toBe(VideoMode.POPDOWN);
    advance(conference, now, TITLE_ITERATIONS * STEP_MS);
    expect(conference.mode).toBe(VideoMode.NOT_DISPLAYED);
    expect(p.popdowns).toBe(1);
  });

  it('has an unavailable merc give his lame refusal after ten silent seconds and hang up', () => {
    const p = ports();
    p.answer = 'unavailable';
    const conference = new Conference(p, STEP_MS);
    const up = faceUp(conference);
    const refusal = nextQuote(conference, p, up);
    expect(p.said).toEqual([ConferenceQuote.LAME_REFUSAL]);
    expect(refusal - up).toBeGreaterThan(ATTITUDE_TIME);
    expect(refusal - up).toBeLessThanOrEqual(ATTITUDE_TIME + 2 * STEP_MS);
    advance(conference, refusal, QUOTE_MS + 3 * STEP_MS + TITLE_ITERATIONS * STEP_MS);
    expect(conference.mode).toBe(VideoMode.NOT_DISPLAYED);
  });

  it('never grows impatient on the answering machine', () => {
    const p = ports();
    p.answer = 'answeringMachine';
    const conference = new Conference(p, STEP_MS);
    advance(conference, faceUp(conference), SMALL_TALK_WAIT + 4 * ATTITUDE_TIME);
    expect([conference.mode, p.said]).toEqual([VideoMode.ANSWERING_MACHINE, [ConferenceQuote.ANSWERING_MACHINE_MSG]]);
  });

  it('grows impatient on the contract page too, and a Cancel ends his impatience for the call', async () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    const up = faceUp(conference);
    conference.hire();
    await flush();
    const length = nextQuote(conference, p, up);
    const smallTalk = nextQuote(conference, p, length);
    expect(p.said).toEqual([ConferenceQuote.LENGTH_OF_CONTRACT, ConferenceQuote.SMALL_TALK]);
    expect(smallTalk - length).toBeGreaterThan(QUOTE_MS + SMALL_TALK_WAIT);
    conference.cancelHire();
    advance(conference, smallTalk, SMALL_TALK_WAIT + 4 * ATTITUDE_TIME);
    expect(conference.mode).toBe(VideoMode.FIRST_CONTACT);
    expect(p.said).toHaveLength(2);
  });

  it('ends his impatience for the call at a funds transfer', async () => {
    const p = ports();
    p.hireResult = 'funds';
    const conference = new Conference(p, STEP_MS);
    const now = faceUp(conference);
    conference.hire();
    await flush();
    conference.transferFunds();
    await flush();
    conference.popupOk();
    advance(conference, now, SMALL_TALK_WAIT + 4 * ATTITUDE_TIME);
    expect(conference.mode).toBe(VideoMode.HIRE);
    expect(p.said).toEqual([ConferenceQuote.REFUSAL_TO_JOIN_LACK_OF_FUNDS]);
  });

  it('starts the wait again at a contract or kit click and lets the merc talk on', async () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    const up = faceUp(conference);
    conference.hire();
    await flush();
    const length = nextQuote(conference, p, up);
    conference.setEquipment(false);
    expect([conference.talking, p.shutUps]).toEqual([true, 0]);
    const quiet = advance(conference, length, QUOTE_MS + SMALL_TALK_WAIT - 10 * STEP_MS);
    conference.update(quiet);
    conference.setContract(ContractLength.ONE_DAY);
    const smallTalk = nextQuote(conference, p, quiet);
    expect(smallTalk - quiet).toBeGreaterThan(FIRST_ATTITUDE_TIME);
    expect(smallTalk - quiet).toBeLessThanOrEqual(FIRST_ATTITUDE_TIME + 2 * STEP_MS);
  });

  it('lets a click cut the first very impatient quote and the second play on, its text up and out of the click region', () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    const smallTalk = nextQuote(conference, p, greeted(conference, p));
    const veryImpatient = nextQuote(conference, p, nextQuote(conference, p, smallTalk));
    expect(p.spoken.at(-1)).toBe(ConferenceQuote.PRECEDENT_TO_REPEATING_ONESELF);
    conference.stopTalking();
    advance(conference, veryImpatient + STEP_MS, STEP_MS);
    expect(p.spoken.at(-1)).toBe(ConferenceQuote.IMPATIENT_QUOTE);
    expect([conference.mercTalking, conference.talking, conference.subtitled]).toEqual([true, false, true]);
  });

  it('keeps the text of the second very impatient quote up after his face stops, until the next redraw', () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    const smallTalk = nextQuote(conference, p, greeted(conference, p));
    const veryImpatient = nextQuote(conference, p, nextQuote(conference, p, smallTalk));
    const now = advance(conference, veryImpatient, 2 * QUOTE_MS + 4 * STEP_MS);
    expect([p.spoken.at(-1), conference.mercTalking, conference.talking, conference.subtitled]).toEqual([
      ConferenceQuote.IMPATIENT_QUOTE,
      false,
      false,
      true,
    ]);
    conference.hangUp();
    advance(conference, now, STEP_MS);
    expect(conference.subtitled).toBe(false);
  });

  it('leaves the contract buttons usable through the hang-up comment, as its call to disable them does nothing there', async () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    const up = faceUp(conference);
    conference.hire();
    await flush();
    let now = up;
    while (p.said.at(-1) !== ConferenceQuote.COMMENT_BEFORE_HANG_UP) now = nextQuote(conference, p, now);
    expect(conference.hireButtonsDisabled).toBe(false);
    conference.transferFunds();
    now = advance(conference, now + STEP_MS, 2 * STEP_MS);
    await flush();
    expect([conference.mode, conference.popup, p.hires.length]).toEqual([VideoMode.HIRE, { kind: 'success' }, 1]);
    now = advance(conference, now, SPEECH_DELAY + STEP_MS);
    expect(p.said.at(-1)).toBe(ConferenceQuote.CONTRACT_ACCEPTANCE);
    conference.popupOk();
    advance(conference, now, QUOTE_MS + 2 * STEP_MS);
    expect(conference.mode).toBe(VideoMode.POPDOWN);
  });

  it('hangs up rather than open the contract page when Hire cuts his hang-up comment', async () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    let now = faceUp(conference);
    while (p.said.at(-1) !== ConferenceQuote.COMMENT_BEFORE_HANG_UP) now = nextQuote(conference, p, now);
    conference.hire();
    now = advance(conference, now + STEP_MS, 2 * STEP_MS);
    expect(conference.mode).toBe(VideoMode.FIRST_CONTACT);
    await flush();
    expect(conference.mode).toBe(VideoMode.POPDOWN);
    advance(conference, now, SPEECH_DELAY + TITLE_ITERATIONS * STEP_MS);
    expect(p.said).not.toContain(ConferenceQuote.LENGTH_OF_CONTRACT);
  });

  it('talks on under the title bar when the call is closed and stops as it closes; the first contact Hang Up stops him at once', () => {
    const closing = ports();
    const closed = new Conference(closing, STEP_MS);
    const smallTalk = nextQuote(closed, closing, faceUp(closed));
    closed.endCall();
    expect([closed.mode, closing.shutUps]).toEqual([VideoMode.POPDOWN, 0]);
    const now = advance(closed, smallTalk + STEP_MS, (TITLE_ITERATIONS - 3) * STEP_MS);
    expect([closed.mercTalking, closing.shutUps]).toEqual([true, 0]);
    advance(closed, now, 3 * STEP_MS);
    expect([closed.mode, closing.shutUps]).toEqual([VideoMode.NOT_DISPLAYED, 1]);

    const hanging = ports();
    const hungUp = new Conference(hanging, STEP_MS);
    nextQuote(hungUp, hanging, faceUp(hungUp));
    hungUp.hangUp();
    expect([hungUp.mode, hanging.shutUps]).toEqual([VideoMode.POPDOWN, 1]);
  });

  it('hangs up the next call after its contract length quote when Transfer Funds cut his hang-up comment and OK beat the acceptance quote', async () => {
    const memory = conferenceMemory();
    const p = ports();
    const first = new Conference(p, STEP_MS, memory);
    let now = faceUp(first);
    first.hire();
    await flush();
    while (p.said.at(-1) !== ConferenceQuote.COMMENT_BEFORE_HANG_UP) now = nextQuote(first, p, now);
    first.transferFunds();
    await flush();
    now = advance(first, now + STEP_MS, SPEECH_DELAY / 2);
    first.popupOk();
    now = runUntil(first, now, () => first.mode === VideoMode.NOT_DISPLAYED);
    expect(p.said).not.toContain(ConferenceQuote.CONTRACT_ACCEPTANCE);

    const next = new Conference(p, STEP_MS, memory);
    now = callFrom(next, now);
    next.hire();
    await flush();
    const length = nextQuote(next, p, now);
    expect([p.said.at(-1), next.mode]).toEqual([ConferenceQuote.LENGTH_OF_CONTRACT, VideoMode.HIRE]);
    advance(next, length, QUOTE_MS + 2 * STEP_MS);
    expect(next.mode).toBe(VideoMode.POPDOWN);
  });
});

describe('an A.I.M. conference left for another laptop program', () => {
  it('comes back to the contract page with the length and kit chosen, a new face and the contract length quote again', async () => {
    const memory = conferenceMemory();
    const p = ports();
    const left = new Conference(p, STEP_MS, memory);
    let now = connect(left);
    left.hire();
    await flush();
    now = advance(left, now, SPEECH_DELAY + QUOTE_MS + 2 * STEP_MS);
    left.setContract(ContractLength.TWO_WEEKS);
    left.setEquipment(false);
    const kept = left.modeKeptOnExit;
    left.close();
    expect(kept).toBe(VideoMode.HIRE);

    const faces = p.faces;
    const back = new Conference(p, STEP_MS, memory);
    back.resume(kept, now);
    expect([back.mode, back.face, p.faces - faces]).toEqual([VideoMode.HIRE, 'face', 1]);
    expect([back.contractLength, back.buyEquipment]).toEqual([ContractLength.TWO_WEEKS, false]);
    advance(back, now, SPEECH_DELAY + 2 * STEP_MS);
    expect(p.said.filter((quote) => quote === ConferenceQuote.LENGTH_OF_CONTRACT)).toHaveLength(2);
    expect(p.said.at(-1)).toBe(ConferenceQuote.LENGTH_OF_CONTRACT);
  });

  it('keeps the merc as impatient as he was', () => {
    const memory = conferenceMemory();
    const p = ports();
    const left = new Conference(p, STEP_MS, memory);
    const smallTalk = nextQuote(left, p, greeted(left, p));
    const quiet = runUntil(left, smallTalk, () => !left.talking);
    left.close();

    const back = new Conference(p, STEP_MS, memory);
    back.resume(VideoMode.FIRST_CONTACT, quiet);
    const impatient = nextQuote(back, p, quiet);
    expect(p.said.at(-1)).toBe(ConferenceQuote.IMPATIENT_QUOTE);
    expect(impatient - quiet).toBeGreaterThan(ATTITUDE_TIME);
  });

  it('goes on with the connection snow where it was and greets after it', () => {
    const memory = conferenceMemory();
    const p = ports();
    const left = new Conference(p, STEP_MS, memory);
    const up = faceUp(left);
    const now = runUntil(left, up, () => left.snowFrame === 3);
    left.close();

    const back = new Conference(p, STEP_MS, memory);
    back.resume(VideoMode.FIRST_CONTACT, now);
    expect(snowFrames(back, now)).toEqual([3, 4, 5, 0, 1, 2, 3, 4, 5]);
    expect(p.said).toEqual([ConferenceQuote.GREETING]);
  });

  it('plays the answering machine again, but closes at once, before it plays, when the hang-up after the message was pending', () => {
    const machine = ports();
    machine.answer = 'answeringMachine';
    const memory = conferenceMemory();
    const left = new Conference(machine, STEP_MS, memory);
    let now = connect(left);
    left.close();
    const back = new Conference(machine, STEP_MS, memory);
    back.resume(VideoMode.ANSWERING_MACHINE, now);
    advance(back, now, STEP_MS);
    expect([back.mode, machine.said]).toEqual([
      VideoMode.ANSWERING_MACHINE,
      [ConferenceQuote.ANSWERING_MACHINE_MSG, ConferenceQuote.ANSWERING_MACHINE_MSG],
    ]);

    const recorded = ports();
    recorded.answer = 'answeringMachine';
    const hangingUp = conferenceMemory();
    const leaving = new Conference(recorded, STEP_MS, hangingUp);
    now = connect(leaving);
    leaving.leaveMessage();
    leaving.popupOk();
    now = advance(leaving, now, STEP_MS);
    expect([leaving.mode, leaving.talking]).toEqual([VideoMode.ANSWERING_MACHINE, true]);
    const kept = leaving.modeKeptOnExit;
    leaving.close();
    const closing = new Conference(recorded, STEP_MS, hangingUp);
    closing.resume(kept, now);
    advance(closing, now, STEP_MS);
    expect([closing.mode, recorded.said]).toEqual([VideoMode.POPDOWN, [ConferenceQuote.ANSWERING_MACHINE_MSG]]);
  });

  it('comes back to a refusing merc with Hire disabled and hangs up at once, where the next merc on the page starts clean', async () => {
    const memory = conferenceMemory();
    const p = ports();
    p.accepted = false;
    const left = new Conference(p, STEP_MS, memory);
    let now = connect(left);
    left.hire();
    await flush();
    expect([left.mode, left.hireDisabled, left.talking]).toEqual([VideoMode.FIRST_CONTACT, false, true]);
    const kept = left.modeKeptOnExit;
    left.close();
    const back = new Conference(p, STEP_MS, memory);
    back.resume(kept, now);
    expect(back.hireDisabled).toBe(true);
    now = advance(back, now, STEP_MS);
    expect(back.mode).toBe(VideoMode.POPDOWN);

    const switched = new Conference(p, STEP_MS, conferenceMemory());
    now = connect(switched);
    switched.hire();
    await flush();
    switched.close();
    now = advance(switched, now, STEP_MS);
    callFrom(switched, now);
    expect([switched.mode, switched.hireDisabled]).toEqual([VideoMode.FIRST_CONTACT, false]);
  });

  it('keeps no conference when its box was up', async () => {
    const p = ports();
    const conference = new Conference(p, STEP_MS);
    connect(conference);
    conference.hire();
    await flush();
    conference.transferFunds();
    await flush();
    expect([conference.mode, conference.modeKeptOnExit]).toEqual([VideoMode.HIRE, VideoMode.NOT_DISPLAYED]);
    const back = new Conference(p, STEP_MS);
    back.resume(conference.modeKeptOnExit, 0);
    expect([back.mode, back.face]).toEqual([VideoMode.NOT_DISPLAYED, 'none']);
  });
});

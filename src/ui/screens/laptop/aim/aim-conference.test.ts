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
    say: (quote) => {
      p.said.push(quote);
      return QUOTE_MS;
    },
    stopTalking: () => undefined,
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
    expect(conference.answeringButtonsDisabled).toBe(true);
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

  it('times the subtitles by the quoted text and slides the title bar between its ends', () => {
    expect(talkingTime('Hi')).toBe(MINIMUM_TALKING_TIME);
    expect(talkingTime('x'.repeat(48))).toBe(50 * 80);
    expect(titleBarRect(0, 100, 30)).toEqual({ x: 331, y: 100, width: 74 });
    expect(titleBarRect(TITLE_ITERATIONS, 100, 30)).toEqual({ x: 125, y: 30, width: 365 });
  });
});

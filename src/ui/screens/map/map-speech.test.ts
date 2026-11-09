import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MapUiKit, type MapUiTest, mapUiKit, mapUiTest } from '../../../../tests/support/map-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import type { ViewFrame } from '../../../protocol/view.ts';
import { MouseButton } from '../../input/events.ts';
import { FINAL_TALKING_DELAY_MS, MIN_TALK_BEFORE_SKIP_MS, textDelay } from '../../speech.ts';

const LINE = 'Contract is up soon.';
const SHORT_LINE = 'Hm.';
const SUBTITLE_X = 110;
const SUBTITLE_Y = 40;
const QUOTE = 17;
const LINE_ROW = 17;

let kit: StubSectorKit;
let ui: MapUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await mapUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

async function withMap(run: (f: MapUiTest) => Promise<void>): Promise<void> {
  const f = await mapUiTest(kit, ui);
  try {
    await run(f);
  } finally {
    await f.dispose();
  }
}

function profileOf(f: MapUiTest, soldier: number): number {
  const profile = f.client.view.strategic?.mercs.find((m) => m.id === soldier)?.profile;
  if (profile === undefined) throw new Error(`merc ${soldier} has no profile`);
  return profile;
}

function mercLineFrame(f: MapUiTest, soldier: number, tick = f.client.view.tick, text = LINE): ViewFrame {
  const profile = profileOf(f, soldier);
  const textKey = { file: `mercedt/${String(profile).padStart(3, '0')}.edt`, row: LINE_ROW, width: 240 };
  const quote = {
    type: 'mercQuote',
    tick,
    soldier,
    profile,
    quote: `quote${QUOTE}`,
    id: QUOTE,
    textKey,
    chars: text.length,
    text,
  } as const;
  return { tick, changed: [], removed: [], events: [quote] };
}

function say(f: MapUiTest, soldier: number, text = LINE): ViewFrame {
  const frame = mercLineFrame(f, soldier, f.client.view.tick, text);
  f.frames([frame]);
  return frame;
}

function otherMerc(f: MapUiTest): number {
  const info = f.screen.hook().info;
  const other = f.mercs.find((id) => id !== info);
  if (other === undefined) throw new Error('the campaign has one merc');
  return other;
}

function skipLines(f: MapUiTest) {
  return f.client.commands.filter((c) => c.cmd.type === 'skipLine').map((c) => c.cmd);
}

function leaveAndEnter(f: MapUiTest): void {
  f.t.runtime.host.pop();
  f.t.runtime.host.push(f.screen);
  f.t.frame();
}

describe('merc lines on the map screen', () => {
  it("says a merc's contract acceptance on the map as the dialogue queue says it, and makes him the info character", () =>
    withMap(async (f) => {
      const speaker = otherMerc(f);
      const reply = await f.client.command({ type: 'extendContract', soldier: speaker, length: 'day' });
      expect(reply.ok, reply.reason).toBe(true);
      f.session.advance({ events: ['mercQuote'] });
      f.deliver();
      expect(f.speech.presenter.current?.line).toMatchObject({ surface: 'tactical', soldier: speaker, profile: profileOf(f, speaker) });
      expect(f.screen.hook().info).toBe(speaker);
      expect(f.screen.hook().subtitle).toBe(`"${f.speech.presenter.current?.line.text}"`);
    }));

  it('subtitles a merc line in a box at 110, 40 beside the info face until the line ends', () =>
    withMap(async (f) => {
      say(f, otherMerc(f));
      const geometry = f.t.runtime.geometry();
      const box = f.widget('speechTextBox');
      expect(box.rect).toMatchObject({ x: geometry.stdX + SUBTITLE_X, y: geometry.stdY + SUBTITLE_Y });
      expect(box.text).toBe(`"${LINE}"`);
      expect(f.screen.hook().subtitle).toBe(`"${LINE}"`);
      f.t.frame(textDelay(LINE.length) + FINAL_TALKING_DELAY_MS + 1);
      f.t.frame();
      expect(f.find('speechTextBox')).toBeUndefined();
    }));

  it('leaves the subtitle box out for a voiced line with subtitles off, and shows it for a line without a voice', () =>
    withMap(async (f) => {
      f.speech.voiced = true;
      f.speech.settings.subtitles = false;
      say(f, otherMerc(f));
      expect(f.speech.presenter.current).not.toBeNull();
      expect(f.find('speechTextBox')).toBeUndefined();
      f.speech.presenter.skip(f.t.now, true);
      f.speech.voiced = false;
      f.frames([mercLineFrame(f, otherMerc(f), f.client.view.tick + 1)]);
      expect(f.widget('speechTextBox').text).toBe(`"${LINE}"`);
    }));

  it('makes a merc who starts a line the info character with speech on, and keeps the info character with speech off', () =>
    withMap(async (f) => {
      const first = f.screen.hook().info;
      const speaker = otherMerc(f);
      f.speech.settings.speech = false;
      say(f, speaker);
      expect(f.screen.hook().info).toBe(first);
      expect(f.screen.hook().selected).toEqual([first]);
      f.speech.presenter.skip(f.t.now, true);
      f.speech.settings.speech = true;
      f.frames([mercLineFrame(f, speaker, f.client.view.tick + 1)]);
      expect(f.screen.hook().info).toBe(speaker);
      expect(f.screen.hook().selected).toEqual([speaker]);
    }));

  it('makes the merc still talking the info character as the map screen opens, whatever the speech option', () =>
    withMap(async (f) => {
      const first = f.screen.hook().info;
      const speaker = otherMerc(f);
      f.speech.settings.speech = false;
      say(f, speaker);
      expect(f.screen.hook().info).toBe(first);
      leaveAndEnter(f);
      expect(f.screen.hook().info).toBe(speaker);
    }));

  it('plays the line on while the map screen is away, and takes no line said meanwhile', () =>
    withMap(async (f) => {
      const speaker = otherMerc(f);
      const said = say(f, speaker);
      const line = f.speech.presenter.current?.line;
      f.t.runtime.host.pop();
      f.screen.frames([mercLineFrame(f, speaker, said.tick + 1)]);
      expect(f.speech.presenter.current?.line).toBe(line);
      expect(f.speech.presenter.queued).toHaveLength(0);
      f.t.runtime.host.push(f.screen);
      f.t.frame();
      expect(f.widget('speechTextBox').text).toBe(`"${LINE}"`);
    }));

  it('takes the lines of a frame once, whichever screen hears the frame first', () =>
    withMap(async (f) => {
      const frame = mercLineFrame(f, otherMerc(f));
      expect(f.speech.presenter.takesFrame(frame)).toBe(true);
      f.frames([frame]);
      expect(f.speech.presenter.current).toBeNull();
      expect(f.find('speechTextBox')).toBeUndefined();
    }));

  it('moves the lips of the info face while its merc talks', () =>
    withMap(async (f) => {
      say(f, otherMerc(f));
      expect(f.screen.hook().faceTalking).toBe(true);
      f.speech.presenter.skip(f.t.now, true);
      f.t.frame();
      expect(f.screen.hook().faceTalking).toBe(true);
      f.t.frame(FINAL_TALKING_DELAY_MS + 1);
      expect(f.screen.hook().faceTalking).toBe(false);
    }));
});

describe('cutting a line on the map screen', () => {
  it('cuts the line from a click on its box only after the first 500 ms, and reports the cut', () =>
    withMap(async (f) => {
      const speaker = otherMerc(f);
      const said = say(f, speaker);
      await f.click('speechTextBox');
      expect(f.speech.presenter.current).not.toBeNull();
      expect(skipLines(f)).toEqual([]);
      f.t.frame(MIN_TALK_BEFORE_SKIP_MS);
      await f.click('speechTextBox');
      expect(f.speech.presenter.current).toBeNull();
      expect(skipLines(f)).toEqual([{ type: 'skipLine', profile: profileOf(f, speaker), tick: said.tick }]);
    }));

  it('cuts the line at once from a left click on the info face, which a right click still toggles to the inventory', () =>
    withMap(async (f) => {
      say(f, otherMerc(f));
      await f.click('infoFace');
      expect(f.speech.presenter.current).toBeNull();
      expect(skipLines(f)).toHaveLength(1);
      expect(f.screen.hook().inventoryOpen).toBe(false);
      await f.click('infoFace', MouseButton.RIGHT);
      expect(f.screen.hook().inventoryOpen).toBe(true);
    }));

  it('cuts the line with Backspace at once, and has nothing to cut once the line is over', () =>
    withMap(async (f) => {
      f.speech.voiced = true;
      const speaker = otherMerc(f);
      const said = say(f, speaker);
      expect(f.speech.voices.map((v) => v.active)).toEqual([true]);
      f.key('Backspace');
      await f.settle();
      expect(f.speech.voices.map((v) => v.active)).toEqual([false]);
      expect(skipLines(f)).toEqual([{ type: 'skipLine', profile: profileOf(f, speaker), tick: said.tick }]);
      f.key('Backspace');
      await f.settle();
      expect(skipLines(f)).toHaveLength(1);
    }));

  it('cuts the line with Esc before Esc leaves the map screen', () =>
    withMap(async (f) => {
      say(f, otherMerc(f));
      f.key('Escape');
      await f.settle();
      expect(f.speech.presenter.current).toBeNull();
      expect(f.client.commands.map((c) => c.cmd.type)).toEqual(['skipLine']);
    }));

  it('cuts the line as the contract menu opens', () =>
    withMap(async (f) => {
      f.speech.voiced = true;
      f.speech.settings.subtitles = false;
      say(f, otherMerc(f));
      await f.click('contractButton');
      await f.settle();
      expect(f.screen.hook().menu).toBe('contract');
      expect(f.speech.presenter.current).toBeNull();
      expect(skipLines(f)).toHaveLength(1);
    }));

  it('opens no contract menu from the contract button or column while the subtitle box is up, but does from the c key', () =>
    withMap(async (f) => {
      const speaker = otherMerc(f);
      f.speech.settings.speech = false;
      say(f, speaker, SHORT_LINE);
      const box = f.widget('speechTextBox').rect;
      expect(box.x + box.width).toBeLessThan(f.widget('contractButton').rect.x);
      await f.click('contractButton');
      await f.settle();
      expect(f.screen.hook().menu).toBeNull();
      const row = f.screen.hook().rows.indexOf(speaker);
      await f.click(`teamRow${row}.departure`);
      await f.settle();
      expect(f.screen.hook().menu).toBeNull();
      expect(f.screen.hook().info).toBe(speaker);
      expect(f.speech.presenter.current).not.toBeNull();
      f.key('c');
      await f.settle();
      expect(f.screen.hook().menu).toBe('contract');
      expect(f.speech.presenter.current).toBeNull();
    }));

  it('cuts the line when the laptop opens', () =>
    withMap(async (f) => {
      say(f, otherMerc(f));
      await f.click('laptopButton');
      await f.settle();
      expect(f.client.commands.map((c) => c.cmd.type)).toEqual(['openLaptop', 'skipLine']);
      expect(f.speech.presenter.current).toBeNull();
    }));
});

const SKYRIDER = 97;
const FRED = 106;
const EXTERN_X = 320;
const EXTERN_Y = 40;
const EXTERN_TEXT_OFFSET = 97;
const POPUP = { width: 99, height: 98 };
const DRASSEN_MINE = 1;
const DRASSEN_MINE_FACE_Y = 135;
const AWAY_PROFILE = 30;

type Panel = { readonly monologue: 'drassenSam' | 'cambriaHospital' | 'otherSams' | 'estoniRefuel' } | { readonly mine: number };

interface ExternalExtras {
  readonly panel?: Panel;
  readonly sector?: string;
  readonly helicopter?: boolean;
}

function externalFrame(f: MapUiTest, profile: number, extra: ExternalExtras): ViewFrame {
  const tick = f.client.view.tick;
  const textKey = { file: `npcdata/${profile}.edt`, row: QUOTE, width: 240 };
  const said = { tick, profile, quote: QUOTE, textKey, chars: LINE.length, text: LINE, ...extra };
  const event =
    profile === SKYRIDER
      ? ({ type: 'skyriderQuote', ...said } as const)
      : ({ type: 'headMinerQuote', mine: DRASSEN_MINE, ...said } as const);
  return { tick, changed: [], removed: [], events: [event] };
}

function sayExternal(f: MapUiTest, profile: number, extra: ExternalExtras = {}): void {
  f.speech.presenter.skip(f.t.now, true);
  f.t.frame();
  f.frames([externalFrame(f, profile, extra)]);
}

describe("Skyrider's and the head miners' lines on the map screen (Dialogue_Control.cc HandleExternNPCSpeechFace)", () => {
  it('puts the face popup at the external panel and the subtitle box 97 to its right', () =>
    withMap(async (f) => {
      sayExternal(f, SKYRIDER);
      const { stdX, stdY } = f.t.runtime.geometry();
      expect(f.widget('speechFacePopup').rect).toEqual({ x: stdX + EXTERN_X, y: stdY + EXTERN_Y, ...POPUP });
      expect(f.widget('speechTextBox').rect).toMatchObject({ x: stdX + EXTERN_X + EXTERN_TEXT_OFFSET, y: stdY + EXTERN_Y });
      expect(f.screen.hook().subtitle).toBe(`"${LINE}"`);
    }));

  it("places the panel for each Skyrider monologue and clear of the miner's mine", () =>
    withMap(async (f) => {
      const { stdX, stdY } = f.t.runtime.geometry();
      const at = () => {
        const { x, y } = f.widget('speechFacePopup').rect;
        return [x - stdX, y - stdY];
      };
      sayExternal(f, SKYRIDER, { panel: { monologue: 'drassenSam' } });
      expect(at()).toEqual([EXTERN_X, 117]);
      sayExternal(f, SKYRIDER, { panel: { monologue: 'cambriaHospital' } });
      expect(at()).toEqual([EXTERN_X, 172]);
      sayExternal(f, SKYRIDER, { panel: { monologue: 'otherSams' } });
      expect(at()).toEqual([335, EXTERN_Y]);
      sayExternal(f, SKYRIDER, { panel: { monologue: 'estoniRefuel' } });
      expect(at()).toEqual([EXTERN_X, EXTERN_Y]);
      sayExternal(f, FRED, { panel: { mine: DRASSEN_MINE } });
      expect(at()).toEqual([EXTERN_X, DRASSEN_MINE_FACE_Y]);
      sayExternal(f, FRED, { panel: { mine: 0 } });
      expect(at()).toEqual([EXTERN_X, EXTERN_Y]);
    }));

  it('shows the popup only with speech on as the line starts, and the box with subtitles', () =>
    withMap(async (f) => {
      f.speech.settings.speech = false;
      sayExternal(f, SKYRIDER);
      expect(f.find('speechFacePopup')).toBeUndefined();
      expect(f.widget('speechTextBox').text).toBe(`"${LINE}"`);
      f.speech.settings.speech = true;
      f.t.frame();
      expect(f.find('speechFacePopup')).toBeUndefined();
    }));

  it('cuts the line from a click on the popup after its first 500 ms', () =>
    withMap(async (f) => {
      sayExternal(f, SKYRIDER);
      f.t.frame(MIN_TALK_BEFORE_SKIP_MS);
      await f.click('speechFacePopup');
      expect(f.speech.presenter.current).toBeNull();
      expect(skipLines(f)).toHaveLength(1);
    }));

  it("marks Skyrider's helicopter with the locator unless the aircraft show as his line starts", () =>
    withMap(async (f) => {
      sayExternal(f, SKYRIDER, { sector: 'B13', helicopter: true });
      expect(f.screen.hook().speakerLocator).toBe('B13');
      f.screen.filters.airspace = true;
      f.t.frame();
      expect(f.screen.hook().speakerLocator).toBe('B13');
      sayExternal(f, SKYRIDER, { sector: 'B13', helicopter: true });
      expect(f.screen.hook().speakerLocator).toBeNull();
      sayExternal(f, FRED, { sector: 'D13' });
      expect(f.screen.hook().speakerLocator).toBe('D13');
    }));
});

describe('a merc line without a soldier on the map screen (Dialogue_Control.cc HandleTacticalSpeechUI)', () => {
  function awayLineFrame(f: MapUiTest): ViewFrame {
    const tick = f.client.view.tick;
    const textKey = { file: `mercedt/0${AWAY_PROFILE}.edt`, row: LINE_ROW, width: 240 };
    const quote = {
      type: 'mercQuote',
      tick,
      soldier: -1,
      profile: AWAY_PROFILE,
      quote: `quote${QUOTE}`,
      id: QUOTE,
      textKey,
      chars: LINE.length,
      text: LINE,
      sector: 'C5',
    } as const;
    return { tick, changed: [], removed: [], events: [quote] };
  }

  it("puts it in the popup at the screen's 10, 20 with its box where a merc's goes, and marks the profile's sector", () =>
    withMap(async (f) => {
      f.frames([awayLineFrame(f)]);
      const { stdX, stdY } = f.t.runtime.geometry();
      expect(f.widget('speechFacePopup').rect).toEqual({ x: 10, y: 20, ...POPUP });
      expect(f.widget('speechTextBox').rect).toMatchObject({ x: stdX + SUBTITLE_X, y: stdY + SUBTITLE_Y });
      expect(f.screen.hook().speakerLocator).toBe('C5');
    }));
});

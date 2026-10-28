import { describe, expect, it } from 'vitest';
import {
  civQuoteLifetime,
  civQuoteOf,
  FINAL_TALKING_DELAY_MS,
  isQueuedQuoteEvent,
  type QuoteEvent,
  type SpeechLineRequest,
  SpeechPresenter,
  type SpeechRouting,
  type SpeechSettings,
  SpeechSurface,
  type SpeechVoice,
  speechLineOf,
  textDelay,
} from './speech.ts';

class FakeVoice implements SpeechVoice {
  active = true;
  playing = true;
  failed = false;
  elapsedMs = 0;
  stopped = false;
  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  stop(): void {
    this.stopped = true;
    this.active = false;
    this.playing = false;
  }

  end(): void {
    this.active = false;
    this.playing = false;
  }
}

function presenter(settings: Partial<SpeechSettings> = {}, voiced = true) {
  const voices: FakeVoice[] = [];
  const all: SpeechSettings = { speech: true, subtitles: true, keyAdvance: false, ...settings };
  const p = new SpeechPresenter({
    voices: voiced
      ? {
          play: (path) => {
            const v = new FakeVoice(path);
            voices.push(v);
            return v;
          },
        }
      : null,
    settings: () => all,
  });
  return { p, voices };
}

function line(overrides: Partial<SpeechLineRequest> = {}): SpeechLineRequest {
  return {
    surface: SpeechSurface.PANEL,
    profile: 94,
    soldier: 7,
    text: 'Hello there',
    chars: 11,
    voice: 'npc_speech/094_001.wav',
    sector: null,
    keyWait: true,
    ...overrides,
  };
}

const routing: SpeechRouting = {
  conversationProfile: 94,
  shopDealer: null,
  rpcSpeechPrefixed: false,
  recruited: () => false,
  text: (key) => `row ${key.row}`,
};

describe('SpeechPresenter', () => {
  it('times a line without a voice as 60 ms per character plus the 300 ms tail and shows its subtitle', () => {
    const { p } = presenter({ speech: false, subtitles: false });
    p.update(0);
    p.enqueue(line({ chars: 10 }));
    expect(p.current?.subtitles).toBe(true);
    expect(p.speaking?.playing).toBe(true);
    p.update(textDelay(10) - 1);
    expect(p.current?.phase).toBe('talking');
    p.update(textDelay(10));
    expect(p.current?.phase).toBe('tail');
    expect(p.speaking?.playing).toBe(false);
    p.update(textDelay(10) + FINAL_TALKING_DELAY_MS - 1);
    expect(p.busy).toBe(true);
    p.update(textDelay(10) + FINAL_TALKING_DELAY_MS);
    expect(p.busy).toBe(false);
  });

  it('follows the voice and hides the subtitle when subtitles are off', () => {
    const { p, voices } = presenter({ subtitles: false });
    p.update(0);
    p.enqueue(line());
    expect(voices).toHaveLength(1);
    expect(p.current?.subtitles).toBe(false);
    p.update(5000);
    expect(p.current?.phase).toBe('talking');
    voices[0]?.end();
    p.update(5100);
    expect(p.current?.phase).toBe('tail');
    p.update(5100 + FINAL_TALKING_DELAY_MS);
    expect(p.current).toBeNull();
  });

  it('falls back to the text duration and the subtitle when the voice file is missing', () => {
    const { p, voices } = presenter({ subtitles: false });
    p.update(0);
    p.enqueue(line({ chars: 5 }));
    const voice = voices[0] as FakeVoice;
    voice.failed = true;
    voice.active = false;
    expect(p.current?.subtitles).toBe(true);
    p.update(textDelay(5));
    expect(p.current?.phase).toBe('tail');
  });

  it('plays one line at a time in order and reports starts and ends', () => {
    const { p } = presenter({ speech: false });
    const started: number[] = [];
    const ended: number[] = [];
    p.onLineStarted((l) => started.push(l.profile));
    p.onLineEnded((l) => ended.push(l.profile));
    p.update(0);
    p.enqueue(line({ profile: 1, chars: 1 }));
    p.enqueue(line({ profile: 2, chars: 1 }));
    expect(started).toEqual([1]);
    p.update(textDelay(1) + FINAL_TALKING_DELAY_MS);
    expect(ended).toEqual([1]);
    expect(started).toEqual([1, 2]);
    expect(p.current?.line.profile).toBe(2);
  });

  it('ignores a click during the first 500 ms, skips after it and lets Backspace force', () => {
    const { p, voices } = presenter();
    p.update(0);
    p.enqueue(line());
    expect(p.skip(499, false)).toBe(false);
    expect(p.skip(500, false)).toBe(true);
    expect(voices[0]?.stopped).toBe(true);
    p.enqueue(line());
    expect(p.skip(501, true)).toBe(true);
    expect(p.busy).toBe(false);
  });

  it('waits for a key at the end of a panel line with key advance and subtitles', () => {
    const { p } = presenter({ speech: false, keyAdvance: true });
    p.update(0);
    p.enqueue(line({ chars: 2 }));
    p.update(textDelay(2) + 5000);
    expect(p.waitingForKey).toBe(true);
    expect(p.advanceKey(textDelay(2) + 5000)).toBe(true);
    expect(p.busy).toBe(false);
  });

  it('does not wait for a key on a merc line or on a voiced panel line without subtitles', () => {
    const merc = presenter({ speech: false, keyAdvance: true });
    merc.p.update(0);
    merc.p.enqueue(line({ surface: SpeechSurface.TACTICAL, keyWait: false, chars: 1 }));
    merc.p.update(textDelay(1));
    expect(merc.p.current?.phase).toBe('tail');
    const voiced = presenter({ subtitles: false, keyAdvance: true });
    voiced.p.update(0);
    voiced.p.enqueue(line());
    voiced.voices[0]?.end();
    voiced.p.update(10);
    expect(voiced.p.current?.phase).toBe('tail');
  });

  it('flushes the queue and the running line', () => {
    const { p, voices } = presenter();
    p.update(0);
    p.enqueue(line());
    p.enqueue(line());
    p.flush();
    expect(p.busy).toBe(false);
    expect(voices[0]?.stopped).toBe(true);
    expect(voices).toHaveLength(1);
  });

  it('reports a line stopped by a skip or a flush while talking, or by its voice ending, but not by its text timer or in its tail', () => {
    const { p, voices } = presenter();
    const stopped: string[] = [];
    p.onLineStopped((l, how) => stopped.push(`${l.profile} ${how}`));
    p.update(0);
    p.enqueue(line({ profile: 1 }));
    p.skip(600, false);
    p.enqueue(line({ profile: 2 }));
    p.flush();
    p.enqueue(line({ profile: 3 }));
    voices.at(-1)?.end();
    p.update(700);
    expect(p.current?.phase).toBe('tail');
    p.skip(800, true);
    expect(stopped).toEqual(['1 cut', '2 cut', '3 voiceEnded']);
    const silent = presenter({ speech: false });
    silent.p.onLineStopped((l, how) => stopped.push(`${l.profile} ${how}`));
    silent.p.update(0);
    silent.p.enqueue(line({ profile: 4, chars: 1 }));
    silent.p.update(textDelay(1) + FINAL_TALKING_DELAY_MS);
    expect(silent.p.busy).toBe(false);
    expect(stopped).toEqual(['1 cut', '2 cut', '3 voiceEnded']);
  });

  it('ends a line the server cut short without reporting it back, drops it from the queue, and closes the mouth of a text-timed one', () => {
    const { p, voices } = presenter();
    const stopped: number[] = [];
    p.onLineStopped((l) => stopped.push(l.profile));
    p.update(0);
    p.enqueue(line({ profile: 1, saidAt: 10 }));
    p.enqueue(line({ profile: 2, saidAt: 20 }));
    p.enqueue(line({ profile: 3, saidAt: 30 }));
    p.cut(3, 30, false);
    p.cut(1, 11, false);
    expect(p.current?.line.profile).toBe(1);
    p.cut(1, 10, true);
    expect(p.current?.phase).toBe('talking');
    p.cut(1, 10, false);
    expect(voices[0]?.stopped).toBe(true);
    p.update(1);
    expect(p.current?.line.profile).toBe(2);
    expect(p.queued).toHaveLength(0);
    expect(stopped).toEqual([]);
    const silent = presenter({ speech: false });
    silent.p.update(100);
    silent.p.enqueue(line({ profile: 4, saidAt: 40 }));
    silent.p.cut(4, 40, true);
    expect(silent.p.current?.phase).toBe('tail');
    silent.p.update(100 + FINAL_TALKING_DELAY_MS);
    expect(silent.p.busy).toBe(false);
  });

  it('shows no line the server skipped as it was said, and does not count it as one still to come', () => {
    const event = {
      type: 'npcQuote',
      tick: 5,
      profile: 94,
      soldier: 7,
      quote: 1,
      textKey: { file: 'npcdata/094.edt', row: 1, width: 240 },
      chars: 11,
      skipped: true,
    } as QuoteEvent;
    expect(speechLineOf(event, routing)).toBeNull();
    expect(isQueuedQuoteEvent(event)).toBe(false);
    expect(isQueuedQuoteEvent({ ...event, skipped: false } as QuoteEvent)).toBe(true);
  });

  it('keeps a civilian quote for its lifetime, replaces it, and closes it on a click after 300 ms', () => {
    const { p } = presenter();
    p.showCivQuote({ soldier: 3, text: 'Go away', chars: 7, hint: false }, 0);
    expect(civQuoteLifetime(7)).toBe(9 * 60 + 500);
    p.update(civQuoteLifetime(7) - 1);
    expect(p.civQuote?.text).toBe('Go away');
    expect(p.closeCivQuote(300, false)).toBe(false);
    p.showCivQuote({ soldier: 4, text: 'Hi', chars: 2, hint: false }, 400);
    expect(p.civQuote?.soldier).toBe(4);
    expect(p.closeCivQuote(701, false)).toBe(true);
    expect(p.civQuote).toBeNull();
  });
});

describe('speechLineOf', () => {
  const key = { file: 'npcdata/094.edt', row: 3, width: 240 };

  it('routes the conversation NPC to the panel with a key wait and its voice', () => {
    const event = { type: 'npcQuote', tick: 1, profile: 94, soldier: 7, quote: 3, textKey: key, chars: 5 } as QuoteEvent;
    const req = speechLineOf(event, routing);
    expect(req).toMatchObject({ surface: 'panel', profile: 94, soldier: 7, text: 'row 3', chars: 5, keyWait: true, saidAt: 1 });
    expect(req?.voice).toMatch(/094/);
  });

  it('routes another NPC and merc lines to the tactical surfaces', () => {
    const npc = { type: 'npcQuote', tick: 1, profile: 60, soldier: 9, quote: 3, textKey: key, chars: 5 } as QuoteEvent;
    expect(speechLineOf(npc, routing)?.surface).toBe('tactical');
    const merc = {
      type: 'mercQuote',
      tick: 1,
      soldier: 2,
      profile: 4,
      quote: 'quote5',
      id: 5,
      textKey: { file: 'mercedt/004.edt', row: 5, width: 240 },
      chars: 8,
      text: 'Got it!!',
      sector: 'A10',
    } as QuoteEvent;
    expect(speechLineOf(merc, routing)).toMatchObject({ surface: 'tactical', soldier: 2, text: 'Got it!!', sector: 'A10', keyWait: false });
  });

  it('routes Skyrider, head miners and dealers to their surfaces and skips lines without a text key', () => {
    const sky = { type: 'skyriderQuote', tick: 1, quote: 2, profile: 97, textKey: key, chars: 3 } as QuoteEvent;
    expect(speechLineOf(sky, routing)?.surface).toBe('external');
    const dealer = { type: 'shopkeeperQuote', tick: 1, dealer: 91, quote: 11, textKey: key, chars: 3 } as unknown as QuoteEvent;
    expect(speechLineOf(dealer, routing)?.surface).toBe('shopkeeper');
    const bare = { type: 'mercQuote', tick: 1, soldier: 2, profile: 4, quote: 'quote5', id: 5 } as QuoteEvent;
    expect(speechLineOf(bare, routing)).toBeNull();
  });

  it('drops a line that has neither text nor length, as a stub dealer without a dialogue file', () => {
    const silent = { ...routing, text: () => null };
    const dealer = { type: 'shopkeeperQuote', tick: 1, dealer: 91, quote: 11, textKey: key, chars: 0 } as unknown as QuoteEvent;
    expect(speechLineOf(dealer, silent)).toBeNull();
  });

  it('turns a civilian quote into the civilian box', () => {
    const civ = { type: 'civQuote', tick: 1, soldier: 12, quote: 2, entry: 0, hint: false, textKey: key, chars: 5 } as QuoteEvent;
    expect(civQuoteOf(civ, routing)).toEqual({ soldier: 12, text: 'row 3', chars: 5, hint: false });
  });
});

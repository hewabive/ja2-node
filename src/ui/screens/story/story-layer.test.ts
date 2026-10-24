import { describe, expect, it } from 'vitest';
import type { CampaignEndingView, ViewFrame } from '../../../protocol/view.ts';
import type { MessageBoxButtons, MessageBoxes, MessageBoxRequest } from '../../message-boxes.ts';
import { MessageString } from '../../text/string-ids.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { MessageBoxReturn } from '../../widgets/message-box.ts';
import { gameScreenOf } from '../front-end/flow.ts';
import { MEANWHILE_BOX, meanwhileBoxButtons, meanwhileBoxText } from './meanwhile-box.ts';
import { StoryLayer, type StoryPort } from './story-layer.ts';

const DRASSEN_LIBERATED = 1;
const TEXT: UiTextService = {
  string: (table, index) => (table === 'pMessageStrings' && index === MessageString.MEANWHILE ? 'Meanwhile' : null),
  edt: () => null,
};

interface Ask {
  readonly text: string;
  readonly buttons: MessageBoxButtons;
  readonly request: MessageBoxRequest | undefined;
  answer(result: number): void;
}

class FakePort implements StoryPort {
  readonly text = TEXT;
  readonly asks: Ask[] = [];
  readonly calls: string[] = [];
  readonly endings: CampaignEndingView[] = [];
  readonly seen = new Set<number>();
  shown = false;
  #fadeOut: (() => void) | null = null;
  #fadeIn: (() => void) | null = null;
  #ending: (() => void) | null = null;
  readonly boxes: MessageBoxes = {
    confirm: async () => true,
    alert: async () => undefined,
    ask: (text, buttons, request) =>
      new Promise((resolve) => {
        this.calls.push('box');
        this.asks.push({ text, buttons, request, answer: resolve });
      }),
  };

  sceneSeen(scene: number): boolean {
    return this.seen.has(scene);
  }

  fadeOut(): Promise<void> {
    this.calls.push('fadeOut');
    return new Promise((resolve) => {
      this.#fadeOut = resolve;
    });
  }

  clearBlack(): void {
    this.calls.push('clearBlack');
  }

  fadeIn(): Promise<void> {
    this.calls.push('fadeIn');
    return new Promise((resolve) => {
      this.#fadeIn = resolve;
    });
  }

  gameShown(): boolean {
    return this.shown;
  }

  ending(ending: CampaignEndingView): Promise<void> {
    this.calls.push('ending');
    this.endings.push(ending);
    return new Promise((resolve) => {
      this.#ending = resolve;
    });
  }

  finishFadeOut(): void {
    this.#fadeOut?.();
  }

  finishFadeIn(): void {
    this.#fadeIn?.();
  }

  finishEnding(): void {
    this.#ending?.();
  }
}

function frame(tick: number, events: readonly object[] = []): ViewFrame {
  return { tick, changed: [], removed: [], events: events as NonNullable<ViewFrame['events']> };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function story(): { port: FakePort; layer: StoryLayer; released: number[] } {
  const port = new FakePort();
  return { port, layer: new StoryLayer(port), released: [] };
}

describe('the meanwhile box (Meanwhile.cc BringupMeanwhileBox)', () => {
  it('reads "Meanwhile....." and offers Skip only for a scene seen before, never for the interrogation', () => {
    expect(meanwhileBoxText(TEXT)).toBe('Meanwhile.....');
    const seen = (scene: number) => scene === DRASSEN_LIBERATED;
    expect(meanwhileBoxButtons('drassenLiberated', seen)).toBe('okSkip');
    expect(meanwhileBoxButtons('cambriaLiberated', seen)).toBe('ok');
    expect(meanwhileBoxButtons('interrogation', () => true)).toBe('ok');
    expect(meanwhileBoxButtons('unknownScene', () => true)).toBe('ok');
  });
});

describe('the story layer (docs/28 §10)', () => {
  it('passes frames without a story event straight to the flow', () => {
    const { layer, released } = story();
    layer.frames([frame(1), frame(2)], (f) => released.push(...f.map((x) => x.tick)));
    expect(released).toEqual([1, 2]);
    expect(layer.holdsFlow).toBe(false);
  });

  it('holds the flow while a Meduna scene’s box is up and lets OK or Skip continue alike, marking nothing seen', async () => {
    const { port, layer, released } = story();
    const release = (f: readonly ViewFrame[]) => released.push(...f.map((x) => x.tick));
    port.seen.add(DRASSEN_LIBERATED);
    layer.frames([frame(1), frame(2, [{ type: 'meanwhile', seq: 1, scene: 'drassenLiberated', sector: 'P3', at: 60 }])], release);
    layer.frames([frame(3)], release);
    await settle();
    expect(port.asks).toHaveLength(1);
    expect(port.asks[0]).toMatchObject({ text: 'Meanwhile.....', buttons: 'okSkip', request: { id: MEANWHILE_BOX } });
    expect(released).toEqual([1]);
    expect(layer.holdsFlow).toBe(true);
    port.asks[0]?.answer(MessageBoxReturn.NO);
    await settle();
    expect(released).toEqual([1, 2, 3]);
    expect(layer.holdsFlow).toBe(false);
    expect(port.calls).toEqual(['box']);
    expect(layer.hook.meanwhileBoxes).toBe(1);
  });

  it('answers the interrogation’s OK box with a fade out, the flow released into N7 and a fade in once it is shown', async () => {
    const { port, layer, released } = story();
    layer.frames([frame(5, [{ type: 'meanwhileStarted', seq: 1, scene: 'interrogation' }])], (f) => released.push(...f.map((x) => x.tick)));
    await settle();
    expect(port.asks[0]?.buttons).toBe('ok');
    port.asks[0]?.answer(MessageBoxReturn.OK);
    await settle();
    expect(port.calls).toEqual(['box', 'fadeOut']);
    port.finishFadeOut();
    await settle();
    expect(released).toEqual([5]);
    expect(port.calls).toEqual(['box', 'fadeOut', 'clearBlack']);
    layer.frame();
    expect(port.calls).not.toContain('fadeIn');
    port.shown = true;
    layer.frame();
    expect(port.calls.at(-1)).toBe('fadeIn');
    expect(layer.holdsFlow).toBe(true);
    port.finishFadeIn();
    await settle();
    expect(layer.holdsFlow).toBe(false);
  });

  it('fades out and in around the squad’s move upstairs, then plays the ending from campaignWon and drops the rest', async () => {
    const { port, layer, released } = story();
    const release = (f: readonly ViewFrame[]) => released.push(...f.map((x) => x.tick));
    layer.frames([frame(10, [{ type: 'queenKilled', sector: 'P3', gridNo: 1, level: 0, killer: 2 }])], release);
    expect(released).toEqual([10]);
    layer.frames([frame(20, [{ type: 'squadMovedUpstairs', soldiers: [2], sector: 'P3' }])], release);
    layer.frames([frame(30, [{ type: 'campaignWon', ending: { miguelAlive: false, skyriderAlive: true } }])], release);
    await settle();
    expect(port.calls).toEqual(['fadeOut']);
    port.finishFadeOut();
    await settle();
    expect(released).toEqual([10, 20]);
    port.shown = true;
    layer.frame();
    port.finishFadeIn();
    await settle();
    expect(port.calls).toEqual(['fadeOut', 'clearBlack', 'fadeIn', 'fadeOut']);
    port.finishFadeOut();
    await settle();
    expect(port.endings).toEqual([{ miguelAlive: false, skyriderAlive: true }]);
    layer.frames([frame(40)], release);
    expect(released).toEqual([10, 20]);
    port.finishEnding();
    await settle();
    expect(layer.hook.endings).toBe(1);
    layer.reset();
    layer.frames([frame(50)], release);
    expect(released).toEqual([10, 20, 50]);
  });

  it('lets a reset end a wait for the game screen', async () => {
    const { port, layer, released } = story();
    layer.frames([frame(1, [{ type: 'squadMovedUpstairs', soldiers: [], sector: 'P3' }])], (f) => released.push(...f.map((x) => x.tick)));
    await settle();
    port.finishFadeOut();
    await settle();
    layer.reset();
    await settle();
    expect(layer.holdsFlow).toBe(false);
  });
});

describe('the screen of a story flow', () => {
  it('is the tactical screen for the interrogation, the endgame and a won campaign', () => {
    const viewOf = (flow: string) => ({ tick: 0, mapPath: null, soldiers: [], strategic: { flow } }) as never;
    expect(
      ['meanwhile', 'endgame', 'ended', 'tactical', 'strategic', 'laptop', 'autoresolve'].map((flow) => gameScreenOf(viewOf(flow))),
    ).toEqual(['tactical', 'tactical', 'tactical', 'tactical', 'map', 'laptop', 'map']);
  });
});

import { describe, expect, it } from 'vitest';
import type { CampaignEndingView, MeanwhilePromptView, ViewFrame } from '../../../protocol/view.ts';
import type { MessageBoxButtons, MessageBoxes, MessageBoxRequest } from '../../message-boxes.ts';
import { MessageString } from '../../text/string-ids.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { MessageBoxReturn } from '../../widgets/message-box.ts';
import { gameScreenOf } from '../front-end/flow.ts';
import { MEANWHILE_BOX, meanwhileBoxButtons, meanwhileBoxChoice, meanwhileBoxText } from './meanwhile-box.ts';
import { StoryLayer, type StoryPort } from './story-layer.ts';

const SEEN_SCENE_BOX: MeanwhilePromptView = { id: 'meanwhile-3', kind: 'meanwhile', scene: 'drassenLiberated', choices: ['ok', 'skip'] };
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
  readonly answers: (readonly [string, string])[] = [];
  prompt: MeanwhilePromptView | null = null;
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

  meanwhilePrompt(): MeanwhilePromptView | null {
    return this.prompt;
  }

  answer(prompt: string, choice: string): void {
    this.calls.push(`answer ${choice}`);
    this.answers.push([prompt, choice]);
    this.prompt = null;
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

describe('the meanwhile box (Meanwhile.cc BringupMeanwhileBox, BeginMeanwhileCallBack)', () => {
  it('reads "Meanwhile....." and offers Skip only when the simulation asks with the meanwhile prompt; OK or YES plays, anything else skips', () => {
    expect(meanwhileBoxText(TEXT)).toBe('Meanwhile.....');
    expect(meanwhileBoxButtons(SEEN_SCENE_BOX)).toBe('okSkip');
    expect(meanwhileBoxButtons(null)).toBe('ok');
    expect([MessageBoxReturn.OK, MessageBoxReturn.YES, MessageBoxReturn.NO].map(meanwhileBoxChoice)).toEqual(['ok', 'ok', 'skip']);
  });
});

describe('the story layer', () => {
  it('passes frames without a story event straight to the flow', () => {
    const { layer, released } = story();
    layer.frames([frame(1), frame(2)], (f) => released.push(...f.map((x) => x.tick)));
    expect(released).toEqual([1, 2]);
    expect(layer.holdsFlow).toBe(false);
  });

  it('holds the whole batch that brings a palace scene not seen yet while its OK box is up, since the view already shows the hall, then fades into it', async () => {
    const { port, layer, released } = story();
    const release = (f: readonly ViewFrame[]) => released.push(...f.map((x) => x.tick));
    layer.frames([frame(1), frame(2, [{ type: 'meanwhileStarted', seq: 1, scene: 'drassenLiberated' }])], release);
    layer.frames([frame(3)], release);
    await settle();
    expect(port.asks).toHaveLength(1);
    expect(port.asks[0]).toMatchObject({
      text: 'Meanwhile.....',
      buttons: 'ok',
      request: { id: MEANWHILE_BOX, viewer: { kind: 'meanwhile' } },
    });
    expect(released).toEqual([]);
    expect(layer.holdsFlow).toBe(true);
    port.asks[0]?.answer(MessageBoxReturn.OK);
    await settle();
    port.finishFadeOut();
    await settle();
    port.shown = true;
    layer.frame();
    port.finishFadeIn();
    await settle();
    expect(released).toEqual([1, 2, 3]);
    expect(layer.holdsFlow).toBe(false);
    expect(port.calls).toEqual(['box', 'fadeOut', 'clearBlack', 'fadeIn']);
    expect(layer.hook.meanwhileBoxes).toBe(1);
  });

  it('asks the meanwhile prompt of a scene seen before with OK and Skip, and Skip answers it with no fade', async () => {
    const { port, layer, released } = story();
    const release = (f: readonly ViewFrame[]) => released.push(...f.map((x) => x.tick));
    port.prompt = SEEN_SCENE_BOX;
    layer.frame();
    layer.frame();
    layer.frames([frame(4)], release);
    await settle();
    expect(port.asks).toHaveLength(1);
    expect(port.asks[0]).toMatchObject({ text: 'Meanwhile.....', buttons: 'okSkip', request: { id: MEANWHILE_BOX } });
    expect(port.asks[0]?.request?.viewer).toBeUndefined();
    expect([released, layer.holdsFlow]).toEqual([[], true]);
    port.asks[0]?.answer(MessageBoxReturn.NO);
    await settle();
    expect(port.answers).toEqual([['meanwhile-3', 'skip']]);
    expect([released, layer.holdsFlow, port.calls]).toEqual([[4], false, ['box', 'answer skip']]);
  });

  it('OK answers the prompt, and the scene it starts fades in with no second box', async () => {
    const { port, layer, released } = story();
    const release = (f: readonly ViewFrame[]) => released.push(...f.map((x) => x.tick));
    port.prompt = SEEN_SCENE_BOX;
    layer.frame();
    await settle();
    port.asks[0]?.answer(MessageBoxReturn.YES);
    await settle();
    expect(port.answers).toEqual([['meanwhile-3', 'ok']]);
    layer.frames([frame(5, [{ type: 'meanwhileStarted', seq: 1, scene: 'drassenLiberated', prompt: 'meanwhile-3' }])], release);
    await settle();
    port.finishFadeOut();
    await settle();
    port.shown = true;
    layer.frame();
    port.finishFadeIn();
    await settle();
    expect(released).toEqual([5]);
    expect(port.calls).toEqual(['box', 'answer ok', 'fadeOut', 'clearBlack', 'fadeIn']);
    expect(layer.hook.meanwhileBoxes).toBe(1);
  });

  it('closes the box of a prompt another viewer or an agent answered, without answering it again', async () => {
    const { port, layer } = story();
    port.prompt = SEEN_SCENE_BOX;
    layer.frame();
    await settle();
    expect(port.asks[0]?.request?.closeWhen?.()).toBe(false);
    port.prompt = null;
    expect(port.asks[0]?.request?.closeWhen?.()).toBe(true);
    port.asks[0]?.answer(MessageBoxReturn.NONE);
    await settle();
    expect([port.answers, layer.holdsFlow]).toEqual([[], false]);
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

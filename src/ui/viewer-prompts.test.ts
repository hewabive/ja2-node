import { beforeAll, describe, expect, it } from 'vitest';
import { projectLayoutLoader, testRuntime } from '../../tests/support/ui-runtime.ts';
import type { ViewerPromptView } from '../protocol/messages.ts';
import { messageBoxStyles } from './layout/styles.ts';
import { ORIGINAL_SKIN } from './layout/types.ts';
import { CanvasMessageBoxes } from './message-boxes.ts';
import { ViewerPrompt, type ViewerPromptPort, viewerBoxPrompt } from './viewer-prompts.ts';
import { MessageBoxFlag, type MessageBoxLabels, MessageBoxReturn, type MessageBoxStyle } from './widgets/message-box.ts';

const LABELS: MessageBoxLabels = {
  ok: 'OK',
  yes: 'Yes',
  no: 'No',
  rehire: 'Rehire',
  lie: 'Lie',
  skip: 'Skip',
  continue: 'Go',
  stop: 'Stop',
};
const MEANWHILE = { id: 'meanwhile-40', kind: 'meanwhile' };

class FakePort implements ViewerPromptPort {
  readonly shown: ViewerPromptView[] = [];
  readonly closed: [string, string | null][] = [];
  readonly answers = new Map<string, string>();

  showPrompt(prompt: ViewerPromptView): void {
    this.shown.push(prompt);
  }

  promptAnswer(id: string): string | null {
    return this.answers.get(id) ?? null;
  }

  closePrompt(id: string, choice: string | null): void {
    this.closed.push([id, choice]);
  }
}

let styles: readonly MessageBoxStyle[];

beforeAll(async () => {
  styles = messageBoxStyles(await projectLayoutLoader().load(ORIGINAL_SKIN, 'message-box'));
});

describe('viewer prompts', () => {
  it("offers a box's buttons as choices and tells the server the viewer's click", () => {
    const port = new FakePort();
    const prompt = viewerBoxPrompt(port, MEANWHILE, 'Meanwhile.....', MessageBoxFlag.OKSKIP);
    expect(port.shown).toEqual([{ id: 'meanwhile-40', kind: 'meanwhile', text: 'Meanwhile.....', choices: ['ok', 'skip'] }]);
    expect(prompt?.answered()).toBeNull();
    prompt?.closed(MessageBoxReturn.NO);
    expect(port.closed).toEqual([['meanwhile-40', 'skip']]);
  });

  it('closes with the choice made elsewhere and only withdraws it then', () => {
    const port = new FakePort();
    const prompt = new ViewerPrompt(port, { id: 'updateBox-7', kind: 'updateBox' }, 'Done:', [
      ['continue', 1],
      ['stop', 0],
    ]);
    port.answers.set('updateBox-7', 'stop');
    expect(prompt.answered()).toBe(0);
    prompt.closed(0);
    expect(port.closed).toEqual([['updateBox-7', null]]);
  });

  it('publishes nothing without a port, a reference or buttons it can name', () => {
    const port = new FakePort();
    expect(viewerBoxPrompt(null, MEANWHILE, 'text', MessageBoxFlag.OK)).toBeNull();
    expect(viewerBoxPrompt(port, undefined, 'text', MessageBoxFlag.OK)).toBeNull();
    expect(viewerBoxPrompt(port, MEANWHILE, 'text', MessageBoxFlag.FOUR_NUMBERED_BUTTONS)).toBeNull();
    expect(port.shown).toEqual([]);
  });

  it('closes an open message box with the answer another client gave', async () => {
    const t = await testRuntime();
    const port = new FakePort();
    const boxes = new CanvasMessageBoxes({
      services: t.runtime,
      style: (s) => styles[s] ?? (styles[0] as MessageBoxStyle),
      labels: () => LABELS,
      prompts: () => port,
    });
    const result = boxes.ask('Meanwhile.....', 'okSkip', { viewer: MEANWHILE });
    t.frame();
    expect(port.shown.map((p) => p.id)).toEqual(['meanwhile-40']);
    port.answers.set('meanwhile-40', 'skip');
    t.frame();
    expect(await result).toBe(MessageBoxReturn.NO);
    expect(port.closed).toEqual([['meanwhile-40', null]]);
  });
});

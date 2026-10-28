import { describe, expect, it } from 'vitest';
import { DrawList } from './draw-list.ts';
import type { UiInputEvent } from './input/events.ts';
import { type Modal, ScreenHost } from './screen.ts';

class Probe implements Modal {
  readonly id: string;
  readonly log: string[];
  readonly handles: boolean;
  readonly passesUnhandledInput: boolean;

  constructor(id: string, log: string[], handles = true, passes = false) {
    this.id = id;
    this.log = log;
    this.handles = handles;
    this.passesUnhandledInput = passes;
  }

  enter(): void {
    this.log.push(`${this.id}.enter`);
  }

  exit(): void {
    this.log.push(`${this.id}.exit`);
  }

  update(now: number): void {
    this.log.push(`${this.id}.update@${now}`);
  }

  input(event: UiInputEvent): boolean {
    this.log.push(`${this.id}.${event.kind}`);
    return this.handles;
  }

  render(list: DrawList): void {
    list.fill(0, 0, 1, 1, 0);
    this.log.push(`${this.id}.render`);
  }
}

const TEXT: UiInputEvent = { kind: 'text', text: 'a' };

describe('the screen and modal stacks', () => {
  it('enters and exits screens as they are pushed, replaced and popped', () => {
    const log: string[] = [];
    const host = new ScreenHost();
    host.push(new Probe('menu', log));
    host.push(new Probe('options', log));
    host.replace(new Probe('saves', log));
    expect(host.pop()?.id).toBe('saves');
    expect(host.screen?.id).toBe('menu');
    expect(log).toEqual(['menu.enter', 'menu.exit', 'options.enter', 'options.exit', 'saves.enter', 'saves.exit', 'menu.enter']);
  });

  it('gives modals input first, draws the screen below them but does not update it', () => {
    const log: string[] = [];
    const host = new ScreenHost();
    host.push(new Probe('tactical', log));
    const box = new Probe('box', log);
    host.openModal(box);
    log.length = 0;
    expect(host.input(TEXT)).toBe(true);
    host.update(16);
    const list = new DrawList();
    host.render(list);
    expect(log).toEqual(['box.text', 'box.update@16', 'tactical.render', 'box.render']);
    expect(list.items).toHaveLength(2);
    host.closeModal();
    log.length = 0;
    host.update(32);
    host.input(TEXT);
    expect(log).toEqual(['tactical.update@32', 'tactical.text']);
  });

  it('stops input at a blocking modal and lets a passing modal hand unhandled input down', () => {
    const log: string[] = [];
    const host = new ScreenHost();
    host.push(new Probe('map', log));
    host.openModal(new Probe('box', log, false));
    host.openModal(new Probe('popup', log, false, true));
    log.length = 0;
    expect(host.input(TEXT)).toBe(false);
    expect(log).toEqual(['popup.text', 'box.text']);
    host.closeModal(host.modals[0] ?? null);
    log.length = 0;
    host.input(TEXT);
    expect(log).toEqual(['popup.text', 'map.text']);
  });
});

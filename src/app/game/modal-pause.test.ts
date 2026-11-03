import { describe, expect, it } from 'vitest';
import { ModalPause, type TimeHolder } from './modal-pause.ts';

class FakeHolder implements TimeHolder {
  readonly sent: [string, boolean][] = [];

  hold(reason: string, held: boolean): void {
    this.sent.push([reason, held]);
  }
}

describe('the modal pause', () => {
  it('holds time for the outermost modal and releases it after the last one', () => {
    const client = new FakeHolder();
    const pause = new ModalPause(() => client);
    pause.set(true);
    pause.set(true);
    expect(client.sent).toEqual([['modal', true]]);
    pause.set(false);
    expect(client.sent).toHaveLength(1);
    pause.set(false);
    expect(client.sent).toEqual([
      ['modal', true],
      ['modal', false],
    ]);
    pause.set(false);
    expect(pause.depth).toBe(0);
  });

  it('holds nothing without a session', () => {
    const none = new ModalPause(() => null);
    none.set(true);
    expect(none.holding).toBe(false);
    none.set(false);
    expect(none.depth).toBe(0);
  });

  it('releases the hold on the session it was taken on, not on a session opened meanwhile', () => {
    let current = new FakeHolder();
    const pause = new ModalPause(() => current);
    pause.set(true);
    const first = current;
    current = new FakeHolder();
    pause.set(false);
    expect(first.sent).toEqual([
      ['modal', true],
      ['modal', false],
    ]);
    expect(current.sent).toEqual([]);
  });
});

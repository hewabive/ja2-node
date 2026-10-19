import { describe, expect, it } from 'vitest';
import type { DriverMode } from '../../protocol/messages.ts';
import { type DriverControl, ModalPause } from './modal-pause.ts';

class FakeDriver implements DriverControl {
  driver: DriverMode;
  readonly sent: DriverMode[] = [];

  constructor(driver: DriverMode) {
    this.driver = driver;
  }

  async drive(driver: DriverMode): Promise<void> {
    this.driver = driver;
    this.sent.push(driver);
  }
}

const REALTIME: DriverMode = { mode: 'realtime', speed: 1 };

describe('the modal pause of the real-time driver', () => {
  it('switches a running session to manual for the outermost modal and restores it after the last one', () => {
    const client = new FakeDriver(REALTIME);
    const pause = new ModalPause(() => client);
    pause.set(true);
    pause.set(true);
    expect(client.sent).toEqual([{ mode: 'manual' }]);
    pause.set(false);
    expect(client.sent).toHaveLength(1);
    pause.set(false);
    expect(client.sent).toEqual([{ mode: 'manual' }, REALTIME]);
    pause.set(false);
    expect(pause.depth).toBe(0);
  });

  it('leaves a manual session and a missing session alone', () => {
    const manual = new FakeDriver({ mode: 'manual' });
    const pause = new ModalPause(() => manual);
    pause.set(true);
    pause.set(false);
    expect(manual.sent).toEqual([]);
    const none = new ModalPause(() => null);
    none.set(true);
    expect(none.holding).toBe(false);
  });

  it('does not restore the driver of another session or one the player changed meanwhile', () => {
    let current = new FakeDriver(REALTIME);
    const pause = new ModalPause(() => current);
    pause.set(true);
    const first = current;
    current = new FakeDriver(REALTIME);
    pause.set(false);
    expect(first.sent).toEqual([{ mode: 'manual' }]);
    expect(current.sent).toEqual([]);
    pause.set(true);
    void current.drive({ mode: 'instant' });
    pause.set(false);
    expect(current.sent).toEqual([{ mode: 'manual' }, { mode: 'instant' }]);
  });
});

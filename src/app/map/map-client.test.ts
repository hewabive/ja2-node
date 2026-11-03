import { describe, expect, it } from 'vitest';
import type { DriverMode } from '../../protocol/messages.ts';
import type { PlayerView } from '../../protocol/view.ts';
import type { HintProvider } from '../hints/hint-provider.ts';
import type { SessionClient } from '../net/session-client.ts';
import { SessionMapClient } from './map-client.ts';

class FakeSession {
  latestView: PlayerView | null = null;
  driver: DriverMode = { mode: 'manual' };
  readonly drives: DriverMode['mode'][] = [];
  readonly held = new Set<string>();
  shownTick = 0;
  latestTick = 0;

  async drive(driver: DriverMode): Promise<void> {
    this.driver = driver;
    this.drives.push(driver.mode);
  }

  hold(reason: string, held: boolean): void {
    if (held) this.held.add(reason);
    else this.held.delete(reason);
  }
}

const TACTICAL_REAL_TIME: DriverMode = { mode: 'realtime', speed: 1 };

function viewIn(flow: string): PlayerView {
  return { strategic: { flow } } as unknown as PlayerView;
}

function mapClientOn(session: FakeSession): SessionMapClient {
  return new SessionMapClient(session as unknown as SessionClient, {} as HintProvider);
}

describe('the map client clock', () => {
  it('runs time on the strategic map and leaves it stopped while an autoresolve battle owns the clock', () => {
    const session = new FakeSession();
    session.latestView = viewIn('strategic');
    const client = mapClientOn(session);
    client.start();
    expect(session.drives).toEqual(['realtime']);
    session.latestView = viewIn('autoresolve');
    client.sync();
    expect(session.drives).toEqual(['realtime', 'manual']);
    client.sync();
    expect(session.drives).toEqual(['realtime', 'manual']);
  });

  it('does not start time when the pre-battle prompt closes into an autoresolve battle', () => {
    const session = new FakeSession();
    session.latestView = { ...viewIn('strategic'), prompt: { kind: 'preBattle' } } as unknown as PlayerView;
    const client = mapClientOn(session);
    client.start();
    expect(session.drives).toEqual([]);
    session.latestView = viewIn('autoresolve');
    client.sync();
    expect(session.drives).toEqual([]);
  });

  it('stops real time on the events that open a box: the update box, the lost sector box and the invasion box', () => {
    const session = new FakeSession();
    session.latestView = viewIn('strategic');
    mapClientOn(session).start();
    expect(session.driver).toEqual({
      mode: 'realtime',
      speed: 1,
      pauseOn: ['assignmentDone', 'fellAsleep', 'wokeUp', 'contractsExpiringSoon', 'sectorLost', 'invasion'],
    });
  });

  it('holds time on the server for its boxes and its pause and keeps the driver running', () => {
    const session = new FakeSession();
    session.latestView = viewIn('strategic');
    const client = mapClientOn(session);
    client.start();
    client.holdTime('updateBox', true);
    expect([...session.held]).toEqual(['map']);
    client.holdTime('updateBox', false);
    client.setPaused(true);
    expect([...session.held]).toEqual(['map']);
    client.setPaused(false);
    expect([...session.held]).toEqual([]);
    expect(session.drives).toEqual(['realtime']);
  });

  it('takes over a real-time driver without its box events on entering the map and leaves it alone on leaving', () => {
    const session = new FakeSession();
    session.latestView = viewIn('strategic');
    session.driver = TACTICAL_REAL_TIME;
    const client = mapClientOn(session);
    client.start();
    expect(session.drives).toEqual(['realtime']);
    expect(session.driver.mode === 'realtime' && session.driver.pauseOn).toBeTruthy();
    session.driver = TACTICAL_REAL_TIME;
    client.stop();
    expect(session.drives).toEqual(['realtime']);
  });

  it('restarts real time at once after the server stopped it and holds it until the page has played up to the stop', () => {
    const session = new FakeSession();
    session.latestView = viewIn('strategic');
    const client = mapClientOn(session);
    client.start();
    session.driver = { mode: 'manual' };
    session.latestTick = 40;
    client.sync();
    expect(session.drives).toEqual(['realtime', 'realtime']);
    expect([...session.held]).toEqual(['map']);
    session.shownTick = 40;
    client.sync();
    expect([...session.held]).toEqual([]);
  });
});

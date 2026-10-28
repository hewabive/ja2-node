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
  shownTick = 0;
  latestTick = 0;

  async drive(driver: DriverMode): Promise<void> {
    this.driver = driver;
    this.drives.push(driver.mode);
  }
}

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
});

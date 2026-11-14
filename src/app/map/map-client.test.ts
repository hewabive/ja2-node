import { describe, expect, it } from 'vitest';
import type { CommandEnvelope, DriverMode } from '../../protocol/messages.ts';
import type { PlayerView } from '../../protocol/view.ts';
import type { HintProvider } from '../hints/hint-provider.ts';
import type { CommandReply, SessionClient } from '../net/session-client.ts';
import { SessionMapClient } from './map-client.ts';

class FakeSession {
  latestView: PlayerView | null = null;
  driver: DriverMode = { mode: 'manual' };
  realtimeSpeed = 1;
  readonly drives: DriverMode['mode'][] = [];
  readonly held = new Set<string>();
  shownTick = 0;
  latestTick = 0;
  readonly sent: CommandEnvelope[] = [];
  reply: CommandReply = { ok: true };

  async command(cmd: CommandEnvelope): Promise<CommandReply> {
    this.sent.push(cmd);
    return this.reply;
  }

  async drive(driver: DriverMode): Promise<void> {
    this.driver = driver;
    if (driver.mode === 'realtime') this.realtimeSpeed = driver.speed;
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

  it('stops real time on the events that open a box: the update box, the lost sector, invasion, out-of-gas and militia boxes', () => {
    const session = new FakeSession();
    session.latestView = viewIn('strategic');
    mapClientOn(session).start();
    expect(session.driver).toEqual({
      mode: 'realtime',
      speed: 1,
      pauseOn: [
        'assignmentDone',
        'fellAsleep',
        'wokeUp',
        'contractsExpiringSoon',
        'sectorLost',
        'invasion',
        'vehicleOutOfGas',
        'militiaTrainingRejected',
      ],
    });
  });

  it('holds time on the server for its boxes and its pause and keeps the driver running', () => {
    const session = new FakeSession();
    session.latestView = viewIn('strategic');
    const client = mapClientOn(session);
    client.start();
    client.holdTime('updateBox', true);
    expect([...session.held]).toEqual(['updateBox']);
    client.holdTime('updateBox', false);
    client.setPaused(true);
    expect([...session.held]).toEqual(['mapPaused']);
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

  it('keeps the speed the session last ran at in real time, adding its box events, and restarts at it after a stop', () => {
    const session = new FakeSession();
    session.latestView = viewIn('strategic');
    session.driver = { mode: 'realtime', speed: 4 };
    session.realtimeSpeed = 4;
    const client = mapClientOn(session);
    client.start();
    expect(session.driver).toMatchObject({ mode: 'realtime', speed: 4, pauseOn: expect.arrayContaining(['sectorLost']) });
    session.driver = { mode: 'manual' };
    client.sync();
    expect(session.driver).toMatchObject({ mode: 'realtime', speed: 4 });
    expect(session.drives).toEqual(['realtime', 'realtime']);
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
    expect([...session.held]).toEqual(['catchingUp']);
    session.shownTick = 40;
    client.sync();
    expect([...session.held]).toEqual([]);
  });
});

describe('the map client commands', () => {
  it('sends a command while the player pauses: the pause holds time and the screen masks itself, as the original refuses nothing', async () => {
    const session = new FakeSession();
    session.latestView = viewIn('strategic');
    const client = mapClientOn(session);
    client.start();
    client.setPaused(true);
    expect(await client.command({ type: 'answer', choice: 'yes' })).toEqual({ ok: true });
    expect(session.sent).toEqual([{ type: 'answer', choice: 'yes' }]);
    expect([...session.held]).toEqual(['mapPaused']);
  });

  it('hands every refused reply to the listener the screen set, and none after it is cleared', async () => {
    const session = new FakeSession();
    const client = mapClientOn(session);
    const heard: unknown[] = [];
    client.onRefused((reply) => heard.push(reply));
    await client.command({ type: 'stopTime' });
    session.reply = { ok: false, reason: 'promptOpen: a prompt is open, answer it first', data: { refusal: 'promptOpen' } };
    await client.command({ type: 'stopTime' });
    client.onRefused(null);
    await client.command({ type: 'stopTime' });
    expect(heard).toEqual([session.reply]);
  });
});

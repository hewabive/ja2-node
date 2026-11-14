import { describe, expect, it } from 'vitest';
import type { CommandEnvelope, DriverMode } from '../../protocol/messages.ts';
import type { HintProvider } from '../hints/hint-provider.ts';
import type { CommandReply, SessionClient } from '../net/session-client.ts';
import { SessionTacticalClient } from './tactical-client.ts';

class FakeSession {
  driver: DriverMode = { mode: 'manual' };
  realtimeSpeed = 1;
  readonly drives: DriverMode[] = [];
  readonly held = new Set<string>();
  commandShown: (cmd: CommandEnvelope) => Promise<CommandReply> = async () => ({ ok: true });

  async drive(driver: DriverMode): Promise<void> {
    this.driver = driver;
    this.drives.push(driver);
  }

  hold(reason: string, held: boolean): void {
    if (held) this.held.add(reason);
    else this.held.delete(reason);
  }
}

function tacticalClientOn(session: FakeSession): SessionTacticalClient {
  return new SessionTacticalClient(session as unknown as SessionClient, {} as HintProvider, false);
}

describe('the tactical client clock', () => {
  it('runs a stopped session in real time at the speed it last ran at and leaves a running driver alone', () => {
    const session = new FakeSession();
    session.realtimeSpeed = 2;
    const client = tacticalClientOn(session);
    client.start();
    expect(session.drives).toEqual([{ mode: 'realtime', speed: 2 }]);
    session.driver = { mode: 'realtime', speed: 8 };
    client.sync();
    expect(session.drives).toHaveLength(1);
  });
});

describe('the tactical client commands', () => {
  it('answers a command once the shown view holds its frames, so the panels keep their cursor until then', async () => {
    const session = new FakeSession();
    const client = tacticalClientOn(session);
    let shown: (reply: CommandReply) => void = () => undefined;
    session.commandShown = () =>
      new Promise((resolve) => {
        shown = resolve;
      });
    let answered = false;
    void client.command({ type: 'moveItem' }).then(() => {
      answered = true;
    });
    await Promise.resolve();
    expect(answered).toBe(false);
    shown({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(answered).toBe(true);
    expect(client.commands).toEqual([{ cmd: { type: 'moveItem' }, reply: { ok: true } }]);
  });
});

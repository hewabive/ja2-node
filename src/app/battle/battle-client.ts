import type { CommandEnvelope, DriverMode, StopCondition } from '../../protocol/messages.ts';
import type { PlayerView } from '../../protocol/view.ts';
import type { BattleClient, BattleReply } from '../../ui/screens/battle/environment.ts';
import type { SessionClient } from '../net/session-client.ts';

export interface BattleCommandRecord {
  readonly cmd: CommandEnvelope;
  readonly reply: BattleReply;
}

export class SessionBattleClient implements BattleClient {
  readonly commands: BattleCommandRecord[] = [];
  readonly drives: DriverMode[] = [];
  readonly #session: SessionClient;

  constructor(session: SessionClient) {
    this.#session = session;
  }

  get view(): PlayerView | null {
    return this.#session.view;
  }

  async command(cmd: CommandEnvelope): Promise<BattleReply> {
    const reply = await this.#session.command(cmd);
    this.commands.push({ cmd, reply });
    return reply;
  }

  drive(driver: DriverMode): void {
    this.drives.push(driver);
    void this.#session.drive(driver);
  }

  async advance(until: StopCondition): Promise<void> {
    await this.#session.advance(until);
  }

  showLatest(): void {
    this.#session.skipToLatest();
  }
}

import type { CommandEnvelope } from '../protocol/messages.ts';

export interface HintAnswer {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: unknown;
}

export type HintAnswerSource = 'local' | 'server';

export type HintReply =
  | { readonly state: 'pending' }
  | { readonly state: 'ready'; readonly answer: HintAnswer; readonly source: HintAnswerSource };

export const PENDING_HINT: HintReply = { state: 'pending' };

export interface GameClient {
  hint(request: CommandEnvelope): HintReply;
  hintNow(request: CommandEnvelope): Promise<HintAnswer>;
  query(request: CommandEnvelope): Promise<HintAnswer>;
}

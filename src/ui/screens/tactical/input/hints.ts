import type { CommandEnvelope } from '../../../../protocol/messages.ts';
import type { GameClient, HintAnswer } from '../../../game-client.ts';

export type HintState<T> =
  | { readonly state: 'pending' }
  | { readonly state: 'ok'; readonly data: T }
  | { readonly state: 'refused'; readonly refusal: string; readonly data: unknown };

const PENDING = { state: 'pending' } as const;

function refusalOf(answer: HintAnswer): string {
  const data = answer.data as { readonly refusal?: unknown } | undefined;
  return typeof data?.refusal === 'string' ? data.refusal : (answer.reason ?? 'refused');
}

export function stateOf<T>(answer: HintAnswer): HintState<T> {
  return answer.ok ? { state: 'ok', data: answer.data as T } : { state: 'refused', refusal: refusalOf(answer), data: answer.data };
}

export function hintState<T>(client: GameClient, request: CommandEnvelope): HintState<T> {
  const reply = client.hint(request);
  return reply.state === 'ready' ? stateOf<T>(reply.answer) : PENDING;
}

export async function hintNow<T>(client: GameClient, request: CommandEnvelope): Promise<HintState<T>> {
  return stateOf<T>(await client.hintNow(request));
}

export function dataOf<T>(state: HintState<T>): T | null {
  return state.state === 'ok' ? state.data : null;
}

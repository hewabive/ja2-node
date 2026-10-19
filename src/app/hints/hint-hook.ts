import type { CommandEnvelope } from '../../protocol/messages.ts';
import type { HintAnswer, HintReply } from '../../ui/game-client.ts';
import type { UiHook } from '../game/ui-hook.ts';
import type { HintProvider, HintStats } from './hint-provider.ts';

export interface HintHook {
  ready: boolean;
  usable: boolean;
  error: string | null;
  shadow: boolean;
  last: { readonly request: CommandEnvelope; readonly reply: HintReply } | null;
  readonly stats: HintStats;
  hintNow(request: CommandEnvelope): Promise<HintAnswer>;
  query(request: CommandEnvelope): Promise<HintAnswer>;
  resetStats(): void;
}

declare module '../game/ui-hook.ts' {
  interface UiHook {
    hints?: HintHook;
  }
}

export function createHintHook(provider: HintProvider): HintHook {
  return {
    ready: false,
    usable: false,
    error: null,
    shadow: provider.shadow,
    last: null,
    get stats() {
      return provider.stats;
    },
    hintNow: (request) => provider.hintNow(request),
    query: (request) => provider.query(request),
    resetStats: () => provider.resetStats(),
  };
}

export function attachHintHook(hook: HintHook): void {
  const existing = (window as { __ja2Ui?: UiHook }).__ja2Ui;
  if (existing) existing.hints = hook;
  else (window as { __ja2Ui?: Partial<UiHook> }).__ja2Ui = { hints: hook };
}

import type { EngineIdentityView } from '../../protocol/messages.ts';

declare const __JA2_ENGINE__: EngineIdentityView | undefined;

const UNKNOWN_ENGINE: EngineIdentityView = { version: 'unknown', commit: 'unknown' };

export function clientEngineIdentity(): EngineIdentityView {
  return typeof __JA2_ENGINE__ === 'object' && __JA2_ENGINE__ !== null ? __JA2_ENGINE__ : UNKNOWN_ENGINE;
}

export function sameEngine(a: EngineIdentityView, b: EngineIdentityView): boolean {
  return a.commit !== UNKNOWN_ENGINE.commit && a.version === b.version && a.commit === b.commit;
}

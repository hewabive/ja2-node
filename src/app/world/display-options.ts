import type { ClientSettings } from '../../ui/settings.ts';
import { DEFAULT_TACTICAL_OPTIONS, type TacticalDisplayOptions } from './tactical-world-view.ts';

export interface TacticalStatusOptions {
  readonly redItemGlow: boolean;
}

export function tacticalOptionsOf(settings: Pick<ClientSettings, 'display'>, status?: TacticalStatusOptions): TacticalDisplayOptions {
  const display = settings.display;
  return {
    ...DEFAULT_TACTICAL_OPTIONS,
    redItemGlow: status?.redItemGlow ?? DEFAULT_TACTICAL_OPTIONS.redItemGlow,
    treeTops: display.treeTops,
    wireframes: display.wireframe,
    glowItems: display.glowItems,
    mercCastsLight: display.mercCastsLight,
    mercAlwaysLit: display.mercAlwaysLightUp,
    hideBullets: display.hideBullets,
  };
}

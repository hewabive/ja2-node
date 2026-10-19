import type { ClientSettings } from '../../ui/settings.ts';
import { DEFAULT_TACTICAL_OPTIONS, type TacticalDisplayOptions } from './tactical-world-view.ts';

export function tacticalOptionsOf(settings: Pick<ClientSettings, 'display'>): TacticalDisplayOptions {
  const display = settings.display;
  return {
    ...DEFAULT_TACTICAL_OPTIONS,
    treeTops: display.treeTops,
    wireframes: display.wireframe,
    glowItems: display.glowItems,
    mercCastsLight: display.mercCastsLight,
    mercAlwaysLit: display.mercAlwaysLightUp,
  };
}

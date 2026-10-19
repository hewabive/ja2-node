// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/RenderWorld.cc RenderTiles (the glow: our turn or the baton holder, grey when the selected
// @src merc does not see the soldier and he is neither on fire nor exploding, the highlighted bad guy). See docs/28 §6.5.

import type { CombatView, SoldierView } from '../../protocol/view.ts';
import { type GlowContext, glowFrame } from '../../render/world/glow.ts';

const OUR_TEAM = 0;

export interface GlowInput {
  readonly soldiers: readonly SoldierView[];
  readonly combat: CombatView | null;
  readonly clockMs: number;
  readonly hovered: number | null;
  readonly selected: number | null;
  readonly hostile: (s: SoldierView) => boolean;
  readonly ungreyed: (s: SoldierView) => boolean;
  readonly underAiControl: (id: number) => boolean;
}

export function glowContext(input: GlowInput): GlowContext {
  const byId = new Map(input.soldiers.map((s) => [s.id, s] as const));
  const hovered = input.hovered === null ? undefined : byId.get(input.hovered);
  const selected = input.selected === null ? undefined : byId.get(input.selected);
  const sees = selected?.sees ? new Set(selected.sees) : null;
  return {
    ourTurn: !input.combat || input.combat.team === OUR_TEAM,
    frame: glowFrame(input.clockMs),
    hovered: input.hovered,
    hoveredHostile: !!hovered && input.hostile(hovered),
    selectedSees: (id) => {
      if (!sees) return null;
      const s = byId.get(id);
      return sees.has(id) || (!!s && input.ungreyed(s));
    },
    underAiControl: input.underAiControl,
  };
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface.h ARROWS_*; src/game/Tactical/Interface.cc RenderArrows (SECONDPOINTERS2, 3, 4, 7
// @src and 8, the second arrow 20 pixels lower), GetArrowsBackground (ARROWS_X_OFFSET 10, UPARROW_Y_OFFSET -30,
// @src DOWNARROW_Y_OFFSET -10, the above and below positions at -10 / -50, -70 and +10 from the merc's true screen
// @src position). See docs/28 §6.4.

import type { ScreenPoint } from '../environment.ts';

export const Arrows = {
  SHOW_UP_BESIDE: 0x8,
  SHOW_DOWN_BESIDE: 0x20,
  SHOW_UP_ABOVE_Y: 0x40,
  SHOW_DOWN_BELOW_Y: 0x80,
  SHOW_DOWN_BELOW_YG: 0x400,
  SHOW_DOWN_BELOW_GG: 0x800,
  SHOW_UP_ABOVE_YY: 0x20000,
  SHOW_DOWN_BELOW_YY: 0x40000,
  SHOW_UP_ABOVE_CLIMB: 0x80000,
  SHOW_DOWN_CLIMB: 0x2000000,
} as const;

export interface ArrowSprite {
  readonly tile: string;
  readonly x: number;
  readonly y: number;
}

const ARROWS_X_OFFSET = 10;
const UPARROW_Y_OFFSET = -30;
const DOWNARROW_Y_OFFSET = -10;
const SECOND_ARROW_Y = 20;
const ABOVE_X = -10;
const ABOVE_Y = -50;
const ABOVE_YY = -70;
const BELOW_Y = 10;
const UP = 'SECONDPOINTERS3';
const DOWN = 'SECONDPOINTERS4';
const CLIMB_UP = 'SECONDPOINTERS8';
const CLIMB_DOWN = 'SECONDPOINTERS7';
const GREEN_DOWN = 'SECONDPOINTERS2';

function upAnchor(flags: number, merc: ScreenPoint): ScreenPoint {
  if (flags & (Arrows.SHOW_UP_ABOVE_YY | Arrows.SHOW_UP_ABOVE_CLIMB)) return { x: merc.x + ABOVE_X, y: merc.y + ABOVE_YY };
  if (flags & Arrows.SHOW_UP_ABOVE_Y) return { x: merc.x + ABOVE_X, y: merc.y + ABOVE_Y };
  return { x: merc.x + ARROWS_X_OFFSET, y: merc.y + UPARROW_Y_OFFSET };
}

function downAnchor(flags: number, merc: ScreenPoint): ScreenPoint {
  const below = Arrows.SHOW_DOWN_BELOW_Y | Arrows.SHOW_DOWN_CLIMB | Arrows.SHOW_DOWN_BELOW_YG | Arrows.SHOW_DOWN_BELOW_GG;
  if (flags & (below | Arrows.SHOW_DOWN_BELOW_YY)) return { x: merc.x + ABOVE_X, y: merc.y + BELOW_Y };
  return { x: merc.x + ARROWS_X_OFFSET, y: merc.y + DOWNARROW_Y_OFFSET };
}

export function arrowSprites(flags: number, merc: ScreenPoint): ArrowSprite[] {
  if (flags === 0) return [];
  const up = upAnchor(flags, merc);
  const down = downAnchor(flags, merc);
  const out: ArrowSprite[] = [];
  const atUp = (tile: string, dy = 0) => out.push({ tile, x: up.x, y: up.y + dy });
  const atDown = (tile: string, dy = 0) => out.push({ tile, x: down.x, y: down.y + dy });
  if (flags & Arrows.SHOW_UP_BESIDE) atUp(UP);
  if (flags & Arrows.SHOW_UP_ABOVE_Y) atUp(UP);
  if (flags & Arrows.SHOW_UP_ABOVE_YY) {
    atUp(UP);
    atUp(UP, SECOND_ARROW_Y);
  }
  if (flags & Arrows.SHOW_UP_ABOVE_CLIMB) atUp(CLIMB_UP);
  if (flags & Arrows.SHOW_DOWN_BESIDE) atDown(DOWN);
  if (flags & Arrows.SHOW_DOWN_BELOW_Y) atDown(DOWN);
  if (flags & Arrows.SHOW_DOWN_CLIMB) atDown(CLIMB_DOWN);
  if (flags & Arrows.SHOW_DOWN_BELOW_YG) {
    atDown(GREEN_DOWN);
    atDown(DOWN, SECOND_ARROW_Y);
  }
  if (flags & Arrows.SHOW_DOWN_BELOW_GG) {
    atDown(GREEN_DOWN);
    atDown(GREEN_DOWN, SECOND_ARROW_Y);
  }
  if (flags & Arrows.SHOW_DOWN_BELOW_YY) {
    atDown(DOWN);
    atDown(DOWN, SECOND_ARROW_Y);
  }
  return out;
}

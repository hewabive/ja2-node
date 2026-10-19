import { AnimHeight, endHeight, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { MoveMode } from './pathfinding.ts';
import { stateName } from './points.ts';
import type { Soldier } from './soldier.ts';

export function movementModeState(content: TacticalContent, s: Soldier, mode: unknown): number {
  const st = states(content.animations);
  switch (mode) {
    case 'run':
      return st.RUNNING;
    case 'walk':
      return st.WALKING;
    case 'swat':
      return st.SWATTING;
    case 'crawl':
      return st.CRAWLING;
  }
  const stance = endHeight(content, s.state);
  return stance === AnimHeight.PRONE ? st.CRAWLING : stance === AnimHeight.CROUCH ? st.SWATTING : st.WALKING;
}

export function pathMoveMode(content: TacticalContent, mode: number): MoveMode {
  const name = stateName(content, mode);
  return name === 'RUNNING'
    ? MoveMode.RUNNING
    : name === 'SWATTING'
      ? MoveMode.SWATTING
      : name === 'CRAWLING'
        ? MoveMode.CRAWLING
        : MoveMode.WALKING;
}

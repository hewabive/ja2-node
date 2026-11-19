import { beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, newCombatSim, spawnSoldier, thickBrushOn } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { Team } from '../tactical/soldier.ts';
import type { PreviewMove } from './preview-move.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const ORIGIN = gridNo(80, 80);
const BEYOND_THE_BRUSH = gridNo(85, 80);
const BRUSH = [gridNo(81, 80), gridNo(82, 80), gridNo(83, 80), gridNo(84, 80)];

describe('the move preview (Handle_UI.cc DrawUIMovementPath, PathAI.cc UIPlotPath)', () => {
  it('plots the direct path through dear ground for directPath, the path Shift plots, with the APs of that path (gfPlotDirectPath)', () => {
    const sim = newCombatSim(content, [], 3, new Set(), thickBrushOn(BRUSH));
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const preview = (directPath: boolean) =>
      hintAnswer(sim, 'previewMove', { soldier: 0, to: BEYOND_THE_BRUSH, mode: 'walk', ...(directPath ? { directPath } : {}) })
        .data as PreviewMove;
    const around = preview(false);
    const direct = preview(true);
    expect(around.steps.map((step) => step.gridNo)).not.toEqual(BRUSH);
    expect(direct.steps.map((step) => step.gridNo)).toEqual(BRUSH);
    expect(direct.apCost).toBeGreaterThan(around.apCost);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_DATA_DIR } from '../../../../node/repo.ts';
import { Arrows, arrowSprites } from './arrows.ts';
import { parseUiCursorTable } from './ui-cursors.ts';
import { cursorMarkers, footstepMarkers } from './world-markers.ts';

const table = parseUiCursorTable(JSON.parse(readFileSync(join(PROJECT_DATA_DIR, 'tables/ui-cursors.json'), 'utf8')));
const state = { gridNo: 100, interfaceLevel: 0, targetGridNo: null, apInvalidOrZero: false, stealth: false, displayAp: true };

describe('the world markers of the tactical input', () => {
  it('draws two footsteps per tile in the band colour, entering at direction + 2 and leaving at + 10 (orange for band 3)', () => {
    const steps = footstepMarkers([{ gridNo: 5, enterDir: 0, leaveDir: 7, band: 3 }], 0);
    expect(steps.map((s) => s.tile)).toEqual(['FOOTPRINTS66', 'FOOTPRINTS73']);
    expect(steps.every((s) => s.layer === 'object')).toBe(true);
    expect(footstepMarkers([{ gridNo: 5, enterDir: 7, leaveDir: 7, band: 4 }], 1)[0]).toMatchObject({
      tile: 'FOOTPRINTS17',
      layer: 'onRoof',
    });
  });

  it('picks the AP-dependent diamond of the move cursors and the confirm figures', () => {
    expect(cursorMarkers(table, { ...state, uiCursor: 'MOVE_RUN_UICURSOR' })).toEqual([
      { gridNo: 100, layer: 'topmost', tile: 'FIRSTPOINTERS2' },
    ]);
    expect(cursorMarkers(table, { ...state, uiCursor: 'MOVE_RUN_UICURSOR', stealth: true })[0]?.tile).toBe('FIRSTPOINTERS9');
    expect(cursorMarkers(table, { ...state, uiCursor: 'MOVE_RUN_UICURSOR', apInvalidOrZero: true })[0]?.tile).toBe('FIRSTPOINTERS6');
    expect(cursorMarkers(table, { ...state, uiCursor: 'CONFIRM_MOVE_RUN_UICURSOR', interfaceLevel: 1 })).toContainEqual({
      gridNo: 100,
      layer: 'topmost',
      tile: 'GOODRUN1',
      offsetY: -58,
    });
    expect(cursorMarkers(table, { ...state, uiCursor: 'CANNOT_MOVE_UICURSOR' })).toContainEqual({
      gridNo: 100,
      layer: 'topmost',
      tile: 'BADMARKER1',
      head: true,
    });
  });

  it('places the stance arrows beside, above and below the merc', () => {
    expect(arrowSprites(Arrows.SHOW_UP_BESIDE | Arrows.SHOW_DOWN_BESIDE, { x: 100, y: 200 })).toEqual([
      { tile: 'SECONDPOINTERS3', x: 110, y: 170 },
      { tile: 'SECONDPOINTERS4', x: 110, y: 190 },
    ]);
    expect(arrowSprites(Arrows.SHOW_UP_ABOVE_YY, { x: 100, y: 200 })).toEqual([
      { tile: 'SECONDPOINTERS3', x: 90, y: 130 },
      { tile: 'SECONDPOINTERS3', x: 90, y: 150 },
    ]);
    expect(arrowSprites(Arrows.SHOW_DOWN_CLIMB, { x: 100, y: 200 })).toEqual([{ tile: 'SECONDPOINTERS7', x: 90, y: 210 }]);
  });
});

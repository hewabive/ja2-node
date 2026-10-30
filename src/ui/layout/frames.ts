// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/UILayout.cc UILayout::recalculatePositions (the team panel centred, the std640 offsets, the viewport),
// @src getTeamPanelNumSlots, get_INV_INTERFACE_START_Y; src/game/UILayout.h TEAMPANEL_SLOT_WIDTH,
// @src TEAMPANEL_BUTTONSBOX_WIDTH, TEAMPANEL_HEIGHT, INV_INTERFACE_HEIGHT.

import { idiv, u16 } from '../../core/int.ts';
import { STD_SCREEN_HEIGHT, STD_SCREEN_WIDTH } from '../resolution.ts';
import type { ScreenGeometry } from '../services.ts';
import type { AnchorName, FrameName } from './types.ts';

export const TEAMPANEL_SLOT_WIDTH = 83;
export const TEAMPANEL_BUTTONSBOX_WIDTH = 142;
export const TEAMPANEL_HEIGHT = 120;
export const INV_INTERFACE_HEIGHT = 140;
export const DEFAULT_SQUAD_SIZE = 6;
const MIN_SLOTS = 6;
const MAX_SLOTS = 12;

export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function teamPanelSlots(screenWidth: number, squadSize = DEFAULT_SQUAD_SIZE): number {
  return Math.max(Math.min(squadSize, idiv(screenWidth - TEAMPANEL_BUTTONSBOX_WIDTH, TEAMPANEL_SLOT_WIDTH), MAX_SLOTS), MIN_SLOTS);
}

export function frameRect(frame: FrameName, geometry: ScreenGeometry, squadSize = DEFAULT_SQUAD_SIZE): FrameRect {
  const { width, height } = geometry;
  switch (frame) {
    case 'std640':
      return { x: geometry.stdX, y: geometry.stdY, width: STD_SCREEN_WIDTH, height: STD_SCREEN_HEIGHT };
    case 'screen':
      return { x: 0, y: 0, width, height };
    case 'viewport':
      return { x: 0, y: 0, width, height: height - TEAMPANEL_HEIGHT };
    case 'tacticalPanel':
    case 'tacticalInventory': {
      const panelWidth = teamPanelSlots(width, squadSize) * TEAMPANEL_SLOT_WIDTH + TEAMPANEL_BUTTONSBOX_WIDTH;
      const x = u16(idiv(width - panelWidth, 2));
      const panelHeight = frame === 'tacticalPanel' ? TEAMPANEL_HEIGHT : INV_INTERFACE_HEIGHT;
      return { x, y: height - panelHeight, width: panelWidth, height: panelHeight };
    }
  }
}

type Third = 0 | 1 | 2;

const ANCHOR_THIRDS: Readonly<Record<AnchorName, readonly [Third, Third]>> = {
  topLeft: [0, 0],
  topCenter: [1, 0],
  topRight: [2, 0],
  centerLeft: [0, 1],
  center: [1, 1],
  centerRight: [2, 1],
  bottomLeft: [0, 2],
  bottomCenter: [1, 2],
  bottomRight: [2, 2],
};

function third(size: number, part: Third): number {
  return part === 0 ? 0 : part === 1 ? idiv(size, 2) : size;
}

export function anchorPoint(rect: FrameRect, anchor: AnchorName): { x: number; y: number } {
  const [column, row] = ANCHOR_THIRDS[anchor];
  return { x: rect.x + third(rect.width, column), y: rect.y + third(rect.height, row) };
}

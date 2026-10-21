// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/MercPortrait.cc LoadPortrait, LoadSmallPortrait, Load65Portrait, LoadBigPortrait (faces/NN.sti,
// @src faces/65face/NN.sti, faces/bigfaces/NN.sti);
// @src src/game/Laptop/Laptop.h DEAD_MERC_COLOR_RED/GREEN/BLUE; src/game/Laptop/AIMFacialIndex.cc DrawMercsFaceToScreen,
// @src src/game/Laptop/AIMMembers.cc DisplayMercsFace (a dead face through Create16BPPPaletteShaded with the luminance,
// @src the other unavailable states under ShadowRect). See docs/28 §9.

import type { AssetKey, DrawList, PaletteShade } from '../draw-list.ts';

export type PortraitSize = 'small' | 'medium' | 'big';
export type PortraitState = 'normal' | 'dead' | 'shaded';

const FACES_DIR = 'faces';
const BIG_FACES_SUBDIR = 'bigfaces/';
const MEDIUM_FACES_SUBDIR = '65face/';
const SUBDIRS: Readonly<Record<PortraitSize, string>> = { small: '', medium: MEDIUM_FACES_SUBDIR, big: BIG_FACES_SUBDIR };
const FACE_INDEX_DIGITS = 2;
const PORTRAIT_FRAME = 0;

export const DEAD_PORTRAIT_SHADE: PaletteShade = { red: 255, green: 55, blue: 55, mono: true };

export function portraitPath(face: number, size: PortraitSize): AssetKey {
  return `${FACES_DIR}/${SUBDIRS[size]}${String(face).padStart(FACE_INDEX_DIGITS, '0')}.sti`;
}

export function portraitState(value: unknown): PortraitState {
  return value === 'dead' || value === 'shaded' ? value : 'normal';
}

export interface PortraitDraw {
  readonly face: number;
  readonly size: PortraitSize;
  readonly state: PortraitState;
  readonly x: number;
  readonly y: number;
  readonly shadeWidth: number;
  readonly shadeHeight: number;
}

export function drawPortrait(list: DrawList, p: PortraitDraw): void {
  if (!Number.isInteger(p.face) || p.face < 0) return;
  list.image(portraitPath(p.face, p.size), PORTRAIT_FRAME, p.x, p.y, { shade: p.state === 'dead' ? DEAD_PORTRAIT_SHADE : null });
  if (p.state === 'shaded') list.shadow(p.x, p.y, p.x + p.shadeWidth, p.y + p.shadeHeight);
}

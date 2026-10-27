// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/sgp/FPS.cc ToggleOnOff, RenderPresentHook, UpdateTexture (white text at 11,23 over every screen, a line every
// @src 12 pixels, the text refreshed once a second); src/sgp/SGP.cc MainLoop (Ctrl+F toggles it before the game sees the
// @src key); vanilla Build/JAScreens.c DisplayFrameRate (SMALLFONT1, light red when the game runs slow). See docs/04 §6.36.

import { FontColor } from '../content/text/font-colors.ts';
import type { DrawList } from './draw-list.ts';
import { KeyModifier, type UiInputEvent } from './input/events.ts';
import { FontName, type FontSet } from './text/fonts.ts';
import { fontColors, mprint } from './text/print.ts';

export interface DiagnosticLine {
  readonly text: string;
  readonly alarm: boolean;
}

const OVERLAY_X = 11;
const OVERLAY_Y = 23;
const LINE_SPACING = 12;
const TOGGLE_KEY = 'f';
const NORMAL_COLOR = FontColor.WHITE;
const ALARM_COLOR = FontColor.MCOLOR_LTRED;

export class DiagnosticsOverlay {
  #enabled = false;
  #lines: readonly DiagnosticLine[] = [];

  get enabled(): boolean {
    return this.#enabled;
  }

  get lines(): readonly DiagnosticLine[] {
    return this.#lines;
  }

  togglesOn(event: UiInputEvent): boolean {
    return event.kind === 'keyDown' && event.key === TOGGLE_KEY && event.modifiers === KeyModifier.CTRL;
  }

  toggle(): void {
    this.#enabled = !this.#enabled;
    this.#lines = [];
  }

  show(lines: readonly DiagnosticLine[]): void {
    if (this.#enabled) this.#lines = lines;
  }

  render(list: DrawList, fonts: FontSet): void {
    const font = fonts.find(FontName.SMALLFONT1);
    if (!this.#enabled || !font) return;
    this.#lines.forEach((line, i) => {
      const colors = fontColors(line.alarm ? ALARM_COLOR : NORMAL_COLOR);
      mprint(list, font, OVERLAY_X, OVERLAY_Y + i * LINE_SPACING, line.text, colors);
    });
  }
}

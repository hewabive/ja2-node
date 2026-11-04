// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Dialogue_Control.cc ExecuteTacticalTextBox (one quoted line in a basic box of
// @src DIALOGUE_DEFAULT_SUBTITLE_WIDTH, a click region at MSYS_PRIORITY_HIGHEST over it), TextOverlayClickCallback and
// @src FaceOverlayClickCallback (a press and release on it shuts the face up, not within its first 500 ms),
// @src HandleDialogueEnd (the box goes with the line).

import type { DrawList } from '../../draw-list.ts';
import { MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { UiServices } from '../../services.ts';
import { type ActiveLine, quoted, type SpeechPresenter } from '../../speech.ts';
import { MercTextBox, type MercTextBoxArt, type MercTextBoxFonts } from '../../widgets/merc-text-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';

export const SUBTITLE_BOX_ID = 'speechTextBox';

export interface SkipRegionHooks {
  readonly services: UiServices;
  readonly presenter: SpeechPresenter;
  readonly owner: string;
  readonly now: () => number;
}

export interface SubtitlePlace {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface SubtitleBoxHooks extends SkipRegionHooks {
  readonly boxArt: MercTextBoxArt;
  readonly boxFonts: () => MercTextBoxFonts;
}

interface PlacedBox {
  readonly id: number;
  readonly box: MercTextBox;
  readonly x: number;
  readonly y: number;
  readonly region: MouseRegion;
}

export function skipRegion(hooks: SkipRegionHooks, id: string, x: number, y: number, width: number, height: number): MouseRegion {
  let down = false;
  return hooks.services.regions.define({
    x1: x,
    y1: y,
    x2: x + width,
    y2: y + height,
    priority: Priority.HIGHEST,
    cursor: 0,
    owner: hooks.owner,
    id,
    onButton: (_r, reason) => {
      if (reason & MouseReason.LBUTTON_DWN) down = true;
      if (reason & MouseReason.LBUTTON_UP && down) {
        down = false;
        hooks.presenter.skip(hooks.now(), false);
      }
    },
    onMove: (_r, reason) => {
      if (reason & MouseReason.LOST_MOUSE) down = false;
    },
  });
}

export class SubtitleBox {
  readonly #hooks: SubtitleBoxHooks;
  #placed: PlacedBox | null = null;

  constructor(hooks: SubtitleBoxHooks) {
    this.#hooks = hooks;
  }

  get text(): string | null {
    return this.#placed?.box.request.text ?? null;
  }

  sync(line: ActiveLine | null, place: () => SubtitlePlace): void {
    if (!line) {
      this.dispose();
      return;
    }
    if (this.#placed?.id === line.line.id) return;
    this.dispose();
    const at = place();
    const box = new MercTextBox(
      this.#hooks.boxArt,
      { text: quoted(line.line.text), width: at.width, marginX: 0, marginTop: 0, marginBottom: 0 },
      this.#hooks.boxFonts(),
    );
    const region = skipRegion(this.#hooks, SUBTITLE_BOX_ID, at.x, at.y, box.width, box.height);
    this.#placed = { id: line.line.id, box, x: at.x, y: at.y, region };
  }

  render(list: DrawList): void {
    const placed = this.#placed;
    if (placed) placed.box.render(list, placed.x, placed.y);
  }

  describe(): readonly WidgetInfo[] {
    const placed = this.#placed;
    if (!placed) return [];
    const rect = { x: placed.x, y: placed.y, width: placed.box.width, height: placed.box.height };
    return [
      { id: SUBTITLE_BOX_ID, kind: 'region', rect, visible: true, enabled: true, state: null, text: placed.box.request.text, frame: null },
    ];
  }

  dispose(): void {
    this.#placed?.region.remove();
    this.#placed = null;
  }
}

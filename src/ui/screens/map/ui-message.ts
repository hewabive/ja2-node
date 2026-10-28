// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface.cc BeginMapUIMessage (the basic merc popup box, 200 wide, margin 10, transparent, centred
// @src in the map view plus 20 pixels and the vertical offset, the position kept while a message shows), RenderUIMessage
// @src (ShadowRect behind the box), CalcUIMessageDuration (1000 ms plus 50 ms per character), EndUIMessage;
// @src src/game/Strategic/MapScreen.cc MonitorMapUIMessage, CancelMapUIMessage.

import { idiv } from '../../../core/int.ts';
import type { DrawList } from '../../draw-list.ts';
import { MercTextBox, type MercTextBoxArt, type MercTextBoxFonts } from '../../widgets/merc-text-box.ts';
import { MAP_VIEW_HEIGHT, MAP_VIEW_START_X, MAP_VIEW_START_Y, MAP_VIEW_WIDTH } from './map-view.ts';

const WIDTH = 200;
const MARGIN_X = 10;
const BASE_MS = 1000;
const PER_CHAR_MS = 50;
const X_SHIFT = 20;

export class MapUiMessage {
  #box: MercTextBox | null = null;
  #since = 0;
  #duration = 0;
  #at: { x: number; y: number } | null = null;
  #text = '';

  get open(): boolean {
    return this.#box !== null;
  }

  get text(): string | null {
    return this.#box ? this.#text : null;
  }

  begin(text: string, deltaY: number, now: number, art: MercTextBoxArt, fonts: MercTextBoxFonts): void {
    this.#since = now;
    this.#duration = BASE_MS + PER_CHAR_MS * [...text].length;
    this.#text = text;
    const box = new MercTextBox(art, { text, width: WIDTH, marginX: MARGIN_X, marginTop: 0, marginBottom: 0, transparent: true }, fonts);
    if (!this.#at)
      this.#at = {
        x: MAP_VIEW_START_X + idiv(MAP_VIEW_WIDTH - box.width, 2) + X_SHIFT,
        y: MAP_VIEW_START_Y + idiv(MAP_VIEW_HEIGHT - box.height, 2) + deltaY,
      };
    this.#box = box;
  }

  update(now: number, keep: boolean): void {
    if (this.#box && !keep && now - this.#since > this.#duration) this.end();
  }

  end(): void {
    this.#box = null;
    this.#at = null;
  }

  render(list: DrawList, origin: { readonly x: number; readonly y: number }): void {
    const box = this.#box;
    const at = this.#at;
    if (!box || !at) return;
    const x = origin.x + at.x;
    const y = origin.y + at.y;
    list.shadow(x, y, x + box.width - 2, y + box.height - 2);
    box.render(list, x, y);
  }
}

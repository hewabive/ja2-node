import { DEFAULT_SHADOW, FontColor, NO_SHADOW } from '../../content/text/font-colors.ts';
import {
  type AssetKey,
  type DrawList,
  type FontColors,
  type FontId,
  LOW_PERCENT_SHADOW_FACTOR,
  type PositionedGlyph,
  rgb,
} from '../draw-list.ts';
import { isPointerEvent, type UiInputEvent } from '../input/events.ts';
import { type LogicalPoint, type Resolution, STD_SCREEN_HEIGHT, STD_SCREEN_WIDTH } from '../resolution.ts';
import type { Screen } from '../screen.ts';
import { type BitmapFont, glyphAdvance, glyphOf } from '../text/bitmap-font.ts';

export const TEST_PATTERN_ID = 'testPattern';
export const SMALL_FONT: FontId = 'font10arial';
export const LARGE_FONT: FontId = 'font14arial';
export const TEST_PATTERN_FONTS: readonly FontId[] = [SMALL_FONT, LARGE_FONT];

export const TestImage = {
  CARD: 'stubs/ui/test-card.sti',
  PICTURE: 'stubs/ui/test-card-565.sti',
  ITEMS: 'interface/mdguns.sti',
  LOGO: 'loadscreens/ja2logo.sti',
} as const satisfies Record<string, AssetKey>;
export const TEST_PATTERN_IMAGES: readonly AssetKey[] = Object.values(TestImage);

const BACKDROP = rgb(28, 30, 40);
const PANEL = rgb(64, 72, 96);
const WHITE = rgb(255, 255, 255);
const YELLOW = rgb(255, 224, 64);
const SWATCHES = [rgb(224, 48, 48), rgb(48, 192, 72), rgb(64, 104, 240), rgb(240, 160, 32), rgb(200, 200, 200)];
const SWATCH = 16;
const BLINK_MS = 500;
const CARD_ITEM_FRAME = 1;
const ITEM_FRAMES = 4;
const ITEM_PITCH = 64;
const MARKER = 3;

const LATIN = 'The quick brown fox jumps over the lazy dog 0123456789 !?';
const CYRILLIC = 'Съешь же ещё этих мягких французских булок, да выпей чаю';
const LARGE_TEXT = 'Jagged Alliance 2 — Привет, Арулько';

const SMALL_COLORS: FontColors = { foreground: FontColor.WHITE, shadow: DEFAULT_SHADOW, background: FontColor.BLACK };
const CYRILLIC_COLORS: FontColors = { foreground: FontColor.YELLOW, shadow: DEFAULT_SHADOW, background: FontColor.BLACK };
const LARGE_COLORS: FontColors = { foreground: FontColor.LTGREEN, shadow: NO_SHADOW, background: FontColor.DKBLUE };

function glyphRun(font: BitmapFont, text: string, x: number, y: number): PositionedGlyph[] {
  const glyphs: PositionedGlyph[] = [];
  let pen = x;
  for (const character of text) {
    const index = glyphOf(font, character.codePointAt(0) as number);
    if (index === null) continue;
    glyphs.push({ index, x: pen, y });
    pen += glyphAdvance(font, index);
  }
  return glyphs;
}

export class TestPatternScreen implements Screen {
  readonly id = TEST_PATTERN_ID;
  readonly #resolution: () => Resolution;
  readonly #fonts: ReadonlyMap<FontId, BitmapFont>;
  readonly #images: ReadonlySet<AssetKey>;
  #now = 0;
  #pointer: LogicalPoint | null = null;
  #presses = 0;

  constructor(resolution: () => Resolution, fonts: ReadonlyMap<FontId, BitmapFont>, images: ReadonlySet<AssetKey>) {
    this.#resolution = resolution;
    this.#fonts = fonts;
    this.#images = images;
  }

  get pointer(): LogicalPoint | null {
    return this.#pointer;
  }

  get presses(): number {
    return this.#presses;
  }

  enter(): void {
    this.#pointer = null;
  }

  exit(): void {}

  update(now: number): void {
    this.#now = now;
  }

  input(event: UiInputEvent): boolean {
    if (!isPointerEvent(event)) return false;
    this.#pointer = { x: event.x, y: event.y };
    if (event.kind === 'pointerDown') this.#presses++;
    return true;
  }

  render(list: DrawList): void {
    const { logicalWidth, logicalHeight, stdScreenX: ox, stdScreenY: oy } = this.#resolution();
    list.fill(0, 0, logicalWidth, logicalHeight, BACKDROP);
    list.fill(ox, oy, ox + STD_SCREEN_WIDTH, oy + STD_SCREEN_HEIGHT, PANEL);
    this.#primitives(list, ox, oy);
    this.#shading(list, ox, oy);
    this.#clipping(list, ox, oy);
    this.#text(list, ox, oy);
    this.#pictures(list, ox, oy);
    this.#blink(list, ox, oy);
    this.#marker(list);
  }

  #primitives(list: DrawList, ox: number, oy: number): void {
    SWATCHES.forEach((color, i) => {
      list.fill(ox + 8 + i * (SWATCH + 4), oy + 8, ox + 8 + i * (SWATCH + 4) + SWATCH, oy + 8 + SWATCH, color);
    });
    list.rectangle(ox + 112, oy + 8, ox + 112 + SWATCH, oy + 8 + SWATCH, WHITE);
    list.line(ox + 140, oy + 8, ox + 200, oy + 8, YELLOW);
    list.line(ox + 140, oy + 10, ox + 140, oy + 24, YELLOW);
    list.line(ox + 144, oy + 12, ox + 200, oy + 24, WHITE);
    list.line(ox + 210, oy + 24, ox + 222, oy + 8, WHITE);
  }

  #shading(list: DrawList, ox: number, oy: number): void {
    const y = oy + 32;
    SWATCHES.forEach((color, i) => {
      list.fill(ox + 8 + i * 48, y, ox + 8 + i * 48 + 48, y + 24, color);
    });
    list.shadow(ox + 8, y + 4, ox + 55, y + 19);
    list.shadow(ox + 56, y + 4, ox + 103, y + 19, LOW_PERCENT_SHADOW_FACTOR);
    list.hatch(ox + 104, y + 4, ox + 151, y + 19);
    list.looseHatch(ox + 152, y + 4, ox + 199, y + 19, WHITE);
    list.shadow(ox + 200, y + 4, ox + 247, y + 19);
    list.shadow(ox + 200, y + 4, ox + 247, y + 19);
  }

  #clipping(list: DrawList, ox: number, oy: number): void {
    const x = ox + 260;
    const y = oy + 32;
    list.rectangle(x - 1, y - 1, x + 60, y + 24, WHITE);
    list.pushClip(x, y, x + 60, y + 24);
    list.fill(x - 20, y - 20, x + 30, y + 40, SWATCHES[0] ?? WHITE);
    list.hatch(x + 23, y - 9, x + 80, y + 40);
    list.pushClip(x + 40, y + 4, x + 100, y + 20);
    list.fill(x, y, x + 100, y + 100, SWATCHES[2] ?? WHITE);
    list.popClip();
    list.popClip();
  }

  #text(list: DrawList, ox: number, oy: number): void {
    const small = this.#fonts.get(SMALL_FONT);
    const large = this.#fonts.get(LARGE_FONT);
    if (small) {
      list.glyphs(SMALL_FONT, glyphRun(small, LATIN, ox + 8, oy + 66), SMALL_COLORS);
      list.glyphs(SMALL_FONT, glyphRun(small, CYRILLIC, ox + 8, oy + 82), CYRILLIC_COLORS);
    }
    if (large) list.glyphs(LARGE_FONT, glyphRun(large, LARGE_TEXT, ox + 8, oy + 100), LARGE_COLORS);
  }

  #pictures(list: DrawList, ox: number, oy: number): void {
    const y = oy + 128;
    if (this.#images.has(TestImage.CARD)) {
      list.image(TestImage.CARD, 0, ox + 8, y);
      list.image(TestImage.CARD, 0, ox + 64, y, { shade: { red: 255, green: 255, blue: 255, mono: true } });
      list.image(TestImage.CARD, 0, ox + 120, y, { shade: { red: 128, green: 160, blue: 255, mono: false } });
      list.fill(ox + 176, y, ox + 360, y + 32, rgb(216, 216, 200));
      list.image(TestImage.CARD, CARD_ITEM_FRAME, ox + 180, y + 4);
      list.image(TestImage.CARD, CARD_ITEM_FRAME, ox + 212, y + 4, { effect: { kind: 'outline', color: rgb(255, 255, 0) } });
      list.image(TestImage.CARD, CARD_ITEM_FRAME, ox + 244, y + 4, { effect: { kind: 'outline', color: null } });
      list.image(TestImage.CARD, CARD_ITEM_FRAME, ox + 278, y + 8, { effect: { kind: 'outlineShadow' } });
      list.image(TestImage.CARD, CARD_ITEM_FRAME, ox + 276, y + 6, { effect: { kind: 'outline', color: null } });
    }
    if (this.#images.has(TestImage.PICTURE)) list.image(TestImage.PICTURE, 0, ox + 372, y);
    if (this.#images.has(TestImage.ITEMS)) {
      for (let frame = 0; frame < ITEM_FRAMES; frame++) {
        list.image(TestImage.ITEMS, frame, ox + 8 + frame * ITEM_PITCH, y + 48, { effect: { kind: 'outline', color: rgb(255, 255, 255) } });
        list.image(TestImage.ITEMS, frame, ox + 8 + frame * ITEM_PITCH + 3, y + 75, { effect: { kind: 'outlineShadow' } });
        list.image(TestImage.ITEMS, frame, ox + 8 + frame * ITEM_PITCH, y + 72, { effect: { kind: 'outline', color: null } });
      }
    }
    if (this.#images.has(TestImage.LOGO)) list.image(TestImage.LOGO, 0, ox + 368, oy + 264);
  }

  #blink(list: DrawList, ox: number, oy: number): void {
    if (Math.floor(this.#now / BLINK_MS) % 2 === 0) list.fill(ox + 620, oy + 8, ox + 632, oy + 20, YELLOW);
  }

  #marker(list: DrawList): void {
    const p = this.#pointer;
    if (!p) return;
    list.line(p.x - MARKER, p.y, p.x + MARKER, p.y, WHITE);
    list.line(p.x, p.y - MARKER, p.x, p.y + MARKER, WHITE);
  }
}

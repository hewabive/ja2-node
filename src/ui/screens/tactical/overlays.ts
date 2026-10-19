// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface.cc CreateTopMessage (the bar art by message type, the fill of (w - 3) × counter /
// @src max one-pixel blits of frames 2 to 11 after the end piece 1, the two closing blits at the maximum, the text centred
// @src in the box, black without a shadow on our turn and interrupts, white with the default shadow otherwise; the team
// @src turn strings and STR_BLOODCATS_TURN), HandleTopMessages (TEAMTURNUPDATE: the counter rises every 100 ms up to the
// @src current soldier's share), InitEnemyUIBar, UpdateEnemyUIBar, PLAYER_TEAM_TIMER_TICKS_PER_ENEMY,
// @src GetSoldierAboveGuyPositions (the 80-pixel column at the true position - 62 + the stance offset, below the soldier
// @src when showing damage or above the viewport), DrawSelectedUIAboveGuy (the radio locator every 80 ms, the action line,
// @src the name, the bar box of THIRDPOINTERS2 or 1 at + 28, + 5 or + 30, + 7, the health word, "(roof)"),
// @src GetSoldierHealthString, BeginUIMessage, RenderUIMessage, CalcUIMessageDuration; src/game/Tactical/Interface_Control.cc
// @src RenderTopmostTacticalInterface (the damage number at the true position + the bounding box offset + 20, - 5);
// @src src/game/Tactical/Overhead.cc (the damage drift every DAMAGE_DISPLAY_DELAY for 8 steps); src/game/Tactical/
// @src Interface_Panels.cc ShowRadioLocator (5 cycles, 3 when fast). See docs/28 §6.5.

import { DEFAULT_SHADOW, FontColor, NO_SHADOW } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { CombatView, TopMessageView } from '../../../protocol/view.ts';
import type { ImageCatalog } from '../../assets.ts';
import type { DrawList } from '../../draw-list.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { hCenterVCenterAlign } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { MercTextBox, type MercTextBoxArt, type MercTextBoxFonts } from '../../widgets/merc-text-box.ts';

export const TICKS_PER_ENEMY = 20;
const TEAM_TURN_UPDATE_MS = 100;
const BAR_FILL_FIRST = 2;
const BAR_FILL_LAST = 11;
const BAR_END = 12;
const BAR_START = 1;
const OUR_TEAM = 0;
const CREATURE_TEAM = 2;
const STR_INTERRUPT = 9;
const STR_BLOODCATS_TURN = 59;
const AIR_RAID_TURN_MESSAGE = 5;
export const TOP_BAR_HEIGHT = 20;

export interface TopBarArt {
  readonly turn: string;
  readonly interrupt: string;
  readonly computer: string;
}

export class TopBar {
  #counter = 0;
  #max = 0;
  #current = 0;
  #lastStep = 0;
  #total = -1;

  observeProgress(done: number): void {
    this.#counter = done * TICKS_PER_ENEMY;
    this.#current = done + 1;
  }

  sync(combat: CombatView | null | undefined, simMs: number): void {
    const ai = combat?.ai ?? null;
    if (!ai) {
      this.#total = -1;
      this.#lastStep = simMs;
      return;
    }
    if (ai.total !== this.#total) {
      this.#total = ai.total;
      this.#max = ai.total * TICKS_PER_ENEMY;
      this.#counter = ai.current * TICKS_PER_ENEMY;
      this.#current = ai.current;
      this.#lastStep = simMs;
    }
    while (simMs - this.#lastStep >= TEAM_TURN_UPDATE_MS) {
      this.#lastStep += TEAM_TURN_UPDATE_MS;
      if (this.#counter < this.#max) this.#counter++;
      if (this.#counter > this.#current * TICKS_PER_ENEMY) this.#counter = this.#current * TICKS_PER_ENEMY;
    }
  }

  get counter(): number {
    return this.#counter;
  }

  get max(): number {
    return this.#max;
  }

  render(
    list: DrawList,
    message: TopMessageView,
    art: TopBarArt,
    geometry: { readonly stdX: number; readonly screenWidth: number },
    box: readonly [number, number, number, number],
    font: BitmapFont,
    text: UiTextService,
  ): void {
    const stdX = geometry.stdX;
    const computer =
      message.kind === 'computerTurn' ||
      message.kind === 'computerInterrupt' ||
      message.kind === 'militiaInterrupt' ||
      message.kind === 'airRaidTurn';
    const file = computer ? art.computer : message.kind === 'playerInterrupt' ? art.interrupt : art.turn;
    list.fill(0, 0, geometry.screenWidth, TOP_BAR_HEIGHT, 0);
    list.image(file, 0, stdX, 0);
    const [bx, by, bw, bh] = box;
    if (computer && this.#max > 0) {
      let x = stdX + bx;
      list.image(file, BAR_START, x, by);
      let gfx = BAR_FILL_FIRST;
      let length = idiv((bw - 3) * this.#counter, this.#max);
      while (length-- > 0) {
        list.image(file, gfx, ++x, by);
        if (++gfx === BAR_FILL_LAST + 1) gfx = BAR_FILL_FIRST;
      }
      if (this.#counter === this.#max) {
        list.image(file, gfx, ++x, by);
        list.image(file, BAR_END, ++x, by);
      }
    }
    const label = topMessageText(message, text);
    const colours = computer ? fontColors(FontColor.MCOLOR_WHITE, DEFAULT_SHADOW) : fontColors(FontColor.MCOLOR_BLACK, NO_SHADOW);
    const at = hCenterVCenterAlign(stdX + bx, by, bw, bh, label, font);
    mprint(list, font, at.x, at.y, label, colours);
  }
}

export function topMessageText(message: TopMessageView, text: UiTextService): string {
  switch (message.kind) {
    case 'computerTurn':
      if (message.team === CREATURE_TEAM && message.bloodcats) return text.string('Message', STR_BLOODCATS_TURN) ?? '';
      return text.string('TeamTurnString', message.team) ?? '';
    case 'computerInterrupt':
    case 'playerInterrupt':
    case 'militiaInterrupt':
      return text.string('Message', STR_INTERRUPT) ?? '';
    case 'airRaidTurn':
      return text.string('TacticalStr', AIR_RAID_TURN_MESSAGE) ?? '';
    default:
      return text.string('TeamTurnString', OUR_TEAM) ?? '';
  }
}

export const LOCATOR_FRAME_MS = 80;
const LOCATOR_FRAMES = 5;
export const SHOW_LOCATOR_NORMAL_CYCLES = 5;
export const SHOW_LOCATOR_FAST_CYCLES = 3;

export class Locator {
  #flash = 1;
  #frame = 0;
  #since: number;
  readonly #cycles: number;
  #shown = false;

  constructor(now: number, cycles: number) {
    this.#since = now;
    this.#cycles = cycles;
  }

  get frame(): number {
    return this.#frame;
  }

  get shown(): boolean {
    return this.#shown;
  }

  update(now: number): boolean {
    while (now - this.#since >= LOCATOR_FRAME_MS) {
      this.#since += LOCATOR_FRAME_MS;
      this.#shown = true;
      if (++this.#frame === LOCATOR_FRAMES) {
        this.#flash++;
        this.#frame = 0;
      }
      if (this.#flash === this.#cycles) return false;
    }
    return true;
  }
}

const DAMAGE_DISPLAY_DELAY_MS = 250;
const DAMAGE_STEPS = 8;
const MAX_SHOWN_DAMAGE = 1000;

export class DamageNumber {
  amount = 0;
  dx: number;
  dy: number;
  #steps = 0;
  #since: number;

  constructor(now: number, offsetX: number, offsetY: number) {
    this.#since = now;
    this.dx = offsetX;
    this.dy = offsetY;
  }

  restart(now: number, offsetX: number, offsetY: number): void {
    this.#steps = 0;
    this.#since = now;
    this.dx = offsetX;
    this.dy = offsetY;
  }

  update(now: number): boolean {
    while (now - this.#since >= DAMAGE_DISPLAY_DELAY_MS) {
      this.#since += DAMAGE_DISPLAY_DELAY_MS;
      this.#steps++;
      this.dx++;
      this.dy--;
      if (this.#steps >= DAMAGE_STEPS) return false;
    }
    return true;
  }
}

export function showsDamage(oldLife: number, amount: number): boolean {
  return oldLife !== 0 && amount !== 0 && amount < MAX_SHOWN_DAMAGE;
}

const HEALTH_THRESHOLDS = [15, 30, 45, 60, 75, 90, 101] as const;
const FULL_HEALTH_START = 4;

export function healthString(text: UiTextService, healthIndex: number): string {
  return text.string('zHealthStr', healthIndex) ?? '';
}

export function healthIndexOf(life: number, lifeMax: number): number {
  const start = life === lifeMax ? FULL_HEALTH_START : 0;
  for (let i = start; i < HEALTH_THRESHOLDS.length; i++) if (life < (HEALTH_THRESHOLDS[i] as number)) return i;
  return HEALTH_THRESHOLDS.length - 1;
}

const UI_MESSAGE_WIDTH = 200;
const UI_MESSAGE_MARGIN_X = 10;
const UI_MESSAGE_BASE_MS = 1000;
const UI_MESSAGE_PER_CHAR_MS = 50;
const SKULL_MIN_MS = 300;

export class FeedbackBox {
  #box: MercTextBox | null = null;
  #since = 0;
  #duration = 0;
  #skull = false;
  #text = '';

  get text(): string | null {
    return this.#box ? this.#text : null;
  }

  begin(text: string, skull: boolean, now: number, art: MercTextBoxArt, fonts: MercTextBoxFonts): void {
    this.#since = now;
    this.#duration = UI_MESSAGE_BASE_MS + UI_MESSAGE_PER_CHAR_MS * [...text].length;
    this.#skull = skull;
    this.#text = text;
    this.#box = new MercTextBox(
      art,
      { text, width: UI_MESSAGE_WIDTH, marginX: UI_MESSAGE_MARGIN_X, marginTop: 0, marginBottom: 0, icon: skull ? 'skull' : 'stop' },
      fonts,
    );
  }

  update(now: number): void {
    if (!this.#box) return;
    if (now - this.#since > this.#duration) this.end(now);
  }

  end(now: number): void {
    if (!this.#box) return;
    if (this.#skull && now - this.#since < SKULL_MIN_MS) return;
    this.#box = null;
  }

  render(list: DrawList, screenWidth: number, y: number): void {
    const box = this.#box;
    if (!box) return;
    const x = idiv(screenWidth - box.width, 2);
    list.shadow(x, y, x + box.width - 2, y + box.height - 2);
    box.render(list, x, y);
  }
}

export interface OverheadLabel {
  readonly x: number;
  readonly y: number;
}

export function aboveGuyPosition(
  truePos: { x: number; y: number },
  stanceOffset: number,
  below: boolean,
  viewportTop: number,
  profiled: boolean,
): OverheadLabel {
  let y = truePos.y - 62 + stanceOffset;
  if (profiled && (below || y < viewportTop)) y = truePos.y;
  return { x: truePos.x - idiv(80, 2), y };
}

export function printAboveGuy(list: DrawList, font: BitmapFont, x: number, y: number, label: string, colour: number): void {
  const at = hCenterVCenterAlign(x, y, 80, 1, label, font);
  mprint(list, font, at.x, at.y, label, fontColors(colour, DEFAULT_SHADOW));
}

export function frameSize(images: ImageCatalog, path: string, frame: number): { width: number; height: number } {
  const f = images.info(path)?.frames[frame];
  return { width: f?.width ?? 0, height: f?.height ?? 0 };
}

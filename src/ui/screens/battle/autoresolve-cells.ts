// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc RenderSoldierCell (the merc and other panels, the black bar well, the face at
// @src +3 or +9, the skull of the dead, the white frame of a hit, then 150 ms of black with the red-shaded face, the
// @src unconscious face shadowed), RenderSoldierCellBars (life max, bleeding, life, breath max and morale in the code's
// @src colours), RenderSoldierCellHealth (SMALLCOMPFONT under the face over the restored background: the health word by
// @src bHealthStrRanges and its colour, the name of the dead in black, RETREATED, RETREATING every 450 of 900 ms, RETREAT
// @src over a hovered merc), CreateAutoResolveInterface and MakeEnemyTroops (the generic face of each militia rank,
// @src enemy class and creature, the female faces, the red palette 250, 25, 25).

import { FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { AutoresolveCellView } from '../../../protocol/view.ts';
import { type DrawList, type PaletteShade, rgb } from '../../draw-list.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { STRATEGIC, StrategicString } from './pre-battle-text.ts';

export const HIT_FLASH_MS = 150;
const OKLIFE = 15;
const RETREAT_BLINK_PERIOD_MS = 900;
const RETREAT_BLINK_SHOWN_MS = 450;
const HEALTH_TABLE = 'zHealthStr';
const HEALTH_CATEGORIES = ['dying', 'critical', 'wounded', 'poor', 'fair', 'good', 'excellent'] as const;
const HEALTH_RANGES = [15, 30, 45, 60, 75, 90, 101] as const;
const FULL_LIFE_FIRST = 4;
const LAST_SEARCHED = 6;
const POOR = 3;

export const RED_FACE_SHADE: PaletteShade = { red: 250, green: 25, blue: 25, mono: true };

export const GenericFace = {
  ADMIN: 0,
  TROOP: 1,
  ELITE: 2,
  MILITIA1: 3,
  MILITIA2: 4,
  MILITIA3: 5,
  YM_CREATURE: 6,
  AM_CREATURE: 7,
  YF_CREATURE: 8,
  AF_CREATURE: 9,
  HUMAN_SKULL: 10,
  CREATURE_SKULL: 11,
  ELITEF: 12,
  MILITIA1F: 13,
  MILITIA2F: 14,
  MILITIA3F: 15,
} as const;

const MILITIA_FACES: Readonly<Record<string, readonly [number, number]>> = {
  green: [GenericFace.MILITIA1, GenericFace.MILITIA1F],
  regular: [GenericFace.MILITIA2, GenericFace.MILITIA2F],
  elite: [GenericFace.MILITIA3, GenericFace.MILITIA3F],
};
const ENEMY_FACES: Readonly<Record<string, number>> = {
  elite: GenericFace.ELITE,
  troop: GenericFace.TROOP,
  admin: GenericFace.ADMIN,
};
const CREATURE_FACES: Readonly<Record<string, number>> = {
  adultFemaleCreature: GenericFace.AF_CREATURE,
  adultMaleCreature: GenericFace.AM_CREATURE,
  youngFemaleCreature: GenericFace.YF_CREATURE,
  youngMaleCreature: GenericFace.YM_CREATURE,
};
const ENEMY_NAMES: Readonly<Record<string, number>> = {
  elite: StrategicString.AR_ELITE_NAME,
  troop: StrategicString.AR_TROOP_NAME,
  admin: StrategicString.AR_ADMINISTRATOR_NAME,
};

export type Flash = 'none' | 'white' | 'red';

export interface DisplayCell extends AutoresolveCellView {
  readonly flash: Flash;
  readonly flashUntil: number;
}

export function displayCell(view: AutoresolveCellView, previous?: DisplayCell): DisplayCell {
  return { ...view, flash: previous?.flash ?? 'none', flashUntil: previous?.flashUntil ?? 0 };
}

export function isCreatureCell(c: AutoresolveCellView): boolean {
  return c.kind in CREATURE_FACES;
}

export function isMercCell(c: AutoresolveCellView): boolean {
  return c.side === 'merc';
}

export type CellFace = { readonly kind: 'merc'; readonly profile: number | null } | { readonly kind: 'generic'; readonly frame: number };

export function cellFace(c: AutoresolveCellView): CellFace {
  if (c.state === 'dead') return { kind: 'generic', frame: isCreatureCell(c) ? GenericFace.CREATURE_SKULL : GenericFace.HUMAN_SKULL };
  if (c.side === 'merc') return { kind: 'merc', profile: c.profile ?? null };
  if (c.side === 'militia') {
    const [male, female] = MILITIA_FACES[c.kind] ?? MILITIA_FACES.green ?? [GenericFace.MILITIA1, GenericFace.MILITIA1F];
    return { kind: 'generic', frame: c.female ? female : male };
  }
  const creature = CREATURE_FACES[c.kind];
  if (creature !== undefined) return { kind: 'generic', frame: creature };
  return { kind: 'generic', frame: c.female ? GenericFace.ELITEF : (ENEMY_FACES[c.kind] ?? GenericFace.TROOP) };
}

export function healthIndex(life: number, lifeMax: number): number {
  let k = life === lifeMax ? FULL_LIFE_FIRST : 0;
  for (; k < LAST_SEARCHED; k++) if (life < (HEALTH_RANGES[k] ?? 0)) break;
  return k;
}

function categoryIndex(c: AutoresolveCellView): { index: number; full: boolean } {
  if (c.side === 'merc') {
    const life = c.life ?? 0;
    const lifeMax = c.lifeMax ?? life;
    return { index: healthIndex(life, lifeMax), full: life === lifeMax };
  }
  const index = HEALTH_CATEGORIES.indexOf((c.health ?? 'excellent') as (typeof HEALTH_CATEGORIES)[number]);
  return { index: index < 0 ? LAST_SEARCHED : index, full: c.hurt !== true };
}

function healthColour(index: number, full: boolean): number {
  if (full) return FontColor.GRAY1;
  if (index <= 1) return FontColor.RED;
  return FontColor.YELLOW;
}

function deadName(text: UiTextService, c: AutoresolveCellView): string {
  if (c.side === 'merc') return c.name ?? '';
  if (c.side === 'militia') return text.string(STRATEGIC, StrategicString.AR_MILITIA_NAME) ?? '';
  if (isCreatureCell(c)) return text.string(STRATEGIC, StrategicString.AR_CREATURE_NAME) ?? '';
  return text.string(STRATEGIC, ENEMY_NAMES[c.kind] ?? StrategicString.AR_TROOP_NAME) ?? '';
}

export interface CellStatus {
  readonly text: string;
  readonly colour: number;
}

export function conscious(c: AutoresolveCellView): boolean {
  return c.state !== 'dead' && c.state !== 'unconscious' && (c.side !== 'merc' || (c.life ?? 0) >= OKLIFE);
}

export function cellStatus(text: UiTextService, c: AutoresolveCellView, battle: string, nowMs: number): CellStatus {
  let status: CellStatus;
  if (c.state === 'dead') status = { text: deadName(text, c), colour: FontColor.BLACK };
  else {
    const { index, full } = categoryIndex(c);
    status = { text: text.string(HEALTH_TABLE, index) ?? '', colour: index > POOR && !full ? FontColor.YELLOW : healthColour(index, full) };
  }
  if (c.state === 'retreated' && battle !== 'victory')
    return { text: text.string(STRATEGIC, StrategicString.AR_MERC_RETREATED) ?? '', colour: FontColor.LTGREEN };
  if (c.state === 'retreating' && battle === 'inProgress' && conscious(c) && nowMs % RETREAT_BLINK_PERIOD_MS < RETREAT_BLINK_SHOWN_MS)
    return { text: text.string(STRATEGIC, StrategicString.AR_MERC_RETREATING) ?? '', colour: FontColor.LTRED };
  return status;
}

interface BarSpec {
  readonly x: number;
  readonly value: number;
  readonly light: number;
  readonly dark: number;
}

const BAR_BOTTOM = 29;
const BAR_SCALE = 25;
const PERCENT = 100;
const LIFE_MAX_COLOURS = [rgb(107, 107, 57), rgb(222, 181, 115)] as const;
const BLEEDING_COLOURS = [rgb(156, 57, 57), rgb(222, 132, 132)] as const;
const LIFE_COLOURS = [rgb(107, 8, 8), rgb(206, 0, 0)] as const;
const BREATH_COLOURS = [rgb(8, 8, 132), rgb(8, 8, 107)] as const;
const MORALE_COLOURS = [rgb(8, 156, 8), rgb(8, 107, 8)] as const;
const LIFE_BAR_X = 37;
const BREATH_BAR_X = 41;
const MORALE_BAR_X = 45;

function barTop(y: number, value: number): number {
  return y + BAR_BOTTOM - idiv(BAR_SCALE * value, PERCENT);
}

function twoColumns(list: DrawList, x: number, top: number, bottom: number, colours: readonly [number, number]): void {
  list.fill(x, top, x + 1, bottom, colours[0]);
  list.fill(x + 1, top, x + 2, bottom, colours[1]);
}

export function drawCellBars(list: DrawList, c: AutoresolveCellView, x: number, y: number): void {
  if (c.state === 'dead' || (c.life ?? 0) === 0) return;
  const bottom = y + BAR_BOTTOM;
  let top = barTop(y, c.lifeMax ?? 0);
  twoColumns(list, x + LIFE_BAR_X, top, bottom, LIFE_MAX_COLOURS);
  top += idiv(BAR_SCALE * (c.bleeding ?? 0), PERCENT);
  twoColumns(list, x + LIFE_BAR_X, top, bottom, BLEEDING_COLOURS);
  twoColumns(list, x + LIFE_BAR_X, barTop(y, c.life ?? 0), bottom, LIFE_COLOURS);
  const bars: readonly BarSpec[] = [
    { x: BREATH_BAR_X, value: c.breathMax ?? 0, light: BREATH_COLOURS[0], dark: BREATH_COLOURS[1] },
    { x: MORALE_BAR_X, value: c.morale ?? 0, light: MORALE_COLOURS[0], dark: MORALE_COLOURS[1] },
  ];
  for (const bar of bars) twoColumns(list, x + bar.x, barTop(y, bar.value), bottom, [bar.light, bar.dark]);
}

export function flashAfterRender(c: DisplayCell, nowMs: number): DisplayCell {
  if (c.flash === 'white') return { ...c, flash: 'red', flashUntil: nowMs + HIT_FLASH_MS };
  if (c.flash === 'red' && c.flashUntil < nowMs) return { ...c, flash: 'none' };
  return c;
}

export function retreatBlinkShown(nowMs: number): boolean {
  return nowMs % RETREAT_BLINK_PERIOD_MS < RETREAT_BLINK_SHOWN_MS;
}

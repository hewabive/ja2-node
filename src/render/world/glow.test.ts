import { describe, expect, it } from 'vitest';
import { type GlowContext, glowFrame, itemOutlineColour, soldierLook } from './glow.ts';
import { packRgb } from './instances.ts';
import { pickSoldierAt } from './picking.ts';
import { SoldierFades } from './soldier-fade.ts';
import {
  GREY_GLOW_OFFSET,
  SOLDIER_EFFECT_ROW,
  SOLDIER_GLOW_ROWS,
  SOLDIER_PALETTE_ROWS,
  SOLDIER_ROOF_GLOW_ROWS,
  soldierPaletteRows,
} from './soldier-palettes.ts';

const CONTEXT: GlowContext = {
  ourTurn: true,
  frame: 0,
  hovered: null,
  hoveredHostile: false,
  selectedSees: () => null,
  underAiControl: () => false,
};
const enemy = { id: 7, level: 0, hostile: true, nodeShade: 3, fadeShade: null };

describe('enemy glow', () => {
  it('pulses every 3 s with the peak frames in the last second', () => {
    const frames = Array.from({ length: 30 }, (_, i) => glowFrame(i * 100));
    expect(frames.slice(0, 20).every((f) => f === 0)).toBe(true);
    expect(frames.slice(20)).toEqual([2, 4, 6, 8, 9, 8, 6, 4, 2, 0]);
    expect(glowFrame(3000)).toBe(0);
  });

  it('draws hostiles from the glow rows, grey when the selected merc does not see them, topmost at the peak', () => {
    expect(soldierLook(enemy, { ...CONTEXT, frame: 4 })).toEqual({ row: SOLDIER_GLOW_ROWS + 4, topmost: false });
    expect(soldierLook(enemy, { ...CONTEXT, frame: 8 })).toEqual({ row: SOLDIER_GLOW_ROWS + 8, topmost: true });
    expect(soldierLook(enemy, { ...CONTEXT, selectedSees: () => false })).toEqual({
      row: SOLDIER_GLOW_ROWS + GREY_GLOW_OFFSET,
      topmost: false,
    });
    expect(soldierLook({ ...enemy, level: 1 }, CONTEXT).row).toBe(SOLDIER_ROOF_GLOW_ROWS);
    expect(soldierLook(enemy, { ...CONTEXT, ourTurn: false })).toEqual({ row: 4, topmost: false });
    expect(soldierLook({ ...enemy, hostile: false, nodeShade: 12 }, CONTEXT)).toEqual({ row: 10, topmost: false });
  });

  it('glows only the hovered hostile and greys the unseen others', () => {
    const hover = { ...CONTEXT, hovered: 9, hoveredHostile: true, selectedSees: (id: number) => id !== 7 };
    expect(soldierLook({ ...enemy, id: 9 }, hover)).toEqual({ row: SOLDIER_GLOW_ROWS, topmost: true });
    expect(soldierLook(enemy, hover)).toEqual({ row: SOLDIER_EFFECT_ROW, topmost: false });
  });

  it('uses the fade shade while a soldier fades', () => {
    expect(soldierLook({ ...enemy, fadeShade: 11 }, CONTEXT)).toEqual({ row: 11, topmost: false });
  });
});

describe('soldier palettes', () => {
  it('builds 16 shades, 20 red and 20 orange glow rows', () => {
    const palette = new Uint8Array(768);
    palette.set([0, 0, 0, 10, 20, 30, 200, 100, 50], 0);
    const rows = soldierPaletteRows(palette);
    expect(rows).toHaveLength(SOLDIER_PALETTE_ROWS);
    const red = rows[SOLDIER_GLOW_ROWS + 9] as Uint8Array;
    expect(red[3]).toBeGreaterThanOrEqual(222);
    expect(red[5]).toBe(rows[SOLDIER_GLOW_ROWS]?.[5]);
    const orange = rows[SOLDIER_ROOF_GLOW_ROWS + 9] as Uint8Array;
    expect(orange[4]).toBeGreaterThanOrEqual(178);
    const grey = rows[SOLDIER_EFFECT_ROW] as Uint8Array;
    expect(grey[6]).toBe(grey[8]);
  });

  it('give an unseen enemy at the glow peak the step before it, 200 instead of 225', () => {
    const PEAK = 9;
    const rows = soldierPaletteRows(new Uint8Array(768));
    for (const start of [SOLDIER_GLOW_ROWS, SOLDIER_ROOF_GLOW_ROWS]) {
      const greyPeak = rows[start + GREY_GLOW_OFFSET + PEAK] as Uint8Array;
      expect(greyPeak).toEqual(rows[start + GREY_GLOW_OFFSET + PEAK - 1]);
      expect(greyPeak[0]).toBeLessThan(rows[start + PEAK]?.[0] ?? 0);
    }
  });
});

describe('item outline', () => {
  it('cycles 25…250…25 every 100 ms, yellow on roofs and static when glow is off', () => {
    expect(itemOutlineColour(0, false, { glow: true, red: false })).toBe(packRgb(24, 24, 24));
    expect(itemOutlineColour(900, false, { glow: true, red: false })).toBe(packRgb(255, 251, 255));
    expect(itemOutlineColour(0, true, { glow: true, red: false })).toBe(packRgb(24, 24, 0));
    expect(itemOutlineColour(0, false, { glow: true, red: true })).toBe(packRgb(24, 0, 0));
    expect(itemOutlineColour(500, false, { glow: false, red: false })).toBe(packRgb(255, 255, 255));
    expect(itemOutlineColour(500, true, { glow: false, red: false })).toBe(packRgb(255, 255, 0));
  });
});

describe('soldier picking', () => {
  const sprite = (pixels: number[]) => ({
    layer: 0,
    x: 0,
    y: 0,
    width: 2,
    height: 2,
    offsetX: 0,
    offsetY: 0,
    pixels: Uint8Array.from(pixels),
  });
  it('hits the opaque pixel of the topmost drawn frame', () => {
    const placed = [
      { id: 1, x: 10, y: 10, width: 2, height: 2, sprite: sprite([1, 1, 1, 1]), topmost: false },
      { id: 2, x: 11, y: 10, width: 2, height: 2, sprite: sprite([1, 0, 254, 1]), topmost: false },
    ];
    expect(pickSoldierAt(placed, 11.5, 10.5)).toBe(2);
    expect(pickSoldierAt(placed, 12.5, 10.5)).toBeNull();
    expect(pickSoldierAt(placed, 11.5, 11.5)).toBe(1);
    expect(pickSoldierAt([...placed, { ...placed[0], id: 3, topmost: true } as (typeof placed)[0]], 10.5, 10.5)).toBe(3);
  });
});

describe('soldier fades', () => {
  type Shown = { id: number; team: number; gridNo: number; fadingOut?: boolean };
  const shade = () => 3;

  it('fades newcomers in from 12 to their tile in 60 ms steps, never our own mercs', () => {
    const fades = new SoldierFades<Shown>();
    const enemy = { id: 1, team: 1, gridNo: 5 };
    fades.update([enemy], 0, shade);
    expect(fades.shade(enemy, 0, shade)).toBeNull();
    const newcomer = { id: 2, team: 1, gridNo: 6 };
    const merc = { id: 3, team: 0, gridNo: 7 };
    fades.update([enemy, newcomer, merc], 1000, shade);
    expect([fades.shade(newcomer, 1000, shade), fades.shade(newcomer, 1130, shade)]).toEqual([12, 10]);
    expect(fades.shade(merc, 1000, shade)).toBeNull();
    fades.update([enemy, newcomer, merc], 1540, shade);
    expect(fades.shade(newcomer, 1540, shade)).toBeNull();
  });

  it('darkens a soldier the view keeps while he fades out, where he is, and hides him at 12', () => {
    const fades = new SoldierFades<Shown>();
    const enemy = { id: 1, team: 1, gridNo: 5 };
    fades.update([enemy], 0, shade);
    const walkingAway = { ...enemy, gridNo: 6, fadingOut: true };
    fades.update([walkingAway], 2000, shade);
    expect(fades.shade(walkingAway, 2060, shade)).toBe(4);
    expect(fades.fadedOut(walkingAway, 2480)).toBe(false);
    expect(fades.fadedOut(walkingAway, 2540)).toBe(true);
  });

  it('stops a fade-out when he is seen again, without a fade-in, and forgets a soldier who left the view', () => {
    const fades = new SoldierFades<Shown>();
    const enemy = { id: 1, team: 1, gridNo: 5 };
    fades.update([enemy], 0, shade);
    fades.update([{ ...enemy, fadingOut: true }], 100, shade);
    fades.update([enemy], 220, shade);
    expect(fades.shade(enemy, 220, shade)).toBeNull();
    fades.update([{ ...enemy, fadingOut: true }], 300, shade);
    fades.update([], 360, shade);
    expect(fades.shade(enemy, 360, shade)).toBeNull();
    fades.update([enemy], 400, shade);
    expect(fades.shade(enemy, 400, shade)).toBe(12);
  });
});

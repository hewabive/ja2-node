import { describe, expect, it } from 'vitest';
import { parseSectorString } from '../../content/strategic/sector-ids.ts';
import { Assignment, NO_VEHICLE } from '../strategic/forces/constants.ts';
import { type ItemHolder, mapscreenCanPassItemToChar } from './item-passing.ts';

const SQUAD_1 = 0;
const SQUAD_2 = 1;
const JEEP = 2;
const HUMMER = 3;

function holder(sector: string, more: Partial<ItemHolder> = {}): ItemHolder {
  return { sector: parseSectorString(sector), betweenSectors: false, assignment: SQUAD_1, vehicleId: NO_VEHICLE, ...more };
}

describe('MapscreenCanPassItemToChar', () => {
  const a9 = holder('A9');

  it('passes nothing to anybody while the loaded sector holds enemies, not even back to the merc it came from', () => {
    expect(mapscreenCanPassItemToChar(true, { holder: a9 }, a9)).toBe(false);
    expect(mapscreenCanPassItemToChar(true, { stash: parseSectorString('A9') }, a9)).toBe(false);
  });

  it('passes a sector inventory item to a merc standing in that sector only, whatever his squad', () => {
    const stash = { stash: parseSectorString('A9') };
    expect(mapscreenCanPassItemToChar(false, stash, holder('A9', { assignment: SQUAD_2 }))).toBe(true);
    expect(mapscreenCanPassItemToChar(false, stash, holder('A10'))).toBe(false);
    expect(mapscreenCanPassItemToChar(false, stash, holder('A9', { betweenSectors: true }))).toBe(false);
    expect(mapscreenCanPassItemToChar(false, { stash: { ...parseSectorString('A9'), z: 1 } }, a9)).toBe(false);
  });

  it('passes a merc’s item within his sector, and on the road only within the same squad or vehicle', () => {
    const road = (more: Partial<ItemHolder>) => holder('A9', { betweenSectors: true, ...more });
    expect(mapscreenCanPassItemToChar(false, { holder: a9 }, holder('A9', { assignment: SQUAD_2 }))).toBe(true);
    expect(mapscreenCanPassItemToChar(false, { holder: a9 }, holder('B9'))).toBe(false);
    expect(mapscreenCanPassItemToChar(false, { holder: road({}) }, a9)).toBe(true);
    expect(mapscreenCanPassItemToChar(false, { holder: a9 }, road({}))).toBe(false);
    expect(mapscreenCanPassItemToChar(false, { holder: road({}) }, road({}))).toBe(true);
    expect(mapscreenCanPassItemToChar(false, { holder: road({}) }, road({ assignment: SQUAD_2 }))).toBe(false);
    const inJeep = road({ assignment: Assignment.VEHICLE, vehicleId: JEEP });
    expect(mapscreenCanPassItemToChar(false, { holder: inJeep }, road({ assignment: Assignment.VEHICLE, vehicleId: JEEP }))).toBe(true);
    expect(mapscreenCanPassItemToChar(false, { holder: inJeep }, road({ assignment: Assignment.VEHICLE, vehicleId: HUMMER }))).toBe(false);
  });
});

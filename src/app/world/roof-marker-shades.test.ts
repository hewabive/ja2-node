import { describe, expect, it } from 'vitest';
import { RoofMarkerShades } from './roof-marker-shades.ts';
import type { RoofMarkerChange } from './roof-markers.ts';
import type { RoofLight } from './world-lighting.ts';

const ROOF = 1000;
const NEXT_ROOF = 1001;
const MERC = 7;
const OTHER_MERC = 8;
const ENEMY = 40;
const OUR_TEAM = 0;
const ENEMY_TEAM = 1;
const ROOF_SHADE = 11;
const DEFAULT_SHADE_LEVEL = 4;

const NO_LIGHTS: ReadonlyMap<number, RoofLight> = new Map();

function light(key: string, ...lit: readonly (readonly [number, number])[]): RoofLight {
  return { key, roof: new Map(lit) };
}

function lights(...entries: readonly (readonly [number, RoofLight])[]): ReadonlyMap<number, RoofLight> {
  return new Map(entries);
}

const placed = (gridNo: number): RoofMarkerChange => ({ kind: 'placed', gridNo });
const removed = (gridNo: number): RoofMarkerChange => ({ kind: 'removed', gridNo });
const stopped = (soldier: number, team = OUR_TEAM): RoofMarkerChange => ({ kind: 'stopped', soldier, team });

describe("the roof marker's own light (a roof node HandlePlacingRoofMarker adds at DEFAULT_SHADE_LEVEL)", () => {
  it('keeps the default shade under a roof light drawn before it was placed, as only lights drawn later reach the node', () => {
    const shades = new RoofMarkerShades();
    const lamp = lights([OTHER_MERC, light('a', [ROOF, 3])]);
    shades.update(lamp, [], true);
    shades.update(lamp, [placed(ROOF)], true);
    expect(shades.shade(ROOF, ROOF_SHADE)).toBe(DEFAULT_SHADE_LEVEL);
  });

  it('takes the strongest roof light drawn after it was placed off the default shade (LightAddTileNode)', () => {
    const shades = new RoofMarkerShades();
    shades.update(NO_LIGHTS, [placed(ROOF)], true);
    shades.update(lights([OTHER_MERC, light('a', [ROOF, 2])], [MERC, light('b', [ROOF, 1], [NEXT_ROOF, 3])]), [], true);
    expect(shades.shade(ROOF, ROOF_SHADE)).toBe(DEFAULT_SHADE_LEVEL - 2);
  });

  it('cuts its strongest light to the light left when a light goes, even one the node never got (LightSubtractTileNode)', () => {
    const shades = new RoofMarkerShades();
    const before = light('a', [ROOF, 3]);
    shades.update(lights([OTHER_MERC, before]), [], true);
    shades.update(lights([OTHER_MERC, before]), [placed(ROOF)], true);
    shades.update(lights([OTHER_MERC, before], [MERC, light('b', [ROOF, 2])]), [], true);
    shades.update(lights([MERC, light('b', [ROOF, 2])]), [], true);
    expect(shades.shade(ROOF, ROOF_SHADE)).toBe(DEFAULT_SHADE_LEVEL);
  });

  it("draws our merc's light again on the marker his stop places, the original deleting and positioning it after", () => {
    const shades = new RoofMarkerShades();
    const own = lights([MERC, light('a', [ROOF, 3])]);
    shades.update(own, [], true);
    shades.update(own, [placed(ROOF), stopped(MERC)], true);
    expect(shades.shade(ROOF, ROOF_SHADE)).toBe(DEFAULT_SHADE_LEVEL - 3);
  });

  it('leaves the light where it was at a stop with TOPTION_MERC_ALWAYS_LIGHT_UP, and at the stop of a soldier not ours', () => {
    const always = new RoofMarkerShades();
    const own = lights([MERC, light('a', [ROOF, 3])]);
    always.update(own, [], false);
    always.update(own, [placed(ROOF), stopped(MERC)], false);
    const enemy = new RoofMarkerShades();
    enemy.update(own, [], true);
    enemy.update(own, [placed(ROOF), stopped(ENEMY, ENEMY_TEAM)], true);
    expect([always.shade(ROOF, ROOF_SHADE), enemy.shade(ROOF, ROOF_SHADE)]).toEqual([DEFAULT_SHADE_LEVEL, DEFAULT_SHADE_LEVEL]);
  });

  it('shades it as the roof once the base light is set again, whatever level (LightSetBaseLevel)', () => {
    const shades = new RoofMarkerShades();
    shades.update(NO_LIGHTS, [placed(ROOF)], true);
    shades.baseLevelSet();
    shades.update(lights([MERC, light('a', [ROOF, 3])]), [placed(NEXT_ROOF)], true);
    expect([shades.shade(ROOF, ROOF_SHADE), shades.shade(NEXT_ROOF, ROOF_SHADE)]).toEqual([ROOF_SHADE, DEFAULT_SHADE_LEVEL]);
  });

  it('starts a marker put back after it was taken off as a new node', () => {
    const shades = new RoofMarkerShades();
    shades.update(NO_LIGHTS, [placed(ROOF)], true);
    shades.update(lights([MERC, light('a', [ROOF, 3])]), [], true);
    shades.update(lights([MERC, light('a', [ROOF, 3])]), [removed(ROOF), placed(ROOF)], true);
    expect(shades.shade(ROOF, ROOF_SHADE)).toBe(DEFAULT_SHADE_LEVEL);
  });
});

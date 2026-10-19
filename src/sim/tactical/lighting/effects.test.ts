import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { itemId, runExplosivesUntilIdle } from '../../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { igniteExplosion } from '../explosions/explosion.ts';
import { newLightEffect } from '../explosions/light.ts';
import { Team } from '../soldier.ts';
import { lightSetBaseLevel, lightTrueLevel, NORMAL_LIGHTLEVEL_DAY, NORMAL_LIGHTLEVEL_NIGHT } from './lighting.ts';
import { countMuzzleFlashFrame, showMuzzleFlash } from './muzzle-flash.ts';

const NIGHT = NORMAL_LIGHTLEVEL_NIGHT;
const AT = gridNo(80, 80);
let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('muzzle flashes', () => {
  it('light the tile in front of a visible shooter at night for two more frames', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    lightSetBaseLevel(t, NIGHT);
    const s = spawnSoldier(sim, 0, Team.OUR, AT, Direction.EAST);
    s.visible = 1;
    expect(showMuzzleFlash(t, s)).toBe(true);
    expect(lightTrueLevel(t, AT + 1, 0)).toBe(NIGHT - 3);
    countMuzzleFlashFrame(t, s);
    countMuzzleFlashFrame(t, s);
    expect(lightTrueLevel(t, AT + 1, 0)).toBe(NIGHT - 3);
    countMuzzleFlashFrame(t, s);
    expect(lightTrueLevel(t, AT + 1, 0)).toBe(NIGHT);
    expect(s.muzzleFlashLight).toBeNull();
  });

  it('stay dark by day and for shooters the player cannot see', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = spawnSoldier(sim, 0, Team.ENEMY, AT, Direction.EAST);
    s.visible = 1;
    showMuzzleFlash(t, s);
    expect(s.muzzleFlashLight).toBeNull();
    lightSetBaseLevel(t, NIGHT);
    s.visible = -1;
    showMuzzleFlash(t, s);
    expect(s.muzzleFlashLight).toBeNull();
  });
});

describe('explosion lights', () => {
  it('light the blast while it plays at night and go out with it', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    lightSetBaseLevel(t, NIGHT);
    igniteExplosion(t, null, 0, AT, itemId(t, 'HAND_GRENADE'), 0);
    expect(lightTrueLevel(t, AT, 0)).toBe(NIGHT - 4);
    runExplosivesUntilIdle(sim);
    expect(lightTrueLevel(t, AT, 0)).toBe(NIGHT);
  });

  it('are not made in daylight', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    igniteExplosion(t, null, 0, AT, itemId(t, 'HAND_GRENADE'), 0);
    expect(lightTrueLevel(t, AT, 0)).toBe(NORMAL_LIGHTLEVEL_DAY);
  });
});

describe('light effects', () => {
  it("light their tiles with Stracciatella's shipped Light templates", () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    lightSetBaseLevel(t, NIGHT);
    const light = newLightEffect(t, AT, 6, 6);
    expect(light?.sprite?.template.name).toBe('Light6');
    expect(lightTrueLevel(t, AT, 0)).toBeLessThan(NIGHT);
  });
});

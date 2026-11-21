import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { itemId, runExplosivesUntilIdle } from '../../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo, WORLD_COLS } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { igniteExplosion } from '../explosions/explosion.ts';
import { newLightEffect } from '../explosions/light.ts';
import { Team } from '../soldier.ts';
import { lightSetBaseLevel, lightTrueLevel, NORMAL_LIGHTLEVEL_DAY, NORMAL_LIGHTLEVEL_NIGHT } from './lighting.ts';
import { countMuzzleFlashCode, showMuzzleFlash } from './muzzle-flash.ts';

const NIGHT = NORMAL_LIGHTLEVEL_NIGHT;
const AT = gridNo(80, 80);
let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('muzzle flashes', () => {
  it('light the tile in front of a visible shooter at night for two more script codes', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    lightSetBaseLevel(t, NIGHT);
    const s = spawnSoldier(sim, 0, Team.OUR, AT, Direction.EAST);
    s.visible = 1;
    expect(showMuzzleFlash(t, s)).toBe(true);
    expect(lightTrueLevel(t, AT + 1, 0)).toBe(NIGHT - 3);
    countMuzzleFlashCode(t, s);
    countMuzzleFlashCode(t, s);
    expect(lightTrueLevel(t, AT + 1, 0)).toBe(NIGHT - 3);
    countMuzzleFlashCode(t, s);
    expect(lightTrueLevel(t, AT + 1, 0)).toBe(NIGHT);
    expect(s.muzzleFlashLight).toBeNull();
  });

  const litStepsOfAnAttack = (burst: boolean): { lit: number; shots: number } => {
    const sim = newCombatSim(content);
    const t = sim.state;
    lightSetBaseLevel(t, NIGHT);
    spawnSoldier(sim, 0, Team.OUR, AT, Direction.SOUTH, { gun: 'MP5K', marksmanship: 60 });
    const target = AT + 15 * WORLD_COLS;
    spawnSoldier(sim, 20, Team.ENEMY, target, Direction.NORTH);
    sim.lookAround();
    sim.drainEvents();
    expect(sim.dispatch({ type: 'attack', soldier: 0, target, burst })).toEqual({ ok: true });
    let lit = 0;
    let shots = 0;
    for (let i = 0; i < 20_000 && !sim.isIdle(); i++) {
      sim.step();
      if (lightTrueLevel(t, AT + WORLD_COLS, 0) < NIGHT) lit++;
      shots += sim.drainEvents().filter((e) => e.type === 'shotFired').length;
    }
    return { lit, shots };
  };

  it("put a burst round's flash out within the step that draws the round's first frame, as the count runs over the burst's script codes", () => {
    const burst = litStepsOfAnAttack(true);
    expect(burst.shots).toBeGreaterThan(1);
    expect(burst.lit).toBe(0);
    expect(litStepsOfAnAttack(false).lit).toBeGreaterThan(0);
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
  it('light their tiles with the Light template of their radius', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    lightSetBaseLevel(t, NIGHT);
    const light = newLightEffect(t, AT, 6, 6);
    expect(light?.sprite?.template.name).toBe('Light6');
    expect(lightTrueLevel(t, AT, 0)).toBeLessThan(NIGHT);
  });
});

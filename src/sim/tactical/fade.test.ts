import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { TICK_MS } from '../clock.ts';
import { tacticalViewParts } from '../knowledge/sim-view.ts';
import { initNewSoldierAnim, states } from './animation.ts';
import { soldierTakeDamage } from './combat/hit.ts';
import { DamageReason } from './combat/types.ts';
import type { TacticalContent } from './content.ts';
import {
  lightSetBaseLevel,
  lightSpriteCreate,
  lightSpritePosition,
  lightSpritePower,
  lightTrueLevel,
  NORMAL_LIGHTLEVEL_NIGHT,
} from './lighting/lighting.ts';
import { getNewSoldierPath } from './movement.ts';
import { Opp } from './perception/opp.ts';
import { type Soldier, SoldierFade, Team, Visible } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const FADE_STEP_TICKS = 60 / TICK_MS;
const DAY_SHADE = 3;
const FADED_SHADE = 12;
const MERC_AT = gridNo(80, 80);
const ENEMY_AT = gridNo(80, 86);

interface Scene {
  readonly sim: TacticalSim;
  readonly merc: Soldier;
  readonly enemy: Soldier;
}

function seenEnemy(inCombat: boolean, mercFacing: number = Direction.SOUTH): Scene {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, mercFacing);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, ENEMY_AT, Direction.SOUTH);
  sim.state.inCombat = inCombat;
  enemy.visible = Visible.SEEN;
  enemy.lastRenderVisible = Visible.SEEN;
  return { sim, merc, enemy };
}

function passClock(sim: TacticalSim): number {
  return sim.state.clockMs - TICK_MS;
}

function stepUntil(sim: TacticalSim, done: () => boolean, limit = 2000): number {
  for (let ticks = 1; ticks <= limit; ticks++) {
    sim.step();
    if (done()) return ticks;
  }
  throw new Error('never happened');
}

describe('the fade-out of a soldier who drops out of sight', () => {
  it('holds him at -2 for one 60 ms step per shade from his tile to 12, with his frame delay, and runs him at the loop rate only from the speed change after the pass that ends it', () => {
    const { sim, enemy } = seenEnemy(true);
    const delay = enemy.aniDelay;
    expect(delay).toBeGreaterThan(0);
    enemy.visible = Visible.HIDDEN;
    sim.step();
    expect([enemy.visible, enemy.fade, enemy.fadeShade]).toEqual([Visible.FADING_OUT, SoldierFade.OUT, DAY_SHADE]);
    const steps: number[] = [];
    let shade = enemy.fadeShade;
    const ticks = stepUntil(sim, () => {
      if (enemy.fadeShade !== shade) steps.push(sim.tick);
      shade = enemy.fadeShade;
      expect(enemy.aniDelay).toBe(delay);
      return enemy.visible === Visible.HIDDEN;
    });
    expect(steps).toHaveLength(FADED_SHADE - DAY_SHADE);
    expect(steps.slice(1).map((tick, i) => tick - (steps[i] as number))).toEqual(new Array(steps.length - 1).fill(FADE_STEP_TICKS));
    expect(ticks).toBe(1 + (FADED_SHADE - DAY_SHADE - 1) * FADE_STEP_TICKS);
    expect([enemy.fade, enemy.fadeShade, enemy.lastRenderVisible, enemy.aniDelay]).toEqual([
      SoldierFade.NONE,
      FADED_SHADE,
      Visible.HIDDEN,
      delay,
    ]);
    initNewSoldierAnim(sim.state, enemy, states(content.animations).STANDING, 0, true);
    expect(enemy.aniDelay).toBe(0);
  });

  it('starts at night from the shade of the strongest light on his tile, not from the sum of the lights', () => {
    const { sim, enemy } = seenEnemy(true);
    const t = sim.state;
    lightSetBaseLevel(t, NORMAL_LIGHTLEVEL_NIGHT);
    for (const x of [80, 82]) {
      const lamp = lightSpriteCreate(t, 'L-R03.LHT');
      if (!lamp) throw new Error('no light template');
      lightSpritePower(lamp, true);
      lightSpritePosition(t, lamp, x, 86);
    }
    expect(lightTrueLevel(t, ENEMY_AT, 0)).toBe(NORMAL_LIGHTLEVEL_NIGHT - 5);
    enemy.visible = Visible.HIDDEN;
    sim.step();
    expect(enemy.fadeShade).toBe(NORMAL_LIGHTLEVEL_NIGHT - 3);
  });

  it('re-arms his frame timer when it ends, in real time too', () => {
    const { sim, enemy } = seenEnemy(false, Direction.NORTH);
    enemy.visible = Visible.HIDDEN;
    stepUntil(sim, () => enemy.visible === Visible.HIDDEN);
    expect(enemy.nextFrameAt).toBe(passClock(sim) + enemy.aniDelay);
  });

  it('is cancelled when he is seen again: no fade-in, and his frame delay stays', () => {
    const { sim, merc, enemy } = seenEnemy(true);
    const delay = enemy.aniDelay;
    enemy.visible = Visible.HIDDEN;
    for (let i = 0; i < 3 * FADE_STEP_TICKS; i++) sim.step();
    expect(enemy.visible).toBe(Visible.FADING_OUT);
    sim.lookAround();
    expect(merc.oppList[enemy.id]).toBe(Opp.SEEN_CURRENTLY);
    expect([enemy.visible, enemy.fade, enemy.fadeShade]).toEqual([Visible.SEEN, SoldierFade.NONE, DAY_SHADE]);
    for (let i = 0; i < 20 * FADE_STEP_TICKS; i++) sim.step();
    expect([enemy.visible, enemy.fade, enemy.aniDelay]).toEqual([Visible.SEEN, SoldierFade.NONE, delay]);
  });

  it('still shows him: his life loss is told and the view keeps him where he is, fading out', () => {
    const { sim, enemy } = seenEnemy(true);
    enemy.visible = Visible.HIDDEN;
    sim.step();
    sim.drainEvents();
    soldierTakeDamage(sim.state, enemy, 10, 0, DamageReason.GUNFIRE, null);
    expect(sim.drainEvents().filter((e) => e.type === 'lifeLost')).toEqual([expect.objectContaining({ soldier: enemy.id, amount: 10 })]);
    expect(enemy.displayDamage).toBe(true);
    const shown = tacticalViewParts(sim).soldiers.find((s) => s.id === enemy.id);
    expect(shown).toMatchObject({ gridNo: ENEMY_AT, fadingOut: true });
  });

  it('ends at the next tile of a soldier walking away in combat, who keeps his walking delay to the tile after it', () => {
    const { sim, enemy } = seenEnemy(true, Direction.NORTH);
    const walking = states(content.animations).WALKING;
    expect(getNewSoldierPath(sim.state, enemy, gridNo(80, 92), walking)).toBe(true);
    stepUntil(sim, () => enemy.fade === SoldierFade.OUT);
    const fadeStart = enemy.fadeStartGridNo;
    expect(fadeStart).toBe(enemy.gridNo);
    stepUntil(sim, () => enemy.fade === SoldierFade.NONE);
    expect([enemy.visible, enemy.gridNo !== fadeStart]).toEqual([Visible.HIDDEN, true]);
    expect(enemy.fadeShade).toBeLessThan(FADED_SHADE);
    const cancelledAt = enemy.gridNo;
    const walkingDelay = enemy.aniDelay;
    expect(walkingDelay).toBeGreaterThan(0);
    stepUntil(sim, () => {
      if (enemy.gridNo === cancelledAt) expect(enemy.aniDelay).toBe(walkingDelay);
      return enemy.gridNo !== cancelledAt;
    });
    expect(enemy.aniDelay).toBe(0);
  });
});

describe('the fade-in of a soldier who comes into sight', () => {
  it('steps from 12 down to his tile in 60 ms steps, not for our mercs, and re-arms his frame timer at its end', () => {
    const { sim, merc, enemy } = seenEnemy(true);
    merc.lastRenderVisible = Visible.HIDDEN;
    enemy.lastRenderVisible = Visible.HIDDEN;
    sim.step();
    expect([enemy.fade, enemy.fadeShade, merc.fade]).toEqual([SoldierFade.IN, FADED_SHADE, SoldierFade.NONE]);
    const ticks = stepUntil(sim, () => enemy.fade === SoldierFade.NONE);
    expect(ticks).toBe(1 + (FADED_SHADE - DAY_SHADE - 1) * FADE_STEP_TICKS);
    expect(enemy.fadeShade).toBe(DAY_SHADE);
    expect(enemy.nextFrameAt).toBe(passClock(sim) + enemy.aniDelay);
  });
});

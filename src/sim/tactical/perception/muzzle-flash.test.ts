import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { bulletsShownToPlayer } from '../../knowledge/sim-view.ts';
import type { TacticalContent } from '../content.ts';
import { lightSetBaseLevel, lightSpriteCreate, lightSpritePosition, lightSpritePower } from '../lighting/lighting.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { makeNoise, NoiseKind } from './noise.ts';
import { distanceVisible, endMuzzleFlash, Opp } from './sight.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NIGHT = 12;
const UNSEEN = -1;
const SEEN = 1;
const GUNSHOT_VOLUME = 20;

function nightStandoff(
  shooterAt = gridNo(80, 96),
  mercFacing: number = Direction.SOUTH,
): { sim: TacticalSim; merc: Soldier; shooter: Soldier } {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), mercFacing);
  const shooter = spawnSoldier(sim, 20, Team.ENEMY, shooterAt, Direction.NORTH);
  lightSetBaseLevel(sim.state, NIGHT);
  shooter.visible = UNSEEN;
  sim.state.inCombat = true;
  sim.state.turn.currentTeam = Team.ENEMY;
  return { sim, merc, shooter };
}

function fires(sim: TacticalSim, shooter: Soldier): void {
  shooter.muzzleFlash = true;
  makeNoise(sim.state, shooter, shooter.gridNo, shooter.level, GUNSHOT_VOLUME, NoiseKind.GUNFIRE);
}

describe('a muzzle flash in the dark (OppList.cc DistanceVisible, HearNoise, EndMuzzleFlash)', () => {
  it('shows the shooter as far as in daylight and to a sideways glance too', () => {
    const { sim, merc, shooter } = nightStandoff();
    const t = sim.state;
    expect(distanceVisible(t, merc, Direction.EAST, Direction.SOUTH, shooter.gridNo, 0)).toBe(6);
    shooter.muzzleFlash = true;
    expect(distanceVisible(t, merc, Direction.EAST, Direction.SOUTH, shooter.gridNo, 0)).toBe(26);
    expect(distanceVisible(t, merc, Direction.EAST, Direction.SOUTH, shooter.gridNo, 0, false)).toBe(6);
  });

  it('lets a merc facing the gunshot see the shooter beyond his night sight, but not one who has to turn his head', () => {
    const facing = nightStandoff();
    fires(facing.sim, facing.shooter);
    expect(facing.merc.oppList[facing.shooter.id]).toBe(Opp.SEEN_CURRENTLY);
    expect(facing.shooter.visible).toBe(SEEN);
    const turned = nightStandoff(gridNo(80, 96), Direction.EAST);
    fires(turned.sim, turned.shooter);
    expect(turned.merc.oppList[turned.shooter.id]).toBe(Opp.HEARD_THIS_TURN);
    expect(turned.shooter.visible).toBe(UNSEEN);
  });

  it('hides the shooter again when the flash ends unless the squad still sees him in the dark', () => {
    const far = nightStandoff();
    fires(far.sim, far.shooter);
    endMuzzleFlash(far.sim.state, far.shooter);
    expect(far.shooter.muzzleFlash).toBe(false);
    expect(far.shooter.visible).toBe(UNSEEN);
    expect(far.merc.oppList[far.shooter.id]).toBe(Opp.SEEN_THIS_TURN);
    const near = nightStandoff(gridNo(80, 88));
    fires(near.sim, near.shooter);
    endMuzzleFlash(near.sim.state, near.shooter);
    expect(near.shooter.visible).toBe(SEEN);
    expect(near.merc.oppList[near.shooter.id]).toBe(Opp.SEEN_CURRENTLY);
  });
});

function lamp(sim: TacticalSim, g: number): void {
  const l = lightSpriteCreate(sim.state, 'L-R03.LHT');
  if (!l) throw new Error('no lamp');
  lightSpritePower(l, true);
  lightSpritePosition(sim.state, l, g % 160, Math.trunc(g / 160));
}

describe('our merc shooting into the dark on our turn (Handle_UI.cc UnSetUIBusy)', () => {
  it('puts his flash out when his attack ends, before the enemy hears the shot', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 96), Direction.NORTH);
    lightSetBaseLevel(t, NIGHT);
    lamp(sim, enemy.gridNo);
    sim.lookAround();
    expect(t.turn.currentTeam).toBe(Team.OUR);
    expect(merc.oppList[enemy.id]).toBe(Opp.SEEN_CURRENTLY);
    expect(sim.dispatch({ type: 'attack', soldier: merc.id, target: gridNo(83, 96) }).ok).toBe(true);
    const events = runUntilIdle(sim);
    expect(events.some((e) => e.type === 'shotFired' && e.soldier === merc.id)).toBe(true);
    expect(merc.muzzleFlash).toBe(false);
    expect(enemy.oppList[merc.id]).toBe(Opp.HEARD_THIS_TURN);
  });
});

describe('an enemy shooting from the dark on his turn', () => {
  it('shows him once his attack is over, never his bullet, and hides him when he acts again', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const shooter = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 96), Direction.NORTH, { gun: 'M14', marksmanship: 90 });
    lightSetBaseLevel(t, NIGHT);
    lamp(sim, merc.gridNo);
    sim.lookAround();
    expect(shooter.oppList[merc.id]).toBe(Opp.SEEN_CURRENTLY);
    expect(shooter.visible).toBe(UNSEEN);
    expect(t.inCombat).toBe(true);
    expect(t.turn.currentTeam).toBe(Team.ENEMY);
    let bulletsShown = 0;
    let shownAfterShot = false;
    let shot = false;
    for (let tick = 0; tick < 50_000 && !(shot && sim.isIdle()); tick++) {
      sim.step();
      bulletsShown += bulletsShownToPlayer(t, () => 0).length;
      if (sim.drainEvents().some((e) => e.type === 'shotFired' && e.soldier === shooter.id)) shot = true;
      if (shot && shooter.visible === SEEN) shownAfterShot = true;
    }
    expect(shot).toBe(true);
    expect(bulletsShown).toBe(0);
    expect(shownAfterShot).toBe(true);
    expect(shooter.muzzleFlash).toBe(false);
    expect(shooter.visible).toBe(UNSEEN);
  });
});

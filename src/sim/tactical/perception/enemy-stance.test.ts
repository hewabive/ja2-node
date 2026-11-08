import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { WORLD_COLS } from '../../../content/world/grid.ts';
import { anim, animName } from '../anim-states.ts';
import { initNewSoldierAnim, soldierGotoStationaryStance, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { directionToward } from '../movement.ts';
import { type Soldier, Team } from '../soldier.ts';
import { reevaluateEnemyStance } from './enemy-stance.ts';
import { Caller, Opp } from './opp.ts';
import { manSeesMan } from './sight.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NORTH = 0;
const AT = 80 * WORLD_COLS + 80;
const EAST_OF_IT = AT + 4;
const TOWARDS_THE_MERC = directionToward(AT, EAST_OF_IT);
const SOME_APS = 10;

function scene(facing = NORTH) {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, EAST_OF_IT, NORTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, AT, facing);
  return { sim, merc, enemy };
}

function seeing(enemy: Soldier, merc: Soldier): void {
  enemy.oppList[merc.id] = Opp.SEEN_CURRENTLY;
  enemy.ai.oppCount = 1;
}

describe('ReevaluateEnemyStance', () => {
  it('turns an idle enemy who newly sees one of ours towards him, charging the turn in combat', () => {
    const { sim, merc, enemy } = scene();
    sim.state.inCombat = true;
    enemy.actionPoints = 10;
    manSeesMan(sim.state, enemy, merc, Caller.VERIFYANDDECAYOPPLIST);
    expect(enemy.desiredDirection).toBe(directionToward(AT, EAST_OF_IT));
    expect(enemy.actionPoints).toBe(9);
  });

  it('leaves the panic chosen one facing his way: he does not turn towards one of ours he newly sees', () => {
    const { sim, merc, enemy } = scene();
    sim.state.inCombat = true;
    enemy.actionPoints = 10;
    sim.state.panic.chosenOne = enemy;
    manSeesMan(sim.state, enemy, merc, Caller.VERIFYANDDECAYOPPLIST);
    expect([enemy.desiredDirection, enemy.actionPoints]).toEqual([NORTH, 10]);
  });

  it('leaves neutrals, our team and soldiers under AI control alone', () => {
    const { sim, merc, enemy } = scene();
    enemy.neutral = true;
    expect(reevaluateEnemyStance(sim.state, enemy, enemy.state)).toBe(false);
    enemy.neutral = false;
    enemy.aiTurnControl = true;
    enemy.ai.oppCount = 1;
    expect(reevaluateEnemyStance(sim.state, enemy, enemy.state)).toBe(false);
    expect(reevaluateEnemyStance(sim.state, merc, merc.state)).toBe(false);
  });
});

describe('an enemy who sees one of ours at a new animation (EVENT_InitNewSoldierAnim)', () => {
  it('readies his weapon at the merc instead of breathing once his animation ends, turning to him', () => {
    const { sim, merc, enemy } = scene();
    seeing(enemy, merc);
    enemy.state = anim(content, 'END_RIFLE_STAND');
    soldierGotoStationaryStance(sim.state, enemy);
    expect([animName(content, enemy.state), enemy.desiredDirection]).toEqual(['READY_RIFLE_STAND', TOWARDS_THE_MERC]);
  });

  it('does not charge the ready in combat', () => {
    const { sim, merc, enemy } = scene(TOWARDS_THE_MERC);
    sim.state.inCombat = true;
    seeing(enemy, merc);
    enemy.state = anim(content, 'END_RIFLE_STAND');
    enemy.actionPoints = SOME_APS;
    soldierGotoStationaryStance(sim.state, enemy);
    expect([animName(content, enemy.state), enemy.actionPoints]).toEqual(['READY_RIFLE_STAND', SOME_APS]);
  });

  it('readies an enemy already breathing on his feet: the check comes before the refused restart of his breath', () => {
    const { sim, merc, enemy } = scene();
    seeing(enemy, merc);
    initNewSoldierAnim(sim.state, enemy, states(content.animations).STANDING, 0, false);
    expect(animName(content, enemy.state)).toBe('READY_RIFLE_STAND');
  });

  it('only turns an enemy whose gun is already up, and leaves his next ready free: the flag that spares it stays set', () => {
    const { sim, merc, enemy } = scene();
    const t = sim.state;
    t.inCombat = true;
    seeing(enemy, merc);
    enemy.state = anim(content, 'AIM_RIFLE_STAND');
    initNewSoldierAnim(t, enemy, states(content.animations).STANDING, 0, false);
    expect([animName(content, enemy.state), enemy.desiredDirection, enemy.dontChargeReadyAPs]).toEqual([
      'STANDING',
      TOWARDS_THE_MERC,
      true,
    ]);
    enemy.actionPoints = SOME_APS;
    initNewSoldierAnim(t, enemy, anim(content, 'READY_RIFLE_STAND'), 0, false);
    expect([animName(content, enemy.state), enemy.actionPoints]).toEqual(['READY_RIFLE_STAND', SOME_APS]);
  });

  it('lets the enemy whose turn it is and an enemy who sees none of ours breathe', () => {
    const acting = scene();
    seeing(acting.enemy, acting.merc);
    acting.enemy.aiTurnControl = true;
    acting.enemy.state = anim(content, 'END_RIFLE_STAND');
    soldierGotoStationaryStance(acting.sim.state, acting.enemy);
    const blind = scene();
    blind.enemy.state = anim(content, 'END_RIFLE_STAND');
    soldierGotoStationaryStance(blind.sim.state, blind.enemy);
    expect([animName(content, acting.enemy.state), animName(content, blind.enemy.state)]).toEqual(['STANDING', 'STANDING']);
  });
});

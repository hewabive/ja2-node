import { beforeAll, describe, expect, it } from 'vitest';
import { runUntilIdle } from '../../../../tests/support/combat.ts';
import { stabberHaltedOnHisWalkUp } from '../../../../tests/support/halted-strike.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { animName } from '../anim-states.ts';
import type { TacticalContent } from '../content.ts';
import { NO_PENDING_ANIMATION, Team } from '../soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const LIFE_THAT_BLEEDS_OUT_ON_THE_ENEMY_TURN = 10;

describe('End Turn and a merc halted on a walk-up strike (TeamTurns.cc EndTurn)', () => {
  it('lets him finish his step and strike on the enemy turn, since End Turn cancels the move but keeps the pending action', () => {
    const { sim, stabber, dying } = stabberHaltedOnHisWalkUp(content);
    expect(sim.dispatch({ type: 'endTurn' })).toEqual({ ok: true });
    expect([stabber.finalDestination, stabber.noAPToFinishMove, stabber.pendingMelee === null]).toEqual([stabber.gridNo, false, false]);
    const events = runUntilIdle(sim);
    const strike = events.find((e) => e.type === 'meleeStrike' && e.soldier === stabber.id);
    const ourTurn = events.find((e) => e.type === 'turnStarted' && e.team === Team.OUR);
    expect(strike?.tick).toBeLessThan(ourTurn?.tick ?? 0);
    expect([dying.life, stabber.pendingMelee]).toEqual([0, null]);
  });
});

describe('a walk-up strike whose target bleeds to death while the merc kneels for it', () => {
  function strikeHaltedByTheCorpsesItems() {
    const halted = stabberHaltedOnHisWalkUp(content, LIFE_THAT_BLEEDS_OUT_ON_THE_ENEMY_TURN);
    expect(halted.sim.dispatch({ type: 'endTurn' })).toEqual({ ok: true });
    runUntilIdle(halted.sim);
    return halted;
  }

  it('leaves him free on our turn: the dropped items halt the strike (FOV.cc HaultSoldierFromSighting), and the stab left pending on his crouching loop holds no order back', () => {
    const { sim, stabber, dying } = strikeHaltedByTheCorpsesItems();
    const t = sim.state;
    expect([dying.life, t.turn.currentTeam, t.turn.attackBusyCount]).toEqual([0, Team.OUR, 0]);
    expect([animName(content, stabber.state), animName(content, stabber.pendingAnimation), stabber.noAPToFinishMove]).toEqual([
      'CROUCHING',
      'CROUCH_STAB',
      true,
    ]);
    expect(sim.isBusy(stabber)).toBe(false);
    expect(sim.dispatch({ type: 'endTurn' })).toEqual({ ok: true });
  });

  it('keeps the halted stab pending, so his next stance change kneels him down again and stabs at the empty tile', () => {
    const { sim, stabber } = strikeHaltedByTheCorpsesItems();
    const apsBefore = stabber.actionPoints;
    expect(sim.dispatch({ type: 'stance', soldier: stabber.id, stance: 'stand' })).toEqual({ ok: true });
    const played: string[] = [];
    for (let tick = 0; tick < 5000 && (tick === 0 || !sim.isIdle()); tick++) {
      sim.step();
      const state = animName(content, stabber.state);
      if (played.at(-1) !== state) played.push(state);
    }
    expect(played).toEqual(['KNEEL_UP', 'KNEEL_DOWN', 'CROUCH_STAB', 'CROUCHING']);
    expect(stabber.actionPoints).toBeLessThan(apsBefore);
    expect([stabber.pendingAnimation, sim.state.turn.attackBusyCount]).toEqual([NO_PENDING_ANIMATION, 0]);
  });
});

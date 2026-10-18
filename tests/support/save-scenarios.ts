import { expect } from 'vitest';
import { CampaignSession } from '../../src/server/campaign-session.ts';
import type { Session } from '../../src/server/session.ts';
import { Team } from '../../src/sim/tactical/soldier.ts';
import { teamMembers } from '../../src/sim/tactical/state.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import type { SaveKit } from './saves.ts';

const COLS = 160;
const SOUTH_STEP = COLS * 3;
const APPROACH_STEPS = 16;
export const BATTLE_SANDBOX_SEED = 7;

export function tacticalOf(session: Session): TacticalSim {
  const sim = session.sim;
  if (sim instanceof CampaignSession) return sim.sim;
  return (sim as unknown as { sim: TacticalSim }).sim;
}

export function inCombat(session: Session): boolean {
  return tacticalOf(session).state.inCombat;
}

export function ourTurn(session: Session): boolean {
  const t = tacticalOf(session).state;
  return t.inCombat && t.turn.currentTeam === Team.OUR;
}

function nearestEnemy(session: Session, from: number): number | null {
  const enemies = teamMembers(tacticalOf(session).state, Team.ENEMY);
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of enemies) {
    const d = Math.hypot((e.gridNo % COLS) - (from % COLS), Math.trunc(e.gridNo / COLS) - Math.trunc(from / COLS));
    if (d < bestDistance) {
      bestDistance = d;
      best = e.gridNo;
    }
  }
  return best;
}

export function approachUntilCombat(session: Session, towardEnemies: boolean): void {
  for (let step = 0; step < APPROACH_STEPS && !inCombat(session); step++) {
    for (const s of teamMembers(tacticalOf(session).state, Team.OUR)) {
      const target = towardEnemies ? (nearestEnemy(session, s.gridNo) ?? s.gridNo + SOUTH_STEP) : s.gridNo + SOUTH_STEP;
      session.dispatch({ type: 'move', soldier: s.id, to: target, mode: 'swat' });
    }
    session.advance({ idle: true, events: ['combatStarted'] });
  }
  expect(inCombat(session)).toBe(true);
}

export function untilOurTurn(session: Session): void {
  session.advance({ idle: true });
  expect(ourTurn(session) || !inCombat(session)).toBe(true);
}

export async function battleSandbox(k: SaveKit): Promise<Session> {
  const session = await k.open({ seed: BATTLE_SANDBOX_SEED });
  approachUntilCombat(session, false);
  untilOurTurn(session);
  return session;
}

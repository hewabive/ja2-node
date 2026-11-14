import type { SoldierView } from '../../src/protocol/view.ts';
import { type BattleResult, fightHere, hostilesInSight } from './battle.ts';
import { readyHand } from './gear.ts';
import { centroid, ring, tiles } from './grid.ts';
import type { Observation } from './mcp-game.ts';
import { walkTo } from './npc.ts';
import { ourMercs, type Player, QUEEN, usable } from './player.ts';
import { attackConfirmingPoorShot, refusalOfResult } from './refusals.ts';
import { Palace } from './stub-world.ts';

const NEAR_STAIRS = 6;
const DESCEND_TICKS = 20_000;
const HUNT_STEPS = 60;
const ENDGAME_STEPS = 20;
const AIM = 2;
const WALKS_TO_SEE_THE_STAIRS = 3;

function anchor(view: Observation): number | null {
  const points = ourMercs(view)
    .filter(usable)
    .map((m) => m.gridNo);
  return points.length > 0 ? centroid(points) : null;
}

export function nearStairs(view: Observation): boolean {
  const at = anchor(view);
  return !view.combat && at !== null && tiles(at, Palace.stairsDown) <= NEAR_STAIRS;
}

export function inBasement(view: Observation): boolean {
  return view.strategic?.worldSector === Palace.basement;
}

export function storm(p: Player): Promise<BattleResult> {
  return fightHere(p, { objective: Palace.stairsDown, done: (view) => nearStairs(view) || inBasement(view) });
}

function leadToTheStairs(view: Observation): SoldierView | undefined {
  return ourMercs(view)
    .filter((m) => usable(m) && m.kind !== 'epc')
    .sort((a, b) => tiles(a.gridNo, Palace.stairsDown) - tiles(b.gridNo, Palace.stairsDown) || a.id - b.id)[0];
}

async function walkBesideTheStairs(p: Player, lead: SoldierView): Promise<boolean> {
  const beside = ring(Palace.stairsDown, 1)
    .filter((g) => g !== lead.gridNo)
    .sort((a, b) => tiles(lead.gridNo, a) - tiles(lead.gridNo, b) || a - b);
  for (const to of beside) if (await walkTo(p, lead, to)) return true;
  return false;
}

async function leaveByTheStairs(p: Player): Promise<boolean> {
  for (let walks = 0; walks <= WALKS_TO_SEE_THE_STAIRS; walks++) {
    const lead = leadToTheStairs(await p.observe());
    if (!lead) return false;
    const exited = await p.act({ type: 'exitSector', soldier: lead.id, exitGrid: Palace.stairsDown, who: 'squad' });
    if (exited.ok) return true;
    if (refusalOfResult(exited) !== 'notRevealed' || walks === WALKS_TO_SEE_THE_STAIRS) {
      p.log(`  the stairs down are refused: ${exited.reason ?? ''}`);
      return false;
    }
    p.log(`  no merc has seen the stairs down yet: ${lead.name} walks into their room`);
    if (!(await walkBesideTheStairs(p, lead))) {
      p.log(`  ${lead.name} cannot reach the stairs down`);
      return false;
    }
  }
  return false;
}

export async function descend(p: Player): Promise<boolean> {
  if (inBasement(await p.observe())) return true;
  if (!(await leaveByTheStairs(p))) return false;
  await p.advance({ idle: true, ticks: DESCEND_TICKS, events: ['sectorLoaded'] });
  await p.advance({ idle: true, ticks: DESCEND_TICKS });
  return inBasement(await p.observe());
}

function queenIn(view: Observation): SoldierView | undefined {
  return view.soldiers.find((s) => s.profile === QUEEN);
}

async function shootAt(p: Player, target: SoldierView): Promise<boolean> {
  const view = await p.observe();
  let fired = false;
  for (const merc of ourMercs(view).filter((m) => usable(m) && m.kind !== 'epc')) {
    if ((await readyHand(p, merc, view.combat !== null && view.combat !== undefined)) === 'acted') continue;
    const attack = await attackConfirmingPoorShot(p, {
      type: 'attack',
      soldier: merc.id,
      target: target.gridNo,
      level: target.level,
      aimTime: AIM,
    });
    if (!attack.ok) continue;
    fired = true;
    await p.advance({ idle: true, ticks: DESCEND_TICKS });
    if (!queenIn(await p.observe())) break;
  }
  return fired;
}

export async function killTheQueen(p: Player): Promise<boolean> {
  for (let step = 0; step < HUNT_STEPS; step++) {
    const view = await p.observe();
    if (view.ended || view.strategic?.flow === 'endgame' || view.strategic?.flow === 'ended') return true;
    if (view.combat && view.combat.team !== 0) {
      await p.advance({ idle: true });
      continue;
    }
    const queen = queenIn(view);
    if (queen) {
      const fired = await shootAt(p, queen);
      if (!fired && view.combat) await p.act({ type: 'endTurn' });
      if (!fired && view.combat) await p.advance({ idle: true });
      continue;
    }
    if (hostilesInSight(p, view).length === 0) {
      const merc = ourMercs(view).find((m) => usable(m));
      if (!merc) return false;
      const moved = await p.act({ type: 'move', soldier: merc.id, to: Palace.queenInBasement, mode: 'walk' });
      if (!moved.ok) p.log(`  cannot walk toward the Queen: ${moved.reason ?? ''}`);
      await p.advance({ idle: true, ticks: DESCEND_TICKS, events: ['enemySighted', 'combatStarted'] });
    }
  }
  return false;
}

export async function playEnding(p: Player): Promise<boolean> {
  for (let step = 0; step < ENDGAME_STEPS; step++) {
    const view = await p.observe();
    if (view.ended) return true;
    const report = await p.advance({ idle: true });
    if (report.reason === 'ended') return true;
  }
  return (await p.observe()).ended !== undefined && (await p.observe()).ended !== null;
}

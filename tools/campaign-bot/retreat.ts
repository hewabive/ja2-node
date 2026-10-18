import type { SoldierView } from '../../src/protocol/view.ts';
import { nearest, ring, tiles } from './grid.ts';
import type { Observation } from './mcp-game.ts';
import { ourMercs, type Player, usable } from './player.ts';

export type Edge = 'north' | 'east' | 'south' | 'west';

export interface Retreat {
  readonly edge: Edge;
  readonly homes: Map<number, number>;
  readonly initial: number;
  readonly casualtyLimit: number | null;
  active: boolean;
}

const LEAVE_TICKS = 6000;
const HALF = 0.5;
const LAST_STAND = 2;

export function planRetreat(edge: Edge, view: Observation, casualtyLimit: number | null = null): Retreat {
  const mercs = ourMercs(view).filter((m) => usable(m) && m.kind !== 'epc');
  return { edge, homes: new Map(mercs.map((m) => [m.id, m.gridNo])), initial: mercs.length, casualtyLimit, active: false };
}

export function shouldRetreat(r: Retreat, view: Observation, hostiles: number): boolean {
  if (r.active) return true;
  const standing = ourMercs(view).filter((m) => usable(m) && m.kind !== 'epc').length;
  if (standing === 0) return false;
  if (r.casualtyLimit !== null && r.initial - standing >= r.casualtyLimit) return true;
  if (hostiles === 0) return false;
  const beaten = standing <= Math.ceil(r.initial * HALF) && hostiles >= standing;
  const lastStand = standing <= LAST_STAND && hostiles > standing;
  return beaten || lastStand;
}

function homeOf(r: Retreat, merc: SoldierView): number | null {
  return r.homes.get(merc.id) ?? nearest(merc.gridNo, [...r.homes.values()]);
}

async function walkHome(p: Player, merc: SoldierView, home: number): Promise<boolean> {
  for (const to of [home, ...ring(home, 1), ...ring(home, 2)]) {
    if (to === merc.gridNo) return false;
    const moved = await p.act({ type: 'move', soldier: merc.id, to, mode: 'run' });
    if (moved.ok) return true;
    if (moved.reason?.startsWith('not enough APs')) return false;
  }
  return false;
}

export async function retreatStep(p: Player, view: Observation, r: Retreat): Promise<boolean> {
  if (!r.active) p.log(`  retreating ${r.edge}`);
  r.active = true;
  let acted = false;
  for (const merc of ourMercs(view).filter((m) => usable(m) && m.kind !== 'epc')) {
    const fresh = (await p.observe()).soldiers.find((s) => s.id === merc.id);
    if (!fresh) continue;
    const left = await p.act({ type: 'exitSector', soldier: fresh.id, direction: r.edge, who: 'merc', load: false });
    if (left.ok) {
      acted = true;
      await p.advance({ idle: true, ticks: LEAVE_TICKS });
      continue;
    }
    const home = homeOf(r, fresh);
    if (home === null || tiles(fresh.gridNo, home) === 0) continue;
    if (await walkHome(p, fresh, home)) {
      acted = true;
      await p.advance({ idle: true, ticks: LEAVE_TICKS });
    }
  }
  return acted;
}

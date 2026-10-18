import type { StrategicMercView } from '../../src/protocol/view.ts';
import { type BattleResult, fightHere, sectorEnemies } from './battle.ts';
import type { Observation } from './mcp-game.ts';
import type { Player } from './player.ts';
import { answerPrompts } from './prompts.ts';

export type TravelResult = 'arrived' | 'lost' | 'stuck' | 'retreated';

const TRAVEL_SLICE_SECONDS = 4 * 3600;
const MAX_TRAVEL_STEPS = 400;
const MAX_ROUTE_ATTEMPTS = 40;
const WAIT_SLICE_SECONDS = 3600;
const DAY_SECONDS = 86_400;
const HOUR_SECONDS = 3600;
const MINUTE_SECONDS = 60;
const TOO_INJURED = 'tooInjured';
export const PRISONER = 32;

export function squad(view: Observation): StrategicMercView[] {
  return (view.strategic?.mercs ?? []).filter(
    (m) => m.kind !== 'vehicle' && m.life > 0 && m.arrival === undefined && m.vehicle === undefined && m.assignment !== PRISONER,
  );
}

export function travellers(view: Observation): StrategicMercView[] {
  return squad(view).filter((m) => m.squad !== null);
}

function allIn(view: Observation, sector: string): boolean {
  const mercs = travellers(view);
  return mercs.length > 0 && mercs.every((m) => m.sector === sector && !m.betweenSectors);
}

export async function mapScreen(p: Player): Promise<boolean> {
  const view = await p.observe();
  if (view.strategic?.flow === 'strategic') return true;
  const opened = await p.act({ type: 'mapScreen' });
  if (!opened.ok) p.log(`  mapScreen refused: ${opened.reason ?? ''}`);
  return opened.ok;
}

export type Fight = (p: Player) => Promise<BattleResult>;

function battleLeftOnMapScreen(view: Observation): string | null {
  const world = view.strategic?.worldSector;
  if (view.strategic?.flow !== 'strategic' || !world || sectorEnemies(view) === 0) return null;
  return squad(view).some((m) => m.sector === world && !m.betweenSectors) ? world : null;
}

async function battleOrPrompt(p: Player, view: Observation, fight: Fight): Promise<BattleResult | 'answered' | 'none'> {
  if (await answerPrompts(p, view)) return 'answered';
  const left = battleLeftOnMapScreen(view);
  if (left && (await enter(p, left))) return 'answered';
  if (view.strategic?.flow === 'tactical' && (view.combat || sectorEnemies(view) > 0)) {
    p.log(`  battle in ${view.strategic.worldSector}: ${sectorEnemies(view)} enemies`);
    const result = await fight(p);
    p.log(`  battle in ${view.strategic.worldSector}: ${result}`);
    return result;
  }
  return 'none';
}

type RouteOutcome = 'routed' | 'injured' | 'refused';

async function routeSquads(p: Player, view: Observation, to: string): Promise<RouteOutcome> {
  const leaders = new Map<number, StrategicMercView>();
  for (const m of travellers(view)) if (m.squad !== null && !leaders.has(m.squad)) leaders.set(m.squad, m);
  let outcome: RouteOutcome = 'refused';
  for (const leader of leaders.values()) {
    if (leader.sector === to && !leader.betweenSectors) continue;
    const result = await p.act({ type: 'route', soldier: leader.id, to });
    if (result.ok) outcome = 'routed';
    else {
      p.log(`  route ${leader.name} to ${to} refused: ${result.reason ?? ''}`);
      if (outcome !== 'routed' && result.reason?.includes(TOO_INJURED)) outcome = 'injured';
    }
  }
  return outcome;
}

export type Recover = () => Promise<void>;

export async function travel(p: Player, to: string, fight: Fight = fightHere, recover?: Recover): Promise<TravelResult> {
  let attempts = 0;
  for (let step = 0; step < MAX_TRAVEL_STEPS; step++) {
    const view = await p.observe();
    if (squad(view).length === 0) return 'lost';
    const fought = await battleOrPrompt(p, view, fight);
    if (fought === 'lost') return 'lost';
    if (fought === 'stuck') return 'stuck';
    if (fought === 'reached') return 'arrived';
    if (fought === 'retreated') return 'retreated';
    if (fought !== 'none') continue;
    if (allIn(view, to)) return 'arrived';
    if (!(await mapScreen(p))) return 'stuck';
    const moving = travellers(p.view).some(
      (m) => m.betweenSectors || (p.view.strategic?.groups ?? []).some((g) => g.members.includes(m.id) && g.path.length > 0),
    );
    if (!moving) {
      if (attempts++ >= MAX_ROUTE_ATTEMPTS) return 'stuck';
      const routed = await routeSquads(p, p.view, to);
      if (routed === 'injured' && recover) {
        await recover();
        continue;
      }
      if (routed !== 'routed') {
        await p.advance({ worldSeconds: WAIT_SLICE_SECONDS });
        continue;
      }
    }
    const report = await p.advance({ worldSeconds: TRAVEL_SLICE_SECONDS });
    if (report.reason === 'refused') {
      p.log(`  travel to ${to}: advance refused: ${report.refusal ?? ''}`);
      await p.advance({ idle: true });
    }
  }
  return 'stuck';
}

export async function enter(p: Player, sector: string): Promise<boolean> {
  const view = await p.observe();
  if (view.strategic?.flow === 'tactical' && view.strategic.worldSector === sector) return true;
  const entered = await p.act({ type: 'enterSector', sector });
  if (!entered.ok) {
    p.log(`  enterSector ${sector} refused: ${entered.reason ?? ''}`);
    return false;
  }
  await p.advance({ idle: true });
  return true;
}

export function worldSeconds(view: Observation): number {
  const clock = view.clock;
  return clock ? clock.day * DAY_SECONDS + clock.hour * HOUR_SECONDS + clock.minute * MINUTE_SECONDS : 0;
}

export async function waitHours(p: Player, hours: number): Promise<void> {
  if (!(await mapScreen(p))) return;
  const target = worldSeconds(await p.observe()) + hours * HOUR_SECONDS;
  for (let step = 0; step < hours * 4 + 8; step++) {
    const view = await p.observe();
    const fought = await battleOrPrompt(p, view, fightHere);
    if (fought !== 'none') {
      await mapScreen(p);
      continue;
    }
    if (worldSeconds(view) >= target) return;
    const report = await p.advance({ worldTime: target });
    if (report.reason === 'worldTime') return;
    if (report.reason === 'refused') {
      p.log(`  wait: advance refused: ${report.refusal ?? ''}`);
      return;
    }
  }
}

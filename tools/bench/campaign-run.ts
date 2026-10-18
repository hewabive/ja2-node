import { createCampaignSession } from '../../src/server/campaign-factory.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { Session } from '../../src/server/session.ts';
import type { StopReport, WorldTimeTarget } from '../../src/sim/advance.ts';
import type { BattlePrompt } from '../../src/sim/strategic/forces/battle-state.ts';
import { numEnemiesInSector } from '../../src/sim/strategic/forces/groups.ts';
import { CompressMode } from '../../src/sim/strategic/time/constants.ts';
import { type Battlefield, fight, MeteredSim, startsBattle } from './battle.ts';
import type { BenchData } from './data.ts';

export interface Campaign {
  readonly campaignSession: CampaignSession;
  readonly metered: MeteredSim;
  readonly session: Session;
}

const CLEAR_ATTEMPTS = 12;
const CLEARING_FIRE = { shots: 3, aimTime: 2 };
const SQUAD = 6;
const LEAVE_TICKS = 40_000;
const AFTERMATH_TICKS = 200;
const PROMPT_ROUNDS = 40;
const IDLE_BUDGET_TICKS = 200_000;
const SECONDS_PER_DAY = 86_400;
const ESCAPE_SECTOR = 'B9';

export async function newLandedCampaign(data: BenchData, seed: number): Promise<Campaign> {
  const campaignSession = await createCampaignSession(data.read, data.exists, seed, { mercs: SQUAD }, data.layers);
  const metered = new MeteredSim(campaignSession);
  return { campaignSession, metered, session: new Session(`campaign-${seed}`, metered) };
}

function enemiesLeft(c: Campaign): number {
  const t = c.campaignSession.campaign.tactical?.state;
  return t ? t.soldiers.filter((s) => s?.placed && s.team === 1 && s.life > 0).length : 0;
}

export function battlefield(c: Campaign): Battlefield {
  return { session: c.session, metered: c.metered, sim: () => c.campaignSession.sim, resolve: () => answerPrompts(c) };
}

function finishCombat(c: Campaign): void {
  for (let round = 0; round < PROMPT_ROUNDS && c.campaignSession.campaign.tactical?.state.inCombat; round++) {
    c.session.dispatch({ type: 'endTurn' });
    c.session.advance({ idle: true }, IDLE_BUDGET_TICKS);
    answerPrompts(c);
  }
  for (let round = 0; round < PROMPT_ROUNDS && strategicEnemiesHere(c) > 0; round++) {
    c.session.advance({ ticks: AFTERMATH_TICKS });
    answerPrompts(c);
  }
}

function strategicEnemiesHere(c: Campaign): number {
  const campaign = c.campaignSession.campaign;
  const world = campaign.state.worldSector;
  return campaign.strategic && world ? numEnemiesInSector(campaign.strategic, world) : 0;
}

export function clearSector(c: Campaign): string {
  let outcome = 'noEnemies';
  const field = battlefield(c);
  for (let attempt = 0; attempt < CLEAR_ATTEMPTS && enemiesLeft(c) > 0; attempt++) {
    if (!startsBattle(field)) {
      outcome = 'notEngaged';
      break;
    }
    outcome = fight(field, CLEARING_FIRE).outcome;
    if (outcome === 'lost' || outcome.startsWith('stalled')) break;
    c.session.advance({ idle: true }, IDLE_BUDGET_TICKS);
    answerPrompts(c);
  }
  if (enemiesLeft(c) > 0) return outcome;
  finishCombat(c);
  if (strategicEnemiesHere(c) > 0) return 'tacticalEnemiesGoneButStrategicCountLeft';
  return c.campaignSession.campaign.tactical?.state.turn.enemyInSector ? 'cleared (enemyInSector flag still set)' : 'cleared';
}

function choiceFor(prompt: BattlePrompt): string[] {
  switch (prompt.kind) {
    case 'preBattle': {
      const enabled: readonly string[] = prompt.options.filter((o) => o.enabled).map((o) => o.choice);
      return ['retreat', 'autoresolve', ...enabled].filter((choice) => enabled.includes(choice));
    }
    case 'surrender':
      return ['reject'];
    case 'autoresolveDone':
      return ['done'];
    case 'npcOfNote':
      return ['continue'];
    case 'simultaneousArrival':
      return ['separately', 'together'];
    case 'contractRenewal':
      return ['twoWeeks', 'week', 'day', 'letGo'];
    case 'mercDeparture':
      return [...prompt.choices];
    case 'insuranceExtension':
      return ['no'];
    case 'npcRequest':
      return [...prompt.choices];
    case 'militiaPayment':
    case 'militiaContinue':
      return ['no', 'yes'];
  }
}

export function answerPrompts(c: Campaign): number {
  const campaign = c.campaignSession.campaign;
  let answered = 0;
  for (let round = 0; round < PROMPT_ROUNDS; round++) {
    const prompt = campaign.state.battle.prompt;
    if (!prompt) {
      if (campaign.state.flow === 'autoresolve') c.session.advance({ idle: true }, IDLE_BUDGET_TICKS);
      if (!campaign.state.battle.prompt) return answered;
      continue;
    }
    const accepted = choiceFor(prompt).some((choice) => c.session.dispatch({ type: 'answer', prompt: prompt.id, choice }).ok);
    if (!accepted) throw new Error(`bench: no answer accepted for the ${prompt.kind} prompt`);
    answered++;
  }
  throw new Error('bench: prompts keep coming');
}

export function leaveSector(c: Campaign): void {
  const campaign = c.campaignSession.campaign;
  const mercs = c.campaignSession.roster?.all() ?? [];
  for (const m of mercs) {
    const routed = c.session.dispatch({ type: 'route', soldier: m.id, to: ESCAPE_SECTOR });
    if (!routed.ok) throw new Error(`bench: route refused: ${routed.reason ?? ''}`);
  }
  c.session.advance({ ticks: LEAVE_TICKS, events: ['sectorUnloaded'] });
  if (campaign.state.flow !== 'strategic' || campaign.tactical) throw new Error('bench: the squad did not leave the sector');
}

export function worldSeconds(c: Campaign): number {
  return c.campaignSession.campaign.state.clock.seconds;
}

export class CompressionRefused extends Error {}

export function compressUntil(c: Campaign, target: WorldTimeTarget): StopReport[] {
  const reports: StopReport[] = [];
  for (let round = 0; round < PROMPT_ROUNDS; round++) {
    const report = c.session.advance({ worldTime: target, compressionStopped: false, mode: CompressMode.MIN60 });
    reports.push(report);
    if (report.reason === 'worldTime' || report.reason === 'ended') return reports;
    if (report.reason === 'refused') throw new CompressionRefused(report.refusal ?? 'compression refused');
    answerPrompts(c);
  }
  throw new Error('bench: the world-time target was not reached');
}

export function nextDay(c: Campaign): number {
  return (Math.trunc(worldSeconds(c) / SECONDS_PER_DAY) + 1) * SECONDS_PER_DAY;
}

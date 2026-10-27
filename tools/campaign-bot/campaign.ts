import type { ItemTable } from '../../src/content/items/items.ts';
import { fightHere } from './battle.ts';
import { rearm } from './first-aid.ts';
import { rejoinSquad, restAndHeal } from './heal.ts';
import type { Game, GameEvent, Observation } from './mcp-game.ts';
import { buy, closeConversation, leadMerc, openDoor, say, talk, walkTo } from './npc.ts';
import { Quartermaster } from './outfit.ts';
import { descend, killTheQueen, playEnding, storm } from './palace.ts';
import { Player } from './player.ts';
import { NO_RELOADS, type ReloadPlan, type ReloadReport, Reloads } from './reload.ts';
import type { Edge } from './retreat.ts';
import {
  BOBBY_RAY,
  BOBBY_RAY_ORDER,
  DRASSEN,
  DRASSEN_SHOPPING,
  HELIPAD,
  MEDUNA_APPROACH,
  MEDUNA_ASSAULT,
  MineOffice,
  Npc,
  Palace,
  SKYRIDER_FARMS,
  TownShop,
} from './stub-world.ts';
import { enter, mapScreen, PRISONER, squad, travel, waitHours, worldSeconds } from './travel.ts';

export interface CampaignOptions {
  readonly seed: number;
  readonly difficulty?: number;
  readonly log?: (line: string) => void;
  readonly stopAfter?: string;
  readonly trace?: boolean;
  readonly verbose?: boolean;
  readonly reloads?: ReloadPlan;
}

export type CampaignOutcome = 'won' | 'lost' | 'stuck' | 'stopped';

export interface CampaignSummary {
  readonly seed: number;
  readonly outcome: CampaignOutcome;
  readonly step: string;
  readonly reason?: string;
  readonly days: number;
  readonly battles: number;
  readonly battlesWon: number;
  readonly rounds: number;
  readonly mercsLost: number;
  readonly enemiesKilled: number;
  readonly calls: number;
  readonly session: string;
  readonly reloads: ReloadReport;
}

export const HIRE_PREFERENCE = [8, 0, 3, 4, 10, 1, 2, 5, 9, 7, 11, 6] as const;
const MEDIC_PREFERENCE = [4, 6, 2, 5] as const;
const HATED_PAIRS: readonly (readonly [number, number])[] = [[6, 1]];
const SQUAD_SIZE = 6;
const CONTRACT_DAYS = 14;
const DEFAULT_DIFFICULTY = 1;
const LANDING_MODE = 2;
const HEAL_HOURS = 12;
const DAY_SECONDS = 86_400;
const SHOPPING_RESERVE = 8000;
const TRAINING_HOURS = 30;
const TRAINING_SLICE_HOURS = 3;
const ESCORT_TICKS = 20_000;
const TARGET_TEAM = 12;
const RECRUITING_SLICES = 12;
const RECRUITING_HOURS = 12;
const REINFORCEMENT_CONTRACT_DAYS = 7;
const REINFORCEMENT_RESERVE = 4000;
const ARRIVAL_HOURS = 36;
const ARRIVAL_SLICE_HOURS = 3;
const MARCH_REST_HOURS = 18;
const ASSAULT_REST_HOURS = 18;
const ASSAULT_ATTEMPTS = 6;
const ASSAULT_CASUALTY_LIMIT = 2;
const REGROUP_HOURS = 24;
const ROWS = 'ABCDEFGHIJKLMNOP';
const MERC_INTRO_MAIL = 'MERC_INTRO';
const MERC_DAYS_FUNDED = 7;

class CampaignStop extends Error {
  readonly outcome: CampaignOutcome;
  constructor(outcome: CampaignOutcome, reason: string) {
    super(reason);
    this.outcome = outcome;
  }
}

interface Step {
  readonly name: string;
  run(): Promise<void>;
}

export class CampaignBot {
  readonly p: Player;

  constructor(p: Player) {
    this.p = p;
  }

  async winHere(): Promise<void> {
    const result = await fightHere(this.p);
    if (result !== 'won')
      throw new CampaignStop(result === 'lost' ? 'lost' : 'stuck', `battle in ${this.p.view.strategic?.worldSector}: ${result}`);
  }

  async go(sector: string): Promise<void> {
    const result = await travel(this.p, sector, fightHere, () => this.recover());
    if (result !== 'arrived') throw new CampaignStop(result === 'lost' ? 'lost' : 'stuck', `travel to ${sector}: ${result}`);
  }

  async outfit(sector: string): Promise<void> {
    if (!(await mapScreen(this.p))) return;
    await new Quartermaster(this.p, sector, this.p.medics).run();
  }

  async recover(): Promise<void> {
    const here = squad(await this.p.observe()).find((m) => !m.betweenSectors)?.sector;
    if (here) await restAndHeal(this.p, here, this.p.medics, HEAL_HOURS);
  }

  async heal(sector: string): Promise<void> {
    await restAndHeal(this.p, sector, this.p.medics, HEAL_HOURS);
  }

  async liberate(sector: string): Promise<void> {
    await this.go(sector);
    const view = await this.p.observe();
    if (view.strategic?.flow === 'tactical') await this.winHere();
    await this.outfit(sector);
    await this.heal(sector);
  }

  async lead(): Promise<NonNullable<Awaited<ReturnType<typeof leadMerc>>>> {
    const merc = await leadMerc(this.p);
    if (!merc) throw new CampaignStop('lost', 'nobody is left to act');
    return merc;
  }

  async visit(sector: string): Promise<void> {
    await this.go(sector);
    if (!(await enter(this.p, sector))) throw new CampaignStop('stuck', `cannot enter ${sector}`);
  }

  async startMine(): Promise<void> {
    await this.visit(DRASSEN.mine);
    const merc = await this.lead();
    await openDoor(this.p, merc, MineOffice.door);
    await walkTo(this.p, await this.lead(), MineOffice.inside);
    await talk(this.p, await this.lead(), Npc.FRED);
    const lines = (await this.p.observe()).conversation?.lastQuotes.length ?? 0;
    this.p.log(`  Fred said ${lines} line(s)`);
    await closeConversation(this.p);
  }

  async shop(): Promise<void> {
    await this.visit(DRASSEN.town);
    await rearm(this.p);
    await openDoor(this.p, await this.lead(), TownShop.door);
    await walkTo(this.p, await this.lead(), TownShop.inside);
    const view = await this.p.observe();
    const keeper = view.soldiers.find((s) => s.profile === Npc.KEITH);
    if (keeper) await this.p.act({ type: 'turn', soldier: (await this.lead()).id, toward: keeper.gridNo });
    await this.p.advance({ idle: true, ticks: ESCORT_TICKS });
    const bought = await buy(this.p, await this.lead(), Npc.KEITH, DRASSEN_SHOPPING, SHOPPING_RESERVE);
    this.p.log(`  bought ${bought.join(', ') || 'nothing'}`);
    await this.outfit(DRASSEN.town);
  }

  async laptop<T>(work: () => Promise<T>): Promise<T | null> {
    if (!(await mapScreen(this.p))) return null;
    const opened = await this.p.act({ type: 'openLaptop' });
    if (!opened.ok) {
      this.p.log(`  the laptop did not open: ${opened.reason ?? ''}`);
      return null;
    }
    try {
      return await work();
    } finally {
      await this.p.act({ type: 'closeLaptop' });
    }
  }

  async orderSupplies(): Promise<void> {
    await this.laptop(async () => {
      const stock = (await this.p.observe()).laptop?.bobbyRay?.newStock ?? [];
      const lines = BOBBY_RAY_ORDER.map((l) => {
        const item = this.p.items.byName.get(l.item)?.index ?? -1;
        const onHand = stock.find((s) => s.item === item)?.quantity ?? 0;
        return { item, used: false, quantity: Math.min(l.quantity, onHand) };
      }).filter((l) => l.quantity > 0);
      if (lines.length === 0) {
        this.p.log('  Bobby Ray has none of the supplies in stock');
        return;
      }
      const ordered = await this.p.act({ type: 'bobbyRayOrder', lines, destination: BOBBY_RAY.destination, speed: BOBBY_RAY.speed });
      const what = lines.map((l) => `${l.quantity} ${this.p.items.byIndex.get(l.item)?.name ?? l.item}`).join(', ');
      this.p.log(`  Bobby Ray order (${what}): ${ordered.ok ? 'placed' : `refused: ${ordered.reason ?? ''}`}`);
    });
  }

  async collectSupplies(): Promise<void> {
    const delivered = this.p.events.some((e) => e.type === 'shipmentDelivered');
    if (!delivered) {
      this.p.log('  no Bobby Ray shipment yet');
      return;
    }
    await this.visit(DRASSEN.airport);
    await walkTo(this.p, await this.lead(), BOBBY_RAY.deliveryGridNo + 2);
    await this.outfit(DRASSEN.airport);
  }

  async trainMilitia(): Promise<void> {
    await this.go(DRASSEN.town);
    if (!(await mapScreen(this.p))) return;
    const view = await this.p.observe();
    const here = squad(view).filter((m) => m.sector === DRASSEN.town && !m.betweenSectors);
    const trainer = here[0];
    if (!trainer) return;
    const assigned = await this.p.act({ type: 'assign', soldiers: [trainer.id], to: { kind: 'trainMilitia' } });
    if (!assigned.ok) {
      this.p.log(`  militia training refused: ${assigned.reason ?? JSON.stringify(assigned.data)}`);
      return;
    }
    this.p.log(`  ${trainer.name} trains militia in ${DRASSEN.town}`);
    await restAndHeal(this.p, DRASSEN.town, this.p.medics, HEAL_HOURS, [trainer.id]);
    const trained: GameEvent[] = [];
    for (let hours = 0; hours < TRAINING_HOURS && !trained.some((e) => e.type === 'militiaTrained'); hours += TRAINING_SLICE_HOURS) {
      const before = this.p.events.length;
      await waitHours(this.p, TRAINING_SLICE_HOURS);
      trained.push(...this.p.events.slice(before));
    }
    const militia = (await this.p.observe()).strategic?.sectors.find((s) => s.sector === DRASSEN.town)?.militia ?? [];
    this.p.log(`  militia in ${DRASSEN.town}: ${militia.join('/')}`);
    await rejoinSquad(this.p, [trainer.id]);
  }

  async findSkyrider(): Promise<string | null> {
    for (const farm of SKYRIDER_FARMS) {
      await this.visit(farm);
      await walkTo(this.p, await this.lead(), HELIPAD);
      const view = await this.p.observe();
      if (view.soldiers.some((s) => s.profile === Npc.SKYRIDER)) return farm;
      if (!(await mapScreen(this.p))) return null;
    }
    return null;
  }

  async guardEscorts(): Promise<void> {
    if (!(await mapScreen(this.p))) return;
    const view = await this.p.observe();
    const mercs = squad(view);
    for (const escort of mercs.filter((m) => m.kind === 'epc' && m.squad !== null)) {
      const guarded = mercs.some((m) => m.kind !== 'epc' && m.squad === escort.squad);
      if (guarded) continue;
      const guard = [...mercs].reverse().find((m) => m.kind !== 'epc' && m.squad !== null && m.sector === escort.sector);
      if (!guard) continue;
      const moved = await this.p.act({ type: 'assignSquad', soldier: guard.id, squad: escort.squad });
      this.p.log(`  ${guard.name} guards ${escort.name}: ${moved.ok ? 'ok' : (moved.reason ?? 'refused')}`);
    }
  }

  async escortSkyrider(): Promise<void> {
    const farm = await this.findSkyrider();
    if (!farm) {
      this.p.log('  Skyrider was not found');
      return;
    }
    this.p.log(`  Skyrider is in ${farm}`);
    await talk(this.p, await this.lead(), Npc.SKYRIDER);
    await say(this.p, { type: 'approach', kind: 'recruit' });
    const request = (await this.p.observe()).npcRequest;
    if (request) await say(this.p, { type: 'answer', prompt: request.id, choice: 'yes' });
    await closeConversation(this.p);
    await this.guardEscorts();
    await this.visit(DRASSEN.airport);
    const view = await this.p.observe();
    const skyrider = view.soldiers.find((s) => s.profile === Npc.SKYRIDER && s.team === 0);
    if (!skyrider) {
      this.p.log('  Skyrider did not come along');
      return;
    }
    const before = this.p.events.length;
    await walkTo(this.p, skyrider, HELIPAD);
    await this.p.advance({ idle: true, ticks: ESCORT_TICKS });
    const setUp = this.p.events.slice(before).some((e) => e.type === 'helicopterSetUp') || (await this.p.observe()).strategic?.helicopter;
    this.p.log(`  helicopter ${setUp ? 'set up' : 'not set up'}`);
  }

  teamSize(view: Observation): number {
    return (view.strategic?.mercs ?? []).filter((m) => m.kind !== 'epc' && m.kind !== 'vehicle' && m.life > 0 && m.assignment !== PRISONER)
      .length;
  }

  async reinforce(): Promise<void> {
    if (!(await mapScreen(this.p))) return;
    await this.orderSupplies();
    const zone = await this.p.act({ type: 'setLandingZone', sector: DRASSEN.airport });
    if (!zone.ok) this.p.log(`  landing zone refused: ${zone.reason ?? ''}`);
    for (let slice = 0; slice < RECRUITING_SLICES; slice++) {
      const missing = TARGET_TEAM - this.teamSize(await this.p.observe());
      if (missing <= 0) break;
      await this.laptop(async () => {
        await payMercBills(this.p);
        const aim = await hireFromAim(this.p, { count: missing, contract: REINFORCEMENT_CONTRACT_DAYS, reserve: REINFORCEMENT_RESERVE });
        await hireFromMerc(this.p, missing - aim.length, REINFORCEMENT_RESERVE);
      });
      if (TARGET_TEAM - this.teamSize(await this.p.observe()) <= 0) break;
      this.p.log(`  recruiting: ${this.teamSize(this.p.view)} of ${TARGET_TEAM} mercs, $${this.p.view.strategic?.balance ?? '?'}`);
      await restAndHeal(this.p, DRASSEN.town, this.p.medics, RECRUITING_HOURS);
      await waitHours(this.p, RECRUITING_HOURS);
    }
    for (let hours = 0; hours < ARRIVAL_HOURS; hours += ARRIVAL_SLICE_HOURS) {
      const waiting = (await this.p.observe()).strategic?.mercs.filter((m) => m.arrival !== undefined) ?? [];
      if (waiting.length === 0) break;
      await waitHours(this.p, ARRIVAL_SLICE_HOURS);
    }
    this.p.log(`  the team has ${this.teamSize(await this.p.observe())} mercs`);
    await this.gather(DRASSEN.airport);
  }

  async gather(sector: string): Promise<void> {
    await this.go(sector);
    await this.outfit(sector);
  }

  async march(): Promise<void> {
    for (const waypoint of MEDUNA_APPROACH) {
      await this.go(waypoint);
      await this.outfit(waypoint);
      await restAndHeal(this.p, waypoint, this.p.medics, waypoint === MEDUNA_APPROACH.at(-1) ? MARCH_REST_HOURS : HEAL_HOURS);
    }
  }

  async attack(sector: string, from: string): Promise<void> {
    const edge = edgeToward(sector, from);
    for (let attempt = 1; attempt <= ASSAULT_ATTEMPTS; attempt++) {
      const result = await travel(
        this.p,
        sector,
        (p) => fightHere(p, { retreat: edge, casualtyLimit: ASSAULT_CASUALTY_LIMIT }),
        () => this.recover(),
      );
      if (result === 'arrived') {
        await this.outfit(sector);
        await restAndHeal(this.p, sector, this.p.medics, ASSAULT_REST_HOURS);
        return;
      }
      if (result !== 'retreated') throw new CampaignStop(result === 'lost' ? 'lost' : 'stuck', `the attack on ${sector}: ${result}`);
      this.p.log(`  fell back from ${sector} to ${from} (attempt ${attempt})`);
      await this.outfit(from);
      await restAndHeal(this.p, from, this.p.medics, REGROUP_HOURS);
      await this.laptop(() => payMercBills(this.p));
    }
    throw new CampaignStop('lost', `${sector} held out after ${ASSAULT_ATTEMPTS} attacks`);
  }

  async assault(): Promise<void> {
    let from: string = MEDUNA_APPROACH[MEDUNA_APPROACH.length - 1] ?? DRASSEN.town;
    for (const sector of MEDUNA_ASSAULT) {
      await this.attack(sector, from);
      from = sector;
    }
  }

  async palace(): Promise<void> {
    const reached = await travel(this.p, Palace.sector, storm, () => this.recover());
    if (reached !== 'arrived') throw new CampaignStop(reached === 'lost' ? 'lost' : 'stuck', `the palace: ${reached}`);
    if (!(await descend(this.p))) throw new CampaignStop('stuck', 'the stairs down to the Queen');
    if (!(await killTheQueen(this.p))) throw new CampaignStop('stuck', 'the Queen is still alive');
    if (!(await playEnding(this.p))) throw new CampaignStop('stuck', 'the ending did not finish');
  }

  steps(): Step[] {
    return [
      { name: 'landing', run: () => this.winHere() },
      { name: 'loot Omerta', run: () => this.outfit('A9') },
      { name: 'Drassen airport', run: () => this.liberate(DRASSEN.airport) },
      { name: 'Drassen town', run: () => this.liberate(DRASSEN.town) },
      { name: 'Drassen mine', run: () => this.liberate(DRASSEN.mine) },
      { name: 'Drassen SAM', run: () => this.liberate(DRASSEN.sam) },
      { name: 'mine income', run: () => this.startMine() },
      { name: 'Bobby Ray order', run: () => this.orderSupplies() },
      { name: 'Drassen shop', run: () => this.shop() },
      { name: 'rest', run: () => this.heal(DRASSEN.town) },
      { name: 'Skyrider', run: () => this.escortSkyrider() },
      { name: 'militia', run: () => this.trainMilitia() },
      { name: 'Bobby Ray delivery', run: () => this.collectSupplies() },
      { name: 'reinforcements', run: () => this.reinforce() },
      { name: 'march', run: () => this.march() },
      { name: 'Meduna', run: () => this.assault() },
      { name: 'palace', run: () => this.palace() },
    ];
  }
}

function sectorRowColumn(sector: string): [number, number] {
  return [ROWS.indexOf(sector.charAt(0)), Number(sector.slice(1))];
}

export function edgeToward(sector: string, from: string): Edge {
  const [row, column] = sectorRowColumn(sector);
  const [fromRow, fromColumn] = sectorRowColumn(from);
  if (fromRow < row) return 'north';
  if (fromRow > row) return 'south';
  return fromColumn < column ? 'west' : 'east';
}

interface HireOrder {
  readonly count: number;
  readonly contract: number;
  readonly reserve: number;
}

async function hireFromAim(p: Player, order: HireOrder): Promise<number[]> {
  const view = await p.observe();
  const available = new Set((view.laptop?.aim ?? []).filter((m) => m.face === 'available').map((m) => m.profile));
  const onTeam = new Set((view.laptop?.aim ?? []).filter((m) => m.face === 'hired').map((m) => m.profile));
  const faces = (view.laptop?.aim ?? []).filter((m) => m.face !== 'hired').map((m) => `${m.profile}:${m.face}`);
  p.log(`  A.I.M. ${faces.join(' ')}`);
  const hired: number[] = [];
  for (const profile of HIRE_PREFERENCE) {
    if (hired.length >= order.count) break;
    if (!available.has(profile)) continue;
    const team = [...onTeam, ...hired];
    if (HATED_PAIRS.some(([a, b]) => (a === profile && team.includes(b)) || (b === profile && team.includes(a)))) continue;
    const quote = await p.act({ type: 'aimQuote', profile, contract: order.contract, gear: true });
    const total = (quote.data as { charge?: { total?: number } } | undefined)?.charge?.total ?? Number.POSITIVE_INFINITY;
    if ((p.view.laptop?.balance ?? (await p.observe()).laptop?.balance ?? 0) - total < order.reserve) continue;
    const result = await p.act({ type: 'aimHire', profile, contract: order.contract, gear: true });
    if (!result.ok) {
      p.log(`  A.I.M. ${profile} refused: ${result.reason ?? ''}`);
      continue;
    }
    hired.push(profile);
    await p.observe();
    const soldier = (result.data as { soldier?: number } | undefined)?.soldier;
    if (soldier !== undefined && (MEDIC_PREFERENCE as readonly number[]).includes(profile)) p.medics = [...p.medics, soldier];
  }
  p.log(`  hired A.I.M. ${hired.join(', ') || 'nobody'}; medics ${p.medics.join(', ')}`);
  return hired;
}

async function readMercIntro(p: Player): Promise<boolean> {
  const site = (await p.observe()).laptop?.merc;
  if (site?.bookmarked) return !site.siteDown;
  const intro = p.view.laptop?.emails.find((m) => m.type === MERC_INTRO_MAIL);
  if (!intro) return false;
  await p.act({ type: 'readEmail', id: intro.id });
  const opened = (await p.observe()).laptop?.merc;
  return opened?.bookmarked === true && !opened.siteDown;
}

async function hireFromMerc(p: Player, count: number, reserve: number): Promise<number[]> {
  if (count <= 0 || !(await readMercIntro(p))) return [];
  if (p.view.laptop?.merc.accountNumber === null) {
    const opened = await p.act({ type: 'mercOpenAccount' });
    if (!opened.ok) {
      p.log(`  M.E.R.C. account refused: ${opened.reason ?? ''}`);
      return [];
    }
  }
  const listed = (await p.observe()).laptop?.merc.listed ?? [];
  p.log(`  M.E.R.C. ${listed.map((m) => `${m.profile}:${m.state}`).join(' ')}`);
  const hired: number[] = [];
  for (const merc of listed) {
    if (hired.length >= count) break;
    if (merc.state !== 'available') continue;
    const balance = (await p.observe()).laptop?.balance ?? 0;
    if (balance - merc.dailyFee * MERC_DAYS_FUNDED < reserve) continue;
    const result = await p.act({ type: 'mercHire', profile: merc.profile });
    if (!result.ok) {
      p.log(`  M.E.R.C. ${merc.profile} refused: ${result.reason ?? ''}`);
      continue;
    }
    hired.push(merc.profile);
  }
  p.log(`  hired M.E.R.C. ${hired.join(', ') || 'nobody'}`);
  return hired;
}

async function payMercBills(p: Player): Promise<void> {
  const owed = (await p.observe()).laptop?.merc.totalOwed ?? 0;
  if (owed <= 0) return;
  const paid = await p.act({ type: 'mercPay' });
  p.log(`  paid M.E.R.C. $${owed}: ${paid.ok ? 'ok' : (paid.reason ?? 'refused')}`);
}

async function hireSquad(p: Player): Promise<void> {
  const hired = await hireFromAim(p, { count: SQUAD_SIZE, contract: CONTRACT_DAYS, reserve: 0 });
  if (hired.length === 0) throw new CampaignStop('stuck', 'nobody could be hired');
  for (const command of [{ type: 'closeLaptop' }, { type: 'compressTime', mode: LANDING_MODE }]) {
    const result = await p.act(command);
    if (!result.ok) throw new CampaignStop('stuck', `${command.type} refused: ${result.reason ?? ''}`);
  }
}

export async function playCampaign(game: Game, items: ItemTable, options: CampaignOptions): Promise<CampaignSummary> {
  const log = options.log ?? (() => {});
  const created = await game.newSession({
    seed: options.seed,
    campaign: { hire: [], options: { difficulty: options.difficulty ?? DEFAULT_DIFFICULTY, sciFi: false } },
  });
  const p = new Player(game, created.session, items, log);
  p.trace = options.trace === true;
  p.verbose = options.verbose === true;
  const reloads = new Reloads(options.reloads ?? NO_RELOADS);
  p.reloads = reloads;
  const bot = new CampaignBot(p);
  let outcome: CampaignOutcome = 'stopped';
  let reason: string | undefined;
  let step = 'start';
  try {
    step = 'hiring';
    log('== hiring');
    await hireSquad(p);
    for (const s of bot.steps()) {
      step = s.name;
      const now = await p.observe();
      log(
        `== ${s.name} (day ${now.clock?.day ?? '?'} ${now.clock?.hour ?? '?'}:00, $${now.strategic?.balance ?? '?'}, ${squad(now).length} mercs)`,
      );
      await s.run();
      if (options.stopAfter === s.name) break;
      if (reloads.wantsPlayerLoad(s.name)) await reloads.playerLoad(p, s.name);
    }
    const final = await p.observe();
    outcome = final.ended ? 'won' : 'stopped';
  } catch (err) {
    if (!(err instanceof CampaignStop)) throw err;
    outcome = err.outcome;
    reason = err.message;
  }
  const last = await p.observe();
  return {
    seed: options.seed,
    outcome,
    step,
    ...(reason ? { reason } : {}),
    days: Math.trunc(worldSeconds(last) / DAY_SECONDS),
    battles: p.tally.battles,
    battlesWon: p.tally.battlesWon,
    rounds: p.tally.rounds,
    mercsLost: p.tally.mercsLost.size,
    enemiesKilled: p.tally.enemiesKilled.size,
    calls: game.calls,
    session: p.session,
    reloads: reloads.report(),
  };
}

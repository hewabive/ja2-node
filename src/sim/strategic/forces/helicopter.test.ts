import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, economyTestContext, loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { ScriptedRolls } from '../../../../tests/support/strategic.ts';
import { parseSectorString, type Sector, sectorFromId, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { FinanceCode } from '../../campaign/finances.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import type { EconomyContext } from '../economy/ports.ts';
import { addSoldierToVehicle } from '../economy/vehicle-assignment.ts';
import { updateAirspaceControl } from '../map/control.ts';
import { initStrategicMovementCosts } from '../map/init.ts';
import { sectorInfo } from '../map/sectors.ts';
import { EventKind } from '../time/constants.ts';
import { worldTotalMinutes } from '../time/world-clock.ts';
import { Assignment, SectorFlag } from './constants.ts';
import { handleGroupArrivalEvent } from './context.ts';
import { getGroup, passengersOf } from './groups.ts';
import {
  canHelicopterFly,
  checkAndHandleSkyriderMonologues,
  confirmHelicopterRoute,
  FACT_ESTONI_REFUELLING_POSSIBLE,
  FACT_SKYRIDER_USED_IN_MAPSCREEN,
  HELICOPTER_VEHICLE_TYPE,
  handleHeliEnteringSector,
  handleHeliHoverLong,
  handleHeliHoverTooLong,
  helicopterGroup,
  helicopterVehicle,
  heliState,
  payOffSkyriderDebtIfAny,
  plotPathForHelicopter,
  requestGiveSkyriderNewDestination,
  SKYRIDER,
  SkyriderQuote,
  setUpHelicopterForPlayer,
  skyriderBalance,
  skyriderCongratulatesOnSamTaken,
  whyHelicopterCannotFly,
} from './helicopter.ts';
import type { HelicopterEventWithoutTick } from './helicopter-events.ts';
import { RefuelSiteId } from './helicopter-state.ts';
import { addCharacterToSquad, initSquads, initVehicles } from './squads.ts';

let content: EconomyTestContent;

beforeAll(async () => {
  content = await loadEconomyTestContent();
});

const S = (name: string): Sector => parseSectorString(name);
const NOON_DAY_2 = 2 * 24 * 3600 + 12 * 3600;

interface HeliWorld {
  readonly ctx: EconomyContext;
  readonly events: HelicopterEventWithoutTick[];
  readonly facts: Set<number>;
  readonly killed: number[];
  meanwhiles: number;
  loyaltyLow: boolean;
}

function heliWorld(options: { money?: number; pre?: readonly number[]; cosmetic?: number } = {}): HeliWorld {
  const events: HelicopterEventWithoutTick[] = [];
  const facts = new Set<number>();
  const killed: number[] = [];
  const world: HeliWorld = { ctx: undefined as unknown as EconomyContext, events, facts, killed, meanwhiles: 0, loyaltyLow: false };
  const { ctx } = economyTestContext({
    content,
    stateOptions: { worldSeconds: NOON_DAY_2 },
    preRandom: new ScriptedRolls(options.pre ?? []),
    helicopter: {
      emit: (e) => events.push(e),
      fact: (id) => facts.has(id),
      setFactTrue: (id) => facts.add(id),
      skyriderLoyaltyLow: () => world.loyaltyLow,
      cosmeticChoice: () => options.cosmetic ?? 0,
      scheduleKillChopperMeanwhile: () => {
        world.meanwhiles++;
      },
      killInVehicle: (id) => {
        killed.push(id);
        return true;
      },
    },
  });
  Object.assign(world, { ctx });
  initStrategicMovementCosts(ctx);
  initSquads(ctx);
  initVehicles(ctx);
  ctx.state.finances.balance = options.money ?? 50000;
  ctx.state.profiles.set(SKYRIDER, { balance: 0, life: 50 } as ProfileProgress);
  return world;
}

function withHelicopter(options: Parameters<typeof heliWorld>[0] = {}): HeliWorld {
  const w = heliWorld(options);
  setUpHelicopterForPlayer(w.ctx, S('B13'));
  return w;
}

function board(w: HeliWorld, ids: readonly number[], squad = 0): void {
  const crew = w.ctx.crew as unknown as { add(o: { id: number; sector: Sector; assignment: number }): void };
  const heli = helicopterVehicle(w.ctx);
  if (!heli) throw new Error('no helicopter');
  for (const id of ids) {
    crew.add({ id, sector: { ...heli.sector }, assignment: Assignment.ON_DUTY });
    addCharacterToSquad(w.ctx, id, squad);
    const m = w.ctx.crew.get(id);
    if (!m || !addSoldierToVehicle(w.ctx, m, heli)) throw new Error(`cannot board ${id}`);
  }
}

function runUntil(ctx: EconomyContext, minute: number): void {
  for (;;) {
    const e = ctx.state.queue.events[0];
    if (!e || e.stamp > minute * 60) break;
    ctx.state.queue.events.shift();
    ctx.state.clock.seconds = e.stamp;
    if (e.kind === EventKind.GROUP_ARRIVAL) handleGroupArrivalEvent(ctx, e);
    else if (e.kind === EventKind.HELICOPTER_HOVER_TOO_LONG) handleHeliHoverLong(ctx);
    else if (e.kind === EventKind.HELICOPTER_HOVER_WAY_TOO_LONG) handleHeliHoverTooLong(ctx);
  }
  ctx.state.clock.seconds = minute * 60;
}

function fly(w: HeliWorld, to: string): void {
  expect(plotPathForHelicopter(w.ctx, S(to))).toBe(true);
  confirmHelicopterRoute(w.ctx, S(to));
}

const quotes = (w: HeliWorld) => w.events.flatMap((e) => (e.type === 'skyriderQuote' ? [e.quote] : []));
const now = (ctx: EconomyContext) => worldTotalMinutes(ctx.state.clock);

function samControlledSector(ctx: EconomyContext, sam: number): Sector {
  const id = ctx.content.samAirControl.findIndex((c, k) => c === sam && k !== ctx.content.samSites[sam]?.sector);
  return sectorFromId(id);
}

function enemySam(ctx: EconomyContext, sam: number, condition = 100): void {
  const site = ctx.content.samSites[sam];
  if (!site) throw new Error('no sam');
  const e = ctx.state.map.elements[strategicIndex(sectorFromId(site.sector))];
  if (!e) throw new Error('no element');
  e.enemyControlled = true;
  e.samCondition = condition;
  updateAirspaceControl(ctx);
}

describe('getting the helicopter', () => {
  it('adds the helicopter once in B13 with its movement group, an air mask and the refuel sites', () => {
    const w = heliWorld();
    setUpHelicopterForPlayer(w.ctx, S('B13'));
    const f = w.ctx.state.forces;
    expect(f.helicopterVehicleId).toBe(0);
    const heli = helicopterVehicle(w.ctx);
    expect(heli).toMatchObject({ valid: true, type: HELICOPTER_VEHICLE_TYPE, sector: S('B13'), movementGroup: f.vehicleGroupIds[0] });
    expect(helicopterGroup(w.ctx)).toMatchObject({ sector: S('B13'), transportMask: 0x10 });
    expect(heliState(w.ctx)).toMatchObject({ setUp: true, refuelSiteAvailable: [true, false] });
    setUpHelicopterForPlayer(w.ctx, S('I6'));
    expect(f.vehicles.filter((v) => v.valid)).toHaveLength(1);
    expect(w.events.filter((e) => e.type === 'helicopterSetUp')).toHaveLength(1);
  });

  it('opens Estoni once its fact is set and closes a site in enemy airspace', () => {
    const w = withHelicopter();
    w.facts.add(FACT_ESTONI_REFUELLING_POSSIBLE);
    updateAirspaceControl(w.ctx);
    expect(heliState(w.ctx).refuelSiteAvailable).toEqual([true, true]);
    const drassen = w.ctx.state.map.elements[strategicIndex(S('B13'))];
    if (drassen) drassen.enemyControlled = true;
    updateAirspaceControl(w.ctx);
    expect(heliState(w.ctx).refuelSiteAvailable[RefuelSiteId.DRASSEN]).toBe(false);
  });
});

describe('can the helicopter fly', () => {
  it('refuses in the original order: owed money, returning, grounded, disloyal', () => {
    const w = withHelicopter();
    expect(canHelicopterFly(w.ctx)).toBe(true);
    w.loyaltyLow = true;
    expect(whyHelicopterCannotFly(w.ctx)).toBe('skyriderUnwilling');
    const b13 = w.ctx.state.map.elements[strategicIndex(S('B13'))];
    if (b13) b13.enemyControlled = true;
    expect(whyHelicopterCannotFly(w.ctx)).toBe('grounded');
    w.ctx.state.forces.helicopterAirborne = true;
    expect(whyHelicopterCannotFly(w.ctx)).toBe('skyriderUnwilling');
    heliState(w.ctx).returningToBase = true;
    expect(whyHelicopterCannotFly(w.ctx)).toBe('returningToBase');
    const p = w.ctx.state.profiles.get(SKYRIDER);
    if (p) p.balance = -1;
    expect(whyHelicopterCannotFly(w.ctx)).toBe('skyriderOwed');
  });

  it('gives the empty-helicopter hint once, then says hi and sets the map-screen fact', () => {
    const w = withHelicopter();
    const crew = w.ctx.crew as unknown as { add(o: { id: number; sector: Sector; assignment: number }): void };
    crew.add({ id: 7, sector: S('B13'), assignment: Assignment.ON_DUTY });
    addCharacterToSquad(w.ctx, 7, 0);
    expect(requestGiveSkyriderNewDestination(w.ctx)).toEqual({ ok: false, refusal: 'emptyHelicopterHint' });
    expect(requestGiveSkyriderNewDestination(w.ctx)).toEqual({ ok: true });
    expect(quotes(w)).toEqual([SkyriderQuote.SKYRIDER_SAYS_HI]);
    expect(w.facts.has(FACT_SKYRIDER_USED_IN_MAPSCREEN)).toBe(true);
  });
});

describe('flying', () => {
  it('flies three sectors west at 10 minutes each, bills 100 per safe sector, hovers and pays', () => {
    const w = withHelicopter({ money: 1000 });
    board(w, [0, 1]);
    const start = now(w.ctx);
    fly(w, 'B10');
    expect(w.ctx.state.forces.helicopterAirborne).toBe(true);
    expect(helicopterGroup(w.ctx)).toMatchObject({ betweenSectors: true, traverseTime: 10, arrivalTime: start + 10 });
    runUntil(w.ctx, start + 30);
    const heli = helicopterVehicle(w.ctx);
    expect(heli?.sector).toEqual(S('B10'));
    expect(w.ctx.crew.get(0)).toMatchObject({ sector: S('B10'), betweenSectors: false, assignment: Assignment.VEHICLE });
    expect(heliState(w.ctx)).toMatchObject({ hovering: true, startHoverMinute: start + 30, totalCost: 0 });
    expect(w.ctx.state.finances.ledger.at(-1)).toMatchObject({ code: FinanceCode.PAYMENT_TO_NPC, secondCode: SKYRIDER, amount: -300 });
    expect(w.ctx.state.finances.balance).toBe(700);
    expect(quotes(w)).toContain(SkyriderQuote.ARRIVED_IN_NON_HOSTILE_SECTOR);
    expect(w.ctx.state.queue.events.some((e) => e.kind === EventKind.HELICOPTER_HOVER_TOO_LONG && e.stamp === (start + 40) * 60)).toBe(
      true,
    );
  });

  it('charges 1000 per sector in enemy airspace and nothing while returning to base or never leaving', () => {
    const w = withHelicopter();
    const s = S('C13');
    const e = w.ctx.state.map.elements[strategicIndex(s)];
    if (e) e.enemyAirControlled = true;
    helicopterVehicle(w.ctx)?.path.push(strategicIndex(S('B13')), strategicIndex(s), strategicIndex(S('D13')));
    handleHeliEnteringSector(w.ctx, s, false);
    expect(heliState(w.ctx).totalCost).toBe(1000);
    handleHeliEnteringSector(w.ctx, s, true);
    expect(heliState(w.ctx).totalCost).toBe(1000);
    heliState(w.ctx).returningToBase = true;
    handleHeliEnteringSector(w.ctx, s, false);
    expect(heliState(w.ctx).totalCost).toBe(1000);
  });

  it('caps the SAM chance at 33 and is destroyed by the third hit', () => {
    const w = withHelicopter({ pre: [33, 32, 0, 0] });
    board(w, [0]);
    enemySam(w.ctx, 1);
    const s = samControlledSector(w.ctx, 1);
    const heli = helicopterVehicle(w.ctx);
    if (heli) heli.sector = s;
    heli?.path.push(strategicIndex(s), strategicIndex(s));
    handleHeliEnteringSector(w.ctx, s, false);
    expect(heliState(w.ctx).hitsTaken).toBe(0);
    handleHeliEnteringSector(w.ctx, s, false);
    expect(heliState(w.ctx).hitsTaken).toBe(1);
    expect(quotes(w).at(-1)).toBe(SkyriderQuote.HELI_TOOK_MINOR_DAMAGE);
    handleHeliEnteringSector(w.ctx, s, false);
    expect(heliState(w.ctx)).toMatchObject({ hitsTaken: 2, returningToBase: true });
    expect(quotes(w)).toContain(SkyriderQuote.HELI_TOOK_MAJOR_DAMAGE);
    expect(handleHeliEnteringSector(w.ctx, s, false)).toBe(true);
    expect(heliState(w.ctx)).toMatchObject({ destroyed: true, totalCost: 0 });
    expect(w.ctx.state.forces.helicopterVehicleId).toBe(-1);
    expect(w.killed).toEqual([0]);
    expect(w.ctx.state.profiles.get(SKYRIDER)?.life).toBe(0);
  });

  it('ignores a SAM below condition 80', () => {
    const w = withHelicopter({ pre: [] });
    enemySam(w.ctx, 1, 79);
    const s = samControlledSector(w.ctx, 1);
    const e = w.ctx.state.map.elements[strategicIndex(s)];
    if (e) e.enemyAirControlled = true;
    helicopterVehicle(w.ctx)?.path.push(strategicIndex(s), strategicIndex(s));
    handleHeliEnteringSector(w.ctx, s, false);
    expect(heliState(w.ctx).hitsTaken).toBe(0);
  });

  it('notices unknown enemies with chance 60 + n and stops compression only when passing through', () => {
    const w = withHelicopter({ pre: [64, 65] });
    const s = S('C13');
    sectorInfo(w.ctx.state.map, s).numTroops = 5;
    helicopterVehicle(w.ctx)?.path.push(strategicIndex(s), strategicIndex(S('D13')));
    handleHeliEnteringSector(w.ctx, s, false);
    expect(sectorInfo(w.ctx.state.map, s).flags & SectorFlag.SKYRIDER_NOTICED_ENEMIES_HERE).not.toBe(0);
    expect(quotes(w)).toEqual([SkyriderQuote.ENEMIES_SPOTTED_EN_ROUTE_IN_FRIENDLY_SECTOR_B]);
    sectorInfo(w.ctx.state.map, s).flags = 0;
    handleHeliEnteringSector(w.ctx, s, false);
    expect(sectorInfo(w.ctx.state.map, s).flags & SectorFlag.SKYRIDER_NOTICED_ENEMIES_HERE).toBe(0);
  });
});

describe('hovering, returning and landing', () => {
  it('warns after 10 minutes, then drops everyone in a safe sector and returns to base after 20', () => {
    const w = withHelicopter({ money: 1000 });
    board(w, [0, 1]);
    const start = now(w.ctx);
    fly(w, 'B10');
    runUntil(w.ctx, start + 40);
    expect(quotes(w)).toContain(SkyriderQuote.HOVERING_A_WHILE);
    runUntil(w.ctx, start + 50);
    expect(quotes(w)).toContain(SkyriderQuote.RETURN_TO_BASE);
    expect(passengersOf(helicopterVehicle(w.ctx) as NonNullable<ReturnType<typeof helicopterVehicle>>)).toEqual([]);
    expect(w.ctx.crew.get(0)).toMatchObject({ sector: S('B10'), assignment: 0 });
    expect(w.ctx.crew.get(1)?.assignment).toBe(0);
    expect(heliState(w.ctx)).toMatchObject({ returningToBase: true, hovering: false });
    runUntil(w.ctx, start + 80);
    expect(helicopterVehicle(w.ctx)?.sector).toEqual(S('B13'));
    expect(w.ctx.state.forces.helicopterAirborne).toBe(false);
    expect(heliState(w.ctx).returningToBase).toBe(false);
    expect(w.meanwhiles).toBe(1);
    expect(w.events.some((e) => e.type === 'heliLanded' && e.sector === 'B13')).toBe(true);
  });

  it('lands at a refuel site at the end of a route and keeps the passengers aboard', () => {
    const w = withHelicopter({ money: 1000 });
    board(w, [0]);
    const start = now(w.ctx);
    fly(w, 'B12');
    runUntil(w.ctx, start + 10);
    fly(w, 'B13');
    runUntil(w.ctx, start + 20);
    expect(w.ctx.state.forces.helicopterAirborne).toBe(false);
    expect(passengersOf(helicopterVehicle(w.ctx) as NonNullable<ReturnType<typeof helicopterVehicle>>)).toEqual([0]);
  });
});

describe('paying Skyrider', () => {
  it('takes all the money, owes the rest, drops the passengers and returns to base', () => {
    const w = withHelicopter({ money: 150 });
    board(w, [0]);
    const start = now(w.ctx);
    fly(w, 'B10');
    runUntil(w.ctx, start + 30);
    expect(w.ctx.state.finances.balance).toBe(0);
    expect(skyriderBalance(w.ctx)).toBe(-150);
    expect(quotes(w)).toContain(SkyriderQuote.OWED_MONEY_TO_SKYRIDER);
    expect(w.events.find((e) => e.type === 'heliOwed')).toMatchObject({ amount: 150 });
    expect(w.ctx.crew.get(0)?.assignment).toBe(0);
    expect(heliState(w.ctx).returningToBase).toBe(true);
    expect(canHelicopterFly(w.ctx)).toBe(false);
  });

  it('pays the debt hourly as far as the money goes', () => {
    const w = withHelicopter({ money: 40 });
    const p = w.ctx.state.profiles.get(SKYRIDER);
    if (p) p.balance = -100;
    payOffSkyriderDebtIfAny(w.ctx);
    expect(skyriderBalance(w.ctx)).toBe(-60);
    expect(w.ctx.state.finances.balance).toBe(0);
    expect(quotes(w)).toEqual([SkyriderQuote.OWED_MONEY_TO_SKYRIDER]);
    w.ctx.state.finances.balance = 500;
    payOffSkyriderDebtIfAny(w.ctx);
    expect(skyriderBalance(w.ctx)).toBe(0);
    expect(w.ctx.state.finances.balance).toBe(440);
    expect(quotes(w)).toHaveLength(1);
  });
});

describe('monologues', () => {
  it('walks the talk states with a day between monologues and reveals the SAM sites', () => {
    const w = withHelicopter();
    const ctx = w.ctx;
    const sam2 = ctx.content.samSites[1];
    const sam2Element = sam2 ? ctx.state.map.elements[strategicIndex(sectorFromId(sam2.sector))] : undefined;
    if (sam2Element) sam2Element.enemyControlled = true;
    ctx.state.map.secretsFound = ctx.content.secrets.map(() => false);
    checkAndHandleSkyriderMonologues(ctx);
    expect(heliState(ctx)).toMatchObject({ talkState: 1, lastMonologueMinute: now(ctx) });
    expect(quotes(w)).toEqual([SkyriderQuote.MENTION_DRASSEN_SAM_SITE, SkyriderQuote.SECOND_HALF_OF_MENTION_DRASSEN_SAM_SITE]);
    const sam2Secret = ctx.content.secrets.findIndex((s) => s.sector === sam2?.sector);
    expect(ctx.state.map.secretsFound[sam2Secret]).toBe(true);
    checkAndHandleSkyriderMonologues(ctx);
    expect(heliState(ctx).talkState).toBe(1);
    ctx.state.clock.seconds += 24 * 3600;
    checkAndHandleSkyriderMonologues(ctx);
    expect(heliState(ctx).talkState).toBe(2);
    checkAndHandleSkyriderMonologues(ctx);
    expect(heliState(ctx).talkState).toBe(2);
    skyriderCongratulatesOnSamTaken(ctx);
    expect(heliState(ctx).saidCongratsOnTakingSam).toBe(true);
    checkAndHandleSkyriderMonologues(ctx);
    expect(heliState(ctx).talkState).toBe(3);
    expect(w.events.filter((e) => e.type === 'samSitesRevealed').map((e) => (e.type === 'samSitesRevealed' ? e.sites.length : 0))).toEqual([
      1, 3,
    ]);
    ctx.state.clock.seconds += 24 * 3600;
    checkAndHandleSkyriderMonologues(ctx);
    expect(heliState(ctx).talkState).toBe(3);
    w.facts.add(FACT_ESTONI_REFUELLING_POSSIBLE);
    updateAirspaceControl(ctx);
    checkAndHandleSkyriderMonologues(ctx);
    expect(heliState(ctx).talkState).toBe(4);
    expect(quotes(w).at(-1)).toBe(SkyriderQuote.SPIEL_ABOUT_ESTONI_AIRSPACE);
  });

  it('says the SAM congratulation in the first monologue once the player has used the helicopter', () => {
    const w = withHelicopter();
    w.facts.add(FACT_SKYRIDER_USED_IN_MAPSCREEN);
    checkAndHandleSkyriderMonologues(w.ctx);
    expect(quotes(w)).toEqual([SkyriderQuote.MENTION_DRASSEN_SAM_SITE, SkyriderQuote.SAM_SITE_TAKEN]);
    expect(heliState(w.ctx).saidCongratsOnTakingSam).toBe(true);
  });
});

describe('leaving the helicopter', () => {
  it('joins a new squad that arrives in the helicopter sector while it hovers', () => {
    const w = withHelicopter({ money: 1000 });
    board(w, [0, 1]);
    const start = now(w.ctx);
    fly(w, 'B11');
    runUntil(w.ctx, start + 20);
    expect(addCharacterToSquad(w.ctx, 1, 5)).toBe(true);
    const m = w.ctx.crew.get(1);
    expect(m).toMatchObject({ assignment: 5, sector: S('B11'), betweenSectors: false });
    const squadGroup = getGroup(w.ctx, w.ctx.state.forces.squadGroupIds[5] ?? 0);
    expect(squadGroup).toMatchObject({ sector: S('B11'), betweenSectors: false });
    expect(passengersOf(helicopterVehicle(w.ctx) as NonNullable<ReturnType<typeof helicopterVehicle>>)).toEqual([0]);
    expect(sectorId(m?.sector ?? S('A1'))).toBe(sectorId(S('B11')));
  });
});

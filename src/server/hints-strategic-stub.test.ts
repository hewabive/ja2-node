import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ClientSide,
  clientSide,
  expectHintsAgree,
  type HintSources,
  sampleAttackHints,
  sampleMoveHints,
  serialisedView,
  withQueries,
} from '../../tests/support/hints.ts';
import { samplePassHints, sampleStrategicHints } from '../../tests/support/hints-strategic.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { driveOurHummerInto, stubCampaignAtTheHummer, stubCampaignWithOurHummer } from '../../tests/support/vehicles.ts';
import { parseSectorString, strategicIndex } from '../content/strategic/sector-ids.ts';
import { Direction } from '../content/world/grid.ts';
import { skipHelicopterDropOf } from '../sim/campaign/helicopter-drop-flow.ts';
import type { RosterMerc } from '../sim/campaign/roster.ts';
import { exitCheck, flowExitWorld } from '../sim/campaign/sector-exits.ts';
import { assignmentOptionsFor } from '../sim/hints/assignment-options.ts';
import type { PreviewAction } from '../sim/hints/preview-action.ts';
import { createItem } from '../sim/items/object.ts';
import { LAIR_DESTROYED } from '../sim/strategic/creatures/creatures.ts';
import { FACT_OK_USE_HUMMER, SKYRIDER, setUpHelicopterForPlayer } from '../sim/strategic/forces/helicopter.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Quest } from '../sim/strategic/narrative/fact-ids.ts';
import { QuestStatus, setFact } from '../sim/strategic/narrative/facts.ts';
import { InvSlot } from '../sim/tactical/inventory.ts';
import { progressFromProfile } from '../sim/tactical/profiles.ts';
import { DIRECTION_EXITGRID } from '../sim/tactical/sector-exit.ts';
import { Body } from '../sim/tactical/soldier.ts';
import { apsToBeginRepair, apsToRefuelVehicle, walkCostTo } from '../sim/tactical/tile-tools.ts';
import { addFuelToVehicle } from '../sim/vehicles/vehicle-fuel.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { Session } from './session.ts';

let kit: StubSectorKit;
let sources: HintSources;
let client: ClientSide;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  sources = { read: kit.read, exists: (p) => kit.worlds.exists(p), world: (p) => kit.worlds.world(p) };
  client = await clientSide(sources);
});

afterAll(async () => {
  await kit.dispose();
});

const QUIET = ['A9', 'A10', 'B9', 'B10'];
const ROUTE_STEP_SECONDS = 600;
const ENTER_VEHICLE_BUDGET = 20_000;
const OUR_FIRST_VEHICLE = 18;

interface Campaign {
  readonly sim: CampaignSession;
  readonly session: Session;
}

async function landedCampaign(seed: number): Promise<Campaign> {
  const sim = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 3, land: false });
  for (const name of QUIET)
    Object.assign(sectorInfo(sim.campaign.state.map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await sim.prepare(land);
  expect(sim.dispatch(land).ok).toBe(true);
  skipHelicopterDropOf(sim.campaign);
  expect(sim.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  const session = withQueries(new Session('strategic-hints', sim), sources);
  return { sim, session };
}

function withHelicopter(c: Campaign): void {
  const campaign = c.sim.campaign;
  const ctx = campaign.strategic;
  if (!ctx) throw new Error('no strategic layer');
  const skyrider = kit.content.profiles[SKYRIDER];
  if (skyrider) campaign.state.profiles.set(SKYRIDER, progressFromProfile(skyrider));
  const a9 = campaign.state.map.elements[strategicIndex(parseSectorString('A9'))];
  if (a9) a9.enemyControlled = false;
  setUpHelicopterForPlayer(ctx, parseSectorString('A9'));
}

describe('strategic cursor hints on a stub campaign, client against server', () => {
  it('agree on the map screen right after landing', async () => {
    const c = await landedCampaign(31);
    withHelicopter(c);
    const view = serialisedView(c.session);
    const report = await expectHintsAgree(c.session, client, sampleStrategicHints(view));
    expect(report.kinds.get('previewRoute')).toBeGreaterThan(0);
    expect(report.kinds.get('moveBoxOptions')).toBeGreaterThan(0);
    expect(report.answered).toBeGreaterThan(20);
  });

  it('agree while the squad travels between sectors', async () => {
    const c = await landedCampaign(32);
    const merc = c.sim.view().strategic?.mercs[0]?.id;
    expect(c.sim.dispatch({ type: 'route', soldier: merc, to: 'A11' })).toMatchObject({ ok: true });
    c.session.advance({ worldSeconds: ROUTE_STEP_SECONDS });
    const view = serialisedView(c.session);
    expect(view.strategic?.groups.some((g) => g.betweenSectors)).toBe(true);
    await expectHintsAgree(c.session, client, sampleStrategicHints(view));
  });

  it('answer like the full state when the player sees everything that matters', async () => {
    const c = await landedCampaign(33);
    const campaign = c.sim.campaign;
    const roster = campaign.battle?.roster;
    const economy = campaign.economy;
    const flow = campaign.sectors;
    if (!roster || !economy || !flow) throw new Error('no campaign layers');
    for (const m of roster.all()) {
      const hint = await c.session.query({ type: 'assignmentOptions', soldier: m.id });
      expect(hint.data, `assignment menu of ${m.id}`).toEqual(JSON.parse(JSON.stringify(assignmentOptionsFor(economy, m))));
      for (const [name, direction] of Object.entries({
        north: Direction.NORTH,
        east: Direction.EAST,
        south: Direction.SOUTH,
        west: Direction.WEST,
      })) {
        const options = await c.session.query({ type: 'exitSectorOptions', soldier: m.id, direction: name });
        const world = flowExitWorld(flow);
        const plan = exitCheck(world, m, direction, 0);
        expect(options.data, `exit ${name} for ${m.id}`).toEqual(
          JSON.parse(
            JSON.stringify({ ...plan.check, menu: plan.menu, enemyInSector: world.enemyInSector, surfaceWarp: world.surfaceWarp() }),
          ),
        );
      }
      expect(DIRECTION_EXITGRID).toBeGreaterThan(Direction.NORTHWEST);
    }
    const merc = roster.all()[0]?.id;
    const preview = await c.session.query({ type: 'previewRoute', soldier: merc, to: 'B11' });
    const routed = c.sim.dispatch({ type: 'route', soldier: merc, to: 'B11' });
    const data = preview.data as { temp: string[]; etaMinutes: number };
    const plotted = routed.data as { path: string[]; etaMinutes: number };
    expect(data.temp.length).toBe(plotted.path.length);
    expect(data.etaMinutes).toBe(plotted.etaMinutes);
  });

  it('count the remaining leg twice and drop the first temporary edge while the squad travels, as the original', async () => {
    const c = await landedCampaign(34);
    const merc = c.sim.view().strategic?.mercs[0]?.id;
    expect(c.sim.dispatch({ type: 'route', soldier: merc, to: 'A12' })).toMatchObject({ ok: true });
    c.session.advance({ worldSeconds: ROUTE_STEP_SECONDS });
    const view = serialisedView(c.session);
    const group = view.strategic?.groups.find((g) => g.members.includes(merc ?? -1));
    expect(group?.betweenSectors).toBe(true);
    expect(group?.path).toEqual(['A10', 'A11', 'A12']);
    const remaining = group?.nextArrivalMinutes ?? 0;
    expect(remaining).toBeGreaterThan(0);
    const preview = (await c.session.query({ type: 'previewRoute', soldier: merc, to: 'A14', extend: true })).data as {
      path: string[];
      temp: string[];
      edgeMinutes: number[];
      etaMinutes: number;
    };
    expect(preview.path).toEqual(['A10', 'A11', 'A12']);
    expect(preview.temp).toEqual(['A12', 'A13', 'A14']);
    const [, elevenToTwelve = 0, twelveToThirteen = 0, thirteenToFourteen = 0] = preview.edgeMinutes;
    expect(preview.etaMinutes).toBe(remaining + elevenToTwelve + remaining + thirteenToFourteen);
    expect(preview.etaMinutes).not.toBe(remaining + elevenToTwelve + twelveToThirteen + thirteenToFourteen);
  });

  it('give the same answers whether or not an enemy group the player has not seen stands on the map', async () => {
    const c = await landedCampaign(35);
    withHelicopter(c);
    const requests = sampleStrategicHints(serialisedView(c.session));
    const before = await Promise.all(requests.map((q) => c.session.query(q)));
    const viewBefore = serialisedView(c.session).strategic;
    Object.assign(sectorInfo(c.sim.campaign.state.map, parseSectorString('J9')), { numTroops: 12, numElites: 4 });
    expect(serialisedView(c.session).strategic).toEqual(viewBefore);
    const after = await Promise.all(requests.map((q) => c.session.query(q)));
    expect(after).toEqual(before);
  });

  it('name the mercs a held item could pass to on the map, and moveItem refuses the others with the same rule', async () => {
    const c = await landedCampaign(37);
    const roster = c.sim.campaign.battle?.roster;
    const [holder, away, near] = roster?.all() ?? [];
    if (!holder || !away || !near) throw new Error('three mercs expected');
    away.sector = parseSectorString('B10');
    const view = serialisedView(c.session);
    await expectHintsAgree(c.session, client, samplePassHints(view));
    const targets = async (request: Record<string, unknown>) =>
      ((await c.session.query({ type: 'passTargets', ...request })).data as { mercs: number[] }).mercs;
    expect(await targets({ soldier: holder.id })).toEqual(expect.arrayContaining([holder.id, near.id]));
    expect(await targets({ soldier: holder.id })).not.toContain(away.id);
    expect(await targets({ soldier: away.id })).toEqual([away.id]);
    expect(await targets({ sector: 'B10' })).toEqual([away.id]);
    const pocket = view.strategic?.mercs.find((m) => m.id === holder.id)?.inventory?.[0];
    if (!pocket) throw new Error('the holder carries nothing');
    const pass = (to: number) => ({ type: 'moveItem', soldier: holder.id, from: pocket.slot, toSoldier: to, to: pocket.slot });
    expect(c.sim.dispatch(pass(away.id))).toMatchObject({ ok: false, data: { refusal: 'otherSector' } });
    expect(await c.session.query({ type: 'passTargets', soldier: 999 })).toMatchObject({ ok: false, data: { refusal: 'noSuchMerc' } });
    expect(await c.session.query({ type: 'passTargets' })).toMatchObject({ ok: false, data: { refusal: 'badSource' } });
  });

  it('refuse a route as too tired like the command, for a merc awake below 30 and for a sleeper beyond waking', async () => {
    const c = await landedCampaign(36);
    const roster = c.sim.campaign.battle?.roster;
    const [tired, collapsed, fit] = roster?.all() ?? [];
    if (!tired || !collapsed || !fit) throw new Error('three mercs expected');
    tired.breathMax = 29;
    Object.assign(collapsed, { breathMax: 40, asleep: true, collapsed: true });
    const view = serialisedView(c.session);
    await expectHintsAgree(c.session, client, sampleStrategicHints(view));
    for (const m of [tired, collapsed]) {
      const preview = await c.session.query({ type: 'previewRoute', soldier: m.id, to: 'B11', alone: true });
      expect(preview).toMatchObject({ ok: false, data: { refusal: 'tooTired', soldier: m.id } });
    }
    const squad = await c.session.query({ type: 'previewRoute', soldier: fit.id, to: 'B11' });
    const routed = c.sim.dispatch({ type: 'route', soldier: fit.id, to: 'B11' });
    expect(squad).toMatchObject({ ok: false, data: { refusal: 'tooTired', soldier: tired.id } });
    expect(routed).toMatchObject({ ok: false, data: { refusal: 'tooTired', soldier: tired.id } });
  });
});

describe('the mercs aboard a vehicle of ours in the loaded sector, client against server', () => {
  it('agree on their moves and attacks, refused as inVehicle like the orders, and on the vehicle with them aboard', async () => {
    const sim = await stubCampaignWithOurHummer(kit, 41);
    await driveOurHummerInto(sim, 'B9');
    const session = withQueries(new Session('aboard-hints', sim), sources);
    const view = serialisedView(session);
    await expectHintsAgree(session, client, [
      ...sampleMoveHints(view, { radius: 6, step: 3 }),
      ...sampleAttackHints(view, { radius: 6, step: 6 }),
    ]);
    const seated = view.soldiers.filter((s) => s.vehicle);
    expect(seated.length).toBeGreaterThan(1);
    for (const s of seated) {
      const to = s.gridNo + 3;
      expect((await session.query({ type: 'previewMove', soldier: s.id, to })).data).toMatchObject({ refusal: 'inVehicle' });
      expect(sim.dispatch({ type: 'move', soldier: s.id, to })).toMatchObject({ ok: false, data: { refusal: 'inVehicle' } });
    }
  });
});

describe('a civilian vehicle the squad stands by, client against server', () => {
  it("offer the vehicle line of the assignment menu as the full state does, with and without the Hummer's fact", async () => {
    const sim = await stubCampaignAtTheHummer(kit, 42);
    expect(sim.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    const session = withQueries(new Session('civilian-vehicle-hints', sim), sources);
    const economy = sim.campaign.economy;
    const roster = sim.campaign.battle?.roster;
    if (!economy || !roster) throw new Error('no campaign layers');
    for (const usable of [false, true]) {
      setFact(sim.campaign.state.narrative, FACT_OK_USE_HUMMER, usable);
      const offered: number[] = [];
      for (const m of roster.all()) {
        const hint = await session.query({ type: 'assignmentOptions', soldier: m.id });
        expect(hint.data, `assignment menu of ${m.id}`).toEqual(JSON.parse(JSON.stringify(assignmentOptionsFor(economy, m))));
        offered.push((hint.data as { readonly vehicles: readonly unknown[] }).vehicles.length);
      }
      expect(offered.every((n) => n === (usable ? 1 : 0))).toBe(true);
    }
  });
});

describe('the enter-vehicle cursor by a civilian vehicle, client against server', () => {
  it("agrees with the click: notAllowed without the Hummer's fact, then the walk beside it, then vehicleOccupied under the move cursor once somebody sits in it", async () => {
    const sim = await stubCampaignAtTheHummer(kit, 43);
    const session = withQueries(new Session('enter-vehicle-hints', sim), sources);
    const t = sim.campaign.tactical?.state;
    const hummer = t?.soldiers.find((s) => s?.placed && s.bodyType === Body.HUMVEE);
    const [first, second] = sim.view().strategic?.mercs.map((m) => m.id) ?? [];
    if (!hummer || first === undefined || second === undefined) throw new Error('no Hummer or no two mercs');
    const hummerGridNo = hummer.gridNo;
    const ask = (soldier: number, vehicle: number, cursor: string) => ({
      type: 'previewAction',
      soldier,
      kind: 'enterVehicle',
      gridNo: hummerGridNo,
      target: vehicle,
      cursor,
    });
    await expectHintsAgree(session, client, [ask(first, hummer.id, 'hand')]);
    expect((await session.query(ask(first, hummer.id, 'hand'))).data).toMatchObject({ ok: false, refusal: 'notAllowed' });
    expect(sim.dispatch({ type: 'enterVehicle', soldier: first, vehicle: hummer.id })).toMatchObject({ data: { refusal: 'notAllowed' } });
    setFact(sim.campaign.state.narrative, FACT_OK_USE_HUMMER, true);
    await expectHintsAgree(session, client, [ask(first, hummer.id, 'hand'), ask(first, hummer.id, 'move')]);
    const walk = (await session.query(ask(first, hummer.id, 'hand'))).data as { readonly actionGridNo: number };
    expect(walk).toMatchObject({ ok: true, affordable: true });
    expect(sim.dispatch({ type: 'enterVehicle', soldier: first, vehicle: hummer.id })).toMatchObject({
      ok: true,
      data: { actionGridNo: walk.actionGridNo },
    });
    session.advance({ idle: true }, ENTER_VEHICLE_BUDGET);
    await expectHintsAgree(session, client, [ask(second, OUR_FIRST_VEHICLE, 'move'), ask(second, OUR_FIRST_VEHICLE, 'hand')]);
    expect((await session.query(ask(second, OUR_FIRST_VEHICLE, 'move'))).data).toMatchObject({ ok: false, refusal: 'vehicleOccupied' });
    expect(sim.dispatch({ type: 'enterVehicle', soldier: second, vehicle: OUR_FIRST_VEHICLE, cursor: 'move' })).toMatchObject({
      data: { refusal: 'vehicleOccupied' },
    });
  });
});

describe('the toolkit and gas can cursors by a civilian vehicle, client against server', () => {
  it('turn good over any tile of the Hummer the boarding still refuses, with the walk and APs the order takes, and stay bad off it (quirk)', async () => {
    const sim = await stubCampaignAtTheHummer(kit, 44);
    const session = withQueries(new Session('vehicle-tool-hints', sim), sources);
    const t = sim.campaign.tactical?.state;
    const hummer = t?.soldiers.find((s) => s?.placed && s.bodyType === Body.HUMVEE);
    const [mechanic, driver] = (sim.campaign.battle?.roster.all() ?? []).filter((m) => !m.isVehicle).map((m) => m.soldier);
    if (!t || !hummer || !mechanic || !driver) throw new Error('no Hummer or no two mercs');
    mechanic.inv[InvSlot.HAND] = createItem(kit.content.items, kit.content.items.byName.get('TOOLKIT')?.index ?? 0, 100);
    driver.inv[InvSlot.HAND] = createItem(kit.content.items, kit.content.items.byName.get('GAS_CAN')?.index ?? 0, 100);
    const ask = (soldier: number, kind: string, gridNo: number) => ({ type: 'previewAction', soldier, kind, gridNo });
    const beside = hummer.gridNo + 1;
    const offTheCar = mechanic.gridNo + 2;
    await expectHintsAgree(session, client, [
      ask(mechanic.id, 'repair', hummer.gridNo),
      ask(mechanic.id, 'repair', beside),
      ask(mechanic.id, 'repair', offTheCar),
      ask(driver.id, 'refuel', hummer.gridNo),
      ask(driver.id, 'refuel', offTheCar),
    ]);
    const repair = (await session.query(ask(mechanic.id, 'repair', beside))).data as PreviewAction;
    const refuel = (await session.query(ask(driver.id, 'refuel', hummer.gridNo))).data as PreviewAction;
    expect([repair.ok, refuel.ok]).toEqual([true, true]);
    expect(repair.apCost).toBe(apsToBeginRepair(t, mechanic) + walkCostTo(t, mechanic, repair.actionGridNo));
    expect(refuel.apCost).toBe(apsToRefuelVehicle(t, driver) + walkCostTo(t, driver, refuel.actionGridNo));
    expect((await session.query(ask(mechanic.id, 'repair', offTheCar))).data).toMatchObject({ ok: false, refusal: 'noVehicle' });
    expect(sim.dispatch({ type: 'enterVehicle', soldier: mechanic.id, vehicle: hummer.id })).toMatchObject({
      data: { refusal: 'notAllowed' },
    });
    expect(sim.dispatch({ type: 'repair', soldier: mechanic.id, gridNo: offTheCar })).toMatchObject({ data: { refusal: 'noVehicle' } });
    expect(sim.dispatch({ type: 'repair', soldier: mechanic.id, gridNo: beside })).toEqual({ ok: true });
    session.advance({ idle: true }, ENTER_VEHICLE_BUDGET);
    expect(sim.campaign.tactical?.state.soldiers[mechanic.id]?.gridNo).toBe(repair.actionGridNo);
  });
});

describe('a vehicle of ours, client against server', () => {
  async function withOurHummer(seed: number): Promise<Campaign & { readonly hummer: RosterMerc }> {
    const sim = await stubCampaignWithOurHummer(kit, seed);
    const hummer = sim.campaign.battle?.roster.all().find((m) => m.isVehicle);
    if (!hummer) throw new Error('no vehicle of ours');
    return { sim, session: withQueries(new Session('vehicle-hints', sim), sources), hummer };
  }

  it('refuse the route of a vehicle with an empty tank, and of its passengers through it, like the command (ME_VEHICLE_NO_GAS, quirk)', async () => {
    const c = await withOurHummer(38);
    Object.assign(c.hummer.soldier, { breathRed: 0, breath: 0 });
    const view = serialisedView(c.session);
    await expectHintsAgree(c.session, client, sampleStrategicHints(view));
    const passengers = view.strategic?.mercs.filter((m) => m.vehicle === c.hummer.vehicleId).map((m) => m.id) ?? [];
    expect(passengers).toContain(c.hummer.id);
    expect(passengers.length).toBeGreaterThan(1);
    const refused = { ok: false, data: { refusal: 'vehicleNoGas', soldier: c.hummer.id } };
    for (const soldier of passengers) {
      expect(await c.session.query({ type: 'previewRoute', soldier, to: 'B10' }), `hint for ${soldier}`).toMatchObject(refused);
      expect(c.sim.dispatch({ type: 'route', soldier, to: 'B10' }), `route for ${soldier}`).toMatchObject(refused);
    }
  });

  it('refuse the route of a vehicle a gas can left below 1 %, which shows 0, while the command moves it (deviation)', async () => {
    const c = await withOurHummer(40);
    Object.assign(c.hummer.soldier, { breathRed: 0, breath: 0 });
    addFuelToVehicle(c.hummer.soldier, { status: [1] });
    expect([c.hummer.soldier.breathRed, c.hummer.soldier.breath]).toEqual([50, 0]);
    expect(await c.session.query({ type: 'previewRoute', soldier: c.hummer.id, to: 'B10' })).toMatchObject({
      ok: false,
      data: { refusal: 'vehicleNoGas' },
    });
    expect(c.sim.dispatch({ type: 'route', soldier: c.hummer.id, to: 'B10' })).toMatchObject({ ok: true });
  });

  it('offer the repair of a damaged vehicle of ours in the assignment menu as the full state does', async () => {
    const c = await withOurHummer(39);
    const economy = c.sim.campaign.economy;
    const roster = c.sim.campaign.battle?.roster;
    const toolkit = kit.content.items.byName.get('TOOLKIT');
    if (!economy || !roster || !toolkit) throw new Error('no campaign layers');
    c.hummer.life = 60;
    for (const m of roster.all()) if (!m.isVehicle) m.soldier.inv[InvSlot.HAND] = createItem(kit.content.items, toolkit.index, 100);
    for (const m of roster.all()) {
      const hint = await c.session.query({ type: 'assignmentOptions', soldier: m.id });
      expect(hint.data, `assignment menu of ${m.id}`).toEqual(JSON.parse(JSON.stringify(assignmentOptionsFor(economy, m))));
    }
    const mechanic = roster.all().find((m) => !m.isVehicle);
    const menu = JSON.stringify((await c.session.query({ type: 'assignmentOptions', soldier: mechanic?.id })).data);
    expect(menu).toContain('repairVehicle');
    expect(menu).not.toContain('notRepairable');
  });
});

describe('the warp out of a destroyed creature lair, client against server', () => {
  const LAIR_ENTRANCE = { x: 13, y: 7, z: 2 };
  const CAVE_LADDER = 64 * 160 + 74;

  it('names the surface sector in the view, the exit options and the dry run', async () => {
    const c = await landedCampaign(34);
    const campaign = c.sim.campaign;
    const roster = campaign.battle?.roster;
    if (!roster) throw new Error('no roster');
    campaign.state.creatures.lairId = LAIR_DESTROYED;
    campaign.state.creatures.destroyedLairId = 1;
    campaign.state.narrative.quests[Quest.CREATURES] = QuestStatus.DONE;
    for (const m of roster.all()) m.sector = { ...LAIR_ENTRANCE };
    for (const g of campaign.state.forces.groups) if (g.player) g.sector = { ...LAIR_ENTRANCE };
    const flow = campaign.sectors;
    if (!flow) throw new Error('no sector flow');
    await c.sim.prepareMaps([flow.mapPathOf(LAIR_ENTRANCE)]);
    expect(flow.setCurrentWorldSector(LAIR_ENTRANCE)).toBe(true);
    const soldier = roster.all()[0]?.id;
    const where = { soldier, exitGrid: CAVE_LADDER };
    expect(serialisedView(c.session).strategic?.surfaceWarp).toBe('D13');
    expect((await c.session.query({ type: 'exitSectorOptions', ...where })).data).toMatchObject({ surfaceWarp: 'D13' });
    const dryRun = await c.session.query({ type: 'exitSector', ...where, warp: true, dryRun: true });
    expect(dryRun.data).toEqual({ warp: true, target: 'D13', level: 0 });
    await expectHintsAgree(c.session, client, [
      { type: 'exitSectorOptions', ...where },
      { type: 'exitSector', ...where, warp: true, dryRun: true },
    ]);
  });
});

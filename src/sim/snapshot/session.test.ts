import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CampaignKit,
  createTestCampaign,
  landFirstSquad,
  ourSoldiers,
  testCampaignAdapter,
  testCampaignContent,
} from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import {
  advance,
  currentSim,
  driven,
  expectReloadsInvisible,
  expectSameRun,
  type RunMode,
  reloadPoint,
} from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { compileWorldMovementCosts } from '../../content/world/movement-costs.ts';
import { PreRandom, Rng } from '../../core/rng.ts';
import type { CampaignSim } from '../campaign/campaign-sim.ts';
import { registeredInTactical } from '../campaign/roster.ts';
import { createItem } from '../items/object.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { Team } from '../tactical/soldier.ts';
import { teamMembers } from '../tactical/state.ts';
import { reseedMain, snapshotCampaign, snapshotJson } from './session.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const BATTLE_SEED = 2;
const GARRISON = { admins: 0, troops: 3, elites: 0 };
const ROWS_SHORT_OF_THE_ENEMY = 7;
const COLS = 160;
const STEP_BUDGET = 3000;
const IDLE_BUDGET = 20_000;
const SCENARIO_TIMEOUT_MS = 60_000;

function stepUntil(c: CampaignSim, done: () => boolean): void {
  for (let i = 0; i < STEP_BUDGET && !done(); i++) c.step();
  expect(done()).toBe(true);
}

function tacticalOf(c: CampaignSim) {
  const t = c.tactical?.state;
  if (!t) throw new Error('no sector is loaded');
  return t;
}

function livingEnemies(c: CampaignSim) {
  return teamMembers(tacticalOf(c), Team.ENEMY).filter((e) => e.life > 0);
}

function battle(mode: RunMode): CampaignSim {
  const { campaign: c } = createTestCampaign(kit, { seed: BATTLE_SEED, mercs: 3, garrison: GARRISON, mode });
  landFirstSquad(c);
  advance(c, { idle: true }, IDLE_BUDGET);
  const approach = livingEnemies(c)[0]?.gridNo ?? 0;
  ourSoldiers(c).forEach((m, k) => {
    c.dispatch({ type: 'move', soldier: m.id, to: approach - COLS * ROWS_SHORT_OF_THE_ENEMY + k, mode: 'run' });
  });
  advance(c, { idle: true }, IDLE_BUDGET);
  expect(tacticalOf(c).inCombat).toBe(true);
  const target = () => (livingEnemies(c).find((e) => e.visible >= 0) ?? livingEnemies(c)[0])?.gridNo ?? 0;
  c.dispatch({ type: 'attack', soldier: ourSoldiers(c)[0]?.id, target: target() });
  stepUntil(c, () => tacticalOf(c).bullets.length > 0);
  reloadPoint(c);
  expect(tacticalOf(c).bullets.length).toBeGreaterThan(0);
  advance(c, { idle: true }, IDLE_BUDGET);
  const thrower = ourSoldiers(c)[1];
  if (!thrower) throw new Error('no thrower');
  const items = tacticalOf(c).content.items;
  thrower.inv[InvSlot.HAND] = createItem(items, items.byName.get('HAND_GRENADE')?.index ?? 0, 100);
  c.dispatch({ type: 'attack', soldier: thrower.id, target: target() });
  stepUntil(c, () => tacticalOf(c).explosives.objects.some((o) => o?.alive));
  reloadPoint(c);
  expect(tacticalOf(c).explosives.objects.some((o) => o?.alive)).toBe(true);
  stepUntil(c, () => tacticalOf(c).explosives.aniTiles.length > 0);
  reloadPoint(c);
  advance(c, { idle: true }, IDLE_BUDGET);
  return c;
}

describe('a campaign snapshot', () => {
  it(
    'continues a turn-based battle exactly from bullets and a grenade in flight',
    async () => {
      await expectReloadsInvisible((mode) => battle(mode));
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'changes nothing when it is taken: snapshots between inputs leave the run as it was',
    () => {
      const options = { seed: BATTLE_SEED, mercs: 3, garrison: GARRISON };
      const plain = createTestCampaign(kit, { ...options, mode: 'plain' }).campaign;
      const created = createTestCampaign(kit, options).campaign;
      const adapter = testCampaignAdapter(kit, options);
      const observed = driven(created, { ...adapter, restore: (_snapshot, previous) => previous }, 'reload');
      for (const c of [plain, observed]) {
        landFirstSquad(c);
        advance(c, { idle: true }, IDLE_BUDGET);
        c.dispatch({ type: 'mapScreen' });
        c.dispatch({ type: 'route', soldier: ourSoldiers(currentSim(c))[0]?.id ?? 0, to: 'A10' });
        advance(c, { worldSeconds: 3600 });
      }
      expect(currentSim(observed)).toBe(created);
      expectSameRun(plain, observed);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it('rebuilds the loaded world and re-links the state shared between the strategic and the tactical layer', () => {
    const options = { seed: BATTLE_SEED, mercs: 3, garrison: GARRISON };
    const { campaign: c, roster } = createTestCampaign(kit, options);
    landFirstSquad(c);
    advance(c, { idle: true }, IDLE_BUDGET);
    const json = snapshotJson(snapshotCampaign(c, testCampaignContent(kit, options)));
    const restored = testCampaignAdapter(kit, options).restore(JSON.parse(json), c);
    expect(snapshotJson(snapshotCampaign(restored, testCampaignContent(kit, options)))).toBe(json);
    const sim = restored.tactical;
    if (!sim || !c.tactical) throw new Error('no sector is loaded');
    const t = sim.state;
    const s = restored.state;
    expect(sim.world.structures).not.toBe(c.tactical.world.structures);
    expect([t.world.structures, t.pathWorld.structures]).toEqual([sim.world.structures, sim.world.structures]);
    expect(t.world.costs).toBe(sim.world.costs);
    expect(t.pathEnv.world).toBe(t.pathWorld);
    expect(Array.from(compileWorldMovementCosts(sim.world).values)).toEqual(Array.from(sim.world.costs.values));
    expect(t.rng).toBe(s.rng);
    expect(t.pre).toBe(s.pre);
    expect(s.pre.refillStream()).toBe(s.rng);
    expect(t.profiles).toBe(s.profiles);
    expect(t.keyTable).toBe(s.keyTable);
    expect(t.civGroups).toBe(s.civGroups);
    expect(t.boxing).toBe(s.narrative.boxing);
    expect(t.realtimeClock).toBe(s.sectorFlow.realtimeClock);
    expect(t.equipment.weaponsAlreadyDropped).toBe(s.status.weaponsDropped);
    expect(t.worldClock).toBe(s.clock);
    const mercs = restored.battle?.roster.all() ?? [];
    expect(mercs.map((m) => m.id)).toEqual(roster.all().map((m) => m.id));
    for (const m of mercs) {
      expect(registeredInTactical(t, m)).toBe(true);
      expect(t.mercSlots).toContain(m.soldier);
      const structure = m.soldier.structure;
      if (structure) expect(sim.world.structures.at(structure.gridNo)).toContain(structure);
    }
    expect(t.sectorHooks).not.toBe(c.tactical.state.sectorHooks);
    expect(Object.keys(t.sectorHooks)).toEqual(Object.keys(c.tactical.state.sectorHooks));
  });

  it('reseeds the main stream in place: the tactical layer and the PreRandom refill follow, the PreRandom ring repeats', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: BATTLE_SEED, mercs: 3, garrison: GARRISON });
    landFirstSquad(c);
    const s = c.state;
    const t = tacticalOf(c);
    const ring = PreRandom.fromState(s.pre.state(), Rng.fromSeed(1));
    reseedMain(s, 77);
    expect(t.rng).toBe(s.rng);
    expect(s.pre.refillStream()).toBe(s.rng);
    expect(s.rng.state()).toEqual(Rng.fromSeed(77).state());
    expect(Array.from({ length: 256 }, () => s.pre.int(1000))).toEqual(Array.from({ length: 256 }, () => ring.int(1000)));
  });

  it('fails loudly when new state cannot be written: a function, a class instance', () => {
    const options = { seed: BATTLE_SEED, mercs: 3, garrison: GARRISON };
    const { campaign: c } = createTestCampaign(kit, options);
    landFirstSquad(c);
    const content = testCampaignContent(kit, options);
    const ending = c.state.ending as unknown as Record<string, unknown>;
    ending.callback = () => 0;
    expect(() => snapshotCampaign(c, content)).toThrow(/a function cannot be written at strategic\/ending\/callback/);
    ending.callback = new Map([[1, new (class Pending {})()]]);
    expect(() => snapshotCampaign(c, content)).toThrow(/a Pending instance cannot be written at strategic\/ending\/callback\/0\/1/);
    delete ending.callback;
    const t = tacticalOf(c) as unknown as Record<string, unknown>;
    t.lastHit = { at: new Date(0) };
    expect(() => snapshotCampaign(c, content)).toThrow(/a Date instance cannot be written at tactical\/lastHit\/at/);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { sectorId } from '../../content/strategic/sector-ids.ts';
import { advance } from '../advance.ts';
import type { SimEvent } from '../events.ts';
import { PromptKind } from '../strategic/forces/battle-state.ts';
import { createNewEnemyGroupDepartingFromSector } from '../strategic/forces/groups.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { EventKind } from '../strategic/time/constants.ts';
import { addStrategicEvent } from '../strategic/time/event-queue.ts';
import { worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { Team } from '../tactical/soldier.ts';
import { teamMembers } from '../tactical/state.ts';
import { checkForEndOfBattle } from '../tactical/turns/turns.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { sectorKey } from './sector-diff.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const A9 = { x: 9, y: 1, z: 0 };
const A10 = { x: 10, y: 1, z: 0 };
const ENEMY_TROOPS = 6;
const MILITIA = [3, 1, 0] as const;
const ARRIVAL_MINUTES = 1;
const TICKS_TO_ARRIVAL = 2 * 12_000;

function sendEnemyGroup(c: CampaignSim): number {
  const ctx = c.strategic;
  if (!ctx) throw new Error('no strategic layer');
  const g = createNewEnemyGroupDepartingFromSector(ctx, sectorId(A10), 0, ENEMY_TROOPS, 0);
  g.next = { ...A9 };
  g.betweenSectors = true;
  g.traverseTime = ARRIVAL_MINUTES;
  g.arrivalTime = worldTotalMinutes(c.state.clock) + ARRIVAL_MINUTES;
  addStrategicEvent(c.state.queue, EventKind.GROUP_ARRIVAL, g.arrivalTime, g.id);
  return g.id;
}

function landedTown(seed: number, militiaRanks: readonly number[] = MILITIA): { c: CampaignSim; events: SimEvent[] } {
  const { campaign: c } = createTestCampaign(kit, { seed, mercs: 3, garrison: { admins: 0, troops: 0, elites: 0 } });
  landFirstSquad(c);
  const events: SimEvent[] = [];
  events.push(...advance(c, { idle: true }, 20_000).events);
  const militia = sectorInfo(c.state.map, A9).militia;
  militia.splice(0, militiaRanks.length, ...militiaRanks);
  sendEnemyGroup(c);
  return { c, events };
}

interface Commands {
  readonly retreatAtSlice?: number;
}

function runBattle(seed: number, commands: Commands = {}) {
  const { c, events } = landedTown(seed);
  const toPrompt = advance(c, { ticks: TICKS_TO_ARRIVAL });
  events.push(...toPrompt.events);
  const prompt = c.state.battle.prompt;
  const answered = prompt ? c.dispatch({ type: 'answer', prompt: prompt.id, choice: 'autoresolve' }) : null;
  events.push(...c.drainEvents());
  if (commands.retreatAtSlice !== undefined) {
    events.push(...advance(c, { ticks: commands.retreatAtSlice * 200 }).events);
    expect(c.dispatch({ type: 'autoresolveRetreat' })).toMatchObject({ ok: true });
  }
  const toEnd = advance(c, { idle: true });
  events.push(...toEnd.events);
  const done = c.state.battle.prompt;
  const before = c.state.clock.seconds;
  const closed = done ? c.dispatch({ type: 'answer', prompt: done.id, choice: 'done' }) : null;
  events.push(...c.drainEvents());
  return { c, prompt, answered, done, closed, events, warped: c.state.clock.seconds - before, stop: toEnd.reason };
}

describe('autoresolve from the strategic state', () => {
  it('opens an invasion prompt for an enemy group entering a town with mercs and militia', () => {
    const { c } = landedTown(5);
    const report = advance(c, { ticks: TICKS_TO_ARRIVAL });
    expect(report.reason).toBe('decision');
    const prompt = c.state.battle.prompt;
    expect(prompt?.kind).toBe(PromptKind.PRE_BATTLE);
    expect(prompt?.kind === PromptKind.PRE_BATTLE && prompt.options).toEqual([
      { choice: 'autoresolve', enabled: true },
      { choice: 'enterSector', enabled: true },
      { choice: 'retreat', enabled: true },
    ]);
    expect(report.events.find((e) => e.type === 'preBattle')).toMatchObject({ sector: 'A9', encounter: 'enemyInvasion', persistent: true });
    const ticks = c.tick;
    c.step();
    expect(c.tick).toBe(ticks);
    expect(c.dispatch({ type: 'route', soldier: 0, to: 'B9' })).toMatchObject({ ok: false });
  });

  it('runs to the end under the instant driver and applies the strategic consequences', () => {
    const r = runBattle(5);
    expect(r.answered).toMatchObject({ ok: true });
    expect(r.stop).toBe('decision');
    expect(r.done?.kind).toBe(PromptKind.AUTORESOLVE_DONE);
    expect(r.closed).toMatchObject({ ok: true });
    const c = r.c;
    expect(c.state.flow).toBe('strategic');
    expect(c.state.worldSector).toBeNull();
    expect(c.state.battle.autoresolve).toBeNull();
    const summary = r.events.find((e) => e.type === 'arSummary');
    expect(summary).toBeDefined();
    if (summary?.type !== 'arSummary') return;
    expect(r.warped).toBe(summary.worldSecondsWarped);
    expect(summary.battleSeconds % 3).toBe(0);
    const militiaLeft = sectorInfo(c.state.map, A9).militia.reduce((n, x) => n + x, 0);
    expect(militiaLeft).toBe(MILITIA[0] + MILITIA[1] - summary.militia.died);
    const diff = c.state.sectorDiffs.get(sectorKey(A9));
    expect(diff?.corpses?.length ?? 0).toBeGreaterThanOrEqual(summary.enemiesKilled + summary.militia.died + summary.mercs.died.length);
    const enemiesLeft = c.state.forces.groups.filter((g) => !g.player && g.sector.x === A9.x && g.sector.y === A9.y);
    if (summary.status === 'victory') expect(enemiesLeft).toHaveLength(0);
    expect(r.events.some((e) => e.type === 'arBattleOver')).toBe(true);
  });

  it('gives identical event logs for the same seed and commands, with and without a retreat at slice 3', () => {
    const strip = (r: ReturnType<typeof runBattle>) => JSON.stringify(r.events);
    expect(strip(runBattle(9))).toBe(strip(runBattle(9)));
    const first = runBattle(9, { retreatAtSlice: 3 });
    const second = runBattle(9, { retreatAtSlice: 3 });
    expect(strip(first)).toBe(strip(second));
    expect(first.events.some((e) => e.type === 'arRetreated' || e.type === 'retreated')).toBe(true);
  });

  it('hands a tactical battle to autoresolve when every merc is down and militia still fight', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 11, mercs: 2, garrison: { admins: 0, troops: 3, elites: 0 } });
    sectorInfo(c.state.map, A9).militia.splice(0, MILITIA.length, 4, 0, 0);
    landFirstSquad(c);
    advance(c, { idle: true }, 20_000);
    const t = c.tactical?.state;
    if (!t) throw new Error('A9 is not loaded');
    const enemies = teamMembers(t, Team.ENEMY).filter((e) => e.life > 0);
    expect(enemies.length).toBeGreaterThan(0);
    expect(teamMembers(t, Team.MILITIA).length).toBeGreaterThan(0);
    const wounded = enemies[0];
    if (wounded) wounded.life = 20;
    const tacticalLives = enemies.map((e) => e.life).sort((a, b) => a - b);
    for (const m of roster.all()) m.soldier.life = 10;
    t.turn.enemyInSector = true;
    expect(checkForEndOfBattle(t)).toBe(false);
    c.step();
    expect(c.state.flow).toBe('autoresolve');
    const events = c.drainEvents();
    expect(events.find((e) => e.type === 'preBattle')).toMatchObject({ sector: 'A9', persistent: false, autoStart: true });
    const ar = c.state.battle.autoresolve?.ar;
    expect(ar?.mercs.map((m) => m.soldier.life)).toEqual([10, 10]);
    expect(
      ar?.enemies
        .slice(0, enemies.length)
        .map((e) => e.soldier.life)
        .sort((a, b) => a - b),
    ).toEqual(tacticalLives);
    expect(c.state.worldSector).toBeNull();
    const end = advance(c, { idle: true });
    expect(end.reason).toBe('decision');
    expect(c.state.battle.prompt?.kind).toBe(PromptKind.AUTORESOLVE_DONE);
    const done = c.state.battle.prompt;
    expect(c.dispatch({ type: 'answer', prompt: done?.id, choice: 'done' })).toMatchObject({ ok: true });
    expect(c.state.flow).toBe('strategic');
  });

  it('kills the downed mercs and gives up the sector when a tactical battle is lost without militia', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 12, mercs: 1, garrison: { admins: 0, troops: 2, elites: 0 } });
    const a9 = c.state.map.elements[A9.x + A9.y * 18];
    if (a9) a9.enemyControlled = false;
    landFirstSquad(c);
    advance(c, { idle: true }, 20_000);
    const t = c.tactical?.state;
    if (!t) throw new Error('A9 is not loaded');
    for (const m of roster.all()) m.soldier.life = 5;
    t.turn.enemyInSector = true;
    expect(checkForEndOfBattle(t)).toBe(true);
    expect(roster.all().every((m) => m.soldier.life === 0)).toBe(true);
    const events = c.drainEvents();
    expect(events.find((e) => e.type === 'battleResult')).toMatchObject({ sector: 'A9', result: 'defeat', via: 'tactical' });
    expect(c.state.map.elements[A9.x + A9.y * 18]?.enemyControlled).toBe(true);
    advance(c, { ticks: 2400 });
    expect(c.tactical).toBeNull();
    expect(roster.all().every((m) => m.assignment === 30)).toBe(true);
  });

  it('captures two or three downed mercs when the enemy wins a tactical battle', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 13, mercs: 2, garrison: { admins: 0, troops: 2, elites: 0 } });
    landFirstSquad(c);
    advance(c, { idle: true }, 20_000);
    const t = c.tactical?.state;
    if (!t) throw new Error('A9 is not loaded');
    for (const m of roster.all()) m.soldier.life = 5;
    t.turn.enemyInSector = true;
    expect(checkForEndOfBattle(t)).toBe(true);
    expect(roster.all().map((m) => [m.assignment, m.sector.x, m.sector.y, m.soldier.life >= 35])).toEqual([
      [32, 13, 9, true],
      [32, 13, 9, true],
    ]);
    expect(c.drainEvents().filter((e) => e.type === 'mercCaptured')).toHaveLength(2);
    expect(c.state.battle.quests.heldInAlma).toBe(1);
  });

  it('retreats the squad and lets the militia fight on in autoresolve', () => {
    const { c } = landedTown(5);
    advance(c, { ticks: TICKS_TO_ARRIVAL });
    const prompt = c.state.battle.prompt;
    expect(c.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'retreat' })).toMatchObject({ ok: true });
    const events = c.drainEvents();
    expect(events.find((e) => e.type === 'retreated')).toMatchObject({ sector: 'A9', via: 'preBattle' });
    expect(c.state.flow).toBe('autoresolve');
    expect(c.state.battle.autoresolve?.ar.mercs).toHaveLength(0);
    expect(c.state.forces.groups.filter((g) => g.player && g.size > 0).every((g) => g.betweenSectors)).toBe(true);
  });

  it('retreats without militia: five minutes pass and the enemies stay', () => {
    const { c } = landedTown(5, [0, 0, 0]);
    advance(c, { ticks: TICKS_TO_ARRIVAL });
    const prompt = c.state.battle.prompt;
    expect(prompt?.kind).toBe(PromptKind.PRE_BATTLE);
    const before = c.state.clock.seconds;
    expect(c.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'retreat' })).toMatchObject({ ok: true });
    expect(c.state.clock.seconds - before).toBe(300);
    expect(c.state.battle.prompt).toBeNull();
    expect(c.state.flow).toBe('strategic');
    expect(c.tactical).toBeNull();
    expect(c.state.forces.groups.some((g) => !g.player && g.sector.x === A9.x && g.sector.y === A9.y)).toBe(true);
  });

  it('autoresolves a running tactical battle on request with copies of the tactical enemies', () => {
    const { c } = landedTown(5);
    advance(c, { ticks: TICKS_TO_ARRIVAL });
    const prompt = c.state.battle.prompt;
    expect(c.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'enterSector' })).toMatchObject({ ok: true });
    const t = c.tactical?.state;
    if (!t) throw new Error('A9 is not loaded');
    const enemies = teamMembers(t, Team.ENEMY).filter((e) => e.life > 0);
    expect(enemies).toHaveLength(ENEMY_TROOPS);
    const first = enemies[0];
    if (first) first.life = 33;
    t.turn.enemyInSector = true;
    expect(c.dispatch({ type: 'autoresolveBattle' })).toMatchObject({ ok: true });
    expect(c.state.flow).toBe('autoresolve');
    const ar = c.state.battle.autoresolve?.ar;
    expect(ar?.enemies).toHaveLength(ENEMY_TROOPS);
    expect(ar?.enemies.map((e) => e.soldier.life)).toContain(33);
    expect(c.state.battle.persistent).toBe(false);
  });

  it('starts autoresolve at once when only militia defend a town', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 5, mercs: 2, garrison: { admins: 0, troops: 0, elites: 0 } });
    landFirstSquad(c);
    advance(c, { idle: true }, 20_000);
    const drassen = { x: 13, y: 4, z: 0 };
    const info = sectorInfo(c.state.map, drassen);
    info.numAdmins = 0;
    info.numTroops = 0;
    info.numElites = 0;
    info.militia.splice(0, 3, 2, 1, 0);
    const element = c.state.map.elements[drassen.x + drassen.y * 18];
    if (element) element.enemyControlled = false;
    const ctx = c.strategic;
    if (!ctx) throw new Error('no strategic layer');
    const g = createNewEnemyGroupDepartingFromSector(ctx, sectorId({ x: 12, y: 4 }), 0, 3, 0);
    g.next = { ...drassen };
    g.betweenSectors = true;
    g.arrivalTime = worldTotalMinutes(c.state.clock) + ARRIVAL_MINUTES;
    addStrategicEvent(c.state.queue, EventKind.GROUP_ARRIVAL, g.arrivalTime, g.id);
    const report = advance(c, { ticks: TICKS_TO_ARRIVAL, events: ['arStarted'] });
    expect(report.events.find((e) => e.type === 'preBattle')).toMatchObject({ sector: 'D13', autoStart: true, prompt: null });
    expect(c.state.flow).toBe('autoresolve');
    expect(c.state.battle.autoresolve?.ar.mercs).toHaveLength(0);
    expect(c.state.battle.autoresolve?.ar.militia).toHaveLength(3);
    advance(c, { idle: true });
    const done = c.state.battle.prompt;
    expect(done?.kind).toBe(PromptKind.AUTORESOLVE_DONE);
    expect(c.dispatch({ type: 'answer', prompt: done?.id, choice: 'done' })).toMatchObject({ ok: true });
    expect(c.state.flow).toBe('strategic');
    expect(c.tactical).not.toBeNull();
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
  });
});

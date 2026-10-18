import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { advance } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { CreatureBattleCode, clearCreatureMusicAtVictory } from '../strategic/creatures/creatures.ts';
import { findUndergroundSector } from '../strategic/map/sectors.ts';
import { Body, Team } from '../tactical/soldier.ts';
import type { CampaignSim } from './campaign-sim.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const IDLE_BUDGET = 20_000;

function landed(seed: number): CampaignSim {
  const { campaign: c } = createTestCampaign(kit, { seed, mercs: 2, garrison: { admins: 0, troops: 0, elites: 0 } });
  landFirstSquad(c);
  advance(c, { idle: true }, IDLE_BUDGET);
  return c;
}

function tacticalOf(c: CampaignSim) {
  const t = c.tactical?.state;
  if (!t) throw new Error('no sector is loaded');
  return t;
}

describe('the creature music flag (gfUseCreatureMusic)', () => {
  it('clears at an above-ground victory only', () => {
    const surface = { creatures: { useCreatureMusic: true }, worldSector: { z: 0 } } as Parameters<typeof clearCreatureMusicAtVictory>[0];
    clearCreatureMusicAtVictory(surface);
    expect(surface.creatures.useCreatureMusic).toBe(false);
    const cave = { creatures: { useCreatureMusic: true }, worldSector: { z: 1 } } as Parameters<typeof clearCreatureMusicAtVictory>[0];
    clearCreatureMusicAtVictory(cave);
    expect(cave.creatures.useCreatureMusic).toBe(true);
    const unloaded = { creatures: { useCreatureMusic: true }, worldSector: null } as Parameters<typeof clearCreatureMusicAtVictory>[0];
    clearCreatureMusicAtVictory(unloaded);
    expect(unloaded.creatures.useCreatureMusic).toBe(true);
  });

  it('clears when a fought tactical battle is won, unless the last kill of a merc was a monster', () => {
    const c = landed(4);
    const t = tacticalOf(c);
    t.turn.numFoughtInBattle[Team.ENEMY] = 1;
    c.state.creatures.useCreatureMusic = true;
    const someone = t.soldiers.find((s) => s?.placed);
    if (!someone) throw new Error('nobody is placed');
    t.turn.lastMercKill = { ...someone, bodyType: Body.LARVAE_MONSTER };
    c.battle?.tacticalBattleEnded(t, true);
    expect(c.state.creatures.useCreatureMusic).toBe(true);
    t.turn.lastMercKill = { ...someone, bodyType: Body.REGMALE };
    c.battle?.tacticalBattleEnded(t, true);
    expect(c.state.creatures.useCreatureMusic).toBe(false);
  });

  it('is not cleared by a battle won without a fight', () => {
    const c = landed(4);
    const t = tacticalOf(c);
    t.turn.numFoughtInBattle.fill(0);
    c.state.creatures.useCreatureMusic = true;
    c.battle?.tacticalBattleEnded(t, true);
    expect(c.state.creatures.useCreatureMusic).toBe(true);
  });

  it('is set by the creature battle setup: blue light in caves, creatures underground, a town attack', () => {
    const c = landed(4);
    const flow = c.creatures;
    if (!flow) throw new Error('no creature flow');
    const s = c.state;
    expect(flow.battleSetup({ x: 9, y: 1, z: 0 }, true)).toBeNull();
    expect(s.creatures.useCreatureMusic).toBe(true);
    expect(flow.battleSetup({ x: 9, y: 1, z: 0 }, false)).toBeNull();
    expect(s.creatures.useCreatureMusic).toBe(false);
    const level = s.map.underground.find((u) => u.sector.z > 0);
    if (level) {
      const sector = { ...level.sector };
      const found = findUndergroundSector(s.map, sector);
      if (found) found.numCreatures = 3;
      expect(flow.battleSetup(sector, false)).not.toBeNull();
      expect(s.creatures.useCreatureMusic).toBe(true);
    }
    s.creatures.attack.battleCode = CreatureBattleCode.TACTICALLY_ADD;
    s.creatures.attack.numAttacking = 2;
    s.creatures.useCreatureMusic = false;
    expect(flow.battleSetup({ x: 9, y: 1, z: 0 }, false)).not.toBeNull();
    expect(s.creatures.useCreatureMusic).toBe(true);
    expect(c.drainEvents().some((e) => e.type === 'creatureAttack')).toBe(true);
  });
});

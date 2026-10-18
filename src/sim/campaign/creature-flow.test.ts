import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { advance, expectReloadsInvisible, type RunMode } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { parseSectorString, sectorId, strategicIndex } from '../../content/strategic/sector-ids.ts';
import { CreatureBattleCode, initCreatureLair } from '../strategic/creatures/creatures.ts';
import { PromptKind } from '../strategic/forces/battle-state.ts';
import { findUndergroundSector, sectorInfo } from '../strategic/map/sectors.ts';
import { EventKind } from '../strategic/time/constants.ts';
import { addStrategicEvent } from '../strategic/time/event-queue.ts';
import { worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { Team } from '../tactical/soldier.ts';
import { teamMembers } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const RELOAD_TIMEOUT_MS = 120_000;

function landed(seed: number, mode?: RunMode): CampaignSim {
  const { campaign: c } = createTestCampaign(kit, {
    seed,
    mercs: 3,
    garrison: { admins: 0, troops: 0, elites: 0 },
    ...(mode ? { mode } : {}),
  });
  landFirstSquad(c);
  advance(c, { idle: true }, 20_000);
  return c;
}

function tacticalOf(c: CampaignSim) {
  const t = c.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  return t;
}

function townAttackFight(mode?: RunMode): CampaignSim {
  const c = landed(5, mode);
  const merc = teamMembers(tacticalOf(c), Team.OUR)[0];
  if (!merc) throw new Error('no merc');
  const a = c.state.creatures.attack;
  Object.assign(a, {
    battleCode: CreatureBattleCode.TACTICALLY_ADD,
    numAttacking: 3,
    insertionCode: 4,
    insertionGridNo: merc.gridNo + 160 * 5,
    sectorId: sectorId({ x: 9, y: 1 }),
  });
  expect(c.sectors?.prepareCreaturesForBattle()).toBe(true);
  const creatures = teamMembers(tacticalOf(c), Team.CREATURE);
  expect(creatures).toHaveLength(3);
  expect(creatures.every((s) => s.structure !== null && s.inv[InvSlot.HAND]?.item !== 0 && s.hunting)).toBe(true);
  expect(c.state.creatures.attack.numAttacking).toBe(0);
  for (let round = 0; round < 30 && teamMembers(tacticalOf(c), Team.CREATURE).some((s) => s.life > 0); round++) {
    advance(c, { idle: true }, 40_000);
    const target = teamMembers(tacticalOf(c), Team.CREATURE).find((s) => s.life > 0);
    if (!target || !tacticalOf(c).inCombat) continue;
    for (const m of teamMembers(tacticalOf(c), Team.OUR)) {
      c.dispatch({ type: 'attack', soldier: m.id, target: target.gridNo });
      advance(c, { idle: true }, 20_000);
    }
    c.dispatch({ type: 'endTurn' });
  }
  const dead = tacticalOf(c).soldiers.filter((s) => s?.team === Team.CREATURE && s.dead);
  expect(dead.length).toBeGreaterThan(0);
  return c;
}

const DRASSEN_MINE_EXIT = { x: 13, y: 4, z: 1 };

function nightAttack(mode?: RunMode): CampaignSim {
  const c = landed(7, mode);
  const flow = c.creatures;
  if (!flow) throw new Error('no creature flow');
  const lair = kit.economy.strategic.creatureLairs.find((l) => l.lairId === 1);
  if (!lair) throw new Error('no Drassen lair');
  initCreatureLair(flow.context(), lair);
  const exit = findUndergroundSector(c.state.map, DRASSEN_MINE_EXIT);
  if (!exit) throw new Error('no mine exit');
  exit.numCreatures = 6;
  for (const name of ['D13', 'C13', 'B13']) {
    const s = parseSectorString(name);
    const e = c.state.map.elements[strategicIndex(s)];
    if (e) e.enemyControlled = false;
    sectorInfo(c.state.map, s).militia.splice(0, 3, 4, 2, 0);
  }
  c.dispatch({ type: 'mapScreen' });
  addStrategicEvent(c.state.queue, EventKind.CREATURE_ATTACK, worldTotalMinutes(c.state.clock) + 1, sectorId({ x: 13, y: 4 }));
  c.dispatch({ type: 'compressTime', mode: 2 });
  const run = advance(c, { events: ['arStarted'] }, 200_000);
  expect(run.events.find((e) => e.type === 'preBattle')).toMatchObject({
    encounter: 'creatureAttack',
    persistent: true,
    autoStart: true,
  });
  expect(c.state.flow).toBe('autoresolve');
  expect(c.state.battle.autoresolve?.ar.enemies.length).toBe(6);
  const end = advance(c, { idle: true }, 400_000);
  expect(end.reason).toBe('decision');
  expect(c.state.battle.prompt?.kind).toBe(PromptKind.AUTORESOLVE_DONE);
  const done = c.state.battle.prompt;
  expect(c.dispatch({ type: 'answer', prompt: done?.id, choice: 'done' })).toMatchObject({ ok: true });
  expect(c.state.flow).toBe('strategic');
  expect(c.state.creatures.attack.numAttacking).toBe(0);
  expect(findUndergroundSector(c.state.map, DRASSEN_MINE_EXIT)?.numCreatures).toBe(0);
  return c;
}

describe('creatures in the loaded sector (stub pack)', () => {
  it(
    'adds a town attack tactically next to the given grid and lets the mercs kill the creatures, the same across reloads',
    async () => {
      await expectReloadsInvisible(townAttackFight);
    },
    RELOAD_TIMEOUT_MS,
  );
});

describe('creature attacks on militia towns', () => {
  it(
    'starts an autoresolved battle from the night attack and closes it on the map, the same across reloads',
    async () => {
      await expectReloadsInvisible(nightAttack);
    },
    RELOAD_TIMEOUT_MS,
  );
});

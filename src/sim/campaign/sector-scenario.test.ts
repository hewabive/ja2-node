import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, ourSoldiers } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import { Team } from '../tactical/soldier.ts';
import { teamMembers } from '../tactical/state.ts';
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

const B9 = { x: 9, y: 2, z: 0 };
const COLS = 160;
const MAX_ROUNDS = 150;
const SCENARIO_TIMEOUT_MS = 60_000;

type Driver = (c: CampaignSim, until: () => boolean, budget?: number) => void;

const instant: Driver = (c, until, budget = 200_000) => {
  for (let i = 0; i < budget && !until(); i++) c.step();
};

const manual: Driver = (c, until, budget = 200_000) => {
  const chunk = 7;
  for (let i = 0; i < budget && !until(); i += chunk) for (let k = 0; k < chunk && !until(); k++) c.step();
};

const idle = (c: CampaignSim) => () => c.isIdle();

function compressUntil(c: CampaignSim, drive: Driver, until: () => boolean): void {
  if (!c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 }).ok) throw new Error('cannot compress');
  drive(c, until);
  if (!c.hasPendingDecision()) c.dispatch({ type: 'stopTime' });
}

function distance(a: number, b: number): number {
  return Math.abs((a % COLS) - (b % COLS)) + Math.abs(Math.trunc(a / COLS) - Math.trunc(b / COLS));
}

function livingEnemies(c: CampaignSim) {
  return teamMembers(c.tactical?.state ?? never(), Team.ENEMY).filter((s) => s.life > 0);
}

function approach(c: CampaignSim, drive: Driver): void {
  for (const merc of ourSoldiers(c)) {
    const target = livingEnemies(c).sort((a, b) => distance(merc.gridNo, a.gridNo) - distance(merc.gridNo, b.gridNo))[0];
    if (!target) return;
    for (const offset of [-2 * COLS, -2, 2, 2 * COLS, -3 * COLS, 3 * COLS]) {
      if (c.dispatch({ type: 'move', soldier: merc.id, to: target.gridNo + offset, mode: 'swat' }).ok) break;
    }
  }
  drive(c, () => c.isIdle() || c.tactical?.state.inCombat === true, 40_000);
}

function combatRound(c: CampaignSim, drive: Driver): void {
  for (const merc of ourSoldiers(c).filter((s) => s.life >= 15)) {
    const target = livingEnemies(c).sort((a, b) => distance(merc.gridNo, a.gridNo) - distance(merc.gridNo, b.gridNo))[0];
    if (!target) return;
    for (let shot = 0; shot < 3; shot++) {
      if (!c.dispatch({ type: 'attack', soldier: merc.id, target: target.gridNo, aimTime: 1 }).ok) break;
      drive(c, idle(c), 40_000);
    }
  }
  if (c.tactical?.state.inCombat) {
    c.dispatch({ type: 'endTurn' });
    drive(c, idle(c), 40_000);
  }
}

function gather(c: CampaignSim, drive: Driver): void {
  const [leader, ...others] = ourSoldiers(c);
  if (!leader) return;
  others.forEach((merc, k) => {
    for (const offset of [COLS * (k + 1), -COLS * (k + 1), k + 1, -(k + 1)])
      if (c.dispatch({ type: 'move', soldier: merc.id, to: leader.gridNo + offset, mode: 'run' }).ok) break;
  });
  drive(c, () => c.isIdle() || c.tactical?.state.inCombat === true, 40_000);
}

function dyingEnemies(c: CampaignSim) {
  return teamMembers(c.tactical?.state ?? never(), Team.ENEMY).filter((s) => s.life === 0 && !s.dead);
}

function fight(c: CampaignSim, drive: Driver): void {
  gather(c, drive);
  for (let k = 0; k < MAX_ROUNDS && livingEnemies(c).length > 0; k++) {
    if (c.tactical?.state.inCombat) combatRound(c, drive);
    else approach(c, drive);
  }
  drive(c, () => dyingEnemies(c).length === 0, 40_000);
}

function never(): never {
  throw new Error('no loaded sector');
}

interface ScenarioResult {
  readonly digest: string;
  readonly enemiesLeft: number;
  readonly corpsesBefore: number;
  readonly corpsesAfter: number;
  readonly itemsBefore: number;
  readonly itemsAfter: number;
}

function scenario(drive: Driver): ScenarioResult {
  const { campaign: c, roster } = createTestCampaign(kit, { seed: 21, garrison: { admins: 0, troops: 0, elites: 0 } });
  const b9 = sectorInfo(c.state.map, B9);
  b9.numAdmins = 0;
  b9.numTroops = 2;
  b9.numElites = 0;
  landFirstSquad(c);
  drive(c, idle(c), 10_000);
  const route = c.dispatch({ type: 'route', soldier: 0, to: 'B9' });
  if (!route.ok) throw new Error(`route refused: ${route.reason}`);
  drive(c, () => c.tactical === null, 10_000);
  compressUntil(c, drive, () => c.hasPendingDecision());
  const prompt = c.state.battle.prompt;
  expect(prompt).toMatchObject({ kind: 'preBattle' });
  expect(c.state.battle.sector).toMatchObject({ x: 9, y: 2 });
  expect(prompt?.kind === 'preBattle' && prompt.options.map((o) => [o.choice, o.enabled])).toEqual([
    ['autoresolve', true],
    ['enterSector', true],
    ['retreat', true],
  ]);
  expect(c.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'enterSector' })).toMatchObject({ ok: true });
  expect(teamMembers(c.tactical?.state ?? never(), Team.ENEMY)).toHaveLength(2);
  fight(c, drive);
  const t = c.tactical?.state ?? never();
  const enemiesLeft = teamMembers(t, Team.ENEMY).filter((s) => s.life > 0).length;
  const corpsesBefore = t.corpses.length;
  const itemsBefore = t.worldItems.length;
  for (const m of roster.all()) m.betweenSectors = true;
  c.sectors?.checkAndHandleUnloadingOfCurrentWorld();
  for (const m of roster.all()) m.betweenSectors = false;
  c.state.clock.seconds += 3600;
  c.state.clock.previousSeconds = c.state.clock.seconds;
  expect(c.dispatch({ type: 'enterSector', sector: 'B9' })).toMatchObject({ ok: true });
  const back = c.tactical?.state ?? never();
  const digest = JSON.stringify({
    rng: c.state.rng.state(),
    clock: c.state.clock.seconds,
    soldiers: back.soldiers.filter((s) => s?.placed).map((s) => [s.id, s.gridNo, s.life]),
    items: back.worldItems.map((wi) => [wi.gridNo, wi.object.item]),
    corpses: back.corpses.map((k) => [k.gridNo, k.type]),
    diff: [...c.state.sectorDiffs.keys()],
  });
  return {
    digest,
    enemiesLeft,
    corpsesBefore,
    corpsesAfter: back.corpses.length,
    itemsBefore,
    itemsAfter: back.worldItems.length,
  };
}

describe('the stub scenario', () => {
  it(
    'routes A9 to B9, wins the battle, leaves and finds B9 as it was, the same under both drivers',
    () => {
      const a = scenario(instant);
      expect(a.enemiesLeft).toBe(0);
      expect(a.corpsesAfter).toBe(a.corpsesBefore);
      expect(a.corpsesBefore).toBeGreaterThan(0);
      expect(a.itemsAfter).toBe(a.itemsBefore);
      expect(c9Key()).toBe('9,2,0');
      const b = scenario(manual);
      expect(b.digest).toBe(a.digest);
    },
    SCENARIO_TIMEOUT_MS,
  );
});

function c9Key(): string {
  return sectorKey(B9);
}

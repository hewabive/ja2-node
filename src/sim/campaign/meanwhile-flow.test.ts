import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { testProfile } from '../../../tests/support/profiles.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { expectReloadsInvisible, RELOAD_TEST_TIMEOUT_MS, type RunMode, reloadPoint } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { Meanwhile } from '../strategic/ai/constants.ts';
import type { QueenContext } from '../strategic/ai/context.ts';
import { scheduleMeanwhileEvent } from '../strategic/ai/meanwhile.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import type { CampaignSim } from './campaign-sim.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const STEP_BUDGET = 50_000;
const SCENE_GRIDNO = 12248;
const SCENE_GRIDNO_AS_INT8 = -40;

function landed(seed: number, mode?: RunMode): CampaignSim {
  const { campaign: c } = createTestCampaign(kit, {
    seed,
    mercs: 2,
    garrison: { admins: 0, troops: 0, elites: 0 },
    ...(mode ? { mode } : {}),
  });
  landFirstSquad(c);
  for (const id of [Npc.QUEEN, Npc.ELLIOT, Npc.JOE])
    c.state.profiles.set(id, testProfile(id, { sectorX: 3, sectorY: 16, sectorZ: 0, gridNo: SCENE_GRIDNO, useProfileInsertion: true }));
  return c;
}

function runUntilLogged(c: CampaignSim): void {
  for (let i = 0; i < STEP_BUDGET && c.state.meanwhile.log.length === 0; i++) c.step();
  reloadPoint(c);
}

function queenOf(c: CampaignSim): QueenContext {
  const q = c.queen;
  if (!q) throw new Error('no queen');
  return q;
}

const nowMinutes = (c: CampaignSim) => Math.trunc(c.state.clock.seconds / 60);

function sceneOnTheMap(mode?: RunMode): CampaignSim {
  const c = landed(31, mode);
  expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
  const elliot = c.state.profiles.get(Npc.ELLIOT);
  if (elliot) elliot.npcData = 5;
  scheduleMeanwhileEvent(queenOf(c), Meanwhile.OUTSKIRTS_MEDUNA, nowMinutes(c) + 5);
  expect(c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 }).ok).toBe(true);
  c.drainEvents();
  runUntilLogged(c);
  const events = c.drainEvents();
  expect(events).toContainEqual(expect.objectContaining({ type: 'meanwhile', seq: 1, scene: 'outskirtsMeduna', sector: 'P3' }));
  expect(events).toContainEqual(expect.objectContaining({ type: 'compressionStopped', reason: 'meanwhile' }));
  expect(c.state.clock.mode).toBe(CompressMode.X0);
  expect(c.state.clock.pauseLocked).toBe(false);
  expect(c.state.meanwhile.trying || c.state.meanwhile.inScene).toBe(false);
  for (const id of [Npc.QUEEN, Npc.ELLIOT, Npc.JOE])
    expect(c.state.profiles.get(id)).toMatchObject({ sectorX: 3, sectorY: 16, gridNo: SCENE_GRIDNO_AS_INT8, useProfileInsertion: false });
  expect(c.state.profiles.get(Npc.ELLIOT)?.npcData).toBe(17);
  expect(c.state.meanwhile.log[0]?.context).toMatchObject({ elliotBefore: 6, elliotAfter: 17, firstBattleTown: 'other' });
  return c;
}

function sceneInTactical(mode?: RunMode): CampaignSim {
  const c = landed(32, mode);
  expect(c.state.flow).toBe('tactical');
  scheduleMeanwhileEvent(queenOf(c), Meanwhile.LOST_TOWN, nowMinutes(c) + 1);
  runUntilLogged(c);
  expect(c.state.flow).toBe('tactical');
  expect(c.state.clock.mode).toBe(CompressMode.X1);
  expect(c.state.profiles.get(Npc.JOE)).toMatchObject({ useProfileInsertion: true, gridNo: SCENE_GRIDNO });
  expect(c.state.profiles.get(Npc.QUEEN)).toMatchObject({ useProfileInsertion: false });
  expect(c.drainEvents()).toContainEqual(expect.objectContaining({ type: 'meanwhile', scene: 'lostTown' }));
  return c;
}

describe('meanwhile scenes in a campaign (docs/26 §2.1)', () => {
  it(
    'resolves a scene on the map with the played effects: compression stopped and reset, NPC profile side effects, the same across reloads',
    async () => {
      await expectReloadsInvisible(sceneOnTheMap);
    },
    RELOAD_TEST_TIMEOUT_MS,
  );

  it(
    'resolves a scene in tactical without touching the compression mode or Joe, the same across reloads',
    async () => {
      await expectReloadsInvisible(sceneInTactical);
    },
    RELOAD_TEST_TIMEOUT_MS,
  );

  it('waits while a battle prompt is open and refuses compression while a scene tries to start', () => {
    const c = landed(33);
    const q = c.queen;
    if (!q) throw new Error('no queen');
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    c.state.meanwhile.current = { sector: { x: 3, y: 16 }, trigger: 0, id: Meanwhile.FLOWERS, npc: Npc.QUEEN };
    c.state.meanwhile.trying = true;
    c.state.battle.prompt = { id: 'p', kind: 'surrender' };
    c.meanwhile.afterStep();
    expect(c.state.meanwhile.trying).toBe(true);
    c.state.battle.prompt = null;
    expect(c.dispatch({ type: 'compressTime', mode: CompressMode.MIN5 })).toMatchObject({ ok: false });
    c.meanwhile.afterStep();
    expect(c.state.meanwhile.trying).toBe(false);
    expect(c.state.meanwhile.log.map((e) => e.id)).toEqual([Meanwhile.FLOWERS]);
  });
});

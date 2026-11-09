import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { testProfile } from '../../../tests/support/profiles.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { expectReloadsInvisible, type RunMode, reloadPoint } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { Meanwhile } from '../strategic/ai/constants.ts';
import type { QueenContext } from '../strategic/ai/context.ts';
import { meanwhileScheduledIn, scheduleMeanwhileEvent } from '../strategic/ai/meanwhile.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { MemoryInstallation } from './installation.ts';

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
const EVERY_SCENE_SEEN = 0xffffffff;

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
  expect(events.filter((e) => e.type.startsWith('meanwhile'))).toEqual([
    expect.objectContaining({ type: 'meanwhileStarted', seq: 1, scene: 'outskirtsMeduna' }),
    expect.objectContaining({ type: 'meanwhileEnded', seq: 1, scene: 'outskirtsMeduna' }),
  ]);
  expect(events).toContainEqual(expect.objectContaining({ type: 'compressionStopped', reason: 'meanwhile' }));
  expect(events.filter((e) => e.type === 'sectorLoaded').map((e) => (e as { sector?: string }).sector)).toEqual(['P3', 'A9']);
  expect([c.state.flow, c.state.clock.mode, c.state.clock.pauseLocked]).toEqual(['strategic', CompressMode.X0, false]);
  expect([c.state.meanwhile.trying, c.meanwhile.underWay()]).toEqual([false, false]);
  for (const id of [Npc.QUEEN, Npc.ELLIOT, Npc.JOE])
    expect(c.state.profiles.get(id)).toMatchObject({ sectorX: 3, sectorY: 16, gridNo: SCENE_GRIDNO_AS_INT8, useProfileInsertion: false });
  expect(c.state.profiles.get(Npc.ELLIOT)?.npcData).toBe(6);
  return c;
}

function sceneInTactical(mode?: RunMode): CampaignSim {
  const c = landed(32, mode);
  expect(c.state.flow).toBe('tactical');
  scheduleMeanwhileEvent(queenOf(c), Meanwhile.LOST_TOWN, nowMinutes(c) + 1);
  runUntilLogged(c);
  expect([c.state.flow, c.state.worldSector, c.state.clock.mode]).toEqual(['tactical', { x: 9, y: 1, z: 0 }, CompressMode.X1]);
  expect(c.state.profiles.get(Npc.JOE)).toMatchObject({ useProfileInsertion: true, gridNo: SCENE_GRIDNO });
  expect(c.state.profiles.get(Npc.QUEEN)).toMatchObject({ useProfileInsertion: false });
  expect(c.drainEvents()).toContainEqual(expect.objectContaining({ type: 'meanwhileEnded', scene: 'lostTown' }));
  return c;
}

describe('meanwhile scenes in a campaign', () => {
  it('ends a scene without its record files as it starts (deviation): the trip to P3_m and back from the map, the NPC moves undone with their side effects, compression stopped and the mode lost, the same across reloads', async () => {
    await expectReloadsInvisible(sceneOnTheMap);
  });

  it('ends a scene without its record files as it starts in tactical, back in the loaded sector without touching the compression mode or Joe, the same across reloads', async () => {
    await expectReloadsInvisible(sceneInTactical);
  });

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

  it('drops a pending auto-bandage question as a scene starts in tactical (CheckForMeanwhileOKStart leaves the screen)', () => {
    const c = landed(34);
    expect(c.state.flow).toBe('tactical');
    c.state.meanwhile.current = { sector: { x: 3, y: 16 }, trigger: 0, id: Meanwhile.FLOWERS, npc: Npc.QUEEN };
    c.state.meanwhile.trying = true;
    c.state.sectorFlow.autoBandage.pending = true;
    c.meanwhile.afterStep();
    expect([c.state.meanwhile.trying, c.state.sectorFlow.autoBandage.pending]).toEqual([false, false]);
  });

  it('leaves a pending first-battle scene alone when the interrogation loads N7 with no world loaded: TrashWorld returns at once (WorldDef.cc TrashWorld)', () => {
    const c = landed(35);
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    c.sectors?.trashWorld();
    expect([c.tactical, c.state.worldSector]).toEqual([null, null]);
    c.state.queen.firstBattleMeanwhilePending = true;
    c.state.meanwhile.current = { sector: { x: 7, y: 14 }, trigger: 0, id: Meanwhile.INTERROGATION, npc: Npc.QUEEN };
    c.state.meanwhile.trying = true;
    c.meanwhile.afterStep();
    expect([c.state.worldSector, c.state.meanwhile.log.map((e) => e.id)]).toEqual([{ x: 7, y: 14, z: 0 }, [Meanwhile.INTERROGATION]]);
    expect(c.state.queen.firstBattleMeanwhilePending).toBe(true);
    expect(meanwhileScheduledIn(c.state.meanwhile, Meanwhile.END_OF_PLAYERS_FIRST_BATTLE)).toBe(false);
  });

  it('offers no Skip for the interrogation even once seen, and does not read the seen flags for it (BringupMeanwhileBox)', () => {
    const c = landed(36);
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    let reads = 0;
    const installation = new MemoryInstallation(EVERY_SCENE_SEEN);
    c.meanwhile.useInstallation({
      meanwhileSceneSeen: (scene) => {
        reads++;
        return installation.meanwhileSceneSeen(scene);
      },
      setMeanwhileSceneSeen: (scene) => installation.setMeanwhileSceneSeen(scene),
    });
    c.state.meanwhile.current = { sector: { x: 7, y: 14 }, trigger: 0, id: Meanwhile.INTERROGATION, npc: Npc.QUEEN };
    c.state.meanwhile.trying = true;
    c.meanwhile.afterStep();
    expect([c.state.battle.prompt, reads]).toEqual([null, 0]);
    expect(c.state.meanwhile.log.map((e) => [e.id, e.skipped])).toEqual([[Meanwhile.INTERROGATION, false]]);
  });
});

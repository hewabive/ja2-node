import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../tests/support/autoresolve.ts';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { MercType } from '../../content/strategic/economy-content.ts';
import { parseSectorString, sameSector } from '../../content/strategic/sector-ids.ts';
import { advance } from '../advance.ts';
import { PromptKind } from '../strategic/forces/battle-state.ts';
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

const NPC_SECTOR = parseSectorString('B9');

function firstNpcProfile(): number {
  const npc = [...kit.economy.economy.mercTypes].find(([, type]) => type === MercType.NPC);
  if (!npc) throw new Error('no NPC profile type');
  return npc[0];
}

function squadHeadingThroughAnNpc(to: string): CampaignSim {
  const { campaign: c } = createTestCampaign(kit, { seed: 3, mercs: 2, garrison: { admins: 0, troops: 0, elites: 0 } });
  landFirstSquad(c);
  advance(c, { idle: true }, 20_000);
  const id = firstNpcProfile();
  c.state.profiles.set(id, progressFor(id, { sectorX: NPC_SECTOR.x, sectorY: NPC_SECTOR.y, sectorZ: 0 }));
  const route = c.dispatch({ type: 'route', soldier: 0, to });
  if (!route.ok) throw new Error(`route refused: ${route.reason}`);
  advance(c, { ticks: 20_000, events: ['sectorUnloaded'] });
  if (c.state.flow !== 'strategic') throw new Error('the squad did not leave the sector');
  return c;
}

function playerGroup(c: CampaignSim) {
  const g = c.state.forces.groups.find((x) => x.player && x.members.includes(0));
  if (!g) throw new Error('no squad group');
  return g;
}

describe('NPCs of note on the way', () => {
  it('asks whether to stop in a wilderness sector with an unmet NPC, and stops there on stop', () => {
    const c = squadHeadingThroughAnNpc('C9');
    const report = advance(c, { compressionStopped: true, mode: CompressMode.MIN30 });
    expect(report.reason).toBe('decision');
    expect(c.state.battle.prompt?.kind).toBe(PromptKind.NPC_OF_NOTE);
    expect(sameSector(playerGroup(c).sector, NPC_SECTOR)).toBe(true);
    expect(c.battle?.npcOfNoteChoices()).toEqual(['continue', 'stop']);
    const prompt = c.state.battle.prompt;
    expect(c.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'ok' })).toMatchObject({ ok: false });
    expect(c.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'stop' })).toEqual({ ok: true });
    const g = playerGroup(c);
    expect(g.betweenSectors).toBe(false);
    expect(g.waypoints).toEqual([]);
    expect(c.state.map.selectedSector).toMatchObject({ x: NPC_SECTOR.x, y: NPC_SECTOR.y });
  });

  it('moves on to the destination on continue', () => {
    const c = squadHeadingThroughAnNpc('C9');
    advance(c, { compressionStopped: true, mode: CompressMode.MIN30 });
    expect(c.dispatch({ type: 'answer', prompt: c.state.battle.prompt?.id, choice: 'continue' })).toEqual({ ok: true });
    expect(playerGroup(c).betweenSectors).toBe(true);
    advance(c, { compressionStopped: true, mode: CompressMode.MIN30 });
    expect(sameSector(playerGroup(c).sector, parseSectorString('C9'))).toBe(true);
  });

  it('only tells a squad that ends its move next to the NPC, with an OK box', () => {
    const c = squadHeadingThroughAnNpc('B9');
    advance(c, { compressionStopped: true, mode: CompressMode.MIN30 });
    expect(c.state.battle.prompt?.kind).toBe(PromptKind.NPC_OF_NOTE);
    expect(c.battle?.npcOfNoteChoices()).toEqual(['ok']);
    const prompt = c.state.battle.prompt;
    expect(c.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'stop' })).toMatchObject({ ok: false });
    expect(c.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'ok' })).toEqual({ ok: true });
    expect(c.state.battle.prompt).toBeNull();
  });
});

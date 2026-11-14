import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../tests/support/sectors.ts';
import { battleVoiceBasename } from '../content/audio/battle-sound.ts';
import { sectorId } from '../content/strategic/sector-ids.ts';
import { diffPlayerView } from '../protocol/view.ts';
import { advance } from '../sim/advance.ts';
import { createNewEnemyGroupDepartingFromSector } from '../sim/strategic/forces/groups.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { EventKind } from '../sim/strategic/time/constants.ts';
import { addStrategicEvent } from '../sim/strategic/time/event-queue.ts';
import { worldTotalMinutes } from '../sim/strategic/time/world-clock.ts';
import { CampaignSession } from './campaign-session.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const HIDDEN_KEYS = ['attack', 'defence', 'nextAttack', 'nextHit', 'hitDamage', 'flags'];
const IMP_PROFILE = 51;
const IMP_VOICE = 2;

function sessionWithInvasion(): CampaignSession {
  const { campaign: c, roster } = createTestCampaign(kit, { seed: 5, mercs: 3, garrison: { admins: 0, troops: 0, elites: 0 } });
  landFirstSquad(c);
  advance(c, { idle: true }, 20_000);
  sectorInfo(c.state.map, { x: 9, y: 1 }).militia.splice(0, 3, 3, 1, 0);
  const ctx = c.strategic;
  if (!ctx) throw new Error('no strategic layer');
  const g = createNewEnemyGroupDepartingFromSector(ctx, sectorId({ x: 10, y: 1 }), 0, 6, 0);
  g.next = { x: 9, y: 1, z: 0 };
  g.betweenSectors = true;
  g.arrivalTime = worldTotalMinutes(c.state.clock) + 1;
  addStrategicEvent(c.state.queue, EventKind.GROUP_ARRIVAL, g.arrivalTime, g.id);
  advance(c, { ticks: 24_000 });
  return new CampaignSession(c, kit.sectors.timelines.presentation, roster);
}

describe('the battle view', () => {
  it('projects the pre-battle prompt with what the panel shows', () => {
    const session = sessionWithInvasion();
    const prompt = session.view().prompt;
    expect(prompt).toMatchObject({ kind: 'preBattle', sector: 'A9', persistent: true, encounter: 'enemyInvasion', militia: 4 });
    if (prompt?.kind !== 'preBattle') return;
    expect(prompt.enemies).toBe(6);
    expect(prompt.involved.map((m) => [m.soldier, m.condition, m.hp])).toEqual([
      [0, 'excellent', 100],
      [1, 'excellent', 100],
      [2, 'excellent', 100],
    ]);
    expect(prompt.options.map((o) => o.choice)).toEqual(['autoresolve', 'enterSector', 'retreat']);
  });

  it('shows the autoresolve cells without ratings, timers or the exact enemy life, and sends changes in frames', () => {
    const session = sessionWithInvasion();
    const before = session.view();
    const prompt = session.campaign.state.battle.prompt;
    expect(session.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'autoresolve' })).toMatchObject({ ok: true });
    advance(session, { ticks: 600 });
    const view = session.view();
    expect(view.prompt).toBeNull();
    const ar = view.autoresolve;
    expect(ar).toMatchObject({ sector: 'A9', status: 'inProgress', battleSeconds: 3 });
    expect(ar?.cells.filter((c) => c.side === 'merc')).toHaveLength(3);
    for (const cell of ar?.cells ?? []) {
      for (const key of HIDDEN_KEYS) expect(cell).not.toHaveProperty(key);
      if (cell.side !== 'merc') expect(cell).not.toHaveProperty('life');
    }
    const frame = diffPlayerView(before, view);
    expect(frame?.prompt).toBeNull();
    expect(frame?.autoresolve).toEqual(ar);
    advance(session, { idle: true });
    const done = session.view().prompt;
    expect(done).toMatchObject({ kind: 'autoresolveDone' });
  });

  it("gives every cell its soldier's battle voice: a merc's voice id, an I.M.P. merc's chosen one, a militia's or enemy's set drawn at creation", () => {
    const session = sessionWithInvasion();
    const c = session.campaign;
    expect(session.dispatch({ type: 'answer', prompt: c.state.battle.prompt?.id, choice: 'autoresolve' })).toMatchObject({ ok: true });
    const ar = c.state.battle.autoresolve?.ar;
    const [first] = ar?.mercs ?? [];
    if (!ar || !first) throw new Error('no autoresolve');
    first.soldier.profile = IMP_PROFILE;
    c.state.laptop.imp.voices.set(IMP_PROFILE, IMP_VOICE);
    const cells = session.view().autoresolve?.cells ?? [];
    const others = [...ar.militia, ...ar.enemies];
    expect(others.length).toBeGreaterThan(0);
    expect(cells.filter((cell) => cell.side !== 'merc').map((cell) => cell.voice)).toEqual(
      others.map((cell) => battleVoiceBasename(null, 0, cell.soldier.bodyType, cell.soldier.battleSoundId)),
    );
    expect(cells.find((cell) => cell.side === 'merc' && cell.index === first.index)?.voice).toBe('002');
  });
});

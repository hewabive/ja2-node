import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import type { SimEvent } from '../sim/events.ts';
import { Quest } from '../sim/strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../sim/strategic/narrative/facts.ts';
import { AiAction } from '../sim/tactical/ai/actions.ts';
import { executeAction } from '../sim/tactical/ai/control.ts';
import { type Soldier, Team } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { Session } from './session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const SURRENDER_LINES = 37;
const POW = 32;
const SLOW_SCENARIO_MS = 30_000;

async function landedUnderFire(seed: number): Promise<{ session: CampaignSession; live: Session; enemy: Soldier }> {
  const session = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 2, land: false });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  const live = new Session('t', session);
  live.advance({ ticks: 20 });
  const t = session.campaign.tactical?.state;
  const enemy = t ? teamMembers(t, Team.ENEMY).find((e) => e.life > 0) : undefined;
  if (!t || !enemy) throw new Error('no enemy in the landing sector');
  session.drainEvents();
  return { session, live, enemy };
}

function offer(session: CampaignSession, enemy: Soldier): SimEvent[] {
  const t = session.campaign.tactical?.state;
  if (!t) throw new Error('no sector');
  enemy.ai.action = AiAction.OFFER_SURRENDER;
  expect(executeAction(t, enemy)).toBe(true);
  return session.drainEvents();
}

describe('the enemy surrender offer in a campaign', { timeout: SLOW_SCENARIO_MS }, () => {
  it('barks the surrender line, opens the tactical surrender prompt and stops time until it is answered', async () => {
    const { session, live, enemy } = await landedUnderFire(3);
    const events = offer(session, enemy);
    const bark = events.find((e) => e.type === 'civQuote') as unknown as { quote: number; text?: string; soldier: number };
    expect(bark).toMatchObject({ quote: SURRENDER_LINES, soldier: enemy.id });
    expect(bark.text?.length ?? 0).toBeGreaterThan(0);
    const prompt = session.view().prompt;
    expect(prompt).toMatchObject({ kind: 'surrender', context: 'tactical', soldier: enemy.id, choices: ['accept', 'reject'] });
    expect(events.some((e) => e.type === 'surrenderOffered')).toBe(true);
    const tick = session.campaign.tick;
    expect(live.advance({ ticks: 10 }).reason).toBe('decision');
    expect(session.campaign.tick).toBe(tick);
    expect(session.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'later' })).toMatchObject({ ok: false });
    expect(session.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'reject' })).toMatchObject({
      ok: true,
      data: { surrendered: false },
    });
    expect([session.view().prompt ?? null, enemy.ai.action]).toEqual([null, AiAction.NONE]);
    expect(session.campaign.state.battle.prompt).toBeNull();
  });

  it('captures every merc in the sector when the surrender is accepted and loses the battle', async () => {
    const { session, enemy } = await landedUnderFire(4);
    offer(session, enemy);
    const prompt = session.view().prompt;
    const answered = session.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'accept' });
    expect(answered).toMatchObject({ ok: true, data: { surrendered: true } });
    const events = session.drainEvents();
    expect(events.filter((e) => e.type === 'mercCaptured').length).toBe(2);
    expect(events.find((e) => e.type === 'battleResult')).toMatchObject({ result: 'defeat', via: 'tactical' });
    expect(session.campaign.state.narrative.quests[Quest.HELD_IN_ALMA]).toBe(QuestStatus.IN_PROGRESS);
    expect(session.view().strategic?.mercs.every((m) => m.assignment === POW)).toBe(true);
  });
});

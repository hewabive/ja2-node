import { describe, expect, it } from 'vitest';
import { testSoldier } from '../../../../tests/support/narrative.ts';
import { NarrativeProfile, ProfileFlag } from '../../narrative/narrative-ids.ts';
import { createTalkState } from '../../narrative/talk-state.ts';
import type { GuideDescription } from '../../strategic/narrative/facts.ts';
import { Side, type Soldier, TEAM_FIRST_ID, Team } from '../../tactical/soldier.ts';
import type { CampaignSim } from '../campaign-sim.ts';
import { guideDescriptionFor, handleRpcDescription, startGuideCountdown } from './guide-description.ts';

const B13 = { x: 13, y: 2, z: 0 };
const D15 = { x: 15, y: 4, z: 0 };

function campaign(guide: GuideDescription, options: { inCombat?: boolean; enemies?: number; flow?: string } = {}) {
  const ira = testSoldier(2, Team.OUR, NarrativeProfile.IRA, 12000);
  const soldiers: Soldier[] = [ira];
  for (let k = 0; k < (options.enemies ?? 0); k++) {
    const e = testSoldier(TEAM_FIRST_ID[Team.ENEMY] + k, Team.ENEMY, 200, 13000 + k);
    e.neutral = false;
    e.side = Side.ENEMY;
    soldiers[e.id] = e;
  }
  const talk = createTalkState();
  const c = {
    state: { narrative: { guide }, flow: options.flow ?? 'tactical', worldSector: B13 },
    tactical: { state: { engagedInConv: false, inCombat: options.inCombat ?? false, soldiers } },
    talk: { host: { talk } },
    battle: { roster: { all: () => [{ id: ira.id, soldier: ira, sector: B13, betweenSectors: false }] } },
    narrative: { profile: () => ({ miscFlags: ProfileFlag.RECRUITED }) },
  } as unknown as CampaignSim;
  return { c, talk };
}

function freshGuide(): GuideDescription {
  return { counting: false, countdown: 0, quote: 0, sectorX: 0, sectorY: 0 };
}

describe('guide descriptions', () => {
  it('knows the described sectors, the sci-fi-only Alma sector and nothing underground', () => {
    expect(guideDescriptionFor(B13, false)).toBe(0);
    expect(guideDescriptionFor({ x: 13, y: 8, z: 0 }, false)).toBeNull();
    expect(guideDescriptionFor({ x: 13, y: 8, z: 0 }, true)).toBe(3);
    expect(guideDescriptionFor({ x: 15, y: 4, z: 0 }, false)).toBe(32);
    expect(guideDescriptionFor({ x: 13, y: 2, z: 1 }, false)).toBeNull();
  });

  it('counts the real-time turns down and lets a recruited guide in the sector describe it from his alternate file', () => {
    const guide = freshGuide();
    startGuideCountdown(guide, B13, 0, 0);
    const { c, talk } = campaign(guide);
    for (let k = 0; k < 3; k++) handleRpcDescription(c);
    expect([guide.counting, guide.countdown, talk.queue.length]).toEqual([true, 1, 0]);
    handleRpcDescription(c);
    expect(guide.counting).toBe(false);
    expect(talk.queue).toEqual([
      {
        kind: 'quote',
        speaker: NarrativeProfile.IRA,
        quote: 0,
        npcUi: false,
        fromSoldier: true,
        delayed: false,
        record: null,
        alternate: true,
      },
    ]);
  });

  it('waits out combat and enemies, except for the quotes treated as SAM sites, and only on the tactical screen', () => {
    const guide = freshGuide();
    startGuideCountdown(guide, B13, 0, 2);
    handleRpcDescription(campaign(guide, { inCombat: true }).c);
    handleRpcDescription(campaign(guide, { enemies: 1 }).c);
    handleRpcDescription(campaign(guide, { flow: 'strategic' }).c);
    expect(guide.countdown).toBe(6);
    const sam = freshGuide();
    startGuideCountdown(sam, D15, 32, 4);
    const { c, talk } = campaign(sam, { inCombat: true, enemies: 2 });
    handleRpcDescription(c);
    expect([sam.counting, talk.queue.length]).toEqual([false, 0]);
  });
});

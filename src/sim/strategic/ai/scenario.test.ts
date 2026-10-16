import { beforeAll, describe, expect, it } from 'vitest';
import { loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStrategicTestContent } from '../../../../tests/support/strategic.ts';
import type { ArmyContent } from '../../../content/strategic/army.ts';
import { parseSectorId, parseSectorString, type Sector, sameSector, sectorId } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { CampaignSim } from '../../campaign/campaign-sim.ts';
import { getGroup } from '../forces/groups.ts';
import { setThisSectorAsPlayerControlled } from '../map/control.ts';
import { initStrategicLayerMap } from '../map/init.ts';
import { EnemyKnowledge, whatPlayerKnowsAboutEnemiesInSector } from '../map/knowledge.ts';
import { sectorInfo } from '../map/sectors.ts';
import { createStrategicState } from '../state.ts';
import { NUM_SEC_IN_DAY, NUM_SEC_IN_HOUR, Warp } from '../time/constants.ts';
import { warpGameTime } from '../time/world-clock.ts';
import { initStrategicAiForNewCampaign } from './strategic-ai.ts';

let content: StrategicContent;
let army: ArmyContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
  army = await loadArmyTestContent();
});

const DRASSEN = ['B13', 'C13', 'D13'].map((s) => parseSectorString(s));
const MAX_DAYS = 30;

function newMediumCampaign(): CampaignSim {
  const state = createStrategicState({ seed: 20261016, options: { difficulty: 2, sciFi: false } });
  const campaign = new CampaignSim(state, null, { strategic: { content }, queen: { army } });
  const ctx = campaign.strategic;
  const q = campaign.queen;
  if (!ctx || !q) throw new Error('strategic layer');
  initStrategicLayerMap(ctx, { initStrategicAI: () => initStrategicAiForNewCampaign(q) });
  return campaign;
}

function liberateWithMilitia(campaign: CampaignSim, s: Sector): void {
  const ctx = campaign.strategic;
  if (!ctx) throw new Error('strategic layer');
  const si = sectorInfo(ctx.state.map, s);
  si.numAdmins = 0;
  si.numTroops = 0;
  si.numElites = 0;
  si.militia[0] = 2;
  setThisSectorAsPlayerControlled(ctx, s, true);
}

describe('headless strategic AI scenario (docs/17 §16.3)', () => {
  it('wakes after three victories on medium, waits out the grace period and attacks Drassen', () => {
    const campaign = newMediumCampaign();
    const q = campaign.queen;
    if (!q) throw new Error('queen');
    expect(whatPlayerKnowsAboutEnemiesInSector(q, parseSectorString('D15'))).toBe(EnemyKnowledge.NOTHING);
    warpGameTime(campaign.clockContext, 3 * NUM_SEC_IN_DAY, Warp.NORMAL);
    for (const s of DRASSEN) liberateWithMilitia(campaign, s);
    expect(q.state.queen.playerBattleVictories).toBe(3);
    expect(q.state.queen.awake).toBe(true);
    expect(q.state.queen.massFortificationOrdered).toBe(true);
    expect(whatPlayerKnowsAboutEnemiesInSector(q, parseSectorString('C12'))).toBe(EnemyKnowledge.HOW_MANY);
    expect(whatPlayerKnowsAboutEnemiesInSector(q, parseSectorString('D15'))).toBe(EnemyKnowledge.NOTHING);
    const drassenIds = new Set(DRASSEN.map(sectorId));
    const liberatedAt = q.state.clock.seconds;
    let sentAt = 0;
    let attackedAt = 0;
    let attacked: Sector | null = null;
    for (let hour = 0; hour < MAX_DAYS * 24 && !attacked; hour++) {
      warpGameTime(campaign.clockContext, NUM_SEC_IN_HOUR, Warp.NORMAL);
      const pending = q.state.queen.garrisons.filter((g) => drassenIds.has(g.sector) && getGroup(q, g.pendingGroup));
      if (pending.length > 0 && !sentAt) sentAt = q.state.clock.seconds;
      const battle = q.state.encounter.preBattle;
      if (battle && DRASSEN.some((s) => sameSector(s, battle.sector))) {
        attacked = battle.sector;
        attackedAt = q.state.clock.seconds;
      }
    }
    const firstMove = sentAt || attackedAt;
    expect(firstMove).toBeGreaterThan(liberatedAt + q.state.queen.graceHours * NUM_SEC_IN_HOUR - NUM_SEC_IN_HOUR);
    expect(attacked).not.toBeNull();
    const battleGroup = getGroup(q, q.state.encounter.preBattle?.battleGroupId ?? 0);
    expect(battleGroup?.player).toBe(false);
    expect(battleGroup?.sector && drassenIds.has(sectorId(battleGroup.sector))).toBe(true);
    expect(parseSectorId('D13')).toBe(sectorId(parseSectorString('D13')));
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, FakeCrew, loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import type { ArmyContent } from '../../content/strategic/army.ts';
import { parseSectorId, sectorFromId } from '../../content/strategic/sector-ids.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { createStrategicState } from '../strategic/state.ts';
import { CompressMode, EventKind, FIRST_ARRIVAL_DELAY, Frequency, STARTING_TIME } from '../strategic/time/constants.ts';
import { worldHour } from '../strategic/time/world-clock.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { createSoldier, Team } from '../tactical/soldier.ts';
import { CampaignSim } from './campaign-sim.ts';
import { hireMerc } from './hiring.ts';
import { initNewGame } from './new-game.ts';
import { Roster } from './roster.ts';

let content: EconomyTestContent;
let army: ArmyContent;
let tactical: TacticalContent;

beforeAll(async () => {
  content = await loadEconomyTestContent();
  army = await loadArmyTestContent();
  tactical = await loadTestContent();
});

const STATS = {
  agility: 80,
  dexterity: 80,
  strength: 80,
  wisdom: 80,
  leadership: 50,
  marksmanship: 80,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};

function recruit(id: number) {
  const palettes = { hair: 'BROWNHEAD', skin: 'TANSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' };
  return {
    soldier: createSoldier({
      id,
      team: Team.OUR,
      name: `Merc ${id}`,
      bodyType: 0,
      palettes,
      stats: STATS,
      life: 80,
      gridNo: -1,
      direction: 4,
      state: 0,
    }),
    profile: null,
  };
}

function newCampaign(seed: number, difficulty: number): CampaignSim {
  const state = createStrategicState({ seed, options: { difficulty, sciFi: true, gunNut: false } });
  const crew = new FakeCrew();
  const campaign = new CampaignSim(state, null, {
    strategic: { content: content.strategic, mercs: crew },
    economy: { economy: content.economy, items: content.items, crew },
    queen: { army },
  });
  initNewGame(campaign);
  return campaign;
}

describe('a new game', () => {
  it('starts on day 1 at 01:00 with the standing events, garrisons and starting cash', () => {
    const campaign = newCampaign(7, 2);
    const s = campaign.state;
    expect(s.clock.seconds).toBe(STARTING_TIME);
    expect(s.didGameJustStart).toBe(true);
    const kinds = s.queue.events.map((e) => e.kind);
    expect(kinds.filter((k) => k === EventKind.CHANGELIGHTVAL)).toHaveLength(18);
    for (const k of [EventKind.HOURLY_UPDATE, EventKind.QUARTER_HOUR_UPDATE])
      expect(s.queue.events.find((e) => e.kind === k)?.frequency).toBe(Frequency.PERIODIC);
    expect(kinds.filter((k) => k === EventKind.EVALUATE_QUEEN_SITUATION)).toHaveLength(1);
    expect(kinds.filter((k) => k === EventKind.CHECK_ENEMY_CONTROLLED_SECTOR).length).toBeGreaterThan(20);
    expect(kinds.filter((k) => k === EventKind.DAY3_ADD_EMAIL_FROM_SPECK)).toHaveLength(1);
    expect(s.finances.balance).toBe(35000);
    const a9 = sectorInfo(s.map, sectorFromId(parseSectorId('A9')));
    expect(a9.numTroops + a9.numElites + a9.numAdmins).toBeGreaterThan(0);
    expect(s.forces.groups.some((g) => !g.player)).toBe(true);
  });

  it('is the same campaign for the same seed and a different one for another seed', () => {
    const counts = (c: CampaignSim) => c.state.map.sectors.map((i) => i.numTroops + 10 * i.numElites + 100 * i.numAdmins);
    expect(counts(newCampaign(3, 2))).toEqual(counts(newCampaign(3, 2)));
    expect(counts(newCampaign(3, 2))).not.toEqual(counts(newCampaign(4, 2)));
    expect(newCampaign(5, 3).state.finances.balance).toBe(30000);
  });

  it('hires a squad that lands at 07:00 after the first compression warp', () => {
    const state = createStrategicState({ seed: 9 });
    const roster = new Roster({
      state: state.roster,
      content: tactical,
      combat: () => {
        throw new Error('no combat');
      },
    });
    let loads = 0;
    const campaign = new CampaignSim(state, null, {
      strategic: { content: content.strategic, mercs: roster },
      economy: { economy: content.economy, items: content.items, crew: roster },
      queen: { army },
      loadStartSector: () => {
        loads++;
      },
    });
    initNewGame(campaign);
    expect(campaign.dispatch({ type: 'compressTime', mode: CompressMode.MIN5 }).ok).toBe(false);
    for (let k = 0; k < 3; k++) expect(typeof hireMerc(campaign, roster, recruit, tactical)).toBe('object');
    expect(state.queue.events.filter((e) => e.kind === EventKind.DELAYED_HIRING_OF_MERC).map((e) => e.stamp)).toEqual(
      Array(3).fill(STARTING_TIME + FIRST_ARRIVAL_DELAY),
    );
    expect(campaign.dispatch({ type: 'compressTime', mode: CompressMode.MIN5 })).toEqual({ ok: true });
    expect(loads).toBe(1);
    expect(state.didGameJustStart).toBe(false);
    expect(worldHour(state.clock)).toBe(7);
    expect(roster.all().every((m) => m.groupId > 0 && m.assignment === 0)).toBe(true);
  });
});

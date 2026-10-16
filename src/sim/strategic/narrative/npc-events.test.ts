import { describe, expect, it } from 'vitest';
import { testProfile } from '../../../../tests/support/narrative.ts';
import { NpcActionCode as A, NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS as BONUS } from '../../tactical/narrative/npc-actions/codes.ts';
import { MercStatus, type ProfileProgress } from '../../tactical/profiles.ts';
import { Fact, Quest } from './fact-ids.ts';
import { handleNpcSystemEvent, LOST_SHIPMENT_GRIDNO, type NpcSystemEventContext } from './npc-events.ts';
import { Npc } from './npc-ids.ts';

interface Probe extends NpcSystemEventContext {
  readonly facts: Set<number>;
  readonly quests: Map<number, number>;
  readonly log: string[];
  readonly profiles: Map<number, ProfileProgress>;
  loaded: boolean;
  joeyHere: boolean;
}

function probe(draws: number[] = [], facts: number[] = []): Probe {
  const p: Probe = {
    facts: new Set(facts),
    quests: new Map(),
    log: [],
    profiles: new Map(),
    loaded: false,
    joeyHere: false,
    checkFact: (id) => p.facts.has(id),
    setFactTrue: (id) => p.facts.add(id),
    setFactFalse: (id) => p.facts.delete(id),
    questStatus: (q) => p.quests.get(q) ?? 0,
    startQuest: (q) => p.quests.set(q, 1),
    endQuest: (q) => p.quests.set(q, 2),
    profile: (id) => {
      if (!p.profiles.has(id)) p.profiles.set(id, testProfile(id));
      return p.profiles.get(id) ?? null;
    },
    minutesInDay: () => 600,
    addFutureDayNpcEvent: (minute, param, days) => p.log.push(`future ${minute} ${param} ${days}`),
    addSameDayNpcEvent: (minute, param) => p.log.push(`today ${minute} ${param}`),
    random: (n) => {
      p.log.push(`random ${n}`);
      return draws.shift() ?? 0;
    },
    kingpinMoneyCheck: (first) => p.log.push(`kingpinCheck ${first}`),
    kingpinLetter: () => p.log.push('letter'),
    enricoMiguelEmail: () => p.log.push('enrico'),
    kingpinGroupWillBecomeHostile: () => p.log.push('kingpinHostile'),
    handleNpcDoAction: (npc, code) => p.log.push(`action ${npc} ${code}`),
    soldierInLoadedSector: () => p.joeyHere,
    delivery: {
      deliverySectorLoaded: () => p.loaded,
      addHiddenAtDelivery: (good, loaded) => p.log.push(`add ${good.item} ${good.status} ${good.count} ${loaded}`),
      moveLoadedPool: (from) => p.log.push(`movePool ${from}`),
      moveUnloadedItemsAtStolenGridNo: () => p.log.push('moveUnloaded'),
    },
  };
  return p;
}

describe('NPC system events', () => {
  it('returns Pablo’s goods with two random items and moves the stolen pool', () => {
    const p = probe([0, 5, 7, 2]);
    p.loaded = true;
    handleNpcSystemEvent(p, BONUS + A.RETURN_STOLEN_SHIPMENT_ITEMS);
    expect(p.log).toEqual([
      'random 10',
      'random 10',
      'add GASMASK 25 1 true',
      'random 10',
      'random 10',
      'add SW38 92 2 true',
      'movePool 1',
    ]);
    expect(p.facts.has(Fact.PABLO_RETURNED_GOODS)).toBe(true);
  });

  it('sends nothing for a dead Pablo', () => {
    const p = probe();
    const pablo = p.profile(Npc.PABLO) as ProfileProgress;
    pablo.mercStatus = MercStatus.IS_DEAD;
    handleNpcSystemEvent(p, BONUS + A.RETURN_STOLEN_SHIPMENT_ITEMS);
    expect(p.log).toEqual([]);
  });

  it('damages a delayed package, moving only gridno 1 when the airport is not loaded', () => {
    const p = probe([69], [Fact.SHIPMENT_DELAYED_24_HOURS]);
    handleNpcSystemEvent(p, BONUS + A.SET_RANDOM_PACKAGE_DAMAGE_TIMER);
    expect(p.log).toEqual(['random 100', 'moveUnloaded']);
    expect([p.facts.has(Fact.PACKAGE_DAMAGED), p.facts.has(Fact.SHIPMENT_DELAYED_24_HOURS)]).toEqual([true, false]);
    const loaded = probe([0]);
    loaded.loaded = true;
    handleNpcSystemEvent(loaded, BONUS + A.SET_RANDOM_PACKAGE_DAMAGE_TIMER);
    expect(loaded.log).toEqual(['random 100', `movePool ${LOST_SHIPMENT_GRIDNO}`]);
    const lost = probe([70]);
    handleNpcSystemEvent(lost, BONUS + A.SET_RANDOM_PACKAGE_DAMAGE_TIMER);
    expect(lost.facts.has(Fact.PACKAGE_LOST_PERMANENTLY)).toBe(true);
  });

  it('runs Kingpin’s three stages: the check, the letter and the threat', () => {
    const p = probe([44]);
    handleNpcSystemEvent(p, Fact.KINGPIN_KNOWS_MONEY_GONE);
    p.facts.add(Fact.KINGPIN_KNOWS_MONEY_GONE);
    handleNpcSystemEvent(p, Fact.KINGPIN_KNOWS_MONEY_GONE);
    handleNpcSystemEvent(p, Fact.KINGPIN_KNOWS_MONEY_GONE);
    expect(p.log).toEqual(['kingpinCheck false', 'letter', 'random 120', `future 44 ${Fact.KINGPIN_KNOWS_MONEY_GONE} 2`, 'kingpinHostile']);
    expect(p.quests.get(Quest.KINGPIN_MONEY)).toBe(1);
    expect(p.facts.has(Fact.KINGPIN_CAN_SEND_ASSASSINS)).toBe(true);
    expect(p.profile(Npc.SPIKE)).toMatchObject({ sectorX: 5, sectorY: 3 });
  });

  it('retries Joey’s move every hour while his sector is loaded', () => {
    const p = probe();
    Object.assign(p.profile(Npc.JOEY) as ProfileProgress, { sectorX: 4, sectorY: 4, sectorZ: 1 });
    p.joeyHere = true;
    handleNpcSystemEvent(p, BONUS + A.ADD_JOEY_TO_WORLD);
    expect(p.log).toEqual([`today 660 ${BONUS + A.ADD_JOEY_TO_WORLD}`]);
    p.joeyHere = false;
    handleNpcSystemEvent(p, BONUS + A.ADD_JOEY_TO_WORLD);
    expect(p.profile(Npc.JOEY)).toMatchObject({ sectorX: 5, sectorY: 3, sectorZ: 0 });
  });

  it('readies the second robot at full life in Madlab’s sector', () => {
    const p = probe([], [Fact.FIRST_ROBOT_DESTROYED]);
    Object.assign(p.profile(Npc.MADLAB) as ProfileProgress, { sectorX: 7, sectorY: 8, sectorZ: 0 });
    Object.assign(p.profile(Npc.ROBOT) as ProfileProgress, { life: 0, mercStatus: MercStatus.IS_DEAD });
    handleNpcSystemEvent(p, BONUS + A.READY_ROBOT);
    expect(p.facts.has(Fact.ROBOT_READY_SECOND_TIME)).toBe(true);
    expect(p.profile(Npc.ROBOT)).toMatchObject({ sectorX: 7, sectorY: 8, mercStatus: MercStatus.OK });
  });

  it('sets the plain facts and runs Madame’s action for the girls', () => {
    const p = probe();
    handleNpcSystemEvent(p, Fact.FACT_24_HOURS_SINCE_JOEY_RESCUED);
    handleNpcSystemEvent(p, BONUS + A.SET_DELAY_TILL_GIRLS_AVAILABLE);
    handleNpcSystemEvent(p, BONUS + A.FREE_KIDS);
    handleNpcSystemEvent(p, Fact.PABLOS_BRIBED);
    expect([...p.facts]).toEqual([Fact.FACT_24_HOURS_SINCE_JOEY_RESCUED, Fact.KIDS_ARE_FREE]);
    expect(p.log).toEqual([`action ${Npc.MADAME} ${A.SET_GIRLS_AVAILABLE}`]);
  });

  it('ends the food quest only while Father lives', () => {
    const p = probe();
    handleNpcSystemEvent(p, BONUS + A.TRIGGER_END_OF_FOOD_QUEST);
    expect([p.quests.get(Quest.FOOD_ROUTE), p.facts.has(Fact.FOOD_QUEST_OVER)]).toEqual([2, true]);
  });
});

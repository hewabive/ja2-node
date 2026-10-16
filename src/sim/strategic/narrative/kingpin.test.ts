import { describe, expect, it } from 'vitest';
import { testProfile } from '../../../../tests/support/narrative.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import { Fact } from './fact-ids.ts';
import { NarrativeHistory } from './history-codes.ts';
import { checkForKingpinsMoneyMissing, type KingpinMoneyContext } from './kingpin.ts';

interface Probe extends KingpinMoneyContext {
  money: number;
  readonly facts: Set<number>;
  readonly log: string[];
  readonly profile: ProfileProgress;
}

function probe(money: number, facts: number[] = [], draws: number[] = [37]): Probe {
  const profile = testProfile(86);
  const p: Probe = {
    money,
    facts: new Set(facts),
    log: [],
    profile,
    worldMoney: () => p.money,
    removeAllWorldMoney: () => {
      p.money = 0;
      p.log.push('removed');
    },
    checkFact: (id) => p.facts.has(id),
    setFactTrue: (id) => p.facts.add(id),
    history: (code) => p.log.push(`history ${code}`),
    worldSector: () => ({ x: 5, y: 4, z: 1 }),
    addFutureDayNpcEvent: (minute, param, days) => p.log.push(`event ${minute} ${param} ${days}`),
    random: () => draws.shift() ?? 0,
    kingpin: () => profile,
  };
  return p;
}

describe('Kingpin’s money', () => {
  it('learns on leaving with less than 30000, sets the debt and takes the rest of the cash', () => {
    const p = probe(12000);
    checkForKingpinsMoneyMissing(p, true);
    expect(p.log).toEqual([`history ${NarrativeHistory.FOUND_MONEY}`, `event 37 ${Fact.KINGPIN_KNOWS_MONEY_GONE} 1`, 'removed']);
    expect(p.facts.has(Fact.KINGPIN_WILL_LEARN_OF_MONEY_GONE)).toBe(true);
    expect(p.profile.balance).toBe(-18000);
  });

  it('does nothing twice and nothing with the money in place', () => {
    const p = probe(0, [Fact.KINGPIN_WILL_LEARN_OF_MONEY_GONE]);
    checkForKingpinsMoneyMissing(p, true);
    const full = probe(30000);
    checkForKingpinsMoneyMissing(full, true);
    expect([p.log, full.log]).toEqual([[], []]);
  });

  it('notes the theft but stays quiet when Kingpin is dead', () => {
    const p = probe(0, [Fact.KINGPIN_DEAD]);
    checkForKingpinsMoneyMissing(p, true);
    expect(p.log).toEqual([`history ${NarrativeHistory.FOUND_MONEY}`]);
  });

  it('finds out on the later check from whatever world is loaded', () => {
    const p = probe(29999);
    checkForKingpinsMoneyMissing(p, false);
    expect(p.facts.has(Fact.KINGPIN_KNOWS_MONEY_GONE)).toBe(true);
    expect(p.log).toEqual([`event 37 ${Fact.KINGPIN_KNOWS_MONEY_GONE} 2`]);
    const rich = probe(30000);
    checkForKingpinsMoneyMissing(rich, false);
    expect(rich.facts.size).toBe(0);
  });
});

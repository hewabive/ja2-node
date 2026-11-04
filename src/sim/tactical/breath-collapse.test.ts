import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { checkForBreathCollapse, resetLowBreathWarning } from './breath-collapse.ts';
import type { TacticalContent } from './content.ts';
import { MercQuote, QuoteSaidFlag } from './narrative/merc-quotes.ts';
import { NO_NARRATIVE_PORT, type QuoteSaidRecord } from './narrative/port.ts';
import { Team } from './soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('the breath collapse check (Soldier_Control.cc CheckForBreathCollapse)', () => {
  it('warns once while a standing merc with a big breath pool is below 20 breath, until a turn starts with him above 80', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const said: number[] = [];
    const record: QuoteSaidRecord = { quoteSaidFlags: 0, quoteSaidExtFlags: 0 };
    t.narrative = { ...NO_NARRATIVE_PORT, sayQuote: (_, quote) => said.push(quote), quoteSaidFlags: () => record };
    merc.breathMax = 100;
    merc.breath = 19;
    expect(checkForBreathCollapse(t, merc)).toBe(false);
    checkForBreathCollapse(t, merc);
    expect([said, record.quoteSaidFlags]).toEqual([[MercQuote.OUT_OF_BREATH], QuoteSaidFlag.LOW_BREATH]);
    merc.breath = 81;
    resetLowBreathWarning(t, merc);
    merc.breath = 19;
    checkForBreathCollapse(t, merc);
    expect(said).toEqual([MercQuote.OUT_OF_BREATH, MercQuote.OUT_OF_BREATH]);
  });

  it('marks a soldier at 0 breath to collapse, but not one already collapsed nor an animal or a monster', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    merc.breath = 0;
    expect([checkForBreathCollapse(t, merc), merc.breathCollapsed]).toEqual([true, true]);
    merc.collapsed = true;
    expect(checkForBreathCollapse(t, merc)).toBe(false);
    merc.collapsed = false;
    merc.monsterOrAnimal = true;
    expect(checkForBreathCollapse(t, merc)).toBe(false);
  });
});

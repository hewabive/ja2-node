import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { moveSoldierFromMercToAwaySlot } from '../away-slots.ts';
import type { TacticalContent } from '../content.ts';
import { CivilianGroup, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { SectorRef, TacticalState } from '../state.ts';
import { handleShopKeepHasBeenShutDown, handleVictoryInNpcSector, type ShopKeepScript } from './keith-business.ts';
import { NO_NARRATIVE_PORT } from './port.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const F10 = parseSectorString('F10');
const F10_BASEMENT = parseSectorString('F10', 1);
const NORTH = 0;
const HICK_TILE = 12_000;
const DYING = 5;

interface FactLog {
  readonly facts: Map<number, boolean>;
  readonly asked: [number, number][];
  readonly records: [number, number][];
}

function factLog(initial: Readonly<Record<number, boolean>> = {}): FactLog {
  return { facts: new Map(Object.entries(initial).map(([id, on]) => [Number(id), on])), asked: [], records: [] };
}

function script(log: FactLog): ShopKeepScript {
  return {
    fact: (id, profile) => {
      log.asked.push([id, profile ?? 0]);
      return log.facts.get(id) === true;
    },
    triggerNpcRecord: (profile, record) => log.records.push([profile, record]),
  };
}

type HickFate = (t: TacticalState, s: Soldier) => void;

const killed: HickFate = (_, s) => {
  s.life = 0;
};
const dying: HickFate = (_, s) => {
  s.life = DYING;
};
const scheduledAway: HickFate = (t, s) => moveSoldierFromMercToAwaySlot(t, s);

function victory(log: FactLog, sector: SectorRef, hick?: HickFate) {
  const sim = newCombatSim(content);
  sim.state.narrative = {
    ...NO_NARRATIVE_PORT,
    ...script(log),
    setFactTrue: (id) => log.facts.set(id, true),
    setFactFalse: (id) => log.facts.set(id, false),
  };
  if (hick) {
    const s = spawnSoldier(sim, TEAM_FIRST_ID[Team.CIV], Team.CIV, HICK_TILE, NORTH);
    s.civilianGroup = CivilianGroup.HICKS;
    hick(sim.state, s);
  }
  handleVictoryInNpcSector(sim.state, sector);
  return sim;
}

describe('a won battle in an NPC sector (NPC.cc HandleVictoryInNPCSector, called at Overhead.cc:4682)', () => {
  it('records the hillbillies dead and puts Keith back in business after a victory on the surface of F10 with no hick alive', () => {
    const log = factLog({ [Fact.KEITH_OUT_OF_BUSINESS]: true });
    victory(log, F10, killed);
    expect(log.facts.get(Fact.HILLBILLIES_KILLED)).toBe(true);
    expect(log.facts.get(Fact.KEITH_OUT_OF_BUSINESS)).toBe(false);
    expect(log.asked).toEqual([
      [Fact.HILLBILLIES_KILLED, Npc.KEITH],
      [Fact.KEITH_OUT_OF_BUSINESS, Npc.KEITH],
    ]);
  });

  it('leaves both facts while a hick of the civilian team lives, even a dying one or one scheduled off the map', () => {
    for (const keep of [dying, scheduledAway]) {
      const log = factLog({ [Fact.KEITH_OUT_OF_BUSINESS]: true });
      victory(log, F10, keep);
      expect(log.facts.get(Fact.HILLBILLIES_KILLED)).toBeUndefined();
      expect(log.facts.get(Fact.KEITH_OUT_OF_BUSINESS)).toBe(true);
    }
  });

  it('does nothing in the basement of F10 or in any other sector', () => {
    for (const sector of [F10_BASEMENT, parseSectorString('F9')]) {
      const log = factLog({ [Fact.KEITH_OUT_OF_BUSINESS]: true });
      victory(log, sector);
      expect([...log.facts]).toEqual([[Fact.KEITH_OUT_OF_BUSINESS, true]]);
      expect(log.asked).toEqual([]);
    }
  });
});

describe("Keith's shop asked before NPC_ACTION_INITIATE_SHOPKEEPER_INTERFACE opens it (NPC.cc HandleShopKeepHasBeenShutDown)", () => {
  it('plays record 11 and keeps the shop shut while Keith is out of business, without asking his loyalty', () => {
    const log = factLog({ [Fact.KEITH_OUT_OF_BUSINESS]: true, [Fact.LOYALTY_LOW]: true });
    expect(handleShopKeepHasBeenShutDown(script(log), Npc.KEITH)).toBe(true);
    expect(log.records).toEqual([[Npc.KEITH, 11]]);
    expect(log.asked).toEqual([[Fact.KEITH_OUT_OF_BUSINESS, Npc.KEITH]]);
  });

  it("plays record 7 and keeps the shop shut when Keith's town loyalty is low", () => {
    const log = factLog({ [Fact.LOYALTY_LOW]: true });
    expect(handleShopKeepHasBeenShutDown(script(log), Npc.KEITH)).toBe(true);
    expect(log.records).toEqual([[Npc.KEITH, 7]]);
    expect(log.asked).toEqual([
      [Fact.KEITH_OUT_OF_BUSINESS, Npc.KEITH],
      [Fact.LOYALTY_LOW, Npc.KEITH],
    ]);
  });

  it('lets Keith in business with loyalty above low open his shop, and never shuts another dealer', () => {
    const open = factLog();
    expect(handleShopKeepHasBeenShutDown(script(open), Npc.KEITH)).toBe(false);
    const other = factLog({ [Fact.KEITH_OUT_OF_BUSINESS]: true, [Fact.LOYALTY_LOW]: true });
    expect(handleShopKeepHasBeenShutDown(script(other), Npc.FRANZ)).toBe(false);
    expect([open.records, other.records, other.asked]).toEqual([[], [], []]);
  });
});

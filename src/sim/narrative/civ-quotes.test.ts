import { describe, expect, it } from 'vitest';
import { type FakeHost, type FakeHostOptions, fakeHost, recordArray, testSoldier } from '../../../tests/support/narrative.ts';
import { QuoteFlag } from '../../content/formats/npc.ts';
import { CivQuote, MINERS_CIV_QUOTE_INDEX } from '../../content/narrative/npc-constants.ts';
import { civQuoteRecordPath } from '../../content/narrative/npc-records.ts';
import { Fact } from '../strategic/narrative/fact-ids.ts';
import { AiAction } from '../tactical/ai/actions.ts';
import { Body, CivilianGroup, NO_CIV_QUOTE, NO_PROFILE, type Soldier, SoldierClass, TEAM_FIRST_ID, Team } from '../tactical/soldier.ts';
import { considerCivilianQuotes, determineCivQuoteEntry, startCivQuote, TownId } from './civ-quotes.ts';

const CIV_ID = TEAM_FIRST_ID[Team.CIV] + 2;
const TILE = 12000;
const DRASSEN = 2;
const C13 = { x: 13, y: 3, z: 0 };
const C13_HINT_FILE = 3;
const F10 = { x: 10, y: 6, z: 0 };
const L12 = { x: 12, y: 12, z: 0 };
const HINT_QUEST = 7;
const HINT_QUOTE = 4;

function civilian(fields: Partial<Soldier> = {}, team: number = Team.CIV): Soldier {
  return Object.assign(testSoldier(CIV_ID, team, NO_PROFILE, TILE), fields);
}

function host(civ: Soldier, options: FakeHostOptions = {}): FakeHost {
  return fakeHost({ soldiers: [civ], town: DRASSEN, townRating: 50, sector: C13, ...options });
}

const quoteOf = (h: FakeHost, civ: Soldier, hints = true) => determineCivQuoteEntry(h, civ, hints).quote;

describe('determineCivQuoteEntry', () => {
  it('picks the enemy lines by action, life and class', () => {
    const enemy = civilian({ bodyType: Body.REGMALE }, Team.ENEMY);
    const h = host(enemy);
    enemy.ai.action = AiAction.FIRE_GUN;
    expect(quoteOf(h, enemy)).toBe(CivQuote.ENEMY_THREAT);
    enemy.ai.action = AiAction.OFFER_SURRENDER;
    expect(quoteOf(h, enemy)).toBe(CivQuote.ENEMY_OFFER_SURRENDER);
    enemy.ai.action = AiAction.NONE;
    enemy.life = 29;
    expect(quoteOf(h, enemy)).toBe(CivQuote.ENEMY_HURT);
    enemy.life = 30;
    Object.assign(enemy, { soldierClass: SoldierClass.ELITE });
    expect(quoteOf(h, enemy)).toBe(CivQuote.ENEMY_ELITE);
    Object.assign(enemy, { soldierClass: SoldierClass.ARMY });
    expect(quoteOf(h, enemy)).toBe(CivQuote.ENEMY_ADMIN);
  });

  it('gives the married woman of F10, the hicks and the goons their own lines before cowering', () => {
    const wife = civilian({ bodyType: Body.REGFEMALE });
    expect(quoteOf(host(wife, { sector: F10 }), wife)).toBe(CivQuote.PC_MARRIED);
    const hick = civilian({ civilianGroup: CivilianGroup.HICKS, cowering: true });
    expect(quoteOf(host(hick), hick)).toBe(CivQuote.HICKS_FRIENDLY);
    hick.neutral = false;
    expect(quoteOf(host(hick), hick)).toBe(CivQuote.HICKS_ENEMIES);
    const goon = civilian({ civilianGroup: CivilianGroup.KINGPIN, neutral: false });
    expect(quoteOf(host(goon), goon)).toBe(CivQuote.GOONS_ENEMIES);
  });

  it('cowers when cowering or when a civilian talks during combat', () => {
    const kid = civilian({ bodyType: Body.KIDCIV, cowering: true });
    expect(quoteOf(host(kid), kid)).toBe(CivQuote.KIDS_COWER);
    const adult = civilian();
    expect(quoteOf(host(adult, { inCombat: true }), adult)).toBe(CivQuote.ADULTS_COWER);
    const militia = civilian({ soldierClass: SoldierClass.GREEN_MILITIA } as Partial<Soldier>, Team.MILITIA);
    expect(quoteOf(host(militia, { inCombat: true }), militia)).toBe(CivQuote.GREEN_MILITIA);
  });

  it('follows the group rules for factory kids, beggars and rebels', () => {
    const kid = civilian({ bodyType: Body.KIDCIV, civilianGroup: CivilianGroup.FACTORY_KIDS });
    expect(quoteOf(host(kid, { facts: { [Fact.DOREEN_ALIVE]: true } }), kid)).toBe(CivQuote.KID_SLAVES);
    expect(quoteOf(host(kid), kid)).toBe(CivQuote.KID_SLAVES_FREE);
    const beggar = civilian({ civilianGroup: CivilianGroup.BEGGARS });
    expect(quoteOf(host(beggar, { town: TownId.SAN_MONA }), beggar)).toBe(CivQuote.SAN_MONA_BEGGERS);
    expect(quoteOf(host(beggar, { town: TownId.SAN_MONA, sector: { x: 5, y: 4, z: 1 } }), beggar)).toBe(CivQuote.ADULTS_BEGGING);
    const rebelKid = civilian({ bodyType: Body.HATKIDCIV, civilianGroup: CivilianGroup.REBEL });
    expect(quoteOf(host(rebelKid), rebelKid)).toBe(CivQuote.KIDS_REBELS);
  });

  it('lets militia classes speak and other militia fall through to the town lines', () => {
    const regular = civilian({ soldierClass: SoldierClass.REG_MILITIA } as Partial<Soldier>, Team.MILITIA);
    expect(quoteOf(host(regular), regular)).toBe(CivQuote.MEDIUM_MILITIA);
    const odd = civilian({ soldierClass: SoldierClass.NONE } as Partial<Soldier>, Team.MILITIA);
    expect(quoteOf(host(odd, { townRating: 90 }), odd)).toBe(CivQuote.ADULTS_HIGH_LOYALTY);
  });

  it('uses the loyalty of a surface town that uses loyalty: below 20 low, from 80 high', () => {
    const adult = civilian();
    const kid = civilian({ bodyType: Body.KIDCIV });
    expect(quoteOf(host(adult, { townRating: 19 }), adult)).toBe(CivQuote.ADULTS_EXTREMLY_LOW_LOYALTY);
    expect(quoteOf(host(kid, { townRating: 19 }), kid)).toBe(CivQuote.KIDS_EXTREMLY_LOW_LOYALTY);
    expect(quoteOf(host(adult, { townRating: 20 }), adult)).toBe(CivQuote.ADULTS_ALL_PURPOSE);
    expect(quoteOf(host(kid, { townRating: 80 }), kid)).toBe(CivQuote.KIDS_HIGH_LOYALTY);
    expect(quoteOf(host(adult, { townRating: 90, townUsesLoyalty: false }), adult)).toBe(CivQuote.ADULTS_ALL_PURPOSE);
    expect(quoteOf(host(adult, { townRating: 90, sector: { x: 13, y: 3, z: 1 } }), adult)).toBe(CivQuote.ADULTS_ALL_PURPOSE);
  });

  it('speaks of the dead queen in Meduna, even underground', () => {
    const adult = civilian();
    const h = host(adult, { town: TownId.MEDUNA, sector: { x: 3, y: 15, z: 1 }, facts: { [Fact.QUEEN_DEAD]: true } });
    expect(quoteOf(h, adult)).toBe(CivQuote.DEIDRANNA_DEAD);
  });

  it('gives miners their mine lines when there is no hint', () => {
    const miner = civilian({ soldierClass: SoldierClass.MINER } as Partial<Soldier>);
    expect(quoteOf(host(miner, { sector: { x: 2, y: 3, z: 0 } }), miner)).toBe(CivQuote.MINERS_NOT_FOR_PLAYER);
    expect(quoteOf(host(miner, { sector: { x: 2, y: 3, z: 0 }, mineControlled: true }), miner)).toBe(CivQuote.MINERS_FOR_PLAYER);
  });
});

describe('civilian hints', () => {
  const hints = () => recordArray({ 0: { approachRequired: 0, opinionRequired: 0, quoteNum: HINT_QUOTE, startQuest: HINT_QUEST } });

  it('offers the first usable hint of the sector, starting its quest on every ask while unsaid', () => {
    const adult = civilian();
    const h = host(adult, { civilian: { [C13_HINT_FILE]: hints() } });
    expect(considerCivilianQuotes(h, C13, false)).toBe(HINT_QUOTE);
    expect(h.questLog).toEqual([['start', HINT_QUEST]]);
    const said = startCivQuote(h, adult);
    expect(said).toMatchObject({ quote: CivQuote.HINT, entry: HINT_QUOTE, hint: true });
    expect(said?.textKey).toEqual({ file: 'npcdata/C13.edt', row: HINT_QUOTE, width: 160 });
    expect(h.questLog.length).toBe(3);
    expect((h.records.civilian[C13_HINT_FILE]?.[0]?.flags ?? 0) & QuoteFlag.SAID).toBe(QuoteFlag.SAID);
    expect([adult.currentCivQuote, adult.currentCivQuoteDelta]).toEqual([CivQuote.HINT, HINT_QUOTE]);
  });

  it('never offers a hint twice in a row to the same civilian', () => {
    const adult = civilian();
    const h = host(adult, { civilian: { [C13_HINT_FILE]: hints() } });
    startCivQuote(h, adult);
    const next = startCivQuote(h, adult);
    expect(next?.quote).toBe(CivQuote.ADULTS_ALL_PURPOSE);
  });

  it('keeps the hint from kids but still starts its quest', () => {
    const kid = civilian({ bodyType: Body.KIDCIV });
    const h = host(kid, { civilian: { [C13_HINT_FILE]: hints() } });
    expect(startCivQuote(h, kid)?.quote).toBe(CivQuote.KIDS_ALL_PURPOSE);
    expect(h.questLog).toEqual([['start', HINT_QUEST]]);
    expect((h.records.civilian[C13_HINT_FILE]?.[0]?.flags ?? 0) & QuoteFlag.SAID).toBe(0);
  });

  it('drops a hint at low loyalty on Random(100) < 25, and draws only when a hint exists', () => {
    const adult = civilian();
    const dropped = host(adult, { townRating: 10, civilian: { [C13_HINT_FILE]: hints() }, draws: [24] });
    expect(quoteOf(dropped, adult)).toBe(CivQuote.ADULTS_EXTREMLY_LOW_LOYALTY);
    expect(dropped.drawsTaken).toEqual([100]);
    const kept = host(adult, { townRating: 10, civilian: { [C13_HINT_FILE]: hints() }, draws: [25] });
    expect(quoteOf(kept, adult)).toBe(CivQuote.HINT);
    const none = host(adult, { townRating: 10 });
    expect(quoteOf(none, adult)).toBe(CivQuote.ADULTS_EXTREMLY_LOW_LOYALTY);
    expect(none.drawsTaken).toEqual([]);
  });

  it('gives L12’s civilians the miners’ hint records, as the sector table’s L12 entry is the miners’ index, with L12’s own text', () => {
    const adult = civilian();
    const minersHints = recordArray({ 0: { approachRequired: 0, opinionRequired: 0, quoteNum: HINT_QUOTE } });
    const h = host(adult, { sector: L12, civilian: { [MINERS_CIV_QUOTE_INDEX]: minersHints } });
    expect(civQuoteRecordPath(MINERS_CIV_QUOTE_INDEX)).toBe('npcdata/miners.npc');
    expect(startCivQuote(h, adult)?.textKey).toEqual({ file: 'npcdata/L12.edt', row: HINT_QUOTE, width: 160 });
  });

  it('reads the miners file underground', () => {
    const adult = civilian();
    const miners = recordArray({ 1: { approachRequired: 0, opinionRequired: 255, quoteNum: 9 } });
    const h = host(adult, { sector: { x: 13, y: 3, z: 1 }, civilian: { 16: miners } });
    const said = startCivQuote(h, adult);
    expect(said?.textKey).toEqual({ file: 'npcdata/civ35.edt', row: 9, width: 160 });
  });
});

describe('startCivQuote', () => {
  it('picks a base entry once on the cosmetic stream and alternates the delta', () => {
    const adult = civilian();
    const h = host(adult);
    const first = startCivQuote(h, adult);
    const base = adult.currentCivQuote;
    expect(base).toBeGreaterThanOrEqual(0);
    expect(base).toBeLessThan(13);
    const second = startCivQuote(h, adult);
    const third = startCivQuote(h, adult);
    expect([first?.entry, second?.entry, third?.entry]).toEqual([base, base + 1, base]);
    expect(first?.textKey.file).toBe('npcdata/civ10.edt');
    expect(h.drawsTaken).toEqual([]);
    expect(h.emitted.filter((e) => e.type === 'civQuote')).toHaveLength(3);
  });

  it('shows nothing without text but still advances the entry', () => {
    const adult = civilian();
    const h = host(adult, { chars: () => 0 });
    expect(startCivQuote(h, adult)).toBeNull();
    expect(adult.currentCivQuote).not.toBe(NO_CIV_QUOTE);
    expect(adult.currentCivQuoteDelta).toBe(1);
    expect(h.emitted).toEqual([]);
  });
});

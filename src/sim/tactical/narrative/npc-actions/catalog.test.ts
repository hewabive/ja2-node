import { describe, expect, it } from 'vitest';
import { recordArray, testSoldier } from '../../../../../tests/support/narrative.ts';
import { type FakeActionEnv, type FakeActionEnvOptions, fakeActionEnv } from '../../../../../tests/support/npc-actions.ts';
import { NUM_NPC_QUOTE_RECORDS } from '../../../../content/formats/npc.ts';
import { Approach } from '../../../../content/narrative/npc-constants.ts';
import { Fact, Quest } from '../../../strategic/narrative/fact-ids.ts';
import { NarrativeHistory } from '../../../strategic/narrative/history-codes.ts';
import { HospitalPrice } from '../../../strategic/narrative/hospital.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { ExperienceBonus } from '../../../strategic/narrative/rewards.ts';
import { type Soldier, TEAM_FIRST_ID, Team } from '../../soldier.ts';
import { handleNpcDoAction } from './catalog.ts';
import { NpcActionCode as A, NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS as BONUS } from './codes.ts';

const TRIGGERED_NPCS = [
  Npc.MADAME,
  Npc.FATHER,
  Npc.VINCE,
  Npc.STEVE,
  Npc.CARMEN,
  Npc.ANGEL,
  Npc.MARIA,
  Npc.KINGPIN,
  Npc.DARREN,
  Npc.SPIKE,
  Npc.WALTER,
  Npc.MATT,
  Npc.SERGEANT,
  Npc.YANNI,
  Npc.MICKY,
  Npc.QUEEN,
  Npc.ELLIOT,
  Npc.MADLAB,
  Npc.JOHN,
  Npc.MARY,
  Npc.JOE,
];

function triggerable(): Record<number, ReturnType<typeof recordArray>> {
  const all = Object.fromEntries(Array.from({ length: NUM_NPC_QUOTE_RECORDS }, (_, i) => [i, { approachRequired: Approach.TRIGGER_NPC }]));
  return Object.fromEntries(TRIGGERED_NPCS.map((npc) => [npc, recordArray(all)]));
}

function env(options: FakeActionEnvOptions = {}): FakeActionEnv {
  return fakeActionEnv({ scripts: triggerable(), ...options });
}

function triggered(e: FakeActionEnv): [number, number][] {
  return e.host.talk.queue.flatMap((q) => (q.kind === 'triggerNpc' ? [[q.npc, q.record] as [number, number]] : []));
}

function place(e: FakeActionEnv, ...soldiers: Soldier[]): void {
  const t = e.host.tactical();
  for (const s of soldiers) if (t) t.soldiers[s.id] = s;
}

function run(e: FakeActionEnv, npc: number, code: number, record = 0): boolean {
  return handleNpcDoAction(e, npc, code, record);
}

const UNHANDLED: ReadonlySet<number> = new Set([
  A.NONE,
  A.PENALIZE_TOWN_LOYALTY,
  A.SET_PABLO_BRIBE_DELAY,
  A.DARREN_GIVEN_CASH,
  A.ANGEL_GIVEN_CASH,
  A.TELEPORT_NPC,
  A.GERARD_GIVEN_CASH,
  A.JOE_GIVEN_CASH,
  A.TRIGGER_ELLIOT_9_OR_10,
  A.KINGPIN_GIVEN_MONEY,
  A.LAST_TURN_TO_FACE_PROFILE,
]);

describe('the catalog', () => {
  it('handles every code of the switch and only logs the ones the original leaves out', () => {
    const strategic = (): FakeActionEnv => {
      const e = env();
      return { ...e, host: { ...e.host, tactical: () => null } };
    };
    const missing = Object.entries(A).filter(([, code]) => !UNHANDLED.has(code) && !run(strategic(), Npc.MADAME, code));
    expect(missing).toEqual([]);
    for (const code of UNHANDLED) expect(run(strategic(), Npc.MADAME, code)).toBe(false);
  });
});

describe('generic actions', () => {
  it('handles every code of the switch and ignores the ones the original only logs', () => {
    const e = env();
    for (const code of [
      A.DONT_ACCEPT_ITEM,
      A.STOP_PLAYER_GIVING_FIRST_AID,
      A.SEND_SOLDIERS_TO_DRASSEN,
      A.REMOVE_CONRAD,
      A.CHECK_DOCTORING_MONEY_GIVEN,
    ])
      expect(run(e, Npc.MADAME, code)).toBe(true);
    for (const code of [A.PENALIZE_TOWN_LOYALTY, A.SET_PABLO_BRIBE_DELAY, A.DARREN_GIVEN_CASH, A.TELEPORT_NPC, A.KINGPIN_GIVEN_MONEY])
      expect(run(e, Npc.MADAME, code)).toBe(false);
  });

  it('grants experience, writes history lines and boosts loyalty', () => {
    const e = env();
    run(e, Npc.MADAME, A.GRANT_EXPERIENCE_3);
    run(e, Npc.MADAME, A.HISTORY_KINGPIN_MONEY);
    run(e, Npc.MADAME, A.HISTORY_ASSASSIN);
    run(e, Npc.MADAME, A.BOOST_TOWN_LOYALTY);
    run(e, Npc.MADAME, A.SHOW_TIXA);
    expect(e.calls).toEqual([`experience ${ExperienceBonus.AVERAGE}`, `loyalty ${Npc.MADAME}`, 'townFound 5']);
    expect(e.histories).toEqual([
      [NarrativeHistory.KINGPIN_MONEY, 0],
      [NarrativeHistory.ASSASSIN, 0],
      [NarrativeHistory.DISCOVERED_TIXA, 0],
    ]);
  });

  it('adds drinks with an INT8 wrap and makes bartenders', () => {
    const e = env({ profiles: { [Npc.MADAME]: { npcData: 126 } } });
    run(e, Npc.MADAME, A.DRINK_WINE);
    expect(e.host.profile(Npc.MADAME)?.npcData).toBe(-128);
    run(e, Npc.MADAME, A.MAKE_NPC_THIRD_BARTENDER);
    expect(e.host.profile(Npc.MADAME)?.npcData).toBe(3);
  });

  it('reports the balance owed, recruits for free and refuses a full team', () => {
    const e = env({ profiles: { [Npc.WALTER]: { balance: -250, salary: 500 } } });
    run(e, Npc.WALTER, A.REPORT_BALANCE);
    run(e, Npc.WALTER, A.RECRUIT);
    expect(e.host.profile(Npc.WALTER)?.salary).toBe(0);
    e.teamFull = true;
    run(e, Npc.WALTER, A.RECRUIT_WITH_SALARY);
    expect(e.messages).toEqual([
      ['balanceOwed', Npc.WALTER, 250],
      ['recruited', Npc.WALTER, undefined],
      ['teamFull', Npc.WALTER, undefined],
    ]);
    expect(e.calls).toEqual([`recruitRpc ${Npc.WALTER}`]);
  });

  it('makes Manny stationary at the parameter gridno with a permanent insertion code', () => {
    const e = env({ profiles: { [Npc.MANNY]: {} }, params: { [A.CHANGE_MANNY_POSITION]: { gridNo: 1234 } } });
    run(e, Npc.MANNY, A.CHANGE_MANNY_POSITION);
    expect(e.host.profile(Npc.MANNY)).toMatchObject({ useProfileInsertion: true, insertionCode: 4, insertionData: 1234 });
    expect((e.host.profile(Npc.MANNY)?.miscFlags3 ?? 0) & 0x02).toBe(0x02);
  });

  it('reveals a terrorist by writing his name over the nickname', () => {
    const e = env({ profiles: { [Npc.ANNIE]: {} } });
    run(e, Npc.ANNIE, A.TERRORIST_REVEALS_SELF);
    expect(e.host.profile(Npc.ANNIE)?.nickname).toBe(`Name${Npc.ANNIE}`);
    expect(e.presented).toEqual([['terroristRevealed', Npc.ANNIE]]);
  });

  it('remembers who to say something about later', () => {
    const e = env();
    const dest = testSoldier(TEAM_FIRST_ID[Team.CIV], Team.CIV, Npc.ANGEL, 100);
    place(e, dest);
    e.host.context.dest = dest.id;
    run(e, Npc.ANGEL, A.PLAYER_SAYS_NASTY_LATER);
    expect(e.host.talk.nastyNpc).toBe(Npc.ANGEL);
    expect(e.fake.facts.values.get(Fact.NEED_TO_SAY_SOMETHING)).toBe(true);
  });
});

describe('rebels, Drassen and the airport', () => {
  it('ends the food quest tomorrow at the same minute and walks Father’s chain', () => {
    const e = env({ minute: 777, facts: { [Fact.FACT_132]: true, [Fact.FACT_133]: true } });
    run(e, Npc.FATHER, A.TRIGGER_END_OF_FOOD_QUEST);
    run(e, Npc.FATHER, A.TRIGGER_FATHER_18_20_OR_15);
    expect(e.events).toEqual([{ kind: 'futureDay', minute: 777, param: BONUS + A.TRIGGER_END_OF_FOOD_QUEST, days: 1 }]);
    expect(e.histories).toEqual([[NarrativeHistory.TALKED_TO_FATHER_WALKER, 0]]);
    expect(triggered(e)).toEqual([[Npc.FATHER, 15]]);
  });

  it('draws Enrico’s mail minute and Pablo’s return minute', () => {
    const e = env({ draws: [17, 59] });
    run(e, Npc.MIGUEL, A.SEND_ENRICO_MIGUEL_EMAIL);
    run(e, Npc.PABLO, A.RETURN_STOLEN_SHIPMENT_ITEMS);
    expect(e.events).toEqual([
      { kind: 'futureDay', minute: 407, param: BONUS + A.SEND_ENRICO_MIGUEL_EMAIL, days: 1 },
      { kind: 'futureDay', minute: 539, param: BONUS + A.RETURN_STOLEN_SHIPMENT_ITEMS, days: 1 },
    ]);
    expect(e.fake.drawsTaken).toEqual([60, 60]);
  });

  it('reports the shipment size and draws twice only when Pablo is bribed', () => {
    const quiet = env({ facts: { [Fact.LARGE_SIZED_SHIPMENT_WAITING]: true } });
    quiet.host.talk.charNum = Npc.PABLO;
    run(quiet, Npc.PABLO, A.REPORT_SHIPMENT_SIZE);
    expect(quiet.host.talk.queue.map((q) => (q.kind === 'quote' ? q.quote : -1))).toEqual([15]);
    expect(quiet.fake.drawsTaken).toEqual([]);
    const bribed = env({ facts: { [Fact.PABLOS_BRIBED]: true }, draws: [74, 75] });
    run(bribed, Npc.PABLO, A.REPORT_SHIPMENT_SIZE);
    expect(bribed.host.talk.queue.map((q) => (q.kind === 'quote' ? q.quote : -1))).toEqual([13, 16]);
    expect(bribed.fake.drawsTaken).toEqual([100, 100]);
  });

  it('posts the package timers as fact and action events', () => {
    const e = env({ minute: 100 });
    run(e, Npc.PABLO, A.SET_DELAYED_PACKAGE_TIMER);
    run(e, Npc.PABLO, A.SET_RANDOM_PACKAGE_DAMAGE_TIMER);
    expect(e.events.map((x) => x.param)).toEqual([Fact.SHIPMENT_DELAYED_24_HOURS, BONUS + A.SET_RANDOM_PACKAGE_DAMAGE_TIMER]);
  });
});

describe('San Mona', () => {
  it('draws the girls’ availability in order', () => {
    const e = env({ draws: [0, 1, 0] });
    run(e, Npc.MADAME, A.SET_GIRLS_AVAILABLE);
    const f = e.fake.facts.values;
    expect([f.get(Fact.CARLA_AVAILABLE), f.get(Fact.CINDY_AVAILABLE), f.get(Fact.BAMBI_AVAILABLE)]).toEqual([false, true, false]);
    expect(f.get(Fact.NO_GIRLS_AVAILABLE)).toBe(false);
    expect(e.fake.drawsTaken).toEqual([3, 2, 2]);
  });

  it('delays the girls by one or two minutes', () => {
    const e = env({ minute: 500, draws: [1] });
    run(e, Npc.MADAME, A.SET_DELAY_TILL_GIRLS_AVAILABLE);
    expect(e.events).toEqual([{ kind: 'sameDay', minute: 502, param: BONUS + A.SET_DELAY_TILL_GIRLS_AVAILABLE }]);
  });

  it('continues after "no girls" and advertises both Cindy and Bambi', () => {
    const e = env({ facts: { [Fact.NO_GIRLS_AVAILABLE]: true, [Fact.CINDY_AVAILABLE]: true } });
    run(e, Npc.MADAME, A.LAYLA_GIVEN_WRONG_AMOUNT_OF_CASH);
    expect(triggered(e)).toEqual([
      [Npc.MADAME, 27],
      [Npc.MADAME, 29],
    ]);
    const both = env({ facts: { [Fact.CINDY_AVAILABLE]: true, [Fact.BAMBI_AVAILABLE]: true } });
    run(both, Npc.MADAME, A.POSSIBLY_ADVERTISE_CINDY);
    expect(triggered(both)).toEqual([
      [Npc.MADAME, 14],
      [Npc.MADAME, 15],
    ]);
  });

  it('ends Layla’s chain with the Maria quest and the crowd line', () => {
    const e = env({ quests: { [Quest.RESCUE_MARIA]: 1 } });
    run(e, Npc.MADAME, A.LAYLAS_NEXT_LINE_AFTER_BAMBI);
    const crowd = env({ facts: { [Fact.MULTIPLE_MERCS_CLOSE]: true } });
    run(crowd, Npc.MADAME, A.LAYLAS_NEXT_LINE_AFTER_CARLA);
    expect(triggered(e)).toEqual([[Npc.MADAME, 31]]);
    expect(triggered(crowd)).toEqual([[Npc.MADAME, 32]]);
  });

  it('counts terrorist heads and pays out Carmen once every terrorist is dead', () => {
    const e = env({ profiles: { [Npc.CARMEN]: { npcData: 1, npcData2: 0, money: 5000 } }, world: { x: 13, y: 3, z: 0 } });
    run(e, Npc.CARMEN, A.CHECK_LAST_TERRORIST_HEAD);
    run(e, Npc.CARMEN, A.CARMEN_LEAVES_ON_NEXT_SECTOR_LOAD);
    expect(e.host.profile(Npc.CARMEN)).toMatchObject({ npcData: 0, npcData2: 1, money: 0 });
    expect(triggered(e)).toEqual([[Npc.CARMEN, 20]]);
    expect(e.histories).toEqual([[NarrativeHistory.GAVE_CARMEN_HEAD, 0]]);
    expect(e.fake.facts.values.get(Fact.ALL_TERRORISTS_KILLED)).toBe(true);
    expect(e.calls).toEqual(['loyaltyEverywhere 2500']);
  });

  it('flags Carmen as gone for good and starts his timer with the action’s own amount', () => {
    const e = env({ profiles: { [Npc.CARMEN]: {} }, params: { [A.CARMEN_LEAVES_FOR_C13]: { amount: 5000 } } });
    run(e, Npc.CARMEN, A.CARMEN_LEAVES_FOR_GOOD);
    run(e, Npc.CARMEN, A.CARMEN_LEAVES_FOR_C13);
    expect((e.host.profile(Npc.CARMEN)?.miscFlags2 ?? 0) & 0x03).toBe(0x03);
    expect(e.calls).toEqual(['carmenTimer 10000', 'carmenTimer 5000']);
  });

  it('moves Joey into the cave and back three days later', () => {
    const e = env({ profiles: { [Npc.JOEY]: {} }, minute: 90 });
    run(e, Npc.KINGPIN, A.ADD_JOEY_TO_WORLD);
    expect(e.host.profile(Npc.JOEY)).toMatchObject({ sectorX: 4, sectorY: 4, sectorZ: 1 });
    expect(e.events).toEqual([{ kind: 'futureDay', minute: 90, param: BONUS + A.ADD_JOEY_TO_WORLD, days: 3 }]);
  });

  it('queues Angel’s un-recruit and experience and triggers his record 24', () => {
    const e = env();
    run(e, Npc.ANGEL, A.ANGEL_LEAVES_DEED);
    expect(e.host.talk.queue.filter((q) => q.kind === 'doAction')).toEqual([
      { kind: 'doAction', npc: Npc.ANGEL, code: A.UN_RECRUIT_EPC, record: 0 },
      { kind: 'doAction', npc: Npc.ANGEL, code: A.GRANT_EXPERIENCE_3, record: 0 },
    ]);
    expect(triggered(e)).toEqual([[Npc.ANGEL, 24]]);
  });

  it('marks Kingpin’s greeting used and picks his introduction record', () => {
    const e = env({ profiles: { [Npc.KINGPIN]: {} }, day: 9, facts: { [Fact.KINGPIN_INTRODUCED_SELF]: true } });
    run(e, Npc.KINGPIN, A.MARK_KINGPIN_QUOTE_0_USED);
    run(e, Npc.KINGPIN, A.KINGPIN_TRIGGER_25_OR_14);
    expect(e.host.profile(Npc.KINGPIN)?.lastDateSpokenTo).toBe(9);
    expect(triggered(e)).toEqual([[Npc.KINGPIN, 25]]);
  });
});

describe('Cambria', () => {
  function doctors(e: FakeActionEnv, steveAtSpot: boolean): void {
    const steve = testSoldier(TEAM_FIRST_ID[Team.CIV], Team.CIV, Npc.STEVE, steveAtSpot ? 10343 : 200);
    const vince = testSoldier(TEAM_FIRST_ID[Team.CIV] + 1, Team.CIV, Npc.VINCE, 300);
    place(e, steve, vince);
  }

  it('chooses the doctor at the desk without a draw, else flips a coin', () => {
    const atDesk = env();
    doctors(atDesk, true);
    run(atDesk, Npc.VINCE, A.CHOOSE_DOCTOR);
    expect(triggered(atDesk)).toEqual([[Npc.VINCE, 12]]);
    expect(atDesk.fake.drawsTaken).toEqual([]);
    const coin = env({ draws: [1] });
    doctors(coin, false);
    run(coin, Npc.VINCE, A.CHOOSE_DOCTOR);
    expect(triggered(coin)).toEqual([[Npc.VINCE, 13]]);
    expect(coin.fake.drawsTaken).toEqual([2]);
  });

  it('draws PreRandom only when neither loyalty fact decides', () => {
    const low = env({ facts: { [Fact.VINCE_EXPLAINED_HAS_TO_CHARGE]: true, [Fact.LOYALTY_LOW]: true } });
    run(low, Npc.VINCE, A.TRIGGER_VINCE_BY_LOYALTY);
    expect(low.hospital.priceModifier).toBe(HospitalPrice.NORMAL);
    expect(low.calls).toEqual([]);
    const random = env({ facts: { [Fact.VINCE_EXPLAINED_HAS_TO_CHARGE]: true }, preDraws: [19] });
    run(random, Npc.VINCE, A.TRIGGER_VINCE_BY_LOYALTY);
    expect(random.calls).toEqual(['preRandom 100']);
    expect(random.hospital.priceModifier).toBe(HospitalPrice.RANDOM_FREEBIE);
    expect(random.fake.facts.values.get(Fact.HOSPITAL_FREEBIE_DECISION_MADE)).toBe(true);
    expect(triggered(random)).toEqual([[Npc.VINCE, 20]]);
  });

  it('asks the owed-money fact before checking who the doctor is', () => {
    const e = env({ facts: { [Fact.NPC_OWED_MONEY]: true, [Fact.VINCE_EXPLAINED_HAS_TO_CHARGE]: false } });
    run(e, Npc.STEVE, A.TRIGGER_VINCE_BY_LOYALTY);
    expect(e.fake.factLog.slice(0, 2)).toEqual([
      [Fact.NPC_OWED_MONEY, Npc.STEVE],
      [Fact.VINCE_EXPLAINED_HAS_TO_CHARGE, Npc.STEVE],
    ]);
    expect(triggered(e)).toEqual([[Npc.STEVE, 15]]);
  });

  it('escorts patients strictly closer than nine tiles and resets the modifier', () => {
    const e = env();
    const vince = testSoldier(TEAM_FIRST_ID[Team.CIV], Team.CIV, Npc.VINCE, 10000);
    const near = testSoldier(0, Team.OUR, 3, 10008);
    const edge = testSoldier(1, Team.OUR, 4, 10009);
    near.life = 50;
    edge.life = 50;
    place(e, vince, near, edge);
    e.hospital.priceModifier = HospitalPrice.COST;
    run(e, Npc.VINCE, A.DOCTOR_ESCORT_PATIENTS);
    expect(e.calls).toEqual([`hospital 0 ${HospitalPrice.COST}`]);
    expect(e.hospital.priceModifier).toBe(HospitalPrice.NORMAL);
    expect(near.absoluteFinalDestination).toBe(-1);
  });

  it('posts the doctor bonus 48 to 71 hours later, spilling into later days', () => {
    const e = env({ minute: 1000, draws: [23] });
    run(e, Npc.STEVE, A.ENABLE_CAMBRIA_DOCTOR_BONUS);
    expect(e.events).toEqual([{ kind: 'futureDay', minute: 1000 + 47 * 60, param: BONUS + A.ENABLE_CAMBRIA_DOCTOR_BONUS, days: 1 }]);
  });
});

describe('Madlab, Walter and the rest', () => {
  it('lets Walter be bribed with the parameter amount', () => {
    const e = env({ profiles: { [Npc.WALTER]: { balance: 19999 } } });
    run(e, Npc.WALTER, A.WALTER_GIVEN_MONEY_INITIALLY);
    e.host.profile(Npc.WALTER)!.balance = 20000;
    run(e, Npc.WALTER, A.WALTER_GIVEN_MONEY);
    expect(triggered(e)).toEqual([
      [Npc.WALTER, 14],
      [Npc.WALTER, 16],
    ]);
  });

  it('posts the robot, kids, vehicle and Brenda timers', () => {
    const e = env({ minute: 100 });
    run(e, Npc.MADLAB, A.READY_ROBOT);
    run(e, Npc.DOREEN, A.FREE_KIDS);
    run(e, Npc.GERARD, A.TIMER_FOR_VEHICLE);
    run(e, Npc.BRENDA, A.DELAYED_MAKE_BRENDA_LEAVE);
    run(e, Npc.KEITH, A.START_TIMER_ON_KEITH_GOING_OUT_OF_BUSINESS);
    expect(e.events.map((x) => [x.kind, x.minute, x.param])).toEqual([
      ['futureDay', 420, BONUS + A.READY_ROBOT],
      ['futureDay', 420, BONUS + A.FREE_KIDS],
      ['futureDay', 100, BONUS + A.TIMER_FOR_VEHICLE],
      ['sameDay', 460, BONUS + A.DELAYED_MAKE_BRENDA_LEAVE],
      ['strategic', 100 + 6 * 1440, 0],
    ]);
  });

  it('un-recruits the partner tourist and lets Skyrider use his map spot again', () => {
    const e = env({
      profiles: { [Npc.SKYRIDER]: { useProfileInsertion: true }, [Npc.JOHN]: { sectorX: 13 }, [Npc.MARY]: { sectorX: 13 } },
    });
    run(e, Npc.MARY, A.UN_RECRUIT_EPC, 13);
    run(e, Npc.SKYRIDER, A.SET_EPC_TO_NPC, 15);
    run(e, Npc.ANGEL, A.UN_RECRUIT_EPC, 0);
    expect(e.calls).toEqual([
      `unRecruitEpc ${Npc.MARY}`,
      `unRecruitEpc ${Npc.JOHN}`,
      `unRecruitEpc ${Npc.SKYRIDER}`,
      `unRecruitEpc ${Npc.MARIA}`,
    ]);
    expect(e.host.profile(Npc.JOHN)?.sectorX).toBe(0);
    expect(e.host.profile(Npc.SKYRIDER)?.useProfileInsertion).toBe(false);
  });

  it('starts the bloodcat quest and makes Estoni a fuel site', () => {
    const e = env();
    run(e, Npc.MATT, A.START_BLOODCAT_QUEST);
    run(e, Npc.JAKE, A.MAKE_ESTONI_A_FUEL_SITE);
    expect(e.quests.get(Quest.BLOODCATS)).toBe(1);
    expect(e.fake.facts.values.get(Fact.ESTONI_REFUELLING_POSSIBLE)).toBe(true);
    expect(e.calls).toEqual(['refuelSites']);
  });
});

describe('meanwhile triggers', () => {
  it('picks the Queen’s record by towns and SAM sites', () => {
    const e = env();
    const towns = [0, 2, 5, 9];
    const records: number[] = [];
    for (const n of towns) {
      e.host.talk.queue.length = 0;
      (e as { meanwhile: FakeActionEnv['meanwhile'] }).meanwhile = { ...e.meanwhile, wholeTownsUnderControlExceptOmerta: () => n };
      run(e, Npc.QUEEN, A.TRIGGER_QUEEN_BY_CITIES_CONTROLLED);
      records.push(triggered(e)[0]?.[1] ?? -1);
    }
    expect(records).toEqual([11, 7, 10, 11]);
  });
});

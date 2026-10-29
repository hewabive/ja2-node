import { describe, expect, it } from 'vitest';
import { recordArray, testSoldier } from '../../../../../tests/support/narrative.ts';
import { type FakeActionEnv, fakeActionEnv } from '../../../../../tests/support/npc-actions.ts';
import { NUM_NPC_QUOTE_RECORDS } from '../../../../content/formats/npc.ts';
import { Approach } from '../../../../content/narrative/npc-constants.ts';
import { Fact } from '../../../strategic/narrative/fact-ids.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { type Soldier, TEAM_FIRST_ID, Team } from '../../soldier.ts';
import { handleNpcDoAction } from './catalog.ts';
import { NpcActionCode as A } from './codes.ts';
import { answerNpcRequest, chooseLiar, npcRequestDetails, playerTeamFull } from './requestors.ts';

const NPC_ID = TEAM_FIRST_ID[Team.CIV];

function env(npc: number, profiles: Parameters<typeof fakeActionEnv>[0] = {}): FakeActionEnv {
  const all = Object.fromEntries(Array.from({ length: NUM_NPC_QUOTE_RECORDS }, (_, i) => [i, { approachRequired: Approach.TRIGGER_NPC }]));
  const scripts = Object.fromEntries([npc, Npc.VINCE, Npc.STEVE, Npc.DARYL, Npc.GERARD, Npc.SERGEANT].map((p) => [p, recordArray(all)]));
  const e = fakeActionEnv({ scripts, ...profiles });
  const dest = testSoldier(NPC_ID, Team.CIV, npc, 500);
  const t = e.host.tactical();
  if (t) t.soldiers[dest.id] = dest;
  e.host.context.dest = dest.id;
  e.host.context.srcProfile = 7;
  return e;
}

function triggered(e: FakeActionEnv): [number, number][] {
  return e.host.talk.queue.flatMap((q) => (q.kind === 'triggerNpc' ? [[q.npc, q.record] as [number, number]] : []));
}

function open(e: FakeActionEnv, npc: number, code: number, record = 0) {
  handleNpcDoAction(e, npc, code, record);
  const opening = e.requests.at(-1);
  if (!opening) throw new Error('no request opened');
  return npcRequestDetails(e, opening.code, opening.npc, opening.record);
}

describe('requestors', () => {
  it('opens a request only for the panel NPC, except the lie and marriage prompts', () => {
    const e = env(Npc.DARREN);
    handleNpcDoAction(e, Npc.KINGPIN, A.DARREN_REQUESTOR, 0);
    expect(e.requests).toEqual([]);
    handleNpcDoAction(e, Npc.QUEEN, A.PROMPT_PLAYER_TO_LIE, 4);
    expect(e.requests).toEqual([{ code: A.PROMPT_PLAYER_TO_LIE, npc: Npc.QUEEN, record: 4 }]);
  });

  it('shows the salary, after Conrad’s reduction, and answers with records 1 and 2', () => {
    const e = env(Npc.CONRAD, { profiles: { [Npc.CONRAD]: { salary: 5000 } } });
    const request = open(e, Npc.CONRAD, A.REDUCE_CONRAD_SALARY_CONDITIONS);
    expect(request).toMatchObject({ request: 'hire', amount: 3300, choices: ['yes', 'no'] });
    answerNpcRequest(e, request, 'no');
    expect(triggered(e)).toEqual([[Npc.CONRAD, 2]]);
  });

  it('shows the doctor’s cost less the refund, or $10 when the refund exceeds it', () => {
    const e = env(Npc.VINCE);
    e.medicalCost = 120;
    e.hospital.refund = 50;
    expect(open(e, Npc.VINCE, A.MEDICAL_REQUESTOR).amount).toBe(70);
    e.hospital.refund = 121;
    expect(open(e, Npc.VINCE, A.MEDICAL_REQUESTOR).amount).toBe(10);
  });

  it('lets Willis’s free treatment zero Vince’s balance', () => {
    const e = env(Npc.STEVE, { profiles: { [Npc.VINCE]: { balance: -400 } }, facts: { [Fact.WOUNDED_MERCS_NEARBY]: true } });
    const request = open(e, Npc.STEVE, A.MEDICAL_REQUESTOR_2);
    answerNpcRequest(e, request, 'yes');
    expect(triggered(e)).toEqual([[Npc.STEVE, 26]]);
    expect(e.host.profile(Npc.VINCE)?.balance).toBe(0);
    expect(e.hospital.tempBalance).toBe(0);
  });

  it('answers free treatment of one wounded merc with the several-mercs record: that fact holds for one too, so record 25 never plays', () => {
    const e = env(Npc.VINCE, { facts: { [Fact.WOUNDED_MERCS_NEARBY]: true, [Fact.ONE_WOUNDED_MERC_NEARBY]: true } });
    answerNpcRequest(e, open(e, Npc.VINCE, A.MEDICAL_REQUESTOR_2), 'yes');
    expect(triggered(e)).toEqual([[Npc.VINCE, 26]]);
  });

  it('flags the asker, gives Daryl the key and the asker’s profile on yes', () => {
    const e = env(Npc.DARYL, { profiles: { 7: {}, [Npc.DARYL]: {} } });
    const request = open(e, Npc.DARYL, A.TRIGGER_MARRY_DARYL_PROMPT);
    answerNpcRequest(e, request, 'no');
    expect((e.host.profile(7)?.miscFlags2 ?? 0) & 0x40).toBe(0x40);
    expect(triggered(e)).toEqual([[Npc.DARYL, 12]]);
  });

  it('answers the vehicle and Krott prompts with Gerard’s and Krott’s records', () => {
    const e = env(Npc.GERARD);
    answerNpcRequest(e, open(e, Npc.GERARD, A.BUY_VEHICLE_REQUESTOR), 'yes');
    expect(triggered(e)).toEqual([[Npc.GERARD, 9]]);
  });

  it('counts the team as full above 17 mercs', () => {
    expect(playerTeamFull(17)).toBe(false);
    expect(playerTeamFull(18)).toBe(true);
  });

  it('chooses the liar by wisdom alone', () => {
    const e = env(Npc.QUEEN);
    const a = testSoldier(0, Team.OUR, 1, 100);
    const b = testSoldier(1, Team.OUR, 2, 101);
    Object.assign(a, { stats: { ...a.stats, wisdom: 70, leadership: 10 } });
    Object.assign(b, { stats: { ...b.stats, wisdom: 60, leadership: 90 } });
    const t = e.host.tactical();
    if (t) {
      t.soldiers[0] = a;
      t.soldiers[1] = b;
    }
    expect((chooseLiar(e) as Soldier).id).toBe(0);
  });
});

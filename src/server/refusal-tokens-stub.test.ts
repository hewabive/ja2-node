import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { CommandEnvelope } from '../protocol/messages.ts';
import type { CommandResult } from '../sim/command.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const NOBODY = 999;

type Refusals = readonly (readonly [command: CommandEnvelope, refusal: string])[];

async function landedCampaign(): Promise<CampaignSession> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), 29, { mercs: 2, land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString('A9')), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.campaign.state.flow).toBe('tactical');
  return session;
}

function firstMerc(session: CampaignSession): number {
  const merc = session.view().strategic?.mercs[0];
  if (!merc) throw new Error('no merc');
  return merc.id;
}

function expectTokenAndText(result: CommandResult, refusal: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.data.refusal).toBe(refusal);
  expect(result.reason).not.toBe(refusal);
  expect(result.reason.length).toBeGreaterThan(refusal.length);
}

function expectRefusals(session: CampaignSession, refusals: Refusals): void {
  for (const [command, refusal] of refusals) {
    const result = session.dispatch(command);
    expect.soft({ command, refusal: result.ok ? null : result.data.refusal }).toEqual({ command, refusal });
    expectTokenAndText(result, refusal);
  }
}

function tacticalRefusals(merc: number): Refusals {
  return [
    [{ type: 'nonsense' }, 'unknownCommand'],
    [{ type: 'setOption', bloodAndGore: 'yes' }, 'badOption'],
    [{ type: 'move', soldier: NOBODY, to: 0 }, 'noSuchSoldier'],
    [{ type: 'move', soldier: merc, to: -5 }, 'badDestination'],
    [{ type: 'turn', soldier: merc, direction: 12 }, 'badDirection'],
    [{ type: 'stance', soldier: merc, stance: 'fly' }, 'badStance'],
    [{ type: 'drop', soldier: merc, slot: 'nowhere' }, 'badSlot'],
    [{ type: 'pickUp', soldier: merc, gridNo: -1 }, 'badGridNo'],
    [{ type: 'moveItem', soldier: merc, from: 'nowhere', to: 'hand' }, 'badSlot'],
    [{ type: 'withdrawCash', soldier: merc, amount: 0 }, 'badAmount'],
    [{ type: 'talk', soldier: merc, target: NOBODY }, 'noSuchTarget'],
    [{ type: 'give', soldier: merc, target: NOBODY, slot: 'hand' }, 'noSuchTarget'],
    [{ type: 'openShop', soldier: merc, dealer: 'NOBODY' }, 'notADealer'],
    [{ type: 'setShopPricing', soldier: merc }, 'shopNotOpen'],
    [{ type: 'quoteTrade', buy: [] }, 'shopNotOpen'],
    [{ type: 'trade', buy: [] }, 'shopNotOpen'],
    [{ type: 'answer', choice: 'yes' }, 'noPrompt'],
    [{ type: 'autoresolveRetreat' }, 'noAutoresolve'],
    [{ type: 'autoresolveBattle' }, 'noBattle'],
    [{ type: 'showBattle' }, 'noBattle'],
    [{ type: 'enterSector', sector: 'Z99' }, 'badSector'],
    [{ type: 'exitSector', soldier: NOBODY, direction: 'north' }, 'noSuchSoldier'],
    [{ type: 'exitSector', soldier: merc, direction: 'up' }, 'badDirection'],
    [{ type: 'compressTime' }, 'mapScreenOnly'],
    [{ type: 'moveMilitia', from: 'A9', to: 'A10' }, 'mapScreenOnly'],
    [{ type: 'heliRoute', to: 'A10' }, 'mapScreenOnly'],
    [{ type: 'openLaptop' }, 'mapScreenOnly'],
    [{ type: 'setLandingZone', sector: 'A9' }, 'mapScreenOnly'],
    [{ type: 'extendContract', soldier: merc, length: 'day' }, 'mapScreenOnly'],
    [{ type: 'dismiss', soldier: merc }, 'mapScreenOnly'],
  ];
}

function mapRefusals(merc: number): Refusals {
  return [
    [{ type: 'route', soldier: NOBODY, to: 'B9' }, 'noSuchMerc'],
    [{ type: 'route', soldier: merc, to: 'nowhere' }, 'badSector'],
    [{ type: 'cancelRoute', soldier: NOBODY }, 'noSuchMerc'],
    [{ type: 'shortenRoute', soldier: merc, at: 'nowhere' }, 'badSector'],
    [{ type: 'routeGroup', soldiers: [] }, 'badSoldiers'],
    [{ type: 'assignSquad', soldier: merc, squad: 'any squad' }, 'badSquad'],
    [{ type: 'assign', soldiers: [] }, 'badAssignment'],
    [{ type: 'assign', soldiers: [NOBODY], to: { kind: 'doctor' } }, 'unknownSoldier'],
    [{ type: 'sleep', soldier: NOBODY }, 'unknownSoldier'],
    [{ type: 'wake', soldier: NOBODY }, 'unknownSoldier'],
    [{ type: 'moveMilitia', from: 'nowhere', to: 'A10' }, 'badSector'],
    [{ type: 'contractOptions', soldier: NOBODY }, 'noSuchMerc'],
    [{ type: 'extendContract', soldier: merc, length: 'year' }, 'badLength'],
    [{ type: 'removeMerc', soldier: merc }, 'notDeadOrCaptured'],
    [{ type: 'heliRoute', to: 'nowhere' }, 'badSector'],
    [{ type: 'showBattle' }, 'noBattle'],
    [{ type: 'setLandingZone', sector: 'nowhere' }, 'badSector'],
    [{ type: 'readEmail', id: 1 }, 'laptopClosed'],
  ];
}

const LAPTOP_REFUSALS: Refusals = [
  [{ type: 'openLaptop' }, 'laptopOpen'],
  [{ type: 'compressTime' }, 'laptopOpen'],
  [{ type: 'readEmail', id: NOBODY }, 'noSuchMail'],
  [{ type: 'deleteEmail', id: NOBODY }, 'noSuchMail'],
  [{ type: 'emailText', id: NOBODY }, 'noSuchMail'],
  [{ type: 'readFile', code: NOBODY }, 'noSuchFile'],
  [{ type: 'visitSite', site: 'moon' }, 'badSite'],
  [{ type: 'aimHire', profile: 'Ivan', contract: 7 }, 'notAimMerc'],
  [{ type: 'aimHire', profile: 1, contract: 'week' }, 'badContract'],
  [{ type: 'aimHire', profile: 1, contract: 7, gear: 'yes' }, 'badGear'],
  [{ type: 'aimLeaveMessage', profile: NOBODY }, 'notAimMerc'],
  [{ type: 'mercHire', profile: 'Biff' }, 'notListed'],
  [{ type: 'bobbyRayOrder' }, 'badOrder'],
  [{ type: 'bobbyRayQuote' }, 'badOrder'],
  [{ type: 'insure', soldier: NOBODY }, 'notInsurable'],
  [{ type: 'insuranceQuote', soldier: NOBODY }, 'notInsurable'],
  [{ type: 'orderFlowers', bouquet: -1 }, 'noSuchBouquet'],
  [{ type: 'hireCheck', profile: NOBODY }, 'notAimMerc'],
  [{ type: 'aimQuote', profile: NOBODY }, 'notAimMerc'],
];

describe('refusal tokens', () => {
  it('gives every refusal of every command family a token in data.refusal and readable text in reason', async () => {
    const session = await landedCampaign();
    const merc = firstMerc(session);
    expectRefusals(session, tacticalRefusals(merc));
    expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expectRefusals(session, mapRefusals(merc));
    expect(session.dispatch({ type: 'openLaptop' })).toEqual({ ok: true });
    expectRefusals(session, LAPTOP_REFUSALS);
  });

  it('answers assign per soldier in data.results and names the first failure as the refusal', async () => {
    const session = await landedCampaign();
    expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    const merc = firstMerc(session);
    const result = session.dispatch({ type: 'assign', soldiers: [merc, NOBODY], to: { kind: 'squad', squad: 0 } });
    expect(result).toEqual({
      ok: false,
      reason: 'unknownSoldier: no such merc',
      data: {
        refusal: 'unknownSoldier',
        results: [{ ok: true }, { ok: false, refusal: 'unknownSoldier', reason: 'unknownSoldier: no such merc' }],
      },
    });
    expect(session.dispatch({ type: 'assign', soldiers: [merc], to: { kind: 'squad', squad: 0 } })).toEqual({
      ok: true,
      data: { results: [{ ok: true }] },
    });
  });
});

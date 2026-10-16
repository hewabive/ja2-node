import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, landFirstSquad } from '../../../../tests/support/campaign.ts';
import { createContractCampaign } from '../../../../tests/support/contracts.ts';
import { loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../../tests/support/sectors.ts';
import { parseSectorString, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import type { SimEvent } from '../../events.ts';
import { CompressMode, EventKind, NUM_MIN_IN_DAY } from '../../strategic/time/constants.ts';
import { isTimeBeingCompressed, worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import type { CampaignSim } from '../campaign-sim.ts';
import { FinanceCode } from '../finances.ts';
import { MercKind } from '../roster.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

type Driver = (c: CampaignSim, until: () => boolean, budget?: number) => void;

const instant: Driver = (c, until, budget = 400_000) => {
  for (let i = 0; i < budget && !until(); i++) c.step();
};

const manual: Driver = (c, until, budget = 400_000) => {
  const chunk = 7;
  for (let i = 0; i < budget && !until(); i += chunk) for (let k = 0; k < chunk && !until(); k++) c.step();
};

const SCENARIO_TIMEOUT_MS = 120_000;
const minute = (day: number, hour: number, min = 0) => day * NUM_MIN_IN_DAY + hour * 60 + min;
const STUB = { kestrel: 0, moraga: 2, hollis: 3, brack: 42 } as const;

class Recorder {
  readonly events: SimEvent[] = [];

  take(c: CampaignSim): void {
    this.events.push(...c.drainEvents());
  }

  of<T extends SimEvent['type']>(type: T): Extract<SimEvent, { type: T }>[] {
    return this.events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
  }
}

function runUntil(c: CampaignSim, drive: Driver, rec: Recorder, until: () => boolean): void {
  for (let guard = 0; guard < 2000 && !until(); guard++) {
    if (c.hasPendingDecision()) return;
    if (!isTimeBeingCompressed(c.state.clock)) {
      const r = c.dispatch({ type: 'compressTime', mode: CompressMode.MIN60 });
      if (!r.ok) throw new Error(`compression refused: ${r.reason}`);
    }
    drive(c, () => until() || c.hasPendingDecision() || !isTimeBeingCompressed(c.state.clock));
    rec.take(c);
  }
}

function untilMinute(c: CampaignSim, target: number): () => boolean {
  return () => worldTotalMinutes(c.state.clock) >= target;
}

function answer(c: CampaignSim, rec: Recorder, choice: string): unknown {
  const prompt = c.state.battle.prompt;
  const r = c.dispatch({ type: 'answer', prompt: prompt?.id, choice });
  rec.take(c);
  if (!r.ok) throw new Error(`answer ${choice} refused: ${r.reason}`);
  return r.data;
}

function renewalScenario(drive: Driver): string {
  const { campaign: c, roster } = createContractCampaign(kit, {
    seed: 11,
    hires: [
      { profile: STUB.kestrel, length: 1 },
      { profile: STUB.moraga, length: 1 },
      { profile: STUB.hollis, length: 1 },
      { profile: STUB.brack, kind: MercKind.MERC, length: 1 },
    ],
  });
  const brack = c.state.profiles.get(STUB.brack);
  if (brack) brack.hated[0] = -1;
  const airport = c.state.map.elements[strategicIndex(parseSectorString('B13'))];
  if (airport) airport.enemyControlled = false;
  const rec = new Recorder();
  landFirstSquad(c);
  drive(c, () => c.isIdle(), 20_000);
  rec.take(c);
  expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
  const ids = roster.all().map((m) => m.id);
  expect(roster.get(0)?.contract.contractEnd).toBe(minute(2, 7));

  runUntil(c, drive, rec, untilMinute(c, minute(2, 5, 31)));
  expect(rec.of('contractsExpiringSoon')).toEqual([expect.objectContaining({ soldiers: [0, 1, 2] })]);
  expect(c.state.contracts.renewal.list).toEqual([STUB.kestrel, STUB.moraga, STUB.hollis]);

  runUntil(c, drive, rec, () => false);
  expect(worldTotalMinutes(c.state.clock)).toBe(minute(2, 7, 30));
  expect(c.state.battle.prompt).toMatchObject({ kind: 'contractRenewal', soldier: 0, fromSequence: true });
  expect(c.dispatch({ type: 'compressTime' }).ok).toBe(false);
  const extended = answer(c, rec, 'twoWeeks') as { extended: boolean };
  expect(extended).toMatchObject({ extended: true, days: 14, cost: 3600, endsAt: { day: 16, hour: 7 } });
  expect(c.state.finances.ledger.at(-1)).toMatchObject({ code: FinanceCode.EXTENDED_CONTRACT_BY_2_WEEKS, amount: -3600 });

  expect(c.state.battle.prompt).toMatchObject({ kind: 'contractRenewal', soldier: 1 });
  expect(answer(c, rec, 'week')).toMatchObject({ extended: false, reason: 'hatedMerc', departs: true });
  expect(c.state.battle.prompt).toMatchObject({ kind: 'mercDeparture', soldier: 1, choices: ['here', 'elsewhere', 'rehire'] });
  answer(c, rec, 'here');

  expect(c.state.battle.prompt).toMatchObject({ kind: 'contractRenewal', soldier: 2 });
  answer(c, rec, 'letGo');
  expect(c.state.battle.prompt).toMatchObject({ kind: 'mercDeparture', soldier: 2 });
  answer(c, rec, 'elsewhere');
  expect(c.state.battle.prompt).toBeNull();
  expect(c.state.contracts.renewal.on).toBe(false);
  expect(rec.of('mercLeft').map((e) => [e.soldier, e.cause, e.equipment])).toEqual([
    [1, 'contractExpired', 'here'],
    [2, 'contractExpired', 'elsewhere'],
  ]);
  expect(c.state.contracts.leaveList[0]?.owner).toBe(STUB.hollis);
  expect(c.state.queue.events.some((e) => e.kind === EventKind.MERC_LEAVE_EQUIP_IN_DRASSEN)).toBe(true);

  runUntil(c, drive, rec, untilMinute(c, minute(2, 13, 31)));
  expect(rec.of('equipmentDelivered')).toEqual([expect.objectContaining({ sector: 'B13', owner: STUB.hollis })]);
  expect(c.state.contracts.leaveList[0]?.items).toBeNull();

  runUntil(c, drive, rec, untilMinute(c, minute(13, 0, 1)));
  expect(rec.of('mercAccountStatus').map((e) => e.status)).toEqual(['firstWarning', 'suspended', 'invalid']);
  const quit = rec.of('mercLeft').at(-1);
  expect(quit).toMatchObject({ soldier: 3, cause: 'quit', equipment: 'carried', history: 14 });
  expect(roster.all().map((m) => m.id)).toEqual([0]);
  return JSON.stringify({
    ids,
    rng: c.state.rng.state(),
    events: rec.events.map((e) => e.type),
    ledger: c.state.finances.ledger,
    minute: worldTotalMinutes(c.state.clock),
  });
}

function haterScenario(drive: Driver): string {
  const { campaign: c, roster } = createContractCampaign(kit, {
    seed: 12,
    hires: [
      { profile: STUB.kestrel, length: 7 },
      { profile: STUB.brack, kind: MercKind.MERC, length: 1 },
    ],
  });
  const rec = new Recorder();
  landFirstSquad(c);
  drive(c, () => c.isIdle(), 20_000);
  rec.take(c);
  expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
  runUntil(c, drive, rec, () => false);
  expect(worldTotalMinutes(c.state.clock)).toBe(minute(1, 13));
  expect(rec.of('mercQuote').map((e) => [e.soldier, e.quote, e.subject])).toEqual([
    [1, 'hatedMercOne', STUB.kestrel],
    [1, 'mercQuitHated1', STUB.kestrel],
  ]);
  expect(c.state.battle.prompt).toMatchObject({ kind: 'mercDeparture', soldier: 1, choices: ['here'] });
  answer(c, rec, 'here');
  expect(rec.of('mercLeft')).toEqual([expect.objectContaining({ soldier: 1, cause: 'quit', history: 14, equipment: 'here' })]);
  expect(roster.all().map((m) => m.id)).toEqual([0]);
  return JSON.stringify({ rng: c.state.rng.state(), events: rec.events.map((e) => e.type) });
}

describe('the stub contract scenario', () => {
  it(
    'warns at 05:30, renews, refuses and lets mercs go at 07:30, delivers gear at 13:30 and loses the unpaid M.E.R.C. merc',
    () => {
      const a = renewalScenario(instant);
      expect(renewalScenario(manual)).toBe(a);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'makes the M.E.R.C. hater quit after six hours with the hated merc',
    () => {
      const a = haterScenario(instant);
      expect(haterScenario(manual)).toBe(a);
    },
    SCENARIO_TIMEOUT_MS,
  );
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10 } from '../../../../tests/support/a10-campaign.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { MouseButton } from '../../input/events.ts';
import { MAX_MONEY_PER_SLOT, MoneyBox } from './money-box.ts';

const SLOW_MS = 120_000;
const MONEY = 'MONEY';

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
}, SLOW_MS);

afterAll(async () => {
  await kit.dispose();
});

function moneyPockets(f: TacticalUiTest, soldier: number) {
  return (f.client.view.soldiers.find((s) => s.id === soldier)?.inventory ?? []).filter((i) => i.item === MONEY);
}

function emptySlot(f: TacticalUiTest, soldier: number): number {
  const used = new Set((f.client.view.soldiers.find((s) => s.id === soldier)?.inventory ?? []).map((i) => i.slot));
  for (let slot = 11; slot < 19; slot++) if (!used.has(slot)) return slot;
  throw new Error('no free small pocket');
}

function balance(f: TacticalUiTest): number {
  return f.client.view.strategic?.balance ?? 0;
}

describe('the money box rules', () => {
  it('moves steps between remaining and removing and caps a withdrawal at MAX_MONEY_PER_SLOT', () => {
    const split = new MoneyBox(1250, false);
    expect([split.stepEnabled(0), split.stepEnabled(1), split.stepEnabled(2)]).toEqual([true, true, true]);
    expect(split.add(0)).toBe('added');
    expect(split.add(0)).toBe('unchanged');
    expect(split.add(1)).toBe('added');
    expect([split.remaining, split.removing]).toEqual([150, 1100]);
    expect(split.subtract(0)).toBe(true);
    expect(split.subtract(0)).toBe(false);
    const withdraw = new MoneyBox(50_000, true);
    for (let k = 0; k < MAX_MONEY_PER_SLOT / 1000; k++) expect(withdraw.add(0)).toBe('added');
    expect(withdraw.add(2)).toBe('overMaximum');
    expect(new MoneyBox(90, false).stepEnabled(1)).toBe(false);
  });
});

describe('money through the single merc panel in a stub campaign', { timeout: SLOW_MS }, () => {
  it('withdraws through the money region, splits a pocket through the money box and deposits the split', async () => {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    const merc = a10.mercs[0] ?? 0;
    await f.click('teamFaceRegion0', MouseButton.RIGHT);
    await f.settle();
    expect(f.screen.smMerc).toBe(merc);
    const before = balance(f);

    await f.click('smMoney');
    expect(f.screen.description.object).toMatchObject({ kind: 'balance', amount: before });
    expect(f.screen.description.money?.withdraw).toBe(true);
    await f.click('itemDescriptionMoney0');
    await f.click('itemDescriptionMoney0');
    await f.click('itemDescriptionMoney1', MouseButton.RIGHT);
    await f.click('itemDescriptionMoney1');
    await f.click('itemDescriptionMoneyDone');
    expect(f.client.commands.at(-1)?.cmd).toEqual({ type: 'withdrawCash', soldier: merc, amount: 2000 });
    expect(f.client.commands.at(-1)?.reply.ok).toBe(true);
    expect(f.screen.description.open).toBe(false);
    expect(balance(f)).toBe(before - 2000);
    const pocket = moneyPockets(f, merc)[0];
    expect(pocket?.money).toBe(2000);

    await f.click(`slot${pocket?.slot}`, MouseButton.RIGHT);
    expect(f.screen.description.money).toMatchObject({ withdraw: false, total: 2000 });
    await f.click('itemDescriptionMoney1');
    await f.click('itemDescriptionMoneyDone');
    expect(f.screen.inventory.cursor?.source).toEqual({ kind: 'money', soldier: merc, slot: pocket?.slot, amount: 100 });
    const free = emptySlot(f, merc);
    await f.click(`slot${free}`);
    expect(f.client.commands.at(-1)?.cmd).toEqual({ type: 'splitMoney', soldier: merc, slot: pocket?.slot, amount: 100, to: free });
    expect(f.client.commands.at(-1)?.reply.ok).toBe(true);
    expect(f.screen.inventory.cursor).toBeNull();
    expect(moneyPockets(f, merc).map((p) => p.money).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([100, 1900]);

    await f.click(`slot${free}`);
    expect(f.screen.inventory.cursor?.source).toMatchObject({ kind: 'slot', slot: free });
    await f.click('smMoney');
    await f.settle();
    expect(f.t.runtime.host.modal?.id).toBe('messageBox');
    expect(f.widget('messageBox').text).toContain('$100');
    await f.click('messageBox.yes');
    await f.settle();
    expect(f.client.commands.at(-1)?.cmd).toEqual({ type: 'depositCash', soldier: merc, slot: free });
    expect(f.client.commands.at(-1)?.reply.ok).toBe(true);
    expect(balance(f)).toBe(before - 1900);
    expect(moneyPockets(f, merc).map((p) => p.money)).toEqual([1900]);
  });
});

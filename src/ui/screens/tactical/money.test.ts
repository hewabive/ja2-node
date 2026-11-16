import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10 } from '../../../../tests/support/a10-campaign.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { MouseButton } from '../../input/events.ts';
import type { TacticalEnvironment } from './environment.ts';
import { UiMode } from './input/ui-events.ts';
import type { InventoryPanel } from './inventory.ts';
import { MoneyActions } from './money-actions.ts';
import { MAX_MONEY_PER_SLOT, MoneyBox } from './money-box.ts';

const MONEY = 'MONEY';

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

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

describe('money actions in the shop', () => {
  it('offers a money box split as cash and keeps the money region off while a shop is open', async () => {
    const offered: [number, number, number][] = [];
    let shown = 0;
    const actions = new MoneyActions({
      env: {} as TacticalEnvironment,
      inventory: { cursor: null } as unknown as InventoryPanel,
      view: () => ({ tick: 0, mapPath: null, soldiers: [], strategic: { balance: 5000 } }) as never,
      smSoldier: () => ({ id: 3 }) as never,
      disabled: () => false,
      changeToMove: () => undefined,
      shopOpen: () => true,
      showBalance: () => {
        shown++;
      },
      offerCash: (soldier, slot, amount) => {
        offered.push([soldier, slot, amount]);
        return true;
      },
    });
    actions.done({ kind: 'slot', soldier: 3, slot: 12, index: 0 }, 300);
    expect(offered).toEqual([[3, 12, 300]]);
    await actions.region();
    expect(shown).toBe(0);
  });
});

async function withdrawIntoAFreePocket(f: TacticalUiTest, merc: number, steps: number): Promise<void> {
  await f.click('smMoney');
  for (let k = 0; k < steps; k++) await f.click('itemDescriptionMoney0');
  await f.click('itemDescriptionMoneyDone');
  await f.click(`slot${emptySlot(f, merc)}`);
}

describe('money through the single merc panel in a stub campaign', () => {
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
    const sent = f.client.commands.length;
    await f.click('itemDescriptionMoneyDone');
    expect(f.screen.description.open).toBe(false);
    expect(f.screen.inventory.cursor?.source).toEqual({ kind: 'account', soldier: merc, amount: 2000 });
    expect([f.client.commands.length, balance(f)]).toEqual([sent, before]);
    const into = emptySlot(f, merc);
    await f.click(`slot${into}`);
    expect(f.client.commands.at(-1)?.cmd).toEqual({ type: 'withdrawCash', soldier: merc, amount: 2000, to: into });
    expect(f.client.commands.at(-1)?.reply.ok).toBe(true);
    expect(f.screen.inventory.cursor).toBeNull();
    expect(balance(f)).toBe(before - 2000);
    const pocket = moneyPockets(f, merc)[0];
    expect(pocket).toMatchObject({ slot: into, money: 2000 });

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
    expect(
      moneyPockets(f, merc)
        .map((p) => p.money)
        .sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual([100, 1900]);

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

  it('goes back to move mode as soon as the money region asks to deposit the held money (SMInvMoneyButtonCallback)', async () => {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    const merc = a10.mercs[0] ?? 0;
    await f.click('teamFaceRegion0', MouseButton.RIGHT);
    await f.settle();
    await withdrawIntoAFreePocket(f, merc, 1);
    const pocket = moneyPockets(f, merc)[0];
    await f.click(`slot${pocket?.slot}`);
    expect(f.screen.inventory.cursor?.source).toMatchObject({ kind: 'slot', slot: pocket?.slot });
    const overMap = { x: f.t.runtime.geometry().width / 2, y: 100 };
    for (const dx of [0, 1]) {
      f.t.runtime.input({
        kind: 'pointerMove',
        x: overMap.x + dx,
        y: overMap.y,
        button: MouseButton.LEFT,
        buttons: 0,
        wheel: 0,
        modifiers: 0,
      });
      f.t.frame(20);
    }
    expect(f.screen.controls.input.mode).toBe(UiMode.ACTION_MODE);
    await f.click('smMoney');
    await f.settle();
    expect(f.t.runtime.host.modal?.id).toBe('messageBox');
    expect(f.screen.controls.input.mode).toBe(UiMode.MOVE_MODE);
  });

  it('puts a withdrawal held in the cursor back at the money region without a ledger entry, the box asking as for money in a pocket', async () => {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    const merc = a10.mercs[0] ?? 0;
    await f.click('teamFaceRegion0', MouseButton.RIGHT);
    await f.settle();
    const before = balance(f);
    const sent = f.client.commands.length;
    await f.click('smMoney');
    await f.click('itemDescriptionMoney0');
    await f.click('itemDescriptionMoneyDone');
    expect(f.screen.inventory.cursor?.source).toEqual({ kind: 'account', soldier: merc, amount: 1000 });
    await f.click('smMoney');
    await f.settle();
    expect(f.widget('messageBox').text).toContain('$1,000');
    await f.click('messageBox.yes');
    await f.settle();
    expect([f.screen.inventory.cursor, f.client.commands.length, balance(f)]).toEqual([null, sent, before]);
  });
});

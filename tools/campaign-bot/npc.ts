import type { ShopBoxView, ShopView, SoldierView } from '../../src/protocol/view.ts';
import { tiles } from './grid.ts';
import type { ActResult } from './mcp-game.ts';
import { ourMercs, type Player, usable } from './player.ts';

const TALK_ADVANCE_TICKS = 20_000;
const WALK_TICKS = 20_000;
const BREATHER_TICKS = 4000;
const BREATHER_ATTEMPTS = 8;

export interface Purchase {
  readonly item: string;
  readonly count: number;
}

export function soldierOfProfile(p: Player, profile: number): SoldierView | undefined {
  return p.view.soldiers.find((s) => s.profile === profile);
}

export async function leadMerc(p: Player): Promise<SoldierView | undefined> {
  const view = await p.observe();
  return ourMercs(view)
    .filter((m) => usable(m) && m.kind !== 'epc')
    .sort((a, b) => a.id - b.id)[0];
}

export async function walkTo(p: Player, merc: SoldierView, to: number): Promise<boolean> {
  if (merc.gridNo === to) return true;
  for (let attempt = 0; attempt < BREATHER_ATTEMPTS; attempt++) {
    const moved = await p.act({ type: 'move', soldier: merc.id, to, mode: 'walk' });
    if (moved.ok) {
      await p.advance({ idle: true, ticks: WALK_TICKS });
      return true;
    }
    if (!moved.reason?.includes('out of breath')) {
      p.log(`  ${merc.name} cannot walk to ${to}: ${moved.reason ?? ''}`);
      return false;
    }
    await p.advance({ ticks: BREATHER_TICKS });
  }
  p.log(`  ${merc.name} stays out of breath`);
  return false;
}

export async function openDoor(p: Player, merc: SoldierView, door: number): Promise<void> {
  const opened = await p.act({ type: 'door', soldier: merc.id, gridNo: door, action: 'open' });
  if (opened.ok) await p.advance({ idle: true, ticks: WALK_TICKS });
}

export async function talk(p: Player, merc: SoldierView, npc: number): Promise<ActResult> {
  const started = await p.act({ type: 'talk', soldier: merc.id, target: { npc } });
  if (!started.ok) {
    p.log(`  talk to ${npc} refused: ${started.reason ?? ''}`);
    return started;
  }
  if ((started.data as { walking?: boolean } | undefined)?.walking) await p.advance({ idle: true, ticks: TALK_ADVANCE_TICKS });
  return started;
}

export async function closeConversation(p: Player): Promise<void> {
  const view = await p.observe();
  if (view.conversation) await p.act({ type: 'closeTalk' });
  await p.advance({ ticks: 10 });
}

export async function approachNpc(p: Player, merc: SoldierView, npc: number, within: number): Promise<SoldierView | null> {
  const view = await p.observe();
  const target = view.soldiers.find((s) => s.profile === npc);
  if (!target) return null;
  if (tiles(merc.gridNo, target.gridNo) <= within) return target;
  for (const offset of [2, -2, 1, -1, 160, -160]) {
    if (await walkTo(p, merc, target.gridNo + offset)) return target;
  }
  return target;
}

function affordable(shop: ShopView, box: ShopBoxView): boolean {
  return (box.unitPrice ?? Number.POSITIVE_INFINITY) <= shop.balance;
}

export async function buy(p: Player, merc: SoldierView, dealer: number, wanted: readonly Purchase[], reserve: number): Promise<string[]> {
  const opened = await p.act({ type: 'openShop', dealer, soldier: merc.id });
  const view = await p.observe();
  const shop = view.shop;
  if (!opened.ok || !shop) {
    p.log(`  the shop of ${dealer} did not open: ${opened.reason ?? 'a conversation instead'}`);
    await closeConversation(p);
    return [];
  }
  const bought: string[] = [];
  let budget = shop.balance - reserve;
  for (const want of wanted) {
    const box = shop.boxes.find((b) => b.item === want.item && affordable(shop, b));
    if (!box) continue;
    const price = box.unitPrice ?? 0;
    const count = Math.min(want.count, box.count, price > 0 ? Math.trunc(budget / price) : want.count);
    if (count <= 0) continue;
    const traded = await p.act({ type: 'trade', buy: [{ ...box.key, count }], useBalance: true });
    if (!traded.ok) {
      p.log(`  buying ${want.item} refused: ${traded.reason ?? ''}`);
      continue;
    }
    budget -= price * count;
    bought.push(`${count} ${want.item}`);
  }
  await p.act({ type: 'closeShop' });
  await closeConversation(p);
  return bought;
}

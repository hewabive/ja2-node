import { NOTHING } from '../../src/content/items/items.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import { createItem, type ItemObject } from '../../src/sim/items/object.ts';
import { AP_RELOAD_GUN, InvSlot } from '../../src/sim/tactical/inventory.ts';
import type { Soldier } from '../../src/sim/tactical/soldier.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;

export const ATTACH_PROBES: ReadonlySet<string> = new Set(['attachbox']);

const SEED = 1;
const FREE_POCKETS = [
  InvSlot.BIGPOCK1,
  InvSlot.BIGPOCK2,
  InvSlot.BIGPOCK3,
  InvSlot.BIGPOCK4,
  InvSlot.SMALLPOCK1,
  InvSlot.SMALLPOCK2,
  InvSlot.SMALLPOCK3,
  InvSlot.SMALLPOCK4,
  InvSlot.SMALLPOCK5,
  InvSlot.SMALLPOCK6,
  InvSlot.SMALLPOCK7,
  InvSlot.SMALLPOCK8,
];

interface Pair {
  readonly item: number;
  readonly status: number;
}

interface Cursor {
  readonly owner: Soldier;
  readonly slot: number;
}

interface Replay {
  readonly attachments: Pair[];
  readonly hostItem: number;
  readonly hostStatus: number;
  readonly ap: number;
  readonly cursorAp: number;
}

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

function args(p: Json): Record<string, string> {
  return (p.args as Record<string, string> | undefined) ?? {};
}

function list(text: string | undefined): string[] {
  return (text ?? '').split(',').filter((part) => part.length > 0);
}

function pairs(value: unknown): Pair[] {
  return ((value as Pair[] | undefined) ?? []).filter((a) => a.item !== NOTHING).map((a) => ({ item: a.item, status: a.status }));
}

function sortedPairs(value: readonly Pair[]): string {
  return JSON.stringify([...value].sort((a, b) => a.item - b.item || a.status - b.status));
}

function snapshot(o: ItemObject): Pair[] {
  return o.attachments.filter((a) => a.item !== NOTHING).map((a) => ({ item: a.item, status: a.status }));
}

function boxSessionChanged(before: readonly Pair[], after: readonly Pair[]): boolean {
  const found = (from: readonly Pair[], within: readonly Pair[]) =>
    from.every((a) => within.some((b) => b.item === a.item && b.status === a.status));
  return !found(before, after) || !found(after, before);
}

export class AttachComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
  }

  async #sim(): Promise<TacticalSim> {
    if (!this.#bytes) throw new Error('attach probes need a save');
    const { session } = await createTacticalSaveSession(this.#read, this.#bytes, SEED, this.#exists);
    const sim = session.campaign.tactical;
    if (!sim) throw new Error('the save has no tactical sector');
    return sim;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    try {
      const sim = await this.#sim();
      return this.#attachBox(label, sim, p);
    } catch (err) {
      return report(label, false, (err as Error).message);
    }
  }

  #item(sim: TacticalSim, name: string): number {
    const index = sim.state.content.items.byName.get(name)?.index;
    if (index === undefined) throw new Error(`unknown item ${name}`);
    return index;
  }

  #object(sim: TacticalSim, text: string): ItemObject {
    const [name, status] = text.split(':');
    return createItem(sim.state.content.items, this.#item(sim, name ?? ''), Number(status));
  }

  #pocket(owner: Soldier, o: ItemObject): number {
    const slot = FREE_POCKETS.find((k) => owner.inv[k]?.item === NOTHING);
    if (slot === undefined) throw new Error(`soldier ${owner.id} has no free pocket for the cursor item`);
    owner.inv[slot] = o;
    return slot;
  }

  #replay(sim: TacticalSim, p: Json): Replay {
    const a = args(p);
    const t = sim.state;
    const soldier = (id: unknown) => {
      const s = t.soldiers[Number(id)];
      if (!s) throw new Error(`no soldier ${String(id)}`);
      return s;
    };
    const owner = soldier(a.who);
    const cursorOwner = a.cursorWho === undefined ? owner : soldier(a.cursorWho);
    const slot = Number(a.slot ?? InvSlot.HAND);
    if (a.host) owner.inv[slot] = this.#object(sim, a.host);
    const host = owner.inv[slot] as ItemObject;
    list(a.hostAttach).forEach((text, k) => {
      const [name, status] = text.split(':');
      host.attachments[k] = { item: this.#item(sim, name ?? ''), status: Number(status) };
    });
    if (a.ap !== undefined) owner.actionPoints = Number(a.ap);
    if (cursorOwner !== owner && a.cursorAp !== undefined) cursorOwner.actionPoints = Number(a.cursorAp);
    t.inCombat = Number(a.incombat ?? 0) === 1;
    let cursor: Cursor | null = a.cursor ? { owner: cursorOwner, slot: this.#pocket(cursorOwner, this.#object(sim, a.cursor)) } : null;
    const payer = cursor ? cursorOwner : owner;
    const opened = sim.dispatch({
      type: 'openItemDescription',
      soldier: payer.id,
      slot,
      ...(payer !== owner ? { toSoldier: owner.id } : {}),
    });
    if (!opened.ok) throw new Error(`the box did not open: ${opened.reason}`);
    for (const step of list(a.steps)) {
      if (step.includes(':')) {
        cursor = { owner: cursorOwner, slot: this.#pocket(cursorOwner, this.#object(sim, step)) };
        continue;
      }
      const position = Number(step.slice('click'.length));
      if (cursor) {
        sim.dispatch({
          type: 'attach',
          soldier: cursor.owner.id,
          item: cursor.slot,
          to: slot,
          ...(cursor.owner !== owner ? { toSoldier: owner.id } : {}),
        });
        if (cursor.owner.inv[cursor.slot]?.item === NOTHING) cursor = null;
        continue;
      }
      const detach = sim.dispatch({ type: 'detach', soldier: owner.id, slot, attachment: position });
      const landed = detach.ok ? (detach.data as { leftover?: { slot: number } } | undefined)?.leftover : undefined;
      cursor = landed ? { owner, slot: landed.slot } : null;
    }
    if (t.itemDescription) sim.dispatch({ type: 'closeItemDescription' });
    return {
      attachments: snapshot(host),
      hostItem: host.item,
      hostStatus: host.status[0] ?? 0,
      ap: owner.actionPoints,
      cursorAp: cursorOwner.actionPoints,
    };
  }

  #attachBox(label: string, sim: TacticalSim, p: Json): number {
    const replay = this.#replay(sim, p);
    const who = Number(p.who);
    const payer = Number(p.cursorWho);
    const nativeHost = (p.host as Json | undefined) ?? {};
    const sameAttachments = sortedPairs(pairs(p.attachmentsAfter)) === sortedPairs(replay.attachments);
    const sameHost = Number(nativeHost.item) === replay.hostItem && Number(nativeHost.status) === replay.hostStatus;
    const nativeOwn = Number(p.apBefore) - Number(p.apAfter);
    const nativeCursor = Number(p.cursorApBefore) - Number(p.cursorApAfter);
    const sessionCharge =
      p.inCombat === true && boxSessionChanged(pairs(p.attachmentsBefore), pairs(p.attachmentsAfter)) ? AP_RELOAD_GUN : 0;
    const nativeRule = payer === who ? nativeOwn === sessionCharge : nativeCursor === sessionCharge && nativeOwn === 0;
    const sameAp = replay.ap === Number(p.apAfter) && replay.cursorAp === Number(p.cursorApAfter);
    const problems = [
      sameAttachments ? '' : `attachments ${sortedPairs(replay.attachments)} vs ${sortedPairs(pairs(p.attachmentsAfter))}`,
      sameHost ? '' : `host ${replay.hostItem}:${replay.hostStatus} vs ${String(nativeHost.item)}:${String(nativeHost.status)}`,
      nativeRule ? '' : 'the native charge breaks the box rule',
      sameAp ? '' : 'the AP differ',
    ].filter((x) => x.length > 0);
    const detail = `ap ${replay.ap}/${String(p.apAfter)}, cursor ap ${replay.cursorAp}/${String(p.cursorApAfter)}`;
    return report(label, problems.length === 0, [detail, ...problems].join('; '));
  }
}

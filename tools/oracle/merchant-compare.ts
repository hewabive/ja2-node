import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSaveGame } from '../../src/content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../../src/content/formats/savegame-header.ts';
import { readSavedMerchants } from '../../src/content/formats/savegame-merchants.ts';
import { readStrategicAiSections } from '../../src/content/formats/savegame-strategic-ai.ts';
import { ItemClass, type ItemTable, loadItemTable, NOTHING } from '../../src/content/items/items.ts';
import { DealerType, loadMerchantContent, type MerchantContent } from '../../src/content/strategic/merchant-content.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { createItems, type ItemObject, MAX_ATTACHMENTS, MAX_OBJECTS_PER_SLOT, NO_PROFILE } from '../../src/sim/items/object.ts';
import {
  type DealerBox,
  determineArmsDealersSellingInventory,
  type RepairedItem,
} from '../../src/sim/strategic/economy/merchants/boxes.ts';
import {
  createMerchantContext,
  type MerchantContext,
  MerchantFact,
  type ShopHours,
} from '../../src/sim/strategic/economy/merchants/context.ts';
import {
  canDealerTransactItem,
  dailyUpdateOfArmsDealersInventory,
  estoniRefuellingBecamePossible,
  initAllArmsDealers,
} from '../../src/sim/strategic/economy/merchants/daily.ts';
import { addObjectToArmsDealerInventory } from '../../src/sim/strategic/economy/merchants/inventory.ts';
import {
  calcShopKeeperItemPrice,
  calcValueOfItemToDealer,
  itemConditionModifier,
} from '../../src/sim/strategic/economy/merchants/pricing.ts';
import {
  calculateMinutesClosedBetween,
  calculateObjectItemRepairCost,
  calculateObjectItemRepairTime,
  calculateOvernightRepairDelay,
  canDealerRepairItem,
  giveObjectToArmsDealerForRepair,
  handlePossibleRepairDelays,
} from '../../src/sim/strategic/economy/merchants/repair.ts';
import { importMerchants } from '../../src/sim/strategic/economy/merchants/save-import.ts';
import { createMerchantState, type DealerSpecialItem, type MerchantState } from '../../src/sim/strategic/economy/merchants/state.ts';
import { REALLY_BADLY_DAMAGED_THRESHOLD } from '../../src/sim/strategic/economy/merchants/trade.ts';
import type { RollSource } from '../../src/sim/strategic/forces/ports.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];

export const MERCHANT_PROBES: ReadonlySet<string> = new Set([
  'dealers',
  'dealerinit',
  'dealerdaily',
  'progress',
  'fact',
  'dealerprice',
  'dealersell',
  'shophours',
  'dealerrepair',
  'skiptime',
  'dealergive',
  'ski',
]);

const MAIN = 'm';
const PRE = 'p';
const MAX_REPORTED = 6;
const OFFER_AREA_SLOTS = 12;
const ITEM_REPAIRED = 0x20;
const ITEM_NOT_REPAIRED_YET = 0x10;
const REPAIR_FLAGS = ITEM_REPAIRED | ITEM_NOT_REPAIRED_YET;
const EVAL_NORMAL = 0;
const EVAL_REALLY_DAMAGED = 1;
const EVAL_WORTHLESS = 3;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_DAY = 1440;

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

class ReplayMismatch extends Error {}

class Replay {
  readonly #draws: readonly Draw[];
  #at = 0;

  constructor(draws: readonly Draw[]) {
    this.#draws = draws.filter((d) => d[0] === MAIN || d[0] === PRE);
  }

  get left(): number {
    return this.#draws.length - this.#at;
  }

  take(stream: string, n: number): number {
    const d = this.#draws[this.#at];
    if (!d) throw new ReplayMismatch(`draw #${this.#at}: native log exhausted, ja2-node wants ${stream} range ${n}`);
    if (d[0] !== stream || d[1] !== n)
      throw new ReplayMismatch(`draw #${this.#at}: ja2-node wants ${stream} range ${n}, native drew ${d[0]} range ${d[1]} (value ${d[2]})`);
    this.#at++;
    return d[2];
  }
}

class StreamRolls implements RollSource {
  readonly #stream: string;
  replay: Replay = new Replay([]);

  constructor(stream: string) {
    this.#stream = stream;
  }

  int(n: number): number {
    return n === 0 ? 0 : this.replay.take(this.#stream, n);
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }
}

function differences(ours: unknown, theirs: unknown, path = ''): string[] {
  if (sameJson(ours, theirs)) return [];
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    const out: string[] = [];
    if (ours.length !== theirs.length) out.push(`${path}.length ${ours.length}/${theirs.length}`);
    for (let k = 0; k < Math.min(ours.length, theirs.length) && out.length < MAX_REPORTED; k++)
      out.push(...differences(ours[k], theirs[k], `${path}[${k}]`));
    return out.slice(0, MAX_REPORTED);
  }
  if (ours && theirs && typeof ours === 'object' && typeof theirs === 'object') {
    const out: string[] = [];
    for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      if (out.length >= MAX_REPORTED) break;
      out.push(...differences((ours as Json)[key], (theirs as Json)[key], `${path}.${key}`));
    }
    return out;
  }
  return [`${path} ${JSON.stringify(ours)}/${JSON.stringify(theirs)}`];
}

function describeSpecial(s: DealerSpecialItem): number[] {
  const i = s.info;
  return [s.active ? 1 : 0, i.condition, i.imprint, ...i.attachments, ...i.attachmentStatus, s.repairDoneTime, s.owner];
}

function describeDealers(state: MerchantState, dealers: number): Json[] {
  return state.dealers.slice(0, dealers).map((d) => ({
    cash: d.status.cash,
    flags: d.status.flags,
    out: d.status.outOfBusiness,
    delayUsed: d.status.repairDelayUsed,
    unused: d.status.unusedKnowsPlayer,
    lastSki: d.status.lastSkiMinute,
    items: d.headers.flatMap((h, item) => {
      const empty =
        h.total === 0 &&
        h.perfect === 0 &&
        h.strayAmmo === 0 &&
        h.orderArrivalDay === 0 &&
        h.qtyOnOrder === 0 &&
        !h.previouslyEligible &&
        h.specials.length === 0;
      if (empty) return [];
      return [
        [
          item,
          h.total,
          h.perfect,
          h.strayAmmo,
          h.orderArrivalDay,
          h.qtyOnOrder,
          h.previouslyEligible ? 1 : 0,
          h.specials.map(describeSpecial),
        ],
      ];
    }),
  }));
}

function describeObject(items: ItemTable, o: ItemObject): number[] {
  const gun = items.byIndex.get(o.item)?.itemClass === ItemClass.GUN;
  const attachments = Array.from({ length: MAX_ATTACHMENTS }, (_, k) => [
    o.attachments[k]?.item ?? 0,
    o.attachments[k]?.status ?? 0,
  ]).flat();
  return [
    o.item,
    o.count,
    o.status[0] ?? 0,
    gun ? o.gunAmmoItem : -1,
    gun ? o.gunShotsLeft : -1,
    gun ? o.gunAmmoStatus : -1,
    o.imprintId,
    ...attachments,
  ];
}

function nativeObject(items: ItemTable, desc: readonly number[]): number[] {
  const gun = items.byIndex.get(desc[0] ?? 0)?.itemClass === ItemClass.GUN;
  const d = [...desc];
  if (!gun) {
    d[3] = -1;
    d[4] = -1;
    d[5] = -1;
  }
  return d;
}

function args(p: Json): Record<string, string> {
  return (p.args ?? {}) as Record<string, string>;
}

export class MerchantComparer {
  readonly #read: ReadFile;
  #items: ItemTable | null = null;
  #content: MerchantContent | null = null;
  readonly #state: MerchantState = createMerchantState();
  readonly #main = new StreamRolls(MAIN);
  readonly #pre = new StreamRolls(PRE);
  readonly #world = { gunNut: false, progress: 0, day: 0, minutes: 0 };
  readonly #facts = new Map<number, boolean>();
  #hours: ShopHours | null = null;
  #ctx: MerchantContext | null = null;

  constructor(read: ReadFile) {
    this.#read = read;
  }

  async #context(): Promise<MerchantContext> {
    if (this.#ctx) return this.#ctx;
    this.#items ??= await loadItemTable(async (path) => {
      const bytes = await this.#read(path);
      if (!bytes) throw new Error(`missing ${path}`);
      return JSON.parse(new TextDecoder().decode(bytes));
    });
    this.#content ??= await loadMerchantContent(this.#read, this.#items);
    const world = this.#world;
    this.#ctx = createMerchantContext(
      {
        content: this.#content,
        items: this.#items,
        hooks: { fact: (id) => this.#facts.get(id) === true, shopHours: () => this.#hours },
      },
      this.#state,
      { random: this.#main, preRandom: this.#pre },
      {
        gunNut: () => world.gunNut,
        highestProgress: () => world.progress,
        worldDay: () => world.day,
        worldMinutes: () => world.minutes,
      },
    );
    return this.#ctx;
  }

  setOptions(p: Json): void {
    if (typeof p.gunNut === 'boolean') this.#world.gunNut = p.gunNut;
  }

  async loadSave(savesDir: string, name: string): Promise<void> {
    await this.#context();
    const bytes = new Uint8Array(readFileSync(join(savesDir, `${name}.sav`)));
    const table = await this.#read(SAVE_ENCRYPTION_PATH);
    if (!table) throw new Error(`missing ${SAVE_ENCRYPTION_PATH}`);
    const save = parseSaveGame(bytes, parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(table))));
    importMerchants(this.#state, readSavedMerchants(bytes, save.sections));
    this.#world.gunNut = save.header.initialGameOptions.gunNut;
    this.#world.progress = readStrategicAiSections(bytes, save).status.highestProgress;
    this.#world.minutes = Math.trunc(save.clock.gameClock / SECONDS_PER_MINUTE);
    this.#world.day = Math.trunc(this.#world.minutes / MINUTES_PER_DAY);
    this.#facts.clear();
    for (const [id, v] of save.facts.entries()) this.#facts.set(id, v !== 0);
    this.#hours = null;
  }

  #applyContext(p: Json): void {
    if (typeof p.worldDay === 'number') this.#world.day = p.worldDay;
    if (typeof p.worldMinutes === 'number') this.#world.minutes = p.worldMinutes;
    if (typeof p.progress === 'number') this.#world.progress = p.progress;
    if (typeof p.gunNut === 'boolean') this.#world.gunNut = p.gunNut;
    if (typeof p.estoni === 'boolean') this.#facts.set(MerchantFact.ESTONI_REFUELLING_POSSIBLE, p.estoni);
  }

  #replay(label: string, draws: readonly Draw[], run: () => void): string | null {
    const replay = new Replay(draws);
    this.#main.replay = replay;
    this.#pre.replay = replay;
    try {
      run();
    } catch (e) {
      if (e instanceof ReplayMismatch) return `${label}: ${e.message}`;
      throw e;
    } finally {
      this.#main.replay = new Replay([]);
      this.#pre.replay = new Replay([]);
    }
    return replay.left === 0 ? null : `${label}: ${replay.left} native draws left`;
  }

  #compareDealers(label: string, theirs: unknown, extra: string[] = []): number {
    const dealers = Array.isArray(theirs) ? theirs.length : 0;
    const ours = describeDealers(this.#state, dealers);
    const diff = [...extra, ...differences(ours, theirs)];
    return report(label, diff.length === 0, diff.length === 0 ? `${dealers} dealers` : diff.join('; '));
  }

  async compare(p: Json): Promise<number> {
    const ctx = await this.#context();
    const label = `${p.probe} line ${p.line}`;
    switch (p.probe) {
      case 'dealers':
        this.#applyContext(p);
        return this.#compareDealers(label, p.dealers);
      case 'dealerinit': {
        this.#applyContext(p);
        const problem = this.#replay(label, p.draws as Draw[], () => initAllArmsDealers(ctx));
        return this.#compareDealers(`${label} (${(p.draws as Draw[]).length} draws)`, p.dealers, problem ? [problem] : []);
      }
      case 'dealerdaily': {
        this.#applyContext(p);
        const problem = this.#replay(label, p.draws as Draw[], () => dailyUpdateOfArmsDealersInventory(ctx));
        return this.#compareDealers(`${label} day ${p.day} (${(p.draws as Draw[]).length} draws)`, p.dealers, problem ? [problem] : []);
      }
      case 'progress':
        this.#world.progress = Number(p.highest);
        return 0;
      case 'fact':
        return this.#compareFact(ctx, label, p);
      case 'shophours':
        this.#hours = p.active ? { open: Number(p.open), close: Number(p.close) } : null;
        return 0;
      case 'skiptime':
        this.#world.minutes = Math.trunc(Number(p.worldSeconds) / SECONDS_PER_MINUTE);
        this.#world.day = Math.trunc(this.#world.minutes / MINUTES_PER_DAY);
        return 0;
      case 'dealerprice':
        return this.#comparePrice(ctx, label, p);
      case 'dealersell':
        return this.#compareSell(ctx, label, p);
      case 'dealerrepair':
        return this.#compareRepair(ctx, label, p);
      case 'dealergive':
        return this.#compareGive(ctx, label, p);
      default:
        return this.#compareSki(ctx, label, p);
    }
  }

  #compareFact(ctx: MerchantContext, label: string, p: Json): number {
    const id = Number(p.id);
    const value = p.value === true;
    const was = this.#facts.get(id) === true;
    const problem = this.#replay(label, p.draws as Draw[], () => {
      if (value && id === MerchantFact.ESTONI_REFUELLING_POSSIBLE && !was) estoniRefuellingBecamePossible(ctx);
    });
    this.#facts.set(id, value);
    return report(label, problem === null, problem ?? `fact ${id} = ${value}`);
  }

  #object(ctx: MerchantContext, a: Record<string, string>): ItemObject {
    const items = ctx.items;
    const id = (name: string) => (/^\d+$/.test(name) ? Number(name) : (items.byName.get(name)?.index ?? NOTHING));
    const item = id(a.item ?? '');
    const status = a.status === undefined ? 100 : Number(a.status);
    const count = a.count === undefined ? 1 : Number(a.count);
    const o = createItems(items, item, status, Math.min(count, MAX_OBJECTS_PER_SLOT));
    if (count > MAX_OBJECTS_PER_SLOT) o.count = count;
    if (a.ammo !== undefined) {
      const [ammo, rounds] = a.ammo.split(':');
      o.gunAmmoItem = id(ammo ?? '');
      if (items.byIndex.get(o.gunAmmoItem)?.itemClass === ItemClass.AMMO) o.gunShotsLeft = Number(rounds);
      else o.gunAmmoStatus = Number(rounds);
    }
    if (a.imprint !== undefined) o.imprintId = Number(a.imprint);
    if (a.statuses)
      a.statuses.split(',').forEach((v, k) => {
        if (k < MAX_OBJECTS_PER_SLOT) o.status[k] = Number(v);
      });
    if (a.attach) {
      a.attach.split(',').forEach((part, k) => {
        const [name, value] = part.split(':');
        const slot = o.attachments[k];
        if (!slot) return;
        slot.item = id(name ?? '');
        slot.status = Number(value);
      });
    }
    return o;
  }

  #comparePrice(ctx: MerchantContext, label: string, p: Json): number {
    const a = args(p);
    const dealer = Number(a.dealer);
    const merc = a.merc === undefined ? NO_PROFILE : Number(a.merc);
    const o = this.#object(ctx, a);
    const d = ctx.content.dealers[dealer];
    if (!d) return report(label, false, `no dealer ${dealer}`);
    const m = ctx.content.weaponSaleModifiers.get(merc) ?? 100;
    const price = (selling: boolean, unitOnly: boolean) =>
      calcShopKeeperItemPrice(
        ctx,
        { dealer, dealerSelling: selling, unitOnly, modifier: selling ? d.sellingPrice : d.buyingPrice, weaponSaleModifier: m },
        o,
      );
    const ours: Json = {
      object: describeObject(ctx.items, o),
      value: [calcValueOfItemToDealer(ctx, dealer, o.item, true), calcValueOfItemToDealer(ctx, dealer, o.item, false)],
      condition: itemConditionModifier(ctx.items, o.item, o.status[0] ?? 0),
    };
    if (d.type !== DealerType.REPAIRS) {
      ours.selling = [price(true, true), price(true, false)];
      ours.buying = [price(false, true), price(false, false)];
      const buying = price(false, false);
      const damaged = ctx.items.byIndex.get(o.item)?.itemClass !== ItemClass.AMMO && (o.status[0] ?? 0) < REALLY_BADLY_DAMAGED_THRESHOLD;
      ours.eval = [buying > 0 ? (damaged ? EVAL_REALLY_DAMAGED : EVAL_NORMAL) : EVAL_WORTHLESS, buying];
    }
    const value = () => calcValueOfItemToDealer(ctx, dealer, o.item, false);
    ours.transact = [
      canDealerTransactItem(ctx, d, o.item, false, value) ? 1 : 0,
      canDealerTransactItem(ctx, d, o.item, true, value) ? 1 : 0,
    ];
    const theirs: Json = { object: nativeObject(ctx.items, p.object as number[]), value: p.value, condition: p.condition };
    if (d.type !== DealerType.REPAIRS) {
      theirs.selling = p.selling;
      theirs.buying = p.buying;
      theirs.eval = p.eval;
    }
    theirs.transact = p.transact;
    const diff = differences(ours, theirs);
    return report(label, diff.length === 0, diff.length === 0 ? `${a.item} at ${dealer}` : diff.join('; '));
  }

  #compareSell(ctx: MerchantContext, label: string, p: Json): number {
    this.#applyContext(p);
    const a = args(p);
    const o = this.#object(ctx, a);
    const object = describeObject(ctx.items, o);
    const theirs = nativeObject(ctx.items, p.object as number[]);
    addObjectToArmsDealerInventory(ctx, Number(a.dealer), o);
    const extra = sameJson(object, theirs) ? [] : [`object ${JSON.stringify(object)}/${JSON.stringify(theirs)}`];
    return this.#compareDealers(`${label} ${a.item}`, p.dealers, extra);
  }

  #compareRepair(ctx: MerchantContext, label: string, p: Json): number {
    const a = args(p);
    const dealer = Number(a.dealer);
    const d = ctx.content.dealers[dealer];
    if (!d) return report(label, false, `no dealer ${dealer}`);
    const o = this.#object(ctx, a);
    const start = Number(p.start);
    const time = calculateObjectItemRepairTime(ctx, dealer, o);
    const ks = (a.ks ?? '')
      .split(',')
      .filter((k) => k.length > 0)
      .map(Number);
    const ours = {
      object: describeObject(ctx.items, o),
      cost: calculateObjectItemRepairCost(ctx, dealer, o),
      time,
      overnight: calculateOvernightRepairDelay(ctx, dealer, start, time),
      repairable: canDealerRepairItem(ctx, d, o.item),
      closed: ks.map((k) => calculateMinutesClosedBetween(ctx, dealer, start, start + k)),
    };
    const theirs = {
      object: nativeObject(ctx.items, p.object as number[]),
      cost: p.cost,
      time: p.time,
      overnight: p.overnight,
      repairable: p.repairable,
      closed: p.closed,
    };
    const diff = differences(ours, theirs);
    return report(
      label,
      diff.length === 0,
      diff.length === 0 ? `${a.item} at ${dealer}: $${ours.cost}, ${ours.time} min` : diff.join('; '),
    );
  }

  #compareGive(ctx: MerchantContext, label: string, p: Json): number {
    const a = args(p);
    this.#world.minutes = Number(p.worldMinutes);
    const dealer = Number(a.dealer);
    const o = this.#object(ctx, a);
    const element = giveObjectToArmsDealerForRepair(ctx, dealer, o, a.owner === undefined ? NO_PROFILE : Number(a.owner));
    const done = this.#state.dealers[dealer]?.headers[o.item]?.specials[element]?.repairDoneTime ?? -1;
    const same = element === Number(p.element) && done === Number(p.done);
    return report(label, same, `element ${element}/${p.element} done ${done}/${p.done}`);
  }

  #compareSki(ctx: MerchantContext, label: string, p: Json): number {
    this.#applyContext(p);
    const dealer = Number(p.dealer);
    const merc = Number(p.merc);
    const d = ctx.content.dealers[dealer];
    if (!d) return report(label, false, `no dealer ${dealer}`);
    const m = ctx.content.weaponSaleModifiers.get(merc) ?? 100;
    let delayed = false;
    let boxes: DealerBox[] = [];
    const offered: RepairedItem[] = [];
    const problem = this.#replay(label, p.draws as Draw[], () => {
      if (d.type === DealerType.REPAIRS) delayed = handlePossibleRepairDelays(ctx, dealer);
      const status = this.#state.dealers[dealer]?.status;
      if (status) status.lastSkiMinute = this.#world.minutes;
      boxes = determineArmsDealersSellingInventory(ctx, dealer, (r) => {
        if (offered.length >= OFFER_AREA_SLOTS) return false;
        offered.push(r);
        return true;
      });
    });
    const now = this.#world.minutes;
    const ours = {
      delayed,
      boxes: boxes.map((b) => ({
        item: b.key.item,
        element: b.key.element,
        count: b.object.count,
        flags: b.repairDoneTime === null ? 0 : b.repairDoneTime <= now ? ITEM_REPAIRED : ITEM_NOT_REPAIRED_YET,
        unitPrice:
          d.type === DealerType.REPAIRS
            ? 0
            : calcShopKeeperItemPrice(
                ctx,
                { dealer, dealerSelling: true, unitOnly: true, modifier: d.sellingPrice, weaponSaleModifier: m },
                b.object,
              ),
        owner: b.owner,
        object: describeObject(ctx.items, b.object),
      })),
      offered: offered.map((r) => ({ owner: r.owner, object: describeObject(ctx.items, r.object) })),
    };
    const nativeBoxes = (p.boxes as Json[]).map((b) => ({
      item: b.item,
      element: b.element,
      count: b.count,
      flags: Number(b.flags) & REPAIR_FLAGS,
      unitPrice: b.unitPrice,
      owner: b.owner,
      object: nativeObject(ctx.items, b.object as number[]),
    }));
    const theirs = {
      delayed: p.delayed,
      boxes: nativeBoxes,
      offered: (p.offered as Json[]).map((b) => ({ owner: b.owner, object: nativeObject(ctx.items, b.object as number[]) })),
    };
    const diff = differences(ours, theirs);
    if (problem) diff.unshift(problem);
    const boxesOk = report(
      label,
      diff.length === 0,
      diff.length === 0 ? `${ours.boxes.length} boxes, ${ours.offered.length} collected` : diff.join('; '),
    );
    return boxesOk + this.#compareDealers(`${label} dealers`, p.dealers);
  }
}

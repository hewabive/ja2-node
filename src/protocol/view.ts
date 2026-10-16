import type { ShopView } from '../sim/strategic/economy/merchants/view.ts';

export type { ShopBoxView, ShopEta, ShopKind, ShopView } from '../sim/strategic/economy/merchants/view.ts';

export interface SoldierView {
  readonly id: number;
  readonly team: number;
  readonly name: string;
  readonly bodyType: number;
  readonly gridNo: number;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly direction: number;
  readonly animation: number;
  readonly frame: number;
  readonly palettes: readonly [string, string, string, string];
  readonly hand: string;
  readonly ap?: number;
  readonly life?: number;
  readonly lifeMax?: number;
  readonly breath?: number;
  readonly merchant?: string;
}

export interface ItemView {
  readonly gridNo: number;
  readonly level: number;
  readonly item: string;
  readonly count: number;
  readonly status: number;
}

export interface CombatView {
  readonly team: number;
  readonly round: number;
  readonly interrupt: boolean;
}

export interface ClockView {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly compressing: boolean;
}

export interface StrategicSectorView {
  readonly sector: string;
  readonly visited: boolean;
  readonly town: number;
  readonly playerControlled: boolean | null;
  readonly enemies: number | '?' | null;
  readonly militia: readonly number[];
}

export interface ContractTimeView {
  readonly day: number;
  readonly hour: number;
}

export type MercContractView =
  | {
      readonly type: 'aim';
      readonly totalDays: number;
      readonly remaining: { readonly days: number; readonly hours: number };
      readonly endsAt: ContractTimeView;
      readonly lastContract: 'day' | 'week' | 'twoWeeks';
      readonly dailyRate: number;
      readonly renewalCosts: { readonly day: number; readonly week: number; readonly twoWeeks: number };
      readonly medicalDeposit: number;
      readonly insured: boolean;
      readonly insuranceDays: number;
    }
  | { readonly type: 'merc'; readonly unpaidDays: number; readonly daysHired: number; readonly owed: number }
  | { readonly type: 'rpc'; readonly dailyRate: number };

export interface StrategicMercView {
  readonly id: number;
  readonly name: string;
  readonly sector: string;
  readonly betweenSectors: boolean;
  readonly squad: number | null;
  readonly assignment: number;
  readonly life: number;
  readonly lifeMax: number;
  readonly breath: number;
  readonly breathMax: number;
  readonly asleep: boolean;
  readonly kind?: string;
  readonly contract?: MercContractView | null;
  readonly morale?: number;
  readonly moraleText?: string;
  readonly daysServed?: number;
  readonly totalCost?: number;
}

export interface StrategicGroupView {
  readonly id: number;
  readonly sector: string;
  readonly next: string | null;
  readonly betweenSectors: boolean;
  readonly members: readonly number[];
  readonly etaMinutes: number;
  readonly path: readonly string[];
}

export interface StrategicView {
  readonly balance: number;
  readonly worldSector: string | null;
  readonly flow: 'strategic' | 'tactical' | 'autoresolve';
  readonly sectors: readonly StrategicSectorView[];
  readonly mercs: readonly StrategicMercView[];
  readonly groups: readonly StrategicGroupView[];
  readonly mercAccountStatus?: string;
}

export interface PromptOptionView {
  readonly choice: string;
  readonly enabled: boolean;
  readonly reason?: string;
}

export interface InvolvedMercView {
  readonly soldier: number;
  readonly name: string;
  readonly assignment: number;
  readonly condition: string;
  readonly hp: number;
  readonly bp: number;
}

export interface UninvolvedMercView {
  readonly soldier: number;
  readonly name: string;
  readonly assignment: number;
  readonly location: string;
  readonly destination?: string;
}

export type PromptView =
  | {
      readonly id: string;
      readonly kind: 'preBattle';
      readonly sector: string;
      readonly persistent: boolean;
      readonly encounter: string;
      readonly enemies: number | 'unknown';
      readonly militia: number;
      readonly involved: readonly InvolvedMercView[];
      readonly uninvolved: readonly UninvolvedMercView[];
      readonly options: readonly PromptOptionView[];
    }
  | { readonly id: string; readonly kind: 'surrender'; readonly choices: readonly string[] }
  | {
      readonly id: string;
      readonly kind: 'autoresolveDone';
      readonly status: string;
      readonly canBandage: boolean;
      readonly choices: readonly string[];
    }
  | {
      readonly id: string;
      readonly kind: 'simultaneousArrival';
      readonly sector: string;
      readonly groups: number;
      readonly choices: readonly string[];
    }
  | {
      readonly id: string;
      readonly kind: 'npcOfNote';
      readonly group: number;
      readonly sector: string;
      readonly choices: readonly string[];
    };

export type ContractPromptView =
  | {
      readonly id: string;
      readonly kind: 'contractRenewal';
      readonly soldier: number;
      readonly name: string;
      readonly fromSequence: boolean;
      readonly balance: number;
      readonly options: readonly ContractOptionView[];
    }
  | {
      readonly id: string;
      readonly kind: 'mercDeparture';
      readonly soldier: number;
      readonly name: string;
      readonly sector: string;
      readonly choices: readonly string[];
      readonly elsewhereSector: string | null;
    }
  | {
      readonly id: string;
      readonly kind: 'insuranceExtension';
      readonly soldier: number;
      readonly name: string;
      readonly days: number;
      readonly cost: number;
      readonly choices: readonly string[];
    };

export interface ContractOptionView {
  readonly choice: string;
  readonly cost?: number;
  readonly enabled: boolean;
  readonly reason?: string;
}

export interface AutoresolveCellView {
  readonly side: 'merc' | 'militia' | 'enemy';
  readonly index: number;
  readonly kind: string;
  readonly state: 'alive' | 'unconscious' | 'dead' | 'retreating' | 'retreated';
  readonly soldier?: number;
  readonly name?: string;
  readonly life?: number;
  readonly lifeMax?: number;
  readonly bleeding?: number;
  readonly breathMax?: number;
  readonly morale?: number;
  readonly health?: string;
  readonly hurt?: boolean;
}

export interface AutoresolveView {
  readonly sector: string;
  readonly status: string;
  readonly battleSeconds: number;
  readonly alive: { readonly mercs: number; readonly militia: number; readonly enemies: number };
  readonly cells: readonly AutoresolveCellView[];
}

export interface PlayerView {
  readonly tick: number;
  readonly mapPath: string | null;
  readonly clock?: ClockView;
  readonly strategic?: StrategicView;
  readonly prompt?: PromptView | null;
  readonly contractPrompt?: ContractPromptView | null;
  readonly autoresolve?: AutoresolveView | null;
  readonly shop?: ShopView | null;
  readonly soldiers: readonly SoldierView[];
  readonly openDoors?: readonly number[];
  readonly combat?: CombatView | null;
  readonly revealedRooms?: readonly number[];
  readonly items?: readonly ItemView[];
}

export interface ViewFrame {
  readonly tick: number;
  readonly changed: readonly SoldierView[];
  readonly removed: readonly number[];
  readonly mapPath?: string | null;
  readonly clock?: ClockView;
  readonly strategic?: StrategicView;
  readonly prompt?: PromptView | null;
  readonly contractPrompt?: ContractPromptView | null;
  readonly autoresolve?: AutoresolveView | null;
  readonly shop?: ShopView | null;
  readonly openDoors?: readonly number[];
  readonly combat?: CombatView | null;
  readonly revealedRooms?: readonly number[];
  readonly items?: readonly ItemView[];
}

function sameItems(a: readonly ItemView[] | undefined, b: readonly ItemView[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => {
    const w = b[i];
    return !!w && v.gridNo === w.gridNo && v.level === w.level && v.item === w.item && v.count === w.count && v.status === w.status;
  });
}

function sameCombat(a: CombatView | null | undefined, b: CombatView | null | undefined): boolean {
  if (!a || !b) return !a === !b;
  return a.team === b.team && a.round === b.round && a.interrupt === b.interrupt;
}

function sameList(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function diffPlayerView(previous: PlayerView, next: PlayerView): ViewFrame | null {
  let frame = diffView(previous.soldiers, next.soldiers, next.tick);
  if (!sameList(previous.openDoors, next.openDoors))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), openDoors: next.openDoors ?? [] };
  if (!sameList(previous.revealedRooms, next.revealedRooms))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), revealedRooms: next.revealedRooms ?? [] };
  if (!sameItems(previous.items, next.items))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), items: next.items ?? [] };
  if (!sameCombat(previous.combat, next.combat))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), combat: next.combat ?? null };
  if (previous.mapPath !== next.mapPath) frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), mapPath: next.mapPath };
  if (next.clock && !sameClock(previous.clock, next.clock))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), clock: next.clock };
  if (next.strategic && JSON.stringify(previous.strategic) !== JSON.stringify(next.strategic))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), strategic: next.strategic };
  if (JSON.stringify(previous.prompt ?? null) !== JSON.stringify(next.prompt ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), prompt: next.prompt ?? null };
  if (JSON.stringify(previous.contractPrompt ?? null) !== JSON.stringify(next.contractPrompt ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), contractPrompt: next.contractPrompt ?? null };
  if (JSON.stringify(previous.autoresolve ?? null) !== JSON.stringify(next.autoresolve ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), autoresolve: next.autoresolve ?? null };
  if (JSON.stringify(previous.shop ?? null) !== JSON.stringify(next.shop ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), shop: next.shop ?? null };
  return frame;
}

function sameClock(a: ClockView | undefined, b: ClockView): boolean {
  return !!a && a.day === b.day && a.hour === b.hour && a.minute === b.minute && a.compressing === b.compressing;
}

function sameSoldier(a: SoldierView, b: SoldierView): boolean {
  return (
    a.gridNo === b.gridNo &&
    a.x === b.x &&
    a.y === b.y &&
    a.level === b.level &&
    a.direction === b.direction &&
    a.animation === b.animation &&
    a.frame === b.frame &&
    a.team === b.team &&
    a.bodyType === b.bodyType &&
    a.hand === b.hand &&
    a.ap === b.ap &&
    a.life === b.life &&
    a.lifeMax === b.lifeMax &&
    a.breath === b.breath &&
    a.merchant === b.merchant
  );
}

export function diffView(previous: readonly SoldierView[], next: readonly SoldierView[], tick: number): ViewFrame | null {
  const before = new Map(previous.map((s) => [s.id, s]));
  const changed = next.filter((s) => {
    const old = before.get(s.id);
    return !old || !sameSoldier(old, s);
  });
  const nextIds = new Set(next.map((s) => s.id));
  const removed = previous.filter((s) => !nextIds.has(s.id)).map((s) => s.id);
  return changed.length === 0 && removed.length === 0 ? null : { tick, changed, removed };
}

export function applyFrame(soldiers: readonly SoldierView[], frame: ViewFrame): SoldierView[] {
  const byId = new Map(soldiers.map((s) => [s.id, s]));
  for (const id of frame.removed) byId.delete(id);
  for (const s of frame.changed) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

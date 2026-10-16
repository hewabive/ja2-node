import type { ShopView } from '../sim/strategic/economy/merchants/view.ts';
import type { DoorView, KeyView } from '../sim/tactical/doors/door-view.ts';
import { type InventoryItemView, sameInventory } from '../sim/tactical/inventory-view.ts';

export type { ShopBoxView, ShopEta, ShopKind, ShopView } from '../sim/strategic/economy/merchants/view.ts';
export type { DoorView, KeyView } from '../sim/tactical/doors/door-view.ts';
export type { InventoryItemView } from '../sim/tactical/inventory-view.ts';

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
  readonly inventory?: readonly InventoryItemView[];
  readonly keys?: readonly KeyView[];
  readonly merchant?: string;
  readonly profile?: number;
  readonly talkable?: string;
  readonly kind?: string;
  readonly controlled?: boolean;
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
  readonly arrival?: { readonly day: number; readonly hour: number; readonly minute: number };
  readonly vehicle?: number;
  readonly controlled?: boolean;
}

export interface StrategicVehicleView {
  readonly id: number;
  readonly kind: string;
  readonly sector: string;
  readonly betweenSectors: boolean;
  readonly passengers: readonly number[];
  readonly seats: number;
  readonly path: readonly string[];
}

export interface RefuelSiteView {
  readonly sector: string;
  readonly available: boolean;
}

export interface StrategicHelicopterView {
  readonly vehicle: number;
  readonly sector: string;
  readonly next: string | null;
  readonly airborne: boolean;
  readonly hovering: boolean;
  readonly returning: boolean;
  readonly passengers: readonly number[];
  readonly seats: number;
  readonly canFly: boolean;
  readonly reason?: string;
  readonly owed: number;
  readonly hits: number;
  readonly path: readonly string[];
  readonly etaMinutes: number;
  readonly safeSectors: number;
  readonly unsafeSectors: number;
  readonly routeCost: number;
  readonly refuelSites: readonly RefuelSiteView[];
}

export interface DestroyedHelicopterView {
  readonly destroyed: true;
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

export interface QuestStepView {
  readonly minute: number;
  readonly sector: string | null;
}

export interface QuestLogEntryView {
  readonly id: number;
  readonly quest: string;
  readonly started: QuestStepView | null;
  readonly finished: QuestStepView | null;
}

export interface MeanwhileLogView {
  readonly seq: number;
  readonly scene: string;
  readonly at: number;
}

export interface MeanwhileSceneView {
  readonly seq: number;
  readonly scene: string;
}

export interface CampaignEndingView {
  readonly miguelAlive: boolean;
  readonly skyriderAlive: boolean;
}

export interface CampaignEndedView {
  readonly outcome: 'victory';
  readonly at: number;
  readonly day: number;
  readonly ending: CampaignEndingView;
  readonly mercDeaths: number;
}

export interface StrategicView {
  readonly balance: number;
  readonly worldSector: string | null;
  readonly flow: 'strategic' | 'tactical' | 'autoresolve' | 'laptop' | 'meanwhile' | 'endgame' | 'ended';
  readonly campaign: 'playing' | 'endgame' | 'won';
  readonly noUsableMercs?: boolean;
  readonly meanwhiles: readonly MeanwhileLogView[];
  readonly sectors: readonly StrategicSectorView[];
  readonly mercs: readonly StrategicMercView[];
  readonly groups: readonly StrategicGroupView[];
  readonly vehicles?: readonly StrategicVehicleView[];
  readonly helicopter?: StrategicHelicopterView | DestroyedHelicopterView;
  readonly mercAccountStatus?: string;
  readonly landingZone?: string;
  readonly unreadMail?: number;
  readonly quests: readonly QuestLogEntryView[];
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
  | {
      readonly id: string;
      readonly kind: 'surrender';
      readonly context: 'autoresolve' | 'tactical';
      readonly soldier?: number;
      readonly choices: readonly string[];
    }
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
    }
  | {
      readonly id: string;
      readonly kind: 'militiaPayment';
      readonly trainer: number;
      readonly sectors: readonly string[];
      readonly cost: number;
      readonly balance: number;
      readonly choices: readonly string[];
    }
  | {
      readonly id: string;
      readonly kind: 'militiaContinue';
      readonly trainer: number;
      readonly sector: string;
      readonly cost: number;
      readonly balance: number;
      readonly choices: readonly string[];
    };

export interface NpcRequestPromptView {
  readonly id: string;
  readonly kind: 'npcRequest';
  readonly request: string;
  readonly npc: number;
  readonly name: string;
  readonly merc?: number;
  readonly amount?: number;
  readonly pair?: boolean;
  readonly choices: readonly string[];
}

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

export interface LaptopTimeView {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export interface LaptopEmailView {
  readonly id: number;
  readonly type: string;
  readonly index?: number;
  readonly sender: number;
  readonly date: LaptopTimeView;
  readonly read: boolean;
  readonly firstData: number;
  readonly secondData: number;
}

export interface LaptopHistoryView {
  readonly code: number;
  readonly secondCode: number;
  readonly date: LaptopTimeView;
  readonly sector: string | null;
}

export interface LaptopFinanceView {
  readonly code: number;
  readonly secondCode: number;
  readonly date: LaptopTimeView;
  readonly amount: number;
  readonly balanceAfter: number;
}

export interface LaptopStatsView {
  readonly health: number;
  readonly agility: number;
  readonly dexterity: number;
  readonly strength: number;
  readonly leadership: number;
  readonly wisdom: number;
  readonly experience: number;
  readonly marksmanship: number;
  readonly mechanical: number;
  readonly explosives: number;
  readonly medical: number;
}

export interface LaptopItemView {
  readonly item: number;
  readonly name: string;
  readonly count: number;
}

export type AimFaceView = 'available' | 'hired' | 'dead' | 'pow' | 'onAssignment';

export interface AimMercView {
  readonly profile: number;
  readonly name: string;
  readonly nickname: string;
  readonly stats: LaptopStatsView;
  readonly salary: { readonly day: number; readonly week: number; readonly twoWeeks: number };
  readonly medicalDeposit: number | null;
  readonly kit: { readonly items: readonly LaptopItemView[]; readonly cost: number } | null;
  readonly face: AimFaceView;
}

export interface MercListingView {
  readonly profile: number;
  readonly name: string;
  readonly nickname: string;
  readonly stats: LaptopStatsView;
  readonly dailyFee: number;
  readonly state: AimFaceView;
  readonly unpaidDays: number;
  readonly owed: number;
}

export interface MercSiteView {
  readonly bookmarked: boolean;
  readonly siteDown: boolean;
  readonly accountStatus: string;
  readonly accountNumber: number | null;
  readonly listed: readonly MercListingView[];
  readonly totalOwed: number;
}

export interface ImpSiteView {
  readonly bookmarked: boolean;
  readonly charactersLeft: number;
  readonly canCreate: boolean;
  readonly cost: number;
  readonly pickSkillsDirectly: boolean;
}

export interface BobbyRayStockView {
  readonly item: number;
  readonly name: string;
  readonly price: number;
  readonly quantity: number;
  readonly quality: number;
}

export interface BobbyRayShipmentView {
  readonly index: number;
  readonly active: boolean;
  readonly destination: number;
  readonly speed: number;
  readonly orderDay: number;
  readonly lines: readonly { readonly item: number; readonly name: string; readonly count: number; readonly used: boolean }[];
}

export interface ShippingDestinationView {
  readonly id: number;
  readonly name: string;
  readonly rates: readonly [number, number, number];
  readonly flowers: { readonly nextDay: number; readonly whenItGetsThere: number };
  readonly canDeliver: boolean;
  readonly primary: boolean;
}

export interface BobbyRayView {
  readonly open: boolean;
  readonly newStock: readonly BobbyRayStockView[];
  readonly usedStock: readonly BobbyRayStockView[];
  readonly shipments: readonly BobbyRayShipmentView[];
  readonly destinations: readonly ShippingDestinationView[];
}

export interface InsuranceOfferView {
  readonly soldier: number;
  readonly profile: number;
  readonly name: string;
  readonly contractDaysLeft: number;
  readonly insuredDaysLeft: number;
  readonly insured: boolean;
  readonly offeredLength: number;
  readonly premium: number;
}

export interface InTransitView {
  readonly soldier: number;
  readonly profile: number;
  readonly name: string;
  readonly arrival: LaptopTimeView;
  readonly sector: string;
}

export interface LaptopView {
  readonly balance: number;
  readonly bookmarks: readonly string[];
  readonly emails: readonly LaptopEmailView[];
  readonly history: readonly LaptopHistoryView[];
  readonly finances: readonly LaptopFinanceView[];
  readonly files: readonly { readonly code: number; readonly read: boolean }[];
  readonly personnel: {
    readonly dead: readonly number[];
    readonly left: readonly number[];
    readonly other: readonly number[];
  };
  readonly aim: readonly AimMercView[];
  readonly merc: MercSiteView;
  readonly imp: ImpSiteView;
  readonly bobbyRay: BobbyRayView;
  readonly insurance: readonly InsuranceOfferView[];
  readonly inTransit: readonly InTransitView[];
  readonly landingZone: string;
}

export interface TextKeyView {
  readonly file: string;
  readonly row: number;
  readonly width: number;
}

export interface CivQuoteView {
  readonly soldier: number;
  readonly quote: number;
  readonly entry: number;
  readonly hint: boolean;
  readonly textKey: TextKeyView;
  readonly text?: string;
}

export interface ConversationLineView {
  readonly profile: number;
  readonly quote: number;
  readonly record?: number;
  readonly textKey: TextKeyView;
  readonly text?: string;
}

export interface ConversationView {
  readonly npc: number | null;
  readonly profile: number;
  readonly name: string;
  readonly talker: number | null;
  readonly initiatedBy: 'player' | 'npc';
  readonly menu: readonly string[];
  readonly lastQuotes: readonly ConversationLineView[];
}

export interface BoxingView {
  readonly state: 'waitingForPlayer' | 'preBoxing' | 'boxing' | 'disqualified' | 'wonRound' | 'lostRound';
  readonly boxers: readonly number[];
  readonly uiLocked: boolean;
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
  readonly laptop?: LaptopView | null;
  readonly conversation?: ConversationView | null;
  readonly npcRequest?: NpcRequestPromptView | null;
  readonly scriptedSequence?: boolean;
  readonly meanwhile?: MeanwhileSceneView | null;
  readonly ended?: CampaignEndedView | null;
  readonly boxing?: BoxingView | null;
  readonly soldiers: readonly SoldierView[];
  readonly openDoors?: readonly number[];
  readonly doors?: readonly DoorView[];
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
  readonly laptop?: LaptopView | null;
  readonly conversation?: ConversationView | null;
  readonly npcRequest?: NpcRequestPromptView | null;
  readonly scriptedSequence?: boolean;
  readonly meanwhile?: MeanwhileSceneView | null;
  readonly ended?: CampaignEndedView | null;
  readonly boxing?: BoxingView | null;
  readonly openDoors?: readonly number[];
  readonly doors?: readonly DoorView[];
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
  if (JSON.stringify(previous.doors ?? []) !== JSON.stringify(next.doors ?? []))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), doors: next.doors ?? [] };
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
  if (JSON.stringify(previous.laptop ?? null) !== JSON.stringify(next.laptop ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), laptop: next.laptop ?? null };
  if (JSON.stringify(previous.conversation ?? null) !== JSON.stringify(next.conversation ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), conversation: next.conversation ?? null };
  if (JSON.stringify(previous.npcRequest ?? null) !== JSON.stringify(next.npcRequest ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), npcRequest: next.npcRequest ?? null };
  if ((previous.scriptedSequence ?? false) !== (next.scriptedSequence ?? false))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), scriptedSequence: next.scriptedSequence ?? false };
  if (JSON.stringify(previous.meanwhile ?? null) !== JSON.stringify(next.meanwhile ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), meanwhile: next.meanwhile ?? null };
  if (JSON.stringify(previous.ended ?? null) !== JSON.stringify(next.ended ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), ended: next.ended ?? null };
  if (JSON.stringify(previous.boxing ?? null) !== JSON.stringify(next.boxing ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), boxing: next.boxing ?? null };
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
    a.merchant === b.merchant &&
    a.profile === b.profile &&
    a.talkable === b.talkable &&
    a.kind === b.kind &&
    a.controlled === b.controlled &&
    JSON.stringify(a.keys ?? []) === JSON.stringify(b.keys ?? []) &&
    sameInventory(a.inventory, b.inventory)
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

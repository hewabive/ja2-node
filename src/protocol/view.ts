import type { SimEvent } from '../sim/events.ts';
import type { OwnHintInputs } from '../sim/knowledge/view.ts';
import type { FaceVariant } from '../sim/narrative/face-variant.ts';
import type { ShopView } from '../sim/strategic/economy/merchants/view.ts';
import type { DoorView, KeyView } from '../sim/tactical/doors/door-view.ts';
import { type InventoryItemView, sameInventory } from '../sim/tactical/inventory-view.ts';
import type { FirstAidRole, SoldierStatsView, VehicleSeatView, WeaponModeView } from '../sim/tactical/soldier-view.ts';
import type { TopMessageView } from '../sim/tactical/tactical-sim.ts';
import type { CorpseView, SmokeTileView, TileChangeView, WorldLightView } from '../sim/tactical/world-view.ts';
import type { MessageEntry } from './message-log.ts';
import { type MusicView, sameMusic } from './music.ts';
import { sameJson } from './same-json.ts';

export type { KnowledgeLight as LightView, KnowledgeLightSprite as LightSpriteView, OwnHintInputs } from '../sim/knowledge/view.ts';
export type { FaceVariant } from '../sim/narrative/face-variant.ts';
export type { ShopBoxView, ShopEta, ShopKind, ShopRepairedView, ShopView } from '../sim/strategic/economy/merchants/view.ts';
export type { DoorView, KeyView } from '../sim/tactical/doors/door-view.ts';
export type { InventoryItemView } from '../sim/tactical/inventory-view.ts';
export type { FirstAidRole, SoldierStatsView, VehicleSeatView, WeaponModeView } from '../sim/tactical/soldier-view.ts';
export type { TopMessageView } from '../sim/tactical/tactical-sim.ts';
export type {
  CorpseView,
  SmokeTileView,
  TileChangeKind,
  TileChangeView,
  WorldLightView,
} from '../sim/tactical/world-view.ts';
export type { MusicView } from './music.ts';

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
  readonly frameSlot: number;
  readonly stateTick: number;
  readonly frameDelay: number;
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
  readonly voice?: string;
  readonly bleeding?: number;
  readonly breathMax?: number;
  readonly morale?: number;
  readonly stats?: SoldierStatsView;
  readonly armour?: number;
  readonly weight?: number;
  readonly camo?: number;
  readonly asleep?: boolean;
  readonly squad?: number | null;
  readonly stealth?: boolean;
  readonly weaponMode?: WeaponModeView;
  readonly muted?: boolean;
  readonly sees?: readonly number[];
  readonly canAct?: boolean;
  readonly continueTo?: number | null;
  readonly noApToFinishMove?: boolean;
  readonly vehicle?: VehicleSeatView | null;
  readonly firstAid?: FirstAidRole | null;
  readonly blinded?: boolean;
  readonly hostile?: boolean;
  readonly healthIndex?: number;
  readonly hint?: OwnHintInputs;
}

export interface ItemAttachmentView {
  readonly item: string;
  readonly status: number;
}

export interface ItemView {
  readonly gridNo: number;
  readonly level: number;
  readonly item: string;
  readonly count: number;
  readonly status: number;
  readonly money?: number;
  readonly attachments?: readonly ItemAttachmentView[];
  readonly height?: number;
  readonly notRendered?: boolean;
}

export interface CombatView {
  readonly team: number;
  readonly round: number;
  readonly interrupt: boolean;
  readonly uiLocked: boolean;
  readonly topMessage: TopMessageView | null;
  readonly ai: { readonly current: number; readonly total: number } | null;
}

export interface ClockView {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly compressing: boolean;
  readonly mode?: number;
  readonly paused?: boolean;
  readonly playerPaused?: boolean;
  readonly pauseLocked?: boolean;
  readonly canCompress?: boolean;
  readonly compressRefusal?: string;
}

export interface StrategicSectorView {
  readonly sector: string;
  readonly visited: boolean;
  readonly town: number;
  readonly playerControlled: boolean | null;
  readonly enemies: number | '?' | null;
  readonly militia: readonly number[];
  readonly items?: number;
  readonly militiaTraining?: number;
  readonly enemiesKnown?: boolean;
  readonly facilities?: number;
}

export interface StrategicUndergroundView {
  readonly sector: string;
  readonly items: number;
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
      readonly minutesLeft?: number;
      readonly endMinutes?: number;
    }
  | {
      readonly type: 'merc';
      readonly unpaidDays: number;
      readonly daysHired: number;
      readonly owed: number;
      readonly contractLength?: number;
    }
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
  readonly profile?: number;
  readonly stats?: SoldierStatsView;
  readonly inventory?: readonly InventoryItemView[];
  readonly weight?: number;
  readonly armour?: number;
  readonly camo?: number;
  readonly idle?: boolean;
  readonly trainStat?: number;
  readonly repairVehicle?: number;
  readonly repairRobot?: boolean;
  readonly canChangeSleep?: boolean;
  readonly salary?: number;
  readonly bleeding?: number;
  readonly collapsed?: boolean;
}

export interface StrategicVehicleView {
  readonly id: number;
  readonly kind: string;
  readonly sector: string;
  readonly betweenSectors: boolean;
  readonly passengers: readonly number[];
  readonly seats: number;
  readonly path: readonly string[];
  readonly type?: number;
  readonly group?: number;
  readonly usable?: boolean;
  readonly next?: string | null;
  readonly nextArrivalMinutes?: number | null;
  readonly traverseMinutes?: number | null;
  readonly life?: number;
  readonly lifeMax?: number;
  readonly fuel?: number;
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
  readonly progress?: number;
}

export interface DestroyedHelicopterView {
  readonly destroyed: true;
}

export interface StrategicTownView {
  readonly town: number;
  readonly loyalty: number;
}

export interface StrategicTownControlView {
  readonly town: number;
  readonly control: number;
}

export type MineStatusView = 'producing' | 'runningOut' | 'shutDown' | 'abandoned';

export interface StrategicMineView {
  readonly mine: number;
  readonly sector: string;
  readonly town: number;
  readonly status: MineStatusView;
  readonly ore: 'silver' | 'gold';
  readonly playerControls: boolean;
  readonly predictedDailyIncome: number;
  readonly maxDailyRemoval: number;
  readonly maxPeriodicRemoval: number;
}

export interface StrategicGroupView {
  readonly id: number;
  readonly sector: string;
  readonly next: string | null;
  readonly betweenSectors: boolean;
  readonly members: readonly number[];
  readonly etaMinutes: number;
  readonly path: readonly string[];
  readonly nextArrivalMinutes?: number | null;
  readonly traverseMinutes?: number | null;
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
  readonly gameJustStarted?: boolean;
  readonly meanwhiles: readonly MeanwhileLogView[];
  readonly sectors: readonly StrategicSectorView[];
  readonly mercs: readonly StrategicMercView[];
  readonly groups: readonly StrategicGroupView[];
  readonly vehicles?: readonly StrategicVehicleView[];
  readonly helicopter?: StrategicHelicopterView | DestroyedHelicopterView;
  readonly enemyAirspace?: readonly string[];
  readonly towns?: readonly StrategicTownView[];
  readonly townControl?: readonly StrategicTownControlView[];
  readonly mines?: readonly StrategicMineView[];
  readonly projectedDailyIncome?: number;
  readonly secretsFound?: readonly string[];
  readonly underground?: readonly StrategicUndergroundView[];
  readonly mercAccountStatus?: string;
  readonly landingZone?: string;
  readonly unreadMail?: number;
  readonly newMail?: boolean;
  readonly quests: readonly QuestLogEntryView[];
  readonly battleLocator?: string | null;
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
  readonly betweenSectors?: boolean;
  readonly departure?: number | null;
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
      readonly involvedGroups?: number;
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
      readonly bandageRefusal?: string | null;
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
  readonly profile?: number;
  readonly female?: boolean;
}

export interface AutoresolveView {
  readonly sector: string;
  readonly encounter?: string;
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
  readonly offset: number;
  readonly length: number;
  readonly subject: string;
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
  readonly text: string;
  readonly location: string;
  readonly questInProgress: boolean;
}

export interface LaptopFinanceView {
  readonly code: number;
  readonly secondCode: number;
  readonly date: LaptopTimeView;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly text: string;
}

export interface LaptopFinanceDayView {
  readonly income: number;
  readonly otherDeposits: number;
  readonly debits: number;
}

export interface LaptopFinanceSummaryView {
  readonly yesterday: LaptopFinanceDayView & { readonly closingBalance: number };
  readonly today: LaptopFinanceDayView & { readonly balance: number };
  readonly projectedIncome: number;
  readonly projectedBalance: number;
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
export type AimContactView = 'firstContact' | 'answeringMachine' | 'unavailable';

export interface AimMercView {
  readonly profile: number;
  readonly name: string;
  readonly nickname: string;
  readonly stats: LaptopStatsView;
  readonly salary: { readonly day: number; readonly week: number; readonly twoWeeks: number };
  readonly medicalDeposit: number | null;
  readonly kit: { readonly items: readonly LaptopItemView[]; readonly cost: number } | null;
  readonly face: AimFaceView;
  readonly contact: AimContactView;
  readonly messageLeft: boolean;
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
  readonly advertiseQuote: number | null;
  readonly married: boolean;
}

export interface MercAccountRowView {
  readonly profile: number;
  readonly name: string;
  readonly days: number;
  readonly rate: number;
  readonly charge: number;
  readonly dead: boolean;
}

export interface MercSiteView {
  readonly bookmarked: boolean;
  readonly siteDown: boolean;
  readonly accountStatus: string;
  readonly accountNumber: number | null;
  readonly listed: readonly MercListingView[];
  readonly totalOwed: number;
  readonly account: readonly MercAccountRowView[];
  readonly slowLoad: boolean;
}

export type ImpAttributeName =
  | 'health'
  | 'agility'
  | 'dexterity'
  | 'strength'
  | 'wisdom'
  | 'leadership'
  | 'marksmanship'
  | 'medical'
  | 'mechanical'
  | 'explosives';

export interface ImpAttributeRulesView {
  readonly start: number;
  readonly min: number;
  readonly max: number;
  readonly bonus: number;
  readonly zeroBonus: number;
  readonly order: readonly ImpAttributeName[];
  readonly zeroable: readonly ImpAttributeName[];
}

export interface ImpGenderListsView {
  readonly male: readonly number[];
  readonly female: readonly number[];
}

export interface ImpSiteView {
  readonly bookmarked: boolean;
  readonly charactersLeft: number;
  readonly canCreate: boolean;
  readonly cost: number;
  readonly pickSkillsDirectly: boolean;
  readonly beginRefusal: 'funds' | 'teamFull' | null;
  readonly attributes: ImpAttributeRulesView;
  readonly portraits: ImpGenderListsView;
  readonly voices: ImpGenderListsView;
  readonly quizAnswers: readonly number[];
}

export type BobbyRayCatalogue = 'guns' | 'ammo' | 'armour' | 'misc' | 'used';

export interface BobbyRayStockView {
  readonly item: number;
  readonly name: string;
  readonly price: number;
  readonly quantity: number;
  readonly quality: number;
  readonly slot: number;
  readonly catalogue: BobbyRayCatalogue | null;
}

export interface BobbyRayShipmentLineView {
  readonly item: number;
  readonly name: string;
  readonly count: number;
  readonly used: boolean;
  readonly quality: number;
  readonly unitPrice: number;
}

export interface BobbyRayShipmentView {
  readonly index: number;
  readonly active: boolean;
  readonly displayed: boolean;
  readonly destination: number;
  readonly speed: number;
  readonly orderDay: number;
  readonly units: number;
  readonly weight: number;
  readonly lines: readonly BobbyRayShipmentLineView[];
  readonly subtotal: number;
  readonly shipping: number;
  readonly total: number;
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
  readonly nickname: string;
  readonly dead: boolean;
  readonly contractLength: number;
}

export interface PersonnelRecordView {
  readonly kills: number;
  readonly assists: number;
  readonly shotsFired: number;
  readonly shotsHit: number;
  readonly battlesFought: number;
  readonly timesWounded: number;
}

export interface PersonnelItemView {
  readonly item: number;
  readonly count: number;
  readonly status: number;
  readonly shots: number;
}

export type PersonnelEmploymentView =
  | {
      readonly kind: 'aim';
      readonly minutesLeft: number;
      readonly totalDays: number;
      readonly daysServed: number;
      readonly totalCost: number;
      readonly dailyCost: number;
      readonly medicalDeposit: number;
    }
  | {
      readonly kind: 'merc';
      readonly daysServed: number;
      readonly totalCost: number;
      readonly dailyCost: number;
      readonly unpaid: number;
    }
  | {
      readonly kind: 'other';
      readonly daysServed: number;
      readonly totalCost: number;
      readonly dailyCost: number;
      readonly medicalDeposit: number;
    };

export interface PersonnelMercView {
  readonly soldier: number;
  readonly profile: number;
  readonly name: string;
  readonly fullName: string;
  readonly alive: boolean;
  readonly robot: boolean;
  readonly assignment: number;
  readonly town: number;
  readonly life: number;
  readonly lifeMax: number;
  readonly stats: LaptopStatsView;
  readonly gains: LaptopStatsView;
  readonly teamStats: readonly number[];
  readonly record: PersonnelRecordView;
  readonly skills: readonly [number, number];
  readonly money: number;
  readonly inventory: readonly PersonnelItemView[];
  readonly employment: PersonnelEmploymentView;
}

export type PersonnelDepartureView = 'dead' | 'fired' | 'married' | 'contractExpired' | 'quit';

export interface PersonnelDepartedView {
  readonly profile: number;
  readonly state: PersonnelDepartureView;
  readonly fullName: string;
  readonly nickname: string;
  readonly life: number;
  readonly stats: LaptopStatsView;
  readonly teamStats: readonly number[];
  readonly record: PersonnelRecordView;
}

export interface FloristView {
  readonly orderNumber: number;
  readonly bouquetPrices: readonly number[];
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
  readonly newMail: boolean;
  readonly bookmarks: readonly string[];
  readonly emails: readonly LaptopEmailView[];
  readonly history: readonly LaptopHistoryView[];
  readonly finances: readonly LaptopFinanceView[];
  readonly financeSummary: LaptopFinanceSummaryView;
  readonly files: readonly { readonly code: number; readonly read: boolean }[];
  readonly personnel: {
    readonly dead: readonly number[];
    readonly left: readonly number[];
    readonly other: readonly number[];
    readonly current: readonly PersonnelMercView[];
    readonly departed: readonly PersonnelDepartedView[];
  };
  readonly aim: readonly AimMercView[];
  readonly merc: MercSiteView;
  readonly imp: ImpSiteView;
  readonly bobbyRay: BobbyRayView;
  readonly insurance: readonly InsuranceOfferView[];
  readonly inTransit: readonly InTransitView[];
  readonly landingZone: string;
  readonly aimMercsOnTeam: boolean;
  readonly florist: FloristView;
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
  readonly chars: number;
  readonly text?: string;
}

export interface ConversationView {
  readonly npc: number | null;
  readonly profile: number;
  readonly faceVariant: FaceVariant | null;
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
  readonly corpses?: readonly CorpseView[];
  readonly smoke?: readonly SmokeTileView[];
  readonly light?: WorldLightView | null;
  readonly tileChanges?: readonly TileChangeView[];
  readonly music?: MusicView;
}

export interface ViewFrame {
  readonly tick: number;
  readonly changed: readonly SoldierView[];
  readonly removed: readonly number[];
  readonly events?: readonly SimEvent[];
  readonly messages?: readonly MessageEntry[];
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
  readonly corpses?: readonly CorpseView[];
  readonly smoke?: readonly SmokeTileView[];
  readonly light?: WorldLightView | null;
  readonly tileChanges?: readonly TileChangeView[];
  readonly music?: MusicView;
}

function sameItems(a: readonly ItemView[] | undefined, b: readonly ItemView[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => {
    const w = b[i];
    return (
      !!w &&
      v.gridNo === w.gridNo &&
      v.level === w.level &&
      v.item === w.item &&
      v.count === w.count &&
      v.status === w.status &&
      v.money === w.money &&
      v.height === w.height &&
      v.notRendered === w.notRendered &&
      sameJson(v.attachments ?? [], w.attachments ?? [])
    );
  });
}

function sameSmoke(a: readonly SmokeTileView[] | undefined, b: readonly SmokeTileView[] | undefined): boolean {
  if (a === b) return true;
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  return x.every((v, i) => {
    const w = y[i];
    return !!w && v.gridNo === w.gridNo && v.level === w.level && v.effect === w.effect && !!v.dissipating === !!w.dissipating;
  });
}

function sameCombat(a: CombatView | null | undefined, b: CombatView | null | undefined): boolean {
  if (!a || !b) return !a === !b;
  return (
    a.team === b.team &&
    a.round === b.round &&
    a.interrupt === b.interrupt &&
    a.uiLocked === b.uiLocked &&
    sameJson(a.topMessage, b.topMessage) &&
    sameJson(a.ai, b.ai)
  );
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
  if (!sameJson(previous.doors ?? [], next.doors ?? []))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), doors: next.doors ?? [] };
  if (!sameList(previous.revealedRooms, next.revealedRooms))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), revealedRooms: next.revealedRooms ?? [] };
  if (!sameItems(previous.items, next.items))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), items: next.items ?? [] };
  if (!sameJson(previous.corpses ?? [], next.corpses ?? []))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), corpses: next.corpses ?? [] };
  if (!sameSmoke(previous.smoke, next.smoke))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), smoke: next.smoke ?? [] };
  if (!sameJson(previous.light ?? null, next.light ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), light: next.light ?? null };
  if (!sameJson(previous.tileChanges ?? [], next.tileChanges ?? []))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), tileChanges: next.tileChanges ?? [] };
  if (!sameCombat(previous.combat, next.combat))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), combat: next.combat ?? null };
  if (previous.mapPath !== next.mapPath) frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), mapPath: next.mapPath };
  if (next.clock && !sameClock(previous.clock, next.clock))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), clock: next.clock };
  if (next.strategic && !sameJson(previous.strategic, next.strategic))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), strategic: next.strategic };
  if (!sameJson(previous.prompt ?? null, next.prompt ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), prompt: next.prompt ?? null };
  if (!sameJson(previous.contractPrompt ?? null, next.contractPrompt ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), contractPrompt: next.contractPrompt ?? null };
  if (!sameJson(previous.autoresolve ?? null, next.autoresolve ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), autoresolve: next.autoresolve ?? null };
  if (!sameJson(previous.shop ?? null, next.shop ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), shop: next.shop ?? null };
  if (!sameJson(previous.laptop ?? null, next.laptop ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), laptop: next.laptop ?? null };
  if (!sameJson(previous.conversation ?? null, next.conversation ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), conversation: next.conversation ?? null };
  if (!sameJson(previous.npcRequest ?? null, next.npcRequest ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), npcRequest: next.npcRequest ?? null };
  if ((previous.scriptedSequence ?? false) !== (next.scriptedSequence ?? false))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), scriptedSequence: next.scriptedSequence ?? false };
  if (!sameJson(previous.meanwhile ?? null, next.meanwhile ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), meanwhile: next.meanwhile ?? null };
  if (!sameJson(previous.ended ?? null, next.ended ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), ended: next.ended ?? null };
  if (!sameJson(previous.boxing ?? null, next.boxing ?? null))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), boxing: next.boxing ?? null };
  if (next.music && !sameMusic(previous.music, next.music))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), music: next.music };
  return frame;
}

const CLOCK_FIELDS = [
  'day',
  'hour',
  'minute',
  'compressing',
  'mode',
  'paused',
  'playerPaused',
  'pauseLocked',
  'canCompress',
  'compressRefusal',
] as const satisfies readonly (keyof ClockView)[];

function sameClock(a: ClockView | undefined, b: ClockView): boolean {
  return !!a && CLOCK_FIELDS.every((key) => a[key] === b[key]);
}

const SCALAR_SOLDIER_FIELDS = [
  'frameSlot',
  'stateTick',
  'frameDelay',
  'bleeding',
  'breathMax',
  'morale',
  'armour',
  'weight',
  'camo',
  'asleep',
  'squad',
  'stealth',
  'weaponMode',
  'muted',
  'canAct',
  'continueTo',
  'noApToFinishMove',
  'firstAid',
  'blinded',
  'hostile',
  'healthIndex',
] as const satisfies readonly (keyof SoldierView)[];

const STRUCTURED_SOLDIER_FIELDS = ['stats', 'sees', 'vehicle', 'hint'] as const satisfies readonly (keyof SoldierView)[];

function samePresentationFields(a: SoldierView, b: SoldierView): boolean {
  return SCALAR_SOLDIER_FIELDS.every((key) => a[key] === b[key]) && STRUCTURED_SOLDIER_FIELDS.every((key) => sameJson(a[key], b[key]));
}

function sameSoldier(a: SoldierView, b: SoldierView): boolean {
  return (
    samePresentationFields(a, b) &&
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
    a.voice === b.voice &&
    sameJson(a.keys ?? [], b.keys ?? []) &&
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

const FRAME_ONLY_KEYS = ['tick', 'changed', 'removed', 'events', 'messages'] as const;
type FrameFields = Omit<ViewFrame, (typeof FRAME_ONLY_KEYS)[number]>;

function frameFields(frame: ViewFrame): FrameFields {
  const fields: Record<string, unknown> = { ...frame };
  for (const key of FRAME_ONLY_KEYS) delete fields[key];
  return fields as FrameFields;
}

export function applyViewFrame(view: PlayerView, frame: ViewFrame): PlayerView {
  const soldiersChanged = frame.changed.length > 0 || frame.removed.length > 0;
  return {
    ...view,
    ...frameFields(frame),
    tick: frame.tick,
    soldiers: soldiersChanged ? applyFrame(view.soldiers, frame) : view.soldiers,
  };
}

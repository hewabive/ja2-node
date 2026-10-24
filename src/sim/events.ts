import type { ContractEvent } from './campaign/contracts/events.ts';
import type { LaptopEvent } from './campaign/laptop/events.ts';
import type { QuestEvent } from './campaign/narrative/events.ts';
import type { StoryEvent } from './campaign/narrative/story-events.ts';
import type { NarrativeEvent } from './narrative/events.ts';
import type { EconomyEvent } from './strategic/economy/events.ts';
import type { ShopEvent } from './strategic/economy/merchants/events.ts';
import type { ImportantSectorKind } from './strategic/economy/sector-loss.ts';
import type { HelicopterEvent } from './strategic/forces/helicopter-events.ts';
import type { DoorEvent } from './tactical/doors/events.ts';
import type { InventoryEvent } from './tactical/inventory-events.ts';
import type { BoxingEvent } from './tactical/narrative/boxing-events.ts';
import type { OrderEvent } from './tactical/order-events.ts';

export interface SimEventBase {
  readonly tick: number;
}

export interface TickBudgetEvent extends SimEventBase {
  readonly type: 'budgetExhausted';
}

export interface ArrivedEvent extends SimEventBase {
  readonly type: 'arrived';
  readonly soldier: number;
  readonly gridNo: number;
}

export interface StoppedEvent extends SimEventBase {
  readonly type: 'stopped';
  readonly soldier: number;
  readonly gridNo: number;
  readonly reason: string;
}

export interface NoPathEvent extends SimEventBase {
  readonly type: 'noPath';
  readonly soldier: number;
  readonly to: number;
}

export interface CombatStartedEvent extends SimEventBase {
  readonly type: 'combatStarted';
  readonly team: number;
}

export interface TurnStartedEvent extends SimEventBase {
  readonly type: 'turnStarted';
  readonly team: number;
  readonly round: number;
}

export interface InterruptEvent extends SimEventBase {
  readonly type: 'interrupt';
  readonly team: number;
  readonly soldiers?: readonly number[];
  readonly selected?: number;
}

export interface AiTurnEvent extends SimEventBase {
  readonly type: 'aiTurn';
  readonly soldier: number;
}

export interface EnemyTurnProgressEvent extends SimEventBase {
  readonly type: 'enemyTurnProgress';
  readonly done: number;
  readonly total: number;
}

export interface InterruptEndedEvent extends SimEventBase {
  readonly type: 'interruptEnded';
  readonly team: number;
}

export interface CombatEndedEvent extends SimEventBase {
  readonly type: 'combatEnded';
  readonly reason: 'lull' | 'won' | 'lost' | 'boxing';
  readonly fought?: true;
  readonly monsterKill?: true;
}

export type DoorSoundKind = 'wood' | 'cloth' | 'garage' | 'metal';

export interface DoorChangedEvent extends SimEventBase {
  readonly type: 'doorChanged';
  readonly gridNo: number;
  readonly open: boolean;
  readonly kind?: DoorSoundKind;
  readonly noisy?: boolean;
}

export interface NoiseHeardEvent extends SimEventBase {
  readonly type: 'noiseHeard';
  readonly listener: number;
  readonly kind: number;
  readonly volumeClass: number;
  readonly direction: number | 'above' | 'below';
}

export interface EnemySightedEvent extends SimEventBase {
  readonly type: 'enemySighted';
  readonly soldier: number;
  readonly newEnemies: number;
  readonly revealedEnemies: number;
  readonly enemies?: readonly number[];
}

export interface RoomRevealedEvent extends SimEventBase {
  readonly type: 'roomRevealed';
  readonly room: number;
}

export interface ShotFiredEvent extends SimEventBase {
  readonly type: 'shotFired';
  readonly soldier: number;
  readonly target: number;
  readonly chance: number;
  readonly hit: boolean;
  readonly item?: number;
  readonly silenced?: boolean;
  readonly burst?: boolean;
  readonly rounds?: number;
}

export interface MeleeStrikeEvent extends SimEventBase {
  readonly type: 'meleeStrike';
  readonly soldier: number;
  readonly target: number;
  readonly weapon: 'blade' | 'punch';
  readonly chance: number;
  readonly hit: boolean;
}

export interface BulletStoppedEvent extends SimEventBase {
  readonly type: 'bulletStopped';
  readonly soldier: number;
  readonly gridNo: number;
  readonly reason: 'structure' | 'ground' | 'roof' | 'offMap' | 'soldier';
  readonly material?: number;
  readonly caveWall?: boolean;
}

export interface SoldierHitEvent extends SimEventBase {
  readonly type: 'soldierHit';
  readonly soldier: number;
  readonly attacker: number | null;
  readonly damage: number;
  readonly breathLoss: number;
  readonly location: 'random' | 'head' | 'torso' | 'legs' | 'gland';
  readonly special: number;
  readonly life: number;
}

export interface LifeLostEvent extends SimEventBase {
  readonly type: 'lifeLost';
  readonly soldier: number;
  readonly amount: number;
}

export interface SoldierDiedEvent extends SimEventBase {
  readonly type: 'soldierDied';
  readonly soldier: number;
  readonly killer: number | null;
  readonly gridNo: number;
}

export interface AttackResolvedEvent extends SimEventBase {
  readonly type: 'attackResolved';
  readonly soldier: number | null;
}

export interface GunJammedEvent extends SimEventBase {
  readonly type: 'gunJammed';
  readonly soldier: number;
  readonly unjammed: boolean;
}

export interface StatChangedEvent extends SimEventBase {
  readonly type: 'statChanged';
  readonly soldier: number;
  readonly stat: string;
  readonly change: number;
}

export interface ItemsPickedUpEvent extends SimEventBase {
  readonly type: 'itemsPickedUp';
  readonly soldier: number;
  readonly gridNo: number;
}

export interface ItemsRevealedEvent extends SimEventBase {
  readonly type: 'itemsRevealed';
  readonly gridNo: number;
  readonly level: number;
}

export interface ItemDroppedEvent extends SimEventBase {
  readonly type: 'itemDropped';
  readonly soldier: number;
  readonly gridNo: number;
}

export interface ExplosionEvent extends SimEventBase {
  readonly type: 'explosion';
  readonly item: number;
  readonly gridNo: number;
  readonly level: number;
  readonly owner: number | null;
  readonly animation?: string;
}

export interface ReloadedEvent extends SimEventBase {
  readonly type: 'reloaded';
  readonly soldier: number;
  readonly item: number;
}

export interface StructureDamagedEvent extends SimEventBase {
  readonly type: 'structureDamaged';
  readonly gridNo: number;
  readonly destroyed: boolean;
}

export interface LoadScreenView {
  readonly id: number;
  readonly path: string;
}

export interface SectorLoadedEvent extends SimEventBase {
  readonly type: 'sectorLoaded';
  readonly sector: string;
  readonly hostiles?: number;
  readonly loadScreen?: LoadScreenView;
  readonly enemyPresence?: true;
  readonly firstArrival?: true;
}

export interface EnemyPresenceEvent extends SimEventBase {
  readonly type: 'enemyPresence';
  readonly sector: string;
}

export interface CreatureAttackEvent extends SimEventBase {
  readonly type: 'creatureAttack';
  readonly sector: string;
}

export interface SectorUnloadedEvent extends SimEventBase {
  readonly type: 'sectorUnloaded';
  readonly sector: string;
}

export interface MercsLeftSectorEvent extends SimEventBase {
  readonly type: 'mercsLeftSector';
  readonly sector: string;
  readonly to: string;
  readonly mapScreen?: true;
}

export interface ArCellRef {
  readonly side: 'merc' | 'militia' | 'enemy';
  readonly index: number;
}

export interface PreBattlePanelInvolved {
  readonly soldier: number;
  readonly name: string;
  readonly assignment: number;
  readonly condition: string;
  readonly hp: number;
  readonly bp: number;
}

export interface PreBattlePanelUninvolved {
  readonly soldier: number;
  readonly name: string;
  readonly assignment: number;
  readonly location: string;
  readonly betweenSectors: boolean;
  readonly destination?: string;
  readonly departure: number | null;
}

export interface PreBattlePanel {
  readonly sector: string;
  readonly enemies: number | 'unknown';
  readonly militia: number;
  readonly involved: readonly PreBattlePanelInvolved[];
  readonly uninvolved: readonly PreBattlePanelUninvolved[];
  readonly involvedGroups: number;
}

export interface PreBattleEvent extends SimEventBase {
  readonly type: 'preBattle';
  readonly sector: string;
  readonly encounter: string;
  readonly persistent: boolean;
  readonly autoStart: boolean;
  readonly prompt: string | null;
  readonly panel?: PreBattlePanel;
}

export interface RetreatedEvent extends SimEventBase {
  readonly type: 'retreated';
  readonly sector: string;
  readonly groups: readonly number[];
  readonly via: 'preBattle' | 'autoresolve';
}

export interface ArStartedEvent extends SimEventBase {
  readonly type: 'arStarted';
  readonly sector: string;
  readonly mercs: number;
  readonly militia: number;
  readonly enemies: number;
}

export interface ArAttackEvent extends SimEventBase {
  readonly type: 'arAttack';
  readonly battleMs: number;
  readonly attacker: ArCellRef;
  readonly target: ArCellRef;
  readonly kind: 'shot' | 'spit' | 'claw' | 'knife' | 'punch';
  readonly weapon?: number;
  readonly reloaded?: true;
}

export interface ArHitEvent extends SimEventBase {
  readonly type: 'arHit';
  readonly battleMs: number;
  readonly target: ArCellRef;
  readonly damage?: number;
  readonly life?: number;
  readonly health?: string;
  readonly melee?: true;
}

export interface ArMissEvent extends SimEventBase {
  readonly type: 'arMiss';
  readonly battleMs: number;
  readonly target: ArCellRef;
}

export interface ArFellEvent extends SimEventBase {
  readonly type: 'arFell';
  readonly battleMs: number;
  readonly cell: ArCellRef;
}

export interface ArDiedEvent extends SimEventBase {
  readonly type: 'arDied';
  readonly battleMs: number;
  readonly cell: ArCellRef;
  readonly killer: ArCellRef | null;
  readonly splat?: true;
}

export interface ArRetreatedEvent extends SimEventBase {
  readonly type: 'arRetreated';
  readonly battleMs: number;
  readonly cell: ArCellRef;
}

export interface ArBattleOverEvent extends SimEventBase {
  readonly type: 'arBattleOver';
  readonly battleMs: number;
  readonly status: string;
}

export interface ArSoundEvent extends SimEventBase {
  readonly type: 'arSound';
  readonly battleMs: number;
  readonly sound: string;
  readonly variant: number;
}

export interface ArSurrenderOfferedEvent extends SimEventBase {
  readonly type: 'arSurrenderOffered';
  readonly battleMs: number;
}

export interface ArSummaryEvent extends SimEventBase {
  readonly type: 'arSummary';
  readonly sector: string;
  readonly status: string;
  readonly battleSeconds: number;
  readonly worldSecondsWarped: number;
  readonly mercs: { readonly died: readonly number[]; readonly captured: readonly number[]; readonly wounded: readonly number[] };
  readonly militia: { readonly died: number; readonly promoted: number };
  readonly enemiesKilled: number;
  readonly sectorControl: 'player' | 'enemy' | null;
  readonly itemsDropped: number;
}

export interface BattleResultEvent extends SimEventBase {
  readonly type: 'battleResult';
  readonly sector: string;
  readonly result: 'victory' | 'defeat';
  readonly via: 'tactical' | 'autoresolve';
}

export interface SectorControlChangedEvent extends SimEventBase {
  readonly type: 'sectorControlChanged';
  readonly sector: string;
  readonly controller: 'player' | 'enemy';
  readonly kind?: ImportantSectorKind;
  readonly dailyIncome?: number;
}

export interface MercCapturedEvent extends SimEventBase {
  readonly type: 'mercCaptured';
  readonly soldier: number;
  readonly sector: string;
}

export interface CiviliansEatenEvent extends SimEventBase {
  readonly type: 'civiliansEaten';
  readonly sector: string;
  readonly count: number;
}

export interface CompressionStartedEvent extends SimEventBase {
  readonly type: 'compressionStarted';
  readonly mode: number;
}

export interface CompressionStoppedEvent extends SimEventBase {
  readonly type: 'compressionStopped';
  readonly reason: string;
}

export interface WorldTimeReachedEvent extends SimEventBase {
  readonly type: 'worldTimeReached';
  readonly seconds: number;
}

export interface DayStartedEvent extends SimEventBase {
  readonly type: 'dayStarted';
  readonly day: number;
}

export interface OptionChangedEvent extends SimEventBase {
  readonly type: 'optionChanged';
  readonly bloodAndGore: boolean;
}

export type SimEvent =
  | TickBudgetEvent
  | SectorLoadedEvent
  | EnemyPresenceEvent
  | CreatureAttackEvent
  | SectorUnloadedEvent
  | MercsLeftSectorEvent
  | ArrivedEvent
  | StoppedEvent
  | NoPathEvent
  | CombatStartedEvent
  | TurnStartedEvent
  | InterruptEvent
  | AiTurnEvent
  | EnemyTurnProgressEvent
  | InterruptEndedEvent
  | CombatEndedEvent
  | DoorChangedEvent
  | NoiseHeardEvent
  | EnemySightedEvent
  | RoomRevealedEvent
  | ShotFiredEvent
  | MeleeStrikeEvent
  | BulletStoppedEvent
  | SoldierHitEvent
  | LifeLostEvent
  | SoldierDiedEvent
  | AttackResolvedEvent
  | GunJammedEvent
  | ReloadedEvent
  | StatChangedEvent
  | ExplosionEvent
  | StructureDamagedEvent
  | ItemsPickedUpEvent
  | ItemsRevealedEvent
  | ItemDroppedEvent
  | PreBattleEvent
  | RetreatedEvent
  | ArStartedEvent
  | ArAttackEvent
  | ArHitEvent
  | ArMissEvent
  | ArFellEvent
  | ArDiedEvent
  | ArRetreatedEvent
  | ArBattleOverEvent
  | ArSoundEvent
  | ArSurrenderOfferedEvent
  | ArSummaryEvent
  | BattleResultEvent
  | SectorControlChangedEvent
  | MercCapturedEvent
  | ContractEvent
  | CiviliansEatenEvent
  | CompressionStartedEvent
  | CompressionStoppedEvent
  | WorldTimeReachedEvent
  | DayStartedEvent
  | OptionChangedEvent
  | ShopEvent
  | LaptopEvent
  | DoorEvent
  | InventoryEvent
  | HelicopterEvent
  | NarrativeEvent
  | QuestEvent
  | StoryEvent
  | BoxingEvent
  | OrderEvent
  | (EconomyEvent & SimEventBase);
export type SimEventType = SimEvent['type'];

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
}

export interface InterruptEndedEvent extends SimEventBase {
  readonly type: 'interruptEnded';
  readonly team: number;
}

export interface CombatEndedEvent extends SimEventBase {
  readonly type: 'combatEnded';
  readonly reason: 'lull' | 'won' | 'lost';
}

export interface DoorChangedEvent extends SimEventBase {
  readonly type: 'doorChanged';
  readonly gridNo: number;
  readonly open: boolean;
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
}

export interface StructureDamagedEvent extends SimEventBase {
  readonly type: 'structureDamaged';
  readonly gridNo: number;
  readonly destroyed: boolean;
}

export type SimEvent =
  | TickBudgetEvent
  | ArrivedEvent
  | StoppedEvent
  | NoPathEvent
  | CombatStartedEvent
  | TurnStartedEvent
  | InterruptEvent
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
  | SoldierDiedEvent
  | AttackResolvedEvent
  | GunJammedEvent
  | StatChangedEvent
  | ExplosionEvent
  | StructureDamagedEvent
  | ItemsPickedUpEvent
  | ItemDroppedEvent;
export type SimEventType = SimEvent['type'];

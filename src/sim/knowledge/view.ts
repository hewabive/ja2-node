import type { DoorView, KeyView } from '../tactical/doors/door-view.ts';
import type { InventoryItemView } from '../tactical/inventory-view.ts';
import type { FirstAidRole, SoldierStatsView, WeaponModeView } from '../tactical/soldier-view.ts';

export interface OwnHintInputs {
  readonly skills: readonly [number, number];
  readonly personality: number;
  readonly shock: number;
  readonly lastTarget: number;
  readonly tilesMoved: number;
  readonly weightAtTurnStart: number;
  readonly collapsed: boolean;
  readonly gassed: boolean;
  readonly underAiControl: boolean;
}

export interface KnowledgeSoldier {
  readonly id: number;
  readonly team: number;
  readonly bodyType: number;
  readonly gridNo: number;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly direction: number;
  readonly animation: number;
  readonly hand?: string;
  readonly profile?: number;
  readonly ap?: number;
  readonly life?: number;
  readonly lifeMax?: number;
  readonly breath?: number;
  readonly inventory?: readonly InventoryItemView[];
  readonly keys?: readonly KeyView[];
  readonly kind?: string;
  readonly controlled?: boolean;
  readonly talkable?: string;
  readonly merchant?: string;
  readonly bleeding?: number;
  readonly breathMax?: number;
  readonly morale?: number;
  readonly stats?: SoldierStatsView;
  readonly camo?: number;
  readonly stealth?: boolean;
  readonly weaponMode?: WeaponModeView;
  readonly sees?: readonly number[];
  readonly canAct?: boolean;
  readonly firstAid?: FirstAidRole | null;
  readonly blinded?: boolean;
  readonly hostile?: boolean;
  readonly healthIndex?: number;
  readonly hint?: OwnHintInputs;
}

export interface KnowledgeItemAttachment {
  readonly item: string;
  readonly status: number;
}

export interface KnowledgeItem {
  readonly gridNo: number;
  readonly level: number;
  readonly item: string;
  readonly count: number;
  readonly status: number;
  readonly money?: number;
  readonly attachments?: readonly KnowledgeItemAttachment[];
  readonly zHeight?: number;
}

export interface KnowledgeCombat {
  readonly team: number;
  readonly uiLocked: boolean;
}

export interface KnowledgeClock {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export interface KnowledgeLightSprite {
  readonly template: string;
  readonly x: number;
  readonly y: number;
  readonly roof?: true;
}

export interface KnowledgeLight {
  readonly ambient: number;
  readonly sprites: readonly KnowledgeLightSprite[];
}

export interface KnowledgeBoxing {
  readonly state: string;
}

export interface KnowledgeView {
  readonly tick: number;
  readonly mapPath: string | null;
  readonly soldiers: readonly KnowledgeSoldier[];
  readonly openDoors?: readonly number[];
  readonly doors?: readonly DoorView[];
  readonly combat?: KnowledgeCombat | null;
  readonly items?: readonly KnowledgeItem[];
  readonly clock?: KnowledgeClock;
  readonly light?: KnowledgeLight | null;
  readonly boxing?: KnowledgeBoxing | null;
  readonly strategic?: KnowledgeStrategic;
  readonly prompt?: KnowledgePrompt | null;
}

export interface KnowledgePrompt {
  readonly kind: string;
}

export interface KnowledgeSector {
  readonly sector: string;
  readonly visited: boolean;
  readonly town: number;
  readonly playerControlled: boolean | null;
  readonly enemies: number | '?' | null;
  readonly militia: readonly number[];
}

export interface KnowledgeMerc {
  readonly id: number;
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
  readonly vehicle?: number;
  readonly controlled?: boolean;
  readonly profile?: number;
  readonly stats?: SoldierStatsView;
  readonly inventory?: readonly InventoryItemView[];
  readonly weight?: number;
}

export interface KnowledgeGroup {
  readonly id: number;
  readonly sector: string;
  readonly next: string | null;
  readonly betweenSectors: boolean;
  readonly members: readonly number[];
  readonly path: readonly string[];
  readonly nextArrivalMinutes?: number | null;
}

export interface KnowledgeVehicle {
  readonly id: number;
  readonly sector: string;
  readonly betweenSectors: boolean;
  readonly passengers: readonly number[];
  readonly path: readonly string[];
  readonly type?: number;
  readonly group?: number;
  readonly usable?: boolean;
  readonly next?: string | null;
  readonly nextArrivalMinutes?: number | null;
}

export interface KnowledgeHelicopter {
  readonly vehicle?: number;
  readonly airborne?: boolean;
  readonly returning?: boolean;
  readonly canFly?: boolean;
  readonly reason?: string;
  readonly owed?: number;
  readonly destroyed?: true;
}

export interface KnowledgeTown {
  readonly town: number;
  readonly loyalty: number;
}

export interface KnowledgeStrategic {
  readonly worldSector: string | null;
  readonly flow: string;
  readonly sectors: readonly KnowledgeSector[];
  readonly mercs: readonly KnowledgeMerc[];
  readonly groups: readonly KnowledgeGroup[];
  readonly vehicles?: readonly KnowledgeVehicle[];
  readonly helicopter?: KnowledgeHelicopter;
  readonly enemyAirspace?: readonly string[];
  readonly towns?: readonly KnowledgeTown[];
}

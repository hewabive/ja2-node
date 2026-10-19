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
}

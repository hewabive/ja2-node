import type { UiLanguage } from '../../content/text/data-version.ts';

export type SaveMode = 'anywhere' | 'ironMan' | 'deadIsDead';
export type Difficulty = 1 | 2 | 3;

export interface GameOptions {
  readonly difficulty: Difficulty;
  readonly sciFi: boolean;
  readonly gunNut: boolean;
  readonly saveMode: SaveMode;
  readonly bloodAndGore: boolean;
}

export interface EngineIdentity {
  readonly version: string;
  readonly commit: string;
}

export interface Health {
  readonly ok: boolean;
  readonly data: { readonly original: boolean; readonly slf: number; readonly stubs: boolean };
  readonly dataVersion: string;
  readonly language: UiLanguage;
  readonly engine?: EngineIdentity;
  readonly files: number;
}

export type SaveKind = 'player' | 'quick' | 'auto' | 'deadIsDead';
export type SessionKind = 'campaign' | 'sandbox' | 'imported';

export interface WorldTime {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export interface SaveHeader {
  readonly kind: SaveKind;
  readonly description: string;
  readonly savedAt: string;
  readonly engine: EngineIdentity;
  readonly content: { readonly source: string; readonly dataVersion: string };
  readonly options: GameOptions;
  readonly world: WorldTime | null;
  readonly sector: string | null;
  readonly flow: string;
  readonly mercs: number;
  readonly balance: number;
  readonly campaign: string;
  readonly session: SessionKind;
  readonly tick: number;
}

export interface NativeSaveHeader {
  readonly description: string;
  readonly world: WorldTime;
  readonly sector: { readonly x: number; readonly y: number; readonly z: number };
  readonly mercs: number;
  readonly balance: number;
  readonly version: number;
  readonly options: GameOptions;
  readonly droppedOptions?: readonly string[];
}

export type SaveListing =
  | {
      readonly name: string;
      readonly native: false;
      readonly modified: string;
      readonly header: SaveHeader | null;
      readonly version: number | null;
      readonly compatible: boolean;
      readonly problems: readonly string[];
      readonly warnings?: readonly LoadWarning[];
    }
  | {
      readonly name: string;
      readonly native: true;
      readonly modified: string;
      readonly header: NativeSaveHeader;
      readonly compatible: boolean;
      readonly problems: readonly string[];
    };

export type LoadWarning = 'dataVersionDiffers' | 'engineDiffers' | 'stubPackDiffers';

export interface SessionSummary {
  readonly session: string;
  readonly map: string | null;
  readonly language?: UiLanguage;
  readonly options?: GameOptions;
  readonly flow?: string;
  readonly sector?: string | null;
  readonly campaign?: string;
  readonly canSave?: boolean;
}

export interface Refusal {
  readonly ok: false;
  readonly refused: string;
  readonly reason: string;
}

export interface SaveSuccess {
  readonly ok: true;
  readonly name: string;
  readonly kind: SaveKind;
  readonly header: SaveHeader;
}

export interface LoadSuccess {
  readonly ok: true;
  readonly name: string;
  readonly seed: number | null;
  readonly warnings: readonly LoadWarning[];
  readonly header: SaveHeader;
}

export interface UploadSuccess {
  readonly ok: true;
  readonly name: string;
  readonly header: SaveHeader;
  readonly warnings: readonly LoadWarning[];
}

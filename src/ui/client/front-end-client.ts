import type { PlayerView } from '../../protocol/view.ts';
import type { SaveApi } from '../saves/save-controller.ts';
import type { GameOptions, Health, SaveListing } from './api-types.ts';

export interface DeadIsDeadSlot {
  readonly name: string | null;
  readonly description: string;
}

export interface NewCampaign {
  readonly options: GameOptions;
  readonly deadIsDead?: DeadIsDeadSlot;
}

export interface SessionStatus {
  readonly canSave: boolean;
  readonly options: GameOptions | null;
}

export interface FrontEndClient extends SaveApi {
  readonly session: string | null;
  readonly view: PlayerView | null;
  health(): Promise<Health>;
  saves(): Promise<SaveListing[]>;
  newCampaign(campaign: NewCampaign): Promise<string>;
  connect(session: string): Promise<void>;
  status(): Promise<SessionStatus>;
  setBloodAndGore(on: boolean): Promise<void>;
  closeSession(): Promise<void>;
  leaveSession(): void;
}

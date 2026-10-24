import type { CommandEnvelope, DriverMode, StopCondition } from '../../../protocol/messages.ts';
import type { PlayerView } from '../../../protocol/view.ts';
import type { LayoutModel } from '../../layout/model.ts';
import type { MessageBoxes } from '../../message-boxes.ts';
import type { UiRuntime } from '../../runtime.ts';
import type { UiTextService } from '../../text/text-service.ts';

export const BattleLayout = {
  PRE_BATTLE: 'pre-battle',
  AUTORESOLVE: 'autoresolve',
} as const;
export type BattleLayout = (typeof BattleLayout)[keyof typeof BattleLayout];
export const BATTLE_LAYOUTS: readonly BattleLayout[] = Object.values(BattleLayout);

export interface BattleReply {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: unknown;
}

export interface BattleClient {
  readonly view: PlayerView | null;
  command(cmd: CommandEnvelope): Promise<BattleReply>;
  drive(driver: DriverMode): void;
  advance(until: StopCondition): Promise<void>;
  showLatest(): void;
}

export type BattleVoiceSound = 'HIT1' | 'DIE1' | 'LAUGH1';

export interface BattleVoice {
  readonly profile: number | null;
  readonly generic: number;
  readonly bodyType: number;
}

export type BattleSoundRequest =
  | { readonly kind: 'weapon'; readonly item: number; readonly reloaded: boolean }
  | { readonly kind: 'effect'; readonly name: string; readonly loud: boolean }
  | { readonly kind: 'voice'; readonly sound: BattleVoiceSound; readonly voice: BattleVoice };

export interface BattleSounds {
  powerUp(): void;
  play(request: BattleSoundRequest): void;
}

export interface BattleMedia {
  image(path: string): boolean;
  faceIndex(profile: number): number | null;
}

export interface BattleFlow {
  exitGame(): void;
}

export interface BattleEnvironment {
  readonly runtime: UiRuntime;
  readonly text: UiTextService;
  readonly layout: (name: BattleLayout) => LayoutModel;
  readonly client: BattleClient;
  readonly sounds: BattleSounds;
  readonly media: BattleMedia;
  readonly boxes: MessageBoxes;
  readonly flow: BattleFlow;
  readonly random: (range: number) => number;
  readonly instantOpenings?: boolean;
}

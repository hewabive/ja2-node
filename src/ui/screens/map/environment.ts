import type { MessageEntry } from '../../../protocol/message-log.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { PlayerView, ViewFrame } from '../../../protocol/view.ts';
import type { GameClient } from '../../game-client.ts';
import type { LayoutModel } from '../../layout/model.ts';
import type { MessageBoxes } from '../../message-boxes.ts';
import type { UiRuntime } from '../../runtime.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { MercTextBoxArt } from '../../widgets/merc-text-box.ts';
import type { MessageBoxLabels, MessageBoxStyle } from '../../widgets/message-box.ts';
import type { TacticalMedia } from '../tactical/environment.ts';
import type { MapFacts } from './facts.ts';
import type { MapBoardArt } from './map-view.ts';

export const MapLayout = {
  SCREEN: 'map-screen',
  INVENTORY: 'map-inventory',
} as const;
export type MapLayout = (typeof MapLayout)[keyof typeof MapLayout];
export const MAP_LAYOUTS: readonly MapLayout[] = Object.values(MapLayout);

export interface MapCommandReply {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: unknown;
}

export interface MapClient extends GameClient {
  readonly view: PlayerView | null;
  readonly latestView: PlayerView | null;
  readonly paused: boolean;
  command(cmd: CommandEnvelope): Promise<MapCommandReply>;
  start(): void;
  stop(): void;
  setPaused(paused: boolean): void;
  holdTime(reason: string, held: boolean): void;
}

export interface MapFlow {
  options(): void;
  saveGame(): void;
  loadGame(): void;
  exitGame(): void;
  preBattle(): void;
  help?(): void;
}

export interface MapSounds {
  glowClick(): void;
  newMessageBeep(): void;
  confirmRoute(soldier: number): void;
}

export interface MapMedia extends TacticalMedia {
  readonly board: MapBoardArt;
  readonly radar: (sector: string) => string | null;
  messages(): readonly MessageEntry[];
  dialogueText(file: string, row: number): string | null;
}

export interface MapEnvironment {
  readonly runtime: UiRuntime;
  readonly text: UiTextService;
  readonly layout: (name: MapLayout) => LayoutModel;
  readonly boxes: MessageBoxes;
  readonly messageBoxStyle: (style: number) => MessageBoxStyle;
  readonly messageBoxLabels: MessageBoxLabels;
  readonly basicTextBox: MercTextBoxArt;
  readonly client: MapClient;
  readonly media: MapMedia;
  readonly facts: MapFacts;
  readonly flow: MapFlow;
  readonly sounds: MapSounds;
  readonly random: (range: number) => number;
  readonly metric: () => boolean;
  readonly notifySleepWake: () => boolean;
}

export interface MapFrames {
  frames(frames: readonly ViewFrame[]): void;
}

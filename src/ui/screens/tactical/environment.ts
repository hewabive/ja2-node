import type { AudioGap } from '../../../content/formats/gap.ts';
import type { ProfilePresentation } from '../../../content/narrative/profile-presentation.ts';
import type { CatalogueItem } from '../../../protocol/items.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { KeyView, PlayerView } from '../../../protocol/view.ts';
import type { GameClient } from '../../game-client.ts';
import type { LayoutModel } from '../../layout/model.ts';
import type { MessageBoxes } from '../../message-boxes.ts';
import type { UiRuntime } from '../../runtime.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { MercTextBoxArt } from '../../widgets/merc-text-box.ts';

export const TacticalLayout = {
  TEAM: 'tactical-team',
  SINGLE_MERC: 'tactical-sm',
  HUD: 'tactical-hud',
} as const;
export type TacticalLayout = (typeof TacticalLayout)[keyof typeof TacticalLayout];
export const TACTICAL_LAYOUTS: readonly TacticalLayout[] = Object.values(TacticalLayout);

export interface CommandReply {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: unknown;
}

export interface TacticalClient extends GameClient {
  readonly view: PlayerView | null;
  readonly latestView: PlayerView | null;
  readonly shownTick: number;
  readonly paused: boolean;
  command(cmd: CommandEnvelope): Promise<CommandReply>;
  setPaused(paused: boolean): void;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScreenBox extends ScreenPoint {
  readonly width: number;
  readonly height: number;
}

export interface RadarBox {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface UiImageRef {
  readonly path: string;
  readonly frame: number;
}

export type SoldierHeight = 'stand' | 'crouch' | 'prone';

export interface SoldierMarker {
  readonly stanceOffset: number;
  readonly hidden: boolean;
  readonly moving: boolean;
}

export interface WorldPresenter {
  readonly ready: boolean;
  readonly radarImage: string | null;
  readonly night: boolean;
  soldierTrueScreenPosition(id: number): ScreenPoint | null;
  soldierBox(id: number): ScreenBox | null;
  soldierHeight(id: number): SoldierHeight;
  soldierMarker(id: number): SoldierMarker;
  soldierAt(x: number, y: number): number | null;
  gridNoAt(x: number, y: number): number | null;
  radarViewport(): RadarBox | null;
  radarDot(gridNo: number): ScreenPoint | null;
  centerOn(gridNo: number): void;
  locate(gridNo: number): void;
  centerFromRadar(x: number, y: number): void;
  setViewport(top: number, bottom: number): void;
  setRoofLevel(on: boolean): void;
  setHovered(id: number | null): void;
  setSelected(id: number | null): void;
  itemTile(item: CatalogueItem): UiImageRef | null;
  pointerBox(selected: boolean): UiImageRef | null;
}

export interface SpeechPlayback {
  readonly speaker: number;
  readonly file: string;
  readonly elapsedMs: number;
  readonly playing: boolean;
}

export interface TacticalMedia {
  image(path: string): boolean;
  profile(id: number): ProfilePresentation | null;
  item(name: string): CatalogueItem | null;
  itemByIndex(index: number): CatalogueItem | null;
  gaps(file: string): readonly AudioGap[] | null;
  speech(): SpeechPlayback | null;
  keyItem(key: KeyView): string | null;
  readonly gunNut: boolean;
}

export interface TacticalFlow {
  options(): void;
  saveGame(): void;
  loadGame(): void;
  exitGame(): void;
  mapScreen(): void;
}

export interface TacticalSounds {
  attention(soldier: number): void;
  newMessageBeep(): void;
}

export interface TacticalEnvironment {
  readonly runtime: UiRuntime;
  readonly text: UiTextService;
  readonly layout: (name: TacticalLayout) => LayoutModel;
  readonly boxes: MessageBoxes;
  readonly basicTextBox: MercTextBoxArt;
  readonly client: TacticalClient;
  readonly world: WorldPresenter;
  readonly media: TacticalMedia;
  readonly flow: TacticalFlow;
  readonly sounds: TacticalSounds;
  readonly random: (range: number) => number;
  readonly metric: () => boolean;
}

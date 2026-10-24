import type { AudioGap } from '../../../content/formats/gap.ts';
import type { ProfilePresentation } from '../../../content/narrative/profile-presentation.ts';
import type { CatalogueItem } from '../../../protocol/items.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { KeyView, PlayerView, ViewFrame } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import type { GameClient } from '../../game-client.ts';
import type { LayoutModel } from '../../layout/model.ts';
import type { MessageBoxes } from '../../message-boxes.ts';
import type { UiRuntime } from '../../runtime.ts';
import type { DisplaySettings } from '../../settings.ts';
import type { SpeechPresenter, SpeechSettings } from '../../speech.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { MercTextBoxArt } from '../../widgets/merc-text-box.ts';
import type { UiCursorTable } from './input/ui-cursors.ts';

export const TacticalLayout = {
  TEAM: 'tactical-team',
  SINGLE_MERC: 'tactical-sm',
  HUD: 'tactical-hud',
  TALK: 'talk-panel',
  SPEECH: 'tactical-speech',
  SHOP: 'shop',
  INPUT: 'tactical-input',
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
  readonly queuedFrames: readonly ViewFrame[];
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

export type MarkerLayer = 'object' | 'roof' | 'onRoof' | 'topmost';

export interface WorldMarker {
  readonly gridNo: number;
  readonly layer: MarkerLayer;
  readonly tile: string;
  readonly head?: boolean;
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export interface InteractiveTile {
  readonly gridNo: number;
  readonly door: boolean;
  readonly switch: boolean;
  readonly open: boolean;
}

export interface ScrollEdges {
  readonly left: boolean;
  readonly right: boolean;
  readonly top: boolean;
  readonly bottom: boolean;
}

export interface OverheadMapView {
  render(list: DrawList, x: number, y: number): void;
  pointOf(gridNo: number): ScreenPoint;
  gridNoAt(x: number, y: number): number | null;
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
  cellScreenPosition(gridNo: number): ScreenPoint;
  setMarkers(markers: readonly WorldMarker[]): void;
  markerScreenPoint(marker: WorldMarker): ScreenPoint | null;
  interactiveTileAt(gridNo: number, level: number): InteractiveTile | null;
  exitGridAt(gridNo: number): boolean;
  scrollEdges(): ScrollEdges;
  scrollBy(dx: number, dy: number): boolean;
  overheadMap(): OverheadMapView | null;
  tileImage(name: string): UiImageRef | null;
  tileCentre(gridNo: number): ScreenPoint;
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
  help?(): void;
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
  readonly speech?: SpeechPresenter;
  readonly speechSettings?: () => SpeechSettings;
  readonly rpcSpeechPrefixed?: boolean;
  readonly prepareText?: (file: string) => void;
  readonly uiCursors: UiCursorTable;
  readonly display: () => DisplaySettings;
  readonly setDisplay: (change: Partial<DisplaySettings>) => void;
  readonly battleSound: (soldier: number, sound: BattleSound) => void;
}

export type BattleSound = 'ok' | 'curse' | 'attention' | 'locked';

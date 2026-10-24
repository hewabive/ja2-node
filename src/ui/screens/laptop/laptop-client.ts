import type { CatalogueItem } from '../../../protocol/items.ts';
import type { ClockView, LaptopView, StrategicView } from '../../../protocol/view.ts';
import type { AssetKey } from '../../draw-list.ts';
import type { ItemGraphic } from '../../widgets/item-picture.ts';
import { type AimMemory, aimMemory } from './aim/aim-session.ts';
import { type BobbyRayMemory, bobbyRayMemory } from './bobby-ray/bobby-ray-session.ts';
import { ImpDraft } from './imp/imp-draft.ts';
import { type PagesMemory, pagesMemory } from './pages-memory.ts';

export interface LaptopCommandReply {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: unknown;
}

export interface LaptopCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface LaptopClient {
  laptop(): LaptopView | null;
  strategic(): StrategicView | null;
  clock(): ClockView | null;
  command(cmd: LaptopCommand): Promise<LaptopCommandReply>;
}

export interface LaptopProfile {
  readonly id: number;
  readonly name: string;
  readonly nickname: string;
  readonly faceIndex: number;
  readonly aimBio: number | null;
  readonly mercBio?: number | null;
}

export interface LaptopItem {
  readonly index: number;
  readonly shortName: string;
  readonly graphic: ItemGraphic;
  readonly name?: string;
  readonly ammoCapacity?: number | null;
  readonly gunCalibre?: string | null;
  readonly bigGraphic?: ItemGraphic;
  readonly catalogue?: CatalogueItem;
}

export interface LaptopData {
  profile(id: number): LaptopProfile | undefined;
  item(index: number): LaptopItem | undefined;
}

export interface LaptopSettings {
  readonly loadingTimeScale: number;
  readonly slideStepMs?: number;
  readonly subtitles: boolean;
  readonly speech: boolean;
  readonly metric?: boolean;
}

export interface LaptopMedia {
  loadImages(paths: readonly AssetKey[]): Promise<void>;
  loadTexts(files: readonly string[]): Promise<void>;
  random(range: number): number;
}

export const DEFAULT_LAPTOP_SETTINGS: LaptopSettings = { loadingTimeScale: 1, subtitles: true, speech: true };

export interface LaptopMemory {
  emailPage: number;
  financesPage: number;
  readonly aim: AimMemory;
  readonly pages: PagesMemory;
  readonly bobbyRay: BobbyRayMemory;
  readonly imp: ImpDraft;
}

export function laptopMemory(): LaptopMemory {
  return { emailPage: 0, financesPage: 0, aim: aimMemory(), pages: pagesMemory(), bobbyRay: bobbyRayMemory(), imp: new ImpDraft() };
}

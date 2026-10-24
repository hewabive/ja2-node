import type { LaptopView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import type { LayoutController } from '../../layout/controller.ts';
import type { CustomRenderer } from '../../layout/view.ts';
import type { UiServices } from '../../services.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { MessageBoxFlag } from '../../widgets/message-box.ts';
import type { AimSession } from './aim/aim-session.ts';
import type {
  LaptopClient,
  LaptopCommand,
  LaptopCommandReply,
  LaptopData,
  LaptopMedia,
  LaptopMemory,
  LaptopSettings,
} from './laptop-client.ts';
import type { LaptopShell } from './laptop-shell.ts';

export interface PageLayout {
  readonly name: string;
  readonly controller: LayoutController;
}

export interface LaptopPage {
  readonly layouts: readonly PageLayout[];
  readonly custom?: Readonly<Record<string, CustomRenderer>>;
  update(now: number): void;
  dispose?(): void;
  renderOverlay?(list: DrawList, redraw: (list: DrawList) => void): void;
  cancelPopup?(): boolean;
  closeView?(): boolean;
  escape?(): boolean;
  blocksNewMail?(): boolean;
}

export interface LaptopContext {
  readonly client: LaptopClient;
  readonly data: LaptopData;
  readonly text: UiTextService;
  readonly services: UiServices;
  readonly settings: LaptopSettings;
  readonly media: LaptopMedia;
  readonly shell: LaptopShell;
  readonly aim: AimSession;
  readonly memory: LaptopMemory;
  readonly dataVersion: string;
  view(): LaptopView | null;
  command(cmd: LaptopCommand): Promise<LaptopCommandReply>;
  string(table: string, index?: number): string;
  messageBox(text: string, flags: MessageBoxFlag, onClose?: (result: number) => void, style?: number): void;
  playSound(file: string, volume: number): void;
  openOldestUnreadMail(): void;
  takeOpenUnreadMailRequest(): boolean;
  takeOpenUnreadFileRequest(): boolean;
  constant(layout: string, name: string): number;
  leftButtonUp(): void;
  rightButtonUp(): void;
}

export type PageFactory = (context: LaptopContext) => LaptopPage;

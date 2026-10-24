import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import type { LayoutModel } from '../../src/ui/layout/model.ts';
import { ORIGINAL_SKIN } from '../../src/ui/layout/types.ts';
import { HELP_FILE, HELP_SCREEN_LAYOUT } from '../../src/ui/screens/help/help-overlay.ts';
import type { HelpSeenStore } from '../../src/ui/screens/help/help-system.ts';
import type { UiTextService } from '../../src/ui/text/text-service.ts';
import { planStubSkin, readOriginalLayouts } from '../../stubs/ui/skin.ts';
import { projectLayoutLoader, type TestRuntime } from './ui-runtime.ts';

const HELP_ROWS = join(import.meta.dirname, '../../stubs/text/help.json');
const HELP_TABLE = join(PROJECT_DATA_DIR, 'tables/ui-constants/HelpScreen.json');

export async function helpLayout(): Promise<LayoutModel> {
  return projectLayoutLoader().load(ORIGINAL_SKIN, HELP_SCREEN_LAYOUT);
}

export async function stubHelpRows(): Promise<Map<number, string>> {
  const rows = JSON.parse(await readFile(HELP_ROWS, 'utf8')).rows as Record<string, string>;
  const constants = JSON.parse(await readFile(HELP_TABLE, 'utf8')).constants as Record<string, number>;
  return new Map(Object.entries(rows).map(([name, text]) => [constants[name] as number, text]));
}

export async function stubHelpText(strings: UiTextService['string'] = () => null): Promise<UiTextService> {
  const rows = await stubHelpRows();
  return { string: strings, edt: (file, row) => (file === HELP_FILE ? (rows.get(row) ?? null) : null) };
}

export async function registerStubSkin(t: TestRuntime): Promise<void> {
  for (const plan of planStubSkin(await readOriginalLayouts()).values())
    t.images.set(plan.path, {
      kind: 'indexed',
      animatedFrames: plan.animated,
      frames: plan.frames.map((f) => ({ width: f.width, height: f.height, offsetX: 0, offsetY: 0 })),
    });
}

export class MemoryHelpStore implements HelpSeenStore {
  hiddenFlag = false;
  readonly seenBits = new Set<number>();
  readonly hiddenChanges: boolean[] = [];

  hidden(): boolean {
    return this.hiddenFlag;
  }

  seen(bit: number): boolean {
    return this.seenBits.has(bit);
  }

  markSeen(bit: number): void {
    this.seenBits.add(bit);
  }

  setHidden(hidden: boolean): void {
    this.hiddenFlag = hidden;
    this.hiddenChanges.push(hidden);
  }
}

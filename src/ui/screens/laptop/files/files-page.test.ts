import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clickWidget,
  findWidget,
  type LaptopUiKit,
  laptopUiKit,
  openLaptopHarness,
  openProgram,
  settleLaptop,
  shownWidget,
} from '../../../../../tests/support/laptop-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../../tests/support/sectors.ts';
import { addFile, ENRICO_BACKGROUND_FILE } from '../../../../sim/campaign/laptop/records.ts';
import { LaptopMode } from '../laptop-modes.ts';
import { NO_FILE } from '../pages-memory.ts';
import { selectedAfterClick } from './files-page.ts';

const TERRORIST_FILES = [1, 2, 3, 4, 5, 6];

let kit: StubSectorKit;
let ui: LaptopUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await laptopUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

describe('the files page', () => {
  it('selects a row only when it holds a file', () => {
    expect(selectedAfterClick(0, 1)).toBe(0);
    expect(selectedAfterClick(1, 1)).toBe(NO_FILE);
  });

  it('opens the background report, marks it read, pages it and drops the selection on an empty row', async () => {
    const h = await openLaptopHarness(kit, ui);
    await openProgram(h, 'filesButton');
    expect(h.screen.shell.mode).toBe(LaptopMode.FILES);
    expect(shownWidget(h.t, 'fileSender0').text).toBe('Recon Report');
    expect(findWidget(h.t, 'fileText')?.visible).toBe(false);
    expect(shownWidget(h.t, 'nextFilePage').enabled).toBe(false);
    await clickWidget(h.t, 'fileRow0');
    expect(shownWidget(h.t, 'fileText').visible).toBe(true);
    expect(h.commands).toContainEqual({ type: 'readFile', code: ENRICO_BACKGROUND_FILE });
    expect(h.laptop().files[0]?.read).toBe(true);
    expect(shownWidget(h.t, 'prevFilePage').enabled).toBe(false);
    expect(shownWidget(h.t, 'nextFilePage').enabled).toBe(true);
    await clickWidget(h.t, 'nextFilePage');
    expect(h.screen.shell.mode).toBe(LaptopMode.FILES);
    expect(shownWidget(h.t, 'prevFilePage').enabled).toBe(true);
    let pages = 1;
    while (shownWidget(h.t, 'nextFilePage').enabled && pages < 20) {
      await clickWidget(h.t, 'nextFilePage');
      pages++;
    }
    expect(pages).toBeGreaterThan(2);
    expect(shownWidget(h.t, 'nextFilePage').enabled).toBe(false);
    await clickWidget(h.t, 'prevFilePage');
    expect(shownWidget(h.t, 'nextFilePage').enabled).toBe(true);
    await clickWidget(h.t, 'fileRow3');
    expect(findWidget(h.t, 'fileText')?.visible).toBe(false);
  });

  it('opens the last unread file from the taskbar icon and reads it', async () => {
    const h = await openLaptopHarness(kit, ui);
    const l = h.session.campaign.state.laptop;
    for (const code of TERRORIST_FILES) addFile(l, code);
    await openProgram(h, 'emailButton');
    await clickWidget(h.t, 'newFileIcon');
    await settleLaptop(h.t, 12);
    expect(h.screen.shell.mode).toBe(LaptopMode.FILES);
    expect(shownWidget(h.t, 'fileSender6').text).toBe('Intercept #6');
    expect(shownWidget(h.t, 'fileText').visible).toBe(true);
    expect(h.commands.filter((c) => c.type === 'readFile')).toEqual([{ type: 'readFile', code: 6 }]);
    expect(h.laptop().files.map((f) => f.read)).toEqual([false, false, false, false, false, false, true]);
  });
});

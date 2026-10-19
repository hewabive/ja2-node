import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCursorTable } from '../../../tools/transcribe/cursors.ts';
import { buildMlgTable } from '../../../tools/transcribe/mlg.ts';
import { buildUiConstantTables } from '../../../tools/transcribe/ui-constants.ts';
import { PROJECT_DATA_DIR, REPO_ROOT } from '../../node/repo.ts';
import { constantTablePath, parseConstantTable } from './constants.ts';
import { MLG_TABLE_PATH, mlgPath, parseMlgTable } from './model.ts';

async function table(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
}

describe('the transcribed UI tables', () => {
  it('hold the message box, options and timer constants, std640 positions and the font files', async () => {
    const box = parseConstantTable(await table(constantTablePath('MessageBoxScreen')), 'MessageBoxScreen');
    expect(box.constants).toMatchObject({
      MSGBOX_BUTTON_WIDTH: 61,
      MSGBOX_BUTTON_HEIGHT: 20,
      MSG_BOX_FLAG_GENERIC: 8,
      MSG_BOX_LAPTOP_DEFAULT: 5,
    });
    const options = parseConstantTable(await table(constantTablePath('Options_Screen')), 'Options_Screen');
    expect(options.constants).toMatchObject({ OPT_SAVE_BTN_X: 51, OPT_MAIN_FONT: 'FONT12ARIAL', OPT_HIGHLIGHT_COLOR: 208 });
    expect(options.stdScreen).toContain('OPT_SAVE_BTN_X');
    const timers = parseConstantTable(await table(constantTablePath('Timer_Control')), 'Timer_Control');
    expect(timers.constants).toMatchObject({
      CURSORCOUNTER_MS: 150,
      CURSORFLASHUPDATE_MS: 250,
      INVALID_AP_HOLD_MS: 500,
      PATHFINDCOUNTER_MS: 80,
    });
    const fonts = parseConstantTable(await table(constantTablePath('Font_Control')), 'Font_Control');
    expect(fonts.fonts).toMatchObject({
      FONT10ARIAL: 'fonts/font10arial.sti',
      MILITARYFONT1: 'fonts/blockfont.sti',
      HUGEFONT: 'fonts/font16arial.sti',
    });
    expect(Object.keys(fonts.fonts ?? {})).toHaveLength(18);
  });

  it('map the MLG ids per data version', async () => {
    const mlg = parseMlgTable(await table(MLG_TABLE_PATH));
    expect(mlg.ids).toHaveLength(33);
    expect(mlgPath(mlg, 'MLG_TITLETEXT', 'stubs')).toBe('loadscreens/titletext.sti');
    expect(mlgPath(mlg, 'MLG_TITLETEXT', 'german')).toBe('german/titletext_german.sti');
    expect(mlgPath(mlg, 'MLG_DESKTOP', 'polish')).toBe('polish/desktop_polish.pcx');
  });

  it.skipIf(!existsSync(join(REPO_ROOT, 'reference/stracciatella/src')))(
    'are what the transcribers produce from the reference sources',
    async () => {
      for (const [name, generated] of buildUiConstantTables()) expect(await table(constantTablePath(name)), name).toEqual(generated);
      expect(await table(MLG_TABLE_PATH)).toEqual(buildMlgTable());
      expect(await table('tables/cursors.json')).toEqual(buildCursorTable());
    },
  );
});

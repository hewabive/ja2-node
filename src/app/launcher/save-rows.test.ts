import { describe, expect, it } from 'vitest';
import type { GameOptions, SaveHeader, SaveListing } from './api.ts';
import { LABELS, type LabelId, Labels } from './labels.ts';
import {
  clampDescription,
  formatDay,
  formatLocation,
  formatMercs,
  formatMoney,
  loadWarningText,
  overwriteTarget,
  predictLoadWarnings,
  saveRow,
  uploadName,
} from './save-rows.ts';

const LABEL_IDS = Object.keys(LABELS) as LabelId[];

function tableLabels(): Labels {
  const tables: Record<string, string | string[]> = {};
  for (const id of LABEL_IDS) {
    const source = LABELS[id];
    if (!('table' in source)) continue;
    if (source.index === null) {
      tables[source.table] = `<${id}>`;
      continue;
    }
    const list = (tables[source.table] as string[] | undefined) ?? [];
    list[source.index] = `<${id}>`;
    tables[source.table] = list;
  }
  return new Labels('eng', tables);
}

const labels = tableLabels();
const OPTIONS: GameOptions = { difficulty: 2, sciFi: false, gunNut: true, saveMode: 'deadIsDead', bloodAndGore: false };

function header(overrides: Partial<SaveHeader> = {}): SaveHeader {
  return {
    kind: 'player',
    description: 'Before the attack',
    savedAt: '2026-10-18T10:00:00.000Z',
    engine: { version: '0.0.0', commit: 'abc' },
    content: { source: 'stubs', dataVersion: 'stubs' },
    options: OPTIONS,
    world: { day: 3, hour: 7, minute: 5 },
    sector: 'A9',
    flow: 'tactical',
    mercs: 4,
    balance: 12_345,
    campaign: 'playing',
    session: 'campaign',
    tick: 100,
    ...overrides,
  };
}

function own(h: SaveHeader | null, problems: string[] = []): SaveListing {
  return {
    name: 'save-1',
    native: false,
    modified: '2026-10-18T10:00:00.000Z',
    header: h,
    version: 1,
    compatible: problems.length === 0,
    problems,
  };
}

describe('save rows', () => {
  it('print money like SPrintMoney', () => {
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(999)).toBe('$999');
    expect(formatMoney(1000)).toBe('$1,000');
    expect(formatMoney(1_234_567)).toBe('$1,234,567');
    expect(formatMoney(-1234)).toBe('$-1,234');
    expect(formatMoney(-123)).toBe('$-123');
  });

  it('show the day and time, the sector, the mercs and the balance', () => {
    expect(formatDay(labels, { day: 12, hour: 4, minute: 0 })).toBe('<day> 12, 04:00');
    expect(formatDay(labels, null)).toBe('');
    expect(formatMercs(labels, 1)).toBe('1 <merc>');
    expect(formatMercs(labels, 5)).toBe('5 <mercs>');
    expect(formatLocation(labels, 'B13-1', null)).toBe('B13-1');
    expect(formatLocation(labels, null, { day: 1, hour: 1, minute: 0 })).toBe('<notApplicable>');
    expect(formatLocation(labels, null, { day: 1, hour: 1, minute: 1 })).toBe('<noSector>');
  });

  it('build a row with the Dead is Dead mark and an options tooltip with the data version', () => {
    const row = saveRow(own(header()), labels);
    expect(row).toMatchObject({
      name: 'save-1',
      native: false,
      kind: 'player',
      session: 'campaign',
      date: '<day> 3, 07:05',
      sector: 'A9',
      mercs: '4 <mercs>',
      balance: '$12,345',
      description: 'Before the attack',
      deadIsDead: true,
      compatible: true,
    });
    expect(row.tooltip.split('\n')).toEqual([
      '<medium> <difficultySuffix>',
      '<deadIsDead>',
      '<tonsOfGuns>',
      '<realisticStyle>',
      '<bloodAndGore>: <no>',
      `${LABELS.dataVersion.eng}: stubs`,
      'save-1',
    ]);
    expect(saveRow(own(header({ options: { ...OPTIONS, saveMode: 'anywhere' } })), labels).deadIsDead).toBe(false);
  });

  it('list an unreadable save by name with its problems', () => {
    const row = saveRow(own(null, ['corrupt']), labels);
    expect(row).toMatchObject({ description: 'save-1', date: '', sector: '', compatible: false, problems: ['corrupt'] });
    expect(row.tooltip).toBe('save-1\ncorrupt');
  });

  it('build native rows from the native header', () => {
    const listing: SaveListing = {
      name: 'SaveGame01',
      native: true,
      modified: '2026-10-18T09:00:00.000Z',
      header: {
        description: 'Drassen',
        world: { day: 5, hour: 13, minute: 30 },
        sector: { x: 13, y: 4, z: 0 },
        mercs: 1,
        balance: 500,
        version: 99,
        options: { ...OPTIONS, saveMode: 'ironMan' },
      },
      compatible: false,
      problems: ['needsOriginalData'],
    };
    const row = saveRow(listing, labels);
    expect(row).toMatchObject({ native: true, sector: 'D13', mercs: '1 <merc>', balance: '$500', deadIsDead: false, compatible: false });
    expect(row.tooltip).toContain('<ironMan>');
    expect(row.tooltip).toContain(LABELS.nativeSave.eng);
    const invalid = { ...listing, header: { ...listing.header, sector: { x: 0, y: 0, z: 0 } } };
    expect(saveRow(invalid, labels).sector).toBe('<noSector>');
  });

  it('predict the load warnings and put them in one box', () => {
    const h = header();
    expect(predictLoadWarnings(h, { dataVersion: 'stubs', engine: { version: '0.0.0', commit: 'abc' } })).toEqual([]);
    expect(predictLoadWarnings(h, { dataVersion: 'stubs' })).toEqual([]);
    expect(predictLoadWarnings(h, { dataVersion: 'english', engine: { version: '0.0.0', commit: 'def' } })).toEqual([
      'dataVersionDiffers',
      'engineDiffers',
    ]);
    expect(loadWarningText(labels, ['dataVersionDiffers', 'engineDiffers']).split('\n')).toEqual([
      '<savedGameIssue>',
      `- ${LABELS.dataVersionDiffers.eng}`,
      '- <gameVersionDiffers>',
      '<continueAnyway>',
    ]);
  });

  it('save over player and quick saves but never over autosaves or native saves', () => {
    expect(overwriteTarget({ name: 'save-1', native: false, kind: 'player' })).toBe('save-1');
    expect(overwriteTarget({ name: 'QuickSave', native: false, kind: 'quick' })).toBe('quick');
    expect(overwriteTarget({ name: 'Auto01', native: false, kind: 'auto' })).toBeNull();
    expect(overwriteTarget({ name: 'SaveGame01', native: true, kind: null })).toBeNull();
  });

  it('cut descriptions to 46 characters on one line', () => {
    expect(clampDescription('a\nb')).toBe('a b');
    expect([...clampDescription('й'.repeat(60))]).toHaveLength(46);
  });

  it('name uploads after the file, never reserved or taken names', () => {
    expect(uploadName('QuickSave.j2s', [])).toBe('QuickSave-2');
    expect(uploadName('/home/me/My Save (1).j2s', [])).toBe('My-Save-1-');
    expect(uploadName('battle.j2s', ['battle', 'Battle-2'])).toBe('battle-3');
    expect(uploadName('...', [])).toBe('upload');
    expect(uploadName('Сохранение.j2s', [])).toBe('upload');
    expect(uploadName(`${'x'.repeat(80)}.j2s`, ['x'.repeat(64)])).toBe(`${'x'.repeat(62)}-2`);
  });
});

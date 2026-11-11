import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UI_LANGUAGES } from '../../content/text/data-version.ts';
import { loadUiStrings } from '../../content/text/strings.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { LABELS, type LabelId, Labels, type OriginalLabel, originalText } from './labels.ts';
import { printf } from './printf.ts';

const read = async (path: string): Promise<Uint8Array | null> => readFile(join(PROJECT_DATA_DIR, path)).catch(() => null);
const CYRILLIC = /[Ѐ-ӿ]/;
const LABEL_IDS = Object.keys(LABELS) as LabelId[];
const originalIds = LABEL_IDS.filter((id) => 'table' in LABELS[id]);
const ownIds = LABEL_IDS.filter((id) => !('table' in LABELS[id]));

describe('launcher labels', () => {
  it('resolve every original label to a string in all eight languages', async () => {
    for (const language of UI_LANGUAGES) {
      const strings = await loadUiStrings(read, language);
      for (const id of originalIds) {
        const text = originalText(strings.tables, LABELS[id] as OriginalLabel);
        expect(typeof text, `${language} ${id}`).toBe('string');
      }
    }
  });

  it('take original labels from the chosen language and ja2-node labels from the small table', async () => {
    const eng = await loadUiStrings(read, 'eng');
    const rus = await loadUiStrings(read, 'rus');
    const english = new Labels('eng', eng.tables);
    const russian = new Labels('rus', rus.tables);
    expect(russian.text('saveGame')).toBe(originalText(rus.tables, LABELS.saveGame));
    expect(russian.text('saveGame')).not.toBe(english.text('saveGame'));
    expect(russian.text('saveGame')).toMatch(CYRILLIC);
    expect(russian.text('savedGames')).toBe(LABELS.savedGames.rus);
    expect(english.text('savedGames')).toBe(LABELS.savedGames.eng);
  });

  it('give every ja2-node label an English and a Russian text', () => {
    for (const id of ownIds) {
      const label = LABELS[id] as { eng: string; rus: string };
      expect(label.eng.length, id).toBeGreaterThan(0);
      expect(label.rus, id).toMatch(CYRILLIC);
    }
  });

  it('fall back to English for ja2-node labels in other languages and to the id without string tables', () => {
    const german = new Labels('ger', null);
    expect(german.text('savedGames')).toBe(LABELS.savedGames.eng);
    expect(german.text('saveGame')).toBe('saveGame');
    expect(german.loaded).toBe(false);
    expect(new Labels('rus', { zSaveLoadText: [] }).text('saveGame')).toBe('saveGame');
    expect(new Labels('rus', { gs_dead_is_dead_mode_tab_name: 'not an array' }).text('deadIsDeadMark')).toBe('deadIsDeadMark');
  });

  it('read array entries', () => {
    const labels = new Labels('eng', { gs_dead_is_dead_mode_tab_name: ['Normal', 'DiD'] });
    expect(labels.text('deadIsDeadMark')).toBe('DiD');
  });

  it('format printf placeholders in order', () => {
    expect(printf('delete "%s"?', ['save 1'])).toBe('delete "save 1"?');
    expect(printf('%s has %d of %s', ['Ivan', 3.7, 'ten'])).toBe('Ivan has 3 of ten');
    expect(printf('100%% %s', ['sure'])).toBe('100% sure');
    expect(printf('%s and %s', ['one'])).toBe('one and %s');
    const labels = new Labels('eng', { zSaveLoadText: Array.from({ length: 24 }, (_, i) => (i === 10 ? 'delete "%s"?' : '')) });
    expect(labels.format('confirmDelete', 'Omerta')).toBe('delete "Omerta"?');
  });
});

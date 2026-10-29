import { describe, expect, it } from 'vitest';
import type { UiTextService } from '../../text/text-service.ts';
import { formatMessageEntry } from './message-format.ts';

const STRINGS: Readonly<Record<string, string>> = { 'TacticalStr:111': 'Gun fingerprinted', 'TacticalStr:87': 'Not enough APs' };
const text = { string: (table: string, index: number) => STRINGS[`${table}:${index}`] ?? null } as UiTextService;
const sources = { text, itemByIndex: () => null };

describe('message entries as text', () => {
  it('wraps a quoted entry in double quotes, as the original formats "\\"{}\\""', () => {
    const quoted = formatMessageEntry({ tick: 0, kind: 'interface', colour: 145, table: 'TacticalStr', index: 111, quoted: true }, sources);
    expect(quoted).toBe('"Gun fingerprinted"');
    expect(formatMessageEntry({ tick: 0, kind: 'uiFeedback', colour: 144, table: 'TacticalStr', index: 87 }, sources)).toBe(
      'Not enough APs',
    );
  });
});

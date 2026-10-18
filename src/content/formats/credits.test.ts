import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../node/repo.ts';
import { type CreditNode, type CreditStyle, FontColour, INITIAL_CREDIT_STYLE, readCreditRow, scanUnsigned } from './credits.ts';

async function stubCreditRows(): Promise<string[]> {
  const json = JSON.parse(await readFile(join(REPO_ROOT, 'stubs/text/credits.json'), 'utf8')) as { rows: string[] };
  return json.rows;
}

function readAll(rows: readonly string[]): { nodes: CreditNode[]; styles: CreditStyle[]; unknown: string[] } {
  let style = INITIAL_CREDIT_STYLE;
  const nodes: CreditNode[] = [];
  const styles: CreditStyle[] = [];
  const unknown: string[] = [];
  for (const text of rows) {
    const row = readCreditRow(text, style);
    style = row.style;
    styles.push(style);
    if (row.node) nodes.push(row.node);
    unknown.push(...row.unknownCodes);
  }
  return { nodes, styles, unknown };
}

describe('credit control codes', () => {
  it('starts with the defaults of the credits screen', () => {
    expect(INITIAL_CREDIT_STYLE).toEqual({
      nodeGap: 12,
      sectionGap: 50,
      gapBeforeNextRow: 12,
      scrollDelayMs: 25,
      justification: 'center',
      titleColour: FontColour.RED,
      activeColour: FontColour.DARK_WHITE,
    });
  });

  it('reads the stub credits.edt rows: settings, titles, sections and plain lines', async () => {
    const rows = (await stubCreditRows()).slice(1);
    const { nodes, styles, unknown } = readAll(rows);
    expect(unknown).toEqual([]);
    expect(styles[0]).toMatchObject({
      nodeGap: 12,
      sectionGap: 50,
      scrollDelayMs: 25,
      justification: 'center',
      titleColour: 208,
      activeColour: 134,
    });
    expect(nodes[0]).toEqual({ text: 'ja2-node', title: true, justification: 'center', colour: 208 });
    expect(nodes[1]).toEqual({ text: 'A fan reimplementation in TypeScript', title: false, justification: 'center', colour: 134 });
    expect(nodes.filter((n) => n.title).map((n) => n.text)).toEqual([
      'ja2-node',
      'Simulation',
      'Presentation',
      'Stub pack',
      'Thanks',
      'The end',
    ]);
    expect(nodes.find((n) => n.text.startsWith('Sounds'))?.justification).toBe('left');
    expect(nodes.find((n) => n.text === 'Thanks')?.justification).toBe('center');
    expect(styles.at(-1)).toMatchObject({ scrollDelayMs: 15, sectionGap: 80, gapBeforeNextRow: 80 });
  });

  it('sets the gap before the next row from the section flags after the codes of the same row', () => {
    const opened = readCreditRow('@D20,{;Name', INITIAL_CREDIT_STYLE);
    expect(opened.style.gapBeforeNextRow).toBe(20);
    const closed = readCreditRow('@B70,};Role', opened.style);
    expect(closed.style.gapBeforeNextRow).toBe(70);
    expect(readCreditRow('@{,};Both', INITIAL_CREDIT_STYLE).style.gapBeforeNextRow).toBe(50);
    expect(readCreditRow('plain text', closed.style)).toEqual({
      style: closed.style,
      node: { text: 'plain text', title: false, justification: 'center', colour: FontColour.DARK_WHITE },
      unknownCodes: [],
    });
  });

  it('keeps code-only rows silent, skips the rest of a code up to the next separator and reports unknown codes', () => {
    expect(readCreditRow('@S40;', INITIAL_CREDIT_STYLE)).toMatchObject({ node: null, style: { scrollDelayMs: 40 } });
    expect(readCreditRow('@S40xyz,C5', INITIAL_CREDIT_STYLE)).toMatchObject({ node: null, style: { scrollDelayMs: 40, titleColour: 5 } });
    expect(readCreditRow('@Q1,J2;x', INITIAL_CREDIT_STYLE)).toMatchObject({ unknownCodes: ['Q'], node: { justification: 'right' } });
    expect(readCreditRow('@J7;x', INITIAL_CREDIT_STYLE)).toMatchObject({ unknownCodes: ['J'], node: { justification: 'center' } });
    expect(readCreditRow('@', INITIAL_CREDIT_STYLE).node).toBeNull();
    expect(readCreditRow('@T,', INITIAL_CREDIT_STYLE).node).toBeNull();
    expect(readCreditRow('@C300;x', INITIAL_CREDIT_STYLE).style.titleColour).toBe(300 & 0xff);
  });

  it('parses numbers like sscanf %u', () => {
    expect(scanUnsigned('12,B50', 0)).toBe(12);
    expect(scanUnsigned(' 7;', 0)).toBe(7);
    expect(scanUnsigned('x', 0)).toBe(0);
    expect(scanUnsigned('-5', 0)).toBe(0xfffffffb);
    expect(scanUnsigned('99999999999', 0)).toBe(0xffffffff);
  });
});

import { join } from 'node:path';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { cleanSource, enumDefinitions, evaluateConstant, objectDefines, splitArguments } from './c-constants.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, writeTable } from './c-source.ts';

const INTERFACE_CURSORS_CC = 'game/Tactical/Interface_Cursors.cc';
const INTERFACE_CURSORS_H = 'game/Tactical/Interface_Cursors.h';
const UI_CURSORS = 'const UICursor gUICursors[NUM_UI_CURSORS] =';
const UI_CURSOR_ENUM = 'UICursorID';
const UI_CURSOR_COUNT = 'NUM_UI_CURSORS';
const FLAG_PREFIX = 'UICURSOR_';
const NO_NAME = '0';

export interface UiCursorEntry {
  readonly name: string;
  readonly flags: number;
  readonly cursor: string | null;
  readonly data: string | null;
}

function topLevelEntries(body: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (body[i] === '}') {
      depth--;
      if (depth === 0) entries.push(body.slice(start, i));
    }
  }
  return entries;
}

const nameOrNull = (expression: string) => (expression.trim() === NO_NAME ? null : expression.trim());

export function buildUiCursorTable(): unknown {
  const src = cleanSource(readSource(INTERFACE_CURSORS_CC));
  const header = cleanSource(readSource(INTERFACE_CURSORS_H));
  const flags = new Map<string, number>();
  for (const d of objectDefines(header)) {
    if (!d.name.startsWith(FLAG_PREFIX)) continue;
    const value = evaluateConstant(d.expression, (n) => flags.get(n) ?? null);
    if (value !== null) flags.set(d.name, value);
  }
  const names = enumDefinitions(header)
    .find((e) => e.name === UI_CURSOR_ENUM)
    ?.members.map((m) => m.name)
    .filter((n) => n !== UI_CURSOR_COUNT);
  if (!names) throw new Error(`${UI_CURSOR_ENUM} not found`);
  const cursors: UiCursorEntry[] = topLevelEntries(bracedBody(src, UI_CURSORS)).map((entry, i) => {
    const [, flagExpression = '0', cursor = NO_NAME, data = NO_NAME] = splitArguments(entry);
    const value = evaluateConstant(flagExpression, (n) => flags.get(n) ?? null);
    if (value === null) throw new Error(`cannot evaluate ${flagExpression}`);
    return { name: names[i] ?? `#${i}`, flags: value, cursor: nameOrNull(cursor), data: nameOrNull(data) };
  });
  if (cursors.length !== names.length) throw new Error(`${cursors.length} UI cursors for ${names.length} names`);
  return {
    source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/${INTERFACE_CURSORS_CC} gUICursors; src/${INTERFACE_CURSORS_H} UICursorID, UICURSOR_*`,
    license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
    format:
      'cursors: gUICursors by position in UICursorID order (the array is indexed by position; its first field is not read): flags (UICURSOR_*), cursor (usFreeCursorName: a CursorTypeDefines name, VIDEO_DEFAULT_TO_NO_CURSOR or null) and data (usAdditionalData: a FIRSTPOINTERS tile name, or for the out-of-range talk cursors a CursorTypeDefines name, or null)',
    flags: Object.fromEntries(flags),
    cursors,
  };
}

if (import.meta.main) {
  const target = join(PROJECT_DATA_DIR, 'tables', 'ui-cursors.json');
  const table = buildUiCursorTable() as { cursors: unknown[] };
  writeTable(target, table);
  console.log(`${target}: ${table.cursors.length} UI cursors`);
}

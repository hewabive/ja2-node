import { join } from 'node:path';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import {
  cleanSource,
  enumDefinitions,
  evaluateConstant,
  expandMacros,
  functionMacros,
  objectDefines,
  splitArguments,
  stringLiteral,
} from './c-constants.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, writeTable } from './c-source.ts';

const CURSORS_CC = 'game/Utils/Cursors.cc';
const CURSORS_H = 'game/Utils/Cursors.h';
const CURSOR_CONTROL_H = 'sgp/Cursor_Control.h';
const VIDEO_H = 'sgp/Video.h';
const DIRECTORIES_H = 'game/Directories.h';
const FILE_DATABASE = 'static CursorFileData CursorFileDatabase[] =';
const CURSOR_DATABASE = 'static CursorData CursorDatabase[] =';
const FILE_ENUM = 'CursorSurfaceDefines';
const CURSOR_ENUM = 'CursorTypeDefines';
const FILE_COUNT = 'NUM_CURSOR_FILES';
const COMPOSITE_FIELDS = 5;
const MAX_COMPOSITES = 5;
const CURSOR_FIELDS = 8;

type SubPosition = number | 'center' | 'hide';
type HotSpot = number | 'center' | 'left' | 'right' | 'top' | 'bottom';

export interface CursorFileEntry {
  readonly name: string;
  readonly path: string | null;
  readonly outline: boolean;
}

export interface CursorComposite {
  readonly file: number;
  readonly frame: number;
  readonly x: SubPosition;
  readonly y: SubPosition;
}

export interface CursorEntry {
  readonly name: string;
  readonly composites: readonly CursorComposite[];
  readonly hotX: HotSpot;
  readonly hotY: HotSpot;
  readonly flags: number;
  readonly hideOnTouch: boolean;
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

export function buildCursorTable(): unknown {
  const src = cleanSource(readSource(CURSORS_CC));
  const header = cleanSource(readSource(CURSORS_H));
  const control = new Map<string, number>();
  for (const d of [...objectDefines(cleanSource(readSource(CURSOR_CONTROL_H))), ...objectDefines(cleanSource(readSource(VIDEO_H)))]) {
    const value = evaluateConstant(d.expression, (n) => control.get(n) ?? null);
    if (value !== null) control.set(d.name, value);
  }
  const directories = new Map(objectDefines(cleanSource(readSource(DIRECTORIES_H))).map((d) => [d.name, d.expression.replace(/"/g, '')]));
  const enumNames = (name: string) => {
    const e = enumDefinitions(header).find((x) => x.name === name);
    if (!e) throw new Error(`${name} not found`);
    return e.members.map((m) => m.name);
  };
  const fileNames = enumNames(FILE_ENUM).filter((n) => n !== FILE_COUNT);
  const cursorNames = enumNames(CURSOR_ENUM);
  const macros = functionMacros(src);

  const files: CursorFileEntry[] = splitArguments(bracedBody(src, FILE_DATABASE)).map((item, i) => {
    const expanded = expandMacros(item, macros).replace(/^\{|\}$/g, '');
    const [nameExpression = '', , flagsExpression = '0'] = splitArguments(expanded);
    const path = nameExpression === 'NULL' ? null : stringLiteral(nameExpression, (n) => directories.get(n) ?? null);
    const flags = evaluateConstant(flagsExpression, (n) => control.get(n) ?? null) ?? 0;
    return {
      name: fileNames[i] ?? `#${i}`,
      path: path?.toLowerCase() ?? null,
      outline: (flags & (control.get('USE_OUTLINE_BLITTER') ?? 0)) !== 0,
    };
  });
  if (files.length !== fileNames.length) throw new Error(`${files.length} cursor files for ${fileNames.length} names`);

  const fileIndex = new Map(fileNames.map((n, i) => [n, i]));
  const value = (expression: string) => {
    if (expression === 'TRUE') return 1;
    if (expression === 'FALSE') return 0;
    const v = evaluateConstant(expression, (n) => fileIndex.get(n) ?? control.get(n) ?? null);
    if (v === null) throw new Error(`cannot evaluate ${expression}`);
    return v;
  };
  const subPosition = (v: number): SubPosition =>
    v === control.get('CENTER_SUBCURSOR') ? 'center' : v === control.get('HIDE_SUBCURSOR') ? 'hide' : v;
  const hotSpot = (v: number): HotSpot => {
    if (v === control.get('CENTER_CURSOR')) return 'center';
    if (v === control.get('RIGHT_CURSOR')) return 'right';
    if (v === control.get('LEFT_CURSOR')) return 'left';
    if (v === control.get('TOP_CURSOR')) return 'top';
    if (v === control.get('BOTTOM_CURSOR')) return 'bottom';
    return v;
  };

  const cursors: CursorEntry[] = topLevelEntries(bracedBody(src, CURSOR_DATABASE)).map((entry, i) => {
    const fields = splitArguments(expandMacros(entry, macros)).map(value);
    const tail = fields.slice(COMPOSITE_FIELDS * MAX_COMPOSITES);
    if (tail.length < CURSOR_FIELDS - 1) throw new Error(`cursor ${i}: ${fields.length} fields`);
    const [count = 0, hotX = 0, hotY = 0, , , flags = 0, , hideOnTouch = 0] = tail;
    const composites = Array.from({ length: count }, (_, c) => {
      const [file = 0, frame = 0, , x = 0, y = 0] = fields.slice(c * COMPOSITE_FIELDS, (c + 1) * COMPOSITE_FIELDS);
      return { file, frame, x: subPosition(x), y: subPosition(y) };
    });
    return { name: cursorNames[i] ?? `#${i}`, composites, hotX: hotSpot(hotX), hotY: hotSpot(hotY), flags, hideOnTouch: hideOnTouch !== 0 };
  });
  if (cursors.length !== cursorNames.length) throw new Error(`${cursors.length} cursors for ${cursorNames.length} names`);

  return {
    source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/${CURSORS_CC} CursorFileDatabase, CursorDatabase; src/${CURSORS_H} CursorSurfaceDefines, CursorTypeDefines; src/${CURSOR_CONTROL_H}; src/${DIRECTORIES_H}`,
    license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
    format:
      'files: CursorFileDatabase in CursorSurfaceDefines order (path null = the extern item graphic, drawn with the outline blitter); cursors: CursorDatabase in CursorTypeDefines order: composites (file index, frame, position or "center" = CENTER_SUBCURSOR or "hide" = HIDE_SUBCURSOR), the hot spot (a number or the CENTER/LEFT/RIGHT/TOP/BOTTOM_CURSOR name), flags (CURSOR_TO_FLASH 1, CURSOR_TO_FLASH2 2, CURSOR_TO_SUB_CONDITIONALLY 4, DELAY_START_CURSOR 8, CURSOR_TO_PLAY_SOUND 16) and fHideOnTouch',
    flags: {
      CURSOR_TO_FLASH: control.get('CURSOR_TO_FLASH'),
      CURSOR_TO_FLASH2: control.get('CURSOR_TO_FLASH2'),
      CURSOR_TO_SUB_CONDITIONALLY: control.get('CURSOR_TO_SUB_CONDITIONALLY'),
      DELAY_START_CURSOR: control.get('DELAY_START_CURSOR'),
      CURSOR_TO_PLAY_SOUND: control.get('CURSOR_TO_PLAY_SOUND'),
    },
    specialCursors: {
      VIDEO_NO_CURSOR: control.get('VIDEO_NO_CURSOR'),
      VIDEO_DEFAULT_TO_NO_CURSOR: control.get('VIDEO_DEFAULT_TO_NO_CURSOR'),
      EXTERN_CURSOR: control.get('EXTERN_CURSOR'),
    },
    files,
    cursors,
  };
}

if (import.meta.main) {
  const target = join(PROJECT_DATA_DIR, 'tables', 'cursors.json');
  const table = buildCursorTable() as { files: unknown[]; cursors: unknown[] };
  writeTable(target, table);
  console.log(`${target}: ${table.files.length} files, ${table.cursors.length} cursors`);
}

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import {
  arrayInitializer,
  type ConstantValue,
  cleanSource,
  type Definition,
  enumDefinitions,
  evaluateConstant,
  fileScopeConstants,
  objectDefines,
  stringLiteral,
} from './c-constants.ts';
import { readSource, STRACCIATELLA_COMMIT, STRACCIATELLA_SRC, writeTable } from './c-source.ts';

export const UI_CONSTANTS_DIR = join(PROJECT_DATA_DIR, 'tables', 'ui-constants');

interface TableSpec {
  readonly table: string;
  readonly files: readonly string[];
}

const SHARED_TABLES: readonly TableSpec[] = [
  { table: 'Directories', files: ['game/Directories.h'] },
  { table: 'Font', files: ['sgp/Font.h'] },
  { table: 'Font_Control', files: ['game/Utils/Font_Control.h'] },
  { table: 'MouseSystem', files: ['sgp/MouseSystem.h'] },
  { table: 'Video', files: ['sgp/Video.h'] },
  { table: 'Button_System', files: ['sgp/Button_System.h'] },
  { table: 'Button_Sound_Control', files: ['sgp/Button_Sound_Control.h'] },
  { table: 'Cursor_Control', files: ['sgp/Cursor_Control.h'] },
  { table: 'Cursors', files: ['game/Utils/Cursors.h'] },
  { table: 'WordWrap', files: ['game/Utils/WordWrap.h'] },
  { table: 'Text_Input', files: ['game/Utils/Text_Input.h'] },
  { table: 'Timer_Control', files: ['game/Utils/Timer_Control.h'] },
  { table: 'Text', files: ['game/Utils/Text.h'] },
  { table: 'Laptop', files: ['game/Laptop/Laptop.h', 'game/Laptop/Laptop.cc'] },
  { table: 'AIM', files: ['game/Laptop/AIM.h', 'game/Laptop/AIM.cc'] },
];

const SCREEN_TABLES: readonly TableSpec[] = [
  { table: 'MainMenuScreen', files: ['game/MainMenuScreen.h', 'game/MainMenuScreen.cc'] },
  { table: 'Options_Screen', files: ['game/Options_Screen.h', 'game/Options_Screen.cc'] },
  { table: 'GameInitOptionsScreen', files: ['game/GameInitOptionsScreen.h', 'game/GameInitOptionsScreen.cc'] },
  { table: 'SaveLoadScreen', files: ['game/SaveLoadScreen.h', 'game/SaveLoadScreen.cc'] },
  { table: 'MessageBoxScreen', files: ['game/MessageBoxScreen.h', 'game/MessageBoxScreen.cc'] },
  { table: 'MercTextBox', files: ['game/Utils/MercTextBox.h', 'game/Utils/MercTextBox.cc'] },
  { table: 'PopUpBox', files: ['game/Utils/PopUpBox.h', 'game/Utils/PopUpBox.cc'] },
  { table: 'Slider', files: ['game/Utils/Slider.h', 'game/Utils/Slider.cc'] },
  { table: 'Animated_ProgressBar', files: ['game/Utils/Animated_ProgressBar.h', 'game/Utils/Animated_ProgressBar.cc'] },
  { table: 'GameSettings', files: ['game/GameSettings.h'] },
  { table: 'Credits', files: ['game/Credits.cc'] },
  { table: 'Loading_Screen', files: ['game/Loading_Screen.h', 'game/Loading_Screen.cc'] },
  { table: 'JAScreens', files: ['game/JAScreens.h', 'game/JAScreens.cc'] },
  { table: 'Fade_Screen', files: ['game/Fade_Screen.h', 'game/Fade_Screen.cc'] },
  { table: 'Sound_Control', files: ['game/Utils/Sound_Control.h', 'sgp/SoundMan.h'] },
  { table: 'EMail', files: ['game/Laptop/EMail.h', 'game/Laptop/EMail.cc'] },
  { table: 'Finances', files: ['game/Laptop/Finances.h', 'game/Laptop/Finances.cc'] },
  { table: 'AIMMembers', files: ['game/Laptop/AIMMembers.h', 'game/Laptop/AIMMembers.cc'] },
  { table: 'AIMSort', files: ['game/Laptop/AIMSort.h', 'game/Laptop/AIMSort.cc'] },
  { table: 'AIMFacialIndex', files: ['game/Laptop/AIMFacialIndex.h', 'game/Laptop/AIMFacialIndex.cc'] },
  { table: 'AIMLinks', files: ['game/Laptop/AIMLinks.h', 'game/Laptop/AIMLinks.cc'] },
];

const FRAME_ORIGIN_NAMES: ReadonlyMap<string, number> = new Map([
  ['STD_SCREEN_X', 0],
  ['STD_SCREEN_Y', 0],
]);
const FONT_CONTROL_SOURCE = 'game/Utils/Font_Control.cc';
const TIMER_CONTROL_SOURCE = 'game/Utils/Timer_Control.cc';
const TIMER_ENUM = 'PredefinedCounters';
const TIMER_ARRAY = 'giTimerIntervals';
const EDITOR_ONLY_FONT = 'gpHugeFont';

export interface ConstantTable {
  readonly source: string;
  readonly license: string;
  readonly format: string;
  readonly constants: Readonly<Record<string, ConstantValue>>;
  readonly stdScreen: readonly string[];
  readonly fonts?: Readonly<Record<string, string>>;
  readonly skipped: readonly string[];
}

class Resolver {
  readonly #own = new Map<string, string>();
  readonly #shared: readonly ConstantTable[];
  readonly #values = new Map<string, ConstantValue | null>();
  readonly #relative = new Set<string>();
  readonly #fonts: ReadonlySet<string>;
  readonly #resolving = new Set<string>();

  constructor(definitions: readonly Definition[], shared: readonly ConstantTable[]) {
    for (const d of definitions) if (!this.#own.has(d.name)) this.#own.set(d.name, d.expression);
    this.#shared = shared;
    this.#fonts = new Set(shared.flatMap((t) => Object.keys(t.fonts ?? {})));
  }

  get relative(): ReadonlySet<string> {
    return this.#relative;
  }

  #sharedValue(name: string): ConstantValue | null {
    for (const table of this.#shared) {
      const value = table.constants[name];
      if (value !== undefined) return value;
    }
    return null;
  }

  #number(name: string, user: string): number | null {
    const origin = FRAME_ORIGIN_NAMES.get(name);
    if (origin !== undefined) {
      this.#relative.add(user);
      return origin;
    }
    const value = this.value(name);
    if (typeof value === 'number') {
      if (this.#relative.has(name)) this.#relative.add(user);
      return value;
    }
    return null;
  }

  #string(name: string): string | null {
    const value = this.value(name);
    return typeof value === 'string' ? value : null;
  }

  value(name: string): ConstantValue | null {
    if (this.#values.has(name)) return this.#values.get(name) ?? null;
    const expression = this.#own.get(name);
    if (expression === undefined) return this.#sharedValue(name);
    if (this.#resolving.has(name)) return null;
    this.#resolving.add(name);
    const value = this.#evaluate(name, expression);
    this.#resolving.delete(name);
    this.#values.set(name, value);
    return value;
  }

  #evaluate(name: string, expression: string): ConstantValue | null {
    if (expression.length === 0) return null;
    const number = evaluateConstant(expression, (n) => this.#number(n, name));
    if (number !== null) return number;
    const text = stringLiteral(expression, (n) => this.#string(n));
    if (text !== null) return text;
    const symbol = /^\(?\s*([A-Za-z_]\w*)\s*\)?$/.exec(expression)?.[1];
    if (symbol === undefined) return null;
    if (this.#fonts.has(symbol)) return symbol;
    const followed = this.value(symbol);
    return typeof followed === 'string' ? followed : symbol;
  }
}

function definitionsOf(src: string): Definition[] {
  const defines = objectDefines(src);
  const constants = fileScopeConstants(src);
  const enums: Definition[] = [];
  for (const e of enumDefinitions(src)) {
    let previous: string | null = null;
    let offset = 0;
    for (const member of e.members) {
      if (member.expression.length > 0) {
        enums.push({ name: member.name, expression: member.expression });
        previous = member.name;
        offset = 1;
      } else {
        enums.push({ name: member.name, expression: previous === null ? String(offset) : `(${previous}) + ${offset}` });
        offset++;
      }
    }
  }
  return [...defines, ...constants, ...enums];
}

function fontFiles(header: Readonly<Record<string, ConstantValue>>): Record<string, string> {
  const src = cleanSource(readSource(FONT_CONTROL_SOURCE));
  const directories = new Map<string, string>(
    objectDefines(cleanSource(readSource('game/Directories.h'))).map((d) => [d.name, d.expression]),
  );
  const files = new Map<string, string>();
  for (const m of src.matchAll(/\bM\(\s*(\w+)\s*,\s*([^)]+)\)/g)) {
    const path = stringLiteral((m[2] as string).trim(), (n) => {
      const dir = directories.get(n);
      return dir ? dir.replace(/"/g, '') : null;
    });
    if (path) files.set(m[1] as string, path);
  }
  const fonts: Record<string, string> = {};
  const target = (value: ConstantValue | undefined, seen: Set<string>): string | null => {
    if (typeof value !== 'string') return null;
    const file = files.get(value);
    if (file && value !== EDITOR_ONLY_FONT) return file;
    if (seen.has(value)) return null;
    seen.add(value);
    return target(header[value], seen);
  };
  for (const [name, value] of Object.entries(header)) {
    const file = target(value, new Set([name]));
    if (file) fonts[name] = file;
  }
  const huge = /#define\s+HUGEFONT\s+\(.*\?\s*\w+\s*:\s*(\w+)\s*\)/.exec(cleanSource(readSource('game/Utils/Font_Control.h')))?.[1];
  const hugeFile = huge ? files.get(huge) : undefined;
  if (hugeFile) fonts.HUGEFONT = hugeFile;
  return fonts;
}

function timerIntervals(enumNames: readonly string[]): Definition[] {
  const values = arrayInitializer(cleanSource(readSource(TIMER_CONTROL_SOURCE)), TIMER_ARRAY);
  if (values.length !== enumNames.length) throw new Error(`${TIMER_ARRAY}: ${values.length} values for ${enumNames.length} counters`);
  return enumNames.map((name, i) => ({ name: `${name}_MS`, expression: (values[i] as string).replace(/ms$/, '') }));
}

function buildTable(spec: TableSpec, shared: readonly ConstantTable[]): ConstantTable {
  const files = spec.files.filter((f) => existsSync(join(STRACCIATELLA_SRC, f)));
  const src = files.map((f) => cleanSource(readSource(f))).join('\n');
  const definitions = definitionsOf(src);
  if (spec.table === 'Timer_Control') {
    const counters = enumDefinitions(src).find((e) => e.name === TIMER_ENUM);
    if (!counters) throw new Error(`${TIMER_ENUM} not found`);
    definitions.push(...timerIntervals(counters.members.map((m) => m.name).filter((n) => n !== 'NUMTIMERS')));
  }
  const resolver = new Resolver(definitions, shared);
  const constants: Record<string, ConstantValue> = {};
  const skipped: string[] = [];
  for (const d of definitions) {
    if (d.expression.length === 0 || d.name in constants || skipped.includes(d.name)) continue;
    const value = resolver.value(d.name);
    if (value === null) skipped.push(d.name);
    else constants[d.name] = value;
  }
  const sources = [
    ...files,
    ...(spec.table === 'Font_Control' ? [FONT_CONTROL_SOURCE] : []),
    ...(spec.table === 'Timer_Control' ? [TIMER_CONTROL_SOURCE] : []),
  ];
  return {
    source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: ${sources.map((f) => `src/${f}`).join(', ')}`,
    license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
    format:
      'constants: the #define, static const, constexpr and enum values of the files; numbers are evaluated with STD_SCREEN_X = STD_SCREEN_Y = 0 (positions inside the std640 frame) and the names of the shared tables; a string is a symbol (a font macro or another identifier) or a VFS path; stdScreen: the names whose value contains STD_SCREEN_X or STD_SCREEN_Y; skipped: names whose value is not a constant (runtime values, function calls)' +
      (spec.table === 'Font_Control' ? '; fonts: the font macros and the font files InitializeFonts loads for them' : '') +
      (spec.table === 'Timer_Control' ? '; <COUNTER>_MS: the giTimerIntervals entry of each PredefinedCounters value' : ''),
    constants,
    stdScreen: [...resolver.relative].filter((n) => n in constants).sort(),
    ...(spec.table === 'Font_Control' ? { fonts: fontFiles(constants) } : {}),
    skipped,
  };
}

export function buildUiConstantTables(): Map<string, ConstantTable> {
  const tables = new Map<string, ConstantTable>();
  const shared: ConstantTable[] = [];
  for (const spec of SHARED_TABLES) {
    const table = buildTable(spec, shared);
    shared.push(table);
    tables.set(spec.table, table);
  }
  for (const spec of SCREEN_TABLES) tables.set(spec.table, buildTable(spec, shared));
  return tables;
}

if (import.meta.main) {
  mkdirSync(UI_CONSTANTS_DIR, { recursive: true });
  for (const [name, table] of buildUiConstantTables()) {
    const target = join(UI_CONSTANTS_DIR, `${name}.json`);
    writeTable(target, table);
    console.log(`${target}: ${Object.keys(table.constants).length} constants, ${table.skipped.length} skipped`);
  }
}

import { idiv } from '../../core/int.ts';

export type ConstantValue = number | string;

export interface ConstantTable {
  readonly constants: Readonly<Record<string, ConstantValue>>;
  readonly fonts?: Readonly<Record<string, string>>;
  readonly stdScreen?: readonly string[];
}

export const UI_CONSTANTS_DIR = 'tables/ui-constants';
export const SHARED_CONSTANT_TABLES: readonly string[] = [
  'Font',
  'Font_Control',
  'MouseSystem',
  'Video',
  'Button_System',
  'Button_Sound_Control',
  'Cursor_Control',
  'Cursors',
  'WordWrap',
  'Text_Input',
  'Timer_Control',
  'Text',
  'Directories',
];

export function constantTablePath(name: string): string {
  return `${UI_CONSTANTS_DIR}/${name}.json`;
}

export function parseConstantTable(json: unknown, name: string): ConstantTable {
  const constants = (json as { constants?: unknown } | null)?.constants;
  if (typeof constants !== 'object' || constants === null) throw new Error(`constant table ${name} has no constants`);
  return json as ConstantTable;
}

export class UnknownConstantError extends Error {}

export type Variables = Readonly<Record<string, number>>;

type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'op'; readonly value: string };

const TOKEN = /\s*(?:(\d+)|(\$?[A-Za-z_]\w*)|([-+*/%()]))/y;

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < expression.length) {
    if (/\s/.test(expression[pos] as string)) {
      pos++;
      continue;
    }
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(expression);
    if (!m) throw new Error(`cannot read expression ${JSON.stringify(expression)}`);
    pos = TOKEN.lastIndex;
    if (m[1] !== undefined) tokens.push({ kind: 'number', value: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ kind: 'name', value: m[2] });
    else tokens.push({ kind: 'op', value: m[3] as string });
  }
  return tokens;
}

export class ConstantScope {
  readonly #tables: readonly ConstantTable[];
  readonly #aliases: ReadonlyMap<string, string>;
  #fonts: Readonly<Record<string, string>> | null = null;

  constructor(tables: ReadonlyMap<string, ConstantTable>, names: readonly string[], aliases: ReadonlyMap<string, string> = new Map()) {
    const order = [...names, ...SHARED_CONSTANT_TABLES.filter((n) => !names.includes(n))];
    this.#tables = order.flatMap((n) => {
      const table = tables.get(n);
      return table ? [table] : [];
    });
    this.#aliases = aliases;
  }

  lookup(name: string): ConstantValue | undefined {
    for (const table of this.#tables) {
      const value = table.constants[name];
      if (value !== undefined) return value;
    }
    const alias = this.#aliases.get(name);
    return alias === undefined ? undefined : this.lookup(alias);
  }

  has(name: string): boolean {
    return this.lookup(name) !== undefined;
  }

  fonts(): Readonly<Record<string, string>> {
    this.#fonts ??= Object.assign({}, ...[...this.#tables].reverse().map((t) => t.fonts ?? {}));
    return this.#fonts as Readonly<Record<string, string>>;
  }

  number(expression: number | string, variables: Variables = {}, prefix = ''): number {
    if (typeof expression === 'number') return expression;
    const tokens = tokenize(expression);
    let pos = 0;
    const name = (n: string): number => {
      if (n.startsWith('$')) {
        const v = variables[n.slice(1)];
        if (v === undefined) throw new UnknownConstantError(`unknown variable ${n} in ${expression}`);
        return v;
      }
      const value = this.lookup(n) ?? (prefix ? this.lookup(`${prefix}${n}`) : undefined);
      if (typeof value !== 'number') throw new UnknownConstantError(`unknown numeric constant ${n} in ${JSON.stringify(expression)}`);
      return value;
    };
    const primary = (): number => {
      const t = tokens[pos++];
      if (!t) throw new Error(`unexpected end of ${expression}`);
      if (t.kind === 'number') return t.value;
      if (t.kind === 'name') return name(t.value);
      if (t.value === '-') return -primary();
      if (t.value === '+') return primary();
      if (t.value !== '(') throw new Error(`unexpected ${t.value} in ${expression}`);
      const v = sum();
      if (tokens[pos++]?.value !== ')') throw new Error(`missing ) in ${expression}`);
      return v;
    };
    const product = (): number => {
      let v = primary();
      for (;;) {
        const op = tokens[pos];
        if (op?.kind !== 'op' || !['*', '/', '%'].includes(op.value)) return v;
        pos++;
        const r = primary();
        v = op.value === '*' ? v * r : op.value === '/' ? idiv(v, r) : v % r;
      }
    };
    const sum = (): number => {
      let v = product();
      for (;;) {
        const op = tokens[pos];
        if (op?.kind !== 'op' || (op.value !== '+' && op.value !== '-')) return v;
        pos++;
        v = op.value === '+' ? v + product() : v - product();
      }
    };
    const value = sum();
    if (pos !== tokens.length) throw new Error(`trailing input in ${expression}`);
    return value;
  }
}

import { bracedBody, stripCComments } from './c-source.ts';

export type ConstantValue = number | string;

export interface ConstantScope {
  readonly names: ReadonlyMap<string, ConstantValue>;
}

export interface Definition {
  readonly name: string;
  readonly expression: string;
}

export interface FunctionMacro {
  readonly params: readonly string[];
  readonly body: string;
}

const TYPE_NAMES = new Set([
  'INT8',
  'UINT8',
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'BOOLEAN',
  'int',
  'unsigned',
  'short',
  'long',
  'char',
  'char32_t',
  'size_t',
  'float',
  'double',
  'bool',
  'int8_t',
  'uint8_t',
  'int16_t',
  'uint16_t',
  'int32_t',
  'uint32_t',
]);

export function joinContinuations(src: string): string {
  return src.replace(/\\\r?\n/g, ' ');
}

export function cleanSource(src: string): string {
  return stripCComments(joinContinuations(src).replace(/\r/g, ''));
}

export function objectDefines(src: string): Definition[] {
  const found: Definition[] = [];
  for (const m of src.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)\b(?!\()[ \t]*(.*)$/gm)) {
    found.push({ name: m[1] as string, expression: (m[2] ?? '').trim() });
  }
  return found;
}

export function functionMacros(src: string): Map<string, FunctionMacro> {
  const macros = new Map<string, FunctionMacro>();
  for (const m of src.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)\(([^)]*)\)[ \t]*(.*)$/gm)) {
    const params = (m[2] ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    macros.set(m[1] as string, { params, body: (m[3] ?? '').trim() });
  }
  return macros;
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    if (!quoted && (c === '(' || c === '{' || c === '[')) depth++;
    if (!quoted && (c === ')' || c === '}' || c === ']')) depth--;
    if (!quoted && depth === 0 && c === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

export function splitArguments(text: string): string[] {
  return splitTopLevel(text, ',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function expandMacros(text: string, macros: ReadonlyMap<string, FunctionMacro>): string {
  let out = text;
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    out = out.replace(/\b([A-Za-z_]\w*)\s*\(([^()]*)\)/g, (whole, name: string, args: string) => {
      const macro = macros.get(name);
      if (!macro) return whole;
      const values = args.trim().length === 0 ? [] : args.split(',').map((a) => a.trim());
      changed = true;
      return macro.params.reduce((body, param, i) => body.replace(new RegExp(`\\b${param}\\b`, 'g'), values[i] ?? ''), macro.body);
    });
    if (!changed) break;
  }
  return out;
}

export interface EnumDefinition {
  readonly name: string | null;
  readonly members: readonly Definition[];
}

export function enumDefinitions(src: string): EnumDefinition[] {
  const found: EnumDefinition[] = [];
  const re = /\benum\s+(?:class\s+)?([A-Za-z_]\w*)?\s*(?::\s*[\w\s]+)?\{/g;
  for (const m of src.matchAll(re)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    let depth = 0;
    let close = open;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) {
        close = i;
        break;
      }
    }
    const members = splitArguments(src.slice(open + 1, close)).map((item) => {
      const [name, expression] = item.split('=').map((s) => s.trim());
      return { name: name as string, expression: expression ?? '' };
    });
    found.push({ name: m[1] ?? null, members });
  }
  return found;
}

function withoutBlocks(src: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (c === '{') {
      const before = src.slice(Math.max(0, i - 80), i);
      if (depth === 0 && /\bnamespace(\s+\w+)?\s*$/.test(before)) continue;
      depth++;
      continue;
    }
    if (c === '}') {
      if (depth === 0) continue;
      depth--;
      if (depth === 0) out += ';';
      continue;
    }
    if (depth === 0) out += c;
  }
  return out;
}

export function fileScopeConstants(src: string): Definition[] {
  const scope = withoutBlocks(src.replace(/^[ \t]*#.*$/gm, ''));
  const found: Definition[] = [];
  const re =
    /(?:^|[;\n])\s*(?:static\s+)?(?:constexpr|const)\s+(?:static\s+)?((?:[\w:<>]+\s+)+?)(?:const\s+)?([A-Za-z_]\w*)\s*(?:=\s*([^;]+)|\{([^}]*)\})\s*;/g;
  for (const m of scope.matchAll(re)) {
    const expression = (m[3] ?? m[4] ?? '').trim();
    if (expression.length > 0) found.push({ name: m[2] as string, expression });
  }
  return found;
}

type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'op'; readonly value: string };

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  const re = /\s*(?:(0[xX][0-9a-fA-F]+|\d+)(?:[uUlL]+|ms)?|([A-Za-z_]\w*(?:::\w+)*)|(<<|>>|[-+*/%()|&~^]))/y;
  let pos = 0;
  const text = expression.trim();
  while (pos < text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) return null;
    pos = re.lastIndex;
    if (m[1] !== undefined)
      tokens.push({ kind: 'number', value: Number(m[1].toLowerCase().startsWith('0x') ? Number.parseInt(m[1], 16) : m[1]) });
    else if (m[2] !== undefined) tokens.push({ kind: 'name', value: m[2] });
    else if (m[3] !== undefined) tokens.push({ kind: 'op', value: m[3] });
    while (pos < text.length && /\s/.test(text[pos] as string)) pos++;
  }
  return tokens;
}

export type NameLookup = (name: string) => number | null;

class Parser {
  readonly #tokens: readonly Token[];
  readonly #lookup: NameLookup;
  #pos = 0;

  constructor(tokens: readonly Token[], lookup: NameLookup) {
    this.#tokens = tokens;
    this.#lookup = lookup;
  }

  parse(): number | null {
    const value = this.#or();
    return this.#pos === this.#tokens.length ? value : null;
  }

  #peek(): Token | undefined {
    return this.#tokens[this.#pos];
  }

  #isOp(value: string): boolean {
    const t = this.#peek();
    return t?.kind === 'op' && t.value === value;
  }

  #binary(next: () => number | null, ops: Readonly<Record<string, (a: number, b: number) => number>>): number | null {
    let left = next();
    for (;;) {
      const t = this.#peek();
      if (left === null || t?.kind !== 'op' || !(t.value in ops)) return left;
      this.#pos++;
      const right = next();
      if (right === null) return null;
      left = (ops[t.value] as (a: number, b: number) => number)(left, right);
    }
  }

  #or(): number | null {
    return this.#binary(() => this.#and(), { '|': (a, b) => a | b });
  }

  #and(): number | null {
    return this.#binary(() => this.#shift(), { '&': (a, b) => a & b });
  }

  #shift(): number | null {
    return this.#binary(() => this.#sum(), { '<<': (a, b) => a << b, '>>': (a, b) => a >> b });
  }

  #sum(): number | null {
    return this.#binary(() => this.#product(), { '+': (a, b) => a + b, '-': (a, b) => a - b });
  }

  #product(): number | null {
    return this.#binary(() => this.#unary(), {
      '*': (a, b) => a * b,
      '/': (a, b) => Math.trunc(a / b),
      '%': (a, b) => a % b,
    });
  }

  #unary(): number | null {
    if (this.#isOp('-')) {
      this.#pos++;
      const v = this.#unary();
      return v === null ? null : -v;
    }
    if (this.#isOp('+')) {
      this.#pos++;
      return this.#unary();
    }
    if (this.#isOp('~')) {
      this.#pos++;
      const v = this.#unary();
      return v === null ? null : ~v;
    }
    return this.#primary();
  }

  #primary(): number | null {
    const t = this.#peek();
    if (!t) return null;
    if (t.kind === 'number') {
      this.#pos++;
      return t.value;
    }
    if (t.kind === 'name') {
      this.#pos++;
      return this.#lookup(t.value);
    }
    if (t.value !== '(') return null;
    const next = this.#tokens[this.#pos + 1];
    const close = this.#tokens[this.#pos + 2];
    if (next?.kind === 'name' && TYPE_NAMES.has(next.value) && close?.kind === 'op' && close.value === ')') {
      this.#pos += 3;
      return this.#unary();
    }
    this.#pos++;
    const v = this.#or();
    if (!this.#isOp(')')) return null;
    this.#pos++;
    return v;
  }
}

export function evaluateConstant(expression: string, lookup: NameLookup): number | null {
  const tokens = tokenize(expression);
  if (!tokens || tokens.length === 0) return null;
  return new Parser(tokens, lookup).parse();
}

export function stringLiteral(expression: string, strings: (name: string) => string | null): string | null {
  const parts = expression.match(/"(?:[^"\\]|\\.)*"|[A-Za-z_]\w*/g);
  if (!parts || parts.join('').replace(/\s/g, '') !== expression.replace(/\s/g, '')) return null;
  if (!parts.some((p) => p.startsWith('"'))) return null;
  let out = '';
  for (const part of parts) {
    if (part.startsWith('"')) out += part.slice(1, -1);
    else {
      const value = strings(part);
      if (value === null) return null;
      out += value;
    }
  }
  return out;
}

export function arrayInitializer(src: string, declaration: string): string[] {
  return splitArguments(bracedBody(src, declaration));
}

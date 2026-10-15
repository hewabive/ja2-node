import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';

export const STRACCIATELLA_COMMIT = 'ae6bf01';
export const STRACCIATELLA_SRC = join(REPO_ROOT, 'reference/stracciatella/src');

export function readSource(relativePath: string): string {
  return readFileSync(join(STRACCIATELLA_SRC, relativePath), 'latin1');
}

export function stripCComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

export function bracedBody(src: string, declaration: string): string {
  const at = src.indexOf(declaration);
  if (at < 0) throw new Error(`declaration not found: ${declaration}`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unterminated body: ${declaration}`);
}

export function sequentialEnum(src: string, enumName: string): Map<string, number> {
  const values = new Map<string, number>();
  let next = 0;
  for (const raw of stripCComments(bracedBody(src, `enum ${enumName}`)).split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const [name, value] = item.split('=').map((s) => s.trim());
    if (!name) continue;
    if (value !== undefined) {
      if (!/^-?\d+$/.test(value)) throw new Error(`non-literal enum value ${item}`);
      next = Number(value);
    }
    values.set(name, next++);
  }
  return values;
}

export function arrayItems(src: string, declaration: string): string[] {
  return stripCComments(bracedBody(src, declaration))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function evaluateIntExpression(expression: string, names: ReadonlyMap<string, number>): number {
  const tokens = expression.match(/[A-Za-z_]\w*|\d+|[+\-()]/g) ?? [];
  let pos = 0;
  const term = (): number => {
    const t = tokens[pos++];
    if (t === undefined) throw new Error(`unexpected end of ${expression}`);
    if (t === '(') {
      const v = sum();
      pos++;
      return v;
    }
    if (t === '-') return -term();
    if (/^\d+$/.test(t)) return Number(t);
    const v = names.get(t);
    if (v === undefined) throw new Error(`unknown name ${t} in ${expression}`);
    return v;
  };
  const sum = (): number => {
    let v = term();
    while (tokens[pos] === '+' || tokens[pos] === '-') v = tokens[pos++] === '+' ? v + term() : v - term();
    return v;
  };
  return sum();
}

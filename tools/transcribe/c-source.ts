import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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

function enumValue(value: string, known: ReadonlyMap<string, number>, item: string): number {
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value, 16);
  const alias = known.get(value);
  if (alias !== undefined) return alias;
  if (/^[\w\s()+*-]+$/.test(value)) return evaluateIntExpression(value, known);
  throw new Error(`non-literal enum value ${item}`);
}

export function sequentialEnum(src: string, enumName: string): Map<string, number> {
  const values = new Map<string, number>();
  let next = 0;
  for (const raw of stripCComments(bracedBody(src, `enum ${enumName}`)).split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const [name, value] = item.split('=').map((s) => s.trim());
    if (!name) continue;
    if (value !== undefined) next = enumValue(value, values, item);
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
  const tokens = expression.match(/[A-Za-z_]\w*|\d+|[+\-*()]/g) ?? [];
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
  const product = (): number => {
    let v = term();
    while (tokens[pos] === '*') {
      pos++;
      v *= term();
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (tokens[pos] === '+' || tokens[pos] === '-') v = tokens[pos++] === '+' ? v + product() : v - product();
    return v;
  };
  return sum();
}

export function writeTable(target: string, value: unknown): void {
  writeFileSync(target, `${JSON.stringify(value, null, 1)}\n`);
  execFileSync(join(REPO_ROOT, 'node_modules/.bin/biome'), ['format', '--write', target], { stdio: 'ignore' });
}

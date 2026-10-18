import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { REPO_ROOT } from '../src/node/repo.ts';

type Layer =
  | 'core'
  | 'content'
  | 'sim'
  | 'protocol'
  | 'node'
  | 'server'
  | 'render'
  | 'audio'
  | 'app'
  | 'devtools'
  | 'stubs'
  | 'tools'
  | 'test';

interface Rule {
  readonly layers: readonly Layer[];
  readonly packages: readonly string[];
  readonly forbid?: readonly RegExp[];
}

const NONDETERMINISM = [/\bMath\.random\b/, /\bDate\.now\b/, /\bnew Date\b/, /\bperformance\.now\b/, /\bset(Timeout|Interval|Immediate)\b/];

const RULES: Record<Layer, Rule> = {
  core: { layers: ['core'], packages: [], forbid: NONDETERMINISM },
  content: { layers: ['core', 'content'], packages: ['fflate'], forbid: NONDETERMINISM },
  sim: { layers: ['core', 'content', 'sim'], packages: [], forbid: NONDETERMINISM },
  protocol: { layers: ['core', 'content', 'sim', 'protocol'], packages: [] },
  node: { layers: ['core', 'content', 'node'], packages: ['node:*'] },
  server: {
    layers: ['core', 'content', 'sim', 'protocol', 'node', 'server'],
    packages: ['node:*', 'hono', 'hono/*', '@hono/node-server', '@hono/node-server/*', 'ws', 'zod', '@modelcontextprotocol/sdk/*'],
  },
  render: { layers: ['core', 'content', 'protocol', 'render'], packages: [] },
  audio: { layers: ['content', 'protocol', 'audio'], packages: [] },
  app: { layers: ['content', 'protocol', 'audio', 'app'], packages: [] },
  devtools: { layers: ['core', 'content', 'protocol', 'render', 'audio', 'app', 'devtools'], packages: [] },
  stubs: { layers: ['core', 'content', 'node', 'stubs'], packages: ['node:*'] },
  tools: { layers: ['core', 'content', 'sim', 'protocol', 'node', 'server', 'stubs', 'tools'], packages: ['node:*'] },
  test: {
    layers: ['core', 'content', 'sim', 'protocol', 'node', 'server', 'render', 'audio', 'app', 'devtools', 'stubs', 'tools', 'test'],
    packages: ['node:*', 'vitest', 'vitest/*', '@playwright/test', 'fflate', 'vite', 'hono', 'hono/*', 'ws', '@modelcontextprotocol/sdk/*'],
  },
};

function layerOf(file: string): Layer | null {
  const rel = relative(REPO_ROOT, file).split(sep).join('/');
  if (rel.endsWith('.test.ts') || rel.startsWith('tests/') || /^[^/]+\.config\.ts$/.test(rel)) return 'test';
  const m = /^src\/(core|content|sim|protocol|node|server|render|audio|app|devtools)\//.exec(rel);
  if (m) return m[1] as Layer;
  if (rel.startsWith('stubs/')) return 'stubs';
  if (rel.startsWith('tools/')) return 'tools';
  return null;
}

const IMPORT_RE = /^[ \t]*(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) yield p;
  }
}

function packageAllowed(spec: string, allowed: readonly string[]): boolean {
  return allowed.some((a) => (a.endsWith('*') ? spec.startsWith(a.slice(0, -1)) : spec === a));
}

const CONFIG_FILES = ['vite.config.ts', 'vitest.config.ts', 'playwright.config.ts'].map((f) => join(REPO_ROOT, f));

async function* files(roots: readonly string[], extra: readonly string[]): AsyncGenerator<string> {
  for (const root of roots) yield* walk(root);
  yield* extra;
}

export async function checkImports(roots: readonly string[], extra: readonly string[] = []): Promise<string[]> {
  const problems: string[] = [];
  for await (const file of files(roots, extra)) {
    const layer = layerOf(file);
    if (!layer) continue;
    const rule = RULES[layer];
    const src = stripComments(await readFile(file, 'utf8'));
    const where = relative(REPO_ROOT, file);
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      if (spec.startsWith('.')) {
        if (!spec.endsWith('.ts')) problems.push(`${where}: relative import needs an explicit .ts extension: ${spec}`);
        const target = layerOf(resolve(file, '..', spec));
        if (target && !rule.layers.includes(target)) problems.push(`${where}: layer '${layer}' must not import '${target}' (${spec})`);
      } else if (!packageAllowed(spec, rule.packages)) {
        problems.push(`${where}: layer '${layer}' must not import package '${spec}'`);
      }
    }
    for (const re of rule.forbid ?? []) {
      if (re.test(src)) problems.push(`${where}: '${re.source}' is not allowed in layer '${layer}' (determinism)`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const problems = await checkImports(
    ['src', 'stubs', 'tools', 'tests'].map((d) => join(REPO_ROOT, d)),
    CONFIG_FILES,
  );
  for (const p of problems) console.error(p);
  console.log(problems.length === 0 ? 'imports: ok' : `imports: ${problems.length} problem(s)`);
  if (problems.length > 0) process.exitCode = 1;
}

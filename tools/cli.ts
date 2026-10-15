import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { encodePngIndexed, encodePngRgba } from '../src/content/formats/png.ts';
import { rgb565ToRgba } from '../src/content/formats/rgb565.ts';
import { readSlf } from '../src/content/formats/slf.ts';
import { decodeSti, type Sti } from '../src/content/formats/sti.ts';
import { vfsExtension } from '../src/content/vfs/path.ts';
import { openDataVfs } from '../src/node/data-vfs.ts';
import { DEFAULT_STUBS_DIR } from '../src/node/repo.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: 'string' },
    stubs: { type: 'string' },
    png: { type: 'string' },
    out: { type: 'string' },
    limit: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const USAGE = `usage: pnpm cli inspect <command> [--data DIR] [--stubs DIR]

  vfs                         VFS layers and per-extension statistics
  ls [prefix] [--limit N]     list VFS files
  slf <file.slf> [--limit N]  archive header and directory
  sti <path> [--png DIR]      describe an STI, optionally dump frames as PNG
  cat <path> --out <file>     extract a file from the VFS
  verify                      decode every STI and report failures

--data defaults to $JA2_DATA_DIR, --stubs to dist/stubs.`;

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

async function withVfs<T>(fn: (v: Awaited<ReturnType<typeof openDataVfs>>) => Promise<T>): Promise<T> {
  const dataDir = values.data ?? process.env.JA2_DATA_DIR;
  const data = await openDataVfs({ dataDir: dataDir || undefined, stubsDir: values.stubs ?? DEFAULT_STUBS_DIR });
  try {
    return await fn(data);
  } finally {
    await data.close();
  }
}

function describeSti(sti: Sti): string {
  if (sti.kind === 'rgb') return `RGB565 ${sti.width}×${sti.height}`;
  const sizes = sti.subImages.map((s) => `${s.width}×${s.height}`);
  const uniq = [...new Set(sizes)];
  return `indexed, ${sti.subImages.length} frames (${uniq.slice(0, 4).join(', ')}${uniq.length > 4 ? ', …' : ''}), aux: ${sti.appData ? 'yes' : 'no'}, ETRLE anomalies: ${sti.anomalies}`;
}

async function main(): Promise<void> {
  const [group, cmd, arg] = positionals;
  if (values.help || group !== 'inspect' || !cmd) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 1;
    return;
  }
  switch (cmd) {
    case 'vfs':
      return withVfs(async ({ vfs, dataDir, slfCount, stubsDir }) => {
        console.log(`data dir : ${dataDir ?? '(not set: original data disabled)'}`);
        console.log(`SLF      : ${slfCount}`);
        console.log(`stubs    : ${stubsDir ?? '(missing: run pnpm stubs)'}`);
        const files = vfs.list();
        const byLayer = new Map<string, { n: number; size: number }>();
        const byExt = new Map<string, { n: number; size: number }>();
        for (const f of files) {
          for (const [map, key] of [
            [byLayer, f.layer],
            [byExt, vfsExtension(f.path) || '(none)'],
          ] as const) {
            const v = map.get(key) ?? { n: 0, size: 0 };
            v.n++;
            v.size += f.size;
            map.set(key, v);
          }
        }
        console.log(`files    : ${files.length}, ${mb(files.reduce((a, f) => a + f.size, 0))}\n`);
        console.log('by layer:');
        for (const [k, v] of byLayer) console.log(`  ${k.padEnd(20)} ${String(v.n).padStart(6)}  ${mb(v.size).padStart(9)}`);
        console.log('by extension:');
        for (const [k, v] of [...byExt].sort((a, b) => b[1].n - a[1].n))
          console.log(`  ${k.padEnd(8)} ${String(v.n).padStart(6)}  ${mb(v.size).padStart(9)}`);
      });
    case 'ls':
      return withVfs(async ({ vfs }) => {
        const prefix = (arg ?? '').toLowerCase();
        const limit = Number(values.limit ?? 200);
        const hits = vfs.list().filter((f) => f.path.startsWith(prefix));
        for (const f of hits.slice(0, limit)) console.log(`${String(f.size).padStart(9)}  ${f.layer.padEnd(16)} ${f.path}`);
        if (hits.length > limit) console.log(`… ${hits.length - limit} more (use --limit)`);
      });
    case 'slf': {
      if (!arg) throw new Error('usage: inspect slf <file.slf>');
      const { header, entries } = readSlf(new Uint8Array(await readFile(arg)));
      console.log(header);
      const limit = Number(values.limit ?? 50);
      for (const e of entries.slice(0, limit))
        console.log(`${String(e.length).padStart(9)} @${String(e.offset).padStart(10)} state=${e.state} ${e.name}`);
      if (entries.length > limit) console.log(`… ${entries.length - limit} more (use --limit)`);
      return;
    }
    case 'sti':
      return withVfs(async ({ vfs }) => {
        if (!arg) throw new Error('usage: inspect sti <vfs path> [--png DIR]');
        const sti = decodeSti(await vfs.read(arg));
        console.log(`${arg}: ${describeSti(sti)}`);
        if (sti.kind === 'indexed') {
          sti.subImages.slice(0, 16).forEach((s, i) => {
            const a = sti.appData?.[i];
            console.log(`  #${i} ${s.width}×${s.height} offset (${s.offsetX}, ${s.offsetY})${a ? ` aux ${JSON.stringify(a)}` : ''}`);
          });
          if (sti.subImages.length > 16) console.log(`  … ${sti.subImages.length - 16} more`);
        }
        if (values.png) {
          await mkdir(values.png, { recursive: true });
          const base = arg
            .toLowerCase()
            .replaceAll(/[\\/]/g, '_')
            .replace(/\.sti$/, '');
          if (sti.kind === 'rgb') {
            await writeFile(join(values.png, `${base}.png`), encodePngRgba(sti.width, sti.height, rgb565ToRgba(sti.pixels)));
          } else {
            for (const [i, s] of sti.subImages.entries()) {
              if (s.width === 0 || s.height === 0) continue;
              const png = encodePngIndexed(s.width, s.height, s.pixels, sti.palette, { transparentIndex0: true });
              await writeFile(join(values.png, `${base}_${String(i).padStart(3, '0')}.png`), png);
            }
          }
          console.log(`PNG written to ${values.png}`);
        }
      });
    case 'cat':
      return withVfs(async ({ vfs }) => {
        if (!arg || !values.out) throw new Error('usage: inspect cat <vfs path> --out <file>');
        await writeFile(values.out, await vfs.read(arg));
        console.log(`${arg} → ${values.out}`);
      });
    case 'verify':
      return withVfs(async ({ vfs }) => {
        const files = vfs.list().filter((f) => vfsExtension(f.path) === 'sti');
        const t0 = performance.now();
        let ok = 0;
        let frames = 0;
        let rgb = 0;
        let bytes = 0;
        const failed: string[] = [];
        const anomalous: string[] = [];
        for (const f of files) {
          try {
            const data = await vfs.read(f.path);
            bytes += data.length;
            const sti = decodeSti(data);
            ok++;
            if (sti.kind === 'rgb') rgb++;
            else {
              frames += sti.subImages.length;
              if (sti.anomalies > 0) anomalous.push(`${f.path} (${sti.anomalies})`);
            }
          } catch (err) {
            failed.push(`${f.path}: ${(err as Error).message}`);
          }
        }
        const sec = ((performance.now() - t0) / 1000).toFixed(1);
        console.log(`STI: ${files.length} files, ${mb(bytes)}, decoded ${ok} (${rgb} RGB565, ${frames} indexed frames) in ${sec} s`);
        console.log(`failed: ${failed.length}, with ETRLE anomalies: ${anomalous.length}`);
        for (const line of failed.slice(0, 30)) console.log(`  FAIL ${line}`);
        for (const line of anomalous.slice(0, 30)) console.log(`  ANOMALY ${line}`);
        if (failed.length > 0) process.exitCode = 1;
      });
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

await main();

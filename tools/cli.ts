import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseSoldierPalettes, SOLDIER_PALETTES_PATH } from '../src/content/formats/ja2pal.ts';
import { parseTilesetDatabase, TILESET_DATABASE_PATH } from '../src/content/formats/ja2set.ts';
import { parseStructureFile } from '../src/content/formats/jsd.ts';
import { LAYER_NAMES, parseMap } from '../src/content/formats/map.ts';
import { decodePcx } from '../src/content/formats/pcx.ts';
import { encodePngIndexed, encodePngRgba } from '../src/content/formats/png.ts';
import { rgb565ToRgba } from '../src/content/formats/rgb565.ts';
import { parseSaveGame } from '../src/content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../src/content/formats/savegame-header.ts';
import { readSlf } from '../src/content/formats/slf.ts';
import { decodeSti, type Sti } from '../src/content/formats/sti.ts';
import { decodeTga } from '../src/content/formats/tga.ts';
import { vfsExtension } from '../src/content/vfs/path.ts';
import { openDataVfs } from '../src/node/data-vfs.ts';
import { DEFAULT_STUBS_DIR, PROJECT_DATA_DIR } from '../src/node/repo.ts';

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
  map <path>                  describe a map (.dat)
  tilesets                    list tilesets from ja2set.dat
  save <file.sav>             summarise a native savegame (sector, time, soldiers, items, PreRandom)
  cat <path> --out <file>     extract a file from the VFS
  verify                      decode every STI, JSD and map and report failures

--data defaults to $JA2_DATA_DIR, --stubs to dist/stubs.`;

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

async function withVfs<T>(fn: (v: Awaited<ReturnType<typeof openDataVfs>>) => Promise<T>): Promise<T> {
  const dataDir = values.data ?? process.env.JA2_DATA_DIR;
  const data = await openDataVfs({
    projectDataDir: PROJECT_DATA_DIR,
    dataDir: dataDir || undefined,
    stubsDir: values.stubs ?? DEFAULT_STUBS_DIR,
  });
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
    case 'map':
      return withVfs(async ({ vfs }) => {
        if (!arg) throw new Error('usage: inspect map <vfs path>');
        const map = parseMap(await vfs.read(arg));
        console.log(`${arg}: version ${map.majorVersion}/${map.minorVersion}, tileset ${map.tilesetId}, flags 0x${map.flags.toString(16)}`);
        for (const name of LAYER_NAMES) console.log(`  ${name.padEnd(8)} ${map.layers[name].types.length} tiles`);
        const rooms = new Set(map.rooms).size - 1;
        console.log(`  trailing bytes ${map.trailingBytes}`);
        console.log(
          `  rooms ${rooms}, items ${map.items.length}, lights ${map.lights?.sprites.length ?? 0}, placements ${map.placements.length}`,
        );
        console.log(`  exit grids ${map.exitGrids.length}, doors ${map.doors.length}, schedules ${map.schedules.length}`);
        console.log(`  ambient ${JSON.stringify(map.ambient)}, info ${JSON.stringify(map.info)}`);
      });
    case 'tilesets':
      return withVfs(async ({ vfs }) => {
        const db = parseTilesetDatabase(await vfs.read(TILESET_DATABASE_PATH));
        console.log(`${db.tilesets.length} tilesets, ${db.tileTypeCount} tile types each`);
        for (const t of db.tilesets)
          console.log(
            `  ${String(t.id).padStart(2)} ${t.name.padEnd(32)} ambient ${t.ambientId}, own files ${t.surfaceFiles.filter((f) => f).length}`,
          );
      });
    case 'save': {
      if (!arg) throw new Error('usage: inspect save <file.sav>');
      const table = parseSaveEncryptionTable(JSON.parse(await readFile(join(PROJECT_DATA_DIR, SAVE_ENCRYPTION_PATH), 'utf8')));
      const save = parseSaveGame(new Uint8Array(await readFile(arg)), table);
      const { header: h, tactical: t, worldTime: w } = save;
      const sector = (s: { x: number; y: number; z: number }) => `${String.fromCharCode(64 + s.y)}${s.x}${s.z ? `-${s.z}` : ''}`;
      console.log(
        `${arg}: version ${h.version} (${h.gameVersion}), ${save.stracLinuxFormat ? 'Strac Linux' : 'Windows'} layout, "${h.description}"`,
      );
      console.log(
        `  sector ${sector(t.worldSector)} (header ${sector(h.sector)}), day ${w.day} ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')} (${w.totalSeconds} s)`,
      );
      console.log(
        `  ${t.inCombat ? 'in combat' : 'real time'}, current team ${t.currentTeam}, flags 0x${t.flags.toString(16)}, interrupt queue [${save.teamTurns.outOfTurnOrder.join(', ')}]`,
      );
      console.log(`  PreRandom index ${save.preRandom.index}, encryption set ${save.encryptionSet}, ${save.bytesConsumed} bytes parsed`);
      const items = save.currentSector.worldItems?.filter((i) => i.exists) ?? [];
      console.log(
        `  world items ${items.length}, doors ${save.currentSector.doors?.length ?? 0}, door states ${save.currentSector.doorStatus?.length ?? 0}`,
      );
      for (const { soldier: s } of save.soldiers) {
        if (!s.inSector) continue;
        console.log(
          `  #${String(s.id).padStart(3)} team ${s.team} profile ${String(s.profile).padStart(3)} ${s.name.padEnd(10)} grid ${String(s.gridNo).padStart(5)} lvl ${s.level} life ${s.stats.life}/${s.stats.lifeMax} AP ${s.actionPoints} alert ${s.ai.alertStatus}`,
        );
      }
      return;
    }
    case 'verify':
      return withVfs(async ({ vfs }) => {
        const all = vfs.list();
        const failed: string[] = [];
        const anomalous: string[] = [];
        const trailing: string[] = [];
        const run = async (label: string, files: typeof all, check: (bytes: Uint8Array, path: string) => void) => {
          const t0 = performance.now();
          let bytes = 0;
          for (const f of files) {
            try {
              const data = await vfs.read(f.path);
              bytes += data.length;
              check(data, f.path);
            } catch (err) {
              failed.push(`${f.path}: ${(err as Error).message}`);
            }
          }
          console.log(`${label}: ${files.length} files, ${mb(bytes)} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
        };
        let frames = 0;
        await run(
          'STI',
          all.filter((f) => vfsExtension(f.path) === 'sti'),
          (data, path) => {
            const sti = decodeSti(data);
            if (sti.kind === 'indexed') {
              frames += sti.subImages.length;
              if (sti.anomalies > 0) anomalous.push(`${path} (${sti.anomalies})`);
            }
          },
        );
        console.log(`  indexed frames: ${frames}`);
        await run(
          'PCX',
          all.filter((f) => vfsExtension(f.path) === 'pcx'),
          (data) => void decodePcx(data),
        );
        await run(
          'TGA',
          all.filter((f) => vfsExtension(f.path) === 'tga'),
          (data) => void decodeTga(data),
        );
        await run(
          'JSD',
          all.filter((f) => vfsExtension(f.path) === 'jsd'),
          (data) => void parseStructureFile(data),
        );
        await run(
          'maps',
          all.filter((f) => f.path.startsWith('maps/') && vfsExtension(f.path) === 'dat'),
          (data, path) => {
            const map = parseMap(data);
            if (map.trailingBytes > 0) trailing.push(`${path} (${map.trailingBytes})`);
          },
        );
        console.log(`  maps with ignored trailing bytes: ${trailing.length}`);
        if (vfs.stat(SOLDIER_PALETTES_PATH)) {
          await run(
            'soldier palettes',
            all.filter((f) => f.path === SOLDIER_PALETTES_PATH),
            (data) => {
              const p = parseSoldierPalettes(data);
              console.log(`  ${p.subRanges.length} sub-ranges, ${p.replacements.length} replacements`);
            },
          );
        }
        if (vfs.stat(TILESET_DATABASE_PATH)) {
          await run(
            'tileset database',
            all.filter((f) => f.path === TILESET_DATABASE_PATH),
            (data) => void parseTilesetDatabase(data),
          );
        }
        console.log(`failed: ${failed.length}, with ETRLE anomalies: ${anomalous.length}`);
        for (const line of failed.slice(0, 40)) console.log(`  FAIL ${line}`);
        for (const line of anomalous.slice(0, 30)) console.log(`  ANOMALY ${line}`);
        if (failed.length > 0) process.exitCode = 1;
      });
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

await main();

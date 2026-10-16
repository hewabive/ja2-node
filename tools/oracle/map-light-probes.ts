import { parseMap } from '../../src/content/formats/map.ts';
import { openDataVfs } from '../../src/node/data-vfs.ts';
import { DEFAULT_STUBS_DIR, PROJECT_DATA_DIR } from '../../src/node/repo.ts';

const MAP_NAME = /^maps\/([a-p])(\d{1,2})(?:_b(\d))?(_a)?\.dat$/;
const DEFAULT_HOURS = [22, 3, 12];
const DEFAULT_AMBIENT = 15;

const args = process.argv.slice(2);
const hours = args.length > 0 ? args.map(Number) : DEFAULT_HOURS;
if (hours.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) {
  console.error('usage: node tools/oracle/map-light-probes.ts [hour...] > probes.txt');
  process.exit(2);
}
const data = await openDataVfs({
  projectDataDir: PROJECT_DATA_DIR,
  dataDir: process.env.JA2_DATA_DIR || undefined,
  stubsDir: DEFAULT_STUBS_DIR,
});
if (data.dataDir === null) {
  console.error('JA2_DATA_DIR is required');
  process.exit(2);
}
const lines: string[] = [];
for (const { path } of data.vfs.list()) {
  const match = MAP_NAME.exec(path);
  if (!match) continue;
  const map = parseMap(await data.vfs.read(path));
  if (!map.lights?.sprites.length) continue;
  const [, row = 'a', column = '1', z = '0'] = match;
  const file = path.slice('maps/'.length);
  for (const hour of hours) {
    lines.push(
      `sector ${row.toUpperCase()}${column} z=${z} map=${file} hour=${hour}`,
      'lights format=none',
      `ambient level=${DEFAULT_AMBIENT}`,
      'lights',
    );
  }
}
await data.close();
console.log(lines.join('\n'));

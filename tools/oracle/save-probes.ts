import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseSaveGame } from '../../src/content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../../src/content/formats/savegame-header.ts';
import type { SavedSoldier } from '../../src/content/formats/savegame-soldier.ts';
import { ItemClass } from '../../src/content/items/items.ts';
import { isVisibleTile, WORLD_COLS } from '../../src/content/world/grid.ts';
import { openDataVfs } from '../../src/node/data-vfs.ts';
import { DEFAULT_STUBS_DIR, PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { InvSlot } from '../../src/sim/tactical/inventory.ts';
import { loadTacticalContent } from '../../src/sim/tactical/load-content.ts';
import { inLoadedSector } from '../../src/sim/tactical/save-import.ts';
import { OKLIFE, Team } from '../../src/sim/tactical/soldier.ts';

const SHOOTING_TEAMS: readonly number[] = [Team.OUR, Team.ENEMY, Team.MILITIA];
const LOCATIONS = ['torso', 'head', 'legs'];
const PATH_SPOKE_TILES = 12;
const LIGHT_SPOKE_TILES = [4, 8];
const SPOKES: readonly [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
const PATH_IGNORE_PERSON_AT_DEST = 2;

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error('usage: node tools/oracle/save-probes.ts <SaveGame name>... > probes.txt');
  process.exit(2);
}
const data = await openDataVfs({
  projectDataDir: PROJECT_DATA_DIR,
  dataDir: process.env.JA2_DATA_DIR || undefined,
  stubsDir: DEFAULT_STUBS_DIR,
});
const dataDir = data.dataDir;
if (dataDir === null) {
  console.error('JA2_DATA_DIR is required');
  process.exit(2);
}
const read = async (p: string) => (data.vfs.stat(p) ? data.vfs.read(p) : null);
const content = await loadTacticalContent(read);
const tableBytes = await read(SAVE_ENCRYPTION_PATH);
if (!tableBytes) throw new Error(`missing ${SAVE_ENCRYPTION_PATH}`);
const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(tableBytes)));
const root = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = process.env.JA2_SAVES_DIR || join(root, 'SavedGames');

const hasGun = (s: SavedSoldier) => content.items.byIndex.get(s.inventory[InvSlot.HAND]?.item ?? 0)?.itemClass === ItemClass.GUN;
const alive = (s: SavedSoldier) => s.stats.life >= OKLIFE;
const opposed = (a: SavedSoldier, b: SavedSoldier) => a.side !== b.side && a.id !== b.id;

const lines: string[] = [];
for (const name of names) {
  const save = parseSaveGame(new Uint8Array(readFileSync(join(savesDir, `${name}.sav`))), table);
  const soldiers = save.soldiers.map((e) => e.soldier).filter((s) => inLoadedSector(save, s));
  const fighters = soldiers.filter((s) => SHOOTING_TEAMS.includes(s.team) && alive(s));
  lines.push(`save ${name}`, 'soldiers detail=1', 'lights', 'lights level=1');
  for (const shooter of fighters.filter(hasGun)) {
    for (const target of soldiers.filter((t) => opposed(shooter, t)))
      for (const location of LOCATIONS) lines.push(`cth shooter=${shooter.id} target=${target.id} location=${location}`);
    lines.push(`bestshot who=${shooter.id}`);
  }
  for (const viewer of fighters)
    for (const target of soldiers.filter((t) => opposed(viewer, t))) lines.push(`los viewer=${viewer.id} target=${target.id}`);
  for (const mover of fighters) {
    for (const target of fighters.filter((t) => opposed(mover, t)))
      lines.push(`path who=${mover.id} to=${target.gridNo} mode=run flags=${PATH_IGNORE_PERSON_AT_DEST}`);
    const x = mover.gridNo % WORLD_COLS;
    const y = Math.trunc(mover.gridNo / WORLD_COLS);
    for (const [dx, dy] of SPOKES) {
      const g = (y + dy * PATH_SPOKE_TILES) * WORLD_COLS + x + dx * PATH_SPOKE_TILES;
      if (isVisibleTile(g)) lines.push(`path who=${mover.id} to=${g} mode=${mover.team === Team.OUR ? 'walk' : 'swat'}`);
    }
  }
  for (const viewer of fighters) {
    for (const target of soldiers.filter((t) => opposed(viewer, t)))
      lines.push(`light g=${target.gridNo} level=${target.level} viewer=${viewer.id}`);
    const x = viewer.gridNo % WORLD_COLS;
    const y = Math.trunc(viewer.gridNo / WORLD_COLS);
    for (const distance of LIGHT_SPOKE_TILES) {
      for (const [dx, dy] of SPOKES) {
        const g = (y + dy * distance) * WORLD_COLS + x + dx * distance;
        if (isVisibleTile(g)) lines.push(`light g=${g} viewer=${viewer.id}`);
      }
    }
  }
  lines.push('soldiers detail=1');
}
await data.close();
console.log(lines.join('\n'));

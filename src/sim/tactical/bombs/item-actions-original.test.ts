import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../../tests/support/combat.ts';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { withGraphicFacts } from '../../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../../content/vfs/vfs.ts';
import { Direction } from '../../../content/world/grid.ts';
import { loadTacticalWorld } from '../../../content/world/tactical-world.ts';
import type { ReadFile } from '../../../content/world/tileset-loader.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { ObjectFlags } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { DoorTrap, findDoorInfo } from '../doors/door-table.ts';
import { isDoorOpenAt } from '../doors.ts';
import { loadTacticalContent } from '../load-content.ts';
import { type Soldier, Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { loadWorldItemsFromMap } from '../world-items.ts';
import { actionValueOf, Detonator, detonatorOf, ItemAction } from './bomb-object.ts';
import { activateSwitchInGridNo, handleExplosionQueue, setOffBombsInGridNo } from './bomb-queue.ts';
import { worldBombItems } from './world-bombs.ts';

const MUSEUM_SWITCH = 13625;
const ORTA_CELL_SWITCH = 13367;
const ORTA_CELL_DOOR = 13207;
const BROTHEL_SWITCH = 12607;
const BROTHEL_BACK_DOOR = 11164;

describe.skipIf(!ORIGINAL_DATA_DIR)(
  'switches of the original maps (Explosion_Control.cc ActivateSwitchInGridNo, PerformItemAction)',
  () => {
    let data: DataVfs;
    let read: ReadFile;
    let content: TacticalContent;

    beforeAll(async () => {
      data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
      read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));
      content = await loadTacticalContent(read);
    });
    afterAll(async () => {
      await data.close();
    });

    async function pullSwitch(path: string, switchGridNo: number): Promise<{ readonly sim: TacticalSim; readonly merc: Soldier }> {
      const world = await loadTacticalWorld(read, path);
      const sim = new TacticalSim(world, content, 1);
      loadWorldItemsFromMap(
        sim.state,
        world.map.items.map((record) => ({ ...record, nonExistChance: 0 })),
      );
      const merc = spawnSoldier(sim, 0, Team.OUR, switchGridNo + 1, Direction.WEST);
      activateSwitchInGridNo(sim.state, merc, switchGridNo);
      handleExplosionQueue(sim.state);
      return { sim, merc };
    }

    it("disarms Balime's museum plates from the switch, so walking on them rings no alarm", async () => {
      const { sim, merc } = await pullSwitch('maps/l12.dat', MUSEUM_SWITCH);
      const t = sim.state;
      const plates = worldBombItems(t).filter(
        (i) => actionValueOf(i.object) === ItemAction.MUSEUM_ALARM && detonatorOf(i.object) === Detonator.PRESSURE,
      );
      expect(plates.length).toBeGreaterThan(0);
      expect(plates.every((i) => (i.object.flags & ObjectFlags.DISABLED_BOMB) !== 0)).toBe(true);
      for (const plate of plates) expect(setOffBombsInGridNo(t, merc, plate.gridNo, false, 0)).toBe(false);
      expect(t.explosionQueue.entries).toEqual([]);
    });

    it("opens and unlocks the Orta basement's cell door from its switch", async () => {
      const t = (await pullSwitch('maps/k4_b1.dat', ORTA_CELL_SWITCH)).sim.state;
      expect([isDoorOpenAt(t, ORTA_CELL_DOOR), findDoorInfo(t, ORTA_CELL_DOOR)?.locked]).toEqual([true, false]);
    });

    it("takes the trap off the brothel's back door from its switch", async () => {
      const t = (await pullSwitch('maps/c5.dat', BROTHEL_SWITCH)).sim.state;
      expect(findDoorInfo(t, BROTHEL_BACK_DOOR)).toMatchObject({ trapLevel: 0, trapId: DoorTrap.NONE });
    });
  },
);

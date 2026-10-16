import { describe, expect, it } from 'vitest';
import { MapFlags, parseMap } from '../../../content/formats/map.ts';
import { parseDetailedPlacement } from '../../../content/formats/placement.ts';
import { openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { loadMapSchedules, MAX_SCHEDULE_ACTIONS, ScheduleAction, UNSET_SCHEDULE_VALUE } from './schedule-state.ts';

const LAST_ACTION = ScheduleAction.WAKE;
const MINUTES_PER_DAY = 1440;

describe.skipIf(!process.env.JA2_DATA_DIR)('schedules of the original maps (docs/25 §5.1)', () => {
  it('load with ids 1..n and valid entries, and most scheduled placements link a schedule of their map', async () => {
    const data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: process.env.JA2_DATA_DIR });
    try {
      const maps = data.vfs.list().filter((f) => f.path.startsWith('maps/') && f.path.endsWith('.dat'));
      expect(maps.length).toBeGreaterThan(0);
      let scheduled = 0;
      for (const file of maps) {
        const map = parseMap(await data.vfs.read(file.path));
        const list = map.flags & MapFlags.NPC_SCHEDULES ? loadMapSchedules(map.schedules) : null;
        const ids = list?.nodes.map((n) => n.id) ?? [];
        expect(ids).toEqual(map.schedules.map((_, k) => k + 1));
        for (const node of list?.nodes ?? []) {
          for (let i = 0; i < MAX_SCHEDULE_ACTIONS; i++) {
            expect(node.actions[i]).toBeLessThanOrEqual(LAST_ACTION);
            const time = node.times[i] ?? UNSET_SCHEDULE_VALUE;
            expect(time === UNSET_SCHEDULE_VALUE || time < MINUTES_PER_DAY).toBe(true);
          }
        }
        const linked = map.placements
          .map((p) => (p.detailedRaw ? parseDetailedPlacement(p.detailedRaw).scheduleId : 0))
          .filter((id) => id !== 0);
        scheduled += linked.filter((id) => ids.includes(id)).length;
      }
      expect(scheduled).toBeGreaterThan(0);
    } finally {
      await data.close();
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseMap } from '../../../content/formats/map.ts';
import { decodeObject } from '../../../content/formats/object.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { objectFromRecord } from '../../items/object.ts';
import { loadTacticalContent } from '../load-content.ts';
import { WorldItemFlags } from '../world-items.ts';
import { type BombFields, bombFieldsOf, Detonator, ItemAction } from './quest-items.ts';

const dataDir = process.env.JA2_DATA_DIR ?? '';
const WORLD_ITEM_OBJECT_OFFSET = 8;
const SEX_TILES = [11174, 12290, 13414];

interface ArmedItem extends BombFields {
  readonly map: string;
  readonly gridNo: number;
  readonly isSwitch: boolean;
}

describe.skipIf(!process.env.JA2_DATA_DIR)('quest action items in the original maps', () => {
  let data: DataVfs;
  const read = async (p: string) => (data.vfs.stat(p) ? data.vfs.read(p) : null);

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  });
  afterAll(async () => {
    await data.close();
  });

  it('decodes the triggers: pressure items for the rooms and the museum, pressure switches on the Kingpin alarm’s frequency', async () => {
    const content = await loadTacticalContent(read);
    const actionItem = content.items.byName.get('ACTION_ITEM')?.index;
    const switchItem = content.items.byName.get('SWITCH')?.index;
    const armed: ArmedItem[] = [];
    for (const file of data.vfs.list().filter((f) => /^maps\/[^/]+\.dat$/.test(f.path))) {
      for (const record of parseMap(await data.vfs.read(file.path)).items) {
        if ((record.item !== actionItem && record.item !== switchItem) || !(record.flags & WorldItemFlags.ARMED_BOMB)) continue;
        const fields = bombFieldsOf(objectFromRecord(decodeObject(record.raw, WORLD_ITEM_OBJECT_OFFSET)));
        armed.push({ ...fields, map: file.path, gridNo: record.gridNo, isSwitch: record.item === switchItem });
      }
    }
    const of = (action: number) => armed.filter((a) => !a.isSwitch && a.action === action);
    const sex = of(ItemAction.SEX);
    expect(SEX_TILES.every((g) => sex.some((a) => a.gridNo === g))).toBe(true);
    expect(sex.every((a) => a.detonator === Detonator.PRESSURE)).toBe(true);
    const museum = of(ItemAction.MUSEUM_ALARM);
    expect(museum.length).toBeGreaterThan(0);
    expect(museum.every((a) => a.detonator === Detonator.PRESSURE)).toBe(true);
    const alarms = of(ItemAction.KINGPIN_ALARM);
    expect(alarms.length).toBeGreaterThan(0);
    for (const alarm of alarms) {
      expect(alarm.detonator).toBe(Detonator.REMOTE);
      const triggers = armed.filter((a) => a.isSwitch && a.map === alarm.map && a.frequency === alarm.frequency);
      expect(triggers.some((a) => a.detonator === Detonator.PRESSURE)).toBe(true);
    }
  });
});

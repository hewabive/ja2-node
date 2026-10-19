import { createItem, createItems } from '../sim/items/object.ts';
import { states } from '../sim/tactical/animation.ts';
import type { TacticalContent } from '../sim/tactical/content.ts';
import { InvSlot } from '../sim/tactical/inventory.ts';
import { createSoldier, type Soldier, Team } from '../sim/tactical/soldier.ts';

const STUB_MERC_GUN = 'GLOCK_17';
const STUB_MERC_MAGAZINE = 'CLIP9_15';
const STUB_MERC_SPARE_MAGAZINES = 2;
const STUB_MERC_ATTACHMENT = 'SILENCER';
const FULL_STATUS = 100;
const STUB_BODIES = [0, 1, 3, 2];
const STUB_VESTS = ['BLUEVEST', 'GREENVEST', 'YELLOWVEST', 'BROWNVEST'];
const STUB_STATS = {
  agility: 80,
  dexterity: 80,
  strength: 80,
  wisdom: 80,
  leadership: 50,
  marksmanship: 80,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};
const STUB_LIFE = 100;
const SOUTH = 4;

function armStubMerc(content: TacticalContent, s: Soldier): Soldier {
  const items = content.items;
  const gun = items.byName.get(STUB_MERC_GUN);
  const magazine = items.byName.get(STUB_MERC_MAGAZINE);
  if (gun) s.inv[InvSlot.HAND] = createItem(items, gun.index, FULL_STATUS);
  if (magazine) s.inv[InvSlot.BIGPOCK1] = createItems(items, magazine.index, FULL_STATUS, STUB_MERC_SPARE_MAGAZINES);
  const attachment = items.byName.get(STUB_MERC_ATTACHMENT);
  if (attachment) s.inv[InvSlot.SMALLPOCK1] = createItem(items, attachment.index, FULL_STATUS);
  return s;
}

export function stubMerc(content: TacticalContent, id: number): Soldier {
  return armStubMerc(
    content,
    createSoldier({
      id,
      team: Team.OUR,
      name: `Merc ${id + 1}`,
      bodyType: STUB_BODIES[id % STUB_BODIES.length] ?? 0,
      palettes: {
        hair: 'BROWNHEAD',
        skin: 'TANSKIN',
        vest: STUB_VESTS[id % STUB_VESTS.length] ?? 'BLUEVEST',
        pants: 'JEANPANTS',
      },
      stats: { ...STUB_STATS },
      life: STUB_LIFE,
      gridNo: -1,
      direction: SOUTH,
      state: states(content.animations).STANDING,
    }),
  );
}

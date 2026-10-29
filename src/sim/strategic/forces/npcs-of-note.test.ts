import { beforeAll, describe, expect, it } from 'vitest';
import { loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { MercType } from '../../../content/strategic/economy-content.ts';
import { parseSectorString, type Sector } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { ProfileFlag } from '../../narrative/narrative-ids.ts';
import { MercStatus } from '../../tactical/profiles.ts';
import { initializeMapStructure } from '../map/init.ts';
import { type ListedProfile, wildernessSectorWithAllProfiledNpcsNotSpokenWith } from './npcs-of-note.ts';
import type { StrategicContext } from './ports.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const WILDERNESS = parseSectorString('B7');
const OMERTA = parseSectorString('A9');
const SAM_SITE = parseSectorString('D2');

interface NpcOptions {
  readonly type?: number;
  readonly sector?: Sector;
  readonly life?: number;
  readonly mercStatus?: number;
  readonly lastDateSpokenTo?: number;
  readonly miscFlags?: number;
}

function npc(o: NpcOptions = {}): ListedProfile {
  const sector = o.sector ?? WILDERNESS;
  return {
    type: o.type ?? MercType.NPC,
    profile: {
      mercStatus: o.mercStatus ?? MercStatus.OK,
      life: o.life ?? 50,
      sectorX: sector.x,
      sectorY: sector.y,
      sectorZ: sector.z,
      lastDateSpokenTo: o.lastDateSpokenTo ?? 0,
      miscFlags: o.miscFlags ?? 0,
    },
  };
}

function mapContext(): StrategicContext {
  const ctx = testContext({ content });
  initializeMapStructure(ctx);
  return ctx;
}

describe('WildernessSectorWithAllProfiledNPCsNotSpokenWith', () => {
  it('stops for profiled NPCs and RPCs nobody has spoken with in a wilderness sector', () => {
    const ctx = mapContext();
    expect(wildernessSectorWithAllProfiledNpcsNotSpokenWith(ctx, WILDERNESS, [npc()])).toBe(true);
    expect(wildernessSectorWithAllProfiledNpcsNotSpokenWith(ctx, WILDERNESS, [npc({ type: MercType.RPC })])).toBe(true);
    expect(wildernessSectorWithAllProfiledNpcsNotSpokenWith(ctx, WILDERNESS, [npc({ type: MercType.NOT_USED })])).toBe(true);
    expect(wildernessSectorWithAllProfiledNpcsNotSpokenWith(ctx, WILDERNESS, [npc({ sector: OMERTA })])).toBe(false);
  });

  it('stays quiet about the whole sector once one NPC there was spoken with, recruited or escorted', () => {
    const ctx = mapContext();
    const met = [npc({ lastDateSpokenTo: 3 }), npc({ miscFlags: ProfileFlag.RECRUITED }), npc({ miscFlags: ProfileFlag.EPCACTIVE })];
    for (const known of met) {
      expect(wildernessSectorWithAllProfiledNpcsNotSpokenWith(ctx, WILDERNESS, [npc(), known])).toBe(false);
      expect(wildernessSectorWithAllProfiledNpcsNotSpokenWith(ctx, WILDERNESS, [known, npc()])).toBe(false);
    }
  });

  it('counts neither player mercs, vehicles nor the dead', () => {
    const ctx = mapContext();
    const nobody = [
      npc({ type: MercType.AIM }),
      npc({ type: MercType.MERC }),
      npc({ type: MercType.IMP }),
      npc({ type: MercType.VEHICLE }),
      npc({ mercStatus: MercStatus.IS_DEAD }),
      npc({ life: 0 }),
    ];
    expect(wildernessSectorWithAllProfiledNpcsNotSpokenWith(ctx, WILDERNESS, nobody)).toBe(false);
    expect(
      wildernessSectorWithAllProfiledNpcsNotSpokenWith(ctx, WILDERNESS, [npc({ type: MercType.AIM, lastDateSpokenTo: 2 }), npc()]),
    ).toBe(true);
  });

  it('never stops in towns, at SAM sites or below ground', () => {
    const ctx = mapContext();
    const below = { ...WILDERNESS, z: 1 };
    for (const sector of [OMERTA, SAM_SITE, below])
      expect(wildernessSectorWithAllProfiledNpcsNotSpokenWith(ctx, sector, [npc({ sector })])).toBe(false);
  });
});

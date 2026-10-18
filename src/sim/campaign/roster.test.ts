import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { createSoldier, Team } from '../tactical/soldier.ts';
import { createMercRecord, createRosterState } from './merc-record.ts';
import { MercKind, Roster, RosterMerc } from './roster.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const STATS = {
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

function merc(id: number): RosterMerc {
  const palettes = { hair: 'BROWNHEAD', skin: 'TANSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' };
  const soldier = createSoldier({
    id,
    team: Team.OUR,
    name: `Merc ${id}`,
    bodyType: 0,
    palettes,
    stats: STATS,
    life: 80,
    gridNo: -1,
    direction: 4,
    state: 0,
  });
  return new RosterMerc(
    createMercRecord({
      soldier,
      profile: null,
      kind: MercKind.AIM_MERC,
      statusFlags: 0,
      sector: { x: 9, y: 1, z: 0 },
      betweenSectors: false,
      groupId: 0,
      prevSectorId: 0,
      insertionCode: 0,
      insertionDirection: 0,
      path: [],
      assignment: 0,
      vehicleId: -1,
      asleep: false,
    }),
  );
}

function roster(): { readonly roster: Roster; readonly state: ReturnType<typeof createRosterState> } {
  const state = createRosterState();
  const r = new Roster({
    state,
    content,
    combat: () => {
      throw new Error('no combat');
    },
  });
  return { roster: r, state };
}

describe('the roster list', () => {
  it('is sorted by soldier id and reused until the roster changes', () => {
    const { roster: r, state } = roster();
    for (const id of [5, 2, 9]) r.add(merc(id));
    const first = r.all();
    expect(first.map((m) => m.id)).toEqual([2, 5, 9]);
    expect(r.all()).toBe(first);
    r.remove(5);
    expect(r.all().map((m) => m.id)).toEqual([2, 9]);
    expect(first.map((m) => m.id)).toEqual([2, 5, 9]);
    const record = r.get(9)?.record;
    state.mercs.delete(9);
    expect(r.all().map((m) => m.id)).toEqual([2]);
    if (record) state.mercs.set(9, record);
    expect(r.all().map((m) => m.id)).toEqual([2, 9]);
  });
});

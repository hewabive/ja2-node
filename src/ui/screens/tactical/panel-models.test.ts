import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadUiStrings } from '../../../content/text/strings.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import type { PlayerView, SoldierView } from '../../../protocol/view.ts';
import { StringsTextService } from '../../text/text-service.ts';
import type { HelpTextSources } from './inventory.ts';
import { CHANGE_STAT_RECENTLY_DURATION_MS, type PanelState, smPanelModel, teamPanelModel } from './panel-models.ts';
import { vitalStatsHelp } from './soldiers.ts';

const HUMVEE = 22;
const HUMMER = 18;
const VEHICLE_ID = 0;

let text: StringsTextService;
let help: HelpTextSources;

beforeAll(async () => {
  const strings = await loadUiStrings(async (path) => new Uint8Array(await readFile(join(PROJECT_DATA_DIR, path))), 'eng');
  text = new StringsTextService(strings);
  help = { item: () => null, text, gunNut: false, nickname: () => null };
});

const merc = (id: number, over: Partial<SoldierView> = {}) => ({ id, team: 0, bodyType: 0, squad: 1, life: 80, ...over }) as SoldierView;
const driver = merc(3, { squad: null, vehicle: { id: VEHICLE_ID, driver: true } });
const passenger = merc(1, { squad: null, vehicle: { id: VEHICLE_ID, driver: false } });
const hummer = merc(HUMMER, { bodyType: HUMVEE, passengers: [3, 1], life: 38, lifeMax: 75, breath: 64, breathMax: 100 });
const walker = merc(2);
const view = { soldiers: [driver, passenger, hummer, walker] } as unknown as PlayerView;

function state(): PanelState {
  return {
    view,
    selected: HUMMER,
    itemInCursor: false,
    pickupMenuOpen: false,
    teamButtonsDisabled: false,
    popupOpen: false,
    descriptionOpen: false,
    disabledForItems: false,
    interfaceLevel: 0,
    cursorMode: 'none',
    burstCapable: false,
    sessionMs: 0,
  };
}

describe('the hands of a merc aboard a vehicle in the team panel (Interface_Panels.cc RenderTEAMPanel)', () => {
  it("gives the driver's first hand the vehicle's life and fuel, and every seat's second hand the Exit Vehicle help", () => {
    const [first, second, third] = teamPanelModel(state(), [driver, passenger, walker], text, help).slots;
    expect(first).toMatchObject({ firstHandHelp: 'Health: 38/75\nFuel: 64/100', secondHandHelp: 'Exit Vehicle' });
    expect(second).toMatchObject({ firstHandHelp: '', secondHandHelp: 'Exit Vehicle' });
    expect(third).toMatchObject({ firstHandHelp: '', secondHandHelp: '' });
  });

  it("states a vehicle's life and fuel over its bars (SetStatsHelp)", () => {
    expect(vitalStatsHelp(text, hummer)).toBe('Health: 38/75\nFuel: 64/100');
    expect(vitalStatsHelp(text, { ...hummer, life: 0 })).toBe('');
  });
});

describe('the stats of the single merc panel (Interface_Panels.cc PrintStat)', () => {
  const CHANGED_AT = 5000;
  const STATS = {
    agility: 60,
    dexterity: 61,
    strength: 62,
    leadership: 63,
    wisdom: 64,
    level: 3,
    marksmanship: 80,
    explosives: 10,
    mechanical: 11,
    medical: 12,
  };
  const changed = merc(2, {
    stats: STATS,
    statChanges: { marksmanship: { at: CHANGED_AT, up: true }, wisdom: { at: CHANGED_AT, up: false }, agility: { at: 0, up: true } },
  });

  function colours(s: SoldierView, sessionMs: number): Record<string, string> {
    const model = smPanelModel({ ...state(), sessionMs }, s, 'stand', [s], text, help);
    const keys = [
      'agility',
      'dexterity',
      'strength',
      'leadership',
      'wisdom',
      'level',
      'marksmanship',
      'explosives',
      'mechanical',
      'medical',
    ];
    return Object.fromEntries(model.stats.map((stat, i) => [keys[i], stat.color]));
  }

  it('prints a stat its change time names green or red for 60 s on the clock the view ticks, a change time of 0 never, and every stat dim below OKLIFE', () => {
    const during = colours(changed, CHANGED_AT + CHANGE_STAT_RECENTLY_DURATION_MS - 1);
    expect([during.marksmanship, during.wisdom, during.agility, during.dexterity]).toEqual(['up', 'down', 'normal', 'normal']);
    const after = colours(changed, CHANGED_AT + CHANGE_STAT_RECENTLY_DURATION_MS);
    expect([after.marksmanship, after.wisdom]).toEqual(['normal', 'normal']);
    expect(colours({ ...changed, life: 9 }, CHANGED_AT).marksmanship).toBe('dim');
  });
});

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadUiStrings } from '../../../content/text/strings.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import type { PlayerView, SoldierView } from '../../../protocol/view.ts';
import { StringsTextService } from '../../text/text-service.ts';
import type { HelpTextSources } from './inventory.ts';
import { type PanelState, teamPanelModel } from './panel-models.ts';
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
    now: 0,
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

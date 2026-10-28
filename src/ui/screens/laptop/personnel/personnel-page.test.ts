import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clickWidget,
  findWidget,
  type LaptopHarness,
  type LaptopUiKit,
  laptopUiKit,
  openLaptopHarness,
  openProgram,
  settleLaptop,
  shownWidget,
} from '../../../../../tests/support/laptop-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../../tests/support/sectors.ts';
import { addToPersonnelList } from '../../../../sim/campaign/laptop/records.ts';
import { createItem, createItems } from '../../../../sim/items/object.ts';
import { LaptopMode } from '../laptop-modes.ts';
import { conditionText } from './personnel-page.ts';

const CONTRACT_DAYS = 7;
const EXTRA_ITEMS = [
  'FIRSTAIDKIT',
  'MEDICKIT',
  'TOOLKIT',
  'LOCKSMITHKIT',
  'CAMOUFLAGEKIT',
  'GLOCK_17',
  'CLIP9_15',
  'CLIP9_30',
  'CLIP9_15_AP',
];

let kit: StubSectorKit;
let ui: LaptopUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await laptopUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

function hireTwo(h: LaptopHarness): { readonly profiles: number[]; readonly soldiers: number[] } {
  const profiles = h
    .laptop()
    .aim.filter((a) => a.face === 'available')
    .slice(0, 2)
    .map((a) => a.profile);
  const soldiers = profiles.map((profile) => {
    const reply = h.session.dispatch({ type: 'aimHire', profile, contract: CONTRACT_DAYS, gear: false });
    if (!reply.ok) throw new Error(`cannot hire ${profile}: ${reply.reason}`);
    return (reply.data as { soldier: number }).soldier;
  });
  return { profiles, soldiers };
}

function fillPockets(h: LaptopHarness, soldier: number): void {
  const merc = h.session.campaign.laptop?.roster.get(soldier);
  if (!merc) throw new Error('no merc');
  const items = kit.content.items;
  EXTRA_ITEMS.forEach((name, k) => {
    const def = items.byName.get(name);
    if (!def) throw new Error(`no item ${name}`);
    merc.soldier.inv[10 + k] = name.startsWith('CLIP') ? createItems(items, def.index, 100, 2) : createItem(items, def.index, 80);
  });
}

describe('the personnel page', () => {
  it('prints a magazine stack as rounds and other items as their condition', () => {
    expect(conditionText(80, 0, 1, null)).toBe('80%');
    expect(conditionText(5, 0, 1, undefined)).toBe(' 5%');
    expect(conditionText(100, 27, 2, 15)).toBe('27/30');
  });

  it('shows the team, pages the faces, switches the panels, scrolls the inventory and lists the departed', async () => {
    const h = await openLaptopHarness(kit, ui);
    const { profiles, soldiers } = hireTwo(h);
    fillPockets(h, soldiers[0] as number);
    await openProgram(h, 'personnelButton');
    expect(h.screen.shell.mode).toBe(LaptopMode.PERSONNEL);
    const team = h.laptop().personnel.current;
    expect(team.map((m) => m.profile)).toEqual(profiles);
    expect(shownWidget(h.t, 'personnelTeamCount').text).toBe('Current Team ( 2 )');
    expect(shownWidget(h.t, 'personnelName').text).toBe(team[0]?.name);
    expect(shownWidget(h.t, 'personnelAssignment').text).not.toBe('');
    expect(shownWidget(h.t, 'personnelStatLabel1').text).toBe('Agility:');
    expect(shownWidget(h.t, 'personnelStat1').text).toBe(String(team[0]?.stats.agility));
    expect(shownWidget(h.t, 'personnelStatLabel13').text).toBe('Hit Percentage:');
    expect(shownWidget(h.t, 'personnelStat13').text).toBe('0 %');
    expect(shownWidget(h.t, 'personnelMoney').text).toMatch(/^\$/);
    expect(shownWidget(h.t, 'personnelHighest0').text).not.toBe('');
    expect(shownWidget(h.t, 'personnelPrev').enabled).toBe(true);

    await clickWidget(h.t, 'personnelNext');
    expect(shownWidget(h.t, 'personnelName').text).toBe(team[1]?.name);
    await clickWidget(h.t, 'personnelPortrait0_0');
    expect(shownWidget(h.t, 'personnelName').text).toBe(team[0]?.name);

    await clickWidget(h.t, 'personnelEmploymentButton');
    expect(shownWidget(h.t, 'personnelEmploymentButton').state).toBe('pressed');
    expect(shownWidget(h.t, 'personnelEmploymentLabel0').text).toBe('Remaining Contract:');
    expect(shownWidget(h.t, 'personnelEmployment0').text).toMatch(/\/ 7d$/);
    expect(shownWidget(h.t, 'personnelStat1').text).toBe('');

    await clickWidget(h.t, 'personnelInventoryButton');
    const items = team[0]?.inventory.length ?? 0;
    expect(items).toBeGreaterThan(8);
    const first = shownWidget(h.t, 'personnelItemName0').text;
    expect(first).not.toBe('');
    expect(shownWidget(h.t, 'personnelInventoryUp').enabled).toBe(false);
    await clickWidget(h.t, 'personnelInventoryDown');
    expect(shownWidget(h.t, 'personnelItemName0').text).not.toBe(first);
    expect(shownWidget(h.t, 'personnelInventoryUp').enabled).toBe(true);
    await clickWidget(h.t, 'personnelSliderZone0');
    expect(shownWidget(h.t, 'personnelItemName0').text).toBe(first);

    const l = h.session.campaign.state.laptop;
    const gone = h.laptop().aim.find((a) => !profiles.includes(a.profile))?.profile ?? 0;
    addToPersonnelList(l, 'dead', gone);
    await settleLaptop(h.t);
    await clickWidget(h.t, 'personnelDepartedToggle');
    expect(shownWidget(h.t, 'personnelDepartedCount').text).toBe('Departures ( 1 )');
    expect(shownWidget(h.t, 'personnelAssignment').text).toBe('Killed in Action');
    expect(shownWidget(h.t, 'personnelStatsButton').state).toBe('pressed');
    expect(shownWidget(h.t, 'personnelInventoryButton').enabled).toBe(false);
    expect(shownWidget(h.t, 'personnelDepartedSummary0').text).toBe('1');
    expect(shownWidget(h.t, 'personnelNext').enabled).toBe(false);
    expect(findWidget(h.t, 'personnelItemName0')?.visible ?? false).toBe(false);

    await clickWidget(h.t, 'personnelCurrentToggle');
    expect(shownWidget(h.t, 'personnelName').text).toBe(team[0]?.name);
  });
});

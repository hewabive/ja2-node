import { describe, expect, it } from 'vitest';
import {
  cyclePortrait,
  departedDown,
  departedUp,
  initialPersonnelState,
  inventoryDown,
  inventoryDownEnabled,
  inventoryUp,
  NO_SELECTION,
  nextFace,
  PersonnelInfo,
  prevFace,
  remainingContractText,
  selectPortrait,
  showCurrentTeam,
  showDepartedTeam,
  signedDelta,
  skillLines,
  sliderIndexAt,
  sliderPositionOf,
  sliderTo,
  sliderZones,
  teamCost,
  teamStatRow,
} from './personnel-model.ts';

const NOBODY_POW = () => false;

describe('the personnel page state', () => {
  it('selects the first merc of the team on entry and wraps the faces of the team', () => {
    const counts = { team: 3, past: 0 };
    const s = initialPersonnelState(counts);
    expect(s).toMatchObject({ currentMode: true, selected: 0, info: PersonnelInfo.STATS });
    prevFace(s, counts);
    expect(s.selected).toBe(2);
    nextFace(s, counts);
    expect(s.selected).toBe(0);
    expect(initialPersonnelState({ team: 0, past: 4 }).selected).toBe(NO_SELECTION);
  });

  it('pages the departed faces by twenty and wraps like the original, the empty last page included', () => {
    const counts = { team: 1, past: 23 };
    const s = initialPersonnelState(counts);
    showDepartedTeam(s, counts);
    expect(s).toMatchObject({ currentMode: false, selected: 0, info: PersonnelInfo.STATS });
    prevFace(s, counts);
    expect([s.upperLeft, s.selected]).toEqual([20, 2]);
    nextFace(s, counts);
    expect([s.upperLeft, s.selected]).toEqual([0, 0]);
    s.selected = 19;
    nextFace(s, counts);
    expect([s.upperLeft, s.selected]).toEqual([20, 0]);
    prevFace(s, counts);
    expect([s.upperLeft, s.selected]).toEqual([0, 19]);
    const even = { team: 1, past: 20 };
    const t = initialPersonnelState(even);
    showDepartedTeam(t, even);
    prevFace(t, even);
    expect([t.upperLeft, t.selected]).toEqual([20, -1]);
  });

  it('moves the departed list and keeps the selection on the page', () => {
    const counts = { team: 0, past: 25 };
    const s = initialPersonnelState(counts);
    showDepartedTeam(s, counts);
    s.selected = 10;
    departedDown(s, counts);
    expect([s.upperLeft, s.selected]).toEqual([20, 4]);
    departedDown(s, counts);
    expect(s.upperLeft).toBe(20);
    departedUp(s);
    expect([s.upperLeft, s.selected]).toEqual([0, 4]);
    departedUp(s);
    expect(s.upperLeft).toBe(0);
    showCurrentTeam(s, counts);
    expect(s.selected).toBe(NO_SELECTION);
  });

  it('cycles the panel on a right click of the selected face and leaves the inventory of a POW', () => {
    const counts = { team: 2, past: 0 };
    const s = initialPersonnelState(counts);
    cyclePortrait(s, 0, counts, NOBODY_POW);
    expect(s.info).toBe(PersonnelInfo.EMPLOYMENT);
    cyclePortrait(s, 1, counts, NOBODY_POW);
    expect([s.selected, s.info]).toEqual([1, PersonnelInfo.EMPLOYMENT]);
    cyclePortrait(s, 1, counts, NOBODY_POW);
    expect(s.info).toBe(PersonnelInfo.INVENTORY);
    cyclePortrait(s, 1, counts, NOBODY_POW);
    expect(s.info).toBe(PersonnelInfo.STATS);
    s.info = PersonnelInfo.INVENTORY;
    selectPortrait(s, 0, counts, (slot) => slot === 0);
    expect([s.selected, s.info]).toEqual([0, PersonnelInfo.STATS]);
    selectPortrait(s, 5, counts, NOBODY_POW);
    expect(s.selected).toBe(0);
  });
});

describe('the personnel inventory', () => {
  it('scrolls eight rows at a time and places the slider like FindPositionOfPersInvSlider', () => {
    const s = initialPersonnelState({ team: 1, past: 0 });
    expect(inventoryDownEnabled(s, 8)).toBe(false);
    inventoryDown(s, 11);
    inventoryDown(s, 11);
    expect([s.inventoryIndex, s.sliderPosition]).toEqual([2, sliderPositionOf(2, 11)]);
    expect(sliderPositionOf(3, 11)).toBe(184);
    inventoryDown(s, 11);
    inventoryDown(s, 11);
    expect(s.inventoryIndex).toBe(3);
    inventoryUp(s, 11);
    expect(s.inventoryIndex).toBe(2);
  });

  it('maps a click on the slider to an index and splits the column into zones of one index each', () => {
    expect(sliderIndexAt(0, 10)).toBe(0);
    expect(sliderIndexAt(92, 10)).toBe(1);
    expect(sliderIndexAt(203, 10)).toBe(2);
    expect(sliderZones(8)).toEqual([]);
    const zones = sliderZones(10);
    expect(zones.map((z) => z.y)).toEqual([0, 92, 184]);
    expect(zones.at(-1)).toEqual({ y: 184, height: 19 });
    const s = initialPersonnelState({ team: 1, past: 0 });
    sliderTo(s, 10, 92);
    expect([s.inventoryIndex, s.sliderPosition]).toEqual([1, 92]);
  });
});

describe('the personnel texts', () => {
  it('prints the contract time with days only when a day is left', () => {
    const a = { days: 'd', hours: 'h' };
    expect(remainingContractText(3 * 1440 + 125, 7, a)).toBe('3d 2h / 7d');
    expect(remainingContractText(59, 1, a)).toBe('0h / 1d');
    expect(remainingContractText(-10, 1, a)).toBe('0h / 1d');
  });

  it('signs the stat deltas', () => {
    expect(signedDelta(0)).toBe('');
    expect(signedDelta(2)).toBe('( +2 )');
    expect(signedDelta(-1)).toBe('( -1 )');
  });

  it('keeps the later of equal values for the lowest and highest and truncates the average', () => {
    const row = teamStatRow(
      [
        { name: 'A', stats: [50, 70] },
        { name: 'B', stats: [50, 71] },
        { name: 'C', stats: [80, 70] },
      ],
      1,
    );
    expect(row).toEqual({ minName: 'C', minValue: 70, average: 70, maxName: 'B', maxValue: 71 });
    expect(teamStatRow([], 0)).toBeNull();
    expect(teamCost([])).toEqual({ daily: 0, highest: 0, lowest: 0 });
    expect(teamCost([300, 120])).toEqual({ daily: 420, highest: 300, lowest: 120 });
  });

  it('places the skill texts with the overrun rule', () => {
    const width = (text: string) => text.length * 5;
    const g = { statX: 407, valueWidth: 140, deltaX: 556, deltaWidth: 30, minimumX: 450 };
    const texts = { skill: (t: number) => `skill${t}`, expert: '(Expert)', none: 'No Skills' };
    expect(skillLines([0, 0], texts, width, g, 0)).toEqual([{ x: 547 - 45, text: 'No Skills' }]);
    expect(skillLines([0, 3], texts, width, g, 0)).toEqual([{ x: 547 - 30, text: 'skill3' }]);
    expect(skillLines([2, 3], texts, width, g, 0).map((l) => l.text)).toEqual(['skill2', 'skill3']);
    const long = { ...texts, skill: () => 'a much longer skill name' };
    expect(skillLines([4, 4], long, width, g, 0)).toEqual([{ x: 450, text: 'a much longer skill name (Expert)' }]);
    const medium = { ...texts, skill: () => 'medium skill' };
    expect(skillLines([4, 4], medium, width, g, 0)).toEqual([{ x: 586 - 105, text: 'medium skill (Expert)' }]);
  });
});

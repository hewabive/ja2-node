import { describe, expect, it } from 'vitest';
import { initialFilters, MapFilter, toggleFilter, turnOffAirspace, turnOnAirspace, turnOnTeams } from './filters.ts';

describe('map border filters', () => {
  it('starts with towns and teams and switches towns and mines against each other', () => {
    const f = initialFilters();
    expect(f).toEqual({ towns: true, mines: false, teams: true, militia: false, airspace: false, items: false });
    toggleFilter(f, MapFilter.MINES);
    expect(f).toMatchObject({ towns: false, mines: true });
    toggleFilter(f, MapFilter.TOWNS);
    expect(f).toMatchObject({ towns: true, mines: false });
    toggleFilter(f, MapFilter.TOWNS);
    expect(f.towns).toBe(false);
  });

  it('shows militia instead of teams and asks for the no-militia message', () => {
    const f = initialFilters();
    expect(toggleFilter(f, MapFilter.MILITIA)).toMatchObject({ militiaShown: true });
    expect(f).toMatchObject({ militia: true, teams: false });
    turnOnTeams(f);
    expect(f).toMatchObject({ militia: false, teams: true });
  });

  it('turns the airspace on over towns and mines, aborting merc plotting and going to the surface', () => {
    const f = initialFilters();
    expect(turnOnAirspace(f)).toEqual({ abortPlot: 'merc', toSurface: true, militiaShown: false });
    expect(f).toMatchObject({ airspace: true, towns: false, mines: false, teams: true });
    expect(turnOnAirspace(f).abortPlot).toBeNull();
    expect(turnOffAirspace(f).abortPlot).toBe('heli');
    expect(f.airspace).toBe(false);
  });

  it('shows items alone and aborts any plotting', () => {
    const f = initialFilters();
    toggleFilter(f, MapFilter.AIRSPACE);
    expect(toggleFilter(f, MapFilter.ITEMS)).toMatchObject({ abortPlot: 'any' });
    expect(f).toEqual({ towns: false, mines: false, teams: false, militia: false, airspace: false, items: true });
    toggleFilter(f, MapFilter.ITEMS);
    expect(f.items).toBe(false);
  });
});

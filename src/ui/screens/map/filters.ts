// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Border.cc ToggleShowTownsMode, ToggleShowMinesMode, ToggleShowMilitiaMode
// @src (pMapErrorString[28] while someone trains militia, else zMarksMapScreenText[1], when the player has none),
// @src ToggleShowTeamsMode, ToggleAirspaceMode (aborts helicopter plotting), ToggleItemsFilter, TurnOnShowTeamsMode,
// @src TurnOnAirSpaceMode (aborts merc plotting, back to the surface), TurnOnItemFilterMode (aborts any plotting).

import type { MapFilters } from './map-view.ts';

export const MapFilter = { TOWNS: 0, MINES: 1, TEAMS: 2, MILITIA: 3, AIRSPACE: 4, ITEMS: 5 } as const;

export type PlotAbort = 'merc' | 'heli' | 'any' | null;

export interface FilterEffects {
  readonly abortPlot: PlotAbort;
  readonly toSurface: boolean;
  readonly militiaShown: boolean;
}

const NONE: FilterEffects = { abortPlot: null, toSurface: false, militiaShown: false };

export function initialFilters(): MapFilters {
  return { towns: true, mines: false, teams: true, militia: false, airspace: false, items: false };
}

export function turnOnTeams(f: MapFilters): void {
  if (f.teams) return;
  f.teams = true;
  f.militia = false;
  f.items = false;
}

export function turnOnAirspace(f: MapFilters): FilterEffects {
  if (f.airspace) return NONE;
  f.airspace = true;
  f.towns = false;
  f.mines = false;
  f.items = false;
  return { ...NONE, abortPlot: 'merc', toSurface: true };
}

export function turnOffAirspace(f: MapFilters): FilterEffects {
  if (!f.airspace) return NONE;
  f.airspace = false;
  return { ...NONE, abortPlot: 'heli' };
}

function turnOnItems(f: MapFilters): FilterEffects {
  f.items = true;
  f.towns = false;
  f.mines = false;
  f.teams = false;
  f.militia = false;
  f.airspace = false;
  return { ...NONE, abortPlot: 'any' };
}

export function toggleFilter(f: MapFilters, filter: number): FilterEffects {
  switch (filter) {
    case MapFilter.TOWNS:
      if (f.towns) f.towns = false;
      else Object.assign(f, { towns: true, mines: false, airspace: false, items: false });
      return NONE;
    case MapFilter.MINES:
      if (f.mines) f.mines = false;
      else Object.assign(f, { mines: true, towns: false, airspace: false, items: false });
      return NONE;
    case MapFilter.TEAMS:
      if (f.teams) f.teams = false;
      else turnOnTeams(f);
      return NONE;
    case MapFilter.MILITIA:
      if (f.militia) {
        f.militia = false;
        return NONE;
      }
      Object.assign(f, { militia: true, teams: false, items: false });
      return { ...NONE, militiaShown: true };
    case MapFilter.AIRSPACE:
      return f.airspace ? turnOffAirspace(f) : turnOnAirspace(f);
    default:
      if (!f.items) return turnOnItems(f);
      f.items = false;
      return NONE;
  }
}

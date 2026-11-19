// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc PlotTemporaryPaths (the temporary path once the cursor rested
// @src MIN_WAIT_TIME_FOR_TEMP_PATH on a sector), HandleMapUI MAP_EVENT_PLOT_PATH (a leg appended when the temporary path
// @src exists, else pMapErrorString[40]), CheckIfClickOnLastSectorInPath (confirm on the last sector: "confirmed",
// @src "canceled" without a path after a previous one, else "unchanged"), CancelOrShortenPlottedPath (PATH_CLEARED,
// @src PATH_SHORTENED, ABORT_PLOTTING), AbortMovementPlottingMode ("Destination unchanged"), DestinationPlottingCompleted,
// @src GetPathTravelTimeDuringPlotting (0 until the temporary path is drawn); src/game/Strategic/Map_Screen_Interface_Map.cc
// @src PlotPathForCharacter, PlotATemporaryPathForCharacter, ClearPathAfterThisSectorForCharacter, PlotPathForHelicopter,
// @src PlotATemporaryPathForHelicopter, ClearPathAfterThisSectorForHelicopter; HandleNewDestConfirmation through a click
// @src on the end of an unchanged path, the helicopter's too (2026-11-18); SHIFT read by FindStratPath at each plotting
// @src click, the helicopter's too, MAP_EVENT_PLOT_PATH's SectorIsPassable for a merc, the confirm of an empty path, the
// @src helicopter's too, the selected list of each plotting click and shortening, the plot's end: the confirm, Esc's
// @src restore (AbortMovementPlottingMode), the cancel and the silent end of TeamListInfoRegionBtnCallBackPrimary
// @src (2026-11-19).

import type { Sector } from '../../../content/strategic/sector-ids.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { StrategicView } from '../../../protocol/view.ts';
import type { HintAnswer } from '../../game-client.ts';
import { mercById, withMercPath } from './character-list.ts';
import { parseSectorLabel, sectorLabel } from './facts.ts';

export const MIN_WAIT_TIME_FOR_TEMP_PATH = 200;

export type PlotMode = 'merc' | 'heli';

export interface RouteAnswer {
  readonly path: readonly string[];
  readonly temp: readonly string[];
  readonly etaMinutes: number;
  readonly distance?: number;
  readonly safe?: number;
  readonly unsafe?: number;
  readonly cost?: number;
  readonly passengers?: number;
}

export interface PlotClient {
  hintNow(request: CommandEnvelope): Promise<HintAnswer>;
}

export type PlotClick =
  | { readonly kind: 'appended' }
  | { readonly kind: 'offRoad' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'ignored' };

export type PlotShorten = { readonly kind: 'cancel' } | { readonly kind: 'shortened' } | { readonly kind: 'abort' };

export type PlotEnd = 'confirm' | 'abort' | 'cancel' | 'drop';

export interface ConfirmedRoute {
  readonly mode: PlotMode;
  readonly soldier: number;
  readonly path: readonly string[];
}

interface LegStep {
  readonly to: string;
  readonly shortest: boolean;
  readonly selected: readonly number[];
}

interface CutStep {
  readonly cut: string;
  readonly selected: readonly number[];
}

type Step = LegStep | CutStep;

const isCutStep = (step: Step): step is CutStep => 'cut' in step;

export function withConfirmedRoute(view: StrategicView, route: ConfirmedRoute | null): StrategicView {
  if (!route) return view;
  if (route.mode === 'heli') {
    const heli = view.helicopter;
    return heli && !('destroyed' in heli) ? { ...view, helicopter: { ...heli, path: route.path } } : view;
  }
  const m = mercById(view, route.soldier);
  return m ? withMercPath(view, m, route.path) : view;
}

function sameLabel(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a.split('-')[0] === b.split('-')[0];
}

export class Plotting {
  readonly mode: PlotMode;
  readonly soldier: number;
  readonly row: number;
  readonly origin: string;
  readonly hadPath: boolean;
  #base: readonly string[];
  #steps: Step[] = [];
  #path: readonly string[];
  #shortest = false;
  #hover: Sector | null = null;
  #hoverSince = 0;
  #answers = new Map<string, RouteAnswer | null>();
  #pending = new Set<string>();

  constructor(mode: PlotMode, soldier: number, row: number, origin: string, base: readonly string[]) {
    this.mode = mode;
    this.soldier = soldier;
    this.row = row;
    this.origin = origin;
    this.#base = [...base];
    this.#path = this.#base;
    this.hadPath = this.#base.length > 0;
  }

  get legs(): readonly string[] {
    return this.#steps.flatMap((step) => (isCutStep(step) ? [] : [step.to]));
  }

  get changed(): boolean {
    return this.#steps.length > 0;
  }

  get shortest(): boolean {
    return this.#shortest;
  }

  set shortest(on: boolean) {
    this.#shortest = on;
  }

  baseChanged(base: readonly string[]): void {
    if (this.#steps.length > 0) return;
    if (base.join(',') === this.#base.join(',')) return;
    this.#base = [...base];
    this.#path = this.#base;
    this.#answers.clear();
  }

  #wireSteps(withSelected: boolean): object[] {
    return this.#steps.map((step) => {
      const selected = withSelected ? { selected: [...step.selected] } : {};
      if (isCutStep(step)) return { cut: step.cut, ...selected };
      return { to: step.to, ...(step.shortest ? { shortest: true } : {}), ...selected };
    });
  }

  #request(to: string): CommandEnvelope {
    const steps = this.#steps.length > 0 ? { steps: this.#wireSteps(false) } : {};
    const shortest = this.#shortest ? { shortest: true } : {};
    if (this.mode === 'heli') return { type: 'previewHeliRoute', to, ...steps, ...shortest, extend: true };
    return { type: 'previewRoute', soldier: this.soldier, to, ...steps, ...shortest, extend: true };
  }

  #key(to: string): string {
    return JSON.stringify(this.#request(to));
  }

  hoverAt(sector: Sector | null, now: number): void {
    const same = sector && this.#hover && sector.x === this.#hover.x && sector.y === this.#hover.y;
    if (same) return;
    this.#hover = sector;
    this.#hoverSince = now;
  }

  update(client: PlotClient, now: number): void {
    const hover = this.#hover;
    if (hover && now - this.#hoverSince >= MIN_WAIT_TIME_FOR_TEMP_PATH) this.#ask(client, sectorLabel({ ...hover, z: 0 }));
    const last = this.lastSector();
    if (last && this.changed) this.#ask(client, last);
  }

  #ask(client: PlotClient, to: string): void {
    const key = this.#key(to);
    if (this.#answers.has(key) || this.#pending.has(key)) return;
    this.#pending.add(key);
    void client.hintNow(this.#request(to)).then((answer) => {
      this.#pending.delete(key);
      this.#answers.set(key, answer.ok ? (answer.data as RouteAnswer) : null);
    });
  }

  #answer(to: string): RouteAnswer | null | undefined {
    return this.#answers.get(this.#key(to));
  }

  tempAnswer(): RouteAnswer | null {
    const hover = this.#hover;
    if (!hover) return null;
    return this.#answer(sectorLabel({ ...hover, z: 0 })) ?? null;
  }

  pathAnswer(): RouteAnswer | null {
    const last = this.lastSector();
    return last !== null && this.changed ? (this.#answer(last) ?? null) : null;
  }

  tempPath(): readonly string[] {
    return this.tempAnswer()?.temp ?? [];
  }

  tempDrawn(): boolean {
    return this.tempPath().length > 0;
  }

  plottedPath(): readonly string[] {
    return this.#path;
  }

  lastSector(): string | null {
    return this.#path[this.#path.length - 1] ?? null;
  }

  lastSectorOrOrigin(): string {
    return this.lastSector() ?? this.origin;
  }

  etaMinutes(): number {
    if (!this.tempDrawn()) return 0;
    return this.tempAnswer()?.etaMinutes ?? 0;
  }

  click(sector: Sector, plottable = true, selected: readonly number[] = []): PlotClick {
    const label = sectorLabel({ ...sector, z: 0 });
    if (sameLabel(label, this.lastSectorOrOrigin())) return { kind: 'confirm' };
    if (!plottable) return { kind: 'ignored' };
    const answer = this.#answer(label);
    if (!answer || answer.temp.length === 0) return answer === undefined ? { kind: 'ignored' } : { kind: 'offRoad' };
    this.#steps.push({ to: label, shortest: this.#shortest, selected: [...selected] });
    this.#path = [...answer.path, ...answer.temp.slice(1)];
    return { kind: 'appended' };
  }

  shorten(sector: Sector, selected: readonly number[] = []): PlotShorten {
    const label = sectorLabel({ ...sector, z: 0 });
    const full = this.#path;
    if (full.length === 0) return { kind: 'abort' };
    if (sameLabel(label, this.origin)) return { kind: 'cancel' };
    let at = -1;
    full.forEach((s, i) => {
      if (sameLabel(s, label)) at = i;
    });
    if (at < 0 || at === full.length - 1) return { kind: 'abort' };
    this.#steps.push({ cut: label, selected: [...selected] });
    this.#path = full.slice(0, at + 1);
    return { kind: 'shortened' };
  }

  endCommand(end: PlotEnd, selected: readonly number[]): CommandEnvelope {
    const steps = this.#steps.length > 0 ? { steps: this.#wireSteps(true) } : {};
    const who = this.mode === 'heli' ? { helicopter: true } : { soldier: this.soldier };
    return { type: 'endPlot', ...who, ...steps, outcome: end, selected: [...selected] };
  }

  confirmedRoute(): ConfirmedRoute {
    return { mode: this.mode, soldier: this.soldier, path: this.plottedPath() };
  }

  cancelledRoute(): ConfirmedRoute {
    return { mode: this.mode, soldier: this.soldier, path: [] };
  }
}

export function pathSectors(path: readonly string[]): Sector[] {
  return path.flatMap((label) => {
    const s = parseSectorLabel(label);
    return s ? [s] : [];
  });
}

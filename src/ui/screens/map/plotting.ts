// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc PlotTemporaryPaths (the temporary path once the cursor rested
// @src MIN_WAIT_TIME_FOR_TEMP_PATH on a sector), HandleMapUI MAP_EVENT_PLOT_PATH (a leg appended when the temporary path
// @src exists, else pMapErrorString[40]), CheckIfClickOnLastSectorInPath (confirm on the last sector: "confirmed",
// @src "canceled" without a path after a previous one, else "unchanged"), CancelOrShortenPlottedPath (PATH_CLEARED,
// @src PATH_SHORTENED, ABORT_PLOTTING), AbortMovementPlottingMode ("Destination unchanged"), DestinationPlottingCompleted,
// @src GetPathTravelTimeDuringPlotting (0 until the temporary path is drawn); src/game/Strategic/Map_Screen_Interface_Map.cc
// @src PlotPathForCharacter, PlotATemporaryPathForCharacter, ClearPathAfterThisSectorForCharacter, PlotPathForHelicopter,
// @src PlotATemporaryPathForHelicopter, ClearPathAfterThisSectorForHelicopter. See docs/28 §7.6, §7.7.

import type { Sector } from '../../../content/strategic/sector-ids.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { HintAnswer } from '../../game-client.ts';
import { parseSectorLabel, sectorLabel } from './facts.ts';
import type { MovePlan } from './move-selection.ts';

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

export type PlotShorten =
  | { readonly kind: 'cancel' }
  | { readonly kind: 'shortenBase'; readonly at: string }
  | { readonly kind: 'shortenLegs' }
  | { readonly kind: 'abort' };

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
  readonly group: MovePlan | null;
  #base: readonly string[];
  #legs: string[] = [];
  #shortest = false;
  #hover: Sector | null = null;
  #hoverSince = 0;
  #answers = new Map<string, RouteAnswer | null>();
  #pending = new Set<string>();
  #pathAnswer: RouteAnswer | null = null;

  constructor(mode: PlotMode, soldier: number, row: number, origin: string, base: readonly string[], group: MovePlan | null = null) {
    this.mode = mode;
    this.soldier = soldier;
    this.row = row;
    this.origin = origin;
    this.group = group;
    this.#base = group ? [] : [...base];
    this.hadPath = this.#base.length > 0;
  }

  static forGroup(plan: MovePlan, row: number, origin: string): Plotting {
    return new Plotting('merc', plan.soldiers[0] ?? -1, row, origin, [], plan);
  }

  get legs(): readonly string[] {
    return this.#legs;
  }

  get shortest(): boolean {
    return this.#shortest;
  }

  set shortest(on: boolean) {
    this.#shortest = on;
  }

  baseChanged(base: readonly string[]): void {
    if (this.#legs.length > 0 || this.group) return;
    if (base.join(',') === this.#base.join(',')) return;
    this.#base = [...base];
    this.#pathAnswer = null;
    this.#answers.clear();
  }

  #request(to: string): CommandEnvelope {
    const via = this.#legs.length > 0 ? { via: [...this.#legs] } : {};
    const shortest = this.#shortest ? { shortest: true } : {};
    if (this.mode === 'heli') return { type: 'previewHeliRoute', to, ...via, extend: true };
    if (this.group) return { type: 'previewRoute', soldier: this.soldier, to, ...via, ...shortest, alone: true };
    return { type: 'previewRoute', soldier: this.soldier, to, ...via, ...shortest, extend: true };
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
    if (last) this.#ask(client, last);
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
    const last = this.#legs[this.#legs.length - 1];
    return last === undefined ? null : (this.#answer(last) ?? this.#pathAnswer);
  }

  tempPath(): readonly string[] {
    return this.tempAnswer()?.temp ?? [];
  }

  tempDrawn(): boolean {
    return this.tempPath().length > 0;
  }

  plottedPath(): readonly string[] {
    if (this.#legs.length === 0) return this.#base;
    const last = this.#legs[this.#legs.length - 1] as string;
    const answer = this.#answer(last);
    if (answer) this.#pathAnswer = answer;
    return this.#pathAnswer ? [...this.#pathAnswer.path, ...this.#pathAnswer.temp.slice(1)] : this.#base;
  }

  lastSector(): string | null {
    if (this.#legs.length > 0) return this.#legs[this.#legs.length - 1] ?? null;
    if (this.#base.length > 0) return this.#base[this.#base.length - 1] ?? null;
    return null;
  }

  lastSectorOrOrigin(): string {
    return this.lastSector() ?? this.origin;
  }

  etaMinutes(): number {
    if (!this.tempDrawn()) return 0;
    return this.tempAnswer()?.etaMinutes ?? 0;
  }

  click(sector: Sector): PlotClick {
    const label = sectorLabel({ ...sector, z: 0 });
    if (sameLabel(label, this.lastSectorOrOrigin())) return { kind: 'confirm' };
    const answer = this.#answer(label);
    if (!answer || answer.temp.length === 0) return answer === undefined ? { kind: 'ignored' } : { kind: 'offRoad' };
    this.#legs.push(label);
    return { kind: 'appended' };
  }

  shorten(sector: Sector): PlotShorten {
    const label = sectorLabel({ ...sector, z: 0 });
    const full = this.plottedPath();
    if (full.length === 0) return { kind: 'abort' };
    if (sameLabel(label, this.origin)) return { kind: 'cancel' };
    const legsStart = this.#base.length;
    let at = -1;
    full.forEach((s, i) => {
      if (sameLabel(s, label)) at = i;
    });
    if (at < 0 || at === full.length - 1) return { kind: 'abort' };
    if (at < legsStart || this.#legs.length === 0) {
      this.#legs = [];
      this.#pathAnswer = null;
      return { kind: 'shortenBase', at: label };
    }
    const kept = this.#legs.filter((leg) => {
      const index = full.findIndex((s, i) => i >= legsStart && sameLabel(s, leg));
      return index >= 0 && index < at;
    });
    kept.push(label);
    this.#legs = kept;
    this.#pathAnswer = null;
    return { kind: 'shortenLegs' };
  }

  confirmCommand(): CommandEnvelope | null {
    if (this.#legs.length === 0) return null;
    const to = this.#legs[this.#legs.length - 1] as string;
    const via = this.#legs.slice(0, -1);
    const viaPart = via.length > 0 ? { via } : {};
    const shortest = this.#shortest ? { shortest: true } : {};
    if (this.mode === 'heli') return { type: 'heliRoute', to, ...viaPart, extend: true };
    const group = this.group;
    if (group)
      return { type: 'routeGroup', soldiers: group.soldiers, squads: group.squads, vehicles: group.vehicles, to, ...viaPart, ...shortest };
    return { type: 'route', soldier: this.soldier, to, ...viaPart, ...shortest, extend: true };
  }

  routeFor(soldier: number): CommandEnvelope | null {
    const command = this.confirmCommand();
    if (!command || this.mode === 'heli' || this.group) return null;
    return { ...command, soldier };
  }
}

export function pathSectors(path: readonly string[]): Sector[] {
  return path.flatMap((label) => {
    const s = parseSectorLabel(label);
    return s ? [s] : [];
  });
}

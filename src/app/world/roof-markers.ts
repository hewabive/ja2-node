// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-02. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc HandlePlacingRoofMarker (FIRSTPOINTERS11 at the tail of the roof layer of a
// @src roofed tile under a soldier on the second level, not for an unseen soldier, not while he climbs up unless
// @src forced), InternalRemoveSoldierFromGridNo (taken off the tile he leaves), CreateSoldierCommon (fSoldierWasMoving
// @src starts TRUE); src/game/Tactical/Overhead.cc ExecuteOverhead (taken off at a fade-out, put back at an other team's
// @src fade-in, put back when a seen soldier who was moving stands, taken off when he starts moving);
// @src src/game/Tactical/Soldier_Ani.cc code 408 (forced at the end of our merc's climb up).

import type { SoldierView } from '../../protocol/view.ts';

export const ROOF_MARKER_TILE = 'FIRSTPOINTERS11';
const OUR_TEAM = 0;
const SECOND_LEVEL = 1;

type Shown = 'seen' | 'fading' | 'gone';

interface Standing {
  readonly gridNo: number;
  readonly level: number;
  readonly animation: number;
}

interface TrackedSoldier extends Standing {
  readonly shown: Shown;
  readonly wasMoving: boolean;
}

export interface RoofMarkerRules {
  readonly climbUpRoof: number;
  readonly stationary: (animation: number) => boolean;
  readonly hasRoof: (gridNo: number) => boolean;
}

function shownOf(s: SoldierView): Shown {
  return s.fadingOut ? 'fading' : 'seen';
}

export class RoofMarkers {
  readonly #rules: RoofMarkerRules;
  readonly #markers = new Set<number>();
  readonly #soldiers = new Map<number, TrackedSoldier>();
  #started = false;

  constructor(rules: RoofMarkerRules) {
    this.#rules = rules;
  }

  update(soldiers: readonly SoldierView[]): readonly number[] {
    const present = new Set<number>();
    for (const s of soldiers) {
      present.add(s.id);
      this.#soldiers.set(s.id, this.#follow(s, this.#soldiers.get(s.id) ?? this.#arrival(s)));
    }
    for (const [id, t] of this.#soldiers) if (!present.has(id)) this.#soldiers.set(id, this.#vanish(t));
    this.#started = true;
    return [...this.#markers];
  }

  reset(): void {
    this.#markers.clear();
    this.#soldiers.clear();
    this.#started = false;
  }

  #arrival(s: SoldierView): TrackedSoldier {
    return { gridNo: s.gridNo, level: s.level, animation: s.animation, shown: this.#started ? 'gone' : shownOf(s), wasMoving: true };
  }

  #follow(s: SoldierView, before: TrackedSoldier): TrackedSoldier {
    if (before.gridNo !== s.gridNo) this.#remove(before);
    const shown = shownOf(s);
    const stationary = this.#rules.stationary(s.animation) || s.noApToFinishMove === true;
    const now: Standing = { gridNo: s.gridNo, level: s.level, animation: s.animation };
    let wasMoving = before.wasMoving;
    if (before.shown === 'seen' && shown === 'fading') this.#remove(now);
    if (before.shown === 'gone' && shown === 'seen' && s.team !== OUR_TEAM) {
      if (!stationary) wasMoving = true;
      this.#place(now, shown, false);
    }
    if (s.team === OUR_TEAM && this.#climbedUp(before, s)) this.#place(now, shown, true);
    if (stationary) {
      if (wasMoving && shown === 'seen') {
        this.#place(now, shown, false);
        wasMoving = false;
      }
    } else if (!wasMoving) {
      wasMoving = true;
      this.#remove(now);
    }
    return { ...now, shown, wasMoving };
  }

  #vanish(t: TrackedSoldier): TrackedSoldier {
    if (t.shown === 'seen') this.#remove(t);
    return { ...t, shown: 'gone' };
  }

  #climbedUp(before: Standing, s: SoldierView): boolean {
    return before.animation === this.#rules.climbUpRoof && s.animation !== this.#rules.climbUpRoof;
  }

  #onRoof(at: Standing, forced: boolean): boolean {
    if (at.level !== SECOND_LEVEL) return false;
    if (!forced && at.animation === this.#rules.climbUpRoof) return false;
    return this.#rules.hasRoof(at.gridNo);
  }

  #place(at: Standing, shown: Shown, forced: boolean): void {
    if (shown !== 'gone' && this.#onRoof(at, forced)) this.#markers.add(at.gridNo);
  }

  #remove(at: Standing): void {
    if (this.#onRoof(at, false)) this.#markers.delete(at.gridNo);
  }
}

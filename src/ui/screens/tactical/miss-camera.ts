// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Weapons.cc StructureHit (with TOPTION_SHOW_MISSES, LocateGridNo at the miss tile of our
// @src team's gun bullet), ShotMiss (the same where our team's gun bullet left the world); Bullets.cc LocateBullet (its
// @src TOPTION_SHOW_MISSES test; the simulation sends bulletLocated where the rest of it locates the view).

import { WeaponClass } from '../../../content/items/items.ts';
import type { ViewFrame } from '../../../protocol/view.ts';

type FrameEvent = NonNullable<ViewFrame['events']>[number];

const GUN_CLASSES: ReadonlySet<number> = new Set([
  WeaponClass.HANDGUN,
  WeaponClass.SMG,
  WeaponClass.RIFLE,
  WeaponClass.MG,
  WeaponClass.SHOTGUN,
]);

export interface MissCameraHost {
  showMisses(): boolean;
  ourTeam(soldier: number): boolean;
  weaponClass(item: number): number | null;
  locate(gridNo: number): void;
}

export class MissCamera {
  readonly #host: MissCameraHost;
  readonly #attackingWeapons = new Map<number, number>();

  constructor(host: MissCameraHost) {
    this.#host = host;
  }

  observe(event: FrameEvent): void {
    if (event.type === 'shotFired' && event.item !== undefined) this.#attackingWeapons.set(event.soldier, event.item);
    const gridNo = this.#locatedGridNo(event);
    if (gridNo !== null && this.#host.showMisses()) this.#host.locate(gridNo);
  }

  #locatedGridNo(event: FrameEvent): number | null {
    if (event.type === 'bulletLocated') return event.gridNo;
    const miss = this.#missTile(event);
    return miss !== null && this.#host.ourTeam(miss.soldier) ? miss.gridNo : null;
  }

  #missTile(event: FrameEvent): { readonly soldier: number; readonly gridNo: number } | null {
    if (event.type === 'bulletImpact') return event.effect === 'miniboom' ? null : event;
    if (event.type === 'bulletStopped' && event.reason === 'offMap' && this.#firesGun(event.soldier)) return event;
    return null;
  }

  #firesGun(soldier: number): boolean {
    const item = this.#attackingWeapons.get(soldier);
    const weaponClass = item === undefined ? null : this.#host.weaponClass(item);
    return weaponClass !== null && GUN_CLASSES.has(weaponClass);
  }
}

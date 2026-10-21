// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc SetUpMovingListsForSector (the listed mercs in character-list order,
// @src their squads and vehicles in the order they first appear), SelectSoldierForMovement, DeselectSoldierForMovement,
// @src SelectSquadForMovement (the movable members picked, the squad itself only when all of them could be, the first
// @src failure reported), DeselectSquadForMovement, AllSoldiersInSquadSelected, SelectVehicleForMovement (AND_ALL_ON_BOARD,
// @src the vehicle moves when a passenger does), DeselectVehicleForMovement, HowManyMovingSoldiersInVehicle,
// @src HowManyMovingSoldiersInSquad, SelectAllOtherSoldiersInList (pMapErrorString[46] when some cannot move),
// @src DeselectAllOtherSoldiersInList, AllOtherSoldiersInListAreSelected (its test of bAssignment >= VEHICLE kept),
// @src IsAnythingSelectedForMoving, MoveMenuBtnCallback (the soldier lines: pMapErrorString[41] between sectors, the last
// @src mover of a squad or vehicle takes the unit along), AddStringsToMoveBox. See docs/28 §7.6.

import type { MoveBoxSoldier } from '../../../protocol/hints.ts';
import type { StrategicMercView, StrategicView } from '../../../protocol/view.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { Assignment } from './character-list.ts';

export const MoveError = { BETWEEN_SECTORS: 41, OTHERS_CANNOT_MOVE: 46 } as const;

export type MoveFeedback = { readonly refusal: string } | { readonly mapError: number } | null;

export interface MoveMember {
  readonly id: number;
  readonly name: string;
  readonly assignment: number;
  readonly squad: number | null;
  readonly vehicle: number | null;
  readonly betweenSectors: boolean;
  readonly listed: boolean;
  readonly refusal: string | null;
}

export type MoveLineKind = 'header' | 'blank' | 'squad' | 'vehicle' | 'soldier' | 'others' | 'done' | 'cancel';

export interface MoveLine {
  readonly kind: MoveLineKind;
  readonly text: string;
  readonly unit: number;
}

export interface MovePlan {
  readonly soldiers: readonly number[];
  readonly squads: readonly number[];
  readonly vehicles: readonly number[];
}

const MOVEMENT_STRINGS = 'pMovementMenuStrings';
const SQUAD_STRINGS = 'pSquadMenuStrings';
const VEHICLE_STRINGS = 'pVehicleStrings';
const ASSIGNMENT_STRINGS = 'pAssignmentStrings';
const TITLE = 0;
const PLOT = 1;
const CANCEL = 2;
const OTHERS = 3;
const NO_UNIT = -1;

function squadOf(m: StrategicMercView): number | null {
  return m.assignment < Assignment.ON_DUTY ? m.assignment : null;
}

function vehicleOf(m: StrategicMercView): number | null {
  return m.assignment === Assignment.VEHICLE && m.vehicle !== undefined ? m.vehicle : null;
}

export function moveMembers(view: StrategicView, order: readonly number[], options: readonly MoveBoxSoldier[]): MoveMember[] {
  const byId = new Map(options.map((o) => [o.soldier, o]));
  const rank = new Map(order.map((id, i) => [id, i]));
  return view.mercs
    .filter((m) => byId.has(m.id))
    .sort((a, b) => (rank.get(a.id) ?? order.length + a.id) - (rank.get(b.id) ?? order.length + b.id))
    .map((m) => {
      const option = byId.get(m.id);
      return {
        id: m.id,
        name: m.name,
        assignment: m.assignment,
        squad: squadOf(m),
        vehicle: vehicleOf(m),
        betweenSectors: m.betweenSectors,
        listed: option?.listed ?? false,
        refusal: option?.refusal ?? null,
      };
    });
}

function isOther(m: MoveMember): boolean {
  return m.assignment >= Assignment.ON_DUTY && m.assignment !== Assignment.VEHICLE;
}

function firstFailure(current: string | null, m: MoveMember): string | null {
  return current ?? m.refusal;
}

export class MoveSelection {
  readonly members: readonly MoveMember[];
  readonly listed: readonly MoveMember[];
  readonly squads: readonly number[];
  readonly vehicles: readonly number[];
  readonly #soldiers = new Set<number>();
  readonly #squads = new Set<number>();
  readonly #vehicles = new Set<number>();

  constructor(members: readonly MoveMember[]) {
    this.members = members;
    this.listed = members.filter((m) => m.listed);
    this.squads = [...new Set(this.listed.flatMap((m) => (m.squad === null ? [] : [m.squad])))];
    this.vehicles = [...new Set(this.listed.flatMap((m) => (m.vehicle === null ? [] : [m.vehicle])))];
  }

  soldierMoving(id: number): boolean {
    return this.#soldiers.has(id);
  }

  squadMoving(squad: number): boolean {
    return this.#squads.has(squad);
  }

  vehicleMoving(vehicle: number): boolean {
    return this.#vehicles.has(vehicle);
  }

  anythingSelected(): boolean {
    return this.listed.some((m) => this.#soldiers.has(m.id)) || this.#squads.size > 0 || this.#vehicles.size > 0;
  }

  #listedSoldier(id: number): MoveMember | undefined {
    return this.listed.find((m) => m.id === id);
  }

  #select(id: number): void {
    if (this.#listedSoldier(id)) this.#soldiers.add(id);
  }

  selectSquad(squad: number): MoveFeedback {
    if (!this.squads.includes(squad)) return null;
    let failure: string | null = null;
    for (const m of this.members.filter((x) => x.squad === squad)) {
      if (m.refusal === null) this.#select(m.id);
      else failure = firstFailure(failure, m);
    }
    if (failure === null) this.#squads.add(squad);
    return failure === null ? null : { refusal: failure };
  }

  deselectSquad(squad: number): void {
    if (!this.squads.includes(squad)) return;
    this.#squads.delete(squad);
    for (const m of this.members) if (m.squad === squad) this.#soldiers.delete(m.id);
  }

  #allInSquadSelected(squad: number): boolean {
    return this.listed.every((m) => m.squad !== squad || this.#soldiers.has(m.id));
  }

  selectVehicle(vehicle: number): MoveFeedback {
    if (!this.vehicles.includes(vehicle)) return null;
    let failure: string | null = null;
    const passengers = this.members.filter((m) => m.vehicle === vehicle);
    for (const m of passengers) {
      if (m.refusal === null) this.#select(m.id);
      else failure = firstFailure(failure, m);
    }
    if (passengers.some((m) => this.#soldiers.has(m.id))) this.#vehicles.add(vehicle);
    return failure === null ? null : { refusal: failure };
  }

  deselectVehicle(vehicle: number): void {
    if (!this.vehicles.includes(vehicle)) return;
    this.#vehicles.delete(vehicle);
    for (const m of this.members) if (m.vehicle === vehicle) this.#soldiers.delete(m.id);
  }

  #movingIn(test: (m: MoveMember) => boolean): number {
    return this.listed.filter((m) => test(m) && this.#soldiers.has(m.id)).length;
  }

  allOthersSelected(): boolean {
    const counted = this.listed.filter((m) => m.assignment >= Assignment.ON_DUTY && m.assignment >= Assignment.VEHICLE);
    return counted.length > 0 && counted.every((m) => this.#soldiers.has(m.id));
  }

  toggleOthers(): MoveFeedback {
    const others = this.listed.filter(isOther);
    if (this.allOthersSelected()) {
      for (const m of others) this.#soldiers.delete(m.id);
      return null;
    }
    let someCannot = false;
    for (const m of others) {
      if (m.refusal === null) this.#soldiers.add(m.id);
      else someCannot = true;
    }
    return someCannot ? { mapError: MoveError.OTHERS_CANNOT_MOVE } : null;
  }

  toggleSquad(squad: number): MoveFeedback {
    if (this.#squads.has(squad)) {
      this.deselectSquad(squad);
      return null;
    }
    return this.selectSquad(squad);
  }

  toggleVehicle(vehicle: number): MoveFeedback {
    if (this.#vehicles.has(vehicle)) {
      this.deselectVehicle(vehicle);
      return null;
    }
    return this.selectVehicle(vehicle);
  }

  toggleSoldier(id: number): MoveFeedback {
    const m = this.#listedSoldier(id);
    if (!m) return null;
    if (m.betweenSectors) return { mapError: MoveError.BETWEEN_SECTORS };
    if (this.#soldiers.has(id)) {
      this.#leave(m);
      return null;
    }
    if (m.refusal !== null) return { refusal: m.refusal };
    this.#soldiers.add(id);
    return m.squad !== null && this.#allInSquadSelected(m.squad) ? this.selectSquad(m.squad) : null;
  }

  #leave(m: MoveMember): void {
    if (m.vehicle !== null && this.#movingIn((x) => x.vehicle === m.vehicle) === 1) this.deselectVehicle(m.vehicle);
    else if (m.squad !== null && this.#movingIn((x) => x.squad === m.squad) === 1) this.deselectSquad(m.squad);
    else this.#soldiers.delete(m.id);
  }

  plan(): MovePlan {
    return {
      soldiers: this.listed.filter((m) => this.#soldiers.has(m.id)).map((m) => m.id),
      squads: this.squads.filter((q) => this.#squads.has(q)),
      vehicles: this.vehicles.filter((v) => this.#vehicles.has(v)),
    };
  }

  lines(text: UiTextService, sector: string, vehicleType: (vehicle: number) => number): MoveLine[] {
    const t = (table: string, index: number) => text.string(table, index) ?? '';
    const marked = (on: boolean, label: string) => (on ? `*${label}*` : label);
    const lines: MoveLine[] = [
      { kind: 'header', text: printf(t(MOVEMENT_STRINGS, TITLE), [sector]), unit: NO_UNIT },
      { kind: 'blank', text: '', unit: NO_UNIT },
    ];
    const soldierLine = (m: MoveMember, indent: string): MoveLine => ({
      kind: 'soldier',
      text: `${indent}${marked(this.#soldiers.has(m.id), m.name)}`,
      unit: m.id,
    });
    for (const squad of this.squads) {
      lines.push({ kind: 'squad', text: marked(this.#squads.has(squad), t(SQUAD_STRINGS, squad)), unit: squad });
      for (const m of this.listed) if (m.squad === squad) lines.push(soldierLine(m, '   '));
    }
    for (const vehicle of this.vehicles) {
      lines.push({ kind: 'vehicle', text: marked(this.#vehicles.has(vehicle), t(VEHICLE_STRINGS, vehicleType(vehicle))), unit: vehicle });
      for (const m of this.listed) if (m.vehicle === vehicle) lines.push(soldierLine(m, '   '));
    }
    const others = this.listed.filter(isOther);
    if (others.length > 0)
      lines.push({ kind: 'others', text: marked(this.allOthersSelected(), t(MOVEMENT_STRINGS, OTHERS)), unit: NO_UNIT });
    for (const m of others)
      lines.push({
        kind: 'soldier',
        text: `  ${marked(this.#soldiers.has(m.id), `${m.name} ( ${t(ASSIGNMENT_STRINGS, m.assignment)} )`)}`,
        unit: m.id,
      });
    lines.push({ kind: 'blank', text: '', unit: NO_UNIT });
    lines.push(
      this.anythingSelected()
        ? { kind: 'done', text: t(MOVEMENT_STRINGS, PLOT), unit: NO_UNIT }
        : { kind: 'blank', text: '', unit: NO_UNIT },
    );
    lines.push({ kind: 'cancel', text: t(MOVEMENT_STRINGS, CANCEL), unit: NO_UNIT });
    return lines;
  }
}

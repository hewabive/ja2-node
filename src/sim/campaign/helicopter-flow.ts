// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Event_Hook.cc EVENT_HELICOPTER_HOVER_TOO_LONG, EVENT_HELICOPTER_HOVER_WAY_TOO_LONG;
// @src Strategic/Hourly_Update.cc HandleHourlyUpdate (PayOffSkyriderDebtIfAny); Strategic/MapScreen.cc RenderMapRegionBackground
// @src (CheckAndHandleSkyriderMonologues while the pilot is available), the helicopter plotting and confirmation;
// @src Strategic/Meanwhile.cc
// @src HandleKillChopperMeanwhileScene; Tactical/Vehicles.cc KillPersonInVehicle; Tactical/Soldier_Control.cc
// @src SoldierTakeDamage (TAKE_DAMAGE_BLOODLOSS for a soldier outside the loaded sector), HandleTakeDamageDeath;
// @src Strategic/Map_Screen_Helicopter.cc HandleHelicopterOnGround (removing Skyrider's soldier); Strategic/Assignments.cc
// @src SquadMenuBtnCallback (leaving a vehicle), VehicleMenuBtnCallback; Strategic/Player_Command.cc
// @src SetThisSectorAsPlayerControlled (the SAM congratulation); Map_Screen_Interface_Map.cc
// @src ClearPathAfterThisSectorForHelicopter, PlotPathForHelicopter (legs from the last sector of the helicopter's path).
// @src See docs/25 §10, §13.

import {
  parseSectorString,
  type Sector,
  sameSector,
  sectorFromStrategicIndex,
  sectorShortString,
  strategicIndex,
} from '../../content/strategic/sector-ids.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import { handleKillChopperMeanwhileScene } from '../strategic/ai/meanwhile.ts';
import { AC, areAssignmentConditionsMet, canCharacterSquad, JoinSquad } from '../strategic/economy/conditions.ts';
import { Assignment, OKLIFE } from '../strategic/economy/constants.ts';
import type { CrewMember, EconomyContext } from '../strategic/economy/ports.ts';
import { addSoldierToVehicle, canCharacterVehicle } from '../strategic/economy/vehicle-assignment.ts';
import {
  cancelHelicopterRoute,
  canHelicopterFly,
  checkAndHandleSkyriderMonologues,
  confirmHelicopterRoute,
  explainWhySkyriderCantFly,
  handleHeliHoverLong,
  handleHeliHoverTooLong,
  helicopterGroup,
  helicopterVehicle,
  heliState,
  isHelicopterPilotAvailable,
  okUseVehicle,
  payOffSkyriderDebtIfAny,
  requestGiveSkyriderNewDestination,
  SKYRIDER,
  setUpHelicopterForMovement,
  skyriderCongratulatesOnSamTaken,
  whyHelicopterCannotFly,
} from '../strategic/forces/helicopter.ts';
import type { HelicopterEventWithoutTick } from '../strategic/forces/helicopter-events.ts';
import { canEntireMovementGroupMove } from '../strategic/forces/move-permission.ts';
import { rebuildWayPointsForGroupPath } from '../strategic/forces/movement.ts';
import type { HelicopterPort, StrategicContext, TacticalWorldPort } from '../strategic/forces/ports.ts';
import { PathEdit, plotLegs, plottedRoute } from '../strategic/forces/routes.ts';
import { addCharacterToSquad, getFirstEmptySquad, removeCharacterFromSquads } from '../strategic/forces/squads.ts';
import {
  findVehicle,
  inHelicopter,
  isEnoughSpaceInVehicle,
  isHelicopter,
  isThisVehicleAccessibleToSoldier,
  setSoldierExitHelicopterInsertionData,
  takeSoldierOutOfVehicle,
} from '../strategic/forces/vehicles.ts';
import { clearStrategicPathAfterSector } from '../strategic/map/pathing.ts';
import { calculateTravelTimeOfGroup } from '../strategic/map/travel.ts';
import { Fact } from '../strategic/narrative/fact-ids.ts';
import { EventKind } from '../strategic/time/constants.ts';
import { removeSoldierFromTacticalSector } from '../tactical/sector-presence.ts';
import { Team } from '../tactical/soldier.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { sectorList } from './commands.ts';

const BLOODLOSS_DAMAGE = 100;

type Command = { readonly type: string; readonly [key: string]: unknown };

const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  mapScreenOnly: 'only on the strategic map',
  noHelicopter: 'the player has no helicopter',
  skyriderOwed: 'Skyrider is owed money',
  returningToBase: 'Skyrider is returning to base',
  grounded: 'the helicopter is grounded by enemies in its sector',
  skyriderUnwilling: 'Skyrider does not want to fly (Drassen loyalty is low)',
  emptyHelicopterHint: 'the helicopter is empty while mercs stand in its sector: board them first (hint shown once)',
  noRoute: 'no route to that sector',
  unknownSoldier: 'no such merc',
  noSuchVehicle: 'no such vehicle',
  alreadyAboard: 'the merc is already in that vehicle',
  notAccessible: 'the vehicle is not in the merc’s sector, is moving or is destroyed',
  notAllowed: 'that vehicle may not be used yet',
  vehicleNotOurs: 'the vehicle is not on the player’s team',
  vehicleFull: 'no free seat',
  combat: 'enemies are present in the loaded sector',
  impassableSector: 'the merc stands in an impassable sector',
  unconscious: 'the merc is unconscious',
  helicopterInHostileSector: 'the merc is in the helicopter over a hostile sector',
  moving: 'the merc is travelling',
  underground: 'the merc is underground',
  inTransit: 'the merc is in transit',
  prisoner: 'the merc is a prisoner',
  notInVehicle: 'the merc is not in a vehicle',
  helicopterInFlight: 'passengers leave the helicopter only while it hovers or stands',
  squadFull: 'that squad is full',
  squadElsewhere: 'that squad is in another sector',
  squadMoving: 'that squad is on the move',
  squadHasVehicle: 'that squad is a vehicle squad',
  notEligible: 'the merc cannot join that squad',
};

function refusal(code: string): CommandResult {
  return { ok: false, reason: `${code}: ${REFUSAL_TEXT[code] ?? code}`, data: { refusal: code } };
}

function soldierArg(cmd: Command): number | null {
  return typeof cmd.soldier === 'number' && Number.isInteger(cmd.soldier) ? cmd.soldier : null;
}

function parseSector(value: unknown): Sector | null {
  if (typeof value !== 'string') return null;
  try {
    return parseSectorString(value);
  } catch {
    return null;
  }
}

const SQUAD_REFUSALS: Readonly<Record<number, string>> = {
  [JoinSquad.FULL]: 'squadFull',
  [JoinSquad.TOO_FAR]: 'squadElsewhere',
  [JoinSquad.SQUAD_MOVING]: 'squadMoving',
  [JoinSquad.VEHICLE]: 'squadHasVehicle',
  [JoinSquad.CANT]: 'notEligible',
};

export class HelicopterFlow {
  readonly campaign: CampaignSim;
  readonly #events: SimEvent[] = [];

  constructor(campaign: CampaignSim) {
    this.campaign = campaign;
  }

  get ctx(): StrategicContext {
    const ctx = this.campaign.strategic;
    if (!ctx) throw new Error('the helicopter needs the strategic layer');
    return ctx;
  }

  get economy(): EconomyContext | null {
    return this.campaign.economy;
  }

  port(): HelicopterPort {
    const narrative = this.campaign.narrative;
    return {
      fact: (id) => narrative.fact(id),
      setFactTrue: (id) => narrative.setFactTrue(id),
      skyriderLoyaltyLow: () => narrative.checkFact(Fact.LOYALTY_LOW, SKYRIDER),
      cosmeticChoice: (n) => this.campaign.state.cosmetic.helicopter.int(n),
      killInVehicle: (id) => this.#killInVehicle(id),
      scheduleKillChopperMeanwhile: () => this.#scheduleKillChopperMeanwhile(),
      skyriderOnGround: (sector) => this.#skyriderOnGround(sector),
      emit: (e) => this.emit(e),
    };
  }

  worldPort(base: TacticalWorldPort): TacticalWorldPort {
    return {
      ...base,
      sectorLiberated: (event) => {
        base.sectorLiberated(event);
        if (event.samId !== -1 && this.campaign.strategic) skyriderCongratulatesOnSamTaken(this.campaign.strategic);
      },
    };
  }

  emit(e: HelicopterEventWithoutTick): void {
    this.#events.push({ ...e, tick: this.campaign.tick } as SimEvent);
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  register(): void {
    const d = this.campaign.dispatchTable;
    d.register(EventKind.HELICOPTER_HOVER_TOO_LONG, () => handleHeliHoverLong(this.ctx));
    d.register(EventKind.HELICOPTER_HOVER_WAY_TOO_LONG, () => handleHeliHoverTooLong(this.ctx));
  }

  payOffSkyriderDebtIfAny(): void {
    if (this.campaign.strategic) payOffSkyriderDebtIfAny(this.campaign.strategic);
  }

  afterStrategicStep(): void {
    const ctx = this.campaign.strategic;
    if (ctx && isHelicopterPilotAvailable(ctx)) checkAndHandleSkyriderMonologues(ctx);
  }

  #killInVehicle(id: number): boolean {
    const m = this.campaign.battle?.roster.get(id);
    if (!m || m.life === 0) return false;
    const bandage = m.lifeMax - m.life - m.bleeding;
    m.life = m.life > BLOODLOSS_DAMAGE ? m.life - BLOODLOSS_DAMAGE : 0;
    m.bleeding = m.lifeMax - (m.life + bandage);
    if (m.life === 0) this.campaign.battle?.mercDiedInTactical(m.soldier);
    return true;
  }

  #scheduleKillChopperMeanwhile(): void {
    const q = this.campaign.queen;
    if (q) handleKillChopperMeanwhileScene(q);
  }

  #skyriderOnGround(sector: Sector | null): void {
    if (sector) return;
    const t = this.campaign.tactical?.state;
    const skyrider = t?.soldiers.find((x) => x?.placed && x.profile === SKYRIDER && x.team !== Team.OUR);
    if (t && skyrider) removeSoldierFromTacticalSector(t, skyrider);
  }

  dispatch(cmd: Command): CommandResult | null {
    switch (cmd.type) {
      case 'heliRoute':
        return this.#heliRoute(cmd);
      case 'shortenHeliRoute':
        return this.#shortenHeliRoute(cmd);
      case 'heliCancel':
        return this.#heliCancel();
      case 'boardVehicle':
        return this.#boardVehicle(cmd);
      case 'leaveVehicle':
        return this.#leaveVehicle(cmd);
      case 'route':
        return this.#passengerRoute(cmd);
      case 'cancelRoute':
        return this.#passengerCancel(cmd);
      case 'shortenRoute':
        return this.#helicopterPassenger(cmd) ? this.#shortenHeliRoute(cmd) : null;
      case 'assignSquad':
        return this.#passengerSquadGuard(cmd);
      case 'assign':
        return this.#passengerAssignGuard(cmd);
      default:
        return null;
    }
  }

  #helicopterPassenger(cmd: Command): CrewMember | null {
    const ctx = this.campaign.strategic;
    const id = soldierArg(cmd);
    const m = id === null ? undefined : this.economy?.crew.get(id);
    return ctx && m && inHelicopter(ctx, m) ? m : null;
  }

  #passengerRoute(cmd: Command): CommandResult | null {
    const m = this.#helicopterPassenger(cmd);
    if (!m) return null;
    const moving = canEntireMovementGroupMove(this.ctx, m.id, { inCombat: this.campaign.tactical?.state.inCombat === true });
    if (moving) return { ok: false, reason: `the squad cannot move: ${moving}` };
    return this.#heliRoute(cmd);
  }

  #passengerCancel(cmd: Command): CommandResult | null {
    return this.#helicopterPassenger(cmd) ? this.#heliCancel() : null;
  }

  #leaveRefusal(m: CrewMember): string | null {
    if (!inHelicopter(this.ctx, m)) return null;
    const heli = heliState(this.ctx);
    if (this.campaign.state.forces.helicopterAirborne && !heli.hovering) return 'helicopterInFlight';
    if (heli.returningToBase) return 'returningToBase';
    return null;
  }

  #passengerSquadGuard(cmd: Command): CommandResult | null {
    const m = this.#helicopterPassenger(cmd);
    const code = m ? this.#leaveRefusal(m) : null;
    return code ? refusal(code) : null;
  }

  #passengerAssignGuard(cmd: Command): CommandResult | null {
    const to = cmd.to as { readonly kind?: unknown } | undefined;
    if (to?.kind !== 'squad' || !Array.isArray(cmd.soldiers)) return null;
    for (const id of cmd.soldiers) {
      const guard = typeof id === 'number' ? this.#passengerSquadGuard({ type: 'assignSquad', soldier: id }) : null;
      if (guard) return guard;
    }
    return null;
  }

  #mapScreenRefusal(): CommandResult | null {
    return this.campaign.state.flow === 'strategic' ? null : refusal('mapScreenOnly');
  }

  #heliRoute(cmd: Command): CommandResult {
    const ctx = this.ctx;
    const notMap = this.#mapScreenRefusal();
    if (notMap) return notMap;
    const to = parseSector(cmd.to);
    if (!to) return { ok: false, reason: 'to must be a sector such as B13' };
    const via = sectorList(cmd.via);
    if (!via) return { ok: false, reason: 'via must be a list of sectors such as ["B12"]' };
    if (!helicopterVehicle(ctx)) return refusal('noHelicopter');
    const request = requestGiveSkyriderNewDestination(ctx);
    if (!request.ok) return refusal(request.refusal);
    if (cmd.extend !== true) cancelHelicopterRoute(ctx);
    setUpHelicopterForMovement(ctx);
    const v = helicopterVehicle(ctx);
    const g = helicopterGroup(ctx);
    if (!v || !g) return refusal('noHelicopter');
    const origin = strategicIndex(v.sector);
    const legs = plotLegs(ctx, g, v.path, origin, via, to);
    const path = typeof legs === 'string' ? null : plottedRoute(legs, origin, to);
    if (!path) return refusal('noRoute');
    v.path = path;
    confirmHelicopterRoute(ctx, to);
    return { ok: true, data: this.#routeData() };
  }

  #shortenHeliRoute(cmd: Command): CommandResult {
    const ctx = this.ctx;
    const notMap = this.#mapScreenRefusal();
    if (notMap) return notMap;
    const at = parseSector(cmd.at);
    if (!at) return { ok: false, reason: 'at must be a sector such as B13' };
    const v = helicopterVehicle(ctx);
    if (!v) return refusal('noHelicopter');
    if (!canHelicopterFly(ctx)) return refusal(explainWhySkyriderCantFly(ctx) ?? 'noHelicopter');
    const original = v.path.length;
    if (!original) return refusal('noRoute');
    if (sameSector(at, v.sector)) {
      cancelHelicopterRoute(ctx);
      return { ok: true, data: { ...this.#routeData(), edit: PathEdit.PATH_CLEARED } };
    }
    v.path = clearStrategicPathAfterSector(v.path, strategicIndex(at));
    if (v.path.length >= original) return refusal('noRoute');
    const g = helicopterGroup(ctx);
    if (g) rebuildWayPointsForGroupPath(ctx, v.path, g);
    return { ok: true, data: { ...this.#routeData(), edit: PathEdit.PATH_SHORTENED } };
  }

  #routeData(): { readonly path: readonly string[]; readonly etaMinutes: number } {
    const ctx = this.ctx;
    const v = helicopterVehicle(ctx);
    const path = (v?.path ?? []).map((i) => sectorShortString(sectorFromStrategicIndex(i)));
    return { path, etaMinutes: calculateTravelTimeOfGroup(ctx, helicopterGroup(ctx) ?? null) };
  }

  #heliCancel(): CommandResult {
    const ctx = this.ctx;
    const notMap = this.#mapScreenRefusal();
    if (notMap) return notMap;
    if (!helicopterVehicle(ctx)) return refusal('noHelicopter');
    if (!canHelicopterFly(ctx)) return refusal(explainWhySkyriderCantFly(ctx) ?? 'noHelicopter');
    cancelHelicopterRoute(ctx);
    return { ok: true, data: this.#routeData() };
  }

  #vehicleArg(cmd: Command): number | null {
    if (cmd.vehicle === 'helicopter') return this.campaign.state.forces.helicopterVehicleId;
    return typeof cmd.vehicle === 'number' && Number.isInteger(cmd.vehicle) ? cmd.vehicle : null;
  }

  #conditionRefusal(economy: EconomyContext, m: CrewMember): string | null {
    const world = this.campaign.state.worldSector;
    if (economy.world.enemyInSector() && world && sameSector(m.sector, world)) return 'combat';
    if (areAssignmentConditionsMet(economy, m, AC.EPC | AC.MECHANICAL)) return null;
    if (m.life < OKLIFE) return 'unconscious';
    if (m.assignment === Assignment.IN_TRANSIT) return 'inTransit';
    if (m.assignment === Assignment.ASSIGNMENT_POW) return 'prisoner';
    if (m.betweenSectors) return 'moving';
    if (m.sector.z !== 0) return 'underground';
    if (m.inSector && economy.world.enemyInSector()) return 'combat';
    if (inHelicopter(economy, m)) return 'helicopterInHostileSector';
    return 'impassableSector';
  }

  #boardVehicle(cmd: Command): CommandResult {
    const economy = this.economy;
    if (!economy) return refusal('noSuchVehicle');
    const notMap = this.#mapScreenRefusal();
    if (notMap) return notMap;
    const id = soldierArg(cmd);
    const m = id === null ? undefined : economy.crew.get(id);
    if (!m || m.isVehicle) return refusal('unknownSoldier');
    const vid = this.#vehicleArg(cmd);
    const v = vid === null ? null : findVehicle(economy, vid);
    if (!v || vid === null) return refusal('noSuchVehicle');
    if (m.assignment === Assignment.VEHICLE && m.vehicleId === vid) return refusal('alreadyAboard');
    if (!isThisVehicleAccessibleToSoldier(m, v)) return refusal('notAccessible');
    if (!okUseVehicle(economy, v))
      return refusal(isHelicopter(economy, v) ? (whyHelicopterCannotFly(economy) ?? 'notAllowed') : 'notAllowed');
    if (!canCharacterVehicle(economy, m)) return refusal(this.#conditionRefusal(economy, m) ?? 'notEligible');
    if (!isEnoughSpaceInVehicle(economy, v)) return refusal('vehicleFull');
    if (!addSoldierToVehicle(economy, m, v)) return refusal(isHelicopter(economy, v) ? 'vehicleFull' : 'vehicleNotOurs');
    this.emit({ type: 'vehicleBoarded', soldier: m.id, vehicle: vid });
    return { ok: true, data: { vehicle: vid, seat: v.passengers.indexOf(m.id) } };
  }

  #leaveVehicle(cmd: Command): CommandResult {
    const economy = this.economy;
    if (!economy) return refusal('unknownSoldier');
    const id = soldierArg(cmd);
    const m = id === null ? undefined : economy.crew.get(id);
    if (!m) return refusal('unknownSoldier');
    if (m.assignment !== Assignment.VEHICLE) return refusal('notInVehicle');
    const leave = this.#leaveRefusal(m);
    if (leave) return refusal(leave);
    const squad = typeof cmd.squad === 'number' ? cmd.squad : getFirstEmptySquad(economy);
    const code = canCharacterSquad(economy, m, squad);
    const squadRefusal = SQUAD_REFUSALS[code];
    if (squadRefusal) return refusal(squadRefusal);
    const vehicle = m.vehicleId;
    const fromHelicopter = inHelicopter(economy, m);
    takeSoldierOutOfVehicle(economy, m.id);
    removeCharacterFromSquads(economy, m.id);
    addCharacterToSquad(economy, m.id, squad);
    if (fromHelicopter) setSoldierExitHelicopterInsertionData(economy, m);
    this.emit({ type: 'vehicleLeft', soldier: m.id, vehicle });
    return { ok: true, data: { squad } };
  }
}

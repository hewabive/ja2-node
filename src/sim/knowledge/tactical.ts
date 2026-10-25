import type { MapDoor } from '../../content/formats/map.ts';
import { recompileLocalMovementCosts } from '../../content/world/movement-costs.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { Rng } from '../../core/rng.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { PerceivedLock, PerceivedTrap } from '../tactical/doors/door-table.ts';
import type { DoorView } from '../tactical/doors/door-view.ts';
import { doorGridNos, isDoorOpenAt, swapStructureForPartner } from '../tactical/doors.ts';
import {
  initLighting,
  LightSpriteFlags,
  lightSetBaseLevel,
  lightSpriteCreate,
  lightSpritePower,
  NORMAL_LIGHTLEVEL_DAY,
} from '../tactical/lighting/lighting.ts';
import type { BoxingStateName } from '../tactical/narrative/boxing-events.ts';
import { BOXING_STATE_NAMES } from '../tactical/narrative/boxing-state.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from '../tactical/narrative/port.ts';
import { Opp } from '../tactical/perception/opp.ts';
import { addMercStructure, removeMercStructure } from '../tactical/person-structure.ts';
import { type Soldier, Team } from '../tactical/soldier.ts';
import { createTacticalState, placeOccupant, registerSoldier, type TacticalState } from '../tactical/state.ts';
import { type GuardOptions, guardFields, UnsuppliedFieldError } from './guard.ts';
import { worldItemFromView } from './objects.ts';
import { soldierFromView } from './soldiers.ts';
import type { KnowledgeLight, KnowledgeSoldier, KnowledgeView } from './view.ts';

const SANDBOX_HOUR = 12;
const PROJECTION_SEED = 0;

const STATE_FIELDS: ReadonlySet<PropertyKey> = new Set([
  'world',
  'content',
  'soldiers',
  'mercSlots',
  'occupant',
  'doorStatus',
  'inCombat',
  'pathWorld',
  'pathEnv',
  'lighting',
  'worldItems',
  'perception',
  'narrative',
  'fog',
  'explosives',
  'boxing',
  'addedExitGrids',
]);

const BOXING_FIELDS: ReadonlySet<PropertyKey> = new Set(['state']);

const EXPLOSIVES_FIELDS: ReadonlySet<PropertyKey> = new Set(['gassed']);

const PERCEPTION_FIELDS: ReadonlySet<PropertyKey> = new Set(['publicOpp', 'disallowSight']);
const OUR_PUBLIC_OPP: ReadonlySet<PropertyKey> = new Set([String(Team.OUR), 'length']);
const DOOR_FIELDS: ReadonlySet<PropertyKey> = new Set(['gridNo', 'perceivedLocked', 'perceivedTrapped']);

const LOCK_BY_NAME: Readonly<Record<string, number>> = {
  unknown: PerceivedLock.UNKNOWN,
  locked: PerceivedLock.LOCKED,
  unlocked: PerceivedLock.UNLOCKED,
  broken: PerceivedLock.BROKEN,
};

function perceivedTrap(trap: string): number {
  if (trap === 'unknown') return PerceivedTrap.UNKNOWN;
  if (trap === 'noneFound') return PerceivedTrap.PERCEIVED_UNTRAPPED;
  if (trap === 'none') return PerceivedTrap.PROVED_UNTRAPPED;
  return PerceivedTrap.PROVED_TRAPPED;
}

function projectedDoor(door: MapDoor, view: DoorView | undefined, guard: GuardOptions): MapDoor {
  const perceived = {
    ...door,
    perceivedLocked: view ? (LOCK_BY_NAME[view.locked] ?? PerceivedLock.UNKNOWN) : PerceivedLock.UNKNOWN,
    perceivedTrapped: view ? perceivedTrap(view.trap) : PerceivedTrap.UNKNOWN,
  };
  return guardFields(perceived, DOOR_FIELDS, `door ${door.gridNo}`, guard);
}

function lightKey(light: KnowledgeLight | null | undefined, hour: number): string {
  return light ? JSON.stringify(light) : `hour ${hour}`;
}

export interface ViewNarrative {
  readonly epcs: ReadonlySet<number>;
  readonly controlledRobots: ReadonlySet<number>;
}

function projectionNarrative(facts: ViewNarrative, guard: GuardOptions): NarrativePort {
  const supplied: Partial<NarrativePort> = {
    isEpc: (s) => facts.epcs.has(s.id),
    robotCanBeControlled: (robot) => facts.controlledRobots.has(robot.id),
  };
  if (!guard.strict) return { ...NO_NARRATIVE_PORT, ...supplied };
  const port: Record<string, unknown> = {};
  for (const key of Object.keys(NO_NARRATIVE_PORT)) {
    port[key] = () => {
      throw new UnsuppliedFieldError(`narrative.${key}`);
    };
  }
  return { ...(port as unknown as NarrativePort), ...supplied };
}

export class TacticalProjection {
  readonly mapPath: string;
  readonly state: TacticalState;
  readonly #world: TacticalWorld;
  readonly #doors: readonly number[];
  readonly #mapDoors: ReadonlyMap<number, MapDoor>;
  readonly #projectedMapDoors: Map<number, MapDoor>;
  #placed: Soldier[] = [];
  #lightKey = '';

  constructor(world: TacticalWorld, content: TacticalContent) {
    this.mapPath = world.mapPath;
    this.#world = world;
    this.#mapDoors = new Map(world.map.doors.map((d) => [d.gridNo, d]));
    this.#projectedMapDoors = new Map(this.#mapDoors);
    this.state = createTacticalState({ ...world, mapDoors: this.#projectedMapDoors }, content, Rng.fromSeed(PROJECTION_SEED));
    this.#doors = doorGridNos(world);
  }

  sync(view: KnowledgeView, guard: GuardOptions): TacticalState {
    const t = this.state;
    t.inCombat = view.combat !== null && view.combat !== undefined;
    this.#syncDoors(view, guard);
    this.#syncSoldiers(view.soldiers, guard);
    this.#syncItems(view, guard);
    this.#syncLight(view);
    t.narrative = projectionNarrative(viewNarrative(view.soldiers), guard);
    t.boxing.state = BOXING_STATE_NAMES.indexOf((view.boxing?.state ?? 'notBoxing') as BoxingStateName);
    return this.#guardedState(guard);
  }

  #guardedState(guard: GuardOptions): TacticalState {
    const t = this.state;
    if (!guard.strict) return t;
    const publicOpp = guardFields(t.perception.publicOpp, OUR_PUBLIC_OPP, 'perception.publicOpp', guard);
    const perception = guardFields({ ...t.perception, publicOpp }, PERCEPTION_FIELDS, 'perception', guard);
    const explosives = guardFields(t.explosives, EXPLOSIVES_FIELDS, 'explosives', guard);
    const boxing = guardFields(t.boxing, BOXING_FIELDS, 'boxing', guard);
    return guardFields({ ...t, perception, explosives, boxing }, STATE_FIELDS, 'state', guard);
  }

  #syncDoors(view: KnowledgeView, guard: GuardOptions): void {
    const t = this.state;
    const open = new Set(view.openDoors ?? []);
    for (const g of this.#doors) {
      if (open.has(g) === isDoorOpenAt(t, g)) continue;
      const door = t.world.structures.find(g, StructureFlags.ANYDOOR);
      const swapped = door ? swapStructureForPartner(t, door) : null;
      if (swapped) recompileLocalMovementCosts(t.world.costs, t.world, g);
    }
    const known = new Map((view.doors ?? []).map((d) => [d.gridNo, d]));
    for (const [g, door] of this.#mapDoors) this.#projectedMapDoors.set(g, projectedDoor(door, known.get(g), guard));
  }

  #syncSoldiers(views: readonly KnowledgeSoldier[], guard: GuardOptions): void {
    const t = this.state;
    for (const s of this.#placed) removeMercStructure(t, s);
    this.#placed = [];
    t.soldiers.length = 0;
    t.mercSlots.length = 0;
    t.occupant[0].fill(-1);
    t.occupant[1].fill(-1);
    const ours = t.perception.publicOpp[Team.OUR];
    ours?.fill(Opp.NOT_HEARD_OR_SEEN);
    t.explosives.gassed.fill(0);
    const ownIds = views.filter((v) => v.team === Team.OUR).map((v) => v.id);
    for (const v of views) {
      const { soldier, raw } = soldierFromView(t.content, v, ownIds, guard);
      raw.overTerrain = t.world.terrain[raw.gridNo] ?? 0;
      registerSoldier(t, soldier);
      placeOccupant(t, raw);
      addMercStructure(t, raw);
      this.#placed.push(raw);
      if (v.team !== Team.OUR) continue;
      for (const id of v.sees ?? []) if (ours) ours[id] = Opp.SEEN_CURRENTLY;
      if (v.hint?.gassed) t.explosives.gassed[v.id] = 1;
    }
  }

  #syncItems(view: KnowledgeView, guard: GuardOptions): void {
    const t = this.state;
    t.worldItems.length = 0;
    (view.items ?? []).forEach((v, k) => {
      t.worldItems.push(worldItemFromView(t.content.items, v, `item ${k}`, guard));
    });
  }

  #syncLight(view: KnowledgeView): void {
    const t = this.state;
    const hour = view.clock?.hour ?? SANDBOX_HOUR;
    const key = lightKey(view.light, hour);
    if (key === this.#lightKey) return;
    this.#lightKey = key;
    const light = view.light;
    if (!light) {
      initLighting(t, this.#world.map, hour, NORMAL_LIGHTLEVEL_DAY);
      return;
    }
    initLighting(t, { ambient: this.#world.map.ambient, lights: null }, hour, light.ambient);
    for (const def of light.sprites) {
      const sprite = lightSpriteCreate(t, def.template);
      if (!sprite) continue;
      sprite.x = def.x;
      sprite.y = def.y;
      if (def.roof) sprite.flags |= LightSpriteFlags.ONROOF;
      lightSpritePower(sprite, true);
    }
    lightSetBaseLevel(t, light.ambient);
  }
}

function viewNarrative(soldiers: readonly KnowledgeSoldier[]): ViewNarrative {
  const own = soldiers.filter((s) => s.team === Team.OUR);
  return {
    epcs: new Set(own.filter((s) => s.kind === 'epc').map((s) => s.id)),
    controlledRobots: new Set(own.filter((s) => s.controlled === true).map((s) => s.id)),
  };
}

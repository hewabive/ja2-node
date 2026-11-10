import type { StructureDef } from '../../content/formats/jsd.ts';
import type { MapDoor } from '../../content/formats/map.ts';
import type { Sector } from '../../content/strategic/sector-ids.ts';
import { recompileLocalMovementCosts } from '../../content/world/movement-costs.ts';
import { has, PROFILE_Z_SIZE, StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { idiv } from '../../core/int.ts';
import { Rng } from '../../core/rng.ts';
import { setKnownMines } from '../tactical/bombs/mine-flags.ts';
import { smokeChanged } from '../tactical/change-counts.ts';
import { corpseStructureDef } from '../tactical/combat/death.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { PerceivedLock, PerceivedTrap } from '../tactical/doors/door-table.ts';
import type { DoorView } from '../tactical/doors/door-view.ts';
import { containerGridNos, doorGridNos, isDoorOpenAt, isOpenableOpenAt, swapStructureForPartner } from '../tactical/doors.ts';
import { setSmokeFlagsAt, smokeTileFlag, smokeTypeOf } from '../tactical/explosions/smoke.ts';
import {
  initLighting,
  LightSpriteFlags,
  lightSetBaseLevel,
  lightSpriteCreate,
  lightSpritePower,
  NORMAL_LIGHTLEVEL_DAY,
} from '../tactical/lighting/lighting.ts';
import { type AddedExitGrid, addExitGridToWorld } from '../tactical/map-changes.ts';
import type { BoxingStateName } from '../tactical/narrative/boxing-events.ts';
import { BOXING_STATE_NAMES } from '../tactical/narrative/boxing-state.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from '../tactical/narrative/port.ts';
import { Opp } from '../tactical/perception/opp.ts';
import { addMercStructure, removeMercStructure } from '../tactical/person-structure.ts';
import { type Soldier, Team } from '../tactical/soldier.ts';
import { clearOccupants, createTacticalState, placeOccupant, registerSoldier, type TacticalState } from '../tactical/state.ts';
import { type AddedExitGridView, changesObjectLayer, type TileChangeView } from '../tactical/world-view.ts';
import { type GuardOptions, guardFields, UnsuppliedFieldError } from './guard.ts';
import { worldItemFromView } from './objects.ts';
import { soldierFromView } from './soldiers.ts';
import { sectorFromName } from './strategic-state.ts';
import type { KnowledgeCorpse, KnowledgeLight, KnowledgeSoldier, KnowledgeView } from './view.ts';

const SANDBOX_HOUR = 12;
const PROJECTION_SEED = 0;
const NO_TILE_CHANGES: readonly TileChangeView[] = [];
const NO_EXIT_GRIDS: readonly AddedExitGridView[] = [];
const NO_SECTOR: Sector = { x: 0, y: 0, z: 0 };
const ARRIVAL_NOT_SHOWN = 0;

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
  'mineFlags',
  'perception',
  'narrative',
  'fog',
  'explosives',
  'boxing',
  'addedExitGrids',
  'sector',
]);

const BOXING_FIELDS: ReadonlySet<PropertyKey> = new Set(['state']);

const EXPLOSIVES_FIELDS: ReadonlySet<PropertyKey> = new Set(['smokeTiles']);

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

function sameTileChange(a: TileChangeView, b: TileChangeView | undefined): boolean {
  return b !== undefined && a.kind === b.kind && a.gridNo === b.gridNo && a.level === b.level && a.tile === b.tile;
}

function startsWith(changes: readonly TileChangeView[], prefix: readonly TileChangeView[]): boolean {
  return prefix.length <= changes.length && prefix.every((c, k) => sameTileChange(c, changes[k]));
}

function changedBase(t: TacticalState, c: TileChangeView, def: StructureDef): StructureInstance | null {
  const at = t.world.structures.at(c.gridNo);
  return at.find((s) => has(s.flags, StructureFlags.BASE_TILE) && s.def === def && idiv(s.cubeOffset, PROFILE_Z_SIZE) === c.level) ?? null;
}

function applyTileChange(t: TacticalState, c: TileChangeView): boolean {
  const te = t.world.tiles?.[c.tile];
  if (!te?.structure || changesObjectLayer(c)) return false;
  if (c.kind !== 'remove') return t.world.structures.add(c.gridNo, c.level, te.structure, undefined, te.structureFile) !== null;
  const base = changedBase(t, c, te.structure);
  if (base) t.world.structures.remove(base);
  return base !== null;
}

function projectedExitGrid(v: AddedExitGridView): AddedExitGrid {
  return { mapIndex: v.gridNo, gridNo: ARRIVAL_NOT_SHOWN, sector: v.sector === null ? NO_SECTOR : sectorFromName(v.sector) };
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
  readonly #containers: readonly number[];
  readonly #mapDoors: ReadonlyMap<number, MapDoor>;
  readonly #projectedMapDoors: Map<number, MapDoor>;
  readonly #loadedOpenDoors: ReadonlySet<number>;
  readonly #loadedOpenContainers: ReadonlySet<number>;
  readonly #mapExitGrids: ReadonlySet<number>;
  #tileChanges: readonly TileChangeView[] = NO_TILE_CHANGES;
  #exitGridsKey = '';
  #placed: Soldier[] = [];
  #lightKey = '';
  #corpseKey = '';
  #corpseBases: StructureInstance[] = [];

  constructor(world: TacticalWorld, content: TacticalContent) {
    this.mapPath = world.mapPath;
    this.#world = world;
    this.#mapDoors = new Map(world.map.doors.map((d) => [d.gridNo, d]));
    this.#projectedMapDoors = new Map(this.#mapDoors);
    this.state = createTacticalState({ ...world, mapDoors: this.#projectedMapDoors }, content, Rng.fromSeed(PROJECTION_SEED));
    this.#doors = doorGridNos(world);
    this.#containers = containerGridNos(world);
    this.#loadedOpenDoors = new Set(this.#doors.filter((g) => isDoorOpenAt(this.state, g)));
    this.#loadedOpenContainers = new Set(this.#containers.filter((g) => isOpenableOpenAt(this.state, g)));
    this.#mapExitGrids = new Set(world.exitGrids);
  }

  follows(changes: readonly TileChangeView[]): boolean {
    return startsWith(changes, this.#tileChanges);
  }

  sync(view: KnowledgeView, guard: GuardOptions): TacticalState {
    const t = this.state;
    t.inCombat = view.combat !== null && view.combat !== undefined;
    t.sector = view.strategic?.worldSector ? sectorFromName(view.strategic.worldSector) : null;
    this.#liftSoldiers();
    this.#syncTileChanges(view.tileChanges ?? NO_TILE_CHANGES);
    this.#syncDoors(view, guard);
    this.#syncExitGrids(view.addedExitGrids ?? NO_EXIT_GRIDS);
    this.#syncSoldiers(view.soldiers, guard);
    this.#syncItems(view, guard);
    setKnownMines(t, view.knownMines ?? []);
    this.#syncLight(view);
    this.#syncSmoke(view);
    this.#syncCorpses(view.corpses ?? []);
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

  #syncTileChanges(changes: readonly TileChangeView[]): void {
    const t = this.state;
    const applied = this.#tileChanges.length;
    if (changes.length === applied) return;
    this.#liftCorpses();
    this.#swapOpenables(this.#loadedOpenDoors, this.#loadedOpenContainers);
    const touched = new Set<number>();
    for (const c of changes.slice(applied)) if (applyTileChange(t, c)) touched.add(c.gridNo);
    for (const g of touched) recompileLocalMovementCosts(t.world.costs, t.world, g);
    this.#tileChanges = changes;
  }

  #syncExitGrids(views: readonly AddedExitGridView[]): void {
    const key = JSON.stringify(views);
    if (key === this.#exitGridsKey) return;
    this.#exitGridsKey = key;
    this.#liftCorpses();
    const t = this.state;
    const touched = new Set(t.addedExitGrids.map((e) => e.mapIndex));
    for (const g of touched) if (!this.#mapExitGrids.has(g)) t.world.exitGrids.delete(g);
    t.addedExitGrids.length = 0;
    for (const v of views) {
      addExitGridToWorld(t, projectedExitGrid(v));
      touched.add(v.gridNo);
    }
    for (const g of touched) recompileLocalMovementCosts(t.world.costs, t.world, g);
  }

  #swapOpenables(openDoors: ReadonlySet<number>, openContainers: ReadonlySet<number>): void {
    const t = this.state;
    for (const g of this.#doors) {
      if (openDoors.has(g) === isDoorOpenAt(t, g)) continue;
      const door = t.world.structures.find(g, StructureFlags.ANYDOOR);
      const swapped = door ? swapStructureForPartner(t, door) : null;
      if (swapped) recompileLocalMovementCosts(t.world.costs, t.world, g);
    }
    for (const g of this.#containers) {
      if (openContainers.has(g) === isOpenableOpenAt(t, g)) continue;
      const container = t.world.structures.find(g, StructureFlags.OPENABLE);
      const swapped = container ? swapStructureForPartner(t, container) : null;
      if (swapped) recompileLocalMovementCosts(t.world.costs, t.world, g);
    }
  }

  #syncDoors(view: KnowledgeView, guard: GuardOptions): void {
    this.#swapOpenables(new Set(view.openDoors ?? []), new Set(view.openContainers ?? []));
    const known = new Map((view.doors ?? []).map((d) => [d.gridNo, d]));
    for (const [g, door] of this.#mapDoors) this.#projectedMapDoors.set(g, projectedDoor(door, known.get(g), guard));
  }

  #liftSoldiers(): void {
    for (const s of this.#placed) removeMercStructure(this.state, s);
    this.#placed = [];
  }

  #syncSoldiers(views: readonly KnowledgeSoldier[], guard: GuardOptions): void {
    const t = this.state;
    t.soldiers.length = 0;
    t.mercSlots.length = 0;
    clearOccupants(t);
    const ours = t.perception.publicOpp[Team.OUR];
    ours?.fill(Opp.NOT_HEARD_OR_SEEN);
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
    }
  }

  #syncItems(view: KnowledgeView, guard: GuardOptions): void {
    const t = this.state;
    t.worldItems.length = 0;
    (view.items ?? []).forEach((v, k) => {
      t.worldItems.push(worldItemFromView(t.content.items, v, `item ${k}`, guard));
    });
  }

  #syncSmoke(view: KnowledgeView): void {
    const t = this.state;
    const tiles = t.explosives.smokeTiles;
    for (const level of tiles) level.fill(0);
    smokeChanged(t);
    for (const tile of view.smoke ?? []) {
      const type = smokeTypeOf(t, tile.effect);
      if (type) setSmokeFlagsAt(t, tile.gridNo, tile.level, smokeTileFlag(type));
    }
  }

  #liftCorpses(): void {
    for (const base of this.#corpseBases) this.state.world.structures.remove(base);
    this.#corpseBases = [];
    this.#corpseKey = '';
  }

  #syncCorpses(corpses: readonly KnowledgeCorpse[]): void {
    const t = this.state;
    const key = corpses.map((c) => `${c.gridNo},${c.level},${c.type},${c.direction}`).join(';');
    if (key === this.#corpseKey) return;
    this.#liftCorpses();
    this.#corpseKey = key;
    for (const c of corpses) {
      const def = corpseStructureDef(t, c.type, c.direction);
      const base = def ? t.world.structures.add(c.gridNo, c.level, def) : null;
      if (base) this.#corpseBases.push(base);
    }
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

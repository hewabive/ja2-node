import type { BasicPlacement } from '../../src/content/formats/map.ts';
import { parseSectorString, type Sector } from '../../src/content/strategic/sector-ids.ts';
import { Direction, gridNo } from '../../src/content/world/grid.ts';
import { createCampaignSession } from '../../src/server/campaign-factory.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { getGroup, removeGroup, setGroupSectorValue } from '../../src/sim/strategic/forces/groups.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { createFromPlacementParts } from '../../src/sim/tactical/creation.ts';
import { NEUTRAL_POPULATION, soldierSlotTaken } from '../../src/sim/tactical/init-list.ts';
import { addSoldierToSector, Insertion } from '../../src/sim/tactical/insertion.ts';
import { Attitude, type Body, firstFreeSoldierId, Orders, type Soldier, SoldierClass } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import type { RunMode } from './reload.ts';
import type { StubSectorKit } from './sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from './session-reload.ts';

const STUB_MAP_ORIGIN = 66;

export const HUMMER_SECTOR = 'L10';
export const PROF_HUMMER = 160;
export const HUMMER_GRIDNO = gridNo(STUB_MAP_ORIGIN + 17, STUB_MAP_ORIGIN + 9);
export const HUMMER_DIRECTION = Direction.WEST;
export const HUMMER_ARRIVAL_GRIDNO = gridNo(STUB_MAP_ORIGIN + 8, STUB_MAP_ORIGIN + 9);

const APPROACH = 'L9';
const START = 'A9';
const QUIET = [START, APPROACH, HUMMER_SECTOR];
const LANDING_COMPRESSION = 2;
const ROUTE_BUDGET = 10;
const ROUTE_SLICE_SECONDS = 6 * 3600;
const AVERAGE_LEVEL = 2;

function quietSector(session: CampaignSession, name: string): void {
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
}

function removeEnemyGroups(session: CampaignSession): void {
  const ctx = session.campaign.strategic;
  if (!ctx) throw new Error('no strategic layer');
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
}

function teleportSquad(session: CampaignSession, sector: Sector): void {
  const campaign = session.campaign;
  const ctx = campaign.strategic;
  if (!ctx || !campaign.battle) throw new Error('no strategic layer');
  for (const m of campaign.battle.roster.all()) {
    const group = getGroup(ctx, m.groupId);
    if (group) setGroupSectorValue(ctx, sector, group);
    m.sector = { ...sector };
  }
}

async function dispatchPrepared(session: CampaignSession, cmd: { readonly type: string; readonly [key: string]: unknown }): Promise<void> {
  await session.prepare(cmd);
  const result = session.dispatch(cmd);
  if (!result.ok) throw new Error(`${cmd.type} refused: ${result.reason}`);
}

export async function stubCampaignAtTheHummer(kit: StubSectorKit, seed: number, mode?: RunMode, mercs = 2): Promise<CampaignSession> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs, land: false });
  const session = drivenSession(created, stubSessionSources(kit), mode);
  for (const name of QUIET) quietSector(session, name);
  removeEnemyGroups(session);
  await dispatchPrepared(session, { type: 'compressTime', mode: LANDING_COMPRESSION });
  await dispatchPrepared(session, { type: 'mapScreen' });
  teleportSquad(session, parseSectorString(APPROACH));
  const first = session.view().strategic?.mercs[0];
  if (!first) throw new Error('no merc');
  await dispatchPrepared(session, { type: 'route', soldier: first.id, to: HUMMER_SECTOR });
  const live = new ReloadingSession('hummer', session);
  const arrived = () => session.view().strategic?.mercs.every((m) => m.sector === HUMMER_SECTOR && !m.betweenSectors) === true;
  for (let k = 0; k < ROUTE_BUDGET && !arrived(); k++) live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  if (!arrived()) throw new Error(`the squad did not reach ${HUMMER_SECTOR}`);
  await dispatchPrepared(session, { type: 'enterSector', sector: HUMMER_SECTOR });
  return session;
}

export interface StubTankOrder {
  readonly body: typeof Body.TANK_NW | typeof Body.TANK_NE;
  readonly team: number;
  readonly gridNo: number;
  readonly direction: number;
  readonly soldierClass?: number;
}

function tankPlacement(order: StubTankOrder): BasicPlacement {
  return {
    detailed: false,
    startingGridNo: order.gridNo,
    team: order.team,
    relativeAttributeLevel: AVERAGE_LEVEL,
    relativeEquipmentLevel: AVERAGE_LEVEL,
    direction: order.direction,
    orders: Orders.STATIONARY,
    attitude: Attitude.DEFENSIVE,
    bodyType: order.body,
    patrolGrid: [order.gridNo],
    patrolCount: 0,
    onRoof: false,
    soldierClass: order.soldierClass ?? SoldierClass.ARMY,
    civilianGroup: 0,
    priorityExistence: true,
    hasKeys: 0,
  };
}

export function addStubTank(t: TacticalState, order: StubTankOrder): Soldier {
  const id = firstFreeSoldierId((n) => soldierSlotTaken(t, n), order.team, order.body);
  const tank = id < 0 ? null : createFromPlacementParts(t, id, tankPlacement(order), null, NEUTRAL_POPULATION);
  if (!tank) throw new Error(`no soldier slot for a tank on team ${order.team}`);
  tank.insertionGridNo = order.gridNo;
  const placed = addSoldierToSector(t, tank, { code: Insertion.GRIDNO, data: order.gridNo, direction: order.direction }, {}, false);
  if (!placed) throw new Error(`the tank found no place near ${order.gridNo}`);
  return tank;
}

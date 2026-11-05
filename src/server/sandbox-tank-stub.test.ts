import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tacticalOf, untilOurTurn } from '../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { addStubTank } from '../../tests/support/vehicles.ts';
import { AmmoType } from '../content/items/items.ts';
import { Direction, WORLD_COLS } from '../content/world/grid.ts';
import type { SimEvent } from '../sim/events.ts';
import { createItem } from '../sim/items/object.ts';
import { NO_VEHICLE } from '../sim/strategic/forces/constants.ts';
import { InvSlot } from '../sim/tactical/inventory.ts';
import { AP_LIMITS } from '../sim/tactical/points.ts';
import { Body, type Soldier, Team } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
import { createSandboxSession } from './sandbox.ts';
import { Session } from './session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const SEED = 1;
const TANK_ROWS_SOUTH = 10;

async function sandboxWithATank(): Promise<{ session: Session; merc: Soldier; tank: Soldier }> {
  const session = new Session('tank', await createSandboxSession(kit.read, false, SEED));
  const sim = tacticalOf(session);
  const t = sim.state;
  const merc = teamMembers(t, Team.OUR)[0];
  if (!merc) throw new Error('no merc in the sandbox');
  const tank = addStubTank(t, {
    body: Body.TANK_NW,
    team: Team.ENEMY,
    gridNo: merc.gridNo + TANK_ROWS_SOUTH * WORLD_COLS,
    direction: Direction.NORTH,
  });
  const rifle = createItem(t.content.items, t.content.items.byName.get('ROCKET_RIFLE')?.index ?? 0, 100);
  rifle.gunAmmoType = AmmoType.HEAT;
  rifle.imprintId = merc.profile;
  merc.inv[InvSlot.HAND] = rifle;
  sim.lookAround();
  return { session, merc, tank };
}

function itemIndex(session: Session, name: string): number {
  return tacticalOf(session).state.content.items.byName.get(name)?.index ?? -1;
}

describe('a tank in the stub sandbox', () => {
  it('takes damage from a HEAT rocket, then starts its turn with the vehicle maximum of 50 APs and fires its cannon at the squad', async () => {
    const { session, merc, tank } = await sandboxWithATank();
    expect(tank.vehicleId).not.toBe(NO_VEHICLE);
    const before = tank.life;
    expect(session.dispatch({ type: 'attack', soldier: merc.id, target: tank.gridNo })).toEqual({ ok: true });
    session.advance({ idle: true });
    expect(tank.life).toBeLessThan(before);
    expect(tacticalOf(session).state.inCombat).toBe(true);
    expect(session.dispatch({ type: 'endTurn' }).ok).toBe(true);
    const events: readonly SimEvent[] = session.advance({ idle: true }).events;
    untilOurTurn(session);
    expect(tank.initialActionPoints).toBe(AP_LIMITS.VEHICLE_MAXIMUM);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'shotFired', soldier: tank.id, item: itemIndex(session, 'TANK_CANNON') }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'explosion', item: itemIndex(session, 'TANK_SHELL'), owner: tank.id }));
  });
});

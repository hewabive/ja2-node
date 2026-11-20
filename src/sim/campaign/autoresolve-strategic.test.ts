import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, FakeCrew, loadEconomyTestContent, setTownNames } from '../../../tests/support/economy.ts';
import { testContext } from '../../../tests/support/strategic.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { type Sector, sectorId, strategicIndex } from '../../content/strategic/sector-ids.ts';
import { EnemyKilled } from '../strategic/ai/status.ts';
import { Town } from '../strategic/economy/constants.ts';
import { createEconomyContext } from '../strategic/economy/context.ts';
import { setTownLoyalty } from '../strategic/economy/loyalty.ts';
import type { EconomyContext } from '../strategic/economy/ports.ts';
import { createNewEnemyGroupDepartingFromSector } from '../strategic/forces/groups.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { autoresolveCreation, eliminateAllEnemies } from './autoresolve-strategic.ts';

let content: EconomyTestContent;

beforeAll(async () => {
  content = await loadEconomyTestContent();
});

const OMERTA: Sector = { x: 9, y: 1, z: 0 };
const START_LOYALTY = 50;

function economy(): EconomyContext {
  const crew = new FakeCrew();
  const strategic = testContext({ content: content.strategic, mercs: crew });
  const ctx = createEconomyContext(strategic, { economy: content.economy, items: content.items, crew });
  crew.economy = ctx;
  setTownNames(ctx);
  return ctx;
}

describe('eliminateAllEnemies (Auto_Resolve.cc EliminateAllEnemies)', () => {
  it('credits every enemy as killed in autoresolve and the battle as won when no autoresolve is open', () => {
    const ctx = economy();
    setTownLoyalty(ctx, Town.OMERTA, START_LOYALTY);
    const element = ctx.state.map.elements[strategicIndex(OMERTA)];
    if (element) element.enemyControlled = false;
    const garrison = sectorInfo(ctx.state.map, OMERTA);
    garrison.numAdmins = 1;
    garrison.numTroops = 2;
    createNewEnemyGroupDepartingFromSector(ctx, sectorId(OMERTA), 0, 1, 1);
    eliminateAllEnemies(ctx, OMERTA, null);
    const [admins, troops, elites] = [0, 1, 2];
    const inAutoresolve = ctx.state.status.enemiesKilled[EnemyKilled.IN_AUTO_RESOLVE];
    expect([inAutoresolve?.[admins], inAutoresolve?.[troops], inAutoresolve?.[elites]]).toEqual([1, 3, 1]);
    expect(ctx.state.status.enemiesKilled[EnemyKilled.TOTAL]).toEqual(inAutoresolve);
    expect(ctx.state.economy.towns[Town.OMERTA]?.rating).toBeGreaterThan(START_LOYALTY);
    expect([garrison.numAdmins, garrison.numTroops]).toEqual([0, 0]);
    expect(ctx.state.forces.groups.filter((g) => !g.player)).toEqual([]);
  });
});

describe("the location gear of autoresolve's soldiers (Inventory_Choosing.cc:1195, :1431)", () => {
  const TIXA: Sector = { x: 9, y: 10, z: 0 };

  it('reads enemy-held Tixa off the loaded world, whatever sector the battle is in', async () => {
    const ctx = economy();
    const ar = { economy: ctx, queen: null, content: await loadTestContent() };
    const heldInTixa = () => autoresolveCreation(ar, OMERTA).population.inEnemyHeldTixa;
    const tixa = ctx.state.map.elements[strategicIndex(TIXA)];
    if (!tixa) throw new Error('no Tixa');
    tixa.enemyControlled = true;
    ctx.state.worldSector = { ...TIXA };
    expect(heldInTixa()).toBe(true);
    ctx.state.worldSector = { ...OMERTA };
    expect(heldInTixa()).toBe(false);
    ctx.state.worldSector = { ...TIXA };
    tixa.enemyControlled = false;
    expect(heldInTixa()).toBe(false);
  });
});

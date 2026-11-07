import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { knowledgeOf, newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { spawnCreature } from '../../../tests/support/creatures.ts';
import { objectOf } from '../../../tests/support/explosives.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import type { CommandResult } from '../command.ts';
import { answerHint } from '../hints/answer.ts';
import type { PreviewAction } from '../hints/preview-action.ts';
import type { PreviewMove } from '../hints/preview-move.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { isDoorOpenAt, swapStructureForPartner } from '../tactical/doors.ts';
import { explosiveDamageGridNo } from '../tactical/explosions/structure-damage.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { calcActionPoints } from '../tactical/points.ts';
import { Body, Personality, type Soldier, Team } from '../tactical/soldier.ts';
import { TacticalSim } from '../tactical/tactical-sim.ts';
import { type KnowledgeRules, knowledgeRules, knowledgeWorld } from './knowledge-world.ts';
import { knowledgeViewOf } from './sim-view.ts';
import type { KnowledgeStrategic } from './view.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_PROFILE = 5;
const MERC_ID = 0;
const CREATURE_ID = 30;

function phobicMerc(sim: TacticalSim, trait: number): Soldier {
  const merc = spawnSoldier(sim, MERC_ID, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
  merc.personalityTrait = trait;
  return merc;
}

function projectedTurnAPs(sim: TacticalSim, strategic?: Partial<KnowledgeStrategic>): number {
  const tactical = knowledgeOf(sim, strategic ? { strategic: strategic as KnowledgeStrategic } : {}).tactical;
  const merc = tactical?.ownSoldier(MERC_ID);
  if (!tactical || !merc) throw new Error('no projected merc');
  return calcActionPoints(tactical.state, merc);
}

describe('the tactical projection of the hints', () => {
  it("takes the loaded sector from the strategic view, so a claustrophobe's turn APs match the server's underground", () => {
    const sim = newCombatSim(content);
    sim.state.sector = { x: 9, y: 1, z: 1 };
    const merc = phobicMerc(sim, Personality.CLAUSTROPHOBIC);
    const server = calcActionPoints(sim.state, merc);
    expect(server).toBeLessThan(calcActionPoints({ sector: null, soldiers: sim.state.soldiers }, merc));
    expect(projectedTurnAPs(sim, { worldSector: 'A9-1' })).toBe(server);
  });

  it("takes an own merc's seen opponents from the view, so an insect-phobic merc's turn APs match the server's", () => {
    const sim = newCombatSim(content);
    const merc = phobicMerc(sim, Personality.FEAR_OF_INSECTS);
    spawnCreature(sim, CREATURE_ID, Body.YAM_MONSTER, gridNo(80, 86), Direction.NORTH);
    sim.lookAround();
    const server = calcActionPoints(sim.state, merc);
    expect(server).toBeLessThan(calcActionPoints({ sector: null, soldiers: [] }, merc));
    expect(projectedTurnAPs(sim)).toBe(server);
  });
});

describe("the view's structure changes in the projection of the hints", () => {
  const VILLAGE = 'stubs/world/maps/village.dat';
  const FENCE = gridNo(108, 74);
  const BESIDE_FENCE = gridNo(108, 73);
  const PAST_THE_FENCE = gridNo(108, 75);
  const WALL = gridNo(123, 72);
  const SOUTH_OF_THE_WALL = gridNo(123, 74);
  const NORTH_OF_THE_WALL = gridNo(123, 71);
  const DOOR = 11429;
  const CUTTER = 0;
  const WALKER = 1;
  const WOUND = 200;
  const BLAST_CENTRE = 0;
  const NO_MULTI_FLAG = -1;

  let kit: StubSectorKit;

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  function village(): TacticalSim {
    const sim = new TacticalSim(kit.world(VILLAGE), kit.content, 5);
    const cutter = spawnSoldier(sim, CUTTER, Team.OUR, BESIDE_FENCE, Direction.SOUTH);
    cutter.inv[InvSlot.HAND] = objectOf(sim.state, 'WIRECUTTERS');
    spawnSoldier(sim, WALKER, Team.OUR, SOUTH_OF_THE_WALL, Direction.NORTH);
    return sim;
  }

  function rulesOverVillage(): KnowledgeRules {
    return knowledgeRules(kit.content, { world: () => kit.world(VILLAGE) });
  }

  function hint(sim: TacticalSim, rules: KnowledgeRules, type: string, cmd: Readonly<Record<string, unknown>>): CommandResult {
    return answerHint(knowledgeWorld(knowledgeViewOf(sim), rules, { strict: true }), { type, ...cmd });
  }

  function cutterHint(sim: TacticalSim, rules: KnowledgeRules): PreviewAction {
    return hint(sim, rules, 'previewAction', { soldier: CUTTER, kind: 'cutFence', gridNo: FENCE }).data as PreviewAction;
  }

  function walk(sim: TacticalSim, rules: KnowledgeRules, soldier: number, to: number): number[] {
    return (hint(sim, rules, 'previewMove', { soldier, to }).data as PreviewMove).steps.map((step) => step.gridNo);
  }

  function blast(sim: TacticalSim, g: number): void {
    explosiveDamageGridNo(sim.state, g, WOUND, BLAST_CENTRE, false, NO_MULTI_FLAG, null, 0, { gridNos: new Set() });
  }

  it('sees a cut fence: the wire cutter hint refuses noFence and the walk goes through, in the projection that saw the fence and in a fresh one', () => {
    const sim = village();
    const rules = rulesOverVillage();
    expect(cutterHint(sim, rules)).toMatchObject({ ok: true });
    expect(walk(sim, rules, CUTTER, PAST_THE_FENCE)).not.toContain(FENCE);
    expect(sim.dispatch({ type: 'cutFence', soldier: CUTTER, gridNo: FENCE })).toEqual({ ok: true });
    runUntilIdle(sim);
    for (const seen of [rules, rulesOverVillage()]) {
      expect(cutterHint(sim, seen)).toMatchObject({ ok: false, refusal: 'noFence' });
      expect(walk(sim, seen, CUTTER, PAST_THE_FENCE)).toContain(FENCE);
    }
  });

  it('sees a blown wall: the walk goes through the gap', () => {
    const sim = village();
    const rules = rulesOverVillage();
    expect(walk(sim, rules, WALKER, NORTH_OF_THE_WALL)).not.toContain(WALL);
    blast(sim, WALL);
    expect(sim.state.world.structures.find(WALL, StructureFlags.WALL)).toBeNull();
    for (const seen of [rules, rulesOverVillage()]) expect(walk(sim, seen, WALKER, NORTH_OF_THE_WALL)).toContain(WALL);
  });

  it('takes out a door blown while the view showed it open, whose removal names the door as the map placed it', () => {
    const sim = village();
    const rules = rulesOverVillage();
    const door = sim.state.world.structures.find(DOOR, StructureFlags.ANYDOOR);
    if (!door) throw new Error('no stub door');
    swapStructureForPartner(sim.state, door);
    const opened = knowledgeWorld(knowledgeViewOf(sim), rules, { strict: true }).tactical;
    expect(opened && isDoorOpenAt(opened.state, DOOR)).toBe(true);
    blast(sim, DOOR);
    expect(sim.state.world.structures.find(DOOR, StructureFlags.ANYDOOR)).toBeNull();
    const blown = knowledgeWorld(knowledgeViewOf(sim), rules, { strict: true }).tactical;
    expect(blown?.state.world.structures.find(DOOR, StructureFlags.ANYDOOR)).toBeNull();
  });

  it("starts a fresh projection when the view's structure changes do not extend those it replayed, as at a new entry to the sector", () => {
    const cut = village();
    const rules = rulesOverVillage();
    expect(cut.dispatch({ type: 'cutFence', soldier: CUTTER, gridNo: FENCE })).toEqual({ ok: true });
    runUntilIdle(cut);
    expect(cutterHint(cut, rules)).toMatchObject({ ok: false, refusal: 'noFence' });
    expect(cutterHint(village(), rules)).toMatchObject({ ok: true });
  });
});

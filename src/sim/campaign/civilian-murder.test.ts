import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { type EconomyTestContent, economyTestContext, loadEconomyTestContent, setTownNames } from '../../../tests/support/economy.ts';
import { testProfile } from '../../../tests/support/narrative.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { parseSectorString, strategicIndex } from '../../content/strategic/sector-ids.ts';
import { Town } from '../strategic/economy/constants.ts';
import { affectAllTownsLoyaltyByDistanceFrom, setTownLoyalty } from '../strategic/economy/loyalty.ts';
import type { EconomyContext } from '../strategic/economy/ports.ts';
import { ScriptedStream } from '../strategic/forces/autoresolve/replay-rng.ts';
import { initializeMapStructure } from '../strategic/map/init.ts';
import { setCivGroupHostility } from '../strategic/narrative/civ-groups.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { CivGroupHostility } from '../tactical/narrative/constants.ts';
import { Body, CivilianGroup, type Soldier, Team } from '../tactical/soldier.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { falseAccusalChance, handleMurderOfCivilian, murderWitnesses, Witnessed } from './civilian-murder.ts';

let tactical: TacticalContent;
let economy: EconomyTestContent;

beforeAll(async () => {
  [tactical, economy] = await Promise.all([loadTestContent(), loadEconomyTestContent()]);
});

const NORTH = 0;
const COLUMNS = 160;
const KILLER_AT = 80 * COLUMNS + 60;
const VICTIM_AT = KILLER_AT + 3;
const BOTH_IN_VIEW = KILLER_AT + 2 * COLUMNS + 1;
const FAR_EAST = KILLER_AT + 30;
const OUT_OF_SIGHT = KILLER_AT + 40 * COLUMNS;
const D13 = parseSectorString('D13');
const WILDERNESS = parseSectorString('A1');
const MAN_COST = 3500;
const DISTANCE_ZERO_DIVISOR = 175;
const PERCENT = 100;
const TOWN_DOESNT_CARE_ABOUT_DEATH = 0x40;
const DRASSEN_RATING = 40;

interface Scene {
  readonly sim: TacticalSim;
  readonly ctx: EconomyContext;
  readonly rolls: ScriptedStream;
  readonly morale: string[];
}

function scene(rolls: readonly number[] = []): Scene {
  const sim = newCombatSim(tactical);
  const stream = new ScriptedStream(rolls);
  const morale: string[] = [];
  const { ctx } = economyTestContext({
    content: economy,
    random: { int: (n) => stream.int(n), chance: (p) => stream.int(PERCENT) < p },
    setup: { hooks: { moraleEvent: (kind) => morale.push(kind) } },
  });
  initializeMapStructure(ctx);
  setTownNames(ctx);
  setTownLoyalty(ctx, Town.DRASSEN, DRASSEN_RATING);
  setTownLoyalty(ctx, Town.ALMA, DRASSEN_RATING);
  return { sim, ctx, rolls: stream, morale };
}

function setEnemyControlled(ctx: EconomyContext, enemy: boolean): void {
  const e = ctx.state.map.elements[strategicIndex(D13)];
  if (e) e.enemyControlled = enemy;
}

function killed(sim: TacticalSim, killer: Soldier, at = VICTIM_AT, body: number = Body.MANCIV, intended = true): Soldier {
  const victim = spawnSoldier(sim, 117, Team.CIV, at, NORTH);
  Object.assign(victim, { bodyType: body, attacker: killer, intendedTarget: intended, life: 0 });
  return victim;
}

function expectedTowns(change: number, enemyControlled = true) {
  const { ctx } = scene();
  setEnemyControlled(ctx, enemyControlled);
  if (change !== 0) affectAllTownsLoyaltyByDistanceFrom(ctx, change, D13);
  return ctx.state.economy.towns;
}

const distanceAdjusted = (change: number) => Math.trunc((change * PERCENT) / DISTANCE_ZERO_DIVISOR);

describe('HandleMurderOfCivilian', () => {
  it('costs the body price, spread over the towns by distance, and a morale event when our merc murders on purpose', () => {
    const { sim, ctx, rolls, morale } = scene();
    const victim = killed(sim, spawnSoldier(sim, 0, Team.OUR, KILLER_AT, NORTH));
    handleMurderOfCivilian(ctx, sim.state, victim, D13);
    expect(morale).toEqual(['KILLED_CIVILIAN']);
    expect(rolls.requested).toEqual([]);
    expect(ctx.state.economy.towns).toEqual(expectedTowns(distanceAdjusted(-MAN_COST)));
  });

  it('halves an unintended killing and takes the default cost for a body outside FATCIV..COW', () => {
    const accident = scene();
    const merc = spawnSoldier(accident.sim, 0, Team.OUR, KILLER_AT, NORTH);
    handleMurderOfCivilian(accident.ctx, accident.sim.state, killed(accident.sim, merc, VICTIM_AT, Body.MANCIV, false), D13);
    expect(accident.ctx.state.economy.towns).toEqual(expectedTowns(distanceAdjusted(-MAN_COST / 2)));
    const merc2 = scene();
    const killer = spawnSoldier(merc2.sim, 0, Team.OUR, KILLER_AT, NORTH);
    handleMurderOfCivilian(merc2.ctx, merc2.sim.state, killed(merc2.sim, killer, VICTIM_AT, Body.REGMALE), D13);
    expect(merc2.ctx.state.economy.towns).toEqual(expectedTowns(distanceAdjusted(-5000)));
  });

  it('blames the player falsely for an unseen enemy murder with a chance of 100 minus the town rating, at half the cost', () => {
    const { sim, ctx, rolls, morale } = scene([100 - DRASSEN_RATING - 1]);
    setEnemyControlled(ctx, false);
    handleMurderOfCivilian(ctx, sim.state, killed(sim, spawnSoldier(sim, 21, Team.ENEMY, KILLER_AT, NORTH)), D13);
    expect(rolls.requested).toEqual([PERCENT]);
    expect(morale).toEqual([]);
    expect(ctx.state.economy.towns).toEqual(expectedTowns(distanceAdjusted(-MAN_COST / 2), false));
  });

  it('holds the player responsible for a quarter of an enemy murder in a sector he controls', () => {
    const { sim, ctx } = scene([100 - DRASSEN_RATING]);
    setEnemyControlled(ctx, false);
    handleMurderOfCivilian(ctx, sim.state, killed(sim, spawnSoldier(sim, 21, Team.ENEMY, KILLER_AT, NORTH)), D13);
    expect(ctx.state.economy.towns).toEqual(expectedTowns(distanceAdjusted(-Math.trunc((MAN_COST * 25) / PERCENT)), false));
  });

  it('raises loyalty for an enemy murder in an enemy-controlled sector', () => {
    const { sim, ctx } = scene([99]);
    setEnemyControlled(ctx, true);
    handleMurderOfCivilian(ctx, sim.state, killed(sim, spawnSoldier(sim, 21, Team.ENEMY, KILLER_AT, NORTH)), D13);
    expect(ctx.state.economy.towns).toEqual(expectedTowns(distanceAdjusted(MAN_COST)));
  });

  it('still draws when witnesses saw everything, but never blames the player then', () => {
    const { sim, ctx, rolls } = scene([0]);
    setEnemyControlled(ctx, true);
    const enemy = spawnSoldier(sim, 21, Team.ENEMY, KILLER_AT, NORTH);
    spawnSoldier(sim, 118, Team.CIV, BOTH_IN_VIEW, NORTH);
    handleMurderOfCivilian(ctx, sim.state, killed(sim, enemy), D13);
    expect(rolls.requested).toEqual([PERCENT]);
    expect(ctx.state.economy.towns).toEqual(expectedTowns(distanceAdjusted(MAN_COST)));
  });

  it('cuts a rebel murder to 70 % unless the rebels hate the player, and doubles a monster murder', () => {
    const rebels = scene([99]);
    handleMurderOfCivilian(
      rebels.ctx,
      rebels.sim.state,
      killed(rebels.sim, spawnSoldier(rebels.sim, 85, Team.MILITIA, KILLER_AT, NORTH)),
      D13,
    );
    expect(rebels.ctx.state.economy.towns).toEqual(expectedTowns(distanceAdjusted(-Math.trunc((MAN_COST * 70) / PERCENT))));
    const hated = scene([99]);
    setCivGroupHostility(hated.ctx.state.civGroups, CivilianGroup.REBEL, CivGroupHostility.HOSTILE);
    handleMurderOfCivilian(hated.ctx, hated.sim.state, killed(hated.sim, spawnSoldier(hated.sim, 85, Team.MILITIA, KILLER_AT, NORTH)), D13);
    expect(hated.ctx.state.economy.towns).toEqual(expectedTowns(distanceAdjusted(-MAN_COST)));
    const monster = scene([99]);
    setEnemyControlled(monster.ctx, false);
    const creature = spawnSoldier(monster.sim, 53, Team.CREATURE, KILLER_AT, NORTH);
    creature.bodyType = Body.AM_MONSTER;
    handleMurderOfCivilian(monster.ctx, monster.sim.state, killed(monster.sim, creature), D13);
    expect(monster.ctx.state.economy.towns).toEqual(expectedTowns(distanceAdjusted(-2 * MAN_COST), false));
  });

  it('charges a creature that is no monster the full price as a loss, even in an enemy-controlled sector', () => {
    const { sim, ctx } = scene([99]);
    setEnemyControlled(ctx, true);
    const bloodcat = spawnSoldier(sim, 53, Team.CREATURE, KILLER_AT, NORTH);
    bloodcat.bodyType = Body.BLOODCAT;
    handleMurderOfCivilian(ctx, sim.state, killed(sim, bloodcat), D13);
    expect(ctx.state.economy.towns).toEqual(expectedTowns(distanceAdjusted(-MAN_COST)));
  });

  it('changes nothing for a civilian killer the town does not blame on the player', () => {
    const { sim, ctx, rolls } = scene([99]);
    handleMurderOfCivilian(ctx, sim.state, killed(sim, spawnSoldier(sim, 116, Team.CIV, KILLER_AT, NORTH)), D13);
    expect(rolls.requested).toEqual([PERCENT]);
    expect(ctx.state.economy.towns).toEqual(expectedTowns(0));
  });

  it('ignores militia victims, hostile civilian groups, NPCs the town does not care about and killings without a killer', () => {
    const { sim, ctx, rolls, morale } = scene();
    const merc = spawnSoldier(sim, 0, Team.OUR, KILLER_AT, NORTH);
    const militia = spawnSoldier(sim, 84, Team.MILITIA, VICTIM_AT, NORTH);
    Object.assign(militia, { attacker: merc, intendedTarget: true });
    handleMurderOfCivilian(ctx, sim.state, militia, D13);
    const goon = spawnSoldier(sim, 116, Team.CIV, VICTIM_AT + 1, NORTH);
    Object.assign(goon, { attacker: merc, civilianGroup: CivilianGroup.KINGPIN });
    handleMurderOfCivilian(ctx, sim.state, goon, D13);
    const npc = spawnSoldier(sim, 118, Team.CIV, VICTIM_AT + 2, NORTH, { profile: 70 });
    sim.state.profiles.set(70, testProfile(70, { miscFlags3: TOWN_DOESNT_CARE_ABOUT_DEATH }));
    npc.attacker = merc;
    handleMurderOfCivilian(ctx, sim.state, npc, D13);
    handleMurderOfCivilian(ctx, sim.state, spawnSoldier(sim, 119, Team.CIV, VICTIM_AT + 3, NORTH), D13);
    expect(morale).toEqual([]);
    expect(rolls.requested).toEqual([]);
    expect(ctx.state.economy.towns).toEqual(expectedTowns(0));
  });

  it('runs the morale event but changes no loyalty outside a loyalty town', () => {
    const { sim, ctx, morale } = scene();
    handleMurderOfCivilian(ctx, sim.state, killed(sim, spawnSoldier(sim, 0, Team.OUR, KILLER_AT, NORTH)), WILDERNESS);
    expect(morale).toEqual(['KILLED_CIVILIAN']);
    expect(ctx.state.economy.towns).toEqual(expectedTowns(0));
  });
});

describe('the civilian witnesses of a murder', () => {
  it('tells which of the killer and the victim the other civilians saw within 13 tiles', () => {
    const { sim } = scene();
    const killer = spawnSoldier(sim, 21, Team.ENEMY, KILLER_AT, NORTH);
    const victim = killed(sim, killer, FAR_EAST);
    expect(murderWitnesses(sim.state, victim, killer)).toBe(Witnessed.NOTHING);
    const nearKiller = spawnSoldier(sim, 118, Team.CIV, KILLER_AT - 2, NORTH);
    expect(murderWitnesses(sim.state, victim, killer)).toBe(Witnessed.KILLER);
    Object.assign(nearKiller, { placed: false });
    spawnSoldier(sim, 119, Team.CIV, FAR_EAST + 2, NORTH);
    spawnSoldier(sim, 120, Team.CIV, OUT_OF_SIGHT, NORTH);
    expect(murderWitnesses(sim.state, victim, killer)).toBe(Witnessed.VICTIM);
    Object.assign(nearKiller, { placed: true });
    expect(murderWitnesses(sim.state, victim, killer)).toBe(Witnessed.EVERYTHING);
  });

  it('maps the seen state to the false accusal chance', () => {
    expect([Witnessed.NOTHING, Witnessed.KILLER, Witnessed.VICTIM, Witnessed.EVERYTHING].map((s) => falseAccusalChance(s, 30))).toEqual([
      70, 10, 50, 0,
    ]);
  });
});

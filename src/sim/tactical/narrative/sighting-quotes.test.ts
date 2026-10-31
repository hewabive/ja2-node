import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { EnemySightedEvent } from '../../events.ts';
import { ProfileFlag } from '../../narrative/narrative-ids.ts';
import type { TacticalContent } from '../content.ts';
import { Opp, SeenCreature } from '../perception/opp.ts';
import { handleSight, ourTeamRadiosRandomlyAbout, radioSightings } from '../perception/sight.ts';
import { Body, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { enterCombatMode, selectSoldier } from '../turns/turns.ts';
import { MercQuote, QuoteSaidFlag } from './merc-quotes.ts';
import type { QuoteSaidRecord } from './port.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SPOTTER = 4;
const SECOND_MERC = 5;
const SPOTTER_AT = gridNo(80, 80);
const FOES_AT = gridNo(80, 120);
const ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY];
const CREATURE_ID = TEAM_FIRST_ID[Team.CREATURE];
const BATTLE_SOUND_ROLL = 29;
const LINE_ROLL = 30;
const NO_SIGHT_FLAGS = 0;

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly spotter: Soldier;
  readonly said: [number, number][];
  readonly draws: number[];
  readonly script: number[];
  readonly flags: Map<number, QuoteSaidRecord>;
  readonly menusClosed: number[];
}

function scene(withContent: TacticalContent = content): Scene {
  const sim = newCombatSim(withContent);
  const t = sim.state;
  t.profiles.set(SPOTTER, testProfile(SPOTTER));
  const spotter = spawnSoldier(sim, 0, Team.OUR, SPOTTER_AT, Direction.SOUTH, { profile: SPOTTER });
  const said: [number, number][] = [];
  const flags = new Map<number, QuoteSaidRecord>();
  const menusClosed: number[] = [];
  t.narrative = {
    ...t.narrative,
    sayQuote: (s, quote) => said.push([s.id, quote]),
    deleteTalkingMenu: () => menusClosed.push(t.events.length),
    quoteSaidFlags: (s) => {
      const record = flags.get(s.id) ?? { quoteSaidFlags: 0, quoteSaidExtFlags: 0 };
      flags.set(s.id, record);
      return record;
    },
  };
  const s: Scene = { sim, t, spotter, said, draws: [], script: [], flags, menusClosed };
  const rng = t.rng as unknown as { int(n: number): number };
  rng.int = (n: number) => {
    s.draws.push(n);
    const v = s.script.shift();
    if (v === undefined || v >= n) throw new Error(`unscripted draw of ${n}`);
    return v;
  };
  return s;
}

function laterSighting(s: Scene, rolls: readonly number[] = []): void {
  s.t.turn.virginSector = false;
  s.script.push(...rolls);
}

function foe(s: Scene, k = 0, body: number = Body.REGMALE, team: number = Team.ENEMY): Soldier {
  const id = (team === Team.ENEMY ? ENEMY_ID : CREATURE_ID) + k;
  return spawnSoldier(s.sim, id, team, FOES_AT + k * 2, Direction.NORTH, { body });
}

function sees(s: Scene, merc: Soldier, opponents: readonly Soldier[], publicly: number = Opp.NOT_HEARD_OR_SEEN): EnemySightedEvent[] {
  for (const o of opponents) {
    merc.oppList[o.id] = Opp.SEEN_CURRENTLY;
    const table = s.t.perception.publicOpp[Team.OUR];
    if (table) table[o.id] = publicly;
  }
  const before = s.t.events.length;
  radioSightings(s.t, merc, null, Team.OUR);
  return s.t.events.slice(before).filter((e): e is EnemySightedEvent => e.type === 'enemySighted');
}

function quoteFlags(s: Scene, merc: Soldier): number {
  return s.flags.get(merc.id)?.quoteSaidFlags ?? 0;
}

describe('the sighting quotes (OppList.cc OurTeamSeesSomeone, SaySeenQuote)', () => {
  it('says the variation line at the first sighting in the sector, closes the talk panel and ends the virgin sector, drawing nothing', () => {
    const s = scene();
    const [sighted] = sees(s, s.spotter, [foe(s)]);
    expect(s.said).toEqual([[s.spotter.id, MercQuote.SEE_ENEMY_VARIATION]]);
    expect(s.menusClosed).toHaveLength(1);
    expect([s.draws, s.t.turn.virginSector, sighted?.battleSound]).toEqual([[], false, undefined]);
  });

  it('draws Random(100) at a later sighting: below 30 the ENEMY battle sound instead of a line, else the see-enemy line', () => {
    const sound = scene();
    laterSighting(sound, [BATTLE_SOUND_ROLL]);
    const [sighted] = sees(sound, sound.spotter, [foe(sound)]);
    expect([sound.draws, sound.said, sighted?.battleSound]).toEqual([[100], [], 'ENEMY']);
    expect(sound.menusClosed).toEqual([]);
    const line = scene();
    laterSighting(line, [LINE_ROLL]);
    const [spoken] = sees(line, line.spotter, [foe(line)]);
    expect([line.draws, line.said, spoken?.battleSound]).toEqual([[100], [[line.spotter.id, MercQuote.SEE_ENEMY]], undefined]);
  });

  it('says the see-enemy line without a draw with data of a version other than English or Chinese', () => {
    const s = scene({ ...content, sightingBattleSound: false });
    laterSighting(s);
    sees(s, s.spotter, [foe(s)]);
    expect([s.draws, s.said]).toEqual([[], [[s.spotter.id, MercQuote.SEE_ENEMY]]]);
  });

  it('has a merc curse at an enemy seen again with none new, without a line or a draw, but not in a virgin sector', () => {
    const s = scene();
    laterSighting(s);
    const [cursed] = sees(s, s.spotter, [foe(s)], Opp.SEEN_LAST_TURN);
    expect([s.draws, s.said, cursed?.battleSound, cursed?.revealedEnemies]).toEqual([[], [], 'CURSE1', 1]);
    const virgin = scene();
    const [first] = sees(virgin, virgin.spotter, [foe(virgin)], Opp.SEEN_LAST_TURN);
    expect([virgin.said, first?.battleSound]).toEqual([[[virgin.spotter.id, MercQuote.SEE_ENEMY_VARIATION]], undefined]);
  });

  it('says nothing and draws nothing in a meanwhile, and still ends the virgin sector', () => {
    const s = scene();
    s.t.narrative = { ...s.t.narrative, inMeanwhile: () => true };
    sees(s, s.spotter, [foe(s)]);
    expect([s.draws, s.said, s.t.turn.virginSector]).toEqual([[], [], false]);
    const later = scene();
    later.t.narrative = { ...later.t.narrative, inMeanwhile: () => true };
    laterSighting(later);
    sees(later, later.spotter, [foe(later)]);
    expect([later.draws, later.said]).toEqual([[], []]);
  });
});

describe('the in-trouble quote (OppList.cc SaySeenQuote)', () => {
  function outnumbered(s: Scene, enemies: number): Soldier[] {
    const foes = Array.from({ length: enemies }, (_, k) => foe(s, k));
    s.spotter.ai.oppCount = enemies;
    return foes;
  }

  it('comes once per battle when the merc sees more than two opponents beyond the allies who see half the enemies, himself counted', () => {
    const s = scene();
    laterSighting(s, [LINE_ROLL]);
    const foes = outnumbered(s, 4);
    sees(s, s.spotter, foes);
    expect([s.draws, s.said]).toEqual([[], [[s.spotter.id, MercQuote.IN_TROUBLE_SLASH_IN_BATTLE]]]);
    expect(quoteFlags(s, s.spotter) & QuoteSaidFlag.IN_SHIT).toBe(QuoteSaidFlag.IN_SHIT);
    sees(s, s.spotter, foes);
    expect([s.draws, s.said.at(-1)]).toEqual([[100], [s.spotter.id, MercQuote.SEE_ENEMY]]);
    enterCombatMode(s.t, Team.OUR);
    expect(quoteFlags(s, s.spotter) & QuoteSaidFlag.IN_SHIT).toBe(0);
  });

  it('is not said when another ally sees half the enemies, nor with three opponents to one merc', () => {
    const s = scene();
    laterSighting(s, [LINE_ROLL, LINE_ROLL]);
    const foes = outnumbered(s, 4);
    const ally = spawnSoldier(s.sim, 1, Team.OUR, SPOTTER_AT + 2, Direction.SOUTH, { profile: SECOND_MERC });
    ally.ai.oppCount = 2;
    sees(s, s.spotter, foes);
    expect(s.said).toEqual([[s.spotter.id, MercQuote.SEE_ENEMY]]);
    const three = scene();
    laterSighting(three, [LINE_ROLL]);
    sees(three, three.spotter, outnumbered(three, 3));
    expect(three.said).toEqual([[three.spotter.id, MercQuote.SEE_ENEMY]]);
  });
});

describe('the creature sighting quotes (OppList.cc SaySeenQuote, RadioSightings)', () => {
  function creatures(s: Scene, n: number, body: number = Body.AM_MONSTER): Soldier[] {
    return Array.from({ length: n }, (_, k) => foe(s, k, body, Team.CREATURE));
  }

  function hasSeenCreatures(s: Scene): boolean {
    return ((s.t.profiles.get(SPOTTER)?.miscFlags ?? 0) & ProfileFlag.HAVESEENCREATURE) !== 0;
  }

  it('has a merc who never saw a creature say his first-time line and remember it, then the plain creature line', () => {
    const s = scene();
    laterSighting(s);
    const [first, second] = creatures(s, 2) as [Soldier, Soldier];
    sees(s, s.spotter, [first]);
    expect([s.draws, s.said, hasSeenCreatures(s)]).toEqual([[], [[s.spotter.id, MercQuote.FIRSTTIME_GAME_SEE_CREATURE]], true]);
    sees(s, s.spotter, [second]);
    expect(s.said.at(-1)).toEqual([s.spotter.id, MercQuote.SEE_CREATURE]);
  });

  it('says the many-creatures line once per battle for more than two creatures in sight', () => {
    const s = scene();
    s.t.profiles.set(SPOTTER, testProfile(SPOTTER, { miscFlags: ProfileFlag.HAVESEENCREATURE }));
    laterSighting(s);
    const pack = creatures(s, 3);
    sees(s, s.spotter, pack);
    expect(s.said).toEqual([[s.spotter.id, MercQuote.ATTACKED_BY_MULTIPLE_CREATURES]]);
    sees(s, s.spotter, pack);
    expect(s.said.at(-1)).toEqual([s.spotter.id, MercQuote.SEE_CREATURE]);
    enterCombatMode(s.t, Team.OUR);
    expect(quoteFlags(s, s.spotter) & QuoteSaidFlag.MULTIPLE_CREATURES).toBe(0);
    sees(s, s.spotter, pack);
    expect(s.said.at(-1)).toEqual([s.spotter.id, MercQuote.ATTACKED_BY_MULTIPLE_CREATURES]);
  });

  it('says the bloodcat line for a bloodcat, also in a virgin sector', () => {
    const s = scene();
    sees(s, s.spotter, [foe(s, 0, Body.BLOODCAT, Team.CREATURE)]);
    expect([s.draws, s.said]).toEqual([[], [[s.spotter.id, MercQuote.SPOTTED_BLOODCAT]]]);
  });

  it('gives a merc who never saw a creature his first-time line for one the team already knows, with nobody new to report', () => {
    const s = scene();
    const known = creatures(s, 1);
    expect(sees(s, s.spotter, known, Opp.SEEN_CURRENTLY)).toEqual([]);
    expect([s.said, hasSeenCreatures(s), s.t.turn.virginSector]).toEqual([
      [[s.spotter.id, MercQuote.FIRSTTIME_GAME_SEE_CREATURE]],
      true,
      true,
    ]);
  });

  it('keeps the creature mark of the last look for a radio outside a look: a soldier seen next draws the creature line', () => {
    const s = scene();
    s.t.profiles.set(SPOTTER, testProfile(SPOTTER, { miscFlags: ProfileFlag.HAVESEENCREATURE }));
    laterSighting(s, [0]);
    sees(s, s.spotter, creatures(s, 1));
    const soldier = foe(s);
    s.spotter.oppList[soldier.id] = Opp.SEEN_CURRENTLY;
    ourTeamRadiosRandomlyAbout(s.t, soldier);
    expect(s.said).toEqual([
      [s.spotter.id, MercQuote.SEE_CREATURE],
      [s.spotter.id, MercQuote.SEE_CREATURE],
    ]);
    expect(s.draws).toEqual([1]);
    handleSight(s.t, s.spotter, NO_SIGHT_FLAGS);
    expect(s.t.perception.playerTeamSawCreatures).toBe(SeenCreature.NONE);
  });
});

describe('the end of a sighting (OppList.cc OurTeamSeesSomeone, Overhead.cc SetEnemyPresence)', () => {
  it('turns off our muzzle flashes when the selected merc sees someone on our turn in combat', () => {
    const s = scene();
    const shooter = spawnSoldier(s.sim, 1, Team.OUR, SPOTTER_AT + 2, Direction.SOUTH, { profile: SECOND_MERC });
    s.t.inCombat = true;
    s.t.turn.currentTeam = Team.OUR;
    selectSoldier(s.t, s.spotter);
    laterSighting(s, [LINE_ROLL]);
    shooter.muzzleFlash = true;
    sees(s, s.spotter, [foe(s)]);
    expect(shooter.muzzleFlash).toBe(false);
  });

  it('leaves the enemy presence unset when combat starts after a sighting ended the virgin sector', () => {
    const s = scene();
    let presence = 0;
    s.t.sectorHooks = { ...s.t.sectorHooks, enemyPresence: () => presence++ };
    sees(s, s.spotter, [foe(s)]);
    enterCombatMode(s.t, Team.OUR);
    expect([s.t.inCombat, s.t.turn.enemyInSector, presence]).toEqual([true, false, 0]);
    const virgin = scene();
    virgin.t.sectorHooks = { ...virgin.t.sectorHooks, enemyPresence: () => presence++ };
    foe(virgin);
    enterCombatMode(virgin.t, Team.OUR);
    expect([virgin.t.turn.enemyInSector, presence]).toEqual([true, 1]);
  });
});

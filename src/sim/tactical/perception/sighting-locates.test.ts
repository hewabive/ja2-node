import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { SoldierLocatedEvent } from '../../events.ts';
import type { TacticalContent } from '../content.ts';
import { Side, type Soldier, TEAM_FIRST_ID, Team, Visible } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { Caller, Opp } from './opp.ts';
import { manSeesMan, radioSightings } from './sight.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_AT = gridNo(80, 80);
const FOE_AT = gridNo(80, 90);
const ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY] ?? 20;
const MILITIA_ID = TEAM_FIRST_ID[Team.MILITIA] ?? 32;

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly merc: Soldier;
  readonly foe: Soldier;
}

function scene(): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
  const foe = spawnSoldier(sim, ENEMY_ID, Team.ENEMY, FOE_AT, Direction.NORTH);
  foe.visible = Visible.HIDDEN;
  t.narrative = { ...t.narrative, sayQuote: () => undefined, deleteTalkingMenu: () => undefined };
  return { sim, t, merc, foe };
}

function located(t: TacticalState): Omit<SoldierLocatedEvent, 'tick'>[] {
  return t.events.filter((e) => e.type === 'soldierLocated');
}

function turnsVisible(s: Scene, looker = s.merc): Omit<SoldierLocatedEvent, 'tick'>[] {
  manSeesMan(s.t, looker, s.foe, Caller.MANLOOKSFOROTHERTEAMS);
  expect(s.foe.visible).toBe(Visible.SEEN);
  return located(s.t);
}

const slideToFoe = (s: Scene) => [{ type: 'soldierLocated', soldier: s.foe.id, locator: 'normal', slide: true }];

describe('the slide to an opponent turning visible (OppList.cc ManSeesMan)', () => {
  it('slides to him with the locator in combat', () => {
    const s = scene();
    s.t.inCombat = true;
    s.t.turn.virginSector = false;
    expect(turnsVisible(s)).toEqual(slideToFoe(s));
  });

  it('slides to him out of combat only before the sector’s first sighting', () => {
    const first = scene();
    expect(turnsVisible(first)).toEqual(slideToFoe(first));
    const later = scene();
    later.t.turn.virginSector = false;
    expect(turnsVisible(later)).toEqual([]);
  });

  it('slides for a militia looker too', () => {
    const s = scene();
    s.t.inCombat = true;
    const militia = spawnSoldier(s.sim, MILITIA_ID, Team.MILITIA, MERC_AT + 2, Direction.SOUTH);
    expect(turnsVisible(s, militia)).toEqual(slideToFoe(s));
  });

  it('never slides to a neutral, to a soldier of the looker’s side or to one only out of sight for a moment', () => {
    const neutral = scene();
    neutral.foe.neutral = true;
    expect(turnsVisible(neutral)).toEqual([]);
    const friendly = scene();
    friendly.foe.side = friendly.merc.side;
    expect(turnsVisible(friendly)).toEqual([]);
    const limbo = scene();
    limbo.foe.visible = Visible.LIMBO;
    expect(turnsVisible(limbo)).toEqual([]);
  });
});

function sightedOnTheirTurn(s: Scene): Omit<SoldierLocatedEvent, 'tick'>[] {
  s.t.turn.currentTeam = Team.ENEMY;
  s.merc.oppList[s.foe.id] = Opp.SEEN_CURRENTLY;
  s.foe.visible = Visible.SEEN;
  s.foe.side = Side.ENEMY;
  radioSightings(s.t, s.merc, null, Team.OUR);
  return located(s.t);
}

describe('the locate and slide at an enemy sighted on their turn (OppList.cc OurTeamSeesSomeone)', () => {
  it('locates our merc with his locator, then slides to the enemy he sighted', () => {
    const s = scene();
    s.t.turn.virginSector = false;
    expect(sightedOnTheirTurn(s)).toEqual([{ type: 'soldierLocated', soldier: s.merc.id, locator: 'normal' }, ...slideToFoe(s)]);
    expect(s.t.turn.enemySightingOnTheirTurn?.enemy).toBe(s.foe);
  });

  it('does neither at the sector’s first sighting', () => {
    const s = scene();
    expect(sightedOnTheirTurn(s)).toEqual([]);
    expect(s.t.turn.virginSector).toBe(false);
  });

  it('does neither on our turn', () => {
    const s = scene();
    s.t.turn.virginSector = false;
    s.merc.oppList[s.foe.id] = Opp.SEEN_CURRENTLY;
    s.foe.visible = Visible.SEEN;
    radioSightings(s.t, s.merc, null, Team.OUR);
    expect(located(s.t)).toEqual([]);
  });

  it('locates our merc but slides to no enemy the squad no longer sees', () => {
    const s = scene();
    s.t.turn.virginSector = false;
    const gone = spawnSoldier(s.sim, ENEMY_ID + 1, Team.ENEMY, FOE_AT + 4, Direction.NORTH);
    gone.visible = Visible.HIDDEN;
    s.t.turn.enemySightingOnTheirTurn = { enemy: gone, since: s.t.clockMs };
    s.t.turn.currentTeam = Team.OUR;
    s.merc.oppList[s.foe.id] = Opp.SEEN_CURRENTLY;
    s.foe.visible = Visible.SEEN;
    radioSightings(s.t, s.merc, null, Team.OUR);
    expect(located(s.t)).toEqual([{ type: 'soldierLocated', soldier: s.merc.id, locator: 'normal' }]);
  });
});

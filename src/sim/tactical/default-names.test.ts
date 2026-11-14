import { describe, expect, it } from 'vitest';
import { defaultSoldierName, namedByTeam } from './default-names.ts';
import { Body, NO_PROFILE, SoldierClass, Team } from './soldier.ts';

const MARRIED_MERC = 'Flo';
const SOME_PROFILE = 57;

function soldier(team: number, soldierClass: number, bodyType: number, name = '', profile = NO_PROFILE) {
  return { team, soldierClass, bodyType, name, profile };
}

describe('the default names of TacticalCopySoldierFromCreateStruct', () => {
  it('names a soldier without a profile by his team, a miner by his class and a crow or a bloodcat by its body', () => {
    expect(
      [
        soldier(Team.ENEMY, SoldierClass.ELITE, Body.REGMALE),
        soldier(Team.MILITIA, SoldierClass.GREEN_MILITIA, Body.BIGMALE),
        soldier(Team.CIV, SoldierClass.NONE, Body.DRESSCIV),
        soldier(Team.CIV, SoldierClass.MINER, Body.MANCIV),
        soldier(Team.CIV, SoldierClass.NONE, Body.CROW),
        soldier(Team.CREATURE, SoldierClass.CREATURE, Body.AM_MONSTER),
        soldier(Team.CREATURE, SoldierClass.NONE, Body.BLOODCAT),
      ].map(defaultSoldierName),
    ).toEqual(['enemy', 'militia', 'civilian', 'miner', 'crow', 'creature', 'bloodcat']);
  });

  it('names no soldier of ours, no profile and no soldier who kept a name of his own: a merc married off as a civilian keeps his nickname', () => {
    expect(defaultSoldierName(soldier(Team.OUR, SoldierClass.NONE, Body.REGMALE))).toBeNull();
    expect(defaultSoldierName(soldier(Team.CIV, SoldierClass.NONE, Body.MANCIV, 'Fatima', SOME_PROFILE))).toBeNull();
    const married = soldier(Team.CIV, SoldierClass.NONE, Body.REGFEMALE, MARRIED_MERC);
    expect([defaultSoldierName(married), namedByTeam(married)]).toEqual([null, true]);
  });
});

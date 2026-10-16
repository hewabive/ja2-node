import { describe, expect, it } from 'vitest';
import { EncounterCode } from '../forces/constants.ts';
import { Fact } from './fact-ids.ts';
import { createNarrativeState, factValue, setFact } from './facts.ts';
import { Npc } from './npc-ids.ts';
import { okayToUpgradeEliteToSpecialProfiledEnemy } from './profiled-enemies.ts';

const NO_PROFILE = 200;
const elite = (onRoof = false) => ({ profile: NO_PROFILE, onRoof });

describe('OkayToUpgradeEliteToSpecialProfiledEnemy (docs/25 §4.6)', () => {
  it('turns the first elite on the ground into Mike, then nobody else until the flag is cleared, then Iggy', () => {
    const n = createNarrativeState();
    setFact(n, Fact.MIKE_AVAILABLE_TO_ARMY, 1);
    setFact(n, Fact.IGGY_AVAILABLE_TO_ARMY, 1);
    const onRoof = elite(true);
    const first = elite();
    const second = elite();
    okayToUpgradeEliteToSpecialProfiledEnemy(n, EncounterCode.ENTERING_ENEMY_SECTOR, onRoof);
    okayToUpgradeEliteToSpecialProfiledEnemy(n, EncounterCode.ENTERING_ENEMY_SECTOR, first);
    okayToUpgradeEliteToSpecialProfiledEnemy(n, EncounterCode.ENTERING_ENEMY_SECTOR, second);
    expect([onRoof.profile, first.profile, second.profile]).toEqual([NO_PROFILE, Npc.MIKE, NO_PROFILE]);
    expect([factValue(n, Fact.MIKE_AVAILABLE_TO_ARMY), n.profiledEnemyAdded]).toEqual([2, true]);
    n.profiledEnemyAdded = false;
    okayToUpgradeEliteToSpecialProfiledEnemy(n, EncounterCode.NO_ENCOUNTER, second);
    expect([second.profile, factValue(n, Fact.IGGY_AVAILABLE_TO_ARMY)]).toEqual([Npc.IGGY, 2]);
  });

  it('never upgrades during an enemy encounter or invasion', () => {
    const n = createNarrativeState();
    setFact(n, Fact.MIKE_AVAILABLE_TO_ARMY, 1);
    for (const code of [EncounterCode.ENEMY_ENCOUNTER, EncounterCode.ENEMY_INVASION]) {
      const pp = elite();
      okayToUpgradeEliteToSpecialProfiledEnemy(n, code, pp);
      expect(pp.profile).toBe(NO_PROFILE);
    }
    expect(factValue(n, Fact.MIKE_AVAILABLE_TO_ARMY)).toBe(1);
  });
});

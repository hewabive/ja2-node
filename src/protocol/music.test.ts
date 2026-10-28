import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../sim/events.ts';
import { type MusicFacts, type MusicState, musicMode, setMusicMode } from './music.ts';
import { MusicMode, type MusicModeName, musicModeOfNativeByte, trackEndRule, trackListMode } from './music-modes.ts';

const FACTS: MusicFacts = { creature: false, inCombat: false, sectorLoaded: true, hostiles: 0, gameJustStarted: false };
const TICK = 1;

function at(mode: MusicModeName, previous: MusicModeName = MusicMode.NONE): MusicState {
  return { mode, previous };
}

function ev(e: Record<string, unknown>): SimEvent {
  return { tick: TICK, ...e } as unknown as SimEvent;
}

function following(state: MusicState, events: readonly Record<string, unknown>[], facts: Partial<MusicFacts> = {}) {
  return musicMode(state, events.map(ev), { ...FACTS, ...facts });
}

const loaded = (extra: Record<string, unknown> = {}) => ({ type: 'sectorLoaded', sector: 'A9', hostiles: 0, ...extra });

describe('SetMusicMode', () => {
  it('remembers the mode it replaces and restores it, but never the victory or defeat tracks', () => {
    expect(setMusicMode(at(MusicMode.TACTICAL_NOTHING), MusicMode.LAPTOP)).toEqual(at(MusicMode.LAPTOP, MusicMode.TACTICAL_NOTHING));
    expect(setMusicMode(at(MusicMode.LAPTOP, MusicMode.TACTICAL_ENEMY_PRESENT), MusicMode.RESTORE)).toEqual(
      at(MusicMode.TACTICAL_ENEMY_PRESENT, MusicMode.TACTICAL_ENEMY_PRESENT),
    );
    expect(setMusicMode(at(MusicMode.LAPTOP, MusicMode.TACTICAL_VICTORY), MusicMode.RESTORE)).toEqual(
      at(MusicMode.TACTICAL_NOTHING, MusicMode.TACTICAL_NOTHING),
    );
    expect(setMusicMode(at(MusicMode.LAPTOP, MusicMode.TACTICAL_DEFEAT), MusicMode.RESTORE).mode).toBe(MusicMode.TACTICAL_NOTHING);
    expect(setMusicMode(at(MusicMode.TACTICAL_BATTLE, MusicMode.NONE), MusicMode.TACTICAL_BATTLE)).toEqual(
      at(MusicMode.TACTICAL_BATTLE, MusicMode.TACTICAL_BATTLE),
    );
  });
});

describe("musicMode follows the original's setters", () => {
  it('NONE: a new campaign starts silent and nothing in it sets none again', () => {
    expect(following(at(MusicMode.NONE), []).mode).toBe(MusicMode.NONE);
  });

  it('MAIN_MENU: a resolved meanwhile scene with no loaded sector leaves the menu music playing', () => {
    expect(following(at(MusicMode.TACTICAL_NOTHING), [{ type: 'meanwhile', scene: 'drassen', seq: 1 }], { sectorLoaded: false }).mode).toBe(
      MusicMode.MAIN_MENU,
    );
    expect(
      following(at(MusicMode.TACTICAL_NOTHING), [{ type: 'meanwhileStarted', scene: 'interrogation', seq: 1 }], { sectorLoaded: false })
        .mode,
    ).toBe(MusicMode.MAIN_MENU);
  });

  it('TACTICAL_NOTHING: the interrogation’s menu music gives way to the sector entry rule of the loaded N7, enemies or not', () => {
    const started = [{ type: 'meanwhileStarted', scene: 'interrogation', seq: 1 }];
    expect(following(at(MusicMode.TACTICAL_NOTHING), started, { sectorLoaded: true, hostiles: 3 }).mode).toBe(MusicMode.TACTICAL_NOTHING);
    expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), started, { sectorLoaded: true, hostiles: 0 }).mode).toBe(
      MusicMode.TACTICAL_NOTHING,
    );
  });

  it('LAPTOP: opening the laptop plays its music and closing restores the previous mode (laptop again before the first landing)', () => {
    const open = following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [{ type: 'laptopOpened' }]);
    expect(open).toMatchObject({ mode: MusicMode.LAPTOP, previous: MusicMode.TACTICAL_ENEMY_PRESENT });
    expect(following(open, [{ type: 'laptopClosed' }]).mode).toBe(MusicMode.TACTICAL_ENEMY_PRESENT);
    expect(following(open, [{ type: 'laptopClosed' }], { gameJustStarted: true }).mode).toBe(MusicMode.LAPTOP);
    const afterVictory = following(at(MusicMode.TACTICAL_VICTORY), [{ type: 'laptopOpened' }, { type: 'laptopClosed' }]);
    expect(afterVictory.mode).toBe(MusicMode.TACTICAL_NOTHING);
  });

  it('TACTICAL_NOTHING: entering a sector without hostiles, with a fast fade, unless a battle plays', () => {
    const entered = following(at(MusicMode.LAPTOP), [loaded()]);
    expect(entered).toMatchObject({ mode: MusicMode.TACTICAL_NOTHING, fastFade: true });
    expect(following(at(MusicMode.TACTICAL_BATTLE), [loaded({ hostiles: 3 })]).mode).toBe(MusicMode.TACTICAL_BATTLE);
    expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [loaded({ hostiles: 3 })]).mode).toBe(MusicMode.TACTICAL_ENEMY_PRESENT);
    expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [loaded({ hostiles: 0 })]).mode).toBe(MusicMode.TACTICAL_NOTHING);
  });

  it('TACTICAL_NOTHING: a battle won without a fight, a retreat from the prebattle screen, boxing, a creature town attack, the walk to the map', () => {
    expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [{ type: 'combatEnded', reason: 'won' }]).mode).toBe(MusicMode.TACTICAL_NOTHING);
    expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [{ type: 'retreated', via: 'preBattle' }]).mode).toBe(
      MusicMode.TACTICAL_NOTHING,
    );
    expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [{ type: 'retreated', via: 'autoresolve' }]).mode).toBe(
      MusicMode.TACTICAL_ENEMY_PRESENT,
    );
    const boxing = following(at(MusicMode.TACTICAL_BATTLE), [{ type: 'combatEnded', reason: 'boxing' }]);
    expect(boxing).toMatchObject({ mode: MusicMode.TACTICAL_NOTHING, previous: MusicMode.TACTICAL_ENEMY_PRESENT });
    expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [{ type: 'creatureAttack', sector: 'D13' }]).mode).toBe(
      MusicMode.TACTICAL_NOTHING,
    );
    const walked = following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [{ type: 'mercsLeftSector', mapScreen: true }]);
    expect(walked).toMatchObject({ mode: MusicMode.TACTICAL_NOTHING, fastFade: true });
    expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [{ type: 'mercsLeftSector' }]).mode).toBe(MusicMode.TACTICAL_ENEMY_PRESENT);
  });

  it('TACTICAL_ENEMYPRESENT: enemies placed in an untouched sector, outside the game start and meanwhile scenes', () => {
    expect(following(at(MusicMode.TACTICAL_NOTHING), [loaded({ enemyPresence: true, hostiles: 5 })]).mode).toBe(
      MusicMode.TACTICAL_ENEMY_PRESENT,
    );
    expect(following(at(MusicMode.TACTICAL_NOTHING), [{ type: 'enemyPresence', sector: 'A9' }]).mode).toBe(
      MusicMode.TACTICAL_ENEMY_PRESENT,
    );
    expect(following(at(MusicMode.TACTICAL_NOTHING), [{ type: 'enemySighted', soldier: 1, newEnemies: 1, revealedEnemies: 0 }]).mode).toBe(
      MusicMode.TACTICAL_NOTHING,
    );
  });

  it('TACTICAL_ENEMYPRESENT: leaving combat by a lull, the first helicopter drop, the prebattle screen, the end of the interrogation', () => {
    expect(following(at(MusicMode.TACTICAL_BATTLE), [{ type: 'combatEnded', reason: 'lull' }]).mode).toBe(MusicMode.TACTICAL_ENEMY_PRESENT);
    const landed = following(at(MusicMode.LAPTOP, MusicMode.LAPTOP), [loaded({ firstArrival: true, hostiles: 6 })]);
    expect(landed).toMatchObject({ mode: MusicMode.TACTICAL_ENEMY_PRESENT, previous: MusicMode.TACTICAL_NOTHING });
    expect(following(at(MusicMode.TACTICAL_NOTHING), [{ type: 'preBattle', autoStart: false }])).toMatchObject({
      mode: MusicMode.TACTICAL_ENEMY_PRESENT,
      previous: MusicMode.TACTICAL_ENEMY_PRESENT,
    });
    expect(following(at(MusicMode.TACTICAL_NOTHING), [{ type: 'preBattle', autoStart: true }])).toMatchObject({
      mode: MusicMode.TACTICAL_ENEMY_PRESENT,
      previous: MusicMode.TACTICAL_NOTHING,
    });
    expect(following(at(MusicMode.TACTICAL_NOTHING), [{ type: 'meanwhileEnded', scene: 'interrogation', seq: 1 }]).mode).toBe(
      MusicMode.TACTICAL_ENEMY_PRESENT,
    );
    expect(following(at(MusicMode.TACTICAL_NOTHING), [{ type: 'meanwhile', scene: 'drassen', seq: 1 }], { hostiles: 4 }).mode).toBe(
      MusicMode.TACTICAL_ENEMY_PRESENT,
    );
    expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [{ type: 'meanwhile', scene: 'drassen', seq: 1 }]).mode).toBe(
      MusicMode.TACTICAL_NOTHING,
    );
  });

  it('TACTICAL_BATTLE: entering combat, and a sighting in combat while no music plays', () => {
    expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [{ type: 'combatStarted', team: 0 }]).mode).toBe(MusicMode.TACTICAL_BATTLE);
    const sighting = [{ type: 'enemySighted', soldier: 1, newEnemies: 1, revealedEnemies: 0 }];
    expect(following(at(MusicMode.NONE), sighting, { inCombat: true }).mode).toBe(MusicMode.TACTICAL_BATTLE);
    expect(following(at(MusicMode.TACTICAL_NOTHING), sighting, { inCombat: true }).mode).toBe(MusicMode.TACTICAL_NOTHING);
  });

  it('TACTICAL_VICTORY: a fought battle won unless the last kill was a monster, an autoresolve win, the queens', () => {
    const won = following(at(MusicMode.TACTICAL_BATTLE), [{ type: 'combatEnded', reason: 'won', fought: true }]);
    expect(won).toMatchObject({ mode: MusicMode.TACTICAL_VICTORY, previous: MusicMode.TACTICAL_ENEMY_PRESENT });
    expect(following(at(MusicMode.TACTICAL_BATTLE), [{ type: 'combatEnded', reason: 'won', fought: true, monsterKill: true }]).mode).toBe(
      MusicMode.TACTICAL_ENEMY_PRESENT,
    );
    expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [{ type: 'arBattleOver', status: 'victory' }]).mode).toBe(
      MusicMode.TACTICAL_VICTORY,
    );
    expect(following(at(MusicMode.TACTICAL_BATTLE), [{ type: 'queenKilled' }]).mode).toBe(MusicMode.TACTICAL_VICTORY);
    expect(following(at(MusicMode.TACTICAL_BATTLE), [{ type: 'creatureQueenKilled' }]).mode).toBe(MusicMode.TACTICAL_VICTORY);
    const upstairs = following(at(MusicMode.TACTICAL_VICTORY), [loaded({ sector: 'P3' }), { type: 'squadMovedUpstairs' }]);
    expect(upstairs).toMatchObject({ mode: MusicMode.TACTICAL_VICTORY, previous: MusicMode.TACTICAL_VICTORY });
  });

  it('TACTICAL_DEFEAT: a lost battle, an autoresolve loss, surrender or capture', () => {
    expect(following(at(MusicMode.TACTICAL_BATTLE), [{ type: 'combatEnded', reason: 'lost' }])).toMatchObject({
      mode: MusicMode.TACTICAL_DEFEAT,
      previous: MusicMode.TACTICAL_ENEMY_PRESENT,
    });
    for (const status of ['defeat', 'surrendered', 'captured'])
      expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [{ type: 'arBattleOver', status }]).mode).toBe(MusicMode.TACTICAL_DEFEAT);
    expect(following(at(MusicMode.TACTICAL_ENEMY_PRESENT), [{ type: 'arBattleOver', status: 'retreat' }]).mode).toBe(
      MusicMode.TACTICAL_ENEMY_PRESENT,
    );
  });

  it('applies the events in order and keeps the fast fade only when a fast setter made the last change', () => {
    const entered = following(at(MusicMode.LAPTOP), [loaded(), { type: 'combatStarted', team: 1 }]);
    expect(entered).toMatchObject({ mode: MusicMode.TACTICAL_BATTLE, fastFade: false });
    expect(following(at(MusicMode.TACTICAL_NOTHING), [loaded()]).fastFade).toBe(false);
  });
});

describe('music modes', () => {
  it('map the native save byte, the creature variants and the end rules', () => {
    expect(musicModeOfNativeByte(4)).toBe(MusicMode.TACTICAL_ENEMY_PRESENT);
    expect(musicModeOfNativeByte(99)).toBe(MusicMode.NONE);
    expect(trackListMode(MusicMode.TACTICAL_BATTLE, true)).toBe(MusicMode.TACTICAL_CREATURE_BATTLE);
    expect(trackListMode(MusicMode.TACTICAL_VICTORY, true)).toBe(MusicMode.TACTICAL_VICTORY);
    expect(trackListMode(MusicMode.TACTICAL_NOTHING, false)).toBe(MusicMode.TACTICAL_NOTHING);
    expect(trackEndRule(MusicMode.TACTICAL_VICTORY)).toBe('thenNothing');
    expect(trackEndRule(MusicMode.TACTICAL_DEFEAT)).toBe('thenSilence');
    expect(trackEndRule(MusicMode.LAPTOP)).toBe('nextTrack');
  });
});

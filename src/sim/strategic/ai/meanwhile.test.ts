import { beforeAll, describe, expect, it } from 'vitest';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { awakeFixture, loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStrategicTestContent } from '../../../../tests/support/strategic.ts';
import type { ArmyContent } from '../../../content/strategic/army.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { MercStatus, type ProfileProgress } from '../../tactical/profiles.ts';
import { SectorFlag } from '../forces/constants.ts';
import { resetSectorFlag, setSectorFlag } from '../map/sectors.ts';
import { Quest } from '../narrative/fact-ids.ts';
import { Npc } from '../narrative/npc-ids.ts';
import type { SectorPosition } from '../state.ts';
import { EventKind } from '../time/constants.ts';
import { Meanwhile, StrategicAiAction } from './constants.ts';
import {
  areInMeanwhile,
  handleFirstBattleEndingWhileInTown,
  handleFirstMeanwhileSetUpWithTrashWorld,
  handleFlowersMeanwhileScene,
  handleKillChopperMeanwhileScene,
  handleMeanwhileEvent,
  handleScientistAwolMeanwhileScene,
  INTERROGATION_MINUTE,
  isMedunaOutskirts,
  meanwhileSceneName,
  meanwhileScheduled,
  processImplicationsOfMeanwhile,
  scheduleInterrogation,
  scheduleMeanwhileEvent,
} from './meanwhile.ts';
import { executeStrategicAIAction } from './reactions.ts';

let content: StrategicContent;
let army: ArmyContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
  army = await loadArmyTestContent();
});

function fixture(difficulty = 2) {
  const profiles = new Map<number, ProfileProgress>();
  for (const id of [Npc.ELLIOT, Npc.RAT, Npc.MADLAB, Npc.ROBOT]) profiles.set(id, testProfile(id));
  const quests: { quest: number; sector: SectorPosition | null }[] = [];
  const f = awakeFixture(
    {
      content,
      army,
      difficulty,
      hooks: { profile: (id) => profiles.get(id) ?? null, startQuest: (quest, sector) => quests.push({ quest, sector }) },
    },
    [],
  );
  return { ...f, profiles, quests, elliot: profiles.get(Npc.ELLIOT) as ProfileProgress };
}

const minutes = (q: { state: { clock: { seconds: number } } }) => Math.trunc(q.state.clock.seconds / 60);

describe('scheduling meanwhile scenes', () => {
  it('schedules each scene once with its definition, the last scheduled id and Elliot counted at scheduling', () => {
    const { q, elliot } = fixture();
    elliot.npcData = 2;
    scheduleMeanwhileEvent(q, Meanwhile.CREATURES, minutes(q) + 5);
    scheduleMeanwhileEvent(q, Meanwhile.CREATURES, minutes(q) + 9);
    scheduleInterrogation(q);
    const m = q.state.meanwhile;
    expect(m.flags).toBe(0x800 | 0x8000);
    expect(m.currentId).toBe(Meanwhile.INTERROGATION);
    expect(m.defs[Meanwhile.CREATURES]).toEqual({ sector: { x: 3, y: 16 }, trigger: 0, id: Meanwhile.CREATURES, npc: Npc.QUEEN });
    expect(m.defs[Meanwhile.INTERROGATION]?.sector).toEqual({ x: 7, y: 14 });
    expect(elliot.npcData).toBe(4);
    const events = q.state.queue.events.filter((e) => e.kind === EventKind.MEANWHILE);
    expect(events.map((e) => [e.param, e.stamp])).toEqual([
      [Meanwhile.INTERROGATION, INTERROGATION_MINUTE * 60],
      [Meanwhile.CREATURES, (minutes(q) + 5) * 60],
    ]);
  });

  it('stops counting Elliot at 17 and wraps the counter like an INT8 below it', () => {
    const { q, elliot } = fixture();
    elliot.npcData = 17;
    scheduleMeanwhileEvent(q, Meanwhile.LOST_TOWN, minutes(q) + 5);
    expect(elliot.npcData).toBe(17);
    elliot.npcData = 127;
    scheduleMeanwhileEvent(q, Meanwhile.FLOWERS, minutes(q) + 5);
    expect(elliot.npcData).toBe(-128);
  });

  it('draws the flower and chopper delays only while their flag is clear', () => {
    const { q, rolls } = fixture();
    rolls.push(3, 7);
    handleFlowersMeanwhileScene(q, 0);
    handleFlowersMeanwhileScene(q, 1);
    handleKillChopperMeanwhileScene(q);
    handleKillChopperMeanwhileScene(q);
    expect(rolls.ranges).toEqual([5, 10]);
    const stamps = new Map(q.state.queue.events.filter((e) => e.kind === EventKind.MEANWHILE).map((e) => [e.param, e.stamp]));
    expect(stamps.get(Meanwhile.FLOWERS)).toBe((minutes(q) + 60 * 23) * 60);
    expect(stamps.get(Meanwhile.KILL_CHOPPER)).toBe((minutes(q) + 55 + 7) * 60);
  });

  it('knows the Meduna outskirts and names scenes in camelCase', () => {
    expect(['M2', 'M6', 'N6'].every((s) => isMedunaOutskirts(parseSectorString(s)))).toBe(true);
    expect(['M1', 'M7', 'N5', 'N7'].some((s) => isMedunaOutskirts(parseSectorString(s)))).toBe(false);
    expect(meanwhileSceneName(Meanwhile.END_OF_PLAYERS_FIRST_BATTLE)).toBe('endOfPlayersFirstBattle');
    expect(meanwhileSceneName(Meanwhile.NW_SAM)).toBe('nwSam');
  });
});

describe('the meanwhile event', () => {
  it('delays from the event stamp while enemies are loaded and begins the scene otherwise', () => {
    const { q, rolls } = fixture();
    let enemies = true;
    Object.assign(q.world, { enemyInSector: () => enemies });
    scheduleInterrogation(q);
    const e = q.state.queue.events.find((x) => x.kind === EventKind.MEANWHILE);
    if (!e) throw new Error('no event');
    q.state.queue.events.splice(q.state.queue.events.indexOf(e), 1);
    rolls.push(100);
    handleMeanwhileEvent(q, e);
    const delayed = q.state.queue.events.find((x) => x.kind === EventKind.MEANWHILE);
    expect(delayed?.stamp).toBe(600 + 180 + 100);
    expect(q.state.meanwhile.trying).toBe(false);
    enemies = false;
    handleMeanwhileEvent(q, e);
    expect(q.state.meanwhile.trying).toBe(true);
    expect(q.state.meanwhile.current.id).toBe(Meanwhile.INTERROGATION);
    expect(q.state.clock.paused && q.state.clock.pauseLocked && q.state.clock.timeInterrupt).toBe(true);
  });

  it('gives a meanwhile due this second and a running scene precedence, except during a tactical traversal', () => {
    const { q } = fixture();
    scheduleMeanwhileEvent(q, Meanwhile.LOST_TOWN, minutes(q));
    expect(areInMeanwhile(q)).toBe(true);
    q.state.movement.tacticalTraversal.active = true;
    expect(areInMeanwhile(q)).toBe(false);
    q.state.movement.tacticalTraversal.active = false;
    q.state.queue.events.length = 0;
    expect(areInMeanwhile(q)).toBe(false);
    q.state.meanwhile.inScene = true;
    expect(areInMeanwhile(q)).toBe(true);
  });
});

describe('implications', () => {
  it('wakes the Queen on the first battle only on hard and on the town scenes always', () => {
    const normal = fixture(2);
    normal.q.state.queen.awake = false;
    processImplicationsOfMeanwhile(normal.q, Meanwhile.END_OF_PLAYERS_FIRST_BATTLE);
    expect(normal.q.state.queen.awake).toBe(false);
    processImplicationsOfMeanwhile(normal.q, Meanwhile.BALIME_LIBERATED);
    expect(normal.q.state.queen.awake).toBe(true);
    const hard = fixture(3);
    hard.q.state.queen.awake = false;
    processImplicationsOfMeanwhile(hard.q, Meanwhile.END_OF_PLAYERS_FIRST_BATTLE);
    expect(hard.q.state.queen.awake).toBe(true);
  });

  it('wakes the Queen’s AI again after her death: nothing checks that she is dead', () => {
    const { q, profiles } = fixture();
    profiles.set(Npc.QUEEN, testProfile(Npc.QUEEN, { mercStatus: MercStatus.IS_DEAD }));
    executeStrategicAIAction(q, StrategicAiAction.QUEEN_DEAD, null);
    expect(q.state.queen.awake).toBe(false);
    processImplicationsOfMeanwhile(q, Meanwhile.GRUMM_LIBERATED);
    expect(q.state.queen.awake).toBe(true);
  });

  it('places Rat in G9 for the creature scene', () => {
    const { q, profiles } = fixture();
    processImplicationsOfMeanwhile(q, Meanwhile.CREATURES);
    expect(profiles.get(Npc.RAT)).toMatchObject({ sectorX: 9, sectorY: 7, sectorZ: 0 });
  });

  it('starts the scientist quest and moves Madlab and the robot to the alternate-map sector, or nowhere', () => {
    const placement = content.npcPlacements.find((p) => p.profile === Npc.MADLAB);
    const sectors = (placement?.sectors ?? []).map((id) => ({ x: (id % 16) + 1, y: Math.trunc(id / 16) + 1, z: 0 }));
    const none = fixture();
    for (const s of sectors) resetSectorFlag(none.q.state.map, s, SectorFlag.USE_ALTERNATE_MAP);
    processImplicationsOfMeanwhile(none.q, Meanwhile.AWOL_SCIENTIST);
    expect(none.quests).toEqual([{ quest: Quest.FIND_SCIENTIST, sector: { x: -1, y: -1, z: 0 } }]);
    expect(none.profiles.get(Npc.MADLAB)).toMatchObject({ sectorX: 0, sectorY: 0, sectorZ: 0 });
    const chosen = fixture();
    const s = sectors[1];
    if (!s) throw new Error('no Madlab placement');
    for (const other of sectors) resetSectorFlag(chosen.q.state.map, other, SectorFlag.USE_ALTERNATE_MAP);
    setSectorFlag(chosen.q.state.map, s, SectorFlag.USE_ALTERNATE_MAP, 1);
    processImplicationsOfMeanwhile(chosen.q, Meanwhile.AWOL_SCIENTIST);
    expect(chosen.profiles.get(Npc.ROBOT)).toMatchObject({ sectorX: s.x, sectorY: s.y, sectorZ: 0 });
  });

  it('posts the scientist scene five minutes later', () => {
    const { q } = fixture();
    handleScientistAwolMeanwhileScene(q);
    expect(meanwhileScheduled(q, Meanwhile.AWOL_SCIENTIST)).toBe(true);
  });
});

describe('the first battle', () => {
  it('waits for the world trash after a tactical town battle and posts at once after autoresolve or outside towns', () => {
    const town = fixture();
    handleFirstBattleEndingWhileInTown(town.q, parseSectorString('A9'), false);
    expect(meanwhileScheduled(town.q, Meanwhile.END_OF_PLAYERS_FIRST_BATTLE)).toBe(false);
    expect(town.q.state.queen.firstBattleMeanwhilePending).toBe(true);
    handleFirstMeanwhileSetUpWithTrashWorld(town.q);
    expect(meanwhileScheduled(town.q, Meanwhile.END_OF_PLAYERS_FIRST_BATTLE)).toBe(true);
    const auto = fixture();
    handleFirstBattleEndingWhileInTown(auto.q, parseSectorString('A9'), true);
    expect(meanwhileScheduled(auto.q, Meanwhile.END_OF_PLAYERS_FIRST_BATTLE)).toBe(true);
    const wild = fixture();
    handleFirstBattleEndingWhileInTown(wild.q, parseSectorString('B1'), false);
    expect(meanwhileScheduled(wild.q, Meanwhile.END_OF_PLAYERS_FIRST_BATTLE)).toBe(true);
  });
});

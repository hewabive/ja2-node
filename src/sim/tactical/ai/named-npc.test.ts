import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { Quest } from '../../strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../../strategic/narrative/facts.ts';
import type { TacticalContent } from '../content.ts';
import { directionToward } from '../movement.ts';
import { assassinStepsCloseToPc } from '../narrative/assassin-approach.ts';
import { Profile } from '../narrative/constants.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from '../narrative/port.ts';
import { Opp } from '../perception/opp.ts';
import { CivilianGroup, NOWHERE, Orders, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { AiAction } from './actions.ts';
import { offersSurrender } from './combat-decide.ts';
import { actionDone, executeAction } from './control.ts';
import { decideActionGreen, NO_GREEN_HOOKS } from './decide.ts';
import { decideActionNamedNPC } from './decide-named-npc.ts';
import { endTimedAiPause, PAUSE_ALL_AI_DELAY_MS, pauseAiTemporarily, pauseAiUntilManuallyUnpaused, unPauseAi } from './pause.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NORTH = 0;
const NPC_AT = 80 * 160 + 80;
const NEAR = NPC_AT + 6;
const FAR = NPC_AT + 30;
const QUOTE_ACTION_TURN_TOWARDS_PLAYER = 2;
const NAMED = 94;

function setup(port: Partial<NarrativePort> = {}): { sim: TacticalSim; calls: string[] } {
  const sim = newCombatSim(content);
  const calls: string[] = [];
  sim.state.narrative = {
    ...NO_NARRATIVE_PORT,
    pcsNearNpc: (p) => calls.push(`pcsNear ${p}`),
    ...port,
  };
  return { sim, calls };
}

function npc(sim: TacticalSim, profile = NAMED): Soldier {
  const s = spawnSoldier(sim, TEAM_FIRST_ID[Team.CIV], Team.CIV, NPC_AT, NORTH, { profile });
  s.civilianGroup = CivilianGroup.NONE;
  s.neutral = true;
  return s;
}

describe('decideActionNamedNPC', () => {
  it('waits for a PC within 8 tiles after a face-the-player record, then runs PCsNearNPC once', () => {
    const { sim, calls } = setup();
    const s = npc(sim);
    const merc = spawnSoldier(sim, 0, Team.OUR, FAR, NORTH);
    s.quoteRecord = 3;
    s.quoteActionId = QUOTE_ACTION_TURN_TOWARDS_PLAYER;
    s.ai.handleEveryFrame = true;
    s.oppList[merc.id] = Opp.SEEN_CURRENTLY;
    const turn = decideActionNamedNPC(sim.state, s);
    expect(turn).toBe(AiAction.CHANGE_FACING);
    expect(s.ai.actionData).toBe(directionToward(NPC_AT, FAR));
    sim.state.soldiers[0] = merc;
    merc.gridNo = NEAR;
    expect(decideActionNamedNPC(sim.state, s)).toBe(AiAction.ABSOLUTELY_NONE);
    expect([calls, s.quoteRecord, s.ai.handleEveryFrame]).toEqual([[`pcsNear ${NAMED}`], 0, false]);
  });

  it('reads a face-the-player record of 0 as none, so the action from record 0 never turns the NPC', () => {
    const { sim, calls } = setup();
    const s = npc(sim);
    const merc = spawnSoldier(sim, 0, Team.OUR, NEAR, NORTH);
    s.quoteRecord = 0;
    s.quoteActionId = QUOTE_ACTION_TURN_TOWARDS_PLAYER;
    s.oppList[merc.id] = Opp.SEEN_CURRENTLY;
    expect(decideActionNamedNPC(sim.state, s)).toBe(AiAction.NONE);
    expect(calls).toEqual([]);
  });

  it('adds 10 to the distance of a PC the NPC does not see', () => {
    const { sim, calls } = setup();
    const s = npc(sim);
    spawnSoldier(sim, 0, Team.OUR, NPC_AT + 3, NORTH);
    s.quoteRecord = 1;
    s.quoteActionId = QUOTE_ACTION_TURN_TOWARDS_PLAYER;
    s.direction = directionToward(NPC_AT, NPC_AT + 3);
    expect(decideActionNamedNPC(sim.state, s)).toBe(AiAction.ABSOLUTELY_NONE);
    expect(calls).toEqual([]);
  });

  it('walks up to the merc it wants to talk to', () => {
    const { sim } = setup({ npcConsiderInitiatingConv: () => NEAR });
    const s = npc(sim);
    expect(decideActionNamedNPC(sim.state, s)).toBe(AiAction.APPROACH_MERC);
    expect(s.ai.actionData).toBe(NEAR);
  });

  it('lists an assassin within 8 tiles of a PC for the hostile quote and waits 5 s', () => {
    const { sim } = setup();
    const s = npc(sim, Profile.JIM);
    const merc = spawnSoldier(sim, 0, Team.OUR, NEAR, NORTH);
    s.oppList[merc.id] = Opp.SEEN_CURRENTLY;
    expect(decideActionNamedNPC(sim.state, s)).toBe(AiAction.WAIT);
    expect([s.ai.actionData, sim.state.hostileQuoteList]).toEqual([5000, [s]]);
  });

  it('sends a far assassin as far as possible towards the closest PC', () => {
    const { sim } = setup();
    const s = npc(sim, Profile.OLGA);
    s.ai.orders = Orders.SEEKENEMY;
    spawnSoldier(sim, 0, Team.OUR, FAR, NORTH);
    expect(decideActionNamedNPC(sim.state, s)).toBe(AiAction.APPROACH_MERC);
    expect(s.ai.actionData).not.toBe(NOWHERE);
  });
});

describe('a neutral assassin stepping onto a new tile', () => {
  it('stops and joins the hostile-quote list within 8 tiles of a PC, not further away and not once hostile', () => {
    const { sim } = setup();
    const s = npc(sim, Profile.TYRONE);
    const merc = spawnSoldier(sim, 0, Team.OUR, FAR, NORTH);
    assassinStepsCloseToPc(sim.state, s);
    expect(sim.state.hostileQuoteList).toEqual([]);
    merc.gridNo = NEAR;
    s.neutral = false;
    assassinStepsCloseToPc(sim.state, s);
    expect(sim.state.hostileQuoteList).toEqual([]);
    s.neutral = true;
    s.oppList[merc.id] = Opp.SEEN_CURRENTLY;
    assassinStepsCloseToPc(sim.state, s);
    expect(sim.state.hostileQuoteList).toEqual([s]);
  });
});

describe('the named-NPC branch of DecideActionGreen', () => {
  it('does nothing for a minute after the NPC spoke, without the PreRandom(5) draw, then clears the time', () => {
    const { sim } = setup();
    const s = npc(sim);
    sim.state.clockMs = 10_000;
    s.timeSinceLastSpoke = 5_000;
    const pre = new ScriptedStream([], 1);
    Object.assign(sim.state, { pre });
    const hooks = { ...NO_GREEN_HOOKS, decideActionNamedNPC: () => AiAction.NONE };
    expect(decideActionGreen(sim.state, s, hooks)).toBe(AiAction.NONE);
    expect(pre.requested).toEqual([]);
    sim.state.clockMs = 65_000;
    decideActionGreen(sim.state, s, hooks);
    expect(s.timeSinceLastSpoke).toBe(0);
    expect(pre.requested[0]).toBe(5);
  });

  it('treats any neutral civilian as a civilian, whatever its group state', () => {
    const { sim } = setup();
    const s = npc(sim);
    s.civilianGroup = CivilianGroup.REBEL;
    sim.state.civGroups.hostility[CivilianGroup.REBEL] = 1;
    let asked = 0;
    const hooks = {
      ...NO_GREEN_HOOKS,
      decideActionNamedNPC: () => {
        asked++;
        return AiAction.ABSOLUTELY_NONE;
      },
    };
    expect(decideActionGreen(sim.state, s, hooks)).toBe(AiAction.ABSOLUTELY_NONE);
    expect(asked).toBe(1);
  });
});

describe('the enemy surrender offer', () => {
  function battle(enemies: number, pcs: number, port: Partial<NarrativePort> = {}): { sim: TacticalSim; first: Soldier } {
    const { sim } = setup(port);
    for (let k = 0; k < pcs; k++) spawnSoldier(sim, k, Team.OUR, NPC_AT + 160 * 10 + k, NORTH);
    let first: Soldier | null = null;
    for (let k = 0; k < enemies; k++) {
      const e = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY] + k, Team.ENEMY, NPC_AT + k, NORTH);
      e.visible = 1;
      first ??= e;
    }
    return { sim, first: first as Soldier };
  }

  it('needs a visible enemy at half life or more, fewer than 4 PCs, three enemies per PC, no militia, once', () => {
    const { sim, first } = battle(3, 1);
    expect(offersSurrender(sim.state, first)).toBe(true);
    first.visible = 0;
    expect(offersSurrender(sim.state, first)).toBe(false);
    first.visible = 1;
    first.life = Math.trunc(first.lifeMax / 2) - 1;
    expect(offersSurrender(sim.state, first)).toBe(false);
    first.life = first.lifeMax;
    sim.state.turn.enemyOfferedSurrender = true;
    expect(offersSurrender(sim.state, first)).toBe(false);
    expect(offersSurrender(battle(5, 2).sim.state, battle(5, 2).first)).toBe(false);
    const withMilitia = battle(3, 1);
    spawnSoldier(withMilitia.sim, TEAM_FIRST_ID[Team.MILITIA], Team.MILITIA, NPC_AT + 160 * 20, NORTH);
    expect(offersSurrender(withMilitia.sim.state, withMilitia.first)).toBe(false);
  });

  it('is not offered while the Alma quest is running, again after it when the interrogation has not started', () => {
    let alma: number = QuestStatus.IN_PROGRESS;
    let interrogation: number = QuestStatus.NOT_STARTED;
    const questStatus = (q: number) => (q === Quest.HELD_IN_ALMA ? alma : q === Quest.INTERROGATION ? interrogation : 0);
    const { sim, first } = battle(3, 1, { questStatus });
    expect(offersSurrender(sim.state, first)).toBe(false);
    alma = QuestStatus.DONE;
    expect(offersSurrender(sim.state, first)).toBe(true);
    interrogation = QuestStatus.IN_PROGRESS;
    expect(offersSurrender(sim.state, first)).toBe(false);
  });

  it('runs the offer through the narrative port and finishes the action at once without a prompt', () => {
    const offered: number[] = [];
    let prompt = true;
    const offerSurrender = (s: Soldier) => {
      offered.push(s.id);
      return prompt;
    };
    const { sim, first } = battle(3, 1, { offerSurrender });
    first.ai.action = AiAction.OFFER_SURRENDER;
    expect(executeAction(sim.state, first)).toBe(true);
    expect(first.ai.action).toBe(AiAction.OFFER_SURRENDER);
    actionDone(sim.state, first);
    prompt = false;
    first.ai.action = AiAction.OFFER_SURRENDER;
    expect(executeAction(sim.state, first)).toBe(false);
    expect([first.ai.action, offered]).toEqual([AiAction.NONE, [first.id, first.id]]);
  });
});

describe('gfPauseAllAI', () => {
  it('ends a temporary pause only after more than 1500 ms; a manual pause waits for UnPauseAI', () => {
    const { sim } = setup();
    const t = sim.state;
    t.clockMs = 1000;
    pauseAiTemporarily(t);
    t.clockMs = 1000 + PAUSE_ALL_AI_DELAY_MS;
    endTimedAiPause(t);
    expect(t.turn.pauseAllAi).toBe(true);
    t.clockMs += 5;
    endTimedAiPause(t);
    expect(t.turn.pauseAllAi).toBe(false);
    pauseAiUntilManuallyUnpaused(t);
    t.clockMs += 100_000;
    endTimedAiPause(t);
    expect(t.turn.pauseAllAi).toBe(true);
    unPauseAi(t);
    expect(t.turn.pauseAllAi).toBe(false);
  });
});

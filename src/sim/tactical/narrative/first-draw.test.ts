import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { parseStubProfiles, STUB_PROFILES_PATH } from '../../../content/formats/stub-profiles.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem, deleteObject } from '../../items/object.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { AiAction } from '../ai/actions.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { Opp } from '../perception/opp.ts';
import { progressFromProfile } from '../profiles.ts';
import { NO_PROFILE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { Profile } from './constants.ts';
import { npcDrawsFirstOnAttack, npcFirstDraw } from './first-draw.ts';

let content: TacticalContent;

beforeAll(async () => {
  const base = await loadTestContent();
  const json = JSON.parse(readFileSync(join(import.meta.dirname, '../../../..', STUB_PROFILES_PATH), 'utf8'));
  content = { ...base, profiles: parseStubProfiles(json, (name) => base.items.byName.get(name)?.index) };
});

const MERC_AT = gridNo(80, 80);
const NPC_AT = gridNo(80, 75);
const NPC_LEVEL = 5;
const THREATENED_FIRST = 0x04;
const MERC_AIM = 1;
const ORDERED_AIM = 3;

interface Standoff {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly merc: Soldier;
  readonly vasko: Soldier;
}

function standoff(profile: number = Npc.DAMON): Standoff {
  const sim = newCombatSim(content);
  const t = sim.state;
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.NORTH);
  const record = content.profiles[profile];
  if (record) t.profiles.set(profile, progressFromProfile(record));
  const vasko = spawnSoldier(sim, 116, Team.CIV, NPC_AT, Direction.SOUTH, { profile });
  vasko.stats.experience = NPC_LEVEL;
  sim.lookAround();
  expect([t.inCombat, vasko.oppList[merc.id], vasko.neutral]).toEqual([false, Opp.SEEN_CURRENTLY, true]);
  return { sim, t, merc, vasko };
}

function script(t: TacticalState, values: readonly number[], fallback: number | null = null): ScriptedStream {
  const stream = new ScriptedStream(values, fallback);
  Object.assign(t, { rng: stream });
  return stream;
}

function attack(s: Standoff) {
  s.merc.aimTime = MERC_AIM;
  return s.sim.dispatch({ type: 'attack', soldier: s.merc.id, target: s.vasko.gridNo, level: 0, aimTime: ORDERED_AIM });
}

describe('NPCFirstDraw (TeamTurns.cc) when our merc attacks a neutral NPC out of combat (Handle_UI.cc UIHandleMercAttack)', () => {
  it('lets him draw first: no attack and no aim, his action cancelled, on the hostile-quote list, then hostile in combat', () => {
    const s = standoff();
    s.vasko.ai.action = AiAction.RANDOM_PATROL;
    const rolls = script(s.t, [2, 0]);
    expect(attack(s)).toMatchObject({ ok: false, data: { refusal: 'npcDrewFirst' } });
    expect(rolls.requested).toEqual([3, 2]);
    expect([s.merc.aimTime, s.t.bullets.length, s.vasko.ai.action, s.t.hostileQuoteList]).toEqual([MERC_AIM, 0, AiAction.NONE, [s.vasko]]);
    script(s.t, [], 0);
    s.sim.step();
    expect([s.vasko.neutral, s.t.inCombat, s.t.hostileQuoteList]).toEqual([false, true, []]);
  });

  it('lets our merc attack when the NPC does not roll strictly higher, the target rolling first', () => {
    const s = standoff();
    const rolls = script(s.t, [0, 1], 0);
    expect(attack(s)).toEqual({ ok: true });
    expect(rolls.requested.slice(0, 2)).toEqual([3, 2]);
    expect([s.merc.aimTime, s.t.hostileQuoteList, s.vasko.neutral]).toEqual([ORDERED_AIM, [], true]);
  });

  it('adds one to both halves of an NPC our mercs have threatened before', () => {
    const s = standoff();
    const progress = s.t.profiles.get(Npc.DAMON);
    if (progress) progress.approached |= THREATENED_FIRST;
    const rolls = script(s.t, [0, 1]);
    expect(npcFirstDraw(s.t, s.merc, s.vasko)).toBe(true);
    expect(rolls.requested).toEqual([4, 2]);
  });

  it('draws nothing for Slay, a profileless or hostile civilian, one who does not see our merc or has no usable weapon', () => {
    const cases: ((s: Standoff) => void)[] = [
      () => undefined,
      (s) => {
        s.vasko.neutral = false;
      },
      (s) => {
        s.vasko.oppList[s.merc.id] = Opp.SEEN_LAST_TURN;
      },
      (s) => deleteObject(s.vasko.inv[InvSlot.HAND] as NonNullable<(typeof s.vasko.inv)[number]>),
    ];
    const requested = cases.flatMap((change, k) => {
      const s = standoff(k === 0 ? Profile.SLAY : Npc.DAMON);
      change(s);
      const rolls = script(s.t, []);
      expect(npcFirstDraw(s.t, s.merc, s.vasko)).toBe(false);
      return rolls.requested;
    });
    const nobody = standoff(NO_PROFILE);
    const rolls = script(nobody.t, []);
    expect(npcFirstDraw(nobody.t, nobody.merc, nobody.vasko)).toBe(false);
    expect([...requested, ...rolls.requested]).toEqual([]);
  });

  it('never checks in combat or for a merc without a weapon in hand', () => {
    const fighting = standoff();
    fighting.t.inCombat = true;
    const thrower = standoff();
    thrower.merc.inv[InvSlot.HAND] = createItem(
      thrower.t.content.items,
      thrower.t.content.items.byName.get('HAND_GRENADE')?.index ?? 0,
      100,
    );
    const requested = [fighting, thrower].flatMap((s) => {
      const rolls = script(s.t, []);
      expect(npcDrawsFirstOnAttack(s.t, s.merc, s.vasko.gridNo, 0)).toBe(false);
      return rolls.requested;
    });
    expect(requested).toEqual([]);
  });
});

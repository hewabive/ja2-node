import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../tests/support/combat.ts';
import { testProfile } from '../../tests/support/profiles.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { SimEvent } from '../sim/events.ts';
import { createItem } from '../sim/items/object.ts';
import { deleteTalkingMenu } from '../sim/narrative/converse.ts';
import { FINAL_TALKING_DELAY_TICKS, tacticalCharacterDialogue } from '../sim/narrative/dialogue-queue.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Fact } from '../sim/strategic/narrative/fact-ids.ts';
import { Npc } from '../sim/strategic/narrative/npc-ids.ts';
import { InvSlot } from '../sim/tactical/inventory.ts';
import { civilianGroupMemberChangesSides } from '../sim/tactical/narrative/civ-hostility.ts';
import { MercQuote, QuoteSaidFlag } from '../sim/tactical/narrative/merc-quotes.ts';
import { NpcActionCode } from '../sim/tactical/narrative/npc-actions/codes.ts';
import { SightFlags } from '../sim/tactical/perception/opp.ts';
import { handleSight } from '../sim/tactical/perception/sight.ts';
import { CivilianGroup, type Soldier, TEAM_FIRST_ID, Team } from '../sim/tactical/soldier.ts';
import type { TacticalState } from '../sim/tactical/state.ts';
import type { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { addItemToPool, Visibility } from '../sim/tactical/world-items.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import type { Session } from './session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const KESTREL = 0;
const VANT = 1;
const FOUND_SOMETHING_SPEAKER = 7;
const COOL_GUN = 'AK74';
const ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY];
const NPC = 94;
const NPC_ID = TEAM_FIRST_ID[Team.CIV];
const MALE = 0;
const TILES_AHEAD = 3;
const QUOTE_TICKS = 3000;
const RT_TURN_TICKS = 1100;
const RT_NEXT_BLEED_STEP = 0.5;

interface Campaign {
  readonly session: CampaignSession;
  readonly live: Session;
}

async function squadInA9(seed: number, profiles: readonly number[] = [KESTREL, VANT]): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles, land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString('A9')), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'skipHelicopterDrop' }).ok).toBe(true);
  const live = new ReloadingSession('merc lines', session);
  const enter = { type: 'enterSector', sector: 'A9' };
  await session.prepare(enter);
  expect(session.dispatch(enter)).toMatchObject({ ok: true });
  live.advance({ idle: true });
  return { session, live };
}

function loadedSector(c: Campaign): TacticalSim {
  const sim = c.session.campaign.tactical;
  if (!sim) throw new Error('no sector is loaded');
  return sim;
}

function ours(t: TacticalState, profile: number): Soldier {
  const s = t.soldiers.find((m) => m?.placed && m.team === Team.OUR && m.profile === profile);
  if (!s) throw new Error(`no merc with profile ${profile}`);
  return s;
}

function withRolls(t: TacticalState, rolls: readonly number[], run: () => void): number[] {
  const rng = t.rng as unknown as { int(n: number): number };
  const queued = [...rolls];
  const draws: number[] = [];
  const real = rng.int.bind(rng);
  rng.int = (n: number) => {
    draws.push(n);
    const v = queued.shift();
    return v === undefined ? real(n) : v;
  };
  try {
    run();
  } finally {
    delete (rng as { int?: unknown }).int;
  }
  expect(queued).toEqual([]);
  return draws;
}

function quotesSaid(events: readonly SimEvent[], ids: readonly number[]): [number, number][] {
  return events.flatMap((e) => (e.type === 'mercQuote' && ids.includes(e.id) ? [[e.profile, e.id] as [number, number]] : []));
}

describe('the comment a conversation left to say, in a campaign (Interface_Dialogue.cc DeleteTalkingMenu)', () => {
  it('has a merc near the NPC say the likable-person line through the dialogue queue when the talk panel closes', async () => {
    const c = await squadInA9(81);
    const sim = loadedSector(c);
    const t = sim.state;
    const kestrel = ours(t, KESTREL);
    const npc = spawnSoldier(sim, NPC_ID, Team.CIV, kestrel.gridNo + TILES_AHEAD, kestrel.direction, { profile: NPC });
    const campaign = c.session.campaign;
    const talk = campaign.talk;
    if (!talk) throw new Error('the campaign has no talk flow');
    const profile = campaign.state.profiles.get(NPC);
    if (!profile) throw new Error(`no profile ${NPC}`);
    campaign.state.profiles.set(NPC, { ...profile, sex: MALE });
    campaign.narrative.setFactTrue(Fact.NEED_TO_SAY_SOMETHING);
    Object.assign(talk.host.talk, { inPanel: true, charNum: NPC, niceNpc: NPC });
    talk.host.context.dest = npc.id;
    const draws = withRolls(t, [0], () => deleteTalkingMenu(talk.host, 'player'));
    expect(draws).toEqual([2]);
    expect(campaign.narrative.checkFact(Fact.NEED_TO_SAY_SOMETHING, 0)).toBe(false);
    const said = c.live.advance({ ticks: QUOTE_TICKS }).events;
    expect(quotesSaid(said, [MercQuote.LISTEN_LIKABLE_PERSON])).toEqual([[KESTREL, MercQuote.LISTEN_LIKABLE_PERSON]]);
  });
});

describe('the found-something-special line in a campaign (Handle_Items.cc SoldierGetItemFromWorld)', () => {
  it("is said through the dialogue queue and marked in the roster's quote flags", async () => {
    const c = await squadInA9(83, [FOUND_SOMETHING_SPEAKER]);
    const t = loadedSector(c).state;
    const merc = ours(t, FOUND_SOMETHING_SPEAKER);
    addItemToPool(
      t,
      merc.gridNo,
      createItem(t.content.items, t.content.items.byName.get(COOL_GUN)?.index ?? 0, 100),
      Visibility.VISIBLE,
      0,
    );
    const pickUp = { type: 'pickUp', soldier: merc.id };
    await c.session.prepare(pickUp);
    expect(c.session.dispatch(pickUp)).toMatchObject({ ok: true });
    const said = c.live.advance({ ticks: QUOTE_TICKS }).events;
    expect(quotesSaid(said, [MercQuote.FOUND_SOMETHING_SPECIAL])).toEqual([[FOUND_SOMETHING_SPEAKER, MercQuote.FOUND_SOMETHING_SPECIAL]]);
    const record = c.session.campaign.battle?.roster.get(ours(loadedSector(c).state, FOUND_SOMETHING_SPEAKER).id);
    expect((record?.quoteSaidFlags ?? 0) & QuoteSaidFlag.FOUND_SOMETHING_NICE).toBe(QuoteSaidFlag.FOUND_SOMETHING_NICE);
  });
});

describe('the out-of-ammo line in a campaign (Overhead.cc InternalReduceAttackBusyCount)', () => {
  it('is said through the dialogue queue after the shot that emptied the gun', async () => {
    const c = await squadInA9(85);
    const sim = loadedSector(c);
    const kestrel = ours(sim.state, KESTREL);
    const enemy = spawnSoldier(sim, ENEMY_ID, Team.ENEMY, kestrel.gridNo + TILES_AHEAD, kestrel.direction, { life: 100 });
    handleSight(sim.state, kestrel, SightFlags.LOOK | SightFlags.RADIO);
    expect(sim.state.inCombat).toBe(true);
    const gun = kestrel.inv[InvSlot.HAND];
    if (!gun) throw new Error('Kestrel has no gun');
    gun.gunShotsLeft = 1;
    const attack = { type: 'attack', soldier: kestrel.id, target: enemy.gridNo, aimTime: 0 };
    await c.session.prepare(attack);
    expect(c.session.dispatch(attack)).toMatchObject({ ok: true });
    const said = c.live.advance({ ticks: QUOTE_TICKS }).events;
    expect(quotesSaid(said, [MercQuote.OUT_OF_AMMO])).toEqual([[KESTREL, MercQuote.OUT_OF_AMMO]]);
  });
});

describe('the bleeding lines in a campaign (Soldier_Control.cc CheckBleeding, Dialogue_Control.cc TacticalCharacterDialogue)', () => {
  const BLEEDING_LINES = [MercQuote.STARTING_TO_BLEED, MercQuote.ME_TOO];

  function startBleeding(s: Soldier): void {
    Object.assign(s, { lifeMax: 80, life: 50, bleeding: 30, nextBleed: RT_NEXT_BLEED_STEP });
  }

  it('has the first merc to bleed at a real-time turn say so and the next one say me too', async () => {
    const c = await squadInA9(87);
    const t = loadedSector(c).state;
    for (const profile of [KESTREL, VANT]) startBleeding(ours(t, profile));
    const said = c.live.advance({ ticks: RT_TURN_TICKS + QUOTE_TICKS }).events;
    expect(quotesSaid(said, BLEEDING_LINES)).toEqual([
      [KESTREL, MercQuote.STARTING_TO_BLEED],
      [VANT, MercQuote.ME_TOO],
    ]);
  });

  it('wakes a sleeping merc for his line and puts him back to sleep after it', async () => {
    const c = await squadInA9(89);
    const t = loadedSector(c).state;
    const vant = ours(t, VANT);
    startBleeding(vant);
    const sleeper = c.session.campaign.battle?.roster.get(vant.id);
    if (!sleeper) throw new Error('Vant is not on the roster');
    sleeper.asleep = true;
    const asleep = () => c.session.campaign.battle?.roster.get(vant.id)?.asleep;
    const line = c.live.advance({ events: ['mercQuote'], ticks: RT_TURN_TICKS }).events;
    expect(quotesSaid(line, BLEEDING_LINES)).toEqual([[VANT, MercQuote.STARTING_TO_BLEED]]);
    expect(asleep()).toBe(false);
    c.live.advance({ ticks: QUOTE_TICKS });
    expect(asleep()).toBe(true);
  });
});

describe('the map screen pause for a line in a campaign (Dialogue_Control.cc DialogueEventQuote::Execute, HandleDialogue)', () => {
  const LOCK_PAUSE_MERC_TALKING = 15;
  const COMPRESSING = 2;
  const FASTER = 3;
  const ONE_REAL_SECOND_TICKS = 200;
  const LINE = MercQuote.OUT_OF_AMMO;

  interface LineSaid {
    readonly tick: number;
    readonly ticks: number;
    readonly events: readonly SimEvent[];
  }

  async function onTheMap(seed: number, mode: number | null): Promise<Campaign> {
    const c = await squadInA9(seed);
    const commands = mode === null ? [{ type: 'mapScreen' }] : [{ type: 'mapScreen' }, { type: 'compressTime', mode }];
    for (const cmd of commands) expect(c.session.dispatch(cmd)).toMatchObject({ ok: true });
    return c;
  }

  function clockOf(c: Campaign) {
    return c.session.campaign.state.clock;
  }

  function sayLine(c: Campaign): LineSaid {
    const talk = c.session.campaign.talk;
    if (!talk) throw new Error('the campaign has no talk flow');
    expect(tacticalCharacterDialogue(talk.host, ours(loadedSector(c).state, KESTREL), LINE)).toBe(true);
    const events = c.live.advance({ events: ['mercQuote'] }).events;
    const said = events.find((e) => e.type === 'mercQuote' && e.id === LINE);
    const face = c.session.campaign.talk?.talk.face;
    if (!said || !face) throw new Error('the line was not said');
    return { tick: said.tick, ticks: face.busyUntil - said.tick, events };
  }

  function eventTypes(events: readonly SimEvent[]): string[] {
    return events.map((e) => e.type);
  }

  it('stands the world clock while the line plays and resumes compression at the same speed after it', async () => {
    const c = await onTheMap(91, COMPRESSING);
    c.live.advance({ ticks: ONE_REAL_SECOND_TICKS });
    const before = clockOf(c).seconds;
    const line = sayLine(c);
    expect(clockOf(c)).toMatchObject({ paused: true, pauseLocked: true, pauseLockReason: LOCK_PAUSE_MERC_TALKING });
    expect(clockOf(c)).toMatchObject({ seconds: before, mode: COMPRESSING, compressionOn: true });
    const during = c.live.advance({ ticks: line.ticks - 1 });
    expect(clockOf(c)).toMatchObject({ seconds: before, paused: true, pauseLocked: true });
    expect(eventTypes([...line.events, ...during.events])).not.toContain('compressionStopped');
    const after = c.live.advance({ ticks: ONE_REAL_SECOND_TICKS });
    expect(clockOf(c)).toMatchObject({ paused: false, pauseLocked: false, mode: COMPRESSING, compressionOn: true });
    expect(clockOf(c).seconds).toBeGreaterThan(before);
    expect(eventTypes(after.events)).not.toContain('compressionStarted');
  });

  it('lets a strategic advance run through the line instead of stopping at its pause', async () => {
    const c = await onTheMap(93, COMPRESSING);
    const before = clockOf(c).seconds;
    sayLine(c);
    const report = c.live.advance({ worldSeconds: 600 });
    expect(report.reason).toBe('worldTime');
    expect(clockOf(c).seconds).toBeGreaterThanOrEqual(before + 600);
  });

  it('refuses a new speed and a start of compression with pauseLocked until the line ends, and advance {idle} waits for it', async () => {
    const compressing = await onTheMap(97, COMPRESSING);
    sayLine(compressing);
    expect(compressing.session.dispatch({ type: 'compressTime', mode: FASTER })).toMatchObject({
      ok: false,
      data: { refusal: 'pauseLocked' },
    });
    expect(clockOf(compressing).mode).toBe(COMPRESSING);
    const stopped = await onTheMap(98, null);
    const line = sayLine(stopped);
    expect(stopped.session.dispatch({ type: 'compressTime' })).toMatchObject({ ok: false, data: { refusal: 'pauseLocked' } });
    const idle = stopped.live.advance({ idle: true });
    expect(idle.tick).toBe(line.tick + line.ticks);
    expect(clockOf(stopped)).toMatchObject({ paused: false, pauseLocked: false });
    expect(stopped.session.dispatch({ type: 'compressTime' })).toMatchObject({ ok: true });
  });

  it('starts compression for a strategic advance only once the line has ended', async () => {
    const c = await onTheMap(109, null);
    const before = clockOf(c).seconds;
    const line = sayLine(c);
    const report = c.live.advance({ worldSeconds: 600 });
    expect(report.reason).toBe('worldTime');
    expect(report.events.find((e) => e.type === 'compressionStarted')?.tick).toBe(line.tick + line.ticks);
    expect(clockOf(c).seconds).toBeGreaterThanOrEqual(before + 600);
  });

  it('says a line in a pause it did not make without locking it, and leaves the game paused after it', async () => {
    const c = await onTheMap(100, COMPRESSING);
    Object.assign(clockOf(c), { paused: true, playerPause: true });
    const line = sayLine(c);
    expect(clockOf(c)).toMatchObject({ paused: true, pauseLocked: false });
    c.live.advance({ ticks: line.ticks + ONE_REAL_SECOND_TICKS });
    expect(clockOf(c)).toMatchObject({ paused: true, pauseLocked: false, playerPause: true });
  });

  it('lifts the pause at once when a viewer cuts the line, and after the closing 300 ms when one finished it', async () => {
    const cut = await onTheMap(101, COMPRESSING);
    const cutLine = sayLine(cut);
    expect(cut.session.dispatch({ type: 'skipLine', profile: KESTREL, tick: cutLine.tick })).toMatchObject({ data: { skipped: true } });
    expect(clockOf(cut)).toMatchObject({ paused: false, pauseLocked: false });
    const finished = await onTheMap(103, COMPRESSING);
    const finishedLine = sayLine(finished);
    const ended = { type: 'skipLine', profile: KESTREL, tick: finishedLine.tick, talkEnded: true };
    expect(finished.session.dispatch(ended)).toMatchObject({ data: { skipped: true } });
    finished.live.advance({ ticks: FINAL_TALKING_DELAY_TICKS - 1 });
    expect(clockOf(finished)).toMatchObject({ paused: true, pauseLocked: true });
    finished.live.advance({ ticks: 1 });
    expect(clockOf(finished)).toMatchObject({ paused: false, pauseLocked: false });
  });

  it('keeps the pause of a line when the player asks for tactical while it plays, as every exit from the map waits for it (Map_Screen_Interface_Bottom.cc AllowedToExitFromMapscreenTo)', async () => {
    const c = await onTheMap(105, COMPRESSING);
    const line = sayLine(c);
    expect(clockOf(c)).toMatchObject({ paused: true, pauseLocked: true });
    expect(c.session.dispatch({ type: 'tacticalScreen' })).toMatchObject({ ok: false, data: { refusal: 'pauseLocked' } });
    expect(clockOf(c)).toMatchObject({ paused: true, pauseLocked: true });
    c.live.advance({ ticks: line.ticks });
    expect(clockOf(c)).toMatchObject({ paused: false, pauseLocked: false });
    expect(c.session.dispatch({ type: 'tacticalScreen' })).toMatchObject({ ok: true });
  });

  it('never pauses for a line said in tactical', async () => {
    const c = await squadInA9(107);
    sayLine(c);
    expect(clockOf(c)).toMatchObject({ paused: false, pauseLocked: false });
  });
});

describe("a merc's face deleted while he talks, in a campaign (Faces.cc DeleteFace from DeleteSoldierFace)", () => {
  const LINE = MercQuote.OUT_OF_AMMO;
  const NEXT_LINE = MercQuote.HEADSHOT;
  const LINE_TICKS_LEFT = 100;

  interface Talking {
    readonly c: Campaign;
    readonly kestrel: Soldier;
    readonly saidAt: number;
  }

  function talkOf(c: Campaign) {
    const talk = c.session.campaign.talk;
    if (!talk) throw new Error('the campaign has no talk flow');
    return talk;
  }

  async function kestrelTalking(seed: number): Promise<Talking> {
    const c = await squadInA9(seed);
    const t = loadedSector(c).state;
    const talk = talkOf(c);
    expect(tacticalCharacterDialogue(talk.host, ours(t, KESTREL), LINE)).toBe(true);
    expect(tacticalCharacterDialogue(talk.host, ours(t, VANT), NEXT_LINE)).toBe(true);
    const said = c.live.advance({ events: ['mercQuote'] }).events.find((e) => e.type === 'mercQuote' && e.id === LINE);
    if (!said) throw new Error('the line was not said');
    return { c, kestrel: ours(loadedSector(c).state, KESTREL), saidAt: said.tick };
  }

  function expectLineEndedForTheNext(talking: Talking, profile: number): void {
    const { c, saidAt } = talking;
    expect(talkOf(c).talk.face?.busyUntil).toBe(c.session.campaign.tick);
    const events = c.live.advance({ events: ['mercQuote'] }).events;
    expect(events).toContainEqual(expect.objectContaining({ type: 'soldierFaceDeleted', profile, saidAt }));
    expect(quotesSaid(events, [NEXT_LINE])).toEqual([[VANT, NEXT_LINE]]);
  }

  it('ends the line of a merc married off and goes on to the next (NPC_ACTION_REMOVE_MERC_FOR_MARRIAGE, ChangeSoldierTeam)', async () => {
    const talking = await kestrelTalking(119);
    talkOf(talking.c).npcActions.handle(KESTREL, NpcActionCode.REMOVE_MERC_FOR_MARRIAGE, 0);
    expectLineEndedForTheNext(talking, KESTREL);
  });

  it('ends the line of a merc of ours whose civilian group turns hostile (CivilianGroupMemberChangesSides, ChangeSoldierTeam)', async () => {
    const talking = await kestrelTalking(113);
    const sim = loadedSector(talking.c);
    const { kestrel } = talking;
    const beggar = spawnSoldier(sim, NPC_ID, Team.CIV, kestrel.gridNo + TILES_AHEAD, kestrel.direction, {});
    beggar.civilianGroup = CivilianGroup.BEGGARS;
    kestrel.civilianGroup = CivilianGroup.BEGGARS;
    civilianGroupMemberChangesSides(sim.state, beggar);
    expectLineEndedForTheNext(talking, KESTREL);
  });

  it('ends the line of a merc leaving the team (StrategicRemoveMerc, TacticalRemoveSoldier)', async () => {
    const talking = await kestrelTalking(115);
    const { c, kestrel } = talking;
    const merc = c.session.campaign.battle?.roster.get(kestrel.id);
    if (!merc) throw new Error('Kestrel is not on the roster');
    c.session.campaign.contracts?.removeFromWorld(merc);
    expectLineEndedForTheNext(talking, KESTREL);
  });

  it("ends Larry's line at the swap of his profiles (SwapLarrysProfiles)", async () => {
    const talking = await kestrelTalking(117);
    const { c, kestrel } = talking;
    const campaign = c.session.campaign;
    campaign.state.profiles.set(Npc.LARRY_NORMAL, testProfile(Npc.LARRY_NORMAL));
    campaign.state.profiles.set(Npc.LARRY_DRUNK, testProfile(Npc.LARRY_DRUNK));
    const larry = campaign.battle?.roster.get(kestrel.id);
    const face = talkOf(c).talk.face;
    if (!larry || !face) throw new Error('Kestrel is not talking');
    larry.soldier.profile = Npc.LARRY_NORMAL;
    talkOf(c).talk.face = { ...face, speaker: Npc.LARRY_NORMAL, busyUntil: campaign.tick + LINE_TICKS_LEFT };
    campaign.narrative.swapLarrysProfiles(larry);
    expectLineEndedForTheNext(talking, Npc.LARRY_NORMAL);
  });
});

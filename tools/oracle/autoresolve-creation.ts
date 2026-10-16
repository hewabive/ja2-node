import { NOTHING } from '../../src/content/items/items.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { buildAutoresolveInput, type CreatureComposition } from '../../src/sim/campaign/autoresolve-strategic.ts';
import type { ItemObject } from '../../src/sim/items/object.ts';
import { determineCreatureTownComposition } from '../../src/sim/strategic/creatures/town-attack.ts';
import { ReplayStream } from '../../src/sim/strategic/forces/autoresolve/replay-rng.ts';
import { EncounterCode } from '../../src/sim/strategic/forces/constants.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import type { Soldier } from '../../src/sim/tactical/soldier.ts';
import { applyArSetup } from './autoresolve-aftermath.ts';
import { AutoresolveMark, type Report, traceSegment } from './autoresolve-compare.ts';

type Json = Record<string, unknown>;

const num = (v: unknown): number => Number(v ?? 0);
const obj = (v: unknown): Json => (v ?? {}) as Json;
const list = (v: unknown): Json[] => (v ?? []) as Json[];
const MILITIA_SIDE = 1;
const ENEMY_SIDE = 2;
const PATHFINDER_SKIP_LIST_RANGE = 4;
const PRESERVED_POSITION_RANGE = 2;

function ourStats(s: Soldier): Json {
  const st = s.stats;
  return {
    agility: st.agility,
    dexterity: st.dexterity,
    strength: st.strength,
    wisdom: st.wisdom,
    leadership: st.leadership,
    marksmanship: st.marksmanship,
    mechanical: st.mechanical,
    explosive: st.explosives,
    medical: st.medical,
    expLevel: st.experience,
  };
}

function ourObject(slot: number, o: ItemObject): unknown[] {
  const gun = o.gunShotsLeft !== undefined && o.gunAmmoItem !== undefined && o.gunAmmoItem !== NOTHING;
  return [
    slot,
    o.item,
    o.count,
    o.flags,
    o.status.slice(0, Math.max(1, o.count)),
    gun ? [o.gunShotsLeft, o.gunAmmoType, o.gunAmmoItem] : null,
    o.attachments.flatMap((a, index) => (a.item === NOTHING ? [] : [[index, a.item, a.status]])),
  ];
}

function theirObject(o: Json): unknown[] {
  const gun = o.gunShotsLeft !== undefined && num(o.gunAmmoItem) !== NOTHING;
  return [
    num(o.slot),
    num(o.item),
    num(o.count),
    num(o.flags),
    ((o.status as number[] | undefined) ?? []).map(Number),
    gun ? [num(o.gunShotsLeft), num(o.gunAmmoType), num(o.gunAmmoItem)] : null,
    list(o.attachments).map((a) => [num(a.index), num(a.item), num(a.status)]),
  ];
}

function ourSoldier(s: Soldier): Json {
  return {
    soldierClass: s.soldierClass,
    body: s.bodyType,
    stats: ourStats(s),
    life: [s.life, s.lifeMax],
    morale: s.morale,
    breath: [s.breath, s.breathMax],
    skillTraits: [s.skillTrait1, s.skillTrait2],
    actionPoints: s.actionPoints,
    inventory: s.inv.flatMap((o, slot) => (o.item === NOTHING ? [] : [ourObject(slot, o)])),
  };
}

function theirSoldier(s: Json): Json {
  return {
    soldierClass: num(s.soldierClass),
    body: num(s.body),
    stats: obj(s.stats),
    life: [num(s.life), num(s.lifeMax)],
    morale: num(s.morale),
    breath: [num(s.breath), num(s.breathMax)],
    skillTraits: ((s.skillTraits as number[] | undefined) ?? []).map(Number),
    actionPoints: num(s.actionPoints),
    inventory: list(s.inventory).map(theirObject),
  };
}

function compareSide(r: Report, label: string, ours: readonly Soldier[], theirs: readonly Json[]): void {
  r.same(`creation: ${label} count`, ours.length, theirs.length);
  theirs.forEach((cell, i) => {
    const s = ours[i];
    if (s) r.same(`creation: ${label} ${i}`, ourSoldier(s), theirSoldier(obj(cell.soldier)));
  });
}

export function compareAutoresolveCreation(r: Report, content: TacticalContent, session: CampaignSession, setup: Json, p: Json): void {
  const c = session.campaign;
  const economy = c.economy;
  const roster = c.battle?.roster;
  if (!economy || !roster) {
    r.same('creation', 'campaign', 'missing');
    return;
  }
  const sector = applyArSetup(r, c, setup);
  const seg = traceSegment(p, AutoresolveMark.SETUP, [AutoresolveMark.RATINGS]);
  const pre = new ReplayStream('pre', seg.pre);
  const main = new ReplayStream('main', seg.main);
  const creatures: CreatureComposition | undefined =
    num(p.code) === EncounterCode.CREATURE_ATTACK ? determineCreatureTownComposition(main, num(setup.creatures)) : undefined;
  const input = buildAutoresolveInput(
    { economy, queen: c.queen, content, roster },
    {
      sector,
      encounter: num(p.code),
      persistent: Boolean(setup.persistent),
      tactical: c.tactical?.state ?? null,
      ...(creatures ? { creatures } : {}),
      streams: { rng: main, pre },
    },
  );
  const cells = list(p.setup);
  compareSide(
    r,
    'militia',
    input.militia,
    cells.filter((x) => num(x.side) === MILITIA_SIDE),
  );
  compareSide(
    r,
    'enemy',
    input.enemies.map((e) => e.soldier),
    cells.filter((x) => num(x.side) === ENEMY_SIDE),
  );
  const unloadMain = seg.main.slice(main.position).filter((d) => d.n !== PATHFINDER_SKIP_LIST_RANGE);
  const unloadPre = seg.pre.slice(pre.position).filter((d) => d.n !== PRESERVED_POSITION_RANGE);
  r.same('creation: draws left besides the unload', [unloadPre.length, unloadMain.length], [0, 0]);
}

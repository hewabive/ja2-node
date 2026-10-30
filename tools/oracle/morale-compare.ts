import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { refreshMercMorale } from '../../src/sim/campaign/morale.ts';
import type { RosterMerc } from '../../src/sim/campaign/roster.ts';
import { getGroup } from '../../src/sim/strategic/forces/groups.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import { effectiveLeadership } from '../../src/sim/tactical/skills.ts';
import { NO_PROFILE } from '../../src/sim/tactical/soldier.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;

export const MORALE_PROBES: ReadonlySet<string> = new Set([
  'morale',
  'setmorale',
  'setrelation',
  'setprofile',
  'moralemove',
  'moralecounter',
  'hourlymorale',
  'quartermorale',
]);

const RELATION_SLOTS = 5;
const NUM_PROFILES = 255;

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

const args = (p: Json): Record<string, string> => (p.args ?? {}) as Record<string, string>;

export class MoraleComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #campaign: CampaignSim | null = null;

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#campaign = null;
  }

  async #session(): Promise<CampaignSim> {
    if (this.#campaign) return this.#campaign;
    if (!this.#bytes) throw new Error('morale probes need a save');
    const { session } = await createTacticalSaveSession(this.#read, this.#bytes, 1, this.#exists);
    this.#campaign = session.campaign;
    return this.#campaign;
  }

  #merc(c: CampaignSim, m: RosterMerc, team: readonly RosterMerc[]): Json {
    const s = m.soldier;
    const p = m.profile !== NO_PROFILE ? c.state.profiles.get(m.profile) : undefined;
    const opinions = p
      ? team.filter((o) => o.profile !== NO_PROFILE && o.profile < NUM_PROFILES).map((o) => p.opinions[o.profile] ?? 0)
      : [];
    const slots = (v: readonly number[] | undefined) => (p ? Array.from({ length: RELATION_SLOTS }, (_, k) => v?.[k] ?? 0) : []);
    const g = getGroup(c.economy ?? (c.strategic as NonNullable<CampaignSim['strategic']>), m.groupId);
    return {
      id: m.id,
      profile: m.profile,
      sector: [m.sector.x, m.sector.y, m.sector.z],
      group: m.groupId,
      inMotion: m.groupId !== 0 && g?.betweenSectors === true,
      assignment: m.assignment,
      asleep: m.asleep,
      inSector: s.placed,
      life: s.life,
      leadership: effectiveLeadership(s),
      morale: s.morale,
      mods: [s.teamMoraleMod, s.tacticalMoraleMod, s.strategicMoraleMod, s.delayedStrategicMoraleMod],
      opinions,
      hated: slots(p?.hated),
      hatedTime: slots(p?.hatedTime),
      hatedCount: slots(p?.hatedCount),
      buddies: slots(p?.buddies),
      learn: p
        ? [
            p.learnToHate,
            p.learnToHateTime,
            p.learnToHateCount,
            p.learnToLike,
            p.learnToLikeTime,
            p.learnToLikeCount,
            p.timeTillNextHatedComplaint,
          ]
        : [0, 0, 0, 0, 0, 0, 0],
    };
  }

  #theirMerc(m: Json): Json {
    return {
      id: m.id,
      profile: m.profile,
      sector: m.sector,
      group: m.group,
      inMotion: m.inMotion,
      assignment: m.assignment,
      asleep: m.asleep,
      inSector: m.inSector,
      life: m.life,
      leadership: m.leadership,
      morale: m.morale,
      mods: m.mods,
      opinions: m.opinions,
      hated: m.hated,
      hatedTime: m.hatedTime,
      hatedCount: m.hatedCount,
      buddies: m.buddies,
      learn: m.learn,
    };
  }

  #compareDump(label: string, c: CampaignSim, p: Json): number {
    const flow = c.battle;
    if (!flow) return report(label, false, 'no battle flow');
    const team = flow.roster.all();
    const ctx = flow.moraleContext();
    const ours = {
      counter: c.state.teamMorale.strategicDecayCounter,
      progress: ctx.progress,
      mercs: team.map((m) => this.#merc(c, m, team)),
    };
    const theirs = { counter: p.counter, progress: p.progress, mercs: ((p.mercs ?? []) as Json[]).map((m) => this.#theirMerc(m)) };
    const same = JSON.stringify(ours) === JSON.stringify(theirs);
    const detail = `counter ${String(ours.counter)} morale ${ours.mercs.map((m) => String(m.morale)).join('/')}`;
    if (same) return report(label, true, detail);
    const diffs: string[] = [];
    if (ours.counter !== theirs.counter) diffs.push(`counter: ours ${String(ours.counter)} oracle ${String(theirs.counter)}`);
    if (ours.progress !== theirs.progress) diffs.push(`progress: ours ${String(ours.progress)} oracle ${String(theirs.progress)}`);
    ours.mercs.forEach((m, i) => {
      const t = theirs.mercs[i] ?? {};
      for (const k of Object.keys(m)) {
        if (JSON.stringify(m[k]) !== JSON.stringify(t[k]))
          diffs.push(`merc ${String(m.id)} ${k}: ours ${JSON.stringify(m[k])} oracle ${JSON.stringify(t[k])}`);
      }
    });
    return report(label, false, `${detail}\n  ${diffs.slice(0, 12).join('\n  ')}`);
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line)}`;
    try {
      const c = await this.#session();
      const flow = c.battle;
      if (!flow) return report(label, false, 'no battle flow');
      const a = args(p);
      const count = Number(a.count ?? 1);
      switch (p.probe) {
        case 'setmorale': {
          const m = flow.roster.get(Number(a.who));
          if (!m) return report(label, false, `no merc ${a.who}`);
          const s = m.soldier;
          if (a.team !== undefined) s.teamMoraleMod = Number(a.team);
          if (a.tactical !== undefined) s.tacticalMoraleMod = Number(a.tactical);
          if (a.strategic !== undefined) s.strategicMoraleMod = Number(a.strategic);
          if (a.delayed !== undefined) s.delayedStrategicMoraleMod = Number(a.delayed);
          if (a.asleep !== undefined) m.asleep = Number(a.asleep) !== 0;
          refreshMercMorale(flow.moraleContext(), m);
          break;
        }
        case 'setrelation': {
          flow.moraleContext();
          const who = c.state.profiles.get(Number(a.who));
          if (!who) return report(label, false, `no profile progress ${a.who}`);
          const about = Number(a.about);
          if (a.opinion !== undefined) who.opinions[about] = Number(a.opinion);
          if (a.hated !== undefined) {
            const [slot = 0, time = 0, n = 0] = a.hated.split(':').map(Number);
            who.hated[slot] = about;
            who.hatedTime[slot] = time;
            who.hatedCount[slot] = n;
          }
          if (a.learnhate !== undefined) {
            const [time = 0, n = 0] = a.learnhate.split(':').map(Number);
            who.learnToHate = about;
            who.learnToHateTime = time;
            who.learnToHateCount = n;
          }
          if (a.learnlike !== undefined) {
            const [time = 0, n = 0] = a.learnlike.split(':').map(Number);
            who.learnToLike = about;
            who.learnToLikeTime = time;
            who.learnToLikeCount = n;
          }
          break;
        }
        case 'setprofile': {
          const m = flow.roster.byProfile(Number(a.who));
          if (!m) return report(label, false, `no merc with profile ${a.who}`);
          if (a.personality !== undefined) m.soldier.personalityTrait = Number(a.personality);
          if (a.personality !== undefined && m.profileRecord)
            Object.assign(m, { profileRecord: { ...m.profileRecord, personalityTrait: Number(a.personality) } });
          if (a.attitude !== undefined) {
            const progress = c.state.profiles.get(Number(a.who));
            if (progress) Object.assign(progress, { attitude: Number(a.attitude) });
          }
          break;
        }
        case 'moralemove': {
          const t = c.tactical?.state;
          const m = flow.roster.get(Number(a.who));
          if (!t || !m) return report(label, false, `no merc ${a.who} in the loaded sector`);
          setSoldierPosition(t, m.soldier, Number(a.to));
          break;
        }
        case 'moralecounter':
          c.state.teamMorale.strategicDecayCounter = Number(a.value ?? 0);
          break;
        case 'hourlymorale':
          for (let i = 0; i < count; i++) {
            flow.updateBuddyAndHatedCounters();
            flow.hourlyMoraleUpdate();
          }
          break;
        case 'quartermorale':
          for (let i = 0; i < count; i++) flow.decayTacticalMoraleModifiers();
          break;
      }
      return this.#compareDump(label, c, p);
    } catch (e) {
      return report(label, false, e instanceof Error ? (e.stack ?? e.message) : String(e));
    }
  }
}

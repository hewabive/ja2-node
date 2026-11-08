import { basename, dirname } from 'node:path';
import { parseSectorString, type Sector } from '../../src/content/strategic/sector-ids.ts';
import { WORLD_MAX } from '../../src/content/world/grid.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { SoldierInitNode } from '../../src/sim/tactical/init-list.ts';
import { LightSpriteFlags, lightTrueLevel } from '../../src/sim/tactical/lighting/lighting.ts';
import { NO_PROFILE, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import { nativeSectorRecords, sectorRecords, sortedRecords } from './absent-compare.ts';
import { firstDifference, report } from './actions-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;
type Row = readonly number[];

const SAVE_SECTORS_OUTPUT = 'entries.jsonl';
const SAVE_SECTORS_DIR = 'save-sectors';
const SEED = 1;
const NO_SOLDIER = -1;
const NATIVE_NOWHERE = 25601;
const MAX_REPORTED_TILES = 12;
const SPRITE_STATE_FLAGS = LightSpriteFlags.ON | LightSpriteFlags.PRIMETIME | LightSpriteFlags.NIGHTTIME;
const SECTOR_FLAGS = 0;
const SECTOR_TIME_LAST_LOADED = 18;
const SECTOR_VISIBLE_ITEMS = 21;
const UNDERGROUND_FLAGS = 3;
const UNDERGROUND_TIME_LAST_LOADED = 8;

const num = (v: unknown) => Number(v ?? 0);

export function isSaveSectorsOutput(path: string): boolean {
  return basename(path) === SAVE_SECTORS_OUTPUT && basename(dirname(path)) === SAVE_SECTORS_DIR;
}

function fnv1a32(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function differingEntries(ours: Uint8Array, base64: unknown): string[] {
  if (typeof base64 !== 'string') return [];
  const theirs = new Uint8Array(Buffer.from(base64, 'base64'));
  const out: string[] = [];
  for (let k = 0; k < theirs.length; k++) if (theirs[k] !== ours[k]) out.push(`${k}:${ours[k]}/${theirs[k]}`);
  return out;
}

function sectorOf(a: Json): Sector {
  const s = parseSectorString(String(a.sector ?? ''));
  if (!s) throw new Error(`bad sector ${String(a.sector)}`);
  return { ...s, z: num(a.z) };
}

function nodeRow(t: TacticalState, n: SoldierInitNode): Row {
  const s = n.hasSoldier ? t.soldiers[n.soldierId] : undefined;
  return [
    n.index,
    n.team,
    n.soldierClass,
    n.priorityExistence ? 1 : 0,
    n.detailed ? 1 : 0,
    s?.id ?? NO_SOLDIER,
    s?.soldierClass ?? NO_SOLDIER,
  ];
}

function soldierRow(s: Soldier): Row {
  return [s.id, s.team, s.profile, s.bodyType, s.gridNo, s.level, s.soldierClass];
}

function nativeSoldierRow(s: Json): Row {
  return [num(s.id), num(s.team), num(s.profile), num(s.body), num(s.gridNo), num(s.level), num(s.soldierClass)];
}

function activeNpc(s: Soldier | null | undefined): boolean {
  return s !== null && s !== undefined && (s.placed || s.offMap || s.away) && s.team !== Team.OUR && s.profile !== NO_PROFILE;
}

function npcRow(s: Soldier): Row {
  return [s.id, s.profile, s.team, s.gridNo, s.life];
}

function nativeNpcRow(s: Json): Row {
  return [num(s.id), num(s.profile), num(s.team), num(s.gridNo) === NATIVE_NOWHERE ? -1 : num(s.gridNo), num(s.life)];
}

function spriteList(
  sprites: readonly { readonly x: unknown; readonly y: unknown; readonly flags: unknown; readonly template: string }[],
): string {
  return sprites
    .map((l) => `${l.x},${l.y},${Number(l.flags) & SPRITE_STATE_FLAGS},${l.template.toUpperCase()}`)
    .sort()
    .join(' ');
}

export class SaveSectorsComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  readonly #saveBytes: (name: string) => Uint8Array;
  #session: CampaignSession | null = null;

  constructor(read: ReadFile, exists: FileExists, saveBytes: (name: string) => Uint8Array) {
    this.#read = read;
    this.#exists = exists;
    this.#saveBytes = saveBytes;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    if (p.error) return report(label, false, `oracle error: ${String(p.error)}`);
    try {
      return await this.#compare(label, p);
    } catch (e) {
      return report(label, false, `ja2-node error: ${(e as Error).message}`);
    }
  }

  async #compare(label: string, p: Json): Promise<number> {
    if (p.probe === 'end') return 0;
    if (p.probe === 'save') {
      this.#session = (await createTacticalSaveSession(this.#read, this.#saveBytes(String(p.name)), SEED, this.#exists)).session;
      return 0;
    }
    const session = this.#session;
    if (!session) return report(label, false, 'no save loaded');
    const a = (p.args as Json | undefined) ?? {};
    switch (p.probe) {
      case 'abrecords':
        return this.#same(label, sortedRecords(sectorRecords(session.campaign, sectorOf(a))), sortedRecords(nativeSectorRecords(p)));
      case 'entersector':
        return this.#enter(label, session, sectorOf(a), p);
      case 'groups':
        return this.#groups(label, session, p);
      case 'initlist':
        return this.#initList(label, this.#loaded(session), p);
      case 'abmap':
        return this.#doors(label, this.#loaded(session), p);
      case 'costs':
        return this.#costs(label, this.#loaded(session), p);
      case 'lights':
        return this.#lights(label, this.#loaded(session), p);
      case 'soldiers':
        return this.#soldiers(label, this.#loaded(session), p);
      default:
        return report(label, false, 'not a probe of the native save sectors');
    }
  }

  #loaded(session: CampaignSession): TacticalState {
    const t = session.campaign.tactical?.state;
    if (!t) throw new Error('no sector loaded');
    return t;
  }

  #same(label: string, ours: unknown, theirs: unknown): number {
    const d = firstDifference(ours, theirs);
    return report(label, d === null, d ?? 'same');
  }

  async #enter(label: string, session: CampaignSession, sector: Sector, p: Json): Promise<number> {
    const c = session.campaign;
    await session.prepare({ type: 'enterSector', sector: String((p.args as Json).sector) });
    if (!c.sectors?.setCurrentWorldSector(sector)) return report(label, false, 'sector map not loaded');
    const t = this.#loaded(session);
    const ours = t.soldiers.filter((s): s is Soldier => activeNpc(s)).map(npcRow);
    const theirs = (((p.result as Json).soldiers as Json[] | undefined) ?? []).map(nativeNpcRow);
    return this.#same(label, ours, theirs);
  }

  #groups(label: string, session: CampaignSession, p: Json): number {
    const map = session.campaign.state.map;
    const ours = {
      sectors: map.sectors.map((s) => [s.flags, s.timeLastLoaded, s.visibleItems]),
      underground: map.underground.map((u) => [u.sector.x, u.sector.y, u.sector.z, u.flags, u.timeLastLoaded]),
    };
    const theirs = {
      sectors: ((p.sectors as number[][] | undefined) ?? []).map((s) => [
        s[SECTOR_FLAGS],
        s[SECTOR_TIME_LAST_LOADED],
        s[SECTOR_VISIBLE_ITEMS],
      ]),
      underground: ((p.underground as number[][] | undefined) ?? []).map((u) => [
        ...u.slice(0, UNDERGROUND_FLAGS + 1),
        u[UNDERGROUND_TIME_LAST_LOADED],
      ]),
    };
    return this.#same(label, ours, theirs);
  }

  #initList(label: string, t: TacticalState, p: Json): number {
    return this.#same(
      label,
      t.initList.map((n) => nodeRow(t, n)),
      p.before,
    );
  }

  #doors(label: string, t: TacticalState, p: Json): number {
    const ours = [...t.world.mapDoors.values()].map((d) => [d.gridNo, d.locked ? 1 : 0, d.lockId]);
    return this.#same(label, ours, ((p.result as Json).doors as Row[] | undefined) ?? []);
  }

  #costs(label: string, t: TacticalState, p: Json): number {
    const ours = t.world.costs.values;
    const hash = fnv1a32(ours);
    const differing = differingEntries(ours, p.base64);
    return report(
      label,
      hash === String(p.fnv1a32).padStart(8, '0') && differing.length === 0,
      `fnv1a32 ${hash}/${p.fnv1a32}, ${differing.length} differing entries ${differing.slice(0, MAX_REPORTED_TILES).join(' ')}`,
    );
  }

  #lights(label: string, t: TacticalState, p: Json): number {
    const level = num(p.level);
    const ours = Uint8Array.from({ length: WORLD_MAX }, (_, g) => lightTrueLevel(t, g, level));
    const hash = fnv1a32(ours);
    const differing = differingEntries(ours, p.base64);
    const sprites = spriteList(
      t.lighting.sprites.flatMap((l) => (l && l.flags & LightSpriteFlags.ACTIVE ? [{ ...l, template: l.template.name }] : [])),
    );
    const theirSprites = spriteList(
      ((p.sprites as Json[] | undefined) ?? [])
        .filter((l) => !(num(l.flags) & LightSpriteFlags.MERC_LIGHT))
        .map((l) => ({ x: l.x, y: l.y, flags: l.flags, template: String(l.template) })),
    );
    const same = hash === p.fnv1a32 && differing.length === 0 && t.lighting.ambient === p.ambient && sprites === theirSprites;
    return report(
      `${label} level ${level}`,
      same,
      `fnv1a32 ${hash}/${p.fnv1a32}, ambient ${t.lighting.ambient}/${p.ambient}, ${differing.length} differing tiles ` +
        `${differing.slice(0, MAX_REPORTED_TILES).join(' ')}${sprites === theirSprites ? '' : `, sprites ${sprites} vs ${theirSprites}`}`,
    );
  }

  #soldiers(label: string, t: TacticalState, p: Json): number {
    const ours = t.soldiers.filter((s): s is Soldier => s?.placed === true).map(soldierRow);
    return this.#same(label, ours, ((p.soldiers as Json[] | undefined) ?? []).map(nativeSoldierRow));
  }
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { edtRowCount } from '../src/content/formats/edt.ts';
import { type MapDef, parseMap } from '../src/content/formats/map.ts';
import { NO_MOVE, NO_QUOTE, type NpcRecord, requiredGridNo } from '../src/content/formats/npc.ts';
import { parseDetailedPlacement } from '../src/content/formats/placement.ts';
import { loadItemTable } from '../src/content/items/items.ts';
import { npcDialogueFile } from '../src/content/narrative/dialogue-text.ts';
import { Approach } from '../src/content/narrative/npc-constants.ts';
import { loadNpcRecordContent, meanwhileKey, type NpcRecordContent } from '../src/content/narrative/npc-records.ts';
import { parseJsonc } from '../src/content/strategic/jsonc.ts';
import { MEANWHILE_MAP_SECTOR } from '../src/content/strategic/sector-ids.ts';
import { sectorMapPath } from '../src/content/strategic/sector-maps.ts';
import { vfsFileReader } from '../src/content/vfs/vfs.ts';
import { type DataVfs, openDataVfs } from '../src/node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import { Meanwhile } from '../src/sim/strategic/ai/constants.ts';
import { Npc } from '../src/sim/strategic/narrative/npc-ids.ts';
import { NpcActionCode as A } from '../src/sim/tactical/narrative/npc-actions/codes.ts';
import { sharedStubPackDir } from '../tests/support/stub-pack.ts';

interface Step {
  readonly npc: number;
  readonly record: number;
  readonly approach: number;
}

type Next = Step | 'end';

const SPEAKERS: readonly number[] = [Npc.QUEEN, Npc.ELLIOT];
const MEDUNA_SCENES = Object.values(Meanwhile).filter((id) => id !== Meanwhile.INTERROGATION);
const SCENE_START: Step = { npc: Npc.QUEEN, record: 0, approach: Approach.TRIGGER_NPC };
const triggered = (npc: number, record: number): Step => ({ npc, record, approach: Approach.TRIGGER_NPC });
const RECORDS_A_SELECTOR_TRIGGERS: ReadonlyMap<number, readonly Next[]> = new Map([
  [A.TRIGGER_QUEEN_BY_CITIES_CONTROLLED, [7, 8, 9, 10, 11].map((record) => triggered(Npc.QUEEN, record))],
  [A.TRIGGER_QUEEN_BY_SAM_SITES_CONTROLLED, [7, 8, 9].map((record) => triggered(Npc.QUEEN, record))],
  [A.TRIGGER_ELLIOT_BY_BATTLE_RESULT, [6, 8].map((record) => triggered(Npc.ELLIOT, record))],
  [A.NO_SCI_FI_END_MEANWHILE, ['end', triggered(Npc.QUEEN, 8)]],
  [A.END_MEANWHILE, ['end']],
]);
const ATTACKS_ON_THE_AIDE: ReadonlySet<number> = new Set([A.SLAP, A.SHOOT_ELLIOT]);
const AFTER_THE_ATTACK: Step = { npc: Npc.QUEEN, record: -1, approach: Approach.DONE_SLAPPED };

let data: DataVfs;
let records: NpcRecordContent;
let hall: MapDef;

beforeAll(async () => {
  data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, stubsDir: sharedStubPackDir() });
  const items = await loadItemTable(async (path) => parseJsonc(await readFile(join(PROJECT_DATA_DIR, path), 'utf8')));
  records = await loadNpcRecordContent({ read: vfsFileReader(data.vfs), items });
  const exists = (path: string) => data.vfs.stat(path) !== undefined;
  hall = parseMap(await data.vfs.read(sectorMapPath(exists, MEANWHILE_MAP_SECTOR, false, true)));
});

afterAll(async () => {
  await data.close();
});

function sceneRecords(scene: number, npc: number): readonly NpcRecord[] {
  const found = records.meanwhiles.get(meanwhileKey(scene, npc));
  if (!found) throw new Error(`no records of ${npc} for meanwhile ${scene}`);
  return found;
}

function live(r: NpcRecord | undefined): r is NpcRecord {
  return r !== undefined && r.approachRequired !== Approach.NONE;
}

function liveRecords(scene: number, npc: number): NpcRecord[] {
  return sceneRecords(scene, npc).filter(live);
}

function recordWhere(scene: number, npc: number, test: (r: NpcRecord) => boolean): number {
  return sceneRecords(scene, npc).findIndex((r) => live(r) && test(r));
}

function nextSteps(scene: number, at: Step, r: NpcRecord): Next[] {
  const found: Next[] = [];
  if (SPEAKERS.includes(r.triggerNpc)) found.push(triggered(r.triggerNpc, r.triggerNpcRecord));
  if (r.goToGridNo !== NO_MOVE)
    found.push(
      triggered(
        at.npc,
        recordWhere(scene, at.npc, (q) => requiredGridNo(q) === r.goToGridNo),
      ),
    );
  if (ATTACKS_ON_THE_AIDE.has(r.actionData))
    found.push({ ...AFTER_THE_ATTACK, record: recordWhere(scene, Npc.QUEEN, (q) => q.approachRequired === Approach.DONE_SLAPPED) });
  found.push(...(RECORDS_A_SELECTOR_TRIGGERS.get(r.actionData) ?? []));
  return found;
}

function expectEveryPathToEndTheScene(scene: number, at: Step, path: readonly string[]): void {
  const here = `${at.npc}/${at.record}`;
  const where = `meanwhile ${scene}: ${[...path, here].join(' → ')}`;
  expect(path, `${where} loops`).not.toContain(here);
  const r = sceneRecords(scene, at.npc)[at.record];
  expect(live(r) && r.approachRequired, `${where} reaches no live record`).toBe(at.approach);
  if (!live(r)) return;
  const next = nextSteps(scene, at, r);
  expect(next.length, `${where} stops before END_MEANWHILE`).toBeGreaterThan(0);
  for (const step of next) if (step !== 'end') expectEveryPathToEndTheScene(scene, step, [...path, here]);
}

function sceneWalks(scene: number): number[] {
  return SPEAKERS.flatMap((npc) => liveRecords(scene, npc).flatMap((r) => (r.goToGridNo === NO_MOVE ? [] : [r.goToGridNo])));
}

function placementOf(profile: number): number {
  const p = hall.placements.find((q) => q.detailedRaw && parseDetailedPlacement(q.detailedRaw).profile === profile);
  if (!p) throw new Error(`P3_m does not place ${profile}`);
  return p.basic.startingGridNo;
}

describe('the stub meanwhile scenes in the palace', () => {
  it('give the Queen and her aide a record file for every scene, and every path through it ends the meanwhile', () => {
    expect(MEDUNA_SCENES).toHaveLength(16);
    for (const scene of MEDUNA_SCENES) expectEveryPathToEndTheScene(scene, SCENE_START, []);
  });

  it('walk the Queen only to free tiles of her hall on P3_m and give the lines numbers past the interrogation text', async () => {
    const room = hall.rooms[placementOf(Npc.QUEEN)];
    expect(room).not.toBe(0);
    const occupied = new Set(hall.placements.map((p) => p.basic.startingGridNo));
    for (const scene of MEDUNA_SCENES) {
      expect(sceneWalks(scene).length, `meanwhile ${scene}`).toBeGreaterThan(0);
      for (const gridNo of sceneWalks(scene)) {
        expect(hall.rooms[gridNo], `meanwhile ${scene} walks to ${gridNo}`).toBe(room);
        expect(occupied.has(gridNo), `meanwhile ${scene} walks onto a soldier at ${gridNo}`).toBe(false);
      }
    }
    for (const npc of SPEAKERS) {
      const rows = edtRowCount(await data.vfs.read(`stubs/${npcDialogueFile(npc)}`));
      for (const scene of MEDUNA_SCENES)
        for (const r of liveRecords(scene, npc))
          if (r.quoteNum !== NO_QUOTE) expect(r.quoteNum, `meanwhile ${scene}, profile ${npc}`).toBeGreaterThanOrEqual(rows);
    }
  });

  it('shoot the aide in the outskirts scene, and count the towns and the missile sites in a scene each', () => {
    const actions = (scene: number, npc: number) => liveRecords(scene, npc).map((r) => r.actionData);
    expect(actions(Meanwhile.OUTSKIRTS_MEDUNA, Npc.QUEEN)).toContain(A.SHOOT_ELLIOT);
    expect(actions(Meanwhile.OUTSKIRTS_MEDUNA, Npc.QUEEN)).not.toContain(A.SLAP);
    expect(actions(Meanwhile.DRASSEN_LIBERATED, Npc.QUEEN)).toContain(A.TRIGGER_QUEEN_BY_CITIES_CONTROLLED);
    expect(actions(Meanwhile.NW_SAM, Npc.QUEEN)).toContain(A.TRIGGER_QUEEN_BY_SAM_SITES_CONTROLLED);
    for (const scene of MEDUNA_SCENES) expect(actions(scene, Npc.ELLIOT), `meanwhile ${scene}`).not.toContain(A.SHOOT_ELLIOT);
  });
});

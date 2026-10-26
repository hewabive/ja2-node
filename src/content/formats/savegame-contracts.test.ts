import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { openDataVfs } from '../../node/data-vfs.ts';
import { FormatError } from '../binary/errors.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { PROFILES_PATH, parseProfiles } from './prof.ts';
import { parseSaveGame, type SaveSection } from './savegame.ts';
import { readContractRenewals, readLeaveItemList, readMercAccountStatus } from './savegame-contracts.ts';
import { parseSaveEncryptionTable } from './savegame-header.ts';

const RENEWAL_SLOTS = 20;
const LEAVE_SLOTS = 20;
const LEAVE_NODE_BYTES = 40;
const NO_PROFILE = 200;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const AIM_MERC_KIND = 1;
const AIM_PROFILES = 40;
const NUM_PROFILES_IN_FILE = 170;

function sectionAt(name: string, bytes: Uint8Array): { bytes: Uint8Array; sections: SaveSection[] } {
  return { bytes, sections: [{ name, offset: 0, size: bytes.length }] };
}

function renewalSection(profiles: readonly number[]): Uint8Array {
  const w = new BinaryWriter();
  for (let i = 0; i < RENEWAL_SLOTS; i++) w.u8(profiles[i] ?? 0).zeros(3);
  return w.u8(profiles.length).toBytes();
}

describe('contract sections of a savegame', () => {
  it('reads the renewal list with its count', () => {
    const { bytes, sections } = sectionAt('contract renewals', renewalSection([7, 12]));
    const r = readContractRenewals(bytes, sections);
    expect(r.count).toBe(2);
    expect(r.profiles.slice(0, 3)).toEqual([7, 12, 0]);
    expect(r.profiles).toHaveLength(RENEWAL_SLOTS);
  });

  it('reads the leave lists, empty or not, and their owners after all of them', () => {
    const w = new BinaryWriter();
    w.u8(1).u32(1);
    const node = new Uint8Array(LEAVE_NODE_BYTES);
    new DataView(node.buffer).setUint16(0, 70, true);
    node[2] = 1;
    node[4] = 90;
    w.bytes(node);
    w.u8(1).u32(0);
    for (let i = 2; i < LEAVE_SLOTS; i++) w.u8(0);
    w.u32(7).u32(9);
    for (let i = 2; i < LEAVE_SLOTS; i++) w.u32(NO_PROFILE);
    const { bytes, sections } = sectionAt('leave item list', w.toBytes());
    const slots = readLeaveItemList(bytes, sections);
    expect(slots).toHaveLength(LEAVE_SLOTS);
    expect(slots[0]?.owner).toBe(7);
    expect(slots[0]?.items?.map((o) => [o.item, o.count, o.status[0]])).toEqual([[70, 1, 90]]);
    expect(slots[1]).toEqual({ items: [], owner: 9 });
    expect(slots[2]).toEqual({ items: null, owner: NO_PROFILE });
  });

  it('refuses a save without the section', () => {
    expect(() => readContractRenewals(new Uint8Array(0), [])).toThrow(FormatError);
  });
});

const dataDir = ORIGINAL_DATA_DIR;
const savesDir = join(dirname(dataDir), 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];

describe.skipIf(!ORIGINAL_DATA_DIR)('contract fields of the original data', () => {
  const encryption = parseSaveEncryptionTable(
    JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/save-encryption.json'), 'utf8')),
  );

  it.each(saveFiles)('decodes the contract state of %s', (file) => {
    const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
    const save = parseSaveGame(bytes, encryption);
    const renewals = readContractRenewals(bytes, save.sections);
    expect(renewals.count).toBeLessThanOrEqual(RENEWAL_SLOTS);
    for (const id of renewals.profiles.slice(0, renewals.count)) expect(id).toBeLessThan(NUM_PROFILES_IN_FILE);
    const leave = readLeaveItemList(bytes, save.sections);
    expect(leave).toHaveLength(LEAVE_SLOTS);
    for (const slot of leave) expect(slot.items === null || slot.owner < NUM_PROFILES_IN_FILE).toBe(true);
    expect(readMercAccountStatus(bytes, save.sections)).toBeGreaterThanOrEqual(0);
    const now = Math.trunc(save.clock.gameClock / MINUTES_PER_HOUR);
    const aim = save.soldiers.map((e) => e.soldier).filter((s) => s.team === 0 && s.whatKindOfMercAmI === AIM_MERC_KIND);
    expect(aim.length).toBeGreaterThan(0);
    for (const s of aim) {
      const c = s.contract;
      expect(c.totalContractLength).toBeGreaterThan(0);
      expect(c.contractEnd).toBeGreaterThan(now);
      expect(c.timeWillArrive).toBeLessThanOrEqual(now);
      const arrivalHour = Math.trunc((c.timeWillArrive % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
      expect(Math.trunc((c.contractEnd % MINUTES_PER_DAY) / MINUTES_PER_HOUR)).toBe(arrivalHour);
      expect(c.contractEnd % MINUTES_PER_HOUR).toBe(0);
      expect(c.medicalDeposit).toBeGreaterThanOrEqual(0);
    }
  });

  it('reads the contract fields of every profile', async () => {
    const d = await openDataVfs({ dataDir });
    const profiles = await d.vfs.read(PROFILES_PATH).then(parseProfiles, () => []);
    await d.close();
    expect(profiles).toHaveLength(NUM_PROFILES_IN_FILE);
    const aim = profiles.slice(0, AIM_PROFILES);
    for (const p of aim) {
      expect(p.salary).toBeGreaterThan(0);
      expect(p.weeklySalary).toBeGreaterThan(0);
      expect(p.weeklySalary).toBeLessThanOrEqual(7 * p.salary);
      expect(p.biWeeklySalary).toBeGreaterThan(p.weeklySalary);
      expect(p.biWeeklySalary).toBeLessThanOrEqual(14 * p.salary);
      expect([0, 1]).toContain(p.medicalDeposit);
    }
    for (const p of profiles) {
      expect(p.mercStatus).toBe(0);
      expect(p.totalDaysServed).toBe(0);
      expect(p.balance).toBe(0);
      expect(p.reputationTolerance).toBeGreaterThanOrEqual(0);
      expect(p.reputationTolerance).toBeLessThanOrEqual(101);
    }
  });
});

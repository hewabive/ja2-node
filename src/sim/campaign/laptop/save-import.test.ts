import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SaveGame } from '../../../content/formats/savegame.ts';
import { parseSaveGame } from '../../../content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../../../content/formats/savegame-header.ts';
import { readSavedLaptop, type SavedLaptop, type SavedLaptopInfo } from '../../../content/formats/savegame-laptop.ts';
import { loadLaptopContent } from '../../../content/strategic/laptop-content.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { createSaveSession } from '../../../server/save-session.ts';
import { createStrategicState } from '../../strategic/state.ts';
import { loadTacticalContent } from '../../tactical/load-content.ts';
import { Team } from '../../tactical/soldier.ts';
import { mailType } from './mail.ts';
import { applySavedLaptop, PLAYER_GENERATED_CHARACTER_ID } from './save-import.ts';

const PERSONNEL = 256;
const AIM_MERC_KIND = 1;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const CONTRACT_HOURS = [7, 13, 19];

function info(overrides: Partial<SavedLaptopInfo>): SavedLaptopInfo {
  return {
    newGameLaptop: false,
    bookmarks: [0, 2],
    currentBalance: 0,
    impCompleted: false,
    sentImpWarningAlready: true,
    deadCharacters: new Array<number>(PERSONNEL).fill(-1),
    leftCharacters: new Array<number>(PERSONNEL).fill(-1),
    otherCharacters: new Array<number>(PERSONNEL).fill(-1),
    mercAccountStatus: 4,
    mercAccountNumber: 77,
    lastMercIndex: 9,
    bobbyRayInventory: [{ item: 5, onHand: 3, onOrder: 0, quality: 100, previouslyEligible: true }],
    bobbyRayUsedInventory: [],
    inventoryListLength: [1, 0],
    lifeInsurancePayouts: [{ active: true, soldier: 2, profile: 11, payout: 1500 }],
    lifeInsurancePayoutsUsed: 1,
    bobbyRaySiteCanBeAccessed: true,
    playerBeenToMercSiteStatus: 3,
    firstVisitSinceServerWentDown: 2,
    newMercsAvailableAtMercSite: false,
    saidGenericOpeningInMercSite: true,
    speckSaidFloMarriedCousinQuote: false,
    hasAMercDiedAtMercSite: false,
    voiceId: 1,
    bobbyRayUnderConstructionVisit: 2,
    mercSiteHasGoneDownYet: true,
    speckCanSayPlayersLostQuote: 0,
    lastHiredMerc: { profile: 3, arrival: 1890 },
    speckQuoteFlags: 1,
    flowerOrderNumber: 12,
    totalMoneyPaidToSpeck: 20000,
    lastMercAvailableId: 3,
    ...overrides,
  };
}

function saved(overrides: Partial<SavedLaptop> = {}, infoOverrides: Partial<SavedLaptopInfo> = {}): SavedLaptop {
  return {
    info: info(infoOverrides),
    shipments: [
      {
        active: true,
        destination: 2,
        speed: 1,
        lines: [{ item: 5, count: 2, quality: 100, slot: 0, used: false }],
        weight: 20,
        orderDay: 3,
        displayedOnShipmentsPage: true,
      },
    ],
    history: [{ code: 1, secondCode: 4, date: 1500, x: -1, y: -1, z: 0 }],
    files: [{ code: 0, read: true }],
    emails: [
      { offset: 138, length: 3, sender: 0, date: 1500, firstData: 0, secondData: 0, read: true },
      { offset: 19, length: 5, sender: 4, date: 6180, firstData: 0, secondData: 0, read: false },
    ],
    impSlotStates: null,
    voiceIds: null,
    mercArriveSector: { x: 9, y: 1 },
    ...overrides,
  };
}

const SAVE = { profiles: [], facts: [0, 1], quests: [2] } as unknown as SaveGame;

describe('importing the laptop state', () => {
  it('copies mails with fresh ids, records, sites, payouts and the landing zone', () => {
    const state = createStrategicState();
    applySavedLaptop(state, SAVE, saved());
    const l = state.laptop;
    expect(l.emails.map((m) => [m.id, m.offset, m.read])).toEqual([
      [0, 138, true],
      [1, 19, false],
    ]);
    expect(l.nextEmailId).toBe(2);
    expect(l.bookmarks).toEqual([0, 2]);
    expect(l.history).toEqual([{ code: 1, secondCode: 4, date: 1500, x: -1, y: -1, z: 0 }]);
    expect(l.merc).toMatchObject({
      accountStatus: 4,
      accountNumber: 77,
      lastMercIndex: 9,
      firstVisitSinceServerWentDown: 2,
      totalMoneyPaidToSpeck: 20000,
    });
    expect(l.bobbyRay).toMatchObject({ siteCanBeAccessed: true, underConstructionVisit: 2, used: [], shipmentsSinceNoBribes: 0 });
    expect(l.bobbyRay.inventory).toEqual([{ item: 5, onHand: 3, onOrder: 0, quality: 100, previouslyEligible: true }]);
    expect(l.bobbyRay.shipments[0]?.lines).toEqual([{ item: 5, count: 2, quality: 100, slot: 0, used: false }]);
    expect(l.insurance).toEqual({ payouts: [{ active: true, soldier: 2, profile: 11, payout: 1500 }], used: 1 });
    expect(l.mercArriveSector).toBe(8);
    expect(l.floristOrderNumber).toBe(12);
    expect(state.narrative.facts[1]).toBe(1);
  });

  it('falls back to the start sector for an invalid landing zone and to iVoiceId for old I.M.P. saves', () => {
    const state = createStrategicState();
    applySavedLaptop(state, SAVE, saved({ mercArriveSector: { x: 0, y: 0 } }, { impCompleted: true, voiceId: 2 }), { startSector: 8 });
    expect(state.laptop.mercArriveSector).toBe(8);
    expect(state.laptop.imp.taken).toEqual([PLAYER_GENERATED_CHARACTER_ID + 2]);
  });

  it('reads the taken I.M.P. slots from the per-profile states', () => {
    const state = createStrategicState();
    const slots = new Array<number>(200).fill(0);
    slots[52] = 1;
    slots[170] = 1;
    applySavedLaptop(state, SAVE, saved({ impSlotStates: slots, voiceIds: slots.map((_, i) => i) }));
    expect(state.laptop.imp.taken).toEqual([52, 170]);
    expect([...state.laptop.imp.voices]).toEqual([
      [52, 52],
      [170, 170],
    ]);
  });

  it('moves the last M.E.R.C. index back by one for old saves listing both Larrys', () => {
    const state = createStrategicState();
    const mercListings = [40, 41, 42, 43, 44, 45, 50, 46, 49, 48].map((profile, index) => ({
      index,
      profile,
      minTotalSpending: 0,
      minDays: 0,
    }));
    applySavedLaptop(state, SAVE, saved({}, { lastMercAvailableId: 3, lastMercIndex: 10 }), {
      mercListings,
      namedProfiles: { NUMB: 49, COUGAR: 48 },
    });
    expect(state.laptop.merc.lastMercIndex).toBe(9);
  });
});

const dataDir = process.env.JA2_DATA_DIR ?? '';
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = join(gameRoot, 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];

describe.skipIf(!process.env.JA2_DATA_DIR)('the laptop of the native savegames in a campaign session', () => {
  let data: DataVfs;
  const read = async (p: string) => (data.vfs.stat(p) ? data.vfs.read(p) : null);

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  });
  afterAll(async () => {
    await data.close();
  });

  for (const file of saveFiles) {
    it(`imports ${file}`, async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode((await read(SAVE_ENCRYPTION_PATH)) ?? new Uint8Array())));
      const save = parseSaveGame(bytes, table);
      const decoded = readSavedLaptop(bytes, save);
      const content = await loadLaptopContent(read, (await loadTacticalContent(read)).items);
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const state = session.campaign.state;
      const l = state.laptop;
      expect(session.campaign.laptop).not.toBeNull();
      expect(state.finances.balance).toBe(save.laptop.currentBalance);
      expect(l.emails).toHaveLength(decoded.emails.length);
      expect(l.emails.every((m) => mailType(content, m.offset).type !== 'UNKNOWN')).toBe(true);
      expect(l.history).toHaveLength(decoded.history.length);
      expect(l.bobbyRay.inventory).toHaveLength(decoded.info.inventoryListLength[0]);
      expect(l.bobbyRay.used).toHaveLength(decoded.info.inventoryListLength[1]);
      expect(l.merc.accountStatus).toBe(decoded.info.mercAccountStatus);
      expect(l.merc.lastMercIndex).toBeLessThan(content.mercListings.length);
      expect(Array.from(state.narrative.facts.slice(0, save.facts.length))).toEqual([...save.facts]);
      const aim = save.soldiers
        .map((e) => e.soldier)
        .filter((s) => s.team === Team.OUR && s.active && s.whatKindOfMercAmI === AIM_MERC_KIND);
      for (const s of aim) {
        const merc = session.campaign.laptop?.roster.get(s.id);
        expect(merc?.contract.useLandingZone).toBe(s.contract.useLandingZone);
        expect(merc?.contract.timeWillArrive).toBe(s.contract.timeWillArrive);
        const end = s.contract.contractEnd;
        expect(CONTRACT_HOURS).toContain(Math.trunc((end % MINUTES_PER_DAY) / MINUTES_PER_HOUR));
      }
    });
  }
});

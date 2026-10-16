import { parseSaveGame, type SaveGame } from '../content/formats/savegame.ts';
import { readSavedEconomy, readSoldierAssignments } from '../content/formats/savegame-economy.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../content/formats/savegame-header.ts';
import { readSavedMerchants } from '../content/formats/savegame-merchants.ts';
import { readSavedNpcRecords } from '../content/formats/savegame-npc.ts';
import { readStrategicAiSections } from '../content/formats/savegame-strategic-ai.ts';
import { decodePreservedSoldierLinks, type PreservedSoldierLink } from '../content/formats/savegame-temp-files.ts';
import type { LayerCount } from '../content/narrative/npc-records.ts';
import { loadArmyContent } from '../content/strategic/army.ts';
import { loadEconomyContent } from '../content/strategic/economy-content.ts';
import { dialogueProfiles, loadLaptopContent } from '../content/strategic/laptop-content.ts';
import { loadMerchantContent } from '../content/strategic/merchant-content.ts';
import { loadStrategicContent } from '../content/strategic/strategic-content.ts';
import { loadTacticalWorld } from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { importContracts } from '../sim/campaign/contracts/save-import.ts';
import { importLaptop } from '../sim/campaign/laptop/save-import.ts';
import { NO_ROSTER_HOOKS, Roster } from '../sim/campaign/roster.ts';
import { addSavedMercsToRoster } from '../sim/campaign/save-roster.ts';
import { importStory, type SavedStory, storyImportRefusal } from '../sim/campaign/story-import.ts';
import { importNpcRecords } from '../sim/narrative/save-import.ts';
import { importStrategicAi } from '../sim/strategic/ai/save-import.ts';
import { importMerchants } from '../sim/strategic/economy/merchants/save-import.ts';
import { applySavedAssignment, importEconomy } from '../sim/strategic/economy/save-import.ts';
import { importStrategicMap } from '../sim/strategic/map/save-import.ts';
import { importNarrativeSave } from '../sim/strategic/narrative/save-import.ts';
import { createStrategicState } from '../sim/strategic/state.ts';
import { importStrategicTime } from '../sim/strategic/time/save-import.ts';
import { loadTacticalContent } from '../sim/tactical/load-content.ts';
import { importSave, type SaveImportReport, saveMapPath, worldWithSavedDoors } from '../sim/tactical/save-import.ts';
import { removeSoldierFromTacticalSector } from '../sim/tactical/sector-presence.ts';
import { TEAM_FIRST_ID, TEAM_SIZES, Team } from '../sim/tactical/soldier.ts';
import { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { CampaignSession } from './campaign-session.ts';
import { narrativeSetup } from './narrative-content.ts';
import { type FileExists, WorldCache } from './world-cache.ts';

const DEFAULT_SEED = 1;

export interface SaveSession {
  readonly session: CampaignSession;
  readonly report: SaveImportReport;
}

const LINKED_TEAMS: Readonly<Record<string, readonly number[]>> = {
  enemyPreserved: [Team.ENEMY, Team.CREATURE],
  civilianPreserved: [Team.CIV],
};

function linkedSoldier(kind: string, link: PreservedSoldierLink): boolean {
  const teams = LINKED_TEAMS[kind] ?? [];
  const first = TEAM_FIRST_ID[teams[0] ?? Team.CIV] ?? 0;
  const lastTeam = teams[teams.length - 1] ?? Team.CIV;
  const last = (TEAM_FIRST_ID[lastTeam] ?? 0) + (TEAM_SIZES[lastTeam] ?? 0) - 1;
  return link.soldierId >= first && link.soldierId <= last;
}

function savedSoldierLinks(save: SaveGame): PreservedSoldierLink[] {
  const sector = save.tactical.worldSector;
  return save.tempFiles
    .filter(
      (f) =>
        (f.kind === 'enemyPreserved' || f.kind === 'civilianPreserved') &&
        f.sector.x === sector.x &&
        f.sector.y === sector.y &&
        f.sector.z === sector.z,
    )
    .flatMap((f) => decodePreservedSoldierLinks(f.bytes).filter((link) => linkedSoldier(f.kind, link)));
}

function savedStory(save: SaveGame, firstBattleSector: number): SavedStory {
  const m = save.generalInfo.meanwhile;
  return {
    current: m.current,
    trying: m.trying,
    inScene: m.inScene,
    definitions: save.meanwhileDefinitions,
    firstBattleSector,
    lastBattleSector: save.tactical.lastBattleSector,
    lastBattleWon: save.tactical.lastBattleWon,
    tacticalFlags: save.tactical.flags,
  };
}

export async function createSaveSession(
  read: ReadFile,
  saveBytes: Uint8Array,
  seed = DEFAULT_SEED,
  exists: FileExists | null = null,
  layers?: LayerCount,
): Promise<SaveSession> {
  const table = await read(SAVE_ENCRYPTION_PATH);
  if (!table) throw new Error(`missing ${SAVE_ENCRYPTION_PATH}`);
  const encryption = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(table)));
  const save = parseSaveGame(saveBytes, encryption);
  const saiSections = readStrategicAiSections(saveBytes, save);
  const story = savedStory(save, saiSections.firstBattleSector);
  const storyRefusal = storyImportRefusal(story);
  if (storyRefusal) throw new Error(`cannot continue this save: ${storyRefusal}`);
  const [world, content, strategicContent, army] = await Promise.all([
    loadTacticalWorld(read, saveMapPath(save)),
    loadTacticalContent(read),
    loadStrategicContent(read),
    loadArmyContent(read),
  ]);
  const economyContent = await loadEconomyContent(read, strategicContent.towns);
  const merchantContent = await loadMerchantContent(read, content.items);
  const laptopContent = await loadLaptopContent(read, content.items);
  const narrative = await narrativeSetup(read, content.items, content.profiles, layers);
  const sim = new TacticalSim(worldWithSavedDoors(world, save), content, seed);
  const report = importSave(sim, save);
  const strategic = createStrategicState({
    streams: { rng: sim.state.rng, pre: sim.state.pre },
    profiles: sim.state.profiles,
    civGroups: sim.state.civGroups,
    keyTable: sim.state.keyTable,
  });
  importStrategicTime(strategic, save);
  strategic.worldSector = save.tactical.worldSector;
  strategic.realMs = sim.state.clockMs;
  strategic.clock.driver.lastSecondMs = strategic.realMs;
  strategic.clock.paused = false;
  strategic.clock.pauseLocked = false;
  let current: CampaignSim | null = null;
  const tacticalState = () => current?.tactical?.state ?? sim.state;
  const roster = new Roster({
    content,
    combat: tacticalState,
    profiles: strategic.profiles,
    hooks: { ...NO_ROSTER_HOOKS, removeFromTacticalSector: (merc) => removeSoldierFromTacticalSector(tacticalState(), merc.soldier) },
  });
  addSavedMercsToRoster(roster, save, sim.state);
  const worlds = exists ? new WorldCache(read, exists) : null;
  const campaign = new CampaignSim(strategic, sim, {
    strategic: { content: strategicContent, mercs: roster },
    economy: { economy: economyContent, items: content.items, crew: roster },
    queen: { army },
    ...(worlds ? { sectors: { worlds, content, roster } } : {}),
    merchants: { content: merchantContent, items: content.items },
    laptop: {
      content: laptopContent,
      merchants: merchantContent,
      dialogueProfiles: dialogueProfiles(exists ?? (() => false), economyContent.mercTypes, laptopContent),
    },
    narrative,
  });
  current = campaign;
  importMerchants(strategic.merchants, readSavedMerchants(saveBytes, save.sections));
  if (campaign.strategic) importStrategicMap(campaign.strategic, save);
  if (campaign.queen) importStrategicAi(campaign.queen, saiSections, { runLoadHooks: true });
  importStory(strategic, story);
  campaign.creatures?.importDirectives(save.creatureDirectives, saiSections.creatureMeanwhileScenePlayed);
  importEconomy(strategic, readSavedEconomy(saveBytes, save.sections), save.laptop.currentBalance);
  importContracts(strategic, save, saveBytes);
  importLaptop(strategic, save, saveBytes, {
    mercListings: laptopContent.mercListings,
    namedProfiles: laptopContent.namedProfiles,
    startSector: strategicContent.policy.startSector,
    declaredProfiles: economyContent.mercTypes,
  });
  importNarrativeSave(strategic, save);
  for (const saved of readSoldierAssignments(saveBytes, save, encryption)) {
    const merc = roster.get(saved.id);
    if (merc) applySavedAssignment(merc, saved);
  }
  if (campaign.talk) {
    const version = save.header.version;
    const records = readSavedNpcRecords(saveBytes, save.sections, version);
    importNpcRecords(campaign.talk.host, records, version, strategic.worldSector, (p) => {
      const profile = strategic.profiles.get(p);
      return profile ? { x: profile.sectorX, y: profile.sectorY, z: profile.sectorZ } : null;
    });
  }
  campaign.sectors?.adoptLoadedSector(savedSoldierLinks(save));
  return { session: new CampaignSession(campaign, roster, worlds, narrative.texts), report };
}

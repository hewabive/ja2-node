import { requireAnimationTimelines } from '../content/anim/timelines.ts';
import { loadedWorldSector, parseSaveGame, resumesOnMapScreen, type SaveGame } from '../content/formats/savegame.ts';
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
import { type DataDecoding, DEFAULT_DATA_DECODING } from '../content/text/data-version.ts';
import { loadTacticalWorld, type TacticalWorld } from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { initialMusic } from '../protocol/music.ts';
import { MusicMode, musicModeOfNativeByte } from '../protocol/music-modes.ts';
import { type CampaignHooks, CampaignSim, type SimConstruction } from '../sim/campaign/campaign-sim.ts';
import { importContracts } from '../sim/campaign/contracts/save-import.ts';
import { importLaptop } from '../sim/campaign/laptop/save-import.ts';
import { offMapCombatContext } from '../sim/campaign/off-map-combat.ts';
import { NO_ROSTER_HOOKS, Roster } from '../sim/campaign/roster.ts';
import { addSavedMercsToRoster } from '../sim/campaign/save-roster.ts';
import { importStory, type SavedStory, storyImportRefusal } from '../sim/campaign/story-import.ts';
import { importNpcRecords } from '../sim/narrative/save-import.ts';
import { type GameOptions, importNativeGameOptions } from '../sim/options.ts';
import { importStrategicAi } from '../sim/strategic/ai/save-import.ts';
import { importMerchants } from '../sim/strategic/economy/merchants/save-import.ts';
import { applySavedAssignment, importEconomy } from '../sim/strategic/economy/save-import.ts';
import { importStrategicMap } from '../sim/strategic/map/save-import.ts';
import { importNarrativeSave } from '../sim/strategic/narrative/save-import.ts';
import { createStrategicState, type StrategicState } from '../sim/strategic/state.ts';
import { importStrategicTime } from '../sim/strategic/time/save-import.ts';
import { loadTacticalContent } from '../sim/tactical/load-content.ts';
import {
  importCampaignWideState,
  importSave,
  type SaveImportReport,
  saveMapPath,
  worldWithSavedDoors,
} from '../sim/tactical/save-import.ts';
import { removeSoldierFromTacticalSector } from '../sim/tactical/sector-presence.ts';
import { TEAM_FIRST_ID, TEAM_SIZES, Team } from '../sim/tactical/soldier.ts';
import type { TacticalState } from '../sim/tactical/state.ts';
import { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import type { CampaignParts } from './campaign-factory.ts';
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
  decoding: DataDecoding = DEFAULT_DATA_DECODING,
): Promise<SaveSession> {
  const table = await read(SAVE_ENCRYPTION_PATH);
  if (!table) throw new Error(`missing ${SAVE_ENCRYPTION_PATH}`);
  const encryption = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(table)));
  const save = parseSaveGame(saveBytes, encryption);
  const saiSections = readStrategicAiSections(saveBytes, save);
  const story = savedStory(save, saiSections.firstBattleSector);
  const refusal = storyImportRefusal(story);
  if (refusal) throw new Error(`cannot continue this save: ${refusal}`);
  const worldSector = loadedWorldSector(save);
  const [world, parts] = await Promise.all([
    worldSector ? loadTacticalWorld(read, saveMapPath(save)) : null,
    loadImportParts(read, exists, layers, decoding),
  ]);
  const { strategic: strategicContent, economy: economyContent, laptop: laptopContent } = parts;
  const imported = importNativeGameOptions(save.generalInfo.gameOptions);
  const start = world
    ? startInSavedWorld(world, save, parts, seed, imported.options)
    : startWithoutWorld(save, parts, seed, imported.options);
  const { strategic, sim } = start;
  const report: SaveImportReport = { ...start.report, droppedOptions: imported.dropped };
  importStrategicTime(strategic, save);
  strategic.worldSector = worldSector ? { ...worldSector } : null;
  strategic.clock.paused = false;
  strategic.clock.pauseLocked = false;
  const worlds = exists ? new WorldCache(read, exists) : null;
  const { campaign, roster } = assembleImportedCampaign(
    parts,
    strategic,
    sim,
    worlds,
    (r) => addSavedMercsToRoster(r, save, sim?.state ?? null),
    resumesOnMapScreen(save) ? 'createOnMapScreen' : 'create',
  );
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
    const records = readSavedNpcRecords(saveBytes, save.sections, version, decoding.npcRecords);
    importNpcRecords(campaign.talk.host, records, version, strategic.worldSector, (p) => {
      const profile = strategic.profiles.get(p);
      return profile ? { x: profile.sectorX, y: profile.sectorY, z: profile.sectorZ } : null;
    });
  }
  if (sim) campaign.sectors?.adoptLoadedSector(savedSoldierLinks(save));
  const session = new CampaignSession(campaign, parts.presentation, roster, worlds, parts.narrative.texts, {
    kind: 'imported',
    parts,
    report,
  });
  session.initialMusic = initialMusic(musicModeOfNativeByte(save.generalInfo.musicMode), MusicMode.MAIN_MENU);
  return { session, report };
}

interface ImportStart {
  readonly strategic: StrategicState;
  readonly sim: TacticalSim | null;
  readonly report: SaveImportReport;
}

const NO_WORLD_REPORT: SaveImportReport = { mapPath: null, soldiers: 0, worldItems: 0, corpses: 0, skippedMapModifications: 0 };

function startInSavedWorld(world: TacticalWorld, save: SaveGame, parts: CampaignParts, seed: number, options: GameOptions): ImportStart {
  const sim = new TacticalSim(worldWithSavedDoors(world, save), parts.content, seed, { options });
  const report = importSave(sim, save, parts.presentation);
  const strategic = createStrategicState({
    seed,
    options: sim.state.options,
    streams: { rng: sim.state.rng, pre: sim.state.pre },
    profiles: sim.state.profiles,
    civGroups: sim.state.civGroups,
    keyTable: sim.state.keyTable,
    boxing: sim.state.boxing,
    realtimeClock: sim.state.realtimeClock,
  });
  return { strategic, sim, report };
}

function startWithoutWorld(save: SaveGame, parts: CampaignParts, seed: number, options: GameOptions): ImportStart {
  const strategic = createStrategicState({ seed, options });
  const { civGroups, keyTable, profiles, pre } = strategic;
  const realtimeClock = strategic.sectorFlow.realtimeClock;
  importCampaignWideState({ civGroups, keyTable, profiles, pre, realtimeClock, content: parts.content }, save);
  return { strategic, sim: null, report: NO_WORLD_REPORT };
}

export async function loadImportParts(
  read: ReadFile,
  exists: FileExists | null,
  layers?: LayerCount,
  decoding: DataDecoding = DEFAULT_DATA_DECODING,
): Promise<CampaignParts> {
  const [content, strategic, army, timelines] = await Promise.all([
    loadTacticalContent(read, decoding),
    loadStrategicContent(read),
    loadArmyContent(read),
    requireAnimationTimelines(read),
  ]);
  const economy = await loadEconomyContent(read, strategic.towns);
  const merchants = await loadMerchantContent(read, content.items);
  const laptop = await loadLaptopContent(read, content.items);
  const narrative = await narrativeSetup(read, content.items, content.profiles, layers, decoding);
  return {
    content,
    presentation: timelines.presentation,
    strategic,
    army,
    economy,
    merchants,
    laptop,
    dialogueProfiles: dialogueProfiles(exists ?? (() => false), economy.mercTypes, laptop),
    narrative,
  };
}

export interface AssembledImport {
  readonly campaign: CampaignSim;
  readonly roster: Roster;
}

export function assembleImportedCampaign(
  parts: CampaignParts,
  state: StrategicState,
  first: TacticalSim | null,
  worlds: WorldCache | null,
  beforeCampaign: (roster: Roster) => void = () => {},
  construction: SimConstruction = 'create',
): AssembledImport {
  const { content } = parts;
  let current: CampaignSim | null = null;
  const tacticalState = (): TacticalState | null => (current ? (current.tactical?.state ?? null) : (first?.state ?? null));
  const roster = new Roster({
    state: state.roster,
    content,
    combat: () => tacticalState() ?? offMapCombatContext(state, content, current?.experienceHooks),
    profiles: state.profiles,
    hooks: {
      ...NO_ROSTER_HOOKS,
      removeFromTacticalSector: (merc) => {
        const t = tacticalState();
        if (t) removeSoldierFromTacticalSector(t, merc.soldier);
      },
    },
  });
  beforeCampaign(roster);
  const hooks: CampaignHooks = {
    strategic: { content: parts.strategic, mercs: roster },
    economy: { economy: parts.economy, items: content.items, crew: roster },
    queen: { army: parts.army },
    ...(worlds ? { sectors: { worlds, content, roster } } : {}),
    merchants: { content: parts.merchants, items: content.items },
    laptop: { content: parts.laptop, merchants: parts.merchants, dialogueProfiles: parts.dialogueProfiles },
    narrative: parts.narrative,
  };
  current = construction === 'restore' ? CampaignSim.restore(state, first, hooks) : new CampaignSim(state, first, hooks, construction);
  return { campaign: current, roster };
}

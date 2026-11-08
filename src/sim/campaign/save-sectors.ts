// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Tactical_Save.cc LoadMapTempFilesFromSavedGameFile (every sector's files kept by the load),
// @src LoadCurrentSectorsInformationFromTempItemsFile (each file read at the sector's next entry);
// @src TileEngine/SmokeEffects.cc LoadSmokeEffectsFromMapTempFile, TileEngine/LightEffects.cc LoadLightEffectsFromMapTempFile.

import { loadedWorldSector, type SavedWorld } from '../../content/formats/savegame.ts';
import { decodePreservedSoldiersFile } from '../../content/formats/savegame-preserved-soldiers.ts';
import {
  decodeDoorStatusFile,
  decodeDoorTableFile,
  decodeLightEffectsFile,
  decodeMapModificationsFile,
  decodeRottingCorpsesFile,
  decodeSmokeEffectsFile,
  decodeWorldItemsFile,
  revealedStatusBits,
  type SavedLightEffect,
  type SavedSmokeEffect,
  type SavedWorldItem,
  type SectorTempFile,
  type TempFileKind,
} from '../../content/formats/savegame-temp-files.ts';
import { sameSector } from '../../content/strategic/sector-ids.ts';
import { objectFromRecord } from '../items/object.ts';
import { savedCorpse, savedMapDoor, storedDoorStatus } from '../tactical/native-temp-files.ts';
import {
  type DiffLight,
  type DiffSmoke,
  type DiffWorldItem,
  emptySectorDiff,
  type PreservedSoldiers,
  type SectorDiff,
  sectorKey,
} from './sector-diff.ts';

type TempFileReader = (diff: SectorDiff, file: SectorTempFile) => void;

function diffWorldItem(wi: SavedWorldItem): DiffWorldItem {
  return {
    exists: wi.exists,
    gridNo: wi.gridNo,
    level: wi.level,
    object: objectFromRecord(wi.object),
    flags: wi.flags,
    zHeight: wi.renderZHeightAboveLevel,
    visible: wi.visible,
  };
}

function diffSmoke(s: SavedSmokeEffect): DiffSmoke {
  return {
    gridNo: s.gridNo,
    item: s.item,
    type: s.type,
    duration: s.duration,
    radius: s.radius,
    age: s.age,
    flags: s.flags,
    lastUpdate: s.lastUpdate,
  };
}

function diffLight(l: SavedLightEffect): DiffLight {
  return { gridNo: l.gridNo, radius: l.radius, duration: l.duration, age: l.age, lastUpdate: l.lastUpdate };
}

function preservedSoldiers(file: SectorTempFile, enemies: boolean): PreservedSoldiers {
  const saved = decodePreservedSoldiersFile(file.bytes, file.sector, enemies);
  return {
    savedMinute: saved.timestamp,
    links: saved.links.map((l) => [l.nodeId, l.soldierId] as const),
    records: [...saved.records],
  };
}

const READERS: Readonly<Record<TempFileKind, TempFileReader>> = {
  items: (diff, file) => {
    diff.items = decodeWorldItemsFile(file.bytes).map(diffWorldItem);
  },
  rottingCorpses: (diff, file) => {
    diff.corpses = decodeRottingCorpsesFile(file.bytes).map(savedCorpse);
  },
  mapModifications: (diff, file) => {
    diff.savedMapModifications = decodeMapModificationsFile(file.bytes);
  },
  doorTable: (diff, file) => {
    diff.doorTable = decodeDoorTableFile(file.bytes).map(savedMapDoor);
  },
  revealedStatus: (diff, file) => {
    diff.savedRevealed = revealedStatusBits(file.bytes);
  },
  doorStatus: (diff, file) => {
    diff.doorStatus = decodeDoorStatusFile(file.bytes).map(storedDoorStatus);
  },
  enemyPreserved: (diff, file) => {
    diff.enemies = preservedSoldiers(file, true);
  },
  civilianPreserved: (diff, file) => {
    diff.civilians = preservedSoldiers(file, false);
  },
  smokeEffects: (diff, file) => {
    diff.smoke = decodeSmokeEffectsFile(file.bytes)
      .filter((s) => s.allocated)
      .map(diffSmoke);
  },
  lightingEffects: (diff, file) => {
    diff.lights = decodeLightEffectsFile(file.bytes)
      .filter((l) => l.allocated)
      .map(diffLight);
  },
};

export interface SavedSectorTempFiles extends SavedWorld {
  readonly tempFiles: readonly SectorTempFile[];
}

export function importSectorTempFiles(diffs: Map<string, SectorDiff>, save: SavedSectorTempFiles): void {
  const loaded = loadedWorldSector(save);
  for (const file of save.tempFiles) {
    if (loaded && sameSector(file.sector, loaded)) continue;
    const key = sectorKey(file.sector);
    const diff = diffs.get(key) ?? emptySectorDiff();
    diffs.set(key, diff);
    READERS[file.kind](diff, file);
  }
}

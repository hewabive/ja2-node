<!-- Strategic map, squads, groups, routes, travel, encounters and sector transitions: an implementable spec for M4.
2026-10-15. Source: reference/stracciatella/src (ae6bf01, same snapshot as docs 01–14) and
reference/stracciatella/assets/externalized (copied unchanged to data/externalized), cross-checked against vanilla
(reference/vanilla/ja2/Build) where marked. Read-only research: nothing was built or run. -->

# 16 — The strategic map: sectors, squads, groups, routes, travel, encounters and sector transitions

**Conventions.** Paths are relative to `reference/stracciatella/src/game/` unless they start with `sgp/`, `externalized/`
(both under `reference/stracciatella/src/`) or `assets/` (under `reference/stracciatella/`); `V:` is vanilla `Build/`.
"(inferred)" marks conclusions not traced end to end; everything else was read in the code. C integer semantics apply:
`/` truncates (`idiv`), `UINT8`/`INT8` stores wrap. `Random` = `main` stream, `PreRandom` = `pre` stream (`01` §3.6);
`Random(0)` and `PreRandom(0)` return 0 without drawing, `Chance(x)` is `Random(100) < x`, `PreChance(x)` is
`PreRandom(100) < x` (`sgp/Random.cc:63-89`). Strategic time is world seconds; most strategic APIs use **world
minutes** (`GetWorldTotalMin`), and `AddStrategicEvent(kind, minute, param)` stores `minute * 60` seconds
(`Strategic/Game_Events.cc:200-205`); the clock, the event queue and its ordering belong to `docs/15-strategic-time.md`.
"Sector" without qualification means an `SGPSector {x 1..16, y 1..16 (A..P), z 0..3}`. Directions: tactical world
directions `NORTH 0 … NORTHWEST 7` (`07`); strategic moves `NORTH_STRATEGIC_MOVE 0, EAST 1, SOUTH 2, WEST 3, THROUGH 4`
(`Strategic/Strategic_Movement.h:29-36`). Teams and soldier id ranges as in `docs/14` §7. Policy values are
Stracciatella defaults from `assets/externalized/game.json` (`squad_size` 6, `start_sector` "A9",
`start_sector_revealed` true).

**Companions.** `docs/15-strategic-time.md` (clock, compression, event queue, `WarpGameTime`, new-game init),
`docs/17-strategic-ai.md` (Queen, garrisons and patrols, enemy group decisions incl. `StrategicAILookForAdjacentGroups`,
creature spreading), `docs/18-militia-loyalty-mines-assignments.md` (militia counts and their tactical placement rules,
loyalty events, mines, assignments incl. sleep and `FatigueCharacter`), `docs/19-autoresolve-pbi.md` (everything from
`InitPreBattleInterface` on: encounter-code refinement, PBI choices, retreat, autoresolve). Tactical: `07` (pathing),
`08` (sight), `10` (turns, `CheckForEndOfBattle`), `12` (items, smoke), `14` (savegame reader and the native temp-file
framing). This document owns: the sector tables, groups and squads, strategic routes and travel time, arrival
processing up to the PBI hand-off, entering/leaving/unloading a tactical sector, per-sector persistence, and turning
strategic enemy counts into placed soldiers.

---

## 0. State this spec adds

`GameState.strategic` (`01` §3.2) gains (names are ja2-node proposals; originals in brackets):

- **Map** `sectors[256]` (`SectorInfo`, §1.3), `mapElements[324]` (`StrategicMap`, §1.2), `underground[]` (ordered
  list, `gpUndergroundSectorInfoHead`, §1.4), `worldSector | null` (`gWorldSector`, invalid = z −1),
  `selectedSector` (`sSelMap`, UI but read by `HandleNonCombatGroupArrival`), `mercArriveSector`
  (`g_merc_arrive_sector`, M5).
- **Groups** `groups[]` in list order (`gpGroupList`; order matters for every `FOR_EACH_GROUP`), `groupIdMask`
  (`uniqueIDMask[8]`), `squads[20][squad_size]` (`Squad`), `squadGroupIds[20]` (`SquadMovementGroups`, INT8),
  `deadSquadMembers[20][6]` (`sDeadMercs`, profile ids, −1 empty), `currentSquad` (`iCurrentTacticalSquad`, UI-ish:
  used by tactical exits), `vehicleGroupIds[10]` (`gubVehicleMovementGroups`), vehicles (§3.15), helicopter (§3.16).
- **Transient flow flags** (not in the native save): `waitingForInput` (`gfWaitingForInput`),
  `pendingSimultaneousGroup`, `groupPrompting`, `initPrebattleGroup`, `numGroupsArrivedSimultaneously`,
  `tacticalTraversal {active, groupId, chosenSoldier}` (`gfTacticalTraversal`, `gpTacticalTraversalGroup`,
  `gpTacticalTraversalChosenSoldier`), `undergroundTacticalTraversal` (`gfUndergroundTacticalTraversal`, §3.6, §10 quirk 7),
  `adjacentJump {group, jumpCode, traverseMin, direction, additional, target}` (`gpAdjacentGroup` …,
  `StrategicMap.cc:135-140`), `waitingForMercsToExit {code, remaining, sinceMs}` (`Overhead.cc:5834-5844`),
  `usingEdgepointsForEntry` (`fUsingEdgePointsForStrategicEntry`).
- **Encounter globals** shared with `docs/19`: `encounterCode` (`gubEnemyEncounterCode`), `explicitEncounterCode`,
  `highPotentialForAmbush`, `autoAmbush` (cheat, always false), `cantRetreatInPBI`, `battleGroup` (`gpBattleGroup`),
  `pbSector`, `blitBattleSectorLocator`, `pendingEnemies` (`gfPendingEnemies`), `numAwareBattles` (owned by `docs/17`).
- **Per soldier** (player team records live in the campaign roster, not in the tactical state; §9.1): `sector`
  (`sSector`), `betweenSectors`, `groupId` (`ubGroupID`, 0 = none), `prevSectorId` (`ubPrevSectorID`, byte id,
  255 = none), `insertionCode`/`insertionData` (`ubStrategicInsertionCode`/`usStrategicInsertionData`),
  `insertionDirection` (`ubInsertionDirection`, ≥100 = forced facing), `insertionGridNo` (`sInsertionGridNo`),
  `useExitGridForReentryDirection`, `preTraversalGridNo`, `pendingActionData2` (edgepoint search seed), `path`
  (`pMercPath`, list of strategic indices), `assignment` (`bAssignment`), `vehicleId` (`iVehicleId`), `inSector`
  (`bInSector`), `waitActionToDo` (`ubWaitActionToDo`), `pendingActionData1` (exit direction).
- **Per visited sector** `sectorDiffs[sectorKey]` replacing the native temp files (§5.11).

---

## 1. Strategic map data

### 1.1 Sector ids and coordinates

| Form | Definition | Source |
|---|---|---|
| `SGPSector {x, y, z}` | `x, y` INT16 1..16, `z` INT8 0..3; `IsValid` checks exactly those ranges | `sgp/Types.h:100-131`, `sgp/Types.cc:97-100` |
| Byte id ("sector id", `SEC_A1` 0 … `SEC_P16` 255) | `AsByte = (y−1)·16 + x−1`; from byte: `x = id % 16 + 1`, `y = id / 16 + 1` | `Strategic/Campaign_Types.h:10-28`, `sgp/Types.cc:9-23,121-125` |
| Strategic index (18×18 with a border) | `AsStrategicIndex = x + y·18`; `FromStrategicIndex: x = i % 18, y = i / 18`; `MAP_WORLD_X = MAP_WORLD_Y = 18` | `sgp/Types.cc:25-38,127-130`, `Strategic/StrategicMap.h:49-50` |
| Short string | `'A'+y−1` then `x` ("A9"); long: "J9-1" for display, "j9_b1" for files | `sgp/Types.cc:132-143` |
| Map file | `<short>.dat` (surface) / `<x><y>_b<z>.dat`; `_a` appended if `SF_USE_ALTERNATE_MAP` (or the load-time `gfUseAlternateMap`), `_m` for the Meduna HQ (P3) meanwhile | `Strategic/StrategicMap.cc:314-343` |

`SectorInfo[]` and the temp-file loop use byte ids; `StrategicMap[]`, the strategic pathfinder and merc paths use
strategic indices; groups and soldiers carry `SGPSector`. Byte id 255 (P16, an EDGEOFWORLD sector) doubles as "no
previous sector": soldiers are created with `ubPrevSectorID = 255` (`Tactical/Soldier_Create.cc:946`), so a fresh
group's `ubPrev` is P16 and `RetreatGroupToPreviousSector` treats `ubPrev == (16,16)` as "none"
(`Strategic/Strategic_Movement.cc:2769-2773`).

### 1.2 `StrategicMapElement` (324 entries, `Strategic/StrategicMap.h:133-141`)

| Field | Meaning | Written by |
|---|---|---|
| `bNameId` | Town id (`BLANK_SECTOR` 0 elsewhere) from `strategic-map-towns.json` | `InitializeStrategicMapSectorTownNames` (`StrategicMap.cc:1182-1192`) at engine init |
| `fEnemyControlled` | Sector owner; all TRUE at a new game (`SetupNewStrategicGame`, `StrategicMap.cc:2228-2231`) | §6.1 only |
| `fEnemyAirControlled` | Airspace; recomputed for all 256 sectors by `UpdateAirspaceControl` | `Strategic/SAM_Sites.cc:69-96` |
| `bSAMCondition` | 0–100 status of a SAM site sector (100 at start, works if ≥ `MIN_CONDITION_FOR_SAM_SITE_TO_WORK` 80) | `SAM_Sites.cc` `InitializeSAMSites`, structure damage listener, repair |

Native save: 41 bytes each, `bNameId` 16, `fEnemyControlled` 17, `fEnemyAirControlled` 18, `bSAMCondition` 20, the rest
padding (`Strategic/LoadSaveStrategicMapElement.cc:7-21`); 324 records, then 256 × 116 `SECTORINFO`, then 324 skipped
bytes, then `BOOLEAN` "Orta found" (`StrategicMap.cc:2329-2373`).

### 1.3 `SECTORINFO` (256 entries, `Strategic/Campaign_Types.h:152-189`)

| Field (save offset) | Type | Meaning | Owner | M4 |
|---|---|---|---|---|
| `uiFlags` (0) | u32 | `SF_*` (§1.5) | this doc §1.5 | yes |
| `ubGarrisonID` (5) | u8 | Garrison index, 255 none | `docs/17` | read by `NumStationaryEnemiesInSector` |
| `ubPendingReinforcements` (6) | i8 | | `docs/17` | no |
| `fMilitiaTrainingPaid`, `ubMilitiaTrainingPercentDone`, `…Hundredths` (7–9) | | | `docs/18` | no |
| `ubNumTroops/Elites/Admins/Creatures` (14–17) | u8 | Stationary enemy counts | `docs/17` | yes (encounters, placement) |
| `ub{Troops,Elites,Admins,Creatures}InBattle` (18–21) | u8 | Already placed in the loaded battle | §5.13 | yes |
| `ubDayOfLastCreatureAttack` (24) | u32 | | `docs/17` | no |
| `uiFacilitiesFlags` (28) | u32 | `SFCF_*`: hospital 1, industry 2, prison 4, military 8, airport 0x10, gun range 0x20 | `InitKnowFacilitiesFlags` (`Strategic/Campaign_Init.cc:30-66`), `SetSectorFlag` (§1.5) | display |
| `ubTraversability[5]` (32–36) | u8 | Edge types N, E, S, W and "through" (§1.6) | `InitStrategicMovementCosts` | **yes** |
| `bBloodCats` (39) | i8 | −1 = not rolled yet; ≥0 population | `InitBloodCatSectors` (`Strategic/Game_Init.cc:118-137`), §4.2 | yes |
| `bBloodCatPlacements` (40) | i8 | Placements in the map | same; recounted on load (§5.13) | yes |
| `ubTravelRating` (42) | u8 | Unused by game logic (comment in JSON) | `InitStrategicMovementCosts` | no |
| `ubNumberOfCivsAtLevel[3]` (43–45) | u8 | Militia green/regular/elite | `docs/18` | encounters, scouting |
| `uiTimeCurrentSectorWasLastLoaded` (52) | u32 min | Last time the player left it loaded | §5.11 | yes |
| `uiTimeLastPlayerLiberated` (60) | u32 **seconds** | | `docs/17`/`19` | §5.13 strip rule |
| `fSurfaceWasEverPlayerControlled` (64) | bool | | §6.1 | yes |
| `uiNumberOfWorldItemsInTempFileThatCanBeSeenByPlayer` (68) | u32 | Map-inventory count | §5.11 | observation |

Save record 116 bytes (`Strategic/LoadSaveSectorInfo.cc:7-48`); skipped bytes are vanilla's `ubInvestigativeState`
(4), `fPlayer[4]` (10–13), `bLastKnownEnemies` (22), `bNameId`, `bUSUSED` (37–38), `UNUSEDbSAMCondition` (41) and
fillers (`V: Strategic/CampaignTypes.h:407-467`). Vanilla's `fPlayer[]` ("player thinks he controls it") was written
but never read (`V: Strategic/PlayerCommand.c:128-380`); Strac dropped it: **not needed**.

`InitNewCampaign` zero-fills all 256 records, then `InitStrategicMovementCosts`, `RemoveAllGroups`,
`InitKnowFacilitiesFlags`, `BuildUndergroundSectorInfoList`, start-sector reveal (`SetSectorFlag(A9,
SF_ALREADY_VISITED)`), `InitStrategicAI`, `InitStrategicStatus` (`Strategic/Campaign_Init.cc:98-122`); the full
new-game order is `docs/15`'s. `InitBloodCatSectors` sets `bBloodCats = −1` for ids 0..254 only (P16 stays 0, harmless),
then placements from JSON, then the lair/arena spawn counts (both fields) by difficulty.

### 1.4 `UNDERGROUND_SECTORINFO` (`Campaign_Types.h:198-210`)

A singly linked list built from `strategic-map-underground-sectors.json` in file order (`BuildUndergroundSectorInfoList`,
`Campaign_Init.cc:85-93`); `FindUnderGroundSector` walks it (`Strategic/Queen_Command.cc:1089-1098`). Each node:
`uiFlags` (same `SF_*`), `ubSector`, `ubNumElites/Troops/Admins/Creatures` = `n[diff−1] + Random(var[diff−1])` for troops,
elites, creatures in that order, three draws per node even when the variance is 0 (`Random(0)` draws nothing)
(`externalized/strategic/UndergroundSectorModel.cc:13-25`), `uiTimeCurrentSectorWasLastLoaded`, `ubAdjacentSectors`
(N 1, E 2, S 4, W 8 — only for creature spreading and the map), `ubCreatureHabitat` (`docs/17`), the four `…InBattle`
counters, the visible-item count. Save record 72 bytes (`Strategic/LoadSaveUndergroundSectorInfo.cc:7-34`). 36 nodes in
the shipped JSON (A10, B2, D4, D5 b1 empty; J9 b1/b2; K4 b1; O3 b1 ↔ P3 b1; five mines with up to three levels).

### 1.5 Sector flags (`Campaign_Types.h:32-63`)

| Flag | Value | Set | Cleared / read |
|---|---|---|---|
| `SF_USE_MAP_SETTINGS` | 0x1 | data only (none in vanilla, inferred) | `PrepareEnemyForSectorBattle` counts map placements instead (§5.13) |
| `SF_ENEMY_AMBUSH_LOCATION` | 0x2 | none found | PBI ambush chance +20 (`docs/19`) |
| `SF_PLAYER_KNOWS_ENEMIES_ARE_HERE` | 0x4 | PBI with `ENEMY_ENCOUNTER_CODE` (`Strategic/PreBattle_Interface.cc:431-440`) | all 256 cleared on the next clock advance while `!fEnemyInSector` (`Strategic/Game_Clock.cc:211-216`) |
| `SF_ALREADY_VISITED` | 0x20 | arrival of a non-heli player group (§3.9), `EnterSector` (not in meanwhile), start sector at init | never cleared; fog, enemy knowledge, theft, bloodcat lair corpses |
| `SF_USE_ALTERNATE_MAP` | 0x40 | `InitNPCs` (NPC placements), cache sector (`docs/17`), Tixa b1 if not sci-fi (`Game_Init.cc:73-116`) | map file name |
| `SF_PENDING_ALTERNATE_MAP` | 0x80 | quest code (M6) | |
| `SF_ALREADY_LOADED` | 0x100 | `SetCurrentWorldSector` after `EnterSector` | item temp file replaces map items (§5.11) |
| `SF_HAS_ENTERED_TACTICAL` | 0x200 | `SetCurrentWorldSector` | mods only |
| `SF_SKYRIDER_NOTICED_ENEMIES_HERE` | 0x400 | heli scouting (§3.16) | cleared when Skyrider leaves |
| `SF_HAVE_USED_GUIDE_QUOTE` | 0x800 | RPC sector description (M6) | |
| `SF_*_TEMP_FILE_EXISTS` | 0x00100000 … 0x80000000 | §5.11 | §5.11 |

`SetSectorFlag(sector, SF_ALREADY_VISITED)` also: Tixa (J9) visited → `SectorInfo[SEC_J9].uiFacilitiesFlags |=
SFCF_PRISON`; the gun range sector (13, H, 0) → H13/H14/I13/I14 gain `SFCF_GUN_RANGE`; and if the flag was not yet set,
`++ubNumNewSectorsVisitedToday == NEW_SECTORS_EQUAL_TO_ACTIVITY` updates the player-activity day (`docs/17`)
(`Tactical/Tactical_Save.cc:773-812`). Underground flags go to the node if it exists, silently nowhere otherwise.

### 1.6 Traversability (`Campaign_Types.h:100-147`) and the movement-cost table

Enum: `TOWN 0, ROAD 1, PLAINS 2, SAND 3, SPARSE 4, DENSE 5, SWAMP 6, WATER 7, HILLS 8, GROUNDBARRIER 9, NS_RIVER 10,
EW_RIVER 11, EDGEOFWORLD 12`, then display-only `TROPICS 13 … SWAMP_ROAD 24`, `*_SAM_SITE 25–28`, special sites
29–38. `strategic-map-traversibility-ratings.json` maps letters to these numbers ("R" 1, "P" 2, "X" 0, "E" 12 …).

`strategic-map-movement-costs.json` (JSONC): `traverseWE` 16 rows × 17 columns (column `k` is the border west of
sector `x = k+1`), `traverseNS` 17 rows × 16 columns (row `k` is the border north of row `y = k+1`), `traverseThrough`
16 × 16, `travelRatings` 16 × 16 (`externalized/strategic/MovementCostsModel.cc:22-68`). Per sector
(`Strategic/Strategic_Movement_Costs.cc:9-30`):

```
W = WE[y−1][x−1]   E = WE[y−1][x]   N = NS[y−1][x−1]   S = NS[y][x−1]   THROUGH = Through[y−1][x−1]
```

Edges use only `A D E G H N P R S W X` in the shipped table; "through" uses the extended types and is read only by
the land-type text, the loading screen, `IsSectorDesert` (`== SAND`), `SectorIsPassable` (≠ GROUNDBARRIER and ≠
EDGEOFWORLD, used by the map UI and `Strategic_AI.cc:260`), `IsTheCursorAllowedToHighLightThisSector` (≠ EDGEOFWORLD),
and one tactical rule (`Tactical/Soldier_Control.cc:5451`, `!= TOWN`). `GetTraversability(byteFrom, byteTo)` picks the
direction from the byte difference (−1 W, +1 E, +16 S, else N) (`Strategic_Movement_Costs.cc:33-60`).

### 1.7 Externalized tables (all in `data/externalized`, JSON with `//` and `/* */` comments, no trailing commas)

| File | Fields | Consumer | M4 |
|---|---|---|---|
| `strategic-map-movement-costs.json` | §1.6 | `InitStrategicMovementCosts` | **yes** |
| `strategic-map-traversibility-ratings.json` | letter → enum | the model loader | **yes** |
| `strategic-map-towns.json` | `townId` 1..12, `internalName`, `sectors[]`, `militiaMapBaseSector` (art), `townPoint` (label ×10 sectors), `isMilitiaTrainingAllowed` | `bNameId`, `FOR_EACH_SECTOR_IN_TOWN`, loyalty, militia | **yes** (`bNameId`, NPC-of-note rule, invasion messages) |
| `strategic-map-sectors-descriptions.json` | `sector`, `sectorLevel`, `landType` | `GetSectorLandTypeString` (B13 airport, F8 hospital, N3 airport, five underground facilities) | text only |
| `strategic-map-underground-sectors.json` | §1.4 | `BuildUndergroundSectorInfoList` | **yes** |
| `strategic-map-sam-sites.json` | 4 × `sector` (D2, D15, I8, N4 — order fixed), `gridNos[2]` (controller tiles) | SAM ids, structure damage, `IsThisSectorASAMSector` | airspace, encounters (SAM = "important") |
| `strategic-map-sam-sites-air-control.json` | 16 × 16 of `samId + 1`, 0 = no SAM covers it | `UpdateAirspaceControl` | heli, observation |
| `strategic-map-secrets.json` | `sector`, `isSAMSite`, `secretMapIcon`, `secretLandType`, `foundLandType` (Tixa, Orta, 4 SAMs) | found on arrival (§3.9) or by quests; the native save keeps Tixa's state in the general-info block, Orta's after the strategic info and the SAM sites' as an array (`SaveLoadGame.cc:1880,1908`, `StrategicMap.cc:2346-2348`) | yes |
| `strategic-map-cache-sectors.json` | `sectors[5]`, `numTroops[3]`, `numTroopsVariance[3]` | `InitStrategicAI` (`Strategic/Strategic_AI.cc:552-560`) | `docs/17` |
| `strategic-map-npc-placements.json` | `profile`, `sectors[]`, `placedAtStart`, `useAlternateMap`, `sciFiOnly` | `InitNPCs`, daily NPC moves | M6 (NPC of note uses profile sectors) |
| `strategic-bloodcat-placements.json` | `sector`, `bloodCatPlacements` | `InitBloodCatSectors` | yes |
| `strategic-bloodcat-spawns.json` | `sector`, `isLair`/`isArena`, spawns by difficulty (I16 lair, N5 arena) | same, §4.2 | yes |
| `strategic-map-creature-lairs.json`, `strategic-mines.json`, `strategic-ai-policy.json`, army-*.json | | `docs/17`, `docs/18` | not here |
| `vehicles.json` | per vehicle type: sounds, `profile`, `movementType` (FOOT/CAR/TRUCK/TRACKED/AIR), `armourType`, `seats` (≤ 10) | `AddVehicleToList` sets the group's transport mask (`Tactical/Vehicles.cc:114`) | §3.15 |
| `game.json` | `squad_size`, `start_sector`, `start_sector_revealed` | squads, new game | yes |

### 1.8 Tables that exist only in C sources

| Table | Source | Use |
|---|---|---|
| Travel times per transport and edge type | `Strategic/Strategic_Movement.cc:2065-2190` | §3.5 |
| Facilities per sector (hospital, airport, prison, military…) | `Strategic/Campaign_Init.cc:30-66` | display, `docs/18` |
| `SectorIncrementer[8]` (dx, dy per tactical direction) | `Strategic/StrategicMap.cc:157-167` | §5.9 |
| Edgepoint generator corners `gsTLGridNo 13286, gsTRGridNo 1043, gsBLGridNo 24878, gsBRGridNo 12635` | `TileEngine/Map_Edgepoints.cc:51-54` | §5.7 |
| RPC sector descriptions (33 sectors, quote ids) | `StrategicMap.cc:355-393` | M6 |
| Heli refuel sites (Drassen B13 grid 9001, Estoni I6 grid 13067), heli costs | `Strategic/Map_Screen_Helicopter.cc:44-84`, `.h:12-13` | §3.16 |
| Bloodcat lair corpses (3 gridnos) | `Strategic_Movement.cc:1029-1068` | §3.9 |

---

## 2. Groups and squads

### 2.1 Structures (`Strategic/Strategic_Movement.h:41-116`)

| `GROUP` field | Meaning |
|---|---|
| `fDebugGroup` | Debug enemy groups are deleted on arrival (`HandleNonCombatGroupArrival`); never set in play |
| `fPlayer`, `fVehicle`, `fPersistant` | Persistent groups (squads, vehicles) are never deleted when empty; `CancelEmptyPersistentGroupMovement` parks them instead (§2.3) |
| `ubGroupID` | 1..255 (§2.2) |
| `ubGroupSize` | Player: member count (vehicle groups count the vehicle soldier too); enemy: `troops + elites` at creation, maintained by `docs/17` |
| `ubSector` | Last/current sector (the **departed** sector while between sectors) |
| `ubNext` | Destination of the current edge; `x = y = 0` after arrival; only x, y saved |
| `ubPrev` | Previous sector (P16 = none); only x, y saved |
| `ubOriginalSector`, `ubCreatedSectorID`, `ubSectorIDOfLastReassignment` | Byte ids, debugging/AI |
| `fBetweenSectors` | Moving along an edge |
| `ubMoveType` | `ONE_WAY 0, CIRCULAR 1, ENDTOEND_FORWARDS 2, ENDTOEND_BACKWARDS 3` |
| `ubNextWaypointID` | Index into `pWaypoints` |
| `uiArrivalTime` | Absolute world minute of the next arrival; set only through `setArrivalTime` (heli clamp, §3.16) |
| `uiTraverseTime` | Minutes for the current edge (incl. enemy sleep) |
| `pWaypoints` | List of `WAYPOINT {sSector}` (x, y only) |
| `ubTransportationMask` | `FOOT 1, CAR 2, TRUCK 4, TRACKED 8, AIR 0x10` |
| `uiFlags` | `GROUPFLAG_SIMULTANEOUSARRIVAL_APPROVED 1, _CHECKED 2, MARKER 4, JUST_RETREATED_FROM_BATTLE 8, HIGH_POTENTIAL_FOR_AMBUSH 0x10, GROUP_ARRIVED_SIMULTANEOUSLY 0x20`; cleared on every arrival (§3.9) |
| `pPlayerList` / `pEnemyGroup` | Player: list of soldiers in insertion order. Enemy: `ENEMYGROUP {troops, elites, admins, pendingReinforcements, adminsInBattle, intention, troopsInBattle, elitesInBattle}` |

Native save: `u32 n`, then per group 84 bytes (`fDebugGroup` 0, `fPlayer` 1, `fVehicle` 2, `fPersistant` 3, id 4,
size 5, sector x/y/z 6–8, next x/y 9–10, prev x/y 11–12, original 13, between 14, move type 15, next waypoint 16,
arrival 20, traverse 24, mask 36, flags 40, created 44, reassignment 45); player groups with size > 0: `u32 n` × `u32
profile`; enemy: 29 bytes (troops 0, elites 1, admins 2, pending 4, adminsInBattle 5, intention 6, troopsInBattle 7,
elitesInBattle 8); `u32 n` × 8-byte waypoints (x 0, y 1); finally the 32-byte id mask, which the loader skips and
rebuilds from the loaded ids (`Strategic_Movement.cc:2394-2717`). Squads: 120 × 12 bytes (`i16 soldier id` 0, `u8`
format 2, `i8 squad` 3) + `INT8 SquadMovementGroups[20]` (`Tactical/Squads.cc:643-730`).

### 2.2 Group ids and the list

`AddGroupToList` takes the lowest id `1..255` whose bit is clear in `uniqueIDMask` (`id / 32`, `1 << id % 32`), sets
it, and **appends** the group to the end of `gpGroupList`; 255 groups max, then `runtime_error`
(`Strategic_Movement.cc:506-528`). `RemoveGroupFromList` unlinks and clears the bit (`:533-553`). `GetGroup(id)` is a
list scan. New game: `InitNewCampaign` → `RemoveAllGroups`, then `InitStrategicAI` creates the patrol groups first
(`docs/17`), then `InitSquads` creates 20 persistent player groups at (1,1) (`Squads.cc:41-56`), then `InitVehicles`
10 persistent vehicle groups at (1,1) with mask CAR (`Tactical/Vehicles.cc:51-61`) (`Strategic/Game_Init.cc:140-151`).
So squad group ids depend on the number of patrol groups; tests must not hard-code them.

Creation (`Strategic_Movement.cc`):

- `CreateNewPlayerGroupDepartingFromSector(s)` (`:111-129`): sector = next = s, original = created = `s.AsByte()`,
  `fPlayer`, ONE_WAY, mask FOOT, reassignment 255.
- `CreateNewVehicleGroupDepartingFromSector(s)` (`:132-152`): same with `fVehicle`, mask CAR (overwritten by
  `AddVehicleToList` from `vehicles.json`).
- `CreateNewEnemyGroupDepartingFromSector(id, admins, troops, elites)` (`:476-498`): CIRCULAR, mask FOOT, size =
  troops + elites (every caller passes 0 admins; `docs/17` converts two patrols to admins afterwards keeping the size).
- `RemoveGroup(g)` (`:1828-1865`): a persistent group outside `RemoveAllGroups` is only parked
  (`CancelEmptyPersistentGroupMovement`) with a warning; otherwise waypoints, the `EVENT_GROUP_ARRIVAL` for it, the
  member list or the enemy struct (`RemoveGroupFromStrategicAILists`, `docs/17`) are freed, the group unlinked, and
  `gpBattleGroup` cleared if it pointed there.

### 2.3 Player membership

- `AddPlayerToGroup(g, s)` (`:155-183`): `s.ubGroupID = g.id`; first member: list = [s], size = 1, `g.ubPrev =
  SGPSector(s.ubPrevSectorID)`, `g.ubSector = s.sSector` (z included); later members are appended, size + 1.
- `RemovePlayerFromPGroup(g, s)` (`:189-217`): unlink, `s.ubPrevSectorID = g.ubPrev.AsByte()`, `s.ubGroupID = 0`; if the
  size drops to 0: non-persistent → `RemoveGroup`, persistent → `CancelEmptyPersistentGroupMovement` (`:3434-3451`:
  vehicles untouched; others lose the arrival event and waypoints, traverse = arrival = 0, not between,
  `ubPrev = ubSector = ubNext = (0,0,0)`). `RemovePlayerFromGroup(s)` with a missing group only zeroes `ubGroupID`.
- Every merc not on a squad, not in a vehicle and not in transit gets his own non-persistent group from
  `AssignMercToAMovementGroup` when he takes an assignment (`Strategic/Assignments.cc:6366-6377`).
- `HandleSoldierLeavingSectorByThemSelf(s)` (`StrategicMap.cc:1575-1611`): squad member → removed from squads and group;
  otherwise his non-vehicle group is removed; then `AddCharacterToUniqueSquad(s)`; if still without a group, a new
  player group at his sector.

### 2.4 Squads (`Tactical/Squads.cc`)

`Squad[20]` vectors of `squad_size` (6) slots; `SquadMovementGroups[20]` persistent group ids; the squad number is the
assignment (`SQUAD_1 0 … SQUAD_20 19`, `ON_DUTY 20, DOCTOR, PATIENT, VEHICLE 23, IN_TRANSIT 24, …, ASSIGNMENT_DEAD 30,
ASSIGNMENT_POW 32`, `Strategic/Assignments.h:28-65`). `NO_CURRENT_SQUAD = 20`.

`AddCharacterToSquad(s, q)` (`:85-210`), exact order:

```
if fExitingVehicleToSquad: false
if DoesVehicleExistInSquad(q) && !(s.flags & (PASSENGER|DRIVER|VEHICLE)): false
if IsThisSquadOnTheMove(q): false                    // first member's fBetweenSectors (:733-740)
for slot in Squad[q] (in order):
  if slot == s: true                                 // already there
  if slot occupied: continue
  if SectorSquadIsIn(q) && that sector != s.sSector: false   // first member's sector, z included
  RemoveCharacterFromSquads(s)
  CopyPathOfSquadToCharacter(s, q)                   // copy first other member's pMercPath
  if s.groupId: old = s.groupId; RemovePlayerFromGroup(s); if s.assignment >= ON_DUTY && != VEHICLE: RemoveGroup(old) if it exists
  g = group(SquadMovementGroups[q])
  if s.assignment != VEHICLE || s.vehicleId == -1: AddPlayerToGroup(g, s); SetGroupSectorValue(s.sSector, g)
  elif InHelicopter(s): newSquad = SquadIsEmpty(q); RemoveSoldierFromHelicopter(s); AddPlayerToGroup; SetGroupSectorValue;
                        if newSquad: PlaceGroupInSector(g, heliGroup.prev, heliGroup.sector, false)
  else: fExitingVehicleToSquad = true; TakeSoldierOutOfVehicle(s); fExitingVehicleToSquad = false; AddPlayerToGroup; SetGroupSectorValue
  slot = s
  if s.assignment != q: wake if asleep; SetTimeOfAssignmentChangeForMerc(s)
  ChangeSoldiersAssignment(s, q)
  current-squad and selection updates (UI)
  true
false                                                // squad full
```

Note `SetGroupSectorValue` (§3.11) **removes the squad group's waypoints and arrival event** each time a member is
added — adding a merc resets the squad's movement (fine, a moving squad refuses new members).

- `AddCharacterToAnySquad(s)` (`:214-255`): first non-empty squad (ascending) that accepts him, else the first empty one,
  else `logic_error`.
- `AddCharacterToUniqueSquad(s)` (`:259-265`): `GetFirstEmptySquad` (ascending, `logic_error` if none).
- `RemoveCharacterFromSquads(s)` (`:290-330`): clear the slot, free his personal path **without** touching the group's
  waypoints (`ClearStrategicPathList(path, -1)`), `RemovePlayerFromGroup`; a vehicle between sectors gets a fresh group
  at its sector; `RebuildSquad` compacts the slots (`std::remove_if`, order kept, `:744-749`); a dead soldier is added
  to `sDeadMercs` of that squad (first free or stale entry, `:793-813`); the squad's dead list is reset when its group
  arrives anywhere (§3.9).
- `NumberOfPlayerControllableMercsInSquad(q)` counts non-vehicle members (EPCs and the robot included, `:860-884`).
- `CheckSquadMovementGroups` recreates missing squad groups (`:904-915`).

---

## 3. Routes and travel

### 3.1 Merc paths vs group waypoints

The player plans with **paths** (`PathSt` doubly linked lists of strategic indices, head = the sector the group
occupies or departed), stored on every member (`pMercPath`) and on the vehicle (`VEHICLETYPE.pMercPath`); members of a
squad share copies (`CopyPathToCharactersSquadIfInOne`). `GetSoldierMercPathPtr`/`GetSoldierGroup`: in a vehicle → the
vehicle's path/group; is a vehicle → its own entry; else the soldier's (`Strategic/Strategic_Pathing.cc:1049-1090`).
The group moves along **waypoints** built from the path at its pivots (§3.4). Arrival removes the path head (§3.9).

### 3.2 `FindStratPath(start, dest, group, tacticalTraversal)` (`Strategic_Pathing.cc:188-441`)

A best-first search on the 18×18 strategic-index grid with a sorted linked open list (`pathQB[512]`, index 0 = head,
511 = free pool), trail tree `trailStratTreeB[4096]`, best costs `trailCostB[324]` (init `0xFFFFFFFF`).

```
direct = group.player && SHIFT held                     // UI: "shortest route" instead of "quickest"
queRequests = 2; reset all arrays; dest(x,y) = (dest % 18, dest / 18)
node1 = {loc: start, costSoFar: 0, costToGo: H(start)}; trailCost[start] = 0
H(loc) = dx < dy ? dx*14/10 + dy : dy*14/10 + dx         // dx, dy in sectors to dest (ESTIMATE1, :127-141)
heli = the helicopter's group if a heli exists
do:
  ndx = head.next; cur = loc(ndx); curCost = costSoFar(ndx); move ndx to the pool (location −1)
  if trailCost[cur] < curCost: continue                  // stale entry
  for iCnt in 0, 2, 4, 6:                                 // N, E, S, W (diStratDelta −18, +1, +18, −1)
    nb = cur + delta; if !FromStrategicIndex(nb).IsValid(): continue
    if avoidPlayerInfluenced && nb != dest:               // enemy routing only (§3.3)
      skip if a merc is there (fSectorsWithSoldiers), militia there, or !OkayForEnemyToMoveThroughSector(nb)
    c = GetSectorMvtTimeForGroup(byte(cur), iCnt/2, group); if c == IMPOSSIBLE: continue
    if group == heli: c = mapElements[cur].fEnemyAirControlled ? 1000 : 100     // of the sector being LEFT
    if tacticalTraversal: if curCost == 0 && nb == dest && GetTraversability(byte cur, byte nb) != GROUNDBARRIER: c = 0
    elif direct: c = 60                                   // FLAT_STRATEGIC_TRAVEL_TIME, overrides heli costs too
    t = curCost + c
    if t < trailCost[nb]:                                 // strict
      take a node: queRequests++ while < 511, else pop the pool; pool empty (index 511/0) → return 0
      trail[trailIdx] = {next: pathNdx(ndx), delta: iCnt}; if ++trailIdx >= 4096 → return 0
      node = {loc: nb, costSoFar: t, costToGo: H(nb)}; trailCost[nb] = t
      insert before the first queue node with total > t; among equal totals, after every node whose
      Manhattan distance to dest is smaller than the new node's (FARTHER), i.e. before equal-distance ones
while queue not empty and head.loc != dest
found → reverse the trail chain from the head node; emit up to MAX_PATH_LIST_SIZE directions (0/2/4/6); return count
else 0
```

The heuristic is in sectors while costs are minutes, so in practice it only breaks ties: the search is Dijkstra
ordered by minutes, then by estimate, then by Manhattan distance, then LIFO. No random numbers.

`BuildAStrategicPath(start, end, group, tt)` (`:444-487`): `end < 17` → null; otherwise a list `[start, …, end]`
following the directions; any step landing below index 17 clears it. `AppendStrategicPath(new, old)` drops the new
head if it equals the old tail (`:490-534`). Enemy movement wrappers (`docs/17`): `MoveGroupFromSectorToSector`,
`…ButAvoidPlayerInfluencedSectors` (falls back to the plain route), `…AndStopOneSectorBeforeEnd` (removes the tail)
(`:917-1020`).

### 3.3 Plotting and editing a route (player)

- `PlotPathForCharacter(s, sector, tt)` (`Strategic/Map_Screen_Interface_Map.cc:849-884`): refused if the cursor may not
  highlight the sector (invalid or EDGEOFWORLD "through"), if in transit, or if `s.sSector.z != 0` (message "must reach
  the surface"); vehicles get `SetUpMvtGroupForVehicle`; the new leg starts at **the last sector of the current path**
  (`GetLastSectorIdInCharactersPath`, `Strategic_Pathing.cc:752-767`, the soldier's sector if no path) and is appended;
  then copied to the vehicle or the squad. The map UI calls it only when the destination is passable "through"
  (`SectorIsPassable`) and the temporary preview path is non-empty (`Strategic/MapScreen.cc:2281-2328`), then copies the
  path to every selected character.
- Confirm (clicking the last path sector): `RebuildWayPointsForAllSelectedCharsGroups` — once per group id, path of the
  vehicle or of the selected destination character (`MapScreen.cc:5520-5661`).
- Shorten: `ClearPathAfterThisSectorForCharacter(s, sector)` (`Map_Screen_Interface_Map.cc:904-969`): no path → abort;
  sector == his sector → cancel all selected; else cut the path after the last occurrence of `sector` (vehicle path
  too) and copy to all selected if it got shorter.
- Cancel: `CancelPathForCharacter(s)` (`:972-1001`): clear the path and the group's waypoints, then
  `RebuildWayPointsForGroupPath(null, group)` (reverses a moving group, §3.4), vehicles via `CancelPathForVehicle`, copy
  to the squad.
- `ClearMercPathsAndWaypointsForAllInGroup(g)` clears every member's and the vehicle's path and the waypoints
  (`Strategic_Pathing.cc:1097-1121`).

Who may be given a destination: `CanEntireMovementGroupMercIsInMove(s)` = `CanCharacterMoveInStrategic` for him, then for
every character in the list who is in his group or selected (`Strategic/Map_Screen_Interface.cc:3873-3903`).
`CanCharacterMoveInStrategic` (`:3743-3870`), first failure wins:

| Check | Result |
|---|---|
| in transit / POW / `sSector.z != 0` | `ME_TRANSIT` 8 / `ME_POW` 5 / `ME_UNDERGROUND` 1 |
| is a vehicle: no passengers / life < OKLIFE / `sBreathRed == 0` (fuel) | `ME_VEHICLE_EMPTY` 32 / `_DAMAGED` 47 / `_NO_GAS` 42 |
| person: life ≤ 0 / life < OKLIFE | custom "dead" / "too injured" |
| not between sectors and not aboard the airborne heli: sector loaded and `INCOMBAT` / loaded and `fEnemyInSector` / loaded and bloodcat ambush with hostile cats / `NumHostilesInSector(sector) > 0` | `ME_COMBAT` 11 / `ME_ENEMY` 2 / `ME_COMBAT` / `ME_ENEMY` |
| L12 museum rooms 22–41 with Eldin alive and anyone carrying the chalice | `ME_MUSEUM` 34 |
| assignment ≥ ON_DUTY and ≠ VEHICLE | `ME_BUSY` 3 |
| `PlayerSoldierTooTiredToTravel` (§3.7) | custom |
| robot without its controller in the squad/vehicle; EPC with no non-EPC in the squad/vehicle | `ME_ROBOT_ALONE` 49 / custom |
| Maria in C5 | custom |

### 3.4 Waypoints: `RebuildWayPointsForGroupPath(path, g)` and `AddWaypointToPGroup` (`Strategic_Pathing.cc:799-897`)

```
DeleteStrategicEvent(GROUP_ARRIVAL, g.id); RemoveGroupWaypoints(g)        // waypoints = null, next waypoint id = 0
if path == null || path.next == null:
  if g.player && g.between: GroupReversingDirectionsBetweenSectors(g, g.sector, FALSE)   // go back
  return
oldDelta = g.between ? index(g.next) − index(g.sector) : 0
for node in path while node.next:
  delta = node.next − node                                             // strategic indices
  if oldDelta != 0 && delta != oldDelta: AddWaypointStrategicIDToPGroup(g, node)   // pivots only
  oldDelta = delta
AddWaypointStrategicIDToPGroup(g, last node)                           // always the destination
if g.arrival == nowMin: GroupArrivedAtSector(g, TRUE, TRUE)            // reversed back before leaving
```

`AddWaypointToPGroup(g, s)` (`Strategic_Movement.cc:360-457`): with no waypoints yet, first try
`GroupReversingDirectionsBetweenSectors(g, s, TRUE)`; if it reversed, push the group's new current sector onto the front
of every member's path and skip the alignment check; otherwise the new point must differ from the group's sector (or
the last waypoint) in exactly one axis (diagonal or identical → error, false). Append the waypoint; **the first waypoint
starts movement** (`InitiateGroupMovementToNextSector`, §3.6) unless reversed. For player groups every member's
`ubStrategicInsertionCode` is set to 0 (= `INSERTION_CODE_NORTH`, "nuke tactical traversal information").

`GroupReversingDirectionsBetweenSectors(g, s, building)` (`:242-305`): only if between sectors and the clipped direction
to `s` differs from `ubNext − ubSector` (a 90° turn counts as a reversal; a zero vector always differs). Then: delete the
arrival event; `prev = next; next = sector; sector = prev` (sector and next swapped); members' `sSector` follow;
**arrival = traverse − arrival + 2·nowMin** (the time already travelled; traverse time unchanged); if still in the future
re-post `GROUP_ARRIVAL` (+ `ABOUT_TO_ARRIVE` at arrival − 5 for players if still ahead); else, unless building waypoints,
`GroupArrivedAtSector(g, TRUE, TRUE)`.

### 3.5 Travel time per edge: `GetSectorMvtTimeForGroup(byte, dir, g)` (`Strategic_Movement.cc:2065-2190`)

```
t = SectorInfo[byte].ubTraversability[dir]; best = 1000000
if t == EDGEOFWORLD: IMPOSSIBLE (0xFFFFFFFF)
if t == TOWN && mask != AIR: return 5                     // any ground transport, no encumbrance
if mask & FOOT:  m = {ROAD 100, PLAINS 85, SAND 50, SPARSE 70, DENSE 60, SWAMP 35, WATER 25, HILLS 50, NS_RIVER 25, EW_RIVER 25}
                 else IMPOSSIBLE;  best = min(best, 89·100/m)
                 if g.player: e = max(100, CalculateCarriedWeight(s) for members with assignment != VEHICLE); best = best·e/100
if mask & CAR:     ROAD 100 else IMPOSSIBLE;                                 best = min(best, 30·100/m)
if mask & TRUCK:   ROAD 100, PLAINS 75, SPARSE 60, HILLS 50 else IMPOSSIBLE; best = min(best, 32·100/m)
if mask & TRACKED: ROAD 100, PLAINS 100, SAND 70, SPARSE 60, HILLS 60, rivers 20, WATER 10 else IMPOSSIBLE; min(best, 46·100/m)
if mask & AIR:     best = min(best, 10)
return best
```

Resulting minutes (integer division):

| Edge | Foot | Car | Truck | Tracked | Air |
|---|---|---|---|---|---|
| TOWN | 5 | 5 | 5 | 5 | 10 |
| ROAD | 89 | 30 | 32 | 46 | 10 |
| PLAINS | 104 | — | 42 | 46 | 10 |
| SAND | 178 | — | — | 65 | 10 |
| SPARSE | 127 | — | 53 | 76 | 10 |
| DENSE | 148 | — | — | — | 10 |
| SWAMP | 254 | — | — | — | 10 |
| WATER | 356 | — | — | 460 | 10 |
| HILLS | 178 | — | 64 | 76 | 10 |
| NS/EW_RIVER | 356 | — | — | 230 | 10 |
| GROUNDBARRIER | — | — | — | — | 10 |

`CalculateCarriedWeight` is the existing `carriedWeightPercent` (`src/sim/tactical/inventory.ts:375`). Fatigue does not
change speed; it stops the group at the next sector (§3.10). There is no strongest- or slowest-member rule beyond the
encumbrance maximum (the most loaded walker slows the whole group; vehicle passengers never count). Any mask bit whose
terrain is impossible makes the whole edge impossible (mixed masks never occur for players).

ETA: `FindTravelTimeBetweenWaypoints(a, b, g)` walks byte ids from `a` to `b` one step at a time (direction from the
sign of the byte difference and divisibility by 16) summing edge times (`:1989-2062`); `CalculateTravelTimeOfGroup(g)` =
`arrival − now` (if between sectors and arrival ≥ now) + legs from `ubNext` (or `ubSector`) through every waypoint
(`:1927-1986`). It ignores `ubNextWaypointID` and starts with waypoint 0 (inferred harmless for ONE_WAY player groups,
whose passed waypoints are removed by rebuilding).

### 3.6 Departure: `InitiateGroupMovementToNextSector(g)` (`Strategic_Movement.cc:1643-1805`)

```
wp = waypoint[g.nextWaypointId]; d = wp − g.sector
dir/step: d.x ≥ 1 → EAST (x+1); elif d.y ≥ 1 → SOUTH; elif d.x ≤ −1 → WEST; elif d.y ≤ −1 → NORTH; else error, return
g.next = g.sector + step
if g.sector.z == 0:
  if !g.player && (hour >= 21 || hour <= 4) && Chance(67):     // enemy sleeps: one Random(100), then Random(121)
    g.traverse = GetSectorMvtTimeForGroup(byte, dir, g); sleep = 360 + Random(121)
  else g.traverse = GetSectorMvtTimeForGroup(byte, dir, g)
else g.traverse = 1
g.traverse += sleep
if tacticalTraversal.active && tacticalTraversal.group == g: g.traverse = undergroundTacticalTraversal ? 1 : 5
if !g.between: g.between = true; g.arrival = nowMin + g.traverse      // an already moving group keeps its arrival
if randomizingPatrolGroup: g.traverse = 1 + Random(g.traverse − 1); g.arrival = nowMin + g.traverse   // docs/17 init
if g.vehicle: vehicle.between = true; non-heli: vehicle soldier between, RemoveSoldierFromTacticalSector
post GROUP_ARRIVAL(g.id) at g.arrival
if g.player:
  if g.arrival − 5 > nowMin: post GROUP_ABOUT_TO_ARRIVE at g.arrival − 5      // UINT32 arithmetic
  for s in members: s.between = true; RemoveSoldierFromTacticalSector(s)
  CheckAndHandleUnloadingOfCurrentWorld()                                   // §5.10
  if g.sector.z == 0: DelayEnemyGroupsIfPathsCross(g)
```

`DelayEnemyGroupsIfPathsCross(pg)` (`:1616-1639`): every enemy group with `arrival < pg.arrival`, `next == pg.sector` and
`sector == pg.next` (head-on) gets its event re-posted at `pg.arrival + 1 + Random(10)` — the player always meets it in
the destination sector.

Events: `EVENT_GROUP_ARRIVAL` (18) → `GroupArrivedAtSector(g, TRUE, FALSE)`; `EVENT_GROUP_ABOUT_TO_ARRIVE` (35) →
`HandleGroupAboutToArrive`: map redraw and the Dead-is-Dead autosave only (`Strategic/Game_Event_Hook.cc:158-160,201-203`,
`Strategic/Map_Screen_Interface.cc:1226-1236`); ja2-node keeps the event for queue parity but it has no effect.
`ABOUT_TO_ARRIVE_DELAY` = 5 (`:55`).

### 3.7 Fatigue and stopping

`PlayerSoldierTooTiredToTravel(s)` (`Assignments.cc:6346-`): only for soldiers who sleep; in a vehicle only the
forced driver counts; asleep and not awakenable, or awake with `bBreathMax < BREATHMAX_GOTTA_STOP_MOVING` (30).
`AnyMercInGroupCantContinueMoving(g)` (`:6318-6343`) puts every such member to sleep (`fMercCollapsedFlag`) with quotes and
returns true. Hourly `FatigueCharacter` (`:2073-2117`) lowers `bBreathMax`, ×encumbrance/100 above 100% for walkers: owned
by `docs/18`.

### 3.8 Experience and fuel on arrival

`AwardExperienceForTravelling(g)` (`:997-1026`), per member not mechanical and not EPC: `bLifeMax < 100` →
`points = traverse / (450 / (100 − lifeMax))`, `StatChange(HEALTHAMT, points, FROM_SUCCESS)` if > 0; `bStrength < 100` and
carried > 50% → `points = traverse / (450 / (100 − str))`, `StatChange(STRAMT, points·(carried − 50)/100)` (called even
with 0). Integer divisions; `450 / (100 − x)` is 4 at 0, 450 at 99. Vehicles (not the heli): fuel `sBreathRed −=
traverse·6` (min 0), `bBreath = (sBreathRed + 99) / 100`; empty → message, paths cleared (`:3106-3118, 1163-1176`).

### 3.9 Arrival: `GroupArrivedAtSector(g, checkForBattle, neverLeft)` (`Strategic_Movement.cc:1077-1380`)

```
waitingForInput = false
if g.player:
  first member's assignment < ON_DUTY → ResetDeadSquadMemberList(it)
  vehicle (not heli) with size ≤ 1 → return            // empty car arrives silently
  non-vehicle with no members → return (error)
c = (g.next.x, g.next.y, g.sector.z)
queue = (boxing && !g.player && c == D5)
     || (checkForBattle && fEnemyInSector && FindPlayerMovementGroupInSector(world) && (c != world || world.z > 0))
     || inMeanwhile || (checkForBattle && HostileCiviliansPresent()) || (checkForBattle && HostileBloodcatsPresent())
if queue:                                              // one battle at a time
  g.arrival += inMeanwhile ? 1 : 3 + Random(3); post GROUP_ARRIVAL; players: ABOUT_TO_ARRIVE if arrival − 5 > now
  return
g.prev = g.sector; g.sector = c; g.next.x = g.next.y = 0
if g.player && !neverLeft: walkers → AwardExperienceForTravelling; ground vehicles → fuel (§3.8)
g.traverse = 0; g.arrival = 0; g.between = false
destroyed = false
if g.player:
  GroupAtFinalDestination(g) → ClearMercPathsAndWaypointsForAllInGroup(g)        // ONE_WAY at last waypoint (:2863-2887)
  c.z == 0 && secret at c → SetSectorSecretAsFound
  (dir, code) = c.x < prev.x ? (SOUTHWEST, INSERTION_CODE_EAST) : c.x > prev.x ? (NORTHEAST, WEST)
              : c.y < prev.y ? (NORTHWEST, SOUTH) : c.y > prev.y ? (SOUTHEAST, NORTH) : error, return
  here = c == world
  walkers: each member: between = false, sector = c, prevSectorId = prev.byte, insertionDirection = dir,
           insertionCode = code unless it is PRIMARY/SECONDARY_EDGEINDEX, path = RemoveHead(path), here → UpdateMercInSector(s)
  vehicle: vehicle path head removed, SetVehicleSectorValues, not between
           ground: vehicle soldier and every member: not between, sector, dir, code (always), here → UpdateMercInSector
           heli: destroyed = HandleHeliEnteringSector(sector, neverLeft)
  final destination && c.z == 0 && !neverLeft → "arrived" message (UI)
  !destroyed && not the heli group: bloodcat lair (isLair spawn) not yet visited → AddCorpsesToBloodcatLair(c);
                                    SetSectorFlag(c, SF_ALREADY_VISITED)
if !destroyed:
  if checkForBattle && !CheckConditionsForBattle(g) && !waitingForInput:
    HandleNonCombatGroupArrival(g, main = true, neverLeft)
    then for each group (list order, deletion-safe) with ARRIVED_SIMULTANEOUSLY while the counter > 0:
      counter−−; HandleNonCombatGroupArrival(it, false, false)
  else: g.flags = 0; numAwareBattles > 0 → −−                  // also when checkForBattle is FALSE or a prompt opened
waitingForInput = false
```

`AddCorpsesToBloodcatLair` writes three JFK-type corpses (grid 14319, 9835, 11262, one `Random(8)` direction for all,
time of death now − 2 days, `ROTTING_CORPSE_FIND_SWEETSPOT_FROM_GRIDNO`) into the lair's corpse diff (`:1029-1068`).

### 3.10 Non-combat arrival (`:1383-1440`, `:3458-3608`)

```
HandleNonCombatGroupArrival(g, main, neverLeft):
  if StrategicAILookForAdjacentGroups(g): return          // docs/17; may delete an enemy group
  if g.player:
    if !heli group: SetThisSectorAsPlayerControlled(g.sector, FALSE)        // §6.1, uncontested
    if GroupAtFinalDestination(g):
      if PlayerMercsInSector(selectedSector) == 0: select g.sector (UI)
      if !heli: StopTimeCompression; if !tacticalTraversal && !neverLeft: RandomMercInGroupSaysQuote(REACHED_DESTINATION)
    PlayerGroupArrivedSafelyInSector(g, main)
  else: fDebugGroup ? RemoveGroup(g) and return : CalculateNextMoveIntention(g)
  g.flags = 0

PlayerGroupArrivedSafelyInSector(g, checkNPCs):
  prompted = checkNPCs && NPC-of-note prompt opened
  if !prompted && !GroupAtFinalDestination(g):
    if AnyMercInGroupCantContinueMoving(g): ClearMercPathsAndWaypointsForAllInGroup(g); StopTimeCompression
    else RebuildWayPointsForGroupPath(GetGroupMercPathPtr(g), g)              // continue from the new path head
```

NPC-of-note prompt (`HandlePlayerGroupEnteringSectorToCheckForNPCsOfNote`, `:3504-3536`): skipped for empty groups, the
heli, or while another prompt is open; fires when `WildernessSectorWithAllProfiledNPCsNotSpokenWith(sector)`: surface,
`bNameId == BLANK_SECTOR`, not a SAM sector, and every non-player, non-vehicle, alive profile located there has
`ubLastDateSpokenTo == 0` and is not recruited/escorted (one spoken-to NPC there cancels the prompt) (`:3539-3581`). The
box is OK at the final destination, Continue/Stop otherwise; Yes/OK → `PlayerGroupArrivedSafelyInSector(g, FALSE)`; No →
clear paths, select the sector, stop compression (`:3584-3608`).

`CalculateNextMoveIntention(g)` (`:915-992`, enemy): if not between sectors and it has waypoints and stands on
`waypoint[nextId]`: ONE_WAY → stop at the last one else `nextId++`; CIRCULAR → wrap to 0; ENDTOEND_FORWARDS → at the end
`nextId−−` and flip; BACKWARDS → at 0 `nextId++` and flip; then `InitiateGroupMovementToNextSector`.

### 3.11 Stops, teleports and retreat

- `SetGroupSectorValue(s, g)` (`:1878-1900`): remove waypoints, sector = next = s, not between, original = byte, delete
  the arrival event, members' sector = s and not between, `CheckAndHandleUnloadingOfCurrentWorld`. Used by squads, exit
  grids, the warp out of creature lairs.
- `SetGroupNextSectorValue` (`:1916-1924`), `PlaceGroupInSector(g, prev, next, check)` (`:3390-3399`: clear paths;
  `g.prev = prev`; sector = (prev.x, prev.y, next.z); next = next; `GroupArrivedAtSector(g, check, FALSE)`).
- `MoveAllGroupsInCurrentSectorToSector(s)` (`:2370-2386`) for scripted moves.
- `RetreatGroupToPreviousSector(g)` (`:2765-2827`, called by `docs/19`): no previous sector (P16) →
  `CalculateGroupRetreatSector` (first of N, E, W, S that is not GROUNDBARRIER/EDGEOFWORLD; members' `prevSectorId`)
  (`:2720-2761`); `next = prev`; direction from the delta (else `runtime_error`); traverse = edge time, 0 → 5;
  arrival = now + traverse; between; `|= JUST_RETREATED_FROM_BATTLE`; post events; members between and removed from the
  tactical sector. No waypoints: the group stops in the previous sector.
- `ResetMovementForEnemyGroup(g)` (`:2938-2964`): an enemy group not between sectors → `RepollSAIGroup` (`docs/17`);
  otherwise re-post its arrival at `now + traverse` (traverse > 400 → 90 first): it is now 0% along its edge.

### 3.12 Simultaneous arrivals (`:1447-1613`)

`HandleOtherGroupsArrivingSimultaneously(sector)` runs at the start of every battle check: scanning the queue from its
head while `timestamp ≤ now (seconds)`, every non-deleted `GROUP_ARRIVAL` whose group is between sectors with `next ==
sector` is arrived immediately with `GroupArrivedAtSector(it, FALSE, FALSE)`, flagged `ARRIVED_SIMULTANEOUSLY`, counted,
its event deleted, and the scan restarts. They join the battle (or are released after a non-combat arrival, §3.9).

`PossibleToCoordinateSimultaneousGroupArrivals(first)`: not if already APPROVED/CHECKED or the heli; count other player
groups between sectors heading to `first.sector`, not CHECKED, not the heli, marking them CHECKED; none → false;
otherwise pause, remember `first`, ask "Coordinate a simultaneous arrival?" (enemies or bloodcats), `waitingForInput =
true`, return true. Yes → `PrepareGroupsForSimultaneousArrival`: latest arrival among those groups; each gets APPROVED,
its event re-posted at that time (+ about-to-arrive), `DelayEnemyGroupsIfPathsCross`; the first group is warped back
(`next = sector, sector = prev`, between, same arrival, events). No → `PrepareForPreBattleInterface(first, first)`.

### 3.13 Underground

Players cannot plot routes underground (`ME_UNDERGROUND`); underground sectors are reached only tactically (exit grids
and the few underground edges, §5.9). Enemy and creature counts underground are static per node (`docs/17`); no
enemy group moves underground. `UndergroundTacticalTraversalTime(dir)` is 0 if the loaded map has the entry point of
that edge, else impossible (`StrategicMap.cc:179-193`).

### 3.14 Group counting helpers

`PlayerMercsInSector(s)`: groups not between sectors at `s` (z included), members with life > 0, robots count, vehicles
not (`:2193-2212`). `FindPlayerMovementGroupInSector(s)` — the PBI "involved group" test: size > 0, not between, sector
== s, **z == 0**, no in-transit/dead/POW member, not the airborne heli (`:2843-2860`). Enemy counts
(`Strategic/Queen_Command.cc:53-228`): `NumEnemiesInSector` = stationary (`SectorInfo`, ignores z) + `ubGroupSize` of
every non-vehicle enemy group whose `ubSector == s` — **including groups that departed `s` and are still between
sectors**; `NumHostilesInSector` adds creatures and handles z > 0 via the underground node; `NumStationaryEnemiesInSector`
is 0 without a garrison or for a ROADBLOCK composition; `NumMobileEnemiesInSector` compares `ubGarrisonID` with
`ROADBLOCK` (a composition id; a Strac/vanilla bug owned by `docs/17`).

### 3.15 Vehicles (basics; full use in M5/M6)

`VEHICLETYPE {pMercPath, ubMovementGroup, ubVehicleType, sSector, pPassengers[10], fBetweenSectors, fDestroyed,
fValid}` (`Tactical/Vehicles.h`). `AddVehicleToList(sector, grid, type)` reuses the first invalid slot (garbage-collects
destroyed vehicles in other sectors first), takes `gubVehicleMovementGroups[slot]` as its group and sets the group's
mask from `vehicles.json`, sector/next, traverse = arrival = 0 (`Vehicles.cc:75-121`). The vehicle soldier
(`SOLDIER_VEHICLE`) is a member of its own group and of a squad. `AddSoldierToVehicle` (`:157-284`): an empty ground
vehicle first joins a unique squad and its group; the passenger leaves his squad (or his own group is removed),
assignment VEHICLE, joins the vehicle group, first one is `SOLDIER_DRIVER`. Movement is the group's (mask CAR: roads and
towns only). Fuel in `sBreathRed` (10000 full), gas can adds `status·50` (`Strategic_Movement.cc:3121-3150`).
`vehicles.json` order is fixed (HELICOPTER is index 5).

### 3.16 Helicopter (summary; can wait until the Skyrider quest, M6)

The heli is vehicle `iHelicopterVehicleId` with mask AIR (10 min per edge, all terrain but EDGEOFWORLD, towns included).
Routes cost 100 per sector left in safe airspace, 1000 in enemy airspace (unless SHIFT). Arrival (`HandleHeliEnteringSector`,
`Strategic/Map_Screen_Helicopter.cc:199-295`): SAM attack if the sector is enemy airspace covered by a working SAM:
`PreRandom(100) < min(condition, 33)` → hit 1 minor, hit 2 returns to base, hit 3 destroyed (`:1046-1136`); enemies below
and unknown → `PreRandom(100) < 60 + n` sets `SF_SKYRIDER_NOTICED_ENEMIES_HERE` (+ quote `Random(2)`); unless returning
to base or never left, bill +100/+1000; at the path end: hover (events `HOVER_TOO_LONG` 29 at +10 min,
`HOVER_WAY_TOO_LONG` 30 at start + 20), pay if safe, land at a refuel site. `setArrivalTime` clamps the heli to
`now + traverse` (`Strategic_Movement.cc:3401-3430`); the heli never joins simultaneous arrivals. M4 can ship without
it; keep `IsGroupTheHelicopterGroup` hooks returning false.

---

## 4. Encounters

### 4.1 `CheckConditionsForBattle(g)` (`Strategic_Movement.cc:704-883`)

```
s = g.sector; s0 = (s.x, s.y, 0)
if worldLoaded && world == s0 && FindPlayerMovementGroupInSector(world) && PlayerMercsInSector(world) && fEnemyInSector:
  HandleArrivalOfReinforcements(g); return true                         // joins the running battle (§4.6)
if !gameJustStarted: encounterCode = NO_ENCOUNTER
HandleOtherGroupsArrivingSimultaneously(s)
combatAble = alive = false; dialogGroup = null                         // accumulate across groups
for pg in player groups (list order): size > 0, !between, pg.sector == s0, no in-transit/dead/POW member,
                                      not the airborne heli, not a vehicle without passengers:
  for m in pg.members, m not a vehicle: (!robot && !EPC && life >= OKLIFE) → combatAble; life > 0 → alive
  if !dialogGroup && combatAble: dialogGroup = pg
  if combatAble: break
pending = militia = cats = false
if g.player:
  dialogGroup = g
  if NumEnemiesInSector(s) > 0: pending = true                          // surface counts even underground
  if g.flags & HIGH_POTENTIAL_FOR_AMBUSH && pending: highPotentialForAmbush = true
  if TestForBloodcatAmbush(g): cats = pending = true                    // §4.2, sets encounterCode
  if pending && (!cats || encounterCode == ENTERING_BLOODCAT_LAIR) && PossibleToCoordinateSimultaneousGroupArrivals(g):
    return false                                                        // prompt open
else:                                                                   // enemy group
  if CountAllMilitiaInSector(s) > 0: militia = pending = true
  if alive: pending = true
if !alive && !militia: return false
if !pending: return false
clear ARRIVED_SIMULTANEOUSLY on groups while the counter > 0 (counting down)
initPrebattleGroup = g
if encounterCode in {BLOODCAT_AMBUSH, ENTERING_BLOODCAT_LAIR}: NotifyPlayerOfBloodcatBattle → box → TriggerPrebattleInterface; return true
if !combatAble:                                                         // only unconscious mercs and/or militia
  delayAutoResolveStart = true; usePersistentPBI = true
  militia ? NotifyPlayerOfInvasionByEnemyForces(s, Trigger) : box "enemies attack your unconscious mercs" → Trigger
if dialogGroup: PrepareForPreBattleInterface(dialogGroup, g)
return true
```

`TriggerPrebattleInterface` stops compression and queues `InitPreBattleInterface(initPrebattleGroup, true)` on the
dialogue queue (`:905-910`). `NotifyPlayerOfInvasionByEnemyForces` (`Map_Screen_Interface.cc:3711-3740`) does nothing for
z > 0 or an enemy-controlled sector, shows a box (and then calls back) for SAM and town sectors, and only prints a
message for other sectors — **no callback** there (inferred: militia exist only in towns/SAM sectors, so unreachable).

### 4.2 Bloodcats: `TestForBloodcatAmbush(g)` (`:3263-3360`)

```
if g.sector.z: false
chance = 5·difficulty (1..3)
lair/arena from strategic-bloodcat-spawns.json; hours = (nowMin − lastLoaded) / 60
if lair || arena:
  bBloodCats == −1 → = placements
  elif 0 < cats < placements → cats += min(hours / 18, placements − cats)       // slow recovery; 0 stays 0
elif cats == −1:                                                               // first visit decides
  if autoAmbush || PreChance(chance):
    byDiff = Random(4) + 2·diff + 3; byProgress = max(progress / (7 − diff), 3)   // progress: docs/17
    cats = min(byDiff, byProgress)
    if diff != HARD: cats = max(min(cats, 2·PlayerMercsInSector(sector)), 3)
    cats = min(cats, placements)
elif !lair:
  if !autoAmbush && PreChance(95): alreadyAmbushed = true                      // 5% chance to be ambushed again
if !alreadyAmbushed && !arena && cats > 0 && !g.vehicle && NumEnemiesInSector == 0:
  encounterCode = (!lair || !FACT_PLAYER_KNOWS_ABOUT_BLOODCAT_LAIR) ? BLOODCAT_AMBUSH : ENTERING_BLOODCAT_LAIR; true
else encounterCode = NO_ENCOUNTER; false
```

Note the first-visit branch leaves `cats` at −1 when the `PreChance` fails, so every later visit rolls again; a
sector with `bBloodCats == 0` rolls `PreChance(95)` and still returns false.

### 4.3 Encounter codes (`Strategic/PreBattle_Interface.h`)

| Code | Value | Set by |
|---|---|---|
| `NO_ENCOUNTER_CODE` | 0 | battle check start, bloodcat test |
| `ENEMY_INVASION_CODE` | 1 | `docs/19` (enemy group into a town/SAM sector); `HandlePotentialBringUpAutoresolveToFinishBattle` |
| `ENEMY_ENCOUNTER_CODE` | 2 | `docs/19` (player meets mobile enemies) |
| `ENEMY_AMBUSH_CODE` | 3 | `docs/19` (90% with high potential; outnumbered rules) |
| `ENTERING_ENEMY_SECTOR_CODE` | 4 | `docs/19` (stationary enemies); `CalculateNonPersistantPBIInfo` after a tactical traversal (`PreBattle_Interface.cc:1147-1198`); game start in an enemy sector (`Map_Screen_Interface.cc:3648-3656`) |
| `CREATURE_ATTACK_CODE` | 5 | `docs/17`/`19` |
| `BLOODCAT_AMBUSH_CODE`, `ENTERING_BLOODCAT_LAIR_CODE` | 6, 7 | §4.2 |
| `FIGHTING_CREATURES_CODE`, `HOSTILE_CIVILIANS_CODE`, `HOSTILE_BLOODCATS_CODE` | 8–10 | explicit code only (`docs/19`) |

Effects inside this doc: `ENEMY_AMBUSH`/`BLOODCAT_AMBUSH` place every non-civilian soldier entering the sector at the
map centre (`INSERTION_CODE_GRIDNO` = `sCenterGridNo`) while the battle locator is shown (`StrategicMap.cc:955-965`), and
deny the placement GUI (§5.8).

### 4.4 `PrepareForPreBattleInterface(dialogGroup, battleGroup)` (`:608-694`) — the hand-off

Candidates: members of `dialogGroup` with life ≥ OKLIFE, not mechanical, not EPC. Music → enemy present. If
`(tacticalTraversal && battleGroup == traversal group)` or `battleGroup` is an enemy group in the loaded surface sector:
with candidates: `JUST_RETREATED` → `cantRetreatInPBI`; `chosen = candidates[Random(n)]`; traversal → remember `chosen`
(he says "enemy presence" after the load, §5.9); else the chosen merc's quote, after which the face triggers
`InitPreBattleInterface(battleGroup, true)`; pause; `fDisableMapInterfaceDueToBattle` unless traversal; return. Otherwise
with candidates: same `cantRetreat` rule, `Random(n)` merc quote → PBI, pause, disable map; without candidates:
`InitPreBattleInterface(battleGroup, true)` at once. Everything from `InitPreBattleInterface` on (persistent PBI,
encounter-code refinement, autoresolve, "go to sector", retreat) is `docs/19`'s; `InitPreBattleInterface` returns early
for a tactical traversal of that group or underground (`PreBattle_Interface.cc:205-208`). The `Random(n)` speaker choice
is cosmetic (quote only) except that for traversal it picks the one who speaks after loading: also cosmetic.

### 4.5 Enemy groups arriving at player sectors

An enemy group's arrival runs the same check: a player group present (alive member) or militia → battle; only
unconscious mercs → instant autoresolve flow (`delayAutoResolveStart`, persistent PBI, `docs/19`); nobody → no battle,
`HandleNonCombatGroupArrival` → `StrategicAILookForAdjacentGroups` and `CalculateNextMoveIntention` (`docs/17`). Taking
an empty player sector is `docs/17`'s (`SetThisSectorAsEnemyControlled`, §6.1).

### 4.6 Reinforcements into the loaded battle

- `HandleArrivalOfReinforcements(g)` (`:2253-2290`): player group → insertion code from `ubSector` vs `ubPrev` (as §3.9;
  same sector → `logic_error`), each member `UpdateMercInSector(s, (x,y,0))`, the first says "reached destination", a
  message. Enemy group → `gfPendingEnemies = true`, `ResetMortarsOnTeamCount`, `AddPossiblePendingEnemiesToBattle`.
- `AddPossiblePendingEnemiesToBattle()` (`Queen_Command.cc:914-999`): only if pending; free enemy slots (inactive ids of
  the enemy team); for each enemy group in the loaded surface sector (list order) while slots remain: add one at a time
  troops first, then elites, then admins until the group's not-yet-in-battle count or the slots run out; insertion code
  from `ubPrev` (else from `ubNext`) as for players; `AddEnemiesToBattle`. Slots left → pending = false.
- `AddEnemiesToBattle(g, code, a, t, e)` (`:1002-1047`): facing N→SE, E→SW, S→NW, W→NE; `ChooseMapEdgepoints(code, n)`;
  repeatedly `roll = Random(remaining)`: `< elites` elite, `< elites + troops` troop, else admin; `TacticalCreateEnemySoldier`,
  group id set; slot `k` < edgepoints → `INSERTION_CODE_GRIDNO` at that edgepoint, else the entry point;
  `UpdateMercInSector`.

---

## 5. Sector transitions and persistence

### 5.1 Ways into tactical

| Path | Gate | Calls |
|---|---|---|
| Map screen "go to tactical" on the selected sector | `AllowedToExitFromMapscreenTo(TACTICAL)` (`Strategic/Map_Screen_Interface_Bottom.cc:985-1070`): not already leaving, dialogue queue empty, no meanwhile, pause not locked, no held item/boxes, no battle roster; if `INCOMBAT` or `fEnemyInSector` or a bloodcat ambush is on, only the loaded sector; `CanGoToTacticalInSector` (a living, non-vehicle, not in transit/POW/dead, not airborne, not moving merc there, `StrategicMap.cc:2269-2293`) | `SetCurrentWorldSector(sSelMap)` |
| PBI "enter sector" | `docs/19`; first time with a player battle group and no ambush/creatures/bloodcats → `gfEnterTacticalPlacementGUI` (`PreBattle_Interface.cc:1007-1041`) | `SetCurrentWorldSector(pbSector)` |
| Tactical traversal (edge or exit grid) | §5.9 | `SetCurrentWorldSector(adjacent)` |
| New game start | `HandleTimeCompressWithTeamJackedInAndGearedToGo` (`Map_Screen_Interface.cc:3621-3660`) | start sector; enemies there → locator + `ENTERING_ENEMY_SECTOR_CODE` |
| Savegame load | `docs/14`, `docs/15` | `SetCurrentWorldSector(save sector)` with `LOADING_SAVED_GAME` |

The original lets the player open the map screen from tactical at any time without unloading; that is a view switch,
not a simulation step (`docs/15` decides time compression there).

### 5.2 `SetCurrentWorldSector(s)` (`StrategicMap.cc:433-560`)

```
SyncStrategicTurnTimes()                                          // docs/15
if world == s:                                                    // same sector (e.g. PBI "enter" while loaded)
  if NumEnemyInSector() == 0: PrepareEnemyForSectorBattle()
  creatures attacking this surface sector → PrepareCreaturesForBattle()   // docs/17
  HandleHelicopterOnGround(true); ResetMilitia(); AllTeamsLookForAll(TRUE); return
if world valid: HandleDefiniteUnloadingOfWorld(ABOUT_TO_LOAD_NEW_MAP)    // §5.10
world = s; select s
if loading a save: music
else: stop speech; Tixa caves (9,10,2) → InitCreatureQuest; uiTimeSinceLastInTactical = nowMin;
      InitializeTacticalStatusAtBattleStart(); HandleHelicopterOnGround(false)
EnterSector(s)                                                    // §5.3
if !loading: InitAI(); ExamineDoorsOnEnteringSector()             // dead code, see §10
UpdateDoorGraphicsFromStatus(); SetSectorFlag(s, SF_ALREADY_LOADED); HandleHelicopterOnGround(true)
if !loading: music; HandleRPCDescriptionOfSector (M6, Random(5)); SetSectorFlag(s, SF_HAS_ENTERED_TACTICAL);
             fHasEnteredCombatModeSinceEntering = false; fDontAddNewCrows = false;
             sCreatureTenseQuoteDelay = 10 + Random(20); z ≥ 2 and a mine warp exists → IN_CREATURE_LAIR else clear;
             ubNumCrowsPossible = 5 + Random(5)
```

### 5.3 `EnterSector(s)` (`StrategicMap.cc:837-906`)

Pause; if a world was loaded, `SetupProfileInsertionDataForCivilians` (profiled civilians' positions into their
profiles, `:3137-3204`); unless loading, `HandleQuestCodeOnSectorEntry(s)` (M6; it also places head miners with
`Random(4)` loops and may roll `Random(10 + militia) < 3` for Kingpin's assassin, `:669-799`); load screen;
`RemoveMercsInSector` (our soldiers off their gridnos); `SF_ALREADY_VISITED` unless in meanwhile; `LoadWorld(map file)`
(`07`, incl. exit grids and edgepoints §5.7); unless loading a save, `LoadCurrentSectorsInformationFromTempItemsFile`
(§5.4; a failure is the "file hack" exit); then either the placement GUI (§5.8) or `PrepareLoadedSector` (§5.5).

### 5.4 `LoadCurrentSectorsInformationFromTempItemsFile` (`Tactical/Tactical_Save.cc:432-514`)

Meanwhile: nothing (interrogation loads items only). Otherwise, by the sector's flags in this order: items (§5.11),
rotting corpses, map modifications, door table, revealed status, door status, preserved enemies (§5.12), preserved
civilians, smoke effects, light effects; `InitLoadedWorld()` (movement costs recompiled); `guiTimeCurrentSectorWasLastLoaded
= sector.uiTimeCurrentSectorWasLastLoaded`; `StripEnemyDetailedPlacementsIfSectorWasPlayerLiberated` (§5.13).

### 5.5 `PrepareLoadedSector()` (`StrategicMap.cc:573-666`)

```
BeforePrepareSector()                                             // mod hook
if !loading: UpdateMercsInSector()                                // §5.6, our team (and others not restored)
ambience
if !loading:
  civilians unless z > 0 in a mine without miners → AddSoldierInitListTeamToWorld(CIV_TEAM)
  AddSoldierInitListTeamToWorld(MILITIA_TEAM); AddSoldierInitListBloodcats()      // §5.13
  PrepareCreaturesForBattle(); PrepareMilitiaForTactical()                         // docs/17, docs/18
  fVirginSector = true
  AddProfilesNotUsingProfileInsertionData()
  if !meanwhile || meanwhile == INTERROGATION: PrepareEnemyForSectorBattle()       // §5.13
  gfRestoringEnemySoldiersFromTempFile = false
  AddProfilesUsingProfileInsertionData(); PostSchedules()                          // M6
CallAvailableTeamEnemiesToAmbush(sCenterGridNo)                   // ambush codes only: CallAvailableEnemiesTo(centre),
                                                                  // a public noise at the centre (TacticalAI/Knowledge.cc:48-60)
if !loading: UnPauseGame
gpBattleGroup = null
if tacticalTraversal.active: CalculateNonPersistantPBIInfo()      // §4.3
AllTeamsLookForAll(TRUE)
```

### 5.6 Placing our soldiers: `UpdateMercsInSector` / `UpdateMercInSector` (`StrategicMap.cc:909-1179`)

`UpdateMercsInSector`: clears interface slots; `BeginMapEdgepointSearch` if edgepoints are used for entry (§5.7); for
every soldier id 0..155 (skipping enemy/creature ids when they were just restored from the temp file):
`RemoveMercSlot`, `bInSector = false`; active, in this sector, not between sectors → (not loading: ambush codes and
locator → centre gridno; `gfOverrideInsertionWithExitGrid` → the exit grid's gridno) → `UpdateMercInSector`; POWs found
here join one new squad (message instead in I13) and end the Alma quest. `EndMapEdgepointSearch`.

`UpdateMercInSector(s, sector)`: inactive or in transit → nothing; profile with a permanent insertion code → orders
STATIONARY; an EDGEINDEX code without an active edgepoint search falls back to `insertionData` (the saved plain code);
then:

| Code | Gridno |
|---|---|
| `NORTH 0, SOUTH 1, EAST 2, WEST 3, CENTER 9` | `gMapInformation.sNorth/South/East/West/CenterGridNo`; −1 → first existing of N, E, S, W, centre (log), none → map centre |
| `GRIDNO 4` | `insertionData` |
| `PRIMARY_EDGEINDEX 7`, `SECONDARY_EDGEINDEX 8` | `SearchForClosest{Primary,Secondary}MapEdgepoint(pendingActionData2, insertionData)`; NOWHERE → code = data, retry |
| `ARRIVING_GAME 5` | start sector loaded → 4379, else code NORTH, north gridno |
| `CHOPPER 6` | `AddMercToHeli` (M5 arrival), return |
| other | map centre `80·160 + 80` |

Then `sInsertionGridNo = g` and `AddSoldierToSector(s)` (`Tactical/Soldier_Add.cc:683-785`): merc slot (or away slot if
off-map), `bInSector`; drivers/passengers stop here; creatures use the struct-data sweet spot (radius 7); vehicles the
struct-data spot trying their insertion direction first (radius 12); everyone else `FindGridNoFromSweetSpot(insertion,
7)` (NOWHERE → the insertion gridno) facing **toward `CENTER_GRIDNO`** unless `ubInsertionDirection ≥ 100` (then
`direction − 100`) or `bUseExitGridForReentryDirection` (face away from the nearest exit grid within 10). The strategic
`ubInsertionDirection` < 100 set on arrival is therefore ignored for people. Placement (`:861-980`): position, facing,
`RevealRoofsAndItems` and stop for our team, `ARRIVING_GAME` walks in from the north sweet spot, enemy presence flag for
hostiles (not bloodcats), roof check, stand (or lie down if life < OKLIFE, sleep if asleep, patient/doctor/repair poses).
ja2-node's `addSoldierToSector` (`src/sim/tactical/creation.ts:236`) matches the sweet spot but not the facing rules yet.

### 5.7 Map edgepoints (`TileEngine/Map_Edgepoints.cc`)

Two classes per side N, E, S, W: primary (`gps1st*`, reachable from the main area) and secondary (`gps2nd*`, isolated
areas, e.g. parts of Grumm and Alma), each a gridno list with a `middle` index (start of the inner row). Maps with the
`MAP_EDGEPOINTS_SAVED` flag and version ≥ 22 load them (`LoadMapEdgepoints`, `:802-831`, already parsed by
`src/content/formats/map.ts`); otherwise `LoadWorld` compiles movement costs and calls `GenerateMapEdgepoints` after
`InitLoadedWorld` (`TileEngine/WorldDef.cc:2391-2443`): a reachability flood from the first existing entry point
(N, E, S, W, centre), then for each side with an entry point two diagonal rows along the visible-map edge from the corner
constants (§1.8), keeping reachable tiles that are outdoors or in a basement (`:315-760`), then validation and
classification (`:84-312`, not traced line by line: port literally). Stub maps have no saved edgepoints, so M4 needs the
generator.

- `ChooseMapEdgepoint(code)`: a primary point by `Random(size)` (`:862-874`).
- `ChooseMapEdgepoints(info, code, n)` (`:877-928`): primary list without MED/DEEP water tiles; `n ≥ size` → all;
  else selection sampling in list order (`Random(slots) < remaining`).
- `BeginMapEdgepointSearch` (20 reservations, `GlobalReachableTest` from the first entry point) /
  `SearchClosestMapEdgepoint(g, list)` (`:931-1060`): the seed itself if listed and unreserved; else a square spiral
  of radius 1.. (< 10 on the surface, < 30 underground) starting top-left and going down, right, up, left, first
  unreserved listed gridno; reserved on success.
- `CalcMapEdgepointClassInsertionCode(g)` (`:1141-1227`): no isolated gridno → PRIMARY; else nearest point of each class
  on the exit side (`gubTacticalDirection`) by Pythagorean distance, path tests with a fake enemy-team soldier (distance
  limit 15); equal validity → the closer class (ties primary); else the valid one. It runs on the **old** map, before
  the next sector loads.

### 5.8 Tactical placement GUI

Entering from the PBI for the first time (`gfEnterTacticalPlacementGUI`) shows the overhead map and lets the player put
mercs on their entry edge (`TileEngine/Tactical_Placement_GUI.cc`); "auto place" is `ChooseRandomEdgepoints`: per
non-vehicle merc `ChooseMapEdgepoint(code)` → `INSERTION_CODE_GRIDNO`, else keep the code (`:545-571`); manual placement
uses `SearchForClosestPrimaryMapEdgepoint`. Done → `KillTacticalPlacementGUI` → `PrepareLoadedSector` (`:491-539`).

### 5.9 Leaving a sector from tactical

**Trigger.** In move mode, the cursor at a scrolled-to screen edge checks `OKForSectorExit(dir)`; a second click on the
confirm cursor opens the exit menu; an exit grid tile under the cursor does the same with `DIRECTION_EXITGRID` (255)
(`Tactical/Handle_UI.cc:670-806`, `Tactical/Turn_Based_Input.cc:2575-2665`). Below creature lairs (z ≥ 2) after the
creature quest, a Yes/No box offers a warp to the surface (`InitSectorExitMenu`, `Tactical/Strategic_Exit_GUI.cc:436-453`;
the warp sets every living in-sector merc's group to the warp sector with `INSERTION_CODE_GRIDNO` and facing 100+NW and
loads it, `:384-418`).

**`SoldierOKForSectorExit(s, dir, grid)`** (`StrategicMap.cc:1945-2032`): on the map, on the ground; edges compare the
soldier's absolute screen position (`GetAbsoluteScreenXYFromMapPos`, `TileEngine/Isometric_Utils.cc:209-232`) with the
render bounds (`InitRenderParams`, `TileEngine/RenderWorld.cc:2114-2150`); with cell `cx = (g % 160)·10`,
`cy = (g / 160)·10` and the constant render centre (`RenderWorld.h:88-93`):

```
absX = 2·(cx − 800) − 2·(cy − 800) − leftX        absY = (cx − 800) + (cy − 800) + 1625 − topY
default map (restricted scroll 0): leftX −1580, topY 860, width 3180, height 1540
basement (restricted scroll 1):    leftX −640,  topY 1330, width 1280, height 590      (derived, verify by probe)
EAST: absX ≥ width − 160   WEST: absX ≤ 160   SOUTH: absY ≥ height − 200   NORTH: absY ≤ 200
exit grid: (real time: movement mode from stance) FindGridNoFromSweetSpotCloseToExitGrid(s, grid, 10) != NOWHERE,
           in combat also EnoughPoints(PlotPath AP cost)
```

**`OKForSectorExit(dir, grid, &minutes)`** (`:2035-2222`) returns 0, 1 (only the selected merc may go) or 2 (the whole
squad): needs a selected merc; for every controllable merc of the current squad: EPCs counted (an uncontrolled robot
sets a flag and is skipped), mercs counted; near the edge → `atLeast++` (and "selected is one of them"); not near and an
edge → the traversal time (surface: edge time; **z > 1** underground: entry-point test; z == 1 stays impossible) — an
impossible edge returns 0 with `gfInvalidTraversal`. Then if anyone may go and fewer than the whole squad: selected EPC
with `atLeast < squad || atLeast == 1` → lone-EPC refusal; one merc with EPCs and not everybody → "can't abandon EPCs";
edge time (z > 0 uses the entry-point test) impossible → 0; result 1 if the selected merc is near, 2 if `atLeast ==
squad count`. Exit grids report 0 minutes.

**Exit menu → jump code** (`Strategic_Exit_GUI.cc:119-376, 685-805`), as a decision table for the API:

```
loadOffered = minutes ≤ 5
mode = ok == 2 ? squad : merc;   squadAllowed = ok == 2;   mercAllowed = ok ≥ 1
incombat && controllable OUR mercs != 1 → loadDisabled
squad mode → load = true
multipleSquads = another merc (≠ sel) here, not moving, life ≥ OKLIFE, other assignment, not POW/in transit/dead
sel is EPC: squad size > 1 → mode squad; mercAllowed = false
else sel is the only non-EPC of his squad with ≥1 EPC → mode squad; mercAllowed = false
fEnemyInSector: multipleSquads or militia here → loadDisabled, load = false; !multipleSquads && mode != squad → loadDisabled, load = false
!multipleSquads && mode == squad → loadDisabled (load stays true)
switch to merc: !multipleSquads → (enemy ? loadDisabled, load = false : load enabled); multipleSquads → load = false
switch to squad: !multipleSquads → loadDisabled, load = true
confirm: jump = (squad ? ALL : SINGLE) + (load && loadOffered ? LOAD_NEW : NO_LOAD)
```

So wilderness edges (> 5 min) always use NO_LOAD: the group travels strategically and the world unloads when nobody is
left (§5.10); towns, underground edges and exit grids may load the next sector at once.

**`JumpIntoAdjacentSector(dir, code, grid)`** (`:1379-1572`): ALL → the first controllable merc of the current squad (his
group); SINGLE → the selected merc, `HandleSoldierLeavingSectorByThemSelf` (NO_LOAD) or `AddCharacterToUniqueSquad`
(LOAD). Edge time as above. Target: `world + SectorIncrementer[dir]` with the soldier's z, or the exit grid's
`ubGotoSector`. Each controllable member: edges → `PickGridNoNearestEdge` (`:2376-2443`: zigzag to the last visible tile
toward the edge, then along the edge alternating sides with growing distance until `NewOKDestination` and a path exist,
up to 255) with `ubWaitActionToDo = 2`, `uiPendingActionData1 = dir`, `sPreTraversalGridNo = gridNo`, walk there; exit
grids → walk to `FindGridNoFromSweetSpotCloseToExitGrid(…, 10)` with `ubWaitActionToDo = 1`. Non-controllable members
are removed from squads. `SetActionToDoOnceMercsGetToLocation(WALKOFF_SCREEN | WALK_TO_GRIDNO, n)` sets
**`DISALLOW_SIGHT`** (all LOS tests return 0, `Tactical/LOS.cc:653-656`) and starts a 2500 ms timer; UI locked.

Walking off (`Tactical/Overhead.cc:788-816, 1080-1134`): a merc reaching his tile with wait code 2 gets two more steps
off the map edge (`AdjustSoldierPathToGoOffEdge`, NE/SW/NW/SE for E/W/N/S, `StrategicMap.cc:2446-2594`) and code 1; code
1 on arrival → counter − 1, stationary, exit grids remove him from the sector. Counter 0 or 2500 ms elapsed (all wait
codes reset) → clear `DISALLOW_SIGHT`, then `AllMercsHaveWalkedOffSector` or `AllMercsWalkedToExitGrid`.

**`AllMercsHaveWalkedOffSector()`** (`:1751-1846`):

```
enemies = NumEnemiesInAnySector(world) > 0
if enemies: HandleLoyaltyImplicationsOfMercRetreat(TACTICAL_TRAVERSAL, world) (docs/18); ClearAIExposedTileMap
if minutes ≤ 5: tacticalTraversal = {true, group}; target.z > 0 → undergroundTacticalTraversal = true
ClearMercPathsAndWaypointsForAllInGroup(group); AddWaypointToPGroup(group, target)      // departs, §3.6
target.z > 0 && minutes ≤ 5 → undergroundTacticalTraversal = true (again; never cleared, §10)
SetupTacticalTraversalInformation()
NO_LOAD: RemoveSoldierFromTacticalSector for members; default squad
LOAD:  enemies → ResetMovementForEnemyGroupsInLocation; minutes > 5 → WarpGameTime(300 s, no events)
       minutes ≤ 5 → WarpGameTime to the start of minute now+5 (surface) / now+1 (underground), processing target-time
                     events first (docs/15) — the group's arrival fires inside the warp; fade → DoneFadeOutAdjacentSector
       else → map screen
```

`SetupTacticalTraversalInformation` (`:1693-1745`): per member: insertion code from the direction (N→SOUTH, S→NORTH,
E→WEST, W→EAST; exit grid → `GRIDNO` + its gridno + face-away flag, `:1272-1299`); `PlotPathForCharacter(s, target,
true)`; if ≤ 5 min: mirror gridno (absolute screen coordinate of his tile with Y := 1520 / 0 or X := 0 / 3160 for N / S /
E / W, back to a gridno), `pendingActionData2 = mirror`, `insertionData = code`, `code =
CalcMapEdgepointClassInsertionCode(preTraversalGridNo)`, LOAD → edgepoint entry on. NO_LOAD clears the traversal state.

**`DoneFadeOutAdjacentSector`** (`:1869-1942`): `SetCurrentWorldSector(target)` (arrival already processed), the chosen
merc's "enemy presence" quote if `fEnemyInSector`, traversal state cleared; caves set `IGNORE_ALL_OBSTACLES`; each member
on the map: `PickGridNoToWalkIn(s, code, &attempts)` (`:2597-2868`: zigzag from his placed tile out to the edge, then
up to 200 attempts alternating along the edge; NOWHERE after 200 → his own tile) → placed there, walks back to his
placed tile, wait code 1; `WAIT_FOR_MERCS_TO_WALKON_SCREEN` (again `DISALLOW_SIGHT` until done or 2.5 s).

**`AllMercsWalkedToExitGrid()`** (`:1618-1690`): `HandlePotentialMoraleHitForSkimmingSectors`: enemies here and combat
never entered since loading → `GROUPFLAG_HIGH_POTENTIAL_FOR_AMBUSH` on the group (`:3207-3224`; only this path sets it);
NO_LOAD → insertion data, removed from the sector, `SetGroupSectorValue(target)` (teleport, no travel time), default squad;
LOAD → traversal flag on; members below OKLIFE are moved to unique squads (left behind); insertion data;
`SetGroupSectorValue(target)`; fade → `DoneFadeOutExitGridSector` (`SetCurrentWorldSector`, quote, clear). Then, if no
mercs are in the **target** sector, `HandleLoyaltyImplicationsOfMercRetreat(…, target)` (`docs/18`; the argument looks
wrong but is literal).

### 5.10 Unloading

`CheckAndHandleUnloadingOfCurrentWorld()` (`StrategicMap.cc:3003-3129`) runs whenever mercs leave (departure,
`SetGroupSectorValue`, autoresolve): no world → false; game just started in the start sector → false; autoresolve screen
in the battle sector → our living combatants there are taken off the map; otherwise any living, non-mechanical, non-EPC
merc still in the loaded sector → false; enemies and friendly militia left alone → autoresolve takes over (`docs/19`) →
false. Then `CheckForEndOfCombatMode(FALSE)`, `EndTacticalBattleForEnemy` (in-battle counters zeroed for the sector and its
enemy groups, profiled enemy flag cleared, "abandoned militia" loyalty event if militia and hostiles are still standing,
`Queen_Command.cc:241-289`), ambients off; in tactical: traversal → false (the next load trashes), else go to the map
screen; `HandleDefiniteUnloadingOfWorld(ABOUT_TO_TRASH_WORLD)`; `TrashWorld()`; flags cleared; world invalid.

`HandleDefiniteUnloadingOfWorld(code)` (`:2902-2953`): clear the tactical event queue, bullets, physics objects, timed
bombs; `HandleQuestCodeOnSectorExit` (Kingpin money, Conrad, hospital supplies, museum alarm fact); not loading: enemy
flag and `INCOMBAT` off; new map: `SaveCurrentSectorsInformationToTempItemFile` (§5.11) and
`UpdateSoldierPointerDataIntoProfile`; trash: save temp files, `SetupProfileInsertionDataForCivilians`, locator off; both:
`HandleMilitiaStatusInCurrentMapBeforeLoadingNewMap` (`docs/18`).

`TrashWorld` (`TileEngine/WorldDef.cc:2507-`): world items, smoke and light effects decayed and reset, **every non-player
soldier removed** (`TacticalRemoveSoldier`), our soldiers only lose their level node, corpses, tile animations, both
soldier init lists, schedules. Our mercs keep their records (sector, inventory, life…) in the roster.

### 5.11 What is saved per sector (temp files → `SectorDiff`)

`SaveCurrentSectorsInformationToTempItemFile` (`Tactical_Save.cc:278-319`), skipped once after a meanwhile:
`SaveBloodSmellAndRevealedStatesFromMapToTempFile` (blood/smell records into `m_`, revealed bits), reachability of
items, then in order: items `i_`, corpses `r_`, door table `d_`, revealed `v_`, door status `ds_`, enemies `e_`,
civilians `c_`, smoke `sm_`, lights `l_`, NPC data into profiles (only while saving a game), `uiTimeCurrentSectorWasLastLoaded
= nowMin` (`:517-533`). Names `<prefix>_<map file name without _a>` (`:1003-1025`); framing in `docs/14` §5.

| Diff | Native | Content | Restore |
|---|---|---|---|
| items | `i_`, `u32 n` × 52-byte `WORLDITEM` | all world items incl. non-existing slots | `SF_ALREADY_LOADED` → map items trashed first; else added to the map's; `GRIDNO_NOT_SET_USE_ENTRY_POINT` → centre gridno; `FIND_SWEETSPOT_FROM_GRIDNO` → nearest free within 5, then 15 (`:556-594`) |
| corpses | `r_`, `u32 n` × 160 | `ROTTING_CORPSE_DEFINITION` incl. time of death | `RemoveCorpses`; sweet spot / entry-point flags; skip invalid gridno; in a town, not loading a save, indoors and dead ≥ 30 min → dropped; `AddRottingCorpse` rots and drops by age (§5.14); `HandleRottingCorpses` (`:624-693`) |
| map changes | `m_`, 8-byte `MODIFY_MAP` (`TileEngine/SaveLoadMap.h`) | `SLM_LAND…ONROOF` add/remove graphics, `BLOOD_SMELL`, `DAMAGED_STRUCT`, `EXIT_GRIDS`, `OPENABLE_STRUCT`, `WINDOW_HIT` | `LoadAllMapChangesFromMapTempFileAndApplyThem` |
| door table | `d_`, `u8 n` × 14 | locks, traps, lock damage, perceived state | replaces the map's |
| revealed | `v_`, 3200 bytes (bit per gridno) | `MAPELEMENT_REVEALED` | `SetMapRevealedStatus` (`TileEngine/SaveLoadMap.cc:411-467`) |
| door status | `ds_`, `u8 n` × 4 | open/closed, perceived | then `UpdateDoorGraphicsFromStatus` |
| enemies / civilians | `e_` / `c_` | §5.12 | §5.12 |
| smoke / lights | `sm_` / `l_` | effect records (`docs/12`) | restored as saved and re-spread; aging continues by world time |

Writers into **unloaded** sectors (needed by `docs/19` and later milestones): `AddItemsToUnLoadedSector` (first
non-existing slot or append, NOWHERE → entry-point flag, `:228-267`), `AddWorldItemsToUnLoadedSector`,
`AddRottingCorpseToUnloadedSectorsRottingCorpseFile` (`:748-770`), `AddDeadSoldierToUnLoadedSector` (`:834-912`:
non-player inventory slots each `Random(100) < 75` → kept undroppable, else dropped (ammo reduced), keys, corpse with
`Random(4)` death animation), `ChangeStatusOfOpenableStructInUnloadedSector`, `AddStructToUnLoadedMapTempFile`. Each
updates `uiNumberOfWorldItemsInTempFileThatCanBeSeenByPlayer` (visible, map-inventory-visible items × count,
`:1031-1112`).

`HandleAllReachAbleItemsInTheSector` (`:322-410`): flood from the centre (else N, E, S, W) entry point, plus the isolated
gridno if any living merc there can path to it; an item is reachable unless trapped, owned (`OWNERSHIP` item at the
tile), or the chalice; reachable if its tile is reachable, it is on a roof, or one of the 4 side neighbours is reachable
with a non-wall, non-door movement cost toward it. Theft (`docs/18`) only takes visible reachable items.

### 5.12 Preserved enemies and civilians (`Tactical/Enemy_Soldier_Save.cc`)

**Save** (`NewWayOfSavingEnemyAndCivliansToTempFile`, `:431-615`), separately for enemy+creature ids and civilian ids:
active, alive, unprofiled soldiers with an init-list node (on or off map) are counted; each upgrades its node to a
detailed placement holding his current stats, life, morale, orders, attitude, body, civilian group, schedule, keys,
sector, class, team, facing, name, patrol points, palettes and **inventory**, and the start position is **current
(`PreRandom(2)` ≠ 0) or the placement's original** (gridno and roof). None → file and flag removed. Header `i16 y`, init-list
links (`u8 n` × {node id, soldier id}), `i16 x`, `i32 slots` (0 while saving a game: only links), `u32 minute`, `i8 z`,
then per soldier the `SOLDIERCREATE_STRUCT` record (`InjectSoldierCreateIntoFile`) + `u16` checksum
(`CalcSoldierCreateCheckSum`), then the sector byte id.

**Load enemies** (`:34-271`): not loading a save → count classes in the file and compare with the sector's
**stationary** counts (`SectorInfo` elites/troops/admins/creatures; underground nodes are not read here, so any
non-empty underground file mismatches) — any difference deletes the file (the normal placement follows). Then
`gfRestoringEnemySoldiersFromTempFile`; header checks (mismatch → exception → "file hack" exit); **older than 300
minutes → delete and place normally**; 0 slots → done. Clear `fPriorityExistance` on every enemy/creature node; for each
saved record take the first non-priority node of the same team, mark it priority, copy the record into its detailed
placement and the basic fields (start gridno only if valid), verify the checksum, count the class. Then strategic
totals (`GetNumberOfEnemiesInSector`, stationary + mobile) above the restored counts are added with
`AddSoldierInitListEnemyDefenceSoldiers(extra)` — immediately, during the temp-file load, before our mercs are placed.
The restored nodes are later created by `PrepareEnemyForSectorBattle` through the same function (priority + detailed
first, §5.13). Because the file is only accepted when it matches the stationary counts, `extra` is exactly the mobile
groups' strength, and `PrepareEnemyForSectorBattle` then adds those groups' not-yet-in-battle soldiers again (its
in-battle counters were not raised by the load): mobile enemies that arrived after the player left appear twice
(inferred from the code paths; confirm with an oracle save, §12).

**Load civilians** (`:274-425`): no age limit; same node matching but skipping profiled detailed nodes; life below max
gains `minutes / 15` (4 per hour) up to max; afterwards every non-priority, unprofiled node of the **last record's team**
is deleted from the list (dead or departed civilians stay gone).

### 5.13 Enemies from strategic counts (tactical side)

`PrepareEnemyForSectorBattle()` (`Queen_Command.cc:308-527`):

```
gfPendingEnemies = false
z > 0: node = FindUnderGroundSector(world); no enemies → return
       inBattle += remaining; AddSoldierInitListEnemyDefenceSoldiers(node.admins, node.troops, node.elites)   // full counts
       return
if battleGroup is an enemy group: HandleArrivalOfReinforcements(it) and every other enemy group here with nothing in battle; return
NumEnemiesInSector(world) > 32 → pending = true
SF_USE_MAP_SETTINGS: counts = enemy placements by class; sector counts := them; inBattle := 0
else counts = sector counts − inBattle
if stationary total > 32: admins = min(a, 32); troops = min(t, 32 − admins); elites = min(e, 32 − admins + troops)   // precedence bug kept
sector inBattle += counts
slots = free enemy ids (should be all 32) − stationary total
for g in groups (list order) while slots: skip vehicles; g.sector == world (surface):
  enemy: admins, then troops, then elites not yet in battle, each cut to the remaining slots (cut → pending), added to inBattle and totals
  player not between sectors with members: RemoveGroupWaypoints(g)          // player route destroyed by a battle
nothing → return
AddSoldierInitListEnemyDefenceSoldiers(admins, troops, elites)
slots = 32 − stationary; for each enemy group here: assign its in-battle admins/troops/elites to group-less enemy soldiers
  of matching class in id order (s.ubGroupID = g.id) until its size or slots are used
```

`SortSoldierInitList()` (`Tactical/Soldier_Init_List.cc:250-409`): (1) from the tail backwards, nodes with a soldier
(other than the tail) move to the tail; (2) forward, nodes without soldier, non-priority, detailed, other than the head,
move to the head; (3) same for priority without detailed; (4) same for priority with detailed. Moving to the head while
scanning forward **reverses** each class: final order = [priority+detailed reversed] [priority-only reversed]
[detailed-only reversed] [basic, map order] [existing soldiers]. (The head node of a pass is never moved, which keeps
the reversal consistent.) ja2-node's `chooseEnemyPlacements` keeps map order (`deviations.md` "Sandbox population").

`AddSoldierInitListEnemyDefenceSoldiers(admins, troops, elites)` (`:616-1021`), draws from `Random`:

```
ResetMortarsOnTeamCount; profiledEnemyAdded = false; max = a + t + e; SortSoldierInitList()
count enemy nodes without soldier (stop at the first node with a soldier) per class × {PD, P, D, B}
pass PD: for class in ADMIN, ELITE, ARMY:
  for node from the head (FOR_EACH, which also does curr = curr->next in the body: every OTHER node is visited)
    stop when max, total[class] or slots[class] is 0, or the node is not PD
    if enemy, no soldier, this class: if slots ≤ total || Random(slots) < total: AddPlacementToWorld (fail → return); total−−; max−−
                                      slots−−
return if max == 0; mark = first non-PD node
pass P (from mark, while nodes are P), pass D (from the next mark, while D): same rule per class, consecutive nodes
return if max == 0
force priority: from the head while nodes are priority: enemy, no soldier → r = Random(max): < elites ELITE, < elites+troops ARMY,
  < +admins ADMIN (class overwritten, that total−−); AddPlacementToWorld (fail → return); max−−
pass B: from the last mark to the end, same per-class rule
leftover: free = enemy nodes without soldier; for every node: if free ≤ max || Random(free) < max:
  class by Random(max) as above; AddPlacementToWorld; max−−;   free−−    (stop when free or max is 0)
```

`AddPlacementToWorld(node)` (`:412-568`): a profiled detailed placement only if that profile is in this sector, not
recruited/escorted, alive and not using profile insertion; ice-cream truck rule; detailed → static detailed placement,
else `CreateDetailedPlacementGivenBasicPlacementInfo` (existing `createFromPlacement`); civilian quest overrides (Kingpin
C5 with `PreRandom(3)` orders and `uniform_int_distribution` grid offsets, the Queen's palace P3, liberated Tixa, freed
kids C13); elite enemies may become Mike or Iggy (`OkayToUpgradeEliteToSpecialProfiledEnemy`, M6); `TacticalCreateSoldier`;
`AddSoldierToSectorNoCalculateDirection` (keeps the placement facing). Others: `AddSoldierInitListTeamToWorld(team)` —
sort, caves tileset turns undetailed civilians into miners, then nodes in order until the first node with a soldier,
stopping at the first failure except for civilians (`:571-613`). Militia (`:1028-1260`, rules owned by `docs/18`):
enemy/militia placements are reused, orders STATIONARY, `Random(MAXATTITUDES)` attitude, detailed data deleted with
`RandomizeRelativeLevel` twice. Bloodcats (`:1495-1628`): placements recounted on first load when no spawn entry exists
(mismatch resets `bBloodCats` to −1); `bBloodCats` cats: priority bloodcat nodes first, then selection sampling.
`StripEnemyDetailedPlacementsIfSectorWasPlayerLiberated` (`:1786-1820`): on the surface, once `uiTimeLastPlayerLiberated
!= 0`, every enemy detailed placement becomes basic (priority off, random body, `RandomizeRelativeLevel` ×2): tanks and
special enemies never return. `EvaluateDeathEffectsToSoldierInitList` (`:1460-1468`): a killed non-militia soldier's
detailed placement is deleted.

### 5.14 Time passing while away

| What | Rule | Milestone |
|---|---|---|
| Corpses | `AddRottingCorpse` (not loading): older than 1 day (1440 min) and a fresh merc type (`≤ FMERC_FALLF`) → `ROTTING_STAGE2`; older than 3 days → not added (`Tactical/Rotting_Corpses.cc:51-52, 446-459`); town, indoors, ≥ 30 min → not added (§5.11) | M4 (removes the "Corpses" deviation's strategic part) |
| Preserved enemies | discarded after 300 min or on a stationary count change (§5.12) | M4 |
| Civilians | +1 life per 15 min (§5.12) | M4 |
| Items | stolen when the enemy takes a visited sector (`RemoveRandomItemsInSector`, chance `min(5·enemies, 90)`, visible and reachable items, `Strategic/Strategic_Town_Loyalty.cc:616-`); town theft | `docs/18` |
| Bloodcats | lair/arena +1 per 18 hours away (§4.2) | M4 |
| Smoke, lights | saved records keep aging on world time | M4 (`docs/12`) |
| NPCs | profile sectors move by daily events, schedules post on load | M6 |
| Doors | `ExamineDoorsOnEnteringSector` would close open doors after ≥ 30 min away, but it compares with a timestamp set moments earlier and never fires (§10) | — |
| Enemy movement | groups between sectors keep their arrival times; `ResetMovementForEnemyGroupsInLocation` on a retreat | M4 |

---

## 6. Sector ownership and map state

### 6.1 Control

`SetThisSectorAsPlayerControlled(s, contested)` (`Strategic/Player_Command.cc:57-218`): meanwhile → false; surface:
`NumHostilesInSector > 0` → false (too early); Bobby Ray's delivery sector enables the site; remember
`wasEnemy`; `fEnemyControlled = false`; town → start its loyalty; if `wasEnemy && contested`: town (not Omerta on day 1,
not J9/K4) → morale and loyalty events and `CheckIfEntireTownHasBeenLiberated`; worthwhile mine → events; SAM site →
meanwhile, events, Skyrider quote, first-time grace days; refuel site update; Meduna outskirts meanwhile. `contested` →
`StrategicHandleQueenLosingControlOfSector` (`docs/17`). Underground: P3 b1 sets the alternate Queen position. Surface:
`fSurfaceWasEverPlayerControlled = true`. Always `UpdateAirspaceControl`. Returns `wasEnemy`.

`SetThisSectorAsEnemyControlled(s)` (`:222-324`): autoresolve about to start → false; surface: `wasPlayer`;
**`fEnemyControlled = true` before** the "player mercs still there" early return; if `wasPlayer` and no mercs: town,
mine, SAM events, refuel update, notification; visited sector → theft (`min(5·NumEnemiesInAnySector, 90)`). Always
`UpdateAirspaceControl`.

| Caller | Call |
|---|---|
| Player group arrives without battle (§3.10) | player, uncontested |
| Tactical battle won (`Tactical/Overhead.cc:4681`) / lost (`:4492`) | player contested / enemy |
| Autoresolve (`Strategic/Auto_Resolve.cc:343,1296`) | player contested (`docs/19`) |
| Strategic AI takes a sector (`Strategic_AI.cc:1045`), map screen notice (`MapScreen.cc:7618`) | enemy (`docs/17`) |
| End game (`Tactical/End_Game.cc:274`) | player contested |

### 6.2 Airspace

`UpdateAirspaceControl` (`SAM_Sites.cc:69-96`): for every surface sector, enemy air control iff the controlling SAM
(air-control table − 1, ≥ 0) is in an enemy-controlled sector with condition ≥ 80; then the
`OnAirspaceControlUpdated` listeners: the merc landing zone moves back to the start sector if its airspace turned hostile
(M5), refuel sites update.

### 6.3 What the player knows about enemies (fog for D16)

`WhatPlayerKnowsAboutEnemiesInSector(s)` (`Map_Screen_Interface_Map.cc:3511-3562`): a scouting merc in `s` (not vehicle,
in transit, POW, dead, asleep, < OKLIFE, in the heli, moving), militia within one sector (3×3, `Strategic/Town_Militia.cc:623-640`)
or `SF_PLAYER_KNOWS_ENEMIES_ARE_HERE` → `KNOWS_HOW_MANY`, except stationary enemies there → `KNOWS_THEYRE_THERE`;
visited → `KNOWS_THEYRE_THERE`; Skyrider noticed and still flying there → `KNOWS_THEYRE_THERE` (else the flag is cleared,
a read with a side effect); otherwise `KNOWS_NOTHING`. The map shows nothing on day one and nothing underground
(`HandleShowingOfEnemyForcesInSector`, `:3606-3632`). Shading: unvisited sectors dark; the airspace view shows
`fEnemyAirControlled` for every sector (`DrawMap`, `:487-541`).

---

## 7. Agent API (D15, D16)

### 7.1 Commands

| Command | Original | Checks and result |
|---|---|---|
| `route {soldier, to, via?: Sector[], shortest?: bool}` | `PlotPathForCharacter` legs (start = last path sector), copy to squad/vehicle, `RebuildWayPointsForGroupPath` | `CanEntireMovementGroupMercIsInMove` (§3.3 codes as `reason`), cursor rule, passable "through", `shortest` = the SHIFT mode; returns path, waypoints, ETA. Replaces an existing path: clear to the current sector first (UI: cancel then plot) |
| `cancelRoute {soldier}` | `CancelPathForCharacter` | reverses a moving group (§3.4) |
| `shortenRoute {soldier, at}` | `ClearPathAfterThisSectorForCharacter` + rebuild | |
| `assignSquad {soldier, squad: 0..19 \| 'new' \| 'any'}` | `AddCharacterToSquad` / `…UniqueSquad` / `…AnySquad` | reasons: `full`, `onTheMove`, `otherSector`, `vehicleSquad`; leaving assignments is `docs/18` |
| `enterSector {sector}` | `AllowedToExitFromMapscreenTo(TACTICAL)` + `SetCurrentWorldSector` | §5.1 gates; refuses during prompts |
| `exitSector {soldier, direction?: 'north'\|'east'\|'south'\|'west', exitGrid?: gridNo, who: 'squad'\|'merc', load?: bool}` | `OKForSectorExit` + exit menu table + `JumpIntoAdjacentSector` | `soldier` plays the selected merc; refusals `tooFar`, `invalidTraversal`, `loneEPC`, `abandonEPC`, `squadNotAllowed`, `mercNotAllowed`, `loadDisabled`; `load` defaults to the menu default |
| `placeMercs {auto: true} \| {positions: {soldier: gridNo}}` | placement GUI | answers the placement prompt (§7.2) |
| later: `boardVehicle`, `leaveVehicle`, `heliRoute`, `refuel` | `PutSoldierInVehicle`, `TakeSoldierOutOfVehicle`, heli plotting | M5/M6 |

No "exit tactical" command: the strategic view is always observable; leaving a sector is `exitSector` or moving
everyone away by `route` (which unloads the world when nobody remains, §5.10).

### 7.2 Decision prompts

| Prompt | Original | Answers |
|---|---|---|
| `simultaneousArrival {sector, groups, enemyType}` | `PossibleToCoordinateSimultaneousGroupArrivals` | `yes` / `no` |
| `npcOfNote {group, sector, final}` | §3.10 | `continue` / `stop` (`ok` at the final destination) |
| `warpToSurface` | lair exit | `yes` / `no` (no → exit menu as a normal `exitSector`) |
| `placement {sector, mercs, sides}` | §5.8 | `placeMercs` |
| `bloodcatBattle`, `invasion`, `unconsciousMercsAttacked` | message boxes before the PBI | informational: auto-closed by policy, then `docs/19`'s PBI prompt |

### 7.3 Events

`groupDeparted {group, from, to, arrivalMinute}`, `groupArrived {group, sector, final}`, `groupReversed`, `groupStopped
{group, reason: 'tired' | 'npcOfNote' | 'outOfFuel' | 'battle'}`, `encounter {sector, code}` (only what the player is
told), `reinforcementsArrived {team: 'ours' | 'enemy', side}` (enemies only once visible), `sectorLoaded {sector}`,
`sectorUnloaded {sector}`, `mercsLeftSector {sector, to}`, `sectorControlChanged {sector, by}` (only for sectors the
player can see change, §6.3), `secretFound {sector}`, `squadChanged {soldier, squad}`.

### 7.4 Observation (`PlayerView.strategic`)

- `time` (`docs/15`), `worldSector`, `selectedSquad`.
- `sectors[256]` (only what the player sees): `id`, `visited`, `townId`, `land` (land-type text key incl. found secrets
  and facilities), `airspace` (`fEnemyAirControlled`), `controlled` for visited sectors and found town/SAM sectors
  (inferred to match what the map UI reveals; revisit with the M7 UI audit), `enemies: number | '?' | null` by §6.3,
  `militia` counts (own), `visibleItems` (map-inventory count).
- `edges`: traversability per border (public data; lets the agent reason about routes without `query`).
- `groups` (ours only): id, members, squad, `sector`, `betweenSectors`, `next`, `prev`, `arrivalMinute`, `etaMinutes`
  (`CalculateTravelTimeOfGroup`), `path`, `waypoints`, transport, vehicle; enemy groups appear only through `enemies`.
- `squads[20]`, `vehicles` (position, fuel, passengers), `heli` (later).
- `prompts`.

### 7.5 Queries and `advance`

Queries: `routePreview {soldier, to, via?, shortest?}` (`PlotATemporaryPathForCharacter`: path + per-edge minutes + ETA,
no state change), `exitCheck {soldier, direction | exitGrid}` (`OKForSectorExit` result and menu options),
`travelTime {from, direction, transport}`. `advance` on the strategic map stops on `groupArrived` with `final`, any
prompt, `encounter`, and every `StopTimeCompression` call of the original (`docs/15` maps them to stop events).

---

## 8. Data tables and stubs

### 8.1 Loading externalized JSON

`data/externalized` files are JSONC (`//` and `/* */`, verified: all 16 `strategic-*.json`, `vehicles.json` and
`game.json` parse after stripping comments outside strings, no trailing commas). Add a comment stripper in `content`
(DOM- and Node-free) and loaders `content/strategic/*.ts` producing a frozen `StrategicContent`: traversability grid,
towns, underground templates, SAM sites and air control, secrets, bloodcat placements/spawns, NPC placements, cache
sectors, vehicles, policies. No transcription needed for these.

### 8.2 `data/tables` to generate with `tools/transcribe`

| Table | Generator | Source |
|---|---|---|
| `strategic-travel.json`: base minutes (`FOOT_TRAVEL_TIME` 89, CAR 30, TRUCK 32, TRACKED 46, AIR 10), terrain modifiers per transport, TOWN = 5, `FLAT_STRATEGIC_TRAVEL_TIME` 60, heli costs 100/1000 | `tools/transcribe/strategic-travel.ts` (parse the `#define`s and the five `switch` blocks of `GetSectorMvtTimeForGroup`) | `Strategic/Strategic_Movement.cc:2065-2190`, `Strategic/Strategic_Pathing.cc:151`, `Strategic/Map_Screen_Helicopter.h:12-13` |
| `sector-facilities.json` | `tools/transcribe/sector-facilities.ts` | `Strategic/Campaign_Init.cc:30-66` |
| enum tables (traversability names, insertion codes, `SF_*`, encounter codes, `MODIFY_MAP` types) | code constants with the SFI header (small, stable) | headers above |
| later: RPC sector descriptions, refuel sites | `tools/transcribe/…` | `StrategicMap.cc:355-393`, `Map_Screen_Helicopter.cc:80-84` |

Nothing derived from original data files; `SectorDiff`s produced at runtime from the user's maps are game state, not
repository content.

### 8.3 Stubs

- **Country map**: none to author. The externalized tables (from Stracciatella's source, SFI-SCLA) ship in `data/` and
  work in CI; unit tests that need a tiny world build a synthetic `StrategicContent` (e.g. 4×4 with a town, a river and
  a barrier).
- **Sector maps**: CI has only `stubs/maps/village.map.txt`. Proposed minimal set: `a9` (the village, start sector; its
  garrison moves to a strategic-count test), `a10` (a town sector with an exit grid down), `a10_b1` (basement,
  restricted scroll 1, exit grid up), `b9` (wilderness with a road, enemy placements of several classes and priorities,
  bloodcat placements), plus one generic `wilderness` stub that the stub data stack serves for any other sector
  (stub-pack rule in `node`/`server`, not a simulation deviation).
- **Stub map format** additions (`src/content/formats/stub-map.ts` currently writes no entry points, exit grids or
  edgepoints): `entry: north|east|south|west|center x y`, `isolated: x y`, `exit: x y -> A10 z=1 at x y`,
  `scroll: basement`, placement flags `priority`, `detailed`, classes `ADMIN ELITE ARMY`, `body: BLOODCAT`. Edgepoints
  come from `GenerateMapEdgepoints` at load (stubs omit `MAP_EDGEPOINTS_SAVED`).

---

## 9. Minimal M4 implementation (map and movement)

Goal: on the original data and the stubs, squads walk across the country map on plotted routes with exact travel times,
meet enemies (hand-off to `docs/19`), enter and leave sectors tactically, and find every visited sector as they left it.

### 9.1 Modules

| Module | Contents |
|---|---|
| `content/strategic/` | JSONC loader, `StrategicContent`, traversability parse (§1.6), transcribed travel table |
| `sim/strategic/map/sectors.ts` | ids and conversions, `SectorInfo`/map elements/underground state, flags with `SetSectorFlag` side effects, control (§6.1), airspace (§6.2), knowledge (§6.3) |
| `sim/strategic/map/travel.ts` | `GetSectorMvtTimeForGroup`, `FindTravelTimeBetweenWaypoints`, `CalculateTravelTimeOfGroup` |
| `sim/strategic/map/pathing.ts` | `FindStratPath` with the exact queue, `BuildAStrategicPath`, path list helpers |
| `sim/strategic/forces/groups.ts` | group list and ids, creation/removal, membership, waypoints, departure, arrival, reversal, retreat, simultaneous arrivals, counting helpers |
| `sim/strategic/forces/squads.ts` | squads, dead lists, movement-group bookkeeping |
| `sim/strategic/forces/encounters.ts` | `CheckConditionsForBattle`, bloodcat test, `PrepareForPreBattleInterface` hand-off, reinforcements |
| `sim/flow/sector-load.ts` | `SetCurrentWorldSector`, `EnterSector`, `PrepareLoadedSector`, `UpdateMercsInSector`, unloading, placement prompt |
| `sim/flow/sector-exit.ts` | exit checks and menu table, `JumpIntoAdjacentSector`, walk-off/walk-in, traversal setup |
| `sim/flow/sector-diff.ts` | `SectorDiff` save/restore (§5.11), unloaded-sector writers, preserved soldiers (§5.12) |
| `sim/tactical/edgepoints.ts` | edgepoint lists, generator, choose/search/classify |
| `sim/tactical/init-list.ts` | soldier init list with node ids and links, sort, enemy/militia/bloodcat/team placement, strip/death rules |

**Roster.** Player soldiers (ids 0..19) move out of `TacticalState` into a campaign roster that persists across loads;
the tactical state references them while `inSector`. Non-player soldiers are created on load and dropped on unload, as
in `TrashWorld`. The `TacticalSim` becomes a child of a `CampaignSim` that owns `GameState.strategic`, the event queue
(`docs/15`) and the loaded sector.

**`SectorDiff`** keyed by `x,y,z`: `items: WorldItem[]` (exact `WORLDITEM` fields incl. non-existing slots and flags),
`corpses: CorpseDef[]`, `mapChanges: ModifyMap[]` (in order), `doorTable`, `doorStatus`, `revealed: Uint8Array(3200)`,
`enemies` / `civilians: {links: [node, soldier][], savedMinute, records: SoldierCreate[]}`, `smoke`, `lights`. The
`SF_*_TEMP_FILE_EXISTS` flags mirror which members exist. Save import (`docs/14`) converts every native temp file into
diffs; the reader already keeps them as raw bytes.

### 9.2 Order of work

1. Content: JSONC stripper, loaders, `strategic-travel.json` transcription, `game.json` policies.
2. Sector state and conversions; new-campaign init of the map part (§1.3, §1.4; the rest is `docs/15`/`17`).
3. Travel time and `FindStratPath`; paths; waypoints; `AddWaypointToPGroup`; reversal.
4. Groups and squads (ids, list order, membership, persistence), roster split, `AssignMercToAMovementGroup`.
5. Departure and arrival with the event queue of `docs/15` (stub `StrategicAILookForAdjacentGroups` → false,
   `CalculateNextMoveIntention` real); experience on arrival; fatigue stop hook (`docs/18`).
6. Encounters: battle check, simultaneous arrivals, bloodcat test, prompts; hand-off stub until `docs/19` lands
   (open the PBI prompt with the group and code).
7. Edgepoints (load + generator), `UpdateMercInSector` insertion table, `AddSoldierToSector` facing rules.
8. Soldier init list with node ids, `SortSoldierInitList`, `AddSoldierInitListEnemyDefenceSoldiers`,
   `PrepareEnemyForSectorBattle` (replaces `SANDBOX_POPULATION`), team/militia/bloodcat placement, strip/death rules.
9. Sector load/unload flow, `SectorDiff` save/restore, preserved enemies/civilians, corpse aging, revealed bits.
10. Tactical exits: exit checks, menu table, walk-off with `DISALLOW_SIGHT` and the 2500 ms timer, traversal setup,
    walk-in, exit grids, no-load departures.
11. API: commands, prompts, events, `PlayerView.strategic`, queries; MCP tools gain `route`, `assignSquad`,
    `enterSector`, `exitSector`.
12. Save import of the strategic sections (11–14 and all temp files) so native campaigns continue (`docs/14` §9).

Can wait (hooks with defaults): helicopter (no heli group), vehicles beyond data structures, NPC-of-note prompt (no
profiles placed until M6 → never fires), quest code on entry/exit, RPC descriptions, meanwhile, POW handling, creature
lairs and warps, militia placement details (`docs/18`), theft (`docs/18`), smoke/light effect diffs (save as records,
spread later).

### 9.3 Tests (Vitest, CI on stubs and data/)

- Ids: byte/strategic/short-string round trips; P16 sentinel; map file names incl. `_a`, `_b<z>`.
- Traversability: per-sector N/E/S/W/through from the JSON grid shapes (16×17, 17×16); `GetTraversability`.
- Travel: the table of §3.5 for every transport; encumbrance (max over walkers, floor 100, integer); TOWN 5 vs AIR 10;
  impossible edges.
- `FindStratPath`: synthetic grids for Dijkstra order, heuristic/FARTHER/LIFO tie-breaks, the tactical-traversal zero
  cost, the SHIFT mode overriding heli costs, the 512/4096 limits; A9→P3 on the real table against the oracle.
- Waypoints: pivots only; reversal arrival `traverse − arrival + 2·now`; 90° replan counts as reversal; never-left
  arrival (`neverLeft` skips experience and fuel).
- Groups: lowest free id, append order, reuse after removal, persistent park; squad add/remove rules and compaction.
- Departure/arrival: enemy sleep draws only between 21:00 and 04:59; queue-battle delay `3 + Random(3)`; insertion codes
  by direction; edge-index codes preserved; `ABOUT_TO_ARRIVE` only if strictly ahead.
- Encounters: the battle-check matrix (player/enemy group × mercs alive/combat-able × militia × bloodcats), simultaneous
  arrival prompt and its yes/no outcomes, `HandleOtherGroupsArrivingSimultaneously` restart scan.
- Init list: sort reversal per class; enemy defence placement with an injected roll source, including the Strac
  every-other-node PD pass and the leftover class reassignment.
- Persistence: leave and re-enter a stub sector: items (incl. moved and dropped), corpses (aged 1 day → stage 2, 3 days →
  gone), open doors, revealed tiles, preserved enemies (≤ 300 min and count match restore; mismatch or > 300 min
  re-place), civilians healed by `minutes / 15`.
- Exits: screen thresholds at the four edges on a default and a basement map; the exit-menu decision table; walk-off
  completes or times out at 2500 ms; LOAD within 5 min loads the next stub sector with walk-in; NO_LOAD departs.
- Scenario (headless, seeded): an agent routes a squad A9 → B9 on stubs, meets placed enemies (PBI prompt), enters,
  wins (`docs/10`), leaves east, and the sector diff survives a reload; identical under the instant and manual drivers.

### 9.4 Oracle probes (`tools/oracle`, extend `src/Oracle.cc` and the hooks patch)

The oracle already initialises the strategic engine (`InitializeJA2` → `InitStrategicMovementCosts`), so movement data is
available without a save.

| Probe | Does | Compare |
|---|---|---|
| `stratcosts [mask=FOOT\|CAR\|TRUCK\|TRACKED\|AIR]` | dumps `ubTraversability[5]` of all 256 sectors and `GetSectorMvtTimeForGroup` per direction with a fake enemy group (no encumbrance) | JSON parse and travel rules |
| `stratpath from=A9 to=P3 [mask=…] [who=<soldier>] [tactical=1]` | `BuildAStrategicPath`, per-edge minutes, `CalculateTravelTimeOfGroup` after `RebuildWayPointsForGroupPath` on a scratch group | path, waypoints, ETA (with `who` after `save`: real encumbrance) |
| `groups` (after `save`) | group list in order (all fields, waypoints, members), squads, `SquadMovementGroups`, sector flags and counts, underground list, pending `GROUP_ARRIVAL` events, merc paths | save import of sections 3, 11–14 |
| `edgepoints [generate=1]` (after `sector`) | the eight lists and middle indices, optionally regenerated with `GenerateMapEdgepoints` | loader and generator on real maps |
| `exitcheck dir=E\|W\|N\|S\|grid=<g>` (after `save`) | `OKForSectorExit`, minutes, per-soldier `SoldierOKForSectorExit`, the `gf*` flags | exit checks and screen thresholds |
| `walkoff who=<id> dir=E`, `walkin who=<id> code=WEST`, `mirror who=<id> dir=E` | wrappers for the static `PickGridNoNearestEdge`, `PickGridNoToWalkIn`, the mirror gridno and `CalcMapEdgepointClassInsertionCode` | walk-off/walk-in targets |
| `initlist` (after `sector`) | `SortSoldierInitList` order (node id, team, class, priority, detailed, soldier) via a wrapper | sort reversal |
| `defence admins= troops= elites=` (after `sector`) | `AddSoldierInitListEnemyDefenceSoldiers` with a **Random tap** (patch `Random` to log `(range, result)`) | ja2-node replays the same rolls through an injected roll source; chosen nodes and classes must match |
| `advance minutes=N` (after `save`, with the tap) | `WarpGameTime` processing events; dump `groups` afterwards | arrivals, reversals, battle checks with replayed rolls (needs `docs/15`/`17`) |

The Random tap is the general answer to D6 (different generators): native rolls become inputs, as in `01` §3.6
("rules take rolls as parameters").

---

## 10. Quirks to keep, deviations to log

**Quirks to keep** (all read in Strac; vanilla-identical unless noted):

1. Enemy groups that departed a sector still count as being in it (`ubSector` is the departed sector) for
   `NumEnemiesInSector`, `PrepareEnemyForSectorBattle` and reinforcements.
2. `NumEnemiesInSector` ignores z: an underground tactical traversal checks the **surface** counts of the same x,y in
   `CheckConditionsForBattle`.
3. Reversal arrival `traverse − arrival + 2·now`; a 90° replan while moving is a reversal.
4. Only pivots become waypoints; any added waypoint resets every member's insertion code to 0 (NORTH).
5. Group flags (incl. simultaneous-arrival approvals and the ambush potential) clear on every arrival; the battle branch
   also decrements `gubNumAwareBattles` when no battle starts because a prompt opened or `checkForBattle` was false.
6. `GROUPFLAG_HIGH_POTENTIAL_FOR_AMBUSH` is set only when leaving a hostile sector through an **exit grid**
   (`HandlePotentialMoraleHitForSkimmingSectors`), not by edge exits.
7. `gfUndergroundTacticalTraversal` is set (twice) and never cleared: after the first underground edge traversal every
   later tactical traversal group arrives after 1 minute instead of 5, while the clock still warps 5 minutes
   (`StrategicMap.cc:1772-1782`; `V: Strategic/StrategicMap.c:2675-2687` has the same second assignment, while an older
   code path there resets it to FALSE at `:2516`). It is not saved; a fresh process starts FALSE.
8. `OKForSectorExit` uses `gWorldSector.z > 1` in the per-soldier branch: at z == 1 a squad member away from the edge
   makes the edge "invalid" (`:2119`).
9. Facing on entry is toward the map centre; the strategic insertion direction (< 100) is ignored for people.
10. `DISALLOW_SIGHT` during walk-off and walk-in: nobody sees anybody until all mercs arrived or 2.5 s passed.
11. Enemy defence placement in Strac visits **every other node** in the priority+detailed pass (`FOR_EACH` plus
    `curr = curr->next`, `Soldier_Init_List.cc:712-743`); vanilla visits every node (`V: Tactical/SoldierInitList.c:788-807`).
    D1 says Strac: keep, list as a Strac-introduced difference, and guard against the end of the list (Strac would
    dereference null if every node were priority+detailed).
12. `SortSoldierInitList` reverses each class.
13. `32 − admins + troops` cap for elites in `PrepareEnemyForSectorBattle`; underground battles add the full node counts.
14. Preserved enemy files are compared with stationary counts only (any mobile enemy present at save → discarded) and
    never restore underground; 300-minute limit; `PreRandom(2)` current-or-original position per soldier.
15. Civilian file pruning uses the team of the last record read.
16. `SetThisSectorAsEnemyControlled` sets the flag before its "mercs still there" early return.
17. `ExamineDoorsOnEnteringSector` never fires (the 30-minute test uses a timestamp set just before; same in vanilla
    `V: Strategic/StrategicMap.c:877,904`).
18. `NotifyPlayerOfInvasionByEnemyForces` calls back only for town/SAM sectors (§4.1).
19. Heli route cost depends on the airspace of the sector being left; SHIFT overrides heli costs.
20. `AllMercsWalkedToExitGrid` passes the target sector to the retreat loyalty check.
21. Bloodcat first-visit roll repeats until it succeeds; `bBloodCats == 0` still rolls `PreChance(95)`.
22. `CreateNewEnemyGroupDepartingFromSector` sizes groups as troops + elites.
23. (inferred) Restoring a preserved enemy file while mobile groups have arrived since places those groups twice (§5.12).

**Deviations to add to `docs/deviations.md`:**

| Area | Original | ja2-node | Why |
|---|---|---|---|
| Strategic map UI flow | Click-to-plot with temporary paths, confirm by clicking the last sector, SHIFT for the shortest route, cursor and dialogue-queue gates | `route` builds and confirms in one command; `shortest` flag; UI-only gates (dialogue queue, held item, boxes) dropped | API has no cursor (D15) |
| Exit menu | Modal box with radio buttons and a load checkbox; selected merc is a UI choice | `exitSector` with `who`/`load` validated by the same table; `soldier` plays the selected merc | API (D15) |
| Prompts | Message boxes (simultaneous arrival, NPC of note, warp, placement GUI) | Decision prompts with the same outcomes; informational boxes auto-closed | D15 |
| Exit wait timer | 2500 ms of `GetJA2Clock` (wall clock) | 2500 game ms on ticks | All timers on game time |
| Cosmetic draws | `Random(n)` speaker choices (`PrepareForPreBattleInterface`, `RandomMercInGroupSaysQuote`), heli quote `Random(2)`, lair corpse facing `Random(8)`, dead-soldier corpse animation `Random(4)` | `fx` stream | They only pick quotes and graphics |
| Temp files | Binary files in a temp directory, checksummed placement records and a "file hack" exit on any mismatch | `SectorDiff` objects in `GameState`; no checksums | Plain state (D7) |
| Underground traversal flag | Process-global, not saved | Session state, reset on load | Matches a fresh native process after loading |
| Stub sectors | Every sector has a map | The stub pack serves a generic wilderness map for sectors without a stub map | CI without original data |
| Sandbox population | (existing row) | Replaced by `PrepareEnemyForSectorBattle` in M4 | |

---

## 11. Verified vs inferred

**Verified** by reading Strac (vanilla cross-checks where marked): sector ids and conversions; `SECTORINFO`,
underground, map element and group save layouts; traversability loading; `GetSectorMvtTimeForGroup` and the travel
table; `FindStratPath` incl. queue and tie-breaks; path helpers; `RebuildWayPointsForGroupPath`, `AddWaypointToPGroup`,
reversal; `InitiateGroupMovementToNextSector`, `GroupArrivedAtSector`, `HandleNonCombatGroupArrival`,
`CheckConditionsForBattle`, `TestForBloodcatAmbush`, simultaneous arrivals, `DelayEnemyGroupsIfPathsCross`, retreat;
squads; `CanCharacterMoveInStrategic`; `SetCurrentWorldSector`, `EnterSector`, `PrepareLoadedSector`,
`UpdateMercsInSector`/`UpdateMercInSector`, `AddSoldierToSector` facing; edgepoint load/choose/search/classify; exit
checks, exit menu, `JumpIntoAdjacentSector`, walk-off, `AllMercsHaveWalkedOffSector`, `AllMercsWalkedToExitGrid`,
`DoneFadeOut*`; unloading and `TrashWorld`; temp-file save/load order and item/corpse rules; preserved enemies and
civilians; `PrepareEnemyForSectorBattle`, `SortSoldierInitList`, `AddSoldierInitListEnemyDefenceSoldiers` (vanilla
compared for the PD pass), militia/bloodcat placement, strip and death rules; sector control functions; airspace;
enemy knowledge; heli arrival rules; the quirks of §10 (items 7 and 17 checked in vanilla too; item 11 differs there).

**Inferred** (not traced end to end): the screen-space thresholds for the basement restriction (computed from
`InitRenderParams`); `GenerateMapEdgepoints`' validation/classification internals (only the first rows were read);
`CalculateTravelTimeOfGroup` ignoring `ubNextWaypointID` being harmless; `SF_USE_MAP_SETTINGS` unused in vanilla data;
the militia-only case of `NotifyPlayerOfInvasionByEnemyForces` being unreachable; which sectors the map UI reveals as
controlled (§7.4); the effect of quirk 7 on event order (depends on what else is queued in those 4 minutes); the double
placement of quirk 23.

---

## 12. Open questions

1. Quirk 11 (Strac's every-other-node pass) and quirk 7 (stuck underground flag) are Strac/vanilla bugs with visible
   effects; D1 says keep — confirm with the maintainer before shipping, and record the choice in `deviations.md`.
2. Do any of the 261 vanilla maps lack saved edgepoints (version < 22 or no flag), i.e. does the generator ever run on
   original data? `pnpm cli inspect` over the maps answers it; the generator is needed for stubs anyway.
3. Same-timestamp event order (two groups arriving in the same minute, `ABOUT_TO_ARRIVE` vs arrivals) is `docs/15`'s;
   `HandleOtherGroupsArrivingSimultaneously` depends on it.
4. Group ids at a new game depend on `InitStrategicAI`'s group creation (`docs/17`); tests should address squads by
   index, not by group id.
5. `PlayerView.strategic.controlled`: exactly which control information the original map shows (town info boxes, militia
   panel) needs a UI pass; until then expose control only for visited sectors and found town/SAM sectors.
6. The roster split (player soldiers outside `TacticalState`) touches save import and the sandbox; agree on it before
   step 4 of §9.2.
7. Quirk 23 (mobile enemies placed twice after restoring a preserved enemy file) needs an oracle check: save beside an
   enemy sector, let a patrol enter it, re-enter, and count the enemy team.

---

## 13. Implemented (2026-10-16): §9.2 steps 1–6 and the strategic part of step 12

**Content** (`src/content/strategic/`): `sector-ids.ts` (byte id, strategic index, short/long strings, map file names),
`map-tables.ts` (traversability letters, the movement-cost grids turned into the five per-sector values of
`InitStrategicMovementCosts`, towns, sector descriptions, underground templates, SAM sites and air control, secrets,
cache sectors, bloodcat placements and spawns), `policy.ts` (`squad_size`, start sector, reveal flag, vehicle movement
types), `travel-table.ts` (`data/tables/strategic-travel.json` from `tools/transcribe/strategic-travel.ts` and
`data/tables/sector-facilities.json` from `tools/transcribe/sector-facilities.ts`), `strategic-content.ts`
(`StrategicContent`, `loadStrategicContent(read)`; everything is in `data/`, so the strategic layer runs on stubs).

**State** (`StrategicState`, plain data): `map` (`sectors[256]`, `elements[324]`, `underground[]` in file order,
`secretsFound[]` parallel to the secrets table, `selectedSector`, `activity` = the player-activity counters of
`SetSectorFlag`), `forces` (`groups[]` in list order, `squads[20]` as compact soldier-id lists, `squadGroupIds`,
`deadSquadMembers`, `vehicleGroupIds`, `vehicles`, helicopter id and airborne flag), `movement` (the transient flow flags
of §0), `encounter` (encounter globals, `preBattle` hand-off, `simultaneousArrival` prompt) and `options` (difficulty,
sci-fi, gun nut). Group ids are the lowest id not used by a listed group, which is what `uniqueIDMask` always holds.

**Simulation** (`src/sim/strategic/`):

| Module | Public API |
|---|---|
| `map/sectors.ts` | `SectorInfo`, `MapElement`, `UndergroundSector`, `sectorInfo`, `findUndergroundSector`, `getSectorFlags`/`getSectorFlagStatus`/`setSectorFlag`/`resetSectorFlag` (Tixa prison, gun range, activity day), `mapFileNameForSector`, `traversabilityBetween` (`GetTraversability`), `sectorIsPassable`, `isSectorDesert`, `totalMilitia` |
| `map/init.ts` | `initializeMapStructure`, `setupNewStrategicMap`, `initNewCampaignMap` (zero, movement costs, remove groups, facilities, underground draws, start sector), `initBloodCatSectors`, `initTixaBasementWithoutSciFi`, `initStrategicLayerMap(ctx, {initStrategicAI, initNpcs})` (the `InitStrategicLayer` order for the map and forces) |
| `map/control.ts` | `setThisSectorAsPlayerControlled`, `setThisSectorAsEnemyControlled`, `updateAirspaceControl`, `initializeSamSites`, `samIdOfSector`, `isThisSectorASamSector`, `townIdOfSector`, secrets |
| `map/knowledge.ts` | `whatPlayerKnowsAboutEnemiesInSector` (§6.3) |
| `map/travel.ts` | `getSectorMvtTimeForGroup`, `sectorMovementTime` (pure), `findTravelTimeBetweenWaypoints`, `calculateTravelTimeOfGroup`, `TRAVERSE_TIME_IMPOSSIBLE` |
| `map/pathing.ts` | `findStratPath` (the literal queue, trail tree, 512/4096 limits, 30-direction cap), `buildStrategicPath`, path helpers |
| `map/save-import.ts` | `importStrategicMap(ctx, save)` |
| `forces/groups.ts` | `Group`, `getGroup`, `create{Player,Vehicle,Enemy}Group…`, `removeGroup`, `removeAllGroups`, `addPlayerToGroup`, `removePlayerFromPGroup`/`removePlayerFromGroup`, `setGroupSectorValue`, `setEnemyGroupSector`, `findPlayer/EnemyMovementGroupInSector`, `playerMercsInSector`, `numEnemiesInSector`, `numHostilesInSector`, `numEnemiesInAnySector`, `countAllMilitiaInSector`, `groupAtFinalDestination` |
| `forces/movement.ts` | `addWaypointToPGroup` (+ id variants), `initiateGroupMovementToNextSector`, `rebuildWayPointsForGroupPath`, `groupArrivedAtSector`, `calculateNextMoveIntention`, `groupReversingDirectionsBetweenSectors`, `retreatGroupToPreviousSector`, `resetMovementForEnemyGroup(sInLocation)`, `randomizePatrolGroupLocation`, `placeGroupInSector`, `moveGroupFromSectorToSector` (+ avoid-player variants), `buildAStrategicPath`, `clearMercPathsAndWaypointsForAllInGroup`, `answerNpcOfNotePrompt` |
| `forces/squads.ts` | `initSquads`, `initVehicles`, `addCharacterToSquad`/`…AnySquad`/`…UniqueSquad`, `removeCharacterFromSquads`, `assignMercToAMovementGroup`, `handleSoldierLeavingSectorByThemSelf`, `checkSquadMovementGroups`, dead lists |
| `forces/routes.ts` | `plotPathForCharacter`, `confirmPathForCharacter`, `cancelPathForCharacter`, `clearPathAfterThisSectorForCharacter` (people; vehicles later) |
| `forces/encounters.ts` | `checkConditionsForBattle`, `handleOtherGroupsArrivingSimultaneously`, `answerSimultaneousArrival`, `prepareForPreBattleInterface`, `testForBloodcatAmbush`, `handleArrivalOfReinforcements` |
| `forces/ports.ts`, `forces/context.ts` | `StrategicContext` = state + content + `MercPort` + `StrategicAiPort` + `TacticalWorldPort` + clock + `random`/`preRandom` roll sources; `createStrategicContext`, default ports (AI hooks return `false`/no-op, as §9.2 asks) |

`CampaignSim` takes `hooks.strategic = {content, mercs?, ai?, world?}`, exposes `campaign.strategic` and registers
`GROUP_ARRIVAL` (`GroupArrivedAtSector(group, TRUE, FALSE)`) and `GROUP_ABOUT_TO_ARRIVE` (no effect). Player soldiers are
soldier ids 0..19 resolved through `MercPort` (`StrategicMerc` holds the strategic soldier fields: sector, between
sectors, group, previous sector, insertion code and direction, path, assignment, vehicle; `changeAssignment` is
expected to do `SetMercAwake`/`SetTimeOfAssignmentChangeForMerc` when the assignment changes). The PBI consumer
(`docs/19`) reads `encounter.preBattle` and must clear it and `movement.disableMapInterfaceDueToBattle`, as closing the
PBI does in the original.

**Verified against the oracle** (`tools/oracle/probes/strategic.txt`, `README.md` "Strategic movement"): `stratcosts` for
all five masks, 21 `stratpath` routes (A9→P3 for each mask, unreachable corners, tactical traversals, trivial routes) and
`groups` after loading each of the six saves (every group field and waypoint, members, squads, squad and vehicle groups,
dead lists, all `SECTORINFO` fields, map elements, underground, arrival events, merc paths, secrets, selected sector)
match exactly; a sweep of all 256 × 256 routes for FOOT, AIR and TRACKED (196,608) and every adjacent tactical
traversal also matches. Unit tests cover §9.3's ids, traversability, travel table, `FindStratPath` tie-breaks and limits,
waypoints and reversal, group ids and order, squads, departure and arrival through the event queue (enemy sleep, queued
battle delay, insertion codes, about-to-arrive), and the encounter matrix with simultaneous arrivals and bloodcats.

**Not yet:** RNG-replay probes (`advance` with a Random tap), `stratpath who=` with a soldier's encumbrance, the
helicopter (§3.16), vehicle boarding and passenger hand-over, NPC-of-note detection (a `TacticalWorldPort` hook),
§3.3's `CanCharacterMoveInStrategic`, theft and loyalty effects of control changes (ports for `docs/17`/`18`), and wiring
`importStrategicMap` and a roster-backed `MercPort` into `createSaveSession` (campaign integration).

**Stubs (2026-10-16).** The stub map format gained `entry: north|east|south|west|center|isolated <x> <y>`,
`exit: <x> <y> -> <SECTOR> [z=<n>] at <worldX> <worldY>` and an `optional` flag on `soldier:` lines (priority
existence off). `stubs/maps/a9.map.txt` is the start village with entry points and garrison placements of every class,
`stubs/maps/wilderness.map.txt` the generic sector. `content/strategic/sector-maps.ts` `sectorMapPath` picks the original
map, else a stub of the same sector, else the generic wilderness stub, so the campaign runs on stubs anywhere.

## 14. Implemented (2026-10-16): §9.2 steps 7–10

**Tactical side** (`src/sim/tactical/`):

| Module | Public API |
|---|---|
| `edgepoints.ts` | `MapEdgepoints` (primary and secondary lists with middle indices, N/E/S/W), `savedMapEdgepoints` (map version ≥ 22), `generateMapEdgepoints(t, sector)` (global reachability from the first entry point, two rows per side from the corner gridnos, `ValidateEdgepoints`, classification against the isolated gridno, the I14 range), `loadMapEdgepoints`, `chooseMapEdgepoint(s)`, `begin/endMapEdgepointSearch`, `searchForClosestPrimary/SecondaryMapEdgepoint`, `calcMapEdgepointClassInsertionCode`, `findNearestEdgepointOnSpecifiedEdge` |
| `insertion.ts` | `Insertion` codes, `updateMercInSector(t, s, order, ctx)` (the §5.6 table: edgepoints, gridno, entry points, exit-grid re-entry, sleep and patient animations), `addSoldierToSector` (sweet spot, facing the centre, exit-grid facing) |
| `init-list.ts` | `SoldierInitNode`, `buildSoldierInitList`, `sortInitList`, `PopulationEnv`, `addPlacementToWorld`, `addSoldierInitListTeamToWorld`, `addSoldierInitListEnemyDefenceSoldiers`, `addSoldierInitListMilitia` (with the loop-stops-at-the-first-soldier quirk), `evaluateDeathEffectsToSoldierInitList`, `stripEnemyDetailedPlacements`, `randomizeRelativeLevel`, `tacticalCreateEnemySoldier`, `addEnemiesToBattle` |
| `map-changes.ts` | `MapChange` records written by structure damage (damage, destroy, partner swap, wall-hung removal, window hits) and `applyMapChanges` |
| `sector-exit.ts` | render bounds and screen coordinates (default and basement), `soldierOKForSectorExit`, `pickGridNoNearestEdge`, `adjustSoldierPathToGoOffEdge`, `pickGridNoToWalkIn`, `mirrorGridNo`, `findGridNoFromSweetSpotCloseToExitGrid`, `setActionToDoOnceMercsGetToLocation`, `checkMercsWaiting` (2500 ms) |

`new TacticalSim(world, content, seed, {streams, profiles, startMs, realtimeClock, hour, dayAmbient})` shares the
campaign's `Random`/`PreRandom` streams, profile progress, real-time clock and light schedule. `TacticalState` gains the
edgepoints, the init list, the map changes, the merc wait (`mercsWaiting`; tactical commands are refused while it runs,
as `LU_BEGINUILOCK`) and `sectorHooks` (`soldierDied`, `soldierLeftMap`, `addPendingEnemies`, `mercsWaitOver`). Fleeing AI
soldiers keep the traversal quote action of `FindFleeSpot` and leave the map (`handleAITacticalTraversal`), which closes
"Map-edge escapes".

**Campaign side** (`src/sim/campaign/`):

| Module | Public API |
|---|---|
| `sector-diff.ts` | `SectorDiff` (items incl. non-existing slots, corpses with time of death, map changes, door table and status, revealed and room-hidden bits, preserved enemies and civilians with their init-list links, smoke and light records), `sectorKey`, the `capture*`/`restore*` pairs, `preserveSoldiers`, `agedCorpse`, `loadPreservedCivilians` |
| `sector-flow.ts` | `SectorFlow`: `setCurrentWorldSector(sector, {autoPlacement, battleLocatorShown})` (§5.2–§5.5 with the diff, flags, enemies from the strategic counts or the preserved records, militia, civilians, the ambush call, guide flag, cosmetic draws), `adoptLoadedSector(links)` for save sessions, `checkAndHandleUnloadingOfCurrentWorld`, `handleDefiniteUnloadingOfWorld`, `saveCurrentSectorsInformation`, `trashWorld`, `prepareEnemyForSectorBattle`, `addPossiblePendingEnemiesToBattle`, `prepareMilitiaForTactical`, `resetMilitia`, `difficultyModifier`, `populationEnv`, `mapsNeededSoon(target)`, `enterSectorRefusal`; free functions `sectorWorldPort`, `dispatchSectorCommand`, `loadStartSector` |
| `sector-exits.ts` | `okForSectorExit`, `exitMenu` (the dialog's checkbox table), `singleMoveAction`, `allMoveAction`, `jumpCodeOf`, `jumpIntoAdjacentSector`, `allMercsHaveWalkedOffSector` (warp to the start of minute + 5 or + 1, `WARPTIME_PROCESS_TARGET_TIME_FIRST`, 300 s retreat warp), `allMercsWalkedToExitGrid`, `exitCheck`, `exitSectorCommand` |

**Integration.** `CampaignSim` takes `hooks.sectors = {worlds: SectorWorlds, content, roster}` and exposes
`campaign.sectors`. Commands: `enterSector {sector: 'B9' | {x, y, z}}` and `exitSector {soldier, direction:
'north'|'east'|'south'|'west' | exitGrid: gridNo, who: 'squad'|'merc', load?: boolean}`; the result carries `minutes`,
`who`, `load`, `target` and `level`, a refusal one of `tooFar`, `invalidTraversal`, `loneEPC`, `abandonEPC`,
`squadNotAllowed`, `mercNotAllowed`, `loadDisabled`. Events: `sectorLoaded`, `sectorUnloaded`, `mercsLeftSector`.
`loadStartSector(campaign)` is the default `CampaignHooks.loadStartSector`. `server/world-cache.ts` (`WorldCache`) loads
the maps of `mapsNeededSoon` before a command (`CampaignSession.prepare`, `Session.prepareAndDispatch`, used by the
WebSocket queue and MCP `act`); save sessions get a flow when `createSaveSession` receives a `FileExists`. The strategic
world port (`sectorWorldPort`) answers `enemyReinforcementsArrived` and the reinforcement checks with the loaded sector.

**For the PBI (`docs/19`).** "Enter sector" clears `encounter.preBattle` and `movement.disableMapInterfaceDueToBattle`,
then calls `campaign.sectors.setCurrentWorldSector(sector, {autoPlacement: firstVisit, battleLocatorShown: true})` or
dispatches `enterSector`; retreat and the end of a battle unload through `checkAndHandleUnloadingOfCurrentWorld()`. The
tactical end of battle (`docs/19` §3.2: control, `LogBattleResults`, morale and loyalty) is not wired: `checkForEndOfBattle`
only emits `combatEnded`.

**`docs/17` callers wired:** `prepareEnemyForSectorBattle` → `sortSoldierInitList` + `addSoldierInitListEnemyDefenceSoldiers`
→ `assignEnemyGroupIds`; deaths and map-edge escapes → `trackEnemiesKilled`, `processQueenCmdImplicationsOfDeath`;
tactical turn ends and `enemyReinforcementsArrived` → `addPossiblePendingEnemiesToBattle` (arrivals through the edgepoints);
unload → `endTacticalBattleForEnemy` and, whenever the world is trashed, `handleFirstMeanwhileSetUpWithTrashWorld`; soldier
creation → `difficultyModifierAt`.

**Sandbox.** `server/sandbox.ts` populates A9 through the init list (civilians, then `addSoldierInitListEnemyDefenceSoldiers`
with 4 troops and the modifier of a medium game without progress, 11); `SANDBOX_POPULATION`, `chooseEnemyPlacements` and
the old `addSoldierToSector` are gone ("Sandbox population" narrowed in `deviations.md`).

**Tests** (stubs: `stubs/maps/a10.map.txt` with an exit grid to `a10_b1.map.txt`, a basement with `scroll: basement`):
`edgepoints.test.ts`, `sector-exit.test.ts` (thresholds on a default and a basement map, walk-off and walk-in targets, the
2500 ms release), `init-list.test.ts` (sort, defence placement, militia, death and strip rules, relative levels),
`sector-flow.test.ts` (landing with the garrison, guide flags, Queen notification, walk-off to A10 within 2505 ms and
+5 minutes with the UI lock, items/corpses/revealed tiles after a day away, `tooFar`, a lone merc leaving without load,
preserved enemies at 300/301 minutes and on a count change, civilians healed, militia, the ambush call, pending
reinforcements through the edgepoints, the A10 stairs into the basement and back), `sector-scenario.test.ts` (A9 → B9 by
`route`, PBI hand-off, `enterSector`, the battle fought to the end, leave, re-enter after an hour, the same digest under
the instant and the manual driver).

**Verified against the oracle** (`tools/oracle/probes/sectors.txt`, patch `0004`, README "Sector transitions"): 13
edgepoint dumps (loaded and generated on A9, D13, H13, I14, I13, G1, D6 and the A10 basement), 18 `soldierexit`, 20
`walkoff`, 15 `walkin`, 31 `mirror` (class codes on H13 and I14), 4 `initlist` sorts, 10 `defence` placements
(4–64 enemies on 32–64 placements, decision draws replayed with the native placement outcomes) and 21 `exitcheck` on
SaveGame10, 07 (in combat) and 01 match exactly.

**Not yet:** native temp files of other sectors in save sessions (only the loaded sector's preserved-soldier links), the
placement GUI (auto placement only), NPC profile insertion and quest placements (M6), rotting
and crows in the loaded sector, the API side of step 11 (MCP tools and `PlayerView.strategic` for the new commands) and
the tactical end of battle (above). Creatures and bloodcats are placed since `docs/17` §20 (`addSoldierInitListCreatures`,
`addSoldierInitListBloodcats`, `addCreaturesToBattle`; oracle `creatureplacement`/`bloodcatplacement`).

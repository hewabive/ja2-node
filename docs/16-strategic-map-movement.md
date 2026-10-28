# 16 — The strategic map: sectors, squads, groups, routes, travel, encounters and sector transitions

**Conventions.** Paths are relative to `reference/stracciatella/src/game/` (snapshot `ae6bf01`) unless they start with
`sgp/`, `externalized/` (both under `reference/stracciatella/src/`) or `assets/` (under `reference/stracciatella/`);
`V:` is vanilla `Build/`. JSON files are `assets/externalized/<name>.json`, copied unchanged to `data/externalized/`.
"(inferred)" = not traced end to end. C integer semantics: `/` truncates (`idiv`), `UINT8`/`INT8` stores wrap. `Random`
= `main` stream, `PreRandom` = `pre` stream (`01` §3.6); `Random(0)` and `PreRandom(0)` return 0 without drawing;
`Chance(x)` = `Random(100) < x`, `PreChance(x)` = `PreRandom(100) < x` (`sgp/Random.cc:63-89`). Strategic time is world
seconds; most strategic APIs use **world minutes** (`GetWorldTotalMin`); `AddStrategicEvent(kind, minute, param)` stores
`minute * 60` seconds (`Strategic/Game_Events.cc:200-205`). "Sector" alone =
`SGPSector {x 1..16, y 1..16 (A..P), z 0..3}`. Directions: tactical `NORTH 0 … NORTHWEST 7` (`07`); strategic moves
`NORTH_STRATEGIC_MOVE 0, EAST 1, SOUTH 2, WEST 3, THROUGH 4` (`Strategic/Strategic_Movement.h:29-36`). Teams and soldier
id ranges: `14` §7. Policy values are Stracciatella's `game.json` defaults (`squad_size` 6, `start_sector` "A9",
`start_sector_revealed` true).

**Scope.** Sector tables, groups and squads, strategic routes and travel time, arrival processing up to the PBI
hand-off, entering/leaving/unloading a tactical sector, per-sector persistence, strategic enemy counts → placed soldiers
(the soldier init list), sector control, airspace, the player's knowledge of enemies. Elsewhere: `15` (clock,
compression, the event queue and its same-timestamp order, `WarpGameTime`, new-game init); `17` (`Queen_Command.cc`
incl. `PrepareEnemyForSectorBattle` and pending reinforcements, the Queen, garrisons and patrols, enemy group decisions
incl. `StrategicAILookForAdjacentGroups`, creature spreading); `18` (militia counts and their tactical placement rules,
loyalty events, mines, theft, assignments incl. sleep and `FatigueCharacter`); `19` (everything from
`InitPreBattleInterface` on: encounter-code refinement, PBI choices, retreat, autoresolve); `25` §5 (the helicopter);
`29` (agent API: route and sector commands, prompts, events, the strategic view). Tactical: `07` (pathing), `08`
(sight), `10` (turns, `CheckForEndOfBattle`), `12` (items, smoke), `14` (savegame reader, native temp-file framing).

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

Byte ids: `SectorInfo[]`, the temp-file loop. Strategic indices: `StrategicMap[]`, the strategic pathfinder, merc paths.
`SGPSector`: groups, soldiers. Byte id 255 (P16, an EDGEOFWORLD sector) doubles as "no previous sector": soldiers are
created with `ubPrevSectorID = 255` (`Tactical/Soldier_Create.cc:946`), so a fresh group's `ubPrev` is P16 and
`RetreatGroupToPreviousSector` treats `ubPrev == (16,16)` as "none" (`Strategic/Strategic_Movement.cc:2769-2773`).
ja2-node: `src/content/strategic/sector-ids.ts` (`sectorId`, `sectorFromId`, `strategicIndex`,
`sectorShortString`/`sectorLongString`, `mapFileName`, `NO_PREVIOUS_SECTOR_ID`).

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

| Field (save offset) | Type | Meaning | Owner |
|---|---|---|---|
| `uiFlags` (0) | u32 | `SF_*` (§1.5) | §1.5 |
| `ubGarrisonID` (5) | u8 | Garrison index, 255 none; read by `NumStationaryEnemiesInSector` | `17` |
| `ubPendingReinforcements` (6) | i8 | | `17` |
| `fMilitiaTrainingPaid`, `ubMilitiaTrainingPercentDone`, `…Hundredths` (7–9) | | | `18` |
| `ubNumTroops/Elites/Admins/Creatures` (14–17) | u8 | Stationary enemy counts (encounters, placement) | `17` |
| `ub{Troops,Elites,Admins,Creatures}InBattle` (18–21) | u8 | Already placed in the loaded battle | §5.13 |
| `ubDayOfLastCreatureAttack` (24) | u32 | | `17` |
| `uiFacilitiesFlags` (28) | u32 | `SFCF_*`: hospital 1, industry 2, prison 4, military 8, airport 0x10, gun range 0x20 (display) | `InitKnowFacilitiesFlags` (`Strategic/Campaign_Init.cc:30-66`), `SetSectorFlag` (§1.5) |
| `ubTraversability[5]` (32–36) | u8 | Edge types N, E, S, W and "through" (§1.6) | `InitStrategicMovementCosts` |
| `bBloodCats` (39) | i8 | −1 = not rolled yet; ≥0 population | `InitBloodCatSectors` (`Strategic/Game_Init.cc:118-137`), §4.2 |
| `bBloodCatPlacements` (40) | i8 | Placements in the map | same; recounted on load (§5.13) |
| `ubTravelRating` (42) | u8 | Unused by game logic (comment in JSON) | `InitStrategicMovementCosts` |
| `ubNumberOfCivsAtLevel[3]` (43–45) | u8 | Militia green/regular/elite (encounters, scouting) | `18` |
| `uiTimeCurrentSectorWasLastLoaded` (52) | u32 min | Last time the player left it loaded | §5.11 |
| `uiTimeLastPlayerLiberated` (60) | u32 **seconds** | §5.13 strip rule | `17`/`19` |
| `fSurfaceWasEverPlayerControlled` (64) | bool | | §6.1 |
| `uiNumberOfWorldItemsInTempFileThatCanBeSeenByPlayer` (68) | u32 | Map-inventory count | §5.11 |

Save record 116 bytes (`Strategic/LoadSaveSectorInfo.cc:7-48`); the skipped bytes are vanilla's `ubInvestigativeState`
(4), `fPlayer[4]` (10–13), `bLastKnownEnemies` (22), `bNameId`, `bUSUSED` (37–38), `UNUSEDbSAMCondition` (41) and
fillers (`V: Strategic/CampaignTypes.h:407-467`). Vanilla wrote `fPlayer[]` ("player thinks he controls it") but never
read it (`V: Strategic/PlayerCommand.c:128-380`); Strac dropped it. ja2-node: `SectorInfo`
(`src/sim/strategic/map/sectors.ts`) holds every saved field in camelCase (`flags`, `garrisonId`, `militia[3]`,
`timeLastLoaded`, `timeLastPlayerLiberated`, `visibleItems`, …).

New-game init of these records (`InitNewCampaign`, `Strategic/Campaign_Init.cc:98-122`: zero-fill, then the tables, the
start-sector reveal `SetSectorFlag(A9, SF_ALREADY_VISITED)`; `InitBloodCatSectors`: `bBloodCats = −1` for ids 0..254
only, P16 stays 0, harmless, then JSON placements and the lair/arena spawn counts in both fields by difficulty):
`15` §4.3.

### 1.4 `UNDERGROUND_SECTORINFO` (`Campaign_Types.h:198-210`)

A singly linked list built from `strategic-map-underground-sectors.json` in file order
(`BuildUndergroundSectorInfoList`, `Campaign_Init.cc:85-93`); `FindUnderGroundSector` walks it
(`Strategic/Queen_Command.cc:1089-1098`). Node fields: `uiFlags` (same `SF_*`); `ubSector`;
`ubNumElites/Troops/Admins/Creatures` (init draws: `17` §3.2, `externalized/strategic/UndergroundSectorModel.cc:13-25`);
`uiTimeCurrentSectorWasLastLoaded`; `ubAdjacentSectors` (N 1, E 2, S 4, W 8; creature spreading and the map only);
`ubCreatureHabitat` (`17`); the four `…InBattle` counters; the visible-item count. Save record 72 bytes
(`Strategic/LoadSaveUndergroundSectorInfo.cc:7-34`). The shipped JSON has 36 nodes (A10, B2, D4, D5 b1 empty; J9 b1/b2;
K4 b1; O3 b1 ↔ P3 b1; five mines with up to three levels).

### 1.5 Sector flags (`Campaign_Types.h:32-63`)

| Flag | Value | Set | Cleared / read |
|---|---|---|---|
| `SF_USE_MAP_SETTINGS` | 0x1 | data only (none in vanilla, inferred) | `PrepareEnemyForSectorBattle` counts map placements instead (§5.13) |
| `SF_ENEMY_AMBUSH_LOCATION` | 0x2 | `InitStrategicAI` for ROADBLOCK garrisons (`Strategic/Strategic_AI.cc:425`, `17`) | PBI ambush chance +20 (`19`) |
| `SF_PLAYER_KNOWS_ENEMIES_ARE_HERE` | 0x4 | PBI with `ENEMY_ENCOUNTER_CODE` (`Strategic/PreBattle_Interface.cc:431-440`) | all 256 cleared on the next clock advance while `!fEnemyInSector` (`Strategic/Game_Clock.cc:211-216`) |
| `SF_ALREADY_VISITED` | 0x20 | arrival of a non-heli player group (§3.9), `EnterSector` (not in meanwhile), start sector at init | never cleared; fog, enemy knowledge, theft, bloodcat lair corpses |
| `SF_USE_ALTERNATE_MAP` | 0x40 | `InitNPCs` (NPC placements), cache sector (`17`), Tixa b1 if not sci-fi (`Game_Init.cc:73-116`), the pending flag below | map file name |
| `SF_PENDING_ALTERNATE_MAP` | 0x80 | creature quest init, on the lair entrance (`Strategic/Creature_Spreading.cc:242`, `17` §12.1) | the first creature added to that node turns it into `SF_USE_ALTERNATE_MAP` (`:278-282`) |
| `SF_ALREADY_LOADED` | 0x100 | `SetCurrentWorldSector` after `EnterSector` | item temp file replaces map items (§5.11) |
| `SF_HAS_ENTERED_TACTICAL` | 0x200 | `SetCurrentWorldSector` | mods only |
| `SF_SKYRIDER_NOTICED_ENEMIES_HERE` | 0x400 | heli scouting (`25` §5.3) | cleared when Skyrider leaves (§6.3) |
| `SF_HAVE_USED_GUIDE_QUOTE` | 0x800 | RPC sector description (`24` §8.6) | |
| `SF_*_TEMP_FILE_EXISTS` | 0x00100000 … 0x80000000 | §5.11 | §5.11 |

`SetSectorFlag(sector, SF_ALREADY_VISITED)` also: Tixa (J9) visited →
`SectorInfo[SEC_J9].uiFacilitiesFlags |= SFCF_PRISON`; the gun range sector (13, H, 0) → H13/H14/I13/I14 gain
`SFCF_GUN_RANGE`; if the flag was not yet set, `++ubNumNewSectorsVisitedToday == NEW_SECTORS_EQUAL_TO_ACTIVITY` updates
the player-activity day (`17`) (`Tactical/Tactical_Save.cc:773-812`). Underground flags go to the node if it exists,
silently nowhere otherwise. ja2-node: `setSectorFlag`/`resetSectorFlag`/`getSectorFlagStatus` in `map/sectors.ts` with
these side effects; the activity counters are `map.activity`.

### 1.6 Traversability (`Campaign_Types.h:100-147`) and the movement-cost table

Enum:
`TOWN 0, ROAD 1, PLAINS 2, SAND 3, SPARSE 4, DENSE 5, SWAMP 6, WATER 7, HILLS 8, GROUNDBARRIER 9, NS_RIVER 10, EW_RIVER 11, EDGEOFWORLD 12`,
then display-only `TROPICS 13 … SWAMP_ROAD 24`, `*_SAM_SITE 25–28`, special sites 29–38.
`strategic-map-traversibility-ratings.json` maps letters to these numbers ("R" 1, "P" 2, "X" 0, "E" 12 …).

`strategic-map-movement-costs.json` (JSONC): `traverseWE` 16 rows × 17 columns (column `k` = the border west of sector
`x = k+1`), `traverseNS` 17 rows × 16 columns (row `k` = the border north of row `y = k+1`), `traverseThrough` 16 × 16,
`travelRatings` 16 × 16 (`externalized/strategic/MovementCostsModel.cc:22-68`). Per sector
(`Strategic/Strategic_Movement_Costs.cc:9-30`):

```
W = WE[y−1][x−1]   E = WE[y−1][x]   N = NS[y−1][x−1]   S = NS[y][x−1]   THROUGH = Through[y−1][x−1]
```

Edges use only `A D E G H N P R S W X` in the shipped table. "Through" uses the extended types and is read only by the
land-type text, the loading screen, `IsSectorDesert` (`== SAND`), `SectorIsPassable` (≠ GROUNDBARRIER and ≠ EDGEOFWORLD;
the map UI and `Strategic_AI.cc:260`), `IsTheCursorAllowedToHighLightThisSector` (≠ EDGEOFWORLD) and one tactical rule
(`Tactical/Soldier_Control.cc:5451`, `!= TOWN`). `GetTraversability(byteFrom, byteTo)` picks the direction from the byte
difference (−1 W, +1 E, +16 S, else N) (`Strategic_Movement_Costs.cc:33-60`).

### 1.7 Externalized tables (`data/externalized`, JSON with `//` and `/* */` comments, no trailing commas)

| File | Fields | Consumer |
|---|---|---|
| `strategic-map-movement-costs.json` | §1.6 | `InitStrategicMovementCosts` |
| `strategic-map-traversibility-ratings.json` | letter → enum | the model loader |
| `strategic-map-towns.json` | `townId` 1..12, `internalName`, `sectors[]`, `militiaMapBaseSector` (art), `townPoint` (label ×10 sectors), `isMilitiaTrainingAllowed` | `bNameId`, `FOR_EACH_SECTOR_IN_TOWN`, loyalty, militia, NPC-of-note rule, invasion messages |
| `strategic-map-sectors-descriptions.json` | `sector`, `sectorLevel`, `landType` | `GetSectorLandTypeString` (B13 airport, F8 hospital, N3 airport, five underground facilities); text only |
| `strategic-map-underground-sectors.json` | §1.4 | `BuildUndergroundSectorInfoList` |
| `strategic-map-sam-sites.json` | 4 × `sector` (D2, D15, I8, N4 — order fixed), `gridNos[2]` (controller tiles) | SAM ids, structure damage, `IsThisSectorASAMSector`; airspace, encounters (SAM = "important") |
| `strategic-map-sam-sites-air-control.json` | 16 × 16 of `samId + 1`, 0 = no SAM covers it | `UpdateAirspaceControl` |
| `strategic-map-secrets.json` | `sector`, `isSAMSite`, `secretMapIcon`, `secretLandType`, `foundLandType` (Tixa, Orta, 4 SAMs) | found on arrival (§3.9) or by quests; the native save keeps Tixa's state in the general-info block, Orta's after the strategic info and the SAM sites' as an array (`SaveLoadGame.cc:1880,1908`, `StrategicMap.cc:2346-2348`) |
| `strategic-map-cache-sectors.json` | `sectors[5]`, `numTroops[3]`, `numTroopsVariance[3]` | `InitStrategicAI` (`Strategic/Strategic_AI.cc:552-560`, `17`) |
| `strategic-map-npc-placements.json` | `profile`, `sectors[]`, `placedAtStart`, `useAlternateMap`, `sciFiOnly` | `InitNPCs`, daily NPC moves (`35` §2.2, §2.3) |
| `strategic-bloodcat-placements.json` | `sector`, `bloodCatPlacements` | `InitBloodCatSectors` |
| `strategic-bloodcat-spawns.json` | `sector`, `isLair`/`isArena`, spawns by difficulty (I16 lair, N5 arena) | same, §4.2 |
| `strategic-map-creature-lairs.json`, `strategic-mines.json`, `strategic-ai-policy.json`, `army-*.json` | | `17`, `18` |
| `vehicles.json` | per vehicle type: sounds, `profile`, `movementType` (FOOT/CAR/TRUCK/TRACKED/AIR), `armourType`, `seats` (≤ 10); order fixed (HELICOPTER is index 5) | `AddVehicleToList` sets the group's transport mask (`Tactical/Vehicles.cc:114`) |
| `game.json` | `squad_size`, `start_sector`, `start_sector_revealed` | squads, new game |

### 1.8 Tables that exist only in C sources

| Table | Source | Use | ja2-node |
|---|---|---|---|
| Travel times per transport and edge type | `Strategic/Strategic_Movement.cc:2065-2190` | §3.5 | `data/tables/strategic-travel.json` (§7.1) |
| Facilities per sector (hospital, airport, prison, military…) | `Strategic/Campaign_Init.cc:30-66` | display, `18` | `data/tables/sector-facilities.json` |
| `SectorIncrementer[8]` (dx, dy per tactical direction) | `Strategic/StrategicMap.cc:157-167` | §5.9 | `SECTOR_STEP` in `campaign/sector-exits.ts` |
| Edgepoint generator corners `gsTLGridNo 13286, gsTRGridNo 1043, gsBLGridNo 24878, gsBRGridNo 12635` | `TileEngine/Map_Edgepoints.cc:51-54` | §5.7 | `tactical/edgepoints.ts` |
| RPC sector descriptions (33 sectors, quote ids) | `StrategicMap.cc:355-393` | `24` §8.6 | `campaign/narrative/guide-description.ts` |
| Heli refuel sites (Drassen B13 grid 9001, Estoni I6 grid 13067), heli costs | `Strategic/Map_Screen_Helicopter.cc:44-84`, `.h:12-13` | §3.16 | `forces/helicopter-state.ts`; costs in the travel table |
| Bloodcat lair corpses (3 gridnos) | `Strategic_Movement.cc:1029-1068` | §3.9 | not ported (§7.7) |

---

## 2. Groups and squads

### 2.1 Structures (`Strategic/Strategic_Movement.h:41-116`)

| `GROUP` field | Meaning |
|---|---|
| `fDebugGroup` | Debug enemy groups are deleted on arrival (`HandleNonCombatGroupArrival`); never set in play |
| `fPlayer`, `fVehicle`, `fPersistant` | Persistent groups (squads, vehicles) are never deleted when empty; `CancelEmptyPersistentGroupMovement` parks them instead (§2.3) |
| `ubGroupID` | 1..255 (§2.2) |
| `ubGroupSize` | Player: member count (vehicle groups count the vehicle soldier too); enemy: `troops + elites` at creation, maintained by `17` |
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

Native save: `u32 n`, then per group 84 bytes (`fDebugGroup` 0, `fPlayer` 1, `fVehicle` 2, `fPersistant` 3, id 4, size
5, sector x/y/z 6–8, next x/y 9–10, prev x/y 11–12, original 13, between 14, move type 15, next waypoint 16, arrival 20,
traverse 24, mask 36, flags 40, created 44, reassignment 45); player groups with size > 0: `u32 n` × `u32 profile`;
enemy: 29 bytes (troops 0, elites 1, admins 2, pending 4, adminsInBattle 5, intention 6, troopsInBattle 7,
elitesInBattle 8); `u32 n` × 8-byte waypoints (x 0, y 1); finally the 32-byte id mask, which the loader skips and
rebuilds from the loaded ids (`Strategic_Movement.cc:2394-2717`). Squads: 120 × 12 bytes (`i16 soldier id` 0, `u8`
format 2, `i8 squad` 3) + `INT8 SquadMovementGroups[20]` (`Tactical/Squads.cc:643-730`). ja2-node: `Group`
(`forces/groups.ts`), same fields in camelCase; `members` holds soldier ids, `enemy` is the `ENEMYGROUP` record or null.

### 2.2 Group ids and the list

`AddGroupToList` takes the lowest id `1..255` whose bit is clear in `uniqueIDMask` (`id / 32`, `1 << id % 32`), sets it,
and **appends** the group to the end of `gpGroupList`; 255 groups max, then `runtime_error`
(`Strategic_Movement.cc:506-528`). `RemoveGroupFromList` unlinks and clears the bit (`:533-553`). `GetGroup(id)` is a
list scan. New game: `InitNewCampaign` → `RemoveAllGroups`; then `InitStrategicAI` creates the patrol groups (`17`),
then `InitSquads` 20 persistent player groups at (1,1) (`Squads.cc:41-56`), then `InitVehicles` 10 persistent vehicle
groups at (1,1) with mask CAR (`Tactical/Vehicles.cc:51-61`) (`Strategic/Game_Init.cc:140-151`). Squad group ids
therefore depend on the number of patrol groups: address squads by index, never by group id. ja2-node:
`lowestFreeGroupId` takes the lowest id not used by a listed group, which is what `uniqueIDMask` always holds.

Creation (`Strategic_Movement.cc`):

- `CreateNewPlayerGroupDepartingFromSector(s)` (`:111-129`): sector = next = s, original = created = `s.AsByte()`,
  `fPlayer`, ONE_WAY, mask FOOT, reassignment 255.
- `CreateNewVehicleGroupDepartingFromSector(s)` (`:132-152`): same with `fVehicle`, mask CAR (overwritten by
  `AddVehicleToList` from `vehicles.json`).
- `CreateNewEnemyGroupDepartingFromSector(id, admins, troops, elites)` (`:476-498`): CIRCULAR, mask FOOT, size =
  troops + elites (every caller passes 0 admins; `17` converts two patrols to admins afterwards, keeping the size).
- `RemoveGroup(g)` (`:1828-1865`): a persistent group outside `RemoveAllGroups` is only parked
  (`CancelEmptyPersistentGroupMovement`) with a warning; otherwise frees the waypoints, its `EVENT_GROUP_ARRIVAL`, the
  member list or the enemy struct (`RemoveGroupFromStrategicAILists`, `17`), unlinks the group and clears
  `gpBattleGroup` if it pointed there.

### 2.3 Player membership

In `Strategic_Movement.cc` unless named:

- `AddPlayerToGroup(g, s)` (`:155-183`): `s.ubGroupID = g.id`; first member: list = [s], size = 1,
  `g.ubPrev = SGPSector(s.ubPrevSectorID)`, `g.ubSector = s.sSector` (z included); later members are appended, size + 1.
- `RemovePlayerFromPGroup(g, s)` (`:189-217`): unlink, `s.ubPrevSectorID = g.ubPrev.AsByte()`, `s.ubGroupID = 0`; size
  0: non-persistent → `RemoveGroup`, persistent → `CancelEmptyPersistentGroupMovement` (`:3434-3451`: vehicles
  untouched; others lose the arrival event and waypoints, traverse = arrival = 0, not between,
  `ubPrev = ubSector = ubNext = (0,0,0)`). `RemovePlayerFromGroup(s)` with a missing group only zeroes `ubGroupID`.
- A merc not on a squad, not in a vehicle and not in transit gets his own non-persistent group from
  `AssignMercToAMovementGroup` when he takes an assignment (`Strategic/Assignments.cc:6366-6377`).
- `HandleSoldierLeavingSectorByThemSelf(s)` (`StrategicMap.cc:1575-1611`): squad member → removed from squads and group;
  otherwise his non-vehicle group is removed; then `AddCharacterToUniqueSquad(s)`; still without a group → a new player
  group at his sector.

### 2.4 Squads (`Tactical/Squads.cc`)

`Squad[20]` vectors of `squad_size` (6) slots; `SquadMovementGroups[20]` persistent group ids; the squad number is the
assignment (`SQUAD_1 0 … SQUAD_20 19`,
`ON_DUTY 20, DOCTOR, PATIENT, VEHICLE 23, IN_TRANSIT 24, …, ASSIGNMENT_DEAD 30, ASSIGNMENT_POW 32`,
`Strategic/Assignments.h:28-65`). `NO_CURRENT_SQUAD = 20`.

`AddCharacterToSquad(s, q)` (`:85-210`), in order:

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

`SetGroupSectorValue` (§3.11) **removes the squad group's waypoints and arrival event** each time a member is added, so
adding a merc resets the squad's movement (harmless: a moving squad refuses new members).

- `AddCharacterToAnySquad(s)` (`:214-255`): first non-empty squad (ascending) that accepts him, else the first empty
  one, else `logic_error`.
- `AddCharacterToUniqueSquad(s)` (`:259-265`): `GetFirstEmptySquad` (ascending, `logic_error` if none).
- `RemoveCharacterFromSquads(s)` (`:290-330`): clear the slot, free his personal path **without** touching the group's
  waypoints (`ClearStrategicPathList(path, -1)`), `RemovePlayerFromGroup`; a vehicle between sectors gets a fresh group
  at its sector; `RebuildSquad` compacts the slots (`std::remove_if`, order kept, `:744-749`); a dead soldier is added
  to that squad's `sDeadMercs` (first free or stale entry, `:793-813`); the squad's dead list is reset when its group
  arrives anywhere (§3.9).
- `NumberOfPlayerControllableMercsInSquad(q)` counts non-vehicle members (EPCs and the robot included, `:860-884`).
- `CheckSquadMovementGroups` recreates missing squad groups (`:904-915`).

---

## 3. Routes and travel

### 3.1 Merc paths vs group waypoints

The player plans with **paths** (`PathSt` doubly linked lists of strategic indices, head = the sector the group occupies
or departed), stored on every member (`pMercPath`) and on the vehicle (`VEHICLETYPE.pMercPath`); squad members share
copies (`CopyPathToCharactersSquadIfInOne`). `GetSoldierMercPathPtr`/`GetSoldierGroup`: in a vehicle → the vehicle's
path/group; is a vehicle → its own entry; else the soldier's (`Strategic/Strategic_Pathing.cc:1049-1090`). The group
moves along **waypoints** built from the path at its pivots (§3.4). Arrival removes the path head (§3.9). ja2-node keeps
paths as arrays of strategic indices (`StrategicMerc.path`, `VehicleRecord.path`).

### 3.2 `FindStratPath(start, dest, group, tacticalTraversal)` (`Strategic_Pathing.cc:188-441`)

Best-first search on the 18×18 strategic-index grid with a sorted linked open list (`pathQB[512]`, index 0 = head, 511 =
free pool), trail tree `trailStratTreeB[4096]`, best costs `trailCostB[324]` (init `0xFFFFFFFF`).

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
    if avoidPlayerInfluenced && nb != dest:               // enemy routing only (wrappers below)
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
found → reverse the trail chain from the head node; emit up to MAX_PATH_LIST_SIZE (30) directions (0/2/4/6); return count
else 0
```

The heuristic is in sectors while costs are minutes, so it only breaks ties: Dijkstra ordered by minutes, then estimate,
then Manhattan distance, then LIFO. No random numbers. ja2-node: `findStratPath` (`map/pathing.ts`) runs the literal
queue and trail tree with both limits.

`BuildAStrategicPath(start, end, group, tt)` (`:444-487`): `end < 17` → null; otherwise a list `[start, …, end]`
following the directions; any step landing below index 17 clears it. `AppendStrategicPath(new, old)` drops the new head
if it equals the old tail (`:490-534`). Enemy movement wrappers (`17`): `MoveGroupFromSectorToSector`,
`…ButAvoidPlayerInfluencedSectors` (falls back to the plain route), `…AndStopOneSectorBeforeEnd` (removes the tail)
(`:917-1020`).

### 3.3 Plotting and editing a route (player)

- `PlotPathForCharacter(s, sector, tt)` (`Strategic/Map_Screen_Interface_Map.cc:849-884`): refused if the cursor may not
  highlight the sector (invalid or EDGEOFWORLD "through"), in transit, or `s.sSector.z != 0` (message "must reach the
  surface"); vehicles get `SetUpMvtGroupForVehicle`; the new leg starts at **the last sector of the current path**
  (`GetLastSectorIdInCharactersPath`, `Strategic_Pathing.cc:752-767`; the soldier's sector if no path) and is appended,
  then copied to the vehicle or the squad. The map UI calls it only when the destination is passable "through"
  (`SectorIsPassable`) and the temporary preview path is non-empty (`Strategic/MapScreen.cc:2281-2328`), then copies the
  path to every selected character.
- Confirm (click on the last path sector): `RebuildWayPointsForAllSelectedCharsGroups`, once per group id, with the path
  of the vehicle or of the selected destination character (`MapScreen.cc:5520-5661`).
- Shorten: `ClearPathAfterThisSectorForCharacter(s, sector)` (`Map_Screen_Interface_Map.cc:904-969`): no path → abort;
  sector == his sector → cancel all selected; else cut the path after the last occurrence of `sector` (vehicle path too)
  and copy to all selected if it got shorter.
- Cancel: `CancelPathForCharacter(s)` (`:972-1001`): clear the path and the group's waypoints, then
  `RebuildWayPointsForGroupPath(null, group)` (reverses a moving group, §3.4); vehicles via `CancelPathForVehicle`; copy
  to the squad.
- `ClearMercPathsAndWaypointsForAllInGroup(g)` clears every member's and the vehicle's path and the waypoints
  (`Strategic_Pathing.cc:1097-1121`).

Who may be given a destination: `CanEntireMovementGroupMercIsInMove(s)` = `CanCharacterMoveInStrategic` for him, then
for every listed character in his group or selected (`Strategic/Map_Screen_Interface.cc:3873-3903`).
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

ja2-node: `forces/routes.ts` (people and vehicles), `forces/move-permission.ts` (`canEntireMovementGroupMove`; no fuel
or museum check, gap "Strategic move refusals"), `forces/move-box.ts`; a route is one command, not cursor clicks
(deviations "Map route plotting", "Move box regrouping").

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
of every member's path and skip the alignment check; otherwise the new point must differ from the group's sector (or the
last waypoint) in exactly one axis (diagonal or identical → error, false). Append the waypoint; **the first waypoint
starts movement** (`InitiateGroupMovementToNextSector`, §3.6) unless reversed. Player groups: every member's
`ubStrategicInsertionCode` = 0 (= `INSERTION_CODE_NORTH`, "nuke tactical traversal information").

`GroupReversingDirectionsBetweenSectors(g, s, building)` (`:242-305`): only if between sectors and the clipped direction
to `s` differs from `ubNext − ubSector` (a 90° turn counts as a reversal; a zero vector always differs). Then: delete
the arrival event; `prev = next; next = sector; sector = prev` (sector and next swapped); members' `sSector` follow;
**arrival = traverse − arrival + 2·nowMin** (the time already travelled; traverse time unchanged); still in the future →
re-post `GROUP_ARRIVAL` (+ `ABOUT_TO_ARRIVE` at arrival − 5 for players if still ahead); else, unless building
waypoints, `GroupArrivedAtSector(g, TRUE, TRUE)`.

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

Integer divisions (foot on plains `89·100/85 = 104`, tracked on water `46·100/10 = 460`); AIR is 10 on every edge but
EDGEOFWORLD, GROUNDBARRIER included. Constants: `data/tables/strategic-travel.json` (§7.1). Fatigue does not change
speed; it stops the group at the next sector (§3.10). The encumbrance maximum is the only per-member speed rule. Any
mask bit whose terrain is impossible makes the whole edge impossible (mixed masks never occur for players). ja2-node:
`getSectorMvtTimeForGroup`/`sectorMovementTime` (`map/travel.ts`); `CalculateCarriedWeight` is
`MercPort.carriedWeightPercent` (`carriedWeightPercent`, `src/sim/tactical/inventory.ts`).

ETA: `FindTravelTimeBetweenWaypoints(a, b, g)` walks byte ids from `a` to `b` one step at a time (direction from the
sign of the byte difference and divisibility by 16), summing edge times (`:1989-2062`); `CalculateTravelTimeOfGroup(g)`
= `arrival − now` (if between sectors and arrival ≥ now) + legs from `ubNext` (or `ubSector`) through every waypoint
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

`DelayEnemyGroupsIfPathsCross(pg)` (`:1616-1639`): every enemy group with `arrival < pg.arrival`, `next == pg.sector`
and `sector == pg.next` (head-on) gets its event re-posted at `pg.arrival + 1 + Random(10)`: the player always meets it
in the destination sector.

Events: `EVENT_GROUP_ARRIVAL` (18) → `GroupArrivedAtSector(g, TRUE, FALSE)`; `EVENT_GROUP_ABOUT_TO_ARRIVE` (35) →
`HandleGroupAboutToArrive`: map redraw and the Dead-is-Dead autosave only
(`Strategic/Game_Event_Hook.cc:158-160,201-203`, `Strategic/Map_Screen_Interface.cc:1226-1236`); ja2-node keeps the
event for queue parity, without effect. `ABOUT_TO_ARRIVE_DELAY` = 5 (`:55`).

### 3.7 Fatigue and stopping

`PlayerSoldierTooTiredToTravel(s)` (`Assignments.cc:6346-`): only soldiers who sleep; in a vehicle only the forced
driver counts; asleep and not awakenable, or awake with `bBreathMax < BREATHMAX_GOTTA_STOP_MOVING` (30).
`AnyMercInGroupCantContinueMoving(g)` (`:6318-6343`) puts every such member to sleep (`fMercCollapsedFlag`) with quotes
and returns true. Hourly `FatigueCharacter` (`:2073-2117`; a walker's `bBreathMax` loss ×encumbrance/100 above 100%) is
`18`'s. ja2-node reaches both through `MercPort.tooTiredToTravel`/`collapseFromFatigue`.

### 3.8 Experience and fuel on arrival

`AwardExperienceForTravelling(g)` (`Strategic_Movement.cc:997-1026`), per member not mechanical and not EPC:
`bLifeMax < 100` → `points = traverse / (450 / (100 − lifeMax))`, `StatChange(HEALTHAMT, points, FROM_SUCCESS)` if > 0;
`bStrength < 100` and carried > 50% → `points = traverse / (450 / (100 − str))`,
`StatChange(STRAMT, points·(carried − 50)/100)` (called even with 0). Integer divisions; `450 / (100 − x)` is 4 at 0,
450 at 99. Vehicles (not the heli): fuel `sBreathRed −= traverse·6` (min 0), `bBreath = (sBreathRed + 99) / 100`; empty
→ message, paths cleared (`Strategic_Movement.cc:3106-3118, 1163-1176`). ja2-node does not model fuel (gap
"Vehicles as characters").

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
ja2-node: the `TacticalWorldPort.addCorpsesToBloodcatLair` hook (unimplemented, §7.7; gap "Bloodcat lair corpses"). The
"arrived" message becomes the `groupArrived` event (`29`).

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
clear paths, select the sector, stop compression (`:3584-3608`). ja2-node: the prompt record is
`movement.groupPrompting`, answered by `answerNpcOfNotePrompt` (deviation "Strategic prompts"); the sector test is the
`TacticalWorldPort.npcOfNoteInSector` hook, which only has its default `false` (§7.7; gap "NPC-of-note test").

`CalculateNextMoveIntention(g)` (`:915-992`, enemy): if not between sectors, with waypoints, and standing on
`waypoint[nextId]`: ONE_WAY → stop at the last one, else `nextId++`; CIRCULAR → wrap to 0; ENDTOEND_FORWARDS → at the
end `nextId−−` and flip; BACKWARDS → at 0 `nextId++` and flip; then `InitiateGroupMovementToNextSector`.

### 3.11 Stops, teleports and retreat

- `SetGroupSectorValue(s, g)` (`:1878-1900`): remove waypoints, sector = next = s, not between, original = byte, delete
  the arrival event, members' sector = s and not between, `CheckAndHandleUnloadingOfCurrentWorld`. Used by squads, exit
  grids, the warp out of creature lairs.
- `SetGroupNextSectorValue` (`:1916-1924`), `PlaceGroupInSector(g, prev, next, check)` (`:3390-3399`: clear paths;
  `g.prev = prev`; sector = (prev.x, prev.y, next.z); next = next; `GroupArrivedAtSector(g, check, FALSE)`).
- `MoveAllGroupsInCurrentSectorToSector(s)` (`:2370-2386`) for scripted moves.
- `RetreatGroupToPreviousSector(g)` (`:2765-2827`, called by `19`): no previous sector (P16) →
  `CalculateGroupRetreatSector` (first of N, E, W, S that is not GROUNDBARRIER/EDGEOFWORLD; members' `prevSectorId`)
  (`:2720-2761`); `next = prev`; direction from the delta (else `runtime_error`); traverse = edge time, 0 → 5; arrival =
  now + traverse; between; `|= JUST_RETREATED_FROM_BATTLE`; post events; members between and removed from the tactical
  sector. No waypoints: the group stops in the previous sector.
- `ResetMovementForEnemyGroup(g)` (`:2938-2964`): an enemy group not between sectors → `RepollSAIGroup` (`17`);
  otherwise re-post its arrival at `now + traverse` (traverse > 400 → 90 first): it is now 0% along its edge.

### 3.12 Simultaneous arrivals (`:1447-1613`)

`HandleOtherGroupsArrivingSimultaneously(sector)` runs at the start of every battle check: scanning the queue from its
head while `timestamp ≤ now (seconds)`, every non-deleted `GROUP_ARRIVAL` whose group is between sectors with
`next == sector` is arrived at once with `GroupArrivedAtSector(it, FALSE, FALSE)`, flagged `ARRIVED_SIMULTANEOUSLY`,
counted, its event deleted, and the scan restarts. They join the battle (or are released after a non-combat
arrival, §3.9). The result depends on the queue's same-timestamp order (`15`).

`PossibleToCoordinateSimultaneousGroupArrivals(first)`: not if already APPROVED/CHECKED or the heli; count other player
groups between sectors heading to `first.sector`, not CHECKED, not the heli, marking them CHECKED; none → false;
otherwise pause, remember `first`, ask "Coordinate a simultaneous arrival?" (enemies or bloodcats),
`waitingForInput = true`, return true. Yes → `PrepareGroupsForSimultaneousArrival`: latest arrival among those groups;
each gets APPROVED, its event re-posted at that time (+ about-to-arrive), `DelayEnemyGroupsIfPathsCross`; the first
group is warped back (`next = sector, sector = prev`, between, same arrival, events). No →
`PrepareForPreBattleInterface(first, first)`. ja2-node: the prompt record is `encounter.simultaneousArrival`, answered
by `answerSimultaneousArrival`.

### 3.13 Underground

Players cannot plot routes underground (`ME_UNDERGROUND`); underground sectors are reached only tactically (exit grids
and the few underground edges, §5.9). Underground enemy and creature counts are static per node (`17`); no enemy group
moves underground. `UndergroundTacticalTraversalTime(dir)` is 0 if the loaded map has the entry point of that edge, else
impossible (`StrategicMap.cc:179-193`).

### 3.14 Group counting helpers

`PlayerMercsInSector(s)`: groups not between sectors at `s` (z included), members with life > 0; robots count, vehicles
not (`Strategic_Movement.cc:2193-2212`). `FindPlayerMovementGroupInSector(s)`, the PBI "involved group" test: size > 0,
not between, sector == s, **z == 0**, no in-transit/dead/POW member, not the airborne heli (`:2843-2860`). Enemy counts
(`Strategic/Queen_Command.cc:53-228`): `NumEnemiesInSector` = stationary (`SectorInfo`, ignores z) + `ubGroupSize` of
every non-vehicle enemy group whose `ubSector == s`, **including groups that departed `s` and are still between
sectors**; `NumHostilesInSector` adds creatures and handles z > 0 via the underground node;
`NumStationaryEnemiesInSector` is 0 without a garrison or for a ROADBLOCK composition; `NumMobileEnemiesInSector`
compares `ubGarrisonID` with `ROADBLOCK` (a composition id; a Strac/vanilla bug owned by `17`). ja2-node:
`forces/groups.ts`; the stationary counts come through `StrategicAiPort`.

### 3.15 Vehicles

`VEHICLETYPE {pMercPath, ubMovementGroup, ubVehicleType, sSector, pPassengers[10], fBetweenSectors, fDestroyed, fValid}`
(`Tactical/Vehicles.h`). `AddVehicleToList(sector, grid, type)` reuses the first invalid slot (garbage-collects
destroyed vehicles in other sectors first), takes `gubVehicleMovementGroups[slot]` as its group and sets the group's
mask from `vehicles.json`, sector/next, traverse = arrival = 0 (`Vehicles.cc:75-121`). The vehicle soldier
(`SOLDIER_VEHICLE`) is a member of its own group and of a squad. `AddSoldierToVehicle` (`:157-284`): an empty ground
vehicle first joins a unique squad and its group; the passenger leaves his squad (or his own group is removed), gets
assignment VEHICLE, joins the vehicle group; the first one is `SOLDIER_DRIVER`. Movement is the group's (mask CAR: roads
and towns only). Fuel in `sBreathRed` (10000 full); a gas can adds `status·50` (`Strategic_Movement.cc:3121-3150`).

ja2-node: `forces/vehicles.ts` and `economy/vehicle-assignment.ts` (`VehicleRecord.passengers`: ten slots, −1 empty;
when the last passenger leaves a ground vehicle, its soldier returns to the vehicle group with `ASSIGNMENT_EMPTY` and a
vehicle between sectors is put in its closest sector, `TeleportVehicleToItsClosestSector`; `soldierMustDriveVehicle` for
sleep and fatigue). A vehicle soldier exists only for vehicles imported from a native save (`VehicleRecord.soldierId`,
else −1), so a ground vehicle without one cannot be boarded; no condition or fuel (gaps "Vehicles as characters",
"Ground vehicles").

### 3.16 Helicopter

The heli is vehicle `iHelicopterVehicleId` with mask AIR (travel §3.5, route costs §3.2). Arrival runs
`HandleHeliEnteringSector` (`Strategic/Map_Screen_Helicopter.cc:199-295`) from `GroupArrivedAtSector` (§3.9); SAM fire,
Skyrider noticing enemies, the bill, hovering and landing are `25` §5; a destroyed helicopter skips the rest of the
arrival. `setArrivalTime` clamps the heli's arrival to `now + traverse` (`Strategic_Movement.cc:3401-3430`); the heli
never joins simultaneous arrivals. The clamp can only bite after a delay longer than the 10-minute edge, which the
queued-battle delay (3–5 minutes) never reaches, so ja2-node does not model it.

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
dialogue queue (`:905-910`). `NotifyPlayerOfInvasionByEnemyForces` (`Map_Screen_Interface.cc:3711-3740`) does nothing
for z > 0 or an enemy-controlled sector, shows a box (and then calls back) for SAM and town sectors, and only prints a
message for other sectors, with **no callback** (inferred unreachable: militia exist only in towns/SAM sectors).
ja2-node closes the informational boxes at once (`PreBattleNotice` on the hand-off, deviation "Strategic prompts"), so
`TriggerPrebattleInterface` runs immediately.

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

### 4.3 Encounter codes (`Strategic/PreBattle_Interface.h`)

| Code | Value | Set by |
|---|---|---|
| `NO_ENCOUNTER_CODE` | 0 | battle check start, bloodcat test |
| `ENEMY_INVASION_CODE` | 1 | `19` (enemy group into a town/SAM sector); `HandlePotentialBringUpAutoresolveToFinishBattle` |
| `ENEMY_ENCOUNTER_CODE` | 2 | `19` (player meets mobile enemies) |
| `ENEMY_AMBUSH_CODE` | 3 | `19` (90% with high potential; outnumbered rules) |
| `ENTERING_ENEMY_SECTOR_CODE` | 4 | `19` (stationary enemies); `CalculateNonPersistantPBIInfo` after a tactical traversal (`PreBattle_Interface.cc:1147-1198`); game start in an enemy sector (`Map_Screen_Interface.cc:3648-3656`) |
| `CREATURE_ATTACK_CODE` | 5 | `17`/`19` |
| `BLOODCAT_AMBUSH_CODE`, `ENTERING_BLOODCAT_LAIR_CODE` | 6, 7 | §4.2 |
| `FIGHTING_CREATURES_CODE`, `HOSTILE_CIVILIANS_CODE`, `HOSTILE_BLOODCATS_CODE` | 8–10 | explicit code only (`19`) |

Effects in this doc: `ENEMY_AMBUSH`/`BLOODCAT_AMBUSH` place every non-civilian soldier entering the sector at the map
centre (`INSERTION_CODE_GRIDNO` = `sCenterGridNo`) while the battle locator is shown (`StrategicMap.cc:955-965`), and
deny the placement GUI (§5.8).

### 4.4 `PrepareForPreBattleInterface(dialogGroup, battleGroup)` (`:608-694`) — the hand-off

Candidates: members of `dialogGroup` with life ≥ OKLIFE, not mechanical, not EPC. Music → enemy present. If
`(tacticalTraversal && battleGroup == traversal group)` or `battleGroup` is an enemy group in the loaded surface sector,
with candidates: `JUST_RETREATED` → `cantRetreatInPBI`; `chosen = candidates[Random(n)]`; traversal → remember `chosen`
(he says "enemy presence" after the load, §5.9); else the chosen merc's quote, after which the face triggers
`InitPreBattleInterface(battleGroup, true)`; pause; `fDisableMapInterfaceDueToBattle` unless traversal; return.
Otherwise, with candidates: same `cantRetreat` rule, `Random(n)` merc quote → PBI, pause, disable map; without
candidates: `InitPreBattleInterface(battleGroup, true)` at once. Everything from `InitPreBattleInterface` on (persistent
PBI, encounter-code refinement, autoresolve, "go to sector", retreat) is `19`'s; `InitPreBattleInterface` returns early
for a tactical traversal of that group or underground (`PreBattle_Interface.cc:205-208`). The `Random(n)` speaker is
cosmetic (quote only; for a traversal, who speaks after loading).

ja2-node writes the hand-off record `encounter.preBattle` (`PreBattleHandoff`: groups, sector, code, notice, the speaker
candidates instead of a `Random(n)` draw, deviation "Cosmetic draws in strategic movement"); the PBI (`19`) clears it
and `movement.disableMapInterfaceDueToBattle`, as closing the PBI does.

### 4.5 Enemy groups arriving at player sectors

An enemy group's arrival runs the same check: a player group present (alive member) or militia → battle; only
unconscious mercs → instant autoresolve flow (`delayAutoResolveStart`, persistent PBI, `19`); nobody → no battle,
`HandleNonCombatGroupArrival` → `StrategicAILookForAdjacentGroups` and `CalculateNextMoveIntention` (`17`). Taking an
empty player sector is `17`'s (`SetThisSectorAsEnemyControlled`, §6.1).

### 4.6 Reinforcements into the loaded battle

`HandleArrivalOfReinforcements(g)` (`:2253-2290`): player group → insertion code from `ubSector` vs `ubPrev` (as §3.9;
same sector → `logic_error`), each member `UpdateMercInSector(s, (x,y,0))`, the first says "reached destination", a
message. Enemy group → `gfPendingEnemies = true`, `ResetMortarsOnTeamCount`, `AddPossiblePendingEnemiesToBattle`; that
function and `AddEnemiesToBattle` (`Queen_Command.cc:914-1047`) are `17` §10.4. ja2-node: the enemy side goes through
`TacticalWorldPort.enemyReinforcementsArrived` to `SectorFlow.addPossiblePendingEnemiesToBattle`.

---

## 5. Sector transitions and persistence

### 5.1 Ways into tactical

| Path | Gate | Calls |
|---|---|---|
| Map screen "go to tactical" on the selected sector | `AllowedToExitFromMapscreenTo(TACTICAL)` (`Strategic/Map_Screen_Interface_Bottom.cc:985-1070`): not already leaving, dialogue queue empty, no meanwhile, pause not locked, no held item/boxes, no battle roster; if `INCOMBAT` or `fEnemyInSector` or a bloodcat ambush is on, only the loaded sector; `CanGoToTacticalInSector` (a living, non-vehicle, not in transit/POW/dead, not airborne, not moving merc there, `StrategicMap.cc:2269-2293`) | `SetCurrentWorldSector(sSelMap)` |
| PBI "enter sector" | `19`; first time with a player battle group and no ambush/creatures/bloodcats → `gfEnterTacticalPlacementGUI` (`PreBattle_Interface.cc:1007-1041`) | `SetCurrentWorldSector(pbSector)` |
| Tactical traversal (edge or exit grid) | §5.9 | `SetCurrentWorldSector(adjacent)` |
| New game start | `HandleTimeCompressWithTeamJackedInAndGearedToGo` (`Map_Screen_Interface.cc:3621-3660`) | start sector; enemies there → locator + `ENTERING_ENEMY_SECTOR_CODE` |
| Savegame load | `14`, `15` | `SetCurrentWorldSector(save sector)` with `LOADING_SAVED_GAME` |

The original lets the player open the map screen from tactical at any time without unloading: a view switch, not a
simulation step (deviation "Map and tactical screens"; clock rules: `15`). ja2-node's gate is
`SectorFlow.enterSectorRefusal` (`canGoToTacticalInSector`); the UI-only gates do not exist.

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
if !loading: InitAI(); ExamineDoorsOnEnteringSector()             // never fires: compares with the stamp set above
UpdateDoorGraphicsFromStatus(); SetSectorFlag(s, SF_ALREADY_LOADED); HandleHelicopterOnGround(true)
if !loading: music; HandleRPCDescriptionOfSector (docs/24 §8.6; Random(5)); SetSectorFlag(s, SF_HAS_ENTERED_TACTICAL);
             fHasEnteredCombatModeSinceEntering = false; fDontAddNewCrows = false;
             sCreatureTenseQuoteDelay = 10 + Random(20); z ≥ 2 and a mine warp exists → IN_CREATURE_LAIR else clear;
             ubNumCrowsPossible = 5 + Random(5)
```

`ExamineDoorsOnEnteringSector` (`Tactical/Keys.cc:1242-1263`) returns when
`GetWorldTotalMin() − uiTimeSinceLastInTactical < 30`, and `SetCurrentWorldSector` sets that stamp at `:499`, ten lines
before the call at `:509`: the doors are never closed (vanilla `V: Strategic/StrategicMap.c:877,904` too). ja2-node
(`SectorFlow.setCurrentWorldSector(sector, {autoPlacement, battleLocatorShown})`) runs this order with the sector diff,
without `ExamineDoorsOnEnteringSector` (same result); the cosmetic `Random(20)` and `Random(5)` are drawn from `main`
and discarded, keeping the draw order; there is no `IN_CREATURE_LAIR` state (gap "Creature quest scripting").

### 5.3 `EnterSector(s)` (`StrategicMap.cc:837-906`)

Pause; if a world was loaded, `SetupProfileInsertionDataForCivilians` (profiled civilians' positions into their
profiles, `:3137-3204`); unless loading, `HandleQuestCodeOnSectorEntry(s)` (`35` §2.5; it also places head miners with
`Random(4)` loops and may roll `Random(10 + militia) < 3` for Kingpin's assassin, `:669-799`); load screen;
`RemoveMercsInSector` (our soldiers off their gridnos); `SF_ALREADY_VISITED` unless in meanwhile; `LoadWorld(map file)`
(`07`, incl. exit grids and edgepoints §5.7); unless loading a save, `LoadCurrentSectorsInformationFromTempItemsFile`
(§5.4; a failure is the "file hack" exit); then either the placement GUI (§5.8) or `PrepareLoadedSector` (§5.5).

### 5.4 `LoadCurrentSectorsInformationFromTempItemsFile` (`Tactical/Tactical_Save.cc:432-514`)

Meanwhile: nothing (interrogation loads items only). Otherwise, by the sector's flags, in this order: items (§5.11),
rotting corpses, map modifications, door table, revealed status, door status, preserved enemies (§5.12), preserved
civilians, smoke effects, light effects; `InitLoadedWorld()` (movement costs recompiled);
`guiTimeCurrentSectorWasLastLoaded = sector.uiTimeCurrentSectorWasLastLoaded`;
`StripEnemyDetailedPlacementsIfSectorWasPlayerLiberated` (§5.13).

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
  AddProfilesUsingProfileInsertionData(); PostSchedules()                          // docs/35 §2.6, §3.2
CallAvailableTeamEnemiesToAmbush(sCenterGridNo)                   // ambush codes only: CallAvailableEnemiesTo(centre),
                                                                  // a public noise at the centre (TacticalAI/Knowledge.cc:48-60)
if !loading: UnPauseGame
gpBattleGroup = null
if tacticalTraversal.active: CalculateNonPersistantPBIInfo()      // §4.3
AllTeamsLookForAll(TRUE)
```

### 5.6 Placing our soldiers: `UpdateMercsInSector` / `UpdateMercInSector` (`StrategicMap.cc:909-1179`)

`UpdateMercsInSector`: clears interface slots; `BeginMapEdgepointSearch` if edgepoints are used for entry (§5.7); for
every soldier id 0..155 (skipping enemy/creature ids just restored from the temp file): `RemoveMercSlot`,
`bInSector = false`; active, in this sector, not between sectors → (not loading: ambush codes and locator → centre
gridno; `gfOverrideInsertionWithExitGrid` → the exit grid's gridno) → `UpdateMercInSector`; POWs found here join one new
squad (message instead in I13) and end the Alma quest. `EndMapEdgepointSearch`.

`UpdateMercInSector(s, sector)`: inactive or in transit → nothing; profile with a permanent insertion code → orders
STATIONARY; an EDGEINDEX code without an active edgepoint search falls back to `insertionData` (the saved plain code);
then:

| Code | Gridno |
|---|---|
| `NORTH 0, SOUTH 1, EAST 2, WEST 3, CENTER 9` | `gMapInformation.sNorth/South/East/West/CenterGridNo`; −1 → first existing of N, E, S, W, centre (log), none → map centre |
| `GRIDNO 4` | `insertionData` |
| `PRIMARY_EDGEINDEX 7`, `SECONDARY_EDGEINDEX 8` | `SearchForClosest{Primary,Secondary}MapEdgepoint(pendingActionData2, insertionData)`; NOWHERE → code = data, retry |
| `ARRIVING_GAME 5` | start sector loaded → 4379, else code NORTH, north gridno |
| `CHOPPER 6` | `AddMercToHeli` (arrival by helicopter, `21`), return |
| other | map centre `80·160 + 80` |

Then `sInsertionGridNo = g` and `AddSoldierToSector(s)` (`Tactical/Soldier_Add.cc:683-785`): merc slot (or away slot if
off-map), `bInSector`; drivers/passengers stop here; creatures use the struct-data sweet spot (radius 7); vehicles the
struct-data spot trying their insertion direction first (radius 12); everyone else
`FindGridNoFromSweetSpot(insertion, 7)` (NOWHERE → the insertion gridno) facing **toward `CENTER_GRIDNO`** unless
`ubInsertionDirection ≥ 100` (then `direction − 100`) or `bUseExitGridForReentryDirection` (face away from the nearest
exit grid within 10). The strategic `ubInsertionDirection` < 100 set on arrival is therefore ignored for people.
Placement (`:861-980`): position, facing, `RevealRoofsAndItems` and stop for our team, `ARRIVING_GAME` walks in from the
north sweet spot, enemy presence flag for hostiles (not bloodcats), roof check, stand (or lie down if life < OKLIFE,
sleep if asleep, patient/doctor/repair poses). ja2-node: `updateMercInSector` and `addSoldierToSector`
(`src/sim/tactical/insertion.ts`), both tables and the facing rules; `SectorFlow.updateMercsInSector` runs the loop over
the roster.

### 5.7 Map edgepoints (`TileEngine/Map_Edgepoints.cc`)

Two classes per side N, E, S, W: primary (`gps1st*`, reachable from the main area) and secondary (`gps2nd*`, isolated
areas, e.g. parts of Grumm and Alma), each a gridno list with a `middle` index (start of the inner row). Maps with the
`MAP_EDGEPOINTS_SAVED` flag and version ≥ 22 load them (`LoadMapEdgepoints`, `:802-831`, parsed by
`src/content/formats/map.ts`); otherwise `LoadWorld` compiles movement costs and calls `GenerateMapEdgepoints` after
`InitLoadedWorld` (`TileEngine/WorldDef.cc:2391-2443`): a reachability flood from the first existing entry point (N, E,
S, W, centre); for each side with an entry point, two diagonal rows along the visible-map edge from the corner constants
(§1.8), keeping reachable tiles that are outdoors or in a basement (`:315-760`); then validation and classification
(`:84-312`, ported literally; the generated lists match the oracle, §7.6; neighbouring points must reach each other
within `EDGE_OF_MAP_SEARCH` 5 tiles, 250 on I14, a "special case map", `EdgepointsClose`, `:1110-1137`). Stub maps have
no saved edgepoints, so they always run the generator.

- `ChooseMapEdgepoint(code)`: a primary point by `Random(size)` (`:862-874`).
- `ChooseMapEdgepoints(info, code, n)` (`:877-928`): primary list without MED/DEEP water tiles; `n ≥ size` → all; else
  selection sampling in list order (`Random(slots) < remaining`).
- `BeginMapEdgepointSearch` (20 reservations, `GlobalReachableTest` from the first entry point) /
  `SearchClosestMapEdgepoint(g, list)` (`:931-1060`): the seed itself if listed and unreserved; else a square spiral of
  radius 1.. (< 10 on the surface, < 30 underground) starting top-left and going down, right, up, left: the first
  unreserved listed gridno, reserved on success.
- `CalcMapEdgepointClassInsertionCode(g)` (`:1141-1227`): no isolated gridno → PRIMARY; else nearest point of each class
  on the exit side (`gubTacticalDirection`) by Pythagorean distance, path tests with a fake enemy-team soldier (distance
  limit 15, `:1203`); equal validity → the closer class (ties primary); else the valid one. It runs on the **old** map,
  before the next sector loads.

ja2-node: `src/sim/tactical/edgepoints.ts`, one function per original function.

### 5.8 Tactical placement GUI

Entering from the PBI for the first time (`gfEnterTacticalPlacementGUI`) shows the overhead map and lets the player put
mercs on their entry edge (`TileEngine/Tactical_Placement_GUI.cc`). "Auto place" is `ChooseRandomEdgepoints`: per
non-vehicle merc `ChooseMapEdgepoint(code)` → `INSERTION_CODE_GRIDNO`, else keep the code (`:545-571`); manual placement
uses `SearchForClosestPrimaryMapEdgepoint`. Done → `KillTacticalPlacementGUI` → `PrepareLoadedSector` (`:491-539`).
ja2-node has no placement GUI: `setCurrentWorldSector(sector, {autoPlacement: true})` runs the automatic start
(deviation "Tactical placement").

### 5.9 Leaving a sector from tactical

**Trigger.** In move mode, the cursor at a scrolled-to screen edge checks `OKForSectorExit(dir)`; a second click on the
confirm cursor opens the exit menu; an exit grid tile under the cursor does the same with `DIRECTION_EXITGRID` (255)
(`Tactical/Handle_UI.cc:670-806`, `Tactical/Turn_Based_Input.cc:2575-2665`). Below creature lairs (z ≥ 2) after the
creature quest, a Yes/No box offers a warp to the surface (`InitSectorExitMenu`,
`Tactical/Strategic_Exit_GUI.cc:436-453`; the warp sets every living in-sector merc's group to the warp sector with
`INSERTION_CODE_GRIDNO` and facing 100+NW and loads it, `:384-418`); ja2-node does not offer the warp (§7.7).

**`SoldierOKForSectorExit(s, dir, grid)`** (`StrategicMap.cc:1945-2032`): on the map, on the ground; edges compare the
soldier's absolute screen position (`GetAbsoluteScreenXYFromMapPos`, `TileEngine/Isometric_Utils.cc:209-232`) with the
render bounds (`InitRenderParams`, `TileEngine/RenderWorld.cc:2114-2150`); with cell `cx = (g % 160)·10`,
`cy = (g / 160)·10` and the constant render centre (`RenderWorld.h:88-93`):

```
absX = 2·(cx − 800) − 2·(cy − 800) − leftX        absY = (cx − 800) + (cy − 800) + 1625 − topY
default map (restricted scroll 0): leftX −1580, topY 860, width 3180, height 1540
basement (restricted scroll 1):    leftX −640,  topY 1330, width 1280, height 590      (derived from InitRenderParams)
EAST: absX ≥ width − 160   WEST: absX ≤ 160   SOUTH: absY ≥ height − 200   NORTH: absY ≤ 200
exit grid: (real time: movement mode from stance) FindGridNoFromSweetSpotCloseToExitGrid(s, grid, 10) != NOWHERE,
           in combat also EnoughPoints(PlotPath AP cost)
```

**`OKForSectorExit(dir, grid, &minutes)`** (`:2035-2222`) returns 0, 1 (only the selected merc may go) or 2 (the whole
squad). It needs a selected merc. For every controllable merc of the current squad: EPCs counted (an uncontrolled robot
sets a flag and is skipped), mercs counted; near the edge → `atLeast++` (and "selected is one of them"); not near and an
edge → the traversal time (surface: edge time; **z > 1** underground: entry-point test; z == 1 stays impossible); an
impossible edge returns 0 with `gfInvalidTraversal`. Then, if anyone may go and fewer than the whole squad: selected EPC
with `atLeast < squad || atLeast == 1` → lone-EPC refusal; one merc with EPCs and not everybody → "can't abandon EPCs".
Edge time (z > 0 uses the entry-point test) impossible → 0; result 1 if the selected merc is near, 2 if
`atLeast == squad count`. Exit grids report 0 minutes.

**Exit menu → jump code** (`Strategic_Exit_GUI.cc:119-376, 685-805`), as a decision table:

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

Wilderness edges (> 5 min) therefore always use NO_LOAD: the group travels strategically and the world unloads when
nobody is left (§5.10); towns, underground edges and exit grids may load the next sector at once. ja2-node:
`okForSectorExit`, `exitMenu`, `jumpCodeOf` (`campaign/sector-exits.ts`) evaluate both tables for the `exitSector`
command, which refuses a combination the menu would not allow (deviation "Exit dialog", `29`).

**`JumpIntoAdjacentSector(dir, code, grid)`** (`:1379-1572`): ALL → the first controllable merc of the current squad
(his group); SINGLE → the selected merc, `HandleSoldierLeavingSectorByThemSelf` (NO_LOAD) or `AddCharacterToUniqueSquad`
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
codes reset) → clear `DISALLOW_SIGHT`, then `AllMercsHaveWalkedOffSector` or `AllMercsWalkedToExitGrid`. ja2-node: the
2500 ms are game milliseconds (deviation "Waiting for mercs to exit"); tactical commands are refused while
`TacticalState.mercsWaiting` runs, as `LU_BEGINUILOCK` does.

**`AllMercsHaveWalkedOffSector()`** (`:1751-1846`):

```
enemies = NumEnemiesInAnySector(world) > 0
if enemies: HandleLoyaltyImplicationsOfMercRetreat(TACTICAL_TRAVERSAL, world) (docs/18); ClearAIExposedTileMap
if minutes ≤ 5: tacticalTraversal = {true, group}; target.z > 0 → undergroundTacticalTraversal = true
ClearMercPathsAndWaypointsForAllInGroup(group); AddWaypointToPGroup(group, target)      // departs, §3.6
target.z > 0 && minutes ≤ 5 → undergroundTacticalTraversal = true (again; never cleared, §8.1)
SetupTacticalTraversalInformation()
NO_LOAD: RemoveSoldierFromTacticalSector for members; default squad
LOAD:  enemies → ResetMovementForEnemyGroupsInLocation; minutes > 5 → WarpGameTime(300 s, no events)
       minutes ≤ 5 → WarpGameTime to the start of minute now+5 (surface) / now+1 (underground), processing target-time
                     events first (docs/15): the group's arrival fires inside the warp; fade → DoneFadeOutAdjacentSector
       else → map screen
```

`SetupTacticalTraversalInformation` (`:1693-1745`), per member: insertion code from the direction (N→SOUTH, S→NORTH,
E→WEST, W→EAST; exit grid → `GRIDNO` + its gridno + face-away flag, `:1272-1299`);
`PlotPathForCharacter(s, target, true)`; if ≤ 5 min: mirror gridno (absolute screen coordinate of his tile with Y :=
1520 / 0 or X := 0 / 3160 for N / S / E / W, back to a gridno), `pendingActionData2 = mirror`, `insertionData = code`,
`code = CalcMapEdgepointClassInsertionCode(preTraversalGridNo)`, LOAD → edgepoint entry on. NO_LOAD clears the traversal
state.

**`DoneFadeOutAdjacentSector`** (`:1869-1942`): `SetCurrentWorldSector(target)` (arrival already processed), the chosen
merc's "enemy presence" quote if `fEnemyInSector`, traversal state cleared; caves set `IGNORE_ALL_OBSTACLES`; each
member on the map: `PickGridNoToWalkIn(s, code, &attempts)` (`:2597-2868`: zigzag from his placed tile out to the edge,
then up to 200 attempts alternating along the edge; NOWHERE after 200 → his own tile) → placed there, walks back to his
placed tile, wait code 1; `WAIT_FOR_MERCS_TO_WALKON_SCREEN` (again `DISALLOW_SIGHT` until done or 2.5 s).

**`AllMercsWalkedToExitGrid()`** (`:1618-1690`): `HandlePotentialMoraleHitForSkimmingSectors`: enemies here and combat
never entered since loading → `GROUPFLAG_HIGH_POTENTIAL_FOR_AMBUSH` on the group (`:3207-3224`; only this path sets it).
NO_LOAD → insertion data, removed from the sector, `SetGroupSectorValue(target)` (teleport, no travel time), default
squad. LOAD → traversal flag on; members below OKLIFE are moved to unique squads (left behind); insertion data;
`SetGroupSectorValue(target)`; fade → `DoneFadeOutExitGridSector` (`SetCurrentWorldSector`, quote, clear). Then, if no
mercs are in the **target** sector, `HandleLoyaltyImplicationsOfMercRetreat(…, target)` (`18`; the argument looks wrong
but is literal).

ja2-node: the strategic half in `campaign/sector-exits.ts`, the tactical half (render bounds for both scroll modes,
walk-off, walk-in, mirror gridno, the merc wait) in `src/sim/tactical/sector-exit.ts`. Fleeing AI soldiers leave the map
the same way (`handleAITacticalTraversal`, `src/sim/tactical/ai/control.ts`).

### 5.10 Unloading

`CheckAndHandleUnloadingOfCurrentWorld()` (`StrategicMap.cc:3003-3129`) runs whenever mercs leave (departure,
`SetGroupSectorValue`, autoresolve): no world → false; game just started in the start sector → false; autoresolve screen
in the battle sector → our living combatants there are taken off the map; otherwise any living, non-mechanical, non-EPC
merc still in the loaded sector → false; enemies and friendly militia left alone → autoresolve takes over (`19`) →
false. Then `CheckForEndOfCombatMode(FALSE)`, `EndTacticalBattleForEnemy` (in-battle counters zeroed for the sector and
its enemy groups, profiled enemy flag cleared, "abandoned militia" loyalty event if militia and hostiles are still
standing, `Queen_Command.cc:241-289`), ambients off; in tactical: traversal → false (the next load trashes), else go to
the map screen; `HandleDefiniteUnloadingOfWorld(ABOUT_TO_TRASH_WORLD)`; `TrashWorld()`; flags cleared; world invalid.

`HandleDefiniteUnloadingOfWorld(code)` (`:2902-2953`): clear the tactical event queue, bullets, physics objects, timed
bombs; `HandleQuestCodeOnSectorExit` (Kingpin money, Conrad, hospital supplies, museum alarm fact); not loading: enemy
flag and `INCOMBAT` off; new map: `SaveCurrentSectorsInformationToTempItemFile` (§5.11) and
`UpdateSoldierPointerDataIntoProfile`; trash: save temp files, `SetupProfileInsertionDataForCivilians`, locator off;
both: `HandleMilitiaStatusInCurrentMapBeforeLoadingNewMap` (`18`).

`TrashWorld` (`TileEngine/WorldDef.cc:2507-`): world items, smoke and light effects decayed and reset, **every
non-player soldier removed** (`TacticalRemoveSoldier`), our soldiers only lose their level node, corpses, tile
animations, both soldier init lists, schedules. Our mercs keep their records (sector, inventory, life…) in the roster
(§7.2).

### 5.11 What is saved per sector (temp files → `SectorDiff`)

`SaveCurrentSectorsInformationToTempItemFile` (`Tactical_Save.cc:278-319`), skipped once after a meanwhile:
`SaveBloodSmellAndRevealedStatesFromMapToTempFile` (blood/smell records into `m_`, revealed bits), reachability of
items, then in order: items `i_`, corpses `r_`, door table `d_`, revealed `v_`, door status `ds_`, enemies `e_`,
civilians `c_`, smoke `sm_`, lights `l_`, NPC data into profiles (only while saving a game),
`uiTimeCurrentSectorWasLastLoaded = nowMin` (`:517-533`). Names `<prefix>_<map file name without _a>` (`:1003-1025`);
framing in `14` §5. ja2-node keeps one `SectorDiff` per sector in the campaign state instead (§7.2, deviation "Sector
temp files").

| Diff | Native | Content | Restore |
|---|---|---|---|
| items | `i_`, `u32 n` × 52-byte `WORLDITEM` | all world items incl. non-existing slots | `SF_ALREADY_LOADED` → map items trashed first; else added to the map's; `GRIDNO_NOT_SET_USE_ENTRY_POINT` → centre gridno; `FIND_SWEETSPOT_FROM_GRIDNO` → nearest free within 5, then 15 (`:556-594`; ja2-node does not resolve the sweet-spot flags) |
| corpses | `r_`, `u32 n` × 160 | `ROTTING_CORPSE_DEFINITION` incl. time of death | `RemoveCorpses`; sweet spot / entry-point flags; skip invalid gridno; in a town, not loading a save, indoors and dead ≥ 30 min → dropped; `AddRottingCorpse` rots and drops by age (§5.14); `HandleRottingCorpses` (`:624-693`) |
| map changes | `m_`, 8-byte `MODIFY_MAP` (`TileEngine/SaveLoadMap.h`) | `SLM_LAND…ONROOF` add/remove graphics, `BLOOD_SMELL`, `DAMAGED_STRUCT`, `EXIT_GRIDS`, `OPENABLE_STRUCT`, `WINDOW_HIT` | `LoadAllMapChangesFromMapTempFileAndApplyThem`; ja2-node stores structure records (`tactical/map-changes.ts`) |
| blood and smell | `m_`, `SLM_BLOOD_SMELL` records: every tile with `ubBloodInfo` or `ubSmellInfo` | the tile's blood and smell bytes (ja2-node `bloodSmell [{gridNo, blood, smell}]`) | `AddBloodOrSmellFromMapTempFileToMap`: the blood byte, then with blood and gore on the tile's pool redrawn at its present strength (the type is read before the smell byte, `14` §10), then the smell byte; the records are consumed and written again when the sector is left, with `SF_MAP_MODIFICATIONS_TEMP_FILE_EXISTS` |
| door table | `d_`, `u8 n` × 14 | locks, traps, lock damage, perceived state | replaces the map's |
| revealed | `v_`, 3200 bytes (bit per gridno) | `MAPELEMENT_REVEALED` | `SetMapRevealedStatus` (`TileEngine/SaveLoadMap.cc:411-467`); ja2-node also keeps the room-hidden bits |
| door status | `ds_`, `u8 n` × 4 | open/closed, perceived | then `UpdateDoorGraphicsFromStatus` |
| enemies / civilians | `e_` / `c_` | §5.12 | §5.12 |
| smoke / lights | `sm_` / `l_` | effect records (`12`) | restored as saved and re-spread; aging continues by world time |

Writers into **unloaded** sectors (used by `18`, `19`, `25`): `AddItemsToUnLoadedSector` (first non-existing slot or
append, NOWHERE → entry-point flag, `:228-267`), `AddWorldItemsToUnLoadedSector`,
`AddRottingCorpseToUnloadedSectorsRottingCorpseFile` (`:748-770`), `AddDeadSoldierToUnLoadedSector` (`:834-912`:
non-player inventory slots each `Random(100) < 75` → kept undroppable, else dropped (ammo reduced), keys, corpse with
`Random(4)` death animation), `ChangeStatusOfOpenableStructInUnloadedSector`, `AddStructToUnLoadedMapTempFile`. Each
updates `uiNumberOfWorldItemsInTempFileThatCanBeSeenByPlayer` (visible, map-inventory-visible items × count,
`:1031-1112`). ja2-node: `addItemsToUnloadedSector`, `addDeadSoldierToUnloadedSector` (`campaign/sector-loot.ts`),
`changeOpenableInUnloadedSector` (`campaign/sector-diff.ts`).

`HandleAllReachAbleItemsInTheSector` (`:322-410`): flood from the centre (else N, E, S, W) entry point, plus the
isolated gridno if any living merc there can path to it. An item is reachable unless trapped, owned (`OWNERSHIP` item at
the tile) or the chalice, and if its tile is reachable, it is on a roof, or one of the 4 side neighbours is reachable
with a non-wall, non-door movement cost toward it. Theft (`18`) only takes visible reachable items. ja2-node:
`handleAllReachableItemsInTheSector` (`tactical/item-reachability.ts`), run when the sector is left.

### 5.12 Preserved enemies and civilians (`Tactical/Enemy_Soldier_Save.cc`)

**Save** (`NewWayOfSavingEnemyAndCivliansToTempFile`, `:431-615`), separately for enemy+creature ids and civilian ids:
active, alive, unprofiled soldiers with an init-list node (on or off map) are counted; each upgrades its node to a
detailed placement holding his current stats, life, morale, orders, attitude, body, civilian group, schedule, keys,
sector, class, team, facing, name, patrol points, palettes and **inventory**; the start position is **current
(`PreRandom(2)` ≠ 0) or the placement's original** (gridno and roof). None → file and flag removed. Header `i16 y`,
init-list links (`u8 n` × {node id, soldier id}), `i16 x`, `i32 slots` (0 while saving a game: only links),
`u32 minute`, `i8 z`, then per soldier the `SOLDIERCREATE_STRUCT` record (`InjectSoldierCreateIntoFile`) + `u16`
checksum (`CalcSoldierCreateCheckSum`), then the sector byte id. ja2-node: `preserveSoldiers`
(`campaign/sector-diff.ts`) keeps `{savedMinute, links, records}` without checksums.

**Load enemies** (`:34-271`): not loading a save → count classes in the file and compare with the sector's
**stationary** counts (`SectorInfo` elites/troops/admins/creatures; underground nodes are not read here, so any
non-empty underground file mismatches); any difference deletes the file (the normal placement follows). Then
`gfRestoringEnemySoldiersFromTempFile`; header checks (mismatch → exception → "file hack" exit); **older than 300
minutes → delete and place normally**; 0 slots → done. Clear `fPriorityExistance` on every enemy/creature node; for each
saved record take the first non-priority node of the same team, mark it priority, copy the record into its detailed
placement and the basic fields (start gridno only if valid), verify the checksum, count the class. Then strategic totals
(`GetNumberOfEnemiesInSector`, stationary + mobile) above the restored counts are added with
`AddSoldierInitListEnemyDefenceSoldiers(extra)` at once, during the temp-file load, before our mercs are placed.
`PrepareEnemyForSectorBattle` later creates the restored nodes through the same function (priority + detailed
first, §5.13). Since the file is accepted only when it matches the stationary counts, `extra` is exactly the mobile
groups' strength, and `PrepareEnemyForSectorBattle` then adds those groups' not-yet-in-battle soldiers again (the load
did not raise its in-battle counters): mobile enemies that arrived after the player left appear twice (inferred from the
code paths, §8.3).

**Load civilians** (`:274-425`): no age limit; same node matching but skipping profiled detailed nodes; life below max
gains `minutes / 15` (4 per hour) up to max; afterwards every non-priority, unprofiled node of the **last record's
team** is deleted from the list (dead or departed civilians stay gone). ja2-node: `applyPreservedEnemyRecord`,
`loadPreservedCivilians` (`campaign/sector-diff.ts`), driven by `SectorFlow`.

### 5.13 Enemies from strategic counts (tactical side)

`PrepareEnemyForSectorBattle()` (`Queen_Command.cc:308-527`) is `17` §10.1: underground nodes place their full counts;
an enemy battle group enters as reinforcements (§4.6); otherwise the stationary counts not yet in battle (with the
`32 − admins + troops` elite clamp) plus every enemy group in the sector, in list order, up to 32 slots (overflow →
`gfPendingEnemies`), go through `AddSoldierInitListEnemyDefenceSoldiers` below; the groups' ids are then handed to
group-less enemy soldiers by class in id order. On the way it calls `RemoveGroupWaypoints` on every player group in the
sector that is not between sectors: **a battle destroys the player's route there.**

`SortSoldierInitList()` (`Tactical/Soldier_Init_List.cc:250-409`): (1) from the tail backwards, nodes with a soldier
(other than the tail) move to the tail; (2) forward, nodes without soldier, non-priority, detailed, other than the head,
move to the head; (3) same for priority without detailed; (4) same for priority with detailed. Moving to the head while
scanning forward **reverses** each class: final order = [priority+detailed reversed] [priority-only reversed]
[detailed-only reversed] [basic, map order] [existing soldiers]. (The head node of a pass is never moved, which keeps
the reversal consistent.) ja2-node: `sortSoldierInitList` (`src/sim/strategic/ai/defence-placement.ts`).

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

The PD pass's every-other-node walk is Strac's (vanilla visits every node, `V: Tactical/SoldierInitList.c:788-807`);
ja2-node keeps it and guards against the list end (deviation "Strategic AI PD placement pass"). The decision logic is
`addSoldierInitListEnemyDefenceSoldiers` in `strategic/ai/defence-placement.ts` over placement nodes with an injected
roll source, wrapped by `tactical/init-list.ts`.

`AddPlacementToWorld(node)` (`:412-568`): a profiled detailed placement only if that profile is in this sector, not
recruited/escorted, alive and not using profile insertion; ice-cream truck rule; detailed → static detailed placement,
else `CreateDetailedPlacementGivenBasicPlacementInfo` (ja2-node `src/sim/tactical/creation.ts`); civilian quest
overrides (Kingpin C5 with `PreRandom(3)` orders and `uniform_int_distribution` grid offsets, the Queen's palace P3,
liberated Tixa, freed kids C13); elite enemies may become Mike or Iggy (`OkayToUpgradeEliteToSpecialProfiledEnemy`,
`35` §2.6); `TacticalCreateSoldier`; `AddSoldierToSectorNoCalculateDirection` (keeps the placement facing). Others:
`AddSoldierInitListTeamToWorld(team)`: sort; the caves tileset turns undetailed civilians into miners; then nodes in
order until the first node with a soldier, stopping at the first failure except for civilians (`:571-613`). Militia
(`:1028-1260`, rules owned by `18`): enemy/militia placements are reused, orders STATIONARY, `Random(MAXATTITUDES)`
attitude, detailed data deleted with `RandomizeRelativeLevel` twice; the loop also stops at the first node with a
soldier. Bloodcats (`:1495-1628`): placements recounted on first load when no spawn entry exists (mismatch resets
`bBloodCats` to −1); `bBloodCats` cats: priority bloodcat nodes first, then selection sampling.
`StripEnemyDetailedPlacementsIfSectorWasPlayerLiberated` (`:1786-1820`): on the surface, once
`uiTimeLastPlayerLiberated != 0`, every enemy detailed placement becomes basic (priority off, random body,
`RandomizeRelativeLevel` ×2): tanks and special enemies never return. `EvaluateDeathEffectsToSoldierInitList`
(`:1460-1468`): a killed non-militia soldier's detailed placement is deleted. ja2-node: `tactical/init-list.ts`, one
function per original function; creature and bloodcat bodies and their placement are `17` §12.3.

### 5.14 Time passing while away

| What | Rule |
|---|---|
| Corpses | `AddRottingCorpse` (not loading): older than 1 day (1440 min) and a fresh merc type (`≤ FMERC_FALLF`) → `ROTTING_STAGE2`; older than 3 days → not added (`Tactical/Rotting_Corpses.cc:51-52, 446-459`); town, indoors, ≥ 30 min → not added (§5.11). ja2-node ages them when the sector loads (`agedCorpse`), with no rotting while loaded (gap "Corpses") |
| Preserved enemies | discarded after 300 min or on a stationary count change (§5.12) |
| Civilians | +1 life per 15 min (§5.12) |
| Items | stolen when the enemy takes a visited sector (`RemoveRandomItemsInSector`, chance `min(5·enemies, 90)`, visible and reachable items, `Strategic/Strategic_Town_Loyalty.cc:616-`); town theft (`18`) |
| Bloodcats | lair/arena +1 per 18 hours away (§4.2) |
| Smoke, lights | saved records keep aging on world time (`12`) |
| NPCs | profile sectors move by daily events, schedules post on load (`35` §2.3, §3.2) |
| Doors | `ExamineDoorsOnEnteringSector` (close open doors after ≥ 30 min away) never fires (§5.2) |
| Enemy movement | groups between sectors keep their arrival times; `ResetMovementForEnemyGroupsInLocation` on a retreat |

---

## 6. Sector ownership and map state

### 6.1 Control

`SetThisSectorAsPlayerControlled(s, contested)` (`Strategic/Player_Command.cc:57-218`): meanwhile → false; surface:
`NumHostilesInSector > 0` → false (too early); Bobby Ray's delivery sector enables the site; remember `wasEnemy`;
`fEnemyControlled = false`; town → start its loyalty; `wasEnemy && contested`: town (not Omerta on day 1, not J9/K4) →
morale and loyalty events and `CheckIfEntireTownHasBeenLiberated`; worthwhile mine → events; SAM site → meanwhile,
events, Skyrider quote, first-time grace days; refuel site update; Meduna outskirts meanwhile. `contested` →
`StrategicHandleQueenLosingControlOfSector` (`17`). Underground: P3 b1 sets the alternate Queen position. Surface:
`fSurfaceWasEverPlayerControlled = true`. Always `UpdateAirspaceControl`. Returns `wasEnemy`.

`SetThisSectorAsEnemyControlled(s)` (`:222-324`): autoresolve about to start → false; surface: `wasPlayer`;
**`fEnemyControlled = true` before** the "player mercs still there" early return; `wasPlayer` and no mercs: town, mine,
SAM events, refuel update, notification; visited sector → theft (`min(5·NumEnemiesInAnySector, 90)`). Always
`UpdateAirspaceControl`.

| Caller | Call |
|---|---|
| Player group arrives without battle (§3.10) | player, uncontested |
| Tactical battle won (`Tactical/Overhead.cc:4681`) / lost (`:4492`) | player contested / enemy |
| Autoresolve (`Strategic/Auto_Resolve.cc:343,1296`) | player contested (`19`) |
| Strategic AI takes a sector (`Strategic_AI.cc:1045`), map screen notice (`MapScreen.cc:7618`) | enemy (`17`) |
| End game (`Tactical/End_Game.cc:274`) | player contested |

ja2-node: `map/control.ts`; the town, mine, SAM, morale, theft and notification effects go through
`TacticalWorldPort.sectorLiberated` / `sectorTakenByEnemy` to the economy (`18`), the Queen's reactions through
`StrategicAiPort`; the tactical callers are in `campaign/battle-flow.ts`.

### 6.2 Airspace

`UpdateAirspaceControl` (`SAM_Sites.cc:69-96`): for every surface sector, enemy air control iff the controlling SAM
(air-control table − 1, ≥ 0) is in an enemy-controlled sector with condition ≥ 80; then the `OnAirspaceControlUpdated`
listeners: the merc landing zone moves back to the start sector if its airspace turned hostile (`21`), refuel sites
update (`25` §5.1). ja2-node: `updateAirspaceControl` (`map/control.ts`), SAM condition and repair in `map/sam.ts`.

### 6.3 What the player knows about enemies (fog for D16)

`WhatPlayerKnowsAboutEnemiesInSector(s)` (`Map_Screen_Interface_Map.cc:3511-3562`): a scouting merc in `s` (not vehicle,
in transit, POW, dead, asleep, < OKLIFE, in the heli, moving), militia within one sector (3×3,
`Strategic/Town_Militia.cc:623-640`) or `SF_PLAYER_KNOWS_ENEMIES_ARE_HERE` → `KNOWS_HOW_MANY`, except stationary enemies
there → `KNOWS_THEYRE_THERE`; visited → `KNOWS_THEYRE_THERE`; Skyrider noticed and still flying there →
`KNOWS_THEYRE_THERE` (else the flag is cleared: a read with a side effect); otherwise `KNOWS_NOTHING`. The map shows
nothing on day one and nothing underground (`HandleShowingOfEnemyForcesInSector`, `:3606-3632`). Shading: unvisited
sectors dark; the airspace view shows `fEnemyAirControlled` for every sector (`DrawMap`, `:487-541`).

ja2-node: `whatPlayerKnowsAboutEnemiesInSector` (`map/knowledge.ts`,
`EnemyKnowledge {NOTHING 0, THEYRE_THERE 1, HOW_MANY 2}`) for gameplay callers (heli scouting, encounter codes, battle
flow); the player view uses the side-effect-free `surfaceKnowledgeOfEnemies`/`peekPlayerKnowledgeOfEnemies`, which give
the same answer without clearing the Skyrider flag. What the view exposes is `29`.

---

## 7. Implementation in ja2-node

### 7.1 Content and data tables

- `parseJsonc` (`src/content/strategic/jsonc.ts`) reads the `data/externalized` files; `loadStrategicContent(read)`
  (`content/strategic/strategic-content.ts`) builds the frozen `StrategicContent` from the files in
  `STRATEGIC_CONTENT_PATHS` (`map-tables.ts`: traversability, movement costs, towns, descriptions, underground
  templates, SAM sites and air control, secrets, cache sectors, bloodcats; `policy.ts`: `game.json` policies and vehicle
  types; `travel-table.ts`). Everything is in `data/`, so the strategic layer runs on stubs.
- `data/tables/strategic-travel.json` (`tools/transcribe/strategic-travel.ts` from `Strategic_Movement.cc:2065-2190`,
  `Strategic_Pathing.cc:151`, `Map_Screen_Helicopter.h:12-13`): `transports` in evaluation order, each with `mask`,
  `baseMinutes` and per-terrain `modifiers`; `minutes = baseMinutes·100/modifiers[terrain]` (integer); a terrain missing
  from `modifiers` is impossible; `modifiers: null` = every terrain at `baseMinutes`; EDGEOFWORLD is impossible for all;
  TOWN costs `townMinutes` unless the mask is exactly AIR; plus `flatStrategicTravelTime` and `airspaceCost`.
- `data/tables/sector-facilities.json` (`tools/transcribe/sector-facilities.ts` from `Campaign_Init.cc:30-66`): facility
  flags applied in order with `|=`.
- Enums (traversability, insertion codes, `SF_*`, `SFCF_*`, group flags, encounter codes, assignments, move types):
  named constants in `src/sim/strategic/forces/constants.ts`, `map/sectors.ts` and `src/sim/tactical/insertion.ts`.

### 7.2 State

`StrategicState` (`src/sim/strategic/state.ts`), plain data; original globals in brackets:

- `map` (`map/sectors.ts`): `sectors[256]` (`SectorInfo`), `elements[324]` (`StrategicMap`), `underground[]` in file
  order (`gpUndergroundSectorInfoHead`), `secretsFound[]` parallel to the secrets table, `selectedSector` (`sSelMap`,
  read by `HandleNonCombatGroupArrival`), `activity` (the player-activity counters of `SetSectorFlag`). `worldSector`
  (`gWorldSector`, null = none).
- `forces` (`forces/groups.ts`): `groups[]` in list order (`gpGroupList`; every `FOR_EACH_GROUP` depends on it),
  `squads[20]` as soldier-id lists, `squadGroupIds` (`SquadMovementGroups`), `deadSquadMembers` (`sDeadMercs`, profile
  ids), `currentSquad` (`iCurrentTacticalSquad`), `vehicleGroupIds` (`gubVehicleMovementGroups`), `vehicles`, the
  helicopter id, airborne flag and record (`25` §5).
- `movement` (`forces/flow-state.ts`, not in the native save): `waitingForInput`, `pendingSimultaneousGroup`,
  `groupPrompting`, `initPrebattleGroup`, `numGroupsArrivedSimultaneously`,
  `tacticalTraversal {active, groupId, chosenSoldier}`, `undergroundTacticalTraversal`, `randomizingPatrolGroup`,
  `disableMapInterfaceDueToBattle`, `exitingVehicleToSquad`.
- `encounter` (same file, shared with `19`): `code` (`gubEnemyEncounterCode`), `explicitCode`, `highPotentialForAmbush`,
  `autoAmbush` (cheat, always false), `cantRetreatInPBI`, `delayAutoResolveStart`, `usePersistentPBI`, `battleGroup`
  (`gpBattleGroup`), `pendingEnemies` (`gfPendingEnemies`), `numAwareBattles` (`17`), `preBattle` (§4.4),
  `simultaneousArrival` (§3.12).
- `sectorFlow` (`campaign/flow-state.ts`): `jump` (the adjacent-jump globals `gpAdjacentGroup`…,
  `StrategicMap.cc:135-140`), `usingEdgepointsForEntry`, `overrideInsertionWithExitGrid`,
  `hasEnteredCombatModeSinceEntering`, `pendingWait`, the POW squad.
- `sectorDiffs` (`Map<sectorKey, SectorDiff>`, `campaign/sector-diff.ts`) replaces the temp files (§5.11): `items`
  (`WORLDITEM` fields incl. non-existing slots), `corpses` (with time of death), `mapChanges` (in order), `doorTable`,
  `revealed` (revealed and room-hidden bits), `doorStatus`, `openables`, `bloodSmell`, `enemies`/`civilians`
  (`{savedMinute, links: [node, soldier][], records}`), `smoke`, `lights`; a null member is a missing temp file; the
  `SF_*_TEMP_FILE_EXISTS` flags mirror them.
- `roster` (`campaign/merc-record.ts`, `campaign/roster.ts`): player soldiers live in the campaign roster across loads;
  the tactical state references them while they are in the loaded sector. Non-player soldiers are created on load and
  dropped on unload, as in `TrashWorld`. Strategic code sees a merc through `MercPort` (`forces/ports.ts`) as a
  `StrategicMerc` (sector, between sectors, group, previous sector id, insertion code and direction, path, assignment,
  vehicle id, life, strength and body flags). The traversal fields (`insertionGridNo`, `insertionData`,
  `pendingActionData1/2`, `preTraversalGridNo`, `waitActionToDo`, `useExitGridForReentryDirection`) are on the tactical
  `Soldier`; the merc wait (`Overhead.cc:5834-5844`) is `TacticalState.mercsWaiting`.

### 7.3 Modules

| Module | Covers |
|---|---|
| `src/content/strategic/sector-ids.ts`, `sector-maps.ts` | §1.1; map path choice (§7.5) |
| `src/sim/strategic/map/sectors.ts`, `init.ts` | §1.3–§1.6; new-campaign map init (`initNewCampaignMap`, `initBloodCatSectors`, `initTixaBasementWithoutSciFi`, `initStrategicLayerMap(ctx, {initStrategicAI, initNpcs})` = the map and forces part of `InitStrategicLayer`) |
| `map/control.ts`, `map/sam.ts`, `map/knowledge.ts` | §6 |
| `map/travel.ts`, `map/pathing.ts`, `map/plotting.ts` | §3.2, §3.5; plotting ETAs for the map screen |
| `map/save-import.ts` | `importStrategicMap(ctx, save)`: the native sections of §1–§2 |
| `forces/groups.ts`, `forces/squads.ts` | §2, §3.11, §3.14 |
| `forces/movement.ts` | §3.4, §3.6–§3.11 |
| `forces/routes.ts`, `forces/move-permission.ts`, `forces/move-box.ts` | §3.3 |
| `forces/encounters.ts`, `forces/pre-battle.ts` | §3.12, §4; the PBI side (`19`) |
| `forces/vehicles.ts`, `forces/helicopter*.ts`, `economy/vehicle-assignment.ts` | §3.15, §3.16 (`25` §5) |
| `forces/ports.ts`, `forces/context.ts` | `StrategicContext` = state + content + `MercPort` + `StrategicAiPort` + `TacticalWorldPort` + `HelicopterPort` + clock + `random`/`preRandom` roll sources; `createStrategicContext`; default ports (AI hooks answer `false` or do nothing) |
| `src/sim/campaign/sector-flow.ts` | `SectorFlow`: §5.1–§5.6, §5.10–§5.12, the tactical side of §5.13 and §4.6; `adoptLoadedSector(links)` for imported saves; `mapsNeededSoon(target)` |
| `campaign/sector-exits.ts`, `src/sim/tactical/sector-exit.ts` | §5.9 (strategic and tactical halves) |
| `campaign/sector-diff.ts`, `campaign/sector-loot.ts`, `tactical/map-changes.ts`, `tactical/item-reachability.ts` | §5.11–§5.12 |
| `tactical/edgepoints.ts`, `tactical/insertion.ts`, `tactical/init-list.ts` | §5.6, §5.7, §5.13 |

### 7.4 Wiring

- `CampaignSim` (`src/sim/campaign/campaign-sim.ts`) takes `hooks.strategic` (content and optional mercs, AI and world
  ports) and `hooks.sectors = {worlds: SectorWorlds, content, roster}`, exposes `campaign.strategic` and
  `campaign.sectors`, and registers `GROUP_ARRIVAL` (`GroupArrivedAtSector(group, TRUE, FALSE)`) and
  `GROUP_ABOUT_TO_ARRIVE` (no effect). The `TacticalWorldPort` is layered: economy, laptop, helicopter, narrative
  (meanwhile, boxing) and the sector flow (`sectorWorldPort`: enemy presence, reinforcement arrival into the loaded
  sector, unloading).
- The loaded sector's `TacticalSim` shares the campaign's `Random`/`PreRandom` streams, profiles, key table, real-time
  clock and light schedule; `TacticalState.sectorHooks` call back into the flow (deaths, map-edge escapes, pending
  enemies, the end of the merc wait, the battle's end, enemy presence).
- `17` callers: `prepareEnemyForSectorBattle` → `sortSoldierInitList` + `addSoldierInitListEnemyDefenceSoldiers` →
  `assignEnemyGroupIds`; deaths and map-edge escapes → `trackEnemiesKilled`, `processQueenCmdImplicationsOfDeath`;
  tactical turn ends and `enemyReinforcementsArrived` → `addPossiblePendingEnemiesToBattle`; unload →
  `endTacticalBattleForEnemy` and, whenever the world is trashed, `handleFirstMeanwhileSetUpWithTrashWorld`; soldier
  creation → `difficultyModifierAt` (computed at sector load, deviation "Difficulty and progress in tactical").
- `loadStartSector(campaign)` is the default `CampaignHooks.loadStartSector`. `server/world-cache.ts` (`WorldCache`)
  loads the maps of `mapsNeededSoon` before a command (`CampaignSession.prepare`); a save session (`createSaveSession`)
  gets a `SectorFlow` when it has a `FileExists`, runs `importStrategicMap` and adopts the loaded sector's
  preserved-soldier links.
- The sandbox (`server/sandbox.ts`, no campaign) populates A9 through the same init-list code (deviation "Sandbox
  population").
- Commands, prompts, events and the strategic view: `29`.

### 7.5 Stubs

- The country map needs no stub: the externalized tables ship in `data/` and work in CI; unit tests that need a tiny
  world build a synthetic `StrategicContent`.
- `sectorMapPath` (`content/strategic/sector-maps.ts`) picks the original map, else that sector's map in the built stub
  pack (`stubs/world/maps/`), else `wilderness.dat`, so the campaign runs on stubs anywhere. Hand-made sector stubs:
  `stubs/maps/a9.map.txt` (start village: entry points, garrison placements of every class), `a10.map.txt` (exit grid to
  `a10_b1.map.txt`, a basement with `scroll: basement`), `d5`, `n7`, `p3`, `p3_b1`; `stubs/maps/sector-kinds.json`
  aliases the other garrison, town, mine, SAM and underground sectors to generic kind maps (`32` §1.6.1). Serving a
  generic map for a sector without one is a stub-pack rule, not a simulation deviation.
- Stub map keys for this domain (`src/content/formats/stub-map.ts`):
  `entry: north|east|south|west|center|isolated <x> <y>`, `exit: <x> <y> -> <SECTOR|here> [z=<n>] at <worldX> <worldY>`,
  `scroll: basement|default`, and the `optional` flag on `soldier:` lines (priority existence off). Stubs carry no saved
  edgepoints (§5.7).

### 7.6 Verification

Oracle (`tools/oracle/README.md`): `probes/strategic.txt` ("Strategic movement": `stratcosts` for all five masks,
`stratpath` incl. tactical traversals, `groups` after loading each native save: every group, waypoint, squad, dead list,
`SECTORINFO`, map element, underground node, arrival event, merc path and secret) and an all-pairs `stratpath` sweep for
FOOT, AIR and TRACKED; `probes/sectors.txt` (patch `0004`, "Sector transitions": loaded and generated edgepoints on
eight maps incl. the A10 basement, `soldierexit`, `walkoff`, `walkin`, `mirror`, `initlist`, `defence` with replayed
decision draws, `exitcheck`). All match exactly. Creature and bloodcat placement: `17` §12.3. Unit tests sit next to the
modules; `sector-scenario.test.ts` plays A9 → B9 by `route`, the PBI hand-off, `enterSector`, the battle, leaving and
re-entering, with the same digest under the instant and the manual driver.

### 7.7 Limitations

- The NPC-of-note prompt never opens (§3.10); no bloodcat lair corpses (§3.9).
- The warp out of a creature lair (§5.9) is not offered (`warpOutOfMineCodes` in `strategic/creatures/creatures.ts` has
  no caller).
- No placement GUI (§5.8); no vehicle soldier, condition or fuel for vehicles ja2-node adds (§3.15); no fuel or museum
  move refusal (§3.3); no heli arrival clamp (§3.16).
- Native temp files of sectors other than the loaded one are not imported (gap "Savegame import"); no rotting or
  crows in the loaded sector (gap "Corpses").
- Not probed: strategic `advance` with replayed draws (enemy sleep, queued battles, reversals in one run), and ETAs with
  a soldier's encumbrance other than through `groups` when every member is in the loaded sector.

---

## 8. Quirks, deviations and open points

### 8.1 Quirks to keep

Original behaviour (vanilla too unless marked), each stated in its section:

- Departed enemy groups still count in the sector they left (`ubSector`) for `NumEnemiesInSector`,
  `PrepareEnemyForSectorBattle` and reinforcements (§3.14).
- `NumEnemiesInSector` ignores z: an underground tactical traversal checks the **surface** counts (§4.1).
- Reversal arrival `traverse − arrival + 2·now`; a 90° replan while moving is a reversal (§3.4).
- Only pivots become waypoints; any added waypoint resets every member's insertion code to 0 (NORTH) (§3.4).
- Group flags clear on every arrival; `numAwareBattles` also drops when a prompt opened or `checkForBattle` was false
  (§3.9).
- `GROUPFLAG_HIGH_POTENTIAL_FOR_AMBUSH` only from leaving a hostile sector through an **exit grid** (§5.9).
- `gfUndergroundTacticalTraversal` is set (twice) and never cleared: after the first underground edge traversal every
  later tactical traversal group arrives after 1 minute instead of 5 while the clock still warps 5
  (`StrategicMap.cc:1772-1782`; `V: Strategic/StrategicMap.c:2675-2687` has the second assignment too, an older path
  resets it at `:2516`); not saved (deviation "Underground traversal flag").
- `OKForSectorExit` tests `gWorldSector.z > 1` per soldier: at z == 1 a squad member away from the edge makes the edge
  invalid (`:2119`, §5.9).
- Facing on entry is toward the map centre; the strategic insertion direction (< 100) is ignored for people (§5.6).
- `DISALLOW_SIGHT` during walk-off and walk-in (§5.9).
- Strac's PD pass visits every other node; `SortSoldierInitList` reverses each class (§5.13); the `32 − admins + troops`
  elite clamp and full underground counts (`17` §10.1).
- Preserved enemy files: stationary counts only, never underground, 300 minutes, `PreRandom(2)` position; civilian
  pruning by the last record's team (§5.12).
- `SetThisSectorAsEnemyControlled` sets the flag before its early return (§6.1).
- `ExamineDoorsOnEnteringSector` never fires (§5.2).
- `NotifyPlayerOfInvasionByEnemyForces` calls back only for town/SAM sectors (§4.1).
- Heli route cost by the airspace of the sector left; SHIFT overrides heli costs (§3.2).
- `AllMercsWalkedToExitGrid` passes the target sector to the retreat loyalty check (§5.9).
- A failed bloodcat first-visit `PreChance` leaves `cats` at −1, so later visits roll again; `bBloodCats == 0` still
  rolls `PreChance(95)` and returns false (§4.2).
- Enemy groups are sized troops + elites (§2.2).

### 8.2 Deviations and gaps

Entries in `deviations.md`: "Cosmetic draws in strategic movement" (§4.4), "Cosmetic draws of the helicopter", "Waiting
for mercs to exit" (§5.9), "Sector temp files" (§5.11), "Underground traversal flag", "Strategic prompts" (§3.10, §3.12,
§4.1), "Exit dialog" (§5.9), "Tactical placement" (§5.8), "Map route plotting", "Move box regrouping", "Map and tactical
screens" (§5.1), "Strategic hints and enemy counts", "Sandbox population", "Difficulty and progress in tactical", "Map
changes of the loaded sector on import", "Strategic AI PD placement pass" (§5.13). Entries in `gaps.md`: "Bloodcat lair
corpses" (§3.9), "NPC-of-note test" (§3.10), "Strategic move refusals" (§3.3), "Vehicles as characters", "Ground
vehicles" (§3.15), "Helicopter on the map", "Corpses", "Corpse sweet spot", "Savegame import". "Doors on entering a
sector" describes a door rule the original never runs (§5.2).

### 8.3 Unverified

- Mobile enemies that arrive after the player left appear twice when a preserved enemy file is restored (§5.12); oracle
  check: save beside an enemy sector, let a patrol enter it, re-enter, count the enemy team.
- The effect of the stuck underground flag (§8.1) on event order depends on what else is queued in those 4 minutes.
- `CalculateTravelTimeOfGroup` ignoring `ubNextWaypointID` is harmless for ONE_WAY player groups (§3.5).
- Whether any of the 261 vanilla maps lacks saved edgepoints, i.e. whether the generator ever runs on original data
  (§5.7).

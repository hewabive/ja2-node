# 14 — Savegames

**Scope.** The native savegame format (`.sav` of vanilla JA2 Gold 1.12 and Stracciatella), read by
`src/content/formats/savegame.ts` (`parseSaveGame`) and the other `src/content/formats/savegame-*.ts` modules, and its
import into a ja2-node campaign session (§10). ja2-node's own saves are `27`. `pnpm cli inspect save <file.sav>` prints
a summary. Paths below are relative to `reference/stracciatella/src/game/`.

## 1. Container

There is no table of contents, no section tag and no section length. A save is the header (432 or 688 bytes) followed
by the sections in the fixed order of `LoadSavedGame` (`SaveLoadGame.cc:644`); each section is either fixed-size, a
counted list, or a length-prefixed blob, and some contain nested counts (temp files depend on sector flags read
earlier, special dealer items on per-item counts). So every section has to be walked to find the next one.
`parseSaveGame` records `sections` (name, offset, size) and fails unless it ends exactly at the end of the file; the
section readers decode the sections it only skips from those offsets.

Supported versions: 85..105 (`MIN_SAVE_VERSION`..`MAX_SAVE_VERSION`). Older saves change several framings (smoke and
light effects in the file, old vehicle movement block, shorter creature block) and are rejected.

## 2. Header (432 bytes Windows/vanilla, 688 bytes Strac Linux)

`u32 version`, `char[16] gameVersion`, `wchar[128] description` (UTF-16; UTF-32 in the Linux layout), 4 skipped,
`u32 day`, `u8 hour`, `u8 minute`, `i16 x`, `i16 y`, `i8 z`, `u8 mercsOnPlayerTeam`, `i32 currentBalance`,
`u32 currentScreen`, `bool alternateSector`, `bool worldLoaded`, `u8 loadScreenId`, game options (12: gunNut, sciFi,
difficulty, turnTimeLimit, saveMode, 7 padding), 1 skipped, `u32 random`, then `u32 saveStateSize` from version 102,
padding to the end. Layout detection copies `ExtractSavedGameHeaderFromFile`: parse as Linux, accept if
`isValidSavedGameHeader`, otherwise reparse as Windows.

## 3. Encryption

Merc profiles and soldier records are encrypted record by record: `plain[i] = enc[i] - enc[i-1] - rot[i % 49]`, the
previous byte and the index restarting with every record (`Tactical/Tactical_Save.cc:950`). The 49-byte rotation array
is `g_encryption_array[set]`, 228 arrays transcribed into `data/tables/save-encryption.json` by
`tools/transcribe/save-encryption.ts`. `set` comes from the header (`CalcJA2EncryptionSet`, `SaveLoadGame.cc:2489`):
balance × (mercs + 1) + 3z + load screen (+7 alternate map), small bumps from `random % 2/7/23/79`, ×11 for the German
version, `% 10`, `+ day / 10`, `% 19`, then +19×6 gun nut, +19×3 sci-fi, +19 medium, +38 hard (u32 arithmetic). Versions
below 87 use the fixed 46-byte key of `prof.dat` instead. The German factor is a property of the game build, not of the
file, so the reader tries non-German first and keeps the variant whose first profile checksum matches
(`germanEncryption` in the result). Since 11 ≡ 1 (mod 10), the factor only changes the set when the u32 product
wraps, i.e. for large balances.

## 4. Section order

"Parser" = decoded by `parseSaveGame`; a module name = decoded by that section reader from the recorded offset.

| # | Section (loader) | Framing | Decoded |
|---|---|---|---|
| 1 | Tactical status (`ExtractTacticalStatusTypeFromFile`) + `i16 x, i16 y, i8 z` world sector | 316 / 360 + 5 | parser (§7): flags, teams, turn and interrupt state, civilian group hostility, last battle, boxing, guide countdown, blood decay time, sector |
| 2 | Game clock (`LoadGameClock`) | 42 + 20 padding | parser, all; `gameClock` is world seconds |
| 3 | Strategic events | `u32 n` × 28 | parser, all |
| 4 | Laptop info | 7440, then Bobby Ray orders (`size × 84` if `used ≠ 0`) and insurance payouts (`n × 8` if `used ≠ 0`) | `savegame-laptop.ts` (§11; Bobby Ray lists of 8-byte `STORE_INVENTORY` cut to `usInventoryListLength`, the old order array skipped); M.E.R.C. account status by `savegame-contracts.ts` |
| 5 | Merc profiles | 170 (200 from v105) × encrypted 716 / 796; v104+: `n` voice ids + `n` IMP slot states | parser (§6); voice ids and I.M.P. slot states by `savegame-laptop.ts` (§11) |
| 6 | Soldiers | 156 × (`u8 active`; if set: encrypted 2328 / 2352, merc path `u32 n` × 20, `u8 hasKeyRing` + 128) | parser (§6); the assignment fields (`bTrainStat`, sleep, collapse, nothing-to-do, last change) also by `readSoldierAssignments` (`savegame-economy.ts`) |
| 7–9 | Finances, history, files temp files | `u32 size` + data each | finances (`i32` balance + 14-byte records) by `savegame-economy.ts`; history and files by `savegame-laptop.ts` (§11) |
| 10 | Email | `u32 n` × (`u32 subjectSize` + subject + 44) | `savegame-laptop.ts` (§11) |
| 11 | Strategic info | 324 × 41 map elements, 256 × 116 `SECTORINFO`, 324 SAM bytes, 1 | parser (`savegame-strategic.ts`): map elements, every `SECTORINFO` field, Orta found |
| 12 | Underground sectors | `u32 n` × 72 | parser, all |
| 13 | Squads | 120 × 12 (`i16 id`, format version, squad id from v101, 8) + 20 movement group ids | parser, members |
| 14 | Strategic movement groups | `u32 n` × (84; player: `u32 n` × `u32 profile` if size > 0; enemy: 29; `u32 n` × 8 waypoints) + 32 | parser, all (`GROUP`, `ENEMYGROUP`, waypoints) |
| 15 | Map temp files | see §5 | parser |
| 16 | Quests and facts | 30 + 500 | parser, all |
| 17 | Opplists | 936 + 3 × 24336 + 2 × 936 + 12 | parser, see §7 |
| 18 | Map screen messages | 3 + 256 × (`u32 size`; if > 0: text + 28) | skipped |
| 19 | NPC quote info | (profiles + 20 civ sectors) × (`u8 present` + 50 × 32) | `savegame-npc.ts` |
| 20 | Key table | 64 × 8 (4 skipped, `usSectorFound`, `usDateFound`) | parser, `keyTable` (`25` §8.1) |
| 21 | Temp NPC quote file | `u32 size` + data (Strac writes 0, vanilla a real file) | skipped |
| 22 | PreRandom | `u32 index` + 256 × `u32` | parser, all |
| 23 | Arms dealers | 19 × 20 + 19 × 351 × 16 headers, then 28 × Σ special-item counts of items 1..350 | `savegame-merchants.ts`, all: status, headers and special elements (`docs/23` §14.2) |
| 24 | General info (`LoadGeneralInfo`) | 1024 | parser: selected soldier, render centre, panel, music mode, options, clock base, helicopter, Tixa and SAM secrets, dead squad members, selected map sector, meanwhile scene, narrative globals; `savegame-strategic-ai.ts`: meanwhile flags, first-battle sector, creature meanwhile; `savegame-laptop.ts`: `g_merc_arrive_sector` (8 bytes after `sSelMap.z`) |
| 25–30 | Mines (6 × 44), town loyalty (13 × 26), vehicles (`u8 n` × (`bool valid` + 128 + merc path)), bullets (`u32 n` × 128), physics objects (`u32 n` × 256), air raid (132) | | mines and town loyalty by `savegame-economy.ts` (`readSavedEconomy`); vehicles by the parser; bullets, physics objects and air raid skipped |
| 31 | Team turns | 174 | parser: interrupt queue, hidden interrupt, last interrupted, rock thrower |
| 32 | Explosions | 4 + 40 × 12 queue, `u32 n` × 36 | skipped |
| 33–34 | Creature directives (13, +4 from v82), strategic status (192) | | creature directives by the parser (habitat distance, population modifier, lair, creature music, destroyed lair); strategic status by `savegame-strategic-ai.ts` (flags, captures, highest progress, deaths, reputation, kills, activity, weapons already dropped) |
| 35 | Strategic AI | 144 + 1200 + 1000 + 1400 + patrol count + garrison count (counts at offsets 8 and 4) | `savegame-strategic-ai.ts`, all (`docs/17` §1.4) |
| 36 | Watched locations | 156 × 3 × (2 + 1 + 1 + 1) | parser, all |
| 37–42 | Item cursor (44), civ quotes (100), backup NPC info (as 19 without civ sectors), meanwhile (17 × 8), schedules (`u8 n` × 36: 4 skipped, times, data1, data2 as `u16[4]` each, actions `u8[4]`, id, soldier id, flags `u16`), vehicle movement groups (10) | | item cursor and civ quotes skipped; backup NPC info by `savegame-npc.ts`; meanwhile definitions, schedules and vehicle movement groups by the parser |
| 43–45 | Contract renewals (81), leave item list (20 × (`bool` + `u32 n` × 40) + 80), Bobby Ray shipments (`i32 n` × 104) | | renewals and leave list by `savegame-contracts.ts`; shipments by `savegame-laptop.ts` |
| 46 | Game states (v101+) | `u32 len` + JSON text | parser, text; `StrategicStatus::alreadyDroppedWeapons` read by `savegame-strategic-ai.ts` (it replaces the flags of section 34) |

Native saves keep the traversability table they were started with: vanilla saves differ from Stracciatella's JSON on
the I2/I3 border, and Stracciatella does not re-initialise it on load, so the import keeps the saved values (`16`).

## 5. Map temp files

Sectors y = 1..16, x = 1..16 (flags from section 11, index `(y−1)·16 + x−1`), then the underground list in file order
(flags from section 12). For each sector, for each flag in this order, if set: `u32 size` + the file:
`i_` items `0x10000000`, `r_` corpses `0x20000000`, `m_` map modifications `0x40000000`, `d_` door table `0x80000000`,
`v_` revealed `0x01000000`, `ds_` door status `0x02000000`, `e_` enemies `0x04000000`, `c_` civilians `0x08000000`,
`sm_` smoke `0x00100000`, `l_` lights `0x00200000` (`Tactical_Save.cc:51`; `TEMP_FILE_KINDS`). All files are kept as raw
bytes (`tempFiles`); for the current sector (`gWorldSector` from section 1) these are decoded (`currentSector`):

- items: `u32 n` × 52-byte `WORLDITEM` (`fExists` 0, `sGridNo` 2, `ubLevel` 4, `OBJECTTYPE` 8 via `decodeObject`,
  `usFlags` 44, `bRenderZHeightAboveLevel` 46, `bVisible` 47, `ubNonExistChance` 48; `12` §6.1);
- door table: `u8 n` × 14 (`sGridNo`, `fLocked`, trap level, trap id, lock id, perceived locked, perceived trapped,
  lock damage, 5 padding);
- door status: `u8 n` × 4 (`sGridNo`, `ubFlags`, 1 padding);
- rotting corpses: `u32 n` × 160-byte records (`decodeRottingCorpsesFile`);
- map modifications: 8-byte `MODIFY_MAP` records (`decodeMapModificationsFile`).

The session also decodes the soldier link records of the current sector's `e_` and `c_` files
(`decodePreservedSoldierLinks`, from `NewWayOfLoadingEnemySoldierInitListLinks`). The game saves the current sector into
its temp files right before writing (`SaveCurrentSectorsInformationToTempItemFile`), so these are the live state.

## 6. SOLDIERTYPE (2328 bytes Windows, 2352 Strac Linux)

`SOLDIER_LAYOUT` in `savegame-soldier.ts` lists every field of `ExtractSoldierType` in order (checked field by field
against `Tactical/LoadSaveSoldierType.cc:41`); `layoutOffsets(SOLDIER_LAYOUT, linux)` gives any offset. The record
ends with a checksum (`MercChecksum`: life, lifeMax, agility, dexterity, strength, marksmanship, medical, mechanical,
explosive, level, profile, then item + count of the 19 slots) which the reader verifies. Selected Windows offsets:

| Offset | Field | Offset | Field | Offset | Field |
|---|---|---|---|---|---|
| 0 | `ubID` u8 | 868 | `bLife` i8 | 1691 | `bAlertStatus` i8 |
| 2 | `ubBodyType` u8 | 869 | `bSide` u8 | 1692 | `bOppCnt` i8 |
| 3 | `bActionPoints` i8 | 880 | `bAgility` i8 | 1693 | `bNeutral` i8 |
| 8 | `uiStatusFlags` u32 | 886 | `bStrength` i8 | 1696 | `bOrders` i8 |
| 12 | `inv` 19 × `OBJECTTYPE` | 917 | `bLifeMax` i8 | 1697 | `bAttitude` i8 |
| 705 | `bInSector` u8 | 840 | `bDexterity` i8 | 1706 | `usPatrolGrid` 10 × i16 |
| 711 | `bBreath` i8 | 849 | `bExpLevel` i8 | 1736 | `bMorale` i8 |
| 730 | `name` 10 × wchar | 1377 | `bMarksmanship` i8 | 1756 | `bInterruptDuelPts` i8 |
| 752 | `bTeam` i8 | 1412 | `bLevel` i8 | 1758 | `bIntStartAPs` i8 |
| 756 | `dXPos` f32 | 1534 | `bOppList` 148 × i8 | 1825 | `ubProfile` u8 |
| 774 | `sGridNo` i16 | 1683 | `bAction` i8 | 1896 | `bMovedPriorToInterrupt` i8 |
| 776 | `bDirection` i8 | 1684 | `usActionData` u16 | 1922 | `sSector` x, y i16, z i8 |
| 796 | `usAnimState` u16 | 1686 | `bNextAction` i8 | 2208 | checksum u32 |

The Linux layout inserts 2 bytes before `name`, stores `name` as UTF-32 and inserts 2 bytes after
`ubMovementNoiseHeard`: everything from `bVisible` on is +22, from `dXPos` on +24. Stat damage (`bAgilityDamage`
etc., offset 820) is read only from version 103; before that the bytes are ignored. `ubPathingData` is stored as
30 × u16 and truncated to bytes.

Profiles are the 716-byte `prof.dat` record (`12` §7, `prof.ts`), parsed with the same code; the reader adds the
campaign fields kills 310, assists 312, shots fired/hit 314/316, battles 318, wounds 320, days served 322, salary 332,
`bMercStatus` 652, sector z 669, and verifies the checksum at 696 (`SoldierProfileChecksum`: the soldier formula
without the profile term, over `inv` and `bInvNumber`). The Linux profile (796) stores name and nickname as UTF-32:
the reader converts them and reuses the Windows parser.

## 7. Tactical status, turns, opplists

- `TacticalStatusType` (`TACTICAL_STATUS_LAYOUT`, 316 / 360): `uiFlags` 0 (`INCOMBAT` = `0x40000`), six 16-byte teams
  from 4 (`bFirstID`, `bLastID`, radar colour, side, men in sector, last radio merc, aware, human), `ubCurrentTeam` 100,
  `fInterruptOccurred` 162, `ubAttackBusyCount` 170, `fUnLockUIAfterHiddenInterrupt` 272. Linux: 82 instead of 40
  padding bytes after `ubTopMessageType` (+42 from offset 176) and 2 more after `usTactialTurnLimitMax` (+44 from 220).
- There is no round counter in the save; the turn state is `ubCurrentTeam`, `INCOMBAT`, the team-turns block
  (`gOutOfTurnOrder[1..gubOutOfTurnPersons]`, `gfHiddenInterrupt`, `gLastInterruptedGuy`) and the per-soldier
  interrupt fields.
- Soldier ids are bytes; `NOBODY` = 156. Team ranges in vanilla data: 0–19 player, 20–51 enemy, 52–83 creatures,
  84–115 militia, 116–147 civilians, 148–155 planning slots.
- Opplists: `gbPublicOpplist[6][156]`, `gbSeenOpponents[156][156]`, `gbLastKnownOppLevel[156][156]`,
  `gbPublicLastKnownOppLevel[6][156]` and `gubPublicNoiseVolume[6]` are decoded. `gsLastKnownOppLoc`,
  `gsPublicLastKnownOppLoc` and `gsPublicNoiseGridno` are `INT16` arrays saved with their element count as byte count
  (`SaveLoadGame.cc:1636`, "TODO000F"), so only the first half of each reaches the file; the reader keeps those as raw
  bytes.

## 8. Vanilla notes

- Vanilla JA2 Gold 1.12 writes version 99 in the Windows layout with an encrypted body identical to what Strac reads.
- `uiFlags` in a saved file contains `LOADING_SAVED_GAME` (`0x1000000`, set by `SaveGame` while writing) and, in
  vanilla files, `TURNBASED` `0x4` and `TRANSLUCENCY_TYPE` `0x80`, bits Strac no longer defines (`V: Tactical/OverheadTypes.h:32-38`).
- The vanilla temp NPC quote file is a real blob (tens of kilobytes in the tested saves); Strac skips it by its size.

## 9. Limitations

- The Strac Linux layout is implemented from the source and covered by a synthetic test only; no real Linux save was
  available. Versions 100–105 are covered by the version gates but not by real files.
- Not decoded: map screen messages, the temp NPC quote file, bullets, physics objects, the air raid block, explosions
  (bomb queue and explosion records), the item cursor and civ quotes; of the temp files, the revealed tiles, smoke and
  light files and every temp file of a sector other than the loaded one stay raw. A save made with a bullet or a thrown
  object in flight, a queued bomb or an item in the cursor loses them on import.
- A save made during a meanwhile scene or the endgame sequence is refused (`storyImportRefusal`,
  `src/sim/campaign/story-import.ts`).

## 10. Import

`createSaveSession` (`src/server/save-session.ts`) turns a native save into a `CampaignSession`. Native saves come from
`$JA2_SAVES_DIR` or `SavedGames` next to the data folder and need the original data; MCP `newSession {save:
"SaveGame07"}` and `JA2_SAVE=SaveGame07` (default session) use it. The input log records the origin `import` with the
save's SHA-256, and a replay refuses a changed save.

1. `parseSaveGame`, `readStrategicAiSections`; refuse meanwhile and endgame saves (§9).
2. Load the world `saveMapPath(save)` (`maps/d13.dat`, `_b<z>` underground, `_a` for the alternate map) and the content
   parts; `importNativeGameOptions` takes difficulty, sci-fi, gun nut and save mode and reports a turn time limit as
   dropped (`droppedOptions`).
3. Build the `TacticalSim` on `worldWithSavedDoors(world, save)` (the saved door table with its perceived lock and trap
   values; construction runs `GenerateBuildings` as `LoadWorld` does), then `importSave` (below).
4. `createStrategicState` sharing the tactical `main` and `pre` streams, profiles, civilian groups, key table and boxing
   state; `importStrategicTime` (clock and event queue, `15`).
5. `addSavedMercsToRoster`: every active soldier record of our team with its profile becomes a roster merc.
6. `importMerchants` (`23`), `importStrategicMap` (sections 11–14, vehicles, vehicle movement groups, strategic general
   info; `16`), `importStrategicAi(…, {runLoadHooks: true})` (`17`), `importStory` (meanwhile definitions, battle
   sectors; `26`), creature directives, `importEconomy` (`18`), `importContracts` (`22`), `importLaptop` (§11),
   `importNarrativeSave` (quests, facts, narrative globals; `25`), the soldier assignment fields, `importNpcRecords`
   (`24`), `adoptLoadedSector` with the loaded sector's preserved-soldier links, the saved music mode.

`importSave` (`src/sim/tactical/save-import.ts`) rebuilds the loaded sector in the order of
`LoadCurrentSectorsInformationFromTempItemsFile` and `LoadSavedGame`:

0. The tactical clock from `guiBaseJA2Clock`, the loaded sector (`t.sector`), the civilian group hostility
   (`fCivGroupHostile`), the key table, profile progress (`progressFromProfile`), and the map lights loaded for the
   saved hour (`LoadMapLights` runs after `LoadGameClock`, `docs/20` §4).
1. World items replace the map items (`AddItemToPool` with the saved visibility, flags and z height;
   `WORLD_ITEM_GRIDNO_NOT_SET_USE_ENTRY_POINT` goes to the centre entry point).
2. Rotting corpses add their corpse structures.
3. Map modifications: `SLM_OPENABLE_STRUCT` swaps openable structures to the saved state and shows or hides the items
   inside; blood and smell records fill the smell map and, with blood and gore on, redraw the tile's pool at once
   (`AddBloodOrSmellFromMapTempFileToMap` reads the blood type before the record's smell byte is set, so a creature
   pool comes back as human blood, as in the original); any other record type is counted in
   `skippedMapModifications` (none occur in the tested saves).
4. Door status: perceived open state, then `SynchronizeDoorStatusToStructureData` swaps door structures whose
   `DOOR_OPEN` bit disagrees. Then the whole movement cost table is recompiled (`InitLoadedWorld`).
5. Soldiers that are active, in the sector, not between sectors and not dead, off map, drivers or passengers, in id
   order (so merc slots fill like `UpdateMercsInSector`). Stats, inventory, AP, breath, morale, AI and interrupt fields,
   path, animation state and script position come from the record. The position is the saved `sGridNo` with the
   coordinates at the tile centre: `EVENT_SetSoldierPosition` re-centres everyone on load, as the oracle confirms.
   Target, opponent and attacker ids are linked after all soldiers exist. Our mercs keep their key rings (the 128 bytes
   after the merc path), `ubDoorHandleCode` and the skill-check memory (`bLastSkillCheck`, `ubSkillCheckAttempts`,
   `sSkillCheckGridNo`). Off-map soldiers of the sector go into the away slots; then the schedules
   (`loadSavedSchedules`, `25` §5.6).
6. Opplists: personal and public opplists, seen opponents, public noise, watched locations. The last-known locations
   arrive only half (§7): the rest stays `NOWHERE`, which is what a fresh process loading the save has.
7. Turn state: `INCOMBAT`, current team, attack busy count, the interrupt queue, hidden interrupt, last interrupted
   guy, the rock thrower, team awareness and last radio operators, battle counters, `uiDecayBloodLastUpdate`, the
   selected soldier.
8. The `PreRandom` ring and index (`PreRandom.restore`).
9. `LightSetBaseLevel`: `gubEnvLightValue` above ground, the map's ambient underground; all lights are rendered with the
   imported doors, structures and height cache (`SaveLoadGame.cc:1044`).

Sentinels are converted to ja2-node's: `NOWHERE` is `WORLD_MAX + 1` (25601) in the original and `-1` here,
`NO_PENDING_ANIMATION` is 32001, `NO_PENDING_DIRECTION` 253 and `NO_PENDING_STANCE` 254 (ja2-node uses
`NO_DESIRED_HEIGHT` for "no pending stance").

What the import leaves out (revealed tiles and roofs, smoke and light effect records, other sectors' temp files) is
deviations.md "Savegame import"; see also "Strategic AI load hooks", "Underground traversal flag", "Talk context after a
load" and "Bobby Ray theft counter". The loaded sector's difficulty modifier and progress are computed as at any campaign
sector load ("Difficulty and progress in tactical").

Verification: `tools/oracle/save-probes.ts` writes probes for any saves (soldier dumps, hit chance and sight for every
opposed pair, AI best shot, paths, lights), the native oracle runs them, and `tools/oracle/compare.ts` rebuilds each
from the imported save (`tools/oracle/README.md` "Savegames"); most other comparers also start from imported saves.

## 11. Laptop sections

`src/content/formats/savegame-laptop.ts` (`readSavedLaptop`) decodes the laptop part of a save from the section offsets
the parser records, and `src/sim/campaign/laptop/save-import.ts` (`importLaptop`, after the contract import) fills
`StrategicState.laptop` and the narrative facts and quests (`docs/21` §0):

| Source | Layout | Imported as |
|---|---|---|
| `LaptopSaveInfo` (section 4) | `LoadLaptopInfoFromSavedGame`: the 7440-byte block field by field; `fFirstVisitSinceServerWentDown` is read as a byte (it holds 0, 1 or 2); bookmarks end at the first −1 | new-game flag, bookmarks, personnel lists (256 × `i16`, −1 empty), M.E.R.C. account and site fields, I.M.P. flags and voice index, Bobby Ray site flags and both inventories in save order, florist order number, last hired merc |
| Insurance payouts (after the block when `ubNumberLifeInsurancePayoutUsed ≠ 0`) | `numLifeInsurancePayouts` × 8: `bool active`, `u8 soldier`, `u8 profile`, 1 padding, `i32 payout` | payout list and used count |
| Old Bobby Ray orders (after the block when used) | `size` × 84 | skipped (replaced by the shipment list in Strac) |
| Bobby Ray shipments (section 45) | `i32 n` × 104: `bool active`, `u8 destination`, `u8 method`, 1 padding, 10 × 8 purchases (`u16 item`, `u8 count`, `i8 quality`, `u16 slot`, `bool used`, 1 padding), `u8 lines`, 3 padding, `u32 weight`, `u32 order day`, `bool shown`, 7 filler | shipments with their used lines; Pablo's theft counter (a function static in the original) starts at 0 |
| History file (section 8) | 12-byte records: `u8 code`, `u8 second`, `u32 date`, `i16 x`, `i16 y`, `i8 z`, 1 padding | history log |
| Files file (section 9) | 263-byte records: `u8 code`, 261 bytes, `u8 read` | file list |
| Email (section 10) | per mail `u32 subjectSize` + subject (Strac 0) + 44 bytes: `u16 offset`, `u16 length`, `u8 sender`, 3, `u32 date`, 4, `i32 first`, `u32 second`, 16, `bool read`, 3 | mails in save order with fresh sequential ids |
| Merc profiles (section 5, v104+) | the last `2n` bytes: voice ids, then I.M.P. slot states (1 = taken) | taken I.M.P. slots (their saved profiles become the characters' records); before v104 the slot `51 + iVoiceId` when `fIMPCompletedFlag` is set (`LoadSavedMercProfiles`) |
| General info (section 24) | `g_merc_arrive_sector` as `i16 x, i16 y`; `fNewMailFlag` | landing zone (an invalid sector falls back to the start sector as `LoadGeneralInfo` does); new-mail flag |

`SyncLastMercFromSaveGame` is applied: when `ubLastMercAvailableId` names Numb or Cougar and `gubLastMercIndex` is one
past that merc's listing (old saves with both Larry profiles in the list), the index moves back by one. The soldier
records also give `fUseLandingZoneForArrival` (`contract.useLandingZone`).

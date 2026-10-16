<!-- Strategic AI (the Queen: army pool, garrisons, patrols, reinforcements, attacks; Queen_Command: populating sectors,
deaths; creatures and bloodcats summary): an implementable spec for M4. 2026-10-15.
Source: reference/stracciatella/src (ae6bf01, same snapshot as docs 01–14), assets/externalized/*.json, cross-checked
against vanilla (reference/vanilla/ja2/Build). Read-only research: nothing was built or run. -->

# 17 — Strategic AI

**Conventions.** As in `13`: paths are relative to `reference/stracciatella/src/game/` (paths starting with `sgp/` or
`externalized/` are relative to `reference/stracciatella/src/`), `V:` is vanilla `Build/`,
JSON files are `assets/externalized/<name>.json` (copied unchanged to `data/externalized/`), "(inferred)" marks
conclusions not traced end to end. `R(n)` = `Random(n)` = our `main` stream (`[0, n)`, `R(0)` returns 0 **without a
draw**, `sgp/Random.cc:65-71`); `C(p)` = `Chance(p)` = `R(100) < p`, which **always draws** and takes `UINT32`, so a
negative `p` would always succeed (`sgp/Random.cc:73-76`); `PR(n)` = `PreRandom` = our `pre` stream. Every strategic-AI
draw is `R`; only creature night planning, bloodcat ambushes and PBI ambushes use `PR`.

**Ids.** Sector id (`SECTORINFO` index, `UINT8`) = `(y−1)·16 + (x−1)` with row letter A..P = y 1..16 and column x
1..16 (`Strategic/Campaign_Types.h:10-28`), so A9 = 8, P3 = 242. `StrategicMap[]` uses `x + 18·y` (`docs/16`).
Garrison index `gi` = position in `army-garrison-groups.json` (0..56), patrol index `pi` = position in
`army-patrol-groups.json` (0..28), composition id `ci` = position in `army-compositions.json` (0..26; the `id` field is
ignored, `externalized/army/ArmyCompositionModel.cc:27-45`). `NO_GARRISON = 255`. Group id 0 means "none" (real ids
are 1..255, `Strategic/Strategic_Movement.cc:506-528`). Difficulty `d` = 1 easy, 2 medium, 3 hard
(`GameSettings.h:78-81`). `MAX_STRATEGIC_TEAM_SIZE = 20` (`Strategic/StrategicMap.h:11`) is the nominal group and
garrison cap; the enemy tactical team has **32** slots (`Tactical/Overhead.cc:217-225`). Times: world minutes
(`GetWorldTotalMin`) and seconds; the event queue stores seconds (`docs/15`).

**Companion docs (do not duplicate).** `docs/15-strategic-time.md`: clock, event queue, `AddStrategicEvent` family,
new-game init order. `docs/16-strategic-map-movement.md`: sectors, groups (`GROUP`, waypoints, `CreateNew*Group`,
`RemoveGroup`, ids, group-list order), strategic A* (`MoveGroupFromSectorToSector*`), travel, arrival, battle checks,
sector control (`SetThisSectorAs*Controlled`), sector load/unload and persistence, bloodcat ambush.
`docs/18-militia-loyalty-mines-assignments.md`: militia counts, loyalty events, mine income, town liberation.
`docs/19-autoresolve-pbi.md`: PBI, encounter codes, autoresolve. This doc owns `Strategic/Strategic_AI.cc`,
`Strategic/Queen_Command.cc`, the strategic side of `Creature_Spreading.cc`, `CalcDifficultyModifier` and the
interfaces between them.

---

## 1. State

### 1.1 `SECTORINFO` fields the AI reads or writes (`Strategic/Campaign_Types.h:152-189`)

| Field | Type | Meaning |
|---|---|---|
| `uiFlags` | u32 | `SF_ENEMY_AMBUSH_LOCATION` 0x2 (roadblock garrisons, PBI ambush +20), `SF_PLAYER_KNOWS_ENEMIES_ARE_HERE` 0x4, `SF_ALREADY_VISITED` 0x20, `SF_USE_ALTERNATE_MAP` 0x40 (weapon cache), `SF_SKYRIDER_NOTICED_ENEMIES_HERE` 0x400, `SF_USE_MAP_SETTINGS` 0x1 (never set in the campaign, §10.1) |
| `ubGarrisonID` | u8 | index into `gGarrisonGroup`, 255 = none |
| `ubPendingReinforcements` | i8 | unused by the AI (the group field of the same name is used) |
| `ubNumTroops`, `ubNumElites`, `ubNumAdmins` | u8 | stationary enemies ("garrison"); only meaningful for the surface |
| `ubNumCreatures` | u8 | creatures attacking this surface sector (set just before the battle) |
| `ubTroopsInBattle`, `ubElitesInBattle`, `ubAdminsInBattle`, `ubCreaturesInBattle` | u8 | how many of the above were put into the current tactical battle |
| `ubDayOfLastCreatureAttack` | u32 | creature attacks |
| `ubTraversability[4]` (THROUGH) | u8 | `TOWN` = 0 marks a town sector for "important and undefended" |
| `bBloodCats`, `bBloodCatPlacements` | i8 | −1 = not rolled yet |
| `ubNumberOfCivsAtLevel[3]` | u8 | militia green/regular/elite (`docs/18`) |
| `uiTimeLastPlayerLiberated` | u32 s | grace period start |

Save layout (116 bytes, `Strategic/LoadSaveSectorInfo.cc:11-46`): flags 0, garrison 5, troops 14, elites 15, admins
16, creatures 17, in-battle troops/elites/admins/creatures 18–21, bloodcats 39, placements 40, militia 43–45,
`uiTimeLastPlayerLiberated` 60.

`UNDERGROUND_SECTORINFO` (`Campaign_Types.h:198-210`) has the same enemy counts and in-battle counts (no garrison id),
`ubAdjacentSectors` and `ubCreatureHabitat`; it is a linked list in `strategic-map-underground-sectors.json` order.

### 1.2 Enemy groups (`Strategic/Strategic_Movement.h:9-116`, owned by `docs/16`)

`ENEMYGROUP`: `ubNumTroops`, `ubNumElites`, `ubNumAdmins`, `ubPendingReinforcements` (staging top-up, §7.5),
`ubAdminsInBattle`, `ubTroopsInBattle`, `ubElitesInBattle`, `ubIntention`. Intentions: `NO_INTENTIONS 0`,
`PURSUIT 1`, `STAGING 2`, `PATROL 3`, `REINFORCEMENTS 4`, `ASSAULT 5` (never assigned). Move types: `ONE_WAY 0`,
`CIRCULAR 1`, `ENDTOEND_FORWARDS 2`, `ENDTOEND_BACKWARDS 3`.

`GROUP` fields the AI uses: `ubGroupID`, `ubGroupSize`, `ubSector`, `ubNext`, `ubPrev`, `ubOriginalSector`,
`fBetweenSectors`, `ubMoveType`, `ubNextWaypointID`, `uiArrivalTime`, `uiTraverseTime`, waypoints, `fVehicle`,
`fPlayer`, `ubCreatedSectorID`, `ubSectorIDOfLastReassignment` (debug only).

`CreateNewEnemyGroupDepartingFromSector(sector, admins, troops, elites)` (`Strategic_Movement.cc:476-503`) sets
`ubGroupSize = troops + elites` (**admins are not counted**; every AI call passes 0 admins), `ubMoveType = CIRCULAR`,
intention 0, no waypoints, appends to the group list and takes the lowest free id. Group-list order matters: several
loops below draw `R` per group in list order (`docs/16` must keep append order and lowest-free-id allocation).

### 1.3 Composition, garrison and patrol records (`Strategic/Strategic_AI.h:60-137`)

| Struct | Fields (save size) |
|---|---|
| `ARMY_COMPOSITION` (20) | `bPriority` i8, `bElitePercentage` i8, `bTroopPercentage` i8, `bAdminPercentage` i8, `bDesiredPopulation` i8, `bStartPopulation` i8 |
| `GARRISON_GROUP` (14) | `ubSectorID` u8, `ubComposition` u8, `bWeight` i8, `ubPendingGroupID` u8 |
| `PATROL_GROUP` (20) | `bSize` i8, `bPriority` i8, `ubSectorID[4]` u8 (0 = unused), `bFillPermittedAfterDayMod100` i8 (init −1, `externalized/army/PatrolGroupModel.cc:15-22`), `ubGroupID` u8, `bWeight` i8, `ubPendingGroupID` u8 |

Composition semantics (`army-compositions.json` header): elite% + troop% = 100 for every composition except
`QUEEN_DEFENCE` (100/0) and `SANMONA_SMALL` (0/0). A **non-zero admin% means the start garrison is admin% of the
start population as admins and nothing else** (except the mine/Cambria special case, §3.4). All refills use only the
troop/elite split.

### 1.4 Strategic-AI globals (`Strategic/Strategic_AI.cc:93-147`)

| Global | Type | Saved | Meaning |
|---|---|---|---|
| `gfQueenAIAwake` | bool | yes | master switch: no garrison checks, no reinforcements, no detection while false |
| `giReinforcementPool` | i32 | yes | troops "in reserve" at P3 (spawned on demand) |
| `giReinforcementPoints` | i32 | yes | sum of `−bWeight` over garrisons with negative weight (supply) |
| `giRequestPoints` | i32 | yes | sum of positive weights of garrisons and patrols (demand) |
| `giForcePercentage` | i32 | yes | `initial_garrison_percentages` |
| `giArmyAlertness`, `giArmyAlertnessDecay` | i32 | yes | detection chance and its drop per success |
| `gubNumAwareBattles` | u8 | yes | "full alert" counter; only set by an unreachable action (§9.5), so always 0 |
| `gubQueenPriorityPhase` | u8 | yes | the Queen's "mood": `CurrentPlayerProgressPercentage() / 10` (§6.2) |
| `gubMinEnemyGroupSize` | u8 | yes | `min_enemy_group_size` |
| `gubHoursGracePeriod` | u8 | yes | `grace_period_in_hours` |
| `gusPlayerBattleVictories` | u16 | yes | wakes the Queen at `5 − d` (§9.1) |
| `gfMassFortificationOrdered` | bool | yes | `MassFortifyTowns` ran |
| `gfFirstBattleMeanwhileScenePending` | bool | yes | meanwhile bookkeeping (`Strategic/Meanwhile.cc:760-810`) |
| `gfUseAlternateQueenPosition` | bool | yes | set when P3 basement is taken (`Strategic/Player_Command.cc:197-200`), read by the tactical Queen AI |
| `gfExtraElites` | bool | yes | only set by an unreachable action (§9.5) |
| `gArmyComp[]`, `gGarrisonGroup[]`, `gPatrolGroup[]` | records | yes | mutable copies of the JSON |
| `gubGarrisonReinforcementsDenied[]` | u8 per garrison | yes | grows on denials, **wraps at 256** |
| `gfAutoAIAware` | bool | no | debug cheat toggle in the map screen (`Strategic/MapScreen.cc:2962`); not ported |
| `gfPendingEnemies` | bool | no | `Queen_Command.cc:46`; battle-scoped (§10.4) |

Save layout of the strategic-AI section (`Strategic_AI.cc:2020-2080`; `docs/14` section 35, currently skipped):
offset 3 `gfExtraElites`, 4 garrison count i32, 8 patrol count i32, 12 pool, 16 force %, 20 alertness, 24 decay,
28 awake u8, 29 reinforcement points i32, 33 request points i32, 37 aware battles, 38 SAI version (29), 39 phase,
40 first-battle flag, 41 mass fortification, 42 min group size, 43 grace hours, 44 victories u16, 46 alternate Queen
position, then 97 padding (header 144 bytes); 60 × 20 compositions, 50 × 20 patrols, 100 × 14 garrisons, `patrol
count` skipped bytes, `garrison count` bytes of `gubGarrisonReinforcementsDenied`.

### 1.5 `STRATEGIC_STATUS` fields involved (`Strategic/Strategic_Status.h:75-106`)

`ubHighestProgress` (the progress used by `CalcDifficultyModifier`, admin upgrades, SAM counterattacks; updated
hourly, `Tactical/Campaign.cc:1290-1325`), `usPlayerKills` (kills portion of progress; incremented per merc kill,
`Tactical/Soldier_Ani.cc:2936`, autoresolve, PBI "win"), `usEnemiesKilled[3][3]` (`TrackEnemiesKilled`, statistics),
`uiFlags` and `ubNumCapturedForRescue` (captures, §10.11). Nothing else in the struct affects the AI.

### 1.6 Counting helpers (`Strategic/Queen_Command.cc:53-228`)

| Function | Result |
|---|---|
| `NumEnemiesInSector(s)` | `admins + troops + elites` of the sector + `ubGroupSize` of every non-vehicle enemy group with `ubSector == s` (groups between sectors count in the sector they left) |
| `NumHostilesInSector(s)` | as above + `ubNumCreatures`; underground: the underground record |
| `NumEnemiesInAnySector(s)` | surface: as `NumEnemiesInSector`; underground: the record |
| `NumStationaryEnemiesInSector(s)` | garrison counts, but 0 when there is no garrison **or the garrison's composition is `ROADBLOCK`** |
| `NumMobileEnemiesInSector(s)` | group sizes; plus the garrison counts when **`ubGarrisonID == ROADBLOCK`** (`:170`) |
| `GetNumberOfEnemiesInSector(s, &a, &t, &e)` | stationary (always the raw garrison counts) + mobile, where mobile again adds the garrison when `ubGarrisonID == ROADBLOCK` (`:197`) |

**Quirk (vanilla too, `V:Strategic/QueenCommand.c:212,236`).** `NumMobile…`/`GetNumberOfMobile…` compare the garrison
*index* with the composition enum `ROADBLOCK = 25`. Garrison 25 is **H1** (`WEST_GRUMM_DEFENCE`), so H1's garrison is
counted twice by `GetNumberOfEnemiesInSector` (used by autoresolve and by the enemy temp-file reconciliation,
`Strategic/Auto_Resolve.cc:308,2076`, `Tactical/Enemy_Soldier_Save.cc:175`) and once as "mobile" by the PBI. Real
roadblocks (gi 49–55) are never treated as mobile by these two functions. Keep it.

`PlayerSectorDefended(id)` (`Queen_Command.cc:1279-1291`): any militia in the sector, or
`FindPlayerMovementGroupInSector` (a non-empty player group not between sectors, on the surface, without
in-transit/dead/POW members, not the airborne helicopter; `Strategic_Movement.cc:2843-2860`).

### 1.7 Proposed TS state (plain data, `GameState.strategic`)

```ts
interface ArmyComposition { priority: number; elitePct: number; troopPct: number; adminPct: number; desired: number; start: number }
interface GarrisonGroup { sector: number; composition: number; weight: number; pendingGroup: number }
interface PatrolGroup { size: number; priority: number; points: number[]; fillDayMod100: number; group: number; weight: number; pendingGroup: number }
interface QueenState {
  awake: boolean; extraElites: boolean; massFortificationOrdered: boolean; firstBattleMeanwhilePending: boolean;
  useAlternateQueenPosition: boolean;
  forcePercentage: number; alertness: number; alertnessDecay: number;          // i32
  reinforcementPool: number; reinforcementPoints: number; requestPoints: number; // i32, pool may go negative
  awareBattles: number; priorityPhase: number; minGroupSize: number; graceHours: number; // u8
  playerBattleVictories: number;                                               // u16
  compositions: ArmyComposition[]; garrisons: GarrisonGroup[]; patrols: PatrolGroup[];
  garrisonDenied: number[];                                                    // u8 each
}
```

Sector enemy fields live on the shared sector record of `docs/16`; `ENEMYGROUP` fields on its enemy groups. All
fixed-width writes go through `core/int.ts` (`u8` for counts and denials, `i8` for weights and composition fields,
`u16` for offence/defence points).

---

## 2. Data (`assets/externalized`, already in `data/externalized/`)

### 2.1 `strategic-ai-policy.json` (accessor `saipolicy_by_diff(x) = x[d−1]`, `externalized/policy/StrategicAIPolicy.h:9-29`)

| Key | Easy / medium / hard |
|---|---|
| `queens_pool_of_troops` | 150 / 200 / 400 |
| `initial_garrison_percentages` | 70 / 100 / 125 |
| `min_enemy_group_size` | 3 / 4 / 6 |
| `enemy_starting_alert_level` | 5 / 20 / 60 |
| `enemy_starting_alert_decay` | 75 / 50 / 25 |
| `time_evaluate_in_minutes` | 480 / 360 / 180 |
| `time_evaluate_variance` | 240 / 180 / 120 |
| `grace_period_in_hours` | 144 / 96 / 48 |
| `patrol_grace_period_in_days` | 16 / 12 / 8 |
| `num_aware_battles` | 1 / 2 / 3 (only used by the unreachable `GIVE_KNOWLEDGE_OF_ALL_MERCS`) |
| `refill_defeated_patrol_groups` | false |

### 2.2 `army-compositions.json`

| ci | Name | Prio | Elite% | Troop% | Admin% | Desired | Start |
|---|---|---|---|---|---|---|---|
| 0 | QUEEN_DEFENCE | 100 | 100 | 0 | 0 | 32 | 32 |
| 1 | MEDUNA_DEFENCE | 95 | 55 | 45 | 0 | 16 | 20 |
| 2 | MEDUNA_SAMSITE | 96 | 65 | 35 | 0 | 20 | 20 |
| 3 | LEVEL1_DEFENCE | 40 | 20 | 80 | 0 | 12 | 20 |
| 4 | LEVEL2_DEFENCE | 30 | 10 | 90 | 0 | 10 | 20 |
| 5 | LEVEL3_DEFENCE | 20 | 5 | 95 | 0 | 8 | 20 |
| 6 | ORTA_DEFENCE | 90 | 50 | 50 | 0 | 18 | 19 |
| 7 | EAST_GRUMM_DEFENCE | 80 | 20 | 80 | 0 | 15 | 15 |
| 8 | WEST_GRUMM_DEFENCE | 70 | 0 | 100 | 40 | 15 | 15 |
| 9 | GRUMM_MINE | 85 | 25 | 75 | 45 | 15 | 15 |
| 10 | OMERTA_WELCOME_WAGON | 0 | 0 | 100 | 0 | 0 | 3 |
| 11 | BALIME_DEFENCE | 60 | 45 | 55 | 20 | 10 | 4 |
| 12 | TIXA_PRISON | 80 | 10 | 90 | 15 | 15 | 15 |
| 13 | TIXA_SAMSITE | 85 | 10 | 90 | 0 | 12 | 12 |
| 14 | ALMA_DEFENCE | 74 | 15 | 85 | 0 | 11 | 20 |
| 15 | ALMA_MINE | 80 | 20 | 80 | 45 | 15 | 20 |
| 16 | CAMBRIA_DEFENCE | 50 | 0 | 100 | 30 | 10 | 6 |
| 17 | CAMBRIA_MINE | 60 | 15 | 85 | 40 | 11 | 6 |
| 18 | CHITZENA_DEFENCE | 30 | 0 | 100 | 75 | 12 | 10 |
| 19 | CHITZENA_MINE | 40 | 0 | 100 | 75 | 10 | 10 |
| 20 | CHITZENA_SAMSITE | 75 | 10 | 90 | 0 | 9 | 9 |
| 21 | DRASSEN_AIRPORT | 30 | 0 | 100 | 85 | 12 | 10 |
| 22 | DRASSEN_DEFENCE | 20 | 0 | 100 | 80 | 10 | 8 |
| 23 | DRASSEN_MINE | 35 | 0 | 100 | 75 | 11 | 9 |
| 24 | DRASSEN_SAMSITE | 50 | 0 | 100 | 0 | 10 | 10 |
| 25 | ROADBLOCK | 20 | 2 | 98 | 0 | 8 | 0 |
| 26 | SANMONA_SMALL | 0 | 0 | 0 | 0 | 0 | 0 |

A start population of exactly 20 marks a spawning location: it is neither scaled nor varied.

### 2.3 `army-garrison-groups.json` (57 garrisons, in order)

gi 0 P3 QUEEN; 1–3, 5 O3 O4 N3 N5 MEDUNA; 4 N4 MEDUNA_SAMSITE; 6–9 M3 M4 M5 N6 LEVEL1; 10–14 M2 L3 L4 L5 M6 LEVEL2;
15 N7 LEVEL1; 16–21 L2 K3 K5 L6 M7 N8 LEVEL3; 22 K4 ORTA; 23 G1, 25 H1 WEST_GRUMM; 24 G2, 26 H2 EAST_GRUMM; 27 H3
GRUMM_MINE; 28 A9 OMERTA_WELCOME_WAGON; 29–30 L11 L12 BALIME; 31 J9 TIXA_PRISON; 32 I8 TIXA_SAMSITE; 33–35 H13 H14 I13
ALMA_DEFENCE; 36 I14 ALMA_MINE; 37–40 F8 F9 G8 G9 CAMBRIA_DEFENCE; 41 H8 CAMBRIA_MINE; 42 A2 CHITZENA_DEFENCE; 43 B2
CHITZENA_MINE; 44 D2 CHITZENA_SAMSITE; 45 B13 DRASSEN_AIRPORT; 46 C13 DRASSEN_DEFENCE; 47 D13 DRASSEN_MINE; 48 D15
DRASSEN_SAMSITE; 49–55 G12 M10 G6 C9 K10 G7 G3 ROADBLOCK; 56 C5 SANMONA_SMALL.

### 2.4 `army-patrol-groups.json` (29 patrols: size, priority, points)

| pi | Size/prio | Points | pi | Size/prio | Points |
|---|---|---|---|---|---|
| 0 | 8/40 | B1 C1 C3 A3 | 15 | 13/70 | H9 I9 I10 J10 |
| 1 | 6/35 | B4 B7 C7 | 16 | 11/70 | K11 K14 J14 |
| 2 | 6/25 | A8 B8 B9 | 17 | 12/75 | J2 K2 |
| 3 | 6/30 | B10 B12 (admins) | 18 | 12/80 | I3 J3 |
| 4 | 7/45 | A11 A14 D14 (admins) | 19 | 12/80 | J6 K6 |
| 5 | 6/50 | C8 C9 D9 | 20 | 13/85 | K7 K10 |
| 6 | 12/55 | D3 G3 | 21 | 12/90 | L10 M10 |
| 7 | 10/50 | D6 D7 F7 | 22 | 12/90 | N9 N10 |
| 8 | 10/55 | E8 E11 F11 | 23 | 12/80 | L7 L8 M8 M9 |
| 9 | 10/60 | E12 E15 | 24 | 14/80 | H4 H5 I5 |
| 10 | 12/60 | G4 G7 | 25 | 7/40 | D4 E4 E5 |
| 11 | 12/65 | G10 G12 F12 | 26 | 7/50 | C10 C11 D11 D12 |
| 12 | 12/65 | G13 G15 | 27 | 8/40 | A15 C15 C16 |
| 13 | 10/65 | H15 J15 | 28 | 12/30 | L13 M13 M14 L14 |
| 14 | 14/65 | H12 J12 J13 | | | |

Consecutive points are axis-aligned (required by `AddWaypointToPGroup`, `Strategic_Movement.cc:360-458`). Some points
overlap garrison sectors (G3, G7, G12, M10 are roadblocks) despite the JSON header's rule.

### 2.5 Values after difficulty scaling (computed from §3.3 steps 3–5)

`desired/start` per ci after the easy/medium perimeter removal and `initial_garrison_percentages`:

| ci | Easy | Medium | Hard | ci | Easy | Medium | Hard |
|---|---|---|---|---|---|---|---|
| 0 | 22/22 | 32/32 | 32/32 | 14 | 7/20 | 11/20 | 13/20 |
| 1 | 11/20 | 16/20 | 20/20 | 15 | 10/20 | 15/20 | 18/20 |
| 2 | 14/20 | 20/20 | 20/20 | 16 | 7/4 | 10/6 | 12/7 |
| 3 | 8/20 | 12/20 | 15/20 | 17 | 7/4 | 11/6 | 13/7 |
| 4 | 0/0 | 10/20 | 12/20 | 18 | 8/7 | 12/10 | 15/12 |
| 5 | 0/0 | 0/0 | 10/20 | 19 | 7/7 | 10/10 | 12/12 |
| 6 | 12/13 | 18/19 | 20/20 | 20 | 6/6 | 9/9 | 11/11 |
| 7–9 | 10/10 | 15/15 | 18/18 | 21 | 8/7 | 12/10 | 15/12 |
| 10 | 0/2 | 0/3 | 0/3 | 22 | 7/5 | 10/8 | 12/10 |
| 11 | 7/2 | 10/4 | 12/5 | 23 | 7/6 | 11/9 | 13/11 |
| 12 | 10/10 | 15/15 | 18/18 | 24 | 7/7 | 10/10 | 12/12 |
| 13 | 8/8 | 12/12 | 15/15 | 25 | 5/0 | 8/0 | 10/0 |

Patrol `bSize` after scaling (pi 0..28): easy `5,4,4,4,4,4,8,7,7,7,8,8,8,7,9,9,7,8,8,8,9,8,8,8,9,4,4,5,8` (sum 197),
medium = JSON (sum 298), hard `10,7,7,7,8,7,15,12,12,12,15,15,15,12,17,16,13,15,15,15,16,15,15,15,17,8,8,10,15`
(sum 364).

### 2.6 Other files the AI reads

`strategic-map-cache-sectors.json` (E11 H5 H10 J12 M9; troops 8/10/12, variance 0/0/0), `strategic-map-underground-
sectors.json` (enemy and creature counts per difficulty, §3.2), `strategic-bloodcat-placements.json`,
`strategic-bloodcat-spawns.json`, `strategic-map-creature-lairs.json` (§12), `strategic-map-sam-sites.json` (SAM
order for the SAM meanwhiles), `strategic-map-towns.json` (town names for "important" checks, via `docs/16`),
`game.json` `progress` (§11.3) and `campaign.start_sector`.

---

## 3. Initialisation

### 3.1 When it runs

`InitNewGame` → `InitStrategicLayer` (`Strategic/Game_Init.cc:140-188`) → `SetupNewStrategicGame` (all sectors
enemy-controlled, `InitNewGameClock`, event queue cleared, daily events posted; `Strategic/StrategicMap.cc:2225-2260`)
→ `InitQuestEngine` → `InitNewCampaign` (`Strategic/Campaign_Init.cc:98-122`): `SectorInfo[]` zeroed,
`InitStrategicMovementCosts`, `RemoveAllGroups`, facility flags, `BuildUndergroundSectorInfoList`, reveal of the
start sector, **`InitStrategicAI`**, `InitStrategicStatus`. Later in `InitStrategicLayer`: `InitBloodCatSectors`
(§12.2). Full ordering belongs to `docs/15`.

**The clock reads day 1, 01:00** (`STARTING_TIME = 86400 + 3600` s, `Strategic/Game_Clock.h:100`; vanilla
`V:Strategic/GameClock.h:96`). `GetWorldHour() = 1`, which is "night" for enemy group movement (§3.6).

### 3.2 Underground enemies (`BuildUndergroundSectorInfoList`, before `InitStrategicAI`)

For each record of `strategic-map-underground-sectors.json`, in file order
(`externalized/strategic/UndergroundSectorModel.cc:13-25`): `troops = n[d−1] + R(var[d−1])`, then elites, then
creatures, each a separate statement (so the order is fixed; `R(0)` draws nothing). Non-zero entries: J9 b1 troops
8/11/15; J9 b2 creatures 4/6/8 + R(2) (no sci-fi check here); K4 b1 troops 8/10/12 + R(3), elites 5/6/7 + R(2); O3 b1
the same as K4; P3 b1 elites 8/10/14 + R(3/5/6). These are static garrisons: the Queen never reinforces underground.

### 3.3 `InitStrategicAI` (`Strategic_AI.cc:316-561`), step by step

1. Reset globals (`:318-328`): extra elites, aware battles, awake, points, phase, meanwhile flags, victories,
   alternate Queen position.
2. `giReinforcementPool`, `giForcePercentage`, `giArmyAlertness`, `giArmyAlertnessDecay`, `gubMinEnemyGroupSize`,
   `gubHoursGracePeriod` from policy (`:334-339`). **Draw 1:** `evaluate_time = 475 + time_evaluate_in_minutes +
   R(time_evaluate_variance)`; `AddStrategicEvent(EVENT_EVALUATE_QUEEN_SITUATION, evaluate_time, 0)` (`:340-342`).
   The stamp is an **absolute** minute (835..1014 on medium), i.e. day 0, before the start clock (1500 min): the
   event fires at the first event processing after the game starts (`Strategic/Game_Events.cc:59-80` processes past
   stamps without moving the clock). The comment "7:55am on day 1" is wrong; keep the behaviour.
3. Every `SectorInfo[i].ubGarrisonID = 255` (`:345-348`); `gArmyComp` = JSON copy (`:352`).
4. Easy: `LEVEL2_DEFENCE` and `LEVEL3_DEFENCE` desired = start = 0; medium: `LEVEL3_DEFENCE` (`:355-365`).
5. `gPatrolGroup`, `gGarrisonGroup` = JSON copies; `gubGarrisonReinforcementsDenied` zeroed (`:368-374`). If
   `force% ≠ 100` (`:377-405`): for every composition except QUEEN: `desired = min(20, desired·f/100)`, and `start =
   min(20, start·f/100)` unless `start == 20`; QUEEN: `desired = min(32, desired·f/100)`, `start = desired`. Patrols:
   `bSize = clamp(bSize·f/100, minGroupSize, 20)`. (Medium: nothing changes, patrols keep JSON sizes even if below
   the minimum.)
6. Garrisons, in gi order (§3.4, §3.5).
7. Patrols, in pi order (§3.6).
8. Weapon cache (§3.7).

### 3.4 Garrison population (`:409-490`)

For garrison `gi` with composition `ac`: `start = ac.start`, `eliteChance = ac.elite%`, `troopChance = ac.troop% +
eliteChance`, `adminChance = ac.admin%`; `SectorInfo[sector].ubGarrisonID = gi`.

```
if ac is ROADBLOCK: flags |= SF_ENEMY_AMBUSH_LOCATION; start = C(20) ? ac.desired : 0        // R(100)
if ac is SANMONA_SMALL: start = 0
if start ≠ 0:
    if sector ≠ P3:
        if start ≠ 20: start = start · (100 + R(51) − 25) / 100      // ±25%, truncating (unsigned arithmetic, positive)
        start = clamp(start, minGroupSize, 20)
    if adminChance ≠ 0: admins = adminChance · start / 100          // nothing else, no draws
    else repeat start times: r = R(100); r < eliteChance → elites++; else r < troopChance → troops++   // else nobody
    CAMBRIA_DEFENCE, CAMBRIA_MINE, ALMA_MINE, GRUMM_MINE: start −= admins; troops = start
    DRASSEN_AIRPORT, DRASSEN_DEFENCE, DRASSEN_MINE: admins = max(5, admins)
    TIXA_PRISON: admins = max(8, admins)
if adminChance ≠ 0 and admins < minGroupSize: admins = minGroupSize
```

Consequences (verified by reading, numbers computed): P3 = 32 elites on medium/hard (22 on easy) with 32 draws;
**A9 = 3 / 4 / 6 troops** (start 3 → scaled/varied ≤ 3, then the minimum wins; the `R(51)` and the `R(100)` per troop
are still drawn); Drassen, Chitzena, West Grumm (G1, H1), Balime and the C13/B13/D13 garrisons are admin-only
(e.g. C13 medium: start 6..10 → 80% → 4..8 admins → at least 5); Cambria/Alma/Grumm mines get `admins` plus
`start − admins` troops. Roadblocks exist in 20% of games each (desired 5/8/10 → varied).

### 3.5 Initial weights (`:492-511`)

```
weight = (ac.desired − start) · 3                  // start as modified above (Cambria/mines: troop count only)
weight > 0: weight = max(weight · ac.priority / 96, 2);       requestPoints += weight
weight < 0: weight = min(weight · (100 − ac.priority) / 96, −2); reinforcementPoints −= weight
gg.bWeight = weight
```

Quirk: the weight uses the local `start`, not the stored counts: for Cambria and the three mines `start` has had the
admins subtracted, and for Drassen/Tixa the `max(5|8, …)` bump is ignored. `RecalculateGarrisonWeight` later uses the
real counts and keeps the totals consistent because it subtracts the previous weight first (§5.1).

Then (`:515`) **draw:** `AddPeriodStrategicEventWithOffset(EVENT_CHECK_ENEMY_CONTROLLED_SECTOR, 140 − 20·d + R(4),
475 + gi, sector)`: first run at day 1 07:55 + gi minutes (`GetWorldDayInSeconds() + offset·60`,
`Game_Events.cc:254-263`), then every 120/100/80 + 0..3 minutes forever (the period is fixed at creation).

### 3.6 Patrol groups (`:519-546`)

```
n = clamp(pg.bSize + R(3) − 1, minGroupSize, 20)
g = CreateNewEnemyGroupDepartingFromSector(pg.points[1], 0, n, 0)          // troops; size n
if pi is 3 or 4: g.admins = g.troops; g.troops = 0                          // size stays n
pg.group = g.id; g.intention = PATROL; g.moveType = ENDTOEND_FORWARDS
for each non-zero point in order: AddWaypointIDToPGroup(g, point)          // the first one starts movement (below)
RandomizePatrolGroupLocation(g)
```

The first waypoint (`points[0]`, the group stands on `points[1]`) calls `InitiateGroupMovementToNextSector`
(`Strategic_Movement.cc:1643-1790`). For enemy groups on the surface it rolls sleep when `hour ≥ 21 || hour ≤ 4`
(`:1704-1712`): **at init the hour is 1**, so it draws `C(67)` and, on success, `R(121)`: `uiTraverseTime =
GetSectorMvtTimeForGroup(...) + 360 + R(121)`; otherwise the plain travel time. It sets `fBetweenSectors`, the
arrival time and posts `EVENT_GROUP_ARRIVAL`.

`RandomizePatrolGroupLocation` (`Strategic_Movement.cc:3186-3259`): deletes the arrival event; `max = (number of
waypoints) − 1`; **draw** `c = R(2·max)`; `c ≥ max` → `ENDTOEND_BACKWARDS`, `ubNextWaypointID = c − max`, the group
stands on waypoint `c − max + 1`; else `ENDTOEND_FORWARDS`, `ubNextWaypointID = c + 1`, stands on waypoint `c`. With
`gfRandomizingPatrolGroup` set: `SetEnemyGroupSector` (keeps the waypoints, clears `fBetweenSectors`), then
`InitiateGroupMovementToNextSector` again: **draws** `C(67)` [+ `R(121)`] (still night), arrival = now + traverse,
then `uiTraverseTime = 1 + R(uiTraverseTime − 1)` and the arrival is re-set to now + that (`:1756-1760`). A sleeping
patrol therefore arrives anywhere in 1..(travel + 360..480) minutes.

`GetSectorMvtTimeForGroup` and the waypoint code draw nothing.

### 3.7 Weapon cache (`:552-560`, `externalized/strategic/CacheSectorsModel.cc:21-34`)

**Draw** `R(5)` picks one of E11 H5 H10 J12 M9; `SF_USE_ALTERNATE_MAP`; `ubNumTroops = 8/10/12 + R(0)` (no draw). The
cache has no garrison id: it is never reinforced, detected from or counted in weights. (E11 is on patrol 8's route,
M9 on patrol 23's.)

### 3.8 RNG order of `InitStrategicAI` (all `R`)

```
R(time_evaluate_variance[d])                                   // 240 / 180 / 120
for gi in 0..56:
    [ROADBLOCK] R(100)
    [start ≠ 0 and sector ≠ P3 and start ≠ 20] R(51)
    [start ≠ 0 and admin% == 0] R(100) × start                 // start after the clamp
    R(4)
for pi in 0..28:
    R(3)
    R(100) [< 67: R(121)]                                      // first waypoint, night sleep roll
    R(2·(points − 1))
    R(100) [< 67: R(121)]                                      // re-initiated movement
    R(traverse − 1)                                            // skipped when traverse == 1
R(5)                                                           // cache sector
```

Preceded by the underground draws of §3.2 and followed by `InitBloodCatSectors` (no draws) and the rest of
`InitStrategicLayer` (`docs/15`).

### 3.9 State after init (for tests)

1 queen-evaluation event (day 0 stamp), 57 periodic check events, 29 arrival events, 29 enemy groups (ids 1..29 if no
other group exists), `awake = false`, `requestPoints` = sum of positive garrison weights, `reinforcementPoints` = sum
of magnitudes of negative ones (Meduna's surplus of 4 gives only −2 each because of its priority 95), all patrol
weights 0 (patrol weights are not computed at init).

---

## 4. Timing and entry points

### 4.1 `EVENT_EVALUATE_QUEEN_SITUATION` (`Strategic/Game_Event_Hook.cc:246-248`)

`EvaluateQueenSituation` (§6.1) reschedules itself at its start. Interval:

```
off = max(100 − requestPoints, 0)          // assigned to UINT32
off = off + R(off · 4)                      // up to +400% (R(0) when requestPoints ≥ 100)
off += time_evaluate_in_minutes + R(time_evaluate_variance)
if pool == 0: off ·= 10; pool += 30; post at now + off; return          // "recruiting"
post at now + off
```

The rescheduling and both draws happen **even while the Queen sleeps**.

### 4.2 `EVENT_CHECK_ENEMY_CONTROLLED_SECTOR` (param = sector, `Game_Event_Hook.cc:249-251`)

Per garrison, periodic (§3.5). `CheckEnemyControlledSector` returns immediately while asleep (§8.6).

Neither event is delayed by battles (`DelayEventIfBattleInProgress` is only used for meanwhiles); both can fire in
real-time tactical play while world time runs, never during turn-based combat (world time is frozen, `01` §3.3).

### 4.3 Entry points from other modules

| Caller | Call |
|---|---|
| Group arrival without battle (`Strategic_Movement.cc:1383-1388`, `docs/16`) | `StrategicAILookForAdjacentGroups(g)` for player and enemy groups; `true` = enemy group deleted or redirected, skip `CalculateNextMoveIntention` |
| `RemoveGroup` for enemy groups (`:1854`) | `RemoveGroupFromStrategicAILists` |
| Battle won (`SetThisSectorAsPlayerControlled(s, contested=true)`, `Player_Command.cc:188-193`) | `StrategicHandleQueenLosingControlOfSector(s)` |
| Battle lost / retreat (`ResetMovementForEnemyGroupsInLocation`, `Strategic_Movement.cc:2915-2960`) | `RepollSAIGroup` for enemy groups not between sectors |
| Strategic A* in "avoid player" mode (`Strategic/Strategic_Pathing.cc:298-312`) | `OkayForEnemyToMoveThroughSector` |
| Autoresolve (`Auto_Resolve.cc:330-345, 1781`) | `RemoveGroupFromStrategicAILists`, `RecalculateSectorWeight`, `ProcessQueenCmdImplicationsOfDeath` |
| Tactical death (`Tactical/Overhead.cc:2525`), map-edge escape (`TacticalAI/AIMain.cc:2038-2041`), end game (`Tactical/End_Game.cc:258`) | `ProcessQueenCmdImplicationsOfDeath` |
| Sector load (`StrategicMap.cc:448, 634`) | `PrepareEnemyForSectorBattle` |
| Sector unload (`StrategicMap.cc:3065`) | `EndTacticalBattleForEnemy` |
| Tactical turn ends (`Tactical/Tactical_Turns.cc:101`, `Tactical/TeamTurns.cc:203`), enemy group arriving in the loaded battle (`Strategic_Movement.cc:2253-2290`) | `AddPossiblePendingEnemiesToBattle` |
| Meanwhile implications (`Meanwhile.cc:440-505`), Kingpin death (`Overhead.cc:2400`), Queen death (`End_Game.cc:193`) | `ExecuteStrategicAIAction` |
| Mine runs out (`Strategic_Mines.cc:321`) | `StrategicHandleMineThatRanOut` |
| Loading a save (`Strategic_AI.cc:2463-2481`) | `EvolveQueenPriorityPhase(TRUE)`, `UpdateAirspaceControl`, `RepollSAIGroup` + `ValidateGroup` for every enemy group not between sectors and not in the loaded sector |

---

## 5. Weights, requests and helpers

### 5.1 `RecalculateGarrisonWeight(gi)` (`Strategic_AI.cc:1460-1499`)

```
prev = gg.bWeight; prev > 0: requestPoints −= prev; prev < 0: reinforcementPoints += prev
w = (desired − (admins + troops + elites)) · 3
w > 0: w = max(w · priority / 96, 2); requestPoints += w
w < 0: w = min(w · (100 − priority) / 96, −2); reinforcementPoints −= w
gg.bWeight = i8(w)
```

`desired` and `priority` are the *current* `gArmyComp` values (they change, §6.2, §9.6). Weight 0 only when the
garrison is exactly at its desired size. Called before every use in the selection loops, so loops observe weights
that may differ from the totals used for their random draw (keep the order exactly).

`RecalculateSectorWeight(id)` (`:1501-1511`): the first garrison with that sector.

### 5.2 `RecalculatePatrolWeight(pg)` (`:1430-1454`)

```
prev > 0: requestPoints −= prev
if pg.group ≠ 0: need = pg.size − GetGroup(pg.group).ubGroupSize; need < 0 → bWeight = 0, return
else need = pg.size
w = min(need · 3 · priority / 96, 2)            // sic: min, so 0, 1 or 2 (vanilla too, V:StrategicAI.c:2926)
pg.bWeight = w; requestPoints += w
```

Patrol demand is therefore tiny (≤ 2) and a small deficit with low priority gives 0. A destroyed patrol (`group = 0`)
keeps weight 2 forever but is never selected (§5.4), so these phantom points keep `requestPoints` positive.

### 5.3 `RecalculateGroupWeight(g)` and grace (`:1517-1543`)

For the patrol whose `group == g.id`: if `g.ubGroupSize == 0`, `TagSAIGroupWithGracePeriod` (`fillDayMod100 = (day +
patrol_grace_period_in_days) % 100`) and `group = 0`; then `RecalculatePatrolWeight`. `PermittedToFillPatrolGroup`:
`day ≥ fillDayMod100 + (day/100)·100` — the mod-100 arithmetic means a grace period crossing a day multiple of 100
expires at once (quirk).

### 5.4 Request and supply predicates

| Function | Lines | Rule |
|---|---|---|
| `GarrisonReinforcementsRequested(gi, &extra)` | 150-169 | `req = desired − existing`; `extra = u8(denied / (6 − d))`, then `extra = u8(min(extra, min(extra, 20 − req)))` — **for P3 (desired 32, easy 22) `20 − req` can be negative and wraps to ~254**; finally `req = min(20, req)` |
| `PatrolReinforcementsRequested(pg)` | 172-178 | `size − group size` (or `size` without a group) |
| `ReinforcementsAvailable(gi)` | 181-205 | `existing − desired` for `LEVEL1/2/3_DEFENCE`, `ALMA_DEFENCE`, `ALMA_MINE`; **0 for every other composition** |
| `GarrisonCanProvideMinimumReinforcements(gi)` | 3101-3124 | `existing − desired ≥ minGroupSize` and no player mercs and no militia in the sector |
| `GarrisonRequestingMinimumReinforcements(gi)` | 3127-3147 | no pending group and `desired − existing ≥ minGroupSize` |
| `PatrolRequestingMinimumReinforcements(pi)` | 3153-3178 | no pending group, `PermittedToFillPatrolGroup`, and the group exists with `size − group size ≥ minGroupSize`; a missing group qualifies only if `refill_defeated_patrol_groups` (false) — **destroyed patrols are never refilled** |
| `PlayerForceTooStrong(id, offence, &defence)` | 208-223 | `defence = green + 2·regular + 3·elite + 5·PlayerMercsInSector`; `defence > offence` |
| `ReinforcementsApproved(gi, &defence)` | 927-961 | §6.4 (mercs count **4** here, 5 above) |

### 5.5 Composition helpers (`:3578-3674, 3181-3270`)

- `CalcNumTroopsBasedOnComposition(&t, &e, total, ci)`: `t = troop%·total/100`, `e = elite%·total/100`; while `t + e
  < total`: `C(troop%)` → `t++` else `e++` (one `R(100)` per missing soldier; `SANMONA_SMALL` gives only elites).
- `ConvertGroupTroopsToComposition(g, ci)`: the above with `g.ubGroupSize`, admins = 0, size = troops + elites. Every
  group sent to a garrison loses its admins this way.
- `RemoveSoldiersFromGarrisonBasedOnComposition(gi, n)`: compute `(t, e)` for `n` with the **source** garrison's
  composition (draws); remove admins first (each admin consumes a troop quota, else an elite quota), then `t` troops
  (fallback elites), then `e` elites (fallback troops); `RecalculateGarrisonWeight(gi)`.
- `EliminateSurplusTroopsForGarrison(g, sector)`: if group + garrison > 20, remove the excess in the order group
  admins, garrison admins, group troops, garrison troops, group elites, garrison elites.

---

## 6. The decision cycle

### 6.1 `EvaluateQueenSituation` (`Strategic_AI.cc:1930-2017`)

```
reschedule (§4.1); if pool == 0: recruit and return
if !awake: return
EvolveQueenPriorityPhase(false)                                   // §6.2
UpgradeAdminsToTroops()                                           // §6.3
if requestPoints ≤ 0 or (reinforcementPoints ≤ 0 and pool ≤ 0): return
r = R(requestPoints)
for gi in order:
    RecalculateGarrisonWeight(gi); w = bWeight
    if w > 0:
        if r < w and !pending and EnemyPermittedToAttackSector(null, sector) and GarrisonRequestingMinimum(gi):
            if ReinforcementsApproved(gi, &def): SendReinforcementsForGarrison(gi, def, null)
            return                                                 // approved or denied: one decision per call
        r −= w
for pi in order:
    RecalculatePatrolWeight(pi); w = bWeight
    if w > 0:
        if r < w and !pending and PatrolRequestingMinimum(pi): SendReinforcementsForPatrol(pi, null); return
        r −= w
```

Once `r` has passed below a weight without the candidate qualifying, `r` is negative and the next positive-weight
candidate that qualifies wins ("weighted start, then first eligible"). One decision per evaluation.

### 6.2 `EvolveQueenPriorityPhase(force)` — the Queen's mood (`:2494-2673`)

```
phase = CurrentPlayerProgressPercentage() / 10                  // current, not highest
if !force and phase == priorityPhase: return
priorityPhase = phase
owned[ci], total[ci] over garrisons (owned = StrategicMap enemy-controlled)
for each ci except QUEEN, MEDUNA, MEDUNA_SAMSITE, LEVEL1/2/3, OMERTA_WELCOME_WAGON, ROADBLOCK:
    f = total ? owned·100/total − 50 : −50;  f = f · phase / 10
    if comp.priority ≠ 0: comp.priority = clamp(orig.priority + f/2, 0, 100)
    comp.desired = clamp(orig.desired · (100 + f) / 100, 6, 20)
    if extraElites and f ≥ 15 and comp.elite% ≠ 0: elite% = min(100, elite% + 5d); troop% = max(0, troop% − 5d)
if extraElites: extraElites = false; for each garrison of a non-excluded ci with f(unscaled by phase) ≥ 15, not the
    loaded sector: promote admins, then troops, to elites until elites = elite%·n/100
RecalculateGarrisonWeight for every garrison
```

`orig` is the **unscaled JSON** (`GCM->getArmyCompositions()`), so the first phase change (progress ≥ 10%) or any save
load (forced) discards the difficulty scaling of town compositions (easy goes back up to JSON sizes ± f, hard down)
and undoes `StrategicHandleMineThatRanOut`'s `/4` (§9.6). `SANMONA_SMALL` (not excluded) gets desired 6 but keeps
priority 0; it can never be approved (offence 0, §6.4), so San Mona stays empty. Vanilla identical
(`V:StrategicAI.c:4091-4230`). The extra-elites path is unreachable in practice (§9.5).

### 6.3 `UpgradeAdminsToTroops` (`:3277-3351`)

`minPrio = 100 − 10·HighestPlayerProgressPercentage()` (≤ 0 from 10% progress). For each garrison (skip the loaded
sector id, i.e. `gWorldSector.AsByte()` regardless of z) with admins and composition priority `> minPrio`: for each
admin, `C(priority)` → admin becomes troop. Then each enemy group in list order (skip empty, vehicles, groups in
`gWorldSector`): priority = its patrol's `bPriority` if intention is `PATROL` (assert it has one), else 50; same rule.
All draws in that order.

### 6.4 `ReinforcementsApproved(gi, &defence)` (`:927-961`)

```
defence = green + 2·regular + 3·elite militia + 4·PlayerMercsInSector(sector)          // u16
offence = (admin%·2 + troop%·3 + elite%·4 + denied[gi]) · desired / 100                // u16, current comp values
if offence > defence: return true
if denied[gi] + offence > defence: return true                                         // "augmented force"
denied[gi] = u8(denied[gi] + priority/2); return false                                 // wraps past 255
```

### 6.5 `SendReinforcementsForGarrison(dst, defence, optGroup)` (`:1644-1833`)

```
req = GarrisonReinforcementsRequested(dst, &extra)
max = desired + desired·priority/50                         // 1..3 × desired, ≤ 60
if req + extra > max: limited = true; extra = max − req
req += extra; if req ≤ 0: return
if optGroup:                                                 // reassignment (§7.2)
    pending[dst] = g; ConvertGroupTroopsToComposition(g, dst comp); MoveSAIGroupToSector(g, dst, STAGE, REINFORCEMENTS); return
r = R(reinforcementPoints + pool)
if r < pool: QUEEN_POOL:
    if P3 not enemy-controlled or pool == 0: return
    n = min(req, pool)
    if n·3 < defence: denied[dst] += priority/2; return; else denied[dst] = 0
    if extra and limited and n == max: if !C((n + extra)·100/defence): return     // defence 0 → division by zero (§17)
    g = CreateNew…(P3, 0, n, 0); Convert(g, dst comp); g.ubOriginalSector = dst; pool −= n; g.moveType = ONE_WAY
    pending[dst] = g; MoveSAIGroupToSector(g, dst, STAGE, extra ? STAGING : REINFORCEMENTS); return
src = ChooseSuitableGarrisonToProvideReinforcements(dst, req)
if src == −1: goto QUEEN_POOL
if src sector ≠ gWorldSector:                                  // nothing at all happens when it is the loaded sector
    avail = ReinforcementsAvailable(src); if avail ≤ 0: return    (logged as an error)
    n = min(req, avail)
    if n > max − extra: n = max − extra
    else if (n + extra)·3 < defence: denied[dst] += priority/2; return
    else denied[dst] = 0
    if n + extra == max and defence: if !C((n + extra)·100/defence): return
    g = CreateNew…(src sector, 0, n, 0); Convert(g, dst comp); RemoveSoldiersFromGarrisonBasedOnComposition(src, size)
    g.ubOriginalSector = dst; g.moveType = ONE_WAY; pending[dst] = g
    if extra: g.ubPendingReinforcements = extra; Move(g, dst, STAGE, STAGING) else Move(g, dst, STAGE, REINFORCEMENTS)
```

Notes: group sizes can exceed 20 (up to `max`, 60) — the tactical side handles that through pending enemies (§10.4).
The pool path stages with intention `STAGING` but without `ubPendingReinforcements`. Draw order on the source path:
`R(points + pool)`, the draws inside `ChooseSuitable…`, optional `C`, then `Convert` draws, then `RemoveSoldiers…`
draws, then the movement's night-sleep roll (§7.1).

### 6.6 `ChooseSuitableGarrisonToProvideReinforcements(dst, req)` (`:1537-1641`)

1. Destination in B13 C13 D13 D15 (Drassen + SAM) or F8 F9 G8 G9 H8 (Cambria): take the 4 garrisons starting at the
   first `ALMA_DEFENCE` (gi 33..36), recalculating each; pick the most negative weight (strictly below the running
   best, which starts at 0) that `CanProvideMinimum`; if found and `ReinforcementsAvailable·100 ≥ req·67`, return it.
2. `r = R(reinforcementPoints)`; for each garrison: recalc, `w = −bWeight`; if `w > 0`: if `r < w` and
   `CanProvideMinimum` and available ≥ 67% → return; `r −= w` (always).
3. First garrison with `w > 0`, `CanProvideMinimum` and available ≥ 67%.
4. `r = R(reinforcementPoints)`; first with `w > 0` and `CanProvideMinimum` and `r < w` (no 67% check) → return; `r
   −= w` only for garrisons that can provide.
5. `−1`.

Because `ReinforcementsAvailable` is 0 for non-spawning compositions, steps 2–3 only ever pick LEVEL1/2/3 and Alma;
step 4 can pick e.g. Meduna (surplus 4), after which §6.5 aborts with "no reinforcements available".

### 6.7 `SendReinforcementsForPatrol(pi, optGroup)` (`:1836-1919`)

```
req = PatrolReinforcementsRequested(pg); if req ≤ 0: return
if optGroup: pending = g; Move(g, points[1], EVASIVE, REINFORCEMENTS); return
r = R(reinforcementPoints + pool)
if r < pool: n = min(req, pool); (n == 0: assert, return)
    g = CreateNew…(P3, 0, n, 0); g.ubOriginalSector = points[1]; pool −= n; pending = g
    Move(g, points[1], EVASIVE, REINFORCEMENTS); return          // no P3-ownership check here (quirk)
r −= pool
for each garrison: recalc; w = −bWeight; if w > 0:
    if r < w and its sector ≠ gWorldSector:
        n = min(req, ReinforcementsAvailable(src))                // 0 for non-spawning → an empty group (quirk)
        g = CreateNew…(src sector, 0, n, 0); g.ubOriginalSector = points[1]; pending = g
        RemoveSoldiersFromGarrisonBasedOnComposition(src, size); Move(g, points[1], EVASIVE, REINFORCEMENTS); return
    r −= w
```

No `CanProvideMinimum` check and no composition conversion (troops only). If the chosen garrison is the loaded sector
the loop simply continues with a negative `r`.

---

## 7. Group orders

### 7.1 `MoveSAIGroupToSector(&g, dst, code, intention)` (`:3677-3708`)

If between sectors, `SetEnemyGroupSector(g, g.sector)` (teleport back, waypoints removed). `intention = …`,
`moveType = ONE_WAY`. If already in `dst`: `EvaluateGroupSituation(g)`; a `true` result nulls the caller's pointer.
Then path (`docs/16`): `STAGE` = avoid player-influenced sectors and stop one short (fallback: direct path stopping
one short), `EVASIVE` = avoid player-influenced sectors (fallback: direct), `DIRECT` = plain A*. "Player influenced"
= any merc, any militia, or `!OkayForEnemyToMoveThroughSector` for every path sector except the destination
(`Strategic_Pathing.cc:298-312`).
The new route is turned into waypoints (`RebuildWayPointsForGroupPath`, `Strategic_Pathing.cc:799-895`); the first
waypoint starts the movement, which for an enemy group on the surface between 21:00 and 04:59 draws `C(67)` and on
success `R(121)` (sleep 360..480 extra minutes, `Strategic_Movement.cc:1704-1712`). A one-node path (already there)
adds nothing and the group stays.

`OkayForEnemyToMoveThroughSector(id)` (`:572-581`): false while `uiTimeLastPlayerLiberated` is set and
`liberated + graceHours·3600 > now`.

### 7.2 `EvaluateGroupSituation(g)` — arrival at the final destination (`:974-1136`)

Only while awake. Returns true when the group was deleted or redirected.

- `PURSUIT`: lost the target → `ReassignAIGroup`, true.
- `REINFORCEMENTS`:
  1. A garrison in this sector whose `pending == g`: if not P3: `EliminateSurplusTroopsForGarrison`, add the
     group's admins/troops/elites to the garrison; at a SAM site set `bSAMCondition = 100` and `UpdateSAMDoneRepair`.
     At P3 (`:1021-1042`): if elites < 20 and elites + size ≥ 20, the pool gains **`20 − elites`** (the number that
     filled the guard, not the real overflow `size − (20 − elites)`) and elites = 20 (`MAX_STRATEGIC_TEAM_SIZE`, not
     32); if elites + size < 20, elites += size (the whole group counts as elites); if elites ≥ 20, pool += size. Then `SetThisSectorAsEnemyControlled`,
     `RemoveGroup`, `RecalculateGarrisonWeight`, true.
  2. A patrol with `points[1] == sector` and `pending == g`: clear pending. If the patrol has a different live group:
     **warp** the counts into it ("cheat"), truncate it to 20 (removing admins, then troops, then elites from both
     records), `RemoveGroup(g)`, recalc, `ValidateLargeGroup`. Else `g` becomes the patrol: `group = g`, intention
     `PATROL`, `ENDTOEND_FORWARDS`, waypoints rebuilt from `points[0..3]` (the first one starts movement, with the
     night sleep roll of §3.6), recalc. True.
  3. Otherwise false: the group stays where it is (e.g. groups sent to P3 by `SendGroupToPool` without being pending
     stay there as a mobile group, inferred).
- Any other intention except `STAGING` (i.e. `PATROL` at a final destination, `NO_INTENTIONS`): `ReassignAIGroup`,
  true. `STAGING`: false (waits for `CheckEnemyControlledSector`, §7.5).

### 7.3 `ReassignAIGroup(&g)` (`:3393-3521`)

```
g.ubSectorIDOfLastReassignment = sector; RemoveGroupFromStrategicAILists(g); SetEnemyGroupSector(g, sector)
if requestPoints ≤ 0: SendGroupToPool(g); return
r = R(requestPoints); reloop = NONE
for gi: recalc; w > 0:
    if r < w:
        if !pending and permitted and GarrisonRequestingMinimum and ReinforcementsApproved(gi): SendReinforcementsForGarrison(gi, def, g); return
        if reloop == NONE: reloop = gi − 1; r = 0         // gi == 0 gives size_t(−1) == NONE again (quirk)
    r −= w
if reloop ≠ NONE: for gi in 0..reloop: recalc; w > 0 and same conditions → send, return
if reloop == NONE:
    for pi: recalc; w > 0: if r < w and eligible → SendReinforcementsForPatrol(pi, g), return
                           if reloop == NONE: reloop = pi − 1; r = 0
                           r −= w
else reloop = patrols − 1
for pi in 0..reloop: recalc; w > 0 and eligible → send, return        // reloop still NONE → runs past the array (quirk)
TransferGroupToPool(g)                                                 // instant: pool += size, RemoveGroup
```

`ReinforcementsApproved` here also increments denials for rejected garrisons. `SendGroupToPool(g)` (`:3379-3390`):
at P3 → `TransferGroupToPool`, else `Move(g, P3, EVASIVE, REINFORCEMENTS)` (not pending anywhere, see §7.2.3).

### 7.4 Bookkeeping

- `RemoveGroupFromStrategicAILists(g)` (`:1396-1423`): first patrol with `group == g` → `group = 0` + recalc, return;
  or `pending == g` → 0, return; then garrisons `pending == g` → 0. One match only.
- `RepollSAIGroup(g)` (`:3545-3575`): at final destination → `EvaluateGroupSituation`; patrol member → recalc +
  `CalculateNextMoveIntention`; garrison pending → recalc + `CalculateNextMoveIntention`.
- `RedirectEnemyGroupsMovingThroughSector(s)` (`:3713-3740`): every `ONE_WAY` enemy group that
  `GroupWillMoveThroughSector(g, s)` is teleported to its sector and re-sent `EVASIVE` to its final waypoint with the
  same intention.

### 7.5 Staging (`CheckEnemyControlledSector` first half, `:1308-1355`)

For the garrison of the checked sector with a pending group that is at its final destination: if
`ubPendingReinforcements > 4`: `k = 3 + R(3)` troops are added (size += k, pending −= k), `RecalculateGroupWeight`;
else all pending troops are added; else (nothing pending) if the group is not in the garrison sector,
`Move(g, garrison sector, DIRECT, g.intention)`. So a staged group waits one sector short until the next periodic
check of its target (80–123 min), tops up out of thin air, then attacks directly.

---

## 8. Detection and opportunism

### 8.1 Notice rolls (`:790-859`, two identical functions)

```
if awareBattles or autoAware: true
if DayTime() (07:00–20:59): if C(alertness): alertness = max(0, alertness − decay); true
                             else alertness++; false
night: if C(alertness/3): alertness = max(0, alertness − decay); true
       else: if C(33): alertness++; false
```

### 8.2 `EnemyPermittedToAttackSector(&g?, id)` (`:584-658`)

`permitted = OkayForEnemyToMoveThroughSector(id)`. With a group pointer and a garrison whose pending group is that
group: permitted and at final destination → **true** (skips the rest); not permitted → `ReassignAIGroup(g)` (may null
it). Then false if not permitted; special sectors: F10 false while `FACT_HILLBILLIES_KILLED` is false; A9/A10 false
before minute 3345 (day 2 07:45); B13/C13/D13 false before 4710 (day 3 06:30); C5/C6/D5 = `FACT_KINGPIN_DEAD`; G1
false if G2 and (H1 or H2) are player-defended; H2 false if **H2** and (G1 or G2) are defended (checks itself,
quirk); otherwise true.

### 8.3 `AdjacentSectorIsImportantAndUndefended(id)` (`:245-262`)

Town id not Omerta, San Mona, Estoni; no garrison enemies (groups ignored); `ubTraversability[THROUGH] == TOWN`; not
`PlayerSectorDefended`.

### 8.4 `StrategicAILookForAdjacentGroups(g)` (`:1165-1304`)

**Asleep:** an enemy group at its final destination wakes the Queen (`WakeUpQueen`, §9.1) and, if in A9 or P3, is
sent to the pool; then, unless just woken, return false. Patrols are `ENDTOEND`, never "at final destination", so
only `ONE_WAY` groups (created by meanwhile actions) can do this. Player arrivals do nothing while asleep.

**Enemy group:** at final destination → `EvaluateGroupSituation`. Else for N (−16), W (−1), S (+16), E (+1), each
within the map and `EnemyPermittedToAttackSector(&g, adj)` (the group may be nulled by it; then stop):
1. a player group in `adj` (`FindPlayerMovementGroupInSector`) and a notice → `HandlePlayerGroupNoticedByPatrolGroup`;
2. else militia in `adj` and a notice → `HandleMilitiaNoticedByPatrolGroup`;
3. else important-and-undefended and a notice → `HandleEmptySectorNoticedByPatrolGroup`.
Each `else if` draws its own notice roll only when its first condition holds. The first handled direction returns.

**Player group** (always returns false): surface only, own sector permitted; for N, E, S, W:
`EnemyNoticesPlayerArrival` (`:1139-1158`): any enemy group in `adj` (`FindEnemyMovementGroupInSector`: first in list,
between-sector groups included, vehicles not excluded) and a notice → `HandlePlayerGroupNoticedByPatrolGroup`; else a
garrison with enemies and a notice → `HandlePlayerGroupNoticedByGarrison`. First success stops.

### 8.5 Handlers

- `HandlePlayerGroupNoticedByPatrolGroup(pg, eg)` (`:670-709`): `offence = 2·admins + 4·troops + 6·elites` of the
  enemy group; `target = pg.next.x ? pg.next : pg.sector`. If `PlayerForceTooStrong(pg.sector)` or `target` has a
  garrison: `RequestAttackOnSector(pg.sector, defence)` (= `SendReinforcementsForGarrison` for the garrison of that
  sector if it has no pending group, `:229-242`), false. Else `Move(eg, target, DIRECT, PURSUIT)`, true. The patrol
  slot keeps pointing at the group until it arrives and is reassigned.
- `HandlePlayerGroupNoticedByGarrison(pg, id)` (`:716-766`): only if the player group is at its final destination.
  Offence from the garrison counts; too strong → request attack. Else `approved = enemies − desired/2`; if
  `approved·2 > pg.size·3` and `approved > minGroupSize`: group of `approved` troops from the garrison sector,
  `Convert` (dst = own composition), `Move(DIRECT, REINFORCEMENTS)` to the player's sector, then
  `RemoveSoldiers…(own garrison)`. That group is not pending anywhere; after its battle it stays (inferred).
- `HandleMilitiaNoticedByPatrolGroup(id, eg)` (`:769-787`): too strong → request attack; else `Move(eg, id, DIRECT,
  REINFORCEMENTS)`; always false.
- `HandleEmptySectorNoticedByPatrolGroup(g, id)` (`:862-886`): only for a garrison sector without pending group:
  `RemoveGroupFromStrategicAILists(g)` (the patrol is abandoned), `pending = g`, `Move(g, id, DIRECT,
  REINFORCEMENTS)`, true.
- `HandleEmptySectorNoticedByGarrison(src, dst)` (`:889-924`): both garrisons, dst without pending, `avail = src
  enemies ≥ 2·minGroupSize`: group of `avail/2` troops, `Convert(dst comp)`, `RemoveSoldiers…(src)`, pending, `Move
  (DIRECT, REINFORCEMENTS)`. No loaded-sector guard (quirk: can split the garrison the player is fighting).

### 8.6 `CheckEnemyControlledSector(id)` second half (`:1356-1392`)

Asleep → return (before staging too). If the sector still has garrison enemies: for N (−16), E (+1), S (+16), W
(−1): permitted, important-and-undefended and a notice → `HandleEmptySectorNoticedByGarrison`, return.

---

## 9. Reactions, triggers and growth

### 9.1 Waking the Queen

`WakeUpQueen` (`:3023-3031`): `awake = true`; first time only: `MassFortifyTowns`. Triggers:
1. Meanwhile `END_OF_PLAYERS_FIRST_BATTLE` on hard only (`Meanwhile.cc:445-451`).
2. Meanwhiles `DRASSEN/CAMBRIA/ALMA/GRUMM/CHITZENA/BALIME_LIBERATED` (`Meanwhile.cc:452-462`), posted 5 minutes after
   a whole town is liberated (`Meanwhile.cc:651-667`, called from `docs/18`).
3. `gusPlayerBattleVictories == 5 − d` (4/3/2) in `StrategicHandleQueenLosingControlOfSector` — every contested
   surface win counts, garrison or not, including re-wins of owned sectors (inferred from the call site).
4. An enemy `ONE_WAY` group reaching its final destination while asleep (§8.4).
5. Debug toggle (not ported). `STRATEGIC_AI_ACTION_QUEEN_DEAD` puts her back to sleep (`End_Game.cc:193`).

### 9.2 `MassFortifyTowns` (`:3036-3069`)

For each garrison below desired with no pending group, not `ROADBLOCK`, `EnemyPermittedToAttackSector(null)`:
`RequestHighPriorityGarrisonReinforcements(gi, desired − existing)`. Then if A9 has troops: a group of them leaves
A9 (A9 troops = 0), intention `PATROL`, `ONE_WAY`, `ReassignAIGroup`, `RecalculateSectorWeight(A9)`.

`RequestHighPriorityGarrisonReinforcements(gi, n)` (`:2905-3017`): nearest patrol group (Manhattan distance from its
current sector; ties keep the first) with size ≥ n. If found and `size > n` and `size − n ≥ minGroupSize`: split a new
group in its sector taking troops first, then admins, then elites; pending; recalc the patrol; `Move(EVASIVE,
REINFORCEMENTS)`. Else the whole group leaves its patrol (`group = 0`, recalc), is teleported to its sector and sent.
No patrol big enough: a palace group of `n` troops, `ONE_WAY`, `REINFORCEMENTS`, pending, `pool −= n` **without a
lower bound** (the pool can go negative; recruitment only triggers at exactly 0, §4.1). No draws except the
waypoint/sleep draws of the moves.

### 9.3 `StrategicHandleQueenLosingControlOfSector(s)` (`:2841-2897`)

Underground → return; still enemy-controlled → error, return. `victories++` (wake at `5 − d`). No garrison → return.
Grace: first liberation `uiTimeLastPlayerLiberated = now`; later ones `now − R(graceHours·1800)` (shorter grace).
Pending group → `ReassignAIGroup`, pending = 0. Then `RedirectEnemyGroupsMovingThroughSector(s)`.

### 9.4 Meanwhile implications (`Meanwhile.cc:440-505`)

Run when the scene ends **or is skipped**; scheduled at `now + 5 min` (`ScheduleMeanwhileEvent`, `:170-200`),
delayed by `180 + R(121)` seconds while a battle is on (`Game_Event_Hook.cc:45-56`).

| Meanwhile | AI effect |
|---|---|
| END_OF_PLAYERS_FIRST_BATTLE | hard: wake; `HandleNPCDoAction(QUEEN, SEND_SOLDIERS_TO_BATTLE_LOCATION)` is a **no-op** (`Tactical/Interface_Dialogue.cc:3226-3231`) |
| *_LIBERATED (6 towns) | wake; Drassen also calls the no-op `SEND_SOLDIERS_TO_DRASSEN` |
| NW_SAM / NE_SAM / CENTRAL_SAM (SAM 1–3 liberated; SAM 4 Meduna has no scene) | `ExecuteStrategicAIAction(NPC_ACTION_SEND_TROOPS_TO_SAM, sam)` |

### 9.5 `ExecuteStrategicAIAction(code, sector)` (`:2676-2836`)

| Code | Reachable | Effect |
|---|---|---|
| `WAKE_QUEEN` 1 | yes | `WakeUpQueen` |
| `KINGPIN_DEAD` 2 | yes | nothing (body commented out); San Mona opens through §8.2 |
| `QUEEN_DEAD` 3 | yes | `awake = false` |
| `NPC_ACTION_SEND_TROOPS_TO_SAM` | yes | `n = 3 + d + HighestProgress/15`; `pool = max(0, pool − n)`; elite group of `n` from P3, `Move(STAGE, REINFORCEMENTS)`; the SAM garrison's previous pending group is removed from the lists and reassigned after the new group becomes pending |
| `SEND_SOLDIERS_TO_DRASSEN` (30), `…_BATTLE_LOCATION`, `…_TO_OMERTA` (259), `ADD_MORE_ELITES` (260), `GIVE_KNOWLEDGE_OF_ALL_MERCS` (261) | **no** | implemented in `ExecuteStrategicAIAction` but no caller passes these codes: NPC scripts and meanwhiles route them to `HandleNPCDoAction`, which ignores them (vanilla too, `V:Tactical/InterfaceDialogue.c:3037-3042`). Port only for mods; documented sizes: Drassen `3 + 3d` (D13 50%, else B13 60%, else C13), battle location `4d` (the garrison test indexes `gArmyComp[!composition]`, a typo), Omerta `6d` troops + `6d/7` elites |

### 9.6 `StrategicHandleMineThatRanOut(id)` (`:3071-3098`)

B2 → A2, B2 priorities `/4`; D13 → B13, C13, D13; H8 → F8, F9, G8, G9, H8; I14 → H13, H14, I13, I14. Applied to the
shared composition (so e.g. all `CAMBRIA_DEFENCE` garrisons), undone by the next `EvolveQueenPriorityPhase` (§6.2).

### 9.7 Growth, pool and difficulty summary

The pool only grows by: +30 when an evaluation finds it at exactly 0 (and the next evaluation is 10× later);
`TransferGroupToPool`; P3 overflow (§7.2). It shrinks by palace spawns. There is no other recruitment and no income
model for the Queen. Difficulty enters through: policy (§2.1), perimeter removal and force % (§3.3), check period
`140 − 20d`, denial divisor `6 − d`, wake count `5 − d`, hard wake after the first battle, SAM squad `3 + d + p/15`,
extra-elite `5d` (dead), cache 8/10/12, underground counts, bloodcats and creatures (§12), and
`CalcDifficultyModifier` (§11).

---

## 10. Queen_Command: the tactical side

### 10.1 `PrepareEnemyForSectorBattle` (`Queen_Command.cc:308-527`)

Called on sector load unless in a meanwhile (except INTERROGATION), and on re-entering the loaded sector when no
enemy is in it (`StrategicMap.cc:448, 634`).

```
pendingEnemies = false
underground → §10.10
if gpBattleGroup is an enemy group:                        // the enemy entered a sector the player already held
    HandleArrivalOfReinforcements(bg); then for every other non-vehicle enemy group in that sector with all
    in-battle counts 0: HandleArrivalOfReinforcements(it); return          // all of them enter from the edges (§10.4)
if NumEnemiesInSector > 32: pendingEnemies = true
if SF_USE_MAP_SETTINGS (never set): counts = the map's enemy placements by class; in-battle = 0
else A = admins − adminsInBattle, T = troops − …, E = elites − …
nStat = A + T + E (u8); if nStat > 32: A = min(A, 32); T = min(T, 32 − A); E = min(E, 32 − A + T)   // sic: + T
sector in-battle += A, T, E
slots = free enemy slots (32 when the sector was just loaded) − (A + T + E)
for every group in list order (break when slots == 0), surface only, in this sector, not a vehicle:
    enemy group: admins, then troops, then elites not yet in battle, each limited by slots (overflow → pendingEnemies)
    player group not between sectors with members: RemoveGroupWaypoints (the "TEMP" hack; skipped once slots hit 0)
if A + T + E == 0: return
AddSoldierInitListEnemyDefenceSoldiers(A, T, E)            // stationary and mobile together, §10.2
slots = 32 − nStat
for each enemy group in this sector (until slots == 0):
    give ubGroupID = group to the first enemy soldiers in team order with ubGroupID 0 whose class still has quota in
    the group's in-battle counts (admins/troops/elites), at most ubGroupSize of them
```

Group membership of individual soldiers is therefore by team-slot order, not by placement; that only matters for
which strategic record a death decrements (§10.7).

### 10.2 `AddSoldierInitListEnemyDefenceSoldiers(A, T, E)` (`Tactical/Soldier_Init_List.cc:616-1025`)

The class mix. Owned in detail by `docs/06` §7.2, but M4 must port it fully (the M3 sandbox fills only ARMY
placements in map order, `src/sim/tactical/creation.ts` `chooseEnemyPlacements`):

1. `SortSoldierInitList` (`:250-410`): placements with soldiers to the end; then the blocks are moved to the front so
   the order becomes [priority+detailed] [priority] [detailed] [basic] [existing]. Each of the first three blocks is
   built by moving nodes to the front one by one, so it ends up in **reverse map order** (inferred from the list
   code; the basic block keeps map order).
2. Count enemy slots per class (admin, elite, army) and per block (PD, P, D, B) (`:649-685`).
3. For each block PD, P, D: for class admin, elite, army (enum order 1, 2, 3): walk the block; for each matching free
   enemy placement: take it if `slots ≤ total || R(slots) < total`, then `slots−−`. **Strac bug in the PD pass**: the
   loop body advances `curr` and so does `FOR_EACH`, so only every second node of the PD block is examined
   (`:712-742`; vanilla walks every node, `V:Tactical/SoldierInitList.c` same function). Port as Strac (oracle
   reference) and list it.
4. "Priority slots must be filled" (`:865-904`): every still-free priority enemy placement (PD and P) takes a class by
   `R(remaining)`: `< E` elite, `< E + T` army, else admin (the placement's class is overwritten).
5. Block B with the slot rule per class (`:906-958`).
6. Leftovers (`:963-1023`): count all free enemy placements; walk them all, accept with the slot rule, class by
   `R(remaining)` as in step 4.

Every accepted placement goes through `AddPlacementToWorld` (stats, palettes, `GenerateRandomEquipment` with
`CalcDifficultyModifier`, §11); a failure (no free slot) stops the whole function.

### 10.3 Revisiting a sector (summary; `docs/16` owns persistence)

If an enemy temp file younger than 300 minutes exists (`Tactical/Enemy_Soldier_Save.cc:127-133`), its soldiers
replace placements, and only the strategic excess over them (`GetNumberOfEnemiesInSector`, with the H1 quirk) is added
through §10.2 (`:282-292`).

### 10.4 Pending enemies and mid-battle arrivals (`Queen_Command.cc:914-1047`)

There is **no pull of reinforcements from adjacent garrisons** in vanilla or Strac (that is a 1.13 feature). Enemies
join a running battle only when (a) a battle had more than 32 enemies, or (b) an enemy group's strategic movement
ends in the loaded battle sector (`CheckConditionsForBattle` → `HandleArrivalOfReinforcements`,
`Strategic_Movement.cc:716-727, 2253-2290`: `pendingEnemies = true`, `ResetMortarsOnTeamCount`,
`AddPossiblePendingEnemiesToBattle`). Arrivals need running world time, so they happen only in real time.

`AddPossiblePendingEnemiesToBattle` (only if `pendingEnemies`): `slots` = free enemy slots; for each enemy group in
list order in the loaded surface sector: while it has members not in battle and slots remain, add a troop if any left,
else an elite, else an admin (in-battle counters++). If any were added: the entry side is where the group came from, using `ubPrev` if valid,
else `ubNext` (`sector.x < prev.x` → `INSERTION_CODE_EAST`, `>` → WEST, `sector.y < prev.y` → SOUTH, `>` → NORTH),
then `AddEnemiesToBattle`. At the end, `slots ≠ 0` → `pendingEnemies = false`. Called at the end of every
tactical "turn" (`HandleTacticalEndTurn`, real time every 5 s and in TB) and in `EndTurn` when no interrupt is queued.

`AddEnemiesToBattle(g, code, a, t, e)`: facing SE/SW/NW/NE for N/E/S/W; `ChooseMapEdgepoints(code, a + t + e)`
(`TileEngine/Map_Edgepoints.cc:875-926`: primary edgepoints minus water tiles; all of them if not more than needed,
else each kept with `R(remaining slots) < remaining wanted`); then per soldier `roll = R(n−−)`: `< e` elite, `< e + t`
army, else admin; `TacticalCreateEnemySoldier(class)` (`Tactical/Soldier_Create.cc:1754-1796`: two
`RandomizeRelativeLevel` (`R(10)` each, location-adjusted), `bAttitude = R(MAXATTITUDES)`, `SEEKENEMY`, random body,
basic-placement generation, Mike/Iggy upgrade for elites, `TacticalCreateSoldier`, noise target at the map centre ±
`R(…)` twice in one expression — argument order is compiler-defined); `ubGroupID`; insertion at the next edgepoint
(`INSERTION_CODE_GRIDNO`) or, when they run out, the entry code; `UpdateMercInSector`.

### 10.5 `EndTacticalBattleForEnemy` (`:241-289`)

On leaving the sector: sector in-battle counts = 0 and **`ubNumCreatures = 0`**; group in-battle counts = 0 for groups
in the sector; `gfProfiledEnemyAdded = false`; if militia and enemies (or creatures) are still alive in the sector:
`GLOBAL_LOYALTY_ABANDON_MILITIA` (`docs/18`).

### 10.6 Counts during a battle

Strategic counts include the soldiers on the map; `*InBattle` marks how many of them are already placed. Nothing
reconciles them except deaths (§10.7). SAI decisions during real-time tactical play skip the loaded sector in
`SendReinforcementsFor*`, `UpgradeAdminsToTroops` and `EvolveQueenPriorityPhase`'s promotions, but not in §8.5's
garrison handlers.

### 10.7 `ProcessQueenCmdImplicationsOfDeath(s)` (`:550-902`)

1. `EvaluateDeathEffectsToSoldierInitList` (`docs/16`).
2. MIKE, or IGGY while `FACT_IGGY_AVAILABLE_TO_ARMY`: decrement the sector's (or underground's) elites and elites in
   battle (if non-zero). The generic path below runs too, so a stationary Mike/Iggy is decremented twice (inferred).
3. Return if neutral or not `ENEMY_TEAM`/`CREATURE_TEAM`.
4. `ubGroupID ≠ 0`: the group's class counter and in-battle counter (each only if non-zero), `size−−`,
   `RecalculateGroupWeight` (destroyed patrol → grace, §5.3), `RemoveGroup` when empty.
5. Else surface (or autoresolve active, using `GetAutoResolveSectorID()`): the sector's class and in-battle counters;
   creatures: `ubNumCreatures`/`ubCreaturesInBattle`, bloodcats: `bBloodCats−−`; then
   `RecalculateSectorWeight(s.sSector)`.
6. Underground: the record's counters; for creatures also cancel pending creature attacks when a non-J9 level is
   cleared, post `EVENT_CHECK_IF_MINE_CLEARED` in 15 s, and the queen monster ends the creature quest (§12.1).

The many "counters are bad" checks only log.

### 10.8 Enemies leaving (retreat)

An enemy that walks off the map edge (`docs/13` §8.3; `HandleAITacticalTraversal`, `TacticalAI/AIMain.cc:2013-2044`)
goes through `ProcessQueenCmdImplicationsOfDeath` and `TacticalRemoveSoldier`: **strategically it is dead**; it does
not join any group or adjacent sector. This closes the deviation "Map-edge escapes" once wired. Enemy groups whose
battle ends with a player retreat or defeat are reset by `ResetMovementForEnemyGroupsInLocation` (→ `RepollSAIGroup`,
§7.4; `docs/16`/`19`).

### 10.9 Not in battle: `NumFreeEnemySlots`

Free = not active in the enemy team's 32 slots; a dead soldier frees its slot when it becomes a corpse
(`Tactical/Rotting_Corpses.cc:735`), already modelled in M3.

### 10.10 Underground (`:530-546`)

`PrepareEnemyForUndergroundBattle`: if the record has enemies, in-battle += the not-yet-placed counts, but
`AddSoldierInitListEnemyDefenceSoldiers` is called with the **total** counts (quirk). No groups underground.

### 10.11 Capture (later milestone, summary)

`EnemyCapturesPlayerSoldier` (`:1165-1276`): after a lost tactical battle with 2–3 incapacitated mercs and enemies
present (`Tactical/Overhead.cc:5011-5068`), after an autoresolve surrender/capture (`Auto_Resolve.cc:1676-1681`), or by
civ-quote/turn-based-input paths. Not if both capture flags are set or more than 3 were captured; EPCs die; vehicles
skipped. Morale event, assignment POW, neutral during the first capture, removed from squads, moved with items dropped
to Alma I13 (first time; `QUEST_HELD_IN_ALMA`) or N7 (interrogation after that quest), bleeding 0, life
`lifeMax/2` (≤ 35 → 35; ≥ 45 → `+ 10 − R(21)`), breath 50. Meanwhile INTERROGATION scheduled. M5/M6 (quests);
until then a lost battle kills incapacitated mercs (deviation).

---

## 11. `CalcDifficultyModifier` and progress

### 11.1 Formula (`Tactical/Soldier_Create.cc:1035-1110`)

```
m = 0
easy: +20 only for militia classes; medium: +10; hard: +20
p = HighestPlayerProgressPercentage()          // gStrategicStatus.ubHighestProgress
if p > 0: +5
if PredictIncomeFromPlayerMines() == 0: −5    // docs/18
+ p · 50 / 100
+ GetLocationModifier(battle sector)           // 0..30
clamp(m, 0, 100)
```

Battle sector = `GetCurrentBattleSectorXYZ` (`Strategic/Auto_Resolve.cc:3746-3768`): the autoresolve sector, else the
PBI sector, else the loaded world sector. The class only matters on easy (militia).

### 11.2 Location modifier (`Soldier_Create.cc:2100-2141`)

`dist` = 4 for Orta and Tixa town sectors, 10 for Alma, else `min(round(hypot(x − 3, y − 16)), 20)` (palace P3);
modifier = `(20 − dist) · 30 / 20`. z is ignored. Deterministic integer form: with `n = dx² + dy²`, `round(√n)` is the
`k` with `k(k−1) < n ≤ k(k+1)` (no ties exist for integer `n`). Examples: A9 n = 261 → 16 → 6; D13 n = 244 → 16 → 6;
G9 n = 117 → 11 → 13; Alma → 15; Orta/Tixa → 24; N4 n = 5 → 2 → 27; P3 → 30.

So at game start in A9 the real modifier is 1 (easy enemies: 0 + 6 − 5), 11 (medium) or 21 (hard), not the sandbox's
30 (`docs/deviations.md` "Sandbox population").

`RandomizeRelativeLevel` (§10.4) also uses the location modifier: roll `R(10) + modifier/3 − 5`, clamp 0..9 (militia
1..8), with autoresolve adjustments (`Soldier_Create.cc:1842-1900`, `docs/19`).

### 11.3 Progress (`Tactical/Campaign.cc:1180-1270, 1401-1428`)

Portions from `game.json` `progress` (kills 25, control 25, income 50 → percentages 25/25/50):
```
progress = currentMineIncome · 50 / possibleMineIncome                      // docs/18
         + min(usPlayerKills / killsPerPoint(7/10/15), 25)
         + min(important sectors held, 25)       // every player-owned sector where militia training is allowed,
                                                 // SAM sites count twice (CalcImportantSectorControl)
```
`HourlyProgressUpdate` raises `ubHighestProgress` and fires the 35/50/70 events (Madlab meanwhile, Mike available to
the army, Iggy placed). `CurrentPlayerProgressPercentage` drives the Queen's phase (§6.2); `Highest` drives difficulty,
admin upgrades and the SAM squad.

### 11.4 In ja2-node

Replace `TacticalState.campaign.difficultyModifier` (constant 30) with a pure function
`difficultyModifier(campaign, soldierClass, battleSector)` evaluated at soldier creation and by
`SoldierDifficultyLevel` (`docs/13` §4.3), fed by `campaign.highestProgress`, `predictedMineIncome` (`docs/18`), the
difficulty and the battle sector passed explicitly (no global "current battle sector"). `campaign.progress` used by
`GenerateRandomEquipment` stays `ubHighestProgress`. The sandbox keeps a fixed campaign record (progress 0, no income,
medium) so A9 gets 11, and the deviation row is closed.

---

## 12. Creatures and bloodcats

### 12.1 Creatures (`Strategic/Creature_Spreading.cc`, sci-fi games only)

- Start (`:175-271`, `:898-921`): `CheckConditionsForTriggeringCreatureQuest` (after `GLOBAL_LOYALTY_BATTLE_WON` /
  `QUEEN_BATTLE_WON`, `Strategic_Town_Loyalty.cc:871-878`) when the player holds the entrance sectors of ≥ 3 lair
  mines; or entering the cave under Tixa J9 b2 (`StrategicMap.cc:493-497`). Plays the CREATURES meanwhile once; picks
  `R(count)` among infestible mines (not attacked head miner, not running out, player-owned); lair from
  `strategic-map-creature-lairs.json`; periodic `EVENT_CREATURE_SPREAD` every 510/450/390 min; daily
  `EVENT_CREATURE_NIGHT_PLANNING` at 22:00; 1/2/3 initial spreads.
- Spread (`:287-424`): `7 + R(1 + 2)` (easy 6 + R(2), hard 9 + R(4)) new creatures, each placed by walking the lair
  list from the queen outward with habitat-based caps and `R(60)`/`R(100)` tests.
- Night planning (`:884-896`): per lair mine, if the exit level has > 1 creature and `n·10 > PR(100)`:
  `EVENT_CREATURE_ATTACK` at `now + 1 + PR(429)`.
- Town attack (`:512-606`): all creatures of the mine exit attack a weighted town sector (`R(total chance)`); with
  player mercs → PBI or tactical insertion; militia only → autoresolve; neither and player-owned → loyalty loss for
  eaten civilians; enemy-owned → nothing. Tactical composition by habitat weights with `std::discrete_distribution`
  over the shared engine (`:729-741`) — not reproducible bit-exactly; port as a weighted roll per creature.
- Underground battles: `PrepareCreaturesForBattle` (`:797-882`) and `AddSoldierInitListCreatures`.

### 12.2 Bloodcats

`InitBloodCatSectors` (`Game_Init.cc:118-138`): `bBloodCats = −1` everywhere; placements from
`strategic-bloodcat-placements.json`; spawns (I16 lair 14/19/26, N5 arena 8/10/12) set both counts. Ambush on arrival
(`TestForBloodcatAmbush`, `Strategic_Movement.cc:3263-3356`, owned by `docs/16`): first visit `PR(100) < 5d` rolls
`min(R(4) + 2d + 3, max(progress/(7 − d), 3))`, capped by 2 × mercs (not on hard, minimum 3) and by placements; later
visits re-ambush with 5% (`!PreChance(95)`); the lair regrows 1 per 18 h. `AddSoldierInitListBloodcats`
(`Soldier_Init_List.cc:1495-1629`) places them. Bloodcat deaths decrement `bBloodCats` (§10.7).

### 12.3 What M4 needs

- Creatures: load the lair data and keep `giLairID = 0`; **run M4 games with sci-fi off** (no quest trigger, no
  creature events). The J9 b2 creature counts exist regardless but are only reachable in sci-fi. Spreading, attacks
  and creature tactics wait for creature AI (`docs/13` §12.3).
- Bloodcats: the strategic numbers (`InitBloodCatSectors`, ambush roll, death bookkeeping) are cheap and belong with
  encounters (`docs/16`); the tactical bloodcat (body, animations, `CreatureDecideAction`) can wait. Until then treat
  every bloodcat ambush as "no encounter" and skip `AddSoldierInitListBloodcats` (one deviation row).

---

## 13. Interfaces with the companion modules

What the strategic AI calls (`docs/16` unless noted):

| Need | Original |
|---|---|
| Group CRUD and lookup | `CreateNewEnemyGroupDepartingFromSector`, `RemoveGroup`, `GetGroup`, group list iteration in order, `FindEnemyMovementGroupInSector`, `FindPlayerMovementGroupInSector`, `PlayerMercsInSector` |
| Orders | `MoveGroupFromSectorToSector`, `…ButAvoidPlayerInfluencedSectors`, `…AndStopOneSectorBeforeEnd`, `SetEnemyGroupSector`, `AddWaypointIDToPGroup`, `RemoveGroupWaypoints`, `RandomizePatrolGroupLocation`, `CalculateNextMoveIntention`, `GroupAtFinalDestination`, `GetFinalWaypoint`, `GroupWillMoveThroughSector` |
| Sector control | `SetThisSectorAsEnemyControlled` (runs loyalty/morale effects and item theft draws), `StrategicMap[].fEnemyControlled`, town ids, traversability |
| Militia | `CountAllMilitiaInSector`, `ubNumberOfCivsAtLevel` (`docs/18`) |
| Economy | `PredictIncomeFromPlayerMines`, `CalcMaxPlayerIncomeFromMines`, `MilitiaTrainingAllowedInSector` (`docs/18`) |
| SAM | `IsThisSectorASAMSector`, `bSAMCondition`, `UpdateSAMDoneRepair`, `UpdateAirspaceControl` |
| Clock and events | `AddStrategicEvent`, `AddPeriodStrategicEventWithOffset`, `DeleteAllStrategicEventsOfType`, `GetWorldTotalMin/Seconds`, `GetWorldHour`, `GetWorldDay`, `DayTime` (`docs/15`) |
| Facts | `FACT_HILLBILLIES_KILLED`, `FACT_KINGPIN_DEAD`, `FACT_IGGY_AVAILABLE_TO_ARMY` (`docs/16`/M6) |
| Tactical | `AddSoldierInitListEnemyDefenceSoldiers`, `TacticalCreateEnemySoldier`, `ChooseMapEdgepoints`, `UpdateMercInSector`, team slots |

What the AI expects the others to call: §4.3. In particular `docs/16` must call `StrategicAILookForAdjacentGroups`
after every non-battle arrival (player and enemy) **before** `CalculateNextMoveIntention`, `RemoveGroupFromStrategicAI
Lists` from `RemoveGroup`, `RepollSAIGroup` from the battle-reset path, and `PrepareEnemyForSectorBattle` /
`EndTacticalBattleForEnemy` around sector loads, with `gpBattleGroup` set for enemy-instigated battles. `docs/19` must
use `GetNumberOfEnemiesInSector` (with the H1 quirk) for its enemy roster, call `ProcessQueenCmdImplicationsOfDeath`
per dead enemy with the autoresolve sector, and on victory remove the sector's garrison and groups
(`RemoveGroupFromStrategicAILists`, `RemoveGroup`), then `SetThisSectorAsPlayerControlled(…, true)` and
`RecalculateSectorWeight`. Both decrement nothing else directly. The meanwhile system (M6) must at least run the
implications of §9.4 at the scheduled time (§16.2).

---

## 14. Agent API and player view (D16)

The player never sees the Queen's state. The projection exposes, per surface sector, only
`WhatPlayerKnowsAboutEnemiesInSector` (`Strategic/Map_Screen_Interface_Map.cc:3511-3562`), and the map shows nothing
underground (`:3606-3632`) and nothing at game start (`DidGameJustStart`):

| Knowledge | Condition | Shown |
|---|---|---|
| `KNOWS_HOW_MANY` | a merc able to scout is in the sector (not vehicle, POW, dead, in transit, asleep, < OKLIFE, in the helicopter, between sectors; `:3565-3603`), or militia within 1 sector (including diagonals, `Town_Militia.cc:623-639`), or `SF_PLAYER_KNOWS_ENEMIES_ARE_HERE` — **and** `NumStationaryEnemiesInSector == 0` | `NumEnemiesInSector` as a count (no class split) |
| `KNOWS_THEYRE_THERE` | the same scouting conditions but stationary enemies present (garrisons stay "?", roadblocks are counted); or the sector was ever visited; or Skyrider noticed them while he is still over it | presence only ("?") |
| `KNOWS_NOTHING` | otherwise | nothing |

`SF_PLAYER_KNOWS_ENEMIES_ARE_HERE` is set when the PBI shows an `ENEMY_ENCOUNTER_CODE` battle and cleared on the next
clock advance once no enemy is in the loaded sector (`PreBattle_Interface.cc:430-441`, `Game_Clock.cc:211-216`).

Implications:
- `observe`/`status` on the strategic map list sectors with `enemies: {count}` / `{present: true}` / nothing, from
  this one function; the PBI view follows `docs/19`. No garrison ids, compositions, admin/troop/elite split, group
  routes, intentions, the pool, awake flag or alertness. Seen enemy soldiers in tactical play may carry their class
  (the uniform colours make it visible), unseen ones never.
- Events that leak AI decisions must not exist; the original tells the player only: invasion/encounter prompts
  (`docs/19`), "enemy took control of …" (`NotifyPlayerWhenEnemyTakesControlOfImportantSector`), meanwhile scenes
  (which do show the Queen's orders, e.g. troops to a SAM site) and Skyrider's sighting quotes. A `meanwhile {id}`
  event is fair once scenes exist; until then only the implications run.
- Queries (`query`) about sectors go through the same projection. A dev-only omniscient `debugStrategic` view (whole
  `QueenState`, groups) is allowed for tests and devtools, never for agents in play.

---

## 15. Data tables and content loading

- **No new transcription is required for the core AI**: compositions, garrisons, patrols, policy, cache sectors,
  underground sectors, bloodcats and lairs are externalized JSON already in `data/externalized/`. Add a content parser
  `src/content/strategic/army.ts` (JSONC: comments allowed) that resolves sector strings to ids and composition names to
  indices (garrison `composition` must match a composition name exactly; unknown → error, as Strac's validation
  `ArmyCompositionModel::validateData`), and validates counts (27 ≤ compositions ≤ 60, patrols ≤ 50, garrisons ≤ 100,
  patrol points 2..4 and axis-aligned).
- **Named constants in code** (SFI header, `@src Strategic/Strategic_AI.cc`): composition indices used by the code
  (QUEEN_DEFENCE 0 … SANMONA_SMALL 26), `MAX_STRATEGIC_TEAM_SIZE 20`, `NO_GARRISON 255`, the special-sector lists of
  §8.2, §6.6, §9.6, the start minute 475, minutes 3345/4710, the 67/121/360 sleep numbers (owned by `docs/16`),
  `DIFF_FACTOR_*` (50/30/20, +5/−5), `PALACE_SECTOR 3,16`, `MAX_PALACE_DISTANCE 20`, Orta/Tixa 4, Alma 10.
- **Later, if creatures are ported**: one generated table `data/tables/creature-habitats.json` from
  `Creature_Spreading.cc` (`CreatureWeightsByHabitat` `:708-726`, habitat population caps `:323-353`, spread and
  reproduction defines `:49-102`) via `tools/transcribe/creature-habitats.ts`, using `c-source.ts`.
- **Stubs**: the stub pack needs a strategic map (`docs/16`) whose sectors can carry garrisons. Use the real JSON
  (it is Stracciatella data, distributable under SFI-SCLA) with stub maps that contain enemy placements of all three
  classes and edgepoints on every side; alternatively a stub override of the garrison/patrol JSON pointing at the stub
  sectors. CI then exercises init, evaluation and population without original data.

---

## 16. Minimal M4 implementation (strategic AI)

### 16.1 Modules (`src/sim/strategic/forces/`, `01` §3.7)

| Module | Contents |
|---|---|
| `army-data.ts` (content, `src/content/strategic/army.ts`) | parsed JSON (§15) |
| `queen-state.ts` | `QueenState`, sector/group enemy fields, `cloneForSave` (plain data) |
| `counts.ts` | §1.6 helpers incl. the H1 quirk; `playerSectorDefended` |
| `init.ts` | `initStrategicAI(state, data, d, rng, ports)` (§3) and the underground/cache parts |
| `weights.ts` | §5 |
| `composition.ts` | §5.5 |
| `evaluate.ts` | `evaluateQueenSituation`, `evolveQueenPriorityPhase`, `upgradeAdminsToTroops` (§6.1–6.3) |
| `reinforce.ts` | §6.4–6.7, `requestHighPriorityGarrisonReinforcements`, `massFortifyTowns` |
| `orders.ts` | §7 |
| `detection.ts` | §8 |
| `reactions.ts` | §9: wake, losing control, actions, meanwhile implications, mine ran out |
| `queen-command.ts` | §10: prepare/pending/end battle, deaths, edge escapes |
| `difficulty.ts` | §11 (shared with tactical creation) |
| `creatures.ts`, `bloodcats.ts` | §12 stubs |

`ports` is an interface implemented by `docs/16`/`15`/`18` modules (§13), so the AI can be unit-tested against fakes.
The RNG parameter is an interface `{ int(n): number; chance(p): boolean }` so tests can inject a replay source (§16.4).
Negative `int` arguments from i32 expressions (`R(points + pool)` with a negative pool) must be converted with
`>>> 0` as the original's `UINT32` parameter does; `chance` must always draw.

### 16.2 Order of work

1. Content parser + `QueenState` + `counts.ts` (tests: H1 double count, roadblock stationary 0, groups between
   sectors counted at origin).
2. `init.ts` with the full draw order (§3.8); new-game wiring in `docs/15`'s init sequence (clock at 01:00 before it
   runs, underground draws first).
3. `weights.ts`, `composition.ts` (table tests incl. the patrol `min` cap and initial-weight quirk).
4. `evaluate.ts` + `reinforce.ts` + `orders.ts` against a fake group port; then against `docs/16`'s real groups.
5. `detection.ts` and the arrival hook; `CheckEnemyControlledSector` events.
6. `reactions.ts`: wake triggers, `MassFortifyTowns`, liberation grace, SAM squad, meanwhile implications run at the
   meanwhile event time as if the scene were skipped (allowed in the original, so no outcome deviation).
7. `queen-command.ts`: replace `SANDBOX_POPULATION`/`chooseEnemyPlacements` with `prepareEnemyForSectorBattle` +
   a full port of `SortSoldierInitList` and `AddSoldierInitListEnemyDefenceSoldiers` (classes admin/elite/army,
   Strac PD-pass quirk); soldier `groupId`; the tactical `soldierDied` hook → `processQueenCmdImplicationsOfDeath`;
   `addPossiblePendingEnemiesToBattle` at tactical turn ends and on group arrival; edge escapes remove the soldier and
   count as death (closes "Map-edge escapes"); `endTacticalBattleForEnemy` on unload.
8. `difficulty.ts` and the tactical switch-over (closes "Sandbox population").
9. Save/load: our saves snapshot `QueenState` (no re-derivation). Native save import: parse section 35 (§1.4), the
   `SECTORINFO` enemy fields and the groups (`docs/14`, `docs/16`). Decide whether to run the original's load hooks
   (§17, open question).
10. Creatures/bloodcats stubs; sci-fi off.

### 16.3 Tests

- **Init RNG order**: a scripted RNG that records `(range)` per call; for each difficulty assert the exact range
  sequence of §3.8 for a fixed scripted result stream (e.g. all zeros, all max), and the resulting counts: P3 32 elites
  (22 easy), A9 3/4/6 troops, C13 admin-only ≥ 5, roadblocks 0 or desired-based, patrols 3/4 admins, patrol sizes in
  `[size−1, size+1]` clamped, every patrol standing on one of its points with `ubNextWaypointID` consistent with its
  move type, arrival times within `[1, traverse+sleep−1]`, 57 periodic events at 07:55 + gi, one evaluation event with
  a day-0 stamp.
- **Weights**: tables for garrison/patrol weights (sign rules, min/max 2, priority scaling, the `min` cap), totals
  stay consistent after any sequence of recalculations (property test: `requestPoints` = sum of positive weights,
  `reinforcementPoints` = sum of negative magnitudes, given the init quirk accounted for).
- **Evaluation**: awake state with fake groups; scripted `R(requestPoints)` selects garrison k; approval/denial
  (denial counter growth and u8 wrap); pool vs garrison source by scripted `R(points + pool)`; Alma preference for
  Drassen/Cambria; the 67% rule; staging with `ubPendingReinforcements`; patrol reinforcement from a non-spawning
  garrison producing an empty group; recruitment at pool 0 (×10 interval, +30).
- **Orders**: arrival cases of §7.2 (garrison merge with surplus elimination, P3 overflow to the pool, patrol warp
  with truncation to 20, new patrol), `ReassignAIGroup` passes and the final pool transfer, redirect around a
  liberated sector, grace period blocking paths.
- **Detection**: alertness changes day/night, the four-direction order (enemy N W S E, player N E S W, garrison N E S
  W), special sectors and time gates, mass fortification at wake (nearest patrol split vs palace group, A9 conversion).
- **Queen_Command**: placement selection on a stub map with PD/P/D/B placements of all classes (sort reversal, PD
  every-second-node rule, priority overwrite, leftovers), group id assignment by team order, deaths decrementing group
  vs sector, >32 pending enemies entering from the right edge as slots free, H1 roster, underground totals.
- **Difficulty**: palace distance table (§11.2), class/easy militia rule, clamp.
- **Scenario (headless, stubs)**: new game medium → wake by liberating sectors → the Queen sends a group that stages
  and attacks; an agent sees only "?" or counts per §14.

### 16.4 Oracle probes (extend `tools/oracle`)

**Reproducibility.** The native engine is `std::mt19937 gRandomEngine` seeded from the clock and `random_device` in
`InitializeRandom` (`sgp/Random.cc:42-61`); saves do not store it. A probe command `seed n` must call
`gRandomEngine.seed(n)` and refill `guiPreRandomNums` (index 0) exactly as `InitializeRandom` does after seeding, at
the point where the comparison starts (after `LoadSavedGame`, or right before `InitNewCampaign`). Even then our
xoshiro + multiply mapping cannot reproduce mt19937 + `uniform_int_distribution`, so comparisons use a **draw log**:
a small hook in `sgp/Random.cc` (added to `patches/`) that, when enabled, appends `(range, result)` for every `Random`
call (and `PreRandom` separately). ja2-node then runs the same operation with a replay RNG that returns the native
results in order and **asserts each requested range equals the native one** — this checks the draw order and the logic
at once.

Proposed commands (new branches in `Dispatch`, `tools/oracle/src/Oracle.cc`):

| Command | Does |
|---|---|
| `seed n` | reseed as above |
| `draws on\|off\|dump` | start/stop the draw log; `dump` emits `{"probe":"draws","random":[[r,v],…],"preRandom":[…]}` |
| `newgame difficulty=2 scifi=0` | sets `gGameOptions`, runs `SetupNewStrategicGame(); InitNewCampaign();` (seed and `draws on` before it) |
| `sai` | dumps `SectorInfo` enemy fields for all 256 sectors and the underground list, every garrison and patrol record, current compositions, all SAI globals, `gubGarrisonReinforcementsDenied`, the enemy group list in order (id, sector, next, prev, moveType, nextWaypointID, waypoints, intention, counts, in-battle counts, pending reinforcements, betweenSectors, arrival and traverse time) and SAI-related events (kind, stamp, param, period) |
| `saievaluate [awake=1]` | runs `EvaluateQueenSituation()` (optionally after `gfQueenAIAwake = TRUE`) |
| `saicheck sector=C13` | `CheckEnemyControlledSector(id)` |
| `saiwake` | `WakeUpQueen()` |
| `prepare` | after `save`/`sector`: `PrepareEnemyForSectorBattle()`; dumps created enemies with class, placement index, group id |
| `diffmod class=3` | `CalcDifficultyModifier`, `HighestPlayerProgressPercentage`, `PredictIncomeFromPlayerMines`, the palace distance of the battle sector |

`compare.ts` grows matching handlers: rebuild the same operation in ja2-node from the dumped prior state (or from the
imported save) with the replayed draws, then compare the following `sai`/`prepare` dump field by field. Suggested
scripts: `probes/newgame-{easy,medium,hard}.txt` (`seed`, `draws on`, `newgame`, `draws dump`, `sai`) for several
seeds; `probes/saves-sai.txt` for the user's six saves (load, `sai`, `seed`, `draws on`, `saievaluate awake=1`,
`draws dump`, `sai`, `diffmod` for each class, `prepare` where a sector is loaded). Outputs stay outside the repo.

Fallback without the hook: compare distributions over many seeds (garrison totals per sector, patrol positions) with a
χ² tolerance; weaker, but needs no patch.

### 16.5 Can wait

Creatures (spreading, attacks, lair), tactical bloodcats, capture and the Alma/N7 quests, Mike/Iggy profiled enemies,
the unreachable NPC actions, `ReinitializeUnvisitedGarrisons` and the other save-version patches of
`LoadStrategicAI` (only for very old native saves), debug toggles and logs.

---

## 17. Quirks to keep (or list in `deviations.md`)

Keep (original behaviour, vanilla too unless marked):
- First Queen evaluation fires at the first event processing (day-0 stamp, §3.3) and reschedules with draws even
  while asleep (§4.1).
- Initialisation runs at 01:00, so every patrol rolls the night-sleep `C(67)` twice (§3.6).
- Patrol weight capped with `min(…, 2)`; destroyed patrols are never refilled but keep weight 2 (§5.2, §5.4).
- Initial garrison weights use the modified local `start` (§3.5).
- `EvolveQueenPriorityPhase` recomputes from the **unscaled** JSON, undoes the mine-ran-out `/4`, gives San Mona desired
  6 but no approval (§6.2, §9.6).
- H1 counted twice / as mobile because `ubGarrisonID` is compared with `ROADBLOCK` (§1.6).
- Elite clamp `32 − A + T` in `PrepareEnemyForSectorBattle` (§10.1); underground battles place total counts (§10.10).
- **Strac only**: the PD pass of `AddSoldierInitListEnemyDefenceSoldiers` examines every second node (§10.2). Verify
  with the `prepare` probe, then decide (vanilla walks all nodes).
- `SortSoldierInitList` reverses the PD, P and D blocks (inferred, verify with `prepare`).
- Defence counts mercs ×5 in `PlayerForceTooStrong` but ×4 in `ReinforcementsApproved` (§5.4).
- `gubGarrisonReinforcementsDenied` wraps at 256; the P3 extra-reinforcement value wraps when `20 − req < 0` (§5.4).
- Groups larger than 20 (up to 60) from the pool/staging paths; `ubGroupSize` never counts admins at creation (§1.2,
  §6.5).
- P3 accepts arriving reinforcements as elites up to 20 only; when that cap is hit the pool gains `20 − elites`
  instead of the real overflow (§7.2).
- `SendReinforcementsForPatrol`: no P3-ownership check, no minimum check, may send an empty group (§6.7).
- `ReinforcementsAvailable` = 0 outside spawning compositions; step 4 of the source choice can then abort (§6.6).
- Pool can go negative through `RequestHighPriorityGarrisonReinforcements`; recruiting only at exactly 0 (§9.2).
- H2 checks itself in `EnemyPermittedToAttackSector`; A9/A10/Drassen time gates (§8.2).
- Garrison handlers of §8.5 can split the garrison of the loaded sector during real-time play.
- Fleeing enemies are strategically dead (§10.8).
- The battle-location/Drassen/Omerta/extra-elites/aware actions are unreachable (§9.5): the Queen does **not** send a
  squad to the first battle's location.
- `PermittedToFillPatrolGroup` mod-100 wrap (§5.3).
- `R(0)` draws nothing, `C(p)` always draws; `Random` takes `UINT32`.

List in `deviations.md` when ported:
- **Undefined behaviour made defined**: division by zero in the pool path when `defence == 0` (§6.5; propose: skip the
  `C` roll and send); `ReassignAIGroup`'s patrol reloop running past the array when `reloop` stays `size_t(−1)` (§7.3;
  propose: stop at the last patrol); the PD-pass double advance dereferencing past the list end (§10.2; propose: stop).
- **Meanwhile scenes** (M6): until then the implications of §9.4 run at the event time as a skipped scene.
- **Creatures off** (sci-fi off) and **tactical bloodcats off** until creature AI exists (§12.3).
- **Capture**: until M5/M6 incapacitated mercs of a lost battle die instead of being captured (§10.11).
- **Load hooks** (open question): the original runs `EvolveQueenPriorityPhase(TRUE)` and repolls idle enemy groups on
  every load, which changes desired populations and orders. Our snapshots restore state exactly; replicating the hooks
  keeps save/load parity with the native game (and importing native saves needs them anyway), not replicating them
  keeps "save = no effect". Propose: run them on native-save import only and log the deviation for our own saves.
- Debug toggles `gfAutoAIAware`, strategic AI logs: not ported.

---

## 18. Verified vs inferred

**Verified** by reading Strac (vanilla cross-checked where marked): every function of `Strategic_AI.cc` (globals,
`InitStrategicAI` line by line with its draw order, weights and the patrol `min` cap (vanilla equal), request/supply
predicates, `EvaluateQueenSituation` (vanilla equal timing), `EvolveQueenPriorityPhase` (vanilla equal),
`ReinforcementsApproved`, both send functions, the source choice, `ReassignAIGroup`, `EvaluateGroupSituation`,
detection and notice rolls, `CheckEnemyControlledSector`, `ExecuteStrategicAIAction`, losing control, mass
fortification, mine ran out, admin upgrades, composition helpers, `MoveSAIGroupToSector`, redirect, save/load layout
and load hooks); `Queen_Command.cc` (counting helpers and the `ROADBLOCK` index bug (vanilla equal), prepare,
pending enemies, `AddEnemiesToBattle`, end of battle, deaths, underground, capture); `AddSoldierInitListEnemyDefence
Soldiers` and its Strac PD-pass difference from vanilla; the clock at init (01:00, vanilla equal), the sleep roll and
patrol randomisation in `Strategic_Movement.cc`; the event-queue handling of past stamps; the NPC-action no-ops
(vanilla equal); meanwhile implications and timing; `CalcDifficultyModifier`, location modifier and progress formulas;
the policy, composition, garrison, patrol, cache, underground, bloodcat and lair JSON; the player-knowledge rules.

**Inferred** (not traced end to end): the reversal of blocks in `SortSoldierInitList`; groups sent to P3 without a
pending slot staying there as mobile groups; garrison-launched attack groups staying after their battle; every
contested win counting towards waking the Queen (depends on `docs/16`/`19` call sites); the double decrement for a
stationary Mike/Iggy; the empty patrol-reinforcement group's later behaviour; the compiler-defined order of the two
`R` calls in `TacticalCreateEnemySoldier`'s noise target; that no other code path sets `gfExtraElites` or
`gubNumAwareBattles` (grep found none); the exact scaled tables of §2.5 (computed from the JSON with the §3.3 rules,
not dumped from the native build). Everything inferred is a target for the `newgame`, `prepare` and `saievaluate`
probes of §16.4.

---

## 19. Implemented (2026-10-16): §16.2 steps 1–8 (strategic side) and the native-save part of step 9

**Content.** `src/content/strategic/army.ts`: `loadArmyContent(read)` / `parseArmyContent` read the five JSONC files
(`army-compositions`, `army-garrison-groups`, `army-patrol-groups`, `strategic-ai-policy`, `game.json` `progress`) into
`ArmyContent` (templates, `StrategicAiPolicy` per difficulty, `ProgressPolicy`) with the §15 validation. It is loaded
next to `StrategicContent`, not inside it. `src/content/formats/savegame-strategic-ai.ts`:
`readStrategicAiSections(bytes, save)` decodes section 35 (§1.4), section 34 (`STRATEGIC_STATUS`, §1.5) and the meanwhile
flags and first-battle sector of section 24, using the section offsets the save reader records.

**State.** `StrategicState` gained `queen` (`QueenState` of §1.7 plus `saiVersion`), `status` (`StrategicStatus`) and
`meanwhile` (`flags`, `currentId`); all plain data (`ai/queen-state.ts`, `cloneQueenState`).

**Simulation** (`src/sim/strategic/ai/`, rather than `forces/` as §16.1 proposed; every function takes a `QueenContext`
= `StrategicContext` + army content + `MineIncomePort` + `QueenHooks`, built by `createQueenContext`):

| Module | Public API |
|---|---|
| `counts.ts` | `numStationaryEnemiesInSector`, `numMobileEnemiesInSector`, `getNumberOfEnemiesInSector` (H1 quirk), `playerSectorDefended` |
| `weights.ts` | `recalculateGarrisonWeight`, `recalculatePatrolWeight`, `recalculateSectorWeight`, `recalculateGroupWeight`, the request/supply predicates of §5.4, `garrisonWeight` |
| `composition.ts` | `calcNumTroopsBasedOnComposition`, `convertGroupTroopsToComposition`, `removeSoldiersFromGarrisonBasedOnComposition`, `eliminateSurplusTroopsForGarrison` |
| `init.ts` | `initStrategicAI` (§3, draw order of §3.8), `initStrategicStatus` |
| `evaluate.ts` | `evaluateQueenSituation`, `evolveQueenPriorityPhase`, `upgradeAdminsToTroops` |
| `reinforce.ts` | `reinforcementsApproved`, `sendReinforcementsForGarrison`, `chooseSuitableGarrisonToProvideReinforcements`, `sendReinforcementsForPatrol`, `requestAttackOnSector`, `requestHighPriorityGarrisonReinforcements`, `massFortifyTowns` |
| `orders.ts` | `moveSAIGroupToSector`, `evaluateGroupSituation`, `reassignAIGroup`, `sendGroupToPool`, `transferGroupToPool`, `removeGroupFromStrategicAILists`, `repollSAIGroup`, `redirectEnemyGroupsMovingThroughSector` |
| `detection.ts` | `okayForEnemyToMoveThroughSector`, `enemyPermittedToAttackSector`, the notice rolls, the §8.5 handlers, `strategicAILookForAdjacentGroups`, `checkEnemyControlledSector` |
| `reactions.ts` | `wakeUpQueen`, `executeStrategicAIAction`, `strategicHandleQueenLosingControlOfSector`, `strategicHandleMineThatRanOut`, `queenBasementTaken` |
| `meanwhile.ts` | `scheduleMeanwhileEvent`, `handleMeanwhileEvent` (skipped scene), `handleMeanwhileEventPostingFor{TownLiberation,TownLoss,SamLiberation}`, `handleFirstBattleEndingWhileInTown`, `handleFirstMeanwhileSetUpWithTrashWorld`, `meanwhilePendingThisSecond` (for `AreInMeanwhile`) |
| `queen-command.ts` | `prepareEnemyForSectorBattle` → `SectorBattlePlan` (class counts for the defence placements, stationary count, enemy-instigated groups; updates the in-battle counters and `pendingEnemies`), `assignEnemyGroupIds`, `processQueenCmdImplicationsOfDeath(q, dead, autoResolveSector)`, `addPossiblePendingEnemiesToBattle` → `PendingArrival[]` (group, entry code, classes), `nextArrivingSoldierClass`, `ARRIVAL_FACING`, `endTacticalBattleForEnemy` (returns whether `GLOBAL_LOYALTY_ABANDON_MILITIA` applies) |
| `defence-placement.ts` | `sortSoldierInitList` and `addSoldierInitListEnemyDefenceSoldiers` as pure functions over `PlacementNode`s with an injected roll source and an `add(node)` callback (Strac PD every-second-node walk) |
| `difficulty.ts` | `calcDifficultyModifier(inputs, class)`, `difficultyModifierAt(q, class, battleSector)`, `locationModifier`, `pythDistanceFromPalace` (exact integer rounding), `currentPlayerProgressPercentage`, `highestPlayerProgressPercentage`, `hourlyProgressUpdate`, `calcImportantSectorControl`, `militiaTrainingAllowedInSector` |
| `status.ts` | `trackEnemiesKilled`, `recordPlayerKill` |
| `save-import.ts` | `importStrategicAi(q, sections, {runLoadHooks})`, `runStrategicAiLoadHooks` |
| `strategic-ai.ts` | `StrategicAi` (the `StrategicAiPort` of `docs/16`, bound with `bind(ctx)`), `initStrategicAiForNewCampaign` (the `initStrategicAI` hook of `initStrategicLayerMap`), `registerStrategicAiEvents` |
| `economy-link.ts` | the bridge to `docs/18`'s economy: mine income port, `queenMineRanOut` and meanwhile hooks, the hourly progress slot |

`CampaignSim` takes `hooks.queen = {army, mines?, hooks?}`, exposes `campaign.queen`, passes the `StrategicAi` as the
strategic context's AI port and registers `EVALUATE_QUEEN_SITUATION`, `CHECK_ENEMY_CONTROLLED_SECTOR` and `MEANWHILE`;
with an economy it wires the mine income, the mine-ran-out and meanwhile hooks and the hourly progress update.

**Callers still to wire.** New-game init: `initStrategicLayerMap(ctx, {initStrategicAI: () =>
initStrategicAiForNewCampaign(campaign.queen)})`. Autoresolve: `getNumberOfEnemiesInSector`,
`processQueenCmdImplicationsOfDeath(q, dead, sector)`, `trackEnemiesKilled`, `removeGroupFromStrategicAILists`,
`recalculateSectorWeight`, `handleFirstBattleEndingWhileInTown(q, sector, true)`. Sector loader: `prepareEnemyForSectorBattle`
→ `sortSoldierInitList` + `addSoldierInitListEnemyDefenceSoldiers` → `assignEnemyGroupIds`; deaths and map-edge escapes →
`processQueenCmdImplicationsOfDeath`; tactical turn ends and `enemyReinforcementsArrived` →
`addPossiblePendingEnemiesToBattle` + `nextArrivingSoldierClass`; unload → `endTacticalBattleForEnemy` and
`handleFirstMeanwhileSetUpWithTrashWorld`; soldier creation → `difficultyModifierAt`. The tactical sandbox still uses its
fixed population ("Sandbox population" stays open).

**Decisions on §17.** Stracciatella is followed everywhere, including the PD every-second-node quirk; the undefined
cases are defined as `deviations.md` "Strategic AI undefined behaviour" lists; the load-time recomputation runs only on
native-save import ("Strategic AI load hooks"). Correction to §8.2: F10 is refused when `FACT_HILLBILLIES_KILLED` is
**set** (the code tests the fact, the comment says the opposite). Reinforcements reaching a SAM site set
`SF_MAP_MODIFICATIONS_TEMP_FILE_EXISTS` (the repaired graphic is written to the map temp file); the graphic itself is a
`QueenHooks.samRepaired` call.

**Verified against the oracle** (`tools/oracle/probes/sai-newgame.txt`, `sai-saves.txt`, patch `0003`, README "Strategic
AI"): seven new games over the three difficulties (with and without sci-fi), the six native saves with the load-time
recomputation isolated by trace marks, a woken Queen's mass fortification, 15 evaluations, 30 periodic checks and 500
enemy group arrivals: 6,085 native `Random` draws replayed with identical ranges, 51 complete `sai` dumps (globals,
compositions, garrisons, patrols, denials, all 256 sectors, control, underground, every enemy group with its waypoints and
times, the AI events) and 18 `diffmod` results identical. Unit tests cover §16.3 (draw order per difficulty with zero and
maximum streams, weights, evaluation, orders, detection, reactions, Queen_Command, placements, difficulty) and a headless
scenario (wake after three victories on medium, grace period, attack on Drassen).

**Not yet.** The `prepare` probe (needs placement-level output from `AddSoldierInitListEnemyDefenceSoldiers`), periodic
checks that reach a notice roll in the oracle (none of the probed situations had an important undefended neighbour),
the tactical switch-over (§16.2 steps 7–8 inside `src/sim/tactical`), creatures and bloodcat placements (step 10),
`ReinitializeUnvisitedGarrisons` and the SAI version patches.

# 17 — Strategic AI

**Conventions.** Paths are relative to `reference/stracciatella/src/game/` (`sgp/…` and `externalized/…` to
`reference/stracciatella/src/`); `V:` is vanilla `Build/`; JSON files are `assets/externalized/<name>.json`, copied
unchanged to `data/externalized/`; "(inferred)" marks conclusions not traced end to end. `R(n)` = `Random(n)` = the
`main` stream (`[0, n)`; `R(0)` returns 0 **without a draw**, `sgp/Random.cc:65-71`); `C(p)` = `Chance(p)` =
`R(100) < p`, which **always draws** and takes `UINT32`, so a negative `p` always succeeds (`sgp/Random.cc:73-76`);
`PR(n)` = `PreRandom` = the `pre` stream. Every strategic-AI draw is `R`; only creature night planning, bloodcat
ambushes and PBI ambushes use `PR`.

**Ids.** Sector id (`SECTORINFO` index, `UINT8`) = `(y−1)·16 + (x−1)`, row A..P = y 1..16, column x 1..16
(`Strategic/Campaign_Types.h:10-28`): A9 = 8, P3 = 242. `StrategicMap[]` uses `x + 18·y` (`docs/16`). Garrison index
`gi` = position in `army-garrison-groups.json` (0..56), patrol index `pi` = position in `army-patrol-groups.json`
(0..28), composition id `ci` = position in `army-compositions.json` (0..26; the `id` field is ignored,
`externalized/army/ArmyCompositionModel.cc:27-45`). `NO_GARRISON = 255`. Group id 0 = none (real ids 1..255,
`Strategic/Strategic_Movement.cc:506-528`). Difficulty `d` = 1 easy, 2 medium, 3 hard (`GameSettings.h:78-81`).
`MAX_STRATEGIC_TEAM_SIZE = 20` (`Strategic/StrategicMap.h:11`) is the nominal group and garrison cap; the enemy
tactical team has **32** slots (`Tactical/Overhead.cc:217-225`). Times are world minutes (`GetWorldTotalMin`) and
seconds; the event queue stores seconds (`docs/15`).

**Scope.** This doc owns `Strategic/Strategic_AI.cc`, `Strategic/Queen_Command.cc`, the strategic side of
`Creature_Spreading.cc`, `CalcDifficultyModifier` and the interfaces between them. Elsewhere: `docs/15` clock, event
queue, `AddStrategicEvent` family, new-game init order; `docs/16` sectors, groups (`GROUP`, waypoints,
`CreateNew*Group`, `RemoveGroup`, ids, group-list order), strategic A*, travel, arrival, battle checks, sector control,
sector load/unload and persistence, bloodcat ambush, the player's knowledge of enemies; `docs/18` militia, loyalty,
mine income, town liberation; `docs/19` PBI, encounter codes, autoresolve; `26` meanwhile scenes and the capture
sequence.

---

## 1. State

### 1.1 `SECTORINFO` fields the AI reads or writes (`Strategic/Campaign_Types.h:152-189`)

| Field | Type | Meaning |
|---|---|---|
| `uiFlags` | u32 | `SF_ENEMY_AMBUSH_LOCATION` 0x2 (roadblock garrisons, PBI ambush +20), `SF_PLAYER_KNOWS_ENEMIES_ARE_HERE` 0x4 (set when the PBI shows an `ENEMY_ENCOUNTER_CODE` battle, cleared on the next clock advance once no enemy is in the loaded sector, `PreBattle_Interface.cc:430-441`, `Game_Clock.cc:211-216`), `SF_ALREADY_VISITED` 0x20, `SF_USE_ALTERNATE_MAP` 0x40 (weapon cache), `SF_SKYRIDER_NOTICED_ENEMIES_HERE` 0x400, `SF_USE_MAP_SETTINGS` 0x1 (never set in the campaign, §10.1) |
| `ubGarrisonID` | u8 | index into `gGarrisonGroup`, 255 = none |
| `ubPendingReinforcements` | i8 | unused by the AI (the group field of that name is used) |
| `ubNumTroops`, `ubNumElites`, `ubNumAdmins` | u8 | stationary enemies (the garrison); surface only |
| `ubNumCreatures` | u8 | creatures attacking this surface sector (set just before the battle) |
| `ubTroopsInBattle`, `ubElitesInBattle`, `ubAdminsInBattle`, `ubCreaturesInBattle` | u8 | how many of the above are in the current tactical battle |
| `ubDayOfLastCreatureAttack` | u32 | creature attacks |
| `ubTraversability[4]` (THROUGH) | u8 | `TOWN` = 0 marks a town sector for "important and undefended" |
| `bBloodCats`, `bBloodCatPlacements` | i8 | −1 = not rolled yet |
| `ubNumberOfCivsAtLevel[3]` | u8 | militia green/regular/elite (`docs/18`) |
| `uiTimeLastPlayerLiberated` | u32 s | grace period start |

Save layout (116 bytes, `Strategic/LoadSaveSectorInfo.cc:11-46`): flags 0, garrison 5, troops 14, elites 15, admins
16, creatures 17, in-battle troops/elites/admins/creatures 18–21, bloodcats 39, placements 40, militia 43–45,
`uiTimeLastPlayerLiberated` 60.

`UNDERGROUND_SECTORINFO` (`Campaign_Types.h:198-210`) has the same enemy and in-battle counts (no garrison id),
`ubAdjacentSectors` and `ubCreatureHabitat`; it is a linked list in `strategic-map-underground-sectors.json` order.

### 1.2 Enemy groups (`Strategic/Strategic_Movement.h:9-116`, owned by `docs/16`)

`ENEMYGROUP`: `ubNumTroops`, `ubNumElites`, `ubNumAdmins`, `ubPendingReinforcements` (staging top-up, §7.5),
`ubAdminsInBattle`, `ubTroopsInBattle`, `ubElitesInBattle`, `ubIntention`. Intentions: `NO_INTENTIONS 0`,
`PURSUIT 1`, `STAGING 2`, `PATROL 3`, `REINFORCEMENTS 4`, `ASSAULT 5` (never assigned). Move types: `ONE_WAY 0`,
`CIRCULAR 1`, `ENDTOEND_FORWARDS 2`, `ENDTOEND_BACKWARDS 3`.

`CreateNewEnemyGroupDepartingFromSector(sector, admins, troops, elites)` (`Strategic_Movement.cc:476-503`) sets
`ubGroupSize = troops + elites` (**admins are not counted**; every AI call passes 0 admins), `ubMoveType = CIRCULAR`,
intention 0, no waypoints, appends to the group list and takes the lowest free id. Several loops below draw `R` per
group in list order, so append order and lowest-free-id allocation are part of the behaviour.

### 1.3 Composition, garrison and patrol records (`Strategic/Strategic_AI.h:60-137`)

| Struct | Fields (save size) |
|---|---|
| `ARMY_COMPOSITION` (20) | `bPriority` i8, `bElitePercentage` i8, `bTroopPercentage` i8, `bAdminPercentage` i8, `bDesiredPopulation` i8, `bStartPopulation` i8 |
| `GARRISON_GROUP` (14) | `ubSectorID` u8, `ubComposition` u8, `bWeight` i8, `ubPendingGroupID` u8 |
| `PATROL_GROUP` (20) | `bSize` i8, `bPriority` i8, `ubSectorID[4]` u8 (0 = unused), `bFillPermittedAfterDayMod100` i8 (init −1, `externalized/army/PatrolGroupModel.cc:15-22`), `ubGroupID` u8, `bWeight` i8, `ubPendingGroupID` u8 |

Composition semantics (`army-compositions.json` header): elite% + troop% = 100 for every composition except
`QUEEN_DEFENCE` (100/0) and `SANMONA_SMALL` (0/0). A **non-zero admin% means the start garrison is admin% of the start
population as admins and nothing else** (except the mine/Cambria special case, §3.4). All refills use only the
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
| `gfUseAlternateQueenPosition` | bool | yes | set when the P3 basement is taken (`Strategic/Player_Command.cc:197-200`), read by the tactical Queen AI |
| `gfExtraElites` | bool | yes | only set by an unreachable action (§9.5) |
| `gArmyComp[]`, `gGarrisonGroup[]`, `gPatrolGroup[]` | records | yes | mutable copies of the JSON |
| `gubGarrisonReinforcementsDenied[]` | u8 per garrison | yes | grows on denials, **wraps at 256** |
| `gfAutoAIAware` | bool | no | debug toggle in the map screen (`Strategic/MapScreen.cc:2962`); not ported |
| `gfPendingEnemies` | bool | no | `Queen_Command.cc:46`; battle-scoped (§10.4) |

Save layout (`Strategic_AI.cc:2020-2080`; savegame section 35, `docs/14`): offset 3 `gfExtraElites`, 4 garrison count
i32, 8 patrol count i32, 12 pool, 16 force %, 20 alertness, 24 decay, 28 awake u8, 29 reinforcement points i32, 33
request points i32, 37 aware battles, 38 SAI version (29), 39 phase, 40 first-battle flag, 41 mass fortification, 42
min group size, 43 grace hours, 44 victories u16, 46 alternate Queen position, then 97 padding (header 144 bytes);
60 × 20 compositions, 50 × 20 patrols, 100 × 14 garrisons, `patrol count` skipped bytes, `garrison count` bytes of
`gubGarrisonReinforcementsDenied`.

### 1.5 `STRATEGIC_STATUS` fields involved (`Strategic/Strategic_Status.h:75-106`)

`ubHighestProgress` (the progress of `CalcDifficultyModifier`, admin upgrades, SAM counterattacks; updated hourly,
`Tactical/Campaign.cc:1290-1325`), `usPlayerKills` (kills portion of progress; incremented per merc kill,
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
counted twice by `GetNumberOfEnemiesInSector` (autoresolve and the enemy temp-file reconciliation,
`Strategic/Auto_Resolve.cc:308,2076`, `Tactical/Enemy_Soldier_Save.cc:175`) and once as "mobile" by the PBI. Real
roadblocks (gi 49–55) are never treated as mobile by these two functions.

`PlayerSectorDefended(id)` (`Queen_Command.cc:1279-1291`): any militia in the sector, or
`FindPlayerMovementGroupInSector` (a non-empty player group not between sectors, on the surface, without
in-transit/dead/POW members, not the airborne helicopter; `Strategic_Movement.cc:2843-2860`).

**Player view.** The player never sees the Queen's state (garrison ids, compositions, class split, routes, intentions,
pool, awake flag, alertness). Sector enemy knowledge is `WhatPlayerKnowsAboutEnemiesInSector` (`docs/16` §6.3): a
scouted sector shows a count only while `NumStationaryEnemiesInSector == 0`, so garrisons show as presence ("?") while
groups and roadblocks are counted.

---

## 2. Data (`data/externalized/`)

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

27 records, `ci` = position (0..26), with `priority`, `elitePercentage`, `troopPercentage`, `adminPercentage`,
`desiredPopulation`, `startPopulation` (`ARMY_COMPOSITION`, §1.3). The names (`QUEEN_DEFENCE` 0 … `ROADBLOCK` 25,
`SANMONA_SMALL` 26) are the composition enum the code tests and §2.3 references. Reading notes: a start population of
exactly 20 marks a spawning location, neither scaled nor varied (§3.3, §3.4); `QUEEN_DEFENCE` alone goes above 20
(32/32); `ROADBLOCK` has start 0 (its garrisons exist only through the 20% roll of §3.4); `OMERTA_WELCOME_WAGON` has
desired 0, start 3; `SANMONA_SMALL` is all zeros. Difficulty scaling: §3.3 steps 3–5.

### 2.3 `army-garrison-groups.json`

57 records `{sector, composition}`, `gi` = position (0..56); `composition` must match a composition name exactly. The
indices the rules depend on: gi 0 P3 (`QUEEN_DEFENCE`); 25 H1 (`WEST_GRUMM_DEFENCE`, the §1.6 quirk); 28 A9
(`OMERTA_WELCOME_WAGON`); 33..36 H13 H14 I13 (`ALMA_DEFENCE`) and I14 (`ALMA_MINE`), §6.6; 49–55 the roadblocks G12 M10
G6 C9 K10 G7 G3; 56 C5 (`SANMONA_SMALL`).

### 2.4 `army-patrol-groups.json`

29 records `{size, priority, points}`, `pi` = position (0..28), 2–4 points (`ubSectorID[4]`, 0 = unused). The group
starts on `points[1]` (§3.6); pi 3 (B10 B12) and 4 (A11 A14 D14) are the admin patrols (§3.6). Consecutive points are
axis-aligned (required by `AddWaypointToPGroup`, `Strategic_Movement.cc:360-458`). Some points overlap garrison sectors
(G3, G7, G12, M10 are roadblocks) despite the JSON header's rule. Scaled sizes: §3.3 step 5.

### 2.5 Other files the AI reads

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
(§12.2). Full order: `docs/15`.

**The clock reads day 1, 01:00** (`STARTING_TIME = 86400 + 3600` s, `Strategic/Game_Clock.h:100`; vanilla
`V:Strategic/GameClock.h:96`): `GetWorldHour() = 1`, which is night for enemy group movement (§3.6).

### 3.2 Underground enemies (`BuildUndergroundSectorInfoList`, before `InitStrategicAI`)

For each record of `strategic-map-underground-sectors.json`, in file order
(`externalized/strategic/UndergroundSectorModel.cc:13-25`): `troops = n[d−1] + R(var[d−1])`, then elites, then
creatures, each a separate statement (fixed order; `R(0)` draws nothing). Non-zero entries: J9 b1 troops 8/11/15; J9
b2 creatures 4/6/8 + R(2) (no sci-fi check here); K4 b1 troops 8/10/12 + R(3), elites 5/6/7 + R(2); O3 b1 the same as
K4; P3 b1 elites 8/10/14 + R(3/5/6). These are static garrisons: the Queen never reinforces underground.

### 3.3 `InitStrategicAI` (`Strategic_AI.cc:316-561`), step by step

1. Reset globals (`:318-328`): extra elites, aware battles, awake, points, phase, meanwhile flags, victories,
   alternate Queen position.
2. `giReinforcementPool`, `giForcePercentage`, `giArmyAlertness`, `giArmyAlertnessDecay`, `gubMinEnemyGroupSize`,
   `gubHoursGracePeriod` from policy (`:334-339`). **Draw 1:** `evaluate_time = 475 + time_evaluate_in_minutes +
   R(time_evaluate_variance)`; `AddStrategicEvent(EVENT_EVALUATE_QUEEN_SITUATION, evaluate_time, 0)` (`:340-342`).
   The stamp is an **absolute** minute (835..1014 on medium), i.e. day 0, before the start clock (1500 min): the event
   fires at the first event processing after the game starts (`Strategic/Game_Events.cc:59-80` processes past stamps
   without moving the clock). The comment "7:55am on day 1" is wrong; the behaviour stays.
3. Every `SectorInfo[i].ubGarrisonID = 255` (`:345-348`); `gArmyComp` = JSON copy (`:352`).
4. Easy: `LEVEL2_DEFENCE` and `LEVEL3_DEFENCE` desired = start = 0; medium: `LEVEL3_DEFENCE` (`:355-365`).
5. `gPatrolGroup`, `gGarrisonGroup` = JSON copies; `gubGarrisonReinforcementsDenied` zeroed (`:368-374`). If
   `force% ≠ 100` (`:377-405`): for every composition except QUEEN: `desired = min(20, desired·f/100)`, and `start =
   min(20, start·f/100)` unless `start == 20`; QUEEN: `desired = min(32, desired·f/100)`, `start = desired`. Patrols:
   `bSize = clamp(bSize·f/100, minGroupSize, 20)`. (Medium: nothing changes; patrols keep JSON sizes even below the
   minimum.)
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

Consequences: P3 = 32 elites on medium/hard (22 on easy) with 32 draws; **A9 = 3 / 4 / 6 troops** (start 3 →
scaled/varied ≤ 3, then the minimum wins; the `R(51)` and the `R(100)` per troop are still drawn); Drassen, Chitzena,
West Grumm (G1, H1), Balime and the C13/B13/D13 garrisons are admin-only (e.g. C13 medium: start 6..10 → 80% → 4..8
admins → at least 5); Cambria/Alma/Grumm mines get `admins` plus `start − admins` troops. Each roadblock exists in 20%
of games (desired 5/8/10 → varied).

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

The first waypoint (`points[0]`; the group stands on `points[1]`) calls `InitiateGroupMovementToNextSector`
(`Strategic_Movement.cc:1643-1790`). For enemy groups on the surface it rolls sleep when `hour ≥ 21 || hour ≤ 4`
(`:1704-1712`): **at init the hour is 1**, so it draws `C(67)` and, on success, `R(121)`: `uiTraverseTime =
GetSectorMvtTimeForGroup(...) + 360 + R(121)`; otherwise the plain travel time. It sets `fBetweenSectors`, the arrival
time and posts `EVENT_GROUP_ARRIVAL`.

`RandomizePatrolGroupLocation` (`Strategic_Movement.cc:3186-3259`): deletes the arrival event; `max = (number of
waypoints) − 1`; **draw** `c = R(2·max)`; `c ≥ max` → `ENDTOEND_BACKWARDS`, `ubNextWaypointID = c − max`, the group
stands on waypoint `c − max + 1`; else `ENDTOEND_FORWARDS`, `ubNextWaypointID = c + 1`, stands on waypoint `c`. With
`gfRandomizingPatrolGroup` set: `SetEnemyGroupSector` (keeps the waypoints, clears `fBetweenSectors`), then
`InitiateGroupMovementToNextSector` again: **draws** `C(67)` [+ `R(121)`] (still night), arrival = now + traverse,
then `uiTraverseTime = 1 + R(uiTraverseTime − 1)` and the arrival is re-set to now + that (`:1756-1760`). A sleeping
patrol therefore arrives anywhere in 1..(travel + 360..480) minutes. `GetSectorMvtTimeForGroup` and the waypoint code
draw nothing.

### 3.7 Weapon cache (`:552-560`, `externalized/strategic/CacheSectorsModel.cc:21-34`)

**Draw** `R(5)` picks one of E11 H5 H10 J12 M9; `SF_USE_ALTERNATE_MAP`; `ubNumTroops = 8/10/12 + R(0)` (no draw). The
cache has no garrison id: it is never reinforced, detected from or counted in weights. (E11 is on patrol 8's route, M9
on patrol 23's.)

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

Preceded by the underground draws of §3.2, followed by `InitBloodCatSectors` (no draws) and the rest of
`InitStrategicLayer` (`docs/15`).

### 3.9 State after init

1 queen-evaluation event (day-0 stamp), 57 periodic check events, 29 arrival events, 29 enemy groups (ids 1..29 if no
other group exists), `awake = false`, `requestPoints` = sum of positive garrison weights, `reinforcementPoints` = sum of
magnitudes of negative ones (Meduna's surplus of 4 gives only −2 each because of its priority 95), all patrol weights 0
(not computed at init).

---

## 4. Timing and entry points

### 4.1 `EVENT_EVALUATE_QUEEN_SITUATION` (`Strategic/Game_Event_Hook.cc:246-248`)

`EvaluateQueenSituation` (§6.1) reschedules itself at its start:

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

Sector loads set `gpBattleGroup` for enemy-instigated battles (§10.1). Autoresolve takes its enemy roster from
`GetNumberOfEnemiesInSector` (H1 quirk), calls `ProcessQueenCmdImplicationsOfDeath` per dead enemy with the autoresolve
sector, and on victory removes the sector's garrison and groups, then calls `SetThisSectorAsPlayerControlled(…, true)`
and `RecalculateSectorWeight`.

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
garrison is exactly at its desired size. Called before every use in the selection loops, so loops observe weights that
may differ from the totals used for their random draw (the order matters).

`RecalculateSectorWeight(id)` (`:1501-1511`): the first garrison with that sector.

### 5.2 `RecalculatePatrolWeight(pg)` (`:1430-1454`)

```
prev > 0: requestPoints −= prev
if pg.group ≠ 0: need = pg.size − GetGroup(pg.group).ubGroupSize; need < 0 → bWeight = 0, return
else need = pg.size
w = min(need · 3 · priority / 96, 2)            // sic: min, so 0, 1 or 2 (vanilla too, V:StrategicAI.c:2926)
pg.bWeight = w; requestPoints += w
```

Patrol demand is tiny (≤ 2) and a small deficit with low priority gives 0. A destroyed patrol (`group = 0`) keeps
weight 2 forever but is never selected (§5.4), so these phantom points keep `requestPoints` positive.

### 5.3 `RecalculateGroupWeight(g)` and grace (`:1517-1543`)

For the patrol whose `group == g.id`: if `g.ubGroupSize == 0`, `TagSAIGroupWithGracePeriod` (`fillDayMod100 = (day +
patrol_grace_period_in_days) % 100`) and `group = 0`; then `RecalculatePatrolWeight`. `PermittedToFillPatrolGroup`:
`day ≥ fillDayMod100 + (day/100)·100` — the mod-100 arithmetic makes a grace period that crosses a day multiple of 100
expire at once (quirk).

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
(`V:StrategicAI.c:4091-4230`). The extra-elites path is unreachable in the campaign (§9.5).

### 6.3 `UpgradeAdminsToTroops` (`:3277-3351`)

`minPrio = 100 − 10·HighestPlayerProgressPercentage()` (≤ 0 from 10% progress). For each garrison (skip the loaded
sector id, i.e. `gWorldSector.AsByte()` regardless of z) with admins and composition priority `> minPrio`: for each
admin, `C(priority)` → admin becomes troop. Then each enemy group in list order (skip empty, vehicles, groups in
`gWorldSector`): priority = its patrol's `bPriority` if intention is `PATROL` (asserted to have one), else 50; same
rule. All draws in that order.

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
    if extra and limited and n == max: if !C((n + extra)·100/defence): return     // defence 0 → division by zero
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

Group sizes can exceed 20 (up to `max`, 60); the tactical side handles that through pending enemies (§10.4). The pool
path stages with intention `STAGING` but without `ubPendingReinforcements`. Draw order on the source path:
`R(points + pool)`, the draws inside `ChooseSuitable…`, optional `C`, then `Convert` draws, then `RemoveSoldiers…`
draws, then the movement's night-sleep roll (§7.1). The division by a zero defence is defined in ja2-node (deviations.md
"Strategic AI undefined behaviour").

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
the loop continues with a negative `r`.

---

## 7. Group orders

### 7.1 `MoveSAIGroupToSector(&g, dst, code, intention)` (`:3677-3708`)

If between sectors, `SetEnemyGroupSector(g, g.sector)` (teleport back, waypoints removed). `intention = …`,
`moveType = ONE_WAY`. If already in `dst`: `EvaluateGroupSituation(g)`; a `true` result nulls the caller's pointer.
Then path (`docs/16`): `STAGE` = avoid player-influenced sectors and stop one short (fallback: direct path stopping one
short), `EVASIVE` = avoid player-influenced sectors (fallback: direct), `DIRECT` = plain A*. "Player influenced" = any
merc, any militia, or `!OkayForEnemyToMoveThroughSector` for every path sector except the destination
(`Strategic_Pathing.cc:298-312`). The route becomes waypoints (`RebuildWayPointsForGroupPath`,
`Strategic_Pathing.cc:799-895`); the first waypoint starts the movement, which for an enemy group on the surface between
21:00 and 04:59 draws `C(67)` and on success `R(121)` (sleep 360..480 extra minutes, `Strategic_Movement.cc:1704-1712`).
A one-node path (already there) adds nothing and the group stays.

`OkayForEnemyToMoveThroughSector(id)` (`:572-581`): false while `uiTimeLastPlayerLiberated` is set and
`liberated + graceHours·3600 > now`.

### 7.2 `EvaluateGroupSituation(g)` — arrival at the final destination (`:974-1136`)

Only while awake. Returns true when the group was deleted or redirected.

- `PURSUIT`: lost the target → `ReassignAIGroup`, true.
- `REINFORCEMENTS`:
  1. A garrison in this sector whose `pending == g`: if not P3: `EliminateSurplusTroopsForGarrison`, add the group's
     admins/troops/elites to the garrison; at a SAM site set `bSAMCondition = 100` and `UpdateSAMDoneRepair` (the
     repaired graphic goes to the map temp file, so the sector gets `SF_MAP_MODIFICATIONS_TEMP_FILE_EXISTS`). At P3
     (`:1021-1042`): if elites < 20 and elites + size ≥ 20, the pool gains **`20 − elites`** (the number that filled
     the guard, not the real overflow `size − (20 − elites)`) and elites = 20 (`MAX_STRATEGIC_TEAM_SIZE`, not 32); if
     elites + size < 20, elites += size (the whole group counts as elites); if elites ≥ 20, pool += size. Then
     `SetThisSectorAsEnemyControlled`, `RemoveGroup`, `RecalculateGarrisonWeight`, true.
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

`ReinforcementsApproved` here also increments denials for rejected garrisons. `SendGroupToPool(g)` (`:3379-3390`): at
P3 → `TransferGroupToPool`, else `Move(g, P3, EVASIVE, REINFORCEMENTS)` (not pending anywhere, §7.2 case 3). The loop
past the patrol array is defined in ja2-node (deviations.md "Strategic AI undefined behaviour").

### 7.4 Bookkeeping

- `RemoveGroupFromStrategicAILists(g)` (`:1396-1423`): first patrol with `group == g` → `group = 0` + recalc, return;
  or `pending == g` → 0, return; then garrisons `pending == g` → 0. One match only.
- `RepollSAIGroup(g)` (`:3545-3575`): at final destination → `EvaluateGroupSituation`; patrol member → recalc +
  `CalculateNextMoveIntention`; garrison pending → recalc + `CalculateNextMoveIntention`.
- `RedirectEnemyGroupsMovingThroughSector(s)` (`:3713-3740`): every `ONE_WAY` enemy group that
  `GroupWillMoveThroughSector(g, s)` is teleported to its sector and re-sent `EVASIVE` to its final waypoint with the
  same intention.

### 7.5 Staging (`CheckEnemyControlledSector` first half, `:1308-1355`)

For the garrison of the checked sector with a pending group at its final destination: if `ubPendingReinforcements > 4`:
`k = 3 + R(3)` troops are added (size += k, pending −= k), `RecalculateGroupWeight`; else all pending troops are added;
else (nothing pending) if the group is not in the garrison sector, `Move(g, garrison sector, DIRECT, g.intention)`. So
a staged group waits one sector short until the next periodic check of its target (80–123 min), tops up out of thin
air, then attacks directly.

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
it). Then false if not permitted; special sectors: F10 false while `FACT_HILLBILLIES_KILLED` is **set** (the code
tests the fact; its comment says the opposite); A9/A10 false before minute 3345 (day 2 07:45); B13/C13/D13 false
before 4710 (day 3 06:30); C5/C6/D5 = `FACT_KINGPIN_DEAD`; G1 false if G2 and (H1 or H2) are player-defended; H2 false
if **H2** and (G1 or G2) are defended (checks itself, quirk); otherwise true.

### 8.3 `AdjacentSectorIsImportantAndUndefended(id)` (`:245-262`)

Town id not Omerta, San Mona, Estoni; no garrison enemies (groups ignored); `ubTraversability[THROUGH] == TOWN`; not
`PlayerSectorDefended`.

### 8.4 `StrategicAILookForAdjacentGroups(g)` (`:1165-1304`)

**Asleep:** an enemy group at its final destination wakes the Queen (`WakeUpQueen`, §9.1) and, if in A9 or P3, is sent
to the pool; then, unless just woken, return false. Patrols are `ENDTOEND`, never "at final destination", so only
`ONE_WAY` groups (created by meanwhile actions) can do this. Player arrivals do nothing while asleep.

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

- `HandlePlayerGroupNoticedByPatrolGroup(pg, eg)` (`:670-709`): `offence = 2·admins + 4·troops + 6·elites` of the enemy
  group; `target = pg.next.x ? pg.next : pg.sector`. If `PlayerForceTooStrong(pg.sector)` or `target` has a garrison:
  `RequestAttackOnSector(pg.sector, defence)` (= `SendReinforcementsForGarrison` for the garrison of that sector if it
  has no pending group, `:229-242`), false. Else `Move(eg, target, DIRECT, PURSUIT)`, true. The patrol slot keeps
  pointing at the group until it arrives and is reassigned.
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
  enemies ≥ 2·minGroupSize`: group of `avail/2` troops, `Convert(dst comp)`, `RemoveSoldiers…(src)`, pending,
  `Move(DIRECT, REINFORCEMENTS)`. No loaded-sector guard (quirk: can split the garrison the player is fighting).

### 8.6 `CheckEnemyControlledSector(id)` second half (`:1356-1392`)

Asleep → return (before staging too). If the sector still has garrison enemies: for N (−16), E (+1), S (+16), W (−1):
permitted, important-and-undefended and a notice → `HandleEmptySectorNoticedByGarrison`, return.

---

## 9. Reactions, triggers and growth

### 9.1 Waking the Queen

`WakeUpQueen` (`:3023-3031`): `awake = true`; first time only: `MassFortifyTowns`. Triggers:
1. Meanwhile `END_OF_PLAYERS_FIRST_BATTLE` on hard only (`Meanwhile.cc:445-451`).
2. Meanwhiles `DRASSEN/CAMBRIA/ALMA/GRUMM/CHITZENA/BALIME_LIBERATED` (`Meanwhile.cc:452-462`), posted 5 minutes after
   a whole town is liberated (`Meanwhile.cc:651-667`, called from `docs/18`).
3. `gusPlayerBattleVictories == 5 − d` (4/3/2) in `StrategicHandleQueenLosingControlOfSector` — every contested surface
   win counts, garrison or not, including re-wins of owned sectors (inferred from the call site).
4. An enemy `ONE_WAY` group reaching its final destination while asleep (§8.4).
5. Debug toggle (not ported).

`STRATEGIC_AI_ACTION_QUEEN_DEAD` puts her back to sleep (`End_Game.cc:193`).

### 9.2 `MassFortifyTowns` (`:3036-3069`)

For each garrison below desired with no pending group, not `ROADBLOCK`, `EnemyPermittedToAttackSector(null)`:
`RequestHighPriorityGarrisonReinforcements(gi, desired − existing)`. Then if A9 has troops: a group of them leaves A9
(A9 troops = 0), intention `PATROL`, `ONE_WAY`, `ReassignAIGroup`, `RecalculateSectorWeight(A9)`.

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

Run when the scene ends **or is skipped**; the scene is scheduled at `now + 5 min` (`ScheduleMeanwhileEvent`,
`:170-200`) and delayed by `180 + R(121)` seconds while a battle is on (`Game_Event_Hook.cc:45-56`). Scene flow and
ja2-node's scenes without cutscenes: `26` (deviations.md "Meanwhile scenes").

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
| `NPC_ACTION_SEND_TROOPS_TO_SAM` (292) | yes | `n = 3 + d + HighestProgress/15`; `pool = max(0, pool − n)`; elite group of `n` from P3, `Move(STAGE, REINFORCEMENTS)`; the SAM garrison's previous pending group is removed from the lists and reassigned after the new group becomes pending |
| `ADD_MORE_ELITES` (260) | **no** | `gfExtraElites = TRUE`, `EvolveQueenPriorityPhase(TRUE)` (§6.2) |
| `GIVE_KNOWLEDGE_OF_ALL_MERCS` (261) | **no** | `gubNumAwareBattles = num_aware_battles` (§8.1) |
| `SEND_SOLDIERS_TO_DRASSEN` (30), `…_BATTLE_LOCATION` (31), `…_TO_OMERTA` (259) | **no** | sizes: Drassen `3 + 3d` (D13 50%, else B13 60%, else C13), battle location `4d` (the garrison test indexes `gArmyComp[!composition]`, a typo), Omerta `6d` troops + `6d/7` elites |

"No": implemented in `ExecuteStrategicAIAction` but no caller passes these codes; NPC scripts and meanwhiles route them
to `HandleNPCDoAction`, which ignores them (vanilla too, `V:Tactical/InterfaceDialogue.c:3037-3042`); no other code
sets `gfExtraElites` or `gubNumAwareBattles`. The Queen does **not** send a squad to the first battle's location.
ja2-node ports `ADD_MORE_ELITES` and `GIVE_KNOWLEDGE_OF_ALL_MERCS` but not the three send actions (deviations.md
"Unreachable Queen actions").

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

Called on sector load unless in a meanwhile (except INTERROGATION), and on re-entering the loaded sector when no enemy
is in it (`StrategicMap.cc:448, 634`).

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

Group membership of individual soldiers is therefore by team-slot order, not by placement; that only matters for which
strategic record a death decrements (§10.7).

### 10.2 `AddSoldierInitListEnemyDefenceSoldiers(A, T, E)` (`Tactical/Soldier_Init_List.cc:616-1025`)

The placement of the class mix (`SortSoldierInitList`'s reverse-map-order blocks, the PD, P, D passes with Strac's
every-other-node PD walk, forced priority slots, block B, leftovers, class by `R(remaining)`) is `16` §5.13. Every
accepted placement goes through `AddPlacementToWorld` (stats, palettes, `GenerateRandomEquipment` with
`CalcDifficultyModifier`, §11); a failure (no free slot) stops the whole function.

### 10.3 Revisiting a sector (`docs/16` owns persistence)

If an enemy temp file younger than 300 minutes exists (`Tactical/Enemy_Soldier_Save.cc:127-133`), its soldiers
replace placements, and only the strategic excess over them (`GetNumberOfEnemiesInSector`, with the H1 quirk) is added
through §10.2 (`:282-292`).

### 10.4 Pending enemies and mid-battle arrivals (`Queen_Command.cc:914-1047`)

There is **no pull of reinforcements from adjacent garrisons** in vanilla or Strac (that is a 1.13 feature). Enemies
join a running battle only when (a) a battle had more than 32 enemies, or (b) an enemy group's strategic movement ends
in the loaded battle sector (`CheckConditionsForBattle` → `HandleArrivalOfReinforcements`,
`Strategic_Movement.cc:716-727, 2253-2290`: `pendingEnemies = true`, `ResetMortarsOnTeamCount`,
`AddPossiblePendingEnemiesToBattle`). Arrivals need running world time, so they happen only in real time.

`AddPossiblePendingEnemiesToBattle` (only if `pendingEnemies`): `slots` = free enemy slots; for each enemy group in
list order in the loaded surface sector: while it has members not in battle and slots remain, add a troop if any left,
else an elite, else an admin (in-battle counters++). If any were added: the entry side is where the group came from,
using `ubPrev` if valid, else `ubNext` (`sector.x < prev.x` → `INSERTION_CODE_EAST`, `>` → WEST, `sector.y < prev.y` →
SOUTH, `>` → NORTH), then `AddEnemiesToBattle`. At the end, `slots ≠ 0` → `pendingEnemies = false`. Called at the end
of every tactical "turn" (`HandleTacticalEndTurn`, real time every 5 s and in TB) and in `EndTurn` when no interrupt is
queued.

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
not join any group or adjacent sector. Enemy groups whose battle ends with a player retreat or defeat are reset by
`ResetMovementForEnemyGroupsInLocation` (→ `RepollSAIGroup`, §7.4; `docs/16`/`19`).

### 10.9 Not in battle: `NumFreeEnemySlots`

Free = not active in the enemy team's 32 slots; a dead soldier frees its slot when it becomes a corpse
(`Tactical/Rotting_Corpses.cc:735`).

### 10.10 Underground (`:530-546`)

`PrepareEnemyForUndergroundBattle`: if the record has enemies, in-battle += the not-yet-placed counts, but
`AddSoldierInitListEnemyDefenceSoldiers` is called with the **total** counts (quirk). No groups underground.

### 10.11 Capture

`EnemyCapturesPlayerSoldier` (`:1165-1276`): after a lost tactical battle with 2–3 incapacitated mercs and enemies
present (`Tactical/Overhead.cc:5011-5068`), after an autoresolve surrender/capture (`Auto_Resolve.cc:1676-1681`), or by
civ-quote/turn-based-input paths. Not if both capture flags are set or more than 3 were captured; EPCs die; vehicles
skipped. Morale event, assignment POW, neutral during the first capture, removed from squads, moved with items dropped
to Alma I13 (first time; `QUEST_HELD_IN_ALMA`) or N7 (interrogation after that quest), bleeding 0, life `lifeMax/2`
(≤ 35 → 35; ≥ 45 → `+ 10 − R(21)`), breath 50. Meanwhile INTERROGATION scheduled. ja2-node:
`enemyCapturesPlayerSoldier` in `src/sim/campaign/merc-fate.ts`; the capture sequence and its entry points are `26`.

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

At game start in A9 the modifier is therefore 1 (easy enemies: 0 + 6 − 5), 11 (medium) or 21 (hard).

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

`src/sim/strategic/ai/difficulty.ts`: `calcDifficultyModifier(inputs, class)` is pure over `DifficultyInputs`
(difficulty, highest progress, predicted mine income, battle sector and its town); `difficultyModifierAt(q, class,
battleSector)` takes the battle sector explicitly (no global "current battle sector"); `pythDistanceFromPalace` uses the
integer rounding of §11.2. The progress functions of §11.3 live there too. `SectorFlow.difficultyModifier(class)`
(`src/sim/campaign/sector-flow.ts`) feeds `PopulationEnv.difficultyModifier` at soldier creation; at sector load it
also stores the ARMY value in `TacticalState.campaign.difficultyModifier` for `soldierDifficultyLevel` (`docs/13` §4.3;
militia levels are fixed there), so that value does not follow progress changes during the battle. The sandbox (`server/sandbox.ts`) uses a medium game without progress or mine income (deviations.md
"Sandbox population").

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
  eaten civilians; enemy-owned → nothing. Quirk: `ubDayOfLastCreatureAttack` is written on the event's mine sector, not
  the attacked one. Tactical composition by habitat weights with `std::discrete_distribution` over the shared engine
  (`:729-741`), not reproducible bit-exactly: ja2-node draws one weighted `Random(100)` per creature (deviations.md
  "Creature bodies for town attacks").
- Underground battles: `PrepareCreaturesForBattle` (`:797-882`) and `AddSoldierInitListCreatures`.

### 12.2 Bloodcats

`InitBloodCatSectors` (`Game_Init.cc:118-138`): `bBloodCats = −1` everywhere; placements from
`strategic-bloodcat-placements.json`; spawns (I16 lair 14/19/26, N5 arena 8/10/12) set both counts. The ambush on arrival
(`TestForBloodcatAmbush`, `Strategic_Movement.cc:3263-3356`: first visit `PR(100) < 5d`, size from difficulty and
progress, later visits 5%, the lair regrows 1 per 18 h) is `docs/16`'s. `AddSoldierInitListBloodcats`
(`Soldier_Init_List.cc:1495-1629`) places them. Bloodcat deaths decrement `bBloodCats` (§10.7). Bloodcats start
neutral and turn hostile on sight (`MakeBloodcatsHostile`, with a `Random(2)` roar draw).

### 12.3 In ja2-node

Sci-fi campaigns run the whole strategic creature quest; the tactical creature AI is `13`.

| Module | Contents |
|---|---|
| `src/content/strategic/creature-lairs.ts` | `parseCreatureLair` → `StrategicContent.creatureLairs` (lair sectors with habitats, mine, entrance sector, attack sectors with chances and insertion codes, warp exit), `lairContainsSector` |
| `src/sim/strategic/creatures/creatures.ts` | `CreatureState` and the §12.1 functions in camelCase (`initCreatureQuest`, `spreadCreatures`, `creatureNightPlanning`, `endCreatureQuest`, …), `distributeCreaturesByWeight`, `CREATURE_WEIGHTS_BY_HABITAT`, `importCreatureDirectives` (native saves) |
| `src/sim/strategic/creatures/town-attack.ts` | `creatureAttackTown`, `determineCreatureTownComposition`, `clearSurfaceCreatures` |
| `src/sim/campaign/creature-flow.ts` | `CreatureFlow` (`campaign.creatures`): the spread, night-planning and attack events, the CREATURES meanwhile (`now + 5`), the economy hooks, the quest end on the Queen's `creatureQuestEnded`, `battleSetup` (`PrepareCreaturesForBattle`), civilians eaten (`civiliansEaten` event) |
| `src/sim/tactical/init-list.ts` | `addSoldierInitListCreatures`, `addSoldierInitListBloodcats` (pure `place…FromInitList` cores), `addCreaturesToBattle`, `tacticalCreateCreature` |

Creature and bloodcat bodies are built in `src/sim/tactical/creation.ts`; `makeBloodcatsHostile` is in
`src/sim/tactical/perception/sight.ts`; `hostileBloodcatsPresent` (`src/sim/tactical/sector-presence.ts`) answers the
PBI codes, group arrivals and the compression refusal. `CreatureState` (`StrategicState.creatures`): `lairId` (0 none,
−1 destroyed), `habitatedDistance`, `populationModifier`, `destroyedLairId`, `meanwhileScenePlayed`,
`useCreatureMusic`, and `attack {insertionCode, insertionGridNo, numAttacking, battleCode, sectorId}`, which holds the
original's process globals `gsCreatureInsertionCode`, `gsCreatureInsertionGridNo`, `gubNumCreaturesAttackingTown`,
`gubCreatureBattleCode`, `gubSectorIDOfCreatureAttack` as campaign state.

`CreatureAttackTown` reaches the PBI (player groups, encounter `creatureAttack`), autoresolve with auto-start (militia
only; creature cells AF, AM, YF, YM from the composition), the loaded sector (creatures added at once, no pause;
deviations.md "Creature attacks in tactical") or eats civilians. A sector load adds bloodcats and the creatures of a
mine level or a pending attack; entering J9 b2 starts the quest. A won tactical battle runs
`KillIncompacitatedEnemyInSector` first. Time compression is refused while a player group is in an infested mine.
Quest scripting gaps: deviations.md "Creature quest scripting".

---

## 13. Implementation in ja2-node

### 13.1 Content and state

- `src/content/strategic/army.ts`: `loadArmyContent(read)` / `parseArmyContent` read five JSONC files
  (`army-compositions`, `army-garrison-groups`, `army-patrol-groups`, `strategic-ai-policy`, `game.json` `progress`)
  into `ArmyContent` (templates, `StrategicAiPolicy` per difficulty, `ProgressPolicy`), loaded next to
  `StrategicContent`. Validation follows Strac's `ArmyCompositionModel::validateData`: a garrison's `composition` must
  name a composition (unknown → error); 27 ≤ compositions ≤ 60, patrols ≤ 50, garrisons ≤ 100 (the save array
  sizes); patrol points 2..4, consecutive points axis-aligned. No transcribed table is needed: the AI data is the
  externalized JSON. The stub pack uses the same JSON; `stubs/sector-kinds.ts` gives every garrison, town, mine, SAM
  and underground sector a stub map with the four edges and room for a garrison of 20.
- Named constants of `Strategic_AI.cc` and `Meanwhile.cc` (composition indices, special-sector lists of §6.6, §8.2,
  §9.6, minutes 475/3345/4710, check period, staging and SAM-squad numbers, offence/defence weights) are in
  `src/sim/strategic/ai/constants.ts`; `DIFF_FACTOR_*` (50/30/20, +5/−5), `PALACE_SECTOR` (3,16),
  `MAX_PALACE_DISTANCE` 20, Orta/Tixa 4, Alma 10 in `ai/difficulty.ts`.
- `StrategicState` (`src/sim/strategic/state.ts`) holds `queen` (`QueenState`: the globals of §1.4 with the saved
  `saiVersion`, plus `compositions`, `garrisons`, `patrols`, `garrisonDenied`), `status` (`StrategicStatus`, §1.5),
  `meanwhile` (`MeanwhileState`, `26`) and `creatures` (§12.3); all plain data (`ai/queen-state.ts`,
  `cloneQueenState`). Sector enemy fields live on the shared sector record of `docs/16`, `ENEMYGROUP` fields on its
  enemy groups. Fixed-width writes go through `src/core/int.ts` (`u8` counts and denials, `i8` weights and composition
  fields, `u16` offence/defence and victories).
- RNG: every function takes a `RollSource` (`int(n)`, `chance(p)`; `src/sim/strategic/forces/ports.ts`).
  `rollInt`/`rollChance` (`ai/context.ts`) pass the argument through `u32` as the original's `UINT32` parameter does,
  so `R(points + pool)` with a negative pool and a negative `C(p)` behave as in the original; `rollChance` always draws.
- Saves: ja2-node saves snapshot `QueenState` exactly, with no recomputation on load. Native import:
  `readStrategicAiSections(bytes, save)` (`src/content/formats/savegame-strategic-ai.ts`) decodes section 35 (§1.4),
  section 34 (`STRATEGIC_STATUS`, §1.5) and the meanwhile flags and first-battle sector of section 24;
  `importStrategicAi(q, sections, {runLoadHooks})` (`ai/save-import.ts`) restores them and, for native saves, runs
  `runStrategicAiLoadHooks` (the load hooks of §4.3; deviations.md "Strategic AI load hooks"). Not ported:
  `ReinitializeUnvisitedGarrisons` and the patches for SAI versions below 29 (all known native saves are version 29).

### 13.2 Modules (`src/sim/strategic/ai/`)

Functions keep the original names in camelCase (`RecalculateGarrisonWeight` → `recalculateGarrisonWeight`). Each
takes a `QueenContext` = `StrategicContext` (`docs/16`) + `ArmyContent` + `MineIncomePort` (`docs/18`) + `QueenHooks`
(`samRepaired`, `creatureQuestEnded`, `profile`, `startQuest`), built by `createQueenContext` (`context.ts`, also
`rollInt`/`rollChance`).

| Module | Contents |
|---|---|
| `queen-state.ts` | `QueenState`, `StrategicStatus`, `MeanwhileState` and their records, `cloneQueenState` |
| `constants.ts` | named constants (§13.1) |
| `counts.ts`, `weights.ts`, `composition.ts` | §1.6, §5.1–§5.4, §5.5 |
| `init.ts` | `initStrategicAI` (§3, draw order of §3.8), `initStrategicStatus` |
| `evaluate.ts`, `reinforce.ts` | §6.1–§6.3; §6.4–§6.7 with `requestAttackOnSector`, `requestHighPriorityGarrisonReinforcements`, `massFortifyTowns` (§9.2) |
| `orders.ts`, `detection.ts`, `reactions.ts` | §7, §8 (the notice rolls are `attemptToNotice{EmptySector,AdjacentGroup}Succeeds`), §9 (plus `queenBasementTaken`) |
| `meanwhile.ts` | meanwhile scheduling, scene resolution and `processImplicationsOfMeanwhile` (§9.4; `26`) |
| `queen-command.ts` | §10: `prepareEnemyForSectorBattle` returns a `SectorBattlePlan` (class counts for the defence placements, stationary count, enemy-instigated groups) and updates the in-battle counters and `pendingEnemies`; `assignEnemyGroupIds`; `processQueenCmdImplicationsOfDeath(q, dead, autoResolveSector)`; `addPossiblePendingEnemiesToBattle` returns `PendingArrival[]` (group, entry code, classes) for the tactical side to place; `endTacticalBattleForEnemy` returns whether `GLOBAL_LOYALTY_ABANDON_MILITIA` applies |
| `defence-placement.ts` | §10.2 as pure functions over `PlacementNode`s with an injected roll source and an `add(node)` callback; `src/sim/tactical/init-list.ts` wraps them |
| `difficulty.ts`, `status.ts` | §11 (§11.4); `trackEnemiesKilled`, `recordPlayerKill` |
| `save-import.ts` | `importStrategicAi`, `runStrategicAiLoadHooks` (§13.1) |
| `strategic-ai.ts` | `StrategicAi`, the `StrategicAiPort` of `docs/16` (`src/sim/strategic/forces/ports.ts`), bound with `bind(ctx)`; `initStrategicAiForNewCampaign`; `registerStrategicAiEvents` (`EVALUATE_QUEEN_SITUATION`, `CHECK_ENEMY_CONTROLLED_SECTOR`, `MEANWHILE`) |
| `economy-link.ts` | bridge to `docs/18`: `queenMineIncome`, `queenEconomyHooks` (mine ran out, meanwhile postings), `queenEconomySlots` (hourly progress) |

### 13.3 Wiring

`CampaignSim` (`src/sim/campaign/campaign-sim.ts`) takes `hooks.queen = {army, mines?, hooks?}`, passes the
`StrategicAi` as the strategic context's AI port, exposes the bound context as `campaign.queen`, registers its events
and, with an economy, the mine income, mine-ran-out, meanwhile and hourly-progress hooks. The §4.3 callers: new game in
`src/sim/campaign/new-game.ts` (`initStrategicLayerMap(…, {initStrategicAI})`); arrival, `RemoveGroup`, battle reset,
avoid-player pathing and losing control in `docs/16`'s movement code through `StrategicAiPort`; sector load/unload,
tactical deaths, map-edge escapes and pending enemies in `src/sim/campaign/sector-flow.ts`; autoresolve in
`src/sim/campaign/autoresolve-strategic.ts`; the first battle in a town in `battle-flow.ts`; the end game in
`endgame-flow.ts`.

### 13.4 Verification

Oracle: `tools/oracle/probes/sai-newgame.txt` and `sai-saves.txt` (patch `0003`, `tools/oracle/sai-compare.ts`) replay
every native draw with asserted ranges and compare full `sai` and `diffmod` dumps for new games on all difficulties and
the six native saves; creatures: `creatures.txt`, `creature-battles.txt`, `creature-placement.txt` (patch `0006`);
placement: the `initlist` and `defence` probes of `docs/16` §7. Details: `tools/oracle/README.md` ("Strategic AI",
"Creatures").

---

## 14. Quirks to keep

Original behaviour (vanilla too unless marked), each stated in its section:
- First evaluation at the first event processing (day-0 stamp, §3.3); rescheduling draws while asleep (§4.1).
- Init at 01:00: every patrol rolls the night-sleep `C(67)` twice (§3.6).
- Initial garrison weights use the modified local `start` (§3.5).
- Patrol weight `min(…, 2)`; destroyed patrols never refilled but keep weight 2 (§5.2, §5.4); mod-100 grace wrap (§5.3).
- Mercs count ×5 in `PlayerForceTooStrong`, ×4 in `ReinforcementsApproved`; denials wrap at 256; the P3 extra value
  wraps when `20 − req < 0` (§5.4, §6.4).
- `EvolveQueenPriorityPhase` recomputes from the **unscaled** JSON, undoes the mine `/4`, gives San Mona desired 6 but
  no approval (§6.2, §9.6).
- Groups up to 60 from the pool/staging paths; `ubGroupSize` never counts admins at creation (§1.2, §6.5).
- `ReinforcementsAvailable` = 0 outside spawning compositions, so step 4 of the source choice can abort (§6.6);
  `SendReinforcementsForPatrol` has no P3-ownership or minimum check and may send an empty group (§6.7).
- P3 takes reinforcements as elites up to 20 and credits the pool `20 − elites` (§7.2).
- The pool can go negative through `RequestHighPriorityGarrisonReinforcements`; recruiting only at exactly 0 (§9.2).
- F10 refused once the hillbillies are dead (code against comment); H2 checks itself; A9/A10/Drassen time gates (§8.2).
- §8.5's garrison handlers can split the loaded sector's garrison in real time.
- H1 counted twice / as mobile (`ubGarrisonID` compared with `ROADBLOCK`, §1.6).
- `PrepareEnemyForSectorBattle`'s elite clamp `32 − A + T` (§10.1); underground battles place total counts (§10.10);
  `SortSoldierInitList` reverses the PD, P and D blocks (§10.2).
- Fleeing enemies are strategically dead (§10.8).
- The send-soldiers, extra-elites and aware actions are unreachable; no squad goes to the first battle (§9.5).
- `ubDayOfLastCreatureAttack` written on the mine sector (§12.1).
- `R(0)` draws nothing, `C(p)` always draws; `Random` takes `UINT32`.

Deviations (entries in `deviations.md`): "Strategic AI undefined behaviour" (§6.5, §7.3, §10.2), "Strategic AI PD
placement pass" (Strac only, §10.2), "Unreachable Queen actions" (§9.5), "Strategic AI debug toggles", "Strategic AI
load hooks" (§13.1), "Meanwhile scenes" (§9.4), "Sandbox population" (§11.4), "Creature bodies for town attacks"
(§12.1).

---

## 15. Unverified

Not traced end to end and not reached by the oracle probes:
- Groups sent to P3 without a pending slot stay there as mobile groups (§7.2).
- Garrison-launched attack groups stay where their battle was (§8.5).
- Every contested surface win counts towards waking the Queen (§9.1; depends on the `docs/16`/`19` call sites).
- A stationary Mike/Iggy is decremented twice (§10.7).
- The later behaviour of an empty patrol-reinforcement group (§6.7).
- The order of the two `R` calls in `TacticalCreateEnemySoldier`'s noise target (compiler-defined, §10.4).
- The garrison notice path of §8.6: no probed situation had an important undefended neighbour.
- `PrepareEnemyForSectorBattle` as a whole (group ids by team order, the `32 − A + T` clamp): there is no `prepare`
  probe; the placement decisions are covered by `defence`.

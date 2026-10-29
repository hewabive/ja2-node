# Native oracle (JA2 Stracciatella probe build)

A patched JA2 Stracciatella build that runs headless on the original game data, executes a probe script and prints JSON
lines; `compare.ts` rebuilds every probe with ja2-node and reports mismatches. Verification level 6 (`01` §8).

Nothing in this directory contains or produces game data by itself, but probe **outputs** derive from the original data:
keep them in the work dir outside the repository (default `~/ja2-oracle`), never commit them.

## What is probed

| Area | Probes | Scripts (`probes/`) | Comparer | Patches | Spec |
|---|---|---|---|---|---|
| Tactical map and combat | movement costs, paths, line of sight, soldier dumps, chance to hit and AP of an aimed shot, the AI's best shot, light levels | `a9-*.txt`, scripts written by `save-probes.ts` and `map-light-probes.ts` | `compare.ts` | 0001 | `07`, `08`, `11`, `13`, `14`, `20` |
| Sector transitions | edgepoints, exit thresholds, walking off and in, the quick-traversal mirror, `OKForSectorExit`, the soldier init list, defence, creature and bloodcat placements | `sectors.txt`, `creature-placement.txt` | `sector-compare.ts` | 0004 | `16` |
| Strategic movement | travel table, strategic paths, the groups of a save | `strategic.txt` | `strategic-compare.ts` | | `16` |
| Strategic AI | new campaign, evaluation, garrison checks, the Queen waking, group arrivals, difficulty modifier, the load-time recomputation | `sai-newgame.txt`, `sai-saves.txt` | `sai-compare.ts` | 0003 | `17` |
| Towns, mines, assignments | strategic dumps, assignment estimates, loyalty events, time warps | `economy.txt` | `economy-compare.ts` | | `18` |
| Autoresolve and PBI | autoresolve draw by draw, the created soldiers, the strategic aftermath, the encounter code, enemy counts | `autoresolve-*.txt`, `battle.txt` | `autoresolve-compare.ts`, `autoresolve-creation.ts`, `autoresolve-aftermath.ts`, `pre-battle-compare.ts` | 0002, 0005 | `19` |
| Creature quest | quest start, spreading, night planning, town attacks, compositions | `creatures.txt`, `creature-battles.txt` | `creature-compare.ts` | 0006 | `17` |
| Team morale | hourly and quarter-hour morale, buddy and hated counters | `morale.txt` | `morale-compare.ts` | 0006 | `18` |
| Merchants | stock, restocks, prices, repairs, shop entry | `merchants.txt` | `merchant-compare.ts` | 0008 | `23` |
| Contracts | daily merc update, renewal sequence, extensions, departures, leave list | `contracts.txt` | `contract-compare.ts` | 0007 | `22` |
| Creature AI | creature and bloodcat decisions, melee, calls, smell | `creature-ai.txt` | `creature-ai-compare.ts` | 0009 | `13` |
| Laptop | `InitNewGame`, A.I.M., M.E.R.C. and I.M.P. hires, Bobby Ray's, insurance, the florist | `laptop.txt`, `florist.txt` | `laptop-compare.ts` | 0010, 0025 | `21` |
| Doors and civilian groups | locks, traps, door actions, civilian hostility | `doors.txt` | `doors-compare.ts` | 0011 | `35` |
| Attachment AP | the item description box | `attach.txt` | `attach-compare.ts` | | `12` |
| Facts and NPC presence | facts, quests, `CheckFact`, the 04:00 and hourly NPC handlers, the quest code of sector entry and exit, profile NPC placement | `facts.txt` | `facts-compare.ts` | 0012 | `25`, `35` |
| Talk | NPC records, desire to talk, record choice, conversation steps | `talk.txt` | `talk-compare.ts` | 0013 | `24` |
| Give | items and money to NPCs, NPC gifts, quest action items | `give.txt` | `give-compare.ts` | 0017 | `24` |
| Civilians | civilian quotes, named-NPC AI, the hostile-quote list and its AI pause, the surrender offer | `civ.txt` | `civ-compare.ts` | 0020, 0022 | `24` |
| Helicopter | flights, SAM fire, billing, hovering, landing, boarding, monologues | `heli.txt` | `heli-compare.ts` | 0014 | `25` |
| NPC actions | action catalog, requestor answers, NPC system events, Kingpin's money, the hospital | `actions.txt` | `actions-compare.ts` | 0015 | `35` |
| Schedules | posting, the 24-hour replay, processing, the AI's schedule steps | `schedules.txt` | `schedules-compare.ts` | 0016 | `35` |
| Recruiting | R.P.C.s, E.P.C. escort and release, the robot | `recruit.txt` | `recruit-compare.ts` | 0018 | `24` |
| Meanwhile and ending | postings, the event and its implications, played NPC moves, first-battle rules, milestones, captures, the Queen's death, the O3 statue | `meanwhile.txt` | `meanwhile-compare.ts` | 0019 | `26` |
| Boxing | the San Mona club | `boxing.txt` | `boxing-compare.ts` | 0021 | `25` |

Comparers that replay draws rely on the draw trace of 0002; the narrative comparers also on the `CheckFact` and dialogue
traces of 0013, 0015 and 0018.

## Layout

| Path | What |
|---|---|
| `build.sh` | Copies `reference/stracciatella` to the work dir, adds `src/`, applies `patches/`, builds |
| `run.sh` | Runs one probe script headless and prints JSONL (or writes it to a file) |
| `compare.ts` | Rebuilds probe outputs with ja2-node, dispatches each probe to its comparer, reports mismatches |
| `compare-all.sh` | `compare.ts` over every expected output in the work dir: the regression gate |
| `*-compare.ts`, `autoresolve-creation.ts`, `autoresolve-aftermath.ts` | The domain comparers ("What is probed") |
| `save-probes.ts` | Writes a probe script for native saves ("Savegames") |
| `map-light-probes.ts` | Writes a light-dump script for every original map with light sprites ("Lights") |
| `src/Oracle.{h,cc}` | The probe harness, copied into `src/game/` of the Stracciatella copy |
| `patches/*.patch` | Hooks into Stracciatella ("Hooks") |
| `probes/*.txt` | The shipped probe scripts ("Shipped probes") |

`reference/` is never modified. The work dir (`$JA2_ORACLE_DIR`, default `~/ja2-oracle`) holds `src/` (the patched copy),
`build/` (CMake build, binary `build/ja2`), `home/` (isolated Stracciatella home with `ja2.json` and copied saves), `tmp/`
(engine temp files, `ja2.log`), `oracle.log` (engine stderr of the last run) and the probe outputs.

## Requirements

Tested on Ubuntu 26.04 with GCC 15.2, CMake 4.2.3, Ninja, Rust/Cargo 1.93.1 (distribution packages; minimum in
`reference/stracciatella/min-rust-version`, 1.85.1), SDL 3.4.2:

```sh
sudo apt-get install build-essential cmake ninja-build pkg-config libsdl3-dev cargo rustc rsync patch
```

The first configure downloads pinned dependencies (magic_enum, Lua 5.3.6, sol2, string_theory, miniaudio) and the build
fetches the Rust crates, so network access is needed once. FLTK, gtest and the Rust tool binaries are not needed: the
build turns off the launcher, the unit tests and `ja2-resource-pack`.

## Build

```sh
tools/oracle/build.sh
```

About 3.5 minutes from scratch on 8 cores, 1.5 s for a no-op rerun, seconds when only `src/Oracle.cc` changed. Every run
re-creates the copy from `reference/stracciatella` (commit recorded in the binary version as `oracle.<commit>`), copies
`src/`, applies the patches in file-name order and syncs the result into `$JA2_ORACLE_DIR/src` by content, so unchanged
files keep their timestamps.

Environment: `JA2_ORACLE_DIR` (work dir, must be outside the repo), `JA2_ORACLE_BUILD_TYPE` (default `RelWithDebInfo`),
`JA2_ORACLE_JOBS` (default `nproc`).

Configure prints `fatal: not a git repository` once (Stracciatella asks git for a version hash; the copy has no `.git`):
harmless.

## Run

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
O="${JA2_ORACLE_DIR:-$HOME/ja2-oracle}"
tools/oracle/run.sh tools/oracle/probes/a9-paths.txt                      # JSONL to stdout
mkdir -p "$O/doors" && tools/oracle/run.sh tools/oracle/probes/doors.txt "$O/doors/doors.jsonl"
```

The optional second argument is the output file (its directory must exist). Exit status: 0 when every command succeeded,
1 when some command failed (its line carries `error`), 2 for usage errors.

| Variable | Meaning |
|---|---|
| `JA2_GAME_DIR` | Game root (the folder that contains `Data`) |
| `JA2_DATA_DIR` | Same as in ja2-node: the game root or its `Data` folder; used when `JA2_GAME_DIR` is unset |
| `JA2_SAVES_DIR` | Where `.sav` files are copied from (default `$JA2_GAME_DIR/SavedGames`) |
| `JA2_RESVERSION` | Stracciatella `-resversion` (default `ENGLISH`) |
| `JA2_ORACLE_DIR` | Work dir (default `~/ja2-oracle`) |

Headless: `SDL_VIDEO_DRIVER=dummy` (SDL3 creates its window and renderer on the dummy video driver),
`SDL_AUDIO_DRIVER=dummy`, `-nosound`, `HOME` = `$JA2_ORACLE_DIR/home` so the user's own `~/.ja2` is never touched, and
`TMPDIR` inside the work dir. The engine starts normally up to `InitializeGame()`, then the oracle runs instead of the
main loop, so no frame is ever rendered. Saves are copied (never linked) into the isolated home.

Running the binary by hand is equivalent:

```sh
cd ~/ja2-oracle/build
HOME=~/ja2-oracle/home SDL_VIDEO_DRIVER=dummy JA2_ORACLE=/abs/path/script.txt JA2_ORACLE_OUT=/abs/out.jsonl \
  ./ja2 -gamedir "$HOME/Jagged Alliance 2 Gold" -nosound
```

`JA2_ORACLE` (the script path) switches oracle mode on; `JA2_ORACLE_OUT` is optional. In oracle mode stdout carries only
JSONL: everything the engine prints goes to stderr.

## Probe scripts

One command per line, `#` starts a comment, arguments are `key=value` (sector and save names may be positional). Grid
numbers are `y * 160 + x`. Commands run in order; every output line carries `probe` and the script `line`; a failing
command emits an `error` line and the script continues. The last line is always
`{"probe":"end","commands":N,"failures":F}`.

This table holds the shared commands and those of the tactical, strategic, autoresolve and sector-transition probes; the
other domains list theirs in their sections under "Comparing with ja2-node".

| Command | Arguments | Does |
|---|---|---|
| `sector A9` | `z=0`, `map=<file>`, `hour=<0..23>` | Sets `gWorldSector` (and the game clock to that hour of day 1), `LoadWorld` on the sector's map |
| `save SaveGame01` | | `LoadSavedGame` from the isolated home's `SavedGames` |
| `seed` | `value=<n>`, `pre=keep\|reseed` | Reseeds the `Random` engine (a save restores the `PreRandom` ring and its index, not the engine); `reseed` also refills the ring from it and resets its index |
| `draws` | `on\|off\|dump` | Starts or stops a `Random`/`PreRandom` trace across commands; `dump` emits and clears it (used around `save` for the load-time recomputation) |
| `soldiers` | `detail=0\|1` | Soldiers in the loaded sector; `detail=1` dumps each like `soldier` |
| `soldier` | `who=<id>` | Full dump of one soldier of the loaded save |
| `costs` | `format=base64` (or `none`) | Dumps `gubWorldMovementCosts` |
| `path` | see below | `FindBestPath` + `PlotPath` |
| `los` | see below | `LineOfSightTest` and `SoldierToSoldierLineOfSightTest` |
| `cth` | see below | `CalcChanceToHitGun` + `CalcTotalAPsToAttack` for an aimed shot, prepared as the attack cursor does |
| `bestshot` | `who=<id>`, `keepAim=0\|1` | The AI's `CalcBestShot` on a soldier of the loaded save |
| `light` | `g=<g>`, `level=0`, `viewer=<id>` | `LightTrueLevel` of a tile, the ambient level and, with a viewer, `DistanceVisible` to it |
| `lights` | `level=0`, `format=base64` (or `none`) | `LightTrueLevel` of every tile, the ambient level, the light sprites |
| `ambient` | `level=<n>` | `LightSetBaseLevel(n)`: new ambient level, every light rendered again |
| `stratcosts` | `mask=FOOT\|CAR\|TRUCK\|TRACKED\|AIR` | `ubTraversability[5]` of the 256 sectors and `GetSectorMvtTimeForGroup` per direction |
| `stratpath` | `from=<sector>`, `to=<sector>`, `mask=…`, `tactical=0\|1` | `BuildAStrategicPath`, `RebuildWayPointsForGroupPath` and `CalculateTravelTimeOfGroup` on a scratch group |
| `groups` | | The strategic movement state of a loaded save: groups, squads, vehicles, sectors, underground, arrival events, merc paths |
| `arsetup` | `sector=<A1..P16>`, `code=invasion\|encounter\|creature`, `militia=<g>,<r>,<e>`, `enemies=<admins>,<troops>,<elites>`, `creatures=<n>`, `persistent=0\|1` (default 1), `day=<n>`, `groups=<a>:<t>:<e>/…`, `tacticalmilitia=1` | Writes the sector's militia and garrison counts, `gubEnemyEncounterCode`, `gubPBSector`, `gfPersistantPBI` and optionally the world day (capture needs day 4); `groups` adds enemy groups with `CreateNewEnemyGroupDepartingFromSector` (ids in the output); `tacticalmilitia` needs the sector loaded and runs `ResetMilitia()` so the militia stand in tactical (the hand-off case) |
| `enemycounts` | `sector=<A1..P16>` | Garrison id and counts, `NumStationaryEnemiesInSector`, `NumMobileEnemiesInSector`, `GetNumberOfEnemiesInSector`, `NumEnemiesInSector` |
| `pbi` | `sector=<A1..P16>`, `group=player\|enemy\|creature`, `enemies=<a>,<t>,<e>`, `highpotential=1`, `cantretreat=1`, `mercslife=<n>` | Sets `gfHighPotentialForAmbush`, `gfCantRetreatInPBI` and optionally the life of our mercs in the sector, runs `WakeUpAllMercsInSectorUnderAttack` and the encounter-code block of `InitPreBattleInterface` (0005) for the save's player group there, a new enemy group (default 0,4,0) or a creature attack; dumps the code, the flags and the traced draws |
| `autoresolve` | `trace=1`, `retreat=<slice>:<soldier id>\|all,…`, `surrender=reject\|accept`, `bandage=0\|1`, `maxSlices=<n>` | Headless Finish-mode autoresolve (0002) on the save's mercs in the `arsetup` sector; dumps the cells after creation and after the ratings, the commands, the result (per cell, team state, clock warp, militia, promotions, sector counts, loyalty) and the traced draws |
| `strategic` | | Towns (rating, change, started, liberated, `GetTownSectorsUnderControl`), every town and SAM sector (militia, training paid/percent/hundredths, ever controlled, enemy controlled, `SectorOursAndPeaceful`, `MilitiaTrainingAllowedInSector`, `IsAreaFullOfMilitia`, SAM condition), the mines (every `MINE_STATUS_TYPE` field, `PredictDailyIncomeFromAMine`, `GetMaxDailyRemovalFromMine`), `fEnemyAirControlled` of the 256 sectors, balance, `PredictIncomeFromPlayerMines`, `CalcMaxPlayerIncomeFromMines`, progress, Enrico flags, the activity counters |
| `mercs` | `detail=strategic` | Per OUR merc: assignment, train stat, sleep/collapse/forced-awake/tired/nothing-to-do flags, breath, life, `sFractLife`, bleeding, last assignment change, need for sleep, and the estimates `CalculateHealingPointsForDoctor`, `CalculateRepairPointsForRepairman` (both with `fMakeSureKitIsInHand = FALSE`), `GetTownTrainPtsForCharacter`, and for the nine trainable stats `GetSoldierTrainingPts`, `GetSoldierStudentPts`, `GetBonusTrainingPtsDueToInstructor(s, NULL)` (points and max) |
| `loyalty` | `event=<GLOBAL_LOYALTY_ name without prefix>`, `sector=<A1..P16>`, `z=0` | `HandleGlobalLoyaltyEvent`, the town loyalties before and after |
| `assign` | `who=<id>`, `kind=<assignment number>`, `stat=<n>` | `RemoveCharacterFromSquads`, `SetTimeOfAssignmentChangeForMerc` (if the assignment changes), `ChangeSoldiersAssignment`, `bTrainStat`; no eligibility checks, no payment |
| `warp` | `seconds=<n>` | `WarpGameTime(n, WARPTIME_PROCESS_EVENTS_NORMALLY)`: every event of the span runs, hourly updates included |
| `newgame` | `difficulty=1\|2\|3`, `scifi=0\|1` | Sets the game options, runs `SetupNewStrategicGame(); InitNewCampaign();`, draws traced |
| `sai` | | Dumps the strategic AI: globals, compositions, garrisons, denials, patrols, the AI fields of all 256 sectors, enemy control, underground counts, every enemy group, the AI events (evaluation, checks, arrivals, meanwhiles), status, meanwhile flags, progress, mine income |
| `saievaluate` | `awake=0\|1` | `EvaluateQueenSituation()` (after `gfQueenAIAwake = TRUE` with `awake=1`), draws traced |
| `saicheck` | `sector=<A1..P16>` | `CheckEnemyControlledSector(sector)`, draws traced |
| `saiwake` | | `WakeUpQueen()` (mass fortification on the first call), draws traced |
| `saiarrive` | `count=<n>` | `n` times: the enemy group between sectors with the earliest arrival (first in the list on ties), `WarpGameTime` to its arrival without processing events, `GroupArrivedAtSector(group, TRUE, FALSE)`; draws traced, group ids listed |
| `diffmod` | `class=<soldier class>` | `CalcDifficultyModifier(class)` with its inputs: progress (highest and current), mine income, battle sector, town id, palace distance |
| `edgepoints` | `generate=0\|1` | The four primary and four secondary edgepoint lists with their middle indices (north, east, south, west), as `LoadWorld` left them or after `GenerateMapEdgepoints()` |
| `soldierexit` | `from=<g>` (or `who=<id>`), `dir=N\|E\|S\|W` or `grid=<exit grid gridno>`, soldier keys as `path` (`facing` for the direction, default team `player`) | `SoldierOKForSectorExit` (0004) and `GetAbsoluteScreenXYFromMapPos` of the soldier |
| `walkoff` | `from=<g>`, `dir=N\|E\|S\|W` | `PickGridNoNearestEdge` (0004) for a probe soldier |
| `walkin` | `from=<g>`, `code=N\|S\|E\|W` | `PickGridNoToWalkIn` (0004): gridno and attempts |
| `mirror` | `from=<g>`, `dir=N\|E\|S\|W` | The "mirror" gridno of `SetupTacticalTraversalInformation` and `CalcMapEdgepointClassInsertionCode(from)` with `gubTacticalDirection = dir` |
| `exitcheck` | `who=<id>`, `dir=N\|E\|S\|W` or `grid=<g>` | After a `save`: selects the soldier, makes his squad current, runs `OKForSectorExit`: result, minutes (−1 when untouched), `gfInvalidTraversal`, `gfLoneEPCAttemptingTraversal`, `gubLoneMercAttemptingToAbandonEPCs`, and `SoldierOKForSectorExit` per merc in the sector |
| `move` | `who=<id>`, `to=<g>` | `EVENT_SetSoldierPositionNoCenter` on a soldier of the loaded save |
| `initlist` | | The soldier init list in list order, then `SortSoldierInitList()` (0004) and the sorted list: node id, team, class, priority existence, detailed, soldier id and class |
| `defence` | `admins=`, `troops=`, `elites=` | `AddSoldierInitListEnemyDefenceSoldiers`, draws traced (placements marked by 0004), the init list before and after |

`sector` is a bare map load: `LoadWorld` compiles movement costs and builds structures, rooms and buildings; there is no
strategic layer, no enemy or NPC placement, no `PrepareLoadedSector`, and doors keep their map state. `save` runs the full
`LoadSavedGame` (strategic state, the sector's temp files, soldiers, door states), so probes see the world as saved.

`cth` and `bestshot` draw no random numbers and create no soldiers (the chance-to-get-through calls create and remove a
fake bullet each); they change soldier fields while they run and restore them before the next command, so they mix
freely with other probes: `soldiers detail=1` before and after them prints identical soldiers.

### `save`

```json
{"probe":"save","name":"SaveGame07","sector":"D13","z":0,"worldLoaded":true,
 "tactical":{"flags":262276,"currentTeam":0,"inCombat":true,"attackBusy":0,"interruptOccurred":false},
 "preRandomIndex":178,"worldSeconds":180106,"soldiers":[{"id":0,"team":0,"profile":2,...},...]}
```

- `tactical`: `gTacticalStatus.uiFlags`, `ubCurrentTeam`, `uiFlags & INCOMBAT`, `ubAttackBusyCount`, `fInterruptOccurred`
  after the load.
- `preRandomIndex`: `guiPreRandomIndex`, the read position in the saved `PreRandom` table.
- `worldSeconds`: `GetWorldTotalSeconds()`.
- `soldiers`: the short form of `soldiers` without `detail`.

### `soldier` and `soldiers detail=1`

`soldier who=<id>` emits one soldier; `soldiers detail=1` emits every in-sector soldier in one line
(`{"probe":"soldiers","line":N,"detail":true,"soldiers":[...]}`, same objects). Without `detail`, `soldiers` keeps the
short form of `save` and `sector` (`"detail":false`).

```json
{"probe":"soldier","line":3,"soldier":{"id":2,"name":"<nickname>","team":0,"side":0,"profile":<n>,"body":3,
 "soldierClass":0,"gridNo":12867,"level":0,"x":675,"y":805,"direction":2,"desiredDirection":2,
 "animState":27,"aniCode":15,"aniFrame":61,"stance":"crouch","terrain":1,"life":76,"lifeMax":76,
 "breath":66,"breathMax":75,"breathRed":804,"bleeding":0,"shock":0,"ap":12,"initialAp":21,"apPerTurn":16,
 "morale":100,"aiMorale":0,"alert":3,"orders":0,"attitude":0,"visible":1,"statusFlags":8,
 "collapsed":false,"breathCollapsed":false,"noAPToFinishMove":false,"lastTarget":12397,"tilesMoved":4,
 "serviceCount":0,
 "attack":{"weapon":22,"hand":5,"weaponMode":0,"doBurst":0,"aimTime":0,"shownAimTime":0,
  "aimShotLocation":0,"targetLevel":0,"targetCubeLevel":0,"dontChargeReadyAPs":false,"ctgtTarget":23},
 "stats":{"agility":70,"dexterity":80,"strength":60,"wisdom":75,"leadership":20,"marksmanship":65,
  "mechanical":10,"explosive":5,"medical":30,"expLevel":2},
 "effective":{"marksmanship":65,"dexterity":80,"agility":70,"wisdom":75,"expLevel":2},
 "skillTraits":[0,0],"personality":0,"oppList":[0,0,...,1,...,3,...],
 "inventory":[{"slot":0,"item":176,"count":1,"status":100},
  {"slot":5,"item":22,"count":1,"status":95,"gunAmmo":29,"ammoItem":94,"ammoType":2},...]}}
```

- Plain fields: `bSide` (`side`), `ubSoldierClass`, `dXPos`/`dYPos` (`x`/`y`), `bDesiredDirection`, `usAniCode`/`usAniFrame`,
  `bOverTerrainType` (`terrain`), `sBreathRed`, `bShock`, `bActionPoints` (`ap`, including the APs carried over into this
  turn), `bInitialActionPoints`, `bMorale`, `bAIMorale`, `bAlertStatus` (`alert`), `bOrders`, `bAttitude`, `bVisible`,
  `uiStatusFlags`, `bCollapsed`, `bBreathCollapsed`, `fNoAPToFinishMove`, `sLastTarget` (25601 is `NOWHERE`), `bTilesMoved`,
  `ubServiceCount`. `stance` is the end height of `usAnimState`, as everywhere.
- `attack`: the attack fields `cth` and `bestshot` read or change: `usAttackingWeapon`, `ubAttackingHand`, `bWeaponMode`,
  `bDoBurst`, `bAimTime`, `bShownAimTime`, `bAimShotLocation` (0 random, 1 head, 2 torso, 3 legs), `bTargetLevel`,
  `bTargetCubeLevel`, `fDontChargeReadyAPs`, `CTGTTarget` (soldier id or `null`).
- `stats`: the raw stats; `effective`: `EffectiveMarksmanship`, `EffectiveDexterity`, `EffectiveAgility`,
  `EffectiveWisdom`, `EffectiveExpLevel`; `apPerTurn`: `CalcActionPoints` (the APs of a new turn before carry-over, after
  breath, injury and weight penalties).
- `skillTraits`: `ubSkillTrait1`, `ubSkillTrait2`; `personality`: `gMercProfiles[profile].bPersonalityTrait`, 0 without a
  profile.
- `oppList`: all `MAX_NUM_SOLDIERS` entries of `bOppList` (1 is `SEEN_CURRENTLY`).
- `inventory`: the non-empty slots; `status` is `bStatus[0]`; guns add `ubGunShotsLeft` (`gunAmmo`), `usGunAmmoItem`
  (`ammoItem`), `ubGunAmmoType` (`ammoType`); `attachments` (item and status) appears when the object has any.

### `path`

`path from=<g> to=<g> [mode=walk|run|swat|crawl] [level=0] [toLevel=<level>] [stance=stand|crouch|prone]
[team=enemy|player|militia|civ|creature] [body=regmale|bigmale|stockymale|regfemale] [dir=0..7] [flags=<n>] [estimate=0|1]`,
or `who=<soldier id>` instead of `from`/`level`/`stance`/`team`/`body` to path an existing soldier of a loaded save.

Without `who`, a probe soldier is created with `TacticalCreateSoldier` (no profile, default team `enemy`, body `regmale`,
facing south), put into the sector, moved to `from` if the sweet-spot search placed it elsewhere, set to the stance
without transition animations, and removed afterwards. `team=player` matters: the original paths for the player with
perceived door states. `flags`: `PATH_THROUGH_PEOPLE` (1), `PATH_IGNORE_PERSON_AT_DEST` (2), `PATH_CLOSE_GOOD_ENOUGH` (4).
`estimate=1` sets `gfEstimatePath` (what `EstimatePlotPath` does for the AI).

```json
{"probe":"path","line":2,"from":11742,"to":11765,"toLevel":0,"mode":"walk","flags":0,"estimate":false,
 "soldier":{"id":20,"team":1,"profile":200,"body":0,"gridNo":11742,"level":0,"stance":"stand","animState":1,"terrain":1},
 "length":23,"directions":[2,2,...],"gridNos":[11743,11744,...],"apCost":46}
```

- `length`: the return value of `FindBestPath(s, to, toLevel, mode, NO_COPYROUTE, flags)`; 0 when no path exists
  (including an unreachable destination or a different level).
- `directions`: `guiPathingData[0..length)`, 0 = north … 7 = northwest.
- `gridNos`: the tiles visited, stepping `NewGridNo(g, DirectionInc(dir))` from `from`.
- `apCost`: `PlotPath(s, to, NO_COPYROUTE, NO_PLOT, mode, 0)`, the AP cost the UI shows, start-moving and stance costs
  included; 0 without a path.
- `soldier`: the soldier as placed (`team` and `body` are engine enum values, `terrain` is `bOverTerrainType`).

### `los`

`los from=<g> to=<g> [level=0] [toLevel=0] [stance=stand] [toStance=stand] [tileLimit=255] [aware=1] [soldiers=1]
[team=enemy] [toTeam=player] [body=…] [toBody=…] [dir=…] [toDir=…]`, or `viewer=<id>` / `target=<id>` to use soldiers of a
loaded save.

```json
{"probe":"los","line":2,"tileLimit":255,"aware":1,"from":11742,"level":0,"stance":"stand","to":11765,
 "toLevel":0,"toStance":"stand","fromZ":175,"toZ":175,"treeReduction":6,"lineOfSight":23,
 "viewer":{...},"target":{...},"soldierToSoldier":23}
```

- `lineOfSight`: the static `LineOfSightTest(from, fromZ, to, toZ, tileLimit, treeReduction, aware, 0, FALSE, NULL)`
  through an exported wrapper, with no soldier on the map. `fromZ`/`toZ` as `CalculateSoldierZPos(LOS_POS)` computes them
  for a regular body on dry land: 175/111/31 for stand/crouch/prone, +256 on a roof, + `sHeight * 256 / 50` of the tile.
  `treeReduction` is `gubTreeSightReduction` of the target stance (6/7/8).
- `soldierToSoldier`: `SoldierToSoldierLineOfSightTest(viewer, target, tileLimit, aware)` with real soldiers placed like
  the path probe soldier (viewer `enemy`, target `player`). It adds what the raw call leaves out: water stance overrides,
  camouflage, kid heights, tanks, the soldiers' own structures. `soldiers=0` skips it.
- Both are 0 when the target is not visible, otherwise the cover-adjusted distance.

### `costs`

```json
{"probe":"costs","sector":"A9","layout":"u8[gridNo][direction][level]","shape":[25600,8,2],
 "fnv1a32":"53026593","histogram":{"0":145,"9":13857,"10":71222,...},"base64":"..."}
```

`base64`: the raw 409,600 bytes of `gubWorldMovementCosts` in the engine layout, index
`(gridNo * 8 + direction) * 2 + level`, the layout of `MovementCosts.values` in `src/content/world/movement-costs.ts`.
`fnv1a32` (FNV-1a, 32-bit, over those bytes) and `histogram` (value → count) allow a quick comparison without decoding;
`format=none` prints only these two. Reading it from Node:

```ts
const line = JSON.parse(text.split('\n').find((l) => l.includes('"probe":"costs"')) ?? '{}');
const costs = new Uint8Array(Buffer.from(line.base64, 'base64'));
```

### `cth`

`cth shooter=<id> target=<id> [location=torso|head|legs] [aims=0,1,2,3,4]`, or `to=<g> [toLevel=0]` instead of `target` to
aim at a tile. Needs a loaded save; fails when the shooter has no gun in `HANDPOS`.

```json
{"probe":"cth","line":8,"shooter":2,"target":23,"targetGridNo":12397,"targetLevel":0,"location":"torso",
 "aimShotLocation":2,"weapon":22,"ap":12,"chanceToGetThrough":100,
 "results":[{"aim":0,"chance":54,"apCost":6,"cursorChance":54},{"aim":1,"chance":63,"apCost":7,"cursorChance":63},
  ...,{"aim":4,"chance":92,"apCost":10,"cursorChance":92}],"restored":["2.bAimTime","2.bAimShotLocation"]}
```

The shooter is prepared like ja2-node's attack estimate: `bAimShotLocation` = `location` when a soldier whose
`usAnimState` end height is not prone stands on the target tile (`WhoIsThere2(targetGridNo, targetLevel)`, or the
`target` soldier), otherwise `AIM_SHOT_RANDOM`; `bWeaponMode` = `WM_NORMAL`, `bDoBurst` = 0, `ubAttackingHand` =
`HANDPOS`, `usAttackingWeapon` = the item in hand, `bTargetLevel` = the target level, `bTargetCubeLevel` = 0, `bAimTime` =
the aim of each result. Then:

- `apCost`: `CalcTotalAPsToAttack(s, victim ? victim->sGridNo : targetGridNo, TRUE, aim)`.
- `chance`: `CalcChanceToHitGun(s, targetGridNo, aim, aimShotLocation, FALSE)`.
- `chanceToGetThrough`: `SoldierToSoldierBodyPartChanceToGetThrough(s, victim, aimShotLocation)` with a soldier on the
  tile, else `SoldierToLocationChanceToGetThrough(s, targetGridNo, targetLevel, 0, NULL)`.
- `cursorChance`: `chance` scaled by `chanceToGetThrough` as the `show_hit_chance` cursor does (`int` times
  `ctgt / 100.0f`, truncated).
- `ap`: the shooter's `bActionPoints`. Every requested aim is reported, affordable or not.
- `restored`: the `soldier.field` pairs that differed from the save after the probe and were put back: the setup above
  plus engine side effects such as `CTGTTarget` (set by every chance-to-get-through call) and `fDontChargeReadyAPs`
  (cleared by `MinAPsToShootOrStab` when it charges a raise).

Where the original UI differs from this setup:

- With the default `show_hit_chance: false` the cursor shows only the AP cost
  `CalcTotalAPsToAttack(s, target, TRUE, bShownAimTime / 2)`; with it on, `cursorChance` from the soldier's real fields.
- The aim location comes from the pixel under the mouse on the target's sprite (`DetermineCursorBodyLocation`: head,
  torso or legs, `AIM_SHOT_RANDOM` off the body); it is forced to random when the target's current height (`ubHeight`,
  not `ubEndHeight`) is prone or a non-player target has `bVisible == -1`; crows get legs; while `ubAttackBusyCount > 0`
  the previous value is kept.
- The UI keeps the soldier's own `bWeaponMode`/`bDoBurst`, `ubAttackingHand` and `bTargetCubeLevel`, and refreshes
  `usAttackingWeapon` only while `ubAttackBusyCount == 0`. The cursor sets `bTargetLevel` to the target's level; the real
  shot (`HandleItem`) overwrites it with `gsInterfaceLevel`, the level the player is viewing.
- The real shot uses `fModify = TRUE` (matters only with a barrel extender, which can fall off) and, with
  `AIM_SHOT_RANDOM`, first rolls the body part (`11`), so head and legs penalties can apply where `chance` shows none.
- The UI stops raising the aim once `EnoughPoints` fails; the cursor's "can't get through" check uses
  `SoldierToLocationChanceToGetThrough(s, target, gsInterfaceLevel, bTargetCubeLevel, 0)` before the click and the
  body-part version after it.

### `bestshot`

`bestshot who=<id> [keepAim=0|1]` runs `CalcBestShot(&s, &best)` (`TacticalAI/Attacks.cc`) on a soldier of the loaded
save, set up like the gun branch of `DecideActionBlack`: the first gun found by `FindAIUsableObjClass(s, IC_GUN)` is
swapped into `HANDPOS` (`RearrangePocket`), and `bAimShotLocation` = `AIM_SHOT_RANDOM` (`keepAim=1` keeps the saved
value). Fails when the soldier has no AI-usable gun.

```json
{"probe":"bestshot","line":16,"who":23,"weaponSlot":5,"weapon":7,"ap":14,"aimShotLocation":0,
 "soldierTargetLevel":0,"possible":true,"opponent":2,"target":12867,"targetLevel":0,"aimTime":4,
 "chanceToReallyHit":34,"apCost":12,"attackValue":1776,"restored":["23.usAttackingWeapon","23.CTGTTarget"]}
```

- `possible`, `opponent`, `target`, `targetLevel`, `aimTime`, `chanceToReallyHit`, `apCost`, `attackValue`: `ATTACKTYPE`
  `ubPossible`, `opponent` (id or `null`), `sTarget` (25601 `NOWHERE` when nothing is possible), `bTargetLevel`,
  `ubAimTime`, `ubChanceToReallyHit`, `ubAPCost`, `iAttackValue`.
- `weaponSlot`/`weapon`: the slot the gun came from and its item; `ap`: `bActionPoints`.
- `aimShotLocation`, `soldierTargetLevel`: the shooter's `bAimShotLocation` and `bTargetLevel` during the call.
  `CalcBestShot` never sets `bTargetLevel`, but `CalcChanceToHitGun` reads it (to find the target soldier and for the
  up/down penalties), so the value left over from the soldier's last attack matters. `bAimShotLocation` picks the end
  point of the body-part line of sight (random uses `TARGET_POS`).
- `restored`: as in `cth`. `CalcBestShot` itself sets `usAttackingWeapon` to the item in hand, clears
  `fDontChargeReadyAPs` (through `MinAPsToAttack`), sets the shooter's `CTGTTarget` to `NULL`
  (`AISoldierToSoldierChanceToGetThrough`) and each considered opponent's `CTGTTarget` to the shooter
  (`CalcManThreatValue`); `AICalcChanceToHitGun` and `AISoldierToSoldierChanceToGetThrough` fake
  `usAnimState = STANDING` and put it back themselves. In the game these changes persist; the probe undoes them and the
  pocket swap.
- Not reproduced from `DecideActionBlack`: `CanNPCAttack`, the `MinAPsToAttack(s, sLastTarget)` check before the call,
  and the rule that drops a shot of `OUR_TEAM` below 30% `chanceToReallyHit`.

### `light`

```json
{"probe":"light","line":3,"g":12400,"level":0,"ambient":12,"trueLevel":10,"viewer":2,"distanceVisible":15}
```

`ambient` = `LightGetAmbient()`; `trueLevel` = `LightTrueLevel(g, level)` (lower is brighter; includes map light
sprites); `distanceVisible` = `DistanceVisible(viewer, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, g, level)`.

### `lights`

```json
{"probe":"lights","line":3,"sector":"D13","level":0,"ambient":12,"layout":"u8[gridNo]","shape":[25600],
 "fnv1a32":"e48ec8ee","histogram":{"1":97,"2":64,...,"12":23213},
 "sprites":[{"x":59,"y":119,"flags":267,"template":"L-R08.LHT"},...],"base64":"..."}
```

`base64`: `LightTrueLevel(g, level)` for every `g` in grid order (25,600 bytes); `fnv1a32` and `histogram` over those bytes
as in `costs`. `sprites`: the active light sprites with `uiFlags` (ON 0x2, ERASE 0x8, PRIMETIME 0x80, NIGHTTIME 0x100) and
the template name.

### `sector … hour=` and `ambient`

A bare `sector` load uses the clock of a fresh process (00:00, `gubEnvLightValue` 0, so every tile is shade 1). `hour=<h>`
sets the clock to that hour first, which decides which night and prime-time map lights `LoadMapLights` powers. The
`sector` line reports the resulting `hour` and `ambient`, and `structureHeights`: the `[gridNo, index]` pairs of
structures whose height is already cached (`ubStructureHeight`), because only those obstacles can block light.
`ambient level=<n>` then renders the lights at a useful ambient level.

### `stratcosts`

```json
{"probe":"stratcosts","line":2,"mask":"FOOT","maskValue":1,"traversability":[[12,2,2,12,13],...],"minutes":[[-1,104,104,-1],...]}
```

Uses a local `GROUP` with `fPlayer = FALSE` and the given `ubTransportationMask` (no encumbrance). `traversability[id]` =
`SectorInfo[id].ubTraversability` (N, E, S, W, through); `minutes[id]` = the `INT32` result of
`GetSectorMvtTimeForGroup(id, dir, &g)` for N, E, S, W (−1 is `TRAVERSE_TIME_IMPOSSIBLE`). Without a save these are the
values `InitializeJA2` loads from `strategic-map-movement-costs.json`; after `save`, the saved ones (vanilla saves carry
vanilla's table, which differs from the JSON on the I2/I3 border).

### `stratpath`

```json
{"probe":"stratpath","line":7,"from":"A9","to":"P3","mask":"FOOT","tactical":false,"path":[27,45,...],"minutes":[89,...],
 "waypoints":[[9,6,0],...],"next":[9,2,0],"betweenSectors":true,"arrivalInMinutes":89,"traverseTime":89,"eta":1326}
```

The probe detaches `gpGroupList`, creates a player group at `from` with `CreateNewPlayerGroupDepartingFromSector` (no
members: no encumbrance, no `DelayEnemyGroupsIfPathsCross` side effects), sets the mask and runs
`BuildAStrategicPath(from, to, group, tactical)`. `path`: the strategic indices (`x + 18·y`); `minutes`: the
`GetSectorMvtTimeForGroup` of each edge. `RebuildWayPointsForGroupPath` then starts the group: `waypoints`, `next`,
`betweenSectors`, the arrival relative to now, `traverseTime`; `eta` is `CalculateTravelTimeOfGroup`. Afterwards the
group and its arrival and about-to-arrive events are removed and the list restored, so the probe leaves no trace. The
SHIFT ("shortest route") mode and the helicopter's airspace costs are not reachable from a probe.

### `groups`

Needs a loaded save. One line with: `groups` (every `GROUP` in list order with all fields, `atFinalDestination`, `eta` =
`CalculateTravelTimeOfGroup`, waypoints, and member soldier ids or the `ENEMYGROUP` counts), `squads` (soldier ids per
slot, −1 empty), `squadGroups`, `deadSquadMembers`, `vehicleGroups`, `vehicles`, `helicopterVehicleId`,
`helicopterAirborne`, `selectedSector`, `sectors` (per `SECTORINFO`: flags, garrison, pending reinforcements, troops,
elites, admins, creatures, the four in-battle counts, facilities, bloodcats, placements, travel rating, militia ×3, last
loaded, last liberated, ever player controlled, visible items), `elements` (`bNameId`, enemy controlled, enemy airspace,
SAM condition), `underground`, `events` (`GROUP_ARRIVAL` and `GROUP_ABOUT_TO_ARRIVE`: stamp, kind, param), `mercs` (player
team: group, sector, assignment, previous sector, insertion code, `pMercPath`), `secrets` and `worldMinutes`.

## Comparing with ja2-node

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
node tools/oracle/compare.ts ~/ja2-oracle/a9-costs.jsonl ~/ja2-oracle/a9-paths.jsonl ~/ja2-oracle/a9-los.jsonl
tools/oracle/compare-all.sh
```

`compare.ts` walks each output file in order with fresh comparers per file. A `sector` line loads that map (A9 when a
file has none); a `save` line imports the save into fresh ja2-node sessions (`14` §10; saves from `$JA2_SAVES_DIR` or
`SavedGames` next to the data folder); the comparer owning each following probe's command rebuilds it in that context.
Output: one line per probe plus a summary; exit status 1 on any mismatch or oracle error. Comparing needs the original
data and the saves, not the native build.

`compare-all.sh` runs `compare.ts` over the outputs listed in "Shipped probes" under `$JA2_ORACLE_DIR`; `attach` and
`florist` are optional, skipped with a hint when missing. It is the `oracle` gate of `pnpm gates` (skipped without the
work dir; needs `JA2_DATA_DIR`).

The domain sections from "Creatures" on list their commands (comments name the native code a command runs) and what the
output lines print. Unless a section says otherwise, the commands work on a loaded `save` and soldier ids (`who`, `merc`,
`src`, `dest`, `target`) are the save's; merchant and laptop commands also run on a fresh process, and `schedload` loads
its save itself. By default a comparer imports the save into a ja2-node campaign session, applies the same commands and
settings, replays the native draws (both streams) and the traced `CheckFact` results strictly ("Draw replay") and
compares the printed state field by field after every command.

### Draw replay

Most comparers replay the native random draws instead of seeding ja2-node:

- **Trace** (0002): a `draws` array of `[stream, range, value, ring index]` entries: `m` = `Random`, `p` = `PreRandom`
  (hence also `Chance`, `PreChance`), `d` = a weighted pick of `DistributeCreaturesByWeight` (0006: weight total and
  lower bound of the chosen bucket), `k` = a mark. Calls with range 0 draw nothing and are not traced.
- **Replay**: the comparer feeds the traced values into ja2-node's streams (`ReplayStream`,
  `src/sim/strategic/forces/autoresolve/replay-rng.ts`, or its own roll source), asserting each requested range.
  *Strict* = in order, none left over. A `d` entry replays as the `Random(100)` that falls into the same bucket (ja2-node
  draws one weighted `main(100)` per creature; `deviations.md`).
- **Marks** bound the draws a comparer keeps or drops:

| Mark | Patch | Around |
|---|---|---|
| 1–10 | 0002 (in `Oracle.cc`) | autoresolve phases: setup, ratings, battle, retreat, surrender, end, bandage, close, post, done |
| 101 / 102 | 0003 | the load-time recomputation of `LoadStrategicAI` |
| 301 / 302 | 0009 | every `FindBestPath`: its skip-list `Random(4)` draws, dropped (ja2-node draws none, "Pathfinder RNG") |
| 1000 + node id / 999 | 0004 | every `AddPlacementToWorld`: draws inside a placement are skipped and the native outcome answers it |
| 2001 / 2000 | 0016 | `PostSchedules` |
| 3001 / 3000 | 0021 | the music pick of `getMusicForMode`, dropped (ja2-node plays no music) |

- **Cosmetic draws** ja2-node does not make are dropped or skipped: the `InitFace` draws of faces opened by a hire or an
  action ("Cosmetic face and frame draws") and, in comparers that match `Random` in order rather than strictly, the
  native extras (curses, door creaks, explosion sounds, other systems' events during a warp).
- **`CheckFact`**: the narrative comparers replay the native `CheckFact` results in call order (traced by 0013 and 0015;
  a different call order is a mismatch) and write the values into ja2-node's fact store, as the native computed facts
  are.

The engine is seeded from the clock at start, so an unseeded script draws differently on every run and must match on
every run. Scripts seed (`seed value=<n> pre=reseed`) where a setup step's draws are not replayed (probe soldiers' random
stats) or a fixed scenario is wanted.

### Tactical map and combat

`compare.ts` itself compares:

- `costs`: the full movement cost table, byte by byte, and the FNV-1a hash;
- `path`: length, directions, `PlotPath` AP cost (probe soldiers after `sector`, the save's soldiers after `save`);
- `los`: `lineOfSight` and `soldierToSoldier`;
- `soldier`/`soldiers detail=1`: position, facing, animation, life, breath, AP, AP per turn, morale, alert, orders,
  visibility, last target, effective stats, personality, opplist, inventory;
- `cth`: chance, AP cost and chance to get through for every aim level, for shooters of any team;
- `bestshot`: possible, opponent, target, aim, chance to really hit, AP cost, attack value;
- `light`: ambient, true level, distance visible;
- `lights`: the true level of every tile (byte by byte and the hash), the ambient level and the light sprites (position,
  template, ON/PRIMETIME/NIGHTTIME; fake merc lights skipped). After a `sector` line with `hour`, the session reloads the
  map lights for that hour and takes the oracle's ambient level and structure-height cache; `ambient` lines set the level
  again.

### Lights

`map-light-probes.ts [hour...]` writes, for every original map with light sprites, a `sector … hour=<h>` load, a
hash-only `lights`, `ambient level=15` and a full `lights` dump; default hours 22, 3 and 12 (prime and night lights, night
lights only, always-on lights only). The sweep is not part of `compare-all.sh`.

```sh
node tools/oracle/map-light-probes.ts > ~/ja2-oracle/map-lights.txt
tools/oracle/run.sh ~/ja2-oracle/map-lights.txt ~/ja2-oracle/map-lights.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/map-lights.jsonl
```

### Savegames

`save-probes.ts <SaveGame name>...` writes a probe script for any saves: a soldier dump; `lights` for both levels; `cth`
(torso, head, legs) and `bestshot` for every armed soldier of the player, enemy and militia teams against every opposed
soldier; `los` for every opposed pair; `path` from each fighter to each opposed fighter and twelve tiles out in eight
directions; `light` with each fighter as viewer at every opposed soldier and four and eight tiles out in eight
directions; a second dump.

```sh
node tools/oracle/save-probes.ts SaveGame01 SaveGame02 SaveGame07 SaveGame08 SaveGame09 SaveGame10 \
  > ~/ja2-oracle/save-probes/all-saves.txt
tools/oracle/run.sh ~/ja2-oracle/save-probes/all-saves.txt ~/ja2-oracle/save-probes/all-saves.jsonl
```

### Sector transitions

`sector-compare.ts` keeps the loaded map's edgepoints (`loadMapEdgepoints`; `generateMapEdgepoints` after
`edgepoints generate=1`) and an init list built from the map (`buildSoldierInitList`), mutated like the native one by
`initlist` (the sort is not idempotent) and `defence`. Probe soldiers are rebuilt from the dumped soldier (gridno, level,
stance, team, body). `defence`, `creatureplacement` and `bloodcatplacement` replay only the placement decisions: draws
between the placement marks are skipped, the rest go through `addSoldierInitListEnemyDefenceSoldiers` of
`src/sim/strategic/ai/defence-placement.ts` (or the creature and bloodcat equivalents) with a roll source asserting each
range, each `AddPlacementToWorld` is answered with the native outcome, and the comparer checks the order of the offered
nodes, the final list (classes, soldiers) and the consumed draws. `exitcheck` and `move` run on a second session of the
save created with the data VFS as `FileExists`, so it has a `SectorFlow`; `okForSectorExit` gets the selected merc (whose
squad is current, as in the oracle).

- I14 regenerates edgepoints differently from its saved lists; ja2-node follows the generator.
- Probe soldiers made prone by the harness cannot path at all in the oracle (they become `SOLDIER_MULTITILE`; every
  `FindBestPath` returns 0, crawling included), so there are no prone walk-off probes.

### Strategic movement

`strategic-compare.ts` compares `stratcosts` (every traversability and edge time, on the shipped `strategic-*.json` after
`initStrategicLayerMap`, or on the imported save after `save`), `stratpath` (path, edge times, waypoints, next sector,
arrival, traverse time, ETA on the same scratch group) and `groups` (the `importStrategicMap` result of the save against
the whole dump; player group ETAs only when every member is in the loaded sector, because encumbrance comes from the
tactical soldier).

### Strategic AI

`sai-compare.ts` replays the traced draws of every operation (`newgame`, `saievaluate`, `saicheck`, `saiwake`,
`saiarrive`, and the load-time recomputation between marks 101/102) strictly, then compares the following `sai` dump
field by field. `newgame` runs `initializeMapStructure`, `setupNewStrategicMap` and `initNewCampaignMap` with the AI hook
on a fresh state. A `save` imports time, map and AI without the load hooks; they run at the next `sai` with the native
mine income from that dump (the economy is not imported here). `diffmod` recomputes `calcDifficultyModifier` from the
imported state and the dumped mine income.

### Economy

`economy-compare.ts` imports each save (`importStrategicTime`, `importStrategicMap`, `importEconomy`, the crew from the
saved soldiers with `readSoldierAssignments`) and compares the dumps field by field. `loyalty` replays the event on the
same state, `assign` applies the same changes, `warp` runs `warpGameTime` through ja2-node's event dispatch with the
economy handlers (other events do nothing; the flow is tactical, as in the oracle, which never compresses time).

- After a `warp`, stat gains depend on the RNG (`StatChange` draws `PreRandom`), so the stat-derived estimates of `mercs`
  are not compared; everything else must match.
- A longer warp that completes a training session diverges by a few hundredths: the trainers' leadership rises in the
  oracle.

### Autoresolve

`autoresolve` dumps the AR cells right after `CreateAutoResolveInterface` (soldiers with stats, inventory, profile
progress) and traces every draw, with marks between the phases. Three comparers run on each probe:

1. **Core replay** (`autoresolve-compare.ts`): rebuilds the AR state from the setup dump; replays the traced draws
   through ja2-node's `calculateAttackValues`, `runAutoresolve`, `endOfBattle`, `autoBandageMercs` and
   `closeAutoresolve` with streams that assert every requested range (cosmetic draws routed to `main` with
   `cosmeticOnMain`); applies the same retreat orders and surrender answer at the same slices; compares ratings, team
   sums, status, battle time, every cell (life, bleeding, flags, timers, pending bullets, inventory, militia kill points,
   merc profile counters and stat progress), the time warp, militia counts and promotions after closing, and that no
   draw is left over. Creature attacks (`arsetup code=creature creatures=<n>`) replay the `d` entries.
2. **Setup** (`autoresolve-creation.ts`), on a second session of the same save: applies the `arsetup`;
   `buildAutoresolveInput` creates the militia, enemy and creature soldiers with streams replaying the draws between the
   setup and ratings marks (the creature composition of `CalculateAutoResolveInfo` first); every created soldier is
   compared with the dumped cell (class, body, stats, life, morale, breath, traits, AP, inventory with status and ammo).
   No draw may be left over except the pathfinder's `Random(4)` and the preserved-soldier `PreRandom(2)` of the native
   world unload.
3. **Aftermath** (`autoresolve-aftermath.ts`), for every `autoresolve` after a `save`: imports the save into a campaign
   session and applies the `arsetup` (counts, enemy groups, day, `ResetMilitia`); compares the counts and town loyalty
   before the battle; hands the replayed battle to the battle flow (`adoptAutoresolve`); sends the `bandage` and `done`
   answers through `dispatch` with the traced close draws; compares world seconds, enemy counts (stationary, total, in
   sector), militia, `fEnemyControlled` and town loyalty after the close, plus the enemy group id of every cell from a
   fresh `associateEnemiesWithStrategicGroups`.

`pre-battle-compare.ts` compares `pbi` (encounter code, flags, draws); `autoresolve-aftermath.ts` also compares
`enemycounts`. `battle.txt` checks the autoresolve quirks of `19`: Q12 (the H1 garrison, id 25, counts both as stationary
and as mobile), Q14 (victories leave D13 enemy-controlled), Q16 (enemy groups whose ranks do not match the cell classes)
and Q22 (the town loyalty after closing a battle with militia loaded in tactical includes the `ABANDON_MILITIA` penalty of
`EndTacticalBattleForEnemy`).

The saves are on easy with 2–4 % progress, so the random-ambush branch (`PreRandom(100)` against the ambush chance) is not
reachable natively; only unit tests cover its arithmetic.

### Creatures

Each command prints its arguments, the creature and attack globals, the creature counts of every surface and underground
sector, and its draws:

```
options [scifi=0|1] [difficulty=1..3]
setcontrol sector=D13 enemy=0|1                    # fEnemyControlled
tacticalflags enemyinsector=0|1                    # gTacticalStatus.fEnemyInSector
setcreatures sector=D13 [z=1] count=<n>
creatures | creaturequest | creaturetrigger | creaturespread [count=<n>] | creatureplanning | endcreaturequest
creatureattack sector=D13 [specific=1]             # CreatureAttackTown, stopped before the battle opens (0006)
creaturecomposition count=<n>                      # DetermineCreatureTownComposition
creatureplacement [queen=1] [larvae=] [infants=] [ym=] [yf=] [am=] [af=]   # after `sector`: AddSoldierInitListCreatures
bloodcatplacement [cats=<n>] [placements=<n>]      # after `sector`: AddSoldierInitListBloodcats
```

`creature-compare.ts` imports the save (strategic map, economy, creature directives, meanwhile flag), replays each
operation through `src/sim/strategic/creatures/` (`d` entries as `Random(100)`) and compares the whole dump. The attack
globals are process state in the native build, so the comparer carries them across `save` lines. `sector-compare.ts`
compares `creatureplacement` and `bloodcatplacement` ("Sector transitions").

### Morale

Each command prints the decay counter, progress, `fEnemyInSector`, the world minutes and, per OUR merc, sector, group,
motion, assignment, sleep, life, effective leadership, morale, the four modifiers, opinions of the teammates, hated, buddy
and learn slots, personality and attitude:

```
morale
setmorale who=<id> [team=] [tactical=] [strategic=] [delayed=] [asleep=0|1]   # then RefreshSoldierMorale
setrelation who=<profile> about=<profile> [opinion=] [hated=<slot>:<time>:<count>] [learnhate=<time>:<count>] [learnlike=<time>:<count>]
setprofile who=<profile> [personality=] [attitude=]
moralemove who=<id> to=<gridno>
moralecounter value=<n>                            # the strategic decay counter (0006 moves it to file scope)
hourlymorale [count=<n>]                           # UpdateBuddyAndHatedCounters + HourlyMoraleUpdate
quartermorale [count=<n>]                          # DecayTacticalMoraleModifiers
```

`morale-compare.ts` applies the same changes and runs ja2-node's morale updates (`src/sim/campaign/team-morale.ts`).

### Merchants

Dealer ids 0–18 as in `dealers.json`; every dump also prints the world day and minutes, the highest progress, gun nut and
`FACT_ESTONI_REFUELLING_POSSIBLE`:

```
dealers                                     # status and every non-empty item header with its special elements
dealerinit                                  # InitAllArmsDealers, draws traced
dealerdaily [count=<n>]                     # n × (WarpGameTime 1 day without events, DailyUpdateOfArmsDealersInventory)
progress highest=<n>                        # gStrategicStatus.ubHighestProgress
fact id=<n> value=0|1                       # SetFactTrue/False, draws traced (the Estoni gas intercept)
options gunnut=0|1                          # also scifi=, difficulty= (shared with the creature probes)
dealerprice dealer= item= [status= count= ammo=<item>:<n> attach=<item>:<s>,… imprint=] [merc=<profile>]
dealersell dealer= item= [status= count= statuses=a,b,… ammo= attach= imprint=]   # AddObjectToArmsDealerInventory
shophours [open=<min> close=<min>]          # override GetArmsDealerShopHours (0008; no arguments: off)
dealerrepair dealer= item= [status= attach=] [start=<min>] [ks=k1,k2,…]   # cost, time, overnight delay, closed minutes
skiptime seconds=<n>                        # WarpGameTime without events
dealergive dealer= item= [status= attach= imprint=] [owner=<profile>]   # GiveObjectToArmsDealerForRepair now
ski dealer= [merc=<profile>]                # repair delay + InitializeShopKeeper headless: boxes, prices, collected repairs
```

`merchant-compare.ts` keeps its own merchant state: a `save` imports section 23 (with the save's facts, progress, gun nut
and clock); `dealerinit`, `dealerdaily`, `fact` and `ski` replay the native draws strictly (main and `PreRandom`
interleaved) and compare the dumps field by field; prices, repairs and sales compare directly.

### Contracts

Each command prints its arguments, draws, the contract state and the profiles of the team (or of `who=` and `range=`).
State: world minutes, balance, merc deaths, man-days, death rate, bad reputation, unhired deaths, M.E.R.C. account
status, renewal list and sequence flags, leave list, pending contract events and, per OUR merc, every contract field
with the expiry predicates, `FindRefusalReason`, `WillMercRenew`, the first buddy on the team, the death-rate,
reputation and morale checks and the equipment check:

```
contracts | profiles [who=<id>] [range=<from>:<to>]
dailyupdate [range=<from>:<to>]                    # MercDailyUpdate, then the profiles in the range
relationshours [count=<n>]                         # UpdateBuddyAndHatedCounters + HourlyMoraleUpdate
settime [day=<d>] hour=<h> [minute=<m>]            # warps the clock forward without events
aboutleave | beginrenewal | renewalstep            # the two-hour warning, BeginContractRenewalSequence, one sequence step
setcontract who=<id> [end=] [total=] [arrive=] [lastUpdate=] [canSign=] [signed=] [quoteCode=] [type=] [priceUp=]
            [life=] [bleeding=] [morale=] [kind=] [deposit=] [assignment=] [insurance=]
setstatus [deaths=] [manDays=] [reputation=] [account=] [balance=]   # balance through an anonymous deposit
setprofilecontract who=<profile> [status=] [available=] [hangover=] [balance=] [mercDays=] [deathRate=] [repTolerance=]
            [flags3=] [salary=] [gunAttractiveness=] [buddy=<slot>:<profile>] [hated=<slot>:<profile>:<time>:<count>]
            [learnhate=<profile>:<time>:<count>] [opinion=<about>:<value>]
extend who=<id> length=day|week|twoWeeks           # MercContractHandling
beginremove who=<id> [fired=1] | removemerc who=<id> [history=<code>]
leaveequip who=<id> where=here|drassen|omerta | equipleft slot=<n> where=drassen|omerta
mercsite | levelup who=<id> | salary values=<a,b,…> max=<n> | setrenewals profiles=<a,b,…>
```

`contract-compare.ts` replays the traced draws through `ContractFlow.useRandom`.

### Creature AI

The soldier commands print the full soldier dump plus the AI state: side, smells, mobility, caller, call priority,
frenzy, hunting, old life, regeneration, action fields, noise, patrol grid, aim, walk-to-attack cache, hand items,
inventory flags, and `bAwareOfOpposition` of the team:

```
addsoldier [team=creature] body=af|am|yf|ym|larva|infant|queen|bloodcat|regmale|… at=<grid> [dir=] [level=] [settings]
setsoldier who=<id> [settings]
seen who=<id> opp=<id> [value=1] [grid=<opp grid>] [public=1]   # personal or public opplist entry
decide who=<id> [status=0]          # DecideAlertStatus (unless status=0), then CreatureDecideAction/CrowDecideAction/DecideAction
beststab who=<id> [tentacles=1]     # CalcBestStab(blade) or CalcTentacleAttack, attack state restored
stab who=<id> target=<id> [aim=] [hitBy=]   # CalcChanceToStab and HTHImpact with the hand item
creaturecall who=<id> call=1..4     # CreatureCall; dumps every team member's caller fields
smell g=<grid> [smell=] [blood=]    # sets ubSmellInfo/ubBloodInfo
dropsmell who=<id>
trackscent who=<id> [actionData=]
```

Settings: `alert`, `orders`, `attitude`, `ap`, `initialAp`, `life`, `oldLife`, `breath`, `hunting`, `frenzied`,
`underFire`, `opps`, `lastAction`, `actionData`, `monsterSmell`, `lastTarget`, `noise=<grid>:<volume>[:<level>]`,
`caller=<id>:<grid>:<priority>`, `aware=0|1`, `face=<dir>`. `addsoldier` uses `TacticalCreateSoldier` with random stats
and `AddSoldierToSectorNoCalculateDirection`, so seed the engine first. `decide` sets `gfTurnBasedAI` from `INCOMBAT` and
traces the draws; the pathfinder's draws between marks 301/302 are dropped.

`creature-ai-compare.ts` imports the save into a tactical session, builds each added soldier from the dump (stats,
inventory with status and flags, life, breath, AP, alert, orders, smells) at the dumped id and grid, and copies the dumped
state after every `setsoldier`/`seen`. `decide`, `beststab`, `stab`, `creaturecall` and `trackscent` replay the native
draws into `rng`/`pre` strictly and compare the result: action, action data, next action, alert, mobility, caller fields,
frenzy, old life, aim, movement mode, final destination, walk-to-attack cache, facing, AP, hand items, inventory flags.

### Laptop

Each command prints its arguments, draws, a result, the laptop state, every OUR merc's contract fields and inventory,
and the selected profiles. Laptop state: new-game flag, bookmarks, balance, I.M.P. flags, personnel lists, M.E.R.C.
fields, Bobby Ray's flags, new and used lists (item, on hand, on order, quality, eligibility), shipments, insurance
payouts, mails, landing zone, hired flag, pending laptop events, world minutes. Profiles: status, availability, salaries,
deposit, kit cost, `CalcCompetence`, attractiveness, flags, hangover, precedent quotes, M.E.R.C. days, sector, traits,
stats, inventory, taken I.M.P. slot.

```
newgamefull [difficulty=1..3] [gunnut=0|1] [scifi=0|1]   # after `seed`: profiles reset, mails and laptop init, the traced
                                                          # InitNewGame; all 200 profiles and the terrorists' sectors
arrival                                                   # GetMercArrivalTimeOfDay at day 2 hh:30 for every hour
laptop [range=<from>:<to>] [who=<a,b,…>]
setbalance amount=<n> | setfact id=<fact> value=<n>       # balance through an anonymous deposit
aimhire profile=<id> [contract=1|7|14] [gear=0|1]         # CanMercBeHired headless (the quote) + AimMemberHireMerc
mercaccount | merchire profile=<id> | mercpay [index=<listing>] [who=<a,b,…>]
bobbyrestock | bobbyfresh param=<item or item+1000>        # the 09:00 update; AddFreshBobbyRayInventory
bobbyorder lines=<item>:<count>[:used],… dest=<id> [speed=0|1|2]
bobbydeliver index=<shipment>                             # BobbyRayPurchaseEventCallback; facts and items at the gridnos
insure who=<id> [buy=0|1] | insuranceday | payout who=<id> [suspicious=<n>]
insurancestep slot=<n> step=start|end|pay
impcreate gender=male|female answers=<16 indices> attrs=<10 values> [portrait=] [voice=] [name=] [nick=]
flowers flower=<0-9> dest=<id> [nextday=0|1] [extras=crushed,blackRoses,wilted,fruitCake]
                                                          # entering the order form, its price, sending (0025)
```

`laptop-compare.ts` builds the new game through `buildNewCampaign` with the traced draws in the state's streams (the
`InitFace` triples of the preloaded NPC faces dropped), or opens a campaign session of the save and applies the same
command through the laptop modules with `LaptopFlow.useRandom` (hire probes drop the face and first-frame draws). It
compares the whole dump; `newgamefull` and the save probes also compare every profile's sector (`InitNPCs`, the
terrorists). The Bobby Ray theft counter is a function static in the original, so the comparer carries it across the
saves of one file. `flowers` replays `visitSite floristOrderForm` and `orderFlowers` with the traced draws and compares
the order number (before, after entering, after sending), the price and the laptop dump.

### Doors

Each command prints its arguments; the door commands also print the door entry and the soldier before and after (AP,
life, breath, bleeding, skill-check memory, inventory, key ring, profile gains and stats), the attack busy count and the
draws:

```
locks                                                 # the 64 entries of LockTable
door who=<id> g=<door> action=open|examine|pickLock|force|lock|unlock|explode|untrap|crowbar
     [locked=] [trap=] [level=] [lock=] [damage=] [perceivedLocked=] [perceivedTrapped=] [remove=1] [close=1]
     [give1..3=<slot>:<item>:<status>:<count>[:<keyId>]] [clear=<slot>:...] [ring=<keyId>:<count>]
     [ap=] [life=] [breath=] [bleeding=] [shock=] [explosives=] [mechanical=] [strength=] [dexterity=] [wisdom=]
     [expLevel=] [incombat=1]                         # HandleOpenableStruct with ubDoorHandleCode set
doormenu who=<id> g=<door> [same settings]            # DoTrapCheckOnStartingMenu (0011)
civgroups [set=<group>:<hostility>,...] [neutral=<id>:<0|1>,...] [group=<id>:<civ group>,...]
makecivhostile who=<id> | pcattack who=<id> target=<id> | hostilelist   # with fCivGroupHostile, the civilians, militia and
                                                      # mercs (team, side, neutral, group, opponents, profile), the
                                                      # hostile-quote list (0011) and the pending civ-group events
```

`doors-compare.ts` replays the `PreRandom` draws strictly and matches `Random` draws in order, native cosmetic extras
skipped. Not compared: the AP of a menu action stopped by the trap check (the native cost reads past `doorAPs`, "Trap
check cost of menu actions").

### Attachment AP

One command drives the original item description box:

```
attachbox who=<id> [slot=5] [host=<item>:<status>] [hostAttach=<item>:<status>,...] [cursor=<item>:<status>]
          [cursorWho=<id>] [ap=] [cursorAp=] [incombat=1] steps=<step>,...
```

It writes the host object into the slot, puts the cursor item into `gItemPointer` for `cursorWho` (default `who`), sets
`FACT_ATTACHED_ITEM_BEFORE` (no help balloon) and opens the box with `InitItemDescriptionBox`. Each step either clicks
attachment slot N (`clickN`: the region's own callback, so `ItemDescAttachmentsCallbackPrimary` attaches with an item in
the cursor or detaches into the cursor without one) or puts a new item into the cursor (`<item>:<status>`);
`DeleteItemDescriptionBox` closes the box. Printed: the AP of both soldiers and the attachments before, after each step
and after closing, and the host object.

`attach-compare.ts` replays each line on a fresh campaign session of the save with the commands a player sends (`attach`
from a pocket holding the cursor item, `detach` into a pocket) and checks the attachments, the host, the native box rule
(one `AP_RELOAD_GUN` for `gpAttachSoldier` when the box closes in combat with changed attachments) and ja2-node's rule (one
`AP_RELOAD_GUN` per accepted command that changes them, "Attachment AP" in `deviations.md`); a line with a single changing
command must give the same AP on both sides.

### Facts and NPC presence

Each command prints its arguments, draws, a result, the narrative state (500 facts, 30 quests, boxing globals,
terrorist count, balance, world minutes and sector) and the presence fields of the selected profiles (`ids=a,b,…`,
default every NPC, RPC and vehicle): sector with z, the three misc flag bytes, `bNPCData`/`bNPCData2`, money, balance,
life, status, town, last date spoken to, profile insertion, quote record and action, inventory:

```
narrative [ids=…]                                   # dump only
setquest id= status=                                # write gubQuest
setnpcprofile id= [sector=] [z=] [nowhere=1] [npcdata=] [npcdata2=] [flags=] [flags2=] [flags3=] [money=] [balance=]
           [life=] [spokento=] [insertion=0|1] [code=] [data=]
checkfact profile= [id=] [src=<soldier>|-1] [dest=<soldier>|-1] [srcprofile=]   # the talk context, then CheckFact for
                                                    # one id or all 500 in order: the bytes before and each result
quest action=start|end|istart|iend id= [sector=]    # StartQuest, EndQuest, Internal…(FALSE): the new history lines
earlymorning                                        # HandleEarlyMorningEvents traced
hourlynpc hour=                                     # the clock set to that hour, HourlyQuestUpdate, Slay's check,
                                                    # PayOffSkyriderDebtIfAny traced (0012)
questentry sector= [z=] | questexit sector= [z=]    # HandleQuestCodeOnSectorEntry/Exit traced
entersector sector= [z=]                            # SetCurrentWorldSector: the profiled non-player soldiers (active)
```

`facts-compare.ts` applies each command through the narrative modules; `checkfact` compares the 500 results. Fact 284
(`FACT_PC_HAS_CONRADS_RECRUIT_OPINION`, computed through `CalcDesireToTalk`) is masked in every fact comparison of this
comparer (`UNKNOWN_INPUT_FACTS`). `entersector` compares the sorted profiles of the active soldiers, those away by
schedule included as in `FOR_EACH_SOLDIER` (`setCurrentWorldSector` bypassing the merc check, as the native call does).
The talk context outlives a save load in the original, so every `checkfact` sets it.

### Talk

`merc` is a soldier id of the save; its profile is the talker:

```
npcrecords [profile=<id>]                 # gpNPCQuoteInfoArray and the backups (19 numbers per record), the civilian arrays
npcprofile profile=<id>                   # the NPC fields of the profile (approach factors, values and mods, bits, dates, flags)
desire npc=<id> merc=<id> approach=<a>    # CalcDesireToTalk and CalcThreateningEffectiveness
consider npc= merc= approach= [record=]   # NPCConsiderTalking: opinion, record index (-1 none, -2 no array), the CheckFact
                                          # calls with their results, the profile before and after
talk npc= [merc=] approach= [record=] [panel=0]  # a headless panel (gfInTalkPanel, gTalkPanel.ubCharNum, gpSrcSoldier,
                                          # gpDestSoldier, gubSrcSoldierProfile) and ConverseFull without draining: the queued
                                          # events (quote, action, goto, trigger, close, give, merc), the CheckFact calls,
                                          # the draws, changed facts and quests, the SAID flags, ENGAGED_IN_CONV and the
                                          # reference count; the queue is emptied and the panel state reset afterwards
questdecode                               # &gubFact - &gubQuest and NPCConsiderQuote for quest values 100 and 200 with fact 70
```

Approaches: `friendly`, `direct`, `threaten`, `recruit`, `repeat`, `initial`, `whoareyou`, `trigger`, `buysell`,
`initiating`, `givingitem`, `declaration`, `enemy`, `notsafe`. `talk-compare.ts` imports the save with NPC records,
replays the native `CheckFact` results and the `Random` draws, runs `converseFull` on the same headless panel and compares
the queue, facts, quests, flags, the engaged state and the profile. `questdecode` gives an offset of −512 and 0 for every
quest-100/200 read.

### Give

```
receive npc=<profile> [merc=<soldier>] money=<n>|item=<name>:<status>:<count> [setup]
        # NPCConsiderReceivingItemFromMerc as a dry run (no soldier needed): record index, the record the result points
        # to, opinion, CheckFact calls, CalcMedicalCost results, queued triggers, draws, changed facts and quests, the
        # hospital globals, the NPC's cost to date and Frank's cash, the profile after
give who=<soldier> to=<soldier>|tonpc=<profile> slot=<n> [count=1] | money=<n> [cash=<pocket>:<amount>] [setup]
        # the object the UI hands over (one item of a stack or the whole pocket, put back first; money split off a
        # pocket that cash= may create), then SoldierGiveItemFromAnimation and the code-486 trigger; the conversation
        # it opens runs headless (a panel without UI); prints the hooks (conversation, shop, offer), the queue, facts,
        # draws, record flags, engaged flags, AP, both inventories, the giver's tile pool, the cursor, the target profile
npcgive npc=<profile> merc=<soldier> slot=<n>
        # HandleNPCItemGiven with the conversation soldiers set: the dropped copy or the pending give (data, temp object)
actionitem who=<soldier> action=<n> [det=<n>] [freq=<n>] [owner=<n>] [switch=1 at=<gridNo>]
        # arms an action item (or a pressure switch and a remote action item at at=) on the soldier's tile, then
        # SetOffBombsInGridNo and HandleExplosionQueue: queued count, DISALLOW_SIGHT before and after, civilian groups,
        # combat state, civilians' neutral and side, draws; the items are removed afterwards
```

`setup` is any of `fact=<id>:<v>,…`, `quest=<id>:<v>,…`, `balance=<n>` and `npcdata=<n>` (the NPC profile),
`hospital=<temp>:<refund>`, `said=<record>` and `mercsex=<n>`; each probe prints what it applied. `give-compare.ts` applies
the same setup, replays the native `CheckFact` results, `CalcMedicalCost` values (0017) and draws, and runs
`npcConsiderReceivingItemFromMerc`, `giveItemOpcode` with the narrative port pointed at the replay, `handleNpcItemGiven`
and the action item queue. For a give to a dealer whose shop opens, it first applies the original's `RemoveObjFrom` to
the giver's pocket ("Giving to a dealer" in `deviations.md`).

### Civilians

```
civset [who=<soldier> quote= delta= action= life= class= visible= quoteRecord= quoteAction= neutral= group= cower=0|1
       dir= grid= sees=<id,…> unseen=<id,…>] [rating=<town>:<value>] [combat=0|1] [fact=<id>:<v>,…] [quest=<id>:<v>,…]
       [listadd=<id,…>] [enemyFlags=<n>] [pause=0|1]
        # changes the soldier (bCurrentCivQuote, its delta, bAction, life, class, visibility, the quote record and action,
        # neutrality, civilian group, cowering, facing, position, personal opplist), a town's loyalty, INCOMBAT, facts and
        # quests, adds to the hostile-quote list, sets fEnemyFlags or the AI pause; prints the soldier
civquote who=<soldier>
        # StartCivQuote with the box suppressed: the line said ([soldier, quote type, entry, text length], none without
        # text), the soldier's quote fields before and after, CheckFact calls, draws, quests started and the record flags of
        # the 20 civilian hint files
namednpc who=<soldier>
        # DecideActionNamedNPC: the action, the soldier after, the queue, facts, draws, the trigger wait, the hostile-quote
        # list, the AI pause and the civilian state
initiating who=<soldier>          # NPCConsiderInitiatingConv: the tile, CheckFact calls
pcsnear npc=<profile>             # PCsNearNPC (FACT_PC_NEAR and the tile records), traced like namednpc
firstaid npc=<profile>            # PCDoesFirstAidOnNPC: refused, the profile (BANDAGED_TODAY), traced like namednpc
friendhostile npc=<profile>       # TriggerFriendWithHostileQuote, traced like namednpc
hostilecheck                      # CheckHostileOrSayQuoteList with the listed soldiers' visibility and public opplist
surrender who=<soldier>           # the surrender condition of DecideActionBlack: offered, fEnemyFlags, PCs, enemies, militia
surrenderanswer value=yes|no who=<soldier>
        # SurrenderMessageBoxCallBack for the civilian of the last civquote: our mercs (in sector, life, breath, assignment,
        # sector, insertion, neutral), quests, the capture flags and count, the offering soldier's action, draws
```

`civ-compare.ts` applies the same `civset` changes and runs ja2-node's `startCivQuote` (the hint checks with profile 200
replayed, the civilian entry fed from the traced `Random` into the cosmetic stream), `decideActionNamedNPC`,
`npcConsiderInitiatingConv`, `pcsNearNpc`, `pcDoesFirstAidOnNpc`, `triggerFriendWithHostileQuote`,
`checkHostileOrSayQuoteList`, `offersSurrender`, and the tactical surrender prompt of the battle flow answered through
`answer`. Draws after the native ones come from a fallback stream: the lost battle that follows in ja2-node runs later in
the original. The AI pause is compared only for `friendhostile` and `hostilecheck`; the native flag survives a `save`,
hence `civset pause=0` after each one. The sighting quotes for Mike and Joey (0022) reach the dialogue traces of all
comparers.

### Helicopter

None of the maintainer's saves owns the helicopter, so every scenario starts with `helisetup`
(`SetUpHelicopterForPlayer`). Every command prints helicopter globals; the vehicle (sector, ten passenger slots, path)
and its group (sector, next, prev, between, arrival and traverse times, waypoints, members); Skyrider's balance and life;
money; facts 43, 45, 136 and 277; sectors flagged `SF_SKYRIDER_NOTICED_ENEMIES_HERE`; the four SAM secrets; mercs
(assignment, vehicle id, sector, between, group, `bInSector`, insertion code and data, driver/passenger role, life);
squads; pending helicopter, hover and meanwhile events; quotes Skyrider said since the last command (0014); draws:

```
heli                                                  # dump only
heliset [money=] [owed=] [control=<sector>:<0|1>,...] [sam=<id>:<condition>:<enemy>,...] [enemies=<sector>:<troops>,...]
        [fact=<id>:<value>,...] [loyalty=<town>:<rating>,...] [talk=] [lastmono=] [congrats=] [emptyhelp=] [hits=]
        [progress=] [cost=] [airspace=1]              # airspace=1 runs UpdateAirspaceControl (and the refuel sites)
helisetup sector=B13                                  # SetUpHelicopterForPlayer
heliboard who=<id>                                    # IsThisVehicleAccessibleToSoldier, IsEnoughSpaceInVehicle, PutSoldierInVehicle
helileave who=<id> [squad=<n>]                        # the squad menu: PreChangeAssignment, AddCharacterToSquad, exit insertion
heliroute to=<sector>                                 # RequestGiveSkyriderNewDestination, cancel, PlotPathForHelicopter,
                                                      # TakeOffHelicopter, RebuildWayPointsForGroupPath, HandleNewDestConfirmation
helicancel                                            # CancelPathForVehicle while CanHelicopterFly
heliwarp minutes=<n>                                  # WarpGameTime with events processed normally
helimonologue                                         # CheckAndHandleSkyriderMonologues while the pilot is available
helipaydebt                                           # PayOffSkyriderDebtIfAny
helireturn                                            # MakeHeliReturnToBase
```

The probes set `fShowAircraftFlag`, as the map screen does when plotting for the helicopter. `heli-compare.ts` replays
`PreRandom` strictly (SAM fire, scouting) and matches `Random` in order with the native extras skipped (other systems'
events during the warps, the cosmetic "enemies spotted" quote pick). The "enemies spotted" quotes 34 and 35 are compared
as one. A merc's insertion code and data are compared only outside the loaded tactical sector: the original rewrites them
on every tile step (`SetSoldierGridNo`), ja2-node keeps them in the roster.

### NPC actions

`dest` defaults to the NPC's soldier; `panel=1` sets `gfInTalkPanel`. Each command prints queued dialogue events,
`CheckFact` calls, both random streams, fact and quest changes, new strategic events, history lines and mails, hospital
globals, the requestor box that opened (type, lie record), combat flags, the mercs and the NPC soldier (`soldiers=all`:
every soldier in sector), the profiles of the NPC and of `ids=`, the items at the primary delivery gridno and at gridnos 1
and 2, and the loaded world's money:

```
npcaction npc= code= [record=] [src=] [dest=] [panel=] [ids=] [soldiers=all]   # HandleNPCDoAction, the queue not drained
npcbox npc= code= answer=yes|no|lie [record=] [src=] [dest=] [ids=]             # DialogueMessageBoxCallBack for that box,
                                                                               # plus the amount StartDialogueMessageBox shows
npcevent param=                                                                # HandleNPCSystemEvent
kingpinmoney first=0|1                                                          # CheckForKingpinsMoneyMissing
hospitalsupplies                                                                # CheckForMissingHospitalSupplies and the count
medicalcost npc=                                                                # CalcMedicalCost and CalcPatientMedicalCost per merc
npcset [facts=id:v,...] [quests=id:v,...] [modifier=] [temp=] [refund=] [objects=]
       [who=<soldier> life= bleeding= patientmod= neutral=] [profile= balance= npcdata= npcdata2= salary= status= money= sector= z=]
```

`actions-compare.ts` sets the same headless talk context and runs the catalog (`handleNpcDoAction`), `answerNpcRequest`,
`npcSystemEvent`, `kingpinMoneyCheck` and `hospitalSuppliesCheck`; `npcset` writes both sides. The `InitFace` draws of a
panel opened by action 232 are dropped from the native trace.

### Schedules

Every command prints its arguments, draws, a result and the schedule state: world and last event query seconds;
`gubScheduleID`; the schedule list in list order (id, flags, the four times, data and actions, soldier); every active
civilian (gridno, level, `bInSector`, `SOLDIER_OFF_MAP`, `AI_ASLEEP`, `AI_CHECK_SCHEDULE`, `AI_LOCK_DOOR_INCLUDES_CLOSE`,
schedule id and progress, initial and off-world gridno, first patrol point, quote action, body, life); the door table
(gridno, locked, structure open); pending `EVENT_PROCESS_TACTICAL_SCHEDULE` events (stamp, schedule id):

```
schedules                                   # dump only
schedload name=SaveGameNN                   # LoadSavedGame traced (PostSchedules without auto-processing)
schedentry sector= [z=]                     # SetCurrentWorldSector traced (PostSchedules replays the last 24 hours)
schedclock seconds= [query=]                # set guiGameClock and guiTimeOfLastEventQuery
schedwarp minutes= screen=map|game          # WarpGameTime with events processed normally, guiCurrentScreen set
schedprocess id= screen=map|game            # ProcessTacticalSchedule
scheddecide soldier=                        # DecideActionSchedule (0016): action, usActionData, sAbsoluteFinalDestination
schedmove soldier= gridNo=                  # EVENT_SetSoldierPositionNoCenter, as if the civilian had walked there
schedshophours profile=                     # FindSoldierByProfileID + ExtractScheduleDoorLockAndUnlockInfo
```

`schedules-compare.ts` replays the draws between marks 2001/2000 (pathfinder draws left out): on `schedentry` through
`SectorFlow.postSchedulesOfLoadedSector`, on `schedload` after undoing the session's own post-load posting (saved
schedules, soldier schedule ids, the events added after the saved ones). Not compared: body and life (the civilians'
creation draws are not replayed) and a decision's data when it returns no action (stale fields). Sector entries come
right after a load: the 04:00 event moves NPCs with draws that warps do not replay, and the temp files of other sectors
are not imported from native saves.

### Recruiting

`src`/`dest` as for `npcaction`; `ids=` adds profiles to the dump:

```
addnpc profile= at=<grid> [dir=]       # a profiled civilian: TacticalCreateSoldier, AddSoldierToSectorNoCalculateDirection
recruitset [who= slot= item= [status=] [place=1]] [profile= town= attachment= salary= flags= flags3=] [facts=] [quests=] [squad=]
                                       # an inventory slot (place=1 through PlaceObject), profile fields, facts, quests and
                                       # iCurrentTacticalSquad on both sides
recruit npc= action=rpc|free|epc|unrecruit|settonpc|marry|enemy [record=] [soldiers=all]
                                       # HandleNPCDoAction for RECRUIT_WITH_SALARY, RECRUIT, UN_RECRUIT_EPC, SET_EPC_TO_NPC,
                                       # REMOVE_MERC_FOR_MARRIAGE, BECOME_ENEMY; epc answers the escort box with yes
unescort npc= map=0|1                  # UnEscortEPC in tactical or on the map screen (the removal deferred by 0018, then
                                       # run in order)
robotcontrol [update=1] [opp=<id>]     # ControllingRobot per merc, the robot's holder, CanRobotBeControlled, and with opp=
                                       # CalcInterruptDuelPts against that soldier
```

`recruit` and `unescort` print queued dialogue events, `CheckFact` calls, both streams, fact and quest changes, new
events and history lines, our team (id, profile, kind, assignment, sector, group, tile, stats, bleeding, breath, morale,
camouflage, visibility, body, contract end, remote holder, insertion code off the map, insertion direction, inventory),
squads, the current squad, civilians in the sector, profiles, the personnel "other" list, town loyalties and the NPC's
salary. `recruit-compare.ts` reserves the slots of the save's off-map civilians (away slots of the schedules), leaves
the face draws of a new merc and the pathfinder's draws out of the replay, and runs the catalog, the escort answer,
`RecruitFlow.internalUnescortEpc`/`removeEpc` or the wrong-sector trigger.

### Meanwhile

Every command prints its arguments, draws (both streams), a result and the meanwhile state: `uiMeanWhileFlags`; the 17
definitions and the current one (sector, trigger, id, NPC); `gfMeanwhileTryingToStart`; `gfInMeanwhile`; the last
scheduled id; pending `EVENT_MEANWHILE` events (stamp, param, offset); the first-battle flag and sector; the profiles of
the Queen, Elliot, Joe, Rat, Madlab, the robot and Iggy (sector, gridno, profile insertion, `bNPCData`); quests 11, 8, 9
and 15; `FACT_MIKE_AVAILABLE_TO_ARMY`; highest progress; the Queen's AI flag; strategic status flags and capture count;
pause state; world seconds:

```
meanwhiles                                          # dump only
meanwhilepost kind=town|townloss|sam|outskirts|creature|flowers|chopper|awol|interrogation [param=]
                                                    # the posting function (param: town, SAM site or flower code)
firstbattle sector= autoresolve=0|1                 # HandleFirstBattleEndingWhileInTown
trashworld                                          # HandleFirstMeanWhileSetUpWithTrashWorld
meanwhilerun enemy=0|1                              # the first EVENT_MEANWHILE executed with fEnemyInSector set;
                                                    # a scene that begins is skipped (BeginMeanwhileCallBack, No):
                                                    # the event, the enemy groups and the reinforcement pool
meanwhileplayed id=                                 # SetNPCMeanwhile for the scene's NPCs, then RestoreNPCMeanwhile
hourlyprogress current= [highest=]                  # HourlyProgressUpdate with CurrentPlayerProgressPercentage forced
capture who=<soldier ids> [alma=]                   # BeginCaptureSquence, EnemyCapturesPlayerSoldier each, End...:
                                                    # the captives and the new history lines
queendead                                           # STRATEGIC_AI_ACTION_QUEEN_DEAD and the evaluation events left
```

After a `sector O3`, `statue mode=remote|explosion [dist=] [gridno=]` runs `ChangeO3SectorStatue(FALSE)` or
`HandleStatueDamaged` and prints the struct indexes at 13830, the exit grid at 13669 and its revealed flag before and
after, and the skip flag.

In `meanwhile-compare.ts` the first `meanwhiles` after a load copies the pause state and the last scheduled id into the
session: native loads keep the saved pause (ja2-node save sessions resume unpaused), and the last scheduled id is a static
that survives loads. A `begun` scene is skipped the native way (trying flag cleared, implications, unlock, unpause). The
statue probes run on a fresh O3 world per `sector` line and compare the statue tiles only.

### Boxing

No save stands in San Mona, so every block starts with `boxingsquad`: the listed mercs and their groups move to D5 with
grid insertion (`SetGroupSectorValue`), the club is loaded with `SetCurrentWorldSector`, the game is unpaused and the
moved mercs get `CalcActionPoints` (ja2-node recomputes APs on insertion, the original keeps the old ones; the probe
normalises both). Soldier ids are those of the loaded club:

```
boxingsquad sector=D5 who=<ids> grids=<gridnos>   # the squad into the club; prints every soldier in sector
boxing                                           # dump only
boxingset [state=] [fought=a,b,c] [boxers=a,b,c] [rests=] [resting=] [won=] [last=]
          [who= life= breath= collapsed= turns= ap= boxer= slot= item=]
boxingfacts                                      # CheckFact 210, 230, 231, 368 in that order
boxingstart                                      # Darren's START_BOXING_MATCH
boxingstep who= to=                              # EVENT_SetSoldierPosition, then BoxingMovementCheck in states 1-3
boxingattack who= target= item=                  # ProcessImplicationsOfPCAttack with that usAttackingWeapon
boxingend loser=                                 # EndBoxingMatch
boxinggetup who=                                 # BeginSoldierGetup (the knock-out count)
boxingexit                                       # ExitBoxing
boxingrecord who=<id>|-1                         # TriggerEndOfBoxingRecord
boxingdecide who= [status=1]                     # DecideAction (DecideAlertStatus first): action, data, next action and
                                                 # data, final destination, orders, alert status
boxingpoints who= ap=                            # CalcActionPoints and CalcNewActionPoints
```

Each prints the boxing globals (state, recorded boxers, fought flags, wins, rests, resting, last won, paused, combat and
current team); the mercs, recorded boxers and flagged soldiers (gridno, neutral, life, breath, APs, alert, three stats,
first trait, collapse and its turn count, under fire, boxer and PC-under-AI flags); queued dialogue, `CheckFact` calls,
both streams and new history lines. `boxing-compare.ts` repeats the setup and runs the same functions, with the
pathfinder's draws and the music picks dropped from the replay. Accepted differences:

- A probe that ends combat also gets the forced real-time turn the original runs inside `ExitCombatMode` ("Real-time turn
  after combat" in `deviations.md`).
- The civilians' gridnos are compared only on the boxer tiles: their schedules place them with draws the setup does not
  replay.
- A decision's data is compared only when it decides an action.

## Shipped probes

Each script comments its scenarios block by block. Output paths are relative to the work dir, as `compare-all.sh` expects
them; produce one with `mkdir -p` on its directory and `tools/oracle/run.sh tools/oracle/probes/<script>
"$JA2_ORACLE_DIR/<output>"`. The saves are described in "Notes".

| Script | Output | Content |
|---|---|---|
| `a9-paths.txt` | `a9-paths.jsonl` | A9: the four movement modes, around and into buildings through doors (enemy and player), a fence walking and crawling, long paths (49–101 steps), a roof path, an unreachable destination |
| `a9-los.txt` | `a9-los.jsonl` | A9: sight limit, stance combinations, buildings, a fence, roof to ground and back, trees with stand/crouch/prone targets |
| `a9-costs.txt` | `a9-costs.jsonl` | The movement cost table of A9 |
| (`save-probes.ts`) | `save-probes/all-saves.jsonl` | The six saves ("Savegames") |
| `sectors.txt` | `sectors.jsonl` | Edgepoints of eight maps loaded and generated, exit thresholds on both sides of every edge, exit grids, walk-off/walk-in/mirror (class codes 7 and 8 on the isolated H13 and I14), init list sorts, defence placements (4 to 64 enemies on 32 to 64 placements), `OKForSectorExit` on SaveGame10, 07 (combat) and 01 |
| `strategic.txt` | `strategic.jsonl` | The travel table for the five transports; long, unreachable, tactical-traversal and trivial routes for every mask; `groups` of the six saves |
| `sai-newgame.txt` | `sai/newgame.jsonl` | Seven seeded new games (every difficulty, one sci-fi) with wakes, evaluations, checks and 40–60 group arrivals |
| `sai-saves.txt` | `sai/saves.jsonl` | The six saves: load draws, `diffmod` for three classes, evaluations, checks, 40 arrivals |
| `economy.txt` | `economy.jsonl` | The six saves: dumps, nine loyalty events, warps of 2, 3 and 8 hours (the last with two militia trainers and a self-trainer in B13) |
| `autoresolve-d13.txt` | `ar/d13.jsonl` | Eight battles on SaveGame10 in D13: both codes, 0–11 militia, 6–32 enemies, bandaging, retreat orders for all and for one merc, promotions |
| `autoresolve-capture.txt` | `ar/capture.jsonl` | Six battles on SaveGame10 at day 5–7 with 20–32 enemies: the surrender offer accepted or rejected |
| (generated) | `ar/stress.jsonl`, `ar/smoke.jsonl` | Work-dir scripts without a generator in the repo: 30 random battles over SaveGame01, 02, 07, 09 and 10 (militia, garrisons, codes, retreats, `pre=keep` and `pre=reseed`); the first battle of `autoresolve-d13.txt` |
| `battle.txt` | `battle/battle.jsonl` | Eight `pbi` probes (every encounter code, no retreat, a high ambush potential, unconscious mercs), `enemycounts` for H1, B13, C13 and D13, five battles for the quirks of "Autoresolve" |
| `creatures.txt` | `creatures/creatures.jsonl` | SaveGame09 and 10 over three difficulties: quest starts, triggers, spreads, night planning, town attacks with each battle code (lairs 1, 3 and 4: no save picks lair 2), the quest end, compositions |
| `creature-battles.txt` | `creatures/battles.jsonl` | Six creature autoresolve battles in D13 (0–12 militia, 3–20 creatures, bandaging, a full retreat) |
| `creature-placement.txt` | `creatures/placement.jsonl` | Creature placements in F13 b3 (with the queen), G13 b3, E13 b1, D13 b1, H8 b1; bloodcat placements in I16, E13, C8, D9 |
| `creature-ai.txt` | `creatures/creature-ai.jsonl` | SaveGame07 (combat) and 10 (real time): all eight bodies from GREEN to BLACK, calls and hurt calls, spit and claws, multi-tile paths around walls, melee, smell and scent |
| `morale.txt` | `morale/morale.jsonl` | SaveGame10, 07 and 01: hated relations within and past their tolerance, learning to like and to hate, sleep, the third-hour strategic decay, a nervous merc away from his squad |
| `merchants.txt` | `merchants/merchants.jsonl` | Initialisation at progress 0–100 and with gun nut, restocks, the Estoni gas, every shop entry (a delay excuse taken and one refused), prices and sales at seven dealers, repair estimates and queues, every save's dealer section |
| `contracts.txt` | `contracts/contracts.jsonl` | Five saves: the daily update, warnings, the renewal sequence, extensions and refusals, buddies, dismissal, departures with the equipment, RPC pay, M.E.R.C. days, POW and dead mercs, salary rounding |
| `laptop.txt` | `laptop/laptop.jsonl` | Three seeded new games, the arrival table; on SaveGame01, 07 and 10: A.I.M. and M.E.R.C. hires, Bobby Ray orders and deliveries (loaded and unloaded Drassen, Meduna), a restock, insurance, two I.M.P. characters |
| `florist.txt` | `florist/florist.jsonl` (optional) | Flower orders on SaveGame01 and 07, outside Meduna (no meanwhile) |
| `doors.txt` | `doors/doors.jsonl` | SaveGame09: every door action with locks, traps, keys and charges; civilian groups |
| `attach.txt` | `attach/attach.jsonl` (optional) | SaveGame09: attach and detach in and out of combat, several changes in one opening, another merc's cursor, too few AP, a merge, a swapped scope |
| `facts.txt` | `facts/facts.jsonl` | The six saves: `CheckFact` sweeps, quests, the 04:00 events, hourly quest facts, Skyrider's debt, sector entry and exit, NPC placement on sector loads |
| `talk.txt` | `talk/talk.jsonl` | SaveGame02, 01, 07 and 10 with the NPCs present: records, desires, considerations, conversation steps |
| `give.txt` | `give/give.jsonl` | SaveGame02, 01, 07 and 10: gives to NPCs, dealers and squad mates, NPC gifts, the NPCs' money and item rules, quest action items |
| `civ.txt` | `civ/civ.jsonl` | The six saves: civilian quote kinds, named-NPC decisions, triggers, the hostile-quote list, the surrender offer and answers |
| `heli.txt` | `heli/heli.jsonl` | SaveGame01, 02 and 10: boarding, flights and SAM hits, billing and debt, refuel landing, hovering, rerouting, refusals, monologues |
| `actions.txt` | `actions/actions.jsonl` | SaveGame01, 10 and 02: Pablo, Kingpin, medical costs, the hospital, every requestor answer, generic actions and the NPC chains |
| `schedules.txt` | `schedules/schedules.jsonl` | The six saves: loads, entries into C13, D13 and B13, map-screen and tactical warps, AI schedule steps |
| `recruit.txt` | `recruit/recruit.jsonl` | SaveGame01, 02 and 10: E.P.C.s, Skyrider, Dynamo, Slay, R.P.C.s, the robot, Maria, Joey, marriages, rebels |
| `meanwhile.txt` | `meanwhile/meanwhile.jsonl` | The six saves and O3: every posting, the implications, NPC moves, first battles, milestones, captures, the Queen's death, the statue |
| `boxing.txt` | `boxing/boxing.jsonl` | SaveGame01 and 02: matches for either team, fair and foul blows, knock-outs, the exit, end records |

## Hooks

`patches/*.patch` apply in file-name order; each starts with header lines describing it. Paths are under `src/` of the
Stracciatella copy. "Moves into" means the same code at the same call site; switches and wrappers do nothing in the game
unless the oracle sets them.

| Patch | Files | Adds |
|---|---|---|
| 0001 | `sgp/SGP.cc`, `game/Tactical/LOS.cc`, `game/CMakeLists.txt` | With `JA2_ORACLE` set, `Oracle_PrepareProcess()` before logging starts (the real stdout kept for JSONL, everything else to stderr) and `Oracle_Run()` after `InitializeGame()` instead of the main loop; `OracleLineOfSightTest` (wraps the static `LineOfSightTest`), `OracleTreeSightReduction`; `Oracle.cc` in the build |
| 0002 | `sgp/Random.{h,cc}`, `game/Strategic/Auto_Resolve.{h,cc}` | `OracleSeedRandom(seed, reseedPre)`, the draw trace (`OracleTraceRandom`, `OracleTraceMark`). Headless Finish-mode autoresolve: the end-of-battle block of `RenderAutoResolve` moves into `HandleAutoResolveBattleEnd`; `ProcessBattleFrame` checks a slice budget (`gOracleARSliceBudget`, −1 in the game) at the top of each 1000 ms slice and remembers whether a frame stopped inside one; `OracleAutoResolve*` run `EnterAutoResolveMode` and the entering block of `AutoResolveScreenHandle` without the screen switch and zoom, switch to Finish (`uiTimeSlice = 0xffffffff`, `fSound = FALSE`), run frames up to a slice count, apply retreat orders (the bodies of `RetreatButtonCallback`, `MercCellMouseClickCallback`) and the surrender answer, run the end block, `AutoBandageMercs`, `RemoveAutoResolveInterface`, and expose the AR state. The harness sets `guiCurrentScreen = AUTORESOLVE_SCREEN` around it so soldier creation takes the AR path; the battle sector's world unloads as in the game |
| 0003 | `game/Strategic/Strategic_AI.cc` | Marks 101/102 around the load-time recomputation at the end of `LoadStrategicAI` (`UpdateAirspaceControl`, `EvolveQueenPriorityPhase(TRUE)`, the repoll of idle enemy groups) |
| 0004 | `game/Strategic/StrategicMap.cc`, `game/Tactical/Soldier_Init_List.cc` | `OraclePickGridNoNearestEdge`, `OraclePickGridNoToWalkIn`, `OracleSoldierOKForSectorExit`, `OracleSortSoldierInitList` (wrap the statics); a scope guard in `AddPlacementToWorld`: mark 1000 + node id on entry, 999 on every return |
| 0005 | `game/Strategic/PreBattle_Interface.cc` | The encounter-code block of `InitPreBattleInterface` moves into `DeterminePersistentEncounterCode`; `OracleDeterminePersistentEncounterCode(group, sector)` runs `WakeUpAllMercsInSectorUnderAttack` and that block |
| 0006 | `sgp/Random.{h,cc}`, `game/Strategic/Creature_Spreading.cc`, `game/Tactical/Morale.cc` | `OracleTraceWeighted` (a `d` entry per pick of `DistributeCreaturesByWeight`); `gOracleSkipCreatureBattle` stops `CreatureAttackTown` before the battle switch; the function-static decay counter of `HourlyMoraleUpdate` becomes the file-scope `gOracleStrategicMoraleUpdateCounter` |
| 0007 | `game/Strategic/Merc_Contract.cc`, `Assignments.cc`, `Map_Screen_Interface.cc`, `game/Tactical/Campaign.cc` | Appended only: wrappers for `FindRefusalReason`, `ContractIsExpiring`, `ContractIsGoingToExpireSoon`; accessors, a setter and a reset for the renewal list and sequence; `OracleBeginRemoveMercFromContract`; readers of the leave list and its owners; `OracleCalcNewSalary` |
| 0008 | `game/Tactical/Arms_Dealer_Init.cc`, `ShopKeeper_Interface.{h,cc}` | A shop-hours override (`gOracleShopHoursActive`, `gOracleShopOpeningTime`, `gOracleShopClosingTime`) that `GetArmsDealerShopHours` returns without looking for the dealer's soldier and schedule; `OracleCalcShopKeeperItemPrice`, `OracleItemConditionModifier`, `OracleEvaluateInvSlot`, `OracleHandlePossibleRepairDelays`, `OracleInitializeShopKeeper` select the dealer and a probe SM-panel merc with the given profile, run the static helper and restore the globals (the last runs the inventory part of `InitializeShopKeeper` without buttons and returns the boxes and the player's offer area) |
| 0009 | `game/Tactical/PathAI.cc` | A scope guard in `FindBestPath`: mark 301 on entry, 302 on every return |
| 0010 | `game/Laptop/AIMMembers.cc`, `BobbyRGuns.cc`, `BobbyRMailOrder.cc`, `IMP_Confirm.cc`, `IMP_Personality_Quiz.cc`, `Insurance_Contract.cc`, `Mercs_Account.cc`, `Mercs_Files.cc`, `game/Tactical/Soldier_Profile.cc` | `gOracleAimHeadless`: `CanMercBeHired` records the quote instead of starting the video face and `AimMemberHireMerc` hires a given profile; the charge computation of `DisplayMercChargeAmount` moves into `CalcMercContractAmount`, the body of `BtnIMPConfirmYes` into `IMPConfirmYes`; wrappers for `CalcCompetence`, `MercFilesHireMerc`, `SettleMercAccounts` (with the total charge), `CalculateTotalPurchasePrice`, `PurchaseBobbyOrder`, `CalculateSoldiersInsuranceContractLength`, `CompileQuestionsInStatsAndWhatNot` |
| 0011 | `game/Tactical/Handle_Doors.cc`, `OppList.cc` | `OracleDoTrapCheckOnStartingMenu` (wraps the static `DoTrapCheckOnStartingMenu`); `OracleHostileQuoteList` (copies the ids of the static hostile-quote list) |
| 0012 | `game/Strategic/Hourly_Update.cc`, `StrategicMap.cc` | `OracleHourlyQuestUpdate`, `OracleHourlyCheckIfSlayAloneSoHeCanLeave`, `OracleHandleQuestCodeOnSectorExit` (wrap the statics) |
| 0013 | `game/TacticalAI/NPC.cc` | `CheckFact` redirected to `OracleTracedCheckFact`; macros make `TalkingMenuDialogue`, `NPCDoAction`, `NPCGotoGridNo`, `TacticalCharacterDialogue` (and, after their definitions, `NPCClosePanel`, `TalkingMenuGiveItem`, `NPCTriggerNPC`) call `OracleDialogueTrace` first; both trace functions live in `Oracle.cc` and record top-level calls only while a probe traces. Wrappers `OracleNPCConsiderTalking`, `OracleCalcThreateningEffectiveness`, `OracleNPCConsiderQuote`, accessors for the record arrays |
| 0014 | `game/Strategic/Map_Screen_Helicopter.cc`, `MapScreen.cc` | With `gOracleSkyriderSilent`, `SkyriderDialogue` appends the quote number to `gOracleSkyriderQuotes` instead of queueing it, `SkyriderDialogueWithSpecialEvent` runs the monologue event at once (the SAM reveals, the monologue timestamp), `RequestGiveSkyriderNewDestination` skips its message box and cursor change; wrappers `OracleMakeHeliReturnToBase`, `OracleRequestGiveSkyriderNewDestination`, `OracleHandleNewDestConfirmation` (with `fPlotForHelicopter` set) |
| 0015 | `game/Tactical/Interface_Dialogue.cc`, `game/Strategic/Strategic_Event_Handler.cc` | `CheckFact`, `TalkingMenuDialogue`, `NPCDoAction` and `NPCGotoGridNo` traced as in 0013 around `HandleNPCDoAction`, `StartDialogueMessageBox` and `DialogueMessageBoxCallBack`, and the event handler's `CheckFact` calls; with `gOracleSkipDialogueBoxes`, `StartDialogueMessageBox` records the box type and returns before `DoMessageBox`; `OracleDialogueMessageBoxType`, `OracleLiePromptRecord`, `OracleResetDialogueMessageBox`, `OracleAnswerDialogueMessageBox` (sets the type and the lie record, calls the static callback) |
| 0016 | `game/Strategic/Scheduling.cc`, `game/TacticalAI/DecideAction.cc` | Marks 2001/2000 around `PostSchedules`; `OracleDecideActionSchedule` wraps the static `DecideActionSchedule` |
| 0017 | `game/TacticalAI/NPC.cc`, `game/Tactical/Handle_Items.cc` | `CalcMedicalCost` redirected to `OracleTracedMedicalCost` (records each result while a probe traces); `OracleNPCConsiderReceivingItemFromMerc` also returns the record the result points to (the Vince and Steve quirk sets the record but leaves the index 0); in `SoldierGiveItemFromAnimation`, `InitiateConversationFull`, `EnterShopKeeperInterfaceScreen` and `AddItemToPlayersOfferAreaAfterShopKeeperOpen` go through `OracleGiveConversation`, `OracleGiveShop`, `OracleGiveOffer`, which call the real functions unless `give` runs: then they record the call and the conversation opens headless (the panel globals and `ConverseFull`, as `talk` does) |
| 0018 | `game/Strategic/Assignments.cc` | In `InternalUnescortEPC` the abandoning quote goes through `OracleTracedMercDialogue` (traced as `merc` only when `TacticalCharacterDialogue` queued it) and the remove-EPC event is traced as `removeepc`; while `gOracleDeferredEpcs` points to a vector, the profile goes there instead of queueing `DialogueEventRemoveEPC`, so `unescort` runs `UnRecruitEPC` itself after `UnEscortEPC` returns |
| 0019 | `game/Strategic/Meanwhile.cc` | Appended: `OracleLastScheduledMeanwhileId` (the static `ubCurrentMeanWhileId`), `OracleSkipMeanwhile` (the static `BeginMeanwhileCallBack` with `MSG_BOX_RETURN_NO`), `OracleSetNpcMeanwhile`, `OracleRestoreNpcMeanwhile` (the NPC moves of a played scene), `OracleClearNpcMeanwhileSaves` |
| 0020 | `game/Tactical/Civ_Quotes.cc`, `game/TacticalAI/DecideAction.cc`, `game/Tactical/Overhead.cc` | `BeginCivQuote` asks `OracleCivQuoteHeadless` after the text lookup: during `civquote` it records the line and its UTF-32 length, keeps the civilian in `gCivQuoteData.pCiv` for the surrender callback and returns before the box; `OracleSurrenderAnswer`, `OracleDetermineCivQuoteEntry` wrap `SurrenderMessageBoxCallBack`, `DetermineCivQuoteEntry`; the surrender condition of `DecideActionBlack` moves into the static `OfferSurrenderNow`, wrapped by `OracleOfferSurrenderNow`; `OracleDecideActionNamedNPC`; `OracleAiPause`, `OracleSetAiPause` for `gfPauseAllAI` and `guiPauseAllAITimer` |
| 0021 | `externalized/DefaultContentManager.cc` | Marks 3001/3000 around the `Random(count)` of `getMusicForMode` |
| 0022 | `game/Tactical/OppList.cc` | The `ManSeesMan` merc quotes `QUOTE_AIM_SEEN_MIKE`, `QUOTE_SPOTTED_JOEY` go through `OracleTracedMercDialogue` of 0018 |
| 0025 | `game/Laptop/Florist_Order_Form.cc` | The order number step of `EnterFloristOrderForm` moves into the static `AdvanceFlowerOrderNumberOnEntry`, the price computation of `DisplayFlowerDynamicItems` into `CalcFlowerOrderPrice`, the body of `BtnFlowerOrderSendButtonCallback` into `SendFlowerOrder`; `OracleFlowerOrder` sets the form's selection (and opens the gallery text when no florist page did); `OracleFlowerOrderFormEntered`, `OracleFlowerOrderPrice`, `OracleFlowerOrderSend` call the three |

`Oracle_Run()` calls `InitializeJA2()` (animation, lighting, strategic and tactical engines, world and tile cache), parses
the script and dispatches each command. Everything else is plain engine API, so a new probe is a new branch in `Dispatch`
in `src/Oracle.cc`. Edit `src/Oracle.cc` here in the repo, not in the copy: `build.sh` overwrites the copy.

To change a hook: edit the files in `$JA2_ORACLE_DIR/src`, rebuild with `cmake --build ~/ja2-oracle/build`, then
regenerate the patch from the repo root as the diff of its files, keeping its header lines:

```sh
for f in src/game/CMakeLists.txt src/sgp/SGP.cc src/game/Tactical/LOS.cc; do
  diff -u --label "a/$f" --label "b/$f" "reference/stracciatella/$f" "$HOME/ja2-oracle/src/$f"
done > /tmp/hooks.patch
```

The base of the diff is `reference/stracciatella` with the earlier patches applied; it differs from the plain reference
only for files two patches touch: `sgp/Random.{h,cc}` (0002, 0006), `Strategic/StrategicMap.cc` (0004, 0012),
`Strategic/Assignments.cc` (0007, 0018), `TacticalAI/NPC.cc` (0013, 0017), `TacticalAI/DecideAction.cc` (0016, 0020) and
`Tactical/OppList.cc` (0011, 0022).

## Notes

- **Saves.** The shipped scripts name the maintainer's six saves (`SaveGame01`, `02`, `07`, `08`, `09`, `10`; sectors B13,
  C13, D13) on the English JA2 Gold 1.12 data (Steam): `SaveGame07` and `08` were saved in turn-based combat in D13,
  `SaveGame10` in D13 in real time; `09` and `10` are the sci-fi saves; all are on easy with 2–4 % progress. Other saves
  need other scripts (`save-probes.ts` writes one for any saves).
- Probe soldiers consume `Random()` (stats in `RandomizeNewSoldierStats`, `TacticalCreateSoldier`), and `FindBestPath`
  draws skip-list levels from `Random()`; none of it changes probe results.
- Probe soldiers take the first free slot of their team (ids 0+ for `player`, 20+ for `enemy`), so in a loaded save they
  may get ids of dead or absent soldiers. Existing soldiers in a save block paths, and the probe soldier's own structure
  is present during `soldierToSoldier`, as in the game.
- Each `path`/`los` command removes the soldiers it created, so commands do not influence each other (apart from the
  `Random()` state).

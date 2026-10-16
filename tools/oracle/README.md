# Native oracle (JA2 Stracciatella probe build)

A patched JA2 Stracciatella build that runs headless against the original game data, executes a
probe script and prints JSON lines. It gives reference values for our reimplementation
(`docs/01-architecture.md` §8, level 6). The probes cover pathfinding, line of sight, the movement
cost table, tactical lighting (`LightTrueLevel` of every tile), and the state of loaded saves: full soldier
dumps, the chance to hit and AP cost of an aimed shot, and the AI's choice of the best shot; autoresolve battles
are traced draw by draw and replayed through ja2-node, together with the created soldiers, their strategic aftermath and
the encounter code of the pre-battle interface; the creature quest (spreading, night planning, town attacks, placements),
the hourly team morale and the arms dealers (stock, restocks, prices, repairs, shop entry) are probed the same way, as
are merc contracts and relationships (the daily merc update, the renewal sequence, extensions, departures and the leave
list), the tactical decisions of creatures and bloodcats, and the laptop (a full `InitNewGame`, A.I.M., M.E.R.C. and
I.M.P. hires, Bobby Ray's orders, restocks and deliveries, life insurance), the narrative state (facts, quests,
CheckFact, the 04:00 and hourly NPC handlers, the quest code of sector entry and exit, profile NPC placement), Skyrider's
helicopter (flights, SAM fire, billing, hovering, landing, boarding and the monologues), the NPC actions (the action
catalog, the requestor answers, the NPC system events, Kingpin's money and the hospital), the NPC schedules (posting,
the 24-hour replay, processing and the AI's schedule steps), giving items and money to NPCs with the quest action items, civilian
quotes, the enemy surrender offer, the hostile-quote list with its AI pause and the named-NPC AI, and the meanwhile scenes
with the end of the campaign (posting, the event and its implications, the NPC moves of a played scene, the first-battle
rules, the progress milestones, captures, the Queen's death on the strategic AI and the O3 statue).

Nothing in this directory contains or produces game data by itself. Probe **outputs** are derived from
the original data: keep them outside the repository (the default work dir is `~/ja2-oracle`) and never
commit them.

## Layout

| Path | What |
|---|---|
| `build.sh` | Copies `reference/stracciatella` to the work dir, adds `src/`, applies `patches/`, builds |
| `run.sh` | Runs one probe script headless and prints JSONL (or writes it to a file) |
| `src/Oracle.{h,cc}` | The probe harness, copied into `src/game/` of the Stracciatella copy |
| `patches/0001-oracle-hooks.patch` | Hooks every probe needs (see "Hooks") |
| `patches/0002-autoresolve-oracle.patch` | Draw trace, engine reseed and a headless autoresolve (see "Hooks") |
| `patches/0003-strategic-ai-oracle.patch` | Trace marks around the load-time recomputation of the strategic AI (see "Hooks") |
| `patches/0004-sector-transition-oracle.patch` | Wrappers for the static sector-exit helpers and trace marks around each placement (see "Hooks") |
| `patches/0005-pre-battle-oracle.patch` | The encounter-code block of `InitPreBattleInterface` as a callable function (see "Hooks") |
| `patches/0006-creature-morale-oracle.patch` | Weighted creature draws in the trace, a stop before creature battles, the morale decay counter at file scope (see "Hooks") |
| `patches/0008-merchants-oracle.patch` | A shop-hours override and wrappers around the static shopkeeper helpers (see "Hooks") |
| `merchant-compare.ts` | The merchant probes of `compare.ts` (`dealers`, `dealerinit`, `dealerdaily`, `progress`, `fact`, `dealerprice`, `dealersell`, `shophours`, `dealerrepair`, `skiptime`, `dealergive`, `ski`) |
| `probes/merchants.txt` | Merchant probe script (see "Merchants") |
| `patches/0007-contracts-oracle.patch` | Wrappers for the static contract helpers, the renewal list and the leave list (see "Hooks") |
| `patches/0009-creature-ai-oracle.patch` | Trace marks around every `FindBestPath` call (see "Hooks") |
| `patches/0010-laptop-oracle.patch` | A headless switch in the A.I.M. member page and wrappers around the static laptop helpers (see "Hooks") |
| `laptop-compare.ts` | The laptop probes of `compare.ts` (`newgamefull`, `arrival`, `laptop`, `setbalance`, `setfact`, `aimhire`, `mercaccount`, `merchire`, `mercpay`, `bobbyrestock`, `bobbyfresh`, `bobbyorder`, `bobbydeliver`, `insure`, `insuranceday`, `payout`, `insurancestep`, `impcreate`) |
| `probes/laptop.txt` | Laptop probe script (see "Laptop") |
| `autoresolve-compare.ts` | Core replay of `autoresolve` probes through ja2-node's autoresolve |
| `autoresolve-creation.ts` | Level 2 of `autoresolve` probes (the soldiers created by `CreateAutoResolveInterface`) |
| `creature-compare.ts` | The creature probes of `compare.ts` (`creatures`, `creaturequest`, `creaturetrigger`, `creaturespread`, `creatureplanning`, `creatureattack`, `endcreaturequest`, `setcreatures`, `creaturecomposition`, `options`, `setcontrol`, `tacticalflags`) |
| `morale-compare.ts` | The morale probes of `compare.ts` (`morale`, `setmorale`, `setrelation`, `setprofile`, `moralemove`, `moralecounter`, `hourlymorale`, `quartermorale`) |
| `probes/creature*.txt`, `probes/morale.txt` | Creature and morale probe scripts (see "Creatures" and "Morale") |
| `contract-compare.ts` | The contract probes of `compare.ts` (`contracts`, `profiles`, `dailyupdate`, `relationshours`, `settime`, `aboutleave`, `beginrenewal`, `renewalstep`, `setcontract`, `setstatus`, `setprofilecontract`, `extend`, `beginremove`, `removemerc`, `leaveequip`, `equipleft`, `mercsite`, `levelup`, `salary`, `setrenewals`) |
| `probes/contracts.txt` | Contract probe script (see "Contracts") |
| `patches/0011-doors-oracle.patch` | A wrapper for the static start-of-menu trap check and an accessor for the hostile-quote list (see "Hooks") |
| `doors-compare.ts` | The door and civilian-group probes of `compare.ts` (`locks`, `door`, `doormenu`, `civgroups`, `makecivhostile`, `pcattack`, `hostilelist`) |
| `probes/doors.txt` | Door, lock, trap and civilian-group probe script (see "Doors") |
| `patches/0012-facts-oracle.patch` | Wrappers for the static hourly quest update, Slay's hourly check and the sector-exit quest code (see "Hooks") |
| `facts-compare.ts` | The fact, quest and NPC presence probes of `compare.ts` (`narrative`, `setquest`, `setnpcprofile`, `checkfact`, `quest`, `earlymorning`, `hourlynpc`, `questentry`, `questexit`, `entersector`) |
| `probes/facts.txt` | Facts, quests and NPC presence probe script (see "Facts and NPC presence") |
| `patches/0013-talk-oracle.patch` | Fact and dialogue-event traces in `TacticalAI/NPC.cc` and wrappers for its static helpers (see "Hooks") |
| `talk-compare.ts` | The NPC dialogue probes of `compare.ts` (`npcrecords`, `npcprofile`, `desire`, `consider`, `talk`, `questdecode`) |
| `probes/talk.txt` | NPC dialogue probe script (see "Talk") |
| `patches/0014-heli-oracle.patch` | Silent Skyrider dialogue with recorded quote numbers, immediate monologue events and wrappers for the static helicopter helpers (see "Hooks") |
| `patches/0016-schedules-oracle.patch` | Trace marks around `PostSchedules` and a wrapper for the static `DecideActionSchedule` (see "Hooks") |
| `schedules-compare.ts` | The schedule probes of `compare.ts` (`schedules`, `schedload`, `schedentry`, `schedclock`, `schedwarp`, `schedprocess`, `scheddecide`, `schedmove`, `schedshophours`) |
| `probes/schedules.txt` | NPC schedule probe script (see "Schedules") |
| `heli-compare.ts` | The helicopter probes of `compare.ts` (`heli`, `heliset`, `helisetup`, `heliboard`, `helileave`, `heliroute`, `helicancel`, `heliwarp`, `helimonologue`, `helipaydebt`, `helireturn`) |
| `probes/heli.txt` | Helicopter probe script (see "Helicopter") |
| `patches/0015-actions-oracle.patch` | Traces of `HandleNPCDoAction`, the requestor callback and the NPC system events, a headless switch for the requestor boxes (see "Hooks") |
| `actions-compare.ts` | The NPC action probes of `compare.ts` (`npcaction`, `npcbox`, `npcevent`, `kingpinmoney`, `hospitalsupplies`, `medicalcost`, `npcset`) |
| `probes/actions.txt` | NPC action probe script (see "NPC actions") |
| `patches/0017-give-oracle.patch` | Traced `CalcMedicalCost` results in `TacticalAI/NPC.cc`, a wrapper for the static `NPCConsiderReceivingItemFromMerc`, and hooks for the conversation, shop and offer calls of `SoldierGiveItemFromAnimation` (see "Hooks") |
| `give-compare.ts` | The give probes of `compare.ts` (`receive`, `give`, `npcgive`, `actionitem`) |
| `probes/give.txt` | Giving items and money and the quest action items (see "Give") |
| `patches/0018-recruit-oracle.patch` | Traces of the abandoning quote and the remove-EPC event of `InternalUnescortEPC` and a switch that defers the removal to the probe (see "Hooks") |
| `recruit-compare.ts` | The recruiting probes of `compare.ts` (`addnpc`, `recruitset`, `recruit`, `unescort`, `robotcontrol`) |
| `probes/recruit.txt` | Recruiting, escort and robot probe script (see "Recruiting") |
| `patches/0020-civ-oracle.patch` | A headless switch in `BeginCivQuote`, wrappers for the static `SurrenderMessageBoxCallBack`, `DetermineCivQuoteEntry` and `DecideActionNamedNPC`, the surrender condition of `DecideActionBlack` as a function, accessors for the AI pause (see "Hooks") |
| `patches/0022-sighting-quotes-oracle.patch` | Traces of the merc quotes for first seeing Mike and Joey in `ManSeesMan` (see "Hooks") |
| `civ-compare.ts` | The civilian probes of `compare.ts` (`civset`, `civquote`, `namednpc`, `initiating`, `pcsnear`, `firstaid`, `friendhostile`, `hostilecheck`, `surrender`, `surrenderanswer`) |
| `probes/civ.txt` | Civilian quotes, the surrender offer, the hostility hooks and the named-NPC AI (see "Civilians") |
| `patches/0019-meanwhile-oracle.patch` | Wrappers for the static meanwhile helpers: the last scheduled scene, the Skip answer and the NPC moves (see "Hooks") |
| `meanwhile-compare.ts` | The meanwhile probes of `compare.ts` (`meanwhiles`, `meanwhilepost`, `firstbattle`, `trashworld`, `meanwhilerun`, `meanwhileplayed`, `hourlyprogress`, `capture`, `queendead`, `statue`) |
| `probes/meanwhile.txt` | Meanwhile scenes, captures, the milestones, the Queen's death and the O3 statue (see "Meanwhile") |
| `creature-ai-compare.ts` | The tactical creature probes of `compare.ts` (`addsoldier`, `setsoldier`, `seen`, `decide`, `beststab`, `stab`, `creaturecall`, `smell`, `dropsmell`, `trackscent`) |
| `probes/creature*.txt`, `probes/morale.txt` | Creature and morale probe scripts (see "Creatures", "Creature AI" and "Morale") |
| `autoresolve-aftermath.ts` | Level 3 of `autoresolve` probes (the battle closed through ja2-node's battle flow on the imported save) and `enemycounts` |
| `pre-battle-compare.ts` | The `pbi` probe of `compare.ts` |
| `probes/battle.txt` | Battles from the strategic state (see "Autoresolve") |
| `probes/a9-*.txt` | Probe scripts for sector A9 (Omerta) |
| `save-probes.ts` | Writes a probe script for the user's native saves (see "Savegames") |
| `map-light-probes.ts` | Writes a light-dump script for every original map with light sprites (see "Lights") |
| `compare.ts` | Rebuilds probe outputs with ja2-node and reports mismatches |
| `strategic-compare.ts` | The strategic probes of `compare.ts` (`stratcosts`, `stratpath`, `groups`) |
| `probes/strategic.txt` | Probe script for strategic movement (see "Strategic movement") |
| `economy-compare.ts` | The economy probes of `compare.ts` (`strategic`, `mercs`, `loyalty`, `assign`, `warp`) |
| `probes/economy.txt` | Probe script for towns, mines and assignments (see "Economy") |
| `probes/autoresolve-*.txt` | Autoresolve probe scripts (see "Autoresolve") |
| `sai-compare.ts` | The strategic AI probes of `compare.ts` (`newgame`, `sai`, `saievaluate`, `saicheck`, `saiwake`, `saiarrive`, `diffmod`, `draws`) |
| `probes/sai-*.txt` | Strategic AI probe scripts (see "Strategic AI") |
| `sector-compare.ts` | The sector transition probes of `compare.ts` (`edgepoints`, `soldierexit`, `walkoff`, `walkin`, `mirror`, `exitcheck`, `move`, `initlist`, `defence`, `creatureplacement`, `bloodcatplacement`) |
| `probes/sectors.txt` | Probe script for sector loading and exits (see "Sector transitions") |

`reference/` is never modified. The work dir (`$JA2_ORACLE_DIR`, default `~/ja2-oracle`) holds:
`src/` (patched copy), `build/` (CMake build, binary `build/ja2`), `home/` (isolated Stracciatella
home with `ja2.json` and copied saves), `tmp/` (engine temp files and `ja2.log`), `oracle.log`
(engine stderr of the last run).

## Requirements

Tested on Ubuntu 26.04 with GCC 15.2, CMake 4.2.3, Ninja, Rust/Cargo 1.93.1 (distribution packages;
the minimum is in `reference/stracciatella/min-rust-version`, 1.85.1), SDL 3.4.2:

```sh
sudo apt-get install build-essential cmake ninja-build pkg-config libsdl3-dev cargo rustc rsync patch
```

The first configure downloads pinned dependencies (magic_enum, Lua 5.3.6, sol2, string_theory,
miniaudio) and the build fetches the Rust crates, so it needs network access once. FLTK, gtest and the Rust tool binaries are not
needed: the build turns off the launcher, the unit tests and `ja2-resource-pack`.

## Build

```sh
tools/oracle/build.sh
```

About 3.5 minutes from scratch on 8 cores (more on the very first run, which also downloads), about
1.5 s for a no-op rerun, seconds when only `src/Oracle.cc` changed. The build
is reproducible: every run re-creates the copy from `reference/stracciatella` (commit recorded in
the binary version as `oracle.<commit>`), copies `src/`, applies the patches, and syncs the result
into `$JA2_ORACLE_DIR/src` by content, so unchanged files keep their timestamps.

Environment: `JA2_ORACLE_DIR` (work dir, must be outside the repo), `JA2_ORACLE_BUILD_TYPE`
(default `RelWithDebInfo`), `JA2_ORACLE_JOBS` (default `nproc`).

CMake prints `fatal: not a git repository` once during configure: Stracciatella asks git for a
version hash and the copy has no `.git`. It is harmless.

## Run

```sh
JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" tools/oracle/run.sh tools/oracle/probes/a9-paths.txt
JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" tools/oracle/run.sh tools/oracle/probes/a9-los.txt
JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" tools/oracle/run.sh tools/oracle/probes/a9-costs.txt ~/ja2-oracle/a9-costs.jsonl
```

The second argument, if given, is the output file; otherwise JSONL goes to stdout. A run takes
well under a second. The exit status is 0 when every command succeeded, 1 when some command
failed (its line carries `error`), 2 for usage errors.

Environment:

| Variable | Meaning |
|---|---|
| `JA2_GAME_DIR` | Game root (the folder that contains `Data`) |
| `JA2_DATA_DIR` | Same as in ja2-node: the game root or its `Data` folder; used when `JA2_GAME_DIR` is unset |
| `JA2_SAVES_DIR` | Where `.sav` files are copied from (default `$JA2_GAME_DIR/SavedGames`) |
| `JA2_RESVERSION` | Stracciatella `-resversion` (default `ENGLISH`) |
| `JA2_ORACLE_DIR` | Work dir (default `~/ja2-oracle`) |

How it runs headless: `SDL_VIDEO_DRIVER=dummy` (SDL3 creates its window and renderer on the dummy
video driver), `-nosound`, `HOME` pointing at `$JA2_ORACLE_DIR/home` so the user's own `~/.ja2` is
never touched, and `TMPDIR` inside the work dir. The engine starts normally up to `InitializeGame()`,
then the oracle takes over instead of the main loop, so no frame is ever rendered. Saves are
copied (never linked) into the isolated home, so the originals stay untouched.

Running the binary by hand is equivalent:

```sh
cd ~/ja2-oracle/build
HOME=~/ja2-oracle/home SDL_VIDEO_DRIVER=dummy JA2_ORACLE=/abs/path/script.txt JA2_ORACLE_OUT=/abs/out.jsonl \
  ./ja2 -gamedir "$HOME/Jagged Alliance 2 Gold" -nosound
```

`JA2_ORACLE` (the script path) switches the oracle mode on. `JA2_ORACLE_OUT` is optional. In oracle
mode the process stdout carries only JSONL: everything the engine prints goes to stderr.

## Probe scripts

One command per line, `#` starts a comment, arguments are `key=value` (sector and save names may
also be positional). Grid numbers are `y * 160 + x`. Commands run in order; a failing command emits
an `error` line and the script continues. The last line is always
`{"probe":"end","commands":N,"failures":F}`.

| Command | Arguments | Does |
|---|---|---|
| `sector A9` | `z=0`, `map=<file>`, `hour=<0..23>` | Sets `gWorldSector` (and the game clock to that hour of day 1) and calls `LoadWorld` on the sector's map |
| `save SaveGame01` | | `LoadSavedGame` from the isolated home's `SavedGames` |
| `soldiers` | `detail=0\|1` | Lists soldiers in the loaded sector; `detail=1` dumps each one like `soldier` |
| `soldier` | `who=<id>` | Full dump of one soldier of the loaded save |
| `costs` | `format=base64` (or `none`) | Dumps `gubWorldMovementCosts` |
| `path` | see below | `FindBestPath` + `PlotPath` |
| `los` | see below | `LineOfSightTest` and `SoldierToSoldierLineOfSightTest` |
| `cth` | see below | `CalcChanceToHitGun` + `CalcTotalAPsToAttack` for an aimed shot, as the attack cursor prepares it |
| `bestshot` | `who=<id>`, `keepAim=0\|1` | The AI's `CalcBestShot` on a soldier of the loaded save |
| `light` | `g=<g>`, `level=0`, `viewer=<id>` | `LightTrueLevel` of a tile, the ambient level and, with a viewer, `DistanceVisible` to it |
| `lights` | `level=0`, `format=base64` (or `none`) | `LightTrueLevel` of every tile, the ambient level and the light sprites |
| `ambient` | `level=<n>` | `LightSetBaseLevel(n)`: new ambient level, every light rendered again |
| `stratcosts` | `mask=FOOT\|CAR\|TRUCK\|TRACKED\|AIR` | `ubTraversability[5]` of the 256 sectors and `GetSectorMvtTimeForGroup` per direction |
| `stratpath` | `from=<sector>`, `to=<sector>`, `mask=…`, `tactical=0\|1` | `BuildAStrategicPath`, `RebuildWayPointsForGroupPath` and `CalculateTravelTimeOfGroup` on a scratch group |
| `groups` | | The strategic movement state of a loaded save: groups, squads, vehicles, sectors, underground, arrival events, merc paths |
| `seed` | `value=<n>`, `pre=keep\|reseed` | Reseeds the `Random` engine (the save restores the `PreRandom` ring, not the engine); `reseed` also refills the ring from it and resets its index |
| `arsetup` | `sector=<A1..P16>`, `code=invasion\|encounter`, `militia=<g>,<r>,<e>`, `enemies=<admins>,<troops>,<elites>`, `persistent=1`, `day=<n>`, `groups=<a>:<t>:<e>/…`, `tacticalmilitia=1` | Writes the sector's militia and garrison counts, `gubEnemyEncounterCode`, `gubPBSector`, `gfPersistantPBI` and optionally the world day (capture needs day 4); `groups` adds enemy groups with `CreateNewEnemyGroupDepartingFromSector` (ids in the output); `tacticalmilitia` needs the sector loaded and runs `ResetMilitia()` so the militia stand in tactical (the hand-off case) |
| `enemycounts` | `sector=<A1..P16>` | Garrison id and counts, `NumStationaryEnemiesInSector`, `NumMobileEnemiesInSector`, `GetNumberOfEnemiesInSector`, `NumEnemiesInSector` |
| `pbi` | `sector=<A1..P16>`, `group=player\|enemy\|creature`, `enemies=<a>,<t>,<e>`, `highpotential=1`, `cantretreat=1`, `mercslife=<n>` | Sets `gfHighPotentialForAmbush` and `gfCantRetreatInPBI`, optionally the life of our mercs in the sector, and runs `WakeUpAllMercsInSectorUnderAttack` and the encounter-code block of `InitPreBattleInterface` (patch 0005) for the save's player group there, a new enemy group (default 0,4,0) or a creature attack; dumps the code, the flags and the traced draws |
| `autoresolve` | `trace=1`, `retreat=<slice>:<soldier id>\|all,…`, `surrender=reject\|accept`, `bandage=0\|1`, `maxSlices=<n>` | Runs a headless Finish-mode autoresolve on the save's mercs in the `arsetup` sector (patch 0002) and dumps the cells after creation and after the ratings, the commands, the result (per cell, team state, clock warp, militia, promotions, sector counts, loyalty) and the traced draws |
| `strategic` | | Towns (rating, change, started, liberated, `GetTownSectorsUnderControl`), every town and SAM sector (militia, training paid/percent/hundredths, ever controlled, enemy controlled, `SectorOursAndPeaceful`, `MilitiaTrainingAllowedInSector`, `IsAreaFullOfMilitia`, SAM condition), the mines (every `MINE_STATUS_TYPE` field, `PredictDailyIncomeFromAMine`, `GetMaxDailyRemovalFromMine`), `fEnemyAirControlled` of the 256 sectors, balance, `PredictIncomeFromPlayerMines`, `CalcMaxPlayerIncomeFromMines`, progress, Enrico flags and the activity counters |
| `mercs` | `detail=strategic` | Per OUR merc: assignment, train stat, sleep/collapse/forced-awake/tired/nothing-to-do flags, breath, life, `sFractLife`, bleeding, last assignment change, need for sleep, and the estimates `CalculateHealingPointsForDoctor`, `CalculateRepairPointsForRepairman` (both with `fMakeSureKitIsInHand = FALSE`), `GetTownTrainPtsForCharacter`, and for the nine trainable stats `GetSoldierTrainingPts`, `GetSoldierStudentPts`, `GetBonusTrainingPtsDueToInstructor(s, NULL)` (points and max) |
| `loyalty` | `event=<GLOBAL_LOYALTY_ name without prefix>`, `sector=<A1..P16>`, `z=0` | `HandleGlobalLoyaltyEvent` and the town loyalties before and after |
| `assign` | `who=<id>`, `kind=<assignment number>`, `stat=<n>` | `RemoveCharacterFromSquads`, `SetTimeOfAssignmentChangeForMerc` (if the assignment changes), `ChangeSoldiersAssignment`, `bTrainStat`; no eligibility checks, no payment |
| `warp` | `seconds=<n>` | `WarpGameTime(n, WARPTIME_PROCESS_EVENTS_NORMALLY)`: every event of the span runs, hourly updates included |
| `draws` | `on\|off\|dump` | Starts or stops a `Random`/`PreRandom` trace across commands (patch 0002); `dump` emits and clears it (used around `save` for the load-time recomputation) |
| `newgame` | `difficulty=1\|2\|3`, `scifi=0\|1` | Sets the game options and runs `SetupNewStrategicGame(); InitNewCampaign();` with its draws traced |
| `sai` | | Dumps the strategic AI: globals, compositions, garrisons, denials, patrols, the AI fields of all 256 sectors, enemy control, underground counts, every enemy group, the AI events (evaluation, checks, arrivals, meanwhiles), status, meanwhile flags, progress and mine income |
| `saievaluate` | `awake=0\|1` | `EvaluateQueenSituation()` (after `gfQueenAIAwake = TRUE` with `awake=1`), draws traced |
| `saicheck` | `sector=<A1..P16>` | `CheckEnemyControlledSector(sector)`, draws traced |
| `saiwake` | | `WakeUpQueen()` (mass fortification on the first call), draws traced |
| `saiarrive` | `count=<n>` | `n` times: the enemy group between sectors with the earliest arrival (first in the list on ties), `WarpGameTime` to its arrival without processing events, `GroupArrivedAtSector(group, TRUE, FALSE)`; draws traced, group ids listed |
| `diffmod` | `class=<soldier class>` | `CalcDifficultyModifier(class)` with its inputs: progress (highest and current), mine income, battle sector, town id, palace distance |
| `edgepoints` | `generate=0\|1` | The four primary and four secondary edgepoint lists with their middle indices (north, east, south, west), as `LoadWorld` left them or after `GenerateMapEdgepoints()` |
| `soldierexit` | `from=<g>` (or `who=<id>`), `dir=N\|E\|S\|W` or `grid=<exit grid gridno>`, soldier keys as `path` (`facing` for the direction, default team `player`) | `SoldierOKForSectorExit` (patch 0004) and `GetAbsoluteScreenXYFromMapPos` of the soldier |
| `walkoff` | `from=<g>`, `dir=N\|E\|S\|W` | `PickGridNoNearestEdge` (patch 0004) for a probe soldier |
| `walkin` | `from=<g>`, `code=N\|S\|E\|W` | `PickGridNoToWalkIn` (patch 0004): gridno and attempts |
| `mirror` | `from=<g>`, `dir=N\|E\|S\|W` | The "mirror" gridno of `SetupTacticalTraversalInformation` and `CalcMapEdgepointClassInsertionCode(from)` with `gubTacticalDirection = dir` |
| `exitcheck` | `who=<id>`, `dir=N\|E\|S\|W` or `grid=<g>` | After a `save`: selects the soldier, makes his squad current and runs `OKForSectorExit`: result, minutes (−1 when untouched), `gfInvalidTraversal`, `gfLoneEPCAttemptingTraversal`, `gubLoneMercAttemptingToAbandonEPCs`, and `SoldierOKForSectorExit` per merc in the sector |
| `move` | `who=<id>`, `to=<g>` | `EVENT_SetSoldierPositionNoCenter` on a soldier of the loaded save |
| `initlist` | | The soldier init list in list order, then `SortSoldierInitList()` (patch 0004) and the sorted list: node id, team, class, priority existence, detailed, soldier id and class |
| `defence` | `admins=`, `troops=`, `elites=` | `AddSoldierInitListEnemyDefenceSoldiers` with its draws traced (placements marked by patch 0004) and the init list before and after |

`sector` is a bare map load: `LoadWorld` compiles movement costs, builds structures, rooms and
buildings, but there is no strategic layer, no enemy or NPC placement, no `PrepareLoadedSector`,
and doors keep their map state. `save` runs the full `LoadSavedGame` (strategic state, the sector's
temp files, soldiers, door states), so probes then see the world as it was saved. All six saves in
the user's `SavedGames` load (B13, C13, D13); `SaveGame07` and `SaveGame08` were saved in turn-based
combat in D13, `SaveGame10` in D13 in real time.

`cth` and `bestshot` change soldier fields while they run (see their sections) and restore them before
the next command, so a script can mix them freely with other probes: a `soldiers detail=1` before and
after them prints identical soldiers.

### `save`

```json
{"probe":"save","name":"SaveGame07","sector":"D13","z":0,"worldLoaded":true,
 "tactical":{"flags":262276,"currentTeam":0,"inCombat":true,"attackBusy":0,"interruptOccurred":false},
 "preRandomIndex":178,"worldSeconds":180106,"soldiers":[{"id":0,"team":0,"profile":2,...},...]}
```

- `tactical`: `gTacticalStatus.uiFlags`, `ubCurrentTeam`, `uiFlags & INCOMBAT`, `ubAttackBusyCount`
  and `fInterruptOccurred` after the load.
- `preRandomIndex`: `guiPreRandomIndex`, the read position in the saved `PreRandom` table.
- `worldSeconds`: `GetWorldTotalSeconds()`.
- `soldiers`: the short form, as in `soldiers` without `detail`.

### `soldier` and `soldiers detail=1`

`soldier who=<id>` emits one soldier, `soldiers detail=1` emits every in-sector soldier in one line
(`{"probe":"soldiers","line":N,"detail":true,"soldiers":[...]}`, same objects). Without `detail`,
`soldiers` keeps the short form of `save` and `sector` (`"detail":false`).

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

- Plain fields: `bSide` (`side`), `ubSoldierClass`, `dXPos`/`dYPos` (`x`/`y`), `bDesiredDirection`,
  `usAniCode`/`usAniFrame`, `bOverTerrainType` (`terrain`), `sBreathRed`, `bShock`, `bActionPoints`
  (`ap`, including the APs carried over into this turn), `bInitialActionPoints`, `bMorale`, `bAIMorale`,
  `bAlertStatus` (`alert`), `bOrders`, `bAttitude`, `bVisible`, `uiStatusFlags`, `bCollapsed`,
  `bBreathCollapsed`, `fNoAPToFinishMove`, `sLastTarget` (25601 is `NOWHERE`), `bTilesMoved`,
  `ubServiceCount`. `stance` is the end height of `usAnimState`, as everywhere.
- `attack`: the attack fields of the save that `cth` and `bestshot` read or change: `usAttackingWeapon`,
  `ubAttackingHand`, `bWeaponMode`, `bDoBurst`, `bAimTime`, `bShownAimTime`, `bAimShotLocation`
  (0 random, 1 head, 2 torso, 3 legs), `bTargetLevel`, `bTargetCubeLevel`, `fDontChargeReadyAPs` and
  `CTGTTarget` (soldier id or `null`).
- `stats`: the raw stats; `effective`: `EffectiveMarksmanship`, `EffectiveDexterity`, `EffectiveAgility`,
  `EffectiveWisdom`, `EffectiveExpLevel`; `apPerTurn`: `CalcActionPoints` (the APs of a new turn before
  carry-over, after breath, injury and weight penalties).
- `skillTraits`: `ubSkillTrait1`, `ubSkillTrait2`; `personality`: `gMercProfiles[profile].bPersonalityTrait`,
  0 without a profile.
- `oppList`: all `MAX_NUM_SOLDIERS` entries of `bOppList` (1 is `SEEN_CURRENTLY`).
- `inventory`: the non-empty slots; `status` is `bStatus[0]`; guns add `ubGunShotsLeft` (`gunAmmo`),
  `usGunAmmoItem` (`ammoItem`) and `ubGunAmmoType` (`ammoType`); `attachments` (item and status) appears
  when the object has any.

### `path`

`path from=<g> to=<g> [mode=walk|run|swat|crawl] [level=0] [toLevel=<level>] [stance=stand|crouch|prone]
[team=enemy|player|militia|civ|creature] [body=regmale|bigmale|stockymale|regfemale] [dir=0..7]
[flags=<n>] [estimate=0|1]`, or `who=<soldier id>` instead of `from`/`level`/`stance`/`team`/`body`
to path an existing soldier of a loaded save.

Without `who`, a probe soldier is created with `TacticalCreateSoldier` (no profile, default team
`enemy`, body `regmale`, direction south), put into the sector, moved exactly to `from` if the
sweet-spot search placed it elsewhere, set to the stance without transition animations, and removed
afterwards. `team=player` matters: the original paths for the player with perceived door states.
`flags` are `PATH_THROUGH_PEOPLE` (1), `PATH_IGNORE_PERSON_AT_DEST` (2), `PATH_CLOSE_GOOD_ENOUGH` (4).
`estimate=1` sets `gfEstimatePath` (what `EstimatePlotPath` does for the AI).

```json
{"probe":"path","line":2,"from":11742,"to":11765,"toLevel":0,"mode":"walk","flags":0,"estimate":false,
 "soldier":{"id":20,"team":1,"profile":200,"body":0,"gridNo":11742,"level":0,"stance":"stand","animState":1,"terrain":1},
 "length":23,"directions":[2,2,...],"gridNos":[11743,11744,...],"apCost":46}
```

- `length`: the return value of `FindBestPath(s, to, toLevel, mode, NO_COPYROUTE, flags)`, 0 when no
  path exists (including an unreachable destination or a different level).
- `directions`: `guiPathingData[0..length)`, direction codes 0 = north … 7 = northwest.
- `gridNos`: the tiles visited, obtained by stepping `NewGridNo(g, DirectionInc(dir))` from `from`.
- `apCost`: `PlotPath(s, to, NO_COPYROUTE, NO_PLOT, mode, 0)`, the AP cost shown by the UI,
  including the start-moving and stance costs; 0 when there is no path.
- `soldier`: the soldier as placed (`team` and `body` are the engine enum values, `terrain` is
  `bOverTerrainType`).

### `los`

`los from=<g> to=<g> [level=0] [toLevel=0] [stance=stand] [toStance=stand] [tileLimit=255] [aware=1]
[soldiers=1] [team=enemy] [toTeam=player] [body=…] [toBody=…] [dir=…] [toDir=…]`, or
`viewer=<id>` / `target=<id>` to use soldiers of a loaded save.

```json
{"probe":"los","line":2,"tileLimit":255,"aware":1,"from":11742,"level":0,"stance":"stand","to":11765,
 "toLevel":0,"toStance":"stand","fromZ":175,"toZ":175,"treeReduction":6,"lineOfSight":23,
 "viewer":{...},"target":{...},"soldierToSoldier":23}
```

- `lineOfSight`: the static `LineOfSightTest(from, fromZ, to, toZ, tileLimit, treeReduction, aware,
  0, FALSE, NULL)` through an exported wrapper, without any soldier on the map. `fromZ`/`toZ` are
  computed like `CalculateSoldierZPos(LOS_POS)` for a regular body on dry land:
  175/111/31 for stand/crouch/prone, +256 on a roof, + `sHeight * 256 / 50` of the tile.
  `treeReduction` is `gubTreeSightReduction` of the target stance (6/7/8).
- `soldierToSoldier`: `SoldierToSoldierLineOfSightTest(viewer, target, tileLimit, aware)` with real
  soldiers placed like the path probe soldier (viewer `enemy`, target `player`). This path adds what
  the raw call leaves out: water stance overrides, camouflage, kid heights, tanks, the soldiers'
  own structures. `soldiers=0` skips it.
- Both values are 0 when the target is not visible, otherwise the cover-adjusted distance.

### `costs`

```json
{"probe":"costs","sector":"A9","layout":"u8[gridNo][direction][level]","shape":[25600,8,2],
 "fnv1a32":"53026593","histogram":{"0":145,"9":13857,"10":71222,...},"base64":"..."}
```

`base64` holds the raw 409,600 bytes of `gubWorldMovementCosts` in the engine layout, index
`(gridNo * 8 + direction) * 2 + level`, the same layout as `MovementCosts.values` in
`src/content/world/movement-costs.ts`. `fnv1a32` (FNV-1a, 32-bit, over those bytes) and
`histogram` (value → count) allow a quick comparison without decoding. With `format=none` only the
hash and histogram are printed. Reading it from Node:

```ts
const line = JSON.parse(text.split('\n').find((l) => l.includes('"probe":"costs"')) ?? '{}');
const costs = new Uint8Array(Buffer.from(line.base64, 'base64'));
```

### `cth`

`cth shooter=<id> target=<id> [location=torso|head|legs] [aims=0,1,2,3,4]`, or `to=<g> [toLevel=0]`
instead of `target` to aim at a tile. Needs a loaded save; fails when the shooter has no gun in
`HANDPOS`.

```json
{"probe":"cth","line":8,"shooter":2,"target":23,"targetGridNo":12397,"targetLevel":0,"location":"torso",
 "aimShotLocation":2,"weapon":22,"ap":12,"chanceToGetThrough":100,
 "results":[{"aim":0,"chance":54,"apCost":6,"cursorChance":54},{"aim":1,"chance":63,"apCost":7,"cursorChance":63},
  ...,{"aim":4,"chance":92,"apCost":10,"cursorChance":92}],"restored":["2.bAimTime","2.bAimShotLocation"]}
```

The shooter is prepared like ja2-node's attack estimate: `bAimShotLocation` = `location` when a soldier
stands on the target tile (`WhoIsThere2(targetGridNo, targetLevel)`, or the `target` soldier) whose
`usAnimState` end height is not prone, otherwise `AIM_SHOT_RANDOM`; `bWeaponMode` = `WM_NORMAL`, `bDoBurst` = 0, `ubAttackingHand` =
`HANDPOS`, `usAttackingWeapon` = the item in hand, `bTargetLevel` = the target level, `bTargetCubeLevel` = 0,
and `bAimTime` = the aim of each result. Then:

- `apCost`: `CalcTotalAPsToAttack(s, victim ? victim->sGridNo : targetGridNo, TRUE, aim)`.
- `chance`: `CalcChanceToHitGun(s, targetGridNo, aim, aimShotLocation, FALSE)`.
- `chanceToGetThrough`: `SoldierToSoldierBodyPartChanceToGetThrough(s, victim, aimShotLocation)` with a
  soldier on the tile, else `SoldierToLocationChanceToGetThrough(s, targetGridNo, targetLevel, 0, NULL)`.
- `cursorChance`: `chance` scaled by `chanceToGetThrough` exactly like the `show_hit_chance` cursor
  (`int` times `ctgt / 100.0f`, truncated).
- `ap`: the shooter's `bActionPoints`. Every requested aim is reported, affordable or not.
- `restored`: the `soldier.field` pairs that differed from the save after the probe and were put back
  (the setup above, plus engine side effects such as `CTGTTarget`, which every chance-to-get-through call
  sets, and `fDontChargeReadyAPs`, which `MinAPsToShootOrStab` clears when it charges a raise).

Where the original UI differs from this setup:

- With the default `show_hit_chance: false` the cursor shows no chance at all, only the AP cost
  `CalcTotalAPsToAttack(s, target, TRUE, bShownAimTime / 2)`. With it on, the cursor shows
  `cursorChance`, computed with the soldier's real fields below.
- The aim location comes from the mouse position on the target's sprite (`DetermineCursorBodyLocation`):
  head, torso or legs by the hit-location flags of the pixel, `AIM_SHOT_RANDOM` when the cursor misses
  the body. It is forced to random when the target's current height (`ubHeight`, not `ubEndHeight`) is
  prone or when the target is not on the player's team and has `bVisible == -1`; crows get legs; while
  `ubAttackBusyCount > 0` the previous value is kept.
- The UI keeps the soldier's own `bWeaponMode`/`bDoBurst` (burst toggle), `ubAttackingHand` and
  `bTargetCubeLevel`; `usAttackingWeapon` is refreshed only while `ubAttackBusyCount == 0`. The cursor
  sets `bTargetLevel` to the target's level, but the real shot (`HandleItem` from the UI) overwrites it with
  `gsInterfaceLevel`, the level the player is viewing.
- The real shot uses `fModify = TRUE` (only matters with a barrel extender, which can fall off), and with
  `AIM_SHOT_RANDOM` it first rolls the body part (`PreRandom(100)`: below 15 legs, above 94 head, else torso;
  head instead when torso or legs get through less than 25% and the head more than twice as well) and
  computes the chance with the rolled part, so the head and legs penalties can apply where `chance` shows
  none.
- The UI stops raising the aim once `EnoughPoints` fails; the cursor's "can't get through" check uses
  `SoldierToLocationChanceToGetThrough(s, target, gsInterfaceLevel, bTargetCubeLevel, 0)` before the click
  and the body-part version after it.

### `bestshot`

`bestshot who=<id> [keepAim=0|1]` runs `CalcBestShot(&s, &best)` (`TacticalAI/Attacks.cc`) on a soldier
of the loaded save, set up like the gun branch of `DecideActionBlack`: the first gun found by
`FindAIUsableObjClass(s, IC_GUN)` is swapped into `HANDPOS` (`RearrangePocket`), and `bAimShotLocation`
is set to `AIM_SHOT_RANDOM` (`keepAim=1` keeps the saved value). Fails when the soldier has no AI-usable
gun.

```json
{"probe":"bestshot","line":16,"who":23,"weaponSlot":5,"weapon":7,"ap":14,"aimShotLocation":0,
 "soldierTargetLevel":0,"possible":true,"opponent":2,"target":12867,"targetLevel":0,"aimTime":4,
 "chanceToReallyHit":34,"apCost":12,"attackValue":1776,"restored":["23.usAttackingWeapon","23.CTGTTarget"]}
```

- `possible`, `opponent`, `target`, `targetLevel`, `aimTime`, `chanceToReallyHit`, `apCost`, `attackValue`:
  `ATTACKTYPE` `ubPossible`, `opponent` (id or `null`), `sTarget` (25601 `NOWHERE` when nothing is
  possible), `bTargetLevel`, `ubAimTime`, `ubChanceToReallyHit`, `ubAPCost`, `iAttackValue`.
- `weaponSlot`/`weapon`: the slot the gun came from and its item; `ap`: `bActionPoints`.
- `aimShotLocation`, `soldierTargetLevel`: the shooter's `bAimShotLocation` and `bTargetLevel` during the
  call. `CalcBestShot` never sets `bTargetLevel`, but `CalcChanceToHitGun` reads it (to find the target
  soldier and for the up/down penalties), so the value left over from the soldier's last attack matters.
  `bAimShotLocation` picks the end point of the body-part line of sight (random uses `TARGET_POS`).
- `restored`: as in `cth`. `CalcBestShot` itself sets `usAttackingWeapon` to the item in hand, clears
  `fDontChargeReadyAPs` (through `MinAPsToAttack`), sets the shooter's `CTGTTarget` to `NULL`
  (`AISoldierToSoldierChanceToGetThrough`) and each considered opponent's `CTGTTarget` to the shooter
  (`CalcManThreatValue`); `AICalcChanceToHitGun` and `AISoldierToSoldierChanceToGetThrough` fake
  `usAnimState = STANDING` and put it back themselves. In the game these changes persist; the probe undoes
  them and the pocket swap.
- Not reproduced from `DecideActionBlack`: `CanNPCAttack`, the `MinAPsToAttack(s, sLastTarget)` check before
  the call, and the rule that drops a shot of `OUR_TEAM` below 30% `chanceToReallyHit`.

### `light`

```json
{"probe":"light","line":3,"g":12400,"level":0,"ambient":12,"trueLevel":10,"viewer":2,"distanceVisible":15}
```

`ambient` is `LightGetAmbient()`, `trueLevel` is `LightTrueLevel(g, level)` (lower is brighter; it includes map light
sprites), `distanceVisible` is `DistanceVisible(viewer, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, g, level)`.

### `lights`

```json
{"probe":"lights","line":3,"sector":"D13","level":0,"ambient":12,"layout":"u8[gridNo]","shape":[25600],
 "fnv1a32":"e48ec8ee","histogram":{"1":97,"2":64,...,"12":23213},
 "sprites":[{"x":59,"y":119,"flags":267,"template":"L-R08.LHT"},...],"base64":"..."}
```

`base64` holds `LightTrueLevel(g, level)` for every `g` in grid order (25,600 bytes), `fnv1a32` and `histogram` are over
those bytes as in `costs`. `sprites` lists the active light sprites with `uiFlags` (ON 0x2, ERASE 0x8, PRIMETIME 0x80,
NIGHTTIME 0x100) and the template name.

### `sector … hour=` and `ambient`

A bare `sector` load uses the clock of a fresh process (00:00, `gubEnvLightValue` 0, so every tile is shade 1).
`hour=<h>` sets the clock to that hour first, which decides which night and prime-time map lights `LoadMapLights` powers;
the `sector` line reports the resulting `hour` and `ambient` and `structureHeights`, the `[gridNo, index]` pairs of
structures whose height is already cached (`ubStructureHeight`), because only those obstacles can block light.
`ambient level=<n>` then renders the lights at a useful ambient level.

### `stratcosts`

```json
{"probe":"stratcosts","line":2,"mask":"FOOT","maskValue":1,"traversability":[[12,2,2,12,13],...],"minutes":[[-1,104,104,-1],...]}
```

A local `GROUP` with `fPlayer = FALSE` and the given `ubTransportationMask` (no encumbrance). `traversability[id]` is
`SectorInfo[id].ubTraversability` (N, E, S, W, through) and `minutes[id]` the `INT32` result of
`GetSectorMvtTimeForGroup(id, dir, &g)` for N, E, S, W (−1 is `TRAVERSE_TIME_IMPOSSIBLE`). Without a save these are the
values `InitializeJA2` loads from `strategic-map-movement-costs.json`; after `save` they are the saved ones (vanilla saves
carry vanilla's table, which differs from the JSON on the I2/I3 border).

### `stratpath`

```json
{"probe":"stratpath","line":7,"from":"A9","to":"P3","mask":"FOOT","tactical":false,"path":[27,45,...],"minutes":[89,...],
 "waypoints":[[9,6,0],...],"next":[9,2,0],"betweenSectors":true,"arrivalInMinutes":89,"traverseTime":89,"eta":1326}
```

The probe detaches `gpGroupList`, creates a player group at `from` with `CreateNewPlayerGroupDepartingFromSector` (no
members, so no encumbrance and no `DelayEnemyGroupsIfPathsCross` side effects), sets the mask and runs
`BuildAStrategicPath(from, to, group, tactical)`. `path` holds the strategic indices (`x + 18·y`), `minutes` the
`GetSectorMvtTimeForGroup` of each edge. Then `RebuildWayPointsForGroupPath` starts the group: `waypoints`, `next`,
`betweenSectors`, the arrival relative to now and `traverseTime`, and `eta` is `CalculateTravelTimeOfGroup`. Afterwards the
group, its arrival and about-to-arrive events are removed and the list restored, so the probe leaves no trace. The SHIFT
("shortest route") mode and the helicopter's airspace costs are not reachable from a probe.

### `groups`

Needs a loaded save. One line with: `groups` (every `GROUP` in list order with all fields, `atFinalDestination`, `eta` =
`CalculateTravelTimeOfGroup`, waypoints, and member soldier ids or the `ENEMYGROUP` counts), `squads` (soldier ids per
slot, −1 empty), `squadGroups`, `deadSquadMembers`, `vehicleGroups`, `vehicles`, `helicopterVehicleId`,
`helicopterAirborne`, `selectedSector`, `sectors` (per `SECTORINFO`: flags, garrison, pending reinforcements, troops,
elites, admins, creatures, the four in-battle counts, facilities, bloodcats, placements, travel rating, militia ×3,
last loaded, last liberated, ever player controlled, visible items), `elements` (`bNameId`, enemy controlled, enemy
airspace, SAM condition), `underground`, `events` (`GROUP_ARRIVAL` and `GROUP_ABOUT_TO_ARRIVE`: stamp, kind, param),
`mercs` (player team: group, sector, assignment, previous sector, insertion code, `pMercPath`), `secrets` and
`worldMinutes`.

## Comparing with ja2-node

```sh
JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" node tools/oracle/compare.ts ~/ja2-oracle/a9-costs.jsonl \
  ~/ja2-oracle/a9-paths.jsonl ~/ja2-oracle/a9-los.jsonl
```

`compare.ts` walks each output file in order. A `sector` line loads that map (A9 when a file has none), a `save` line
imports the save into a fresh ja2-node session (`docs/14-savegames.md` §10, saves from `$JA2_SAVES_DIR` or
`SavedGames` next to the data folder), and every following probe is rebuilt in that context. It prints one line per
probe plus a summary; the exit status is 1 on any mismatch or oracle error. It compares:

- `costs`: the full movement cost table (byte by byte and the FNV-1a hash);
- `path`: length, directions and the `PlotPath` AP cost (probe soldiers after `sector`, the save's soldiers after `save`);
- `los`: `lineOfSight` and `soldierToSoldier`;
- `soldier`/`soldiers detail=1`: position, facing, animation, life, breath, AP, AP per turn, morale, alert, orders,
  visibility, last target, effective stats, personality, opplist and inventory;
- `cth`: chance, AP cost and chance to get through for every aim level, for shooters of any team;
- `bestshot`: possible, opponent, target, aim, chance to really hit, AP cost and attack value;
- `light`: ambient, true level and distance visible;
- `lights`: the true level of every tile (byte by byte and the FNV-1a hash), the ambient level and the light sprites
  (position, template, ON/PRIMETIME/NIGHTTIME; fake merc lights are skipped); after a `sector` line
  with `hour`, the session reloads the map lights for that hour, takes the oracle's ambient level and structure height
  cache, and `ambient` lines set the level again;
- `stratcosts`: every traversability and every edge time (`tools/oracle/strategic-compare.ts`, on the shipped
  `strategic-*.json` after `initStrategicLayerMap`, or on the imported save after `save`);
- `stratpath`: path, edge times, waypoints, next sector, arrival, traverse time and ETA on the same scratch group;
- `groups`: the `importStrategicMap` result of the save against the whole dump; player group ETAs are compared when every
  member is in the loaded sector (encumbrance comes from the tactical soldier).

On 2026-10-15 all three shipped A9 scripts matched exactly.

### Sector transitions

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
tools/oracle/run.sh tools/oracle/probes/sectors.txt ~/ja2-oracle/sectors.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/sectors.jsonl
```

`sector-compare.ts` keeps the loaded map's edgepoints (`loadMapEdgepoints`, replaced by `generateMapEdgepoints` after
`edgepoints generate=1`) and an init list built from the map (`buildSoldierInitList`), mutated like the native one by
`initlist` (the sort is not idempotent) and `defence`. Probe soldiers are rebuilt from the dumped soldier (gridno, level,
stance, team, body). `defence` replays only the placement decisions: draws between a placement begin mark (1000 + node
id) and the end mark (999) are skipped, the rest go through `addSoldierInitListEnemyDefenceSoldiers` of
`strategic/ai/defence-placement.ts` with a roll source that asserts each range, `AddPlacementToWorld` is answered with
the native outcome, and the order of the offered nodes, the final list (classes, soldiers) and the consumed draws are
compared. `exitcheck` and `move` run on a second session of the save created with the data VFS as `FileExists`, so it
has a `SectorFlow`; `okForSectorExit` gets the selected merc (whose squad is the current one, as in the oracle).

On 2026-10-16 the shipped script matched exactly: 13 edgepoint dumps (loaded and generated, A9, D13, H13, I14, I13,
G1, D6 and the A10 basement; I14 regenerates differently from its saved lists and ja2-node follows the generator),
18 `soldierexit`, 20 `walkoff`, 15 `walkin`, 31 `mirror` (class codes 7 and 8 on H13 and I14), 4 `initlist`,
10 `defence` (4 to 64 enemies on 32 to 64 placements) and 21 `exitcheck` on SaveGame10, 07 and 01.

Probe soldiers made prone by the harness cannot path at all in the oracle (they become `SOLDIER_MULTITILE` and every
`FindBestPath` returns 0, crawling included), so the script has no prone walk-off probes.

### Strategic movement

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
tools/oracle/run.sh tools/oracle/probes/strategic.txt ~/ja2-oracle/strategic.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/strategic.jsonl
```

On 2026-10-16 the shipped script (5 `stratcosts`, 21 `stratpath` and the `groups` of all six saves) matched exactly. A
generated sweep of `stratpath` over all 256 × 256 sector pairs for FOOT, AIR and TRACKED (196,608 routes, written by a
throwaway script into `~/ja2-oracle`) and of every adjacent pair with `tactical=1` also matched exactly.

### Strategic AI

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
tools/oracle/run.sh tools/oracle/probes/sai-newgame.txt ~/ja2-oracle/sai/newgame.jsonl
tools/oracle/run.sh tools/oracle/probes/sai-saves.txt ~/ja2-oracle/sai/saves.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/sai/newgame.jsonl ~/ja2-oracle/sai/saves.jsonl
```

`tools/oracle/sai-compare.ts` replays the traced draws of every operation (`newgame`, `saievaluate`, `saicheck`,
`saiwake`, `saiarrive`, and the load-time recomputation between the marks of patch 0003) through ja2-node with a roll
source that asserts each requested range and that no draw is left over, then compares the following `sai` dump field by
field. `newgame` runs `initializeMapStructure`, `setupNewStrategicMap` and `initNewCampaignMap` with the AI hook on a
fresh state; a `save` imports time, map and AI without the load hooks, which run at the next `sai` with the native mine
income from that dump (the economy is not imported here). `diffmod` recomputes `calcDifficultyModifier` from the
imported state and the dumped mine income.

On 2026-10-16 both shipped scripts matched exactly: 7 new games (all difficulties, one with sci-fi), the six saves,
3 wakes, 15 evaluations, 30 periodic checks and 500 enemy group arrivals: 6,085 replayed draws, 51 `sai` dumps and 18
`diffmod` results identical.

### Economy

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
tools/oracle/run.sh tools/oracle/probes/economy.txt ~/ja2-oracle/economy.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/economy.jsonl
```

`economy-compare.ts` imports each save into ja2-node (`importStrategicTime`, `importStrategicMap`, `importEconomy`, the crew
from the saved soldiers with `readSoldierAssignments`) and compares the dumps field by field; `loyalty` replays the event on
the same state, `assign` applies the same changes, `warp` runs `warpGameTime` through ja2-node's event dispatch with the
economy handlers (all other events do nothing; the flow is tactical, as in the oracle, which never compresses time). After
a `warp`, stat gains are RNG-dependent (`StatChange` draws `PreRandom`), so the stat-derived estimates of `mercs` are not
compared; everything else must match. A longer warp that completes the session diverges by a few hundredths because the
trainers' leadership rises in the oracle. On 2026-10-16 all 54 comparisons of the shipped script matched.

### Lights

`map-light-probes.ts [hour...]` writes, for every original map with light sprites, a `sector … hour=<h>` load, a hash-only
`lights`, `ambient level=15` and a full `lights` dump (hours 22, 3 and 12 by default: prime and night lights, night lights
only, always-on lights only).

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
node tools/oracle/map-light-probes.ts > ~/ja2-oracle/map-lights.txt
tools/oracle/run.sh ~/ja2-oracle/map-lights.txt ~/ja2-oracle/map-lights.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/map-lights.jsonl
```

On 2026-10-15 all 672 dumps (112 maps × 3 hours × 2) matched.

### Savegames

`save-probes.ts` writes a probe script for any saves: a soldier dump, `lights` for both levels, `cth` (torso, head, legs)
and `bestshot` for every armed soldier of the player, enemy and militia teams against every opposed soldier, `los` for
every opposed pair, `path` from each fighter to each opposed fighter and twelve tiles out in eight directions, `light`
with each fighter as viewer at every opposed soldier and four and eight tiles out in eight directions, then a second
dump. On 2026-10-15 all 6,815 comparisons over the user's six saves matched.

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
node tools/oracle/save-probes.ts SaveGame01 SaveGame07 SaveGame10 > ~/ja2-oracle/save-probes/saves.txt
tools/oracle/run.sh ~/ja2-oracle/save-probes/saves.txt ~/ja2-oracle/save-probes/saves.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/save-probes/saves.jsonl
```

On 2026-10-15 the six saves gave 1,665 commands and 6,075 comparisons, all matching.

### Autoresolve

`autoresolve` dumps the AR cells right after `CreateAutoResolveInterface` (soldiers with stats, inventory, profile
progress) and the trace of every `Random`/`PreRandom` call with marks between the phases (setup, ratings, battle,
retreat, surrender, end, bandage, close, post). `tools/oracle/autoresolve-compare.ts` (level 1 of docs/19 §7.4, "core
replay") rebuilds the AR state from the setup dump, replays the traced draws through ja2-node's
`calculateAttackValues`, `runAutoresolve`, `endOfBattle`, `autoBandageMercs` and `closeAutoresolve` with replaying
streams that assert every requested range (cosmetic draws routed to `main` with `cosmeticOnMain`), applies the same
retreat orders and surrender answer at the same slices, and compares the ratings, team sums, status, battle time, every
cell (life, bleeding, flags, timers, pending bullets, inventory, militia kill points, merc profile counters and stat
progress), the time warp, militia counts and promotions after closing, and that no draw is left over. For creature
attacks (`arsetup code=creature creatures=<n>`) the native `std::discrete_distribution` picks are traced as weighted
entries (`d`, patch 0006) and replayed as the `Random(100)` that falls into the same bucket (docs/19 D5).

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
tools/oracle/run.sh tools/oracle/probes/autoresolve-d13.txt ~/ja2-oracle/ar/d13.jsonl
tools/oracle/run.sh tools/oracle/probes/autoresolve-capture.txt ~/ja2-oracle/ar/capture.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/ar/d13.jsonl ~/ja2-oracle/ar/capture.jsonl
```

On 2026-10-16 all 14 shipped battles matched exactly (victories, defeats, a retreat, individual and full retreat
orders, bandaging, militia promotions, six surrender offers with accept and reject after up to 141 slices), as did a
generated set of 30 more battles over SaveGame01, 02, 07, 09 and 10 (B13, C13, D13; random militia, garrisons, encounter
codes, retreats, `pre=keep` and `pre=reseed`).

Level 3 ("aftermath", `autoresolve-aftermath.ts`) runs for every `autoresolve` probe that follows a `save`: the save is
imported into a campaign session, the `arsetup` is applied to it (counts, enemy groups, day, `ResetMilitia`), the
counts and town loyalty before the battle are compared, the replayed battle is handed to the battle flow
(`adoptAutoresolve`), the `bandage` and `done` answers go through `dispatch` with the traced close draws, and the world
seconds, enemy counts (stationary, total, in sector), militia, `fEnemyControlled` and town loyalty after the close are
compared, plus the enemy group id of every cell from a fresh `associateEnemiesWithStrategicGroups` (Q16).

Level 2 ("setup", `autoresolve-creation.ts`) runs on a second session of the same save: the `arsetup` is applied,
`buildAutoresolveInput` creates the militia, enemy and creature soldiers with streams that replay the traced draws between
the setup and ratings marks (the creature composition of `CalculateAutoResolveInfo` first), and every created
soldier is compared with the dumped cell (class, body, stats, life, morale, breath, traits, AP and inventory with status
and ammo). Afterwards no draw may be left over except the pathfinder's `Random(4)` and the preserved-soldier
`PreRandom(2)` of the native world unload.

`probes/battle.txt` adds the strategic side of docs/19 §7.4: eight `pbi` probes (codes invasion, encounter, ambush,
entering an enemy sector and creature attack; `gfCantRetreatInPBI`, a high ambush potential and unconscious mercs), five
`enemycounts` (H1 confirms Q12: its garrison, id 25, is counted both as stationary and as mobile) and five battles: two
enemy groups whose ranks do not match the cell classes (Q16), a retreat, victories that leave D13 enemy-controlled
(Q14 holds), and a persistent and a non-persistent autoresolve with the militia loaded in tactical (Q22 holds: the
town loyalty after the close includes the `ABANDON_MILITIA` penalty of `EndTacticalBattleForEnemy`).

```sh
tools/oracle/run.sh tools/oracle/probes/battle.txt ~/ja2-oracle/battle/battle.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/battle/battle.jsonl
```

On 2026-10-16 all of it matched, and level 3 matched on the 8 battles of `autoresolve-d13.txt`, the 6 of
`autoresolve-capture.txt` and the 30 generated ones. Level 2 matched on all 50 battles (156 militia and 664 enemies
created) and on the six creature battles below. The saves are on easy with 2–4 % progress, so the random-ambush
branch (`PreRandom(100)` against the ambush chance) is not reachable natively; its arithmetic is covered by unit tests.

### Creatures

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
tools/oracle/run.sh tools/oracle/probes/creatures.txt ~/ja2-oracle/creatures/creatures.jsonl
tools/oracle/run.sh tools/oracle/probes/creature-battles.txt ~/ja2-oracle/creatures/battles.jsonl
tools/oracle/run.sh tools/oracle/probes/creature-placement.txt ~/ja2-oracle/creatures/placement.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/creatures/creatures.jsonl ~/ja2-oracle/creatures/battles.jsonl \
  ~/ja2-oracle/creatures/placement.jsonl
```

Commands (after a `save`; each prints its arguments, the creature and attack globals, the creature counts of every
surface and underground sector, and the draws it made):
```
options [scifi=0|1] [difficulty=1..3]
setcontrol sector=D13 enemy=0|1                    # fEnemyControlled
tacticalflags enemyinsector=0|1                    # gTacticalStatus.fEnemyInSector
setcreatures sector=D13 [z=1] count=<n>
creatures | creaturequest | creaturetrigger | creaturespread [count=<n>] | creatureplanning | endcreaturequest
creatureattack sector=D13 [specific=1]             # CreatureAttackTown, stopped before the battle opens
creaturecomposition count=<n>                      # DetermineCreatureTownComposition
creatureplacement [queen=1] [larvae=] [infants=] [ym=] [yf=] [am=] [af=]   # after `sector`: AddSoldierInitListCreatures
bloodcatplacement [cats=<n>] [placements=<n>]      # after `sector`: AddSoldierInitListBloodcats
```
`creature-compare.ts` imports the save (strategic map, economy, creature directives and meanwhile flag), replays each
operation through `strategic/creatures/` with roll sources that assert every range (weighted `d` entries become the
matching `Random(100)`) and compares the whole dump; the attack globals are process state in the native build, so they
are carried across `save` lines. `creatureplacement` and `bloodcatplacement` replay only the placement decisions, like
`defence` (draws inside a placement are skipped, the native outcome answers each placement).

On 2026-10-16 every probe matched: 7 quest starts, 2 triggers, 11 spreads, 9 night plannings, 17 town attacks (battle
codes none, PBI and autoresolve; lairs 1, 3 and 4, no save picks lair 2), the quest end and 2 compositions (8,178 `main`,
13 `pre` and 43 weighted draws); 6 creature autoresolve battles (30 militia, 54 creatures) at levels 1–3; 5 creature and
5 bloodcat placements.

### Morale

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
tools/oracle/run.sh tools/oracle/probes/morale.txt ~/ja2-oracle/morale/morale.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/morale/morale.jsonl
```

Commands (each prints the decay counter, progress, `fEnemyInSector`, the world minutes and per OUR merc the sector, group,
motion, assignment, sleep, life, effective leadership, morale, the four modifiers, opinions of the teammates, hated, buddy
and learn slots, personality and attitude):
```
morale
setmorale who=<id> [team=] [tactical=] [strategic=] [delayed=] [asleep=0|1]   # then RefreshSoldierMorale
setrelation who=<profile> about=<profile> [opinion=] [hated=<slot>:<time>:<count>] [learnhate=<time>:<count>] [learnlike=<time>:<count>]
setprofile who=<profile> [personality=] [attitude=]
moralemove who=<id> to=<gridno>
moralecounter value=<n>                            # the strategic decay counter
hourlymorale [count=<n>]                           # UpdateBuddyAndHatedCounters + HourlyMoraleUpdate
quartermorale [count=<n>]                          # DecayTacticalMoraleModifiers
```
`morale-compare.ts` applies the same changes to a campaign session of the save and runs `team-morale.ts`. On
2026-10-16 all 43 probes matched (hated relations within and past their tolerance, learning to like and to hate,
sleeping mercs, the third-hour strategic decay, a nervous merc moved away from his squad).

### Merchants

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
tools/oracle/run.sh tools/oracle/probes/merchants.txt ~/ja2-oracle/merchants.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/merchants.jsonl
```

Commands (dealer ids 0–18 as in `dealers.json`; every dump also prints the world day and minutes, the highest progress,
gun nut and `FACT_ESTONI_REFUELLING_POSSIBLE`):
```
dealers                                     # status and every non-empty item header with its special elements
dealerinit                                  # InitAllArmsDealers, draws traced
dealerdaily [count=<n>]                     # n × (WarpGameTime 1 day without events, DailyUpdateOfArmsDealersInventory)
progress highest=<n>                        # gStrategicStatus.ubHighestProgress
fact id=<n> value=0|1                       # SetFactTrue/False, draws traced (the Estoni gas intercept)
options gunnut=0|1                          # also scifi=, difficulty= (shared with the creature probes)
dealerprice dealer= item= [status= count= ammo=<item>:<n> attach=<item>:<s>,… imprint=] [merc=<profile>]
dealersell dealer= item= [status= count= statuses=a,b,… ammo= attach= imprint=]   # AddObjectToArmsDealerInventory
shophours [open=<min> close=<min>]          # override GetArmsDealerShopHours (no arguments: off)
dealerrepair dealer= item= [status= attach=] [start=<min>] [ks=k1,k2,…]   # cost, time, overnight delay, closed minutes
skiptime seconds=<n>                        # WarpGameTime without events
dealergive dealer= item= [status= attach= imprint=] [owner=<profile>]   # GiveObjectToArmsDealerForRepair now
ski dealer= [merc=<profile>]                # repair delay + InitializeShopKeeper headless: boxes, prices, collected repairs
```
`merchant-compare.ts` keeps its own merchant state: a `save` imports section 23 (with the save's facts, progress, gun nut
and clock), `dealerinit`, `dealerdaily`, `fact` and `ski` replay the native draws (main and `PreRandom` interleaved, every
range asserted, none left over) through ja2-node and compare the dumps field by field; prices, repairs and sales compare
directly. On 2026-10-16 all 202 comparisons matched: eight initialisations over progress 0–100 and gun nut, 51 daily
updates (30 from SaveGame10), four facts, 41 prices, 10 sales, 16 repair estimates, 10 repair jobs, 27 shop entries
(boxes and dealer state each; one delay excuse taken, one refused by its `PreRandom` roll) and eight dealer dumps
including the six saves' sections.
### Contracts

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
tools/oracle/run.sh tools/oracle/probes/contracts.txt ~/ja2-oracle/contracts.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/contracts.jsonl
```

Commands (each prints its arguments, the draws it made, the contract state and the profiles of the team, or of `who=`
and `range=`, with the fields of docs/22 §0. The state holds the world minutes, balance, merc deaths, man-days, death
rate, bad reputation, unhired deaths, the M.E.R.C. account status, the renewal list and sequence flags, the leave list,
the pending contract events and per OUR merc every contract field with the expiry predicates, `FindRefusalReason`,
`WillMercRenew`, the first buddy on the team, the death-rate, reputation and morale checks and the equipment check):
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
`contract-compare.ts` applies the same changes to a campaign session of the save, replays the traced draws through
`ContractFlow.useRandom` and compares the dump after every command. On 2026-10-16 all 81 probes matched on SaveGame01,
02, 07, 09 and 10 (the daily update over all profiles, warnings, the sequence with willing, unwilling and stale entries,
extensions with refusals for hated mercs, death rate, reputation and morale, buddies overriding them, dismissal within
three hours, departures with the equipment here, in Drassen and in Omerta, RPC pay, M.E.R.C. account days, POW and dead
mercs, and the salary rounding).
### Creature AI

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
tools/oracle/run.sh tools/oracle/probes/creature-ai.txt ~/ja2-oracle/creatures/creature-ai.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/creatures/creature-ai.jsonl
```

Commands (after a `save`; the soldier commands print the full soldier dump plus the AI state: side, smells, mobility,
caller, call priority, frenzy, hunting, old life, regeneration, action fields, noise, patrol grid, aim, walk-to-attack
cache, hand items, inventory flags and `bAwareOfOpposition` of the team):
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
and `AddSoldierToSectorNoCalculateDirection`, so seed the engine first (`seed value=<n> pre=reseed`) for repeatable
scripts. `decide` sets `gfTurnBasedAI` from `INCOMBAT` and traces the draws; the draws between the path marks of patch
0009 (`k` 301/302) are the pathfinder's skip-list levels and are dropped ("Pathfinder RNG" deviation).

`creature-ai-compare.ts` imports the save into a tactical session, builds each added soldier from the dump (stats,
inventory with status and flags, life, breath, AP, alert, orders, smells) at the dumped id and grid, and copies the
dumped state after every `setsoldier`/`seen`; `decide`, `beststab`, `stab`, `creaturecall` and `trackscent` replay the
native draws into `rng`/`pre` and compare the result (action, action data, next action, alert, mobility, caller fields,
frenzy, old life, aim, movement mode, final destination, walk-to-attack cache, facing, AP, hand items, inventory flags)
and that no draw is left over. On 2026-10-16 all 218 probes of `creature-ai.txt` matched (69 decisions over all eight
bodies on SaveGame07 in combat and SaveGame10 in real time, GREEN to BLACK, calls, hurt calls, spit and claws, multi-tile
paths around walls; 8 `beststab`, 3 `stab`, 4 `creaturecall`, 2 `dropsmell`, 3 `trackscent`, 71 added soldiers with
their AP per turn), and so did three runs of the same script with other seeds (`seed value=` +100, +200, +300).

### Laptop

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
tools/oracle/run.sh tools/oracle/probes/laptop.txt ~/ja2-oracle/laptop.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/laptop.jsonl
```

Commands (each prints its arguments, the draws it made, a result, the laptop state (new-game flag, bookmarks, balance,
I.M.P. flags, personnel lists, the M.E.R.C. fields, Bobby Ray's flags, new and used lists with item, on hand, on order,
quality and eligibility, shipments, insurance payouts, mails, the landing zone, the hired flag, the pending laptop events,
the world minutes), every OUR merc's contract fields and inventory, and the selected profiles (status, availability,
salaries, deposit, kit cost, `CalcCompetence`, attractiveness, flags, hangover, precedent quotes, M.E.R.C. days, sector,
traits, stats, inventory, taken I.M.P. slot)):
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
```
`laptop-compare.ts` builds the new game through `buildNewCampaign` with the traced draws in the state's streams (the
`InitFace` triples of the preloaded NPC faces dropped), or opens a campaign session of the save, applies the same command
through the laptop modules with `LaptopFlow.useRandom` (hire probes drop the face and first-frame draws: "Cosmetic face and
frame draws"), and compares the whole dump. The Bobby Ray theft counter is a function static in the original; the
comparer carries it across the saves of one file. On 2026-10-16 all 43 probes matched: three new games (medium, easy
with gun nut, hard without sci-fi: 2,546–2,666 draws each, profile states, terrorists, Bobby Ray's stock, mails, events),
the arrival table, five A.I.M. hires (week, two weeks without kit, Nails for a day, funds refusals), the M.E.R.C.
account, two hires and the payment, five Bobby Ray orders with deliveries to a loaded Drassen (theft draws, hidden crate
items), to Meduna and to an unloaded Drassen, a restock with 417 draws, insurance purchase, offer, expiry, two payouts
and an investigation, and a male and a female I.M.P. character on SaveGame01, 07 and 10.

### Doors

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" JA2_ORACLE_DIR=~/ja2-oracle-doors
tools/oracle/run.sh tools/oracle/probes/doors.txt ~/ja2-oracle-doors/out/doors.jsonl
node tools/oracle/compare.ts ~/ja2-oracle-doors/out/doors.jsonl
```

Commands (each prints its arguments; the door commands print the door entry before and after, the soldier before and after
with AP, life, breath, bleeding, the skill-check memory, inventory, key ring, profile gains and stats, the attack busy count
and the draws):
```
locks                                                 # the 64 entries of LockTable
door who=<id> g=<door> action=open|examine|pickLock|force|lock|unlock|explode|untrap|crowbar
     [locked=] [trap=] [level=] [lock=] [damage=] [perceivedLocked=] [perceivedTrapped=] [remove=1] [close=1]
     [give1..3=<slot>:<item>:<status>:<count>[:<keyId>]] [clear=<slot>:...] [ring=<keyId>:<count>]
     [ap=] [life=] [breath=] [bleeding=] [shock=] [explosives=] [mechanical=] [strength=] [dexterity=] [wisdom=]
     [expLevel=] [incombat=1]                         # HandleOpenableStruct with ubDoorHandleCode set
doormenu who=<id> g=<door> [same settings]            # DoTrapCheckOnStartingMenu
civgroups [set=<group>:<hostility>,...] [neutral=<id>:<0|1>,...] [group=<id>:<civ group>,...]
makecivhostile who=<id> | pcattack who=<id> target=<id> | hostilelist   # with fCivGroupHostile, the civilians, militia and
                                                      # mercs (team, side, neutral, group, opponents, profile), the
                                                      # hostile-quote list and the pending civ-group events
```
`doors-compare.ts` applies the same settings to a campaign session of the save and replays the `PreRandom` draws strictly
(every range asserted, none left over); `Random` draws are matched in order and the native extras (curses, door creaks,
explosion sounds, all cosmetic) are skipped. The AP of a menu action stopped by the trap check is not compared (the native
cost reads past `doorAPs`, deviation "Trap check cost of menu actions"). On 2026-10-16 all 49 probes matched on SaveGame09:
the lock table, the start-of-menu trap check (noticed, missed, with bleeding, already known), locked doors opened through the
menu with and without traps (electric, super electric, siren, silent alarm), forcing with lock damage and gains up to the
broken lock, impossible and unopenable locks, crowbar wear, lock picking (mechanical and electronic, success and failure),
examining, untrapping (success, explosion and silent alarm sprung), keys from the ring and from the inventory, the wrong
key, locking, shaped charges (damaged, destroyed), opening and closing a lockless door, and the civilian-group probes
(MakeCivHostile keeps the side, the rebels' proximity rule with the 300-minute event, a group already at 2).

### Facts and NPC presence

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" JA2_ORACLE_DIR=~/ja2-oracle-facts
tools/oracle/run.sh tools/oracle/probes/facts.txt ~/ja2-oracle-facts/out/facts.jsonl
node tools/oracle/compare.ts ~/ja2-oracle-facts/out/facts.jsonl
```

Commands (each prints its arguments, the draws, a result, the narrative state (the 500 facts, the 30 quests, the boxing
globals, the terrorist count, the balance, the world minutes and sector) and the presence fields of the selected
profiles (`ids=a,b,…`, default every NPC, RPC and vehicle: sector with z, the three misc flag bytes, `bNPCData`/`bNPCData2`,
money, balance, life, status, town, last date spoken to, profile insertion, quote record and action, inventory)):
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
                                                    # PayOffSkyriderDebtIfAny traced
questentry sector= [z=] | questexit sector= [z=]    # HandleQuestCodeOnSectorEntry/Exit traced
entersector sector= [z=]                            # SetCurrentWorldSector: the profiled non-player soldiers (active)
```
`facts-compare.ts` imports the save into a campaign session, applies the same command through the narrative modules
with the native draws replayed strictly (both streams), and compares the state and the profiles; `checkfact` compares the
500 results with the facts that read the boxing state or `CalcDesireToTalk` left out (deviation "Computed facts without
inputs"), `entersector` the sorted profiles of the active soldiers, those away by schedule included as in `FOR_EACH_SOLDIER`
(`setCurrentWorldSector` bypassing the merc check, as the native call does). The talk context outlives a save load in the original, so every `checkfact` sets it. On 2026-10-16 all 51
probes matched: fifteen CheckFact sweeps over all ids with different profiles and talk contexts on the six saves, quest starts and ends with
and without history, six 04:00 events with their draws (Father, Tony, Devin, Hamous, Carmen, Dave), the hourly quest facts
at hours 2, 4, 9, 10, 15, 18 and 20, Skyrider's debt payment, the quest code of sector entry and exit, and four sector loads
on SaveGame10 (C13, D13, a profile moved into C13 without placement, and one inserted into D13 through profile insertion
data). The `newgamefull` and save probes of `laptop.txt` now also compare every profile's sector (InitNPCs, the terrorists).

### Talk

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" JA2_ORACLE_DIR=~/ja2-oracle-talk
tools/oracle/run.sh tools/oracle/probes/talk.txt ~/ja2-oracle-talk/out/talk.jsonl
node tools/oracle/compare.ts ~/ja2-oracle-talk/out/talk.jsonl
```

Commands (after a `save`; `merc` is a soldier id of the save, its profile is the talker):
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
Approaches: `friendly`, `direct`, `threaten`, `recruit`, `repeat`, `initial`, `whoareyou`, `trigger`, `buysell`, `initiating`,
`givingitem`, `declaration`, `enemy`, `notsafe`. `talk-compare.ts` imports the save into a campaign session with NPC records,
replays the native `CheckFact` results in order (a different call order is a mismatch; the values are written into the fact
store, as the native computed facts are) and the `Random` draws, runs `converseFull` on the same headless panel and compares
the queue, facts, quests, flags, the engaged state and the profile. On 2026-10-16 all 313 probes matched on SaveGame02, 01, 07
and 10 (Herve, Doreen, Waldo, Pablo, Peter, Fred: records and backups after the load, 32 desires, 64 considerations, 184
conversation steps with defaults, get-lost, triggers and the friendly draw); `questdecode` gave an offset of -512 and 0 for
every quest-100/200 read.

### Give

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" JA2_ORACLE_DIR=~/ja2-oracle-give
tools/oracle/run.sh tools/oracle/probes/give.txt ~/ja2-oracle-give/out/give.jsonl
node tools/oracle/compare.ts ~/ja2-oracle-give/out/give.jsonl
```

Commands (after a `save`; soldier ids are the save's):
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
`setup` is any of `fact=<id>:<v>,…`, `quest=<id>:<v>,…`, `balance=<n>` and `npcdata=<n>` (the NPC profile), `hospital=<temp>:<refund>`,
`said=<record>` and `mercsex=<n>`; each probe prints what it applied. `give-compare.ts` imports the save, applies the same setup,
replays the native `CheckFact` results, `CalcMedicalCost` values and draws (path searches' skip-list draws left out, deviation
"Pathfinder RNG") and runs ja2-node's code: `npcConsiderReceivingItemFromMerc`, `giveItemOpcode` with the narrative port pointed at
the replay, `handleNpcItemGiven` and the action item queue. For a give to a dealer whose shop opens, the comparer applies the
original's `RemoveObjFrom` to the giver's pocket first (deviation "Giving to a dealer"). On 2026-10-16 all 83 probes matched on
SaveGame02, 01, 07 and 10: 22 gives (NPCs with and without records, dealers, squad mates, the recruited RPC with a debt, one item
of a stack), 7 NPC gifts (in and out of reach), 46 money and item rules (Darren, Angel, Madame, Joe, Gerard, Vince, Steve, Walter,
Frank, Kingpin, Skyrider, an RPC, Madlab's rifles, the heads, the robot without records, the NPCs in the saves) and 8 action items
(the room scene and the museum alarm on a pressure item, a door closer, a player-owned and a remote item that the merc does not
set off, the switch-rung Kingpin alarm that starts combat).

### Civilians

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" JA2_ORACLE_DIR=~/ja2-oracle-civ
tools/oracle/run.sh tools/oracle/probes/civ.txt ~/ja2-oracle-civ/out/civ.jsonl
node tools/oracle/compare.ts ~/ja2-oracle-civ/out/civ.jsonl
```

Commands (after a `save`; soldier ids are the save's):
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
`civ-compare.ts` imports the save, applies the same `civset` changes and runs ja2-node's code with the native draws and
`CheckFact` results replayed: `startCivQuote` (the hint checks with profile 200 replayed, the civilian entry fed from the
traced `Random` into the cosmetic stream), `decideActionNamedNPC`, `npcConsiderInitiatingConv`, `pcsNearNpc`,
`pcDoesFirstAidOnNpc`, `triggerFriendWithHostileQuote`, `checkHostileOrSayQuoteList`, `offersSurrender`, and the tactical
surrender prompt of the battle flow answered through `answer` (draws after the native ones come from a fallback stream:
the lost battle that follows in ja2-node runs later in the original). The AI pause is compared only for `friendhostile`
and `hostilecheck` (the native flag survives a `save`, hence `civset pause=0` after each one). On 2026-10-16 all 151
probes matched on SaveGame02, 01, 07, 10, 08 and 09 in three native runs: 69 civilian quotes (hints with their quest,
the low-loyalty hint drop, low and high loyalty, kids, cowering, combat, hicks, goons, factory kids, beggars, rebels,
enemy lines, the surrender line), 12 named-NPC decisions (turning towards the player, `PCsNearNPC` within 8 tiles),
8 conversation openers, 6 tile and 3 first-aid triggers, 2 hostile friends (one with a declaration trigger), 2
hostile-quote checks with the speaker's pause and reveal, 7 surrender conditions, both answers (the capture of the one
living merc) and the 40 `civset` steps.

### Helicopter

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" JA2_ORACLE_DIR=~/ja2-oracle-heli
tools/oracle/run.sh tools/oracle/probes/heli.txt ~/ja2-oracle-heli/out/heli.jsonl
node tools/oracle/compare.ts ~/ja2-oracle-heli/out/heli.jsonl
```

None of the user's saves owns the helicopter, so every scenario starts with `helisetup` (`SetUpHelicopterForPlayer`). Every
command prints the helicopter globals, the vehicle (sector, ten passenger slots, path), its group (sector, next, prev, between,
arrival and traverse times, waypoints, members), Skyrider's balance and life, the money, facts 43, 45, 136 and 277, the sectors
flagged `SF_SKYRIDER_NOTICED_ENEMIES_HERE`, the four SAM secrets, the mercs (assignment, vehicle id, sector, between, group,
`bInSector`, insertion code and data, driver/passenger role, life), the squads, the pending helicopter, hover and meanwhile
events, the quotes Skyrider said since the last command and the draws:
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
`heli-compare.ts` applies the same steps to a campaign session of the save and replays the draws: `PreRandom` strictly (SAM
fire and scouting), `Random` matched in order with the native extras skipped (other systems' events during the warps, the
cosmetic "enemies spotted" quote pick). The "enemies spotted" quotes 34 and 35 are compared as one. A merc's insertion code and
data are compared only outside the loaded tactical sector: the original rewrites them on every tile step (`SetSoldierGridNo`),
ja2-node keeps them in the roster. On 2026-10-16 all 120 probes matched on SaveGame01, 02 and 10: boarding and leaving,
flights through enemy airspace with SAM hits up to the destruction (passengers killed), billing at 100 and 1000 per sector,
payment shortfalls with the debt, the drop and the return to base, landing at a refuel site with the kill-chopper meanwhile,
hovering warnings with the drop after 20 minutes, rerouting in flight (turning back and landing when no time passed),
arrivals delayed by a battle in the loaded sector, the refusals (grounded, owed, disloyal Drassen with the `FACT_LOYALTY_LOW`
write-back, returning, the empty-helicopter hint), the hourly debt payment, the believed-enemy confirmation and the four
monologues with their SAM reveals.

### NPC actions

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" JA2_ORACLE_DIR=~/ja2-oracle-actions
tools/oracle/run.sh tools/oracle/probes/actions.txt ~/ja2-oracle-actions/out/actions.jsonl
node tools/oracle/compare.ts ~/ja2-oracle-actions/out/actions.jsonl
```

Commands (after a `save`; `src`/`dest` are soldier ids, `dest` defaults to the NPC's soldier, `panel=1` sets
`gfInTalkPanel`; each prints the queued dialogue events, the `CheckFact` calls, both random streams, the fact and quest
changes, the new strategic events, history lines and mails, the hospital globals, the requestor box that opened (type and the
lie record), the combat flags, the mercs and the NPC soldier (`soldiers=all`: every soldier in sector), the profiles of the
NPC and of `ids=`, the items at the primary delivery gridno and at gridnos 1 and 2, and the loaded world's money):
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
`actions-compare.ts` imports the save into a campaign session, sets the same headless talk context, replays the native
`CheckFact` results in order (a different call order is a mismatch; the values are written into the fact store, as the native
computed facts are) and both streams strictly, runs the catalog (`handleNpcDoAction`), `answerNpcRequest`,
`npcSystemEvent`, `kingpinMoneyCheck` and `hospitalSuppliesCheck` and compares the same fields; `npcset` writes both sides.
The cosmetic `InitFace` draws of a panel opened by action 232 are dropped from the native trace (deviation "Cosmetic face and
frame draws"). On 2026-10-16 all 188 probes matched on SaveGame01, 10 and 02: Pablo's shipment report with and without the
bribe draws, his return of the goods (neutral again, the event, the two random items and the moved pool in a loaded B13), the
package timers and the damaged package, the plain fact events, Kingpin's three money stages (history, debt, the letter, quest
4, the threat), medical costs with discounts, every requestor answer including three lies with the skill check, the boxes
that open and the one refused for the wrong panel NPC, the doctor's escort onto the hospital assignment, the generic actions,
Father's, Madame's, Carmen's, Joey's, Vince's and Willis's chains with their draws and events, the mines of Fred and the
hospital supplies.

### Schedules

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" JA2_ORACLE_DIR=~/ja2-oracle-sched
tools/oracle/run.sh tools/oracle/probes/schedules.txt ~/ja2-oracle-sched/out/schedules.jsonl
node tools/oracle/compare.ts ~/ja2-oracle-sched/out/schedules.jsonl
```

Every command prints its arguments, the draws, a result and the schedule state: the world and last event query seconds,
`gubScheduleID`, the schedule list in list order (id, flags, the four times, data and actions, the soldier), every active
civilian (gridno, level, `bInSector`, `SOLDIER_OFF_MAP`, `AI_ASLEEP`, `AI_CHECK_SCHEDULE`, `AI_LOCK_DOOR_INCLUDES_CLOSE`,
schedule id and progress, initial and off-world gridno, first patrol point, quote action, body and life), the door table
(gridno, locked, structure open) and the pending `EVENT_PROCESS_TACTICAL_SCHEDULE` events (stamp, schedule id):
```
schedules                                   # dump only
schedload name=SaveGameNN                   # LoadSavedGame traced (PostSchedules without auto-processing)
schedentry sector= [z=]                     # SetCurrentWorldSector traced (PostSchedules replays the last 24 hours)
schedclock seconds= [query=]                # set guiGameClock and guiTimeOfLastEventQuery
schedwarp minutes= screen=map|game          # WarpGameTime with events processed normally, guiCurrentScreen set
schedprocess id= screen=map|game            # ProcessTacticalSchedule
scheddecide soldier=                        # DecideActionSchedule: action, usActionData, sAbsoluteFinalDestination
schedmove soldier= gridNo=                  # EVENT_SetSoldierPositionNoCenter, as if the civilian had walked there
schedshophours profile=                     # FindSoldierByProfileID + ExtractScheduleDoorLockAndUnlockInfo
```
`schedules-compare.ts` imports the save into a campaign session and compares the whole state after each command. The
draws inside the `PostSchedules` marks (pathfinder draws left out, as in "Creature AI") are replayed strictly: on
`schedentry` through `SectorFlow.postSchedulesOfLoadedSector`, on `schedload` after undoing the session's own post-load
posting (saved schedules, soldier schedule ids, the events added after the saved ones). Body and life are not compared
(the civilians' creation draws are not replayed), nor the decision's data when it returns no action (stale fields). Sector
entries come right after a load: the 04:00 event moves NPCs with draws that warps do not replay, and the temp files of
other sectors are not imported from native saves. On 2026-10-16 all 50 probes matched on the six saves: loads with the
second events and redrawn default schedules, entries into C13, D13 and B13 (sleep times, bumps, away civilians, the shop
doors locked at night), map-screen warps up to a day, tactical warps activating entries, and the AI's steps for a door
unlock, a lock, a wake-up and the return of a default civilian from the away slots.

### Recruiting

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" JA2_ORACLE_DIR=~/ja2-oracle-recruit
tools/oracle/run.sh tools/oracle/probes/recruit.txt ~/ja2-oracle-recruit/out/recruit.jsonl
node tools/oracle/compare.ts ~/ja2-oracle-recruit/out/recruit.jsonl
```

Commands (after a `save`; `src`/`dest` as for `npcaction`, `ids=` adds profiles to the dump):
```
addnpc profile= at=<grid> [dir=]       # a profiled civilian: TacticalCreateSoldier, AddSoldierToSectorNoCalculateDirection
recruitset [who= slot= item= [status=] [place=1]] [profile= town= attachment= salary= flags= flags3=] [facts=] [quests=] [squad=]
                                       # an inventory slot (place=1 through PlaceObject), profile fields, facts, quests and
                                       # iCurrentTacticalSquad on both sides
recruit npc= action=rpc|free|epc|unrecruit|settonpc|marry|enemy [record=] [soldiers=all]
                                       # HandleNPCDoAction for RECRUIT_WITH_SALARY, RECRUIT, UN_RECRUIT_EPC, SET_EPC_TO_NPC,
                                       # REMOVE_MERC_FOR_MARRIAGE, BECOME_ENEMY; epc answers the escort box with yes
unescort npc= map=0|1                  # UnEscortEPC in tactical or on the map screen (the removal deferred, then run in order)
robotcontrol [update=1] [opp=<id>]     # ControllingRobot per merc, the robot's holder, CanRobotBeControlled, and with opp=
                                       # CalcInterruptDuelPts against that soldier
```
`recruit` and `unescort` print the queued dialogue events, the `CheckFact` calls, both streams, fact and quest changes, new
events and history lines, our team (id, profile, kind, assignment, sector, group, tile, stats, bleeding, breath, morale,
camouflage, visibility, body, contract end, remote holder, insertion code off the map, insertion direction, inventory), the
squads, the current squad, the civilians in the sector, the profiles, the personnel "other" list, the town loyalties and
the NPC's salary. `recruit-compare.ts` imports the save, reserves the slots of the save's off-map civilians (away slots of
the schedules), replays the native `CheckFact` results and both streams strictly (without the cosmetic face draws of a new
merc and the pathfinder's skip-list draws between the 0009 marks) and runs the catalog, the escort answer,
`RecruitFlow.internalUnescortEpc`/`removeEpc` or the wrong-sector trigger. On 2026-10-16 all 74 probes matched on
SaveGame01, 02 and 10, also with two more native seeds: John and Mary escorted together (quest 19) and released on the map
screen with their leaving lines, by the plane record and in tactical, Skyrider (fact 269, quest 17, record 15), Dynamo
ending quest 18, Slay out of his wheelchair with his week, R.P.C.s with town loyalty and the weapon swap into the hand (a
two-handed rifle moving the second-hand item away), the robot with its holder, the remote put on through `PlaceObject` and
the interrupt points, Maria via Angel, Joey's record 9, two marriages and recruited rebels sent back to the civilian team.

### Meanwhile

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data" JA2_ORACLE_DIR=~/ja2-oracle-meanwhile
tools/oracle/run.sh tools/oracle/probes/meanwhile.txt ~/ja2-oracle-meanwhile/out/meanwhile.jsonl
node tools/oracle/compare.ts ~/ja2-oracle-meanwhile/out/meanwhile.jsonl
```

Every command after a `save` prints its arguments, the draws (both streams), a result and the meanwhile state:
`uiMeanWhileFlags`, the 17 definitions and the current one (sector, trigger, id, NPC), `gfMeanwhileTryingToStart`,
`gfInMeanwhile`, the last scheduled id, the pending `EVENT_MEANWHILE` events (stamp, param, offset), the first-battle flag and
sector, the profiles of the Queen, Elliot, Joe, Rat, Madlab, the robot and Iggy (sector, gridno, profile insertion,
`bNPCData`), the quests 11, 8, 9 and 15, `FACT_MIKE_AVAILABLE_TO_ARMY`, the highest progress, the Queen's AI flag, the
strategic status flags and capture count, the pause state and the world seconds:
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
`HandleStatueDamaged` and prints the struct indexes at 13830, the exit grid at 13669 and its revealed flag before and after,
and the skip flag. `meanwhile-compare.ts` imports the save into a campaign session and replays both streams strictly. The
first `meanwhiles` after a load copies the pause state and the last scheduled id into the session: native loads keep the
saved pause (ja2-node save sessions resume unpaused) and the last scheduled id is a static that survives loads. A `begun`
scene is skipped the native way (the trying flag cleared, the implications, unlock and unpause). The statue probes run on a
fresh O3 world per `sector` line and compare the statue tiles only. On 2026-10-16 all 62 probes matched on four native runs
(different seeds) of SaveGame01, 02, 07, 08, 09, 10 and O3: every posting function (each scene once, Elliot counted at
scheduling, the flower and chopper draws), the event delayed by enemies, the implications of each scene (the hard-only
first-battle wake, the towns and SAM sites woken, the creature scene, the scientist with Madlab and the robot), the played
NPC moves, the first-battle rules, the milestones, captures to Alma and to the interrogation, the Queen's death and the statue
opened by the remote and by explosions at distance 0–2.

## Shipped probes

| Script | Content |
|---|---|
| `probes/a9-paths.txt` | Open ground in all four movement modes, around and into buildings through doors (enemy and player), a fence crossing walking and crawling, three long paths (49–101 steps), a roof path, an unreachable destination |
| `probes/a9-los.txt` | Open ground, sight limit cut-off, stance combinations, blocked by buildings, across a fence, roof to ground and ground to roof, lines through trees with stand/crouch/prone targets |
| `probes/a9-costs.txt` | The full movement cost table of A9 |
| `probes/autoresolve-d13.txt` | Eight autoresolve battles on SaveGame10 (D13): invasion and encounter codes, 0–11 militia, 6–32 enemies, bandaging, retreat orders for all and for one merc |
| `probes/autoresolve-capture.txt` | Six battles on SaveGame10 at day 5–7 with 20–32 enemies and no militia: the surrender offer, accepted or rejected |
| `probes/battle.txt` | Eight `pbi` probes on SaveGame01, 02 and 10, `enemycounts` for H1, B13, C13 and D13, and five battles on SaveGame09 and 10 with extra enemy groups and militia loaded in tactical |
| `probes/economy.txt` | `strategic` and `mercs` after each of the six saves, nine `loyalty` events, and `warp`s of two, three and eight hours (the last after assigning two militia trainers and a self-trainer in B13) |
| `probes/strategic.txt` | The travel table for the five transports, A9→P3 for every mask and other long, unreachable, tactical-traversal and trivial routes, then `save` + `groups` for SaveGame01, 02, 07, 08, 09, 10 |
| `probes/sai-newgame.txt` | Seven seeded new games on every difficulty (draw log of `InitNewCampaign`, `sai`), three of them followed by `saiwake`, `saievaluate`, `saicheck` and `saiarrive count=60` with dumps, the others by `saiarrive count=40` |
| `probes/sai-saves.txt` | For each of the six saves: the draws of the load, `sai`, `diffmod` for three classes, a seeded `saievaluate awake=1`, four `saicheck`, a second evaluation and `saiarrive count=40`, each followed by `sai` |
| `probes/creatures.txt` | The creature quest on SaveGame09 and 10 over the three difficulties: starts, triggers, spreads, night planning, town attacks with each battle code, the end of the quest and two compositions |
| `probes/creature-battles.txt` | Six creature autoresolve battles in D13 with 0–12 militia, the save's mercs and 3–20 creatures (bandaging, a full retreat) |
| `probes/creature-ai.txt` | Creature and bloodcat decisions on SaveGame07 (combat) and SaveGame10 (real time): every body seeing, hearing, hurt, called, low on AP, around walls; melee choice and impact, calls, smell drops and scent tracking |
| `probes/creature-placement.txt` | Creature placements in F13 b3 (with the queen), G13 b3, E13 b1, D13 b1, H8 b1 and bloodcat placements in I16, E13, C8 and D9 |
| `probes/morale.txt` | Hourly and quarter-hour morale on SaveGame10, 07 and 01 with set modifiers, relations, traits and positions |
| `probes/merchants.txt` | Dealer initialisation at progress 0–100 and with gun nut, daily restocks, the Estoni gas, shop entries for every merchant, prices and sales at Tony, Keith, Jake, Franz, Gabby, Micky and Devin (Flo's modifier, stacks, attachments, Keith's fact), repair estimates with and without shop hours, repair queues with collection and the delay excuse, and every save's dealer section with 30 restocks from SaveGame10 |
| `probes/contracts.txt` | Contracts and relationships on SaveGame01, 02, 09, 10 and 07 (see "Contracts") |
| `probes/laptop.txt` | Three seeded new games, the arrival table, and laptop commands on SaveGame01, 07 and 10 (see "Laptop") |
| `probes/doors.txt` | Doors, locks, traps and civilian groups on SaveGame09 (see "Doors") |
| `probes/facts.txt` | Facts, quests and NPC presence on the six saves (see "Facts and NPC presence") |
| `probes/talk.txt` | NPC records, profiles, desires, record choice and conversation steps for the NPCs present in SaveGame02, 01, 07 and 10 (see "Talk") |
| `probes/heli.txt` | Skyrider's helicopter on SaveGame01, 02 and 10 (see "Helicopter") |
| `probes/actions.txt` | NPC actions, requestor answers, NPC system events, Kingpin's money and the hospital on SaveGame01, 10 and 02 (see "NPC actions") |
| `probes/schedules.txt` | NPC schedules on the six saves (see "Schedules") |
| `probes/meanwhile.txt` | Meanwhile scenes, captures, milestones and the Queen's death on the six saves, the O3 statue (see "Meanwhile") |
| `probes/give.txt` | Giving items and money to the NPCs, dealers and mercs of SaveGame02, 01, 07 and 10, the money rules of the absent NPCs, NPC gifts and the quest action items (see "Give") |
| `probes/recruit.txt` | Recruiting R.P.C.s, escorting and releasing E.P.C.s, the robot and civilian-group team changes on SaveGame01, 02 and 10 (see "Recruiting") |
| `probes/civ.txt` | Civilian quotes, named-NPC decisions, tile and first-aid triggers, the hostile-quote list and the surrender offer on the six saves (see "Civilians") |
| `probes/sectors.txt` | Edgepoints loaded and generated on eight maps, screen-space exit thresholds on both sides of every edge (A9, A10 basement), exit-grid checks in D13 and the basement, walk-off/walk-in/mirror from the centre and near the edges, class codes on the isolated maps H13 and I14, init list sorts and ten defence placements (A9, B13, C13, D13), and `OKForSectorExit` on SaveGame10, 07 (in combat) and 01 before and after moving mercs to an edge or an exit grid |

All three were run on the user's Steam JA2 Gold 1.12 data: every command succeeds, and on these
inputs `lineOfSight` and `soldierToSoldier` agree.

## Hooks

`patches/0001-oracle-hooks.patch` touches three Stracciatella files:

- `src/sgp/SGP.cc`: when `JA2_ORACLE` is set, `Oracle_PrepareProcess()` runs before logging starts
  (it keeps the real stdout for JSONL and sends everything else to stderr), and after
  `InitializeGame()` `main` calls `Oracle_Run()`, shuts the game down and returns its status
  instead of entering the main loop.
- `src/game/Tactical/LOS.cc`: appends `OracleLineOfSightTest` (a wrapper around the `static`
  `LineOfSightTest`) and `OracleTreeSightReduction`.
- `src/game/CMakeLists.txt`: adds `Oracle.cc`.

`Oracle_Run()` calls `InitializeJA2()` (animation, lighting, strategic and tactical engines, world
and tile cache), parses the script, then dispatches each command. Everything else is plain engine
API, so new probes are a new branch in `Dispatch` in `src/Oracle.cc`.

To change a hook: edit the files in `$JA2_ORACLE_DIR/src`, rebuild with
`cmake --build ~/ja2-oracle/build`, then regenerate the patch from the repo root:

```sh
for f in src/game/CMakeLists.txt src/sgp/SGP.cc src/game/Tactical/LOS.cc; do
  diff -u --label "a/$f" --label "b/$f" "reference/stracciatella/$f" "$HOME/ja2-oracle/src/$f"
done > /tmp/hooks.patch
```

and replace everything after the header lines of `patches/0001-oracle-hooks.patch` with it.
Edit `src/Oracle.cc` here in the repo, not in the copy: `build.sh` overwrites the copy.

`patches/0002-autoresolve-oracle.patch` (applied after 0001) touches four more files:

- `src/sgp/Random.{h,cc}`: `OracleSeedRandom(seed, reseedPre)`, and a trace switch (`OracleTraceRandom`) that appends
  `{stream, range, value, ring index}` for every `Random` (`m`) and `PreRandom` (`p`) call with a range above 0, plus
  `OracleTraceMark` entries (`k`). Calls with range 0 draw nothing and are not traced.
- `src/game/Strategic/Auto_Resolve.{h,cc}`: the end-of-battle block of `RenderAutoResolve` moves into
  `HandleAutoResolveBattleEnd` (same code, same call site); `ProcessBattleFrame` gets a slice budget checked at the top
  of each 1000 ms slice (`gOracleARSliceBudget`, −1 in the game) and remembers whether a frame stopped inside a slice;
  appended `OracleAutoResolve*` functions run the logic of `EnterAutoResolveMode` and of the entering block of
  `AutoResolveScreenHandle` without the screen switch and the zoom, switch to Finish (`uiTimeSlice = 0xffffffff`,
  `fSound = FALSE`), run frames up to a slice count, apply retreat orders (the bodies of `RetreatButtonCallback` and
  `MercCellMouseClickCallback`) and the surrender answer, run the end block, `AutoBandageMercs` and
  `RemoveAutoResolveInterface`, and expose the AR state for the dump. The harness sets `guiCurrentScreen` to
  `AUTORESOLVE_SCREEN` around it so soldier creation takes the AR path; the battle sector's world unloads as in the game.

To change 0002, edit the four files in `$JA2_ORACLE_DIR/src`, rebuild, and regenerate it like 0001 with those paths
(the diff is against `reference/stracciatella` with 0001 applied, which does not touch these files).

`patches/0003-strategic-ai-oracle.patch` (applied after 0002) touches `src/game/Strategic/Strategic_AI.cc` only: two
`OracleTraceMark` calls (codes 101 and 102) around the load-time recomputation at the end of `LoadStrategicAI`
(`UpdateAirspaceControl`, `EvolveQueenPriorityPhase(TRUE)`, the repoll of idle enemy groups), so the comparison can
replay exactly those draws out of the whole `LoadSavedGame` trace. Regenerate it like 0002 with that path.

`patches/0004-sector-transition-oracle.patch` (applied after 0003) appends `OraclePickGridNoNearestEdge`,
`OraclePickGridNoToWalkIn` and `OracleSoldierOKForSectorExit` (wrappers around the `static` functions) to
`src/game/Strategic/StrategicMap.cc`, and to `src/game/Tactical/Soldier_Init_List.cc` `OracleSortSoldierInitList` plus a
scope guard at the top of `AddPlacementToWorld` that writes `OracleTraceMark(1000 + node id)` on entry and
`OracleTraceMark(999)` on every return. Regenerate it like 0002 with those two paths.

`patches/0005-pre-battle-oracle.patch` (applied after 0004) touches `src/game/Strategic/PreBattle_Interface.cc` only:
the encounter-code block of `InitPreBattleInterface` moves into `DeterminePersistentEncounterCode` (same code, same
call site), and the appended `OracleDeterminePersistentEncounterCode(group, sector)` runs
`WakeUpAllMercsInSectorUnderAttack` and that block headless for the `pbi` probe. Regenerate it like 0002 with that path.

`patches/0006-creature-morale-oracle.patch` (applied after 0005) touches `src/sgp/Random.{h,cc}`
(`OracleTraceWeighted`: one `d` entry per weighted pick with the weight total and the lower bound of the chosen bucket),
`src/game/Strategic/Creature_Spreading.cc` (the trace call in `DistributeCreaturesByWeight` and
`gOracleSkipCreatureBattle`, which stops `CreatureAttackTown` before the battle switch; false in the game) and
`src/game/Tactical/Morale.cc` (the function-static decay counter of `HourlyMoraleUpdate` becomes the file-scope
`gOracleStrategicMoraleUpdateCounter`, same behaviour). Regenerate it like 0002 with those paths.

`patches/0008-merchants-oracle.patch` (applied after 0006) touches `src/game/Tactical/Arms_Dealer_Init.cc`
(`gOracleShopHoursActive`, `gOracleShopOpeningTime`, `gOracleShopClosingTime`: when active, `GetArmsDealerShopHours`
returns them without looking for the dealer's soldier and schedule; inactive in the game) and
`src/game/Tactical/ShopKeeper_Interface.{h,cc}` (appended `OracleCalcShopKeeperItemPrice`, `OracleItemConditionModifier`,
`OracleEvaluateInvSlot`, `OracleHandlePossibleRepairDelays` and `OracleInitializeShopKeeper`, which select the dealer and a
probe SM-panel merc with the given profile, run the static helper and restore the globals; the last one runs the
inventory part of `InitializeShopKeeper` without buttons and returns the boxes and the player's offer area). Regenerate it
like 0002 with those paths.
`patches/0007-contracts-oracle.patch` (applied after 0006) only appends functions: to `src/game/Strategic/Merc_Contract.cc`
wrappers around the static `FindRefusalReason`, `ContractIsExpiring` and `ContractIsGoingToExpireSoon`, accessors and a
setter for the renewal list and sequence state, and a reset of the sequence; to `Assignments.cc`
`OracleBeginRemoveMercFromContract`; to `Map_Screen_Interface.cc` readers of the leave list and its owners; to
`Tactical/Campaign.cc` `OracleCalcNewSalary`. Regenerate it like 0002 with those four paths.
`patches/0009-creature-ai-oracle.patch` (applied after 0006) touches `src/game/Tactical/PathAI.cc` only: a scope guard at
the top of `FindBestPath` writes `OracleTraceMark(301)` on entry and `OracleTraceMark(302)` on every return, so the
creature AI comparison can drop the skip-list draws of the pathfinder. Regenerate it like 0002 with that path.
`patches/0010-laptop-oracle.patch` (applied after 0009): in `src/game/Laptop/AIMMembers.cc` a headless switch
(`gOracleAimHeadless`, inactive in the game) makes `CanMercBeHired` record the quote instead of starting the video face
and lets `AimMemberHireMerc` hire a given profile; the charge computation of `DisplayMercChargeAmount` moves into
`CalcMercContractAmount` (same code, same call site), and the body of `BtnIMPConfirmYes` into `IMPConfirmYes` in
`IMP_Confirm.cc`. Wrappers are appended for `CalcCompetence` (`Soldier_Profile.cc`), `MercFilesHireMerc`,
`SettleMercAccounts` (with the total charge), `CalculateTotalPurchasePrice` and `PurchaseBobbyOrder` (`BobbyRGuns.cc`,
`BobbyRMailOrder.cc`), `CalculateSoldiersInsuranceContractLength` and `CompileQuestionsInStatsAndWhatNot`. Regenerate it
like 0002 with the nine paths of the patch.

`patches/0011-doors-oracle.patch` (applied after 0010) only appends: to `src/game/Tactical/Handle_Doors.cc`
`OracleDoTrapCheckOnStartingMenu`, a wrapper around the static `DoTrapCheckOnStartingMenu`; to `src/game/Tactical/OppList.cc`
`OracleHostileQuoteList`, which copies the ids of the static hostile-quote list (plus `#include <vector>`). Regenerate it
like 0002 with those two paths.

`patches/0012-facts-oracle.patch` (applied after 0011) only appends: to `src/game/Strategic/Hourly_Update.cc`
`OracleHourlyQuestUpdate` and `OracleHourlyCheckIfSlayAloneSoHeCanLeave`, wrappers around the static `HourlyQuestUpdate`
and `HourlyCheckIfSlayAloneSoHeCanLeave`; to `src/game/Strategic/StrategicMap.cc` `OracleHandleQuestCodeOnSectorExit`.
Regenerate it like 0002 with those two paths.

`patches/0013-talk-oracle.patch` (applied after 0011) touches `src/game/TacticalAI/NPC.cc` only: after the includes,
`CheckFact` is redirected to `OracleTracedCheckFact` and `TalkingMenuDialogue`, `NPCDoAction`, `NPCGotoGridNo` and
`TacticalCharacterDialogue` are wrapped by macros that first call `OracleDialogueTrace`; `NPCClosePanel`, `TalkingMenuGiveItem`
and `NPCTriggerNPC` get the same macro right after their definitions. Both trace functions live in `Oracle.cc` and record only
while a probe sets a trace (top-level `CheckFact` calls only). Appended: `OracleNPCConsiderTalking`,
`OracleCalcThreateningEffectiveness`, `OracleNPCConsiderQuote` and accessors for the record arrays. Regenerate it like 0002
with that path.

`patches/0014-heli-oracle.patch` (applied after 0013) changes `src/game/Strategic/Map_Screen_Helicopter.cc` and
`src/game/Strategic/MapScreen.cc`. With `gOracleSkyriderSilent` set, `SkyriderDialogue` appends the quote number to
`gOracleSkyriderQuotes` instead of queueing the dialogue, `SkyriderDialogueWithSpecialEvent` runs the monologue event at
once (the SAM reveals and the monologue timestamp), and `RequestGiveSkyriderNewDestination` skips its message box and cursor
change. It appends `OracleMakeHeliReturnToBase`, `OracleRequestGiveSkyriderNewDestination` and `OracleHandleNewDestConfirmation`
(with `fPlotForHelicopter` set) as wrappers around the static functions. Regenerate it like 0002 with those two paths. The
probes also set `fShowAircraftFlag`, as the map screen does when plotting for the helicopter.

`patches/0015-actions-oracle.patch` (applied after 0014) changes `src/game/Tactical/Interface_Dialogue.cc` and
`src/game/Strategic/Strategic_Event_Handler.cc`. Around `HandleNPCDoAction`, `StartDialogueMessageBox` and
`DialogueMessageBoxCallBack`, `CheckFact` goes through `OracleTracedCheckFact` and `TalkingMenuDialogue`, `NPCDoAction` and
`NPCGotoGridNo` are traced like 0013 does in `NPC.cc` (`#undef` after the callback); `Strategic_Event_Handler.cc` traces its
`CheckFact` calls the same way. With `gOracleSkipDialogueBoxes` set, `StartDialogueMessageBox` records the box type and returns
before `DoMessageBox`. It appends `OracleDialogueMessageBoxType`, `OracleLiePromptRecord`, `OracleResetDialogueMessageBox` and
`OracleAnswerDialogueMessageBox` (sets the type and the lie record, then calls the static callback). Regenerate it like 0002
with those two paths.

`patches/0016-schedules-oracle.patch` (applied after 0014, and after 0015 where present) changes
`src/game/Strategic/Scheduling.cc` and `src/game/TacticalAI/DecideAction.cc`: `PostSchedules` records trace mark 2001 on entry
and 2000 on exit (an RAII guard), and `OracleDecideActionSchedule` wraps the static `DecideActionSchedule`. Regenerate it like
0002 with those two paths.

`patches/0017-give-oracle.patch` (applied after 0014) changes `src/game/TacticalAI/NPC.cc` and `src/game/Tactical/Handle_Items.cc`.
In `NPC.cc`, `CalcMedicalCost` is redirected to `OracleTracedMedicalCost` (Oracle.cc), which records each result while a probe
traces, and `OracleNPCConsiderReceivingItemFromMerc` is added after `HandleNPCBeingGivenMoneyByPlayer` as a wrapper around the
static function that also returns the record the result points to (the Vince and Steve quirk sets the record but leaves the
index 0). In `Handle_Items.cc`, right before `SoldierGiveItemFromAnimation`, `InitiateConversationFull`,
`EnterShopKeeperInterfaceScreen` and `AddItemToPlayersOfferAreaAfterShopKeeperOpen` are redirected to `OracleGiveConversation`,
`OracleGiveShop` and `OracleGiveOffer`, which call the real functions unless the `give` probe runs: then they record the call,
and the conversation opens headless (the panel globals and `ConverseFull`, as `talk` does). Regenerate it like 0002 with those
two paths (after 0014 is applied).

`patches/0018-recruit-oracle.patch` (applied after 0017) changes `src/game/Strategic/Assignments.cc`: in
`InternalUnescortEPC` the abandoning quote goes through `OracleTracedMercDialogue` (traced as `merc` only when
`TacticalCharacterDialogue` queued it) and the remove-EPC event is traced as `removeepc`; while `gOracleDeferredEpcs` points
to a vector the profile is pushed there instead of queueing `DialogueEventRemoveEPC`, so `unescort` can run `UnRecruitEPC`
itself after `UnEscortEPC` returns. `Oracle.cc` defines both symbols. Regenerate it like 0002 with that path.

`patches/0020-civ-oracle.patch` (applied after 0017) changes `src/game/Tactical/Civ_Quotes.cc`,
`src/game/TacticalAI/DecideAction.cc` and `src/game/Tactical/Overhead.cc`. In `Civ_Quotes.cc`, `BeginCivQuote` asks
`OracleCivQuoteHeadless` (Oracle.cc) after the text lookup: during `civquote` it records the line and its UTF-32 length,
remembers the civilian in `gCivQuoteData.pCiv` (for the surrender callback) and returns before the box; `OracleSurrenderAnswer`
and `OracleDetermineCivQuoteEntry` wrap the static `SurrenderMessageBoxCallBack` and `DetermineCivQuoteEntry`. In
`DecideAction.cc` the surrender condition of `DecideActionBlack` moves unchanged into the static `OfferSurrenderNow`, wrapped
by `OracleOfferSurrenderNow`, and `OracleDecideActionNamedNPC` wraps `DecideActionNamedNPC`. `Overhead.cc` gains
`OracleAiPause` and `OracleSetAiPause` for `gfPauseAllAI` and `guiPauseAllAITimer`. Regenerate it like 0002 with those
three paths (after 0017 is applied).

`patches/0022-sighting-quotes-oracle.patch` changes `src/game/Tactical/OppList.cc`: the two merc quotes of `ManSeesMan`
(`QUOTE_AIM_SEEN_MIKE`, `QUOTE_SPOTTED_JOEY`) go through `OracleTracedMercDialogue` of 0018, so the dialogue traces of
the comparers include them. Regenerate it like 0002 with that path.

`patches/0019-meanwhile-oracle.patch` (applied after the others) appends to `src/game/Strategic/Meanwhile.cc`:
`OracleLastScheduledMeanwhileId` (the static `ubCurrentMeanWhileId`), `OracleSkipMeanwhile` (the static
`BeginMeanwhileCallBack` with `MSG_BOX_RETURN_NO`), `OracleSetNpcMeanwhile` and `OracleRestoreNpcMeanwhile` (the static NPC
moves of a played scene) and `OracleClearNpcMeanwhileSaves` (empties their save slots). Regenerate it like 0002 with that path.

## Notes

- Probe soldiers consume `Random()` (stats in `RandomizeNewSoldierStats`, `TacticalCreateSoldier`),
  and `FindBestPath` draws skip-list levels from `Random()`. None of it changes probe results.
- Probe soldiers take the first free slot of their team (ids 0+ for `player`, 20+ for `enemy`), so
  in a loaded save they may get ids of dead or absent soldiers. Existing soldiers in a save do block
  paths and the probe soldier's own structure is present during `soldierToSoldier`, as in the game.
- Each `path`/`los` command removes the soldiers it created, so commands do not influence each
  other (apart from the `Random()` state).
- `cth` and `bestshot` draw no random numbers and create no soldiers; the chance-to-get-through calls
  create and remove a fake bullet each.

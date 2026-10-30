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
| `save-probes.ts`, `map-light-probes.ts` | Write probe scripts for native saves ("Savegames") and for map lights ("Lights") |
| `src/Oracle.{h,cc}` | The probe harness, copied into `src/game/` of the Stracciatella copy |
| `patches/*.patch` | Hooks into Stracciatella ("Hooks") |
| `probes/*.txt` | The shipped probe scripts ("Shipped probes") |

`reference/` is never modified. The work dir (`$JA2_ORACLE_DIR`, default `~/ja2-oracle`, which must lie outside the
repository) holds `src/` (the patched copy), `build/` (CMake build, binary `build/ja2`), `home/` (an isolated
Stracciatella home with copied saves), `tmp/` (engine temp files), `oracle.log` (engine stderr of the last run) and the
probe outputs.

## Requirements

Tested on Ubuntu 26.04 with GCC 15.2, CMake 4.2.3, Ninja, Rust/Cargo 1.93.1 (minimum in
`reference/stracciatella/min-rust-version`) and SDL 3.4.2 from the distribution; `build.sh` names the packages it misses.
The first configure downloads Stracciatella's pinned dependencies and the build fetches the Rust crates, so network
access is needed once. The build turns off the launcher, the unit tests and the Rust tool binaries, so FLTK and gtest are
not needed.

## Build

```sh
tools/oracle/build.sh
```

Every run re-creates the copy from `reference/stracciatella` (commit recorded in the binary version as
`oracle.<commit>`), copies `src/`, applies the patches in file-name order and syncs the result into
`$JA2_ORACLE_DIR/src` by content, so unchanged files keep their timestamps and a rebuild after a change to
`src/Oracle.cc` takes seconds. Configure prints `fatal: not a git repository` once (Stracciatella asks git for a
version hash; the copy has no `.git`): harmless.

## Run

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
O="${JA2_ORACLE_DIR:-$HOME/ja2-oracle}"
tools/oracle/run.sh tools/oracle/probes/a9-paths.txt                      # JSONL to stdout
mkdir -p "$O/doors" && tools/oracle/run.sh tools/oracle/probes/doors.txt "$O/doors/doors.jsonl"
```

`run.sh` takes the game from `JA2_GAME_DIR` or `JA2_DATA_DIR` (the game root or its `Data` folder), copies the `.sav`
files of `JA2_SAVES_DIR` (default `SavedGames` in the game root) into the isolated home, and passes `JA2_RESVERSION`
(default `ENGLISH`) as `-resversion`. Exit status: 0 when every command succeeded, 1 when some command failed (its line
carries `error`), 2 for usage errors.

Headless: SDL's dummy video and audio drivers, `-nosound`, `HOME` in the work dir so the user's own `~/.ja2` is never
touched. `JA2_ORACLE` (the script path) switches oracle mode on: the engine starts normally up to `InitializeGame()`,
then the oracle runs instead of the main loop, so no frame is ever rendered; stdout carries only JSONL and everything
the engine prints goes to stderr. `run.sh` shows the environment for running `build/ja2` by hand, under a debugger for
instance.

## Probe scripts

One command per line, `#` starts a comment, arguments are `key=value` (sector and save names may be positional). Grid
numbers are `y * 160 + x`. Commands run in order; every output line carries `probe` and the script `line`; a failing
command emits an `error` line and the script continues. The last line is always
`{"probe":"end","commands":N,"failures":F}`.

`Dispatch` in `src/Oracle.cc` maps each command to the function that runs it; the arguments are parsed there, and the
shipped scripts, which comment their scenarios block by block, are the examples. The domain sections under "Comparing
with ja2-node" name the commands each comparer reads. Rules that hold across domains:

- **`sector` and `save`.** `sector A9 [z=] [map=] [hour=]` is a bare map load: `LoadWorld` compiles movement costs and
  builds structures, rooms and buildings; there is no strategic layer, no enemy or NPC placement, no
  `PrepareLoadedSector`, and doors keep their map state. `save SaveGameNN` runs the full `LoadSavedGame` (strategic
  state, the sector's temp files, soldiers, door states), so probes see the world as saved. Unless a section says
  otherwise, a domain's commands work on a loaded `save` and soldier ids (`who`, `merc`, `src`, `dest`, `target`) are
  the save's.
- **Seeding.** The engine is seeded from the clock at start, so an unseeded script draws differently on every run and
  must match on every run. `seed value=<n>` reseeds the `Random` engine; a save restores the `PreRandom` ring and its
  index, not the engine, so `pre=reseed` also refills the ring and resets its index. Scripts seed where a setup step's
  draws are not replayed (probe soldiers' random stats) or a fixed scenario is wanted. `draws on|off|dump` traces draws
  across commands (`dump` emits and clears the trace, used around `save` for the load-time recomputation).
- **Probe soldiers.** Without `who`, `path` and `los` create soldiers with `TacticalCreateSoldier` (no profile, default
  team `enemy`, body `regmale`) and remove them afterwards, so commands do not influence each other apart from the
  `Random()` state; creating them draws random stats, and `FindBestPath` draws skip-list levels, neither of which
  changes a result. They take the first free slot of their team (ids 0+ for `player`, 20+ for `enemy`), so in a loaded
  save they may get ids of dead or absent soldiers; the save's soldiers block paths, and the probe soldier's own
  structure is present during `soldierToSoldier`, as in the game.
- **Side effects undone.** `cth` and `bestshot` draw no random numbers and create no soldiers (the chance-to-get-through
  calls create and remove a fake bullet each); the soldier fields they and the engine change are restored before the
  next command and listed in `restored`, so they mix freely with other probes.

## Comparing with ja2-node

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
node tools/oracle/compare.ts ~/ja2-oracle/a9-costs.jsonl ~/ja2-oracle/a9-paths.jsonl ~/ja2-oracle/a9-los.jsonl
tools/oracle/compare-all.sh
```

`compare.ts` walks each output file in order with fresh comparers per file. A `sector` line loads that map (A9 when a
file has none); a `save` line imports the save into fresh ja2-node sessions (`14`; saves from `$JA2_SAVES_DIR` or
`SavedGames` next to the data folder); the comparer owning each following probe's command rebuilds it in that context.
Output: one line per probe plus a summary; exit status 1 on any mismatch or oracle error. Comparing needs the original
data and the saves, not the native build. `compare-all.sh` runs `compare.ts` over the outputs it lists ("Shipped
probes"); it is the `oracle` gate of `pnpm gates` (skipped without the work dir or `JA2_DATA_DIR`).

By default a comparer imports the save into a ja2-node campaign session in the tactical flow (`tactical-import.ts`: a
save made on the map screen, like `SaveGame01`, resumes there, so the comparer enters its loaded sector as a player
would; the native `save` command loads without entering a screen, and the natural healing of a squad's mercs, for one,
depends on the screen), applies the same commands and settings, replays
the native draws (both streams) and the traced `CheckFact` results strictly ("Draw replay") and compares the printed
state field by field after every command. The sections below give each comparer's commands and where it departs from
that.

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

### Tactical map and combat

`compare.ts` itself compares `costs` (the full movement cost table byte by byte, and its FNV-1a hash), `path` (length,
directions, the `PlotPath` AP cost; probe soldiers after `sector`, the save's soldiers after `save`), `los`, `soldier` and
`soldiers detail=1` (position, facing, animation, life, breath, AP, AP per turn, morale, alert, orders, visibility, last
target, effective stats, personality, opplist, inventory), `cth`, `bestshot`, `light` and `lights`.

- **`path`** with `team=player` paths with perceived door states, as the original does for the player; `estimate=1`
  sets `gfEstimatePath`, as `EstimatePlotPath` does for the AI.
- **`los`** reports the static `LineOfSightTest` with no soldier on the map and `SoldierToSoldierLineOfSightTest`
  between placed soldiers, which adds what the raw call leaves out: water stance overrides, camouflage, kid heights,
  tanks, the soldiers' own structures.
- **`cth`** prepares the shooter like ja2-node's attack estimate (the requested body part only when a soldier who is not
  prone stands on the target tile, else random; normal fire mode; the item in hand; the target's level) and reports the
  chance, AP cost and chance to get through for every aim level, for shooters of any team. It checks the formulas, not
  the cursor: the original UI takes the body part from the pixel under the mouse, keeps the soldier's own fire mode and
  hand, and with the default `show_hit_chance: false` shows only the AP cost; the real shot targets
  `gsInterfaceLevel`, uses `fModify = TRUE` and rolls a random body part first (`11`).
- **`bestshot`** runs `CalcBestShot` set up like the gun branch of `DecideActionBlack` (the first AI-usable gun swapped
  into the hand, a random body part unless `keepAim=1`). `CalcBestShot` reads the `bTargetLevel` left over from the
  soldier's last attack, which the probe reports. Not reproduced: `CanNPCAttack`, the `MinAPsToAttack` check before the
  call, and the rule that drops a player-team shot below 30 % chance to really hit.

### Lights

A bare `sector` load uses the clock of a fresh process (00:00, `gubEnvLightValue` 0, every tile shade 1). `hour=<h>` sets
the clock first, which decides which night and prime-time lights `LoadMapLights` powers; `ambient level=<n>` then renders
the lights at a useful ambient level. The `sector` line reports the structures whose height is already cached
(`ubStructureHeight`), because only those obstacles block light; after it the comparer reloads the map lights for that
hour and takes the oracle's ambient level and height cache. `lights` is compared tile by tile with the light sprites
(position, template, ON/PRIME/NIGHT flags; fake merc lights skipped).

`map-light-probes.ts [hour...]` writes, for every original map with light sprites, a load at each hour (default 22, 3
and 12: prime and night lights, night lights only, always-on lights only), a hash-only `lights`, `ambient level=15` and
a full `lights` dump. The sweep is not part of `compare-all.sh`:

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

Commands: `edgepoints [generate=1]`, `soldierexit`, `walkoff`, `walkin`, `mirror`, `exitcheck`, `move`, `initlist`,
`defence`, and `creatureplacement` and `bloodcatplacement` after a `sector`.

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

Commands: `stratcosts mask=…`, `stratpath from= to= mask= [tactical=1]`, `groups`.

`strategic-compare.ts` compares `stratcosts` (every traversability and edge time, on the shipped `strategic-*.json` after
`initStrategicLayerMap`, or on the imported save after `save`), `stratpath` (path, edge times, waypoints, next sector,
arrival, traverse time, ETA) and `groups` (the `importStrategicMap` result of the save against the whole dump; player
group ETAs only when every member is in the loaded sector, because encumbrance comes from the tactical soldier).

- After `save`, `stratcosts` shows the saved table: vanilla saves carry vanilla's, which differs from the shipped JSON on
  the I2/I3 border.
- `stratpath` plans on a scratch player group without members (no encumbrance, no `DelayEnemyGroupsIfPathsCross` side
  effects) and removes it with its events afterwards. The SHIFT ("shortest route") mode and the helicopter's airspace
  costs are not reachable from a probe.

### Strategic AI

Commands: `newgame difficulty= scifi=`, `sai` (the dump), `saievaluate [awake=1]`, `saicheck sector=`, `saiwake`,
`saiarrive count=`, `diffmod class=`.

`sai-compare.ts` replays the traced draws of every operation (`newgame`, `saievaluate`, `saicheck`, `saiwake`,
`saiarrive`, and the load-time recomputation between marks 101/102) strictly, then compares the following `sai` dump
field by field. `newgame` runs `initializeMapStructure`, `setupNewStrategicMap` and `initNewCampaignMap` with the AI hook
on a fresh state. A `save` imports time, map and AI without the load hooks; they run at the next `sai` with the native
mine income from that dump (the economy is not imported here). `diffmod` recomputes `calcDifficultyModifier` from the
imported state and the dumped mine income.

### Economy

Commands: `strategic` (towns, militia, mines, SAM sites, income), `mercs detail=strategic` (assignments and the
healing, repair and training estimates), `loyalty event=`, `assign`, `warp seconds=`.

`economy-compare.ts` imports each save (`importStrategicTime`, `importStrategicMap`, `importEconomy`, the crew from the
saved soldiers with `readSoldierAssignments`) and compares the dumps field by field. `loyalty` replays the event on the
same state, `assign` applies the same changes, `warp` runs `warpGameTime` through ja2-node's event dispatch with the
economy handlers (other events do nothing; the flow is tactical, as in the oracle, which never compresses time).

- After a `warp`, stat gains depend on the RNG (`StatChange` draws `PreRandom`), so the stat-derived estimates of `mercs`
  are not compared; everything else must match.
- A longer warp that completes a training session diverges by a few hundredths: the trainers' leadership rises in the
  oracle.

### Autoresolve

Commands: `arsetup` (militia, garrison and enemy groups of the battle sector, the encounter code, the day; with
`tacticalmilitia=1` the militia stand in the loaded sector), `autoresolve` (a headless Finish-mode battle with retreat
orders, a surrender answer and bandaging), `enemycounts`, `pbi`.

`autoresolve` dumps the cells right after `CreateAutoResolveInterface` and traces every draw, with marks between the
phases. Three comparers run on each probe:

1. **Core replay** (`autoresolve-compare.ts`): rebuilds the autoresolve state from the setup dump; replays the traced
   draws through `calculateAttackValues`, `runAutoresolve`, `endOfBattle`, `autoBandageMercs` and `closeAutoresolve`
   with streams that assert every requested range (cosmetic draws routed to `main` with `cosmeticOnMain`); applies the
   same retreat orders and surrender answer at the same slices; compares ratings, team sums, status, battle time, every
   cell, the time warp, militia counts and promotions after closing, and that no draw is left over. Creature attacks
   (`arsetup code=creature`) replay the `d` entries.
2. **Setup** (`autoresolve-creation.ts`), on a second session of the same save: applies the `arsetup`;
   `buildAutoresolveInput` creates the militia, enemy and creature soldiers with streams replaying the draws between the
   setup and ratings marks; every created soldier is compared with the dumped cell. No draw may be left over except the
   pathfinder's `Random(4)` and the preserved-soldier `PreRandom(2)` of the native world unload.
3. **Aftermath** (`autoresolve-aftermath.ts`), for every `autoresolve` after a `save`: imports the save into a campaign
   session and applies the `arsetup`; compares the counts and town loyalty before the battle; hands the replayed battle
   to the battle flow (`adoptAutoresolve`); sends the `bandage` and `done` answers through `dispatch` with the traced
   close draws; compares world seconds, enemy counts, militia, `fEnemyControlled` and town loyalty after the close, plus
   the enemy group id of every cell from a fresh `associateEnemiesWithStrategicGroups`.

`pre-battle-compare.ts` compares `pbi` (encounter code, flags, draws); `autoresolve-aftermath.ts` also compares
`enemycounts`. `battle.txt` checks the autoresolve quirks Q12, Q14, Q16 and Q22 of `19`.

The saves are on easy with 2–4 % progress, so the random-ambush branch (`PreRandom(100)` against the ambush chance) is not
reachable natively; only unit tests cover its arithmetic.

### Creatures

Commands: `options`, `setcontrol`, `tacticalflags`, `setcreatures`, `creatures` (the dump), `creaturequest`,
`creaturetrigger`, `creaturespread`, `creatureplanning`, `endcreaturequest`, `creatureattack` (stopped before the battle
opens, 0006), `creaturecomposition`; `creatureplacement` and `bloodcatplacement` after a `sector`. Each prints the
creature and attack globals, the creature counts of every sector and its draws.

`creature-compare.ts` imports the save (strategic map, economy, creature directives, meanwhile flag), replays each
operation through `src/sim/strategic/creatures/` (`d` entries as `Random(100)`) and compares the whole dump. The attack
globals are process state in the native build, so the comparer carries them across `save` lines. `sector-compare.ts`
compares the placements ("Sector transitions"). No save picks lair 2, so its attacks are not probed.

### Morale

Commands: `morale` (the dump), `setmorale`, `setrelation`, `setprofile`, `moralemove`, `moralecounter` (the strategic
decay counter, a function static that 0006 moves to file scope), `hourlymorale`, `quartermorale`.

`morale-compare.ts` applies the same changes and runs ja2-node's morale updates (`src/sim/campaign/team-morale.ts`).

### Merchants

Commands: `dealers` (the dump), `dealerinit`, `dealerdaily`, `progress`, `fact`, `options gunnut=`, `dealerprice`,
`dealersell`, `shophours` (an override of `GetArmsDealerShopHours`, 0008), `dealerrepair`, `skiptime`, `dealergive`,
`ski` (the repair delay and `InitializeShopKeeper` headless). Dealer ids are those of `dealers.json`; merchant commands
also run on a fresh process.

`merchant-compare.ts` keeps its own merchant state: a `save` imports the dealer section (with the save's facts,
progress, gun nut and clock); `dealerinit`, `dealerdaily`, `fact` and `ski` replay the native draws strictly (main and
`PreRandom` interleaved) and compare the dumps field by field; prices, repairs and sales compare directly.

### Contracts

Commands: `contracts`/`profiles` (the dumps: the contract state, every merc's contract fields with the expiry
predicates, `FindRefusalReason`, `WillMercRenew` and the checks behind them), `dailyupdate`, `relationshours`, `settime`,
`aboutleave`, `beginrenewal`, `renewalstep`, `setcontract`, `setstatus`, `setprofilecontract`, `extend`, `beginremove`,
`removemerc`, `leaveequip`, `equipleft`, `mercsite`, `levelup`, `salary`, `setrenewals`.

`contract-compare.ts` replays the traced draws through `ContractFlow.useRandom`.

### Creature AI

Commands: `addsoldier` (any body, with settings), `setsoldier`, `seen` (a personal or public opplist entry), `decide`
(`DecideAlertStatus`, then the creature, crow or general decision), `beststab`, `stab`, `creaturecall`, `smell`,
`dropsmell`, `trackscent`. The soldier commands print the full soldier dump plus the AI state.

`addsoldier` uses `TacticalCreateSoldier` with random stats, so seed the engine first. `decide` sets `gfTurnBasedAI`
from `INCOMBAT` and traces the draws; the pathfinder's draws between marks 301/302 are dropped.

`creature-ai-compare.ts` imports the save into a tactical session, builds each added soldier from the dump (stats,
inventory with status and flags, life, breath, AP, alert, orders, smells) at the dumped id and grid, and copies the dumped
state after every `setsoldier`/`seen`. `decide`, `beststab`, `stab`, `creaturecall` and `trackscent` replay the native
draws into `rng`/`pre` strictly and compare the result: action, action data, next action, alert, mobility, caller fields,
frenzy, old life, aim, movement mode, final destination, walk-to-attack cache, facing, AP, hand items, inventory flags.

### Laptop

Commands: `newgamefull` (after `seed`: the traced `InitNewGame` with every profile), `arrival`, `laptop` (the dump),
`setbalance`, `setfact`, `aimhire` (`CanMercBeHired` headless, then `AimMemberHireMerc`, 0010), `mercaccount`,
`merchire`, `mercpay`, `bobbyrestock`, `bobbyfresh`, `bobbyorder`, `bobbydeliver`, `insure`, `insuranceday`, `payout`,
`insurancestep`, `impcreate`, `flowers` (entering the order form, its price, sending, 0025). Laptop commands also run on
a fresh process.

`laptop-compare.ts` builds the new game through `buildNewCampaign` with the traced draws in the state's streams (the
`InitFace` triples of the preloaded NPC faces dropped), or opens a campaign session of the save and applies the same
command through the laptop modules with `LaptopFlow.useRandom` (hire probes drop the face and first-frame draws). It
compares the whole dump; `newgamefull` and the save probes also compare every profile's sector (`InitNPCs`, the
terrorists). The Bobby Ray theft counter is a function static in the original, so the comparer carries it across the
saves of one file. `flowers` replays `visitSite floristOrderForm` and `orderFlowers` with the traced draws and compares
the order number (before, after entering, after sending), the price and the laptop dump.

### Doors

Commands: `locks`, `door` (`HandleOpenableStruct` for an action with the door, soldier and inventory set up), `doormenu`
(`DoTrapCheckOnStartingMenu`, 0011), `civgroups`, `makecivhostile`, `pcattack`, `hostilelist`.

`doors-compare.ts` replays the `PreRandom` draws strictly and matches `Random` draws in order, native cosmetic extras
skipped. Not compared: the AP of a menu action stopped by the trap check (the native cost reads past `doorAPs`, "Trap
check cost of menu actions").

### Attachment AP

`attachbox` drives the original item description box: it writes the host object into a pocket, puts the cursor item into
`gItemPointer`, opens the box with `InitItemDescriptionBox`, then runs its steps, each either a click on attachment slot
N through the region's own callback (attach with an item in the cursor, detach into the cursor without one) or a new
cursor item; `DeleteItemDescriptionBox` closes the box. It prints the AP of both soldiers and the attachments before,
after each step and after closing.

`attach-compare.ts` replays each line on a fresh campaign session of the save with the commands a player sends (`attach`
from a pocket holding the cursor item, `detach` into a pocket) and checks the attachments, the host, the native box rule
(one `AP_RELOAD_GUN` for `gpAttachSoldier` when the box closes in combat with changed attachments) and ja2-node's rule
(one `AP_RELOAD_GUN` per accepted command that changes them, "Attachment AP" in `deviations.md`); a line with a single
changing command must give the same AP on both sides.

### Facts and NPC presence

Commands: `narrative` (the dump: facts, quests, boxing globals, and the presence fields of the selected profiles),
`setquest`, `setnpcprofile`, `checkfact` (the talk context, then `CheckFact` for one id or all 500), `quest`,
`earlymorning`, `hourlynpc` (0012), `questentry`, `questexit`, `entersector`.

`facts-compare.ts` applies each command through the narrative modules; `checkfact` compares the 500 results. Fact 284
(`FACT_PC_HAS_CONRADS_RECRUIT_OPINION`, computed through `CalcDesireToTalk`) is masked in every fact comparison of this
comparer (`UNKNOWN_INPUT_FACTS`). `entersector` compares the sorted profiles of the active soldiers, those away by
schedule included as in `FOR_EACH_SOLDIER` (`setCurrentWorldSector` bypassing the merc check, as the native call does).
The talk context outlives a save load in the original, so every `checkfact` sets it.

### Talk

Commands: `npcrecords`, `npcprofile`, `desire` (`CalcDesireToTalk`, `CalcThreateningEffectiveness`), `consider`
(`NPCConsiderTalking`), `talk` (a headless talk panel and `ConverseFull` without draining the queue, 0013),
`questdecode`. `merc` is a soldier id of the save, whose profile is the talker.

`talk-compare.ts` imports the save with NPC records, replays the native `CheckFact` results and the `Random` draws, runs
`converseFull` on the same headless panel and compares the queue, facts, quests, flags, the engaged state and the
profile. `questdecode` gives an offset of −512 and 0 for every quest-100/200 read (deviations "Quest 100 and 200 in
records").

### Give

Commands: `receive` (`NPCConsiderReceivingItemFromMerc` as a dry run), `give` (the object the UI hands over, then
`SoldierGiveItemFromAnimation` with the conversation it opens running headless, 0017), `npcgive`
(`HandleNPCItemGiven`), `actionitem` (an armed action item or pressure switch set off on a soldier's tile). Each takes a
setup of facts, quests, balance, NPC data and hospital globals and prints what it applied.

`give-compare.ts` applies the same setup, replays the native `CheckFact` results, `CalcMedicalCost` values (0017) and
draws, and runs `npcConsiderReceivingItemFromMerc`, `giveItemOpcode` with the narrative port pointed at the replay,
`handleNpcItemGiven` and the action item queue. For a give to a dealer whose shop opens, it first applies the original's
`RemoveObjFrom` to the giver's pocket ("Giving to a dealer" in `deviations.md`).

### Civilians

Commands: `civset` (soldier, loyalty, combat, fact, quest, hostile-list and AI-pause changes on both sides), `civquote`
(`StartCivQuote` with the box suppressed, 0020), `namednpc`, `initiating`, `pcsnear`, `firstaid`, `friendhostile`,
`hostilecheck`, `surrender` (the surrender condition of `DecideActionBlack`), `surrenderanswer`.

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
(`SetUpHelicopterForPlayer`). Commands: `heli` (the dump), `heliset`, `helisetup`, `heliboard`, `helileave`,
`heliroute`, `helicancel`, `heliwarp`, `helimonologue`, `helipaydebt`, `helireturn`. Skyrider's quotes are recorded
instead of queued (0014). The probes set `fShowAircraftFlag`, as the map screen does when plotting for the helicopter.

`heli-compare.ts` replays `PreRandom` strictly (SAM fire, scouting) and matches `Random` in order with the native extras
skipped (other systems' events during the warps, the cosmetic "enemies spotted" quote pick). The "enemies spotted" quotes
34 and 35 are compared as one. A merc's insertion code and data are compared only outside the loaded tactical sector:
the original rewrites them on every tile step (`SetSoldierGridNo`), ja2-node keeps them in the roster.

### NPC actions

Commands: `npcaction` (`HandleNPCDoAction` with a headless talk context, the queue not drained), `npcbox` (a requestor
answered through `DialogueMessageBoxCallBack`, 0015), `npcevent`, `kingpinmoney`, `hospitalsupplies`, `medicalcost`,
`npcset`. `dest` defaults to the NPC's soldier; `panel=1` sets `gfInTalkPanel`.

`actions-compare.ts` sets the same headless talk context and runs the catalog (`handleNpcDoAction`), `answerNpcRequest`,
`npcSystemEvent`, `kingpinMoneyCheck` and `hospitalSuppliesCheck`; `npcset` writes both sides. The `InitFace` draws of a
panel opened by action 232 are dropped from the native trace.

### Schedules

Commands: `schedules` (the dump), `schedload` (loads its save itself, `PostSchedules` traced), `schedentry`
(`SetCurrentWorldSector` traced, with the 24-hour replay), `schedclock`, `schedwarp`, `schedprocess`, `scheddecide`
(`DecideActionSchedule`, 0016), `schedmove`, `schedshophours`.

`schedules-compare.ts` replays the draws between marks 2001/2000 (pathfinder draws left out): on `schedentry` through
`SectorFlow.postSchedulesOfLoadedSector`, on `schedload` after undoing the session's own post-load posting (saved
schedules, soldier schedule ids, the events added after the saved ones). Not compared: body and life (the civilians'
creation draws are not replayed) and a decision's data when it returns no action (stale fields). Sector entries come
right after a load: the 04:00 event moves NPCs with draws that warps do not replay, and the temp files of other sectors
are not imported from native saves.

### Recruiting

Commands: `addnpc` (a profiled civilian), `recruitset`, `recruit` (`HandleNPCDoAction` for the recruiting, escorting,
marriage and becoming-enemy actions; an escort box answered yes), `unescort` (in tactical or on the map screen; 0018
defers the removal so the probe runs it in the queue's order), `robotcontrol`. `src`/`dest` as for `npcaction`.

`recruit-compare.ts` reserves the slots of the save's off-map civilians (away slots of the schedules), leaves the face
draws of a new merc and the pathfinder's draws out of the replay, and runs the catalog, the escort answer,
`RecruitFlow.internalUnescortEpc`/`removeEpc` or the wrong-sector trigger.

### Meanwhile

Commands: `meanwhiles` (the dump), `meanwhilepost kind=…` (each posting function), `firstbattle`, `trashworld`,
`meanwhilerun` (the first `EVENT_MEANWHILE` executed, a scene that begins skipped through `BeginMeanwhileCallBack`),
`meanwhileplayed`, `hourlyprogress`, `capture`, `queendead`; after a `sector O3`, `statue mode=remote|explosion`.

In `meanwhile-compare.ts` the first `meanwhiles` after a load copies the pause state and the last scheduled id into the
session: native loads keep the saved pause (ja2-node save sessions resume unpaused), and the last scheduled id is a static
that survives loads. A `begun` scene is skipped the native way (trying flag cleared, implications, unlock, unpause). The
statue probes run on a fresh O3 world per `sector` line and compare the statue tiles only.

### Boxing

No save stands in San Mona, so every block starts with `boxingsquad`: the listed mercs and their groups move to D5 with
grid insertion, the club is loaded with `SetCurrentWorldSector`, the game is unpaused and the moved mercs get
`CalcActionPoints` (ja2-node recomputes APs on insertion, the original keeps the old ones; the probe normalises both).
Soldier ids are those of the loaded club. Commands: `boxing` (the dump), `boxingset`, `boxingfacts`, `boxingstart`,
`boxingstep`, `boxingattack`, `boxingend`, `boxinggetup`, `boxingexit`, `boxingrecord`, `boxingdecide`, `boxingpoints`.

`boxing-compare.ts` repeats the setup and runs the same functions, with the pathfinder's draws and the music picks
dropped from the replay. Accepted differences:

- A probe that ends combat also gets the forced real-time turn the original runs inside `ExitCombatMode` ("Real-time turn
  after combat" in `deviations.md`).
- The civilians' gridnos are compared only on the boxer tiles: their schedules place them with draws the setup does not
  replay.
- A decision's data is compared only when it decides an action.

## Shipped probes

`compare-all.sh` lists the outputs it compares, relative to the work dir. `probes/<name>.txt` writes
`<name>/<name>.jsonl`, except `a9-*.txt`, `sectors.txt`, `strategic.txt` and `economy.txt` (`<name>.jsonl` at the top),
`sai-*.txt` (`sai/newgame.jsonl`, `sai/saves.jsonl`), `autoresolve-*.txt` (`ar/d13.jsonl`, `ar/capture.jsonl`) and the
creature scripts (`creatures/creatures.jsonl`, `battles.jsonl`, `placement.jsonl`, `creature-ai.jsonl`); `save-probes.ts`
writes `save-probes/all-saves.jsonl` ("Savegames"). Produce one with `mkdir -p` on its directory and
`tools/oracle/run.sh tools/oracle/probes/<script> "$JA2_ORACLE_DIR/<output>"`.

- `ar/stress.jsonl` and `ar/smoke.jsonl` come from work-dir scripts with no generator in the repository (30 random
  battles over SaveGame01, 02, 07, 09 and 10 with militia, garrisons, codes, retreats and both `pre` modes; the first
  battle of `autoresolve-d13.txt`); `compare-all.sh` requires them.
- `attach` and `florist` are optional: `compare-all.sh` skips them with a hint when missing.
- **Saves.** The shipped scripts name the maintainer's six saves (`SaveGame01`, `02`, `07`, `08`, `09`, `10`; sectors
  B13, C13, D13) on the English JA2 Gold 1.12 data (Steam): `SaveGame07` and `08` were saved in turn-based combat in
  D13, `SaveGame10` in D13 in real time; `09` and `10` are the sci-fi saves; all are on easy with 2–4 % progress. Other
  saves need other scripts (`save-probes.ts` writes one for any saves).

## Hooks

`patches/*.patch` apply in file-name order, paths under `src/` of the Stracciatella copy; each starts with header lines
saying what it adds and after which patch it applies. The rule for every hook: code that "moves into" a function stays
the same code at the same call site, and switches and wrappers do nothing in the game unless the oracle sets them, so
the patched build plays like the reference. "What is probed" names the patches each domain needs.

**Adding a probe.** Add a branch to `Dispatch` in `src/Oracle.cc`, editing it here in the repository, not in the copy
(`build.sh` overwrites the copy); everything outside the hooks is plain engine API. On the ja2-node side, add the
command to a comparer's `*_PROBES` set, or register a new comparer in the per-file loop of `compare.ts` (and in its
`save` handling if it imports saves): a probe line no comparer claims is skipped without a word. A new script goes to
`probes/`, its output into `PROBES` of `compare-all.sh`, its domain into "What is probed".

**Changing a hook.** Edit the files in `$JA2_ORACLE_DIR/src`, rebuild with `cmake --build ~/ja2-oracle/build`, then
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

# Native oracle (JA2 Stracciatella probe build)

A patched JA2 Stracciatella build that runs headless against the original game data, executes a
probe script and prints JSON lines. It gives reference values for our reimplementation
(`docs/01-architecture.md` §8, level 6). The first probes cover pathfinding, line of sight and the
movement cost table.

Nothing in this directory contains or produces game data by itself. Probe **outputs** are derived from
the original data: keep them outside the repository (the default work dir is `~/ja2-oracle`) and never
commit them.

## Layout

| Path | What |
|---|---|
| `build.sh` | Copies `reference/stracciatella` to the work dir, adds `src/`, applies `patches/`, builds |
| `run.sh` | Runs one probe script headless and prints JSONL (or writes it to a file) |
| `src/Oracle.{h,cc}` | The probe harness, copied into `src/game/` of the Stracciatella copy |
| `patches/0001-oracle-hooks.patch` | The only changes to Stracciatella files (see "Hooks") |
| `probes/a9-*.txt` | Probe scripts for sector A9 (Omerta) |

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
| `sector A9` | `z=0`, `map=<file>` | Sets `gWorldSector` and calls `LoadWorld` on the sector's map |
| `save SaveGame01` | | `LoadSavedGame` from the isolated home's `SavedGames` |
| `soldiers` | | Lists soldiers in the loaded sector |
| `costs` | `format=base64` (or `none`) | Dumps `gubWorldMovementCosts` |
| `path` | see below | `FindBestPath` + `PlotPath` |
| `los` | see below | `LineOfSightTest` and `SoldierToSoldierLineOfSightTest` |

`sector` is a bare map load: `LoadWorld` compiles movement costs, builds structures, rooms and
buildings, but there is no strategic layer, no enemy or NPC placement, no `PrepareLoadedSector`,
and doors keep their map state. `save` runs the full `LoadSavedGame` (strategic state, the sector's
temp files, soldiers, door states), so probes then see the world as it was saved. All six saves in
the user's `SavedGames` load (B13, C13, D13).

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

## Shipped probes

| Script | Content |
|---|---|
| `probes/a9-paths.txt` | Open ground in all four movement modes, around and into buildings through doors (enemy and player), a fence crossing walking and crawling, three long paths (49–101 steps), a roof path, an unreachable destination |
| `probes/a9-los.txt` | Open ground, sight limit cut-off, stance combinations, blocked by buildings, across a fence, roof to ground and ground to roof, lines through trees with stand/crouch/prone targets |
| `probes/a9-costs.txt` | The full movement cost table of A9 |

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

## Notes

- Probe soldiers consume `Random()` (stats in `RandomizeNewSoldierStats`, `TacticalCreateSoldier`),
  and `FindBestPath` draws skip-list levels from `Random()`. None of it changes probe results.
- Probe soldiers take the first free slot of their team (ids 0+ for `player`, 20+ for `enemy`), so
  in a loaded save they may get ids of dead or absent soldiers. Existing soldiers in a save do block
  paths and the probe soldier's own structure is present during `soldierToSoldier`, as in the game.
- Each `path`/`los` command removes the soldiers it created, so commands do not influence each
  other (apart from the `Random()` state).

# Native oracle (JA2 Stracciatella probe build)

A patched JA2 Stracciatella build that runs headless against the original game data, executes a
probe script and prints JSON lines. It gives reference values for our reimplementation
(`docs/01-architecture.md` §8, level 6). The probes cover pathfinding, line of sight, the movement
cost table, and the state of loaded saves: full soldier dumps, the chance to hit and AP cost of an aimed
shot, and the AI's choice of the best shot.

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
| `save-probes.ts` | Writes a probe script for the user's native saves (see "Savegames") |
| `compare.ts` | Rebuilds probe outputs with ja2-node and reports mismatches |

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
| `soldiers` | `detail=0\|1` | Lists soldiers in the loaded sector; `detail=1` dumps each one like `soldier` |
| `soldier` | `who=<id>` | Full dump of one soldier of the loaded save |
| `costs` | `format=base64` (or `none`) | Dumps `gubWorldMovementCosts` |
| `path` | see below | `FindBestPath` + `PlotPath` |
| `los` | see below | `LineOfSightTest` and `SoldierToSoldierLineOfSightTest` |
| `cth` | see below | `CalcChanceToHitGun` + `CalcTotalAPsToAttack` for an aimed shot, as the attack cursor prepares it |
| `bestshot` | `who=<id>`, `keepAim=0\|1` | The AI's `CalcBestShot` on a soldier of the loaded save |
| `light` | `g=<g>`, `level=0`, `viewer=<id>` | `LightTrueLevel` of a tile, the ambient level and, with a viewer, `DistanceVisible` to it |

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
- `light`: ambient, true level and distance visible (ja2-node has no light sprites yet, so lit tiles differ).

On 2026-10-15 all three shipped A9 scripts matched exactly.

### Savegames

`save-probes.ts` writes a probe script for any saves: a soldier dump, `cth` (torso, head, legs) and `bestshot` for
every armed soldier of the player, enemy and militia teams against every opposed soldier, `los` for every opposed pair,
and `path` from each fighter to each opposed fighter and twelve tiles out in eight directions, then a second dump.

```sh
export JA2_DATA_DIR="$HOME/Jagged Alliance 2 Gold/Data"
node tools/oracle/save-probes.ts SaveGame01 SaveGame07 SaveGame10 > ~/ja2-oracle/save-probes/saves.txt
tools/oracle/run.sh ~/ja2-oracle/save-probes/saves.txt ~/ja2-oracle/save-probes/saves.jsonl
node tools/oracle/compare.ts ~/ja2-oracle/save-probes/saves.jsonl
```

On 2026-10-15 the six saves gave 1,665 commands and 6,075 comparisons, all matching.

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
- `cth` and `bestshot` draw no random numbers and create no soldiers; the chance-to-get-through calls
  create and remove a fake bullet each.

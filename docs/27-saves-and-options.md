# 27 — Saves and options

**Conventions.** Paths without a prefix are relative to `reference/stracciatella/src/game/`; `src/sgp/…`,
`src/externalized/…` and `rust/…` are relative to `reference/stracciatella/`; `V:` is vanilla `Build/`. ja2-node paths
start with `src/`, `data/`, `tools/` or `tests/` and are relative to the repository. "(inferred)" marks conclusions not
traced end to end.

**Scope.** ja2-node's own saves (`src/sim/snapshot/`, `src/server/save-*.ts`, `input-log.ts`, `replay.ts`,
`content-identity.ts`, `session-snapshot.ts`), game options and client settings (`src/sim/options.ts`,
`src/ui/settings.ts`). Siblings: `31` (sound, music, video, localization), `32` (stub pack, performance, launcher, data
tables). Elsewhere: `01` D6 and `01` §3.6 (random streams), `04` §5.5, `04` §5.10, `29` §26 and `29` §27 (the
server's saves, the rule pack identity, the agent API), `14` (native saves), `15` and `35` (clock and schedules
in saves), `30` §1.4 and `30` §1.5 (the canvas options and save/load screens), `deviations.md`.

| § | Topic | Core decision |
|---|---|---|
| 1 | Saves | A JSON snapshot of the whole session with a codec in `sim`, exact restore, bound to the game data, an input log for replay; Stracciatella's named saves, quick save, end-of-turn autosave, Iron Man and Dead is Dead; a player load reseeds `main` |
| 2 | Options | Game options are session state; blood and gore is the only one that changes during a game, through a logged command; the game policy is engine content; every other toggle is a client setting; timed turns are not ported |

---

## 1. Saves

### 1.1 The original

| | Vanilla (`V:`) | Stracciatella |
|---|---|---|
| Layout | 11 fixed slots (`V:SaveLoadScreen.h:6`): slot 0 the quick save, 1–10 the player's | a scrolling list of every `*.sav` in the save folder, 11 rows on screen (`SaveLoadScreen.cc:54`, `:753-794`), newest first (`:747-751`); unreadable headers skipped (`:767-769`), incompatible versions listed |
| Quick save | `QuickSave.sav` (`V:SaveLoadGame.c:3334-3373`) | `QuickSave.sav`, description "QuickSave" (`SaveLoadGame.cc:126-132`, `SaveLoadScreen.cc:1328`) |
| Autosave | `Auto%02d.sav`, two files alternating (`V:SaveLoadGame.c:3355-3366`) | `Auto01`/`Auto02`, the older or missing one overwritten (`GetNextIndexForAutoSave`, `SaveLoadGame.cc:2411-2448`); description = name |
| Player save | `SaveGame%02d.sav` | UTC timestamp + slugged description (`SaveLoadScreen.cc:680-685`, `rust/stracciatella/src/fs.rs:248-250`); in save mode the list hides quick and auto saves and starts with "create new savegame" (`SaveLoadScreen.cc:782-793`) |
| Error save | `SaveGame99.sav` (CD error, `V:GameSettings.c:414`) | `Error.sav` when an exception escapes the game loop (`GameLoop.cc:243-249`) |
| Folder | `..\SavedGames` relative to the working directory | `<home>/.ja2/SavedGames` or `ja2.json` `save_game_dir` (`rust/stracciatella/src/config/engine_options.rs:9`, `:147-172`; `rust/stracciatella/src/config/stracciatella_home.rs:4-30`) |

A row shows day and time, the sector ("N/A" before the start time), the merc count, the balance and the description,
plus a skull for Dead is Dead saves; in load mode a tooltip lists difficulty, save mode, weapons, style and mods
(`SaveLoadScreen.cc:874-957`). The header (`SaveLoadGame.h:24-60`, 432 bytes, `14`) fills the rows without reading
the body. A description holds at most 46 characters (`SaveLoadScreen.cc:1054-1057`). Overwriting asks for
confirmation (`:699-704`); Delete deletes after confirmation (`:653-662`, `:1277-1293`); loading a save of another
version, build or mod set asks once with all reasons (`:707-731`, `:1132-1158`); a load failure shows an error and
restarts to the main menu (`:1200-1205`, `:1296-1317`). The main menu disables Load when no save exists
(`MainMenuScreen.cc:233`); Alt+Load or Alt+C loads `gSavedGamesList[bLastSavedGameSlot]` at once (`:268`, `:286-289`,
`SaveLoadScreen.cc:378-391`), an index Stracciatella only ever sets to 0 (`:1481`), so in practice the newest save
(inferred).

**Keys.** Tactical: Alt+S quick save (refused in a battle-locked map interface, in a conversation and by
`CanGameBeSaved`, `Tactical/Turn_Based_Input.cc:1946-1960`), Alt+L quick load (`:1914-1920`), Ctrl+S/Ctrl+L the save
and load screens (`:1821-1841`, `:2177`). Map screen: the same keys (`Strategic/MapScreen.cc:2945-3021`), gated by
`AllowedToExitFromMapscreenTo` (`Strategic/Map_Screen_Interface_Bottom.cc:987-1070`: dialogue queue not empty, meanwhile
trying to start, locked pause, an item on the cursor, popups open, the contract renewal sequence, the battle roster, the
sector inventory). The options screen has Save and Load buttons; Save is disabled when the options were opened from the
main menu, by `CanGameBeSaved` and in Dead is Dead (`Options_Screen.cc:266-269`).

**Save modes** (`GameSettings.h:85-90`, chosen at a new game, `GameInitOptionsScreen.cc:719`; vanilla has only
`fIronManMode`, `V:GameSettings.h:91`):

- *Save anywhere* (`DIF_CAN_SAVE`, the default, `GameSettings.cc:186`): `CanGameBeSaved` always true.
- *Iron Man*: `CanGameBeSaved` (`GameSettings.cc:233-259`) is false while `INCOMBAT` is set or the loaded sector holds
  enemies (`NumEnemiesInAnySector(gWorldSector) > 0`). Loading is not restricted.
- *Dead is Dead*: the player names the one save file before the intro (`GameInitOptionsScreen.cc:751-763`,
  `SaveLoadScreen.cc:1477-1484`); every quick save and autosave goes to it (`:1322-1346`); the Save screen and
  Ctrl+S/Ctrl+L are refused (`Tactical/Turn_Based_Input.cc:1821-1841`, `:2177`,
  `Strategic/Map_Screen_Interface_Bottom.cc:961-975`). `DoDeadIsDeadSave` (`SaveLoadScreen.cc:1363-1405`) writes only on
  our team's turn, outside the talk panel, meanwhile, the PBI, a message box and a locked UI, after keeping two backups
  (`SaveLoadGame.cc:1515-1542`). It runs at the start of our turn and at `EndTurn` (`Tactical/TeamTurns.cc:154`,
  `:188`), at `BeginMeanwhile` (`Strategic/Meanwhile.cc:206`), when a group is about to arrive
  (`Strategic/Map_Screen_Interface.cc:1231`), on quit to the menu and on program exit (`Options_Screen.cc:683`,
  `src/sgp/SGP.cc:101`) and before loading another save (`SaveLoadGame.cc:646-654`). Quick load and the options screen's
  Load are not blocked (inferred from the missing checks). The refusal message index is out of the string table's bounds
  (`Utils/Text.h:1327` against `src/externalized/strings/Localization.h:175`), a Stracciatella bug.

**Autosave.** One rule: `UIHandleEndTurn`, when the player ends a turn in turn-based combat and combat does not end
right there, calls `DoAutoSave` if `CanGameBeSaved()` (`Tactical/Handle_UI.cc:1066-1084`; reached from the D key, the
Done button, the turn time limit and `gfBeginEndTurn`). No option controls it (`GameSettings.h:9-54` has none) and no
message is shown (`SaveLoadGame.cc:524`). Vanilla also required a hidden file `AutoSave.pls`
(`V:Tactical/HandleUI.c:1522`), so it never autosaved in a normal install. Neither version autosaves daily or on sector
entry.

**`SaveGame`** (`SaveLoadGame.cc:269-539`): pauses; sets `LOADING_SAVED_GAME`; first writes the current sector into its
temp files (`SaveCurrentSectorsInformationToTempItemFile`, `:325`); fills the header, including `header.uiRandom =
Random(RAND_MAX)` (`:380`, a gameplay draw caused by saving); writes the body sections (`14`) and the game-states JSON
block (`SaveLoadGameStates.cc`: mods list, `StrategicStatus::alreadyDroppedWeapons`, script keys); moves the file from
the temp folder into place; on failure shows an error and deletes the temp file (`:494-512`). Version 105
(`GameVersion.h:20`; vanilla 99).

**`LoadSavedGame`** (`SaveLoadGame.cc:644-1198`): trashes the world and every runtime list, reads the sections, runs the
load hooks (`InitAI`, `UpdateMercsInSector`, `PostSchedules`, lighting, `14`), resets the attack-busy count
(`:1097-1101`), checks for ambushes (`:1195`) and returns to the saved screen (`LoadGeneralInfo`, `:1961-1962`). **The
random generator is not reseeded on load**: Stracciatella seeds mt19937 once at start-up (`src/sgp/SGP.cc:433`,
`src/sgp/Random.cc:39-59`) and does not save its state; only the `PreRandom` table and index are saved
(`SaveLoadGame.cc:2110-2127`). A reload therefore repeats the next `PreRandom` values until they are consumed (each use
is refilled from the engine, `src/sgp/Random.cc:24-28`; vanilla never refills, `V:SGP/Random.c:62-65`), while `Random`
continues from the running process's state: effectively a fresh stream (inferred; this is the "reseed" of `01` §3.6).

**Settings file** `Ja2.set` (`GameSettings.cc:27`, `:111-130`, in the user's home): volumes, the option toggles, the
last slot, the meanwhile scenes seen, help flags, two display sizes; written after every save and load
(`SaveLoadGame.cc:521`, `:1075`). The current save name is runtime only.

### 1.2 Snapshot contract

1. **Saving has no effect**: no draw, recomputation or flag change (also the rule of `15` and `35`). The
   original's save-time `Random(RAND_MAX)` and its temp-file write of the loaded sector are not reproduced (deviations
   "Save side effects"). Before a campaign snapshot the campaign's undrained output events move into a buffer of the
   server `Session`, which the next advance reports first; the tactical event buffer (`TacticalState.events`) is plain
   state and is written.
2. **Restore is exact.** For any inputs `I`, `continue(S, I)` and `continue(restore(snapshot(S)), I)` produce the same
   event log and the same final snapshot, byte for byte ("load + replay = same outcome").
3. **Versioned.** Every file carries a format version; older files go through migration chains on the plain JSON (§1.3).
4. **Content-bound.** A snapshot is valid only with the game data it was made with (§1.4).

**Save points** lie only between inputs: the server is single-threaded, so a save lands between two commands or two
real-time batches, and an `advance` stops between ticks, never inside one.

**Why a codec.** The tactical layer is an object graph of soldier, item, bullet, light and structure pointers, so
`01` D7's "ids instead of pointers" does not hold there. Weighed: a codec that encodes and re-links pointers, with all
private session state moved into the state objects (built); the tactical layer refactored to ids everywhere (cleaner, but
it touches every combat and AI module); replay-only saves (rejected: load time grows with the campaign and any code
change breaks old saves).

**Deliberately nondeterministic:** the wall-clock `savedAt` (presentation), the entropy seed of a player load (logged,
§1.5), the timing of browser input (logged as tick counts, §1.7).

### 1.3 The save file

One `<name>.j2s` per save (`src/server/save-file.ts`), a gzip of one JSON document:

```ts
interface SaveFile {
  format: 'ja2-node-save';
  version: 2;                              // SAVE_VERSION
  header: {
    kind: 'player' | 'quick' | 'auto' | 'deadIsDead';
    description: string;                   // at most 46 characters, newlines and tabs collapsed (clampDescription)
    savedAt: string;                       // server wall clock (ISO), presentation only
    engine: { version: string; commit: string };
    content: { source: 'original' | 'stubs'; dataVersion: string; logic: string; text: string };   // §1.4
    options: GameOptions;                  // §2.2
    world: { day: number; hour: number; minute: number } | null;    // null for the sandbox
    sector: string | null;                 // sector code (`A9`, `B13-1`)
    flow: string;                          // the strategic flow, or meanwhile, endgame, ended
    mercs: number; balance: number;
    campaign: 'playing' | 'endgame' | 'won';
    session: 'campaign' | 'imported' | 'sandbox';
    tick: number;
  };
  session: { kind; origin: string; tick: number; preparedMaps: string[] };   // origin: a description of the log origin
  sim: SimSnapshot;                        // src/sim/snapshot, §1.8
  presentation: { music: { mode; previous }; messages?: MessageEntry[]; campaign?: string };
  legacyContent?: { files: [path, 'f' | 'm' | 'p'][] };              // version 1 files only, §1.4
}
```

- **Two gzip members** at the fastest level (`Z_BEST_SPEED`): the first holds `{"format", "version", "header",` and a
  newline, the second the rest. The file stays one JSON document for `gunzip`; the list reads the header from the first
  64 KiB with a sync flush (also from a file gzipped again as one member). The header repeats what the list shows, the
  original's reason for its header. Inflated text is capped at 512 MiB. A save's digest = the SHA-256 of its
  decompressed text; it identifies the save as a log origin (§1.7).
- **`preparedMaps`**: the world cache's prepared paths in order. A step may load a sector and the `WorldCache` is
  history-dependent, so a restore prepares the same maps before building the session.
- **`presentation`** is never read by `sim`: the music mode and the previous mode (`31`); the session's message
  log (`src/protocol/message-log.ts`), so a load shows the same lines; the campaign identity, a random id a new campaign
  gets and keeps through saves (an older save gets one from its digest, a native import from the file's digest, a
  sandbox none; `src/server/campaign-id.ts`), by which the client keys per-campaign UI state (the help screens seen,
  `29` §24).
- **Versions.** `migrateSaveFile` runs `SAVE_MIGRATIONS` (1 → 2: the file list `contentFiles` moves to
  `legacyContent`) before the snapshot's own `migrateSnapshot` (`SNAPSHOT_VERSION` 11, `snapshotMigrations` in
  `src/sim/snapshot/migrations.ts`, one function per step: 1 the unified game options, 2 sprite frames → presentation
  timeline slots (needs the animation timelines, `snapshotMigrationContext`), 3 soldier and turn presentation state,
  4 the laptop's new-mail flag, 5 battles fought, 6 the heard-noise pause, 7 the turn quote flags, 8 stale muzzle
  flashes put out, 9 the blood graphics, 10 the opplist decay stamp in world seconds, due at the next real-time turn).
  Problems: `notASave`, `versionTooNew`, `noMigration`, `corrupt`. **Rule:** a change of the state's shape bumps
  `SNAPSHOT_VERSION` and adds a migration. `src/server/fixtures/` holds a landed campaign and a sandbox saved by 0.7.0
  on the stub pack with the soldiers they showed; `legacy-save.test.ts` loads them, expects the same soldiers 400 ticks
  later and re-saves them.
- **Size.** A landed stub squad ≈ 2 MiB of JSON (40 KiB gzipped), the largest original-data import ≈ 4 MiB (150 KiB),
  mostly merchant inventories, the base64 cost table, the structure lists and the tactical typed arrays.

### 1.4 Content identity

`header.content` binds a save to the game data; the repository's own files are versioned with the engine
(`header.engine`).

- **`logic`** = the rule pack's identity hash (`04` §5.10, `isIdentityLayer` in `src/content/rules/pack.ts`) over the
  pack entries of the game data only (on `original` the data folder and the SLF archives, voice lengths included; on
  `stubs` the stub pack); not the project tables (`ja2-node-data`: `tables/**`, `externalized/**`) nor, on the original
  data, the stub pack. The pack covers every file the simulation can read, so the hash is known before any session
  exists (`welcome` carries it).
- **`text`** (`quoteLengthIdentity`, `src/server/content-identity.ts`) hashes the character count of every row of every
  dialogue file in use, at the dialogue width or the civilian-quote width; `none` for the sandbox. Quote lengths are the
  only way text reaches the simulation (`24`).
- **`engine`** (`engineIdentity`): the package version and the commit (`JA2_COMMIT`, else `git rev-parse HEAD`, else
  `unknown`).
- **Load check, in order** (`SaveService.#verify`, then after the restore): another `source` → refused
  (`contentMismatch`); another `logic` hash → refused on the original data (`contentMismatch`), loaded with the warning
  `stubPackDiffers` on the stubs (the repository generates the stub pack and changes it during development); another
  `dataVersion` → warning `dataVersionDiffers`; another engine version or commit → warning `engineDiffers` (covers the
  project tables, the game policy among them, §2.3); after the restore, another `text` hash adds `dataVersionDiffers`.
  `listSaves` predicts `contentMismatch` and `stubPackDiffers` from a version 2 header alone. Why refuse: a ja2-node
  save is the simulation's own state and cannot be rebuilt on other logic data; text only changes speech timings
  (deviations "Save compatibility").
- **Accepted logic hashes**: the pack's scoped hash and its `allLayersHash` (the older identity `ja2-node-rules 1` over
  every entry, which also names the pack's cache directory), so a save carrying the all-layers hash loads while nothing
  in the pack changed; a re-save writes the scoped hash.
- **Version 1 saves** (0.7.0) list the files they read (`legacyContent.files`: path and state `f` file, `m` missing, `p`
  present by probe; `.edt` files count by presence only). `ContentLedger.matchesSaved` first recomputes the 0.7.0 hash
  over these paths from the raw data (the lists include STI files the logic loaders read then, so this needs the VFS,
  not the pack). If that differs, it recomputes with the entries outside the identity layers taken as saved: presence
  lines as listed, files of `ja2-node-data` from the repository's history at the save's engine commit
  (`src/server/repository-history.ts`, `git cat-file`, only for a hexadecimal commit id); a file that cannot be
  recovered (a generated stub file, no history, no such commit) counts with its current bytes. Loading such a save and
  saving it again writes the scoped identity.

### 1.5 Random streams on load

The snapshot stores `main`, `pre` and every cosmetic stream exactly. Two load modes (`load {reseed}`, `29` §26):

- **Exact** (`reseed: false`): everything continues bit-identically; for tests, replays, bug reports and agents that
  want reproducible experiments.
- **Player** (`reseed: true`, the default for the browser and MCP): `pre` is restored exactly, so the next `PreRandom`
  values repeat until consumed and refilled (the original's anti-save-scum behaviour, `src/sgp/Random.cc:24-28`), and
  `main` is reseeded from `crypto.randomInt(0, 2^32)` through `reseedMain` (`src/sim/snapshot/session.ts`: `Rng.restore`
  in place, so the tactical layer and the `PreRandom` refill keep following the same object). This is what a native
  reload does in effect (`src/sgp/SGP.cc:433`) and D6's "reseeded on load". The seed is returned in the load result and
  logged as `reseed {seed}`, so a player load is reproducible from (save, seed, inputs) (deviations "Player loads"). A
  player load with seed `s` = an exact load followed by `reseed {s}`.

### 1.6 Names, folders and save rules

**Folders.** `$JA2_SAVE_DIR`, default `.ja2/saves/` in the repository (gitignored): a developer server keeps its saves
beside the code. Native saves stay in `$JA2_SAVES_DIR` (default `<data dir>/../SavedGames`,
`src/server/save-environment.ts`), are listed read only and imported with `newSession {save}` (`14`); the import can
then be saved in ja2-node format. No export to `.sav`. Imports run the original's load hooks (`14`); ja2-node loads
never do.

**Names** (`src/server/save-store.ts`): `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`; clients never pass paths (`04` §5.8).
Reserved, case-insensitively: `QuickSave`, `Auto01`, `Auto02`, `Error`. A player save without a name gets the slug of
`<UTC time to the second>Z-<description>`, cut to 64 characters (`playerSaveName`, like `SaveNewSave` and
`clean_basename`). Autosaves write the older or missing of `Auto01`/`Auto02` by modification time, then alternate in
memory. Dead is Dead writes one file: `campaign.deadIsDeadName`, or a name derived from
`campaign.deadIsDeadDescription` like a player save, default `DeadIsDead`; after a load the loaded save's name, after an
import the native file's name; before each write the store rotates two backups `Backup/<name>.j2s.1`, `.2`
(`BackupSavedGame`). Every write goes through a temporary file and a rename. The list is newest first; unreadable files
are listed with their problem. When a command or a step throws, the server writes the whole input log as
`Error.log.jsonl.gz` instead of an `Error.sav` (deviations "Error saves": the state after an exception is not
trustworthy; the log replays to the failure).

**Rules** (`src/server/save-rules.ts`; the reasons are refusal codes of `save`):

| Mode | `save`, quick save | Autosave | Load |
|---|---|---|---|
| save anywhere | refused while a conversation is open, a scripted sequence runs or the dialogue queue is busy (`conversation`), a meanwhile is trying to start or plays (`meanwhileStarting`), a decision prompt is open (`promptOpen`: battle, contract, militia or NPC prompt, or an autoresolve battle, whose screen has no save key) or a shop is open (`shopOpen`); the laptop flow is allowed (the original has no save key there but no rule against it, inferred) | `endTurn` accepted in turn-based combat with combat not ending at once (`Tactical/Handle_UI.cc:1066-1084`): `Auto01`/`Auto02`, no message | allowed |
| Iron Man | also refused in turn-based combat or while the loaded sector holds enemies (`ironMan`, `GameSettings.cc:233-259`) | same rule, so none in combat | allowed |
| Dead is Dead | an explicit save is refused (`deadIsDead`); `save {name: 'quick'}` writes the Dead is Dead file, as `DoQuickSave` does, or answers `actionInProgress` when `DoDeadIsDeadSave` would skip | at the start of our turn and at `endTurn` (`Tactical/TeamTurns.cc:154`, `:188`), when a meanwhile starts (`Strategic/Meanwhile.cc:206`), when a group is about to arrive (`Strategic/Map_Screen_Interface.cc:1231`), before another save is loaded into the session (`SaveLoadGame.cc:646-654`), when the session closes or the server stops (`src/sgp/SGP.cc:101`); written only when `deadIsDeadWritable`: our turn (or no combat), the loaded sector idle, no conversation, meanwhile, prompt or shop (`SaveLoadScreen.cc:1374`) | never blocked, as in the original (inferred there) |

- **Check order** of `saveRefusal`: `deadIsDead` (an explicit save in that mode), `conversation`, `meanwhileStarting`,
  `promptOpen`, `shopOpen`, then `canGameBeSaved` (Iron Man: combat first, then `numEnemiesInAnySector` of the loaded
  sector). A campaign session the server did not build has no origin and answers `notSaveable`; bad names answer
  `invalidName` or `reservedName`. A won campaign may be saved.
- **Autosave** (`SaveService`, through `Session.hooks`): before an `endTurn` in turn-based combat the service captures
  the save if `canGameBeSaved` (in Dead is Dead: if writable), and writes it once the command is accepted and its
  `CheckForEndOfCombatMode(FALSE)` did not end combat (`data.combatEnded`, `10`; then the original saves neither
  file); the file holds the state at the original's `UIHandleEndTurn`, before that check (deviations "Dead is Dead
  save points"). No other autosaves (sector entry, daily), even for long agent campaigns.
- **Dead is Dead save points** are read from the input's effects: a `turnStarted` event of our team, a `meanwhile` or
  `meanwhileStarted` event, a `GROUP_ABOUT_TO_ARRIVE` strategic event that was due and left the queue during the
  advance. The save is written at the end of that input, or at the first later input boundary where the conditions hold
  (deviations "Dead is Dead save points": saves happen only between inputs and the hooks must not touch the simulation;
  a skipped point waits instead of being lost). The load point is taken before the load replaces the simulation.
- **Messages.** `gameSaved` is reported for player and quick saves only; autosaves and Dead is Dead saves are silent. A
  developer-only `POST /api/sessions/:id/snapshot` writes a save ignoring the rules.

### 1.7 Input log and replay

`Session` (`src/server/session.ts`) appends every input that can change the outcome to its `InputLog`
(`src/server/input-log.ts`) **before** running it: `{seq, tick, kind, payload}`.

| Kind | Payload |
|---|---|
| `cmd`, `answer` | the command (`answer` for a command of type `answer`) |
| `advance` | the stop condition and budget; logged because it has side effects (it can start compression, `src/sim/advance.ts`). Real-time batches are `advance {until: {ticks}, realtime: true}`; consecutive batches that ran to their tick count merge into one entry of at most 100,000 ticks, equivalent because a full batch left no decision, end or watched event behind (a batch with pause events is never merged) |
| `drive` | informational: the advances a driver causes are logged themselves, so a replay uses the manual driver whatever the session used |
| `prepare` | the maps a command's asynchronous preparation added (the world cache is history-dependent) |
| `reseed` | the seed of a player load |
| `load` | `{name, digest}` of a load in place; a replay refuses a save that changed since |
| `speech` | the session's speech mode (`listen` or `skip`, `29` §14) |

The **origin** is `sandbox {seed}`, `campaign {seed, campaign}`, `import {seed, save, digest}`, `load {name, digest}` or
`unknown` (not replayable). A save writes the segment since the last load as `<name>.log.jsonl.gz`: a head line
`{format: 'ja2-node-input-log', version: 1, save, origin}`, then one JSON line per entry. `pnpm cli replay <save name>
[--data DIR] [--stubs DIR]` (`tools/replay.ts`, `src/server/replay.ts` `replaySave`) rebuilds the origin
(`simFromOrigin`), applies the entries and compares the snapshot with the save's, printing the first differing byte
with context. The log serves bug reports, regression tests and agent analysis; loading never needs it.

### 1.8 Snapshot codec

`src/sim/snapshot/` (DOM-free, Node-free, deterministic): `codec.ts` (generic graph codec: ordered named sections, tags,
references, externals, class codecs, loud failures), `refs.ts` (content index: every object reachable from the named
content roots, keyed by its first path in a deterministic walk, cached per content object), `world.ts` (class codecs
for `Rng`, `PreRandom`, `WorldStructures`, `MovementCosts`; the loaded world's roots; light templates by name),
`session.ts` (`snapshotCampaign`, `snapshotTactical`, `restoreCampaign`, `restoreTactical`, `migrateSnapshot`,
`reseedMain`), `migrations.ts` (§1.3).

**Equal histories give equal bytes**: object keys keep their order, maps and sets their insertion order. Sorting was
rejected because order is behaviour (the roster's iteration order is hire order and a rehire reuses a lower soldier
id), and because a restored object must be a replica so that events re-emitted from restored state (the tactical event
buffer) serialize to the same bytes.

| State | Written as |
|---|---|
| plain objects, arrays, strings, booleans, finite numbers | JSON, keys in their order; `-0`, `NaN`, `±Infinity` as `{"$num": "-0"}` etc.; `undefined` as `{"$undefined": true}`; arrays with holes as `{"$sparse": length, "$e": [[index, value], …]}` |
| typed arrays | `{"$u8": "<base64>"}` (`$i8`, `$u8c`, `$i16`, `$u16`, `$i32`, `$u32`, `$f32`, `$f64`), little-endian bytes; a view into a larger buffer is refused |
| `Map`, `Set` | `{"$map": [[key, value], …]}`, `{"$set": […]}` in insertion order |
| an object reached again (aliasing, cycles) | `{"$ref": "<path of its first occurrence>"}`, JSON-pointer segments (`~0`, `~1`) joined by `/`; map entries are `<map>/<i>/0` and `<map>/<i>/1`, sparse elements their real index |
| soldiers, world items, light sprites, bullets | bodies in the sections `soldiers` (`t.soldiers`), `items` (`t.worldItems`), `lights` (`t.lighting.sprites`) and `bullets`, written before `strategic` and `tactical`, so a pointer reads like an id: `{"$ref": "soldiers/5"}`, `{"$ref": "items/3"}`, `{"$ref": "lights/12"}`; a soldier object that is not `t.soldiers[id]` keeps its own body, a registered roster soldier is written once with both references re-linked |
| structure instances | bodies in the per-tile lists of the `world` section: `{"$ref": "world/structures/lists/<gridNo>/<index>"}` |
| content objects | `{"$x": n}` into the snapshot's `externals` table of keys such as `content/animStructures/3/2/structures/5`, `world.tiles/399/structure`, `light/L-R03.LHT`; roots `content`, `strategic`, `army`, `economy`, `merchants`, `laptop`, `dialogueProfiles`, `narrative` (`campaignContentRoots`; a sandbox has `content` only) and the loaded world's `world.map` (without its door table), `world.tables`, `world.tiles`, `world.level`, `world.terrain`, `world.doorCosts` |
| `Rng`, `PreRandom` | `{"$rng": [s0, s1, s2, s3]}`; `{"$pre": {"index", "refill", "ring"}}` with the refill linked to `rng`; every cosmetic stream is an `Rng` in the state |
| the loaded world | the `TacticalWorld` in section `world`: content parts as externals, `{"$structures": {heights, lists, nextId}}` (`WorldStructures.toSnapshot()`: per-tile lists in order with ids, flags, hit points and cached heights, and the id counter), `{"$costs": …}` (`MovementCosts.toSnapshot()`, the table as written; tests compare it with a recompile), the exit grid set; the door table (`t.world.mapDoors`) and the door status are plain maps |
| hooks | not written: `hooks`, `perceptionHooks`, `turnHooks`, `sectorHooks`, `experienceHooks`, `narrative`, `scheduleClock`; `pathEnv` is written as its settings (`showAllMercs`, `autoBandage`, the search counter) and rebuilt by `createPathEnv` |

A function, a class instance without a codec (the oracle's autoresolve `ReplayStream`, a `Date`), a bigint, a
null-prototype object or a key starting with `$` fails with its path (`SnapshotError: a Foo instance cannot be written
at strategic/battle/autoresolve/rng/main`). The root is `{format: 'ja2-node-snapshot', version, kind: 'campaign' |
'tactical', mapPath, graph: {externals, sections}}`; sections `world`, `lights`, `items`, `soldiers`, `bullets` (with a
loaded sector), `rng`, `strategic` (campaign), `tactical`.

**Restore** (`restoreCampaign(snapshot, {content, world, assemble})`): the caller gives the loaded sector's world (only
its content parts are used; structures, costs and exit grids come from the snapshot); the graph is decoded against the
content index; `TacticalSim.restore(world, state)` re-installs the sim's hooks around the decoded state (no state
creation, start clock, schedules, buildings or lighting); the caller's `assemble` builds the campaign around the decoded
strategic state with `CampaignSim.restore` (`assembleCampaign(…, {construction: 'restore', tactical, worlds})` in
`src/server/campaign-factory.ts`, `assembleImportedCampaign(…, 'restore')` in `src/server/save-session.ts`), skipping
the creation side effects (flow forced to `tactical`, the `X1` compression level, the session counters); then
`SectorFlow.reattachLoadedSector()` re-installs the sector hooks. The init list, edgepoints, schedules and everything
else in the state are restored as written, never recomputed (`createMerchantContext` fills `merchants.dealers` only when
empty).

**Server side** (`src/server/session-snapshot.ts`): `snapshotSession(sim)` → `{session: 'campaign' | 'imported' |
'sandbox', preparedMaps, sim}`; `restoreSession` loads the content freshly (`loadCampaignParts`, `loadImportParts`),
prepares the same maps (`WorldCache.preparedPaths()`, `fork(paths)`), builds the loaded sector's world (from the cache
when prepared, otherwise outside it, as a native import does) and calls the synchronous `restoreSessionFrom`.
`CampaignSession.origin` records how a campaign was built. A snapshot carries neither the `Session`'s driver and
real-time carry nor the output queue (drained before saving, §1.2).

### 1.9 What the state may hold

The codec works only if every outcome-relevant value lives in `StrategicState` or `TacticalState` (plus the loaded
world) and those hold nothing the codec cannot write:

- **No private session state.** Session counters live in `state.session {tick, compressing, day}`; the tactical tick,
  real-time clock and AI pass counters in `TacticalState.tick`, `.realtimeClock` (in a campaign the object in
  `state.sectorFlow.realtimeClock`, which outlives sector loads) and `.aiPass`; the flows keep theirs in
  `state.sectorFlow`, `state.shop.session` and `state.talk` (`dialogue`, the `TalkState`; `scripted`, `civQuote`,
  `soldiers`, `carmenTimerAtMs`, `shopAfterOpening`) and read them through accessors. Carmen's departure timer is
  therefore saved.
- **The roster is records.** `state.roster.mercs: Map<soldier id, MercRecord>`; `RosterMerc` is a facade without own
  fields. The four profile-record traits the economy and morale read (`skillTrait`, `skillTrait2`, `personalityTrait`,
  `needForSleep`) are copied into `MercRecord.profileRecord` at hire, whether the record came from content, I.M.P., a
  native save or a stub recruit.
- **Cosmetic streams are state.** `state.talk.dialogue.fx`, `state.cosmetic.helicopter` and `state.cosmetic.autoresolve`
  are created once from the session seed (`seed ^ salt`) and saved, although D6 calls `fx` unsaved: a few cosmetic picks
  are stored in state (`civ.currentCivQuote`, `src/sim/narrative/civ-quotes.ts`; the merc that triggers a record,
  `src/sim/narrative/converse.ts`), so exact reloads need the streams; gameplay never draws from them (deviations
  "Cosmetic streams in saves"). `ArRng.fx` stays an oracle override.
- **Hooks and wiring are rebuilt, never stored.** Contexts, `Roster.hooks`, `NarrativeFlow.slots`, the event dispatch
  table, the strategic AI binding (`StrategicAi`'s queen context is closures over the state), `CampaignSim.tactical` and
  the oracle overrides (`ContractFlow.rng`, `LaptopFlow.rng`, `RecruitFlow.reservedSoldierSlot`) come from the
  constructors and the restore path.
- **Mutable world classes** (`WorldStructures`, `MovementCosts`) carry `toSnapshot()`/`fromSnapshot()`; exit grids and
  the door table are plain state.
- **Content is referenced, not copied**: content objects inside state (`StructureInstance.def`, light templates,
  explosion animations, `MercProfile`) become content keys resolved against the freshly loaded content. Module-level
  caches (`WeakMap`s keyed by content, the light template map, the content indexes) are allowed: derived, never state.
- **State never references a module-level constant object.** Group sector defaults were one shared constant, so a
  restored campaign held copies while new groups held the constant, and the aliasing differed after a reload; each group
  now gets its own empty sector, and no group sector object is mutated in place. Likewise every stub merc gets its own
  `stats` copy.
- **Aliasing the codec preserves.** Inside `StrategicState`: group sector objects (`forces.groups[i].prev`, `.next`,
  `.sector`) shared by several groups or fields. With a loaded sector, `TacticalState` shares `rng`, `pre`, `profiles`,
  `keyTable`, `civGroups`, `boxing` (= `narrative.boxing`), `realtimeClock` (= `sectorFlow.realtimeClock`),
  `equipment.weaponsAlreadyDropped` (= `status.weaponsDropped`), `worldClock` (= `clock`), `options` (§2.2) and every
  registered roster soldier (`t.soldiers[id]`, `t.mercSlots[k]` = `roster.mercs.get(id).soldier`). `MercRecord.soldier`
  is a full `Soldier` whose pointer fields are null off the map but not while placed; autoresolve cells hold soldier
  pointers (only the default streams can be written).
- **Identity checks.** Militia prompts are answered from the head of `economy.prompts`, never found by identity.
  `registeredInTactical` (`t.soldiers[m.id] === m.soldier`, `src/sim/campaign/roster.ts`) stays an identity check:
  `t.soldiers` keeps the object of a soldier who left the team until the slot is registered again, and a hire can reuse
  that id meanwhile, so an id comparison would act on the wrong soldier; the codec keeps it valid by writing a
  registered roster soldier once.
- **Buffers.** Every flow and context buffer, the economy's included, drains into the campaign's output queue at each
  command and step boundary; between commands only `CampaignSim.#events` (output, drained by the next advance or
  `drainEvents`) and `TacticalState.events` (stamped at the next tactical step, written) hold events.

### 1.10 Server wiring and verification

`src/server/save-service.ts` (`SaveService`) saves, loads (`open`, `loadInto`, `completeLoad`), lists, deletes,
uploads (at most 32 MiB, parsed and checked before it is written) and downloads; it attaches the autosave and Dead is
Dead logic to each session through `Session.hooks` (before and after a dispatch and an advance, after a whole input, on
a throw), which only read the simulation; a failing hook only logs "automatic save skipped". `src/server/save-store.ts`
holds the files, `src/server/save-rules.ts` the rules and `saveStatus` (`saveMode`, `canSave`, `saveRefusal` for
`status` and `observe`), `src/server/session-factory.ts` builds sessions from a request, a load or a log origin, and
`src/server/save-environment.ts` wires all of it for the server and the CLI.

**Load path** (`SaveService.open`, `loadInto`): read the file, inflate, parse, run the save and snapshot migrations,
check the content (§1.4), restore through `restoreSession` with the pack's `read`, compare the text identity; a load in
place first takes the session's Dead is Dead save point, then `Session.replace` swaps the simulation, music, message log
and campaign identity (subscribers get a fresh `welcome`; a running real-time advance stops with `loaded`, `29` §26);
then, for a player load, the reseed. A new session from a load gets the log origin `load`.

**Verification.** The reload harness (`tests/support/reload.ts`: `driven`, `reloadPoint`, `advance`,
`expectReloadsInvisible`, `RUN_MODES`; `tests/support/session-reload.ts`: `drivenSession`, `ReloadingSession`;
`createTestCampaign(kit, {mode})`) snapshots and restores a driven sim into a fresh one (and snapshots again to check
the round trip) before a command when it was stepped since the last reload, after every accepted command and after every
`advance`; `expectReloadsInvisible` compares the event log and the final snapshot of a plain and a reloaded run byte for
byte. `pnpm test:reload` (`JA2_RELOAD=1`) reloads every test campaign and driven session after every input: the guard
against state the codec misses, including state added later. A test must look state up again after an input instead of
holding objects across it, and `reloadPoint` belongs at input boundaries, not right after a direct flow call whose
events still sit in a flow buffer. `tests/support/state-copy.ts` deep-copies a state and fails on any class instance
other than the streams and on any function. `pnpm cli replay` checks a saved log against its save.

### 1.11 Browser surfaces

- The canvas save/load screen on `/play` (`src/ui/screens/front-end/save-load.ts`, `src/ui/saves/`, `30` §1.5) follows
  the original's list (newest first; in save mode quick and auto saves hidden and a new row first); the main menu's
  Alt+Load loads the newest save.
- The launcher's save panel (`src/app/launcher/save-panel.ts`, `32` §3): the list with the original's row fields, Load
  with one warning box, Save as new or over a selected save (`QuickSave` is written as `quick`; autosaves and native
  saves cannot be overwritten), Delete, Download, Upload, native saves to import. Its row location and tooltip differ
  from the original (deviations "Save list in the launcher and on the canvas").
- The tactical and strategic pages bind Alt+S (`save {name: 'quick'}`) and Alt+L (`load QuickSave`), refusals shown as
  messages (`src/app/net/save-controls.ts`).

### 1.12 Quirks kept and limitations

**Quirks kept:** the save list hides quick and auto saves in save mode; Alt+Load on the main menu loads the newest save;
autosaves and Dead is Dead saves show no message; Dead is Dead keeps two backups and never blocks a load; Iron Man
refuses saves while enemies are in the loaded sector, even outside combat; `PreRandom` repeats after a reload until the
saved values are consumed and refilled.

**Deviations** (`deviations.md`): "Save side effects", "Cosmetic streams in saves", "Error saves", "Save compatibility",
"Player loads", "Dead is Dead save points", "Talk context in saves".

**Limitations.** Native saves taken during a meanwhile scene or the endgame sequence cannot be continued (`14`).

---

## 2. Options

### 2.1 The original

**Per campaign: `GAME_OPTIONS`** (`GameSettings.h:93-100`), five fields chosen on the game init screen, stored in the
save header and body (`SaveLoadGame.cc:362`, `:1863`, `:2003`):

| Option | Values, default (`InitGameOptions`, `GameSettings.cc:177-188`) | Read by (main sites) |
|---|---|---|
| `ubDifficultyLevel` | easy 1, medium 2, hard 3; **easy** | about 55 reads: `CalcDifficultyModifier` (`Tactical/Soldier_Create.cc:1035-1110`), starting cash (`Strategic/Game_Init.cc:242-246`), enemy to-hit −5 on easy (`Tactical/Weapons.cc:2170`), radio sightings (`Tactical/OppList.cc:713`), the Queen's policy triples and counter-attacks (`Strategic/Strategic_AI.cc:332-366`, `:2590-2861`), ambushes, mines, creatures, underground garrisons, progress (`17`, `18`, `19`) |
| `fSciFi` | **on** | creatures (`Strategic/Creature_Spreading.cc:901`), sci-fi placements and items, Tixa's map, two dialogue actions, a fact, Cambria's medical objects (11 sites) |
| `fGunNut` | **off** | map and placement gun replacement, `ItemIsLegal` (Bobby Ray, dealers), the army gun table, profile kits (6 sites) |
| `ubGameSaveMode` | save anywhere, Iron Man, Dead is Dead; **save anywhere** | save rules only (§1.1); on a Dead is Dead load `gfInMeanwhile` is forced off (`SaveLoadGame.cc:2037-2039`) |
| `fTurnTimeLimit` | **off and not selectable**: JA2 Gold removed the setting (`GameInitOptionsScreen.cc:94-103`, `#if 0`) | the wall-clock turn timer (`Tactical/Interface.cc:1686-2022`): 15 s per conscious merc, 100 ms ticks, ends the turn through `UIHandleEndTurn`; reachable only through an old save or a script |

**Per user: `GAME_SETTINGS`** (`GameSettings.h:57-72`, file `Ja2.set`, §1.1): 23 toggles (`TOPTION_*`, `:9-54`, defaults
`GameSettings.cc:144-166`), three volumes 0–127 (default 63), the last slot, the meanwhile scenes seen, the help flag,
cover and LOS display sizes. The options screen (`Options_Screen.cc`) shows the 23 toggles, three volume sliders and
Save, Load, Quit and Done; it opens from the main menu, from tactical (`o` or the panel button, not in meanwhile or a
battle-locked interface, `Tactical/Turn_Based_Input.cc:1541-1551`) and from the map screen, and pauses the game
(`Options_Screen.cc:169`, `:213`). Toggles apply at once; effects and speech volumes apply to the next sample, music at
once (`:640-659`). Speech and subtitles cannot both be off (`GameSettings.cc:77-81`, `Options_Screen.cc:620-629`).

**What each toggle does to the game** (from reading every reader):

| Class | Toggles | Notes |
|---|---|---|
| Changes simulation state | `BLOOD_N_GORE` | messy shot deaths over 2 tiles (`Tactical/Soldier_Control.cc:3141-3232`: body and items land elsewhere, a corpse that cannot be decapitated), explosion deaths (`:3265-3283`) with their battle sound draw, the death-animation chain (`Tactical/Soldier_Ani.cc:1645`, `:3196`), corpse vaporizing (camera-dependent, `Tactical/Rotting_Corpses.cc:1028`), blood graphic draws (`TileEngine/Smell.cc:442-463`) |
| Changes only gameplay-generator draws | `MUTE_CONFIRMATIONS` (skips `Random(2)` of the OK battle sound, `Tactical/Soldier_Control.cc:5987-6006`), `ANIMATE_SMOKE` (`Random(5)` start frame, `TileEngine/SmokeEffects.cc:206-233`) | ja2-node does not draw these in the simulation (deviations "Cosmetic draws …") |
| Changes pacing or pauses | `SPEECH` (quote ends with the sample instead of the text timer), `KEY_ADVANCE_SPEECH` (dialogue waits for a key, `Tactical/Faces.cc:1326-1334`), `SLEEPWAKE_NOTIFICATION` (the update box pauses and its dismissal decides compression, `Strategic/Map_Screen_Interface.cc:3215-3565`; sleeping and waking happen regardless, `Strategic/Assignments.cc:5732-5789`), `HIDE_BULLETS` (4 tiles per frame instead of 1, `Tactical/LOS.cc:3155-3166`) | |
| Input, camera, rendering | the other 16: `SUBTITLES`, `DONT_MOVE_MOUSE`, `OLD_SELECTION_METHOD`, `ALWAYS_SHOW_MOVEMENT_PATH`, `SHOW_MISSES`, `RTCONFIRM`, `USE_METRIC_SYSTEM`, `MERC_ALWAYS_LIGHT_UP`, `SMART_CURSOR`, `SNAP_CURSOR_TO_DOOR`, `GLOW_ITEMS`, `TOGGLE_TREE_TOPS`, `TOGGLE_WIREFRAME`, `3D_CURSOR`, `MERC_CASTS_LIGHT`, `TRACKING_MODE` | `MERC_CASTS_LIGHT` does **not** change sight: merc lights are fake lights (`LightSpriteFake`, `Tactical/Soldier_Control.cc:8126`) that `LightTrueLevel` subtracts (`TileEngine/Lighting.cc:527`), and every gameplay light read uses `LightTrueLevel` |

**Engine options and policy.** Stracciatella's `ja2.json`/command line
(`rust/stracciatella/src/config/engine_options.rs:53-111`, `rust/stracciatella/src/config/cli.rs:61-111`): data and save
folders, mods, resolution, `resversion` (`31`), fullscreen, `nosound` (forces text-length quote timing,
`src/sgp/SGP.cc:339-341`), debug (cheat levels). The **game policy** files `game.json`, `imp.json` and
`strategic-ai-policy.json` (`src/externalized/policy/DefaultGamePolicy.cc:7-170`) hold gameplay values (starting cash,
interrupt rules, AI switches, hit-chance limits, damage multipliers, progress weights, squad size, I.M.P. points,
`game_durations_multiplier`, …) and UX switches (`extra_hotkeys`, `gui_extras`, `target_fps`, …). Two keys ship with a
JSON value different from the code default: `interrupt_after_being_under_fire` (JSON false, code true) and
`campaign.start_sector_revealed` (JSON true, code false). D1 means the **shipped JSON** values; ja2-node copies these
files into `data/externalized` unchanged.

### 2.2 Game options

| Kind | Where it lives | Changes the outcome | Examples |
|---|---|---|---|
| **Game options** | session state, chosen at `newSession`, saved, shown in `status` and `observe` | yes | difficulty, sci-fi, gun nut, save mode, blood and gore |
| **Game policy** | engine content (`data/externalized`, the `ja2-node-data` layer) | yes | `game.json`, `imp.json`, `strategic-ai-policy.json` values |
| **Client settings** | the browser's `localStorage` (the original's per-user `Ja2.set`); never sent to the simulation | no | volumes, speech, subtitles, display toggles, playback speed, language, meanwhile scenes seen |

Server settings (environment, one per process: data and stubs folders, data version, default language, saves folder,
session host, port) are a fourth, operational kind and never enter a session.

**`GameOptions`** (`src/sim/options.ts`):

```ts
interface GameOptions {
  readonly difficulty: 1 | 2 | 3;
  readonly sciFi: boolean;
  readonly gunNut: boolean;
  readonly saveMode: 'anywhere' | 'ironMan' | 'deadIsDead';
  bloodAndGore: boolean;
}
```

- **Defaults.** `ORIGINAL_GAME_OPTIONS` = the original's (`InitGameOptions`, `InitGameSettings`): easy, sci-fi, reduced
  guns, save anywhere, blood on. `gameOptions(request)` builds a fresh object with these, except `difficulty`, whose API
  default is 2 (`API_DEFAULT_DIFFICULTY`, documented for agents); a difficulty other than 1, 2, 3 throws. The front-end
  forms preselect the original's easy and always send all five fields.
- **One object.** The strategic state owns the options; a loaded sector's `TacticalState.options` and
  `EquipmentState.options` are the same object (sight reads `t.options.difficulty`, the equipment its gun nut and sci-fi
  flags), so the army gun choice (`items.gunChoice`) honours gun nut in campaigns. A sandbox owns its own object. The
  codec re-links the alias like any other.
- **`newSession {campaign: {options}}`** takes any of the five fields; `campaign.difficulty` and `campaign.saveMode`
  stay accepted as aliases (old input logs replay); an alias that contradicts `options` is refused. `deadIsDeadName`
  and `deadIsDeadDescription` stay campaign fields: they name a server file, not a game option (§1.6).
- **Native saves.** `importNativeGameOptions` maps the header record (`SavedGameOptions`,
  `src/content/formats/savegame-header.ts`; `14`): `saveMode` from `ubGameSaveMode`; blood and gore on (it lives in
  the user's `Ja2.set`, not in the save); `turnTimeLimit` reported in `dropped` (the import report's and `listSaves`'
  `droppedOptions`).
- `status`, `observe`, `GET /api/sessions`, the save header and `listSaves` show `options` (`29` §27).

**Blood and gore** is the only toggle that is both changeable at any time in the original and outcome-relevant, so it
changes through a command: `setOption {bloodAndGore}` (`parseOptionChange`, `applyOptionChange`), logged and replayed
like every command; accepted in any flow before the story refusals (also in a meanwhile, the endgame and the laptop);
refused with `promptOpen` while a battle, contract, militia or NPC prompt is open and with `badOption` for anything
else. It changes the shared object, so it applies from the next tick, and reports `optionChanged {bloodAndGore}`. It
switches the messy shot deaths (`JFK_HITDEATH`, `FLYBACK_HIT` within two tiles, `src/sim/tactical/combat/hit.ts`), the
explosion deaths (`BODYEXPLODING`, `CHARIOTS_OF_FIRE`), the death animation chain, the corpse file (`corpses.json`
bloody or clean, `src/sim/tactical/combat/death.ts`), the corpse structure damage
(`src/sim/tactical/explosions/structure-damage.ts`) and the blood graphics (`updateBloodGraphics`,
`src/sim/tactical/smell.ts`). Corpse vaporizing does not depend on the camera (deviations "Vaporized corpses").

### 2.3 Game policy and pacing options

**Game policy** stays content and is not copied into the session. It ships with the engine in the project tables, so
the engine identity in the save header (`engineDiffers`, §1.4) marks a save made with other policy values. Copying the
policy into every save would duplicate content for a case the identity already reports; if saves must survive policy
edits, that is a migration, not a deviation.

**Pacing options become stop conditions, not state.** `SPEECH`, `KEY_ADVANCE_SPEECH` and `HIDE_BULLETS` are client
presentation: the simulation's timing is fixed (a line lasts the longer of its voice and its text, `24`,
deviations "Speech"; one bullet tile per tick). `SLEEPWAKE_NOTIFICATION` maps onto the client's or agent's choice to
stop a strategic `advance` on `fellAsleep`/`wokeUp` events (`advance {until: {events}}`, `04` §4.2): the pages'
real-time driver and advance apply the client setting (`src/app/sleep-wake.ts`, `src/app/net/sleep-wake-stop.ts`); an
agent passes the events it cares about. The outcome then depends only on when commands arrive. `turnTimeLimit` is not
offered: a deterministic port would need a wall-clock rule outside the simulation (the driver issuing `endTurn`), not
worth it for an option JA2 Gold made unreachable.

### 2.4 Client settings

`src/ui/settings.ts` (the model, `normalizeSettings`, `readSettings`, `writeSettings`, helpers such as
`meanwhileSceneSeen`, `helpScreenSeen`, `effectiveMaster`) and `src/app/settings.ts` (browser storage): one JSON object
under `ja2-node:settings`, `version: 2` (version 1 values kept, an unknown version gives the defaults); every storage
access is in `try`, so the pages work without storage. Agents have no client settings.

| Field | Values, default | Origin |
|---|---|---|
| `volumes {effects, speech, music, ambient, master}` | 0–127; 63 each, master 127 | the three volumes of `Ja2.set`; ambient and master are ja2-node additions |
| `muted` | false | ja2-node |
| `speech`, `subtitles` | true, true; at least one stays on (`speechOrSubtitlesKept`) | `TOPTION_SPEECH`, `TOPTION_SUBTITLES`, `GameSettings.cc:77-81` |
| `keyAdvanceSpeech`, `muteConfirmations`, `sleepWakeNotification` | false, false, true | `TOPTION_*` (§2.3) |
| `bloodAndGore` | true | the preference the new game form preselects; in a game the options screen sends `setOption` |
| `display.*` | the other toggles of §2.1's last row plus `animateSmoke` and `hideBullets`, the original's defaults | `TOPTION_*` |
| `playbackSpeed` | 0.25, 0.5, 1, 2, 4, 8, 16; 1 | ja2-node (`29` §9) |
| `language` | a UI language or null | `31` |
| `meanwhileScenesSeen`, `helpHidden`, `helpScreensSeen` | a 32-bit scene mask; false; a 16-bit mask per campaign identity (at most 32 campaigns) | `Ja2.set`; the help mask is saved per campaign instead of in the save (deviations "Help screens seen") |
| `coverSize`, `losSize` | 4–11, 4 | `DisplayCover.cc` `DC__MIN_SIZE`, `DC__MAX_SIZE` |
| `playSplash`, `playIntro` | true, true | ja2-node (`31`) |
| `uiScale`, `fixed640`, `websiteLoadingTimeScale` | auto; false; 0–10, 1 | ja2-node (`28` §2.6, `30` §6.1) |

The launcher exports and imports the settings as a JSON file `{format: 'ja2-node-settings', settings}`, normalized on
import. **Not read yet:** `display.oldSelectionMethod`, `display.showMisses` and `display.smartCursor` (toggles on the
options screen only), `coverSize`, `losSize`; `display.dontMoveMouse` is inert by design (deviations "Pointer warp").

### 2.5 Deviations

"Key-advance speech" (the simulation never waits; the client only holds the subtitle), "Sleep and wake notification" (a
client stop condition), "Timed turns" (not ported), "Help screens seen" (`deviations.md`). No policy deviation: the
policy stays content.

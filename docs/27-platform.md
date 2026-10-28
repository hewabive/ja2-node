# 27 — Platform: saves, options, sound and music, video, localization, stubs, performance

**Conventions.** Paths without a prefix are relative to `reference/stracciatella/src/game/`; `src/sgp/…`,
`src/externalized/…`, `rust/…`, `assets/…` and `dependencies/…` are relative to `reference/stracciatella/`; `V:` is
vanilla `Build/`. ja2-node paths start with `src/`, `data/`, `stubs/`, `tools/`, `tests/` or `docs/` and are relative
to the repository. "(inferred)" marks conclusions not traced end to end. `R(n)` = `Random(n)` (the `main` stream),
`PR(n)` = `PreRandom(n)` (`01` §3.6).

**Scope.** This doc owns ja2-node's own saves (`src/sim/snapshot/`, `src/server/save-*.ts`, `input-log.ts`,
`replay.ts`, `content-identity.ts`, `session-snapshot.ts`), game options and client settings (`src/sim/options.ts`,
`src/ui/settings.ts`), sound and music (`src/content/audio/`, `src/audio/`, `src/protocol/music*.ts`), video and
credits (`src/content/formats/smk.ts`, `credits.ts`, `src/app/video/`), localization, stub completeness and
performance. Elsewhere: `01` D6 and `01` §3.6 (the random streams), `04` §5.5 and `04` §5.10 (saves on the server,
the rule pack and its identity), `04` §6 (every save, option, music and text field of the agent API), `05`
(rendering), `14` (the native save format and its import), `15` §5 (clock state in saves), `24` §10.2 (speech timing),
`25` §5.6 (schedules in saves), `26` §6 and `26` §7 (the ending), `28` (the canvas screens: save/load, options,
credits, faces and lip-sync), `deviations.md`.

| § | Topic | Core decision |
|---|---|---|
| 1 | Saves | A JSON snapshot of the whole session with a codec in `sim`, exact restore, bound to the game data, an input log for replay; Stracciatella's named saves, quick save, end-of-turn autosave, Iron Man and Dead is Dead; a player load reseeds `main` |
| 2 | Options | Game options are session state; blood and gore is the only one that changes during a game, through a logged command; the game policy is engine content; every other toggle is a client setting; timed turns are not ported |
| 3 | Sound and music | Presentation only: the client derives every cue from events, frames and animation timelines; the server computes the music mode from events; own WAV/IMA ADPCM decoder |
| 4 | Video | Own Smacker decoder in `content`, a WebGL player in the browser, the sequences of `Intro.cc`, no transcoding |
| 5 | Localization | Data version (from the data) and display language (chosen) are separate; the data version reaches the simulation only through quote lengths and record layouts |
| 6 | Stubs | A generated stub pack that runs every platform feature and a campaign without original data |
| 7 | Performance | Oracle-free benchmarks with targets; session hosts |

---

## 1. Saves

### 1.1 The original

Stracciatella replaced vanilla's fixed slots with a list of named files.

| | Vanilla (`V:`) | Stracciatella |
|---|---|---|
| Layout | 11 fixed slots (`V:SaveLoadScreen.h:6`): slot 0 the quick save, 1–10 the player's | a scrolling list of every `*.sav` in the save folder, 11 rows on screen (`SaveLoadScreen.cc:54`, `:753-794`), newest first (`:747-751`); unreadable headers are skipped (`:767-769`), incompatible versions stay listed |
| Quick save | `QuickSave.sav` (`V:SaveLoadGame.c:3334-3373`) | `QuickSave.sav`, description "QuickSave" (`SaveLoadGame.cc:126-132`, `SaveLoadScreen.cc:1328`) |
| Autosave | `Auto%02d.sav`, two files alternating (`V:SaveLoadGame.c:3355-3366`) | `Auto01`/`Auto02`, the older or missing one is overwritten (`GetNextIndexForAutoSave`, `SaveLoadGame.cc:2411-2448`); description = name |
| Player save | `SaveGame%02d.sav` | the UTC timestamp plus the slugged description (`SaveLoadScreen.cc:680-685`, `rust/stracciatella/src/fs.rs:248-250`); in save mode the list hides quick and auto saves and starts with "create new savegame" (`:782-793`) |
| Error save | `SaveGame99.sav` (CD error, `V:GameSettings.c:414`) | `Error.sav` when an exception escapes the game loop (`GameLoop.cc:243-249`) |
| Folder | `..\SavedGames` relative to the working directory | `<home>/.ja2/SavedGames` or `ja2.json` `save_game_dir` (`rust/stracciatella/src/config/engine_options.rs:9`, `:147-172`; `rust/stracciatella/src/config/stracciatella_home.rs:4-30`) |

Each row shows day and time, the sector (or "N/A" before the start time), the merc count, the balance and the
description, plus a skull for Dead is Dead saves; in load mode a tooltip lists difficulty, save mode, weapons, style and
mods (`SaveLoadScreen.cc:874-957`). The header (`SaveLoadGame.h:24-60`, 432 bytes, `14` §2) fills these rows without
reading the body. A description is up to 46 characters (`:1054-1057`). Overwriting asks for confirmation (`:699-704`);
Delete deletes after confirmation (`:653-662`, `:1277-1293`); loading a save of another version, build or mod set asks
once with all reasons (`:707-731`, `:1132-1158`); a load failure shows an error and restarts to the main menu
(`:1200-1205`, `:1296-1317`). The main menu disables Load when no save exists (`MainMenuScreen.cc:233`); Alt+Load or
Alt+C loads `gSavedGamesList[bLastSavedGameSlot]` at once (`:268`, `:286-289`, `SaveLoadScreen.cc:378-391`), an index
Stracciatella only ever sets to 0 (`:1481`), so it loads the newest save in practice (inferred).

**Keys.** Tactical: Alt+S quick save (refused in a battle-locked map interface or a conversation, and by
`CanGameBeSaved`, `Tactical/Turn_Based_Input.cc:1946-1960`), Alt+L quick load (`:1914-1920`), Ctrl+S and Ctrl+L the save
and load screens (`:1821-1841`, `:2177`). Map screen: the same keys (`Strategic/MapScreen.cc:2945-3021`), gated by
`AllowedToExitFromMapscreenTo` (`Strategic/Map_Screen_Interface_Bottom.cc:987-1070`: dialogue queue not empty, meanwhile
trying to start, locked pause, an item on the cursor, popups open, the contract renewal sequence, the battle roster, the
sector inventory). The options screen has Save and Load buttons; Save is disabled when the options were opened from the
main menu, by `CanGameBeSaved`, and in Dead is Dead (`Options_Screen.cc:266-269`).

**Save modes** (`GameSettings.h:85-90`, chosen at a new game, `GameInitOptionsScreen.cc:719`; vanilla has only
`fIronManMode`, `V:GameSettings.h:91`):

- *Save anywhere* (`DIF_CAN_SAVE`, the default, `GameSettings.cc:186`): `CanGameBeSaved` is always true.
- *Iron Man*: `CanGameBeSaved` (`GameSettings.cc:233-259`) is false while `INCOMBAT` is set or the loaded sector holds
  enemies (`NumEnemiesInAnySector(gWorldSector) > 0`). Loading is not restricted.
- *Dead is Dead*: the player names the one save file before the intro (`GameInitOptionsScreen.cc:751-763`,
  `SaveLoadScreen.cc:1477-1484`); every quick save and autosave is redirected to it (`:1322-1346`); the Save screen and
  Ctrl+S/Ctrl+L are refused (`Tactical/Turn_Based_Input.cc:1821-1841`, `:2177`,
  `Strategic/Map_Screen_Interface_Bottom.cc:961-975`). `DoDeadIsDeadSave` (`SaveLoadScreen.cc:1363-1405`) writes only on
  our team's turn, outside the talk panel, meanwhile, the PBI, a message box and a locked UI, after keeping two backups
  (`SaveLoadGame.cc:1515-1542`). It runs at the start of our turn and at `EndTurn` (`Tactical/TeamTurns.cc:154`,
  `:188`), at `BeginMeanwhile` (`Strategic/Meanwhile.cc:206`), when a group is about to arrive
  (`Strategic/Map_Screen_Interface.cc:1231`), on quit to the menu and on program exit (`Options_Screen.cc:683`,
  `src/sgp/SGP.cc:101`) and before loading another save (`SaveLoadGame.cc:646-654`). Quick load and the options screen's
  Load are not blocked (inferred from the missing checks). The refusal message index is out of the string table's bounds
  (`Utils/Text.h:1327` against `src/externalized/strings/Localization.h:175`), a Stracciatella bug.

**Autosave.** One rule only: `UIHandleEndTurn`, when the player ends a turn in turn-based combat and combat does not end
right there, calls `DoAutoSave` if `CanGameBeSaved()` (`Tactical/Handle_UI.cc:1066-1084`; reached from the D key, the
Done button, the turn time limit and `gfBeginEndTurn`). No option controls it (`GameSettings.h:9-54` has none), no
message is shown (`SaveLoadGame.cc:524`). Vanilla also required a hidden file `AutoSave.pls`
(`V:Tactical/HandleUI.c:1522`), so it never autosaved in a normal install. Neither version autosaves daily or on sector
entry.

**`SaveGame`** (`SaveLoadGame.cc:269-539`): pauses, sets `LOADING_SAVED_GAME`, writes the current sector into its temp
files first (`SaveCurrentSectorsInformationToTempItemFile`, `:325`), fills the header including `header.uiRandom =
Random(RAND_MAX)` (`:380`, a gameplay draw caused by saving), writes the body sections (`14` §4) and the game-states
JSON block (`SaveLoadGameStates.cc`: mods list, `StrategicStatus::alreadyDroppedWeapons`, script keys), then moves the
file from the temp folder into place; on failure it shows an error and deletes the temp file (`:494-512`). The version
is 105 (`GameVersion.h:20`; vanilla 99).

**`LoadSavedGame`** (`SaveLoadGame.cc:644-1198`): trashes the world and every runtime list, reads the sections, then
runs the load hooks (`InitAI`, `UpdateMercsInSector`, `PostSchedules`, lighting, `14` §10), resets the attack-busy count
(`:1097-1101`), checks for ambushes (`:1195`) and returns to the saved screen (`LoadGeneralInfo`, `:1961-1962`). **The
random generator is not reseeded on load**: Stracciatella seeds mt19937 once at start-up (`src/sgp/SGP.cc:433`,
`src/sgp/Random.cc:39-59`) and does not save its state; only the `PreRandom` table and index are saved
(`SaveLoadGame.cc:2110-2127`). A reload therefore repeats the next `PreRandom` values until they are consumed (each use
is refilled from the engine, `src/sgp/Random.cc:24-28`; vanilla never refills, `V:SGP/Random.c:62-65`), while `Random`
continues from whatever state the running process has: effectively a fresh stream (inferred; this is the "reseed" of
`01` §3.6).

**Settings file** `Ja2.set` (`GameSettings.cc:27`, `:111-130`, in the user's home): volumes, the option toggles, the
last slot, the meanwhile scenes seen, help flags and two display sizes; written after every save and load
(`SaveLoadGame.cc:521`, `:1075`). The current save name is runtime only.

### 1.2 Snapshot contract

1. **Saving has no effect.** No draw, no recomputation, no flag change: the session continues exactly as if nothing had
   happened (also the rule of `15` §5 and `25` §5.6). The original's save-time `R(RAND_MAX)` and its temp-file write of
   the loaded sector are not reproduced (deviations "Save side effects"). Before a campaign snapshot the campaign's
   undrained output events move into a buffer of the server `Session`, which the next advance reports first; the
   tactical event buffer (`TacticalState.events`) is plain state and is written.
2. **Restore is exact.** For any inputs `I`, `continue(S, I)` and `continue(restore(snapshot(S)), I)` produce the same
   event log and the same final snapshot, byte for byte ("load + replay = same outcome").
3. **Versioned.** Every file carries a format version; older files go through migration chains on the plain JSON (§1.3).
4. **Content-bound.** A snapshot is valid only with the game data it was made with (§1.4).

**Save points** lie only between inputs: the server is single-threaded, so a save always lands between two commands or
two real-time batches, and an `advance` stops between ticks, never inside one.

**Why a codec.** The tactical layer is an object graph with soldier, item, bullet, light and structure pointers, so
`01` D7's "ids instead of pointers" does not hold there. Three strategies were weighed: a codec that encodes and
re-links pointers, with all private session state moved into the state objects (built); refactoring the tactical layer
to ids everywhere (cleaner, but it touches every combat and AI module); replay-only saves (rejected: load time grows
with the campaign and any code change breaks old saves).

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
  newline, the second the rest. The file stays one JSON document for `gunzip`, and the list reads the header from the
  first 64 KiB with a sync flush (also from a file gzipped again as one member). The header repeats what the list
  shows, the original's reason for its header. Inflated text is capped at 512 MiB. A save's digest is the SHA-256 of its
  decompressed text; it identifies the save as a log origin (§1.7).
- **`preparedMaps`**: the world cache's prepared paths in order. A step may load a sector and the `WorldCache` is
  history-dependent, so a restore prepares the same maps before building the session.
- **`presentation`** is never read by `sim`: the music mode and the previous mode (§3.5), the session's message log
  (`src/protocol/message-log.ts`) so a load shows the same lines, and the campaign identity, a random id a new campaign
  gets and keeps through saves (an older save gets one from its digest, a native import from the file's digest, a
  sandbox none; `src/server/campaign-id.ts`); the client keys per-campaign UI state by it (the help screens seen, `04`
  §6.24).
- **Versions.** `migrateSaveFile` runs `SAVE_MIGRATIONS` (1 → 2: the file list `contentFiles` moves to
  `legacyContent`) before the snapshot's own `migrateSnapshot` (`SNAPSHOT_VERSION` 10, `snapshotMigrations` in
  `src/sim/snapshot/migrations.ts`, one function per step: 1 the unified game options, 2 sprite frames to presentation
  timeline slots (needs the animation timelines, `snapshotMigrationContext`), 3 soldier and turn presentation state,
  4 the laptop's new-mail flag, 5 battles fought, 6 the heard-noise pause, 7 the turn quote flags, 8 stale muzzle
  flashes put out, 9 the blood graphics). Problems: `notASave`, `versionTooNew`, `noMigration`, `corrupt`. **Rule:** a
  change of the state's shape bumps `SNAPSHOT_VERSION` and adds a migration; `src/server/fixtures/` holds a landed
  campaign and a sandbox saved by 0.7.0 on the stub pack with the soldiers they showed, and `legacy-save.test.ts` loads
  them, expects the same soldiers 400 ticks later and re-saves them.
- **Size.** A landed stub squad is about 2 MiB of JSON (40 KiB gzipped), the largest original-data import about 4 MiB
  (150 KiB), mostly merchant inventories, the base64 cost table, the structure lists and the tactical typed arrays.

### 1.4 Content identity

`header.content` binds a save to the game data; the repository's own files are versioned with the engine
(`header.engine`).

- **`logic`** is the rule pack's identity hash (`04` §5.10, `isIdentityLayer` in `src/content/rules/pack.ts`): it
  covers the pack entries of the game data only (on `original` the data folder and the SLF archives, voice lengths
  included; on `stubs` the stub pack), not the project tables (`ja2-node-data`: `tables/**`, `externalized/**`) nor, on
  the original data, the stub pack. The pack covers every file the simulation can read, so the hash is known before any
  session exists (`welcome` carries it).
- **`text`** (`quoteLengthIdentity`, `src/server/content-identity.ts`) hashes the character count of every row of every
  dialogue file in use, at the dialogue width or the civilian-quote width; `none` for the sandbox. Quote lengths are the
  only way text reaches the simulation (`24` §10.2).
- **`engine`** (`engineIdentity`): the package version and the commit (`JA2_COMMIT`, else `git rev-parse HEAD`, else
  `unknown`).
- **Load check, in order** (`SaveService.#verify`, then after the restore): another `source` is refused
  (`contentMismatch`); another `logic` hash is refused on the original data (`contentMismatch`) and loads with the
  warning `stubPackDiffers` on the stubs (the repository generates the stub pack and changes it during development);
  another `dataVersion` warns `dataVersionDiffers`; another engine version or commit warns `engineDiffers` (this covers
  the project tables, the game policy among them, §2.3); after the restore another `text` hash adds
  `dataVersionDiffers`. `listSaves` predicts `contentMismatch` and `stubPackDiffers` from a version 2 header alone. Why
  refuse: a ja2-node save is the simulation's own state and cannot be rebuilt on other logic data; text only changes
  speech timings (deviations "Save compatibility").
- **Accepted logic hashes**: the pack's scoped hash and its `allLayersHash` (the older identity `ja2-node-rules 1` over
  every entry, which also names the pack's cache directory), so a save that carries the all-layers hash loads while
  nothing in the pack changed; a re-save writes the scoped hash.
- **Version 1 saves** (0.7.0) list the files they read (`legacyContent.files`: path and state `f` file, `m` missing, `p`
  present by probe; `.edt` files count by presence only). `ContentLedger.matchesSaved` first recomputes the 0.7.0 hash
  over these paths from the raw data (the lists include STI files the logic loaders read then, so this needs the VFS,
  not the pack). If that differs it recomputes with the entries outside the identity layers taken as saved: presence
  lines as listed, files of `ja2-node-data` from the repository's history at the save's engine commit
  (`src/server/repository-history.ts`, `git cat-file`, only for a hexadecimal commit id); a file that cannot be
  recovered (a generated stub file, no history, no such commit) counts with its current bytes. Loading such a save once
  and saving it again writes the scoped identity.

### 1.5 Random streams on load

The snapshot stores `main`, `pre` and every cosmetic stream exactly. Two load modes (`load {reseed}`, `04` §6):

- **Exact** (`reseed: false`): everything continues bit-identically. For tests, replays, bug reports and agents that
  want reproducible experiments.
- **Player** (`reseed: true`, the default for the browser and MCP): `pre` is restored exactly, so the next `PreRandom`
  values repeat until they are consumed and refilled (the original's anti-save-scum behaviour,
  `src/sgp/Random.cc:24-28`), and `main` is reseeded from `crypto.randomInt(0, 2^32)` through `reseedMain`
  (`src/sim/snapshot/session.ts`: `Rng.restore` in place, so the tactical layer and the `PreRandom` refill keep
  following the same object). This is what a native reload does in effect (`src/sgp/SGP.cc:433`) and D6's "reseeded on
  load". The seed is returned in the load result and logged as `reseed {seed}`, so a player load is reproducible from
  (save, seed, inputs) (deviations "Player loads"). A player load with seed `s` equals an exact load followed by `reseed
  {s}`.

### 1.6 Names, folders and save rules

**Folders.** `$JA2_SAVE_DIR`, default `.ja2/saves/` in the repository (gitignored): a developer server keeps its saves
beside the code. Native saves stay in `$JA2_SAVES_DIR` (default `<data dir>/../SavedGames`,
`src/server/save-environment.ts`), are listed read only and imported with `newSession {save}` (`14` §10); the import can
then be saved in ja2-node format. There is no export to `.sav`. Imports run the original's load hooks (`14` §10);
ja2-node loads never do.

**Names** (`src/server/save-store.ts`). `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`; clients never pass paths (`04` §5.8).
Reserved, case-insensitively: `QuickSave`, `Auto01`, `Auto02`, `Error`. A player save without a name is the slug of
`<UTC time to the second>Z-<description>`, cut to 64 characters (`playerSaveName`, like `SaveNewSave` and
`clean_basename`). Autosaves write the older or missing of `Auto01`/`Auto02` by modification time, then alternate in
memory. Dead is Dead writes one file: `campaign.deadIsDeadName`, or a name derived from
`campaign.deadIsDeadDescription` like a player save, default `DeadIsDead`; after a load the loaded save's name, after an
import the native file's name; before each write the store rotates two backups `Backup/<name>.j2s.1`, `.2`
(`BackupSavedGame`). Every write goes through a temporary file and a rename. The list is newest first, unreadable files
listed with their problem. When a command or a step throws, the server writes the whole input log as
`Error.log.jsonl.gz` instead of an `Error.sav` (deviations "Error saves": the state after an exception is not
trustworthy, the log replays to the failure).

**Rules** (`src/server/save-rules.ts`; the reasons are refusal codes of `save`):

| Mode | `save`, quick save | Autosave | Load |
|---|---|---|---|
| save anywhere | refused while a conversation is open, a scripted sequence runs or the dialogue queue is busy (`conversation`), a meanwhile is trying to start or plays (`meanwhileStarting`), a decision prompt is open (`promptOpen`: battle, contract, militia or NPC prompt, or an autoresolve battle, whose screen has no save key) or a shop is open (`shopOpen`); the laptop flow is allowed (the original has no save key there but no rule against it, inferred) | `endTurn` accepted in turn-based combat with combat not ending at once (`Tactical/Handle_UI.cc:1066-1084`): `Auto01`/`Auto02`, no message | allowed |
| Iron Man | additionally refused in turn-based combat or while the loaded sector holds enemies (`ironMan`, `GameSettings.cc:233-259`) | same rule, so none in combat | allowed |
| Dead is Dead | an explicit save is refused (`deadIsDead`); `save {name: 'quick'}` writes the Dead is Dead file, as `DoQuickSave` does, or answers `actionInProgress` when `DoDeadIsDeadSave` would skip | at the start of our turn and at `endTurn` (`Tactical/TeamTurns.cc:154`, `:188`), when a meanwhile starts (`Strategic/Meanwhile.cc:206`), when a group is about to arrive (`Strategic/Map_Screen_Interface.cc:1231`), before another save is loaded into the session (`SaveLoadGame.cc:646-654`), when the session closes or the server stops (`src/sgp/SGP.cc:101`); written only when `deadIsDeadWritable`: our turn (or no combat), the loaded sector idle, no conversation, meanwhile, prompt or shop (`SaveLoadScreen.cc:1374`) | never blocked, as in the original (inferred there) |

- **Check order** of `saveRefusal`: `deadIsDead` (an explicit save in that mode), then `conversation`,
  `meanwhileStarting`, `promptOpen`, `shopOpen`, then `canGameBeSaved` (Iron Man: combat first, then
  `numEnemiesInAnySector` of the loaded sector). A campaign session the server did not build has no origin and answers
  `notSaveable`; bad names answer `invalidName` or `reservedName`. A won campaign may be saved.
- **Autosave** (`SaveService`, through `Session.hooks`): before an `endTurn` in turn-based combat the service captures
  the save if `canGameBeSaved` (in Dead is Dead: if writable), and writes it once the command is accepted and, outside
  Dead is Dead, combat still goes on; the file holds the state at the original's `UIHandleEndTurn`.
- **Dead is Dead save points** are read from the input's effects: a `turnStarted` event of our team, a `meanwhile` or
  `meanwhileStarted` event, a `GROUP_ABOUT_TO_ARRIVE` strategic event that was due and left the queue during the
  advance. The save is written at the end of that input, or at the first later input boundary where the conditions hold
  (deviations "Dead is Dead save points": saves happen only between inputs and the hooks must not touch the simulation;
  a skipped point waits instead of being lost). The load point is taken before the load replaces the simulation.
- **Messages.** `gameSaved` is reported for player and quick saves only; autosaves and Dead is Dead saves are silent, as
  in the original. A developer-only `POST /api/sessions/:id/snapshot` writes a save ignoring the rules.
- No extra autosaves (sector entry, daily) exist: only the original's end-of-turn rule, even for long agent campaigns.

### 1.7 Input log and replay

`Session` (`src/server/session.ts`) appends every input that can change the outcome to its `InputLog`
(`src/server/input-log.ts`) **before** running it: `{seq, tick, kind, payload}`.

| Kind | Payload |
|---|---|
| `cmd`, `answer` | the command (`answer` for a command of type `answer`) |
| `advance` | the stop condition and budget; `advance` is logged because it has side effects (it can start compression, `src/sim/advance.ts`). Real-time batches are `advance {until: {ticks}, realtime: true}`; consecutive batches that ran to their tick count merge into one entry of at most 100,000 ticks, equivalent because a full batch left no decision, end or watched event behind (a batch with pause events is never merged) |
| `drive` | informational: the advances a driver causes are logged themselves, so a replay uses the manual driver whatever the session used |
| `prepare` | the maps a command's asynchronous preparation added (the world cache is history-dependent) |
| `reseed` | the seed of a player load |
| `load` | `{name, digest}` of a load in place; a replay refuses a save that changed since |
| `speech` | the session's speech mode (`listen` or `skip`, `04` §6.14) |

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

**Equal histories give equal bytes**: object keys keep their order and maps and sets their insertion order. Sorting was
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
`src/server/campaign-factory.ts`, `assembleImportedCampaign(…, 'restore')` in `src/server/save-session.ts`), which skips
the creation side effects (flow forced to `tactical`, the `X1` compression level, the session counters); then
`SectorFlow.reattachLoadedSector()` re-installs the sector hooks. The init list, edgepoints, schedules and everything
else in the state are restored as written, never recomputed (`createMerchantContext` fills `merchants.dealers` only
when empty).

**Server side** (`src/server/session-snapshot.ts`): `snapshotSession(sim)` → `{session: 'campaign' | 'imported' |
'sandbox', preparedMaps, sim}`; `restoreSession` loads the content freshly (`loadCampaignParts`, `loadImportParts`),
prepares the same maps (`WorldCache.preparedPaths()`, `fork(paths)`), builds the loaded sector's world (from the cache
when prepared, otherwise outside it, as a native import does) and calls the synchronous `restoreSessionFrom`.
`CampaignSession.origin` records how a campaign was built. A snapshot carries neither the `Session`'s driver and
real-time carry nor the output queue (drained before saving, §1.2).

### 1.9 What the state may hold

The codec only works if every outcome-relevant value lives in `StrategicState` or `TacticalState` (plus the loaded
world) and those hold nothing the codec cannot write:

- **No private session state.** Session counters live in `state.session {tick, compressing, day}`, the tactical tick,
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
  restored campaign held copies while new groups held the constant and the aliasing differed after a reload; each group
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
and campaign identity (subscribers get a fresh `welcome`; a running real-time advance stops with `loaded`, `04` §6);
then, for a player load, the reseed. A new session from a load gets the log origin `load`.

**Verification.** The reload harness (`tests/support/reload.ts`: `driven`, `reloadPoint`, `advance`,
`expectReloadsInvisible`, `RUN_MODES`; `tests/support/session-reload.ts`: `drivenSession`, `ReloadingSession`;
`createTestCampaign(kit, {mode})`) snapshots and restores a driven sim into a fresh one (and snapshots again to check
the round trip) before a command when it was stepped since the last reload, after every accepted command and after every
`advance`, and `expectReloadsInvisible` compares the event log and the final snapshot of a plain and a reloaded run byte
for byte. `pnpm test:reload` (`JA2_RELOAD=1`) reloads every test campaign and driven session after every input; it is
the guard against state the codec misses, including state added later. A test must look state up again after an input
instead of holding objects across it, and `reloadPoint` belongs at input boundaries, not right after a direct flow call
whose events still sit in a flow buffer. `tests/support/state-copy.ts` deep-copies a state and fails on any class
instance other than the streams and on any function. `pnpm cli replay` checks a saved log against its save.

### 1.11 Browser surfaces

The canvas save/load screen on `/play` (`src/ui/screens/front-end/save-load.ts`, `src/ui/saves/`, `28`) follows the
original's list (newest first; in save mode quick and auto saves hidden and a new row first), the main menu's Alt+Load
loads the newest save, and the launcher's save panel (`src/app/launcher/save-panel.ts`, `27` §8) offers the list with
the original's row fields, Load with one warning box, Save as new or over a selected save (`QuickSave` is written as
`quick`; autosaves and native saves cannot be overwritten), Delete, Download and Upload, and native saves to import.
The tactical and strategic pages bind Alt+S (`save {name: 'quick'}`) and Alt+L (`load QuickSave`) with refusals shown as
messages (`src/app/net/save-controls.ts`). The launcher's row location and tooltip differ from the original
(deviations "Save list in the launcher and on the canvas").

### 1.12 Quirks kept and limitations

**Quirks kept:** the save list hides quick and auto saves in save mode; Alt+Load on the main menu loads the newest save;
autosaves and Dead is Dead saves show no message; Dead is Dead keeps two backups and never blocks a load; Iron Man
refuses saves while enemies are in the loaded sector even outside combat; `PreRandom` repeats after a reload until the
saved values are consumed and refilled.

**Deviations** (full entries in `deviations.md`): "Save side effects", "Cosmetic streams in saves", "Error saves", "Save
compatibility", "Player loads", "Dead is Dead save points", "Talk context in saves".

**Limitations.** Native saves taken during a meanwhile scene or the endgame sequence cannot be continued (`14`).

---

## 2. Options

### 2.1 The original

**Per campaign: `GAME_OPTIONS`** (`GameSettings.h:93-100`), five fields chosen on the game init screen and stored in the
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
(`:169`, `:213`). Toggles apply at once; effects and speech volumes apply to the next sample, music at once
(`:640-659`). Speech and subtitles cannot both be off (`GameSettings.cc:77-81`, `Options_Screen.cc:620-629`).

**What each toggle does to the game** (from reading every reader):

| Class | Toggles | Notes |
|---|---|---|
| Changes simulation state | `BLOOD_N_GORE` | messy shot deaths over 2 tiles (`Tactical/Soldier_Control.cc:3141-3232`: body and items land elsewhere, a corpse that cannot be decapitated), explosion deaths (`:3265-3283`) with their battle sound draw, the death-animation chain (`Tactical/Soldier_Ani.cc:1645`, `:3196`), corpse vaporizing (camera-dependent, `Tactical/Rotting_Corpses.cc:1028`), blood graphic draws (`TileEngine/Smell.cc:442-463`) |
| Changes only gameplay-generator draws | `MUTE_CONFIRMATIONS` (skips `Random(2)` of the OK battle sound, `Tactical/Soldier_Control.cc:5987-6006`), `ANIMATE_SMOKE` (`Random(5)` start frame, `TileEngine/SmokeEffects.cc:206-233`) | ja2-node does not draw these in the simulation (deviations "Cosmetic draws …") |
| Changes pacing or pauses | `SPEECH` (quote ends with the sample instead of the text timer), `KEY_ADVANCE_SPEECH` (dialogue waits for a key, `Tactical/Faces.cc:1326-1334`), `SLEEPWAKE_NOTIFICATION` (the update box pauses and its dismissal decides compression, `Strategic/Map_Screen_Interface.cc:3215-3565`; sleeping and waking happen regardless, `Strategic/Assignments.cc:5732-5789`), `HIDE_BULLETS` (4 tiles per frame instead of 1, `Tactical/LOS.cc:3155-3166`) | |
| Input, camera, rendering | the other 16: `SUBTITLES`, `DONT_MOVE_MOUSE`, `OLD_SELECTION_METHOD`, `ALWAYS_SHOW_MOVEMENT_PATH`, `SHOW_MISSES`, `RTCONFIRM`, `USE_METRIC_SYSTEM`, `MERC_ALWAYS_LIGHT_UP`, `SMART_CURSOR`, `SNAP_CURSOR_TO_DOOR`, `GLOW_ITEMS`, `TOGGLE_TREE_TOPS`, `TOGGLE_WIREFRAME`, `3D_CURSOR`, `MERC_CASTS_LIGHT`, `TRACKING_MODE` | `MERC_CASTS_LIGHT` does **not** change sight: merc lights are fake lights (`LightSpriteFake`, `Tactical/Soldier_Control.cc:8126`) that `LightTrueLevel` subtracts (`TileEngine/Lighting.cc:527`), and every gameplay light read uses `LightTrueLevel` |

**Engine options and policy.** Stracciatella's `ja2.json`/command line
(`rust/stracciatella/src/config/engine_options.rs:53-111`, `rust/stracciatella/src/config/cli.rs:61-111`): data and save
folders, mods, resolution, `resversion` (`27` §5), fullscreen, `nosound` (forces text-length quote timing,
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

- **Defaults.** `ORIGINAL_GAME_OPTIONS` holds the original's (`InitGameOptions`, `InitGameSettings`): easy, sci-fi,
  reduced guns, save anywhere, blood on. `gameOptions(request)` builds a fresh object with these, except `difficulty`,
  whose API default is 2 (`API_DEFAULT_DIFFICULTY`, documented for agents); another difficulty throws. The front-end
  forms preselect the original's easy and always send all five fields.
- **One object.** The strategic state owns the options; a loaded sector's `TacticalState.options` and
  `EquipmentState.options` are the same object (sight reads `t.options.difficulty`, the equipment its gun nut and sci-fi
  flags), so the army gun choice (`items.gunChoice`) honours gun nut in campaigns. A sandbox owns its own object. The
  codec re-links the alias like any other.
- **`newSession {campaign: {options}}`** takes any of the five fields; `campaign.difficulty` and `campaign.saveMode`
  stay accepted as aliases (old input logs replay), and an alias that contradicts `options` is refused. `deadIsDeadName`
  and `deadIsDeadDescription` stay campaign fields: they name a server file, not a game option (§1.6).
- **Native saves.** `importNativeGameOptions` maps the header record (`SavedGameOptions`,
  `src/content/formats/savegame-header.ts`; `14` §2): `saveMode` from `ubGameSaveMode`, blood and gore on (it lives in
  the user's `Ja2.set`, not in the save), `turnTimeLimit` reported in `dropped` (the import report's and `listSaves`'
  `droppedOptions`).
- `status`, `observe`, `GET /api/sessions`, the save header and `listSaves` show `options` (`04` §6).

**Blood and gore** is the only toggle that is both changeable at any time in the original and outcome-relevant, so it
changes through a command: `setOption {bloodAndGore}` (`parseOptionChange`, `applyOptionChange`), logged and replayed
like every command, accepted in any flow before the story refusals (also in a meanwhile, the endgame and the laptop),
refused with `promptOpen` while a battle, contract, militia or NPC prompt is open and with `badOption` for anything
else; it changes the shared object, so it applies from the next tick, and reports `optionChanged {bloodAndGore}`. It
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
presentation: the simulation's timing is fixed (a line lasts the longer of its voice and its text, `24` §10.2,
deviations "Speech"; one bullet tile per tick). `SLEEPWAKE_NOTIFICATION` maps onto the client's or agent's choice to
stop a strategic `advance` on `fellAsleep`/`wokeUp` events (`advance {until: {events}}`, `04` §4.2): the pages'
real-time driver and advance apply the client setting (`src/app/sleep-wake.ts`, `src/app/net/sleep-wake-stop.ts`), an
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
| `playbackSpeed` | 0.25, 0.5, 1, 2, 4, 8, 16; 1 | ja2-node (`04` §6.9) |
| `language` | a UI language or null | `27` §5 |
| `meanwhileScenesSeen`, `helpHidden`, `helpScreensSeen` | a 32-bit scene mask; false; a 16-bit mask per campaign identity (at most 32 campaigns) | `Ja2.set`; the help mask is saved per campaign instead of in the save (deviations "Help screens seen") |
| `coverSize`, `losSize` | 4–11, 4 | `DisplayCover.cc` `DC__MIN_SIZE`, `DC__MAX_SIZE` |
| `playSplash`, `playIntro` | true, true | ja2-node (§4.4) |
| `uiScale`, `fixed640`, `websiteLoadingTimeScale` | auto; false; 0–10, 1 | ja2-node (`28`) |

The launcher exports and imports the settings as a JSON file `{format: 'ja2-node-settings', settings}`, normalized on
import. **Not read yet:** `display.oldSelectionMethod`, `display.showMisses` and `display.smartCursor` (toggles on the
options screen only), `coverSize`, `losSize`; `display.dontMoveMouse` is inert by design (deviations "Pointer warp").

### 2.5 Deviations

"Key-advance speech" (the simulation never waits; the client only holds the subtitle), "Sleep and wake notification" (a
client stop condition), "Timed turns" (not ported), "Help screens seen" (`deviations.md`). There is no policy deviation:
the policy stays content.

---

## 3. Sound and music

### 3.1 The original's sound system

**Mixer** (`src/sgp/SoundMan.cc`): miniaudio decoding (WAV, plus OGG through stb_vorbis, `:33-46`), 16-bit stereo output
at the device rate (`:85-88`), **16 channels** and a new sound is dropped when all are busy, nothing is stolen (`:82`,
`:243-244`); a 128-entry sample cache with least-hits eviction (`:81`, `:809-831`), files over 1 MB streamed (`:91`).
Volume 0–127 (`src/sgp/SoundMan.h:9`), pan 0 (left) – 127 (right) as a **linear balance**, `vol_l = vol·(127−pan)/127`
(`src/sgp/SoundMan.cc:928-946`). The end callback fires for stopped sounds too (`:571-589`). `loop = 0` plays once in
Stracciatella (`:533-538`). There is no master volume; three categories exist: effects, speech and music, each 0–127
with a settings default of 63 (`GameSettings.cc:138-141`).

**Effects** (`Utils/Sound_Control.cc/.h`): 291 sound ids (`Utils/Sound_Control.h:28-324`) mapped to 237 paths under
`sounds/` (`Utils/Sound_Control.cc:17-310`); 14 ambient ids (`Utils/Sound_Control.h:334-352`). `PlayJA2Sample` scales
by `CalculateSoundEffectsVolume(v) = (v·vol + 63)/127` (`Utils/Sound_Control.cc:336-352`, `:456-459`);
`PlaySoldierJA2Sample` skips soldiers that are not visible when asked to and scales twice (`:409-420`, a quirk).
**Positional rules**: `SoundVolume(base, grid)` is `base` on screen and `max(25, base − 25)` off screen, no falloff
(`:555-592`); `SoundDir(grid)` is 64 within ±64 px of the screen centre, 48 or 80 within half the view, 1 or 126 beyond
(`:499-552`). Looping positional sounds (10 slots, linear falloff over 1.5 views, `:601-844`) are used only by the
creature queen's ambient noise (`Tactical/Soldier_Control.cc:574`). Constants: pans 0/48/64/80/127, volumes 25/40/65/127
(`Utils/Sound_Control.h:10-21`).

**What plays what:**

| Source | Rule | Where |
|---|---|---|
| Animation opcodes 700–798 | fall, footsteps, splats, lock-and-load (weapon's `sLocknLoadSound`), throwing knife, creature steps and attacks, falls to ground (721/722, next to the fragile-item damage the simulation ports), swooshes, death battle sound (732), stance changes 773–776 (not in stealth), pick-up 777, deep water, cows, crows, mortar, fence | `Tactical/Soldier_Ani.cc:1963-2540`; random idle sounds `:1492-1498` |
| Footsteps | by terrain under the soldier (`WALK_LEFT_OUT`, `_IN`, `_ROAD`, water, swim, crawl); a variant different from the last one (`ubLastFootPrintSound`, saved); LOW volume in real time unless selected | `Tactical/Soldier_Control.cc:8820-8887` |
| Gunfire | `silencedSound` with a silencer, else `sound`; a burst plays one file `burstSound` formatted with the rounds left, falling back to the single shot or `bursttype1`; a jam stops it and plays the dry fire | `Tactical/Weapons.cc:543-644`; per-calibre defaults in `calibres.json`; `Tactical/Soldier_Ani.cc:669-676` |
| Reload | per weapon class | `Tactical/Items.cc:1291-1294`, `src/externalized/WeaponModels.cc:770-1206` |
| Impacts and misses | bullet or knife impact then `BATTLE_SOUND_HIT1`; misses by kind; glass; per-material structure hits | `Tactical/Soldier_Control.cc:2846-2873`, `Tactical/Weapons.cc:1709-1755`, `:1942`, `TileEngine/Structure.cc:68-96` |
| Battle sounds | 17 kinds with variants, repeat filter 2 s, critical ones cut speech; `battlesnds/<voice>_<name>.wav`, generic `bad`/`kid`/`m_`/`f_` sets for soldiers without a profile; option `MUTE_CONFIRMATIONS` drops OK; morale < 35 uses the low-morale variants | `Tactical/Soldier_Control.cc:138-157`, `:5866-6115` |
| Explosions | one of the animation's candidate files | `TileEngine/Explosion_Control.cc:231-233`, `explosion-animations.json` |
| Doors and openables | open by door kind (wood, cloth, garage, metal) when the opener makes door noise; close delayed to the animation key frame; locks: unlock, key failure, broken lock, electricity | `Tactical/Handle_Doors.cc:936-1032`, `TileEngine/Structure.cc:1868-1883`, `Tactical/Keys.cc:176-576` |
| Items | drop, attach, canteen, throw impacts, mortar whistle, vehicles | `Tactical/Soldier_Ani.cc:2338`, `Tactical/Items.cc:1570-1577`, `TileEngine/Physics.cc:432-1974`, `vehicles.json` |
| UI | button clicks by screen scheme at volume 15; A.I.M. static; I.M.P. voice preview | `src/sgp/Button_Sound_Control.cc:11-111`, `Laptop/AIMMembers.cc:1951-2054`, `Laptop/IMP_Voices.cc:249-250` |

**Ambient** (`TileEngine/Ambient_Control.cc`): the tileset's ambient id (from `ja2set.dat`) selects `ambient/<id>.bad`,
a count and up to 100 entries `{minTime, maxTime, timeCategory, file, volume}` (`TileEngine/Ambient_Types.h:7-22`);
entries are scheduled as ranged strategic events per time of day (dawn 6:47–7:05, day –20:57, dusk –21:15, night –6:47,
`TileEngine/Environment.cc:26-34`, `:289-316`) and played by `SoundPlayRandom` with real-time gaps
(`src/sgp/SoundMan.cc:289-443`). Nothing in basements and caves (`TileEngine/Ambient_Control.cc:41-60`). Rain and
thunder are dead code (`TileEngine/Environment.cc:160-183`).

**Music** (`Utils/Music_Control.cc`, modes in `src/externalized/content/ContentMusic.h:3-17`, tracks in `music.json`, in
`data/externalized`): `NONE`, `RESTORE`, `MAIN_MENU`, `TACTICAL_NOTHING`, `TACTICAL_ENEMYPRESENT`, `TACTICAL_BATTLE`,
`TACTICAL_VICTORY`, `TACTICAL_DEFEAT`, `LAPTOP` and the three creature variants, which replace
nothing/enemy-present/battle while `gfUseCreatureMusic` is set (`Utils/Music_Control.cc:268-286`, set by
`PrepareCreaturesForBattle`, `Strategic/Creature_Spreading.cc:808-828`). A track is chosen with `Random(count)` from the
gameplay generator (`src/externalized/DefaultContentManager.cc:1097-1105`). No fade-in
(`Utils/Music_Control.cc:314-316`); fade-out one volume step per 10 ms (`:147-178`), five times faster on sector entry
and exit (`Strategic/StrategicMap.cc:529`, `:1842`). When a track ends the next random track of the mode starts; after
the victory track the mode becomes `TACTICAL_NOTHING`; after the defeat track the sector is unloaded and nothing starts
(`Utils/Music_Control.cc:182-210`). Starting a victory track above ground clears `gfUseCreatureMusic` (`:289-295`).
`SetMusicMode` remembers the replaced mode; `RESTORE` returns to it. The mode is saved and restored
(`SaveLoadGame.cc:1827`, `:1964`); the previous mode is a process static. Where modes are set:

| Mode | Set when |
|---|---|
| `NONE` | splash, intro, leaving the game init screen, restart |
| `MAIN_MENU` | main menu, loading a save (until the sector's mode applies), meanwhile scenes |
| `LAPTOP` | entering the laptop; leaving restores the previous mode (`Laptop/Laptop.cc:446`, `:551-561`) |
| `TACTICAL_NOTHING` | sector entry without hostiles, a battle ending without a fight, retreat, boxing exit, creature town attack (`Strategic/StrategicMap.cc:524-531`, `Tactical/Overhead.cc:4636`) |
| `TACTICAL_ENEMYPRESENT` | an enemy placed in an untouched sector without known enemies, outside the game start and meanwhile scenes (`SetEnemyPresence`, called by `AddSoldierToSectorGridNo` and `EnterCombatMode`, not by a sighting), leaving combat with enemies left, the first helicopter drop, the PBI, the end of a meanwhile (`Tactical/Overhead.cc:4080`, `:4124`, `:4369`, `Tactical/Soldier_Add.cc:928`) |
| `TACTICAL_BATTLE` | entering combat (`Tactical/Overhead.cc:3974-3979`); a sighting in combat while no music plays (`Tactical/OppList.cc` `OurTeamSeesSomeone`) |
| `TACTICAL_VICTORY` | a won tactical battle unless the last kill was a monster, an autoresolve win, the Queen's death (`Tactical/Overhead.cc:4598-4603`, `Strategic/Auto_Resolve.cc:1298`, `Tactical/End_Game.cc:163`) |
| `TACTICAL_DEFEAT` | a lost tactical battle, autoresolve loss or surrender (`Tactical/Overhead.cc:4478`, `Strategic/Auto_Resolve.cc:1319-1330`) |

The map screen never sets a mode: whatever played continues.

**Speech** (`src/externalized/content/Dialogs.cc:52-109`): mercs `speech/<voice>_<quote>.wav`, NPCs and unhired R.P.C.s
`npc_speech/<id>_<quote>.wav`, alternate dialogue `npc_speech/d_…`, Russian R.P.C.s `speech/r_…` (`27` §5.1). Played at
speech volume with a lip-sync list from the matching `.gap` file (`{start, end}` ms pairs, `Tactical/Gap.cc:13-120`);
the mouth frame is `Random(6)` every 120 ms (`Tactical/Faces.cc:1057-1067`).

### 3.2 The data

On the user's data (formats only; nothing copied): `Sounds.slf` 370 WAV (PCM, mono and a few stereo, 8 and 16 bit,
11.025/22.05/44.1 kHz, up to 17 s); `BattleSNDS.slf` 1,581 WAV, almost all **IMA ADPCM** (format tag 0x11, 4-bit,
22.05 kHz mono); `Speech.slf` 5,774 and `Npc_speech.slf` 2,794 WAV, all IMA ADPCM, with a `.gap` file beside almost
every one (8,353 in all); `Music.slf` 14 WAV, PCM 16-bit stereo 22.05 kHz, up to about two minutes; `Ambient.slf` 9 WAV
and one `.bad` table (`ambient/0.bad`, ten entries); `Laptop.slf` holds the laptop sounds; two loose `stsounds/*.wav`.
Speech and music are about 500 MB together: they are fetched lazily per file through `/vfs`, never bundled. Browsers
decode PCM WAV natively but IMA ADPCM WAV is not reliably supported by `decodeAudioData` (inferred from the Chrome and
Firefox codec lists), so ja2-node decodes WAV itself; every WAV of `sounds.slf`, `battlesnds.slf` and `music.slf` and
every `.gap` file decodes.

### 3.3 Presentation rules

**Nothing in `sim` plays, waits for or draws on behalf of sound** (D2, D13, D14). The client derives every sound from
what it already receives: view frames, the event log (`04` §6.9) and the animation timelines it plays (`01` §3.4).
Headless sessions and agents produce no audio, and the outcome is identical with sound on, off or absent. The one
audio fact the simulation reads is data, not playback: the length of each voice sample, measured from the WAV headers
into the rule pack (`@rules/speech/lengths.json`, `src/content/audio/speech-lengths.ts`), which times conversation lines
(`24` §10.2).

**Cosmetic choices** (variants, ambient gaps, footstep alternation, music tracks, the miss curse's `Random(40)`) use a
client PRNG (`ClientRandom`, `src/audio/client-random.ts`, seeded from the session id by `seedFromText`), never a
simulation stream. The client keeps its own presentation memory per soldier (last footstep variant, battle-sound memory
for the 2 s filter).

**Where the original's gameplay depends on sound**, and what ja2-node does instead:

| Original coupling | ja2-node |
|---|---|
| A quote ends when its sample stops (`Tactical/Faces.cc:627-629`), plus 300 ms | the longer of the voice length and the text timer, then 300 ms; the viewer that finished first ends it through `skipLine` (deviations "Speech", `24` §10.2) |
| A quote waits for the speaker's battle sound (`Tactical/Dialogue_Control.cc:632-637`); critical battle sounds cut speech (`Tactical/Soldier_Control.cc:5973-5980`) | the simulation never waits and is never cut ("Speech"); the client still stops the playing voice on a critical battle sound ("Speech playback") |
| The defeat track's end unloads the sector (`Utils/Music_Control.cc:188-193`), in parallel with a 10 s timer (`Tactical/Overhead.cc:4378-4381`) | the 10 s timer only (`src/sim/campaign/battle-flow.ts`) |
| Skyrider's destruction runs in a sound's end callback (`Strategic/Map_Screen_Helicopter.cc:1041-1044`) | at once (deviations "Helicopter destruction") |
| `EVENT_AMBIENT` events carry sound-cache slots in the saved queue (`Strategic/Game_Event_Hook.cc:101`) | not queued, dropped on import ("Ambient sound events") |
| Sound picks draw on the gameplay generator: `SoundRange`, footstep variants, battle-sound variants, explosion sounds, door sounds, the music track, ambient timing, mouth frames, cows, crows, bloodcat growls | not drawn, or drawn from the client PRNG ("Cosmetic draws …", "Footstep variants", "Music track choice") |
| The first helicopter drop waits for the engine sound to fade before unlocking and calling in enemies (`Tactical/Merc_Entering.cc:529-562`) | the drop sequence is not ported: `INSERTION_CODE_CHOPPER` places the mercs at the north entry point at once (deviations "Helicopter entrance"); when it is ported, its end must follow the script's ticks, never a fade |

**Event facts for sound** are optional event fields, never state and never read back by the simulation (the event
catalogue is `04`): `shotFired {item, silenced, burst, rounds}` (`rounds` = the burst size on the first bullet of a
burst, 0 on the others, 1 for a single shot), `bulletStopped {material, caveWall}`, `explosion {animation}` (the water
variant when shown), `doorChanged {kind: wood | cloth | garage | metal, noisy}` (`noisy` = the opener's door noise at
code 495), `reloaded {soldier, item}`. Soldier views carry `voice` (the profile's voice id as three digits, I.M.P.
voices included, or the generic `badN`/`kidN` set) and `bodyType` (the `m_`/`f_` fallback). Sessions attach the events
drained during an advance to the view frame of their tick (`ViewFrame.events`). Terrain under a soldier comes from the
client's own world model. A source the squad does not see plays from where the squad hears it (`heard`,
`src/content/audio/heard-place.ts`; deviations "Sounds out of sight").

### 3.4 Sound in ja2-node

**Data.** `data/tables/sound-effects.json` (`sounds` in `SoundID` order with a VFS path, null where the original has
none; `ambient` in `AmbientSoundID` order; `files`, the paths the game code names literally; the pan and volume
constants) and `battle-sounds.json` (`kinds` in `BattleSound` order with `randomVariants` = `ubRandomVal`, `badGuy`,
`dontAllowTwoInRow`, `stopDialogue` 0 never / 1 cuts speech / 2 skipped while talking; the 2000 ms repeat filter and
the low-morale threshold 35), transcribed by `tools/transcribe/sound-effects.ts`; each file's `format` field describes
its fields. Weapon, explosion and vehicle sounds come from `weapons.json`, `calibres.json`,
`explosion-animations.json` and `vehicles.json` in `data/externalized`.

**Content** (`src/content/`, DOM-free, unit-tested):

| Module | Content |
|---|---|
| `formats/wav.ts` | RIFF/WAVE: PCM 8/16-bit and IMA ADPCM (0x11) to `Float32Array` per channel, `readWavInfo` and `wavDurationMs` from the header; other tags fail with a clear error |
| `formats/gap.ts`, `formats/ambient.ts` | `.gap` `{start, end}` pairs (8 bytes each); `.bad` tables (an `INT16` count and 116-byte entries `{minTime, maxTime, timeCategory, file[100], volume}`, at most 100) |
| `audio/sound-position.ts` | `soundVolume`, `soundDir`, `positionSoundVolume`, `scaleVolume` = `trunc((v·setting + 63)/127)`, the mixer's linear balance `trunc(vol·(127−pan)/127)/128` per side |
| `audio/cue.ts` | a cue `{file, baseVolume, mix, bus, gridNo, pan, loops}`; the mix rule encodes how the original computes channel volume and pan: `location` (`PlayLocationJA2Sample`), `soldier` (`PlaySoldierJA2Sample`, effects scaling twice), `fixed`, `panned` (misses: fixed volume, `SoundDir` pan), `voiceOwn`/`voiceOther` (battle sounds at speech volume, `SoundVolume` for other teams), `creatureVoice`, `speech`, `ambient`, `music`, `positionLoop`; buses effects, speech, music, ambient |
| `audio/sound-table.ts`, `audio/cue-book.ts` | the two tables; sound ids, battle sounds, weapon sounds with calibre defaults and reload/lock-and-load per weapon class, explosion candidates |
| `audio/cues.ts` | footsteps by terrain, gunfire with burst names and the single-shot and `bursttype1` fallbacks, dry fire, reload, lock and load, impacts, misses, material hits, explosions, doors by kind, lock outcomes, door traps, drops, codes 700–798, laptop power |
| `audio/battle-sound.ts` | substitutes for creatures, animals and the robot, the 2 s filter, the still-playing and talking rules, mute confirmations, low-morale variants, variants, the `_dying` and `m_`/`f_` fallbacks |
| `audio/speech.ts` | the speech file of a spoken line (the Russian `r_` prefix) |
| `audio/ambient-schedule.ts` | time windows, gaps `min + R(max − min)` ms on the client PRNG, silence in basements and caves |
| `audio/idle-sounds.ts`, `audio/creature-call.ts`, `audio/heard-place.ts` | code 491 idle sounds counted from the passes of the loop that holds it (the server sends no frames of a predictable loop); creature cry codes 707 and 717; the tile an unseen sound plays from |
| `audio/speech-lengths.ts`, `audio/music-table.ts` | voice lengths for the rule pack (§3.3); `music.json` |
| `anim/timeline-follower.ts` | the script codes passed between two view snapshots of a soldier: within a state, across loops and into the next state, keeping the old tail only when it ends or jumps there within two frames |

**Audio layer** (`src/audio`, browser; imports `content` and `protocol` only):

- `engine.ts` (`AudioEngine`): buses effects, speech, music and ambient into a master gain; `MAX_VOICES` 16, a new voice
  dropped when all are busy; two gains per voice for the linear balance (not `StereoPannerNode`, whose equal-power law
  differs) and a splitter for stereo files; an LRU of 128 decoded buffers (`buffer-cache.ts`, like the original's
  cache); the own WAV decoder; lazy `/vfs` loads, missing and undecodable files counted and never refetched; nothing
  starts at master or channel volume 0; unlock on the first gesture; sample rate from the device; `playBuffer` for
  one-shot decoded audio (video sound, §4.4).
- `director.ts` (`SoundDirector`): frames, events and replayed animation codes → cues; per-soldier presentation memory
  (timeline position, last footstep variant, battle-sound memory and voice, death cry played, last weapon and attack
  kind); a speech queue (developer pages; on `/play` the speech presenter `src/ui/speech.ts` owns voice and subtitle,
  `28`); ambient scheduling from the tileset's table and the view's world clock (a session without one, the sandbox,
  counts as noon); frames more than 100 ticks behind the newest applied one (`CATCH_UP_TICKS`) update the memory
  silently, so a skip or a manual advance does not replay its sounds.
- `positional.ts`: the listener from the client camera and view size; the creature queen's positional loop while she is
  in view (deviations "Queen's positional sound").
- Wiring: `src/app/sound/tactical-sound.ts` (`TacticalSound`, for the tactical host of `/play` and the devtools
  tactical page; `window.__ja2Audio` exposes the engine counters, the director's statistics and the last files),
  `src/app/sound/strategic-sound.ts` (laptop power sounds, `window.__ja2Music`), `src/app/game/ui-audio.ts` (the engine
  of `/play`).

### 3.5 Music in ja2-node

**The music mode is player-visible state, so the server computes it** (deviations "Music mode on the server"); the
client only chooses tracks and fades.

- **Modes** (`src/protocol/music-modes.ts`): the twelve `MusicMode` values in the native byte order (`ContentMusic.h`;
  `musicModeOfNativeByte`), the `music.json` key of each playable mode (`MUSIC_TRACK_KEYS`), the creature variants of
  nothing, enemy present and battle (`CREATURE_VARIANTS`), the end rules (`nextTrack`; the victory track `thenNothing`;
  the defeat track `thenSilence`), the 10 ms poll step (`MUSIC_OVERHEAD_MS`) and the fade steps 1 and 5.
- **`musicMode(prev, events, facts)`** (`src/protocol/music.ts`, pure). `setMusicMode` reproduces `SetMusicMode`: any
  set remembers the replaced mode as `previous`; `RESTORE` returns to it, but to the nothing mode after the victory or
  defeat track. Events are applied in order; the facts are read from the session after the events (`MusicFacts`: the
  creature flag, combat, whether a sector is loaded, the hostiles of the loaded sector (`NumHostilesInSector`), the game
  start):

| Event | Mode set |
|---|---|
| `sectorLoaded {hostiles, enemyPresence?, firstArrival?}` | enemy present if `SetEnemyPresence` fired while loading; then the entry rule: if `mode == ENEMYPRESENT ? hostiles == 0 : mode != BATTLE` → nothing with a fast fade; then enemy present for the first helicopter drop |
| `enemyPresence` | enemy present (later presence, such as reinforcements arriving in an untouched sector) |
| `combatStarted`; `enemySighted` in combat while no music plays | battle |
| `combatEnded` | `lull`: enemy present; `lost`: enemy present after a battle, then defeat; `won`: enemy present after a battle, then nothing without a fight, victory if the last kill of a merc was no monster (`fought`, `monsterKill`); `boxing`: enemy present after a battle, then nothing |
| `preBattle` | enemy present, twice (`PrepareForPreBattleInterface` and `InitPreBattleInterface` both set it; once for an automatic creature attack) |
| `retreated` from the prebattle screen | nothing |
| `arBattleOver` | victory; defeat for defeat, surrender and capture |
| `laptopOpened`, `laptopClosed` | laptop; restore, or the laptop again before the first landing |
| `meanwhile` (a resolved scene) | menu, then with a loaded sector enemy present if hostiles and the entry rule |
| `meanwhileStarted`; `meanwhileEnded` of the interrogation | menu, then with a loaded sector the entry rule (N7); enemy present |
| `queenKilled`, `creatureQueenKilled` | victory |
| `squadMovedUpstairs` | enemy present, victory, victory |
| `creatureAttack` | nothing |
| `mercsLeftSector {mapScreen}` | nothing with a fast fade |

- **Simulation facts.** The sector flow records whether `SetEnemyPresence` fired while loading through
  `SectorHooks.enemyPresence`, outside the game start and meanwhile scenes. `turn.lastMercKill` ports
  `gLastMercTalkedAboutKilling` (the enemy killed by a merc's attack; deviations "Last kill talked about"). The
  creature battle setup sets `useCreatureMusic` as `PrepareCreaturesForBattle` does (the map's light colour has blue,
  creatures in the level, a town attack), and the simulation clears it at the moment the victory mode is set above
  ground (a fought tactical battle won without a monster as last kill, an autoresolve victory, the queens' deaths, the
  move upstairs), so native saves and ours carry the same flag (deviations "Creature music clear").
- **Session state.** `Session` keeps `music {mode, previous}` beside the simulation: a new campaign starts at none and
  follows the events of its creation (the new game's laptop, the landing; held for the next report); a sandbox starts at
  enemy present or nothing (as entering a sector); a native import at the saved byte (`SaveLoadGame.cc:1827`) with the
  menu as previous (the load sets the menu first); a ja2-node load at the file's `presentation.music`. After every
  captured frame the drained events update it; `welcome` carries `music {mode, creature}` and frames carry it when the
  mode or the flag changes (`fastFade: true` on the frame of a fast change). `observe` and the simulation's own view
  carry no music. A command's change shows with the next advanced frame.
- **Client player** (`src/audio/music.ts`, `MusicPlayer`; `src/app/net/music.ts` builds it with a `ClientRandom` seeded
  from the session id): a new mode fades the playing track out by one volume step per `poll()` (the pages poll every 10
  ms; five steps after a sector entry or exit) and then starts a track of the new mode at once at the music volume (no
  fade-in), chosen with the client PRNG; when a track ends the next random track of the mode follows, the victory track
  switches the player to the nothing mode (the server keeps the victory mode) and the defeat track ends in silence; the
  creature flag picks the creature tracks when a track starts; music volume 0 (or mute) stops the music and raising it
  starts it again, as `MusicSetVolume` does.

### 3.6 Speech

On a quote event with a text key (`mercQuote`, `npcQuote`, conversation lines, `civQuote`) the client resolves the file
by the `Dialogs.cc` rules (`src/content/audio/speech.ts`) and plays it on the speech bus; the next line waits for the
sample, a simulation-side line end never cuts it, a critical battle sound of the same speaker still stops it
(deviations "Speech playback"). Subtitles are a client setting; the text comes from the event's resolved text or
`/api/text` (`27` §5.2). Lip-sync from the `.gap` files and the mouth frames belong to the canvas faces (`28`).

### 3.7 Stubs

Stub sounds, music and speech blips are synthesized originals named like the original paths (`27` §6.3), so the cue
tables and `music.json` resolve unchanged; one synthesized file serves many names through the stub alias manifest.
`stubs/ambient.ts` writes `ambient/0.bad` for the stub tileset (own entries: birdsong, owl, crickets) whose sounds alias
the synthesized ambient classes. The stub walking, running, swatting and crawling scripts carry 703/704, the stance
transitions 773–776 and the pick-up scripts 777 (the simulation ignores these codes). Missing files are skipped
silently, as the original skips failed plays.

### 3.8 Quirks kept, deviations and limitations

**Quirks kept:** 16 voices, a new sound dropped when all are busy; linear balance panning; off-screen sounds 25 quieter
with a floor of 25 and no distance falloff; footstep variants never repeat twice in a row; the 2 s battle-sound repeat
filter; soldier sounds scaled twice (`PlaySoldierJA2Sample`, `mix: 'soldier'`: audible only as quieter soldier
sounds); no music fade-in; the map screen keeps whatever plays; victory falls back to the nothing mode, defeat to
silence; the laptop restores the previous mode.

**Deviations** (`deviations.md`): "Music track choice", "Footstep variants", "Speech playback", "Ambient timing",
"Sounds out of sight", "Queen's positional sound", "Idle sounds of unseen animals", "Music mode on the server", "Last
kill talked about", "Creature music clear", "Ambient sound events".

**Limitations.** Not played yet (deviations "Sound coverage"): the movement sound of a driving vehicle and the turret
of a turning tank (nothing drives a vehicle or turns a tank in tactical; `vehicleMoved` does not exist), a vehicle's
battle sounds; the boarding sound plays on the map screen at full volume. Button click schemes
(`src/sgp/Button_Sound_Control.cc:11-50`) are the canvas UI's (`28`).

---

## 4. Video

### 4.1 The original

**The videos** are Smacker files named in `Intro.cc:34-78` (`INTRODIR` = `intro`, `Directories.h:14`): four for the
beginning (`rebel_cr`, `omerta`, `prague_cr`, `prague`), five for the ending (`throne_mig` or `throne_nomig`,
`heli_flyby`, `heli_sky` or `heli_nosky`), the splash (`splashscreen`) and a TalonSoft logo that is never played
(`talonsoftid_endhold`, `Intro.cc:322`, commented out). SMK is used by `Intro.cc` only: the A.I.M. video conference is
the animated face system with STI static (`Laptop/AIMMembers.cc:1619-1627`, `:1866-1899`), the helicopter drop of a new
game is a tactical animation (`Tactical/Merc_Entering.cc:686-700`), and meanwhile scenes are tactical scenes (`26`
§1.6).

**Sequences** (`GetNextIntroVideo`, `Intro.cc:252-329`; the mode enum `Intro.h:12-18`):

| Sequence | Videos | Started by | Followed by |
|---|---|---|---|
| `INTRO_SPLASH` | the splash | process start, English and Chinese versions only (`src/sgp/SGP.cc:441-444`); other versions blit an MLG splash picture (`JA2_Splash.cc:17-25`) | the Sir-Tech logo picture (`Intro.cc:364-370`), then the main menu after 500 ms (`JAScreens.h:8`) |
| `INTRO_BEGINING` | the four beginning videos in order (`Intro.cc:262-278`) | every new game, after the game init options screen (`GameInitOptionsScreen.cc:725-730`); in Dead is Dead mode after the save screen (`:722-723`, `SaveLoadScreen.cc:1476-1494`) | `INIT_SCREEN` → `InitNewGame` → the laptop (`Intro.cc:229`, `JAScreens.cc:181-185`) |
| `INTRO_ENDING` | Miguel's throne video by `gMercProfiles[MIGUEL].bMercStatus == MERC_IS_DEAD`, the fly-by, Skyrider's helicopter video by the same test on SKYRIDER (`Intro.cc:289-311`) | `DoneFadeOutEndCinematic` (`Tactical/End_Game.cc:351-366`, `26` §6.7) | `ReStartingGame()` and the credits (`Intro.cc:239-245`), then the main menu (`Credits.cc:169-186`) |

No setting turns the intro off; the beginning sequence plays on every new game and can only be skipped. Skipping
(`Intro.cc:199-217`, on key up): Escape ends the sequence, Space or any mouse button ends the current video. While a
sequence plays the screen is black, the cursor hidden and the music off (`Intro.cc:126-134`).

**Playback** (`Utils/Cinematics.cc`, the only caller is `Intro.cc`): the file is read whole and decoded by libsmacker
(`:200-209`); all audio tracks are decoded up front into buffers and started together with the video (`:122-178`);
frames are paced by the wall clock and late frames are decoded but not shown (`:259-271`); each frame is an 8-bit image
with a 256-colour palette converted to 16-bit and blitted 1:1 at the centre of the screen, without scaling (`:282-316`,
`UILayout.cc:13-14`). A missing or broken file is logged and skipped, so a sequence with no files exits at once
(`Utils/Cinematics.cc:193-219`, `Intro.cc:339-342`).

**Credits** (`Credits.cc`): `interface/credits.sti` with blinking faces, the text from `binarydata/credits.edt` (rows of
80 characters, `src/externalized/strings/EDT.h:61-65`, whose comment says 496 rows; the English Gold file has 248, and
row 0 is never read because the record counter is incremented before the first read) with inline `@` control codes for
gaps, speed, justification and colours (`Credits.cc:44-58`, `:460-502`), scrolled 1 px every 25 ms (`:71-76`); 15
hoverable faces with names from the compiled strings (`:108-127`, `Utils/Text.h:212-214`). The main menu reaches the
credits too (`MainMenuScreen.cc:217-220`).

### 4.2 The data

On the user's Steam 1.12 data (formats only): the eleven videos sit in an archive named `Intro-old.slf` whose library
path is `intro\`; the Steam package appears to rename it so that its own executable skips the intro (inferred).
Stracciatella mounts every SLF it finds (`rust/stracciatella/src/vfs/mod.rs:129-150`, library path from the header,
`rust/stracciatella/src/vfs/slf.rs:62`), and so does ja2-node (`src/node/data-vfs.ts`), so the files resolve as
`intro/<name>.smk` either way. All are version-2 Smacker (`SMK2`, flags 0), 640×480, 15 frames per second (the splash
30), with one audio track: compressed, 16-bit stereo, 44.1 kHz. Sizes range from about 0.6 to 30 MB, about 70 MB in
all.

### 4.3 Decoder

`src/content/formats/smk.ts`: DOM-free and Node-free like every decoder (D8), written from the public description of
Smacker (RAD's format; no SFI header). libsmacker, which Stracciatella bundles (`dependencies/lib-smacker/LICENSE.txt`,
LGPL 2.1), is neither read nor ported (`01` §5.3).

- `openSmk(bytes)` reads the 104-byte header, the frame size and type tables and the four Huffman trees (mono map, mono
  colours, full, type): 16-bit trees built from two 8-bit trees, with three escape leaves that return the three most
  recently decoded values, reset at every frame.
- `decodeAudio(video, track)` decodes every chunk of a track up front into an `Int16Array` per channel: Huffman DPCM
  with per-chunk trees, 8 and 16 bit, mono and stereo, wrap-around deltas; uncompressed 8/16-bit PCM is copied.
- `createFrameReader(video).nextFrame()` returns `{index, indices, palette, paletteChanged}`; the index buffer and the
  palette are reused across frames because void blocks keep the previous picture (copy them to keep them). Palette
  chunks: skip, copy from the previous palette, 6-bit colours scaled by `(c << 2) | (c >> 4)` (`sixBitToEight`). Block
  types mono, full, void and solid, chained by the 64-entry run table (`SMK_RUN_LENGTHS`).
- Refused with a clear error: ring frames, Y-interlaced and Y-doubled files, Bink audio and SMK4 (none of the game files
  uses them, and SMK4's extra full-block modes could not be checked against a sample).

On the user's data every video decodes and its audio is as long as the video to within one frame. A 640×480 frame
decodes in about 1.4 ms on average and under 9 ms at worst (the first, full frames) in Node, the audio of the longest
video (`throne_nomig`, 2 minutes) in about 0.4 s, so a Worker keeps up with 15 and 30 fps easily.

### 4.4 Player and sequences

**Presentation only.** No video blocks the simulation or the server. The beginning intro plays in the browser while the
new campaign session already exists and waits in its laptop flow (which needs no input until the player acts); the
ending plays after `campaignWon` from `observe.ended.ending {miguelAlive, skyriderAlive}` (`26` §7), which carries
exactly the two choices of `GetNextIntroVideo`. Agents never see videos.

**No transcoding.** Nothing is converted to WebM or MP4, neither in the repository nor in a server cache: the browser
decodes the user's own files. A server-side transcoder would add a native dependency for about 70 MB of video that a
client decoder handles in real time.

**Player** (`src/app/video/`):

- `player.ts` fetches `/vfs/intro/<name>.smk` whole (404 → `missing`, skipped) and opens it in a module Worker
  (`decoder-worker.ts`, which decodes the audio up front and converts it to float; messages in `worker-protocol.ts`). It
  draws through `src/render/indexed-frame.ts` (WebGL2: an R8UI index texture and a 256×1 RGB palette texture, sampled
  with `texelFetch`) at the largest integer scale that fits the window (`integerScale`; deviations "Video scaling").
- `sound.ts` plays the audio as one buffer on the audio engine's music bus (`AudioEngine.playBuffer`, full volume as the
  original's `MAXVOLUME`, under the master gain and mute) or on a plain `AudioContext` (`contextSound`).
- `pacing.ts`: frames are paced by the audio clock (the time since the buffer started); without a running audio context,
  with the master at 0 or for a silent video the wall clock paces instead (deviations "Video pacing"). Each animation
  frame asks the Worker for the newest due frame; the Worker decodes every frame up to it and posts only that one, so
  late frames are decoded but never shown, as in `SmkSkipFrames`; the video ends when the frame after the last one is
  due.
- `sequence-player.ts` covers the screen with a black, cursorless overlay and handles the keys of `Intro.cc`: Escape
  (key up) ends the sequence, Space (key up) or any mouse button (down) ends the current video. It downloads the
  sequence's files one after another from its start (`download-queue.ts`), so the next video arrives while the current
  one plays; a key or click during a download skips at once while the download runs on into the browser cache, and an
  ended sequence starts no further download.

**Sequences** (`src/app/video/sequences.ts`): the eleven names (`IntroVideo`), `splashPlan` (the splash only, then the
main menu; the TalonSoft logo is never played), `beginningPlan` (the four beginning videos, then the new game) and
`endingPlan({miguelAlive, skyriderAlive})` (throne video by Miguel's death, the fly-by, the helicopter video by
Skyrider's, then the credits). `sequenceEnabled` applies the client settings `playSplash` and `playIntro` (default on);
the ending always plays (deviations "Intro and splash switches": a browser player re-enters often and should not be
forced through the videos). Where they play: the launcher plays the splash after a first click, once per browser tab
(deviations "Splash start"), and the beginning when it starts a campaign; `/play` plays the beginning after the new game
(`src/app/game/front-end.ts`) and the ending (`src/app/game/story-host.ts`), and opens on the main menu without the
splash (deviations "Game page start"). `src/devtools/video/` plays every sequence and the credits, toggles the two
settings and exposes `window.__ja2Video`; `?autoplay=splash` plays the splash on load unless `playSplash` is off.

### 4.5 Credits

- **Parser** (`src/content/formats/credits.ts`, `readCreditRow`) like `GetNextCreditFromTextFile`: codes `D B S J C R T
  { }` after `@`, separated by `,` and ended by `;`, the rest of a code skipped up to the next separator, numbers read
  like `sscanf("%u")` (`scanUnsigned`), colours truncated to 8 bits, unknown codes and justifications other than 0–2
  reported and ignored, the section flags applied after the codes of the same row. Defaults (`INITIAL_CREDIT_STYLE`):
  node gap 12, section gap 50, scroll delay 25 ms, centred, title colour `FONT_MCOLOR_RED`, active colour
  `FONT_MCOLOR_DARKWHITE`. All 248 rows of the English credits parse without unknown codes.
- **Rows** come from `GET /api/text?file=binarydata/credits.edt&row=N` (`src/app/credits/rows.ts`, `CreditRowFeed`),
  prefetched from row 1 (`FIRST_CREDIT_ROW`) until the first 404.
- **Roll** (`src/ui/screens/credit-roll.ts`): a row is read when the last node has risen `gapBeforeNextRow` pixels
  above the bottom less the original's 16-pixel overlap, nodes rise 1 px per scroll delay, the top node is dropped once
  off screen, the screen ends when the rows ran out and the last node left.
- **Screens**: `/play` draws the original credits screen on the canvas (`src/ui/screens/front-end/credits.ts`, `28`);
  the launcher's "Video and credits" button keeps a DOM scroller (`src/app/credits/scroller.ts`: Arial 12 px and bold 14
  px in the 210-pixel column at x = 10 of a 640×480 stage, the `FONT_MCOLOR_*` indices mapped to approximate CSS
  colours, Escape on key up ends it; deviations "Credits screen").

### 4.6 Stubs

`stubs/smk-encode.ts` writes SMK2 files with frequency-built Huffman trees (optionally using the escape leaves), all
four block types chosen per 4×4 block (unchanged → void, one colour → solid, two → mono, else full), palette chunks with
skip/copy/colour commands and a DPCM or raw audio track. `stubs/video.ts` draws an own title card ("ja2-node" in a 5×7
pixel font, a colour band whose ramp rotates through palette copies, a progress bar) with a two-note triangle chime: 30
frames at 15 fps, 22.05 kHz 16-bit stereo compressed like the originals, `intro/splashscreen.smk`, about 40 KB and
byte-identical every build; `stubs/build.test.ts` decodes it back to the source frames, palettes and samples. The other
ten names stay missing and are skipped, which exercises the missing-file path. The stub credits are an own
`binarydata/credits.edt` (`27` §6).

### 4.7 Quirks kept and deviations

**Quirks kept:** the ending picks the throne video by Miguel's and the helicopter video by Skyrider's death; Escape ends
a sequence, Space or a click one video; late frames are decoded but not shown; missing files are skipped.

**Deviations** (`deviations.md`): "Video pacing", "Video scaling", "Intro and splash switches", "Splash start", "Game
page start", "Credits screen". The launcher plays the splash whatever the data version, where the original plays it for
English and Chinese data only (`src/sgp/SGP.cc:441-444`).

## 5. Localization

### 5.1 The original: one version switch for all text

**The version switch.** Stracciatella knows nine data versions
(`rust/stracciatella/src/config/vanilla_version.rs:11-30`: Dutch, English, French, German, Italian, Polish, Russian (the
Buka release), Russian Gold, Simplified Chinese), chosen by `--resversion` or `ja2.json` `resversion`
(`rust/stracciatella/src/config/cli.rs:93-94`, `rust/stracciatella/src/config/ja2_json.rs:42`), default English
(`rust/stracciatella/src/config/engine_options.rs:69`). The launcher guesses it from `russian/`, `german/`, `dutch/`,
`italian/` or `polish/` files inside the SLFs and from file hashes (`rust/stracciatella/src/guess.rs:128-237`); Russian
Gold cannot be guessed (no resource pack, inferred). The version is one switch for everything language-related:

| Depends on the version | Where |
|---|---|
| UI string file `strings/translation-<suffix>.json` (`-eng`, …; **both** Russian versions read `-rusgold`, `GetSuffix(version, false)`) | `src/externalized/strings/Localization.cc:13-34`, `src/externalized/DefaultContentManager.cc:968-971` |
| other per-language JSON (new strings, town names and locatives, land types, calibres, shipping destinations; both Russian versions read `-rus`) | `src/externalized/DefaultContentManager.cc:876`, `:956-957`, `:1203-1204`, `src/externalized/strings/TranslatableString.cc:18` |
| character → glyph table `translation_tables/translation-table-<x>.json` (`fr`, `rus`, `rus-gold`, `chs`, else `eng`) | `src/externalized/DefaultContentManager.cc:1338-1376` |
| EDT decoding mode (`SE_RUSSIAN` for both Russian versions, `SE_POLISH`, `SE_ENGLISH` for English and Chinese, `SE_NORMAL` otherwise) | `GameRes.cc:329-344` |
| language graphics (33 MLG pictures; Russian Buka uses `russian/<name>_russian.sti`, Russian Gold the default paths) | `GameRes.cc:70-319` |
| map major version 6.00 and 148 extra bytes (Russian Buka) | `GameRes.cc:60-64`, `TileEngine/WorldDef.cc:2297-2301` |
| NPC record layout with a leading identifier (Russian Buka only), also in saves | `TacticalAI/NPC.cc:122-215`, `:2388-2424` |
| R.P.C. speech as `speech/r_<voice>_<quote>.wav` (both Russian versions) | `src/externalized/content/Dialogs.cc:88-92` |
| the splash video (English, Chinese) or picture (others) | `src/sgp/SGP.cc:441-444` |
| English and Chinese only: `Random(100) < 30` picks a battle sound instead of the "see enemy" quote | `Tactical/OppList.cc:2388-2402` |
| German only: save encryption factor, door tooltip layout, an argument order | `SaveLoadGame.cc:2512-2515`, `Tactical/Handle_Doors.cc:1089`, `Laptop/AIMMembers.cc:2903-2911` |

**UI strings are JSON.** The formerly compiled string tables are `L10n_t`
(`src/externalized/strings/Localization.h:200-425`, fixed array sizes at `:20-196`), loaded from
`translation-<suffix>.json` with a length check per array (`src/externalized/strings/Localization.cc:37-280`): 217 keys,
1,901 strings per language. `translation-rus.json` and `translation-rusgold.json` differ in five strings (the copyright
line and four mail sender names); only the latter is read (no other caller passes `false` to `GetSuffix`, inferred).

**Data text is EDT, per installed version.** Dialogue (`mercedt/NNN.edt`, `npcdata/NNN.edt`, `d_NNN.edt`), civilian
quotes, item names and descriptions (`binarydata/itemdesc.edt`, `braydesc.edt`), A.I.M. and M.E.R.C. bios, mails, files,
history and quest lines, I.M.P. text, help, credits, insurance and florist text are fixed-width UTF-16 records
(`src/externalized/strings/EDT.h:60-110`, `src/externalized/ItemModel.cc:11-20`, `Laptop/EMail.cc:34`,
`Tactical/Civ_Quotes.cc:36`) decoded by `LoadEncryptedData` (`src/externalized/strings/EncryptedString.cc`): ROT-1
(`:17`), then per mode. Russian maps 0xC0–0xFF to U+0410–U+044F (`:24`: the text was CP1251 read as CP1252); Ё, № and
the guillemets are not mapped (so they cannot render, inferred). Merc names in `prof.dat` get the same fix
(`src/sgp/LoadSaveData.cc:77-90`). Record sizes are the same in every language. Item and merc names are never in JSON
(`items.json` has none; `src/externalized/mercs/MercProfile.cc:151-152` allows overrides only).

**Fonts decide what can be drawn.** All 16 fonts are `fonts/*.sti` with the same names in every version
(`Utils/Font_Control.cc:37-52`); one translation table maps code points to glyph indices for all of them
(`src/externalized/DefaultContentManager.h:294`); a missing code point draws `?` (`src/sgp/Font.cc:163-172`). The tables
are incompatible: the English fonts carry only upper-case Cyrillic (32 glyphs, for one NPC's lines, decoded by the
non-Russian branch of `src/externalized/strings/EncryptedString.cc:70-91`), the Buka fonts put Cyrillic at 96–159 with
no accented Latin, Russian Gold at 100–163. So mixed-case Russian on original bitmap fonts needs Russian data (or
replacement fonts); with English data Cyrillic can only be drawn in capitals (inferred from the tables).

**Speech** has the same file names in every version except the Russian R.P.C. prefix; its language is whatever the
installed `speech.slf` holds (inferred). **Numbers and money** are not localized anywhere: `$` with `,` thousands and
`.` decimals (`Laptop/Finances.cc:954-985`); only unit labels come from the strings. Translations keep printf
placeholders in the original order (no positional arguments, `src/sgp/SGPStrings.cc`). **Mods** can override strings,
EDT rows (`<file>.edt.json`, `src/externalized/strings/EDT.cc:48-129`) and fonts through the VFS
(`rust/stracciatella/src/vfs/mod.rs:200-345`); ja2-node has no mods.

### 5.2 Data version and display language

ja2-node splits the switch in two (deviation "Display language"):

- **Data version** (`dataVersion`): a property of the content, detected once at server start from the language folders
  inside the SLFs (English otherwise), overridden by `JA2_DATA_VERSION` (a name of `VANILLA_VERSIONS`; case, spaces,
  `_` and `-` are ignored; ignored with a warning without original data). Without original data it is `stubs`
  (English text and EDT mode, the stub glyph table). It selects the EDT decoding mode, the NPC record layout, the
  `prof.dat` name fix, the R.P.C. speech prefix, the glyph table for the data's fonts and the MLG picture paths
  (`28` §3.4). It is part of the save's content identity (§1), because it reaches the simulation (§5.3).
- **Display language** (`language`: `eng`, `rus`, `ger`, `dut`, `fr`, `it`, `pl`, `chs`): which `translation-<suffix>.json`
  and per-language files label the UI. Default: the data version's language (stubs → `eng`); `rus` reads
  `translation-rusgold.json` and the `-rus` files exactly as Stracciatella does for both Russian versions. The server
  default is `JA2_LANG`, a session has its own (`newSession {language}`), a client its own setting; changing it never
  touches a session. Russian with English data gives Russian UI labels and English data text (dialogue, item names,
  mails), which the original cannot do; with Russian data both are Russian.
- **Text stays out of the simulation**: never in state, saves or logs (`04` §6.13). Views and events carry machine
  tokens (`moraleText: 'good'`, `reason: 'outOfAPs'`) and text keys (`{file, row, width}` for EDT, `{table, index}` for
  UI strings) that clients resolve in the tables they loaded; `src/server/text-keys.ts` maps each token to its `L10n`
  array and index, so every surface labels the same way. Routes, view labels and MCP behaviour: `04` §6.25.

### 5.3 What the data version reaches in the simulation

The display language never reaches the simulation. The data version does, only in these places, each faithful to the
version the user owns:

1. **Quote durations**: the longer of the voice's length and 12 ticks per character of the decoded EDT line
   (deviations "Speech", `24` §10.2); a Russian line and its voice have other lengths than the English ones, so the
   speech channel frees at another tick.
2. **NPC record layout** (Russian Buka): the same records from another byte layout (`src/content/formats/npc.ts`
   `'russian'`), also in native saves.
3. **The battle-sound branch** of `Tactical/OppList.cc:2388-2402`: one extra `Random(100)` in English and Chinese. Not
   ported, since the "see enemy" quote is not (§5.6).
4. **Map bytes** (Russian Buka): like `WorldDef.cc`, the reader skips the 148 bytes by the map file's own version
   6.00/26 (`RUSSIAN_MAP_EXTRA_BYTES`, `src/content/formats/map.ts`), so the map model is unaffected; the major version
   matters only for writing maps.

Hence a save records `dataVersion` and a hash of the quote lengths it ran with (`quoteLengthIdentity`,
`src/server/content-identity.ts`); a load with another data version or other lengths goes ahead with the warning
`dataVersionDiffers`, like Stracciatella's version warning (`SaveLoadScreen.cc:707-731`; §1).

### 5.4 Russian

- **With Russian data** (Buka or Gold): detection (Buka has `russian/` files; Gold must be named in
  `JA2_DATA_VERSION`), the Russian EDT mode, the Buka NPC layout, `speech/r_` for R.P.C.s, the Buka MLG pictures, the
  Russian strings (`translation-rusgold.json` plus the `-rus` files) and the `rus` or `rus-gold` glyph table.
- **With English data and `rus`**: UI strings from `translation-rusgold.json` and the `-rus` files, as Stracciatella
  picks them; data text stays English; the launcher and the developer pages render Cyrillic with system fonts (the
  canvas: §5.6).
- **Kept as in the original**: Ё and the other unmapped CP1251 characters stay unmapped; money and numbers keep `$`,
  `,` and `.`; no layout changes. Stracciatella's tooltip table exists only in English (`tooltips-eng.json`) and its
  `informative_tooltips` option is off by default (`assets/externalized/game.json:144`), so tooltips are out of scope.
- **Repository rule**: the Russian JSON strings are Stracciatella's externalized tables (SFI-SCLA, copied unchanged like
  the rest of `data/externalized`); nothing from the user's EDT files, fonts or speech is committed, and tests assert
  keys, counts and lengths, never original text (`04` §6.13).

### 5.5 Implementation in ja2-node

| Module or file | Role |
|---|---|
| `src/content/text/data-version.ts` | `VANILLA_VERSIONS`, `STUB_DATA_VERSION`; `dataDecoding` → `DataDecoding {edt, npcRecords, profileNames, rpcSpeechPrefixed}`; `edtEncodingOf` (`getStringEncType`); `stringSuffix` (`GetSuffix`: `-rusgold` for the translation file, `-rus` for the per-language files); `displayLanguageOf`, `languageVersion` (`rus` → Russian Gold); `glyphTablePath`; `guessVanillaVersion` (the language-folder half of `guess.rs`: exactly one language folder found, else no guess) |
| `src/server/data-version.ts` | `detectDataVersion` / `chooseDataVersion` at server start (source `stubs`, `override`, `detected` or `default`), `chooseDisplayLanguage` (`JA2_LANG`) |
| content loading | an optional `DataDecoding` argument, default English: `loadTacticalContent` (`src/sim/tactical/load-content.ts`, the `prof.dat` names), the narrative content (`src/server/narrative-content.ts`: EDT mode, NPC record layout, cached per decoding), the campaign, sandbox and save session factories (also the NPC layout of native saves) |
| `src/content/formats/edt.ts` | EDT modes `english`, `russian`, `polish`, `other` (`SE_NORMAL`) |
| `src/content/narrative/speech-path.ts` | `dialogueSpeechPath` (`Dialogs.cc` `GetDialogueVoiceFilename`, the `r_` prefix), used by `src/content/audio/speech.ts` |
| `src/content/text/strings.ts` | `loadUiStrings`: the translation file plus `LANGUAGE_FILES` (`new-strings`, `strategic-map-land-types`, `strategic-map-town-names`, `strategic-map-town-name-locatives`, `ammo-calibre`, `ammo-calibre-bobbyray`, `shipping-destinations`); `checkTranslation` repeats the per-array length check of `Localization.cc:37-53` against `data/tables/l10n.json`; all nine translation files pass |
| `data/tables/l10n.json` | `tools/transcribe/l10n.ts` from `Localization.h:20-196`: each `L10n` key with its array size (`null` for a single string) |
| `data/tables/edt-layouts.json` | `tools/transcribe/edt-layouts.ts`, read by `src/content/text/edt-layouts.ts`: the record layout of every EDT file the game reads, 20 fixed files and 5 name patterns (`npcdata/civNN.edt`, `npcdata/<sector>.edt`, `npcdata/d_NNN.edt`, `npcdata/NNN.edt`, `mercedt/NNN.edt`). On the English Gold data every fixed file holds whole records; the row counts in the `EDT.h` comments are twice the real ones for all files but `help.edt`, so they are not transcribed |
| `src/content/text/glyph-table.ts` | parses Stracciatella's glyph tables and the stub table |
| `src/server/text-service.ts` | `TextService`: EDT rows through the VFS in the data version's decoding (stub files only on the stub data version) and the UI tables of a language, for `/api/strings`, `/api/text` and `observe` labels |
| `data/tables/mlg.json`, `src/ui/layout/model.ts` | `tools/transcribe/mlg.ts` from `GameRes.cc` `GetMLGFilename`; `mlgPath` resolves an MLG id per data version (`28` §3.4) |

### 5.6 Known limitations

- The guesser has only the language-folder half of `guess.rs`, not the resource-pack hashes: French, Simplified
  Chinese and Russian Gold data (and anything recognisable only by hash) run as English unless `JA2_DATA_VERSION`
  names the version.
- The English/Chinese battle-sound branch waits for the "see enemy" quote, which `src/sim` does not port.
- Cyrillic with English data on the canvas (`/play`): the page draws with the data's fonts and the data version's glyph
  table (`glyphTablePath` in `src/app/game/ui-boot.ts`), whose English fonts carry upper-case Cyrillic only, so other
  Cyrillic letters draw `?`. The stub fonts have the whole Cyrillic alphabet (§6.5.5) but are not used as a fallback.
- The oracle has never run on Russian data; the probes that read text lengths should be rerun once on a Russian copy.

---

## 6. Stub pack

### 6.1 Scope

The done criterion of every feature is "also runs on stubs, CI only on stubs" (`01` §4.4). The stub pack lets a
campaign be played from the new game towards the Queen's death through MCP and in the browser, with sound, music, a
splash video, saves, the canvas screens and English or Russian UI labels, and gives every platform feature content that
exercises it. It is not a stub replica of every sector or quest: the narrative content stays the minimum the tests and
the stub campaign path need (`01` §8, "logic stubs are game design"). Items, weapons, dealers, the army and the
strategic tables come from `data/externalized` for every data version and need no stubs. The UI art of the canvas
screens (the stub skin) is specified in `28` §12.

### 6.2 Rules

- Nothing is traced, sampled or derived from the original data: sounds are synthesized, text is written fresh, maps
  are drawn in the ASCII format (`01` §4.4); names follow the original paths only so that one content table serves both.
- The stub content is dedicated to the public domain under CC0 1.0 (`stubs/LICENSE.txt`, copied into the pack with
  `stubs/NOTICE.txt`, which lists what the dedication covers). The generator code (`stubs/**/*.ts`) stays SFI-SCLA with
  the rest of the code; the Stub Pixel fonts are OFL (§6.5.5). A file that only ties the content to the game, listing
  its paths, sectors, tile or animation slots, glyph numbers or map data from Stracciatella's tables, stays SFI-SCLA
  too and goes on the notice's list. The list today: `stubs/maps/sector-kinds.json`, `aliases.json`,
  `binarydata/ja2bin.dat`, `world/binarydata/ja2set.dat`, `translation_tables/translation-table-stub.json` and
  `interface/b_map.pcx` (the map board coloured by the traversability data); `stubs/build.test.ts` checks that every
  listed file exists. Everything else must be own work so that the dedication can cover it.
- Stub art draws what the layouts require (rectangles of the declared size, labels in the stub font, simple shapes) and
  never imitates the original's look: no frames, textures, icons, ornaments or colour schemes taken from its screens.
- Stub texts are written fresh and stay generic: they do not retell the original's story or use the names of its
  characters and places; the game's identifiers appear only as keys.
- The stub build stays deterministic (same bytes every build); generators take no time or randomness from the system.
- Every new stub family gets a decoder round-trip test in `stubs/build.test.ts`.

### 6.3 Build, mounting and aliases

- **Build.** `pnpm stubs` (`stubs/build.ts`, `buildStubs`) writes the pack to `dist/stubs` (about 1,200 files, 17 MB),
  with `README.txt`, `LICENSE.txt` and `NOTICE.txt`; `pnpm dev` rebuilds it first. Budgets in `stubs/build.test.ts`: the
  media folders (`synth`, `music`, `mercedt`, `intro`, `fonts`, `cursors`, `interface`, `laptop`, `loadscreens`)
  below 7 MiB, the splash below 64 KiB.
- **Data version.** Without original data the server's data version is `stubs` (§5.2): text and EDT mode English, the
  stub glyph table.
- **Mounting.** `openDataVfs` (`src/node/data-vfs.ts`) mounts the pack (`JA2_STUBS_DIR`, default `dist/stubs`) as the
  stubs layer under the `stubs/` prefix, after the repository's `data/` and the original data (`DirLayer`,
  `src/node/dir-layer.ts`). Content loaders probe the original name first and `stubs/<name>` second (`readLayered` in
  `src/content/narrative/npc-records.ts`, `sectorMapPath`), so original files always win and the pack fills only what
  the data lacks. `TextService` and `GET /vfs/<path>` fall back to `stubs/<path>` only on the stub data version
  (`04` §6.25), so a client asks for `sounds/door open 01.wav` or `speech/000_108.wav` on both data sets.
- **Aliases.** `aliases.json` at the pack root (`src/content/vfs/aliases.ts`, format `ja2-node vfs aliases v1`) lets
  many original names share one generated file: the stub layer lists each alias as a file that reads its target; real
  files win; an alias to a missing file or to another alias fails the mount. Sector kinds (§6.5.1), fonts (§6.5.5),
  sounds, speech, faces, item pictures and load screens use it.

### 6.4 Contents

| Area | Stub pack | Original (for scale) |
|---|---|---|
| Sector maps | 14 maps: the hand-made A9, A10, A10_b1, D5, N7, P3 and P3_b1, the `village` (the stub sandbox map, `STUB_SANDBOX_MAP`), `wilderness` and five kind maps (town, mine, cave, camp, airfield) behind the sector aliases of `stubs/maps/sector-kinds.json` (§6.5.1); every other sector loads the wilderness map | 256 surface sectors, 36 underground levels, alternate maps |
| Tileset | tileset 0 with 29 of 151 tile types (§6.5.4) | every tileset of `ja2set.dat`, all types |
| Soldiers | 5 sheets (stand, walk, run, crouch, prone) × 8 directions for all 396 surfaces (`stubs/soldiers.ts`); an invented script for each of the 311 animation states (`stubs/anim-scripts.ts`); palettes | 396 surfaces per body |
| Structures | wall, barrel, door, stone wall and window, wooden and wire fence, sandbags, three roofs, cliff; 15 person and 83 corpse structure files | 1,442 JSD |
| Profiles | 44: A.I.M. 0–11, M.E.R.C. 42, R.P.C. 59 and 65, 25 NPCs, vehicles 160–163 (§6.5.3) | 159 slots: 40, 11, 18, 85, 4 |
| NPC scripts | 21 NPCs plus `000.npc` and two meanwhile sets; 23 NPC and 6 civilian EDTs | about 103 scripts, civilian and sector quote files, `miners.npc`, `d_NNN.edt` |
| Merc text | `mercedt/NNN.edt` for A.I.M. 0–11, M.E.R.C. 42 and R.P.C. 59 and 65: 117 invented quotes each | 1 EDT per merc |
| Other text | `binarydata/itemdesc.edt` (the 31 items the stub campaign and tests use), `credits.edt` (the credit control codes), `email.edt` (the new-game mails, the I.M.P. and M.E.R.C. intros), and the help and laptop EDTs of the stub skin (`28` §12) | `binarydata/*.edt` |
| Locks | 2 (`stubs/locks.json`) | `locks.bin` |
| Sounds | 90 synthesized cue classes (`synth/sfx`) behind every sound path of the tables; 42 battle voices for three body classes (`synth/battle`) behind the generic voice paths (`m_`, `f_`, `bad0-2`, `bad7-8`, `kid0-1`); `ambient/0.bad` for the stub tileset | 370 + 1,581 WAV, `ambient/*.bad` |
| Music | one chiptune loop (about 4 s) per track of `music.json`: 14 files under their own names | 14 tracks, up to two minutes |
| Speech | one IMA ADPCM blip and `.gap` per stub speaker and quote family (`synth/speech`), behind every merc and NPC quote that has stub text | 8,568 WAV, 8,353 `.gap` |
| Video | `intro/splashscreen.smk` (a title card and a tone, 2 s); the other ten names are missing | 11 Smacker files, 70 MB |
| Fonts | two STI fonts (Stub Pixel 12 and 16 Bold) behind the 17 font names, the stub glyph table (§6.5.5) | `fonts.slf`, the glyph tables |
| UI art | the stub skin (`stubs/ui/`, `28` §12): labelled screens and buttons, cursors, faces, item pictures, the map board, radar maps, load screens | the other SLFs |

### 6.5 Maps, characters, tiles and fonts

#### 6.5.1 Sector kinds and kind maps

`stubs/maps/sector-kinds.json` (built by `stubs/sector-kinds.ts`) gives every sector the strategic tables name a kind
and a map: town (22 town sectors) and prison (I13, J9) on `town`; mine entrances (B2, D4, D13, H3, H8, I14) on `mine`;
the 17 mine levels, 13 lair levels and 4 other basements (Tixa's dungeon, Orta's cellar, the statue tunnel) on `cave`;
the 4 SAM sites and 22 garrison sectors (the roads to Meduna, the roadblocks) on `camp`; the airport B13 and Skyrider's
four alternate maps (`B15_a`, `C16_a`, `D12_a`, `E14_a`) on `airfield`; the palace P3 on the hand-made `p3`. A9, A10,
A10_b1, D5, N7 and P3_b1 keep their hand-made maps, every other sector loads the fallback `wilderness`. The build checks
the table (sector names, no sector twice, every map compiled, no kind over a hand-made map) and turns each listed
sector into an alias of its kind's map, so `sectorMapPath` (`src/content/strategic/sector-maps.ts`) finds
`stubs/world/maps/d13.dat` without a code change, and original maps still win. `stubs/sector-kinds.test.ts` checks the
table against `strategic-map-towns.json`, `strategic-mines.json`, the SAM sites, the garrison groups, the underground
sectors, the creature lairs and Skyrider's placements.

Kind maps (`stubs/maps/{town,mine,cave,camp,airfield}.map.txt`) are sealed rooms of stone walls with windows, closed
doors and flat climbable roofs:

- **Town**: a shop with a placement for each of the nine stub dealers (only the one whose profile lives in the loaded
  sector appears), two houses, a jail whose three locked cells hold the Alma captive gridnos 9208, 9688 and 9215
  (`merc-fate.ts`); the garrison stands at four posts of five.
- **Mine**: the head miner's office with a placement per head miner, a shaft house whose exit grid leads down, a
  settling pond, a cliff ridge.
- **Cave**: tunnels in cliff rock with 12 creature slots, a creature-queen slot (body 10), four miners and a ladder up.
- **Camp**: barracks, a store and a launcher inside low and high sandbags; garrison at four posts of five.
- **Airfield**: a hangar, a shed, a wooden fence and a helipad around Skyrider's arrival gridno 8842 with his placement
  4 tiles from it.

Every surface map has the four entry points (edgepoints are generated, `edgepoints.ts`) and at least 20 enemy slots,
the largest garrisons of the compositions: `AddSoldierInitListEnemyDefenceSoldiers` places soldiers on the map's enemy
placements only, so a group member without a slot would be counted in battle and never placed, and his group would
keep its count after the battle. The hand-made P3 has 32 elite slots for `QUEEN_DEFENCE` (a west wing over the stairs
with the six priority elites, the optional elites in a keep far to the south-east, Derek and Oliver in the gatehouse,
so a squad can fight its way to the stairs) and N7 20 for `LEVEL1_DEFENCE`. NPC placements carry a `STAYINSECTOR`
schedule (an unscheduled civilian would get the default come-and-go schedule, `Scheduling.cc:917-955`).

#### 6.5.2 Same-sector exits

The stub map format accepts `exit: x y -> here z=<level> at X Y`, written as sector 0,0; `withSectorExitGrids`
(`src/content/strategic/sector-maps.ts`, called by `loadTacticalWorldInputs` in `src/content/world/tactical-world.ts`)
resolves it to the sector named by the map file, so one mine map leads down from every mine and one cave ladder up to
the surface above. An original map never holds sector 0,0, so original data is unaffected.

#### 6.5.3 Profiles, scripts and text

- **Profiles** (`stubs/profiles.json`, 44; defaults in `src/content/formats/stub-profiles.ts`): invented characters on
  the original profile ids, so the hiring, dealer, head-miner and helicopter code finds them. Twelve A.I.M. mercs
  (0–11) with their own hiring rules: Lasko hates Vant (refuses once Vant has arrived, joins with the buddy quote when
  her buddy Hollis is on the team), Puig refuses after any merc death (`deathRate` 0), Marlow refuses at any bad
  reputation (`reputationTolerance` 0), Voss and Arden are buddies, Voss learns to hate Kestrel, Arden learns to like
  Moraga. The four vehicle profiles 160–163, Skyrider (97), the head miners Fred, Matt (in I14, town 3), Oswald, Calvin
  and Carl (106, 148, 156, 157, 158) and one dealer per town (Keith 147 in C13, Franz 124 in C5, Jake 113 in H13, Howard
  125 in G9, Sam 126 in G2, Fredo 130 in L12, Herve 151 in A2, Peter 152 in I6, Carlo 154 in N5).
- **Kits** (the `inventory` of each profile): role kits of riflemen (MINI14, G41 or M14 with three AP magazines, two of
  them with grenades), medics (MP5K and a medical kit) and an SMG gunner; Kevlar vest or flak jacket and a steel helmet;
  a first-aid kit; and a Glock 17 sidearm with two CLIP9_15, which the A10 stub NPC's give script and the give and talk
  e2e scenarios use. The last gun of a kit sets the profile's gun attractiveness (`Tactical/Soldier_Profile.cc:189-199`),
  so the stub mercs measure their weapons against a Glock.
- **Default squad**: a stub campaign hires from all twelve (`STUB_SQUAD_PROFILES`, `src/server/campaign-factory.ts`),
  since `StartSomeMercsOnAssignment` sends some away at a new game.
- **Scripts and text** (`stubs/npc/records.json`, `stubs/npc/text.json`, `stubs/text/*.json`, built by `stubs/npc.ts`
  and `stubs/text.ts`): Skyrider asks to be escorted (`ASK_ABOUT_ESCORTING_EPC`), his record 15 at the Drassen helipad
  ends `ESCORT_SKYRIDER` and releases him (`UN_RECRUIT_EPC`), after which the arrival rule sets up the helicopter; a
  head miner's first line starts his mine (`START_MINE`) and his EDT holds the strategic quote numbers of
  `head-miners.json`; the dealers greet and chat. The merc EDTs (`stubs/text/merc-quotes.json`) and a speech blip per
  speaker come with every profile that speaks.
- **Animation scripts** (`stubs/anim-scripts.ts`): invented, except that the seven unjam scripts end like the
  original's with the non-interruptible release and opcode 476, which returns to the shooting animation the jam
  interrupted (otherwise the shot never comes and its busy count stays; `stubs/anim-scripts.test.ts`).

#### 6.5.4 Tile types

The stub tileset (`stubs/world.ts`, `stubs/tiles.ts`, `stubs/effects.ts`) fills 29 tile types:

- grounds `FIRSTTEXTURE`, `SECONDTEXTURE`, `THIRDTEXTURE`, `REGWATERTEXTURE`; `FIRSTFLOOR`; `FIRSTWALL`, `FIRSTROOF`,
  `FIRSTOSTRUCT` (barrel), `FIRSTDOOR`;
- `SECONDWALL` (stone wall, armour 11, windows that shatter to an open partner), `FENCESTRUCT` (a wooden fence that can
  be hopped, a see-through wire fence with a cut partner), `SECONDOSTRUCT` (low sandbags that can be hopped, high ones
  that cannot), `SECONDROOF` (`NORMAL_ROOF`, climbable), `FIRSTSLANTROOF`, `FIRSTHIGHROOF`, `FIRSTCLIFF` with its lip
  `FIRSTCLIFFHANG`, `DEBRISROCKS`;
- the item graphics `GUNS`, `P1ITEMS`, `P2ITEMS`, `P3ITEMS` with every `tileGraphic` of the item tables
  (`STUB_ITEM_TILE_COUNTS`);
- the effects `BULLETTILE`, `FIRSTMISS`, `SECONDMISS`, `THIRDMISS`, `HUMANBLOOD`, `CREATUREBLOOD`, `WINDOWSHATTER`.

Stub structures come from `syntheticStructure` (`src/content/world/synthetic.ts`). Its `edge` option fills the cells
of the original's wall shapes (left walls the far `y` row, right walls the far `x` column, read from the tileset 0 wall
and door structure files), so the stone walls, windows and both fences block sight and fire along one edge of their
tile; `FIRSTWALL` (A9, the village houses, the bench arena) keeps full 5×5 tiles, on which the arena's sealed bunker
relies. A tile yard east of the village exercises each family (`src/sim/tactical/stub-tiles.test.ts`: fence and
sandbag hops, sandbag cover, sight and fire through a window and a shot that shatters it, sight along a wall from its
tiles, a roof climb, the cliff, debris, an item tile).

#### 6.5.5 Fonts

`stubs/fonts.ts` builds two bitmap fonts from a subset of Terminus Font 4.49.1 (SIL OFL 1.1, © 2020 Dimitar Toshkov
Zhekov), renamed Stub Pixel 12 and Stub Pixel 16 Bold because of the licence's Reserved Font Name. The subset (222
characters, `stubs/font/stub-pixel-12.txt`, `stub-pixel-16b.txt`) sits next to `OFL.txt` and `NOTICE.txt` (source URL,
version, hash, changes) and is regenerated with `tools/stub-font-subset.ts`. The build writes `fonts/stub-pixel-12.sti`
and `fonts/stub-pixel-16b.sti` (8-bit indexed, ETRLE, 230 glyphs each, value 1 shadow and 2 ink as the original's
mono-shadow blitter expects), points the 17 font names of `Utils/Font_Control.cc:37-52` at them through `aliases.json`,
and writes `translation_tables/translation-table-stub.json` in Stracciatella's shape: the English table's glyph numbers
plus lowercase Cyrillic, Ь and `` ` ~ « » – — … № `` (parsed by `src/content/text/glyph-table.ts`). The licence and
notice travel with the pack.

### 6.6 Sounds, music, speech and video

- **Sounds** (`stubs/audio.ts`): one short synthesized WAV per cue class (footsteps by terrain class, gun classes and
  their silenced and burst variants, reload, punch and knife, hits, falls, explosions, doors open, close and locked,
  item pick-up and drop, UI clicks, the laptop beep), generated from noise and tone envelopes; battle sounds as one
  generic set per body class instead of per profile; an ambient table for the stub tileset (`stubs/ambient.ts`). The
  original paths (`sounds/…`, `battlesnds/…`) are aliases, so the same cue table resolves on both data sets.
- **Music** (`stubs/music.ts`): one generated loop per track of `music.json`, named as there.
- **Speech** (`stubs/speech.ts`): one blip WAV and a matching `.gap` per stub speaker and quote family, so the speech
  and lip paths run; the blips' lengths are unrelated to the text.
- **Text** (`stubs/text.ts`): the merc EDTs, `itemdesc.edt`, `credits.edt` with the control codes (§4) and the
  `email.edt` rows a stub new game sends. With them merc quotes have text on stubs: `mercQuote` events are emitted and
  quotes take their text's time (§5.3).
- **Video** (`stubs/video.ts`, `stubs/smk-encode.ts`): the splash Smacker file (§4).
- **Formats** (`stubs/wav-encode.ts`): PCM 8-bit 11.025 kHz mono (most effects, bursts, music), PCM 16-bit 22.05 kHz mono
  (single shots) and stereo (the big explosion), IMA ADPCM 11.025 kHz mono with 256-byte blocks (battle voices, speech),
  so every decoder path runs on stubs. Synthesis (`stubs/synth.ts`) uses its own xorshift generator seeded from the
  file's class name.

### 6.7 The stub campaign bot

`pnpm cli campaign [--seed N] [--server URL --token T | --port N] [--verbose] [--trace] [--stop-after STEP]
[--no-reload]` (`tools/campaign-bot/`) is a scripted player that uses the MCP tools alone (`newSession`, `status`,
`observe`, `act`, `advance`, `save`, `load`, and `deleteSave` to clean up) over Streamable HTTP with the SDK client
(`mcp-game.ts`), and an example of an agent against the API. It decides from the observation only, with no clock and
no randomness, so a seed plays the same campaign every time (the same in process and through MCP). Without `--server`
it builds the stub pack, starts its own stub server (`src/server/main.ts` with an empty `JA2_DATA_DIR`, `--port` or a
free port, a random token and a temporary save folder, `stub-server.ts`) and stops it at the end. It prints one JSON
line: seed, outcome (`won`, `lost`, `stuck`, `stopped`), the step and reason, days, battles, battles won, rounds, mercs
lost, enemies killed, the reloads and the seconds; the exit code is 0 for a won campaign. Default seed 1.

- **Steps** (`campaign.ts`): hire six A.I.M. mercs through the laptop (`aimQuote`, then `aimHire` with the kit; a
  preference list, two medics, never Lasko with Vant), land in A9 and win the landing battle, outfit from Omerta's
  stash, liberate the Drassen airport, town, mine and SAM site (B13, C13, D13, D15), talk Fred into starting the mine,
  order medical supplies from Bobby Ray's (what is in stock), buy armour and first-aid kits at Keith's, rest and heal,
  find Skyrider at his farm, take him along (a guard joins the escort's squad) and walk him to the helipad until the
  helicopter is set up, train militia in C13, collect the delivery, recruit for up to six days (twelve hours at a time)
  from A.I.M. and M.E.R.C. (Speck's mail, the account, the bills paid) up to twelve mercs, march F11, J11, L8, L3 with an
  outfit and a rest at each stop, attack M3, N3 and O3 (falling back to the previous sector after two casualties, up to
  six attacks each), storm P3 to the stairs (`palace.ts`), go down to P3_b1, kill the Queen and advance through the
  ending until `observe.ended`.
- **Battle policy** (`battle.ts`, `retreat.ts`, `first-aid.ts`, `gear.ts`): in turns every merc readies his hand
  (reload, or the best gun he has ammunition for), scores each hostile in sight with `estimateAttack` (chance to hit ×
  chance to get through, aim clicks from the spare APs, a bonus for a target already hit: focus fire) and fires above a
  threshold; otherwise he bandages himself when bleeding, holds (back within six tiles of the squad's centre, prone) or,
  after rounds without our shots, pushes in swat mode toward the nearest known enemy or the objective; `endTurn` after
  the passes. In real time the medics stop the bleeding, tired mercs catch their breath, then the squad seeks the last
  seen enemy, the objective, a heard noise or sweep points; a sector that still counts enemies nobody finds is waited on
  and then reported as `stuck`. A won battle bandages every wounded merc. A retreat leaves by the edge the squad came in
  (`exitSector` per merc), or runs back to the start tiles when half the squad is down and outnumbered, or after the
  casualty limit of an assault. A merc who keeps waiting for a blocked tile is stopped after 4,000 ticks.
- **Outfitting and healing** (`outfit.ts`, `heal.ts`): through `inventory` and `moveItem` on the map screen, the best gun
  with four fitting magazines, the best vest, helmet and leggings, medical kits for the medics and a first-aid kit for
  everyone; a merc with a medical kit doctors, the hurt are patients, the others sleep, in three-hour slices until
  healed and rested, then everyone back on a squad.
- **Prompts** (`prompts.ts`): pre-battle enter the sector (autoresolve only when entering is not allowed, retreat last),
  a surrender offer rejected, contract renewals for a week while affordable, militia payments when affordable, escort
  requests accepted, simultaneous arrivals coordinated. A battle left in combat with only unconscious mercs is ended by
  switching to tactical and ending turns; a squad refused for a dead member gets `removeMerc` (`travel.ts`).
- **Reload checks** (`reload.ts`): *exact load*: in the first battle that reaches round 2 the bot saves
  (`campaign-bot-battle`), loads it with `reseed: false` into a new session and from then on sends every `observe`,
  `act` and `advance` to both sessions until the battle ends, comparing the views (without `language` and
  `dataVersion`) and the advance reports (without the `gameSaved`/`gameLoaded` events and the session's own messages);
  the summary lists the steps compared and the differences, and the campaign plays on in the loaded session. *Player
  load*: after the Drassen mine it saves (`campaign-bot-player`), loads with `reseed: true` into a new session and plays
  on there; the reseed takes the server's entropy (§1), so a run after it is not reproducible.
- **e2e** (`tests/e2e/campaign.spec.ts`, 90 s budget): the bot against the e2e stub server, seed 3, up to the end of the
  landing battle with the exact load at round 2: the battle is won with no merc lost, the mirrored session shows no
  difference over more than 20 compared steps, the campaign continues in the loaded session and A9 is player controlled
  with no enemies.

**Status.** Drassen, the mine, Skyrider, militia and recruiting work on every seed; every exact load matched its
original session over the rest of its battle. The bot does not win yet: the squads are lost (a) on the march F11–L3
through patrol country (groups of five to eighteen; the patrols around K7–L10 are twelve and thirteen strong in the
strategic tables), which costs two to ten mercs, and (b) at the Meduna outskirts: M3 holds twenty (`LEVEL1_DEFENCE`, a
fifth elites), N3 and O3 twenty each with 55 % elites (`MEDUNA_DEFENCE`), refilled while the squad regroups, P3 22
elites on easy. With fresh mercs placed next to the sector (AK-74, four magazines, Kevlar vest and helmet, the same
bot) M3 fell to seven or eight mercs in 4 runs of 4, N3 to seven in 1 of 4. The garrisons and patrols are the
original's tables, not stub content. Candidates: outskirts maps with cover an attacker can use (the stub camp and town
maps are open ground around their posts), a policy that picks cover and attacks at night, a larger team, Skyrider's
helicopter for the march. The endgame steps (storm P3, down to P3_b1, kill the Queen, the ending) reached the victory
with mercs placed in O3, but not through a full campaign. Repro: `pnpm cli campaign --seed 2 --no-reload`.

**Open findings** (seen by the bot, not traced against the original):

- In real time a merc whose next tile is taken by a squad mate who stopped on it waits in `HandleNextTileWaiting`
  without end (G11, seed 3); not reproduced on demand.
- After a retreat that leaves unconscious mercs behind in a sector in turn-based combat, the sector stays in combat and
  the map screen refuses `advance` ("combat is in progress") until someone goes back and ends the turn.
- Once, after a player load, `route` answered "the squad cannot move: dead" after a won battle (D13, seed 1), although
  a death removes the merc from his squad (`HandleStrategicDeath`); not reproduced.
- Once, after a player load, an enemy turn against fifteen soldiers (K10, seed 3) did not end within `advance`'s
  200,000-tick budget; not reproduced.

### 6.8 Known limitations

- Stub underground levels connect only to the surface above them, so the levels below a mine's first and the creature
  lairs have no way in: a sci-fi stub campaign whose creatures invade a mine cannot reach their queen (play stub
  campaigns with sci-fi off).
- Wire cutting is not ported; the cut fence pieces exist in the tileset.
- `FIRSTWALL` structures fill their whole tile (§6.5.4), so a merc on such a wall tile cannot see along the room.
- Only the splash video exists; sequences skip the missing names (§4).
- The stub fonts are not used as a Cyrillic fallback with original data (§5.6).

---

## 7. Performance

The simulation layers read no clocks (`01` §3.2), so all timing is taken outside `sim`; baselines measured on the
original data stay local, since the data may not be committed. Client frame time and the UI targets: `28` §14.

### 7.1 The benchmark suite

`pnpm cli bench <scenario|all> [--data DIR] [--seed N] [--runs N] [--variant NAME] [--profile] [--calls] [--out FILE]
[--save-baseline]` (`tools/bench/`). Every scenario is a fixed seed plus a scripted command list, so a rerun does
exactly the same work; only machine noise varies. No scenario needs the native oracle.

- **Output**: one JSON line per variant on stdout and a summary on stderr: `scenario`, `variant`, `source` (`stubs` or
  `original`), `seed`, `runs`, `warmup`, `load` (the 1-minute load average before and after, to spot a busy machine),
  the primary metric (`metric`, `unit`, `n`, `mean`, `p50`, `p95`, `p99`, `max`), `target` with its sanity bound,
  `series` (secondary metrics as distributions), `counters` (counted from the event stream and the state), `calls` and
  `callsPerSample` with `--calls`, `info` (battle outcome, early stops) and `deterministic`.
- **Determinism check**: the runs' work signatures (turns, ticks, shots, hits, deaths; alert states; strategic events;
  autoresolve slices) must be equal, else the line is flagged and the command fails, since shared mutable state would
  make the numbers meaningless (it once found every stub merc sharing one `stats` object).
- **Runs**: `--runs N` (default 3) repeats each variant from a fresh setup; with two or more an untimed warm-up run
  comes first. Every variant runs in its own child process (the parent collects the lines), so variants cannot
  influence each other (V8's optimization state carries over between battles in one process, §7.3).
- **Profiling**: `--profile` runs the variant once more under the V8 sampling profiler, writes
  `.cache/bench/<scenario>-<variant>-<source>.cpuprofile` (Chrome DevTools) and prints the hottest self-time frames.
  `--calls` takes exact call counts of named simulation functions (AI decisions, path searches, LOS tests, sight checks,
  chance-to-get-through traces, cover searches) from V8 precise coverage (`node:inspector`, `tools/bench/inspector.ts`)
  in one extra instrumented run, about 8× slower; a unit test fails when a counted function is renamed. Counters come
  from a wrapper around the `SessionSim`, not from the simulation, so `src/sim` carries no instrumentation.
- **Seeds and data**: `enemy-turn` and `server` default to seed 2, `campaign` to 7, the rest to 1 (chosen so the stub
  runs avoid known stalls); `--seed` overrides them all. `--data` defaults to `$JA2_DATA_DIR`; `--data ''` forces stubs.
- **Baselines**: `--save-baseline` writes `.cache/bench/baseline.json` (merged per scenario, variant and source); later
  runs print the change per metric (p50, p95, max, mean and the call counts).

| Scenario | What it does | Measures |
|---|---|---|
| `enemy-turn` | turn-based battle through a `Session` with the instant driver's semantics (dispatch, then advance to idle with a 50,000-tick budget, so a stall is reported instead of spinning); the mercs go prone, each fires once a turn at the nearest visible enemy, then `endTurn`; interrupts are ended at once; until one side is gone, combat ends or 60 rounds. Variants `arena-e8`, `arena-e16`, `arena-e32`: the generated arena with 8, 16 and 32 enemies (a quarter elites) against six mercs and four civilians, six regular militia with the 32. Original data only: A9 with 4, 16 and 32 garrison soldiers (the sandbox squad walks from the north entry towards the nearest enemy until combat starts) and the D13 airport from `SaveGame10` (3 mercs, 5 soldiers, 17 civilians: the largest battle among the six native saves of `14` §10) | ms per enemy side turn (every AI team, from `endTurn` to our next turn), ticks per turn; counters: turns, rounds, shots, hits, deaths, interrupts, view build ms; calls per turn |
| `realtime` | the patrol arena with 20, 40 and 64 soldiers (half enemies on patrol orders, half wandering civilians), six mercs sealed in a bunker so nobody sees them; green, and yellow (the enemy team's public noise at the far side with `setNewSituation`, as `CallAvailableTeamEnemiesToAmbush` does); manual driver, 10 × 1,000 ticks through a `Session` | µs per tick (mean, p99, max), ticks per CPU second, alert states at the end, combats started (0, or the variant is void) |
| `strategic` | a new campaign with one A.I.M. merc on a 14-day contract (renewed for two weeks when due), the start sector's garrison emptied before landing, the squad routed to B9 so no sector is loaded, then 7 and 30 world days of `MIN60` compression through a `Session`, prompts answered (pre-battle: retreat, else autoresolve); once more with the Queen's attacks: Drassen (B13–D13) emptied and handed to the player (`setThisSectorAsPlayerControlled(…, contested)`), then `wakeUpQueen` (Omerta alone draws no attack in 30 days); `7d-mercs6` with six mercs | ms per world day; counters: days, `dayStarted`, compression stops, pre-battle, autoresolve, battle results, player-controlled sectors, frame views built and their ms per day; calls: strategic events, group arrivals, Queen evaluations, autoresolve battles |
| `autoresolve` | 20 battles a run of 10, 20 and 40 per side (`side-10`, `side-20`, `side-40`): half mercs (profiles on original data, stub mercs on stubs, at most 20), the rest regular militia, against enemies from `tacticalCreateEnemySoldierForAutoresolve` (a quarter elites, capped at `MAX_AR_ENEMIES` 32) | ms per battle, slices per battle; calls: cell turns, attacks |
| `save` | five saves and loads a run of: the patrol arena with 64 soldiers (`arena-64`), a new campaign with the squad landed (`campaign-landed`) and, with original data, the largest native save of `$JA2_SAVES_DIR` (default: `SavedGames` beside the data folder) imported (`native-import`); each settled for 400 ticks. A save is `SaveService.saveFileOf` (snapshot, header, content identity) plus `encodeSaveFile` (stringify and gzip), a load `inflateSave`, `parseSaveText` and `restoreSession` with fresh content | ms per save (primary); series `snapshotMs`, `encodeMs`, `parseMs`, `restoreMs`, `loadMs`; counters raw and gzipped KiB |
| `server` | in process: a `node:http` server with the WebSocket endpoint on ports 7510–7512, the sessions in `InProcessHost`s sharing one slice scheduler; 1, 4 and 16 viewer sessions (the 20-soldier patrol arena, realtime driver ×1) plus one instant battle session (16-enemy arena, `endTurn` until combat ends) per four viewers, driven by WebSocket clients in a worker thread for 4 s | event-loop delay max (the longest stall; `monitorEventLoopDelay` p50 and p99 in counters, whose p99 hides a stall since a stall is one sample), frame diff ms and view build ms per frame, bytes per second (all, viewers), instant turn round trips |
| `campaign` | `land-and-clear`, in a child process: a new campaign with six mercs, the landing, then the first sector cleared (approach the nearest enemy until combat, prone, three aimed shots per merc a turn, again after a lull) | total ms (landing and clearing), peak RSS |

The stub arena (`tools/bench/arena.ts`) is original work generated from the seed in the stub map format: 64 × 56
tiles on the stub tileset, barrels and wall segments as cover; the battle layout puts a quarter of the enemies 8–13
tiles in front of the mercs so that combat starts at once, the patrol layout keeps a sealed, roofed bunker in a corner.
It is round-tripped through `parseStubMapSource`, `stubMapToMapDef` and `writeMap` and served from an in-memory overlay
as `stubs/world/maps/bench-<name>.dat`, so the stub pack is unchanged.

### 7.2 Targets and measurements

Machine: AMD EPYC 9354 KVM guest, 8 vCPUs with one thread per core, 15 GiB, Node 24.22.0; `bench … --runs 3`. The
guest's throughput varies by more than the load average shows (the same native import measured 400 ms and 102 ms at
the median on one day), so only runs made back to back compare. Original data first, stubs in brackets. The bench
carries each target in its JSON line and fails only above ten times the target (`SANITY_FACTOR`).

| Metric | Target | Measured | Verdict |
|---|---|---|---|
| Enemy turn, 16 enemies, p95 | ≤ 300 ms | A9 258 ms; arena 274 ms (187 ms) | met |
| Enemy turn, 32 enemies plus militia and civilians, p95 | ≤ 1 s | arena with six militia and four civilians 1.00 s (0.69 s); A9 with 32 0.68 s | met, without margin on the arena: the turn is the cover search's chance-to-get-through traces |
| Real-time tick, 40 soldiers, mean | ≤ 0.25 ms | 20 µs green and yellow (19–44 µs); 64 soldiers 35–69 µs | met with a 5× margin |
| Real-time tick, worst single tick | ≤ 50 ms | 5–13 ms (4–27 ms) | met; above 50 ms a tick would show as a hitch at ×1 |
| Strategic world day, no sector loaded, p95 | ≤ 100 ms | with a viewer: one merc 41–51 ms (44–60 ms), six mercs 48 ms (60 ms); without a viewer (no frames built): 22 ms (24 ms) and 27 ms (21 ms) | met |
| Autoresolve battle, 40 per side, p95 | ≤ 10 ms | 3.3 ms (2.8 ms) | met |
| Save (snapshot, stringify, gzip) | ≤ 100 ms and ≤ 2 MB gzipped | p50 / p95: the largest native import 102 / 186 ms, 4.2 MiB raw, 222 KiB gzipped; a landed new campaign 69 / 148 ms, 3.5 MiB, 184 KiB; the 64-soldier arena 39 / 52 ms (stubs: landed campaign 38 / 60 ms, 2.4 MiB, 64 KiB; arena 35 / 41 ms, 2.0 MiB, 77 KiB) | size met with a wide margin; time met on stubs, for the arena and at the median of a landed campaign, at the target at the median of the largest import; the p95 is the first save of a session, which builds the content index and the text identity (about 150 ms on the original data) |
| Load (parse and restore with fresh content) | ≤ 500 ms | p50 / p95: the import 184 / 243 ms, a landed campaign 160 / 233 ms, the arena 104 / 150 ms (92–106 / 116–128 ms) | met; most of a load is building the content again |
| Event-loop stall for other sessions while one runs an instant battle (max delay) | ≤ 50 ms | in process, p50 / max of three runs: one battle 28 / 36 ms with one viewer, 30 / 36 ms with four (22 / 28 and 19 / 27 ms); four battles with sixteen viewers 35 / 42 ms (23 / 23 ms); worker host: another agent's `observe` at most 13 ms during a battle | met: the stall is one 10 ms slice plus the longest single tick (`04` §5.9); in-process saves still stall (§7.7) |
| Campaign (land and clear the first sector), peak RSS | ≤ 512 MB | 319 MB (286 MB) | met |

Further measurements (original data unless stated):

- *Enemy turn*: a 16-enemy arena turn takes 4,227 ticks at the median (21 s of game time) and per turn 46 AI decisions,
  115 path searches, 1,275 LOS tests, 2,045 sight checks, 14.8 cover searches over 1,168 tiles and 17,531
  chance-to-get-through traces. Top frames of the 32-enemy profile: the cover search's traces (47 %, with
  `calcChanceToGetThrough` itself at 28 % self time) and the path search (14 %).
- *Real-time tick*: the median tick costs 1–3.5 µs; the cost sits in single ticks where one AI decision runs several
  path searches (`expand`, `findBestPath`, `remaining` together about 50 % with 64 soldiers on stubs,
  `lineOfSightTest` 11 %).
- *Strategic day*: 1,230 strategic events, 250 group arrivals and 2.3 Queen evaluations a day.
- *Autoresolve*: about 30 one-second slices per battle.
- *Server*: a frame diff costs 0.02–0.04 ms at p95 and building the view 0.05–0.07 ms; a real-time viewer of the
  20-soldier patrol receives 13–20 KB/s at ×1, an instant battle sends 0.34–0.65 MB/s in bursts; the instant turn's
  round trip is 93 ms at the median with one battle and 377 ms with four (stubs 36 and 199 ms), since battles take
  turns slice by slice.
- *Memory*: RSS with the default sandbox session 242 MB in process, 338 MB with a worker; with three sessions (two
  sandboxes and the D13 import) 588 MB and 1,010 MB.
- *Stall sweep*: `bench enemy-turn --runs 1` with seeds 1–8, every variant on both sources, and `bench campaign --runs
  1` with seeds 1–16 on stubs end without a `stalled` outcome (watchdogs are not ported, deviations "Watchdogs", so a
  stall is a bug that fails the run). Seen while tracing the stalls and not changed: `HandleSystemNewAISituation` drops
  a pending melee animation without its busy count when a new situation arrives without a sighting during the stance
  change before the attack; no source of such a situation during an AI's own turn was found, and no run met it.

### 7.3 Profiling and optimization

**Rules.**

- Profile with `--profile` and fix the top frames only. Every optimization keeps the outcomes: the same counters in
  every bench line, byte-identical frames and event logs (hashed over a compressed week and two campaign battles on
  both sources), the oracle compare unchanged (`pnpm check` plus the local oracle compare).
- Caches are derived data: they live beside the state, are rebuilt on load (§1), never enter the snapshot and never
  change an outcome.
- Profiles of the save path misattribute time to whatever runs during a garbage collection; time the phases with
  `performance.now()` before trusting a frame.
- No event jumping (`04` §2 level 1b) unless the real-time target fails after caches: it changes the stepping model.
- A hot function that deoptimizes again and again (`node --trace-deopt`) may hide a porting gap. `gunRange` once
  returned 0 for everything but guns, where `GunRange` (`Tactical/Weapons.cc:86`) returns `CELL_X_SIZE` for non-weapons
  and the weapon range for every `IC_WEAPON` class; a trace from a soldier holding a knife, a grenade or nothing, or a
  thrown knife or rocket, divided by zero in the range drop (`LOS.cc:2844`), its vertical increment became −Infinity,
  and the Infinity and NaN values drove V8 into deoptimizing `fireBullet`, `fireBulletGivenTarget` and
  `calcChanceToGetThrough` until it gave up on them: after a few battles in one process enemy turns ran three times
  slower. Normalising −0 and keeping the fixed-point fields small integers did not help; porting `GunRange` did. About
  25 ordinary feedback deopts of the bullet code per process remain.

**In place** (derived data only; p50 on the original data, before → after):

| Optimization | Where | Effect |
|---|---|---|
| the roster's sorted list reused until the roster changes | `Roster` (`src/sim/campaign/roster.ts`) | with the next three: a world day of compression 79 → 37 ms |
| enemy counts and the player's knowledge of them for the whole surface map at once, each tested against its per-sector original | `numEnemiesInEverySurfaceSector` (`src/sim/strategic/forces/groups.ts`), `surfaceKnowledgeOfEnemies` (`src/sim/strategic/map/knowledge.ts`) | |
| unchanged sector views reused between frames | `src/server/strategic-view.ts` | |
| view diff by `sameJson` (equal exactly when the `JSON.stringify` outputs are equal, fuzz-tested) instead of stringifying both sides | `src/protocol/same-json.ts` | |
| no view built or diffed without a subscriber | the session (`04` §5.9) | a world day 33 → 15 ms |
| an occupied cover position traced once for all three stances | the AI's cover search | traces per 16-enemy turn 24,948 → 17,531; with the next: a 16-enemy arena turn 197 → 131 ms (p95 393 → 274 ms) |
| collision-free throw force searches remembered per item table | the AI's throw planning | 23 % → 6 % of the profile |
| advances in 10 ms slices, one slice per event-loop turn; optional worker per session | `src/server/slicing.ts`, `src/server/session-host.ts` (`04` §5.9) | the stall during an instant battle 214 → 28 ms |
| gzip at `Z_BEST_SPEED`, on the thread pool when asynchronous | `src/server/save-file.ts` | the default level gives 138 KiB instead of 222 KiB for the largest import but takes three times longer |

**Left**: the cover search's chance-to-get-through traces (within one AI decision under 4 % repeat exactly, so a memo
would not pay) and the path search. Candidates not yet profiled (inferred): sight results per tick between position
changes (a visibility cache, `01` §8), path costs within one AI decision, the reachability flood shared by cover and
flee searches, allocation in the bullet and LOS loops.

### 7.4 Session hosts

The `SessionHost` interface, the in-process host with time slicing and the worker host are `04` §5.9. Trade-off: in
process (the default) costs no extra memory and no content load per session; `JA2_SESSION_HOST=worker` uses several
cores and removes the stalls slicing cannot (single ticks of up to about 30 ms, saves, opening a session and loading a
save, 0.2–0.5 s of content building), at about 100–140 MB of RSS and a content load per session on the original data,
and each worker builds its own content index on its first save. A server runs all its sessions in one host kind (no
`auto`): switching when a second session opens would move a running session between threads. Measured with two MCP
agents on the original data (one imports `SaveGame10` and sends `endTurn` then `advance idle` twelve times, the other
alternates `observe` and a one-tile `move` on a sandbox): in process the second agent's calls took 15 ms at the median
and at most 44 ms (`observe`), at most 77 ms (`move`), the battle's `endTurn` autosave being the longest stall; with
workers 2.5 / 4.9 / 12.7 ms (`observe`, p50 / p95 / max) and at most 18 ms (`move`); the two runs played the same battle
tick for tick.

### 7.5 CI

CI (`.github/workflows/ci.yml`) runs four jobs side by side:

- `check`: `pnpm check`.
- `build`: the stub pack, the bench smoke runs and `pnpm build`. Every bench scenario runs on stubs once (`pnpm cli
  bench all --runs 1 --data '' --out bench.jsonl`, about 40 s on the development VM) plus one `--calls` run
  (`autoresolve --variant side-10`) for the instrumented path; it fails only on errors or a sanity bound ten times
  above the target (CI machines vary) and uploads `bench.jsonl` as the `bench` artifact. With one run there is no
  warm-up and no run-to-run check, so CI numbers are cold and only a smoke signal.
- `e2e`: `pnpm e2e --shard=N/3` in three jobs (the dev server builds the stub pack). Chromium installs without
  `--with-deps`, since the runner image carries Chrome's system libraries and the apt step of `--with-deps` took more
  than 10 minutes on a slow mirror.
- `browsers`: `pnpm e2e:browsers` under `xvfb-run` (Chromium and Firefox, also without `--with-deps`, 20 minutes at
  most), only when `node tools/gates.ts --since <the previous push or the pull request base> --plan` selects
  `e2e:browsers`, or when the base is unknown (a new branch, a manual run).

A push or pull request that touches only `docs/`, Markdown files or `LICENSE` starts no CI.

### 7.6 Test runs and gates

- **One stub pack per unit run.** `tests/support/build-stub-pack.ts` (a vitest `globalSetup`) builds the pack once,
  read-only (files 0444, folders 0555, so a test that writes into it fails at once), and passes the folder in
  `JA2_TEST_STUB_PACK`, which `sharedStubPackDir()` and `openStubPack()` (`tests/support/stub-pack.ts`) read;
  `openStubPack()` builds a private pack only when no global setup set the variable, and a test that changes a stub
  file (`rule-pack.test.ts`) builds its own. A Playwright `globalSetup` (`tests/e2e/dev-server-stub-pack.ts`) points
  the e2e helpers that write saves in `beforeAll` at the pack the dev server built (`dist/stubs`, the one the server
  under test reads; Playwright starts the web server before the global setup) through the same variable. Building the
  pack per test file used to take half the unit suite's time.
- **Mode runs.** Data tests read the folder only through `ORIGINAL_DATA_DIR` (`tests/support/original-data.ts`), reload
  tests the mode only through `tests/support/reload.ts`, so `pnpm test:data` is `vitest related
  tests/support/original-data.ts` and `pnpm test:reload` is `JA2_RELOAD=1 vitest related tests/support/reload.ts`: each
  runs only the files its mode changes, not the stub suite again. `pnpm imports` (`tools/check-imports.ts`) refuses a
  test-side file that names `JA2_DATA_DIR` or `JA2_RELOAD` outside its module, since `vitest related` would then miss it.
- **`pnpm gates`** (`tools/gates.ts`, `[gate …] [--all] [--since REV] [--list | --plan] [--keep-going]`) takes the files
  changed since the merge base with the upstream branch (plus the working tree and untracked files) and runs the gates
  their area can affect, in order `check`, `data`, `reload`, `oracle`, `e2e`, `e2e:data`, `e2e:browsers`:

  | Area | Gates |
  |---|---|
  | `src/core`, `content`, `sim`, `node`, `server`, `data/` | all but `e2e:browsers` |
  | `src/protocol`, `stubs/` | all but `oracle` and `e2e:browsers` |
  | `src/ui`, `render`, `audio`, `app` | `check`, `data`, `e2e`, `e2e:data` |
  | the canvas presentation (`game-page.ts`, `dom-input.ts`, `main.ts`, `index.html`, `style.css` of `src/app/game/`, `logical-framebuffer.ts`, `src/ui/resolution.ts`, `vite.config.ts`, `tools/dev.ts`) | adds `e2e:browsers` |
  | `src/devtools/`, `tools/campaign-bot/`, the root `index.html` | `check`, `e2e` |
  | `tests/support/` | `check`, `data`, `reload`, `e2e` |
  | a unit test file | `check`, `data`, `reload` |
  | an e2e spec | `check` and its own suite; a shared helper of `tests/e2e` the suites that import it (the browser suite only `env.ts`) |
  | `tools/oracle/` | `check`, `oracle` |
  | other `tools/`, `package.json`, the Biome and TypeScript configs | `check` |
  | `docs/`, Markdown, `LICENSE`, `.github/` | nothing |
  | the lockfile, or a path no area names | everything |

  `check` and `reload` run without `JA2_DATA_DIR`; `data`, `oracle` and `e2e:data` are skipped without it (the oracle
  also needs the probes in `JA2_ORACLE_DIR`, default `~/ja2-oracle`); `e2e:browsers` needs `DISPLAY` or `xvfb-run`.
  Each gate writes `.cache/gates/<gate>.log`. CI uses the same table for its `browsers` job (§7.5).
- **e2e.** Goldens capture after the page's VFS reads settle: the UI hook's `reads.pendingReads` counts the `/vfs`
  reads in flight (`HttpVfsLayer`, `src/app/assets/http-vfs-layer.ts`), and `capture()` (`tests/e2e/ui-capture.ts`)
  waits for none (`'afterReads'`) unless a golden holds a read on purpose (`'whileReading'`, the loading screen). Much of
  the suite's wall time is the game in real time (the story test at speed 1, the talk panel at the original pace) and
  the browser (the Chrome GPU process under SwiftShader takes about half of the CPU).
- **Tried, not adopted**: vitest `--pool=threads` (no gain); `--no-isolate` (faster, every test passing, but state
  shared between files would make results depend on the order); a test pace (the client clock and the real-time speed
  scaled together would save about 40 s of e2e but test a pace nobody plays at, every timed window eight times shorter).

### 7.7 Known limitations

- The client frame rate at 1920×1080 on the original data is `28` §14's.
- The first save of a session on the original data stays above 100 ms at p95 (the content index and the text identity).
- In process, a save stalls the other sessions for its snapshot and stringify (about 40–70 ms each on the largest
  native import; also the autosave at an accepted `endTurn` in combat); the worker host avoids it. A snapshot could be
  taken in slices only if its sections were captured at one instant.
- The `server` scenario has no worker variant: its arenas live in an in-memory VFS overlay a worker cannot open.
- The `campaign` scenario stops after the first sector; the full campaign is `pnpm cli campaign` (§6.7), timed only by
  its summary's seconds.

---

## 8. The launcher

The launcher (`src/app/launcher/`, served at `/` from the repository's root `index.html`) is a DOM page for what the
canvas game at `/play` (`28` §2.2) does not show: the data source, the display language, the running sessions, native
imports, download and upload of saves, settings export, the developer pages. Its logic is DOM-free and shared with the
canvas screens (`28` §4); the launcher keeps the DOM glue (`main.ts`, `campaign-panel.ts`, `save-panel.ts`,
`settings-panel.ts`, `message-box.ts`, `labels.ts` with `fetchLabels`, `settings-file.ts`, and `api.ts` for the fetch
calls, since `app` may not import `server`). Debug hook `window.__ja2Launcher`; e2e `tests/e2e/launcher.spec.ts`.

- **Header**: the data source (original data with the SLF count, or the stub pack), the data version, the display
  language (the server default or one of the eight) and a Play link to `/play`.
- **New campaign** (`campaignRequest`, `src/ui/client/campaign-form.ts`): the game init screen's choices with
  `InitGameOptions`'s defaults preselected (`ORIGINAL_OPTIONS`: easy, sci-fi, reduced guns, save anywhere, blood on);
  the form always sends all five options, so the API's default difficulty 2 never applies; the Dead is Dead save name
  (checked against the server's name rule and the reserved names); the server's default squad, 1–6 mercs, or hiring in
  the laptop (`hire: []`), and whether the squad flies in at once; the developer page to open (strategic, or tactical
  when the squad lands). The session gets the client's display language; `?seed=N` passes a seed (tests). After
  `POST /api/sessions` the beginning sequence plays unless `playIntro` is off.
- **Saved games** (`save-panel.ts` over `SaveController`, `src/ui/saves/save-controller.ts`, and
  `src/ui/saves/save-rows.ts`, shared with the canvas save/load screen): the server's list (newest first), each row with
  `DisplaySaveGameEntry`'s fields: `pMessageStrings[MSG_DAY] N, hh:mm`, the location (the sector code; N/A before
  `STARTING_TIME` and `STR_LATE_14` after it when there is no sector; deviation "Save list in the launcher and on the
  canvas"), `n` with `MercAccountText[MERC_ACCOUNT_MERC]` or `pMessageStrings[MSG_MERCS]`, the balance as
  `InternalSPrintMoney` prints it (`$-1,234` for debts), the description and the Dead is Dead mark
  (`gs_dead_is_dead_mode_tab_name[1]`) by the initial save mode; native saves carry a mark of their own. The tooltip
  lists the difficulty with `SLG_DIFF`, the save mode, the guns, the style, blood and gore and the data version.
  - *Load* asks once, as `SaveLoadSelectedSave` does: the warnings predictable from the header and `/api/health`
    (`engineDiffers` with `SLG_GAME_VERSION_DIF`, `dataVersionDiffers` and `stubPackDiffers` with ja2-node lines) go into
    one box between `SLG_SAVED_GAME_ISSUE` and `SLG_SAVED_GAME_CONTINUE_ANYWAYS`; the load goes into a new session or in
    place into a running one, and the warnings the server returns (the text identity) are shown with the result; a
    native save imports with `newSession {save}`.
  - *Save* as new (`{description}`, at most 46 characters) or over the selected save (`SLG_CONFIRM_SAVE`; `QuickSave` is
    written as `quick`; autosaves and native saves cannot be overwritten), for the session chosen in the panel (preset
    by `?session=` when a game page links back); *Delete* (`SLG_CONFIRM_DELETE`); *Download* (`GET
    /api/saves/:name/file`) and *Upload* (`PUT`, the name taken from the file, made valid and unique, never a reserved
    one). Refusals appear in the status line: `ironMan` with `zNewTacticalMessages[TCTL_MSG__IRON_MAN_CANT_SAVE_NOW]`,
    the others with `SLG_SAVE_GAME_ERROR`, the code and the server's reason.
- **Settings** (`settings-panel.ts`; the model `src/ui/settings.ts`, stored by `src/app/settings.ts` under
  `ja2-node:settings`): the five volumes, mute, speech, subtitles (unchecking the last one shows
  `OPT_NEED_AT_LEAST_SPEECH_OR_SUBTITLE_OPTION_ON` and keeps it on), key-advance speech, mute confirmations, the
  sleep/wake notification, the splash and intro switches, playback speed, the display language, and export and import
  as a JSON file `{format: 'ja2-node-settings', settings}` (`settings-file.ts`; normalized on import, so an older or
  edited file cannot store invalid values). Settings apply at once; the volumes drive the launcher's audio engine.
- **Splash**: unless `playSplash` is off, the launcher starts behind a "Click to start" button and plays the splash
  after the click, which unlocks the audio context; once per browser tab (`sessionStorage`), not each time a game page
  links back (deviation "Splash start"). The video and credits panel plays the splash, the beginning and the credits
  (the DOM scroller, deviation "Credits screen").
- **Sessions and pages**: each running session with links to `/play` and to its strategic and tactical developer pages;
  links to every developer page.
- **Labels** (`src/ui/text/labels.ts`, `src/ui/text/string-ids.ts`): every label is an original string `{table, index}`
  of the string tables (`zSaveLoadText`, `gzGIOScreenText`, `zOptionsText`, `zOptionsToggleText`, `pMessageStrings`,
  `gpStrategicString`, `pUpdateMercStrings`, …; indices from `Text.h`, `GameSettings.h` and `Map_Screen_Interface.h`)
  or a ja2-node label with an English and a Russian text. The launcher loads `GET /api/strings?lang=` for the chosen
  language; a ja2-node label falls back to English in the other six languages, a missing original string shows its
  label id. The message box is a `<dialog>` with the original's YES, NO and OK of `pMessageStrings` behind the
  `MessageBoxes` interface (`src/ui/message-boxes.ts`).
- **In the developer pages**: `src/app/net/save-controls.ts` binds Alt+S (`save {name: 'quick'}`) and Alt+L (`load
  QuickSave`) by `KeyboardEvent.code`, so any keyboard layout works, adds quick save, quick load and a link back to the
  save list, and shows the outcome: `pMessageStrings[MSG_SAVESUCCESS]`, `SLG_LOAD_GAME_OK`, `SLG_LOAD_GAME_ERROR` with
  the reason, the Iron Man text, or a ja2-node line when there is no quick save (the original then does nothing). The
  session client (`src/app/net/session-client.ts`) drops its queued frames whenever a `welcome` arrives, so no frame of
  a replaced simulation is applied after a load in place. The sleep/wake notification (`src/app/sleep-wake.ts`,
  `src/app/net/sleep-wake-stop.ts`): with the setting on, a frame carrying `fellAsleep` (not a collapse) or `wokeUp` of
  a merc off a squad or vehicle (the cases `HandleRestFatigueAndSleepStatus` opens the update box for) switches the
  real-time driver to manual; the strategic page's advance adds the two events to its stop condition and restarts
  quietly when the stop was a case without a box; the message is `pUpdateMercStrings` with the merc names. Debug hooks
  `window.__ja2SaveKeys`, `window.__ja2SleepWake`.
- **Known limitation**: the playback speed setting is stored, but no page reads it (the developer pages keep their own
  playback buttons).

---

## 9. Data tables and original data

### 9.1 Externalized files used directly

From `data/externalized/` (Stracciatella's tables, in the repository): `music.json` (modes → tracks, §3);
`strings/translation-*.json` and the per-language files, eight languages plus `rusgold` (§5); `translation_tables/*.json`
(the glyph tables `eng`, `fr`, `rus`, `rus-gold`, `chs`); `calibres.json` and `weapons.json` (gun sound paths);
`explosion-animations.json` (explosion sounds); `vehicles.json` (vehicle sounds); `game.json`, `imp.json`,
`strategic-ai-policy.json` (logic content under the save's content identity, §2).

### 9.2 Transcribed tables and constants

Generated by `tools/transcribe/*.ts` into `data/tables/`:

| Table | From | Content |
|---|---|---|
| `sound-effects.json` (`sound-effects.ts`) | `Utils/Sound_Control.h:28-352`, `Utils/Sound_Control.cc:17-328` (`szSoundEffects`, `szAmbientEffects`), `Directories.h`, the literal sound paths in `src/game/**/*.cc` | 291 sound ids in `SoundID` order (id, name, VFS path or `null` where the original has none), 14 ambient sounds, the pan (0 left to 127 right) and volume (0–127) constants, `SOUND_FAR_VOLUME_MOD` 25, and the 25 sound files the code names literally (such as `sounds/weapons/bursttype1.wav` and `laptop/static*.wav`) with the files naming them |
| `battle-sounds.json` (`sound-effects.ts`) | `Tactical/Soldier_Control.h:178-198`, `Tactical/Soldier_Control.cc:97`, `:138-157`, `:5868` | the 17 kinds in `BattleSound` order with their file part, `randomVariants` (the kind and the next n−1 kinds are drawn from), `badGuy` (playable without a profile), `dontAllowTwoInRow`, `stopDialogue` (0 never, 1 cuts speech, 2 skipped while talking); the repeat filter `MIN_SUBSEQUENT_SNDS_DELAY` 2,000 ms; the low-morale threshold 35 |
| `edt-layouts.json`, `l10n.json`, `mlg.json` | §5.5 | |
| `ui-constants/Button_Sound_Control.json` (`ui-constants.ts`) | `src/sgp/Button_Sound_Control.cc:11-50` | click schemes per screen (`28` §11) |

`src/content/audio/sound-table.ts` loads the two sound tables and lists the generic voice sets (`m`, `f` as profile
fallbacks; `bad0-2` male, `bad7-8` female, `kid0-1` without a profile; from `Soldier_Control.cc` and
`Soldier_Create.cc`), the voice paths, and the sound paths of `weapons.json`, `calibres.json`,
`explosion-animations.json` and `vehicles.json`, with `%d` bursts expanded to the largest burst (6).

Constants instead of tables where a handful of values is all there is, in modules with the SFI header: the music modes
and the victory and defeat end rules (`src/protocol/music-modes.ts`, from `src/externalized/content/ContentMusic.h:3-17`,
`Utils/Music_Control.cc:182-319`), the intro sequences (`src/app/video/sequences.ts`, from `Intro.cc:34-78`,
`:252-329`), fade steps, the 2 s battle-sound filter, the 46-character save description, the 16-voice cap, the ambient
time windows.

### 9.3 Original data read at runtime, never committed

Sounds, battle sounds, speech and `.gap` files, music, ambient `.bad` tables and sounds (`Ambient.slf`), laptop sounds,
the Smacker videos (in the Steam package's `Intro-old.slf`), `credits.edt` and the other EDT files, fonts. Tests that
need them use `describe.skipIf(!ORIGINAL_DATA_DIR)` (`tests/support/original-data.ts`) and assert counts, formats and
lengths only. Checked on the user's data: every WAV of `sounds.slf` (370 PCM), `battlesnds.slf` (67 PCM, 1,514 IMA
ADPCM) and `music.slf` (14) decodes, a sample of the speech decodes and all 8,353 `.gap` files hold whole pairs
(`src/content/formats/wav-original.test.ts`); every video decodes with its audio; all 248 rows of the English credits
parse; every fixed EDT file holds whole records.

The WAV reader (`src/content/formats/wav.ts`) takes RIFF/WAVE PCM 8/16-bit mono and stereo and IMA ADPCM (0x11) with
any block align, the frame count from `fact` or the data size; unknown chunks are skipped, junk after `data` is ignored,
an oversized `data` is clamped; other tags and depths fail with a clear error. `.gap` files are pairs
(`src/content/formats/gap.ts`, `Gap.cc` `PollAudioGap`).

### 9.4 Native save import

The format and the import are `14`'s. The platform adds: the game options through `importNativeGameOptions`
(`src/sim/options.ts`: difficulty, sci-fi, guns and save mode kept, `turnTimeLimit` dropped and listed in the report's
`droppedOptions`); the music mode byte (`SaveLoadGame.cc:1827`) as the session's starting music
(`musicModeOfNativeByte`, `src/protocol/music-modes.ts`); `useCreatureMusic` (decoded in
`src/content/formats/savegame.ts`); the NPC records in the server's data version's layout (`readSavedNpcRecords`,
`src/content/formats/savegame-npc.ts`). The German encryption is taken from the save's own flag (`germanEncryption`,
`14` §3). The import does not check that the save was made with the server's data version. Native saves appear in
`listSaves` (§1).

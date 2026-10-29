# 27 — Saves and options

ja2-node's own saves (§1) and the options a game runs with (§2): what a save guarantees, holds and must never hold, how
it is bound to the game data, how loads treat the random streams, the save rules, the input log and replay; which
options reach the simulation and how. Siblings: `14` native `.sav` files and their import; `04` the session, its input
log and the rule pack whose hash binds a save; `29` §26–§27 every save, load and option call with its refusals; `30` the
save/load and options screens; `31` data versions, languages and the music state a save keeps; `01` §3.6 the random
streams and §3.9 the game policy.

**Conventions.** Original-source paths are relative to `reference/stracciatella/src/game/`; `sgp/…` and
`externalized/…` to `reference/stracciatella/src/`.

---

## 1. Saves

### 1.1 What is kept and where it lives

Stracciatella's save system as the player knows it: a list of named saves, newest first, a player save named after the
UTC time and its description; the quick save; the end-of-turn autosave into `Auto01`/`Auto02`; the save modes Iron Man
and Dead is Dead. The file is ja2-node's own; native saves are imported, never written (`14`).

| Part | Where |
|---|---|
| Snapshot codec, restore, migrations | `src/sim/snapshot/` (DOM-free, Node-free, deterministic) |
| Session snapshot: content loading, prepared maps, restore of each session kind | `src/server/session-snapshot.ts` |
| File format, header, gzip | `src/server/save-file.ts` |
| Content and engine identity | `src/server/content-identity.ts`, `src/server/repository-history.ts` |
| Save, load, list, upload, download; automatic saves | `src/server/save-service.ts` (`SaveService`) |
| Save modes and refusals | `src/server/save-rules.ts` |
| Files, names, backups | `src/server/save-store.ts` |
| Input log, replay | `src/server/input-log.ts`, `src/server/replay.ts`, `pnpm cli replay` |
| Wiring for the server and the CLI | `src/server/save-environment.ts`, `src/server/session-factory.ts` |

### 1.2 Snapshot contract

1. **Saving has no effect**: no draw, recomputation or flag change (also the rule of `15` and `35`). The original's
   save-time `Random(RAND_MAX)` and its temp-file write of the loaded sector are not reproduced (deviation "Save side
   effects"). Before a campaign snapshot the campaign's undrained output events move into a buffer of the server
   `Session`, which the next advance reports first; the tactical event buffer (`TacticalState.events`) is plain state
   and is written.
2. **Restore is exact.** For any inputs `I`, `continue(S, I)` and `continue(restore(snapshot(S)), I)` produce the same
   event log and the same final snapshot, byte for byte ("load + replay = same outcome"). A load therefore never runs
   the original's load hooks (deviation "Schedules on load"); only a native import does, once (`14`).
3. **Versioned.** The file and the snapshot each carry a version; older ones go through migration chains on the plain
   JSON (`SAVE_MIGRATIONS` in `save-file.ts`, `snapshotMigrations` in `src/sim/snapshot/migrations.ts`). **Rule:** a
   change of the state's shape bumps `SNAPSHOT_VERSION` and adds a migration. `src/server/legacy-save.test.ts` loads
   the saves 0.7.0 wrote (`src/server/fixtures/`) and expects the soldiers 0.7.0 showed 400 ticks later.
4. **Content-bound.** A snapshot is valid only with the game data it was made with (§1.4).

**Save points** lie only between inputs: the server is single-threaded, so a save lands between two commands or two
real-time batches, and an `advance` stops between ticks, never inside one.

**Deliberately nondeterministic:** the wall-clock `savedAt` (presentation), the entropy seed of a player load (logged,
§1.5), the timing of browser input (logged as tick counts, §1.7).

### 1.3 The save file

One `<name>.j2s` per save, a gzip of one JSON document (`SaveFile`): `header`, `session`, `sim`, `presentation`.

- **The header comes first, in its own gzip member.** It repeats what the save list shows (kind, description, time,
  sector, mercs, balance, options) and the identities of §1.4, so the list inflates only the start of each file and
  never parses a body: the original's reason for its fixed-size header. The file stays one JSON document for `gunzip`.
- **`session`**: the session kind, a description of the log origin and the world cache's prepared maps in order. A
  step may load a sector and the `WorldCache` is history-dependent, so a restore prepares the same maps before building
  the session.
- **`sim`**: the snapshot (§1.8).
- **`presentation`** is never read by `sim`: the music mode (`31`); the message log, so a load shows the same lines;
  the campaign identity, a random id a new campaign keeps through saves (`src/server/campaign-id.ts`), by which the
  client keys per-campaign UI state such as the help screens seen.
- A save's **digest** (SHA-256 of the inflated text) identifies it as a log origin (§1.7).

**What a save never holds:** text (only quote lengths reach the simulation, `31`); client settings and screen state
(deviations "Laptop page state", "Help screens seen"); the session's driver, real-time carry and speech mode (`29`
§27); undrained output events (§1.2).

### 1.4 Content identity

A ja2-node save is the simulation's own state and cannot be rebuilt on other logic data, so `header.content` and
`header.engine` bind it to what it was made with:

- **`logic`**: the rule pack's identity hash (`04` §5.10) over the game data only (the data folder and SLF archives, or
  the stub pack), not the project tables, which ship with the engine. The pack covers every file the simulation can
  read, so the hash is known before any session exists (`welcome` carries it).
- **`text`** (`quoteLengthIdentity`): a hash of the character count of every row of every dialogue file in use. Quote
  lengths are the only way text reaches the simulation (`24`); `none` for the sandbox.
- **`dataVersion`** (`31`) and **`engine`**: the package version and the commit (`JA2_COMMIT`, else `git rev-parse
  HEAD`). The engine covers the project tables, the game policy among them (§2.3).

**Load check** (`SaveService.#verify`, then after the restore): another content source is refused (`contentMismatch`);
another `logic` hash is refused on the original data and only warned about on the stubs (`stubPackDiffers`: the
repository generates the stub pack and changes it during development); another data version or other quote lengths
(`dataVersionDiffers`) and another engine (`engineDiffers`) load with a warning, since text only changes speech timings
(deviation "Save compatibility"). `listSaves` predicts the refusals and `stubPackDiffers` from the header alone.

**Older identities stay loadable.** The pack's all-layers hash, the identity before the project tables left it, is
accepted; a re-save writes the scoped one. Version 1 saves (0.7.0) list the files they read (`legacyContent`);
`ContentLedger.matchesSaved` recomputes their hash, taking the project tables from the repository's history at the
save's engine commit (`git cat-file`) when the current ones differ.

### 1.5 Random streams on load

The original saves only the `PreRandom` table and index (`SaveLoadGame.cc:2110-2127`), seeds its engine once at
start-up (`sgp/SGP.cc:433`) and refills each used `PreRandom` slot from it (`sgp/Random.cc:24-28`): after a reload the
next `PreRandom` draws repeat until used, while `Random` continues from the running process, in effect a fresh stream.

The snapshot stores `main`, `pre` and every cosmetic stream exactly; `load {reseed}` picks one of two modes:

- **Player** (`reseed: true`, the default for the browser and MCP): `pre` is restored, so the original's
  anti-save-scum repeat holds, and `main` is reseeded from server entropy through `reseedMain` (`Rng.restore` in place,
  so the tactical layer and the `PreRandom` refill keep following the same object). The seed is returned and logged as
  `reseed {seed}`, so a player load is reproducible from (save, seed, inputs) (deviation "Player loads"): a player load
  with seed `s` is an exact load followed by `reseed {s}`.
- **Exact** (`reseed: false`): everything continues bit-identically; for tests, replays, bug reports and agents that
  want reproducible experiments.

### 1.6 Names, folders and save rules

**Folders.** `$JA2_SAVE_DIR`, default `.ja2/saves/` in the repository (gitignored): a developer server keeps its saves
beside the code. Native saves stay in `$JA2_SAVES_DIR`, read only; `newSession {save}` imports one (`14`), which can
then be saved in ja2-node's format.

**Names.** Clients pass names, never paths (`29` §26). `QuickSave`, `Auto01`, `Auto02` and `Error` are reserved. Every
write goes through a temporary file and a rename. The Dead is Dead file is the name the campaign was given at
`newSession` (default `DeadIsDead`), after a load the loaded save, after an import the native file's name.

**Rules** (`src/server/save-rules.ts`; the reasons are refusal codes of `save`):

| Mode | `save`, quick save | Automatic saves | Load |
|---|---|---|---|
| Save anywhere | refused in a conversation (also a scripted sequence or a busy dialogue queue), while a meanwhile starts or plays, while a decision prompt is open (also autoresolve) and in a shop; allowed in the laptop (deviation "Saving in the laptop") | after an accepted `endTurn` in turn-based combat that does not end combat (`Tactical/Handle_UI.cc:1066-1084`): the older or missing of `Auto01`/`Auto02`, silently | allowed |
| Iron Man | also refused in turn-based combat and while the loaded sector holds enemies, even outside combat (`CanGameBeSaved`, `GameSettings.cc:233-259`) | the same rule, so none in combat | allowed |
| Dead is Dead | an explicit save is refused; a quick save writes the Dead is Dead file | the one file, at the original's save points: our turn starts, `endTurn`, a meanwhile starts, a group is about to arrive, before another save is loaded into the session, at session close and server stop; written only on our turn (or outside combat) with nothing in progress and no conversation, meanwhile, prompt or shop (`DoDeadIsDeadSave`, `SaveLoadScreen.cc:1363-1405`), after rotating two backups | never blocked |

- **Check order** of `saveRefusal`: `deadIsDead` (an explicit save in that mode), `conversation`, `meanwhileStarting`,
  `promptOpen`, `shopOpen`, then Iron Man (combat first, then enemies in the loaded sector).
- **Automatic saves only read the simulation.** `SaveService` hooks every session (`Session.hooks`: before and after a
  dispatch and an advance, after a whole input, on a throw); a failing hook only logs. Before an `endTurn` in
  turn-based combat the service captures the save and writes it once the command is accepted without ending combat, so
  the file holds the state at the original's `UIHandleEndTurn` (deviation "Dead is Dead save points"). The other Dead
  is Dead points are read from the input's effects (a `turnStarted` event of our team, a meanwhile event, a due
  `GROUP_ABOUT_TO_ARRIVE` that left the queue) and written at the end of that input or at the first later input
  boundary where the conditions hold: saves happen only between inputs, and a skipped point waits instead of being
  lost. No other autosaves (sector entry, daily), even for long agent campaigns.
- `gameSaved` is reported for player and quick saves only; autosaves and Dead is Dead saves are silent, as in the
  original.
- **An error log instead of an error save.** When a command or a step throws, the server writes the whole input log as
  `Error.log.jsonl.gz`: the state after an exception is not trustworthy, and the log replays to the failure (deviation
  "Error saves").

### 1.7 Input log and replay

`Session` (`src/server/session.ts`) appends every input that can change the outcome to its `InputLog` **before**
running it; queries are never logged. Besides commands and prompt answers:

| Kind | Why it is logged |
|---|---|
| `advance` | it has side effects (it can start compression, `src/sim/advance.ts`). Real-time batches are `advance` entries; consecutive batches that ran their full tick count merge (up to 100,000 ticks), which is equivalent because a full batch stopped on no decision, end or watched event; a batch with pause events never merges |
| `prepare` | the maps a command's asynchronous preparation added: the world cache is history-dependent |
| `reseed` | the seed of a player load |
| `load` | the name and digest of a load in place; a replay refuses a save that changed since |
| `speech` | the session's speech mode (`29` §27) |
| `drive` | informational: the advances a driver causes are logged themselves, so a replay uses the manual driver |

A save writes the segment since the last load as `<name>.log.jsonl.gz`, headed by its origin: a seed (and the campaign
request), a native save's digest, or a ja2-node save's name and digest; a session the server did not build has the
origin `unknown` and is not replayable. `pnpm cli replay <save name>` rebuilds the origin, applies the entries and
compares the snapshot with the save's, printing the first differing byte. The log serves bug reports, regression tests
and the analysis of an agent's play; loading never needs it.

### 1.8 Snapshot codec

**Why a codec.** The tactical layer is an object graph of soldier, item, bullet, light and structure pointers, so
`01` D7's "ids instead of pointers" does not hold there. Weighed: a codec that encodes and re-links pointers, with all
private session state moved into the state objects (built); the tactical layer refactored to ids everywhere (cleaner,
but it touches every combat and AI module); replay-only saves (rejected: load time grows with the campaign and any code
change breaks old saves).

**How the graph is written** (`codec.ts`, `refs.ts`, `world.ts`, `session.ts` in `src/sim/snapshot/`):
- Soldiers, world items, light sprites and bullets have their bodies in sections written before the strategic and
  tactical state, so a pointer to one reads like an id (`{"$ref": "soldiers/5"}`); a structure instance lives in its
  tile's list in the `world` section. Any other object reached twice becomes a reference to its first occurrence, so
  aliasing and cycles survive.
- **Content is referenced, not copied**: an object reachable from the content roots (the campaign parts, the loaded
  world's immutable parts) is written as its key and resolved against freshly loaded content. `Rng`, `PreRandom` and
  the mutable world classes (`WorldStructures`, `MovementCosts`) have class codecs.
- **Hooks are not written**: the tactical hooks, the narrative port and the schedule clock are re-installed on
  restore; `pathEnv` is written as its settings.
- **Loud failures**: a function, a class instance without a codec, a bigint, a null-prototype object or a key starting
  with `$` fails with its path, so state the codec cannot write is found when it is added.
- **Equal histories give equal bytes**: object keys keep their order, maps and sets their insertion order. Sorting was
  rejected because order is behaviour (the roster's iteration order is hire order and a rehire reuses a lower soldier
  id), and because a restored object must be a replica so that events re-emitted from restored state (the tactical
  event buffer) serialize to the same bytes.

**Restore never recomputes.** The caller gives the loaded sector's world, of which only the content parts are used;
structures, movement costs, exit grids, the init list, edgepoints, schedules and everything else come from the
snapshot as written. `TacticalSim.restore` and `CampaignSim.restore` re-install the hooks around the decoded state and
skip the creation side effects (`assembleCampaign(…, {construction: 'restore'})`, `assembleImportedCampaign(…,
'restore')`); `SectorFlow.reattachLoadedSector()` re-installs the sector hooks.

### 1.9 What the state may hold

The codec works only if every outcome-relevant value lives in `StrategicState` or `TacticalState` (plus the loaded
world) and those hold nothing the codec cannot write. Rules for code that adds state:

- **No private session state.** Counters, timers and flow state live in the state roots and are read through
  accessors: the session counters in `state.session`; the tactical tick, real-time clock and AI pass in
  `TacticalState`; the flows' own state in `state.sectorFlow`, `state.shop` and `state.talk` (so Carmen's departure
  timer is saved, deviation "Carmen's departure timer").
- **The roster is records.** `state.roster.mercs` maps soldier ids to `MercRecord`s; `RosterMerc` is a facade without
  own fields. The profile traits the economy and morale read are copied into `MercRecord.profileRecord` at hire,
  whatever the merc's source (content, I.M.P., a native save, a stub recruit).
- **Cosmetic streams are state** (`state.talk.dialogue.fx`, `state.cosmetic`), seeded from the session seed and saved:
  a few cosmetic picks are stored in state (the civilian's current line, the merc who triggers a record), so exact
  reloads need the streams; gameplay never draws from them (deviation "Cosmetic streams in saves").
- **Hooks and wiring are rebuilt, never stored**: contexts, `Roster.hooks`, the narrative slots, the event dispatch
  table, the strategic AI binding (closures over the state) and the oracle overrides come from the constructors and the
  restore path.
- **State never references a module-level constant object.** A restored campaign would hold copies where a new one
  holds the shared constant, and the aliasing would differ after a reload; group sectors and stub merc stats therefore
  get their own objects, and no group sector object is mutated in place.
- **Caches are derived**: module-level `WeakMap`s keyed by content, the light template map and the content indexes are
  allowed and never written.
- **Identity checks must survive a reload.** Militia prompts are answered from the head of `economy.prompts`, never
  found by identity. `registeredInTactical` (`src/sim/campaign/roster.ts`) stays an identity check: `t.soldiers` keeps
  the object of a soldier who left the team until the slot is registered again, and a hire can reuse that id meanwhile,
  so an id comparison would act on the wrong soldier; the codec keeps the check valid by writing a registered roster
  soldier once.
- **Buffers drain at boundaries.** Every flow and context buffer drains into the campaign's output queue at each command
  and step boundary; between commands only `CampaignSim`'s output (held by the server across a save, §1.2) and
  `TacticalState.events` (written) hold events.

### 1.10 Server wiring and verification

**Load path** (`SaveService.open`, `loadInto`): read the file, inflate, parse, run the save and snapshot migrations,
check the content (§1.4), restore through `restoreSession` (fresh content through the rule pack, the same prepared
maps, the loaded sector's world), compare the text identity. A load in place first takes the session's Dead is Dead
save point, then `Session.replace` swaps the simulation, music, message log and campaign identity (every viewer gets a
fresh `welcome`; a running real-time driver stops with `loaded`, `29` §26); a player load then reseeds. A new session
from a load gets the log origin `load`. An upload is parsed, migrated and checked against the content before it is
written.

**Verification.** The reload harness (`tests/support/reload.ts`, `tests/support/session-reload.ts`;
`createTestCampaign(kit, {mode})`) restores a driven sim into a fresh one, and snapshots it again to check the round
trip, after every accepted command, after every `advance` and before a command that follows direct steps;
`expectReloadsInvisible` compares the event log and the final snapshot of a plain and a reloaded run byte for byte.
`pnpm test:reload` (`JA2_RELOAD=1`) runs every test that drives a sim through the harness in reload mode: the guard
against state the codec misses, including state added later. A test looks state up again after an input instead of
holding objects across it, and puts `reloadPoint` at input boundaries, not right after a direct flow call whose events
still sit in a flow buffer. `tests/support/state-copy.ts` deep-copies a state and fails on any class instance other
than the streams and on any function. `pnpm cli replay` checks a saved log against its save.

### 1.11 Browser surfaces

- The canvas save/load screen on `/play` (`src/ui/screens/front-end/save-load.ts`, `src/ui/saves/`, `30`) follows
  the original's list: newest first; in save mode quick and auto saves hidden and a new row first.
- The launcher's save panel (`src/app/launcher/save-panel.ts`) shows the same rows: Load with one warning box, Save as
  new or over a player or quick save, Delete, Download, Upload, and the native saves to import. Its row location and
  tooltip differ from the original (deviation "Save list in the launcher and on the canvas").
- `/play` binds no quick save or quick load key yet (gaps "Tactical keys not yet ported", "Map screen keys not yet
  ported"); the developer tactical and strategic pages bind Alt+S and Alt+L (`src/app/net/save-controls.ts`).

### 1.12 Quirks of the original the code keeps

| Quirk | Test |
|---|---|
| Save mode hides quick and auto saves from the list | `src/ui/screens/front-end/front-end.test.ts` "hides quick and auto saves when saving …" |
| Autosaves and Dead is Dead saves show no message | `src/server/save-service.test.ts` "autosaves into Auto01 and Auto02 …", `src/server/save-rules.test.ts` "in Dead is Dead save into the one file …" |
| Dead is Dead keeps two backups and never blocks a load | `src/server/save-store.test.ts` "… keeps two backups of a Dead is Dead save", `src/server/save-rules.test.ts` "in Dead is Dead save into the one file …" |
| Iron Man refuses saves while enemies are in the loaded sector, even outside combat | `src/server/save-rules.test.ts` "in Iron Man refuse saves with enemies in the loaded sector …" |
| `PreRandom` repeats after a reload until the saved values are used | `src/server/save-service.test.ts` "repeats the saved PreRandom ring after a player load …" |

Deviations: "Save side effects", "Schedules on load", "Save compatibility", "Player loads", "Saving in the laptop",
"Dead is Dead save points", "Error saves", "Cosmetic streams in saves", "Talk context in saves", "Carmen's departure
timer", "Laptop page state", "Save list in the launcher and on the canvas". Gaps: "Main menu quick load", "Save
location on the canvas".

---

## 2. Options

### 2.1 Where the original's options go

The original keeps five game options per campaign in the save (`GAME_OPTIONS`, `GameSettings.h:93-100`), 23 toggles,
the volumes and the scenes and help screens seen per user in `Ja2.set`, engine options in `ja2.json` and on the command
line, and gameplay values in the policy files. ja2-node sorts them by whether they can change the outcome:

| Kind | Where it lives | Changes the outcome | Examples |
|---|---|---|---|
| **Game options** | session state, chosen at `newSession`, saved, shown in `status` and `observe` | yes | difficulty, sci-fi, gun nut, save mode, blood and gore |
| **Game policy** | engine content (`data/externalized`, the `ja2-node-data` layer) | yes | `game.json`, `imp.json`, `strategic-ai-policy.json` values |
| **Client settings** | the browser (`localStorage`); never sent to the simulation | no | volumes, speech, subtitles, display toggles, playback speed, language, scenes and help screens seen |
| **Server settings** | the environment, one per process; never enter a session | no | data and stubs folders, data version, default language, saves folder, host, port |

Stracciatella's engine options become server settings (the folders, the data version) or client settings (the
resolution); ja2-node has no mods (`32`), and the debug and cheat levels are not ported (deviation "Cheats").

**What the 23 toggles do to the outcome** decides where each one goes:

| Toggles | In the original | In ja2-node |
|---|---|---|
| `BLOOD_N_GORE` | changes state: messy deaths, corpses and blood graphics, with their draws (`Tactical/Soldier_Control.cc:3141-3283`) | a game option (§2.2) |
| `MUTE_CONFIRMATIONS`, `ANIMATE_SMOKE` | change only gameplay draws: the OK battle sound's pick, the smoke's start frame `Random(5)` | client settings; the simulation makes neither draw (`01` §3.6, deviation "Cosmetic draws in explosions") |
| `SPEECH`, `KEY_ADVANCE_SPEECH`, `HIDE_BULLETS` | pace the game: a line ends with its sample or waits for a key; hidden bullets fly 4 tiles per update instead of 1 (`Tactical/LOS.cc:3155-3166`) | client presentation; the simulation's timing is fixed (§2.3) |
| `SLEEPWAKE_NOTIFICATION` | a pausing update box whose dismissal decides compression; sleeping and waking happen regardless | a stop condition (§2.3) |
| the other 16 | input, camera and rendering; `MERC_CASTS_LIGHT` too, since merc lights are fake and cancel out of gameplay light (`20`) | client settings |

### 2.2 Game options

**`GameOptions`** (`src/sim/options.ts`): `difficulty`, `sciFi`, `gunNut`, `saveMode`, `bloodAndGore`.

- **Defaults** are the original's (`ORIGINAL_GAME_OPTIONS`: easy, sci-fi, reduced guns, save anywhere, blood on),
  except `difficulty`, which defaults to medium for an API call without one (deviation "API default difficulty"); the
  front-end forms preselect easy and always send all five fields.
- **One object.** The strategic state owns the options; a loaded sector's `TacticalState.options` and
  `EquipmentState.options` are the same object, so tactical code (sight's difficulty, the army gun choice's gun nut)
  reads the campaign's values; the codec keeps the alias. A sandbox owns its own object.
- **Blood and gore is the only option that changes during a game**, as on the original's options screen, and it changes
  the outcome, so it changes through a logged command: `setOption {bloodAndGore}` changes the shared object from the
  next tick (refusals: `29` §27). It switches the gory shot and explosion deaths, the death animation chain, the corpse
  kind and the blood graphics (the readers of `options.bloodAndGore` under `src/sim/tactical/`). Corpse vaporizing does
  not depend on the camera (deviation "Vaporized corpses").
- **Native saves** (`importNativeGameOptions`): the four options of the header; blood and gore on, because the original
  keeps it in `Ja2.set`, not in the save; a turn time limit is reported as dropped (§2.3).

### 2.3 Game policy and pacing options

**Game policy** ships in `data/externalized` with Stracciatella's shipped JSON values (D1; which keys ja2-node reads:
`01` §3.9, deviation "Game policy keys"). Two keys ship with a JSON value other than the code default, and the JSON
wins: `interrupt_after_being_under_fire` false and `campaign.start_sector_revealed` true
(`externalized/policy/DefaultGamePolicy.cc:41`, `:105`). The policy stays content and is not copied into the session:
it ships with the engine, so the engine identity in the save header (`engineDiffers`, §1.4) marks a save made with
other policy values. If saves must survive policy edits, that is a migration, not a copy.

**Pacing options become presentation or stop conditions, never state.** The simulation's timing is fixed: a line lasts
the longer of its voice and its text (`24`, deviation "Speech"), a bullet moves one tile per tick (deviation "Hide
bullets"), and key-advance speech only holds the subtitle (deviation "Key-advance speech").
`SLEEPWAKE_NOTIFICATION` maps onto the client's or agent's choice to stop a strategic `advance` on `fellAsleep` and
`wokeUp` (`advance {until: {events}}`, `04` §4.2): the pages apply the client setting (`src/app/sleep-wake.ts`), an
agent passes the events it cares about (deviation "Sleep and wake notification"). The outcome then depends only on
when commands arrive. **Timed turns** (`fTurnTimeLimit`, unreachable since JA2 Gold removed the setting,
`GameInitOptionsScreen.cc:94-103`) are not offered: a deterministic port would need a wall-clock rule outside the
simulation, not worth it for an option nobody can choose (deviation "Timed turns").

### 2.4 Client settings

One versioned JSON object in the browser's `localStorage` (`src/ui/settings.ts`: the model, its defaults and
normalization; `src/app/settings.ts`: the storage). Every storage access may fail, and the pages work without storage;
agents have no client settings. The settings take the original's `Ja2.set` toggles, volumes and seen flags with their
defaults, and add ja2-node's own: ambient and master volume, mute, playback speed, language, UI scale, the splash and
intro switches, the website loading time scale. `bloodAndGore` there is only what the new game form preselects; in a
game the options screen sends `setOption`. The help screens seen are kept per campaign identity instead of in the save
(deviation "Help screens seen"). The launcher exports and imports them as a file
(`src/app/launcher/settings-file.ts`).

Stored but read by nothing: the old selection method, show misses and smart cursor (gap "Inert options") and the cover
and LOS display sizes (the display is not built, `28`); "don't move mouse" is inert by design (deviation "Pointer
warp").

### 2.5 Deviations

"API default difficulty", "Game policy keys", "Key-advance speech", "Hide bullets", "Sleep and wake notification",
"Timed turns", "Help screens seen", "Pointer warp", "Cheats".

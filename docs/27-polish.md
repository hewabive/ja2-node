<!-- M7 "Polish": saves, options, sound and music, video, localization, stub completeness, performance, and the scope of a
player UI. An implementable spec. 2026-10-16.
Source: reference/stracciatella (ae6bf01, same snapshot as docs 01–26), cross-checked against vanilla
(reference/vanilla/ja2/Build) where marked; an audit of ja2-node at 6812a37. The user's original data was inspected only for
formats and file names (archive names, WAV encodings, Smacker headers, through `pnpm cli inspect slf` and header
reads); nothing from it is reproduced. Read-only research: no code was built or changed. -->

# 27 — Polish: saves, options, sound, video, localization, stubs, performance

**Conventions.** Paths without a prefix are relative to `reference/stracciatella/src/game/`; `src/sgp/…`,
`src/externalized/…`, `rust/…`, `assets/…` and `dependencies/…` are relative to `reference/stracciatella/`; `V:` is
vanilla `Build/`. ja2-node paths start with `src/`, `data/`, `stubs/`, `tools/` or `docs/` and are relative to the
repository. "(inferred)" marks conclusions not traced end to end; everything else was read in the code. `R(n)` is
`Random(n)` (the `main` stream), `PR(n)` is `PreRandom(n)` (`01` §3.6).

**Companions (do not duplicate).** `01` (D1–D16, layers, §5.3 sound and video, §6.3 saves, §10 milestones), `04` (§4
drivers and playback, §5.5 saves and the log, §6 agent API), `05` (rendering), `14` (the native save format and its
import), `15` §5 (clock state in saves), `21` (laptop), `24` §11.5 (text at runtime) and §10.2 (speech timing), `25`
§5.6 (schedules in saves), `26` §2.4 (the scene log for later playback) and §6–§7 (the ending), `deviations.md`.

## 0. Scope and summary

M7 in `01` §10 reads: saves in the UX, options, full sound and music, video, Russian localization, stub completeness,
performance, result "Release". This spec covers each item (§1–§7), decides the player-UI question (§8) and gives the
agent API, determinism rules, data, tests and a slice plan (§9–§14).

**Recommendation in one paragraph.** Split the old M7. **M7 Polish** delivers everything except the canvas player UI:
ja2-node's own save format and its API, game options as session state, the sound and music engine driven by the event
log, a Smacker decoder and player, data-version-aware text with the Russian string tables, the stub content that these
features and a full stub campaign need, a benchmark suite with targets and a worker host, plus a DOM launcher (new game,
saves, settings, videos) and the devtools pages wired to sound and saves. Its result is a release of the platform: a
campaign playable from start to end by an agent through MCP or by a developer in the browser, on original data or
stubs. **M8 Player UI** then builds the D10 canvas UI on these interfaces; its result is a release for human players.
`01` §10 is updated accordingly.

**The largest single item is the save snapshot**: the audit (§1.2, §1.4) found the tactical layer to be a pointer graph
and part of the session to live in private fields, so slice S1 makes the state serializable before anything else adds
state.

| § | Item | Core decision |
|---|---|---|
| 1 | Saves | A canonical-JSON snapshot of the whole session with a codec in `sim`, exact restore, content binding, an input log; Stracciatella's list of named saves, quick save, autosave at turn end, Iron Man and Dead is Dead rules; reseed `main` on player loads |
| 2 | Options | Game options and the policy JSON are session state; blood and gore is the only outcome-relevant toggle and becomes a command; all other toggles are client settings; timed turns are not ported |
| 3 | Sound and music | Presentation only; the client derives cues from events, frames and timelines; the server computes the music mode as player-visible state; own WAV/IMA ADPCM decoder |
| 4 | Video | Own Smacker decoder in `content`, a WebGL player in the browser, sequences as in `Intro.cc`, no transcoding |
| 5 | Localization | Data version (from the data) and display language (chosen) are separate; Stracciatella's eight-language JSON tables are already in `data/externalized`; the data version reaches the simulation only through quote lengths and record layouts |
| 6 | Stubs | P0: sounds, music, speech blips, merc and item text, a splash video; P1: sector kinds, more profiles, tile types, a Cyrillic font |
| 7 | Performance | Measure first with oracle-free benchmarks; targets for enemy turns, real-time ticks, strategic days, saves; a worker host |
| 8 | Player UI | Not in M7; a DOM launcher instead; the canvas UI is M8 |

---

## 1. Saves

### 1.1 The original

Stracciatella replaced vanilla's fixed slots with a list of named files; both are described because the browser UI may
follow either.

**Files and slots.**

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
mods (`SaveLoadScreen.cc:874-957`). The header (`SaveLoadGame.h:24-60`, 432 bytes, `14` §2) exists to fill these rows
without reading the body. A description is up to 46 characters (`:1054-1057`). Overwriting asks for confirmation
(`:699-704`); Delete deletes after confirmation (`:653-662`, `:1277-1293`); loading a save of another version, build or
mod set asks once with all reasons (`:707-731`, `:1132-1158`); a load failure shows an error and restarts to the main
menu (`:1200-1205`, `:1296-1317`). The main menu disables Load when no save exists (`MainMenuScreen.cc:233`); Alt+Load
or Alt+C loads `gSavedGamesList[bLastSavedGameSlot]` at once (`:268`, `:286-289`, `SaveLoadScreen.cc:378-391`), an index
that Stracciatella only ever sets to 0 (`:1481`), so it loads the newest save in practice (inferred).

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

**Autosave.** Only one rule: `UIHandleEndTurn`, when the player ends a turn in turn-based combat and combat does not end
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
continues from whatever state the running process has: effectively a fresh stream (inferred: this is the "reseed" of
`01` §3.6).

**Settings file** `Ja2.set` (`GameSettings.cc:27`, `:111-130`, in the user's home): volumes, the option toggles, the
last slot, the meanwhile scenes seen, help flags and two display sizes; written after every save and load
(`SaveLoadGame.cc:521`, `:1075`). The current save name is runtime only.

### 1.2 ja2-node today

- **No own save, no input log, no state version, no content identity.** The only file the server writes is `.ja2/token`
  (`src/node/token.ts:17`); native `.sav` files are only read (`src/server/main.ts:34-37`, `docs/14` §10). MCP has no
  `save`/`load` tools yet (`src/server/mcp.ts`), although `04` §6.2 lists them. `Session`
  (`src/server/session.ts:21-132`) records no commands or advance calls.
- **What helps.** A new campaign is already "seed + a command sequence" (`src/server/campaign-factory.ts:157-190`); the
  strategic event queue, clock, sector diffs, NPC records, facts, merchants, contracts, meanwhile and ending state are
  plain data; queued events and dialogue callbacks are stored by name, not as closures
  (`src/sim/strategic/time/event-queue.ts:10-24`, `src/sim/narrative/talk-state.ts:47`); prompts are data answered by
  kind (`src/sim/campaign/battle-flow.ts:790-817`); `Rng` and `PreRandom` expose their state (`src/core/rng.ts:52-59`,
  `:124-137`); the native import (`src/server/save-session.ts:86-177`) is a working template for building a session from
  stored state and re-installing hooks (`sectors.adoptLoadedSector`). Several determinism tests compare two runs of the
  same seed and commands (`src/sim/campaign/battle-scenario.test.ts:131-138` and others); none replays a log or a
  reload.
- **What blocks a snapshot** (audit of 2026-10-16, §1.4): the tactical layer is an object graph with soldier, item,
  bullet, light and structure pointers, contrary to D7; merc records live in a private `Roster` map of class instances;
  part of the session lives in private fields of `CampaignSim`, `TacticalSim` and the flows; `Map`/`Set` fields; content
  objects referenced from state; the mutable world (`WorldStructures` with a private id counter and per-tile list order,
  `MovementCosts`, exit grids, the door table); constructor side effects; several cosmetic streams outside `state`.

### 1.3 Design: the session snapshot

**Contract.**

1. **Saving has no effect.** No draw, no recomputation, no flag change: the session continues exactly as if nothing had
   happened (already the rule of `deviations.md` "Strategic AI load hooks", `15` §5, `25` §5.6). The original's
   `header.uiRandom = Random(RAND_MAX)` at save time (`SaveLoadGame.cc:380`) is not reproduced (deviation).
2. **Restore is exact.** For any inputs `I`, `continue(S, I)` and `continue(restore(snapshot(S)), I)` produce the same
   event log and the same final snapshot, byte for byte. This is "load + replay = same outcome".
3. **Versioned.** Every file carries a format version; older files go through a migration chain on the plain JSON.
4. **Content-bound.** A snapshot is valid only with the logic content it was made with; a mismatch is refused or
   warned about before anything is built.

**File** (`*.j2s`, gzip of canonical JSON: sorted keys, typed arrays as `{"$u8": "<base64>"}` etc., `Map` and `Set` as
sorted entry arrays, so two equal states give equal bytes):

```ts
interface SaveFile {
  format: 'ja2-node-save';
  version: number;
  header: {
    kind: 'player' | 'quick' | 'auto' | 'deadIsDead';
    description: string;               // at most 46 characters, as the original's field
    savedAt: string;                   // server wall clock (ISO), presentation only
    engine: { version: string; commit: string };
    content: { source: 'original' | 'stubs'; dataVersion: string; logic: string; text: string };
    options: GameOptions;              // §2.2
    world: { day: number; hour: number; minute: number };
    sector: string | null; flow: string; mercs: number; balance: number;
    campaign: 'playing' | 'endgame' | 'won';
  };
  session: { kind: 'campaign' | 'sandbox' | 'imported'; origin: string; tick: number };
  sim: SimSnapshot;                    // produced by src/sim/snapshot
  presentation: { music: { mode: string; previous: string } };   // §3.3, never read by sim
}
```

`content.logic` is a hash over the logic inputs the server loaded (the list of VFS paths with sizes and hashes of the
files that feed the simulation: profiles, animation scripts, structure files, tileset table, maps used so far, NPC
scripts, locks, the transcribed tables); `content.text` is a hash of the quote lengths in use (§5.3). Loading with
another `logic` hash or `source` is refused (`contentMismatch`); another `text` hash or `dataVersion` loads with a
warning that a replay may diverge, like Stracciatella's version warning (`SaveLoadScreen.cc:707-731`). The header
repeats what the save list shows without parsing the body (the original's reason for its header,
`SaveLoadGame.h:24-60`).

**Codec** `src/sim/snapshot/` (DOM-free, Node-free, deterministic, SFI header only where it encodes original fields):
`snapshotSession(sim): SimSnapshot` and `restoreSession(snapshot, deps): SessionSim`, where `deps` holds the shared
content and the prepared maps. Encoding rules, one place for each (as built in S2 with insertion order and references
by path, see §1.4 "Status after S2"):

| State | Encoded as |
|---|---|
| plain records, arrays, numbers, strings | as is |
| typed arrays | tagged base64 |
| `Map`, `Set` | entries sorted by key; shared instances (the profiles map shared by tactical and strategic, `status.weaponsDropped` shared with `t.equipment`) are written once and re-linked |
| `Rng`, `PreRandom`, every cosmetic stream | their state words; `PreRandom` ring and index (`src/core/rng.ts`); restored in place through a new `Rng.restore()` so captured references stay valid |
| soldier pointers (`target`, `opponent`, `attacker`, …, turn and perception fields, bullets, explosions, autoresolve cells) | soldier ids |
| world items, bullets, light sprites | indices into their owning arrays |
| structure instances | `{gridNo, level, id}` into the world's structure lists |
| content objects (`StructureInstance.def`, light templates, explosion animations, `MercProfile`) | content keys, resolved against the freshly loaded content |
| closures and hooks | not written; re-installed by the restore path (`#installHooks`, `adoptLoadedSector`, `src/sim/campaign/sector-flow.ts:422-460`) |
| the loaded sector's mutable world | written directly: per-tile structure lists in order with ids and hit points, the id counter, door table and status, exit grids, height cache; the movement cost table is recompiled and compared in debug builds |
| unloaded sectors | their `SectorDiff`s, already plain (`src/sim/campaign/sector-diff.ts`) |

**Restore path** (mirrors `createSaveSession`): parse → migrate → content check → load content (shared, cached) →
prepare the loaded sector's map and the maps the sector flow may need next (the `WorldCache` is history-dependent, so
the loader must prepare like `Session.prepareAndDispatch`) → construct `CampaignSim` without a tactical sim and without
a new game → install the strategic state → rebuild the `TacticalSim` from the map plus the written world → restore
soldiers, items and effects and re-link pointers → `adoptLoadedSector` → restore the private flow state and streams. In
tests and debug builds the loader re-snapshots and compares with the input (any loss fails loudly).

**Save points.** Only between inputs: the server is single-threaded, so a `save` request always lands between two
commands or two real-time batches; the real-time driver is paused around it. Buffers of undrained events are not state
and are drained before the snapshot.

**Input log** (`src/server/input-log.ts`). The session appends every input that can change the outcome: `{seq, tick,
kind: 'cmd' | 'answer' | 'advance' | 'drive' | 'reseed' | 'load', payload}`; real-time batches are logged as `advance
{ticks: n}` (the realtime driver turns wall time into tick counts, `src/server/session.ts:117-126`), and the async map
preparation is logged as `prepare {maps}` so replays prepare the same maps (`src/sim/campaign/sector-flow.ts:338-339`).
`advance` is logged because it has side effects (it can start compression, `src/sim/advance.ts:105-129`). A save may
carry the log since the session's origin (new game seed, imported file, or the save it was loaded from) as a sibling
file `<name>.log.jsonl.gz`; `pnpm cli replay <name>` re-runs it from the origin and compares the result with the
snapshot. The log is for bug reports, regression tests and agent analysis; loading never needs it.

### 1.4 Making the state serializable

Each row is a prerequisite of the codec; they land in slices S1 (rows 1–3, 8, 9, 11, 12) and S2 (the rest) (§13), each
with the reload test of §12.1.

| # | Today | Change |
|---|---|---|
| 1 | Private session state: `CampaignSim.#tick`, `#compressing`, `#day`; `TacticalSim.#tick`, `#clock` (`src/sim/campaign/campaign-sim.ts:112-117`, `src/sim/tactical/tactical-sim.ts:202-208`) | move into `state.session {tick, tacticalTick, compressing, day, realtimeClock}`; the `#events` buffers stay private (not state) |
| 2 | Private flow state: `SectorFlow` fields, `ShopFlow.#session`, `TalkFlow.talk`/`#scripted`/`#civQuote`, `NarrativeFlow.talk`, `NpcActionFlow.carmenTimerAtMs`, `AiControl` counters, `StrategicAi.#queen` | move into `StrategicState` (`state.shop`, `state.talk`, `state.sectorFlow`, `state.ai`); Carmen's timer becomes saved state (the "not saved either" of `deviations.md` "Carmen's departure timer" goes away) |
| 3 | `Roster`: private `Map` of `RosterMerc` class instances holding `Soldier` objects and content `MercProfile` (`src/sim/campaign/roster.ts:64-117`, `:292-303`) | plain merc records in `state.roster`, keyed by soldier id, with `profile` as an id; the `Roster` class becomes functions over the records |
| 4 | Tactical pointer graph (soldier, item, bullet, light, structure references, §1.3 table) | encode and re-link in the codec; new code uses ids (D7); fields that are cheap to convert to ids now (`hostileQuoteList`, `aiList`, `intList`) are converted |
| 5 | Mutable world classes (`WorldStructures` private `nextId`, `MovementCosts`, `exitGrids` Set, `mapDoors`) (`src/content/world/structures.ts:113-120`, `src/content/world/movement-costs.ts:97-124`) | `toSnapshot()`/`fromSnapshot()` on each, written as the loaded sector's world (§1.3) |
| 6 | Content references inside state | keys, resolved on restore |
| 7 | `Map`/`Set` in state (`profiles`, `sectorDiffs`, `profileCostToDate`, `imp.profiles`, `imp.voices`, `doorStatus`, `throwParams`, `weaponsDropped`) | codec rule; aliasing restored |
| 8 | Cosmetic streams outside or inside state: `TalkState.fx` (always seeded `0x7a1c`, whatever the session seed), `HelicopterFlow.#fx` (seeded from the clock at construction), `AutoresolveSession.fx`, `ArRng.fx` | all saved; seeded from the session seed at creation. They are saved although D6 calls `fx` unsaved, because a few of them select state (`civ.currentCivQuote`, `src/sim/narrative/civ-quotes.ts:182`; the merc that triggers a record, `src/sim/narrative/converse.ts:607`): saving keeps reloads exact while gameplay still never draws from them |
| 9 | Constructor side effects (flow forced to `tactical`, compression level, fx reseed, a fresh `TalkState`) | a `restore` constructor path that skips them |
| 10 | Autoresolve session (`ArCell.soldier` pointers; `ReplayStream`/`ScriptedStream` only in oracle tests) | ids; only default streams are saved |
| 11 | Identity-based logic (`economy.prompts` removed by `indexOf`, `src/sim/strategic/economy/militia.ts:251-252`; `t.soldiers[m.id] === m.soldier`) | compare by id |
| 12 | `EconomyContext.events` and `CampaignSim.#events` grow without being drained in some paths (`src/sim/strategic/economy/context.ts:36`) | drain at command boundaries (also a memory leak in long campaigns, §7) |
| 13 | Module-level caches (`WeakMap`s keyed by content, the light template `Map`) | allowed: derived from content, never state; documented as such |

**Status after S1 (2026-10-18).** Rows 1–3, 8, 9, 11 and 12 are done; behaviour is unchanged (unit, scenario,
original-data tests and the full oracle compare), and no existing test expectation depended on the cosmetic seeds.

| Before | Now |
|---|---|
| `CampaignSim.#tick`, `#compressing`, `#day` | `state.session {tick, compressing, day}`; a new campaign sets them at construction |
| `TacticalSim.#tick`, `#clock`; `SectorFlow.realtimeClock` | `TacticalState.tick`, `TacticalState.realtimeClock`; in a campaign the latter is the object in `state.sectorFlow.realtimeClock`, which outlives sector loads (a native import's first sim keeps its own, as before) |
| `AiControl` counters (`lastTickMs`, `cursor`, `awayCursor`, `handleThisPass`, `paused`) | `TacticalState.aiPass`; `AiControl` holds only hooks |
| `SectorFlow` fields (`jump`, `usingEdgepointsForEntry`, `overrideInsertionWithExitGrid`, `hasEnteredCombatModeSinceEntering`, `#pendingWait`), `PowFlow.#powSquad`, `#seen` | `state.sectorFlow` (`powSquad`, `powsSeen`); the flows read them through accessors |
| `ShopFlow.#session` | `state.shop.session` |
| `TalkFlow.talk`, `#scripted`, `#civQuote`; `NarrativeFlow.talk`; `NpcActionFlow.carmenTimerAtMs` | `state.talk.dialogue` (the `TalkState`), `.scripted`, `.civQuote`, `.soldiers`, `.carmenTimerAtMs` |
| `Roster.#mercs`: `RosterMerc` instances holding the soldier and the content `MercProfile` | `state.roster.mercs: Map<soldier id, MercRecord>`; `RosterMerc` is a facade with no own fields (the `Roster` caches one per record in a `WeakMap`, derived); the profile is `soldier.profile`, and the four profile-record traits the economy and morale read (`skillTrait`, `skillTrait2`, `personalityTrait`, `needForSleep`) are copied into `MercRecord.profileRecord` at hire, because the record came from content, I.M.P., a native save or a stub recruit |
| `TalkState.fx` (seed `0x7a1c`), `HelicopterFlow.#fx` (clock seed), `AutoresolveSession.fx` (clock and sector seed) | `state.talk.dialogue.fx`, `state.cosmetic.helicopter`, `state.cosmetic.autoresolve`, created once from the session seed (`seed ^ salt`); `ArRng.fx` stays an oracle override |
| `StrategicAi.#queen` | unchanged: a binding of closures over the state (`QueenContext` is the strategic context plus hooks), rebuilt by the constructor; it holds no state |

*Restore path.* `CampaignSim.restore(state, tactical, hooks)` builds the flows and contexts around existing state and
skips the creation side effects (flow forced to `tactical`, the `X1` compression level, the session counters);
`TacticalSim.restore(world, state)` skips state creation, the start clock, schedules, buildings and lighting and only
re-installs the sim's hooks; `assembleCampaign(read, exists, parts, state, 'restore')` (`src/server/campaign-factory.ts`)
wires a campaign the way `buildNewCampaign` does. `createMerchantContext` still fills `merchants.dealers` when it is
empty (idempotent). `src/server/campaign-restore.test.ts` restores a map-screen campaign around a deep copy of its
strategic state (`tests/support/state-copy.ts`, which also fails on any class instance other than the streams or any
function) and runs both through a landing, a move and strategic movement; a sandbox sim restored around its own state
continues like an uninterrupted one.

*Identity.* Militia prompts are answered from the head of `economy.prompts` (`answerPendingMilitiaPrompt`), never found
by identity. `t.soldiers[m.id] === m.soldier` stays an identity check, named `registeredInTactical`: `t.soldiers` keeps
the object of a soldier who left the team until the slot is registered again, and a hire can reuse that id meanwhile, so
an id comparison would act on the wrong soldier. The codec keeps it valid by writing a registered roster soldier once and
re-linking both references.

*Buffers.* Since 64d2fee every flow and context buffer, the economy's included, is collected into the campaign's output
queue at each command and step boundary. Between commands only two can hold events: `CampaignSim.#events` (output,
drained by the session's next advance or `drainEvents`) and `TacticalState.events` (events of the last tactical command,
stamped at the next tactical step; plain data inside the tactical state, so the codec writes them).

*Inventory for S2* (from walking a stub campaign on the map screen and after landing):

- Class instances in `StrategicState`: `rng`, `pre` (refills from `rng`), `talk.dialogue.fx`, `cosmetic.helicopter`,
  `cosmetic.autoresolve`. Everything else is plain data, `Map` or typed arrays.
- Aliasing inside `StrategicState`: group sector objects (`forces.groups[i].prev`, `.next`, `.sector`) can be one object
  shared by several groups or fields.
- Aliasing with `TacticalState` while a sector is loaded: `t.rng`, `t.pre`, `t.profiles`, `t.keyTable`, `t.civGroups`,
  `t.boxing` (= `narrative.boxing`), `t.realtimeClock` (= `sectorFlow.realtimeClock`), `t.equipment.weaponsAlreadyDropped`
  (= `status.weaponsDropped`), `t.worldClock` (= `clock`), and every registered roster soldier (`t.soldiers[id]`,
  `t.mercSlots[k]` = `roster.mercs.get(id).soldier`).
- Pointers inside the plain state: `MercRecord.soldier` is a full `Soldier` whose tactical pointer fields (`structure`,
  `target`, `attacker`, …) are null without a loaded sector but not while the soldier is placed; `battle.autoresolve.ar`
  cells hold soldier pointers and `battle.autoresolve.rng` holds the oracle's replay streams (row 10).
- `TacticalState` (rows 4–7): the pointer graph, `Map`/`Set` fields, content (`content`, `world` with the mutable
  structures), and closures stored in it: `hooks`, `perceptionHooks` and `turnHooks` are re-installed by
  `TacticalSim.restore`, `sectorHooks`, `experienceHooks`, `narrative` and `scheduleClock` by `adoptLoadedSector`, while
  `pathEnv` is built with the state by `createTacticalState`, so the codec must rebuild it.
- Outside both states: `TacticalSim.world` (the loaded sector's mutable world, row 5); wiring rebuilt by the constructors
  (contexts, `Roster.hooks`, `NarrativeFlow.slots`, the event dispatch table, the strategic AI binding,
  `CampaignSim.tactical`); oracle overrides (`ContractFlow.rng`, `LaptopFlow.rng`, `RecruitFlow.reservedSoldierSlot`);
  the server's `Session` driver and real-time carry and the history-dependent `WorldCache` (§1.3); the output queues
  above.

**Status after S2 (2026-10-18).** Rows 4–7, 10 and 13 are done and §1.3's codec and restore path exist; behaviour is
unchanged (unit, scenario, original-data tests, the full oracle compare and the end-to-end tests). As built, the codec
keeps two things §1.3 planned differently: map and set entries keep their insertion order and plain objects keep their
key order (the roster's iteration order is hire order and a rehire reuses a lower soldier id, so sorting would change
outcomes; a restored object must be a replica so that events re-emitted from restored state, such as the tactical event
buffer, serialize to the same bytes; equal histories still give equal bytes), and pointers are references to the first
occurrence of the object rather than per-field ids (the sections are ordered so that the first occurrence is the home
collection, which makes a reference read like the planned id).

*Codec* (`src/sim/snapshot/`, DOM-free and deterministic):

| File | Content |
|---|---|
| `codec.ts` | generic graph codec: ordered named sections, tags for what JSON cannot hold, references, externals, class codecs, loud failures |
| `refs.ts` | content index: every object reachable from the named content roots, keyed by its first path in a deterministic walk, merged per root set and cached per content object (row 13) |
| `world.ts` | class codecs (`Rng`, `PreRandom`, `WorldStructures`, `MovementCosts`), the loaded world's content roots, light templates by name |
| `session.ts` | `snapshotCampaign`, `snapshotTactical`, `restoreCampaign`, `restoreTactical`, `migrateSnapshot`, `reseedMain` |
| `base64.ts` | base64 over byte buffers |

| State | Written as |
|---|---|
| plain objects, arrays, strings, booleans, finite numbers | JSON; object keys in their order; `-0`, `NaN`, `±Infinity` as `{"$num": "-0"}` etc.; `undefined` as `{"$undefined": true}`; arrays with holes as `{"$sparse": length, "$e": [[index, value], …]}` |
| typed arrays | `{"$u8": "<base64>"}` (`$i8`, `$u8c`, `$i16`, `$u16`, `$i32`, `$u32`, `$f32`, `$f64`), little-endian bytes; a view into a larger buffer is refused |
| `Map`, `Set` | `{"$map": [[key, value], …]}`, `{"$set": […]}` in insertion order |
| an object reached again (aliasing, cycles) | `{"$ref": "<path of its first occurrence>"}`, JSON-pointer segments (`~0`, `~1`) joined by `/`; map entries are `<map>/<i>/0` and `<map>/<i>/1`, sparse elements their real index |
| soldiers, world items, light sprites, bullets | bodies in the sections `soldiers` (`t.soldiers`), `items` (`t.worldItems`), `lights` (`t.lighting.sprites`) and `bullets`, written before `strategic` and `tactical`, so a pointer reads `{"$ref": "soldiers/5"}`, `{"$ref": "items/3"}`, `{"$ref": "lights/12"}`; a soldier object that is not `t.soldiers[id]` (the stale object `registeredInTactical` guards against) keeps its own body, and a registered roster soldier is written once with both references re-linked |
| structure instances | bodies in the per-tile lists of the `world` section; a pointer reads `{"$ref": "world/structures/lists/<gridNo>/<index>"}` |
| content objects | `{"$x": n}` into the snapshot's `externals` table of keys such as `content/animStructures/3/2/structures/5`, `world.tiles/399/structure`, `light/L-R03.LHT`; roots: `content`, `strategic`, `army`, `economy`, `merchants`, `laptop`, `dialogueProfiles`, `narrative` (the caller's content) and `world.map` (without its door table), `world.tiles`, `world.tables`, `world.level`, `world.terrain`, `world.doorCosts` (the loaded world) |
| `Rng`, `PreRandom` | `{"$rng": [s0, s1, s2, s3]}`; `{"$pre": {"index", "refill", "ring"}}` with the refill linked to `rng`; every cosmetic stream is an `Rng` in the state |
| the loaded world | the `TacticalWorld` in section `world`: content parts as externals, `{"$structures": {heights, lists, nextId}}` (`WorldStructures.toSnapshot()`: per-tile lists in order with ids, flags, hit points and cached heights, and the id counter), `{"$costs": …}` (`MovementCosts.toSnapshot()`, the table as written; tests compare it with a recompile of the restored world), the exit grid set; the door table (`t.world.mapDoors`) and the door status are plain maps |
| hooks | not written: `hooks`, `perceptionHooks`, `turnHooks`, `sectorHooks`, `experienceHooks`, `narrative`, `scheduleClock`; `pathEnv` is written as its settings (`showAllMercs`, `autoBandage`, the search counter) and rebuilt by `createPathEnv` |

A function, any class instance without a codec (the oracle's autoresolve `ReplayStream`, a `Date`), a bigint, a
null-prototype object or a key starting with `$` fails with its path (`SnapshotError: a Foo instance cannot be written
at strategic/battle/autoresolve/rng/main`). The snapshot root is `{format: 'ja2-node-snapshot', version: 1, kind:
'campaign' | 'tactical', mapPath, graph: {externals, sections}}`; `migrateSnapshot` checks the format and the version and
runs a migration table that is empty for version 1. Sections: `world`, `lights`, `items`, `soldiers`, `bullets` (with a
loaded sector), `rng`, `strategic` (campaign), `tactical`.

*Restore.* `restoreCampaign(snapshot, {content, world, assemble})`: the caller gives the loaded sector's world (only its
content parts are used; structures, costs and exit grids come from the snapshot), the graph is decoded against the
content index, `TacticalSim.restore` re-installs the sim's hooks around the decoded state, the caller's `assemble` builds
the campaign around the decoded strategic state with `CampaignSim.restore` (`assembleCampaign(..., {construction:
'restore', tactical, worlds})`, `assembleImportedCampaign(..., 'restore')`), and `SectorFlow.reattachLoadedSector()`
re-installs the sector hooks. The init list, edgepoints, schedules and everything else in the state are restored as
written, never recomputed. `reseedMain(state, seed)` restores the main stream in place from a seed (`Rng.restore`), so
the tactical layer and the `PreRandom` refill keep following it while the ring repeats: the player load of §1.5 for S3.

*Server* (`src/server/session-snapshot.ts`, no files and no API yet): `snapshotSession(sim)` returns
`{session: 'campaign' | 'imported' | 'sandbox', preparedMaps, sim}`, where `preparedMaps` are the world cache's prepared
paths in order (a step may load a sector, so the cache is history-dependent); `restoreSession(snapshot, read, exists,
options)` loads the content freshly (`loadCampaignParts`, `loadImportParts`), prepares the same maps, builds the loaded
sector's world (from the cache when it was prepared, otherwise outside it, as a native import does) and calls
`restoreSessionFrom(snapshot, inputs)`, the synchronous part the tests drive. `CampaignSession.origin` records how a
campaign was built and its content; `WorldCache.preparedPaths()` and `fork(paths)` serve the snapshot and the test
harness. The import's assembly moved into `assembleImportedCampaign`, shared by `createSaveSession` and the restore; its
roster combat context uses the off-map context when no sector is loaded instead of the first imported sector's dead
state (the fields that differ are not read off the map: `processUpdateStats` requires `placed`).

*Rows.* Row 4: the pointer graph is re-linked by the codec; `hostileQuoteList`, `aiList` and `intList` stay soldier
references, since they already read `soldiers/<id>` in a snapshot and converting them would touch the turn and AI code
without changing the file. Row 5: `toSnapshot()`/`fromSnapshot()` on `WorldStructures` and `MovementCosts`; exit grids
and the door table are plain state. Row 6: content keys. Row 7: shared maps and sets re-link like any shared object.
Row 10: autoresolve cells keep soldier pointers re-linked by path; only the default streams can be written. Row 13:
content indexes and light templates are derived caches. Group sector defaults were one module constant (`NO_SECTOR`)
shared by many groups, so a restored campaign held copies while new groups held the constant and the aliasing differed
after a reload; each group now gets its own empty sector (no group sector object is mutated in place). Rule: state never
references a module-level constant object.

*Tests.* `src/sim/snapshot/codec.test.ts` (special values, holes, typed arrays, map and set order, aliasing and cycles,
key order, streams, content keys, loud failures, versions, base64); `src/sim/snapshot/session.test.ts` (a turn-based
battle restored with bullets and then a grenade in flight; snapshots between inputs change nothing; the restored world
and the state shared by the two layers are re-linked, `registeredInTactical` holds, the cost table equals a recompile;
reseeding; a function or a class instance put into the campaign state fails with its path); `src/server/session-snapshot.test.ts` (the sandbox, a new campaign from the laptop to the landing, a landed
squad through a sector change, the asynchronous restore with fresh content; on original data the sandbox, a landed new
campaign and every native save import, with and without a world cache, each continued 300 ticks). Reload at every
boundary: `tests/support/reload.ts` (`driven`, `expectReloadsInvisible`, `advance`, `reloadPoint`, `RUN_MODES`),
`tests/support/session-reload.ts` (`drivenSession`, `ReloadingSession`) and `createTestCampaign(kit, {mode})`. A driven
sim is snapshotted and restored into a fresh sim (and snapshotted again to check the round trip) before a command when it
was stepped since the last reload, after every command, and after every `advance` of the support module or of a
`ReloadingSession`; it records the raw JSON of every command result and drained event batch, and
`expectReloadsInvisible(scenario)` runs a scenario plain and reloaded and compares the event log and the final snapshot
byte for byte. The battle, shop, helicopter, meanwhile, creature, schedule, sector, talk, civilian quote, give,
recruit, surrender, boxing, interrogation, endgame and shop-stub scenarios run that way; `JA2_RELOAD=1 pnpm test` reloads every test campaign
and driven session after every input, and the whole suite passes. A test must look state up again after an input
instead of holding objects across it, and `reloadPoint` belongs at input boundaries, not right after a direct flow call
whose events still sit in a flow buffer.

*Measured* (2026-10-18, Node 24 on an 8-core desktop shared with other jobs; gzip is fflate's default level):

| State | Raw | Gzip (time) | Snapshot + stringify | Parse + restore |
|---|---|---|---|---|
| largest stub state: a landed squad or a battle in A9 | 2.3 MiB | 41 KiB (33 ms) | 33 ms | 60–75 ms |
| largest original-data import (`SaveGame10.sav`) | 4.1 MiB | 144 KiB (89 ms) | 81 ms; 171 ms for the first snapshot of a session (content index) | 57 ms; 259 ms with content loading and map preparation |

In the import the strategic section is 1.6 MiB (merchant inventories are most of it), the world 1.2 MiB (the base64 cost
table is 0.55 MiB, the rest the structure lists), the tactical section 0.85 MiB (its typed arrays) and the soldiers
0.3 MiB. A reload in the test harness (snapshot, parse, restore, snapshot again) costs about 0.1 s on stubs.

*Left for S3.* The file (header, gzip, content identity), the input log and replay, the save rules and autosave, the
API and events, player loads through `reseedMain`, the `presentation` block. A snapshot carries neither the server
`Session`'s driver and real-time carry nor the undrained output queue (drained before saving, as §1.3 says).

### 1.5 Random streams on load

The snapshot stores `main`, `pre` and the cosmetic streams exactly. Two load modes:

- **Exact** (`load {reseed: false}`): everything continues bit-identically. Used by tests, replays, bug reports, and by
  agents that want reproducible experiments.
- **Player** (`load {reseed: true}`, the default for the browser and MCP): `pre` is restored exactly, so the next
  `PreRandom` values repeat until they are consumed and refilled (the original's anti-save-scum behaviour,
  `src/sgp/Random.cc:24-28`), and `main` is reseeded from a server entropy seed. This reproduces what a native reload
  does in effect: the original never saves its engine state and continues whatever the running process has
  (`src/sgp/SGP.cc:433`), which is D6's "reseeded on load". The seed is returned in the load result and written to the
  input log as `reseed {seed}`, so even a player load is reproducible from (snapshot, seed, inputs).

### 1.6 Slots, files, quick save, autosave and save modes

- **Where.** `$JA2_SAVE_DIR`, default `.ja2/saves/` in the repository (already gitignored). One file per save plus the
  optional log. Native saves stay where they are (`$JA2_SAVES_DIR`, `docs/14` §10) and are listed read-only.
- **Names** follow Stracciatella's list model (§1.1): `QuickSave`, `Auto01`/`Auto02` (the older or missing one is
  written), player saves named `<UTC timestamp>-<slug of the description>` (`SaveLoadScreen.cc:680-685`), Dead is Dead
  saves under the name chosen at the new game with two backups (`Backup/<name>.j2s.1`, `.2`). Names are validated
  against `SAVE_NAME` (`src/server/session-registry.ts:14`); clients never pass paths (`04` §5.8). No `Error` snapshot:
  when a command throws, the server writes the input log as `Error.log.jsonl.gz` for a replay, since the state after an
  exception is not trustworthy.
- **Rules** (the original's player-facing rules; the reasons are refusal codes of `save`):

| Mode | `save`, quick save | Autosave | Load |
|---|---|---|---|
| save anywhere | allowed unless a conversation is open or the dialogue queue is busy (`conversation`), a meanwhile is starting (`meanwhileStarting`), a decision prompt is open (`promptOpen`: PBI, contract renewal, NPC request, …), or a shop is open (`shopOpen`); the laptop flow is allowed (the original has no save key there but no rule against it, inferred) | `endTurn` accepted in turn-based combat and combat not ending at once (`Tactical/Handle_UI.cc:1066-1084`): `Auto01`/`Auto02`, no message | allowed |
| Iron Man | additionally refused while in combat or while the loaded sector holds enemies (`ironMan`, `GameSettings.cc:233-259`) | same rule, so none in combat | allowed |
| Dead is Dead | only the one named file; explicit saves refused (`deadIsDead`) | at the start of our turn and at `endTurn` (`Tactical/TeamTurns.cc:154`, `:188`), at the start of a meanwhile (`Strategic/Meanwhile.cc:206`), when a group is about to arrive (`Strategic/Map_Screen_Interface.cc:1231`), when the session is closed or the server stops (`src/sgp/SGP.cc:101`), before another save is loaded (`SaveLoadGame.cc:646-654`); written only on our turn with no conversation, meanwhile, prompt or action in progress (`SaveLoadScreen.cc:1374`) | the original does not block quick load (inferred); ja2-node does not either (open question 3) |

  The autosave is a snapshot taken just before `endTurn` is dispatched and written once the command is accepted with
  combat still on, so it holds the state at the original's `UIHandleEndTurn`. A developer-only `POST
  /api/sessions/:id/snapshot` ignores the rules (bug reports, tests).
- **Native saves** are imported with `newSession {save}` (unchanged); the imported session can then be saved in ja2-node
  format ("continue your campaign", `01` §8). There is no export to `.sav`. Imports keep running the original's load
  hooks (`docs/14` §10); ja2-node loads never do.

### 1.7 Server and agent API

| Surface | Addition |
|---|---|
| MCP | `save {session, name?: 'quick' \| string, description?}` → `{name, header}` or `refused: <reason>`; `load {name, session?, reseed?}`: into the given session in place (subscribers get a fresh `welcome`) or into a new one; `listSaves {}` → headers, ja2-node and native, newest first; `deleteSave {name}`; `newSession {load}` as a synonym of `load` without `session` |
| HTTP | `GET /api/saves`; `POST /api/sessions/:id/save`; `POST /api/sessions/:id/load`; `POST /api/sessions {load}`; `DELETE /api/saves/:name`; `GET /api/saves/:name/file` (download); `PUT /api/saves/:name/file` (upload: size cap 32 MB, parse, version, content check, before it is listed) |
| WebSocket | `{t: 'save', id, name?, description?}`, `{t: 'load', id, name, reseed?}` → `result`; after a load every subscriber receives `welcome` with the new view |
| Events | `gameSaved {name, kind}` (not for autosaves, as in the original), `gameLoaded {name, seed}` |

### 1.8 Browser UI (M7)

The launcher's save panel (§8.3): the list newest first with the original's row fields (day and time, sector, mercs,
balance, description, a mark for Dead is Dead), a tooltip with the options and data version, Load (with one warning box
listing version or text differences), Save as new or over a selected save (overwrite confirmation; description up to 46
characters), Delete (confirmation), Download and Upload, and native saves to import. The tactical and strategic pages
get Alt+S (quick save) and Alt+L (quick load) with refusals shown as messages. M8's original save/load screen reuses the
same API.

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

**What each toggle does to the game** (classification by reading every reader):

| Class | Toggles | Notes |
|---|---|---|
| Changes simulation state | `BLOOD_N_GORE` | messy shot deaths over 2 tiles (`Tactical/Soldier_Control.cc:3141-3232`: body and items land elsewhere, a corpse that cannot be decapitated), explosion deaths (`:3265-3283`) with their battle sound draw, the death-animation chain (`Tactical/Soldier_Ani.cc:1645`, `:3196`), corpse vaporizing (camera-dependent, `Tactical/Rotting_Corpses.cc:1028`), blood graphic draws (`TileEngine/Smell.cc:442-463`) |
| Changes only gameplay-generator draws | `MUTE_CONFIRMATIONS` (skips `Random(2)` of the OK battle sound, `Tactical/Soldier_Control.cc:5987-6006`), `ANIMATE_SMOKE` (`Random(5)` start frame, `TileEngine/SmokeEffects.cc:206-233`) | ja2-node already does not draw these (`deviations.md` "Cosmetic draws …") |
| Changes pacing or pauses | `SPEECH` (quote ends with the sample instead of the text timer), `KEY_ADVANCE_SPEECH` (dialogue waits for a key, `Tactical/Faces.cc:1326-1334`), `SLEEPWAKE_NOTIFICATION` (the update box pauses and its dismissal decides compression, `Strategic/Map_Screen_Interface.cc:3215-3565`; sleeping and waking happen regardless, `Strategic/Assignments.cc:5732-5789`), `HIDE_BULLETS` (4 tiles per frame instead of 1, `Tactical/LOS.cc:3155-3166`) | |
| Input, camera, rendering | the other 16: `SUBTITLES`, `DONT_MOVE_MOUSE`, `OLD_SELECTION_METHOD`, `ALWAYS_SHOW_MOVEMENT_PATH`, `SHOW_MISSES`, `RTCONFIRM`, `USE_METRIC_SYSTEM`, `MERC_ALWAYS_LIGHT_UP`, `SMART_CURSOR`, `SNAP_CURSOR_TO_DOOR`, `GLOW_ITEMS`, `TOGGLE_TREE_TOPS`, `TOGGLE_WIREFRAME`, `3D_CURSOR`, `MERC_CASTS_LIGHT`, `TRACKING_MODE` | `MERC_CASTS_LIGHT` does **not** change sight: merc lights are fake lights (`LightSpriteFake`, `Tactical/Soldier_Control.cc:8126`) that `LightTrueLevel` subtracts (`TileEngine/Lighting.cc:527`), and every gameplay light read uses `LightTrueLevel` |

**Engine options and policy.** Stracciatella's `ja2.json`/command line
(`rust/stracciatella/src/config/engine_options.rs:53-111`, `rust/stracciatella/src/config/cli.rs:61-111`): data and save
folders, mods, resolution, `resversion` (§5), fullscreen, `nosound` (forces text-length quote timing,
`src/sgp/SGP.cc:339-341`), debug (cheat levels). The **game policy** files `game.json`, `imp.json` and
`strategic-ai-policy.json` (`src/externalized/policy/DefaultGamePolicy.cc:7-170`) hold gameplay values (starting cash,
interrupt rules, AI switches, hit-chance limits, damage multipliers, progress weights, squad size, I.M.P. points,
`game_durations_multiplier`, …) and UX switches (`extra_hotkeys`, `gui_extras`, `target_fps`, …). Two keys ship with a
JSON value different from the code default: `interrupt_after_being_under_fire` (JSON false, code true) and
`campaign.start_sector_revealed` (JSON true, code false). D1 means the **shipped JSON** values; ja2-node already copies
these files into `data/externalized` unchanged.

### 2.2 ja2-node: three kinds of options

| Kind | Where it lives | Changes the outcome | Examples |
|---|---|---|---|
| **Game options** | session state, chosen at `newSession`, saved, shown in `status` | yes | difficulty, sci-fi, gun nut, save mode, blood and gore |
| **Game policy** | session state: a copy of the policy JSON taken when the campaign starts, saved | yes | `game.json`, `imp.json`, `strategic-ai-policy.json` values |
| **Client settings** | browser `localStorage` per client (the original's per-user `Ja2.set`); never sent to the simulation | no | volumes, speech, subtitles, display toggles, playback speed, language, meanwhile scenes seen |

Server settings (environment, one per process: data and stubs folders, data version, default language, saves folder,
session host, port) are a fourth, operational kind and never enter a session.

**Game options** (`src/sim/options.ts`, replacing the three partial `GameOptions` interfaces in
`src/sim/tactical/state.ts:74`, `src/sim/strategic/state.ts:81` and `src/content/formats/savegame-header.ts:26`):

```ts
interface GameOptions {
  readonly difficulty: 1 | 2 | 3;
  readonly sciFi: boolean;
  readonly gunNut: boolean;
  readonly saveMode: 'anywhere' | 'ironMan' | 'deadIsDead';
  bloodAndGore: boolean;
}
```

- `newSession {campaign: {options}}` takes them; missing fields take the original's defaults (easy, sci-fi, reduced
  guns, save anywhere, blood on), except `difficulty`, whose API default stays 2 as documented (`04` §6.6). The
  launcher's new game form preselects the original's defaults.
- `bloodAndGore` is the only toggle that is both player-changeable at any time in the original and outcome-relevant, so
  it is changed by a command, `setOption {bloodAndGore}`, accepted at any time outside an open prompt, logged like every
  command, and applied from the next tick. Today it is a constant `true` (`src/sim/tactical/state.ts:318`).
- `turnTimeLimit` is not offered (JA2 Gold removed it). A native save that carries it imports with the flag dropped and
  a note in the import report; a deterministic port would need a wall-clock rule outside the simulation (the driver
  issuing `endTurn`), which is not worth it for an unreachable option (deviation entry).
- Native save import maps the header's options (`docs/14` §2) onto this type, `saveMode` included.
- `observe`/`status` show the options; the save header (§1.3) repeats them for the save list.

**Game policy.** At campaign creation the session copies the three policy files into `state.policy` (plain JSON, a few
kilobytes) and every reader takes values from there. A save therefore replays with the policy it was played with even if
`data/externalized` is updated later; the content fingerprint (§1.3) does not need to cover the policy files.

**Pacing options become stop conditions, not state.** `SPEECH`, `KEY_ADVANCE_SPEECH` and `HIDE_BULLETS` are client
presentation (the simulation's timing is fixed: 60 ms per character, one bullet tile per tick). `SLEEPWAKE_NOTIFICATION`
maps onto the client's or agent's choice to stop a strategic `advance` on `fellAsleep`/`wokeUp` events (`advance {until:
{events}}`, `04` §4.2); the browser's real-time driver applies the client setting, an agent passes the events it cares
about. The outcome then depends only on when commands arrive, as for every other stop.

**Client settings** (`src/app/settings.ts`, one JSON object in `localStorage` under `ja2-node:settings`, versioned):
volumes (effects, speech, music, ambient 0–127, default 63; master), speech on, subtitles on (one of the two always on),
key-advance speech (holds the subtitle; the simulation does not wait), mute confirmations, the display toggles of §2.1's
last row (consumed by the canvas UI in M8; stored now so the options screen has a model), playback speed, splash and
intro (§4.3), display language (§5), meanwhile scenes seen (`26` §0), help hidden, cover and LOS display sizes. Export
and import as a file from the launcher. Agents have no client settings.

### 2.3 Deviations to log

- *Key-advance speech*: the original stops the dialogue until a key is pressed; ja2-node's simulation never waits and
  the client only holds the subtitle.
- *Sleep/wake notification*: the update box and its effect on compression become a client stop condition.
- *Timed turns*: not ported (the option is unreachable in JA2 Gold and Stracciatella).
- *Policy snapshot*: policy values are copied into the session at campaign start.

---

## 3. Sound and music

### 3.1 The original's sound system

**Mixer** (`src/sgp/SoundMan.cc`): miniaudio decoding (WAV, plus OGG through stb_vorbis, `:33-46`), 16-bit stereo output
at the device rate (`:85-88`), **16 channels** and a new sound is dropped when all are busy, nothing is stolen (`:82`,
`:243-244`); a 128-entry sample cache with least-hits eviction (`:81`, `:809-831`), files over 1 MB streamed (`:91`).
Volume 0–127 (`src/sgp/SoundMan.h:9`), pan 0 (left) – 127 (right) as a **linear balance**, `vol_l = vol·(127−pan)/127`
(`src/sgp/SoundMan.cc:928-946`). The end callback fires for stopped sounds too (`:571-589`). `loop = 0` plays once in
Stracciatella (`:533-538`; vanilla looped forever, inferred). There is no master volume; three categories exist:
effects, speech and music, each 0–127 with a settings default of 63 (`GameSettings.cc:138-141`).

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
| Animation opcodes 700–798 | fall, footsteps, splats, lock-and-load (weapon's `sLocknLoadSound`), throwing knife, creature steps and attacks, falls to ground (721/722, next to the fragile-item damage the simulation already ports), swooshes, death battle sound (732), stance changes 773–776 (not in stealth), pick-up 777, deep water, cows, crows, mortar, fence | `Tactical/Soldier_Ani.cc:1963-2540`; random idle sounds `:1492-1498` |
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

**Music** (`Utils/Music_Control.cc`, modes in `src/externalized/content/ContentMusic.h:3-17`, tracks in `music.json`,
already in `data/externalized`): `NONE`, `RESTORE`, `MAIN_MENU`, `TACTICAL_NOTHING`, `TACTICAL_ENEMYPRESENT`,
`TACTICAL_BATTLE`, `TACTICAL_VICTORY`, `TACTICAL_DEFEAT`, `LAPTOP` and the three creature variants, which replace
nothing/enemy-present/battle while `gfUseCreatureMusic` is set (`Utils/Music_Control.cc:268-286`, set by
`PrepareCreaturesForBattle`, `Strategic/Creature_Spreading.cc:808-828`). A track is chosen with `Random(count)` from the
gameplay generator (`src/externalized/DefaultContentManager.cc:1097-1105`). No fade-in
(`Utils/Music_Control.cc:314-316`); fade-out one volume step per 10 ms (`:147-178`), five times faster on sector entry
and exit (`Strategic/StrategicMap.cc:529`, `:1842`). When a track ends the next random track of the mode starts; after
the victory track the mode becomes `TACTICAL_NOTHING`; after the defeat track the sector is unloaded and nothing starts
(`Utils/Music_Control.cc:182-210`). Starting a victory track above ground clears `gfUseCreatureMusic` (`:289-295`). The
mode is saved and restored (`SaveLoadGame.cc:1827`, `:1964`). Where modes are set:

| Mode | Set when |
|---|---|
| `NONE` | splash, intro, leaving the game init screen, restart |
| `MAIN_MENU` | main menu, loading a save (until the sector's mode applies), meanwhile scenes |
| `LAPTOP` | entering the laptop; leaving restores the previous mode (`Laptop/Laptop.cc:446`, `:551-561`) |
| `TACTICAL_NOTHING` | sector entry without hostiles, a battle ending without a fight, retreat, boxing exit, creature town attack (`Strategic/StrategicMap.cc:524-531`, `Tactical/Overhead.cc:4636`) |
| `TACTICAL_ENEMYPRESENT` | first enemy seen in an untouched sector, leaving combat with enemies left, the first helicopter drop, the PBI, the end of a meanwhile (`Tactical/Overhead.cc:4080`, `:4124`, `:4369`) |
| `TACTICAL_BATTLE` | entering combat (`Tactical/Overhead.cc:3974-3979`) |
| `TACTICAL_VICTORY` | a won tactical battle unless the last kill was a monster, an autoresolve win, the Queen's death (`Tactical/Overhead.cc:4598-4603`, `Strategic/Auto_Resolve.cc:1298`, `Tactical/End_Game.cc:163`) |
| `TACTICAL_DEFEAT` | a lost tactical battle, autoresolve loss or surrender (`Tactical/Overhead.cc:4478`, `Strategic/Auto_Resolve.cc:1319-1330`) |

The map screen never sets a mode: whatever played continues.

**Speech** (`src/externalized/content/Dialogs.cc:52-109`): mercs `speech/<voice>_<quote>.wav`, NPCs and unhired R.P.C.s
`npc_speech/<id>_<quote>.wav`, alternate dialogue `npc_speech/d_…`, Russian R.P.C.s `speech/r_…` (§5.1). Played at
speech volume with a lip-sync list from the matching `.gap` file (`{start, end}` ms pairs, `Tactical/Gap.cc:13-120`);
the mouth frame is `Random(6)` every 120 ms (`Tactical/Faces.cc:1057-1067`).

**Where the original's gameplay depends on sound** (all already replaced in ja2-node by simulation-side rules):

| Original coupling | ja2-node today |
|---|---|
| A quote ends when its sample stops (`Tactical/Faces.cc:627-629`), plus 300 ms | 60 ms per character always (`deviations.md` "Speech") |
| A quote waits for the speaker's battle sound (`Tactical/Dialogue_Control.cc:632-637`); critical battle sounds cut speech (`Tactical/Soldier_Control.cc:5973-5980`) | never waits, never cut ("Speech") |
| The defeat track's end unloads the sector (`Utils/Music_Control.cc:188-193`), in parallel with a 10 s timer (`Tactical/Overhead.cc:4378-4381`) | the 10 s timer only (`src/sim/campaign/battle-flow.ts:319-323`) |
| Skyrider's destruction runs in a sound's end callback (`Strategic/Map_Screen_Helicopter.cc:1041-1044`) | at once ("Helicopter destruction") |
| `EVENT_AMBIENT` events carry sound-cache slots in the saved queue (`Strategic/Game_Event_Hook.cc:101`) | not queued ("Ambient sound events") |
| Sound picks draw on the gameplay generator: `SoundRange`, footstep variants, battle-sound variants, explosion sounds, door sounds, the music track, ambient timing, mouth frames, cows, crows, bloodcat growls | not drawn, or drawn from the cosmetic stream (rows "Cosmetic draws …" in `deviations.md`); the footstep and music picks are not listed there yet (§3.5) |
| The first helicopter drop waits for the engine sound to fade before unlocking and calling in enemies (`Tactical/Merc_Entering.cc:529-562`) | to check in slice S8 (inferred: the drop runs on simulation ticks with no fade wait) |

### 3.2 The data

Checked on the user's data (formats only; nothing copied): `Sounds.slf` 370 WAV (PCM, mono and a few stereo, 8 and 16
bit, 11.025/22.05/44.1 kHz, up to 17 s); `BattleSNDS.slf` 1,581 WAV, almost all **IMA ADPCM** (format tag 0x11, 4-bit,
22.05 kHz mono); `Speech.slf` 5,774 and `Npc_speech.slf` 2,794 WAV, all IMA ADPCM, with a `.gap` file beside almost
every one; `Music.slf` 14 WAV, PCM 16-bit stereo 22.05 kHz, up to about two minutes; `Ambient.slf` 9 WAV and one `.bad`
table; `Laptop.slf` holds the laptop sounds; two loose `stsounds/*.wav`. Speech and music are about 500 MB together:
they are fetched lazily per file through `/vfs` (range reads), never bundled. Browsers decode PCM WAV natively but IMA
ADPCM WAV is not reliably supported by `decodeAudioData` (inferred from the Chrome and Firefox codec lists), so ja2-node
decodes WAV itself.

### 3.3 ja2-node design

**Presentation only.** Nothing in `sim` reads, waits for or draws on behalf of sound (D2, D13, D14). The client derives
every sound from what it already receives: view frames, the event log (`04` §4.4) and the animation timelines it plays
(`01` §3.4). Headless sessions and agents never produce audio; the outcome is identical with sound on, off or absent.

**Layers and modules:**

| Module | Layer | Content |
|---|---|---|
| `src/content/formats/wav.ts` | content | RIFF/WAVE reader: PCM 8/16-bit and IMA ADPCM (0x11) to `Float32Array` per channel; rejects other tags with a clear error |
| `src/content/formats/gap.ts`, `ambient.ts` | content | `.gap` pairs; `.bad` ambient tables (count + 116-byte entries) |
| `data/tables/sound-effects.json`, `battle-sounds.json` | data | transcribed by `tools/transcribe/sound-effects.ts` from `Utils/Sound_Control.cc:17-328` (ids → paths) and `Tactical/Soldier_Control.cc:138-157` (battle sound table): paths and numbers only |
| `src/content/audio/cues.ts` | content | DOM-free cue resolution: event or opcode + context → `{file, baseVolume, positional, loops, bus}`; the rules of §3.1 (footstep terrain, burst file name, door kind, battle-sound fallbacks, Russian speech prefix) as pure functions with unit tests |
| `src/audio/engine.ts` | browser (new layer `audio`, allowed imports: `content`, `protocol`) | Web Audio graph: buses effects, speech, music, ambient into a master gain; 16-voice cap with drop-when-full; linear balance panning with two gains (not `StereoPannerNode`, whose equal-power law differs); an LRU of decoded buffers (128 entries, like the original's cache); unlock on the first gesture; sample rate from the device |
| `src/audio/positional.ts` | browser | `SoundVolume`/`SoundDir` against the client camera; positional loops for the creature queen |
| `src/audio/director.ts` | browser | subscribes to the session client: events and frames → cues; animation opcodes 700–798 from the timeline player's `onOp` hook (`src/content/anim/script.ts` already classifies 700–799 as opcodes); ambient scheduling from the tileset's ambient table and the world clock |
| `src/audio/music.ts` | browser | music player: track choice, fades, end handling, from the music mode of the view |

**Cosmetic choices** (variants, ambient gaps, footstep alternation, music tracks, mouth frames) use a client-side PRNG
seeded per session view, never a simulation stream. The client keeps its own presentation memory per soldier (last
footstep variant, last battle sound time for the 2 s filter).

**The music mode is player-visible state, so the server computes it.** A pure `musicMode(prev, events, view)` in
`src/protocol/music.ts` reproduces the setters of §3.1 from simulation events (`sectorLoaded`, `enemySighted` in an
untouched sector, `combatStarted`, `combatEnded {won|lost|lull}`, `preBattle`, `arBattleOver`, laptop open/close, the
meanwhile and endgame events) and the creature flag. The session keeps `presentation.music {mode, previous}` beside the
simulation (saved in snapshots, §1.3, never read by `sim`) and sends `music {mode, creature}` in view frames when it
changes; the client only chooses tracks and fades. `useCreatureMusic` is already simulation state
(`src/sim/strategic/creatures/creatures.ts:45`); the clear at the start of an above-ground victory track
(`Utils/Music_Control.cc:289-295`) moves into the simulation at the same moment (the won-battle aftermath) so native
saves and ours carry the same flag.

**Event coverage.** Most cues are derivable from today's events and frames; slice S8 adds the presentation fields the
client cannot infer, each optional and outside state: `shotFired {item, silenced, rounds}` (weapon, silencer, burst size
for the file name), `bulletStopped {material}` (structure hit sound), `explosion {animation}` (candidate list),
`doorChanged {kind, noisy}` and the lock outcome events of `docs/25` §8, `reloaded {soldier, item}`, `itemAttached`,
`vehicleMoved`; soldier entries in the view gain `voice` (profile voice id or the generic battle-sound set) and `body`.
Terrain under a soldier comes from the client's own world model.

**Speech.** On a quote event (`mercQuote`, `npcQuote`, conversation lines, `civQuote`) the director resolves the file by
the `src/externalized/content/Dialogs.cc` rules and plays it on the speech bus; it is not cut when the simulation's line
ends earlier (the original plays the whole sample). Subtitles are a client setting; text comes from the event's resolved
text or `/api/text`. Lip-sync needs faces and waits for M8 (the `.gap` decoder lands in M7 for tests).

**Volumes and options** are client settings (§2.2): effects, speech, music and ambient 0–127 (default 63) plus a master
gain (ja2-node addition), mute confirmations, speech and subtitles (at least one on, `GameSettings.cc:77-81`).

### 3.4 Stubs

Stub sounds, music and speech blips are synthesized originals named like the original paths (§6.3 P0), so the cue
tables and `music.json` resolve unchanged. Missing files are skipped silently, as the original skips failed plays.

### 3.5 Deviations to log

- *Music track choice*: `Random(count)` on the gameplay generator → client PRNG (presentation).
- *Footstep variants*: the `Random` loop and `ubLastFootPrintSound` (`Tactical/Soldier_Control.cc:8853-8859`) → client
  presentation memory, no simulation draw (to confirm against the movement code in S8: if the draw is ported today, it
  stays).
- *Speech playback*: a speech sample is never cut by a simulation-side line end.
- *Ambient timing*: real-time gaps → playback-time gaps on the client.
- *Volume scaling*: `PlaySoldierJA2Sample`'s double scaling is kept (a faithful quirk, inferred to be audible only as
  quieter soldier sounds), unless the maintainer prefers to fix it (open question 4).

---

## 4. Video

### 4.1 The original

**The videos** are Smacker files named in `Intro.cc:34-78` (`INTRODIR` = `intro`, `Directories.h:14`): four for the
beginning (`rebel_cr`, `omerta`, `prague_cr`, `prague`), five for the ending (`throne_mig` or `throne_nomig`,
`heli_flyby`, `heli_sky` or `heli_nosky`), the splash (`splashscreen`) and a TalonSoft logo that is never played
(`Intro.cc:322`, commented out). SMK is used by `Intro.cc` only: the A.I.M. video conference is the animated face system
with STI static (`Laptop/AIMMembers.cc:1619-1627`, `:1866-1899`), the helicopter drop of a new game is a tactical
animation (`Tactical/Merc_Entering.cc:686-700`), and meanwhile scenes are tactical scenes (`26` §1.6).

**Sequences** (`GetNextIntroVideo`, `Intro.cc:252-329`; the mode enum `Intro.h:12-18`):

| Sequence | Videos | Started by | Followed by |
|---|---|---|---|
| `INTRO_SPLASH` | the splash | process start, English and Chinese versions only (`src/sgp/SGP.cc:441-444`); other versions blit an MLG splash picture (`JA2_Splash.cc:17-25`) | the Sir-Tech logo picture (`Intro.cc:364-370`), then the main menu after 500 ms (`JAScreens.h:8`) |
| `INTRO_BEGINING` | the four beginning videos in order (`Intro.cc:262-278`) | every new game, after the game init options screen (`GameInitOptionsScreen.cc:725-730`); in Dead is Dead mode after the save screen (`:722-723`, `SaveLoadScreen.cc:1476-1494`) | `INIT_SCREEN` → `InitNewGame` → the laptop (`Intro.cc:229`, `JAScreens.cc:181-185`) |
| `INTRO_ENDING` | Miguel's throne video by `gMercProfiles[MIGUEL].bMercStatus == MERC_IS_DEAD`, the fly-by, Skyrider's helicopter video by the same test on SKYRIDER (`Intro.cc:289-311`) | `DoneFadeOutEndCinematic` (`Tactical/End_Game.cc:351-366`, `26` §6.7) | `ReStartingGame()` and the credits (`Intro.cc:239-245`), then the main menu (`Credits.cc:169-186`) |

There is no setting that turns the intro off; the beginning sequence plays on every new game and can only be skipped.
Skipping (`Intro.cc:199-217`, on key up): Escape ends the sequence, Space or any mouse button ends the current video.
While a sequence plays the screen is black, the cursor hidden and the music off (`Intro.cc:126-134`).

**Playback** (`Utils/Cinematics.cc`, the only caller is `Intro.cc`): the file is read whole and decoded by libsmacker
(`:200-209`); all audio tracks are decoded up front into buffers and started together with the video (`:122-178`);
frames are paced by the wall clock and late frames are decoded but not shown (`:259-271`); each frame is an 8-bit image
with a 256-colour palette converted to 16-bit and blitted 1:1 at the centre of the screen, without scaling (`:282-316`,
`UILayout.cc:13-14`). A missing or broken file is logged and skipped, so a sequence with no files exits at once
(`Utils/Cinematics.cc:193-219`, `Intro.cc:339-342`).

**Credits** (`Credits.cc`): `interface/credits.sti` with blinking faces, the text from `binarydata/credits.edt` (496
rows of 80 characters, `src/externalized/strings/EDT.h:61-65`) with inline `@` control codes for gaps, speed,
justification and colours (`Credits.cc:44-58`, `:460-502`), scrolled 1 px every 25 ms (`:71-76`); 15 hoverable faces
with names from the compiled strings (`:108-127`, `Utils/Text.h:212-214`). The main menu reaches the credits too
(`MainMenuScreen.cc:217-220`).

### 4.2 The data

Checked on the user's Steam 1.12 data (formats only): the eleven videos sit in an archive named `Intro-old.slf` whose
library path is `intro\`; the Steam package appears to rename it so that its own executable skips the intro (inferred).
Stracciatella mounts every SLF it finds (`rust/stracciatella/src/vfs/mod.rs:129-150`, library path from the header,
`rust/stracciatella/src/vfs/slf.rs:62`), and so does ja2-node (`src/node/data-vfs.ts`), so the files resolve as
`intro/<name>.smk` either way. All are version-2 Smacker (`SMK2`), 640×480, 15 frames per second (the splash 30), with
one audio track: compressed, 16-bit stereo, 44.1 kHz. Sizes range from about 0.6 to 30 MB.

### 4.3 ja2-node design

- **Presentation only.** No video ever blocks the simulation or the server. The beginning intro plays in the browser
  while the new campaign session already exists and waits in its laptop flow (which needs no input until the player
  acts); the ending plays after `campaignWon` from `observe.ended.ending {miguelAlive, skyriderAlive}` (`26` §7), which
  carries exactly the two choices of `GetNextIntroVideo`. Agents never see videos.
- **Decoder** `src/content/formats/smk.ts`: DOM-free and Node-free like every decoder (D8), written from the public
  format description of Smacker (header, Huffman trees, palette chunks, 4×4 block types, DPCM audio). libsmacker, which
  Stracciatella bundles (`dependencies/lib-smacker/LICENSE.txt`, LGPL 2.1), is neither copied nor ported (`01` §5.3).
  The decoder exposes `openSmk(bytes) → {width, height, frameCount, microsPerFrame, audioTracks}`, `decodeAudio(track) →
  Int16Array per channel` and an iterator `nextFrame() → {indices: Uint8Array, palette: Uint8Array(768), changed}`. Ring
  frames and the Y-doubling flags are rejected with a clear error (none of the original files use them).
- **Player** `src/app/video/` (browser): fetches `/vfs/intro/<name>.smk` whole, decodes in a Worker, uploads indices
  into an R8 texture and the palette into the palette texture of `render` (the same shader path as sprites, D9), scales
  640×480 by an integer factor into the canvas, decodes the audio track up front (like `Utils/Cinematics.cc:122-150`)
  into an `AudioBuffer` on the music bus, and paces frames by `AudioContext.currentTime`, dropping late frames as the
  original does. Keys and clicks as in the original (Escape ends the sequence, Space or a click ends the video).
- **Sequences** are a small client table (`src/app/video/sequences.ts`) mirroring §4.1. A missing file is skipped. The
  splash plays when the launcher starts, unless the client setting `playSplash` is off (§2.2); the beginning intro plays
  when the player starts a campaign from the launcher, unless `playIntro` is off (a deviation: the original has no such
  switch, but a browser player re-entering often should not be forced through it; skippable either way).
- **Credits** are a client screen fed by `GET /api/text?file=binarydata/credits.edt` rows; the control-code parser lives
  in `src/content/formats/credits.ts` (DOM-free, unit-tested on a stub EDT). In M7 they are a DOM scroller in the
  launcher; the faces and the original layout come with the canvas UI (§8).
- **No transcoding.** Nothing is converted to WebM or MP4, neither into the repo nor into a server cache: the browser
  decodes the user's own files. A server-side transcoder would add a native dependency for 70 MB of video that a
  client decoder handles in real time.

### 4.4 Stubs

The stub pack has no video today. It gets one tiny Smacker file per sequence slot that matters for tests
(`intro/splashscreen.smk` is enough), written by a minimal encoder in `stubs/` that emits only what the decoder must
read anyway: a full palette, solid and void blocks, and an uncompressed or DPCM audio track of a generated tone. The
picture is an original title card ("ja2-node" on a plain background). The other names stay missing and are skipped,
which also exercises the missing-file path. If the encoder costs more than it is worth, the fallback is a fixture-only
file generated in the decoder's tests and no stub video at all (open question 9).

---

## 5. Localization

### 5.1 The original: two sources of text and one version switch

**The version switch.** Stracciatella knows nine data versions
(`rust/stracciatella/src/config/vanilla_version.rs:11-30`: Dutch, English, French, German, Italian, Polish, Russian (the
Buka release), Russian Gold, Simplified Chinese), chosen by `--resversion` or `ja2.json` `resversion`
(`rust/stracciatella/src/config/cli.rs:93-94`, `rust/stracciatella/src/config/ja2_json.rs:42`), default English
(`rust/stracciatella/src/config/engine_options.rs:69`). The launcher can guess it from `russian/`, `german/`, `dutch/`,
`italian/` or `polish/` files inside the SLFs and from file hashes (`rust/stracciatella/src/guess.rs:128-237`); Russian
Gold cannot be guessed (no resource pack, inferred). The version is one switch for *everything language-related*:

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

**Compiled UI strings are JSON now.** The string tables that used to be compiled in are `L10n_t`
(`src/externalized/strings/Localization.h:200-425`, fixed array sizes at `:20-196`), loaded from
`translation-<suffix>.json` with a length check per array (`src/externalized/strings/Localization.cc:37-280`): 217 keys,
1,901 strings per language; `translation-rus.json` and `translation-rusgold.json` differ in five (the copyright line and
four mail sender names), and only the latter is read (no other caller passes `false` to `GetSuffix`, inferred). ja2-node
already ships them: `data/externalized/strings/` holds `translation-*` in eight languages plus `rusgold`, the other
per-language files, and `translation_tables/` (five tables). Since S6 `src/content/text/strings.ts` reads them (§5.5).

**Data text is EDT, per installed version.** Dialogue (`mercedt/NNN.edt`, `npcdata/NNN.edt`, `d_NNN.edt`), civilian
quotes, item names and descriptions (`binarydata/itemdesc.edt`, `braydesc.edt`), A.I.M. and M.E.R.C. bios, mails, files,
history and quest lines, I.M.P. text, help, credits, insurance and florist text: fixed-width UTF-16 records
(`src/externalized/strings/EDT.h:60-110`, `src/externalized/ItemModel.cc:11-20`, `Laptop/EMail.cc:34`,
`Tactical/Civ_Quotes.cc:36`) decoded by `LoadEncryptedData` (`src/externalized/strings/EncryptedString.cc`): ROT-1
(`:17`), then per mode. Russian maps 0xC0–0xFF to U+0410–U+044F (`:24`: the text was CP1251 read as CP1252); Ё, № and
the guillemets are not fixed (so they cannot render, inferred). Merc names in `prof.dat` get the same fix
(`src/sgp/LoadSaveData.cc:77-90`). Record sizes are the same in every language. Item and merc names are never in JSON
(`items.json` has none; `src/externalized/mercs/MercProfile.cc:151-152` allows overrides only). ja2-node's
`src/content/formats/edt.ts` implements the English, Russian and Polish modes; since S6 every decode uses the data
version's mode (§5.5).

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
(`rust/stracciatella/src/vfs/mod.rs:200-345`).

### 5.2 ja2-node design: data version and display language are separate

- **Data version** (`dataVersion`): a property of the content, detected once at server start the way Stracciatella's
  guesser does (language folders in the SLFs; English otherwise), overridable by `JA2_DATA_VERSION=english|russian|
  russianGold|german|…` (Russian Gold must be named). Stubs have their own version `stubs` (text in English, encoding
  English). It selects the EDT decoding mode, the NPC record layout, the map extra bytes, the MLG picture paths, the
  speech prefix for R.P.C.s, the glyph table for the data's fonts, and the English/Chinese battle-sound branch. It is
  part of the content fingerprint (§1.3), because some of these reach the simulation (§5.3).
- **Display language** (`language`): which `translation-<suffix>.json` and per-language JSON tables label the UI, and
  which language the server uses when it resolves UI keys for observations. Default: the data version's language (either
  Russian version → the Russian tables exactly as Stracciatella picks them, `english` → `eng`, stubs → `eng`). It is a
  server setting (`JA2_LANG`) and a per-client setting; changing it never touches a session. Choosing Russian with
  English data gives Russian UI labels and English data text (dialogue, item names, mails): a ja2-node convenience that
  the original cannot do; with Russian data both are Russian.
- **`TextService`** (`src/server/text-service.ts`, Node layer) owns both sources: EDT rows through the VFS with the data
  version's decoding (today in `src/server/narrative-content.ts` and `/api/text`), and the UI string tables of a
  language (`src/content/text/strings.ts` loads `L10n`-shaped JSON, DOM-free, with the same per-array length check as
  `src/externalized/strings/Localization.cc:37-53`). Text never enters simulation state, saves or logs (`24` §11.5).
- **Protocol rule.** Views and events carry machine tokens (`moraleText: 'good'`, `reason: 'outOfAPs'`) and text keys
  (`{file, row, width}` for EDT, `{table, index}` for UI strings); the client looks labels up in the string tables it
  loaded. MCP observations stay English-keyed JSON, plus resolved `text` in the session's display language where text is
  the content (dialogue, mails, item names). A table `src/server/text-keys.ts` maps each machine token to its
  `L10n` array and index (for example the morale tokens to the morale strings), so every surface labels the same way.
- **HTTP.** `GET /api/strings?lang=rus` returns the merged UI tables for the launcher and the pages (ETag, cacheable).
  `GET /api/text` widens its whitelist from `npcdata|mercedt` to every EDT file the content uses, each with its record
  layout from `src/externalized/strings/EDT.h` (so `width` is no longer a client guess), and takes `lang` only for UI
  keys (EDT text always comes in the data version's language).
- **Fonts.** The DOM launcher and the devtools pages use system fonts, so Cyrillic works with any data. The canvas UI of
  M8 draws with the data's bitmap fonts through the data version's glyph table; with English data and a Cyrillic display
  language it falls back to the stub font (§6.3), which must therefore carry Cyrillic (open question 6).

### 5.3 What the language may and may not change in the simulation

The display language never reaches the simulation. The data version does, in exactly these places, all faithful to the
original version the user owns:

1. **Quote durations**: 60 ms per character of the decoded EDT line (`deviations.md` "Speech"; `24` §11.5); a Russian
   line has a different length than the English one, so the speech channel frees at another tick.
2. **NPC record layout** (Russian Buka): the same records, read from a different byte layout
   (`src/content/formats/npc.ts` already has `'russian'`).
3. **The battle-sound branch** of `Tactical/OppList.cc:2388-2402`: one extra `Random(100)` in English and Chinese, if
   and when the "see enemy" quote is ported (it is not today: no caller in `src/sim`).
4. **Map bytes** (Russian Buka): skipped by the reader, no effect on the map model.

Hence a save records `dataVersion` and a hash of the quote lengths it ran with (§1.3); loading with another data version
is allowed with a warning that a replay may differ, like Stracciatella's version warning (`SaveLoadScreen.cc:707-731`).

### 5.4 Russian specifically

- **With Russian data** (Buka or Gold): detection or `JA2_DATA_VERSION`, the Russian EDT mode, the Buka NPC layout,
  `speech/r_` for R.P.C.s, the Buka MLG pictures, the Russian strings (`translation-rusgold.json` plus the `-rus` files)
  and the `rus` or `rus-gold` glyph table. The oracle has never run on Russian data; the probes that read text lengths
  should be rerun once if the maintainer obtains a Russian copy.
- **With English data**: UI strings from `translation-rusgold.json` and the `-rus` files, as Stracciatella would pick
  them (open question 7), data text stays English, the DOM surfaces render Cyrillic with system fonts.
- **Kept as in the original**: Ё and the other unmapped CP1251 characters stay unmapped; money and numbers keep `$`, `,`
  and `.`; no layout changes. Stracciatella's tooltip table exists only in English (`tooltips-eng.json`), and its
  `informative_tooltips` option is off by default (`assets/externalized/game.json:144`), so tooltips are out of scope.
- **Repository rule**: the Russian JSON strings are Stracciatella's externalized tables (SFI-SCLA, copied unchanged like
  the rest of `data/externalized`); nothing from the user's EDT files, fonts or speech is committed, and tests assert
  keys, counts and lengths, never original text (`24` §11.5).

### 5.5 What landed (slice S6, 2026-10-18)

- **Data version**: `src/content/text/data-version.ts` (versions, `dataDecoding`, `stringSuffix` = `GetSuffix`, the glyph
  table name, the R.P.C. speech prefix, `guessVanillaVersion` = the language-folder half of `guess.rs`; the resource-pack
  hash matching is not ported, English is the fallback) and `src/server/data-version.ts` (detection at start,
  `JA2_DATA_VERSION`, `JA2_LANG`). The decoding is threaded through content loading as an optional `DataDecoding`
  argument (default English): `loadTacticalContent` (the prof.dat name fix), `narrativeContent` (EDT mode, NPC record
  layout), `createCampaignSession`, `createSaveSession` (also the NPC layout of native saves), `createSandboxSession`.
  The map reader needs nothing: like `WorldDef.cc` it skips the 148 bytes by the map file's own version 6.00/26, so
  `getMajorMapVersion` only matters for writing maps.
- **Speech paths**: `src/content/narrative/speech-path.ts` (`Dialogs.cc` `GetDialogueVoiceFilename`), unused until S8.
- **String tables**: `data/tables/l10n.json` (`tools/transcribe/l10n.ts`), `src/content/text/strings.ts`; all nine
  translation files pass the length check.
- **EDT layouts**: `data/tables/edt-layouts.json` (`tools/transcribe/edt-layouts.ts`): 20 fixed files and 5 name patterns
  (dialogue, alternate dialogue, merc dialogue, civilian quotes, sector hints). On the English Gold data every fixed file
  holds whole records; the row counts in the `EDT.h` comments are twice the real ones for all files but `help.edt`, so
  they are not transcribed.
- **Server**: `src/server/text-service.ts`, `src/server/text-keys.ts`, `GET /api/strings`, the widened `GET /api/text`,
  `newSession {language}`, `language`/`dataVersion` in `status` and `observe`, labels in `observe` (`04` §6.21). The
  English/Chinese battle-sound branch and the MLG picture paths wait for the slices that port them (S8, M8).

---

## 6. Stub completeness

### 6.1 What the stub pack has (2026-10-16)

`pnpm stubs` (`stubs/build.ts`) writes about 170 files to `dist/stubs`, mounted under the `stubs/` VFS prefix with
per-path fallbacks (`src/node/data-vfs.ts`, `readLayered`):

| Area | Stub pack | Original (for scale) |
|---|---|---|
| Sector maps | 8 maps: A9, A10, A10 b1, N7, P3, P3 b1, a village and a wilderness map; every other sector loads the wilderness map (`src/content/strategic/sector-maps.ts`) | 256 surface sectors, 36 underground levels, alternate maps |
| Tileset | one tileset, 9 of 151 tile types filled (3 grounds, water, floor, wall, roof, barrel, door) | every tileset of `ja2set.dat`, all types |
| Soldiers | 5 sheets (stand, walk, run, crouch, prone) × 8 directions for all 396 surfaces; an invented script for each of the 311 animation states; palettes | 396 surfaces per body |
| Structures | wall, barrel, door; 15 person and 83 corpse structure files | 1,442 JSD |
| Profiles | 18: A.I.M. 6 (ids 0–5), M.E.R.C. 1, R.P.C. 2, NPC 9, vehicles 0 | 159 slots: 40, 11, 18, 85, 4 |
| NPC scripts | 5 NPCs plus `000.npc` and two meanwhile sets; 7 NPC and 6 civilian EDTs | about 103 scripts, civilian and sector quote files, `miners.npc`, `d_NNN.edt` |
| Merc text | none (`mercedt/` is absent; `/api/text` answers 404 for it) | 1 EDT per merc |
| Other text | none (no item names and descriptions, mails, history, files, bios, credits) | `binarydata/*.edt` |
| Locks | 2 | `locks.bin` |
| Media beyond the world | none: no sounds, music, speech, video, fonts, faces, item graphics, interface, laptop or map-screen art, radar maps, load screens, cursors | 22 SLFs |

Items, weapons, dealers, the army and strategic tables come from `data/externalized` for every data version, so they
need no stubs. One defect surfaced during this inventory: `dialogueProfiles()`
(`src/content/strategic/laptop-content.ts:357`) probes `npcdata/` and `mercedt/` without the `stubs/` fallback, so on
stubs every R.P.C. and NPC is marked as having no text file (to confirm and fix in slice S1).

### 6.2 What "a full game on stubs" means

The done criterion of every milestone is "also runs on stubs, CI only on stubs" (`01` §4.4). For M7 this becomes: **a
stub campaign can be played from the new game to the Queen's death through MCP and through the browser pages, with
sound, music, a splash video, saves, and text in both English and Russian UI**, and every M7 feature has stub content
that exercises it. It does **not** mean a stub replica of every sector or quest: the narrative content on stubs stays
the minimum that the tests and the stub campaign path need (`01` §11, "logic stubs are game design").

### 6.3 Missing pieces, by priority

**P0, needed by M7 features** (each is original work, generated by a script in `stubs/`, deterministic, PNG/WAV/JSON):

1. **Sounds** (`stubs/audio.ts`): one short synthesized WAV per cue class of §3.3 (footsteps by terrain class, gun
   classes and their silenced and burst variants, reload, punch and knife, hits, falls, explosions, doors open, close
   and locked, item pick-up and drop, UI clicks, the laptop beep), generated from noise and tone envelopes. The file
   names follow the original's paths (`sounds/…`, `battlesnds/…`) so the same cue table resolves on both; formats PCM 8
   and 16 bit and one IMA ADPCM file so the decoder paths are covered. Battle sounds: one generic set per body class
   instead of per profile.
2. **Music** (`stubs/music.ts`): one generated loop per mode of `music.json` (10 modes, a few seconds each, simple
   chiptune-like tones), named as in `music.json` so the table works unchanged.
3. **Speech**: one "blip" WAV per stub profile and quote family, plus a matching `.gap` file, so the speech and lip
   paths run; durations unrelated to text (the simulation never reads them).
4. **Merc and item text**: `mercedt/NNN.edt` for the six stub A.I.M. profiles and the R.P.C.s (invented lines), and a
   stub `binarydata/itemdesc.edt` covering the items the stub campaign and tests use, so text keys, lengths and
   `/api/text` work and quote durations are non-zero; a stub `credits.edt` with the control codes of §4.1; stub
   `email.edt` rows for the mails a stub new game sends.
5. **Video**: the splash Smacker file of §4.4.

**P1, needed for the stub campaign path and wider test coverage:**

6. **Sector kinds**: a table `stubs/maps/sector-kinds.json` mapping each sector to a generic stub map by kind (town,
   mine with its underground levels, SAM site, airport, prison, palace, lair, wilderness), each with the placements,
   exits, facilities and edgepoints the strategic layer expects, so towns train militia, mines produce, SAM sites can be
   taken and Skyrider's base works without a hand-made map per sector.
7. **Profiles**: at least 12 A.I.M. profiles (a full squad plus refusals and relationships), the four vehicle profiles
   (the helicopter and ground vehicles read them), and the NPCs the stub campaign path meets (Skyrider and one dealer
   per stub town).
8. **Tile types**: windows, fences, sandbags, slanted and high roofs, cliffs, debris and item tiles in the stub tileset,
   so combat tests cover cover, fence hops, window shots and climbing on stubs.
9. **Font**: a rasterized free pixel font with Latin and Cyrillic (OFL or CC0; candidates to check: Terminus, unscii)
   compiled into the stub `fonts/*.sti` names with a stub glyph table, needed by M8's canvas UI and by the Cyrillic
   fallback of §5.2. M7 only builds the font files and tests that they decode.

**P2, for M8**: faces and portraits, item graphics (`interface/mdp*items.sti`, `bigitems/`), interface panels, laptop
and map-screen art, radar maps, load screens, cursors, MLG pictures. They follow the M8 screens one by one and are
labelled rectangles or simple shapes in the original layouts (`01` §4.4).

### 6.4 Rules

- Nothing is traced, sampled or derived from the original data: sounds are synthesized, text is written fresh, maps
  are drawn in the ASCII format (`01` §4.4); names follow the original paths only so that one content table serves both.
- The stub build stays deterministic (same bytes every build); generators take no time or randomness from the system.
- Every new stub family gets a decoder round-trip test in `stubs/build.test.ts`.

---

## 7. Performance

### 7.1 What is known

- **Enemy turns** (M3, `04` §4.5): on A9 with the instant driver, 1–90 ms for 4 soldiers and 2 civilians, typically
  100–250 ms (up to 370 ms) for 16 soldiers; AI decisions (cover search, paths, sight) dominate, ticks without decisions
  are almost free. Nothing larger was measured: no 32-soldier battle, no real-time tick cost with many soldiers, no
  strategic compression over weeks, no save size.
- **Plans on record**: a visibility cache and moving the simulation to a worker (`01` §11), sessions in
  `worker_threads` when instant runs start delaying network I/O (`04` §5.9), 60 FPS at 1920×1080 for the tactical view
  (`01` §5.1).
- **Constraints**: the simulation layers may not read clocks (`01` §3.2), so all timing is taken outside `sim`; the
  original data may not be committed, so baselines measured on it stay local.

### 7.2 Measure first: the benchmark suite

`pnpm cli bench <scenario> [--data DIR] [--seed N] [--runs N] [--profile]` (`tools/bench/`). Every scenario is a fixed
seed plus a scripted command list, so a rerun does exactly the same work; only machine noise varies. No scenario needs
the native oracle. Each prints a JSON line (`scenario`, `source`, `seed`, `runs`, percentiles, counters) and, with
`--profile`, writes a `.cpuprofile` under `.cache/bench/` (gitignored) for Chrome DevTools.

| Scenario | What it does | Measures |
|---|---|---|
| `enemy-turn` | turn-based battle, instant driver, `endTurn` then `advance idle`, repeated until one side is gone; stubs: a generated arena map with 8, 16 and 32 enemies against six mercs; original: A9 (as in M3) and a large battle from a native save (D13 airport, `docs/14` §10) | ms per enemy turn (p50, p95, max), ticks per turn, AI decisions per turn, counters (paths, LOS rays, cover evaluations) |
| `realtime` | real-time tactical with 20, 40 and 64 soldiers on green and yellow alert (patrols, civilians with schedules), manual driver in 1,000-tick steps | µs per tick (mean, p99), ticks per second of CPU |
| `strategic` | a new campaign landed and cleared, then map-screen compression for 7 and 30 world days with no sector loaded; once more with the Queen's attacks enabled | ms per world day; events, group arrivals, autoresolve battles and Queen decisions per day |
| `autoresolve` | battles of 10, 20 and 40 per side | ms per battle |
| `save` | snapshot and restore (§1.3) of the largest states the other scenarios produce (loaded sector with 64 soldiers, 30 sector diffs) | bytes raw and gzipped, ms to serialize, gzip, parse and rebuild |
| `server` | 1, 4 and 16 sessions: real-time view frames over WebSocket and concurrent instant runs | frame diff ms, bytes per second, event-loop delay p99 (`perf_hooks.monitorEventLoopDelay`) |
| `campaign` | a scripted stub campaign from the new game to the Queen's death (the e2e scenario of §12.2 without a browser) | total ms, peak RSS |

Counters are plain integers in a `PerfCounters` object the bench passes through the simulation's dependency context
(the same way roll sources are passed); they never enter simulation state and cost one increment each. The client side is
measured with Playwright on the stub arena (`performance.measure` around frames) and by hand on the original A9 at
1920×1080.

### 7.3 Targets (provisional; confirmed or revised by the first measurement slice)

| Metric | Target | Reason |
|---|---|---|
| Enemy turn, 16 enemies, p95 | ≤ 300 ms | M3 typical 100–250 ms; the player waits on it |
| Enemy turn, 32 enemies plus militia and civilians, p95 | ≤ 1 s | the largest original battles (Meduna, Drassen counterattacks; inferred sizes) |
| Real-time tick, 40 soldiers, mean | ≤ 0.25 ms | 1× needs 200 ticks per second: 5 % of a core, room for 16× catch-up and several sessions |
| Strategic world day, no sector loaded | ≤ 100 ms | 30 days of compression in 3 s under the instant driver |
| Save (snapshot and gzip) | ≤ 100 ms and ≤ 2 MB gzipped | autosaves at every turn end (§1.6) must not stall |
| Load (parse and rebuild) | ≤ 500 ms | |
| Event-loop delay p99 for other sessions while one runs an instant turn | ≤ 50 ms | above it, the worker host of §7.5 is switched on |
| Tactical page | 60 FPS at 1920×1080 | `01` §5.1 |

### 7.4 Profiling and optimization rules

- Profile with `--profile` and fix the top frames only; every optimization keeps the oracle comparisons and the scenario
  event logs byte-identical (`pnpm check` plus the local oracle compare).
- Caches are derived data: they live beside the state, are rebuilt on load (§1.4) and never change an outcome. The
  candidates named so far (inferred, to be confirmed by the profile): sight results per tick between position changes
  (`01` §11), path costs within one AI decision, the reachability flood shared by cover and flee searches, allocation in
  the bullet and LOS loops, the per-10-tick view diff with many soldiers.
- No event jumping (`04` §2 level 1b) unless the real-time target fails after caches: it changes the stepping model.

### 7.5 Worker host

`src/server/session-host.ts` defines `SessionHost` (`dispatch`, `advance`, `snapshot`, `subscribe`, `close`) with two
implementations: `InProcessHost` (today's behaviour) and `WorkerHost`, which runs one session in a `worker_threads`
worker and forwards the protocol messages unchanged (the protocol is already message-based, `04` §5.9). Each worker
builds its own content from the VFS (the disk cache is shared by the OS; the memory per worker is measured by the
`server` bench). The registry picks the host by a server setting (`JA2_SESSION_HOST=inprocess|worker|auto`); `auto` uses
workers when more than one session is open. The browser's embedded mode (`04` §5.7) is the same idea in a Web Worker and
stays later.

### 7.6 CI

CI runs every bench scenario on stubs with `--runs 1` as a smoke test: it fails only on errors or on a sanity bound ten
times above the target (CI machines vary), and uploads the JSON lines as an artifact. Local runs on the original data
compare against `.cache/bench/baseline.json` and print the change per metric.

---

## 8. A player UI: what M7 includes and what it does not

### 8.1 Where we are

Everything a player can do is a command or a prompt answer (D15), and every surface that exists reads the same
`PlayerView` (D16): the MCP tools, the WebSocket protocol and the devtools pages. The pages already exercise most of the
campaign: the tactical page (sector rendering, playback at 1×/4×/16×, orders, combat, doors, shop, talk and prompt
panels), the strategic page (map, squads, routes, compression, battles, laptop sections, quests, helicopter), the map
viewer and the asset browser. They are DOM pages with developer ergonomics: text lists, JSON-ish panels, no original
screen layouts, no fonts from the data, no sound.

The original's UI is the other half of the game's source: the tactical HUD with the single and team panels, the
inventory and item description boxes, the map screen with its character list, assignment and contract menus and the map
inventory, the laptop with its sites and programs, the PBI and autoresolve screens, the talk and shop screens, message
boxes, the save/load, options, main menu and game init screens (`01` §5.2 lists them; `01` §11 estimates the UI at a
third of the source). D10 already fixes how it would be built: a canvas widget set with the original's mouse-region
semantics, layouts as data with coordinates from source constants, original art or a stub skin, bitmap fonts.

### 8.2 Options considered

| Option | Contents | Size | Result |
|---|---|---|---|
| A. Full player UI in M7 | D10 widget set, layouts, every screen of `01` §5.2, plus everything else in this doc | XL+ (more than M3) | A human plays like in the original, but M7 becomes the largest milestone and its other items wait behind the widget set |
| B. No player UI at all | Saves, options, sound, video, text, stubs, performance behind the API and the devtools pages | M | Complete for agents and developers; a human still plays through debugging panels |
| C. Polish now, player UI next (**recommended**) | M7: everything in §1–§7 plus a DOM **launcher** (new game with options, save/load, settings, language, intro and credits) and the devtools pages wired to sound, saves and localized text. M8: the canvas player UI of D10 | M7: M–L; M8: XL | M7 releases a complete platform (campaign start to end on original data and on stubs, by an agent or a developer in the browser); M8 releases the game for a human player |

### 8.3 Decision and arguments

Recommendation: **option C**, splitting the old M7 into **M7 Polish** and **M8 Player UI**.

1. **Size.** The player UI alone is larger than every other M7 item together. Keeping it in M7 turns a polish milestone
   into the biggest one, and nothing else in it could be called done before the widget set exists.
2. **Dependencies run one way.** The UI needs the M7 items: the save/load screen needs the save format (§1), the
   options screen needs the options model (§2), every screen needs sound cues (§3), text and fonts in the chosen
   language (§5) and a complete stub skin (§6). Doing them first means the UI is built once on stable interfaces.
3. **The API already plays the whole game.** D15 was enforced through M3–M6: an agent can finish a campaign through MCP,
   and the devtools pages cover each command. "Release" of the platform (server, agent API, saves, sound, localized
   text, playable on stubs) is meaningful without the canvas UI; the UI is a new client, not new rules.
4. **Parallel work.** The M7 slices (§13) are independent and suit background agents one at a time. The UI is serial at
   its start (widget set, layout format, fonts, input routing) and only then fans out by screen.
5. **Behaviour reference.** D1 covers rules; UI is "our own way" (`01` §0). Separating it lets M8 decide pixel fidelity
   versus a modern layout per screen without blocking the release of the rules.
6. **Risk.** UI volume is a listed risk (`01` §11). Isolating it in its own milestone keeps M7 shippable.

What M7 **does** include for a human, because the M7 features have no other surface:

- **Launcher** (`src/app/launcher/`, DOM, allowed by D10): data source and language shown, new campaign with the game
  options of §2.2, the save list with load, delete, download and upload (§1.8), native saves to import, client settings
  (volumes, subtitles, playback speed, splash and intro), the video player (§4) and the credits scroller, links into the
  tactical and strategic pages for the chosen session.
- **Devtools pages wired up**: sound and music playback (§3), quick save and quick load keys, save and load buttons,
  text in the chosen language. They stay developer pages, and they are what the e2e tests drive.
- **Not in M7**: the canvas widget set, original screen layouts, bitmap fonts in game screens, the tactical HUD and
  inventory, the map screen, the laptop screens, the PBI, talk and shop screens as original UIs, the hotkey table, the
  help screens.

M8 Player UI (proposed row for `01` §10): the D10 widget set and layout format; bitmap fonts from the data or the stub
font, with the language's glyph table (§5.2); the screens of `01` §5.2 in the order main menu and options and save/load
(they reuse M7's launcher logic) → tactical HUD, panels and inventory → map screen → PBI and autoresolve → talk, shop,
message boxes → laptop sites; the original hotkeys; meanwhile scene playback (`26` §2.4) and the enemy glow. Result: a
human plays the campaign in the browser without the devtools pages. Size XL.

---

## 9. Agent API and protocol (D13–D16)

Everything below is added to MCP, HTTP and the WebSocket protocol together, and `04` §6 gets a section "Saves, options,
text and presentation (M7)" when the slices land.

**Commands** (dispatched like every other command, logged):

| Command | Where | Refusals |
|---|---|---|
| `setOption {bloodAndGore}` | any flow | `promptOpen` |

**Tools and routes** (not commands: they act on the session or the server):

| MCP tool | HTTP | Purpose |
|---|---|---|
| `save {session, name?, description?}` | `POST /api/sessions/:id/save` | §1.7; refusals `conversation`, `meanwhileStarting`, `promptOpen`, `shopOpen`, `ironMan`, `deadIsDead`; a won campaign may still be saved (`26` §13 decision 3) |
| `load {name, session?, reseed?}` | `POST /api/sessions/:id/load`, `POST /api/sessions {load}` | §1.5; refusals `contentMismatch`, `versionTooNew`, `notFound`; warnings `dataVersionDiffers`, `engineDiffers` |
| `listSaves {}` | `GET /api/saves` | headers of ja2-node and native saves |
| `deleteSave {name}` | `DELETE /api/saves/:name` | |
| — | `GET`/`PUT /api/saves/:name/file` | download and upload (browser only) |
| `newSession {campaign: {options}, load?, language?}` | `POST /api/sessions` | options (§2.2), load, the session's display language for resolved text (§5.2) |
| — | `GET /api/strings?lang=` | UI string tables (§5.2) |
| — | `GET /api/text` (widened) | EDT rows with their layouts (§5.2) |

**Status and observation.** `status` and `observe` show `options`, `saveMode`, `language`, `dataVersion` and, when a
save rule applies, `canSave: false` with the reason (so an agent need not try). View frames carry `music {mode,
creature}` when it changes (§3.3) and soldier `voice`/`body` (§3.3). `observe` adds nothing about sound: agents get the
same facts from events.

**Events** (presentation fields are optional and never in state): `gameSaved`, `gameLoaded`, `optionChanged`; the S8
additions of §3.3 (`shotFired {item, silenced, rounds}`, `bulletStopped {material}`, `explosion {animation}`,
`doorChanged {kind, noisy}`, `reloaded`, `itemAttached`, `vehicleMoved`).

**`advance`.** Unchanged; the client's sleep/wake setting is a stop condition (§2.2). A load stops any running advance
and returns `stopped {reason: 'loaded'}` to the subscribers.

**MCP descriptions** state that `load` defaults to reseeding (`reseed: false` for reproducible experiments), that saves
follow the session's save mode, and that `listSaves` includes native saves which `newSession {save}` imports.

---

## 10. Determinism

| Rule | Where it matters |
|---|---|
| Saving draws nothing and changes nothing; the original's save-time `R(RAND_MAX)` is dropped | §1.3 |
| `restore(snapshot(S))` continues bit-identically; enforced by the reload-at-every-boundary test | §1.3, §12.1 |
| Player loads reseed `main` from a logged seed; `pre` and the cosmetic streams are restored | §1.5 |
| Every outcome-relevant input (commands, answers, advances, real-time batches as tick counts, map preparation, reseeds) is logged with its tick | §1.3 |
| Game options and the policy are session state; client settings never reach the simulation | §2.2 |
| Blood and gore changes only through a logged command | §2.2 |
| No sound, music, video or text affects a draw, a timer or a stop; the music mode is computed outside `sim` from events | §3.3, §4.3, §5.3 |
| The data version may change quote lengths and record layouts (as in the original's versions); it is part of the save's content identity | §5.3 |
| Client-side randomness (sound variants, music tracks, ambient gaps, mouth frames) uses a client PRNG | §3.3 |
| Caches added for performance are derived, rebuilt on load and verified by the oracle and scenario logs | §7.4 |
| The worker host forwards the same messages; outcomes cannot depend on the host | §7.5 |

What stays deliberately nondeterministic: wall-clock save timestamps (presentation), the entropy seed of a player load
(logged), real-time input timing in the browser (logged as tick counts).

---

## 11. Data tables, original data, native import, stubs

### 11.1 Use directly (`data/externalized/`, already in the repository)

`music.json` (modes → tracks, §3.1); `strings/translation-*.json` and the other per-language string files, eight
languages plus `rusgold` (§5.1); `translation_tables/*.json` (glyph tables, for M8); `calibres.json` and `weapons.json`
(gun sound paths, §3.1); `explosion-animations.json` (explosion sounds); `vehicles.json` (vehicle sounds); `game.json`,
`imp.json`, `strategic-ai-policy.json` (the policy copied into sessions, §2.2).

### 11.2 Transcribe (`tools/transcribe/*.ts` → `data/tables/`)

| Table | From | Content |
|---|---|---|
| `sound-effects.json` | `Utils/Sound_Control.h:28-352`, `Utils/Sound_Control.cc:17-328` | sound ids, ambient ids, paths, the pan and volume constants |
| `battle-sounds.json` | `Tactical/Soldier_Control.h:178-198`, `Tactical/Soldier_Control.cc:138-157` | the 17 kinds with variant counts and flags |
| `button-sounds.json` | `src/sgp/Button_Sound_Control.cc:11-50` | click schemes per screen (M8 uses it; small, transcribed with the rest) |
| `music-modes.json` (or constants) | `src/externalized/content/ContentMusic.h:3-17`, `Utils/Music_Control.cc:182-319` | mode ids, the victory and defeat end rules |
| `intro-sequences.json` (or constants) | `Intro.cc:34-78`, `:252-329` | video names and sequence order |
| `edt-layouts.json` | `src/externalized/strings/EDT.h:60-110`, `src/externalized/ItemModel.cc:11-20`, the laptop readers | EDT file → record layout for `/api/text` |

Named constants with the SFI header instead of tables where a handful of values is all there is (fade steps, the 2 s
battle-sound filter, the 46-character description, the 16-voice cap, the ambient time windows).

### 11.3 Original data, read at runtime, never committed

Sounds, battle sounds, speech and `.gap` files, music, ambient `.bad` tables and sounds (from `Ambient.slf`), laptop
sounds, the Smacker videos (in the Steam package's `Intro-old.slf`), `credits.edt` and the other EDT files, fonts and
the glyph-relevant data version. Tests that need them use `describe.skipIf(!process.env.JA2_DATA_DIR)` and assert
counts, formats and lengths only (for example: every path in `sound-effects.json` resolves or is a known null slot;
every `music.json` track decodes; the number of `.gap` files matches the speech files they belong to; each intro video
opens and its first frame decodes).

### 11.4 Native save import

Unchanged in format (`docs/14`); M7 adds: `GameOptions.saveMode` and `turnTimeLimit` (dropped with a note) from the
header, the music mode byte (`SaveLoadGame.cc:1827`) into `presentation.music`, `useCreatureMusic` (already decoded,
`src/content/formats/savegame.ts:567-577`), and the data version check: a save whose German encryption flag is set
(`germanEncryption`, `docs/14` §3) or whose NPC layout is Russian is imported only when the server's data version
matches. Native saves appear in `listSaves`.

### 11.5 Stubs

As §6.3: P0 in slice S7, P1 in S13, P2 with M8. The stub data version is `stubs` (English text, English EDT mode,
English glyph table for the stub font).

---

## 12. Tests

### 12.1 Saves

- **Round trip**: `snapshot → restore → snapshot` is byte-identical for every stub scenario state (sandbox, new campaign
  in the laptop, landed squad, turn-based battle with bullets and explosions in flight, autoresolve, shop open, talk
  open, meanwhile resolved, endgame, won campaign) and for every native save import on original data.
- **Reload at every boundary**: the existing scenario tests (`battle-scenario`, `shop-scenario`, autoresolve, talk,
  meanwhile, endgame, helicopter, recruit, give, civ quotes) gain a mode that snapshots and restores into a fresh
  session after every input; the event log and the final snapshot must equal the uninterrupted run. This is the guard
  against any state that the codec misses, including new state added after M7.
- **Replay**: a session's input log replayed from its origin reproduces the snapshot (`pnpm cli replay`), under the
  instant and the manual driver.
- **Reseed**: a player load with seed `s` equals an exact load followed by `reseed {s}`; `PR` values after a player load
  repeat the saved ring until consumed.
- **Rules**: Iron Man refusals (combat, enemies in the loaded sector), save anywhere refusals (conversation, prompt,
  meanwhile starting, shop), Dead is Dead autosave points and conditions, the autosave at `endTurn` (written only when
  accepted and combat continues; `Auto01`/`Auto02` alternate), backups.
- **Files and API**: names validated, paths never accepted, upload size cap, version migration from a fixture of version
  1, content mismatch refused, text mismatch warned; MCP `save`/`load`/`listSaves`/`deleteSave` against a temporary save
  folder.
- **Native list**: native headers listed from a synthetic `.sav` fixture (the existing synthetic save test data).

### 12.2 End to end (Playwright on stubs)

- **Campaign with saves**: through MCP alone, a stub campaign from the new game to the Queen's death (the S13 stub
  campaign path), saving in the middle of a battle, loading it into a new session with `reseed: false`, and finishing
  with the same outcome as without the reload.
- **Launcher**: start a campaign with options, quick save on the tactical page, quick load, see the save list, download
  and upload a save, switch the language to Russian and see Russian labels.
- **Media**: the splash plays (decoded frames counted), a stub sound and a music track start after the first gesture (an
  `AudioContext` probe), muted when the volume is 0.

### 12.3 Unit

- `wav.ts` (PCM 8/16, IMA ADPCM against a reference decode of a synthetic signal), `gap.ts`, `ambient.ts`, `smk.ts`
  (header, palette chunk, each block type, DPCM audio, on a generated fixture), `credits.ts` (control codes), the cue
  rules (footstep terrain classes, burst file fallback chain, battle-sound fallbacks and low-morale variants, door
  kinds, Russian speech prefix), `SoundVolume`/`SoundDir` against the original formulas, `musicMode` transitions for
  every row of the §3.1 table, the string table loader's length check, data version detection, the options defaults.

### 12.4 Benchmarks

Every scenario of §7.2 runs once in CI on stubs (sanity bounds only, §7.6).

---

## 13. Minimal M7 implementation

### 13.1 Modules

| Module | Layer | Content |
|---|---|---|
| `src/sim/snapshot/` (`codec.ts`, `refs.ts`, `world.ts`, `session.ts`) | sim | §1.3 codec, pointer encoding, world snapshot, `snapshotSession`/`restoreSession` |
| `src/sim/options.ts` | sim | `GameOptions`, defaults, `setOption` |
| `src/core/rng.ts` (extend) | core | `Rng.restore()` |
| `src/server/save-store.ts` | server | files, names, backups, headers, gzip, list (ja2-node and native), upload validation |
| `src/server/save-rules.ts` | server | §1.6 refusals and autosave points (reads the view and flow, no simulation change) |
| `src/server/input-log.ts`, `tools/cli.ts replay` | server, tools | §1.3 input log and replay |
| `src/server/content-identity.ts` | server | the logic and text hashes |
| `src/server/text-service.ts`, `src/server/text-keys.ts`, `src/content/text/strings.ts` | server, content | §5.2 |
| `src/server/data-version.ts` | server | detection and override |
| `src/protocol/music.ts` | protocol | `musicMode` |
| `src/content/formats/wav.ts`, `gap.ts`, `ambient.ts`, `smk.ts`, `credits.ts` | content | decoders (SFI headers where they encode original formats) |
| `src/content/audio/cues.ts` | content | cue rules |
| `src/audio/` (`engine.ts`, `positional.ts`, `director.ts`, `music.ts`) | audio (new browser layer) | §3.3 |
| `src/app/` (`launcher/`, `video/`, `settings.ts`) | app (new browser layer) | §4.3, §8.3, §2.2 |
| `src/server/session-host.ts` | server | §7.5 |
| `tools/bench/` | tools | §7.2 |
| `tools/transcribe/sound-effects.ts` (and the others of §11.2) | tools | tables |
| `stubs/audio.ts`, `stubs/music.ts`, `stubs/speech.ts`, `stubs/text.ts`, `stubs/video.ts`, `stubs/maps/sector-kinds.json` | stubs | §6.3 |
| `tools/check-imports.ts` (extend) | tools | the `audio` and `app` layers and their allowed imports |

### 13.2 Order of work (one background agent per slice)

| Slice | Content | Depends on | Done when |
|---|---|---|---|
| **S1** State ownership | §1.4 rows 1–3, 8, 9, 11, 12: private session and flow state into `StrategicState`, the roster as records, saved and seeded cosmetic streams, restore constructor path, id comparisons, drained buffers; fix `dialogueProfiles` if confirmed | — | all existing tests and oracle compares unchanged (except fx-seeded outputs, open question 11) |
| **S2** Snapshot codec | §1.3 codec, §1.4 rows 4–7, 10, 13; restore path; round trip and reload-at-every-boundary tests (§12.1) | S1 | every scenario passes in reload mode; native imports round-trip |
| **S3** Saves | file format, content identity, save store, rules, autosave, input log and `replay`, MCP/HTTP/WS API, events, native list; `04` §6 section | S2 | §12.1 complete; an agent saves and loads through MCP |
| **S4** Benchmarks | `tools/bench`, the stub arena map, the scenarios of §7.2 (the `save` scenario after S3), CI smoke, the first measurements on original data; revise §7.3 | — (can run beside S1–S3) | targets confirmed or revised in this doc |
| **S5** Options | `GameOptions` unification, the policy copy, `setOption`, `newSession` options, `status`, import mapping, deviations | S3 | blood and gore off changes deaths in a stub scenario; options in the save header |
| **S6** Text (landed, §5.5) | data version, `TextService`, string tables, `/api/strings`, widened `/api/text`, text keys, the Russian paths (EDT mode, NPC layout, speech prefix), per-session language | — (beside S5) | Russian labels on stubs; original-data tests for counts and lengths |
| **S7** Stub media P0 | §6.3 items 1–5 except the video | S6 | `/api/text` and the cue table resolve on stubs |
| **S8** Sound | WAV/GAP/ambient decoders, transcribed tables, cues, the audio layer, the director with animation opcodes, speech, ambient; the event fields of §3.3; deviations | S7 | the tactical page plays a stub firefight with sound |
| **S9** Music | `musicMode`, `presentation.music` in sessions and snapshots, the client player, the victory clear of `useCreatureMusic` in the simulation | S8, S3 | music follows sector entry, combat, victory and defeat on stubs |
| **S10** Video | `smk.ts`, the stub encoder (or fixture), the player, sequences, credits parser and scroller | S8 | the splash and the ending play on original data; stub splash in e2e |
| **S11** Launcher | the DOM launcher (§8.3), quick keys in the pages, client settings, export and import | S3, S5, S6, S10 | §12.2 launcher test |
| **S12** Performance | profile-driven fixes against §7.3, `SessionHost` and `WorkerHost` | S4 (and S2 for the save scenario) | targets met or documented |
| **S13** Stub campaign | §6.3 P1 items 6–9 and the end-to-end campaign with a reload (§12.2) | S3, S7 | the stub campaign is won through MCP alone with a reload in a battle |
| **S14** Release | README (playing with data or stubs, connecting an agent), `deviations.md` consolidated, `01` §12 status, a version tag | all | maintainer's review |

S4 and S6 can run in parallel with the save slices; everything else is sequential to avoid conflicting edits of the
session factory and the protocol.

---

## 14. Deviations, findings, verified vs inferred, open questions

**Quirks to keep** (Stracciatella's behaviour, carried over on purpose):

- The save list hides quick and auto saves in save mode; Alt+Load on the main menu loads the newest save; autosaves and
  Dead is Dead saves show no message; Dead is Dead keeps two backups; Iron Man refuses saves while enemies are in the
  loaded sector even outside combat.
- `PreRandom` repeats after a reload until the saved values are consumed and refilled.
- Sound: 16 voices, a new sound is dropped when all are busy; linear balance panning; off-screen sounds 25 quieter with
  a floor of 25 and no distance falloff; footstep variants never repeat twice in a row; the battle-sound repeat filter of
  2 s; soldier sounds scaled twice (open question 4).
- Music: no fade-in; the map screen keeps whatever plays; victory falls back to the nothing mode, defeat to silence; the
  laptop restores the previous mode.
- Video: the splash only with English (and Chinese) data; the ending picks the throne video by Miguel's and the
  helicopter video by Skyrider's death; Escape ends a sequence, Space or a click one video; missing files are skipped.
- Text: Ё and the other unmapped CP1251 characters stay unmapped in Russian data; money and numbers are never
  localized; both Russian versions read `translation-rusgold.json`.

**Deviations to log in `docs/deviations.md`** (when the slice lands):

- *Save side effects*: the original draws `R(RAND_MAX)` for the save header (`SaveLoadGame.cc:380`); ja2-node saves
  draw nothing.
- *Cosmetic streams in saves*: saved and seeded from the session seed (D6 says unsaved); gameplay still never draws
  from them.
- *Carmen's departure timer*: now saved (replaces "not saved either").
- *Error saves*: an input log instead of `Error.sav`.
- *Key-advance speech*, *sleep/wake notification*, *timed turns*, *policy snapshot* (§2.3).
- *Music track choice*, *footstep variants*, *speech playback not cut*, *ambient timing* (§3.5).
- *Intro and splash switches*: client settings `playIntro` and `playSplash` (the original always plays the beginning
  intro on a new game).
- *Video pacing*: frames paced by the audio clock instead of the wall clock.
- *Display language*: UI strings may be in another language than the data's text.

**Findings outside M7's scope** (from the audit; 1–4 and 6 fixed or recorded on 2026-10-16: the terrorist set, the militia prompts as battle prompts, the economy events drained into the campaign events, the stub text probe, the D5/D7 notes in `01`; 5 fixed in S1 after decision 11, and 4 confirmed fixed):

1. `TERRORIST_PROFILES` is an empty `Set` (`src/sim/tactical/combat/death.ts:63`), so the terrorist exclusion of the
   fall-back hit animation (`Tactical/Soldier_Ani.cc:3116-3117`, `!IsProfileATerrorist`) never applies.
2. Deferred militia prompts in `state.economy.prompts` are never answered by campaign or server code
   (`src/sim/strategic/economy/state.ts:40-65`).
3. `EconomyContext.events` is never drained in a campaign (`src/sim/strategic/economy/context.ts:36`): unbounded growth
   over a long campaign.
4. `dialogueProfiles()` probes without the `stubs/` fallback (`src/content/strategic/laptop-content.ts:357`), so stub
   R.P.C.s and NPCs may be marked as having no text.
5. `TalkState.fx` is seeded with a constant whatever the session seed (`src/sim/narrative/talk-state.ts:98-124`).
6. D5's resolution barrier is still the original's `attackBusyCount` (`src/sim/tactical/turns/turn-state.ts:35`); D7's
   "ids instead of pointers" does not hold in the tactical layer (§1.4). Both are documentation drift to note in `01`.

**Verified** by reading Stracciatella (vanilla where marked): the save list, names, folders, header, keys and gates,
`CanGameBeSaved`, the three save modes, Dead is Dead's file, backups and save points, the end-of-turn autosave and its
absence of an option (vanilla's hidden file), `SaveGame` and `LoadSavedGame` including the save-time draw and the
absence of reseeding, the settings file; `GAME_OPTIONS`, every `TOPTION_*` reader and its class, the merc light being
fake for sight, the options screen, the game init screen, timed turns compiled out, the policy keys; the mixer, sound
ids, volume and pan formulas, positional sounds, animation opcodes, footsteps, gun and burst sounds, battle sounds,
doors, explosions, ambient tables and scheduling, music modes, setters, end rules and track choice, speech file names,
the couplings of gameplay to sound; the intro sequences, Smacker playback, credits; the data versions, string tables,
EDT decoding, glyph tables, speech naming, formatting. **Checked on the user's data** (formats only): archive names
including `Intro-old.slf`, WAV encodings per archive, Smacker headers. **Inferred**: that vanilla looped forever on
`loop = 0`; that IMA ADPCM is not reliably decoded by browsers; that the Steam package renames the intro archive to skip
it; that Russian Gold cannot be guessed; that `translation-rus.json` is unused by Stracciatella; that Ё and the
guillemets cannot render in Russian versions; that quick load is not blocked in Dead is Dead; that the death track's end
silences the game; that the first helicopter drop in ja2-node does not wait for a sound fade; the cost estimates in
§7.3.

**Open questions for the maintainer** (with the recommendation first):

1. **Split M7 into M7 Polish and M8 Player UI** (§8)? Recommended; `01` §10 is edited accordingly in this change.
2. **Snapshot strategy**: a codec with pointer encoding plus moving private state into `StrategicState` (recommended,
   S1–S2), or first refactoring the tactical layer to ids (D7) everywhere (cleaner, much larger, touches every combat
   and AI module), or replay-only saves (rejected: load time grows with the campaign and any code change breaks old
   saves).
3. **Dead is Dead and quick load**: keep the original's unblocked quick load (recommended, faithful) or block every load
   (the mode's intent)?
4. **Double volume scaling** of soldier sounds (`Utils/Sound_Control.cc:409-420`): keep (recommended, faithful) or fix?
5. **Default load mode for agents**: reseed with a logged seed (recommended, faithful to D6) or exact?
6. **Cyrillic with English data in the canvas UI (M8)**: the stub font as a fallback (recommended), capitals only with
   the original glyphs, or require Russian data for a Russian UI?
7. **Russian UI strings**: `translation-rusgold.json` as Stracciatella picks for both Russian versions (recommended) or
   `translation-rus.json`?
8. **Extra autosaves** (sector entry, daily) as a server setting for long agent campaigns, or only the original's
   end-of-turn autosave (recommended for M7)?
9. **Stub video**: a minimal Smacker encoder in `stubs/` (recommended if under a day of work) or a test fixture only?
10. **Intro switch**: accept the `playIntro` client setting (recommended) or always play the beginning intro?
11. **Seeding the cosmetic streams from the session seed** changes the outputs of existing seeds (civilian quote picks,
    the triggering merc): accept and update the affected test expectations (recommended)? *Accepted; done in S1 (§1.4),
    and no existing expectation changed.*
12. **API default difficulty**: keep 2 (recommended, documented) or switch to the original's easy?
13. **Save folder**: `.ja2/saves` in the repository (recommended for a developer server) or a per-user data folder?
14. **Release naming**: tag the end of M7 as `0.x` "platform release" and keep `1.0` for M8 (recommended)?

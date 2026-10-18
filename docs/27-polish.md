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
| 2 | Options | Game options are session state, the policy JSON stays logic content under the save's content hash; blood and gore is the only outcome-relevant toggle and becomes a command; all other toggles are client settings; timed turns are not ported |
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
sorted entry arrays, so two equal states give equal bytes; as built in S2 the codec keeps object key order and map and
set insertion order instead, so equal histories give equal bytes, see §1.4 "Status after S2"):

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

**Status after S3 (2026-10-18).** §1.3's file, content binding, input log and replay, §1.5's load modes, §1.6's rules
and §1.7's API exist; the browser surfaces (§1.8) landed with S11 (§8.4); the options (S5, §2.4) and the music block (S9, §3.7)
have landed since. The
agent-facing description is `04` §6.22.

| Module | Content |
|---|---|
| `src/server/save-file.ts` | `SaveFile` (`format: 'ja2-node-save'`, `version: 1`, `header`, `session {kind, origin, tick, preparedMaps}`, `contentFiles`, `sim`, `presentation {music: {mode: 'none', previous: 'none'}}`), written as two gzip members at the fastest level: the first holds `{"format", "version", "header",` and a newline, the second the rest, so the file is one JSON document for `gunzip` and the list reads the header from the first 64 KiB (also from a file gzipped again as one member); the migration chain (`SAVE_MIGRATIONS`, empty for version 1) runs before the snapshot's own `migrateSnapshot`; the header summary comes from the session |
| `src/server/content-identity.ts` | `ContentLedger` wraps the server's `read` and `exists` once (one function for every session, so the narrative cache keyed by `read` still works) and records every file the simulation's content and maps read (size and SHA-256), every missing file and every existence probe; `.edt` files count only by presence, their text goes to the text identity. A save lists these paths (`contentFiles`, about 1,300 on the original data) and the header carries the hash over them; a load hashes the same paths in its own data and refuses another hash or another source. The text identity hashes the quote lengths (row by row, at the dialogue or civilian width) of the `DialogueTexts` in use (`none` for the sandbox); `engineIdentity` is the package version and the commit (`JA2_COMMIT`, else the repository's HEAD) |
| `src/server/save-store.ts` | `$JA2_SAVE_DIR` (default `.ja2/saves/`), names `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` (a client never passes a path), `QuickSave`, `Auto01`/`Auto02` (the older or missing one by modification time, then alternating in memory), player saves `<UTC time>-<slug>` like `SaveNewSave` and `clean_basename`, Dead is Dead backups `Backup/<name>.j2s.1`, `.2` as `BackupSavedGame`, writes through a temporary file and a rename, the list (unreadable files listed with their problem) and the native headers of `$JA2_SAVES_DIR` |
| `src/server/save-rules.ts` | `CanGameBeSaved`, the §1.6 refusals, the Dead is Dead conditions of `DoDeadIsDeadSave` (our turn, no conversation, meanwhile, prompt or shop, the loaded sector idle) and its save points read from events (`turnStarted` of our team, `meanwhile`, `meanwhileStarted`) and from the strategic queue (a `GROUP_ABOUT_TO_ARRIVE` event that was due and left the queue); `saveStatus` for `status` and `observe` |
| `src/server/save-service.ts` | saves, loads, the autosave and Dead is Dead hooks, upload and download, the list, the error log; attached to each server session through `Session.hooks` (before and after a dispatch, before and after an advance, after a whole input, on a throw), which only read the simulation |
| `src/server/input-log.ts`, `src/server/replay.ts`, `tools/replay.ts` | the log, its JSON-lines file and `pnpm cli replay` |
| `src/server/session-factory.ts`, `src/server/save-environment.ts` | the session factory moved out of `main.ts` (it also builds a session from a log origin) and the wiring shared by the server and the CLI |

*Session.* `Session` logs every input before running it: `cmd` and `answer` (a command of type `answer`) with the
command, `advance` with the stop condition and budget, real-time batches as `advance {until: {ticks}, realtime: true}`
(consecutive batches that ran to their tick count are merged into one entry of at most 100,000 ticks, equivalent
because a batch that ran fully left no decision, end or watched event behind), `drive` (informational: the advances a
driver causes are logged themselves, so a replay uses the manual driver whatever the session used), `prepare {maps}`
with the maps a command's preparation added, `reseed {seed}` and `load {name, digest}` for a load in place. A save
writes the segment since the last load: the origin is then that save, identified by the SHA-256 of its decompressed
text. Before a campaign snapshot the campaign's undrained output events move into a buffer of the `Session`, which the
next advance reports first, so saving changes neither the state nor the events the session reports; the tactical
event buffer is state and is written. `Session.sim` became replaceable for a load in place (`replace`).

*Rules as built.* `promptOpen` also covers an autoresolve battle (the original has no save key on that screen). Dead is
Dead: an explicit save is refused (`deadIsDead`); `save {name: 'quick'}` writes the Dead is Dead file as `DoQuickSave`
does, or answers `actionInProgress` when `DoDeadIsDeadSave` would skip. The `endTurn` save point is the snapshot taken
before the command, written when the command is accepted (in the other modes it is the autosave, written only when
combat goes on). The other save points are evaluated after the input that produced them (an `advance` stops between
ticks, never inside one), and a point that falls while the conditions fail is written at the first later input
boundary where they hold (deviation "Dead is Dead save points"). The Dead is Dead file name lives in the server: chosen
at the new game, the loaded save's name after a load, the native file's name after an import.

*Load.* `load` reads the header, inflates and parses the body, runs the migration chain, checks the content (source,
then the logic hash over the listed files), restores through S2's `restoreSession` with the ledger's `read`, compares
the text identity and, for a player load, reseeds with `crypto.randomInt(0, 2^32)` through `reseedMain`. A load in
place first takes the session's Dead is Dead save point, then replaces the simulation; a new session gets the log
origin `load`.

*Tests.* `save-file.test.ts` (one JSON document, the header from a prefix and from a file gzipped again, the
migration chain from version 1, newer versions, non-saves, descriptions), `save-store.test.ts` (names, never paths,
player names, autosave alternation, two backups, the list, native headers from the synthetic `.sav` header now shared
in `tests/support/native-save.ts`), `input-log.test.ts`, `content-identity.test.ts`, `session.test.ts` (the log, held
events, `replace`), `save-rules.test.ts` (conversation, shop, prompt and meanwhile refusals, Iron Man with enemies and
in combat without autosaves, Dead is Dead at the quick save, the start of our turn, `endTurn`, not during the enemy's
turn, before a load, at shutdown and when a group is about to arrive), `save-service.test.ts` (sandbox and campaign
saves loaded exactly and with a reseed, a player load with seed s equal to an exact load followed by `reseed {s}`, the
`PreRandom` ring repeating for 256 draws after a player load, a load in place with a fresh `welcome`, the autosave
alternating and holding the state before `endTurn`, content mismatches refused, text and engine differences warned, a
version-1 file loaded, uploads, downloads, the native list, the error log), `replay.test.ts` (real-time, instant and
manual drivers, map preparation), `save-api.test.ts` (MCP, HTTP and WebSocket against a temporary save folder),
`save-original.test.ts` (original data: a new campaign and a native import saved, replayed and loaded exactly) and the
end-to-end `tests/e2e/saves.spec.ts` (an MCP agent saves in a battle, loads it exactly into a new session, and both
sessions answer the same commands with the same reports and views for three rounds).

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
| **Game policy** | logic content (`data/externalized`), loaded like the other content and covered by the save's content hash | yes | `game.json`, `imp.json`, `strategic-ai-policy.json` values |
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

**Game policy.** Decided for M7: the policy files stay logic content and are **not** copied into the session. The save's
content identity (§1.3, `src/server/content-identity.ts`) already lists every file the simulation reads, the policy
files among them, so a changed policy refuses an old save with `contentMismatch` instead of replaying it with other
values. Copying the policy would duplicate content into every save for a case the content check already catches; it can
be revisited if saves must survive policy edits (it would then be a migration, not a deviation).

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

All three are in `deviations.md` since S5. There is no policy deviation: the policy stays content (above).

### 2.4 What landed (slice S5, 2026-10-18)

- **`src/sim/options.ts`**: `GameOptions {difficulty: 1|2|3, sciFi, gunNut, saveMode, bloodAndGore}` replaces the three
  partial interfaces (the tactical `{gunNut, bloodAndGore}`, the strategic `{difficulty, sciFi, gunNut, saveMode}`, the
  native header record, now `SavedGameOptions` in `src/content/formats/savegame-header.ts`). `ORIGINAL_GAME_OPTIONS`
  holds the original's defaults (easy, sci-fi, reduced guns, save anywhere, blood on, `GameSettings.cc` InitGameOptions
  and InitGameSettings); `gameOptions(request)` builds a fresh object with the API default difficulty 2 (decision 12) and
  refuses another difficulty; `importNativeGameOptions` maps a native record (`saveMode` from `ubGameSaveMode`, blood
  and gore on because it lives in the user's `Ja2.set`, `turnTimeLimit` reported in `dropped`).
- **One source of truth.** The strategic state owns the options object; a loaded sector's `TacticalState.options` is
  the same object (`TacticalSimOptions.options`, like the profiles and the streams), and so is `EquipmentState.options`.
  The tactical copies are gone: `Perception.difficulty`, `EquipmentState.gunNut` and `.sciFi` read the options. This
  fixed a port gap: the campaign never set the equipment's gun nut flag, so the army gun choice (`items.gunChoice`)
  ignored gun nut in campaigns. A sandbox owns its own options object (`gameOptions()`). The snapshot codec re-links the
  shared object like any alias; snapshot version 2 migrates version 1 files (adds `bloodAndGore` to the strategic
  options, turns the tactical copies into references, `src/sim/snapshot/migrations.ts`, tested on a sandbox and a
  landed campaign in `src/server/snapshot-migration.test.ts`).
- **`newSession {campaign: {options}}`** (MCP and `POST /api/sessions`): any of the five fields; missing ones take the
  defaults above. `campaign.difficulty` and `campaign.saveMode` stay accepted as aliases (old input logs replay, old
  callers work); an alias that contradicts `options` is refused. `deadIsDeadName` stays a campaign field: it names a
  server file, not a game option. The devtools strategic page and `JA2_CAMPAIGN` use `options`.
- **`status`, `observe`, `GET /api/sessions`** show `options`; the save header carries the full options; `listSaves`
  maps a native header onto the same shape (`droppedOptions` when the timed turns were on). A native import's
  `newSession` answer carries the import report (`import`, with `droppedOptions`).
- **`setOption {bloodAndGore}`**: a command like every other (logged in the input log, replayed), accepted in any flow
  (also in a meanwhile, the endgame and the laptop, before the story refusals), refused with `promptOpen` while a battle,
  contract, militia or NPC prompt is open, `badOption` for anything else; it changes the shared object, so it applies
  from the next tick, and reports `optionChanged {bloodAndGore}`. The paths it changes are ported: the messy shot deaths
  (`JFK_HITDEATH`, `FLYBACK_HIT` within two tiles), the explosion deaths (`BODYEXPLODING`, `CHARIOTS_OF_FIRE`), the death
  animation chain, the corpse file (`corpses.json` bloody or clean), the corpse structure damage; corpse vaporizing and
  the blood graphics are cosmetic and not simulated. Test: `src/sim/tactical/combat/blood-and-gore.test.ts` (a grenade
  death, a close head shot and the corpse file with the option on and off, on stub content).
- **Client settings** (`src/app/settings.ts`, version 2, version 1 values kept): key-advance speech, the sleep/wake
  notification switch, the display toggles of §2.1 (`display.*`, stored for M8), playback speed, display language,
  meanwhile scenes seen (flags), help hidden, cover and LOS display sizes (4–11, `DisplayCover.cc`), every storage access
  in `try`. The sleep/wake switch is applied by the pages' real-time driver and advance since S11 (§8.4); an agent passes `fellAsleep` and
  `wokeUp` to `advance {until: {events}}`.
- **Tests**: `src/sim/options.test.ts`, `src/server/options-api.test.ts` (MCP: options in the new campaign, `status`,
  `observe`, the save header and `listSaves`, `setOption` logged and refused for other options; aliases and the
  contradiction; HTTP; `promptOpen`), `src/app/settings.test.ts`, and on the original data every native save's options
  and the shared object (`src/server/save-session.test.ts`).

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
| `TACTICAL_ENEMYPRESENT` | an enemy placed in an untouched sector without known enemies, outside the game start and meanwhile scenes (`SetEnemyPresence`, called by `AddSoldierToSectorGridNo` and `EnterCombatMode`, not by a sighting: S9 corrected this row), leaving combat with enemies left, the first helicopter drop, the PBI, the end of a meanwhile (`Tactical/Overhead.cc:4080`, `:4124`, `:4369`, `Tactical/Soldier_Add.cc:928`) |
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
| Sound picks draw on the gameplay generator: `SoundRange`, footstep variants, battle-sound variants, explosion sounds, door sounds, the music track, ambient timing, mouth frames, cows, crows, bloodcat growls | not drawn, or drawn from the cosmetic stream (rows "Cosmetic draws …" in `deviations.md`); checked in S8: the simulation never drew footstep variants (row "Footstep variants"); the music pick is S9's (§3.5) |
| The first helicopter drop waits for the engine sound to fade before unlocking and calling in enemies (`Tactical/Merc_Entering.cc:529-562`) | checked in S8: the drop sequence is not ported at all; `INSERTION_CODE_CHOPPER` places the mercs at the north entry point at once (`src/sim/campaign/sector-flow.ts` `#heliDrop`, `deviations.md` "Helicopter entrance") and `HandleFirstHeliDropOfGame` (call the enemies to the sweet spot, the enemy-presence quote, the music) has no port yet; when it is ported its end must follow the script's ticks, never a fade |

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
`src/protocol/music.ts` reproduces the setters of §3.1 from simulation events (`sectorLoaded`, the enemy presence of an
untouched sector, `combatStarted`, `combatEnded {won|lost|lull|boxing}`, `preBattle`, `arBattleOver`, laptop open/close,
the meanwhile and endgame events; the full list as built is in §3.7) and the creature flag. The session keeps `presentation.music {mode, previous}` beside the
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

Stub sounds, music and speech blips are synthesized originals named like the original paths (§6.3 P0, §6.5), so the
cue tables and `music.json` resolve unchanged; one synthesized file serves many names through the stub alias manifest.
Missing files are skipped silently, as the original skips failed plays.

### 3.5 Deviations to log

- *Music track choice*: `Random(count)` on the gameplay generator → client PRNG (presentation).
- *Footstep variants*: the `Random` loop and `ubLastFootPrintSound` (`Tactical/Soldier_Control.cc:8853-8859`) → client
  presentation memory, no simulation draw (confirmed in S8: the simulation has no footstep code and never drew it).
- *Speech playback*: a speech sample is never cut by a simulation-side line end.
- *Ambient timing*: real-time gaps → playback-time gaps on the client.
- *Volume scaling*: `PlaySoldierJA2Sample`'s double scaling is kept (a faithful quirk, audible only as quieter soldier
  sounds; open question 4, decided: keep).

### 3.6 What landed (slice S8, 2026-10-18)

- **Content** (DOM-free, unit-tested): `src/content/formats/ambient.ts` (`.bad` tables: an `INT16` count and 116-byte
  entries `{minTime, maxTime, timeCategory, file[100], volume}`); `src/content/audio/sound-position.ts` (`SoundVolume`,
  `SoundDir`, `PositionSoundVolume`, the `(v·vol + 63)/127` scaling and the mixer's linear balance `vol·(127−pan)/127/128`);
  `cue.ts` (a cue is `{file, baseVolume, mix, bus, gridNo, pan, loops}`; the mix rule encodes how the original computes
  the channel volume and pan: `location` = `PlayLocationJA2Sample`, `soldier` = `PlaySoldierJA2Sample` with its double
  effects scaling, `fixed`, `panned` (misses: fixed volume, `SoundDir` pan), `voiceOwn`/`voiceOther` (battle sounds:
  speech volume, then `SoundVolume` for other teams), `creatureVoice`, `speech`, `ambient`, `music`, `positionLoop`);
  `cue-book.ts` (sound ids, battle sounds, weapon sounds with calibre defaults and reload/lock-and-load per weapon class,
  explosion candidates); `cues.ts` (footsteps, gunfire with burst names and the single-shot and `bursttype1` fallbacks,
  dry fire, reload, lock and load, impacts, misses, material hits, explosions, doors by kind, lock outcomes, door traps,
  drops, codes 700–798, laptop power); `battle-sound.ts` (substitutes for creatures, animals and the robot, the 2 s filter,
  the still-playing and talking rules, mute confirmations, low-morale variants, variants, the `_dying` and `m_`/`f_`
  fallbacks); `speech.ts` (the speech file of a text key, Russian `r_` prefix); `ambient-schedule.ts` (time windows, gaps,
  silence underground); `src/content/anim/timeline-follower.ts` (the script codes passed between two view snapshots of a
  soldier: within a state, across loops and into the next state, keeping the old tail only when it ends or jumps there
  within two frames).
- **Simulation and protocol** (optional fields, never state, never read back): `shotFired {item, silenced, burst, rounds}`
  (`rounds` is the burst size on the first bullet of a burst, 0 on the others, 1 for single shots); `bulletStopped
  {material, caveWall}` for structure hits; `explosion {animation}` (the water variant when shown); `doorChanged {kind:
  wood|cloth|garage|metal, noisy}` (`noisy` is the opener's door noise at code 495); a new `reloaded {soldier, item}`. The
  lock outcomes already were events (`doorResult`, `doorTrap`, `lockDestroyed`). Soldier views carry `voice` (the
  profile's voice id as three digits, I.M.P. voices included, or the generic `badN`/`kidN` set); `bodyType` was already
  there and gives the `m_`/`f_` fallback. `itemAttached` and `vehicleMoved` were not added: there is no attach command and
  no tactical vehicle movement yet. Sessions attach the events drained during an advance to the view frame of their tick
  (`ViewFrame.events`), so browser clients receive the event log too.
- **Audio layer** (`src/audio`, imports `content` and `protocol`): `engine.ts` (buses effects, speech, music, ambient into
  a master gain; 16 voices, a new one dropped when all are busy; two gains per voice for the linear balance, a splitter
  for stereo files; an LRU of 128 decoded buffers; our WAV decoder; lazy `/vfs` loads; missing and undecodable files
  counted and never refetched; nothing starts at master or channel volume 0; unlock on the first gesture);
  `director.ts` (frames, events and replayed codes → cues; per-soldier presentation memory: timeline position, last
  footstep variant, battle-sound memory and voice, death cry played, last weapon and attack kind; a speech queue; ambient
  scheduling; a client PRNG seeded from the session id; frames more than 100 ticks behind the newest applied one update
  the memory silently, so a skip or a manual advance does not replay its sounds); `positional.ts` (the listener from the
  client camera and view size, the queen's positional loop). `src/app/settings.ts` holds the client settings of §2.2
  that S8 needs (volumes, master, mute, speech, subtitles, mute confirmations) in `localStorage` under
  `ja2-node:settings`, version 1, and works without storage.
- **Pages**: the tactical page plays sound through the director, with a mute toggle and a master slider, OK on accepted
  move orders and ATTN on selecting another merc; `window.__ja2Audio` exposes the engine counters (`cuesResolved`,
  `voicesStarted`, `voicesDropped`, `voicesSilent`, `filesMissing`, `decodeErrors`), the director's statistics and the
  last played files. The strategic page plays the laptop power-up and power-down sounds.
- **Stubs**: `ambient/0.bad` for the stub tileset (invented entries) whose sounds alias the synthesized ambient classes;
  the stub walking, running, swatting and crawling scripts carry 703/704, the stance transitions 773–776, the pick-up
  scripts 777 (the simulation ignores these codes).
- **Checks**: on the user's data the tactical page decodes and plays original gunfire (PCM), bursts, misses, profile
  battle sounds (IMA ADPCM, `000_ok1`, `014_hit2`, the `014_dying` fallback), falls and stance sounds and the A9
  footsteps, with no missing files; the only ambient table of the data (`ambient/0.bad`, ten entries) decodes and names
  existing sounds. Not covered yet: see `deviations.md` "Sound coverage".


### 3.7 What landed (slice S9, 2026-10-18)

- **Modes and rules** (`src/protocol/music-modes.ts`, named constants with the SFI header): the twelve `MusicMode`
  values in the native byte order (`ContentMusic.h`), the `music.json` key of each playable mode, the creature variants
  of the nothing, enemy-present and battle modes, the end rules (`nextTrack`, the victory track `thenNothing`, the
  defeat track `thenSilence`), the 10 ms poll step and the fade steps 1 and 5.
- **`musicMode(prev, events, facts)`** (`src/protocol/music.ts`, pure): `setMusicMode` reproduces `SetMusicMode` (any
  set remembers the replaced mode as `previous`; `RESTORE` returns to it, but to the nothing mode after the victory or
  defeat track). The setters, in event order: `sectorLoaded` (the enemy presence of the load, then the entry rule
  `mode == ENEMYPRESENT ? hostiles == 0 : mode != BATTLE` → nothing with a fast fade, then the first helicopter drop's
  enemy-present mode), `enemyPresence`, `combatStarted`, a sighting in combat while no music plays, `combatEnded`
  (`lull`: enemy present; `lost`: enemy present after a battle, then defeat; `won`: enemy present after a battle, then
  victory if a fight took place and the last kill of a merc was no monster, nothing without a fight; `boxing`: nothing),
  `preBattle` (twice, as `PrepareForPreBattleInterface` and `InitPreBattleInterface` both set it; once for an automatic
  creature attack), `retreated` from the prebattle screen, `arBattleOver` (victory; defeat, surrender and capture),
  `laptopOpened` and `laptopClosed` (restore, or the laptop again before the first landing), a resolved `meanwhile`
  (menu, then with a loaded sector the entry rule as when the sector is reloaded), `meanwhileStarted` and the
  interrogation's `meanwhileEnded`, `queenKilled`, `creatureQueenKilled`, `squadMovedUpstairs`, `creatureAttack`,
  `mercsLeftSector` to the map screen (fast fade). The facts are read from the session after the events: the creature
  flag, combat, whether a sector is loaded, the hostiles of the loaded sector (`NumHostilesInSector`), the game start.
- **Simulation facts** (optional event fields, never read back): `sectorLoaded {hostiles, enemyPresence?, firstArrival?}`
  (the sector flow records whether `SetEnemyPresence` fired while loading through the new `SectorHooks.enemyPresence`,
  outside the game start and meanwhile scenes; later presence, as reinforcements arriving in an untouched sector, is an
  `enemyPresence {sector}` event), `creatureAttack {sector}` (the creature battle setup's town attack), `combatEnded
  {fought?, monsterKill?}`, `mercsLeftSector {mapScreen?}`. `turn.lastMercKill` ports `gLastMercTalkedAboutKilling`
  (the enemy killed by a merc's attack). The creature battle setup now sets `useCreatureMusic` as
  `PrepareCreaturesForBattle` does (the map's light colour has blue, creatures in the level, a town attack), and the
  simulation clears it at the moment the victory mode is set above ground (a fought tactical battle won without a monster
  as last kill, an autoresolve victory, the queens' deaths, the move upstairs), so native saves and ours carry the same
  flag; no oracle probe covers the flag, and the full compare still matches.
- **Session state.** `Session` (`src/server/session.ts`) keeps `music {mode, previous}` beside the simulation: a new
  campaign starts at none and follows the events of its creation when the session is built (the new game's laptop, now
  reported as `laptopOpened`, and the landing; the events are held for the next report, as before a save), a sandbox at
  enemy present or nothing (as entering a sector), a native import at the saved
  byte (`SaveLoadGame.cc:1827`) with the menu as previous (the load sets the menu first), a ja2-node load at the file's
  `presentation.music`. After every captured frame the drained events update it; `welcome` carries `music {mode,
  creature}` and frames carry it when the mode or the flag changes (`fastFade: true` on the frame of a fast change).
  `observe` and the simulation's own view carry no music. Saves write `presentation.music`.
- **Client player** (`src/audio/music.ts`): `show(music)` from the welcome and the frames; a new mode fades the playing
  track out by one volume step per `poll()` (the pages poll every 10 ms; five steps after a sector entry or exit) and then
  starts a track of the new mode at once at the music volume (no fade-in), chosen with the client PRNG (seeded from the
  session id); when a track ends the next random track of the mode follows, the victory track switches the player to the
  nothing mode (the server keeps the victory mode) and the defeat track ends in silence; the creature flag picks the
  creature tracks when a track starts; music volume 0 (or mute) stops the music and raising it starts it again, as
  `MusicSetVolume` does. `src/content/audio/music-table.ts` reads `music.json`. The tactical and strategic pages use it
  through `src/devtools/net/music.ts` (`window.__ja2Audio.music` and `window.__ja2Music`: server mode, player mode,
  current track, the tracks played).
- **Tests**: `src/protocol/music.test.ts` (every row of §3.1, the restore rule, the event order, the fast fade),
  `src/audio/music.test.ts` (fake audio graph: no fade-in, the fade steps, next track, victory and defeat ends, creature
  tracks, volume 0), `src/server/session-music.test.ts` (the sandbox into combat, a new campaign from the laptop to the
  landing, the mode through a save, a load into a new session and a load in place), `src/sim/campaign/creature-music.test.ts`
  (the flag's sets and clears), the native imports on the original data (`src/server/save-session.test.ts`) and
  `tests/e2e/music.spec.ts` (the tactical page on stubs starts the enemy-present track after the first gesture and
  switches to the battle track when combat starts).

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

**Credits** (`Credits.cc`): `interface/credits.sti` with blinking faces, the text from `binarydata/credits.edt` (rows
of 80 characters, `src/externalized/strings/EDT.h:61-65`, whose comment says 496 rows; the English Gold file has 248, and
row 0 is never read because the record counter is incremented before the first read) with inline `@` control codes for gaps, speed,
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

Before S10 the stub pack had no video. It gets one tiny Smacker file per sequence slot that matters for tests
(`intro/splashscreen.smk` is enough), written by a minimal encoder in `stubs/` that emits only what the decoder must
read anyway: a full palette, solid and void blocks, and an uncompressed or DPCM audio track of a generated tone. The
picture is an original title card ("ja2-node" on a plain background). The other names stay missing and are skipped,
which also exercises the missing-file path. If the encoder costs more than it is worth, the fallback is a fixture-only
file generated in the decoder's tests and no stub video at all (open question 9).

### 4.5 What landed (slice S10, 2026-10-18)

- **Decoder** `src/content/formats/smk.ts` (DOM-free, Node-free, no SFI header: Smacker is RAD's format, written from
  its public description, libsmacker neither read nor ported): `openSmk(bytes)` reads the 104-byte header, the frame
  size and type tables and the four Huffman trees (mono map, mono colours, full, type: 16-bit trees built from two 8-bit
  trees, with three escape leaves that return the three most recently decoded values, reset at every frame);
  `decodeAudio(video, track)` decodes every chunk of a track up front into an `Int16Array` per channel (Huffman DPCM
  with per-chunk trees, 8 and 16 bit, mono and stereo, wrap-around deltas; uncompressed 8/16-bit PCM copied); and
  `createFrameReader(video).nextFrame()` returns `{index, indices, palette, paletteChanged}` (the index buffer and the
  palette are reused across frames because void blocks keep the previous picture; copy them to keep them). Palette
  chunks (skip, copy from the previous palette, 6-bit colours scaled by `(c << 2) | (c >> 4)`) and the four block types
  (mono, full, void, solid, chained by the 64-entry run table) are covered. Ring frames, Y-interlaced and Y-doubled files,
  Bink audio and SMK4 are refused with a clear error: none of the eleven game files uses them (all SMK2, flags 0) and
  SMK4's extra full-block modes could not be checked against a sample. On the user's data every video decodes; the
  decoded audio is as long as the video to within one frame; a 640×480 frame decodes in 1.35 ms or less on average,
  2.5 ms at the 95th percentile and 8.7 ms at most (the first, full frames) in Node with a warm JIT, and the audio of the
  longest video (`throne_nomig`, 2 minutes) in about 0.4 s, so a Worker keeps up with 15 and 30 fps easily.
- **Stub video** (decision 9: the encoder took well under a day): `stubs/smk-encode.ts` writes SMK2 files with
  frequency-built Huffman trees (optionally using the escape leaves), all four block types chosen per 4×4 block
  (unchanged → void, one colour → solid, two → mono, else full), palette chunks with skip/copy/colour commands and a DPCM
  or raw audio track. `stubs/video.ts` draws the title card ("ja2-node" in a 5×7 pixel font of our own, a colour band
  whose ramp rotates through palette copies, a progress bar) and a two-note triangle chime, 30 frames at 15 fps,
  22.05 kHz 16-bit stereo compressed like the originals: `intro/splashscreen.smk`, about 40 KB, byte-identical every
  build. `stubs/build.test.ts` decodes it back to the source frames, palettes and samples.
- **Player** `src/app/video/` (browser): `player.ts` fetches `/vfs/intro/<name>.smk` whole (404 → `missing`, skipped),
  opens it in a module Worker (`decoder-worker.ts`, which decodes the audio up front and converts it to float), draws
  through `src/render/indexed-frame.ts` (WebGL2: an R8UI index texture and a 256×1 RGB palette texture, sampled with
  `texelFetch`; `app` may now import `render`) at the largest integer scale that fits the window, and plays the audio as
  one buffer on the audio engine's music bus (`AudioEngine.playBuffer`, full volume as the original's `MAXVOLUME`, under
  the master gain and mute) or on a plain `AudioContext` (`contextSound`). Frames are paced by the audio clock
  (`currentTime` since the buffer started); without a running audio context, with the master at 0 or with a silent
  video the wall clock paces instead. Each animation frame asks the Worker for the newest due frame; the Worker decodes
  every frame up to it and posts only that one, so late frames are decoded but never shown, as in `SmkSkipFrames`; the
  video ends when the frame after the last one is due (`pacing.ts`). `sequence-player.ts` covers the screen with a
  black, cursorless overlay and handles the keys of `Intro.cc`: Escape (key up) ends the sequence, Space (key up) or
  any mouse button (down) ends the current video.
- **Sequences** `src/app/video/sequences.ts`: the eleven names, `splashPlan` (the splash only, then the main menu; the
  TalonSoft logo is never played), `beginningPlan` (the four beginning videos, then the new game) and `endingPlan
  ({miguelAlive, skyriderAlive})` from `observe.ended.ending` (throne video by Miguel's death, the fly-by, the helicopter
  video by Skyrider's, then the credits). `sequenceEnabled` applies the client settings `playSplash` and `playIntro`
  (`src/app/settings.ts`, default on, still settings version 1); the ending is always played.
- **Credits**: `src/content/formats/credits.ts` parses a row's control codes like `GetNextCreditFromTextFile` (codes
  `D B S J C R T { }` separated by `,` and ended by `;`, the rest of a code skipped up to the next separator, numbers
  read like `sscanf("%u")`, colours truncated to 8 bits, unknown codes and justifications other than 0–2 reported and
  ignored, the section flags applied after the codes of the same row); all 248 rows of the English credits parse
  without unknown codes. `src/app/credits/` holds the roll (`roll.ts`: a row is read when the last node has risen
  `gapBeforeNextRow` pixels above the bottom less the original's 16-pixel overlap, nodes rise 1 px per scroll delay,
  the top node is dropped once off screen, the screen ends when the rows ran out and the last node left), a row feed
  that prefetches `GET /api/text?file=binarydata/credits.edt&row=N` from row 1 until the first 404, and a DOM scroller
  (Arial 12 px and bold 14 px in the 210-pixel column at x = 10 of a 640×480 stage, the `FONT_MCOLOR_*` indices mapped
  to approximate CSS colours). Escape (key up) ends the credits.
- **Page**: `src/devtools/video/` (in Vite and on the start page) plays the splash, the beginning, an ending variant
  (followed by the credits) and the credits alone, toggles `playSplash`/`playIntro`, lists the last results and exposes
  `window.__ja2Video` (`video.progress`, `video.sequences`, `credits`). `?autoplay=splash` plays the splash on load
  unless `playSplash` is off, as the launcher does since S11 (§8.4, after a click).
- **Checks**: on the user's data the page plays the splash with audio-clock pacing (474 of 486 frames shown in headless
  Chromium while taking screenshots), skips through the beginning with Space, a click and Escape, plays the ending with
  `throne_nomig`, `heli_flyby` and `heli_sky` and then scrolls the original credits; on stubs the e2e test
  (`tests/e2e/video.spec.ts`) plays the splash to the end (30 frames decoded), ends it with Escape, skips the four
  missing beginning videos and scrolls the stub credits.

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

### 6.1 What the stub pack has (2026-10-18, after slice S13 part A)

`pnpm stubs` (`stubs/build.ts`) writes 486 files (6.7 MB; 369 files and 4.8 MB after S7) to `dist/stubs`, mounted under
the `stubs/` VFS prefix with per-path fallbacks (`src/node/data-vfs.ts`, `readLayered`) and an alias manifest (§6.5):

| Area | Stub pack | Original (for scale) |
|---|---|---|
| Sector maps | 14 maps: the hand-made A9, A10, A10 b1, D5, N7, P3 and P3 b1, a village, a wilderness map and five kind maps (town, mine, cave, camp, airfield) behind 95 sector aliases of `stubs/maps/sector-kinds.json` (§6.6); every other sector loads the wilderness map (`src/content/strategic/sector-maps.ts`) | 256 surface sectors, 36 underground levels, alternate maps |
| Tileset | one tileset, 22 of 151 tile types filled (3 grounds, water, floor, wall, roof, barrel, door; since S13 a stone wall with windows, fences, sandbags, flat, slanted and high roofs, a cliff and its lip, rocks and the four item-graphic types) | every tileset of `ja2set.dat`, all types |
| Soldiers | 5 sheets (stand, walk, run, crouch, prone) × 8 directions for all 396 surfaces; an invented script for each of the 311 animation states; palettes | 396 surfaces per body |
| Structures | wall, barrel, door, stone wall and window, wooden and wire fence, sandbags, three roofs, cliff; 15 person and 83 corpse structure files | 1,442 JSD |
| Profiles | 44: A.I.M. 12 (ids 0–11), M.E.R.C. 1, R.P.C. 2, NPC 25 (since S13 Skyrider, five head miners and nine dealers), vehicles 4 | 159 slots: 40, 11, 18, 85, 4 |
| NPC scripts | 21 NPCs plus `000.npc` and two meanwhile sets; 23 NPC and 6 civilian EDTs | about 103 scripts, civilian and sector quote files, `miners.npc`, `d_NNN.edt` |
| Merc text | `mercedt/NNN.edt` for A.I.M. 0–11, M.E.R.C. 42 and R.P.C. 59 and 65: 117 invented quotes each | 1 EDT per merc |
| Other text | `binarydata/itemdesc.edt` (31 items the stub campaign and tests use), `credits.edt` (credit control codes), `email.edt` (the new-game mails, the I.M.P. and M.E.R.C. intros); no history, files, bios, alumni, flowers, help | `binarydata/*.edt` |
| Locks | 2 | `locks.bin` |
| Sounds | 90 synthesized cue classes (`synth/sfx`) behind all 343 sound paths of the tables and 42 battle voices for three body classes (`synth/battle`) behind the 90 generic voice paths (`m_`, `f_`, `bad0-2`, `bad7-8`, `kid0-1`); since S8 an ambient table `ambient/0.bad` for the stub tileset | 370 + 1,581 WAV, `ambient/*.bad` |
| Music | one chiptune loop (about 4 s) per track of `music.json`: 14 files under their own names | 14 tracks, up to two minutes |
| Speech | one IMA ADPCM blip and `.gap` per stub profile and family (`synth/speech`), behind every merc and NPC quote that has stub text: 1,133 speech names | 8,568 WAV, 8,353 `.gap` |
| Video | since S10 the splash `intro/splashscreen.smk` (a title card and a tone, 2 s, 40 KB, §4.5); the other ten names stay missing | 11 Smacker files, 70 MB |
| Fonts | since S13 two STI fonts (Stub Pixel 12 and 16 Bold, a Terminus subset) behind the 17 font names, and a stub glyph table `translation_tables/translation-table-stub.json` | `fonts.slf`, the glyph tables |
| Other media | none: no faces, item graphics, interface, laptop or map-screen art, radar maps, load screens, cursors | the other SLFs |

Items, weapons, dealers, the army and strategic tables come from `data/externalized` for every data version, so they
need no stubs. One defect surfaced during this inventory: `dialogueProfiles()`
(`src/content/strategic/laptop-content.ts:357`) probed `npcdata/` and `mercedt/` without the `stubs/` fallback (fixed
before S1; since S7 the stub A.I.M. and M.E.R.C. mercs have text files too).

### 6.2 What "a full game on stubs" means

The done criterion of every milestone is "also runs on stubs, CI only on stubs" (`01` §4.4). For M7 this becomes: **a
stub campaign can be played from the new game to the Queen's death through MCP and through the browser pages, with
sound, music, a splash video, saves, and text in both English and Russian UI**, and every M7 feature has stub content
that exercises it. It does **not** mean a stub replica of every sector or quest: the narrative content on stubs stays
the minimum that the tests and the stub campaign path need (`01` §11, "logic stubs are game design").

### 6.3 Missing pieces, by priority

**P0, needed by M7 features** (each is original work, generated by a script in `stubs/`, deterministic, PNG/WAV/JSON):

Items 1–4 landed in slice S7 (§6.5), item 5 in S10 (§4.5). The P1 items 6–9 landed in slice S13 part A (§6.6).

1. **Sounds** (`stubs/audio.ts`, done): one short synthesized WAV per cue class of §3.3 (footsteps by terrain class,
   gun classes and their silenced and burst variants, reload, punch and knife, hits, falls, explosions, doors open, close
   and locked, item pick-up and drop, UI clicks, the laptop beep), generated from noise and tone envelopes. The file
   names follow the original's paths (`sounds/…`, `battlesnds/…`) so the same cue table resolves on both; formats PCM 8
   and 16 bit and one IMA ADPCM file so the decoder paths are covered. Battle sounds: one generic set per body class
   instead of per profile.
2. **Music** (`stubs/music.ts`, done): one generated loop per mode of `music.json` (10 modes, a few seconds each, simple
   chiptune-like tones), named as in `music.json` so the table works unchanged.
3. **Speech** (`stubs/speech.ts`, done): one "blip" WAV per stub profile and quote family, plus a matching `.gap`
   file, so the speech and lip paths run; durations unrelated to text (the simulation never reads them).
4. **Merc and item text** (`stubs/text.ts`, done): `mercedt/NNN.edt` for the six stub A.I.M. profiles and the
   R.P.C.s (invented lines), and a stub `binarydata/itemdesc.edt` covering the items the stub campaign and tests use, so text keys, lengths and
   `/api/text` work and quote durations are non-zero; a stub `credits.edt` with the control codes of §4.1; stub
   `email.edt` rows for the mails a stub new game sends.
5. **Video**: the splash Smacker file of §4.4.

**P1, needed for the stub campaign path and wider test coverage:**

6. **Sector kinds** (done): a table `stubs/maps/sector-kinds.json` mapping each sector to a generic stub map by kind (town,
   mine with its underground levels, SAM site, airport, prison, palace, lair, wilderness), each with the placements,
   exits, facilities and edgepoints the strategic layer expects, so towns train militia, mines produce, SAM sites can be
   taken and Skyrider's base works without a hand-made map per sector.
7. **Profiles** (done): at least 12 A.I.M. profiles (a full squad plus refusals and relationships), the four vehicle profiles
   (the helicopter and ground vehicles read them), and the NPCs the stub campaign path meets (Skyrider and one dealer
   per stub town).
8. **Tile types** (done): windows, fences, sandbags, slanted and high roofs, cliffs, debris and item tiles in the stub tileset,
   so combat tests cover cover, fence hops, window shots and climbing on stubs.
9. **Font** (done): a rasterized free pixel font with Latin and Cyrillic (OFL or CC0; candidates to check: Terminus, unscii)
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

### 6.5 What landed (slice S7, 2026-10-18)

- **Decoders**: `src/content/formats/wav.ts` (RIFF/WAVE: PCM 8/16-bit mono and stereo, IMA ADPCM 0x11 with any block
  align, frame count from `fact` or the data size; unknown chunks skipped, junk after `data` ignored, an oversized `data`
  clamped; other tags and depths fail with a clear error) and `src/content/formats/gap.ts` (pairs, `PollAudioGap`). On
  the user's data every WAV of `sounds.slf` (370 PCM), `battlesnds.slf` (67 PCM, 1,514 IMA ADPCM) and `music.slf` (14)
  decodes, a sample of the speech decodes and all 8,353 `.gap` files hold whole pairs (`wav-original.test.ts`).
- **Tables** (`tools/transcribe/sound-effects.ts`): `data/tables/sound-effects.json` (291 ids, 237 paths, 14 ambient
  sounds, pans, volumes, `SOUND_FAR_VOLUME_MOD`, and the 25 sound paths the game code names literally, such as
  `sounds/weapons/bursttype1.wav` and `laptop/static*.wav`) and `data/tables/battle-sounds.json` (17 kinds, the 2 s
  filter, the morale threshold 35). `src/content/audio/sound-table.ts` loads them and lists the generic voice sets
  (`m`, `f`, `bad0-2`, `bad7-8`, `kid0-1`, from `Soldier_Control.cc` and `Soldier_Create.cc`), the voice paths and the
  sound paths of `weapons.json`, `calibres.json`, `explosion-animations.json` and `vehicles.json` with `%d` bursts
  expanded to the largest burst (6). The cue rules stay for S8.
- **Original names on stubs**: many original names share one synthesized file through `aliases.json` at the stub root
  (`src/content/vfs/aliases.ts`); the stub layer lists each alias as a file that reads its target, real files win, an
  alias to a missing file fails the mount. `GET /vfs/<path>` falls back to `stubs/<path>` when the data version is
  `stubs`, so a client asks for `sounds/door open 01.wav` or `speech/000_108.wav` on both data sets (the same holds for
  every stub file); with the original data nothing changes.
- **Formats**: PCM 8-bit 11.025 kHz mono (most effects, bursts, music), PCM 16-bit 22.05 kHz mono (single shots) and
  stereo (the big explosion), IMA ADPCM 11.025 kHz mono with 256-byte blocks (battle voices, speech), written by
  `stubs/wav-encode.ts`. Synthesis (`stubs/synth.ts`) uses its own xorshift generator seeded from the file's class name;
  the build is byte-identical every time and takes about 0.2 s for the media.
- **Size**: the media add 193 files and about 2.4 MB (sounds 0.65 MB, battle voices and blips 0.14 MB, music
  0.59 MB, merc EDTs 0.5 MB, the other EDTs 0.36 MB, the alias manifest 0.15 MB); `stubs/build.test.ts` keeps them
  under 4 MB.
- **Consequences**: on stubs merc quotes now have text, so `mercQuote` events are emitted and the speaker's face is busy
  for 60 ms per character, and `dialogueProfiles` marks the stub mercs as having text; no stub scenario, server or e2e
  expectation depended on the silent quotes (scenario tests supply their own quote lengths). Original-data behaviour is
  untouched: stub files are read only on the stub data version.

### 6.6 What landed (slice S13 part A, 2026-10-18)

- **Sector kinds** (`stubs/maps/sector-kinds.json`, `stubs/sector-kinds.ts`): every sector the strategic tables name
  gets a kind and a map: town (22 town sectors) and prison (I13, J9) on `town`, mine entrances (B2, D4, D13, H3, H8,
  I14) on `mine`, the 17 mine levels, 13 lair levels and 4 cellars on `cave`, the 4 SAM sites and 22 garrison sectors
  (the roads to Meduna, the roadblocks) on `camp`, the airport B13 and Skyrider's four alternate maps (`B15_a`, `C16_a`,
  `D12_a`, `E14_a`) on `airfield`, the palace on the hand-made `p3`; A9, A10, A10 b1, D5, N7 and P3 b1 keep their
  hand-made maps, everything else loads the wilderness map. The build checks the table (sector names, no sector twice,
  every map compiled, no kind over a hand-made map) and turns each listed sector into an alias of its kind's map in
  `aliases.json`, so `sectorMapPath` finds `stubs/world/maps/d13.dat` without a code change and original maps still win;
  `stubs/sector-kinds.test.ts` checks the table against `strategic-map-towns.json`, `strategic-mines.json`, the SAM
  sites, the garrison groups, the underground sectors, the creature lairs and Skyrider's placements.
- **Kind maps** (`stubs/maps/{town,mine,cave,camp,airfield}.map.txt`, 0.23 MB each compiled): sealed rooms of stone
  walls with windows, closed doors and flat climbable roofs. Town: a shop with a placement for each of the nine stub
  dealers (only the one whose profile lives in the loaded sector appears), two houses, a jail whose three locked cells
  hold the Alma captive gridnos 9208, 9688 and 9215 (`merc-fate.ts`). Mine: the head miner's office with a placement
  per head miner, a shaft house whose exit grid leads down, a settling pond, a cliff ridge. Cave: tunnels in cliff rock
  with 12 creature slots, a creature-queen slot (body 10), four miners and a ladder up. Camp: barracks, a store and a
  launcher inside low and high sandbags. Airfield: a hangar, a shed, a wooden fence and a helipad around Skyrider's
  arrival gridno 8842 with his placement 4 tiles from it. Every surface map has the four entry points (edgepoints are
  generated, `edgepoints.ts`) and at least 20 enemy slots, the largest garrisons of the compositions; the NPC
  placements carry a `STAYINSECTOR` schedule (an unscheduled civilian gets the default come-and-go schedule,
  `Scheduling.cc:917-955`). The hand-made P3 gains 32 elite slots for `QUEEN_DEFENCE` and N7 20 for `LEVEL1_DEFENCE`
  (before, their garrisons were counted in battle without a slot).
- **Same-sector exits**: the stub map format accepts `exit: x y -> here z=<level> at X Y`, written as sector 0,0;
  `withSectorExitGrids` (`src/content/strategic/sector-maps.ts`, called by `loadTacticalWorldInputs`) resolves it to the
  sector named by the map file, so one mine map leads down from every mine and one cave ladder up to the surface above
  (stub underground levels connect only to the surface above them, so the levels below a mine's first have no way in
  on stubs). An original map never holds sector 0,0, so original data is unaffected.
- **Profiles** (`stubs/profiles.json`, 44): A.I.M. 6–11 join 0–5 (twelve), with their own hiring rules: Lasko hates
  Vant (refuses once Vant has arrived, joins with the buddy quote when her buddy Hollis is on the team), Puig refuses
  after any merc death (`deathRate` 0), Marlow refuses at any bad reputation (`reputationTolerance` 0), Voss and Arden
  are buddies, Voss learns to hate Kestrel, Arden learns to like Moraga. The four vehicle profiles 160–163, Skyrider
  (97), the head miners Fred, Matt (in I14, town 3), Oswald, Calvin and Carl (106, 148, 156, 157, 158) and one dealer per
  town (Keith 147 in C13, Franz 124 in C5, Jake 113 in H13, Howard 125 in G9, Sam 126 in G2, Fredo 130 in L12, Herve
  151 in A2, Peter 152 in I6, Carlo 154 in N5) are invented characters on the original profile ids, so the dealer,
  head-miner and helicopter code finds them. A default stub squad is now hired from all twelve (`STUB_SQUAD_PROFILES`),
  since `StartSomeMercsOnAssignment` sends some away at a new game.
- **Scripts and text** (`stubs/npc/records.json`, `stubs/npc/text.json`, `stubs/text/merc-quotes.json`): Skyrider asks
  to be escorted (`ASK_ABOUT_ESCORTING_EPC`), his record 15 at the Drassen helipad ends `ESCORT_SKYRIDER` and releases
  him (`UN_RECRUIT_EPC`), after which the arrival rule sets up the helicopter; a head miner's first line starts his mine
  (`START_MINE`) and his EDT holds the strategic quote numbers of `head-miners.json`; the dealers greet and chat. The
  S7 generators add the merc EDTs of 6–11 and a speech blip per new speaker.
- **Tile types** (`stubs/tiles.ts`): SECONDWALL (stone wall, armour 11, windows that shatter to an open partner),
  FENCESTRUCT (a wooden fence that can be hopped, a see-through wire fence with a cut partner), SECONDOSTRUCT (low
  sandbags that can be hopped, high ones that cannot), SECONDROOF (`NORMAL_ROOF`, climbable), FIRSTSLANTROOF and
  FIRSTHIGHROOF, FIRSTCLIFF with its lip FIRSTCLIFFHANG, DEBRISROCKS and the ground graphics GUNS, P1ITEMS, P2ITEMS,
  P3ITEMS with every `tileGraphic` of the item tables; a tile yard east of the village exercises each family
  (`src/sim/tactical/stub-tiles.test.ts`: fence and sandbag hops, sandbag cover, sight and fire through a window and a
  shot that shatters it, a roof climb, the cliff, debris, an item tile). Window climbing (a Stracciatella addition) and
  wire cutting are not ported; the cut fence pieces exist in the data.
- **Font** (`stubs/fonts.ts`, `stubs/font/`): two bitmap fonts from a subset of Terminus Font 4.49.1 (SIL OFL 1.1,
  © 2020 Dimitar Toshkov Zhekov), renamed Stub Pixel 12 and Stub Pixel 16 Bold because of the licence's Reserved Font
  Name; the subset (222 characters, about 16 KB of glyph text) sits next to `OFL.txt` and `NOTICE.txt` (source URL,
  version, hash, changes) and is regenerated with `tools/stub-font-subset.ts`. The build writes `fonts/stub-pixel-12.sti`
  and `fonts/stub-pixel-16b.sti` (8-bit indexed, ETRLE, 230 glyphs each, value 1 shadow and 2 ink as the original's
  mono-shadow blitter expects), points the 17 font names of `Utils/Font_Control.cc:37-52` at them through `aliases.json`,
  and writes `translation_tables/translation-table-stub.json` in Stracciatella's shape: the English table's glyph
  numbers plus lowercase Cyrillic, Ь and `` ` ~ « » – — … № `` (parsed by `src/content/text/glyph-table.ts`). The
  licence and notice travel with the pack. Drawing comes in M8.
- **Size**: the pack grows from 369 files and 4.79 MB to 486 files and 6.71 MB (+1.92 MB): kind maps 1.17 MB, the
  tileset 34 KB, merc EDTs 0.34 MB, NPC EDTs and scripts 0.12 MB, speech blips 64 KB, fonts 57 KB, the alias manifest
  0.1 MB, profiles 26 KB; the repository gains about 0.3 MB of sources (the profile JSON, the maps, the font subset).
  Every new family has a round trip in `stubs/build.test.ts` (fonts, tileset and structure files, maps and sector
  aliases, profiles with their text) and the build stays byte-identical.
- **Tests**: `stubs/sector-kinds.test.ts`, `stubs/fonts.test.ts`, `stubs/tiles.test.ts`,
  `src/sim/tactical/stub-tiles.test.ts`, the roster's refusals in `laptop.test.ts`, and a campaign scenario
  (`src/server/sector-kinds-stub.test.ts`, plain and reload mode) that liberates D13, talks Fred into starting the mine,
  collects the next income, trains militia there, takes the SAM site D15, opens Keith's shop in C13 and escorts Skyrider
  from his farm to the Drassen helipad until his helicopter is set up.
- **Consequences** (expectations changed, each explained by the new content): the A.I.M. list of a stub laptop and the
  stub merc EDTs list ids 0–11 (`laptop.test.ts`, `build.test.ts`); the stub sector kit resolves aliased sector maps
  (`tests/support/sectors.ts`); a stub campaign whose squad passes a town, mine, SAM, garrison or airfield sector now
  loads that kind's map with its garrison slots instead of the wilderness map with six; six more A.I.M. profiles draw
  more rolls in `StartSomeMercsOnAssignment` and the daily availability update, so stub campaigns shift with the seed
  (no stub test depended on it). Original-data behaviour is unchanged: the whole suite with the user's data, the oracle
  compare and the reload mode pass as before.
- **Live check** (MCP on stubs): a campaign with six stub A.I.M. mercs (`mercs: 6`) lands in A9, leaves by the east
  edge, travels B10–C12 (a patrol in B11 autoresolved) and takes the stub town C13 in a tactical battle fought through
  `act`/`advance` on `stubs/world/maps/c13.dat`; a second campaign travels through San Mona (C6, C5 on the town map,
  Franz seen as a `buySell` merchant and his shop opened), D5, and the mine D4, down the shaft to `d4_b1.dat` (cave) and
  up the ladder. Mine income, militia training and the SAM site need won tactical battles through MCP (player-initiated
  attacks cannot be autoresolved, `PreBattle_Interface.cc:450-455`), which a scripted bot without cover or focus fire
  lost at D13; the scenario test covers them through the same commands.
- **For part B** (the end-to-end stub campaign; what landed is §6.7): a battle policy that wins Drassen with Glock-armed
  mercs (cover, focus fire, retreat and heal) or better weapons; Tony in A10 sells rifles (once his stock has them), and
  the inventory commands (`04` §6.24) now put a bought weapon in the hand and bandage the wounded; Drassen's loyalty
  after C13 alone refuses militia training (`loyaltyTooLow`); findings 19 (no step needed after `closeTalk` any more)
  and 20 (the A9 stall) are fixed; the palace garrison (32 elites) must be fought before the Queen runs to P3 b1; the
  creature lairs have no way in on stubs, so a sci-fi stub campaign whose creatures invade a mine cannot reach their
  queen (keep sci-fi off or add a way down).

### 6.7 What landed (slice S13 part B, 2026-10-18)

- **The campaign bot** (`tools/campaign-bot/`, `pnpm cli campaign [--seed N] [--server URL --token T | --port N]
  [--verbose] [--trace] [--stop-after STEP] [--no-reload]`): a scripted player that uses the MCP tools alone
  (`newSession`, `status`, `observe`, `act`, `advance`, `save`, `load`, and `deleteSave` to clean up) over Streamable
  HTTP with the SDK client (`mcp-game.ts`). It decides from the observation only, with no clock and no randomness, so a
  seed plays the same campaign every time. Without `--server` it builds the stub pack, starts its own stub server
  (`src/server/main.ts` with an empty `JA2_DATA_DIR`, `--port` or a free port, a random token and a temporary save
  folder, `stub-server.ts`), stops it by its handle at the end and prints one JSON line: seed, outcome (`won`, `lost`,
  `stuck`, `stopped`), the step and reason, days, battles, battles won, rounds, mercs lost, enemies killed, the reloads
  and the seconds; the exit code is 0 for a won campaign.
- **Steps** (`campaign.ts`): hire six A.I.M. mercs through the laptop (`aimQuote`, then `aimHire` with the kit; a
  preference list, two medics, never Lasko with Vant), land in A9 and win the landing battle, outfit from Omerta's
  stash, liberate the Drassen airport, town, mine and SAM site (B13, C13, D13, D15), talk Fred into starting the mine,
  order medical supplies from Bobby Ray (what is in stock), buy armour and first-aid kits at Keith's, rest and heal,
  find Skyrider at his farm, take him along (a guard joins the escort's squad) and walk him to the helipad until the
  helicopter is set up, train militia in C13, collect the delivery, recruit for up to six days (twelve hours at a time)
  from A.I.M. and M.E.R.C. (Speck's mail, the account, the bills paid) up to twelve mercs, march F11, J11, L8, L3 with
  an outfit and a rest at each stop, attack M3, N3 and O3 (falling back to the previous sector after two casualties, up
  to six attacks each), storm P3 to the stairs (`palace.ts`), go down to P3 b1, kill the Queen and advance through the
  ending until `observe.ended`.
- **Battle policy** (`battle.ts`, `retreat.ts`, `first-aid.ts`, `gear.ts`): in turns every merc readies his hand
  (reload, or the best gun he has ammunition for), scores each hostile in sight with `estimateAttack` (chance to hit ×
  chance to get through, aim clicks from the spare APs, a bonus for a target already hit: focus fire) and fires above a
  threshold; otherwise he bandages himself when bleeding (and goes on bandaging over the next turns), holds (back within
  six tiles of the squad's centre, prone: cover by stance) or, after rounds without our shots, pushes in swat mode
  toward the nearest known enemy or the objective; `endTurn` after the passes. In real time the medics stop the
  bleeding, tired mercs catch their breath, then the squad seeks the last seen enemy, the objective, a heard noise or
  sweep points; a sector that still counts enemies nobody finds is waited on (stragglers) and then reported as `stuck`.
  A won battle bandages every wounded merc. A retreat leaves by the edge the squad came in (`exitSector` per merc) or
  runs back to the start tiles when half the squad is down and outnumbered, or after the casualty limit of an assault.
  Outfitting (`outfit.ts`) goes through `inventory` and `moveItem` on the map screen: the best gun with fitting
  magazines (four), the best vest, helmet and leggings, medical kits for the medics and a first-aid kit for everyone.
  Healing (`heal.ts`): a merc with a medical kit doctors, the hurt are patients, the others sleep, in three-hour slices
  until healed and rested, then everyone back on a squad (the next one when the first is full).
- **Prompts** (`prompts.ts`): pre-battle enter the sector (autoresolve only when entering is not allowed, retreat last),
  a surrender offer rejected, contract renewals for a week while affordable, militia payments when affordable, escort
  requests accepted, simultaneous arrivals coordinated.
- **Stub content changed for the path** (game design; each commit says why): role kits instead of one Glock each
  (`d29b889`: riflemen with a MINI14, G41 or M14 and three AP magazines, two with grenades, medics with an MP5K and a
  medical kit, a first-aid kit for all) and armour on them (`7a694f3`: Kevlar vest and steel helmet for riflemen, flak
  jacket and steel helmet for medics and the SMG gunner) and a Glock sidearm with two CLIP9_15 (`d293cbb`, which the A10
  stub NPC's give script and the give and talk e2e scenarios use; the last gun of a profile's kit sets its gun
  attractiveness, `Tactical/Soldier_Profile.cc:189-199`, so the stub mercs now measure their weapons against a Glock);
  the palace laid out so that a squad can fight its way to the stairs (`eae738e`: a west wing over the stairs with the
  six priority elites, the optional elites in a keep far to the south-east, Derek and Oliver in the gatehouse); town and
  camp garrisons at four posts of five instead of one block (`0f8b425`); the seven unjam animations end by resuming the
  shot (`ad43739`, finding 26); twenty enemy slots on the wilderness map instead of six (`6a1bd6d`, finding 27).
- **Fixes in the simulation** (each with a regression test; the oracle compare is unchanged): `enterSector` on the
  loaded sector switches to the tactical flow (finding 23, `51b2e82`); a hit whose animation cannot start releases its
  busy count (finding 24, `de21ae7`, deviation "Hit during a non-interruptible animation"); a suppression stance change
  chained to the previous one plays out (finding 25, `ae51fe2`, deviation "Suppression stance change from the end of the
  previous one"); the renewal of a merc who cannot be let go ends (finding 28, `4bf88a5`, deviation "Renewal of a merc
  who cannot leave").
- **Reload checks** (`reload.ts`): *exact load*: in the first battle that reaches round 2 the bot saves
  (`campaign-bot-battle`), loads that save with `reseed: false` into a new session and from then on sends every
  `observe`, `act` and `advance` to both sessions until the battle ends, comparing the views (without `language` and
  `dataVersion`) and the advance reports (without the `gameSaved`/`gameLoaded` events); the summary lists the steps
  compared and the differences, and the battle is finished in the loaded session, which the campaign then plays on.
  *Player load*: after the Drassen mine the bot saves (`campaign-bot-player`), loads with `reseed: true` into a new
  session and plays on there.
- **e2e** (`tests/e2e/campaign.spec.ts`, 90 s budget): the bot against the e2e stub server through MCP, seed 3, up to
  the end of the landing battle with the exact load at round 2: the battle is won with no merc lost, the mirrored
  session shows no difference over more than 20 compared steps, the campaign continues in the loaded session and A9 is
  player controlled with no enemies.
- **Results** (2026-10-18, easy, no sci-fi, at `d293cbb`). `pnpm cli campaign --seed N` (exact load in battle 1 round 2,
  player load after the Drassen mine; one run each):

  | Seed | Outcome | Where | Day | Battles (won) | Mercs lost | Enemies killed | Exact load (steps, differences) | Seconds |
  |---|---|---|---|---|---|---|---|---|
  | 1 | lost | the march, at L8 | 12 | 16 (15) | 10 | 55 | 616, 0 | 113 |
  | 2 | lost | the fourth attack on M3 | 15 | 22 (18) | 9 | 92 | 476, 0 | 190 |
  | 3 | stuck | the fifth attack on M3: nobody left to find while M3 still counts enemies (findings 27, 31) | 15 | 23 (18) | 4 | 80 | 325, 0 | 310 |
  | 4 | lost | the march, at L8 | 12 | 19 (18) | 10 | 82 | 232, 0 | 112 |

  Every exact load matched its original session over the rest of its battle. The player load reseeds with the server's
  entropy (§1.5), so a run after it is not reproducible; earlier runs at `2457d02` met findings 32–34 that way. Without
  reloads a seed always plays the same campaign, the same through MCP (`--no-reload`, checked with seed 3 at `9b81f99`:
  identical summaries) as in process. Without reloads at `d293cbb`: seed 1 lost its squad on the march at L8 (day 12,
  19 battles, 18 won, 8 mercs lost, 83 enemies killed), seed 2 reached L3 with three mercs and lost the fourth attack
  on M3 (day 15, 21 battles, 17 won, 9 lost, 77 killed), seed 3 lost on the march at L8 (day 12, 16 battles, 15 won),
  seed 4 lost at M3 (day 13, 19 battles, 18 won, 10 lost, 84 killed); with the kit before the sidearm (`9b81f99`) seed 3
  took M3 and lost the third attack on N3.
- **Not reached**: the Queen. Drassen, the mine, Skyrider, militia and recruiting work on every seed; the squads are
  worn down on the march and by the Meduna outskirts (finding 31). The endgame steps (`palace.ts`: storm P3 to the
  stairs, `exitSector` down, kill the Queen, play the ending until `observe.ended`) were played in process with mercs
  placed in O3 during this slice and reached the victory; through a full campaign they were not reached.

---

## 7. Performance

### 7.1 What is known

- **Enemy turns** (M3, `04` §4.5): on A9 with the instant driver, 1–90 ms for 4 soldiers and 2 civilians, typically
  100–250 ms (up to 370 ms) for 16 soldiers; AI decisions (cover search, paths, sight) dominate, ticks without decisions
  are almost free.
- **Measured 2026-10-18** (S4, `pnpm cli bench … --runs 3`, each variant in a fresh process after an untimed warm-up
  run; machine: AMD EPYC 9354, KVM guest, `nproc` 8 with one thread per core, 15 GiB, Node 24.22.0; 1-minute load 1–2.5
  from other work during the runs). Original data first, stubs in brackets; p50 / p95 / max unless stated.
  - *Enemy turn* (ms per enemy side turn, every AI team): arena with 8 enemies 34 / 125 / 161 (42 / 141 / 172), 16
    enemies 197 / 371 / 371 (166 / 204 / 204), 32 enemies with six militia 352 / 1,282 / 1,282 (437 / 1,071 / 1,071); A9
    with 4 soldiers 29 / 157 / 191, 16 soldiers 64 / 254 / 429 (36 turns), 32 soldiers 484 / 766 / 766; the D13 save 31 /
    38 / 38. A 16-enemy turn on the arena takes 4,227 ticks at the median (21 s of game time); per enemy turn (`--calls`,
    counted over the whole scripted run) 46 AI decisions, 115 path searches, 1,275 LOS tests, 2,045 sight checks, 14.8 cover searches over 1,168 tiles and 26,988
    chance-to-get-through traces. Top frames (`--profile`, original arena with 16): `calcChanceToGetThrough` 13.6 %, the
    grenade physics of the AI's throw planning (`integrate`, `checkForCollisions`, `simulateObject`, `handleCollisions`)
    22.5 %, the path search's `expand` 7.7 %, garbage collection 5.4 %.
  - *Real-time tick* (µs, mean / p99 / max): 20 soldiers green 5.0 / 57 / 4,748 (5.7 / 67 / 4,198), yellow 9.7 / 79 /
    4,859 (11 / 109 / 5,084); 40 soldiers green 20 / 143 / 9,684 (44 / 232 / 27,010), yellow 20 / 223 / 6,343 (19 / 210 /
    6,629); 64 soldiers green 35 / 355 / 10,346 (69 / 569 / 21,784), yellow 46 / 549 / 13,193 (47 / 583 / 8,801). The
    median tick costs 1–3.5 µs; the cost sits in single ticks where one AI decision runs several path searches
    (`expand`, `findBestPath`, `remaining` together about 50 % with 64 soldiers on stubs, `lineOfSightTest` 11 %). No combat
    started in any variant.
  - *Strategic world day* (ms, one merc): 7 days 70 / 83 / 87 (73 / 88 / 100), 30 days 66 / 80 / 92 (67 / 83 / 104), with
    the Queen's attacks 76 / 87 / 96 and 70 / 92 / 112 (78 / 87 / 87 and 71 / 86 / 97). Of each day, 43–48 ms go to the
    session building the player view for the about 470 frames of a day (§14, finding 11); the simulation itself handles 1,230
    strategic events, 250 group arrivals and 2.3 Queen evaluations a day. With six mercs a day took 120–145 ms (stubs).
  - *Autoresolve* (ms per battle): 10 per side 0.51 / 0.72 / 0.83 (0.44 / 1.06 / 5.5), 20 per side 1.28 / 1.93 / 2.02
    (1.20 / 2.34 / 13.4), 40 per side (20 mercs and 20 militia against 32) 1.71 / 3.33 / 11.8 (2.11 / 2.76 / 13.8); about
    30 one-second slices per battle.
  - *Server* (4 s windows): the event-loop stall, the longest delay seen, equals the longest instant enemy turn: 322 ms
    (230) with one viewer and one battle, 308 ms (247) with four viewers and one battle, 1,240 ms (829) with sixteen
    viewers and four battles; `monitorEventLoopDelay`'s p99 stays at 1.5–1.8 ms with one battle (a stall is one sample) and
    reaches 1,190 ms with four. A frame diff costs 0.02–0.04 ms at p95 and building the view 0.05–0.07 ms; a real-time
    viewer of the 20-soldier patrol receives 13–20 KB/s at ×1, an instant battle sends 0.34–0.65 MB/s in bursts; the
    instant turn's round trip is 100–116 ms at the median alone and 318–748 ms with four battles.
  - *Campaign* (shortened: new campaign, landing, first sector cleared): 2.19 s (3.09 s), of which the landing with
    content loading 0.44 s; peak RSS 319 MB (286 MB).
- **After S12a** (2026-10-18; `bench … --runs 3`, the parent commit `545957d` and the slice measured back to back per
  scenario and source, 1-minute load 1.3–6; original data first, stubs in brackets, p50 / p95 in ms, before → after).
  Every optimization keeps the outcomes: the same counters in every bench line, byte-identical frames and event logs
  (hashed), the oracle compare unchanged; the exception is the `gunRange` fix of finding 12, which changes the stub
  arenas' battles (the original-data runs did the same work).
  - *Strategic world day*: one merc 7 days 79 / 103 → 37 / 44 (83 / 109 → 39 / 48), 30 days 79 / 92 → 32 / 41
    (81 / 99 → 34 / 45), with the Queen's attacks 87 / 100 → 40 / 51 and 80 / 97 → 36 / 46 (98 / 110 → 48 / 60 and 84 /
    97 → 37 / 44); six mercs (new variant `7d-mercs6`) 157 / 190 → 43 / 48 (170 / 205 → 48 / 60), the before measured
    separately at a load of 6. Finding 11.
  - *Enemy turn*: arena with 8 enemies 44 / 130 → 41 / 98, 16 enemies 197 / 393 → 131 / 274, 32 enemies with six
    militia 587 / 1,327 → 450 / 998; A9 with 4 soldiers 34 / 158 → 31 / 152, 16 soldiers 62 / 267 → 59 / 258, 32
    soldiers 500 / 789 → 484 / 677; the D13 save 31 / 36 → 22 / 30. Stubs: 8 enemies 83 / 144 → 52 / 86 (the same work),
    16 and 32 enemies 165 / 217 → 117 / 187 and 400 / 1,059 → 264 / 687 (different battles after the fix). Per 16-enemy
    turn (`--calls`) the chance-to-get-through traces drop from 24,948 to 17,531 (an occupied cover position is traced
    once for all three stances), and the AI's throw planning from 23 % to 6 % of the profile (the collision-free force
    searches are remembered); the top frames are now the cover search's traces (47 % of the 32-enemy profile, with
    `calcChanceToGetThrough` itself at 28 % self time) and the path search (14 %). In one process, `arena-e16` after five `arena-e8` battles is no longer
    three times slower (finding 12).
  - *Save* (snapshot, stringify and gzip): the largest native import 122 / 221 → 102 / 186 (snapshot 60 → 46 and
    stringify and gzip 63 → 54 at the median; the p95 is the first save, which builds the content index and the text
    identity), a landed campaign 69 / 181 → 69 / 148, the 64-soldier arena 48 / 57 → 39 / 52 (40 / 72 → 38 / 60 and
    37 / 45 → 35 / 41); with the save clock pinned (the bench's runs now do the same work) the import measured 99 / 159.
    Load (parse and restore with fresh content): the import 199 / 283 → 184 / 243, a landed campaign 161 / 233 → 160 /
    233. The same import measured 400 ms at the median earlier the same day at a load below 1: the KVM guest's
    throughput varies by more than the load average shows, so only back-to-back runs compare.
  - *Real-time tick*: unchanged (mean 5–46 µs, worst tick 5–28 ms); item 5 of S12a found nothing to take for free.
- **Plans on record**: a visibility cache and moving the simulation to a worker (`01` §11), sessions in
  `worker_threads` when instant runs start delaying network I/O (`04` §5.9), 60 FPS at 1920×1080 for the tactical view
  (`01` §5.1).
- **Constraints**: the simulation layers may not read clocks (`01` §3.2), so all timing is taken outside `sim`; the
  original data may not be committed, so baselines measured on it stay local.

### 7.2 Measure first: the benchmark suite

`pnpm cli bench <scenario|all> [--data DIR] [--seed N] [--runs N] [--variant NAME] [--profile] [--calls] [--out FILE]
[--save-baseline]` (`tools/bench/`, slice S4). Every scenario is a fixed seed plus a scripted command list, so a rerun
does exactly the same work (the same ticks, shots and deaths, checked run against run); only machine noise varies. No
scenario needs the native oracle. Each variant prints one JSON line on stdout and a summary on stderr: `scenario`,
`variant`, `source` (`stubs` or `original`), `seed`, `runs`, `warmup`, `load` (the 1-minute load average before and
after, to spot a busy machine), the primary metric (`metric`, `unit`, `n`, `mean`, `p50`, `p95`, `p99`, `max`),
`target` with its sanity bound, `series` (secondary metrics as distributions), `counters` (counted from the event stream
and the state), `calls` and `callsPerSample` with `--calls`, `info` (battle outcome, early stops) and `deterministic`:
the runs' work signatures (turns, ticks, shots, hits, deaths; alert states; strategic events; autoresolve slices) must be
equal, otherwise the line is flagged and the command fails, since shared mutable state would make the numbers
meaningless. `--runs N` (default 3) repeats each variant from a fresh setup; with two or more an untimed warm-up run
comes first. `--profile` runs the variant once more under the V8 sampling profiler, writes `.cache/bench/<scenario>-<variant>-<source>.cpuprofile` (Chrome
DevTools) and prints the hottest self-time frames. Every variant runs in its own child process (the parent collects the
lines), so variants cannot influence each other: in one process, four 8-enemy battles made the following 16-enemy arena
three times slower (§14, finding 12). Each scenario has its own default seed (`enemy-turn` and `server` 2,
`campaign` 7, the rest 1, chosen so the stub runs avoid the stalls of §14); `--seed` overrides them all. `--data`
defaults to `$JA2_DATA_DIR`; `--data ''` forces stubs.

| Scenario | What it does | Measures |
|---|---|---|
| `enemy-turn` | turn-based battle through a `Session` with the instant driver's semantics (dispatch, then advance to idle, here with a 50,000-tick budget so a stall is reported instead of spinning); the mercs go prone, each fires once a turn at the nearest visible enemy, then `endTurn`, interrupts are ended at once; until one side is gone, combat ends or 60 rounds. Stubs: the generated arena (below) with 8, 16 and 32 enemies (a quarter elites) against six mercs and four civilians, six regular militia with the 32. Original: the same arenas with the original content; A9 with 4, 16 and 32 garrison soldiers (the sandbox squad walks from the north entry towards the nearest enemy until combat starts); the D13 airport from `SaveGame10` (3 mercs, 5 soldiers, 17 civilians: the largest battle among the six native saves of `docs/14` §10) | ms per enemy side turn (every AI team, from `endTurn` to our next turn), ticks per turn; counters: turns, rounds, shots, hits, deaths, interrupts, view build ms; calls: AI decisions, path searches, LOS tests, sight checks, chance-to-get-through traces, cover searches, cover tiles (per turn in `callsPerSample`) |
| `realtime` | the patrol arena with 20, 40 and 64 soldiers (half enemies on patrol orders, half wandering civilians), six mercs sealed in a bunker so that nobody sees them; green, and yellow (the enemy team's public noise at the far side with `setNewSituation`, as `CallAvailableTeamEnemiesToAmbush` does); manual driver, 10 × 1,000 ticks through a `Session` | µs per tick (mean, p99, max), ticks per CPU second, alert states at the end, combats started (0, or the variant is void) |
| `strategic` | a new campaign with one A.I.M. merc on a 14-day contract (renewed for two weeks when due, so the team never empties), the start sector's garrison emptied before landing (the scripted stand-in for "landed and cleared": a fought clearing is the `campaign` scenario), the squad routed to B9 so that no sector is loaded, then 7 and 30 world days of `MIN60` compression through a `Session`, prompts answered (pre-battle: retreat, else autoresolve); once more with the Queen's attacks enabled: Drassen (B13–D13) emptied and handed to the player as liberated (`setThisSectorAsPlayerControlled(…, contested)`), then `wakeUpQueen` (Omerta alone draws no attack in 30 days) | ms per world day; counters: days, `dayStarted`, compression stops, pre-battle, autoresolve, battle results, player-controlled sectors at the start and the end, frame views built and their ms per day; calls: strategic events, group arrivals, Queen evaluations, autoresolve battles |
| `autoresolve` | 20 battles a run of 10, 20 and 40 per side: half mercs (profiles on original data, stub mercs on stubs, at most 20), the rest regular militia, against enemies from `tacticalCreateEnemySoldierForAutoresolve` (a quarter elites; capped at `MAX_AR_ENEMIES` 32) | ms per battle, slices per battle; calls: cell turns, attacks |
| `save` | (S3) five saves and loads a run of: the patrol arena with 64 soldiers (a tactical session), a new campaign with the squad landed and, with `--data`, the largest native save of `$JA2_SAVES_DIR` imported; each settled for 400 ticks; the save is `SaveService.saveFileOf` (snapshot, header, content identity) plus `encodeSaveFile` (stringify and gzip), the load `inflateSave`, `parseSaveText` and S2's `restoreSession` with fresh content | ms per save (primary), series `snapshotMs`, `encodeMs`, `parseMs`, `restoreMs`, `loadMs`; counters raw and gzipped KiB |
| `server` | in process: a `node:http` server with the WebSocket endpoint on ports 7510–7512; 1, 4 and 16 viewer sessions (the 20-soldier patrol arena, realtime driver ×1) plus one instant battle session (16-enemy arena, `endTurn` until combat ends) per four viewers, driven by WebSocket clients in a worker thread for 4 s | event-loop delay max (the longest stall; `monitorEventLoopDelay` p50 and p99 in counters), frame diff ms and view build ms per frame, bytes per second (all, viewers), instant turn round trips |
| `campaign` | shortened until S13: a new campaign with six mercs, the landing, then the first sector cleared (approach the nearest enemy until combat, prone, three aimed shots per merc a turn, again after a lull), in a child process | total ms (landing and clearing in series), peak RSS |

The stub arena (`tools/bench/arena.ts`) is original work generated from the seed in the stub map format: 64 × 56 tiles
at (48, 52) on the stub tileset, barrels and wall segments as cover; the battle layout puts a quarter of the enemies
8–13 tiles in front of the mercs so that combat starts at once, the patrol layout keeps a sealed, roofed bunker in a
corner. It is round-tripped through `parseStubMapSource`, `stubMapToMapDef` and `writeMap` and served from an in-memory
overlay as `stubs/world/maps/bench-<name>.dat`, so the stub pack is unchanged.

Counters: instead of a `PerfCounters` object in the simulation's dependency context, events are counted by a wrapper
around the `SessionSim`, and `--calls` takes exact call counts of named simulation functions from V8 precise coverage
(`node:inspector`) in one extra instrumented run. The counts are deterministic like the run itself, the timed runs pay
nothing and `src/sim` is unchanged; the instrumented run is about 8× slower, hence opt-in. A unit test fails when a
counted function is renamed. The client side is still to be measured with Playwright on the stub arena
(`performance.measure` around frames) and by hand on the original A9 at 1920×1080.

### 7.3 Targets (measured 2026-10-18)

Measured by S4 (§7.1; machine: AMD EPYC 9354 KVM guest, 8 vCPUs, Node 24.22.0). Original data first, stubs in
brackets. *After S12a* gives the slice's numbers (§7.1, measured back to back with its parent commit). The bench carries each target in its JSON line and fails only above ten times the target (§7.6).

| Metric | Target | Measured 2026-10-18 | Verdict |
|---|---|---|---|
| Enemy turn, 16 enemies, p95 | ≤ 300 ms | A9 254 ms; open arena 371 ms (204 ms). *After S12a*: A9 258 ms (267 before); open arena 274 ms (393 before), 187 ms on the changed stub battle | met after S12a (throw force searches remembered, occupied cover positions traced once, `gunRange` ported; finding 12 fixed) |
| Enemy turn, 32 enemies plus militia and civilians, p95 | ≤ 1 s | arena with six militia and four civilians 1.28 s (1.07 s); A9 with 32 0.77 s. *After S12a*: arena 1.00 s (1.33 before; 0.69 s on the changed stub battle), A9 0.68 s | met after S12a, without margin on the arena: the turn is the cover search's chance-to-get-through traces (part B: the worker host keeps such a turn off the event loop) |
| Real-time tick, 40 soldiers, mean | ≤ 0.25 ms | 20 µs green and yellow (19–44 µs) | confirmed with a 5× margin; 64 soldiers 35–69 µs |
| Real-time tick, worst single tick (new) | ≤ 50 ms | 5–13 ms (4–27 ms) | new: one AI decision with several path searches; above 50 ms a tick would show as a hitch at ×1 |
| Strategic world day, no sector loaded, p95 | ≤ 100 ms | 80–92 ms (83–88 ms) with one merc; 120–145 ms with six (stubs). *After S12a*: 41–51 ms (44–60 ms) with one merc, 48 ms (60 ms) with six (`7d-mercs6`) | met after S12a (finding 11 fixed: cheap views, structural diff) |
| Autoresolve battle, 40 per side, p95 (new) | ≤ 10 ms | 3.3 ms (2.8 ms) | new, met |
| Save (snapshot and gzip) | ≤ 100 ms and ≤ 2 MB gzipped | p50 / p95, measured by S3 on the same machine with a 1-minute load of 7–9 from other jobs: the largest native import 162 / 354 ms, 4.2 MiB raw, 222 KiB gzipped (snapshot 65 ms, stringify and gzip 80 ms at the median); a landed new campaign 80 / 198 ms, 3.5 MiB, 184 KiB; the 64-soldier arena 53 / 75 ms (stubs: 41 / 57 ms, 2.0 MiB, 77 KiB; landed campaign 49 / 83 ms, 2.4 MiB, 64 KiB). The p95 is the first save of a session, which builds the content index (about 150 ms on the original data). *After S12a* (p50 / p95, back to back with the parent at load 2): the largest import 102 / 186 ms (122 / 221 before; 99 / 159 ms with the bench's clock pinned), a landed campaign 69 / 148 ms, the arena 39 / 52 ms (stubs 38 / 60 and 35 / 41 ms) | size met with a wide margin; time met on stubs, for the arena and at the median for a landed campaign; the largest import is at the target at the median and over it for the first save of a session (content index and text identity, now 0.2–0.8 s cheaper together in a cold process). Gzip runs at the fastest level (at the default level the import is 138 KiB but gzip takes three times longer) |
| Load (parse and rebuild) | ≤ 500 ms | p50 / p95 with fresh content loading: the largest import 260 / 674 ms, a landed campaign 182 / 250 ms, the arena 125 / 194 ms (stubs 92–106 / 116–128 ms). *After S12a* (load 2): the import 184 / 243 ms (199 / 283 before), a landed campaign 160 / 233 ms, the arena 104 / 150 ms | met; most of a load is building the content again |
| Event-loop stall for other sessions while one runs an instant turn (max delay) | ≤ 50 ms | 308–322 ms with one battle (230–247 ms), 1.24 s with four (0.83 s) | kept as the trigger of §7.5 and not met: the stall equals the longest instant turn, so the worker host is needed as soon as an instant battle shares the process with other sessions. Measured as the max: the p99 of `monitorEventLoopDelay` (1.5 ms) hides a stall, which is one sample |
| Shortened campaign (land and clear the first sector), peak RSS (new) | ≤ 512 MB | 319 MB (286 MB) | new, met; the full campaign follows with S13 |
| Tactical page | 60 FPS at 1920×1080 | not measured (client side) | provisional |

### 7.4 Profiling and optimization rules

- Profile with `--profile` and fix the top frames only; every optimization keeps the oracle comparisons and the scenario
  event logs byte-identical (`pnpm check` plus the local oracle compare).
- Caches are derived data: they live beside the state, are rebuilt on load (§1.4) and never change an outcome. The
  candidates named so far (inferred, to be confirmed by the profile): sight results per tick between position changes
  (`01` §11), path costs within one AI decision, the reachability flood shared by cover and flee searches, allocation in
  the bullet and LOS loops, the per-10-tick view diff with many soldiers.
- Measured hot spots (S4, §7.1): frame views during map-screen compression (finding 11), the bullet code's
  deoptimization and the chance-to-get-through volume (finding 12), the AI's grenade trajectory planning in enemy turns,
  repeated path searches in single real-time AI decisions. S12a took the first three (derived data only: the roster's
  sorted list per `Roster`, sector views per map state, throw force searches per item table, none in the snapshot);
  left are the cover search's chance-to-get-through traces (within one AI decision under 4 % repeat exactly, so a memo
  would not pay) and the path search. Profiles of the save path misattribute time to whatever runs during a garbage
  collection; time phases with `performance.now()` around them before trusting a frame.
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

CI runs every bench scenario on stubs with `--runs 1` as a smoke test (`pnpm cli bench all --runs 1 --data '' --out
bench.jsonl`, about 40 s on the development VM) plus one `--calls` run (`autoresolve --variant side-10`) for the
instrumented path: it fails only on errors or on a sanity bound ten times above the target (CI machines vary), and
uploads `bench.jsonl` as the `bench` artifact. With one run there is no warm-up and no run-to-run check, so CI numbers
are cold and only a smoke signal. Local runs compare against `.cache/bench/baseline.json` (written by
`--save-baseline`, merged per scenario, variant and source) and print the change per metric (p50, p95, max, mean and
the call counts).

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

### 8.4 What landed (slice S11, 2026-10-18)

- **Launcher** `src/app/launcher/`, served at `/` (the repository's root `index.html` is the launcher's page and keeps
  links to every devtools page): the data source (original data with the SLF count, or the stub pack), the data
  version and the display language in the header; panels for the new campaign, the saved games, the settings, video
  and credits, the running sessions (links to their strategic and tactical pages) and the developer pages. DOM glue in
  `main.ts`, `campaign-panel.ts`, `save-panel.ts`, `settings-panel.ts` and `message-box.ts` (a `<dialog>` with the
  original's YES, NO and OK of `pMessageStrings`); the logic in DOM-free modules: `campaign-form.ts`, `save-rows.ts`,
  `settings-file.ts`, `labels.ts` with `string-ids.ts` and `printf.ts`, and `api.ts` (the HTTP shapes the launcher
  reads; `app` may not import `server`).
- **New campaign** (`campaign-form.ts`): the game init screen's choices with `InitGameOptions`'s defaults preselected
  (easy, sci-fi, reduced guns, save anywhere, blood on); the form always sends all five options, so the API's default
  difficulty 2 never applies; the Dead is Dead save name (checked against the server's name rule and the reserved names);
  the default squad of the server or of 1–6 mercs, or hiring in the laptop (`hire: []`), and whether the squad flies in
  at once; the page to open (the tactical view only when the squad lands). The session gets the client's display
  language; `?seed=N` on the launcher's URL passes a seed (tests). After `POST /api/sessions` the beginning sequence
  plays unless `playIntro` is off, then the strategic or tactical page of the new session opens.
- **Saved games** (`save-rows.ts`, `save-panel.ts`): the server's list (newest first), each row with
  `DisplaySaveGameEntry`'s fields: `pMessageStrings[MSG_DAY] N, hh:mm`, the location (the sector code; N/A before
  `STARTING_TIME` and `STR_LATE_14` after it when there is no sector), `n` with `MercAccountText[MERC_ACCOUNT_MERC]` or
  `pMessageStrings[MSG_MERCS]`, the balance as `InternalSPrintMoney` prints it (`$-1,234` for debts), the description
  and the Dead is Dead mark (`gs_dead_is_dead_mode_tab_name[1]`) by the initial save mode; native saves carry a mark of
  their own. The tooltip lists the difficulty with `SLG_DIFF`, the save mode, the guns, the style, blood and gore and
  the data version (in place of the original's mods). Load asks once, as `SaveLoadSelectedSave` does: the warnings the
  launcher can predict from the header and `/api/health` (`engineDiffers` with `SLG_GAME_VERSION_DIF`,
  `dataVersionDiffers` with a ja2-node line) go into one box between `SLG_SAVED_GAME_ISSUE` and
  `SLG_SAVED_GAME_CONTINUE_ANYWAYS`; the load goes into a new session or in place into a running one, and the warnings
  the server returns (the text identity) are shown with the result; a native save imports with `newSession {save}`.
  Save as new (`{description}`, at most 46 characters) or over the selected save (`SLG_CONFIRM_SAVE`; `QuickSave` is
  written as `quick`, autosaves and native saves cannot be overwritten), for the session chosen in the panel (preset by
  `?session=` when a game page links back); Delete (`SLG_CONFIRM_DELETE`); Download (`GET /api/saves/:name/file`) and
  Upload (`PUT`, the name taken from the file, made valid and unique, never a reserved one). Refusals appear in the
  status line: `ironMan` with `zNewTacticalMessages[TCTL_MSG__IRON_MAN_CANT_SAVE_NOW]`, the others with
  `SLG_SAVE_GAME_ERROR`, the code and the server's reason.
- **Settings** (`settings-panel.ts`, `settings-file.ts`): the five volumes, mute, speech, subtitles (unchecking the
  last one shows `OPT_NEED_AT_LEAST_SPEECH_OR_SUBTITLE_OPTION_ON` and keeps it on), key-advance speech, mute
  confirmations, the sleep/wake notification, the splash and intro switches, playback speed, the display language
  (in the header) and export and import as a JSON file `{format: 'ja2-node-settings', settings}` (normalized on import,
  so an older or edited file cannot store invalid values). Settings apply at once and are saved under
  `ja2-node:settings`; the volumes drive the launcher's audio engine (splash and intro sound), and the game pages read
  them as before.
- **Splash**: unless `playSplash` is off, the launcher starts behind a "Click to start" button and plays the splash
  after the click, which unlocks the audio context so the splash has sound; it is offered once per browser tab
  (`sessionStorage`), not each time a game page links back (deviation "Splash start"). The video and credits panel
  plays the splash, the beginning and the credits.
- **Labels** (`labels.ts`): every label is either an original string `{table, index}` of the string tables
  (`zSaveLoadText`, `gzGIOScreenText`, `zOptionsText`, `zOptionsToggleText`, `pMessageStrings`, `gpStrategicString`,
  `pUpdateMercStrings`, …; the indices in `string-ids.ts` from `Text.h`, `GameSettings.h` and
  `Map_Screen_Interface.h`) or a ja2-node label with an English and a Russian text (about fifty). The launcher loads
  `GET /api/strings?lang=` for the chosen language (the setting, else the server's default); a ja2-node label falls
  back to English in the other six languages, a missing original string shows its label id. Switching the language
  re-renders the page and is remembered.
- **Server**: `/api/health` adds `engine {version, commit}` (the save service's engine identity), so a client can predict
  `engineDiffers` before it loads. Nothing else changed on the server.
- **Game pages**: `src/devtools/net/session-client.ts` gained `save()` and `load()` over the WebSocket and drops its
  queued frames whenever a `welcome` arrives (the S3 open issue: frames of the replaced simulation were applied after a
  load in place). `src/devtools/net/save-controls.ts` binds Alt+S (`save {name: 'quick'}`) and Alt+L (`load QuickSave`)
  by `KeyboardEvent.code`, so any keyboard layout works, adds "quick save", "quick load" and a link back to the save
  list to the header, and shows the outcome as the page's message: `pMessageStrings[MSG_SAVESUCCESS]`,
  `SLG_LOAD_GAME_OK`, `SLG_LOAD_GAME_ERROR` with the reason, the Iron Man text, or a ja2-node line when there is no
  quick save (the original then does nothing). The sleep/wake notification (`src/app/sleep-wake.ts`, DOM-free, and
  `src/devtools/net/sleep-wake-stop.ts`): with the setting on, a frame carrying `fellAsleep` (not a collapse) or
  `wokeUp` of a merc off a squad or vehicle (the cases `HandleRestFatigueAndSleepStatus` opens the update box for)
  switches the real-time driver to manual, and the strategic page's advance adds the two events to its stop
  condition, restarting quietly when the stop was a case without a box; the message is `pUpdateMercStrings` with the
  merc names. Debug hooks: `window.__ja2Launcher`, `window.__ja2SaveKeys`, `window.__ja2SleepWake`.
- **Tests**: `src/app/launcher/labels.test.ts` (every original label resolves in all eight languages, Russian labels,
  the fallbacks, `printf`), `save-rows.test.ts` (money, the row fields, the tooltip, native rows, the warning box,
  overwrite targets, descriptions, upload names), `campaign-form.test.ts`, `settings-file.test.ts` (round trip, other
  files refused, normalization, the speech-or-subtitles rule), `src/app/sleep-wake.test.ts`; the end-to-end
  `tests/e2e/launcher.spec.ts` (§12.2): the splash after the click and Escape, a campaign with options from the form
  (expert, gun nut, blood off) opened on the tactical page, Alt+S and Alt+L there with the tick restored, the save list
  with the quick save, download and upload, Russian labels from the string tables and the ja2-node table, a delete
  confirmed in Russian.
- **Checks** on the user's data (headless Chromium, a scratch save folder): the launcher shows the original data with
  22 SLF files and the data version english; after the click the splash plays with audio-clock pacing and sound
  (63 of 486 frames before Escape ended it); a campaign with medium difficulty, realistic style, gun nut and blood off
  starts with exactly these options, the beginning intro plays (`rebel_cr` with sound) until Escape and the strategic
  page of the new session opens in A9 at day 1, 07:00; there Alt+S answers "Game Saved." and Alt+L, after three seconds
  of real time (600 ticks), restores tick 0; the save list shows the quick save (`Day 1, 07:00`, `A9`, the mercs, the
  balance, the options tooltip with the data version) above the six native savegames, a new save with a description is
  written for the session, a save whose engine commit differs is uploaded with `engineDiffers`, asks once with
  `SLG_SAVED_GAME_ISSUE`, `SLG_GAME_VERSION_DIF` and `SLG_SAVED_GAME_CONTINUE_ANYWAYS` and then loads into a new session,
  a native save imports into a new session (C13, day 1, 21:44), and the Russian display language shows the
  `translation-rusgold` texts and the ja2-node table's Russian labels. The sleep/wake stop was not triggered live (it
  needs a tired merc off a squad); its logic is covered by the unit tests.
- **Not covered**: the playback speed setting is stored for M8 (the devtools pages keep their own playback buttons);
  the display toggles and key-advance speech are stored only; the location column has no land type or town name.

---

## 9. Agent API and protocol (D13–D16)

Everything below is added to MCP, HTTP and the WebSocket protocol together, and `04` §6 gets a section "Saves, options,
text and presentation (M7)" when the slices land.

**Commands** (dispatched like every other command, logged):

| Command | Where | Refusals |
|---|---|---|
| `setOption {bloodAndGore}` | any flow | `promptOpen`, `badOption` (S5: anything but a boolean `bloodAndGore`) |

**Tools and routes** (not commands: they act on the session or the server):

| MCP tool | HTTP | Purpose |
|---|---|---|
| `save {session, name?, description?}` | `POST /api/sessions/:id/save` | §1.7; refusals `conversation`, `meanwhileStarting`, `promptOpen`, `shopOpen`, `ironMan`, `deadIsDead`; a won campaign may still be saved (`26` §13 decision 3) |
| `load {name, session?, reseed?}` | `POST /api/sessions/:id/load`, `POST /api/sessions {load}` | §1.5; refusals `contentMismatch`, `versionTooNew`, `notFound`; warnings `dataVersionDiffers`, `engineDiffers` |
| `listSaves {}` | `GET /api/saves` | headers of ja2-node and native saves |
| `deleteSave {name}` | `DELETE /api/saves/:name` | |
| — | `GET`/`PUT /api/saves/:name/file` | download and upload (browser only) |
| `newSession {campaign: {options}, load?, language?}` | `POST /api/sessions` | options (§2.2, §2.4; `campaign.difficulty` and `campaign.saveMode` stay aliases), load, the session's display language for resolved text (§5.2) |
| — | `GET /api/strings?lang=` | UI string tables (§5.2) |
| — | `GET /api/text` (widened) | EDT rows with their layouts (§5.2) |

**Status and observation.** `status` and `observe` show `options`, `saveMode`, `language`, `dataVersion` and, when a
save rule applies, `canSave: false` with the reason (so an agent need not try). View frames carry `music {mode,
creature}` when it changes (§3.3) and soldier `voice`/`body` (§3.3). `observe` adds nothing about sound: agents get the
same facts from events.

**Events** (presentation fields are optional and never in state): `gameSaved`, `gameLoaded`, `optionChanged`; the S9
music facts (`sectorLoaded {hostiles, enemyPresence, firstArrival}`, `enemyPresence`, `creatureAttack`, `combatEnded
{fought, monsterKill}`, `mercsLeftSector {mapScreen}`, §3.7); the S8
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
| Game options are session state and the policy is logic content under the save's content hash; client settings never reach the simulation | §2.2 |
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
`imp.json`, `strategic-ai-policy.json` (the policy, logic content covered by the save's content hash, §2.2).

### 11.2 Transcribe (`tools/transcribe/*.ts` → `data/tables/`)

| Table | From | Content |
|---|---|---|
| `sound-effects.json` (S7) | `Utils/Sound_Control.h:28-352`, `Utils/Sound_Control.cc:17-328`, literal sound paths in `src/game/**/*.cc` | sound ids, ambient ids, paths, the pan and volume constants, the sound files the code names directly |
| `battle-sounds.json` (S7) | `Tactical/Soldier_Control.h:178-198`, `Tactical/Soldier_Control.cc:97`, `:138-157`, `:5868` | the 17 kinds with variant counts and flags, the repeat filter, the low-morale threshold |
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
header (S5: `importNativeGameOptions`, the report's `droppedOptions`), the music mode byte (`SaveLoadGame.cc:1827`) into
`presentation.music` (S9: the session's starting music), `useCreatureMusic` (already decoded,
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
  with the same outcome as without the reload. *Part B (§6.7)*: `tests/e2e/campaign.spec.ts` runs the campaign bot
  through the landing battle with the exact load and the comparison; the whole campaign is `pnpm cli campaign`, run
  locally (minutes per seed, not on CI); it is not won yet (finding 31).
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
| **S3** Saves (landed, §1.7) | file format, content identity, save store, rules, autosave, input log and `replay`, MCP/HTTP/WS API, events, native list; `04` §6 section | S2 | §12.1 complete; an agent saves and loads through MCP |
| **S4** Benchmarks | `tools/bench`, the stub arena map, the scenarios of §7.2 (the `save` scenario after S3), CI smoke, the first measurements on original data; revise §7.3 | — (can run beside S1–S3) | targets confirmed or revised in this doc |
| **S5** Options (landed, §2.4) | `GameOptions` unification, `setOption`, `newSession` options, `status`, import mapping, client settings, deviations (the policy copy was dropped, §2.2) | S3 | blood and gore off changes deaths in a stub scenario; options in the save header |
| **S6** Text (landed, §5.5) | data version, `TextService`, string tables, `/api/strings`, widened `/api/text`, text keys, the Russian paths (EDT mode, NPC layout, speech prefix), per-session language | — (beside S5) | Russian labels on stubs; original-data tests for counts and lengths |
| **S7** Stub media P0 (landed, §6.5) | §6.3 items 1–5 except the video | S6 | `/api/text` and the cue table resolve on stubs |
| **S8** Sound (landed, §3.6) | WAV/GAP/ambient decoders, transcribed tables, cues, the audio layer, the director with animation opcodes, speech, ambient; the event fields of §3.3; deviations | S7 | the tactical page plays a stub firefight with sound |
| **S9** Music (landed, §3.7) | `musicMode`, `presentation.music` in sessions and snapshots, the client player, the victory clear of `useCreatureMusic` in the simulation | S8, S3 | music follows sector entry, combat, victory and defeat on stubs |
| **S10** Video (landed, §4.5) | `smk.ts`, the stub encoder (or fixture), the player, sequences, credits parser and scroller | S8 | the splash and the ending play on original data; stub splash in e2e |
| **S11** Launcher (landed, §8.4) | the DOM launcher (§8.3), quick keys in the pages, client settings, export and import | S3, S5, S6, S10 | §12.2 launcher test |
| **S12** Performance | profile-driven fixes against §7.3, `SessionHost` and `WorkerHost` | S4 (and S2 for the save scenario) | targets met or documented |
| **S13** Stub campaign | §6.3 P1 items 6–9 (part A, landed, §6.6) and the end-to-end campaign with a reload (§12.2, part B) | S3, S7 | the stub campaign is won through MCP alone with a reload in a battle (part B: the bot, the reloads and the e2e segment landed, the win not yet, §6.7, finding 31) |
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
- *Key-advance speech*, *sleep/wake notification*, *timed turns* (§2.3; the policy snapshot was dropped, §2.2).
- *Music track choice*, *footstep variants*, *speech playback not cut*, *ambient timing* (§3.5).
- *Intro and splash switches*: client settings `playIntro` and `playSplash` (the original always plays the beginning
  intro on a new game).
- *Splash start* (the launcher waits for a click, once per tab) and *save list in the launcher* (sector code only, the
  data version in the tooltip) (§8.4).
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

**Findings of the benchmarks** (S4, 2026-10-18; 7–10 fixed on 2026-10-18 after S4, with regression tests on stubs):

7. *Fixed: AI throws that never leave the hand.* Two porting gaps: TurnSoldier's return from a prone turn lacked the
   original's `pTempObject == NULL` check (`Tactical/Soldier_Control.cc:4339`), so a prone thrower who had to turn lay
   down again, and `HaultSoldierFromSighting` (`:7271-7369`) was ported without its attack cancellation, so a sighting
   cleared the pending `THROW_ITEM` but kept the grenade in `tempObject` and the busy count. Both ported (the halt also
   frees pending melee attacks and turns to shoot, removes the pending action and resets the prone turn), with the AI's
   escape for a tosser's new situation (`TacticalAI/AIMain.cc:287-321`). Tests: `perception/halt.test.ts`,
   `explosions/grenade-attack.test.ts`, `ai/new-situation.test.ts`.
8. *Fixed with 7: other stalled turns.* The `KNIFE_STAB` from a crouch is the halt above clearing a pending
   `CROUCH_STAB` without releasing the attack (the stub `campaign` run with seed 2 no longer reproduces it at 4e74dec);
   the `SEEK_FRIEND` swatter was only a frozen mover listed beside the real blocker (original data, `arena-e32`, seed 3
   now ends `lost`). A prone variant remains, finding 15.
9. *Fixed: `enemyInSector` stays set.* `NumCapableEnemyInSector` skips `SOLDIER_DEAD` (`Tactical/Overhead.cc:4921`); the
   port counted the dying enemy until his corpse was made, so the check of `HandleNPCTeamMemberDeath` never saw the
   battle won (the busy count was not the cause). Test: `turns/end-of-battle.test.ts`; no stub `campaign` run with
   seeds 1 to 16 keeps the flag (seed 10 ends `cleared`; seed 7 now loses the battle).
10. *Fixed: a refused attack moves the soldier.* The `attack` order sent a halted soldier to his stationary stance
    before `HandleItem`, which `UIHandleMercAttack` never does (`Tactical/Handle_UI.cc:2115-2252`): a merc frozen
    mid-move with a pending breath collapse went down on an order refused for lack of APs. `HandleItem` also cleared the
    pending animation where the original removes the pending action (`Tactical/Handle_Items.cc:191`). Related, found
    by the sweep: an attack ordered in the frames between a merc's breath reaching 0 and his collapse left
    `fTurningToShoot` set under `PRONE_LAY_FROMHIT`, so the shot never came; the API now refuses orders from a merc
    out of breath who has collapsed or is about to (the original's UI gives him no cursor, `Handle_UI.cc:2523`) and
    counts the pending collapse as acting (deviations "Turn-based UI lock"). Tests: `combat/combat.test.ts`.
11. *Fixed in S12a: frames during compression*: the session builds and diffs the whole player view, including the 256-sector strategic
    view, every 10 ticks (`src/server/session.ts:56-81`) also while the map screen compresses time: building the views
    alone is about two thirds of a world day, the diff comes on top (`strategicView`/`sectorView` and `diffPlayerView` are the top frames), growing with the number of mercs.
    The view scanned the roster (sorted anew on every `Roster.all()`) and the group list once per sector: the roster
    list is now reused until the roster changes, enemy counts and the player's knowledge of them are computed for the
    whole surface map at once (`numEnemiesInEverySurfaceSector`, `surfaceKnowledgeOfEnemies`, each tested against its
    per-sector original), unchanged sector views are reused between frames, and `diffPlayerView` compares with `sameJson`
    (`src/protocol/same-json.ts`, equal exactly when the `JSON.stringify` outputs are equal, fuzz-tested) instead of
    stringifying both sides. The frames are byte-identical (hashed over a compressed week and two campaign battles on
    both sources); the session still builds a view every 10 ticks (part B could skip frames nobody receives).
12. *Fixed in S12a: bullet code falls out of the optimizing compiler*: `fireBullet`, `fireBulletGivenTarget` and
    `calcChanceToGetThrough` (`src/sim/tactical/combat/bullets.ts:271-400`, `:886-1006`) deoptimize again and again
    (`node --trace-deopt`: wrong map, not a Smi, minus zero, lost precision or NaN, so the bullet record changes shape and
    its fixed-point fields switch between small integers, doubles and −0); after a few battles in one process V8 stops
    optimizing them, the small helpers (`fixInt`, `cellOf`, `cubeOf`) show up as separate frames and enemy turns get about
    three times slower (original data, `arena-e16`: p50 198 ms in a fresh process, 598 ms after four `arena-e8` battles;
    `fireBullet` from below 1.7 %, outside the twelve hottest frames, to 34 % of self time). A long-running server meets this; S12's first candidate together with
    the chance-to-get-through volume (about 25,000 traces per 16-enemy turn).
    The trigger was a porting gap, not the record's shape (it is built in one literal; normalising −0 and keeping the
    fixed-point fields small integers left the slowdown in place, three runs out of three): `gunRange` returned 0 for
    everything but guns, where `GunRange` (`Tactical/Weapons.cc:86`) returns `CELL_X_SIZE` for non-weapons and the
    weapon range for every `IC_WEAPON` class. A trace from a soldier holding a knife, a grenade or nothing, and a thrown
    knife or rocket, divided by zero in the range drop (`LOS.cc:2844`), so its vertical increment became −Infinity
    after the first tile: it flew flat over open ground (`Math.imul` turned the step into 0), dropped at the first tile
    with a structure, and the Infinity and NaN values drove V8 into deoptimizing `calcChanceToGetThrough` until it gave
    up on it. `gunRange` is now ported (a behaviour fix: the oracle compare and every test are unchanged, two
    regression tests); `arena-e16` after five `arena-e8` battles in one process: p50 543–668 ms before, 181–248 ms after
    (three runs each, the same as in a fresh process). The remaining deopts of the bullet code are the ordinary
    feedback ones (about 25 per process, the same count with or without −0 normalisation).
13. *Fixed in S4*: every stub merc of the sandbox shared the module constant `STUB_STATS` as its `stats`
    (`src/server/stub-mercs.ts`), so a stat gain went to the whole squad and to every later session in the process (two
    sessions with the same seed diverged); found by the bench's run-to-run check, now a copy per merc
    (`src/server/stub-mercs.test.ts`).

**Findings of the stall fixes** (2026-10-18; the original's code paths, inferred to hang it too until a watchdog that
ja2-node does not port, deviations "Watchdogs"; 14–16 decided and fixed on 2026-10-18 as minimal deviations):

14. *Melee from a get-up* (fixed: deviation "Melee from a prone turn", no prone return while a melee attack plays; every
    prone attacker who must turn to a prone target met it, not only one getting up; test `ai/melee-ai.test.ts`): an AI
    soldier who gets up at the start of his turn (`BeginSoldierGetup` → `PRONE_UP`) and
    stabs or punches a prone target at once: `EVENT_SetSoldierDesiredDirection` from the stationary `PRONE_UP` (start
    height prone) sets `fTurningFromPronePosition`, `PUNCH_LOW`/`CROUCH_STAB` start from its crouched end height, and
    TurnSoldier's prone return (`Tactical/Soldier_Control.cc:4335-4345`) replaces the attack with `PRONE_DOWN` before
    its hit: the busy count stays 1. The original would end the turn through the 15 s AI deadlock breaker
    (`TacticalAI/AIMain.cc:366-380, 577-602`). `node tools/bench/scenarios/campaign.ts --data '' --seed 5`
    (`#23 PRONE ai KNIFE_STAB`).
15. *Knock-back frozen by the sighting pause* (fixed: deviation "Knock-back and the sighting pause", the pause does not
    freeze a special move; test `perception/halt.test.ts`; the bench run below ends `lost`): a merc thrown back by a
    blast during the enemy turn
    (`FALLBACK_HIT_STAND`, special move, non-interruptible) who sees a new enemy on landing gets `fNoAPToFinishMove`
    from the sighting-pause branch of `HandleAtNewGridNo` (`Tactical/Overhead.cc:1853-1858`); the 3 s timer unfreezes
    only the paused enemy (`GameScreen.cc:316-325`), so the special move never resumes, its hit release never comes and
    the thrower waits for the busy count (deadlock breaker in the original). `pnpm cli bench enemy-turn --data ''
    --seed 4 --variant arena-e32 --runs 1` (the listed `#20 TOSS_PROJECTILE` is the waiting thrower).
16. *Options for 14–15* (decided: the deviations; the deadlock breaker stays unported): a minimal deviation per case in
    the manner of "Melee hold leaks" (14: no prone return while a melee attack plays; 15: the pause does not freeze a
    special move), or porting the deadlock breaker on the sim clock. Recommended: the deviations, so that a hang stays
    a test failure.
17. *Gaps seen while tracing (no stall found)* (fixed: all ported, the oracle compare unchanged. The `newAiSituation`
    hook is `HandleSystemNewAISituation`; the door continuation, which called the same no-op hook, now calls
    `CancelAIAction` as `Soldier_Ani.cc:1849-1855` does; `stopMerc` is the whole `EVENT_StopMerc`; `handleSoldierAI`
    returns on `fGettingHit` and opcode 480 clears it. Two more gaps of the class: `SoldierCollapse` tested the
    PC-under-AI flag instead of `SOLDIER_UNDERAICONTROL` before ending the AI turn (`:8047`), and an interrupt at the
    final tile did not drop the pending action (`Overhead.cc:1826-1830`). Tests: `ai/system-situation.test.ts`,
    `ai/getting-hit.test.ts`, `movement.test.ts`, `animation.test.ts`): `HandleSystemNewAISituation` is still the no-op
    `newAiSituation` hook in
    turn-based combat too (`10` §10 planned it active; `Soldier_Control.cc:8774-8817`): AI throws, turns to shoot and
    pending animations are not cancelled at the end of a stance change, a door opening, a turn's look or a new tile;
    `stopMerc` does not release a turn to shoot nor reset `fTurningFromPronePosition`, the pending direction and the
    pending action (`EVENT_StopMerc`, `:7379-7421`); `handleSoldierAI` lacks the `fGettingHit` return
    (`TacticalAI/AIMain.cc:180-184`, listed in `13` §1).
18. *Sweep after 14–17* (2026-10-18): `bench enemy-turn --runs 1` with seeds 1–8 and every variant on stubs and on the
    original data and `bench campaign --runs 1` with seeds 1–16 on stubs end without a `stalled` outcome. The campaign
    harness crashed with "the battle did not start" on six seeds; it now reports `notEngaged` (seeds 8, 12, 15, 16:
    the last enemies hold a building and the approach leaves our merc outside its wall, nobody sees anyone) and
    finishes the others (seeds 9 and 11 end `cleared` after the last enemies left the map). Seen, not changed:
    `HandleSystemNewAISituation` drops a pending melee animation without its busy count when a new situation arrives
    without a sighting during the stance change before the attack; no source of such a new situation during an AI's
    own turn was found, and no run met it.

**Findings of S13 part A** (2026-10-18; 19–22 fixed on 2026-10-18 by the inventory slice, `04` §6.24):

19. *A conversation's pause lock survives a switch to the map screen.* `closeTalk` (or `closeShop`, which closes the
    merchant's conversation) clears `engagedInConv`, but the lock taken by `pauseForConversation(true)` is released only
    by the dialogue queue's engaged transition, which ja2-node steps after tactical steps alone
    (`src/sim/campaign/talk-flow.ts:523`); the original also calls `HandleDialogue` in the map screen loop
    (`Strategic/MapScreen.cc:1901`). An agent that closes a talk and sends `mapScreen` at once gets every `advance`
    refused with "the game is paused" until it returns to tactical for a step (reproduced through MCP after `closeShop`
    in C5 and through the session API after `closeTalk` in D13). *Fixed:* the dialogue queue now steps on every
    strategic step and after every command on the map screen (deviation "Map screen dialogue"); without compression no
    step runs before `advance` asks for compression, so the step after `mapScreen` itself releases the lock. Test:
    `src/server/inventory-stub.test.ts` (talk, `closeTalk`, `mapScreen`, `advance` reaches its world time).
20. *Attack orders and `endTurn` in one tick leave an enemy firing forever.* Six `attack` orders followed by `endTurn`
    without an `advance` in between (all accepted) leave, in the next enemy turn, an enemy STANDING with the AI action
    `FIRE_GUN` and the busy count held (A9's landing battle, `mercs: 6`, seeds 71–74, also at 0b990a9); with an `advance
    {idle: true}` after each attack the battle runs. The original UI accepts no order while an attack resolves; the API
    could refuse `endTurn` (and further attacks) until the attacks are resolved. *Fixed:* an accepted gun attack only
    queues a `beginFireWeapon` game event, run after the next tick's soldier pass, so the attacker was not yet busy and
    five more attacks and `endTurn` were accepted; the queued events then fired in the enemy turn. Orders and `endTurn`
    are now refused while a game event is queued (the original's `SetUIBusy` after the click; deviation "Turn-based UI
    lock"); seeds 71–74 no longer stall. Test: `src/sim/tactical/order-lock.test.ts`.
21. *Stub structures fill their whole tile.* Stub walls, windows and fences use `syntheticStructure`'s full 5×5 shape,
    so they block sight and fire across their tile instead of along one edge: a merc standing on a wall tile cannot see
    along the room (seen in the stub shop). A fidelity limit of the stub structures, not of the port; edge shapes per
    orientation would fix it (the movement costs already treat walls as edges). *Fixed:* `syntheticStructure` takes
    `edge`, which fills the cells of the original's wall shapes (left walls the far `y` row, right walls the far `x`
    column, read from the tileset 0 wall and door structure files); the S13 stone walls, windows and both fences use it.
    The first stub walls (`FIRSTWALL`: A9, the village houses, the bench arena) keep full tiles: the arena's sealed bunker
    relies on them. Test: `src/sim/tactical/stub-tiles.test.ts` (sight and fire along a wall from its tiles).
22. *The stub squad and player-initiated attacks.* Towns, mines and SAM sites are taken in tactical battles only
    (autoresolve is off for player-initiated attacks, `PreBattle_Interface.cc:450-455`, faithful); with the stub mercs'
    pistols a scripted MCP bot took C13 in two of seven runs and lost D13. `act` has no inventory command to move a
    bought weapon into the hand, so the dealers' rifles cannot help an agent yet. *Fixed:* the inventory, reload and
    first-aid commands of `04` §6.24; a stub scenario buys a rifle and magazines from Tony in A10, puts the rifle into
    the hand, reloads, fires, unloads and reloads by hand, and a medic stops a merc's bleeding
    (`src/server/inventory-stub.test.ts`).

**Findings of S13 part B** (2026-10-18; the stub campaign bot, `pnpm cli campaign`; 23–28 fixed with regression tests):

23. *Fixed: `enterSector` on the loaded sector stayed on the map screen.* The answer `enterSector` to a pre-battle
    prompt for the sector that is already loaded (and the command itself) re-entered the world but left the strategic
    flow, so every tactical command was refused while the battle waited. The original's callers switch to the tactical
    screen; ja2-node now sets the flow to `tactical` at normal speed (`src/sim/campaign/sector-flow.ts`, test
    `screens.test.ts`, `04` §6).
24. *Fixed: a hit during a non-interruptible animation held the busy count.* A hit raises the attack busy count and asks
    for a hit animation, which a soldier in a non-interruptible animation drops (the Queen's `START_COWER` when combat
    starts in P3 b1); the original's 25 s UI watchdog would release the count. The count is now released when the hit
    animation cannot start (deviation "Hit during a non-interruptible animation", test `combat/hit-locked.test.ts`).
25. *Fixed: a suppression stance change chained to the previous one.* The end of a stance change caused by suppression
    releases its busy count, which can start the next stance change of the same soldier (crouch, then prone); the end of
    the first animation then replaced the new `PRONE_DOWN` with the stationary stance and its count was never released
    (an AI burst at a squad in E12, seed 3). Deviation "Suppression stance change from the end of the previous one",
    test `combat/suppression-chain.test.ts`.
26. *Fixed: the stub unjam animations never resumed the shot* (stub content). The original's seven unjam scripts end
    with the non-interruptible release and opcode 476, which returns to the shooting animation the jam interrupted; the
    invented stub scripts ended like any one-shot animation, so after a jam cleared by the skill check the shot never
    came and its busy count stayed (K10, seed 4). Test `stubs/anim-scripts.test.ts`.
27. *Fixed: patrol members counted in battle without a slot* (stub content). `AddSoldierInitListEnemyDefenceSoldiers`
    places soldiers on the map's enemy placements only; the stub wilderness map had six, the stub campaign's patrols up
    to nine, so the rest were counted in battle and never placed. After the battle their group kept its count and its
    in-battle numbers, the sector showed enemies that never came, and a passing group made the bot wait for them (E13
    seed 1, G11 seed 2). The wilderness map has twenty slots now, like the town, camp, mine and airfield maps.
28. *Fixed: the renewal of a merc who cannot be let go repeated forever.* The renewal list is made two hours before the
    contracts end; a listed merc captured or killed since still gets his prompt, and `letGo` or `dismiss` start nothing
    for the dead and prisoners (`Assignments.cc:4399`), so the sequence stayed on him and the prompt came back after
    every answer (the bot answered it 28 times after a merc was left behind in M3). Deviation "Renewal of a merc who
    cannot leave", test `contracts/renewal-unremovable.test.ts`.
29. *Open: a merc waiting for a tile held by a squad mate.* In real time a merc whose next tile is taken by a squad mate
    who stopped on it waits in `HandleNextTileWaiting` without end; the bot stops him after 4000 ticks ("keeps waiting
    for a blocked tile: stop", seen in G11 with seed 3 during the S13 runs). Not traced, and not reproduced on demand.
30. *Open (API): own mercs' bleeding is not in the view.* The original's health bar shows how much of a merc's lost life
    is still bleeding; `SoldierView` and the strategic merc view carry life and maximum only, so an agent learns about
    bleeding from `soldierHit` events, the `bandaged {bleeding}` events and the `notBleeding` refusal (what the bot
    does). Bleeding to death between contacts was the bot's largest single loss before it treated hits.
31. *Open: the stub campaign is not won by the bot.* Everything up to the march works on every seed; the squads are lost
    (a) on the march F11–L3 through patrol country (groups of five to eighteen meet the squad; the patrols around K7–L10
    are twelve and thirteen strong in the strategic tables), which costs two to ten mercs, and (b) at the Meduna
    outskirts: M3 holds twenty (`LEVEL1_DEFENCE`, a fifth elites), N3 and O3 twenty each with 55 % elites
    (`MEDUNA_DEFENCE`), refilled while the squad regroups (N3 at 13 elites and 7 troops after two attacks, seed 3), P3
    22 elites on easy. Calibration in process with fresh mercs placed next to the sector (AK-74, four magazines, Kevlar
    vest and helmet, the same bot, seeds 1–4): M3 with seven or eight mercs won 4 of 4, N3 with seven 1 of 4. Not
    changed: garrisons and patrols are the original's strategic tables, not stub content. Candidates: outskirts maps
    with cover an attacker can use (the stub camp and town maps are open ground around their posts), a battle policy
    that picks cover and attacks at night, a larger team (twelve A.I.M. and one M.E.R.C. profiles on stubs, fewer after
    deaths, Puig's death rule and Lasko's hatred), Skyrider's helicopter for the march (but enemy airspace beyond the
    Drassen strip). Repro: `pnpm cli campaign --seed 2 --no-reload` (four battles at M3, lost; with an earlier kit seed
    3 took M3 and lost N3).
32. *Open: a battle left with only unconscious mercs stays in combat.* After a retreat that leaves unconscious mercs
    behind in a sector in turn-based combat, the loaded sector stays in combat and the map screen refuses `advance`
    ("combat is in progress") until someone goes back and ends the turn; the bot then switches to the tactical screen
    and ends turns until the combat is over (seed 4 at M3 after a player load). Not traced against the original.
33. *Open: a squad refused to move because of a dead member.* Once, after a player load, `route` for a squad answered
    "the squad cannot move: dead" after a won battle (D13, seed 1), so `canEntireMovementGroupMercIsInMove` found a dead
    merc in the squad's group although a death removes the merc from his squad (`HandleStrategicDeath`); the bot now
    removes dead mercs with `removeMerc` when it sees that refusal. Not reproduced: a run after a player load depends on
    the server's entropy (§6.7).
34. *Open: an enemy turn that did not end.* After a player load, in K10 against fifteen soldiers (seed 3), the enemy
    turn after `endTurn` did not end within `advance`'s 200,000-tick budget; not reproduced (the run depends on the
    server's entropy). The stalls found earlier in this slice were 24–26.

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
silences the game; that the first helicopter drop in ja2-node does not wait for a sound fade. The performance figures of
§7.1 and §7.3 are measured (2026-10-18).

**Open questions for the maintainer** (with the recommendation first):

1. **Split M7 into M7 Polish and M8 Player UI** (§8)? Recommended; `01` §10 is edited accordingly in this change.
2. **Snapshot strategy**: a codec with pointer encoding plus moving private state into `StrategicState` (recommended,
   S1–S2), or first refactoring the tactical layer to ids (D7) everywhere (cleaner, much larger, touches every combat
   and AI module), or replay-only saves (rejected: load time grows with the campaign and any code change breaks old
   saves).
3. **Dead is Dead and quick load**: keep the original's unblocked quick load (recommended, faithful) or block every load
   (the mode's intent)?
4. **Double volume scaling** of soldier sounds (`Utils/Sound_Control.cc:409-420`): keep (recommended, faithful) or fix?
   *Decided: keep; implemented in S8 (`mix: 'soldier'`).*
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

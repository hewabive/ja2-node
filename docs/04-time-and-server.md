# 04 — Time and the server

Why the simulation runs on game-time ticks instead of the original's frame loop (§1–§3), how time is driven and played
back (§4), and the server that holds the game: sessions, protocol, player-view projection, session hosts, the rule pack
and assets (§5). Supplements `01` D13–D16 and `01` §3.3. Siblings: `15` the world clock and compression; `27` saves,
the input log and content identity; `28` the client side of playback, the connection and assets; `29` the agent API
(MCP tools, commands, view fields, events, refusals); `32` benchmarks and measurements.

**Conventions.** Original-source paths are relative to `reference/stracciatella/src/game/`.

---

## 0. Overview

- **Logic and animation** (D4). What the original waits for is a schedule set by tables (frames × frame delay). The
  simulation counts these durations in ticks instead of waiting: decoupled from rendering and real time, every action
  still keeps its game-time duration, so outcomes stay the original's (§1–§3).
- **Time from outside** (D14). `advance` runs ticks until a stop condition; a driver decides when to call it: real time
  ×k for a viewer, instant (to the next stop at full CPU speed after every command) or manual (§4). Playback runs at
  any speed, down to "show the result".
- **The server is the source of truth** (D13). Sessions live in a Node server; the browser and agents are clients of
  one protocol, see only the player-view projection (D16) and act only through commands and decision answers (D15)
  (§5).

---

## 1. What the original waits for

The original's logic waits on animation frames whose count and delay come from tables (`ja2bin.dat`, `gAnimControl`;
`01` §3.4): a schedule, not rendering. Examples from the Gold 1.12 scripts
([`tools/spikes/ja2bin-timelines.py`](../tools/spikes/ja2bin-timelines.py) prints them from the user's file; its output
derives from the original's data and is not committed):

- `SHOOT_RIFLE_STAND`: the jam check and the fire opcode come before the first frame, so the shot leaves the moment the
  state is entered.
- `STANDING_BURST`: 15 frames × 100 ms with a fire opcode on every second frame: one bullet every 200 ms.
- `THROW_ITEM`: the grenade leaves on frame 9 of 14. `OPEN_DOOR`: the door opens on frame 10.
- `CLIMBUPROOF`: 44 frames × 30 ms, the climb commit at the very end; map vision stays off for those 1320 ms.

Frame delays depend on the soldier (`CalculateSoldierAniSpeed`, `Tactical/Soldier_Control.cc:4763`): a step, a shot
or a fall takes from about a hundred milliseconds to a few seconds. The original relies on the schedule itself: in
combat, soldiers the player cannot see animate on every pass of the loop (`01` §3.3), so playback speed never changes a
turn-based outcome.

---

## 2. Levels of decoupling

| Level | How it works | Instant and accelerated | Behaviour |
|---|---|---|---|
| 0. Original | Logic inside the frame loop, delays counted by the wall clock | No (except unseen enemies) | — |
| 1. Timelines as data (D4, built) | The simulation counts ticks and executes the gameplay markers; renders nothing | Yes: ticks run without playback | Same |
| 1b. Event jumping (not built) | Level 1, but the scheduler jumps to the next marker, tile or bullet step | Another 10–100× | Same |
| 2. Atomic actions (rejected) | A command resolves at once, the time inside the action is discarded | Yes | **Changes** |

Level 2 would lose: a burst at a falling target (later bullets aim at its new final height, `11`); real-time races
(who arrives, sees or steps into the bullet first); explosion damage delayed to the keyframe, chained explosions with
intervals, vision disabled during an explosion; vision disabled during a roof climb; an NPC cancelling a throw before
release without paying AP. Level 1 already gives instant execution and accuracy; 1b is an optimisation for when
profiling demands it, which it has not (§4.5).

---

## 3. Where the original depends on clocks, frames and sound

| Dependency | Where | ja2-node |
|---|---|---|
| Animation frames counted by the wall clock, re-armed from "now", no catch-up | `Utils/Timer_Control.cc:155-181` | Game-ms deadlines checked every tick, same reset points (deviations "Frame timers") |
| Unseen soldiers in combat: frame delay 0, speed = the loop rate | `Tactical/Soldier_Control.cc:4928-4936` | One frame per tick; only the pace of turn-based playback changes |
| Bullets: one step per frame, at most every `bulletSpeed/10` ms | `Tactical/LOS.cc:3155-3184` | One tile per tick (deviations "Bullet flight") |
| Throw physics: once per frame when the 20 ms counter is due | `TileEngine/Physics.cc:238` | Every 20 game ms (deviations "Physics cadence and floats") |
| Real-time AI: one soldier after more than 50 ms, more while less than 10 ms of CPU passed | `Tactical/Overhead.cc:109-110, 1039-1053` | Every AI slot after the cursor, every 55 game ms (deviations "Timing", `09`) |
| Real-time turn (bleeding, breath, smoke, light and opplist decay) after more than 5 s of wall clock | `Strategic/Strategic_Turns.cc:30-84` | Checked every 20 game ms, so it fires every 5020 ms (`src/sim/tactical/turns/turns.ts`) |
| Explosion damage at a tile-animation keyframe | `TileEngine/Explosion_Control.cc:205-209` | Frame k at k·(delay + 5) game ms (deviations "Explosion timing") |
| Wall-clock pauses and timers: the 3 s "enemy sighted on their turn", the 10 s before a lost battle unloads | `Tactical/OppList.cc:2588-2602`; `Tactical/Overhead.cc:4479` | The same durations in game ms (deviations "Enemy sighted on their turn", "Lost battle unload delay") |
| `DOOR_BUSY` and the bomb queue (`1000 + Random(500)` ms) | tile animations; `TileEngine/Explosion_Control.cc:2054-2095` | Not ported (gaps "Doors", "Duds and timed bombs") |
| Quote duration: the sample's length with speech on, 60 ms per character without, then 300 ms with the mouth closed | `Tactical/Faces.cc:629-636, 1233, 1304`; `Tactical/Dialogue_Control.cc:67, 1521` | The longer of the two for every viewer, from the rule pack's voice lengths (deviations "Speech") |
| Logic that waits for an empty quote queue: NPC hostility, the AI of Sergeant, Mike and Joe, notifications | `Tactical/OppList.cc:559`; `TacticalAI/AIMain.cc:281`; `Tactical/Overhead.cc:840, 6205` | The same queue, on ticks (`24`) |
| Message boxes and dialogues with choices | UI screens | Decision prompts (D15); time stands still until an answer (deviations "Prompt time") |
| Watchdogs at 15 and 25 s that break hangs | `TacticalAI/AIMain.cc:366-380`; `Tactical/Handle_UI.cc:405-419` | Not ported: a hang is a bug and fails the tests (deviations "Watchdogs") |
| Idle animations draw on the shared generator and change soldier state | opcode 491 | Not simulated (gaps "Random idle animations") |
| "Render visibility" `bLastRenderVisibleValue` | `Tactical/Overhead.cc:600-604` | Updated in the logic loop, not by rendering: a state field |

Logic depends on rendering nowhere (the one field named after rendering is a logic field), on the wall clock in a
finite list of places, all converted to game time, and on sound only through quote durations, replaced by data.
`deviations.md` §2 has every timing difference that follows.

---

## 4. Time control

### 4.1. Three clocks

- **Simulation game time**, in ticks of 5 ms (`TICK_MS`): the only thing an outcome depends on.
- **Wall-clock time**: only in the *driver*, which decides when to advance the simulation.
- **Playback time**: the client's; it lags behind the simulation or catches up with it at any speed.

### 4.2. `advance` and stop conditions

`advance` (`src/sim/advance.ts`) is a resumable `AdvanceRun` over the same `step()` the drivers use. A pending decision
is checked right after each step, before the watched events, and always stops the run; `meanwhileEnded` and
`endgameDeferred` always stop it too. A load in place sends subscribers `stopped {reason: 'loaded'}`; an agent's wait on
a real-time session ends with `timeout` (`29` §6). Every campaign report carries the world time. The stop reasons and
budgets are in `advance.ts`; the MCP `advance` tool describes its fields.

**On the strategic map** (the clock: `15`), any world-time field, `compressionStopped` or `mode` makes the advance
strategic. With time not compressed it first starts compression (a refusal ends it with `refused`), then steps until

1. a decision prompt opens (pre-battle, simultaneous arrival, NPC of note, contract, militia, NPC request);
2. compression stops (any `StopTimeCompression`, `15`): an `event` with `compressionStopped {reason}`. An automatic
   pause (a quote, an update box) leaves compression on but not running → `idle`. With `compressionStopped: false` the
   advance restarts compression after every stop and returns only at a decision, the target, a watched event, a
   refusal or the budget;
3. the world-time target: at the first tick where world seconds reach it the advance stops compression itself, as a
   player's click on that frame would, so the clock lands on the end of a 60 s slice, at most 59 s past the target; it
   emits `worldTimeReached`;
4. a watched event (`groupArrived`, `mercArrived`, `dayStarted`, …);
5. the budget (at least 2,000,000 ticks, at most 7 world days).

In tactical, `worldTime` and `worldSeconds` run real time (1 world second = 200 ticks); an advance with `mode` or
`compressionStopped` but no time target is refused there.

### 4.3. Drivers

| Driver | Who advances time | Purpose |
|---|---|---|
| Real time ×k | The server: ticks by the wall clock × k (`{mode: 'realtime', speed, pauseOn?}`) | A human in the browser |
| Instant | After every accepted command and on the switch, `advance` to `idle` or a decision at full CPU speed (`{mode: 'instant'}`) | The enemy turn "at once", autoresolve, tests |
| Manual | Only explicit `advance` calls (`{mode: 'manual'}`, the default of MCP sessions) | Agents, step-by-step debugging |

- **`pauseOn`.** A real-time driver with `pauseOn: EventType[]` stops on the tick of the first listed event, becomes
  `manual` and sends `stopped {id: 0, report}` with reason `event`; the input log records the batch as `advance
  {until: {ticks, events}}`, so a replay stops at the same tick.
- **Decisions.** On a decision (an interrupt in our favour with nobody acting, a prompt, an open conversation or shop)
  the real-time driver stays in real time, but its batches run no ticks, log nothing and drop the elapsed time; time
  runs on by itself once the decision is resolved. The game page itself switches a running real-time driver to manual
  while it shows something modal (`28` §3).
- **Equal outcomes.** Turn-based combat gives the same outcome under every driver; real time does too when commands
  arrive at the same ticks. An agent that orders while paused is a player with zero reaction time. The original can
  pause tactical play, but masks the screen and accepts no orders while paused (`Strategic/Game_Clock.cc:795-835`,
  `Tactical/Turn_Based_Input.cc:2126`): a small advantage for the player, not a rule change (deviations "Real-time
  pause"), and short-lived, since a spotted hostile switches the game to turn-based mode.

### 4.4. View frames and playback

Instead of gameplay events for the client to rebuild a picture from, the session sends **view frames**: every
`FRAME_TICKS` (10 ticks, 50 ms) it diffs the player view (`diffPlayerView`/`applyViewFrame`, `src/protocol/view.ts`)
and sends the changed and removed soldiers, every other changed view block whole, the events of that interval, the new
message entries (`29` §8), bullet positions and the presentation events stamped with the session tick (`29` §9). Fine
animation between frames comes from the animation schedule each soldier entry carries and the client's copy of the
scripts (`28` §3):

- a soldier whose silent animation the client can predict from its last sent slot is not resent for its frame alone
  (`keepPredictableFrames`, `src/server/frame-anchors.ts`); a capture without changes then sends an empty frame so the
  client's view tick keeps moving;
- while bullets fly or effects started in the last two seconds, a frame goes out every 10 ticks even when nothing else
  changed, so the client's effect clock runs until they end;
- with no subscriber the session builds and diffs no view (it still follows the music mode from the events at every
  frame point); the first subscriber's `welcome` becomes the base of the next diff.

An instant `advance` sends its frames at once; the client plays them at 1×, 4× or 16× or applies them immediately
("skip"): "unseen instantly, seen at 1×" is the original's own behaviour. While playback catches up, input is blocked,
as the original blocks the UI during actions. The input log is deterministic, so replay comes for free (§5.5).

### 4.5. CPU cost

A tick without decisions is a pass over the soldiers that compares deadlines; AI decisions (pathfinding on the 160×160
grid, line of sight) are the cost, as they were for the original on a Pentium 200. A whole enemy turn of a large
garrison runs in tens to hundreds of milliseconds under the instant driver, so event jumping (§2, level 1b) is not
needed. What does matter is that an unsliced instant turn blocks the server's event loop for its whole duration, hence
the time slicing and the worker host of §5.9. Benchmarks and measured turns: `32` §2.

---

## 5. The server as the source of truth

```
             ┌───────────────────── Node: ja2-server ──────────────────────┐
 browser ◄──►│ WebSocket    ┌──────────────── session ───────────────┐     │
 (client)    │              │ Sim (core) · time driver               │     │
 agent   ◄──►│ MCP          │ input log · saves                      │     │
 (Claude)    │              │ player-view projection · queries       │     │
 scripts ◄──►│ HTTP JSON    └────────────────────────────────────────┘     │
             │ rule pack · /vfs: media from JA2_DATA_DIR or the stub pack  │
             └─────────────────────────────────────────────────────────────┘
```

`src/server/main.ts` opens the data VFS (`JA2_DATA_DIR`, the stub pack, the project tables), detects the data version
(`29` §25), builds the rule pack (§5.10), opens the save environment and creates the default session `sandbox`.

### 5.1. Session

- A `Session` (`src/server/session.ts`) holds the simulation (`SessionSim`: the tactical sandbox or a
  `CampaignSession`), the driver, the subscribers, the input log, the presentation block (music, message ring,
  campaign identity) and its `QueryService`.
- `newSession` (MCP) and `POST /api/sessions` create sessions through `src/server/session-registry.ts`, up to a limit
  (`JA2_MAX_SESSIONS`). The default session `sandbox` is the A9 sandbox, a native save or a new campaign (`JA2_SEED`,
  `JA2_SAVE`, `JA2_CAMPAIGN` in `main.ts`).
- Logic content is read only through the server's rule pack (§5.10), never from the raw data; no graphic is read. The
  in-process host shares the pack, read-only, between sessions; the worker host loads it once per worker (§5.9).
- The world cache (`src/server/world-cache.ts`) prepares maps before each command (`Session.prepareAndDispatch`); the
  input log records the maps a preparation added, because the cache depends on history.

### 5.2. Protocol

One protocol for every client, in `src/protocol/messages.ts` (no DOM, no Node). The browser speaks it over the
WebSocket endpoint `/ws`; MCP and HTTP map onto the same `SessionHost` calls (§5.9).

| Client → server | Server → client |
|---|---|
| `hello` | `welcome`: the session, its instance, the view, the driver, the message log, the engine and rule-pack identity (§5.10); again after a load in place |
| `cmd` (prompt answers are commands of type `answer`) | `result`; `frames` (§4.4) |
| `query` (`29` §28) | `answer` |
| `advance` | `stopped` (`id` 0 for a driver's own stop) |
| `drive` (§4.3), `save`, `load` (`29` §26), `closeSession`, `leave` (`29` §6) | `result` |
| `ping` (`29` §30) | `pong` |
| | `closed` (`closed`, `lost` or `shutdown`); `error` |

A connection's replies follow the order of its requests, except `answer` and `pong`, which go out as soon as they are
ready. A request that fails is answered by `error` with its `id`; an `error` without one refuses the connection's
message (malformed, `no such session` for a hello).

**Session lifecycle on a connection** (`src/server/ws.ts`). `instance` is a random id of the session object: session
ids are reused after a close and after a restart, so a reconnecting client compares the instance, not the id. A closing
session sends `closed` to every viewer before it drops them: `closed` after `closeSession`, `DELETE /api/sessions/:id`
or the last `leave`, `lost` when its worker dies (also to a hello that reaches a dead worker, §5.9), `shutdown` when the
server stops. The socket stays open and may say hello again; until then requests get `error {id, 'say hello first'}`.
`leave` detaches the connection and closes the session only when no other connection watches it (the default session
stays). On SIGINT or SIGTERM the server closes every session with `shutdown`, flushes the saves, closes the sockets
with 1001 (going away) and then the HTTP server, which otherwise waits for open sockets. Messages are capped at 1 MiB
and compressed with `permessage-deflate`, the context kept between messages.

### 5.3. Player-view projection (D16)

- One `PlayerView` (`src/protocol/view.ts`) serves the browser and agents. The session adapters build it: the sandbox
  in `src/server/sandbox.ts` over the per-soldier and world views of `src/sim/tactical/`, a campaign in
  `src/server/campaign-session.ts` over the `*-view.ts` modules beside it.
- It holds the player's soldiers in full, only the soldiers the squad currently sees (`08`), heard noises as direction
  and loudness (never a tile), the doors, items and world state the player knows, and the modal blocks of a campaign
  (`29` §7).
- Unseen soldiers appear neither in the view nor in the events; events about them are reduced to what the squad hears
  (`29` §9). There is no omniscient view.
- Rule: a field exists only when an original screen shows it at that moment; hidden state (the Queen, facts, opinions,
  tolerances, dealer cash, profile whereabouts, the event queue) never appears (each domain's section of `29` names
  what stays hidden).

### 5.4. Queries

Queries run the simulation's own rule functions and change nothing. Cursor hints run over the **player-knowledge
projection** of the view the player gets, so hidden information does not leak; answers that depend on hidden state or
price a decision stay on the server. The browser computes the hints locally with the same code (`28` §4) and falls
back to the server. Kinds, channel and fairness: `29` §28.

### 5.5. Saves and the input log

`27` §1 owns saves, the snapshot codec, content identity, the input log and the server's save modules. What the server
guarantees:

- **Files.** Saves live on the server, addressed by name, never by path (`29` §26); native `.sav` files are read from
  the original's `SavedGames` folder (`JA2_SAVES_DIR`, `14`).
- **Input log.** Every session logs every input before running it; queries are never logged. A save writes the log
  beside the snapshot, and `pnpm cli replay <name>` re-runs it with the manual driver and compares the result with the
  save byte for byte: bug reports, regression tests, analysis of an agent's play. When a command or a step throws, the
  server writes the whole log as `Error.log.jsonl.gz` instead of an error save.
- **Saving changes nothing.** Before a campaign snapshot the campaign's undrained output events move into a buffer of
  the `Session` that the next advance reports first, so saving changes neither the state nor the reported events.

### 5.6. Determinism and multiple sessions

The determinism rules of `01` §2 and §3.2 hold for every session; several sessions share a process, so no layer keeps
mutable module state (the host contract test of §5.9 checks that two hosts give the same results).

### 5.7. Embedded mode

The core and the protocol depend on neither the DOM nor Node, so a session could run in a Web Worker in the browser
(a static demo on stubs). Not built; it stays possible as long as the layer boundaries hold.

### 5.8. Security

- `JA2_HOST` and `JA2_PORT` set the address (default `127.0.0.1:7420`).
- `/api`, `/vfs`, `/mcp` and `/ws` take the token of `.ja2/token` (or `$JA2_TOKEN`) as `Authorization: Bearer`, the
  HttpOnly cookie set by `/login?token=…`, or a `token` query. A Host check (`localhost`, `127.0.0.1`, `[::1]`) guards
  against DNS rebinding.
- The API accepts game commands and save names, never file paths from the client (`29` §26).

### 5.9. Heavy sessions: `SessionHost`

The server surfaces (MCP tools, the WebSocket endpoint, the HTTP routes) never touch a `Session`; they call a
`SessionHost` (`src/server/session-host.ts`), an asynchronous interface over the session's inputs and reads.
`JA2_SESSION_HOST` picks the implementation for every session of the server:

- **`inprocess`** (default, `InProcessHost`): the session runs in the server's thread.
  - *One queue per session.* Every input (commands, answers, advances, driver changes, saves, loads, the snapshot, the
    input log, close) runs in arrival order, one at a time, also when it arrives during an advance, so the input log's
    order is the execution order. Reads, queries and subscriptions answer at once, between ticks: during a long
    advance they show the state reached so far.
  - *Time slicing* (`src/server/slicing.ts`). An advance, the instant driver's included, runs in slices of 10 ms of
    wall-clock time, then yields. `AdvanceRun` checks the pause only between ticks, after at least one step and after
    the stop checks, so slicing decides where the server pauses, never what a tick does: ticks, events, frames,
    reports and snapshots equal those of an unsliced run (tested with a slice after every step). One `SliceScheduler`
    grants at most one slice per event-loop turn across sessions, so four battles in one process never run slices back
    to back, and commands that need no advance run at once. The frames collected so far go out at every pause, so
    viewers watch a long enemy turn as it happens. While a sliced input is paused the real-time driver skips its batch
    and catches up afterwards.
  - *What still blocks.* A single tick cannot be split: the longest AI decision of a tick is the floor. A save's
    snapshot and its serialization are synchronous (the gzip runs on the thread pool), and opening a session or loading
    a save builds its content.
- **`worker`** (`WorkerHost`, `src/server/worker-host.ts`; the worker is `src/server/session-worker.ts`): each session
  runs in its own `worker_threads` worker inside an `InProcessHost`, so ordering and reads are the same; calls and
  subscription messages cross by structured clone, no simulation object does. The worker opens its own data VFS and
  save environment with the server's engine identity and save directory and writes its save files itself (atomic
  renames, so two workers never leave a torn file); load problems keep their kind across the boundary. Each worker
  loads the content again, which costs memory per session; in return, battles, saves and loads of different sessions
  run on different cores and the server thread only relays. The Auto01/Auto02 alternation is per worker. A host whose
  worker died answers every call with that error, and `GET /api/sessions` lists it with the error.

`src/server/session-host-contract.test.ts` drives a scripted stub battle with a save, an autosave and a load, calls
made without waiting, and Dead is Dead through both hosts and expects the same results, frames, snapshots, input logs,
save files and (apart from the times) health. Stalls and costs of both hosts: `32` §2.

### 5.10. The rule pack and the assets

The game data splits into the **rule pack** (everything the simulation reads) and media, which only clients read
(`28` §5).

**The pack** (`src/content/rules/`; built by `src/server/rule-pack.ts`) holds:
- the rule files: the project tables, the animation scripts, `ja2set.dat`, `prof.dat`, `Locks.bin`, maps, structure
  files, NPC records, text files and stub profiles, under any root;
- the **graphic facts** (`src/content/rules/graphic-facts.ts`): the frame geometry and app data of every tileset
  surface and the frame counts of every explosion graphic, so the simulation never decodes an STI;
- the **voice lengths**: the length of every speech sample from its WAV header (`src/content/audio/speech-lengths.ts`,
  `29` §14), so no line waits for audio;
- the layer count of each rule file present in several VFS layers, which the NPC record layering reads.

`RulePack.read` answers from the pack and throws `NotARuleFileError` for any other path, so a rule that reaches for a
graphic fails at once. Raw readers (tests, oracle tools, benchmarks) derive the facts on demand (`withGraphicFacts`,
`withSpeechLengths`).

**Identity.** The pack hash (`rulePackHash`, `src/content/rules/pack.ts`) covers only the **game data**: entries whose
winning VFS layer is the data folder or an SLF archive on the original data, the stub pack on the stubs
(`isIdentityLayer`). The project tables and, on the original data, the stub pack stay in the pack but out of the hash:
they ship with the engine, whose version and commit the save header and `welcome` carry. Text files count by presence
only, since quote lengths have their own identity. A file's hash is the asset manifest's, so a client computes the pack
hash from the manifest and a few small rule files. How a load checks the identity: `27` §1.4.

**Cache.** The server builds the pack at start into `.ja2/cache/` (`JA2_CACHE_DIR` moves it) and finds it again by a
key over every VFS file's path, size, layer count and stamp, so any change of the data rebuilds it; the server, the
workers and `pnpm cli replay` load content only through the pack, and tests build packs in memory.

**On the wire.** `welcome` carries the engine identity and the rule identity (the pack hash and the content hash of the
animation scripts); a client compares them with its own code and data (`src/app/rules/client-rules.ts`).
`/api/health` names the pack, the engine, the data version and the default language.

**Assets.**

- **`GET /api/assets/manifest`** (`src/server/assets-manifest.ts`, format in `src/protocol/assets.ts`) lists the VFS
  layers and every file with its size, content hash and winning layer, gzipped when accepted and revalidated by ETag.
  The hashes persist in `.ja2/cache/vfs-hashes.json` by file stamp, so a restart reads no file again. `GET /api/vfs`
  lists the files for tools.
- **`GET /vfs/@<hash>/<path>`** is immutable when `<hash>` is the file's current hash and 404 when it is not (the client
  falls back to the plain URL, `src/app/net/vfs.ts`), so the HTTP cache keeps media across sessions and restarts. Plain **`/vfs/<path>`** stays
  for tools and agents, revalidated with the content hash as a strong ETag. Both take the token and serve ranges. A
  whole-file read is gzipped when that pays (`src/server/vfs-gzip.ts`: not already compressed, at least 1 KB, at least
  10% smaller; kept in memory by hash). On the stubs `/vfs/<path>` falls back to `stubs/<path>`, so stub media and
  text answer under the original names (`32` §1.4).
- **The built client** (`dist/client`, `pnpm build`), when present, is served gzipped, hashed files as immutable.
  Remotely it is the cheaper way to play: the Vite dev server sends some 700 modules and revalidates each on every
  opening, the built client a few dozen files once.

---

## 6. Cost and limitations

- **Discipline.** In the original much logic lives in the screens (hiring on the laptop, trading, drag-and-drop
  inventory, map assignments, dialogues); all of it is lifted into commands and decision prompts with no corners cut at
  the boundary (D15). In return headless tests, automated playtesting by an agent, replays and debugging use the same
  API.
- **Real time over the network.** On localhost the input latency is the playback buffer (~50–100 ms), unnoticeable for
  JA2. Remote play works (the built client, compressed `/vfs`, §5.10) but is not a goal.
- **License.** A server for yourself, on your own machine or at home: allowed. A public server with the original data
  distributes commercial assets: not allowed. A public server on stubs: allowed non-commercially, with the SFI-SCLA
  text.
- **Non-goals:** real-time control by an LLM agent without pausing; bit-exact replay compatibility with the native game.

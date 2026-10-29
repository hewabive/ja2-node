# 04 — Time and the server

**Conventions.** Original-source paths (`Tactical/…`, `TileEngine/…`, `TacticalAI/…`, `Strategic/…`, `Utils/…`) are
relative to `reference/stracciatella/src/game/` (Stracciatella `ae6bf01`). §1 takes its numbers from `Ja2bin.dat` of
the Steam release 1.12 (Build 04.12.02).

**Scope.** How the simulation is decoupled from rendering and the wall clock (§1–§3), time control (§4) and the server:
sessions, protocol, player-view projection, saves, session hosts, the rule pack and assets (§5). Supplements
`01` D13–D16. The agent API (MCP tools, commands, view fields, events, refusals) is `29`; saves and the input log in
detail are `27` §1.

---

## 0. Overview

- **Logic and animation** (D4). What the original waits for is a schedule set by tables (frames × frame delay). The
  simulation counts these durations in ticks instead of waiting: decoupled from rendering and real time, every action
  still keeps its game-time duration, so outcomes stay the original's (§1–§3).
- **Time from outside** (D14). `advance` runs ticks until a stop condition; a driver decides when to call it: real time
  ×k for a viewer, instant (to the next stop at full CPU speed after every command) or manual (§4). An enemy turn costs
  tens to hundreds of milliseconds of CPU; playback runs at any speed, down to "show the result".
- **The server is the source of truth** (D13). Sessions live in a Node server; the browser and agents are clients of
  one protocol, see only the player-view projection (D16) and act only through commands and decision answers (D15)
  (§5). Agents connect over MCP (`29`).

---

## 1. What is coupled: numbers from `Ja2bin.dat`

[`tools/spikes/ja2bin-timelines.py`](../tools/spikes/ja2bin-timelines.py) parses `Ja2bin.dat` with the sources'
`gAnimControl` table (its output derives from the original's data and is not committed). The file holds 308 non-empty
scripts of 311 animation states and 144 distinct opcodes, 54 of which affect gameplay (opcode table: `01` §3.4).
Examples:

- `SHOOT_RIFLE_STAND`: 4 frames × 100 ms; the misfire check (470) and the fire opcode (430) come before the first frame,
  so the shot happens the moment the state is entered.
- `STANDING_BURST`: 15 frames × 100 ms, fire on frames 0, 2, 4, 6, 8, 10: one bullet every 200 ms.
- `THROW_ITEM`: the grenade is released (460) on frame 9 of 14. `OPEN_DOOR`: the door opens (495) on frame 10.
- `CLIMBUPROOF`: 44 frames × 30 ms, the climb commit (408) at the very end.

Durations for a merc with 80 agility, full health and full breath on flat ground (frame delay from
`CalculateSoldierAniSpeed`, `Tactical/Soldier_Control.cc:4763`):

| Action | Game time | 5 ms ticks |
|---|---|---|
| One tile walking, turn-based / real time | ≈120 / ≈245 ms | 24 / 49 |
| One tile running | ≈70 / ≈140 ms | 14 / 28 |
| One tile crawling | ≈220 / ≈455 ms | 44 / 91 |
| Aimed shot, order to bullet, no turning | 750 ms | 150 |
| Snap shot | 350 ms | 70 |
| 6-round burst | 1500 ms | 300 |
| Grenade, order to release | 720 ms | 144 |
| Open a door | 700 ms | 140 |
| Climb onto a roof (map vision disabled throughout) | 1320 ms | 264 |
| Falling forward after a hit, until "death or release" | 2280 ms | 456 |

The game waits for hundreds of milliseconds set by tables: a schedule ("150 ticks after the order, the fire marker"),
not rendering. The original relies on it itself: in turn-based combat soldiers the player cannot see get a frame delay
of 0 and animate on every pass of the loop (`Tactical/Soldier_Control.cc:4928–4936`), so playback speed never affects a
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
intervals, vision disabled during an explosion; the "door busy" window and vision disabled during a roof climb; an NPC
cancelling a throw before release without paying AP. Level 1 already gives instant execution and accuracy; 1b is an
optimisation for when profiling demands it, which it has not (§4.5).

---

## 3. Audit: where the original depends on things the simulation does not have

| Dependency | Where in the code | ja2-node |
|---|---|---|
| Animation frames counted by the wall clock, no catch-up | `Utils/Timer_Control.cc:155–181` | Ticks: "an ideal machine that never drops frames" |
| Unseen enemies in combat: frame delay 0, speed = the loop rate | `Tactical/Soldier_Control.cc:4928–4936` | One frame per tick; changes only the pace of turn-based playback |
| Bullet: one step no more often than every `bulletSpeed/10` ms and once per loop frame | `TileEngine/LOS.cc:3155–3184` | N tiles per tick, deterministically (deviation) |
| Real-time AI: "how many soldiers fit into 10 ms of CPU" | `Tactical/Overhead.cc:1041–1052` | A fixed number of soldiers per pass (deviation) |
| 3 s pause "enemy sighted on their turn" | `Tactical/OppList.cc:2588–2602` | Playback only; the simulation does not wait |
| Quote duration: the sound's length with speech on, 60 ms per character without, then 300 ms with the mouth closed | `Tactical/Faces.cc:629–636, 1233, 1304`; `Tactical/Dialogue_Control.cc:67, 1521` | The longer of the sample's length (the rule pack's voice lengths) and 60 ms per character, plus 300 ms; the viewer that finishes the line first ends it (`29` §14) |
| Logic waits for an empty quote queue: NPC hostility, the AI of Sergeant, Mike and Joe, notifications | `Tactical/OppList.cc:559`; `TacticalAI/AIMain.cc:281`; `Tactical/Overhead.cc:840, 6205` | "Speech channel busy until tick T", T as in the row above |
| Message boxes and dialogues with choices | UI screens | Decision prompts (D15); time stands still until an answer |
| Deferred calls at 2, 3 and 10 s; bomb queue `1000 + Random(500)` ms | `Tactical/Overhead.cc:5069–5073, 6210`; `TileEngine/Explosion_Control.cc:2054–2095` | Ticks |
| Watchdog timers at 15 and 25 s (break hangs) | `TacticalAI/AIMain.cc:366–380`; `Tactical/Handle_UI.cc:405–419` | Not ported: a hang is a bug and fails the test |
| Idle animations consume the shared RNG and change soldier state | opcode 491 | Client only, the `fx` stream |
| "Render visibility" `bLastRenderVisibleValue` | `Tactical/Overhead.cc:602–634` | Updated in the logic loop, not by rendering: a state field |

Logic depends on rendering nowhere (the one field named after rendering is a logic field), on the wall clock in a
finite list of places, all converted to ticks, and on sound only through quote durations, replaced by data
(`deviations.md`).

---

## 4. Time control

### 4.1. Three clocks

- **Simulation game time**, in ticks of 5 ms (`TICK_MS`): the only thing an outcome depends on.
- **Wall-clock time**: only in the *driver*, which decides when to advance the simulation.
- **Playback time**: the client's; it lags behind the simulation or catches up with it at any speed.

### 4.2. `advance` and stop conditions

```ts
interface StopCondition {                // src/sim/advance.ts
  idle?: true;                           // our soldiers idle; in combat: our turn again, nobody of ours acting
  events?: SimEventType[];               // stop after the step that emitted one of them
  ticks?: number;                        // at most N ticks
  worldTime?: number | { day: number; hour?: number; minute?: number };  // campaign: world seconds or a clock time
  worldSeconds?: number;                 // campaign: relative to now
  compressionStopped?: boolean;          // campaign: stop whenever compression stops (default true)
  mode?: number;                         // campaign: compression mode to start (2, 3, 4)
}
interface StopReport { tick; reason; events; worldTime?: { day, hour, minute, seconds }; refusal? }
```

`advance` is a resumable `AdvanceRun` over the same `step()` the drivers use. Reasons: `decision` (a pending decision,
`29` §5; checked right after each step, before the watched events; a decision always stops), `event` (a listed event;
`meanwhileEnded` and `endgameDeferred` always stop), `idle`, `ticks`, `worldTime`, `budget`, `refused` (with `refusal`:
a modal flow is open or compression was refused), `ended` (the campaign is won, `29` §24) and, at the session layer,
`timeout` (an agent's wait on a real-time session, `29` §6). A load in place sends subscribers
`stopped {reason: 'loaded'}` (`SessionStopReason`, `src/protocol/messages.ts`). Every campaign report carries
`worldTime`.

**Budgets.** Tactical: 200,000 ticks by default (`DEFAULT_ADVANCE_BUDGET_TICKS`; the MCP `ticks` field is capped at
200,000). Any of `worldTime`, `worldSeconds`, `compressionStopped` or `mode` makes the advance strategic: at least
2,000,000 ticks, at most 7 world days.

**On the strategic map** (the clock: `15`): with time not compressed the advance first starts compression (with
`mode` if given; a refusal ends it with `refused`), then steps until

1. a decision prompt opens (pre-battle, simultaneous arrival, NPC of note, contract, militia, NPC request) → `decision`;
2. compression stops (any `StopTimeCompression`, `15`) → `event` with `compressionStopped {reason}`. An automatic
   pause (a quote, an update box) leaves compression on but not running (`isTimeBeingCompressed` is false while
   paused) → `idle`. With `compressionStopped: false` the advance instead restarts compression after every stop and
   returns only at a decision, the target, a watched event, a refusal or the budget;
3. the world-time target: at the first tick boundary where world seconds ≥ target the advance stops compression itself
   (a player's click on that frame, so the clock lands on a slice end at most 59 s past the target), emits
   `worldTimeReached {seconds}` and returns `worldTime`;
4. a watched event (`groupArrived`, `mercArrived`, `mineIncome`, `dayStarted`, …);
5. the budget; on the map with compression no longer running, `idle`.

In tactical, `worldTime` and `worldSeconds` run real time (1 world second = 200 ticks); an advance with `mode` or
`compressionStopped` but no time target is refused there. Compression events: `compressionStarted {mode}`,
`compressionStopped {reason}`, `dayStarted {day}`. Reasons (`CompressionStop`, `src/sim/strategic/time/world-clock.ts`):
`arrived`, `halted`, `battle`, `mercArrived`, `mercDied`, `mercLeft`, `assignmentDone`, `militiaTraining`,
`mineEvent`, `complaint`, `contract`, `requested`, `mapExit`, `helicopter`, `shipment`, `worldTime`, `paused` (the
map's automatic pause when compression stops being allowed), `meanwhile`.

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
  while it shows something modal (`28` §1.4).
- **Equal outcomes.** Turn-based combat gives the same outcome under every driver; real time does too when commands
  arrive at the same ticks. An agent that orders while paused is a player with zero reaction time. The original can
  pause tactical play, but masks the screen and accepts no orders while paused (`Strategic/Game_Clock.cc:795–835`,
  `Tactical/Turn_Based_Input.cc:2126`): a small advantage for the player, not a rule change (deviation "Real-time
  pause"), and short-lived, since a spotted hostile switches the game to turn-based mode.

### 4.4. View frames and playback

Instead of gameplay events for the client to rebuild a picture from, the session sends **view frames**: every
`FRAME_TICKS` (10 ticks, 50 ms) it diffs the player view (`diffPlayerView`/`applyViewFrame`, `src/protocol/view.ts`)
and sends a `ViewFrame`: the changed and removed soldiers, every other changed view block (whole), the events drained
in that interval (`events`, on the frame of their tick), the new message entries (`messages`, `29` §8), bullet
positions (`bullets`) and the presentation events stamped with the session tick (`effects`, `29` §9). Fine animation
between frames comes from the animation schedule each soldier entry carries (`frameSlot`, `stateTick`, `frameDelay`,
`nextFrameTick`) and the client's copy of the scripts (`28` §2.3):

- a soldier whose silent animation the client can predict from its last sent slot is not resent for its frame alone
  (`keepPredictableFrames`, `src/server/frame-anchors.ts`); a capture without changes then sends an empty frame so the
  client's view tick keeps moving;
- while bullets fly or effects started in the last two seconds, a frame goes out every 10 ticks even when nothing else
  changed, so the client's effect clock runs until they end;
- with no subscriber the session builds and diffs no view (it still follows the music mode from the events at every
  frame point); the first subscriber's `welcome` becomes the base of the next diff.

An instant `advance` sends its frames at once as a compact stream; the client plays it at 1×, 4× or 16× or applies it
immediately ("skip"): "unseen instantly, seen at 1×" is the original's own behaviour. While playback catches up, input is
blocked, as the original blocks the UI during actions. The input log is deterministic, so replay comes for free (§5.5).

### 4.5. CPU cost

**Estimate.** A turn of 15 enemies who move ~6 tiles (≈0.7 s), shoot (0.35–1.15 s) and get a reaction (0.4–2.3 s)
is 30–60 s of game time, 6,000–12,000 ticks. A tick without decisions is a pass over 30–60 soldiers incrementing
accumulators (microseconds); AI decisions (pathfinding on the 160×160 grid, LOS) are the cost, and the original ran
them in real time on a Pentium 200.

**Measured** on A9 with the original data, one core of an AMD EPYC 9354 VM, the instant driver (`advance … idle`
after `endTurn`), wall time of the whole enemy side including civilians:

| Garrison | Enemy turn | Ticks (game time) |
|---|---|---|
| 4 soldiers + 2 civilians | 1–90 ms, most under 50 ms | 40–1,000 (0.2–5 s) |
| 16 soldiers + 2 civilians | 2–370 ms, typically 100–250 ms while all are alive | 100–4,900 (0.5–25 s) |

AI decisions dominate; event jumping is not needed. `pnpm cli bench enemy-turn` (the A9 save and a generated arena with
8–32 enemies) and the `server` scenario measure it (`32` §2.1, `32` §2.2). An unsliced instant enemy turn blocks the
event loop for its whole duration (0.3 s for one battle, 1.2 s with four in one process), hence the time slicing and
the worker host of §5.9; the stalls and turn costs with slicing are in `32` §2.2.

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
- `newSession` (MCP) and `POST /api/sessions` create sessions through `src/server/session-registry.ts`: at most 16
  (`JA2_MAX_SESSIONS`). The default session `sandbox` is the A9 sandbox with seed `JA2_SEED` (default 1), the native
  save `JA2_SAVE`, or a new campaign of difficulty `JA2_CAMPAIGN`.
- Logic content is read only through the server's rule pack (§5.10), never from the raw data; no graphic is read. The
  in-process host shares the pack, read-only, between sessions; the worker host loads it once per worker (§5.9).
- `WorldCache` prepares maps before each command (`Session.prepareAndDispatch`); the input log records the maps a
  preparation added (`prepare`).

### 5.2. Protocol

One protocol for every client, in `src/protocol/` (no DOM, no Node). The browser speaks it over the WebSocket endpoint
`/ws`; MCP and HTTP map onto the same `SessionHost` calls (§5.9).

| Client → server (`ClientMessage`) | Server → client (`ServerMessage`) |
|---|---|
| `hello {session?}` | `welcome {session, instance, view, driver, messages, engine {version, commit}, rules {pack, scripts}, campaign?}`, also after a load in place |
| `cmd {id, cmd}` (prompt answers are commands of type `answer`) | `result {id, ok, reason?, data?}`; `frames {frames: ViewFrame[]}` (§4.4) |
| `query {id, q}` (`29` §28) | `answer {id, ok, tick, reason?, data?}` |
| `advance {id, until}` | `stopped {id, report}` (`id` 0 for a driver's own stop) |
| `drive {id, driver}` (§4.3) | `result` |
| `save {id, name?, description?}`, `load {id, name, reseed?}` (`29` §26) | `result` (`data` the outcome, `reason` the refusal code) |
| `closeSession {id}` (`29` §6) | `result` |
| `leave {id}` (`29` §6) | `result {data: {closed}}` |
| `ping {id}` (`29` §30) | `pong {id, health?}` |
| | `closed {session, reason}`: `closed`, `lost` or `shutdown` |
| | `error {id?, message}` |

A connection's replies follow the order of its requests, except `answer` and `pong`, which go out as soon as they are
ready. A request that fails is answered by `error` with its `id`; an `error` without one refuses the connection's
message (malformed, `no such session` for a hello).

**Session lifecycle on a connection** (`src/server/ws.ts`). `instance` is a random id of the session object
(`Session.instance`): session ids are reused after a close and after a restart, so a reconnecting client compares the
instance, not the id. A closing session sends `closed` to every viewer before it drops them: `closed` after
`closeSession`, `DELETE /api/sessions/:id` or the last `leave`, `lost` when its worker dies (also to a hello that reaches
a dead worker, §5.9), `shutdown` when the server stops. The socket stays open and may say hello again; until then
requests get `error {id, 'say hello first'}`. `leave` detaches the connection and closes the session only when no
other connection watches it (`SessionHost.viewers`; the default session stays). On SIGINT or SIGTERM the server closes
every session with `shutdown`, flushes the saves, closes the sockets with 1001 (going away) and then the HTTP server,
which otherwise waits for open sockets. Messages are at most 1 MiB; `permessage-deflate` compresses messages from 128 bytes on, with the context kept
between messages. A frame resends every field of a changed soldier, so an idle A9 sandbox in real time streams about
25 frames a second for the breathing animation alone: 40 KB/s uncompressed, about 1 KB/s compressed.

### 5.3. Player-view projection (D16)

- One `PlayerView` (`src/protocol/view.ts`) serves the browser and agents. The session adapters build it:
  `tacticalPlayerView` (`src/server/sandbox.ts`; per-soldier fields in `src/sim/tactical/soldier-view.ts`, the world
  in `src/sim/tactical/world-view.ts`) and `CampaignSession.view()` (`src/server/campaign-session.ts` with
  `strategic-view.ts`, `battle-view.ts`, `contract-view.ts`, `laptop-view.ts`, `helicopter-view.ts`,
  `map-screen-view.ts`, `personnel-view.ts`, `quest-view.ts`).
- It holds the player's soldiers in full, only the soldiers the squad currently sees (`bVisible ≥ 0`, `08`), heard
  noises as direction and loudness (never a tile), the doors, items and world state the player knows, and the modal
  blocks of a campaign (`29` §7).
- Unseen soldiers appear neither in the view nor in the events; events about them are reduced to what the squad hears
  (`29` §9). There is no omniscient view.
- Rule: a field exists only when an original screen shows it at that moment; hidden state (the Queen, facts, opinions,
  tolerances, dealer cash, profile whereabouts, the event queue) never appears (each domain's section of `29` names
  what stays hidden).

### 5.4. Queries

Queries run the simulation's own rule functions and change nothing. Cursor hints run over the **player-knowledge
projection** of the view the player gets, so hidden information does not leak; answers that depend on hidden state or
price a decision stay on the server. The browser computes the hints locally with the same code (`28` §2.4) and falls
back to the server. Kinds, channel and fairness: `29` §28.

### 5.5. Saves and the input log

`27` §1 owns saves, the snapshot codec, content identity and the input log; the server side:

- **Files.** Saves live on the server (`$JA2_SAVE_DIR`, default `.ja2/saves/`), addressed by name, never by path
  (`29` §26). Native `.sav` files are read from `$JA2_SAVES_DIR` (`14`, `27` §1.6).
- **Input log.** Every session logs every input before running it (`src/server/input-log.ts`, kinds in `27` §1.7);
  queries are never logged. A save of a session with a known origin also writes `<name>.log.jsonl.gz`, which
  `pnpm cli replay <name>` re-runs with the manual driver and compares with the save byte for byte: bug reports,
  regression tests, analysis of an agent's play. When a command or a step throws, the server writes the whole log as
  `Error.log.jsonl.gz` instead of an error save.
- **Holding events.** Before a campaign snapshot the campaign's undrained output events move into a buffer of the
  `Session` that the next advance reports first, so saving changes neither the state nor the reported events
  (`27` §1.2).
- **Modules** (`src/server/`): `save-file.ts` (the file format; the migration chain `SAVE_MIGRATIONS` runs before the
  snapshot's own `migrateSnapshot`), `content-identity.ts` (`ContentLedger`, the text identity, `engineIdentity`),
  `save-store.ts` (names, reserved files, autosave alternation, Dead is Dead backups, atomic writes through a temporary
  file and a rename, the list, native headers), `save-rules.ts` (`CanGameBeSaved`, the refusals, the Dead is Dead
  conditions and save points, `saveStatus`), `save-service.ts` (saves, loads, autosaves, upload, download, the error
  log; attached through `Session.hooks`, which only read the simulation), `session-factory.ts` and
  `save-environment.ts` (the session factory, also from a log origin; the wiring shared by the server, the workers and
  the CLI), `repository-history.ts` (version 1 saves, `27` §1.4).
- **Snapshots** are versioned (`SNAPSHOT_VERSION` 11, `src/sim/snapshot/session.ts`); restore migrates older ones step
  by step with neutral values for new fields (`27` §1.3).

### 5.6. Determinism and multiple sessions

- `tools/check-imports.ts` bans `Math.random`, `Date.now`, `new Date`, `performance.now` and timers in `core`, `content`
  and `sim`.
- Trigonometry is not replaced: movement, sight and throws call `Math.sin`, `Math.cos` and `Math.atan2` and round to
  float32 where the original uses float math (deviation "Physics cadence and floats"); V8 computes them with its own
  fdlibm-derived code on every platform.
- No global mutable module state: several sessions share a process (the host contract test of §5.9 checks it).

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
`SessionHost` (`src/server/session-host.ts`), an asynchronous interface: `dispatch`, `prepareAndDispatch`, `query`,
`advance`, `setDriver`, `subscribe`, `save`, `saveSnapshot`, `load`, `describe`, `observe`, `report` (what a new
session reports once: the load outcome, the native import report), `snapshot`, `inputLog`, `profiles`, `health` and
`close`. `JA2_SESSION_HOST` picks the implementation for every session of the server:

- **`inprocess`** (default, `InProcessHost`): the session runs in the server's thread.
  - *One queue per session.* Every input (commands, answers, advances, driver changes, saves, loads, the snapshot, the
    input log, close) runs in arrival order, one at a time, also when it arrives during an advance, so the input log's
    order is the execution order. Reads (`describe`, `observe`, `report`, `health`), `query` and `subscribe` answer at
    once, between ticks: during a long advance they show the state reached so far.
  - *Time slicing* (`src/server/slicing.ts`). An advance, the instant driver's included, runs in slices of
    `SLICE_BUDGET_MS` (10 ms) of wall-clock time, then yields. `AdvanceRun.resume(pause)` checks the pause predicate
    only between ticks, after at least one step and after the stop checks; the session's inputs are generators that
    yield at those pauses (the synchronous `Session.dispatch`, `advance` and `setDriver` used by replay, bench and tests
    drive them without pausing). Slicing decides where the server pauses, never what a tick does: ticks, events,
    frames, reports and snapshots equal those of an unsliced run (tested with a slice after every step). One
    `SliceScheduler` grants at most one slice per event-loop turn across sessions: an advance claims a turn before its
    first slice and waits when another session already ran a slice in that turn or is waiting; a taken turn closes at
    the next check phase. So four battles in one process never run slices back to back, and commands that need no
    advance run at once. The frames collected so far go out at every pause, so viewers watch a long enemy turn as it
    happens. While a sliced input is paused the real-time driver skips its batch and catches up afterwards.
  - *What still blocks.* A single tick cannot be split: the longest AI decision of a tick (about 30 ms warm, 65 ms in a
    cold process) is the floor. A save's snapshot and its stringify are synchronous (40–70 ms each on the largest
    native import, also for the autosave at `endTurn`); the gzip runs on the thread pool. Opening a session and loading
    a save build the content (0.2–0.5 s).
- **`worker`** (`WorkerHost`, `src/server/session-worker.ts`): each session runs in its own `worker_threads` worker
  inside an `InProcessHost`, so ordering and reads are the same; calls and subscription messages cross by structured
  clone, no simulation object does. The worker opens its own data VFS and save environment with the server's engine
  identity and save directory (`openSessionEnvironment`) and writes its save files itself (atomic renames, so two
  workers never leave a torn file); load problems keep their kind across the boundary (`SaveLoadError`). Each worker
  loads the content again (about 100–140 MB more RSS per session on the original data) and builds its own content
  index on its first save; in return, battles, saves and loads of different sessions run on different cores and the
  server thread only relays. The Auto01/Auto02 alternation is per worker. A host whose worker died answers every call
  with that error, and `GET /api/sessions` lists it with the error.

`src/server/session-host-contract.test.ts` drives a scripted stub battle with a save, an autosave and a load, calls
made without waiting, and Dead is Dead through both hosts and expects the same results, frames, snapshots, input logs,
save files and (apart from the times) health.

### 5.10. The rule pack and the assets

The game data splits into the **rule pack** (everything the simulation reads) and media (`28` §1.3, `28` §2.5).

**The pack** (`src/content/rules/pack.ts`, `families.ts`, `graphics.ts`, `rule-reader.ts`; built by
`src/server/rule-pack.ts`):

| Part | Content |
|---|---|
| Rule files | `externalized/**.json`, `tables/**.json`; `binarydata/{ja2bin.dat, ja2set.dat, prof.dat, locks.bin}` and `maps/*.dat` under any root (the stub ones included); every `.jsd`, `.npc` and `.edt`; `stubs/profiles.json` |
| Graphic facts | `@rules/graphics/<path>.json` (`src/content/rules/graphic-facts.ts`): frame offsets and widths, app data and kind (indexed, RGB, stub sprite, not an STI, broken) of every tileset surface of every tileset under every map root (`ja2set.dat` × `tables/tiles.json`) and every explosion graphic of `externalized/explosion-animations.json`; `loadTileSurfaceGeometry` and `loadExplosionContent` read them, so the simulation never decodes an STI |
| Voice lengths | `@rules/speech/lengths.json`: the length of every sample of `npc_speech/` and `speech/` (the stub pack's behind the data's), from the WAV headers (`src/content/audio/speech-lengths.ts`, `29` §14) |
| Layer counts | per rule file present in several VFS layers (the NPC record layering reads them) |
| Read | `RulePack.read`, `exists`, `layers` answer from the pack and throw `NotARuleFileError` for any other path; `liveRuleReader` does the same over any listing (the client) |

Raw readers (tests, oracle tools, benchmarks) derive the facts on demand (`withGraphicFacts(read)`,
`withSpeechLengths(read, vfs)`); the render path still decodes pictures. At load the animation scripts split
(`splitAnimationScripts`, `src/content/anim/timelines.ts`) into a **logic timeline** the simulation steps (per slot:
frame, empty, opcode, jump, state transition, or an empty step for the sound-range codes no handler acts on, at the same
position so jumps and opcode skips are unchanged) and a **presentation timeline** (sprite frame and sound code per
slot) from which views take `frame`. Soldiers keep `frameSlot` (`NO_FRAME_SLOT` before a state's first frame,
`OUTSIDE_SCRIPT_SLOT` past the script); the native import maps a saved frame to its slot (`frameSlotOfSpriteFrame`).

**Identity.** The pack hash is a SHA-256 over the lines `ja2-node-rules 2`, `source <original|stubs>`, `f <path>
<size> <hash>` per rule file, `p <path>` per text file (presence only: quote lengths are the separate text identity, so
a text change only warns), `g <graphic> <size> <hash>` per graphic fact, `l <path> <count>` per layer count. `<hash>`
is the first 16 hex digits of the file's SHA-256, the asset manifest's hash, so a client computes the pack hash from
the manifest and three small rule files. The hash covers only the **game data**: entries whose winning VFS layer
(`isIdentityLayer`) is the data folder or an SLF archive on the original data, the stub pack on the stubs. The project
tables (`ja2-node-data`) and, on the original data, the stub pack stay in the pack but out of the hash: they ship with
the engine, whose version and commit the save header and `welcome` carry (`engineDiffers`). A save of another identity
is refused on the original data (`contentMismatch`) and loads with the warning `stubPackDiffers` on the stubs, whose
pack the repository regenerates (load check: `27` §1.4). The manifest also records an `allLayersHash` (format line
`ja2-node-rules 1`, over every entry), which names the cache directory and is accepted from older saves. Version 1
saves (0.7.0) are checked by the 0.7.0 hash over their `legacyContent` file list (`ContentLedger.logicHash`), with the
non-identity entries taken as saved (`ja2-node-data` files from the repository's history at the save's commit,
`src/server/repository-history.ts`; `27` §1.4); `src/server/fixtures/` holds a campaign and a sandbox of that version
with their views (`legacy-save.test.ts`).

**Cache.** The server builds the pack at start into `.ja2/cache/rules-<allLayersHash>/` and finds it again through
`.ja2/cache/rules-index.json`, keyed by a SHA-256 over the format, facts and family versions, the source and every VFS
file's path, size, layer count and stamp (SLF entry: archive path, size, mtime, offset, length; loose file: path, size,
mtime), so any change of the data rebuilds it. Four packs are kept; `JA2_CACHE_DIR` moves the cache. The server, the
workers and `pnpm cli replay` load content only through the pack; tests build packs in memory. Original data: 4,548
entries (2,574 rule files, 1,974 facts), 118 MB, built in 1.9 s, loaded from the cache in 0.1 s; stubs: 477 entries,
29 MB, 0.3 s.

**On the wire.** `welcome` carries `engine {version, commit}` and `rules {pack, scripts}` (the scripts hash: the
content hash of the animation scripts file); a client compares them with its own code and data
(`src/app/rules/client-rules.ts`). `/api/health` names the pack, the engine, `dataVersion` and the default `language`.

**Assets.**

- **`GET /api/assets/manifest`** (`src/server/assets-manifest.ts`, `src/protocol/assets.ts`) → `{format:
  'ja2-node-assets', version: 2, source, stubText, layers, files}`: `layers` the VFS layers in priority order, `files`
  `[path, size, hash, layer]` per file (`[…, layers]` when the path is in several), `layer` the winning layer's index,
  `hash` the first 16 hex digits of the SHA-256; gzipped when accepted, revalidated by ETag. `VfsHashes` hashes on
  demand and keeps the hashes in `.ja2/cache/vfs-hashes.json` by file stamp, so a restart reads no file again. Original
  data: 34,279 files, 2.1 s for the first manifest, 0.2 s after a restart, 449 KB gzipped. `GET /api/vfs` lists
  `{layers, files: [path, size, layer]}` for tools.
- **`GET /vfs/@<hash>/<path>`** answers `cache-control: private, max-age=31536000, immutable` when `<hash>` is the
  file's current hash, 404 when it is not (the client refetches the manifest), 400 when malformed. Plain
  **`/vfs/<path>`** stays for tools and agents: `private, no-cache`, the content hash as a strong ETag. Both take the
  token and serve ranges. A whole-file read from a client that accepts gzip gets the file gzipped when it is at least
  1 KB, not already compressed (ogg, mp3, smk, bik, png, jpg, gz, zip) and at least 10% smaller (ETag `"<hash>-gzip"`,
  `Vary: Accept-Encoding`; kept in memory by hash, 64 MB LRU, `src/server/vfs-gzip.ts`): the A9 tactical screen's files
  shrink from 10.9 MB to 4.2 MB. With the data version `stubs`, `/vfs/<path>` falls back to `stubs/<path>`
  (`x-vfs-layer: stubs`), so stub media and text answer under the original names (`32` §1.4).
- **The built client** (`dist/client`, `pnpm build`), when present, is served gzipped: hashed files under `/assets/`
  immutable, pages `private, no-cache`. Remotely it is the cheaper way to play: the Vite dev server sends some 700
  modules and revalidates each on every opening (16 MB the first time), the built client 28 files (1.3 MB, then
  nothing).

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

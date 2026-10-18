# Time, Acceleration and a Server with an API for Agents

*Draft v0.1, 2026-10-15. Supplements [`01-architecture.md`](01-architecture.md) (decisions D13–D16).
The numbers come from the user's copy of `Ja2bin.dat` (Steam, 1.12, Build 04.12.02) and from
Stracciatella code at `ae6bf01`. Paths of the form `Tactical/…` are relative to
`reference/stracciatella/src/game/`.*

---

## 0. Questions and short answers

1. **Can logic be decoupled from animation?**
   - From *rendering* and from *real time*: yes, completely.
   - From the *game-time duration* of actions: not without changing the mechanics, but there is no need to.
     A duration is just numbers (frames × frame delay). The simulation **computes** them rather than
     **waiting** for them.
2. **Instant execution and arbitrary acceleration?** Yes.
   - The enemy turn is computed without playback and is expected to take tens of milliseconds of CPU
     time.
   - Playback is separated from computation and runs at any speed, all the way to "straight to the result".
3. **Server-side state and agent actions via an API?** Yes, it is feasible.
   - It fits the architecture already adopted well: a DOM-free, deterministic, command-driven
     core.
   - The cost is a protocol and playback layer plus the discipline of "every player action is a command".

---

## 1. What exactly is coupled: numbers from `Ja2bin.dat`

The reconnaissance script [`tools/spikes/ja2bin-timelines.py`](../tools/spikes/ja2bin-timelines.py)
parses `Ja2bin.dat` together with the `gAnimControl` table from the sources. Its output is derived from
the original's data and is not committed to the repository.

**What the file contains:**
- 308 non-empty scripts out of 311 animation states;
- 144 distinct opcodes, 54 of which affect gameplay (group (b) of report [`03`](03-logic-animation-coupling.md)).

**Examples:**
- `SHOOT_RIFLE_STAND`: 4 frames of 100 ms each. The misfire check (470) and the fire opcode (430) come *before the first
  frame*, i.e. the shot happens the moment the state is entered.
- `STANDING_BURST`: 15 frames of 100 ms each, fire on frames 0, 2, 4, 6, 8, 10, i.e. one bullet every
  200 ms.
- `THROW_ITEM`: the grenade is released (460) on frame 9 of 14.
- `OPEN_DOOR`: the door opens (495) on frame 10.
- `CLIMBUPROOF`: 44 frames of 30 ms each, the climb commit (408) at the very end.

**Duration of typical actions.** A merc with 80 agility, full health and full breath walking on
flat ground. The frame-delay formula is `CalculateSoldierAniSpeed`, `Tactical/Soldier_Control.cc:4763`.

| Action | Game time | 5 ms ticks |
|---|---|---|
| One tile walking, turn-based combat / real time | ≈120 / ≈245 ms | 24 / 49 |
| One tile running | ≈70 / ≈140 ms | 14 / 28 |
| One tile crawling | ≈220 / ≈455 ms | 44 / 91 |
| Aimed shot: from order to bullet, no turning | 750 ms | 150 |
| Snap shot | 350 ms | 70 |
| 6-round burst | 1500 ms | 300 |
| Grenade: from order to release | 720 ms | 144 |
| Open a door | 700 ms | 140 |
| Climb onto a roof (map vision is disabled the whole time) | 1320 ms | 264 |
| Falling forward after a hit, until "death or release" | 2280 ms | 456 |

**Conclusion.** Everything the game "waits for" amounts to hundreds of milliseconds set by tables. This is not
rendering but a *schedule*: "150 ticks after the order, the fire marker". The simulation does not need to
draw anything to honor it.

**The original does this itself.** In turn-based combat, soldiers the player cannot see get a frame
delay of 0 and are animated on every pass of the loop (`Tactical/Soldier_Control.cc:4928–4936`).
In other words, JA2's turn-based logic was designed from the start so that playback speed does not
affect the outcome.

---

## 2. Three levels of decoupling

| Level | How it works | Instant and accelerated | Behavior |
|---|---|---|---|
| 0. Original | Logic runs inside the frame loop, delays are counted by the wall clock | No (except for unseen enemies) | — |
| 1. Timelines as data (D4) | The simulation counts ticks and executes gameplay markers; it contains no rendering | Yes: ticks are run through without playback | Same |
| 1b. Event jumping | Level 1, but the scheduler jumps straight to the next marker, tile or bullet step | Yes, another 10–100 times faster | Same (verified by an equivalence test against level 1) |
| 2. Atomic actions | A command is resolved in full at once, the time inside the action is discarded | Yes | **Changes** |

**What level 2 loses**, and why we do not adopt it:
- a burst at a falling target: later bullets aim at its new final height (`03`, §3);
- in real time, races: who gets there first, who sees whom first, who stepped into the bullet;
- delaying explosion damage until the keyframe, chain explosions with intervals, vision being disabled for
  the duration of an explosion;
- the "door busy" window and vision being disabled for the duration of a roof climb;
- an NPC cancelling a throw before release without being charged AP.

**Decision.** Level 1 gives both instant execution and accuracy, so there is no need to choose between them.
Level 1b is an optimization. We enable it only if profiling shows a need for it. To keep this
option open, every subsystem can name the tick of its next event
(`nextDue`), and the core has no "every tick" work that cannot be expressed this way.

---

## 3. Audit: where the original depends on things the simulation does not have

| Dependency | Where in the code | Our approach |
|---|---|---|
| Animation frames are counted by the wall clock, with no catch-up | `Utils/Timer_Control.cc:155–181` | Ticks. The model is "an ideal machine that never drops frames" |
| Unseen enemies in combat: frame delay 0, speed equals the loop rate | `Tactical/Soldier_Control.cc:4928–4936` | One frame per tick. Affects only the pace of turn-based playback, not the outcome |
| Bullet: one step no more often than every `bulletSpeed/10` ms and no more often than once per loop frame | `TileEngine/LOS.cc:3155–3184` | N tiles per tick, deterministically (deviation) |
| Real-time AI: "how many soldiers can we fit into 10 ms of CPU" | `Tactical/Overhead.cc:1041–1052` | A fixed number of soldiers per pass (deviation) |
| 3 s pause "enemy sighted on their turn" | `Tactical/OppList.cc:2588–2602` | Playback only. The simulation does not wait for it |
| Quote duration: the length of the sound if speech is on; 60 ms per character without speech | `Tactical/Faces.cc:629–636, 1233`; `Tactical/Dialogue_Control.cc:67, 1521` | Always 60 ms per character in the simulation: deterministic and audio-free. On the client the sound plays for as long as it plays (deviation) |
| Logic waits for an empty quote queue: NPC hostility, the AI of Sergeant, Mike and Joe, notifications | `Tactical/OppList.cc:559`; `TacticalAI/AIMain.cc:281`; `Tactical/Overhead.cc:840, 6205` | "Speech channel busy until tick T", where T is computed as in the row above |
| Message boxes and dialogues with choices | UI screens | Decision prompt (D15). Time stands still until an answer arrives |
| Deferred calls at 2, 3 and 10 s; bomb queue `1000 + Random(500)` ms | `Tactical/Overhead.cc:5069–5073, 6210`; `TileEngine/Explosion_Control.cc:2054–2095` | Ticks |
| Watchdog timers at 15 and 25 s (break hangs) | `TacticalAI/AIMain.cc:366–380`; `Tactical/Handle_UI.cc:405–419` | Not ported. A hang is a bug, and the test must fail |
| Idle animations consume the shared RNG and change soldier state | opcode 491 | Client only, the `fx` stream |
| "Render visibility" `bLastRenderVisibleValue` | `Tactical/Overhead.cc:602–634` | Not actually rendering: the field is updated in the logic loop. Ported as a state field |

**In total:**
- logic depends on rendering nowhere (the field with "render" in its name is actually a logic field);
- on the wall clock: a finite list of places, all of which are converted to ticks;
- on sound: only quote duration. We replace it with the formula the original uses
  without speech.

All deviations go into `docs/deviations.md`.

---

## 4. Time control

### 4.1. Three clocks

- **Simulation game time** in ticks is the only thing the outcome depends on.
- **Wall-clock time** exists only in the *driver*: the driver decides when to advance the simulation.
- **Playback time** belongs to the client. It lags behind the simulation or catches up with it at any speed.

### 4.2. `advance` and stop conditions

```ts
type StopCondition = {
  idle?: true;              // turn-based combat: the turn is back with the player and all effects have settled
  events?: SimEventKind[];  // e.g. EnemySighted, SoldierHit, Quote, Arrived
  ticks?: number;           // no longer than N ticks
};                          // a decision prompt always stops

interface StopReport {
  tick: number;
  reason: 'idle' | 'decision' | 'event' | 'ticks';
  events: SimEvent[];
}

sim.advance(until: StopCondition): StopReport;  // internally the same step()
```

### 4.3. Drivers

| Driver | Who advances time | Purpose |
|---|---|---|
| Real time ×k | The server: ticks by the wall clock × k (k = 1, 2, 4, …), auto-pause on decision prompts | A human in the browser |
| Instant | `advance` until `idle` or a decision prompt at full CPU speed, after every accepted command (`{mode: 'instant'}`) | The enemy turn "at once", auto-resolve, tests |
| Manual | Only explicit `advance` calls from the client | An agent via the API, step-by-step debugging |

**Turn-based combat** gives the same outcome under any driver.

**Real time** also gives the same outcome if commands arrive at the same ticks. But an agent
that issues orders while paused is a player with zero reaction time:
- The original can pause tactical play, but it covers the screen with a mask: any click or key
  unpauses, and orders are not accepted while paused (`Strategic/Game_Clock.cc:795–835`,
  `Tactical/Turn_Based_Input.cc:2126`).
- So this is a small advantage for the player, not a rule change.
- And the advantage is short-lived: a spotted hostile enemy immediately switches the game to turn-based
  mode.

### 4.4. Playback at any speed

The simulation writes an event log with tick stamps:
- animation start: state, frame delay, position, direction;
- moving to another tile;
- shot and bullet path, hit;
- explosion, quote, sound.

From this log and the same timelines, the client reconstructs the picture frame for frame:
- **1×**: as in the original;
- **2–16×**: faster (frames are played more often or skipped);
- **"skip"**: events are applied without animation, the result is visible immediately;
- **"unseen instantly, seen at 1×"**: essentially the original's behavior.

While playback catches up with the simulation, input is blocked, just as the original blocks the UI during actions.
Rewind and replay come for free: the log is deterministic.

**Implemented in v0 (M2).** Instead of reconstructing the picture from gameplay events, the session
records *view frames*: every 10 ticks (50 ms) it diffs the player view and keeps only soldiers that
changed (`src/protocol/view.ts` `diffView`/`applyFrame`, `src/server/session.ts`). An instant
`advance` therefore produces a compact frame stream that the browser plays back at any speed. Fine
animation between frames is reconstructed by the client from the same animation scripts. The richer
event log above stays the target once combat effects (bullets, explosions) appear.

**Implemented in M3.** Under the instant driver the session runs every accepted command (and the switch to the
driver) to `idle` or a decision prompt and streams the frames at once; the tactical page plays them back at 1×, 4×
or 16× (`SessionClient.playFor`) or applies them all with "skip".

The player view lists our soldiers (with AP, life, life max and breath), the militia and only those
others the squad currently sees (`bVisible ≥ 0`, `docs/08` §2.7), plus the gridnos of open doors and,
in turn-based combat, `combat {team, round, interrupt}`, and the items the squad has seen on the ground
(`items [{gridNo, level, item, count, status}]`); frames carry the changed soldiers and, when they change,
the full door list, the item list and the combat block. Simulation events (`arrived`, `stopped` with a
reason such as `outOfAPs`, `noPath`, `doorChanged`, `noiseHeard` with a direction but never a grid,
`enemySighted`, `combatStarted`, `turnStarted`, `interrupt` (only once it is visible), `interruptEnded`,
`combatEnded {reason: lull|won|lost}`, `shotFired {soldier, target, chance, hit}`, `bulletStopped {reason}`,
`soldierHit {soldier, attacker, damage, breathLoss, location, special, life}`, `soldierDied {soldier, killer}`,
`gunJammed`, `statChanged`, `attackResolved`, `meleeStrike`, `explosion`, `structureDamaged`, `itemsPickedUp`,
`itemDropped`) are returned by `advance`. In combat `advance … idle` returns
when it is our turn again and none of our soldiers is acting; an interrupt in our favour stops it with
reason `decision` (act with the soldiers that have not moved, then `endTurn`).

**Commands (M3 turn-based core):** `move {soldier, to, mode?: walk|run|swat|crawl}` (mode defaults to
the current stance; in combat refused unless the first step plus any stance change is affordable),
`turn {soldier, direction | toward}`, `stance {soldier, stance: stand|crouch|prone}`, `stop {soldier}`,
`endTurn`, `attack {soldier, target, level?, aimTime?: 0..4, bodyPart?: head|torso|legs|random, burst?}`
(`HandleItem` with what is in hand: gun, grenade launcher, thrown grenade or rock, knife or fists; refusals: no APs,
no ammo, broken weapon, out of melee reach, an aimed throw) and `estimateAttack` with the same
fields, a query that changes nothing and answers `data {apCost, actionPoints, chanceToHit, chanceToGetThrough}`.
`pickUp {soldier, gridNo?, zLevel?, items?}` picks up the visible items on the soldier's tile (or on an adjacent
blocked tile; `items` are indices into that tile's list, default all) for `AP_PICKUP_ITEM`; `drop {soldier, slot?}`
drops a slot (default the hand) at the soldier's feet; `climb {soldier}` climbs onto the adjacent roof edge or
down from the roof (`FindHigherLevel`/`FindLowerLevel`).
Orders are accepted only on our turn, when no attack is resolving and no other merc of ours is acting
(`docs/10` §9, `deviations.md` "Turn-based UI lock"); `idle` also waits for bullets, queued game events and any
of our soldiers still playing a one-shot animation (getting up, picking up, climbing).

**Implemented in M7 (S8, sound).** View frames also carry the events drained during an advance (`ViewFrame.events`,
attached to the frame of their tick), so a browser client receives the same event log an agent gets in `advance`
reports. Presentation fields, optional and never part of the state or an outcome: `shotFired {item, silenced, burst,
rounds}` (`rounds`: the burst size on the first bullet of a burst, 0 on the later ones, 1 for a single shot),
`bulletStopped {material, caveWall}` (the hit structure's material), `explosion {animation}` (the animation shown,
the water variant included), `doorChanged {kind: wood|cloth|garage|metal, noisy}` and the new event `reloaded {soldier,
item}`. Soldier entries in the view carry `voice`: the battle-sound voice, the profile's voice id as three digits
(I.M.P. voices included) or the generic `badN`/`kidN` set of soldiers without a profile; with `bodyType` it selects the
`m_`/`f_` fallback. The client derives all sound from these events, the frames and the animation codes it replays
between snapshots (`docs/27` §3.6); agents get the same events and never audio.

### 4.5. CPU cost

**Estimate for a turn of 15 enemies.** Each moves ~6 tiles (≈0.7 s), shoots (0.35–1.15 s),
and the target reacts (0.4–2.3 s). That adds up to 30–60 s of game time, i.e. 6–12 thousand ticks.

**A tick without decisions** is a pass over 30–60 soldiers incrementing accumulators: microseconds.

**AI decisions** are the expensive part: pathfinding on a 160×160 grid and LOS. But the original computed them in
real time on a Pentium 200.

**Expected:** tens, at worst hundreds of milliseconds per enemy turn without playback. If that is not enough: event
jumping (1b) and a worker.

**Measured (M3, 2026-10-15)**: A9 battles on the original data, one core of an AMD EPYC 9354 VM, the instant driver
(`advance … idle` after `endTurn`), wall time of the whole enemy side including the civilians:

| Garrison | Enemy turn | Ticks (game time) |
|---|---|---|
| 4 soldiers + 2 civilians | 1–90 ms, most under 50 ms | 40–1,000 (0.2–5 s) |
| 16 soldiers + 2 civilians | 2–370 ms, typically 100–250 ms while all are alive | 100–4,900 (0.5–25 s) |

AI decisions (cover search, paths, sight) dominate; ticks without decisions are almost free. No event jumping or
worker is needed for now.

**Measured again (M7 S4, 2026-10-18)** with `pnpm cli bench enemy-turn` on the original A9, the D13 save and a
generated arena with 8–32 enemies, and with the `server` scenario: an instant enemy turn blocks the event loop for its
whole duration (0.3 s for one battle, 1.2 s with four in one process), so the worker host of `27` §7.5 is needed once
instant battles share a server with other sessions; numbers in `27` §7.1 and §7.3.

---

## 5. The server as the source of truth

```
             ┌───────────────────── Node: ja2-server ──────────────────────┐
 browser ◄──►│ WebSocket    ┌──────────────── session ───────────────┐     │
 (client)    │              │ Sim (core) · time driver               │     │
 agent   ◄──►│ MCP          │ command log · saves                    │     │
 (Claude)    │              │ player-view projection                 │     │
 scripts ◄──►│ HTTP JSON    └────────────────────────────────────────┘     │
             │ /vfs: media from JA2_DATA_DIR or from the stub pack         │
             └─────────────────────────────────────────────────────────────┘
```

### 5.1. Session

- Consists of a `GameState`, a driver, subscribers and a command log.
- Logic content is loaded once and shared by all sessions, read-only.

### 5.2. Protocol

There is one protocol for all clients. It lives in `src/protocol` and depends on neither the DOM nor Node.

```ts
type ClientMsg =
  | { t: 'cmd'; id: number; cmd: Command }                  // game action
  | { t: 'answer'; id: number; prompt: PromptId; choice: string }
  | { t: 'advance'; id: number; until: StopCondition }
  | { t: 'drive'; mode: 'realtime'; speed: number }
  | { t: 'drive'; mode: 'instant' }
  | { t: 'drive'; mode: 'manual' }
  | { t: 'query'; id: number; q: Query };                   // hit chance, path, AP, LOS

type ServerMsg =
  | { t: 'snapshot'; tick: number; view: PlayerView }       // on connect and after stops
  | { t: 'events'; events: VisibleEvent[] }                 // stream with tick stamps
  | { t: 'result'; id: number; ok: boolean; reason?: string; data?: unknown }  // data: quotes, shop, contract terms
  | { t: 'prompt'; prompt: Prompt }
  | { t: 'stopped'; report: StopReport };
```

### 5.3. Player-view projection (D16)

- `view(side)` is a single function for both the browser and agents.
- The projection includes visible enemies, heard noises (as direction and loudness), and known
  doors and items.
- Unseen enemies appear neither in the snapshot nor in the event stream.
- An "omniscient" mode exists for debugging only.

### 5.4. Queries

- The same rule functions as the simulation uses, but on top of the projection, so that hidden information
  does not leak.
- For the cursor in the browser this is ~1 ms over localhost. If needed, they can run directly in
  the client.

### 5.5. Saves and the log

- Stored as files on the server (`$JA2_SAVE_DIR`, default `.ja2/saves/`), named, never addressed by path (§6.22).
- Every session keeps an input log (commands, answers, advances, real-time batches as tick counts, map preparation,
  reseeds, loads) from its origin; a save carries it as `<name>.log.jsonl.gz`, and `pnpm cli replay <name>` re-runs it
  and compares the result with the save byte for byte. This serves bug reports, regression tests and analyzing an
  agent's play.

### 5.6. Determinism and multiple sessions

New rules apply to the core.
- **Forbidden:** `Math.random`, `Date`, timers, and also `Math.sin`, `cos`, `atan2`, `exp`,
  `pow`. The results of the latter may differ between engine versions, so we write the functions we need ourselves
  in `core/math`, using tables or polynomials.
- **No global mutable module state:** several sessions may live in one
  process.
- Enforced by a linter and by the test "two sessions in one process with the same seed produce the same
  log".

### 5.7. Embedded mode

- The core depends on neither the DOM nor Node, and the protocol is just messages. So the same session can
  be brought up in a Web Worker right in the browser, for example for a static demo on stubs.
- This is not a priority, but it comes almost for free as long as the layer boundaries are respected.

### 5.8. Security

- By default the server listens only on `127.0.0.1`. Access is by token.
- The API accepts only game commands, never file paths from the client.

### 5.9. Heavy sessions

- At first everything runs in a single thread.
- If instant run-through starts delaying network I/O, the session moves to
  `worker_threads`. The protocol is already message-based, so it will not need to be reworked.

---

## 6. Agent API

### 6.1. Transport

- **An LLM agent** connects via MCP (Model Context Protocol). Claude Code connects to the
  local server with the `claude mcp add` command.
- **Scripts and bots** get the same set via HTTP JSON and a TS client. For them it is also the route
  to mass headless runs.

### 6.2. Tools

There are few of them, and they are coarse-grained.

| Tool | What it does |
|---|---|
| `status` | Mode (strategy, real-time or turn-based tactics, awaiting a decision), whose turn it is, time, money, squads, the open prompt |
| `observe` | What the player sees: own soldiers (tile, stance, AP, health, breath, weapon and ammo), visible enemies, heard noises, an ASCII map fragment with a legend (walls, doors, cover by height, roofs), events since the previous call |
| `query` | Hit chance with N aim clicks, a path and its AP cost, LOS, tile visibility |
| `act` | A command: `move`, `shoot`, `throw`, `stance`, `reload`, `open_door`, `climb`, `bandage`, `end_turn`, …; on the map: `travel`, `assign`, `hire`, …. By default, time then runs until `idle` or a decision prompt. The response is a summary of events and the new status |
| `answer` | An answer to a decision prompt: interrupt, dialogue line, message box, PBI |
| `advance` | Explicitly advances time in real time and on the strategic map: "until arrival", "until an event", "no longer than N" |
| `newSession` | Starts another session and returns its id: the sandbox (optional seed), with `campaign {options?, profiles?, hire?, mercs?, imp?, land?}` a new campaign (§6.6, options §6.23), or with `save` a native savegame from the game's `SavedGames` folder (`docs/14` §10); `language` sets the session's display language (§6.21); every other tool takes `session`, so agents and tests do not share one battle |
| `save` / `load` | Saves on the server; `listSaves`, `deleteSave` (§6.22) |

### 6.3. Example turn

Abbreviated.

```
→ act {soldier:"Ivan", action:"move", to:[52,61], stance:"crouch"}
← moved 3 tiles; interrupted at [51,60]: enemy #12 fired 1 shot, missed.
  Your turn continues. Ivan AP 9/21. New: enemy #12 at [47,58], prone, behind sandbags.
→ query {kind:"cth", shooter:"Ivan", target:12, aim:[2,4]}
← aim 2: 41% (6 AP); aim 4: 58% (8 AP)
→ act {soldier:"Ivan", action:"shoot", target:12, aim:4}
← hit torso, 18 dmg; enemy #12 falls. Ivan AP 1/21.
```

An `observe` fragment:

```
Omerta A9 · turn 3 · ours · 07:42
      4444445555555
      4567890123456
  56  ,,,,..#####..
  57  ,,,,..#...#..       ,  tall grass         #  wall       D  door
  58  ,,,e=.#...D..       =  sandbags           e  visible enemy #12
  59  ,,,,=.#...#..       I  Ivan [51,60]       F  Fox [50,61]
  60  ,,,,...I.###.
  61  ,,,,..F......
```

### 6.4. Fairness and hints

- **Fairness.** The agent sees exactly what the player's screen would show.
- **Agent hints** ("cover from enemy #12: yes or no", "tiles with cover within a radius
  of 5") are derived only from what is visible. They can be turned off.

### 6.5. What the agent handles well and poorly

- **Well:** turn-based combat, strategy, management. `query` spares it from doing the math in its head.
- **Worse:** spatial reasoning over ASCII: cover, elevation, roofs. So the observation
  has to be designed carefully and tested on real games.
- **Real time:** only through the manual driver.
- **A long campaign** means thousands of actions. Observations have to be compact: deltas, not
  full snapshots.

---

### 6.6. Campaign sessions (M4)

`src/server/campaign-factory.ts` `createCampaignSession(read, exists, seed, request)` builds a `CampaignSim` with the
strategic map, the Queen, towns and the sector flow, runs `initNewGame` (which leaves the game in the laptop), hires the
squad through the laptop (§6.9), closes it and, unless `land: false`, dispatches the first `compressTime` so the helicopter
drop loads the start sector at 07:00 on day 1 (`docs/15` §4.5). `hire: [{profile, contract?, gear?}]` names the A.I.M.
hires (a refusal fails the request), `mercs` sets the size of the default squad (original data: profiles 0, 3, 4, 7, 14,
16, default six; stubs: the authored profiles 0–5, default four; hired in order while available and affordable), `imp`
runs an `impCreate`, and `hire: []` without `imp` returns the session in the open laptop. `options` are the game options of §6.23
(`difficulty` 1–3, default 2; `campaign.difficulty` stays an alias). Maps are loaded by
`WorldCache` before each command (`Session.prepareAndDispatch`).

Sessions are created through MCP `newSession`, `POST /api/sessions` (same JSON body: `{seed?, save?, campaign?, language?}`;
`GET /api/sessions` lists them with `describeSession`), or for the default session with `JA2_CAMPAIGN=<difficulty>`.
Both paths share `src/server/session-registry.ts` (at most 16 sessions).

View frames also carry `mapPath` (a sector was loaded or unloaded), `clock` and `strategic` whenever they change, so
the browser follows the campaign without polling. The strategic page (`src/devtools/strategic/`) lists the sessions,
starts a campaign, shows the 16×16 map (control, known enemies, militia, squads, planned routes), the mercs and their
groups, and sends `route` (once per squad), `enterSector`, `mapScreen`/`tacticalScreen`, `compressTime {mode: 2|3|4}`,
`stopTime` and a strategic `advance` (to the next stop; during autoresolve to its end). A battle panel shows the open prompt
(`preBattle`, `autoresolveDone`, …) with its choices and the autoresolve cells; the frame stream (and with it an
autoresolve battle) plays back at the original's Play (1×) and Fast (4×) speeds or at once (Finish). The tactical page takes `?session=` and
reloads the world when the loaded sector changes.

The campaign runs in flows: `tactical` (the loaded sector steps in real time or turns), `strategic` (the map screen: the
world clock runs, compressed on request, the loaded sector, if any, is frozen) and `autoresolve` (`docs/19` §5.2).
`mapScreen` and `tacticalScreen` switch between the first two like the original's screen toggle. A strategic `advance`
(`worldTime`, `worldSeconds`, `compressionStopped`, `mode`; `docs/15` §6) is refused in tactical unless it has a time
target, and compression is refused while the loaded sector holds enemies (`AllowedToTimeCompress`). `route` checks
`CanEntireMovementGroupMercIsInMove` first, so the squad cannot leave the start sector before it is cleared.
Compression is also refused while a group sits in a creature-infested mine or bloodcats attack. Campaign events beyond the
battle ones (`docs/19` §5.3): `civiliansEaten {sector, count}`; `preBattle` may carry `encounter: 'creatureAttack'` with
`autoStart: true`. Complaints about hated teammates are `mercQuote` events and a merc who quits leaves through the
`mercDeparture` prompt (§6.8).

Militia training asks before it charges: `assign {to: {kind: 'trainMilitia'}}` returns `militia: 'pending'` and opens a
`militiaPayment` prompt (`{trainer, sectors, cost, balance, choices: [yes, no]}`), and a finished training session asks
`militiaContinue` (`{trainer, sector, cost, balance}`), both answered with `answer {choice: yes|no}` (`data.outcome`:
`paid`, `continued`, `declined` or `cannotAfford`); they stop compression and count as decisions like the battle prompts.
The economy's own events reach the reports as well: `assignmentDone`, `assignmentAborted`, `fellAsleep`, `wokeUp`,
`tiredComplaint`, `itemRepaired`, `gunUnjammed`, `militiaTrained`, `militiaPromoted`, `militiaDefected`,
`militiaTrainingRejected`, `militiaPrompt`, `loyaltyChanged`, `mineIncome`, `mineRunningOut`, `mineEmpty`, `mineShutDown`,
`mineReopened`, `headMinerQuote` and `moneyChanged`.

### 6.7. Merchants (M5)

A shop is a modal session like a prompt (`docs/23` §13): `openShop {dealer, soldier}` (the original's talk-and-trade,
with its distance, sight and AP checks) opens it, `quoteTrade` prices an exchange without doing it, `trade` performs one
exchange (buy, sell, cash, repair, `useBalance`) and `closeShop` ends it. While a shop is open every other command is
refused, `advance` returns `refused` with `refusal: 'shopOpen: …'` and the clock does not move. `observe.shop` (and the
`shop` field of view frames) shows the kind, the pricing merc, the balance and the boxes with unit prices; the dealer's
cash is never shown. Merchant NPCs in sight carry `merchant: buySell|buy|sell|repair`. Events: `shopOpened`,
`shopkeeperQuote`, `itemsBought`, `itemsSold`, `giftGiven`, `repairQueued`, `repairDelayed`, `repairCollected`,
`itemsDropped`, `moneyChanged`, `shopClosed`.

### 6.8. Contracts (M5)

`extendContract`, `dismiss` and `removeMerc` work on the map screen only (`mapScreenOnly` elsewhere); `contractOptions`
returns the renewal menu without opening it (`docs/22` §9). The renewal sequence, departures and insurance offers are
decision prompts in `observe.contractPrompt` (`contractRenewal`, `mercDeparture`, `insuranceExtension`), answered with
`answer`; `advance` stops on them with `decision`. Strategic mercs show `kind`, `contract` (A.I.M. days left, end time,
renewal costs; M.E.R.C. debt; R.P.C. rate), `morale` and `moraleText`, `daysServed`, `totalCost`; the strategic view shows
the M.E.R.C. account status. Opinions, tolerances, reputation and the death rate stay hidden.

### 6.9. Laptop and hiring (M5)

The laptop is a modal flow (`docs/21` §1.3, §10): a new game starts in it (day 1, 01:00) and `openLaptop` opens it from
the map screen (refused elsewhere and while a prompt, a pending battle or the renewal sequence is open). While it is open
the clock stands still, every non-laptop command is refused with `laptop: the laptop is open, closeLaptop first` and
`advance` returns `refused` with that refusal; laptop commands sent while it is closed answer `laptopClosed`. Commands:
`closeLaptop`, `readEmail`/`deleteEmail {id}` (reading the I.M.P. intro bookmarks I.M.P., Speck's intro M.E.R.C.),
`aimHire {profile, contract: 1|7|14, gear?}`, `aimLeaveMessage {profile}`, `mercOpenAccount`, `mercHire {profile}`,
`mercPay`, `impCreate {code, name, nickname?, gender, answers[16], attributes, portrait, voice}`, `bobbyRayOrder {lines:
[{item, used?, quantity}], destination, speed: 0|1|2}`, `insure {soldier}`, `orderFlowers {bouquet, destination, nextDay,
extras}`; on the map screen `setLandingZone {sector}`. Queries that never act and work in any flow: `aimQuote`,
`bobbyRayQuote`, `insuranceQuote`, `impPreview`, `arrivalTime`. Hires answer with the soldier id, the charge and the
arrival (`{minute, shownMinute, sector}`); the hired merc is `IN_TRANSIT` until the 07:30, 13:30 or 19:30 flight lands him
in the landing zone (after the first landing the arrival event stops compression and drops him into a loaded start
sector by helicopter). `observe.laptop` (and the `laptop` field of view frames) is present only while the laptop is open:
balance, bookmarks, mails, history, finance records, files, personnel lists, A.I.M. mercs (stats, salaries, medical
deposit, kit, face state), the M.E.R.C. site (once bookmarked), I.M.P., Bobby Ray's stock, shipments and destinations,
insurance offers, mercs in transit and the landing zone; the strategic view always carries `landingZone` and
`unreadMail`, and in-transit strategic mercs their `arrival`. Events: `laptopOpened`, `laptopClosed`, `mercHired`,
`mercArrived`, `arrivalRerouted`, `landingZoneReset`, `emailReceived`, `historyAdded`, `moneyChanged`, `bobbyRayOpen`,
`shipmentDelivered`, `shipmentLost`, `insurancePaid`, `mercAccountStatus`. Native saves import the laptop sections.

### 6.10. Doors (M6)

`door {soldier, gridNo, action}` with `action` one of `open`, `close`, `unlock`, `lock`, `pickLock`, `force`, `crowbar`,
`explode`, `untrap`, `examine` (`docs/25` §8, §13.1). The soldier walks next to the door (`FindAdjacentGridExAdvanced`) like
`pickUp` and then interacts; `data` is `{walking: true, to}` while he walks, `{started: <action>}` when he is already there,
or, for `open` on a locked door, `{opened: false, locked: true, options}`: the door menu as data, after the start-of-menu
trap check (`{trapNoticed: true}` when the merc spots the trap instead). Each option is `{action, ap, enabled, reason?}`.
Refusals (`data.refusal`): `noDoor`, `alreadyOpen`, `alreadyClosed`, `doorOpen`, `notLocked` (menu actions need a closed
locked door), `noLock`, `alreadyLocked`, `noKey`, `noCrowbar`, `noLockpickKit`, `noShapedCharge`, `escortCannot`,
`alreadyKnown`, `notEnoughAp`, `noPath`. Events: `doorMenu {soldier, gridNo, options}`, `doorResult {soldier, gridNo,
action, result, trap?}` (`opened`, `closed`, `locked`, `failed`, `noLock`, `lockDamaged`, `chargeExploded`, `trapFound`,
`noTrapFound`, `untrapped`, `trapSprung`, `notTrapped`, `wrongKey`, `trapStopped`, `trapNoticed`, `notEnoughAp`),
`doorTrap {soldier, gridNo, trap}` (never for the silent alarm), `lockDestroyed {soldier, gridNo}` and `doorChanged`.
`observe.doors` lists the doors whose lock or trap the player knows (`locked`: `unknown|locked|unlocked|broken`, `trap`:
`unknown|none|noneFound|<trap>`); our soldiers carry `keys` (key ring: key id, count, sector and day found) and key items
show `keyId`. Lock tables, trap levels and lock damage stay hidden.

### 6.11. Quests and NPC presence (M6)

Facts and quests are hidden state (`docs/25` §13.4): the player sees quests only as history lines. The strategic view
(`observe.strategic` and the `strategic` field of view frames) carries `quests`: one entry per quest that has a
"quest started" or "quest finished" history line, `{id, quest, started, finished}` with the quest's internal name
(`DELIVER_LETTER`, `KILL_TERRORISTS`, ...) and each step as `{minute, sector}` (`sector` is null for "n/a"); a quest
started or ended without history (Alma's skip, a silent restart) does not appear. Events: `questStarted` and
`questFinished` `{quest, id, sector}`, emitted together with the `historyAdded` line. A new game starts with the
accepted assignment and `DELIVER_LETTER` in the history (day 1, 01:00). Profile NPCs exist only as their campaign
profile's sector until a sector loads; their whereabouts, `npcData`, balances and the 04:00 moves are never shown
(`npcMoved` is not an event). Native saves import the facts, quests and the narrative globals of the general info.
Civilians follow their map schedules (`docs/25` §5): a loaded sector replays the last 24 hours when it loads and
whenever time passes on the map screen (civilians are moved, put to bed or sent off the map at once), and in tactical
real time they walk to their spots, open, close, lock and unlock doors and leave or re-enter the map (one who walks off
stays, invisible, two tiles past the edge until the sector loads again: a kept quirk). Schedules add no command, event or
view field: a civilian off the map is absent from the soldiers of the view like one who left, a sleeping one is visible
as usual, and opened or closed doors arrive as `doorChanged`. Shop hours of a repairman come from the lock and unlock
times of his schedule while his sector is loaded.

### 6.12. Conversations (M6)

A conversation with a named NPC is a modal **talk session** (`docs/24` §11, `src/sim/campaign/talk-flow.ts`), built on the
NPC record arrays (`state.npcRecords`, imported from native saves) and the dialogue queue (`src/sim/narrative/`). Commands
(refusals in `data.refusal`, the reason reads `<code>: <text>`):

- `talk {soldier, target}`: `target` is a soldier id or `{npc: <profile id or internal name>}`. Refused with `notInTactical`,
  `promptOpen`, `shopOpen`, `sessionOpen`, `scriptedSequence`, `canAct` (the tactical refusal text), `noSuchTarget`,
  `notTalkable`, `targetHidden`, `targetMoving`, `talkerIsRobot`, `noLineOfSight`, `targetCollapsed`, `refusesToTalk`
  (Dimitri), `noPath`, `notEnoughAP` (6 AP). An unnamed civilian or an enemy soldier answers with a civilian quote
  (§6.19). Talking to an own merc barks
  (`data.bark`, a `mercQuote` event, no AP). Beyond 4 tiles the soldier walks up (`data {walking: true, to}`) and the talk
  starts on arrival during `advance`; a target that became invalid gives `talkAborted`. Otherwise the opening runs at once.
- `approach {kind}`: `repeat`, `friendly`, `direct`, `threaten`, `recruit`, `whoAreYou`, `buySell` (dealers: an unused
  BUYSELL record, else the panel closes and the shop opens) or `give` (others: the panel closes, the NPC waits 10 s).
  Refusals `noConversation`, `busy`, `unknownApproach`, `notADealer`, `isADealer`.
- `closeTalk {}`: Done, with the once-per-conversation reset. Refusal `noConversation`, `busy`.
- `openShop {dealer, soldier}` (campaigns with narrative): the shop's checks, then `talk` + `approach buySell`; when the
  opening leaves no idle session or a BUYSELL record plays, the talk result is returned instead of the shop.

`talk` and `approach` run their step and then the dialogue queue until it is empty, nobody talks and no trigger waits
(tactical ticks with the world clock paused by the `ENGAGED_IN_CONV` lock and AI decisions frozen). Their `data` is
`{conversation, lines, scriptedSequence?, shop?}`: `lines` are the quotes said during the command (`{profile, quote,
record?, textKey, text?}`). While a session is open and idle every other command is refused with `conversationOpen`,
`advance` returns `refused` with that refusal, and the campaign reports a pending decision (an `advance` that runs into a
conversation opened by an NPC stops with `decision`). A **scripted sequence** (`ENGAGED_IN_CONV` without a panel, a
pending conversation, the 500 ms trigger wait) refuses player commands with `scriptedSequence`; `advance` runs it until it
ends or a panel opens.

`observe.conversation` (and the `conversation` field of view frames) is `{npc, profile, name, talker, initiatedBy:
player|npc, menu, lastQuotes}` with `menu` = `repeat, friendly, direct, threaten, buySell:<dealer kind>|give, recruit,
whoAreYou`; `observe.scriptedSequence` is true during a sequence. Soldiers in sight carry `talkable: npc|epc|civilian`
and, when profiled, `profile`. Events: `conversationOpened {npc, profile, talker, initiatedBy}`, `conversationClosed {npc,
profile, by: player|script}`, `npcQuote {profile, soldier, quote, record?, textKey, chars}`, `mercQuote` (with `textKey`
and `chars` for lines from the queue), `npcMessage {kind, profile?, amount?}`, `scriptedSequence {active}`,
`talkAborted {soldier, reason}`. Facts, quests, records, desire and opinions stay hidden.

The simulation only carries text keys `{file, row, width}` and lengths (12 ticks of speech per character). The session
resolves keys to `text` in `observe`, command results and events from the EDT files of the VFS (original data, or the
stub pack's invented lines); `GET /api/text?file=npcdata/NNN.edt&row=R` (token-protected) serves a single row (§6.21).
Saving is not offered by the API, so there is nothing to refuse during a session.

### 6.13. Helicopter and vehicles (M6)

Skyrider's helicopter exists once the escorted Skyrider reaches his chopper in B13 (`docs/25` §10.2) or a native save already
owns it. Strategic commands (map screen only, `mapScreenOnly` elsewhere): `heliRoute {to}` plots and confirms a new route
(the original's plot-and-click on the last sector, replacing any route like `route`) and takes off; `data` is `{path,
etaMinutes}`. `heliCancel` cancels the route (a flying helicopter turns back). `route`/`cancelRoute` for a merc aboard the
helicopter do the same after the squad's move check. Refusals (`data.refusal`): `noHelicopter`, `skyriderOwed`,
`returningToBase`, `grounded` (on the ground in an enemy-held sector), `skyriderUnwilling` (Drassen disloyal), `noRoute`, and
`emptyHelicopterHint` the first time the helicopter would leave empty while mercs stand in its sector (the original's one-time
message box; the next request goes through). `boardVehicle {soldier, vehicle: <id> | 'helicopter'}` seats a merc
(`notAccessible`: another sector, moving or destroyed; `alreadyAboard`; `vehicleFull`; the helicopter's flight refusals;
`notAllowed` for a hummer or ice-cream truck the quests have not released; `vehicleNotOurs`; the assignment conditions
`combat`, `unconscious`, `moving`, `underground`, `inTransit`, `prisoner`, `helicopterInHostileSector`, `impassableSector`).
`leaveVehicle {soldier, squad?}` puts a passenger on a squad (default the first empty one) in the vehicle's sector
(`notInVehicle`, `helicopterInFlight`, `returningToBase`, `squadFull`, `squadElsewhere`, `squadMoving`, `squadHasVehicle`,
`notEligible`); `assignSquad` and `assign` to a squad refuse a helicopter passenger in flight the same way.

Events: `helicopterSetUp {sector}`, `skyriderQuote {quote}` (Skyrider's quote numbers, presentation only), `heliTakeOff
{sector}`, `heliArrived {sector, hostile}`, `heliHovering {sector, stage: started|long|tooLong}` (`long` after 10 minutes,
`tooLong` after 20: passengers are dropped in a safe sector and the helicopter returns), `heliReturning {to, safe}`, `heliLanded
{sector}`, `heliHit {sector, hits}` (SAM fire), `heliDestroyed {sector, killed}`, `heliPaid {amount, balance}`, `heliOwed
{amount}`, `heliEmptyHint {sector}`, `enemiesSpottedFromAir {sector}`, `samSitesRevealed {sites}`, `skyriderMonologue {topic:
drassenSam|cambriaHospital|otherSams|estoniRefuel}`, `passengersDropped {sector, soldiers, squad}`, `vehicleBoarded {soldier,
vehicle}`, `vehicleLeft {soldier, vehicle}`. Hits, arrivals, hovering warnings, the return and debts stop time compression,
so a strategic `advance` reports them with `compressionStopped`.

The strategic view carries `vehicles` (id, kind, sector, betweenSectors, passengers, seats, path) and, once the helicopter is
set up, `helicopter {vehicle, sector, next, airborne, hovering, returning, passengers, seats, canFly, reason?, owed, hits,
path, etaMinutes, safeSectors, unsafeSectors, routeCost, refuelSites: [{sector, available}]}` (`{destroyed: true}` after it
was shot down); mercs in a vehicle carry `vehicle`. Skyrider's balance is shown only as the debt (`owed`), as the original's
messages show it; his talk state and the accumulated bill stay hidden.

### 6.14. NPC actions and requests (M6)

The NPC records of a conversation run the action catalog of `docs/25` §3 (`src/sim/tactical/narrative/npc-actions/`): facts,
quests, history lines, strategic events (the NPC system events of event 27), profile moves, record triggers, items, money,
combat changes and the hospital. Actions have no command of their own; their effects show in the usual places (the
conversation's lines, `questStarted`/`historyAdded`, mails, the shop, soldiers in sight). A requestor action (`docs/25`
§3.3) closes the panel and opens an **NPC request**, a decision like the battle prompts:

- `observe.npcRequest` (and the `npcRequest` field of view frames) is `{id, kind: 'npcRequest', request, npc, name, merc?,
  amount?, pair?, choices}` with `request` one of `escort` (`pair: true` for John and Mary together), `hire` (`amount` = the
  salary, after Conrad's reduction), `boxingBet`, `fightAgain`, `buyVest` (`amount` = the jacket's price), `payDoctor`
  (`amount` = the shown cost: the doctor's price for the wounded within 9 tiles less the refund, $10 when the refund is
  larger), `freeTreatment`, `buyVehicle` (`amount` 10000), `spareKrott`, `marryDaryl` (`merc` = the asking merc's profile)
  and `lie`; `choices` are `yes`, `no` and, for `lie`, `lie`.
- The `talk`/`approach`/`answer` result that opened it carries the same view in `data.npcRequest`.
- `answer {prompt?, choice}` answers it; `prompt` (the id) is optional, a wrong id or choice is refused. The answer runs the
  original's callback (records triggered, Daryl's key, the hospital balance, the liar's skill check), then the dialogue queue
  as `talk` does: `data` is `{conversation, lines, scriptedSequence?, shop?, npcRequest?}` (a trigger that opens a new panel
  shows its lines in `conversation.lastQuotes`).
- While a request is open the world clock and the tactical ticks stand still, `advance` stops with `decision`, the campaign
  reports a pending decision and every other command is refused (`answer the npcRequest prompt first`, or `promptOpen` for
  `talk`). The request is part of the campaign state.
- Events: `npcRequest {id, request, npc, amount?, pair?, merc?, choices}` when it opens; `npcMessage` kinds `teamFull`,
  `recruited`, `nowEscorted` (`amount` = the squad number), `balanceOwed` (action 119, `amount` = the debt), `itemPlacedOnGround`,
  `vehicleRefuelled`; `npcGaveItem {npc, to, item}`; `terroristRevealed {npc}`, `townDiscovered {town}`, `sexScene {npc}`,
  `boxingBell` (presentation).

The hospital (Cambria) charges through `payDoctor`, escorts patients onto the hospital assignment (action 237, strictly within
9 tiles) and refunds the unused payment when a patient leaves it; Kingpin learns of his missing money when the squad leaves
D5-1 with less than $30000 there (his letter and quest 4 follow two and four days later). Facts, the hospital modifier and
refund, Kingpin's balance and the NPC system events stay hidden.

### 6.16. Giving items and money (M6)

`give {soldier, target, slot, count?}` or `{soldier, target, money, slot?}` (campaign, tactical; `docs/24` §4,
`src/sim/campaign/give-flow.ts`, `talk-flow.ts`) is the original's drag of an item onto a soldier. `target` is a soldier id
or `{npc: <profile id or name>}`. `slot` (0–18 or `hand`) hands over the whole pocket, or one item of a stack with `count: 1`
(any other count is refused); a money pocket given by `slot` goes whole. `money` splits that amount off the soldier's money
pocket (`slot` picks the pocket, default the first that holds enough), in the money box's steps of 10. Inside a
conversation with a non-dealer the command is the menu's "Give": the panel closes (once-per-conversation records reset, the
NPC waits 10 s) and the give follows; with a dealer it is refused (`isADealer`). Refusals (`data.refusal`): `notInTactical`,
`promptOpen`, `shopOpen`, `scriptedSequence`, `busy`, `canAct` (the tactical refusal text), `noSuchTarget` (also the giver
himself), `giverCannotGive` (an escort, below OKLIFE, in deep water), `giverBusy` (an item, door or give animation, or a
give already under way), `needItemOrMoney`, `noSlot`, `emptySlot`, `badCount`, `badMoney`, `notEnoughMoney`, the talk
checks with giving allowed (`notTalkable`, `targetHidden`, `targetMoving`, `targetCollapsed`, `talkerIsRobot`; own mercs and
escorts may be given to), `robotReload` (reloading the robot is not ported), `noPath`, `notEnoughAP` (the walk plus 1; the
hand-over charges 3).

The soldier walks next to the target and plays the give animation. To an NPC the game is paused and locked meanwhile, so the
command runs to the end: the item is taken off the pocket, the NPC's conversation (`GIVINGITEM`: an introduction on a first
meeting or a new day, then the record that wants the item) opens and drains, and `data` is `{outcome, conversation, lines,
scriptedSequence?, shop?}` with `outcome` `taken` (the NPC keeps it in its profile inventory), `returned` (refused: back in
the pockets, or on the floor when they are full), `kept` (a dealer's BUYSELL record plays instead; the merc keeps it), `shop`
(the dealer does not want it as a gift: the shop opens, the item stays in the pockets), `pending` (the queue was busy; the
conversation opens during `advance`) or `aborted` (the target left its tile). To a squad mate or recruited RPC the command
returns `{walking: true, to}` or `{giving: true}` at once and the hand-over happens during `advance` (the whole source pocket
is emptied even when one item was given, as in the original). Events: `itemGiven {soldier, target, item, count, status,
money?, dropped}`, `npcTookItem {npc, profile, from, item, count, status, money?}`, `itemReturned {to, item, …, dropped}`,
`npcGaveItem {npc, profile, to, item, …, dropped}` (an NPC's gift, dropped at its feet when the talker is out of reach),
`giveAborted {soldier, target, reason, dropped}`, `npcMessage` (`itemPlacedOnGround`, `paidInFull`, `stillOwed`,
`balanceOwed`, `needsMoney`), and the conversation events of §6.12. The quest action items of `docs/25` §11.5 add
`sexScene {soldier}` and `alarm {gridNo, kind: kingpin|museum}`.

### 6.17. Recruiting, escorts and the robot (M6)

Recruiting has no command of its own: it happens in a conversation (§6.12). `approach recruit` runs the NPC's records; a
record with the pay requestor opens `npcRequest {request: 'hire', amount}` (the daily salary) and `answer yes` triggers the
record that recruits (`RECRUIT` or `RECRUIT_WITH_SALARY`, `docs/24` §9.1); an escort record opens `npcRequest {request:
'escort', pair?}`. The NPC's civilian soldier is replaced by a new soldier on our team (`ChangeSoldierTeam`: a new soldier id
in our block, life, stats, camouflage, level and inventory copied, breath and bleeding fresh) standing on the same tile, who
joins the current squad (else any squad). An R.P.C. (`kind: 'rpc'`) takes the first weapon of his inventory into an empty
hand and is paid his salary at 00:00 (§6.8); an escort (`kind: 'epc'`, John and Mary always together) follows the escort
rules: no contract, `loneEPC`/`abandonEPC` at map edges, `escortAlone` for strategic moves, `escortCannot` at doors.

- `unescort {soldier}`: the assignment menu's "remove escort". On the map screen the escort (and John's or Mary's partner)
  says the line of his first record for being left (`EPC_IN_WRONG_SECTOR`), its fact is set and he becomes a civilian again
  at once where he stands (the original plays the line first; the map screen's clock does not move): `data {released:
  [{profile, quote}], lines}` (`quote` is null without such a record). In the loaded sector only that record is triggered
  and decides (it may release him, or only answer): `data` is the talk result (§6.12) plus `triggered`. Refusals
  (`data.refusal`): `conversationOpen`, `scriptedSequence`, `promptOpen`, `shopOpen`, `laptopOpen`, `noSuchSoldier`,
  `notAnEpc`, `notInSector` (tactical: the escort stands outside the loaded sector; release him on the map screen) and
  `notAvailable` (autoresolve). A released escort keeps his place: his profile uses insertion data at the tile he left.
- The robot is recruited as an escort (Madlab's action) and takes orders only while a conscious non-escort on its squad (or in
  its vehicle) in the same sector wears the robot remote control in a head slot: the remote holder is fixed when the robot
  joins, whenever a merc of ours receives a remote control (picked up, bought), when a pre-battle decision opens and after
  autoresolve. Without a controller every order is
  refused with the `canAct` text "the robot has no controller…", `route` with `robotAlone` and `exitSector` with
  `uncontrolledRobot`; its interrupt points are the controller's level − 2 and the controller loses 2 while he steers.
- `route` also refuses `cannotLeaveSector` for Maria in C5.
- A civilian group turning hostile sends its recruited members back to the civilian team (they leave the roster without
  events); Conrad and the General turning hostile join the enemy team.

Views: strategic mercs carry `kind` (`aim`, `merc`, `imp`, `rpc`, `epc`, …) and own tactical soldiers `kind: 'rpc' | 'epc'`
for recruited NPCs; the robot carries `controlled` in both. Talking to an escort runs his `EPC_WHO_IS_RECRUITED` records.
Events: `npcRecruited {profile, soldier, kind: 'rpc' | 'epc', salary}` (the new soldier id; `salary` 0 for escorts),
`epcReleased {profile, soldier}` (`soldier` is the new civilian's id when he stands in the loaded sector, else null),
`npcMessage` kinds `recruited`, `nowEscorted` (`amount` = squad number, also for the partner) and `teamFull`, and the
history line `RPC_JOINED_TEAM` (`historyAdded`). Opinions, profile flags, the remote holder id and the records stay hidden.

### 6.18. Meanwhile scenes, prisoners and the end of the campaign (M6)

Meanwhile scenes are not player actions and have no command or prompt of their own (`docs/26` §2,
`src/sim/campaign/meanwhile-flow.ts`). The sixteen Meduna scenes resolve with the original's "played" semantics as soon as
the gates pass (no battle decision open, the dialogue queue empty, nobody talking): the NPC moves and restores, Elliot's
counter, the implications on the Queen's AI. On the map the world clock stops (`compressionStopped {reason: 'meanwhile'}`,
which ends a default strategic `advance`); while a scene waits for its gates, compression is refused (`a meanwhile scene is
about to start`). Each resolved scene adds `meanwhile {seq, scene, sector: 'P3', at}` (`scene` is the camelCase name:
`endOfPlayersFirstBattle`, `drassenLiberated`, `cambriaLiberated`, `almaLiberated`, `grummLiberated`, `chitzenaLiberated`,
`nwSam`, `neSam`, `centralSam`, `flowers`, `lostTown`, `creatures`, `killChopper`, `awolScientist`, `outskirtsMeduna`,
`balimeLiberated`; `at` = world seconds) and an entry `{seq, scene, at}` to `observe.strategic.meanwhiles`. Scheduled scenes,
their delays, Elliot's counter and the AI effects stay hidden.

The interrogation (squad captured when quest `HELD_IN_ALMA` is already done, `docs/26` §2.3) is a scripted tactical scene:
the clock stops, N7 loads, the flow becomes `meanwhile` and `observe.meanwhile` is `{seq, scene: 'interrogation'}` (frames
carry `meanwhile` when it changes) until the scene ends. The Queen's records play in the conversation view of §6.12; her
lie question is the `npcRequest` prompt of §6.14 with `request: 'lie'` (choices `yes`, `no`, `lie`; the skill check stays
hidden), answered with `answer`. Every other command is refused with `inMeanwhile` (`data.refusal`); `observe`, queries and
`answer` work. `advance` runs the scene's ticks and stops with `decision` at the prompt and always with `event` at
`meanwhileEnded`; events `meanwhileStarted {seq, scene}` and `meanwhileEnded {seq, scene}` frame it. Afterwards the captives
are in N7 under normal tactical rules.

Prisoners: when I13 loads with captured mercs held there, they stay prisoners (neutral, assignment POW) and
`powsFound {sector, soldiers}` lists them; captives placed anywhere else (N7 after the interrogation) rejoin the team on one
new squad. A door opened or an explosion in I13 frees every prisoner that then has a path out of the cells: `powFreed
{soldier, sector}` each, back on a squad.

`useRemote {soldier}` (campaign or tactical) presses the remote trigger in the soldier's hand: 2 AP, 2 more when standing
(the original's animation). In the statue room of O3 it opens the statue (`statueOpened {sector: 'O3', destroyed: false}`,
an exit grid down to O3 b1); an explosion next to the statue opens it too (`destroyed: true`). Refusals: `no such soldier of
yours`, the `canAct` text, `the soldier holds no remote trigger`, `not enough APs: 2 needed`. `data` is `{result:
'statueOpened' | 'nothing'}` and the event `remoteUsed {soldier, result}`.

The end of the campaign (`docs/26` §7, `src/sim/campaign/endgame-flow.ts`): Deidranna's death emits `queenKilled {sector,
gridNo, level, killer}` and starts the flow `endgame` (`status.campaign` and `observe.strategic.campaign` = `endgame`). Every
command except `observe`, queries and `answer` is refused with `endgameInProgress`; `advance` plays the sequence in ticks
(the killer's and a witness's lines, the squad carried up to P3 with `squadMovedUpstairs {soldiers, sector: 'P3'}`, Derek's
and Oliver's records as `npcQuote`/conversation events). With the creature quest still open Derek says so,
`endgameDeferred {reason: 'creatures'}` stops the `advance` and the campaign goes back to `playing`; killing the creature
queen later emits `creatureQueenKilled {killer}` and resumes the ending. The ending emits the mercs' last lines and
`campaignWon {day, worldTime, difficulty, sciFi, ending: {miguelAlive, skyriderAlive}, mercDeaths}`; `advance` stops with
the new reason **`ended`**. From then on the flow is `ended`, `campaign` is `won`, `observe.ended` is `{outcome: 'victory',
at, day, ending, mercDeaths}` beside the last view, every command is refused with `campaignOver`, `advance` returns `ended`
at once without ticks and the session idles; a new game needs `newSession`. There is no game over: with no usable merc left
the campaign goes on, compression is refused (`no usable mercs are left on the team`) and `status`/`observe.strategic` carry
`noUsableMercs: true`.

Native saves taken during a played scene or during the endgame sequence are refused on import; the scene state of other
saves (definitions, the scene about to start, the first battle, the last battle) is imported.

### 6.19. Civilian quotes, the enemy surrender offer and NPCs on their own (M6)

`talk {soldier, target}` to an unnamed civilian, a militiaman or a visible enemy soldier with a merc body (`talkable:
civilian` in the view) runs the same checks, walk-up and 6 AP as a conversation (§6.12) but opens no panel: the target
barks a civilian quote (`docs/24` §8, `src/sim/narrative/civ-quotes.ts`). `data` is `{civQuote: {soldier, quote, entry,
hint, textKey, text?} | null}` when the target stood within 4 tiles (`null` when the line has no text and nothing is
shown); after a walk-up the bark arrives during `advance` as an event. `quote` is the civilian quote type (enemy, militia,
group, cowering, loyalty and all-purpose lines; `99` is a hint, whose text comes from the sector's file and which may
start a quest), `entry` the row. A civilian alternates between two lines and never gives two hints in a row; a second
`talk` barks again (the original's box is presentation, there is nothing to close). Event: `civQuote {soldier, quote,
entry, hint, textKey, chars}` (with `text` in the session's reports). The hicks' night warning in F10 is the same event.

**The enemy surrender offer** (`docs/24` §8.5). In battle an enemy soldier the squad sees, with at least half his life,
may offer surrender once per sector visit when there are fewer than four mercs, no militia and at least three enemies
per merc, and the Alma capture quests allow it. He barks the surrender line (`civQuote` with `quote` 37) and a
**surrender prompt** opens at once: `observe.prompt` (and view frames) carry `{id, kind: 'surrender', context: 'tactical',
soldier, choices: ['accept', 'reject']}` (the autoresolve battle's surrender offer now carries `context: 'autoresolve'`). Time
stands still until `answer {prompt?, choice: 'accept'|'reject'}`: `accept` captures every living merc in the sector
(`mercCaptured` events, the Alma or interrogation quest starts) and the battle is lost (`battleResult` defeat, the sector
unloads ten seconds later); `reject` lets the enemy go on. `data` is `{surrendered}`. Event when the offer opens:
`surrenderOffered {soldier, prompt}`. Without a campaign (sandbox sessions) the offer is declined at once.

**NPCs on their own.** Named civilians decide in real time before their routine (`docs/24` §5.4): after a record told
them to face the player they turn towards the closest merc and run their tile records once one comes within 8 tiles; an
NPC with something to say walks up to that merc (a conversation still needs a tile record or the player's `talk`); the
six assassins close in and turn hostile within 8 tiles. An NPC who just spoke does nothing for a minute of game time.
First sightings run the original's rules (a declaration of hostility, Joe and Elliot, Iggy, our mercs seeing Mike and
Joey with their merc lines, Mike greeting the squad once). While a hostile NPC delivers his declaration all AI is paused
and the speaker is revealed to the squad; when the hostile-quote list resolves, the listed civilians turn hostile, AI
resumes and combat starts. A recruited guide (Ira, Miguel, Carlos, Dimitri) standing in a described town or SAM sector
describes it once, 4–8 real-time turns after the first visit (`mercQuote` from his second dialogue file). None of this
has a command; the effects show as the events of §6.12 and this section.

### 6.20. Boxing (M6)

Boxing in the San Mona club (D5, `docs/25` §7) has no command of its own; it is played with the commands above.

- **The bet.** Talking to the club owner runs his records: a bet or a second fight is offered as `npcRequest`
  (`boxingBet`, `fightAgain`), money is handed over with `give` (§6.16) when a record asks for it, and the record that starts
  the match rings the bell (`boxingBell`). The match only starts when an unarmed boxer stands on one of the club's three
  boxer tiles.
- **`observe.boxing`** (and the `boxing` field of view frames) is null outside a match and otherwise `{state, boxers,
  uiLocked}`: `state` one of `waitingForPlayer`, `preBoxing`, `boxing`, `disqualified`, `wonRound`, `lostRound`; `boxers` the
  ids of the soldiers in sight that carry the boxer flag (ours included); `uiLocked` true while the boxers walk out.
- **The fight.** One merc of ours walks into the ring (room 29): `preBoxing`, a club boxer is picked and walks in, then
  `boxing` and turn-based combat (`combatStarted`, the first team drawn from the two boxers). While a match is set up or
  fought every soldier gets half his action points and carries at most 2 into the next turn, nobody interrupts, a boxer seen
  by the squad does not start combat on his own, and the other civilians stand and watch. Punch with `attack` on an adjacent
  boxer with empty hands (brass knuckles are allowed too); walk next to him with `move` first (the AI boxer closes in by one
  tile per decision). A second merc of ours entering the ring, a boxer leaving it, or a knife or brass knuckles used by
  anyone who is not a boxer disqualify the player (`disqualified`); a gun, or any attack by someone else, calls the match off
  (state back to null). A boxer who stays down for more than one turn, or dies, loses the round (`wonRound` / `lostRound`).
- **The end.** The owner closes the fight: combat ends (`combatEnded` with reason `boxing`), the club boxer turns neutral and
  our boxer walks out of the ring under AI control. Meanwhile every command but `estimateAttack` and `answer` is refused with
  `boxingUiLock` and the session is not idle, so `advance {idle}` runs the walk. When our boxer is out, the history gains
  `WON_BOXING`, `LOST_BOXING` or `DISQUALIFIED_BOXING` (`historyAdded`) and the owner says his result line (a conversation to
  close with `closeTalk`). If our boxer died in the ring, the lock ends once the club boxer is out; the round stays decided
  (no history line, no result line) until `mapScreen` with `abandonFight` or the next bet.
- `mapScreen` is refused with `boxingInProgress` while a boxing state is set; `{"type": "mapScreen", "abandonFight": true}`
  abandons the fight and opens the map. An enemy group reaching D5 during a match arrives 3–5 minutes later.
- **Events:** `boxingBell`; `boxingState {state, previous}` on every change; `boxerPicked {soldier, slot}`; `boxingRoundOver
  {loser, result: won|lost}`; `boxerDisqualified {soldier, reason: outOfRing|nonBoxerInRing|badAttack}`; `boxingEnded {soldier,
  result: won|lost|disqualified|null}`. The boxer tiles, the fought flags, the rests, the stat bonus of rested boxers and the
  facts stay hidden.

### 6.21. Text and languages (M7)

Two independent settings decide text (`docs/27` §5.2). The **data version** belongs to the content: detected once at
server start like Stracciatella's guesser (language folders inside the SLFs; English otherwise), overridden with
`JA2_DATA_VERSION=english|russian|russianGold|german|dutch|french|italian|polish|simplifiedChinese` (Russian Gold must be
named), `stubs` without original data. It selects the EDT decoding, the NPC record layout of the Buka release and the
prof.dat name fix, and reaches the simulation only through decoded quote lengths and record layouts. The **display
language** (`eng`, `rus`, `ger`, `dut`, `fr`, `it`, `pl`, `chs`) only picks the UI string tables: Stracciatella's
`translation-<suffix>.json` and per-language files, `rus` reading `translation-rusgold.json` and the `-rus` files as
Stracciatella does for both Russian versions. The server default is `JA2_LANG`, else the data version's language (stubs:
`eng`); each session has its own. EDT text (dialogue, item names, mails) always comes in the data version's language.

- **`GET /api/health`** adds `dataVersion` and `language` (the server default).
- **`GET /api/strings?lang=`** (token, `ETag`, `cache-control: private, max-age=3600`; `lang` defaults to the server's):
  `{language, files, tables, keys}`; `tables` holds the 217 `L10n` keys (arrays checked against the sizes of
  `Localization.h`, `data/tables/l10n.json`) and the per-language files under their Stracciatella names (`new-strings`,
  `strategic-map-land-types`, `strategic-map-town-names`, `strategic-map-town-name-locatives`, `ammo-calibre`,
  `ammo-calibre-bobbyray`, `shipping-destinations`); `keys` maps machine tokens to `{table, index}` (below).
- **`GET /api/text`**: `?file=<edt>&row=R[&column=C]` for every EDT file the game reads, with its record layout from
  `data/tables/edt-layouts.json` (no `width` parameter): `{file, row, layout, columns, column, width, text}`; 400 for a
  file without a layout, 404 for a missing file or row. Stub files (`stubs/…`) are read only when the data version is
  `stubs`. `?table=<L10n key or file>&index=I&lang=` and `?key=<token>&lang=` resolve UI strings: `{key?, table, index,
  language, text}`; `lang` applies only to these.
- **`GET /vfs/<path>`** falls back to `stubs/<path>` when the data version is `stubs`, so stub sounds, music, speech
  blips and text answer under the original path names (many names share one synthesized file through the stub layer's
  alias manifest, `docs/27` §6.5); `x-vfs-layer` says `stubs`. With the original data there is no fallback.
- **Text keys** (`src/server/text-keys.ts`): `morale.<great|good|stable|poor|panic|bad>` → `pMoralStrings`,
  `condition.<excellent…dead>` → `pConditionStrings`, `talkMenu.<repeat|friendly|direct|threaten|give|recruit>` →
  `zTalkMenuStrings`, `shopKind.<buySell|buy|sell|repair>` → `zDealerStrings`, `moveRefusal.<token>` → `pMapErrorString`
  (the entries with a string of their own), `assignment.<n>` → `pAssignmentStrings`.
- **Sessions**: `newSession {language}` (MCP and `POST /api/sessions`) sets the session's display language; `status`,
  `GET /api/sessions` and `observe` show `language` and `dataVersion`. MCP observations stay English-keyed JSON with the
  machine tokens; `observe` adds labels in the session's language beside them: `moraleLabel` and `assignmentLabel` on
  strategic mercs, `menuLabels` on the conversation (null where the original has no string), `kindLabel` on the shop.
  Changing the language never touches the simulation, its saves or its logs.

### 6.22. Saves (M7)

ja2-node's own save files (`docs/27` §1.3–§1.7): one `<name>.j2s` per save in `$JA2_SAVE_DIR` (default `.ja2/saves/`
in the repository, gitignored), a gzip of one JSON document `{format: 'ja2-node-save', version, header, session,
contentFiles, sim, presentation}` written as two gzip members, so the save list reads the header from the first few
hundred bytes. Clients pass names, never paths: `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`; `QuickSave`, `Auto01`, `Auto02` and
`Error` are reserved. Native `.sav` files stay in `$JA2_SAVES_DIR` (`docs/14` §10) and are listed read only.

- **MCP.** `save {session?, name?, description?}`: without `name` a new save `<UTC time>-<slug of the description>`
  (Stracciatella's naming), `name: 'quick'` writes `QuickSave`, any other name writes or overwrites that save;
  `description` is cut to 46 characters. Returns `{ok, name, kind: player|quick|auto|deadIsDead, header}` or `{ok:
  false, refused, reason}`. `load {name, session?, reseed?}` loads into `session` in place or, without it, into a new
  session; `newSession {load, reseed?}` is the same. `listSaves {}` returns ja2-node saves (`native: false`, the header)
  and native saves (`native: true`, the native header: description, day, hour, minute, sector, mercs, balance,
  options), newest first, with `compatible` and `problems` (`versionTooNew`, `contentMismatch`, `needsOriginalData`).
  `deleteSave {name}` deletes a ja2-node save and its log.
- **HTTP.** `GET /api/saves`; `POST /api/sessions/:id/save` (`{name?, description?}`; 409 for a refusal, 400 for a bad
  name); `POST /api/sessions/:id/load` (`{name, reseed?}`); `POST /api/sessions {load, reseed?}`; `DELETE
  /api/saves/:name` (404 when absent); `GET /api/saves/:name/file` (`application/gzip`); `PUT /api/saves/:name/file`
  (the body is the file, at most 32 MiB: 413 above; parsed, version and content checked before it is written);
  developer only, `POST /api/sessions/:id/snapshot` (`{name?, description?}`) writes a save ignoring the save rules.
  Load refusals map to 404 (`notFound`), 409 (`contentMismatch`, `versionTooNew`, `noMigration`) and 400 (`invalidName`,
  `notASave`, `corrupt`).
- **WebSocket.** `{t: 'save', id, name?, description?}` and `{t: 'load', id, name, reseed?}` answer with `result` (`data`
  is the outcome, `reason` the refusal code). A load in place sends every subscriber of the session a fresh `welcome`;
  when the real-time driver was running it stops (the driver becomes `manual`) and the subscribers first receive
  `stopped {report: {reason: 'loaded'}}`.
- **Events.** `gameSaved {name, kind}` after a player or quick save and `gameLoaded {name, seed}` after a load arrive with
  the next `advance` report of that session; autosaves and Dead is Dead saves send none, as in the original.
- **Save modes.** A campaign option chosen at the new game: `newSession {campaign: {options: {saveMode: 'anywhere' |
  'ironMan' | 'deadIsDead'}, deadIsDeadName?}}` (default `anywhere`, `campaign.saveMode` stays an alias; the Dead is Dead
  file defaults to `DeadIsDead`); a native import
  takes the mode of its header, and a Dead is Dead import saves under the native file's name. `status`, `GET
  /api/sessions` and `observe` show `saveMode`, `canSave` and, when a rule applies, `saveRefusal`. Refusals of `save`:
  `conversation` (a conversation is open, a scripted sequence runs or the dialogue queue is busy), `meanwhileStarting`
  (a meanwhile scene starts or plays), `promptOpen` (a battle, contract, militia or NPC prompt, or an autoresolve battle),
  `shopOpen`, `ironMan` (Iron Man: in turn-based combat or while the loaded sector holds enemies) and `deadIsDead` (an
  explicit save in Dead is Dead; `save {name: 'quick'}` writes the Dead is Dead file there, or answers
  `actionInProgress` outside our turn or while something still acts), plus `invalidName`, `reservedName` and
  `notSaveable`. A won campaign can be saved; loading is never restricted.
- **Autosave.** When `endTurn` is accepted in turn-based combat and combat goes on, the state from just before the
  command goes to `Auto01` or `Auto02` (the older or missing one), if the mode allows a save (never in Iron Man, the
  original's `UIHandleEndTurn`). In Dead is Dead the game writes its one file, after two backups
  (`Backup/<name>.j2s.1`, `.2`), at the start of our turn, at `endTurn`, when a meanwhile starts, when a group is about
  to arrive, before another save is loaded into the session and when the server stops; it is written only on our turn
  with no conversation, meanwhile, prompt, shop or action in progress, at the end of the input that saw the save point
  (later, once these hold).
- **Load modes.** By default a load is a player load: the saved state is restored exactly, then the main random stream
  is reseeded from a server seed (`crypto.randomInt`), returned as `seed` and logged as `reseed {seed}`; the `PreRandom`
  ring repeats its saved values until they are used up, as after a native reload. `reseed: false` is an exact load:
  the game continues bit for bit like the saved one (reproducible experiments, bug reports). A load checks the logic
  content before anything is built: another content source (stubs against original data) or other files feeding the
  simulation refuse it (`contentMismatch`); another data version or other quote lengths load with the warning
  `dataVersionDiffers`, another engine version or commit with `engineDiffers`. The result carries `warnings`.
- **Input log and replay.** Every save whose session has a known origin (a new sandbox or campaign with its seed and
  request, a native import with the file's digest, or the save it was loaded from) gets `<name>.log.jsonl.gz`: one
  JSON line for the origin, then `{seq, tick, kind, payload}` per input (`cmd`, `answer`, `advance`, `drive`, `reseed`,
  `load`, `prepare`). `pnpm cli replay <name>` rebuilds the origin, re-runs the log with the manual driver and compares
  the snapshot with the save. When a command or a step throws, the server writes the whole log as
  `Error.log.jsonl.gz` instead of an error save.

### 6.23. Game options and music (M7)

**Game options** (`docs/27` §2.2, §2.4) are session state, shared by the strategic and the tactical layer, saved and
shown: `{difficulty: 1 | 2 | 3, sciFi, gunNut, saveMode: 'anywhere' | 'ironMan' | 'deadIsDead', bloodAndGore}`.

- **New campaign.** `newSession {campaign: {options: {...}}}` (MCP and `POST /api/sessions`): missing fields take the
  original's defaults (sci-fi on, reduced guns, save anywhere, blood on) except `difficulty`, whose default here is 2
  (the original's is easy). `campaign.difficulty` and `campaign.saveMode` remain accepted as aliases; one that
  contradicts `options` is refused. The sandbox uses the defaults.
- **Shown** in `status`, `observe` and `GET /api/sessions` as `options`, in every save header (`listSaves`), and for
  native saves in the same shape (`droppedOptions: ['turnTimeLimit']` when the original's timed turns were on: they are
  not ported). A native import's `newSession` answer carries the import report as `import` (with `droppedOptions`).
- **`setOption {bloodAndGore: true | false}`** (an `act` command, logged and replayed like any other): the only option
  that may change during a game, as on the original's options screen; accepted in any flow, refused with `promptOpen`
  while a battle, contract, militia or NPC prompt is open and with `badOption` for any other field; it applies from the
  next tick and reports `optionChanged {bloodAndGore}`. Off: no messy deaths from close head and chest shots, no exploding
  bodies, the clean corpse graphics.
- **Client settings** (volumes, speech, subtitles, key-advance speech, the sleep/wake notification, display toggles,
  playback speed, language, meanwhile scenes seen, help, cover and LOS sizes) are per browser
  (`src/app/settings.ts`) and never reach the simulation; an agent that wants the original's sleep/wake stop passes
  `fellAsleep` and `wokeUp` in `advance {until: {events}}`.

**Music** (`docs/27` §3.3, §3.7) is presentation the server computes, so every client hears the same mode: the
session keeps the original's music mode (`none`, `mainMenu`, `laptop`, `tacticalNothing`, `tacticalEnemyPresent`,
`tacticalBattle`, `tacticalVictory`, `tacticalDefeat`) from the simulation's events and the creature flag, sends
`music {mode, creature}` in the WebSocket `welcome` and in frames when it changes (`fastFade: true` after a sector entry
or exit), and keeps it in saves (`presentation.music`); a native import starts at the saved mode. The browser chooses
the tracks (`music.json`), fades and loops. MCP `observe` carries no music.

## 7. Cost and limitations

- **Amount of work.**
  - Added: the protocol, the session server, the visibility projection, a log player in the client and
    an MCP adapter. By a rough estimate this is +10–15% on top of tactics and strategy.
  - In return we get for free: headless tests through the same API, automated playtesting by an agent,
    replays and debugging.
- **Discipline.**
  - In the original, a lot of logic lives right in the screens: hiring on the laptop, trading, drag-and-drop
    inventory, map assignments, dialogues. All of it has to be lifted into commands and decision
    prompts.
  - The work is the same as before, but now there is no "cutting corners" at the boundary.
- **Real time over the network.** On localhost the input latency is ~50–100 ms (the playback buffer), which is
  unnoticeable for JA2. Playing from a remote server is possible, but it is not a goal.
- **License.**
  - A server for yourself, on your own machine or at home: allowed.
  - A public server with the original data is distribution of commercial assets: not allowed.
  - A public server on stubs: allowed non-commercially, with the SFI-SCLA text.
- **Non-goals:**
  - real-time control by an LLM agent without pausing;
  - bit-exact replay compatibility with the native game.

---

## 8. What changes in the architecture and milestones

The changes have been made in `01-architecture.md` v0.2.
- **Decisions:**
  - D13: the server as the source of truth;
  - D14: time is controlled externally (`advance`, drivers), playback is separated from the simulation;
  - D15: all player actions are commands, modal moments are decision prompts;
  - D16: the player-view projection.
- **Layers:** added `protocol`, `server`, `agent`. The client (`app`, `ui`, `render`, `audio`)
  no longer runs the simulation; it plays back the log.
- **Data:** the server reads the original from `JA2_DATA_DIR`, and the browser gets media via `/vfs`.
  Import into OPFS remains only for embedded mode.
- **Milestones:**
  - in M0 the server with `/vfs` replaces the Vite plugin;
  - M2 brings protocol v0, agent API v0 (MCP: `status`, `observe`, `act move`,
    `advance`) and a browser viewer;
  - M3 brings instant mode, accelerated playback and the agent's battle for Omerta.

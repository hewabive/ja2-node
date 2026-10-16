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

- Stored as files on the server.
- The command log with ticks plus the seed gives an exact replay of a game. This will come in handy for bug reports,
  regression tests and analyzing an agent's play.

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
| `newSession` | Starts another session and returns its id: the sandbox (optional seed), with `campaign {difficulty?, profiles?, mercs?, land?}` a new campaign (§6.6), or with `save` a native savegame from the game's `SavedGames` folder (`docs/14` §10); every other tool takes `session`, so agents and tests do not share one battle |
| `save` / `load` | Saves on the server |

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
runs an `impCreate`, and `hire: []` without `imp` returns the session in the open laptop. `difficulty` is 1–3 (default 2). Maps are loaded by
`WorldCache` before each command (`Session.prepareAndDispatch`).

Sessions are created through MCP `newSession`, `POST /api/sessions` (same JSON body: `{seed?, save?, campaign?}`;
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

### 6.12. Conversations (M6)

A conversation with a named NPC is a modal **talk session** (`docs/24` §11, `src/sim/campaign/talk-flow.ts`), built on the
NPC record arrays (`state.npcRecords`, imported from native saves) and the dialogue queue (`src/sim/narrative/`). Commands
(refusals in `data.refusal`, the reason reads `<code>: <text>`):

- `talk {soldier, target}`: `target` is a soldier id or `{npc: <profile id or internal name>}`. Refused with `notInTactical`,
  `promptOpen`, `shopOpen`, `sessionOpen`, `scriptedSequence`, `canAct` (the tactical refusal text), `noSuchTarget`,
  `notTalkable`, `targetHidden`, `targetMoving`, `talkerIsRobot`, `noLineOfSight`, `targetCollapsed`, `refusesToTalk`
  (Dimitri), `civilianBark` (unnamed civilians come later), `noPath`, `notEnoughAP` (6 AP). Talking to an own merc barks
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
stub pack's invented lines); `GET /api/text?file=npcdata/NNN.edt&row=R&width=240` (token-protected) serves a single row.
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

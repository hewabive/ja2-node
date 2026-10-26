# Architecture and Technology

*Draft v0.2, 2026-10-15. Based on an analysis of Stracciatella code at `ae6bf01`.
v0.2: server-side state, agent API, time control (D13–D16).*

Related documents:
- [`00-scoping.md`](00-scoping.md) — scope and license;
- [`02-mechanics-catalog.md`](02-mechanics-catalog.md) — mechanics catalog with formulas and code references;
- [`03-logic-animation-coupling.md`](03-logic-animation-coupling.md) — how logic is intertwined with animation in the original;
- [`04-time-and-server.md`](04-time-and-server.md) — instant mode and speed-up, server, agent
  API. It also has the numbers from `Ja2bin.dat`.
- `05`–`14` — tactical specs (rendering, soldiers, movement, sight, AI, turn-based, attacks, items, combat AI,
  savegames);
- `15`–`19` — strategic specs for M4: [`15`](15-strategic-time.md) clock and events,
  [`16`](16-strategic-map-movement.md) map, groups, travel and sector transitions, [`17`](17-strategic-ai.md) the
  Queen, [`18`](18-militia-loyalty-mines-assignments.md) militia, loyalty, mines and assignments,
  [`19`](19-autoresolve-pbi.md) pre-battle interface and autoresolve.
- `20` lighting; `21`–`23` laptop, contracts and merchants (M5); `24`–`26` NPCs, quests and the ending (M6);
  [`27`](27-polish.md) saves, options, sound, video, localization, stubs and performance (M7);
  [`deviations.md`](deviations.md) the deviation log; [`releases.md`](releases.md) the release notes.

---

## 0. Starting conditions

- We have a legal copy of the game. Development uses the original data, and the stub pack is
  needed for CI, tests and a data-free version.
- **The goal is the original's behavior, not its code.** Formulas, constants, check order,
  integer rounding and randomness semantics are carried over exactly. Code structure,
  rendering, UI, assets and saves we write our own way.
- **Game state lives on the server (Node).**
  - The browser is a client: playback and input.
  - Agents, e.g. Claude via MCP, play through the same API as the browser.
  - Node also runs tools, headless runs and tests.
- The original data lives on the user's machine: `JA2_DATA_DIR=/home/daniel/Jagged Alliance 2 Gold/Data`
  (Steam, 1.12).

## 1. Key decisions

| # | Decision | Why, in short |
|---|---|---|
| D1 | **The behavioral reference is Stracciatella with default settings.** That is vanilla 1.12 Gold mechanics plus bug fixes. Its `game.json` flags are kept as configuration | The same JA2, just without bugs like "bandaging increases the to-hit penalty" |
| D2 | **The simulation core is separate from presentation.** Deterministic, no DOM and no Node API, serializable, no global mutable state (multiple sessions in one process) | Tests, headless runs, comparison with the original, saves and replays "for free". *As built (M7) the whole session serializes through the snapshot codec (`src/sim/snapshot`) and restores exactly; sound, music and video are derived by the client from events and frames, the music mode by the server outside `sim` (`27` §1.3, §3.3)* |
| D3 | **Unified game time: integer milliseconds, fixed 5 ms tick** (like `TOVERHEAD` in the original). All processes are tied to ticks, not to frame rate | Outcomes don't depend on FPS or machine speed |
| D4 | **Animations enter the simulation as data.** Action timelines: frames, delays, gameplay markers. Sprites do not enter the simulation. Verified on `Ja2bin.dat`: 308 scripts, 54 gameplay opcodes (`04`, §1) | In the original, a shot, a death and a door opening happen on animation frames. Durations are numbers; they can be computed without waiting |
| D5 | **A resolution barrier instead of `ubAttackBusyCount`.** An explicit set of pending effects | Same semantics, but debuggable. *As built (M3–M7) the barrier is still the original's counter (`turns/turn-state.ts` `attackBusyCount`)* |
| D6 | **Three randomness streams.** `pre` — a ring of 256 numbers, saved. `main` — gameplay. `fx` — cosmetics, not saved | Anti-save-scum protection as in the original; cosmetics don't affect outcomes. *As built (M7 S1) the cosmetic streams live in `StrategicState`, seeded from the session seed, and are saved, because a few cosmetic picks are stored in state (`27` §1.4 row 8); since M7 S2 a snapshot writes `main`, `pre` (ring, index and its refill link) and every cosmetic stream exactly, and `Rng.restore` restores a stream in place for the player load's reseed (`27` §1.5)* |
| D7 | **State is plain data:** ids instead of pointers, grids in typed arrays | Serialization, debugging, moving to a worker. *As built the tactical layer holds soldier references; the session, flow and roster state moved into `StrategicState` and `TacticalState` in M7 S1, and the M7 S2 snapshot codec writes the references as references to the object's home (`soldiers/<id>`, `items/<i>`, the structure lists) and content as keys (`27` §1.4)* |
| D8 | **Content is a canonical data model.** Original formats are read by importers on the server; decoders have no DOM and no Node, so media is decoded in the browser too. Stubs are an alternative source of the same model | The game doesn't know where the data came from |
| D9 | **Rendering is our own thin layer on WebGL2:** indexed sprites, palettes, shading tables, strip-based depth | Soldier palettes and tile lighting are cheap only in a shader |
| D10 | **Game UI is our own canvas widget set, with layouts stored as data.** DOM only for the launcher and dev tools | Pixel-perfect 640×480 with original art or a stub skin. *As built (M7) the DOM launcher exists (`src/app/launcher`); the canvas UI is M8 (`27` §8), specified in `28`: a DOM-free `ui` layer, layouts as JSON skins (the original's one of them) bound to screen controllers* |
| D11 | **Verification rests on two tooling pillars.** Rule tracing from a patched native Stracciatella and importing its saves | It's the only way to prove the mechanics match |
| D12 | **One package (pnpm), layers separated by TS project references and our own import check** (`tools/check-imports.ts`; dependency-cruiser 18 doesn't read TS 7) | Simplicity for a solo project with strict boundaries. *As built (M7) the browser layers are `render`, `audio`, `app` and `devtools`; the MCP adapter lives in `server` (there is no `agent` layer). M8 U0a added the DOM-free `ui` layer (`28` §2.1, §17.4)* |
| D13 | **The server is the source of truth.** Sessions with simulations live in the Node process. The browser, the MCP agent and scripts are equal clients of one protocol | State on the server, play through the API, replays and saves in one place. *As built (M7) every surface talks to a `SessionHost`: in process with 10 ms time slices, or one worker thread per session (`04` §5.9)* |
| D14 | **Time is moved by a driver; playback is separate from the simulation.** `advance(until)` with stop conditions; "real time ×k", "instant" and "manual" drivers; the client plays back the event log at any speed or skips it | Instant enemy turns and arbitrary speed-up without changing outcomes |
| D15 | **Every player action is a semantic command; every modal moment is a decision prompt.** Not a single rule in UI screens | The agent and the UI control the game the same way; the simulation never waits for the client |
| D16 | **Player-view projection** (`PlayerView`) — one function for the UI, agents and queries | Honest information for the agent and no hidden-state leaks |

---

## 2. Layers

```
 BROWSER (client)                                  NODE (server)
┌─────────────────────────────────────────┐       ┌───────────────────────────────────────┐
│ app   playback loop, input, launcher,   │       │ server  sessions, time drivers,       │
│       event-log player                  │       │         saves, command log,           │
├──────────┬──────────┬────────┬──────────┤  WS   │         /vfs, HTTP, WebSocket         │
│ ui       │ render   │ audio  │ devtools │◄─────►├───────────────────────────────────────┤
│ widgets, │ WebGL2   │ Web    │ assets,  │       │ agent   MCP adapter, text             │◄──► MCP agent
│ screens  │          │ Audio  │ timelines│       │         observations (ASCII, deltas)  │
└──────────┴──────────┴────────┴──────────┘       └───────────────────────────────────────┘
          shared layers, no DOM and no Node API (can run in both places)
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ protocol  commands, events, PlayerView projection, queries, client and server messages  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ sim       core: state, rules, tactics, AI, strategy, campaign, narrative, flow;         │
│           API: dispatch / advance / step / events / query / view                        │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ content   data model, VFS, format decoders, import, stubs, timelines                    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ core      RNG, clock, event bus, integer helpers, deterministic math, id                │
└─────────────────────────────────────────────────────────────────────────────────────────┘
tools (Node CLI): inspect · stubs · sim · oracle · save-import
```

**Dependency rules.** They are checked automatically in three ways:
- project references in tsconfig: an import from a layer that isn't referenced doesn't compile;
- `lib` without DOM and `types` without `@types/node` in the shared layers;
- `tools/check-imports.ts` (`pnpm imports`): allowed layers and packages for each layer, explicit
  `.ts` extensions, a ban on `Math.random`, `Date` and timers in deterministic layers.

Per-layer rules:
- `core` depends on nothing.
- `content` depends only on `core`.
- `sim` depends on `core` and the *model types* of `content`, but not on the decoders or the VFS.
  Ready-made data is fed to it as input.
- `protocol` depends on the types of `sim` and `content`. It is the only thing the client knows
  about the simulation.
- `server` and `agent` depend on `sim`, `content` and `protocol`. They live only in Node.
- The client (`app`, `ui`, `render`, `audio`) depends on `protocol` and the `content` model (sprites,
  timelines for playback). It receives state as snapshots and an event stream, and can change it only
  through commands. As built (M8 U0a, `28` §2.1):
  - `ui` (DOM-free, deterministic, time injected) depends on `core`, `content` and `protocol`: the draw list, the
    screen and modal stacks, input events, the UI scale and the screen controllers;
  - `render` may import only types from `ui` (the draw list it draws);
  - `app` may import `ui` and `sim`: the cursor hints run the simulation's own functions over the player-knowledge
    projection in the browser (`28` §2.4); the client never reimplements a rule and never feeds the simulation;
  - `devtools` may import `ui`.
- `node` is the shared Node layer (VFS on top of the disk, token, repository paths) for `server`,
  `tools` and `stubs`.
- `tools` may use anything, but live outside the browser build.

---

## 3. Simulation core (`sim`)

### 3.1. API

```ts
interface Sim {
  readonly state: DeepReadonly<GameState>;
  dispatch(cmd: Command): CommandResult;   // order from the player, AI or UI: rule check → enqueue
  advance(until: StopCondition): StopReport; // run ticks until idle / decision prompt / event / limit
  step(ticks: number): void;               // advance by N ticks of 5 ms
  drainEvents(): SimEvent[];               // tick-stamped log: for playback, agents and replays
  view(side: Side): PlayerView;            // player-view projection (D16)
  readonly query: Queries;                 // pure queries for UI and AI: hit chance, path cost, LOS, …
}
```

`StopCondition`, the time drivers and the protocol are described in `04`, §4–§5.

- **Command** — an intent, for example:
  `MoveTo`, `Shoot{target, aimClicks, burst}`, `Throw`, `Melee`, `ChangeStance`, `Reload`,
  `UseItem`, `OpenDoor`, `Climb`, `EndTurn`, `Bandage`, `AssignSquad`, `SetTimeCompression`,
  `HireMerc`, `AdvanceDialogue`, …
- **SimEvent** — a fact for presentation, for example:
  `FrameMarker{soldier, sound}`, `ShotFired{path}`, `Hit{soldier, dmg, location}`,
  `Quote{merc, id}`, `ExplosionStarted`, `TurnChanged`, …

  The simulation doesn't need events to work. They are a log: presentation can play it back
  at any speed or ignore it (headless). For playback, the log contains everything needed to
  reconstruct the picture frame by frame: animation start (state, frame delay, position,
  direction), tile transitions, bullet paths.
- **Queries** — the same rule functions that the simulation itself uses. The hit chance in the UI
  is computed by the same code as the roll.

### 3.2. State

```ts
interface GameState {
  version: number;
  clock: { tick: number; worldSeconds: number; compression: number; paused: boolean };
  rng: { main: RngState; pre: { ring: Uint32Array /*256*/; index: number } };
  flow: FlowState;                 // strategic | tactical | pbi | autoresolve | conversation | meanwhile | …
  campaign: CampaignState;         // money, contracts, email, history, insurance, Bobby Ray, IMP
  strategic: StrategicState;       // sectors, groups and routes, event queue, Queen, militia, loyalty, mines
  profiles: MercProfile[];         // mutable profiles (stats grow, relationships change)
  narrative: NarrativeState;       // facts, quests, NPC record states, schedules
  tactical: TacticalState | null;  // loaded sector
  sectorDiffs: Record<SectorId, SectorDiff>;  // changes to visited sectors relative to the map
}
```

- **No pointers**; all links are by id: `SoldierId`, `ItemId`, `GroupId`. The analogs of
  `Menptr[]` are arrays where the index is the id, as in the original.
- **The world grid is struct-of-arrays.** `Uint16Array(25600)` for flags, heights and light;
  `Uint8Array` for movement costs. Level lists and structures on a tile are stored in
  flat pools with indices. Order in the lists affects rendering and logic, so it is preserved.
- **Static is separate from dynamic.** Map geometry is immutable content data.
  Opened doors, destruction, items and corpses are stored in `SectorDiff`, like the temporary
  sector files in the original.
- **Integer semantics.**
  - Fixed-width fields (`INT8` action points, `UINT8` noise) are assigned via the
    `u8/i8/u16/i16/u32/i32` helpers from `core`.
  - Division goes through `idiv` (truncation toward zero), multiplication through `Math.imul` where needed.
  - The mechanics catalog marks the places where overflow affects the result.
- **Determinism.** Banned in the core:
  - `Math.random`, `Date` and timers;
  - `Math.sin`, `cos`, `atan2`, `exp`, `pow`: their results can differ between engine
    versions. Instead, our own functions in `core/math`, via tables or polynomials;
  - mutable module-level variables.

  Test: two sessions with the same seed and command log in one process produce the same
  event log.

### 3.3. Time

**A tick is 5 ms of game time.** All of the original's timers are converted to ticks with the same values.

| Process | In the original | Ours |
|---|---|---|
| Soldier animation frame | A counter of `sAniDelay` ms against the wall clock | A tick-based accumulator, `sAniDelay` formula preserved: speed depends on breath, wounds, agility, terrain, drugs; twice as fast in combat, twice as slow in stealth |
| Bullet flight | "≥ bulletSpeed/10 ms, but no more often than a loop frame" — depends on FPS | Deterministic: N ticks per tile |
| Throw physics | Fixed step every 20 ms | 4 ticks |
| Real-time AI | Every 50 ms, plus "as much as we can fit in 10 ms of CPU" | Every 10 ticks, a fixed number of soldiers per pass |
| Real-time "turn" (bleeding, breath, smoke, grenades) | 5000 ms | 1000 ticks |
| Explosion damage keyframe, `DOOR_BUSY`, bomb queue, 20 ms hit delay | Animation frames and wall-clock time | Ticks |

**Time modes**

| Mode | Tactical ticks | World time (strategic) |
|---|---|---|
| Strategic map | Stopped | Runs with compression 0 / 1× / 5 min / 30 min / 60 min per second |
| Tactical, real time | Running | Runs: 5 ms per tick, with compression if allowed |
| Tactical, turn-based combat | Running: animations, bullets and explosions play out | **Frozen**, as in the original |
| Decision prompt: interrupt, dialogue with a choice, message box, PBI | Stopped | Stopped. Resumes on the client's response (`answer`); in headless, per the auto-answer policy |

**Who moves time** (D14, details in `04`, §4):
- **"Real time ×k"**: the server runs ticks by the wall clock × k. This is the mode for a human in the
  browser.
- **"Instant"**: `advance` until `idle` or a decision prompt at full CPU speed. Enemy turns,
  autoresolve, tests.
- **"Manual"**: time moves only via explicit `advance` calls. This is the agent and debugging mode.

Turn-based combat yields the same outcome with any driver. The expected cost of an enemy turn without
playback is tens of milliseconds (`04`, §4.5).

**The client** does not run the simulation. It plays back the event log at its own pace: 1×, faster,
"skip" or "unseen instantly".

### 3.4. Action timelines: animations as data

In the original, tactical "game time" is essentially "animation frames played". Logic
hangs on frame markers: fire is opcode 430, death commit 440, door opening 495,
roof-climb commit 408/475, throw payment 460/461. Therefore:

- Animation scripts (`ja2bin.dat`, 320 states × 100 slots) and state metadata
  (`gAnimControl`: flags, speed, "non-interruptibility") are compiled into **timelines**.
  A timeline contains a sequence of frames, gameplay markers with frame numbers, transitions
  and jumps.
- **The simulation executes only gameplay markers.** These are ~60 opcodes from group (b) of report
  `03`: fire, burst, misfire check, throw, melee damage, death and loss of
  consciousness, falling, climbing and jumping, doors, picking up and dropping items, state changes,
  end of animation (499).
- **Visual markers** (sounds, flashes, z-override, camera, idle animations) go to the
  event log for presentation and don't affect outcomes. The exception is the fall sound 721/722:
  in the original it also breaks fragile items, and this is carried over into the simulation.
- The soldier state stores only `anim: {state, frame, accumulator}`. The renderer finds the sprite
  by `(body, state, frame, direction)`. As built in M8 (U0b) the simulation steps a *logic timeline* that holds no
  sprite frame numbers and the soldier keeps the slot of its current frame (`frameSlot`); the view takes the sprite
  frame from the *presentation timeline* (`src/content/anim/timelines.ts`, §4.2).
- **The client uses the same timelines.** On an "animation started" event it plays the
  frames itself with the right delay and playback speed. That is why timelines live in `content`,
  not in `sim`.

**Timeline sources:**
- original: the importer reads the user's `ja2bin.dat` on the fly;
- stubs: our own authored JSON timelines for one body type, ~40 states;
- the `gAnimControl` state metadata is a table from the *source code* (SFI-SCLA).
  We transcribe it to JSON once and distribute it.

### 3.5. Protocols carried over exactly

Source: report `03`, §2–§4. This is the "skeleton" of tactics, and its ordering is part of the behavior.

1. **Tile step.**
   1. At the tile center, before leaving: breath check, door or fence, AP and BP payment
      (`DeductPoints`), probing for a mine ahead, random hazards: gas (1 in 5), marbles,
      a drunk falling over.
   2. Halfway: transition to the new tile, after which bullets hit it there. Also at this
      point: door auto-close, scent, water, gas.
   3. At the center of the new tile, strictly in order: collapse → mines → noise and noise interrupt
      → sight and sight interrupt → mine search → new situation for the AI.
2. **Turns** go one eighth of a circle per step. Each step has a sight check without
   interrupts; AP is paid in advance.
3. **Attack.**
   1. Preparation or turning.
   2. Fire marker: AP is deducted here, and the `PreRandom(100)` roll happens here too, *separately
      for each round of a burst*.
   3. The bullet moves one tile per step and checks the *current* occupants and their stance.
   4. Hit: damage immediately.
   5. Reaction: knockback, falling.
   6. Release.
4. **A grenade throw** is resolved **at the moment of the order**: the point, force and angle are fixed
   immediately. AP and the actual release happen at marker 460/461. An NPC's throw can be canceled before that
   marker.
5. **Resolution barrier.** Until all bullets, objects, explosions and hit reactions
   have finished:
   - interrupts are forbidden;
   - noise is deferred;
   - the AI doesn't replan.

   When no effects remain: suppression → attack consequences, including entering combat →
   sight check → deferred noise with its interrupts → end-of-combat check.
6. **Two-stage death.** "Life 0" at the moment of the hit. "Corpse", items, the credited
   kill and the visibility update happen at marker 440 at the end of the death animation.
7. **Interrupts.**
   - The point duel is deterministic, with no randomness.
   - An interrupt is possible only at a tile center and only after the step has been paid for.
   - Winners act from the largest margin to the smallest.
8. **Entering combat from real time.** The best sighting triggers
   (`best sighting`); during it the best observer may get an interrupt. All soldiers
   stop at tile centers.

### 3.6. Randomness

**Streams:**
- **`pre`.** A ring of 256 pregenerated numbers plus an index, both stored in the save.
  A used slot is refilled from `main`, as in Stracciatella. After loading, the next
  ≤256 `PreRandom` rolls repeat. This is a player-visible anti-save-scum mechanic:
  hits, misfires, damage, crits, skills, stat growth, autoresolve, ~40 AI decisions.
- **`main`.** `Random` and `Chance`: enemy generation and their gear, Queen timers,
  shop inventories, etc. As in the original, on load it is **reseeded from entropy**.
  In test and replay mode the seed is fixed.
- **`fx`.** Face blinking, idle animations, ambient, AIM static. In the original they consume
  the *shared* generator on wall-clock time. This is a source of nondeterminism, and we remove it
  deliberately. The simulation's cosmetic streams (talk, helicopter, autoresolve) are seeded from the session seed
  and saved (`27` §1.4).

**The algorithm** is our own: xoshiro128** seeded via splitmix32 (chosen in M0: 32-bit operations only,
no BigInt). Mapping to a range is done by multiplication, one generator call per roll. Bit-exact matching with `mt19937` and
`uniform_int_distribution` isn't needed; we compare formulas, not number streams. We preserve the
semantics: `Random(n)` gives a uniform `[0, n)`, `Random(0) = 0`, `PreChance(x)` is
`PreRandom(100) < x`.

**Rules take rolls as parameters where possible,** e.g. `resolveShot(cth, roll)`.
Then they are pure and can be checked against traces without a generator.

### 3.7. Core modules and dependency graph

Split according to the mechanics catalog (§a). Arrows point only downward; the original's cycles
(Tactical↔Strategic↔TileEngine) are broken by domain events.

```
sim/flow                 strategic↔tactical transitions, PBI, autoresolve, meanwhile, victory, sector loading
sim/campaign             personnel (profiles, morale, relationships, contracts, departures), laptop (AIM, MERC,
                         insurance, Bobby Ray, IMP, finances, email, history), campaign progress
sim/strategic/economy    loyalty, mines, militia, assignments (doctor, repair, training, rest), merchants, Pablo
sim/strategic/forces     groups, Queen, garrisons and patrols, encounters and ambushes, autoresolve, creatures,
                         bloodcats, handing reinforcements over to tactical
sim/strategic/map        sectors, travel time, A*, airspace and SAMs, control; clock and event queue
sim/narrative            facts, quests, NPC records and actions, schedules (effects go through the event bus)
sim/tactical/ai          alert ladder, decision trees, attack, cover, fleeing (reads Queries, emits Command)
sim/tactical/turns       turn loop, RT↔TB, interrupts, entering and leaving combat, timeline executor, barrier
sim/tactical/combat      hit chance, shot resolution, damage, armor, crits, explosions, wounds, bleeding, suppression
sim/tactical/actions     AP pool and costs, breath, pathfinding, doors, locks, traps, climbing, vehicles
sim/tactical/perception  LOS ray, sight range, noise and hearing, OppList, watched points
sim/tactical/world       grid, terrain costs, structures (from JSD), light and time of day, smoke and gas
sim/rules                PURE world-free formulas: effective stats, fatigue, skill checks, stat growth,
                         morale; items (weight, attachments, condition, reloading, price)
core                     rng (pre + main, serializable) · clock · events · int · ids · config (options, gamepolicy, saipolicy)
```

Tactics is split into submodules following the mechanics catalog (`02`, §a).

**Why animation markers stay in the simulation.** The alternative is to deduct AP and
apply effects immediately "on command confirmation", treating the animation as mere
visualization. We reject it. Between the order and the marker, a gameplay event can happen
in the original:
- an interrupt;
- an NPC throw canceled before release, without AP being deducted;
- map "blindness" during a roof climb.

Timelines in the simulation preserve this ordering while remaining pure data.

**Decoupling example.** The `SoldierKilled` event is consumed by morale, loyalty, campaign progress,
militia points and quest facts. Tactics no longer calls strategy directly.

Autoresolve reuses the damage functions from `rules`, just as the original reuses
`BulletImpact`.

### 3.8. Decision prompts and speech (D15)

**Where the original waits for the player,** the simulation raises a decision prompt:
`state.prompts: Prompt[]`, where each prompt has an `id`, a kind and answer options.
- Kinds: an interrupt in the player's favor, a choice in an NPC dialogue, a message box, PBI (fight, autoresolve,
  retreat), contract extension, picking an item from a pile, a story encounter.
- Time stands still until an answer arrives via the `answer` command.
- Purely informational boxes can be closed automatically per client policy.
- In headless tests, the scenario driver answers.

**Where the original waits for speech,** the simulation doesn't depend on audio:
- A line's duration in the simulation is always 60 ms per character. That's how the original computes it
  when speech is off (`FindDelayForString`, `TEXT_DELAY_MODIFIER`).
- "Speech channel busy until tick T" is a state field. It is checked at the places where the original waits for
  an empty quote queue (`04`, §3).
- The client plays the sound however long it lasts.

**Bottom line:** the simulation contains not a single `await` and not a single timer call, and it never waits for
the client.

**Move logic out of screens into commands.** Hiring on the laptop, trading, drag-and-drop inventory,
map assignments, repair and healing must not live in the UI: the agent wouldn't see them. The UI only
collects command parameters and shows the result.

---

## 4. Content and data (`content`)

### 4.1. Model and schemas

- **Schemas are JSON Schema (YAML).**
  - Stracciatella's 52 schemas (`rust/stracciatella/src/schemas/yaml`) are reused as is.
  - For what isn't there, we write our own: profiles, timelines, tilesets, structures, maps,
    NPC scripts, UI layouts.
  - TS types are generated from the schemas (json-schema-to-typescript), validation is done with Ajv:
    in dev mode and in tools, optionally in the release build.
- **Logic content and media content are different things.**

  | | Logic content | Media content |
  |---|---|---|
  | What's included | Items, weapons, profiles, timelines, structure database, maps, NPC scripts, policies, strategic map | Sprites, fonts, sounds, music, video |
  | Size | Small | The bulk |
  | Needed by the simulation | Yes | No |
  | When loaded | In full, before the game starts | Lazily: when a sector or screen loads |

- **Tables from the source code are transcribed to JSON and distributed** (the SFI-SCLA license
  allows this): `gAnimControl`, AP and hit-chance constants, attachment and
  merge tables, the morale table, the loyalty mood table, the "light → sight range" table,
  body states and animation surfaces.
- **Data from the original's binary files is only imported** on the user's machine and is not
  distributed: `prof.dat`, `ja2bin.dat`, maps, JSD, `.npc`, EDT, `Locks.bin`, `ja2pal.dat`.

### 4.2. VFS and sources

Layers by priority, top to bottom:

1. mods and user overrides (later);
2. our JSON: `data/` (externalized from Stracciatella plus transcribed tables);
3. the user's original data: `Data/*.slf` and loose files;
4. the stub pack.

Paths are normalized as in Stracciatella: case doesn't matter, `\` becomes `/`.

**Backends:**
- Node `fs` — the main one. Used by the server, tools and tests;
- HTTP — the browser fetches media from our server at `/vfs/<path>`, with range requests; as built in M8 (U0b) the
  browser's `HttpVfsLayer` (`src/app/assets/`) builds the same `Vfs` from the server's asset manifest and fetches
  content-hash URLs `/vfs/@<hash>/<path>` that the HTTP cache keeps (`04` §5.10);
- OPFS and `File` — only for embedded mode without a server (`04`, §5.7), later.

**The SLF index** is built as `Map<path, {source, offset, length}>`. Range reads are
lazy (`Blob.slice` or a sync access handle in a worker); archives are never loaded whole.

**The rule pack** (as built in M8, U0b; `28` §1.3, §17.4). The simulation does not read the VFS directly: the server
builds a **rule pack** from it at start, every file the simulation reads (the rule families: project tables, the rule
binaries, maps, structure files, NPC records, text files) plus the few numbers it takes from graphics (tileset frame
geometry and app data, explosion frame counts) as derived *graphic facts*, and loads every session's content from it;
the pack refuses any other path, so no graphic is read by the rules. It is cached in `.ja2/cache/rules-<hash>/`, its
hash (over the inputs of the game data: the user's data on the original data, the stub pack on the stubs, never the
tables that ship with the engine; U0c, `27` §1.7) is the logic hash that saves are bound to, and `welcome` names it,
so a client building the same
rule content from its own asset source (for the hints, `28` §2.4) can check it has the server's rules. The
`ja2bin.dat` scripts are split at load into a logic timeline (the simulation) and a presentation timeline (sprite
frames and sounds, the views and clients). Media stays outside the pack. The pack is never committed: it is built
from the user's data.

### 4.3. Importing the original

**Decoders** work on `ArrayBuffer` and `DataView`, without DOM, and therefore run
identically in Node and in the browser.

| Format | What it becomes |
|---|---|
| SLF | VFS index |
| STI (8-bit ETRLE / 16-bit 565) | `SpriteSheet`: frames {w, h, offX, offY, indices}, palette, aux data |
| PCX | `SpriteSheet` |
| Map `.dat` (versions 5.00–6.00/26) | `MapDef` |
| `JA2SET.DAT` + TileDat (table from the code) | `TilesetDef` |
| JSD | `StructureDef` (5×5 profiles, armor, density, destruction partners) |
| `prof.dat` (XOR) | `MercProfile[]` |
| `ja2bin.dat` + `gAnimControl` | Timelines |
| `ja2pal.dat` | Body palettes |
| `.npc` | NPC records (supplement `script-records-NPCs.json`) |
| EDT | Strings |
| `Locks.bin` | Locks |
| WAV (PCM and probably IMA-ADPCM; to be checked on the data) | Audio buffers |
| SMK | Video (later) |

**The server reads the original data** from `JA2_DATA_DIR`. It imports the logic content itself,
and serves media to the browser via `/vfs`. The decoders are the same: STI is decoded in the browser, since
WebGL needs color indices.

**Embedded mode without a server** (later, optional): the player points to the `Data` folder once.
- In Chromium, via `showDirectoryPicker`.
- Everywhere, via `<input webkitdirectory>` or drag-and-drop.
- The files are copied to OPFS, after which `navigator.storage.persist()` is called.
- Speech and music (~590 MB) can be left uncopied; the game works without them.

### 4.4. Stubs

**Logic:** profiles, timelines for one body, a structure database by category, maps.
- Written by hand in JSON; this is the hardest part of the pack.
- Created **independently**: no numbers or data copied from the original's binaries.

**Media:** generated by a Node script directly into our model.
- Isometric tiles by category (151 types).
- A "capsule" soldier in 8 directions.
- Labeled UI rectangles according to the layouts.
- A rasterized free pixel font: a subset of Terminus Font (SIL OFL 1.1, renamed "Stub Pixel" for its Reserved
  Font Name) compiled into STI fonts under the original font names, with a stub glyph table (`docs/27` §6.6).
- Sounds, music and speech blips: synthesized from noise and tone envelopes with a seeded generator, one
  file per cue class, named like the original paths through an alias manifest (`docs/27` §6.5).

Stored as PNG plus JSON so they can be edited in any editor, sounds as WAV and text as EDT; the fonts are the one
family written as STI, because the font loader reads nothing else.

**Stub maps** are described in a simple text format (an ASCII grid plus a legend) and
converted to `MapDef`. The same files serve as test fixtures. A handful of generic maps stand in for every sector by
kind (town, mine, cave, army camp, airfield; `stubs/maps/sector-kinds.json`), each listed sector an alias of its kind's
map; an exit grid may lead to the sector the map is loaded for (`docs/27` §6.6).

**Done criterion for each milestone:** the functionality also runs on stubs,
and in CI only on them.

---

## 5. Presentation

### 5.1. Rendering: our own layer on WebGL2

**Why not an off-the-shelf one:**
- Canvas2D can't do palette lookup and shading cheaply.
- Pixi and Phaser don't provide the needed depth and palette model without fighting the framework.
- WebGPU isn't needed: WebGL2 is everywhere, and the render interface will allow swapping the backend later.

**Design:**
- **Textures.** Color indices live in R8 atlases (2048² pages). Palettes live in an
  RGBA texture, one row for each combination of sprite palette, soldier palette (skin,
  hair, vest, pants), shade level (16) and light color. The shader takes the index, uses it to look up the color
  in the right row, and discards index 0.
- **Draw order.** Each quad's depth is computed using the original's z-level formula:
  coordinates, layer, height. Multi-tile structures with `ZStripInfo` are cut into
  vertical strips by tile columns, each strip with its own depth. This yields the
  original "soldier behind a wall" without a software z-buffer.
- **Map layers:** ground, objects, structures, shadows (multiply), soldiers, roofs (hidden
  when a merc is inside), roof objects, top layer. Translucency is alpha 0.5,
  like the 565 mask in the original.
- **Light.** The shade level per tile comes from the ambient light and light sources and selects the
  palette row. Lighting in the simulation and the image are computed from the same data.
- **Screen.** The tactical view works at any resolution. Fixed screens (menus,
  laptop, strategic map) are a logical 640×480 with integer scaling.
- **Performance target:** 60 FPS at 1920×1080. Every frame is redrawn in full;
  dirty rectangles aren't needed.

### 5.2. UI

- **Our own canvas widget set.**
  - Buttons, mouse regions with priorities (the original's `MouseSystem` semantics), lists,
    sliders, text fields, popups.
  - Text uses the original's bitmap fonts or stubs, with line wrapping.
- **Screen layouts are stored as data** (JSON): positions, sprite frames, button
  states. Coordinates are carried over from source-code constants. The skin is original art or
  stubs.
- **Screens:** main menu, options, new game, laptop (AIM, MERC, IMP, Bobby Ray, email,
  finances, history, personnel, files, insurance, flowers), strategic map, PBI and autoresolve,
  tactical (HUD, panels, inventory, crates), trading, dialogue, save and load, message
  boxes.
- **DOM** is used only for the launcher (folder selection, out-of-game settings) and
  dev tools. Preact would suit them, but it's optional.

### 5.3. Sound and video

- **Sound:** Web Audio API directly.
  - Buses: effects, speech, music, ambient, master.
  - Stereo panning by screen X, like `MIDDLEPAN` in the original.
  - The sample rate is determined by the device context (a pitfall ja2-web ran into).
  - Audio is unlocked on the first user gesture.
  - Music switches by mode according to `music.json`.
  - Landed in M7 (`27` §3.6–§3.7): the client derives every sound from events, frames and animation codes; the server
    computes the music mode.
- **Video** (intro and ending in Smacker format), landed in M7 (`27` §4.5).
  - We write the decoder from the format specification.
  - We don't port libsmacker's code: it's LGPL, which is incompatible with SFI-SCLA.
  - Cutscenes are skippable.

---

## 6. Platform: server (`server`, `agent`) and client (`app`)

### 6.1. Server

- **One Node process.** Sessions, time drivers, HTTP (`/vfs`, REST), WebSocket for the
  browser, MCP for agents.
- **The real-time driver** runs ticks in batches roughly every 16 ms based on accumulated
  time × k and broadcasts events to subscribers. It pauses on its own at decision prompts.
- **Saves** are files on the server. A command log with ticks is kept alongside them and gives an exact
  replay of the playthrough.
- **Listens on `127.0.0.1`,** with token access. Only game commands are accepted from clients.
- **A heavy session** can be moved into `worker_threads`: the protocol is already message-based. As built (M7):
  `JA2_SESSION_HOST=worker` runs every session in its own worker; the default in-process host slices advances
  (`04` §5.9).

### 6.2. Agents

- **MCP adapter** (`agent`) on top of the same protocol. Tools: `status`, `observe`,
  `query`, `act`, `answer`, `advance`, `save`/`load` (`04`, §6). As built (M7) the adapter is `src/server/mcp.ts`
  with `status`, `observe`, `act`, `advance`, `newSession`, `save`, `load`, `listSaves` and `deleteSave`; queries
  and prompt answers are `act` commands (`04` §6.2).
- **Observation** is built from `PlayerView`: structured JSON, an ASCII map fragment with a
  legend, deltas since the previous call. As built `observe` returns the JSON view with labels in the session's
  language; there is no ASCII fragment, and events arrive with `advance`.
- **Connecting Claude Code:** `claude mcp add` pointing at the local server.

### 6.3. Client (browser)

- **Main loop.** `requestAnimationFrame`: input → commands and queries to the server →
  the event-log player advances playback time → event processing (sound, effects) → render.
  - Playback lags behind the simulation by a 50–100 ms buffer in real time and catches up with it at the
    chosen speed in turn-based combat.
  - When the tab is hidden, the client asks the server to pause. Agent sessions don't depend
    on the tab.
- **Input.** Pointer and keyboard events → widget hit-test → if the world was hit,
  tile picking (inverse isometry accounting for level and roofs) or soldier picking → command.
  The original's hotkeys are defined by a table in the data.
- **Saves.**
  - Our own format: a `GameState` snapshot → JSON with typed arrays in base64 → gzip.
  - Stored on the server; from the browser they can be downloaded to a file and uploaded back.
  - Each save has a version and a migration chain.
  - Save restrictions as in the original: Iron Man, "not during an action".
- **Browsers:** current desktop Chrome, Firefox and Safari. Touch input is not a
  priority.

---

## 7. Technologies

| Area | Choice (version as of 2026-10) | Why | Rejected |
|---|---|---|---|
| Language | **TypeScript 7.0** (native compiler), `strict`, `noUncheckedIndexedAccess` | 2000+ places with narrow integers and 400 fields on a soldier: impossible to keep in check without types | Plain JS |
| Dev server and client build | **Vite 8** | Fast HMR; proxying `/vfs`, `/api`, `/ws` to the game server; workers out of the box | webpack |
| Game server | **Node 24** + **Hono 4** (`@hono/node-server` 2) for HTTP, **ws 8** for WebSocket | Small, typed, no magic; Hono works the same in Node and in tests | Fastify (more than needed), Socket.IO (we don't need its own protocol on top of WS) |
| Agent API | **MCP**, `@modelcontextprotocol/sdk` 1.32 (stdio and streamable HTTP) | Claude Code and other agents connect with no code on their side | A custom REST API without MCP (kept for scripts) |
| Running TS in Node | Native type stripping in Node 24 (verified on v24.22: `node file.ts` works, `enum` doesn't). Hence `erasableSyntaxOnly`: `as const` objects and type unions instead of `enum` | The server and tools run without a build step or a bundler | ts-node, tsx |
| Tests | **Vitest 5** (unit, headless scenarios in Node), **Playwright 1.64** (e2e and screenshots on stubs) | One language and one config shared with Vite | Jest |
| Lint and format | **Biome 2.5** | One fast tool | ESLint + Prettier |
| Layer boundaries | TS project references (`lib` without DOM in the lower layers) + our own import check `tools/check-imports.ts` | An architecture violation breaks the build | dependency-cruiser 18 (doesn't support TypeScript 7), verbal conventions |
| Data schemas | JSON Schema (YAML) + **Ajv 8** + **json-schema-to-typescript 16** | We reuse 52 ready-made Stracciatella schemas | zod/valibot: they don't read existing JSON Schema |
| Rendering | **Custom WebGL2** | §5.1 | Pixi 8, Phaser, Canvas2D, WebGPU |
| Sound | **Web Audio API** | Full control over buses and panning is needed | Howler (not developed since 2023) |
| Storage | Files on the server (saves, logs); in the browser only playback settings (localStorage); OPFS for embedded mode later | State lives on the server | IndexedDB for saves |
| Compression | `node:zlib` on the server, `CompressionStream` in the browser; **fflate 0.8** if synchronous compression is needed | | |
| Node | **24 LTS** (already installed) | Server, tools, tests, headless | |
| Packages | **pnpm 11**, one package | Strict dependencies, fast installs | npm; pnpm workspaces (overkill for now) |
| Not used | Game engines, ECS libraries, UI frameworks in the game | 148 soldiers and a 160×160 grid don't call for ECS; rules read better on plain objects | bitECS, React |

---

## 8. Verifying "as in the original"

| Level | What | Where it runs |
|---|---|---|
| 1. Formulas | Unit tests of pure rules from `sim/rules` with reference values from traces | CI |
| 2. Formats | Decoders on stub fixtures; on original data, locally (the test is skipped if `JA2_DATA_DIR` isn't set) | CI + locally |
| 3. Scenarios | Headless: map, squads, seed, commands → assertions and event log snapshots. Statistics: N runs → hit and damage distributions | CI |
| 4. Saves | Round-trip and migrations | CI |
| 5. E2E | Playwright on stubs: launch → menu → new game → tactical, screenshot comparison | CI |
| 6. **Oracle** | Comparison with native Stracciatella on original data | Locally |

**How the oracle works:**
- **Rule tracing.**
  - A set of patches to Stracciatella (`tools/oracle/patches/`) adds a
    `TRACE_RULE(name, inputs, output)` macro (planned). It writes JSONL if `JA2_TRACE` is set.
  - Trace points: `CalcActionPoints`, AP costs, `CalcChanceToHitGun`, the hit
    roll, `BulletImpact`, armor, crits, `MovementNoise`, `DistanceVisible`,
    `CalcInterruptDuelPts`, suppression, stat growth, autoresolve rolls, travel time, prices,
    `DecideAction` decisions, etc.
  - You play as usual, and the traces accumulate. `npm run oracle` runs their inputs through our
    functions and compares the outputs.
  - As a bonus, this documents the inputs of every rule.
- **Save import** (`.sav` → `GameState`). You save in the native game at an interesting
  moment, load it in ours and compare derived values: hit chance, path
  cost, visibility, AI decision. Later this also becomes a feature for players: "continue your
  campaign in the browser".
  The reader, the format and the import of the loaded sector into a tactical session are in `docs/14-savegames.md`.
- **Probe mode** (exists, `tools/oracle/README.md`). With `JA2_ORACLE=<script>` the patched build
  starts headless, loads a sector map or a save, runs scripted probes (`FindBestPath`, `LineOfSightTest`,
  `SoldierToSoldierLineOfSightTest`, the `gubWorldMovementCosts` dump) and prints JSONL.
- **The native Stracciatella build** (CMake + Rust) is done outside the repository by the
  `tools/oracle/build.sh` script.

**Deliberate deviations** from the original (the list is kept in `docs/deviations.md`):
- dependencies on FPS and CPU speed are replaced with deterministic constants: bullet speed
  in ticks per tile, burst tempo, the real-time AI slice;
- a line's duration in the simulation is always 60 ms per character, even if the sound is longer or shorter;
- the 15 s and 25 s watchdog timers are not carried over: a hang is a bug;
- in real time, orders can be given while paused (in the original, pause blocks input);
- cosmetics are moved to a separate randomness stream;
- bugs are fixed the same way as in Stracciatella.

---

## 9. Repository structure

```
ja2-node/
  package.json  pnpm-workspace.yaml  tsconfig.json  tsconfig.base.json  biome.json
  vite.config.ts  vitest.config.ts  playwright.config.ts  .github/workflows/ci.yml
  src/
    env/         universal.d.ts: globals shared by the browser and Node (TextEncoder/TextDecoder)
    core/        rng.ts clock.ts events.ts int.ts math.ts ids.ts                (no DOM, no Node)
    content/     model/ (types, partly generated) schemas/ vfs/ formats/ import/ timelines/   (no DOM, no Node)
    node/        VFS on top of the disk (directories, SLF), data stack, token   (Node)
    sim/         model/ world/ rules/ tactical/ ai/ strategic/ campaign/ narrative/ flow/ view/ api.ts   (no DOM, no Node)
    protocol/    commands.ts events.ts view.ts messages.ts                      (no DOM, no Node)
    server/      main.ts sessions/ drivers/ transport/ (http, ws) persistence/ vfs-http.ts   (Node)
    agent/       mcp.ts observe/ (JSON, ASCII, deltas)                          (Node)
    render/      gl/ atlas/ palette/ tactical/ ui-draw/                         (browser)
    audio/                                                                      (browser)
    ui/          draw-list.ts screen.ts resolution.ts input/ text/ screens/     (no DOM, no Node)
    app/         game/ net/ world/ sound/ media/ launcher/ video/ credits/      (browser)
    devtools/    asset-browser/ state-inspector/ timeline-debugger/             (browser)
  data/          JSON that we distribute: externalized (from Stracciatella) + transcribed tables
  stubs/         stub pack sources: authored JSON, generators; build → dist/stubs
  tools/         Node CLI: inspect, stubs, sim, oracle, save-import; spikes/ (exploratory scripts)
    oracle/      Stracciatella patches, harness, build.sh, run.sh, probe scripts
  tests/         scenarios/ fixtures/
  docs/
  reference/     (gitignored)
```

**File header** for code ported from the original's logic (required by clause 4 of SFI-SCLA):

```ts
// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, <date>. See LICENSE (SFI-SCLA).
// @src Tactical/Weapons.cc CalcChanceToHitGun
```

Apart from this header there are no comments in code: it has to read without them (see `CLAUDE.md`).

---

## 10. Milestones

Every milestone works on the original data, works on stubs and has tests.
**The sandbox** is a dev mode: "load sector X with squad Y and enemies Z". It lets us
build tactics without strategy and the laptop.

| Milestone | Contents | Result | Complexity |
|---|---|---|---|
| **M0 Foundation** | Repository and tools; `core` (RNG, integer helpers); VFS + SLF + STI + palettes; server v0 (`/vfs` on top of `JA2_DATA_DIR` or stubs, token); WebGL2 sprite rendering; asset browser; stub generator v0; CI | We can view any sprite from the original and the stubs in the browser, with the data served by our server | S |
| **M1 World** | Import of `.dat` maps and tilesets, JSD → structure database; tactical rendering (layers, strip-based depth, light, roofs); camera, scrolling, picking, radar; stub map format | Omerta on screen, scrolling, tile highlighting | M–L |
| **M2 Soldier and time** | Tick loop, `advance`, drivers; timelines (TS extractor `ja2bin` + `gAnimControl` → JSON, exploratory work already exists in `tools/spikes`); profiles, bodies, palettes; pathfinding; step protocol; stances; real time; sight (LOS, OppList), noise and hearing; green-state AI (patrols). **Protocol v0, sessions, `PlayerView` projection; agent API v0** (MCP: `status`, `observe`, `act move`, `advance`); the browser plays back the log | Sandbox: mercs walk around Omerta, enemies patrol. An agent leads a squad via MCP, and the browser shows it | L |
| **M3 Combat** | Turn-based mode, AP, interrupts; attacks (fire, burst, melee, throws, grenade launchers); bullets, damage, armor, wounds, death; explosions and smoke; inventory and items; morale and suppression; barrier; the entire tactical AI; entering and leaving combat. Decision prompts (an interrupt in the player's favor). Instant driver and accelerated playback; measuring the cost of an enemy turn. **Oracle:** tracing patches + save import | The battle for Omerta on the original; a firefight on stubs; an agent fights a battle through the API | XL |
| **M4 Strategy** | Strategic map, clock, event queue, squads and routes, Queen, militia, loyalty, mines, assignments, PBI and autoresolve, sector transitions and persisting sector state | You can wage war across the country map | XL |
| **M5 Campaign** | The full laptop, contracts and relationships, merchants; a new game from the start | A full campaign start as in the original | L |
| **M6 Narrative** | NPC records and actions, dialogue, quests and facts, schedules, meanwhile, ending | The campaign can be completed | L |
| **M7 Polish** | Saves in the UX, options, full sound and music, video, Russian localization (Stracciatella strings already exist in 8 languages), stub completeness, performance; a DOM launcher instead of game screens (`27`) | Platform release: a full campaign by an agent or in the devtools pages, on the original data and on stubs. *Done 2026-10-18 as 0.7.0 (§12, `releases.md`)* | M–L |
| **M8 Player UI** | The D10 canvas widget set, layouts and bitmap fonts; the original screens (menus, options, save/load, tactical HUD and inventory, map screen, PBI, talk, shop, laptop), hotkeys, meanwhile playback (`27` §8); spec `28` (slices U0–U15) | Release for human players (0.8.0) | XL |

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Behavior silently "drifts" away from the original | The oracle already in M3; mechanics catalog with an "exact / approximate" flag; deviation log |
| `ja2bin` opcode semantics are more complex than they seem | Timeline extractor and debugger at the very start of M2; the marker executor is a separate module with tests |
| UI volume: laptop, strategic map, tactical HUD — about a third of the source | Layouts as data, a shared widget set, screens as needed (the sandbox bypasses the laptop). Since M7 isolated in its own milestone, M8, on top of a complete API (`27` §8) |
| Logic stubs (timelines, profiles, maps) are game design | Minimal set: one body, ~40 states, 3–5 profiles, 1–2 maps. The rest gradually. As of M7: invented scripts for all 311 states, 44 profiles, 14 maps behind 95 sector aliases by kind, only what the tests and the stub campaign need (`27` §6) |
| AI and LOS performance with many soldiers | Profile in M3; visibility cache; moving the simulation to a worker. M7 measured it (`pnpm cli bench`), met the enemy-turn targets with derived caches and slices sessions or runs them in workers; no visibility cache was needed (`27` §7) |
| The original's logic lives in screens (laptop, trading, inventory, map) and is hard to lift into commands | The command catalog is maintained alongside the mechanics catalog; rule D15 is verified by the agent being able to do everything the UI can |
| Playback diverges from the simulation (the client reconstructs frames itself) | Client and server take timelines from the same `content` module; periodic snapshots for reconciliation; e2e test "log replay = snapshot". Since M7 the input log of every save replays to a byte-identical snapshot (`pnpm cli replay`), and the scenario tests reload at every input |
| It's hard for an agent to reason about space from text | We design observations on real playthroughs: ASCII with a legend, cover hints, `query` instead of mental arithmetic. As built through M7: the JSON view and query commands (`estimateAttack`, `inventory`, `quoteTrade`, …); no ASCII map yet |
| Nondeterminism leaks into the core (Math, `Map` iteration order, global variables) | The rules in §3.2, linter, "two sessions, one log" test, log replays in CI |
| Project scope | Sandbox and vertical slices; each milestone is valuable on its own |

---

## 12. Status

### M0: what's done (2026-10-15)

The milestone is closed. Result: any sprite from the original and the stubs is visible in the browser, with the data served by
our server. How to run it is described in `README.md`.

1. **Repository and tools.** `git init`, pnpm 11, TS 7 with per-layer project references,
   Vite 8, Vitest 5, Playwright 1.64, Biome 2.5, `LICENSE` (verbatim SFI-SCLA), SFI-SCLA
   headers in the format files. CI (`.github/workflows/ci.yml`) runs only on stubs.
   Repository content is English and code carries no comments besides the SFI-SCLA header
   (`CLAUDE.md`).
2. **`core`.** xoshiro128** with serializable state, the `PreRandom` ring (roll repetition
   after loading is verified by a test), `u8/i8/u16/i16/u32/i32/idiv/imod`.
3. **`content`.**
   - Formats: SLF (read, plus write for fixtures), 8-bit ETRLE and 16-bit RGB565 STI (read and
     write), PNG (indexed, RGB, RGBA).
   - Canonical image model; stub sprite format (PNG + `*.sprite.json`).
   - Layered VFS.
   - **Verified on the user's data:** all 7,523 STI files from 22 SLFs decode in 1.1 s,
     no ETRLE anomalies.
4. **`node`.** VFS layers on top of a directory and SLF. Stack: loose Data files → SLFs in alphabetical order →
   stubs under `stubs/`. `JA2_DATA_DIR` can point to Data or to the game root.
5. **`server` v0.**
   - Hono on `127.0.0.1`: `/api/health`, `/api/vfs`, `/vfs/<path>` with range requests.
   - Token (`.ja2/token`, 0600) and a Host check against DNS rebinding.
   - Vite proxies the requests and injects the token.
6. **`render`.** R8UI and RGBA8 atlases with shelf packing, a palette texture, instanced
   drawing (index 0 is discarded in the shader).
7. **`devtools/asset-browser`.**
   - VFS tree and filter.
   - Frame grid (animations aligned by anchor point) or animation by direction groups.
   - Palette, frame aux data, text and hex for other files; state in the URL `#hash`.
8. **Stubs v0** (`pnpm stubs`): a capsule soldier (8 directions × 4 frames), ground
   (6 types × 2), walls, a button. The build is deterministic.
9. **CLI:** `pnpm cli inspect vfs | ls | slf | sti --png | cat | verify`.

**Carried over from M0** and closed in M1: PCX and TGA decoders, body palettes from `ja2pal.dat`,
`/vfs` ETags, serving the built client (`/login?token=…` sets an HttpOnly cookie).

### M1: what's done (2026-10-15)

1. **Formats.** Tileset database (`ja2set.dat`), JSD structure files, map `.dat` reader and writer
   for every section, PCX, TGA, soldier palettes. `pnpm cli inspect verify` parses every original
   file: 7,523 STI, 78 PCX, 3 TGA, 1,442 JSD, 261 maps. 178 maps carry trailing bytes that the
   original loader ignores (`docs/deviations.md`).
2. **Tables.** `data/tables/tiles.json` is transcribed from `TileDat.h/.cc` by
   `tools/transcribe/tiles.ts`. The repo `data/` directory is the top VFS layer.
3. **World model** (`content/world`). Tile database with the original flags, shadow buddies, door
   animations and underflow fillers; ZStripInfo; level building with the original layer list
   order; tileset loading from STI or stub sprites; shade palettes that match all 305 vanilla
   `.sha` tables exactly for shades 1–15.
4. **Renderer** (`render/world`), following `docs/05-render-pipeline.md`: sweep by `X+Y` rows,
   passes land → objects → shadows (day only) → structs/roofs/on-roof per row → dynamic layers;
   original z per layer, 20 px strips for multi-tile structures, strict and non-strict depth tests,
   shadows as ×0.48 darkening, buddy shadows and the tree shadow cleanup, map height offsets.
5. **Map viewer** (`devtools/map-viewer`): original maps and the stub village, camera drag and
   keys, zoom, tile picking with the original inverse projection, hover info, roofs and shadows
   toggles, day/dusk/night shading, radar with the viewport rectangle.
6. **Stub world:** stub tileset sprites, a stub `ja2set.dat` and an ASCII map format
   (`stubs/maps/*.map.txt`) compiled into real `.dat` files, so stubs take the same loading path.

**Not in M1 yet** (each needs systems from later milestones):
- map light sprites and their ray casting (needs structure blocking; M2 with vision);
- room reveal, hidden roofs and the obscured (show-through) pass (needs FOV; M2);
- load-time wall wireframes (with room reveal);
- structure placement collisions on load (`FailedToAddNode` skips a few overlapping structs; M2
  with the structure database);
- scroll limits and restricted-scroll maps.

### M2: what's done (2026-10-15)

Result: in the sandbox (A9 on the original data, the stub village otherwise) mercs walk and run where they
are sent, the A9 garrison and the civilians behave as in green alert, everyone sees and hears everyone, and a
hostile sighting stops the sector at the combat boundary. An agent drives the squad through MCP, and the
tactical page plays the session back. The specs behind it are `docs/06`–`09`.

1. **World for the simulation** (`content/world`): structure instances per tile with the original collision
   rules (the struct nodes they reject are dropped for the renderer too), terrain ids, the movement-cost table
   compiled with SET/FORCE semantics including fences, sandbags, walls and the door tables transcribed into
   `data/tables/door-costs.json`, local recompiles, the visible-tile diamond.
2. **Pathfinding** (`sim/tactical/pathfinding.ts`): a port of `FindBestPath` with the original open-list order,
   direction order, stale-node and origin quirks, pool and trail limits, 30-step routes, doors, people,
   distance and AP-budget modes and the reachability flood used by sweet-spot searches.
3. **Soldiers and animation**: creation from profiles and placements (body, stats, palettes, priority
   placements), `EVENT_InitNewSoldierAnim` with stance chaining, frame timers in game ms, the opcodes that
   matter for movement (pauses, fence hop moves, door opening, end of animation), turning one octant per
   frame with the fast-turn rule.
4. **Walking protocol**: first step, float32 `MoveMerc` with glibc sin/cos, half-step occupancy, tile
   reservations, waiting and re-pathing around people, path exhaustion every 30 steps, fence hops, AI door
   opening and closing behind, breath spending, stops.
5. **Green-alert AI**: the real-time AI cadence, `HandleSoldierAI`, `RTHandleAI`, `ExecuteAction`, the whole
   `DecideActionGreen`, alert status, delays.
6. **Sight and hearing**: `LineOfSightTest`, `DistanceVisible`, the opplist state machine with radio and
   `bVisible`, decay on the 5 s real-time turn, footsteps and door creaks, hearing feeding the AI.
7. **Server, protocol and agents**: the sandbox session, view frames with open doors and the combat flag,
   MCP tools `status`, `observe`, `act` (`move`, `stop`, `endCombat`), `advance`.
8. **Client**: soldier sheets chosen by the original surface rules, per-soldier palettes from `ja2pal.dat`,
   the merc pass in the scene (z, shadows, checkerboard behind structures), the tactical page.
9. **Stubs**: stub animation scripts, soldier sheets, `ja2pal.dat`, wall and barrel structures, door scripts.

**Not in M2** (see `docs/deviations.md`): turn-based combat after `combatWouldStart` (M3), `DecideActionYellow` (M3),
light sprites and gear for vision, FOV roof reveal and wireframes, breath recovery, door busy windows, enemy
glow, equipment generation, prone/multi-tile soldiers.

### M3: what's done (2026-10-15)

The milestone is closed. Result: battles in A9 on the original data and in the stub village, an agent fighting through
MCP alone, native savegames continued in a session and checked against the native build. Known gaps are listed in
`docs/deviations.md`.

Specs: `docs/10` (turn-based), `11` (attacks and damage), `12` (items and explosions), `13` (combat AI).

1. **Items**: the unified item table, objects with attachments and merges, soldier inventories from profiles,
   placements and `GenerateRandomEquipment`, reload and auto-place.
2. **Points**: AP and breath tables, `DeductPoints`, turn and stance costs charged by animation entries.
3. **Turn-based core**: team-blocked soldier ids and merc slots, team turns, interrupts and duels, the
   turn-based AI loop, `endTurn`, entering and leaving combat, end of battle.
4. **Gun attacks** (`sim/tactical/combat`): `HandleItem` gun path, ready and turn rules (prone turning
   included), fire animations and their opcodes, jams, `UseGun` with the hit roll and marksmanship
   experience, bullets one tile per tick with structure, person, window and suppression rules and the
   fake bullet for chance to get through, `BulletImpact` with armour and criticals, `EVENT_SoldierGotHit`,
   `SoldierTakeDamage`, hit animations, falls, incapacitation and death with corpse and item drop, the attack
   busy barrier with suppression and `NoticeUnseenAttacker`, `StatChange` with profile progress, morale events
   from attacks. Soldiers occupy the world as person structures loaded from `anims/structdata/*.jsd` (stubs
   ship their own shapes). Commands `attack` and `estimateAttack`.
5. **Combat AI** (`sim/tactical/ai`): `DecideActionYellow`/`Red`/`Black`, `CalcBestShot` and `CanNPCAttack`
   (reload, drawing pocketed weapons), shooting and plain stance changes, `CalcMorale`, `RangeChangeDesire`,
   `FindBestNearbyCover` with the AP-budget flood, flee spots, noise memory with the LOS forget test, radio
   alerts, cowering civilians, `NewDest` movement modes and `ExecuteAction` for every gun-related action.

6. **Melee and bursts**: knife and punch (`combat/melee.ts`), the 20 ms delayed hit, dodge, AI stabs and spread bursts.
7. **Throws and explosions** (`sim/tactical/explosions/`): float32 throw physics, launchers, explosion timing,
   `SpreadEffect`/`ExpAffect`, blast damage with armour, structure damage with partners, item damage and chains,
   smoke/tear/mustard gas with the gassed state, flares as data; AI throws (`CalcBestThrow`, spotters).
8. **Items in the world**: map items with their `PreRandom` draws, item reveal by sight, `pickUp` (walks there) and
   `drop`, AI `SearchForItems`; corpse structures from the tile cache.
9. **Turn start, roofs**: bleeding and getting up; buildings and climb spots (`GenerateBuildings` with its draws),
   `climb` for the player, MOVE_TO_CLIMB/CLIMB_ROOF for the AI, incapacitated soldiers falling off roof edges; the
   LAW and tank cannon explode where their rocket or shell stops.
10. **Oracle**: `tools/oracle/compare.ts` checks A9 movement costs, paths with AP costs and LOS against the native
    build; all shipped probes match.
11. **Stub firefight**: the stub village holds a three-soldier garrison (`soldier:` lines in `stubs/maps/*.map.txt`),
    stub mercs carry pistols, and MCP `newSession` gives every agent its own seeded sandbox. The e2e test
    `tests/e2e/battle.spec.ts` is an agent that walks into the garrison and fights it through MCP alone.

12. **Save import** (`sim/tactical/save-import.ts`, `docs/14` §10): a native `.sav` becomes a tactical session
    (soldiers, items, corpses, openable structures, doors, opplists, turn state, `PreRandom`); MCP
    `newSession {save}` and `JA2_SAVE` start one. `tools/oracle/save-probes.ts` and `compare.ts` check soldier state,
    hit chances, AI best shots, sight and paths against the native build on the user's six saves: 6,075 comparisons
    match, and with lighting (item 14) also the light dumps: 6,815 comparisons.
13. **Drivers and cost**: the instant driver (`{mode: 'instant'}`) runs every order to idle on the server while the
    tactical page plays the frames back at 1×, 4×, 16× or skips them. An enemy turn costs tens of milliseconds for
    a small garrison and 100–250 ms for 16 soldiers (`04` §4.5).
14. **Lighting** (`sim/tactical/lighting`, `docs/20`): map light sprites with the original templates computed from
    source, ray casting and the true light level read by sight, AI, throws and interrupts; on the six saves and all 112
    original maps with lights the light dumps match the native build. Flares and merc lights stay dark (their
    templates exist only in the original data).

### M4: done (2026-10-16)

Specs: `docs/15` (time and events), `16` (map, groups, travel, sector transitions), `17` (the Queen), `18` (towns and
assignments), `19` (pre-battle interface and autoresolve).

1. **Time** (`sim/strategic/time`): `UpdateClock` with the compression slices on 5 ms ticks, the event queue with its
   posting guard and warp codes, day light and temperature events, the clock and queue imported from native saves.
   Real-time turns run on the 20 ms overhead counter (5020 ms).
2. **Campaign** (`sim/campaign`): `CampaignSim` owns the strategic state and the loaded sector; the roster keeps player
   mercs across loads and implements the merc and crew ports; new games follow `InitNewGame`; hiring and the first
   landing with the six-hour warp; strategic commands (`route`, `cancelRoute`, `assignSquad`, `assign`, `sleep`, `wake`,
   `startMine`) and a strategic player view. Savegame sessions run the whole strategic layer.
3. **Map and travel** (`sim/strategic/map`, `forces`): sectors, control, airspace, `FindStratPath`, travel times,
   groups and squads, arrivals and encounters; the oracle's routes and group dumps match (196,608 routes).
4. **The Queen** (`sim/strategic/ai`): initialisation, evaluation, reinforcements, orders, detection, reactions,
   `CalcDifficultyModifier`, enemy placement plans; 6,085 native draws replayed with matching state dumps.
5. **Towns** (`sim/strategic/economy`): loyalty, mines, SAM sites, finances, militia training and the hourly
   assignment update; matching the oracle's strategic, merc and warp probes.
6. **Autoresolve core** (`sim/strategic/forces/autoresolve`): the Finish-mode battle with a combat context shared with
   tactical; 44 native battles replayed draw for draw.
7. **Sectors** (`sim/campaign/sector-flow.ts`, `sim/tactical/edgepoints.ts`, `init-list.ts`, `insertion.ts`): loading a
   sector from the strategic counts, sector diffs on leaving, edgepoints, walking off map edges and exit grids
   (`enterSector`, `exitSector`); the oracle's edgepoint, exit, init-list and defence probes match.
8. **Battles** (`sim/strategic/forces/pre-battle.ts`, `sim/campaign/battle-flow.ts`): the pre-battle prompt with its
   encounter codes and options, autoresolve from the strategic state as a flow with surrender and bandaging, the
   aftermath (control, loyalty, morale, militia, enemy groups) for autoresolve and tactical battles, retreats; 50 native
   aftermaths and 8 PBI probes match. `advance` on the map takes world-time targets (`docs/15` §6).
9. **Play surface**: `mapScreen`/`tacticalScreen`, `CanEntireMovementGroupMercIsInMove` before `route`, compression
   refused with enemies in the loaded sector; new campaign sessions (MCP `newSession {campaign}`, `POST /api/sessions`),
   and the strategic page (`src/devtools/strategic/`) with the map, mercs, routes, compression and the battle panel.

10. **Morale and creatures**: `HourlyMoraleUpdate` with hated and disliked teammates, creature lairs, attacks on
   towns, bloodcat ambushes and creature placement; exact autoresolve soldier creation (oracle level 2). The oracle's
   morale, creature and creation probes match.

11. **Creatures in tactical** (`sim/tactical/ai/creature-decide.ts`, `smell.ts`, `multi-tile.ts`): creature, bloodcat and
   crow decisions at every alert level, calls, scent tracking, claws, bites and spit with its gas, smell and blood,
   paths for multi-tile bodies; 218 oracle probes match decision for decision.

**Left out of M4**: the placement GUI (mercs enter at the insertion edge), turning of multi-tile bodies while walking,
corpse rot in the loaded sector, a walk-and-strike order in the API (`docs/deviations.md`).

### M5: done (2026-10-16)

Specs: `docs/21` (laptop and hiring), `22` (contracts and relationships), `23` (merchants).

1. **Merchants** (`sim/strategic/economy/merchants`, `sim/campaign/shop-flow.ts`): the 19 dealers from
   `data/externalized`, initial stock, the 09:00 daily update, prices, buying, selling, gifts, repairs with their
   times, the dealer's death; the shop as a modal session (`openShop`, `quoteTrade`, `trade`, `closeShop`); dealer
   state imported from native saves. 202 oracle probes match.
2. **Contracts and relationships** (`sim/campaign/contracts`, `relations`, `profiles.ts`): mutable campaign profiles,
   the daily merc update, the renewal sequence and its prompts (`contractRenewal`, `mercDeparture`,
   `insuranceExtension`), extensions, dismissals, departures with the equipment left behind, R.P.C. pay, M.E.R.C. accounts,
   level-ups, relationships and reputation; stub profiles for the stub pack; contract state from native saves. 81 oracle
   probes (13,488 draws) match. The strategic page shows contracts and morale and answers contract prompts.
3. **Laptop and hiring** (`sim/campaign/laptop`, `sim/campaign/narrative/facts.ts`, `server/laptop-view.ts`): the laptop as
   a modal flow with A.I.M. (prices, deposits, refusals, arrivals by the 07:30/13:30/19:30 flights, landing zone),
   M.E.R.C. (account, listings, debt, outages), I.M.P., Bobby Ray's (stock, restock at 09:00 before the dealers, orders,
   deliveries with Pablo's theft), life insurance, florist, email, history and files; the new game in the original's
   order (profiles, terrorists, mercs on assignment, dealers, Bobby Ray, `InitNPCs` placements, mails, the M.E.R.C. day);
   campaigns hire through the laptop; the 500-fact narrative store; laptop sections of native saves; stub dealers in A10.
   43 oracle probes (new games with 2,500–2,700 draws each, hires, orders, deliveries, insurance, I.M.P.) match.
4. **Play surface**: the strategic page opens the laptop (mail, A.I.M., M.E.R.C., I.M.P., Bobby Ray, insurance, records),
   starts a campaign in the laptop and sets the landing zone; the tactical page trades with the nearest visible merchant
   (buy, sell, repair). Own soldiers' inventories are in the player view.

**Left out of M5**: NPC presence by `state.npcPlacements` and the 04:00 dealer moves, Slay and EPC events, the history
writers of quests, dialogue, R.P.C.s and boxing, computed facts (`CheckFact`) and florist bouquet prices (original
text only); M6 covers all but the prices (`docs/deviations.md`).

### M6: done (2026-10-16)

Specs: `docs/24` (NPCs and dialogue), `25` (quests, facts, NPC actions, schedules), `26` (meanwhiles and the ending).

1. **Doors, keys and civilian groups** (`sim/tactical/doors`, `sim/tactical/narrative`, `sim/strategic/narrative/civ-groups.ts`):
   the lock table, key rings and key items, the mutable door table with the perceived lock and trap state, every branch of
   `HandleOpenableStruct` (keys, lock picking, forcing, crowbars, shaped charges, examining, untrapping, the traps), shooting
   locks, the `door` command with the door menu as data; civilian groups as strategic state, `MakeCivHostile`, attack
   implications, the hostile-quote list and event 41; sight and death rules through a narrative port (facts, quests and
   records default to off until `docs/24`/`25` provide them). 49 oracle probes match.
2. **Helicopter and vehicles** (`sim/strategic/forces/helicopter*.ts`, `vehicles.ts`, `sim/campaign/helicopter-flow.ts`):
   Skyrider's helicopter (set-up, refuel sites, flights with SAM fire, scouting and billing, hovering, the return to base,
   debts, destruction, monologues), boarding and leaving vehicles, vehicle routes and the strategic side of ground
   vehicles; `heliRoute`, `heliCancel`, `boardVehicle` and `leaveVehicle` commands. 120 oracle probes match.
3. **NPC records and conversations** (`content/narrative`, `sim/narrative`, `sim/campaign/talk-flow.ts`): `.npc` and `.edt`
   formats, the NPC profile fields and record arrays (with save import), record choice (desire to talk, approaches,
   triggers), `ConverseFull` and the dialogue queue; the modal talk session with walk-up, NPC-initiated talks as decisions,
   scripted sequences and the merchant link; `talk`, `approach` and `closeTalk` commands, text served from the EDT files.
   313 oracle probes match.
4. **Facts, quests and NPC presence** (`sim/strategic/narrative`, `sim/campaign/narrative`): one fact and quest store with
   save import, `CheckFact` with every computed rule, quests with history lines and the quest log in the strategic view,
   NPC sectors at a new game, placement overrides and both `AddProfiles…` passes, the quest code of sector entry and exit,
   the 04:00 moves and the hourly and daily NPC handlers. Dialogue and the helicopter read facts through `CheckFact`.
   51 oracle probes match.
5. **NPC action catalog** (`sim/tactical/narrative/npc-actions`): every `HandleNPCDoAction` code of the original, the
   requestor questions as an `npcRequest` prompt, the NPC system events, the hospital (prices, refunds, supplies) and
   Kingpin's money; the head-miner stand-in is gone. 188 oracle probes match.
6. **Schedules** (`sim/tactical/narrative/schedules.ts` and the AI hook): map and save schedules, `PostSchedules` with
   default schedules, sleep spots and the 24-hour replay, event 36, schedule moves and doors, sleeping and waking, away
   slots, shop hours, Larry's hourly update and the Mike/Iggy upgrade. 51 oracle probes match.
7. **Giving** (`sim/tactical/give.ts`, `sim/narrative/give.ts`, `sim/tactical/narrative/quest-items.ts`): the `give` command
   to NPCs, dealers and squad mates with the original's acceptance rules and quest effects, and the quest action items
   (pressure items and switches, Kingpin's and the museum's alarms, the brothel scene). 83 oracle probes match.
8. **Recruiting, escorts and the robot** (`sim/tactical/narrative/team-change.ts`, `sim/campaign/narrative/recruit-flow.ts`,
   `robot-control.ts`): `ChangeSoldierTeam`, R.P.C.s and escorts joining and leaving, the `unescort` command, escort
   arrivals, civilian-group side changes and the robot's remote control. 74 oracle probes match.
9. **Civilian quotes, surrender and NPCs on their own** (`sim/narrative/civ-quotes.ts`, `sim/tactical/ai/pause.ts`): civilian
   quotes and sector hints, guide descriptions, the enemy's surrender offer in tactical combat, the hostile-quote pause,
   first-sighting records and quotes, and the named-NPC AI that walks up and starts conversations. 151 oracle probes match.
10. **Meanwhile scenes and the end of the campaign** (`docs/26`): scene posting and resolution without cutscenes, the
    interrogation played on the record engine, prisoners in Alma and Meduna, progress and first-battle triggers, the
    Queen's escape and the O3 statue (`useRemote`), the Queen's death, the endgame sequence and the won campaign
    (`campaignOver`). 62 oracle probes match.
11. **Boxing** (`sim/tactical/narrative/boxing.ts`): the San Mona club's state machine, bets and rematches, half AP and no
    interrupts in the ring, disqualifications and cheating, the knock-out, the boxers' AI, the boxing facts and history;
    `mapScreen {abandonFight}`. 104 oracle probes match.
12. **Play surface**: the tactical page talks to NPCs (lines, approaches, NPC questions, giving items), answers prompts
    and shows civilian quotes and the boxing state; the strategic page shows the quest log, the meanwhile log and the
    campaign status, flies the helicopter and releases escorts. The full oracle comparison has 33 probe sets and 9214
    matching lines.

**Left out of M6** (`docs/deviations.md` has the details): capturing the civilian hummer and the ice-cream truck and placing
passengers at a ground vehicle; the helicopter's structure pieces on the tactical map and the O3 statue's graphics (with
the M8 renderer); Skyrider's and the helicopter's profile sectors; merc lines said after a conversation closes (the gender
table); the rebel basement's map changes in A10; NPC action 12 (no first aid system yet) and `END_DEMO`; reloading the
robot through `give`; manual switches, toggled pressure items, pits and pressure mines; Kingpin's hitmen; native-save
import of other sectors' temp files; `HandleNPCChangesForTacticalTraversal`; the `PC_HAS_CONRADS_RECRUIT_OPINION` input;
playing meanwhile scenes in the browser (M7/M8).

### M7: done (2026-10-18)

Spec: `docs/27` (saves, options, sound and music, video, localization, stub completeness, performance, the scope of a
player UI). Result: the platform release 0.7.0 (`docs/releases.md`). A whole campaign runs on the server and can be
saved, loaded and replayed; the browser pages play it with sound, music and the videos, the DOM launcher starts and
loads games, and the UI speaks every language of Stracciatella's string tables, on the original data and on stubs. The
canvas player UI with the original's screens is M8.

1. **State ownership and the snapshot** (S1, S2; `sim/snapshot`): session, flow and roster state and the cosmetic
   streams moved into `StrategicState` and `TacticalState`, with a restore path that skips the creation side effects;
   a graph codec writes the whole session, keeping insertion order, pointers as references to the object's home and
   content as keys. Restore is exact: every campaign scenario also runs reloaded at every input and must produce the
   same event log and final snapshot byte for byte (`pnpm test:reload` reloads every test campaign). The largest
   stub state is 2.3 MiB raw and 41 KiB gzipped, the largest native import 4.1 MiB and 144 KiB.
2. **Saves** (S3; `server/save-*.ts`, `input-log.ts`, `replay.ts`): `.j2s` files whose header the save list reads from
   the first gzip member, a content identity over every file the simulation read (about 1,300 on the original data),
   the original's save modes (save anywhere, Iron Man, Dead is Dead with its save points and two backups), the
   autosave at `endTurn` in combat, player loads that reseed `main` from a logged seed and exact loads, an input log
   per save and `pnpm cli replay`, the MCP, HTTP and WebSocket surfaces (`04` §6.22). Saving draws nothing and changes
   nothing.
3. **Options** (S5; `sim/options.ts`): one `GameOptions` object shared by both layers, chosen at `newSession`, shown in
   `status`, written into save headers and mapped from native saves; `setOption {bloodAndGore}` with the messy deaths
   and corpse graphics it changes; client settings stay in the browser. Fixed on the way: campaigns ignored gun nut for
   the army's guns.
4. **Text and languages** (S6): the data version detected like Stracciatella's guesser (`JA2_DATA_VERSION` overrides),
   EDT decoding and the Buka NPC layout per version; the display language separate from it (`JA2_LANG`, per session);
   Stracciatella's string tables in eight languages with their length check (217 keys, 1,901 strings each),
   `/api/strings`, `/api/text` for every EDT file with its record layout (`04` §6.21).
5. **Sound and music** (S7–S9; `content/formats`, `content/audio`, `audio/`, `protocol/music.ts`): WAV (PCM and IMA
   ADPCM), `.gap` and ambient decoders, the transcribed sound tables (291 ids, 237 paths), cue rules for footsteps,
   guns and bursts, impacts, doors, explosions and battle sounds, a Web Audio engine with the original's 16 voices and
   linear panning, a director that replays animation codes 700–798 between view frames, speech and ambient; the music
   mode is computed by the server from the simulation's events and saved with the session, the browser picks and fades
   the tracks. Every WAV of the user's sound, battle-sound and music archives decodes.
6. **Video and credits** (S10): a Smacker 2 decoder written from the format description (all eleven videos of the
   user's data decode, a 640×480 frame in 1.35 ms on average), a stub encoder and a 40 KB stub splash, a WebGL2 player
   paced by the audio clock, the sequences of `Intro.cc` for the splash, the beginning and the ending, the credits
   parser (all 248 rows) and a DOM scroller.
7. **Launcher** (S11; `app/launcher`, served at `/`): new campaigns with the game init screen's options, the save list
   with load, save, delete, download, upload and native imports, client settings with export and import, the splash
   after a click and the intro after a new game, labels from the original string tables in the chosen language;
   Alt+S and Alt+L in the game pages.
8. **Stub content** (S7, S13 part A): synthesized sounds, music and speech blips under the original names, invented
   merc, item, credit and mail text, a stub splash, every sector on a generic map by kind (towns with a dealer and a
   jail, mines with head miners, caves, army camps, the airfield where Skyrider's helicopter is set up), 44 profiles
   with twelve A.I.M. mercs, windows, fences, sandbags, roofs and cliffs in the stub tileset, two bitmap fonts with
   Cyrillic subset from Terminus Font (OFL); 486 files, 6.7 MB.
9. **Inventory and first aid** (`04` §6.24): `moveItem`, `drop`, `attach`, `detach`, `unload`, `reload`, `swapHands`,
   `applyItem` and `bandage` follow the original inventory panel, description box, reload cursor and medkit code
   paths; the map screen moves items between mercs and the sector stash, and `inventory` lists them. NPC action 12
   (left out of M6) now ends a first-aid service.
10. **Benchmarks and stalled turns** (S4 and two fix slices; `tools/bench`): `pnpm cli bench` with seven scenarios on
    both sources and a CI smoke run. It found AI throws that never left the hand, a battle that never ended, refused
    attacks with side effects, the missing `GunRange` port and a stats object shared by all stub mercs (`27` §14,
    findings 7–13), then the stalls only the original's deadlock breaker would end (14–17, fixed as minimal deviations).
    Afterwards the enemy-turn sweep (seeds 1–8, every variant, both sources) and the stub campaign sweep (seeds 1–16)
    end without a stall.
11. **Performance and session hosts** (S12): cheap frame views during compression and none without a viewer (a world
    day of compression 79 → 37 ms at the median, 15 ms when nobody watches), cover traces taken once per position and
    remembered throw searches (a 16-enemy turn 197 → 131 ms at the median, 393 → 274 ms at p95); a `SessionHost` for
    every surface, in process with 10 ms slices and one slice per event-loop turn, or one worker thread per session
    (`JA2_SESSION_HOST=worker`): the longest stall of other sessions during an instant battle fell from 214 to 28 ms at
    the median. The targets of `27` §7.3 are met except the first save of a session on the original data, which builds
    the content index (p95 148–186 ms against 100 ms), and the client frame rate, which was not measured.
12. **Release** (S14): `deviations.md` grouped by area and checked against the code, this status, `04` §6 tidied,
    `releases.md`.
13. **Stub campaign end to end** (S13 part B; `tools/campaign-bot`, `pnpm cli campaign`): a scripted player that uses
    the MCP tools alone hires the A.I.M. squad, wins the landing, takes Drassen, starts the mine, sets up Skyrider's
    helicopter, trains militia, recruits up to twelve mercs and marches on Meduna. It does not win yet: over seeds 1–4
    it fights 16–23 battles in 12–15 days and loses the squad on the march or at the Meduna outskirts, which hold the
    original's twenty-strong garrisons (`27` finding 31). An exact load in the first battle matched the original
    session over its whole remaining battle on every seed (232–616 compared steps, no difference); the e2e segment runs
    the landing with that check. On the way it fixed `enterSector` on the loaded sector, the busy count of a hit
    during a non-interruptible animation, chained suppression stance changes and a renewal prompt that came back
    forever (the last three as deviations), and the stub kits, palace, garrison posts, unjam animations and
    wilderness enemy slots.

Tests at the end of M7: 1,730 tests in 300 files (216 files at the end of M6), 48 of them skipped without the original
data; 16 end-to-end specs (10). The full oracle comparison (`tools/oracle/compare-all.sh`, the regression gate added at the
start of M7) is unchanged through every slice.

**Left out of M7** (`27` §14, the slices' open issues, and the entries of `deviations.md` tagged **Later** or **M8**):
- performance: the client frame rate (60 FPS at 1920×1080, with the M8 renderer); the first save of a session on the
  original data stays above 100 ms (the content index); an in-process save still stalls other sessions for its
  snapshot and stringify (40–70 ms; the worker host avoids it); the bench's `server` scenario has no worker variant;
- sound and text: lip sync (needs faces, M8), button clicks (M8) and the cues of "Sound coverage"; the English and
  Chinese battle-sound branch waits for the "see enemy" quote; the version guesser's resource-pack hashes, the MLG
  pictures (M8); the oracle has never run on Russian data;
- launcher: playback speed, display toggles and key-advance speech are stored for M8; the save list shows sector codes
  without land types or town names; meanwhile scene playback in the browser (M8);
- the stub campaign is not won by the bot yet (`27` finding 31); open from that slice: a merc waiting forever for a
  tile held by a squad mate, own mercs' bleeding missing from the view, and three stalls seen once after a player load
  (findings 29–34);
- stubs: the creature lairs and the mine levels below the first have no way in, so a sci-fi stub campaign cannot
  reach the creature queen; window climbing and wire cutting are not ported; the stub fonts are drawn only by M8;
- decided against: extra autosaves (sector entry, daily) and a copy of the game policy in saves (`27` §14);
- seen while tracing, not changed: `HandleSystemNewAISituation` can drop a pending melee animation without its busy
  count during a stance change (no source of such a situation found, finding 18);
- still open from M6: reloading the robot through `give`, Kingpin's hitmen, manual switches, toggled pressure items,
  pits and pressure mines;
- the **Later** gaps of `deviations.md`: drugs and alcohol, timed bombs and the bomb queue, catching tossed items,
  martial arts and stealing, panic AI, the Warden, tanks and throwing knives, gas masks, camouflage, smoke and hearing
  items in sight, corpses rotting in the loaded sector, auto-bandage, walk-and-strike orders in the API, the hummer
  and the ice-cream truck, vehicle repair and fuel, throws underground, the helicopter drop sequence, native import of
  other sectors' temp files, the rebel basement's map changes, Skyrider's profile sectors, the AI threat value's
  assignment test, the lair quotes, the say-later lines and the own-merc bark table;
- the **M8** gaps: the enemy glow, wireframes and slanted roofs, window and statue graphics, the helicopter's pieces
  on the tactical map, the credits screen with faces and fonts.

### M8: in progress

Spec: `docs/28` (slices U0–U15; the maintainer's decisions in §18, M8 is 0.8.0). Landed, each with its part in
`28` §17.4:

1. **Platform** (U0a, U0b, U0c): the DOM-free `ui` layer, the `/play` page with screen and modal stacks, the logical
   framebuffer with an integer UI scale, the draw list and its WebGL renderer; the rule pack (the simulation reads no
   graphics; the animation scripts split into logic and presentation), the content identity bound to the game data
   only, the asset manifest with content-hash immutable URLs, the client's asset source and cache.
2. **Widgets and text** (U1): mouse regions, tooltips, buttons, bitmap text with the original's wrap and colour rules,
   cursors, popups, message boxes, sliders, text fields, layouts as JSON with generated constants and a bindings
   contract, the layout-driven stub skin, a widget gallery.
3. **Front-end** (U2): main menu, game init, options, save/load, credits, loading screens, exit and the San Mona screen
   on the canvas, the save controller shared with the launcher.
4. **Server for the screens** (U3a, U3b): the HUD's view fields, events, message entries, refusal tokens, `pauseOn`,
   `closeSession`, the profiles and items endpoints, five rule findings fixed; cursor hints computed in the browser by
   the simulation's own functions over a player-knowledge projection, equal to the server's answers on the query
   channel.
5. **World renderer** (U4, U4b): texture arrays, a static scene buffer (A9 at 1920×1080: 436 → 26 draw calls), the
   camera, sprite picking, items, roofs, client-side lighting, the enemy glow, wireframes and slanted roofs, corpses,
   smoke, tile changes, the animation schedule with the time warp; `Light0`–`Light6` from Stracciatella's
   `light-templates.json`.
6. **Tactical HUD** (U5): the tactical screen on `/play` with the team and single-merc panels, animated faces with
   lip sync, bars, radar, clock, top bar, message log, overhead labels, the inventory with the item description box and
   the pickup menu.
7. **Laptop, part one** (U10): the shell, Email, Finances and the A.I.M. hiring path with their server gaps, opened
   from `/play`.

8. **Tactical input** (U6): the `Handle_UI.cc` state machine with its cursors and world markers, the gameplay keys,
   the movement and door menus, the sector exit dialog, the overhead map, scrolling, and the orders the panels and
   keys give (`stealth`, `weaponMode`, burst spread, `swapPlaces`, `jump`, `moveGroup` and the rest of `28` §12.4).
9. **Talk and shop** (U7): the speech presenter, the talk panel and the speech surfaces, the shop screen with the
   client shop model, the money box and the money commands.
10. **Map screen** (U8): the strategic screen on `/play` with the character list, info panel and inventory, plotting,
    the helicopter, assignments, contracts, the town and mine box, the militia popup, the sector inventory, the bottom
    panel with compression, the update box and the hotkeys; the front end follows the server's flow between the map,
    tactical and the laptop.
11. **Battle entry** (U9): the pre-battle interface (both kinds, `showBattle` for the one opened during a battle) and
    the autoresolve screen with its playback speeds, sounds and result box.
12. **Laptop, parts two and three** (U11, U12): Bobby Ray's, M.E.R.C., I.M.P., Personnel, History, Files, the
    insurance, florist and funeral sites and the A.I.M. archive pages, with their server gaps; every bookmark leads to
    a finished page.
13. **Story and help** (U13): the help screens, the meanwhile box, the interrogation and the ending through to the
    credits on `/play`, a campaign identity for per-campaign client state.

Next (`28` §17.2): U14 the remaining stub art and e2e, U15 the release.

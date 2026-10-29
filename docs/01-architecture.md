# 01 — Architecture

ja2-node reimplements Jagged Alliance 2 in TypeScript: the original's behaviour, not its code. This document holds the
licensing and data rules, the decisions D1–D16, the layers, the simulation core's cross-cutting rules (API, state,
time, animation timelines, protocols kept exactly, randomness, prompts, options), the content model, verification and
the repository; §10 maps the other documents.

**Conventions.** Paths into the original are relative to `reference/stracciatella/src/game/` (`sgp/…` and
`externalized/…` to `reference/stracciatella/src/`); `V:` is vanilla (`reference/vanilla/ja2/Build/`).

---

## 0. Goal, licensing and data

**Goal.** The original's behaviour carried over exactly: formulas, constants, check order, integer truncation and the
semantics of its random draws. Code structure, rendering, UI, assets and the save format are ja2-node's own. The game
state lives on the server (Node); the browser is a client (playback and input); agents (e.g. Claude through MCP) play
through the same API; Node also runs the tools, headless runs and tests.

**Licence of the code.** The original's source is under the Strategy First Source Code License Agreement (SFI-SCLA), and
ja2-node derives from it through Stracciatella:
- The repository as a whole is SFI-SCLA (`LICENSE`, verbatim): a derivative may be distributed only with a verbatim copy
  and no broader rights (clause 3), so MIT, GPL or Apache cannot apply. Non-commercial use only: no sales, paid access,
  donations for access or advertising.
- Files derived from the original's logic carry a prominent change notice with the date (clause 4); the header is in
  `CLAUDE.md`. Copyright and other notices stay (clause 1); Strategy First receives a royalty-free right to the
  modifications (clause 5); the warranty disclaimer and the liability limit pass on (clauses 7, 8).
- Stracciatella's changes after commit `8287b98` are public domain, the founder's earlier ones of unknown status; all of
  it grows out of SFI-SCLA, so the result has that one licence.
- `reference/ja2-web` (Stracciatella compiled to WASM) claims GPLv3 on top of SFI-SCLA, contrary to clause 3. Its status
  is unclear: it may be read for ideas, but no code is copied from it.
- Third-party code must be compatible: the Smacker decoder is written from the format description because libsmacker is
  LGPL.

**Data.** The original game data (graphics, sound, speech, video, maps, `prof.dat`, `.npc`, `.jsd`, `ja2bin.dat`, EDT
text) is commercial content outside SFI-SCLA. It is read at run time from the user's copy (`$JA2_DATA_DIR`: the `Data`
folder or the game root; GOG or Steam 1.12 Gold, English or a localized release) and never committed, nor anything
derived from it: extracted files, JSON produced from `Ja2bin.dat`, oracle probe outputs (kept outside the repository,
by default in `~/ja2-oracle`), screenshots. The repository ships:
- `data/externalized/`: Stracciatella's JSON tables (`assets/externalized` at `ae6bf01`), copied unchanged; they were
  extracted from the source code, so they are SFI-SCLA. Exception: `script-records-NPCs.json`, whose comments quote game
  dialogue; its records are in `data/tables/npc-script-records.json`.
- `data/tables/`: tables transcribed from the source code by `tools/transcribe/*.ts` (regenerated, never edited).
- `stubs/`: the stub pack (§4.4), ja2-node's own work, neither traced, converted nor extracted from the original. Its
  content is CC0 1.0 (`stubs/LICENSE.txt`); `stubs/NOTICE.txt` lists what that covers. The generator code and the files
  that tie the pack to the game (built from Stracciatella's tables: `aliases.json`, `stubs/maps/sector-kinds.json`, the
  stub `ja2bin.dat` and `ja2set.dat`, …) stay SFI-SCLA, and a new stub file built from those tables joins that list; the
  Stub Pixel fonts (a Terminus Font subset) are SIL OFL 1.1.
- Not shipped: Stracciatella's `from-russia-with-love` mod `A9.dat`, declared public domain but most likely a reworked
  Omerta (local parser tests at most).

`reference/` holds the third-party sources (Stracciatella at `ae6bf01`, vanilla; `reference/README.md`), read-only and
gitignored.

---

## 1. Key decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The behaviour reference is JA2 Stracciatella with default settings**: vanilla 1.12 Gold mechanics plus its bug fixes (§3.10), its policy files with their shipped values (§3.9). Every deliberate difference is an entry in `deviations.md` | The same JA2 without bugs such as "bandaging raises the to-hit penalty" |
| D2 | **The simulation core is separate from presentation**: deterministic, no DOM and no Node API, no mutable module state (several sessions share a process), serializable: the snapshot codec (`src/sim/snapshot`) writes the whole session and restores it exactly. The client derives sound, music and video from events and view frames; the server computes the music mode outside `sim` (`src/protocol/music.ts`) | Tests, headless runs, comparison with the original, saves, replays |
| D3 | **One game time: integer milliseconds on a fixed 5 ms tick** (`TICK_MS`, `src/sim/clock.ts`), the original's overhead pass; every timer of the original runs on ticks with its value (§3.3) | Outcomes independent of FPS and machine speed |
| D4 | **Animations enter the simulation as data**: `ja2bin.dat` and `gAnimControl` become timelines; the simulation steps the logic timeline and runs the gameplay opcodes at their frames, the views take sprite frames and sound codes from the presentation timeline (§3.4). No sprite enters the simulation | The original resolves shots, deaths and doors on animation frames; durations are numbers the simulation computes instead of waiting |
| D5 | **The resolution barrier is the original's attack busy count** (`attackBusyCount`, `src/sim/tactical/turns/turn-state.ts`; release in `src/sim/tactical/combat/barrier.ts`) with all of the original's increments and decrements (§3.5) | Suppression, combat entry, the end-of-attack sight check and deferred noise run when it reaches 0; the counter reproduces that order, quirks included |
| D6 | **Separate random streams**: `pre` (the PreRandom ring), `main`, and cosmetic streams that never touch outcomes; every simulation stream is saved (§3.6) | The original's save-scum protection; cosmetics cannot change outcomes |
| D7 | **State is data**: typed-array grids, content by key, the session, flow and roster state inside `StrategicState` and `TacticalState` (§3.2); the snapshot codec writes object references as references to the object's home | Serialization, debugging, worker threads |
| D8 | **Content is one canonical model.** Importers read the original formats; decoders have no DOM and no Node, so media decodes in the browser too; the stub pack is another source of the same model; the simulation reads content only from the rule pack (§4) | The game does not know where its data came from |
| D9 | **Rendering is ja2-node's own thin WebGL2 layer**: indexed sprites, palette rows, shading tables, strip-based depth (§5.1) | Soldier palettes and tile lighting are cheap only in a shader |
| D10 | **The game UI is ja2-node's own canvas widget set with layouts as data**: the DOM-free `ui` layer and one game page, `/play` (§5.2); the DOM serves only the launcher and the developer pages | The original's 640×480 screens pixel for pixel with the original art or the stub skin; another skin binds to the same controllers |
| D11 | **Verification rests on the native oracle and native save import**: a patched Stracciatella runs probes headless on the original data; native saves load into sessions to compare derived values (§8) | The only way to show the mechanics match |
| D12 | **One package (pnpm); layers separated by TypeScript project references and ja2-node's import check** (`tools/check-imports.ts`; dependency-cruiser 18 does not read TypeScript 7), §2 | Simplicity with strict boundaries |
| D13 | **The server is the source of truth**: sessions live in the Node process; the browser, MCP agents and scripts are equal clients of one protocol, through a `SessionHost` (`src/server/session-host.ts`): in process with 10 ms time slices, or one worker thread per session (`04` §5) | State on the server, play through the API, replays and saves in one place |
| D14 | **A driver moves time; playback is separate**: `advance(until)` with stop conditions; real-time ×k, instant and manual drivers; the client plays the view frames back at any speed or skips them (`04` §4) | Instant enemy turns and any speed-up without changing outcomes |
| D15 | **Every player action is a semantic command, every modal moment a decision prompt** (§3.8); no rule lives in a UI screen | Agents and the UI control the game the same way; the simulation never waits for a client |
| D16 | **One player-view projection** (`PlayerView`) for the UI, agents and queries; cursor hints run the simulation's own functions over a player-knowledge projection (`src/sim/knowledge`, `src/sim/hints`) on the client and on the server's query channel | Honest information for agents, no hidden-state leaks |

---

## 2. Layers

```
browser    app (/play, launcher, playback, asset source, client hints) · devtools · render (WebGL2) · audio (Web Audio)
             ▲ WebSocket, HTTP
Node       server (sessions and hosts, drivers, HTTP, WebSocket, MCP, saves, rule pack) · node (disk VFS, token)  ◄─ MCP
shared     ui        draw list, widgets, layouts, screen and modal stacks, input, text, UI scale
(no DOM,   protocol  client and server messages, view frames (PlayerView and diffs), music mode
 no Node)  sim       state and rules; dispatch / step / advance / drainEvents / view; knowledge, hints, snapshot codec
           content   data model, VFS, format decoders, rule pack, timelines, text
           core      RNG streams, integer helpers, SHA-256
Node only  stubs (stub pack generator) · tools (CLI, dev runner, gates, import check, transcribers, bench, campaign bot,
           oracle)
```

**Dependencies**, enforced three ways: project references in tsconfig (an import from an unreferenced layer does not
compile); `lib: ["ES2024"]` without DOM and `types: []` without `@types/node` in the shared layers; and
`tools/check-imports.ts` (`pnpm imports`), which checks the table below and explicit `.ts` extensions, and bans
`Math.random`, `Date.now`, `new Date`, `performance.now` and timers in the deterministic layers.

| Layer | May import | Runs in | Deterministic |
|---|---|---|---|
| `core` | — | everywhere | yes |
| `content` | core; `fflate` | everywhere | yes |
| `sim` | core, content | everywhere | yes |
| `protocol` | core, content, sim | everywhere | |
| `ui` | core, content, protocol | everywhere | yes (time is injected) |
| `node` | core, content; `node:*` | Node | |
| `server` | core, content, sim, protocol, node; `node:*`, `hono`, `@hono/node-server`, `ws`, `zod`, the MCP SDK | Node | |
| `render` | core, content, protocol, ui (types only: the draw list) | browser | |
| `audio` | content, protocol | browser | |
| `app` | core, content, sim, protocol, ui, render, audio | browser | |
| `devtools` | core, content, protocol, ui, render, audio, app | browser | |
| `stubs` | core, content, node, ui; `node:*` | Node | |
| `tools` | core, content, sim, protocol, node, server, stubs; `node:*`, the MCP SDK | Node | |

- `sim` gets its content as input and never opens the VFS (§4.2).
- `app` imports `sim` to run the simulation's own functions in the browser: the cursor hints over the player-knowledge
  projection (`28`) and the light levels the world is shaded with (`20`), besides ids and types. The client never
  reimplements a rule and never feeds a session.
- The MCP adapter is part of `server` (`src/server/mcp.ts`); there is no agent layer.

---

## 3. Simulation core (`sim`)

### 3.1 API

Every simulation is a `Steppable` (`src/sim/advance.ts`): it steps one 5 ms tick, says whether it is idle (the turn is
back with the player and every effect settled) or holds a decision prompt, and hands out the events since the last
drain; a campaign adds its world clock. A session's simulation (`SessionSim`, `src/server/session.ts`) adds `dispatch`
(the rule check, then the state change or a refusal) and `view` (the player view, D16). The implementations are
`TacticalSim` (`src/sim/tactical/tactical-sim.ts`: a sandbox or the loaded sector) and `CampaignSim`
(`src/sim/campaign/campaign-sim.ts`: the strategic state plus the loaded sector).

- **`advance`** runs ticks until a stop condition; a decision prompt always stops it. Its resumable form `AdvanceRun`
  is what the server slices without changing what a tick does (`04` §4.2, §5.9).
- **Commands** are intents (`move`, `attack`, `endTurn`, `route`, `aimHire`, `trade`, `answer`, …). The tool
  descriptions of `src/server/mcp.ts` list every one with its fields; `29` gives the rules behind them.
- **Events** are facts for presentation and agents; the simulation never acts on them. Clients get them inside view
  frames (`04` §4.4).
- **Queries** (`estimateAttack`, the cursor hints, `quoteTrade`, …) run the rule functions the simulation uses, over the
  projection, and change nothing: the hit chance on screen is computed by the code that rolls it.

### 3.2 State

- **Two roots.** `StrategicState` (`src/sim/strategic/state.ts`): the world clock and event queue, `rng` and `pre`, the
  game options, profiles, map, forces, the Queen, economy, merchants, contracts, laptop, narrative, roster, sector
  diffs, the flow (`strategic`, `tactical`, `autoresolve`, `laptop`) with its flow state, and the cosmetic streams.
  `TacticalState` (`src/sim/tactical/state.ts`): the loaded sector's world (map data, movement costs, structures),
  soldiers and merc slots, occupancy grids, doors, turn state, perception, lighting, items, bullets and effects.
  Options, profiles and random streams are the same objects in both; a sandbox has only a `TacticalState`.
- **Ids and references.** Soldier ids are the original's team-blocked ids (the `Menptr[]` indices); groups, items and
  sectors are numbered as in the original. Tactical objects refer to each other directly; the snapshot codec writes
  those references as paths to the object's home and content as content keys (`27` §1.8).
- **Grids** are typed arrays over the 25,600 tiles. The order of level nodes, structures and groups affects rendering
  and logic and is preserved.
- **Static and dynamic.** Map geometry is immutable content; what changed in a sector the squad left (doors,
  destruction, items, corpses, blood) is its `SectorDiff` (`src/sim/campaign/sector-diff.ts`), like the original's temp
  files.
- **Integer semantics.** Fixed-width fields go through `src/core/int.ts` (`idiv` truncates toward zero), large products
  through `Math.imul`, `float` math through `Math.fround`. Overflows the original relies on are reproduced where the
  code meets them (e.g. a `UINT8` overflowing before its clamp, `Tactical/Overhead.cc:5182`; a `UINT32` underflowing
  inside `max`, `Strategic/Game_Clock.cc:634`; bit-31 flags need `>>> 0`).
- **Determinism.** No `Math.random`, wall clock, timer (checked, §2) or mutable module state in `core`, `content`, `sim`
  and `ui`. Tables the original precomputes with C math are evaluated as it does (`gdRadiansForAngle` with glibc
  `sin`/`cos`, `src/sim/tactical/constants.ts`). Sight, bullets, throws and directions call `Math.sin`, `Math.cos` and
  `Math.atan2` where the original uses float trigonometry and round to float32; a last-ulp difference from C's `sinf`
  can rarely move a landing tile (deviations "Physics cadence and floats"). The reload and replay harnesses (§8) check
  that an outcome depends only on the seed and the inputs.

### 3.3 Time

**Game time on 5 ms ticks (D3).** The original's frame loop runs `ExecuteOverhead` at most every 5 ms
(`GameScreen.cc:424-427`, `Utils/Timer_Control.cc:15`). A soldier's animation counter re-arms from "now" and never
catches up (`Utils/Timer_Control.cc:155-181`), so a soldier advances at most one frame per pass and a slow machine slows
the game. Real time has no action points (`Tactical/Points.cc:462-465`): an action lasts as long as its animation, so
tactical game time is in effect "animation frames played" and the wall clock only sets the pace. In combat, soldiers
the player cannot see get frame delay 0 and animate on every pass (`Tactical/Soldier_Control.cc:4928-4936`): turn-based
outcomes never depended on playback speed. A ja2-node tick is one overhead pass on an ideal machine that never drops a
frame; every timer keeps its value in game milliseconds and its reset points, and a cadence that follows the frame rate
or the CPU in the original runs on the tick grid. What the original couples to clocks, frames and sound is listed in
`04` §3; each resulting difference is a row of `deviations.md` §2.

**Time modes.** On the strategic map tactical ticks stop and world time runs at compression 0, 1×, 5, 30 or 60 minutes
per second. In tactical real time both run (5 ms of world time per tick, compressed where the original allows it). In
turn-based combat ticks run (animations, bullets, explosions) and world time is frozen, as in the original. A decision
prompt stops both until its `answer`.

**Drivers** (D14, `04` §4.3) decide when ticks run: real time ×k, instant or manual. Turn-based combat gives the same
outcome under every driver, real time when commands arrive at the same ticks. The client never runs the simulation: it
plays the frames at 1×, faster, skipped, or "unseen at once".

### 3.4 Action timelines: animations as data

**The data.** The user's `ja2bin.dat` holds one script per animation state (`src/content/formats/ja2bin.ts`): sprite
frames, opcodes, jumps inside the script and to other states, and sound codes (the code ranges:
`Tactical/Soldier_Ani.cc:93-2547`). `gAnimControl` (flags, speed, non-interruptibility) is transcribed into
`data/tables/anim-control.json`. The gameplay opcodes are where the original resolves an action on an animation frame:
the fire opcode 430 (every gun, melee and launcher attack), the throw release 460/461, the death commit 440, the
roof-climb commits 408/475, opening a door 494/495, the busy count's increments and decrements, and the end of an
animation 499, among others.

**ja2-node.** `splitAnimationScripts` (`src/content/anim/timelines.ts`) splits the scripts at load into a **logic
timeline** (frame, opcode, jump or state per slot) that the simulation steps and a **presentation timeline** (sprite
frames, sound codes) for the views and clients. The logic timeline keeps every opcode except the sound-range codes no
handler acts on (`isSimulationOpcode`), at the same positions, so jumps and opcode skips are unchanged. A soldier keeps
`state`, `pc`, `frameSlot` and `nextFrameAt`; views find the sprite by body, state, frame and direction.
`adjustToNextAnimationFrame` (`src/sim/tactical/animation.ts`) walks the logic timeline and runs the opcodes of fence
hops, pauses, doors and the end of an animation itself; every other opcode goes down the chain of subsystem `*Opcode`
handlers (attack, death, items, roofs, throws, first aid) that `installTacticalHooks`
(`src/sim/tactical/tactical-sim.ts`) wires. Not run: the random idle animations of 491 (gaps "Random idle animations")
and the jar damage of 721/722 (gaps "Fragile items on falls"). The stub pack has invented scripts for every state with
the same gameplay opcodes and shorter frames (`stubs/anim-scripts.ts`); a client whose scripts differ from the
server's: `28`.

**Why markers stay in the simulation.** Paying AP and applying effects at command confirmation, with the animation as
mere visualization, would lose what happens between an order and its marker: an interrupt, an NPC's throw cancelled
before release without AP, map blindness during a roof climb, a burst at a falling target (`04` §2).

### 3.5 Protocols carried over exactly

The skeleton of tactics; the order inside each is behaviour, kept with its quirks.

1. **Tile step** (`07`; `HandleGotoNewGridNo`, `Tactical/Overhead.cc:1247`; `HandleAtNewGridNo`, `:1709`). The step's
   AP and breath are paid at the tile centre before leaving; the soldier changes tile at the boundary, so bullets hit
   him on the new tile from then on; at the new centre the checks run in a fixed order (breath collapse, mines, noise
   and its interrupt, sight and its interrupt, mine detection, a new AI situation, arrival triggers).
2. **Turning** (`06`, `07`): one octant per frame, each with a sight check without interrupts; a new sighting cancels an
   AI turn-to-shoot or throw.
3. **Gun attack** (`11`, `33`): AP and the hit roll at the fire opcode, per round of a burst; the bullet then steps tile
   by tile against whoever stands there at that moment; damage at impact. The roll decides how the bullet flies, not
   whether it hits, so a target starting to fall moves the aim of the later rounds of a burst.
4. **Throw** (`34`): rolled at the order, launched at the release opcode; an NPC who sights something first aborts with
   no AP spent. **Melee** (`11`): resolved at the strike frame against whoever stands on the tile; the hit lands 20 ms
   later.
5. **Barrier** (D5; `10`, `33`; `InternalReduceAttackBusyCount`, `Tactical/Overhead.cc:5510`). While the busy count is
   above 0: no interrupts, noise deferred, no new AI situations. At 0, in this order: suppression, the consequences of
   the attack (an unseen attacker noticed, combat entry, NPC hostility), the end-of-attack sight check, the deferred
   noises with their interrupts, the end-of-battle check.
6. **Two-stage death** (`33`): life 0 at impact; corpse, items, kill credit and visibility at opcode 440, at the end of
   the death animation; until then the soldier holds his tile.
7. **Interrupts** (`10`): a deterministic duel, only at a tile centre after the step was paid; the largest margin acts
   first.
8. **Entering combat from real time** (`10`): the best sighting decides and may give the best observer an interrupt;
   everyone stops at a tile centre.
9. **Time-coupled effects** (`12`, `07`): an explosion blinds every LOS test until its animation ends and applies its
   whole radius at the keyframe; a roof climb blinds the map until its commit.

### 3.6 Randomness

**The original.** `Random` and `PreRandom` share one engine with presentation code (`sgp/Random.cc:7-90`; `mt19937` in
Stracciatella, MSVC `rand()` in vanilla). `PreRandom` reads a table of 256 pregenerated numbers at an index; both are
saved (`SaveLoadGame.cc:2110-2115`), so after a reload the next `PreRandom` draws repeat: a guard against save-scumming
the player can see. Stracciatella refills each slot after use; vanilla never does (`V:SGP/Random.c:61-65`), so its 256
numbers recycle forever. Cosmetic code (face blinks, idle animations, ambient sounds) draws from the same engine on
wall-clock time. Which mechanics draw `PreRandom` and which `Random` is player-visible and kept: the code makes each
draw where the original does, and each spec names the order of its draws.

**ja2-node** (`src/core/rng.ts`):
- `Rng`: xoshiro128** seeded through splitmix32 (32-bit operations, no BigInt), one draw per call mapped by
  multiply-shift; `int(0)` is 0 without a draw, as `Random(0)`. Bit-exact equality with `mt19937` is not a goal:
  formulas and draw order are compared, not number streams (deviations "Random numbers").
- `PreRandom`: a ring of 256 `u32` and an index; a used slot is refilled from its `Rng`, as in Stracciatella.
- **Streams**: `main` (an `Rng`) and `pre` (a `PreRandom` refilled from `main`), shared by the strategic and tactical
  state; cosmetic streams seeded from the session seed (`CosmeticStreams` in `src/sim/campaign/flow-state.ts`, the talk
  stream in `src/sim/narrative/talk-state.ts`), saved because a few cosmetic picks are stored in state. Draws that only
  pick a sound, a quote or a graphic are not made by the simulation; the browser makes them on its own generator
  (`src/audio/client-random.ts`; `deviations.md` §1).
- **Saves** write every stream; a player load reseeds `main` from a logged seed, as the original's load does in effect,
  and an exact load keeps it (`27` §1.5).
- Where an expression holds two draws in unsequenced operands, ja2-node evaluates them left to right (deviations "Dud
  test operand order"). Rules take their roll as a parameter where that keeps them pure (e.g. the throw resolution,
  `src/sim/tactical/explosions/throwing.ts`).

### 3.7 Dependency direction

The original's subsystems include each other cyclically (Tactical ↔ Strategic ↔ TileEngine) and call across layers
directly. In ja2-node dependencies point one way: the tactical layer calls interfaces the campaign installs
(`TacticalHooks`, `PerceptionHooks`, `TurnHooks` in `src/sim/tactical/state.ts`, the narrative port
`src/sim/tactical/narrative/port.ts`, the ports of `strategic/forces` and `strategic/economy`), so a kill reaches
morale, loyalty, militia, progress and quest facts without tactics calling strategy; the strategic event queue runs
handlers that the owning subsystems register by event kind (`15`). Autoresolve shares the tactical combat context
(`src/sim/tactical/combat/context.ts`), as the original reuses `BulletImpact`.

### 3.8 Decision prompts and speech (D15)

**Where the original waits for the player**, the simulation opens a decision prompt (id, kind, options): an interrupt in
the player's favour, a dialogue choice, an NPC's question, the pre-battle choice, a contract renewal, a story encounter.
Every `advance` stops on it (`decision`) and time stands still until the `answer` command; informational boxes are
events. Commands, prompts and refusals: `29`.

**Where the original waits for speech**, the simulation does not depend on audio: a line lasts the longer of its
sample's length and its text time, plus the closing pause with the mouth shut (`src/sim/narrative/dialogue-queue.ts`;
`24`, deviations "Speech"). Sample lengths come from the rule pack's voice lengths, not from audio; the viewer that
finished the line first ends it with `skipLine` (`29` §14). Logic the original holds until its quote queue is empty
(NPC hostility, some named NPCs' AI, notifications) waits on the same dialogue queue (`04` §3).

The simulation contains no `await` and no timer and never waits for a client. Logic the original keeps in screens
(laptop hiring, trading, drag-and-drop inventory, map assignments, repair, healing) is commands; the UI only collects
their parameters and shows the result, so an agent can do everything the UI can.

### 3.9 Game options and policy

The options model (`GameOptions`, `src/sim/options.ts`), its defaults, what each option changes in the original and the
client settings are `27` §2.

**Policy.** Stracciatella's policy files (`game.json`, `imp.json`, `strategic-ai-policy.json`, read by
`externalized/policy/`) ship in `data/externalized/` with their shipped values, which reproduce vanilla except the
enemy elite level range (§3.10). ja2-node reads the strategic, laptop and progress keys of `game.json`, `imp.json` and
the whole `strategic-ai-policy.json` (`src/content/strategic/`). The tactical keys (hit-chance limits, aim bonuses,
damage multipliers, interrupt rules, suppression, enemy weapon status and elite levels, drops, AI switches) are
constants at their shipped values in the rule modules (e.g. `ENEMY_ELITE_MINIMUM_LEVEL` in
`src/sim/tactical/creation.ts`, the suppression constants in `src/sim/tactical/combat/barrier.ts`): editing them in
`game.json` changes nothing. Stracciatella's Lua hooks (`externalized/scripting/ScriptingExtensionsLua.cc:429-444`)
serve mods only; the default game ships just `enums.lua`, so nothing is ported.

### 3.10 Where Stracciatella differs from vanilla

ja2-node follows the Stracciatella column (D1) unless `deviations.md` says otherwise.

| Area | Vanilla | Stracciatella |
|---|---|---|
| `PreRandom` | Never refilled; `n*range/RAND_MAX%range` | Refilled after each use; uniform mapping (§3.6) |
| AP debt | AP floored at 0 (`V:Tactical/Points.c:465-486`), refunding suppression debt | Debt down to −100 (`Tactical/Points.cc:488`) |
| Sight range | Light penalty applied inconsistently | Applied consistently (`OppList.cc:881`) |
| Movement noise | `UINT8` wraparound; an unreachable water branch | Fixed (`OppList.cc:3230`) |
| Hearing | Sleeping listener −5 | Disabled (`OppList.cc:3848`) |
| Gun hit chance | Bandaging worsens the wound penalty; barrel extenders wear on every shot | Bandaging helps; wear only on real shots. Kept: the agility dodge applies only against `QUEENMONSTER` (`Weapons.cc:1979`) |
| Next bleed | Integer division | Float division (`Soldier_Control.cc:8056`) |
| Carried weight | Strength halved with integer division | Minor fix (`Items.cc:843`) |
| Hidden bullets | 1 tile per step | 4 tiles per step (`LOS.cc:3155-3166`; ja2-node: 1 tile per tick) |
| Jam | Reserved bullets lost | Refunded (`Soldier_Ani.cc:1061-1073`) |
| Blast during a hit animation | The soldier keeps his non-interruptible hit animation | The blast knocks him down anyway (`Soldier_Control.cc:3254-3262`) |
| AI burst choice | Affordability without re-raise AP | Re-raise AP included (`DecideAction.cc:3245-3300`) |
| Enemy elites | Capped by difficulty like the others | Clamped to 6..10 (`enemy_elite_*`) and exempt from the cap: stronger elites (`Soldier_Create.cc:1131, 2152`) |
| Autoresolve | Stale damage; its replay helper restored the `PreRandom` index | Stale-damage fix (`Auto_Resolve.cc:2918`); the index is saved but never restored |
| Militia promotion | No fallback | Falls back to the next rank (`Town_Militia.cc:253, 289`) |
| Sleep need | An integer bug always adds 4 | Fixed (`Assignments.cc:2073, 5677, 6903`) |
| Flo's discount | Not on blades and launchers | Also on blades and launchers (`ShopKeeper_Interface.cc:2451, 2603`) |
| M.E.R.C. unlocks | Four hardcoded stages | `mercs-MERC-listings.json` (`Laptop/Mercs.cc:513, 1579`) |
| Window climbing, Dead is Dead, stat healing | Absent | Additions (`Soldier_Control.cc:5188-6202`; `27` §1.6; `enable_stat_healing`, off) |

---

## 4. Content and data (`content`)

### 4.1 Model

| | Logic content | Media |
|---|---|---|
| What | Items, weapons, profiles, animation scripts, structures, tilesets, maps, NPC records, locks, policies, the strategic map, text the rules measure | Sprites, fonts, sounds, music, video |
| Read by the simulation | Yes, through the rule pack (§4.2), in full before a session starts | Never; the client loads it lazily per screen or sector |

- **Shipped JSON** (§0): Stracciatella's tables in `data/externalized/`, the tables transcribed from the source code in
  `data/tables/`, the UI layouts in `data/layouts/` (§5.2); `32` §4 gives the rules, and each transcribed table names its source.
- **Imported only on the user's machine** (§4.3): `prof.dat`, `ja2bin.dat`, `ja2set.dat`, `ja2pal.dat`, maps, JSD,
  `.npc`, EDT, `Locks.bin`, and all media.

### 4.2 VFS, sources and the rule pack

**Layers**, highest priority first (`src/node/data-vfs.ts`): `data/` (the shipped JSON); the user's loose `Data` files;
the user's SLF archives in alphabetical order; the stub pack under the `stubs/` prefix, whose `aliases.json` maps the
original's paths onto stub files. Paths are normalized as in Stracciatella (case-insensitive, `\` → `/`); SLF reads are
lazy ranges. In the browser, `HttpVfsLayer` (`src/app/assets/`) builds the same `Vfs` from the server's asset manifest
(`04` §5.10).

**The rule pack.** The simulation never reads the VFS: at start the server builds a rule pack holding every file the
rules read, the few numbers they take from graphics (*graphic facts*: tileset frame geometry, explosion frame counts)
and every speech sample's length (*voice lengths*). Sessions load their content from the pack, which refuses any other
path, so no graphic and no sound is read by the rules. Its hash over the game data is the identity saves are bound to.
Contents, identity, cache and asset serving: `04` §5.10.

### 4.3 Importing the original

Decoders (`src/content/formats/`, one module per format, from SLF archives and STI pictures to maps, JSD structures,
`.npc` records, EDT text, WAV, Smacker and native saves) work on byte arrays without DOM or Node and run alike in Node
and the browser; the map module also writes `.dat` files, which the stub maps compile to. `pnpm cli inspect verify`
decodes every STI, PCX, TGA, JSD and map of the user's data. The server reads the logic content into the rule pack and
serves media through `/vfs`; STI decodes in the browser, because WebGL needs the colour indices. The data version
(English or a localized release) is detected like Stracciatella's guesser (`src/content/text/data-version.ts`) and is
separate from the display language (`31`). Native saves import into sessions (`14`).

### 4.4 Stubs

The stub pack is ja2-node's own content that runs the whole game without the original data. CI runs only on it, and
every feature must also work on it; its licence is in §0. Its logic (profiles, animation scripts, a tileset with its
structures, locks, NPC records, text) is written by hand without numbers or data from the original's binaries; its maps
are ASCII grids compiled into real `.dat` files, so stubs take the original's loading path; its media are generated
into the formats the engine reads. `pnpm stubs` (`stubs/build.ts`) builds it deterministically into `dist/stubs`;
contents, rules and gaps: `32` §1.

---

## 5. Presentation

### 5.1 Rendering

ja2-node's own layer on WebGL2 (`src/render`, D9): Canvas2D cannot do palette lookup and shading cheaply, Pixi or
Phaser would have to be fought for the depth and palette model, and WebGPU is not needed. Colour indices stay indices
on the GPU and the shader looks them up in palette rows (sprite and soldier palettes, shade levels, light colours);
multi-tile structures are cut into strips with their own depth, which yields "soldier behind a wall" without a software
z-buffer. Draw order, layers and shading are the original's (`05`), light levels the simulation's (`20`); frame
targets: `28` §11.

### 5.2 UI

The DOM-free `ui` layer (`src/ui`, D10): mouse regions, buttons, bitmap text and cursors with the original's semantics;
screens as controllers with view models over `PlayerView` and the hints, bound by JSON layouts (`data/layouts/original`,
one skin) whose coordinates come from the source's constants. Screens emit a draw list that `src/render/ui-draw` draws
on `/play`. Architecture: `28`; the screens: `30`.

### 5.3 Sound and video

Web Audio directly (`src/audio`): the client derives every sound from events, view frames and the animation sound
codes; the server computes the music mode, the browser picks and fades the tracks. Videos play through the Smacker
decoder of §0, paced by the audio clock. `31`.

---

## 6. Platform

### 6.1 Server

One Node process (`src/server`): Hono for HTTP, `ws` for the WebSocket, MCP over streamable HTTP. Each session sits
behind a `SessionHost`, in the server's thread or in a worker thread of its own; saves are files on the server with the
session's input log. The server listens on `127.0.0.1`, requires the token of `.ja2/token`, and takes game commands and
names from clients, never paths. All of it: `04` §5.

### 6.2 Agents

The MCP adapter (`src/server/mcp.ts`) speaks the same protocol through nine coarse tools; Claude Code connects with
`claude mcp add` to the local server. The tool descriptions carry every command, view field, event and refusal; `29`
gives the rules behind them.

### 6.3 Client

`/play` (`src/app/game`) plays the server's view frames back, turns input into commands and draws the `ui` layer and
the world; it never runs the simulation (`28` §3). Saves stay on the server; the launcher downloads and uploads them
(`32` §3). Browsers: current desktop Chrome and Firefox (the `e2e:browsers` suite runs both); touch input is not a goal.

---

## 7. Technologies

Versions are in `package.json`.

| Area | Choice | Why | Rejected |
|---|---|---|---|
| Language | TypeScript 7 (the native compiler), `strict`, `noUncheckedIndexedAccess` | Thousands of narrow integers and 400 fields on a soldier need types | Plain JS |
| Running TS in Node | Type stripping, so `erasableSyntaxOnly`: `as const` objects and unions instead of `enum`, no `namespace` | Server and tools run without a build step | ts-node, tsx |
| Client build | Vite (proxies `/api`, `/vfs`, `/ws`, `/mcp` to the server) | Fast reloads, workers | webpack |
| Server | Node, Hono with `@hono/node-server`, ws | Small and typed; Hono runs the same in Node and tests | Fastify, Socket.IO |
| Agent API | MCP (`@modelcontextprotocol/sdk`), input schemas in zod | Agents connect with no code of their own | REST alone |
| Tests | Vitest, Playwright | One language and config shared with Vite | Jest |
| Lint and format | Biome; any warning fails | One fast tool | ESLint + Prettier |
| Rendering, sound | WebGL2 and Web Audio, both direct | §5 | Pixi, Phaser, Canvas2D, WebGPU, Howler |
| Storage | Files on the server (saves, logs, caches); `localStorage` for client settings | State lives on the server | IndexedDB |
| Compression | `node:zlib` on the server; `fflate` for PNG in `content` | | |
| Packages | pnpm, one package | Strict dependencies | Workspaces |
| Not used | Game engines, ECS, UI frameworks in the game | 148 soldiers on a 160×160 grid need no ECS; rules read better on plain objects | bitECS, React |

---

## 8. Verification

| Level | What | Where |
|---|---|---|
| 1. Rules | Unit tests next to the code (Vitest) on the stub pack built once per run; tests that need the original data skip without `JA2_DATA_DIR` and run with `pnpm test:data` | CI, locally |
| 2. Formats | Decoders on stub fixtures; `pnpm cli inspect verify` over every original file | CI, locally |
| 3. Scenarios and reload | Headless scenarios (map, squad, seed, commands → assertions and event logs); `pnpm test:reload` reloads every test campaign at every input and requires the same event log and final snapshot, byte for byte | CI, locally |
| 4. Saves and replay | Snapshot round trips and migrations; each save carries its input log, and `pnpm cli replay <name>` must reproduce it byte for byte | CI, locally |
| 5. End to end | Playwright on the stubs (`tests/e2e`, screenshot goldens on stubs only), on the original data (`pnpm e2e:data`), pixel-exact in Chromium and Firefox (`pnpm e2e:browsers`); the campaign bot (`pnpm cli campaign`) plays a stub campaign through MCP alone | CI, locally |
| 6. **Oracle** | Comparison with native Stracciatella on the original data | Locally |
| 7. Performance | `pnpm cli bench` (enemy turn, real time, strategic, autoresolve, server, campaign, save); a smoke run in CI (`32` §2) | CI, locally |

**The oracle** (`tools/oracle/README.md`): `build.sh` builds a patched Stracciatella outside the repository; with
`JA2_ORACLE=<script>` it starts headless, loads a map or a save, runs scripted probes and prints JSONL; the compare
scripts run the same inputs through ja2-node, and `compare-all.sh` is the full regression gate. **Native save import**
(`14`): save in the native game at an interesting moment, load the `.sav` as a session and compare derived values
(hit chance, path cost, visibility, AI decisions) with the native build's dumps. `pnpm gates` picks the gates a change
can affect (`32` §2.6).

Every deliberate difference from the original is a row of `deviations.md`, everything not ported yet a row of
`gaps.md`.

---

## 9. Repository structure

```
ja2-node/
  index.html     the launcher                          LICENSE   SFI-SCLA, verbatim
  src/           one directory per layer (§2); env/ declares the globals the browser and Node share
  data/          externalized/ (Stracciatella's JSON, unchanged) · tables/ (transcribed) · layouts/ (UI layouts)
  stubs/         stub pack sources and generators → dist/stubs
  tools/         CLI, dev runner, gates, import check, transcribers, bench, campaign bot, oracle, spikes
  tests/         e2e suites (stubs, original data, browsers) and the shared test support
  docs/          this documentation
  reference/     third-party sources (gitignored)
```

The configuration (`package.json`, the tsconfigs, Biome, Vite, Vitest, the three Playwright configs, the CI workflow)
sits at the root and in `.github/`. Code conventions (no comments but the licence header, Node-runnable TypeScript,
integer helpers, tests next to the code): `CLAUDE.md`.

---

## 10. Documentation map

Files are `docs/NN-<name>.md`. Two kinds:
- **Product docs** (`01`, `04`, `27`–`29`, `32`) describe ja2-node's own design: the decisions, the contracts between
  layers, the server, saves, the UI layer, the agent API, the tooling.
- **Port specs** (`05`–`26`, `30`, `31`, `33`–`35`) are overviews of one subsystem of the original as ported: where it
  lives in the code, the design decisions the code cannot state, the original's quirks the code keeps (with the tests
  that pin them) and what is not checked against the native build. The formulas are in the code; each module's `@src`
  header names the Stracciatella functions it ports. Each spec names its siblings at the top.

| Doc | Scope |
|---|---|
| `01` architecture | This document: licensing and data, decisions D1–D16, layers, the simulation core's cross-cutting rules, the content model, verification, the repository |
| `04` time-and-server | Why the simulation runs on ticks, time drivers and `advance`, view frames and playback, the server: sessions, protocol, player-view projection, session hosts, the rule pack and asset serving |
| `05` render-pipeline | Tactical world rendering: the original's layers, sweep order and z, shading, the camera and picking, ja2-node's WebGL2 renderer |
| `06` soldiers-animation | Animation states and scripts, the frame clock, sheets, turning, palettes and glow, profiles, creating soldiers |
| `07` structures-pathing-movement | Structures, movement costs, the path search, the AP and breath of a step, walking |
| `08` sight-and-noise | Line of sight, vision range, opplists, radio, noise and hearing, what the player knows |
| `09` ai-green-realtime | When the real-time AI runs, the alert status, the GREEN decision |
| `10` turn-based | Entering combat, team turns, AP, interrupts, the AI's turn, leaving combat |
| `11` attacks | Gun and melee attacks up to the impact: checks, AP, chance to hit, bullets through structures |
| `12` items-and-explosions | Items, inventories, reloading, first aid, world items, equipment, explosions, smoke, gas, flares |
| `13` combat-ai | The YELLOW, RED and BLACK decisions, attack, cover and flight searches, creatures |
| `14` savegames | Importing the original's savegames into sessions |
| `15` strategic-time | The world clock, compression, the event queue, a new game |
| `16` strategic-map-movement | Sectors, groups and squads, travel, encounters, sector transitions, what a sector keeps |
| `17` strategic-ai | The Queen, garrisons and patrols, difficulty and progress, the creature quest |
| `18` militia-loyalty-mines-assignments | Militia, loyalty, mines, SAM sites, finances, assignments and the hourly update |
| `19` autoresolve-pbi | The pre-battle interface, autoresolve, retreat, the strategic end of a battle |
| `20` lighting | Light templates and sprites, the true light level |
| `21` laptop-and-hiring | The laptop's sites, hiring and arrival, the laptop's part of a new game |
| `22` contracts-and-relationships | Contracts and renewals, departures, the daily merc update, relationships, reputation |
| `23` merchants | Dealers' stock, cash, prices, trading, repairs |
| `24` npcs-and-dialogue | NPC records, conversations, the dialogue queue, civilian quotes, recruiting and escorting |
| `25` quests-and-facts | Facts, quests, boxing, escorts and the robot, Skyrider, quest rules |
| `26` meanwhiles-and-ending | Meanwhile scenes, captures, the palace, the queens' deaths, the end of the campaign |
| `27` saves-and-options | ja2-node's saves (snapshot, file, content identity, input log, replay), game options, client settings |
| `28` player-ui | The player UI's architecture: the `ui` layer, the game page, the client's copy of the game, widgets, layouts, fonts, cursors, cursor hints, the stub skin, UI performance |
| `29` agent-api | The agent API by topic: transport, tools, commands, refusals, decisions, the player view, events, queries |
| `30` ui-screens | The original screens in the client: front end, tactical panels and input, map screen, battle entry, laptop, story |
| `31` sound-video-and-localization | Sound, music, speech, video, data versions and display languages |
| `32` stubs-and-performance | The stub pack, benchmarks and profiling, CI, test runs and gates, the launcher, data tables |
| `33` hits-and-damage | From a hit to the end of the attack: hit location, armour, damage, death, the busy count, suppression, morale, experience |
| `34` throwing-and-physics | Throws, launchers, item physics, duds |
| `35` npc-actions-and-schedules | NPC actions, NPC presence between sector loads, schedules, civilian groups, keys, locks and doors |
| `deviations.md` | Every deliberate difference from the original |
| `gaps.md` | Behaviour not ported yet, code that does not follow `CLAUDE.md` yet |
| `test-stability.md` | Tests that fail without a code change: rules and open cases |
| `releases.md` | Release notes |
| `tools/oracle/README.md` | The native oracle: build, probes, comparers |

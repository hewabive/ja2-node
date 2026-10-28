# 01 — Architecture

ja2-node reimplements Jagged Alliance 2 in TypeScript: the original's behaviour, not its code. This document holds the
decisions D1–D16, the layers, the simulation core's cross-cutting rules (state, time, animation timelines, randomness,
options), the content model, verification, the repository structure and the licensing rules; §10 maps the other
documents.

**Conventions.** Paths into the original are relative to `reference/stracciatella/src/game/` (`sgp/…` and
`externalized/…` to `reference/stracciatella/src/`); `V:` is vanilla (`reference/vanilla/ja2/Build/`). `R(n)` =
`Random(n)`, `PR(n)` = `PreRandom(n)`.

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
- Files derived from the original's logic carry a prominent change notice with the date (clause 4):
  ```ts
  // Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
  // Modified for ja2-node: reimplemented in TypeScript, <YYYY-MM-DD>. See LICENSE (SFI-SCLA).
  // @src <path in Stracciatella>
  ```
  Copyright and other notices stay (clause 1); Strategy First receives a royalty-free right to the modifications
  (clause 5); the warranty disclaimer and the liability limit pass on (clauses 7, 8).
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
| D13 | **The server is the source of truth**: sessions live in the Node process; the browser, MCP agents and scripts are equal clients of one protocol, through a `SessionHost` (`src/server/session-host.ts`): in process with 10 ms time slices, or one worker thread per session (§6.1) | State on the server, play through the API, replays and saves in one place |
| D14 | **A driver moves time; playback is separate**: `advance(until)` with stop conditions; real-time ×k, instant and manual drivers; the client plays the view frames back at any speed or skips them (§3.3) | Instant enemy turns and any speed-up without changing outcomes |
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
- `app` imports `sim` only to run the hint functions over the player-knowledge projection in the browser (`28` §2.4);
  the client never reimplements a rule and never feeds the simulation.
- The MCP adapter is part of `server` (`src/server/mcp.ts`); there is no agent layer.

---

## 3. Simulation core (`sim`)

### 3.1 API

```ts
interface Steppable {                              // src/sim/advance.ts
  readonly tick: number;
  readonly worldClock?: WorldTimeControl | null;   // campaigns: world time and compression
  isIdle(): boolean;                               // the turn is back with the player, every effect settled
  hasPendingDecision(): boolean;                   // a decision prompt is open
  step(): void;                                    // one 5 ms tick
  drainEvents(): SimEvent[];                       // tick-stamped facts since the last drain (src/sim/events.ts)
  ended?(): boolean;
}
interface SessionSim extends Steppable {           // src/server/session.ts
  dispatch(cmd: CommandEnvelope): CommandResult;   // rule check, then the state change or {ok: false, reason}
  view(): PlayerView;                              // the player-view projection (D16)
}
function advance(sim: Steppable, until: StopCondition, budget?: number): StopReport;
```

- **Implementations**: `TacticalSim` (`src/sim/tactical/tactical-sim.ts`: a sandbox or the loaded sector) and
  `CampaignSim` (`src/sim/campaign/campaign-sim.ts`: the strategic state plus the loaded sector).
- **`advance`** runs ticks until a stop condition (`idle`, `events`, `ticks`; for campaigns `worldTime`,
  `worldSeconds`, `compressionStopped`, `mode`); a decision prompt always stops it. Reasons: `idle`, `decision`,
  `event`, `ticks`, `budget`, `worldTime`, `refused`, `ended`, `timeout`. `AdvanceRun` is its resumable form, which the
  server slices without changing what a tick does (`04` §4.2, §5.9).
- **Commands** are intents (`move`, `attack`, `door`, `endTurn`, `route`, `aimHire`, `trade`, `talk`, `answer`, …;
  catalog in `29` and the tool descriptions of `src/server/mcp.ts`).
- **Events** are facts for presentation and agents; the simulation does not need them. The session records view frames
  every 10 ticks (changed soldiers plus the events and message entries of their ticks), from which a client rebuilds the
  picture at any speed or skips it (`29` §9).
- **Queries** (`estimateAttack`, the cursor hints, `quoteTrade`, `inventory`, …) run the rule functions the simulation
  uses, over the projection, and change nothing: the hit chance on screen is computed by the code that rolls it.

### 3.2 State

- **Two roots.** `StrategicState` (`src/sim/strategic/state.ts`): world clock and event queue, `rng` and `pre`, the game
  options, profiles, map, forces, the Queen, economy, merchants, contracts, laptop, narrative, roster, sector diffs, the
  flow (`strategic`, `tactical`, `autoresolve`, `laptop`) with the session, sector, shop and talk flow state, and the
  cosmetic streams. `TacticalState` (`src/sim/tactical/state.ts`): the loaded sector's world (map data, movement costs,
  structures), soldiers and merc slots, occupancy grids, doors, turn state, perception, lighting, items, bullets and
  effects. Options, profiles and random streams are the same objects in both; a sandbox has only a `TacticalState`.
- **Ids and references.** Soldier ids are the original's team-blocked ids (the `Menptr[]` indices); groups, items and
  sectors are numbered as in the original. Tactical objects refer to each other directly; the snapshot codec writes
  those references as paths to the object's home (`soldiers/<id>`, `items/<i>`, the structure lists) and content as
  content keys (`27` §1.2).
- **Grids** are typed arrays over the 25,600 tiles. The order of level nodes, structures and groups affects rendering
  and logic and is preserved.
- **Static and dynamic.** Map geometry is immutable content; what changed in a sector the squad left (doors,
  destruction, items, corpses, blood) is its `SectorDiff` (`src/sim/campaign/sector-diff.ts`), like the original's temp
  files.
- **Integer semantics.** Fixed-width fields go through `src/core/int.ts` (`u8`, `i8`, `u16`, `i16`, `u32`, `i32`; `idiv`
  truncates toward zero; `imod`), large products through `Math.imul`, `float` math through `Math.fround`. Overflows the
  original relies on are reproduced where the specs mark them (e.g. a `UINT8` overflowing before its clamp,
  `Tactical/Overhead.cc:5182`; a `UINT32` underflowing inside `max`, `Strategic/Game_Clock.cc:634`; bit-31 flags need
  `>>> 0`).
- **Determinism.** No `Math.random`, wall clock, timer (checked, §2) or mutable module state in `core`, `content`, `sim`
  and `ui`. Tables the original precomputes with C math are evaluated as it does (`gdRadiansForAngle` with glibc
  `sin`/`cos`, `src/sim/tactical/constants.ts`). Sight, bullets, throws and directions call `Math.sin`, `Math.cos` and
  `Math.atan2` where the original uses float trigonometry and round to float32; a last-ulp difference from C's `sinf`
  can rarely move a landing tile (`deviations.md` "Physics cadence and floats"). The reload and replay harnesses (§8)
  check that an outcome depends only on the seed and the inputs.

### 3.3 Time

**The original's clock.** Each rendered frame runs physics, the strategic turn, `UpdateBullets`, `ExecuteOverhead`, the
UI, the event queue and rendering (`GameScreen.cc:342-345, 424-427`). `ExecuteOverhead` runs at most every 5 ms
(`Utils/Timer_Control.cc:15`); for each soldier whose counter expired after `sAniDelay` ms (`Overhead.cc:669`) it runs
every opcode up to the next drawn frame (`:687`), the tile-step logic (`:717-1000`), `MoveMerc`, `TurnSoldier` and
`HandleSoldierAI` (`:1017-1053`). Counters re-arm from "now" and never catch up (`Timer_Control.cc:155-181`; vanilla
alike): a soldier advances at most one frame per pass, and a slow machine slows the game. `sAniDelay`
(`Soldier_Control.cc:4763-4918`, `06` §5.2) is halved in combat and doubled for stealth in real time; unseen soldiers in
combat get 0 and advance every pass (`:4928-4936`), so turn-based logic never depended on playback speed. Real time has
no action points, only breath (`Points.cc:462-465, 497-500`): actions take as long as their animations. Tactical game
time is in effect "animation frames played"; the wall clock only sets the pace.

**ja2-node**: a tick is one 5 ms overhead pass of game time on an ideal machine that never drops a frame; timers keep
their values (`deviations.md` §2 lists every change):

| Process | Original | ja2-node |
|---|---|---|
| Animation frame | `UpdateCounter` against `sAniDelay` ms of wall clock, re-armed from "now" | Game-ms deadline (`nextFrameAt`) checked every tick, same reset points |
| Bullet | One step per frame, at most every `bulletSpeed/10` ms (2–3 ms) (`LOS.cc:3155-3184`) | One tile per tick, the first inside `FireWeapon`; thrown knives every 30 ms (`11` §3.3) |
| Throw physics | Once per frame when the 20 ms counter is due (`Physics.cc:238-330`) | Every 20 game ms |
| Real-time AI | One soldier after more than 50 ms, more while less than 10 ms of CPU passed (`Overhead.cc:109-110, 1041-1052`); `AI_DELAY` 100 ms per soldier (`AIMain.cc:40`) | Every 55 game ms (strict `>` on 5 ms ticks), every AI slot after the cursor, no CPU slice (`09` §1.1) |
| Real-time turn (bleeding, breath, smoke, light and opplist decay) | Every 5000 ms × compression (`Strategic/Strategic_Turns.cc:30-84`, `Tactical/Tactical_Turns.cc:80-160`) | Checked every 20 game ms, fires after more than 5000: every 5020 ms (`src/sim/tactical/turns/turns.ts`) |
| Explosion damage | At a keyframe, 3–18 frames × 20–80 ms (`Explosion_Control.cc:205-209`) | Frame `k` at `k·(delay + 5)` game ms (`12` §10.2) |
| Melee hit, enemy sighted on their turn | 20 ms (`Weapons.cc:987`), 3000 ms (`OppList.cc:2588-2602`) of wall clock | The same in game ms |
| `DOOR_BUSY`, bomb queue (`1000 + R(500)` ms, `Explosion_Control.cc:2054-2095`) | Tile-animation and wall-clock windows | Not ported (`gaps.md` "Doors", "Duds and timed bombs") |
| Watchdogs: 15 s AI (`AIMain.cc:366-380`), 25 s UI busy (`Handle_UI.cc:405-419`) | Break hangs | Not ported: a hang is a bug and fails the tests |

**Time modes.** On the strategic map tactical ticks stop and world time runs at compression 0, 1×, 5, 30 or 60 minutes
per second. In tactical real time both run (5 ms of world time per tick, compressed where the original allows it). In
turn-based combat ticks run (animations, bullets, explosions) and world time is frozen, as in the original. A decision
prompt stops both until its `answer`.

**Drivers** (`04` §4.3): real time ×k (the server runs ticks by the wall clock and pauses at decision prompts; a human
in the browser), instant (advance to idle or a decision after every accepted command; enemy turns, tests), manual (only
explicit `advance` calls; agents, debugging). Turn-based combat gives the same outcome under every driver, real time
when commands arrive at the same ticks; ordering while paused is a small advantage the original's pause screen does not
allow. The client never runs the simulation: it plays the frames at 1×, faster, skipped, or "unseen at once".

### 3.4 Action timelines: animations as data

**The data.** `ja2bin.dat` holds `u16[320][100]` script codes per animation state (`src/content/formats/ja2bin.ts`):
below 399 frames (frame `code − 1`), 399–499 opcodes, 500–598 jumps in the script, 600–699 and 800–999 jumps to another
state, 700–799 sounds and a few opcodes (`Tactical/Soldier_Ani.cc:93-2547`, `:1939-1963`). The user's file has 308
non-empty scripts of 311 states with 144 distinct opcodes, 54 of them gameplay (`04` §1). `gAnimControl` (flags, speed,
non-interruptibility) is transcribed into `data/tables/anim-control.json`.

**Gameplay opcodes of the original** (lines of `Soldier_Ani.cc`; vanilla has the same set,
`V:Tactical/SoldierAni.c:176-2625`):

| Opcode | Effect |
|---|---|
| **430** (`:313`) | Fire: queues `EV_S_FIREWEAPON` for `FireWeapon` later in the frame (`Utils/Event_Pump.cc:238-260`); every gun, melee and launcher attack resolves here |
| 448, 449 (`:638`, `:748`) | Burst controller (stop at `ShotsPerBurst` or no ammo, jam roll on the first round, busy count −1 and back to aim on stop, turn to the next spread point); end of burst |
| 470, 473 (`:1048`, `:1134`) | Jam check; a jam skips frames, refunds the reserved bullets (Stracciatella, `:1061-1073`) and frees the attacker; improper fire end |
| **460/461** (`:849`) | Throw release: `DeductPoints` (the throw's AP), then `CreatePhysicalObject` |
| 458, 459; 468, 469, 485; 492 (`:1515`) | Switch hands (two pistols); end of punch, martial-arts follow-up, steal; dodge (the target stops, an AI target cancels its action) |
| 433 (`:342`); 447 (`:587`) | Collapse or fall below OKLIFE; search a free fall direction |
| **440** (`:422`), 465; 497 (`:1631`) | Death commit: corpse, kill and assist credit, target removal, visibility (`:2855-2996`); life 0; death-or-unconscious check, else `ReleaseSoldiersAttacker` |
| 721, 722 (`:2122`, `:2131`) | Fall sounds that also damage jars in the inventory (`CheckEquipmentForFragileItemDamage`, 20 / 15) |
| 403, 404, 411–413, 443, 445, 453, 455, 463; 406, 409, 410, 454, 456, 462, 466 | Sub-tile moves that can change `sGridNo`; `SetSoldierHeight`, which sets `bLevel` too |
| **408 / 475** (`:223` / `:1150`); 444, 450, 464 | Roof-climb commit (new tile and level, global sight back on, sight with interrupts); fence-hop commit with `SetOffBombsInGridNo`, landing forecast, end of a cliff climb |
| 402, 446, 471 | Pause one frame; pause-move on / off (they set how long a step takes) |
| 493 (`:1553`); **494, 495** (`:1571`, `:1589`) | Pick up (AP paid inside); open a structure or door; 495 also makes the door noise, re-inits the opplist and runs `AllTeamsLookForAll(TRUE)` (interrupts possible) and a new AI situation |
| 486, 487, 763; 481–484, 752, 754, 756, 760, 762, 769 | Give, drop, drop at a tile; cut a fence, wheelchair, plant a bomb, remote detonation, decapitation, pit fall, robot reload, blood from a corpse, set off a trigger, refuel |
| 755, 761 | Queen swipe and creature damage |
| 442, 772; 753, 757; 480 | End of non-interruptible (turn-based / real-time; 442 also busy count −1 for `STEAL_ITEM`); busy count −1 / +1; `ReleaseSoldiersAttacker` |
| **499** (`:1732`) | End of animation: frees an NPC's pending action, reaches the desired stance, releases a suppression stance change's busy count, sight with interrupts after a stance change, continues the path after a door, starts the pending animation |
| 434–437, 457, 472, 474, 476, 496, 498; 765, 768, 467, 758, 759 | State transitions (blood jumps, get-up, wake-up, previous or pending animation, stand, back to aim); flyback blood, stand up after first aid, helidrop path, slap triggers |
| 491 (`:1384`) | Random idle animation: draws from the shared generator and changes the state |

Purely visual or audio: 431, 438, 439, 441 (flash, shade, muzzle-flash light sprite; the visibility flag is separate),
451, 452, 477 (z-override, camera), 432, 479, 489, 490, 750, 751 (nothing), the sound codes 702–798 (785 draws `R(5)`).

**ja2-node.** `splitAnimationScripts` (`src/content/anim/timelines.ts`) splits the scripts at load into a **logic
timeline** (slot kinds and arguments: frame, opcode, no-op, jump, state) that the simulation steps and a **presentation
timeline** (sprite frames, sound codes) for the views and clients. The logic timeline keeps every opcode below 500 and,
of the 700s, 753, 755, 757, 761, 765, 768 and 772 (`isSimulationOpcode`). A soldier keeps `state`, `pc`, `frameSlot`
and `nextFrameAt`; views find the sprite by body, state, frame and direction. Movement opcodes run in
`src/sim/tactical/animation.ts`, the rest through the tactical hooks. Not run from the script: 491 (idle animations are
client-only, `06` §1.6), the jar damage of 721/722, and the 700s codes whose systems are gaps (`gaps.md`). The
stub pack has invented scripts for every state; clients with other scripts: `28`.

**Why markers stay in the simulation.** Paying AP and applying effects at command confirmation, with the animation as
mere visualization, would lose what happens between an order and its marker: an interrupt, an NPC's throw cancelled
before release without AP, map blindness during a roof climb, a burst at a falling target.

### 3.5 Protocols carried over exactly

The skeleton of tactics; its ordering is behaviour (details in the specs).

1. **Tile step** (`07` §4). At the centre, before leaving: breath check, fence or door branch, the step's AP and
   breath, next-tile check and real-time reservation, mine sense ahead, random hazards (gas 1 in 5, marbles, blind and
   drunk falls), then `DeductPoints`: paid before leaving (`Overhead.cc:1247-1630`). At the boundary the soldier moves
   to the new tile, so bullets now hit him there; the door behind closes; smell, water and gas apply
   (`Soldier_Control.cc:1881-2106`). At the new centre, strictly in order: breath collapse → mines → noise and noise
   interrupt → sight and sight interrupt → mine detection → new AI situation → arrival triggers
   (`Overhead.cc:1709-1960`).
2. **Turning**: one octant per frame, each with a sight check without interrupts; the AP is paid when the direction is
   set. A new sighting cancels an AI turn-to-shoot or throw.
3. **Gun attack** (`11`): ready or turn → fire opcode: AP and the `PR(100)` roll, per round of a burst (AP on the first
   only) → the bullet steps tile by tile against the *current* occupants and stance shapes → damage at impact → hit
   reaction (knockback, fall) → release. The roll yields `sHitBy` (straight trace or angular deviation), not hit or
   miss; in a burst, a target starting to fall moves the aim of later rounds.
4. **Throw**: rolled at the order (miss tile, force and angle fixed then); AP and launch at 460/461; an NPC who sights
   something first aborts it with no AP spent. Launchers roll at their 430 frame. **Melee**: at the strike frame,
   against whoever stands on the tile then; the hit lands 20 ms later.
5. **Barrier** (D5; `10` §5, `33` §3). While the busy count is above 0: no interrupts, noise deferred, no new AI
   situations. At 0 (`Overhead.cc:5510-5787`): suppression → attack consequences (unseen attacker noticed, combat
   entry, NPC hostility) → end-of-attack sight check → deferred noises with their interrupts → end-of-battle check.
6. **Two-stage death**: life 0 at impact; corpse, items, kill credit and visibility at opcode 440, at the end of the
   death animation; until then the soldier holds his tile.
7. **Interrupts** (`10` §4): a deterministic duel; only at a tile centre after the step was paid; the largest margin
   acts first.
8. **Entering combat from real time** (`10` §1): the best sighting decides and may give the best observer an interrupt;
   everyone stops at a tile centre.
9. **Time-coupled effects**: an explosion blinds every LOS test (`DISALLOW_SIGHT`) until its animation ends and applies
   its whole radius at the keyframe; a roof climb blinds the map until 408/475.

### 3.6 Randomness

**The original.** `Random` and `PreRandom` share one engine with presentation code (`sgp/Random.cc:7-90`): `mt19937`
with `std::uniform_int_distribution` in Stracciatella, MSVC `rand()` in vanilla. `PreRandom` (`sgp/Random.cc:78`) reads
a table of 256 pregenerated numbers at an index; both are saved (`SaveLoadGame.cc:2110, 2120`), so after a reload the
next ≤256 `PreRandom` draws repeat: a player-visible guard against save-scumming. Stracciatella refills each slot after
use; vanilla never does (the line is commented out, `V:SGP/Random.c:61-65`), so its 256 numbers recycle forever, and it
maps with `n*range/RAND_MAX%range`. Cosmetic code (face blinks, idle animations, ambient sounds) draws from the same
engine on wall-clock time. `R(0)` returns 0 without a draw (`sgp/Random.cc:65-71`); `Chance(p)` is `R(100) < p` and
always draws; `PreChance(p)` is `PR(100) < p`. Where an expression holds two draws in unsequenced operands, ja2-node
evaluates them left to right (e.g. the dud test, `deviations.md`).

**Which mechanics use which** (the specs give every draw in order; which draws are `PR` is player-visible and kept):
- `PR`: gun, melee and throw hit rolls; jams; weapon wear; the AI's hit-location roll; miss deviation; structure hits;
  the damage fluke; armour; critical hits; every skill check (lock picking, disarming, trap detection); stat gains
  (`Tactical/Campaign.cc:261, 336`); stealth noise; about 40 AI decisions (`TacticalAI/DecideAction.cc`); autoresolve;
  ambushes and bloodcat ambushes; creature town attacks; SAM shots at Skyrider; unhired mercs' deaths; explosion and gas
  damage; grenade duds; item damage; whether a map item exists (`Tactical/World_Items.cc:244`).
- `R`: enemy stats and gear, the Queen's evaluation timers and detection rolls, enemy sleep delays while travelling,
  militia promotions, dealer and Bobby Ray restocks, Pablo's theft, contracts and hiring, I.M.P. tie-breaks,
  civilian-murder blame, the weapon drop on a hit, real-time AI delays, NPC schedules.

**ja2-node** (`src/core/rng.ts`):
- `Rng`: xoshiro128** seeded through splitmix32 (32-bit operations, no BigInt); `int(n)` maps one 32-bit draw by
  multiply-shift (`scaleU32ToRange`), `int(0)` is 0 without a draw, `chance(p)` is `int(100) < p`. Bit-exact equality
  with `mt19937` is not a goal: formulas and draw order are compared, not number streams.
- `PreRandom`: a ring of 256 `u32` and an index; a used slot is refilled from its `Rng`, as in Stracciatella.
- **Streams**: `main` (an `Rng`) and `pre` (a `PreRandom` refilled from `main`), shared by the strategic and tactical
  state; cosmetic streams seeded from the session seed (`cosmetic.helicopter` and `cosmetic.autoresolve` in
  `src/sim/campaign/flow-state.ts`, the talk `fx` stream in `src/sim/narrative/talk-state.ts`), saved because a few
  cosmetic picks are stored in state. Draws that only pick a sound, a quote or a graphic are not made by the simulation;
  the browser makes them on its own generator (`src/audio/client-random.ts`; `deviations.md` §1).
- **Saves** write `main`, `pre` (ring, index, refill link) and every cosmetic stream; `Rng.restore` restores a stream in
  place. A player load reseeds `main` from a logged seed, as the original's load does in effect; an exact load keeps it
  (`27` §1.5).
- Gameplay draws keep the original's order on `main` and `pre`. Rules take their roll as a parameter where that keeps
  them pure (e.g. the throw resolution, `src/sim/tactical/explosions/throwing.ts`).

### 3.7 Module map

The original's subsystems include each other cyclically (Tactical ↔ Strategic ↔ TileEngine) and call across layers
directly. In ja2-node dependencies point one way: the tactical layer calls interfaces the campaign installs
(`TacticalHooks`, `PerceptionHooks`, `TurnHooks`, the narrative port `src/sim/tactical/narrative/port.ts`, the ports
of `strategic/forces` and `strategic/economy`), so a kill reaches morale, loyalty, militia, progress and quest facts
without tactics calling strategy. Autoresolve shares the tactical combat context (`src/sim/tactical/combat/context.ts`),
as the original reuses `BulletImpact`.

```
sim/                    advance.ts · clock.ts · events.ts · options.ts · command.ts
sim/campaign            CampaignSim; flows (sector, battle, shop, talk, laptop, helicopter, meanwhile, endgame), roster,
                        hiring, finances, morale, sector diffs; contracts/ relations/ laptop/ narrative/
sim/strategic/time      world clock, event queue, environment (day light, temperature)
sim/strategic/map       sectors, control, strategic A*, travel, SAM sites, plotting
sim/strategic/forces    groups, squads, movement, encounters, pre-battle, autoresolve/, helicopter, vehicles
sim/strategic/ai        the Queen
sim/strategic/creatures creature spreading, town attacks
sim/strategic/economy   loyalty, mines, militia, assignments, merchants/
sim/strategic/narrative facts and CheckFact, quests, NPC presence, hourly and 04:00 handlers, civilian groups
sim/narrative           NPC records and their selection, ConverseFull, the dialogue queue, civilian quotes, giving
sim/tactical            TacticalSim; soldiers and creation, the animation executor, movement, pathfinding, points,
                        inventory and items, roofs, smell, edgepoints, insertion, native save import
sim/tactical/turns      team turns, the AI list, turn state (the busy count)
sim/tactical/perception LOS, sight and opplists, noise and hearing, the interrupt duel, fog of war
sim/tactical/combat     hit chance, bullets, impact, armour, melee, bursts, death, bleeding, morale, experience, barrier
sim/tactical/explosions throws and physics, explosions, blast, structure and item damage, smoke and gas, flares
sim/tactical/lighting   light sprites, true light level
sim/tactical/doors      locks, keys, traps, the door table
sim/tactical/ai         alert ladder, green to black decisions, attack choice, cover, creatures, named NPCs, schedules
sim/tactical/narrative  NPC action catalog, schedules, boxing, team changes, escorts, robot, quest items
sim/knowledge, hints    player-knowledge projection; hint functions over it (D16)
sim/items, snapshot     the object model; the snapshot codec and its migrations
```

### 3.8 Decision prompts and speech (D15)

**Where the original waits for the player**, the simulation opens a decision prompt (id, kind, options): an interrupt in
the player's favour, a dialogue choice, an NPC's question, the pre-battle choice, a contract renewal, a story encounter.
Every `advance` stops on it (`decision`) and time stands still until the `answer` command; informational boxes are
events. Commands, prompts and refusals: `29`.

**Where the original waits for speech**, the simulation does not depend on audio: a line lasts the longer of its
sample's length (speech on) and 60 ms per character (speech off: `FindDelayForString`, `TEXT_DELAY_MODIFIER`), plus the
final 300 ms with the mouth closed (`SetupFinalTalkingDelay`; `src/sim/narrative/dialogue-queue.ts`). Sample lengths come
from the rule pack's voice lengths, not from audio; the viewer that finished the line first ends it with `skipLine`
(`29` §14). The dialogue queue covers the places where the original waits for an empty quote queue (NPC hostility,
some named NPCs' AI, notifications; `OppList.cc:559`, `AIMain.cc:281`, `Overhead.cc:840, 6205`).

The simulation contains no `await` and no timer and never waits for a client. Logic the original keeps in screens
(laptop hiring, trading, drag-and-drop inventory, map assignments, repair, healing) is commands; the UI only collects
their parameters and shows the result, so an agent can do everything the UI can.

### 3.9 Game options, difficulty and policy

The options model (`GameOptions`, `src/sim/options.ts`: `difficulty`, `sciFi`, `gunNut`, `saveMode`, `bloodAndGore`), its
defaults, the client settings and the save modes are in `27` §1.6 and §2. What the options change in the original:

| Option | Effect (main sites) |
|---|---|
| Difficulty (easy 1, medium 2, hard 3; vanilla's enum has unused 0 and 4) | `CalcDifficultyModifier` (`Tactical/Soldier_Create.cc:1035-1110`, 0..100 with progress and palace distance) feeding enemy equipment, to-hit, radio and cover range; enemy radio sightings (`OppList.cc:713`); enemy level cap 6/7/8 (`Soldier_Create.cc:2155`); enemy to-hit −5 on easy (`Weapons.cc:2170`); easy throw targeting (`TacticalAI/Attacks.cc:754`); mine bonus steps 25/20 (`Strategic_Mines.cc:86`); every `strategic-ai-policy.json` triple, garrison drops, extra reinforcements `/(6−diff)`, elite share `+5·diff`%, counterattack sizes, the Queen waking after `5−diff` victories (`Strategic_AI.cc:162-2861`) or on hard after the first battle (`Meanwhile.cc:446`); ambush and bloodcat formulas, creature rates (`Creature_Spreading.cc:196-403`); terrorist toughness ×1, 1.3, 1.6 (`Soldier_Profile.cc:253-425`); starting cash, kills per progress point, unhired-death caps, inactivity tolerance |
| Sci-fi | Creatures (`Creature_Spreading.cc:901`), extra NPCs (`Game_Init.cc:78`), item sets (`World_Items.cc:249`), enemy regeneration boosters (`Inventory_Choosing.cc:1361`), quest counts (`Quests.cc:1165`) |
| Gun nut | `ItemIsLegal` (`Items.cc:221`), standard replacements (`Soldier_Profile.cc:161`, `World_Items.cc:272`, `Soldier_Create.cc:1535`), the extended army gun table |
| Save mode | Iron Man: no saving in combat or with enemies present (`GameSettings.cc:233`). Dead is Dead (Stracciatella): one autosave slot at turn boundaries (`TeamTurns.cc:154`), loading refused (`SaveLoadGame.cc:647`) |
| Timed turns | Removed from the game init screen in Gold (`27` §2.1); not ported |

**Policy.** `gamepolicy()` reads `game.json` (`externalized/policy/GamePolicy.h`), `saipolicy_by_diff()` reads
`strategic-ai-policy.json`, whose values equal vanilla's `#define`s. Lua hooks exist
(`externalized/scripting/ScriptingExtensionsLua.cc:429-444`) but only `enums.lua` ships: no mods, nothing ported. The
`game.json` keys that change rules (the rest are UI switches): combat `chance_to_hit_minimum`/`_maximum`, `aim_bonus_*`,
`range_penalty_silencer`, `range_bonus_barrel_extender`, `tactical_head_damage_multiplier`,
`tactical_legs_damage_multiplier`, `fixed_cost_to_shoot`, `suppression_fire_modifier`,
`suppression_fire_reaction_threshold`, `multiple_interrupts`, `interrupt_after_being_under_fire`, `can_enter_turnbased`;
enemies and items `enemy_weapon_minimal_status`, `enemy_elite_minimum_level`/`_maximum_level`, `drop_everything`,
`all_drops_visible`, `extra_attachments`; squad and doors `squad_size`, `diagonally_interactable_doors`; AI `ai.*`;
strategic and laptop `starting_cash_*`, `merc_online_*`, `unhired_merc_deaths_*`, `progress.*`, `enable_stat_healing`,
`campaign.start_sector`, `pablo_wont_steal`, `imp.*`. The shipped values reproduce vanilla except the elite level range
(§3.10).

ja2-node reads the strategic, laptop and progress keys from `data/externalized/game.json` (`src/content/strategic/`:
`policy.ts`, `economy-content.ts`, `laptop-content.ts`, `army.ts`) and the whole `strategic-ai-policy.json`. The tactical
keys are constants at their shipped values in the rule modules (e.g. `ENEMY_ELITE_MINIMUM_LEVEL` in
`src/sim/tactical/creation.ts`, the suppression constants in `src/sim/tactical/combat/barrier.ts`): editing them in
`game.json` changes nothing.

### 3.10 Where Stracciatella differs from vanilla

ja2-node follows the Stracciatella column (D1) unless `deviations.md` says otherwise.

| Area | Vanilla | Stracciatella |
|---|---|---|
| `PreRandom` | Never refilled; `n*range/RAND_MAX%range` | Refilled after each use; uniform mapping (§3.6) |
| AP debt | AP floored at 0 (`V:Tactical/Points.c:465, 483-486`), refunding suppression debt | Debt down to −100 (`Tactical/Points.cc:488`) |
| Sight range | Light penalty applied inconsistently | Applied consistently (`OppList.cc:881`) |
| Movement noise | `UINT8` wraparound; an unreachable water branch | Fixed (`OppList.cc:3230`) |
| Hearing | Sleeping listener −5 | Disabled (`OppList.cc:3848`) |
| Gun hit chance | Bandaging worsens the wound penalty; barrel extenders wear on every shot | Bandaging helps; wear only on real shots. Kept: the agility dodge applies only against `QUEENMONSTER` (`Weapons.cc:1979`) |
| Next bleed | Integer division | Float division (`Soldier_Control.cc:8056`) |
| Carried weight | Strength halved with integer division | Minor fix (`Items.cc:843`) |
| Hidden bullets | 1 tile per step | 4 tiles per step (`LOS.cc:3155-3184`; ja2-node: 1 tile per tick) |
| Jam | Reserved bullets lost | Refunded (`Soldier_Ani.cc:1061-1073`) |
| Hits during a non-interruptible animation | Swallowed by `fInNonintAnim` | Patched (`Soldier_Control.cc:3254-3262`) |
| AI burst choice | Affordability without re-raise AP | Re-raise AP included (`DecideAction.cc:3245-3300`) |
| Enemy elites | Capped by difficulty like the others | Clamped to 6..10 (`enemy_elite_*`) and exempt from the cap: stronger elites (`Soldier_Create.cc:1131, 2152`) |
| Autoresolve | Stale damage; its replay helper restored the `PreRandom` index | Stale-damage fix (`Auto_Resolve.cc:2918`); the index is saved but never restored |
| Militia promotion | No fallback | Falls back to the next rank (`Town_Militia.cc:253, 289`) |
| Sleep need | An integer bug always adds 4 | Fixed (`Assignments.cc:2073, 5677, 6903`) |
| Flo's discount | Not on blades and launchers | Also on blades and launchers (`ShopKeeper_Interface.cc:2451, 2603`) |
| M.E.R.C. unlocks | Four hardcoded stages | `mercs-MERC-listings.json` (`Laptop/Mercs.cc:513, 1579`) |
| Window climbing, Dead is Dead, stat healing | Absent | Additions (`Soldier_Control.cc:5188-6202`; §3.9; `enable_stat_healing`, off) |

---

## 4. Content and data (`content`)

### 4.1 Model

| | Logic content | Media |
|---|---|---|
| What | Items, weapons, profiles, animation scripts, structures, tilesets, maps, NPC records, locks, policies, the strategic map, text the rules measure | Sprites, fonts, sounds, music, video |
| Read by the simulation | Yes, through the rule pack (§4.2), in full before a session starts | Never; the client loads it lazily per screen or sector |

- **Shipped JSON** (§0): Stracciatella's tables in `data/externalized/` (items, weapons, army, strategic map, dealers,
  strings in eight languages, …); the tables transcribed from the source code in `data/tables/` (`anim-control`,
  `anim-surfaces`, `tiles`, `door-costs`, `item-tables` with attachments and merges, `town-loyalty`, `merchant-tables`,
  `sound-effects`, `l10n`, `ui-constants`, …); the UI layouts in `data/layouts/` (§5.2).
- **Imported only on the user's machine** (§4.3): `prof.dat`, `ja2bin.dat`, `ja2set.dat`, `ja2pal.dat`, maps, JSD,
  `.npc`, EDT, `Locks.bin`, and all media.

### 4.2 VFS, sources and the rule pack

**Layers**, highest priority first (`src/node/data-vfs.ts`): `data/` (the shipped JSON); the user's loose `Data` files;
the user's SLF archives in alphabetical order; the stub pack under the `stubs/` prefix, whose `aliases.json` maps the
original's paths onto stub files. Paths are normalized as in Stracciatella (case-insensitive, `\` → `/`). The SLF index
maps each path to its offset and length; reads are lazy ranges. In the browser, `HttpVfsLayer` (`src/app/assets/`)
builds the same `Vfs` from the server's asset manifest and fetches content-hash URLs `/vfs/@<hash>/<path>` that the HTTP
cache keeps (`04` §5.10).

**The rule pack** (`src/content/rules/pack.ts`, `src/server/rule-pack.ts`). The simulation never reads the VFS: at start
the server builds a rule pack from it, holding every file the simulation reads (project tables, animation scripts,
`ja2set.dat`, `prof.dat`, locks, maps, structure files, NPC records, text files, stub profiles), the few numbers it takes
from graphics as *graphic facts* (tileset frame geometry and app data, explosion frame counts) and every speech sample's
length as *voice lengths*. Sessions load their content from the pack, which refuses any other path, so no graphic is
read by the rules. It is cached in `.ja2/cache/rules-<hash>/` and never committed. Its hash over the game data (the
user's data, or the stub pack on the stubs; never the tables that ship with the engine) is the logic hash saves are
bound to; `welcome` names it, so a client building the rules from its own assets can check it has the server's.

### 4.3 Importing the original

Decoders (`src/content/formats/`) work on byte arrays without DOM or Node and run alike in Node and the browser;
`pnpm cli inspect verify` decodes every STI, PCX, TGA, JSD and map of the user's data.

| Format | Module | Becomes |
|---|---|---|
| SLF | `slf.ts` | VFS layer (`src/node/slf-layer.ts`) |
| STI (8-bit ETRLE, 16-bit RGB565); PCX, TGA, PNG, COL | `sti.ts`, `etrle.ts`, `rgb565.ts`; `pcx.ts`, `tga.ts`, `png.ts`, `col.ts` | Pictures (frames, offsets, indices, palette, aux data), palettes |
| Map `.dat` (versions 5.00–6.00/26; read and write) | `map.ts` | `MapDef` |
| `ja2set.dat` + the tile table | `ja2set.ts`, `data/tables/tiles.json` | Tilesets |
| JSD | `jsd.ts` | Structures: 5×5 profiles, armour, density, destruction partners |
| `prof.dat` (XOR); `ja2pal.dat` | `prof.ts`; `ja2pal.ts` | Merc profiles; body palettes |
| `ja2bin.dat` + `gAnimControl` | `ja2bin.ts`, `src/content/anim/` | Timelines (§3.4) |
| `.npc`, EDT, `Locks.bin`, LHT | `npc.ts`, `edt.ts`, `locks.ts`, `lht.ts` | NPC records; text with the record layout of the data version; locks; light templates |
| WAV (PCM, IMA ADPCM), `.gap`, ambient; SMK (Smacker 2); credits | `wav.ts`, `gap.ts`, `ambient.ts`; `smk.ts`; `credits.ts` | Audio, lip-sync gaps, ambient sounds; video; credits rows |
| Native `.sav` | `savegame*.ts` | Session import (`14`) |

The server imports the logic content and serves media through `/vfs`; STI decodes in the browser, because WebGL needs
the colour indices. The data version (English or a localized release) is detected like Stracciatella's guesser
(`src/content/text/data-version.ts`; `JA2_DATA_VERSION` overrides) and is separate from the display language (`31` §3).

### 4.4 Stubs

The stub pack is ja2-node's own content that runs the whole game without the original data; CI runs only on it, and
every feature must also work on it; its licence is in §0. `pnpm stubs` (`stubs/build.ts`) builds it deterministically
into `dist/stubs` (contents and gaps: `32` §1):
- **Logic**, written by hand without numbers or data from the original's binaries: profiles (`stubs/profiles.json`),
  invented animation scripts for every state, a stub tileset with its structures, locks, NPC records and text
  (`stubs/npc/`, `stubs/text/`).
- **Maps** as an ASCII grid with a legend (`stubs/maps/*.map.txt`), compiled into real `.dat` files so stubs take the
  original's loading path; a handful of generic maps stand in for every sector by kind (town, mine, cave, army camp,
  airfield; `stubs/maps/sector-kinds.json`).
- **Media** generated into the formats the engine reads: PNG plus JSON for tiles and soldier sheets; STI for the UI art,
  cursors, faces and the two bitmap fonts ("Stub Pixel"); WAV sounds, music and speech blips synthesized from noise and
  tone envelopes with a seeded generator; EDT text; a Smacker splash.

---

## 5. Presentation

### 5.1 Rendering

ja2-node's own layer on WebGL2 (`src/render`): Canvas2D cannot do palette lookup and shading cheaply, Pixi or Phaser
would have to be fought for the depth and palette model, and WebGPU is not needed. Colour indices live in R8 atlases and
texture arrays, palettes in an RGBA texture with one row per combination of sprite palette, soldier palette (skin, hair,
vest, pants), shade level and light colour; the shader looks the colour up and discards index 0. Each quad's depth comes
from the original's z-level formula; multi-tile structures are cut into vertical strips with their own depth, which
yields "soldier behind a wall" without a software z-buffer. Draw order, layers, shadows, translucency and shading are
the original's (`05`), light levels the simulation's (`20`). The tactical view works at any resolution; the 640×480
screens scale by an integer UI scale. Target: 60 FPS at 1920×1080.

### 5.2 UI

The DOM-free `ui` layer (`src/ui`, `28`): mouse regions with the original's `MouseSystem` semantics, buttons, bitmap text
with the original's wrap and colour rules, cursors, popups, message boxes, sliders, text fields; screens as controllers
with view models over `PlayerView` and the hints, bound by JSON layouts (`data/layouts/original`, one skin) whose
coordinates come from the source's constants. Screens (`src/ui/screens`): front end (main menu, game init, options,
save/load, credits, loading), tactical (panels, inventory, input), map screen, battle entry, laptop, shop, talk, story,
help. They emit a draw list that `src/render/ui-draw` draws into a logical framebuffer on `/play`.

### 5.3 Sound and video

Web Audio directly (`src/audio`, `31` §1): the original's 16 voices, linear panning by screen X, the sample rate of the
device context, unlocked by the first user gesture. The client derives every sound from events, view frames and the
animation sound codes; the server computes the music mode, the browser picks and fades the tracks. Video (`31` §2): the
Smacker intro and ending videos through a decoder written from the format description, a WebGL player paced by the
audio clock; cutscenes can be skipped.

---

## 6. Platform

### 6.1 Server

One Node process (`src/server`, `04` §5): Hono for HTTP (`/api/*`, `/vfs/*`, `/login`, the built client), `ws` for the
WebSocket (`/ws`), MCP over streamable HTTP (`/mcp`). Sessions (at most 16, `JA2_MAX_SESSIONS`) each sit behind a
`SessionHost`: `inprocess` (default) runs a session's inputs in arrival order and slices long advances into 10 ms pieces,
one slice per event-loop turn across sessions; `worker` (`JA2_SESSION_HOST=worker`) runs each session in its own
`worker_threads` worker at the cost of a content load per session (`04` §5.9). The real-time driver runs ticks in
batches by wall time × k, broadcasts view frames and pauses at decision prompts. Saves (`27` §1) are `.j2s` files on the
server (a gzipped session snapshot with a header the save list reads) with the session's input log; saving draws
nothing and changes nothing. The server listens on `127.0.0.1` and requires the token of `.ja2/token`; clients send game
commands and names, never paths.

### 6.2 Agents

The MCP adapter (`src/server/mcp.ts`) speaks the same protocol through nine tools: `status`, `observe`, `act`,
`advance`, `newSession`, `save`, `load`, `listSaves`, `deleteSave`. Queries and prompt answers are `act` commands;
`observe` returns the JSON player view with labels in the session's language; events arrive with `advance`. Claude Code
connects with `claude mcp add` to the local server. The agent API: `29`.

### 6.3 Client

`/play` (`src/app/game`) runs one `requestAnimationFrame` loop: input to the modal stack and the current screen →
playback advances → events (sound, speech, message log, screen reactions) → view models → draw list → WebGL. Playback
follows the server's frames at the chosen speed; input that would act is locked while playback catches up, as the
original locks the UI during actions. Pointer and key events hit-test widgets, then the world (tile picking with the
original's inverse projection, levels and roofs), and become commands; hotkeys come from tables. Saves stay on the
server; the launcher downloads and uploads them. Browsers: current desktop Chrome and Firefox (the `e2e:browsers` suite
runs both); touch input is not a goal.

---

## 7. Technologies

| Area | Choice | Why | Rejected |
|---|---|---|---|
| Language | TypeScript 7 (native compiler), `strict`, `noUncheckedIndexedAccess` | Thousands of narrow integers and 400 fields on a soldier need types | Plain JS |
| Running TS in Node | Type stripping, so `erasableSyntaxOnly`: `as const` objects and unions instead of `enum`, no `namespace` | Server and tools run without a build step | ts-node, tsx |
| Client build | Vite 8 (proxies `/api`, `/vfs`, `/ws`, `/mcp` to the server) | Fast reloads, workers | webpack |
| Server | Node ≥ 24.11, Hono 4 with `@hono/node-server`, ws 8 | Small and typed; Hono runs the same in Node and tests | Fastify, Socket.IO |
| Agent API | MCP (`@modelcontextprotocol/sdk` 1.32), input schemas in zod 4 | Agents connect with no code of their own | REST alone |
| Tests | Vitest 5, Playwright 1.64 | One language and config shared with Vite | Jest |
| Lint and format | Biome 2.5; any warning fails | One fast tool | ESLint + Prettier |
| Rendering, sound | WebGL2 and Web Audio, both direct | §5 | Pixi, Phaser, Canvas2D, WebGPU, Howler |
| Storage | Files on the server (saves, logs, caches); `localStorage` for client settings | State lives on the server | IndexedDB |
| Compression | `node:zlib` on the server; `fflate` for PNG in `content` | | |
| Packages | pnpm 11, one package | Strict dependencies | Workspaces |
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
(`14` §10): save in the native game at an interesting moment, load the `.sav` as a session and compare derived values
(hit chance, path cost, visibility, AI decisions) with the native build's dumps. `pnpm gates` picks the gates a change
can affect (`check`, `data`, `reload`, `oracle`, `e2e`, `e2e:data`, `e2e:browsers`).

**Deliberate deviations** are listed in `deviations.md`: wall clocks, frame rates and CPU slices become game time
(§3.3), sound lengths rule-pack numbers (§3.8), screens and message boxes commands and prompts (D15); cosmetic draws
leave the gameplay generators (§3.6); saving has no side effects; watchdogs are not ported; in real time orders can be
given while paused; bugs are fixed as Stracciatella fixes them. What is not ported yet is listed in `gaps.md`.

---

## 9. Repository structure

```
ja2-node/
  package.json pnpm-workspace.yaml tsconfig.json tsconfig.base.json biome.json vite.config.ts vitest.config.ts
  playwright.config.ts playwright.data.config.ts playwright.browsers.config.ts .github/workflows/ci.yml
  index.html     the launcher                          LICENSE   SFI-SCLA, verbatim
  src/
    env/         universal.d.ts: globals shared by the browser and Node (TextEncoder, TextDecoder)
    core/        rng.ts int.ts sha256.ts
    content/     anim/ audio/ binary/ formats/ items/ narrative/ picture/ rules/ strategic/ text/ vfs/ world/
    node/        VFS over the disk (directories, SLF), the data stack, token, repository paths, client pages
    sim/         advance.ts clock.ts events.ts options.ts campaign/ strategic/ tactical/ narrative/ knowledge/ hints/
                 items/ snapshot/
    protocol/    messages, view frames, music mode, refusals, asset manifest types
    server/      main.ts app.ts ws.ts mcp.ts session*.ts worker-host.ts rule-pack.ts save-*.ts input-log.ts replay.ts …
    ui/          draw list, widgets/ layout/ text/ input/ cursors/ screens/ saves/ client/
    render/      atlases, palettes, sprite renderer, world/ ui-draw/
    audio/       engine, sound director, music, positional sound
    app/         game/ (/play) launcher/ net/ assets/ rules/ hints/ tactical/ map/ laptop/ battle/ world/ sound/
                 video/ credits/ media/
    devtools/    asset-browser/ map-viewer/ tactical/ strategic/ laptop/ ui-gallery/ video/
  data/          externalized/ (Stracciatella's JSON, unchanged) tables/ (transcribed) layouts/ (UI layouts)
  stubs/         stub pack sources and generators → dist/stubs
  tools/         cli.ts dev.ts gates.ts check-imports.ts replay.ts bench/ campaign-bot/ transcribe/ oracle/ spikes/
  tests/         e2e/ e2e-data/ e2e-browsers/ support/
  docs/
  reference/     third-party sources (gitignored)
```

Code conventions (no comments but the licence header, Node-runnable TypeScript, integer helpers, tests next to the
code): `CLAUDE.md`.

---

## 10. Documentation map

Files are `docs/NN-<name>.md`.

| Doc | Scope |
|---|---|
| `01` architecture | This document: decisions, layers, the simulation core's cross-cutting rules, content model, verification, repository, licensing |
| `04` time-and-server | Time model and drivers, playback, the server, sessions and hosts, the protocol, the player-view projection, the rule pack and asset serving |
| `05` render-pipeline | How the original draws the tactical map: order, z, shading |
| `06` soldiers-animation | Animation surfaces, frames, palettes, frame timing, profiles, soldier creation |
| `07` structures-pathing-movement | Structures, movement costs, pathfinding, the walking protocol |
| `08` sight-and-noise | Line of sight, vision range and opplists, noise and hearing, light for vision, fog of war |
| `09` ai-green-realtime | Green-alert AI and the real-time AI cadence |
| `10` turn-based | Entering combat, team turns, AP, interrupts, the busy count, the AI turn, leaving combat |
| `11` attacks | Gun and melee attacks: the order, AP costs, chance to hit, bullets and what they pass through, the RNG order of a shot |
| `12` items-and-explosions | Items and inventory, reloading, world items, enemy equipment, explosions, smoke and gas |
| `13` combat-ai | Yellow, red and black decisions, attack choice, cover, creatures and bloodcats |
| `14` savegames | The native savegame format and its import |
| `15` strategic-time | Strategic clock, event queue, periodic updates, new game initialisation |
| `16` strategic-map-movement | Strategic map, groups and squads, travel, encounters, sector transitions and persistence |
| `17` strategic-ai | The Queen, the difficulty modifier and progress, strategic creatures and bloodcats |
| `18` militia-loyalty-mines-assignments | Militia, town loyalty, mines, SAM sites, assignments |
| `19` autoresolve-pbi | The pre-battle interface and autoresolve |
| `20` lighting | Tactical lighting: light sprites, true light level |
| `21` laptop-and-hiring | A.I.M., M.E.R.C., I.M.P., Bobby Ray's, email, finances, insurance; a new game |
| `22` contracts-and-relationships | Contracts, renewals, departures, relationships, reputation |
| `23` merchants | Dealers' stock, prices, trading, repairs |
| `24` npcs-and-dialogue | NPC records, conversations, the dialogue queue, civilian quotes, recruiting |
| `25` quests-and-facts | Facts, quests, boxing, escorts and the robot, Skyrider, quest-specific campaign rules |
| `26` meanwhiles-and-ending | Meanwhile scenes, prisoners, Meduna, the end of the campaign |
| `27` saves-and-options | Saves (snapshots, files, the input log), game options and client settings |
| `28` player-ui | The player UI's architecture: the `ui` layer, the client's copy of the game, widgets, layouts, fonts, cursors, cursor hints, the stub skin, UI performance |
| `29` agent-api | The agent API by topic: commands, refusals, decisions, the player view, events, queries |
| `30` ui-screens | The original screens in the client: front end, tactical panels and input, map screen, battle entry, laptop, story |
| `31` sound-video-and-localization | Sound and music, speech, video, data versions and display languages |
| `32` stubs-and-performance | The stub pack, benchmarks and profiling, test runs and gates, the launcher, data tables |
| `33` hits-and-damage | A bullet hitting a soldier, armour, damage, hit reactions, death, the end of an attack, suppression, morale, experience |
| `34` throwing-and-physics | Throwing, launchers, item physics, fuses |
| `35` npc-actions-and-schedules | The NPC action catalog, strategic NPC presence, schedules, civilian groups, keys, locks and doors |
| `deviations.md` | Every deliberate difference from the original |
| `gaps.md` | Behaviour not ported yet |
| `releases.md` | Release notes |
| `tools/oracle/README.md` | The native oracle: build, probes, comparers |

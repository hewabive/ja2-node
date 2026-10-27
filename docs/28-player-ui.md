<!-- M8 "Player UI": the canvas widget set, layouts as data, bitmap fonts and the original screens. An implementable
spec. 2026-10-18.
Source: reference/stracciatella (same snapshot as docs 01–27), cross-checked against vanilla (reference/vanilla/ja2/Build)
where marked; an audit of ja2-node at 63ae408 (0.7.0). The user's original data was inspected only for file names,
counts, sizes and formats (`pnpm cli inspect`); nothing from it is reproduced, and no size or colour measured from it is
used as a stub dimension or layout constant. Read-only research by seven parallel passes (foundation, front-end
screens, tactical panels, tactical input and overlays, map screen with PBI and autoresolve, laptop, the ja2-node
client); their full notes are kept outside the repository (the maintainer's `~/ja2-notes/m8/`), this document is the
consolidated spec. -->

**Status (2026-10-19).** Spec, not started. The maintainer's direction: pixel fidelity to the original 640×480 screens
as the target of this milestone, without absurdity (whatever is expensive to reproduce may be simplified or deferred),
and a design that lets later milestones add one or more alternative modern layouts on the same widgets and screen logic.
Revised 2026-10-19: the four data scenarios (§1.3, M8 builds scenario 2), the rule pack, cursor hints computed on the
client with the simulation's own code (§2.4), the animation schedule and the client's time warp (§2.3), the stub art
cut to the CI minimum (§13).

# 28 — Player UI: widgets, layouts, fonts and the original screens

**Conventions.** Paths without a prefix are relative to `reference/stracciatella/src/game/`; `src/sgp/…`,
`src/externalized/…` and `assets/…` are relative to `reference/stracciatella/`; `V:` is vanilla `Build/`. ja2-node paths
start with `src/`, `data/`, `stubs/`, `tools/`, `tests/` or `docs/` and are relative to the repository. "(inferred)"
marks conclusions not traced end to end. **exact** = reproduce the original's look and behaviour from its art and
constants; **simplify** = same function and layout, a cheaper or browser-appropriate mechanism, logged when a player
can tell; **defer** = not in M8, listed in §14 and §18 and, when it is a visible difference, in `deviations.md`
tagged **Later**.

**Companions (do not duplicate).** `01` (D8–D10, D15, D16, §2 layers, §5 presentation, §6.3 client), `04` (§4 drivers
and playback, §5 server, §6 agent API: the commands and queries every screen maps to), `05` (tactical rendering),
`20` (lighting), `21`–`23` (laptop, contracts, merchants), `24` (dialogue and speech timing), `26` (meanwhiles and the
ending), `27` (§1 saves, §2 options, §3 sound, §4 video, §5 text and glyph tables, §6 stubs, §7 performance, §8 the
launcher), `deviations.md`.

## 0. Scope and summary

M8 in `01` §10 reads: the D10 canvas widget set, layouts and bitmap fonts; the original screens (menus, options,
save/load, tactical HUD and inventory, map screen, PBI, talk, shop, laptop), hotkeys, meanwhile playback (`27` §8);
`docs/releases.md` adds the enemy glow, lip sync, button sounds, the stub art those screens need and 60 FPS at
1920×1080; result: a human plays the whole campaign in the browser without the developer pages (release 0.8.0).

**Recommendation in one paragraph.** Build a DOM-free `ui` layer (region dispatcher with the original's `MouseSystem`
semantics, buttons, bitmap text with the original's wrap and colour model, cursors, popups, message boxes) that emits a
draw list for a WebGL renderer drawing at a logical resolution (640×480 frames centred in a Stracciatella-style screen
scaled by an integer UI scale). Each screen is a controller with a view model over `PlayerView` and hints, bound by a
JSON layout transcribed from Stracciatella's constants; the original layout is one skin, a modern layout later is
another skin for the same controllers. Reproduce the screens exactly by default; simplify what cannot work in a browser
or depends on frame rate; defer what needs simulation that does not exist (meanwhile scene playback, tactical placement,
the helicopter drop) or flavour with a high cost. **Cursor hints** (path previews with AP bands, action costs, chance to
hit, valid drop targets, route previews) are computed in the browser by the simulation's own functions over a
*player-knowledge projection* of the view; the server answers the same hint kinds over the same projection on an
unlogged query channel, so both agree by construction (agents, verification, fallback). The server gains the view fields
the original's panels show (bleeding, stats, faces, morale, map-screen economy and control), message entries, an
animation schedule the client plays its own frames against, a `pauseOn` real-time driver option, a session profile
endpoint and an item catalogue, and a dozen small commands the panels' buttons need (stealth, weapon mode, spread
bursts, group moves, swaps, jumps). The game data splits into a **rule pack** (everything the simulation reads, never
graphics) and media; M8 plays scenario 2 of §1.3 (the server holds the user's data and serves it raw through `/vfs` with
content-hash immutable URLs) and is shaped so that the client's own copy (scenario 3) and an uploaded rule pack
(scenario 4) can follow without rework.

**The largest single items** are the tactical HUD with its input state machine (U5, U6) and the laptop (about 50
screens, U10–U12); the foundation (U0, U1) comes first because every screen is built from it.

| § | Item | Core decision |
|---|---|---|
| 1 | Principles | exact by default; no hand-written rule and no hidden state in the client; four parts per screen; four data scenarios (M8 = scenario 2); client modals pause the driver, event boxes pause on the tick |
| 2 | Architecture | new `ui` layer; one `/play` page; generic frame application; the animation schedule and the client's time warp; cursor hints on the client with shared simulation code, the query channel for agents and verification; the rule pack, the manifest and immutable asset URLs; Stracciatella's resolution model with a UI scale; renderer work first |
| 3 | Foundation | `MouseSystem`, buttons, fonts, cursors and shared widgets reproduced exactly; fifteen widget types; JSON layouts with generated constants and a bindings contract |
| 4 | Front-end | all screens exact; save/load on Stracciatella's list with the original art; the GIO opens the laptop with nobody hired; help late |
| 5 | Tactical panels | exact panels, faces with lip sync, bars, item tiles; local item cursor; stats from the view, costs and placements from hints |
| 6 | Tactical input | the original state machine as client code, cursors and paths from hints, every gameplay hotkey; input locked until playback catches up |
| 7 | Map screen | exact; assignment shading, route and helicopter previews from hints; economy and control fields added |
| 8 | Battle entry | PBI and autoresolve exact; tactical placement deferred |
| 9 | Laptop | shell and every needed page exact; 16 groups of small server gaps, one of them a rule (site visits) |
| 10 | Story | meanwhile box exact, scene playback deferred; the ending wired |
| 11 | Sound | button sounds, lip sync, music without a session |
| 12 | Server | view fields, events, message entries, protocol, commands, eight rule findings |
| 13 | Stubs | the CI minimum: labelled STIs under the original names generated from the layouts, a few special cases |
| 14–18 | Deviations, tests, performance, slices, decisions | U0–U15; goldens on stubs only |

---

## 1. Principles

### 1.1 Fidelity policy

The original's screens are fixed 640×480 compositions of STI and PCX art, bitmap text in palette-index colours and
mouse regions at constants from `#define` blocks. Reproducing a screen exactly is mostly transcription once the shared
widgets exist, so **exact is the default**. A part is **simplified** when the original mechanism cannot work in a
browser (pointer warping, mouse confinement, OS key repeat), depends on the frame rate (fades, zoom speeds), exists
only to save a software renderer work (dirty rectangles, save buffers) or needs a server rule the client must not
reimplement and a cheaper equivalent shows the same thing. A part is **deferred** when it needs simulation that does
not exist yet (helicopter drop, meanwhile scene sandbox, tactical placement) or is flavour with a high cost (help
screens' auto-show bookkeeping can come late, the A.I.M. conference distortion, Speck's idle chatter).

Rules that follow from D15 and D16 and bind every screen:

1. **No hand-written rule in the client.** Every number a screen shows that the simulation computes (costs, chances,
   ETAs, prices, what fits where, what is enabled) comes from the view, from a hint computed by the simulation's own
   functions over the player-knowledge projection (§2.4), or from a server query. The client never reimplements a rule;
   a screen may restate an *enable* rule on view fields only when the rule is trivial and the command refuses anyway
   (try-and-refuse is always acceptable). Commands are always validated by the server on the full state.
2. **No hidden state.** A screen shows only what the original shows at that moment; additions to the view (§12) reveal
   nothing more. Hints and queries run on the projection, where soldiers the player does not see do not exist. Where
   the original's own UI leaks hidden state (a menu line shaded because of enemies nobody has seen), the projection
   does not; the command then refuses with the original's message.
3. **Presentation never feeds the simulation.** Client timers (blinks, flashes, lip sync, fades, loading bars) and
   cosmetic randomness (`src/audio/client-random.ts`) stay in the client.

### 1.2 Four parts per screen

| Part | Lives in | Knows | Never knows |
|---|---|---|---|
| **Controller** (screen logic: state machine, selection, popups, what a click sends) | `src/ui/screens/` | the view, hints, queries, commands, client settings | coordinates, art, fonts |
| **View model** (named values, booleans and lists the layout binds to) | produced by the controller | display strings (formatted through the text service), enable flags | pixels |
| **Layout** (which widgets, where, with which art, fonts and colours, bound to view model names and controller actions) | `data/layouts/<skin>/<screen>.json` | the widget vocabulary, asset ids, font ids | rules, the view |
| **Widgets and renderer** (region dispatcher, buttons, text, popups; the draw list; WebGL) | `src/ui/widgets/`, `src/render/ui-draw/` | geometry, input events | game state |

The original layout is one skin (`original`). An alternative layout is another set of layout files for the same
controllers; a controller declares its actions and bindings, and a test checks that each layout binds them or marks
them unsupported (§3.10). Screen-specific renderers that cannot be generic (tactical viewport, strategic map, radar,
faces, inventory slots, the video player) are `custom` widgets whose geometry comes from layout parameters, so a
modern layout can resize them without touching the controller.

### 1.3 Data scenarios

The game data splits in two:

- **The rule pack**: everything the simulation reads. The animation scripts (`binarydata/ja2bin.dat`), maps, structure
  files (JSD), tileset definitions with their frame counts and aux data, profiles (`prof.dat`), NPC scripts, the lock
  table, the explosion animations' frame counts, the text files (their lengths time speech, and agents read them), plus
  the externalized and transcribed tables already in the repository. About 15 MB compressed, 12 MB of it maps. The
  simulation never reads graphics: the few numbers it takes from STI headers today (explosion frame counts,
  `src/content/items/explosions.ts:92-107`; tileset frame counts and aux data, `src/content/world/tileset-loader.ts:33-62`)
  move into the pack. The pack has one hash, which becomes the logic hash of the content identity
  (`src/server/content-identity.ts`, saves are bound to it). The hash binds a save to the **game data** only: on the
  original data it covers the entries whose winning VFS layer is the data folder or an SLF archive (rule files,
  graphic facts, text presence, layer counts), on the stubs the stub pack; the externalized and transcribed tables
  (`ja2-node-data`) and, on the original data, the stub pack stay in the pack for the simulation but ship with the
  engine and are versioned by its version and commit (U0c, §17.4). It is built from the user's data and never
  committed.
- **Media**: graphics, sounds, music, videos, fonts; needed only by the client.

The server is always authoritative over the rules; the client draws with its media and plays its animation frames
against the server's schedule (§2.3).

| # | Scenario | Rules on the server from | Media on the client from | Status |
|---|---|---|---|---|
| 1 | Stubs only | the stub pack | the server (`/vfs`) | kept as it is; M8 adds only the stub art CI needs (§13) |
| 2 | The user's data on the server, served to the client | `JA2_DATA_DIR`, built into the rule pack at start and cached | the server: `/vfs` with a manifest of content hashes and immutable URLs (§2.5) | **M8** |
| 3 | The user's data on the server and on the client | `JA2_DATA_DIR` | the client's own `Data` folder, every file checked against the server's manifest on first read, a mismatch or a missing file fetched from the server | after M8 |
| 4 | The user's data only on the client | a rule pack the client builds from its folder and uploads (the hash first; no upload when the server has it); stored in the server's cache, never in the repository; sessions bound to a pack | the client's own folder, as in 3 | a later milestone |

Scenario 2 is what M8 builds, shaped so that 3 and 4 need no rework: the rule pack is an explicit server artifact with
a hash; the client reads files through a replaceable `AssetSource` layer (HTTP now, a local folder later); the client
builds the same rule content with the same loaders from whatever its source is (for the hints, §2.4); the animation
schedule and the client's time warp work when the client's scripts differ from the server's.

**Scenario 3 compatibility rules** (recorded now, built later): the data version (`src/server/data-version.ts`) must
match, because versions differ in rules too (text lengths time speech); every file the client reads from its folder is
hashed (SubtleCrypto) on first read and compared with the manifest entry; equal → local, different or missing → the
server's copy through `/vfs/@<hash>/…`; no upfront hashing of the whole folder. Chromium keeps the folder handle across
sessions (`showDirectoryPicker`); Firefox and Safari use `<input webkitdirectory>` every session; archives are read in
ranges through `Blob.slice`.

**Scenario 4 needs** (recorded now, built later): the rule pack serialised and validated by the server (parsed, hashed),
per-session content (today the content is one per server), and per-user storage of packs on a shared server (no
cross-user deduplication, so the server never hands one user's upload to another user's session).

Graphics stay palette-indexed in every scenario (soldier palettes, shade tables and outline colours need indices); STI,
PCX, ETRLE, IMA ADPCM, GAP and Smacker are decoded by ja2-node's own code, so no browser codec support matters.
Compression of `/vfs` and audio transcoding belong to remote play and are not built in M8.

### 1.4 Time while the client shows something modal

The original pauses game time while a message box, the options or save screen, the help overlay, a popup menu, the
item pickup menu or the sector inventory is open, and it pauses *at the event* that opens a box (`MessageBoxScreen.cc:270-274`,
`Options_Screen.cc:169`, `HelpScreen.cc:465-472`, `Interface_Items.cc` pickup menu). In ja2-node the server owns time:

- **Client modals** (options, save/load, help, menus, popups, the exit box, the meanwhile box): the client switches
  the session's driver to `manual` (WebSocket `drive`) while one is open over a running real-time session and restores
  the previous driver afterwards; `src/devtools/net/sleep-wake-stop.ts` already does this for the sleep/wake box.
- **Boxes opened by an event** (the map screen's update box, arrival and invasion notices, the turn-based "enemy
  spotted" pause is already simulated): the real-time driver gains `pauseOn: EventType[]` (§12.3) and stops on the
  tick of the first listed event, as decision prompts already stop it. The client sets the list the original pauses at.
- Decision prompts already freeze the server (D15) and need nothing new.

---

## 2. Architecture

### 2.1 Layers

A new DOM-free layer **`ui`** joins the browser layers (`tools/check-imports.ts`, tsconfig references):

| Layer | May import | lib | Contents |
|---|---|---|---|
| `ui` (new, `src/ui`) | core, content, protocol, ui | ES2024 only, like `content`; the `NONDETERMINISM` forbid list (time is injected) | region dispatcher, widgets, layout model and loader, bitmap font metrics and text layout over `src/content/text/glyph-table.ts`, hotkey tables, the cursor database, the **draw list** type, screen controllers written against an abstract `GameClient` (view, `hint()`, `command()`, `query()`, `drive()`, text service, asset ids) |
| `sim` (extend) | as today | — | `src/sim/knowledge/` (the player-knowledge projection) and `src/sim/hints/` (the hint functions over it), used by the server's query handlers and by the client |
| `render` | + ui (types only) | DOM | `render/ui-draw`: draw list → sprite batches (UI atlases, font palette rows, fills, shades, hatches, scissor) |
| `app` | + ui, sim | DOM | the game page: DOM events → `ui` input, `SessionClient`, `AssetSource`, the client's rule content and the local hint provider (`sim/hints` over the projection), audio, GL, video overlay, `localStorage`; the launcher stays |
| `devtools` | + ui | DOM | a widget and layout gallery page, a layout debug overlay |

Changes: add `'ui'` to `Layer`, `RULES` and the `layerOf` regex in `tools/check-imports.ts`; allow `app` → `sim`;
`src/ui/tsconfig.json` referencing core, content and protocol; `../ui` (and `../sim` for app) in the references of
render, app, devtools, tests and the root. The simulation is DOM-free, Node-free and deterministic, so it runs in the
browser unchanged (`04` §5.7). D12's note "there is no `ui` layer yet" is updated when it lands.

**Promote before the first screen** (app may not import devtools, `tools/check-imports.ts:40`): `SessionClient`
(`src/devtools/net/session-client.ts`), the `/vfs` fetch helpers (three copies today: `devtools/asset-browser/api.ts:28`,
`app/launcher/main.ts:84`, `app/video/player.ts:55`), `loadWorld` (map viewer), `SoldierAssets`
(`devtools/tactical/soldier-assets.ts`), the radar logic, `TacticalSound`, `StrategicSound`, `PageMusic`,
`SleepWakeStop`, the quick-save keys and `loadAsset`. The devtools pages then import them from `app`.

### 2.2 The game page

One page, `/play` (`src/app/game/index.html`), for everything a player sees: one WebSocket, one WebGL2 context, one
audio engine, one asset cache, and a **screen stack** (main menu, game init, options, save/load, credits, intro and
ending videos, laptop, map screen, tactical, shop, autoresolve) with a **modal stack** above it (message boxes, popup
menus, help, fades). Switching tactical ↔ map ↔ laptop is a screen change, not a page load, so decoded assets survive.
The launcher stays at `/` for ja2-node-only features (data source, display language, sessions, native imports, download
and upload, settings export, developer links) and gains a "Play" entry; whether `/` becomes the canvas main menu is
decided at the M8 release (§18).

Frame loop (`requestAnimationFrame`): pointer and key events → modal stack, then the current screen (§3.1, §3.8) →
playback advances (`SessionClient.playFor`) → event processing (sound director, speech presenter, message log, screen
reactions) → controllers update view models → widgets produce the draw list → `ui-draw` and the world renderer draw
into the logical framebuffer (§2.6) → blit to the canvas → software cursor last.

### 2.3 The client's copy of the game

`SessionClient` mirrors 18 view fields by hand and drops `meanwhile`, `ended` and `music` from frames
(`session-client.ts:229-257`). M8 replaces the hand mirror with a generic `applyViewFrame(view, frame)` in `protocol`
next to `diffPlayerView` (`src/protocol/view.ts:652`), tested as its inverse over the scenario suites, so every field
added in §12 reaches the screens without client work. The `welcome` message carries the engine version and commit and
the rule pack's hash and its scripts' hash.

**Animation scripts split at load.** The server parses `ja2bin.dat` into two parts in memory (never committed): the
**logic timeline** (per state: frame slots, the gameplay markers, jumps, transitions and the stop and wait points; no
sprite frame numbers) that the simulation runs, and the **presentation timeline** (sprite frame numbers, sound
opcodes) that only a client needs. The simulation reads no sprite frame number today except to export it
(`SoldierView.frame` is set from the script's frame code, `src/sim/tactical/animation.ts:541`); the native save import
keeps mapping the saved frame and code.

**The animation schedule.** Instead of the sprite frame, a soldier's view entry carries the animation state, the logic
position within it (the frame slot counted from the state's start), the tick the state started and the current frame
delay (`sAniDelay`, which depends on breath, life, agility, terrain, combat and stealth: the client cannot compute it);
gameplay markers arrive as events with their ticks (`shotFired`, `soldierHit`, steps, door changes). The client turns
this into sprite frames with its own presentation timeline:

- **Same scripts** (its scripts' hash equals the server's, always the case in scenario 2): it follows the timeline
  exactly as the sound director does today (`src/content/anim/timeline-follower.ts`); the picture is exact.
- **Different scripts** (stubs against original rules, another data version, a mod; scenarios 3 and 4): a piecewise
  time warp between the markers: the client's frames between two markers are stretched or squeezed to the server's
  ticks of those markers, so a muzzle flash still coincides with `shotFired`. The animation may look slightly off
  (feet sliding); the rules, traces and saves are untouched, because nothing flows back from the picture.

Fine animation between the 50 ms frames comes from this schedule; no smaller `FRAME_TICKS`.

**Predicted frames (2026-10-26).** A soldier view also carries `nextFrameTick`, the view tick at which its frame slot
next advances (`NEVER_NEXT_FRAME` while its updates are paused, and in a campaign off the tactical screen, where the tactical sim
does not step while the campaign's ticks run; `nextFrameTick` in `animation.ts` reads the frame timer,
`tacticalPlayerView` moves it from the tactical sim's ticks to the view's). Within a state and at a constant delay the
slot advances every `ceil(frameDelay / 5)` ticks along the state's walk of frame slots (jumps and opcodes take no time),
so `predictedFrameSlot` (`schedule-track.ts`) finds the slot at any later tick from the last sent slot and its next
tick. The session keeps the last sent anchor of a soldier (`keepPredictableFrames`, `src/server/frame-anchors.ts`)
while the animation, its start and its delay are unchanged, the animation's script plays no sound (the sound director
still walks the scripts from the frames it receives) and the prediction gives the slot the simulation shows; otherwise
the soldier goes out as before. While a kept anchor is still to advance, a capture without changes sends an empty
frame, so the client's view tick keeps moving. The client, with the same scripts, draws the predicted slot. A breathing
squad thus sends nothing but those empty frames; `frame-anchors.test.ts` replays the stub sandbox and A9 for 2600 ticks
(idle, then a walk) and checks the predicted sprite frame against the simulation at every frame tick, with no soldier
resent for its frame alone.

### 2.4 Cursor hints and queries

Cursor feedback needs answers several times a second (path and AP cost under the pointer, chance to hit, valid drop
targets, ETAs while plotting). The original computes them in the UI with the same functions as the rules. ja2-node does
the same, in the browser, with the simulation's own code:

- **The player-knowledge projection** (`src/sim/knowledge/`): one function `knowledgeWorld(view, rules)` builds, from a
  `PlayerView` and the rule content, the minimal world the hint functions read: the map and its structures, doors as
  the player perceives them, the items the squad has seen, the light, the player's soldiers in full (stats, AP,
  stance, inventory) and only the other soldiers the player sees, with only their visible fields. Unseen soldiers do
  not exist in it.
- **The hint functions** (`src/sim/hints/`): pure functions of the projection, written over the simulation's existing
  functions (`findBestPath`, `plotPathCost`, the AP functions, the chance-to-hit and chance-to-get-through code,
  `CanItemFitInPosition`, the strategic path builder…), never reimplementations. The kinds are in the table below.
- **The client** keeps the rule content it built with the same loaders from its asset source (`loadTacticalContent(read)`
  and the world loader already take a `ReadFile`), rebuilds the projection from the latest received view (not the
  playback-delayed one; in turn-based play input is locked until playback has passed every received lock anyway) and computes hints
  locally: one per change of (hovered tile, mode, aim, selection), on the original's 80 ms rest timer
  (`PATHFINDCOUNTER`, `Utils/Timer_Control.cc:19`), cached by (soldier, tile, mode, AP). No network round trip.
- **The server** answers the same hint kinds by running the same functions on `knowledgeWorld` of the same view it
  sends the player. That is also what makes a query fair (D16). So client and server agree **by construction**: same
  code (the client checks the engine commit in `welcome`), same inputs (the projection of the same view; the client
  checks the rule pack hash). On a mismatch of either, the client falls back to the server's query channel.
- **Legitimate differences** exist only against the full state: a path through a tile held by an unseen enemy is shown,
  and the merc stops when he meets him, as in the original. Commands are validated on the full state.

**Which answers stay on the server.** Hover-rate answers are hints (local). Click-rate answers that depend on state the
player does not see (an A.I.M. merc's availability and mood, a dealer's hidden flags) or that only price a decision
stay server queries: `hireCheck`, `impCheckCode`, `aimQuote`, `bobbyRayQuote`, `insuranceQuote`, `impPreview`,
`arrivalTime`, `quoteTrade`, `contractOptions`, `inventory` for other sectors.

**The query channel** remains, for agents (MCP keeps queries as `act` commands and may gain a `query` tool), for the
server-only answers above, for the client's fallback and for verification:

- WebSocket `{t: 'query', id, q}` → `{t: 'answer', id, ok, data | reason}`; handled like `observe`: answered between
  ticks without entering the session's input queue, never logged, no frame, no advance; the worker host forwards it the
  same way. Today a query is an ordinary command: appended to the input log, queued behind a running advance, followed
  by a frame capture and, under the instant driver, an `advance {idle}` (`src/server/session.ts:260-266`,
  `session-host.ts:101-117`).
- A query leaves the state byte-identical: a unit test snapshots the session before and after every kind over the stub
  scenarios.
- `estimateAttack` resolves its target with `whoIsThere` (`tactical-sim.ts:733`), which finds unseen soldiers: it moves
  onto the projection with the other hints (a D16 leak fixed).

**Keeping them equal** (§15): (1) scenario tests compute every hint kind on the client side (the projection built from
the serialised view alone) and on the server side over thousands of sampled points and compare; (2) in tests the
projection fills every field the view does not supply with a value that throws when read, so a hint function that reads
hidden state fails at once; (3) a **shadow mode** (developer setting, on in e2e) sends every local hint to the server
as well and reports any difference, comparing the reply with the local answer over the view the client holds when the
reply arrives, the very view the server answered over (`docs/04` §6.35); (4) the view must carry every input a hint
reads (§12.1).

Hint kinds (the screen sections name them; "query" there means the same kind, wherever it is computed):

| Hint | Answer | Screen | Built from |
|---|---|---|---|
| `previewMove {soldier, to, mode, reverse?}` | `{destination: ok \| blocked \| heightDiffers \| robotUncontrolled, apCost, firstStepCost, affordable, steps: [{gridNo, enterDir, leaveDir, band}], refusal?}` | tactical move cursor, footstep path with AP colour bands | `UIPlotPath`/`PlotPath` incl. `MinAPsToStartMovement` and the run start cost; `findBestPath`, `plotPathCost` (`src/sim/tactical/pathfinding.ts:404`, `ai/utils.ts:53-61`) |
| `previewAction {soldier, gridNo, level, kind, target?}` | `{ok, refusal?, apCost, affordable, actionGridNo, steps?}`; kinds door, pickUp, steal, aid, cutFence, repair, refuel, jar, can, bomb, talk, give, jump, swap, look, enterVehicle (one per `MOVEUI_TARGET_*` branch) | tactical action cursors, the walk-up path | `DrawUIMovementPath` branches (`Handle_UI.cc:3116-3465`) restated on the simulation's functions |
| `estimateAttack` (extended) | adds `inRange`, `apCostByAim[0..4]`, ammo state `{empty, canReload, reloadAp}`, the weapon mode; launchers and the attached launcher through the throw branch with the landing level | attack cursors (aim rings, out of range, reload) | existing; launchers fall into the gun branch today |
| `exitSector {…, dryRun: true}` | `{ok, refusal?}` | exit arrow colour | the existing refusals |
| `placements {soldier, slot, count?}` | valid target slots, attach and merge targets | inventory hatches | `CanItemFitInPosition`, `ValidAttachment`, `ValidMerge` |
| `itemInfo {soldier, slot} \| {item}` | computed stats, pros and cons for the description box | item description box | `GunRange`, `BaseAPsToShootOrStab`, `CalcAPsToBurst` |
| `previewRoute {soldiers \| group, to, via?, shortest?}` | `{path, edgeMinutes[], etaMinutes}` | map screen plotting | `docs/16` §7.5 (planned) |
| `previewHeliRoute {to, via?}` | `{path, distance, safe, unsafe, cost, etaMinutes}` | helicopter plotting | `docs/16`, helicopter costs |
| `assignmentOptions {soldier}` | every assignment menu line `{enabled, shade, reason?}` | assignment popups | `HandleShadingOfLinesForAssignmentMenus`, the `CanCharacter*` checks |
| `exitSectorOptions {soldier}` | the exit dialog's choices | sector exit dialog | `Strategic_Exit_GUI.cc` rules |
| `canEnterSector {sector}` | `{allowed, reason?}` | map screen Tactical button | `AllowedToExitFromMapscreenTo`, `CanGoToTacticalInSector` |
| `hireCheck {profile}`, `impCheckCode {code}` (server only) | refusal and quote | A.I.M. conference, I.M.P. home | `docs/21` hire rules |

Measured costs in Node: 0.06 ms (`estimateAttack`) to 0.5 ms (a path search); the browser's V8 is the same engine. The
client bundle grows by the parts of `sim` the hints import (tree-shaken).

### 2.5 Assets

Measured on the user's data (34,279 files, 864 MB): speech 390 MB (IMA ADPCM), music 100 MB (PCM), sounds 33 MB, STI
graphics 170 MB, maps 75 MB, videos 69 MB. A first tactical screen needs about 8–12 MB of STI and map data (tileset 0,
the sector's tileset, the map, sheets of the soldiers in view, HUD art and faces); a speech line is 30–60 KB.

Today `/vfs` answers `cache-control: private, no-cache` with an ETag that changes on every server restart
(`src/server/app.ts:334-338`, `main.ts:64`): every use of every file is a conditional request, and a restart
revalidates everything. M8 (scenario 2 of §1.3):

0. **Rule pack.** At start the server builds the rule pack from its data (the files the content loaders read, the
   numbers taken from STI headers, the split scripts), caches it in `.ja2/cache/rules-<hash>/` and loads the
   simulation's content from it; the logic hash of the content identity is the pack's hash, over the game data's
   entries only (U0c, §17.4). The serialised, uploadable
   form is scenario 4's work; M8 needs the boundary and the hash.
1. **Manifest.** `GET /api/assets/manifest` returns `[path, size, hash]` (first 16 hex digits of SHA-256; all 22 SLFs
   hash in 2.2 s), gzipped. Hashes are computed lazily and persisted in `.ja2/cache/vfs-hashes.json` keyed by archive
   path, size and mtime plus entry offset and length (loose files by path, size, mtime), so a restart costs nothing.
2. **Immutable URLs.** `GET /vfs/@<hash>/<path>` answers `cache-control: private, max-age=31536000, immutable` when the
   hash matches, 404 otherwise (the client refetches the manifest). Plain `/vfs/<path>` stays for tools and agents with
   the content hash as a strong ETag instead of the start generation.
3. **`HttpVfsLayer implements VfsLayer`** (`src/content/vfs/vfs.ts:8-12`) built from the manifest, so path
   normalisation, layering and the stub fallback are the same `Vfs` class as on the server; reads are fetched with a
   concurrency limit (8–16), in-flight dedupe and abort. A page has one (`src/app/assets/page-assets.ts`, one manifest
   request), and the `src/app/net/vfs.ts` helpers read through it too: the tactical world, sounds, music and video come
   from immutable URLs, a file missing from the manifest answers without a request, a stale hash falls back to the
   plain URL, and the file list is the manifest's instead of `/api/vfs` (before: 330 revalidations and 168 KB on every
   opening of the A9 tactical screen, 2026-10-25). Every loader already takes a `ReadFile`
   (`src/content/world/tileset-loader.ts:11`) and the audio engine a `load(path)` (`src/audio/engine.ts:33`). A later
   `LocalFolderLayer` (the user's `Data` folder through `showDirectoryPicker()` and the DOM-free SLF parser over
   `Blob.slice`, `01` §4.2) plugs in at the same seam.
4. **Decoded cache.** `AssetCache` keyed by `(hash, decoder)` with an LRU by bytes (256 MB); GPU residency per screen
   group (a world atlas per sector, one UI atlas set each for the HUD, the map screen and the laptop) so switching
   screens does not re-decode. Decoding is cheap (a tileset's ETRLE frames in 17–53 ms), so the persistent layer is the
   HTTP cache, not a decoded store.
5. **Preload per screen.** Each screen declares its asset list (its layout's assets, fonts, cursors, sounds); the app
   preloads before entering it. A sector load shows the original loading screen (§4.10) with its bar driven by this
   preload. The map-screen set is prefetched in the background while in tactical and vice versa.
6. **RGB565 pictures** (load screens, the tactical bottom filler, some full screens) upload as `RGB565` /
   `UNSIGNED_SHORT_5_6_5` textures (`StiRgb.pixels` is a `Uint16Array`, `src/content/formats/sti.ts:53-59`).

7. **The client's rule content.** The client loads the rule files it needs for hints (the map and its structures,
   the tactical content, the strategic tables) through the same `AssetSource` and the same loaders as the server, so
   its rule content is the server's (its hash is checked against `welcome`).

Not in M8: the local folder source and the per-file check (scenario 3), the rule pack upload and per-session content
(scenario 4), compression of `/vfs` (measured brotli ratios are good for maps, laptop and interface art, 16–31 % of raw,
but loopback is not the bottleneck) and transcoding audio; the last two belong to remote play.

### 2.6 Resolution and scaling

Stracciatella keeps every fixed screen at 640×480 centred at `STD_SCREEN_X/Y` with black around it, extends only the
tactical viewport (`(0,0)–(W, H−120)`) and centres the tactical bottom panel, with 6–12 team slots by width
(`UILayout.cc:57-138`, `:167-176`; `squad_size` 6 in `game.json:95`). ja2-node adopts that model with one extra
parameter, the **UI scale**:

- logical size = `floor(canvas / scale)`, at least 640×480; scale = a client setting or auto (the largest integer that
  keeps 640×480): 1920×1080 → 2 → logical 960×540 (tactical viewport 960×420, six slots, panel centred); 2560×1440 →
  3 → 853×480; 1280×720 → 1.
- Fixed screens are laid out in a `std640` frame anchored at `STD_SCREEN_X/Y`; the few full-screen elements (main
  menu buttons and copyright, message box centring, tooltips, the splash) use logical screen coordinates.
- Rendering goes to a framebuffer at the logical size and is copied 1:1 into a canvas of the same size; the browser
  scales the canvas (`image-rendering: pixelated`) to exactly `logical × scale` device pixels inside a full-window
  `#stage`, at an offset that is whole in both CSS and device pixels (`alignedOffset`: Chrome and WebKit place a
  canvas at whole CSS pixels); a sharp-bilinear option covers non-integer fits; a "640×480 only" option pillarboxes the
  tactical screen too.
- The stage takes the pointer events and fullscreen; pointer coordinates go through the inverse letterbox transform;
  `setPointerCapture` keeps a release outside the stage.

This changes nothing in the rules: the viewport size never reaches the simulation. If the wide tactical view follows
Stracciatella, no deviation row is needed.

### 2.7 Renderer work before screens

From the client audit (`src/render`, 1,182 lines; measured with the scene builder in Node on the user's maps):

| Change | Why | Measured effect |
|---|---|---|
| One texture array (or 4096² R8UI pages) per world atlas | the two 2048² pages interleave and break batches | A9 at 1920×1080: 1,288 → 210 draw calls |
| Static scene once per map in a GPU instance buffer, camera as a uniform, patched rows on door, roof, shade and structure changes | `buildScene` allocates every item every frame | 6–9 ms of JS per frame → near zero for the static world (whole map 31–36k quads, built in 18 ms) |
| Logical-resolution framebuffer, nearest blit | pixel fidelity, 4× fewer fragments at scale 2 (16× at DPR 2), the same FBO serves screenshot tests | — |
| Persistent instance buffer, one upload per frame | a new `Float32Array` per batch today | — |
| Drop `preserveDrawingBuffer` on the game page | tests read the FBO | — |
| UI primitives: fills (right/bottom exclusive), outline rectangles and lines (inclusive), `ShadowRect` ×0.48 and ×0.8 multiply, checkerboard hatch anchored at the rect origin, 1-in-8 loose hatch, scissor, RGB565 textures, a font palette row per (font, fg, shadow, bg) | `ColorFillVideoSurfaceArea`, `RectangleDraw`, `ShadowVideoSurfaceRect`, the hatch blitters, `SetClippingRect` | the UI adds 600–3,000 quads per screen in 5–20 draw calls |
| Index 254 → outline colour or discard; outline shadow (non-254 darkens ×0.48) | item graphics, the item cursor | — |
| Camera snap to tile centres and scroll limits (`05` §1.4); soldier picking by sprite, not only by tile | original feel; clicks on a soldier's body | — |
| Per-tile shade from ambient light and light sprites (`20` §8), corpses, smoke and gas clouds, tile changes (§12.1 G6–G9) | night, battle aftermath | needs view fields |

---

## 3. Foundation

The foundation is small in the original (`MouseSystem.cc` 961 lines, `Button_System.cc` 1,628, `Font.cc` 322,
`WordWrap.cc` 552, `Cursor_Control.cc` 404, the shared widgets about 3,000) and used everywhere: outside the editor,
208 region definitions in 64 files, 124 button creations in 65 files, 94 tooltips. Getting it exact first makes every
screen cheaper. Every rule below is unit-testable in Node with scripted event sequences.

### 3.1 Mouse regions (`src/sgp/MouseSystem.cc/.h`)

Reproduce exactly:

- One region list sorted by priority; among equal priorities the **newest wins** (message box buttons rely on it).
  Hit test includes the bottom-right edge (a region reacts one pixel beyond its art).
- Disabled regions take no input; `allowDisabledTooltip`; a hidden region is disabled and not drawn.
- MOVE, GAIN and LOST go to the movement handler of the top region only; button reasons (left/right/middle down, up,
  repeat, wheel) are OR-ed into one call.
- Pressing locks button events to the pressed region; a release over another region is swallowed.
- Double click = down-up-down on the same region within 400 ms; a held button repeats after 250 ms, then every 50 ms;
  generated by our layer from raw down/up and the injected clock, never from `dblclick` or OS repeat.
- Each region has a cursor or `NO_CURSOR` (fall through to the next region below); re-evaluated once per frame after
  widget changes.
- Callbacks may create and delete regions: dispatch over a snapshot and recheck existence.

Browser glue (app): `contextmenu` and middle/X-button navigation suppressed, `wheel` with `passive: false`, pointer
capture on the canvas, coordinates through the letterbox transform. Touch input is deferred.

### 3.2 Tooltips (fast help, `MouseSystem.cc` fast help)

600 ms hover delay; a double-framed box with the interior darkened twice; token colours in the text (`|` gold, `^`
green, `~` red); placement clamped to the screen; reset on click. `FONT10ARIAL`. **Exact.**

### 3.3 Buttons (`src/sgp/Button_System.cc`, `Button_Sound_Control.cc`)

- An image names five frames of one STI: grayed, off, off-hover, on, on-hover (`LoadButtonImage`; two-frame variant).
- Kinds: push, toggle (state from game or UI state), check box, hot spot (a region with button semantics), text
  button (`CreateIconAndTextButton`: image + text with on/off colours and shadows, the text shifts one pixel while
  pressed), icon button.
- A click fires on release over the button where the press started; dragging off and back plays the switch sounds.
- Disabled: the grayed frame, `DISABLED_STYLE_SHADED` (×0.48), `DISABLED_STYLE_HATCHED` (black checkerboard) or none.
- Sounds by scheme, chosen from the current screen when the button is created (`Button_Sound_Control.cc:9-52`); a
  click on a disabled button plays `sounds/disabled button.wav` at volume 15.
- The generic `genbutn` buttons (editor and debug) are not needed.

### 3.4 Fonts and text

**Fonts.** `InitializeFonts` (`Utils/Font_Control.cc:34-62`) loads 16 STIs from `fonts/`: `FONT10ARIAL`,
`FONT10ARIALBOLD`, `FONT12ARIAL`, `FONT12ARIALFIXEDWIDTH`, `FONT12POINT1`, `FONT14ARIAL`, `FONT14HUMANIST`,
`FONT16ARIAL`, `BLOCKFONT` (`MILITARYFONT1`), `BLOCKFONT2`, `BLOCKFONTNARROW`, `COMPFONT`, `SMALLCOMPFONT`,
`LARGEFONT1`, `SMALLFONT1`, `TINYFONT1`. The stub pack aliases all of them to two Terminus-based stub fonts
(`stubs/fonts.ts`, `docs/27` §6.6), with glyphs for Latin, Polish and Cyrillic.

**Glyphs.** One translation table per data version maps a code point to a glyph index for all fonts
(`src/sgp/Font.cc:163-173`); ja2-node has it (`src/content/text/glyph-table.ts`). Guard indices against the font's
glyph count (the block fonts and `font14humanist` have one glyph fewer than the English table's maximum).

**Colours.** Glyphs carry their drop shadow as pixel value 1, every other non-zero value is ink. Text is printed with
the mono-shadow rule: 0 → background or transparent, 1 → shadow or nothing, else foreground
(`VObject_Blitters.cc:236-345`). Colours are 8-bit palette indices resolved through the palette of the **current font**
(`Font.cc:51-80`); the font palettes differ in a few indices, so colours are resolved per font. A shadow index whose
colour is black stays visible (it becomes near-black), a background index whose colour is black is transparent;
`NO_SHADOW` = 0, `DEFAULT_SHADOW` = 2. Named indices in `Utils/Font_Control.h:48-93`. Rendering: one R8 glyph atlas per
font and a text shader with per-run fg, shadow and bg colours (alpha 0 = none), resolved on the CPU with the two black
rules.

**Measuring and alignment.** Advance = width + x offset, no kerning (`Font.cc:93-110`); centre =
`x + (w − len + 1) / 2`, right = `x + w − len`, all integer division (`:295-322`); `DrawTextToScreen` centres with
`(w − len)/2` without the +1 and leaves the shadow from the previous call, so layouts give the shadow explicitly;
`TEXT_SHADOWED` draws a `ShadowRect` behind the text; `ReduceStringLength` truncates with up to three dots.

**Word wrap.** `LineWrap` (`Utils/WordWrap.cc:33-96`, Stracciatella's rewrite): breaks at spaces (the break space is
dropped), after hyphens and before any code point ≥ U+4E00; a word longer than the line is split where it overflows.
`DisplayWrappedString` line height = font height + gap. `IanDisplayWrappedString` / `IanWrappedStringHeight`
(`:180-524`) wrap by words with in-text codes 177 newline, 178 bold toggle (`FONT10ARIALBOLD`, shadow off), 179 centre,
180 colour (always 184), 181 default colour; message boxes, popups, mail and laptop pages use them, and mail and files
break into pages by the measured height, so the measure must be exact.

**Numbers and money.** printf-style templates from the string tables (`src/app/launcher/printf.ts` moves to `ui`);
`SPrintMoney` puts the minus after the dollar (`$-1,234`, `Laptop/Finances.cc:954-979`); weights by the metric option.

**Language-dependent art (MLG).** 33 pictures with baked-in text (main menu buttons, the options and save/load
headers, the PBI panel, the map screen's sort buttons, 27 laptop pictures) are chosen by the **data version**, not the
display language (`GameRes.cc:70-308`). Layouts name the MLG id, never a path; with a display language other than the
data's these pictures keep the data's language (accepted; `27` §5.2 already separates the two).

**Cost: exact** (atlases and shader small; measure, align, wrap and the Ian codes with unit tests on the stub fonts in
CI and on the original fonts with `JA2_DATA_DIR`).

### 3.5 Cursors (`src/sgp/Cursor_Control.cc`, `Utils/Cursors.cc`)

- `CursorFileDatabase` (68 STIs, `Cursors.cc:21-97`) and `CursorDatabase` (about 140 cursors, `:111-1168`): up to five
  composite images per cursor (file, frame, position or centred or hidden), hot spot, flags (flash, flash2,
  conditional sub-cursor, delayed start, sound). Transcribed with `tools/transcribe/cursors.ts` into `data/tables/`.
- Animated cursors (`AUX_ANIMATED_TILE`) advance every 150 ms, only over the tactical viewport and a few regions;
  flashing cursors toggle every 250 ms; a delayed cursor shows nothing for the first second.
- Text in the cursor (`DrawMouseText`, `Cursors.cc:1276-1388`): `TINYFONT1` white; hit location, interactive tile
  names, chance to hit, AP cost (an invalid cost flashes); only over the tactical viewport.
- The item in hand is the cursor (the "extern" entry with the outline blitter).
- **Software cursor** drawn last into the frame with `cursor: none` on the canvas; a CSS cursor for the plain arrow is
  an option for later, not the default (it cannot scale with the canvas or carry live text). **Exact.**

### 3.6 Shared widgets

| Widget | Original | Notes | Recommendation |
|---|---|---|---|
| Popup menu | `Utils/PopUpBox.cc` | border STI (corners and edges) + background PCX, margins, line spacing, a second column, line states normal/highlight/shade/secondary shade, auto-resize, outside-click close | exact; the map screen's assignment menus, the movement and door menus |
| Merc popup box (text box) | `Utils/MercTextBox.cc` | 9-slice of 10 px border tiles + tiled background, Ian wrap, styles BASIC (`tactpopup.sti`), red-on-white, blue-on-grey, laptop, I.M.P.; optional icon | exact; subtitles, message boxes, civilian quotes, laptop popups |
| Message box | `MessageBoxScreen.cc` | modal over a frozen backdrop, centred on the screen or a rect, width ≤ 300, button sets OK, YES/NO, CONTINUE/STOP, OK/REHIRE, generic two and three buttons, YES/NO/LIE, OK/SKIP, four numbered; keys y/n/Esc/Enter/o/1–4 on key-up; pauses the game (§1.4); the pointer warp onto the button is impossible in a browser (simplify, logged) | exact |
| Slider | `Utils/Slider.cc` | vertical steel, thumb `interface/sliderbox.sti`, range 0–127, wheel step | exact |
| Text field | `Utils/Text_Input.cc` | caret blink, Tab order, filter, max code points, bevel scheme; swallows keys while editing | simplify (no editor input types, no IME) |
| Progress bar | `Utils/Animated_ProgressBar.cc` | load bar at (162,427) 318×16, red for a sector, blue for a save | simplify (driven by client asset loading) |
| Fade | `Fade_Screen.cc` | darkens by the shade table 10 steps out, 8 in; speed tied to the loop rate | simplify: a multiplier over fixed steps of about 16 ms |
| Snapshot zoom | laptop open/close (`Laptop/Laptop.cc:1048`, `:1430`), A.I.M. video window, autoresolve opening, sector change (`Strategic/StrategicMap.cc:227-237`) | stretch a copy of the screen with nearest stepping | exact via render-to-texture; the sector-change zoom is deferred (§4.10) |

### 3.7 Screens, modals and frame order

The original switches whole screens (`ScreenIDs.h`, `Screens.cc:20-48`) with per-screen entry and exit flags inside
`HandleScreen`, pseudo-screens for message boxes and fades, a 16-bit frame buffer with dirty rectangles, background
save/restore rectangles and a save buffer. ja2-node keeps the observable rules and drops the mechanism:

- A client screen stack with explicit `enter`, `exit`, `update(now)`, `input(event)` and `render(drawList)`; leaving a
  screen deletes its widgets and regions.
- Modal layers (message boxes, popup menus, help, fades) receive input first; the screen under a message box neither
  updates nor takes input but stays visible (rendered without updating, or from a snapshot).
- Full redraw every frame from a retained widget tree; no dirty rectangles, background rectangles or save buffers.
  Fixed draw order per screen: background → content → buttons → tooltips → cursor.

### 3.8 Keyboard and hotkeys

- Events built from `keydown`/`keyup`: `repeat` → `KEY_REPEAT`; the key code from `event.key` when it is printable ASCII
  (lower-cased), else from `event.code` (Latin fallback for non-Latin layouts, like SDL3); keypad by `code` and NumLock;
  modifier masks Shift 1, Ctrl 2, Alt 4 (`src/sgp/Input.h:33-35`); `TEXT_INPUT` from printable keys without Ctrl/Alt.
- **Hotkeys as data per screen and per modal**: key, exact modifier mask or "any", event type (down, up, repeat),
  action id, optional condition. The original hard-codes whether each hotkey fires on key-down or key-up and which
  exact modifiers it needs; the tables keep both, which also makes remapping and alternative layouts possible.
- Text fields get keys first and swallow them while editing; held modifiers are polled (`_KeyDown`) for tactical
  cursors and actions.
- Browser collisions: Ctrl+W, Ctrl+T, Ctrl+N and Ctrl+Tab cannot be overridden; Esc leaves browser fullscreen unless
  the Keyboard Lock API is active (Chromium, fullscreen only); everything else is `preventDefault`-ed. Alt+Enter →
  Fullscreen API; Scroll Lock → Pointer Lock (optional); Print Screen → a PNG download of the logical frame (developer
  option). The full table of original hotkeys is in §4.12, §6.3, §7.14, §9.1; a remap UI is deferred, the tables are
  ready for it.

### 3.9 Widget vocabulary

Fifteen types cover every screen of `01` §5.2:

| Type | Properties | Original |
|---|---|---|
| `image` | asset (STI, PCX or MLG id), frame, position, palette variant (shade row), effect (normal, outline colour, outline shadow) | `BltVideoObject` |
| `fill`, `shade`, `hatch`, `line`, `rect` | rectangle, colour (RGB, or palette index + palette), factor (0.48, 0.8), pattern | `ColorFill`, `ShadowRect`, the hatch blitters, `LineDraw` |
| `text` | source (string key, format + args, binding), font, fg/shadow/bg indices, align and valign in a width, wrap (width, gap), Ian codes, ellipsis width, clip | `DrawTextToScreen`, `DisplayWrappedString`, `IanDisplayWrappedString`, `MPrint` |
| `frame` | border STI + piece map, background, margins | PopUpBox and MercPopUpBox borders |
| `textBox` | style, text, max width, margins, icon | `PrepareMercPopupBox` |
| `region` | rectangle, priority, cursor, tooltip, enabled, events → actions | `MSYS_DefineRegion` |
| `button` | asset + five frames, kind, text (font, colours, offsets, shift), icon, disabled style, sound scheme, cursor, tooltip, priority, enabled, checked, group | `GUI_BUTTON` |
| `group` | members, single selection, value binding | check box arrays |
| `slider` | style, position, length, steps, thumb, value binding, wheel step | `AddSlider` |
| `textField` | rectangle, scheme, max length, filter, tab order, value binding | `AddTextInputField` |
| `popupMenu` | position, border and background, font, lines (text, second column, state), actions, outside-click close | PopUpBox |
| `list` | row template, row step, binding, paging or scroll controls | mail list, save rows, sector inventory, merc lists |
| `progressBar` | rectangle, style, colours, value | `Animated_ProgressBar` |
| `modal` | message box style, text, button set, keys, centring rectangle | `DoMessageBox` |
| `custom` | rectangle, renderer id, parameters | tactical viewport, strategic map, radar, faces, inventory slots, item description, video, credits |

System parts not placed by layouts: the tooltip renderer, the software cursor, the region dispatcher, the modal stack,
fades and snapshots.

### 3.10 Layout format

**Files.** `data/layouts/original/<screen>.json` (one per screen or panel), validated by a JSON schema
(`src/ui/layout/schema.ts`). Coordinates come from Stracciatella constants, so the original layouts are SFI-SCLA-derived:
each file carries `"@derived": "Jagged Alliance 2 source code (SFI-SCLA) via JA2 Stracciatella"` and `"@src"` (the
source files), and numeric constants are referenced by name from **generated** constant tables:
`tools/transcribe/ui-constants.ts` extracts the `#define`, `static const` and enum values of the listed source files
into `data/tables/ui-constants/<file>.json` (regenerated, never edited, per CLAUDE.md); a layout may also hold a literal
where the source uses an inline literal, with the line in `@src`. Layouts never contain original data; stub skins
override assets, not positions.

**What the format expresses.**

1. **Frame and anchors**: `std640` (the centred 640×480 frame), `screen` (the whole logical screen), `tacticalPanel`
   (origin `INTERFACE_START_X/Y`), `tacticalInventory` (`INV_INTERFACE_START_Y`), `viewport`; per-widget `anchor`
   for full-screen items (`bottomCenter`, …). Positions are integers relative to the frame.
2. **Assets**: `{sti}`, `{pcx}`, `{mlg}` (resolved per data version), frame indices, button frame sets
   `{grayed, offNormal, offHilite, onNormal, onHilite}`.
3. **Fonts and colours**: font by macro name; colours as palette indices resolved through the font (named constants
   allowed), RGB for fills; shadow always explicit.
4. **Text**: `{key: [table, index]}` (the L10n tables of `data/externalized/strings`), `{format, args}`, `{bind}`,
   `{edt: [file, row]}` for EDT text; `{literal}` only in debug layouts.
5. **Input**: priority by name or number (`HIGH+10`), cursor by `CursorTypeDefines` name, tooltip source, actions per
   event (`primary`, `secondary`, `wheelUp`, `wheelDown`, `hover`), sound scheme.
6. **Groups and repeats**: `repeat` with count (number or binding), `dx`/`dy` or explicit positions, a template, and
   `$i` for bindings.
7. **Conditions**: `visible`, `enabled`, `checked` as a binding, its negation, or a small comparison (`{eq: [a, b]}`);
   no expression language.
8. **Order**: draw order = document order; input order = priority, then later in the document wins (the original's
   newest-first).
9. **Hotkeys**: `{key, on: down|up|repeat, mods, action, when?}`.
10. **Custom widget parameters**: geometry the renderer needs (slot table, grid spacing, panel origin).

**Bindings contract.** Each controller exports `actions` and `bindings` (names with types). `pnpm check` runs a test
that loads every layout of every skin, checks the schema, the bindings contract, and that every asset, frame index,
font, cursor and string key resolves on the stub pack; with `JA2_DATA_DIR` the same test checks the original STIs and
that frame sizes fit the layout rectangles (structure only, no image is written).

**Modern layouts later.** They may use other frames and anchors relative to the logical screen, RGB colours and
system fonts rendered into a glyph atlas at load (`{font: {system: "…"}}`), and may combine, hide or move widgets, but
they call the same actions. Nothing in M8 depends on a second skin; the contract test keeps the door open.

### 3.11 Blit effects

| Effect | Original | WebGL |
|---|---|---|
| Transparent indexed blit through the object's palette | `BltVideoObject` (`src/sgp/VObject.cc:228-246`) | existing indexed shader |
| Shaded palette (scale or luminance tint) | `Create16BPPPaletteShaded` (`src/sgp/HImage.cc:96-127`): dead and greyed faces, laptop portraits, autoresolve | extra palette rows |
| Mono-shadow text | §3.4 | text shader |
| Solid fill, right/bottom exclusive | `ColorFillVideoSurfaceArea` (`VSurface.cc:190-214`) | quad |
| Darken rectangle ×0.48, inclusive | `ShadowRect` (`VSurface.cc:131-148`): disabled buttons, tooltips (twice), `TEXT_SHADOWED`, map dimming, popup backdrops | multiply blend |
| Darken ×0.8 | low-percent shade table: fades, splash | multiply blend |
| Hatch (black checkerboard from the rect origin) | `VObject_Blitters.cc:1807-1866`: disabled buttons, faces, slots, shop, map screen | fragment pattern |
| Loose hatch with colour (1 in 8) | `:1868-1889`: tactical placement | fragment pattern |
| Outline (index 254 in a colour or skipped) | `:2227-2280`: item graphics, the item cursor | index filter + colour |
| Outline shadow (non-254 darkens ×0.48) | `:989-1003`: item drop shadows | multiply with a mask |
| Lines and rectangles, inclusive | `src/sgp/Line.cc:341-347` | thin quads |
| Nearest stretch | `BltStretchVideoSurface` | textured quad |
| Clip rectangle | `SetClippingRect` | scissor |

A final 565 quantisation is a one-line shader option, on for screenshot comparisons. Brightness is a client setting
multiplying the frame (Stracciatella has no gamma ramp).

---

## 4. Front-end screens

All coordinates are in the `std640` frame. Text comes from the L10n tables Stracciatella externalized
(`data/externalized/strings/translation-*.json`, served by `/api/strings`) unless an EDT file is named. The launcher's
DOM-free logic is reused (§4.13).

### 4.1 Screen flow

```
splash video (intro/splashscreen.smk; MLG still on other data versions) → interface/sirtechsplash.sti → fade
  → MAIN MENU ── New Game → GAME INIT ── Cancel/Esc → main menu
     │                          └─ Start → confirmations → (Dead is Dead: SAVE screen names the save) → beginning videos
     │                                                      → laptop (nobody hired)
     ├─ Load Game → SAVE/LOAD (load) → loading screen → the saved screen (map, tactical or laptop)
     ├─ Preferences → OPTIONS (Save disabled) ── Load → SAVE/LOAD; Main Menu → confirm → main menu
     ├─ Credits → CREDITS → main menu
     └─ Quit
in game: o → OPTIONS; Ctrl+S / Ctrl+L → SAVE/LOAD; Alt+S / Alt+L quick save/load; h → help; Alt+X → "exit game?"
story: meanwhile box → (scene deferred, §10.1) → back; Queen's death → ending videos → CREDITS → main menu
```

`docs/27` §4.1 tables the video sequences; `src/app/video/sequences.ts` plays them.

### 4.2 Main menu (`MainMenuScreen.cc`) — exact

- Art: `loadscreens/mainmenubackground.sti` at (0,0), `loadscreens/ja2logo.sti` at (188,15) (`:56-57`, `:368-372`);
  five buttons from the MLG `MLG_TITLETEXT` picture (`loadscreens/titletext.sti`) with frames (grayed, off, hilite, on):
  New 0/0/1/2, Load 6/3/4/5, Preferences 7/7/8/9, Credits 13/10/11/12, Quit 14/14/15/16 (`:330-338`), centred on the
  logical screen width at y = 277 + 37·i (`:48-49`, `:340-349`); version bottom left `FONT10ARIAL` white at (10,465) and
  `gzCopyrightText` centred at y = 465 (`:374-381`), both on the whole logical screen.
- State: Load is grayed when no save exists (ja2-node: `GET /api/saves` lists ja2-node and native saves; the original
  counts every `.sav`, `SaveLoadScreen.cc:1427-1430`). The version label shows the package version and commit
  (`/api/health` `engine`).
- Actions: New → game init; Load or `c` → save/load in load mode; Alt+click Load or Alt+C → load the newest save at
  once; Preferences or `o` → options; Credits or `s` → credits; Quit, Esc, Ctrl+Q → leave (§4.11).
- Music: with no session the client plays `MAIN_MENU` itself (the session computes the mode only in game, `docs/27`
  §3.7); the original starts it on the last frame of the fade after the splash (`:118-145`).

### 4.3 Game init options (`GameInitOptionsScreen.cc`) — exact

- Title `gzGIOScreenText[0]` `FONT16ARIAL` white centred at y = 68; four radio groups: Difficulty (80,150), Guns
  (350,150), Save mode (80,300), Style (350,300); group label 35 px above, option text at x + 20, boxes at x + 155,
  y − 9, rows 35 px apart (`:39-74`); Iron Man and Dead is Dead get a `FONT12ARIAL` explanation 220 px wide
  (`:482`, `:486`); Start (141,418) and Cancel (379,418) from `interface/preferencesbuttons.sti` 0/2 and 1/3,
  `FONT14ARIAL` colour 73. Background `interface/optionsscreenbackground.sti`, shadow rectangle (48,55)–(592,408),
  boxes `interface/optionscheck.sti`.
- Start: Iron Man → YES/NO warning (No resets to save anywhere), Dead is Dead → its warning, then the difficulty
  confirmation `zGioDifConfirmText[difficulty]`; Dead is Dead → an OK box, then the save screen in save mode to name the
  save; else fade, music off, the beginning videos. Cancel or Esc → main menu. **Enter goes through the same
  confirmations** (the original's Enter skips them and, with Dead is Dead, reaches the save screen without the marker;
  logged as a deviation).
- ja2-node: `campaignRequest` (`src/app/launcher/campaign-form.ts:79-103`) → `POST /api/sessions {campaign: {options,
  deadIsDeadName?, hire: []}}`: **`hire: []`** opens the laptop with nobody hired as the original does (the default
  squad and "land at once" stay launcher and developer options). Blood and gore is not on this screen in the original
  (it is a per-user toggle on the options screen) but is a campaign option in ja2-node (`docs/27` §2.2): the GIO sends
  the client default `bloodAndGore` (a new client setting edited on the options screen). The Dead is Dead name: the
  server derives a valid save name from the typed description (`POST /api/sessions {campaign: {deadIsDeadDescription}}`),
  with the same slug rule as player saves (`docs/27` §1.6).

### 4.4 Options (`Options_Screen.cc`, `GameSettings.h`) — exact for the original elements

- 23 toggles in two columns (11 + 12; Stracciatella shows the three vanilla hid): speech, mute confirmations,
  subtitles, key-advance speech, animate smoke, blood and gore, don't move mouse, old selection method, always show
  movement path, show misses, real-time confirmation, sleep/wake notification, metric system, merc always lit, smart
  cursor, snap cursor to door, glow items, tree tops, wireframe, 3D cursor, merc casts light, hide bullets, tracking
  mode (`GameSettings.h:9-54`, defaults `GameSettings.cc:144-166`); three vertical sliders (effects, speech, music,
  0–127); Save, Load, Main Menu, Done.
- Art and layout: `interface/optionscreenbase.sti`; the MLG `MLG_OPTIONHEADER` frames 0 at (0,0) and 1 at (0,434);
  buttons frames 2/3 at y 438, x 51, 190, 329, 469 (`:56-60`); check boxes `interface/optionscheckboxes.sti` at x 265
  and 428 from y 89, 27 px apart (`:63`, `:75-77`); labels `FONT12ARIAL` colour 73 at box + 30, wrapped at 143 px,
  white when highlighted; tooltips `zOptionsScreenHelpText[i]` on box and label; slider labels centred in 45 px at
  x 38, 85, 137, y 87; sliders at x 56, 107, 158, y 126, length 258 (`:82-102`).
- Behaviour: a toggle applies at once; speech and subtitles cannot both be off (message
  `OPT_NEED_AT_LEAST_SPEECH_OR_SUBTITLE_OPTION_ON`; `speechOrSubtitlesKept` in `src/app/launcher/settings-panel.ts:51-56`);
  the effects and speech sliders play a test sample 75 ms after they stop (`sounds/weapons/lmg reload.wav`,
  `battlesnds/m_cool.wav`), music applies at once; Save is disabled from the main menu, by `canSave` and in Dead is
  Dead; Main Menu asks YES/NO, then closes the session (§12.3 `closeSession`, the Dead is Dead save point); Done or Esc
  saves the settings and returns; on exit tree tops, item glow and smoke changes apply to the world.
- ja2-node mapping: `speech`, `muteConfirmations`, `subtitles`, `keyAdvanceSpeech`, `sleepWakeNotification`, the other
  17 under `display.*` (`src/app/settings.ts`), `volumes.effects/speech/music`; blood and gore → `setOption
  {bloodAndGore}` in a session (`docs/04` §6.23) and the client default otherwise. None of the 17 display toggles has a
  UI today; M8 makes every one of them take effect (§17 lists any that stay inert). "Don't move mouse" is always
  effectively on (no pointer warp in a browser; deviation). ja2-node extras (ambient and master volume, playback speed,
  language, splash and intro switches, export and import) stay in the launcher: the original screen has no free space.

### 4.5 Save/load (`SaveLoadScreen.cc`) — exact layout on Stracciatella's list model, simplified scroll bar

- ja2-node saves follow Stracciatella's named list (`docs/27` §1.6): 11 rows on screen out of a scrolling list, newest
  first; in save mode quick and auto saves are hidden and the first row is "create new savegame" (`MSG_NEW_SAVE`). Row
  fields: `Day N, hh:mm`, location, `n merc(s)`, balance, description, a Dead is Dead mark; in load mode a tooltip with
  difficulty, save mode, guns and style (`:808-965`, `:874-904`).
- Art: `interface/loadscreen.sti`; the MLG `MLG_LOADSAVEHEADER` frame 0 (load) or 1 (save) at (0,0); Cancel 6/9, Load
  4/7, Save 5/8 at x 329 and 123, y 438, `FONT14ARIAL` colour 73, the action button hatched when disabled. Rows: vanilla
  draws them from `loadscreenaddons.sti` frames 2 and 3 (605 px); Stracciatella narrows rows to 575 px for its own
  scroll bar art (`sti/interface/save-load-addons.sti`, `scroll-bar.sti`), which is **Stracciatella's asset, not game
  data**. ja2-node uses the original row frames clipped to 575 px and draws the scroll bar with widget primitives.
  Row origin (17,49), height 30, pitch 35; fields at x + 13, 95, 196, 260, 318; `FONT12ARIAL` with per-state colour and
  shadow; the description field `FONT12ARIALFIXEDWIDTH`, 46 code points (`:70-121`, `:1095-1121`).
- Actions: click selects (save mode, new row: opens the description field), double click saves over or loads, right
  click clears the selection, wheel and arrows scroll, Enter saves or loads, Delete asks and deletes, Esc clears the
  selection first, then leaves. Save → `save {description}` or `{name, description}` (overwrite asks
  `SLG_CONFIRM_SAVE`); load → one warning box from `predictLoadWarnings` (`src/app/launcher/save-rows.ts:145-158`), then
  from the main menu `POST /api/sessions {load}`, in game the WebSocket `load` in place (a fresh `welcome`), then the
  screen of the header's `flow`; a load error stays on the screen (the session is untouched).
- Location column: the header carries the sector code only (deviation "Save list in the launcher"); the canvas has the
  strategic tables and prints `GetSectorIDString`'s town or land-type form, closing that deviation for the canvas.
- Native saves can be listed in load mode with a mark (`saveRow` handles both kinds); download, upload and "load into
  another session" stay in the launcher.

### 4.6 Message box (`MessageBoxScreen.cc`, `Utils/MercTextBox.cc`) — exact, built once

The `modal` widget (§3.6). Styles: BASIC (`interface/tactpopupbackground.pcx` tiled, `interface/tactpopup.sti` 9-slice,
`interface/popupbuttons.sti` 61×20 or small 31 px, `FONT12ARIAL` white, 10 px margins), red-on-white and blue-on-grey
(laptop), I.M.P., laptop; icons `interface/msgboxicons.sti`, `msgboxiconskull.sti`. Labels `pMessageStrings` (OK, YES,
NO, LIE, SKIP, REHIRE). The launcher's `MessageBox` interface (`confirm`, `alert`, `src/app/launcher/message-box.ts`)
gains the other button sets and a canvas implementation.

### 4.7 Help screens (`HelpScreen.cc`, `HelpScreenText.h`, `binarydata/help.edt`) — exact, scheduled late

- Overlay 412×292 with page buttons (320×292 without), centred on the screen, vertically on the tactical or map viewport,
  in the laptop on the monitor; title `FONT12ARIAL` white, the "(press H)" subtitle, page buttons `FONT10ARIAL`, text
  `FONT10ARIAL` white in a 280 px column with 228 px visible and a scroll box (a filled rectangle with bevel lines),
  close button, "don't show again" check box when it came up by itself (`:39-118`, `:1792-1925`).
- Content: laptop (8 pages), map screen (8), map "no one hired yet", "not yet in Arulco", sector inventory, tactical
  (6) (`HelpScreen.h:7-20`); rows of `help.edt` (records of 640 characters) with the Ian codes; ja2-node reads them
  through `/api/text`.
- When: on entering tactical, the map screen, the laptop and the sector inventory if the screen's bit is set, after two
  frames; `h` forces it; keys Esc, Up/Down, PgUp/PgDn, Left/Right. The "seen" mask is saved per campaign in the original
  (`SaveLoadGame.cc:1916`) and zeroed by a restart: ja2-node keeps it in `localStorage` keyed by campaign id; the stub
  pack needs a small `help.edt`.

### 4.8 Credits (`Credits.cc`) — exact

`interface/credits.sti` background with 15 developer faces (`interface/credit faces.sti`; the closed-eye frame of face i
is frame 3·i at the face's eye position), each blinking at its own rate (eyes closed 150–300 ms); the text scrolls up
1 px every 25 ms in a 210 px column at x 10; hovering a face shows name, title and a joke line at (375, 420/435/450),
`FONT12ARIAL` white, 260 px centred; body `FONT12ARIAL`, titles `FONT14ARIAL` with the `C`/`R` colour codes; Esc ends.
The roll logic exists (`src/app/credits/roll.ts`, `rows.ts`, parser `src/content/formats/credits.ts`); the DOM
scroller (`scroller.ts`, deviation "Credits screen", **M8**) becomes a canvas renderer. After the ending the credits
play in silence.

### 4.9 Fades (`Fade_Screen.cc`) — simplify

Fade-out darkens 10 steps then black, fade-in 8 steps; used by GIO → intro, loads, meanwhile, the Queen's death, the
end cinematic and the main menu after the splash. A multiplier over fixed steps of about 16 ms; no cursor during a fade.

### 4.10 Loading screens (`Loading_Screen.cc`, `Utils/Animated_ProgressBar.cc`) — exact image and bar

- The picture by sector and day/night (`GetLoadScreenID`, `:25-97`): game just started → helicopter; sectors in
  `data/externalized/loading-screens-mapping.json` → their day or night picture; SAM sector → SAM; else by
  traversability (town → one of two town pictures, sand, farmland/road, plains, forest/swamp, tropics/water); level 1 →
  mine, levels 2–3 → cave. Pictures `loadscreens/ls_*.sti` (640×480 RGB565).
- **The town choice draws `Random(2)` from the gameplay generator** at every sector entry outside a save load and the
  PBI transition (`:48-51`, `Strategic/StrategicMap.cc:245-253`) and again at every save for the header
  (`SaveLoadGame.cc:372`). Since U3a ja2-node simulates the entry draw (its result is `sectorLoaded.loadScreen`, so the
  client shows the right picture) and logs the save-time draw as a deviation (a ja2-node save never changes the state,
  `docs/27` §1.3).
- Bar at (162,427), 318×16, red for a sector, blue for a save load, filled from x + 2; driven by the client's preload
  (§2.5).
- The 2 s zoom from the map into the sector (`StrategicMap.cc:196-243`) is deferred (cosmetic).

### 4.11 Exit, quit and errors — exact box, browser semantics

- Alt+X in tactical, the map screen, the laptop, the shop, autoresolve and the overhead map: YES/NO `MSG_EXITGAME` in the
  screen's style (`GameLoop.cc:278-311`); Yes leaves the game for the main menu (the session stays on the server unless
  the player chose Main Menu in the options, which closes it, §12.3). The main menu's Quit goes to the launcher; a bare
  Esc on the main menu does nothing (an accidental key in a browser; deviation).
- The original's error screen is a debug screen; ja2-node shows a "connection lost / server error" panel with a retry.
  A laptop, map or tactical screen that cannot open (its load throws, or the host has no session client for it) shows
  the debug layout `screen-unavailable` (`front-end/screen-unavailable.ts`): which screen could not open, the reason
  (`ui/client/failure-text.ts` names the browsers' network failures, "Failed to fetch" and its Firefox and Safari
  wordings, a lost connection and keeps their words; any other error stays as it is), the session, the in-game keys,
  Retry (Enter; reconnects to the session, then enters the game again, and shows the panel again with the new reason
  if that fails) and Main menu (leaves the session running). A `/play` page that fails to boot shows the same heading,
  reason and Retry (a reload) as plain HTML, since the game's fonts may not have arrived. A WebSocket that drops during
  play is not handled yet.
- The San Mona brothel screen (`JAScreens.cc:416-499`): black, no cursor, `interface/luckysmile.sti` centred (frame 0
  for 24 ticks, then frames `n % 8`, 32 ticks of 100 ms, then 1 s) with `sounds/sex.wav`, then a fade into tactical.
  **The original then warps game time by `5 + Random(20)` minutes without processing events** (`:478-483`); ja2-node
  emits only `sexScene` (`docs/25` row 122 calls the action presentation only). M8 simulates the warp and its draw at
  the action (§12.5).
- The original has no defeat screen (`docs/26` §6.8).

### 4.12 Front-end hotkeys

| Keys | Where | Effect |
|---|---|---|
| c, o, s, Esc, Ctrl+Q, Alt+C | main menu | load, options, credits, (Esc: nothing in ja2-node), quit, load newest |
| Esc, Enter | game init | cancel, start (through the confirmations) |
| Esc, S, L | options | done, save screen, load screen |
| Up/Down, Enter, Delete, Esc | save/load | move, save/load, delete, clear or leave |
| y/n/o/Enter/Esc/1–4 (key up) | message boxes | the box's buttons |
| Esc, Up/Down, PgUp/PgDn, Left/Right | help | close, line, page, previous/next page |
| Esc / Space / click | intro videos | end the sequence / end the video |
| Esc | credits | end |
| Alt+X | tactical, map, laptop, shop, autoresolve, overhead map | "exit game?" |
| Alt+Enter | everywhere | fullscreen |
| Ctrl+S, Ctrl+L, Alt+S, Alt+L, o, h, v | tactical, map | save screen, load screen, quick save, quick load, options, help, version message |

### 4.13 What the launcher gives the canvas screens

| Module | Reuse |
|---|---|
| `src/app/launcher/api.ts` | as is |
| `campaign-form.ts` | `ORIGINAL_OPTIONS`, `campaignRequest`, the GIO builds a `CampaignForm` with `squad: 'laptop'` |
| `save-rows.ts` | as is (rows, formats, warnings, overwrite target, description clamp, quick-save ids) |
| `save-panel.ts` | its flows (save, load with warnings, load in place or into new, delete, refusal texts) move into a DOM-free save controller over the `MessageBox` interface, used by the launcher and the canvas |
| `labels.ts`, `string-ids.ts`, `printf.ts` | move to `ui`; `string-ids.ts` gains the option, message and save/load ids the screens use (`Utils/Text.h:312-373`, `:1147-1187`) |
| `src/app/settings.ts`, `settings-file.ts` | as is, plus `bloodAndGore` and the per-campaign help mask |
| `main.ts` | the "click to start" audio unlock and splash-once-per-tab logic, the new-campaign sequence |
| `src/app/video/*`, `src/app/credits/roll.ts`, `rows.ts` | as is |

---

## 5. Tactical screen: panels

Geometry (`UILayout.cc:57-138`): the team panel is 120 px high at `H − 120` (6 slots × 83 px + a 142 px button box);
the single-merc (SM) panel is 140 px high at `H − 140` and overlaps the bottom 20 px of the viewport (the viewport
always ends at `H − 120`; only the mouse window moves). Above 640×480 the bar is centred, the team panel has
`max(6, min(squad_size, (W − 142)/83, 12))` slots (extra slots copy the sixth slot's art), the SM panel repeats its art
and stretches a filler from `interface/overheadinterface.sti`, and the sides are black (`Interface_Panels.cc:852-901`).
Panel switching (`SetNewPanel`, `Interface_Control.cc:62-90`): right-click a team face → SM panel (not for the dead,
EPCs, passengers), right-click the SM face → team panel, `` ` `` toggles, non-merc bodies and EPCs force the team panel.
Layout constants: `Interface_Panels.cc:84-251`, `Interface_Items.cc:88-183`, `UILayout.cc`. Draw order: panel art →
face → overlays → slots → popups.

### 5.1 SM panel (`RenderSMPanel`, `Interface_Panels.cc:1245-1440`) — exact

| Element | Reads | Notes |
|---|---|---|
| `inventory_bottom_panel.sti`, face plate (gold when selected on our turn, other plate when disabled for items) | selection, turn | |
| Face 48×43 at (13,6) | §5.5 | |
| Life, breath, morale bars at (69,47) | `life`, `lifeMax`, **`bleeding`**, `breath`, **`breathMax`**, **`morale`** | §5.6; tooltip life/max, breath/max, morale text |
| AP (67,53) `TINYFONT1`, only in combat above OKLIFE | `ap`; dark red when below the cost to attack the last target, light yellow in stealth | **`apToAttack`** or simplify the colour |
| Name (11,53) `BLOCKFONT2` | `name`, **`stealth`** | |
| Ten stats, labels colour 6, values colour 5, `"%3d"`; green for 60 s after a rise, red after a fall | **`stats`** (agility … medical, level) | flashes from `statChanged` events |
| Armour %, weight %, camo % | **`armour`, `weight`, `camo`** computed by the server | `ArmourPercent` (`Weapons.cc:123-147`), `CalculateCarriedWeight` |
| Body figure (four bodies, `_h` highlight variants), drop target for camo kits, canteens, elixir | body type | `applyItem` |
| 19 slots (§5.3), key ring icon, money region | `inventory`, `keys` | money: the money box, `withdrawCash`, `depositCash`, `splitMoney` (§12.4, U7) |
| Buttons: stance up/down, stealth indicator, climb, burst mode, look, level view, hand, talk, mute, prev/next, options, Done, Map | §5.2 | |
| Stracciatella's `gui_extras` stat progress bars | hidden profile progress | **deferred, off**: they reveal hidden state (D16), vanilla has them off |

### 5.2 SM and team panel buttons

| Button | Action | Enabled (original) |
|---|---|---|
| Stance up / down | `stance` | not standing / a valid lower stance; all action buttons off when not the selected merc, below OKLIFE, not our turn, or the panel is disabled for items |
| Stealth (stance indicator) | **`stealth {soldiers, on}`** (new, §12.4) | as stance |
| Climb | `climb`; the fence jump needs **`jump`** (new) | lower or higher level reachable with APs, or a fence |
| Burst mode | **`weaponMode {soldier}`** (new): normal → burst → under-barrel launcher | burst-capable gun or attached launcher |
| Look, hand, talk | the client cursor modes (§6.1) | |
| Level view | client view level | |
| Mute | **`mute`** (new; a presentation flag the server keeps so speech and sound agree) | |
| Prev / next merc | client selection | |
| Options | options screen | not with an item in the cursor |
| Done | `endTurn` | our turn in combat |
| Map screen | `mapScreen` (boxing: "abandon fight?" → `abandonFight`) | not in a conversation or the pickup menu |
| Team panel: End turn, Map, Squad (radar ↔ squad list) | `endTurn`, `mapScreen`, client | |
| Team face left/right click | locate/select (continue move with **`continueTo`**), open SM panel | |
| Team hand slots | right click `swapHands`; second hand of a driver → **`leaveVehicle`** in tactical | |

While an item is in the cursor or a stack or key-ring popup is up, every action button, Options, Done, Map and the radar
are disabled; prev/next stay enabled so the item can be carried to another merc. Inside the shop only the inventory and
prev/next work. Buttons whose command does not exist yet are disabled, not faked in the client (a client-only stealth
flag would desynchronise sound and noise).

### 5.3 Inventory slots and items (`Interface_Items.cc`) — exact; cursor simplified

- 19 slots at `UILayout.cc:72-90` (tactical) and `:93-111` (map screen), sizes from `gSMInvData`; what fits where is the
  server's (`placements` hint, §2.4), never re-implemented.
- Per slot: the second hand covered by `secondary_gun_hidden.sti` under a two-handed weapon; the small item graphic
  centred with a drop shadow at (−2,+2) and the index-254 outline (transparent; white for compatible items; a grey ramp
  for new items, 20 steps every 100 ms for 4 cycles); the hatch when the cursor item cannot go there; a 2 px status bar
  at (x−5, y+21), 20 px; texts in `TINYFONT1`: rounds left coloured by ammo type, "JAMMED" (needs **`jammed`**), stack
  count, `*` for attachments, `*`/`+` for burst or launcher mode; tooltip with name, calibre (not for Gun Nut where the
  calibre says so), `[imprint]` (needs **`imprint`**), attachments.
- Compatible-item highlight after 100 ms on a slot; with an item in the cursor the squad faces of mercs with compatible
  items get a red rectangle.
- Item graphics: small `interface/mdguns.sti`, `mdp1items.sti`, `mdp2items.sti`, `mdp3items.sti`; big
  `bigitems/*.sti`; world tiles from the tileset's GUNS/P1ITEMS/P2ITEMS/P3ITEMS. `ItemDef`
  (`src/content/items/items.ts`) parses `inventoryGraphics` and `tileGraphic` and `GET /api/items` serves them since U3a.
- **Item cursor** (deviation "Item cursor", already accepted): the client keeps a local selection (soldier, slot, count,
  index) drawn as the mouse cursor and turns the drop into one command: `moveItem`, `attach`, `moveItem {merge}` after
  the merge prompt, `reload`, `drop`, `give`, `applyItem`. A swap shows the displaced item back in its slot; a cursor
  item does not survive a switch to the map screen.
- Missing commands: CTRL+click stack combine (**`combineStack`**), key-ring editing (deferred), tossing and catching
  (**Later**); the money split and withdraw/deposit came with U7 (§12.4).

### 5.4 Popups: stack, key ring, item description, pickup menu

- **Stack popup** (`Interface_Items.cc:3582-3763`) — exact: `extra_inventory.sti` cells, up to 6 per row, centred on the
  slot, panel shaded behind; take or insert one object (`moveItem {count: 1, index}`), right-click describes it.
- **Key ring** (`:3795-3936`) — exact view (28 cells, 7 per row, the key item's graphic, the count, sector and day found
  on right click); editing deferred (no commands).
- **Item description box** (`:1651-2661`) — exact: tactical 320×133 at panel x+214, y+1 over the stats area
  (`infobox.sti`), map screen 272×268 (`iteminfoc.sti`). Big picture with shadow, status bar, name `BLOCKFONT2`,
  calibre and type, wrapped description, pros and cons, weapon stats (weight by the metric option, status, range,
  damage, AP, burst AP; white when exceptional), ROF bullets, the ammo button (`unload`), four attachment slots
  (`attach`, `detach`, the "permanent?" box), the money box (split, deferred outside give and trade). The computed stats,
  pros and cons come from the **`itemInfo`** hint.
  **Rule finding:** closing the box in combat charges `AP_RELOAD_GUN` once when the attachments changed
  (`Interface_Items.cc:2530-2588`, also vanilla); ja2-node's `attach`/`detach` charge nothing (`docs/12` §5). §12.5.
- **Item pickup menu** (`:4279-4647`) — simplify: the original opens it after the merc reaches a tile with several
  items and pauses the game; ja2-node's `pickUp {items}` chooses before the walk, so the client opens the same menu
  (`interface/itembox.sti`, 6 rows per page, world tile graphic at shade 4, `BLOCKFONT2` names, All/OK/Cancel, wheel)
  when the player clicks the tile and sends one `pickUp` (deviation). `ItemView` gains `money` and `attachments`.

### 5.5 Faces (`Tactical/Faces.cc`) — exact

- Files: small `faces/NN.sti` (48×43), big `faces/bNN.sti`, `faces/33face/`, `faces/65face/` (map screen list),
  `faces/bigfaces/` (laptop); `NN` = the profile's face index; Elliot's beaten variants by `bNPCData`; Herve, Peter,
  Alberto and Carlo share a face. Animated STIs: 0 face, 1–4 eyes (lid down, lid up, frown, surprise), 5–7 mouth.
- Eye and mouth positions, blink and expression frequencies from the profile (`prof.dat`; recruited RPC small faces
  from `mercs-rpc-small-faces.json`). The profile endpoint serves them since U3a (§17.4).
- Blink every `blinkFrequency ± Random(2000)` ms (frames 1 → 2 → 0, steps of 50 + Random(30) ms); while talking a frown
  or surprise every `expressionFrequency` ms; no blinking asleep, below OKLIFE or as a prisoner. Client PRNG.
- **Lip sync** (`MouthAutoFace`, `:552-612`): while the face talks, the mouth is closed while the playing sample is
  inside a gap of its `.gap` list (`src/content/formats/gap.ts` decodes them), otherwise a new random frame every
  120 ms; with speech off the face talks for the subtitle duration. After the sample, 300 ms closed. The face polls the
  audio engine's handle for its speech.
- Overlays: closed eyes and hatch below consciousness, `p_dead.sti` + hatch when dead, the selection rectangle (white,
  blue moving, yellow stealth moving), red rectangle for compatible items, the enemy count box, the hatch when the merc
  cannot act, assignment icons (`portraiticons.sti`), blinded/adrenaline/drunk icons; hit flash from white to red at
  150 ms while hit; shades below OKLIFE and at 0 AP.

### 5.6 Bars (`Interface_Utils.cc:131-178`) — exact

Three bars 3 px wide, 42 px high at x, x+6, x+12: life red `bLife`, pink bandaged part `lifeMax − life − bleeding`,
yellow bleeding part on top; breath on `bars.sti` (gold for the selected merc on our turn), black up to `breathMax`,
dark blue for `breath`; morale green. Nothing at life 0. Needs `bleeding`, `breathMax`, `morale` (finding 30 of `27`).

### 5.7 Radar and squad list (`TileEngine/Radar_Screen.cc`) — exact

88×44 at the team panel's right box: the sector's `radarmaps/<map>.sti` (darkened at night on the surface), the green
viewport rectangle, 2×2 dots for visible soldiers by team colour (selected merc blinking, own on a roof yellow,
unconscious enemies grey, hostile civilians red, named civilians blue); click and drag move the camera. The squad
button swaps it for the squad list (`squadpanel.sti`, `COMPFONT`, current squad light green, others present dark green,
absent black); choosing a squad sets the client's current squad. Blank during meanwhile scenes.

### 5.8 Talk panel and speech (`Tactical/Interface_Dialogue.cc`, `Dialogue_Control.cc`, `Utils/MercTextBox.cc`)

- **Speech presenter** (client, DOM-free in `ui`): the simulation finishes lines in ticks (60 ms per character,
  deviation "Speech") and never waits; the client queues the lines as playback reaches the frames that carry them
  (`npcQuote`, `mercQuote`, `civQuote`, `skyriderQuote`, `headMinerQuote`, conversation lines; a conversation
  command's ticks arrive as frames like an advance, `04` §6.28), plays the speech sample, shows the subtitle box for
  the sample's length (`chars × 60 ms` without a voice) + 300 ms, honours Backspace (stop), click and key-advance, and
  routes a line to its surface (talk panel, comm popup, external NPC popup, civilian box, message log `Nick: "text"`).
  Lines need `chars` and `textKey`: `ConversationLineView` lacks `chars`, own-merc barks and contract quotes,
  `skyriderQuote` and `headMinerQuote` lack `textKey` (§12.1).
- **NPC talk panel** — exact (constants `Interface_Dialogue.cc:100-133`): the NPC's big face, the menu (friendly,
  direct, threaten, recruit, repeat, buy/sell, give where applicable, Done), the busy shading while the NPC speaks or a
  line waits in the presenter's queue or in a received frame not yet played (the original shades while the face talks
  or the dialogue queue is not empty), the subtitle popup oriented by the panel position (parameterise the original's
  hard-coded 340 and the viewport bounds). Commands: `talk`, `answer` on the conversation menu, `closeTalk`
  (`docs/04` §6.12). Elliot's face variant needs a `faceVariant` in `ConversationView`.
- **Comm popup** (merc lines in tactical: face, bars, sector line) and the **external NPC popup** (Skyrider, head miners)
  — exact; the map-screen locator during speech comes with the map screen.
- **Civilian quote box** — exact (placement, lifetime, a click only closes).
- The original pauses the map screen during merc lines; ja2-node's strategic time is simulation (deferred, deviation).

### 5.9 Shop (`Tactical/ShopKeeper_Interface.cc`) — exact layout, client shop model

- Full screen at the top-left (the shop ignores `STD_SCREEN_X/Y`; ja2-node centres it in `std640` like the other fixed
  screens, a visible difference only above 640×480: deviation row or follow the original, decided in §18), layout
  constants `ShopKeeper_Interface.cc:73-221`: background and title, the dealer's face with subtitles, the dealer grid with
  pages and page buttons (wheel), the dealer's offer area with total cost, the player's offer area with total value, the
  balance, Transaction and Done, the SM panel below with only inventory and prev/next active.
- The item tile (shared with the slots): sprite, shadow, status bar, price or repair ETA, count, owner face, star,
  overlays, hatch, cross-out.
- **ShopModel** (DOM-free): the offer areas are client state priced by `quoteTrade` on every change; Transaction sends
  `trade`; Done sends `closeShop`. `quoteTrade` must keep the evaluation quote ids and the planned player-area entries
  (repair parts), and the pricing merc must change without a trade (**`setShopPricing {soldier}`**, visible with Flo's
  modifier) (§12.1).
- Simplified: purchases, change and repairs go straight into pockets with the new-item glow (the original drops them
  into the player area first). Deferred: withdraw/deposit, drop to ground, rearranging the inventory inside the shop.

---

## 6. Tactical screen: input, cursors and overlays

### 6.1 The UI state machine (`Handle_UI.cc`) — exact, as client code

`HandleTacticalUI` (`Handle_UI.cc:374-602`) turns input into one of 53 events (`Handle_UI.h:92-185`) and switches among
20 modes (`:45-68`); real time and turn-based share the machine with separate mouse handlers
(`Real_Time_Input.cc`, `Turn_Based_Input.cc`) and one keyboard handler. ja2-node ports it one to one as code in
`src/ui/screens/tactical/` with the original mode and event names; every rule check inside a handler becomes a server
answer (§2.4); the cursor composition and art are transcribed tables. Modes that matter: idle, move, confirm move,
action, confirm action, hand cursor, look, talk, jump over, adjust stance, menu, rubber band (real time), lock UI (enemy
turn), lock our turn, and the menu modes (getting item, talking menu, door menu, exit sector menu).

Flows (each with its ja2-node command):

| Gesture | Original | ja2-node |
|---|---|---|
| Move, turn-based: click → confirm marker (if the first step and stance change are affordable) → second click on the same tile | `QueryTBLeftButton`, `UIHandleCMoveMerc`; moving off the tile or a right click cancels | `previewMove`, then `move {soldier, to, mode}`; the "OK" battle sound when the path is longer than 5 steps (from `previewMove.steps`) |
| Move, real time: one click (real-time confirm off by default); double click within 300 ms runs; Alt reverses | `QueryRTLeftButton` | `move {mode: 'run'}`; **`move {reverse}`** (new) |
| All move (hold left, click right) and rubber-band multi-selection (drag > 10 px; tile centres inside; Alt adds) | `Real_Time_Input.cc:826-852`, `Handle_UI.cc:4215-4390` | **`moveGroup {soldiers, to, mode?}`** (new, paths through people) |
| Turn-based left+right cycles the movement mode run → walk → swat → crawl | `Handle_UI.cc:1799-1844` | the client keeps the choice for the next `move {mode}` only; the merc's own mode is his `stance` (deviation "Stance") |
| Attack, turn-based guns: right click or `u` → action mode; hovering a visible enemy enters action mode and, after 80 ms with ammo, confirm mode by itself; right clicks add aim (yellow full ring at the limit, then wrap), the wheel steps aim without wrapping (Stracciatella default); left click shoots; own or militia target → "attack your own man?" | `UI_Cursors.cc:129-139`, `:978-1309`, `Handle_UI.cc:2115-2295` | `estimateAttack` (extended) → `attack {soldier, target, level, aimTime, bodyPart, burst}`; the body part from the cursor's position on the target sprite (needs sprite picking) |
| Attack, real time: click shoots with aim 0; a red target cursor for 500 ms; right click lowers the weapon | `Real_Time_Input.cc:154-184` | `attack` |
| Burst spread: drag with the button held over up to 50 tiles, release after 300 ms | `Spread_Burst.cc`, `Turn_Based_Input.cc:339-368` | **`attack {spread: gridNo[]}`** (new; the simulation has `doSpread`) |
| Melee: two aim levels (0 and 3 AP), the walk to an adjacent tile plotted | `UI_Cursors.cc:1118-1209` | `attack`; the walk-up is deviation "Melee without walking" (**Later**): the cursor shows the refusal |
| Throw and launch: impact tile marker, no arc in the original; one click throws | `UI_Cursors.cc:1026-1028` | `estimateAttack` throw branch → `attack` |
| Medkit, wire cutters, toolkit, gas can, jar, tin can, bombs, remote: item cursors with the walk to an adjacent tile and the total AP | `DrawUIMovementPath` | `bandage` exists; **`useItemOn`**, **`plantBomb`** (new) or disabled cursors |
| Doors, switches, openable structures | `UIHandleInteractiveTilesAndItemsOnTerrain` | `door` (the menu from its `options`, §6.6); **`operate`** (new) |
| Items on the ground: 1.5 s on a pool switches to the hand cursor; Ctrl holds the hand | `Handle_UI.cc:1230-1265` | `pickUp` (§5.4); steal → **`steal`** (new) |
| Look (`l`, middle click in turn-based) | `Handle_UI.cc:3789-3881` | `turn {toward}`; all band-selected mercs in real time |
| Talk: red balloon over a valid target (flashing without line of sight), plain within 4 tiles | `UIHandleTOnTerrain` | `talk` |
| Jump over a prone merc | `IsValidJumpLocation` | **`jump {soldier, to}`** (new; the animation exists) |
| Swap places: the exchange cursor alternates every 1000 ms; `x` swaps with AP | `ValidQuickExchangePosition` | **`swapPlaces {soldier, with}`** (new) |
| Stance by dragging on the selected merc: 40, 80, 100 px | `Handle_UI.cc:1854-2074` | `stance`, `climb` |
| Sector exit: the outer 15 px at a map edge or an exit grid tile, green or red arrow; a click opens the exit dialog | `Turn_Based_Input.cc:2495-2666` | `exitSector` with `dryRun` for the colour; the dialog's choices from `exitSectorOptions` |

**Input lock** (`04` deviation "Turn-based UI lock"): the server refuses orders while the original UI would be locked.
The client locks input when (1) the view says our side cannot act (`combat.team`, a new **`combat.uiLocked`**: attack
resolving, a queued game event, an own merc acting, a scripted sequence), or (2) a received frame not yet played back
in turn-based play locks the interface or passes the turn: under the instant driver an attack resolves at once on the
server but plays back over seconds, and the original stays locked until the animation ends. Playback merely trailing the
latest tick does not lock: under the real-time driver frames arrive unevenly and playback at 1× keeps a lag of up to the
largest delivery gap (about 30 ticks), so a tick threshold made the lock and the cursor flicker. (3) An order the
original sends through `SetUIBusy` (attack, bandage, move, door, item pickup, turn, jump) locks from the click until the
server answers, as `SetUIBusy` locks in the same frame: the server publishes the frame with `combat.uiLocked` before its
answer, so the lock carries on without a gap, and a refusal unlocks. The wait cursor appears after 1 s for the
enemy turn (`DELAY_START_CURSOR`). Cursor queries stay allowed while locked. In real time only modal flows lock. The
25 s watchdog is not ported (deviation "Watchdogs").

### 6.2 Mouse, scrolling, selection

- Buttons: left acts, right switches mode or adds aim or cancels, a right hold of 300 ms opens the movement menu,
  middle looks (turn-based), wheel steps aim (Stracciatella's `extra_mousewheel_actions`, on in the shipped
  `game.json`); double click and hold generated by our layer (§3.1).
- Scrolling: arrow keys and the outer 15 px of the *screen* (the bottom of the panel scrolls down), after a 200 ms start
  gate, `40/20 px` per 20 ms step (Shift `80/40`), the first frame of a scroll hides the cursor tiles; limits and the
  tile-centre snap of `05` §1.4; slide-to a tile (enemy sighted, locate) in whole steps; radar and overhead-map clicks
  jump the camera (`RenderWorld.cc:1925-2112`). A smooth slide is a client option, off by default.
- Cursor bounds: the viewport above the team or SM panel, 20 px lower while the top bar shows; picking by the exact
  inverse projection (`05` §7) plus soldier picking by sprite.

### 6.3 Hotkeys (`GetKeyboardInput`, `Turn_Based_Input.cc:2097-2420`)

Gameplay keys exact; cheats, debug pages and editor keys deferred. Stracciatella's `extra_hotkeys` are on in the
shipped `game.json` (D1), so its additions belong in.

| Key | Action | ja2-node |
|---|---|---|
| Esc | cancel spread, close popup or box, end a menu, hand → move, stop the selected and band-selected mercs; end a meanwhile scene | `stop` |
| Backspace | stop the current speech | speech presenter |
| Pause, clock click | pause / unpause with the "Game Paused" mask (any click or key up unpauses) | driver `manual`, client mask |
| Enter (combat, our turn) | slide to the next visible hostile | client |
| Tab | interface level ground/roof | client |
| Space / Shift+Space | next merc / next squad | client |
| 0–9 | select squad 1–10 | client (the current squad is client state) |
| F1–F10 (Shift, Alt) | select or locate the merc in slot n | client |
| F12 / Ctrl+F12 | clear displayed messages / the queue | client |
| `` ` `` | SM / team panel | client |
| a | auto-bandage | deviation "Auto-bandage" (**Later**) |
| b | next weapon mode | **`weaponMode`** |
| c, p, s, PgUp, PgDn | crouch, prone, stand, stance up/down (climb at the ends); also in the stance the merc has, which ends a halted move and a run | `stance`, `climb` |
| d | end turn | `endTurn` |
| e | cycle the enemies the selected merc sees | view **`sees`** |
| f | range to target and gun range in the message log | `estimateAttack.inRange` |
| g | merc light on/off | client rendering (does not change sight, `27` §2.1) |
| h, o, m, v | help, options, map screen, version message | screens, `mapScreen` |
| i, `*` or `,` | item glow, red item glow | client |
| j / Shift+J | climb / climb through a window (Stracciatella) | `climb` / **`climbWindow`** |
| k | key ring popup | client |
| l, u | look cursor, action mode | client UI modes |
| r | run (a crouched or prone merc stands up first) | **`stance {stance: 'run'}`** |
| n | cycle the soldier stack or interactive tiles under the cursor | client |
| t, w, Home | tree tops, wireframes, 3D cursor | client (3D cursor deferred) |
| x | swap places with the merc under the cursor | **`swapPlaces`** |
| z / Alt+Z | stealth for the selected or band-selected mercs / the squad | **`stealth`** |
| `/` | centre on the selected merc | client |
| `=` (real time) | select all mercs | client multi-select |
| Insert | overhead map | client |
| End | continue the interrupted move | `move` to **`continueTo`** |
| Delete/End held, `-`/`=` | cover / line-of-sight display and its radius | deferred (§6.5) |
| Alt+F, Alt+R, Alt+- | tracking mode, reload, music volume −20 | client, `reload`, client |
| Alt+S, Alt+L, Ctrl+S, Ctrl+L, Alt+X | quick save, quick load, save screen, load screen, exit prompt | §4 |
| Ctrl+Q, Ctrl+Shift+R, Ctrl+N | swap hands, squad reload, squad head gear day/night (Stracciatella) | `swapHands`, `reload` per merc, **`swapHeadGear`** or deferred |

Menu modes swallow keys (Esc closes the exit, pickup, movement, door and talk menus); the first key press dismisses a
feedback popup; any key up unpauses a player pause and advances key-advance speech.

### 6.4 Cursors and world markers

- **Mouse cursors** from the database (§3.5) per mode (`Handle_UI.cc:670-908`, `UI_Cursors.cc`): move (walk, run,
  swat, crawl by the UI mode), can't reach, action cursors of the hand item with aim rings and hit-chance cues, burst,
  out of range, no line of fire, reload, throw and launch, hand, look, talk, jump, exchange, exit arrows, wait; AP cost
  and hit location drawn into the cursor; flashing invalid AP.
- **World cursor tiles** (`FIRSTPOINTERS*`, markers) inserted into the scene each frame at the original's layers
  (`SetUpInterface`/`ResetInterface`, `Interface_Control.cc:163-289`): the red diamond, the animated confirm figure, the
  bad-destination marker, the show-move-grid marker, the AP number anchored to the tile.
- **Footstep path** (`Handle_UI.cc:3116-3465`): footsteps from `previewMove.steps` coloured by the movement modes the merc
  can still afford (bands), shown on the 80 ms rest; "always show movement path" option.
- **Throw and launch**: an impact-tile marker only (the original draws no arc).
- Needed in the renderer: a per-frame UI node list merged into the scene at the original's positions (object head/tail,
  on-roof, topmost), so the z rules of `05` apply unchanged; animated tile frames from a client clock (200 ms).

### 6.5 Overlays above the world (`Interface.cc`, `Interface_Control.cc:368-530`)

| Overlay | Recommendation | Needs |
|---|---|---|
| Name, assignment or squad, health and AP bars above heads (`DrawSelectedUIAboveGuy`, `Interface.cc:921-1161`); a visible other's name and health word on hover | exact | `bleeding`, `breathMax`; others' **`healthIndex`** (the original names a visible soldier's condition) |
| Hover and selection rings, stance arrows | exact | — |
| Radio locators (soldier, item, multipurpose) | exact | `itemsRevealed` events |
| **Enemy glow**: enemies pulse red every 3 s and jump to the top z at the peak; enemies the selected merc does not see are grey (deviation "Enemy glow", **M8**) | exact (palette rows) | **`sees`** per own merc (or `seenBy`), `hostile` per other |
| Enemy fade in and out | exact | — |
| Item glow outline and item name list | exact | items in the scene (the renderer draws no items today) |
| Floating damage numbers | exact | **`lifeLost {soldier, amount}`** from every life deduction (bleeding and gas included; `soldierHit` carries the hit, not the deduction) |
| Top bar (our turn, enemy turn with progress, interrupt; `Interface.cc:1699-1972`) | exact; the timed-turns bar is not ported | **`combat.topMessage`** following `AddTopMessage`'s rules, so hidden AI interrupts stay hidden (today `combat.team` reveals them: a D16 leak), **`combat.ai {current, total}`** or `enemyTurnProgress` events, `aiTurn {soldier}` for the locator and the camera |
| UI feedback box and message log (6 lines of `TINYFONT1` at the bottom left of the viewport, y 330, `Utils/Message.cc`) | exact | message entries (§12.2) and machine refusal codes on every tactical command |
| Burst spread markers | exact | `attack.spread` |
| Cover and line-of-sight display (Delete/End held) | defer | server maps (`coverMap`, `sightMap`); heavy |
| Wireframes, tree tops, roof level, slanted roofs (deviation "Fog of war", **M8**) | exact (renderer) | — |
| Heard noises | exact: a message line only (no world marker in the original) | `noiseHeard` exists |
| Mercs on roofs (the scene skips `level > 0` today), corpses, smoke and gas clouds, per-tile light, tile changes (windows, the O3 statue, the helicopter on the map: deviations tagged **M8**) | exact | view fields §12.1 |
| Helicopter arrival (`Merc_Entering.cc`; only the helicopter's shadow is drawn) and trap popups | defer | the simulation parts are not ported |

### 6.6 Popup menus over the world

- **Movement menu** (right hold 300 ms; `PopupMovementMenu`, `Interface.cc:418-532`) — exact: a 3×3 grid of 20×20
  buttons in `interface/button_frame.sti` (icons `interface/newicons3.sti`), anchored at the mouse, clamped; Look, Run,
  Walk / Action (icon by hand item), Cancel, Sneak / Talk, Hand, Crawl; disabled by body, water and stance; tooltips
  `pTacticalPopupButtonStrings`.
- **Door menu** (`Interface.cc:1265-1436`) — exact: the same frame centred on the merc; open, key ring, crowbar,
  examine, cancel, lockpick, boot, untrap, explosive (`interface/door_op2.sti`); ja2-node's `door` already returns the
  button states as `options [{action, ap, enabled, reason}]` (`docs/04` §6.10). Missing: **"open manually"** on a locked
  door. The game pauses while it is open (§1.4).
- **Sector exit dialog** (`Strategic_Exit_GUI.cc`) — exact: the choices from **`exitSectorOptions`**, the "travel to
  surface?" prompt wired.
- **Overhead map** (Insert; `TileEngine/Overhead_Map.cc`) — exact: the 1/5 tiles exist in the data; clicking jumps the
  camera; the original freezes the tactical world while it is open, so the client pauses the real-time driver (§1.4).

### 6.7 Interface timers and camera

UI timers on the client clock (`Utils/Timer_Control.cc:13-36`): cursor animation 150 ms, flash 250 ms, path rest
80 ms, scroll 20 ms, glow, locators, damage drift, blinking. Timers tied to game events (AI progress, damage drift,
message aging) run on displayed simulation time. Camera following: tracking mode, slide to a newly seen enemy, locate
the acting AI soldier during its turn ("center on enemy"), the delay between enemy actions during playback.

### 6.8 Clock and pause

"Day N, HH:MM" in `COMPFONT`, light green in real time, red in combat, centred in 66×13 at
`(teamPanel.x + slots width + 56, H − 23)` with the sector name above (`Game_Clock.cc:241-255`); "Paused" while the
player pauses. The player pause is the real-time driver at `manual` plus a client mask that refuses orders (closing the
deviation "Real-time pause" for the canvas: commands go through the API while paused, the UI follows the original).

---

## 7. Map screen

A fixed 640×480 composition of four panels plus popups (`Strategic/MapScreen.cc`, `Map_Screen_Interface*.cc`): the
character info panel (0,0) 261×107 on `interface/charinfo.sti`, the character list (0,107) on `newgoldpiece3.sti` (the
merc inventory `mapinv.sti` replaces it), the map with its border (261,0) on `mbs.sti` (the sector inventory
`sector_inventory.sti` replaces it), the bottom panel (0,359) on `map_screen_bottom.sti`; the PBI covers the info panel
and the list. Fonts: `BLOCKFONT2` (list, info, map labels, popups, ETA), `COMPFONT` (bottom values, compression,
clock), `TINYFONT1` (message list, update box names), `SMALLCOMPFONT` (arrow counts, sector inventory names, autoresolve
cells), the Arial fonts for boxes, help, PBI and autoresolve. Layout constants: `MapScreen.h:120-135`,
`Map_Screen_Interface.h:16-34`, `Map_Screen_Interface_Map.h:121-146`, `Map_Screen_Interface_Bottom.cc:52-80`,
`Map_Screen_Interface_Border.cc:22-50, 118-150`, `UILayout.cc:50-53, 93-111, 130-136`. The controller (selection set
and info character, plotting mode with pending legs, the popup stack, filters, level, the Esc priority chain, the item
cursor) is separate from the layout. Recommendation: **exact** throughout, except the help screen (late, §4.7), the
sector inventory's slot placement (simplified) and the tactical placement GUI (deferred, §8.3).

### 7.1 Character list — exact

- Up to 20 rows (18–19 vehicles, 6 px lower), rows from y 146, pitch font height + 2; columns name (11/51),
  assignment (67/51; red flashing every 500 ms when the merc has nothing to do), sleep icon (123/19), location
  (147/32; `--` in transit, `??` prisoner, parentheses between sectors), destination (184/33), departure (222/28; `Nd`
  green, `Nh` red, flashing white/red below 4 hours).
- Row colour, first match: hover white; dead metal grey; being plotted light blue; not in the selected sector; in a
  squad or vehicle yellow; else dark yellow. `selectedchararrow.sti` marks the info character and every selected row.
- Sorting: six header buttons (`goldpiecebuttons.sti`, MLG) or F1–F6; the original's quirky swap loop over rows 1..17 is
  ported literally (ties depend on it); vehicles never sort; keys name, assignment, awake first, sector + 1000·z,
  last path sector, contract end.
- Selection: the info character plus a multi-selection; Ctrl+click toggles, Shift+click selects a range; number keys
  select a squad; while an item is held the info character changes only when the item can pass.
- Clicks: name/location select (right: inventory); assignment → the assignment menu (§7.4) or "Remove merc" for the
  dead and prisoners; sleep → `sleep`/`wake` for the selection; destination → plotting (§7.6), right click cancels the
  selection's routes (`cancelRoute`); departure → the contract menu (§7.3). Column glows (a red outline oscillating
  every 70 ms) and `glowclick.wav` on hover.
- Status tooltip "Health: x/y, Energy: x/y, Morale: word".
- Needs (§12.1): `idle` (nothing to do), assignment detail, `canChangeSleep` (or try-and-refuse), contract end and type,
  path last sector and next sector.

### 7.2 Character info panel and merc inventory — exact

- Face 48×43 at (9,20) (the face system of §5.5; a talking merc becomes the info character and animates here),
  nickname and full name, assignment lines (training stat, town, repair target, `ETA: hh:mm` while moving), the ten
  stats (green or red for 60 s after a change), health `life/max` coloured by fraction, morale word, contract
  (`1.8d/7d`), salary, medical deposit, the three corner icons with tooltips, bars at (66,61), the hand item at (6,81),
  prev/next merc buttons. Vehicles show "Cond." and fuel bars.
- The merc inventory replaces the list for an accessible merc (not in transit, not a prisoner, not a vehicle or robot,
  not an EPC, above OKLIFE): the tactical inventory widget with the map slot table (`UILayout.cc:93-111`),
  armour/weight/camo, key ring, trash can, Done. Commands as tactical (`moveItem` without AP on the map, passing items to
  another merc, `moveItem {to: 'ground'}` via the sector inventory); the trash can needs **`discardItem`** (new).
- Needs: `profile` (face, full name), `stats`, `bleeding`, assignment detail, the hand item, vehicle condition and fuel,
  salary type (§12.1).

### 7.3 Contract button and menu — exact

`contractbutton.sti` at (190,49), enabled by `CanExtendContractForSoldier`; the popup "Contract Options:", one day, one
week, two weeks with prices, Dismiss, Cancel; shading and prices from **`contractOptions`** (exists); Dismiss asks
"Are you sure?" (`STR_LATE_48`, not during the renewal sequence) → `dismiss` → the `mercDeparture` prompt; dead or
prisoner → Remove Merc → `removeMerc`; during the renewal sequence the menu is the `contractRenewal` prompt and Cancel
lets the merc go. The salary-rise quote plays first when it fires. Opening pauses (§1.4).

### 7.4 Assignment popups (`Assignments.cc`, `Utils/PopUpBox.cc`) — exact

- Boxes: Assignment (On Duty(N), Doctor, Patient, Vehicle, Repair, Train, Cancel), EPC (On Duty, Patient, Vehicle,
  Unescort, Cancel), Squad (`Squad  1 ( n/6 )` …), Vehicle, Repair (vehicles, robot, Items), Training (Practice, Militia,
  Trainer, Student), Attribute (nine stats), Remove merc; submenus open to the right at the parent line; the parent line
  stays highlighted; a full-screen mask closes all on any button-up; right click on a parent closes its submenus.
- PopUpBox drawing: background PCX blitted from its top-left (not tiled), `popup.sti` corners and edges, margins
  l6 t6 b4 r4, line space 2, colours light green / white highlight / grey shade / yellow secondary shade.
- Shading needs rules the client must not run: **`assignmentOptions {soldier}`** returns every line with `{enabled,
  shade: none | gray | yellow, reason?}` (squads, vehicles, repair targets, stats), like `contractOptions` and the door
  menu.
- Clicks: `assignSquad`, `assign {kind: doctor | patient | repair | trainMilitia | trainSelf | trainTeammate |
  trainByOther, stat?, target?}`, `boardVehicle`, `unescort`, `removeMerc`; militia training opens the payment prompt.
  For a multi-selection the clicked merc first, then the others; one failure box when any failed (`assign {soldiers}`
  already returns per-soldier results).

### 7.5 The map view — exact

- `interface/b_map.pcx` (an 8-bit picture at double resolution) blitted at half scale (every other pixel) at (271,10);
  sector (x, y) has its cell at (270 + 21x, 10 + 18y), 21×18; the clip rectangle (289,27)–(627,316). No zoom.
- Shading (surface): unvisited sectors darkened ×0.48 (one pixel higher than the tints, as written); the airspace filter
  tints cells red or green through `Create16BPPPaletteShaded(mono)` palettes (light and dark). The four tinted
  half-scale copies are computed once per data set. Ground control is not shown by shading.
- Underground levels: `mine_1/2/3.sti` instead of the map, unvisited underground sectors filled near-black, "Sublevel: N".
- Overlays in order: found secret sites, found SAM sites (with the airspace filter a grey box and "SAM Site"), mines
  (with the Mines filter the mine name, status and `$income (NN%)`), town borders and names with loyalty (red below 20
  when training is allowed), militia icons, the arrival-sector bullseye, item counts (Items filter).
- Group icons (`boxes.sti`): yellow on-duty mercs, dull yellow other assignments, white vehicles, red enemies, "?"; up
  to 30 slots per sector; the enemy display rule is already ja2-node's `StrategicSectorView.enemies`.
- Movement arrows between sectors with counts (`merc_between_sector_icons.sti`, green `merc_mvt_green_arrows.sti` when
  the group arrives within 5 minutes).
- Filters (`map_border_buttons.sti`: Towns, Mines, Teams, Militia, Airspace, Items; keys w m t z a i) with their
  exclusions; levels 0–3 (Insert/Delete); hover outline white, selected sector yellow (alternating while hovered), the
  index labels flashing in sync; the sector locator `hilite.sti` (red for the battle sector and Skyrider's sites, yellow
  for whoever speaks, 80 ms frames).
- Needs (§12.1): `airspace` per surface sector, found SAM and secret sites and found towns, `items` per visited sector
  (also underground), underground sectors, town `loyalty`/`control`, mine `status`/`predictedIncome`/`maxRemoval`,
  group `nextArrivalMinutes`. Static facts (town names and `townPoint`, land types, mine and SAM locations, facilities,
  radar maps) come from content.

### 7.6 Route plotting, the move box and the ETA — exact drawing, flow on new queries

- Plotting from the destination column after the movement checks (`CanCharacterMoveInStrategic`: refusal tokens map to
  `pMapErrorString`); the selection is adjusted to who must and cannot move together (server rule: the refusals of
  `route` and `moveGroup`). Cursors `walkingcursor.sti`, `vehiclecursor.sti`, `check.sti` over the last path sector.
- After the cursor rests 200 ms on a sector, the temporary path from **`previewRoute`** is drawn statically; a click
  appends a leg (kept client-side), "Click again on the destination to confirm…"; a click on the last sector confirms
  with one **`route {soldier, to, via?, shortest?}`** (`via` and `shortest` are planned in `docs/16` §7.1, not built);
  right click on a node → **`shortenRoute {soldier, at}`** (new); Esc drops the pending legs; Shift = shortest route.
  The OK sound of a random awake selected merc on confirm.
- Path drawing with `mapcursr.sti` (lines, turns, U-turns, arrows, the green start X and red end X); the plotting
  character's permanent path pulses (20 ms per step, 1000 ms pause). Open point: `TracePathRoute` skips nodes with
  x ≥ 598, which looks like it drops column 16 (`Map_Screen_Interface_Map.cc:1400-1401`); verify in the oracle before
  copying.
- ETA box `eta_pop_up.sti` at (476,291), "ETA:" and the value from `previewRoute`. The original counts the remaining
  arrival time twice when a path exists (`MapScreen.cc:939-1045`); D1 says keep it: the hint reproduces it.
- Move box (clicking an already-selected sector with several movable units): a PopUpBox listing squads, vehicles with
  passengers and others with toggles, "Plot Travel Route", Cancel; Done regroups split-off mercs (a rule) →
  **`moveGroup {soldiers, to, via?, shortest?}`** (new).

### 7.7 Helicopter — exact

- In airspace mode the helicopter icon is drawn between its sector and the next at the flight progress
  (needs **`helicopter.progress`**), the passenger count beside it, the destination shadow at the path's end.
- Plotting: click the icon (the empty-helicopter hint box once), cursor `chopper.sti`, legs as in §7.6; the distance box
  `pos2.sti` (total distance, safe, unsafe, total cost, ETA, passengers) from **`previewHeliRoute`**; confirm →
  `heliRoute` (exists); refusals map to Skyrider's quotes (owed, returning, grounded, unwilling).
- In flight: quotes, payment messages, monologues that turn the airspace filter on and flash sites: the events exist
  (`04` §6.13).

### 7.8 Town and mine box, militia popup, sector inventory

- **Town/mine box** — exact: right click on the selected sector (Militia filter off); a PopUpBox with Inventory and Exit
  buttons (`mapinvbtns.sti`); mine: name, sector, status, daily production, possible production, rate, town control,
  loyalty, ore type; town: land type, sector, size, facilities, control, loyalty, associated mine; militia lines
  (controlled, counts by rank, civilian training %); enemy forces; item count. Most numbers need view fields (§12.1).
- **Militia popup** — exact after the commands: right click with the Militia filter on; `militia.sti` box, the town's
  3×3 mini-map (`militiamaps.sti`), per-cell totals and rank icons, the picked-up militia row, per-rank buttons, Auto and
  Done; the cursor of picked-up militia is client state, each drop becomes **`moveMilitia {from, to, rank, count}`**,
  Auto is **`distributeMilitia {town}`** (both specified in `docs/18` §6, not built; the close-with-cursor rule and the
  Auto quirk live on the server). The least used part of the screen: deferred if M8 must shrink.
- **Sector inventory** — exact look, simplified placement: 45 slots per page (9 rows × 5 columns, column-major), item
  graphics, names in `SMALLCOMPFONT`, counts, status bars, hatches for unreachable items or a merc not in the sector,
  location, total and page footer, next/prev and Done; opened from the town box, the Items filter, a map click with a
  held item; while open no compression, no tactical, no level change. ja2-node's stash indices are the storage order
  (deviation "Item cursor"): the client shows the sorted, padded grid and drops "into the stash" (`moveItem {to:
  'ground', stashIndex?}`) instead of into an arbitrary empty slot. The radar blink of a hovered item needs item grid
  numbers (in the `inventory` answer). Stracciatella's Shift+S, Shift+R and Ctrl+I are optional.

### 7.9 Bottom panel, messages, compression and the clock — exact

- The message list: 9 visible lines of `TINYFONT1` at (20, 377 + 9n) in a 256-line ring wrapped at 300 px, the scroll
  bar and arrows (right click ±9, repeat 100 ms, wheel ±3), Up/Down/PgUp/PgDn/Home/End; `newbeep.wav` per message on the
  map screen. Content from the server's message entries (§12.2).
- Laptop (456,410), Tactical (496,410), Options (458,372) buttons; the new-mail icon blinking 667 of 1000 ms (needs
  **`newMail`**); enabled per frame from `AllowedToExitFromMapscreenTo` and `CanGoToTacticalInSector` (no message, the
  button is hatched): **`canEnterSector`** hint; Laptop → `openLaptop`, Tactical → `enterSector` or
  `tacticalScreen`.
- Compression: less/more buttons and the label ("Paused" blinking, "5 min", "30 min", "60 min"); X1 is skipped on the
  map; when compression is not allowed the buttons are masked and a click explains why. Needs `clock.mode`,
  `clock.paused` (and why), `canCompress` + the refusal token (§12.1). `compressTime`, `stopTime`.
- Balance and daily income (needs **`projectedDailyIncome`**), the selected sector's name, the radar of a visited sector,
  the clock (click = pause).

### 7.10 Boxes and popups

The message box of §4.6 centred on (0,0,640,340); the **update box** (assignment done, auto sleep and wake, contracts
expiring: `group_confirm_tactical.sti`, `panels.sti` faces from `faces/65face`, bars, names, "Continue" / "Stop"; Space
continues, Esc stops) fed by the existing events, opened with the driver paused on the event (`pauseOn`, §1.4);
UI messages (a 200 px box centred in the map view, 1000 + 50 ms per character); talking faces in the info panel or
the external overlay at (320,40). Every original box maps to an existing prompt or event (`mercDeparture`,
`insuranceExtension`, `contractRenewal`, `simultaneousArrival`, `npcOfNote`, `militiaPayment`, `preBattle`,
`militiaPromoted`, `arrivalRerouted`, …); the notices need **`groupArrived {group, sector, final, who}`**, a `kind` on
`sectorControlChanged`, an invasion notice event, and refusal tokens on `route`, `assign`, `assignSquad`, `sleep`, `wake`,
`compressTime`, `enterSector` so the client prints the original strings.

### 7.11 Map-screen hotkeys (`GetMapKeyboardInput`, `MapScreen.cc:2540-3075`)

Any key first ends a player pause and closes fast help; only exact modifier states dispatch.

| Key | Action |
|---|---|
| Esc | the priority chain of `HandleKeyESC`: close a non-persistent PBI, cancel bullseye mode, a UI message, the talking face, update box Stop, the item description, plotting, assignment submenus then the menu, the contract menu, the militia popup, the town box, the key ring, the inventory, collapse the multi-selection, else go to tactical |
| Pause | player pause |
| Left / Right | previous / next merc |
| Up / Down, PgUp / PgDn, Home / End | message list |
| Insert / Delete | map level |
| Enter | merc inventory |
| Backspace | stop speech |
| F1–F6 | sort |
| `+`/`=`, `-`/`_`, Space | compression up, down, toggle (Space continues an open update box) |
| 1–9, 0 (Shift) | squad 1–10 (11–20) |
| a, e, r | PBI: autoresolve, go to sector, retreat (only when enabled); `a` is otherwise the airspace filter |
| c, h, i, l, m, o, t, v, w, z | contract menu, help, items filter, laptop, mines, options, teams, version, towns, militia |
| Ctrl+S, Ctrl+L, Alt+S, Alt+L, Alt+X, Alt+A | save screen, load screen, quick save, quick load, exit prompt, assignment menu |
| Shift+R, Shift+S, Ctrl+I | Stracciatella extras (optional) |

---

## 8. Battle entry: PBI, autoresolve, placement

### 8.1 Pre-battle interface (`Strategic/PreBattle_Interface.cc`) — exact

- Opens when a merc's enemy-presence quote ends (bloodcat and unconscious-only cases first show a message box); from
  tactical it switches to the map screen first. Persistent (a fresh battle): one of three buttons must be pressed;
  non-persistent ("BATTLE IN PROGRESS", opened by the battle sector's red locator or by trying to compress during a
  battle): Esc closes. ja2-node needs a way to open the non-persistent one during a tactical battle: a
  **`battleSummary`** query (or `showBattle` → `preBattle {persistent: false}`, `docs/19` §5.1).
- Opening: `laptop power up (8-11).wav`, a 1 s slow-fast-slow stretch from the battle sector's cell to (131,180)
  (`:530-622`), input ignored until the first normal frame.
- Layout: the MLG `prebattlepanel.sti` (main panel, title pieces, column headers, the uninvolved header), constants
  `TOP_Y` 113, `BOTTOM_Y` 349, `ROW_HEIGHT` 10 (`:88-97`); buttons `prebattlebutton.sti` at (27,54), (98,54), (169,54)
  (Auto Resolve, Go To Sector, Retreat Mercs; `BLOCKFONT` beige, hover white; disabled buttons keep their tooltip); the
  header (blinking for the non-persistent PBI and ambushes): battle in progress, invasion, encounter, ambush, entering
  enemy sector, creature attack, bloodcat ambush, bloodcat lair; location, enemy/creature, merc and militia counts
  ("?" when the player does not know); involved mercs (name, assignment, condition word, HP%, BP%) and uninvolved mercs
  (name, assignment, location, destination, departure) or "None".
- Actions: `answer {prompt, choice: autoresolve | enterSector | retreat}` (also `a`, `e`, `r`); enable states and help
  texts from the prompt's `options [{choice, enabled, reason}]` (reason tokens → the original strings); auto-start shows
  the pressed Autoresolve for a frame. The retreat-path preview (arrows toward the retreat sector while hovering an
  enabled Retreat) is simplified away unless the prompt gains the retreat sector per group.
- Gaps: the uninvolved departure (from the strategic mercs), the original's destination rule for uninvolved mercs (the
  path's last sector whenever there is a path; ja2-node fills `destination` only between sectors: align the view).

### 8.2 Autoresolve (`Strategic/Auto_Resolve.cc`) — exact

- A separate screen over a darkened snapshot of the map screen; opening: `laptop power up`, 1 s, the panel grows from
  (0,0) with a cubic in-out easing.
- Geometry by unit counts (`:844-907`, `:2132-2283`): columns per side by count, mercs and militia share the left side,
  width and height formulas, centring; `interface/autoresolve.sti` (corners, edges, texture, centre column pieces, merc
  and other cells).
- Cells: column pitch 55, row pitch 47; merc faces `faces/65face/NN.sti`, others `interface/smfaces.sti` (admin,
  troop, elite, militia by rank, creatures, skulls, female variants) with a normal and a red-tinted palette; merc bars
  (life max, bleeding, life, breath max, morale) in the code's colours; the hit flash (white frame, then 150 ms black +
  red face); unconscious shadowed; dead = skull; status text in `SMALLCOMPFONT` (health word by life, the name or kind
  when dead, RETREATED, RETREATING alternating every 450 ms, "RETREAT" over a hovered merc).
- Header: ENCOUNTER / DEFENDING, the sector, "%d vs. %d" coloured by the ratio. Buttons `autobtns.sti`: Play, Fast,
  Finish (a radio group; playback speeds of the frame stream on the client: 1×, 4×, at once), Pause, Retreat; after the
  battle Bandage and Done or Done alone; the surrender offer with Yes/No (battle time frozen); the result box
  `indent.sti` (VICTORY!, DEFEAT!, SURRENDERED!, CAPTURED!, RETREATED!) and the elapsed time (3× the simulated time, +5
  min on a retreat).
- Space toggles pause and play (the original keeps the Fast or Finish speed: a quirk kept); Alt+X.
- Sounds (volume 50, centred): shot sounds by weapon, misses, impacts with the target's hit sound, falls, deaths and
  splats (already decided in the simulation, `docs/19` §4.3), creature sounds, the defeat laugh or eating; Finish mutes
  them and plays the composite sound. Music: victory or defeat tracks from the session's music mode.
- Mapping (`docs/19` §5.2): `observe.autoresolve` cells and the per-slice events (`arAttack`, `arHit`, `arMiss`,
  `arFell`, `arDied`, `arRetreated`, `arSound`, `arSurrenderOffered`, `arBattleOver`, `arSummary`); Retreat →
  `autoresolveRetreat {}`, a merc cell → `autoresolveRetreat {soldier}`, Yes/No → `answer surrender`, Bandage/Done →
  `answer autoresolveDone`. Gaps: the face index for merc cells (`profile`), `female` on enemy and militia cells, the
  attacker's weapon on `arAttack` (or a `shotSound` field), the bandage result reason; the Play-speed modifier for big
  battles is a client presentation rule.

### 8.3 Tactical placement GUI (`TileEngine/Tactical_Placement_GUI.cc`) — deferred

Entering from a persistent PBI started by the player's group shows the overhead map with the placement panel
(`interface/overheadinterface.sti`, `panels.sti`, `overheaduibuttons.sti`: Clear, Spread, Group, Done), merc slots with
`faces/65face` portraits and bars, the non-placeable area hatched. ja2-node places automatically (deviation "Tactical
placement"); `docs/16` §7.1 specifies `placeMercs` and a placement prompt. It needs the overhead-map renderer (§6.6),
the prompt and the command; it waits for a later milestone.

---

## 9. Laptop

About 39,000 lines in 117 files: 44 laptop modes plus 15 I.M.P. sub-pages, about 50 distinct screens counting
sub-pages as templates, about 300 widgets and 200 `laptop/*.sti` pictures (27 MLG pictures with baked-in text that
follow the data version). Every page is a static composition (a tiled background, a few STIs, wrapped Arial text,
image buttons at `#define` constants), so pixel-exact pages are cheap once the shared widgets exist; the expensive
pieces are shared with other screens (the animated face, the Ian wrap with its height measure that decides mail and file
paging, the text field, the destination drop-down, the slider, the item picture cell). All text is reachable today
(`/api/text` has layouts for every laptop EDT file, `/api/strings` all 217 L10n tables) and every decision is a command
or a query (`aimHire`, `aimLeaveMessage`, `mercOpenAccount`, `mercHire`, `mercPay`, `impCreate`, `bobbyRayOrder`, `insure`,
`orderFlowers`, `readEmail`, `deleteEmail`, `closeLaptop`; queries `aimQuote`, `bobbyRayQuote`, `insuranceQuote`,
`impPreview`, `arrivalTime`).

### 9.1 Shell (`Laptop/Laptop.cc`) — exact

- `laptop3.sti` full screen; the side panel `taskbar.sti`; the monitor rectangle (111,27)–(613,427), web pages from
  y 46; the desktop `desktop.pcx` (MLG); the program title bar `programtitlebar.sti` with icon and `FONT14ARIAL` title;
  side buttons `buttonsforlaptop.sti` (Email, Web, Files, History, Personnel, Finances, Power) with `FONT10ARIAL` labels;
  date, personnel count and balance; new mail and new file icons (`icons.sti`, clickable: the mail icon opens the
  **oldest** unread mail, the files icon the **last** unread file); power and disk lights (`lights.sti`); minimize
  (`x.sti`); the bookmark list (rows of 18 px from y 103, `webpages.sti`/`hilite.sti`); the download box
  (`downloadtop/mid/bot.sti`, `graphwindow.sti`, `graphsegment.sti`).
- Behaviour: opening zooms the laptop out of the map screen button over 1 s with `laptop power up (8-11).wav` (a new
  game starts in the laptop without the zoom); music `LAPTOP`; the new-mail box (`newmailwarning.sti`) on entry when
  mail arrived (also for pre-read mails, so it greets every new game; needs the saved **`newMail`** flag, §12.1); the
  program title-bar slide on maximize and minimize (a fixed duration instead of 18 rendered frames); bookmarks shown
  the first time the browser is used, the 2 s hint box; **the "World Wide Wait"**: every page change shows the download
  box with a 30-segment bar (40 ms per segment on a first visit of a bookmark, 3 ms on a revisit, 25/2 ms for sub-pages,
  120 ms for M.E.R.C. before its server went down), scaled by Stracciatella's `website_loading_time_scale` (1.0), kept
  and exposed as a client setting with 0 = off; the disk light flickers with the client PRNG; exit by Power or Esc
  (closing popups first) with the power-down zoom; Tab and Ctrl+Tab cycle programs; Alt+X; h; right click closes the
  topmost popup.
- Client state: mode, previous mode, web mode, program states and their most-recent queue, visited sets, overlay
  flags. The original saves the mail, finance and history page numbers and the hire popup; they may go into the save's
  `presentation` block (never read by the simulation, X16 below).

### 9.2 Ranking, order and what waits

| Tier | Sites | Recommendation |
|---|---|---|
| 1, needed to play | shell, Email, the A.I.M. hiring path (home, sort, mug shots, member file with the video conference, links, the "just hired" box), Finances, Bobby Ray's (catalogue, order form, home, shipments) | exact |
| 2, wanted | M.E.R.C. (Speck as a still portrait with voice and subtitles until the animated face exists), I.M.P., Personnel, the insurance contract page | exact |
| 3, flavour | History, Files, the insurance text pages, Florist, Funeral, the A.I.M. alumni, policies and history pages | exact, last; deferrable |
| effects | the A.I.M. conference distortion and impatience quotes, Speck's idle chatter, the I.M.P. direct skill pick (needs a non-original asset) and the import by nickname, the files' text flow around pictures | deferred or simplified |
| not reproduced | mouse confinement, the rain delay and rain ambience (dead code in Stracciatella), cheat keys, vanilla's empty Sirtech page | — |

### 9.3 Programs

- **Email** — exact, first: the list (sender, subject, date; read and unread; sort by column on the client, keeping
  arrival order underneath: deviation), the read view with paging by measured height, delete (a right click on a row
  asks), previous/next; `readEmail`, `deleteEmail`. The mail text needs **X4**: subject and body built on the server
  (the `$MERCNAME$`/`$AMOUN$` substitutions, the I.M.P. results mail assembled from `impass.edt`, Ian codes kept).
- **Finances** — exact: the summary (yesterday's and today's income, deposits, debits, balance, projected income and
  balance; needs **X8** `financeSummary`, oracle-tested) and the ledger pages with labels (**X7**).
- **Personnel** — exact, after Email and Finances: current and departed mercs, stats with deltas, kills, assists,
  shots, wounds, battles, employment, inventory pages (**X10**: a personnel block per merc and per departed entry with
  its state; the `battlesFought` counter, simulated since U12).
- **History** — exact, late: pages of rows with labels (**X7**: server-rendered row text in the display language,
  `questInProgress` colouring the quest-start rows).
- **Files** — exact, last: the list and the two file layouts with pictures; **`readFile {code}`** (X9) sets the saved
  read flag.

### 9.4 A.I.M. — hiring path exact, effects simplified

Home (ads with their frame timers), sort page, mug-shot index, member file (stats, salary, deposit, kit with item
pictures, bio row), the **video conference** (title bar zoom, snow, the merc's animated face or a still face with speech
and subtitles, first contact / answering machine / unavailable modes, contract length and kit selection, HIRE, TRANSFER
FUNDS), links, the "just hired" box with the arrival time. Needs: **X3** faces and bio rows per profile, **X5** the
contact mode per merc and `messageLeft`, a **`hireCheck`** query so HIRE refuses with the right quote before the funds
check, quotes with ids on `aimHire` refusals and acceptances, `aim[]` in the listing order; fix `aimLeaveMessage`'s
missing `alreadyLeft` refusal (`docs/21` §10 lists it). The conference distortion's `Random(200)` draws from the main
stream in the original (`AIMMembers.cc:1973`): add it to the "Cosmetic laptop draws" deviation.

### 9.5 M.E.R.C. and the broken link — exact pages

Home, no account, account with payment, files with hire, the broken-link page; Speck's opening runs once per laptop
session at the site visit (**X1**), his lines need **X6** (quotes in the `mercHire`, `mercPay`, `mercOpenAccount`
replies, `advertiseQuote` per listing, `married` for Flo); the "Transfer failed. No funds available." box is a hard-coded
English string in Stracciatella and gets a ja2-node label.

### 9.6 Bobby Ray's — exact

Home (with "under construction"), the catalogue template in five skins (guns, ammo, armour, misc, used) with item
pictures, the cart as a client draft (the original clears it on every laptop entry: no deviation), the order form with
the 17-destination drop-down, shipping speeds and the accept flow, the shipments page. Needs **X1** (the
under-construction visit gates the "now open" mail: a logic effect), **X11** (`bobbyRayQuote` with an optional
destination answering shipping 0, `affordable`, `confirmDestination`; stock entries with their catalogue page;
shipments with weight, unit prices and totals as paid), **X15** static item data (one item catalogue shared with the
inventory screens, §12.1). Fix the developer panel's reversed speed labels (speed 0 is overnight, 2 is standard) and
name the speeds in the MCP description.

### 9.7 I.M.P. — exact, direct pick and import deferred

Home with the code field, about us, main, begin (name, nickname, gender), the personality and attitude quiz, the
personality finish, attributes with sliders, portrait, voice, finish, confirm; the results mail via X4. The draft is
client state; **X12** supplies the form rules: `impCheckCode {code}` (`ok | badCode | noSlot`), the begin refusal
(funds before team size), the attribute budget, bounds, zero bonus and display order (or validation through
`impPreview`), the portrait and voice lists, quiz answer counts. Open point: the row labels and the value order of the
last three skill rows disagree in the original; follow the original and log it. *Settled in U11:* on the original data the label records
match the value order; only the comments in `IMP_Text_System.cc` name them wrongly.

### 9.8 Insurance, florist, funeral

Insurance contract page (cards per merc with premium from `insuranceQuote`, `insure`; **X13**: the dead flag, the
contract length, the face) mid-way; the insurance home, info and comments pages, the florist (gallery, order form with
the drop-down, cards) and the funeral page last. **X14**: the florist charges extras and delivery but not the bouquet
price, and the order number is not drawn; read the price column at content load and draw the number (two `main` draws,
already in imports), removing two deviations, or keep them. **X1** sets the funeral, florist and insurance bookmarks on
the first visit (ja2-node never sets them today).

### 9.9 Laptop server gaps (D15/D16; each reveals only what an original page shows)

| Id | Gap | Proposal | Priority |
|---|---|---|---|
| X1 | site visits have effects (Bobby Ray mail gate, bookmarks of funeral, florist and insurance, the M.E.R.C. visit counter and Speck's opening) | `visitSite {site}`, no time cost; returns Speck's ordered quotes | P0 (logic) |
| X2 | the saved new-mail flag | strategic `newMail`, set by every added mail, cleared by `closeLaptop`, imported from native saves | P0 |
| X3 | faces and bios | a per-session profile presentation endpoint (§12.1) | P0 |
| X4 | mail text | `emailText {id}` query → `{subject, paragraphs}` with substitutions and the I.M.P. report assembled on the server | P0 |
| X5 | A.I.M. conference | `contact`, `messageLeft`, `hireCheck`, quote ids, listing order, the `alreadyLeft` fix | P0 |
| X6 | Speck's lines | quotes in replies, `advertiseQuote`, `married` | P1 |
| X7 | record labels | server-rendered row `text` in the display language (or name, nickname and a sector label shared with the map screen); `questInProgress` | P0 finances, P1 history |
| X8 | finance summary | `financeSummary` with the mine forecast, oracle-tested | P0 |
| X9 | reading a file | `readFile {code}` | P1 |
| X10 | personnel data | a personnel block per merc and departed entry; the `battlesFought` counter | P1 |
| X11 | Bobby Ray quote and stock details | as §9.6 | P0 / P1 |
| X12 | I.M.P. form rules | as §9.7 | P1 |
| X13 | insurance cards | `dead`, `contractLength`, face | P1 |
| X14 | florist price and order number | as §9.8 | P2 |
| X15 | static item data | the item catalogue (§12.1) | P1 |
| X16 | UI state the original saves | optional `presentation.laptop` | P2 |

---

## 10. Story presentation

### 10.1 Meanwhile scenes (`Strategic/Meanwhile.cc`)

The simulation resolves scenes (`docs/26` §2.1–§2.3) and reports `meanwhile {seq, scene, sector, at}` (Meduna scenes,
resolved atomically), `meanwhileStarted`/`meanwhileEnded` (the interrogation) and the log `observe.strategic.meanwhiles`.

- **Box** — exact: the BASIC message box `"<MSG_MEANWHILE>....."` with OK only for the interrogation or a scene never
  seen on this installation, OK + Skip otherwise (seen flags: `meanwhileScenesSeen` in the client settings); the driver
  is held while it is up. The simulation applies the original's gates (PBI closed, no panel switch, empty dialogue
  queue), so the event arrives at the right moment.
- **Playback of a Meduna scene** — deferred: it needs `scene {seq}` from a server sandbox (`docs/26` §2.4), which was
  never built. OK and Skip both continue; the scene is marked seen only when played (as the original), so Skip keeps
  appearing. Deviation row; a later slice plays the scene in a canvas tactical view of P3 with the two talk panels.
- **The interrogation** (N7) needs nothing beyond the tactical screen: commands other than `answer` are refused
  (`docs/26` §9.1), the Queen's talk panel and the YES/NO/LIE box (`lieToQueen`) are normal UI; music
  `TACTICAL_ENEMYPRESENT`; Esc does not end it.

### 10.2 The ending

`queenKilled` → the killer's and witnesses' quotes with victory music → `squadMovedUpstairs` (fade out and in, P3
reloaded) → Derek's and Oliver's talk panels → `endgameDeferred` (creatures) or every conscious merc's end-game comment
→ fade out → `campaignWon {…, ending: {miguelAlive, skyriderAlive}}` (`observe.ended`) → the ending videos
(`endingPlan`, `src/app/video/sequences.ts`) → the credits **in silence** → the main menu with its music. Today no game
page reacts to `campaignWon` (only `src/devtools/video/main.ts`); M8 wires it. Exact.

### 10.3 The brothel and other one-off screens

The San Mona screen (§4.11) with the simulated time warp; the sector-change zoom (deferred); the laptop zoom (§9.1).

---

## 11. Sound in the UI

- **Button sounds** by scheme and screen (`src/sgp/Button_Sound_Control.cc:9-52`): main menu, options, save/load and
  init → BIG_SWITCH3 in/out; the game init check boxes VERYSMALLSWITCH2; message boxes inherit the screen that opened
  them; a disabled button → `sounds/disabled button.wav` at volume 15. Closes the "button clicks" part of the deviation
  "Sound coverage".
- **Lip sync** through the face system (§5.5): the audio engine exposes the playing speech handle and its position; the
  face reads the gap list. Closes "lip sync" in `01` §12 "Left out of M7".
- **Screen sounds**: `glowclick.wav` on map-screen hovers, `newbeep.wav` for map messages and the update box, laptop
  power up/down, the PBI and autoresolve openings, the sex screen, options slider test samples.
- **Music without a session**: the client plays `MAIN_MENU` on the front-end screens and nothing during the intro and
  ending videos and the credits after the ending; in a session the server's `presentation.music` decides (`docs/27`
  §3.7). `SessionClient` must apply `music` from frames (§2.3).
- The ambient restart on an effects-volume change and the options screen stopping ambients follow the original.

---

## 12. Server additions

Everything below keeps the rules on the server (D15) and reveals only what an original screen shows at that moment
(D16). Each item names the slice that needs it first (§17).

### 12.1 View and content fields

| Id | Field | Needed by | Slice |
|---|---|---|---|
| G1 | own soldier `bleeding` (finding 30 of `27`) | every bar, PBI, autoresolve | U3 |
| G2 | own soldier `stats` (ten values and level), `armour`, `weight`, `camo` computed by the server | SM panel, map info panel, personnel | U3 |
| G3 | own soldier `profile` always (face index, full name and voice through the profile endpoint below) | faces everywhere, lip sync | U3 |
| G4 | own soldier `breathMax`, `morale`, `asleep`, `squad`, `stealth`, `weaponMode`, `muted`, `sees: id[]`, `opponents` (`bOppCnt`, the face's enemy count), `canAct` (or `combat.actors`), `continueTo`, `vehicle {id, driver}`, `firstAid`, `blinded` | panels, glow, the `e` key, hatches, End | U3 |
| G5 | other soldiers: `hostile`, `healthIndex` (the original names a visible soldier's condition; −1 at `bLife` 0, during the death animation) | hover text, glow, radar colours, cursor auto-mode | U3 |
| G6 | `combat.uiLocked`, `combat.topMessage {kind, team, bloodcats}` (hidden AI interrupts stay hidden; today `combat.team` reveals them), `combat.ai {current, total}` | input lock, top bar | U3 |
| G7 | items: `jammed`, `imprint`; `ItemView.money`, `ItemView.attachments` | slots, pickup menu | U3 |
| G8 | world: corpses, smoke/gas/fire clouds, ambient light level and light sprites, tile changes (destroyed structures, window states, the O3 statue, the helicopter on the map, added exit grids), known mines and bombs | world rendering | U4 |
| G9 | strategic clock: `mode`, `paused` (and why), `canCompress` + refusal token | bottom panel | U8 |
| G10 | strategic mercs: `idle`, assignment detail (training stat, repair target, trainer's town, vehicle), the hand item, `canChangeSleep`, salary type; vehicles' condition and fuel | map screen list and info panel | U8 |
| G11 | sectors: `airspace`, found SAM and secret sites and towns, `items` per visited sector (also underground), underground sectors, `militiaTraining` % | map view, town box | U8 |
| G12 | `towns [{loyalty, loyaltyStarted, control}]`, `mines [{status, predictedDailyIncome, maxDailyRemoval, maxPeriodicRemoval, playerControls}]`, `projectedDailyIncome` | map view, town and mine box, bottom panel | U8 |
| G13 | groups: `nextArrivalMinutes`, `traverseMinutes`; `helicopter.progress` | arrows, helicopter icon | U8 |
| G14 | `ConversationLineView.chars`, `ConversationView.faceVariant`; `textKey` and `chars` on every quote event (own-merc barks, contract quotes, `skyriderQuote`, `headMinerQuote`); the speaker's sector for the comm popup | speech presenter | U7 |
| G15 | shop: `quoteTrade` keeps the evaluation quote ids and planned player-area entries; `ShopBoxView` gun ammo type; collected repairs marked | shop | U7 |
| G16 | PBI prompt: uninvolved departure, the destination rule of the original, optionally the retreat sector per group; autoresolve: `female` on enemy and militia cells, the attacker's weapon on `arAttack`, the bandage result reason | PBI, autoresolve | U9 |
| G17 | laptop X2–X16 (§9.9) | laptop | U10–U12 |
| G18 | **profile presentation endpoint** `GET /api/sessions/:id/profiles`: per profile the face index, eye and mouth offsets, blink and expression frequencies, the small-face offsets of recruited RPCs, A.I.M. and M.E.R.C. bio rows, names; I.M.P. profiles created in play included; from `prof.dat` and the externalized listings on original data, from `stubs/profiles.json` on stubs; fetched once and on change | faces, laptop | U3 |
| G19 | **item catalogue** `GET /api/items?lang=`: per item the names (short and long, from the data version's item text), description, class, `inventoryGraphics.small/big`, `tileGraphic`, weight, calibre, magazine, the static stats Bobby Ray's and the description box print; `ItemDef` (`src/content/items/items.ts`) gains the graphic fields | inventory, shop, Bobby Ray's, A.I.M. kit | U3 |
| G20 | key ring: the key item per lock id | key ring popup | U5 |

`SessionClient` applies every field through the generic `applyViewFrame` (§2.3). The view must carry every input a hint
function reads (§2.4): the test that fills unsupplied projection fields with throwing values finds a missing one.

### 12.2 Events and the message log

- New events: `lifeLost {soldier, amount}` from every life deduction (bleeding and gas included), `aiTurn {soldier}`,
  `enemyTurnProgress {done, total}`, `itemsRevealed {gridNo, level}`, `enemySighted` with the new enemy ids,
  `groupArrived {group, sector, final, who}`, a `kind` (sam, mine, town) and the lost income on `sectorControlChanged`,
  an invasion notice event, the sector-entry event's `loadScreen` (§4.10), the selected merc on `interrupt`.
- **Message entries.** The original's message list (tactical log and map-screen list share `Utils/Message.cc`: a
  256-line ring, colours by kind, saved with the game) is built from about 35 `ScreenMsg` sites on the map and many in
  tactical, most already paired with an event. A server presentation module outside `sim` (like the music mode) turns
  events into entries `{tick, kind, table, index, args}` (or an EDT key), keeps the ring in the session's `presentation`
  block (saved, never read by the simulation) and sends new entries in frames; the client formats them in the display
  language. Agents read the same entries. Refusal codes become entries only when the original prints them.
- **Refusal tokens** on `move`, `turn`, `stance`, `attack`, `climb`, `pickUp`, `drop`, `useRemote`, `route`, `assign`,
  `assignSquad`, `sleep`, `wake`, `compressTime`, `enterSector` (doors, talk, give and the inventory commands have them),
  so the client shows the original's feedback text.

### 12.3 Protocol

- The **query channel** (§2.4) for agents, the server-only answers, the client's fallback and the shadow mode; every
  hint kind answered over `knowledgeWorld`; `estimateAttack` moved onto the projection.
- `welcome` carries the engine version and commit, the rule pack hash and its scripts' hash; soldier entries carry the
  animation schedule (state, logic position, start tick, frame delay) instead of the sprite frame (§2.3).
- **`drive {mode: 'realtime', speed, pauseOn: EventType[]}`**: the real-time driver stops on the tick of the first listed
  event (§1.4).
- **`closeSession`** (WebSocket and `DELETE /api/sessions/:id`): runs the Dead is Dead save point "when the session is
  closed" (`docs/27` §1.6) and releases the session; used by the options screen's Main Menu.
- `POST /api/sessions {campaign: {deadIsDeadDescription}}`: the server derives the save name.
- `GET /api/assets/manifest`, `GET /vfs/@<hash>/<path>` (§2.5); the session profile endpoint and the item catalogue
  (§12.1).

### 12.4 Commands

| Command | For | Notes |
|---|---|---|
| `stealth {soldiers, on}` | SM stealth button, `z`, Alt+Z | the state exists (`soldier.stealthMode`); also closes the stealth part of "Sound coverage" |
| `weaponMode {soldier, mode?}` | burst button, `b` | single, burst, attached launcher (`ChangeWeaponMode`); `attack` then fires the attached launcher |
| `attack {spread: gridNo[]}` | burst spread | the simulation has `doSpread` |
| `move {reverse}` | Alt+move | `bReverse` |
| `moveGroup {soldiers, to, mode?}` (tactical) and `routeGroup {soldiers, squads?, vehicles?, to, via?, shortest?}` (strategic; renamed in U8 so the two do not share a name) | rubber band and all-move; the move box | paths through people; the strategic regrouping is a rule (`docs/04` §6.30) |
| `swapPlaces {soldier, with}` | exchange cursor, `x` | the movement code has `swapMercPositions` |
| `jump {soldier, to}` | jump over a prone merc; the climb button's fence jump | the animation exists |
| `climbWindow {soldier}` | Shift+J (Stracciatella) | |
| `mute {soldier, on}` | mute button | presentation flag kept by the server |
| `combineStack {soldier, slot}` | CTRL+click | `CleanUpStack` |
| `withdrawCash {soldier, amount}`, `depositCash {soldier, slot, amount?}`, `splitMoney {soldier, slot, amount, to, toSoldier?}` | the money region and box | built in U7 (`04` §6.28) |
| `leaveVehicle` in tactical | team panel second hand slot | documented for the map screen only |
| `discardItem {soldier, slot}` | map-screen trash can | |
| `route {via, shortest}`, `shortenRoute {soldier, at}` | plotting | `docs/16` §7.1 |
| `moveMilitia`, `distributeMilitia` | militia popup | `docs/18` §6 |
| `setShopPricing {soldier}` | shop prev/next merc | |
| `visitSite {site}`, `readFile {code}` | laptop | X1, X9 |
| `door {action: 'openManually'}` | door menu | |
| Later (shown disabled until built): `steal`, `operate`, `useItemOn`, `plantBomb`, walk-up melee, `autoBandage`, key-ring editing, tossing and catching, `placeMercs` | | the matching deviations stay |

### 12.5 Rule findings to settle in M8

1. **Brothel time warp** (`JAScreens.cc:478-483`): `5 + Random(20)` minutes of game time without event processing after
   the sex scene; ja2-node emits only `sexScene`. Simulate at the action.
2. **Loading-screen draw** (`Loading_Screen.cc:48-51`): `Random(2)` on the gameplay generator for town sectors without
   a mapped picture at every sector entry outside a save load and the PBI transition; simulate (the picture goes into the
   entry event). The second draw at every save (`SaveLoadGame.cc:372`) is logged as a deviation.
3. **Attachment AP** (`Interface_Items.cc:2530-2588`, vanilla `InterfaceItems.c:3501-3560`): closing the description
   box in combat charges `AP_RELOAD_GUN` once when the attachments changed; `attach`/`detach` charge nothing
   (`docs/12` §5). Verify with an oracle probe, then charge per accepted `attach`/`detach` in combat (the box session
   becomes one command; a player attaching two items in one opening pays twice: deviation) or add a batch form.
   *Settled in U5 (2026-10-19):* the oracle probe `attachbox` (`tools/oracle/probes/attach.txt`) confirmed the box rule;
   each accepted `attach`/`detach` that changes the attachments now charges `AP_RELOAD_GUN` in combat (deviation
   "Attachment AP", `docs/12` §5).
4. **`aimLeaveMessage`** never refuses with `alreadyLeft` although `docs/21` §10 lists it: fix the code or the doc.
5. **A.I.M. conference distortion** draws `Random(200)` from the main stream (`AIMMembers.cc:1973`): add to the
   "Cosmetic laptop draws" deviation.
   *Settled in U11 (2026-10-24):* the deviation "Cosmetic laptop draws" names it.
6. **Bobby Ray speed labels** are reversed in the developer panel (`src/devtools/strategic/laptop-panel.ts:25`): fix.
   *Settled in U11 (2026-10-24):* the panel labels the speeds through `src/protocol/bobby-ray.ts` (0 overnight express,
   1 two business days, 2 standard service), as the order form and the MCP description do.
7. **Fairness**: `estimateAttack` sees unseen soldiers (fixed by the projection, §2.4); `combat.team` reveals hidden AI
   interrupts (§12.1 G6).
8. **Map path quirks**: the column-16 node skip in `TracePathRoute` and the doubled remaining time in the plotting ETA;
   verify, then keep (D1) or log.
   *Settled in U8 (2026-10-21):* both kept. The doubled ETA is confirmed in Stracciatella and vanilla
   (`GetGroundTravelTimeOfSoldier` adds `GetPathTravelTimeDuringPlotting` for the temporary path and for the merc's
   path, each starting from arrival − now for a group between sectors and skipping its first node,
   `MapScreen.cc:939-1045`, `7142-7150`; vanilla `MapScreen.c:2108-2114`, `10110-10123`); the `previewRoute` hint keeps
   it (`src/sim/strategic/map/plotting.ts`, regression test in `src/server/hints-strategic-stub.test.ts`). The column
   skip is a screen test (`x < logical width − 2·MAP_GRID_X` in screen coordinates), so the client's path drawing
   (`src/ui/screens/map/path-trace.ts`) skips the column-16 arrows only at 640 pixels wide, as Stracciatella does. No
   oracle probe: both are client-side display rules the oracle does not reach.

---

## 13. Stub skin

Scenario 1 stays as it is (§1.3); the only stub work M8 does is what CI needs to render and test every screen, since CI
runs on stubs only. Quality is not a goal: labelled rectangles are enough.

**Rules** (`docs/27` §6.4 apply): original work, deterministic bytes, nothing derived from the game data. Stubs are
written as **STIs (and PCX where the code loads a PCX) under the original names**, like the fonts, so layouts reference
`(file, frame)` the same way on both data sets and one decode path serves both. **Sizes come from the layout data**
(the source constants: panel rectangles, button and slot sizes, cell pitches); where the code does not define a size
(the art does), the stub chooses its own and the layout carries the size it needs, so no layout centres a sprite on an
original image's measured size. MLG ids resolve to the base names on the stub data version.

**One generator driven by the layouts** (`stubs/ui/skin.ts`): for every asset a layout of the `original` skin
references and the stub pack lacks, it writes an STI with the frames the layout uses, each a bevelled rectangle on the
`ui` ramp (`stubs/raster.ts`) at the size the layout declares, stamped with the file name and frame number in the stub
font. Button frame sets get visibly different states (normal, hover, pressed, grayed). Adding a layout adds its stub
art; the layout contract test (§3.10) then resolves on stubs by construction.

**A few special cases** that a labelled rectangle cannot serve:

| Family | Why | Stub |
|---|---|---|
| Cursors (`cursors/*.sti`) | hot spots and animation frames are tested | simple shapes with a one-pixel outline; animated cursors with several frames |
| Faces (`faces/NN.sti`, `bNN.sti`, `65face/`) | blink and lip sync are tested | one generic face per body type with the eye and mouth frames at fixed offsets, offsets in `stubs/profiles.json`; a few `.gap` files for stub speech lines |
| Small item sheets and big item pictures | the item tile and the description box are tested | one generic silhouette per item class with the class name; frame indices from `items.json` `inventoryGraphics` |
| Map-screen board (`interface/b_map.pcx`) | sector picking and shading are tested | a 16×16 board coloured by the externalized traversability data, sector labels stamped |
| Radar maps (`radarmaps/<map>.sti`) | the radar is tested | downscaled from the stub maps' own tile colours |
| Load screens (`loadscreens/*.sti`) | the loading screen is tested | one RGB565 image behind aliases |
| Text (`binarydata/help.edt`, the laptop EDTs the e2e paths read) | help and laptop pages are tested | authored rows |

Budget: the pack is 6.7 MB today; the generated art should add no more than a few MB (aliases for full screens). A
decoder round-trip test per generated family in `stubs/build.test.ts`.

---

## 14. Deviations to log

New rows (or edits) in `docs/deviations.md` when the matching slice lands:

| Area | Original | ja2-node | Why |
|---|---|---|---|
| Pointer warp | message boxes move the pointer onto a button unless "don't move mouse" | no pointer warp; the option is inert | browsers cannot move the pointer |
| Mouse confinement | menus, popups, the laptop and the militia popup confine the mouse | not confined | browser |
| Main menu Esc and Quit | Esc and Quit exit the program | Esc does nothing; Quit goes to the launcher | an accidental key must not leave the game; a page cannot close itself |
| Game init Enter | Enter starts at once, skipping the confirmations (with Dead is Dead it reaches the save screen without the marker) | Enter goes through the confirmations | the original path is a Stracciatella quirk with a broken branch |
| Fades | speed tied to the loop rate | fixed steps of about 16 ms | frame-rate independence |
| Zooms | map→sector zoom | deferred | cosmetic |
| Meanwhile scenes | the scene plays in P3 | box only; playback deferred (`docs/26` §2.4) | the scene sandbox does not exist |
| Item pickup menu | opens after the merc reaches the tile, game paused | opens on the click, before the walk; one `pickUp` | `pickUp` chooses before the walk |
| Email order | the sort relinks the saved list | sorted in the client; arrival order kept | UI state |
| Load screen draw at save | `Random(2)` at every save | not drawn | a ja2-node save never changes the state |
| Help screens seen | a mask saved in the savegame, zeroed by a restart | per campaign in `localStorage` | UI state |
| Stat progress bars | Stracciatella's `gui_extras` on by default | off | they reveal hidden progress (D16); vanilla has them off |
| Attachment AP (if settled so) | one charge per box session | one charge per accepted `attach`/`detach` in combat | commands instead of a box |
| Shop above 640×480 (if centred) | Stracciatella leaves the shop at the top left | centred like the other fixed screens | consistency |
| Map-screen pause during merc lines | the map screen pauses while a merc speaks | not paused | strategic time is simulation |
| Cosmetic laptop draws | — | add the conference distortion's `Random(200)` | presentation |

Rows that M8 closes or narrows: "Credits screen", "Save list in the launcher" (for the canvas), "Enemy glow", "Fog of
war" (wireframes and slanted roofs), "Window hits", "Helicopter on the map", "O3 statue graphics", "Sound coverage"
(button clicks, stealth), "Real-time pause" (the canvas follows the original; the API keeps its behaviour), and the M8
entries of `01` §12 "Left out of M7".

---

## 15. Tests

- **Foundation units (Node, `ui` is DOM-free):** every rule of §3.1 with scripted event sequences (priorities, newest
  wins, inclusive edge, press lock, double click, repeat, cursor fall-through, mutation during callbacks); tooltip timing;
  button press semantics and disabled styles; glyph mapping with the guard; colour resolution per font; measure, align,
  `LineWrap`, the Ian codes and `IanWrappedStringHeight` on the stub fonts (Latin and Cyrillic), and on the original fonts
  with `JA2_DATA_DIR`; cursor composition; hotkey tables.
- **Layouts:** the schema and bindings contract for every layout of every skin; every asset, frame, font, cursor and
  string key resolves on the stub pack; with original data, references resolve and frame sizes fit (no image written).
- **Controllers:** each screen controller against a fake `GameClient` over recorded views (scenario builders in
  `tests/support`): what it shows, what a click sends; **draw-list snapshots** (a screen in a given state produces this
  list of quads and glyph runs): exact, GPU-free regression tests.
- **Server:** query purity (snapshot before and after every query kind on the stub scenarios), fairness (no unseen
  soldier reachable through a hint or query), each new view field and event in scenario tests (and the `JA2_RELOAD=1`
  mode), each new command with its refusals; rules with an oracle probe where they port original code (time warp,
  loading screen draw, attachment AP, the new tactical commands); the rule pack: the simulation loads only from it
  (no STI read), its hash is stable across restarts, a save records it.
- **Hints, client against server:** for every hint kind, over the stub scenarios and the original-data scenarios
  (`describe.skipIf`), sampled points (tiles, modes, aims, slots, sectors) computed on `knowledgeWorld` built from the
  serialised view alone and by the server's query handler; equal answers required. The projection used in these tests
  fills every field the view does not supply with a value that throws when read. A **shadow mode** in e2e sends every
  local hint to the server as well and fails the test on any difference.
- **Animation schedule:** with the server's scripts the client's sprite frames equal today's timeline playback over the
  scenario suites; with stub scripts against original rules the markers' ticks are hit (the warp) and nothing is
  sent back.
- **End to end (Playwright on stubs):** a widget-tree hook `window.__ja2Ui = {ready, screen, scale, widgets: [{id, kind,
  rect, visible, enabled, state, text, frame}], modal, cursor, lastCommand, lastResult, frameCount, capture()}`; tests
  click widget centres through `page.mouse` (so hit testing, priorities and scaling are exercised) and press the original
  hotkeys by `KeyboardEvent.code`. Flows: main menu → game init → laptop → hire through A.I.M. → land → a battle with
  cursors and the HUD → the map screen → plot a route → save and load; options; the PBI and autoresolve; a shop; a
  conversation. **Screenshots only on stubs**: the logical framebuffer read through `capture()` against golden PNGs in
  `tests/e2e/golden/` (stub art is original work), nearest sampling, the clock pinned; translucent shading allowed ±1.
  **Never capture or commit original-data screenshots**; original-data runs assert structure only.
- **Performance:** a frame-time probe in the hook (`frameStats {p50, p95, max}`), a Playwright sanity check on stubs,
  and a manual measurement on original data recorded in this document.

---

## 16. Performance targets

| Target | Value | Measured where |
|---|---|---|
| Tactical frame time at 1920×1080, UI scale 2, original data, a busy sector (A9, 12+ soldiers), real time | p95 ≤ 16.7 ms (60 FPS) | the maintainer's machine, recorded per slice U4/U5/U6 |
| Static world per frame (JS) | ≤ 1 ms after the static scene buffer | `buildScene` bench in Node |
| Draw calls, tactical with HUD | ≤ 250 | renderer counter |
| Screen switch tactical ↔ map ↔ laptop (assets cached) | ≤ 100 ms | hook timing |
| First tactical load from a cold HTTP cache (local) | ≤ 2 s including the loading screen | hook timing |
| A cursor hint computed in the browser | ≤ 2 ms p95 (path search included) | hook timing |
| Server query round trip (local; agents and fallback) | ≤ 10 ms p95 while no enemy turn runs; never queued behind an advance | WebSocket timing |

**Load timing** (2026-10-25). `__ja2Ui.tactical.loadMs` holds `{total, sincePageStart, phases}` of the last tactical
load: milliseconds from the load's start to the end of each branch (`assets`, `presentation`, `world`, `layouts`,
`media`, and `sound`, filled in when it arrives; `map` marks the map data ready for the world, which is then built on
the GPU) and from the page's navigation start. The screen does not wait for
`sound`: it starts with the load (the data version comes from the page, the animation tables when `assets` has them,
the ambient table from the prepared world) and the director and the world's ambient join the running screen, which
drops sound events until then. The loaders run their independent branches at once
(`tactical-host.ts`, `map-host.ts`, `bootUi`, the front end, the layout loader, the strings, the anim and corpse
structures, the light templates), so a remote browser pays the HTTP/1.1 limit of six requests at a time instead of one
round trip per file. The built client, A9 on the original data, headless Chromium on this VM (no GPU: the software
compositor reads every WebGL frame back, about 3 s of a load, so these numbers are not the maintainer's):

| Opening of the tactical screen | Before | After |
|---|---|---|
| Cold cache, local | 4.8 s | 3.3 s |
| Cold cache, 50 ms latency, 50 Mbit/s | 12.9 s | 6.7 s |
| Warm cache (no request) | 4.0 s | 3.1 s |

Not holding the screen for the sound took the warm opening on the dev server from 2.2 s to 1.6 s.

A profile of the warm load (2026-10-26) showed the main thread busy all the time, three quarters of it in the browser's
own work for the canvas: the page redrew the unchanged loading screen every animation frame, and on this VM every WebGL
frame is read back by the software compositor. `GamePage` now draws a frame only when something changed: a screen
without the world whose draw items equal the last drawn ones (`sameDrawItems`, plain data compared field by field), at
the same resolution and canvas size, after a frame that missed no image or font, is left as it is shown, and at least
one frame in 500 ms is drawn anyway. The tactical load also no longer competes with work it does not need: the soldier
asset tables, palettes and structures are read at once instead of one after another (they waited behind the other
branches' requests in the asset source's queue of twelve), and the client knowledge for the cursor hints (the rule pack
identity, the rule reader, its own world) opens after the screen has loaded, the server answering the hints until then.
Warm opening of A9 on the dev server, alternating runs on the loaded VM: 1.53-1.73 s before, 0.61-0.66 s after.

**An idle tactical screen** (2026-10-26). The world was drawn again on every animation frame, so a still screen cost as
much GPU as a fight. `WorldRenderer.render` now builds the frame as before and then compares it with the last one
(`PictureMemo`): the viewport, the camera offset, the natural shade, the shade field's version, a count of static
uploads, the visible rows, the shadow and roof switches, and every item and dynamic instance with its draw state, sprites
wholly outside the viewport left out as the vertex shader drops them. The atlas and the palette rows only grow, so a
sprite or palette added later shows up as a new instance. An equal frame is not drawn: the world framebuffer still holds
it, and `WorldRenderer.picture` keeps its number. `GamePage` asks the world layer for that number before drawing
(`render` builds the frame, `present` copies the framebuffer into the logical one) and leaves the whole frame as shown
when the number and the UI's draw items are those of the last frame, so a still scene touches neither the GPU nor the
compositor. What remains is the original's own motion: soldiers' animation frames, animated tiles every 200 ms, the
item glow and the enemy glow every 100 ms, the faces blinking, the radar dot flashing. The test hook builds its widget
list and time summaries only when read. The cursor hints keep their answers and their client world over a frame that
moved only the tick (the server's heartbeat), since no hint reads it.
A9 on the dev server, headless Chromium on this VM, idle in real time, 10 s: the GPU process (software WebGL) used
about 5.2 s per second at 34-37 animation frames per second before; after, 0.75 s with no soldier on screen (9 frames
drawn per second, the faces and the radar) and 2.1 s with the squad on screen (18), at 60 animation frames per second.

**Partial redraws of the world** (2026-10-26). A frame that changed is not drawn whole either. `PictureMemo.update`
returns `same`, `full`, or `partial` with a shift and at most eight rectangles (`dirty-rects.ts`): the camera's move
since the last frame shifts the picture (`WorldFramebuffer.copyShifted` into the second framebuffer, as the original's
`ScrollJA2Background` does) and uncovers a strip; every visible instance that appeared, disappeared, changed or moved in
the drawing order adds its rectangle at the new camera, old ones included (the instances are compared as multisets of
their values, then for order). The rectangles are merged greedily (overlapping ones, else the least added area), and the
frame is drawn whole when they cover 60 % of the view, when the global inputs changed (natural shade, shade field
version, static uploads, render height, shadows, roofs, viewport), when the shift is a view or more, or when it is odd
(the dither pattern alternates per pixel; a tile-centred camera always moves by an even amount). A partial frame clears
colour and depth inside the rectangles and runs the same draw calls with the scissor on their bounding box, the vertex
shader dropping instances that touch no rectangle and the fragment shader discarding pixels outside them, so the pixels
inside equal a whole redraw's. The shifted part is right only if no sprite that shows depends on the rows chosen:
`StaticScene.assemble` measures how far its sprites rise above and hang below their row (`RowReach`) and `visibleRows`
takes at least that margin (deviation "Sweep window"); dynamic instances need no margin, since the diff redraws one
that enters or leaves the rows. `?worldCheck=1` draws every partial frame a second time whole and compares the pixels
(`__ja2Ui.tactical.worldChecks`); the stub e2e (`world-redraw.spec.ts`: breathing, a walk, scrolls in six directions)
and the original-data tour (scrolls over A9) expect no difference, and a strip cut short by two pixels on purpose was
caught at once. A scroll step redraws about 6 % of the view, a breathing soldier his own sprite; on this VM, where the
vertex work and the compositor's readback are done in software and dominate, a presented frame of the idle squad costs
93 ms of the GPU process instead of 114 and a scroll frame 110 instead of 134 (canvas 1280×960; at 640×480, 63 instead
of 81).

**The canvas at the logical size** (2026-10-26). Every presented frame used to clear the whole device-sized canvas and
blit the logical picture up into it, and the compositor then read that canvas again: on a 4K screen about 8 Mpx per
pass against the world's 1–2 Mpx. The canvas now has the logical size and the compositor scales it in the pass it makes
anyway (§2.6), so the GPU writes 4–16 times fewer pixels. On this VM a presented frame of the idle squad costs 63 ms of
the GPU process instead of 93 at a 1280×960 window and 66 instead of about 170 at 1920×1440; a scroll frame 76 instead
of 110. The old canvas was also not exact: sized `100vw × 100vh`, it held `round(CSS × ratio)` pixels where the window
has a fractional number (1301 CSS px at 1.25 is 1626.25), and Chrome and WebKit filtered the whole picture to fit.
`tests/e2e-browsers/presentation.spec.ts` (`pnpm e2e:browsers`, its own CI job when `pnpm gates` selects it) opens the main menu on stubs in
Chromium and Firefox at pixel ratios 1, 1.25, 1.5 and 2, at 1301×977 and 1366×768, with and without the 640×480-only
option, and compares a device-pixel screenshot with the logical capture scaled by whole blocks: every device pixel must
match. Firefox runs with a display (`xvfb-run`; headless Firefox has no WebGL without a GPU) and `webgl.force-enabled`;
locally it needs an X display (`DISPLAY=:99` with Xvfb). Playwright's WebKit ran here too at first and was dropped
(2026-10-26): it is a Linux build, not Safari, it places the canvas like Chrome, its screenshot repaints the canvas
from the drawing buffer, so it needed a test-only `?keepDrawingBuffer=1`, and it needed the most system libraries; at a
fractional ratio with the 640×480-only option it blended the last column with the border, which Safari, with whole
ratios only, does not meet. The video overlay keeps its own canvas sized in CSS pixels.

---

## 17. Minimal M8 implementation

### 17.1 Modules

| Module | Layer | Content |
|---|---|---|
| `src/ui/input/` | ui | region dispatcher, tooltips, keyboard events, hotkey tables |
| `src/ui/text/` | ui | font metrics, colour resolution, measure, align, wrap, Ian codes, printf, money |
| `src/ui/widgets/` | ui | the widget vocabulary of §3.9 |
| `src/ui/layout/` | ui | schema, loader, bindings contract, anchors and scaling |
| `src/ui/cursors/` | ui | the cursor database and compositor |
| `src/ui/draw-list.ts` | ui | the draw list |
| `src/ui/screens/` (`main-menu`, `game-init`, `options`, `save-load`, `credits`, `loading`, `tactical/`, `map/`, `battle/`, `shop`, `talk`, `laptop/`, `story`) | ui | controllers and view models |
| `src/ui/speech.ts` | ui | the speech presenter |
| `src/render/ui-draw/` | render | draw list → batches; UI primitives; text shader |
| `src/render/world/` (extend) | render | texture arrays, static scene buffer, UI nodes, items, roofs, light, glow |
| `src/app/game/` | app | the game page, screen stack host, DOM input glue, asset source and cache |
| `src/app/net/` (promoted) | app | `SessionClient`, save keys, sleep/wake stop, page music |
| `src/protocol/view.ts` (extend) | protocol | `applyViewFrame`, the new fields, the animation schedule |
| `src/sim/knowledge/`, `src/sim/hints/` | sim | the player-knowledge projection and the hint functions (§2.4) |
| `src/content/rules/` | content | the rule pack: its file set, the numbers taken from STI headers, the split scripts, its hash |
| `src/app/game/hints.ts` | app | the local hint provider, the fallback to the server, the shadow mode |
| `src/server/` (`query.ts`, `rule-pack.ts`, `presentation-messages.ts`, `profiles-api.ts`, `items-api.ts`, `assets-manifest.ts`) | server | §12, §2.5 |
| `data/layouts/original/` | data | the layouts |
| `data/tables/ui-constants/`, `data/tables/cursors.json` | data | generated by `tools/transcribe/ui-constants.ts`, `cursors.ts` |
| `stubs/ui/` | stubs | §13 |

### 17.2 Order of work (one background agent per slice)

| Slice | Content | Depends on | Done when |
|---|---|---|---|
| **U0** Platform | the `ui` layer and import rules (`app` → `sim`); promote the devtools client pieces to `app`; generic `applyViewFrame` (meanwhile, ended, music applied); the `/play` page with the screen and modal stacks; the logical framebuffer and UI scale; the draw list and `ui-draw` with fills, shades, hatches, lines, scissor, outline, RGB565, the text shader; **the rule pack** (the simulation reads no STI: explosion and tileset frame counts and aux data move into it; the scripts split into logic and presentation; the content identity's logic hash is the pack's); the asset manifest, immutable URLs, `HttpVfsLayer`, `AssetCache`, per-screen preload, the client's rule content; the `__ja2Ui` hook and stub goldens | — | an empty game page boots on stubs and original data and draws a test screen through the draw list; the oracle compare-all and every gate unchanged with the simulation loading from the rule pack; goldens run in CI |
| **U1** Widgets and text | §3 complete: regions, tooltips, buttons, fonts and text layout, cursors (transcriber + compositor, software cursor), popup menu, merc popup box, message box, slider, text field, progress bar, fade, snapshot zoom, hotkey tables; the layout schema, loader, `ui-constants` transcriber and the contract test; a devtools widget gallery; the layout-driven stub generator and the stub cursors (§13) | U0 | every §3 rule has a unit test; the gallery shows each widget on both data sets |
| **U2** Front-end | main menu, game init, options (all 23 toggles take effect or are listed as inert), save/load (DOM-free save controller shared with the launcher), message boxes, credits on canvas, loading screens and bar, fades, exit, music without a session, `closeSession`, the Dead is Dead description; client settings `bloodAndGore` and the help mask; stub front-end art | U1 | a stub new game starts from the canvas main menu and reaches the laptop; save and load round-trip through the canvas screens |
| **U3** Hints and server for the HUD | `knowledgeWorld` and the tactical hint functions (`previewMove`, `previewAction`, extended `estimateAttack`, `placements`, `itemInfo`, `exitSector` dry run) in `sim`; the query channel answering them over the projection, with purity, fairness and client-against-server tests; the local hint provider with fallback and shadow mode; G1–G7, G14 base fields, G18 profiles endpoint, G19 item catalogue; `lifeLost`, `aiTurn`, `enemyTurnProgress`, `itemsRevealed`, interrupt selection; the animation schedule in the view; message entries; refusal tokens; `pauseOn`; rule findings 1, 2, 4, 6, 7 | U0 (parallel with U1, U2) | `pnpm check`, data tests, `JA2_RELOAD=1`, oracle compare-all unchanged except the deliberate fixes; every hint kind equal on both sides over the scenario suites |
| **U4** World renderer | texture arrays, the static scene buffer, persistent instance buffer, camera snap and limits, sprite picking, the UI node pass, animated tiles, items, mercs on roofs, corpses and clouds, per-tile light (`20` §8), glow and fade palettes, wireframes and slanted roofs; soldier frames from the animation schedule with the time warp; G8 | U0 (parallel; the schedule from U3) | the performance targets of §16 for the world alone; the M8 rendering deviations closed |
| **U5** Tactical HUD | team and SM panels, faces with blink and lip sync, bars, radar and squad list, inventory slots with the local cursor, stack and key-ring popups, item description box, pickup menu, the clock, top bar, message log, overhead labels, damage numbers, locators, glow; stub faces, items, interface panels, radar | U1, U3, U4 | a stub battle is fought with the HUD (no developer panels) |
| **U6** Tactical input | the UI state machine, mouse and world cursors, footstep paths, hotkeys, rubber band, scrolling, movement and door menus, exit dialog, overhead map, the input lock with playback catch-up; the new tactical commands (`stealth`, `weaponMode`, `attack.spread`, `move.reverse`, `moveGroup`, `swapPlaces`, `jump`, `climbWindow`, `mute`, `combineStack`, `leaveVehicle` in tactical, `door openManually`) | U5 | every gameplay hotkey and gesture of §6 works or shows the original refusal |
| **U7** Talk and shop | speech presenter, talk panel, comm and external popups, civilian boxes; shop screen with the shop model; G14, G15, `setShopPricing`; money commands | U5 | a stub conversation, a recruitment and a trade through the canvas |
| **U8** Map screen | §7 complete incl. assignments (`assignmentOptions` hint), plotting (`previewRoute` hint, `route via/shortest`, `shortenRoute`, `routeGroup`), helicopter (`previewHeliRoute` hint, progress), town box, sector inventory, bottom panel, update box (`pauseOn`), popups, hotkeys; G9–G13, `groupArrived`, `discardItem`, `canEnterSector`; militia popup with `moveMilitia`/`distributeMilitia` | U5, U6 (inventory and faces) | a stub campaign moves, trains, assigns and travels by helicopter through the canvas |
| **U9** Battle entry | PBI and autoresolve screens, G16, `battleSummary` | U8 | both PBI kinds and every autoresolve outcome on stubs |
| **U10** Laptop I | laptop widgets (drop-down, paged text, item picture cell, portrait shading), shell, Email, Finances, A.I.M. hiring; X1–X5, X7 (finances), X8, X16 | U1, U3 (profiles, items) | a human hires the squad through the canvas laptop on stubs and original data |
| **U11** Laptop II | Bobby Ray's, M.E.R.C., I.M.P.; X6, X11, X12, X15; rule finding 5 | U10 | an order is delivered, a M.E.R.C. merc hired, an I.M.P. character created |
| **U12** Laptop III | Personnel, History, Files, Insurance, Florist, Funeral; X9, X10, X13, X14 | U11 | every bookmark leads to a finished page |
| **U13** Story and help | the meanwhile box, the ending wiring, help screens, the brothel screen; rule finding 3 settled | U2, U5, U8, U10 | a stub campaign's meanwhile and ending play through the canvas |
| **U14** Stub art and e2e | the remaining special-case stubs, the e2e flows of §15 (shadow mode on), goldens for every screen, the original-data structural tests | all screens | §15 complete in CI |
| **U15** Release | `deviations.md`, `01` §12, README, `releases.md` (0.8.0), the launcher's place | all | maintainer's review |

U1, U3 and U4 can run in parallel after U0 (they touch different layers); the laptop slices U10–U12 can run beside the
map and battle slices once U5's faces and item tiles exist. Every slice keeps the M7 gates (`pnpm check`, the data
tests, `JA2_RELOAD=1`, oracle compare-all, e2e) and adds its own.

### 17.3 After M8

| Work | Scenario (§1.3) | Content |
|---|---|---|
| The client's own data | 3 | `LocalFolderLayer` (`showDirectoryPicker` or `<input webkitdirectory>`, ranged reads of the archives), the per-file check against the manifest with fallback to the server, the data version check, the warp when scripts differ |
| Data uploaded by the client | 4 | the serialised rule pack built in the browser, upload by hash, validation and per-user storage on the server, per-session content, sessions bound to a pack |
| Remote play | 3, 4 | compression of `/vfs` for compressible families, optional audio transcoding |
| Stub game | 1 | nothing planned |

### 17.4 What landed

#### U0a — client platform (2026-10-19)

The client half of U0. The data half (the rule pack, the manifest, immutable `/vfs/@hash` URLs, `HttpVfsLayer`,
`AssetCache`, preload, the client's rule content) is U0b.

| Area | As built |
|---|---|
| `ui` layer | `src/ui` (lib ES2024, references core, content, protocol; the `NONDETERMINISM` forbid list, time is injected). `tools/check-imports.ts`: `ui` → core, content, protocol; `app` → + ui, sim; `render` → + ui **types only** (a new `typeOnly` rule: a value import from `ui` fails `pnpm imports`); `devtools` and tests → + ui. tsconfig references in the root, render, app, devtools and tests |
| Promoted to `app` | `src/app/net/`: `session-client.ts`, `save-controls.ts` (the quick-save keys), `sleep-wake-stop.ts`, `music.ts` (`PageMusic`), `vfs.ts` (one `/vfs` helper: `vfsUrl`, `fetchVfsFile` throws, `fetchOptionalVfsFile` null on 404, `readVfsFileOrNull` null on any failure; it replaces the copies in the asset browser, the launcher and the video player). `src/app/world/`: `world-loader.ts` (`loadWorld`), `soldier-assets.ts`, `radar.ts` (the radar picture, the click → cell and viewport-box arithmetic; the devtools `Radar` keeps the 2D canvas). `src/app/sound/`: `tactical-sound.ts`, `strategic-sound.ts`. `src/app/media/load-asset.ts` (`loadAsset`). Every reader takes a `ReadVfsFile` (default: the fetch helper), so `HttpVfsLayer` can replace it. The devtools pages import them from `app`; their e2e specs are unchanged |
| `applyViewFrame` | `src/protocol/view.ts`: copies every view field a frame carries (generic over the field names), replaces the soldiers through `applyFrame` and moves the tick. `SessionClient` keeps the shown (playback) view and the latest received view (`latestView`, for U3's hints) through it; `meanwhile`, `ended` and `music` now arrive. Tested as the inverse of `diffPlayerView`: `ReloadingSession` (`tests/support/session-reload.ts`, used by the eleven stub scenario suites) subscribes a `ViewMirror` (`tests/support/view-mirror.ts`) that rebuilds the view from the frames (sent through JSON) and compares it with the session's view after every dispatch and advance. The comparison treats an absent nullable field as `null`, an absent list as empty, ignores the tick of a frameless step and `music.fastFade` (a per-transition flag `sameMusic` ignores too); `clock`, `strategic` and `music` stay as last sent, which the server's views always carry |
| The game page | `/play` → `src/app/game/index.html` (a Vite entry; `src/node/client-pages.ts` aliases the path for the Vite dev and preview servers and for the built client's `serveStatic`). `main.ts` boots one `SessionClient` (`?session=`, default session otherwise; the page draws without it), one WebGL2 context (`preserveDrawingBuffer` off), a `ScreenHost` (`src/ui/screen.ts`: a screen stack with `enter`, `exit`, `update(now)`, `input(event)`, `render(list)`; a modal stack whose modals take input first, the top one blocking unless it passes unhandled input; the screen under a modal is drawn, not updated), DOM input glue (`dom-input.ts`: pointer events through the inverse letterbox, `setPointerCapture`, `contextmenu`, middle and X buttons suppressed, `wheel` non-passive; keys → `src/ui/input/events.ts` with `repeat`, the key from `event.key` when printable ASCII else from `event.code`, the keypad by code unless NumLock is off, masks Shift 1, Ctrl 2, Alt 4, text events for printable keys without Ctrl/Alt; every key is `preventDefault`-ed except with Meta) and a `requestAnimationFrame` loop on an injected clock (`?pinClock=1` pins it at 0) |
| Resolution | `src/ui/resolution.ts`: auto scale = the largest integer keeping 640×480, logical size = floor(canvas / scale) and at least 640×480, `STD_SCREEN_X/Y` = (logical − 640×480) / 2; a forced scale (client setting `uiScale`, 0 = auto, or `?scale=`) and the 640×480-only option (`fixed640`, `?fixed640=1`). The frame is drawn into a framebuffer at the logical size (`src/render/ui-draw/logical-framebuffer.ts`) and blitted with `NEAREST`, centred with black bars; when even 640×480 does not fit the canvas it is shrunk to fit (nearest) |
| Draw list | `src/ui/draw-list.ts`: `image` (asset key = VFS path, frame, position, palette shade = `Create16BPPPaletteShaded` scales, effect normal / outline colour or discard / outline shadow), `glyphs` (font id, positioned glyphs, foreground/shadow/background font palette indices), `fill` (right/bottom exclusive), `rectangle` and `line` (inclusive), `shadow` (inclusive, factor 0.48 or 0.8), `hatch` (inclusive; checker black or 1-in-8 loose with a colour), `clipPush`/`clipPop` (right/bottom exclusive, nested clips intersect). Builder arguments follow the original functions' coordinates; items store x, y, width, height |
| `ui-draw` | `src/render/ui-draw/`: one instanced program (`ui-shader.ts`), a planner (`ui-plan.ts`, GPU-free and unit-tested) that batches by index atlas page, RGB565 texture, blend (multiply for shadows and outline shadows) and scissor, one buffer upload per frame. Shadows modulate by floor(255·f)/255 like the SDL colour mod (0.48 → 122/255); hatches start at the clipped top-left corner; index 254 is drawn in the outline colour or skipped; the outline shadow darkens non-254 pixels by the shade table's 0.48; RGB565 STIs are `RGB565` / `UNSIGNED_SHORT_5_6_5` textures; glyph pixels 0/1/other select background/shadow/foreground with alpha 0 = none. Images and glyphs share one R8UI atlas (`TextureAtlas`) and the `PaletteTexture` rows (one per image and shade) |
| Fonts and colours | `src/content/text/font-colors.ts`: the `Font_Control.h` colour indices, `NO_SHADOW`, `DEFAULT_SHADOW` and `resolveFontColors` through the font STI's palette with the two black rules, "black" meaning 0 in 16 bits (a non-zero shadow index on black becomes near-black `0x000008`, a black background is transparent). `src/ui/text/bitmap-font.ts`: glyph metrics from a font STI and the glyph table with the glyph-count guard (layout and measuring are U1). `glyphTablePath('stubs')` now names the stub table. `src/content/picture/shaded-palette.ts`: `Create16BPPPaletteShaded` |
| Test screen | `src/ui/screens/test-pattern.ts`: every primitive, nested clips, two glyph runs in `font10arial` (Latin, Cyrillic) and one in `font14arial` with a background, the stub test card in normal, mono, tinted and the three outline effects, the RGB565 card, a blink on the injected clock and a pointer marker. With original data it also draws `interface/mdguns.sti` with outlines and drop shadows and `loadscreens/ja2logo.sti` (checked by hand on the maintainer's data, never captured) |
| Stub art | `stubs/ui-test-card.ts`: `stubs/ui/test-card.sti` (two indexed frames, one with an index-254 outline) and `stubs/ui/test-card-565.sti`. The stub font palette names the `Font_Control.h` colours with authored RGB values (white, greys, reds, yellows, greens, blues, khakis); its `DEFAULT_SHADOW` index is black, so stub text exercises the near-black shadow rule |
| Hook and goldens | `window.__ja2Ui` (`src/app/game/ui-hook.ts`): `ready`, `error`, `screen`, `modal`, `scale`, `origin`, `logical`, `widgets` (empty until U1), `frameCount`, `session`, `dataVersion`, `pointer`, `presses`, `draw` (instances, batches, missing assets, multiply areas), `reads` (`pendingReads`, the `/vfs` reads in flight, which `tests/e2e/ui-capture.ts` waits out before a golden) and `capture()` (the logical framebuffer, top-down RGBA in base64). `tests/e2e/play.spec.ts` renders the test screen on stubs at scale 2 (1280×960) and compares it with `tests/e2e/golden/test-pattern.png`: exact, except ±1 per channel inside the multiply areas the renderer reports; `JA2_UPDATE_GOLDENS=1` rewrites the golden. It also checks the pointer mapping at scale 2 and with the 640×480-only option |

Decisions and limits: diagonal lines use a plain Bresenham walk rather than `LineDraw`'s run-length slices (the UI
draws few diagonals); RGB565 pictures are drawn opaque; text and images use the palette's 24-bit colours (the 565
quantisation option of §3.11 and the sharp-bilinear fit of §2.6 are not built); the per-screen asset lists are the test
screen's own constants until U1's layouts declare them, read through `UiAssets` (`src/app/game/ui-assets.ts`) with an
injectable reader for U0b's `HttpVfsLayer`.

#### U0b: data platform (2026-10-19)

The data half of U0: the rule pack, the split animation scripts, the asset manifest with immutable URLs and the
client's asset and rule modules (not wired into a page yet; the lead wires them after U0a). Every gate is unchanged:
the oracle compare-all matches every probe and the 0.7.0 saves continue as they did.

**Graphic facts** (`src/content/rules/graphic-facts.ts`). The logic loaders no longer decode STI files: the tileset
geometry (`loadTileSurfaceGeometry`) and the explosion frame counts (`loadExplosionContent`) read
`@rules/graphics/<graphic path>.json`, the frame offsets and widths, the app data and the kind of a graphic (indexed,
RGB, stub sprite, not an STI, broken). The rule pack stores these files; `withGraphicFacts(read)` derives them on demand
for callers that read the raw VFS (tests, the oracle tools, the benchmarks). The render path (`loadTileSurfaces`)
still decodes the pictures.

**The split scripts** (`src/content/anim/timelines.ts`). `splitAnimationScripts` turns `ja2bin.dat` into a
**logic timeline** (per slot: frame, empty, opcode, jump, state transition, or an empty step for the sound-range codes
no simulation handler acts on, at the same position so jumps and opcode skips are unchanged) and a **presentation
timeline** (the sprite frame and the sound-range code per slot). `TacticalContent.timeline` replaces `scripts`; the
soldier keeps `frameSlot`, the timeline slot of the frame it shows (`NO_FRAME_SLOT` before the first frame of a state,
`OUTSIDE_SCRIPT_SLOT` past the script), instead of the sprite frame. Views derive `SoldierView.frame` from the
presentation timeline the session hands to `tacticalPlayerView` (sessions take it from `loadAnimationTimelines(read)`,
memoized per reader). The native save import maps the saved frame and code to the slot (`frameSlotOfSpriteFrame`);
snapshot version 3 migrates version 2 snapshots the same way on restore. A test runs every sound-range code that the
logic timeline leaves out through the simulation's opcode hooks and checks they return nothing and change nothing.

**The rule pack** (`src/content/rules/pack.ts`, `families.ts`, `graphics.ts`, `rule-reader.ts`).

| Part | Content |
|---|---|
| File families | `externalized/**.json`, `tables/**.json`; `binarydata/{ja2bin.dat, ja2set.dat, prof.dat, locks.bin}` under any root (the stub ones included); `maps/*.dat` under any root; every `.jsd`, `.npc` and `.edt`; `stubs/profiles.json` |
| Graphic facts | one file per graphic the simulation takes numbers from: every tileset surface of every tileset under every map root (`ja2set.dat` × `tables/tiles.json`) and every explosion graphic of `externalized/explosion-animations.json` |
| Layer counts | per rule file present in several VFS layers (the NPC record layering reads them) |
| Hash | SHA-256 over lines `ja2-node-rules 1`, `source <original\|stubs>`, `f <path> <size> <hash>` per rule file, `p <path>` per text file (presence only: quote lengths stay the separate text identity, so a text change still only warns), `g <graphic> <size> <hash>` per graphic, `l <path> <count>`; `<hash>` is the first 16 hex digits of the file's SHA-256, the asset manifest's hash, so a client computes the pack hash from the manifest and three small rule files |
| Scripts hash | the content hash of the animation scripts file the pack holds |
| Read | `RulePack.read` / `exists` / `layers` answer from the pack and throw `NotARuleFileError` for any path outside the families and the facts; `liveRuleReader` does the same over any listing (the client) |
| Size | original data: 4,548 entries (2,574 rule files, 1,974 facts), 118 MB, built in 1.9 s, loaded from the cache in 0.1 s; stubs: 477 entries, 29 MB, 0.3 s |

`src/server/rule-pack.ts` builds the pack at start (`openRulePack`) into `.ja2/cache/rules-<pack hash>/` (`pack.json`:
the source key and the manifest; `blobs/<sha256>`: the bytes) and finds it again through `.ja2/cache/rules-index.json`,
keyed by a SHA-256 over the format, facts and family versions, the source and every VFS file's path, size, layer
count and stamp (an SLF entry: archive path, size, mtime, offset, length; a loose file: path, size, mtime); any change
of the data rebuilds it, a cached manifest is verified against its hash, and the four most recently used packs are
kept. `JA2_CACHE_DIR` moves the cache. The server, the worker hosts and `pnpm cli replay` load the simulation's
content only through the pack; tests build packs in memory.

**Content identity and saves.** The logic hash of the content identity is the pack hash. Save version 2 drops the file
list (`contentFiles`); the migration from version 1 keeps it as `legacyContent`, and such a save is checked by the
0.7.0 hash over those files read from the raw data (`ContentLedger.logicHash`), so 0.7.0 saves keep loading; a
re-save writes version 2. The save list flags a version 2 save of another pack as `contentMismatch` without reading
its body. `src/server/fixtures/` holds a campaign and a sandbox save written by the code at 91a4365 on the stub pack
with the views it showed; `legacy-save.test.ts` loads them and expects the same views 400 ticks later.

**Manifest and immutable URLs** (`src/server/assets-manifest.ts`, `src/server/app.ts`, `src/protocol/assets.ts`).
`GET /api/assets/manifest` → `{format: 'ja2-node-assets', version: 1, source, stubText, files: [[path, size, hash],
…]}` (a fourth element when a path sits in several layers), gzipped when accepted, revalidated by ETag. `VfsHashes`
hashes on demand and persists in `.ja2/cache/vfs-hashes.json` by stamp (entries of other data sets kept); the pack
build seeds it. On the original data the first manifest takes 2.1 s (34,279 files) and 0.2 s after a restart; it is
449 KB gzipped. `GET /vfs/@<hash>/<path>` answers with `cache-control: private, max-age=31536000, immutable` when the
hash is current and 404 otherwise (400 for a malformed hash); plain `/vfs/<path>` sends the content hash as a strong
ETag. Token rules are unchanged. `/api/health` names the rule pack.

**`welcome`** carries `engine: {version, commit}` and `rules: {pack, scripts}` (`WelcomeIdentity`,
`src/protocol/messages.ts`; set on each session by the session factory).

**Client modules** (`src/app/assets/`, `src/app/rules/`).

| Module | Content |
|---|---|
| `http-vfs-layer.ts` | `HttpVfsLayer implements VfsLayer` from the manifest; reads through `/vfs/@hash/path` (ranges with `Range`), 8–16 parallel requests (default 12), one fetch per file in flight shared by its readers, per-read `AbortSignal` (the fetch stops when its last reader leaves) and `abortAll`; `StaleAssetError` on a 404 (refetch the manifest); `fetchAssetManifest` |
| `asset-source.ts` | `AssetSource` (the replaceable seam for the later local folder) and `HttpAssetSource`: the same `Vfs` class over the layer, the stub text fallback the server's `/vfs` has, `hashOf`, `read`, `readOptional` |
| `asset-cache.ts` | `AssetCache`: values by (content hash, decoder name), LRU by bytes (256 MB), loads shared while in flight, raw bytes reused by decoders; `loadDecodedAsset` |
| `preload.ts` | `preloadAssets(source, paths, {cache, signal, onProgress})` → loaded and missing paths, progress per file |
| `client-rules.ts` | `clientRulePackIdentity` (the pack and scripts hashes from the manifest, SubtleCrypto by default) and `loadClientRules(source, welcome.rules)`: the check (`packMatches`, `scriptsMatch`, `onMismatch`) and a strict rule reader with live graphic facts, so `loadTacticalContent(rules.read)` and the world loader give the server's content |

Tests: `graphic-facts.test.ts` (facts equal the decoded pictures' geometry on stubs and the original tilesets),
`timelines.test.ts` (the split is faithful for the stub and the original scripts), `animation-timeline.test.ts`,
`snapshot-migration.test.ts` (version 2 sprite frames), `pack.test.ts`, `rule-pack.test.ts` (every read and probe of
a campaign, a sandbox and every map answered by the pack as by the data, on stubs and the original data; a campaign
and a sandbox run while every graphic read throws; the disk cache, its reuse, its rebuild and its pruning),
`legacy-save.test.ts`, `app.test.ts` (manifest, pinned URLs, persisted hashes), `src/app/assets/*.test.ts`,
`client-rules.test.ts` (the client's pack hash equals the server's on stubs and the original data, the same world and
tactical content through both readers) and `tests/e2e/assets.spec.ts` (the browser builds its source, reads a map
through an immutable URL and computes the server's pack hash with SubtleCrypto).

Open for the lead and later slices: wire `HttpAssetSource`, `AssetCache` and `loadClientRules` into the `/play` page
after U0a; turning the client's rule reader into `TacticalContent` needs `app` → `sim` (U0a's import rule); U3 sends
the frame slot (the logic position) instead of `frame` and lets the client follow the presentation timeline.

#### U0c: the scope of the content identity (2026-10-19)

U0b's pack hash covered every rule entry of every VFS layer, so a new or regenerated project table or a stub generator
change refused every save made on the original data. The identity now binds a save to the game data (`docs/27` §1.7):

| Source | The identity covers | Another identity |
|---|---|---|
| `original` | the entries whose winning layer is the data folder or an SLF archive | refused (`contentMismatch`) |
| `stubs` | the entries of the stub layer | loads with the new warning `stubPackDiffers` |

The `ja2-node-data` layer (`tables/**`, `externalized/**`) is never covered, nor the stub layer on the original data:
those entries stay in the pack and answer reads and probes as before, and a difference there shows as `engineDiffers`.
The pack manifest (version 2) records each entry's winning layer and keeps U0b's hash over every layer as
`allLayersHash`, which names the cache directory and is still accepted from saves written by 9867f03. The identity
text's format line is `ja2-node-rules 2`. The asset manifest (version 2) adds `layers` and the winning layer's index
per entry, so `clientRulePackIdentity` applies the same scope. 0.7.0 saves compare only the files that come from the
identity layers at load time (files of `ja2-node-data` are taken from the repository's history at the save's commit;
generated stub files cannot be recovered and count with their current bytes). The launcher shows the warning with its
own line (`stubPackDiffers` in `labels.ts`), the save list predicts it, and the MCP load description names it.

Tests: `pack.test.ts` (new or changed tables and stub files keep the original-source identity, user rule files and
graphics change it; on the stubs a stub change changes it, a table does not; the all-layers hash equals U0b's for a
pinned input), `rule-pack.test.ts` (the same through VFS layers and `openRulePack`), `content-identity.test.ts` (the
scoped 0.7.0 check), `repository-history.test.ts`, `save-service.test.ts` (on the stubs another pack warns, on the
original data it refuses, a U0b identity loads), `legacy-save.test.ts` (the 0.7.0 fixtures warn after a recorded stub
file changes), `save-rows.test.ts` and the unchanged `client-rules.test.ts` and `tests/e2e/assets.spec.ts`.

#### U1: widgets and text (2026-10-19)

§3 as a DOM-free `ui` layer, the tables it reads, the stub art it needs and a widget gallery. No game screen yet (U2).

| Area | As built |
|---|---|
| Tables | `tools/transcribe/cursors.ts` → `data/tables/cursors.json` (68 files, 140 cursors: composites, hot spots, flags; the extern item file); `tools/transcribe/mlg.ts` → `data/tables/mlg.json` (the 33 MLG ids per data version); `tools/transcribe/ui-constants.ts` → `data/tables/ui-constants/<file>.json`: the `#define`, `static const`/`constexpr` and enum values of shared headers (`Font`, `Font_Control` with the font files, `MouseSystem`, `Video`, `Button_System`, `Button_Sound_Control`, `Cursor_Control`, `Cursors`, `WordWrap`, `Text_Input`, `Timer_Control` with the counter intervals as `<COUNTER>_MS`, `Text`, `Directories`) and of the first screens (`MainMenuScreen`, `Options_Screen`, `GameInitOptionsScreen`, `SaveLoadScreen`, `MessageBoxScreen`, `MercTextBox`, `PopUpBox`, `Slider`, `Animated_ProgressBar`); positions are evaluated with `STD_SCREEN_X/Y` = 0 (inside the std640 frame) and listed in `stdScreen` |
| Regions (`src/ui/input/regions.ts`) | `MSYS_UpdateMouseRegion` ported: one list by priority with the newest first, inclusive bottom-right hit test, `allowDisabledTooltip` capturing without callbacks, LOST/GAIN/MOVE to the top region, the button reasons OR-ed into one call, the press lock with the swallowed foreign release (and the lock that survives a release over no region), double click (down-up-down on one region within 400 ms) and repeat (250 ms, then 50 ms, one per frame) from the injected clock, the cursor from the region or the next enabled region below with one, removal inside callbacks; the left-up hook runs before dispatch (`ReleaseAnchorMode`); the list is re-evaluated once per frame after any region change |
| Fast help (`input/tooltips.ts`) | `RenderFastHelp` and `DisplayFastHelp`: 600 ms while the pointer rests with no button down, reset by a click, size, placement and clamping, the two frame rectangles, the interior shaded twice, `|` bold gold 146, `^` light green, `~` light red, beige otherwise; drawn only by screens that declare `rendersTooltips` (the message box never does) |
| Buttons (`widgets/button.ts`, `button-sounds.ts`) | Five-frame images (size = the largest offset + size of the frames used), kinds quick (anchoring), quick without move, NEWTOGGLE, check box, hot spot, label; text with the inset clip, the `-1` sub-offsets, hilite/down colours and the one-pixel shift, wrapped text, icons; disabled grayed frame or `DEFAULT`/`HATCHED`/`SHADED`/`NONE` (check boxes: hilite frames + hatch); slot order, hidden = region disabled, deletion inside a callback deferred; `QuickButtonCallbackMButn`'s StateBefore/StateAfter sound logic, the drag-off and drag-back sounds, the disabled click (`sounds/disabled button.wav`, volume 15); the generic scheme chosen from the current screen's `soundScreen` at creation |
| Text (`src/ui/text/`) | Font metrics and `FontSet` (macro → file from `Font_Control.json`), `'?'` for a missing code point and for an index past the font's glyphs, `StringPixLength`, `CenterAlign`/`RightAlign`/`HCenterVCenterAlign`/`HRightVCenterAlign` with C division, `DrawTextToScreen` (UINT16 wrap, `(w − len) / 2`, `TEXT_SHADOWED`), `LineWrap` (including its quirks: the overflowing character of a split word is not counted, CJK breaks one character early), `DisplayWrappedString`, `IanDisplayWrappedString` and `IanWrappedStringHeight` with codes 177–181 (bold in `FONT10ARIALBOLD` with the shadow off, 180 always 184, the height pass not consuming 180's argument), `CleanOutControlCodesFromString`, `ReduceStringLength`, `printf` (moved from the launcher), `SPrintMoney`, weights by the metric option, EDT fields (`{edt: [file, field]}`, the field index flattened over the record's columns) |
| Cursors (`src/ui/cursors/`) | `CursorState`: `LoadCursorData` (size from the composites, hot spot and centred sub-cursors resolved once), hidden sub-cursors, `CURSOR_TO_FLASH`, `FLASH2` and conditional composites with `SetCursorSpecialFrame`, animated files (aux `AUX_ANIMATED_TILE`) every 150 ms and flashing every 250 ms where the region asks (`animatesCursor`, `flashesCursor`), `DELAY_START_CURSOR` (nothing for a second), `VIDEO_DEFAULT_TO_NO_CURSOR`, the extern item cursor (index 254 skipped, hot spot in its middle), thrown items outlined green, `DrawMouseText` in `TINYFONT1` (`showsMouseText` regions) with the invalid AP flash; drawn last, clipped to the cursor's size, with `cursor: none` on the canvas and hidden when the pointer leaves it or under a fade |
| Shared widgets | `PopupBox` (background cropped, 2×2 corners, 16×2 and 2×8 pieces with the overlapping last piece, line colours, the second column, resizing) and `PopupMenu` (line regions at `HIGHEST − 4` over a closing screen mask); `MercTextBox` (`PrepareMercPopupBox` sizes, 349×199 cap, 10-pixel border tiling, icons, colours by background); `MessageBox` (a modal: 300 wide with margins 40/10/30, centred on the screen or a rectangle, full-screen `HIGHEST` back region with the style's cursor, every button set with the original positions, the keys as a hotkey table on release, the UI clock paused, `pauseGame` called, the screen frozen under it, its buttons sounding with the underlying screen's scheme); `Slider` (both styles, the off-region drag from the pointer's y, wheel steps, the inverted value, `SetSliderValue` ignoring the maximum); `TextFieldGroup` (the default scheme, full text and numeric filters, selection, caret keys, Tab order, Ctrl+Delete, unmodified keys swallowed, the caret on the UI clock, `ENTERING_TEXT`/`REMOVING_TEXT`); `ProgressBar` (load bar and panel); `Fade` (11 steps out then black, 9 in, 16 ms each); `SnapshotZoom` (render-to-texture with `BltStretchVideoSurface`'s stepping in the shader: new `capture` and `snapshot` draw items) |
| Screens and frame order | `Screen` gains `soundScreen`, `rendersTooltips`, `describe()`; `Modal` gains `freezesScreen`: `ScreenHost` keeps the draw items of the screen (and the modals below) taken when such a modal opens and replays them; `UiRuntime` (`src/ui/runtime.ts`) owns the regions, buttons, sliders, fonts, images, sounds, cursor, the wall and UI clocks and the host, and draws background and content (the screen), tooltips, then the cursor; held keys and modifiers are polled from it |
| Keyboard | Hotkey tables (`input/hotkeys.ts`): key, phase (down, up, repeat), exact modifier mask or `any`, action, condition; layouts and modals carry them; text fields get keys first; keypad Enter is Enter; Alt+Enter on release toggles fullscreen (with the Keyboard Lock for Esc where available); every other key is `preventDefault`-ed except with Meta |
| Layouts (`src/ui/layout/`) | JSON validated by `schema.ts` (the vocabulary of §3.9 with each primitive its own type, and `repeat`); `LayoutModel` resolves constants by name (the layout's tables, then the shared ones; `HIGH+10` style priorities; `$i`), assets (`sti`, `pcx`, `mlg` per data version), fonts by macro, palette colours, RGB fills, cursors, sound schemes and style tables; frames `std640`, `screen`, `viewport`, `tacticalPanel`, `tacticalInventory` (UILayout formulas) with nine anchors and `centerX`; `LayoutView` builds the live widgets: bindings, actions with arguments and string payloads, conditions (`binding`, `!binding`, `{eq}`, `{not}`), groups, repeats and lists rebuilt when their count changes, text sources (`key`, `format`, `bind`, `edt`, `money`, `literal` in debug layouts), popup menus, message boxes opened by `modal` widgets, custom renderers; it rebuilds on a resolution change; `LayoutScreen` hosts a view; `references.ts` collects assets with their frames and button states, fonts, cursors, string keys, EDT files, bindings and actions |
| Contract | `src/ui/screens/contracts.ts` maps each layout's controller to its contract; `layouts-contract.test.ts` loads every layout of every skin: schema, bindings and actions both ways (or `unsupported`), provenance, literals only in debug layouts, an explicit shadow on every text of a non-debug layout, a stub size on every asset, known fonts, cursors and string keys (table and index from `l10n.json`), and every asset, frame and EDT file on a built stub pack; with `JA2_DATA_DIR` every asset and frame on the original data and the PCX backgrounds at least as large as the boxes the code sizes by constants |
| Layout files | `data/layouts/original/message-box.json` (the six styles of `g_msg_box_style`, the text box art and their stub sizes) and `gallery.json` (a debug layout with every widget type on original art) |
| `/play` | `src/app/game/ui-boot.ts`: `HttpAssetSource` + `AssetCache` + `preloadAssets` behind `UiAssets` (`ImageCatalog`; STIs, fonts, PCX as opaque RGB565 through the cache), the 16 fonts and the 68 cursor files preloaded, `UiAudio` (the audio engine; samples resolved through `tables/sound-effects.json`), the text service (string tables and EDT fields), the layout loader; `GamePage.attach(runtime)`; `window.__ja2Ui` gains `widgets` (id, kind, rect, visible, enabled, state, text, frame), `cursor` and `sounds` |
| Gallery | `/src/devtools/ui-gallery/` (`?pinClock=1`, `?scale=`, `?skin=`): the gallery layout with its controller (`src/ui/screens/gallery.ts`), checked by hand on the original data (not captured) |
| Stubs | `stubs/ui/skin.ts`: for every asset of an `original` layout the pack lacks, an STI (or PCX) with the frames used at the declared sizes, bevelled and labelled `<file>#<frame>`, button states in distinct shades, sizes that two layouts declare checked for agreement; `stubs/ui/cursors.ts`: arrows, rings, I-beams and marks with a one-pixel outline for the 68 cursor files, `cur_wait` and `cur_targ` animated with four frames; both round-trip in `stubs/build.test.ts`; the `stubs` layer may import `ui` |
| Tests | Unit tests for every §3 rule (`src/ui/**/*.test.ts`, the stub fonts in CI and the original fonts with `JA2_DATA_DIR`); `tests/e2e/gallery.spec.ts` drives the gallery by widget id through `page.mouse` and the keyboard and compares `gallery.png` and `gallery-message-box.png` on stubs; the test pattern golden is unchanged |

Decisions and limits: the region list is re-evaluated every frame after a change (the original only on a mouse move or
`RefreshMouseRegions`), so a region that appears under a still pointer takes effect at once; the cursor is composed
every frame (a delayed cursor appears after its second even if nobody sets it again); fast help draws on the frame its
timer runs out (the original registers the background first and draws a frame later); shadow colours resolve through
the font of the text (the original through the font current at `SetFontShadow`); a fade multiplies by 0.8^k once instead
of k shade-table passes; the merc text box clamps its height at 199 instead of throwing; the frozen backdrop is the
screen's draw list, not pixels; the generic `genbutn` art is not built (labels draw their text only).

Open: the UI tables join the rule pack's `tables/**.json` family (the pack hash now includes `tables/ui-constants`,
`cursors.json` and `mlg.json`; U0c may exclude them); the message box calls `pauseGame`, which `/play` connects to the
session driver with U2; Scroll Lock → Pointer Lock and the Print Screen PNG (developer option) are not built; text
fields have no IME and no editor input types; later screens add their sources to `SCREEN_TABLES` of the
`ui-constants` transcriber and their layouts under `data/layouts/original/`.

#### U4: world renderer, first part (2026-10-19)

The renderer half of U4 that needs no new view field. Soldier frames still come from `SoldierView.frame`; the
animation schedule, corpses, clouds, tile changes, the view's ambient level and known mines are U4b (after U3a).

| Area | As built |
|---|---|
| Atlas | `src/render/array-atlas.ts`: one `TEXTURE_2D_ARRAY` of R8UI layers (4096², or `MAX_TEXTURE_SIZE`) per world, shelf-packed (`shelf-packer.ts`), the layer per sprite; it grows by re-creating the array and re-uploading the retained frames. Tiles and soldier sheets share it, and share one growable palette texture (`palette-rows.ts`), so the world never switches textures. `TextureAtlas` and `PaletteTexture` stay for the UI and the asset browser |
| Static scene | `static-scene.ts` builds the whole map once into eleven segments kept per row: land, objects, shadows, structs (with the wall strips), strict strips (non-wall multi-Z, `<`), roofs, on-roof, topmost (wireframes) and the obscured pass (dithered, dithered multi-Z, then the depth-writing half). Within a row the original's per-row interleaving of structs, roofs, on-roof and topmost is replaced by segments: every one of them writes depth, and z modulo 8 is the sublayer (structs 4, items 1, roofs 5, on-roof 6, topmost 7, wrapped values keep it), so two sprites of different segments never tie and the depth test gives the same picture in any order; ties inside a segment keep the sweep order, and the strict strips go last because a strict sprite loses every tie anyway. Positions are camera-free world pixels; the camera, the render height and the viewport are uniforms. Each frame draws, per segment, the instance range of the visible rows (the original's ±200 px sweep margins). Doors rebuild their rows, a revealed room the rows whose roof flags, show-through obstacles or wireframes change (`changedRevealTiles`), the tree-top, wireframe and roof-level options everything (A9: 16.6 ms for 43,039 sprites, 2.4 ms to assemble, a door row 0.1 ms) |
| Draw path | `world-program.ts`: sprites are pulled by `gl_VertexID` from an RGBA32F data texture (three texels per sprite) with plain `drawArrays(first × 6, count × 6)`, so a row range needs no base instance and no attribute re-pointing; one upload per change for the static stream, one per frame for the dynamic and item streams (persistent textures, no per-batch arrays). The shade comes from a 160×160 RG8UI texture (land and roof shade per tile) read in the vertex shader, or is fixed per sprite (soldiers, UI nodes). Instancing was dropped: SwiftShader (headless Chromium without a GPU, CI) pays per instance, and the instanced version drew A9 at 300 ms a frame there |
| Framebuffer | `world-framebuffer.ts`: colour and 24-bit depth at the logical size, cleared to depth 0, blitted with `NEAREST` at the integer scale (`present`) or read back (`capture`). The devtools pages render through it and drop `preserveDrawingBuffer` |
| Dynamic pass | `dynamic-scene.ts`, per frame over the tiles of the visible rows that hold dynamic content: the item pass (all pools, at most two items each, dithered `<=` then depth-writing `>`, the outline colour on index 254), then per row the original's three groups: dynamic objects, dynamic shadows, roof soldiers (STRUCT_MERCS), ground soldiers, dynamic structs; dynamic roofs, roof soldiers again (HIGHMERCS, as the original draws them twice), dynamic on-roof; topmost. A soldier is three sprites (shadow index 254 multiplied where `zbuf < z`, the body where `zbuf <= z`, the dithered body where `zbuf > z`) at the merc z, the on-roof z for `level > 0` (no longer skipped) or 32767 at the glow peak; on a tile whose last structure is a single-tile non-wall one (`MAPELEMENT_EXT_NOBURN_STRUCT`, `LevelRenderData.noBurn`) 2 nearer and without the dithered part. Consecutive sprites of the same depth state share a draw call |
| UI nodes | `WorldUiNode {gridNo, layer: object \| roof \| onRoof \| topmost, tile, head?, offsetX?, offsetY?, shade?}` merged into the dynamic pass of its layer and tile, before (head) or after the map's dynamic nodes, with the layer's z (`OBJECTLAYER_USEZHEIGHT` objects at `8·wy`, topmost 32767) and shade 4 by default. Animated tiles (map and UI) show `animationFrames[⌊clock / 200 ms⌋ mod n]` |
| Camera | `camera.ts`: `ApplyScrolling` with the tile-centre snap, the scroll rectangle of restriction 0 and 1, the per-axis scroll steps and the forced recentre (`setRenderCenter`); the devtools pages pan through it |
| Picking | `picking.ts`: the soldier whose drawn frame has an opaque, non-shadow pixel under the pointer, topmost (glowing) sprites first, then the last drawn; next to the tile picking of `screenToGridNo` |
| Lighting | `src/app/world/world-lighting.ts` runs the simulation's lighting (`initLighting`, `lightSpriteRenderAll`, the sprite API) over the client's own `TacticalWorld` and the view's clock: the ambient from the dawn and dusk schedule the simulation queues (`buildDayLightLevels`), the map's light sprites powered for the hour, every door as a perceived door state, open when the view lists it in `openDoors`. The shade of a tile is `natural − strongest light` (`LightAddTileNode`'s `ubMaxLights`, not the gameplay sum): each powered sprite is drawn alone and its template light taken on the tiles it reached. Map lights are cached per (hour, ambient, doors), merc lights added per frame. Tiles and soldier shade rows use the map's light colour |
| Soldiers | `src/app/world/soldier-scene.ts`: the sheet and frame as before, palette rows per soldier palette (16 shades, 20 red glow, 20 orange roof glow, `soldier-palettes.ts`), the node shade (own mercs personally lit at shade 3 unless "merc casts light" at night, others the land or roof shade of their tile, then `max(shade − 2, 4)`), the glow (`glow.ts`: 30 frames of 100 ms, hostiles on our turn or under AI control, topmost at frame ≥ 7, grey offset 10 when `selectedSees(id)` returns false, the hovered hostile glowing and the unseen others in the mono effect shade), and the fades (`soldier-fade.ts`: a newcomer of another team from shade 12 down, a soldier who left the view up to 12 at his last tile, 60 ms a step) |
| Fog of war | `reveal.ts` turns the view's `revealedRooms` into the original's node flags (`SetGridNoRevealedFlag`: `FIRSTROOF…FOURTHROOF` hidden, A-frame walls on the tile and its south and east neighbours hidden, obstacles shown through, slanted roofs hidden and shown through) and the wireframes of `CalculateWorldWireFrameTiles` (doors, windows, walls, corners, the optional flag for revealed neighbours). Hidden roofs reappear at the roof interface level. Options: tree tops (FULL3D trees drawn as their trunk frame), wireframes, roofs, item glow (static white or yellow outline when off), merc casts light ("Show Lights under Mercs": own mercs carry their light at night, otherwise they are personally lit), merc always lit ("Merc Lights during Movement": the light follows a walking merc instead of waiting until he stops) |
| Items | the view's `items` with the `tileGraphic` of `externalized/{items,weapons,magazines,armours,explosives}.json` (`item-tiles.ts`), on the ground at `8·wy + 1` or on roofs at the on-roof z, outlined with the 20-step white (red, yellow on roofs) cycle |
| Hooks | `__ja2Tactical` gains `drawCalls`, `stats`, `camera`, `hoveredSoldier`, `renderMs`, `soldierBoxes`, `items`, `soldierTeams` and `command`; `__ja2MapViewer` gains `drawCalls`, `stats` and `camera` |

**Measured** on A9 with original data, devtools tactical page, 1920×1080 canvas, UI scale 2 (logical 960×540),
the sandbox squad of six in view, headless Chromium on this machine (no GPU: ANGLE on SwiftShader), the base commit
`9867f03` and this slice served side by side and measured back to back:

| | before | after |
|---|---|---|
| Draw calls per frame | 436 | 26 (two more with items on the ground, three per further soldier) |
| JS per frame, whole page (p50 / p95) | 4.9–5.0 / 9.2–9.3 ms | 0.5 / 0.7 ms |
| World render call (p50 / p95) | — | 0.3 / 0.5 ms |
| Frame interval on SwiftShader (p50 / p95) | 133–150 / 150–167 ms | 33 / 50 ms |

In Node on A9: the dynamic pass with 16 soldiers 0.07 ms, the lighting field at night 0.3 ms, a room reveal
(`computeReveal`) 1 ms plus the patched rows. A real GPU was not available; the frame time target of §16 still has to
be confirmed on the maintainer's machine.

Open for U4b: soldier frames from the animation schedule (U3a); corpses, smoke and gas clouds, dynamic lights
(explosions, muzzle flashes, flares), tile changes (destroyed structures, window states, the O3 statue, the
helicopter), added exit grids and known mines from the view (G8); the view's ambient level instead of the client's
clock schedule (hot desert days); `sees` and `hostile` feeding `selectedSees` and `hostile` (U3a), the AI baton holder
for `underAiControl`; `bRenderZHeightAboveLevel` of items on tables; multi-tile soldiers (vehicles); the cover and line-of-sight tiles (`LEVELNODE_REVEAL` translucency); the
world in the `/play` page's logical framebuffer (U5).

#### U3a: server view, events and protocol for the HUD (2026-10-19)

The server half of U3 (§12): what the HUD reads, without the knowledge projection, the hint functions and the query
channel (U3b). The details and the field lists are in `04` §6.25 and the MCP descriptions.

| Area | As built |
|---|---|
| View fields | G1–G5: own soldiers carry `profile`, `bleeding`, `breathMax`, `morale` (also in the sandbox), `stats`, `armour`, `weight`, `camo` (the original's formulas), `asleep`, `squad`, `vehicle`, `stealth`, `weaponMode`, `muted`, `sees`, `canAct` (the face hatch rule), `continueTo`, `firstAid`, `blinded`; others `hostile` and `healthIndex`. G6: `combat.uiLocked`, `combat.topMessage` and `combat.ai`, from a top message and a progress bar kept in the turn state at the original's `AddTopMessage`, `InitEnemyUIBar` and `UpdateEnemyUIBar` sites (`src/sim/tactical/turns/top-message.ts`). G7: `jammed`, `imprint`, ground `money` and `attachments`. G14 base: conversation `chars` and `faceVariant`, `textKey`/`chars` on merc, head miner and Skyrider quotes, the speaker's sector on merc quotes |
| Animation schedule | Soldier entries carry `frameSlot`, `stateTick` (set where `EVENT_InitNewSoldierAnim` changes the state) and `frameDelay`; `frame` stays for the devtools and U4 until U4b. Snapshot version 4 adds `stateTick`, `muted`, the top message and the progress bar |
| Events | `lifeLost`, `aiTurn`, `enemyTurnProgress`, `itemsRevealed`, `enemySighted.enemies`, `interrupt.selected`, `groupArrived`, `invasion`, `sectorControlChanged.kind`/`dailyIncome`, `sectorLoaded.loadScreen` |
| Message entries | `src/server/message-entries.ts` turns events (and refusals the original logs) into message list entries; the session keeps a 256-entry ring in its presentation block (saved as `presentation.messages`), sends it in `welcome`, new entries in frames and in every `advance` report |
| Refusal tokens | `data.refusal` on `move`, `turn`, `stance`, `attack`, `climb`, `pickUp`, `drop`, `useRemote`, `route`, `assignSquad`, `sleep`, `wake`, `compressTime`, `enterSector` (`assign` names its first per-soldier failure); `refusal.<token>` text keys and `REFUSAL_MESSAGES` map them to the original's strings |
| Protocol | `drive realtime {pauseOn}`, `closeSession` (WebSocket) and `DELETE /api/sessions/:id` (the Dead is Dead save point), `campaign.deadIsDeadDescription`; `SessionClient.closeSession()` |
| Endpoints | `GET /api/sessions/:id/profiles` (`src/content/narrative/profile-presentation.ts`) and `GET /api/items?lang=` (`src/server/item-catalogue.ts`); `ItemDef` parses the item graphics; the face index is the profile id as `LoadMercProfiles` sets it; I.M.P. characters take their portrait's face |
| Rule findings | 1: the brothel time warp at the action (and after the action item). 2: the loading-screen draw at every sector entry (`src/sim/strategic/map/loading-screen.ts`, `src/content/strategic/loading-screens.ts`). 4: `aimLeaveMessage` refuses `alreadyLeft`. 6: the developer panel names the Bobby Ray speeds right (`protocol/bobby-ray.ts`). 7: hidden AI interrupts stay hidden in `combat` and in the refusals |

Tests: `src/sim/tactical/hud-view.test.ts` (own and other fields, the top message through an enemy turn, a hidden
interrupt and an interrupt in our favour, `lifeLost`), `src/sim/strategic/map/loading-screen.test.ts`,
`src/sim/strategic/economy/sector-loss.test.ts`, `src/sim/narrative/face-variant.test.ts`, the warp in
`npc-actions/catalog.test.ts`, `src/server/message-entries.test.ts`, the session tests of `pauseOn` and the message ring,
`src/server/session-close-api.test.ts` (HTTP and WebSocket close, the Dead is Dead name and save point, the ring through
a save and a load), `src/server/hud-campaign-stub.test.ts` (arrival, loading screen, refusal tokens, bark text in a stub
campaign, also in the reload mode), `src/server/catalogue-api.test.ts`, `catalogue-original.test.ts` (original data) and
`protocol/bobby-ray.test.ts`. The text test checks every `refusal.*` key in every language.

Decisions and limits: rule findings 1 and 2 port a single call each (`WarpGameTime` at the end of `SexScreenHandle`,
`GetLoadScreenID` in `BeginLoadScreen`) and were checked against the source rather than an oracle probe, since a probe
needs a rebuild of the shared oracle; the ring holds entries, not wrapped lines; `combat.team` now names the team the
player believes acts (our team during a hidden interrupt); closing the default session is refused; a stub sandbox has no
profiles. Open: `sectorControlChanged` is still not emitted for an uncontested takeover by the Queen (deviation "Lost
sector notices without a battle"); refusals finer than the original's menus (`noMedKit`, `noToolKit`,
`noMilitiaAllowed`) stay folded into `notEligible`/`noMilitiaHere`.

#### U2: front-end screens (2026-10-19)

§4 on the canvas: `/play` opens on the main menu, a stub new game reaches a laptop placeholder with nobody hired, and a
save made through the canvas save screen loads again from the main menu. The help screens wait for U13.

| Area | As built |
|---|---|
| Moved into `ui` | The launcher's DOM-free modules: `src/ui/text/labels.ts` and `string-ids.ts` (`fetchLabels` stays in `src/app/launcher/labels.ts`), `src/ui/saves/save-rows.ts`, `src/ui/client/campaign-form.ts`, the REST types `src/ui/client/api-types.ts` (`src/app/launcher/api.ts` keeps the fetch calls), the client settings model `src/ui/settings.ts` (`src/app/settings.ts` keeps the `localStorage` wrapper) and the credits roll `src/ui/screens/credit-roll.ts`. The settings gain `bloodAndGore` (default on, edited on the options screen, sent by the game init screen) and `helpScreensSeen` (the per-campaign help mask, kept for U13); `speechOrSubtitlesKept` moved next to them |
| Tables | `ui-constants` gains `GameSettings` (TOPTION order, `NUM_GAME_OPTIONS`, the difficulty and save modes), `Credits`, `Loading_Screen` (the `LOADINGSCREEN_*` ids), `JAScreens` (`SMILY_*`), `Fade_Screen` and `Sound_Control` (with `SoundMan.h`: `MAXVOLUME`, `BTNVOLUME`); `tools/transcribe/load-screens.ts` → `data/tables/load-screens.json` (the hard-coded loading screens by id; the externalized ones follow from index 27), checked against its regeneration in `tables.test.ts` |
| Layout format | Per-widget `within` (another frame for one widget), `centerX: "screen"` (the main menu buttons, centred on the logical screen while their y is in std640), choices `{by, map}` for numbers, palette colours, image frames and image assets (a row's state picks its colours, a mode picks a title frame, a picture id picks the loading screen), the `$screenWidth`/`$screenHeight` expression variables, `press` (left down and repeat) and `doubleClick` actions, wheel actions on buttons, regions sized by a text (`fit`: the options labels), clipped images (`clip`: the 605-pixel rows clipped to 575), centred images (`center`: the San Mona smile), text field schemes (the save description) with the field removed when its repeat shrinks, and `start` for repeats (the options' second column). `references.ts` collects the new bindings, actions and assets |
| Layouts | `data/layouts/original/`: `main-menu`, `game-init`, `options`, `save-load`, `credits`, `loading` (the 43 pictures by id, the red sector bar and the blue save bar), `exit-box` (the laptop, map and game variants of `HandleShortCutExitState`), `san-mona`, and the debug layout `placeholder` (the laptop, map and tactical screens that U5–U10 replace). Constants by name, MLG ids for `MLG_TITLETEXT`, `MLG_OPTIONHEADER`, `MLG_LOADSAVEHEADER`; the buttons of the options and save/load screens come from the plain `interface/*addons.sti` as in Stracciatella |
| Controllers | `src/ui/screens/front-end/`: `main-menu.ts` (Load grayed without saves; Alt+click Load and Alt+C load the newest save without the warning box, as `gfLoadGameUponEntry` does), `game-init.ts` (the four radio groups, the Iron Man and Dead is Dead warnings with No resetting the save mode, the difficulty box, the Dead is Dead OK box and the save screen naming the slot), `options.ts` (the 23 toggles mapped to `ClientSettings` in `OPTION_TOGGLES`, blood and gore through `setOption` in a session, the speech/subtitles box, the label highlight, BIG_SWITCH3 on label clicks, the effects and speech test samples 75 ms after the slider stops, Save enabled only in a game that can save and not in Dead is Dead, Main Menu asking then closing the session, the settings written on every exit), `save-load.ts` (Stracciatella's list: newest first, quick and auto saves hidden to save, the new row first; select, double click, right click, wheel, the scroll buttons, Up/Down, Enter, Delete, Escape; the description field; the scroll bar as a custom renderer of fills and lines), `credits.ts` (the roll with bitmap fonts, the 15 eyes blinking from the original's frequencies, all of them at once on entry because of the unsigned clock difference, the hovered face's name, title and joke), `loading.ts`, `exit-box.ts`, `san-mona.ts`, `placeholder.ts`; `flow.ts` (`FrontEndFlow`) moves between them like the original's exit screens (save/load returns to the screen that opened it, a save from the options returns to the game, fades around a load and the new game, `MAIN_MENU` music, music off for the new game) |
| Saves and boxes | `src/ui/saves/save-controller.ts`: save new, save over after `SLG_CONFIRM_SAVE`, one warning box then load in place or into a new session (native saves import), delete after `SLG_CONFIRM_DELETE`, the refusal texts; the launcher's save panel and the canvas screen both use it over a `SaveApi`. `src/ui/message-boxes.ts`: the `MessageBoxes` interface (`confirm`, `alert`, `ask` with OK, YES/NO, OK/SKIP, YES/NO/LIE, CONTINUE/STOP and numbered buttons) and `CanvasMessageBoxes` over U1's message box; the launcher's DOM box implements it |
| Client | `src/ui/client/front-end-client.ts` (`FrontEndClient`, the screens' view of the server) and `src/app/game/front-end-client.ts` (`HttpFrontEndClient`: REST for saves, sessions and status, the session socket for an in-place load and `setOption`; `newCampaign` sends the game init options with `hire: []`) |
| Time while modal | `src/app/game/modal-pause.ts`: U1's `pauseGame` hook counts nested modals; the outermost one switches a running real-time driver to manual through `SessionClient.drive` and the last one restores it (only on the same session and only if the driver is still manual). Message boxes, the exit box and the options and save/load screens opened in a game call it |
| `/play` | `main.ts` boots the front end (`?screen=testPattern` keeps the U0a test screen, `?session=` opens the in-game placeholder of a running session); `front-end.ts` loads the layouts, preloads their assets (of the loading pictures only the default), builds the environment, the music (`FrontEndMusicPlayer`: `mainMenu` without a session, nothing for the new game, the session's music in a game), the beginning videos through the existing `beginningPlan` player, the credit rows and the cosmetic random; `settings-store.ts` applies volume changes to the audio engine and the music at once. The hook gains `music` and `video`. The launcher's header links to `/play` |
| Stub art | The layout-driven generator writes every new asset (the menu backgrounds and buttons, the check boxes, the save rows, the credit faces as 45 labelled 30×12 eye frames, the smile); single-frame pictures of at least 320×240 (the five 640×480 backgrounds and the 43 loading screens) share one unlabelled stub per size and state through the stub pack's aliases, so the pack grows by about 0.6 MB. The test pattern golden changed because the stub pack now has `loadscreens/ja2logo.sti` |
| Tests | `front-end.test.ts` (each screen and the flow against a fake client and host on stub art and the English strings), `draw-lists.test.ts` (file snapshots of the draw lists of seven screens), `save-controller.test.ts`, `modal-pause.test.ts`, the contract test over the new layouts on stubs and on the original data, `tests/e2e/front-end.spec.ts` (goldens of the main menu, game init, options, save/load and credits screens with the saves and the engine identity routed; a new game to the laptop placeholder with nobody hired, a save and an in-place load through the canvas screens and Alt+X back to the menu; options kept across a reload; credits ended on Escape; a load from the main menu into a new session is covered by the unit tests, as the e2e suite already uses all 16 sessions the server allows) |

Display toggles that take effect: speech and mute confirmations (the battle sounds of the tactical page), sleep/wake
notification (the sleep/wake stop), blood and gore (the campaign option), tree tops, wireframes, item glow, merc
casts light and merc always lit (the world renderer; the tactical page starts from them, `src/app/world/display-options.ts`).
Inert until their consumer exists: subtitles and key-advance speech (U7), animate smoke (U4b), metric system (U5),
old selection method, always show movement path, show misses, real-time confirmation, smart cursor, snap cursor to
door, 3D cursor, hide bullets and tracking mode (U6); don't move mouse stays inert (deviation "Pointer warp").

Decisions and limits: Enter on the game init screen acts on its release (deviation "Game init Enter"); the save row's
location stays the sector code (deviation "Save list in the launcher and on the canvas"); the loading screen of a save
load shows `LOADINGSCREEN_NOTHING` (`ls_heli.sti`) until a picture id arrives; a loading screen picture other than the
default loads when it is first shown; the in-game screens are placeholders with the in-game keys (o, Ctrl+S, Ctrl+L,
Alt+X); `/play` plays no splash and has no "connection lost" panel yet.

Wired after U3a (2026-10-19): `HttpFrontEndClient.closeSession` sends the session's `closeSession` (the Dead is Dead
save point) before leaving it; a new Dead is Dead game sends the typed description (`campaign.deadIsDeadDescription`,
`campaignRequest`) unless the player chose an existing row, so the server derives the save name; the front-end e2e
spec's `DELETE /api/sessions/:id` frees its session, so the suite stays under the server's 16-session cap. Still open:
the sector-entry event's picture id goes into `LoadingController` when the map and tactical screens exist (U5, U8);
`sexScene` already opens the San Mona screen, the time warp is the server's.

#### U3b: cursor hints on the client (2026-10-19)

The hint half of U3 (§2.4): the player-knowledge projection, every hint kind as a pure function of it, the query
channel, the client's local provider with the fallback and the shadow mode. The protocol and the kinds are in `04`
§6.26, the hidden-state decisions in `deviations.md` §6.

| Area | As built |
|---|---|
| Projection | `src/sim/knowledge/`: `knowledgeWorld(view, rules, {strict})` over a structural `KnowledgeView` (sim may not import protocol; `PlayerView` is assignable to it). Tactical: `TacticalProjection` keeps a fresh world copy per map (two maps cached) and syncs it per view: doors swapped to `openDoors` with the perceived lock and trap of `doors`, ground items, the light, soldiers rebuilt with their person structures (own in full from the view and the `hint` inputs, others with their visible fields and appearance stand-ins), the narrative port answering only `isEpc` and the robot control from the view, the boxing state. Strategic (`strategic.ts`, `strategic-state.ts`, `strategic-crew.ts`): a strategic state and an economy context built from the strategic view and `loadStrategicRules(read, items, mapExists)`. Strict mode wraps every projected object in a guard (`guard.ts`) whose unsupplied fields throw `UnsuppliedFieldError`; `withTemporaryFields` and `preservingFields` keep hints from leaving writes behind |
| Hints | `src/sim/hints/`, dispatched by `answerHint`: `previewMove` (with the `PlotPath` port `src/sim/tactical/plot-path.ts`: the costing `routeCost` now shares, the footstep bands, `gusAPtsToMove`), `estimateAttack` (moved off `TacticalSim`, extended), `previewAction` (door, pickUp, talk, give, jump, swap, look, aid; the other `MOVEUI_TARGET_*` kinds `notSupported`), `placements`, `itemInfo`, `exitSector` dry run, `exitSectorOptions`, `canEnterSector`, `assignmentOptions`, `previewRoute`, `previewHeliRoute`. New simulation ports they share with later commands: `jump-over.ts` (`IsValidJumpLocation`, `GetAPsToJumpOver`), `quick-exchange.ts` (`ValidQuickExchangePosition`, `CanExchangePlaces`), `narrative/talk-reach.ts` (talk range, sight and walk-up; the talk command uses it), `item-description.ts` (the box's numbers, thresholds and pros and cons), `item-compatibility.ts` (`ReevaluateItemHatches`, the compatible outline), `strategic/map/plotting.ts` (the plotting ETA, the helicopter distance and safe and unsafe counts) |
| View fields | Own soldiers: `hint` (skill traits, personality, shock, last target, tiles moved, carried weight at the turn start, collapsed, gassed, under AI control). `light {ambient, sprites}` (the powered light sprites; G8's light for U4b). `ItemView.zHeight`. Strategic: merc `profile`, `stats`, `inventory`, `weight` (G10), group and vehicle `nextArrivalMinutes` (G13), vehicle `type`, `group`, `usable`, `next`, `enemyAirspace` (G11), `towns {town, loyalty}` (G12): the minimum the strategic hints read, shown by the original's info panel, inventory panel, airspace filter and town box; U8 completes G10–G13 |
| Server | `src/server/query.ts`: `QueryService` per session (fresh world inputs for the projection, rules per content), `isQueryCommand`; `Session.query`, `SessionHost.query` (in process: between ticks, outside the queue; worker: forwarded); WebSocket `query`/`answer` outside the ordered replies; query commands arriving through `act` or `cmd` take the same path. `SessionSim.tacticalContent()` and `strategicRules()` |
| Client | `src/app/hints/`: `ClientKnowledge` (U0b's client rules, the engine identity Vite injects, the content and per-map worlds), `HintProvider` (rest 80 ms per kind, cache per view, one projection per view, fallback, shadow mode, statistics), `createHintHook`/`attachHintHook` (`window.__ja2Ui.hints`); `SessionClient.query` and `identity`; `GameClient` in `src/ui/game-client.ts`. The devtools tactical page shows the hints of the hovered tile, enemy and inventory slot (`hint-panel.ts`); `?shadowHints=1` turns the shadow mode on. The `/play` page wires the provider with U5/U6 |
| Tests | Client against server over sampled points, the client projection strict and built from the serialised view, with the snapshot purity check (`tests/support/hints.ts`, `hints-actions.ts`, `hints-strategic.ts`): `src/server/hints-stub.test.ts`, `hints-actions-stub.test.ts`, `hints-strategic-stub.test.ts` and the original-data `hints-original.test.ts`, `hints-actions-original.test.ts`, `hints-strategic-original.test.ts` (A9 sandbox and battle, a new campaign, SaveGame01/02/07/10). Fairness: `hints-fairness.test.ts` and the actions suite (unseen enemies on the target and the path change no answer). Purity of every server-only query: `query-purity.test.ts`. The channel: `ws.test.ts`, the host contract (answered before a running advance ends, unlogged, equal in both hosts), `messages.test.ts`. The client: `hint-provider.test.ts`, `client-knowledge.test.ts`. Unit tests of the new ports and `preview-action.test.ts`. E2E: `tests/e2e/hints.spec.ts` (a battle session with the shadow mode: tiles, soldiers and slots hovered, no difference). The simulation tests that used `estimateAttack` call it on the projection (`tests/support/combat.ts`) |

**Measured** (headless Chromium on this machine while other agents ran test suites, load average 10–19; devtools
tactical page; the hint's own time, the projection build counted apart):

| Data | Hints | p50 | p95 | max | Projection build (first, with the world copy) |
|---|---|---|---|---|---|
| Stubs, village battle (e2e, shadow mode) | 31 | 0.2–0.3 ms | 2.8–3.2 ms | 4.9–7.2 ms | 98–130 ms |
| Original data, A9 in real time | 126 | 0.2 ms | 1.3 ms | 10.7 ms | 65 ms |
| Original data, A9 battle (moves and attack estimates) | 124 | 0.2 ms | 2.1 ms | 21.6 ms | 99 ms |

In Node on A9 (the same load): the projection sync for a new view 0.45 ms p50, 1.7 ms p95; `previewMove` 0.18 ms p50,
1.15 ms p95. The tail is the path search to an unreachable tile, which explores the whole map as the original does.
The §16 target (2 ms p95) holds on A9 in real time and is at the limit in battle and on the stub map on a loaded
machine; it has to be confirmed on the maintainer's machine without other load.

Decisions and limits: the projection is built once per received view on the client (about 0.5 ms, p95 under 2 ms on
A9 in Node) and per query on the server; its first build for a map includes the world copy (about 0.1 s on A9) and is
warmed when the map is loaded. The melee chance to hit is `null` (hidden defender ratings). The plotting ETA keeps the
original's double count of the remaining leg and the dropped first temporary edge (`MapScreen.cc:939-1045`, decision
11). `hireCheck` and `impCheckCode` are routed as server queries but not answered by the simulation yet (U10/U11).
The shadow mode is a URL flag, not a client setting. Open: map changes, added exit grids and corpses are not in the
view (G8, U4b), so the projection's world lacks destroyed structures until U4b adds them; stat damage for stat healing
(`enable_stat_healing`) is not in the view; the exit dry run cannot know mercs already walking off; the client loads the
tactical content without the stub profiles a stub campaign adds (`withStubProfiles`), which no hint reads today.

#### U4b: world renderer, second part (2026-10-19)

The rest of U4 on top of U3a's view: the animation schedule, the world state of G8, the glow and the merc lights, in
the devtools tactical page (the `/play` page gets the world with U5).

| Area | As built |
|---|---|
| Animation schedule | `src/content/anim/schedule-track.ts` and `src/app/world/soldier-frames.ts`. `loadSoldierFrames` reads the client's own `ja2bin.dat` through the asset reader and compares its hash with `welcome.rules.scripts` (`SessionClient.rules`, new). Equal scripts (always on scenario 2): the sprite frame is the presentation frame of the view's `frameSlot`, the same frame as `frame`. Different scripts (`?scripts=stub` forces the stub scripts on the page): per state the client walks its own script into a track (frames, the frames shown with opcode 430, a loop or an end) and plays it from `stateTick` at `frameDelay`, warped piecewise between the state start and the ticks of `shotFired`/`meleeStrike` (taken from received frames through `SessionClient.onReceive`, so playback behind the latest tick interpolates), holding the frame before an unconfirmed marker. `SoldierView.frame` stays: the sound director (`src/audio/director.ts`) still walks the scripts from `frame`, and agents see it; it can go once the director follows `frameSlot` |
| World view (G8) | `src/sim/tactical/world-view.ts`, `04` §6.27: `corpses` (with the soldier's palettes and the camouflage flag, now kept on corpse records), `smoke` (effect per tile and the dissipating graphic, bit 0x40 of the smoke tile flags), `light {ambient, sprites}` (explosion and muzzle-flash sprites), `tileChanges` (the sector's structure map changes as tile removals and additions; a bullet's window hit is now recorded like an explosion's), ground items' `height` and `notRendered` |
| Corpses and smoke | `src/app/world/world-effects.ts` loads `tables/corpses.json`, `smoke-effects.json`, the corpse and smoke graphics, `anims/camo.col` and the monster COL palettes on demand (stub art under `stubs/` on stubs). A corpse is drawn at the start frame of its direction block (four blocks for the fall types, vehicles loop at 150 ms), with `CreateCorpsePalette`'s palette (the graphic's own at `ROTTING_STAGE2`, camo, the monster COLs, the own palette of animals and vehicles, else the soldier's replacements) in 16 shaded rows, its z strips from the corpse structure, its shadow pixels and the tile's shade. Smoke tiles cycle their 12 frames from a per-tile start frame and delay, translucent; with "animate smoke" off the static graphic opaque. `src/render/world/dynamic-scene.ts` emits both in the structure (or on-roof) layer of the dynamic pass at the original's z (`05`) |
| Tile changes | `src/render/world/tile-changes.ts` applies the view's `tileChanges` to the map's struct and on-roof layers (a removal followed by an addition on the same tile keeps the node's place, as a partner swap does); the renderer then updates the level render data of the touched tiles (`updateLevelRenderData`: no-burn flags and shadow lists), recomputes the reveal state and rebuilds only the static rows of the touched tiles and of changed reveal flags, keeping the dynamic map nodes unless a dynamic tile changed (A9 in Node on a loaded machine: 7–12 ms per change of the list, against 55–130 ms for a full rebuild). Windows show cracked and shattered, wrecked structures disappear, the O3 statue opens |
| Lighting | `WorldLighting.field` takes the view's ambient level and the dynamic sprites, drawn like the merc lights with the strongest-light rule. `src/app/world/light-templates.ts` resolves templates from the user's data (`externalized/light-templates.json` or loose `.LHT` files whose winning layer is not a repository layer, `src/content/formats/lht.ts`), then the generated ones, then the stand-ins `L-R06`/`L-R07`/`L-R08` for `Light2`/`Light3`/`Light4`; the merc light follows the head slots (UV goggles, night goggles) of the view's inventory |
| Glow | `src/app/world/glow-context.ts`: hostility from the view's `hostile`, grey when the selected merc's `sees` lacks the soldier (not while on fire or exploding), the AI baton holder from `aiTurn` events (`AiTurnHolder`, released at a turn start, an interrupt or the end of combat) |
| Multi-tile soldiers | `SoldierAssets` loads the animation structures; a soldier whose structure for the state and direction spans several tiles (prone mercs, vehicles, the tank, large creatures) is drawn in the struct-merc pass at the z of its structure's z offset (vehicles at the structure z), in the z strips of the first frame of its direction block |
| Items | Items lying on a structure are raised by their height at the structure z plus the height; items inside an open container are not drawn |
| Stub art | `stubs/effects.ts`: a lying body in eight directions for every corpse graphic and twelve-frame puffs for every smoke graphic |
| Hooks | `__ja2Tactical` gains `framePolicy`, `mercLightOrigin`, `lightTemplatesFromData`, `corpses`, `smokeTiles`, `tileChanges`, `ambient`, `dynamicLights`, `aiTurn`, `drawnEffects`, `soldierGridNos` and `centerOn` |

**Measured** with original data on the devtools tactical page, 1920×1080, UI scale 2, headless Chromium on SwiftShader,
the base commit `09ce2de` and this slice served side by side and measured alternately (the machine was shared with
other agents, so the frame intervals are noisy):

| | base | U4b |
|---|---|---|
| A9 sandbox, six mercs: draw calls | 26 | 26 |
| A9: world render call p50 / p95 | 0.3 / 0.5–0.6 ms | 0.4 / 0.6–0.8 ms |
| A9: frame interval p50 / p95 | 50–83 / 83–117 ms | 33–67 / 83–100 ms |
| D13 at night (SaveGame07), four corpses in view: draw calls | 15 | 23 |
| D13: world render call p50 / p95 | 0.3–0.4 / 0.8–1.6 ms | 0.4–0.5 / 1.1–2.4 ms |
| D13: frame interval p50 / p95 | 33–50 / 67–83 ms | 33 / 50–83 ms |

The original data has no smoke source in reach of the page (no smoke grenade in the sandbox kits, smoke records of
native saves are not imported), so a smoke cloud was measured in Node on A9: 81 smoke tiles and 10 corpses add 161
sprites in 21 draw runs (smoke merges into one run, a corpse costs two) and 0.09 / 0.18 ms (p50 / p95) to the
dynamic pass.

Tests: `src/app/world/soldier-frames.test.ts` (the track walk, exact frames, stretch, squeeze, loops; with
`JA2_DATA_DIR` the stub scripts hit their fire marker at the tick of a shot on the original rules, the original scripts
at the tick of a shot on the stub rules, and the same scripts give `frame` on every tick), `world-view.test.ts`,
`world-effects.test.ts` (on the stub pack: a corpse at its direction's start frame, smoke with the dissipating graphic,
the static graphic when smoke is not animated), `world-lighting.test.ts` (the local update of the level render data
equals a full preparation), `light-templates.test.ts` (with `JA2_DATA_DIR`: the Gold data has the map templates, equal to
the generated ones, and no `Light` templates), `glow-context.test.ts`, `dynamic-scene.test.ts` (corpse, vehicle, roof
and smoke z, multi-tile strips, raised items), `tile-changes.test.ts`, `tests/e2e/battle.spec.ts` (on stubs, after
the MCP agent's fight: the tactical page on that session follows the schedule exactly, lights the mercs with the
stand-in, takes the view's ambient and draws every corpse the server reports).

Decisions and limits: the warp anchors only the state start and opcode 430 (other gameplay opcodes carry no event
with a tick); the scripts' hash `unknown` counts as equal; `Light0` … `Light6` are read from the user's data only,
never from the copy of Stracciatella's `light-templates.json` that `data/externalized/` has carried since M2 (whether
that copy may be used is the maintainer's call, `20` §2); corpses follow the tile's shade every frame; translucency is
a 50 % alpha blend. Open: explosion, ripple and miss animations are not in the view (their light is); known mines and
bombs have nothing to show yet, since the simulation neither detects nor plants mines (no blue flags, deviations "Map
items" and "Duds and timed bombs"); the helicopter's pieces need the simulation to add them (deviation "Helicopter on
the map"); added exit grids matter to the cursor, not the picture; the client's lighting casts light through the
map's original structures, so a wall destroyed by a grenade does not let a lamp's light through on the client; the
cover and line-of-sight tiles; the world in the `/play` page (U5).


#### Light templates (2026-10-19)

By the maintainer's decision the simulation and the renderer use `Light0` … `Light6` from Stracciatella's
`light-templates.json` (in the repository since M2): flares and break lights now light their tiles and merc lights use
`Light2`/`Light3`/`Light4` as in Stracciatella (`TacticalContent.lightTemplates`, `src/app/world/light-templates.ts`,
`docs/20` §2); the deviations "Light effects" and "Merc lights" are closed.

#### U10: laptop, part one (2026-10-19)

§9.1, §9.3 (Email, Finances) and §9.4 as `LaptopScreen` (`src/ui/screens/laptop/`), one layout and controller per page,
and the server gaps they need.

| Area | As built |
|---|---|
| Tables | `ui-constants` gains the shared `Laptop` and `AIM` tables and the `EMail`, `Finances`, `AIMMembers`, `AIMSort`, `AIMFacialIndex`, `AIMLinks` screen tables; `tools/transcribe/c-constants.ts` strips comments with an ordered scanner (a `//***` line opened a block comment and hid every `AIM.cc` define) |
| Widgets | Layout types `tiles` (a tiled background), `portrait` (`src/ui/widgets/portrait.ts`: a face by index and size, dead faces shaded, unavailable ones under `ShadowRect`) and `itemPicture` (`item-picture.ts`: the inventory graphic centred in a cell, optional shadow); stub frames may be `hollow` |
| Shell (`laptop-shell.ts`, `laptop-timers.ts`, `laptop-modes.ts`) | Modes, the program queue (`FindLastProgramStillOpen`), minimize, `EnterNewLaptopMode` (maximize first, the web mode, bookmarks on the first browser use), `GoToWebPage` (the broken link while M.E.R.C. is down, the fast revisit), the sub-site waits (none between the A.I.M. members and the mug shots), the World Wide Wait (`DisplayLoadPending` units scaled by the client setting `websiteLoadingTimeScale`, 0 = off), the 2 s bookmark hint, the HD flicker from the client PRNG, the power light and the 100 ms exit, the title-bar slide in 18 steps of 16 ms, the 1 s opening and closing zoom (`capture`/`snapshot`), Esc (bookmarks, the page's popup, then exit), right click, Tab/Shift+Tab, Alt+X and `h` (hooks), the new-mail box (held during a conference), the taskbar mail icon opening the oldest unread mail; message boxes `LAPTOP_DEFAULT` centred on the monitor |
| Email (`email/`) | The list with the original's insertion sort per column on the client (arrival order underneath: deviation), 18 rows a page, the read view paged by `IanWrappedStringHeight` (the original's page count over the whole record list, so "1 / 2" for a two-page mail), previous/next, delete with the right-click question; `readEmail`, `deleteEmail`, `emailText` |
| Finances (`finances/`) | The summary (page 0) and the ledger from page 1, 17 rows a page, colours and `SPrintMoney` variants as `Finances.cc`, the transaction text in the balance's colour, first/previous/next/last |
| A.I.M. (`aim/`) | Home with the ad rotation (`AimAds`: warning box, the ad of the day, Bobby Ray's duck passes, the flower texts), sort (criteria and direction, stable on ties), mug shots (5×8, dead/hired/away overlays), member file (stats, salary, deposit, kit pictures, bio row, previous/next), the video conference (`Conference`: title bar, black and snow, first contact, answering machine, unavailable, contract length and kit, HIRE through `hireCheck`, TRANSFER FUNDS through `aimHire`, the popups, the hang-up after the merc stops talking; a still face with speech and subtitles timed `max(1500, 80 × characters)`), links, the "just hired" box with the arrival time (`pMessageStrings[66]`, the German order) |
| Server gaps | X1 `visitSite`, X2 `newMail` (snapshot version 5), X4 `emailText` and server subjects, X5 contact modes and `messageLeft`, X7 ledger labels, X8 `financeSummary`, `hireCheck` and quote ids (`docs/04` §6.9, `docs/21`) |
| App | `src/app/laptop/laptop-boot.ts`: `bootLaptopScreen(ui, {session, memory?, settings?, zoomOnOpen?, zoomOnClose?, backdrop?, onClosed?, onQuitRequest?, onHelp?})`, `SessionLaptopClient`, profiles and items from `/api/sessions/:id/profiles` and `/api/items`; `/src/devtools/laptop/` opens it on a new campaign (`?seed=`, `?pinClock=1`, `?wait=` scale, `?slide=` step ms, `?zoom=1`, `?scale=`) |
| Stubs | Faces for the stub profiles, `aimhist.edt` and `aimbios.edt` rows, an I.M.P. intro mail that pages in two on the stub fonts |
| Tests | Unit tests for the shell, timers, mail sort and paging, finances rows, ads, conference and sort; `laptop-screen.test.ts` drives the screen on a stub campaign session (new-mail box, paging the I.M.P. mail, Finances, bookmarks, the A.I.M. path, Esc → `closeLaptop`); `tests/e2e/laptop.spec.ts` with the goldens `laptop-new-mail.png` and `laptop-email.png` and a hire through the conference; the original-data server test `laptop-original.test.ts` |

Decisions and limits: the client sorts mail for display only; the title-bar slides take a fixed time; queries go
through commands (`emailText`, `hireCheck`, `aimQuote`); the greeting at the end of a snow never plays after the
connection snow (`gfFirstTimeInContactScreen` cleared by `DisplaySnowBackground`, as the original); pages without a
layout yet (Bobby Ray's, M.E.R.C., I.M.P., Personnel, History, Files, the flavour sites and the A.I.M. archives,
policies and history pages) show an empty monitor.

Open: the lead wires `bootLaptopScreen` in place of the placeholder (`onClosed` → map screen, `zoomOnOpen` with the
map screen's draw list as `backdrop`, `onQuitRequest`, `onHelp`) and keeps one `LaptopMemory` per session so the page
numbers and the A.I.M. state survive reopening; the conference distortion, the impatience quotes and the animated face
(U5) wait; the M.E.R.C. slow load (`LONG_UNIT_TIME`) is not wired (no view field says the site is still up after a
visit); X16 (the saved page numbers in the save's `presentation` block) is not built; the drop-down with 17
destinations, the paged text template and the generic frame animator arrive with the pages that use them.

#### U5: tactical HUD (2026-10-19)

The tactical screen on `/play`: the U4 world under the original's team panel, single merc panel and HUD, entered from
U2's flow when the session's flow is tactical (the tactical placeholder is gone; the map and laptop placeholders stay
for U8 and U10). World input is U6: the viewport only selects own mercs, ends an item cursor and opens the pickup menu.

| Area | As built |
|---|---|
| Tables | `tools/transcribe/ui-constants.ts` gains `UILayout`, `Item_Types`, `Overhead_Types`, `Soldier_Control`, `Squads`, `Interface_Panels`, `Interface_Items`, `Interface_Utils`, `Interface`, `Faces`, `Radar_Screen`, `Message` and `Game_Clock`; constants written relative to `INTERFACE_START_X`, `INTERFACE_START_Y` or `INV_INTERFACE_START_Y` are stored panel-relative (`panelRelative`) and laid out in the `tacticalPanel` and `tacticalInventory` frames; `FROMRGB` colours are read as RGB |
| Layouts | `data/layouts/original/tactical-team.json` (screen `tacticalTeam`: `bottom_bar.sti` extended per slot beyond six as `InitializeTEAMPanel` does, the faces, names, AP, bars, hands, enemy indicators, Done, Map, Squad), `tactical-sm.json` (`tacticalSingleMerc`: `inventory_bottom_panel.sti` with the `overheadinterface.sti` filler of wide panels, plate, face, the ten stats, armour, weight and camo, the body figure, the 19 slots, key ring and money regions, the 18 buttons with their enable rules, the description box geometry of `ITEMDESC_*` and the pickup menu art), `tactical-hud.json` (`tacticalHud`: the top bar, the overhead labels, radar and squad list, sector name and clock with the pause help, the message log, the pause mask, the paused and feedback boxes, the in-game keys o, Ctrl+S, Ctrl+L, Alt+X). Format additions: custom renderers receive the repeat variables, `down` (left button down: the original's primary callbacks with `triggerPrimaryOnMouseDown`, used by faces and slots), `$slotsWidth`, stub styles `hollow` and `checker`, palette bases `white` and `grayRamp` (the portrait flash and the grey face of `InitFace`) |
| Controllers | `src/ui/screens/tactical/`: `team-panel.ts` and `sm-panel.ts` (contracts and view models, `panel-models.ts` builds them: AP colours, stat texts with the 60 s up/down flash from `statChanged`, the button enable rules of `EnableSMPanelButtons`), `faces.ts` (the face record from `/api/sessions/:id/profiles` or the generic stub face of the body type, blink and expressions from the face record's frequencies on the client PRNG, lip sync from the `.gap` gaps of the speaking voice, the hit flash in white, the shades for unconscious, hatched and grey faces, the icons, the enemy count, the white, moving, stealth and compatible-item rectangles), `bars.ts` (`DrawSoldierUIBars` with the gold background of the selected merc, the bandage and the breath maximum; `DrawBarsInUIBox`; the item status bar), `item-tile.ts` (`INVRenderItem`: graphic, outline, outline shadow, status bar, ammo count, stack count, the weapon mode marker, the new-item glow), `inventory.ts` (slots, hatches and compatible outlines from the `placements` hint, the second-hand cover, the local item cursor), `item-cursor.ts` (the commands an item cursor ends in), `item-description.ts` (`InitItemDescriptionBox` from the `itemInfo` hint: picture, status, name, description, pros and cons, weapon and money stats, the ammo button that ejects the magazine into the cursor, four attachment slots, metric weights from the client setting), `item-popups.ts` (stack popup, key ring with the G20 key items), `pickup-menu.ts` (`InitializeItemPickupMenu`: rows with tile graphics, All, OK, Cancel, paging, help texts), `overlays.ts` (top bar with the enemy turn progress, radio locators, damage numbers, the UI feedback box, overhead labels), `message-log.ts` and `message-format.ts` (the six-line scroll of `ScrollString` with ageing, the queue rule and the beep, fed by the server's message entries without dialogue lines), `hud.ts` (radar, clock, pause), `tactical-screen.ts` (the screen) |
| Screen | Selection follows `HandleLocateSelectMerc` with the new selection method (below `OKLIFE` and with Alt only locate; a second click on the selected merc locates with a radio locator, a third recentres; another merc is selected with the attention sound) and `SelectSoldier` (a merc who cannot act refuses with `MERC_IS_UNAVAILABLE_STR` in the log and the feedback box; the interface level follows the merc). A face click continues a halted move (`continueTo`); the enemy indicator cycles the seen enemies (`CycleVisibleEnemies`); right click opens the single merc panel unless the merc is dead, an escort or in a vehicle; panel switches take effect on the next update (`HandleTacticalPanelSwitch`), non-merc bodies and escorts keep the team panel. A merc's death (the frame in which his life reaches 0, or the `soldierDied` event) darkens his face (closed eyes, hatch), plays `p_close.sti` then `p_dead.sti` over it every 160 ms and only then leaves the skull hatched in his slot, with his name, until the panel is rebuilt (`SetCurrentSquad`, `RebuildCurrentSquad`: a squad change or entering the screen again), although the view drops him at once; a click on the skull only centres his last tile. When the selected merc dies he stays selected through the animation, then the next merc of his squad who can act is selected (`UpdateCurrentlySelectedMerc`), or nobody. The viewport region (ending at the panel) ends an item cursor (on an other merc `give`, else `drop`), selects own mercs, and on a tile with items sends `pickUp` for a single item or opens the pickup menu for more. Keys: \` switches panels, k opens the key ring, Pause pauses, Esc closes the pickup menu, the description box, a popup or the item cursor in that order. Radar clicks and drags move the camera, the squad button swaps in the squad list |
| `/play` | `src/app/tactical/`: `TacticalHost` (per session: the VFS listing, soldier assets, frames, effects and light templates, the `TacticalWorldView` on the page's WebGL context, the sector's sounds, the three layouts with their assets, the item catalogue, profiles and the gun nut option, the radar map, the squad's sheets and item graphics; the loading screen of U2 shows the progress with the picture of the last `sectorLoaded.loadScreen`), `world-presenter.ts` (camera with snap and limits, true screen positions, stance offsets and marker flags from the animation table, picking, radar box and dots, tile pictures registered as UI images at shade 4 over the map's light colour for the pickup menu and the overhead bar boxes), `tactical-media.ts`, `tactical-client.ts` (commands, the hint provider, the player pause). `GamePage` draws the world into the logical framebuffer before the UI when the screen declares `drawsWorld` (and
skips drawing a frame that equals the last one, the world's picture included, §16 "Load timing" and "An idle tactical
screen"). The screen is kept across the options and save/load screens and rebuilt after a sector change. Entering starts the real-time driver at speed 1 unless it already runs (`?drive=manual` keeps a manual driver, for tests); the player pause is the driver at manual plus the original's mask, and any click or key up resumes |
| Hints and sound | The `/play` page wires U3b's `HintProvider` with `ClientKnowledge` (`?shadowHints=1` for the shadow mode, `window.__ja2Ui.hints`). `TacticalSound` shares the UI audio engine without its own music (the front end keeps playing the session's music); `VoiceHandle.elapsedMs` and `SoundDirector.speaking` give the faces the speaker, file and position for lip sync |
| Server and data | The item catalogue carries `calibre.showInHelpText` (from `calibres.json`, for the hand slots' help texts); rule finding 3 is settled (e173dea, deviation "Attachment AP"); key ring entries name their key item (G20, 4df5656); `protocol/hints.ts` re-exports the hint data types for the `ui` layer |
| Stub art | 04dc3f1: a generic face per body type with blink and mouth frames and `.gap` files, item silhouettes per shape for every small and big item graphic, radar maps for the stub maps; the layout-driven generator draws the panel art (hollow slots, checkered hatches). The stub sandbox mercs now carry a silencer in a small pocket, so the canvas can attach on stubs |
| Hook | `window.__ja2Ui.tactical`: `ready`, `loadMs`, `map`, `panel`, `selected`, `smMerc`, `squad`, `slots`, `radarShown`, `paused`, `faces` (eye and mouth frames), `messages`, `feedback`, `cursorItem`, `descriptionOpen`, `descriptionItem`, `pickupOpen`, `stackOpen`, `keyRingOpen`, `commands`, `camera`, `drawCalls`, `drawnSoldiers`, `pendingImages`, `enemyBar`, `topMessage`, `frameMs`, `worldMs`, and `command`, `advance`, `inventory`, `soldiers`, `items`, `soldierScreen`, `gridNoScreen`, `gridNoAt`, `soldierAt`, `centerOn`, `resetTimes` |

**Measured** with original data on `/play`, 1920×1080, UI scale 2 (logical 960×540, six slots), headless Chromium on
SwiftShader, real time, 15 s after the load: the A9 sandbox (six mercs in view, 224 UI instances in 47 batches, 26 world
draw calls): JS per frame p50 / p95 1.4 / 2.1 ms, of it the world render call 0.3 / 0.5 ms; frame interval 50 / 50 ms
(SwiftShader). Drassen (B13 from `SaveGame01`, three soldiers in view, 158 UI instances in 26 batches): 1.2 / 1.8 ms
JS, world 0.4 / 0.5 ms, interval 33 / 50 ms. A sector with twelve or more soldiers in view was not reachable on this
machine's data; the 60 FPS target of §16 still needs the maintainer's GPU.

Tests: `src/ui/screens/tactical/tactical-screen.test.ts` over a stub sandbox `Session` with the client-side hint
answers (`tests/support/tactical-ui.ts`: a fake world presenter and media over the real item catalogue): selection
through the faces, the single merc panel, one magazine and the whole stack with Shift moved by one `moveItem`, the
silencer attached through the description box, the pickup menu sending one `pickUp`, the message log, the feedback box,
the stat flash, the death animation, the blink, and draw-list snapshots of the team panel, the single merc panel and
the description box; the layout contract test covers the three layouts on stubs and on the original data;
`tests/e2e/tactical-hud.spec.ts` on stubs through `__ja2Ui` (golden `tactical-team-panel.png` with a pinned clock, the
faces blinking, selection, the single merc panel and back, a move and an attach checked in the view, the pickup menu).

Decisions and limits: the item cursor is local and ends in one command (deviation "Item cursor on the canvas"); the
pickup menu opens before the walk (deviation "Pickup menu"); the camera jumps where the original slides; the money box,
moving keys in and out of the key ring, the stealth, burst and mute buttons and the hand, talk and look cursors wait for
their commands and the input state machine (U6, U7); the clock shows only in a campaign (the sandbox has no world
clock); the sector name is the code. Open for U6: world cursors, paths, hotkeys, scrolling, menus; the stance buttons
send `stance`, climb is enabled and refused by the server; for U7: talk, shop and the money commands.


#### Lead wiring after U5 and U10 (2026-10-19)

`/play` opens the canvas laptop (`bootLaptopScreen`) when a session's flow is the laptop, through a `LaptopPort` of the
front-end flow (`src/ui/screens/front-end/flow.ts`, `src/app/game/front-end.ts`) with one `LaptopMemory` per session;
closing it re-enters the game once a frame shows the server has left the laptop (`closeLaptop` always succeeds), which
today is the map screen placeholder until U8. The laptop takes no save hotkeys, as in the original (Esc, Tab, Alt+X, H
only), so the front-end e2e saves through the API and loads through the canvas save/load screen. The merge also
unified the stub faces (U5's animated face per body type behind every small face, U10's labelled big portraits) and
raised the stub media budget to 5 MiB.

#### U7: talk and shop (2026-10-20)

§5.8 and §5.9 on `/play`: the speech presenter, the talk panel, the speech surfaces, the shop screen and the money
region and box of the single merc panel, with the server additions of §12.1 G14, G15 and §12.4. The details of the
commands and fields are in `04` §6.28.

| Area | As built |
|---|---|
| Tables and layouts | `ui-constants` gains `Interface_Dialogue`, `Dialogue_Control`, `Civ_Quotes` and `ShopKeeper_Interface`. `data/layouts/original/talk-panel.json` (screen `talkPanel`: the full-screen region, the panel, name, six approach regions and texts, the face, the busy `shade`, the Done text button on `talkbox2.sti` 3/4), `tactical-speech.json` (`tacticalSpeech`: the face popup, subtitle box and civilian box renderers and the comm popup geometry as styles), `shop.json` (§5.9, below); `tactical-sm.json` gains the money box button offsets and the `money` action of the money region. `LayoutView` takes an `origin`, so a layout can be placed at run time (the talk panel on the NPC's tile) |
| Speech presenter | `src/ui/speech.ts`: one queue for every quote event (`npcQuote`, `mercQuote`, `skyriderQuote`, `headMinerQuote`, `shopkeeperQuote`; `civQuote` goes to the civilian box), routed to a surface (`panel` for the open conversation's NPC, `tactical`, `external`, `shopkeeper`); per line the voice (`speechPathForLine` through an injected `SpeechVoices`, only with the speech option), the subtitle when the subtitles option is on or the voice failed, the talking time (the sample, else 60 ms per character), the 300 ms tail, the key wait of the panel face with key-advance, the 500 ms skip rule, Backspace (forced), Esc, `cutSpeaker` for critical battle sounds; the civilian quote with its lifetime `(chars + 2) × 60 + 500` and the 300 ms click rule. `src/app/tactical/speech-voices.ts` plays through the UI audio engine (a missing, dropped or silent sample counts as no voice) and reads the speech, subtitle and key-advance settings; the sound director hands quote speech to the presenter (`SoundDirector.setSpeechOwner`); the faces' lip sync reads the presenter's line |
| Talk panel | `src/ui/screens/talk/talk-panel.ts`: `InitTalkingMenu` placement on the cell origin of the NPC's tile clamped to the screen width and the viewport, the big face `faces/bNN.sti` (Elliot's variant from `faceVariant`) with blink and lip sync, the approaches (`repeat`, `friendly`, `direct`, `threaten`, Buy/Sell for a dealer from `zDealerStrings` or Give, `recruit`), who are you on the name, Done, the busy shading and disabled regions while a panel line is queued or said, the subtitle popup oriented bottom, left, top, right (the bottom test uses the top of the single merc panel instead of the hard-coded 340), a click on the panel or the popup skips, Esc closes when no line is queued, Give opens the talker's single merc panel |
| Surfaces | `speech-surfaces.ts`: the comm popup at 10, 20 for merc lines with the speech option (the panel by speaker, name, sector line when the speaker is elsewhere, bars, the merc's face from the team panel's animator; other speakers' small faces with the RPC offsets), the subtitle box at 110, 20, the external NPC popup, the civilian box centred on the soldier's sprite and clamped; click regions skip. `npc-requests.ts`: the `StartDialogueMessageBox` texts and buttons for every request kind, opened once the lines before the prompt are said, answered with `answer` |
| Shop | `src/ui/screens/shop/`: `ShopModel` (DOM-free: the page and its reset to 1 after a transaction, the dealer's offer slots of box selections (one unit, Shift the rest, one unit back), the player's offer slots of offered pockets, cash and the collected repairs shown as "REPAIRED", the shop's own held item (a pocket is offered at once, Ctrl picks it up), `quoteTrade` on every change, the cross-outs from the evaluations, the rejected entries left out of `trade`, the Transaction and Done rules of `EnableDisableEvaluateAndTransactionButtons` with the gift override, `needBalance` through the deduction box, "not enough funds", "no room", quote 27 on `dealerCannotAfford`, the quote-26 reminder, then `closeShop` and the screen held until the farewell is said, `setShopPricing` when the panel's merc changes); `ShopPanel` and `shop-tile.ts` on `data/layouts/original/shop.json` (std640: `tradescreen.sti`, title, labels, totals, balance, the dealer's talking face at 13, 13 and his subtitle at 13, 140 width 300 for `shopkeeper` lines, the 5×3 dealer grid with the hatched page arrows and the wheel region, the 6×2 offer grids, `DisplayInvSlot` with the price or repair ETA, count, owner portrait, star, JAMMED/REPAIRED, hatch and `itemcrossout.sti`, the repair-time tooltips, the cosmetic quotes 12–15 and 21 on client timers and the evaluation quotes from `quoteTrade.quotes`); the dealer's boxes open the read-only description box with the placement quirks and the full-screen hatch. While the shop is open the single merc panel shows the pricing merc with only the inventory and previous/next active, offered pockets hatched and a merc out of reach hatched whole; Esc is Done, Space the next merc; a money box split is offered as cash |
| Seam | `src/ui/screens/talk/dialogue-layer.ts` (`DialogueLayer`): the tactical screen creates one and calls it from `enter`, `exit`, `update`, `input` (first), `render` (last), `frames` and `describe`, plus the shop's pocket click, hatch and inventory-disable checks; it owns the presenter (or the environment's), the talk panel, the surfaces, the request boxes and the shop panel. `TacticalEnvironment` gains `speech`, `speechSettings`, `rpcSpeechPrefixed`, `prepareText` (optional) and `TacticalLayout.TALK`, `SPEECH`, `SHOP`; `WorldPresenter` gains `cellScreenPosition`; the money region's actions live in `money-actions.ts` |
| Money | `money-box.ts` (the `REMOVE_MONEY` rules) and the description box's money mode: the $1000, $100, $10 and Done buttons (`info_bil.sti`), Separate or Withdraw, the amount labels; a money pocket's Done puts the split into the item cursor (`{kind: 'money'}`), which drops into a pocket (`splitMoney`), onto a soldier (`give {money}`) or onto the money region (`depositCash` after the original's question); the money region without an item opens the box over the balance and Done sends `withdrawCash` (the 20000 cap shows `gzMoneyWithdrawMessageText`) |
| Server | G14 rest: `shopkeeperQuote` carries `textKey`, `chars` and `text`. G15: `quoteTrade.quotes` and `.poa`, `ShopBoxView.ammo`, `ShopView.repaired`; `setShopPricing`; `withdrawCash`, `depositCash` (campaign, `src/sim/campaign/money-flow.ts`) and `splitMoney` (tactical inventory command); `04` §6.28. A command's events now reach the frame captured after it (`Session.#dispatchRun` holds them for the next report too), so lines said while a conversation or a shop holds the clock arrive at once |
| Stubs | Big talking faces at `SKI_FACE_WIDTH × SKI_FACE_HEIGHT` with the eye and mouth frames for every stub profile (`stubs/ui/faces.ts`), owner portraits `faces/33face/NN.sti` (`stubs/ui/owner-faces.ts`); the layout-driven generator draws the talk, speech and shop art. The stub dealer and repairman have no dialogue rows: added `npcdata` rows would change the stub pack the 0.7.0 fixtures recorded, so their lines are silent (a line without text is skipped, as the original skips it) |
| Hook | `window.__ja2Ui.tactical.talk`: `open`, `profile`, `busy`, `line {surface, profile, soldier, text, phase, subtitles}`, `queued`, `spoken`, `textBox`, `facePopup`, `civQuote`; `.shop`: `open`, `dealer`, `page`, `pages`, `dealerBoxes`, `doa`, `poa`, `totals`, `transactionEnabled`, `doneEnabled`, `lastQuote`, `subtitle`, `held` |

Tests: `src/ui/speech.test.ts` (timing, voice and no voice, order, skips, key wait, flush, the civilian box, the routing
of every quote event), `src/ui/screens/talk/talk-panel.test.ts` (geometry; on the stub campaign in A10: the panel on
the stub NPC with its lines, busy state and subtitle, Direct, Done, the skips and Esc, a recruitment of the stub R.P.C.
through Recruit and the hire box; a draw-list snapshot), `speech-surfaces.test.ts` (a bark in the subtitle box, the
civilian box and its click rule, a Skyrider line), `src/ui/screens/tactical/money.test.ts` (the box rules; withdraw,
split and deposit through the panel; a split offered in the shop), `src/ui/screens/shop/shop-model.test.ts` (paging,
offers, the enable rules, the gift, cross-outs, the deduction box, the reminder, repairs, pricing) and
`shop-panel.test.ts` (the repair time strings, the description box placement, the evaluation quote's chance; a stub
dealer trade through the panel, a pocket offered and taken back; the draw-list snapshot), the server tests of `04` §6.28 (`money-stub.test.ts`, `shop-stub.test.ts`,
`inventory-commands.test.ts`, `narrative-original.test.ts`), `stubs/build.test.ts` (the talking faces),
`tests/e2e/talk-panel.spec.ts` on stubs (golden `talk-panel.png` with a pinned clock; the lines, Direct and Done; a
recruitment with the hire box and a withdrawal through the money region), `tests/e2e/shop-screen.spec.ts` (Buy/Sell
from the talk panel, one purchase with the deduction box, Done; golden `shop-screen.png`).

Checked by hand on the original data (`/play` on imported saves, nothing captured): a talk with Pablo in B13 (the
panel, his big face, the subtitle, the busy state, Done) and with Herve in C13, whose Buy entry opened the shop
screen, where a bottle was bought through the deduction box and the shop closed with Done.

Decisions and limits: the presenter is the client's and may trail the simulation (deviation "Talk panel and speech on
the canvas"); withdrawn money goes straight into a pocket and a split cannot be dropped on the floor (deviations
"Withdrawn money", "Split money on the ground"); inside the shop the money region, dropping to the ground and
rearranging pockets stay off (the server accepts only shop commands there), a repairman's split parts are not drawn
(`quoteTrade.poa` is not shown yet), the entry quote plays at once rather than 800 ms later, the compatible-item outline
covers gun and ammunition calibres and the gun's attachments only, and the owner portraits have no tooltip (deviation
"Shop screen details"). Open: the map-screen surfaces of §5.8 (the merc box at 110, 40, the selected character's face
talking, the extern panel position, the locator) belong to U8 and can reuse `SpeechPresenter`, which `TacticalHost`
creates today and the lead may move to the page; U6's talk cursor sends `talk` and should close an open civilian box
first (`DialogueLayer.closeCivQuoteIfActive`, the original's "a talk click only closes the box").

#### U6: tactical input (2026-10-21)

The world input of the tactical screen: the `Handle_UI.cc` state machine with its cursors and world markers, every
gameplay key of `Turn_Based_Input.cc`, the movement and door menus, the sector exit dialog, the overhead map, edge and
key scrolling, and the simulation orders the panel and the keys needed.

| Area | As built |
|---|---|
| Orders | `src/sim/tactical/player-orders.ts` (71ca9e8): `stealth`, `mute`, `weaponMode`, `swapPlaces` (the x key and the exchange cursor), `jump` over a prone soldier or a fence, `climbWindow`, `moveGroup` (the all-move, the rubber band and the multi-selection, real time only, paths through people); `attack` gains `spread` (`spread-burst.ts`: up to 50 tiles, `PickBurstLocations`) and fires in the soldier's weapon mode (launcher mode through the attached launcher); `move` gains `reverse`; `combineStack` (`CleanUpStack`); the door menu's `openManually`. Refusal tokens and events in `docs/04` §6.29; command refusals now reach the message log as `MSG_UI_FEEDBACK` (the feedback box) |
| State machine | `src/ui/screens/tactical/input/`: `ui-events.ts` (the UI events with their single-event flags and modes), `tactical-input.ts` (`HandleTacticalUI`: mouse position, polled CTRL and ALT, one queued button transition per frame (`pointer-queue.ts`), queued keys, the pending override event, single events, the menu modes and the multi-selection reset; the turn-based and real-time button queries with click-hold 300 ms, double clicks, the movement menu on a held right button, the all-move, the rubber band after 10 pixels, ALT multi-selection; the handlers of the move, confirm-move, action, confirm-action, hand, look, talk, jump-over, lock and rubber-band modes; `SetUIMouseCursor` with the exit arrows), `attack-cursors.ts` (aim rings and refinement from `estimateAttack`: the right click and wheel steps, the burst and launcher variants, throw and toss cursors), `targets.ts` (find flags of the soldier under the pointer, the body part), `hints.ts` (the cursor hints through the client's `HintProvider`) |
| Cursors and markers | `data/tables/ui-cursors.json` (`gUICursors`, transcribed by `tools/transcribe/ui-cursors.ts`); `world-markers.ts`: footsteps from `previewMove` (two per tile, the bands green, purple, blue, orange and red of `PlotPath`), the AP-dependent diamonds (stealth and unaffordable variants, the roof drop marker), the confirm figures (run, walk, swat, prone, vehicle), `BADMARKER1`, the AP number on `MOCKFLOOR1` (TINYFONT1 white, black while blinking), the selection rings under the hovered merc, the show-move-grid marker, the impact marker of throws and launchers; `arrows.ts`: the stance arrows (`SECONDPOINTERS`); the burst spread marks (`burst1.sti` frame 1); the rubber band in the twelve gold shades; the free-flowing cursors with their mouse text (AP, hit location, door and item texts) and the wait cursor while the UI is locked |
| Locks | The enemy's turn locks the UI (`LU_BEGINUILOCK`), our turn locks while `combat.uiLocked` (an attack resolving, a merc acting) or while a received frame not yet played back carries a locked combat block or another team's turn, or while a `SetUIBusy` order awaits the server's answer (`LA_BEGINUIOURTURNLOCK`); only ESC passes |
| Keys | The table below; `hotkeys.ts` (`HandleModNone`, `HandleModShift`, `HandleModCtrl`, `HandleModAlt`, `HandleModCtrlShift`, the menu keys) and `tactical-controls.ts` (the actions). The U5 HUD layout keeps o, CTRL+S, CTRL+L and ALT+X; the screen keeps \`, k and Pause |
| Menus and dialogs | `popup-menus.ts`: the movement menu (`PopupMovementMenu`: anchor, the nine buttons with their help and disabled rules, the action picture by the hand item) and the door menu (`InitDoorOpenMenu`, `PopupDoorOpenMenu`: centred on the merc, the "( AP )" help in combat, disabled without tool, key or points), opened by the server's `doorMenu` event and answered with `door {action}`; `exit-dialog.ts` (`InternalInitSectorExitMenu`, `UpdateSectorExitMenu`, `RenderSectorExitMenu`, `RemoveSectorExitMenu`) over the `exitSectorOptions` hint (which now also answers `enemyInSector`), ending in `exitSector {who, load}`; `overhead-map.ts` (INSERT: the map, the persons by team, the item dots, the merc names, a click centres the view); menus and the dialog pause the game through the modal pause |
| Panels | The SM panel's stealth, burst and mute buttons send `stealth`, `weaponMode` and `mute` (burst enabled for a burst-capable gun or an under-barrel launcher in the hand); climb tries `climb`, then the fence `jump`; the hand, talk and look buttons toggle the input's modes and show its state |
| `/play` | `world-presenter.ts`: markers as world UI nodes by tile name, their screen points, interactive tiles (doors, switches and other openable structures) and exit grids, scroll edges and scrolling within the camera limits, tile pictures for the arrows, tile centres; `overhead-map.ts` composes the overhead map once per sector from the tilesets' `t/` small tiles in the three passes of `RenderOverheadMap` into an RGB picture (`UiAssets.addRgb`); `tactical-host.ts` loads the UI cursor table, keeps the display options (tree tops, wireframes, item glow, merc light, 3D cursor, tracking) in the client settings and plays the OK, attention, curse and locked battle sounds. The view follows a walking merc in combat with tracking on and every visible soldier of the others (`HandleLocateToGuyAsHeWalks`) |
| Hook | `window.__ja2Ui.tactical` adds `uiMode`, `uiCursor`, `uiLock`, `markers` (`gridNo:tile`), `apNumber`, `movementMenuOpen`, `doorMenuOpen`, `exitDialogOpen`, `overheadOpen` |

Keys (Works: as in the original, refusals as the server's tokens in the feedback box; Later: see `deviations.md`;
Not ported: cheats, debug pages and the editor):

| Key | Action | Status |
|---|---|---|
| Tab | Interface level up or down (`UIHandleChangeLevel`) | Works |
| Space / SHIFT+Space | Next merc of the team panel / first merc of the next squad, with a locator | Works |
| 0–9 | Change squad (`ChangeCurrentSquad`) | Works |
| F1–F10 / SHIFT+F1–F10 | Locate and select / only locate the team slot | Works |
| / | Locate the selected merc | Works |
| = | Select every merc in the sector (real time) | Works; the cover and sight sizes with END or DELETE held: Later |
| - | Cover and sight sizes with END or DELETE held | Later (`§18` decision 13) |
| * and , | Red item glow | Later |
| a | Auto bandage | Later |
| b | Weapon mode (`weaponMode`) | Works |
| c, p, s | Crouch, prone, stand (`stance`, also for the multi-selection) | Works |
| d | End turn on our turn in combat | Works |
| e | Next seen enemy, or `NO_ENEMIES_IN_SIGHT_STR` | Works |
| f | Range to target (and gun range, out-of-range line) | Works |
| g, i, t, w | Merc light, item glow, tree tops, wireframes (option and message) | Works |
| h | Help screen | Later |
| j / SHIFT+J | Climb up or down / through the window faced (`climb`, `climbWindow`) | Works |
| l, u | Look cursor, action mode | Works |
| m | Map screen | Works |
| n | Cycle stacked soldiers or structures under the cursor | Later |
| r | Run (stands up first) | Works |
| v | Game settings | Version and gun lines; difficulty, save style and game style: Later |
| x | Exchange places (`swapPlaces`) | Works |
| z / ALT+Z | Stealth for the selected / the whole squad (`stealth`) | Works |
| INSERT | Overhead map | Works |
| HOME | 3D cursor option and message | Works; the 3D cursor itself: Later (`§18` decision 13) |
| END | Continue the halted move | Works |
| PAGE UP / PAGE DOWN | Higher or lower stance, climbing at the ends | Works |
| F12 / CTRL+F12 | Clear the shown messages / the message queue | Works |
| ESC | Cancel the spread, close popups and menus, stop the selected and band-selected mercs, back to the move cursor | Works |
| ENTER | Next known enemy on our turn in combat | Works |
| CTRL+Q | Swap hands | Works |
| CTRL+N | Day and night head gear | Later |
| ALT+F | Tracking mode (option and message; the view follows) | Works |
| ALT+R / CTRL+SHIFT+R | Reload / reload the squad | Works |
| ALT+- | Music volume down | Later |
| ALT+S / ALT+L | Quick save / quick load | Later |
| Arrows | Scroll (40 pixels across, 20 down per 20 ms, SHIFT doubles) | Works |
| Wheel | Aim refinement in the confirm-action mode | Works |
| Backspace | Stop the speech | U7 |
| y, F11, CTRL+C/E/H/K/O/T/U/W/Z, CTRL+PAGE UP/DOWN, ALT+M/N and the ALT cheats | Debug and cheat keys | Not ported |

Tests: `src/sim/tactical/player-orders.test.ts` (the orders and their refusals); `input/hotkeys.test.ts` (the key
mapping with a recording host, the lock and the menu keys); `input/world-markers.test.ts` (footstep bands, the move
cursors' diamonds, the confirm figures, the arrows); `tactical-controls.test.ts` over a stub sandbox session (a move by
click in real time with the cursor marker, the keys, the option toggles, the movement menu on a held right button, the
door menu from the `doorMenu` event, the overhead map, edge scrolling, the confirm click and path markers in combat,
the auto-confirmed aim and the shot at a seen enemy, the exit dialog's radio rules and keys); the `tables.test.ts`
regeneration check of `ui-cursors.json`; the layout contract test covers `tactical-input.json`;
`tests/e2e/tactical-input.spec.ts` on stubs through `__ja2Ui` (a move by click, a key, the overhead map, the door
menu, the aimed shot in a stub battle, the exit dialog in a stub campaign); the U5 pickup e2e now picks up with the
hand cursor, as the original does.

Decisions and limits: the stub world has no pointer tiles (adding tile types changes the stub tileset database and
with it the logic hash of the 0.7.0 stub saves), so markers draw only on the original data; the rest is listed in
`deviations.md` (interactive tiles, south exit arrow, overhead map, movement menu stances, burst marks,
playback lock, the keys above). The team panel's second hand of a driver or passenger ("Exit Vehicle",
`TMClickSecondHandInvCallbackPrimary`) waits for a tactical exit-vehicle command. Open for U7: Backspace and the talk
menu keys; for U8: the map screen the m key and the exit dialog open.

#### U8: map screen (2026-10-21)

The strategic map screen on `/play`, entered from U2's flow when the session's flow is strategic (the map placeholder is
gone). The flow now follows the server: a frame that shows another flow while the map or the tactical screen is up
re-enters the game, so the map's Tactical and Laptop buttons, the team panel's Map button, a pre-battle `enterSector`
and the laptop's power button all go through one path.

| Area | As built |
|---|---|
| Server (G9–G13) | `docs/04` §6.30: clock `mode`, `paused`, `playerPaused`, `pauseLocked`, `canCompress`, `compressRefusal`; mercs `idle`, `trainStat`, `repairVehicle`/`repairRobot`, `canChangeSleep`, `salary`, `bleeding`, `collapsed`, `armour`, `camo`, A.I.M. `minutesLeft` and `endMinutes`, M.E.R.C. `contractLength`; sectors `items`, `militiaTraining`, `enemiesKnown`, `facilities`; `townControl`, `mines`, `projectedDailyIncome`, `secretsFound`, `underground`; `traverseMinutes` and `helicopter.progress`. Commands `route {via, shortest, extend}`, `shortenRoute`, `routeGroup` (the move box; the strategic `moveGroup` of §12.4 renamed), `heliRoute {via, extend, plotted}`, `shortenHeliRoute`, `heliPlot` (the click on the helicopter: Skyrider's greeting, the empty-helicopter hint once, why he cannot fly), `moveMilitia`, `distributeMilitia`, `discardItem`; hints `canEnterSector`, `assignmentOptions`, `previewRoute {extend, alone}`, `previewHeliRoute {extend}`, `moveBoxOptions`; `groupArrived` for every player group. The refusal table moved to `src/protocol/refusals.ts` so the client prints the original strings. Rule finding 8 is settled (§12.5) |
| Tables and layouts | `tools/transcribe/ui-constants.ts` gains `MapScreen`, `Map_Screen_Interface` (`_Map`, `_Bottom`, `_Border`, `_Map_Inventory`, `_TownMine_Info`), `Map_Screen_Helicopter`, `Assignments` and `Strategic_Movement`. `data/layouts/original/map-screen.json` (screen `mapScreen`: the panels, the team list and info panel art, sort, contract, previous/next, border filter, level, laptop, tactical, options, compression and message buttons, the custom renderers `mapView`, `characterList`, `characterInfo`, `bottomPanel`, `radar`, `etaBox`, the popup styles, the update panel and militia art, the keys of `GetMapKeyboardInput`) and `map-inventory.json` (screen `mapInventory`: the merc inventory at the map positions, the sector pool). Layout buttons take `down` actions (the border and compression buttons act on the press without the 250 ms repeats) |
| Screen | `src/ui/screens/map/`: `map-screen.ts` (regions, timers, the Esc chain, filters, levels, compression, prompts, exits), `character-list.ts` (the list, its literal sort, selection, the column strings and colours), `team-list-view.ts` (rows, glow, flashes), `info-panel.ts`, `map-view.ts` (board, shading, secrets, SAMs, mines, towns, militia, icons, arrows, item counts, levels, locators, cursors, the helicopter and its destination), `path-trace.ts` (`TracePathRoute`, the pulse), `plotting.ts` (legs, the 200 ms rest, previews, confirmation, shortening, group plotting), `assignment-menus.ts`, `contract-menu.ts`, `map-menu.ts` (the popups and the screen mask, created under the popup it guards), `map-prompts.ts` (decision prompts as message boxes; a box closes when the prompt is answered elsewhere), `message-list.ts`, `bottom-panel.ts`, `compression.ts`, `filters.ts`, `ui-message.ts`, `town-info-box.ts`, `militia-popup.ts`, `move-selection.ts` and `move-box.ts`, `update-box.ts`, `merc-inventory.ts`, `sector-inventory.ts`, `item-pool.ts` and `map-inventory.ts` (U5's inventory, popups and description box through a narrow `InventoryEnvironment`) |
| Plotting | The destination column or a click on the selected sector (the move box first) starts plotting; the temporary path, the ETA (the doubled remainder kept) and the checkmark come from `previewRoute` after the pointer rests 200 ms; legs stay in the client until the confirming click sends one `route` per selected group (`routeGroup` from the move box); a right click on the merc's sector cancels, on the old path sends `shortenRoute`, on a new leg drops the later legs. The helicopter: airspace filter, a click on its icon sends `heliPlot`, the distance box from `previewHeliRoute`, `heliRoute {plotted}`. The bullseye moves the landing zone (`setLandingZone`) |
| Time | `src/app/map/map-client.ts` drives the session in real time with `pauseOn` for the update box (`assignmentDone`, `fellAsleep`, `wokeUp`, `contractsExpiringSoon`); menus, plotting, boxes, the town box, the militia popup, the inventories and the update box hold time (the driver goes manual) like `InterruptTimeForMenus` and `UpdatePausedStatesDueToTimeCompression`; after the server stops on an event the driver restarts once playback has caught up and no box holds it; leaving the map stops it so the tactical driver starts clean. Compression: more starts at 5 minutes per second, less steps down and stops below 5 (`stopTime`, deviation), Space toggles; the buttons follow `canCompress` and the client's own reasons; a refusal names the original's reason, an enemy presence calls the pre-battle placeholder. The map screen shows the latest view (no playback lag) |
| `/play` | `src/app/map/map-host.ts` (per session: the client knowledge and hint provider, the layouts and their assets, `b_map.pcx` at half scale with the four mono shades of `InitializePalettesForMap` registered as RGB images (`map-board.ts`, `UiAssets.addRgb`), the item catalogue and profiles, `map-media.ts` (messages from the session's log, dialogue lines from the EDT files, the selected sector's radar map), `map-sound.ts` (`glowclick.wav`, `newbeep.wav`, the OK battle sound of the confirming merc)). `SessionClient` keeps the message log (welcome and frames) and notes the driver the server stopped. `FrontEndFlow` gains a `MapPort`; the team panel's Map button sends `mapScreen` (and asks before abandoning a boxing match), the loading screen shows the picture of the last `sectorLoaded.loadScreen` even when the tactical host did not exist yet |
| Hook | `window.__ja2Ui.map`: `ready`, `error`, `screen` (`selectedSector`, `level`, `info`, `selected`, `plotting`, `filters`, `menu`, `uiMessage`, `rows`, `messages`, `clock`, `inventoryOpen`, `changingArrival`, `compression`, `flow`, `prompt`, `townBox`, `militiaTown`, `militiaCursor`, `moveBox`, `updateBox`), `holds`, `lagTicks`, `commands`, `hints` (the map's own `HintHook`, shadow mode with `?shadowHints=1`), `command`, `advance`, `sectorPoint`, `rowPoint`, `helicopterPoint`; `mapInventory` on the screen |
| Stub art | `stubs/ui/strategic-map.ts`: `interface/b_map.pcx` coloured by each sector's traversability (towns, water, rivers, terrain, roads, the edge of the world), grid lines on even pixels so they survive the half-scale blit; written before the stub skin. Medium faces for the update box; corrected stub sizes of `militia.sti` and `mapinvbtns.sti` |

Tests: `src/ui/screens/map/*.test.ts` over the stub map-screen campaign (`tests/support/map-ui.ts`: a `MapClient` over a
server `Session` with client-side hint answers, fake media; `tests/support/e2e-campaign-saves.ts` builds the campaign):
a draw-list snapshot of the first frame, plotting a route, the assignment popup, airspace and the helicopter,
compression, the militia payment box, a prompt answered elsewhere, squad keys and the inventory; unit tests for
compression, filters, plotting, group plotting, the town box, the militia popup, the move box and its selection rules,
the update box, the item pool and the map inventory; `src/app/map/map-board.test.ts` and `stubs/ui/strategic-map.test.ts`;
server tests for every new command and field (`src/server/map-screen-stub.test.ts`, `map-screen-original.test.ts`,
`hints-strategic-stub.test.ts`). `tests/e2e/map-screen.spec.ts` on stubs through `__ja2Ui` from the save
`u8-map-screen` (golden `map-screen.png` with a pinned clock; a route plotted from the destination column with the
client hints shadow-checked against the server; militia training through the popup and the payment box; a squad
change; boarding the helicopter and flying it; the laptop and back; tactical and back).

Decisions and limits: the pre-battle interface and the autoresolve screen are a numbered box until U9; quotes on the
map play no speech and the info face does not lip-sync (the talk screens' speech player, U7, is not wired in); `v`
(game settings), `h` (the map-screen help) and the quick save keys do nothing; vehicles are not characters (no
condition or fuel); the map host opens its own client knowledge next to the tactical host's (one per session would
halve the memory). Deviations: "Map route plotting", "Map compression step down", "Map screen boxes for prompts", "Map
screen speech", "Militia redistribution", "Move box regrouping", "Update box timing", "Vehicles as characters", "Trash
can warning for mission items", "Map inventory cursor", "Sector inventory order", "Map item description", "Map
inventory details".

#### Lead wiring after U6, U7 and U8 (2026-10-21)

The three slices ran in parallel from the same base; their `04` sections are §6.28 (U7, talk, shop and money), §6.29
(U6, the player-interface orders) and §6.30 (U8, the map screen). On the tactical screen the dialogue layer takes input
before U6's controls and renders after them. The shop disables the burst, look, stealth and mute buttons with the
others under its panel (`EnableSMPanelButtons`, `ShopKeeperInterface_SetSMpanelButtonsState`). An item cursor without a
drop command (a money split) is put back on a viewport click. The talk cursor on a soldier without a profile only
closes an open civilian quote box (`HandleTalkInit`, `ShutDownQuoteBoxIfActive`). `UiAssets.addRgb` takes an RGB image
(the overhead map and the map board share it). The map screen's description box shows U7's money buttons at the
original's offsets, but the money commands are tactical only, so a split there does nothing yet. Open: the map host
and the tactical host each keep a client knowledge per session (one would save memory); the map screen has no speech
presenter yet (the U7 presenter lives in `TacticalHost`); the team panel's Exit Vehicle waits for a tactical
`leaveVehicle`; PBI and autoresolve are a numbered box until U9.

#### U9: battle entry (2026-10-24)

The pre-battle interface and the autoresolve screen on `/play` replace U8's numbered boxes. The panel is part of the
map screen (as `gfPreBattleInterfaceActive` is); autoresolve is a screen pushed over it and popped when the battle
closes.

| Area | As built |
|---|---|
| Server (G16, `docs/04` §6.31) | `showBattle {}` opens the non-persistent `preBattle` prompt (`persistent: false`, options with `close`; refusals `noBattle`, `onlyHostileCivilians`); `answer close`. The prompt and the automatic start's `preBattle {autoStart}` event share `src/sim/campaign/pre-battle-panel.ts`: `involvedGroups`, uninvolved `betweenSectors`, `departure` and the original destination rule; the event carries `panel`. `battleLocator` on the strategic view; `encounter`, merc `profile`, militia and enemy `female` on `observe.autoresolve`; `weapon` and `reloaded` on shot `arAttack`, `melee` on `arHit`, `splat` on `arDied`; `bandageRefusal` on `autoresolveDone`, `data.bandaged` from `answer bandage`. No field draws a number; the oracle gate is unchanged. The retreat sector per group is not sent (no retreat preview) |
| Tables and layouts | `tools/transcribe/ui-constants.ts` gains `PreBattle_Interface` and `Auto_Resolve`. `data/layouts/original/pre-battle.json` (screen `preBattle`: the blanket at HIGHEST-5, `MLG_PREBATTLEPANEL`, the three `prebattlebutton.sti` buttons with their fonts, colours, offsets and wrap, the custom `preBattlePanel` with every position of `RenderPreBattleInterface` as parameters, the hotkeys a, e, r and Esc) and `autoresolve.json` (screen `autoresolve`: the blanket at HIGH-1, the custom `autoresolvePanel`, the ten `autobtns.sti` buttons whose positions are bound to the geometry, `smfaces.sti`, `indent.sti`, Space and Alt+X) |
| Screens | `src/ui/screens/battle/`: `battle-entry.ts` (follows the prompt, the automatic start and the flow; switches the map screen to the panel and to autoresolve, selects the battle sector and the team filter as `InitPreBattleInterface` does), `pre-battle.ts` and `pre-battle-text.ts` (the stretch with the gravity curve of `DoTransitionFromMapscreenToPreBattleInterface`, the header and its blink, the title bars, the frames, the labels, the counts with "?", the rows by U8's column strings, the fast help per kind and reason, the pressed Autoresolve of an automatic start), `autoresolve-geometry.ts` (`CalculateRowsAndColumns`, `CalculateSoldierCells`, `BuildInterfaceBuffer`, the button and text positions, the time modifier, the opening's cubic easing), `autoresolve-cells.ts` (faces, bars, the hit flash, the unconscious shadow, the status texts), `autoresolve-playback.ts` (the slice queue: each slice's events spread over its real time, then the view), `autoresolve-sounds.ts`, `autoresolve-screen.ts` (Play, Fast, Finish, Pause and Space with the kept-speed quirk, Retreat and the merc cells, the surrender offer with every button hidden after a refusal, Bandage with its box, Done, the result and the elapsed time) |
| Flow | A `preBattle` prompt shows the map screen (`gameScreenOf`) while the server flow is still tactical; the answer decides the next screen. `MapHost` keeps an automatic start that arrives before the map screen exists; `front-end.ts` creates the map host for it. Esc and a, e, r reach the panel before the map screen's keys |
| `/play` | `src/app/battle/`: `SessionBattleClient` (commands, the driver, `advance`, the latest view), `BattleSound` (laptop power up, the effects at volume 50 or HIGHVOLUME, the weapon sound with its lock'n'load, the battle voices through `battleSoundCue`). Music stays the server's (`arBattleOver` sets victory or defeat). With `pinClock` the 1 s openings finish at once (the frozen clock cannot time them) |
| Hook | `window.__ja2Ui.battle`: `ready`, `state` (`screen`, `preBattle {prompt, persistent, encounter, phase, autoStart}`, `autoresolve {opening, status, speed, paused, interface, pending, cells, result, elapsed, ratio}`, `commands`), `drives`, `commands`, `sounds`, `buttonPoint` |
| Stub art | From the layouts: `prebattlepanel.sti` (261×359 main panel, title bar piece, columns, uninvolved header), `prebattlebutton.sti`, `autoresolve.sti` (the 14 pieces at the sizes `BuildInterfaceBuffer` steps by), `autobtns.sti`, `smfaces.sti`, `indent.sti`; the 65face portraits already existed. The stub media budget in `stubs/build.test.ts` rose from 5 to 5.5 MiB (the panel alone is about 100 KB) |

Tests: unit tests for the geometry against hand-computed original numbers (`autoresolve-geometry.test.ts`), the header,
fast help, departure and stretch (`pre-battle-text.test.ts`), the faces, statuses, bars, flash, playback and sounds
(`autoresolve-cells.test.ts`), the screen over a fake client (`autoresolve-screen.test.ts`: speeds and Space, a merc's
retreat, the surrender with Yes and with No then CAPTURED, bandaging and Done, Finish muting the sounds), the screens
over the stub map-screen campaign (`battle-entry.test.ts`: the persistent panel with a draw-list snapshot, the a key
into autoresolve with a snapshot, victory at Fast and Finish back to the map, retreat, defeat, an automatic start, the
summary from the battle locator closed with Esc); `event-fields.test.ts` for the new event fields and the bandage
refusal; `src/server/battle-entry-stub.test.ts` for the prompt fields, the view, the auto-start panel, `showBattle` and
the three stub battles; `battle-art-original.test.ts` (`JA2_DATA_DIR`) for the frames the renderers draw.
`tests/e2e/battle-entry.spec.ts` on the saves of `tests/support/battle-entry.ts` (the U8 campaign with an enemy group a
minute from Drassen, loaded with `reseed: false`): goldens `pre-battle.png` and `autoresolve.png` with a pinned clock,
victory with Bandage and Done back to the map, defeat, Pause, Fast and Pause again, then Retreat to RETREATED, the
summary from the locator and from a refused compression. Surrender and capture need day 4 and a stalled battle, so they
are unit-tested only.

Decisions and limits: `showBattle` (a prompt) was chosen over a `battleSummary` query so the summary keeps the
original's side effects (the wake-up, the stopped compression) and the panel needs no second code path; the battle runs
on the server at the chosen pace and the client spreads each slice (deviation "Autoresolve pace"); the retreat preview
is not drawn (deviation "Pre-battle retreat preview"); militia and enemy battle voices are the client's pick
(deviation "Autoresolve battle voices"); placement stays deferred ("Tactical placement", §8.3). Open: the robot's
optimistic retreat display follows the server one slice later; `autoresolveBattle` clears the battle group where the
original keeps the first involved group (the `showBattle` path keeps it); the media budget will need the lead's eye
once the laptop slices add their art.

#### U11: laptop, part two (2026-10-24)

§9.5–§9.7 on the canvas laptop: Bobby Ray's, M.E.R.C. with the broken link, and I.M.P., the drop-down and the frame
animator U10 left open, and the server gaps X6, X11, X12 and X15 (`04` §6.32, `21` §10).

| Area | As built |
|---|---|
| Tables | `ui-constants` gains `BobbyR`, `BobbyRGuns`, `BobbyRMailOrder`, `BobbyRShipments`, `Mercs`, `Mercs_Account`, `Mercs_Files`, `Mercs_No_Account`, `BrokenLink`, `CharProfile`, `IMP_HomePage`, `IMP_MainPage`, `IMP_Begin_Screen`, `IMP_Personality_Quiz`, `IMP_Personality_Finish`, `IMP_Attribute_Selection`, `IMP_Finish`, `IMP_Text_System` and `IMPVideoObjects`; `tools/transcribe/c-constants.ts` reads `enum{` written without a space (the I.M.P. text records, pages and attribute ids; the other regenerated tables only gain names, and `Squads`' `NO_CURRENT_SQUAD` now resolves to 20) |
| Widgets and format | `src/ui/widgets/drop-down.ts`: `DropDown` (entries, visible rows, selection on hover, the scroll top with the original's clamp to `entries − visible − 1`) and `DropDownView` (the `tactpopup.sti` border pieces, the gold highlight, the arrows, the 17 scroll regions, the close area); layout type `dropDown` (a `DropDown` bound as `model`, `labels`, `rows` geometry, optional `scroll`, `closeArea`, `change`); `frame-animator.ts`; region keys `repeat` and `secondaryRepeat`; button icons follow their bindings (`frame`, `visible`) and may show a face (`icon.face`) |
| Shell | A page's `layouts` may change and the screen rebuilds its views (sub pages); `enteredFromBookmark`; `startSubPageLoad(fast)`; message box style per call; per-screen site state (`laptop-sites.ts`: the Bobby Ray's cart, the M.E.R.C. session, the visited I.M.P. pages) |
| Bobby Ray's (`bobby-ray/`) | Home with the under-construction gate (animator, signs disabled until `open`); one catalogue template for guns, ammo, armour, misc and used (rows, big picture, specs with the rate of fire, the ammo tooltip naming the team's guns, page arrows, subtotal, the 10-line cart as a client draft kept across pages); the order form (quote through `bobbyRayQuote`, the city drop-down of the 17 destinations, the speed lights, clear, accept: the funds box, the destination question, `bobbyRayOrder`, the confirmation picture); the shipments page (`BobbyRShipments.cc`) |
| M.E.R.C. (`merc/`) | Home with Speck's video window (`SpeckVideo`: black for 1 s, the small face stretched to the video face, the queued quotes of the replies and the opening said one after the other with subtitles in the merc text box, a click skips, the X closes, the black exit), the visit only when entering from outside the site, the arrival box after a hire; no account; account (rows, total, authorize behind the `BLUE_ON_GREY` question, the transfer failure box from an own label); files (overlays for dead, married, P.O.W., hired and away, bio, stats, salary, previous/next, hire); the broken link while the site is down |
| I.M.P. (`imp/`) | `charProfilePage` hosts the fourteen sub pages with their own sub-page loads (fast once visited in the laptop session, none for the first page), the global cancel button and IMP-style boxes; the draft (`ImpDraft`) lives in `LaptopMemory`. Home with the activation code (Enter on key up, `impCheckCode`), about us, main with the step blockers and the face icon, begin (name, nickname, gender), the quiz (answer buttons on the press, the long, short and short2 indents, the women's questions behind `IMP_CON_3`), the personality finish, the attribute entrance, the attributes (arrows on press and repeat, the slider drag and click of `SliderRegionButtonCallback`, the per-frame drag past the bar ends, the zero warning), the attribute finish, portrait, voice (the sample on entry and on each step), finish (the analysing label and icon while pressed), confirm through `impCreate` |
| Server gaps | X6, X11, X12, X15 (`04` §6.32) |
| Stubs | `braydesc.edt`, `mercbios.edt`, `imptext.edt` (239 filler records with the attribute labels); no lines for Speck (a `npcdata/159.edt` would change the stub pack the 0.7.0 saves recorded, as with U7's dealer, so his quotes play without subtitles on the stubs); aliases for Speck's face and the I.M.P. faces and portraits; the media budget raised from 5 to 5.5 MiB (the pack measures 5.22 MiB after U11) |
| Tests | Unit tests for the drop-down, the Bobby Ray's pages, Speck's video, the draft, the quiz records and indents and the sliders; `laptop-sites.test.ts` drives each site on a stub campaign (Bobby Ray's under construction and an order to Drassen, M.E.R.C. from the opening to the broken link, an I.M.P. character through every page); `src/server/laptop-sites-stub.test.ts` for the server gaps; the original-data test `laptop-sites-original.test.ts` (quiz records, faces, portraits, voice samples, Speck's lines); `tests/e2e/laptop-sites.spec.ts` from a save with Drassen held (`tests/support/e2e-laptop-saves.ts`): an order through the canvas delivered in Drassen, a M.E.R.C. account, hire and payment, an I.M.P. character, goldens `laptop-bobby-ray-guns.png`, `laptop-bobby-ray-order.png`, `laptop-merc-home.png`, `laptop-imp-quiz.png` and `laptop-imp-attributes.png` |

Decisions and limits: the cart and the I.M.P. draft are client state until the one command; the open point of §9.7 is
settled without a deviation: on the original data the attribute page's label records do match the value order (the
comments next to the records in `IMP_Text_System.cc` name them wrongly). Deviations added: "Bobby Ray's shipment
prices", "I.M.P. begin page focus", "I.M.P. voice samples", "I.M.P. skill page and saved profiles"; "Speck's opening"
now draws the post-hire `CoinToss` at `mercHire`. The video face is the still small face (the animated face of U5 is
not wired into the laptop, as in the A.I.M. conference).

Open: the florist's destination list (U12's page-local `DestinationList`) maps onto the drop-down: `new DropDown({entries:
17, visible: 17, selectOnHover: true})` (the list hovers into the selection like `SelectFlowerDropDownMovementCallBack`),
bound as the `dropDown` widget's `model` with the destination names as `labels`, the `tactpopup.sti` border, the `rows`
geometry of `Florist_Order_Form.cc`, a height of the rows plus 10, no `scroll`, the laptop screen as `closeArea` and a
`change` action taking the index; `show()`/`hide()` are `toggle()`/`close()`, `hover(i)` and `pick(i)` are `hover(i)` and
`choose(i)` (a test in `drop-down.test.ts` covers that configuration). The direct skill pick and the saved I.M.P.
profiles wait (deviation).

#### U12: laptop, part three (2026-10-24)

§9.3 (Personnel, History, Files), §9.8 (insurance, florist, funeral) and the A.I.M. archives, policies and history pages
as pages of U10's `LaptopScreen`, one layout and controller per page, and the server gaps X7 (history), X9, X10, X13
and X14 (`docs/04` §6.33). Every bookmark now leads to a finished page; the pages of U11 (Bobby Ray's, M.E.R.C., I.M.P.)
come from that slice.

| Area | As built |
|---|---|
| Tables and layouts | `ui-constants` gains `Personnel`, `History`, `Files`, `Insurance`, `Insurance_Contract`, `Insurance_Info`, `Insurance_Comments`, `Florist`, `Florist_Gallery`, `Florist_Order_Form`, `Florist_Cards`, `Funeral`, `AIMArchives`, `AIMPolicies` and `AIMHistory`. Layouts `laptop-personnel`, `laptop-history`, `laptop-files`, `insurance-chrome`/`-home`/`-info`/`-contract`/`-comments`, `florist-chrome`/`-home`/`-gallery`/`-order`/`-cards`, `funeral`, `aim-archives`, `aim-policies` and `aim-history` in `data/layouts/original/` |
| Shell | Modes for the florist gallery, order form and card gallery and the insurance info, contract and comments pages (appended to `laptop-modes.ts`); `LaptopShell.subPage` (reset when the browser moves to another site) and `connectToSubPage(fast)` for the paged sites; a page may handle Esc first (`escape?()`, the order form swallows it as the original); message boxes take a style (`RED_ON_WHITE` for insurance); `pages-memory.ts` keeps the history page, the selected file and its page, the first insurance card and the florist's choices for the session; the taskbar's new-file icon opens the newest unread file; the A.I.M. placeholder page is gone |
| Personnel (`personnel/`) | Current and departed lists (`fCurrentTeamMode`), the 4×5 portrait grid with previous/next, the stats, employment and inventory panels with their enables (`SetPersonnelButtonStates`), the inventory slider by zones, the team summary (lowest, average, highest), the daily, highest and lowest cost; from `observe.laptop.personnel` |
| History (`history/`) | 22 rows a page, previous/next, the page and day counters, the red quest-start and cheat rows, server-rendered text and location |
| Files (`files/`) | The list with sender and read state, the plain and the two special layouts (the Arulco report with its pictures and wrap widths, the terrorist files with their mug shots), paging by `IanWrappedStringHeight` with `MAX_FILE_MESSAGE_PAGE_SIZE`; showing a file sends `readFile` |
| Insurance (`insurance/`) | Home, the five info pages, comments and the contract page: three cards a page with the face, status, contract and insured days, premium and Accept, the "nobody to insure" texts by `aimMercsOnTeam`, the confirmation boxes, `insure` |
| Florist (`florist/`) | Home, the gallery (three bouquets a page with their prices), the order form (bouquet, the order number, next day, the four extras, the destination list of 17 rows, the message and name fields, the card gallery, Send through `orderFlowers` without checks as the original, Clear) and the card gallery; entering the form sends `visitSite {site: floristOrderForm}`. The destination list is page-local (`florist/destination-list.ts`: `destinationListGeometry(rows, fontHeight, width)` and `DestinationList` with `open`, `selected`, `show`, `hide`, `hover`, `pick`; drawn in the layout with the `tactpopup` pieces) |
| Funeral and A.I.M. archives | The funeral page with the condolence box; alumni (20 faces a page, three pages, the popup with name and text), policies (the agreement, the contents, the sections with their menu) and history (contents, chapters, menu) |
| Server | `docs/04` §6.33: history `text`, `location` and `questInProgress` with the full `GetSectorIDString` (shared with the finance rows); `readFile`; personnel blocks `current` and `departed`; `battlesFought` counted after autoresolve and won tactical battles, imported from native saves, snapshot version 6; insurance offers with `nickname`, `dead`, `contractLength` and `aimMercsOnTeam`; the bouquet price from `flowerdesc.edt` charged by `orderFlowers` and the order number drawn on entry and after a send |
| Oracle | `tools/oracle/patches/0025-florist-oracle.patch` and `probes/florist.txt` (orders on SaveGame01 and 07: the order number before, after entering and after sending, the price and the laptop dump), optional in `compare-all.sh` |
| Stubs | Invented texts in `stubs/text/laptop-pages.json` (files, the report, quests, the insurance texts, bouquet descriptions with prices, card sayings, alumni, policies); `aimhist.edt` grows to 23 rows; the big pictures of the new pages are label-free hollow frames, and the stub media budget in `stubs/build.test.ts` is 5.5 MiB |
| App | `/src/devtools/laptop/` takes `?hire=profile:days,…` (A.I.M. hires before the laptop opens) and exposes `window.__ja2Laptop.command` |

Tests: unit tests per page (`personnel-model`, `personnel-page`, `history-page`, `files-page`, `file-pages`,
`insurance-pages`, `insurance-text`, `florist-pages`, `florist-rules`, `funeral-page`, `aim-archives`, `aim-policies`,
`aim-history`) through `tests/support/laptop-ui.ts` (the laptop screen over a stub campaign session); server tests
`src/server/laptop-pages-stub.test.ts` and, with original data, `laptop-pages-original.test.ts`; the autoresolve
`battlesFought` count in `close.test.ts`. `tests/e2e/laptop-pages.spec.ts` on stubs: twelve hires, Personnel, an
insurance purchase through the contract page, two history pages and the report file (goldens `laptop-personnel.png`,
`laptop-insurance-contract.png`, `laptop-history.png`, `laptop-files.png`), every side button and bookmark, the A.I.M.
archives, policies and history, the insurance info and comments, the funeral page and a flower order (golden
`laptop-florist-order.png`).

Decisions and limits: X14 takes the first option of §9.8 (the price is read at content load and the number drawn on the
main stream), so the deviation "Florist prices" and the florist part of "Cosmetic laptop draws" are gone; an agent may
order without entering the form ("Florist order form entry"); the inventory arrows do not repeat while held, file page
turns skip the one-frame wait and the florist's text fields stay under the open list ("Laptop III page details").

Open: the florist's destination list is page-local; at the merge with U11 it can move onto U11's drop-down widget (17
rows, no scrolling, the `tactpopup` frame); snapshot version 6 (migration 5, `battlesFought`) may need renumbering if
another slice also bumps the version; X16 (the saved page numbers in `presentation.laptop`) is still not built.

#### U13: story and help (2026-10-24)

§4.7, §10 and the San Mona screen of §4.11 on `/play`: the meanwhile box, the ending through the videos and the
credits, and the help screens of the tactical, map and laptop screens and the sector inventory. The server additions
are in `04` §6.34, the presentation of the story in `26` §15.

| Area | As built |
|---|---|
| Server | The campaign identity (`src/server/campaign-id.ts`): a random identity per new campaign, `import:` + digest for a native import, kept in the save's `presentation.campaign` and restored on a load (`save:` + digest for an older save), sent in the welcome (`SessionClient.campaign`). The strategic view's `gameJustStarted`. `meanwhileStarted` plays the menu music and then N7's sector entry rule (`TACTICAL_NOTHING`), as `StartMeanwhile` and the load do; the server had left the menu music on because the step's `sectorLoaded` comes before `meanwhileStarted` |
| Tables and layouts | `ui-constants` gains `HelpScreen` (`HelpScreen.h`, `HelpScreen.cc`, `HelpScreenText.h`: the geometry, the colours and fonts, the `HLP_TXT_*` records, the `HelpScreenID` bits). `data/layouts/original/help-screen.json` (screen `helpScreen`, placed at run time through `LayoutView`'s `origin`): the full-screen mask, the button border and the background of `interface/helpscreen.sti`, the title and the "(press H)" line, the footer and the check box when it came up by itself, the text column and the scroll box as custom renderers, the exit button, the page buttons, the two arrows and the keys of `GetHelpScreenUserInput`. Layout format: a region's or a button's `cursor` may be a choice by a bound state (the laptop's cursor), and an EDT row given by a binding counts as that binding |
| Help screens | `src/ui/screens/help/`: `help-pages.ts` (the six screens' titles, page buttons and paragraphs: laptop 8 pages, map screen 8, "no one hired yet", "not yet in Arulco", sector inventory, tactical 6, with the loops that add a font height after each paragraph and the laptop's one-paragraph pages that do not; `HelpScreenDetermineWhichMapScreenHelpToShow`), `help-scroll.ts` (lines of a page, the clamps of `ChangeTopLineInTextBufferByAmount`, the FLOAT scroll box of `CalculateHeightAndPositionForHelpScreenScrollBox`, the drag with the grab offset, three wheel lines), `help-overlay.ts` (the modal: 412×292 or 320×292, centred over the viewport end, in the laptop over its monitor; pauses the game; pages through the buttons and Left/Right on release clamped to the pages; Up/Down and PgUp/PgDn on release and repeat; Escape on release; the check box sets the hide flag only when the screen came up by itself), `help-system.ts` (`ShouldTheHelpScreenComeUp`: a forced screen at once, a screen whose bit is unseen and not hidden on its third frame, the count restarting on a new screen; the bit marked seen when the screen comes up, forced or not; never while a modal is up or, in tactical, while a pre-battle prompt is open) |
| Help on `/play` | `src/app/game/help-host.ts` loads the layout and `binarydata/help.edt` (through the EDT cache that reads the data files, as the laptop pages do), runs the system every frame on the tactical, map and laptop screens (the map's sector inventory open picks its help) and keeps the seen mask in the client settings (`helpScreensSeen[campaign]`, `helpHidden`; `localStorage` behind `try`/`catch`, written fresh so other writers are not overwritten). `h` reaches it from the tactical keys (`HotkeyHost.help`), the map screen's `help` action (which first ends route plotting with the "unchanged" message, as the original) and the laptop's `onHelp`. A session without a campaign identity (a sandbox) never shows a help screen by itself |
| Meanwhile box | `src/ui/screens/story/meanwhile-box.ts` and `story-layer.ts` (`StoryLayer`, page level, fed with every frame batch before the front-end flow): the BASIC box `"<MSG_MEANWHILE>....."` with OK alone for the interrogation or a scene the setting `meanwhileScenesSeen` does not mark, OK and Skip otherwise; both continue and nothing is marked seen, since no scene plays. The box is a client modal (the driver goes manual while it is up, §1.4) and the frames that follow the event wait for the answer, so the interrogation's switch to N7 comes after OK, through a fade out and in |
| Ending | The same layer: `squadMovedUpstairs` fades out, lets the flow load P3 (loading screen) and fades in when the tactical screen is up; `campaignWon` fades out, leaves the session (it stays on the server, flow `ended`), plays `endingPlan`'s videos, then the credits with the music off and the main menu with its music (`src/app/game/story-host.ts`). The killer's and witnesses' quotes, Derek's and Oliver's panels and the end-game comments are U7's talk screens. The flows `meanwhile`, `endgame` and `ended` show the tactical screen (`gameScreenOf`); entering it locates the Queen in a meanwhile and gridno 4561 in the endgame (`src/app/tactical/story-camera.ts`); quote frames that arrive while the page has no tactical screen yet reach it when it is built |
| Brothel | Checked: `sexScene` from the tactical screen shows U2's San Mona screen (black, no cursor, `interface/luckysmile.sti` centred, frame 0 for 24 steps of 100 ms then the step modulo 8, 32 steps and a second, `sounds/sex.wav` at `HIGHVOLUME`), then the fade into tactical; the time warp is the server's (finding 1). Added: the screen holds the real-time driver like a modal (deviation "San Mona screen and time") |
| Stubs | `stubs/text/help.json` → `binarydata/help.edt` (all 123 records, texts written for ja2-node; the tactical overview and the merc stats are long enough to scroll); the layout-driven art of `interface/helpscreen.sti` with the two large frames hollow, so the media stay under the 5 MiB budget |
| Hook | `window.__ja2Ui.help` (`open`, `forced`, `page`, `top`, `totalLines`) and `.story` (`step`, `played`, `meanwhileBoxes`, `endings`) |

Rule finding 3 (attachment AP) was settled in U5; the U13 row's reference to it was stale, and no finding about the
story or the help screens was open (§12.5).

Tests: `src/server/campaign-id.test.ts`; `src/protocol/music.test.ts` (the interrogation's music);
`src/ui/screens/help/help-scroll.test.ts` and `help-screen.test.ts` (placement, title, pages, keys, arrows, wheel,
close, the frame count, blocked, hidden, no campaign, forced, the check box); `src/ui/screens/story/story-layer.test.ts`
(the box's buttons and text, the flow held and released, the interrogation's fades, the move upstairs and the ending
with the frames after it dropped, reset; `gameScreenOf` of the story flows); `interrogation.test.ts` over the stub
interrogation session on the tactical screen (the Queen's panel, Escape does not end the scene, `inMeanwhile` for other
commands, the YES/NO/LIE box after the panel closed, the answer, the music); `src/ui/screens/front-end/san-mona.test.ts`
(the step timing, the held driver, the fade back); `src/server/e2e-story-saves.test.ts` (the three e2e saves);
`tests/e2e/story.spec.ts` (golden `story-meanwhile-box.png`: the Drassen scene's box over the map screen with OK alone,
then the game goes on; OK and Skip for a scene marked seen; the Queen bleeding to death in the stub basement, the move
upstairs, the ending videos, the credits without music and the main menu; golden `story-help-screen.png`: the map
screen's help by itself once per campaign, pages, Escape, then forced with `h`). The e2e suite stores `helpHidden` by
default (`playwright.config.ts`), so the other specs' flows and goldens do not change; the story spec opts back in.

Decisions and limits: the meanwhile box follows §1.4 (a client modal) rather than a `pauseOn` stop; the help mask is
keyed by the server's campaign identity, which saves carry; the ending leaves the session instead of deleting it.
Open: the map screen still has no speech presenter (nothing in the story flows needs one: the interrogation and the
ending run on the tactical screen; the quotes that open a PBI are U9's); the "connection lost / server error" panel
is not built; the sector inventory's double help call is not reproduced (deviation "Help screens seen").

---

#### Lead wiring after U9, U11, U12 and U13 (2026-10-24)

The four slices ran in parallel from the same base; their `04` sections are §6.31 (U9, battle entry), §6.32 (U11,
laptop II), §6.33 (U12, laptop III) and §6.34 (U13, story and help). `gameScreenOf` shows the map screen while a
pre-battle prompt is open and the tactical screen for the tactical, meanwhile, endgame and ended flows. The laptop
pages have two test harnesses: `tests/support/laptop-ui.ts` (U12's page tests) and `tests/support/laptop-sites-ui.ts`
(U11's site flows). The florist keeps its page-local destination list: the original draws it with its own code and
geometry (`Florist_Order_Form.cc`, not `BobbyRMailOrder.cc`), and U11's entry gives the `DropDown` configuration that
could replace it. U12's snapshot version 6 is the only snapshot change. The stub media budget is 6 MiB (the merged pack
is about 5.6 MiB). Every vitest run now uses its own temporary folder, removed at the end
(`tests/support/run-temp-dir.ts`), because the stub builds of the tests had filled `/tmp`. The florist probe joins
compare-all as an optional probe (`florist/florist.jsonl` in the oracle folder). Open: the map screen becomes ready
slowly under load because the client knowledge loads the rule pack one file after another (U9's note); the map screen
still has no speech presenter; the "connection lost" panel and X16 are not built; surrender and capture in autoresolve
are covered by unit tests only.

#### U14: stub art and e2e (2026-10-25)

§15 complete on the stubs in CI, an opt-in structural run on the original data, the remaining special-case stubs of §13
and the frame-time probe. The server change is `04` §6.35; no rule, command or deviation changed.

**§15, item by item** (before U14 → what U14 added):

| §15 item | Covered before U14 | U14 |
|---|---|---|
| Foundation units | `src/ui/input/regions.test.ts`, `events.test.ts`, `src/ui/widgets/button.test.ts`, `widgets.test.ts`, `drop-down.test.ts`, `src/ui/text/text.test.ts` (stub fonts; original fonts with `JA2_DATA_DIR`), `labels.test.ts`, `src/ui/cursors/cursor-state.test.ts`, the hotkey tables in `src/ui/screens/tactical/input/hotkeys.test.ts` and the map and help screen tests | — |
| Layouts | `src/ui/layout/layouts-contract.test.ts` (every layout of every skin on the stub pack; with `JA2_DATA_DIR` every asset and frame on the original data), `layout.test.ts`, `tables.test.ts` | the load screens now resolve to the RGB565 stub |
| Controllers and draw-list snapshots | 39 controller test files under `src/ui/screens/*/` over the builders of `tests/support` (fake `GameClient`s over recorded or live stub sessions), draw-list snapshots in `front-end/draw-lists.test.ts`, `tactical-screen.test.ts`, `map-screen.test.ts`, `battle-entry.test.ts` and the laptop page tests | — |
| Server | query purity (`query-purity.test.ts`), fairness (`hints-fairness.test.ts`), the view fields and events in the stub scenario suites (also with `JA2_RELOAD=1`), every command with its refusals, the oracle probes of compare-all, the rule pack (`pack.test.ts`, `rule-pack.test.ts`: no STI read, a stable hash, the cache; `legacy-save.test.ts` and `save-service.test.ts`: saves record it) | the answer tick (`session.test.ts`) |
| Hints, client against server | `hints-stub`, `hints-actions-stub`, `hints-strategic-stub` and their `-original` twins with the strict projection built from the serialised view; the shadow mode only in `hints.spec.ts` on the devtools page (`map-screen.spec.ts` compares `hintNow` with `query` by hand) | the shadow mode on `/play`: the main flow requires compared answers on the tactical and the map screen and no difference; the talk, shop and battle-entry specs run with it and allow no difference. Comparisons after frameless steps were all counted stale; fixed on the server (`04` §6.35) |
| Animation schedule | `src/app/world/soldier-frames.test.ts` (also against the original rules with `JA2_DATA_DIR`), `battle.spec.ts` | — |
| The hook | `ready`, `screen`, `scale`, `widgets`, `modal`, `cursor`, `frameCount`, `capture()`; commands only per screen (`tactical.commands`, `map.commands`, `battle.commands`) | `lastCommand` and `lastResult` (`{ok, reason, refusal}` of the session's last command), `frameStats`, `lagTicks` and `skipPlayback()` (`04` §6.35) |
| Main flow | in pieces on separate sessions: `front-end.spec.ts` (new game to the laptop, save and load), `laptop.spec.ts` (the hire on the devtools laptop page), `map-screen.spec.ts`, `tactical-hud.spec.ts`, `tactical-input.spec.ts` | `main-flow.spec.ts` (below) |
| Options; PBI and autoresolve; a shop; a conversation | `front-end.spec.ts` (the options kept across a reload), `battle-entry.spec.ts`, `shop-screen.spec.ts`, `talk-panel.spec.ts` | the last three with the shadow mode |
| Goldens on stubs | 28 | 56 (below) |
| Original data, structure only | none | `playwright.data.config.ts`, `tests/e2e-data/` (below) |
| Performance | `tactical.frameMs` on the tactical screen only | `frameStats` on every screen, `performance.spec.ts`, the measurement below |

**The main flow** (`tests/e2e/main-flow.spec.ts`, helpers in `main-flow.ts` and `play-flow.ts`) runs on
`/play?shadowHints=1&drive=manual` with seed 1414 (the test adds `seed` to the canvas's `POST /api/sessions`) and the
client setting `websiteLoadingTimeScale: 0`: the main menu, game init (Novice) and its message box, the laptop's new-mail
box, A.I.M. (bookmark, sort page, mug shots, Marlow's page, the conference: Hire, Transfer Funds, the arrival box), three
more hires through MCP so the bot can win, the power button, the map screen, `compressMore` until the squad lands in A9,
the HUD (team panel, faces, radar, Map, End Turn and Squad buttons, no missing art), the move cursor over four tiles in
real time, the campaign bot (`tools/campaign-bot`) walking the squad until it is our turn in combat with an enemy in
sight, the face
click, the move cursor over three tiles in combat, the single merc panel and back, the confirm-action cursor over an
enemy and the aimed shot by click, the bot winning the battle, an NPC's conversation closed with Done if one opened,
the team panel's Map button once no merc line is shown, a route plotted from the
destination column to B9 (the preview hint locally, two clicks), Options → Save Game → a new row with a typed
description, Options → Load Game → that row → the in-place load, and the route still in the group's path. Clicks go to
widget centres through `page.mouse`, keys by code; every wait is on hook state (`lagTicks`, `pendingImages`, screens,
modals, widgets), screen loads wait while the page keeps loading (`waitWhileLoading`: finished requests, the progress
bar and the screen change) and fail only after 90 s without progress. It takes about a minute on an idle machine and
six on a loaded one; the steps log their time.

**Goldens added** (stubs, `capture()`, pinned clock; 28 → 56): tactical `tactical-sm-panel`, `tactical-item-description`,
`tactical-pickup-menu`, `tactical-overhead-map`, `tactical-exit-dialog` (`goldens-tactical.spec.ts`); map screen
`map-assignment-popup`, `map-route`, `map-town-box`, `map-militia-popup`, `map-sector-inventory`, `map-helicopter`,
`map-update-box` and `front-end-loading` (`goldens-map.spec.ts`, on its own copy of the U8 save with a tired merc off
his squad, `holdTime=1` so game time stands still, the loading screen held by delaying the first rule read); laptop
`laptop-aim-sort`, `laptop-aim-mugshots`, `laptop-aim-member` (`goldens-laptop.spec.ts`), `laptop-finances`
(`laptop.spec.ts`), `laptop-aim-home`, `laptop-aim-policies`, `laptop-aim-alumni`, `laptop-insurance-home`,
`laptop-funeral`, `laptop-florist-home`, `laptop-florist-gallery` (`laptop-pages.spec.ts`), `laptop-bobby-ray-shipments`,
`laptop-merc-files`, `laptop-imp-home`, `laptop-imp-finish` (`laptop-sites.spec.ts`). No existing golden changed.

**The original-data structural run** is opt-in and never part of CI (`JA2_DATA_DIR: ''` stays the default of
`playwright.config.ts`):

```
JA2_E2E_DATA_DIR="/home/daniel/Jagged Alliance 2 Gold/Data" JA2_E2E_PORT=7500 JA2_E2E_WEB_PORT=5500 pnpm e2e:data
```

`playwright.data.config.ts` starts the server on that folder, runs only `tests/e2e-data/` (the stub suite's test folder
does not include it) with screenshots, video and traces off, and refuses to start without the variable. Its specs:
`main-flow.spec.ts` (the same flow; the canvas hires the cheapest A.I.M. merc who answers), `tour.spec.ts` (the main menu, game
init, the 23 options and their labels, credits; the laptop programs, A.I.M. pages, funeral and insurance; the A9
sandbox's team panel, single merc panel, description box and overhead map) and `performance.spec.ts` (A9 at 1920×1080,
logged). They assert structure only: screen names, widget ids, visibility, enabled states, texts present, no missing
image or font, no refused command, no failed `/vfs` read. No picture of the original data can be taken: `capture()` and
`expectGolden()` of `tests/e2e/ui-capture.ts` throw when `JA2_E2E_DATA_DIR` is set, the data fixture
(`tests/e2e-data/fixture.ts`) replaces `window.__ja2Ui.capture` by a function that throws before any page script runs and
makes `page.screenshot` reject, and the data specs import neither.

**Stubs** (§13, every family with a decoder round trip in `stubs/build.test.ts`):

| Family | Before U14 | U14 |
|---|---|---|
| Cursors | `stubs/ui/cursors.ts`, round trip | — |
| Faces, eye and mouth frames, `.gap` files | `stubs/ui/faces.ts`, `stubs/speech.ts`, round trips | — |
| Item sheets, big item pictures | `stubs/ui/items.ts`, round trip | — |
| Map board | `stubs/ui/strategic-map.ts` with its own test | a round trip through the built pack |
| Radar maps | `stubs/ui/radar.ts`, round trip | — |
| Load screens | the skin's shared indexed 640×480 picture | `stubs/ui/load-screens.ts`: one RGB565 picture (a gradient with its name) behind the 43 load screen names of the loading layout, so the loading screen draws an RGB565 STI as on the original data |
| Help and laptop EDTs | written by `stubs/text.ts`; only merc dialogue, item text, credits and mails had a round trip | every help record and the first record of every laptop page file through the text service |

The media budget rose from 6 to 7 MiB: the load screen is 600 KB at the 640×480 the layout declares (RGB565 STIs are
not compressed) and `loadscreens/` now counts; the media measure 6.26 MiB.

**Flaky specs.** The pickup test of `tactical-hud.spec.ts` had two causes: it polled the dropper's tile for five
seconds while the walk played back (it now shows the latest view with `skipPlayback` and checks at once), and its
sandbox had no seed, so it took the server's session counter and in a parallel run sometimes started with an enemy in
sight, which put the squad into combat during the walk (every sandbox spec now asks for seed 1, the quiet sandbox of
`tactical-input.spec.ts`; the team panel golden is unchanged). The map-ready waits of `battle-entry.spec.ts` and
`map-screen.spec.ts`, the laptop waits of `front-end.spec.ts` after a new game and a load, and the loads of the new
specs wait while the page loads instead of a fixed 30–120 s. With the main flow and the goldens the suite renders more
SwiftShader pages at once, and four workers on this eight-core machine starved each other's pages past the 90 s
budget of unrelated specs; local runs now use three workers (`playwright.config.ts`, CI keeps the default). The suite
is 85 tests in 8.6–9.7 minutes locally.

**Measured** (`frameStats`: the page's JavaScript time per frame; headless Chromium on SwiftShader on this machine,
shared with other agents' test runs):

| Where | JS per frame p50 / p95 / max | Other |
|---|---|---|
| Stubs, main menu, 1280×960, scale 2 (`performance.spec.ts`) | 0.3 / 0.5 / 1.3 ms | — |
| Stubs, the sandbox on the tactical screen, 1280×960, scale 2 | 1.2 / 1.7 / 3.1 ms | — |
| Original data, the A9 sandbox on `/play`, 1920×1080, scale 2, real time, six mercs in view (`tests/e2e-data/performance.spec.ts`) | 1.3 / 2.0 / 42.2 ms (one long frame among 300) | world render 0.3 / 0.4 ms; 25 world draw calls; 223 UI instances in 48 batches; mean frame interval 40.6 ms (SwiftShader) |

The main flow takes about a minute on an idle machine (new game 6 s, the A.I.M. hire 11 s, the landing 8 s, the
battle's cursors 11 s, route, save and load 3 s each) and up to six minutes while other agents run test suites (the
landing, which loads the map screen's and then the tactical screen's rules, up to 50 s). On the original data the
structural run (five tests) takes about two minutes: the main flow 1.1 minutes (the bot wins the A9 landing), the tour
30 s, the measurement 22 s. The 60 FPS target of §16 still needs the maintainer's GPU.

**Bugs found.** Fixed: the shadow mode counted every comparison after a frameless step as stale (`04` §6.35). Not
fixed, none in the simulation: the stub pack has no small tiles (`tilesets/<n>/t/`) for the overhead map, so on the stubs
`loadSmallTiles` falls back to a missing grass tile and the overhead map is black under the persons (the golden keeps the
frame, the persons and the names). Observed and left alone (not checked against the original): the militia filter's
message takes the first right click on the map; a merc put to sleep by command is not listed by the update box
(`fellAsleep` is the hourly rest's); with `pinClock=1` the map screen's plotting rest never ends, so the map goldens plot
through the hook instead.

Open: the San Mona screen has no golden (a stub brothel scenario does not exist; `san-mona.test.ts` covers it), nor the
A.I.M. conference (its snow and video run on the UI clock); the main flow hires three mercs through MCP and lets the
campaign bot fight, so the canvas covers one hire, the cursors and one shot; the client knowledge still loads the rule
pack one file after another and the map and tactical hosts each load it (the tests now wait while the page loads); the
Lead-wiring points stay open (the map screen's speech presenter, the "connection lost" panel for a WebSocket dropped
during play (the screens that cannot open and a page that cannot boot have their panel since 2026-10-26, §4.11), X16,
surrender and capture in autoresolve on unit tests only, the team panel's Exit Vehicle).

## 18. Decisions and open questions

The maintainer took every recommendation except the version on 2026-10-19.

1. **UI scale**: auto (1920×1080 → scale 2, logical 960×540 with Stracciatella's wider tactical view) with a "640×480
   only" option. *Decided.*
2. **Entry page**: the canvas game at `/play` during M8; at the release, `/` becomes the canvas main menu with a link to
   the launcher, or stays the launcher. *Decided at U15.*
3. **Layout files**: JSON with a schema, constants referenced by name from generated tables, `@derived`/`@src`
   provenance, rather than TypeScript modules (modern layouts can then be authored without code). *Decided.*
4. **Message log**: server presentation entries saved with the session, rather than a client-only table (agents see
   them, saves keep them, one audit pass). *Decided.*
5. **Meanwhile scene playback**: deferred (box only). *Decided.*
6. **Militia popup**: built in U8 together with `moveMilitia`/`distributeMilitia`; deferred only if M8 must shrink.
   *Decided.*
7. **Shop placement above 640×480**: centred like the other fixed screens (a deviation from Stracciatella's top-left
   placement). *Decided.*
8. **Attachment AP**: verify with an oracle probe, then charge per command in combat. *Decided.*
9. **Brothel time warp and the loading-screen entry draw**: simulate both (they move the main stream and game time like
   the original). *Decided.*
10. **Stracciatella's `gui_extras` stat progress bars**: off (D16). *Decided.*
11. **Map path quirks** (column 16, the doubled ETA remainder): verify in the oracle, then keep. *Decided.*
12. **Release version**: M8 is **0.8.0**; 1.0.0 is not tied to M8 (the recommendation was 1.0.0, `docs/27` §14
    decision 14; the maintainer chose 0.8.0). *Decided.*
13. **Cover and line-of-sight display, 3D cursor, touch input, key remapping UI**: Later. *Decided.*
14. **Data scenarios** (§1.3): M8 builds scenario 2 and the boundaries 3 and 4 need (the rule pack, the replaceable asset
    source, the client's rule content, the schedule and the warp); scenario 1 gets only the CI stub art; scenarios 3
    and 4 follow M8. *Decided (2026-10-19).*
15. **Cursor hints on the client** with the simulation's own functions over the player-knowledge projection; the server
    answers the same kinds over the same projection for agents, fallback and verification. *Decided (2026-10-19).*
16. **The animation scripts stay data from the user's files**: parsed at load into logic and presentation parts, never
    extracted into the repository (CLAUDE.md); the client plays its own frames against the server's schedule and warps
    them when its scripts differ. *Decided (2026-10-19).*

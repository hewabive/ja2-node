# 28 — Player UI: architecture, widgets, layouts and fonts

**Conventions.** Paths without a prefix are relative to `reference/stracciatella/src/game/`; `src/sgp/…` to
`reference/stracciatella/`. ja2-node paths start with `src/` (other than `src/sgp/`), `data/`, `stubs/`, `tools/`,
`tests/` or `docs/` and are relative to the repository. Fixed-screen coordinates are in the `std640` frame (§3.10). A difference a player
can see is a row of `deviations.md` and a missing piece a row of `gaps.md`, named here in quotes ("Item cursor on the
canvas").

**Companions.** `30` (the screens: front end, tactical panels and input, map screen, battle entry, laptop, story, UI
sound), `01` (D8–D10, D15, D16, the layers), `04` §4 (drivers and playback), `04` §5 (the server; `04` §5.10 the rule
pack and asset serving), `29` (agent API: every command, query, view field and event a screen uses), `05` (tactical
rendering), `20` (lighting), `21`–`23` (laptop, contracts, merchants), `24` (dialogue and speech timing), `26`
(meanwhiles and the ending), `27` §1–§2 (saves, options), `31` §1–3 (sound, video, text and glyph tables), `32` §1–3
(stubs, performance, the launcher), `deviations.md`, `gaps.md`.

## 0. Scope

The player UI is the browser client in which a human plays the whole campaign: one page, `/play`, with a DOM-free `ui`
layer (a region dispatcher with the original's `MouseSystem` semantics, buttons, bitmap text with the original's wrap
and colour model, cursors, popups, message boxes) that emits a draw list, a WebGL2 renderer that draws it and the
tactical world at a logical resolution, and the original screens rebuilt on that foundation. Each screen reproduces the
original 640×480 composition (art from the user's data, positions from Stracciatella's constants, bitmap fonts,
palette-index colours, region priorities, the key phase of every hotkey) inside Stracciatella's resolution model
(§2.6), as a controller and view model over the `PlayerView`, cursor hints and queries, bound by a JSON layout (§1.2).
The rules stay on the server (D15) and nothing the original would hide is shown (D16; §1.1). The launcher at `/` keeps
the ja2-node-only features (data source, language, sessions, native imports, downloads, settings export, developer
pages) and links to `/play`.

This doc: principles (§1), architecture (§2), the widget foundation with fonts, cursors and the layout format (§3), the
stub skin (§4), the verification harness (§5), UI performance (§6). The screens are in `30`.

---

## 1. Principles

### 1.1 Fidelity policy

The original's screens are fixed compositions of STI and PCX art, bitmap text in palette-index colours and mouse
regions at constants from `#define` blocks; once the shared widgets exist, reproducing a screen is transcription, so
the original's look and behaviour is the default. A part is **simplified** (a cheaper equivalent shows the same thing)
when the original mechanism cannot work in a browser (pointer warping, mouse confinement, OS key repeat), depends on
the frame rate (fades, zoom speeds), exists only to spare a software renderer work (dirty rectangles, background save
buffers) or needs a server rule the client must not reimplement. A part is **left out** when it needs simulation that
does not exist (the helicopter drop, meanwhile scene playback, tactical placement) or is costly flavour (the A.I.M.
conference distortion, Speck's idle chatter).

Rules from D15 and D16 that bind every screen:

1. **No hand-written rule in the client.** Every number a screen shows that the simulation computes (costs, chances,
   ETAs, prices, what fits where, what is enabled) comes from the view, from a hint computed by the simulation's own
   functions over the player-knowledge projection (§2.4), or from a server query. A screen may restate an *enable*
   rule on view fields only when the rule is trivial and the command refuses anyway (try-and-refuse is always
   acceptable). The server validates commands on the full state.
2. **No hidden state.** A screen shows only what the original shows at that moment; view fields added for the UI
   reveal nothing more. Hints and queries run on the projection, where soldiers the player does not see do not exist.
   Where the original's own UI leaks hidden state (a menu line shaded because of enemies nobody has seen), the
   projection does not; the command then refuses with the original's message (`deviations.md` §6).
3. **Presentation never feeds the simulation.** Client timers (blinks, flashes, lip sync, fades, loading bars) and
   cosmetic randomness (`src/audio/client-random.ts`) stay in the client.

### 1.2 Four parts per screen

| Part | Lives in | Knows | Never knows |
|---|---|---|---|
| **Controller** (state machine, selection, popups, what a click sends) | `src/ui/screens/` | the view, hints, queries, commands, client settings | coordinates, art, fonts |
| **View model** (named values, booleans and lists the layout binds to) | produced by the controller | display strings (formatted through the text service), enable flags | pixels |
| **Layout** (widgets, positions, art, fonts and colours, bound to view-model names and controller actions) | `data/layouts/<skin>/<screen>.json` | the widget vocabulary, asset ids, font ids | rules, the view |
| **Widgets and renderer** (region dispatcher, buttons, text, popups; the draw list; WebGL) | `src/ui/widgets/`, `src/ui/input/`, `src/render/ui-draw/` | geometry, input events | game state |

The skin `original` is the only one. A controller declares its actions and bindings (a `ControllerContract`, collected
in `src/ui/screens/contracts.ts`); the contract test checks that every layout of every skin binds them or marks them
`unsupported` (§3.10). Screen parts that cannot be generic (the tactical viewport, the strategic map, the radar, faces,
inventory slots, the item description box, video, credits) are `custom` widgets whose geometry comes from layout
parameters, so another layout can resize them without touching the controller.

### 1.3 Data scenarios

The game data splits into the **rule pack** (everything the simulation reads: animation scripts, maps, structure
files, tileset definitions, profiles, NPC scripts, the lock table, text files, the graphic facts the simulation takes
from STI headers, the voice lengths, plus the project tables) and **media** (graphics, sounds, music, videos, fonts),
which only the client needs. The server builds the pack from its data, loads the simulation's content only through it
and binds saves to its hash (`04` §5.10). The server is authoritative over the rules; the client draws with its media
and plays its animation frames against the server's schedule (§2.3).

| # | Scenario | Rules on the server from | Media on the client from | Status |
|---|---|---|---|---|
| 1 | Stubs only | the stub pack | the server (`/vfs`) | built |
| 2 | The user's data on the server, served to the client | `JA2_DATA_DIR`, built into the rule pack at start and cached | the server: `/vfs/@<hash>/…` immutable URLs from the asset manifest (§2.5) | built |
| 3 | The user's data on the server and on the client | `JA2_DATA_DIR` | the client's own `Data` folder, each file checked against the manifest on first read; a mismatch or a missing file fetched from the server | not built |
| 4 | The user's data only on the client | a rule pack the client builds from its folder and uploads (hash first), kept in the server's cache; sessions bound to a pack | the client's own folder | not built |

The seams for 3 and 4 exist: the pack is an explicit artifact with a hash; the client reads files through a
replaceable `AssetSource` (§2.5; a local-folder source would read archives with the DOM-free SLF parser over
`Blob.slice`), builds the same rule content with the same loaders (§2.4), and warps the animation schedule when its
scripts differ (§2.3). Missing: the local folder source and the per-file check (the data version must match too, since
text lengths time speech), the validated pack upload, per-session content and per-user pack storage.

Graphics stay palette-indexed in every scenario (soldier palettes, shade tables and outline colours need indices);
ja2-node's own code decodes STI, PCX, ETRLE, IMA ADPCM, GAP and Smacker, so no browser codec matters.

### 1.4 Time while the client shows something modal

The original pauses game time while a message box, the options or save screen, the help overlay, a popup menu, the
item pickup menu or the sector inventory is open, and it pauses *at the event* that opens a box
(`MessageBoxScreen.cc:270-274`, `Options_Screen.cc:169`, `HelpScreen.cc:465-472`, `Interface_Items.cc` pickup menu).
In ja2-node the server owns time:

- **Client modals** (message boxes, the exit box, the options and save/load screens opened in a game, help, the
  tactical movement and door menus, the sector exit dialog, the overhead map, the meanwhile box, the San Mona screen)
  call `UiRuntime.pauseGame`. `ModalPause` (`src/app/game/modal-pause.ts`) counts nested modals: the outermost one
  switches a running real-time driver to `manual` (`SessionClient.drive`); the last one restores the previous driver,
  only on the same session and only if the driver is still manual.
- **Boxes opened by an event** (the map screen's update box): the real-time driver's `pauseOn: EventType[]` stops it on
  the tick of the first listed event (`04` §4.3); the client sets the list the original pauses at.
- Decision prompts freeze the server anyway (D15).
- The tactical player pause = the driver at `manual` + the original's mask (`30` §3.8).

---

## 2. Architecture

### 2.1 Layers

Browser layers (`tools/check-imports.ts`, tsconfig project references):

| Layer | May import | Contents |
|---|---|---|
| `ui` (`src/ui`) | core, content, protocol | lib ES2024 only (no DOM), the `NONDETERMINISM` forbid list (time is injected). Region dispatcher, widgets, layout model, bitmap font metrics and text layout over `src/content/text/glyph-table.ts`, hotkey tables, the cursor database, the **draw list**, screen controllers written against abstract clients (`GameClient` for hints and queries, `FrontEndClient`, per-screen environments) |
| `render` | core, content, protocol, ui **types only** | DOM. `render/ui-draw` (draw list → batches) and `render/world` (the tactical world). A value import from `ui` fails `pnpm imports` (the `typeOnly` rule) |
| `app` | core, content, sim, protocol, ui, render, audio | DOM. The game page, `SessionClient`, the asset source and cache, the client's rule content and the local hint provider (`sim/knowledge` and `sim/hints` run in the browser unchanged, `04` §5.7), audio, video, `localStorage`; the launcher |
| `devtools` | core, content, protocol, ui, render, audio, app | the developer pages, among them the widget gallery (`src/devtools/ui-gallery/`) |
| `stubs` | core, content, node, ui, stubs | the stub skin, generated from the layouts (§4) |

`sim` holds the player-knowledge projection (`src/sim/knowledge/`) and the hint functions (`src/sim/hints/`), used by
the server's query service and by the client. `app` may not import `devtools`, so the client pieces the developer pages
share live in `app` (`app/net`, `app/world`, `app/sound`, `app/media`).

### 2.2 The game page

`/play` (`src/app/game/index.html`, aliased by `src/node/client-pages.ts` for the Vite servers and the built client)
holds one WebSocket (`SessionClient`), one WebGL2 context (`preserveDrawingBuffer` off), one audio engine, one asset
source and cache, and a `ScreenHost` (`src/ui/screen.ts`): a **screen stack** (`enter`, `exit`, `update(now)`,
`input(event)`, `render(list)`, `describe()`) under a **modal stack**. Modals take input first, the top one blocking
unless it `passesUnhandledInput`; the screen under a modal is drawn but not updated; a modal that `freezesScreen`
(message boxes, fades) replays the draw items taken when it opened. Switching tactical ↔ map ↔ laptop is a screen
change, so decoded assets survive.

**Boot** (`main.ts`): `bootUi` (`ui-boot.ts`: the asset source, `UiAssets`, the 16 fonts and 68 cursor files preloaded,
`UiAudio`, the text service, the layout loader), then `startFrontEnd` (`front-end.ts`) opens the main menu, or with
`?session=` the session's game screen; `?screen=testPattern` shows the platform test screen (`test-pattern.ts`: every
draw primitive, the golden of `tests/e2e/play.spec.ts`). A page that fails to boot shows a plain HTML panel (heading,
the reason from `src/ui/client/failure-text.ts`, Retry as a reload), since the game's fonts may not have arrived. URL
options: `scale`, `fixed640`, `pinClock=1` (the injected clock stays at 0, for goldens), `shadowHints=1` (§2.4),
`drive=manual` (the tactical screen keeps a manual driver).

**Frame** (`GamePage.frame`, a `requestAnimationFrame` loop on the injected clock; DOM events reach `UiRuntime.input` as
they arrive, through `dom-input.ts`): resize (§2.6) → playback (`SessionClient.playFor`) → `UiRuntime.frame` (UI clock,
region re-evaluation, sliders, `ScreenHost.update`, cursor timers, the screens' draw items, tooltips, the Ctrl+F
diagnostics overlay of `29` §30, the software cursor last) → the world when the top screen `drawsWorld` → the draw
into the logical framebuffer. An unchanged frame is not drawn again (§6.2).

**Screen flow** (`FrontEndFlow`, `src/ui/screens/front-end/flow.ts`): the front-end screens (`30` §1) and the game
screens behind ports (`TacticalPort`, `MapPort`, `LaptopPort`; hosts in `src/app/tactical/`, `src/app/map/`,
`src/app/laptop/`). `gameScreenOf(view)` follows the server's flow: `laptop` → laptop; an open pre-battle prompt → map;
no strategic view, or the flows `tactical`, `meanwhile`, `endgame`, `ended` → tactical; otherwise the map. A frame that
shows another flow while a game screen is up re-enters the game, so every screen change the server makes (the map's
Tactical and Laptop buttons, the team panel's Map button, a pre-battle `enterSector`, the laptop's power button) takes
one path. A game screen that cannot open shows `screen-unavailable` (`30` §1.11).

**Connection** (`src/app/net/session-link.ts` under `SessionClient`). `connect` resolves on the welcome and fails on a
refused hello, a `closed` reply or a socket closed before the welcome. During play a closed socket, or a server silent
for 20 s after a heartbeat ping (sent after 5 s without a message, id 0, its pong kept from the client), rejects the
requests in flight, reports `reconnecting` and dials again after 0, 0.5, 1, 2 and then every 5 s with a hello for the
same session; requests made meanwhile fail at once. A welcome of the same `instance` (`04` §5.2) restores the session
and resets the client like a load in place; another instance or an unknown session ends it as `gone`; a `closed`
message ends it with the server's reason. The flow shows the box `reconnecting` (OK leaves for the main menu, the box
closes itself when the connection is back) and, when the session ends, leaves it for the main menu and names the
reason in the box `sessionEnded` (own labels `reconnecting`, `sessionClosed`, `sessionLost`, `serverStopped`,
`sessionGone`).

**Test hook.** `window.__ja2Ui` (`src/app/game/ui-hook.ts`) reports screen, modal, scale, origin, logical size, widgets
(id, kind, rect, visible, enabled, state, text, frame), cursor, sounds, frame counts and times, playback lag, the last
command and its result, music, video, help and story state and the `/vfs` reads in flight, and offers `capture()` (the
logical framebuffer as RGBA) and `skipPlayback()`; screens add `tactical`, `map`, `battle` and `hints` blocks. The e2e
suite drives the canvas through it (§5).

### 2.3 The client's copy of the game

`SessionClient` (`src/app/net/session-client.ts`) keeps the **shown** view (advanced by playback) and the **latest
received** one (`latestView`, which hints read), both updated by the generic `applyViewFrame(view, frame)`
(`src/protocol/view.ts`: copies every field a frame carries, replaces the changed soldiers through `applyFrame`, moves
the tick), so every field the server adds reaches the screens without client work. `ReloadingSession`
(`tests/support/session-reload.ts`, used by the stub scenario suites) checks it as the inverse of `diffPlayerView`
through a `ViewMirror` (`tests/support/view-mirror.ts`) after every dispatch and advance. The client also keeps the
message log, the frames not yet played back (`queuedFrames`, read by the input lock, `30` §3.1) and the `welcome`
identity (`engine {version, commit}`, `rules {pack, scripts}`, `04` §5.10).

**The animation schedule.** The server splits `ja2bin.dat` into a logic timeline the simulation steps and a
presentation timeline (sprite frames, sound codes; `src/content/anim/timelines.ts`, `04` §5.10). A soldier's view entry
carries the animation state, `frameSlot` (the logic position from the state's start), `stateTick`, `frameDelay`
(`sAniDelay`; it depends on breath, life, agility, terrain, combat and stealth, so the client cannot compute it) and
`nextFrameTick`; gameplay markers arrive as events with ticks (`shotFired`, `meleeStrike`). `SoldierFrames`
(`src/app/world/soldier-frames.ts`) reads the client's own scripts and compares their hash with `welcome.rules.scripts`
(`unknown` counts as equal; `?scripts=stub` on the devtools tactical page forces the stub scripts):

- **Same scripts** (always in scenario 2; policy `exact`): the sprite frame is the presentation frame of the
  (predicted) slot, equal to the server's `frame`.
- **Different scripts** (policy `warp`): per state the client walks its own script into a track (frames, the frames
  that carry opcode 430, a loop or an end) and plays it from `stateTick` at `frameDelay`, warped piecewise between the
  state start and the ticks of `shotFired`/`meleeStrike` from received frames (`SessionClient.onReceive`, so playback
  behind the latest tick interpolates), holding the frame before an unconfirmed marker. A muzzle flash still coincides
  with the shot; nothing flows back from the picture (deviation "Soldier frames with other scripts"). Other gameplay
  opcodes carry no event with a tick, so they do not anchor the warp.

`SoldierView.frame` stays: the sound director (`src/audio/director.ts`) walks the scripts from it, and agents read it.
Fine animation between the 50 ms frames comes from the schedule, not from a smaller `FRAME_TICKS`.

**Predicted frames.** `nextFrameTick` is the view tick at which the slot next advances (`NEVER_NEXT_FRAME` while the
soldier's updates are paused, and in a campaign off the tactical screen; `animation.ts` reads the frame timer,
`tacticalPlayerView` converts it to view ticks). Within a state at a constant delay the slot advances every
`ceil(frameDelay / 5)` ticks along the state's walk of frame slots (jumps and opcodes take no time), so
`predictedFrameSlot` (`src/content/anim/schedule-track.ts`) finds the slot at any later tick. The session keeps a
soldier's last sent anchor (`keepPredictableFrames`, `src/server/frame-anchors.ts`) while the animation, its start and
its delay are unchanged, its script plays no sound and the prediction matches the simulation; otherwise it sends the
soldier. While a kept anchor is still to advance, a capture without changes sends an empty frame so the view tick
moves; a breathing squad sends nothing else. `frame-anchors.test.ts` checks the prediction against the simulation at
every frame tick of the stub sandbox and A9.

### 2.4 Cursor hints and queries

Cursor feedback needs answers several times a second (the path and AP cost under the pointer, the chance to hit, valid
drop targets, ETAs while plotting, enabled menu lines). The original computes them in the UI with the rules'
functions; ja2-node computes them in the browser with the simulation's own code (`src/sim/hints/`, `answerHint`) over
the **player-knowledge projection** (`knowledgeWorld(view, rules)`, `src/sim/knowledge/`: the map, doors as perceived,
seen items, the light, the player's soldiers in full and only the others he sees). The server answers the same kinds
over the projection of the same view, on an unlogged query channel, for agents, server-only answers, the fallback and
verification; client and server agree by construction (same code, same inputs: the engine commit and the rule pack and
scripts hashes of `welcome`). The projection, the kinds, the server-only queries, the channel and fairness are
`29` §28. Commands are validated on the full state, so the only differences are legitimate: a path through a tile
held by an unseen enemy is shown, and the merc stops when he meets him, as in the original.

**The client provider** (`src/app/hints/`). `ClientKnowledge.open(source, identity)` loads the rule content through
`loadClientRules` (`src/app/rules/client-rules.ts`: the pack and scripts hashes from the manifest with SubtleCrypto,
then a strict rule reader with live graphic facts) and the server's loaders (`loadTacticalContent`,
`loadStrategicRules`, the world per map, two maps cached); it is usable when the engine identity Vite injects
(`__JA2_ENGINE__`) and both hashes equal `welcome`'s. `HintProvider` implements `GameClient` (`src/ui/game-client.ts`:
`hint(request)` polled every frame, `pending` until ready; `hintNow`; `query`): a request is answered once it has
rested 80 ms per kind (`PATHFIND_REST_MS`, the original's `PATHFINDCOUNTER`, `Utils/Timer_Control.cc:19`), on the
latest received view (in combat the input lock waits for playback anyway, `30` §3.1), with one projection per view and
answers cached per view (a frame that moved only the tick keeps them); it falls back to the query channel while the
knowledge is unusable or the map is not loaded. The tactical and map hosts open the knowledge after their screen has
loaded. **Shadow mode** (`?shadowHints=1`, on in e2e) also asks the server and compares over the view the client holds
when the reply arrives (`29` §28); `window.__ja2Ui.hints` counts compared, stale, failed and differing answers.

| Hint | Screen use |
|---|---|
| `previewMove` | move cursor, footstep path with AP bands, confirm marker (`30` §3.1, `30` §3.4) |
| `previewAction` | action cursors (door, pick up, talk, give, jump, swap, look, aid) and the walk-up path |
| `estimateAttack` | attack cursors (aim rings, chance to hit, range, reload, throw and launch), the `f` key |
| `exitSector` (`dryRun`), `exitSectorOptions` | exit arrow colour, sector exit dialog (`30` §3.6) |
| `placements`, `itemInfo` | inventory hatches, attach and merge targets, compatible outlines (`30` §2.3); the description box (`30` §2.4) |
| `canEnterSector`, `assignmentOptions`, `previewRoute`, `previewHeliRoute`, `moveBoxOptions` | the map screen |

**Keeping them equal.** The `src/server/hints-*-stub.test.ts` suites and their `-original` twins
(`tests/support/hints.ts`, `hints-actions.ts`, `hints-strategic.ts`) compare client answers (the strict projection
built from the serialised view alone, which throws on every field the view does not supply) with server answers over
sampled points.

**Limitations.** The melee chance to hit is `null` (hidden defender ratings); the exit dry run cannot know mercs
already walking off; stat damage for stat healing (`enable_stat_healing`) is not in the view (`29` §28). The client
loads the tactical content without the stub profiles of a stub campaign (no hint reads them); the client knowledge
loads the rule pack one file after another, and the map and tactical hosts each open their own.

### 2.5 Assets

The user's data is about 34,000 files and 864 MB (speech 390 MB, music 100 MB, STI graphics 170 MB, maps 75 MB, videos
69 MB); a first tactical screen needs about 8–12 MB of STI and map data, a speech line 30–60 KB. The server side (the
manifest `GET /api/assets/manifest`, immutable `GET /vfs/@<hash>/<path>`, plain `/vfs/<path>` with a strong content
ETag, gzip of compressible files, the persisted hash cache) is `04` §5.10. The client side (`src/app/assets/`):

| Module | Content |
|---|---|
| `http-vfs-layer.ts` | `HttpVfsLayer implements VfsLayer` (`src/content/vfs/vfs.ts`) from the manifest, so path normalisation, layering and the stub fallback are the same `Vfs` class as on the server; reads through `/vfs/@hash/path` (ranges with `Range`), 12 requests in parallel (8–16), one fetch per file in flight shared by its readers, a per-read `AbortSignal` (the fetch stops when its last reader leaves) and `abortAll`; `StaleAssetError` on a 404 (the hash changed); `fetchAssetManifest` |
| `asset-source.ts` | `AssetSource`, the replaceable seam (§1.3), and `HttpAssetSource`: the `Vfs` over the layer, the stub text fallback the server's `/vfs` has, `hashOf`, `read`, `readOptional` |
| `page-assets.ts` | `pageAssetSource()`: one source and one manifest request per page; the `src/app/net/vfs.ts` helpers (`fetchVfsFile`, `fetchOptionalVfsFile`, `readVfsFileOrNull`, `fetchVfsList`) read through it, so the world, sounds, music and video come from immutable URLs, a file missing from the manifest answers without a request, a stale hash falls back to the plain URL, and the file list is the manifest's |
| `asset-cache.ts` | `AssetCache`: values by (content hash, decoder name), LRU by bytes (256 MB), loads shared while in flight, raw bytes reused by decoders; `loadDecodedAsset`. Decoding is cheap (a tileset's ETRLE frames in 17–53 ms), so the persistent layer is the HTTP cache |
| `preload.ts` | `preloadAssets(source, paths, {cache, signal, onProgress})` → loaded and missing paths, progress per file; the loading screens' bar follows it (`30` §1.10) |

`UiAssets` (`src/app/game/ui-assets.ts`, the `ImageCatalog` of `src/ui/assets.ts`) loads STIs, fonts and PCX (as opaque
RGB565) through the cache and registers RGB pictures the client composes (`addRgb`: the overhead map, the map board).
A screen's assets are the ones its layouts reference (`src/ui/layout/references.ts`), preloaded before the screen
enters. Every content loader takes a `ReadFile` and the audio engine a `load(path)`, so a local folder source needs no
loader change.

### 2.6 Resolution and scaling

Stracciatella keeps every fixed screen at 640×480 centred at `STD_SCREEN_X/Y` with black around it, extends only the
tactical viewport (`(0,0)–(W, H−120)`) and centres the tactical bottom panel, with 6–12 team slots by width
(`UILayout.cc:57-138`, `:167-176`; `squad_size` 6 in `game.json:95`). ja2-node adopts that model with an integer
**UI scale** (`src/ui/resolution.ts`, `resolveResolution`):

- Auto scale = `min(⌊W/640⌋, ⌊H/480⌋)`, at least 1 (the largest integer that keeps 640×480); a forced scale from the
  client setting `uiScale` (0 = auto) or `?scale=` (at most 8). Logical size = `⌊canvas / scale⌋`, at least 640×480;
  `STD_SCREEN_X/Y` = `⌊(logical − 640×480) / 2⌋`. 1920×1080 → scale 2, logical 960×540 (tactical viewport 960×420);
  2560×1440 → 3, 853×480; 1280×720 → 1.
- The "640×480 only" option (`fixed640`, `?fixed640=1`) keeps the logical size at 640×480 on every screen, the tactical
  screen pillarboxed too.
- Fixed screens are laid out in the `std640` frame; the few full-screen elements (main menu buttons and copyright,
  message box centring, tooltips) use the logical screen (§3.10).
- The frame is drawn into a framebuffer at the logical size (`src/render/ui-draw/logical-framebuffer.ts`), copied into a
  canvas of the same size, and the browser scales the canvas (`image-rendering: pixelated`) to exactly
  `logical × scale` device pixels inside a full-window `#stage`, at an offset whole in both CSS and device pixels
  (`alignedOffset`: Chrome and WebKit place a canvas at whole CSS pixels). When even 640×480 at scale 1 does not fit,
  the canvas is shrunk to fit (nearest). `tests/e2e-browsers/presentation.spec.ts` checks every device pixel against
  the logical capture in Chromium and Firefox at fractional pixel ratios (§5).
- The stage takes the pointer events and fullscreen; pointer coordinates go through the inverse transform (`toLogical`);
  `setPointerCapture` keeps a release outside the stage.

The viewport size never reaches the simulation. A sharp-bilinear fit for non-integer scales is not built.

### 2.7 World renderer

The tactical world renderer (`src/render/world/`, fed by `TacticalWorldView`, `src/app/world/tactical-world-view.ts`,
and the per-session world presenter, `src/app/tactical/world-presenter.ts`) draws the original's passes, z values and
shading as `05` specifies; the client's lighting is `20` §8.

| Part | Implementation |
|---|---|
| Atlas | `src/render/array-atlas.ts`: one `TEXTURE_2D_ARRAY` of R8UI layers (4096², or `MAX_TEXTURE_SIZE`) per world, shelf-packed, grown by re-creating the array; tiles and soldier sheets share it and one growable palette texture (`palette-rows.ts`), so the world never switches textures |
| Static scene | `static-scene.ts` builds the map once into eleven segments kept per row: land, objects, shadows, structs (with the wall strips), strict strips (non-wall multi-Z, `<`), roofs, on-roof, topmost (wireframes), and the obscured pass (dithered, dithered multi-Z, depth-writing). Every segment writes depth and z modulo 8 is the sublayer (structs 4, items 1, roofs 5, on-roof 6, topmost 7), so sprites of different segments never tie and the original's per-row interleaving comes out in any order; ties inside a segment keep the sweep order; strict strips go last because a strict sprite loses every tie (deviations "Show-through order", "Sweep window"). Positions are camera-free; camera, render height and viewport are uniforms; each frame draws the instance ranges of the visible rows. Doors and revealed rooms rebuild only their rows (`changedRevealTiles`); the tree-top, wireframe and roof-level options rebuild all |
| Draw path | `world-program.ts`: sprites pulled by `gl_VertexID` from an RGBA32F data texture (three texels per sprite) with plain `drawArrays`; the shade from a 160×160 RG8UI texture (land and roof shade per tile) or fixed per sprite. No instancing: SwiftShader (headless Chromium without a GPU, CI) pays per instance. `world-framebuffer.ts`: colour and 24-bit depth at the logical size; `picture-memo.ts` skips, shifts or partially redraws a frame (§6.2) |
| Dynamic pass | `dynamic-scene.ts`, over the visible rows' tiles with dynamic content: the item pass (at most two items per pool, dithered `<=` then depth-writing `>`, outline on index 254), then per row: dynamic objects, dynamic shadows, roof soldiers (`STRUCT_MERCS`), ground soldiers, dynamic structs; dynamic roofs, roof soldiers again (`HIGHMERCS`, as the original draws them twice), dynamic on-roof; topmost. A soldier is three sprites (shadow index 254 multiplied where `zbuf < z`, body where `zbuf <= z`, dithered body where `zbuf > z`) at the merc z, the on-roof z for `level > 0`, or 32767 at the glow peak; on a tile whose last structure is a single-tile non-wall one (`MAPELEMENT_EXT_NOBURN_STRUCT`), 2 nearer and without the dithered part. Multi-tile soldiers (prone mercs, vehicles, the tank, large creatures) go to the struct-merc pass at their animation structure's z with its z strips |
| UI nodes | `WorldUiNode {gridNo, layer: object \| roof \| onRoof \| topmost, tile, head?, offsetX?, offsetY?, shade?}` merged into the dynamic pass of its layer and tile (the markers of `30` §3.4), at the layer's z (`OBJECTLAYER_USEZHEIGHT` objects at `8·wy`, topmost 32767), shade 4 by default. Animated tiles show `animationFrames[⌊clock / 200 ms⌋ mod n]` |
| Camera, picking | `camera.ts`: `ApplyScrolling` with the tile-centre snap, the scroll rectangle of restriction 0 and 1 and `setRenderCenter` (`05` §1.4). `picking.ts`: the soldier whose drawn frame has an opaque, non-shadow pixel under the pointer, topmost sprites first; tiles by `screenToGridNo` (`05` §7) |
| Lighting | `src/app/world/world-lighting.ts` runs the simulation's lighting over the client's own `TacticalWorld`: the view's ambient and dynamic light sprites, the map's lights for the hour, doors as perceived. A tile's shade = `natural − strongest light` (`LightAddTileNode`'s `ubMaxLights`, not the gameplay sum); map lights cached per (hour, ambient, doors), merc lights added per frame (`light-templates.ts`); the map's light colour tints tiles and soldiers. The client keeps the map's original structures, so a wall destroyed by a grenade does not let a lamp's light through on the client |
| Soldiers | `src/app/world/soldier-scene.ts`: sheet and frame (§2.3); palette rows per soldier palette (16 shades, 20 red glow, 20 orange roof glow); own mercs personally lit at shade 3 unless "merc casts light" at night, others the land or roof shade of their tile, then `max(shade − 2, 4)`; the glow (`src/render/world/glow.ts`: 30 frames of 100 ms, hostiles on our turn or under AI control, topmost at frame ≥ 7, grey offset 10 when the selected merc does not see the soldier; `glow-context.ts` takes `hostile`, `sees` and the AI baton holder from `aiTurn` events); the fades (`soldier-fade.ts`: a newcomer of another team from shade 12 down, a soldier who left the view up to 12 at his last tile, 60 ms a step) |
| Fog of war | `reveal.ts`: the view's `revealedRooms` as the original's node flags (`SetGridNoRevealedFlag`: `FIRSTROOF…FOURTHROOF` hidden, A-frame walls on the tile and its south and east neighbours hidden, obstacles and slanted roofs shown through) and the wireframes of `CalculateWorldWireFrameTiles`; hidden roofs reappear at the roof interface level. Options (`src/app/world/display-options.ts`): tree tops (FULL3D trees as their trunk frame), wireframes, roofs, item glow (a static white or yellow outline when off), merc casts light, merc always lit |
| Items, corpses, smoke | items with the item tables' `tileGraphic` (`item-tiles.ts`) at `8·wy + 1` or the on-roof z, raised by `height`, hidden when `notRendered`, outlined with the 20-step white (red, yellow on roofs) cycle. `world-effects.ts`: corpses at the start frame of their direction block (vehicles loop at 150 ms) with `CreateCorpsePalette`'s palette in 16 shaded rows, z strips and shadow pixels; smoke tiles cycle 12 frames from a per-tile start and delay as a 50 % blend (deviation "Translucency"), static and opaque with "animate smoke" off |
| Tile changes, blood, bullets, effects | `tile-changes.ts` applies the view's `tileChanges` (`29` §7) to the struct and on-roof layers, updates the touched tiles' level render data and reveal state and rebuilds only their rows (windows crack and shatter, wrecked structures go, the O3 statue opens); blood pools from the view's `blood`; bullets and thrown objects (`bullet-nodes.ts`, `src/app/net/bullet-track.ts`) and impact, trail and explosion animations (`effect-animations.ts`) as `05` describes |

**Limitations.** Known mines and bombs have nothing to show (gaps "Map items", "Duds and timed bombs"); the
helicopter's pieces on the map need the simulation (gap "Helicopter on the map"); the cover and line-of-sight
tiles (`LEVELNODE_REVEAL`) are not drawn; the stub world has no pointer tiles, so cursor markers draw only on the
original data (§4).

### 2.8 Module map

| Path | Layer | Content |
|---|---|---|
| `src/ui/` (`screen.ts`, `runtime.ts`, `clock.ts`, `services.ts`, `resolution.ts`, `draw-list.ts`, `assets.ts`, `settings.ts`, `message-boxes.ts`, `game-client.ts`, `speech.ts`, `diagnostics-overlay.ts`) | ui | screen and modal stacks; `UiRuntime` (regions, buttons, sliders, fonts, images, sounds, cursor, clocks; held keys polled from it); UI scale; draw list; client settings; `MessageBoxes`; `GameClient`; `SpeechPresenter` (`30` §2.8); the Ctrl+F overlay |
| `src/ui/input/`, `text/`, `widgets/`, `cursors/`, `layout/` | ui | §3.1–§3.10 |
| `src/ui/screens/` | ui | controllers: `front-end/`, `tactical/` (`input/`), `talk/`, `shop/`, `map/`, `battle/`, `laptop/`, `help/`, `story/`; `contracts.ts`, `gallery.ts`, `credit-roll.ts`, `test-pattern.ts` |
| `src/ui/saves/`, `src/ui/client/` | ui | save controller and rows, campaign form, REST types, `FrontEndClient`, failure texts (shared with the launcher) |
| `src/render/ui-draw/` | render | draw list → batches (§3.11) |
| `src/render/world/`, `src/render/array-atlas.ts` | render | the world renderer (§2.7) |
| `src/app/game/` | app | `/play`: boot, `GamePage`, frame loop, DOM input, `UiAssets`, `UiAudio`, the hook, the front end with its client and music, `ModalPause`, settings store, help and story hosts, diagnostics |
| `src/app/net/` | app | `SessionClient`, the `/vfs` helpers, quick-save keys, sleep/wake stop, `PageMusic`, bullet track |
| `src/app/assets/`, `src/app/rules/`, `src/app/hints/` | app | asset source, layer, cache, preload (§2.5); client rules; `ClientKnowledge`, `HintProvider` (§2.4) |
| `src/app/world/` | app | world loading, soldier assets, frames and scene, lighting, effects, glow, radar, display options, `TacticalWorldView` |
| `src/app/tactical/`, `map/`, `laptop/`, `battle/` | app | the per-session hosts of the tactical screen, the map screen, the laptop and battle entry |
| `src/app/sound/`, `media/`, `video/`, `credits/`, `launcher/` | app | `TacticalSound`, `StrategicSound`, `loadAsset`, the video player, the launcher and its DOM credits scroller |
| `src/sim/knowledge/`, `src/sim/hints/` | sim | projection and hint functions (`29` §28) |
| `src/content/anim/` (`timelines.ts`, `schedule-track.ts`), `src/content/rules/`, `src/content/text/font-colors.ts`, `src/content/picture/shaded-palette.ts` | content | split scripts and schedule track; the rule pack; font colours; shaded palettes |
| `src/devtools/ui-gallery/` | devtools | the widget gallery |
| `data/layouts/original/`; `data/tables/ui-constants/`, `cursors.json`, `ui-cursors.json`, `mlg.json`, `load-screens.json` | data | the layouts; tables generated by `tools/transcribe/ui-constants.ts`, `cursors.ts`, `ui-cursors.ts`, `mlg.ts`, `load-screens.ts` |
| `stubs/ui/` | stubs | the layout-driven stub skin (`skin.ts`), cursors, faces, items, radar maps, load screens, the strategic map board (§4) |

Server modules the screens rely on: `src/server/query.ts` (`29` §28), `rule-pack.ts` and `assets-manifest.ts`
(`04` §5.10), `frame-anchors.ts` (`04` §4.4), `message-entries.ts` (`29` §8), `item-catalogue.ts` (`29` §29).

---

## 3. Foundation

The original's foundation is small (`MouseSystem.cc` 961 lines, `Button_System.cc` 1,628, `Font.cc` 322, `WordWrap.cc`
552, `Cursor_Control.cc` 404, the shared widgets about 3,000) and used everywhere: outside the editor, 208 region
definitions in 64 files, 124 button creations in 65 files, 94 tooltips. ja2-node ports it into the DOM-free `ui`
layer; every rule below has unit tests with scripted event sequences (`src/ui/**/*.test.ts`, on the stub fonts in CI
and the original fonts with `JA2_DATA_DIR`), and the devtools widget gallery (`/src/devtools/ui-gallery/`, layout
`gallery.json`, `?skin=`, `?scale=`, `?pinClock=1`) shows each widget.

### 3.1 Mouse regions (`src/sgp/MouseSystem.cc/.h`)

`RegionDispatcher` (`src/ui/input/regions.ts`) ports `MSYS_UpdateMouseRegion`:

- One region list by priority; among equal priorities the **newest wins** (message box buttons rely on it). The hit
  test includes the bottom-right edge (a region reacts one pixel beyond its art).
- Disabled regions take no input; `allowDisabledTooltip` captures the pointer without callbacks; a hidden region is
  disabled and not drawn.
- MOVE, GAIN and LOST go to the movement handler of the top region only; button reasons (left/right/middle down, up,
  repeat, wheel) are OR-ed into one call.
- A press locks button events to the pressed region; a release over another region is swallowed, and the lock survives
  a release over no region. The left-up hook runs before dispatch (`ReleaseAnchorMode`).
- Double click = down-up-down on the same region within 400 ms; a held button repeats after 250 ms, then every 50 ms,
  at most once per frame; both come from raw down/up and the injected clock, never from `dblclick` or OS repeat.
- Cursor: the region's, or with `NO_CURSOR` that of the next enabled region below that has one.
- Callbacks may create and delete regions: dispatch runs over a snapshot and rechecks existence.
- The list is hit-tested again on the next frame after any region change (the original does it only on a mouse move or
  `RefreshMouseRegions`), so a region that appears under a still pointer takes effect at once (deviation "Mouse region
  refresh").

Browser glue (`src/app/game/dom-input.ts`): `contextmenu` and middle/X-button navigation suppressed, `wheel`
non-passive, pointer capture and coordinates as in §2.6. No touch input.

### 3.2 Tooltips (fast help)

`FastHelp` (`src/ui/input/tooltips.ts`; `RenderFastHelp`, `DisplayFastHelp` of `MouseSystem.cc`): shown after the
pointer rests 600 ms with no button down, reset by a click; the original's size, placement and clamping to the screen;
a double-framed box with the interior darkened twice; `FONT10ARIAL` with the tokens `|` bold gold 146, `^` light green,
`~` light red, beige otherwise. Drawn only over screens that declare `rendersTooltips` (never over a message box), on
the frame its timer runs out (the original registers the background first and draws a frame later).

### 3.3 Buttons (`src/sgp/Button_System.cc`, `Button_Sound_Control.cc`)

`ButtonSystem` (`src/ui/widgets/button.ts`, `button-sounds.ts`):

- An image names five frames of one STI: grayed, off, off-hover, on, on-hover (`LoadButtonImage`); its size is the
  largest offset + size of the frames used.
- Kinds: quick (anchoring), quick without move, NEWTOGGLE, check box, hot spot (a region with button semantics), label;
  text with the inset clip, the `-1` sub-offsets, hilite and down colours and the one-pixel shift while pressed,
  wrapped text, icons. Slot order as the original; a hidden button's region is disabled; deletion inside a callback is
  deferred.
- A click fires on release over the button where the press started; dragging off and back plays the switch sounds
  (`QuickButtonCallbackMButn`'s StateBefore/StateAfter logic).
- Disabled: the grayed frame, or the styles `DEFAULT`, `HATCHED` (black checkerboard), `SHADED` (×0.48), `NONE`; check
  boxes show the hilite frames plus the hatch.
- Sounds by scheme, chosen from the current screen's `soundScreen` when the button is created
  (`Button_Sound_Control.cc:9-52`); a click on a disabled button plays `sounds/disabled button.wav` at volume 15.
- The generic `genbutn` art (editor and debug buttons) is not built; labels draw their text only.

### 3.4 Fonts and text

**Fonts.** `InitializeFonts` (`Utils/Font_Control.cc:34-62`) loads 16 STIs from `fonts/` (a 17th, `hugefont.sti`, only in the English editor, `:54-57`): `FONT10ARIAL`,
`FONT10ARIALBOLD`, `FONT12ARIAL`, `FONT12ARIALFIXEDWIDTH`, `FONT12POINT1`, `FONT14ARIAL`, `FONT14HUMANIST`,
`FONT16ARIAL`, `BLOCKFONT` (`MILITARYFONT1`), `BLOCKFONT2`, `BLOCKFONTNARROW`, `COMPFONT`, `SMALLCOMPFONT`,
`LARGEFONT1`, `SMALLFONT1`, `TINYFONT1`. `FontSet` (`src/ui/text/fonts.ts`) maps the macros to files through the
generated `Font_Control` table; `bitmap-font.ts` reads glyph metrics from a font STI and the glyph table. The stub pack
aliases all of them to two Terminus-derived stub fonts with Latin, Polish and Cyrillic glyphs (`stubs/fonts.ts`,
`32` §1.6).

**Glyphs.** One translation table per data version maps a code point to a glyph index for all fonts
(`src/sgp/Font.cc:163-173`; `src/content/text/glyph-table.ts`). A code point the table lacks and an index past the
font's glyph count draw `'?'` (the block fonts and `font14humanist` have one glyph fewer than the English table's
maximum).

**Colours.** Glyphs carry their drop shadow as pixel value 1; every other non-zero value is ink. Text is printed with
the mono-shadow rule: 0 → background or transparent, 1 → shadow or nothing, else foreground
(`VObject_Blitters.cc:236-345`). Colours are 8-bit palette indices resolved through the palette of the **current font**
(`Font.cc:51-80`); the font palettes differ in a few indices, so colours are resolved per font. `resolveFontColors`
(`src/content/text/font-colors.ts`, the indices of `Utils/Font_Control.h:48-93`, `NO_SHADOW` = 0, `DEFAULT_SHADOW` = 2)
applies two black rules ("black" = 0 in 16 bits): a non-zero shadow index whose colour is black stays visible as
near-black `0x000008`; a background index whose colour is black is transparent. A shadow colour resolves through the
font of the text (the original: through the font current at `SetFontShadow`). The stub font palette names the
`Font_Control.h` colours with authored RGB values; its `DEFAULT_SHADOW` is black, so stub text exercises the near-black
rule.

**Measuring and alignment** (`src/ui/text/measure.ts`, `print.ts`). Advance = width + x offset, no kerning
(`Font.cc:93-110`); `CenterAlign` = `x + (w − len + 1) / 2`, `RightAlign` = `x + w − len`, `HCenterVCenterAlign`,
`HRightVCenterAlign`, all C integer division (`:295-322`). `DrawTextToScreen` centres with `(w − len) / 2` without the
+1, wraps the position as UINT16 and keeps the shadow from the previous call, so layouts give the shadow explicitly;
`TEXT_SHADOWED` draws a `ShadowRect` behind the text; `ReduceStringLength` truncates with up to three dots.

**Word wrap** (`wrap.ts`). `LineWrap` (`Utils/WordWrap.cc:33-96`, Stracciatella's rewrite) breaks at spaces (the break
space is dropped), after hyphens and before any code point ≥ U+4E00; a word longer than the line is split where it
overflows. Quirks kept: the overflowing character of a split word is not counted, and CJK text breaks one character
early. `DisplayWrappedString` line height = font height + gap. `IanDisplayWrappedString` / `IanWrappedStringHeight`
(`:180-524`) wrap by words with the in-text codes 177 newline, 178 bold toggle (`FONT10ARIALBOLD`, shadow off), 179
centre, 180 colour (always 184), 181 default colour; the height pass does not consume 180's argument. Message boxes,
popups, mail and laptop pages use them, and mail and files break into pages by the measured height, so the measure is
exact. `CleanOutControlCodesFromString` strips the codes.

**Numbers, money and text sources.** `printf.ts` formats the string tables' printf templates; `SPrintMoney`
(`money.ts`) puts the minus after the dollar (`$-1,234`, `Laptop/Finances.cc:954-979`); weights follow the metric
option (`weight.ts`); EDT fields come from `edt-text.ts` (`{edt: [file, field]}`, the field index flattened over the
record's columns); strings from `text-service.ts` (the L10n tables of `data/externalized/strings`, `31` §3).

**Language-dependent art (MLG).** 33 pictures with baked-in text (main menu buttons, the options and save/load
headers, the PBI panel, the map screen's sort buttons, 27 laptop pictures) are chosen by the **data version**, not the
display language (`GameRes.cc:70-308`; `data/tables/mlg.json` from `tools/transcribe/mlg.ts`). Layouts name the MLG id,
never a path; with a display language other than the data's, these pictures keep the data's language (`31` §3.2).

### 3.5 Cursors (`src/sgp/Cursor_Control.cc`, `Utils/Cursors.cc`)

- `CursorFileDatabase` (68 STIs, `Cursors.cc:21-97`) and `CursorDatabase` (140 cursors, `:111-1168`): up to five
  composite images per cursor (file, frame, position or centred or hidden), hot spot, flags (flash, flash2, conditional
  sub-cursor, delayed start, sound); transcribed by `tools/transcribe/cursors.ts` into `data/tables/cursors.json` with
  the extern item file. The tactical `gUICursors` table (UI cursor → mouse cursor, world tile and flags) is
  `data/tables/ui-cursors.json` (`tools/transcribe/ui-cursors.ts`).
- `CursorState` (`src/ui/cursors/cursor-state.ts`): `LoadCursorData` (size from the composites, hot spot and centred
  sub-cursors resolved once), hidden sub-cursors, `CURSOR_TO_FLASH`, `FLASH2` and conditional composites with
  `SetCursorSpecialFrame`; animated files (`AUX_ANIMATED_TILE`) advance every 150 ms and flashing cursors toggle every
  250 ms, only over regions that ask (`animatesCursor`, `flashesCursor`); a `DELAY_START_CURSOR` cursor shows nothing
  for its first second; `VIDEO_DEFAULT_TO_NO_CURSOR`.
- Text in the cursor (`DrawMouseText`, `Cursors.cc:1276-1388`): `TINYFONT1` white, only over regions with
  `showsMouseText`: hit location, interactive tile names, chance to hit, AP cost (an invalid cost flashes).
- The item in hand is the cursor: the extern entry with index 254 skipped and the hot spot in its middle; thrown items
  are outlined green.
- **Software cursor**: composed every frame and drawn last, clipped to the cursor's size, with `cursor: none` on the
  stage; hidden when the pointer leaves the stage and on screens that hide it (fades, loading screens, the San Mona and
  black screens). A CSS cursor cannot scale with the canvas or carry live text.

### 3.6 Shared widgets

| Widget | Original | ja2-node |
|---|---|---|
| Popup box and menu | `Utils/PopUpBox.cc` | `PopupBox` (`src/ui/widgets/popup-box.ts`): the background cropped, 2×2 corners, 16×2 and 2×8 edge pieces with the overlapping last piece, the line states (normal, highlight, shade, secondary shade), the second column, auto-resize; `PopupMenu`: line regions at `HIGHEST − 4` over a screen mask that closes it on an outside click. Used by the map screen's assignment menus, the tactical movement and door menus |
| Merc popup box (text box) | `Utils/MercTextBox.cc` | `MercTextBox`: `PrepareMercPopupBox` sizes with the 349×199 cap (the height clamped at 199 instead of throwing), 10-pixel border tiles over a tiled background, Ian wrap, the styles BASIC (`interface/tactpopup.sti`), red-on-white, blue-on-grey, laptop, I.M.P., icons, colours by background. Subtitles, message boxes, civilian quotes, laptop popups |
| Message box | `MessageBoxScreen.cc` | `MessageBox` (`message-box.ts`, a modal, `30` §1.6): 300 wide with margins 40/10/30, centred on the screen or a rectangle, a full-screen `HIGHEST` back region with the style's cursor, every button set at the original positions, its keys as a hotkey table on release, the UI clock paused, `pauseGame` called (§1.4), the screen frozen under it (its draw list, not pixels), its buttons sounding with the underlying screen's scheme. No pointer warp onto a button (deviation "Pointer warp") |
| Slider | `Utils/Slider.cc` | `Slider`: both styles, thumb `interface/sliderbox.sti`, range 0–127, the off-region drag from the pointer's y, wheel steps, the inverted value, `SetSliderValue` ignoring the maximum |
| Text field | `Utils/Text_Input.cc` | `TextFieldGroup`: the default bevel scheme, full text and numeric filters, selection, caret keys, Tab order, Ctrl+Delete, unmodified keys swallowed while editing, the caret on the UI clock, `ENTERING_TEXT`/`REMOVING_TEXT`; no editor input types (deviation "Text input") and no IME (gap "IME composition") |
| Progress bar | `Utils/Animated_ProgressBar.cc` | `ProgressBar` (the load bar and the panel style), driven by the client's preload (`30` §1.10) |
| Fade | `Fade_Screen.cc` | `Fade`: 11 steps out then black, 9 in, 16 ms each on the UI clock; a step multiplies the frozen frame by 0.8^k once instead of k shade-table passes (deviation "Fades"); no cursor during a fade |
| Snapshot zoom | laptop open/close (`Laptop/Laptop.cc:1048`, `:1430`), A.I.M. video window, autoresolve opening, sector change (`Strategic/StrategicMap.cc:227-237`) | `SnapshotZoom`: render-to-texture (the `capture` and `snapshot` draw items) with `BltStretchVideoSurface`'s stepping in the shader; the 2 s sector-change zoom is not built |
| Drop-down, frame animator, portrait, item picture | laptop pages | `drop-down.ts`, `frame-animator.ts`, `portrait.ts` (a face by index and size, dead faces shaded, unavailable ones under `ShadowRect`), `item-picture.ts` (the inventory graphic centred in a cell, optional shadow) |

### 3.7 Screens, modals and frame order

The original switches whole screens (`ScreenIDs.h`, `Screens.cc:20-48`) with per-screen entry and exit flags inside
`HandleScreen`, pseudo-screens for message boxes and fades, a 16-bit frame buffer with dirty rectangles, background
save/restore rectangles and a save buffer. ja2-node keeps the observable rules and drops the mechanism:

- the screen and modal stacks of §2.2; leaving a screen deletes its widgets and regions; the screen under a message box
  neither updates nor takes input but stays visible (its frozen draw items);
- the whole draw list is rebuilt every frame from the retained widgets; no dirty rectangles, background rectangles or
  save buffers (an unchanged frame is not presented, §6.2);
- one draw order (`UiRuntime.frame`): the screen's background and content, the modals, tooltips, the diagnostics
  overlay, the cursor. A screen also declares `soundScreen` (the button sound scheme), `rendersTooltips`, `drawsWorld`
  and `describe()` (the hook's widget list).

### 3.8 Keyboard and hotkeys

- Events from `keydown`/`keyup` (`src/ui/input/events.ts`): `repeat` → a repeat event; the key from `event.key` when it
  is printable ASCII (lower-cased), else from `event.code` (a Latin fallback for non-Latin layouts, like SDL3); the
  keypad by `code` unless NumLock is off; keypad Enter is Enter; modifier masks Shift 1, Ctrl 2, Alt 4
  (`src/sgp/Input.h:33-35`); text events from printable keys without Ctrl or Alt.
- **Hotkeys as data** (`src/ui/input/hotkeys.ts`), per layout and per modal: key, phase (down, up, repeat), exact
  modifier mask or `any`, action, optional condition. The original hard-codes whether each hotkey fires on key-down or
  key-up and which exact modifiers it needs; the tables keep both, which also makes remapping and other layouts
  possible (there is no remap UI). The tactical keys are code that follows `GetKeyboardInput` (`30` §3.3).
- Text fields get keys first and swallow them while editing; held keys and modifiers are polled from `UiRuntime` for
  tactical cursors and actions.
- Browser collisions: Ctrl+W, Ctrl+T, Ctrl+N and Ctrl+Tab cannot be overridden; every other key is `preventDefault`-ed
  except with Meta. Alt+Enter on release toggles fullscreen and takes the Keyboard Lock (Chromium, fullscreen only), so
  that Esc reaches the game instead of leaving fullscreen. Scroll Lock (Pointer Lock) and a Print Screen PNG are not
  built.

### 3.9 Widget vocabulary

Layout widget types (`src/ui/layout/schema.ts` lists their properties; every type takes `id`, `x`, `y`, `anchor`,
`within`, `centerX`, `visible`):

| Type | Original |
|---|---|
| `image` (asset or choice, frame, palette shade row, effect normal / outline colour / outline shadow, clip, centre) | `BltVideoObject` |
| `fill`, `shade` (factor 0.48 or 0.8), `hatch`, `line`, `rect` | `ColorFill`, `ShadowRect`, the hatch blitters, `LineDraw`, `RectangleDraw` |
| `text` (source, font, colour, shadow, background, align, valign, wrap, Ian codes, ellipsis, `TEXT_SHADOWED`) | `DrawTextToScreen`, `DisplayWrappedString`, `IanDisplayWrappedString`, `MPrint` |
| `frame`, `textBox` | PopUpBox borders, `PrepareMercPopupBox` |
| `region` (priority, cursor, tooltip, enabled, actions, `animatesCursor`, `flashesCursor`, `mouseText`, `fit`) | `MSYS_DefineRegion` |
| `button` (frame set, kind, text, icon, disabled style, sound scheme, checked) | `GUI_BUTTON` |
| `group`, `slider`, `textField`, `popupMenu`, `progressBar`, `modal` | check box arrays, `AddSlider`, `AddTextInputField`, PopUpBox, `Animated_ProgressBar`, `DoMessageBox` |
| `list`, `repeat` | mail list, save rows, sector inventory, merc lists |
| `custom` (renderer id, parameters) | tactical viewport, strategic map, radar, faces, inventory slots, item description, video, credits |
| `tiles`, `portrait`, `itemPicture`, `dropDown` | laptop pages |

Not placed by layouts: the tooltip renderer, the software cursor, the region dispatcher, the modal stack, fades and
snapshots.

### 3.10 Layout format

**Files.** `data/layouts/original/<screen>.json`, one per screen, panel or laptop page, validated by
`src/ui/layout/schema.ts` (top-level `@derived`, `@src`, `screen`, `frame`, `debug`, `constants`, `assets`, `styles`,
`widgets`, `hotkeys`, `tooltips`, `sound`, `unsupported`). Coordinates come from Stracciatella's constants, so the
layouts are SFI-SCLA-derived: each carries `"@derived": "Jagged Alliance 2 source code (SFI-SCLA) via JA2
Stracciatella"` and `"@src"` (the source functions and lines). Numbers are referenced by name from **generated**
tables: `tools/transcribe/ui-constants.ts` extracts the `#define`, `static const`/`constexpr` and enum values of the
listed sources into `data/tables/ui-constants/<file>.json` (the shared tables in `SHARED_CONSTANT_TABLES` of
`src/ui/layout/constants.ts`, each screen's sources in the transcriber's `SCREEN_TABLES`; `Timer_Control` gives the
counter intervals as `<COUNTER>_MS`). Positions are evaluated with `STD_SCREEN_X/Y` = 0 (inside std640) and the names
that contained them are listed in `stdScreen`; constants written relative to `INTERFACE_START_X/Y` or
`INV_INTERFACE_START_Y` are stored panel-relative; `FROMRGB` colours are read as RGB. A literal is allowed where the
source has an inline literal, with the line in `@src`. Layouts never contain original data; the stub skin overrides
assets, not positions.

**What the format expresses** (`LayoutModel`, `model.ts`; `LayoutView`, `view.ts`):

1. **Frames and anchors** (`frames.ts`): `std640`, `screen` (the logical screen), `viewport` (`(0,0)–(W, H−120)`),
   `tacticalPanel` (`INTERFACE_START_X/Y`) and `tacticalInventory` (`INV_INTERFACE_START_Y`), both centred by the
   `UILayout` formulas; per-widget `within` (another frame), nine anchors, `centerX: "screen"` (centred on the logical
   screen, the y in std640). A `LayoutView` may take a run-time `origin` (the talk panel, the help screen).
2. **Numbers**: integers, constant names, or integer expressions with `+ − * / %` and parentheses (C division) over
   them and `$screenWidth`, `$screenHeight`, `$slotsWidth` and the repeat variables (`$i`); names resolve through the
   layout's tables, then the shared ones (`ConstantScope`); priorities likewise (`HIGH+10`).
3. **Assets**: `{sti}`, `{pcx}` or `{mlg}` (per data version), each with a stub size; frames; button frame sets
   `{grayed, offNormal, offHilite, onNormal, onHilite}`; **choices** `{by, map}` for numbers, palette colours, frames
   and assets (a row's state picks its colours, a picture id the loading screen); clipped (`clip`) and centred
   (`center`) images.
4. **Fonts and colours**: fonts by macro; palette indices resolved through the font (named constants, the palette bases
   `white` and `grayRamp`), RGB for fills; the shadow always explicit.
5. **Text**: `{key: [table, index]}`, `{format, args}`, `{bind}`, `{edt: [file, field]}`, `{money}`, `{literal}` (debug
   layouts only).
6. **Input**: priority, cursor by `CursorTypeDefines` name (or a choice by a bound state), tooltip, actions per event
   (`primary`, `secondary`, `down` (the primary callback on mouse down), `press` (down and repeat), `doubleClick`,
   `repeat`, `secondaryRepeat`, `wheelUp`, `wheelDown`, `hover`) with arguments, sound scheme.
7. **Repeats**: `repeat`/`list` with a count (number or binding), `start`, `dx`/`dy` and a template, rebuilt when the
   count changes.
8. **Conditions**: `visible`, `enabled`, `checked` as a binding, its negation, `{eq: [a, b]}` or `{not}`; no expression
   language.
9. **Order**: draw order = document order; input order = priority, then later in the document wins (newest-first).
10. **Hotkeys**: `{key, on: down|up|repeat (or a list), mods, action, when?}`.
11. **Custom widgets**: the parameters their renderer needs (slot tables, spacing, panel origin) and the repeat
    variables; stub styles (`hollow`, `checker`) guide the stub generator.

`LayoutView` builds the live widgets and rebuilds them on a resolution change; `LayoutScreen` hosts one as a `Screen`;
`references.ts` collects assets with frames and button states, fonts, cursors, string keys, EDT files, bindings and
actions (for preloading, the stub skin and the contract test).

**Bindings contract.** Each controller exports typed `actions` and `bindings`; `src/ui/screens/contracts.ts` maps
layouts to controllers. `src/ui/layout/layouts-contract.test.ts` loads every layout of every skin and checks the schema,
bindings and actions both ways (or `unsupported`), provenance, literals only in debug layouts, an explicit shadow on
every non-debug text, a stub size on every asset, known fonts, cursors and string keys (`data/tables/l10n.json`), and
every asset, frame and EDT file on a built stub pack; with `JA2_DATA_DIR`, every asset and frame on the original data
and the PCX backgrounds at least as large as the boxes the code sizes by constants (structure only, no image written).
Another skin may use other frames, RGB colours, and combine, hide or move widgets, but must call the same actions.

### 3.11 Blit effects

The draw list (`src/ui/draw-list.ts`) holds `image` (asset key = VFS path, frame, position, palette shade, effect),
`glyphs` (font, positioned glyphs, foreground/shadow/background indices), `fill`, `rectangle`, `line`, `shadow`,
`hatch`, `clipPush`/`clipPop`, `capture` and `snapshot`; builder arguments follow the original functions' coordinates.
`src/render/ui-draw/` draws it: one instanced program (`ui-shader.ts`), a GPU-free planner (`ui-plan.ts`, unit-tested)
that batches by atlas page, RGB565 texture, blend and scissor, one buffer upload per frame. Images and glyphs share one
R8UI atlas (`TextureAtlas`) and the `PaletteTexture` rows (one per image and shade).

| Effect | Original | ja2-node |
|---|---|---|
| Transparent indexed blit through the object's palette | `BltVideoObject` (`src/sgp/VObject.cc:228-246`) | indexed shader |
| Shaded palette (scale or luminance tint) | `Create16BPPPaletteShaded` (`src/sgp/HImage.cc:96-127`): dead and greyed faces, laptop portraits, autoresolve | extra palette rows (`src/content/picture/shaded-palette.ts`) |
| Mono-shadow text | §3.4 | glyph pixels 0/1/other select background/shadow/foreground, alpha 0 = none |
| Solid fill, right/bottom exclusive | `ColorFillVideoSurfaceArea` (`VSurface.cc:190-214`) | quad |
| Darken rectangle ×0.48, inclusive | `ShadowRect` (`VSurface.cc:131-148`): disabled buttons, tooltips (twice), `TEXT_SHADOWED`, map dimming, popup backdrops | multiply blend by `⌊255·f⌋/255` like the SDL colour mod (0.48 → 122/255) |
| Darken ×0.8 | the low-percent shade table: fades, splash | multiply blend |
| Hatch (black checkerboard from the rect origin) | `VObject_Blitters.cc:1807-1866`: disabled buttons, faces, slots, shop, map screen | fragment pattern starting at the clipped top-left corner |
| Loose hatch with colour (1 in 8) | `:1868-1889` | fragment pattern |
| Outline (index 254 in a colour or skipped) | `:2227-2280`: item graphics, the item cursor | index filter + colour |
| Outline shadow (non-254 darkens ×0.48) | `:989-1003`: item drop shadows | multiply with the shade table's 0.48 |
| Lines and rectangles, inclusive | `src/sgp/Line.cc:341-347` | runs of thin quads; diagonals by a plain Bresenham walk instead of `LineDraw`'s run-length slices (`line-runs.ts`) |
| Nearest stretch | `BltStretchVideoSurface` | `snapshot` |
| Clip rectangle | `SetClippingRect` | scissor; right/bottom exclusive, nested clips intersect |
| RGB565 pictures (load screens, the tactical bottom filler, PCX backgrounds) | 16-bit surfaces | `RGB565` / `UNSIGNED_SHORT_5_6_5` textures, drawn opaque |

Text and images use the palettes' 24-bit colours; the original's final 565 quantisation is not reproduced.

---

## 4. Stub skin

CI runs on stubs only, so the stub pack (`32` §1, rules `32` §1.2) carries what CI needs to render and test every screen
on the canvas; quality is not a goal. Stub art is original work with deterministic bytes, written as **STIs (and PCX
where the code loads a PCX) under the original names**, so layouts reference `(file, frame)` the same way on both data
sets and one decode path serves both. **Sizes come from the layout data** (panel rectangles, button and slot sizes, cell
pitches from the source constants); where the art, not the code, defines a size, the stub chooses its own and the
layout carries the size it needs, so no layout centres a sprite on an original image's measured size. MLG ids resolve
to the base names on the stub data version.

**The generator** (`stubs/ui/skin.ts`): for every asset a layout of the `original` skin references and the stub pack
lacks, it writes an STI with the frames the layout uses, each a bevelled rectangle on the `ui` ramp (`stubs/raster.ts`)
at the declared size, stamped with the file name and frame number in the stub font (`label.ts`); frames may be
`hollow` (label-free, for large pictures, to save space) or `checker` (hatches). Button frame sets get visibly
different states (normal, hover, pressed, grayed). Adding a layout adds its stub art, so the layout contract test
(§3.10) resolves on stubs by construction.

**Special families** a labelled rectangle cannot serve, each with a decoder round trip in `stubs/build.test.ts`:

| Family | Why | Stub |
|---|---|---|
| Cursors (`cursors/*.sti`; `stubs/ui/cursors.ts`) | hot spots and animation frames are tested | simple shapes with a one-pixel outline; animated cursors with several frames |
| Faces (`faces/NN.sti`, `bNN.sti`, `65face/`, `33face/`; `stubs/ui/faces.ts`, `owner-faces.ts`, `stubs/speech.ts`) | blink and lip sync are tested | one generic face per body type with the eye and mouth frames at fixed offsets (offsets in `stubs/profiles.json`), big talking faces at `SKI_FACE_WIDTH × SKI_FACE_HEIGHT`, owner portraits, `.gap` files for stub speech lines, aliases for Speck's and the I.M.P. faces |
| Small item sheets and big item pictures (`stubs/ui/items.ts`) | the item tile and the description box are tested | one silhouette per shape for every graphic; frame indices from `items.json` `inventoryGraphics` |
| Map board `interface/b_map.pcx` (`stubs/ui/strategic-map.ts`) | sector picking and shading are tested | a 16×16 board coloured by each sector's traversability (towns, water, rivers, terrain, roads, the edge of the world), grid lines on even pixels so they survive the half-scale blit, sector labels |
| Radar maps (`radarmaps/<map>.sti`; `stubs/ui/radar.ts`) | the radar is tested | downscaled from the stub maps' own tile colours |
| Load screens (`stubs/ui/load-screens.ts`) | the loading screen is tested | one RGB565 picture (a gradient with its name) at the 640×480 the loading layout declares, behind the load-screen names of that layout |
| Text (`stubs/text/*.json` via `stubs/text.ts`: `help.json` → `binarydata/help.edt`, `laptop-pages.json`, `aimbios`, `aimhist`, `mercbios`, `imptext`, `email`) | help and laptop pages are tested | authored rows: all help records (the tactical overview and the merc stats long enough to scroll), 239 I.M.P. filler records with the attribute labels, invented files, report, quests, insurance texts, bouquets with prices, card sayings, alumni, policies, an I.M.P. intro mail that pages in two on the stub fonts |

Every help record and the first record of every laptop page file are checked through the text service. The stub media
(graphics, sounds, fonts, cursors, interface, laptop and load-screen art, plus a few text files) must stay below 7 MiB
(`MEDIA_BUDGET_BYTES` in `stubs/build.test.ts`; uncompressed RGB565 load screens count).

**Deliberate stub gaps.** The stub dealer, repairman and Speck have no dialogue rows, and the stub world has no pointer
tiles: new `npcdata` rows or tile types would change the stub content the recorded stub saves bind to (`32` §1; new
tile types change the stub tileset database and the logic hash of the stub saves). So their lines are silent (a line
without text is skipped, as the original skips it), Speck talks without subtitles, and cursor markers draw only on the
original data. The stub tilesets have no small tiles (`tilesets/<n>/t/`), so on stubs the overhead map is black under
the persons.

---

## 5. Verification harness

- **Units and draw lists** (Node; the `ui` layer is DOM-free): screen controllers run over fake `GameClient`s on live
  stub sessions (`tests/support/`: `tactical-ui.ts`, `map-ui.ts`, `laptop-ui.ts`, `laptop-sites-ui.ts`,
  `battle-entry.ts`, `e2e-campaign-saves.ts`); **draw-list snapshots** (a screen in a given state produces this list of
  quads and glyph runs, `__snapshots__/` beside the tests) are exact, GPU-free regressions; the layout contract test
  (§3.10) on the stub pack and, with `JA2_DATA_DIR`, the original data.
- **The hook** `window.__ja2Ui` (§2.2; `lastCommand` names the session's last command and `lastResult` is its
  `{ok, reason, refusal}`; `frameStats`, `lagTicks`; the per-screen blocks of `30` §4.12 and `30` §5.4, `help`
  `{open, forced, page, top, totalLines}`, `story` `{step, played, meanwhileBoxes, endings}`). E2e tests click widget
  centres through `page.mouse` and press keys by `KeyboardEvent.code`; every wait is on hook state, and screen loads
  wait while the page keeps loading (`waitWhileLoading`) instead of a fixed timeout. `?shadowHints=1` sends every local
  hint to the server too and fails on any difference (§2.4); the main flow and the talk, shop and battle-entry specs
  run with it. `?drive=manual`, `?pinClock=1` and `?holdTime=1` freeze the driver, the UI clock and game time.
- **`pnpm e2e`** (Playwright on stubs, `tests/e2e/`): the main flow (`main-flow.spec.ts`: main menu, game init, the
  laptop's new-mail box, an A.I.M. hire through the conference, the map screen, landing in A9, the HUD and cursors, a
  battle won by the campaign bot (`tools/campaign-bot`), a route plotted, save and load through the canvas) and one
  spec per screen. **Goldens on stubs only**: the logical framebuffer read through `capture()` against PNGs in
  `tests/e2e/golden/`, nearest sampling, the clock pinned, translucent shading ±1. The suite stores `helpHidden` by
  default (`playwright.config.ts`) so help screens do not change other specs' goldens; the story spec opts back in.
  Local runs use three workers.
- **`pnpm e2e:data`** (`playwright.data.config.ts`, `tests/e2e-data/`): opt-in, never in CI; needs `JA2_E2E_DATA_DIR`
  (plus `JA2_E2E_PORT`, `JA2_E2E_WEB_PORT`) and runs the main flow, a tour of the screens and the performance
  measurement, asserting structure only (screen names, widget ids, visibility, enabled states, texts present, no
  missing image or font, no refused command, no failed `/vfs` read). **No picture of the original data is ever
  taken**: `capture()` and `expectGolden()` of `tests/e2e/ui-capture.ts` throw in that mode; the data fixture
  (`tests/e2e-data/fixture.ts`) replaces `window.__ja2Ui.capture` by a throwing function before any page script runs
  and makes `page.screenshot` reject.
- **`pnpm e2e:browsers`** (`tests/e2e-browsers/presentation.spec.ts`, its own CI job when `pnpm gates` selects it): the
  main menu on stubs in Chromium and Firefox at pixel ratios 1, 1.25, 1.5 and 2, at 1301×977 and 1366×768, with and
  without the 640×480-only option; a device-pixel screenshot must equal the logical capture scaled by whole blocks
  (§2.6). Firefox needs a display (`xvfb-run`; locally `DISPLAY=:99` with Xvfb; headless Firefox has no WebGL without a
  GPU) and `webgl.force-enabled`. Playwright's WebKit is not used: it is a Linux build, not Safari, and it needed a
  test-only drawing-buffer mode and blended the last column at fractional ratios, which Safari (whole ratios only)
  never meets.

---

## 6. Performance

### 6.1 Targets and measurement

| Target | Value | Measured with |
|---|---|---|
| Tactical frame time at 1920×1080, UI scale 2, original data, a busy sector (A9, 12+ soldiers), real time | p95 ≤ 16.7 ms (60 FPS) | a GPU machine (not yet measured, §7) |
| Static world per frame (JS) | ≤ 1 ms after the static scene buffer | `__ja2Ui.tactical.worldMs` (the world render call) |
| Draw calls, tactical with HUD | ≤ 250 | `__ja2Ui.tactical.drawCalls` |
| Screen switch tactical ↔ map ↔ laptop (assets cached) | ≤ 100 ms | not instrumented |
| First tactical load from a cold HTTP cache (local) | ≤ 2 s including the loading screen | `__ja2Ui.tactical.loadMs` |
| A cursor hint computed in the browser | ≤ 2 ms p95 (path search included) | the hint hook's `stats.latency` (local answers) and `stats.projection` (building the knowledge world) |
| Server query round trip (local; agents and fallback) | ≤ 10 ms p95 while no enemy turn runs; never queued behind an advance | not instrumented |

`__ja2Ui.frameStats` = `{p50, p95, max}` of the page's JavaScript time per frame on every screen;
`tests/e2e/performance.spec.ts` (stubs) and `tests/e2e-data/performance.spec.ts` (A9 at 1920×1080, logged) record it.
`__ja2Ui.tactical.loadMs` = `{total, sincePageStart, phases}` of the last tactical load: milliseconds from the load's
start to the end of each branch (`assets`, `presentation`, `world`, `layouts`, `media`, `sound`; `map` marks the map
data ready for the world, which is then built on the GPU) and from the page's navigation start. Headless Chromium
without a GPU (SwiftShader) reads every WebGL frame back in software, so its frame intervals and GPU-process times say
little about a real machine; JavaScript time per frame is the comparable number (about 1.3 / 2.0 ms p50 / p95 for the
A9 sandbox with six mercs in view at 1920×1080, world render 0.3 / 0.4 ms, 25 world draw calls, about 220 UI instances
in 48 batches).

### 6.2 Drawing only what changed

- **Whole frame.** `GamePage` (`src/app/game/game-page.ts`) asks the world layer for its picture number before drawing
  (`WorldRenderer.render` builds the frame, `present` copies the framebuffer into the logical one) and leaves the frame
  as shown when the picture number and the UI's draw items (`sameDrawItems`, plain data compared field by field) equal
  the last drawn ones, at the same resolution and canvas size, after a frame that missed no image or font; at least
  one frame in 500 ms is drawn anyway. A still scene touches neither the GPU nor the compositor; what remains is the
  original's own motion (soldiers' animation frames, animated tiles every 200 ms, the item and enemy glow every 100 ms,
  blinking faces, the radar dot). The hook builds its widget list and time summaries only when read; cursor hints keep
  their answers and client world over a frame that moved only the tick (no hint reads it).
- **World picture.** `PictureMemo.update` (`src/render/world/picture-memo.ts`) compares the frame with the last one (the
  viewport, camera offset, natural shade, shade field version, a count of static uploads, the visible rows, the shadow
  and roof switches, and every item and dynamic instance with its draw state, sprites wholly outside the viewport left
  out) and returns `same`, `full`, or `partial` with a shift and at most `MAX_DIRTY_RECTS` 8 rectangles
  (`dirty-rects.ts`). A camera move shifts the picture (`WorldFramebuffer.copyShifted` into the second framebuffer, as
  the original's `ScrollJA2Background`) and uncovers a strip; every visible instance that appeared, disappeared,
  changed or moved in the drawing order adds its rectangle at the new camera, old position included (instances are
  compared as multisets of their values, then for order). Rectangles merge greedily (overlapping ones, else the least
  added area). The frame is drawn whole when the rectangles cover 60 % of the view, when a global input changed
  (natural shade, shade field version, static uploads, render height, shadows, roofs, viewport), when the shift is a
  view or more, or when it is odd (the dither pattern alternates per pixel; a tile-centred camera always moves by an
  even amount). The atlas and the palette rows only grow, so a sprite or palette added later shows up as a new instance.
- A partial frame clears colour and depth inside the rectangles and runs the same draw calls with the scissor on their
  bounding box, the vertex shader dropping instances that touch no rectangle and the fragment shader discarding pixels
  outside them, so the pixels inside equal a whole redraw's. The shifted part is right only if no visible sprite
  depends on the rows chosen: `StaticScene.assemble` measures how far its sprites rise above and hang below their row
  (`RowReach`) and `visibleRows` takes at least that margin (deviation "Sweep window"); dynamic instances need no
  margin, since the diff redraws one that enters or leaves the rows.
- `?worldCheck=1` draws every partial frame a second time whole and compares the pixels (`__ja2Ui.tactical.worldChecks`);
  `tests/e2e/world-redraw.spec.ts` (breathing, a walk, scrolls in six directions) and the original-data tour expect no
  difference.
- **Canvas.** The canvas has the logical size and the browser's compositor scales it in the pass it makes anyway
  (§2.6), so the GPU writes 4–16 times fewer pixels than for a device-sized canvas, and no fractional canvas size makes
  the browser filter the picture. The video overlay keeps its own canvas in CSS pixels.

### 6.3 Loading

The loaders run independent branches at once (`tactical-host.ts`, `map-host.ts`, `bootUi`, the front end, the layout
loader, the strings, the animation and corpse structures, the light templates, the soldier asset tables, palettes and
structures), so a remote browser pays the HTTP/1.1 limit of six requests at a time instead of one round trip per file;
`/vfs` responses are gzipped when worth it (`src/server/vfs-gzip.ts`). The tactical screen does not wait for `sound`:
it starts with the load, and the sound director and the world's ambient join the running screen, which drops sound
events until then. The tactical host opens the client knowledge (rule pack identity, rule reader, its own world; §2.4)
after the screen has loaded; the server answers the hints until then.

---

## 7. Known limitations

Limitations of single screens are in `30`.

- **Not measured:** the 60 FPS target of §6.1 needs a GPU machine; only SwiftShader numbers exist.
- **Disconnects:** a dropped connection does not pause the game; a real-time driver keeps running on the server until
  the client is back (the modal pause of §1.4 cannot reach the server).
- **Goldens missing:** the San Mona screen (no stub brothel scenario; `san-mona.test.ts` covers it) and the A.I.M.
  conference (its snow and video run on the UI clock). The main flow hires three of its four mercs through MCP and lets
  the campaign bot fight, so the canvas path covers one hire, the cursors and one shot.
- **Not built, by decision:** the cover and line-of-sight display, the 3D cursor, touch input, a key remapping UI; the
  data scenarios 3 and 4 (§1.3) and audio transcoding for remote play.

---

## 8. Decisions

1. **Layouts are JSON** with a schema, constants referenced by name from generated tables and `@derived`/`@src`
   provenance, rather than TypeScript modules, so another skin can be authored without code (§3.10).
2. **The message log is server presentation entries** saved with the session rather than a client-only table: agents
   see them, saves keep them, one audit pass (`29` §8).

Decided where they are described: the UI scale (§2.6), the data scenarios (§1.3), cursor hints on the client (§2.4),
the animation scripts as data from the user's files (§2.3); in the screens: the `gui_extras` stat bars off (`30` §2.1),
the brothel time warp (`30` §1.11) and the loading-screen entry draw (`30` §1.10) simulated, the map path quirks kept
(`30` §4.6).

# 28 — Player UI: widgets, layouts, fonts and the original screens

**Conventions.** Paths without a prefix are relative to `reference/stracciatella/src/game/`; `src/sgp/…`,
`src/externalized/…` and `assets/…` are relative to `reference/stracciatella/`; `V:` is vanilla `Build/`. ja2-node paths
start with `src/`, `data/`, `stubs/`, `tools/`, `tests/` or `docs/` and are relative to the repository. "(inferred)"
marks conclusions not traced end to end. Coordinates of fixed screens are in the `std640` frame (§3.10). A difference a
player can see is a row of `deviations.md`, named here in quotes ("Item cursor on the canvas").

**Companions.** `01` (D8–D10, D15, D16, the layers), `04` (drivers and playback, the server, `04` §5.10 the rule pack
and asset serving, `04` §6 the agent API: every command, query, view field and event a screen uses), `05` (tactical
rendering), `20` (lighting), `21`–`23` (laptop, contracts, merchants), `24` (dialogue and speech timing), `26`
(meanwhiles and the ending), `27` (saves, options, sound, video, text and glyph tables, stubs, performance, the
launcher), `deviations.md`.

## 0. Scope

The player UI is the browser client in which a human plays the whole campaign: one page, `/play`, with a DOM-free `ui`
layer (a region dispatcher with the original's `MouseSystem` semantics, buttons, bitmap text with the original's wrap
and colour model, cursors, popups, message boxes) that emits a draw list, a WebGL2 renderer that draws it and the
tactical world at a logical resolution, and the original screens rebuilt on that foundation. The launcher at `/` keeps
the ja2-node-only features (data source, language, sessions, native imports, downloads, settings export, developer
pages) and links to `/play`.

Each screen reproduces the original 640×480 composition (art from the user's data, positions from Stracciatella's
constants, bitmap fonts, palette-index colours, region priorities, the key phase of every hotkey) inside
Stracciatella's resolution model (§2.6). A screen is a controller with a view model over the `PlayerView`, cursor
hints and queries, bound by a JSON layout; the original look is one skin (`original`). The rules stay on the server
(D15): a screen's numbers come from the view, from cursor hints computed by the simulation's own functions over a
player-knowledge projection (§2.4) or from server queries, and nothing the original would hide is shown (D16).

§1–§3 cover principles, architecture and the widget foundation, §4 the front-end screens, §5–§6 the tactical screen;
the later sections cover the map screen, battle entry, the laptop, the story screens, sound, the stub skin and
performance.

---

## 1. Principles

### 1.1 Fidelity policy

The original's screens are fixed compositions of STI and PCX art, bitmap text in palette-index colours and mouse
regions at constants from `#define` blocks; once the shared widgets exist, reproducing a screen is transcription, so
reproducing the original's look and behaviour is the default. A part is **simplified** when the original mechanism
cannot work in a browser (pointer warping, mouse confinement, OS key repeat), depends on the frame rate (fades, zoom
speeds), exists only to spare a software renderer work (dirty rectangles, background save buffers) or needs a server
rule the client must not reimplement, and a cheaper equivalent shows the same thing. A part is **left out** when it
needs simulation that does not exist (the helicopter drop, meanwhile scene playback, tactical placement) or is flavour
with a high cost (the A.I.M. conference distortion, Speck's idle chatter).

Rules that follow from D15 and D16 and bind every screen:

1. **No hand-written rule in the client.** Every number a screen shows that the simulation computes (costs, chances,
   ETAs, prices, what fits where, what is enabled) comes from the view, from a hint computed by the simulation's own
   functions over the player-knowledge projection (§2.4), or from a server query. A screen may restate an *enable*
   rule on view fields only when the rule is trivial and the command refuses anyway (try-and-refuse is always
   acceptable). Commands are validated by the server on the full state.
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

The original layout is the skin `original`, the only one. A controller declares its actions and bindings (a
`ControllerContract`, collected in `src/ui/screens/contracts.ts`), and the contract test checks that every layout of
every skin binds them or marks them `unsupported` (§3.10). Screen parts that cannot be generic (the tactical viewport,
the strategic map, the radar, faces, inventory slots, the item description box, video, credits) are `custom` widgets
whose geometry comes from layout parameters, so another layout can resize them without touching the controller.

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
| 3 | The user's data on the server and on the client | `JA2_DATA_DIR` | the client's own `Data` folder, each file checked against the manifest on first read, a mismatch or a missing file fetched from the server | not built |
| 4 | The user's data only on the client | a rule pack the client builds from its folder and uploads (hash first), kept in the server's cache; sessions bound to a pack | the client's own folder | not built |

The seams for 3 and 4 exist: the pack is an explicit artifact with a hash; the client reads files through a
replaceable `AssetSource` (§2.5; a local-folder source would read archives with the DOM-free SLF parser over
`Blob.slice`); it builds the same rule content with the same loaders (§2.4); the animation schedule warps when its
scripts differ (§2.3). Missing: the local folder source and the per-file check (the data version must match too, since
text lengths time speech), the validated pack upload, per-session content and per-user pack storage.

Graphics stay palette-indexed in every scenario (soldier palettes, shade tables and outline colours need indices);
STI, PCX, ETRLE, IMA ADPCM, GAP and Smacker are decoded by ja2-node's own code, so no browser codec matters.

### 1.4 Time while the client shows something modal

The original pauses game time while a message box, the options or save screen, the help overlay, a popup menu, the
item pickup menu or the sector inventory is open, and it pauses *at the event* that opens a box
(`MessageBoxScreen.cc:270-274`, `Options_Screen.cc:169`, `HelpScreen.cc:465-472`, `Interface_Items.cc` pickup menu).
In ja2-node the server owns time:

- **Client modals** (message boxes, the exit box, the options and save/load screens opened in a game, help, the
  tactical movement and door menus, the sector exit dialog, the overhead map, the meanwhile box, the San Mona screen)
  call `UiRuntime.pauseGame`. `ModalPause` (`src/app/game/modal-pause.ts`) counts nested modals: the outermost one
  switches a running real-time driver to `manual` (`SessionClient.drive`), the last one restores the previous driver,
  only on the same session and only if the driver is still manual.
- **Boxes opened by an event** (the map screen's update box): the real-time driver's `pauseOn: EventType[]` stops it on
  the tick of the first listed event (`04` §6.7); the client sets the list the original pauses at.
- Decision prompts freeze the server anyway (D15).
- The tactical player pause is the driver at `manual` plus the original's mask (§6.8).

---

## 2. Architecture

### 2.1 Layers

The browser layers (`tools/check-imports.ts`, tsconfig project references):

| Layer | May import | Contents |
|---|---|---|
| `ui` (`src/ui`) | core, content, protocol | lib ES2024 only (no DOM), the `NONDETERMINISM` forbid list (time is injected). Region dispatcher, widgets, layout model, bitmap font metrics and text layout over `src/content/text/glyph-table.ts`, hotkey tables, the cursor database, the **draw list**, screen controllers written against abstract clients (`GameClient` for hints and queries, `FrontEndClient`, per-screen environments) |
| `render` | core, content, protocol, ui **types only** | DOM. `render/ui-draw` (draw list → batches) and `render/world` (the tactical world). A value import from `ui` fails `pnpm imports` (the `typeOnly` rule) |
| `app` | core, content, sim, protocol, ui, render, audio | DOM. The game page, `SessionClient`, the asset source and cache, the client's rule content and the local hint provider (`sim/knowledge` and `sim/hints` run in the browser unchanged, `04` §5.7), audio, video, `localStorage`; the launcher |
| `devtools` | core, content, protocol, ui, render, audio, app | the developer pages, among them the widget gallery (`src/devtools/ui-gallery/`) |
| `stubs` | core, content, node, ui, stubs | the stub skin is generated from the layouts (`28` §12) |

`sim` contains the player-knowledge projection (`src/sim/knowledge/`) and the hint functions (`src/sim/hints/`), used
by the server's query service and by the client. `app` may not import `devtools`, so the client pieces the developer
pages share live in `app` (`app/net`, `app/world`, `app/sound`, `app/media`).

### 2.2 The game page

`/play` (`src/app/game/index.html`, aliased by `src/node/client-pages.ts` for the Vite servers and the built client)
holds one WebSocket (`SessionClient`), one WebGL2 context (`preserveDrawingBuffer` off), one audio engine, one asset
source and cache, and a `ScreenHost` (`src/ui/screen.ts`): a **screen stack** (`enter`, `exit`, `update(now)`,
`input(event)`, `render(list)`, `describe()`) with a **modal stack** above it. Modals take input first, the top one
blocking unless it `passesUnhandledInput`; the screen under a modal is drawn but not updated; a modal that
`freezesScreen` (message boxes, fades) replays the draw items taken when it opened. Switching tactical ↔ map ↔ laptop is
a screen change, so decoded assets survive.

**Boot** (`main.ts`): `bootUi` (`ui-boot.ts`: the asset source, `UiAssets`, the 16 fonts and 68 cursor files preloaded,
`UiAudio`, the text service, the layout loader) and `startFrontEnd` (`front-end.ts`) open the main menu, or with
`?session=` the session's game screen; `?screen=testPattern` shows the platform test screen (`test-pattern.ts`: every
draw primitive, the golden of `tests/e2e/play.spec.ts`). A page that fails to boot shows a plain HTML panel (heading,
the reason from `src/ui/client/failure-text.ts`, Retry as a reload), since the game's fonts may not have arrived. URL
options: `scale`, `fixed640`, `pinClock=1` (the injected clock stays at 0, for goldens), `shadowHints=1` (§2.4),
`drive=manual` (the tactical screen keeps a manual driver).

**Frame** (`GamePage.frame`, a `requestAnimationFrame` loop on the injected clock; DOM events reach `UiRuntime.input` as
they arrive through `dom-input.ts`): resize (§2.6), playback (`SessionClient.playFor`), `UiRuntime.frame` (UI clock,
region re-evaluation, sliders, `ScreenHost.update`, cursor timers, the screens' draw items, tooltips, the Ctrl+F
diagnostics overlay of `04` §6.30, the software cursor last), the world when the top screen `drawsWorld`, then the draw
into the logical framebuffer. A frame whose draw items equal the last drawn ones (`sameDrawItems`) with the same world
picture, resolution and canvas, and no image or font missing, is not drawn again; at least one frame per 500 ms is
(`28` §14 covers the world's idle and partial redraws).

**Screen flow** (`FrontEndFlow`, `src/ui/screens/front-end/flow.ts`): the front-end screens (§4) and the game screens
behind ports (`TacticalPort`, `MapPort`, `LaptopPort`; hosts in `src/app/tactical/`, `src/app/map/`,
`src/app/laptop/`). `gameScreenOf(view)` follows the server's flow: `laptop` → laptop; an open pre-battle prompt → map;
no strategic view or the flows `tactical`, `meanwhile`, `endgame`, `ended` → tactical; otherwise the map. A frame that
shows another flow while a game screen is up re-enters the game, so every screen change the server makes (the map's
Tactical and Laptop buttons, the team panel's Map button, a pre-battle `enterSector`, the laptop's power button) takes
one path. A game screen that cannot open shows `screen-unavailable` (§4.11).

**Test hook.** `window.__ja2Ui` (`src/app/game/ui-hook.ts`) reports screen, modal, scale, origin, logical size, widgets
(id, kind, rect, visible, enabled, state, text, frame), cursor, sounds, frame counts and times, playback lag, the last
command and its result, music, video, help and story state and the `/vfs` reads in flight, and offers `capture()` (the
logical framebuffer as RGBA) and `skipPlayback()`; screens add `tactical`, `map`, `battle` and `hints` blocks. The e2e
suite drives the canvas through it and compares captures with goldens on the stubs only (`28` §13).

### 2.3 The client's copy of the game

`SessionClient` (`src/app/net/session-client.ts`) keeps the **shown** view (advanced by playback) and the **latest
received** one (`latestView`, which hints read), both updated by the generic `applyViewFrame(view, frame)`
(`src/protocol/view.ts`: copies every field a frame carries, replaces the changed soldiers through `applyFrame`, moves
the tick), so every field the server adds reaches the screens without client work. `ReloadingSession`
(`tests/support/session-reload.ts`, used by the stub scenario suites) checks it as the inverse of `diffPlayerView`
through a `ViewMirror` (`tests/support/view-mirror.ts`) after every dispatch and advance. The client also keeps the
message log, the frames not yet played back (`queuedFrames`, read by the input lock, §6.1) and the `welcome` identity
(`engine {version, commit}`, `rules {pack, scripts}`, `04` §5.10).

**The animation schedule.** The server splits `ja2bin.dat` into a logic timeline the simulation steps and a
presentation timeline (sprite frames, sound codes; `src/content/anim/timelines.ts`, `04` §5.10). A soldier's view entry
carries the animation state, `frameSlot` (the logic position from the state's start), `stateTick`, `frameDelay`
(`sAniDelay`, which depends on breath, life, agility, terrain, combat and stealth: the client cannot compute it) and
`nextFrameTick`; gameplay markers arrive as events with ticks (`shotFired`, `meleeStrike`). `SoldierFrames`
(`src/app/world/soldier-frames.ts`) reads the client's own scripts and compares their hash with `welcome.rules.scripts`
(`unknown` counts as equal; `?scripts=stub` on the devtools tactical page forces the stub scripts):

- **Same scripts** (always in scenario 2, policy `exact`): the sprite frame is the presentation frame of the
  (predicted) slot, equal to the server's `frame`.
- **Different scripts** (policy `warp`): per state the client walks its own script into a track (frames, the frames
  that carry opcode 430, a loop or an end) and plays it from `stateTick` at `frameDelay`, warped piecewise between the
  state start and the ticks of `shotFired`/`meleeStrike` from received frames (`SessionClient.onReceive`, so playback
  behind the latest tick interpolates), holding the frame before an unconfirmed marker. A muzzle flash still coincides
  with the shot; nothing flows back from the picture (deviation "Soldier frames with other scripts"). Other gameplay
  opcodes carry no event with a tick, so they do not anchor the warp.

`SoldierView.frame` stays: the sound director (`src/audio/director.ts`) walks the scripts from it, and agents read it.
Fine animation between the 50 ms frames comes from the schedule, not a smaller `FRAME_TICKS`.

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

Cursor feedback needs answers several times a second (the path and AP cost under the pointer, the chance to hit,
valid drop targets, ETAs while plotting, enabled menu lines). The original computes them in the UI with the rules'
functions; ja2-node does the same in the browser with the simulation's own code (`src/sim/hints/`, `answerHint`) over
the **player-knowledge projection** (`knowledgeWorld(view, rules)`, `src/sim/knowledge/`: the map, doors as perceived,
seen items, the light, the player's soldiers in full and only the others he sees, with their visible fields). The
server answers the same kinds over the projection of the same view, on an unlogged query channel, for agents,
server-only answers, the fallback and verification. Client and server agree by construction: same code (the engine
commit of `welcome`), same inputs (the projection of the same view; the rule pack and scripts hashes). The kinds, the
server-only queries, the channel and fairness are in `04` §6.28. Commands are validated on the full state, so the only
differences are legitimate: a path through a tile held by an unseen enemy is shown, and the merc stops when he meets
him, as in the original.

**The client provider** (`src/app/hints/`). `ClientKnowledge.open(source, identity)` loads the rule content through
`loadClientRules` (`src/app/rules/client-rules.ts`: the pack and scripts hashes from the manifest with SubtleCrypto,
then a strict rule reader with live graphic facts) and the server's loaders (`loadTacticalContent`,
`loadStrategicRules`, the world per map, two maps cached); it is usable when the engine identity Vite injects
(`__JA2_ENGINE__`) and both hashes equal `welcome`'s. `HintProvider` implements `GameClient` (`src/ui/game-client.ts`:
`hint(request)` polled every frame, `pending` until ready; `hintNow`; `query`): a request is answered once it has
rested 80 ms per kind (`PATHFIND_REST_MS`, the original's `PATHFINDCOUNTER`, `Utils/Timer_Control.cc:19`), on the
latest received view (in combat the input lock waits for playback anyway, §6.1), with one projection per view and
answers cached per view (a frame that moved only the tick keeps them); it falls back to the query channel while the
knowledge is unusable or the map is not loaded. The tactical and map hosts open the knowledge after their screen has
loaded. **Shadow mode** (`?shadowHints=1`, on in e2e) also asks the server and compares over the view the client holds
when the reply arrives (`04` §6.28); `window.__ja2Ui.hints` counts compared, stale, failed and differing answers.

| Hint | Screen use |
|---|---|
| `previewMove` | move cursor, footstep path with AP bands, confirm marker (§6.1, §6.4) |
| `previewAction` | action cursors (door, pick up, talk, give, jump, swap, look, aid) and the walk-up path |
| `estimateAttack` | attack cursors (aim rings, chance to hit, range, reload, throw and launch), the `f` key |
| `exitSector` (`dryRun`), `exitSectorOptions` | exit arrow colour, sector exit dialog (§6.6) |
| `placements`, `itemInfo` | inventory hatches, attach and merge targets, compatible outlines (§5.3); the description box (§5.4) |
| `canEnterSector`, `assignmentOptions`, `previewRoute`, `previewHeliRoute`, `moveBoxOptions` | the map screen |

**Keeping them equal**: the `src/server/hints-*-stub.test.ts` suites and their `-original` twins
(`tests/support/hints.ts`, `hints-actions.ts`, `hints-strategic.ts`) compare client answers (the strict projection
built from the serialised view alone) with server answers over sampled points; strict mode throws on every field the
view does not supply, so a hint that reads hidden state fails at once.

**Limitations.** The melee chance to hit is `null` (hidden defender ratings); the exit dry run cannot know mercs
already walking off; stat damage for stat healing (`enable_stat_healing`) is not in the view; the client loads the
tactical content without the stub profiles of a stub campaign (no hint reads them); the client knowledge loads the rule
pack one file after another, and the map and tactical hosts each open their own.

### 2.5 Assets

The user's data is about 34,000 files and 864 MB (speech 390 MB, music 100 MB, STI graphics 170 MB, maps 75 MB, videos
69 MB); a first tactical screen needs about 8–12 MB of STI and map data, a speech line 30–60 KB. The server side (the
manifest `GET /api/assets/manifest`, immutable `GET /vfs/@<hash>/<path>`, plain `/vfs/<path>` with a strong content
ETag, gzip of compressible files, the persisted hash cache) is in `04` §5.10. The client side (`src/app/assets/`):

| Module | Content |
|---|---|
| `http-vfs-layer.ts` | `HttpVfsLayer implements VfsLayer` (`src/content/vfs/vfs.ts`) from the manifest, so path normalisation, layering and the stub fallback are the same `Vfs` class as on the server; reads through `/vfs/@hash/path` (ranges with `Range`), 12 requests in parallel (8–16), one fetch per file in flight shared by its readers, a per-read `AbortSignal` (the fetch stops when its last reader leaves) and `abortAll`; `StaleAssetError` on a 404 (the hash changed); `fetchAssetManifest` |
| `asset-source.ts` | `AssetSource`, the replaceable seam (§1.3), and `HttpAssetSource`: the `Vfs` over the layer, the stub text fallback the server's `/vfs` has, `hashOf`, `read`, `readOptional` |
| `page-assets.ts` | `pageAssetSource()`: one source and one manifest request per page; the `src/app/net/vfs.ts` helpers (`fetchVfsFile`, `fetchOptionalVfsFile`, `readVfsFileOrNull`, `fetchVfsList`) read through it, so the world, sounds, music and video come from immutable URLs, a file missing from the manifest answers without a request, a stale hash falls back to the plain URL, and the file list is the manifest's |
| `asset-cache.ts` | `AssetCache`: values by (content hash, decoder name), LRU by bytes (256 MB), loads shared while in flight, raw bytes reused by decoders; `loadDecodedAsset`. Decoding is cheap (a tileset's ETRLE frames in 17–53 ms), so the persistent layer is the HTTP cache |
| `preload.ts` | `preloadAssets(source, paths, {cache, signal, onProgress})` → loaded and missing paths, progress per file; the loading screens' bar follows it (§4.10) |

`UiAssets` (`src/app/game/ui-assets.ts`, the `ImageCatalog` of `src/ui/assets.ts`) loads STIs, fonts and PCX (as opaque
RGB565) through the cache and registers RGB pictures the client composes (`addRgb`: the overhead map, the map board).
Each screen's assets are the ones its layouts reference (`src/ui/layout/references.ts`), preloaded before the screen
enters. Every content loader takes a `ReadFile` and the audio engine a `load(path)`, so a local folder source needs no
loader change.

### 2.6 Resolution and scaling

Stracciatella keeps every fixed screen at 640×480 centred at `STD_SCREEN_X/Y` with black around it, extends only the
tactical viewport (`(0,0)–(W, H−120)`) and centres the tactical bottom panel, with 6–12 team slots by width
(`UILayout.cc:57-138`, `:167-176`; `squad_size` 6 in `game.json:95`). ja2-node adopts that model with an integer
**UI scale** (`src/ui/resolution.ts`, `resolveResolution`):

- auto scale = the largest integer that keeps 640×480 (`min(⌊W/640⌋, ⌊H/480⌋)`, at least 1); a forced scale from the
  client setting `uiScale` (0 = auto) or `?scale=` (at most 8); logical size = `⌊canvas / scale⌋`, at least 640×480;
  `STD_SCREEN_X/Y` = `⌊(logical − 640×480) / 2⌋`. 1920×1080 → scale 2, logical 960×540 (tactical viewport 960×420);
  2560×1440 → 3, 853×480; 1280×720 → 1.
- The "640×480 only" option (`fixed640`, `?fixed640=1`) keeps the logical size at 640×480 on every screen, the tactical
  screen pillarboxed too.
- Fixed screens are laid out in the `std640` frame; the few full-screen elements (main menu buttons and copyright,
  message box centring, tooltips) use the logical screen (§3.10).
- The frame is drawn into a framebuffer at the logical size (`src/render/ui-draw/logical-framebuffer.ts`), copied into a
  canvas of the same size, and the browser scales the canvas (`image-rendering: pixelated`) to exactly
  `logical × scale` device pixels inside a full-window `#stage`, at an offset that is whole in both CSS and device
  pixels (`alignedOffset`: Chrome and WebKit place a canvas at whole CSS pixels). When even 640×480 at scale 1 does not
  fit, the canvas is shrunk to fit (nearest). `tests/e2e-browsers/presentation.spec.ts` checks every device pixel
  against the logical capture in Chromium and Firefox at fractional pixel ratios (`28` §14).
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
| Static scene | `static-scene.ts` builds the map once into eleven segments kept per row: land, objects, shadows, structs (with the wall strips), strict strips (non-wall multi-Z, `<`), roofs, on-roof, topmost (wireframes), and the obscured pass (dithered, dithered multi-Z, depth-writing). Every segment writes depth and z modulo 8 is the sublayer (structs 4, items 1, roofs 5, on-roof 6, topmost 7), so sprites of different segments never tie and the per-row interleaving of the original comes out in any order; ties inside a segment keep the sweep order; strict strips go last because a strict sprite loses every tie (deviations "Show-through order", "Sweep window"). Positions are camera-free; camera, render height and viewport are uniforms; each frame draws the instance ranges of the visible rows. Doors and revealed rooms rebuild only their rows (`changedRevealTiles`); the tree-top, wireframe and roof-level options rebuild all |
| Draw path | `world-program.ts`: sprites pulled by `gl_VertexID` from an RGBA32F data texture (three texels per sprite) with plain `drawArrays`; the shade from a 160×160 RG8UI texture (land and roof shade per tile) or fixed per sprite. No instancing: SwiftShader (headless Chromium without a GPU, CI) pays per instance. `world-framebuffer.ts`: colour and 24-bit depth at the logical size; `picture-memo.ts` skips, shifts or partially redraws a frame (`28` §14) |
| Dynamic pass | `dynamic-scene.ts`, over the visible rows' tiles with dynamic content: the item pass (at most two items per pool, dithered `<=` then depth-writing `>`, outline on index 254), then per row: dynamic objects, dynamic shadows, roof soldiers (`STRUCT_MERCS`), ground soldiers, dynamic structs; dynamic roofs, roof soldiers again (`HIGHMERCS`, as the original draws them twice), dynamic on-roof; topmost. A soldier is three sprites (shadow index 254 multiplied where `zbuf < z`, body where `zbuf <= z`, dithered body where `zbuf > z`) at the merc z, the on-roof z for `level > 0`, or 32767 at the glow peak; on a tile whose last structure is a single-tile non-wall one (`MAPELEMENT_EXT_NOBURN_STRUCT`) 2 nearer and without the dithered part. Multi-tile soldiers (prone mercs, vehicles, the tank, large creatures) go to the struct-merc pass at their animation structure's z with its z strips |
| UI nodes | `WorldUiNode {gridNo, layer: object \| roof \| onRoof \| topmost, tile, head?, offsetX?, offsetY?, shade?}` merged into the dynamic pass of its layer and tile (the markers of §6.4), at the layer's z (`OBJECTLAYER_USEZHEIGHT` objects at `8·wy`, topmost 32767), shade 4 by default. Animated tiles show `animationFrames[⌊clock / 200 ms⌋ mod n]` |
| Camera, picking | `camera.ts`: `ApplyScrolling` with the tile-centre snap, the scroll rectangle of restriction 0 and 1 and `setRenderCenter` (`05` §1.4). `picking.ts`: the soldier whose drawn frame has an opaque, non-shadow pixel under the pointer, topmost sprites first; tiles by `screenToGridNo` (`05` §7) |
| Lighting | `src/app/world/world-lighting.ts` runs the simulation's lighting over the client's own `TacticalWorld`: the view's ambient and dynamic light sprites, the map's lights for the hour, doors as perceived. A tile's shade is `natural − strongest light` (`LightAddTileNode`'s `ubMaxLights`, not the gameplay sum); map lights are cached per (hour, ambient, doors), merc lights added per frame (`light-templates.ts`); the map's light colour tints tiles and soldiers. The client keeps the map's original structures, so a wall destroyed by a grenade does not let a lamp's light through on the client |
| Soldiers | `src/app/world/soldier-scene.ts`: sheet and frame (§2.3); palette rows per soldier palette (16 shades, 20 red glow, 20 orange roof glow); own mercs personally lit at shade 3 unless "merc casts light" at night, others the land or roof shade of their tile, then `max(shade − 2, 4)`; the glow (`src/render/world/glow.ts`: 30 frames of 100 ms, hostiles on our turn or under AI control, topmost at frame ≥ 7, grey offset 10 when the selected merc does not see the soldier; `glow-context.ts` takes `hostile`, `sees` and the AI baton holder from `aiTurn` events); the fades (`soldier-fade.ts`: a newcomer of another team from shade 12 down, a soldier who left the view up to 12 at his last tile, 60 ms a step) |
| Fog of war | `reveal.ts`: the view's `revealedRooms` as the original's node flags (`SetGridNoRevealedFlag`: `FIRSTROOF…FOURTHROOF` hidden, A-frame walls on the tile and its south and east neighbours hidden, obstacles and slanted roofs shown through) and the wireframes of `CalculateWorldWireFrameTiles`; hidden roofs reappear at the roof interface level. Options (`src/app/world/display-options.ts`): tree tops (FULL3D trees as their trunk frame), wireframes, roofs, item glow (a static white or yellow outline when off), merc casts light, merc always lit |
| Items, corpses, smoke | items with the item tables' `tileGraphic` (`item-tiles.ts`) at `8·wy + 1` or the on-roof z, raised by `height`, hidden when `notRendered`, outlined with the 20-step white (red, yellow on roofs) cycle. `world-effects.ts`: corpses at the start frame of their direction block (vehicles loop at 150 ms) with `CreateCorpsePalette`'s palette in 16 shaded rows, z strips and shadow pixels; smoke tiles cycle 12 frames from a per-tile start and delay as a 50 % blend (deviation "Translucency"), static and opaque with "animate smoke" off |
| Tile changes, blood, bullets, effects | `tile-changes.ts` applies the view's `tileChanges` (`04` §6.7) to the struct and on-roof layers, updates the touched tiles' level render data and reveal state and rebuilds only their rows (windows crack and shatter, wrecked structures go, the O3 statue opens); blood pools from the view's `blood`; bullets and thrown objects (`bullet-nodes.ts`, `src/app/net/bullet-track.ts`) and impact, trail and explosion animations (`effect-animations.ts`) as `05` describes |

**Limitations.** Known mines and bombs have nothing to show (deviations "Map items", "Duds and timed bombs"); the
helicopter's pieces on the map need the simulation (deviation "Helicopter on the map"); the cover and line-of-sight
tiles (`LEVELNODE_REVEAL`) are not drawn; the stub world has no pointer tiles (new tile types would change the stub
tileset database and the logic hash of the stub saves), so cursor markers draw only on the original data.

### 2.8 Module map

| Path | Layer | Content |
|---|---|---|
| `src/ui/` (`screen.ts`, `runtime.ts`, `clock.ts`, `services.ts`, `resolution.ts`, `draw-list.ts`, `assets.ts`, `settings.ts`, `message-boxes.ts`, `game-client.ts`, `speech.ts`, `diagnostics-overlay.ts`) | ui | screen and modal stacks; `UiRuntime` (regions, buttons, sliders, fonts, images, sounds, cursor, clocks; held keys polled from it); UI scale; draw list; client settings; `MessageBoxes`; `GameClient`; `SpeechPresenter` (§5.8); the Ctrl+F overlay |
| `src/ui/input/`, `text/`, `widgets/`, `cursors/`, `layout/` | ui | §3.1–§3.10 |
| `src/ui/screens/` | ui | controllers: `front-end/`, `tactical/` (`input/`), `talk/`, `shop/`, `map/`, `battle/`, `laptop/`, `help/`, `story/`; `contracts.ts`, `gallery.ts`, `credit-roll.ts`, `test-pattern.ts` |
| `src/ui/saves/`, `src/ui/client/` | ui | save controller and rows, campaign form, REST types, `FrontEndClient`, failure texts (shared with the launcher) |
| `src/render/ui-draw/` | render | draw list → batches (§3.11) |
| `src/render/world/`, `src/render/array-atlas.ts` | render | the world renderer (§2.7) |
| `src/app/game/` | app | `/play`: boot, `GamePage`, frame loop, DOM input, `UiAssets`, `UiAudio`, the hook, the front end and its client and music, `ModalPause`, settings store, help and story hosts, diagnostics |
| `src/app/net/` | app | `SessionClient`, the `/vfs` helpers, quick-save keys, sleep/wake stop, `PageMusic`, bullet track |
| `src/app/assets/`, `src/app/rules/`, `src/app/hints/` | app | asset source, layer, cache, preload (§2.5); client rules; `ClientKnowledge`, `HintProvider` (§2.4) |
| `src/app/world/` | app | world loading, soldier assets, frames and scene, lighting, effects, glow, radar, display options, `TacticalWorldView` |
| `src/app/tactical/`, `map/`, `laptop/`, `battle/` | app | the per-session hosts of the tactical screen, the map screen, the laptop and battle entry |
| `src/app/sound/`, `media/`, `video/`, `credits/`, `launcher/` | app | `TacticalSound`, `StrategicSound`, `loadAsset`, the video player, the launcher and its DOM credits scroller |
| `src/sim/knowledge/`, `src/sim/hints/` | sim | projection and hint functions (`04` §6.28) |
| `src/content/anim/` (`timelines.ts`, `schedule-track.ts`), `src/content/rules/`, `src/content/text/font-colors.ts`, `src/content/picture/shaded-palette.ts` | content | split scripts and schedule track; the rule pack; font colours; shaded palettes |
| `src/devtools/ui-gallery/` | devtools | the widget gallery |
| `data/layouts/original/`; `data/tables/ui-constants/`, `cursors.json`, `ui-cursors.json`, `mlg.json`, `load-screens.json` | data | the layouts; tables generated by `tools/transcribe/ui-constants.ts`, `cursors.ts`, `ui-cursors.ts`, `mlg.ts`, `load-screens.ts` |
| `stubs/ui/` | stubs | the layout-driven stub skin (`skin.ts`), cursors, faces, items, radar maps, load screens, the strategic map board (`28` §12) |

The server modules the screens rely on (`src/server/query.ts`, `rule-pack.ts`, `assets-manifest.ts`,
`frame-anchors.ts`, `message-entries.ts`, `item-catalogue.ts`) are in `04`.

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
- A region's cursor, or with `NO_CURSOR` the cursor of the next enabled region below that has one.
- Callbacks may create and delete regions: dispatch runs over a snapshot and rechecks existence.
- The list is hit-tested again on the next frame after any region change (the original does it only on a mouse move or
  `RefreshMouseRegions`), so a region that appears under a still pointer takes effect at once (deviation "Mouse region
  refresh").

Browser glue (`src/app/game/dom-input.ts`): `contextmenu` and middle/X-button navigation suppressed, `wheel`
non-passive, pointer capture on the stage, coordinates through the inverse transform (§2.6). There is no touch input.

### 3.2 Tooltips (fast help)

`FastHelp` (`src/ui/input/tooltips.ts`; `RenderFastHelp`, `DisplayFastHelp` of `MouseSystem.cc`): after the pointer
rests 600 ms with no button down, reset by a click; the original's size, placement and clamping to the screen; a
double-framed box with the interior darkened twice; `FONT10ARIAL` with the tokens `|` bold gold 146, `^` light green,
`~` light red, beige otherwise. Drawn only over screens that declare `rendersTooltips` (never over a message box), on the
frame its timer runs out (the original registers the background first and draws a frame later).

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

**Fonts.** `InitializeFonts` (`Utils/Font_Control.cc:34-62`) loads 16 STIs from `fonts/`: `FONT10ARIAL`,
`FONT10ARIALBOLD`, `FONT12ARIAL`, `FONT12ARIALFIXEDWIDTH`, `FONT12POINT1`, `FONT14ARIAL`, `FONT14HUMANIST`,
`FONT16ARIAL`, `BLOCKFONT` (`MILITARYFONT1`), `BLOCKFONT2`, `BLOCKFONTNARROW`, `COMPFONT`, `SMALLCOMPFONT`,
`LARGEFONT1`, `SMALLFONT1`, `TINYFONT1`. `FontSet` (`src/ui/text/fonts.ts`) maps the macros to files through the
generated `Font_Control` table; `bitmap-font.ts` reads glyph metrics from a font STI and the glyph table. The stub pack
aliases all of them to two Terminus-derived stub fonts with Latin, Polish and Cyrillic glyphs (`stubs/fonts.ts`, `27`
§6.5).

**Glyphs.** One translation table per data version maps a code point to a glyph index for all fonts
(`src/sgp/Font.cc:163-173`; `src/content/text/glyph-table.ts`). A code point the table lacks and an index past the
font's glyph count draw `'?'` (the block fonts and `font14humanist` have one glyph fewer than the English table's
maximum).

**Colours.** Glyphs carry their drop shadow as pixel value 1; every other non-zero value is ink. Text is printed with
the mono-shadow rule: 0 → background or transparent, 1 → shadow or nothing, else foreground
(`VObject_Blitters.cc:236-345`). Colours are 8-bit palette indices resolved through the palette of the **current font**
(`Font.cc:51-80`); the font palettes differ in a few indices, so colours are resolved per font. `resolveFontColors`
(`src/content/text/font-colors.ts`, the indices of `Utils/Font_Control.h:48-93`, `NO_SHADOW` = 0, `DEFAULT_SHADOW` = 2)
applies two black rules, "black" meaning 0 in 16 bits: a non-zero shadow index whose colour is black stays visible as
near-black `0x000008`, a background index whose colour is black is transparent. A shadow colour resolves through the
font of the text (the original through the font current at `SetFontShadow`). The stub font palette names the
`Font_Control.h` colours with authored RGB values; its `DEFAULT_SHADOW` is black, so stub text exercises the near-black
rule.

**Measuring and alignment** (`src/ui/text/measure.ts`, `print.ts`). Advance = width + x offset, no kerning
(`Font.cc:93-110`); `CenterAlign` = `x + (w − len + 1) / 2`, `RightAlign` = `x + w − len`, `HCenterVCenterAlign`,
`HRightVCenterAlign`, all C integer division (`:295-322`). `DrawTextToScreen` centres with `(w − len) / 2` without the
+1, wraps the position as UINT16 and keeps the shadow from the previous call, so layouts give the shadow explicitly;
`TEXT_SHADOWED` draws a `ShadowRect` behind the text; `ReduceStringLength` truncates with up to three dots.

**Word wrap** (`wrap.ts`). `LineWrap` (`Utils/WordWrap.cc:33-96`, Stracciatella's rewrite) breaks at spaces (the break
space is dropped), after hyphens and before any code point ≥ U+4E00; a word longer than the line is split where it
overflows. Its quirks are kept: the overflowing character of a split word is not counted, and CJK text breaks one
character early. `DisplayWrappedString` line height = font height + gap. `IanDisplayWrappedString` /
`IanWrappedStringHeight` (`:180-524`) wrap by words with the in-text codes 177 newline, 178 bold toggle
(`FONT10ARIALBOLD`, shadow off), 179 centre, 180 colour (always 184), 181 default colour; the height pass does not
consume 180's argument. Message boxes, popups, mail and laptop pages use them, and mail and files break into pages by
the measured height, so the measure is exact. `CleanOutControlCodesFromString` strips the codes.

**Numbers, money and text sources.** `printf.ts` formats the string tables' printf templates; `SPrintMoney`
(`money.ts`) puts the minus after the dollar (`$-1,234`, `Laptop/Finances.cc:954-979`); weights follow the metric
option (`weight.ts`); EDT fields come from `edt-text.ts` (`{edt: [file, field]}`, the field index flattened over the
record's columns); strings from `text-service.ts` (the L10n tables of `data/externalized/strings`, `27` §5).

**Language-dependent art (MLG).** 33 pictures with baked-in text (main menu buttons, the options and save/load
headers, the PBI panel, the map screen's sort buttons, 27 laptop pictures) are chosen by the **data version**, not the
display language (`GameRes.cc:70-308`; `data/tables/mlg.json` from `tools/transcribe/mlg.ts`). Layouts name the MLG id,
never a path; with a display language other than the data's these pictures keep the data's language (`27` §5.2).

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
- **Software cursor**: composed every frame and drawn last into the frame, clipped to the cursor's size, with
  `cursor: none` on the stage; hidden when the pointer leaves the stage and on screens that hide it (fades, loading
  screens, the San Mona and black screens). A CSS cursor cannot scale with the canvas or carry live text.

### 3.6 Shared widgets

| Widget | Original | ja2-node |
|---|---|---|
| Popup box and menu | `Utils/PopUpBox.cc` | `PopupBox` (`src/ui/widgets/popup-box.ts`): the background cropped, 2×2 corners, 16×2 and 2×8 edge pieces with the overlapping last piece, the line states (normal, highlight, shade, secondary shade), the second column, auto-resize; `PopupMenu`: line regions at `HIGHEST − 4` over a screen mask that closes it on an outside click. The map screen's assignment menus, the tactical movement and door menus |
| Merc popup box (text box) | `Utils/MercTextBox.cc` | `MercTextBox`: `PrepareMercPopupBox` sizes with the 349×199 cap (the height clamped at 199 instead of throwing), 10-pixel border tiles over a tiled background, Ian wrap, the styles BASIC (`interface/tactpopup.sti`), red-on-white, blue-on-grey, laptop, I.M.P., icons, colours by background. Subtitles, message boxes, civilian quotes, laptop popups |
| Message box | `MessageBoxScreen.cc` | `MessageBox` (`message-box.ts`, a modal, §4.6): 300 wide with margins 40/10/30, centred on the screen or a rectangle, a full-screen `HIGHEST` back region with the style's cursor, every button set at the original positions, its keys as a hotkey table on release, the UI clock paused, `pauseGame` called (§1.4), the screen frozen under it (its draw list, not pixels), its buttons sounding with the underlying screen's scheme. No pointer warp onto a button (deviation "Pointer warp") |
| Slider | `Utils/Slider.cc` | `Slider`: both styles, thumb `interface/sliderbox.sti`, range 0–127, the off-region drag from the pointer's y, wheel steps, the inverted value, `SetSliderValue` ignoring the maximum |
| Text field | `Utils/Text_Input.cc` | `TextFieldGroup`: the default bevel scheme, full text and numeric filters, selection, caret keys, Tab order, Ctrl+Delete, unmodified keys swallowed while editing, the caret on the UI clock, `ENTERING_TEXT`/`REMOVING_TEXT`; no editor input types and no IME (deviation "Text input") |
| Progress bar | `Utils/Animated_ProgressBar.cc` | `ProgressBar` (the load bar and the panel style), driven by the client's preload (§4.10) |
| Fade | `Fade_Screen.cc` | `Fade`: 11 steps out then black, 9 in, 16 ms each on the UI clock; a step multiplies the frozen frame by 0.8^k once instead of k shade-table passes (deviation "Fades"); no cursor during a fade |
| Snapshot zoom | laptop open/close (`Laptop/Laptop.cc:1048`, `:1430`), A.I.M. video window, autoresolve opening, sector change (`Strategic/StrategicMap.cc:227-237`) | `SnapshotZoom`: render-to-texture (the `capture` and `snapshot` draw items) with `BltStretchVideoSurface`'s stepping in the shader; the 2 s sector-change zoom is not built |
| Drop-down, frame animator, portrait, item picture | laptop pages | `drop-down.ts`, `frame-animator.ts`, `portrait.ts` (a face by index and size, dead faces shaded, unavailable ones under `ShadowRect`), `item-picture.ts` (the inventory graphic centred in a cell, optional shadow) |

### 3.7 Screens, modals and frame order

The original switches whole screens (`ScreenIDs.h`, `Screens.cc:20-48`) with per-screen entry and exit flags inside
`HandleScreen`, pseudo-screens for message boxes and fades, a 16-bit frame buffer with dirty rectangles, background
save/restore rectangles and a save buffer. ja2-node keeps the observable rules and drops the mechanism:

- the screen and modal stacks of §2.2; leaving a screen deletes its widgets and regions; modals receive input first;
  the screen under a message box neither updates nor takes input but stays visible (its frozen draw items);
- a full redraw of the draw list every frame from the retained widgets, no dirty rectangles, background rectangles or
  save buffers (the page skips presenting an unchanged frame, §2.2);
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
  possible (there is no remap UI). The tactical keys are code that follows `GetKeyboardInput` (§6.3).
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

The tooltip renderer, the software cursor, the region dispatcher, the modal stack, fades and snapshots are not placed
by layouts.

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
   screen with the y in std640). A `LayoutView` may take a run-time `origin` (the talk panel, the help screen).
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

**Bindings contract.** Each controller exports `actions` and `bindings` with types; `src/ui/screens/contracts.ts` maps
layouts to controllers. `src/ui/layout/layouts-contract.test.ts` loads every layout of every skin and checks the schema,
bindings and actions both ways (or `unsupported`), provenance, literals only in debug layouts, an explicit shadow on
every non-debug text, a stub size on every asset, known fonts, cursors and string keys (`data/tables/l10n.json`), and
every asset, frame and EDT file on a built stub pack; with `JA2_DATA_DIR` every asset and frame on the original data
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

## 4. Front-end screens

Coordinates are in the `std640` frame; text comes from the externalized L10n tables
(`data/externalized/strings/translation-*.json`) unless an EDT file is named. Controllers: `src/ui/screens/front-end/`;
layouts: `main-menu`, `game-init`, `options`, `save-load`, `credits`, `loading`, `exit-box`, `san-mona`,
`screen-unavailable`, `message-box`. The screens reach the server through `FrontEndClient`
(`src/ui/client/front-end-client.ts`; `HttpFrontEndClient` in `src/app/game/`: REST for saves, sessions and status, the
socket for an in-place load and `setOption`). The launcher's DOM-free logic lives in `ui` and both use it: labels and
string ids, save rows and the save controller, the campaign form and REST types, the settings model (`src/ui/settings.ts`;
`src/app/settings.ts` keeps the `localStorage` wrapper), the credits roll, and `MessageBoxes` (`src/ui/message-boxes.ts`:
`confirm`, `alert`, `ask` with OK, YES/NO, OK/SKIP, YES/NO/LIE, CONTINUE/STOP and numbered buttons; DOM in the launcher,
`CanvasMessageBoxes` on the canvas).

### 4.1 Screen flow

```
MAIN MENU ── New Game → GAME INIT ── Cancel/Esc → main menu
   │                         └─ Start → confirmations → (Dead is Dead: SAVE screen names the save) → fade, music off,
   │                                    the beginning videos → laptop (nobody hired)
   ├─ Load Game → SAVE/LOAD (load) → loading screen → the saved game screen (map, tactical or laptop)
   ├─ Preferences → OPTIONS (Save disabled) ── Load → SAVE/LOAD; Main Menu → confirm → main menu
   ├─ Credits → CREDITS → main menu
   └─ Quit → the launcher
in game: o → OPTIONS; Ctrl+S / Ctrl+L → SAVE/LOAD; h → help; Alt+X → "exit game?"
story: meanwhile box → back (no scene playback); Queen's death → ending videos → CREDITS (no music) → main menu
```

The original starts with the splash video (`intro/splashscreen.smk`; an MLG still on other data versions),
`interface/sirtechsplash.sti` and a fade, and starts the main menu music on the last frame of that fade
(`MainMenuScreen.cc:118-145`). `/play` opens on the main menu at once and starts its music after the first click or key;
the launcher plays the splash (deviation "Game page start"). `FrontEndFlow` moves between the screens like the
original's exit screens: save/load returns to the screen that opened it, a save from the options returns to the game,
fades go around a load and the new game. Music: `MAIN_MENU` with no session (`FrontEndMusicPlayer`; the session
computes the mode only in game, `27` §3.5), nothing for the new game, the session's music in a game. `27` §4.1 tables
the video sequences; `src/app/video/sequences.ts` plays them (`beginningPlan`, `endingPlan`).

### 4.2 Main menu (`MainMenuScreen.cc`)

- Art: `loadscreens/mainmenubackground.sti` at (0,0), `loadscreens/ja2logo.sti` at (188,15) (`:56-57`, `:368-372`);
  five buttons from the MLG `MLG_TITLETEXT` picture (`loadscreens/titletext.sti`) with frames (grayed, off, hilite, on):
  New 0/0/1/2, Load 6/3/4/5, Preferences 7/7/8/9, Credits 13/10/11/12, Quit 14/14/15/16 (`:330-338`), centred on the
  logical screen width at y = 277 + 37·i (`:48-49`, `:340-349`), `MSYS_PRIORITY_HIGHEST`; the version at the bottom
  left in `FONT10ARIAL` white at (10, H − 15) and `gzCopyrightText` centred at y = H − 15 (`:374-381`,
  `UILayout.cc:137`), both on the logical screen.
- State: Load is grayed when no save exists (`GET /api/saves` lists ja2-node and native saves; the original counts
  every `.sav`, `SaveLoadScreen.cc:1427-1430`). The version label shows the package version and commit.
- Keys on release (`HandleMainMenuInput`): `c` load, Alt+C load the newest save, `o` options, `s` credits, Ctrl+Q quit.
  Alt+click on Load and Alt+C load the newest save without the warning box, as `gfLoadGameUponEntry` does. A bare Esc
  does nothing and Quit and Ctrl+Q go to the launcher (deviation "Main menu Esc, Quit and the exit box").

### 4.3 Game init options (`GameInitOptionsScreen.cc`)

- Title `gzGIOScreenText[0]` `FONT16ARIAL` white centred at y = 68; four radio groups: Difficulty (80,150), Guns
  (350,150), Save mode (80,300), Style (350,300); the group label 35 px above, option text at x + 20, boxes at x + 155,
  y − 9, rows 35 px apart (`:39-74`); Iron Man and Dead is Dead get a `FONT12ARIAL` explanation 220 px wide (`:482`,
  `:486`); Start (141,418) and Cancel (379,418) from `interface/preferencesbuttons.sti` 0/2 and 1/3, `FONT14ARIAL`
  colour 73. Background `interface/optionsscreenbackground.sti`, a shadow rectangle (48,55)–(592,408), boxes
  `interface/optionscheck.sti`. Defaults from `InitGameOptions` (`GameSettings.cc`).
- Start: Iron Man → a YES/NO warning (No resets to save anywhere), Dead is Dead → its warning, then the difficulty
  confirmation `zGioDifConfirmText[difficulty]`; with Dead is Dead an OK box (`str_dead_is_dead_mode_enter_name`), then
  the save screen in save mode names the save; else fade, music off, the beginning videos. Cancel or Esc (on press) →
  main menu. Enter acts on its release and goes through the same confirmations (the original's Enter starts on
  key-down and skips them; deviation "Game init Enter").
- The new campaign: `campaignRequest` (`src/ui/client/campaign-form.ts`) → `POST /api/sessions {campaign: {options,
  hire: []}}`: **`hire: []`** opens the laptop with nobody hired, as the original does (the default squad and "land at
  once" stay launcher and developer options). Blood and gore is not on this screen in the original (it is a per-user
  toggle of the options screen) but is a campaign option in ja2-node (`27` §2.2): the screen sends the client setting
  `bloodAndGore`. A new Dead is Dead game sends the typed description (`campaign.deadIsDeadDescription`) unless the
  player chose an existing row, and the server derives a valid save name with the player saves' slug rule (`27` §1.6).

### 4.4 Options (`Options_Screen.cc`, `GameSettings.h`)

- 23 toggles in two columns (11 + 12; Stracciatella shows the three vanilla hid): speech, mute confirmations,
  subtitles, key-advance speech, animate smoke, blood and gore, don't move mouse, old selection method, always show
  movement path, show misses, real-time confirmation, sleep/wake notification, metric system, merc always lit, smart
  cursor, snap cursor to door, glow items, tree tops, wireframe, 3D cursor, merc casts light, hide bullets, tracking
  mode (`GameSettings.h:9-54`, defaults `GameSettings.cc:144-166`); three vertical sliders (effects, speech, music,
  0–127); Save, Load, Main Menu, Done.
- Art and layout: `interface/optionscreenbase.sti`; the MLG `MLG_OPTIONHEADER` frame 0 at (0,0) and 1 at (0,434);
  buttons frames 2/3 at y 438, x 51, 190, 329, 469 (`:56-60`), from the plain `interface/*addons.sti` as in
  Stracciatella; check boxes `interface/optionscheckboxes.sti` at x 265 and 428 from y 89, 27 px apart (`:63`,
  `:75-77`); labels `FONT12ARIAL` colour 73 at box + 30, wrapped at 143 px, white when highlighted, their regions sized
  by the text; tooltips `zOptionsScreenHelpText[i]` on box and label; slider labels centred in 45 px at x 38, 85, 137,
  y 87; sliders at x 56, 107, 158, y 126, length 258 (`:82-102`).
- Behaviour (`options.ts`): a toggle applies at once; a click on a label plays `BIG_SWITCH3` at `BTNVOLUME`; speech and
  subtitles cannot both be off (`OPT_NEED_AT_LEAST_SPEECH_OR_SUBTITLE_OPTION_ON`, `speechOrSubtitlesKept`); the effects
  and speech sliders play a test sample 75 ms after they stop (`sounds/weapons/lmg reload.wav`, `battlesnds/m_cool.wav`),
  music applies at once (`settings-store.ts` applies volumes to the audio engine and the music); Save is enabled only
  in a game that can save and not in Dead is Dead; Main Menu asks `OPT_RETURN_TO_MAIN` YES/NO, then closes the session
  (`closeSession`, the Dead is Dead save point, `04` §6.7); every exit (Done or Esc) writes the settings; the screen
  holds game time (§1.4).
- Mapping (`OPTION_TOGGLES`): `speech`, `muteConfirmations`, `subtitles`, `keyAdvanceSpeech`, `sleepWakeNotification`,
  the other 17 under `display.*` of the client settings, `volumes.effects/speech/music`; blood and gore → `setOption
  {bloodAndGore}` in a session (`04` §6.27) and the client default otherwise. Every toggle takes effect except these
  inert ones: don't move mouse (no pointer warp in a browser;
  deviation "Pointer warp"), old selection method (the canvas always uses the new one), show misses, smart cursor, 3D
  cursor (the option only prints its message). ja2-node extras (ambient and master volume, playback speed, language,
  splash and intro switches, UI scale, settings export and import) stay in the launcher: the original screen has no free
  space.

### 4.5 Save/load (`SaveLoadScreen.cc`)

- ja2-node saves follow Stracciatella's named list (`27` §1.6): 11 rows on screen out of a scrolling list, newest
  first; in save mode quick and auto saves and native saves are hidden and the first row is "create new savegame"
  (`MSG_NEW_SAVE`). Row fields: `Day N, hh:mm`, location, `n merc(s)`, balance, description, a Dead is Dead mark; in load
  mode a tooltip with difficulty, save mode, guns and style (`:808-965`, `:874-904`). Native saves are listed in load
  mode (`saveRow` handles both kinds); download, upload and "load into another session" stay in the launcher.
- Art: `interface/loadscreen.sti`; the MLG `MLG_LOADSAVEHEADER` frame 0 (load) or 1 (save) at (0,0); Cancel 6/9, Load
  4/7, Save 5/8 at x 329 and 123, y 438, `FONT14ARIAL` colour 73, the action button hatched when disabled. Rows: vanilla
  draws them from `loadscreenaddons.sti` frames 2 and 3 (605 px); Stracciatella narrows rows to 575 px for its own
  scroll bar art (`sti/interface/save-load-addons.sti`, `scroll-bar.sti`), which is Stracciatella's asset, not game
  data. ja2-node clips the vanilla row frames to 575 px and draws the scroll bar as a custom renderer of fills and lines
  (deviation "Save/load screen art"). Row origin (17,49), height 30, pitch 35; fields at x + 13, 95, 196, 260, 318;
  `FONT12ARIAL` with per-state colour and shadow; the description field `FONT12ARIALFIXEDWIDTH`, 46 code points
  (`:70-121`, `:1095-1121`).
- Input: a click selects (in save mode the new row opens the description field), a double click saves over or loads,
  a right click clears the selection, the wheel, the scroll buttons and Up/Down scroll, Enter saves or loads, Delete
  asks `SLG_CONFIRM_DELETE` and deletes, Esc clears the selection first, then leaves.
- `SaveController` (`src/ui/saves/save-controller.ts`, shared with the launcher's save panel over a `SaveApi`): save new
  (`save {description}`), save over after `SLG_CONFIRM_SAVE` (`{name, description}`), load after one warning box from
  `predictLoadWarnings` (`save-rows.ts`), from the main menu into a new session (`POST /api/sessions {load}`; native
  saves are imported), in game in place through the WebSocket `load` (a fresh `welcome`), then the screen of the
  header's flow; a load error stays on the screen (the session is untouched); the refusal texts.
- Location column: the save header carries the sector code only, so the row shows the code instead of
  `GetSectorIDString`'s town or land-type form (deviation "Save list in the launcher and on the canvas").

### 4.6 Message box (`MessageBoxScreen.cc`, `Utils/MercTextBox.cc`)

The `modal` widget over `MessageBox` (§3.6), layout `message-box.json` (the six styles of `g_msg_box_style`, the text
box art and their stub sizes). Styles: BASIC (`interface/tactpopupbackground.pcx` tiled, `interface/tactpopup.sti`
9-slice, `interface/popupbuttons.sti` 61×20 or small 31 px, `FONT12ARIAL` white, 10 px margins), red-on-white and
blue-on-grey (laptop), I.M.P., laptop; icons `interface/msgboxicons.sti`, `msgboxiconskull.sti`. Button sets OK,
YES/NO, CONTINUE/STOP, OK/REHIRE, generic two and three buttons, YES/NO/LIE, OK/SKIP, four numbered; labels
`pMessageStrings` (OK, YES, NO, LIE, SKIP, REHIRE); keys y/n/Esc/Enter/o/1–4 on key-up.

### 4.7 Help screens (`HelpScreen.cc`, `HelpScreenText.h`, `binarydata/help.edt`)

- Six help screens (`HelpScreen.h:7-20`): laptop (8 pages), map screen (8), map "no one hired yet", map "not yet in
  Arulco", sector inventory, tactical (6). Their texts are rows of `help.edt` (records of 640 characters) with the Ian
  codes; `help-pages.ts` builds titles, page buttons and paragraphs, with the loops that add a font height after each
  paragraph and the laptop's one-paragraph pages that do not, and `HelpScreenDetermineWhichMapScreenHelpToShow`.
- The overlay (`help-overlay.ts`, layout `help-screen.json` placed at run time; constants from `HelpScreen.h`,
  `HelpScreen.cc`, `HelpScreenText.h`): 412×292 with page buttons, 320×292 without, centred over the screen and
  vertically over the end of the viewport, in the laptop over its monitor; the full-screen mask, the button border and
  background of `interface/helpscreen.sti`, title `FONT12ARIAL` white and the "(press H)" line, the footer and the
  "don't show again" check box when it came up by itself, the text (`FONT10ARIAL` white in a 280 px column, 228 px
  visible) and the scroll box as custom renderers, the exit button, the page buttons, two arrows (`:39-118`,
  `:1792-1925`). It pauses the game (§1.4).
- Scrolling (`help-scroll.ts`): the clamps of `ChangeTopLineInTextBufferByAmount`, the FLOAT scroll box of
  `CalculateHeightAndPositionForHelpScreenScrollBox`, the drag with the grab offset, three wheel lines. Keys
  (`GetHelpScreenUserInput`): Left/Right on release change the page (clamped), Up/Down and PgUp/PgDn on release and
  repeat scroll, Esc on release closes; the check box sets the hide flag only when the screen came up by itself.
- When (`help-system.ts`, `ShouldTheHelpScreenComeUp`): a forced screen (`h`) at once; a screen whose bit is unseen
  and not hidden on its third frame, the count restarting on a new screen; the bit is marked seen when the screen comes
  up, forced or not; never while a modal is up or, in tactical, while a pre-battle prompt is open. A session without a
  campaign identity (a sandbox) never shows a help screen by itself.
- `src/app/game/help-host.ts` loads the layout and `binarydata/help.edt` (through the EDT cache), runs the system every
  frame on the tactical, map and laptop screens (an open sector inventory picks its own help), and keeps the seen mask
  in the client settings per campaign identity (`helpScreensSeen[campaign]`, `04` §6.24) and the hide flag
  (`helpHidden`); the original saves the mask in the savegame and zeroes it on a restart (deviation "Help screens
  seen"). `h` reaches it from the tactical keys, the map screen's `help` action (which first ends route plotting with
  the "unchanged" message) and the laptop. The stub pack's `help.edt` (`stubs/text/help.json`, all 123 records, own
  texts) has pages long enough to scroll.

### 4.8 Credits (`Credits.cc`)

`interface/credits.sti` background with 15 developer faces (`interface/credit faces.sti`; the closed-eye frame of face
i is frame 3·i at the face's eye position), each blinking at its own frequency (`gCreditFaces`) with the eyes closed
150 + `Random(150)` ms on the client PRNG; on entry every face blinks at once, because of the original's unsigned clock
difference. The text scrolls up 1 px every 25 ms in a 210 px column at x 10, drawn in bitmap fonts (body `FONT12ARIAL`,
titles `FONT14ARIAL`, the `C`/`R` colour codes); hovering a face shows name, title and joke line at (375, 420/435/450),
`FONT12ARIAL` white, 260 px centred; Esc (on release) ends. The roll is `src/ui/screens/credit-roll.ts` over the parser
`src/content/formats/credits.ts` and the row feed `src/app/credits/rows.ts`; the controller is `credits.ts`. After the
ending the credits play without music. The launcher keeps a DOM scroller (`src/app/credits/scroller.ts`, deviation
"Credits screen").

### 4.9 Fades (`Fade_Screen.cc`)

Fade-out darkens 10 steps then black, fade-in 8 steps; used around game init → intro, loads, the meanwhile box, the
Queen's death, the end cinematic and the San Mona screen. ja2-node: the `Fade` modal (§3.6), fixed 16 ms steps, no cursor
during a fade.

### 4.10 Loading screens (`Loading_Screen.cc`, `Utils/Animated_ProgressBar.cc`)

- The picture by sector and day or night (`GetLoadScreenID`, `:25-97`): game just started → helicopter; sectors in
  `data/externalized/loading-screens-mapping.json` → their day or night picture; SAM sector → SAM; else by
  traversability (town → one of two town pictures, sand, farmland/road, plains, forest/swamp, tropics/water); level 1 →
  mine, levels 2–3 → cave. Pictures `loadscreens/ls_*.sti` (640×480 RGB565); the hard-coded ones by id are
  `data/tables/load-screens.json` (`tools/transcribe/load-screens.ts`), the externalized ones follow from index 27.
- **The town choice draws `Random(2)` from the gameplay generator** at every sector entry outside a save load and the
  PBI transition (`:48-51`, `Strategic/StrategicMap.cc:245-253`) and again at every save for the header
  (`SaveLoadGame.cc:372`). The simulation draws the entry roll (`src/sim/strategic/map/loading-screen.ts`) and sends the
  picture as `sectorLoaded.loadScreen`; the save-time draw is not made (a ja2-node save never changes the state, `27`
  §1.3).
- The screen (`loading.ts`, layout `loading.json`: the 43 pictures by id): the bar at (162,427), 318×16, red for a
  sector, blue for a save load, filled from x + 2, follows the client's preload of the next screen's assets (deviation
  "Loading screen bar"). The tactical and map screens show the picture of the last `sectorLoaded.loadScreen`; a save
  load shows `LOADINGSCREEN_NOTHING` (`ls_heli.sti`) until a picture id arrives. A picture other than the default loads
  when it is first shown.
- The 2 s zoom from the map into the sector (`StrategicMap.cc:196-243`) is not built.

### 4.11 Exit, quit, errors and the San Mona screen

- Alt+X in tactical, the map screen, the laptop, the shop, autoresolve and the overhead map: YES/NO `MSG_EXITGAME` in
  the screen's style (`GameLoop.cc:278-311`; `exit-box.ts`, the laptop, map and game variants of
  `HandleShortCutExitState`). Yes leaves the game for the main menu; the session stays on the server unless the player
  chose Main Menu in the options, which closes it (deviation "Main menu Esc, Quit and the exit box").
- A laptop, map or tactical screen that cannot open (its load throws, or the host has no session client for it) shows
  the debug layout `screen-unavailable` (`screen-unavailable.ts`): which screen could not open, the reason
  (`src/ui/client/failure-text.ts` names the browsers' network failures, "Failed to fetch" and its Firefox and Safari
  wordings, and a lost connection; any other error stays as it is), the session, the in-game keys, Retry (Enter:
  reconnects to the session, then enters the game again; on failure the panel shows the new reason) and Main menu
  (leaves the session running). A page that fails to boot shows the same heading, reason and Retry as plain HTML
  (§2.2). A WebSocket that drops during play is not handled: there is no "connection lost" panel.
- The San Mona brothel screen (`JAScreens.cc:416-499`; `san-mona.ts`, layout `san-mona.json`): black, no cursor,
  `interface/luckysmile.sti` centred, a step every `SMILY_DELAY` (100 ms): frame 0 for the first 24 steps, then step
  modulo 8; after 32 steps `SMILY_END_DELAY` (1 s); `sounds/sex.wav` at `HIGHVOLUME`; then a fade into tactical. The
  `sexScene` event opens it. The original then warps game time by `5 + Random(20)` minutes without processing events
  (`:478-483`); the simulation makes that warp and its draw at the action (`25`). The screen holds the real-time driver
  like a modal (deviation "San Mona screen and time").
- The original has no defeat screen (`26` §6.8).

### 4.12 Front-end hotkeys

| Keys | Where | Effect |
|---|---|---|
| c, Alt+C, o, s, Ctrl+Q (key up) | main menu | load, load newest, options, credits, quit to the launcher; Esc does nothing |
| Esc (down), Enter (up) | game init | cancel, start (through the confirmations) |
| Esc, s, l (down) | options | done, save screen, load screen |
| Up/Down (down, repeat), Enter, Delete, Esc (up) | save/load | move, save or load, delete, clear or leave |
| y/n/o/Enter/Esc/1–4 (key up) | message boxes | the box's buttons |
| Esc, Up/Down, PgUp/PgDn, Left/Right | help | close, line, page, previous/next page |
| Esc / Space / click | intro videos | end the sequence / end the video |
| Esc (up) | credits | end |
| Alt+X | tactical, map, laptop, shop, autoresolve, overhead map | "exit game?" |
| Alt+Enter (up) | everywhere | fullscreen |
| Ctrl+S, Ctrl+L, o, h | tactical, map | save screen, load screen, options, help |
| Ctrl+F | everywhere | the diagnostics overlay (`04` §6.30) |

Alt+S and Alt+L (quick save and load) are not wired on the canvas (deviation "Tactical keys not yet ported"); `v` prints
the version and gun option lines in tactical only.

---

## 5. Tactical screen: panels

Geometry (`UILayout.cc:57-138`): the team panel is 120 px high at `H − 120` (slots of 83 px + a 142 px button box); the
single-merc (SM) panel is 140 px high at `H − 140` and overlaps the bottom 20 px of the viewport (the viewport always
ends at `H − 120`; only the mouse window moves). Above 640×480 the bar is centred and the team panel has
`max(6, min(squad_size, (W − 142)/83, 12))` slots (`teamPanelSlots`, `src/ui/layout/frames.ts`; six with the shipped
`squad_size` 6; extra slots copy the sixth slot's art); the SM panel repeats its art and stretches a filler from
`interface/overheadinterface.sti`; the sides are black (`Interface_Panels.cc:852-901`). Panel switching (`SetNewPanel`,
`Interface_Control.cc:62-90`, applied on the next update like `HandleTacticalPanelSwitch`): right-click a team face →
SM panel (not for the dead, escorts or passengers), right-click the SM face → team panel, `` ` `` toggles, non-merc
bodies and escorts keep the team panel. Constants: `Interface_Panels.cc:84-251`, `Interface_Items.cc:88-183`,
`UILayout.cc`. Draw order: panel art → face → overlays → slots → popups.

The tactical screen (`src/ui/screens/tactical/tactical-screen.ts`) has three layouts: `tactical-team.json` (frame
`tacticalPanel`), `tactical-sm.json` (frame `tacticalInventory`, with the description box and pickup menu geometry) and
`tactical-hud.json` (top bar, overhead labels, radar and squad list, clock, message log, pause mask, feedback box; keys
o, Ctrl+S, Ctrl+L, Alt+X); `panel-models.ts` builds the view models of `team-panel.ts` and `sm-panel.ts`.
`TacticalHost` (`src/app/tactical/tactical-host.ts`) loads per session the soldier assets, frames, effects, light
templates, the world view, sounds, layouts, the item catalogue, profiles and the radar map. The screen is kept across
the options and save/load screens and rebuilt after a sector change; entering starts the real-time driver at speed 1
unless it already runs.

### 5.1 SM panel (`RenderSMPanel`, `Interface_Panels.cc:1245-1440`)

| Element | Reads | Notes |
|---|---|---|
| `inventory_bottom_panel.sti`, face plate (gold when selected on our turn, the other plate when disabled for items) | selection, turn | |
| Face 48×43 at (13,6) | §5.5 | |
| Life, breath, morale bars at (69,47) | `life`, `lifeMax`, `bleeding`, `breath`, `breathMax`, `morale` | §5.6; tooltips life/max, breath/max, the morale text |
| AP (67,53) `TINYFONT1`, only in combat above `OKLIFE` | `ap`; light yellow in stealth | the original's dark red below `MinAPsToAttack` on the last target and light blue under the influence: dark red only for negative AP (deviation "Tactical HUD details") |
| Name (11,53) `BLOCKFONT2` | `name`, `stealth` | |
| Ten stats, labels colour 6, values colour 5, `"%3d"`; green for 60 s after a rise, red after a fall | `stats` | flashes from `statChanged` events |
| Armour %, weight %, camo % | `armour`, `weight`, `camo`, computed by the server | `ArmourPercent` (`Weapons.cc:123-147`), `CalculateCarriedWeight` |
| Body figure (four bodies, `_h` highlight variants), drop target for camo kits, canteens, elixir | body type | `applyItem` |
| 19 slots (§5.3), key ring icon, money region | `inventory`, `keys` | money: §5.9 |
| Buttons: stance up/down, stealth (one image per stance), climb, burst mode (one image per weapon mode), look, level view, hand, talk, mute, prev/next, options, Done, Map | §5.2 | |

Stracciatella's `gui_extras` stat progress bars stay off: they reveal hidden profile progress (D16); vanilla has them
off.

### 5.2 SM and team panel buttons

| Button | ja2-node | Enabled (original, `EnableSMPanelButtons`) |
|---|---|---|
| Stance up / down | `stance` (the next height up or down) | not standing / a valid lower stance; every action button is off when the merc is not the selected one, below OKLIFE, not on our turn, or the panel is disabled for items |
| Stealth | `stealth {soldiers, on}` (logs the line the z key logs; deviation "Stealth button message") | as stance |
| Climb | `climb`, then the fence `jump` | enabled whenever the merc may act; the server refuses where he cannot climb (deviation "Tactical HUD details") |
| Burst mode | `weaponMode`: normal → burst → under-barrel launcher | a burst-capable gun or an attached launcher in the hand |
| Look, hand, talk | toggle the input's cursor modes (§6.1) and show their state | |
| Level view | the client's interface level | |
| Mute | `mute` (a presentation flag the server keeps so speech and sound agree) | |
| Prev / next merc | client selection | |
| Options | options screen | not with an item in the cursor |
| Done | `endTurn` | our turn in combat |
| Map screen | `mapScreen`; in a boxing match "abandon fight?" first | not in a conversation or the pickup menu |
| Team panel: End turn, Map, Squad (radar ↔ squad list) | `endTurn`, `mapScreen`, client | |
| Team face left / right click | locate and select (a halted move continues with `continueTo`), open the SM panel | |
| Team enemy indicator | cycles the enemies the merc sees (`CycleVisibleEnemies`) | |
| Team hand slots | right click `swapHands` | the second hand of a driver or passenger ("Exit Vehicle", `TMClickSecondHandInvCallbackPrimary`) is not built: there is no tactical `leaveVehicle` |

While an item is in the cursor or a stack or key-ring popup is up, every action button, Options, Done, Map and the
radar are disabled; prev/next stay enabled so the item can be carried to another merc. Inside the shop only the
inventory and prev/next work (`ShopKeeperInterface_SetSMpanelButtonsState`).

**Selection** follows `HandleLocateSelectMerc` with the new selection method: below `OKLIFE` and with Alt only locate;
a second click on the selected merc locates him with a radio locator, a third recentres; another merc is selected with
the attention sound. `SelectSoldier`: a merc who cannot act refuses with `MERC_IS_UNAVAILABLE_STR` in the log and the
feedback box; the interface level follows the merc. **A merc's death** (the frame in which his life reaches 0, or
`soldierDied`) darkens his face (closed eyes, hatch), plays `p_close.sti` then `p_dead.sti` over it every 160 ms, and
then leaves the skull hatched in his slot with his name until the panel is rebuilt (`SetCurrentSquad`,
`RebuildCurrentSquad`: a squad change or entering the screen again), although the view drops him at once (deviation
"Dead merc's slot"); a click on the skull only centres his last tile. When the selected merc dies he stays selected
through the animation, then the next merc of his squad who can act is selected (`UpdateCurrentlySelectedMerc`), or
nobody.

### 5.3 Inventory slots and items (`Interface_Items.cc`)

- 19 slots at `UILayout.cc:72-90` (tactical) and `:93-111` (map screen), sizes from `gSMInvData`; what fits where is
  the server's (`placements` hint, §2.4), never re-implemented.
- Per slot (`item-tile.ts`, `INVRenderItem`): the second hand covered by `secondary_gun_hidden.sti` under a two-handed
  weapon; the small item graphic centred with a drop shadow at (−2,+2) and the index-254 outline (transparent; white for
  compatible items; a grey ramp for new items, 20 steps every 100 ms for 4 cycles); the hatch when the cursor item
  cannot go there; a 2 px status bar at (x−5, y+21), 20 px; texts in `TINYFONT1`: rounds left coloured by ammo type,
  "JAMMED" (view `jammed`), stack count, `*` for attachments, `*`/`+` for burst or launcher mode; tooltip with name,
  calibre (not for Gun Nut where the calibre says so; `calibre.showInHelpText` of the item catalogue), `[imprint]`
  (view `imprint`), attachments.
- Compatible-item highlight after 100 ms on a slot; with an item in the cursor the squad faces of mercs with compatible
  items get a red rectangle.
- Item graphics: small `interface/mdguns.sti`, `mdp1items.sti`, `mdp2items.sti`, `mdp3items.sti`; big `bigitems/*.sti`;
  world tiles from the tileset's GUNS/P1ITEMS/P2ITEMS/P3ITEMS; `ItemDef` (`src/content/items/items.ts`) parses
  `inventoryGraphics` and `tileGraphic`, and the item catalogue `GET /api/items?lang=` serves them (`04` §6.7).
- **Item cursor** (`inventory.ts`, `item-cursor.ts`; deviation "Item cursor on the canvas"): the client keeps a local
  selection (soldier, slot, count, index) drawn as the mouse cursor, and the slot shows the item hidden or with one
  object less until one command ends the cursor: `moveItem` (Shift takes the stack), `attach`, `moveItem {merge}` after
  the merge prompt, `applyItem`, `drop`, `give`, `toss`; an ejected magazine or a taken attachment ends in `unload` or
  `detach`. A refusal keeps the cursor; a swap shows the displaced item back in its slot; a cursor item does not survive
  a switch to the map screen. On the map, the cursor gives to a talkable soldier or a merc of ours within passing range,
  tosses (`toss`, with the catch of a merc of ours further away) beyond the next tile or at anybody else, and drops
  otherwise; the throw arc is not drawn (deviation "Tossing from the item cursor"). An item cursor without a drop
  command (a money split) is put back on a viewport click.
- Not built: Ctrl+click stack combining (`combineStack` exists as a command), moving keys in and out of the key ring.

### 5.4 Popups: stack, key ring, item description, pickup menu

- **Stack popup** (`Interface_Items.cc:3582-3763`; `item-popups.ts`): `extra_inventory.sti` cells, up to 6 per row,
  centred on the slot, the panel shaded behind; take or insert one object (`moveItem {count: 1, index}`), right click
  describes it.
- **Key ring** (`:3795-3936`): 28 cells, 7 per row, the key item's graphic (the view names the key item per lock), the
  count, sector and day found on right click; view only (`k` opens it).
- **Item description box** (`:1651-2661`; `item-description.ts`, `InitItemDescriptionBox`): tactical 320×133 at panel
  x+214, y+1 over the stats area (`infobox.sti`), map screen 272×268 (`iteminfoc.sti`). Big picture with shadow, status
  bar, name `BLOCKFONT2`, calibre and type, wrapped description, pros and cons, weapon stats (weight by the metric
  option, status, range, damage, AP, burst AP; white when exceptional), ROF bullets, the ammo button (ejects the
  magazine into the cursor), four attachment slots (`attach`, `detach`, the "permanent?" box), the money mode (§5.9).
  The computed stats, pros and cons come from the `itemInfo` hint. The original charges `AP_RELOAD_GUN` once in combat
  when the box closes with changed attachments (`Interface_Items.cc:2530-2588`); ja2-node charges each accepted
  `attach`/`detach` in combat (deviation "Attachment AP").
- **Item pickup menu** (`:4279-4647`; `pickup-menu.ts`, `InitializeItemPickupMenu`): `interface/itembox.sti`, 6 rows per
  page, the world tile graphic at shade 4, `BLOCKFONT2` names, All/OK/Cancel, paging, the wheel, the help texts. The
  original opens it after the merc reaches a tile with several items and pauses the game; ja2-node's `pickUp {items}`
  chooses before the walk, so the menu opens on the clicked tile and OK sends one `pickUp`; a single item is picked up
  without the menu (deviation "Pickup menu"). Esc closes, in order, the pickup menu, the description box, a popup, the
  item cursor.

### 5.5 Faces (`Tactical/Faces.cc`)

`faces.ts` (`InitFace`, `BlinkAutoFace`, `MouthAutoFace`, `HandleRenderFaceAdjustments`, `HandleAutoFaces`):

- Files: small `faces/NN.sti` (48×43), big `faces/bNN.sti`, `faces/33face/`, `faces/65face/` (map screen list),
  `faces/bigfaces/` (laptop); `NN` = the profile's face index (Elliot's beaten variants by `bNPCData`; Herve, Peter,
  Alberto and Carlo share a face). Animated STIs: 0 face, 1–4 eyes (lid down, lid up, frown, surprise), 5–7 mouth.
- The face record (eye and mouth positions, blink and expression frequencies, the small-face offsets of recruited
  RPCs) comes from the profile endpoint `GET /api/sessions/:id/profiles` (`04` §6.7); a soldier without a profile face
  gets the generic stub face of his body type (`generic-face.ts`).
- Blink every `blinkFrequency ± Random(2000)` ms (frames 1 → 2 → 0, eye steps of 50 + `Random(30)` ms); while talking a
  frown or surprise every `expressionFrequency` ms; no blinking asleep, below OKLIFE or as a prisoner; the client PRNG.
- **Lip sync** (`MouthAutoFace`, `:552-612`): while the face talks, the mouth is closed while the playing sample is
  inside a gap of its `.gap` list (`src/content/formats/gap.ts`, `PollAudioGap`), otherwise a new random frame every
  120 ms; with speech off the face talks for the subtitle duration. After the sample, 300 ms closed. The speaker, file
  and position come from the speech presenter's line and the voice handle (`VoiceHandle.elapsedMs`,
  `SoundDirector.speaking`).
- Overlays: closed eyes and hatch below consciousness, `p_dead.sti` + hatch when dead, the selection rectangle (white,
  blue moving, yellow stealth moving; the moving state follows the animation's moving flag, deviation "Tactical HUD
  details"), the red rectangle for compatible items, the enemy count box, the hatch when the merc cannot act (`canAct`),
  assignment icons (`portraiticons.sti`), the blinded, adrenaline and drunk icons; the hit flash from white to red at
  150 ms, run in its original steps from each `soldierHit`; shades below OKLIFE and at 0 AP (`InitFace`'s grey palette).

### 5.6 Bars (`Interface_Utils.cc:131-178`)

`bars.ts` (`DrawSoldierUIBars`, `DrawBarsInUIBox`, the item status bar): three bars 3 px wide, 42 px high at x, x+6,
x+12: life red `bLife`, the pink bandaged part `lifeMax − life − bleeding`, the yellow bleeding part on top; breath on
`bars.sti` (gold for the selected merc on our turn), black up to `breathMax`, dark blue for `breath`; morale green.
Nothing at life 0.

### 5.7 Radar and squad list (`TileEngine/Radar_Screen.cc`)

88×44 in the team panel's right box: the sector's `radarmaps/<map>.sti`, the green viewport rectangle, 2×2 dots for
visible soldiers by team colour (the selected merc blinking, unconscious enemies grey, hostile civilians red, named
civilians blue); a press and a drag move the camera (`RadarRegionButtonCallbackPrimary`, `RadarRegionMoveCallback`;
the arithmetic in `src/app/world/radar.ts`). The squad button swaps it for the squad list (`squadpanel.sti`, `COMPFONT`,
the current squad light green, others present dark green, absent black); choosing a squad sets the client's current
squad.

### 5.8 Talk panel and speech (`Tactical/Interface_Dialogue.cc`, `Dialogue_Control.cc`, `Civ_Quotes.cc`)

- **Speech presenter** (`SpeechPresenter`, `src/ui/speech.ts`): one queue for every quote event (`npcQuote`,
  `mercQuote`, `skyriderQuote`, `headMinerQuote`, `shopkeeperQuote`, conversation lines), each routed to a surface
  (`panel` for the open conversation's NPC, `tactical`, `external`, `shopkeeper`). The simulation finishes lines in
  ticks and never waits for a viewer (`04` §6.14); the client queues lines as playback reaches their frames. Per line:
  the voice (`speechPathForLine`, only with the speech option; a missing, dropped or silent sample counts as none), the
  subtitle when the subtitles option is on or the voice failed, the talking time (the sample, else 60 ms per character,
  `TEXT_DELAY_MODIFIER`), the 300 ms tail, the key wait of the panel face with key-advance speech, no click skip in the
  first 500 ms, Backspace (forced), Esc, `cutSpeaker` for critical battle sounds; the client reports a cut or finished
  line (`skipLine`; deviation "Talk panel and speech on the canvas"). `civQuote` goes to the civilian box: lifetime
  `(chars + 2) × 60 + 500` ms, a new quote replaces the old, a click closes it after 300 ms. Voices play through the UI
  audio engine (`src/app/tactical/speech-voices.ts`); the sound director hands quote speech to the presenter
  (`setSpeechOwner`); lip sync reads the presenter's line. The presenter lives in `TacticalHost`; the map screen plays
  no speech (deviation "Map screen speech").
- **NPC talk panel** (`src/ui/screens/talk/talk-panel.ts`, layout `talk-panel.json`; `Interface_Dialogue.cc:100-133`):
  placed by `InitTalkingMenu` at the cell origin of the NPC's tile, clamped to the screen width and the viewport; the
  big face `faces/bNN.sti` (Elliot's variant from `faceVariant`) with blink and lip sync; the approaches (repeat,
  friendly, direct, threaten, Buy/Sell for a dealer from `zDealerStrings` or Give, recruit), "who are you" on the name,
  Done (`talkbox2.sti` 3/4); busy shading and disabled regions while a panel line is queued or said; the subtitle popup
  oriented bottom, left, top or right, the bottom test against the top of the SM panel instead of the hard-coded 340
  (deviation "Talk subtitle placement above 640×480"); a click on the panel or popup skips, Esc closes when no line is
  queued, Give opens the talker's SM panel. Commands `talk`, `answer`, `closeTalk` (`04` §6.13).
- **Surfaces** (`speech-surfaces.ts`, layout `tactical-speech.json`): the comm popup at 10, 20 for merc lines with the
  speech option (by speaker: name, the sector line when he is elsewhere, bars, his face from the team panel's animator;
  deviation "Comm popup details"), the subtitle box at 110, 20, the external NPC popup (Skyrider, head miners), the
  civilian box centred on the soldier's sprite and clamped. `npc-requests.ts` opens the `StartDialogueMessageBox` boxes
  of every request kind once the lines before the prompt are said, answered with `answer`.
- The talk cursor on a soldier without a profile only closes an open civilian box (`HandleTalkInit`,
  `ShutDownQuoteBoxIfActive`). `DialogueLayer` (`dialogue-layer.ts`) joins all this and the shop to the tactical screen,
  taking input before the tactical controls and rendering after them.

### 5.9 Shop and money (`Tactical/ShopKeeper_Interface.cc`)

- Layout `shop.json` (std640; `ShopKeeper_Interface.cc:73-221`): `tradescreen.sti`, title, labels, totals, balance,
  the dealer's talking face at 13, 13 and his subtitle at 13, 140 width 300, the 5×3 dealer grid with hatched page
  arrows and a wheel region, the 6×2 offer grids, Transaction and Done, the SM panel below. Centred like the other
  fixed screens (Stracciatella: top left; deviation "Shop placement above 640×480").
- Item tile (`shop-tile.ts`, `DisplayInvSlot`): sprite, shadow, status bar, price or repair ETA, count, owner portrait
  (`faces/33face/NN.sti`), star, JAMMED/REPAIRED, hatch, `itemcrossout.sti`, repair-time tooltips; the dealer's boxes
  open the read-only description box with the original's placement quirks.
- **`ShopModel`** (`src/ui/screens/shop/shop-model.ts`, DOM-free): the page (reset to 1 after a transaction); the
  dealer's offer from box selections (one unit, Shift the rest); the player's offer of pockets, cash and collected
  repairs; the shop's held item (Ctrl picks a pocket up); `quoteTrade` on every change (`04` §6.12) with its cross-outs
  and evaluation quotes; the Transaction and Done rules of `EnableDisableEvaluateAndTransactionButtons` with the gift
  override; `needBalance` through the deduction box, "not enough funds", "no room", quote 27 on `dealerCannotAfford`,
  the quote-26 reminder, `closeShop` with the screen held until the farewell is said; `setShopPricing` when the panel's
  merc changes; the cosmetic quotes 12–15 and 21 on client timers. The SM panel shows the pricing merc with only the
  inventory and previous/next active, offered pockets hatched, a merc out of reach hatched whole; Esc is Done, Space the
  next merc. Purchases, change and repairs go straight into pockets with the new-item glow.
- Differences (deviation "Shop screen details"): a repairman's split parts are not drawn, the entry quote plays at once
  instead of 800 ms later, the compatible-item outline covers calibres and the gun's attachments only, owner portraits
  have no tooltip; inside the shop the money region, dropping and rearranging pockets are off.
- **Money** (`money-box.ts`, `money-actions.ts`; the `REMOVE_MONEY` rules): the description box's money mode ($1000,
  $100, $10 and Done on `info_bil.sti`, Separate or Withdraw). A pocket's split goes into the item cursor and then into
  a pocket (`splitMoney`), onto a soldier (`give {money}`) or onto the money region (`depositCash` after the original's
  question), never onto the floor (deviation "Split money on the ground"); in the shop it is offered as cash. The money
  region without an item opens the box over the balance; Done sends `withdrawCash` (the 20000 cap shows
  `gzMoneyWithdrawMessageText`), which places the money in a pocket at once (deviation "Withdrawn money"). On the map
  screen the money buttons show but do nothing (the money commands are tactical).

---

## 6. Tactical screen: input, cursors and overlays

### 6.1 The UI state machine (`Handle_UI.cc`)

`HandleTacticalUI` (`Handle_UI.cc:374-602`) turns input into one of 53 events (`Handle_UI.h:92-185`) and switches among
20 modes (`:45-68`); real time and turn-based share the machine with separate mouse handlers (`Real_Time_Input.cc`,
`Turn_Based_Input.cc`) and one keyboard handler. ja2-node ports it as client code with the original mode and event
names (`src/ui/screens/tactical/input/`):

- `ui-events.ts`: the UI events with their single-event flags and the modes (idle, move, confirm move, action, confirm
  action, hand cursor, look, talk cursor, jump over, adjust stance, menu, rubber band, enemy's turn, lock UI, lock our
  turn, getting item, talking menu, door menu, exit sector menu).
- `tactical-input.ts` (`HandleTacticalUI`): the mouse position, polled Ctrl and Alt, one queued button transition per
  frame (`pointer-queue.ts`), queued keys, the pending override event, single events, the menu modes and the
  multi-selection reset; the turn-based and real-time button queries (click-hold 300 ms, double clicks, the movement
  menu on a held right button, the all-move, the rubber band after 10 px, Alt multi-selection); the mode handlers;
  `SetUIMouseCursor` with the exit arrows.
- `attack-cursors.ts` (aim rings and refinement from `estimateAttack`: the right click and wheel steps, the burst and
  launcher variants, throw and toss cursors), `targets.ts` (find flags of the soldier under the pointer, the body part
  from the pointer's position on the sprite), `hints.ts` (the cursor hints through the client's `HintProvider`).
- `src/ui/screens/tactical/tactical-controls.ts` (`TacticalControls`) holds it together with the hotkeys, the menus, scrolling and the input lock. Every rule check
  inside a handler becomes a hint or a server answer (§2.4).

Gestures (each with its command; refusals come back as the server's tokens and show in the feedback box as
`MSG_UI_FEEDBACK`; the orders are `04` §6.10):

| Gesture | Original | ja2-node |
|---|---|---|
| Move, turn-based: click → confirm marker (if the first step and stance change are affordable) → second click on the same tile; moving off the tile or a right click cancels | `QueryTBLeftButton`, `UIHandleCMoveMerc` | `previewMove`, then `move {soldier, to, mode}`; the "OK" battle sound when the path is longer than 5 steps |
| Move, real time: one click (real-time confirmation off by default); a double click within 300 ms runs; Alt reverses | `QueryRTLeftButton` | `move {mode: 'run'}`, `move {reverse}` |
| All-move (hold left, click right) and rubber-band multi-selection (drag > 10 px; tile centres inside; Alt adds) | `Real_Time_Input.cc:826-852`, `Handle_UI.cc:4215-4390` | `moveGroup {soldiers, to, mode?}` (real time, paths through people) |
| Turn-based left+right cycles the movement mode run → walk → swat → crawl | `Handle_UI.cc:1799-1844` | the choice goes with the next `move {mode}` only; the merc's own mode is his `stance` (deviation "Stance") |
| Attack, turn-based guns: right click or `u` → action mode; hovering a visible enemy enters action mode and, after 80 ms with ammo, confirm mode by itself; right clicks add aim (a yellow full ring at the limit, then wrap), the wheel steps aim without wrapping (Stracciatella default); left click shoots; an own or militia target asks "attack your own man?" | `UI_Cursors.cc:129-139`, `:978-1309`, `Handle_UI.cc:2115-2295` | `estimateAttack` → `attack {soldier, target, level, aimTime, bodyPart, burst}`, fired in the soldier's weapon mode |
| Attack, real time: a click shoots with aim 0; a red target cursor for 500 ms; a right click lowers the weapon | `Real_Time_Input.cc:154-184` | `attack` |
| Burst spread: drag with the button held over up to 50 tiles, release after 300 ms | `Spread_Burst.cc`, `Turn_Based_Input.cc:339-368` | `attack {spread: gridNo[]}` (`PickBurstLocations`); marks at tile centres (deviation "Burst spread marks") |
| Melee: two aim levels (0 and 3 AP), the walk to an adjacent tile plotted | `UI_Cursors.cc:1118-1209` | `attack`; the walk-up is not built (deviation "Melee without walking"): the cursor shows the refusal |
| Throw and launch: impact tile marker, no arc in the original; one click throws | `UI_Cursors.cc:1026-1028` | `estimateAttack` throw branch → `attack` |
| Medkit: the item cursor with the walk to an adjacent tile and the total AP | `DrawUIMovementPath` | `previewAction {kind: aid}` → `bandage` |
| Wire cutters, toolkit, gas can, jar, tin can, bombs, remote, steal, enter vehicle | `DrawUIMovementPath` | not built: `previewAction` answers `notSupported` |
| Doors, switches, openable structures | `UIHandleInteractiveTilesAndItemsOnTerrain` | `door`; the door menu from the server's `doorMenu` event (§6.6). Interactive tiles are the openable structure on the tile under the pointer: no pixel test, no stack cycling, no green shading (deviation "Interactive tiles") |
| Items on the ground: 1.5 s on a pool switches to the hand cursor; Ctrl holds the hand | `Handle_UI.cc:1230-1265` | `pickUp` (§5.4) |
| Look (`l`, middle click in turn-based) | `Handle_UI.cc:3789-3881` | `turn {toward}`; all band-selected mercs in real time |
| Talk: red balloon over a valid target (flashing without line of sight), plain within 4 tiles | `UIHandleTOnTerrain` | `previewAction {kind: talk}` → `talk` |
| Jump over a prone merc or a fence | `IsValidJumpLocation` | `jump {soldier, to}` |
| Swap places: the exchange cursor alternates every 1000 ms; `x` swaps with AP | `ValidQuickExchangePosition` | `swapPlaces {soldier, with}` |
| Stance by dragging on the selected merc: 40, 80, 100 px | `Handle_UI.cc:1854-2074` | `stance`, `climb` |
| Sector exit: the outer 15 px at a map edge or an exit grid tile, a green or red arrow; a click opens the exit dialog | `Turn_Based_Input.cc:2495-2666` | `exitSector {dryRun}` for the colour; the dialog from `exitSectorOptions` (§6.6). The south arrow shows in the last 15 px of the viewport above the panel (deviation "South exit arrow") |

The viewport region (ending at the panel) also ends an item cursor (on another merc `give`, else `drop`), selects own
mercs, and on a tile with items sends `pickUp` for a single item or opens the pickup menu for more.

**Input lock** (`TacticalControls.lockState`; the server's side is deviation "Turn-based UI lock"). The enemy's turn
locks the UI (`LU_BEGINUILOCK`, `ENEMYS_TURN_MODE`); on our turn in combat the UI locks (`LA_BEGINUIOURTURNLOCK`) while
(1) the view says `combat.uiLocked` (an attack resolving, a queued game event, an own merc acting, a scripted
sequence), (2) a received frame not yet played back carries a locked combat block or another team's turn: under the
instant driver an attack resolves at once on the server but plays back over seconds, and the original stays locked
until the animation ends (deviation "Playback lock"), or (3) an order the original sends through `SetUIBusy` (attack,
bandage, move, door, pickup, turn, jump) awaits the server's answer: the server publishes the frame with
`combat.uiLocked` before its answer, so the lock carries on without a gap, and a refusal unlocks. Playback merely
trailing the latest tick does not lock (under the real-time driver frames arrive unevenly and playback at 1× keeps a lag
of up to the largest delivery gap, about 30 ticks; a tick threshold made the lock and the cursor flicker). Only Esc
passes; the wait cursor appears after 1 s (`DELAY_START_CURSOR`); cursor hints stay allowed. In real time only modal
flows lock. The 25 s watchdog is not ported (deviation "Watchdogs").

### 6.2 Mouse, scrolling, selection

- Buttons: left acts; right switches mode, adds aim or cancels; a right hold of 300 ms opens the movement menu; middle
  looks (turn-based); the wheel steps aim (Stracciatella's `extra_mousewheel_actions`, on in the shipped `game.json`);
  double clicks and holds come from the `ui` layer (§3.1).
- Scrolling (`TacticalControls`): the arrow keys and the outer pixels of the *screen* (the bottom of the panel scrolls
  down), 40 px across and 20 px down per 20 ms step (Shift 80/40); the first step only arms the scroll (the original's
  pending scroll), Alt suppresses it; limits and the tile-centre snap of `05` §1.4 (`camera.ts`). Radar and
  overhead-map clicks jump the camera (`RenderWorld.cc:1925-2112`). Where the original slides the camera to a tile
  (enemy sighted, locate), the canvas jumps (deviation "Tactical HUD details").
- Cursor bounds: the viewport above the team or SM panel; picking by the exact inverse projection (`05` §7) plus
  soldier picking by sprite (§2.7).

### 6.3 Hotkeys (`GetKeyboardInput`, `Turn_Based_Input.cc:2097-2420`)

`src/ui/screens/tactical/input/hotkeys.ts` (`HandleModNone`, `HandleModShift`, `HandleModCtrl`, `HandleModAlt`,
`HandleModCtrlShift`, the menu keys) maps keys to actions of `tactical-controls.ts`; the HUD layout keeps o, Ctrl+S,
Ctrl+L and Alt+X, the screen `` ` ``, k and Pause, the dialogue layer Backspace. Stracciatella's `extra_hotkeys` are on in
the shipped `game.json` (D1), so its additions belong in. Cheats, debug pages and editor keys are not ported (y, F11,
Ctrl+C/E/H/K/O/T/U/W/Z, Ctrl+PgUp/PgDn, Alt+M/N, the Alt cheats).

| Key | Action | ja2-node |
|---|---|---|
| Esc | cancel the spread, close popups and menus, hand cursor → move, stop the selected and band-selected mercs (not in a conversation) | `stop` |
| Backspace | stop the current speech | speech presenter |
| Pause, clock click | pause / unpause with the "Game Paused" mask (any click or key up unpauses) | driver `manual` + mask (§6.8) |
| Enter (combat, our turn) | the next known enemy | client |
| Tab | interface level ground/roof (`UIHandleChangeLevel`) | client |
| Space / Shift+Space | next merc of the team panel / first merc of the next squad, with a locator | client |
| 0–9 | select squad 1–10 (`ChangeCurrentSquad`) | client |
| F1–F10 / Shift+F1–F10 | locate and select / only locate the merc in team slot n | client |
| F12 / Ctrl+F12 | clear the shown messages / the message queue | client |
| `` ` `` | SM / team panel | client |
| b | next weapon mode | `weaponMode` |
| c, p, s, PgUp, PgDn | crouch, prone, stand (also for the multi-selection), stance up/down with climbing at the ends | `stance`, `climb` |
| d | end turn on our turn in combat | `endTurn` |
| e | cycle the enemies the selected merc sees, or `NO_ENEMIES_IN_SIGHT_STR` | view `sees` |
| f | range to target and gun range (the out-of-range line) in the message log | `estimateAttack.inRange` |
| g, i, t, w | merc light, item glow, tree tops, wireframes (option and message) | client settings; the merc light does not change sight (`27` §2.1) |
| h | help | §4.7 |
| j / Shift+J | climb up or down / through the window faced | `climb` / `climbWindow` |
| k | key ring popup | client |
| l, u | look cursor, action mode | client UI modes |
| m | map screen | `mapScreen` |
| o | options | §4.4 |
| r | run (a crouched or prone merc stands up first) | `stance {stance: 'run'}` |
| v | version and gun option lines | client |
| x | swap places with the merc under the cursor | `swapPlaces` |
| z / Alt+Z | stealth for the selected or band-selected mercs / the squad | `stealth` |
| `/` | centre on the selected merc | client |
| `=` (real time) | select every merc in the sector | client multi-select |
| Insert | overhead map | §6.6 |
| Home | 3D cursor option and message | client |
| End | continue the halted move | `move` to `continueTo` |
| Alt+F | tracking mode (option and message; the view follows a walking merc in combat and every visible soldier of the others, `HandleLocateToGuyAsHeWalks`) | client |
| Alt+R / Ctrl+Shift+R | reload / reload the squad | `reload` per merc |
| Ctrl+Q | swap hands | `swapHands` |
| Arrows | scroll (§6.2) | client |
| Wheel | aim refinement in the confirm-action mode | client |
| Ctrl+S, Ctrl+L, Alt+X | save screen, load screen, exit prompt | §4 |
| Ctrl+F (every screen) | Stracciatella's FPS overlay (`FPS.cc`), with network, playback, server and read lines | `04` §6.30 |

Do nothing yet (deviation "Tactical keys not yet ported"): `*` and `,` (red item glow), a (auto-bandage, deviation
"Auto-bandage"), n (cycle stacked soldiers or structures), `-` and `=` with End or Delete held (the cover and sight
sizes), Ctrl+N (head gear), Alt+- (music volume), Alt+S and Alt+L (quick save and load), the 3D cursor itself, the
difficulty, save style and game style lines of v.

Menu modes swallow keys (Esc on release closes the exit, pickup, movement and door menus); the first key press
dismisses a feedback popup; any key up unpauses a player pause and advances key-advance speech.

### 6.4 Cursors and world markers

- **Mouse cursors** from the database (§3.5) per UI cursor (`gUICursors`, `data/tables/ui-cursors.json`; `Handle_UI.cc:670-908`,
  `UI_Cursors.cc`): move (walk, run, swat, crawl by the UI mode), can't reach, the action cursors of the hand item with
  aim rings and hit-chance cues, burst, out of range, no line of fire, reload, throw and launch, hand, look, talk, jump,
  exchange, exit arrows, wait; AP cost, hit location, door and item texts drawn into the cursor; an invalid AP flashes.
- **World cursor tiles** (`world-markers.ts`, `arrows.ts`; `FIRSTPOINTERS*`, `SECONDPOINTERS`, `THIRDPOINTERS`) inserted
  each frame as UI nodes at the original's layers (`SetUpInterface`/`ResetInterface`, `Interface_Control.cc:163-289`):
  the AP-dependent diamonds (stealth and unaffordable variants, the roof drop marker), the confirm figures (run, walk,
  swat, prone, vehicle), `BADMARKER1`, the AP number on `MOCKFLOOR1` (`TINYFONT1` white, black while blinking), the
  selection rings under the hovered merc, the show-move-grid marker, the stance arrows, the impact marker of throws and
  launchers, the burst spread marks (`burst1.sti` frame 1), the rubber band in twelve gold shades.
- **Footstep path** (`Handle_UI.cc:3116-3465`): two footsteps per tile from `previewMove.steps`, coloured by the
  movement modes the merc can still afford (the bands green, purple, blue, orange and red of `PlotPath`), shown on the
  80 ms rest; the "always show movement path" option.
- **Throw and launch**: an impact-tile marker only (the original draws no arc).
- The stub world has no pointer tiles, so these markers draw only on the original data (§2.7).

### 6.5 Overlays above the world (`Interface.cc`, `Interface_Control.cc:368-530`)

`overlays.ts`, `message-log.ts`, `message-format.ts`, `hud.ts`:

| Overlay | ja2-node |
|---|---|
| Name, assignment or squad, health and AP bars above heads (`DrawSelectedUIAboveGuy`, `Interface.cc:921-1161`); a visible other's name and health word on hover | drawn; others' condition from `healthIndex` |
| Hover and selection rings, stance arrows | drawn (§6.4) |
| Radio locators (every 80 ms) | drawn |
| **Enemy glow**: enemies pulse red every 3 s and jump to the top z at the peak; enemies the selected merc does not see are grey | drawn (§2.7) |
| Enemy fade in and out | drawn (§2.7) |
| Item glow outline and the item name list (`DrawItemPoolList`: eight names in `SMALLFONT1` and "More...") | drawn |
| Floating damage numbers (`RenderTopmostTacticalInterface`; drift every `DAMAGE_DISPLAY_DELAY` for 8 steps) | from `lifeLost {soldier, amount}` (every life deduction, bleeding and gas included) |
| Top bar (our turn, enemy turn with progress, interrupt; `Interface.cc:1699-1972`, `CreateTopMessage`, `InitEnemyUIBar`, `UpdateEnemyUIBar`) | from `combat.topMessage`, `combat.ai` and `enemyTurnProgress`, which follow `AddTopMessage`'s rules, so hidden AI interrupts stay hidden; `aiTurn {soldier}` locates the acting soldier. The timed-turns bar is not ported |
| UI feedback box and message log (6 lines of `TINYFONT1` at the bottom left of the viewport, `Utils/Message.cc`) | the six-line scroll of `ScrollString` with ageing, the queue rule and the beep, fed by the server's message entries without dialogue lines (`04` §6.7; deviation "Message list") |
| Burst spread markers | drawn (§6.4) |
| Cover and line-of-sight display (Delete/End held) | not built (needs server maps; the settings `coverSize`, `losSize` exist) |
| Wireframes, tree tops, roof level, slanted roofs | drawn (§2.7) |
| Heard noises | a message line only (no world marker in the original) |
| Mercs on roofs, corpses, smoke and gas clouds, per-tile light, tile changes, blood | drawn (§2.7) |
| Helicopter arrival (`Merc_Entering.cc`; only the helicopter's shadow) and trap popups | not built: the simulation parts are not ported |

### 6.6 Popup menus over the world

- **Movement menu** (right hold 300 ms; `PopupMovementMenu`, `Interface.cc:418-532`; `popup-menus.ts`): a 3×3 grid of
  20×20 buttons in `interface/button_frame.sti` (icons `interface/newicons3.sti`), anchored at the mouse, clamped: Look,
  Run, Walk / Action (icon by hand item), Cancel, Sneak / Talk, Hand, Crawl; tooltips `pTacticalPopupButtonStrings`.
  Sneak and crawl are disabled only for vehicles, run for vehicles and the robot (the original also checks stances and
  water; deviation "Movement menu stances").
- **Door menu** (`InitDoorOpenMenu`, `PopupDoorOpenMenu`, `Interface.cc:1265-1436`): the same frame centred on the merc,
  opened by the server's `doorMenu` event and answered with `door {action}`; open (`openManually` on a locked door),
  key ring, crowbar, examine, cancel, lockpick, boot, untrap, explosive (`interface/door_op2.sti`); the "( AP )" help in
  combat; disabled without tool, key or points from the event's `options [{action, ap, enabled, reason}]` (`04` §6.11).
- **Sector exit dialog** (`Strategic_Exit_GUI.cc`; `exit-dialog.ts`: `InternalInitSectorExitMenu`,
  `UpdateSectorExitMenu`, `RenderSectorExitMenu`, `RemoveSectorExitMenu`): the choices from `exitSectorOptions` (which
  also answers `enemyInSector` for `SingleMoveAction`), its radio rules and keys, ending in `exitSector {who, load}`.
- **Overhead map** (Insert; `TileEngine/Overhead_Map.cc`; `overhead-map.ts` and `src/app/tactical/overhead-map.ts`): the
  map composed once per sector from the tilesets' `t/` small tiles in the three passes of `RenderOverheadMap` into an
  RGB picture, the persons by team, the item dots, the merc names; a click centres the view. It uses the normal shade
  over the map's light colour, shows all roofs, leaves restricted maps unrestricted, has no item pool list and keeps the
  panel buttons enabled (deviation "Overhead map"). The stub pack has no small tiles, so on the stubs the map is black
  under the persons.
- Menus, the dialog and the overhead map pause the game through the modal pause (§1.4); the original freezes the
  tactical world while they are open.

### 6.7 Interface timers and camera

UI timers run on the client clock (`Utils/Timer_Control.cc:13-36`): cursor animation 150 ms, flash 250 ms, path rest
80 ms, scroll 20 ms, glow, locators, damage drift, blinking. Timers tied to game events (AI progress, message ageing)
run on displayed simulation time. Camera following: tracking mode, a newly seen enemy, the acting AI soldier during
its turn (`aiTurn`), the story camera on entering a meanwhile or the endgame (`src/app/tactical/story-camera.ts`).

### 6.8 Clock and pause

"Day N, HH:MM" in `COMPFONT` (`UpdateGameClockGlobals`), light green in real time, red in combat, centred in 66×13 at
`(teamPanel.x + slots width + 56, H − 23)` with the sector name above (`Game_Clock.cc:241-255`; the sector box shows
the code, deviation "Tactical HUD details"); "Paused" (`pPausedGameText`) while the player pauses. The clock shows only
in a campaign (the sandbox has no world clock). The player pause (`HandlePlayerPauseUnPauseOfGame`, refused during a
conversation) is the real-time driver at `manual` plus a mask that refuses orders; any click or key up resumes. The API
still takes commands while paused (deviation "Real-time pause").

---


## 7. Map screen

A fixed 640×480 composition of four panels plus popups (`Strategic/MapScreen.cc`, `Map_Screen_Interface*.cc`): the
character info panel (0,0) 261×107 on `interface/charinfo.sti`, the character list (0,107) on `newgoldpiece3.sti` (the
merc inventory `mapinv.sti` replaces it), the map with its border (261,0) on `mbs.sti` (the sector inventory
`sector_inventory.sti` replaces it), the bottom panel (0,359) on `map_screen_bottom.sti`; the pre-battle interface
covers the info panel and the list (§8.1). Fonts: `BLOCKFONT2` (list, info, map labels, popups, ETA), `COMPFONT`
(bottom values, compression, clock), `TINYFONT1` (message list, update box names), `SMALLCOMPFONT` (arrow counts,
sector inventory names, autoresolve cells), the Arial fonts for boxes, help, PBI and autoresolve. Layout constants:
`MapScreen.h:120-135`, `Map_Screen_Interface.h:16-34`, `Map_Screen_Interface_Map.h:121-146`,
`Map_Screen_Interface_Bottom.cc:52-80`, `Map_Screen_Interface_Border.cc:22-50, 118-150`, `UILayout.cc:50-53, 93-111,
130-136`, transcribed into `data/tables/ui-constants/` (`MapScreen`, `Map_Screen_Interface*`, `Map_Screen_Helicopter`,
`Assignments`, `Strategic_Movement`). The controller (selection set and info character, plotting mode with pending
legs, the popup stack, filters, level, the Esc priority chain, the item cursor) is separate from the layouts
`data/layouts/original/map-screen.json` (screen `mapScreen`) and `map-inventory.json` (screen `mapInventory`).

Everything is exact except the sector inventory's slot placement (§7.8), the time handling (§7.9), the deviations named
per section, and what §15 lists. The map screen shows the latest view, not the played-back one (no playback lag); it
is up while `gameScreenOf` says so (§2.2), and its Tactical and Laptop buttons change screens through the server's
flow. Every view field, command, hint and event the screen uses is in `04` §6.17; refusal tokens map to the original
strings through `src/protocol/refusals.ts`.

### 7.1 Character list

- Up to 20 rows (18–19 vehicles, 6 px lower), rows from y 146, pitch font height + 2; columns name (11/51),
  assignment (67/51; red flashing every 500 ms when the merc has nothing to do), sleep icon (123/19), location
  (147/32; `--` in transit, `??` prisoner, parentheses between sectors), destination (184/33), departure (222/28; `Nd`
  green, `Nh` red, flashing white/red below 4 hours).
- Row colour, first match: hover white; dead metal grey; being plotted light blue; not in the selected sector; in a
  squad or vehicle yellow; else dark yellow. `selectedchararrow.sti` marks the info character and every selected row.
- Sorting: six header buttons (`goldpiecebuttons.sti`, MLG) or F1–F6. `SortListOfMercsInTeamPanel`'s swap loop over
  rows 1..`FIRST_VEHICLE − 1`, comparing against the row's merc as it was when the row was reached, is ported literally
  (ties depend on it); vehicles never sort; keys name, assignment, awake first, sector + 1000·z, last path sector,
  contract end.
- Selection: the info character plus a multi-selection; Ctrl+click toggles, Shift+click selects a range; number keys
  select a squad; while an item is held the info character changes only when the item can pass.
- Clicks (six regions per row, `Y_SIZE + 1` high, `MSYS_PRIORITY_NORMAL + 1`): name/location select (right: inventory);
  assignment → the assignment menu (§7.4) or "Remove merc" for the dead and prisoners (`pMapErrorString[41]` for a merc
  between sectors); sleep → `sleep`/`wake` for the selection; destination → plotting (§7.6), right click cancels the
  selection's routes (`cancelRoute`); departure → the contract menu (§7.3). Column glows (a red outline oscillating
  every 70 ms) and `glowclick.wav` on hover.
- Status tooltip "Health: x/y, Energy: x/y, Morale: word".

Modules: `character-list.ts` (list, literal sort, selection, column strings and colours), `team-list-view.ts` (rows,
glow, flashes).

### 7.2 Character info panel and merc inventory

- Face 48×43 at (9,20) (the face system of §5.5), nickname and full name centred, two assignment lines (training stat,
  trainer's town, repair target, `ETA` of a merc in transit or moving, else the location), the ten stats (green or red
  for `CHANGE_STAT_RECENTLY_DURATION` after a change), health `life/max` (red below 25 %, yellow below 50 %, metal grey
  at 0, the maximum flashing after a change, `??` for a prisoner), morale word, contract (`1.8d/7d` or `{h}h/7d`;
  M.E.R.C. `{len}d/{hired}d`; N/A), salary by the type of the last contract, medical deposit, the three corner icons
  with tooltips, bars at (66,61) (`DrawSoldierUIBars` at `BAR_INFO_X/Y`), the hand item at (6,81) (not with the
  inventory open or for the dead), previous/next merc buttons (`info-panel.ts`). Vehicles have no condition or fuel
  (deviation "Vehicles as characters").
- The merc inventory replaces the list for an accessible merc (not in transit, not a prisoner, not a vehicle or robot,
  not an EPC, above `OKLIFE`): the tactical inventory widget at the map slot table (`UILayout.cc:93-111`),
  armour `{3d}%`, weight and camo `{}%`, key ring, trash can, Done (`merc-inventory.ts`, `map-inventory.ts`,
  `map-inventory-controller.ts`, reusing §5.3's slots, popups and description box through a narrow
  `InventoryEnvironment`). An attachment or merge onto a hand or armour slot opens the description box; right click on
  a stack opens the stack popup at `INV_REGION_X/Y` (261×248), else the description box at `MAP_ITEMDESC_START_X/Y`;
  the trash can asks `pTrashItemText[0]` and sends `discardItem` (`GlowTrashCan` never shows a glow: its colour index
  stays 0, reproduced); Done is refused with an item in the cursor or a stack popup up.
- Commands as on the tactical screen (`moveItem` without AP, passing items to another merc, into the sector pool).
  Deviations: "Map inventory cursor" (the cursor stays in the client, Esc drops it), "Trash can warning for mission
  items", "Map item description" (`itemInfo` by item type; status, ammunition and attachments from the view, since the
  client's knowledge has no loaded sector on the map), "Map inventory details". The description box shows the money
  buttons at the original's offsets, but the money commands are tactical only, so a split on the map does nothing.

### 7.3 Contract button and menu

`contractbutton.sti` at (190,49), enabled by `CanExtendContractForSoldier`; the popup (`CreateContractBox`) "Contract
Options:" in yellow, a blank line, one day, one week, two weeks with `( $x )`, Dismiss, Cancel; shading and prices from
`contractOptions` or the renewal prompt (`HandleShadingOfLinesForContractMenu`); Dismiss asks "Are you sure?"
(`STR_LATE_48`, not during the renewal sequence) → `dismiss` → the `mercDeparture` prompt; dead or prisoner → Remove
Merc → `removeMerc`; during the renewal sequence the menu is the `contractRenewal` prompt and Cancel lets the merc go.
The salary-rise quote plays first when it fires. Opening holds time (§7.9). Module `contract-menu.ts`.

### 7.4 Assignment popups (`Assignments.cc`, `Utils/PopUpBox.cc`)

- Boxes: Assignment (On Duty(N), Doctor, Patient, Vehicle, Repair, Train, Cancel), EPC (On Duty, Patient, Vehicle,
  Unescort, Cancel), Squad (`Squad  N ( n/size )` up to `GetLastSquadListedInSquadMenu`, then Cancel), Vehicle, Repair
  (vehicles but the helicopter, the robot, Items, Cancel), Training (Practice, Militia, Trainer, Student), Attribute
  (nine stats), Remove merc. Submenus open right of the parent box at the parent line (`DetermineBoxPositions`: repair
  four lines lower, training five, vehicle three; attribute right of training); the parent line stays highlighted.
- One region per line at `MSYS_PRIORITY_HIGHEST − 4`; callbacks run for shaded lines too and decide themselves; a shaded
  line is not highlighted. A full-screen mask (created under the popup it guards) closes every menu on a button release,
  the first release after opening ignored; right click on a parent closes its submenus.
- PopUpBox drawing: background PCX blitted from its top-left (not tiled), `popup.sti` corners and edges, margins
  l6 t6 b4 r4, line space 2, colours light green / white highlight / grey shade / yellow secondary shade.
- Shading comes from the **`assignmentOptions {soldier}`** hint (every line with `{enabled, shade: none | gray | yellow,
  reason?}`), so the client runs no rule.
- Clicks: `assignSquad`, `assign {kind: doctor | patient | repair | trainMilitia | trainSelf | trainTeammate |
  trainByOther, stat?, target?}`, `boardVehicle`, `unescort`, `removeMerc`; the squad error strings, `STR_LATE_18` for a
  full vehicle; militia training opens the payment prompt. For a multi-selection the clicked merc first, then the
  others; one failure box when any failed (per-soldier results of `assign {soldiers}`).

Modules: `assignment-menus.ts`, `map-menu.ts` (popups and the screen mask).

### 7.5 The map view

- `interface/b_map.pcx` (an 8-bit picture at double resolution) blitted at half scale (every other pixel) at (271,10);
  sector (x, y) has its cell at (270 + 21x, 10 + 18y), 21×18; the clip rectangle (289,27)–(627,316). No zoom.
- Shading (surface): unvisited sectors darkened ×0.48 with `ShadowRect` one pixel higher than the tints (as written);
  the airspace filter tints cells red or green through `Create16BPPPaletteShaded(mono)` palettes (light and dark). The
  four tinted half-scale copies of `InitializePalettesForMap` are computed once per data set and registered as RGB
  images (`src/app/map/map-board.ts`, `UiAssets.addRgb`). Ground control is not shown by shading.
- Underground levels: `mine_1/2/3.sti` instead of the map, unvisited underground sectors filled near-black, "Sublevel: N".
- Overlays in order: found secret sites, found SAM sites (with the airspace filter a grey box and "SAM Site"), mines
  (with the Mines filter the mine name, status and `$income (NN%)`), town borders and names with loyalty (red below 20
  when training is allowed), militia icons, the arrival-sector bullseye (moved with `setLandingZone`), item counts
  (Items filter).
- Group icons (`boxes.sti`): yellow on-duty mercs, dull yellow other assignments, white vehicles, red enemies, "?"; up
  to 30 slots per sector; which enemies show is the view's `StrategicSectorView.enemies` (`16`).
- Movement arrows between sectors with `SMALLCOMPFONT` counts (`merc_between_sector_icons.sti`, green
  `merc_mvt_green_arrows.sti` when the group arrives within 5 minutes).
- Filters (`map_border_buttons.sti`: Towns, Mines, Teams, Militia, Airspace, Items; keys w m t z a i) with their
  exclusions (`filters.ts`: airspace aborts helicopter plotting; turning airspace on aborts merc plotting and returns to
  the surface; the item filter aborts any plotting; militia prints `pMapErrorString[28]` while someone trains, else
  `zMarksMapScreenText[1]`, when the player has none); levels 0–3 (Insert/Delete); hover outline white, selected
  sector yellow (alternating while hovered), the index labels flashing in sync; the sector locator `hilite.sti` (red
  for the battle sector and Skyrider's sites, yellow for whoever speaks, 80 ms frames).
- Sector names and facilities (`facts.ts`): `GetSectorLandTypeString` (secrets and SAM sites first, the facilities, the
  town, the creature lair underground, the traversability), `GetSectorIDString`; a town whose base sector (its
  smallest) holds no secret is always known (`IsTownFound`). Static facts (town names and `townPoint`, land types,
  mine and SAM locations, facilities, radar maps) come from content.

Module `map-view.ts` (board, shading, sites, mines, towns, militia, icons, arrows, item counts, levels, locators,
cursors, the helicopter and its destination).

### 7.6 Route plotting, the move box and the ETA

- Plotting starts from the destination column or a click on the selected sector (the move box first when several
  units can move) after the movement checks (`CanCharacterMoveInStrategic`: refusal tokens map to `pMapErrorString`);
  the selection is adjusted to who must and cannot move together (the server's `route` and `routeGroup` refusals).
  Cursors `walkingcursor.sti`, `vehiclecursor.sti`, `check.sti` over the last path sector.
- After the pointer rests 200 ms on a sector the temporary path, the ETA and the checkmark come from the
  **`previewRoute {extend, alone}`** hint and are drawn statically. Each click appends a leg kept in the client, "Click
  again on the destination to confirm…"; the click on the last sector sends one `route {to, via, shortest?, extend:
  true}` per selected group (`routeGroup` from the move box); Shift = shortest route. Right click on the merc's sector
  cancels, on the old path sends `shortenRoute {soldier, at}`, on a new leg drops the later legs; Esc drops the pending
  legs. The confirming merc (a random awake selected one) says his OK battle sound. Deviation "Map route plotting".
- Path drawing with `mapcursr.sti` (lines, turns, U-turns, arrows, the green start X and red end X); the plotting
  character's permanent path pulses (20 ms per step, 1000 ms pause) (`path-trace.ts`, `TracePathRoute`).
- **Kept quirks** (D1). `TracePathRoute` skips arrows at nodes with x ≥ 598 (`Map_Screen_Interface_Map.cc:1400-1401`):
  a screen test (`x < logical width − 2·MAP_GRID_X`), so the client skips the column-16 arrows only at 640 pixels wide,
  as Stracciatella does. The plotting ETA counts the remaining arrival time twice when a path exists:
  `GetGroundTravelTimeOfSoldier` adds `GetPathTravelTimeDuringPlotting` for the temporary path and for the merc's path,
  each starting from arrival − now for a group between sectors and skipping its first node (`MapScreen.cc:939-1045`,
  `7142-7150`; vanilla `MapScreen.c:2108-2114`, `10110-10123`); the `previewRoute` hint keeps it
  (`src/sim/strategic/map/plotting.ts`, test in `src/server/hints-strategic-stub.test.ts`). Both are display rules the
  oracle does not reach.
- ETA box `eta_pop_up.sti` at (476,291), "ETA:" and the value (`DisplayGroundEta`: hours and minutes under a day, else
  days and hours).
- **Move box** (`move-box.ts`, `move-selection.ts`): `CreatePopUpBoxForMovementBox` at (450,100) kept inside the map
  view, the header white, Plot and Cancel yellow; squads, vehicles with passengers and other mercs with toggles in
  character-list order (`SetUpMovingListsForSector`); a second click on the same line within
  `DBL_CLICK_DELAY_FOR_MOVE_MENU` acts as Plot when something is picked; a mask at `MSYS_PRIORITY_HIGHEST − 4` closes
  the box. Its options come from the `moveBoxOptions` hint; the confirm sends one `routeGroup {soldiers, squads,
  vehicles, to, via, shortest}` and the server regroups (deviation "Move box regrouping").

Module `plotting.ts` (legs, the 200 ms rest, previews, confirmation, shortening, group plotting).

### 7.7 Helicopter

- With the airspace filter the helicopter icon is drawn between its sector and the next at `helicopter.progress`, the
  passenger count beside it, the destination shadow at the path's end.
- Plotting: a click on the icon sends `heliPlot` (Skyrider's greeting, the empty-helicopter hint once, why he cannot
  fly); cursor `chopper.sti`; legs as in §7.6 with `shortenHeliRoute`; the distance box `pos2.sti` (total distance,
  safe, unsafe, total cost, ETA, passengers; `DisplayDistancesForHelicopter`: above the bottom rows when the pointer is
  on row 13 or lower, `pHelicopterEtaStrings` 0..4 and 6) from the `previewHeliRoute {extend}` hint; confirm →
  `heliRoute {via, extend, plotted}`; refusals map to Skyrider's quotes (owed, returning, grounded, unwilling).
- In flight: quotes, payment messages, the monologues that turn the airspace filter on and flash sites come as events
  (`04` §6.18; deviation "Helicopter interface").

### 7.8 Town and mine box, militia popup, sector inventory

- **Town/mine box** (`town-info-box.ts`): right click on the selected sector (Militia filter off); a PopUpBox with
  Inventory and Exit buttons (`mapinvbtns.sti`); mine: name, sector, status, daily production, possible production,
  rate, town control, loyalty, ore type; town: land type, sector, size, facilities (`sFacilitiesStrings` joined by
  commas, "none"), control, loyalty, associated mine; militia lines (controlled, counts by rank, civilian training %);
  enemy forces; item count.
- **Militia popup** (`militia-popup.ts`): right click with the Militia filter on (`HandleMilitiaRedistributionClick`:
  a found town that trains militia and has no fight in its militia map, else `pMilitiaString[2]`,
  `pMapErrorString[31]` with the town, or `[30]` for a found SAM site); `militia.sti` box, the town's 3×3 mini-map
  (`militiamaps.sti`), per-cell totals right-aligned (shifted 15 left in the selected cell) and rank icons, uncontrolled
  sectors shaded, the unassigned row, per-rank buttons, Auto and Done; nine cells at `MSYS_PRIORITY_HIGHEST − 3`. The
  client keeps the pick-ups, drops and the cursor and sends **`moveMilitia {from, to, rank, count}`** and
  **`distributeMilitia {town}`** (Auto); closing with troops on the cursor spreads them on the server (`04` §6.19;
  deviation "Militia redistribution").
- **Sector inventory** (`sector-inventory.ts`, `item-pool.ts`): 45 slots per page (9 rows × 5 columns, column-major),
  item graphics, names in `SMALLCOMPFONT`, counts, status bars, hatches for unreachable items or a merc not in the
  sector, location, total and page footer, next/prev and Done (no page back on the first page, none forward on the
  last, no Done with an item in the cursor). Opened from the town box, the Items filter, a map click with a held item,
  or Ctrl+I; while open: no compression, no tactical, no level change, and the filter keys are off. The pool checks in
  the original's order (an unreachable item, no merc selected, the merc not in the sector or on the road, a battle
  there); a click picks up one object, Shift the whole slot. ja2-node's stash indices are the storage order: the pool
  lists the `inventory` query's stash compacted and padded to pages (another page when fewer than two slots are free),
  and drops go "into the stash" (`moveItem {to: 'ground', stashIndex?}`) (deviations "Sector inventory order", "Map
  inventory cursor").

### 7.9 Bottom panel, messages, compression and time

- The message list (`message-list.ts`): 9 visible lines of `TINYFONT1` at (20, 377 + 9n), clipped to (17,366)–(407,461),
  in a 256-line ring wrapped at 300 px (`MSG_DIALOG` in `DIALOGUE_COLOR`, `MSG_INTERFACE` in `INTERFACE_COLOR`, the
  feedback kinds not kept, a dialogue line as `Name: "line"`), the scroll bar and arrows (right click ±9, repeat 100 ms,
  wheel ±3), Up/Down/PgUp/PgDn/Home/End; `newbeep.wav` per message. Content: the server's message entries
  (`04` §6.7), formatted by the client (deviation "Message list").
- Laptop (456,410), Tactical (496,410), Options (458,372) buttons; the new-mail icon blinking 667 of 1000 ms (`newMail`);
  enabled per frame from `AllowedToExitFromMapscreenTo` and the **`canEnterSector`** hint (no message, the button is
  hatched; deviation "Gates outside the hints"); Laptop → `openLaptop`, Tactical → `enterSector` or `tacticalScreen`.
- Compression (`compression.ts`, `bottom-panel.ts`): less/more buttons and the label (`sTimeStrings` of the mode while
  compressing, else of X0, in `COMPFONT` at (489,457); "Paused" blinking); X1 is skipped on the map; more starts at 5
  minutes per second, less steps down and sends `stopTime` below 5 (deviation "Map compression step down"), Space
  toggles. The buttons follow the clock's `canCompress` and the client's own reasons (menus, plotting, an open
  inventory); a click on a masked button explains why (`compressRefusal`), an enemy presence opens the non-persistent
  pre-battle interface. The border and compression buttons act on the press (layout `down` actions, no 250 ms
  repeats).
- Balance and daily income (`projectedDailyIncome`), the selected sector's name, the radar map of a visited sector, the
  clock (`RenderClock`: `pPausedGameText[0]` while the player paused, red in combat; click = pause).
- **Time.** `SessionMapClient` (`src/app/map/map-client.ts`) drives the session in real time at speed 1 with
  `pauseOn: ['assignmentDone', 'fellAsleep', 'wokeUp', 'contractsExpiringSoon']` for the update box (§1.4). Menus,
  plotting, boxes, the town box, the militia popup, the inventories and the update box hold time (the driver goes
  manual), like `InterruptTimeForMenus` and `UpdatePausedStatesDueToTimeCompression`; after the server stops on an
  event the driver restarts once playback has caught up and nothing holds it; leaving the map stops it so the tactical
  driver starts clean.

### 7.10 Boxes and prompts

- Message boxes of §4.6 centred on (0,0,640,340) (`DoMapMessageBox`). Decision prompts open as the original's boxes
  (`map-prompts.ts`): militia payment and continuation (`pMilitiaConfirmStrings` 0, 1, 6 and 3, 4), simultaneous
  arrival (`STR_DETECTED_SINGULAR/PLURAL`, the enemy type, `STR_COORDINATE`), NPC of note (`pLandMarkInSectorString`,
  OK at the final destination, else CONTINUE/STOP), merc departure (the GENERIC buttons with the two sectors, REHIRE
  when the merc may be rehired), insurance (`zMarksMapScreenText[10]`); a box closes when its prompt is answered
  elsewhere (deviation "Map screen boxes for prompts"). The PBI and autoresolve are screens (§8).
- **Update box** (`update-box.ts`): assignment done, auto sleep and wake, contracts expiring;
  `group_confirm_tactical.sti`, medium faces from `faces/65face`, bars, names, "Continue" / "Stop"; Space continues,
  Esc stops; opened once the client has played the tick the driver stopped on, one box per frame, the reason set last
  wins (deviation "Update box timing").
- UI messages (`ui-message.ts`): a 200 px box centred in the map view, shown 1000 + 50 ms per character.
- Arrival notices, control changes and refusals reach the message list as server entries; `groupArrived {final}` also
  selects the arrival sector.

### 7.11 Hotkeys (`GetMapKeyboardInput`, `MapScreen.cc:2540-3075`)

Any key first ends a player pause and closes fast help; only exact modifier states dispatch. The key table is part of
`map-screen.json`.

| Key | Action |
|---|---|
| Esc | the `HandleKeyESC` chain: close a non-persistent PBI, cancel bullseye mode, a UI message, the talking face, update box Stop, the item description, plotting, assignment submenus then the menu, the contract menu, the militia popup, the town box, the key ring, the inventory, collapse the multi-selection, else go to tactical |
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
| c, h, i, l, m, o, t, w, z | contract menu, help (ends plotting first with the "unchanged" message), items filter, laptop, mines, options, teams, towns, militia |
| Ctrl+S, Ctrl+L, Alt+X, Alt+A | save screen, load screen, exit prompt, assignment menu |
| Ctrl+I | sector inventory (Stracciatella) |
| v, Alt+S, Alt+L | bound but do nothing (deviation "Map screen speech" for `v`) |

### 7.12 Implementation

| Module | Content |
|---|---|
| `src/ui/screens/map/map-screen.ts` | regions, timers, the Esc chain, filters, levels, compression, prompts, exits; `map-controller.ts` binds the layout's buttons, regions and keys |
| `src/ui/screens/map/*` | the modules named in §7.1–§7.10; `environment.ts` (`MapEnvironment`), `layout-params.ts`, `merc-soldier.ts` |
| `src/app/map/map-host.ts` | `MapHost` per session: client knowledge and hint provider, the layouts and their assets, the board, the item catalogue and profiles, `map-media.ts` (messages from the session's log, dialogue lines from the EDT files, the radar map), `map-sound.ts` (`glowclick.wav`, `newbeep.wav`, the confirming merc's OK sound); also the battle-entry client and layouts (§8.4). The front-end flow reaches it through a `MapPort` |
| `src/app/map/map-hook.ts` | `window.__ja2Ui.map`: `ready`, `error`, `screen` (`selectedSector`, `level`, `info`, `selected`, `plotting`, `filters`, `menu`, `uiMessage`, `rows`, `messages`, `clock`, `inventoryOpen`, `changingArrival`, `compression`, `flow`, `prompt`, `townBox`, `militiaTown`, `militiaCursor`, `moveBox`, `updateBox`), `holds`, `lagTicks`, `commands`, `hints` (shadow mode with `?shadowHints=1`), `command`, `advance`, `sectorPoint`, `rowPoint`, `helicopterPoint`; `mapInventory` on the screen |

`SessionClient` keeps the message log (welcome and frames) and notes a driver the server stopped. The loading screen
shows the picture of the last `sectorLoaded.loadScreen` even when no tactical host exists yet.

---

## 8. Battle entry: PBI, autoresolve, placement

The pre-battle panel is part of the map screen (as `gfPreBattleInterfaceActive` is); autoresolve is a screen pushed
over it and popped when the battle closes. Server side: `04` §6.20, `04` §6.20.

### 8.1 Pre-battle interface (`Strategic/PreBattle_Interface.cc`)

- Opens with a `preBattle` prompt (deviation "Pre-battle interface": at the end of the step, without the quote time);
  from tactical the page switches to the map screen (`gameScreenOf` shows the map while the prompt is open, though the
  server flow is still tactical). An automatic start (`preBattle {autoStart}` event) that arrives before the map screen
  exists is kept by `MapHost`. **Persistent** (a fresh battle): one of three buttons must be pressed.
  **Non-persistent** ("BATTLE IN PROGRESS", opened by the battle sector's red locator (`battleLocator`) or by trying to
  compress during a battle): the client sends `showBattle {}`, the server opens the prompt with `persistent: false` and
  a `close` option, Esc closes (deviation "Non-persistent pre-battle interface").
- Opening: `laptop power up (8-11).wav`, a 1 s stretch from the battle sector's cell to (131,180) with the gravity
  curve of `DoTransitionFromMapscreenToPreBattleInterface` (`:530-622`), input ignored until the first normal frame;
  the battle sector and the team filter are selected as `InitPreBattleInterface` does.
- Layout `pre-battle.json` (screen `preBattle`): the blanket at `HIGHEST − 5`, the MLG `prebattlepanel.sti` (main panel,
  title pieces, column headers, the uninvolved header), constants `TOP_Y` 113, `BOTTOM_Y` 349, `ROW_HEIGHT` 10
  (`:88-97`); buttons `prebattlebutton.sti` at (27,54), (98,54), (169,54) (Auto Resolve, Go To Sector, Retreat Mercs;
  `BLOCKFONT` beige, hover white; disabled buttons keep their tooltip); the custom `preBattlePanel` renderer takes every
  position of `RenderPreBattleInterface` as parameters. Header (blinking for the non-persistent PBI and ambushes):
  battle in progress, invasion, encounter, ambush, entering enemy sector, creature attack, bloodcat ambush, bloodcat
  lair; location, enemy/creature, merc and militia counts ("?" when the player does not know); involved mercs (name,
  assignment, condition word, HP%, BP%) and uninvolved mercs (name, assignment, location, destination, departure, by
  the map screen's column strings) or "None".
- Actions: `answer {prompt, choice: autoresolve | enterSector | retreat | close}` (also a, e, r, Esc, which reach the
  panel before the map screen's keys); enable states and fast help per kind and reason from the prompt's
  `options [{choice, enabled, reason}]`; an automatic start shows the pressed Autoresolve for a frame. The panel data
  (involved groups, uninvolved `betweenSectors`, `departure`, the original's destination rule: the path's last sector
  whenever there is a path) come from `src/sim/campaign/pre-battle-panel.ts`.
- `showBattle` is a prompt rather than a summary query so the summary keeps the original's side effects (the wake-up,
  the stopped compression) and the panel needs no second code path.
- The retreat-path preview is not drawn (deviation "Pre-battle retreat preview").

### 8.2 Autoresolve (`Strategic/Auto_Resolve.cc`)

- A screen over a darkened snapshot of the map screen (`autoresolve.json`: the blanket at `HIGH − 1`, the custom
  `autoresolvePanel`, the ten `autobtns.sti` buttons bound to the geometry, `smfaces.sti`, `indent.sti`); opening:
  `laptop power up`, 1 s, the panel grows from (0,0) with a cubic in-out easing.
- Geometry by unit counts (`:844-907`, `:2132-2283`; `autoresolve-geometry.ts`: `CalculateRowsAndColumns`,
  `CalculateSoldierCells`, `BuildInterfaceBuffer`, button and text positions, the time modifier): columns per side by
  count, mercs and militia share the left side, width and height formulas, centring; `interface/autoresolve.sti`
  (corners, edges, texture, centre column pieces, merc and other cells).
- Cells (`autoresolve-cells.ts`): column pitch 55, row pitch 47; merc faces `faces/65face/NN.sti` (by `profile`),
  others `interface/smfaces.sti` (admin, troop, elite, militia by rank, creatures, skulls, female variants by `female`)
  with a normal and a red-tinted palette; merc bars (life max, bleeding, life, breath max, morale) in the code's
  colours; the hit flash (white frame, then 150 ms black + red face); unconscious shadowed; dead = skull; status text in
  `SMALLCOMPFONT` (health word by life, the name or kind when dead, RETREATED, RETREATING alternating every 450 ms,
  "RETREAT" over a hovered merc).
- Header: ENCOUNTER / DEFENDING, the sector, "%d vs. %d" coloured by the ratio. Buttons: Play, Fast, Finish (a radio
  group: the driver at 1× or the time modifier, 4×, one `advance`), Pause, Retreat; after the battle Bandage and Done or
  Done alone; the surrender offer with Yes/No (battle time frozen; every button hidden after a refusal); the result box
  `indent.sti` (VICTORY!, DEFEAT!, SURRENDERED!, CAPTURED!, RETREATED!) and the elapsed time (3× the simulated time, +5
  min on a retreat).
- Space toggles pause and play, keeping the Fast or Finish speed (a quirk of the original, kept); Alt+X.
- Playback (`autoresolve-playback.ts`): each 1000 ms slice's events (`arAttack` with `weapon` and `reloaded`, `arHit`
  with `melee`, `arMiss`, `arFell`, `arDied` with `splat`, `arRetreated`, `arSound`, `arSurrenderOffered`,
  `arBattleOver`, `arSummary`) are spread evenly over the slice's real time, then the cells settle on the view
  (deviation "Autoresolve pace").
- Sounds (`autoresolve-sounds.ts`, `BattleSound`; volume 50 or `HIGHVOLUME`, centred): shot sounds by weapon with the
  lock'n'load, misses, impacts with the target's hit sound, falls, deaths and splats (decided in the simulation,
  `19` §4.3), creature sounds, the defeat laugh or eating; Finish mutes them and plays the composite sound. Militia and
  enemy voices are the client's pick (deviation "Autoresolve battle voices"). Music stays the server's (`arBattleOver` sets
  victory or defeat).
- Commands: Retreat → `autoresolveRetreat {}`, a merc cell → `autoresolveRetreat {soldier}`, Yes/No → `answer
  surrender`, Bandage → `answer bandage` (`data.bandaged`), Done → `answer autoresolveDone` (`bandageRefusal`).

### 8.3 Tactical placement GUI (`TileEngine/Tactical_Placement_GUI.cc`): not built

Entering from a persistent PBI started by the player's group shows, in the original, the overhead map with the
placement panel (`interface/overheadinterface.sti`, `panels.sti`, `overheaduibuttons.sti`: Clear, Spread, Group,
Done), merc slots with `faces/65face` portraits and bars, the non-placeable area hatched. ja2-node places automatically
(deviation "Tactical placement"); a GUI would need a placement prompt, a `placeMercs` command (`04` §6.17) and the
overhead-map renderer (§6.6).

### 8.4 Implementation

| Module | Content |
|---|---|
| `src/ui/screens/battle/battle-entry.ts` | follows the prompt, the automatic start and the flow; switches the map screen to the panel and to autoresolve |
| `pre-battle.ts`, `pre-battle-text.ts` | the stretch, header and blink, title bars, frames, labels, counts, rows, fast help |
| `autoresolve-screen.ts` | Play, Fast, Finish, Pause, Space, Retreat and the merc cells, surrender, Bandage with its box, Done, the result and the elapsed time; also the modules named in §8.2 |
| `src/app/battle/` | `SessionBattleClient` (commands, the driver, `advance`, the latest view), `BattleSound` (the effects, battle voices through `battleSoundCue`), `battle-hook.ts`: `window.__ja2Ui.battle` (`ready`, `state` with `screen`, `preBattle {prompt, persistent, encounter, phase, autoStart}`, `autoresolve {opening, status, speed, paused, interface, pending, cells, result, elapsed, ratio}`, `commands`; `drives`, `commands`, `sounds`, `buttonPoint`) |

With `pinClock` the 1 s openings finish at once (the frozen clock cannot time them).

---

## 9. Laptop

About 39,000 lines in 117 original files: 44 laptop modes plus 15 I.M.P. sub-pages, about 50 distinct screens counting
sub-pages as templates, about 300 widgets and 200 `laptop/*.sti` pictures (27 MLG pictures with baked-in text that
follow the data version). Every page is a static composition (a tiled background, a few STIs, wrapped Arial text, image
buttons at `#define` constants); the expensive pieces are shared widgets (the face, the Ian wrap with the height
measure that decides mail and file paging, the text field, the drop-down, the slider, the item picture cell). Each page
is one layout (`data/layouts/original/laptop*.json`, `aim-*`, `bobby-ray-*`, `merc-*`, `broken-link`, `imp-*`,
`insurance-*`, `florist-*`, `funeral`) and one controller under `src/ui/screens/laptop/`, with the constants of the
page's source file in `data/tables/ui-constants/`. Text comes from the EDT layouts and the L10n tables; every decision
is a command or query (`04` §6.21, `04` §6.21, `04` §6.21; `04` §6.21), and the laptop is a modal flow on the server
(deviation "Laptop as commands"). Not reproduced: mouse confinement, the rain delay and rain ambience (dead code in
Stracciatella), cheat keys, vanilla's empty Sir-Tech page.

### 9.1 Shell (`Laptop/Laptop.cc`)

- `laptop3.sti` full screen; the side panel `taskbar.sti`; the monitor rectangle (111,27)–(613,427), web pages from
  y 46; the desktop `desktop.pcx` (MLG); the program title bar `programtitlebar.sti` with icon and `FONT14ARIAL` title;
  side buttons `buttonsforlaptop.sti` (Email, Web, Files, History, Personnel, Finances, Power) with `FONT10ARIAL`
  labels; date, personnel count and balance; new mail and new file icons (`icons.sti`, clickable: the mail icon opens
  the **oldest** unread mail, the files icon the **newest** unread file); power and disk lights (`lights.sti`); minimize
  (`x.sti`); the bookmark list (rows of 18 px from y 103, `webpages.sti`/`hilite.sti`); the download box
  (`downloadtop/mid/bot.sti`, `graphwindow.sti`, `graphsegment.sti`).
- Modes and programs (`laptop-shell.ts`, `laptop-modes.ts`): the program queue (`FindLastProgramStillOpen`), minimize,
  `EnterNewLaptopMode` (maximize first, the web mode, bookmarks shown the first time the browser is used, the 2 s
  bookmark hint), `GoToWebPage` (the broken link while M.E.R.C. is down, the fast revisit), sub pages
  (`LaptopShell.subPage`, reset when the browser moves to another site; a page's layouts may change and the screen
  rebuilds its views).
- **The World Wide Wait** (`laptop-timers.ts`, `DisplayLoadPending`): every page change shows the download box with 30
  units; a unit is `UNIT_TIME` 40 ms on a first visit, `FAST_UNIT_TIME` 3 on a revisit, `ALMOST_FAST_UNIT_TIME` 25 for
  sub pages (`FASTEST_UNIT_TIME` 2 when revisited), `LONG_UNIT_TIME` 120 for M.E.R.C. while its server is still up;
  none between the A.I.M. members and the mug shots. The unit is scaled by the client setting
  `websiteLoadingTimeScale` (Stracciatella's `website_loading_time_scale`, default 1.0; 0 = off). The disk light
  flickers with `Random(2)` every 50 ms on the client PRNG (3000 ms more after the load; deviation "Cosmetic laptop
  draws").
- Opening plays `laptop power up (8-11).wav`; music `LAPTOP` (server). The original zooms the laptop out of the map
  screen button over 1 s (scale 10000 / (100 − p), centre from (472,424) to (320,240)) and back on exit; a new game
  starts in the laptop without the zoom. The zoom is built (`zoomOnOpen`, `zoomOnClose` with the map screen's draw list
  as `backdrop`) but only the devtools laptop page turns it on; `/play` opens and closes the laptop without it (§15).
- The new-mail box (`newmailwarning.sti`) on entry when mail arrived (held during a conference); `newMail` is saved
  state, so the pre-read mails greet every new game. The title-bar slide on maximize and minimize takes 18 steps of
  16 ms (deviation "Laptop title-bar slides"). Exit by Power or Esc (bookmarks, then the page's popup, then exit; a page
  may take Esc first) with the power light off for 100 ms; Tab and Shift+Tab cycle programs; Alt+X; h (help); right
  click closes the topmost popup. The laptop takes no save hotkeys, as in the original. Message boxes use
  `LAPTOP_DEFAULT` centred on the monitor, or a style per call (`RED_ON_WHITE` for insurance, `BLUE_ON_GREY`,
  IMP-style).
- Closing sends `closeLaptop` (it always succeeds) and the page re-enters the game once a frame shows the server left
  the laptop. One `LaptopMemory` per session (`src/ui/screens/laptop/laptop-client.ts`: mail and finance pages, the
  A.I.M. state, `pages-memory.ts` (history page, selected file and page, first insurance card, florist choices), the
  Bobby Ray's cart, the I.M.P. draft, the visited I.M.P. pages) keeps the client state across reopenings within the
  page's life; it is not saved (§15).

### 9.2 Email, Finances, Personnel, History, Files

- **Email** (`email/`): the list (sender, subject, date; read and unread; 18 rows a page), sorted per column on the
  client by the original's insertion sort, arrival order underneath (deviation "Email order"); the read view paged by
  `IanWrappedStringHeight` with the original's page count over the whole record list (so "1 / 2" for a two-page mail);
  previous/next; delete with the right-click question. `readEmail`, `deleteEmail`; subject and body from the
  `emailText` query (substitutions and the I.M.P. report assembled on the server, Ian codes kept).
- **Finances** (`finances/`): the summary (page 0: yesterday's and today's income, deposits, debits, balance,
  projected income and balance from `financeSummary`) and the ledger from page 1, 17 rows a page, colours and
  `SPrintMoney` variants as `Finances.cc`, the transaction text (server-rendered labels) in the balance's colour,
  first/previous/next/last.
- **Personnel** (`personnel/`): current and departed lists (`fCurrentTeamMode`), the 4×5 portrait grid with
  previous/next, the stats (with deltas), employment and inventory panels with their enables
  (`SetPersonnelButtonStates`), the inventory slider by zones, the team summary (lowest, average, highest), the daily,
  highest and lowest cost; from `observe.laptop.personnel` (including kills, assists, shots, wounds, `battlesFought`).
- **History** (`history/`): 22 rows a page, previous/next, the page and day counters, the red quest-start (by
  `questInProgress`) and cheat rows, server-rendered text and location (the full `GetSectorIDString`).
- **Files** (`files/`): the list with sender and read state, the plain and the two special layouts (the Arulco report
  with its pictures and wrap widths, the terrorist files with their mug shots), paging by `IanWrappedStringHeight` with
  `MAX_FILE_MESSAGE_PAGE_SIZE`; showing a file sends `readFile {code}`.

### 9.3 A.I.M.

Home with the ad rotation (`aim-ads.ts`: warning box, the ad of the day, Bobby Ray's duck passes, the flower texts),
sort page (criteria and direction, stable on ties), mug-shot index (5×8, dead/hired/away overlays), member file (stats,
salary, deposit, kit with item pictures, bio row, previous/next), links, the alumni (20 faces a page, three pages, the
popup with name and text), policies (the agreement, the contents, the sections with their menu) and history (contents,
chapters, menu).

The **video conference** (`aim-conference.ts`): the title bar slide (deviation "Laptop title-bar slides"), ten black
steps then two passes of the six snow frames, `WillMercAcceptCall`; first contact, answering machine
(`aimLeaveMessage`) and unavailable modes (the contact mode and `messageLeft` per profile from the view); contract
length and kit (INIT resets one week and the kit when it costs something); HIRE asks the **`hireCheck`** query so the
right quote refuses before the funds check, TRANSFER FUNDS sends `aimHire`; the popups; the hang-up after the merc stops
talking; the "just hired" box with the arrival time (`pMessageStrings[66]`, the German word order). The merc is a still
face with speech and subtitles timed `max(1500, 80 × characters)` ms. The greeting at the end of a snow never plays
after the connection snow (`DisplaySnowBackground` clears `gfFirstTimeInContactScreen`, as in the original). Not
reproduced: the random distortion (its `Random(200)` is on the main stream in the original, `AIMMembers.cc:1973`;
deviation "Cosmetic laptop draws"), the impatience quotes, the animated face.

### 9.4 M.E.R.C. and the broken link

Home with Speck's video window (`speck-video.ts`: black for 1 s, the small face stretched to the video face, the queued
quotes of the replies and the opening said one after the other with subtitles in the merc text box, a click skips, the
X closes, the black exit); the site visit (`visitSite`, whose reply orders Speck's opening, deviation "Speck's
opening") only when entering from outside the site; the arrival box after a hire. No account; account (rows, total,
authorize behind the `BLUE_ON_GREY` question, the "Transfer failed. No funds available." box from an own label: a
hard-coded English string in Stracciatella); files (overlays for dead, married, P.O.W., hired and away, bio, stats,
salary, previous/next, hire); the broken link while the site is down. Speck's quotes come in the `mercHire`, `mercPay`
and `mercOpenAccount` replies and per listing (`advertiseQuote`, `married` for Flo). The video face is the still small
face.

### 9.5 Bobby Ray's

Home with the under-construction gate (the frame animator, the signs disabled until the shop is open; the
under-construction visit gates the "now open" mail on the server, `visitSite`); one catalogue template for guns, ammo,
armour, misc and used (rows, big picture, specs with the rate of fire, the ammo tooltip naming the team's guns, page
arrows, subtotal, the 10-line cart as a client draft kept across pages; the original clears the cart on every laptop
entry, so no deviation); the order form (quote through `bobbyRayQuote` with an optional destination, the city
drop-down of the 17 destinations, the speed lights, clear, accept: the funds box, the destination question,
`bobbyRayOrder`, the confirmation picture); the shipments page (`BobbyRShipments.cc`; deviation "Bobby Ray's shipment
prices"). Speed indices: 0 overnight express, 1 two business days, 2 standard service (`src/protocol/bobby-ray.ts`).

### 9.6 I.M.P.

`charProfilePage` hosts the fourteen sub pages with their own sub-page loads (fast once visited in the laptop session,
none for the first page), the global cancel button and IMP-style boxes; the draft (`ImpDraft`) lives in
`LaptopMemory`. Home with the activation code (Enter on key up, `impCheckCode {code}` → `ok | badCode | noSlot`), about
us, main with the step blockers and the face icon, begin (name, nickname, gender; deviation "I.M.P. begin page
focus"), the quiz (answer buttons on the press, the long, short and short2 indents, the women's questions behind
`IMP_CON_3`), the personality finish, the attribute entrance, the attributes (arrows on press and repeat, the slider
drag and click of `SliderRegionButtonCallback`, the per-frame drag past the bar ends, the zero warning; budget, bounds
and display order from the server's form rules), the attribute finish, portrait, voice (the sample on entry and on each
step; deviation "I.M.P. voice samples"), finish (the analysing label and icon while pressed), confirm through
`impCreate`; the results mail via `emailText`. On the original data the attribute page's label records match the value
order; only the comments in `IMP_Text_System.cc` name the last three skill rows wrongly. The direct skill pick and the
saved I.M.P. profiles are not built (deviation "I.M.P. skill page and saved profiles").

### 9.7 Insurance, florist, funeral

- **Insurance** (`insurance/`): home, the five info pages, comments and the contract page: three cards a page with the
  face, status, contract and insured days, premium (`insuranceQuote`) and Accept (`insure`), the "nobody to insure"
  texts by `aimMercsOnTeam`, the confirmation boxes; offers carry `nickname`, `dead` and `contractLength`.
- **Florist** (`florist/`): home, the gallery (three bouquets a page with their prices), the order form (bouquet, the
  order number, next day, the four extras, the destination list of 17 rows, the message and name fields, the card
  gallery, Send through `orderFlowers` without checks as the original, Clear) and the card gallery. Entering the form
  sends `visitSite {site: floristOrderForm}`, which draws the order number (deviation "Florist order form entry"); the
  bouquet price is read from `flowerdesc.edt` and charged. The destination list is page-local
  (`florist/destination-list.ts`, after `Florist_Order_Form.cc`: rows every font height + 2, the bottom row 6 px lower,
  hovering selects, a click selects and closes, the `tactpopup` pieces), since the original draws it with its own code
  and geometry rather than Bobby Ray's (`src/ui/widgets/drop-down.ts`). Deviation "Laptop III page details".
- **Funeral** (`funeral/`): the page with the condolence box.
- The funeral, florist and insurance bookmarks are set by the first visit (`visitSite`).

### 9.8 Implementation

| Module | Content |
|---|---|
| `src/ui/screens/laptop/laptop-screen.ts`, `laptop-page.ts`, `laptop-shell.ts`, `laptop-modes.ts`, `laptop-timers.ts`, `laptop-sites.ts`, `arrival-box.ts` | `LaptopScreen`, pages, the shell, per-site state (the Bobby Ray's cart, the M.E.R.C. session, the visited I.M.P. pages) |
| `aim/`, `email/`, `finances/`, `personnel/`, `history/`, `files/`, `bobby-ray/`, `merc/`, `imp/`, `insurance/`, `florist/`, `funeral/` | one controller per page or site (§9.2–§9.7) |
| `src/ui/widgets/` | `portrait.ts` (a face by index and size, dead faces shaded, unavailable ones under `ShadowRect`), `item-picture.ts`, `drop-down.ts` (`DropDown`, `DropDownView`: the `tactpopup.sti` pieces, the gold highlight, arrows, 17 scroll regions, the scroll top clamped to `entries − visible − 1`), `frame-animator.ts`; layout types `tiles`, `portrait`, `itemPicture`, `dropDown` |
| `src/app/laptop/laptop-boot.ts` | `bootLaptopScreen(ui, {session, memory?, settings?, zoomOnOpen?, zoomOnClose?, backdrop?, onClosed?, onQuitRequest?, onHelp?})`, `SessionLaptopClient`; profiles and items from `/api/sessions/:id/profiles` and `/api/items` |
| `src/devtools/laptop/` | the laptop on a new campaign: `?seed=`, `?session=`, `?pinClock=1`, `?wait=` (load scale), `?slide=` (step ms), `?zoom=1`, `?scale=`, `?hire=profile:days,…` (A.I.M. hires first); `window.__ja2Laptop.command` |

Server data the pages read (`04` §6.21, `04` §6.21, `04` §6.21): `visitSite`, the saved `newMail`, the profile endpoint (faces,
bio rows), `emailText`, contact modes and `messageLeft`, `hireCheck` and quote ids, ledger and history row text,
`financeSummary`, `readFile`, personnel blocks and `battlesFought`, Bobby Ray's quote, stock and shipment details, the
I.M.P. form rules, insurance offers, the florist price and order number, the item catalogue.

---

## 10. Story presentation

The simulation resolves the story (`26`) and reports it as events (`04` §6.24, `04` §6.24); the page presents them in
`src/ui/screens/story/` (`StoryLayer`, page level, fed with every frame batch before the front-end flow) and
`src/app/game/story-host.ts`. While a story step runs, the frames after its event are held and released when the step
allows (`holdsFlow`), so a screen switch the event brings waits for it. `gameScreenOf` shows the tactical screen for
the flows `meanwhile`, `endgame` and `ended`; entering it locates the Queen in a meanwhile and gridno 4561 in the
endgame (`src/app/tactical/story-camera.ts`, after `EnterTacticalScreen` and `LocateToMeanwhileCharacter`). Quote
frames that arrive before the page has a tactical screen reach it when it is built.

### 10.1 Meanwhile box (`Strategic/Meanwhile.cc`)

- `meanwhile {seq, scene, sector, at}` (a Meduna scene, resolved atomically on the server) and `meanwhileStarted` (the
  interrogation) open `BringupMeanwhileBox`'s BASIC box `"<MSG_MEANWHILE>....."` over whatever screen the event
  reaches (`meanwhile-box.ts`): OK alone for the interrogation or a scene the client setting `meanwhileScenesSeen`
  does not mark, OK and Skip otherwise. The simulation applies the original's gates (PBI closed, no panel switch, empty
  dialogue queue), so the event arrives at the right moment.
- The box is a client modal: the real-time driver goes manual while it is up (§1.4; deviation "Meanwhile box timing").
- A Meduna scene is not played (deviations "Meanwhile scenes", "Meanwhile scene playback": the scene sandbox of
  `26` §2.4 is not built). OK and Skip both continue; a scene is marked seen only when played, as in the original, so
  none is ever marked and Skip shows only where the setting already marks the scene.

### 10.2 The interrogation

After OK the page fades out, the flow `meanwhile` shows the tactical screen in N7, the view locates the Queen, and the
page fades in. The Queen's talk panel and the YES/NO/LIE box are the talk screens of §5.8: the request is an
`npcRequest` prompt with `request: 'lie'` (choices `yes`, `no`, `lie`, `src/ui/screens/talk/npc-requests.ts`), opened
after the panel closes (`PROMPT_PLAYER_TO_LIE` calls `DeleteTalkingMenu`). Every other command is refused with
`inMeanwhile`; Escape does not end the scene. Music (server, `src/protocol/music.ts`): the menu music, then N7's sector
entry rule (`TACTICAL_NOTHING`) at `meanwhileStarted`, `TACTICAL_ENEMYPRESENT` at `meanwhileEnded`.

### 10.3 The ending

`queenKilled` → the killer's and witnesses' quotes under the victory music → `squadMovedUpstairs`: the page fades out,
lets the flow load P3 (the loading screen of `sectorLoaded`), fades in once the tactical screen is up and locates
gridno 4561 while the flow is `endgame` → Derek's and Oliver's talk panels → `endgameDeferred` (creatures: the game
goes on in tactical) or every conscious merc's end-game comment → `campaignWon {…, ending: {miguelAlive,
skyriderAlive}}`: fade out, the page leaves the session (it stays on the server with flow `ended`), plays `endingPlan`'s
videos (`src/app/video/sequences.ts`), then the credits with the music off and the main menu with its music. Timing
differences: deviation "Endgame timing".

### 10.4 One-off screens

The San Mona screen after `sexScene` is §4.11; the laptop zoom §9.1; the map-to-sector zoom is not built (§4.10).

---

## 11. Sound in the UI

- **Button sounds** (§3.3; schemes per screen in `src/ui/widgets/button-sounds.ts` after
  `src/sgp/Button_Sound_Control.cc:9-52`): main menu, options, save/load and init `BIGSWITCH3`; the laptop
  `COMPUTERBEEP2`; the map, tactical, autoresolve and shop screens `SMALLSWITCH2`; the game init check boxes
  `VERYSMALLSWITCH2`; each scheme an in and an out sample; message boxes inherit the screen that opened them.
- **Screen sounds**: `glowclick.wav` on map-screen hovers, `newbeep.wav` for map messages and the update box, laptop
  power up/down, the PBI and autoresolve openings and battle sounds (§8.2), the San Mona screen, the options slider test
  samples. Lip sync is §5.5; music without a session §4.2 and, in a session, the server's `presentation.music`
  (`27` §3.5), which `SessionClient` applies from frames; nothing plays during the ending videos and the credits after
  them.
- The ambient restart on an effects-volume change and the options screen stopping ambients follow the original.

---

## 12. Stub skin

CI runs on stubs only, so the stub pack (`27` §6, rules `27` §6.2) carries what CI needs to render and test every screen
on the canvas; quality is not a goal. Stub art is original work with deterministic bytes, written as **STIs (and PCX
where the code loads a PCX) under the original names**, so layouts reference `(file, frame)` the same way on both data
sets and one decode path serves both. **Sizes come from the layout data** (panel rectangles, button and slot sizes, cell
pitches from the source constants); where the code does not define a size (the art does), the stub chooses its own and
the layout carries the size it needs, so no layout centres a sprite on an original image's measured size. MLG ids
resolve to the base names on the stub data version.

**The generator** (`stubs/ui/skin.ts`): for every asset a layout of the `original` skin references and the stub pack
lacks, it writes an STI with the frames the layout uses, each a bevelled rectangle on the `ui` ramp
(`stubs/raster.ts`) at the declared size, stamped with the file name and frame number in the stub font (`label.ts`);
frames may be `hollow` (label-free, used for large pictures to save space) or `checker` (hatches). Button frame sets get
visibly different states (normal, hover, pressed, grayed). Adding a layout adds its stub art, so the layout contract
test (§3.10) resolves on stubs by construction.

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

**Stub gaps that are deliberate.** The stub dealer, repairman and Speck have no dialogue rows, and the stub world has
no pointer tiles: adding `npcdata` rows or tile types would change the stub content that the recorded stub saves bind
to (`27` §6), so their lines are silent (a line without text is skipped, as the original skips it), Speck talks without
subtitles, and cursor markers draw only on the original data. The stub tilesets have no small tiles
(`tilesets/<n>/t/`), so on stubs the overhead map is black under the persons.

---

## 13. Verification harness

- **Units and draw lists** (Node, the `ui` layer is DOM-free): screen controllers run over fake `GameClient`s on live
  stub sessions (`tests/support/`: `tactical-ui.ts`, `map-ui.ts`, `laptop-ui.ts`, `laptop-sites-ui.ts`,
  `battle-entry.ts`, `e2e-campaign-saves.ts`); **draw-list snapshots** (a screen in a given state produces this list of
  quads and glyph runs, `__snapshots__/` beside the tests) are exact, GPU-free regressions. The layout contract test
  (`src/ui/layout/layouts-contract.test.ts`) resolves every layout of every skin on the stub pack and, with
  `JA2_DATA_DIR`, every asset and frame on the original data.
- **The hook** `window.__ja2Ui` (§2.2; `lastCommand` names the session's last command and `lastResult` is its
  `{ok, reason, refusal}`; `frameStats`, `lagTicks`; per-screen blocks §7.12, §8.4, and `help` `{open, forced, page, top,
  totalLines}`, `story` `{step, played, meanwhileBoxes, endings}`). E2e tests click widget centres through
  `page.mouse` and press keys by `KeyboardEvent.code`; every wait is on hook state, and screen loads wait while the page
  keeps loading (`waitWhileLoading`) instead of a fixed timeout. `?shadowHints=1` sends every local
  hint to the server too and fails on any difference (§2.4); the main flow and the talk, shop and battle-entry specs
  run with it. `?drive=manual`, `?pinClock=1` and `?holdTime=1` freeze the driver, the UI clock and game time.
- **`pnpm e2e`** (Playwright on stubs, `tests/e2e/`): the main flow (`main-flow.spec.ts`: main menu, game init, the
  laptop's new-mail box, an A.I.M. hire through the conference, the map screen, landing in A9, the HUD and cursors, a
  battle won by the campaign bot (`tools/campaign-bot`), a route plotted, save and load through the canvas) and one
  spec per screen. **Goldens on stubs only**: the logical framebuffer read through `capture()` against PNGs in
  `tests/e2e/golden/`, nearest sampling, the clock pinned, translucent shading ±1. The suite stores `helpHidden` by
  default (`playwright.config.ts`) so help screens do not change other specs' goldens; the story spec opts back in.
  Local runs use three workers.
- **`pnpm e2e:data`** (`playwright.data.config.ts`, `tests/e2e-data/`): opt-in, never in CI; needs
  `JA2_E2E_DATA_DIR` (plus `JA2_E2E_PORT`, `JA2_E2E_WEB_PORT`) and runs the main flow, a tour of the screens and the
  performance measurement, asserting structure only (screen names, widget ids, visibility, enabled states, texts
  present, no missing image or font, no refused command, no failed `/vfs` read). **No picture of the original data is
  ever taken**: `capture()` and `expectGolden()` of `tests/e2e/ui-capture.ts` throw in that mode, the data fixture
  (`tests/e2e-data/fixture.ts`) replaces `window.__ja2Ui.capture` by a throwing function before any page script runs
  and makes `page.screenshot` reject.
- **`pnpm e2e:browsers`** (`tests/e2e-browsers/presentation.spec.ts`, its own CI job when `pnpm gates` selects it):
  the main menu on stubs in Chromium and Firefox at pixel ratios 1, 1.25, 1.5 and 2, at 1301×977 and 1366×768, with and
  without the 640×480-only option; a device-pixel screenshot must equal the logical capture scaled by whole blocks
  (§2.6). Firefox needs a display (`xvfb-run`, locally `DISPLAY=:99` with Xvfb; headless Firefox has no WebGL without a
  GPU) and `webgl.force-enabled`. Playwright's WebKit is not used: it is a Linux build, not Safari, and it needed a
  test-only drawing-buffer mode and blended the last column at fractional ratios, which Safari (whole ratios only)
  never meets.

---

## 14. Performance

### 14.1 Targets and measurement

| Target | Value | Measured with |
|---|---|---|
| Tactical frame time at 1920×1080, UI scale 2, original data, a busy sector (A9, 12+ soldiers), real time | p95 ≤ 16.7 ms (60 FPS) | a GPU machine (not yet measured, §15) |
| Static world per frame (JS) | ≤ 1 ms after the static scene buffer | `__ja2Ui.tactical.worldMs` (the world render call) |
| Draw calls, tactical with HUD | ≤ 250 | `__ja2Ui.tactical.drawCalls` |
| Screen switch tactical ↔ map ↔ laptop (assets cached) | ≤ 100 ms | not instrumented |
| First tactical load from a cold HTTP cache (local) | ≤ 2 s including the loading screen | `__ja2Ui.tactical.loadMs` |
| A cursor hint computed in the browser | ≤ 2 ms p95 (path search included) | the hint hook's `stats.latency` (local answers) and `stats.projection` (building the knowledge world) |
| Server query round trip (local; agents and fallback) | ≤ 10 ms p95 while no enemy turn runs; never queued behind an advance | not instrumented |

`__ja2Ui.frameStats` gives `{p50, p95, max}` of the page's JavaScript time per frame on every screen;
`tests/e2e/performance.spec.ts` (stubs) and `tests/e2e-data/performance.spec.ts` (A9 at 1920×1080, logged) record it.
`__ja2Ui.tactical.loadMs` holds `{total, sincePageStart, phases}` of the last tactical load: milliseconds from the load's
start to the end of each branch (`assets`, `presentation`, `world`, `layouts`, `media`, `sound`; `map` marks the map
data ready for the world, which is then built on the GPU) and from the page's navigation start. Headless Chromium
without a GPU (SwiftShader) reads every WebGL frame back in software, so its frame intervals and GPU-process times say
little about a real machine; JavaScript time per frame is the comparable number (about 1.3 / 2.0 ms p50 / p95 for the
A9 sandbox with six mercs in view at 1920×1080, world render 0.3 / 0.4 ms, 25 world draw calls, about 220 UI instances
in 48 batches).

### 14.2 Drawing only what changed

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
  (`dirty-rects.ts`). The camera's move shifts the picture (`WorldFramebuffer.copyShifted` into the second framebuffer,
  as the original's `ScrollJA2Background`) and uncovers a strip; every visible instance that appeared, disappeared,
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
  (§2.6), so the GPU writes 4–16 times fewer pixels than a device-sized canvas, and no fractional canvas size makes the
  browser filter the picture. The video overlay keeps its own canvas in CSS pixels.

### 14.3 Loading

The loaders run independent branches at once (`tactical-host.ts`, `map-host.ts`, `bootUi`, the front end, the layout
loader, the strings, the animation and corpse structures, the light templates, the soldier asset tables, palettes and
structures), so a remote browser pays the HTTP/1.1 limit of six requests at a time instead of one round trip per file;
`/vfs` responses are gzipped when worth it (`src/server/vfs-gzip.ts`). The tactical screen does not wait for `sound`:
it starts with the load and the sound director and the world's ambient join the running screen, which drops sound
events until then. The tactical host opens the client knowledge for the cursor hints (rule pack identity, rule reader,
its own world) after the screen has loaded; the server answers the hints until then.

---

## 15. Known limitations

- **Not measured:** the 60 FPS target of §14.1 needs a GPU machine; only SwiftShader numbers exist.
- **Map screen:** no speech player: quotes on the map play no speech and the info face does not lip-sync; `v`, Alt+S
  and Alt+L do nothing (deviation "Map screen speech"). The map host waits for the client knowledge before it is ready,
  and the map and tactical hosts each open their own client knowledge per session (one would halve the memory).
  Vehicles show no condition or fuel. A money split in the map screen's description box does nothing.
- **Observed, not checked against the original:** the militia filter's message takes the first right click on the
  map; a merc put to sleep by command is not listed by the update box (`fellAsleep` is the hourly rest's); with
  `pinClock=1` the plotting rest never ends (the map goldens plot through the hook).
- **Battle entry:** no retreat preview, no placement GUI (§8.3); the robot's optimistic retreat display follows the
  server one slice later; surrender and capture in autoresolve are covered by unit tests only (they need day 4 and a
  stalled battle).
- **Laptop:** `/play` does not pass the opening and closing zoom (§9.1); the conference distortion, impatience quotes
  and the animated face (A.I.M. and Speck) are not shown; the
  laptop's page numbers and hire state (`LaptopMemory`) live only as long as the page and are not saved, where the
  original saves the mail, finance and history pages.
- **Story:** Meduna scenes are not played (§10.1).
- **Tactical:** the team panel's Exit Vehicle for a driver or passenger has no tactical `leaveVehicle` yet.
- **Page:** no "connection lost" panel for a WebSocket dropped during play (screens that cannot open and a page that
  cannot boot have their panel, §4.11).
- **Goldens missing:** the San Mona screen (no stub brothel scenario; `san-mona.test.ts` covers it) and the A.I.M.
  conference (its snow and video run on the UI clock). The main flow hires three of its four mercs through MCP and lets
  the campaign bot fight, so the canvas path covers one hire, the cursors and one shot.
- **Not built, by decision:** the cover and line-of-sight display, the 3D cursor, touch input, a key remapping UI; the
  data scenarios 3 and 4 (§1.3) and audio transcoding for remote play.

---

## 16. Decisions

1. **Layouts are JSON** with a schema, constants referenced by name from generated tables and `@derived`/`@src`
   provenance, rather than TypeScript modules, so another skin can be authored without code (§3.10).
2. **The message log is server presentation entries** saved with the session rather than a client-only table: agents
   see them, saves keep them, one audit pass (`04` §6.7).

Decided where they are described: the UI scale (§2.6), the data scenarios (§1.3), cursor hints on the client (§2.4),
the animation scripts as data from the user's files (§2.3), the `gui_extras` stat bars off (§5.1), the brothel time warp
and the loading-screen entry draw simulated (§4.10, §4.11), the map path quirks kept (§7.6).

# 30 — Player UI: the original screens

The original screens on the `ui` foundation: front-end (§1), tactical panels (§2) and input (§3), map screen (§4),
battle entry (§5), laptop (§6), story presentation (§7), UI sound (§8). Sibling: `28` (principles, architecture,
widgets, fonts, cursors, layouts, stub skin, harness, UI performance). The rules live in the domain docs; every
command, query, view field and event a screen uses is in `29`.

**Conventions.** Paths without a prefix are relative to `reference/stracciatella/src/game/`, `src/sgp/…` to
`reference/stracciatella/`; ja2-node paths start with `src/`, `data/`, `stubs/` or `tools/`; `interface/…`, `faces/…`,
`sounds/…` are game data. Coordinates are in the `std640` frame (`28` §3.10). A quoted name ("Item cursor on the
canvas") is a row of `deviations.md` or `gaps.md` (names are unique across both).

## 1. Front-end screens

Text comes from the L10n tables (`data/externalized/strings/translation-*.json`) unless an EDT file is named.
Controllers: `src/ui/screens/front-end/`; layouts `main-menu`, `game-init`, `options`, `save-load`, `credits`,
`loading`, `exit-box`, `san-mona`, `screen-unavailable`, `message-box`. The screens reach the server through
`FrontEndClient` (`src/ui/client/front-end-client.ts`; `HttpFrontEndClient` in `src/app/game/`: REST for saves,
sessions and status, the socket for an in-place load and `setOption`). The launcher shares the DOM-free logic in `ui`:
labels and string ids, save rows and the save controller, the campaign form and REST types, the settings model
(`src/ui/settings.ts`; `src/app/settings.ts` keeps the `localStorage` wrapper), the credits roll, and `MessageBoxes`
(`src/ui/message-boxes.ts`: `confirm`, `alert`, `ask` with OK, YES/NO, OK/SKIP, YES/NO/LIE, CONTINUE/STOP and numbered
buttons; DOM in the launcher, `CanvasMessageBoxes` on the canvas).

### 1.1 Screen flow

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
`interface/sirtechsplash.sti` and a fade, and the main menu music on the fade's last frame
(`MainMenuScreen.cc:118-145`). `/play` opens on the main menu at once and starts its music on the first click or key;
the launcher plays the splash (deviation "Game page start"). `FrontEndFlow` switches screens like the original's exit
screens: save/load returns to its opener, a save from the options returns to the game, fades surround a load and the
new game. Music: `MAIN_MENU` without a session (`FrontEndMusicPlayer`; the session computes the mode only in game,
`31` §1.5), none for the new game, the session's in a game. Video sequences: `31` §2.1, played by
`src/app/video/sequences.ts` (`beginningPlan`, `endingPlan`).

### 1.2 Main menu (`MainMenuScreen.cc`)

- Art: `loadscreens/mainmenubackground.sti` at (0,0), `loadscreens/ja2logo.sti` at (188,15) (`:56-57`, `:368-372`);
  five buttons from the MLG `MLG_TITLETEXT` picture (`loadscreens/titletext.sti`), frames (grayed, off, hilite, on):
  New 0/0/1/2, Load 6/3/4/5, Preferences 7/7/8/9, Credits 13/10/11/12, Quit 14/14/15/16 (`:330-338`), centred on the
  logical screen width at y = 277 + 37·i (`:48-49`, `:340-349`), `MSYS_PRIORITY_HIGHEST`. On the logical screen: the
  version bottom left in `FONT10ARIAL` white at (10, H − 15), `gzCopyrightText` centred at y = H − 15 (`:374-381`,
  `UILayout.cc:137`).
- Load is grayed when no save exists (`GET /api/saves` lists ja2-node and native saves; the original counts every
  `.sav`, `SaveLoadScreen.cc:1427-1430`). The version label shows the package version and commit.
- Keys on release (`HandleMainMenuInput`): `c` load, `o` options, `s` credits, Ctrl+Q quit; Alt+C and Alt+click on
  Load load the newest save without the warning box (`gfLoadGameUponEntry`). Bare Esc does nothing; Quit and Ctrl+Q go
  to the launcher (deviation "Main menu Esc, Quit and the exit box").

### 1.3 Game init options (`GameInitOptionsScreen.cc`)

- Title `gzGIOScreenText[0]` `FONT16ARIAL` white centred at y = 68; four radio groups: Difficulty (80,150), Guns
  (350,150), Save mode (80,300), Style (350,300); group label 35 px above, option text at x + 20, boxes at x + 155,
  y − 9, rows 35 px apart (`:39-74`); Iron Man and Dead is Dead get a `FONT12ARIAL` explanation 220 px wide (`:482`,
  `:486`); Start (141,418) and Cancel (379,418) from `interface/preferencesbuttons.sti` 0/2 and 1/3, `FONT14ARIAL`
  colour 73. Background `interface/optionsscreenbackground.sti`, a shadow rectangle (48,55)–(592,408), boxes
  `interface/optionscheck.sti`. Defaults from `InitGameOptions` (`GameSettings.cc`).
- Start: Iron Man → a YES/NO warning (No resets to save anywhere); Dead is Dead → its warning; then the difficulty
  confirmation `zGioDifConfirmText[difficulty]`; with Dead is Dead an OK box (`str_dead_is_dead_mode_enter_name`), then
  the save screen in save mode names the save; else fade, music off, the beginning videos. Cancel or Esc (on press) →
  main menu. Enter acts on release through the same confirmations (the original's Enter starts on key-down and skips
  them; deviation "Game init Enter").
- New campaign: `campaignRequest` (`src/ui/client/campaign-form.ts`) → `POST /api/sessions {campaign: {options,
  hire: []}}`. **`hire: []`** opens the laptop with nobody hired, as the original does (the default squad and "land at
  once" stay launcher and developer options). Blood and gore, a per-user toggle of the original's options screen, is a
  campaign option in ja2-node (`27` §2.2): this screen sends the client setting `bloodAndGore`. A new Dead is Dead
  game sends the typed description (`campaign.deadIsDeadDescription`) unless the player chose an existing row; the
  server derives a valid save name with the player saves' slug rule (`27` §1.6).

### 1.4 Options (`Options_Screen.cc`, `GameSettings.h`)

- 23 toggles in two columns (11 + 12; Stracciatella shows the three vanilla hid): speech, mute confirmations,
  subtitles, key-advance speech, animate smoke, blood and gore, don't move mouse, old selection method, always show
  movement path, show misses, real-time confirmation, sleep/wake notification, metric system, merc always lit, smart
  cursor, snap cursor to door, glow items, tree tops, wireframe, 3D cursor, merc casts light, hide bullets, tracking
  mode (`GameSettings.h:9-54`, defaults `GameSettings.cc:144-166`); three vertical sliders (effects, speech, music,
  0–127); Save, Load, Main Menu, Done.
- Art and layout: `interface/optionscreenbase.sti`; MLG `MLG_OPTIONHEADER` frame 0 at (0,0) and 1 at (0,434); buttons
  frames 2/3 at y 438, x 51, 190, 329, 469 (`:56-60`), from the plain `interface/*addons.sti` as in Stracciatella;
  check boxes `interface/optionscheckboxes.sti` at x 265 and 428 from y 89, 27 px apart (`:63`, `:75-77`); labels
  `FONT12ARIAL` colour 73 at box + 30, wrapped at 143 px, white when highlighted, regions sized by the text; tooltips
  `zOptionsScreenHelpText[i]` on box and label; slider labels centred in 45 px at x 38, 85, 137, y 87; sliders at x 56,
  107, 158, y 126, length 258 (`:82-102`).
- Behaviour (`options.ts`): a toggle applies at once; a label click plays `BIG_SWITCH3` at `BTNVOLUME`; speech and
  subtitles cannot both be off (`OPT_NEED_AT_LEAST_SPEECH_OR_SUBTITLE_OPTION_ON`, `speechOrSubtitlesKept`); the effects
  and speech sliders play a test sample 75 ms after they stop (`sounds/weapons/lmg reload.wav`,
  `battlesnds/m_cool.wav`), music applies at once (`settings-store.ts` applies volumes to the audio engine and the
  music); Save is enabled only in a game that can save and not in Dead is Dead; Main Menu asks `OPT_RETURN_TO_MAIN`
  YES/NO, then leaves the session (`leave`: it closes, with the Dead is Dead save point, only when no other client
  watches it, `29` §6); every exit (Done or Esc)
  writes the settings; the screen holds game time (`28` §1.4).
- Mapping (`OPTION_TOGGLES`): `speech`, `muteConfirmations`, `subtitles`, `keyAdvanceSpeech`, `sleepWakeNotification`;
  the other 17 under `display.*` of the client settings; `volumes.effects/speech/music`; blood and gore → `setOption
  {bloodAndGore}` in a session (`29` §27), else the client default. Inert toggles: don't move mouse (no pointer warp
  in a browser; deviation "Pointer warp"), old selection method (the canvas always uses the new one), show misses,
  smart cursor, 3D cursor (only prints its message). ja2-node extras (ambient and master volume, playback speed,
  language, splash and intro switches, UI scale, settings export and import) stay in the launcher: the original screen
  has no free space.

### 1.5 Save/load (`SaveLoadScreen.cc`)

- ja2-node saves follow Stracciatella's named list (`27` §1.6): 11 rows on screen of a scrolling list, newest first; in
  save mode quick, auto and native saves are hidden and the first row is "create new savegame" (`MSG_NEW_SAVE`). Row
  fields: `Day N, hh:mm`, location, `n merc(s)`, balance, description, a Dead is Dead mark; in load mode a tooltip with
  difficulty, save mode, guns and style (`:808-965`, `:874-904`). Native saves are listed in load mode (`saveRow`
  handles both kinds); download, upload and "load into another session" stay in the launcher.
- Art: `interface/loadscreen.sti`; MLG `MLG_LOADSAVEHEADER` frame 0 (load) or 1 (save) at (0,0); Cancel 6/9, Load 4/7,
  Save 5/8 at x 329 and 123, y 438, `FONT14ARIAL` colour 73, the action button hatched when disabled. Rows: vanilla's
  `loadscreenaddons.sti` frames 2 and 3 (605 px) clipped to 575 px, the width Stracciatella uses for its own art
  (`sti/interface/save-load-addons.sti`, `scroll-bar.sti`: not game data); the scroll bar is a custom renderer of
  fills and lines (deviation "Save/load screen art"). Row origin (17,49), height 30, pitch 35; fields at x + 13, 95,
  196, 260, 318; `FONT12ARIAL` with per-state colour and shadow; the description field `FONT12ARIALFIXEDWIDTH`, 46 code
  points (`:70-121`, `:1095-1121`).
- Input: a click selects (in save mode the new row opens the description field), a double click saves over or loads, a
  right click clears the selection; the wheel, the scroll buttons and Up/Down scroll; Enter saves or loads; Delete asks
  `SLG_CONFIRM_DELETE` and deletes; Esc clears the selection first, then leaves.
- `SaveController` (`src/ui/saves/save-controller.ts`, shared with the launcher's save panel over a `SaveApi`): save
  new (`save {description}`); save over after `SLG_CONFIRM_SAVE` (`{name, description}`); load after one warning box
  from `predictLoadWarnings` (`save-rows.ts`), from the main menu into a new session (`POST /api/sessions {load}`;
  native saves are imported), in game in place through the WebSocket `load` (a fresh `welcome`), then the screen of the
  header's flow; a load error stays on the screen (the session is untouched); the refusal texts.
- Location column: the save header carries only the sector code, so the row shows it instead of
  `GetSectorIDString`'s town or land-type form (deviation "Save list in the launcher and on the canvas", gap "Save
  location on the canvas").

### 1.6 Message box (`MessageBoxScreen.cc`, `Utils/MercTextBox.cc`)

The `modal` widget over `MessageBox` (`28` §3.6), layout `message-box.json` (the six styles of `g_msg_box_style`, the
text box art, their stub sizes). Styles: BASIC (`interface/tactpopupbackground.pcx` tiled, `interface/tactpopup.sti`
9-slice, `interface/popupbuttons.sti` 61×20 or small 31 px, `FONT12ARIAL` white, 10 px margins), red-on-white and
blue-on-grey (laptop), I.M.P., laptop; icons `interface/msgboxicons.sti`, `msgboxiconskull.sti`. Button sets: OK,
YES/NO, CONTINUE/STOP, OK/REHIRE, generic two and three buttons, YES/NO/LIE, OK/SKIP, four numbered; labels
`pMessageStrings` (OK, YES, NO, LIE, SKIP, REHIRE); keys y/n/Esc/Enter/o/1–4 on key-up.

### 1.7 Help screens (`HelpScreen.cc`, `HelpScreenText.h`, `binarydata/help.edt`)

- Six help screens (`HelpScreen.h:7-20`): laptop (8 pages), map screen (8), map "no one hired yet", map "not yet in
  Arulco", sector inventory, tactical (6). The texts are rows of `help.edt` (records of 640 characters) with the Ian
  codes; `help-pages.ts` builds titles, page buttons and paragraphs (the loops add a font height after each paragraph;
  the laptop's one-paragraph pages do not) and `HelpScreenDetermineWhichMapScreenHelpToShow`.
- Overlay (`help-overlay.ts`, layout `help-screen.json` placed at run time; constants from `HelpScreen.h`,
  `HelpScreen.cc`, `HelpScreenText.h`): 412×292 with page buttons, 320×292 without, centred over the screen and
  vertically over the end of the viewport, in the laptop over its monitor; full-screen mask; button border and
  background from `interface/helpscreen.sti`; title (`FONT12ARIAL` white) and the "(press H)" line; footer and "don't
  show again" check box when it came up by itself; text (`FONT10ARIAL` white, 280 px column, 228 px visible) and scroll
  box as custom renderers; exit button, page buttons, two arrows (`:39-118`, `:1792-1925`). It pauses the game
  (`28` §1.4).
- Scrolling (`help-scroll.ts`): the clamps of `ChangeTopLineInTextBufferByAmount`, the FLOAT scroll box of
  `CalculateHeightAndPositionForHelpScreenScrollBox`, the drag with the grab offset, three wheel lines. Keys
  (`GetHelpScreenUserInput`, on release): Left/Right change the page (clamped), Up/Down and PgUp/PgDn scroll (also on
  repeat), Esc closes. The check box sets the hide flag only when the screen came up by itself.
- When (`help-system.ts`, `ShouldTheHelpScreenComeUp`): a forced screen (`h`) at once; a screen whose bit is unseen and
  not hidden on its third frame (the count restarts on a new screen); the bit is marked seen when the screen comes up,
  forced or not; never while a modal is up or, in tactical, while a pre-battle prompt is open. A session without a
  campaign identity (a sandbox) never shows a help screen by itself.
- `src/app/game/help-host.ts` loads the layout and `binarydata/help.edt` (through the EDT cache), runs the system every
  frame on the tactical, map and laptop screens (an open sector inventory picks its own help) and keeps in the client
  settings the seen mask per campaign identity (`helpScreensSeen[campaign]`, `29` §24) and the hide flag
  (`helpHidden`); the original saves the mask in the savegame and zeroes it on a restart (deviation "Help screens
  seen"). `h` reaches it from the tactical keys, the map screen's `help` action (which first ends route plotting with
  the "unchanged" message) and the laptop. The stub `help.edt` (`stubs/text/help.json`, all 123 records, own texts) has
  pages long enough to scroll.

### 1.8 Credits (`Credits.cc`)

`interface/credits.sti` background with 15 developer faces (`interface/credit faces.sti`; the closed-eye frame of face
i is frame 3·i, at the face's eye position), each blinking at its own frequency (`gCreditFaces`) with the eyes closed
150 + `Random(150)` ms on the client PRNG; on entry every face blinks at once (the original's unsigned clock
difference). The text scrolls up 1 px every 25 ms in a 210 px column at x 10, in bitmap fonts (body `FONT12ARIAL`,
titles `FONT14ARIAL`, the `C`/`R` colour codes); hovering a face shows name, title and joke line at (375, 420/435/450),
`FONT12ARIAL` white, 260 px centred; Esc (on release) ends. Roll: `src/ui/screens/credit-roll.ts` over the parser
`src/content/formats/credits.ts` and the row feed `src/app/credits/rows.ts`; controller `credits.ts`. After the ending
the credits play without music. The launcher keeps a DOM scroller (`src/app/credits/scroller.ts`, deviation
"Credits screen").

### 1.9 Fades (`Fade_Screen.cc`)

Fade-out: 11 darkening steps (counts 0–10, `gsFadeLimit` 10), then black; fade-in: 9 steps of `8 − count` shade
passes (`gsFadeLimit` 8; `Fade_Screen.cc:137-168, 199-262`). Used around game init → intro, loads, the meanwhile
box, the Queen's death, the end cinematic and the San Mona screen. ja2-node: the `Fade` modal (`28` §3.6), fixed 16 ms
steps, no cursor during a fade.

### 1.10 Loading screens (`Loading_Screen.cc`, `Utils/Animated_ProgressBar.cc`)

- The picture by sector and day or night (`GetLoadScreenID`, `:25-97`): game just started → helicopter; sectors in
  `data/externalized/loading-screens-mapping.json` → their day or night picture; SAM sector → SAM; else by
  traversability (town → one of two town pictures, sand, farmland/road, plains, forest/swamp, tropics/water); level 1 →
  mine, levels 2–3 → cave. Pictures `loadscreens/ls_*.sti` (640×480 RGB565); the hard-coded ones by id are
  `data/tables/load-screens.json` (`tools/transcribe/load-screens.ts`), the externalized ones follow from index 27.
- **The town choice draws `Random(2)` from the gameplay generator** at every sector entry outside a save load and the
  PBI transition (`:48-51`, `Strategic/StrategicMap.cc:245-253`) and again at every save for the header
  (`SaveLoadGame.cc:372`). **Decision:** the simulation draws the entry roll (`src/sim/strategic/map/loading-screen.ts`)
  and sends the picture as `sectorLoaded.loadScreen`; the save-time draw is not made (a ja2-node save never changes the
  state, `27` §1.3).
- Screen (`loading.ts`, layout `loading.json`: the 43 pictures by id): the bar at (162,427), 318×16, red for a sector,
  blue for a save load, filled from x + 2, follows the client's preload of the next screen's assets (deviation "Loading
  screen bar"). The tactical and map screens show the picture of the last `sectorLoaded.loadScreen`, also before a
  tactical host exists; a save load shows `LOADINGSCREEN_NOTHING` (`ls_heli.sti`) until a picture id arrives. A picture
  other than the default loads when first shown.
- The 2 s zoom from the map into the sector (`Strategic/StrategicMap.cc:196-243`) is not built.

### 1.11 Exit, quit, errors and the San Mona screen

- Alt+X in tactical, the map screen, the laptop, the shop, autoresolve and the overhead map: YES/NO `MSG_EXITGAME` in
  the screen's style (`GameLoop.cc:278-311`; `exit-box.ts`, the laptop, map and game variants of
  `HandleShortCutExitState`). Yes leaves the game for the main menu; the session stays on the server unless the player
  chose Main Menu in the options, which closes it when no other client watches it (deviation "Main menu Esc, Quit and
  the exit box").
- A laptop, map or tactical screen that cannot open (its load throws, or the host has no session client for it) shows
  the debug layout `screen-unavailable` (`screen-unavailable.ts`): which screen, the reason
  (`src/ui/client/failure-text.ts` names the browsers' network failures, "Failed to fetch" and its Firefox and Safari
  wordings, and a lost connection; any other error stays as it is), the session, the in-game keys, Retry (Enter:
  reconnects to the session, then enters the game again; on failure the panel shows the new reason) and Main menu
  (leaves the session running). A page that fails to boot shows the same heading, reason and Retry as plain HTML
  (`28` §2.2). A connection that drops during play shows the reconnecting box, a session that ends on the server the
  main menu with the reason (`28` §2.2).
- San Mona brothel screen (`JAScreens.cc:416-499`; `san-mona.ts`, layout `san-mona.json`): black, no cursor,
  `interface/luckysmile.sti` centred, a step every `SMILY_DELAY` (100 ms): frame 0 for the first 24 steps, then step
  modulo 8; after 32 steps `SMILY_END_DELAY` (1 s); `sounds/sex.wav` at `HIGHVOLUME`; then a fade into tactical. The
  `sexScene` event opens it. The original then warps game time by `5 + Random(20)` minutes without processing events
  (`:478-483`); **decision:** the simulation makes that warp and its draw at the action (`35` §1.6). The screen holds
  the real-time driver like a modal (deviation "San Mona screen and time"). It has no golden (no stub brothel scenario);
  `san-mona.test.ts` covers it.
- The original has no defeat screen (`26` §6.8).

### 1.12 Front-end hotkeys

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
| Ctrl+F | everywhere | the diagnostics overlay (`29` §30) |

Alt+S and Alt+L (quick save and load) are not wired on the canvas (gap "Tactical keys not yet ported"); `v` prints
the version and gun option lines in tactical only.

---

## 2. Tactical screen: panels

Geometry (`UILayout.cc:57-138`): the team panel is 120 px high at `H − 120` (slots of 83 px + a 142 px button box); the
single-merc (SM) panel is 140 px high at `H − 140` and overlaps the bottom 20 px of the viewport (the viewport always
ends at `H − 120`; only the mouse window moves). Above 640×480 the bar is centred and the team panel has
`max(6, min(squad_size, (W − 142)/83, 12))` slots (`teamPanelSlots`, `src/ui/layout/frames.ts`; six with the shipped
`squad_size` 6; extra slots copy the sixth slot's art); the SM panel repeats its art and stretches a filler from
`interface/overheadinterface.sti`; the sides are black (`Interface_Panels.cc:852-901`). Panel switching (`SetNewPanel`,
`Interface_Control.cc:62-90`, applied on the next update like `HandleTacticalPanelSwitch`): right click on a team face →
SM panel (not for the dead, escorts or passengers), right click on the SM face → team panel, `` ` `` toggles; non-merc
bodies and escorts keep the team panel. Constants: `Interface_Panels.cc:84-251`, `Interface_Items.cc:88-183`,
`UILayout.cc`. Draw order: panel art → face → overlays → slots → popups.

The tactical screen (`src/ui/screens/tactical/tactical-screen.ts`) has three layouts: `tactical-team.json` (frame
`tacticalPanel`), `tactical-sm.json` (frame `tacticalInventory`, with the description box and pickup menu geometry) and
`tactical-hud.json` (top bar, overhead labels, radar and squad list, clock, message log, pause mask, feedback box; keys
o, Ctrl+S, Ctrl+L, Alt+X); `panel-models.ts` builds the view models of `team-panel.ts` and `sm-panel.ts`.
`TacticalHost` (`src/app/tactical/tactical-host.ts`) loads per session: soldier assets, frames, effects, light
templates, world view, sounds, layouts, item catalogue, profiles, radar map. The screen is kept across
the options and save/load screens and rebuilt after a sector change; entering starts the real-time driver at speed 1
unless it already runs.

### 2.1 SM panel (`RenderSMPanel`, `Interface_Panels.cc:1245-1440`)

| Element | Reads | Notes |
|---|---|---|
| `inventory_bottom_panel.sti`, face plate (gold when selected on our turn, the other plate when disabled for items) | selection, turn | |
| Face 48×43 at (13,6) | §2.5 | |
| Life, breath, morale bars at (69,47) | `life`, `lifeMax`, `bleeding`, `breath`, `breathMax`, `morale` | §2.6; tooltips life/max, breath/max, the morale text |
| AP (67,53) `TINYFONT1`, only in combat above `OKLIFE` | `ap`; light yellow in stealth | original: dark red below `MinAPsToAttack` on the last target, light blue under the influence; ja2-node: dark red only for negative AP (gap "Tactical HUD details") |
| Name (11,53) `BLOCKFONT2` | `name`, `stealth` | |
| Ten stats, labels colour 6, values colour 5, `"%3d"`; green for 60 s after a rise, red after a fall | `stats` | flashes from `statChanged` events |
| Armour %, weight %, camo % | `armour`, `weight`, `camo`, computed by the server | `ArmourPercent` (`Weapons.cc:123-147`), `CalculateCarriedWeight` |
| Body figure (four bodies, `_h` highlight variants), drop target for camo kits, canteens, elixir | body type | `applyItem` |
| 19 slots (§2.3), key ring icon, money region | `inventory`, `keys` | money: §2.9 |
| Buttons: stance up/down, stealth (one image per stance), climb, burst mode (one image per weapon mode), look, level view, hand, talk, mute, prev/next, options, Done, Map | §2.2 | |

**Decision:** Stracciatella's `gui_extras` stat progress bars stay off, as in vanilla: they reveal hidden profile
progress (D16).

### 2.2 SM and team panel buttons

| Button | ja2-node | Enabled (original, `EnableSMPanelButtons`) |
|---|---|---|
| Stance up / down | `stance` (the next height up or down) | not standing / a valid lower stance; every action button is off when the merc is not the selected one, below OKLIFE, not on our turn, or the panel is disabled for items |
| Stealth | `stealth {soldiers, on}` (logs the line the z key logs; deviation "Stealth button message") | as stance |
| Climb | `climb`, then the fence `jump` | whenever the merc may act; the server refuses where he cannot climb (gap "Tactical HUD details") |
| Burst mode | `weaponMode`: normal → burst → under-barrel launcher | a burst-capable gun or an attached launcher in the hand |
| Look, hand, talk | toggle the input's cursor modes (§3.1) and show their state | |
| Level view | the client's interface level | |
| Mute | `mute` (a presentation flag the server keeps so speech and sound agree) | |
| Prev / next merc | client selection | |
| Options | options screen | not with an item in the cursor |
| Done | `endTurn` | our turn in combat |
| Map screen | `mapScreen`; in a boxing match "abandon fight?" first | not in a conversation or the pickup menu |
| Team panel: End turn, Map, Squad (radar ↔ squad list) | `endTurn`, `mapScreen`, client | |
| Team face left / right click | locate and select (a halted move continues with `continueTo`), open the SM panel | |
| Team enemy indicator | cycles the enemies the merc sees (`CycleVisibleEnemies`) | |
| Team hand slots | right click `swapHands` | the second hand of a driver or passenger ("Exit Vehicle", `TMClickSecondHandInvCallbackPrimary`) is not built: there is no tactical `leaveVehicle` yet |

While an item is in the cursor or a stack or key-ring popup is up, every action button, Options, Done, Map and the
radar are disabled; prev/next stay enabled so the item can be carried to another merc. Inside the shop only the
inventory and prev/next work (`ShopKeeperInterface_SetSMpanelButtonsState`).

**Selection** follows `HandleLocateSelectMerc` with the new selection method: below `OKLIFE` and with Alt only locate;
a second click on the selected merc locates him with a radio locator, a third recentres; another merc is selected with
the attention sound. `SelectSoldier`: a merc who cannot act refuses with `MERC_IS_UNAVAILABLE_STR` in the log and the
feedback box; the interface level follows the merc.

**A merc's death** (the frame in which his life reaches 0, or `soldierDied`) darkens his face (closed eyes, hatch),
plays `p_close.sti` then `p_dead.sti` over it every 160 ms, then leaves the skull hatched in his slot with his name
until the panel is rebuilt (`SetCurrentSquad`, `RebuildCurrentSquad`: a squad change or entering the screen again),
although the view drops him at once (deviation "Dead merc's slot"); a click on the skull only centres his last tile. A
selected merc who dies stays selected through the animation; then the next merc of his squad who can act is selected
(`UpdateCurrentlySelectedMerc`), or nobody.

### 2.3 Inventory slots and items (`Interface_Items.cc`)

- 19 slots at `UILayout.cc:72-90` (tactical) and `:93-111` (map screen), sizes from `gSMInvData`; what fits where is
  the server's (`placements` hint, `28` §2.4), never re-implemented.
- Per slot (`item-tile.ts`, `INVRenderItem`): the second hand covered by `secondary_gun_hidden.sti` under a two-handed
  weapon; the small item graphic centred with a drop shadow at (−2,+2) and the index-254 outline (transparent; white
  for compatible items; a grey ramp for new items, 20 steps every 100 ms for 4 cycles); the hatch when the cursor item
  cannot go there; a 2 px status bar at (x−5, y+21), 20 px; texts in `TINYFONT1`: rounds left coloured by ammo type,
  "JAMMED" (view `jammed`), stack count, `*` for attachments, `*`/`+` for burst or launcher mode; tooltip with name,
  calibre (not for Gun Nut where the calibre says so; `calibre.showInHelpText` of the item catalogue), `[imprint]`
  (view `imprint`), attachments.
- Compatible-item highlight after 100 ms on a slot; with an item in the cursor the squad faces of mercs with compatible
  items get a red rectangle.
- Item graphics: small `interface/mdguns.sti`, `mdp1items.sti`, `mdp2items.sti`, `mdp3items.sti`; big `bigitems/*.sti`;
  world tiles from the tileset's GUNS/P1ITEMS/P2ITEMS/P3ITEMS; `ItemDef` (`src/content/items/items.ts`) parses
  `inventoryGraphics` and `tileGraphic`; the item catalogue `GET /api/items?lang=` serves them (`29` §7).
- **Item cursor** (`inventory.ts`, `item-cursor.ts`; deviation "Item cursor on the canvas"): the client keeps a local
  selection (soldier, slot, count, index) drawn as the mouse cursor, and the slot shows the item hidden or with one
  object less until one command ends the cursor: `moveItem` (Shift takes the stack), `attach`, `moveItem {merge}` after
  the merge prompt, `applyItem`, `drop`, `give`, `toss`; an ejected magazine or a taken attachment ends in `unload` or
  `detach`. A refusal keeps the cursor; a swap shows the displaced item back in its slot; a cursor item does not
  survive a switch to the map screen. On the map, the cursor gives to a talkable soldier or a merc of ours within
  passing range, tosses (`toss`, with the catch of a merc of ours further away) beyond the next tile or at anybody
  else, and drops otherwise; the throw arc is not drawn (gap "Tossing from the item cursor"). An item cursor
  without a drop command (a money split) is put back on a viewport click.
- Not built: Ctrl+click stack combining (`combineStack` exists as a command), moving keys in and out of the key ring.

### 2.4 Popups: stack, key ring, item description, pickup menu

- **Stack popup** (`Interface_Items.cc:3582-3763`; `item-popups.ts`): `extra_inventory.sti` cells, up to 6 per row,
  centred on the slot, the panel shaded behind; take or insert one object (`moveItem {count: 1, index}`); right click
  describes it.
- **Key ring** (`:3795-3936`): 28 cells, 7 per row, the key item's graphic (the view names the key item per lock), the
  count, sector and day found on right click; view only (`k` opens it).
- **Item description box** (`:1651-2661`; `item-description.ts`, `InitItemDescriptionBox`): tactical 320×133 at panel
  x+214, y+1 over the stats area (`infobox.sti`), map screen 272×268 (`iteminfoc.sti`). Big picture with shadow, status
  bar, name `BLOCKFONT2`, calibre and type, wrapped description, pros and cons, weapon stats (weight by the metric
  option, status, range, damage, AP, burst AP; white when exceptional), ROF bullets, the ammo button (ejects the
  magazine into the cursor), four attachment slots (`attach`, `detach`, the "permanent?" box), the money mode (§2.9).
  The computed stats, pros and cons come from the `itemInfo` hint. The original charges `AP_RELOAD_GUN` once in combat
  when the box closes with changed attachments (`Interface_Items.cc:2530-2588`); ja2-node charges each accepted
  `attach`/`detach` in combat (deviation "Attachment AP").
- **Item pickup menu** (`:4279-4647`; `pickup-menu.ts`, `InitializeItemPickupMenu`): `interface/itembox.sti`, 6 rows
  per page, the world tile graphic at shade 4, `BLOCKFONT2` names, All/OK/Cancel, paging, the wheel, the help texts. The
  original opens it after the merc reaches a tile with several items and pauses the game; ja2-node's `pickUp {items}`
  chooses before the walk, so the menu opens on the clicked tile and OK sends one `pickUp`; a single item is picked up
  without the menu (deviation "Pickup menu"). Esc closes, in order, the pickup menu, the description box, a popup, the
  item cursor.

### 2.5 Faces (`Tactical/Faces.cc`)

`faces.ts` (`InitFace`, `BlinkAutoFace`, `MouthAutoFace`, `HandleRenderFaceAdjustments`, `HandleAutoFaces`):

- Files: small `faces/NN.sti` (48×43), big `faces/bNN.sti`, `faces/33face/`, `faces/65face/` (map screen list),
  `faces/bigfaces/` (laptop); `NN` = the profile's face index (Elliot's beaten variants by `bNPCData`; Herve, Peter,
  Alberto and Carlo share a face). Animated STIs: 0 face, 1–4 eyes (lid down, lid up, frown, surprise), 5–7 mouth.
- The face record (eye and mouth positions, blink and expression frequencies, the small-face offsets of recruited
  RPCs) comes from the profile endpoint `GET /api/sessions/:id/profiles` (`29` §7); a soldier without a profile face
  gets the generic stub face of his body type (`generic-face.ts`).
- Blink every `blinkFrequency ± Random(2000)` ms (frames 1 → 2 → 0, eye steps of 50 + `Random(30)` ms); while talking
  a frown or surprise every `expressionFrequency` ms; no blinking asleep, below OKLIFE or as a prisoner; the client
  PRNG.
- **Lip sync** (`MouthAutoFace`, `:552-612`): while the face talks, the mouth is closed while the playing sample is
  inside a gap of its `.gap` list (`src/content/formats/gap.ts`, `PollAudioGap`), otherwise a new random frame every
  120 ms; with speech off the face talks for the subtitle duration. After the sample, 300 ms closed. The speaker, file
  and position come from the speech presenter's line and the voice handle (`VoiceHandle.elapsedMs`,
  `SoundDirector.speaking`).
- Overlays: closed eyes and hatch below consciousness, `p_dead.sti` + hatch when dead, the selection rectangle (white,
  blue moving, yellow stealth moving; the moving state follows the animation's moving flag, gap "Tactical HUD
  details"), the red rectangle for compatible items, the enemy count box, the hatch when the merc cannot act
  (`canAct`), assignment icons (`portraiticons.sti`), the blinded, adrenaline and drunk icons; the hit flash from white
  to red at 150 ms, run in its original steps from each `soldierHit`; shades below OKLIFE and at 0 AP (`InitFace`'s grey
  palette).

### 2.6 Bars (`Interface_Utils.cc:131-178`)

`bars.ts` (`DrawSoldierUIBars`, `DrawBarsInUIBox`, the item status bar): three bars 3 px wide, 42 px high at x, x+6,
x+12: life red `bLife`, the pink bandaged part `lifeMax − life − bleeding`, the yellow bleeding part on top; breath on
`bars.sti` (gold for the selected merc on our turn), black up to `breathMax`, dark blue for `breath`; morale green.
Nothing at life 0.

### 2.7 Radar and squad list (`TileEngine/Radar_Screen.cc`)

88×44 in the team panel's right box: the sector's `radarmaps/<map>.sti`, the green viewport rectangle, 2×2 dots for
visible soldiers by team colour (the selected merc blinking, unconscious enemies grey, hostile civilians red, named
civilians blue; none for a soldier off the map's visible world); a press and a drag move the camera
(`RadarRegionButtonCallbackPrimary`, `RadarRegionMoveCallback`). The scale, the box and the dots follow the render
bounds of the loaded map's `restrictedScrollId` (`05` §8; the arithmetic in `src/app/world/radar.ts`). The squad button
swaps it for the squad list (`squadpanel.sti`, `COMPFONT`, the current squad light green, others present dark green,
absent black); choosing a squad sets the client's current squad.

### 2.8 Talk panel and speech (`Tactical/Interface_Dialogue.cc`, `Dialogue_Control.cc`, `Civ_Quotes.cc`)

- **Speech presenter** (`SpeechPresenter`, `src/ui/speech.ts`): one queue for every quote event (`npcQuote`,
  `mercQuote`, `skyriderQuote`, `headMinerQuote`, `shopkeeperQuote`, conversation lines), each routed to a surface
  (`panel` for the open conversation's NPC, `tactical`, `external`, `shopkeeper`). The simulation finishes lines in
  ticks and never waits for a viewer (`29` §14); the client queues lines as playback reaches their frames. Per line:
  the voice (`speechPathForLine`, only with the speech option; a missing, dropped or silent sample counts as none), the
  subtitle when the subtitles option is on or the voice failed, the talking time (the sample, else 60 ms per character,
  `TEXT_DELAY_MODIFIER`), the 300 ms tail, the key wait of the panel face with key-advance speech, no click skip in the
  first 500 ms, Backspace (forced), Esc, `cutSpeaker` for critical battle sounds; the client reports a cut or finished
  line (`skipLine`; deviation "Talk panel and speech on the canvas"). `civQuote` goes to the civilian box: lifetime
  `(chars + 2) × 60 + 500` ms, a new quote replaces the old, a click closes it after 300 ms. Voices play through the UI
  audio engine (`src/app/tactical/speech-voices.ts`); the sound director hands quote speech to the presenter
  (`setSpeechOwner`); lip sync reads the presenter's line. The presenter lives in `TacticalHost`; the map screen plays
  no speech and its info face does not lip-sync (gap "Map screen speech").
- **NPC talk panel** (`src/ui/screens/talk/talk-panel.ts`, layout `talk-panel.json`; `Interface_Dialogue.cc:100-133`):
  placed by `InitTalkingMenu` at the cell origin of the NPC's tile, clamped to the screen width and the viewport; the
  big face `faces/bNN.sti` (Elliot's variant from `faceVariant`) with blink and lip sync; the approaches (repeat,
  friendly, direct, threaten, Buy/Sell for a dealer from `zDealerStrings` or Give, recruit), "who are you" on the name,
  Done (`talkbox2.sti` 3/4); busy shading and disabled regions while a panel line is queued or said; the subtitle popup
  oriented bottom, left, top or right, the bottom test against the top of the SM panel instead of the hard-coded 340
  (deviation "Talk subtitle placement above 640×480"); a click on the panel or popup skips, Esc closes when no line is
  queued, Give opens the talker's SM panel. Commands `talk`, `answer`, `closeTalk` (`29` §13).
- **Surfaces** (`speech-surfaces.ts`, layout `tactical-speech.json`): the comm popup at 10, 20 for merc lines with the
  speech option (by speaker: name, the sector line when he is elsewhere, bars, his face from the team panel's animator;
  deviation "Comm popup details"), the subtitle box at 110, 20, the external NPC popup (Skyrider, head miners), the
  civilian box centred on the soldier's sprite and clamped. `npc-requests.ts` opens the `StartDialogueMessageBox` boxes
  of every request kind once the lines before the prompt are said, answered with `answer`.
- The talk cursor on a soldier without a profile only closes an open civilian box (`HandleTalkInit`,
  `ShutDownQuoteBoxIfActive`). `DialogueLayer` (`dialogue-layer.ts`) joins all this and the shop to the tactical screen,
  taking input before the tactical controls and rendering after them.

### 2.9 Shop and money (`Tactical/ShopKeeper_Interface.cc`)

- Layout `shop.json` (std640; `ShopKeeper_Interface.cc:73-221`): `tradescreen.sti`, title, labels, totals, balance, the
  dealer's talking face at 13, 13 and his subtitle at 13, 140 width 300, the 5×3 dealer grid with hatched page arrows
  and a wheel region, the 6×2 offer grids, Transaction and Done, the SM panel below. Centred like the other fixed
  screens (Stracciatella: top left; deviation "Shop placement above 640×480").
- Item tile (`shop-tile.ts`, `DisplayInvSlot`): sprite, shadow, status bar, price or repair ETA, count, owner portrait
  (`faces/33face/NN.sti`), star, JAMMED/REPAIRED, hatch, `itemcrossout.sti`, repair-time tooltips; the dealer's boxes
  open the read-only description box with the original's placement quirks.
- **`ShopModel`** (`src/ui/screens/shop/shop-model.ts`, DOM-free): the page (reset to 1 after a transaction); the
  dealer's offer from box selections (one unit, Shift the rest); the player's offer of pockets, cash and collected
  repairs; the shop's held item (Ctrl picks a pocket up); `quoteTrade` on every change (`29` §12) with its cross-outs
  and evaluation quotes; the Transaction and Done rules of `EnableDisableEvaluateAndTransactionButtons` with the gift
  override; `needBalance` through the deduction box, "not enough funds", "no room", quote 27 on `dealerCannotAfford`,
  the quote-26 reminder, `closeShop` with the screen held until the farewell is said; `setShopPricing` when the panel's
  merc changes; the cosmetic quotes 12–15 and 21 on client timers. The SM panel shows the pricing merc with only the
  inventory and previous/next active, offered pockets hatched, a merc out of reach hatched whole; Esc is Done, Space the
  next merc. Purchases, change and repairs go straight into pockets with the new-item glow.
- Differences (gap "Shop screen details"): no repairman's split parts, the entry quote at once (not 800 ms
  later), the compatible-item outline only for calibres and the gun's attachments, no owner portrait tooltips; inside
  the shop the money region, dropping and rearranging pockets are off (deviation "Shop screen pockets").
- **Money** (`money-box.ts`, `money-actions.ts`; the `REMOVE_MONEY` rules): the description box's money mode ($1000,
  $100, $10 and Done on `info_bil.sti`, Separate or Withdraw). A pocket's split goes into the item cursor and then into
  a pocket (`splitMoney`), onto a soldier (`give {money}`) or onto the money region (`depositCash` after the original's
  question), never onto the floor (deviation "Split money on the ground"); in the shop it is offered as cash. The money
  region without an item opens the box over the balance; Done sends `withdrawCash` (the 20000 cap shows
  `gzMoneyWithdrawMessageText`), which places the money in a pocket at once (deviation "Withdrawn money"). On the map
  screen the money buttons show but do nothing: the money commands are tactical (§4.2).

---

## 3. Tactical screen: input, cursors and overlays

### 3.1 The UI state machine (`Handle_UI.cc`)

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
- `src/ui/screens/tactical/tactical-controls.ts` (`TacticalControls`) holds it together with the hotkeys, the menus,
  scrolling and the input lock. Every rule check inside a handler becomes a hint or a server answer (`28` §2.4).

Gestures and their commands (orders: `29` §10); refusals come back as the server's tokens and show in the feedback
box as `MSG_UI_FEEDBACK`:

| Gesture | Original | ja2-node |
|---|---|---|
| Move, turn-based: click → confirm marker (if the first step and stance change are affordable) → second click on the same tile; moving off the tile or a right click cancels | `QueryTBLeftButton`, `UIHandleCMoveMerc` | `previewMove`, then `move {soldier, to, mode}`; the "OK" battle sound when the path is longer than 5 steps |
| Move, real time: one click (real-time confirmation off by default); a double click within 300 ms runs; Alt reverses | `QueryRTLeftButton` | `move {mode: 'run'}`, `move {reverse}` |
| All-move (hold left, click right) and rubber-band multi-selection (drag > 10 px; tile centres inside; Alt adds) | `Real_Time_Input.cc:826-852`, `Handle_UI.cc:4215-4390` | `moveGroup {soldiers, to, mode?}` (real time, paths through people) |
| Turn-based left+right cycles the movement mode run → walk → swat → crawl | `Handle_UI.cc:1799-1844` | the choice goes with the next `move {mode}` only; the merc's own mode is his `stance` (deviation "Stance") |
| Attack, turn-based guns: right click or `u` → action mode; hovering a visible enemy enters action mode and, after 80 ms with ammo, confirm mode by itself; right clicks add aim (a yellow full ring at the limit, then wrap), the wheel steps aim without wrapping (Stracciatella default); left click shoots; an own or militia target asks "attack your own man?" | `UI_Cursors.cc:129-139`, `:978-1309`, `Handle_UI.cc:2115-2295` | `estimateAttack` → `attack {soldier, target, level, aimTime, bodyPart, burst}`, fired in the soldier's weapon mode |
| Attack, real time: a click shoots with aim 0; a red target cursor for 500 ms; a right click lowers the weapon | `Real_Time_Input.cc:154-184` | `attack` |
| Burst spread: drag with the button held over up to 50 tiles, release after 300 ms | `Spread_Burst.cc`, `Turn_Based_Input.cc:339-368` | `attack {spread: gridNo[]}` (`PickBurstLocations`); marks at tile centres (deviation "Burst spread marks") |
| Melee: two aim levels (0 and 3 AP), the walk to an adjacent tile plotted | `UI_Cursors.cc:1118-1209` | `attack`; the walk-up is not built (gap "Melee without walking"): the cursor shows the refusal |
| Throw and launch: impact tile marker, no arc in the original; one click throws | `UI_Cursors.cc:1026-1028` | `estimateAttack` throw branch → `attack` |
| Medkit: the item cursor with the walk to an adjacent tile and the total AP | `DrawUIMovementPath` | `previewAction {kind: aid}` → `bandage` |
| Wire cutters, toolkit, gas can, jar, tin can, bombs, remote, steal, enter vehicle | `DrawUIMovementPath` | not built: `previewAction` answers `notSupported` |
| Doors, switches, openable structures | `UIHandleInteractiveTilesAndItemsOnTerrain` | `door`; the door menu from the server's `doorMenu` event (§3.6). Interactive tiles are the openable structure on the tile under the pointer: no pixel test, no stack cycling, no green shading (gap "Interactive tiles") |
| Items on the ground: 1.5 s on a pool switches to the hand cursor; Ctrl holds the hand | `Handle_UI.cc:1230-1265` | `pickUp` (§2.4) |
| Look (`l`, middle click in turn-based) | `Handle_UI.cc:3789-3881` | `turn {toward}`; all band-selected mercs in real time |
| Talk: red balloon over a valid target (flashing without line of sight), plain within 4 tiles | `UIHandleTOnTerrain` | `previewAction {kind: talk}` → `talk` |
| Jump over a prone merc or a fence | `IsValidJumpLocation` | `jump {soldier, to}` |
| Swap places: the exchange cursor alternates every 1000 ms; `x` swaps with AP | `ValidQuickExchangePosition` | `swapPlaces {soldier, with}` |
| Stance by dragging on the selected merc: 40, 80, 100 px | `Handle_UI.cc:1854-2074` | `stance`, `climb` |
| Sector exit: the outer 15 px at a map edge or an exit grid tile, a green or red arrow; a click opens the exit dialog | `Turn_Based_Input.cc:2495-2666` | `exitSector {dryRun}` for the colour; the dialog from `exitSectorOptions` (§3.6). The south arrow shows in the last 15 px of the viewport above the panel (deviation "South exit arrow") |

The viewport region (ending at the panel) also ends an item cursor (on another merc `give`, else `drop`), selects own
mercs, and on a tile with items sends `pickUp` for a single item or opens the pickup menu for more.

**Input lock** (`TacticalControls.lockState`; the server's side is deviation "Turn-based UI lock"). The enemy's turn
locks the UI (`LU_BEGINUILOCK`, `ENEMYS_TURN_MODE`). On our turn in combat the UI locks (`LA_BEGINUIOURTURNLOCK`) while:

1. the view says `combat.uiLocked` (an attack resolving, a queued game event, an own merc acting, a scripted sequence);
2. a received frame not yet played back carries a locked combat block or another team's turn: under the instant driver
   an attack resolves at once on the server but plays back over seconds, and the original stays locked until the
   animation ends (deviation "Playback lock");
3. an order the original sends through `SetUIBusy` (attack, bandage, move, door, pickup, turn, jump) awaits the server's
   answer: the server publishes the frame with `combat.uiLocked` before its answer, so the lock carries on without a
   gap; a refusal unlocks.

Playback merely trailing the latest tick does not lock: under the real-time driver frames arrive unevenly and playback
at 1× keeps a lag of up to the largest delivery gap (about 30 ticks), and a tick threshold made the lock and the cursor
flicker. Only Esc passes; the wait cursor appears after 1 s (`DELAY_START_CURSOR`); cursor hints stay allowed. In real
time only modal flows lock. The 25 s watchdog is not ported (deviation "Watchdogs").

### 3.2 Mouse, scrolling, selection

- Buttons: left acts; right switches mode, adds aim or cancels; a right hold of 300 ms opens the movement menu; middle
  looks (turn-based); the wheel steps aim (Stracciatella's `extra_mousewheel_actions`, on in the shipped `game.json`);
  double clicks and holds come from the `ui` layer (`28` §3.1).
- Scrolling (`TacticalControls`): the arrow keys and the outer pixels of the *screen* (the bottom of the panel scrolls
  down), 40 px across and 20 px down per 20 ms step (Shift 80/40); the first step only arms the scroll (the original's
  pending scroll); Alt suppresses it; limits and the tile-centre snap of `05` §1.4 (`camera.ts`). Radar and
  overhead-map clicks jump the camera (`RenderWorld.cc:1925-2112`). Where the original slides the camera to a tile
  (enemy sighted, locate), the canvas jumps (gap "Tactical HUD details").
- Cursor bounds: the viewport above the team or SM panel; picking by the exact inverse projection (`05` §7) plus
  soldier picking by sprite (`28` §2.7).

### 3.3 Hotkeys (`GetKeyboardInput`, `Turn_Based_Input.cc:2097-2420`)

`src/ui/screens/tactical/input/hotkeys.ts` (`HandleModNone`, `HandleModShift`, `HandleModCtrl`, `HandleModAlt`,
`HandleModCtrlShift`, the menu keys) maps keys to actions of `tactical-controls.ts`; the HUD layout keeps o, Ctrl+S,
Ctrl+L and Alt+X, the screen `` ` ``, k and Pause, the dialogue layer Backspace. Stracciatella's `extra_hotkeys` are on
in the shipped `game.json` (D1), so its additions belong in. Cheats, debug pages and editor keys are not ported (y,
F11, Ctrl+C/E/H/K/O/T/U/W/Z, Ctrl+PgUp/PgDn, Alt+M/N, the Alt cheats).

| Key | Action | ja2-node |
|---|---|---|
| Esc | cancel the spread, close popups and menus, hand cursor → move, stop the selected and band-selected mercs (not in a conversation) | `stop` |
| Backspace | stop the current speech | speech presenter |
| Pause, clock click | pause / unpause with the "Game Paused" mask | driver `manual` + mask (§3.8) |
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
| h | help | §1.7 |
| j / Shift+J | climb up or down / through the window faced | `climb` / `climbWindow` |
| k | key ring popup | client |
| l, u | look cursor, action mode | client UI modes |
| m | map screen | `mapScreen` |
| o | options | §1.4 |
| r | run (a crouched or prone merc stands up first) | `stance {stance: 'run'}` |
| v | version and gun option lines | client |
| x | swap places with the merc under the cursor | `swapPlaces` |
| z / Alt+Z | stealth for the selected or band-selected mercs / the squad | `stealth` |
| `/` | centre on the selected merc | client |
| `=` (real time) | select every merc in the sector | client multi-select |
| Insert | overhead map | §3.6 |
| Home | 3D cursor option and message | client |
| End | continue the halted move | `move` to `continueTo` |
| Alt+F | tracking mode (option and message; the view follows a walking merc in combat and every visible soldier of the others, `HandleLocateToGuyAsHeWalks`) | client |
| Alt+R / Ctrl+Shift+R | reload / reload the squad | `reload` per merc |
| Ctrl+Q | swap hands | `swapHands` |
| Arrows | scroll (§3.2) | client |
| Wheel | aim refinement in the confirm-action mode | client |
| Ctrl+S, Ctrl+L, Alt+X | save screen, load screen, exit prompt | §1 |
| Ctrl+F (every screen) | Stracciatella's FPS overlay (`FPS.cc`), with the cell under the pointer and network, playback, server and read lines | `29` §30 |

Do nothing yet (gap "Tactical keys not yet ported"): `*` and `,` (red item glow), a (auto-bandage, gap
"Auto-bandage"), n (cycle stacked soldiers or structures), `-` and `=` with End or Delete held (the cover and sight
sizes), Ctrl+N (head gear), Alt+- (music volume), Alt+S and Alt+L (quick save and load), the difficulty, save style and
game style lines of v. The 3D cursor itself is not built, by decision.

Menu modes swallow keys (Esc on release closes the exit, pickup, movement and door menus); the first key press
dismisses a feedback popup; any key up unpauses a player pause and advances key-advance speech.

### 3.4 Cursors and world markers

- **Mouse cursors** from the database (`28` §3.5) per UI cursor (`gUICursors`, `data/tables/ui-cursors.json`;
  `Handle_UI.cc:670-908`, `UI_Cursors.cc`): move (walk, run, swat, crawl by the UI mode), can't reach, the action
  cursors of the hand item with aim rings and hit-chance cues, burst, out of range, no line of fire, reload, throw and
  launch, hand, look, talk, jump, exchange, exit arrows, wait; AP cost, hit location, door and item texts drawn into the
  cursor; an invalid AP flashes.
- **World cursor tiles** (`world-markers.ts`, `arrows.ts`; `FIRSTPOINTERS*`, `SECONDPOINTERS`, `THIRDPOINTERS`) inserted
  each frame as UI nodes at the original's layers (`SetUpInterface`/`ResetInterface`, `Interface_Control.cc:163-289`):
  the AP-dependent diamonds (stealth and unaffordable variants, the roof drop marker), the confirm figures (run, walk,
  swat, prone, vehicle), `BADMARKER1`, the AP number on `MOCKFLOOR1` (`TINYFONT1` white, black while blinking), the
  selection rings under the hovered merc, the show-move-grid marker, the stance arrows, the impact marker of throws and
  launchers, the burst spread marks (`burst1.sti` frame 1), the rubber band in twelve gold
  shades. The stub world has no pointer tiles, so these markers draw only on the original data (`28` §2.7).
- **Footstep path** (`Handle_UI.cc:3116-3465`): two footsteps per tile from `previewMove.steps`, coloured by the
  movement modes the merc can still afford (the bands green, purple, blue, orange and red of `PlotPath`), shown on the
  80 ms rest; the "always show movement path" option.

### 3.5 Overlays above the world (`Interface.cc`, `Interface_Control.cc:368-530`)

`overlays.ts`, `message-log.ts`, `message-format.ts`, `hud.ts`:

| Overlay | ja2-node |
|---|---|
| Name, assignment or squad, health and AP bars above heads (`DrawSelectedUIAboveGuy`, `Interface.cc:921-1161`); a visible other's name and health word on hover | drawn; others' condition from `healthIndex` |
| Hover and selection rings, stance arrows, burst spread markers | drawn (§3.4) |
| Radio locators (every 80 ms) | drawn |
| **Enemy glow**: enemies pulse red every 3 s and jump to the top z at the peak; enemies the selected merc does not see are grey | drawn (`28` §2.7) |
| Enemy fade in and out | drawn (`28` §2.7) |
| Item glow outline and the item name list (`DrawItemPoolList`: eight names in `SMALLFONT1` and "More...") | drawn |
| Floating damage numbers (`RenderTopmostTacticalInterface`; drift every `DAMAGE_DISPLAY_DELAY` for 8 steps) | from `lifeLost {soldier, amount}` (every life deduction, bleeding and gas included) |
| Top bar (our turn, enemy turn with progress, interrupt; `Interface.cc:1699-1972`, `CreateTopMessage`, `InitEnemyUIBar`, `UpdateEnemyUIBar`) | from `combat.topMessage`, `combat.ai` and `enemyTurnProgress`, which follow `AddTopMessage`'s rules, so hidden AI interrupts stay hidden; `aiTurn {soldier}` locates the acting soldier. The timed-turns bar is not ported |
| UI feedback box and message log (6 lines of `TINYFONT1` at the bottom left of the viewport, `Utils/Message.cc`) | the six-line scroll of `ScrollString` with ageing, the queue rule and the beep, fed by the server's message entries without dialogue lines (`29` §7; deviation "Message list") |
| Cover and line-of-sight display (Delete/End held) | not built, by decision (needs server maps; the settings `coverSize`, `losSize` exist) |
| Wireframes, tree tops, roof level, slanted roofs | drawn (`28` §2.7) |
| Heard noises | a message line only (no world marker in the original) |
| Mercs on roofs, corpses, smoke and gas clouds, per-tile light, tile changes, blood | drawn (`28` §2.7) |
| Helicopter arrival (`Merc_Entering.cc`; only the helicopter's shadow) and trap popups | not built: the simulation parts are not ported |

### 3.6 Popup menus over the world

- **Movement menu** (right hold 300 ms; `PopupMovementMenu`, `Interface.cc:418-532`; `popup-menus.ts`): a 3×3 grid of
  20×20 buttons in `interface/button_frame.sti` (icons `interface/newicons3.sti`), anchored at the mouse, clamped: Look,
  Run, Walk / Action (icon by hand item), Cancel, Sneak / Talk, Hand, Crawl; tooltips `pTacticalPopupButtonStrings`.
  Sneak and crawl are disabled only for vehicles, run for vehicles and the robot (the original also checks stances and
  water; gap "Movement menu stances").
- **Door menu** (`InitDoorOpenMenu`, `PopupDoorOpenMenu`, `Interface.cc:1265-1436`): the same frame centred on the merc,
  opened by the server's `doorMenu` event and answered with `door {action}`; open (`openManually` on a locked door), key
  ring, crowbar, examine, cancel, lockpick, boot, untrap, explosive (`interface/door_op2.sti`); the "( AP )" help in
  combat; disabled without tool, key or points from the event's `options [{action, ap, enabled, reason}]` (`29` §11).
- **Sector exit dialog** (`Strategic_Exit_GUI.cc`; `exit-dialog.ts`: `InternalInitSectorExitMenu`,
  `UpdateSectorExitMenu`, `RenderSectorExitMenu`, `RemoveSectorExitMenu`): the choices from `exitSectorOptions` (which
  also answers `enemyInSector` for `SingleMoveAction`), its radio rules and keys, ending in `exitSector {who, load}`.
- **Overhead map** (Insert; `TileEngine/Overhead_Map.cc`; `overhead-map.ts` and `src/app/tactical/overhead-map.ts`):
  the map composed once per sector from the tilesets' `t/` small tiles in the three passes of `RenderOverheadMap` into
  an RGB picture, the persons by team, the item dots, the merc names; a click centres the view. Dots and the clicked cell
  go through the absolute screen projection of `render-bounds.ts` divided by 5 (`GetOverheadScreenXYFromGridNo`,
  `InternalGetOverheadMouseGridNo` with its 8-row lift). Normal shade over the map's light colour, all roofs, restricted
  maps unrestricted, no item pool list, panel buttons enabled (gap "Overhead map"). The stub pack has no small tiles, so
  on the stubs the map is black under the persons.
- Menus, the dialog and the overhead map pause the game through the modal pause (`28` §1.4); the original freezes the
  tactical world while they are open.

### 3.7 Interface timers and camera

UI timers run on the client clock (`Utils/Timer_Control.cc:13-36`): cursor animation 150 ms, flash 250 ms, path rest
80 ms, scroll 20 ms, glow, locators, damage drift, blinking. Timers tied to game events (AI progress, message ageing)
run on displayed simulation time. The camera follows: tracking mode, a newly seen enemy, the acting AI soldier during
its turn (`aiTurn`), the story camera on entering a meanwhile or the endgame (`src/app/tactical/story-camera.ts`).

### 3.8 Clock and pause

"Day N, HH:MM" in `COMPFONT` (`UpdateGameClockGlobals`), light green in real time, red in combat, centred in 66×13 at
`(teamPanel.x + slots width + 56, H − 23)` with the sector name above (`Game_Clock.cc:241-255`; the sector box shows
the code, gap "Tactical HUD details"); "Paused" (`pPausedGameText`) while the player pauses. The clock shows only
in a campaign (the sandbox has no world clock). The player pause (`HandlePlayerPauseUnPauseOfGame`, refused during a
conversation) is the real-time driver at `manual` plus a mask that refuses orders; any click or key up resumes. The API
still takes commands while paused (deviation "Real-time pause").

---

## 4. Map screen

A fixed 640×480 composition of four panels plus popups (`Strategic/MapScreen.cc`, `Map_Screen_Interface*.cc`): the
character info panel (0,0) 261×107 on `interface/charinfo.sti`, the character list (0,107) on `newgoldpiece3.sti` (the
merc inventory `mapinv.sti` replaces it), the map with its border (261,0) on `mbs.sti` (the sector inventory
`sector_inventory.sti` replaces it), the bottom panel (0,359) on `map_screen_bottom.sti`; the pre-battle interface
covers the info panel and the list (§5.1). Fonts: `BLOCKFONT2` (list, info, map labels, popups, ETA), `COMPFONT`
(bottom values, compression, clock), `TINYFONT1` (message list, update box names), `SMALLCOMPFONT` (arrow counts,
sector inventory names, autoresolve cells), the Arial fonts for boxes, help, PBI and autoresolve. Layout constants:
`MapScreen.h:120-135`, `Map_Screen_Interface.h:16-34`, `Map_Screen_Interface_Map.h:121-146`,
`Map_Screen_Interface_Bottom.cc:52-80`, `Map_Screen_Interface_Border.cc:22-50, 118-150`, `UILayout.cc:50-53, 93-111,
130-136`, transcribed into `data/tables/ui-constants/` (`MapScreen`, `Map_Screen_Interface*`, `Map_Screen_Helicopter`,
`Assignments`, `Strategic_Movement`). The controller (selection set and info character, plotting mode with pending
legs, the popup stack, filters, level, the Esc priority chain, the item cursor) is separate from the layouts
`data/layouts/original/map-screen.json` (screen `mapScreen`) and `map-inventory.json` (screen `mapInventory`).

Everything is exact except the sector inventory's slot placement (§4.8), the time handling (§4.9) and the deviations and
gaps named per section. The map screen shows the latest view, not the played-back one (no playback lag); it is up while
`gameScreenOf` says so (`28` §2.2), and its Tactical and Laptop buttons change screens through the server's flow. Every
view field, command, hint and event the screen uses is in `29` §17; refusal tokens map to the original strings through
`src/protocol/refusals.ts`.

### 4.1 Character list

- Up to 20 rows (18–19 vehicles, 6 px lower), rows from y 146, pitch font height + 2; columns name (11/51), assignment
  (67/51; red flashing every 500 ms when the merc has nothing to do), sleep icon (123/19), location (147/32; `--` in
  transit, `??` prisoner, parentheses between sectors), destination (184/33), departure (222/28; `Nd` green, `Nh` red,
  flashing white/red below 4 hours).
- Row colour, first match: hover white; dead metal grey; being plotted light blue; not in the selected sector; in a
  squad or vehicle yellow; else dark yellow. `selectedchararrow.sti` marks the info character and every selected row.
- Sorting: six header buttons (`goldpiecebuttons.sti`, MLG) or F1–F6. `SortListOfMercsInTeamPanel`'s swap loop over
  rows 1..`FIRST_VEHICLE − 1`, comparing against the row's merc as it was when the row was reached, is ported literally
  (ties depend on it); vehicles never sort; keys name, assignment, awake first, sector + 1000·z, last path sector,
  contract end.
- Selection: the info character plus a multi-selection; Ctrl+click toggles, Shift+click selects a range; number keys
  select a squad; while an item is held the info character changes only when the item can pass.
- Clicks (six regions per row, `Y_SIZE + 1` high, `MSYS_PRIORITY_NORMAL + 1`): name/location select (right:
  inventory); assignment → the assignment menu (§4.4) or "Remove merc" for the dead and prisoners (`pMapErrorString[41]`
  for a merc between sectors); sleep → `sleep`/`wake` for the selection; destination → plotting (§4.6), right click
  cancels the selection's routes (`cancelRoute`); departure → the contract menu (§4.3). Column glows (a red outline
  oscillating every 70 ms) and `glowclick.wav` on hover.
- Status tooltip "Health: x/y, Energy: x/y, Morale: word".

Modules: `character-list.ts` (list, literal sort, selection, column strings and colours), `team-list-view.ts` (rows,
glow, flashes).

### 4.2 Character info panel and merc inventory

- Face 48×43 at (9,20) (the face system of §2.5), nickname and full name centred, two assignment lines (training stat,
  trainer's town, repair target, `ETA` of a merc in transit or moving, else the location), the ten stats (green or red
  for `CHANGE_STAT_RECENTLY_DURATION` after a change), health `life/max` (red below 25 %, yellow below 50 %, metal grey
  at 0, the maximum flashing after a change, `??` for a prisoner), morale word, contract (`1.8d/7d` or `{h}h/7d`;
  M.E.R.C. `{len}d/{hired}d`; N/A), salary by the type of the last contract, medical deposit, the three corner icons
  with tooltips, bars at (66,61) (`DrawSoldierUIBars` at `BAR_INFO_X/Y`), the hand item at (6,81) (not with the
  inventory open or for the dead), previous/next merc buttons (`info-panel.ts`). Vehicles show no condition or fuel
  (gap "Vehicles as characters").
- The merc inventory replaces the list for an accessible merc (not in transit, not a prisoner, not a vehicle or robot,
  not an EPC, above `OKLIFE`): the tactical inventory widget at the map slot table (`UILayout.cc:93-111`), armour
  `{3d}%`, weight and camo `{}%`, key ring, trash can, Done (`merc-inventory.ts`, `map-inventory.ts`,
  `map-inventory-controller.ts`, reusing §2.3's slots, popups and description box through a narrow
  `InventoryEnvironment`). An attachment or merge onto a hand or armour slot opens the description box; right click on
  a stack opens the stack popup at `INV_REGION_X/Y` (261×248), else the description box at `MAP_ITEMDESC_START_X/Y`;
  the trash can asks `pTrashItemText[0]` and sends `discardItem` (`GlowTrashCan` never shows a glow: its colour index
  stays 0, reproduced); Done is refused with an item in the cursor or a stack popup up.
- Commands as on the tactical screen (`moveItem` without AP, passing items to another merc, into the sector pool).
  Deviations: "Map inventory cursor" (the cursor stays in the client, Esc drops it), "Map item description" (`itemInfo`
  by item type; status, ammunition and attachments from the view, since the client's knowledge has no loaded sector on
  the map); gaps: "Trash can warning for mission items", "Map inventory details". The description box shows the money
  buttons at the original's offsets, but a split on the map does nothing (§2.9).

### 4.3 Contract button and menu

`contractbutton.sti` at (190,49), enabled by `CanExtendContractForSoldier`; the popup (`CreateContractBox`): "Contract
Options:" in yellow, a blank line, one day, one week, two weeks with `( $x )`, Dismiss, Cancel; shading and prices from
`contractOptions` or the renewal prompt (`HandleShadingOfLinesForContractMenu`). Dismiss asks "Are you sure?"
(`STR_LATE_48`, not during the renewal sequence) → `dismiss` → the `mercDeparture` prompt; dead or prisoner → Remove
Merc → `removeMerc`; during the renewal sequence the menu is the `contractRenewal` prompt and Cancel lets the merc go.
The salary-rise quote plays first when it fires. Opening holds time (§4.9). Module `contract-menu.ts`.

### 4.4 Assignment popups (`Assignments.cc`, `Utils/PopUpBox.cc`)

- Boxes: Assignment (On Duty(N), Doctor, Patient, Vehicle, Repair, Train, Cancel), EPC (On Duty, Patient, Vehicle,
  Unescort, Cancel), Squad (`Squad  N ( n/size )` up to `GetLastSquadListedInSquadMenu`, then Cancel), Vehicle, Repair
  (vehicles but the helicopter, the robot, Items, Cancel), Training (Practice, Militia, Trainer, Student), Attribute
  (nine stats), Remove merc. Submenus open right of the parent box at the parent line (`DetermineBoxPositions`: repair
  four lines lower, training five, vehicle three; attribute right of training); the parent line stays highlighted.
- One region per line at `MSYS_PRIORITY_HIGHEST − 4`; callbacks run for shaded lines too and decide themselves; a
  shaded line is not highlighted. A full-screen mask (created under the popup it guards) closes every menu on a button
  release, the first release after opening ignored; right click on a parent closes its submenus.
- PopUpBox drawing: background PCX blitted from its top-left (not tiled), `popup.sti` corners and edges, margins l6 t6
  b4 r4, line space 2, colours light green / white highlight / grey shade / yellow secondary shade.
- Shading comes from the **`assignmentOptions {soldier}`** hint (every line with `{enabled, shade: none | gray | yellow,
  reason?}`), so the client runs no rule.
- Clicks: `assignSquad`, `assign {kind: doctor | patient | repair | trainMilitia | trainSelf | trainTeammate |
  trainByOther, stat?, target?}`, `boardVehicle`, `unescort`, `removeMerc`; the squad error strings, `STR_LATE_18` for
  a full vehicle; militia training opens the payment prompt. For a multi-selection the clicked merc first, then the
  others; one failure box when any failed (per-soldier results of `assign {soldiers}`).

Modules: `assignment-menus.ts`, `map-menu.ts` (popups and the screen mask).

### 4.5 The map view

- `interface/b_map.pcx` (an 8-bit picture at double resolution) blitted at half scale (every other pixel) at (271,10);
  sector (x, y) has its cell at (270 + 21x, 10 + 18y), 21×18; the clip rectangle (289,27)–(627,316). No zoom.
- Shading (surface): unvisited sectors darkened ×0.48 with `ShadowRect` one pixel higher than the tints (as written);
  the airspace filter tints cells red or green through `Create16BPPPaletteShaded(mono)` palettes (light and dark). The
  four tinted half-scale copies of `InitializePalettesForMap` are computed once per data set and registered as RGB
  images (`src/app/map/map-board.ts`, `UiAssets.addRgb`). Ground control is not shown by shading.
- Underground levels: `mine_1/2/3.sti` instead of the map, unvisited underground sectors filled near-black,
  "Sublevel: N".
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
  `zMarksMapScreenText[1]`, when the player has none; observed, not checked against the original: this message takes
  the first right click on the map); levels 0–3 (Insert/Delete); hover outline white, selected sector yellow
  (alternating while hovered), the index labels flashing in sync; the sector locator `hilite.sti` (red for the battle
  sector and Skyrider's sites, yellow for whoever speaks, 80 ms frames).
- Sector names and facilities (`facts.ts`): `GetSectorLandTypeString` (secrets and SAM sites first, the facilities, the
  town, the creature lair underground, the traversability), `GetSectorIDString`; a town whose base sector (its
  smallest) holds no secret is always known (`IsTownFound`). Static facts (town names and `townPoint`, land types, mine
  and SAM locations, facilities, radar maps) come from content.

Module `map-view.ts` (board, shading, sites, mines, towns, militia, icons, arrows, item counts, levels, locators,
cursors, the helicopter and its destination).

### 4.6 Route plotting, the move box and the ETA

- Plotting starts from the destination column or a click on the selected sector (the move box first when several units
  can move) after the movement checks (`CanCharacterMoveInStrategic`: refusal tokens map to `pMapErrorString`); the
  selection is adjusted to who must and cannot move together (the server's `route` and `routeGroup` refusals). Cursors
  `walkingcursor.sti`, `vehiclecursor.sti`, `check.sti` over the last path sector.
- After the pointer rests 200 ms on a sector, the temporary path, the ETA and the checkmark come from the
  **`previewRoute {extend, alone}`** hint and are drawn statically. Each click appends a leg kept in the client ("Click
  again on the destination to confirm…"); the click on the last sector sends one `route {to, via, shortest?, extend:
  true}` per selected group (`routeGroup` from the move box); Shift = shortest route. Right click on the merc's sector
  cancels, on the old path sends `shortenRoute {soldier, at}`, on a new leg drops the later legs; Esc drops the pending
  legs. The confirming merc (a random awake selected one) says his OK battle sound. Deviation "Map route plotting".
  Observed, not checked against the original: with `pinClock=1` the plotting rest never ends (the map goldens plot
  through the hook).
- Path drawing with `mapcursr.sti` (lines, turns, U-turns, arrows, the green start X and red end X); the plotting
  character's permanent path pulses (20 ms per step, 1000 ms pause) (`path-trace.ts`, `TracePathRoute`).
- **Kept quirks** (D1, decided). `TracePathRoute` skips arrows at nodes with x ≥ 598
  (`Map_Screen_Interface_Map.cc:1400-1401`): a screen test (`x < logical width − 2·MAP_GRID_X`), so the client skips
  the column-16 arrows only at 640 pixels wide, as Stracciatella does. The plotting ETA counts the remaining arrival
  time twice when a path exists: `GetGroundTravelTimeOfSoldier` adds `GetPathTravelTimeDuringPlotting` for the temporary
  path and for the merc's path, each starting from arrival − now for a group between sectors and skipping its first
  node (`MapScreen.cc:939-1045`, `7142-7150`; vanilla `MapScreen.c:2108-2114`, `10110-10123`); the `previewRoute` hint
  keeps it (`src/sim/strategic/map/plotting.ts`, test in `src/server/hints-strategic-stub.test.ts`). Both are display
  rules the oracle does not reach.
- ETA box `eta_pop_up.sti` at (476,291), "ETA:" and the value (`DisplayGroundEta`: hours and minutes under a day, else
  days and hours).
- **Move box** (`move-box.ts`, `move-selection.ts`): `CreatePopUpBoxForMovementBox` at (450,100) kept inside the map
  view, the header white, Plot and Cancel yellow; squads, vehicles with passengers and other mercs with toggles in
  character-list order (`SetUpMovingListsForSector`); a second click on the same line within
  `DBL_CLICK_DELAY_FOR_MOVE_MENU` acts as Plot when something is picked; a mask at `MSYS_PRIORITY_HIGHEST − 4` closes
  the box. Its options come from the `moveBoxOptions` hint; the confirm sends one `routeGroup {soldiers, squads,
  vehicles, to, via, shortest}` and the server regroups (deviation "Move box regrouping").

Module `plotting.ts` (legs, the 200 ms rest, previews, confirmation, shortening, group plotting).

### 4.7 Helicopter

- With the airspace filter the helicopter icon is drawn between its sector and the next at `helicopter.progress`, the
  passenger count beside it, the destination shadow at the path's end.
- Plotting: a click on the icon sends `heliPlot` (Skyrider's greeting, the empty-helicopter hint once, why he cannot
  fly); cursor `chopper.sti`; legs as in §4.6 with `shortenHeliRoute`; the distance box `pos2.sti` (total distance,
  safe, unsafe, total cost, ETA, passengers; `DisplayDistancesForHelicopter`: above the bottom rows when the pointer is
  on row 13 or lower, `pHelicopterEtaStrings` 0..4 and 6) from the `previewHeliRoute {extend}` hint; confirm →
  `heliRoute {via, extend, plotted}`; refusals map to Skyrider's quotes (owed, returning, grounded, unwilling).
- In flight: quotes, payment messages, the monologues that turn the airspace filter on and flash sites come as events
  (`29` §18; deviation "Helicopter interface").

### 4.8 Town and mine box, militia popup, sector inventory

- **Town/mine box** (`town-info-box.ts`): right click on the selected sector (Militia filter off); a PopUpBox with
  Inventory and Exit buttons (`mapinvbtns.sti`); mine: name, sector, status, daily production, possible production,
  rate, town control, loyalty, ore type; town: land type, sector, size, facilities (`sFacilitiesStrings` joined by
  commas, "none"), control, loyalty, associated mine; militia lines (controlled, counts by rank, civilian training %);
  enemy forces; item count.
- **Militia popup** (`militia-popup.ts`): right click with the Militia filter on (`HandleMilitiaRedistributionClick`: a
  found town that trains militia and has no fight in its militia map, else `pMilitiaString[2]`, `pMapErrorString[31]`
  with the town, or `[30]` for a found SAM site); `militia.sti` box, the town's 3×3 mini-map (`militiamaps.sti`),
  per-cell totals right-aligned (shifted 15 left in the selected cell) and rank icons, uncontrolled sectors shaded, the
  unassigned row, per-rank buttons, Auto and Done; nine cells at `MSYS_PRIORITY_HIGHEST − 3`. The client keeps the
  pick-ups, drops and the cursor and sends **`moveMilitia {from, to, rank, count}`** and **`distributeMilitia {town}`**
  (Auto); closing with troops on the cursor spreads them on the server (`29` §19; deviation "Militia
  redistribution").
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

### 4.9 Bottom panel, messages, compression and time

- Message list (`message-list.ts`): 9 visible lines of `TINYFONT1` at (20, 377 + 9n), clipped to (17,366)–(407,461),
  in a 256-line ring wrapped at 300 px (`MSG_DIALOG` in `DIALOGUE_COLOR`, `MSG_INTERFACE` in `INTERFACE_COLOR`, the
  feedback kinds not kept, a dialogue line as `Name: "line"`), the scroll bar and arrows (right click ±9, repeat 100 ms,
  wheel ±3), Up/Down/PgUp/PgDn/Home/End; `newbeep.wav` per message. Content: the server's message entries (`29` §7),
  formatted by the client (deviation "Message list"). `SessionClient` keeps the message log (welcome and frames) and
  notes a driver the server stopped.
- Laptop (456,410), Tactical (496,410), Options (458,372) buttons; the new-mail icon blinking 667 of 1000 ms
  (`newMail`); enabled per frame from `AllowedToExitFromMapscreenTo` and the **`canEnterSector`** hint (no message, the
  button is hatched; deviation "Gates outside the hints"); Laptop → `openLaptop`, Tactical → `enterSector` or
  `tacticalScreen`.
- Compression (`compression.ts`, `bottom-panel.ts`): less/more buttons and the label (`sTimeStrings` of the mode while
  compressing, else of X0, in `COMPFONT` at (489,457); "Paused" blinking); X1 is skipped on the map; more starts at 5
  minutes per second, less steps down and sends `stopTime` below 5 (deviation "Map compression step down"); Space
  toggles. The buttons follow the clock's `canCompress` and the client's own reasons (menus, plotting, an open
  inventory); a click on a masked button explains why (`compressRefusal`); an enemy presence opens the non-persistent
  pre-battle interface. The border and compression buttons act on the press (layout `down` actions, no 250 ms
  repeats).
- Balance and daily income (`projectedDailyIncome`), the selected sector's name, the radar map of a visited sector, the
  clock (`RenderClock`: `pPausedGameText[0]` while the player paused, red in combat; click = pause).
- **Time.** `SessionMapClient` (`src/app/map/map-client.ts`) drives the session in real time at speed 1 with
  `pauseOn: ['assignmentDone', 'fellAsleep', 'wokeUp', 'contractsExpiringSoon']` for the update box (`28` §1.4).
  Menus, plotting, boxes, the town box, the militia popup, the inventories and the update box hold time (the driver goes
  manual), like `InterruptTimeForMenus` and `UpdatePausedStatesDueToTimeCompression`; after the server stops on an
  event the driver restarts once playback has caught up and nothing holds it; leaving the map stops it so the tactical
  driver starts clean.

### 4.10 Boxes and prompts

- Message boxes of §1.6 centred on (0,0,640,340) (`DoMapMessageBox`). Decision prompts open as the original's boxes
  (`map-prompts.ts`): militia payment and continuation (`pMilitiaConfirmStrings` 0, 1, 6 and 3, 4), simultaneous
  arrival (`STR_DETECTED_SINGULAR/PLURAL`, the enemy type, `STR_COORDINATE`), NPC of note (`pLandMarkInSectorString`,
  OK at the final destination, else CONTINUE/STOP), merc departure (the GENERIC buttons with the two sectors, REHIRE
  when the merc may be rehired), insurance (`zMarksMapScreenText[10]`); a box closes when its prompt is answered
  elsewhere (deviation "Map screen boxes for prompts"). The PBI and autoresolve are screens (§5).
- **Update box** (`update-box.ts`): assignment done, auto sleep and wake, contracts expiring;
  `group_confirm_tactical.sti`, medium faces from `faces/65face`, bars, names, "Continue" / "Stop"; Space continues, Esc
  stops; opened once the client has played the tick the driver stopped on, one box per frame, the reason set last wins
  (deviation "Update box timing"). Observed, not checked against the original: a merc put to sleep by command is not
  listed (`fellAsleep` is the hourly rest's).
- UI messages (`ui-message.ts`): a 200 px box centred in the map view, shown 1000 + 50 ms per character.
- Arrival notices, control changes and refusals reach the message list as server entries; `groupArrived {final}` also
  selects the arrival sector.

### 4.11 Hotkeys (`GetMapKeyboardInput`, `MapScreen.cc:2540-3075`)

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
| c, h, i, l, m, o, t, w, z | contract menu, help (§1.7), items filter, laptop, mines, options, teams, towns, militia |
| Ctrl+S, Ctrl+L, Alt+X, Alt+A | save screen, load screen, exit prompt, assignment menu |
| Ctrl+I | sector inventory (Stracciatella) |
| v, Alt+S, Alt+L | bound but do nothing (gap "Map screen speech" for `v`) |

### 4.12 Implementation

| Module | Content |
|---|---|
| `src/ui/screens/map/map-screen.ts` | regions, timers, the Esc chain, filters, levels, compression, prompts, exits; `map-controller.ts` binds the layout's buttons, regions and keys |
| `src/ui/screens/map/*` | the modules named in §4.1–§4.10; `environment.ts` (`MapEnvironment`), `layout-params.ts`, `merc-soldier.ts` |
| `src/app/map/map-host.ts` | `MapHost` per session: client knowledge and hint provider, the layouts and their assets, the board, the item catalogue and profiles, `map-media.ts` (messages from the session's log, dialogue lines from the EDT files, the radar map), `map-sound.ts` (`glowclick.wav`, `newbeep.wav`, the confirming merc's OK sound); also the battle-entry client and layouts (§5.4). The front-end flow reaches it through a `MapPort`. The host waits for the client knowledge before it is ready; the map and tactical hosts each open their own client knowledge per session (one would halve the memory) |
| `src/app/map/map-hook.ts` | `window.__ja2Ui.map`: `ready`, `error`, `screen` (`selectedSector`, `level`, `info`, `selected`, `plotting`, `filters`, `menu`, `uiMessage`, `rows`, `messages`, `clock`, `inventoryOpen`, `changingArrival`, `compression`, `flow`, `prompt`, `townBox`, `militiaTown`, `militiaCursor`, `moveBox`, `updateBox`), `holds`, `lagTicks`, `commands`, `hints` (shadow mode with `?shadowHints=1`), `command`, `advance`, `sectorPoint`, `rowPoint`, `helicopterPoint`; `mapInventory` on the screen |

---

## 5. Battle entry: PBI, autoresolve, placement

The pre-battle panel is part of the map screen (as `gfPreBattleInterfaceActive` is); autoresolve is a screen pushed over
it and popped when the battle closes. Server side: `29` §20.

### 5.1 Pre-battle interface (`Strategic/PreBattle_Interface.cc`)

- Opens with a `preBattle` prompt (deviation "Pre-battle interface": at the end of the step, without the quote time);
  from tactical the page switches to the map screen (`gameScreenOf` shows the map while the prompt is open, though the
  server flow is still tactical). An automatic start (`preBattle {autoStart}` event) that arrives before the map screen
  exists is kept by `MapHost`. **Persistent** (a fresh battle): one of three buttons must be pressed.
  **Non-persistent** ("BATTLE IN PROGRESS", opened by the battle sector's red locator (`battleLocator`) or by trying to
  compress during a battle): the client sends `showBattle {}`, the server opens the prompt with `persistent: false` and
  a `close` option, Esc closes (deviation "Non-persistent pre-battle interface").
- Opening: `laptop power up (8-11).wav`, a 1 s stretch from the battle sector's cell to (131,180) with the gravity curve
  of `DoTransitionFromMapscreenToPreBattleInterface` (`:530-622`), input ignored until the first normal frame; the
  battle sector and the team filter are selected as `InitPreBattleInterface` does.
- Layout `pre-battle.json` (screen `preBattle`): the blanket at `HIGHEST − 5`, the MLG `prebattlepanel.sti` (main panel,
  title pieces, column headers, the uninvolved header), constants `TOP_Y` 113, `BOTTOM_Y` 349, `ROW_HEIGHT` 10
  (`:88-97`); buttons `prebattlebutton.sti` at (27,54), (98,54), (169,54) (Auto Resolve, Go To Sector, Retreat Mercs;
  `BLOCKFONT` beige, hover white; disabled buttons keep their tooltip); the custom `preBattlePanel` renderer takes every
  position of `RenderPreBattleInterface` as parameters. Header (blinking for the non-persistent PBI and ambushes):
  battle in progress, invasion, encounter, ambush, entering enemy sector, creature attack, bloodcat ambush, bloodcat
  lair; location, enemy/creature, merc and militia counts ("?" when the player does not know); involved mercs (name,
  assignment, condition word, HP%, BP%) and uninvolved mercs (name, assignment, location, destination, departure, by the
  map screen's column strings) or "None".
- Actions: `answer {prompt, choice: autoresolve | enterSector | retreat | close}` (also a, e, r, Esc, which reach the
  panel before the map screen's keys); enable states and fast help per kind and reason from the prompt's
  `options [{choice, enabled, reason}]`; an automatic start shows the pressed Autoresolve for a frame. The panel data
  (involved groups, uninvolved `betweenSectors`, `departure`, the original's destination rule: the path's last sector
  whenever there is a path) come from `src/sim/campaign/pre-battle-panel.ts`.
- `showBattle` is a prompt rather than a summary query so the summary keeps the original's side effects (the wake-up,
  the stopped compression) and the panel needs no second code path.
- The retreat-path preview is not drawn (gap "Pre-battle retreat preview").

### 5.2 Autoresolve (`Strategic/Auto_Resolve.cc`)

- A screen over a darkened snapshot of the map screen (`autoresolve.json`: the blanket at `HIGH − 1`, the custom
  `autoresolvePanel`, the ten `autobtns.sti` buttons bound to the geometry, `smfaces.sti`, `indent.sti`); opening:
  `laptop power up`, 1 s, the panel grows from (0,0) with a cubic in-out easing.
- Geometry by unit counts (`:844-907`, `:2132-2283`; `autoresolve-geometry.ts`: `CalculateRowsAndColumns`,
  `CalculateSoldierCells`, `BuildInterfaceBuffer`, button and text positions, the time modifier): columns per side by
  count, mercs and militia share the left side, width and height formulas, centring; `interface/autoresolve.sti`
  (corners, edges, texture, centre column pieces, merc and other cells).
- Cells (`autoresolve-cells.ts`): column pitch 55, row pitch 47; merc faces `faces/65face/NN.sti` (by `profile`), others
  `interface/smfaces.sti` (admin, troop, elite, militia by rank, creatures, skulls, female variants by `female`) with a
  normal and a red-tinted palette; merc bars (life max, bleeding, life, breath max, morale) in the code's colours; the
  hit flash (white frame, then 150 ms black + red face); unconscious shadowed; dead = skull; status text in
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
  (deviation "Autoresolve pace"). The robot's optimistic retreat display follows the server one slice later.
- Sounds (`autoresolve-sounds.ts`, `BattleSound`; volume 50 or `HIGHVOLUME`, centred): shot sounds by weapon with the
  lock'n'load, misses, impacts with the target's hit sound, falls, deaths and splats (decided in the simulation,
  `19` §4.3), creature sounds, the defeat laugh or eating; Finish mutes them and plays the composite sound. Militia and
  enemy voices are the client's pick (deviation "Autoresolve battle voices"). Music stays the server's (`arBattleOver`
  sets victory or defeat).
- Commands: Retreat → `autoresolveRetreat {}`, a merc cell → `autoresolveRetreat {soldier}`, Yes/No → `answer
  surrender`, Bandage → `answer bandage` (`data.bandaged`), Done → `answer autoresolveDone` (`bandageRefusal`).
- Surrender and capture are covered by unit tests only (they need day 4 and a stalled battle).

### 5.3 Tactical placement GUI (`TileEngine/Tactical_Placement_GUI.cc`): not built

Entering from a persistent PBI started by the player's group shows, in the original, the overhead map with the
placement panel (`interface/overheadinterface.sti`, `panels.sti`, `overheaduibuttons.sti`: Clear, Spread, Group, Done),
merc slots with `faces/65face` portraits and bars, the non-placeable area hatched. ja2-node places automatically
(deviation "Tactical placement"); a GUI would need a placement prompt, a `placeMercs` command (`29` §17) and the
overhead-map renderer (§3.6).

### 5.4 Implementation

| Module | Content |
|---|---|
| `src/ui/screens/battle/battle-entry.ts` | follows the prompt, the automatic start and the flow; switches the map screen to the panel and to autoresolve |
| `pre-battle.ts`, `pre-battle-text.ts` | the stretch, header and blink, title bars, frames, labels, counts, rows, fast help |
| `autoresolve-screen.ts` | Play, Fast, Finish, Pause, Space, Retreat and the merc cells, surrender, Bandage with its box, Done, the result and the elapsed time; also the modules named in §5.2 |
| `src/app/battle/` | `SessionBattleClient` (commands, the driver, `advance`, the latest view), `BattleSound` (the effects, battle voices through `battleSoundCue`), `battle-hook.ts`: `window.__ja2Ui.battle` (`ready`, `state` with `screen`, `preBattle {prompt, persistent, encounter, phase, autoStart}`, `autoresolve {opening, status, speed, paused, interface, pending, cells, result, elapsed, ratio}`, `commands`; `drives`, `commands`, `sounds`, `buttonPoint`) |

With `pinClock` the 1 s openings finish at once (the frozen clock cannot time them).

---

## 6. Laptop

About 39,000 lines in 117 original files: 44 laptop modes plus 15 I.M.P. sub-pages, about 50 distinct screens counting
sub-pages as templates, about 300 widgets and 200 `laptop/*.sti` pictures (27 MLG pictures with baked-in text that
follow the data version). Every page is a static composition (a tiled background, a few STIs, wrapped Arial text, image
buttons at `#define` constants); the expensive pieces are shared widgets (the face, the Ian wrap with the height measure
that decides mail and file paging, the text field, the drop-down, the slider, the item picture cell). Each page is one
layout (`data/layouts/original/laptop*.json`, `aim-*`, `bobby-ray-*`, `merc-*`, `broken-link`, `imp-*`, `insurance-*`,
`florist-*`, `funeral`) and one controller under `src/ui/screens/laptop/`, with the constants of the page's source file
in `data/tables/ui-constants/`. Text comes from the EDT layouts and the L10n tables; every decision is a command or
query (`29` §21), and the laptop is a modal flow on the server (deviation "Laptop as commands"). Not reproduced: mouse
confinement, the rain delay and rain ambience (dead code in Stracciatella), cheat keys, vanilla's empty Sir-Tech page.

### 6.1 Shell (`Laptop/Laptop.cc`)

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
  sub pages (`FASTEST_UNIT_TIME` 2 when revisited), `LONG_UNIT_TIME` 120 for M.E.R.C. while its server is still up; none
  between the A.I.M. members and the mug shots. The unit is scaled by the client setting `websiteLoadingTimeScale`
  (Stracciatella's `website_loading_time_scale`, default 1.0; 0 = off). The disk light flickers with `Random(2)` every
  50 ms on the client PRNG (3000 ms more after the load; deviation "Cosmetic laptop draws").
- Opening plays `laptop power up (8-11).wav`; music `LAPTOP` (server). The original zooms the laptop out of the map
  screen button over 1 s (scale 10000 / (100 − p), centre from (472,424) to (320,240)) and back on exit; a new game
  starts in the laptop without the zoom. The zoom is built (`zoomOnOpen`, `zoomOnClose` with the map screen's draw list
  as `backdrop`), but only the devtools laptop page turns it on; `/play` opens and closes the laptop without it.
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
  page's life. It is not saved, where the original saves the mail, finance and history pages.

### 6.2 Email, Finances, Personnel, History, Files

- **Email** (`email/`): the list (sender, subject, date; read and unread; 18 rows a page), sorted per column on the
  client by the original's insertion sort, arrival order underneath (deviation "Email order"); the read view paged by
  `IanWrappedStringHeight` with the original's page count over the whole record list (so "1 / 2" for a two-page mail);
  previous/next; delete with the right-click question. `readEmail`, `deleteEmail`; subject and body from the
  `emailText` query (substitutions and the I.M.P. report assembled on the server, Ian codes kept).
- **Finances** (`finances/`): the summary (page 0: yesterday's and today's income, deposits, debits, balance, projected
  income and balance from `financeSummary`) and the ledger from page 1, 17 rows a page, colours and `SPrintMoney`
  variants as `Finances.cc`, the transaction text (server-rendered labels) in the balance's colour,
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

### 6.3 A.I.M.

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
deviation "Cosmetic laptop draws", gap "A.I.M. conference distortion"), the impatience quotes, the animated face. No
golden: its snow and video run on the UI clock.

### 6.4 M.E.R.C. and the broken link

Home with Speck's video window (`speck-video.ts`: black for 1 s, the small face stretched to the video face, the queued
quotes of the replies and the opening said one after the other with subtitles in the merc text box, a click skips, the
X closes, the black exit); the site visit (`visitSite`, whose reply orders Speck's opening, deviation "Speck's
opening") only when entering from outside the site; the arrival box after a hire. No account; account (rows, total,
authorize behind the `BLUE_ON_GREY` question, the "Transfer failed. No funds available." box from an own label: a
hard-coded English string in Stracciatella); files (overlays for dead, married, P.O.W., hired and away, bio, stats,
salary, previous/next, hire); the broken link while the site is down. Speck's quotes come in the `mercHire`, `mercPay`
and `mercOpenAccount` replies and per listing (`advertiseQuote`, `married` for Flo). The video face is the still small
face (no animated face).

### 6.5 Bobby Ray's

Home with the under-construction gate (the frame animator, the signs disabled until the shop is open; the
under-construction visit gates the "now open" mail on the server, `visitSite`); one catalogue template for guns, ammo,
armour, misc and used (rows, big picture, specs with the rate of fire, the ammo tooltip naming the team's guns, page
arrows, subtotal, the 10-line cart as a client draft kept across pages; the original clears the cart on every laptop
entry, so no deviation); the order form (quote through `bobbyRayQuote` with an optional destination, the city
drop-down of the 17 destinations, the speed lights, clear, accept: the funds box, the destination question,
`bobbyRayOrder`, the confirmation picture); the shipments page (`BobbyRShipments.cc`; deviation "Bobby Ray's shipment
prices"). Speed indices: 0 overnight express, 1 two business days, 2 standard service (`src/protocol/bobby-ray.ts`).

### 6.6 I.M.P.

`charProfilePage` hosts the fourteen sub pages with their own sub-page loads (fast once visited in the laptop session,
none for the first page), the global cancel button and IMP-style boxes; the draft (`ImpDraft`) lives in
`LaptopMemory`. Home with the activation code (Enter on key up, `impCheckCode {code}` → `ok | badCode | noSlot`), about
us, main with the step blockers and the face icon, begin (name, nickname, gender; gap "I.M.P. begin page
focus"), the quiz (answer buttons on the press, the long, short and short2 indents, the women's questions behind
`IMP_CON_3`), the personality finish, the attribute entrance, the attributes (arrows on press and repeat, the slider
drag and click of `SliderRegionButtonCallback`, the per-frame drag past the bar ends, the zero warning; budget, bounds
and display order from the server's form rules), the attribute finish, portrait, voice (the sample on entry and on each
step; gap "I.M.P. voice samples"), finish (the analysing label and icon while pressed), confirm through
`impCreate`; the results mail via `emailText`. On the original data the attribute page's label records match the value
order; only the comments in `IMP_Text_System.cc` name the last three skill rows wrongly. The direct skill pick and the
saved I.M.P. profiles are not built (gap "I.M.P. skill page and saved profiles").

### 6.7 Insurance, florist, funeral

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

### 6.8 Implementation

| Module | Content |
|---|---|
| `src/ui/screens/laptop/laptop-screen.ts`, `laptop-page.ts`, `laptop-shell.ts`, `laptop-modes.ts`, `laptop-timers.ts`, `laptop-sites.ts`, `arrival-box.ts` | `LaptopScreen`, pages, the shell, per-site state (the Bobby Ray's cart, the M.E.R.C. session, the visited I.M.P. pages) |
| `aim/`, `email/`, `finances/`, `personnel/`, `history/`, `files/`, `bobby-ray/`, `merc/`, `imp/`, `insurance/`, `florist/`, `funeral/` | one controller per page or site (§6.2–§6.7) |
| `src/ui/widgets/` | `portrait.ts` (a face by index and size, dead faces shaded, unavailable ones under `ShadowRect`), `item-picture.ts`, `drop-down.ts` (`DropDown`, `DropDownView`: the `tactpopup.sti` pieces, the gold highlight, arrows, 17 scroll regions, the scroll top clamped to `entries − visible − 1`), `frame-animator.ts`; layout types `tiles`, `portrait`, `itemPicture`, `dropDown` |
| `src/app/laptop/laptop-boot.ts` | `bootLaptopScreen(ui, {session, memory?, settings?, zoomOnOpen?, zoomOnClose?, backdrop?, onClosed?, onQuitRequest?, onHelp?})`, `SessionLaptopClient`; profiles and items from `/api/sessions/:id/profiles` and `/api/items` |
| `src/devtools/laptop/` | the laptop on a new campaign: `?seed=`, `?session=`, `?pinClock=1`, `?wait=` (load scale), `?slide=` (step ms), `?zoom=1`, `?scale=`, `?hire=profile:days,…` (A.I.M. hires first); `window.__ja2Laptop.command` |

Server data the pages read (`29` §21): `visitSite`, the saved `newMail`, the profile endpoint (faces, bio rows),
`emailText`, contact modes and `messageLeft`, `hireCheck` and quote ids, ledger and history row text,
`financeSummary`, `readFile`, personnel blocks and `battlesFought`, Bobby Ray's quote, stock and shipment details, the
I.M.P. form rules, insurance offers, the florist price and order number, the item catalogue.

---

## 7. Story presentation

The simulation resolves the story (`26`) and reports it as events (`29` §24); the page presents them in
`src/ui/screens/story/` (`StoryLayer`, page level, fed with every frame batch before the front-end flow) and
`src/app/game/story-host.ts`. While a story step runs, the frames after its event are held and released when the step
allows (`holdsFlow`), so a screen switch the event brings waits for it. `gameScreenOf` shows the tactical screen for the
flows `meanwhile`, `endgame` and `ended`; entering it locates the Queen in a meanwhile and gridno 4561 in the endgame
(`src/app/tactical/story-camera.ts`, after `EnterTacticalScreen` and `LocateToMeanwhileCharacter`). Quote frames that
arrive before the page has a tactical screen reach it when it is built.

### 7.1 Meanwhile box (`Strategic/Meanwhile.cc`)

- `meanwhile {seq, scene, sector, at}` (a Meduna scene, resolved atomically on the server) and `meanwhileStarted` (the
  interrogation) open `BringupMeanwhileBox`'s BASIC box `"<MSG_MEANWHILE>....."` over whatever screen the event reaches
  (`meanwhile-box.ts`): OK alone for the interrogation or a scene the client setting `meanwhileScenesSeen` does not
  mark, OK and Skip otherwise. The simulation applies the original's gates (PBI closed, no panel switch, empty dialogue
  queue; `26` §1.5), so the event arrives at the right moment.
- The box is a client modal: the real-time driver goes manual while it is up (`28` §1.4; deviation "Meanwhile box
  timing").
- Meduna scenes are not played (deviations "Meanwhile scenes"; gaps "Meanwhile scene playback": the scene sandbox of
  `26` §2.4 is not built). OK and Skip both continue; a scene is marked seen only when played, as in the original, so
  none is ever marked and Skip shows only where the setting already marks the scene.

### 7.2 The interrogation

After OK the page fades out, the flow `meanwhile` shows the tactical screen in N7, the view locates the Queen, and the
page fades in. The Queen's talk panel and the YES/NO/LIE box are the talk screens of §2.8: the request is an
`npcRequest` prompt with `request: 'lie'` (choices `yes`, `no`, `lie`, `src/ui/screens/talk/npc-requests.ts`), opened
after the panel closes (`PROMPT_PLAYER_TO_LIE` calls `DeleteTalkingMenu`). Every other command is refused with
`inMeanwhile`; Escape does not end the scene. Music (server, `src/protocol/music.ts`): the menu music, then N7's sector
entry rule (`TACTICAL_NOTHING`) at `meanwhileStarted`, `TACTICAL_ENEMYPRESENT` at `meanwhileEnded`.

### 7.3 The ending

`queenKilled` → the killer's and witnesses' quotes under the victory music → `squadMovedUpstairs`: the page fades out,
lets the flow load P3 (the loading screen of `sectorLoaded`), fades in once the tactical screen is up and locates gridno
4561 while the flow is `endgame` → Derek's and Oliver's talk panels → `endgameDeferred` (creatures: the game goes on in
tactical) or every conscious merc's end-game comment → `campaignWon {…, ending: {miguelAlive, skyriderAlive}}`: fade
out, the page leaves the session (it stays on the server with flow `ended`), plays `endingPlan`'s videos
(`src/app/video/sequences.ts`), then the credits with the music off and the main menu with its music. Timing
differences: deviation "Endgame timing".

### 7.4 One-off screens

The San Mona screen after `sexScene` is §1.11; the laptop zoom §6.1; the map-to-sector zoom is not built (§1.10).

---

## 8. Sound in the UI

- **Button sounds** (`28` §3.3; schemes per screen in `src/ui/widgets/button-sounds.ts` after
  `src/sgp/Button_Sound_Control.cc:9-52`): main menu, options, save/load and init `BIGSWITCH3`; the laptop
  `COMPUTERBEEP2`; the map, tactical, autoresolve and shop screens `SMALLSWITCH2`; the game init check boxes
  `VERYSMALLSWITCH2`; each scheme an in and an out sample; message boxes inherit the screen that opened them.
- **Screen sounds**: `glowclick.wav` on map-screen hovers, `newbeep.wav` for map messages and the update box, laptop
  power up/down, the PBI and autoresolve openings and battle sounds (§5.2), the San Mona screen, the options slider test
  samples. Lip sync is §2.5; music without a session §1.1 and, in a session, the server's `presentation.music`
  (`31` §1.5), which `SessionClient` applies from frames; nothing plays during the ending videos and the credits after
  them.
- The ambient restart on an effects-volume change and the options screen stopping ambients follow the original.

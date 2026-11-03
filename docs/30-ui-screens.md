# 30 — The original screens

How the browser client rebuilds the original's screens on the `ui` layer: the front end, the tactical panels and input,
the map screen, battle entry, the laptop, story presentation and UI sound. Siblings: `28` the `ui` layer, widgets,
layouts as data, fonts, cursors, cursor hints and the verification harness; `29` every command, query, hint, view field
and event a screen uses; the rules behind the screens are the domain docs' (`16` the map and plotting, `18` assignments
and militia, `19` the pre-battle interface and autoresolve, `21` the laptop, `22` contracts, `23` the shop, `24`
dialogue timing, `26` meanwhiles and the ending, `27` saves and options, `31` sound, music, video and text, `05` the
world renderer). Each controller's `@src` header names the Stracciatella functions it ports. Coordinates, art, fonts,
colours, buttons and key tables are data: the layouts in `data/layouts/original/`, the `#define` blocks of each original
source file in `data/tables/ui-constants/`, the UI cursors in `data/tables/ui-cursors.json`.

## 1. Screens and where they live

```
/play  main menu ─ New Game → game init → confirmations (Dead is Dead: the save screen names the save)
          │          → POST /api/sessions {hire: []} → the beginning videos → laptop, nobody hired
          ├─ Load Game → save/load → loading screen → the screen of the saved flow
          ├─ Preferences → options;  Credits → credits;  Quit → the launcher
in a game the server's flow picks the screen (gameScreenOf):
   tactical ⇄ map screen ⇄ laptop      tactical: panels, talk panel, shop, overhead map, San Mona screen
   map screen → pre-battle panel → autoresolve
   story layer over any screen: meanwhile box, interrogation, ending → videos → credits → main menu
   modals anywhere: options, save/load, help, message boxes, the exit box
```

`FrontEndFlow` (`src/ui/screens/front-end/flow.ts`) switches screens like the original's exit screens; `gameScreenOf`
maps a view to tactical, map or laptop: the map while a `preBattle` prompt is open, tactical for the flows `meanwhile`,
`endgame` and `ended`. Every page follows the flow whoever changed it (another tab, an agent): the tactical and map
screens on the frame that changes it (`FrontEndFlow.frames`), the laptop by powering down when the flow leaves
`laptop` without its own exit (`LaptopScreen`, `laptop/laptop-screen.ts`). A game screen that cannot open shows the
debug layout `screen-unavailable` with the reason and Retry.

| Screen | Controllers, under `src/ui/screens/` | Host, under `src/app/` |
|---|---|---|
| Front end | `front-end/` (main menu, game init, options, save/load, credits, loading, exit box, San Mona); `src/ui/saves/`, `src/ui/settings.ts`, `src/ui/client/` | `game/front-end.ts`, `game/front-end-client.ts` |
| Help | `help/` | `game/help-host.ts` |
| Tactical | `tactical/` (panels, inventory, faces, overlays, popups), `tactical/input/` (the UI state machine, cursors, hotkeys), `talk/`, `shop/`; `src/ui/speech.ts` | `tactical/tactical-host.ts` |
| Map screen | `map/` | `map/map-host.ts`, `map/map-client.ts` |
| Battle entry | `battle/` | `battle/` |
| Laptop | `laptop/`, one directory per site | `laptop/laptop-boot.ts` |
| Story | `story/` | `game/story-host.ts`, `tactical/story-camera.ts` |

Layouts are named after their screen (`main-menu`, `tactical-sm`, `map-screen`, `pre-battle`, `aim-member`, …). The
laptop has one layout and one controller per page, with the shared pieces in `src/ui/widgets/` (portrait, item
picture, drop-down, frame animator). The test hooks on `window.__ja2Ui` are the hosts' `*-hook.ts` files.

## 2. Client and server

Controllers keep only UI state: the selection, open popups, the item cursor, pending route legs, the militia cursor,
the shop's offer, the laptop's drafts and pages. Every number the simulation computes comes from the view, a cursor
hint (the simulation's own function over the player-knowledge projection, run in the browser, `28`) or a server query;
every decision is one command; a refusal comes back as a token in `data.refusal` (`refusalOf`) that
`src/protocol/refusals.ts` maps to the original's string; screens compare tokens, never the readable `reason`. Enable states the hints cannot decide are left to the command (deviation "Gates outside the hints").

| Screen | Hints and queries | Commands | Events and view parts that drive it |
|---|---|---|---|
| Tactical | `previewMove`, `previewAction`, `estimateAttack`, `placements`, `itemInfo`, `exitSector {dryRun}`, `exitSectorOptions`, `movementOptions` | the orders and inventory commands, `select` (every change of the selection the player makes, a multi-selection with its `group`; the selections the server makes are followed from the view's `selected`, not sent back), `selectSquad` (the squad keys and the squad list; the team panel follows the view's `currentSquad`), `door`, `pickUp`, `steal`, `exitSector`, `endTurn`, `mapScreen` | `combat`, `selected`, `currentSquad`, `doorMenu`, `lifeLost`, `soldierHit`, `statChanged`, `aiTurn`, `soldierLocated`, `interfaceLevel`, `sectorLoaded.located` (the entry's locate, kept by the host until the sector's screen exists), the message log |
| Talk and shop | `quoteTrade` | `talk`, `approach`, `answer`, `closeTalk`, `skipLine`; `setShopPricing`, `trade`, `closeShop` | the quote events, `civQuote`, `npcRequest`, the tactical `surrender` prompt (asked once the offer's quote box closes), `observe.shop` |
| Map screen | `assignmentOptions`, `previewRoute`, `previewHeliRoute`, `moveBoxOptions`, `contractOptions`, `canEnterSector` | `route`, `routeGroup`, `shortenRoute`, `heliRoute`, the assignment commands, `moveMilitia`, `distributeMilitia`, `openLaptop`, `enterSector`, `answer` | the strategic view, the prompts, `groupArrived`, the update box events, `sectorLost` |
| Battle entry | the `preBattle` prompt's options | `answer`, `showBattle`, `autoresolveRetreat` | the `ar*` events, `observe.autoresolve` |
| Laptop | `hireCheck`, `aimQuote`, `bobbyRayQuote`, `impCheckCode`, `emailText` | `visitSite`, `aimHire`, `mercHire`, `impCreate`, `bobbyRayOrder`, `insure`, `orderFlowers`, `closeLaptop`, … | `observe.laptop` |
| Story | | `answer` (the lie) | `meanwhile`, `meanwhileStarted`, `queenKilled`, `squadMovedUpstairs`, `endgameDeferred`, `campaignWon`, `sexScene` |

The front end talks REST (saves, sessions, status) and uses the session socket only for an in-place `load`,
`setOption` and `leave`; the launcher shares its DOM-free parts (save rows and `SaveController`, the campaign form, the
settings model, the credits roll, `MessageBoxes`).

## 3. Design

**The original's composition, the server's rules** (`28`). Each screen draws the original's art at its constants and
reproduces its input, key phases and region priorities; where the original checks a rule inside a click handler, the
client asks a hint or sends the command and shows the refusal. Nothing a hint returns reveals what the original would
hide, so a menu line the original shades because of an unseen enemy is enabled and the command refuses (deviation
"Cursor hints on the projection").

**Tactical input is the original's state machine, ported as client code.** `tactical/input/` keeps the modes and UI
events of `Handle_UI.cc` with their names, the real-time and turn-based button queries, the menu modes and the cursor
choice; `TacticalControls` joins it with the hotkeys (`hotkeys.ts`, after `GetKeyboardInput`), the menus, scrolling and
the input lock. The dialogue layer (`talk/dialogue-layer.ts`) takes input before it and draws after it.

**The input lock follows the server, not the clock.** The enemy's turn locks input; on our turn in combat it locks
while the view says `combat.uiLocked`, while a received frame not yet played back locks the interface or passes the
turn, and while an order the original sends through `SetUIBusy` waits for its answer. The server publishes the locked
frame before the answer, so the lock has no gap; only Esc passes. Playback merely trailing the newest tick does not
lock: frames arrive unevenly under the real-time driver and a tick threshold made the lock and the cursor flicker
(deviations "Turn-based UI lock", "Playback lock").

**The item cursor and the pickup menu live in the client.** The cursor is a local selection drawn as the mouse cursor
until one command (`moveItem`, `attach`, `applyItem`, `drop`, `give`, `toss`, `pass`, …) ends it; a refusal keeps it (deviation
"Item cursor on the canvas"). The pickup menu opens on the clicked tile before the walk, and OK sends one `pickUp`
(deviation "Pickup menu").

**Speech has one presenter.** `SpeechPresenter` queues every quote event as playback reaches its frame and routes it to
a surface (the talk panel, the comm popup, the external popup, the shopkeeper, the civilian box); it owns voice,
subtitle and skip, holds a merc's line while the sound director plays his battle sound (`SpeakerBattleSounds`, `31`) and
reports a cut or finished line with `skipLine`. The overhead map holds it (`holdDialogue`) as the original leaves out
`HandleDialogue` then: the current line plays on, no other starts. The simulation finishes lines in ticks and never
waits for a viewer (`24`, deviation "Talk panel and speech on the canvas"). The map screen has no speech source (gap
"Map screen speech"); its Backspace cuts the line its frames said last.

**The shop is a DOM-free model over the shop commands** (`ShopModel`): the offers, `quoteTrade` on every change, the
original's Transaction and Done rules, the farewell before the screen closes (deviations "Shop as commands", "Shop
screen pockets").

**The map screen drives its own time.** `SessionMapClient` runs the session in real time at speed 1 and stops the driver
on the events that open a box (`pauseOn`: the update box's, `sectorLost` and `invasion`); menus, plotting, boxes and the
inventories hold time like `InterruptTimeForMenus`; after the server stops on an event the driver restarts once playback
has caught up. It never starts in the autoresolve flow, where the autoresolve screen owns the clock, as strategic time
stands still during the original's autoresolve; leaving the map stops it, so the tactical screen asks for real time anew
on entry.

**The lost sector box goes to the screen of the flow.** The original opens it with `DoScreenIndependantMessageBox` on
whatever screen is up; ja2-node's map and tactical screens both hear every frame, so the tactical screen opens it in the
tactical flow and the map screen otherwise, once it is on top again after autoresolve (`map/lost-sector.ts`). The
invasion box of a SAM site or town held by militia alone, the bloodcat ambush and lair boxes and the box of an attack on
mercs who cannot fight always go to the map screen, which the battle they announce brings up; the screen opens them
before the pre-battle panel and its automatic autoresolve, which wait for OK as the boxes' callback
`TriggerPrebattleInterface` does, and the map host keeps the events for a screen not built yet (`map/invasion.ts` from
`invasion`, `map/battle-notice.ts` from the `preBattle` event's `notice`).

**Plotting keeps the legs in the client.** The temporary path and ETA come from `previewRoute` after the pointer rests;
the legs stay in the client until the confirming click sends one `route` per group, and the move box sends one
`routeGroup` and lets the server regroup (deviations "Map route plotting", "Move box regrouping"). Decision prompts open
as the original's boxes and close when an agent answers them first (deviation "Map screen boxes for prompts").

**Battle entry.** The pre-battle panel is part of the map screen, as `gfPreBattleInterfaceActive` is; autoresolve is a
screen pushed over it. The non-persistent panel is a `preBattle` prompt opened by `showBattle` rather than a summary
query, so it keeps the original's side effects (the wake-up, the stopped compression) and needs no second code path. The
map view takes `gpBattleGroup`'s sector from the open panel and, while the pointer is on Retreat, draws the retreat
arrows from the groups' `prev` (`battle/pre-battle.ts`, `map/map-view.ts`). Autoresolve plays each second's events
evenly over the slice, then settles the cells on the view (deviation "Autoresolve pace").

**The laptop is a modal flow on the server and pages in the client.** Pages, popups, the Bobby Ray's cart and the I.M.P.
draft stay in the client until one command carries the decision (deviation "Laptop as commands"); `LaptopMemory` keeps
them for the page's life, not in saves (deviation "Laptop page state"). The World Wide Wait follows the original's
units, scaled by the client setting `websiteLoadingTimeScale`. The zoom out of the map screen is built but off on
`/play` (gap "Screen zooms"). The A.I.M. and M.E.R.C. video faces (`laptop/video-face.ts`) are the tactical
`FaceAnimator` with a queue of their speaker's quotes: no server event carries these quotes, so the pages say them
outside `SpeechPresenter` and play the voice through the handle `UiSoundSink.play` returns. The A.I.M. conference runs
the merc's impatience on the UI clock (`laptop/aim/aim-conference.ts`); the annoyance his hang-up raises is not
simulated (deviation "A.I.M. annoyance"). Its file statics live in `LaptopMemory` and its mode in the shell's `subPage`
(`giCurrentSubPage`), so a conference left for a program outside the web comes back, and a web page switch or a new
laptop session drops it, as in the original.

**Story events hold the flow.** `StoryLayer` sees every frame batch before the front-end flow and holds the frames after
a story event until its step allows, so a screen switch the event brings waits for the box or the fade; the story
camera locates the Queen in a meanwhile and the original's fixed tile in the endgame (deviations "Meanwhile box timing",
"Endgame timing").

**Draws the original makes for a screen.** The loading screen's town picture draws `Random(2)` on the gameplay stream at
sector entry; the simulation makes that draw and sends the picture as `sectorLoaded.loadScreen`, and the draw the
original repeats at every save is not made, since a ja2-node save changes nothing (`27`). The San Mona screen's time
warp and its draw are the simulation's at the action (`35`). Cosmetic draws (blinks, the disk light, the confirming
merc) use the client's `ClientRandom`.

**Front end.** `/play` opens on the main menu and starts its music on the first gesture; the splash stays in the
launcher (deviation "Game page start"). A new game sends `hire: []`, so the laptop opens with nobody hired as in the
original. Blood and gore is a campaign option in ja2-node (`setOption`, `27`); the help screens seen are kept per
campaign identity in the client settings (deviation "Help screens seen"); the options the original screen has no room
for (ambient and master volume, language, UI scale, the video switches) stay in the launcher.

**Timers.** UI timers (cursor animation, flashes, blinks, the path rest, scrolling, locators, damage drift) run on the
client clock; timers tied to game events (the enemy turn bar, message ageing) on displayed simulation time. Client
modals pause a running real-time driver (`28`).

**Sound.** Button sounds follow the original's scheme per screen (`src/ui/widgets/button-sounds.ts`); a message box
inherits the scheme of the screen that opened it. Music in a game is the server's mode (`31`); the front end plays the
main menu music itself.

**Not built.** The tactical placement GUI (deviation "Tactical placement"), the map-to-sector zoom (gap "Screen
zooms"), meanwhile scene playback (gap "Meanwhile scene playback"), the 3D cursor and the cover and sight display
(`28`'s decisions), the helicopter drop (gap "Helicopter entrance").

## 4. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Tests are under `src/ui/screens/` unless a path says otherwise.

| Quirk | Test |
|---|---|
| Every credits face blinks at once on entry: the original's unsigned clock difference | `front-end/front-end.test.ts` "blinks every face at once on entry …" |
| The character list sort compares each row with the merc it held when the sort reached it | `map/character-list.test.ts` |
| A path node in map column 16 is not drawn at 640 pixels wide: the original tests it against the screen width | `map/plotting.test.ts` "leaves out the column 16 pieces …" |
| The plotting ETA counts the remaining leg twice and drops the first temporary edge while the squad travels | `src/server/hints-strategic-stub.test.ts` "count the remaining leg twice …" |
| The move box's Other header counts vehicle passengers and skips doctors | `map/move-selection.test.ts` "keeps the original test of the others header …" |
| A head miner's line leaves the map on the level it shows: Stracciatella's switch to the surface passes the selected sector, whose level `iCurrentMapSectorZ` is (`Strategic/Map_Screen_Interface.cc:1623`, `Strategic/Map_Screen_Interface.h:229`) | `map/map-screen.test.ts` "keeps the level it shows while a head miner speaks …" |
| Space in autoresolve toggles pause and play but keeps Fast or Finish | `battle/autoresolve-screen.test.ts` "… keeps Fast through Space and Pause …" |
| The description box over a dealer box drifts down by column (the slot is multiplied before the division by the row length); over the offer area near the face it moves down instead of right | `shop/shop-panel.test.ts` "places the description box with the original quirks" |
| No tactical message line comes in or ages out while the view scrolls or the overhead map is up; the lines that aged meanwhile drop together as it stops or closes (`Utils/Message.cc:131`, `GameScreen.cc:366`) | `tactical/tactical-screen.test.ts` "lets no message line in or out while the view scrolls …", "… while the overhead map is up …" |
| The overhead map finds the cell under the pointer eight rows above it | `src/app/tactical/overhead-map.test.ts` |
| The overhead map takes every key while it is up: only ESC, INSERT and ALT+x act, and Backspace stops no line (`TileEngine/Overhead_Map.cc:419`) | `tactical/tactical-controls.test.ts` "gives the overhead map every key while it is up …" |
| While the overhead map is up the line already playing runs to its end with its voice and the panel face but no subtitle box or face popup, no other line starts, a civilian quote outlives its time unseen and the locators stand; all of it goes on as the map closes (`GameScreen.cc:366`, `TileEngine/Overhead_Map.cc:287`) | `tactical/tactical-screen.test.ts` "plays the line it opens over to its end …", "keeps a civilian quote past its lifetime under the overhead map …"; `tactical/tactical-controls.test.ts` "stops the locators under the overhead map …" |
| The stance drag keeps the arrows of its last step where no step applies (the pointer exactly 40 pixels up, beyond the stances he can take, back at the anchor), and the release goes by that step (`Tactical/Handle_UI.cc:1956`) | `tactical/tactical-controls.test.ts` "keeps the last arrows of the stance drag …" |
| A locator takes at most one step a frame, the first at once unless the soldier's last step is under 80 ms old, so a slow frame slows it down (`Tactical/Interface.cc:935`) | `tactical/overlays.test.ts` |
| Over an enemy next to the merc the item cursor says Drop for a pickup's AP, while the click tosses at him (`Tactical/Interface_Items.cc:3011`, `:3323`) | `tactical/input/item-tile-cursor.test.ts` "tosses at an enemy next to him, though the cursor there says Drop …" |
| The item cursor's crosshair stays bad from the last landing check until the pointer rests long enough on another tile, and a click before that is refused as a bad throw (`Tactical/Interface_Items.cc:3078`, `:3475`) | `tactical/input/item-tile-cursor.test.ts` "turns the crosshair bad … until the next rest …" |
| A real-time right click within the double-click time of the last one does not swap the item cursor's give and throw (`Tactical/Real_Time_Input.cc:931`) | `tactical/tactical-screen.test.ts` "passes the held item … a real-time double click does not swap back" |
| The pointer is on a soldier also on the right and bottom edge of his screen rectangle; a vehicle's picture is tested one pixel left of the pointer, at its left edge on the last pixel of the row above | `tactical/input/targets.test.ts` "… its right and bottom edges included", `src/app/tactical/world-presenter.test.ts` "tests a vehicle's picture one pixel left of the pointer …" |
| The new-mail icon opens the oldest unread mail and the new-file icon the last unread file, where the functions' names promise the most recent mail and the first file | `laptop/email/email-list.test.ts`, `laptop/files/file-pages.test.ts` |
| With exactly twenty departed mercs, going back from the first face shows an empty page | `laptop/personnel/personnel-model.test.ts` "… the empty last page included" |
| The drop-down's top snaps back one row short of the end | `src/ui/widgets/drop-down.test.ts` "snaps a top past the end back …" |
| The World Wide Wait leaves the page that asked for it drawn and its buttons live: a click during the wait changes the page to come and keeps the wait running, and a flower picked then is one of those shown (`Laptop/Laptop.cc:925`, `:1840`) | `laptop/aim/aim-policies.test.ts` "shows the page it leaves through the wait …", `laptop/florist/florist-pages.test.ts` "keeps the gallery page it leaves through the wait …" |
| The A.I.M. connection snow falls over the merc's face, with the first contact buttons already up, and never before the answering machine: INIT ends with its black, as its own snow branch is never reached (`Laptop/AIMMembers.cc:2630`) | `laptop/aim/aim-conference.test.ts` "raises the title bar, shows black, then the merc at once under two passes of snow", "greets no one pressing Hire during the snow …" |
| An A.I.M. distortion line shows its first frame only on its first run: the counter starts at 255 and later runs step past frame 0 | `laptop/aim/aim-distortion.test.ts` "shows the first line frame only on the first run …" |
| An A.I.M. merc hangs up as soon as his face stops talking, while his quote's text may stay up for its text time | `laptop/aim/aim-conference.test.ts` "hangs up once the face stops talking …" |
| With subtitles off, a voiced A.I.M. quote keeps the text time of the last quote whose text showed: `CreateTalkingUI` sets it only for text it shows | `laptop/aim/aim-conference.test.ts` "keeps the text time of the last quote whose text showed …" |
| An impatient A.I.M. merc says his two very impatient quotes from one queue: a click cuts only the first and closes the click region, and the second plays on with its text, which stays up after it until the next redraw | `laptop/aim/aim-conference.test.ts` "lets a click cut the first very impatient quote …", "keeps the text of the second very impatient quote up …" |
| The A.I.M. hire buttons stay usable through the merc's hang-up comment: the call meant to disable them passes the flag that enables them, and they are enabled already (`Laptop/AIMMembers.cc:2221`) | `laptop/aim/aim-conference.test.ts` "leaves the contract buttons usable through the hang-up comment …" |
| Hire clicked through the A.I.M. hang-up comment hangs up instead of opening the contract page: the hang-up goes before the mode change | `laptop/aim/aim-conference.test.ts` "hangs up rather than open the contract page …" |
| Only the A.I.M. first contact's Hang Up stops the merc at once; the close button, the answering machine's and the busy merc's Hang Up let him talk on under the title bar until the conference closes | `laptop/aim/aim-conference.test.ts` "talks on under the title bar when the call is closed …" |
| A hang-up pending as an A.I.M. quote is delayed waits in `DelayMercSpeech`'s static until a delayed quote is said; a mode change drops only the quote, so Transfer Funds through the hang-up comment and OK before the acceptance quote hang up the next call after its contract length quote (`Laptop/AIMMembers.cc:2832`, `:2850`) | `laptop/aim/aim-conference.test.ts` "hangs up the next call after its contract length quote …" |
| INIT leaves the A.I.M. snow and black step count as it was, so a call hung up during its snow shortens the next call's black (`Laptop/AIMMembers.cc:2374`, `:1913`) | `laptop/aim/aim-conference.test.ts` "cuts the next black short …" |
| An A.I.M. conference left for a program outside the web comes back with the statics it left: a pending hang-up closes it at once, before the answering machine plays again; a merc left refusing comes back with Hire disabled; left while the title bar rose, the merc's face and its snow show without the terminal (`Laptop/AIMMembers.cc:505`, `:2415`, `:587`, `:1653`) | `laptop/aim/aim-conference.test.ts` "plays the answering machine again, but closes at once …", "comes back to a refusing merc with Hire disabled …"; `laptop/laptop-screen.test.ts` "brings the merc's face back under its snow …" |
| Enter or Space ticks the I.M.P. gender box that has the focus even when no further I.M.P. can be created; only the click checks | `laptop/imp/imp-begin.test.ts` "tick a gender box when no further I.M.P. can be created …" |
| While the pointer is on the enabled Retreat button the map shows only the arrows out of the battle group's sector, and that sector's enemies keep the icon position of the sector drawn before it, as its team icons are skipped | `battle/battle-entry.test.ts` "draws the enemies of the sector the squad retreats from after the icons …" |
| The Retreat button's bounds for the retreat arrows include the pixel past its bottom right | `battle/battle-entry.test.ts` "counts the pixel past the bottom right of the Retreat button …" |
| While the pre-battle panel is up, a group leaving the battle group's sector also shows an about-to-arrive arrow toward its previous sector | `battle/battle-entry.test.ts` "shows a group leaving the battle sector as about to arrive …" |
| Alt+Load and Alt+C open the load screen until a Dead is Dead game names its save, then load the newest save of any kind for good: Stracciatella sets `bLastSavedGameSlot` (the client setting `lastSavedGameSlot`) only there, to the first list entry | `front-end/front-end.test.ts` "sets the last saved slot to 0 for good …" |

Not pinned yet:
- `GlowTrashCan` never shows a glow: its colour index stays 0 (`map/merc-inventory.ts`).
- The unvisited sectors' shadow sits one pixel above the airspace tints (`map/map-view.ts`; the map goldens show it).
- The laptop's one-paragraph help pages add no line after their paragraph; the other pages add one after each
  (`help/help-pages.ts`).

## 5. Not checked against the native build

The oracle runs headless, so no screen is compared with the native build: the e2e goldens cover pixels on the stub
pack, and the `*-original.test.ts` files check that the art and texts each screen reads exist in the user's data.
Inferred or observed in ja2-node only:
- Layout above 640×480 follows Stracciatella's `STD_SCREEN` offsets as read; the centred shop and the talk subtitle test
  are deviations ("Shop placement above 640×480", "Talk subtitle placement above 640×480").
- A.I.M.'s sort leaves ties to `std::sort`, which is unstable; ja2-node keeps the listing order.
- The militia filter's "no militia" message takes the first right click on the map.
- A merc put to sleep by command is not listed in the update box (`fellAsleep` is the hourly rest's).

Not ported: gaps "Tactical HUD details", "Tactical keys not yet ported", "Interactive tiles", "Tossing from the item
cursor", "Auto-bandage", "Overhead map", "Inventory panel clicks", "Team panel vehicle exit", "Map inventory details",
"Vehicles as characters", "Shop screen details", "IME composition", "I.M.P. skill page and saved profiles".

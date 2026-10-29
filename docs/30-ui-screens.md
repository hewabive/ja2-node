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
`endgame` and `ended`. A game screen that cannot open shows the debug layout `screen-unavailable` with the reason and
Retry.

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
every decision is one command; a refusal comes back as a token that `src/protocol/refusals.ts` maps to the original's
string. Enable states the hints cannot decide are left to the command (deviation "Gates outside the hints").

| Screen | Hints and queries | Commands | Events and view parts that drive it |
|---|---|---|---|
| Tactical | `previewMove`, `previewAction`, `estimateAttack`, `placements`, `itemInfo`, `exitSector {dryRun}`, `exitSectorOptions` | the orders and inventory commands, `door`, `pickUp`, `exitSector`, `endTurn`, `mapScreen` | `combat`, `doorMenu`, `lifeLost`, `soldierHit`, `statChanged`, `aiTurn`, the message log |
| Talk and shop | `quoteTrade` | `talk`, `approach`, `answer`, `closeTalk`, `skipLine`; `setShopPricing`, `trade`, `closeShop` | the quote events, `civQuote`, `npcRequest`, `observe.shop` |
| Map screen | `assignmentOptions`, `previewRoute`, `previewHeliRoute`, `moveBoxOptions`, `contractOptions`, `canEnterSector` | `route`, `routeGroup`, `shortenRoute`, `heliRoute`, the assignment commands, `moveMilitia`, `distributeMilitia`, `openLaptop`, `enterSector`, `answer` | the strategic view, the prompts, `groupArrived`, the update box events |
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
until one command (`moveItem`, `attach`, `applyItem`, `drop`, `give`, `toss`, …) ends it; a refusal keeps it (deviation
"Item cursor on the canvas"). The pickup menu opens on the clicked tile before the walk, and OK sends one `pickUp`
(deviation "Pickup menu").

**Speech has one presenter.** `SpeechPresenter` queues every quote event as playback reaches its frame and routes it to
a surface (the talk panel, the comm popup, the external popup, the shopkeeper, the civilian box); it owns voice,
subtitle and skip and reports a cut or finished line with `skipLine`. The simulation finishes lines in ticks and never
waits for a viewer (`24`, deviation "Talk panel and speech on the canvas"). The map screen has no speech source (gap
"Map screen speech").

**The shop is a DOM-free model over the shop commands** (`ShopModel`): the offers, `quoteTrade` on every change, the
original's Transaction and Done rules, the farewell before the screen closes (deviations "Shop as commands", "Shop
screen pockets").

**The map screen drives its own time.** `SessionMapClient` runs the session in real time at speed 1 and stops the driver
on the update box events (`pauseOn`); menus, plotting, boxes and the inventories hold time like
`InterruptTimeForMenus`; after the server stops on an event the driver restarts once playback has caught up. It never
starts in the autoresolve flow, where the autoresolve screen owns the clock, as strategic time stands still during the
original's autoresolve; leaving the map stops it, so the tactical screen asks for real time anew on entry.

**Plotting keeps the legs in the client.** The temporary path and ETA come from `previewRoute` after the pointer rests;
the legs stay in the client until the confirming click sends one `route` per group, and the move box sends one
`routeGroup` and lets the server regroup (deviations "Map route plotting", "Move box regrouping"). Decision prompts open
as the original's boxes and close when an agent answers them first (deviation "Map screen boxes for prompts").

**Battle entry.** The pre-battle panel is part of the map screen, as `gfPreBattleInterfaceActive` is; autoresolve is a
screen pushed over it. The non-persistent panel is a `preBattle` prompt opened by `showBattle` rather than a summary
query, so it keeps the original's side effects (the wake-up, the stopped compression) and needs no second code path.
Autoresolve plays each second's events evenly over the slice, then settles the cells on the view (deviation
"Autoresolve pace").

**The laptop is a modal flow on the server and pages in the client.** Pages, popups, the Bobby Ray's cart and the I.M.P.
draft stay in the client until one command carries the decision (deviation "Laptop as commands"); `LaptopMemory` keeps
them for the page's life, not in saves (deviation "Laptop page state"). The World Wide Wait follows the original's
units, scaled by the client setting `websiteLoadingTimeScale`. The zoom out of the map screen is built but off on
`/play` (gap "Screen zooms").

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
| Space in autoresolve toggles pause and play but keeps Fast or Finish | `battle/autoresolve-screen.test.ts` "… keeps Fast through Space and Pause …" |
| The description box over a dealer box drifts down by column (the slot is multiplied before the division by the row length); over the offer area near the face it moves down instead of right | `shop/shop-panel.test.ts` "places the description box with the original quirks" |
| The overhead map finds the cell under the pointer eight rows above it | `src/app/tactical/overhead-map.test.ts` |
| The new-mail icon opens the oldest unread mail and the new-file icon the last unread file, where the functions' names promise the most recent mail and the first file | `laptop/email/email-list.test.ts`, `laptop/files/file-pages.test.ts` |
| With exactly twenty departed mercs, going back from the first face shows an empty page | `laptop/personnel/personnel-model.test.ts` "… the empty last page included" |
| The drop-down's top snaps back one row short of the end | `src/ui/widgets/drop-down.test.ts` "snaps a top past the end back …" |
| No greeting after the A.I.M. connection snow: the snow clears the first-contact flag the greeting waits for | `laptop/aim/aim-conference.test.ts` "greets with nothing after the connection snow …" |

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

Not ported: gaps "Tactical HUD details", "Tactical keys not yet ported", "Map screen keys not yet ported", "Interactive
tiles", "Movement menu stances", "Tossing from the item cursor", "Auto-bandage", "Overhead map", "Inventory panel
clicks", "Team panel vehicle exit", "Map inventory details", "Trash can warning for mission items", "Vehicles as
characters", "Pre-battle retreat preview", "Shop screen details", "Save location on the canvas", "Inert options", "IME
composition", "Laptop video faces", "A.I.M. conference distortion", "I.M.P. begin page focus", "I.M.P. voice samples",
"I.M.P. skill page and saved profiles".

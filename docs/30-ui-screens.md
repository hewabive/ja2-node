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
| Tactical | `previewMove`, `previewAction`, `estimateAttack`, `placements`, `itemInfo`, `compatibleMercs`, `exitSector {dryRun}`, `exitSectorOptions`, `movementOptions` | the orders and inventory commands, `select` (every change of the selection the player makes, a multi-selection with its `group`; the selections the server makes are followed from the view's `selected`, not sent back), `selectSquad` (the squad keys and the squad list; the team panel follows the view's `currentSquad`), `door`, `pickUp`, `steal`, `exitSector`, `endTurn`, `mapScreen`, `autoBandage`, `endAutoBandage` | `combat`, `selected`, `currentSquad`, `doorMenu`, `autoBandage`, `lifeLost`, `soldierHit`, `statChanged`, `aiTurn`, `soldierLocated`, `interfaceLevel`, `sectorLoaded.located` (the entry's locate, kept by the host until the sector's screen exists), `autoBandageRefused`, `autoBandageEnded`, the message log |
| Talk and shop | `quoteTrade`, `compatibleItems` with `rule: shop` | `talk`, `approach`, `answer`, `closeTalk`, `skipLine`; `setShopPricing`, `trade`, `closeShop` | the quote events, `civQuote`, `npcRequest`, the tactical `surrender` prompt (asked once the offer's quote box closes), the item prompts of the loaded sector (the switch, trap and blue flag yes/no boxes and the bomb boxes' four small numbered buttons, `tactical/item-prompts.ts`; asked once the lines are said, on the map screen too), `observe.shop` |
| Map screen | `assignmentOptions`, `previewRoute`, `previewHeliRoute`, `moveBoxOptions`, `contractOptions`, `canEnterSector`, `compatibleItems`, `passTargets` | `route`, `routeGroup`, `shortenRoute`, `heliRoute`, the assignment commands, `moveMilitia`, `distributeMilitia`, `openLaptop`, `enterSector`, `answer` | the strategic view, the prompts, `groupArrived`, the update box events, `sectorLost` |
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
the input lock. The dialogue layer (`talk/dialogue-layer.ts`) takes input before it and draws after it. The soldier
under the pointer is `FindSoldier`'s, with the stack n cycles (`input/targets.ts`); the interactive tile is the
openable structure whose picture holds the pointer among the tiles the original's dynamic render pass sweeps
(`src/app/world/interactive-nodes.ts`), looked for again only as the pointer or the camera moves, with the stack n
cycles when no soldier stack is under the pointer (`input/interactive-tiles.ts`). A generic structure is one too while
an item the view shows lies on its tile, the client's reading of `STRUCTURE_HASITEMONTOP` (`12`): only the hand mode's
click and the move mode's cursor take it, as only they ask the original for such a tile, so a hand click on its picture
picks its items up and the move mode leaves them alone; the view holds only the items the squad has seen, so a
structure with hidden items on it stays plain (D16).

**The input lock follows the server, not the clock.** The enemy's turn locks input; on our turn in combat it locks
while the view says `combat.uiLocked`, while a received frame not yet played back locks the interface or passes the
turn, and while an order the original sends through `SetUIBusy` waits for its answer. The server publishes the locked
frame before the answer, so the lock has no gap; only Esc passes. Playback merely trailing the newest tick does not
lock: frames arrive unevenly under the real-time driver and a tick threshold made the lock and the cursor flicker
(deviations "Turn-based UI lock", "Playback lock").

**The helicopter drop is drawn from the view** (`25`; `29` §7). `helicopterDropStarted` centres the view on the north
entry point and drops the locate to the entry's merc; for the first landing, whose screen is not up yet, the tactical host
keeps the centre for the screen's entry (`src/app/tactical/tactical-host.ts`). While the view says
`helicopterDrop.running` the input takes the original's LOCKUI lock, the full-screen region with `CURSOR_WAIT`
(`'helicopterDrop'` beside the enemy turn's lock, `input/tactical-input.ts`), and nothing moves the view: no scrolling,
no slide, no locate, as `gfIgnoreScrolling` stops `SetRenderCenter` (`ignoreScrolling`,
`src/app/tactical/world-presenter.ts`). Esc held during a run sends `skipHelicopterDrop` once, polled every frame as
`HandleHeliDrop` reads `_KeyDown(SDLK_ESCAPE)` (`input/helicopter-drop-skip.ts`), before the key reaches the tactical
input, whose Esc then stops the selected merc as in a locked interface (`GameScreen.cc:407`, `:436`). The shadow is
`tilecache/heli_sh.sti` on the shadow layer at the view's position, looping every 90 ms from frame 0 where the view first
shows it (`src/app/world/helicopter-shadows.ts`); the one the view drops at the exit flies on while the run goes on, until
it leaves the viewport or the next round shows its own (deviation "Helicopter shadow on wide screens").
A merc in `HELIDROP` wears `s_`, `m_` or `f_helidrp.sti`; on stubs his own drop pose (`stubs/soldiers.ts`). The "has
arrived" lines come with the message list (`mercDropped`, `src/server/message-entries.ts`).

**Auto-bandage stops the tactical screen** (`tactical/auto-bandage-box.ts`). The `a` key sends `autoBandage`: a refusal
shows its OK box (`REFUSAL_MESSAGES`), and the question is the `beginAutoBandage` prompt in the item prompts' yes/no box,
the same box a won battle opens. While the view carries `autoBandage` the screen does what `MainGameScreenHandle` does
after `HandleAutoBandage`: nothing. It neither updates nor scrolls, and takes no input but the box's keys and the
buttons above its mask. Its first frame draws the screen as it stood, shadows it and captures the picture; every later
frame draws that picture, opaque over the whole screen, under the box, whose bars read the soldier views as playback goes
on; from then on the tactical host draws no world below it, though the sound still follows the view (`worldCovered`,
`src/app/tactical/tactical-host.ts`). Done and Stop, enabled by
`complete`, and Esc, Enter and Space as `HandleAutoBandage` reads them, send `endAutoBandage` once; the box goes with the
view's block, at the end of the next tick. The OK boxes of a pending question the sector no longer allows
(`autoBandageRefused`) and of a failed full check (`autoBandageEnded.failed`, `pDoctorWarningString[1]`) are viewer
prompts. The face cell is the map update box's (`src/ui/widgets/update-panel-face.ts`), the art the `tactical-input`
layout's. In a talk the key sends nothing, as the conversation is modal (`29` §5; deviation "Auto-bandage key in a
talk").

**The item cursor and the pickup menu live in the client.** The cursor is a local selection drawn as the mouse cursor
until one command (`moveItem`, `attach`, `applyItem`, `drop`, `give`, `toss`, `pass`, …) ends it; a refusal keeps it,
and so does a `combineStack` or an `applyItem` that leaves objects in it, at the index its answer names, and a
`moveItem` that leaves one, on the pocket its `leftover` names (deviation "Item cursor on the canvas"). The pickup menu opens on the clicked tile before the walk, and OK sends one `pickUp` (deviation
"Pickup menu").

**The overhead map is the picture the player last saw.** The original composes it from the level nodes at every entry;
ja2-node composes it in the client at every entry (`redrawOverheadMap`) from what the world renderer last drew: the
level with the view's tile changes and blood, the room reveals, the open doors and the shade field
(`src/app/tactical/overhead-map.ts`, `05`), each node at its tile's land or roof shade (deviation "Light on
structures").
Persons, item dots and the item lists come from the view, so hidden items and unseen soldiers stay out (deviation
"Overhead item lists over hidden items"). The team panel disables its buttons by a flag the overhead map, the item
cursor and the pickup menu set and clear, as the original's is (`tactical/tactical-screen.ts`).

**Speech has one presenter.** `SpeechPresenter` queues every quote event as playback reaches its frame and routes it to
a surface (the talk panel, the comm popup, the external popup, the shopkeeper, the civilian box); it owns voice,
subtitle and skip, holds a merc's line while the sound director plays his battle sound (`SpeakerBattleSounds`, `31`) and
reports a cut or finished line with `skipLine`. The overhead map and the laptop hold it (`holdDialogue`, each its own
`DialogueHold`) as the original leaves out `HandleDialogue` then: the current line plays on, no other starts (the map
screen cuts the current one as the laptop opens, `StopAnyCurrentlyTalkingSpeech`); the laptop's hold follows the shown
view, so a line the server said before the laptop opened waits for the map screen. A load in place (a `welcome` on an
open link) and a switch to another session drop the queue and silence the line being said without reporting them
(`discardLines`), as `LoadSavedGame` empties the dialogue queue, which a player load does on the server too (`27`
§1.5). The simulation finishes lines in ticks and never waits for a viewer (`24`, deviation "Talk panel and speech on
the canvas").

**One presenter per session serves the tactical and map screens** (`src/app/sound/session-speech.ts`), as the original
has one talking face for every screen: a line goes on across a screen switch and each screen draws it its own way.
Both screens hear every frame, so the screen that hears a frame first takes its lines (`takesFrame`); the map screen
takes none while another screen is up, so its routing never decides a tactical line. On the map a merc's line moves
the lips of the info face, makes him the info character with speech on (on entry whatever the option, as
`ContinueDialogue`; with an item held only if he could take it, `passTargets`) and is subtitled in a box beside the
face; the box, the face, Backspace and Esc cut it, opening the contract menu or the laptop stops it
(`map/map-speech.ts`). Skyrider and the head miners talk there in the external face popup with their box 97 to its
right, at the panel the line event names (a Skyrider monologue's or the miner's mine's, `panel`; the default
otherwise), and a merc line without a soldier in the popup at the screen's 10, 20. The yellow locator takes the sector the line event names as the line starts (`sector`; Skyrider's helicopter,
`helicopter`, not while the airspace shows). Which screen a line started on and where its box and popups went is the
session presenter's `TalkingUi` (`talk/talking-ui.ts`), so a line carried across a screen switch keeps its box where it
was and takes the original's popup changes. The rest is gap "Map screen speech".

**The shop is a DOM-free model over the shop commands** (`ShopModel`): the offers, `quoteTrade` on every change, the
original's Transaction and Done rules, the farewell before the screen closes, the parts a repairman leaves drawn in
their pocket's slot (deviations "Shop as commands", "Shop screen pockets", "Repairman's parts"). The entry quote comes
with `openShop`; the panel holds it the original's 800 ms (`ShopPanel`), and outlines what goes with the item under the
pointer by the `compatibleItems` hint's shop rule.

**The map screen drives its own time.** `SessionMapClient` runs the session in real time at speed 1 and stops the driver
on the events that open a box (`pauseOn`: the update box's, `sectorLost`, `invasion` and `vehicleOutOfGas`); menus,
plotting, boxes and the inventories hold time like `InterruptTimeForMenus`; after the server stops on an event the
driver restarts once playback has caught up. It never starts in the autoresolve flow, where the autoresolve screen owns
the clock, as strategic time stands still during the original's autoresolve; leaving the map stops it, so the tactical
screen asks for real time anew on entry.

**The lost sector and out-of-gas boxes go to the screen of the flow.** The original opens them with
`DoScreenIndependantMessageBox` on whatever screen is up; ja2-node's map and tactical screens both hear every frame, so
the tactical screen opens them in the tactical flow and the map screen otherwise, once it is on top again after
autoresolve (`map/event-boxes.ts`). The enter sound of a ground vehicle follows the same split: the sound director plays
it at the vehicle's tile in the tactical flow, the map screen otherwise, at the same tile against the tactical camera
last shown, as the original's `SoundVolume` and `SoundDir` read the world view the last scroll left
(`Utils/Sound_Control.cc:555`; `src/app/map/map-sound.ts`). The invasion box of a SAM site or town held by militia
alone, the bloodcat ambush and lair boxes and the box of an attack on mercs who cannot fight always go to the map
screen, which the battle they announce brings up; the screen opens them before the pre-battle panel and its automatic
autoresolve, which wait for OK as the boxes' callback `TriggerPrebattleInterface` does, and the map host keeps the
events for a screen not built yet (`map/invasion.ts` from `invasion`, `map/battle-notice.ts` from the `preBattle`
event's `notice`).

**The loaded sector's events reach the map screen too.** While time is compressed the map screen's real-time turn runs
on the loaded sector (`15` §2), so its bleeding, deaths and sightings come with the campaign's tick to both screens. The
tactical screen is not updated while another screen is up, as the original runs `ExecuteOverhead` on the game screen
only: a damage number of a bleed on the map, the summed loss since, drifts once the tactical screen is back
(`DamageNumber`, one step a frame, `tactical/overlays.ts`), and the sound director plays no animation sound meanwhile
(`31`). The map screen shows what the original's shows: a merc of ours who bleeds becomes the info character and his face
flashes (`mercBled`, `SoldierBleed`'s `SetInfoChar`), `damageFeedback` flashes the info face as the map's
`HandleAutoFaces` animates it, a point of maximum life lost while dying prints the maximum life red, as a health gain
prints it green (`map/map-screen.ts`), and a soldier dying there cries through `MapSound` (`31`).

**A vehicle's names are UI text.** The view carries a vehicle soldier's name as the simulation keeps it, which is not
the original's (`25`); the client names him by his body's vehicle type with `zVehicleName` above him, on the overhead
map, in the panels and the character list (`soldierName`, `tactical/soldiers.ts`; `characterName`,
`map/character-list.ts`), the info panel by `pShortVehicleStrings` and `pVehicleStrings` as `DrawCharacterInfo`, and the
out-of-gas box by `pVehicleStrings`. A vehicle in sight that is not ours carries its life and fuel for the bars over it
(`29`).

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
units, scaled by the client setting `websiteLoadingTimeScale`. Opened from the map screen, the laptop zooms out of the
map screen's laptop button over the picture the map screen last drew (`MapHost.picture`), as `MAP_EXIT_TO_LAPTOP` keeps
the frame in the extra buffer (`Strategic/Map_Screen_Interface_Bottom.cc:1095`); it powers down into the button over that
picture only with `atLeastOneMercHired` and without `newGameLaptop` in the view, read before its own `closeLaptop`
clears the latter (`Laptop/Laptop.cc:1351`), and over black when it did not open from the map. The A.I.M. and M.E.R.C. video faces (`laptop/video-face.ts`) are the tactical
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

**The zoom into a sector** (`front-end/sector-zoom.ts`). The original zooms into the map screen's picture for 2000 ms
whenever a sector loads while the map screen is up, outside a meanwhile and a savegame load, and when the pre-battle
panel's Enter goes to the loaded sector (`BeginLoadScreen`, `Strategic/StrategicMap.cc:196`;
`Strategic/PreBattle_Interface.cc:1023`); the Tactical button into the loaded sector does not zoom. The flow zooms when
the batch that leaves the map screen for the tactical flow carries `sectorLoaded`, or when a pre-battle panel was open
before it, and shows the loading or the tactical screen after the zoom. The zoom holds game time as a client modal does
(`28` §3), where the original's loop blocks the game. Both zooms stay off with `?pinClock=1`, whose UI clock never ends
them.

**Not built.** The tactical placement GUI (deviation "Tactical placement"), meanwhile scene playback (gap "Meanwhile scene playback"), the 3D cursor and the cover and sight display
(`28`'s decisions).

## 4. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Tests are under `src/ui/screens/` unless a path says otherwise.

| Quirk | Test |
|---|---|
| Every credits face blinks at once on entry: the original's unsigned clock difference | `front-end/front-end.test.ts` "blinks every face at once on entry …" |
| The character list sort compares each row with the merc it held when the sort reached it | `map/character-list.test.ts` |
| A path node in map column 16 is not drawn at 640 pixels wide: the original tests it against the screen width | `map/plotting.test.ts` "leaves out the column 16 pieces …" |
| The plotting ETA counts the remaining leg twice and drops the first temporary edge while the squad travels | `src/server/hints-strategic-stub.test.ts` "count the remaining leg twice …" |
| The move box's Other header counts vehicle passengers and skips doctors | `map/move-selection.test.ts` "keeps the original test of the others header …" |
| While a subtitle box is up the map screen's contract button and the contract column of the team list open no contract menu (the column still selects its merc), while the c key does (`Strategic/MapScreen.cc:4239`, `:5134`) | `map/map-speech.test.ts` "opens no contract menu from the contract button or column while the subtitle box is up …" |
| A line carried from tactical to the map loses its face popup, and one without a soldier (Skyrider, a head miner, a merc without a soldier) leaves an unseen popup at 10, 20 whose click region still cuts the line: `HandleDialogue` clears `gfFacePanelActive` after `HandleTacticalSpeechUI` registered it (`Tactical/Dialogue_Control.cc:352`) | `talk/talking-ui.test.ts` "takes the popup off a line carried to the map …" |
| A line carried from the map into tactical gets the face popup at 10, 20 whatever the speech option, beside a popup the map screen put up for Skyrider or a miner, and keeps the map's click region (`Tactical/Dialogue_Control.cc:386`) | `talk/talking-ui.test.ts` "gives a line carried from the map the popup …", "shows a popup the map put up beside …"; `talk/speech-surfaces.test.ts` "gives a line carried over from the map screen the popup …" |
| A head miner's line leaves the map on the level it shows: Stracciatella's switch to the surface passes the selected sector, whose level `iCurrentMapSectorZ` is (`Strategic/Map_Screen_Interface.cc:1623`, `Strategic/Map_Screen_Interface.h:229`) | `map/map-screen.test.ts` "keeps the level it shows while a head miner speaks …" |
| Space in autoresolve toggles pause and play but keeps Fast or Finish | `battle/autoresolve-screen.test.ts` "… keeps Fast through Space and Pause …" |
| The description box over a dealer box drifts down by column (the slot is multiplied before the division by the row length); over the offer area near the face it moves down instead of right | `shop/shop-panel.test.ts` "places the description box with the original quirks" |
| No tactical message line comes in or ages out while the view scrolls or the overhead map is up; the lines that aged meanwhile drop together as it stops or closes (`Utils/Message.cc:131`, `GameScreen.cc:366`) | `tactical/tactical-screen.test.ts` "lets no message line in or out while the view scrolls …", "… while the overhead map is up …" |
| The overhead map finds the cell under the pointer eight rows above it, for the click and the item lists, and at the pointer for the soldier it names (`TileEngine/Overhead_Map.cc:874`) | `src/app/tactical/overhead-map.test.ts` "finds the cell under the pointer …", "finds a soldier's cell …" |
| The overhead map lists the items a pool holds on a structure only with the pointer on their cell; a pool next to the pointer lists its floor items, as `GetZLevelOfItemPoolGivenStructure` reads the pointer's cell (`TileEngine/Overhead_Map.cc:323`) | `tactical/overhead-map.test.ts` "lists the pool nearest the pointer …" |
| Closing the overhead map enables the team panel's buttons and hands even under an item cursor, which disabled them, until the cursor ends (`TileEngine/Overhead_Map.cc:458`, `Tactical/Interface_Panels.cc:2628`) | `tactical/overhead-map.test.ts` "disables the team panel buttons …" |
| Esc in a run of the helicopter drop lands the seats left and then stops the selected merc, who may be walking off the drop zone: `HandleHeliDrop` reads the key before `HandleTacticalUI` takes its press (`GameScreen.cc:407`, `:436`, `Tactical/Turn_Based_Input.cc:2313`) | `tactical/helicopter-drop.test.ts` "lands the seats left once while Esc is held …" |
| A basement's overhead map blacks out its east edge from x 444, 8 pixels short of the west edge's mirror: `NORMAL_MAP_SCREEN_WIDTH` is 3160, 20 below the full map's screen width (`TileEngine/Overhead_Map.cc:56`, `:935`) | `src/app/tactical/overhead-map.test.ts` "blacks out a basement's edges …" |
| The overhead map takes every key while it is up: only ESC, INSERT and ALT+x act, and Backspace stops no line (`TileEngine/Overhead_Map.cc:419`) | `tactical/tactical-controls.test.ts` "gives the overhead map every key while it is up …" |
| While the overhead map is up the line already playing runs to its end with its voice and the panel face but no subtitle box or face popup, no other line starts, a civilian quote outlives its time unseen and the locators stand; all of it goes on as the map closes (`GameScreen.cc:366`, `TileEngine/Overhead_Map.cc:287`) | `tactical/tactical-screen.test.ts` "plays the line it opens over to its end …", "keeps a civilian quote past its lifetime under the overhead map …"; `tactical/tactical-controls.test.ts` "stops the locators under the overhead map …" |
| The stance drag keeps the arrows of its last step where no step applies (the pointer exactly 40 pixels up, beyond the stances he can take, back at the anchor), and the release goes by that step (`Tactical/Handle_UI.cc:1956`) | `tactical/tactical-controls.test.ts` "keeps the last arrows of the stance drag …" |
| The locator of a soldier out of sight stands, neither stepping nor ending, and goes on where it stood once he is seen again: the branch that would end it runs only with SHOW_ALL_MERCS (`Tactical/Interface.cc:923`) | `tactical/tactical-controls.test.ts` "stands the locator of a soldier out of sight …" |
| A locator takes at most one step a frame, the first at once unless the soldier's last step is under 80 ms old, so a slow frame slows it down (`Tactical/Interface.cc:935`) | `tactical/overlays.test.ts` |
| An item locator that runs out ends the first locator of its pool: when a newer one of the same pool took an earlier slot, the older one ends the newer one instead and flashes on until its INT8 colour wraps round to 1, 255 steps of 40 ms later (`Tactical/Handle_Items.cc:2191`) | `tactical/item-locators.test.ts` "ends a pool’s first locator as any of its locators runs out …" |
| The auto-bandage box is four faces wide from three faces up, shows a merc both medic and patient in both lists, and draws the breath bar at the breath maximum; with an empty list it draws nothing and has no buttons, so only the keys end the mode (`Tactical/Auto_Bandage.cc:466`, `:446`, `:924`) | `tactical/auto-bandage-box.test.ts` "is two faces wide below three faces …", "shows a merc on both lists twice …", "draws the breath bar at the breath maximum …", "masks the screen but draws no panel …" |
| The pickup menu checks a row's compatible stuff once as the pointer enters it, so after a wheel turn of the page under the pointer the outlines and faces stay those of the row's earlier item until the pointer leaves the row (`Tactical/Interface_Items.cc:4799`) | `tactical/tactical-screen.test.ts` "keeps the outlines of the pickup row the pointer entered while the wheel turns the page under it …" |
| A camera slide ends with one more scroll step by its target's place against the screen centre, which `SoldierLocationRelativeToScreen` measures without the map's left and top edges the target's place includes, so a target near the centre reads up and right (`Tactical/Soldier_Find.cc:424`, `TileEngine/RenderWorld.cc:1984`) | `src/app/world/slide.test.ts` "reads a target at the screen centre as up and right of it …"; `tactical/tactical-controls.test.ts` "slides to a target off screen in its direction …" |
| A face's right icons (blinded, adrenaline, drink) go at each icon's own width times its place, so the narrower adrenaline and drink icons overlap a wider blinded one (`Tactical/Faces.cc:694`) | `tactical/faces.test.ts` "places each right icon at its own width times its place …" |
| Over an enemy next to the merc the item cursor says Drop for a pickup's AP, while the click tosses at him (`Tactical/Interface_Items.cc:3011`, `:3323`) | `tactical/input/item-tile-cursor.test.ts` "tosses at an enemy next to him, though the cursor there says Drop …" |
| The item cursor's crosshair stays bad from the last landing check until the pointer rests long enough on another tile, and a click before that is refused as a bad throw (`Tactical/Interface_Items.cc:3078`, `:3475`) | `tactical/input/item-tile-cursor.test.ts` "turns the crosshair bad … until the next rest …" |
| A real-time right click within the double-click time of the last one does not swap the item cursor's give and throw (`Tactical/Real_Time_Input.cc:931`) | `tactical/tactical-screen.test.ts` "passes the held item … a real-time double click does not swap back" |
| On the map screen a CTRL+click on a stack without a cursor cleans the stack up and still picks it up, as `MAPInvClickCallbackPrimary` does not return after `CleanUpStack` (`Strategic/MapScreen.cc:3704`); the tactical panel returns | `map/map-inventory.test.ts` "cleans up a stack with CTRL+click on the map and still picks it up …" |
| One object taken off a stack and put back onto it goes to the stack's end (`GetObjFrom`, `StackObjs`: `Tactical/Items.cc:935`, `:969`), so clicks cycle a stack of magazines and change the top one's rounds | `tactical/tactical-screen.test.ts` "puts one magazine taken off its stack back at the end of the stack …", `src/sim/tactical/inventory-commands.test.ts` "puts one object taken off a stack back at the end of that stack …" |
| With an item held and an enemy in the loaded sector the map screen's info character changes to nobody, not even back to the merc the item came from (`Strategic/Map_Screen_Interface.cc:1457`) | `src/sim/campaign/item-passing.test.ts` "passes nothing to anybody while the loaded sector holds enemies …" |
| On the map screen a right click on a key of the ring shows no description, as its call is commented out, while one on an empty position closes the ring (`Tactical/Interface_Panels.cc:3572`) | `map/map-inventory.test.ts` "takes keys off the ring of a merc in no loaded sector …" |
| On the map screen every point a merc of ours bleeds makes him the info character and resets the selection, even when he already is the info character, so compressing time with a wounded merc keeps undoing a multi-selection (`Tactical/Soldier_Control.cc:7935`, `Strategic/MapScreen.cc:406`, `:7006`) | `map/map-screen.test.ts` "makes a merc who bleeds the info character, the selection reset even when he is one already …" |
| A damage number put up while the map screen is up stands there and drifts only once the game screen is back, with every loss since summed (`Tactical/Overhead.cc:527`) | `tactical/overlays.test.ts` "drifts a step every 250 ms for 8 steps, at most one a frame …" |
| The pointer is on a soldier also on the right and bottom edge of his screen rectangle; a vehicle's picture is tested one pixel left of the pointer, at its left edge on the last pixel of the row above | `tactical/input/targets.test.ts` "… its right and bottom edges included", `src/app/tactical/world-presenter.test.ts` "tests a vehicle's picture one pixel left of the pointer …" |
| With n cycling a soldier stack, the pointer moving off the stacked soldier finds nobody once, and the stack ends then (`Tactical/Soldier_Find.cc:232`) | `tactical/input/targets.test.ts` "finds nobody the first time the pointer is off the stacked soldier …" |
| An empty vehicle of ours under the pointer is neither ours nor an enemy, so a click does not select it (`Tactical/Soldier_Find.cc:50`); a merc aboard a vehicle is never under the pointer, and a click on his face in the team panel selects the vehicle | `tactical/input/targets.test.ts` "owns a vehicle of ours only with somebody aboard …", "never finds a merc aboard a vehicle …"; `tactical/soldiers.test.ts` "finds the vehicle of a merc aboard …" |
| An enterable vehicle not ours and an empty vehicle of ours are no soldier to `UIHandleOnMerc`: the move cursor goes on to the enter cursor and the vehicle is never named under the pointer (`Tactical/Handle_UI.cc:2711`, `:2749`); an empty vehicle of ours, named only by a locator, shows its name in grey under its Empty assignment in yellow (`Tactical/Interface.cc:1036`) | `tactical/tactical-vehicles.test.ts` "names no enterable vehicle under the pointer …", "names a vehicle of ours in white while somebody is aboard, and in grey …" |
| Every vehicle under the pointer, an enemy tank included, gets the life and fuel bars where another soldier not ours shows his health word, and a vehicle nobody is aboard, an enemy tank too, is named in grey (`Tactical/Interface.cc:1036`, `:1050`) | `tactical/tactical-vehicles.test.ts` "draws the life and fuel bars of an enemy tank …" |
| A vehicle has three names: `zVehicleName` above it and in the character list, where the ice cream truck is a plain Truck, `pVehicleStrings` in the info panel and the out-of-gas box, and `pShortVehicleStrings` under the info face (`Tactical/Vehicles.cc:67`, `Strategic/MapScreen.cc:762`, `Strategic/Strategic_Movement.cc:3156`) | `tactical/soldiers.test.ts` "names a vehicle by zVehicleName …", `map/info-panel.test.ts` "the name of a vehicle on the map screen …" |
| The move cursor shows enter over an empty vehicle the merc may use even when no tile beside it can be reached, and the click then boards nothing (`Tactical/Handle_UI.cc:4926`, `Tactical/Turn_Based_Input.cc:2974`) | `tactical/input/vehicle-cursors.test.ts` "… as enter over an empty one even out of reach …" |
| In real time a move click on a vehicle orders the boarding at the press and again at the release, as the press does not intercept the release (`Tactical/Real_Time_Input.cc:205`, `:598`) | `tactical/tactical-vehicles.test.ts` "orders the boarding at the press of a real-time move click and again at its release …" |
| The toolkit's and the gas can's cursors turn good over any vehicle at ground level, an enemy tank included, by the vehicle's own tile wherever the pointer is on its picture (`Tactical/UI_Cursors.cc:120`, `:901`, `:909`) | `tactical/tactical-vehicles.test.ts` "turns good anywhere on the Hummer's picture …", "… turns good over an enemy tank as well" |
| In combat the AP number on the hand cursor over an interactive tile sits where the walk or the run puts it: the offsets of `MOVEUI_TARGET_INTTILES` fall through to the move mode's, and only a swat or a crawl keeps them (`Tactical/Handle_UI.cc:3063`) | `tactical/tactical-controls.test.ts` "puts the AP number over an interactive tile where the walk or the run puts it …" |
| Over an interactive tile's picture the bomb cursor plots the walk to the tile under the pointer, while the click plants at the interactive tile: only the click takes its tile (`Tactical/UI_Cursors.cc:120`, `Tactical/Handle_UI.cc:2158`) | `tactical/tactical-controls.test.ts` "plots the bomb cursor's walk to the tile under the pointer over an interactive tile's picture …" |
| An interactive tile's picture is tested one pixel left of the pointer in a rectangle ten pixels below where it is drawn, raised by the tile's height even for a picture drawn without it (`TileEngine/Interactive_Tiles.cc:290`) | `src/app/world/interactive-nodes.test.ts` "tests the picture one pixel left of the pointer …", "raises the rectangle by the tile's height …" |
| The interactive tile is looked for again only when the pointer or the camera moves: the door rules of the UI mode, and the reset at a selection, a level change or a structure an explosion changes, hold until then; a picture whose rectangle reaches no lower than the screen top is never the one found, and the one found before stays (`TileEngine/Interactive_Tiles.cc:603`, `:343`) | `tactical/input/interactive-tiles.test.ts` "checks again only when the pointer or the render centre moves …", "keeps no node after a reset …", "never takes a node …" |
| A soldier's screen rectangle keeps the frame of the code his animation started at while later frames show, and a turn keeps the frame last converted, in the facing it was converted in, as `EVENT_SetSoldierDirection` converts no frame (`Tactical/Soldier_Control.cc:1743`, `:3992`); a vehicle's current frame is tested from the bottom of that rectangle up | `src/sim/tactical/animation.test.ts` "takes the frame of the code an animation starts at …", "keeps the frame shown at a turn in the facing it was converted in …"; `src/app/world/soldier-bounding-boxes.test.ts` "takes the view's bounding frame, not the frame drawn"; `src/app/tactical/world-presenter.test.ts` "tests a vehicle's current frame from the bottom of his rectangle up …" |
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
| A press on a picked I.M.P. specialty flips its toggle to released while the specialty stays picked, as the answer callback returns before it sets the buttons again; the next press that changes the picks sets them (`Laptop/IMP_SkillTraits.cc:350`) | `laptop/imp/imp-skill-traits.test.ts` "shows a press on a picked specialty as released …" |
| While the pointer is on the enabled Retreat button the map shows only the arrows out of the battle group's sector, and that sector's enemies keep the icon position of the sector drawn before it, as its team icons are skipped | `battle/battle-entry.test.ts` "draws the enemies of the sector the squad retreats from after the icons …" |
| The Retreat button's bounds for the retreat arrows include the pixel past its bottom right | `battle/battle-entry.test.ts` "counts the pixel past the bottom right of the Retreat button …" |
| While the pre-battle panel is up, a group leaving the battle group's sector also shows an about-to-arrive arrow toward its previous sector | `battle/battle-entry.test.ts` "shows a group leaving the battle sector as about to arrive …" |
| The laptop zoom truncates its percentage after the gravity step is added, so 20 % of its time zooms as 8 % (`Laptop/Laptop.cc:1025`) | `laptop/laptop-timers.test.ts` "truncates the zoom percentage after the gravity step is added …" |
| The zoom into a sector adds 0.05 past half way where the first half adds 0.5, so it reaches 100 % at 99 % of its time (`Strategic/StrategicMap.cc:223`) | `front-end/sector-zoom.test.ts` "adds 0.05 where the first half adds 0.5 …" |
| The zoom into a sector aims at the same pixels at any screen size: its target is not moved by `STD_SCREEN_X` and `STD_SCREEN_Y` (`Strategic/StrategicMap.cc:232`) | `front-end/sector-zoom.test.ts` "aims at the same pixels on a wider screen …" |
| Alt+Load and Alt+C open the load screen until a Dead is Dead game names its save, then load the newest save of any kind for good: Stracciatella sets `bLastSavedGameSlot` (the client setting `lastSavedGameSlot`) only there, to the first list entry | `front-end/front-end.test.ts` "sets the last saved slot to 0 for good …" |

Not pinned yet:
- `GlowTrashCan` never shows a glow: its colour index stays 0 (`map/merc-inventory.ts`).
- The arrows' search for the next info character can spend one of its twenty steps on row 20 (the left arrow where it
  starts or wraps, the right one from row 19), so with nobody else to select it may end without the current merc and
  his sector (`#nextMerc`, `map/map-screen.ts`).
- The unvisited sectors' shadow sits one pixel above the airspace tints (`map/map-view.ts`; the map goldens show it).
- The laptop's one-paragraph help pages add no line after their paragraph; the other pages add one after each
  (`help/help-pages.ts`).

## 5. Not checked against the native build

The oracle runs headless, so no screen is compared with the native build: the e2e goldens cover pixels on the stub
pack, and the `*-original.test.ts` files check that the art and texts each screen reads exist in the user's data.
Inferred or observed in ja2-node only:
- Layout above 640×480 follows Stracciatella's `STD_SCREEN` offsets as read; the centred shop, the talk subtitle test and
  the overhead map's black edges are deviations ("Shop placement above 640×480", "Talk subtitle placement above
  640×480", "Overhead map edges above 640×480").
- A.I.M.'s sort leaves ties to `std::sort`, which is unstable; ja2-node keeps the listing order.
- The militia filter's "no militia" message takes the first right click on the map.
- A merc put to sleep by command is not listed in the update box (`fellAsleep` is the hourly rest's).

Deviation "Game policy keys": the I.M.P. profiles saved by nickname stay off.

# Gaps: behaviour not ported yet

Every place where ja2-node does not yet do what JA2 Stracciatella with default settings does (the behaviour reference,
`01` D1), or does only part of it. A row gives the original's behaviour with a `file:line` link, what ja2-node does for
now, and what closing the gap depends on or changes. A closed gap leaves this file; a difference kept on purpose moves
to `deviations.md` with its reason. Other docs cite rows by their *Area* name (`gaps "Area"`); names are unique across
both files. Section 7 lists code that does not follow `CLAUDE.md` yet.

Original links are under `reference/stracciatella/src/game/`, or under `reference/stracciatella/` when they start with
`src/` or `rust/`. ja2-node paths are under the directory their section names, or from the repository root when they
start with `src/`, `data/` or `tools/`.

## 1. Tactical rules and AI

The loaded sector: doors, sight, walking, combat, items, explosions, the AI and NPCs on the map. Paths are under
`src/sim/tactical/`.

| Area | Original | ja2-node | Notes |
|---|---|---|---|
| Turn-based hooks | Where the original tests `bInSector` for our team, a helicopter passenger over the loaded sector counts, though he has no tile: the turn start's in-sector branches (`Tactical/Soldier_Control.cc:4019-4077`), the real-time opplist decay (`Tactical/OppList.cc:4540`), `IsTeamActive` (`Tactical/Overhead.h:178`), the losing check with its capture and its kill loop (`Tactical/Overhead.cc:4959`, `:5041`), the buddy lines of a death (`Tactical/Overhead.cc:2210`), the death at life 0 that never comes (`Tactical/Soldier_Control.cc:5401`), the start and end of combat and the stop for time compression (`Tactical/Overhead.cc:3913`, `:4057`, `:5871`); boarding keeps his opplist (`Tactical/Vehicles.cc:261`), and leaving over the loaded sector gives him a second merc slot (`Tactical/Overhead.cc:244`) | He holds his merc slot with no tile (`offMap`, `25`), but those branches test `placed` (`turns/turns.ts`, `combat/hit.ts`, `campaign/battle-flow.ts`, `campaign/contracts/contract-flow.ts`), boarding clears his opplist and leaving keeps one slot | Each branch opts in through `inSector(s)` and reads a tile only where the original guards `NOWHERE` (the table of `25`); the native passenger probes of `helidrop.txt` await their comparer |
| Map items | The pit action items open a pit and drop the soldiers around into it (`PerformItemAction`, `TileEngine/Explosion_Control.cc:1671`; `Add3X3Pit`, `TileEngine/Pits.cc:24`) | Do nothing (`performItemAction`, `bombs/item-action.ts`) | No shipped map holds a pit (`12` §6) |
| NPC opens a door on arrival | A soldier arriving to open a door also drops the action while a merc who gave on the spot still holds `MERC_GIVEITEM`, until his animation count or a new order clears it (`Tactical/Overhead.cc:840`, `Tactical/Soldier_Control.cc:1674`) | Dialogue, the locked interface (`playerInterfaceLocked`, `interface-lock.ts`), a merc walking up to give and auto-bandage, running or pending, drop it (`handlePendingDoorOnArrival`, `doors/door-command.ts`) | The give's pending record has no animation count; a spotted mine's locator locks nothing here (deviation "Mine locator") |
| Automatic selections | Closing the tactical assignment menu rebuilds the current squad (`Strategic/Assignments.cc:5463`): with the current squad off the map, the first squad on it becomes current and its first merc is selected, forced; the talk that opens a shop makes the merc's squad current and selects him (`Tactical/Interface_Dialogue.cc:303`) | `assign` and `assignSquad` in tactical leave the current squad as their squad changes left it (`src/sim/campaign/commands.ts`); `openShop` makes the merc's squad current without a selection (`src/sim/campaign/shop-flow.ts`) | The menu's close needs a command boundary of its own (its choices are the assignment commands); `openShop` stands for the talk (deviation "Talking to dealers"), so it would select its merc as an order does |

## 2. Strategic layer

The map, travel, vehicles, time compression, the economy, sector state and autoresolve. Paths are under `src/sim/`.

| Area | Original | ja2-node | Notes |
|---|---|---|---|
| Strategic move refusals | With no map loaded the museum check reads the rooms of the last map loaded, which `TrashWorld` keeps (`GetRoom`, `TileEngine/Render_Fun.cc:32`) | With no map loaded a merc stands in no room (`campaign/sector-flow.ts`) | The stale rooms need the unloaded map's room table kept |
| Helicopter entrance | A save taken in mid-drop keeps the undropped seats in the helicopter with no run and the pause locked, and a merc saved in `HELIDROP` steps away at code 467 (`SaveLoadGame.cc:1036`, `:274`); combat beginning mid-drop lifts the drop's pause for one frame (`Tactical/Handle_UI.cc:4459`) and the walk at code 467 in turn-based takes lock 17 (`Tactical/Handle_UI.cc:4850`) | The drop runs in the campaign and the client (`tactical/helicopter-drop.ts`, `campaign/helicopter-drop-flow.ts`, `30`, `31`), but a native import does not seat a merc saved in the helicopter (`tactical/save-import.ts`), and the drop's lock stays 16 throughout | The import waits for its deviation ("Helicopter drop in a native save": the import finishes the drop as Esc does); the two lock steps are UI-mode states `playerInterfaceLocked` folds into one lock |
| Autoresolve stalemate | A battle of only unconscious fighters never ends, and Finish hangs (`Strategic/Auto_Resolve.cc:3267`) | The battle runs on without a freeze (`campaign/battle-flow.ts`) | Ending it would be a deviation (deviations "Watchdogs") |

## 3. Campaign, laptop and narrative

NPC records, merc lines, the dialogue queue and quest scripting. Paths are under `src/sim/`.

| Area | Original | ja2-node | Notes |
|---|---|---|---|
| Merc arrival line | A merc who arrives by any way but the helicopter says his "reached destination" line, unless another arrival's line is still queued or the first helicopter run is still to come (`Tactical/Merc_Hiring.cc:289`, `:294`) | The arrival emits `mercArrived` and the arrival quotes of the team (`campaign/laptop/laptop-flow.ts`, `campaign/contracts/hire-contract.ts`), but nobody says `QUOTE_MERC_REACHED_DESTINATION` | Needs the tactical status flag `bMercArrivingQuoteBeingUsed`, which the native save format carries but nothing reads (`src/content/formats/savegame-tactical.ts`), and `HelicopterDrop.firstHeliRun` (`tactical/helicopter-drop-state.ts`) |

## 4. Agent API

Commands the API does not have yet, and what its hints do not read: none known. Paths are under `src/sim/`.

## 5. Savegame import

What a native savegame import leaves out. Paths are under `src/`.

| Area | Original | ja2-node | Notes |
|---|---|---|---|
| Savegame import | A load keeps every sector's temp files: revealed tiles, effects, map modifications (`Tactical/Tactical_Save.cc:469`); the loaded sector's map changes also bring back damaged structures' hit points and hit windows (`TileEngine/SaveLoadMap.cc:189`, `:217`) | Of the temp files only the loaded sector's items, corpses, doors, openables, blood and smell, revealed tiles, and of its map changes the objects, the structure tiles added and removed and the exit grids (`sim/tactical/save-import.ts`); other sectors load from their maps, without their items or changes | Other sectors' files need writing into the sector diffs; damage and window records need the structure lookup by saved type (`FindStructureBySavedInfo`) |
| Animations on load | The load starts every soldier's animation again at its saved code, which runs the script on to the next frame (`CreateSoldierCommon`, `Tactical/Soldier_Control.cc:615`): a breathing soldier stopped before his idle check (code 491) counts it, and may roll it, at the load | The import keeps each soldier's saved code and frame (`placeSoldier`, `sim/tactical/save-import.ts`) | The restart would run opcodes, draws and state changes included, inside the import; the auto-bandage comparer copies the native code instead (`tools/oracle/README.md` "Auto-bandage") |
| Unread savegame sections | A load restores bullets, thrown objects and explosions in flight, the bomb queue (`LoadExplosionTableFromSavedGameFile`, `TileEngine/Explosion_Control.cc:2319`), the cursor item and the map messages (`SaveLoadGame.cc:855`) | Skipped (`content/formats/savegame.ts`): an imported save starts with an empty bomb queue |  |

## 6. Presentation: screens, graphics, text, sound and video

What the client does not show or play yet; none of it changes an outcome. Paths are under `src/`.

| Area | Original | ja2-node | Notes |
|---|---|---|---|
| Data version detection | The data version is guessed from the SLFs' language folders, then from resource hashes (`rust/stracciatella/src/guess.rs:128`) | The folder half only (`content/text/data-version.ts`); French and Simplified Chinese data need `JA2_DATA_VERSION` | `31` |
| Sound coverage | The statue remote's sound, the glass crack of a jar stack broken in a fall, Dr. Q's chop at each martial arts strike, our merc's OK when a pickup or search walks him more than 5 tiles, the HIT1 grunt at gas, bleeding and electric damage (`Tactical/Handle_Items.cc:2541`, `Tactical/Items.cc:3243`, `Tactical/Soldier_Control.cc:504`, `Tactical/Handle_Items.cc:1130`, `TileEngine/Explosion_Control.cc:847`, `Tactical/Soldier_Control.cc:8764`) | Not played | Each with its system; the crack needs an event from `checkEquipmentForFragileItemDamage` (`src/sim/tactical/explosions/item-damage.ts`), the pickup's OK the path `soldierPickupItem` plots (`src/sim/tactical/item-actions.ts`); the grunt can follow `damageFeedback`, sent only for soldiers the squad sees (deviation "Sounds out of sight"), once it carries the voice of a merc off the loaded map as `mercDied`'s `cry` does |
| Screen zooms | Zooms into the sector and out of the laptop button (`Strategic/StrategicMap.cc:196`, `Laptop/Laptop.cc:1048`) | No sector zoom; `/play` does not pass the laptop zoom (`app/game/front-end.ts`) | Cosmetic (`30`) |
| IME composition | Text fields take IME text (`Utils/Text_Input.cc:133`) | Single-character key presses only (`ui/input/events.ts`) | Needed for Chinese |
| Map screen speech | On the map Skyrider and the head miners talk in the external face popup with its subtitle box beside it (`Tactical/Dialogue_Control.cc:1012`, `:937`), placed for the helicopter's monologues and clear of the miner's mine (`Strategic/Map_Screen_Helicopter.cc:701`, `Strategic/Strategic_Mines.cc:782`), with the sector locator on Skyrider's helicopter or the miner (`Strategic/Map_Screen_Interface.cc:4132`); a merc line without a soldier takes the external popup at 10, 20 (`Tactical/Dialogue_Control.cc:1052`); a line carried across a screen switch keeps its subtitle box where it was, and a line from the map gets the tactical face popup with speech off too (`Tactical/Dialogue_Control.cc:352`, `:386`) | Skyrider and the head miners are heard, their text only in the message list, and the locator follows our mercs alone (`ui/screens/map/map-speech.ts`); each screen draws a carried-over line its own way, the popup only with speech on (`ui/screens/talk/speech-surfaces.ts`) | The panel position needs the mines' `faceDisplayYOffset` in the content and the monologue on the `skyriderQuote` event (`30`) |
| Room reveal at a load | A sector entry and a native load reveal every revealed tile as a room reveal does (`TileEngine/SaveLoadMap.cc:488`, `TileEngine/Render_Fun.cc:73`): the roofs and slanted roofs over revealed tiles outside any room come off, with a ceiling over the roof's unseen tiles, and their obstacles show through; the wall wire frames, worked out again at a room reveal, at a structure an explosion changes and at a load, test every revealed tile (`TileEngine/WorldDef.cc:2669`, `TileEngine/Render_Fun.cc:224`, `TileEngine/Explosion_Control.cc:1435`) | Only the tiles of revealed rooms (`render/world/reveal.ts`, the ceilings in `src/sim/tactical/perception/slant-roofs.ts`), the wire frames included | Needs the tiles revealed at the last load in the view; a ja2-node load keeps the stay's picture (`05`, `08`) |
| Effective stat tooltips | Hovering a stat of the single-merc panel shows its effective value and what changes it: drink for every stat but strength, the weight carried at the turn start for agility, wounds and first aid for strength, claustrophobia underground for the level (`Tactical/Interface_Panels.cc:1951`, `src/externalized/content/NewStrings.cc:647`) | The panel shows the stats without a tooltip (`ui/screens/tactical/sm-panel.ts`, `data/layouts/original/tactical-sm.json`) | Porting it needs the effective stats and their terms in the view, or the tooltip as a hint; its strings are in `data/externalized/strings/tooltips-eng.json` |
| I.M.P. skill page and saved profiles | `imp_pick_skills_directly` and `imp_load_saved_merc_by_nickname` (`Laptop/IMP_Personality_Entrance.cc:97`, `Laptop/IMP_Begin_Screen.cc:300`) | The skill page is empty; no saved profile loads (`ui/screens/laptop/imp/imp-profile.ts`) | Both are off in the default rule pack (`30`) |
| Meanwhile scene playback | OK plays the scene, Skip skips it, a played scene is marked seen (`Strategic/Meanwhile.cc:396`, `:535`) | The box only; OK and Skip both continue, nothing is marked seen (`ui/screens/story/story-layer.ts`) | No scene sandbox (`26`) |
| Roof marker | The marker is a roof-layer node, so a roof light drawn after it was placed and a change of the base light shade it as the roof (`LightAddTile`, `LightSetNaturalTile`, `TileEngine/Lighting.cc:671`, `:829`) | Drawn at the shade it is placed with, `DEFAULT_SHADE_LEVEL` (`app/world/roof-markers.ts`, `app/world/tactical-world-view.ts`) | Needs each node's own light in the client's lighting (deviation "Light on structures", `20`); shows at night under a merc's light and after dusk or dawn |
| Soldier pick rules | `SetSoldierLocatorOffsets` takes the frame of every animation start, from its starting code (random for `CHARIOTS_OF_FIRE` and `BODYEXPLODING`, `Tactical/Soldier_Control.cc:1721`), and of every direction change at the moment it happens (`:3992`) | The client sees starts and turns once a view frame (`app/world/soldier-bounding-boxes.ts`): a start takes the script's first frame from code 0, a turn the frame of that view in the facing of the view before | Exact boxes need each soldier's bounding frame (script frame and facing) in the view, which resends his entry at every turn; the box differs by the few pixels between neighbouring frames until his next start or turn |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.

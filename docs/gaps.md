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
| Map items | The pit action items open a pit and drop the soldiers around into it (`PerformItemAction`, `TileEngine/Explosion_Control.cc:1671`; `Add3X3Pit`, `TileEngine/Pits.cc:24`) | Do nothing (`performItemAction`, `bombs/item-action.ts`) | No shipped map holds a pit (`12` §6) |

## 2. Strategic layer

The map, travel, vehicles, time compression, the economy, sector state and autoresolve: none known. Paths are under
`src/sim/`.

## 3. Campaign, laptop and narrative

NPC records, merc lines, the dialogue queue and quest scripting: none known. Paths are under `src/sim/`.

## 4. Agent API

Commands the API does not have yet, and what its hints do not read: none known. Paths are under `src/sim/`.

## 5. Savegame import

What a native savegame import leaves out. Paths are under `src/`.

| Area | Original | ja2-node | Notes |
|---|---|---|---|
| Animations on load | The load restarts every saved animation inside `LoadSoldierStructure` (`SaveLoadGame.cc:780`, `:1404-1430`), the clock, events, laptop and profiles loaded (`:710-777`) and the squads, quests and NPC records not yet (`:801-819`), each soldier seeing only those created before him; an opcode the restart reaches reports to that half-loaded game: a merc landing from the helicopter (code 467) says his arrival lines (`HandleMercArrivesQuotes`, `Tactical/Merc_Hiring.cc:395`), a soldier finishing his death (code 440) dies for the campaign, and a collapse looks around with the saved `bInSector` (`Tactical/Soldier_Control.cc:7970`) | The restart runs inside the tactical import, before the soldiers stand on the map and before the campaign exists, so such an opcode reaches the TacticalSim's own hooks (`restartSavedSoldiers`, `sim/tactical/save-import.ts`) | Not a contained change: the campaign is assembled from the tactical import (its streams and state, the restarted soldiers for the roster) and hooks the sector last, after the contracts, the story and the NPC records (`createSaveSession`, `server/save-session.ts`; `adoptLoadedSector`, `sim/campaign/sector-flow.ts`); closing it needs the campaign built and hooked before the restart, its state as half loaded as the original's there. Only a soldier saved right before such an opcode reaches one, and none of the shipped saves holds one (the `HELIDROP` merc of `OracleHeliDrop` restarts short of 467) |
| Pending actions on import | Placing a loaded soldier on the map drops his saved pending action (`AddSoldierToSectorGridNo`, `Tactical/Soldier_Add.cc:871`; `src/externalized/Soldier.cc:42-47`), but his animation's restart counts it first (`Tactical/Soldier_Control.cc:1670-1697`: saved moving with a count above 0 he drops it and frees a give's target, else its count goes up), and drivers, passengers (`Tactical/Soldier_Add.cc:707-708`), the helicopter's seats (`AddMercToHeli`, `Strategic/StrategicMap.cc:1160`) and soldiers on no map keep it until they enter a map or stop: meanwhile one of ours in the loaded sector holds the auto-bandage question back (`Tactical/Auto_Bandage.cc:151-160`), and a give anywhere in our team makes every merc walking up to a door or a container drop his open (`Tactical/Overhead.cc:840-849`) | The import sets none of the pending records (`sim/tactical/pending-action.ts`), as the placing drops them: the restart counts none, and nobody off the map keeps one | Needs a record of a saved action with no live data behind it for the soldiers the load leaves off the map (ja2-node splits the slot into a typed record per action, `sim/tactical/pending-action.ts`) and the restart's count on it; none of the shipped saves holds a pending action |

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

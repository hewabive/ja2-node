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

The loaded sector: doors, sight, walking, combat, items, explosions, the AI and NPCs on the map: none known. Paths are
under `src/sim/tactical/`.

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
| Pending actions on import | A soldier the load leaves off the map keeps his saved pending action past getting out of a vehicle onto the map (`ExitVehicle`, `Tactical/Vehicles.cc:552`), and the end of his next walk no order started runs it on its saved data (`Tactical/Overhead.cc:817`, `src/externalized/Soldier.cc:104`); the restart's drop of a saved give frees its target outside the loaded sector too (`Tactical/Soldier_Control.cc:1677-1681`); the auto-bandage question waits for the seats of a helicopter drop under way too (`Tactical/Auto_Bandage.cc:151-160`) | The saved action keeps only its code, its count and a give's target (`savedPendingAction`, `sim/tactical/save-import.ts`): such a walk ends standing, the restart frees a target only among the loaded sector's soldiers, and the auto-bandage wait reads only those, which leave out the drop's seats (`ourTeam`, `sim/tactical/ai/medical.ts`) | Needs the saved data mapped onto the typed records (`sim/tactical/pending-action.ts`); a merc gets out with a saved action only if he boarded off the loaded map, as boarding on it stops him (`Tactical/Vehicles.cc:269`); none of the shipped saves holds a pending action |

## 6. Presentation: screens, graphics, text, sound and video

What the client does not show or play yet; none of it changes an outcome. Paths are under `src/`.

| Area | Original | ja2-node | Notes |
|---|---|---|---|
| Map screen speech | On the map Skyrider and the head miners talk in the external face popup with its subtitle box beside it (`Tactical/Dialogue_Control.cc:1012`, `:937`), placed for the helicopter's monologues and clear of the miner's mine (`Strategic/Map_Screen_Helicopter.cc:701`, `Strategic/Strategic_Mines.cc:782`), with the sector locator on Skyrider's helicopter or the miner (`Strategic/Map_Screen_Interface.cc:4132`); a merc line without a soldier takes the external popup at 10, 20 (`Tactical/Dialogue_Control.cc:1052`); a line carried across a screen switch keeps its subtitle box where it was, and a line from the map gets the tactical face popup with speech off too (`Tactical/Dialogue_Control.cc:352`, `:386`) | Skyrider and the head miners are heard, their text only in the message list, and the locator follows our mercs alone (`ui/screens/map/map-speech.ts`); each screen draws a carried-over line its own way, the popup only with speech on (`ui/screens/talk/speech-surfaces.ts`) | The panel position needs the mines' `faceDisplayYOffset` in the content and the monologue on the `skyriderQuote` event (`30`) |
| Room reveal at a load | The wall wire frames worked out again during a stay, around the tiles of a room a look reveals and around a structure an explosion changes, test every tile sight has revealed, outside any room too (`Tactical/FOV.cc:639`, `TileEngine/Render_Fun.cc:208`, `TileEngine/Explosion_Control.cc:1434`, `TileEngine/WorldDef.cc:2687`) | The client works the wire frames out from the tiles the last load revealed and the tiles of the revealed rooms (`render/world/reveal.ts`) | Needs the tiles sight revealed in the view, or the wire frames worked out in the simulation; it shows only next to a roofed tile outside any room that sight revealed during the stay (`05`, `08`) |
| Effective stat tooltips | Hovering a stat of the single-merc panel shows its effective value and what changes it: drink for every stat but strength, the weight carried at the turn start for agility, wounds and first aid for strength, claustrophobia underground for the level (`Tactical/Interface_Panels.cc:1951`, `src/externalized/content/NewStrings.cc:647`) | The panel shows the stats without a tooltip (`ui/screens/tactical/sm-panel.ts`, `data/layouts/original/tactical-sm.json`) | Porting it needs the effective stats and their terms in the view, or the tooltip as a hint; its strings are in `data/externalized/strings/tooltips-eng.json` |
| I.M.P. skill page and saved profiles | `imp_pick_skills_directly` and `imp_load_saved_merc_by_nickname` (`Laptop/IMP_Personality_Entrance.cc:97`, `Laptop/IMP_Begin_Screen.cc:300`) | The skill page is empty; no saved profile loads (`ui/screens/laptop/imp/imp-profile.ts`) | Both are off in the default rule pack (`30`) |
| Meanwhile scene playback | OK plays the scene, Skip skips it, a played scene is marked seen (`Strategic/Meanwhile.cc:396`, `:535`) | The box only; OK and Skip both continue, nothing is marked seen (`ui/screens/story/story-layer.ts`) | No scene sandbox (`26`) |
| Roof marker | The marker is a roof-layer node, so a roof light drawn after it was placed and a change of the base light shade it as the roof (`LightAddTile`, `LightSetNaturalTile`, `TileEngine/Lighting.cc:671`, `:829`) | Drawn at the shade it is placed with, `DEFAULT_SHADE_LEVEL` (`app/world/roof-markers.ts`, `app/world/tactical-world-view.ts`) | Needs each node's own light in the client's lighting (deviation "Light on structures", `20`); shows at night under a merc's light and after dusk or dawn |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.

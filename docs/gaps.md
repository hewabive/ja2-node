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
| Map screen speech | A Skyrider monologue turns the airspace on (`TurnOnAirSpaceMode`) as it starts and at each of its special events, so his helicopter gets no locator while he talks, and flashes the SAM sites, the Cambria hospital or Estoni in red while he talks about them, which hides the speaker's locator (`Strategic/Map_Screen_Helicopter.cc:701`, `:889`); a face popup outlives its line: with speech off `HandleDialogueEnd` leaves up the popup of a line carried from the map into tactical, and a popup the map showed for Skyrider or a miner stays registered once a line carries it into tactical, so later popups show there too (`Tactical/Dialogue_Control.cc:386`, `:1126`); an external speaker with a soldier in the loaded sector gets the soldier's panel, with his name, sector and bars (`Tactical/Dialogue_Control.cc:1245`); an NPC's line on the map marks his sector (`Tactical/Faces.cc:1215`) | The monologue leaves the filters as they are and flashes nothing; a popup goes with its line; an external speaker always gets the panel without a soldier; an NPC's line marks no sector (`ui/screens/map/map-speech.ts`, `ui/screens/talk/talking-ui.ts`) | The special events need events of their own (`skyriderMonologue` comes only as a monologue starts), the flashes a map view part, and turning the airspace on changes the stub map campaign's goldens and e2e flows, where the monologue starts as the map opens; the lasting popups need `TalkingUi` to keep popups past their line; the NPC's locator needs the sector on `npcQuote` (`30`) |
| Room reveal at a load | The wall wire frames worked out again during a stay, around the tiles of a room a look reveals and around a structure an explosion changes, test every tile sight has revealed, outside any room too (`Tactical/FOV.cc:639`, `TileEngine/Render_Fun.cc:208`, `TileEngine/Explosion_Control.cc:1434`, `TileEngine/WorldDef.cc:2687`) | The client works the wire frames out from the tiles the last load revealed and the tiles of the revealed rooms (`render/world/reveal.ts`) | Needs the tiles sight revealed in the view, or the wire frames worked out in the simulation; it shows only next to a roofed tile outside any room that sight revealed during the stay (`05`, `08`) |
| I.M.P. skill page and saved profiles | Every save writes `mercprofile.<nickname>.json`, the profile and inventory of each living I.M.P. on the team, into the save folder (`SaveLoadGame.cc:1288`, `Tactical/IMPProfileJson.cc:667`); with `imp_load_saved_merc_by_nickname` a nickname given without a full name or a gender takes the profile saved under it into the free slot and goes to the confirm page, refused with `pImpPopUpStrings[4]` when no slot is free or the file cannot be read (`Laptop/IMP_Begin_Screen.cc:300`), and with `imp_load_keep_inventory` the character lands with the saved inventory (`Laptop/IMP_Confirm.cc:186`) | No profile is written; the rule pack reads neither key (`src/content/strategic/laptop-content.ts`) | A design decision: where the files live and who sees them (beside the saves in `JA2_SAVE_DIR`, which every session on the server shares; also the native saves folder, where Stracciatella writes its own files, which are JSON and readable; a per-user store the server does not have), how a file reaches the simulation (the server reads it into `impCreate`, so the input log carries the profile, or the client sends it) and how the begin page learns that a nickname has a file. Vanilla writes no such file. Both keys are off in the default rule pack (`21`) |
| Meanwhile scene playback | OK plays the scene, Skip skips it, a played scene is marked seen (`Strategic/Meanwhile.cc:396`, `:535`) | The box only; OK and Skip both continue, nothing is marked seen (`ui/screens/story/story-layer.ts`) | No scene sandbox (`26`) |
| Roof marker | The marker is a roof-layer node, so a roof light drawn after it was placed and a change of the base light shade it as the roof (`LightAddTile`, `LightSetNaturalTile`, `TileEngine/Lighting.cc:671`, `:829`) | Drawn at the shade it is placed with, `DEFAULT_SHADE_LEVEL` (`app/world/roof-markers.ts`, `app/world/tactical-world-view.ts`) | Needs each node's own light in the client's lighting (deviation "Light on structures", `20`); shows at night under a merc's light and after dusk or dawn |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.

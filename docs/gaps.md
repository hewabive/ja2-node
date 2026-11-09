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
| Room reveal at a load | A room a look reveals works the wall wire frames around it out again at once, in the middle of the look, against the tiles revealed until then (`TileEngine/Render_Fun.cc:224` from `Tactical/FOV.cc:646`); only an explosion that changes a structure works out again the ones in its blast radius around the bomb (`TileEngine/Explosion_Control.cc:1434`) | The client works them out after the frame, against every tile revealed by its end, within two tiles of the tiles of each room revealed and of each structure a tile change touched, an explosion's or not (`followWireframes`, `render/world/reveal.ts`) | Needs the moment and the area of each recalculation from the simulation, with the tiles revealed by then; shows only for a tile the rest of the look revealed next to a wall the room's recalculation reaches, and inside a blast farther than two tiles from what it changed (`05`) |
| Meanwhile scene playback | OK plays the scene, Skip skips it, a played scene is marked seen (`Strategic/Meanwhile.cc:396`, `:535`) | The box only; OK and Skip both continue, nothing is marked seen (`ui/screens/story/story-layer.ts`) | No scene sandbox (`26`) |
| Soldier face deletion | A face deleted while it talks ends its line there, its talking UI with it, and the dialogue queue goes on to the next line (`DeleteFace`, `Tactical/Faces.cc:231`; `Tactical/Dialogue_Control.cc:342`): Larry's profile swap in the middle of a line of his (`Tactical/Soldier_Profile.cc:1011`); `ChangeSoldierTeam` also deletes the face of a merc married off (`Tactical/Interface_Dialogue.cc:3835`) and of our soldiers of a civilian group turned hostile (`Tactical/Overhead.cc:2734`) | A deleted face waits for the end of a line of his still playing, which plays out; those two team changes delete no face (`app/sound/session-speech.ts`, `ui/screens/talk/talking-ui.ts`) | The line's end needs the simulation's dialogue queue to end the speaker's line at the swap; the team changes need an event, or the client to take a merc gone from the roster for a deleted face (`30`) |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.

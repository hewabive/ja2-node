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
| Pending actions on import | The end of a walk no order started runs a saved door, container or pickup action on its saved data (`Tactical/Overhead.cc:817-847`, `src/externalized/Soldier.cc:104-130`): a door or container with the APs of the saved `ubDoorHandleCode`, through `InteractWithOpenableStruct`; a pickup of the item, the whole pool or the selection `uiPendingActionData1` names | Those codes stay saved and the walk ends standing (`adoptSavedPendingAction`, `sim/tactical/saved-pending-action.ts`) | The typed records need what the save holds differently: `pendingDoorAction` a door action named in advance and the tile he acts from, `pendingPickup` the world items themselves where the save has an item index or a selection list it does not keep; only a merc who boarded while waiting for a tile reaches it, after getting out of the vehicle onto the map (`Tactical/Vehicles.cc:266`, `Tactical/Soldier_Control.cc:7381`); none of the shipped saves holds a pending action |

## 6. Presentation: screens, graphics, text, sound and video

What the client does not show or play yet; none of it changes an outcome. Paths are under `src/`.

| Area | Original | ja2-node | Notes |
|---|---|---|---|
| Meanwhile scene playback | OK plays the scene, Skip skips it, a played scene is marked seen (`Strategic/Meanwhile.cc:396`, `:535`) | The box only; OK and Skip both continue, nothing is marked seen (`ui/screens/story/story-layer.ts`) | No scene sandbox (`26`) |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.
